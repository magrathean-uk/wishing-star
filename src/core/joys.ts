// Package 74 (D79): two of the small joys. Feeding the pond from the mended jetty (idea I9), and where a friend is
// when she walks into their home and finds nobody in (idea I12). Pure and deterministic.
import { take } from './bag.ts';
import { count } from './cond.ts';
import { TERRAIN, terrainAt } from './grid.ts';
import { nudge } from './hero.ts';
import { activeSpot } from './npcs.ts';
import { place } from './quests.ts';
import { charName } from './talk.ts';
import type { Game } from './types.ts';

// ---------------------------------------------------------------- feeding the pond (I9)
// At the far end of a built jetty or bridge over a pond, with bread in her bag, Space throws a piece: it is used up,
// ripples spread, and the pond's animals come to it (ducks walk over if there are any; the fish jump). At most 3
// pieces a game day bring them, then "They are full." No reward but hearts over them.

/** What she throws, and how many pieces a game day bring them. */
export const FEED_FOOD = 'bread';
export const FEED_MAX = 3;
/** The counts keys for the game day (plus 1) she last fed them and how many pieces that day: no save change. */
export const FED_DAY = 'pond_fed_day';
export const FED_N = 'pond_fed';
/** The fish that jump, taken in turn. */
const POND_FISH = ['goldfish', 'pond_carp', 'minnow'];

/** Pieces she has thrown today. */
export function fedToday(g: Game): number {
  return (g.s.counts[FED_DAY] ?? 0) === g.s.day + 1 ? (g.s.counts[FED_N] ?? 0) : 0;
}

/**
 * Is the tile she faces (tx, ty) pond water seen from the far end of a built jetty or bridge she stands on? The far
 * end is the site's tile furthest from where it is reached from land; she may stand on it or the tile before it.
 */
export function atPondEnd(g: Game, tx: number, ty: number): boolean {
  const s = g.s;
  const a = g.c.areas[s.area]!;
  if (TERRAIN[terrainAt(a, tx, ty)]?.water !== 'pond') return false;
  const mx = Math.floor(s.x);
  const my = Math.floor(s.y);
  for (const site of a.sites) {
    if (!s.flags[site.flag]) continue;
    const r = site.rect;
    if (mx < r.x || my < r.y || mx >= r.x + r.w || my >= r.y + r.h) continue;
    let fx = r.x;
    let fy = r.y;
    let fd = -1;
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++) {
        const d = Math.hypot(x - site.at.x, y - site.at.y);
        if (d > fd) {
          fd = d;
          fx = x;
          fy = y;
        }
      }
    if (Math.max(Math.abs(mx - fx), Math.abs(my - fy)) <= 1) return true;
  }
  return false;
}

/**
 * Space here feeds them: with bread in the bag, while they still want it today (or, when they are full, while she
 * has no rod to fish with, so Space still answers). Else Space fishes as before.
 */
export function canFeed(g: Game, tx: number, ty: number, rod: boolean): boolean {
  if (count(g, FEED_FOOD) <= 0 || !atPondEnd(g, tx, ty)) return false;
  return fedToday(g) < FEED_MAX || !rod;
}

/** She throws a piece of bread onto the water at (tx, ty). */
export function feedPond(g: Game, tx: number, ty: number): void {
  const s = g.s;
  const n = fedToday(g);
  if (n >= FEED_MAX) {
    g.ev.push({ t: 'sfx', id: 'plop' });
    nudge(g, 'feed_full');
    return;
  }
  if (!take(g, FEED_FOOD, 1)) return;
  s.counts[FED_DAY] = s.day + 1;
  s.counts[FED_N] = n + 1;
  const x = tx + 0.5;
  const y = ty + 0.5;
  g.ev.push({ t: 'sfx', id: 'throw' });
  g.ev.push({ t: 'fx', id: 'ripple', x, y });
  g.ev.push({ t: 'fx', id: 'ripple', x: x - 0.5, y: y + 0.3 });
  g.ev.push({ t: 'fx', id: 'ripple', x: x + 0.5, y: y - 0.2 });
  // the fish come up for it, one after another, with a heart over each
  for (let i = 0; i < 3; i++) {
    const fx = x + [0, -0.7, 0.6][i]!;
    const fy = y + [0, 0.4, -0.4][i]!;
    g.ev.push({ t: 'fx', id: 'fishjump', x: fx, y: fy, n: i, item: POND_FISH[(n + i) % POND_FISH.length] });
    g.ev.push({ t: 'fx', id: 'heart', x: fx, y: fy - 0.9 - i * 0.1 });
  }
  g.ev.push({ t: 'sfx', id: 'splash' });
  g.ev.push({ t: 'act', kind: 'feed', id: FEED_FOOD });
}

