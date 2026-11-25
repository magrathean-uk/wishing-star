// Ground baker: turns the tile maps into painted ground images cut into 512 px chunks the game streams (small chunks
// keep the ring of resident ground round the camera tight: 1 MB each instead of 4).
// node tools/map/bake.ts [--area id] [--set n|s] [--chunks cx_cy,...] [--fences]
// Writes public/assets/ground/<area>/<set>/<cx>_<cy>.webp, public/assets/ground/index.json and art/qa/ground-<area>-<set>.jpg.
// Everything is computed in world pixels, so neighbouring chunks meet without seams. Water tiles are holes (alpha 0).
// Rooms (indoor areas) get straight edges, a wall face above the floor (wood, stone or rock), trims and a few painted pieces.
// Bridges behind a 'broken_bridge' barrier are baked broken (real water shows through); the whole bridge is written as
// art/src/objects/bridge_<barrier id>.png (and _snow) for the view to lay over the gap once it is built: run pack after.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainThread, parentPort, Worker } from 'node:worker_threads';
import sharp from 'sharp';
import { TERRAIN } from '../../src/core/grid.ts';
import type { AreaDef } from '../../src/core/types.ts';
import { objects } from '../../src/data/objects.ts';
import {
  fbm,
  hash,
  hueShift,
  type RGB,
  regrade,
  seamless,
  seeded,
  smoothstep,
  snowify,
  standIn,
  TS,
} from './bakeutil.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TILE = 64;
const CHUNK = 512;
const CT = CHUNK / TILE;
const SMALL = CHUNK / 8;
// BAKE_OUT and BAKE_QA send a trial bake elsewhere (package 52), so the shared ground is not touched while painting
const OUT = process.env.BAKE_OUT ?? join(ROOT, 'public', 'assets', 'ground');
const QA = process.env.BAKE_QA ?? join(ROOT, 'art', 'qa');
const BLOCKY = 'LFCMK';

/**
 * Fixed painted details, centred at x, y in tiles.
 * An art id is an object picture; 'items/<id>' is an item picture. s scales the piece.
 */
const FIXED_DECOR: Record<string, { art: string; x: number; y: number; s?: number }[]> = {
  // Piles bracket the chest landing at the western end of the pond jetty. The front pair show below the deck.
  island: [
    { art: 'jetty_post', x: 41.03, y: 77.02, s: 0.54 },
    { art: 'jetty_post', x: 41.52, y: 77.02, s: 0.54 },
    { art: 'jetty_post', x: 41.03, y: 78.16, s: 0.65 },
    { art: 'jetty_post', x: 41.52, y: 78.16, s: 0.65 },
  ],
  cottage: [
    { art: 'window_wall', x: 3.5, y: 0.5 },
    { art: 'picture_wall', x: 5.5, y: 0.45 },
    { art: 'window_wall', x: 10.5, y: 0.5 },
    { art: 'picture_wall', x: 12.5, y: 0.45 },
    { art: 'window_wall', x: 14.2, y: 0.5 },
    { art: 'rug_round', x: 5, y: 5.3 },
    { art: 'door_mat', x: 6.5, y: 8.62 },
  ],
  // the five houses she can walk into (tools/map/interiors.ts): few pieces, so the rooms stay calm
  workshop_in: [
    { art: 'window_wall', x: 2.5, y: 0.5 },
    { art: 'items/wood_axe', x: 4.7, y: 0.45, s: 0.6 },
    { art: 'items/stone_pick', x: 5.5, y: 0.45, s: 0.6 },
    { art: 'items/wood_spade', x: 6.3, y: 0.45, s: 0.6 },
    { art: 'window_wall', x: 8, y: 0.5 },
    { art: 'door_mat', x: 3.5, y: 6.62 },
  ],
  heeler_in: [
    { art: 'window_wall', x: 3.5, y: 0.5 },
    { art: 'picture_wall', x: 6, y: 0.45 },
    { art: 'window_wall', x: 8.5, y: 0.5 },
    { art: 'items/carpet_blue', x: 5.5, y: 3.6, s: 2.4 },
    { art: 'door_mat', x: 6.5, y: 6.62 },
  ],
  peppa_in: [
    { art: 'window_wall', x: 3.5, y: 0.5 },
    { art: 'items/painting_sea', x: 6, y: 0.45, s: 0.75 },
    { art: 'window_wall', x: 8.5, y: 0.5 },
    { art: 'items/carpet_red', x: 7, y: 3.4, s: 2.2 },
    { art: 'door_mat', x: 5.5, y: 6.62 },
  ],
  bing_in: [
    { art: 'window_wall', x: 4.5, y: 0.5 },
    { art: 'items/painting_star', x: 6.5, y: 0.45, s: 0.75 },
    { art: 'items/rainbow_rug', x: 5.5, y: 3.5, s: 2.4 },
    { art: 'door_mat', x: 6.5, y: 6.62 },
  ],
  village_in: [
    { art: 'items/glass', x: 4.5, y: 0.5, s: 0.7 },
    { art: 'items/glass', x: 7.5, y: 0.5, s: 0.7 },
    { art: 'door_mat', x: 4.5, y: 6.62 },
  ], // package 72: the rooms of every other building (tools/map/rooms.ts)
  cafe_in: [
    { art: 'window_wall', x: 8.5, y: 0.5 },
    { art: 'picture_wall', x: 10.5, y: 0.45 },
    { art: 'window_wall', x: 12.5, y: 0.5 },
    { art: 'window_wall', x: 15.5, y: 0.5 },
    { art: 'items/carpet_red', x: 6, y: 4.5, s: 2 },
    { art: 'door_mat', x: 9.5, y: 6.62 },
  ],
  doll_in: [
    { art: 'window_wall', x: 3.5, y: 0.5 },
    { art: 'items/painting_star', x: 7.5, y: 0.45, s: 0.7 },
    { art: 'window_wall', x: 11.5, y: 0.5 },
    { art: 'items/purple_rug', x: 7.5, y: 4.8, s: 2.4 },
    { art: 'door_mat', x: 7.5, y: 7.62 },
  ],
  post_in: [
    { art: 'window_wall', x: 11.5, y: 0.5 },
    { art: 'items/painting_sea', x: 5.2, y: 0.45, s: 0.6 },
    { art: 'door_mat', x: 6.5, y: 6.62 },
  ],
  nook_in: [
    { art: 'window_wall', x: 5.5, y: 0.5 },
    { art: 'picture_wall', x: 7, y: 0.45 },
    { art: 'items/rug', x: 3.5, y: 3.4, s: 1.8 },
    { art: 'door_mat', x: 4.5, y: 5.62 },
  ],
  school_in: [
    { art: 'window_wall', x: 3.5, y: 0.5 },
    { art: 'window_wall', x: 5.3, y: 0.5 },
    { art: 'window_wall', x: 11.7, y: 0.5 },
    { art: 'items/rug', x: 14.5, y: 6.6, s: 1.6 },
    { art: 'door_mat', x: 7.5, y: 7.62 },
  ],
  green_in: [{ art: 'door_mat', x: 8.5, y: 4.62 }],
  lookout_in: [{ art: 'items/dads_map', x: 4.2, y: 0.75, s: 0.45 }],
  lighthouse_in: [
    { art: 'window_round', x: 5, y: 0.5 },
    { art: 'door_mat', x: 5.5, y: 7.62 },
  ],
  keeper_in: [
    { art: 'window_round', x: 5.5, y: 0.5 },
    { art: 'items/rug', x: 5.5, y: 5.4, s: 1.6 },
  ],
  tree_in: [
    { art: 'window_wall', x: 4.5, y: 0.5 },
    { art: 'items/gum_leaf', x: 3.6, y: 0.35, s: 0.5 },
    { art: 'items/gum_leaf', x: 5.4, y: 0.35, s: 0.5 },
    { art: 'items/rug', x: 4.5, y: 3, s: 1.4 },
  ],
  vh1_in: [
    { art: 'items/glass', x: 6.5, y: 0.5, s: 0.7 },
    { art: 'items/glass', x: 9.5, y: 0.5, s: 0.7 },
    { art: 'door_mat', x: 3.5, y: 5.62 },
  ],
  vh3_in: [
    { art: 'items/wheat', x: 2.5, y: 0.4, s: 0.6 },
    { art: 'items/glass', x: 6, y: 0.5, s: 0.7 },
    { art: 'items/glass', x: 9.5, y: 0.5, s: 0.7 },
    { art: 'door_mat', x: 4.5, y: 7.62 },
  ],
  vh4_in: [
    { art: 'items/glass', x: 3.5, y: 0.5, s: 0.7 },
    { art: 'items/glass', x: 9.5, y: 0.5, s: 0.7 },
    { art: 'door_mat', x: 3.5, y: 5.62 },
  ],
  mill_in: [
    { art: 'mill_wheel', x: 5.5, y: 1, s: 0.95 },
    { art: 'door_mat', x: 5.5, y: 7.62 },
  ],
};

type Face = 'wood' | 'stone' | 'rock' | 'block' | 'tower' | 'glass' | 'bay' | 'hill';
/** What each room's walls are made of: wood for homes, stone for the Hall and the workshop, blocks in the village. */
const ROOM_FACE: Record<string, Face> = {
  cottage: 'wood',
  hall: 'stone',
  workshop_in: 'stone',
  heeler_in: 'wood',
  peppa_in: 'wood',
  bing_in: 'wood',
  village_in: 'block',
  // package 72: brick for the Post Office, stone for the lighthouse and the mason, glass-pale wood for the greenhouse
  cafe_in: 'wood',
  doll_in: 'wood',
  post_in: 'stone',
  nook_in: 'wood',
  school_in: 'wood',
  green_in: 'glass',
  lookout_in: 'bay',
  beacon_in: 'hill',
  tree_in: 'wood',
  lighthouse_in: 'tower',
  keeper_in: 'tower',
  lamp_in: 'tower',
  vh1_in: 'block',
  vh3_in: 'block',
  vh4_in: 'stone',
  mill_in: 'wood',
};
/** A colour each family's wood walls lean towards, and how far: cream boards, a yellow house, a pale cottage. */
const ROOM_TINT: Record<string, { to: RGB; k: number }> = {
  heeler_in: { to: [232, 220, 192], k: 0.45 },
  peppa_in: { to: [240, 200, 96], k: 0.4 },
  bing_in: { to: [226, 206, 172], k: 0.35 },
  cafe_in: { to: [236, 200, 180], k: 0.35 },
  doll_in: { to: [245, 190, 225], k: 0.5 },
  post_in: { to: [196, 112, 92], k: 0.45 },
  school_in: { to: [240, 222, 150], k: 0.45 },
  nook_in: { to: [232, 200, 140], k: 0.3 },
  vh1_in: { to: [220, 170, 110], k: 0.25 },
  vh3_in: { to: [238, 220, 170], k: 0.5 },
  mill_in: { to: [225, 200, 160], k: 0.3 },
};

// ---------------------------------------------------------------- the painted look (phase 2, part G)
// Outdoor ground outside the blocky regions is painted: soft colour washes, wobbly paths drawn as layered strokes,
// banks in bands where land meets water, and a seeded scatter of painted pieces from art/src/landscape (taken from
// the Codex game's landscape atlas), with a few grass tufts drawn round them. Same seed, same picture every time.
const LAND_DIR = join(ROOT, 'art/src/landscape');

/** Terrains whose texture is repainted from a landscape texture: source, target colour, contrast, original kept. */
const PAINTED: Record<string, { src: string; to: RGB; contrast: number; keep: number; ours: number }> = {
  // package 45: a warmer, quieter green and a dustier clay; package 48: more golden still, a paler clay
  grass: { src: 'grass', to: [160, 156, 86], contrast: 2.4, keep: 0, ours: 0.3 },
  path: { src: 'path', to: [214, 182, 132], contrast: 1.3, keep: 0.15, ours: 0 },
};

type ChipKind = 'grass' | 'dry' | 'stone' | 'flower' | 'reed' | 'wet';
/** Pieces of the landscape atlas (4 x 6 cells of 200 x 115, each piece centred in its cell); their size is measured. */
const CHIPS: Record<string, { cell: number; kind: ChipKind }> = {
  tussock: { cell: 0, kind: 'grass' },
  sedge: { cell: 1, kind: 'reed' },
  straw: { cell: 2, kind: 'dry' },
  flowers: { cell: 4, kind: 'flower' },
  fern: { cell: 5, kind: 'grass' },
  scree: { cell: 7, kind: 'stone' },
  rocks: { cell: 10, kind: 'stone' },
  wetrock: { cell: 11, kind: 'wet' },
  reeds: { cell: 12, kind: 'reed' },
  lilies: { cell: 13, kind: 'wet' },
  shale: { cell: 14, kind: 'stone' },
  fringe: { cell: 17, kind: 'dry' },
};
/** The sizes a piece is drawn at, as a share of its atlas size: each is resized once, crisply, and laid 1:1. */
const SCALES = [0.24, 0.29, 0.34, 0.4, 0.46, 0.53, 0.6];
/** What grows where (package 48): drifts along paths, fences and tree feet, reeds and stones on the banks. */
// package 52: no bare golden fringe strips; every list long enough that a drift never shows the same piece twice
const MEADOW = ['tussock', 'straw', 'flowers', 'fern', 'shale', 'scree', 'sedge', 'rocks'];
const PATHSIDE = ['tussock', 'straw', 'flowers', 'scree', 'rocks', 'fern', 'sedge'];
const TREEFOOT = ['fern', 'tussock', 'flowers', 'straw', 'shale', 'sedge'];
const FENCESIDE = ['tussock', 'straw', 'flowers', 'fern', 'sedge', 'scree'];
const BANKSIDE = ['reeds', 'sedge', 'rocks', 'tussock', 'scree', 'shale', 'fern'];
const SHORE = ['rocks', 'scree', 'shale'];

interface Chip {
  x: number;
  y: number;
  w: number;
  h: number;
  name: string;
  /** index into SCALES */
  b: number;
  flip: boolean;
}
interface Tuft {
  x: number;
  y: number;
  size: number;
  seed: number;
  /** a small cluster of flowers instead of blades: 1 white, 2 yellow, 3 red */
  bloom?: number;
}
/** A soft contact shadow baked under something that never moves: an ellipse in world pixels, k its depth. */
interface Shade {
  x: number;
  y: number;
  rx: number;
  ry: number;
  k: number;
  /** half lengths (world px) of a flat middle along x and y, so the shades of a run join into one even band */
  lx?: number;
  ly?: number;
}

