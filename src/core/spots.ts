// Gold rings on the ground (G, 22 Nov 2026: "it must display a round on the ground to show where to press space to
// actually join a mini game, this for all"; "place the stand in cottage, again, not easy to find").
// Two kinds, both plain rules the view only draws:
//   - a join ring round every mini-game start in her area (a game post, the claw machine, the mine ride, and anyone who
//     hosts a game): her feet anywhere inside it and Space starts that game, whichever way she faces;
//   - a place ring on the one free spot where the thing a `place` step asks for goes: Space beside it puts it there.
import { atHome, plotRect } from './bag.ts';
import { canPlace } from './build.ts';
import { count } from './cond.ts';
import { solidAt } from './grid.ts';
import { clawReady } from './minigames.ts';
import type { AreaDef, Game, Step } from './types.ts';

export interface JoinSpot {
  /** the ring's middle and radius, in tiles */
  x: number;
  y: number;
  r: number;
  game: string;
  /** the game post or machine (its index in the area's objects), or -1 */
  obj: number;
  /** the host's npc key, or 0 */
  k: number;
  /** a quest step is waiting for this game */
  wanted: boolean;
}

/** How far past the edge of a post or machine its ring reaches: one tile all round, so any tile beside it is inside. */
export const POST_RING = 0.95;
/** The ring round someone who hosts a game (they walk about; the ring goes with them). */
export const HOST_RING = 1.5;

/** Object interactions that start a game. */
function startsGame(interact: string | undefined, d: string | undefined): string {
  if (interact === 'play') return d ?? '';
  if (interact === 'claw') return 'claw';
  if (interact === 'minecart' && d === 'ride') return 'minecart';
  return '';
}

/** Per map: the indices of its objects that start a game (the map never changes, so this is worked out once). */
const starters = new WeakMap<AreaDef, number[]>();
function startersOf(g: Game, a: AreaDef): number[] {
  let list = starters.get(a);
  if (!list) {
    list = [];
    for (let i = 0; i < a.objects.length; i++) {
      const o = a.objects[i]!;
      if (startsGame(g.c.objects[o.type]?.interact, o.d)) list.push(i);
    }
    starters.set(a, list);
  }
  return list;
}

/** Is a quest step waiting for this game? */
export function gameWanted(g: Game, game: string): boolean {
  for (const qid in g.s.quests) {
    const q = g.s.quests[qid]!;
    const st = q.done ? undefined : g.c.quests[qid]?.steps[q.step];
    if (st && st.t === 'mini' && st.game === game) return true;
  }
  return false;
}

/** The game this person hosts ('' for none), as talking to them would start it. */
export function hostGame(g: Game, id: string): string {
  const c = g.c.chars[id];
  const me = g.c.chars[g.s.hero];
  const service = c?.service ?? (me?.standIn === id ? me.service : undefined);
  if (!service?.startsWith('mini:')) return '';
  const game = service.slice(5);
  // snow falls only at Christmas: the snowball host plays then, or for a quest she started then
  if (game === 'snowball' && !g.s.xmas && !gameWanted(g, game)) return '';
  return game;
}

const pool: JoinSpot[] = [];
const out: JoinSpot[] = [];
function take(): JoinSpot {
  const sp = pool[out.length] ?? (pool[out.length] = { x: 0, y: 0, r: 0, game: '', obj: -1, k: 0, wanted: false });
  out.push(sp);
  return sp;
}

/** Every mini-game start in her area right now, with its ring. The list is reused: read it before the next call. */
export function joinSpots(g: Game): readonly JoinSpot[] {
  out.length = 0;
  const s = g.s;
  const a = g.c.areas[s.area];
  if (!a) return out;
  const live = g.rt.live[s.area];
  for (const i of startersOf(g, a)) {
    if (live && !live[i]) continue;
    const o = a.objects[i]!;
    const t = g.c.objects[o.type]!;
    const game = startsGame(t.interact, o.d);
    if (game === 'claw' && !clawReady(g)) continue;
    const w = t.w ?? 1;
    const h = t.h ?? 1;
    const sp = take();
    sp.x = o.x + w / 2;
    sp.y = o.y + h / 2;
    sp.r = Math.max(w, h) / 2 + POST_RING;
    sp.game = game;
    sp.obj = i;
    sp.k = 0;
    sp.wanted = gameWanted(g, game);
  }
  for (const n of g.rt.npcs) {
    const game = hostGame(g, n.id);
    if (!game) continue;
    const sp = take();
    sp.x = n.x;
    sp.y = n.y;
    sp.r = HOST_RING;
    sp.game = game;
    sp.obj = -1;
    sp.k = n.k;
    sp.wanted = gameWanted(g, game);
  }
  return out;
}

/** The join ring her feet are in (the nearest middle when two overlap), or null. */
export function joinAt(g: Game): JoinSpot | null {
  const s = g.s;
  let best: JoinSpot | null = null;
  let bd = Infinity;
  for (const sp of joinSpots(g)) {
    const d = Math.hypot(sp.x - s.x, sp.y - s.y);
    if (d > sp.r || d - sp.r >= bd) continue;
    // nearest edge-relative: a big machine's ring does not swallow a post standing beside it
    bd = d - sp.r;
    best = sp;
  }
  return best;
}

