// The small separate rooms: the cottage, the three levels of the Mine, the King's Hall and the cave behind the waterfall.
import { objects } from '../../src/data/objects.ts';
import { MapMaker } from './lib.ts';

export function buildCottage(): MapMaker {
  const rows = [
    'vvvvvvvvvvvvvvvv',
    'vffffffMfffffffv',
    'vffffffffffffffv',
    'vffffffffffffffv',
    'vffffffffffffffv',
    'vffffffffffffffv',
    'vffffffffffffffv',
    'vffffffffffffffv',
    'vffffffffffffffv',
    'vvvvvvfvvvvvvvvv',
  ];
  const m = MapMaker.fromRows(
    'cottage',
    'Your cottage',
    rows,
    objects,
    { M: (mm, x, y) => mm.put('mirror', x, y, { id: 'mirror' }) },
    'f',
    'I',
  );
  m.door(6, 9, 'island', 74, 77, 'down');
  m.place('cottage_exit', 6, 8, 'the door');
  m.place('start', 4, 5, 'your cottage');
  m.place('bed', 2, 3, 'your bed', 2.5);
  m.place('bed_side', 3, 4);
  m.place('mum_inside', 6, 3);
  m.place('dad_inside', 8, 5);
  m.place('mirror', 7, 2, 'the mirror');
  // Home from day 1: a little table with two chairs and a plant (looks only). Windows, a picture, a rug and the door mat are painted by tools/map/bake.ts.
  m.put('cafe_table', 1, 6, { id: 'home_table', margin: 0 });
  m.put('cactus_pot', 8, 1, { id: 'home_plant', margin: 0 });
  // The room starts small. Bandit and Daddy Pig knock the walls back twice.
  m.barriers.push({
    id: 'house_wall_1',
    rect: { x: 9, y: 1, w: 3, h: 8 },
    flag: 'house1',
    hint: 'house_small',
    art: 'wall',
  });
  // the last piece reaches over the far wall (x 15) too, so its dark cover hides that wall until the room is whole
  m.barriers.push({
    id: 'house_wall_2',
    rect: { x: 12, y: 1, w: 4, h: 8 },
    flag: 'house2',
    hint: 'house_small',
    art: 'wall',
  });
  return m;
}

function cave(
  id: string,
  name: string,
  w: number,
  h: number,
  rooms: [number, number, number, number][],
  links: [number, number][],
  seed: number,
): MapMaker {
  const m = new MapMaker(id, name, w, h, objects, 'r', 'M');
  rooms.forEach(([x, y, rx, ry], i) => m.blob(x, y, rx, ry, 't', seed + i, 0.18));
  for (const [a, b] of links) {
    const [ax, ay] = rooms[a]!;
    const [bx, by] = rooms[b]!;
    // An L-shaped tunnel, two tiles wide.
    m.path(
      [
        [Math.round(ax), Math.round(ay)],
        [Math.round(bx), Math.round(ay)],
        [Math.round(bx), Math.round(by)],
      ],
      2,
      't',
      'r',
    );
  }
  for (let x = 0; x < w; x++) {
    m.set(x, 0, 'r');
    m.set(x, h - 1, 'r');
  }
  for (let y = 0; y < h; y++) {
    m.set(0, y, 'r');
    m.set(w - 1, y, 'r');
  }
  m.keep.fill(0);
  return m;
}
const ring = (m: MapMaker, type: string, cx: number, cy: number, r: number, n: number, seed: number) => {
  let put = 0;
  for (let i = 0; i < n * 6 && put < n; i++) {
    const a = (i * 2.399 + seed) % (Math.PI * 2);
    const x = Math.round(cx + Math.cos(a) * r * (0.6 + ((i * 7) % 5) / 10));
    const y = Math.round(cy + Math.sin(a) * r * (0.6 + ((i * 3) % 5) / 10));
    if (m.keep[y * m.w + x] || !m.free(type, x, y)) continue;
    m.put(type, x, y, { margin: 1 });
    put++;
  }
};