/** Trees, for their shadows; the view varies their size with the same hash (src/game/world/things.ts). */
const TREES = new Set([
  'oak',
  'pine',
  'palm',
  'dark_oak',
  'birch',
  'gum_tree',
  'apple_tree',
  'orange_tree',
  'banana_tree',
]);
/** Pieces that stand in rows: their shadows join into one. */
const RUNS = new Set(['fence', 'fence_post', 'plot_fence', 'stone_wall', 'hedge', 'rail_fence']);
/** The same steady 0 to 1 per map place as the view's placeHash. */
function placeHash(x: number, y: number, s: number): number {
  let h = Math.imul(x * 374761393 + y * 668265263 + s * 2147483647, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** Frames on legs and how their shade lies: how far up from the foot (tiles) and its half sizes. */
const OPEN_FRAME: Record<string, { up: number; rx: number; ry: number }> = {
  trampoline: { up: 0.2, rx: 1.25, ry: 0.5 },
  swing_set: { up: 0.2, rx: 1.45, ry: 0.42 },
  bandstand: { up: 0.4, rx: 3.0, ry: 0.6 },
};
/** Flat pieces drawn smaller than their tile (package 52: a lily pad the size the trees beside it allow). */
const DECOR_SCALE: Record<string, number> = { lily: 0.6 };
/** Flat pieces the bake leaves out: the old decking under the Heeler house, which has its own painted veranda now. */
const NOT_BAKED = new Set(['veranda']);

// Terrain codes by index, with their kind and layering priority.
const CODES = Object.keys(TERRAIN).join('');
const LAND = 0;
const HOLE = 1;
const OVER = 2;
const WALL = 3;
const VOID = 4;
const LAND_ORDER = 'smadgGopktf';
const KIND = new Uint8Array(CODES.length);
const PRIO = new Uint8Array(CODES.length);
for (let i = 0; i < CODES.length; i++) {
  const c = CODES[i]!;
  KIND[i] = 'wWqu'.includes(c) ? HOLE : 'eb'.includes(c) ? OVER : 'crh'.includes(c) ? WALL : c === 'v' ? VOID : LAND;
  PRIO[i] = LAND_ORDER.indexOf(c) + 1;
}
const CI = (c: string): number => {
  const i = CODES.indexOf(c);
  return i < 0 ? CODES.indexOf('v') : i;
};
const SOFT = new Uint8Array(CODES.length);
for (const c of 'gGdsmapo') SOFT[CI(c)] = 1;
const C_E = CI('e');
const C_B = CI('b');
const C_S = CI('s');
const C_K = CI('k');
const C_T = CI('t');
/** Paths drawn as layered strokes: 2 with a light centre, 1 with a rim only (the Square's cobbles). */
const TRAIL = new Uint8Array(CODES.length);
TRAIL[CI('p')] = 2;
TRAIL[CI('k')] = 1;
/** Ground the scatter may land on. */
const MEADOWY = new Uint8Array(CODES.length);
for (const c of 'gd') MEADOWY[CI(c)] = 1;
MEADOWY[CI('s')] = 2;

type SetId = 'n' | 's';
interface Job {
  area: string;
  set: SetId;
  cx: number;
  cy: number;
}
interface Decor {
  x: number;
  y: number;
  w: number;
  h: number;
  px: Uint8Array;
}
interface Area {
  id: string;
  def: AreaDef;
  /** terrain for the land and water passes: like code, but broken bridges are water */
  lcode: Uint8Array;
  /** 1 + index into brokenRects for tiles of a broken bridge, else 0 */
  broken: Uint8Array;
  brokenRects: { id: string; x0: number; y0: number; x1: number; y1: number; dir: number }[];
  indoor: boolean;
  /** what the wall face above a room's floor is made of */
  face: Face;
  cw: number;
  ch: number;
  gw: number;
  code: Uint8Array;
  blocky: Uint8Array;
  /** for bridge tiles: 1 runs east-west, 2 runs north-south */
  bdir: Uint8Array;
  decor: Decor[];
  /** painted pieces and grass tufts (outdoors only), in world pixels */
  chips: Chip[];
  tufts: Tuft[];
  /** contact shadows under things that stand still (outdoors only) */
  shades: Shade[];
  /** per padded tile: how many tiles a water tile is from land (0 on land), for shallows and depth */
  depth: Float32Array;
  /** per padded tile: 1 near both sand and other land, where the beach edge takes a wider, slower curve */
  beach: Uint8Array;
  /** smooth fields (FS px a cell, padded like the tiles) for the paths and the cobbles, so their edges run in curves */
  fp: Float32Array | null;
  fk: Float32Array | null;
  /** worn earth in front of each door, an ellipse in world pixels */
  wear: Shade[];
}
interface Tex {
  px: Uint8Array;
  proc: boolean;
}

function loadAreas(): Record<string, AreaDef> {
  const island = JSON.parse(readFileSync(join(ROOT, 'src/data/map/island.json'), 'utf8')) as AreaDef;
  const inside = JSON.parse(readFileSync(join(ROOT, 'src/data/map/interiors.json'), 'utf8')) as Record<string, AreaDef>;
  const out: Record<string, AreaDef> = { [island.id]: island };
  for (const [k, a] of Object.entries(inside)) out[k] = a;
  const meetFile = join(ROOT, 'src/data/map/meet.json');
  if (existsSync(meetFile)) out.meet = JSON.parse(readFileSync(meetFile, 'utf8')) as AreaDef;
  return out;
}
const chunksOf = (a: AreaDef) => ({ cw: Math.ceil(a.w / CT), ch: Math.ceil(a.h / CT) });
const setsOf = (a: AreaDef): SetId[] => (a.indoor ? ['n'] : ['n', 's']);

// ---------------------------------------------------------------- worker side

const P = 2;
let E: Float32Array;
let E2: Float32Array;
const TEX: Record<SetId, (Tex | null)[]> = { n: [], s: [] };
const WALLTEX: Record<string, Tex | null> = {};
const AREAS: Record<string, Area> = {};
let E3: Float32Array;
/** each atlas piece as RGBA at every size in SCALES, per ground set (snow-dusted in the snow set) */
interface ChipImg {
  px: Uint8Array;
  w: number;
  h: number;
  /** package 52: how much each pixel is the pale mat under the piece (0 to 1), and the mat's mean brightness */
  mat: Float32Array;
  ml: number;
}
const CHIP_IMG: Record<SetId, Record<string, ChipImg[]>> = { n: {}, s: {} };
/** each atlas piece's measured size in the atlas */
const CHIP_DIM: Record<string, { w: number; h: number }> = {};
/** the measured size of a piece at a scale bucket */
const chipSize = (name: string, b: number): { w: number; h: number } => {
  const d = CHIP_DIM[name] ?? { w: 100, h: 60 };
  return { w: Math.max(2, Math.round(d.w * SCALES[b]!)), h: Math.max(2, Math.round(d.h * SCALES[b]!)) };
};

/**
 * A landscape texture tiled three by three, scaled to half of TS a repeat and cut from the middle, then laid two by
 * two: TS x TS RGB that still tiles. Package 48: half size, so the brushwork stays crisp instead of blown up.
 */
async function loadTiled(file: string): Promise<Uint8Array> {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const big = Buffer.alloc(w * 3 * h * 3 * 3);
  for (let y = 0; y < h * 3; y++)
    for (let k = 0; k < 3; k++) data.copy(big, (y * w * 3 + k * w) * 3, (y % h) * w * 3, ((y % h) + 1) * w * 3);
  const half = TS / 2;
  const one = await sharp(big, { raw: { width: w * 3, height: h * 3, channels: 3 } })
    .resize(half * 3, half * 3, { fit: 'fill', kernel: 'lanczos3' })
    .extract({ left: half, top: half, width: half, height: half })
    .raw()
    .toBuffer();
  const out = new Uint8Array(TS * TS * 3);
  for (let y = 0; y < TS; y++)
    for (let k = 0; k < 2; k++)
      out.set(one.subarray((y % half) * half * 3, ((y % half) + 1) * half * 3), (y * TS + k * half) * 3);
  return out;
}

/** A dry-straw colour (saturated yellow to orange): round stones and flowers it is turned green like the grass. */
function strawy(r: number, g: number, b: number): boolean {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  if (mx < 60 || (mx - mn) / mx < 0.32 || r < g * 0.95 || b > g * 0.8) return false;
  return r < g * 1.45;
}

/** Calmer versions of our own textures: saturation and contrast scaled about the mean. */
const SOFTEN: Record<string, { sat: number; contrast: number }> = {
  cobble: { sat: 0.5, contrast: 0.7 },
  sand: { sat: 0.8, contrast: 0.85 },
  darkgrass: { sat: 0.85, contrast: 0.9 },
  mud: { sat: 0.8, contrast: 0.85 },
  soil: { sat: 0.85, contrast: 0.9 },
};
function soften(px: Uint8Array, sat: number, contrast: number): Uint8Array {
  let mean = 0;
  const n = px.length / 3;
  for (let i = 0; i < n; i++) mean += px[i * 3]! * 0.3 + px[i * 3 + 1]! * 0.59 + px[i * 3 + 2]! * 0.11;
  mean /= n;
  const out = new Uint8Array(px.length);
  for (let i = 0; i < n; i++) {
    const o = i * 3;
    const l = px[o]! * 0.3 + px[o + 1]! * 0.59 + px[o + 2]! * 0.11;
    const l2 = mean + (l - mean) * contrast;
    for (let c = 0; c < 3; c++) out[o + c] = Math.max(0, Math.min(255, Math.round(l2 + (px[o + c]! - l) * sat)));
  }
  return out;
}

async function loadChips(): Promise<void> {
  const file = join(LAND_DIR, 'landscape-atlas.webp');
  if (!existsSync(file)) return;
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (const [name, c] of Object.entries(CHIPS)) {
    // measure the piece inside its cell
    const cx0 = (c.cell % 4) * 200;
    const cy0 = Math.floor(c.cell / 4) * 115;
    let x0 = 200;
    let y0 = 115;
    let x1 = 0;
    let y1 = 0;
    for (let y = 0; y < 115; y++)
      for (let x = 0; x < 200; x++)
        if (data[((cy0 + y) * info.width + cx0 + x) * 4 + 3]! > 10) {
          x0 = Math.min(x0, x);
          y0 = Math.min(y0, y);
          x1 = Math.max(x1, x + 1);
          y1 = Math.max(y1, y + 1);
        }
    if (x1 <= x0) continue;
    const w = x1 - x0;
    const h = y1 - y0;
    CHIP_DIM[name] = { w, h };
    const crop = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++)
      data.copy(
        crop,
        y * w * 4,
        ((cy0 + y0 + y) * info.width + cx0 + x0) * 4,
        ((cy0 + y0 + y) * info.width + cx0 + x1) * 4,
      );
    CHIP_IMG.n[name] = [];
    CHIP_IMG.s[name] = [];
    for (let k = 0; k < SCALES.length; k++) {
      const { w: sw, h: sh } = chipSize(name, k);
      const buf = await sharp(crop, { raw: { width: w, height: h, channels: 4 } })
        .resize(sw, sh, { fit: 'fill', kernel: 'lanczos3' })
        .raw()
        .toBuffer();
      const n = new Uint8Array(sw * sh * 4);
      const sn = new Uint8Array(sw * sh * 4);
      const mat = new Float32Array(sw * sh);
      let ml = 0;
      let mw = 0;
      for (let y = 0; y < sh; y++)
        for (let x = 0; x < sw; x++) {
          const o = (y * sw + x) * 4;
          let [r, g, b] = [buf[o]!, buf[o + 1]!, buf[o + 2]!];
          // package 52: the pale golden mat each piece was painted on (warm, saturated yellow, light), more so towards
          // the rim; the view lays it in the local grass tone, so a clump sits in the grass instead of on a mat
          const l0 = r * 0.3 + g * 0.59 + b * 0.11;
          const dn = Math.hypot((x + 0.5) / sw - 0.5, (y + 0.5) / sh - 0.5) * 2;
          const mk =
            smoothstep(-12, 8, r - g) *
            (1 - smoothstep(55, 85, r - g)) *
            smoothstep(30, 60, g - b) *
            smoothstep(95, 135, l0) *
            (0.55 + 0.45 * smoothstep(0.2, 0.75, dn));
          mat[y * sw + x] = mk;
          if (mk > 0.5 && buf[o + 3]! > 128) {
            ml += l0;
            mw++;
          }
          // the atlas is a dry summer: green pieces lean a little towards our grass, dry ones keep their gold
          if (c.kind === 'grass') [r, g, b] = hueShift(r, g, b, 16, 0.92);
          else if (c.kind === 'reed') [r, g, b] = hueShift(r, g, b, 14, 0.95);
          else if (c.kind === 'dry') [r, g, b] = hueShift(r, g, b, 4, 0.92);
          else if (strawy(r, g, b)) [r, g, b] = hueShift(r, g, b, 12, 0.92);
          // the pale feathered rim the atlas pieces carry is thinned, so a piece sits crisply in our grass
          const al = buf[o + 3]! / 255;
          const a = Math.round(255 * al ** 1.6);
          n[o] = r;
          n[o + 1] = g;
          n[o + 2] = b;
          n[o + 3] = a;
          // snow: a dusting on top, the rest cooled
          const l = r * 0.3 + g * 0.59 + b * 0.11;
          const top = 0.35 + 0.4 * (1 - y / sh);
          sn[o] = l * 0.9 + (236 - l * 0.9) * top;
          sn[o + 1] = l * 0.93 + (242 - l * 0.93) * top;
          sn[o + 2] = l + (252 - l) * top;
          sn[o + 3] = a;
        }
      const mean = mw > 0 ? ml / mw : 170;
      CHIP_IMG.n[name]!.push({ px: n, w: sw, h: sh, mat, ml: mean });
      CHIP_IMG.s[name]!.push({ px: sn, w: sw, h: sh, mat, ml: mean });
    }
  }
}

async function loadPng(file: string, w: number, h: number): Promise<Uint8Array> {
  const { data } = await sharp(file)
    .resize(w, h, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return new Uint8Array(data.buffer, data.byteOffset, data.length);
}

async function initWorker(): Promise<void> {
  sharp.concurrency(1);
  E = fbm(1024, 16, 3, 9001);
  E2 = fbm(1024, 32, 2, 9002);
  E3 = fbm(1024, 8, 2, 9003);
  for (let i = 0; i < CODES.length; i++) {
    const name = TERRAIN[CODES[i]!]!.name;
    const file = join(ROOT, 'art/src/ground', name + '.png');
    let n: Tex | null = null;
    const pt = PAINTED[name];
    const pfile = pt ? join(LAND_DIR, pt.src + '.webp') : '';
    if (pt && existsSync(pfile)) {
      const px = regrade(await loadTiled(pfile), pt.to, pt.contrast, pt.keep);
      if (pt.ours > 0 && existsSync(file)) {
        // a share of our own texture, repainted in the same colour, keeps some blades in the brushwork
        const own = regrade(await loadPng(file, TS, TS), pt.to, 0.9, 0);
        for (let k = 0; k < px.length; k++) px[k] = Math.round(px[k]! * (1 - pt.ours) + own[k]! * pt.ours);
      }
      n = { px, proc: false };
    } else if (existsSync(file)) n = { px: await loadPng(file, TS, TS), proc: false };
    else {
      const p = standIn(name);
      if (p) n = { px: p, proc: true };
    }
    const sf = SOFTEN[name];
    if (n && sf && !n.proc) n = { px: soften(n.px, sf.sat, sf.contrast), proc: false };
    TEX.n[i] = n;
    const sfile = join(ROOT, 'art/src/ground', name + '_snow.png');
    // a repainted path gets its snow from the new texture, not the old snow picture, unless its snow was painted too
    const paintedSnow = existsSync(join(ROOT, 'art/masters/ground/painted', name + '_snow.png'));
    if (existsSync(sfile) && (!(pt && name !== 'grass') || paintedSnow))
      TEX.s[i] = { px: await loadPng(sfile, TS, TS), proc: false };
    else if (n) {
      const s = snowify(name, n.px);
      TEX.s[i] = s ? { px: s, proc: n.proc } : n;
    } else TEX.s[i] = null;
  }
  for (const name of ['wall_wood', 'wall_stone', 'wall_tower', 'wall_glass', 'wall_bay', 'wall_hill']) {
    const file = join(ROOT, 'art/src/ground', name + '.png');
    WALLTEX[name] = existsSync(file) ? { px: await loadPng(file, TS, TS), proc: false } : null;
  }
  await loadChips();
  // the cobbles' mean colour and the path's mean brightness, for the stones and the ragged path edge
  for (const set of ['n', 's'] as const) {
    const k = TEX[set][C_K];
    if (k) {
      const m = [0, 0, 0];
      for (let o = 0; o < k.px.length; o += 3) for (let q = 0; q < 3; q++) m[q]! += k.px[o + q]!;
      COBBLE[set] = m.map((v) => (v * 3) / k.px.length) as RGB;
    }
    const p = TEX[set][C_P];
    if (p) {
      let l = 0;
      for (let o = 0; o < p.px.length; o += 3) l += p.px[o]! * 0.3 + p.px[o + 1]! * 0.59 + p.px[o + 2]! * 0.11;
      PATH_LUM[set] = (l * 3) / p.px.length;
    }
  }
  const defs = loadAreas();
  for (const [id, def] of Object.entries(defs)) AREAS[id] = await prepArea(id, def);
}

/** Clear the pale rim round a picture: near-white pixels reached from the transparent outside, then soften the edge. */
function unring(px: Uint8Array, w: number, h: number): void {
  const pale = (i: number) => {
    const r = px[i * 4]!;
    const g = px[i * 4 + 1]!;
    const b = px[i * 4 + 2]!;
    return Math.min(r, g, b) > 200 && Math.max(r, g, b) - Math.min(r, g, b) < 40;
  };
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let i = 0; i < w * h; i++)
    if (px[i * 4 + 3]! < 40) {
      seen[i] = 1;
      stack.push(i);
    }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    const y = (i - x) / w;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const n = ny * w + nx;
      if (seen[n] || !pale(n)) continue;
      seen[n] = 1;
      px[n * 4 + 3] = 0;
      stack.push(n);
    }
  }
  // a one pixel feather on what is left, so the cut edge is not hard
  const alpha = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) alpha[i] = px[i * 4 + 3]!;
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!alpha[i]) continue;
      if (!alpha[i - 1] || !alpha[i + 1] || !alpha[i - w] || !alpha[i + w]) px[i * 4 + 3] = alpha[i]! >> 1;
    }
}

