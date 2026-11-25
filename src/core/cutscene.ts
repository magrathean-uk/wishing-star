// Cutscenes: short scripted scenes played in the game itself with the animated characters (never still pictures).
import { applyFx, place } from './quests.ts';
import { cast, say } from './talk.ts';
import type { Actor, CutAct, Dir, Game } from './types.ts';

const DEF_SPEED = 2.4;
/** Seconds X is held to skip a scene. */
export const HOLD_TO_SKIP = 1;
/** Scenes that play in full the first time through (phase 2, part A). */
export const NO_SKIP_FIRST = new Set(['finale']);

export function startCut(g: Game, id: string, then: (() => void) | null = null): void {
  const def = g.c.cutscenes[id];
  if (!def) throw new Error(`unknown cutscene ${id}`);
  if (g.rt.mode !== 'play') {
    g.rt.q.push(() => startCut(g, id, then));
    return;
  }
  g.rt.cut = { id, i: 0, t: 0, actors: {}, cam: null, backdrop: def.backdrop ?? null, moving: [], then, dark: 0 };
  g.rt.mode = 'cut';
  g.rt.swingT = 0;
  g.rt.clip = 'idle';
  // the finale is a party: any mob about goes quietly (bosses are long beaten by then)
  if (id === 'finale') g.rt.mobs = g.rt.mobs.filter((m) => g.c.mobs[m.id]?.role === 'boss');
}

function spot(g: Game, a: CutAct): { x: number; y: number } {
  if (a.at) {
    const p = place(g, a.at);
    if (p) return { x: p.x + 0.5 + (a.x ?? 0), y: p.y + 0.5 + (a.y ?? 0) };
  }
  return { x: a.x ?? g.s.x, y: a.y ?? g.s.y };
}
function who(g: Game, id: string): string {
  return id === 'you' ? 'you' : cast(g, id);
}
function faceTo(dx: number, dy: number): Dir {
  return Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'down';
}

/** Run one act. Returns true when the script should wait before the next act. */
function run(g: Game, a: CutAct, instant: boolean): boolean {
  const cut = g.rt.cut!;
  const id = a.who ? who(g, a.who) : '';
  const actor: Actor | undefined = id && id !== 'you' ? cut.actors[id] : undefined;
  switch (a.a) {
    case 'spawn': {
      if (id === 'you' || id === cast(g, g.s.hero)) {
        // The hero is never doubled: a scene that names the played character uses the hero herself.
      }
      if (id === 'you') {
        const p = spot(g, a);
        g.s.x = p.x;
        g.s.y = p.y;
        g.rt.px = p.x;
        g.rt.py = p.y;
        if (a.dir) g.s.dir = a.dir;
        return false;
      }
      const p = spot(g, a);
      cut.actors[id] = {
        k: g.rt.nextK++,
        id,
        kind: 'actor',
        area: g.s.area,
        x: p.x,
        y: p.y,
        px: p.x,
        py: p.y,
        dir: a.dir ?? 'down',
        clip: a.clip ?? 'idle',
        ct: 0,
      };
      return false;
    }
    case 'move': {
      const p = spot(g, a);
      if (instant) {
        if (id === 'you') {
          g.s.x = p.x;
          g.s.y = p.y;
        } else if (actor) {
          actor.x = p.x;
          actor.y = p.y;
        }
        return false;
      }
      cut.moving.push({ who: id, tx: p.x, ty: p.y, speed: a.speed ?? DEF_SPEED });
      return !a.go;
    }
    case 'face':
      if (id === 'you') g.s.dir = a.dir ?? 'down';
      else if (actor) actor.dir = a.dir ?? 'down';
      return false;
    case 'clip':
      if (id === 'you') {
        g.rt.clip = a.clip ?? 'idle';
        g.rt.ct = 0;
      } else if (actor) {
        actor.clip = a.clip ?? 'idle';
        actor.ct = 0;
      }
      return false;
    case 'hide':
      delete cut.actors[id];
      return false;
    case 'say':
      if (instant || !a.l) return false;
      say(g, [a.l], null, 0, true);
      return true;
    case 'wait':
      if (instant) return false;
      cut.t = a.s ?? 1;
      return true;
    case 'cam':
      cut.cam = a.who
        ? id === 'you'
          ? null
          : actor
            ? { x: actor.x, y: actor.y }
            : null
        : a.at || a.x !== undefined
          ? spot(g, a)
          : null;
      if (a.who && actor) (cut as any).follow = id;
      else (cut as any).follow = null;
      return false;
    case 'fx': {
      const p = spot(g, a);
      if (!instant) g.ev.push({ t: 'fx', id: a.id ?? 'sparkle', x: p.x, y: p.y, n: a.s });
      return false;
    }
    case 'sfx':
      if (!instant) g.ev.push({ t: 'sfx', id: a.id ?? 'tick' });
      return false;
    case 'music':
      g.ev.push({ t: 'music', id: a.id ?? '' });
      return false;
    case 'bg':
      cut.backdrop = a.id ?? null;
      return false;
    case 'light':
      if (a.id === 'dark') cut.dark = a.s ?? 1;
      else g.ev.push({ t: 'light', region: a.id ?? '' });
      return false;
    case 'do':
      applyFx(g, a.fx);
      return false;
    default:
      return false;
  }
}