export function buildMine1(): MapMaker {
  const m = cave(
    'mine1',
    'The Mine',
    44,
    30,
    [
      [5, 4, 3.5, 2.5],
      [17, 6, 4, 3],
      [31, 6, 4.5, 3.2],
      [10, 17, 4.5, 3.5],
      [25, 16, 4.5, 3.5],
      [37, 22, 4, 3.2],
      [9, 25, 3.5, 2.6],
    ],
    [
      [0, 1],
      [1, 2],
      [1, 3],
      [3, 4],
      [4, 5],
      [3, 6],
      [2, 4],
    ],
    300,
  );
  m.rect(4, 1, 2, 3, 't');
  m.door(4, 1, 'island', 134, 11, 'down');
  m.door(5, 1, 'island', 135, 11, 'down');
  m.keepRect(2, 1, 6, 6);
  m.place('mine_entry', 5, 4, 'the Mine');
  m.place('mine_iron', 31, 6, 'the iron seam', 4);
  m.place('mine_cart', 25, 16, 'the cart track', 3);
  m.put('minecart', 24, 15, { id: 'cart_l1', d: 'l1' });
  m.rect(37, 21, 2, 2, 'e');
  m.door(37, 22, 'mine2', 5, 5, 'down');
  m.door(38, 22, 'mine2', 6, 5, 'down');
  m.keepRect(35, 19, 6, 6);
  m.place('mine_down_1', 37, 23, 'the way down');
  ring(m, 'iron_rock', 31, 6, 3.5, 6, 1);
  ring(m, 'iron_rock', 10, 17, 3.5, 4, 2);
  ring(m, 'coal_rock', 9, 25, 2.5, 4, 3);
  ring(m, 'coal_rock', 17, 6, 3, 3, 4);
  ring(m, 'rock', 25, 16, 3.5, 4, 5);
  ring(m, 'web', 9, 25, 2.8, 3, 6);
  ring(m, 'stalagmite', 17, 6, 3.4, 3, 7);
  ring(m, 'crystal', 25, 16, 4, 2, 8);
  ring(m, 'crystal', 5, 4, 3, 1, 9);
  // the tenth long dog hides at the back of the coal ring (the other nine are on the island)
  m.put('long_dog', 7, 27, { id: 'long_dog_mine', d: 'sticker.longdog_10:1', margin: 0 });
  m.zones.push({
    id: 'mine1',
    region: 'M',
    rect: { x: 8, y: 2, w: 34, h: 26 },
    mobs: ['zombie', 'spider', 'zombie'],
    mode: 'always',
    max: 2,
  });
  return m;
}