async function prepArea(id: string, def: AreaDef): Promise<Area> {
  const { cw, ch } = chunksOf(def);
  const gw = cw * CT + 2 * P;
  const gh = ch * CT + 2 * P;
  const code = new Uint8Array(gw * gh);
  const blocky = new Uint8Array(gw * gh);
  const fill = CI(def.indoor ? 'v' : 'W');
  for (let y = 0; y < gh; y++)
    for (let x = 0; x < gw; x++) {
      const tx = x - P;
      const ty = y - P;
      const inside = tx >= 0 && ty >= 0 && tx < def.w && ty < def.h;
      code[y * gw + x] = inside ? CI(def.terrain[ty]!.charAt(tx)) : fill;
      blocky[y * gw + x] = inside && BLOCKY.includes(def.region[ty]!.charAt(tx)) ? 1 : 0;
    }
  const bdir = new Uint8Array(gw * gh);
  for (let y = 1; y < gh - 1; y++)
    for (let x = 1; x < gw - 1; x++) {
      const i = y * gw + x;
      if (code[i] !== C_B) continue;
      const ok = (c: number) => c === C_B || KIND[c] === LAND;
      bdir[i] = ok(code[i - 1]!) || ok(code[i + 1]!) ? 1 : ok(code[i - gw]!) || ok(code[i + gw]!) ? 2 : 1;
    }
  // broken bridges: their tiles become water for the land pass, and only stubs of the bridge are drawn
  const broken = new Uint8Array(gw * gh);
  const brokenRects: Area['brokenRects'] = [];
  const lcode = code.slice();
  for (const b of def.barriers ?? []) {
    if (b.art !== 'broken_bridge') continue;
    const r = b.rect;
    const dir = r.w >= r.h ? 1 : 2;
    brokenRects.push({ id: b.id, x0: r.x * TILE, y0: r.y * TILE, x1: (r.x + r.w) * TILE, y1: (r.y + r.h) * TILE, dir });
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++) {
        const i = (y + P) * gw + x + P;
        if (code[i] !== C_B) continue;
        broken[i] = brokenRects.length;
        bdir[i] = dir;
        lcode[i] = CI('w');
      }
  }
  const decor: Decor[] = [];
  const cache = new Map<string, { px: Uint8Array; w: number; h: number } | null>();
  // Fixed details use art stored at 1.5 x screen size, like every object.
  for (const d of FIXED_DECOR[id] ?? []) {
    const file = join(ROOT, 'art/src', d.art.includes('/') ? d.art : 'objects/' + d.art) + '.png';
    if (!existsSync(file)) continue;
    const meta = await sharp(file).metadata();
    const w = Math.max(1, Math.round(((meta.width ?? 1) * TILE * (d.s ?? 1)) / 96));
    const h = Math.max(1, Math.round(((meta.height ?? 1) * TILE * (d.s ?? 1)) / 96));
    const { data } = await sharp(file)
      .ensureAlpha()
      .resize(w, h, { fit: 'fill' })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const px = new Uint8Array(data.buffer, data.byteOffset, data.length);
    // item pictures carry a white sticker ring: take it off, so the piece sits in the room like paint
    if (d.art.startsWith('items/')) unring(px, w, h);
    decor.push({
      x: Math.round(d.x * TILE - w / 2),
      y: Math.round(d.y * TILE - h / 2),
      w,
      h,
      px,
    });
  }
  for (const o of def.objects) {
    const t = objects[o.type];
    if (!t?.flat || t.interact || t.node || o.if) continue;
    if (NOT_BAKED.has(o.type)) continue;
    // outdoors the painted scatter takes the place of the old grass tuft stickers (blocky regions keep theirs)
    if (o.type === 'grass_tuft' && !def.indoor && !BLOCKY.includes(def.region[o.y]?.charAt(o.x) ?? '')) continue;
    const art = t.art ?? o.type;
    const fw = (t.w ?? 1) * TILE;
    const fh = (t.h ?? 1) * TILE;
    const key = art + '@' + fw + 'x' + fh;
    if (!cache.has(key)) {
      const file = join(ROOT, 'art/src/objects', art + '.png');
      if (!existsSync(file)) cache.set(key, null);
      else {
        const meta = await sharp(file).metadata();
        const s = Math.max(fw / (meta.width ?? 1), fh / (meta.height ?? 1)) * (DECOR_SCALE[o.type] ?? 1);
        const w = Math.max(1, Math.round((meta.width ?? 1) * s));
        const h = Math.max(1, Math.round((meta.height ?? 1) * s));
        const { data } = await sharp(file)
          .ensureAlpha()
          .resize(w, h, { fit: 'fill' })
          .raw()
          .toBuffer({ resolveWithObject: true });
        cache.set(key, { px: new Uint8Array(data.buffer, data.byteOffset, data.length), w, h });
      }
    }
    const img = cache.get(key);
    if (!img) continue;
    const small = DECOR_SCALE[o.type] !== undefined;
    decor.push({
      x: Math.round(o.x * TILE + fw / 2 - img.w / 2),
      // a smaller piece floats in the middle of its tile
      y: small ? Math.round(o.y * TILE + fh / 2 - img.h / 2) : o.y * TILE + fh - img.h,
      w: img.w,
      h: img.h,
      px: img.px,
    });
  }
  const face = ROOM_FACE[id] ?? 'rock';
  const { chips, tufts } = def.indoor ? { chips: [], tufts: [] } : scatter(id, def, code, blocky, gw);
  const shades = def.indoor ? [] : shadesOf(def, blocky, gw);
  // water depth by tiles from land (a breadth-first walk)
  const depth = new Float32Array(gw * gh);
  const queue: number[] = [];
  for (let i = 0; i < gw * gh; i++)
    if (KIND[lcode[i]!] !== HOLE) {
      depth[i] = 0;
      queue.push(i);
    } else depth[i] = 1e9;
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q]!;
    const x = i % gw;
    for (const n of [x > 0 ? i - 1 : -1, x < gw - 1 ? i + 1 : -1, i - gw, i + gw]) {
      if (n < 0 || n >= gw * gh || depth[n]! <= depth[i]! + 1) continue;
      depth[n] = depth[i]! + 1;
      queue.push(n);
    }
  }
  // package 48: two soft passes over the open water, so the deeper band runs in curves, not tile steps
  for (let pass = 0; pass < 2; pass++) {
    const d0 = depth.slice();
    for (let y = 1; y < gh - 1; y++)
      for (let x = 1; x < gw - 1; x++) {
        const i = y * gw + x;
        if (d0[i] === 0) continue;
        let v = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) v += Math.min(8, d0[i + dy * gw + dx]!) * (dx && dy ? 1 : dx || dy ? 2 : 4);
        depth[i] = Math.max(0.5, v / 16);
      }
  }
  // the beach: tiles within 2 of sand and of other land, where the edge between them may wander
  const beach = new Uint8Array(gw * gh);
  for (let y = 2; y < gh - 2; y++)
    for (let x = 2; x < gw - 2; x++) {
      let sand = false;
      let other = false;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const c = lcode[(y + dy) * gw + x + dx]!;
          if (c === C_S) sand = true;
          else if (KIND[c] === LAND && !TRAIL[c]) other = true;
        }
      beach[y * gw + x] = sand && other && !blocky[y * gw + x] ? 1 : 0;
    }
  const fp = def.indoor ? null : trailField(code, gw, gh, CI('p'), blocky);
  const fk = def.indoor ? null : trailField(code, gw, gh, C_K, blocky);
  const wear: Shade[] = [];
  if (!def.indoor)
    for (const d of def.doors ?? []) {
      if (blocky[(d.y + P) * gw + d.x + P]) continue;
      wear.push({ x: (d.x + 0.5) * TILE, y: (d.y + 1.05) * TILE, rx: 0.95 * TILE, ry: 0.62 * TILE, k: 1 });
    }
  return {
    fp,
    fk,
    wear,
    id,
    def,
    cw,
    ch,
    gw,
    code,
    blocky,
    bdir,
    decor,
    lcode,
    broken,
    brokenRects,
    indoor: !!def.indoor,
    face,
    chips,
    tufts,
    shades,
    depth,
    beach,
  };
}

/** Cells per tile in the smooth path fields. */
const FS = 8;
const FPT = TILE / FS;
/**
 * A smooth field for one kind of path: 1 on its tiles, 0 elsewhere, blurred over about a third of a tile, so read at
 * 0.44 its edge runs in curves through the tile corners instead of along the grid. Null when the map has none.
 */
function trailField(code: Uint8Array, gw: number, gh: number, c: number, blocky: Uint8Array): Float32Array | null {
  const W = gw * FPT;
  const H = gh * FPT;
  const m = new Float32Array(W * H);
  let any = false;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = ((y / FPT) | 0) * gw + ((x / FPT) | 0);
      if (code[i] === c && !blocky[i]) {
        m[y * W + x] = 1;
        any = true;
      }
    }
  if (!any) return null;
  const sigma = 3.6;
  const R = 11;
  const k = new Float32Array(2 * R + 1);
  let sum = 0;
  for (let i = -R; i <= R; i++) sum += k[i + R] = Math.exp(-(i * i) / (2 * sigma * sigma));
  for (let i = 0; i < k.length; i++) k[i]! /= sum;
  const t = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let v = 0;
      for (let i = -R; i <= R; i++) v += m[y * W + Math.min(W - 1, Math.max(0, x + i))]! * k[i + R]!;
      t[y * W + x] = v;
    }
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let v = 0;
      for (let i = -R; i <= R; i++) v += t[Math.min(H - 1, Math.max(0, y + i)) * W + x]! * k[i + R]!;
      m[y * W + x] = v;
    }
  return m;
}
/** A smooth path field at world pixel X, Y (bilinear between cells). */
function fieldAt(A: Area, f: Float32Array, X: number, Y: number): number {
  const W = A.gw * FPT;
  const fx = (X + P * TILE) / FS - 0.5;
  const fy = (Y + P * TILE) / FS - 0.5;
  const i = Math.floor(fx);
  const j = Math.floor(fy);
  if (i < 0 || j < 0 || i >= W - 1 || j * W + i + W + 1 >= f.length) return 0;
  const ax = fx - i;
  const ay = fy - j;
  const o = j * W + i;
  return (f[o]! * (1 - ax) + f[o + 1]! * ax) * (1 - ay) + (f[o + W]! * (1 - ax) + f[o + W + 1]! * ax) * ay;
}

/**
 * Contact shadows for things that stand on the ground and never move: a soft ellipse at the foot, a little to the
 * lower right (the light is from the upper left), and a wide faint cool shade round each tree. Blocky regions keep
 * their hard look, so nothing there gets one.
 */
function shadesOf(def: AreaDef, blocky: Uint8Array, gw: number): Shade[] {
  const out: Shade[] = [];
  // where the runs of fence and wall stand, so a run down the screen gets a shadow down its length
  const runAt = new Set<number>();
  for (const o of def.objects) if (RUNS.has(o.type) && !o.if) runAt.add(o.y * 10000 + o.x);
  for (const o of def.objects) {
    const t = objects[o.type];
    if (!t || t.flat || o.if) continue;
    if (blocky[(o.y + P) * gw + o.x + P]) continue;
    const tree = TREES.has(o.type);
    // things she walks through still get a shadow (ferns, signs), except what she picks and what talks
    if (t.solid === false && !tree && (t.node || t.interact)) continue;
    const w = t.w ?? 1;
    const h = t.h ?? 1;
    const cx = (o.x + w / 2) * TILE;
    const fy = (o.y + h) * TILE;
    if (tree) {
      const k = 0.85 + 0.3 * placeHash(o.x, o.y, 1);
      out.push({ x: cx + 0.2 * TILE, y: fy - 0.3 * TILE, rx: 1.9 * TILE * k, ry: 1.1 * TILE * k, k: 0.13 });
      out.push({ x: cx + 0.22 * TILE, y: fy + 0.02 * TILE, rx: 1.0 * TILE * k, ry: 0.4 * TILE * k, k: 0.4 });
    } else if (o.type === 'lantern_string') {
      // a string between two posts shades only the posts' feet
      for (const px of [o.x * TILE + 10, (o.x + w) * TILE - 10])
        out.push({ x: px + 4, y: fy, rx: 0.3 * TILE, ry: 0.14 * TILE, k: 0.4 });
    } else if (OPEN_FRAME[o.type]) {
      // package 52: a frame on legs (a trampoline, a swing) shades the ground under its middle, not just its feet
      const f = OPEN_FRAME[o.type]!;
      out.push({ x: cx + 0.12 * TILE, y: fy - f.up * TILE, rx: f.rx * TILE, ry: f.ry * TILE, k: 0.5 });
      out.push({ x: cx + 0.1 * TILE, y: fy, rx: w * 0.5 * TILE, ry: 0.2 * TILE, k: 0.42 });
    } else if (w >= 3) {
      // package 52: a broad soft shade and a darker core along the foot, so a house sits on the ground by day
      out.push({ x: cx + 0.18 * TILE, y: fy + 0.04 * TILE, rx: (w * 0.5 + 0.35) * TILE, ry: 0.5 * TILE, k: 0.4 });
      out.push({ x: cx + 0.08 * TILE, y: fy + 0.04 * TILE, rx: (w * 0.5 + 0.1) * TILE, ry: 0.24 * TILE, k: 0.56 });
    } else if (RUNS.has(o.type)) {
      // a run of fence or wall: one long low shadow, each piece overlapping the next; down the screen, a long one
      // down its length (package 52: deeper, so a fence stands in the grass)
      const has = (dx: number, dy: number) => runAt.has((o.y + dy) * 10000 + o.x + dx);
      const k = 0.36;
      if ((has(0, -1) || has(0, 1)) && !has(-1, 0) && !has(1, 0))
        out.push({ x: cx + 0.1 * TILE, y: fy - 0.5 * TILE, rx: 0.28 * TILE, ry: 0.2 * TILE, k, ly: 0.5 * TILE });
      else
        out.push({ x: cx + 0.1 * TILE, y: fy - 0.04 * TILE, rx: 0.22 * TILE, ry: 0.22 * TILE, k, lx: w * 0.5 * TILE });
    } else {
      const rx = Math.max(0.5, w * 0.5 + 0.08) * TILE;
      out.push({ x: cx + 0.1 * TILE, y: fy, rx, ry: Math.min(0.36, 0.22 + 0.07 * h) * TILE, k: 0.55 });
    }
  }
  return out;
}

/**
 * The seeded scatter of painted pieces (package 48): drifts of crisp clumps along path sides, fences, tree feet and
 * banks, a thinner sprinkle in the open meadow with open grass between the drifts, reeds and stones straddling the
 * water's edge, lilies and wet stones in the shallows, and small grass tufts and flowers round them. A piece never sits
 * on a path, a wall, a blocky region, a door or under something solid. Every random number is drawn in the same
 * order whatever is placed, so the picture is the same every time.
 */
