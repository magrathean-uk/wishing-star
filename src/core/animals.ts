// Farm animals and pets. They are never harmed. Hold their favourite food and they follow; a fenced pen keeps them.
import { give, plotRect, take, toolTier } from './bag.ts';
import { count, hash2, rand } from './cond.ts';
import { findPath, free, solidAt } from './grid.ts';
import { DIRV, nudge, placedAt } from './hero.ts';
import { damage } from './mobs.ts';
import { place, questEvent, sticker } from './quests.ts';
import type { Actor, AnimalState, Game } from './types.ts';

interface Beast extends Actor {
  kind: 'animal';
  wait: number;
  tx: number;
  ty: number;
  hint: string;
  /** while led and stuck on something: the way round it, as x, y pairs, and which pair it is heading for */
  path?: number[] | null;
  pi?: number;
  stuck?: number;
  /** seconds she has been out of its sight while it follows (package 57a: then it catches up) */
  lost?: number;
  /** heading for its pen by itself (package 57a) */
  home?: boolean;
}

// Package 57a (G, D62: "the chicken wont follow me ... make it easier, auto follow").
/** She comes this near with the food in her bag and an animal a step asks for starts to follow her. */
export const FOLLOW_START = 5;
/** Further than this from her for CATCH_UP seconds, a follower appears beside her. */
export const LOST_R = 9;
export const CATCH_UP = 2.5;
/** She is this near its pen: it walks in by itself. */
export const PEN_NEAR = 5.5;

export function heldFood(g: Game): string | null {
  const sl = g.s.bag[g.s.hot];
  return sl ? sl.id : null;
}

/** Runtime actors for the animals in this area. */
export function refreshBeasts(g: Game): void {
  const out: Beast[] = [];
  for (const a of g.s.animals) {
    if (a.area !== g.s.area) continue;
    // (one that came through a door with her, package 74, starts afresh where it now is)
    const old = (g.rt.beasts as Beast[]).find((b) => b.k === a.k && b.area === a.area);
    out.push(
      old ?? {
        k: a.k,
        id: a.kind,
        kind: 'animal',
        area: a.area,
        x: a.x,
        y: a.y,
        px: a.x,
        py: a.y,
        dir: 'down',
        clip: 'idle',
        ct: hash2(a.k, 3, 9) * 2,
        wait: hash2(a.k, 5, 9) * 3,
        tx: a.x,
        ty: a.y,
        hint: '',
      },
    );
  }
  g.rt.beasts = out;
}

function blocked(g: Game, area: string, x: number, y: number, led: boolean): boolean {
  if (!free(g, area, x, y, 0.25)) return true;
  if (led) return false;
  const p = placedAt(g, area, Math.floor(x), Math.floor(y), 'object');
  return !!p && g.c.items[p.item]?.place?.use === 'gate';
}

/**
 * An animal whose body overlaps something solid (a fence went up beside it, or it brushed a corner) could
 * never move again, because every step from there is also "blocked". It walks to the middle of the nearest
 * clear tile first. Returns true while it is doing that.
 */
function unstick(g: Game, b: Beast): boolean {
  if (free(g, b.area, b.x, b.y, 0.25)) return false;
  const tx = Math.floor(b.x);
  const ty = Math.floor(b.y);
  let bx = 0;
  let by = 0;
  let bd = 1e9;
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -2; dx <= 2; dx++) {
      const cx = tx + dx + 0.5;
      const cy = ty + dy + 0.5;
      if (!free(g, b.area, cx, cy, 0.25)) continue;
      const d = Math.hypot(cx - b.x, cy - b.y);
      if (d < bd) {
        bd = d;
        bx = cx;
        by = cy;
      }
    }
  if (bd > 1e8) return false;
  const sp = 3 / 60;
  if (bd <= sp) {
    b.x = bx;
    b.y = by;
  } else {
    b.x += ((bx - b.x) / bd) * sp;
    b.y += ((by - b.y) / bd) * sp;
  }
  return true;
}

