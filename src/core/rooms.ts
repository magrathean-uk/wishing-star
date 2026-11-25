// Package 73a (I13): a find in every room, and the journal's count of the buildings she has been inside.
// A find is a small thing of a `find_` type laid in a room (tools/map/rooms.ts). The chest rule takes it once per saved
// game (src/core/hero.ts: `taken`, loot from its `d`), so saves, the solver and the reach test already know it; this
// file only says what it was. A building counts as visited once she has stood in its room (a `counts` key), or when
// something in it was taken (a save from before this rule); the cottage counts from the start.
import type { Content, Game, MapObj } from './types.ts';

/** Object types that are a room's find start with this. */
export const FIND_PREFIX = 'find_';
/** The `counts` key for a building she has been inside: this and the room's area id. */
export const ROOM_KEY = 'room:';
/** Rooms reached from an island door that are not homes: the King's Hall is a hall behind a gate. */
const NOT_BUILDINGS = new Set(['hall']);

const cache = new WeakMap<Content, string[]>();

/** The room of each building on the island: every lit room an island door leads into (20 in all). */
export function buildingRooms(c: Content): string[] {
  let out = cache.get(c);
  if (out) return out;
  out = [];
  for (const d of c.areas.island?.doors ?? []) {
    const a = c.areas[d.to];
    if (!a?.indoor || a.dark || NOT_BUILDINGS.has(a.id) || out.includes(a.id)) continue;
    out.push(a.id);
  }
  cache.set(c, out);
  return out;
}

/** Has she been inside this building's room? */
export function roomSeen(g: Game, room: string): boolean {
  if (room === 'cottage' || g.s.counts[ROOM_KEY + room]) return true;
  return (g.c.areas[room]?.objects ?? []).some((o) => !!g.s.taken[o.id]);
}

/** "Rooms 4 of 20": the buildings she has been inside, and how many there are. */
export function roomsCount(g: Game): { n: number; of: number } {
  const all = buildingRooms(g.c);
  return { n: all.filter((r) => roomSeen(g, r)).length, of: all.length };
}

/** She is in an area: a building's room counts once. When the last one counts, a small cheer. */
export function visitRoom(g: Game): void {
  const s = g.s;
  if (s.counts[ROOM_KEY + s.area] || !buildingRooms(g.c).includes(s.area)) return;
  s.counts[ROOM_KEY + s.area] = 1;
  g.rt.dirty = true;
  const r = roomsCount(g);
  if (r.n < r.of) return;
  g.ev.push({ t: 'toast', kind: 'info', text: 'rooms_all' });
  g.ev.push({ t: 'sfx', id: 'sticker' });
  g.ev.push({ t: 'act', kind: 'find', id: 'rooms_all' });
}

/** After the chest rule took a room's find: say what it was ("You found 5 emeralds!"). */
export function roomFound(g: Game, o: MapObj): void {
  if (!o.type.startsWith(FIND_PREFIX)) return;
  const S = g.c.strings;
  const gems = /(?:^|,)\s*emerald:(\d+)/.exec(o.d ?? '');
  const text = S[`found:${o.type}`] ?? (gems ? (S.found_emeralds ?? '').replace('{n}', gems[1]!) : '');
  if (text) g.ev.push({ t: 'toast', kind: 'info', text });
}