function scatter(
  id: string,
  def: AreaDef,
  code: Uint8Array,
  blocky: Uint8Array,
  gw: number,
): { chips: Chip[]; tufts: Tuft[] } {
  const chips: Chip[] = [];
  const tufts: Tuft[] = [];
  let seed = 251226;
  for (let i = 0; i < id.length; i++) seed = Math.imul(seed ^ id.charCodeAt(i), 16777619);
  const rng = seeded(seed);
  const at = (tx: number, ty: number) => code[(ty + P) * gw + tx + P]!;
  const near = (tx: number, ty: number, r: number, fn: (c: number) => boolean): boolean => {
    for (let y = ty - r; y <= ty + r; y++) for (let x = tx - r; x <= tx + r; x++) if (fn(at(x, y))) return true;
    return false;
  };
  /** the first of the four neighbours that passes, as a step, or null */
  const side = (tx: number, ty: number, fn: (c: number) => boolean): readonly [number, number] | null => {
    for (const d of [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ] as const)
      if (fn(at(tx + d[0], ty + d[1]))) return d;
    return null;
  };
  const W = def.w * TILE;
  const H = def.h * TILE;
  const tw = def.w;
  // flat things the map already paints (puddles, flower beds) and the ground in front of doors stay clear
  const taken = new Set<number>();
  for (const o of def.objects) {
    const t = objects[o.type];
    if (!t?.flat || o.type === 'grass_tuft') continue;
    for (let y = o.y - 1; y <= o.y + (t.h ?? 1); y++)
      for (let x = o.x - 1; x <= o.x + (t.w ?? 1); x++) taken.add(y * 10000 + x);
  }
  for (const d of def.doors ?? [])
    for (let y = d.y; y <= d.y + 2; y++) for (let x = d.x - 1; x <= d.x + 1; x++) taken.add(y * 10000 + x);
  // what stands where: solid footprints (nothing under them), tree feet, fence runs and the sides of buildings
  const solid = new Uint8Array(tw * def.h);
  const feet = new Uint8Array(tw * def.h);
  const fence = new Uint8Array(tw * def.h);
  const mark = (m: Uint8Array, x: number, y: number) => {
    if (x >= 0 && y >= 0 && x < tw && y < def.h) m[y * tw + x] = 1;
  };
  for (const o of def.objects) {
    const t = objects[o.type];
    if (!t || t.flat || o.if) continue;
    const w = t.w ?? 1;
    const h = t.h ?? 1;
    if (t.solid !== false) for (let y = o.y; y < o.y + h; y++) for (let x = o.x; x < o.x + w; x++) mark(solid, x, y);
    if (TREES.has(o.type))
      for (let y = o.y + h - 1; y <= o.y + h; y++) for (let x = o.x - 1; x <= o.x + w; x++) mark(feet, x, y);
    else if (RUNS.has(o.type)) for (let x = o.x; x < o.x + w; x++) mark(fence, x, o.y + h);
    else if (w >= 2 && t.solid !== false)
      for (let y = o.y + 1; y < o.y + h; y++) {
        mark(fence, o.x - 1, y);
        mark(fence, o.x + w, y);
      }
  }
  const drift = (x: number, y: number): number =>
    0.8 * E3[((((y | 0) >> 3) & 1023) << 10) | (((x | 0) >> 3) & 1023)]! +
    0.2 * E[(((((y | 0) >> 2) + 77) & 1023) << 10) | ((((x | 0) >> 2) + 311) & 1023)]!;
  const free = (tx: number, ty: number): boolean =>
    tx >= 1 &&
    ty >= 1 &&
    tx < tw - 1 &&
    ty < def.h - 1 &&
    !blocky[(ty + P) * gw + tx + P] &&
    !taken.has(ty * 10000 + tx) &&
    !solid[ty * tw + tx];
  const occ = new Set<number>();
  // pieces laid so far, to keep a piece from repeating within a screen (package 52)
  const used: { name: string; b: number; flip: boolean; x: number; y: number }[] = [];
  const reuse = (nm: string, b: number, fl: boolean, x: number, y: number): boolean => {
    for (let i = used.length - 1; i >= 0; i--) {
      const u = used[i]!;
      if (y - u.y > 760) break;
      const dx = Math.abs(u.x - x);
      if (u.name !== nm || dx > 1300) continue;
      if (dx < 300 && y - u.y < 300) return true;
      if (u.b === b && u.flip === fl) return true;
    }
    return false;
  };
  const CELL = 32;
  for (let cy = 0; cy * CELL < H; cy++)
    for (let cx = 0; cx * CELL < W; cx++) {
      const r = [rng(), rng(), rng(), rng(), rng(), rng(), rng(), rng()] as const;
      let x = (cx + 0.15 + r[0] * 0.7) * CELL;
      let y = (cy + 0.15 + r[1] * 0.7) * CELL;
      const tx = Math.floor(x / TILE);
      const ty = Math.floor(y / TILE);
      if (!free(tx, ty)) continue;
      const c = at(tx, ty);
      if (!MEADOWY[c]) continue;
      if (near(tx, ty, 1, (k) => KIND[k] >= WALL || KIND[k] === OVER)) continue;
      const wet = side(tx, ty, (k) => KIND[k] === HOLE);
      const dz = drift(x, y);
      let aff: number;
      let list: string[];
      let lean: readonly [number, number] | null = null;
      // package 52: about a third of package 48's pieces, kept in the drifts, so open grass lies between them
      if (MEADOWY[c] === 2) {
        aff = wet ? 0.22 : 0.02;
        list = SHORE;
      } else if (wet) {
        aff = 0.62;
        list = BANKSIDE;
        lean = wet;
      } else if ((lean = side(tx, ty, (k) => TRAIL[k]! > 0))) {
        aff = 0.33;
        list = PATHSIDE;
      } else if (feet[ty * tw + tx]) {
        aff = 0.42;
        list = TREEFOOT;
      } else if (fence[ty * tw + tx]) {
        aff = 0.38;
        list = FENCESIDE;
      } else {
        aff = 0.115;
        list = MEADOW;
      }
      // drifts with open grass between: the meadow mostly where the slow field is high, a sparse sprinkle elsewhere
      const gate = wet
        ? 0.55 + 0.45 * smoothstep(0.12, 0.5, dz)
        : list === MEADOW
          ? 0.14 + 0.86 * smoothstep(0.5, 0.66, dz)
          : smoothstep(0.36, 0.6, dz);
      if (r[2] >= aff * gate) continue;
      // bank pieces may stand closer, so the banks are lined in clusters
      const key = wet
        ? 7e9 + Math.floor(y / 30) * 100000 + Math.floor(x / 30)
        : Math.floor(y / 44) * 100000 + Math.floor(x / 44);
      if (occ.has(key)) continue;
      occ.add(key);
      // package 52: no piece twice in a screen. The first piece of the list (from a seeded start) whose name is not
      // used within a few tiles and whose name, size and flip are not used within a screen
      let name = '';
      let b = 0;
      let flip = false;
      for (let q = 0; q < list.length && !name; q++) {
        const nm = list[(Math.floor(r[3] * list.length) + q) % list.length]!;
        const kd = CHIPS[nm]!.kind;
        const b0 = kd === 'stone' ? Math.floor(r[4] * 3) : 2 + Math.floor(r[4] * 4);
        const nb = kd === 'stone' ? 3 : 4;
        for (let qb = 0; qb < nb * 2 && !name; qb++) {
          const bb = kd === 'stone' ? (b0 + (qb >> 1)) % 3 : 2 + ((b0 - 2 + (qb >> 1)) % 4);
          const fl = r[6] > 0.5 !== (qb % 2 === 1);
          if (!reuse(nm, bb, fl, x, y)) {
            name = nm;
            b = bb;
            flip = fl;
          }
        }
      }
      if (!name) continue;
      used.push({ name, b, flip, x, y });
      const kind = CHIPS[name]!.kind;
      const { w, h } = chipSize(name, b);
      // a bank piece straddles the water's edge; a path-side piece leans over the path's rim a little
      if (lean && wet) {
        x = (tx + 0.5 + lean[0] * (0.42 + 0.12 * r[5])) * TILE + (lean[0] ? 0 : (r[0] - 0.5) * 30);
        y = (ty + 0.5 + lean[1] * (0.42 + 0.12 * r[5])) * TILE + (lean[1] ? 0 : (r[1] - 0.5) * 30);
      } else if (lean) {
        x += lean[0] * TILE * 0.22;
        y += lean[1] * TILE * 0.22;
      }
      chips.push({ x: Math.round(x - w / 2), y: Math.round(y - h * 0.62), w, h, name, b, flip });
      // one or two tufts drawn round a green piece
      if (kind === 'grass' || kind === 'reed' || kind === 'dry')
        for (let q = 0; q < 3; q++) {
          const a = rng();
          const bb = rng();
          const s = rng();
          if (q === 2 || (q === 1 && s > 0.5)) continue;
          tufts.push({
            x: Math.round(x + (a - 0.5) * w * 1.1),
            y: Math.round(y + h * 0.3 + (bb - 0.5) * 10),
            size: 7 + s * 7,
            seed: Math.floor(a * 1e6),
          });
        }
    }
  // the open meadow: a light sprinkle of small tufts and a few flowers, thicker in the drifts
  const meadow = seeded(seed ^ 0x3ead);
  for (let ty = 1; ty < def.h - 1; ty++)
    for (let tx = 1; tx < tw - 1; tx++) {
      const r = [meadow(), meadow(), meadow(), meadow(), meadow()] as const;
      if (MEADOWY[at(tx, ty)] !== 1 || !free(tx, ty)) continue;
      const x = (tx + 0.1 + r[0] * 0.8) * TILE;
      const y = (ty + 0.2 + r[1] * 0.75) * TILE;
      const dz = drift(x, y);
      if (r[2] < 0.02 + 0.26 * smoothstep(0.45, 0.7, dz))
        tufts.push({ x: Math.round(x), y: Math.round(y), size: 6 + r[3] * 6, seed: Math.floor(r[4] * 1e6) + tx });
      else if (r[2] > 0.955)
        tufts.push({
          x: Math.round(x),
          y: Math.round(y),
          size: 5,
          seed: tx * 31 + ty,
          bloom: 1 + Math.floor(r[3] * 3),
        });
    }
  // grass hanging over the rim of the paths, so the edge is drawn, not blurred
  const rim = seeded(seed ^ 0x7a11);
  for (let ty = 1; ty < def.h - 1; ty++)
    for (let tx = 1; tx < tw - 1; tx++) {
      const isPath = TRAIL[at(tx, ty)] === 2 && !blocky[(ty + P) * gw + tx + P];
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const)
        for (let q = 0; q < 2; q++) {
          const a = rim();
          const b2 = rim();
          const z = rim();
          if (!isPath || MEADOWY[at(tx + dx, ty + dy)] !== 1 || a > 0.62) continue;
          const along = (b2 - 0.5) * TILE * 0.8;
          tufts.push({
            x: Math.round((tx + 0.5 + dx * 0.44) * TILE + (dy ? along : 0)),
            y: Math.round((ty + 0.5 + dy * 0.44) * TILE + (dx ? along : 0) + (dy < 0 ? 8 : 4)),
            size: 8 + z * 8,
            seed: Math.floor(b2 * 1e6) + tx * 13 + ty,
          });
        }
    }
  // lilies and wet stones in calm shallows next to the bank
  const pond = seeded(seed ^ 0x1111);
  for (let ty = 1; ty < def.h - 1; ty++)
    for (let tx = 1; tx < tw - 1; tx++) {
      const r = [pond(), pond(), pond(), pond()] as const;
      const c = at(tx, ty);
      if (KIND[c] !== HOLE || CODES[c] === 'W' || CODES[c] === 'u' || blocky[(ty + P) * gw + tx + P]) continue;
      if (!near(tx, ty, 1, (k) => MEADOWY[k] === 1) || near(tx, ty, 2, (k) => KIND[k] === OVER)) continue;
      const name = r[0] < 0.08 ? 'lilies' : r[0] > 0.9 ? 'wetrock' : '';
      if (!name) continue;
      const b = 1 + Math.floor(r[1] * 3);
      const { w, h } = chipSize(name, b);
      const x = (tx + 0.3 + r[2] * 0.4) * TILE;
      const y = (ty + 0.3 + r[3] * 0.4) * TILE;
      chips.push({ x: Math.round(x - w / 2), y: Math.round(y - h / 2), w, h, name, b, flip: r[1] > 0.5 });
    }
  // grass creeping in round the edge of the cobbles, so the stones sit in the grass instead of on it
  const edge = seeded(seed ^ 0x5eed);
  for (let ty = 1; ty < def.h - 1; ty++)
    for (let tx = 1; tx < tw - 1; tx++) {
      if (at(tx, ty) !== C_K || blocky[(ty + P) * gw + tx + P]) continue;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const a = edge();
        const b = edge();
        const z = edge();
        if (!MEADOWY[at(tx + dx, ty + dy)] || a > 0.45) continue;
        // two tufts a side, half a tile apart
        for (const off of [0, 0.5]) {
          const along = (((b + off) % 1) - 0.5) * TILE * 0.9;
          tufts.push({
            x: Math.round((tx + 0.5 + dx * 0.42) * TILE + (dy ? along : 0)),
            y: Math.round((ty + 0.5 + dy * 0.42) * TILE + (dx ? along : 0) + 6),
            size: 10 + ((z + off) % 1) * 9,
            seed: Math.floor(b * 1e6) + tx * 7 + ty + off * 999,
          });
        }
      }
    }
  // pieces are drawn from the top down, so a lower one overlaps the one behind it
  chips.sort((a, b) => a.y + a.h - (b.y + b.h));
  tufts.sort((a, b) => a.y - b.y);
  if (process.env.BAKE_COUNT) console.log(`scatter ${id}: ${chips.length} pieces, ${tufts.length} tufts`);
  return { chips, tufts };
}

// Scratch colour, set by the samplers below.
let cr = 0;
let cg = 0;
let cb = 0;

const C_G = CI('g');
const C_P = CI('p');
/** mean colour of the cobble texture and mean brightness of the path texture, per ground set (set at start) */
const COBBLE: Record<SetId, RGB> = { n: [170, 164, 150], s: [220, 226, 234] };
const PATH_LUM: Record<SetId, number> = { n: 160, s: 220 };
const nz = (F: Float32Array, X: number, Y: number, ox: number, oy: number, sh: number): number =>
  F[((((Y >> sh) + oy) & 1023) << 10) | (((X >> sh) + ox) & 1023)]!;

/** A pebble or none at world pixel X, Y, from a seeded 9 px grid; dense sets how many cells carry one. */
function pebble(X: number, Y: number, dense: number, snow: boolean, r: number, g: number, b: number): void {
  cr = r;
  cg = g;
  cb = b;
  const gx = Math.floor(X / 9);
  const gy = Math.floor(Y / 9);
  const h = hash(gx, gy, 913);
  if (h >= dense) return;
  const px = gx * 9 + 2.5 + hash(gx, gy, 914) * 4;
  const py = gy * 9 + 2.5 + hash(gx, gy, 915) * 4;
  const rad = 1.3 + hash(gx, gy, 916) * 1.9;
  const dx = X + 0.5 - px;
  const dy = Y + 0.5 - py;
  const d = Math.hypot(dx, dy);
  // a soft shadow below and to the right
  const ds = Math.hypot(dx - 1, dy - 1.3);
  if (ds < rad + 0.8 && d >= rad) {
    const k = 1 - 0.22 * Math.min(1, rad + 0.8 - ds);
    cr = r * k;
    cg = g * k;
    cb = b * k * 1.02;
  }
  if (d >= rad + 0.5) return;
  const a = Math.min(1, rad + 0.5 - d);
  const tone = 0.82 + 0.3 * hash(gx, gy, 917);
  const lit = -(dx + dy) / (rad * 1.5);
  const k = tone * (0.86 + 0.22 * lit) * (d > rad - 0.8 ? 0.8 : 1);
  const [sr, sg, sb] = snow ? [226, 230, 238] : [168, 156, 136];
  cr += (sr * k - cr) * a;
  cg += (sg * k - cg) * a;
  cb += (sb * k - cb) * a;
}

/**
 * The paths and the Square's cobbles laid over the ground at a pixel (package 48). The edge follows a smooth field,
 * so it runs in curves, read at a gently warped point and nudged by the path's own grain, so it is ragged but drawn:
 * a dry worn margin outside, a darker worn rim just inside, a paler middle and pebbles along the rim. The cobbles are
 * laid stone by stone (mixed sizes, mossy joints), and at the edge whole stones drop out and sink into the grass, so
 * the Square ends in a grassy fringe instead of a cut. Sets cr, cg, cb.
 */
function trails(A: Area, tex: (Tex | null)[], set: SetId, X: number, Y: number, r: number, g: number, b: number): void {
  const snow = set === 's';
  const XP = X + (nz(E3, X, Y, 913, 51, 2) - 0.5) * 22 + (nz(E2, X, Y, 5, 71, 0) - 0.5) * 6;
  const YP = Y + (nz(E3, X, Y, 211, 377, 2) - 0.5) * 22 + (nz(E2, X, Y, 641, 19, 0) - 0.5) * 6;
  const patch = 0.45 + 0.55 * nz(E, X, Y, 419, 167, 1);
  const T0 = 0.44;
  if (A.fp) {
    const f0 = fieldAt(A, A.fp, XP, YP);
    if (f0 > 0.1) {
      sample(tex, C_P, X, Y, false);
      let pr = cr;
      let pg = cg;
      let pb = cb;
      const pl = pr * 0.3 + pg * 0.59 + pb * 0.11;
      const f = f0 + (nz(E2, X, Y, 97, 433, 0) - 0.5) * 0.12 + (pl - PATH_LUM[set]) * 0.003;
      const mOut = smoothstep(0.16, T0, f) * (snow ? 0.42 : 0.62) * patch;
      if (mOut > 0) {
        const [dr, dg, db] = snow ? [222, 226, 230] : [204, 198, 122];
        r += (dr - r) * mOut;
        g += (dg - g) * mOut;
        b += (db - b) * mOut;
      }
      const t = smoothstep(T0 - 0.02, T0 + 0.02, f);
      if (t > 0) {
        const rim = 1 - smoothstep(T0, T0 + 0.16, f);
        const mid = smoothstep(0.72, 0.95, f);
        const mt = 0.95 + 0.1 * nz(E, X, Y, 37, 91, 1);
        const k = mt * (1 - (snow ? 0.06 : 0.15) * rim) * (1 + 0.07 * mid);
        pr *= k;
        pg *= k * (1 - 0.02 * rim);
        pb *= k * (1 - 0.06 * rim);
        r += (pr - r) * t;
        g += (pg - g) * t;
        b += (pb - b) * t;
      }
      if (f > T0 - 0.14 && f < T0 + 0.34) {
        pebble(X, Y, f < T0 + 0.12 ? 0.13 : 0.05, snow, r, g, b);
        r = cr;
        g = cg;
        b = cb;
      }
    }
  }
  if (A.fk) {
    const f0 = fieldAt(A, A.fk, XP, YP);
    if (f0 > 0.1) {
      // package 52: a soft mossy margin round the Square instead of a torn edge, read pixel by pixel from the
      // smooth field (with a little grain), so it runs in a curve; the stones fade into it at the very edge
      const fpx = f0 + (nz(E2, X, Y, 97, 433, 0) - 0.5) * 0.08 + (nz(E, X, Y, 211, 59, 1) - 0.5) * 0.06;
      const mOut = smoothstep(0.1, T0 + 0.06, fpx) * (0.3 + 0.25 * patch);
      if (mOut > 0) {
        const [dr, dg, db] = snow ? [222, 226, 230] : [104, 116, 66];
        r += (dr * 0.6 + r * 0.4 - r) * mOut;
        g += (dg * 0.6 + g * 0.4 - g) * mOut;
        b += (db * 0.6 + b * 0.4 - b) * mOut;
      }
      const cover = smoothstep(T0 - 0.02, T0 + 0.16, fpx);
      const gr = r;
      const gg = g;
      const gb = b;
      // the stones: a Voronoi of a jittered 22 px grid with a quarter of the points left out, so sizes are mixed
      const CS = 17;
      const gx = Math.floor(X / CS);
      const gy = Math.floor(Y / CS);
      let d1 = 1e9;
      let d2 = 1e9;
      let p1x = 0;
      let p1y = 0;
      let p2x = 0;
      let p2y = 0;
      let d3 = 1e9;
      let p3x = 0;
      let p3y = 0;
      let i1 = 0;
      let j1 = 0;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const ix = gx + dx;
          const iy = gy + dy;
          if (hash(ix, iy, 61) < 0.24) continue;
          const qx = (ix + 0.22 + 0.56 * hash(ix, iy, 62)) * CS;
          const qy = (iy + 0.22 + 0.56 * hash(ix, iy, 63)) * CS;
          const d = (X + 0.5 - qx) ** 2 + (Y + 0.5 - qy) ** 2;
          if (d < d1) {
            d3 = d2;
            p3x = p2x;
            p3y = p2y;
            d2 = d1;
            p2x = p1x;
            p2y = p1y;
            d1 = d;
            p1x = qx;
            p1y = qy;
            i1 = ix;
            j1 = iy;
          } else if (d < d2) {
            d3 = d2;
            p3x = p2x;
            p3y = p2y;
            d2 = d;
            p2x = qx;
            p2y = qy;
          } else if (d < d3) {
            d3 = d;
            p3x = qx;
            p3y = qy;
          }
        }
      // distance to the nearest two edges, joined by a smooth minimum, so the corners round off like worn stone
      const e2 = (d2 - d1) / (2 * Math.max(1, Math.hypot(p2x - p1x, p2y - p1y)));
      const e3 = (d3 - d1) / (2 * Math.max(1, Math.hypot(p3x - p1x, p3y - p1y)));
      const rk = 8;
      const hh = Math.max(rk - Math.abs(e2 - e3), 0) / rk;
      const edge = Math.min(e2, e3) - hh * hh * rk * 0.25;
      const h1 = hash(i1, j1, 64);
      const fs = fieldAt(A, A.fk, p1x, p1y) + (h1 - 0.5) * 0.12;
      if (cover > 0) {
        const sink = 1 - smoothstep(T0, 0.82, fs);
        const jw = 1.3 + 4 * sink;
        const st = smoothstep(jw - 0.7, jw + 0.7, edge);
        // the joint: soil with moss here and there, and the ground itself where the stones sink at the edge
        let jr: number;
        let jg: number;
        let jb: number;
        if (snow) [jr, jg, jb] = [218, 226, 236];
        else {
          const moss = smoothstep(0.45, 0.7, nz(E, X, Y, 641, 877, 1));
          jr = 132 + (112 - 132) * moss;
          jg = 118 + (128 - 118) * moss;
          jb = 90 + (74 - 90) * moss;
        }
        const gk = Math.min(1, sink * 1.1);
        jr += (r * 0.9 - jr) * gk;
        jg += (g * 0.9 - jg) * gk;
        jb += (b * 0.9 - jb) * gk;
        // the stone: its own tone, a fine grain, rounded by a bevel and lit from the upper left
        const [mr, mg, mb] = COBBLE[set];
        const w = hash(i1, j1, 65) - 0.5;
        const tone = 1.0 + 0.22 * h1;
        const bv = smoothstep(0, 5, edge - jw);
        const lx = X + 0.5 - p1x;
        const ly = Y + 0.5 - p1y;
        const lit = -(lx + ly) / (Math.hypot(lx, ly) + 5);
        const k = tone * (0.95 + 0.1 * nz(E2, X, Y, 313, 577, 0)) * (0.84 + 0.16 * bv + 0.08 * lit * (1 - 0.5 * bv));
        // a little greyer than the texture, warm and cool stone by stone
        const ml = mr * 0.3 + mg * 0.59 + mb * 0.11;
        let sr = (ml + (mr - ml) * 0.6) * k * (1 + 0.08 * w);
        let sg = (ml + (mg - ml) * 0.6) * k;
        let sb = (ml + (mb - ml) * 0.6) * k * (1 - 0.08 * w);
        if (snow) {
          const cap = 0.5 * bv;
          sr += (240 - sr) * cap;
          sg += (244 - sg) * cap;
          sb += (250 - sb) * cap;
        } else {
          // moss creeping onto the stones that sit lowest
          const mz = sink * 0.35 * smoothstep(0.4, 0.7, nz(E, X, Y, 77, 431, 1));
          sr += (sr * 0.62 - sr) * mz;
          sg += (sg * 0.86 - sg) * mz;
          sb += (sb * 0.5 - sb) * mz;
        }
        r = gr + (jr + (sr - jr) * st - gr) * cover;
        g = gg + (jg + (sg - jg) * st - gg) * cover;
        b = gb + (jb + (sb - jb) * st - gb) * cover;
      }
    }
  }
  cr = r;
  cg = g;
  cb = b;
}