export function stepAnimals(g: Game): void {
  const s = g.s;
  const food = heldFood(g);
  // which kinds a lead step asks for right now, and their pens (worked out once a step, only with animals about)
  let wanted: Record<string, string> | null = null;
  if (g.rt.beasts.length)
    for (const qid in s.quests) {
      const q = s.quests[qid]!;
      const st = q.done ? undefined : g.c.quests[qid]?.steps[q.step];
      if (st?.t === 'lead') (wanted ??= {})[st.animal] = st.pen;
    }
  for (const b of g.rt.beasts as Beast[]) {
    const st = s.animals.find((a) => a.k === b.k);
    if (!st) continue;
    const def = g.c.animals[st.kind]!;
    b.px = b.x;
    b.py = b.y;
    b.ct += 1 / 60;
    // package 74 (I10): her own pet doing a trick stands where it is; indoors it lies down on the rug
    if (st.pet && petStep(g, b)) {
      st.x = b.x;
      st.y = b.y;
      continue;
    }
    if (!st.pen && unstick(g, b)) {
      st.x = b.x;
      st.y = b.y;
      continue;
    }
    const dx = s.x - b.x;
    const dy = s.y - b.y;
    const dist = Math.hypot(dx, dy) || 0.001;
    if (st.pet && st.kind === 'wolf') {
      if (dist > 14) {
        b.x = s.x - 0.8;
        b.y = s.y;
      } else if (dist > 1.6) {
        const sp = 4.3 / 60;
        const mx = (dx / dist) * sp;
        const my = (dy / dist) * sp;
        if (!blocked(g, b.area, b.x + mx, b.y, true)) b.x += mx;
        if (!blocked(g, b.area, b.x, b.y + my, true)) b.y += my;
        b.dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'down';
        setClip(b, 'walk');
      } else setClip(b, 'idle');
      // He helps in a fight: a nip at any mob that comes close, about once every 2 seconds.
      b.wait -= 1 / 60;
      if (b.wait <= 0) {
        b.wait = 2;
        for (const m of g.rt.mobs) {
          // He leaves creepers alone: a nip stops the fuse, and she sometimes needs that pop to open a cracked rock.
          if (m.gone || m.calm || g.c.mobs[m.id]?.role !== 'hostile' || g.c.mobs[m.id]?.ai === 'creeper') continue;
          if (Math.hypot(m.x - b.x, m.y - b.y) < 2.2) {
            damage(g, m, 1, m.x - b.x, m.y - b.y);
            setClip(b, 'hop');
            break;
          }
        }
      }
      st.x = b.x;
      st.y = b.y;
      continue;
    }
    // Package 57a: an animal a lead step asks for follows her by itself once she comes near with its food anywhere
    // in her bag, and keeps following wherever she goes; any other animal follows the food she holds, as before.
    const pen = wanted?.[st.kind] ?? '';
    const has = !!pen && count(g, def.food) > 0;
    const wants = !st.pen && !st.pet && (has ? st.led || dist < FOLLOW_START : food === def.food && dist < 6.5);
    if (wants && !st.led) {
      st.led = true;
      g.rt.leading = st.k;
      g.ev.push({ t: 'sfx', id: def.sfx, x: b.x, y: b.y });
      g.ev.push({ t: 'fx', id: 'heart', x: b.x, y: b.y - 0.8 });
    } else if (!wants && st.led) {
      st.led = false;
      if (g.rt.leading === st.k) g.rt.leading = 0;
    }
    if (st.led) {
      leadStep(g, b, dist, pen);
      const inPen = penAt(g, b.area, b.x, b.y);
      if (inPen) {
        const pen = inPen;
        b.home = false;
        b.path = null;
        st.pen = pen;
        st.led = false;
        st.hx = b.x;
        st.hy = b.y;
        if (g.rt.leading === st.k) g.rt.leading = 0;
        g.ev.push({ t: 'fx', id: 'confetti', x: b.x, y: b.y });
        g.ev.push({ t: 'sfx', id: def.sfx, x: b.x, y: b.y });
        g.ev.push({ t: 'toast', kind: 'info', text: 'animal_home' });
        g.ev.push({ t: 'act', kind: 'lead', id: st.kind });
        sticker(g, 'animal_' + st.kind);
        questEvent(g, 'lead', st.kind, 1, pen);
      }
    } else {
      b.wait -= 1 / 60;
      if (b.wait <= 0) {
        b.wait = 2 + rand(g) * 5;
        const r = st.pen ? 1.6 : 3;
        b.tx = st.hx + (rand(g) * 2 - 1) * r;
        b.ty = st.hy + (rand(g) * 2 - 1) * r;
        if (rand(g) < 0.25) setClip(b, 'hop');
      }
      const mx = b.tx - b.x;
      const my = b.ty - b.y;
      const d = Math.hypot(mx, my);
      if (d > 0.15) {
        const sp = 1.1 / 60;
        const sx = (mx / d) * sp;
        const sy = (my / d) * sp;
        if (!blocked(g, b.area, b.x + sx, b.y + sy, false)) {
          b.x += sx;
          b.y += sy;
          b.dir = Math.abs(mx) > Math.abs(my) ? (mx < 0 ? 'left' : 'right') : my < 0 ? 'up' : 'down';
          if (b.clip !== 'hop') setClip(b, 'walk');
        } else {
          b.tx = b.x;
          b.ty = b.y;
        }
      } else if (b.clip !== 'hop' || b.ct > 0.6) setClip(b, 'idle');
    }
    st.x = b.x;
    st.y = b.y;
  }
}
/**
 * One step of an animal she leads: it keeps up with her (a little quicker than she walks when it falls behind),
 * finds its way round fences, trees and water, appears beside her when it has been out of sight a moment, and
 * walks into its pen by itself once she brings it near (package 57a).
 */
