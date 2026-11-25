// The way to the goal (package 60). The helper arrow points along the way she can walk today, not in a straight line
// at the goal. A walking distance to the goal is worked out over this area's open ground (bridges built, gaps open,
// doors she may use; signpost travel not counted) whenever the goal, her area or the world changes (never every
// frame). Every few frames the guide tries each arrow key held for half a second from where she stands, with the
// same walking rule as the game (walk.ts), and points the arrow along the route at the point about 6 tiles on that
// the best key walks towards. So pressing the arrow key nearest the arrow always gets her nearer. When the goal is in
// another area it leads to the way out towards it. The goal line asks it whether the goal is on the screen.
import { toolTier } from './bag.ts';
import { test } from './cond.ts';
import { barrierAt, DOOR_SLACK, doorInto, flood, free } from './grid.ts';
import type { Game, Place } from './types.ts';
import { HALF, slide } from './walk.ts';

export interface GuideRt {
  /** what the distances were worked out for: the goal tile and area, her area, the world's revision */
  key: string;
  /** steps to the goal from each tile of the area `distArea` (-1: no way) */
  dist: Int32Array;
  distArea: string;
  /** the point the arrow points at, in tiles, when `has` */
  wx: number;
  wy: number;
  has: boolean;
  /** no way to the goal from where she is today (and a barrier's hint when one is in the way, '' if not) */
  none: boolean;
  why: string;
  /** the goal is somewhere else: off the screen or in another area (with a little give either way) */
  far: boolean;
  /** she can walk straight to the goal from where she stands (then the star is enough and no arrow shows) */
  direct: boolean;
  /** frames until the arrow is aimed again, and until a moving goal may be worked out again */
  aimT: number;
  coolT: number;
  /** the key the arrow was aimed along last time (-1: none yet), kept while it still gets her nearer (no flicker) */
  last: number;
  /** the goal is in another area: the first door in this area on the way there (null: none, or the goal is here) */
  door: { x: number; y: number; to: string } | null;
  /** she is outside and that door leads into a house (or a cave, the Mine, the Hall): the line says "Go into" */
  house: boolean;
  /** that door is close and on the screen ("Go into this house"), with a little give so the line does not flicker */
  doorNear: boolean;
}

/** How far ahead along the route the arrow looks, in tiles. */
export const LOOK = 6;
/** Frames a key is tried for: half a second. */
const TRY = 30;
const SPEED = 4.5 / 60;
/**
 * Half the screen in tiles at the game's zoom (1920 by 1080 at 80 pixels a tile): beyond FAR the line says the going.
 * The doing comes back only within NEAR, 3 tiles closer, so the line does not flip while she stands or walks a little.
 */
const FAR_X = 12.5;
const FAR_Y = 7;
const NEAR_X = FAR_X - 3;
const NEAR_Y = FAR_Y - 3;
/** A door this close (in tiles) is close and on the screen; it stops being so only past DOOR_OUT. */
const DOOR_IN_X = 7;
const DOOR_IN_Y = 4;
const DOOR_OUT_X = 9;
const DOOR_OUT_Y = 5.5;
/** A key the arrow was aimed along stays while it gets her nearer and ends within this many steps of the best. */
const KEEP = 1;
const KEYS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export function guideOf(g: Game): GuideRt {
  const rt = g.rt;
  if (!rt.guide)
    rt.guide = {
      key: '',
      dist: new Int32Array(0),
      distArea: '',
      wx: 0,
      wy: 0,
      has: false,
      none: false,
      why: '',
      far: false,
      direct: false,
      aimT: 0,
      coolT: 0,
      last: -1,
      door: null,
      house: false,
      doorNear: false,
    };
  return rt.guide;
}

/** The first door in this area on the way to another area, through doors she may use now (breadth first). */
export function doorTowards(g: Game, from: string, to: string): { x: number; y: number; to: string } | null {
  if (from === to) return null;
  const seen = new Set([from]);
  const q: { area: string; first: { x: number; y: number; to: string } | null }[] = [{ area: from, first: null }];
  while (q.length) {
    const cur = q.shift()!;
    for (const d of g.c.areas[cur.area]?.doors ?? []) {
      if (seen.has(d.to) || (d.if && !test(g, d.if))) continue;
      const first = cur.first ?? { x: d.x, y: d.y, to: d.to };
      if (d.to === to) return first;
      seen.add(d.to);
      q.push({ area: d.to, first });
    }
  }
  return null;
}