/**
 * A painted grass blade at world pixel X, Y (package 48): -1 to 1, a lit blade above 0 and a shaded one below, 0 for
 * none. Short slanted strokes, one per 7 x 11 px cell on two offset grids, thinning out in the dapple, so the open
 * grass carries brushwork. Baked, so it costs nothing per frame.
 */
function blades(X: number, Y: number): number {
  let v = 0;
  for (let q = 0; q < 2; q++) {
    const ox = q * 3;
    const oy = q * 5;
    const gx = Math.floor((X + ox) / 7);
    const gy = Math.floor((Y + oy) / 11);
    const h = hash(gx, gy, 811 + q);
    if (h > 0.5) continue;
    const L = 4 + 5 * hash(gx, gy, 813);
    const sl = (hash(gx, gy, 814) - 0.5) * 0.7;
    const cx = gx * 7 - ox + 2 + 3 * hash(gx, gy, 815);
    const by = gy * 11 - oy + 1.5 + L;
    const dy = by - (Y + 0.5);
    if (dy < 0 || dy > L) continue;
    // a blade tapers from its foot to its tip
    const wdt = 0.95 * (1 - (0.6 * dy) / L);
    const dx = Math.abs(X + 0.5 - (cx + sl * dy));
    const a = 1 - smoothstep(wdt - 0.5, wdt + 0.5, dx);
    if (a <= 0) continue;
    v += (h < 0.28 ? 1 : -0.8) * a * (0.55 + 0.45 * hash(gx, gy, 816));
  }
  return Math.max(-1, Math.min(1, v));
}

function sample(tex: (Tex | null)[], ci: number, X: number, Y: number, blocky: boolean): void {
  const t = tex[ci];
  if (!t) {
    cr = cg = cb = 0;
    return;
  }
  let k = 1;
  if (blocky && t.proc) {
    k = 0.93 + 0.14 * hash(X >> 3, Y >> 3, 77);
    X = (X & ~7) + 4;
    Y = (Y & ~7) + 4;
  }
  const o = (((Y & (TS - 1)) * TS) | (X & (TS - 1))) * 3;
  cr = t.px[o]! * k;
  cg = t.px[o + 1]! * k;
  cb = t.px[o + 2]! * k;
  if (blocky || SOFT[ci] !== 1) return;
  // soft textures crossfade with a shifted copy of themselves over a world-scale field, hiding the repeat
  const m = smoothstep(0.35, 0.65, E[(((Y >> 3) & 1023) << 10) | (((X + 4099) >> 3) & 1023)]!);
  if (m <= 0) return;
  const p = ((((Y + 320) & (TS - 1)) * TS) | ((X + 197) & (TS - 1))) * 3;
  cr += (t.px[p]! - cr) * m;
  cg += (t.px[p + 1]! - cg) * m;
  cb += (t.px[p + 2]! - cb) * m;
}

const closed = (A: Area, tx: number, ty: number): boolean => KIND[A.code[(ty + P) * A.gw + tx + P]!]! >= WALL;

/** Wall, hedge or void colour at (possibly wobbled) world pixel wx, wy. */
function wall(A: Area, tex: (Tex | null)[], ci: number, wx: number, wy: number, blocky: boolean, snow: boolean): void {
  sample(tex, ci, wx, wy, blocky);
  if (KIND[ci] === VOID) return;
  const tx = wx >> 6;
  const ty = wy >> 6;
  const lx = wx & 63;
  const ly = wy & 63;
  const up = !closed(A, tx, ty - 1);
  const down = !closed(A, tx, ty + 1);
  const left = !closed(A, tx - 1, ty);
  const right = !closed(A, tx + 1, ty);
  if ((up && ly < 2) || (down && ly > 61) || (left && lx < 2) || (right && lx > 61)) {
    cr = 34;
    cg = 28;
    cb = 40;
    return;
  }
  let k = 1;
  if (down && ly > 46) k *= 1 - 0.45 * ((ly - 46) / 15);
  if (left && lx < 6) k *= 0.82;
  if (right && lx > 57) k *= 0.82;
  cr *= k;
  cg *= k;
  cb *= k;
  if (up && ly < 12) {
    const t = snow ? 0.88 * (1 - smoothstep(6, 12, ly)) : 0.4 * (1 - ly / 12);
    const [lr, lg, lb] = snow ? [244, 248, 255] : [cr * 1.5 + 30, cg * 1.5 + 30, cb * 1.5 + 30];
    cr += (lr - cr) * t;
    cg += (lg - cg) * t;
    cb += (lb - cb) * t;
  }
}

/** Distance inside a broken plank. A positive distance leaves wood on this side of the gap. */
function brokenEdge(r: Area['brokenRects'][number], X: number, Y: number): number {
  const along = r.dir === 1 ? X : Y;
  const across = r.dir === 1 ? Y : X;
  const a0 = r.dir === 1 ? r.x0 : r.y0;
  const a1 = r.dir === 1 ? r.x1 : r.y1;
  const plank = across >> 3;
  const fromStart = along - a0;
  const fromEnd = a1 - 1 - along;
  let start = 26 + hash(plank, a0, 611) * 30;
  let end = 26 + hash(plank, a1, 612) * 30;
  if (r.id === 'jetty') {
    // Boards snap at different lengths and angles. A thin strip of grain sometimes peels beyond the break.
    const fibre = (across & 7) - 3;
    // The chest fills the first tile. Leave the snapped ends visible beyond its eastern edge.
    start = 59 + (start - 26) * 0.75 + fibre * (hash(plank, a0, 619) * 2 - 1);
    end += fibre * (hash(plank, a1, 620) * 2 - 1);
    if (fibre === -2 && hash(plank, a0, 621) > 0.55) start += 7;
    if (fibre === 2 && hash(plank, a1, 622) > 0.55) end += 8;
  }
  return Math.max(start - fromStart, end - fromEnd);
}

/** Wall face, trims and colour for a room's closed tiles; false when the pixel is not part of the room's walls. */
function roomWall(A: Area, X: number, Y: number): boolean {
  const tx = X >> 6;
  const ty = Y >> 6;
  if (!closed(A, tx, ty)) return false;
  const lx = X & 63;
  const ly = Y & 63;
  if (!closed(A, tx, ty + 1)) {
    // the face of the wall above a floor tile
    const t = A.face === 'rock' ? TEX.n[CI('c')] : WALLTEX['wall_' + (A.face === 'block' ? 'wood' : A.face)];
    if (t) {
      // stone blocks drawn at half size, so a face shows a few courses
      const q = A.face === 'stone' ? 1 : 0;
      const vista = A.face === 'bay' || A.face === 'hill';
      const strip = A.face === 'tower' || A.face === 'glass';
      const u = vista ? Math.floor(((X - TILE) * TS) / ((A.def.w - 2) * TILE)) : strip ? X << 1 : X << q;
      const v = strip || vista ? ly << 3 : Y << q;
      const o = (((v & (TS - 1)) * TS) | (u & (TS - 1))) * 3;
      cr = t.px[o]!;
      cg = t.px[o + 1]!;
      cb = t.px[o + 2]!;
    } else if (A.face === 'wood' || A.face === 'block') [cr, cg, cb] = [150, 98, 58];
    else [cr, cg, cb] = [128, 124, 132];
    const tint = ROOM_TINT[A.id];
    if (tint) {
      cr += (tint.to[0] - cr) * tint.k;
      cg += (tint.to[1] - cg) * tint.k;
      cb += (tint.to[2] - cb) * tint.k;
    }
    let k = 1;
    if (A.face === 'block') {
      // plank blocks: a dark seam every 16 px down and every 32 px across (staggered), each 8 px cell a shade apart
      k = 0.9 + 0.16 * hash(X >> 3, Y >> 3, 78);
      if ((ly & 15) >= 14 || ((X + ((ly >> 4) & 1) * 16) & 31) >= 30) k *= 0.62;
      if (ly < 6) k *= 0.7;
      else if (ly > 57) k *= 0.5;
    } else if (A.face === 'wood') {
      if (ly < 7) {
        cr = 112;
        cg = 70;
        cb = 40;
        k = ly < 2 ? 0.7 : 1.15;
      } else if (ly < 9) k = 0.45;
      else if (ly >= 50) k = ly < 52 ? 1.25 : ly > 61 ? 0.4 : 0.62;
    } else if (A.face === 'glass' || A.face === 'bay' || A.face === 'hill') {
      if (ly < 2 || ly > 61) k = 0.76;
    } else if (A.face === 'tower') {
      const across = Math.abs((2 * X) / (A.def.w * TILE) - 1);
      k = 1.07 - across * across * 0.24 - (ly / 63) * 0.09;
      if (ly < 2 || ly > 60) k *= 0.78;
    } else if (A.face === 'stone') {
      k = 0.86;
      if (ly < 6) k = ly < 2 ? 0.55 : 1.15;
      else if (ly >= 50) k = 0.86 - 0.4 * ((ly - 50) / 13);
    } else {
      k = ly < 4 ? 1.35 : 1.05 - 0.4 * (ly / 63);
      if (ly > 60) k = 0.45;
    }
    // darker ends where the face turns a corner
    if (
      (lx < 6 && closed(A, tx - 1, ty) && closed(A, tx - 1, ty + 1)) ||
      (lx > 57 && closed(A, tx + 1, ty) && closed(A, tx + 1, ty + 1))
    )
      k *= 0.72;
    cr = Math.min(255, cr * k);
    cg = Math.min(255, cg * k);
    cb = Math.min(255, cb * k);
    return true;
  }
  if (A.face === 'rock') return false;
  // a trim along the floor's sides and bottom: wood in the cottage (the rest stays dark), stone in the Hall
  const openR = !closed(A, tx + 1, ty);
  const openL = !closed(A, tx - 1, ty);
  const openU = !closed(A, tx, ty - 1);
  const d = Math.min(openR ? 63 - lx : 99, openL ? lx : 99, openU ? ly : 99);
  if (d >= (A.face === 'stone' ? 18 : 14)) return false;
  if (A.face === 'stone' || A.face === 'tower') {
    const t = A.face === 'tower' ? WALLTEX.wall_tower : WALLTEX.wall_stone;
    if (t) {
      const o = ((((Y << 1) & (TS - 1)) * TS) | ((X << 1) & (TS - 1))) * 3;
      [cr, cg, cb] = [t.px[o]!, t.px[o + 1]!, t.px[o + 2]!];
    } else [cr, cg, cb] = [128, 124, 132];
    const k = d < 2 ? 0.45 : d < 5 ? 1.1 : d > 15 ? 0.5 : 0.8;
    cr *= k;
    cg *= k;
    cb *= k;
    return true;
  }
  const k = d < 2 ? 1.3 : d < 11 ? 0.9 - (d - 2) * 0.02 : 0.45;
  const glass = A.face === 'glass';
  cr = (glass ? 94 : 112) * k;
  cg = (glass ? 133 : 70) * k;
  cb = (glass ? 113 : 40) * k;
  return true;
}

/**
 * The bridge layer at world pixel X, Y: returns its alpha and sets cr, cg, cb. Bridge planks overhang the bank a little.
 * With intact set, a broken bridge is drawn whole (the picture laid over the gap once it is built).
 */
function bridgeAt(A: Area, tex: (Tex | null)[], X: number, Y: number, intact: boolean): number {
  const gw = A.gw;
  const tx = X >> 6;
  const ty = Y >> 6;
  const lx = X & 63;
  const ly = Y & 63;
  const ti = (ty + P) * gw + tx + P;
  const own = A.code[ti]!;
  // the bridge tile this pixel belongs to: its own, or one it overhangs onto the bank
  let bt = -1;
  if (own === C_B) bt = ti;
  else if (KIND[own] === LAND) {
    if (lx < 10 && A.bdir[ti - 1] === 1) bt = ti - 1;
    else if (lx > 53 && A.bdir[ti + 1] === 1) bt = ti + 1;
    else if (ly < 10 && A.bdir[ti - gw] === 2) bt = ti - gw;
    else if (ly > 53 && A.bdir[ti + gw] === 2) bt = ti + gw;
  }
  const dir = bt >= 0 ? A.bdir[bt]! : 0;
  if (dir === 0) return 0;
  let endGrain = false;
  if (!intact && A.broken[bt]! > 0) {
    const gap = A.brokenRects[A.broken[bt]! - 1]!;
    const edge = brokenEdge(gap, X, Y);
    if (edge <= 0) return 0;
    endGrain = gap.id === 'jetty' && edge < 3;
  }
  const step = dir === 1 ? gw : 1;
  const lo = A.code[bt - step] !== C_B;
  const hi = A.code[bt + step] !== C_B;
  const across = dir === 1 ? ly : lx;
  if ((across >= 3 || !lo) && (across <= 60 || !hi)) {
    let k: number;
    if ((lo && across <= 9) || (hi && across >= 54)) {
      sample(tex, C_B, dir === 1 ? Y : X, dir === 1 ? X : Y, false);
      k = across === 3 || across === 60 ? 0.4 : across <= 5 || (across >= 54 && across <= 56) ? 0.95 : 0.7;
    } else {
      if (dir === 1) sample(tex, C_B, X, Y, false);
      else sample(tex, C_B, Y, X, false);
      k = (lo && across < 13) || (hi && across > 50) ? 0.8 : 1;
    }
    if (endGrain) {
      cr = cr * 0.45 + 137;
      cg = cg * 0.45 + 98;
      cb = cb * 0.45 + 59;
    }
    cr *= k;
    cg *= k;
    cb *= k;
    return 1;
  }
  if (across > 60 && hi && own === C_B) {
    cr = cg = cb = 0;
    return 0.3;
  }
  return 0;
}