function leadStep(g: Game, b: Beast, dist: number, pen: string): void {
  const s = g.s;
  const a = g.c.areas[b.area]!;
  // near the pen (her and it): it goes in by itself, through the gap or the gate
  const home = pen ? place(g, pen) : null;
  const goHome =
    !!home &&
    home.area === b.area &&
    Math.hypot(home.x + 0.5 - s.x, home.y + 0.5 - s.y) < PEN_NEAR &&
    Math.hypot(home.x + 0.5 - b.x, home.y + 0.5 - b.y) < PEN_NEAR + 3;
  if (goHome !== !!b.home) {
    b.home = goHome;
    b.path = null;
    b.stuck = 0;
  }
  // left behind: after a moment out of sight it is there beside her
  if (dist > LOST_R) {
    b.lost = (b.lost ?? 0) + 1 / 60;
    if (b.lost > CATCH_UP) {
      b.lost = 0;
      const [fx, fy] = DIRV[s.dir];
      for (const [ox, oy] of [
        [-fx, -fy],
        [-fy, fx],
        [fy, -fx],
        [fx, fy],
      ] as const) {
        const x = s.x + ox * 1.2;
        const y = s.y + oy * 1.2;
        if (free(g, b.area, x, y, 0.25)) {
          b.x = b.px = x;
          b.y = b.py = y;
          b.path = null;
          g.ev.push({ t: 'fx', id: 'puff', x, y });
          g.ev.push({ t: 'sfx', id: g.c.animals[b.id]?.sfx ?? 'pop', x, y });
          return;
        }
      }
    }
  } else b.lost = 0;
  let tx = s.x;
  let ty = s.y;
  if (b.home && home) {
    tx = home.x + 0.5;
    ty = home.y + 0.5;
  }
  const far = Math.hypot(tx - b.x, ty - b.y);
  if (!b.home && far <= 1.35) {
    b.path = null;
    setClip(b, 'idle');
    return;
  }
  // quicker than her when it has fallen behind, so it never loses her on a straight walk
  const sp = (dist > 2.6 ? 5.2 : 3.9) / 60;
  let gx = tx - b.x;
  let gy = ty - b.y;
  if (b.path) {
    // The path is a flat list of x, y pairs (see findPath in grid.ts).
    const i = (b.pi ?? 0) * 2;
    if (i + 1 >= b.path.length || (!b.home && far < 1.8)) b.path = null;
    else {
      gx = b.path[i]! + 0.5 - b.x;
      gy = b.path[i + 1]! + 0.5 - b.y;
      if (Math.hypot(gx, gy) < 0.2) {
        b.pi = (b.pi ?? 0) + 1;
        gx = tx - b.x;
        gy = ty - b.y;
      }
    }
  }
  const gl = Math.hypot(gx, gy) || 0.001;
  const mx = (gx / gl) * Math.min(sp, gl);
  const my = (gy / gl) * Math.min(sp, gl);
  const ox = b.x;
  const oy = b.y;
  if (!blocked(g, b.area, b.x + mx, b.y, true)) b.x += mx;
  if (!blocked(g, b.area, b.x, b.y + my, true)) b.y += my;
  b.stuck = Math.hypot(b.x - ox, b.y - oy) < sp * 0.5 ? (b.stuck ?? 0) + 1 : 0;
  // Stuck on a fence corner or a wall (or not on a way yet): it walks round by the shortest way instead of pushing,
  // so a child never has to work an animal loose. Asked once a few steps, not every step.
  if (b.stuck > 8 && !b.path) {
    b.stuck = 0;
    const way = findPath(
      g.rt.solid[b.area]!,
      a.w,
      a.h,
      Math.floor(b.x),
      Math.floor(b.y),
      Math.floor(tx),
      Math.floor(ty),
      b.home ? 0 : 1,
      6000,
    );
    b.path = way && way.length >= 2 && way.length < 200 ? way : null;
    b.pi = 0;
  } else if (b.stuck > 40) {
    // still stuck on its way: start the way again from where it is
    b.path = null;
    b.stuck = 9;
  }
  b.dir = Math.abs(gx) > Math.abs(gy) ? (gx < 0 ? 'left' : 'right') : gy < 0 ? 'up' : 'down';
  setClip(b, 'walk');
}

