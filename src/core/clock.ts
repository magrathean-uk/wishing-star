// The day clock: 14 minutes a day, sleep to skip to morning, and everything that happens overnight.
import { animalsMorning } from './animals.ts';
import { DAWN_AT, DAY_LEN, DUSK_AT, NIGHT_AT, rand, test } from './cond.ts';
import { cropsMorning } from './farm.ts';
import { shieldBack } from './gear.ts';
import { enterArea, nudge } from './hero.ts';
import { dropDen, islandMorning } from './island.ts';
import { growthTomorrow } from './pots.ts';
import { fullBook, objective, place, questEvent, refreshQuests } from './quests.ts';
import { planSurprise, stepPostRound, stepSurprise } from './surprises.ts';
import { fill } from './talk.ts';
import { free } from './grid.ts';
import { HALF } from './walk.ts';
import type { Game } from './types.ts';

export function stepClock(g: Game): void {
  const s = g.s;
  const before = s.time;
  s.time += 1 / 60;
  if (before < DUSK_AT && s.time >= DUSK_AT) {
    g.ev.push({ t: 'sfx', id: 'dusk' });
    g.rt.dirty = true;
  }
  // package 60: "It is getting dark" only once it plainly is (half way to night) and she is outside to see it
  const DARK_SAY = (DUSK_AT + NIGHT_AT) / 2;
  if (before < DARK_SAY && s.time >= DARK_SAY && !g.c.areas[s.area]?.indoor && !g.c.areas[s.area]?.dark)
    nudge(g, 'dusk_hint', 6);
  if (before < NIGHT_AT - 30 && s.time >= NIGHT_AT - 30) g.rt.dirty = true;
  if (before < NIGHT_AT && s.time >= NIGHT_AT) {
    g.ev.push({ t: 'sfx', id: 'night' });
    if (!s.flags.starnight && s.shards >= 1 && rand(g) < 0.4) {
      s.flags.starnight = 1;
      g.ev.push({ t: 'fx', id: 'shootingstar', x: s.x, y: s.y });
      g.ev.push({ t: 'toast', kind: 'info', text: 'shooting_star' });
    }
  }
  if (before < DAWN_AT + 20 && s.time >= DAWN_AT + 20) {
    g.rt.dirty = true;
    g.ev.push({ t: 'sfx', id: 'dawn' });
  }
  if (s.time >= DAY_LEN) newDay(g, false);
  stepSurprise(g);
  stepPostRound(g);
}

/** Up to three things to look forward to, for the "Tomorrow" card at bedtime. */
export function tomorrow(g: Game): string[] {
  const s = g.s;
  const S = g.c.strings;
  const out: string[] = [];
  const add = (key: string, extra = '') => {
    const t = S[key];
    if (t && out.length < 3) out.push(fill(g, t.replace('{x}', extra)));
  };
  for (const k in s.flags) if (k.startsWith('clue:') && s.flags[k] === 1) add('tm_' + k.replace(':', ''));
  // a quest may leave one line for tonight's card (a flag "tm:<key>", cleared in the morning)
  for (const k in s.flags) if (k.startsWith('tm:')) add('tm_' + k.slice(3));
  for (const k in s.flags)
    if (k.startsWith('mq:')) {
      add('tm_mail');
      break;
    }
  for (const c of s.crops)
    if (c.age + growthTomorrow(c) >= g.c.items[c.seed]!.grows!.days) {
      add('tm_crops');
      break;
    }
  if (s.xmas && (s.counts.presents ?? 0) < 12 && s.flags.presents) add('tm_present');
  if (s.animals.some((a) => a.pen)) add('tm_animals');
  if (s.flags.starnight) add('tm_star');
  for (const id of g.c.questOrder) {
    const def = g.c.quests[id]!;
    if (
      (def.kind === 'side' || def.kind === 'friend') &&
      !s.quests[id] &&
      !s.flags['off:' + id] &&
      test(g, def.requires)
    ) {
      add('tm_help');
      break;
    }
  }
  // the card must be true: while the goal is the bed she is in, "Next: go to bed" is not said (package 46)
  const tq = s.tracked ? s.quests[s.tracked] : undefined;
  const tst = s.tracked && tq && !tq.done ? g.c.quests[s.tracked]?.steps[tq.step] : undefined;
  if (s.tracked && tst?.t !== 'sleep') add('tm_story', objective(g, s.tracked));
  if (out.length === 0) add('tm_default');
  return out;
}