/** Where the way in this area ends: the goal's tile, or the door out towards its area. */
function routeEnd(g: Game, tgt: Place): { x: number; y: number } | null {
  if (tgt.area === g.s.area) return { x: Math.floor(tgt.x + 0.5), y: Math.floor(tgt.y + 0.5) };
  return doorTowards(g, g.s.area, tgt.area);
}

/** Is the goal off the screen (or in another area)? With a little give so the line does not flicker at the edge. */
function farFrom(g: Game, tgt: Place, was: boolean): boolean {
  if (tgt.area !== g.s.area) return true;
  const dx = Math.abs(tgt.x + 0.5 - g.s.x);
  const dy = Math.abs(tgt.y + 0.5 - g.s.y);
  return was ? dx > NEAR_X || dy > NEAR_Y : dx > FAR_X || dy > FAR_Y;
}

/** Can she walk from her spot straight to (x, y)? Sampled every fifth of a tile with a slim body. */
function straight(g: Game, x: number, y: number): boolean {
  const sx = g.s.x;
  const sy = g.s.y;
  const d = Math.hypot(x - sx, y - sy);
  const n = Math.max(1, Math.ceil(d / 0.2));
  for (let i = 1; i <= n; i++) {
    const k = i / n;
    if (!free(g, g.s.area, sx + (x - sx) * k, sy + (y - sy) * k, 0.24)) return false;
  }
  return true;
}

let queue = new Int32Array(0);

/**
 * A thing in the way that she can clear with a tool she owns (a thorn bush, a web, a rock fall, a fallen tree):
 * the way goes through it, so the arrow leads her to it and its Space prompt does the rest.
 */
function clearable(g: Game, area: string, k: number, cracked = false): boolean {
  const oi = g.rt.objAt[area]?.[k] ?? -1;
  if (oi < 0) return false;
  const o = g.c.areas[area]!.objects[oi]!;
  const t = g.c.objects[o.type];
  const node = t?.node;
  // (a cracked rock is a secret pocket a creeper's bang opens, never the way)
  if (!node || (t.cracked && !cracked) || node.regrow || !node.tool || g.s.nodes[o.id] !== undefined) return false;
  return toolTier(g, node.tool) >= (node.tier ?? 1);
}

/** Steps from every open tile of her area to the way's end (4 neighbours; a solid end counts its open neighbours). */
function workOut(g: Game, gd: GuideRt, tgt: Place, cracked = false): void {
  const area = g.s.area;
  const a = g.c.areas[area]!;
  const solid = g.rt.solid[area]!;
  const n = a.w * a.h;
  if (gd.dist.length !== n) gd.dist = new Int32Array(n);
  gd.dist.fill(-1);
  gd.distArea = area;
  const end = routeEnd(g, tgt);
  if (!end) return;
  if (queue.length < n) queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  const seed = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= a.w || y >= a.h) return;
    const k = y * a.w + x;
    if (solid[k] || gd.dist[k]! >= 0) return;
    gd.dist[k] = 0;
    queue[tail++] = k;
  };
  seed(end.x, end.y);
  // a door two tiles wide (the Mine's, the gate's): every tile of it is the way out
  // (package 68: a door is gone through by walking into it, so the way reaches it only from its front)
  const front = new Map<number, [number, number]>();
  if (tgt.area !== area) {
    const to = g.c.areas[area]!.doors.find((d) => d.x === end.x && d.y === end.y)?.to;
    for (const d of g.c.areas[area]!.doors) {
      if (d.to !== to) continue;
      seed(d.x, d.y);
      const into = doorInto(g, area, d);
      if (into) front.set(d.y * a.w + d.x, into);
    }
  }
  // a goal on a solid tile (a person's spot, a workbench, a thing in the water): the open tiles round it
  for (let r = 1; r <= 2 && tail === 0; r++)
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) seed(end.x + dx, end.y + dy);
  while (head < tail) {
    const k = queue[head++]!;
    const x = k % a.w;
    const y = (k - x) / a.w;
    const d = gd.dist[k]! + 1;
    const into = front.get(k);
    for (const [ox, oy] of KEYS) {
      if (into && (ox !== -into[0] || oy !== -into[1])) continue;
      const nx = x + ox;
      const ny = y + oy;
      if (nx < 0 || ny < 0 || nx >= a.w || ny >= a.h) continue;
      const nk = ny * a.w + nx;
      if (gd.dist[nk]! >= 0 || (solid[nk] && !clearable(g, area, nk, cracked))) continue;
      gd.dist[nk] = d;
      queue[tail++] = nk;
    }
  }
}