function setClip(b: Beast, clip: Beast['clip']): void {
  if (b.clip !== clip) {
    b.clip = clip;
    b.ct = 0;
  }
}

/** Which pen is this spot in? Named pens on the map, or any fenced-off part of the home plot. */
export function penAt(g: Game, area: string, x: number, y: number): string | null {
  const a = g.c.areas[area]!;
  for (const name in a.places) {
    if (!name.startsWith('pen_')) continue;
    const p = a.places[name]!;
    const r = p.r ?? 1.5;
    if (Math.abs(x - (p.x + 0.5)) <= r && Math.abs(y - (p.y + 0.5)) <= r) {
      const need = g.c.strings['penflag:' + name];
      if (need && !g.s.flags[need]) continue;
      return name;
    }
  }
  if (area !== 'island') return null;
  const plot = plotRect(g);
  const sx = Math.floor(x);
  const sy = Math.floor(y);
  if (sx < plot.x || sy < plot.y || sx >= plot.x + plot.w || sy >= plot.y + plot.h) return null;
  // Flood out from the animal: if the space is closed in by fences and gates within 80 tiles, it is a pen.
  const seen = new Set<number>();
  const stack = [sy * 1000 + sx];
  seen.add(stack[0]!);
  while (stack.length) {
    const k = stack.pop()!;
    const cx = k % 1000;
    const cy = (k - cx) / 1000;
    if (cx < plot.x || cy < plot.y || cx >= plot.x + plot.w || cy >= plot.y + plot.h) return null;
    if (seen.size > 80) return null;
    for (let d = 0; d < 4; d++) {
      const nx = cx + (d === 0 ? 1 : d === 1 ? -1 : 0);
      const ny = cy + (d === 2 ? 1 : d === 3 ? -1 : 0);
      const nk = ny * 1000 + nx;
      if (seen.has(nk)) continue;
      if (solidAt(g, area, nx, ny)) continue;
      const p = placedAt(g, area, nx, ny, 'object');
      if (p && g.c.items[p.item]?.place?.use === 'gate') continue;
      seen.add(nk);
      stack.push(nk);
    }
  }
  return 'pen_home';
}

export const ANIMAL_REACH = 1.75;
/** After Space on an animal it stands still this long, so it cannot wander out of reach mid-pat. */
export const ANIMAL_HOLD = 1.5;

export function animalNear(g: Game): Beast | null {
  const s = g.s;
  const [fx, fy] = DIRV[s.dir];
  // Of the animals in reach, one with a gift ready comes first (in a full pen she must not pat the wrong cow
  // for ever); otherwise the nearest.
  let best: Beast | null = null;
  let bestReady = false;
  let bestD = 1e9;
  for (const b of g.rt.beasts as Beast[]) {
    const dx = b.x - s.x;
    const dy = b.y - s.y;
    const d2 = dx * dx + dy * dy;
    // An animal wanders, so its reach is wider than a person's (npcs.ts, 1.55 tiles): 1.75 tiles in front of her
    // (within 60 degrees) and any facing within 1 tile (package 51). The wolf at her heels keeps the old short
    // reach in front only, or he would take Space from everything she does.
    const st = s.animals.find((a) => a.k === b.k);
    // one that follows her (package 57a) needs no key, so it never takes Space from what she is doing
    if (!st || st.led) continue;
    const ahead = dx * fx + dy * fy;
    if (st.pet && st.kind === 'wolf') {
      if (d2 > 1.7 || ahead < 0.5 * Math.sqrt(d2)) continue;
    } else {
      if (d2 > ANIMAL_REACH * ANIMAL_REACH) continue;
      if (d2 > 1 && ahead < 0.5 * Math.sqrt(d2)) continue;
    }
    const def = g.c.animals[st.kind]!;
    const ready = !!(st.ready && def.gives);
    b.hint = ready ? 'collect' : 'pat';
    if (best && bestReady && !ready) continue;
    if (!best || (ready && !bestReady) || d2 < bestD) {
      best = b;
      bestReady = ready;
      bestD = d2;
    }
  }
  return best;
}