// ---------------------------------------------------------------- the place ring

export interface PlaceSpot {
  qid: string;
  item: string;
  area: string;
  /** the footprint's top left tile and size */
  x: number;
  y: number;
  w: number;
  h: number;
}

/** How near (tiles, from her feet to the nearest edge of the spot) Space puts the thing on the place ring. */
export const PLACE_REACH = 1.1;

/** The place step she is on (the tracked quest first) whose thing is in her bag, or null. */
function placeStep(g: Game): { qid: string; st: Extract<Step, { t: 'place' }> } | null {
  const s = g.s;
  const order = s.tracked ? [s.tracked, ...Object.keys(s.quests)] : Object.keys(s.quests);
  for (const qid of order) {
    const q = s.quests[qid];
    const st = q && !q.done ? g.c.quests[qid]?.steps[q.step] : undefined;
    if (st?.t === 'place' && count(g, st.item) > 0) return { qid, st };
  }
  return null;
}

/** Does this thing go in the area she is in? A house thing in the cottage, a plot thing on her plot, others either. */
function rightArea(g: Game, item: string): boolean {
  const where = g.c.items[item]?.place?.where;
  const s = g.s;
  if (s.area === 'cottage') return where !== 'plot';
  return s.area === 'island' && where !== 'house' && atHome(g);
}

/** Free tiles in order of how good a home they make: in the cottage along the back wall, away from the door; on the
 * plot nearest the gate. A tile where she could not stand next to it, below, is left out. */
function scan(g: Game, item: string, w: number, h: number): [number, number] | null {
  const s = g.s;
  const a = g.c.areas[s.area]!;
  const z = s.area === 'island' ? plotRect(g) : { x: 1, y: 1, w: a.w - 2, h: a.h - 2 };
  const gate = a.places.plot_gate;
  const ax = s.area === 'cottage' ? z.x + z.w * 0.75 : (gate?.x ?? z.x + z.w / 2);
  const ay = s.area === 'cottage' ? z.y : (gate?.y ?? z.y + z.h / 2);
  const fx = Math.floor(s.x);
  const fy = Math.floor(s.y);
  const tiles: [number, number, number][] = [];
  for (let y = z.y; y + h <= z.y + z.h; y++)
    for (let x = z.x; x + w <= z.x + z.w; x++) tiles.push([Math.abs(y - ay) * 3 + Math.abs(x + w / 2 - ax), x, y]);
  tiles.sort((p, q) => p[0] - q[0]);
  for (const [, x, y] of tiles) {
    if (fx >= x && fx < x + w && fy >= y && fy < y + h) continue;
    if (y + h >= a.h || solidAt(g, s.area, x, y + h)) continue;
    if (canPlace(g, item, x, y) === null) return [x, y];
  }
  return null;
}

interface Held {
  key: string;
  at: number;
  spot: PlaceSpot | null;
}
const held = new WeakMap<Game, Held>();

/**
 * The spot the tracked place step's thing goes on in the area she is in, or null (no such step, nothing to place,
 * not at home). It stays put while it is still free, so the ring does not hop about as she walks.
 */
export function placeSpot(g: Game): PlaceSpot | null {
  const ps = placeStep(g);
  const s = g.s;
  if (!ps || !rightArea(g, ps.st.item)) return null;
  const def = g.c.items[ps.st.item]?.place;
  if (!def) return null;
  const key = `${ps.qid}|${s.quests[ps.qid]!.step}|${ps.st.item}|${s.area}|${s.placed.length}|${s.crops.length}`;
  let h = held.get(g);
  if (h && h.key === key && g.rt.tick - h.at < 30 && g.rt.tick >= h.at) return h.spot;
  const w = def.w ?? 1;
  const hh = def.h ?? 1;
  let spot = h && h.key === key ? h.spot : null;
  if (spot) {
    const why = canPlace(g, spot.item, spot.x, spot.y);
    if (why !== null && why !== 'build_feet') spot = null;
  }
  if (!spot) {
    const at = scan(g, ps.st.item, w, hh);
    spot = at ? { qid: ps.qid, item: ps.st.item, area: s.area, x: at[0], y: at[1], w, h: hh } : null;
  }
  if (!h) held.set(g, (h = { key, at: g.rt.tick, spot }));
  h.key = key;
  h.at = g.rt.tick;
  h.spot = spot;
  return spot;
}

/** She stands beside the place ring (not on it): Space puts the thing there. */
export function besidePlace(g: Game, sp: PlaceSpot): boolean {
  const s = g.s;
  const nx = Math.max(sp.x, Math.min(s.x, sp.x + sp.w));
  const ny = Math.max(sp.y, Math.min(s.y, sp.y + sp.h));
  const d = Math.hypot(nx - s.x, ny - s.y);
  return d > 0 && d <= PLACE_REACH;
}