/** Steps to the goal from a spot, or -1. */
function distAt(g: Game, gd: GuideRt, x: number, y: number): number {
  const a = g.c.areas[gd.distArea];
  if (!a) return -1;
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  if (tx < 0 || ty < 0 || tx >= a.w || ty >= a.h) return -1;
  return gd.dist[ty * a.w + tx]!;
}

/** The route from her tile downhill to the goal, as tiles: x0, y0, x1, y1, ... (for the map's dotted line). */
export function routeFrom(g: Game, max = 400): number[] {
  const gd = guideOf(g);
  const out: number[] = [];
  if (gd.distArea !== g.s.area || !gd.dist.length) return out;
  const a = g.c.areas[gd.distArea]!;
  let x = Math.floor(g.s.x);
  let y = Math.floor(g.s.y);
  let d = distAt(g, gd, x + 0.5, y + 0.5);
  if (d < 0) return out;
  out.push(x, y);
  while (d > 0 && out.length < max * 2) {
    let moved = false;
    for (const [ox, oy] of KEYS) {
      const nx = x + ox;
      const ny = y + oy;
      if (nx < 0 || ny < 0 || nx >= a.w || ny >= a.h) continue;
      const nd = gd.dist[ny * a.w + nx]!;
      if (nd >= 0 && nd < d) {
        x = nx;
        y = ny;
        d = nd;
        moved = true;
        break;
      }
    }
    if (!moved) break;
    out.push(x, y);
  }
  return out;
}

/** Where holding a key for half a second from (x, y) takes her, by the game's own walking rule (no doors, no harm). */
const END = { x: 0, y: 0 };
function tryKey(g: Game, x: number, y: number, kx: number, ky: number): typeof END {
  const gd = guideOf(g);
  for (let f = 0; f < TRY; f++) {
    const r = slide(g, g.s.area, x, y, kx * SPEED, ky * SPEED);
    if (r.x === x && r.y === y) break;
    x = r.x;
    y = r.y;
    // the way ends here (a door out, the goal): stop as she would
    if (distAt(g, gd, x, y) === 0) break;
  }
  END.x = x;
  END.y = y;
  return END;
}

/** Does holding the key into this door for half a second take her in, by the game's own walking and door rule? */
function goesIn(g: Game, d: { x: number; y: number }, into: [number, number]): boolean {
  let x = g.s.x;
  let y = g.s.y;
  for (let f = 0; f < TRY; f++) {
    const r = slide(g, g.s.area, x, y, into[0] * SPEED, into[1] * SPEED);
    // (stopped dead: she goes no further this way)
    if (r.x === x && r.y === y) return false;
    x = r.x;
    y = r.y;
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    if (d.x === tx && d.y === ty) return true;
    if (
      into[0]
        ? tx === d.x && Math.abs(y - (d.y + 0.5)) < DOOR_SLACK
        : ty === d.y && Math.abs(x - (d.x + 0.5)) < DOOR_SLACK
    )
      return true;
  }
  return false;
}