// ---------------------------------------------------------------- her pet indoors, and its tricks (package 74, I10)
// Her pet comes through a door with her (the wolf from anywhere, the cat when it is near her), lies down on a rug or
// a mat in the room (else beside the door, off the way in) and comes out with her. Space on her own pet, when it has
// nothing to give, does a trick in turn: sit, spin, a little jump, with its word and a heart. Animals are never solid
// to her, so a pet can never block a door or a path.

/** A pet this near her when she goes through a door comes too (the wolf always does). */
export const PET_COME = 8;
/** How long a trick lasts, in seconds; the tricks in turn (1 sit, 2 spin, 3 jump). */
export const TRICK_SECS = 1.2;
export const TRICKS = 3;
const SPIN: readonly Beast['dir'][] = ['down', 'right', 'up', 'left'];

/** Her pets come through a door with her: into a room when near her, and out of a room always. */
export function petsFollow(g: Game, from: string, to: string, ox: number, oy: number): void {
  const s = g.s;
  const fromIn = !!g.c.areas[from]?.indoor;
  const toIn = !!g.c.areas[to]?.indoor;
  for (const a of s.animals) {
    if (!a.pet || a.area !== from) continue;
    if (a.kind !== 'wolf' && !fromIn && !(toIn && Math.hypot(a.x - ox, a.y - oy) < PET_COME)) continue;
    a.area = to;
    a.x = s.x;
    a.y = s.y;
    // beside her, not on her
    for (const [dx, dy] of [
      [-0.8, 0],
      [0.8, 0],
      [0, -0.8],
      [0, 0.8],
    ] as const)
      if (free(g, to, s.x + dx, s.y + dy, 0.25)) {
        a.x = s.x + dx;
        a.y = s.y + dy;
        break;
      }
  }
}

/** Where a pet lies down in a room: the middle of a rug or a mat (on the map or put down by her), else the free floor nearest the middle. */
export function petRest(g: Game, area: string): { x: number; y: number } | null {
  const a = g.c.areas[area]!;
  for (const o of a.objects)
    if (/(^|_)(rug|mat|playmat)(_|$)/.test(o.type)) {
      const t = g.c.objects[o.type];
      return { x: o.x + (t?.w ?? 1) / 2, y: o.y + (t?.h ?? 1) / 2 };
    }
  for (const p of g.s.placed) {
    if (p.area !== area || !/(^|_)(rug|mat)(_|$)/.test(p.item)) continue;
    const d = g.c.items[p.item]?.place;
    return { x: p.x + (d?.w ?? 1) / 2, y: p.y + (d?.h ?? 1) / 2 };
  }
  // package 78: no rug or mat: the free floor tile nearest the middle of the room's floor, never the tile in front of
  // a door (or beside one) and never under a thing
  const door = a.doors[0];
  if (!door) return null;
  const covered = new Set<number>();
  const cover = (x: number, y: number, w: number, h: number) => {
    for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) covered.add(ty * a.w + tx);
  };
  for (const o of a.objects) {
    const t = g.c.objects[o.type];
    cover(o.x, o.y, t?.w ?? 1, t?.h ?? 1);
  }
  for (const p of g.s.placed) {
    if (p.area !== area) continue;
    const d = g.c.items[p.item]?.place;
    cover(p.x, p.y, d?.w ?? 1, d?.h ?? 1);
  }
  const open = (x: number, y: number) =>
    !solidAt(g, area, x, y) && !covered.has(y * a.w + x) && free(g, area, x + 0.5, y + 0.5, 0.3);
  // the middle of the floor: the middle of the box round every tile one can stand on
  let x0 = a.w;
  let y0 = a.h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < a.h; y++)
    for (let x = 0; x < a.w; x++)
      if (!solidAt(g, area, x, y)) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
  if (x1 < 0) return null;
  const mx = (x0 + x1 + 1) / 2;
  const my = (y0 + y1 + 1) / 2;
  let best: { x: number; y: number } | null = null;
  let bd = 1e9;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      if (!open(x, y) || a.doors.some((dr) => Math.abs(dr.x - x) <= 1 && Math.abs(dr.y - y) <= 1)) continue;
      const d = Math.hypot(x + 0.5 - mx, y + 0.5 - my);
      if (d < bd - 1e-9) {
        bd = d;
        best = { x: x + 0.5, y: y + 0.5 };
      }
    }
  return best;
}

