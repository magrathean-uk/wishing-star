// Package 72 (D78): every building on the island can be entered, and its inside matches its outside. Each room has its
// own shape (a wide cafe, a long greenhouse, a round stone tower of three floors, a small plank room in a tree), one
// thing only it has and one thing to do. Until Codex draws the missing pieces, a stand-in object of its own id shows
// the nearest picture we have (src/data/objects.ts), so the swap is a data change. Wall faces and painted pieces:
// ROOM_FACE, ROOM_TINT and ROOM_DECOR in tools/map/bake.ts.
import type { Cond } from '../../src/core/types.ts';
import { objects } from '../../src/data/objects.ts';
import { MapMaker } from './lib.ts';

/** The island side of each new room: the door tile in front of the picture's door, and where she lands inside. */
export interface RoomDoor {
  room: string;
  building: string;
  x: number;
  y: number;
  tx: number;
  ty: number;
  if?: Cond;
}
export const ROOM_DOORS: RoomDoor[] = [
  { room: 'cafe_in', building: 'cafe', x: 70, y: 52, tx: 9, ty: 5 },
  { room: 'doll_in', building: 'dollhouse', x: 86, y: 52, tx: 7, ty: 6 },
  { room: 'post_in', building: 'post_office', x: 93, y: 52, tx: 6, ty: 5 },
  { room: 'nook_in', building: 'nanny_nook', x: 60, y: 58, tx: 4, ty: 4 },
  { room: 'school_in', building: 'school', x: 61, y: 67, tx: 7, ty: 6 },
  { room: 'green_in', building: 'greenhouse', x: 85, y: 67, tx: 8, ty: 3 },
  { room: 'lookout_in', building: 'lookout', x: 90, y: 101, tx: 3, ty: 3 },
  { room: 'lighthouse_in', building: 'lighthouse', x: 96, y: 104, tx: 5, ty: 6 },
  // the torches of the finished treehouse stand on 21 and 23, so its door is the tile between them
  { room: 'tree_in', building: 'treehouse', x: 22, y: 20, tx: 4, ty: 3, if: { flag: 'site_treehouse' } },
  { room: 'vh1_in', building: 'vhouse_1', x: 128, y: 61, tx: 3, ty: 4 },
  { room: 'vh3_in', building: 'vhouse_3', x: 128, y: 70, tx: 4, ty: 6 },
  { room: 'vh4_in', building: 'vhouse_4', x: 140, y: 70, tx: 3, ty: 4 },
  // a door that waits for its building has no hint: its tile is also the build site's hand-over point
  { room: 'beacon_in', building: 'built_beacon', x: 117, y: 9, tx: 3, ty: 3, if: { flag: 'site_beacon' } },
  { room: 'mill_in', building: 'built_mill', x: 153, y: 58, tx: 5, ty: 6, if: { flag: 'site_mill' } },
];

/** A room from rows; its door out is the one open tile in the bottom row, linked to its island door. */
function room(id: string, name: string, rows: string[], floor = 'f'): MapMaker {
  const m = MapMaker.fromRows(id, name, rows, objects, {}, floor, ' ');
  const d = ROOM_DOORS.find((r) => r.room === id)!;
  const y = m.h - 1;
  const x = rows[y]!.search(/[^v]/);
  if (x !== d.tx || d.ty !== y - 2) throw new Error(`rooms: ${id} door ${x},${y} does not match its landing`);
  m.door(x, y, 'island', d.x, d.y + 1, 'down');
  m.place(`${id}_exit`, x, y - 1, 'the door');
  return m;
}
const walls = (w: number) => 'v'.repeat(w);
const floorRow = (w: number, c = 'f') => `v${c.repeat(w - 2)}v`;
const doorRow = (w: number, x: number, c = 'f') => `${'v'.repeat(x)}${c}${'v'.repeat(w - x - 1)}`;
const box = (w: number, h: number, doorX: number, c = 'f') => [
  walls(w),
  ...Array.from({ length: h - 2 }, () => floorRow(w, c)),
  doorRow(w, doorX, c),
];

