// The tile grid: terrain, collision, liveness of map objects and path finding.
import { test } from './cond.ts';
import type { AreaDef, Game, MapObj, ObjectType } from './types.ts';

export const TILE = 64;

/** One character per tile. `walk` 0 never, 1 always, 2 only in wellies. `water` names the fishing water. */
export const TERRAIN: Record<string, { name: string; walk: 0 | 1 | 2; water?: 'sea' | 'river' | 'pond' | 'cave' }> = {
  g: { name: 'grass', walk: 1 },
  G: { name: 'blockgrass', walk: 1 },
  d: { name: 'darkgrass', walk: 1 },
  p: { name: 'path', walk: 1 },
  k: { name: 'cobble', walk: 1 },
  s: { name: 'sand', walk: 1 },
  m: { name: 'mud', walk: 2 },
  f: { name: 'floor', walk: 1 },
  t: { name: 'stone', walk: 1 },
  a: { name: 'ash', walk: 1 },
  b: { name: 'bridge', walk: 1 },
  e: { name: 'steps', walk: 1 },
  o: { name: 'soil', walk: 1 },
  w: { name: 'river', walk: 0, water: 'river' },
  W: { name: 'sea', walk: 0, water: 'sea' },
  q: { name: 'pond', walk: 0, water: 'pond' },
  u: { name: 'cavewater', walk: 0, water: 'cave' },
  c: { name: 'cliff', walk: 0 },
  r: { name: 'rock', walk: 0 },
  v: { name: 'void', walk: 0 },
  h: { name: 'hedge', walk: 0 },
};

export function terrainAt(a: AreaDef, tx: number, ty: number): string {
  if (tx < 0 || ty < 0 || tx >= a.w || ty >= a.h) return 'v';
  return a.terrain[ty]!.charAt(tx);
}
export function regionAt(a: AreaDef, tx: number, ty: number): string {
  if (tx < 0 || ty < 0 || tx >= a.w || ty >= a.h) return ' ';
  return a.region[ty]!.charAt(tx);
}

export function objType(g: Game, o: MapObj): ObjectType {
  return g.c.objects[o.type]!;
}

/** Is this map object in the world right now? Its condition holds, it has not been taken, and a used-up node that leaves no stump is gone. */
export function objLive(g: Game, o: MapObj): boolean {
  if (o.if && !test(g, o.if)) return false;
  if (g.s.taken[o.id]) return false;
  const t = g.c.objects[o.type];
  if (t?.node && !t.node.stump && g.s.nodes[o.id] !== undefined) return false;
  return true;
}
/** A resource node that has been used and has not grown back. */
export function nodeUsed(g: Game, o: MapObj): boolean {
  return g.s.nodes[o.id] !== undefined;
}

/** Rebuild collision and the object lookup for one area. Cheap enough to run whenever the world changes. */
export function rebuildArea(g: Game, areaId: string): void {
  const a = g.c.areas[areaId]!;
  const n = a.w * a.h;
  const solid = g.rt.solid[areaId] ?? (g.rt.solid[areaId] = new Uint8Array(n));
  const objAt = g.rt.objAt[areaId] ?? (g.rt.objAt[areaId] = new Int32Array(n));
  const live = g.rt.live[areaId] ?? (g.rt.live[areaId] = new Uint8Array(a.objects.length));
  const wellies = (g.s.pouch.wellies ?? 0) > 0;
  for (let y = 0; y < a.h; y++) {
    const row = a.terrain[y]!;
    for (let x = 0; x < a.w; x++) {
      const t = TERRAIN[row.charAt(x)];
      const walk = t ? t.walk : 0;
      solid[y * a.w + x] = walk === 1 || (walk === 2 && wellies) ? 0 : 1;
    }
  }
  objAt.fill(-1);
  for (let i = 0; i < a.objects.length; i++) {
    const o = a.objects[i]!;
    const isLive = objLive(g, o);
    live[i] = isLive ? 1 : 0;
    if (!isLive) continue;
    const t = g.c.objects[o.type];
    if (!t) continue;
    const w = t.w ?? 1;
    const h = t.h ?? 1;
    // package 60: a chopped tree's stump is low; she walks over it (it was a wall she could not see)
    const block = t.solid && !(t.node?.stump && g.s.nodes[o.id] !== undefined);
    for (let dy = 0; dy < h; dy++)
      for (let dx = 0; dx < w; dx++) {
        const tx = o.x + dx;
        const ty = o.y + dy;
        if (tx < 0 || ty < 0 || tx >= a.w || ty >= a.h) continue;
        const k = ty * a.w + tx;
        if (block) solid[k] = 1;
        // A solid or interactive object owns the tile for Space; flat decoration does not hide what is on it.
        if (t.solid || t.interact || t.node) objAt[k] = i;
      }
    // package 68: a tall roof stands over the rows behind the walls; she cannot walk up onto it
    const roof = block ? (ROOF_ROWS[o.type] ?? 0) : 0;
    for (let dy = 1; dy <= roof; dy++)
      for (let dx = 0; dx < w; dx++) {
        const tx = o.x + dx;
        const ty = o.y - dy;
        if (tx >= 0 && ty >= 0 && tx < a.w && ty < a.h) solid[ty * a.w + tx] = 1;
      }
  }
  for (const b of a.barriers) {
    if (g.s.flags[b.flag]) continue;
    for (let dy = 0; dy < b.rect.h; dy++)
      for (let dx = 0; dx < b.rect.w; dx++) {
        const tx = b.rect.x + dx;
        const ty = b.rect.y + dy;
        if (tx >= 0 && ty >= 0 && tx < a.w && ty < a.h) solid[ty * a.w + tx] = 1;
      }
  }
  for (const p of g.s.placed) {
    if (p.area !== areaId) continue;
    const def = g.c.items[p.item]?.place;
    if (!def?.solid) continue;
    const w = p.rot && p.rot % 2 ? (def.h ?? 1) : (def.w ?? 1);
    const h = p.rot && p.rot % 2 ? (def.w ?? 1) : (def.h ?? 1);
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) solid[(p.y + dy) * a.w + p.x + dx] = 1;
  }
  g.rt.worldRev++;
}