/** Her pet's own step: a trick, or indoors the walk to its rest. True when it did its step here. */
function petStep(g: Game, b: Beast): boolean {
  if (b.trick) {
    b.trickT = (b.trickT ?? 0) + 1 / 60;
    if (b.trick === 2) b.dir = SPIN[Math.floor(b.trickT / 0.15) % 4]!;
    if (b.trickT >= TRICK_SECS) {
      b.trick = 0;
      b.trickT = 0;
      b.dir = 'down';
      setClip(b, 'idle');
    }
    return true;
  }
  if (!g.c.areas[b.area]?.indoor) {
    b.rest = false;
    return false;
  }
  if (b.rest) {
    setClip(b, 'idle');
    // a little sleep now and then
    if (Math.floor(b.ct * 60) % 360 === 0) g.ev.push({ t: 'fx', id: 'zzz', x: b.x, y: b.y - 0.6 });
    return true;
  }
  const to = petRest(g, b.area);
  if (!to) {
    b.rest = true;
    return true;
  }
  if (b.path === undefined) {
    const a = g.c.areas[b.area]!;
    const way = findPath(
      g.rt.solid[b.area]!,
      a.w,
      a.h,
      Math.floor(b.x),
      Math.floor(b.y),
      Math.floor(to.x),
      Math.floor(to.y),
      0,
      2000,
    );
    b.path = way ?? null;
    b.pi = 0;
  }
  // along the way, then to the spot itself; a pet is never solid, so a straight last step is fine
  let gx = to.x;
  let gy = to.y;
  const i = (b.pi ?? 0) * 2;
  if (b.path && i + 1 < b.path.length) {
    gx = b.path[i]! + 0.5;
    gy = b.path[i + 1]! + 0.5;
  }
  const dx = gx - b.x;
  const dy = gy - b.y;
  const d = Math.hypot(dx, dy);
  const sp = 2.6 / 60;
  if (d <= sp) {
    b.x = gx;
    b.y = gy;
    if (b.path && i + 1 < b.path.length) b.pi = (b.pi ?? 0) + 1;
    else {
      b.rest = true;
      b.dir = 'down';
      setClip(b, 'idle');
    }
  } else {
    b.x += (dx / d) * sp;
    b.y += (dy / d) * sp;
    b.dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'down';
    setClip(b, 'walk');
  }
  return true;
}

/** Space on her own pet with nothing to give: the next trick in turn, its word and a heart. */
function petTrick(g: Game, b: Beast | undefined, kind: string, x: number, y: number): void {
  const n = g.rt.tricks ?? 0;
  g.rt.tricks = n + 1;
  if (b) {
    b.trick = (n % TRICKS) + 1;
    b.trickT = 0;
    setClip(b, b.trick === 1 ? 'look' : b.trick === 3 ? 'hop' : 'idle');
  }
  g.ev.push({ t: 'fx', id: 'heart', x, y: y - 0.8 });
  const word = animalWord(g, kind);
  if (word) g.ev.push({ t: 'fx', id: 'word', x, y: y - 1.1, item: word });
}

/**
 * Package 71 (D78): the word an animal says when stroked: the strings line 'say:<kind>', or '' when it has none.
 * Package 74 (D79, idea I1): every animal kind has one (tests/joys.test.ts checks it).
 */
export function animalWord(g: Game, kind: string): string {
  return g.c.strings[`say:${kind}`] ? `say:${kind}` : '';
}