/** The Apple Cafe: a wide room, the cake counter under its awning, apple crates and four tables to sit at. */
export function buildCafeIn(): MapMaker {
  const m = room('cafe_in', 'The Apple Cafe', box(18, 8, 9));
  m.put('cafe_counter', 1, 1, { margin: 0, d: 'cafe_counter' });
  m.put('cafe_cakes', 4, 1, { margin: 0 });
  m.put('apple_crate', 5, 1, { margin: 0 });
  m.put('apple_crate', 6, 1, { margin: 0 });
  m.put('cafe_seat', 8, 2, { margin: 0 });
  m.put('cafe_seat', 12, 2, { margin: 0 });
  m.put('cafe_seat', 2, 4, { margin: 0 });
  m.put('cafe_seat', 14, 4, { margin: 0 });
  m.put('heeler_plant', 16, 1, { margin: 0 });
  m.put('cactus_pot', 1, 6, { margin: 0 });
  m.place('in_cafe', 11, 4, 'the Apple Cafe');
  m.put('find_cake', 16, 6, { id: 'find_cafe_in', d: 'cake:1', margin: 0 });
  return m;
}

/** Gabby's Dollhouse: a bright room cut into little rooms like a doll's house, a tiny stair and a craft table. */
export function buildDollIn(): MapMaker {
  const rows = [
    walls(14),
    'vffffvfffvfffv',
    'vffffvfffvfffv',
    ...Array.from({ length: 5 }, () => floorRow(14)),
    doorRow(14, 7),
  ];
  const m = room('doll_in', "Gabby's Dollhouse", rows);
  m.put('doll_bed', 1, 1, { margin: 0 });
  m.put('doll_teddy', 2, 1, { margin: 0 });
  m.put('doll_craft', 6, 1, { id: 'doll_craft', margin: 0 });
  m.put('doll_sofa', 10, 1, { margin: 0 });
  m.put('tiny_stair', 12, 1, { margin: 0 });
  m.put('doll_vase', 12, 3, { margin: 0 });
  m.put('heeler_balloon', 12, 7, { margin: 0 });
  m.put('doll_catbed', 1, 7, { margin: 0 });
  m.place('in_doll', 4, 5, "Gabby's Dollhouse");
  m.put('find_box', 3, 1, { id: 'find_doll_in', d: 'emerald:5', margin: 0 });
  return m;
}

/** The Post Office: a wall of pigeon holes, the parcel shelf, the post counter and a notice board to read. */
export function buildPostIn(): MapMaker {
  const m = room('post_in', 'The Post Office', box(13, 8, 6));
  m.put('pigeon_holes', 1, 1, { margin: 0 });
  m.put('pigeon_holes', 3, 1, { margin: 0 });
  m.put('shop_shelves', 6, 1, { margin: 0 });
  m.put('post_parcel', 8, 1, { margin: 0 });
  m.put('post_parcel', 9, 1, { margin: 0 });
  m.put('post_bag', 10, 1, { margin: 0 });
  m.put('post_counter', 4, 3, { margin: 0 });
  m.put('post_notices', 9, 4, { id: 'post_notices', margin: 0 });
  m.put('crate', 11, 6, { margin: 0 });
  m.put('barrel', 1, 6, { margin: 0 });
  m.place('in_post', 3, 5, 'the Post Office');
  m.put('find_parcel', 11, 1, { id: 'find_post_in', d: 'emerald:5', margin: 0 });
  return m;
}

/** The school: the blackboard, two rows of desks, coat pegs and boots by the door, a reading corner. */
export function buildSchoolIn(): MapMaker {
  const m = room('school_in', 'The school', box(16, 9, 7));
  m.put('coat_pegs', 1, 1, { margin: 0 });
  m.put('blackboard', 7, 1, { id: 'blackboard', margin: 0 });
  m.put('teacher_desk', 10, 1, { margin: 0 });
  m.put('block_bookshelf', 13, 1, { margin: 0 });
  for (const y of [3, 5]) for (const x of [2, 5, 9, 12]) m.put('school_desk', x, y, { margin: 0 });
  m.put('peppa_boots', 2, 7, { margin: 0 });
  m.put('bing_beanbag', 14, 7, { margin: 0 });
  m.place('in_school', 7, 4, 'the school');
  m.put('find_books', 1, 2, { id: 'find_school_in', d: 'emerald:5', margin: 0 });
  return m;
}

