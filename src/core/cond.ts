// Conditions on the save, and the day clock's phases.
import type { Cond, Game } from './types.ts';

export const DAY_LEN = 840;
export const DUSK_AT = 540;
export const NIGHT_AT = 630;
export const DAWN_AT = 780;

export type Phase = 'day' | 'dusk' | 'night' | 'dawn';
export function phase(time: number): Phase {
  return time < DUSK_AT ? 'day' : time < NIGHT_AT ? 'dusk' : time < DAWN_AT ? 'night' : 'dawn';
}
/** Mobs are out: night proper and the dark half of dusk and dawn. */
export function isNight(g: Game): boolean {
  return g.s.time >= NIGHT_AT - 30 && g.s.time < DAWN_AT + 20;
}
/**
 * Package 78: the lamp (counts.lamp holds the game day it was lit, see lamp.ts) shines tonight, and nobody has said a
 * word about it yet tonight (counts.lamp_note holds the game day someone did).
 */
export function lampNoteDue(g: Game): boolean {
  return g.s.counts.lamp === g.s.day && isNight(g) && g.s.counts.lamp_note !== g.s.day;
}
/** 0 in full day, 1 in full night, smooth in between (for the view's blue wash). */
export function darkness(time: number): number {
  if (time < DUSK_AT) return 0;
  if (time < NIGHT_AT) return (time - DUSK_AT) / (NIGHT_AT - DUSK_AT);
  if (time < DAWN_AT) return 1;
  return 1 - (time - DAWN_AT) / (DAY_LEN - DAWN_AT);
}

const arr = (v: string | string[]): string[] => (typeof v === 'string' ? [v] : v);

export function questDone(g: Game, id: string): boolean {
  return !!g.s.quests[id]?.done;
}
export function questActive(g: Game, id: string): boolean {
  const q = g.s.quests[id];
  return !!q && !q.done;
}

export function test(g: Game, c: Cond | undefined): boolean {
  if (!c) return true;
  const s = g.s;
  if (c.done) for (const q of arr(c.done)) if (!questDone(g, q)) return false;
  if (c.active && !questActive(g, c.active)) return false;
  if (c.atStep) {
    const q = s.quests[c.atStep[0]];
    if (!q || q.done) return false;
    if (q.step < c.atStep[1]) return false;
    if (c.atStep[2] !== undefined && q.step > c.atStep[2]) return false;
  }
  if (c.flag) for (const f of arr(c.flag)) if (!s.flags[f]) return false;
  if (c.noFlag) for (const f of arr(c.noFlag)) if (s.flags[f]) return false;
  if (c.shards !== undefined && s.shards < c.shards) return false;
  if (c.hero && s.hero !== c.hero) return false;
  if (c.notHero && s.hero === c.notHero) return false;
  if (c.christmas !== undefined && s.xmas !== c.christmas) return false;
  if (c.night !== undefined && isNight(g) !== c.night) return false;
  if (c.lamp !== undefined && lampNoteDue(g) !== c.lamp) return false;
  if (c.day !== undefined && s.day < c.day) return false;
  if (c.has) for (const k in c.has) if (count(g, k) < c.has[k]!) return false;
  if (c.cup !== undefined && !cupOpen(g, c.cup)) return false;
  if (c.any && !c.any.some((x) => test(g, x))) return false;
  if (c.not && test(g, c.not)) return false;
  return true;
}

/**
 * Package 47a: a mini-game's cups open the day after she first played it (an old save that has stars in it is open
 * at once). The day is kept in counts as "cupday:<game>".
 */
export function cupOpen(g: Game, game: string): boolean {
  if (!(g.s.stars[game] ?? 0)) return false;
  return g.s.day >= (g.s.counts['cupday:' + game] ?? 0);
}

/** How many of an item she has, in the bag and the pouch together. */
export function count(g: Game, id: string): number {
  let n = g.s.pouch[id] ?? 0;
  const bag = g.s.bag;
  for (let i = 0; i < bag.length; i++) {
    const sl = bag[i];
    if (sl && sl.id === id) n += sl.n;
  }
  return n;
}

// ---------------------------------------------------------------- seeded randomness (lives in the save)

/** mulberry32: next float in [0, 1). */
export function rand(g: Game): number {
  let t = (g.s.rng = (g.s.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export function randInt(g: Game, min: number, max: number): number {
  return min + Math.floor(rand(g) * (max - min + 1));
}
export function pick<T>(g: Game, list: readonly T[]): T {
  return list[Math.floor(rand(g) * list.length)]!;
}
/** A stateless hash for things that must not disturb the save's random stream (decor, per-tile variety). */
export function hash2(x: number, y: number, seed = 0): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
