// Rare surprises (design section 4): a Minion stampede across the Square, a Kuromi prank and a chicken jockey.
// Also the post round (design section 2): on a morning with post, Paddington carries it to her mailbox.
// Some mornings the save's own random numbers pick a surprise for that day, in the morning or the evening. It
// plays only when she is near its spot, in free play, with no fight close by, and gives a sticker. At most one a
// day; one she has not seen yet comes first, and none waits more than a few days once it can happen.
import { DUSK_AT, NIGHT_AT, rand, test } from './cond.ts';
import { startCut } from './cutscene.ts';
import { place, sticker } from './quests.ts';
import type { Cond, Game } from './types.ts';

export interface Surprise {
  id: string;
  /** the cutscene in src/data/scenes.ts */
  cut: string;
  /** the place it happens near, and how near she must be (tiles) */
  near: string;
  r: number;
  /** when it can happen at all */
  when: Cond;
  /** the sticker it gives */
  sticker: string;
}

export const SURPRISES: Surprise[] = [
  {
    id: 'stampede',
    cut: 'surprise_stampede',
    near: 'great_tree',
    r: 11,
    when: { flag: 'minions_here' },
    sticker: 'surprise_stampede',
  },
  {
    id: 'prank',
    cut: 'surprise_prank',
    near: 'kuromi',
    r: 10,
    when: { shards: 4, notHero: 'kuromi' },
    sticker: 'surprise_prank',
  },
  { id: 'jockey', cut: 'surprise_jockey', near: 'sign_home', r: 10, when: { done: 'ch1' }, sticker: 'surprise_jockey' },
];

/** The first day a surprise can come, the chance of one on a later day, and the longest an unseen one waits. */
export const FIRST_DAY = 3;
export const CHANCE = 0.3;
export const MAX_WAIT = 4;
/** The two times of day a surprise waits for: a morning and an evening, in clock seconds. */
export const SLOTS: [number, number][] = [
  [30, 300],
  [DUSK_AT - 80, NIGHT_AT - 35],
];

const NONE = 0;

/** Each morning: maybe pick today's surprise. Draws from the save's random numbers only on surprise-able days. */
export function planSurprise(g: Game): void {
  const s = g.s;
  delete s.counts.surpWhich;
  if (s.day < FIRST_DAY) return;
  const ready = SURPRISES.map((x, i) => ({ x, i })).filter(({ x }) => test(g, x.when));
  if (!ready.length) return;
  // how long each unseen, ready surprise has waited
  for (const { x } of ready)
    if (!s.counts['surpSeen:' + x.id]) s.counts['surpWait:' + x.id] = (s.counts['surpWait:' + x.id] ?? 0) + 1;
  const unseen = ready.filter(({ x }) => !s.counts['surpSeen:' + x.id]);
  const overdue = unseen.some(({ x }) => (s.counts['surpWait:' + x.id] ?? 0) >= MAX_WAIT);
  if (!overdue && rand(g) >= CHANCE) return;
  const pool = unseen.length ? unseen : ready;
  const pick = pool[Math.floor(rand(g) * pool.length)]!;
  s.counts.surpWhich = pick.i + 1;
  s.counts.surpSlot = rand(g) < 0.5 ? 0 : 1;
}

/** Today's surprise, if it has not happened yet. */
export function surpriseToday(g: Game): Surprise | null {
  const i = g.s.counts.surpWhich ?? NONE;
  return i > 0 ? (SURPRISES[i - 1] ?? null) : null;
}

/** Every step: play today's surprise when its time, its place and a quiet moment all line up. */
export function stepSurprise(g: Game): void {
  const sp = surpriseToday(g);
  if (!sp) return;
  const s = g.s;
  const [from, to] = SLOTS[s.counts.surpSlot ?? 0]!;
  if (s.time < from || s.time > to) return;
  const rt = g.rt;
  if (rt.mode !== 'play' || rt.talk || rt.cut || rt.mini || rt.q.length || rt.paused) return;
  if (!test(g, sp.when)) return;
  const p = place(g, sp.near);
  if (!p || p.area !== s.area || Math.hypot(s.x - p.x - 0.5, s.y - p.y - 0.5) > sp.r) return;
  // never in a fight: no awake hostile mob within 10 tiles
  for (const m of rt.mobs) {
    const role = g.c.mobs[m.id]?.role;
    if (m.gone || m.calm || m.area !== s.area || (role !== 'hostile' && role !== 'boss')) continue;
    if (Math.hypot(m.x - s.x, m.y - s.y) < 10) return;
  }
  delete s.counts.surpWhich;
  s.counts['surpSeen:' + sp.id] = (s.counts['surpSeen:' + sp.id] ?? 0) + 1;
  s.counts.surpLast = s.day;
  startCut(g, sp.cut, () => {
    sticker(g, sp.sticker);
    g.ev.push({ t: 'reward', kind: 'secret', id: 'surprise:' + sp.id });
  });
}

/** The post round: on a morning with post, the first time she is near home, Paddington walks it to the mailbox. */
export const POST_MORNING_END = 360;
export function stepPostRound(g: Game): void {
  const s = g.s;
  if (s.flags.post_today !== s.day || s.counts.postRound === s.day || s.time > POST_MORNING_END) return;
  const rt = g.rt;
  if (rt.mode !== 'play' || rt.talk || rt.cut || rt.mini || rt.q.length || rt.paused) return;
  const p = place(g, 'mailbox');
  if (!p || p.area !== s.area || Math.hypot(s.x - p.x - 0.5, s.y - p.y - 0.5) > 9) return;
  for (const m of rt.mobs) {
    const role = g.c.mobs[m.id]?.role;
    if (m.gone || m.calm || m.area !== s.area || (role !== 'hostile' && role !== 'boss')) continue;
    if (Math.hypot(m.x - s.x, m.y - s.y) < 10) return;
  }
  s.counts.postRound = s.day;
  startCut(g, 'post_round');
}