export function buildMine2(): MapMaker {
  const m = cave(
    'mine2',
    'The Mine, deeper',
    44,
    30,
    [
      [6, 6, 4, 3],
      [20, 5, 4, 3],
      [35, 7, 4.5, 3.5],
      [9, 19, 4.5, 3.5],
      [24, 20, 5, 3.5],
      [38, 23, 3.5, 3],
    ],
    [
      [0, 1],
      [1, 2],
      [0, 3],
      [3, 4],
      [4, 5],
      [2, 5],
    ],
    400,
  );
  m.rect(5, 3, 2, 2, 'e');
  m.door(5, 3, 'mine1', 37, 23, 'down');
  m.door(6, 3, 'mine1', 38, 23, 'down');
  m.keepRect(3, 2, 6, 6);
  m.place('mine2_entry', 6, 6, 'the deep Mine');
  m.put('minecart', 23, 19, { id: 'cart_l2', d: 'ride' });
  m.place('mine_ride', 24, 21, 'the minecart', 2.5);
  for (let x = 14; x <= 32; x++) if (m.walk(x, 20) && x !== 23 && x !== 24) m.put('rail', x, 20, { margin: 0 });
  m.rect(38, 22, 2, 2, 'e');
  m.door(38, 23, 'mine3', 5, 5, 'down', { if: { flag: 'cart_done' }, hint: 'ride_first' });
  m.door(39, 23, 'mine3', 6, 5, 'down', { if: { flag: 'cart_done' }, hint: 'ride_first' });
  m.keepRect(36, 20, 6, 6);
  m.place('mine_down_2', 38, 24, 'the way down');
  ring(m, 'iron_rock', 35, 7, 3.5, 6, 11);
  ring(m, 'iron_rock', 9, 19, 3.5, 5, 12);
  ring(m, 'coal_rock', 20, 5, 3, 5, 13);
  ring(m, 'rock', 24, 20, 4, 3, 14);
  ring(m, 'web', 35, 7, 3.6, 3, 15);
  ring(m, 'crystal', 24, 20, 4.4, 3, 16);
  ring(m, 'crystal', 6, 6, 3.2, 1, 17);
  ring(m, 'stalagmite', 9, 19, 3.6, 3, 18);
  m.put('chest', 20, 3, { id: 'chest_mine2', d: 'emerald:10,potato_hat:1', margin: 0 });
  m.place('fossil_spot', 35, 9, 'the fossil rock', 2);
  // Chapter 6: the hole in the track under the old cart is a build site (6 cobblestone, from the rocks beside it).
  m.sites.push({
    id: 'cart_track',
    name: 'the hole in the cart track',
    rect: { x: 23, y: 20, w: 2, h: 1 },
    needs: { cobblestone: 6 },
    flag: 'site_cart_track',
    if: { active: 'ch6' },
    at: { x: 24, y: 21 },
  });
  for (const x of [23, 24]) m.put('rail', x, 20, { if: { flag: 'site_cart_track' }, margin: 0 });
  m.place('cart_webs', 33, 21, 'the webs in the tunnel', 2.5);
  m.zones.push({
    id: 'mine2',
    region: 'M',
    rect: { x: 10, y: 2, w: 32, h: 26 },
    mobs: ['skeleton', 'spider', 'zombie'],
    mode: 'always',
    max: 2,
  });
  return m;
}

export function buildMine3(): MapMaker {
  const m = cave(
    'mine3',
    'The deepest cave',
    44,
    30,
    [
      [6, 6, 4, 3],
      [22, 13, 9, 6.5],
      [38, 8, 3.5, 3],
      [37, 23, 4, 3.2],
      [8, 22, 4.5, 3.5],
    ],
    [
      [0, 1],
      [1, 2],
      [1, 3],
      [1, 4],
    ],
    500,
  );
  m.rect(5, 3, 2, 2, 'e');
  m.door(5, 3, 'mine2', 38, 24, 'down');
  m.door(6, 3, 'mine2', 39, 24, 'down');
  m.keepRect(3, 2, 6, 6);
  m.place('mine3_entry', 6, 6, 'the deepest cave');
  m.place('jockey_cave', 22, 15, 'the big cavern', 7);
  m.place('jockey_spawn', 26, 11);
  for (const [x, y] of [
    [17, 10],
    [27, 10],
    [17, 16],
    [27, 16],
    [22, 13],
  ] as const)
    m.put('pillar', x, y, { margin: 0 });
  m.place('shard_cave', 37, 23, 'the glowing cave', 2.5);
  m.place('diamond_nook', 38, 9, 'the diamond nook', 3);
  m.put('pickup', 38, 24, {
    id: 'shard6',
    d: 'flag.shard6_found:1',
    if: { flag: 'jockey_beaten', noFlag: 'shard6' },
    margin: 0,
  });
  ring(m, 'gold_rock', 37, 23, 3, 4, 21);
  ring(m, 'diamond_rock', 38, 8, 2.6, 2, 22);
  ring(m, 'gold_rock', 38, 8, 2.8, 2, 23);
  ring(m, 'iron_rock', 8, 22, 3.5, 5, 24);
  ring(m, 'diamond_rock', 8, 22, 3.6, 2, 25);
  ring(m, 'crystal', 22, 13, 8, 5, 26);
  ring(m, 'crystal', 37, 23, 3.4, 2, 27);
  m.put('bottle', 9, 24, { id: 'bottle_mine', d: 'bottle7b', margin: 0 });
  m.zones.push({
    id: 'mine3',
    region: 'M',
    rect: { x: 2, y: 16, w: 16, h: 12 },
    mobs: ['skeleton', 'spider', 'creeper'],
    mode: 'always',
    max: 2,
  });
  return m;
}