/** The whole of one broken bridge, at 1.5 x screen size, for the view to lay over the gap once it is built. */
async function writeBridge(
  A: Area,
  id: string,
  rect: { x: number; y: number; w: number; h: number },
  set: SetId,
): Promise<string> {
  const M = 12;
  const X0 = rect.x * TILE - M;
  const Y0 = rect.y * TILE - M;
  const w = rect.w * TILE + 2 * M;
  const h = rect.h * TILE + 2 * M;
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const sa = bridgeAt(A, TEX[set], X0 + x, Y0 + y, true);
      if (sa <= 0) continue;
      const o = (y * w + x) * 4;
      px[o] = cr;
      px[o + 1] = cg;
      px[o + 2] = cb;
      px[o + 3] = Math.round(sa * 255);
    }
  const name = `bridge_${id}${set === 's' ? '_snow' : ''}`;
  const file = join(ROOT, 'art/src/objects', name + '.png');
  await sharp(px, { raw: { width: w, height: h, channels: 4 } })
    .resize(Math.round(w * 1.5), Math.round(h * 1.5))
    .png({ compressionLevel: 9 })
    .toFile(file);
  return name;
}

const lc = new Int32Array(4);
const lw = new Float64Array(4);
const bc = new Int32Array(4);
const bw = new Float64Array(4);

/**
 * Where land meets water: damp ground, then a bank in bands (tan earth, darker mud, a wet edge) and a thin sheet of
 * shallows over the moving water. A beach gets wet sand and a line of foam instead. s is about 0.5 at the waterline.
 * Sets cr, cg, cb and returns the alpha.
 */
function shore(
  s: number,
  beach: boolean,
  snow: boolean,
  r: number,
  g: number,
  b: number,
  shA: number,
  brk: number,
): number {
  // package 52: a wider, softer damp margin, so the land darkens towards the water instead of ending in a line
  const damp = 1 - smoothstep(0.6, 0.98, s);
  r *= 1 - 0.2 * damp;
  g *= 1 - 0.13 * damp;
  b *= 1 - 0.1 * damp;
  const band = (c: RGB, t: number) => {
    if (t <= 0) return;
    const [br, bg, bb] = snow ? [c[0] + (232 - c[0]) * 0.5, c[1] + (236 - c[1]) * 0.5, c[2] + (244 - c[2]) * 0.5] : c;
    r += (br - r) * t;
    g += (bg - g) * t;
    b += (bb - b) * t;
  };
  if (beach) {
    const wet = 1 - smoothstep(0.54, 0.64, s);
    r *= 1 - 0.2 * wet;
    g *= 1 - 0.18 * wet;
    b *= 1 - 0.14 * wet;
  } else {
    // a painted bank (package 48): damp grass, a broken band of earth, a dark wet edge, then wet sand at the water
    // package 52: softer and broken, so the bank is not one hard pale line
    band([138, 126, 86], (1 - smoothstep(0.54, 0.74, s)) * (0.18 + 0.32 * brk));
    band([100, 94, 62], (1 - smoothstep(0.5, 0.7, s)) * 0.5);
    band([168, 160, 122], (1 - smoothstep(0.495, 0.525, s)) * 0.3 * brk * brk);
  }
  const aLand = smoothstep(0.43, 0.56, s);
  // shallows: a light translucent wash over the water sheet that carries on into open water, and a faint line
  // package 52: right at the bank the shallows take a muddy olive (the bed showing through), not a pale glow
  const mud = beach ? 0 : smoothstep(0.34, 0.5, s) * 0.65;
  let sr = SHALLOW[0] + (118 - SHALLOW[0]) * mud;
  let sg = SHALLOW[1] + (132 - SHALLOW[1]) * mud;
  let sb = SHALLOW[2] + (100 - SHALLOW[2]) * mud;
  let sa = shA + (0.46 - shA) * smoothstep(0.3, 0.5, s);
  // package 52: a thin foam line, broken into lengths with gaps between
  const line = 1 - Math.min(1, Math.abs(s - 0.455) / 0.011);
  if (line > 0) {
    const f = line * (beach ? 0.45 : 0.3) * smoothstep(0.45, 0.75, brk);
    sr += (246 - sr) * f;
    sg += (250 - sg) * f;
    sb += (250 - sb) * f;
    sa += (1 - sa) * f;
  }
  const ao = aLand + sa * (1 - aLand);
  if (ao <= 0) {
    cr = cg = cb = 0;
    return 0;
  }
  const ka = aLand / ao;
  const kb = (sa * (1 - aLand)) / ao;
  cr = r * ka + sr * kb;
  cg = g * ka + sg * kb;
  cb = b * ka + sb * kb;
  return ao;
}

/** A wander in world pixels held softly inside a third of a tile (package 52). */
const wander = (v: number): number => (TILE / 3) * Math.tanh(v / (TILE / 3));

/** The light shallows over open water, by depth in tiles: strong at the bank, gone a couple of tiles out. */
const SHALLOW: RGB = [150, 186, 156];
const shallowA = (d: number): number => (1 - smoothstep(0.3, 2.3, d)) * 0.36;

/** Water depth in tiles at a world point, read between tile centres. */
function depthAt(A: Area, X: number, Y: number): number {
  const fx = (X + 0.5) / TILE - 0.5;
  const fy = (Y + 0.5) / TILE - 0.5;
  const i = Math.floor(fx);
  const j = Math.floor(fy);
  const ax = smoothstep(0, 1, fx - i);
  const ay = smoothstep(0, 1, fy - j);
  const o = (j + P) * A.gw + i + P;
  const at = (k: number) => Math.min(8, A.depth[k] ?? 8);
  return (at(o) * (1 - ax) + at(o + 1) * ax) * (1 - ay) + (at(o + A.gw) * (1 - ax) + at(o + A.gw + 1) * ax) * ay;
}

function renderChunk(A: Area, set: SetId, cx: number, cy: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(CHUNK * CHUNK * 4);
  const tex = TEX[set];
  const snow = set === 's';
  const gw = A.gw;
  const code = A.lcode;
  const wob = A.indoor ? 0 : 20;
  // a blocky room is drawn in 8 px cells, like the blocky regions outside
  const q8 = A.face === 'block';
  const KB = 0.5 - 0.195;
  const KT = 0.5 + 0.195;
  for (let py = 0; py < CHUNK; py++) {
    const Y = q8 ? ((cy * CHUNK + py) & ~7) + 4 : cy * CHUNK + py;
    const fy = (Y + 0.5) / TILE - 0.5;
    const j0 = Math.floor(fy);
    const ay = fy - j0;
    const ty = Y >> 6;
    const ly = Y & 63;
    for (let px = 0; px < CHUNK; px++) {
      const X = q8 ? ((cx * CHUNK + px) & ~7) + 4 : cx * CHUNK + px;
      const tx = X >> 6;
      const lx = X & 63;
      const ti = (ty + P) * gw + tx + P;
      const own = code[ti]!;
      const ownK = KIND[own]!;
      const bl = A.blocky[ti] === 1;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      if (bl) {
        if (ownK === LAND || ownK >= WALL) {
          const k = ownK === LAND ? 0.93 + 0.14 * E[(((Y >> 3) & 1023) << 10) | ((X >> 3) & 1023)]! : 1;
          if (ownK === LAND) sample(tex, own, X, Y, true);
          else wall(A, tex, own, X, Y, true, snow);
          r = cr * k;
          g = cg * k;
          b = cb * k;
          a = 1;
        }
      } else {
        const ni = ((Y & 1023) << 10) | (X & 1023);
        const wx = X + Math.round((E2[ni]! - 0.5) * wob);
        const wy = Y + Math.round((E2[(((Y + 397) & 1023) << 10) | ((X + 211) & 1023)]! - 0.5) * wob);
        const wc = code[((wy >> 6) + P) * gw + (wx >> 6) + P]!;
        if (KIND[wc]! >= WALL) {
          wall(A, tex, wc, wx, wy, false, snow);
          r = cr;
          g = cg;
          b = cb;
          a = 1;
        } else {
          // painted ground: the field is read at a gently warped point, so edges wobble like a brush stroke
          const paint = !A.indoor;
          const wq = ((((Y >> 2) + 131) & 1023) << 10) | (((X >> 2) + 77) & 1023);
          const wq2 = ((((Y >> 2) + 401) & 1023) << 10) | (((X >> 2) + 19) & 1023);
          // package 48: a slow wander of about a third of a tile on top, so banks and edges curve instead of running straight
          // package 52: and a long one (about 16 tiles a bend), so a straight canal wanders too; the whole is held
          // softly inside a third of a tile
          const XW = paint
            ? X +
              wander(
                (E2[wq]! - 0.5) * 24 +
                  (E[wq2]! - 0.5) * 40 +
                  (nz(E3, X, Y, 707, 233, 1) - 0.5) * 44 +
                  (nz(E3, X, Y, 211, 619, 3) - 0.5) * 64,
              )
            : X;
          const YW = paint
            ? Y +
              wander(
                (E2[(((Y >> 2) + 611) & 1023) * 1024 + (((X >> 2) + 283) & 1023)]! - 0.5) * 24 +
                  (E[(((Y >> 2) + 97) & 1023) * 1024 + (((X >> 2) + 733) & 1023)]! - 0.5) * 40 +
                  (nz(E3, X, Y, 389, 811, 1) - 0.5) * 44 +
                  (nz(E3, X, Y, 877, 45, 3) - 0.5) * 64,
              )
            : Y;
          const fx = (XW + 0.5) / TILE - 0.5;
          const i0 = Math.floor(fx);
          const ax = fx - i0;
          const fyw = (YW + 0.5) / TILE - 0.5;
          const jw = paint ? Math.floor(fyw) : j0;
          const ayw = paint ? fyw - jw : ay;
          const base = (jw + P) * gw + i0 + P;
          let landField = 0;
          let n = 0;
          let trailed = false;
          for (let q = 0; q < 4; q++) {
            const c = code[base + (q & 1) + (q >> 1) * gw]!;
            const w = ((q & 1) === 1 ? ax : 1 - ax) * (q >> 1 === 1 ? ayw : 1 - ayw);
            const k = KIND[c]!;
            if (k === HOLE || k === OVER) continue;
            landField += w;
            if (k !== LAND) continue;
            // paths and cobbles are laid over the ground afterwards (trails), from their own smooth fields
            if (paint && TRAIL[c]) {
              trailed = true;
              continue;
            }
            let m = 0;
            while (m < n && lc[m] !== c) m++;
            if (m === n) {
              lc[n] = c;
              lw[n] = 0;
              n++;
            }
            lw[m]! += w;
          }
          if (n === 0 && trailed) {
            lc[0] = C_G;
            lw[0] = 1;
            n = 1;
          }
          if (paint && n > 0 && A.beach[ti]) {
            // the beach: the kinds of land are read again at a wider, slower warp, so sand meets grass in long
            // curves instead of along the tile grid (the waterline keeps its own, closer warp)
            const bx = XW + (E3[((((Y >> 1) + 59) & 1023) << 10) | (((X >> 1) + 907) & 1023)]! - 0.5) * 240;
            const by = YW + (E3[((((Y >> 1) + 733) & 1023) << 10) | (((X >> 1) + 101) & 1023)]! - 0.5) * 240;
            const fbx = (bx + 0.5) / TILE - 0.5;
            const fby = (by + 0.5) / TILE - 0.5;
            const bi = Math.floor(fbx);
            const bj = Math.floor(fby);
            const bax = fbx - bi;
            const bay = fby - bj;
            const bb = (bj + P) * gw + bi + P;
            let n2 = 0;
            for (let q = 0; q < 4; q++) {
              const c = code[bb + (q & 1) + (q >> 1) * gw]!;
              if (KIND[c] !== LAND || TRAIL[c]) continue;
              const w = ((q & 1) === 1 ? bax : 1 - bax) * (q >> 1 === 1 ? bay : 1 - bay);
              let m = 0;
              while (m < n2 && bc[m] !== c) m++;
              if (m === n2) {
                bc[n2] = c;
                bw[n2] = 0;
                n2++;
              }
              bw[m]! += w;
            }
            if (n2 > 0) {
              let sum = 0;
              for (let i = 0; i < n2; i++) sum += bw[i]!;
              for (let i = 0; i < n2; i++) {
                lc[i] = bc[i]!;
                lw[i] = bw[i]! / sum;
              }
              n = n2;
            }
          }
          const e0 = (E[ni]! - 0.5) * 0.7 + (E2[(((Y + 733) & 1023) << 10) | ((X + 89) & 1023)]! - 0.5) * 0.4;
          const e = paint ? e0 * 0.3 : e0;
          let foam = 0;
          if (n === 0) {
            if (ownK === HOLE || ownK === OVER) {
              a = 0;
              if (paint && ownK === HOLE) {
                // open water: light shallows near the banks, a little deeper and darker further out
                const d = depthAt(A, XW, YW);
                const sh = shallowA(d);
                // package 52: the deeper band is read through a slow wander and a softer ramp, so it has no tile steps
                const dn = d + (nz(E3, X, Y, 515, 271, 2) - 0.5) * 1.3 + (nz(E, X, Y, 97, 811, 1) - 0.5) * 0.5;
                const dp = smoothstep(0.8, 3.0, dn) * 0.4;
                // the shallows laid over the darker deep, so the two run into each other
                a = sh + dp * (1 - sh);
                if (a > 0.002) {
                  const ks = sh / a;
                  const kd = 1 - ks;
                  r = SHALLOW[0] * ks + 26 * kd;
                  g = SHALLOW[1] * ks + 64 * kd;
                  b = SHALLOW[2] * ks + 80 * kd;
                }
              }
            } else {
              wall(A, tex, own, X, Y, false, snow);
              r = cr;
              g = cg;
              b = cb;
              a = 1;
            }
          } else {
            for (let i = 1; i < n; i++) {
              const c = lc[i]!;
              const w = lw[i]!;
              let j = i - 1;
              while (j >= 0 && PRIO[lc[j]!]! > PRIO[c]!) {
                lc[j + 1] = lc[j]!;
                lw[j + 1] = lw[j]!;
                j--;
              }
              lc[j + 1] = c;
              lw[j + 1] = w;
            }
            sample(tex, lc[0]!, X, Y, false);
            r = cr;
            g = cg;
            b = cb;
            for (let i = 1; i < n; i++) {
              // package 52: bare stone ends in a broken, crumbling edge with grass in its bays, never a straight cut
              const v =
                paint && lc[i] === C_T
                  ? lw[i]! +
                    (nz(E2, X, Y, 433, 97, 0) - 0.5) * 0.75 +
                    (nz(E, X, Y, 61, 905, 0) - 0.5) * 0.5 +
                    (nz(E3, X, Y, 17, 333, 1) - 0.5) * 0.5
                  : lw[i]! + e;
              const t = paint ? smoothstep(0.4, 0.6, v) : smoothstep(KB, KT, v);
              if (t <= 0) continue;
              sample(tex, lc[i]!, X, Y, false);
              r += (cr - r) * t;
              g += (cg - g) * t;
              b += (cb - b) * t;
            }
            if (paint) {
              // package 48: fine painted blades over the grass, light and dark, so the open ground reads as brushwork
              let gwt = 0;
              for (let i = 0; i < n; i++) if (lc[i] === C_G) gwt = lw[i]!;
              if (gwt > 0.3) {
                // blades thick in some places and sparse in others, over a mottle of small light and dark dabs
                const thick = 0.25 + 0.75 * smoothstep(0.35, 0.65, nz(E, X, Y, 523, 287, 0));
                const bs = blades(X, Y) * thick * smoothstep(0.3, 0.7, gwt) * (snow ? 0.4 : 1);
                const mo = 1 + (nz(E2, X, Y, 171, 659, 0) - 0.5) * (snow ? 0.06 : 0.14) * gwt;
                r *= mo;
                g *= mo;
                b *= mo;
                if (bs > 0) {
                  r = r * (1 + 0.16 * bs) + 10 * bs;
                  g = g * (1 + 0.14 * bs) + 8 * bs;
                  b *= 1 + 0.02 * bs;
                } else if (bs < 0) {
                  r *= 1 + 0.2 * bs;
                  g *= 1 + 0.14 * bs;
                  b *= 1 + 0.18 * bs;
                }
              }
            }
            if (paint && (A.fp || A.fk)) {
              trails(A, tex, set, X, Y, r, g, b);
              r = cr;
              g = cg;
              b = cb;
            }
            // broad world-scale light variation, so the 512 px texture repeat does not show; plus a soft shadow at the foot of a wall
            let k = 0.93 + 0.14 * E[(((Y >> 3) & 1023) << 10) | ((X >> 3) & 1023)]!;
            if ((wy & 63) < 14 && closed(A, wx >> 6, (wy >> 6) - 1)) k *= 1 - 0.3 * (1 - (wy & 63) / 14);
            r *= k;
            g *= k;
            b *= k;
            if (paint) {
              // large warm and cool washes, like watercolour laid over the whole island
              const w = E3[(((Y >> 3) & 1023) << 10) | ((X >> 3) & 1023)]!;
              // in the snow only the cool half, and gently
              // warm yellow-green in the open, a cooler, deeper green in the hollows
              const warm = snow ? 0 : smoothstep(0.42, 0.85, w);
              const cool = (1 - smoothstep(0.15, 0.55, w)) * (snow ? 0.4 : 1);
              r *= 1 + 0.2 * warm - 0.14 * cool;
              g *= 1 + 0.09 * warm - 0.05 * cool;
              b *= 1 - 0.16 * warm + 0.06 * cool;
              // and a softer dapple of light and shade at a smaller scale
              const d = E[((((Y >> 2) + 300) & 1023) << 10) | (((X >> 2) + 500) & 1023)]!;
              // package 48: big soft patches of lighter and darker ground as well
              const lp = nz(E3, X, Y, 461, 157, 3);
              const lpk = smoothstep(0.2, 0.8, lp);
              const dk = (0.92 + 0.14 * smoothstep(0.2, 0.8, d)) * (0.86 + 0.26 * lpk);
              r *= dk * (snow ? 1 : 0.97 + 0.07 * lpk);
              g *= dk;
              b *= dk * (snow ? 1 : 1.04 - 0.1 * lpk);
            }
            if (landField < 0.9999) {
              const wn =
                (E[(((Y + 517) & 1023) << 10) | ((X + 331) & 1023)]! - 0.5) * 0.55 +
                (E2[(((Y + 59) & 1023) << 10) | ((X + 601) & 1023)]! - 0.5) * 0.3;
              if (paint) {
                // the noise fades out inland, so the bank never ends in a seam
                const s = landField + wn * 0.6 * Math.min(1, (1 - landField) * 2.5);
                const brk = smoothstep(0.3, 0.6, nz(E, X, Y, 905, 61, 1));
                a = shore(s, lc[0] === C_S, snow, r, g, b, shallowA(depthAt(A, XW, YW)), brk);
                r = cr;
                g = cg;
                b = cb;
              } else {
                const s = landField + wn;
                a = smoothstep(0.41, 0.59, s);
                const fd = Math.abs(s - 0.36);
                if (fd < 0.05) foam = (1 - fd / 0.05) * 0.6;
              }
            } else a = 1;
          }
          if (foam > 0 && a < 1) {
            const ao = a + foam * (1 - a);
            const fk = (foam * (1 - a)) / ao;
            const ak = a / ao;
            r = r * ak + 240 * fk;
            g = g * ak + 248 * fk;
            b = b * ak + 255 * fk;
            a = ao;
          }
        }
      }
      if (A.indoor) {
        if (roomWall(A, X, Y)) {
          r = cr;
          g = cg;
          b = cb;
          a = 1;
        } else if (bl && ly < 16 && ownK === LAND && closed(A, tx, ty - 1)) {
          // soft shadow at the foot of the wall (the wobbly path draws its own)
          const k = 1 - 0.32 * (1 - ly / 16);
          r *= k;
          g *= k;
          b *= k;
        }
        if (q8 && KIND[own] === LAND) {
          const k = 0.93 + 0.14 * hash(X >> 3, Y >> 3, 79);
          r *= k;
          g *= k;
          b *= k;
        }
      }
      // stepping stones and bridges, drawn opaque over the hole
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let sa = 0;
      if (own === C_E) {
        const h1 = hash(tx, ty, 501);
        const ccx = 32 + (h1 - 0.5) * 8;
        const ccy = 32 + (hash(tx, ty, 502) - 0.5) * 8;
        const rad = 22 + hash(tx, ty, 503) * 5;
        const dx = lx + 0.5 - ccx;
        const dy = ly + 0.5 - ccy;
        const d = Math.hypot(dx, dy);
        if (d < rad) {
          sample(tex, own, X, Y, bl);
          let k = 1 - (0.28 * (dx + dy)) / rad / 1.4;
          if (d > rad - 2.5) k *= 0.55;
          sr = cr * k;
          sg = cg * k;
          sb = cb * k;
          sa = Math.min(1, rad - d);
        } else if (Math.hypot(dx - 3, dy - 5) < rad) {
          sa = 0.35;
        }
      } else {
        sa = bridgeAt(A, tex, X, Y, false);
        sr = cr;
        sg = cg;
        sb = cb;
      }
      if (sa > 0) {
        const ao = sa + a * (1 - sa);
        const ka = sa / ao;
        const kb = (a * (1 - sa)) / ao;
        r = sr * ka + r * kb;
        g = sg * ka + g * kb;
        b = sb * ka + b * kb;
        a = ao;
      }
      const o = (py * CHUNK + px) * 4;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = Math.round(a * 255);
    }
  }
  const X0 = cx * CHUNK;
  const Y0 = cy * CHUNK;
  if (A.wear.length) castWear(A, tex, out, X0, Y0, snow);
  // painted pieces at full strength, each resized once from the atlas and laid 1:1, so they stay crisp
  for (const c of A.chips) {
    if (c.x >= X0 + CHUNK || c.y >= Y0 + CHUNK || c.x + c.w <= X0 || c.y + c.h <= Y0) continue;
    const img = CHIP_IMG[set][c.name]?.[c.b];
    if (!img) continue;
    const x0 = Math.max(c.x, X0);
    const y0 = Math.max(c.y, Y0);
    const x1 = Math.min(c.x + img.w, X0 + CHUNK);
    const y1 = Math.min(c.y + img.h, Y0 + CHUNK);
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const u = c.flip ? img.w - 1 - (x - c.x) : x - c.x;
        const s = ((y - c.y) * img.w + u) * 4;
        let sa = img.px[s + 3]! / 255;
        if (sa <= 0.004) continue;
        const o = ((y - Y0) * CHUNK + (x - X0)) * 4;
        const da = out[o + 3]! / 255;
        let pr = img.px[s]!;
        let pg = img.px[s + 1]!;
        let pb = img.px[s + 2]!;
        // package 52: the pale mat takes the ground's own colour under it, keeping only the mat's light and dark,
        // and over water it fades away, so reeds stand in the shallows without a patch of sand round them
        const m = img.mat[(y - c.y) * img.w + u]!;
        if (m > 0) {
          const kl = Math.max(0.84, Math.min(1.12, (pr * 0.3 + pg * 0.59 + pb * 0.11) / img.ml)) * 0.97;
          const t = Math.min(1, m * 1.15);
          pr += (out[o]! * kl - pr) * t;
          pg += (out[o + 1]! * kl - pg) * t;
          pb += (out[o + 2]! * kl - pb) * t;
          sa *= 1 - m * (1 - da) * 0.9;
        }
        const ao = sa + da * (1 - sa);
        if (ao <= 0) continue;
        const ka = sa / ao;
        const kb = (da * (1 - sa)) / ao;
        out[o] = pr * ka + out[o]! * kb;
        out[o + 1] = pg * ka + out[o + 1]! * kb;
        out[o + 2] = pb * ka + out[o + 2]! * kb;
        out[o + 3] = Math.round(ao * 255);
      }
  }
  if (A.shades.length) castShades(A, out, X0, Y0, snow);
  // baked flat decoration
  for (const d of A.decor) {
    const x0 = Math.max(d.x, X0);
    const y0 = Math.max(d.y, Y0);
    const x1 = Math.min(d.x + d.w, X0 + CHUNK);
    const y1 = Math.min(d.y + d.h, Y0 + CHUNK);
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const s = ((y - d.y) * d.w + (x - d.x)) * 4;
        const sa = d.px[s + 3]! / 255;
        if (sa <= 0) continue;
        const o = ((y - Y0) * CHUNK + (x - X0)) * 4;
        const da = out[o + 3]! / 255;
        const ao = sa + da * (1 - sa);
        const ka = sa / ao;
        const kb = (da * (1 - sa)) / ao;
        out[o] = d.px[s]! * ka + out[o]! * kb;
        out[o + 1] = d.px[s + 1]! * ka + out[o + 1]! * kb;
        out[o + 2] = d.px[s + 2]! * ka + out[o + 2]! * kb;
        out[o + 3] = Math.round(ao * 255);
      }
  }
  return out;
}