/** The greenhouse: a long glass room, plant benches down both sides, seed trays and a watering can. */
export function buildGreenIn(): MapMaker {
  const m = room('green_in', 'The greenhouse', box(18, 6, 8, 't'), 't');
  m.put('plant_bench', 1, 1, { margin: 0 });
  m.put('heeler_plant', 4, 1, { margin: 0 });
  m.put('seed_tray', 5, 1, { margin: 0 });
  m.put('seed_tray', 6, 1, { margin: 0 });
  m.put('seed_tray', 7, 1, { margin: 0 });
  m.put('green_pot', 9, 1, { margin: 0 });
  m.put('plant_bench', 10, 1, { margin: 0 });
  m.put('green_pot', 13, 1, { margin: 0 });
  m.put('plant_bench', 14, 1, { margin: 0 });
  m.put('plant_bench', 1, 4, { margin: 0 });
  m.put('watering_can', 5, 4, { margin: 0 });
  m.put('plant_bench', 11, 4, { margin: 0 });
  m.put('heeler_plant', 15, 4, { margin: 0 });
  m.put('cactus_pot', 16, 4, { margin: 0 });
  // package 73b: her three pots, last in the room (src/core/pots.ts)
  for (const n of [1, 2, 3]) m.put('her_pot', 13 + n, 2, { id: `her_pot_${n}`, d: String(n), margin: 0 });
  m.place('in_green', 12, 2, 'the greenhouse');
  // not at 16,2: her third pot stands there (the two packages each chose that tile; the reach test caught it)
  m.put('find_box', 1, 2, { id: 'find_green_in', d: 'emerald:5', margin: 0 });
  return m;
}

/** Nanny's nook: a snug room with a knitted armchair by the stove, a knitting basket, a rug and a cat bed. */
export function buildNookIn(): MapMaker {
  const m = room('nook_in', "Nanny's nook", box(10, 7, 4));
  m.put('nook_stove', 1, 1, { id: 'nook_stove', margin: 0 });
  m.put('bing_armchair', 2, 1, { margin: 0 });
  m.put('knit_basket', 3, 1, { margin: 0 });
  m.put('nook_books', 8, 1, { margin: 0 });
  m.put('nook_table', 6, 3, { margin: 0 });
  m.put('nook_cocoa', 7, 3, { margin: 0 });
  m.put('nook_catbed', 8, 5, { margin: 0 });
  m.place('in_nook', 3, 3, "Nanny's nook");
  m.put('find_cookies', 1, 5, { id: 'find_nook_in', d: 'cookie:3', margin: 0 });
  return m;
}

/** The koala treehouse: a small plank room, a rope ladder down through the hatch, a den and its cushions. */
export function buildTreeIn(): MapMaker {
  const m = room('tree_in', 'The koala treehouse', box(9, 6, 4));
  m.put('ladder_up', 4, 5, { margin: 0 });
  m.put('tree_den', 1, 1, { id: 'tree_den', margin: 0 });
  m.put('lantern', 3, 1, { margin: 0 });
  m.put('den_cushion', 6, 1, { margin: 0 });
  m.put('den_cushion', 7, 1, { margin: 0 });
  m.put('tree_koala', 7, 4, { margin: 0 });
  m.place('in_tree', 5, 2, 'the koala treehouse');
  m.put('find_box', 1, 4, { id: 'find_tree_in', d: 'emerald:5', margin: 0 });
  return m;
}

/** A lookout: one small room up a ladder, open on every side, and a telescope to look out with. */
function lookoutRoom(id: string, name: string, scope: string): MapMaker {
  const m = room(id, name, box(8, 6, 3));
  m.put('ladder_up', 3, 5, { margin: 0 });
  m.put('telescope', 5, 1, { id: scope, margin: 0 });
  return m;
}
/** Dad's lookout over the bay: a bench under the open side, his map on the wall. */
export function buildLookoutIn(): MapMaker {
  const m = lookoutRoom('lookout_in', "Dad's lookout", 'telescope_bay');
  m.put('garden_bench', 1, 1, { margin: 0 });
  m.put('barrel', 1, 4, { margin: 0 });
  m.place('in_lookout', 4, 2, "Dad's lookout");
  m.put('find_box', 6, 4, { id: 'find_lookout_in', d: 'emerald:5', margin: 0 });
  return m;
}
/** The lookout she built on the Mine's hill: a lantern, a crate and a barrel of things for the fire outside. */
export function buildBeaconIn(): MapMaker {
  const m = lookoutRoom('beacon_in', 'The hill lookout', 'telescope_hill');
  m.put('lantern', 1, 1, { margin: 0 });
  m.put('crate', 1, 4, { margin: 0 });
  m.put('barrel', 2, 1, { margin: 0 });
  m.place('in_beacon', 4, 2, 'the hill lookout');
  m.put('find_tools', 6, 4, { id: 'find_beacon_in', d: 'emerald:5', margin: 0 });
  return m;
}