export function buildHall(): MapMaker {
  const rows = [
    'rrrrrrrrrrrrrrrrrrrrrrrrrrrr',
    'rrrrtttttttttttttttttttrrrrr',
    'rrttttttttttttttttttttttttrr',
    'rttttttttttttTttttttttttttrr',
    'rtttttttttttttttttttttttttrr',
    'rttttPttttttttttttttPtttttrr',
    'rtttttttttttttttttttttttttrr',
    'rtttttttttttttttttttttttttrr',
    'rttttttttPttttttPtttttttttrr',
    'rtttttttttttttttttttttttttrr',
    'rtttttttttttttttttttttttttrr',
    'rttttPttttttttttttttPtttttrr',
    'rtttttttttttttttttttttttttrr',
    'rtttttttttttttttttttttttttrr',
    'rttttttttPttttttPtttttttttrr',
    'rtttttttttttttttttttttttttrr',
    'rrttttttttttttttttttttttttrr',
    'rrrrtttttttttttttttttttrrrrr',
    'rrrrrrrrrrrrttttrrrrrrrrrrrr',
    'rrrrrrrrrrrrrttrrrrrrrrrrrrr',
  ];
  const m = MapMaker.fromRows(
    'hall',
    "The King's Hall",
    rows,
    objects,
    {
      P: (mm, x, y) => mm.put('pillar', x, y, { margin: 0 }),
      T: (mm, x, y) => mm.put('throne', x - 1, y - 2, { id: 'throne', force: true }),
    },
    't',
    'K',
  );
  m.door(13, 19, 'island', 132, 99, 'down');
  m.door(14, 19, 'island', 133, 99, 'down');
  m.place('hall_entry', 13, 17, "the King's Hall");
  m.place('king', 13, 5, 'the Creeper King', 4);
  m.place('hall_mid', 13, 10, "the King's Hall", 6);
  m.place('king_seat', 13, 5);
  m.place('hall_mum', 10, 9);
  m.place('hall_chilli', 16, 9);
  // Chapter 7: where the King dropped his star bits.
  m.place('star_bit_1', 7, 12);
  m.place('star_bit_2', 19, 12);
  m.place('star_bit_3', 13, 15);
  m.place('hall_art_1', 4, 12, 'the west wall', 2);
  m.place('hall_art_2', 22, 12, 'the east wall', 2);
  return m;
}

export function buildCave(): MapMaker {
  const rows = [
    'rrrrrrrrrrr',
    'rrtttttttrr',
    'rttttCtttBr',
    'rtttttttttr',
    'rttuuuttttr',
    'rttuuutttrr',
    'rrttttttrrr',
    'rrrrrtrrrrr',
  ];
  const m = MapMaker.fromRows(
    'cave',
    'Behind the waterfall',
    rows,
    objects,
    {
      C: (mm, x, y) =>
        mm.put('chest', x, y, {
          id: 'chest_cave_in',
          d: 'emerald:20,treasure_shell:1,sticker.tr_shell:1,disc_water:1',
        }),
      B: (mm, x, y) => mm.put('bottle', x, y, { id: 'bottle_cave', d: 'bottle10' }),
    },
    't',
    'M',
  );
  m.door(5, 7, 'island', 107, 9, 'down');
  m.place('cave_entry', 5, 6, 'the secret cave');
  m.put('crystal', 2, 2, { margin: 0 });
  m.put('crystal', 8, 5, { margin: 0 });
  return m;
}