/**
 * Worn earth in front of each door: the path's colour laid over the grass in a ragged patch that fades out, under
 * the pieces and the shadows.
 */
function castWear(A: Area, tex: (Tex | null)[], out: Uint8ClampedArray, X0: number, Y0: number, snow: boolean): void {
  for (const w of A.wear) {
    const x0 = Math.max(X0, Math.floor(w.x - w.rx));
    const x1 = Math.min(X0 + CHUNK, Math.ceil(w.x + w.rx));
    const y0 = Math.max(Y0, Math.floor(w.y - w.ry));
    const y1 = Math.min(Y0 + CHUNK, Math.ceil(w.y + w.ry));
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const dx = (x + 0.5 - w.x) / w.rx;
        const dy = (y + 0.5 - w.y) / w.ry;
        const d = dx * dx + dy * dy + (nz(E2, x, y, 59, 333, 0) - 0.5) * 0.5;
        const k = (1 - smoothstep(0.35, 0.95, d)) * 0.75;
        if (k <= 0) continue;
        const o = ((y - Y0) * CHUNK + (x - X0)) * 4;
        if (out[o + 3]! < 250) continue;
        sample(tex, C_P, x, y, false);
        // package 52: in the snow only a little trodden, not a grey patch
        const m = snow ? 0.94 : 0.92;
        const kk = snow ? k * 0.5 : k;
        out[o] += (cr * m - out[o]!) * kk;
        out[o + 1] += (cg * m - out[o + 1]!) * kk;
        out[o + 2] += (cb * m - out[o + 2]!) * kk;
      }
  }
}

let SHADE_BUF: Float32Array | null = null;
/** The contact shadows over a chunk: the deepest of any that overlap, cool in colour, never on open water. */
function castShades(A: Area, out: Uint8ClampedArray, X0: number, Y0: number, snow: boolean): void {
  const buf = (SHADE_BUF ??= new Float32Array(CHUNK * CHUNK));
  buf.fill(0);
  let any = false;
  for (const sh of A.shades) {
    const lx = sh.lx ?? 0;
    const ly = sh.ly ?? 0;
    const x0 = Math.max(X0, Math.floor(sh.x - sh.rx - lx));
    const x1 = Math.min(X0 + CHUNK, Math.ceil(sh.x + sh.rx + lx));
    const y0 = Math.max(Y0, Math.floor(sh.y - sh.ry - ly));
    const y1 = Math.min(Y0 + CHUNK, Math.ceil(sh.y + sh.ry + ly));
    if (x0 >= x1 || y0 >= y1) continue;
    any = true;
    for (let y = y0; y < y1; y++) {
      const dy = Math.max(0, Math.abs(y + 0.5 - sh.y) - ly) / sh.ry;
      for (let x = x0; x < x1; x++) {
        const dx = Math.max(0, Math.abs(x + 0.5 - sh.x) - lx) / sh.rx;
        const d = dx * dx + dy * dy;
        if (d >= 1) continue;
        const v = sh.k * smoothstep(0, 1, 1 - d);
        const i = (y - Y0) * CHUNK + (x - X0);
        if (v > buf[i]!) buf[i] = v;
      }
    }
  }
  if (!any) return;
  for (let i = 0; i < CHUNK * CHUNK; i++) {
    const v = buf[i]!;
    if (v <= 0) continue;
    const o = i * 4;
    // a shadow on a bank fades with the land, so it never darkens the water
    const k = v * (out[o + 3]! / 255);
    out[o] *= 1 - k;
    out[o + 1] *= 1 - k * 0.9;
    out[o + 2] *= 1 - k * (snow ? 0.5 : 0.72);
  }
}

/**
 * One warm daylight over the painted ground (normal set only; the snow keeps its cool light): a little less
 * saturation, a little more red and less blue. Baked, so it costs nothing per frame.
 */
function grade(out: Uint8ClampedArray): void {
  for (let o = 0; o < out.length; o += 4) {
    if (out[o + 3] === 0) continue;
    const r = out[o]!;
    const g = out[o + 1]!;
    const b = out[o + 2]!;
    const l = r * 0.3 + g * 0.59 + b * 0.11;
    out[o] = (l + (r - l) * 0.88) * 1.05 + 5;
    out[o + 1] = (l + (g - l) * 0.88) * 1.01 + 2;
    out[o + 2] = (l + (b - l) * 0.88) * 0.88 + 2;
  }
}

/** Grass tufts round the painted pieces, as filled curved blades (an SVG drawn by sharp), laid over the chunk. */
async function drawTufts(A: Area, set: SetId, cx: number, cy: number, out: Uint8ClampedArray): Promise<void> {
  const X0 = cx * CHUNK;
  const Y0 = cy * CHUNK;
  const parts: string[] = [];
  const [dark, light] = set === 's' ? ['#71866f', '#e6edf2'] : ['#566c36', '#b8bf6e'];
  const blooms = set === 's' ? ['#f4f6fa', '#f4f6fa', '#e8eef6'] : ['#f6f1df', '#f2cf4a', '#d9503e'];
  for (const t of A.tufts) {
    if (t.x < X0 - 40 || t.x > X0 + CHUNK + 40 || t.y < Y0 - 10 || t.y > Y0 + CHUNK + 40) continue;
    const rng = seeded(t.seed);
    const x = t.x - X0;
    const y = t.y - Y0;
    if (t.bloom) {
      // a few small flowers with a darker heart, among three short blades
      const col = blooms[t.bloom - 1]!;
      for (let i = 0; i < 4; i++) {
        const fx = x + (rng() - 0.5) * 14;
        const fy = y + (rng() - 0.5) * 8;
        parts.push(
          `<circle cx="${fx.toFixed(1)}" cy="${(fy + 1).toFixed(1)}" r="2.6" fill="${dark}" opacity="0.5"/>` +
            `<circle cx="${fx.toFixed(1)}" cy="${fy.toFixed(1)}" r="2.2" fill="${col}"/>` +
            `<circle cx="${fx.toFixed(1)}" cy="${fy.toFixed(1)}" r="0.8" fill="#c08a2a"/>`,
        );
      }
      continue;
    }
    for (let i = 0; i < 7; i++) {
      const u = rng() - 0.5;
      const dx = u * t.size * 1.5;
      const base = x + u * t.size * 0.4;
      const tip = y - t.size * (0.3 + rng() * 0.7);
      const end = base + dx;
      const f = (v: number) => v.toFixed(1);
      parts.push(
        `<path d="M${f(base - 1.3)} ${f(y)}Q${f(base + dx * 0.27)} ${f(tip + t.size * 0.06)} ${f(end)} ${f(tip)}` +
          `Q${f(base + dx * 0.55)} ${f(tip + t.size * 0.17)} ${f(base + 1.6)} ${f(y)}Z" fill="${i % 3 ? dark : light}"/>`,
      );
    }
  }
  if (!parts.length) return;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CHUNK}" height="${CHUNK}">${parts.join('')}</svg>`;
  const top = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer();
  for (let i = 0; i < CHUNK * CHUNK; i++) {
    const o = i * 4;
    const sa = top[o + 3]! / 255;
    if (sa <= 0) continue;
    const da = out[o + 3]! / 255;
    const ao = sa + da * (1 - sa);
    const ka = sa / ao;
    const kb = (da * (1 - sa)) / ao;
    out[o] = top[o]! * ka + out[o]! * kb;
    out[o + 1] = top[o + 1]! * ka + out[o + 1]! * kb;
    out[o + 2] = top[o + 2]! * ka + out[o + 2]! * kb;
    out[o + 3] = Math.round(ao * 255);
  }
}

async function runJob(j: Job): Promise<Uint8Array> {
  const A = AREAS[j.area]!;
  const px = renderChunk(A, j.set, j.cx, j.cy);
  await drawTufts(A, j.set, j.cx, j.cy, px);
  if (!A.indoor && j.set === 'n') grade(px);
  const raw = { raw: { width: CHUNK, height: CHUNK, channels: 4 as const } };
  const file = join(OUT, j.area, j.set, `${j.cx}_${j.cy}.webp`);
  await sharp(px, raw).webp({ quality: 83, alphaQuality: 90, effort: 5 }).toFile(file);
  const small = await sharp(px, raw).resize(SMALL, SMALL).raw().toBuffer();
  return new Uint8Array(small);
}

if (!isMainThread && parentPort) {
  const port = parentPort;
  const ready = initWorker();
  port.on('message', async (j: Job) => {
    await ready;
    const small = await runJob(j);
    port.postMessage({ job: j, small }, [small.buffer as ArrayBuffer]);
  });
}

// ---------------------------------------------------------------- main side

