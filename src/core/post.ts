// Package 73b (I4, D80, D81): post for her at the Post Office. Dad's 25 December notes wait there by the real date
// (every note dated up to today; all 25 from Christmas Day on), beside one short note a game day from an island
// friend. Dad's words never pass through here: the view passes which days have a note (`rt.dec`) and the day of the
// December post (`rt.today`); the reader fetches the words from the personal file itself. Read marks live in `counts`.
import { applyFx } from './quests.ts';
import type { Game } from './types.ts';

/** The December post has 25 notes. */
export const POST_DAYS = 25;
/** The year of the December post (D81: she plays it first on 25 December 2026). */
export const POST_YEAR = 2026;

/**
 * The day of the December post for a real date (month 0 to 11): 0 before 1 December, the date in December, 25 from
 * Christmas Day on (later years too, so the bundle stays to read again).
 */
export function postDay(year: number, month: number, date: number): number {
  if (year > POST_YEAR || (year === POST_YEAR && month === 11 && date >= POST_DAYS)) return POST_DAYS;
  if (year === POST_YEAR && month === 11) return Math.max(1, date);
  return 0;
}

/** One thing in "Your post": one of Dad's notes ("post:dad:3") or a friend's note ("post:fr:7", the 8th to come). */
export interface PostEntry {
  id: string;
  /** Dad's note: its day of December; a friend's: 0 */
  day: number;
  /** a friend's note: who it is from (a character id) and its words key */
  from: string;
  text: string;
  unread: boolean;
}

const bit = (d: number) => 2 ** (d - 1);
const has = (mask: number, d: number) => Math.floor(mask / bit(d)) % 2 === 1;

/** Dad's notes that are there now, by the real date: the days, in order. */
export function dadDays(g: Game): number[] {
  const today = Math.min(POST_DAYS, g.rt.today ?? 0);
  return [...new Set(g.rt.dec ?? [])].filter((d) => d >= 1 && d <= today).sort((a, b) => a - b);
}

/** The friends' notes start once the first morning's story is done, so the first minutes stay simple. */
function friendsOn(g: Game): boolean {
  return !!g.c.post?.length && !!g.s.quests.prologue?.done;
}
/** Today's friend's note has not been taken from the Post Office yet. */
function friendDue(g: Game): boolean {
  return friendsOn(g) && g.s.counts.post_fday !== g.s.day;
}

/** Something waits at the Post Office that she has not read: the view shows the "new" mark over it. */
export function postNew(g: Game): boolean {
  const c = g.s.counts;
  if (dadDays(g).some((d) => !has(c.post_dad ?? 0, d))) return true;
  return friendDue(g) || (c.post_fread ?? 0) < (c.post_fn ?? 0);
}

/** Space at the counter or the pigeon holes: today's friend's note comes in, then "Your post" opens. */
export function openPost(g: Game): void {
  const c = g.s.counts;
  if (friendDue(g)) {
    c.post_fn = (c.post_fn ?? 0) + 1;
    c.post_fday = g.s.day;
  }
  if (!postList(g).length) {
    g.ev.push({ t: 'toast', kind: 'info', text: 'post_none' });
    return;
  }
  g.ev.push({ t: 'sfx', id: 'open' });
  g.ev.push({ t: 'open', ui: 'post' });
}

/** "Your post": Dad's notes in order from 1 December, then the friends' notes, newest first (the last 10). */
export function postList(g: Game): PostEntry[] {
  const c = g.s.counts;
  const out: PostEntry[] = [];
  for (const d of dadDays(g))
    out.push({ id: `post:dad:${d}`, day: d, from: '', text: '', unread: !has(c.post_dad ?? 0, d) });
  const notes = g.c.post ?? [];
  const n = c.post_fn ?? 0;
  for (let i = n - 1; i >= Math.max(0, n - notes.length); i--) {
    const k = i % notes.length;
    out.push({
      id: `post:fr:${i}`,
      day: 0,
      from: notes[k]!.from,
      text: `post:${k + 1}`,
      unread: i >= (c.post_fread ?? 0),
    });
  }
  return out;
}

/** A note was read to its end: it is marked read and stays in the list. A friend's emeralds come the first time. */
export function postRead(g: Game, id: string): void {
  const c = g.s.counts;
  const [, kind, num] = id.split(':');
  const i = Number(num);
  if (!Number.isInteger(i)) return;
  if (kind === 'dad') {
    if (i < 1 || i > POST_DAYS || !dadDays(g).includes(i) || has(c.post_dad ?? 0, i)) return;
    c.post_dad = (c.post_dad ?? 0) + bit(i);
    g.ev.push({ t: 'act', kind: 'letter', id });
    return;
  }
  if (kind !== 'fr' || i < 0 || i >= (c.post_fn ?? 0)) return;
  const notes = g.c.post ?? [];
  const def = notes.length ? notes[i % notes.length] : undefined;
  // a note a friend sends again later (after all 10) brings no second present
  if (i >= (c.post_fread ?? 0)) {
    c.post_fread = i + 1;
    if (def?.gems && i < notes.length) applyFx(g, { emeralds: def.gems });
  }
  g.ev.push({ t: 'act', kind: 'letter', id });
}

/**
 * Twice a second in play: the first time post waits, and again when new notes from Dad come in by the date, one line
 * says so. Friends' notes after the first come quietly (the "new" mark shows them).
 */
export function stepPost(g: Game): void {
  const c = g.s.counts;
  const dad = dadDays(g).length;
  const fresh = dad > (c.post_told ?? 0) || (!c.post_toldf && friendDue(g));
  if (!fresh || !g.s.quests.prologue?.done) return;
  c.post_told = Math.max(dad, c.post_told ?? 0);
  if (friendsOn(g)) c.post_toldf = 1;
  if (!postNew(g)) return;
  g.ev.push({ t: 'toast', kind: 'info', text: 'post_there' });
}