// ---------------------------------------------------------------- five houses she can walk into (phase 2, part F)
// Each is one calm room of 12 by 8 tiles (floor 10 by 6) with a door in the bottom wall. Walking onto the door tile
// in front of the house takes her in; the door under the mat takes her back out, one tile below the outside door.
// A chest with a small present, a station where it fits, and one clear standing place (in_<house>) for whoever lives
// there. She builds only in her own cottage (src/core/build.ts). The wall style is picked by room id in bake.ts.

/** A house room: walls round a 10 x 6 floor, the door at (doorX, 7), linked to the island door tile (outX, outY). */
function houseRoom(id: string, name: string, doorX: number, outX: number, outY: number): MapMaker {
  const rows = ['v'.repeat(12)];
  for (let y = 1; y <= 6; y++) rows.push(`v${'f'.repeat(10)}v`);
  rows.push(`${'v'.repeat(doorX)}f${'v'.repeat(11 - doorX)}`);
  // no region: the cottage's name (region I) must not show here, and walking out shows no name either
  const m = MapMaker.fromRows(id, name, rows, objects, {}, 'f', ' ');
  m.door(doorX, 7, 'island', outX, outY + 1, 'down');
  m.place(`${id}_exit`, doorX, 6, 'the door');
  return m;
}

/** The island side of each room: the door tile in front of the house picture's door, and where she lands inside. */
export const HOUSE_DOORS: { room: string; x: number; y: number; tx: number; ty: number }[] = [
  { room: 'workshop_in', x: 61, y: 52, tx: 3, ty: 5 },
  { room: 'heeler_in', x: 12, y: 98, tx: 6, ty: 5 },
  { room: 'peppa_in', x: 75, y: 25, tx: 5, ty: 5 },
  { room: 'bing_in', x: 12, y: 56, tx: 6, ty: 5 },
  { room: 'village_in', x: 139, y: 61, tx: 4, ty: 5 },
];
const outside = (room: string) => HOUSE_DOORS.find((d) => d.room === room)!;
const roomOf = (id: string, name: string) => {
  const d = outside(id);
  return houseRoom(id, name, d.tx, d.x, d.y);
};

// Package 57b (D62): each room is furnished so a child knows at once whose home it is; the furniture is in
// src/data/objects.ts. Furniture keeps to the walls and corners, so the door, the chest, the standing place and a
// walk round the room stay clear.

/** Grandad's workshop: stone walls, tools on the wall, his workbench, a forge, a tool board and a saw horse. */
export function buildWorkshopIn(): MapMaker {
  const m = roomOf('workshop_in', "Grandad's workshop");
  m.put('workbench', 1, 1, { id: 'grandad_bench_in', margin: 0 });
  m.put('big_furnace', 9, 1, { id: 'workshop_forge', margin: 0 });
  m.put('barrel', 6, 1, { margin: 0 });
  m.put('crate', 1, 6, { margin: 0 });
  m.put('shop_toolboard', 4, 1, { margin: 0 });
  m.put('shop_shelves', 7, 1, { margin: 0 });
  m.put('shop_stool', 2, 2, { margin: 0 });
  m.put('shop_toolbox', 1, 3, { margin: 0 });
  m.put('shop_sawhorse', 7, 5, { margin: 0 });
  m.put('shop_planks', 10, 6, { margin: 0 });
  m.put('chest', 10, 4, { id: 'chest_workshop', d: 'emerald:5,toy_boat:1', margin: 0 });
  m.place('in_workshop', 6, 3, "Grandad's workshop");
  return m;
}

/** The Heeler house: a long couch with cushions, the kitchen corner, a toy box, a play mat and a balloon to keep up. */
export function buildHeelerIn(): MapMaker {
  const m = roomOf('heeler_in', 'The Heeler house');
  m.put('heeler_couch', 1, 1, { id: 'heeler_couch', margin: 0 });
  m.put('heeler_toybox', 4, 1, { margin: 0 });
  m.put('heeler_kitchen', 8, 1, { margin: 0 });
  m.put('heeler_playmat', 7, 3, { margin: 0 });
  m.put('heeler_balloon', 9, 3, { margin: 0 });
  m.put('alphabet_blocks', 1, 3, { id: 'heeler_blocks', margin: 0 });
  m.put('heeler_plant', 1, 6, { margin: 0 });
  m.put('chest', 10, 5, { id: 'chest_heeler_in', d: 'emerald:4,toy_drum:1', margin: 0 });
  m.place('in_heeler', 5, 3, 'the Heeler house');
  return m;
}