/** Aim the arrow: the key that walks her furthest along the way, and the point on the route it walks towards. */
function aim(g: Game, gd: GuideRt): void {
  gd.has = false;
  gd.direct = false;
  if (gd.distArea !== g.s.area) return;
  const here = distAt(g, gd, g.s.x, g.s.y);
  if (here < 0) return;
  if (here === 0) {
    // on a door's tile (she came along its front): the way is into it
    const tx = Math.floor(g.s.x);
    const ty = Math.floor(g.s.y);
    const d = g.c.areas[g.s.area]!.doors.find((o) => o.x === tx && o.y === ty);
    const into = d ? doorInto(g, g.s.area, d) : null;
    if (into) {
      gd.wx = g.s.x + into[0] * 3;
      gd.wy = g.s.y + into[1] * 3;
      gd.has = true;
      return;
    }
  }
  const route = routeFrom(g, LOOK + 1);
  // package 68: a door is gone through by walking into it: near the door the arrow leads to the tile in front of
  // it, then into it (a key along its front would only walk her across it)
  if (here <= 3 && route.length >= 2) {
    const ex = route.at(-2)!;
    const ey = route.at(-1)!;
    const d = g.c.areas[g.s.area]!.doors.find((o) => o.x === ex && o.y === ey);
    const into = d && distAt(g, gd, ex + 0.5, ey + 0.5) === 0 ? doorInto(g, g.s.area, d) : null;
    if (into) {
      const fx = ex - into[0];
      const fy = ey - into[1];
      // across the door's line (how far off its middle) and along it (0 on the door, 1 in front of it)
      const off = into[0] ? Math.abs(g.s.y - (ey + 0.5)) : Math.abs(g.s.x - (ex + 0.5));
      const back = into[0] ? (ex + 0.5 - g.s.x) * into[0] : (ey + 0.5 - g.s.y) * into[1];
      // (G, 22 Nov 2026: only when holding that key really takes her in: at the door's edge a press into the wall
      // can slide her round the corner and off the door, and the arrow flipped between "in" and "along" for ever)
      if (off < DOOR_SLACK && back > -0.5 && back < 2 && goesIn(g, { x: ex, y: ey }, into)) {
        gd.wx = g.s.x + into[0] * 3;
        gd.wy = g.s.y + into[1] * 3;
        gd.has = true;
        gd.direct = false;
        return;
      }
      if (Math.abs(g.s.x - (fx + 0.5)) + Math.abs(g.s.y - (fy + 0.5)) <= 2.5) {
        gd.wx = fx + 0.5;
        gd.wy = fy + 0.5;
        gd.has = true;
        gd.direct = false;
        return;
      }
    }
  }
  if (here <= LOOK && route.length >= 2 && straight(g, route.at(-2)! + 0.5, route.at(-1)! + 0.5)) gd.direct = true;
  // a thing to clear (a thorn bush, a rock fall) within 3 steps of the way, or right beside her on it: point at
  // it, so she walks up to it and its Space prompt says the rest
  {
    const a = g.c.areas[g.s.area]!;
    const solid = g.rt.solid[g.s.area]!;
    const hx = Math.floor(g.s.x);
    const hy = Math.floor(g.s.y);
    const ok = (nx: number, ny: number): boolean => {
      if (nx < 0 || ny < 0 || nx >= a.w || ny >= a.h) return false;
      const k = ny * a.w + nx;
      return gd.dist[k]! >= 0 && gd.dist[k]! < here && !!solid[k] && clearable(g, g.s.area, k, true);
    };
    // package 69: of the things to clear on the way, the nearest to her (never the first in a list)
    let cx = -1;
    let cy = -1;
    let cd = 1e9;
    const consider = (nx: number, ny: number) => {
      if (!ok(nx, ny)) return;
      const d = (nx + 0.5 - g.s.x) ** 2 + (ny + 0.5 - g.s.y) ** 2;
      if (d < cd) {
        cd = d;
        cx = nx;
        cy = ny;
      }
    };
    const at = (nx: number, ny: number): boolean => {
      gd.wx = nx + 0.5;
      gd.wy = ny + 0.5;
      // one tile off on both axes: point along the side that is walled, so the key slides her round to face it
      const ox = nx - hx;
      const oy = ny - hy;
      if (Math.abs(ox) === 1 && Math.abs(oy) === 1) {
        if (solid[hy * a.w + hx + ox]) gd.wy = g.s.y + oy * 0.4;
        else gd.wx = g.s.x + ox * 0.4;
      }
      gd.has = true;
      gd.direct = false;
      return true;
    };
    for (const [ox, oy] of KEYS) consider(hx + ox, hy + oy);
    for (let j = 2; j < Math.min(route.length, 8); j += 2) consider(route[j]!, route[j + 1]!);
    if (cx >= 0 && at(cx, cy)) return;
  }
  // the key that ends nearest the goal; when none gets nearer in one go (she would pass the mouth of a lane), the
  // key whose next press does best, so following the arrow never goes back and forth
  let bk = -1;
  let bd = here;
  let tk = -1;
  let td = here;
  // package 68: a key that only gets her on by the corner help sliding her round a bush or a cliff corner is not
  // shown while a key that walks her straight along its way also gets her nearer (run c 0090: the arrow pointed
  // left into a cliff because the slide round a bush beside it ended a little nearer than walking up)
  let sk = -1;
  let sd = here;
  const ends = [-1, -1, -1, -1];
  const steady = [false, false, false, false];
  for (let i = 0; i < 4; i++) {
    const [kx, ky] = KEYS[i]!;
    const e = tryKey(g, g.s.x, g.s.y, kx, ky);
    const ex = e.x;
    const ey = e.y;
    const end = distAt(g, gd, ex, ey);
    if (end < 0) continue;
    const along = (ex - g.s.x) * kx + (ey - g.s.y) * ky;
    const side = Math.abs(kx ? ey - g.s.y : ex - g.s.x);
    ends[i] = end;
    steady[i] = end < here && along >= 1 && side <= along * 0.5;
    if (steady[i] && end < sd) {
      sd = end;
      sk = i;
    }
    if (end < bd) {
      bd = end;
      bk = i;
    }
    if (end >= here)
      for (let j = 0; j < 4; j++) {
        const [jx, jy] = KEYS[j]!;
        if (jx === -kx && jy === -ky) continue;
        const e2 = tryKey(g, ex, ey, jx, jy);
        const d2 = distAt(g, gd, e2.x, e2.y);
        if (d2 >= 0 && d2 < td) {
          td = d2;
          tk = i;
        }
      }
  }
  if (sk >= 0) bk = sk;
  if (bk < 0) bk = tk;
  // issue (G, 22 Nov 2026: "very rapid moving and bounces around"): the key it was aimed along last time stays
  // while it still gets her nearer, walks straight when the best one does, and ends within KEEP steps of the best
  const lk = gd.last;
  if (bk >= 0 && lk >= 0 && lk !== bk && ends[lk]! >= 0 && ends[lk]! < here && (sk < 0 || steady[lk])) {
    if (ends[lk]! <= (ends[bk]! >= 0 ? ends[bk]! : here) + KEEP) bk = lk;
  }
  gd.last = bk;
  if (bk >= 0) {
    // the route ahead as far as that key leads: the furthest route point that lies mainly that way
    const [kx, ky] = KEYS[bk]!;
    for (let j = route.length - 2; j >= 2; j -= 2) {
      const dx = route[j]! + 0.5 - g.s.x;
      const dy = route[j + 1]! + 0.5 - g.s.y;
      const along = dx * kx + dy * ky;
      if (along > 0.3 && along >= Math.abs(kx ? dy : dx) * 1.05) {
        gd.wx = route[j]! + 0.5;
        gd.wy = route[j + 1]! + 0.5;
        gd.has = true;
        return;
      }
    }
    gd.wx = g.s.x + kx * 3;
    gd.wy = g.s.y + ky * 3;
    gd.has = true;
    return;
  }
  // no key gets her nearer in half a second (she is on the goal, or in a tight spot): the next route tile
  if (route.length >= 4) {
    gd.wx = route[2]! + 0.5;
    gd.wy = route[3]! + 0.5;
    gd.has = true;
  }
}