/**
 * Package 68 (D75: rules never read a picture's size): rows above a building's footprint that its roof covers, so
 * she cannot stand on the roof (run a 0061). Numbers for the pictures of 19 Nov 2026 (roof height over the
 * footprint: cottage 1.0, cafe 1.8, lighthouse 3.0 tiles); they belong with the building's data (`objects.ts`).
 */
export const ROOF_ROWS: Record<string, number> = {
  cottage: 1,
  cafe: 2,
  dollhouse: 2,
  nanny_nook: 1,
  greenhouse: 2,
  bing_house: 2,
};

/** How far off a door's middle (in tiles) walking into it still takes her in (package 68). */
export const DOOR_SLACK = 1.35;

/**
 * The way into a door (package 68): towards its one walled side when the side opposite is open (a house door: up
 * into the house; a room's way out: down). Null when that is not clear: then any step onto it goes through.
 */
export function doorInto(g: Game, area: string, d: { x: number; y: number }): [number, number] | null {
  const a = g.c.areas[area]!;
  const solid = g.rt.solid[area];
  if (!solid) return null;
  const shut = (x: number, y: number) => x < 0 || y < 0 || x >= a.w || y >= a.h || solid[y * a.w + x] === 1;
  let into: [number, number] | null = null;
  let n = 0;
  for (const [ix, iy] of [
    [0, -1],
    [1, 0],
  ] as const) {
    const fwd = shut(d.x + ix, d.y + iy);
    const back = shut(d.x - ix, d.y - iy);
    if (fwd === back) continue;
    into = fwd ? [ix, iy] : [-ix, -iy];
    n++;
  }
  return n === 1 ? into : null;
}

export function rebuildAll(g: Game): void {
  for (const id in g.c.areas) rebuildArea(g, id);
}

export function solidAt(g: Game, areaId: string, tx: number, ty: number): boolean {
  const a = g.c.areas[areaId]!;
  if (tx < 0 || ty < 0 || tx >= a.w || ty >= a.h) return true;
  return g.rt.solid[areaId]![ty * a.w + tx] === 1;
}

/** The closed barrier covering a tile, if any (for the "you need..." hint). */
export function barrierAt(g: Game, areaId: string, tx: number, ty: number) {
  for (const b of g.c.areas[areaId]!.barriers) {
    if (g.s.flags[b.flag]) continue;
    if (tx >= b.rect.x && ty >= b.rect.y && tx < b.rect.x + b.rect.w && ty < b.rect.y + b.rect.h) return b;
  }
  return null;
}

/** Can a body with this half-width stand at (x, y)? Positions are in tiles. */
export function free(g: Game, areaId: string, x: number, y: number, half = 0.28): boolean {
  const a = g.c.areas[areaId]!;
  const solid = g.rt.solid[areaId]!;
  const x0 = Math.floor(x - half);
  const x1 = Math.floor(x + half);
  const y0 = Math.floor(y - half);
  const y1 = Math.floor(y + half);
  for (let ty = y0; ty <= y1; ty++)
    for (let tx = x0; tx <= x1; tx++) {
      if (tx < 0 || ty < 0 || tx >= a.w || ty >= a.h) return false;
      if (solid[ty * a.w + tx]) return false;
    }
  return true;
}

// ---------------------------------------------------------------- path finding (A*, 8 directions, no corner cutting)

const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DY = [0, 0, 1, -1, 1, -1, 1, -1];
let gScore = new Float32Array(0);
let came = new Int32Array(0);
let stamp = new Uint32Array(0);
let closed = new Uint32Array(0);
let heap = new Int32Array(0);
let heapF = new Float32Array(0);
let gen = 0;

