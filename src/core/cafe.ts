// Package 73b (I5, D79): the Apple Cafe serves. Space at its counter opens the shop screen the stalls use (the stall
// `cafe_counter`); sitting at one of its tables with something from that counter in the bag, when her hearts are not
// full, she eats it there. R: Eat is not changed: this is only the table.
import { promised, take } from './bag.ts';
import { count } from './cond.ts';
import type { Game } from './types.ts';

export const CAFE_STALL = 'cafe_counter';
export const CAFE_SEAT = 'cafe_seat';

/** Sitting down at a cafe table: one thing from the counter is eaten, the one that fills the most hearts. */
export function cafeSit(g: Game, x: number, y: number): boolean {
  const s = g.s;
  if (s.hp >= s.maxHp) return false;
  let best = '';
  let heal = 0;
  for (const row of g.c.stalls[CAFE_STALL]?.sells ?? []) {
    const h = g.c.items[row.item]?.heal ?? 0;
    if (h > heal && count(g, row.item) > promised(g, row.item)) {
      best = row.item;
      heal = h;
    }
  }
  if (!best) return false;
  take(g, best, 1);
  s.hp = Math.min(s.maxHp, s.hp + heal);
  g.ev.push({ t: 'sfx', id: 'eat' });
  g.ev.push({ t: 'sfx', id: 'chime' });
  g.ev.push({ t: 'fx', id: 'heart', x, y });
  g.ev.push({ t: 'act', kind: 'eat', id: best });
  return true;
}