// ---- the lighthouse: a round stone tower of three small floors, joined by stairs (steps in the wall)
const TOWER = [
  'vvvvvvvvvvv',
  'vvvttttevvv',
  'vvtttttttvv',
  'vtttttttttv',
  'vtttttttttv',
  'vtttttttttv',
  'vvtttttttvv',
  'vvvtttttvvv',
  'vvvvvtvvvvv',
];
/** The ground floor: the store room, crates and barrels, a shelf, a bucket and a lantern. Stairs up on the right. */
export function buildLighthouseIn(): MapMaker {
  const m = room('lighthouse_in', 'The lighthouse', TOWER, 't');
  m.door(7, 1, 'keeper_in', 3, 2, 'down');
  m.put('tower_stair', 7, 1, { margin: 0 });
  m.place('lighthouse_up', 7, 2, 'the stairs');
  m.put('shop_shelves', 3, 1, { margin: 0 });
  m.put('crate', 2, 2, { margin: 0 });
  m.put('crate', 1, 3, { margin: 0 });
  m.put('lantern', 8, 2, { margin: 0 });
  m.put('barrel', 9, 3, { margin: 0 });
  m.put('barrel', 9, 4, { margin: 0 });
  m.put('lh_bucket', 8, 6, { margin: 0 });
  m.place('in_lighthouse', 5, 4, 'the lighthouse');
  m.put('find_box', 1, 5, { id: 'find_lighthouse_in', d: 'emerald:5', margin: 0 });
  return m;
}
/** The middle floor: the keeper's room, a bed, a chair at the table, books, a pot and a lamp. */
export function buildKeeperIn(): MapMaker {
  const rows = [
    'vvvvvvvvvvv',
    'vvvetttevvv',
    'vvtttttttvv',
    'vtttttttttv',
    'vtttttttttv',
    'vtttttttttv',
    'vvtttttttvv',
    'vvvvvvvvvvv',
  ];
  const m = MapMaker.fromRows('keeper_in', "The keeper's room", rows, objects, {}, 't', ' ');
  m.door(3, 1, 'lighthouse_in', 7, 2, 'down');
  m.door(7, 1, 'lamp_in', 2, 2, 'down');
  m.put('tower_stair', 3, 1, { margin: 0 });
  m.put('tower_stair', 7, 1, { margin: 0 });
  m.place('keeper_down', 3, 2, 'the stairs');
  m.place('keeper_up', 7, 2, 'the stairs');
  m.put('keeper_bed', 1, 3, { margin: 0 });
  m.put('keeper_books', 8, 2, { margin: 0 });
  m.put('keeper_chair', 4, 4, { id: 'keeper_chair', margin: 0 });
  m.put('keeper_table', 5, 4, { margin: 0 });
  m.put('keeper_pot', 9, 3, { margin: 0 });
  m.put('keeper_lamp', 9, 4, { margin: 0 });
  m.place('in_keeper', 5, 3, "the keeper's room");
  m.put('find_books', 1, 5, { id: 'find_keeper_in', d: 'emerald:5', margin: 0 });
  return m;
}
/** The top: the lamp room, the big lamp in the middle and windows all round to look out of. */
export function buildLampIn(): MapMaker {
  const rows = ['vvvvvvvvv', 'vvettttvv', 'vtttttttv', 'vtttttttv', 'vtttttttv', 'vvtttttvv', 'vvvvvvvvv'];
  const m = MapMaker.fromRows('lamp_in', 'The lamp room', rows, objects, {}, 't', ' ');
  m.door(2, 1, 'keeper_in', 7, 2, 'down');
  m.put('tower_stair', 2, 1, { margin: 0 });
  m.place('lamp_down', 2, 2, 'the stairs');
  m.put('big_lamp', 4, 3, { id: 'big_lamp', margin: 0 });
  // windows in the wall face, read from the floor below them
  m.put('lamp_window', 4, 0, { id: 'lamp_window_sea', margin: 0 });
  m.put('lamp_window', 6, 0, { id: 'lamp_window_isle', margin: 0 });
  m.place('in_lamp', 3, 4, 'the lamp room');
  m.put('find_box', 7, 4, { id: 'find_lamp_in', d: 'emerald:5', margin: 0 });
  return m;
}