/** Peppa's house: the kitchen table, a dresser of plates, a red sofa, muddy boots by the door, the toy train. */
export function buildPeppaIn(): MapMaker {
  const m = roomOf('peppa_in', "Peppa's house");
  m.put('peppa_dresser', 1, 1, { margin: 0 });
  m.put('peppa_table', 1, 3, { id: 'peppa_table', margin: 0 });
  m.put('peppa_sofa', 6, 1, { margin: 0 });
  m.put('peppa_lamp', 8, 1, { margin: 0 });
  m.put('peppa_books', 10, 3, { margin: 0 });
  m.put('peppa_boots', 4, 6, { margin: 0 });
  m.put('toy_train', 8, 5, { id: 'peppa_train', margin: 0 });
  m.put('chest', 10, 1, { id: 'chest_peppa', d: 'emerald:3,cake:1', margin: 0 });
  m.place('in_peppa', 7, 3, "Peppa's house");
  return m;
}

/** Bing's house: a blanket fort, a craft table, a knitted armchair, a bean bag, a toy shelf and a rainbow rug. */
export function buildBingIn(): MapMaker {
  const m = roomOf('bing_in', "Bing's house");
  m.put('blanket_fort', 1, 1, { id: 'bing_fort', margin: 0 });
  m.put('bing_craft', 8, 1, { id: 'bing_table', margin: 0 });
  m.put('bing_armchair', 4, 1, { margin: 0 });
  m.put('bing_shelf', 6, 1, { margin: 0 });
  m.put('bing_sunflower', 10, 1, { margin: 0 });
  m.put('bing_beanbag', 10, 4, { margin: 0 });
  m.put('bing_snack', 3, 4, { margin: 0 });
  m.put('chest', 1, 5, { id: 'chest_bing', d: 'emerald:3,carrot_cake:1', margin: 0 });
  m.place('in_bing', 5, 3, "Bing's house");
  return m;
}

/** A house in the blocky village: block walls, a furnace, hay and a barrel. */
export function buildVillageIn(): MapMaker {
  const m = roomOf('village_in', 'A village house');
  m.put('big_furnace', 1, 1, { id: 'village_furnace', margin: 0 });
  m.put('hay_bale', 10, 1, { margin: 0 });
  m.put('barrel', 9, 1, { margin: 0 });
  m.put('block_bookshelf', 3, 1, { margin: 0 });
  m.put('block_craft', 6, 1, { id: 'village_craft', margin: 0 });
  m.put('block_flowerpot', 7, 1, { margin: 0 });
  m.put('block_bed', 1, 5, { margin: 0 });
  m.put('chest', 10, 5, { id: 'chest_village_in', d: 'emerald:8,bread:2', margin: 0 });
  m.place('in_village', 6, 3, 'a village house');
  return m;
}

/** D86: each room's tune (src/game/music.ts); the rest of the rooms are in ROOM_MUSIC in rooms.ts. */
export const INTERIOR_MUSIC: Record<string, string> = {
  cottage: 'cottage',
  mine1: 'cave',
  mine2: 'cave',
  mine3: 'cave',
  hall: 'hall',
  cave: 'grotto',
  workshop_in: 'workshop',
  heeler_in: 'heeler_in',
  peppa_in: 'peppa_in',
  bing_in: 'bing_in',
  village_in: 'village',
};

export const buildHouses = (): MapMaker[] => [
  buildWorkshopIn(),
  buildHeelerIn(),
  buildPeppaIn(),
  buildBingIn(),
  buildVillageIn(),
];