function stepMovers(g: Game): void {
  const cut = g.rt.cut!;
  for (let i = cut.moving.length - 1; i >= 0; i--) {
    const m = cut.moving[i]!;
    const you = m.who === 'you';
    const a = you ? null : cut.actors[m.who];
    if (!you && !a) {
      cut.moving.splice(i, 1);
      continue;
    }
    const x = you ? g.s.x : a!.x;
    const y = you ? g.s.y : a!.y;
    const dx = m.tx - x;
    const dy = m.ty - y;
    const d = Math.hypot(dx, dy);
    const sp = m.speed / 60;
    const done = d <= sp;
    const nx = done ? m.tx : x + (dx / d) * sp;
    const ny = done ? m.ty : y + (dy / d) * sp;
    if (you) {
      g.rt.px = g.s.x;
      g.rt.py = g.s.y;
      g.s.x = nx;
      g.s.y = ny;
      if (!done) g.s.dir = faceTo(dx, dy);
      if (g.rt.clip !== (done ? 'idle' : 'walk')) {
        g.rt.clip = done ? 'idle' : 'walk';
        g.rt.ct = 0;
      }
    } else {
      a!.x = nx;
      a!.y = ny;
      if (!done) a!.dir = faceTo(dx, dy);
      const clip = done ? 'idle' : 'walk';
      if (a!.clip !== clip) {
        a!.clip = clip;
        a!.ct = 0;
      }
    }
    if (done) cut.moving.splice(i, 1);
  }
}

export function stepCut(g: Game, act: boolean): void {
  const cut = g.rt.cut;
  if (!cut) {
    g.rt.mode = 'play';
    return;
  }
  const def = g.c.cutscenes[cut.id]!;
  g.rt.ct += 1 / 60;
  g.rt.px = g.s.x;
  g.rt.py = g.s.y;
  for (const k in cut.actors) {
    const a = cut.actors[k]!;
    a.px = a.x;
    a.py = a.y;
    a.ct += 1 / 60;
  }
  stepMovers(g);
  const follow = (cut as any).follow as string | null;
  if (follow && cut.actors[follow]) cut.cam = { x: cut.actors[follow]!.x, y: cut.actors[follow]!.y };
  if (g.rt.talk) return;
  if (cut.t > 0) {
    cut.t -= act ? 0.25 : 1 / 60;
    return;
  }
  // The act we were waiting on: a blocking move is finished when nobody is still walking to it.
  const cur = def.acts[cut.i - 1];
  if (cur && cur.a === 'move' && !cur.go && cut.moving.some((m) => m.who === who(g, cur.who ?? ''))) return;
  while (cut.i < def.acts.length) {
    const a = def.acts[cut.i++]!;
    if (run(g, a, false)) return;
  }
  if (cut.moving.length) return;
  endCut(g);
}

function endCut(g: Game): void {
  const cut = g.rt.cut!;
  g.rt.cut = null;
  if (NO_SKIP_FIRST.has(cut.id)) g.s.flags['seen:' + cut.id] = 1;
  // Everything the scene changed is saved at the next moment of play (review 22, point 5).
  g.rt.saveDue = true;
  g.rt.mode = 'play';
  g.rt.clip = 'idle';
  g.rt.px = g.s.x;
  g.rt.py = g.s.y;
  g.rt.dirty = true;
  if (cut.then) cut.then();
}

/** May the scene on now be skipped? Every scene may, except the finale the first time through. */
export function canSkip(g: Game): boolean {
  const cut = g.rt.cut;
  return !!cut && !(NO_SKIP_FIRST.has(cut.id) && !g.s.flags['seen:' + cut.id]);
}

/**
 * A held X skips the scene after HOLD_TO_SKIP seconds; `rt.skip` is the progress for the view's ring. X must be
 * let go before it can skip the next one. Returns true when it skipped.
 */
export function holdSkip(g: Game, held: boolean): boolean {
  const rt = g.rt;
  if (!held) {
    rt.skip = 0;
    rt.skipHeld = false;
    return false;
  }
  if (rt.skipHeld || !canSkip(g)) {
    rt.skip = 0;
    return false;
  }
  rt.skip = Math.min(1, rt.skip + 1 / (60 * HOLD_TO_SKIP));
  if (rt.skip < 1 - 1e-9) return false;
  rt.skip = 0;
  rt.skipHeld = true;
  skipCut(g);
  return true;
}

/** Finish the scene at once, keeping everything it would have changed. */
export function skipCut(g: Game): void {
  const cut = g.rt.cut;
  if (!cut) return;
  const def = g.c.cutscenes[cut.id]!;
  g.rt.talk = null;
  for (const m of cut.moving) {
    if (m.who === 'you') {
      g.s.x = m.tx;
      g.s.y = m.ty;
    }
  }
  cut.moving.length = 0;
  while (cut.i < def.acts.length) run(g, def.acts[cut.i++]!, true);
  endCut(g);
}