// ---------------------------------------------------------------- where a friend is (I12)
// When she walks into a friend's home and nobody who lives there is in, one short line says where the nearest of
// them is, by the nearest named place ("Bluey is at the playground."), once per visit. Who lives in a room comes from
// the cast's own timetables: anyone with a stay spot inside the room (a place named in_<...>), or a home spot (a place
// named <...>_home) by a door into it. Names come from the cast (their tokens filled), never typed here.

/** A home spot this near a door into a room makes that room their home. */
export const HOME_NEAR = 9;
/** A friend this near the door outside is "just outside". */
export const NEAR_DOOR = 5;

/** The cast who live in a room (never the hero she is playing). Empty for a room that is nobody's home. */
export function residents(g: Game, area: string): string[] {
  const a = g.c.areas[area];
  if (!a?.indoor) return [];
  // the doors into this room from outside
  const ins: { x: number; y: number }[] = [];
  for (const id in g.c.areas)
    if (id !== area) for (const d of g.c.areas[id]!.doors) if (d.to === area) ins.push({ x: d.x, y: d.y });
  const out: string[] = [];
  for (const id in g.c.chars) {
    const c = g.c.chars[id]!;
    if (id === g.s.hero || c.role === 'hostile' || c.role === 'animal') continue;
    const lives = c.spots.some((sp) => {
      const p = place(g, sp.at);
      if (!p) return false;
      // a room's own stay spots are named in_<room> (in_bing, in_heeler...): someone the timetable puts there lives there
      if (p.area === area) return sp.at.startsWith('in_');
      return (
        sp.at.endsWith('_home') && ins.some((d) => Math.hypot(d.x - p.x, d.y - p.y) < HOME_NEAR && p.area !== area)
      );
    });
    if (lives) out.push(id);
  }
  return out;
}

/** Where someone stands now on the island, for "nearest": a room counts as its door outside. */
function outside(g: Game, area: string, x: number, y: number): { x: number; y: number } | null {
  if (!g.c.areas[area]?.indoor) return { x, y };
  for (const id in g.c.areas) {
    if (g.c.areas[id]!.indoor) continue;
    for (const d of g.c.areas[id]!.doors) if (d.to === area) return { x: d.x, y: d.y };
  }
  return null;
}

/** The name of the place nearest a spot: the nearest labelled place in its area (not one in `whereSkip`), else the area's own name. */
export function placeName(g: Game, area: string, x: number, y: number): string {
  const a = g.c.areas[area]!;
  const skip = g.c.whereSkip;
  let best = '';
  let bd = 1e9;
  for (const name in a.places) {
    const p = a.places[name]!;
    // package 78: not a person, an animal or a thing lying about ("is at Mama Koala"): the list is data (world.ts)
    if (!p.label || skip?.includes(name)) continue;
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bd) {
      bd = d;
      best = p.label;
    }
  }
  return best || a.name;
}

/** The line for walking into this room: "Bluey is at the playground.", or '' when someone who lives here is in. */
export function whereLine(g: Game, area: string): string {
  const who = residents(g, area);
  if (!who.length) return '';
  const here = outside(g, area, 0, 0);
  let best = '';
  let bestAt: { area: string; x: number; y: number } | null = null;
  let bd = 1e9;
  for (const id of who) {
    const sp = activeSpot(g, g.c.chars[id]!);
    const p = sp ? place(g, sp.at) : null;
    if (!p) continue;
    // someone who lives here is in: no line
    if (p.area === area) return '';
    const o = outside(g, p.area, p.x, p.y);
    const d = here && o ? Math.hypot(o.x - here.x, o.y - here.y) : 1e6;
    if (d < bd) {
      bd = d;
      best = id;
      bestAt = p;
    }
  }
  if (!bestAt) return '';
  // by the house itself: "just outside" (the place's name would be this very house)
  const text = bd < NEAR_DOOR ? (g.c.strings.where_out ?? '') : (g.c.strings.where_friend ?? '');
  return text.replace('{who}', charName(g, best)).replace('{where}', placeName(g, bestAt.area, bestAt.x, bestAt.y));
}