/** Go to bed (or be carried there). Shows the card, then it is morning. */
export function sleep(g: Game, carried = false): void {
  const S = g.c.strings;
  const then = () => {
    newDay(g, true);
    if (carried) {
      const bed = place(g, 'bed_side');
      if (bed) enterArea(g, bed.area, bed.x + 0.5, bed.y + 0.5, 'down');
    }
    wakeUp(g);
  };
  if (carried) {
    then();
    return;
  }
  g.rt.card = { kind: 'tomorrow', title: S.tm_title ?? '', lines: tomorrow(g), t: 0, then };
  g.rt.mode = 'card';
  g.rt.clip = 'sleep';
  g.rt.ct = 0;
  g.ev.push({ t: 'sfx', id: 'lullaby' });
}

/**
 * Package 68: the Space that closes the morning card must never put her to bed again. The bed takes no Space for
 * 3 seconds and she stands a tile clear of it, so Space beside it is not the next thing she does.
 */
export const BED_REST = 3;
function wakeUp(g: Game): void {
  const s = g.s;
  g.rt.bedT = BED_REST;
  let bed: { x: number; y: number; w: number; h: number } | null = null;
  for (const p of s.placed) {
    if (p.area !== s.area) continue;
    const def = g.c.items[p.item]?.place;
    if (def?.use !== 'bed') continue;
    const w = p.rot && p.rot % 2 ? (def.h ?? 1) : (def.w ?? 1);
    const h = p.rot && p.rot % 2 ? (def.w ?? 1) : (def.h ?? 1);
    const d = Math.hypot(p.x + w / 2 - s.x, p.y + h / 2 - s.y);
    if (d < 3 && (!bed || d < Math.hypot(bed.x + bed.w / 2 - s.x, bed.y + bed.h / 2 - s.y)))
      bed = { x: p.x, y: p.y, w, h };
  }
  if (!bed) return;
  // the nearest free tile two tiles from the bed's edge (one empty tile between)
  let best: [number, number] | null = null;
  let bd = 1e9;
  for (let ty = bed.y - 2; ty <= bed.y + bed.h + 1; ty++)
    for (let tx = bed.x - 2; tx <= bed.x + bed.w + 1; tx++) {
      const gx = Math.max(bed.x - tx, tx - (bed.x + bed.w - 1), 0);
      const gy = Math.max(bed.y - ty, ty - (bed.y + bed.h - 1), 0);
      if (Math.max(gx, gy) !== 2 || !free(g, s.area, tx + 0.5, ty + 0.5, HALF)) continue;
      // (not through a wall: the way there is clear)
      if (!free(g, s.area, (tx + 0.5 + s.x) / 2, (ty + 0.5 + s.y) / 2, 0.2)) continue;
      const d = Math.hypot(tx + 0.5 - s.x, ty + 0.5 - s.y);
      if (d < bd) {
        bd = d;
        best = [tx, ty];
      }
    }
  if (best) {
    s.x = best[0] + 0.5;
    s.y = best[1] + 0.5;
    s.dir = 'down';
  }
}

export function newDay(g: Game, slept: boolean): void {
  const s = g.s;
  s.day++;
  s.time = 0;
  for (const id in s.nodes) delete s.nodes[id];
  for (const k in s.flags) {
    if (k.startsWith('hit:') || k.startsWith('waved:') || k.startsWith('tm:')) delete s.flags[k];
    else if (k.startsWith('clue:') && s.flags[k] === 1) s.flags[k] = 2;
  }
  cropsMorning(g);
  animalsMorning(g);
  s.bought = {};
  fullBook(g);
  let post = false;
  for (const k in s.flags) {
    if (!k.startsWith('mq:')) continue;
    delete s.flags[k];
    s.inbox.push(k.slice(3));
    post = true;
  }
  if (post) {
    s.flags.post_today = s.day;
    g.ev.push({ t: 'toast', kind: 'mail', text: 'post_here' });
    g.ev.push({ t: 'reward', kind: 'mail', id: 'day' + s.day });
  }
  if (s.flags.starnight) {
    delete s.flags.starnight;
    for (let i = 1; i <= 3; i++) {
      const p = place(g, 'star_' + ((s.day + i) % 6));
      if (p) s.drops.push({ area: p.area, x: p.x + 0.5, y: p.y + 0.5, id: 'star_fragment', n: 1 });
    }
  }
  if (s.shards >= 3 && rand(g) < 0.3) s.flags.trader = s.day;
  else delete s.flags.trader;
  if (slept) {
    s.hp = s.maxHp;
    shieldBack(g);
    g.rt.clip = 'idle';
    questEvent(g, 'sleep', '');
  }
  dropDen(g);
  islandMorning(g);
  refreshQuests(g);
  planSurprise(g);
  g.rt.dirty = true;
  g.ev.push({ t: 'sfx', id: 'morning' });
  g.ev.push({ t: 'save' });
  g.ev.push({ t: 'act', kind: 'morning' });
}