// ---- the three village houses: a baker's, a farmer's and a mason's, each its own shape
/** The baker's house: a big oven to warm by, a table of loaves and sacks of flour. */
export function buildVh1In(): MapMaker {
  const m = room('vh1_in', "The baker's house", box(13, 7, 3));
  m.put('bake_oven', 1, 1, { id: 'bake_oven', margin: 0 });
  m.put('bread_table', 5, 1, { margin: 0 });
  m.put('baker_bread', 8, 1, { margin: 0 });
  m.put('baker_bread', 9, 1, { margin: 0 });
  m.put('flour_sack', 11, 1, { margin: 0 });
  m.put('flour_sack', 11, 2, { margin: 0 });
  m.put('barrel', 11, 3, { margin: 0 });
  m.put('block_bed', 9, 5, { margin: 0 });
  m.put('block_flowerpot', 1, 5, { margin: 0 });
  m.place('in_vh1', 6, 3, "the baker's house");
  m.put('find_bread', 11, 4, { id: 'find_vh1_in', d: 'bread:2', margin: 0 });
  return m;
}
/** The farmer's house: hay bales to sit on, a rack of tools, milk, a bucket and sacks of seed. */
export function buildVh3In(): MapMaker {
  const m = room('vh3_in', "The farmer's house", box(12, 9, 4));
  m.put('hay_bale', 1, 1, { margin: 0 });
  m.put('hay_bale', 2, 1, { margin: 0 });
  m.put('hay_bale', 1, 2, { margin: 0 });
  m.put('tool_rack', 4, 1, { margin: 0 });
  m.put('milk_churn', 7, 1, { margin: 0 });
  m.put('farm_bucket', 8, 1, { margin: 0 });
  m.put('seed_sacks', 10, 1, { margin: 0 });
  m.put('barrel', 10, 4, { margin: 0 });
  m.put('block_bed', 9, 7, { margin: 0 });
  m.place('in_vh3', 6, 4, "the farmer's house");
  m.put('find_eggs', 10, 6, { id: 'find_vh3_in', d: 'egg:3', margin: 0 });
  return m;
}
/** The mason's house: stone floor and walls, a stone bench by the fire, blocks, pillars and an anvil. */
export function buildVh4In(): MapMaker {
  const m = room('vh4_in', "The mason's house", box(14, 7, 3, 't'), 't');
  m.put('pillar', 1, 1, { margin: 0 });
  m.put('stone_bench', 5, 1, { margin: 0 });
  m.put('mason_fire', 8, 1, { id: 'mason_fire', margin: 0 });
  m.put('mason_block', 10, 1, { margin: 0 });
  m.put('mason_block', 11, 1, { margin: 0 });
  m.put('pillar', 12, 1, { margin: 0 });
  m.put('mason_anvil', 1, 4, { margin: 0 });
  m.put('block_bed', 10, 5, { margin: 0 });
  m.place('in_vh4', 7, 3, "the mason's house");
  m.put('find_tools', 12, 4, { id: 'find_vh4_in', d: 'emerald:5', margin: 0 });
  return m;
}

/** The windmill: a round room round the mill stones, sacks of wheat, crates, a barrel and a hay bale. */
export function buildMillIn(): MapMaker {
  const rows = TOWER.map((r) => r.replace(/t/g, 'f').replace('e', 'f'));
  const m = room('mill_in', 'The windmill', rows);
  m.put('mill_stones', 4, 3, { id: 'mill_stones', margin: 0 });
  m.put('mill_sack', 3, 1, { margin: 0 });
  m.put('mill_sack', 7, 1, { margin: 0 });
  m.put('crate', 2, 2, { margin: 0 });
  m.put('barrel', 8, 2, { margin: 0 });
  m.put('hay_bale', 1, 4, { margin: 0 });
  m.place('in_mill', 7, 5, 'the windmill');
  m.put('find_box', 8, 6, { id: 'find_mill_in', d: 'emerald:5', margin: 0 });
  return m;
}

// Package 73a (I13): each room's find is the last thing put in it (`find_<room>`, a `find_` type in src/data/objects.ts),
// so every object that was there before keeps its id and order.
/** D86: each room's tune, by kind (src/game/music.ts). */
export const ROOM_MUSIC: Record<string, string> = {
  cafe_in: 'cafe',
  doll_in: 'dollhouse',
  post_in: 'post',
  nook_in: 'nook',
  school_in: 'school',
  green_in: 'greenhouse',
  lookout_in: 'lookout',
  lighthouse_in: 'lighthouse',
  keeper_in: 'lighthouse_mid',
  lamp_in: 'lighthouse_top',
  tree_in: 'lookout',
  vh1_in: 'village',
  vh3_in: 'village',
  vh4_in: 'village',
  beacon_in: 'lookout',
  mill_in: 'windmill',
};

export const buildRooms = (): MapMaker[] => [
  buildCafeIn(),
  buildDollIn(),
  buildPostIn(),
  buildNookIn(),
  buildSchoolIn(),
  buildGreenIn(),
  buildLookoutIn(),
  buildLighthouseIn(),
  buildKeeperIn(),
  buildLampIn(),
  buildTreeIn(),
  buildVh1In(),
  buildVh3In(),
  buildVh4In(),
  buildBeaconIn(),
  buildMillIn(),
];