/** Called every step of play: cheap unless the distances must be worked out again. */
export function stepGuide(g: Game): void {
  const gd = guideOf(g);
  const tgt = g.rt.target;
  if (!tgt) {
    gd.key = '';
    gd.has = false;
    gd.none = false;
    gd.far = false;
    gd.direct = false;
    gd.door = null;
    gd.house = false;
    gd.doorNear = false;
    return;
  }
  gd.far = farFrom(g, tgt, gd.far);
  const s = g.s;
  const key = `${tgt.area}:${Math.floor(tgt.x + 0.5)}:${Math.floor(tgt.y + 0.5)}:${s.area}:${g.rt.worldRev}`;
  if (gd.coolT > 0) gd.coolT--;
  // a goal that moves (an enemy) is worked out again at most four times a second; a new area or goal at once
  // package 69: a goal that jumps (from a step's mark to the enemy it spawned, from one enemy to another) is new too
  const [, ox, oy] = gd.key.split(':');
  const jump = Math.abs(Number(ox) - Math.floor(tgt.x + 0.5)) + Math.abs(Number(oy) - Math.floor(tgt.y + 0.5)) > 3;
  const fresh = jump || !gd.key.startsWith(`${tgt.area}:`) || !gd.key.endsWith(`:${s.area}:${g.rt.worldRev}`);
  if (key !== gd.key && (fresh || gd.coolT <= 0)) {
    gd.key = key;
    gd.coolT = 15;
    workOut(g, gd, tgt);
    if (fresh) gd.last = -1;
    gd.door = tgt.area === s.area ? null : doorTowards(g, s.area, tgt.area);
    gd.house = !!gd.door && !g.c.areas[s.area]?.indoor && !!g.c.areas[gd.door.to]?.indoor;
    if (fresh) gd.doorNear = false;
    // no way without breaking a cracked rock (chapter 7's diamond ledge): then that is the way
    if (distAt(g, gd, s.x, s.y) < 0) workOut(g, gd, tgt, true);
    gd.aimT = 0;
  }
  if (gd.house && gd.door) {
    const dx = Math.abs(gd.door.x + 0.5 - s.x);
    const dy = Math.abs(gd.door.y + 0.5 - s.y);
    gd.doorNear = gd.doorNear ? dx <= DOOR_OUT_X && dy <= DOOR_OUT_Y : dx <= DOOR_IN_X && dy <= DOOR_IN_Y;
  } else gd.doorNear = false;
  if (--gd.aimT <= 0) {
    gd.aimT = 8;
    aim(g, gd);
    gd.none = distAt(g, gd, s.x, s.y) < 0;
    gd.why = '';
    if (gd.none) {
      // a closed barrier on the straight way there says what is missing ("Build the bridge first" and the like)
      const end = routeEnd(g, tgt);
      if (end) {
        const hx = Math.floor(s.x);
        const hy = Math.floor(s.y);
        const n = Math.max(Math.abs(end.x - hx), Math.abs(end.y - hy));
        for (let i = 1; i <= n && !gd.why; i++) {
          const b = barrierAt(
            g,
            s.area,
            Math.round(hx + ((end.x - hx) * i) / n),
            Math.round(hy + ((end.y - hy) * i) / n),
          );
          if (b) gd.why = b.hint;
        }
      }
    }
  }
}

/** Can she stand on this spot and reach the goal from it? (for tests) */
export function onTheWay(g: Game, x: number, y: number): boolean {
  return free(g, g.s.area, x, y, HALF) && distAt(g, guideOf(g), x, y) >= 0;
}

/** The ground she can walk to from where she is now, per area (worked out again when the world or her area changes). */
let reachKey = '';
let reachMap: Uint8Array = new Uint8Array(0);

/** Can she walk to (or right beside) this spot from where she stands? (a fight's star never sits on a mob over water) */
export function canReach(g: Game, x: number, y: number): boolean {
  const s = g.s;
  const a = g.c.areas[s.area];
  if (!a) return false;
  const hx = Math.floor(s.x);
  const hy = Math.floor(s.y);
  const key = `${s.area}:${g.rt.worldRev}`;
  if (key !== reachKey || !reachMap[hy * a.w + hx]) {
    reachKey = key;
    reachMap = flood(g.rt.solid[s.area]!, a.w, a.h, hx, hy);
  }
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const nx = tx + dx;
      const ny = ty + dy;
      if (nx >= 0 && ny >= 0 && nx < a.w && ny < a.h && reachMap[ny * a.w + nx]) return true;
    }
  return false;
}