/**
 * Shortest walk from one tile to another. Returns a flat list [x0, y0, x1, y1, ...] that leaves out the start,
 * or null when there is no way. `near` accepts stopping on any tile within that many tiles of the goal (for solid goals).
 */
export function findPath(
  solid: Uint8Array,
  w: number,
  h: number,
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  near = 0,
  maxNodes = 60000,
): number[] | null {
  const n = w * h;
  if (gScore.length < n) {
    gScore = new Float32Array(n);
    came = new Int32Array(n);
    stamp = new Uint32Array(n);
    closed = new Uint32Array(n);
    heap = new Int32Array(n * 4);
    heapF = new Float32Array(n * 4);
  }
  if (sx < 0 || sy < 0 || sx >= w || sy >= h || tx < 0 || ty < 0 || tx >= w || ty >= h) return null;
  gen++;
  if (gen > 0xfffffff0) {
    stamp.fill(0);
    closed.fill(0);
    gen = 1;
  }
  const start = sy * w + sx;
  let size = 0;
  const push = (node: number, f: number) => {
    let i = size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heapF[p]! <= f) break;
      heap[i] = heap[p]!;
      heapF[i] = heapF[p]!;
      i = p;
    }
    heap[i] = node;
    heapF[i] = f;
  };
  const pop = (): number => {
    const top = heap[0]!;
    size--;
    if (size > 0) {
      const node = heap[size]!;
      const f = heapF[size]!;
      let i = 0;
      for (;;) {
        let c = i * 2 + 1;
        if (c >= size) break;
        if (c + 1 < size && heapF[c + 1]! < heapF[c]!) c++;
        if (heapF[c]! >= f) break;
        heap[i] = heap[c]!;
        heapF[i] = heapF[c]!;
        i = c;
      }
      heap[i] = node;
      heapF[i] = f;
    }
    return top;
  };
  const hx = (x: number, y: number) => {
    const dx = Math.abs(x - tx);
    const dy = Math.abs(y - ty);
    return dx > dy ? dx + dy * 0.4142 : dy + dx * 0.4142;
  };
  gScore[start] = 0;
  stamp[start] = gen;
  came[start] = -1;
  push(start, hx(sx, sy));
  let found = -1;
  let seen = 0;
  while (size > 0) {
    const cur = pop();
    if (closed[cur] === gen) continue;
    closed[cur] = gen;
    const cx = cur % w;
    const cy = (cur - cx) / w;
    if (
      near > 0
        ? Math.max(Math.abs(cx - tx), Math.abs(cy - ty)) <= near && (cx === tx || cy === ty || near > 1)
        : cur === ty * w + tx
    ) {
      found = cur;
      break;
    }
    if (++seen > maxNodes) break;
    const gc = gScore[cur]!;
    for (let d = 0; d < 8; d++) {
      const nx = cx + DX[d]!;
      const ny = cy + DY[d]!;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const nk = ny * w + nx;
      if (solid[nk] || closed[nk] === gen) continue;
      if (d >= 4 && (solid[cy * w + nx] || solid[ny * w + cx])) continue;
      const ng = gc + (d >= 4 ? Math.SQRT2 : 1);
      if (stamp[nk] !== gen || ng < gScore[nk]!) {
        gScore[nk] = ng;
        stamp[nk] = gen;
        came[nk] = cur;
        push(nk, ng + hx(nx, ny));
      }
    }
  }
  if (found < 0) return null;
  const out: number[] = [];
  for (let k = found; k !== start && k >= 0; k = came[k]!) {
    out.push(Math.floor(k / w), k % w);
  }
  out.reverse();
  return out;
}

/** Every tile reachable from a start tile (for the map gate check and for placing things). */
export function flood(solid: Uint8Array, w: number, h: number, sx: number, sy: number): Uint8Array {
  const seen = new Uint8Array(w * h);
  if (solid[sy * w + sx]) return seen;
  const stack = [sy * w + sx];
  seen[sy * w + sx] = 1;
  while (stack.length) {
    const k = stack.pop()!;
    const x = k % w;
    const y = (k - x) / w;
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d]!;
      const ny = y + DY[d]!;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const nk = ny * w + nx;
      if (seen[nk] || solid[nk]) continue;
      seen[nk] = 1;
      stack.push(nk);
    }
  }
  return seen;
}

/** The nearest tile to (tx, ty) that a body can stand on, searching outwards in rings. */
export function nearestFree(
  g: Game,
  areaId: string,
  tx: number,
  ty: number,
  maxR = 6,
): { x: number; y: number } | null {
  if (!solidAt(g, areaId, tx, ty)) return { x: tx, y: ty };
  for (let r = 1; r <= maxR; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (!solidAt(g, areaId, tx + dx, ty + dy)) return { x: tx + dx, y: ty + dy };
      }
  return null;
}