/** The painted water the view scrolls under the ground (from the landscape set), made seamless at TS px. */
async function writeWater(): Promise<void> {
  const file = join(LAND_DIR, 'water.webp');
  if (!existsSync(file)) return;
  // package 48: laid two by two at half size instead of blown up, and the ripple crests lifted, so the painted
  // ripple strokes survive at the game's zoom
  const half = TS / 2;
  // package 52: the source does not tile, so one half-size repeat is made seamless before it is laid two by two
  // (blending the 2 x 2 sheet instead pulled the wrap seam into the middle: a grid of steps in every pond and sea)
  const raw = await sharp(file).removeAlpha().resize(half, half, { fit: 'fill', kernel: 'lanczos3' }).raw().toBuffer();
  const one = seamless(new Uint8Array(raw.buffer, raw.byteOffset, raw.length), half, 3);
  // the ripple crests lifted against a blur taken over a 3 x 3 sheet, so the lift wraps as well
  const big = new Uint8Array(half * 3 * half * 3 * 3);
  for (let y = 0; y < half * 3; y++)
    for (let k = 0; k < 3; k++)
      big.set(one.subarray((y % half) * half * 3, ((y % half) + 1) * half * 3), (y * half * 3 + k * half) * 3);
  const soft = await sharp(Buffer.from(big), { raw: { width: half * 3, height: half * 3, channels: 3 } })
    .blur(4)
    .extract({ left: half, top: half, width: half, height: half })
    .raw()
    .toBuffer();
  for (let i = 0; i < one.length; i += 3) {
    const l = one[i]! * 0.3 + one[i + 1]! * 0.59 + one[i + 2]! * 0.11;
    const m = soft[i]! * 0.3 + soft[i + 1]! * 0.59 + soft[i + 2]! * 0.11;
    const d = l - m;
    const lift = d > 0 ? d * 1.6 : d * 0.6;
    for (let q = 0; q < 3; q++) one[i + q] = Math.max(0, Math.min(255, one[i + q]! + lift));
  }
  const px = new Uint8Array(TS * TS * 3);
  for (let y = 0; y < TS; y++)
    for (let k = 0; k < 2; k++)
      px.set(one.subarray((y % half) * half * 3, ((y % half) + 1) * half * 3), (y * TS + k * half) * 3);
  // the summer creek's quiet teal, a shade bluer for the sea round the island
  for (let i = 0; i < px.length; i += 3) {
    px[i] = Math.min(255, px[i]! * 0.88 + 4);
    px[i + 1] = Math.min(255, px[i + 1]! * 0.97 + 6);
    px[i + 2] = Math.min(255, px[i + 2]! * 0.9 + 6);
  }
  await sharp(px, { raw: { width: TS, height: TS, channels: 3 } })
    .webp({ quality: 82 })
    .toFile(join(OUT, 'water.webp'));
}

/**
 * Fence pieces for a run down the screen (package 52), made by machine from the painted pieces in art/src/objects:
 * <id>_v, a post (or, for the picket fence, its boards seen edge on) with the rails seen end on running up to the post
 * above; <id>_vt, the top of such a run; <id>_vc, the sideways piece with rails running up from it (a corner below a
 * run). Art is at 1.5 x screen size, so a tile is 96 px; every piece keeps its foot on the bottom row, like the source.
 */
const FENCE_RUNS = ['fence', 'plot_fence'];
async function writeFenceRuns(): Promise<string[]> {
  const AT = 96;
  const made: string[] = [];
  type Img = { px: Uint8Array; w: number; h: number };
  const load = async (f: string): Promise<Img> => {
    const { data, info } = await sharp(f).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { px: new Uint8Array(data.buffer, data.byteOffset, data.length), w: info.width, h: info.height };
  };
  const blank = (w: number, h: number): Img => ({ px: new Uint8Array(w * h * 4), w, h });
  /** lay src (or a part of it) over dst at x, y, with a brightness factor */
  const lay = (dst: Img, src: Img, x: number, y: number, k = 1, sx0 = 0, sw = src.w): void => {
    for (let j = 0; j < src.h; j++)
      for (let i = 0; i < sw; i++) {
        const X = x + i;
        const Y = y + j;
        if (X < 0 || Y < 0 || X >= dst.w || Y >= dst.h) continue;
        const s = (j * src.w + sx0 + i) * 4;
        const a = src.px[s + 3]! / 255;
        if (a <= 0) continue;
        const o = (Y * dst.w + X) * 4;
        const da = dst.px[o + 3]! / 255;
        const ao = a + da * (1 - a);
        for (let c = 0; c < 3; c++)
          dst.px[o + c] = Math.min(255, (src.px[s + c]! * k * a + dst.px[o + c]! * da * (1 - a)) / ao);
        dst.px[o + 3] = Math.round(ao * 255);
      }
  };
  const save = async (img: Img, name: string): Promise<void> => {
    await sharp(Buffer.from(img.px), { raw: { width: img.w, height: img.h, channels: 4 } })
      .png()
      .toFile(join(ROOT, 'art/src/objects', name + '.png'));
    made.push(name);
  };
  for (const id of FENCE_RUNS) {
    const plain = join(ROOT, 'art/src/objects', id + '.png');
    if (!existsSync(plain)) continue;
    const base = await load(plain);
    const { w: W, h: H } = base;
    const alpha = (img: Img, x: number, y: number) => img.px[(y * img.w + x) * 4 + 3]!;
    // the rails: rows nearly solid across the piece; the uprights: columns solid nearly top to bottom
    const rows: number[] = [];
    for (let y = 0; y < H; y++) {
      let n = 0;
      for (let x = 0; x < W; x++) if (alpha(base, x, y) > 128) n++;
      rows.push(n);
    }
    const rails: [number, number][] = [];
    for (let y = 0; y < H; y++)
      if (rows[y]! > W * 0.8) {
        if (rails.length && rails[rails.length - 1]![1] === y - 1) rails[rails.length - 1]![1] = y;
        else rails.push([y, y]);
      }
    let foot = H - 1;
    while (foot > 0 && rows[foot] === 0) foot--;
    const ups: [number, number][] = [];
    for (let x = 0; x < W; x++) {
      let n = 0;
      for (let y = 0; y < H; y++) if (alpha(base, x, y) > 128) n++;
      if (n > (foot + 1) * 0.85) {
        if (ups.length && ups[ups.length - 1]![1] === x - 1) ups[ups.length - 1]![1] = x;
        else ups.push([x, x]);
      }
    }
    if (rails.length < 2 || ups.length < 1) {
      console.log(`fence runs: ${id} not measured (rails ${rails.length}, uprights ${ups.length}), left as it is`);
      continue;
    }
    // a slice of rail where nothing crosses it, turned end on: its cross-section stretched down a tile
    let rx = 0;
    for (let x = 2; x < W - 2; x++) if (!ups.some(([a, b]) => x >= a - 2 && x <= b + 2)) rx = x;
    const cx = Math.round(W / 2);
    for (const snow of [false, true]) {
      const src = snow ? join(ROOT, 'art/src/objects', id + '_snow.png') : plain;
      if (!existsSync(src)) continue;
      const piece = snow ? await load(src) : base;
      // a snow piece is taller by its caps, at the top
      const dy = piece.h - H;
      /** one rail seen end on, from rail row r0..r1 of this post up to the same rail on the post above */
      const strip = (r0: number, r1: number, span = AT): Img => {
        const t = r1 - r0 + 1;
        const len = t + span;
        const out = blank(t, len);
        for (let j = 0; j < len; j++) {
          // a soft grain down its length
          const k = 0.93 + 0.1 * hash(j >> 2, rx, 517) + 0.03 * Math.sin(j * 0.21);
          for (let i = 0; i < t; i++) {
            // the cross-section of the rail at its row i, lit from the left
            const s = ((r0 + i) * W + rx) * 4;
            const o = (j * t + i) * 4;
            let [r, g, b] = [base.px[s]!, base.px[s + 1]!, base.px[s + 2]!];
            const lit = 1.06 - (0.14 * i) / Math.max(1, t - 1);
            r *= k * lit;
            g *= k * lit;
            b *= k * lit;
            if (snow) {
              // snow along the top of the rail: a pale line down its middle
              const m = 1 - Math.abs(i - (t - 1) / 2) / Math.max(1, t / 2);
              const sn = Math.max(0, m - 0.4) * 1.0;
              r += (236 - r) * sn;
              g += (242 - g) * sn;
              b += (250 - b) * sn;
            }
            out.px[o] = Math.min(255, r);
            out.px[o + 1] = Math.min(255, g);
            out.px[o + 2] = Math.min(255, b);
            out.px[o + 3] = Math.min(255, base.px[s + 3]! * (j < 2 || j > len - 3 ? 0.6 : 1));
          }
        }
        return out;
      };
      const [up, lo] = [rails[0]!, rails[rails.length - 1]!];
      const sUp = strip(up[0], up[1]);
      const sLo = strip(lo[0], lo[1]);
      /** the uprights of the run: a post as it is, or a picket's board seen edge on, four to a tile */
      const uprights = (dst: Img, oy: number): void => {
        if (ups.length === 1) {
          const [a, b] = ups[0]!;
          const wpost = b - a + 1;
          const post = blank(wpost + 4, piece.h);
          for (let y = 0; y < piece.h; y++)
            for (let x = 0; x < wpost + 4; x++) {
              const sx = a - 2 + x;
              if (sx < 0 || sx >= W) continue;
              // only the post itself, not the rails running out of it
              const inRail = rails.some(([r0, r1]) => y - dy >= r0 - 1 && y - dy <= r1 + 1);
              if (inRail && (x < 2 || x >= wpost + 2)) continue;
              for (let c = 0; c < 4; c++) post.px[(y * post.w + x) * 4 + c] = piece.px[(y * W + sx) * 4 + c]!;
            }
          lay(dst, post, cx - Math.round(post.w / 2), oy);
          return;
        }
        const [a, b] = ups[0]!;
        const pw = b - a + 1;
        const board = blank(Math.max(8, pw + 2), piece.h);
        for (let y = 0; y < piece.h; y++)
          for (let x = 0; x < board.w; x++) {
            const sx = a + Math.min(pw - 1, Math.round(((x + 0.5) / board.w) * pw - 0.5));
            // the board's face lit on the left, its edge in shade on the right
            const k = x < board.w * 0.74 ? 1.02 : 0.74;
            const o = (y * board.w + x) * 4;
            const so = (y * W + sx) * 4;
            for (let c = 0; c < 3; c++) board.px[o + c] = Math.min(255, piece.px[so + c]! * k);
            board.px[o + 3] = piece.px[so + 3]!;
          }
        for (let q = 3; q >= 0; q--)
          lay(dst, board, cx - Math.round(board.w / 2), oy - Math.round((q * AT) / 4), q === 0 ? 0.92 : 0.86);
      };
      const tall = piece.h + AT;
      // _v: rails from this post up to the one above, the post over them
      const v = blank(W, tall);
      lay(v, sLo, cx - Math.round(sLo.w / 2), lo[0] + dy);
      lay(v, sUp, cx - Math.round(sUp.w / 2), up[0] + dy);
      uprights(v, AT);
      await save(v, `${id}_v${snow ? '_snow' : ''}`);
      // _vt: the top of a run, no rails above it
      const vt = blank(W, tall);
      if (ups.length > 1) {
        // the picket's boards are joined by rails inside the tile
        const span = Math.round((3 * AT) / 4);
        for (const r of [lo, up]) {
          const st = strip(r[0], r[1], span);
          lay(vt, st, cx - Math.round(st.w / 2), r[0] + dy + AT - span);
        }
      }
      uprights(vt, AT);
      await save(vt, `${id}_vt${snow ? '_snow' : ''}`);
      // _vc: the sideways piece with the rails running up from its middle
      const vc = blank(W, tall);
      lay(vc, sLo, cx - Math.round(sLo.w / 2), lo[0] + dy);
      lay(vc, sUp, cx - Math.round(sUp.w / 2), up[0] + dy);
      lay(vc, piece, 0, AT);
      await save(vc, `${id}_vc${snow ? '_snow' : ''}`);
    }
  }
  return made;
}

function dirSize(p: string): number {
  if (!existsSync(p)) return 0;
  const st = statSync(p);
  if (!st.isDirectory()) return st.size;
  let n = 0;
  for (const f of readdirSync(p)) n += dirSize(join(p, f));
  return n;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const opt = (k: string): string | undefined => {
    const i = args.indexOf(k);
    return i >= 0 ? args[i + 1] : undefined;
  };
  // --fences: only the fence pieces for runs down the screen
  if (args.includes('--fences')) {
    console.log(`fence runs: ${(await writeFenceRuns()).join(' ')}`);
    return;
  }
  const onlyArea = opt('--area');
  const onlySet = opt('--set');
  // --chunks 3_4,5_6: only these chunks (a quick look while painting; the overview pictures are then partial)
  const chunkList = opt('--chunks');
  const onlyChunks = chunkList ? new Set(chunkList.split(',')) : null;
  if (onlySet && onlySet !== 'n' && onlySet !== 's') throw new Error('--set must be n or s');
  const defs = loadAreas();
  if (onlyArea && !defs[onlyArea]) throw new Error(`unknown area ${onlyArea}; known: ${Object.keys(defs).join(', ')}`);
  const t0 = performance.now();
  const jobs: Job[] = [];
  const views = new Map<string, Uint8Array>();
  for (const [id, def] of Object.entries(defs)) {
    if (onlyArea && id !== onlyArea) continue;
    const { cw, ch } = chunksOf(def);
    for (const set of setsOf(def)) {
      if (onlySet && set !== onlySet) continue;
      mkdirSync(join(OUT, id, set), { recursive: true });
      views.set(id + '/' + set, new Uint8Array(cw * SMALL * ch * SMALL * 4));
      for (let cy = 0; cy < ch; cy++)
        for (let cx = 0; cx < cw; cx++)
          if (!onlyChunks || onlyChunks.has(`${cx}_${cy}`)) jobs.push({ area: id, set: set as SetId, cx, cy });
    }
  }
  mkdirSync(QA, { recursive: true });
  // a quick look at a few chunks stays light: two workers
  const nWorkers = Math.max(1, Math.min(jobs.length, onlyChunks ? 2 : availableParallelism() - 2));
  let next = 0;
  let done = 0;
  await new Promise<void>((resolve, reject) => {
    if (jobs.length === 0) return resolve();
    for (let w = 0; w < nWorkers; w++) {
      const worker = new Worker(new URL(import.meta.url));
      worker.on('error', reject);
      worker.on('message', (m: { job: Job; small: Uint8Array }) => {
        const { job, small } = m;
        const def = defs[job.area]!;
        const view = views.get(job.area + '/' + job.set)!;
        const vw = chunksOf(def).cw * SMALL;
        for (let y = 0; y < SMALL; y++)
          view.set(
            small.subarray(y * SMALL * 4, (y + 1) * SMALL * 4),
            ((job.cy * SMALL + y) * vw + job.cx * SMALL) * 4,
          );
        done++;
        if (next < jobs.length) worker.postMessage(jobs[next++]);
        else worker.terminate();
        if (done === jobs.length) resolve();
      });
      if (next < jobs.length) worker.postMessage(jobs[next++]);
    }
  });
  // overviews over mid blue, cropped to the area
  for (const [key, view] of views) {
    const [id, set] = key.split('/') as [string, string];
    const def = defs[id]!;
    const vw = chunksOf(def).cw * SMALL;
    const w = def.w * (TILE / 8);
    const h = def.h * (TILE / 8);
    const rgb = new Uint8Array(w * h * 3);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const s = (y * vw + x) * 4;
        const al = view[s + 3]! / 255;
        const o = (y * w + x) * 3;
        rgb[o] = view[s]! * al + 64 * (1 - al);
        rgb[o + 1] = view[s + 1]! * al + 120 * (1 - al);
        rgb[o + 2] = view[s + 2]! * al + 200 * (1 - al);
      }
    await sharp(rgb, { raw: { width: w, height: h, channels: 3 } })
      .jpeg({ quality: 85 })
      .toFile(join(QA, `ground-${id}-${set}.jpg`));
  }
  const index: { chunk: number; areas: Record<string, { cw: number; ch: number; sets: SetId[] }> } = {
    chunk: CHUNK,
    areas: {},
  };
  for (const [id, def] of Object.entries(defs)) index.areas[id] = { ...chunksOf(def), sets: setsOf(def) };
  // whole bridges for the gaps, laid over by the view once built
  const gaps = Object.entries(defs).filter(
    ([id, def]) => (!onlyArea || id === onlyArea) && (def.barriers ?? []).some((b) => b.art === 'broken_bridge'),
  );
  if (gaps.length) {
    await initWorker();
    const made: string[] = [];
    // a snow version only when the bridge texture has one
    for (const [id, def] of gaps)
      for (const b of def.barriers.filter((x) => x.art === 'broken_bridge'))
        for (const set of setsOf(def))
          if (set === 'n' || TEX.s[C_B] !== TEX.n[C_B]) made.push(await writeBridge(AREAS[id]!, b.id, b.rect, set));
    console.log(`bridges: ${made.join(' ')} -> art/src/objects (run node tools/art/pack.ts)`);
  }
  await writeWater();
  if (!onlyArea || onlyArea === 'island') {
    const runs = await writeFenceRuns();
    console.log(`fence runs: ${runs.join(' ')} -> art/src/objects (run node tools/art/pack.ts)`);
  }
  writeFileSync(join(OUT, 'index.json'), JSON.stringify(index, null, 2) + '\n');
  const secs = (performance.now() - t0) / 1000;
  const mb = dirSize(OUT) / 1048576;
  console.log(
    `ground: ${jobs.length} chunks with ${nWorkers} workers in ${secs.toFixed(1)} s; public/assets/ground is ${mb.toFixed(1)} MB`,
  );
}

if (isMainThread) await main();