export function animalAct(g: Game, k: number): void {
  const st = g.s.animals.find((a) => a.k === k);
  if (!st) return;
  const b = (g.rt.beasts as Beast[]).find((x) => x.k === k);
  if (b) {
    b.tx = b.x;
    b.ty = b.y;
    b.wait = Math.max(b.wait, ANIMAL_HOLD);
  }
  const def = g.c.animals[st.kind]!;
  if (st.ready && def.gives) {
    if (def.gives.needs && count(g, def.gives.needs) === 0 && toolTier(g, 'bucket') === 0) {
      nudge(g, 'need_bucket');
      return;
    }
    st.ready = false;
    give(g, def.gives.item, 1);
    g.ev.push({ t: 'fx', id: 'pop', x: st.x, y: st.y, item: def.gives.item, n: 1 });
    g.ev.push({ t: 'act', kind: 'collect', id: def.gives.item });
  } else if (st.pet) {
    // package 74 (I10): her own pet does a trick
    petTrick(g, b, st.kind, st.x, st.y);
    g.ev.push({ t: 'act', kind: 'pat', id: st.kind });
  } else {
    g.ev.push({ t: 'fx', id: 'heart', x: st.x, y: st.y - 0.8 });
    g.ev.push({ t: 'act', kind: 'pat', id: st.kind });
    // package 71 (D78): a stroked animal says its word, which pops up over it for a moment
    const word = animalWord(g, st.kind);
    if (word) g.ev.push({ t: 'fx', id: 'word', x: st.x, y: st.y - 1.1, item: word });
  }
  g.ev.push({ t: 'sfx', id: def.sfx, x: st.x, y: st.y });
}

/** Morning: every animal in a pen has something for her. */
export function animalsMorning(g: Game): void {
  for (const a of g.s.animals) if (a.pen && g.c.animals[a.kind]?.gives) a.ready = true;
}

/** The nearest wild animal of a kind becomes her pet. A wolf follows her everywhere; a cat goes to live at the cottage. */
export function adoptPet(g: Game, kind: string): void {
  const s = g.s;
  if (s.pets.some((p) => p.kind === kind)) return;
  let best: AnimalState | null = null;
  let bestD = 1e9;
  for (const a of s.animals) {
    if (a.kind !== kind || a.pet) continue;
    const d = a.area === s.area ? Math.hypot(a.x - s.x, a.y - s.y) : 1e6;
    if (d < bestD) {
      bestD = d;
      best = a;
    }
  }
  if (!best) {
    best = { k: s.nextK++, kind, area: s.area, x: s.x + 1, y: s.y, hx: s.x + 1, hy: s.y };
    s.animals.push(best);
  }
  best.pet = true;
  best.pen = 'pet';
  s.pets.push({ kind, name: g.c.animals[kind]?.name ?? kind });
  if (kind === 'cat') {
    const home = place(g, 'mailbox');
    if (home) {
      best.area = home.area;
      best.x = best.hx = home.x + 2.5;
      best.y = best.hy = home.y + 0.5;
    }
  }
  sticker(g, 'animal_' + kind);
  g.ev.push({ t: 'fx', id: 'heart', x: best.x, y: best.y - 0.8, n: 4 });
  g.ev.push({ t: 'toast', kind: 'info', text: kind === 'wolf' ? 'pet_wolf' : 'pet_cat' });
  g.rt.dirty = true;
}

export function addAnimal(g: Game, kind: string, at: string): AnimalState | null {
  const p = place(g, at);
  if (!p) return null;
  const a: AnimalState = {
    k: g.s.nextK++,
    kind,
    area: p.area,
    x: p.x + 0.5,
    y: p.y + 0.5,
    hx: p.x + 0.5,
    hy: p.y + 0.5,
  };
  g.s.animals.push(a);
  return a;
}
/** More animals of a kind join the herd nearest a pen (the herd places are named herd_<kind>_<n>). */
export function restock(g: Game, kind: string, pen: string, n: number): void {
  const to = place(g, pen);
  if (!to) return;
  let best = '';
  let bd = Infinity;
  const a = g.c.areas[to.area]!;
  for (const name in a.places) {
    if (!name.startsWith('herd_' + kind + '_')) continue;
    const p = a.places[name]!;
    const d = Math.hypot(p.x - to.x, p.y - to.y);
    if (d < bd) {
      bd = d;
      best = name;
    }
  }
  if (!best) return;
  for (let i = 0; i < n; i++) {
    const b = addAnimal(g, kind, best);
    if (b) b.x += (i % 3) - 1;
  }
  g.rt.dirty = true;
}
export { take };
