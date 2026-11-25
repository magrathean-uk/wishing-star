// The island, laid out by script from the sketch in docs/GAME_DESIGN.md section 6.
// 160 x 120 tiles. Every gate is explicit so the map gate check can prove it.
import { hash2 } from '../../src/core/cond.ts';
import { objects } from '../../src/data/objects.ts';
import { HOUSE_DOORS } from './interiors.ts';
import { ROOM_DOORS } from './rooms.ts';
import type { MapObj, Rect } from '../../src/core/types.ts';
import { MapMaker, noise } from './lib.ts';

export const W = 160;
export const H = 120;

export function buildIsland(): MapMaker {
  const m = new MapMaker('island', 'The Island', W, H, objects, 'W', ' ');

  // ------------------------------------------------------------ regions and land
  const REG: [string, number, number, number, number][] = [
    ['G', 0, 0, 50, 43],
    ['V', 51, 0, 101, 14],
    ['P', 51, 15, 101, 43],
    ['F', 102, 0, 159, 46],
    ['B', 0, 44, 53, 86],
    ['W', 54, 44, 103, 69],
    ['H', 54, 70, 103, 95],
    ['S', 54, 96, 103, 119],
    ['L', 104, 47, 159, 88],
    ['U', 0, 87, 53, 119],
    ['C', 104, 89, 159, 119],
  ];
  const BASE: Record<string, string> = {
    G: 'g',
    V: 'm',
    P: 'g',
    F: 'd',
    B: 'g',
    W: 'g',
    H: 'g',
    S: 's',
    L: 'G',
    U: 'g',
    C: 'a',
  };
  for (const [code, x0, y0, x1, y1] of REG) m.regionRect(x0, y0, x1, y1, code);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const edge = Math.min(x, y, W - 1 - x, H - 1 - y);
      const n = noise(x / 6, y / 6, 11) * 2.4;
      let land = edge > 2.2 + n;
      const r = m.region(x, y);
      if (r === 'S' && y > 107.5 + noise(x / 5, 3, 5) * 2) land = false;
      if (land) m.set(x, y, BASE[r] ?? 'g');
    }

  // ------------------------------------------------------------ water
  const river = (pts: [number, number][], width: number, seed: number, wob = 1.3) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i]!;
      const [x1, y1] = pts[i + 1]!;
      const len = Math.hypot(x1 - x0, y1 - y0);
      for (let s = 0; s <= len * 2; s++) {
        const t = s / (len * 2);
        const horiz = Math.abs(x1 - x0) > Math.abs(y1 - y0);
        const off = (noise((horiz ? x0 + (x1 - x0) * t : y0 + (y1 - y0) * t) / 7, seed, seed) - 0.5) * 2 * wob;
        const cx = x0 + (x1 - x0) * t + (horiz ? 0 : off);
        const cy = y0 + (y1 - y0) * t + (horiz ? off : 0);
        for (let dy = -width; dy <= width; dy++)
          for (let dx = -width; dx <= width; dx++) {
            if (Math.hypot(dx, dy) > width / 2 + 0.2) continue;
            const x = Math.round(cx + dx);
            const y = Math.round(cy + dy);
            if (m.in(x, y) && m.get(x, y) !== 'W') m.set(x, y, 'w');
          }
      }
    }
  };
  river(
    [
      [104, 0],
      [104, 44],
    ],
    4,
    21,
  );
  river(
    [
      [0, 44],
      [104, 44],
    ],
    4,
    22,
  );
  river(
    [
      [54, 44],
      [54, 119],
    ],
    4,
    23,
  );
  river(
    [
      [103, 44],
      [103, 119],
    ],
    3.4,
    24,
    0.8,
  );
  river(
    [
      [0, 87],
      [54, 87],
    ],
    3.4,
    25,
    0.9,
  );
  // The creek inside Heeler Heights, from the gorge down to the sea.
  river(
    [
      [40, 88],
      [36, 96],
      [31, 104],
      [29, 110],
      [26, 119],
    ],
    2.4,
    26,
    0.6,
  );
  m.blob(31, 108, 3.2, 2.6, 'w', 27, 0.15);

  // Region codes follow the water as carved: every bank tile belongs to the side of the river it is on.
  const isWater = (x: number, y: number) => 'wW'.includes(m.get(x, y));
  const sideV = (X: number, y0: number, y1: number) => {
    for (let y = y0; y <= y1; y++) {
      let lo = 999;
      let hi = -1;
      for (let x = X - 6; x <= X + 6; x++)
        if (isWater(x, y)) {
          lo = Math.min(lo, x);
          hi = Math.max(hi, x);
        }
      if (hi < 0) continue;
      const west = m.region(X - 7, y);
      const east = m.region(X + 7, y);
      for (let x = X - 6; x < lo; x++) if (m.in(x, y)) m.reg[y]![x] = west;
      for (let x = hi + 1; x <= X + 6; x++) if (m.in(x, y)) m.reg[y]![x] = east;
    }
  };
  const sideH = (Y: number, x0: number, x1: number) => {
    for (let x = x0; x <= x1; x++) {
      let lo = 999;
      let hi = -1;
      for (let y = Y - 6; y <= Y + 6; y++)
        if (isWater(x, y)) {
          lo = Math.min(lo, y);
          hi = Math.max(hi, y);
        }
      if (hi < 0) continue;
      const north = m.region(x, Y - 7);
      const south = m.region(x, Y + 7);
      for (let y = Y - 6; y < lo; y++) if (m.in(x, y)) m.reg[y]![x] = north;
      for (let y = hi + 1; y <= Y + 6; y++) if (m.in(x, y)) m.reg[y]![x] = south;
    }
  };
  sideV(104, 0, 37);
  sideH(44, 0, 96);
  sideV(54, 51, 119);
  sideV(103, 51, 119);
  sideH(87, 0, 46);

  /** Turn the water inside a rectangle into a crossing and return the tiles it covers. */
  const crossing = (x: number, y: number, w: number, h: number, c: string) => {
    let x0 = 999;
    let y0 = 999;
    let x1 = -1;
    let y1 = -1;
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        const t = m.get(x + i, y + j);
        if (t === 'w' || t === 'W') {
          m.set(x + i, y + j, c);
          x0 = Math.min(x0, x + i);
          y0 = Math.min(y0, y + j);
          x1 = Math.max(x1, x + i);
          y1 = Math.max(y1, y + j);
        }
      }
    m.keepRect(x - 1, y - 1, w + 2, h + 2);
    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  };
  const westBridge = crossing(49, 60, 11, 2, 'b');
  const northBridge = crossing(78, 39, 2, 11, 'b');
  const eastBridge = crossing(98, 60, 11, 2, 'b');
  crossing(49, 100, 11, 1, 'e'); // stepping stones to Heeler Heights
  crossing(99, 104, 9, 1, 'e'); // stepping stones to the foot of the crater wall
  crossing(27, 101, 9, 1, 'e'); // across the creek in the backyard
  crossing(31, 107, 5, 2, 'e'); // the rock in the middle of the creek pool
  for (let x = 32; x <= 38; x++) if (m.get(x, 108) === 'w' && x % 2 === 0) m.set(x, 108, 'e');

  // ------------------------------------------------------------ cliffs and hedges between regions that touch
  for (let y = 0; y <= 47; y++)
    for (const x of [49, 50]) if (m.walk(x, y) && 'GP'.includes(m.region(x, y))) m.set(x, y, 'c');
  for (let y = 24; y <= 26; y++) for (const x of [49, 50]) m.set(x, y, 'g');
  for (let x = 105; x < W; x++) for (const y of [87, 88, 89]) if (m.walk(x, y)) m.set(x, y, 'c');
  for (let y = 90; y < H; y++) for (const x of [107, 108]) if (m.walk(x, y)) m.set(x, y, 'c');
  for (let y = 103; y <= 105; y++) for (const x of [107, 108]) m.set(x, y, 'a');
  for (let y = 90; y < H; y++)
    for (const x of [102, 103, 104, 105, 106]) {
      if (x >= 105 && m.walk(x, y)) m.set(x, y, 'a');
      m.reg[y]![x] = 'S';
    }
  // The cliff the Mine is cut into, and the waterfall rocks.
  for (let x = 122; x <= 148; x++) for (let y = 5; y <= 9; y++) if (m.walk(x, y)) m.set(x, y, 'c');
  for (let x = 98; x <= 111; x++)
    for (let y = 3; y <= 7; y++) if (m.get(x, y) !== 'W' && m.get(x, y) !== 'w') m.set(x, y, 'c');

  // ------------------------------------------------------------ beaches
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const t = m.get(x, y);
      if (t !== 'g') continue;
      let near = false;
      for (let dy = -2; dy <= 2 && !near; dy++)
        for (let dx = -2; dx <= 2; dx++) if (m.get(x + dx, y + dy) === 'W') near = true;
      if (near) m.set(x, y, 's');
    }

  // ------------------------------------------------------------ gates
  m.barriers.push({
    id: 'north_bridge',
    rect: northBridge,
    flag: 'site_north_bridge',
    hint: 'gate_north',
    art: 'broken_bridge',
  });
  m.sites.push({
    id: 'north_bridge',
    name: 'the north bridge',
    rect: northBridge,
    needs: { plank: 12, stick: 4 },
    flag: 'site_north_bridge',
    if: { flag: 'plan_north' },
    at: { x: 78, y: northBridge.y + northBridge.h },
  });
  m.barriers.push({
    id: 'east_bridge',
    rect: eastBridge,
    flag: 'site_east_bridge',
    hint: 'gate_east',
    art: 'broken_bridge',
  });
  m.sites.push({
    id: 'east_bridge',
    name: 'the east bridge',
    rect: eastBridge,
    needs: { cobblestone: 12, plank: 6 },
    flag: 'site_east_bridge',
    if: { flag: 'plan_east' },
    at: { x: eastBridge.x - 1, y: 60 },
  });
  for (let y = westBridge.y; y < westBridge.y + westBridge.h; y++)
    m.put('thorn_bush', westBridge.x + 1, y, { id: `bridge_bush_${y}` });
  m.put('fallen_gum', 49, 24, { id: 'fallen_gum' });
  m.put('boulder_wall', 107, 103, { id: 'boulder_wall' });

  // ------------------------------------------------------------ Wishing Square
  m.blob(79, 59, 11, 6.5, 'k', 31, 0.12, 'g');
  m.path(
    [
      [78, 47],
      [78, 53],
    ],
    2,
  );
  m.path(
    [
      [57, 60],
      [70, 60],
    ],
    2,
  );
  m.path(
    [
      [88, 60],
      [100, 60],
    ],
    2,
  );
  m.path(
    [
      [78, 64],
      [78, 76],
    ],
    2,
  );
  m.path(
    [
      [60, 68],
      [97, 68],
    ],
    2,
  );
  m.path(
    [
      [61, 52],
      [96, 52],
    ],
    2,
  );
  m.path(
    [
      [61, 58],
      [68, 59],
    ],
    1,
  );
  m.put('great_tree', 77, 54, { id: 'great_tree', if: { noFlag: 'tree_lit' } });
  m.put('great_tree_lit', 77, 54, { id: 'great_tree_lit', if: { flag: 'tree_lit' }, force: true });
  m.place('great_tree', 79, 59, 'the Great Tree', 3);
  m.sites.push({
    id: 'tree_ladders',
    name: 'the tree ladders',
    rect: { x: 77, y: 54, w: 5, h: 5 },
    // package 33b: 3 ladders, one craft she makes herself (they were 9, handed over)
    needs: { ladder: 3 },
    flag: 'site_tree_ladders',
    if: { flag: 'star_made' },
    at: { x: 79, y: 59 },
  });
  m.put('present_pile', 82, 58, { id: 'presents', if: { christmas: true, flag: 'presents' } });
  m.put('workshop', 60, 48, { id: 'workshop' });
  // package 53a: in front of Grandad, two rows below the workshop door's row, so walking to it does not take her inside
  m.put('workbench', 64, 55, { id: 'grandad_bench' });
  m.place('grandad', 64, 53, "Grandad's workshop");
  m.place('workshop', 64, 56, "Grandad's workshop"); // the star for "make it at his bench" (marks in the prologue and finale)
  m.put('cafe', 68, 48, { id: 'cafe' });
  m.put('cafe_table', 73, 50);
  m.place('hello_kitty', 70, 53, 'the Apple Cafe');
  m.place('mimmy', 91, 66); // by the flower beds, away from the cafe: never more than 5 on a screen
  m.place('cakey', 68, 53);
  m.put('dollhouse', 84, 48, { id: 'dollhouse' });
  m.place('gabby', 87, 53, "Gabby's Dollhouse");
  m.place('pandy', 88, 53);
  m.place('dj_catnip', 84, 53);
  m.put('post_office', 91, 48, { id: 'post_office' });
  m.place('aunty', 93, 53, 'the Post Office');
  m.place('paddington_post', 95, 53);
  m.put('orange_tree', 97, 50, { id: 'orange_tree_1' });
  m.put('orange_tree', 98, 53, { id: 'orange_tree_2' });
  m.put('nanny_nook', 59, 55, { id: 'nanny_nook' });
  m.place('nanny', 62, 58, "Nanny's nook");
  m.put('stall', 90, 55, { id: 'shop_stall', d: 'shop' });
  m.place('trader', 93, 57, 'the shop stall');
  m.put('night_stall', 96, 56, { id: 'kuromi_stall', d: 'kuromi', if: { shards: 4, night: true } });
  m.place('kuromi', 95, 58, "Kuromi's stall");
  m.place('baku', 99, 58);
  m.put('school', 59, 63, { id: 'school' });
  m.put('nature_table', 66, 66, { id: 'nature_table' });
  // The chest on the school roof (design section 6): build a ladder against the wall, climb it, open the chest.
  m.sites.push({
    id: 'school_ladder',
    name: 'the ladder to the school roof',
    rect: { x: 65, y: 63, w: 1, h: 1 },
    needs: { ladder: 2 },
    flag: 'site_school_ladder',
    if: { done: 'ch1' },
    at: { x: 65, y: 64 },
  });
  m.keepRect(65, 62, 2, 3);
  m.put('ladder_up', 65, 63, { id: 'school_ladder', if: { flag: 'site_school_ladder' }, margin: 0 });
  m.put('chest', 64, 63, {
    id: 'chest_school_roof',
    d: 'emerald:15,cake:1',
    if: { flag: 'site_school_ladder' },
    force: true,
    margin: 0,
  });
  m.place('teacher', 63, 67, 'the school');
  m.place('robin', 67, 68);
  m.place('sam', 80, 53); // north of the Great Tree: the school yard holds two classmates, not three
  m.place('alex', 61, 70); // by her den
  // D69: the fourth classmate, just over the west stream from the school (the quiet-home limits count the home and
  // Square regions, and both are full from the second shard; this bank is Bing's Garden)
  m.place('charlie', 46, 63);
  m.place('school_yard', 69, 68, 'the school yard', 3);
  // package 47a: the snowball fight again for a cup
  m.put('game_post', 72, 70, { id: 'snow_post', d: 'snowball', if: { cup: 'snowball' } });
  m.put('greenhouse', 84, 64, { id: 'greenhouse' });
  m.put('stall', 89, 64, { id: 'seed_stall', d: 'seeds' });
  m.place('granny', 88, 67, "Granny's Garden");
  m.place('kitty_fairy', 95, 67);
  for (let i = 0; i < 6; i++) m.put('flower_bed', 93 + (i % 3) * 2, 63 + Math.floor(i / 3) * 2, { margin: 0 });
  m.put('noticeboard', 73, 62, { id: 'noticeboard' });
  m.place('noticeboard', 74, 63, 'the noticeboard');
  m.put('signpost', 84, 62, { id: 'sp_square', d: 'square' });
  m.place('sign_square', 84, 63, 'Wishing Square');
  m.put('apple_tree', 70, 56, { id: 'apple_tree_1' });
  m.put('apple_tree', 88, 61, { id: 'apple_tree_2' });
  m.put('apple_tree', 72, 64, { id: 'apple_tree_3' });
  for (const [x, y] of [
    [75, 53],
    [83, 53],
    [71, 61],
    [87, 58],
    [76, 66],
    [81, 66],
    [58, 62],
    [99, 62],
  ] as const)
    m.put('lamp_post', x, y);
  // One lantern string with bunting across the Square (phase 2, part G): lit at night.
  m.put('lantern_string', 75, 61, { id: 'square_lanterns' });
  // Sticks for the first lesson, and the first trees to chop, right by the workshop.
  for (const [x, y] of [
    [58, 53],
    [59, 54],
    [67, 55],
    [69, 55],
    [57, 50],
    [66, 57],
  ] as const)
    m.put('stick_pile', x, y);
  for (const [x, y] of [
    [57, 47],
    [58, 48],
    [56, 51],
    [57, 56],
  ] as const)
    m.put('oak', x, y);
  m.place('first_tree', 58, 51, 'the trees by the workshop', 4);
  // The first zombie (prologue): it appears east of the Great Tree, more than a screen from Grandad's workbench.
  m.place('tree_dusk', 85, 60, 'the Great Tree', 2);
  // A quiet home (phase 2, part B): guests who live out in the world instead of round her cottage.
  m.place('slinky_wait', 22, 83, 'the gorge creek');
  m.place('jessie_plains', 117, 80, "Bo Peep's pen");
  m.place('bullseye_plains', 115, 81);
  m.place('pandy_bay', 83, 101, 'the beach by the jetty');
  m.place('koala_grove', 29, 24, 'the koala tree');
  // Package 43b: where found guests stand until she finds them (then they go home after a morning card).
  m.place('hamm_beach', 99, 107, 'the far end of the beach');
  m.place('buzz_tree', 13, 10, 'the tall gum trees');
  m.place('potato_carts', 129, 14, 'the Mine carts');
  m.place('kitty_found', 126, 110, 'the Crater flower bed');
  m.place('forky_found', 68, 114, 'Treasure Island');
  // Story mobs appear more than a screen away from where the step before ends (phase 2, part E).
  m.place('heeler_dusk', 22, 112, 'the grass by the sand', 1);
  m.place('bing_dusk', 30, 82, 'the south side of the pond', 1.5);
  m.place('square_w', 60, 60);
  m.place('west_bridge', 57, 60, 'the west bridge', 2);
  m.place('square_e', 98, 61);
  m.place('square_s', 79, 66);
  m.place('party_1', 74, 60);
  m.place('party_2', 84, 60);
  m.place('party_3', 79, 62);
  m.place('party_4', 70, 62);
  m.place('party_5', 88, 63);
  m.place('party_6', 79, 52);
  // package 33b: the classmates, the teacher and Aunty at the party
  m.place('party_7', 72, 57);
  m.place('party_king', 82, 63, 'the Great Tree');
  m.put('ladder_up', 79, 58, { id: 'tree_ladder', if: { flag: 'site_tree_ladders' }, force: true, margin: 0 });

  // ------------------------------------------------------------ Home Meadow
  m.path(
    [
      [74, 76],
      [99, 76],
    ],
    2,
  );
  m.path(
    [
      [98, 76],
      [98, 97],
    ],
    2,
  );
  m.path(
    [
      [69, 76],
      [75, 76],
    ],
    2,
  );
  m.path(
    [
      [69, 76],
      [69, 97],
    ],
    2,
  );
  m.put('cottage', 72, 72, { id: 'cottage' });
  m.door(74, 76, 'cottage', 6, 7, 'up');
  m.place('cottage_door', 74, 77, 'your cottage');
  m.put('mailbox', 77, 75, { id: 'mailbox' });
  m.place('mailbox', 77, 76, 'your mailbox');
  m.put('signpost', 81, 75, { id: 'sp_home', d: 'home' });
  m.place('sign_home', 81, 76, 'Home Meadow');
  m.place('mum_garden', 85, 73, 'your cottage');
  m.place('dad_home', 77, 77);
  m.place('amelia_home', 71, 77);
  m.place('koala_home', 80, 77);
  // The home plot: 26 x 16, fenced, with a gate under the cottage door and one to the south.
  const PX = 71;
  const PY = 79;
  m.place('plot', PX, PY, 'your plot');
  for (let x = PX - 1; x <= PX + 26; x++) {
    if (x !== 74 && x !== 75) m.put('plot_fence', x, PY - 1, { margin: 0 });
    if (x !== 84 && x !== 85) m.put('plot_fence', x, PY + 16, { margin: 0 });
  }
  for (let y = PY; y < PY + 16; y++) {
    m.put('plot_fence', PX - 1, y, { margin: 0 });
    m.put('plot_fence', PX + 26, y, { margin: 0 });
  }
  m.keepRect(PX - 1, PY - 1, 28, 18);
  m.path(
    [
      [74, 78],
      [74, 81],
    ],
    2,
  );
  m.place('plot_gate', 74, 79, 'your plot');
  m.place('plot_mid', 82, 84, 'your plot', 6);
  m.blob(92, 72.5, 3.2, 1.8, 'q', 33, 0.15, 'g');
  m.put('lily', 92, 72, { force: true });
  // Toy Box Corner
  m.put('claw_machine', 59, 72, { id: 'claw_machine' });
  m.place('claw', 60, 74, 'the claw machine');
  m.put('prize_counter', 62, 72, { id: 'prize_counter' });
  m.place('hamm', 60, 75, 'Toy Box Corner');
  m.put('alphabet_blocks', 66, 71);
  m.put('alphabet_blocks', 58, 77);
  m.put('bounty_board', 64, 77, { id: 'bounty_board' });
  m.place('woody', 65, 83, 'Toy Box Corner'); // a screen south of the school yard
  m.place('bounty', 64, 78, 'the Wanted board');
  m.put('cardboard_fort', 60, 80, { id: 'fort' });
  m.place('rex', 65, 83);
  m.place('potato', 59, 84);
  m.put('radar_dish', 65, 85, { id: 'radar' });
  m.place('buzz', 64, 88, 'the star radar');
  for (let x = 59; x <= 66; x++) for (const y of [89, 93]) m.put('toy_track', x, y, { margin: 0 });
  for (let y = 90; y <= 92; y++) for (const x of [59, 66]) m.put('toy_track', x, y, { margin: 0 });
  m.put('toy_train', 61, 89, { id: 'toy_train', force: true });
  m.place('slinky', 63, 91);
  m.place('jessie', 61, 86);
  m.place('bullseye', 60, 87);
  m.place('bo_peep', 67, 94);
  m.place('forky', 61, 76);
  m.place('toybox', 63, 78, 'Toy Box Corner', 4);

  // ------------------------------------------------------------ Sandy Bay
  m.put('signpost', 80, 98, { id: 'sp_bay', d: 'bay' });
  m.place('sign_bay', 80, 99, 'Sandy Bay');
  m.path(
    [
      [69, 97],
      [69, 100],
      [58, 100],
    ],
    1,
    'p',
    's',
  );
  m.rect(84, 106, 2, 8, 'b');
  m.keepRect(83, 103, 4, 12);
  m.place('jetty', 84, 106, 'the jetty', 3);
  m.place('paddington_jetty', 85, 107);
  m.place('jetty_boat', 84, 112);
  m.put('boat', 86, 112, { id: 'boat_home', force: true });
  m.put('lookout', 89, 98, { id: 'lookout' });
  m.place('dad_lookout', 90, 102, "Dad's lookout");
  m.put('lighthouse', 95, 100, { id: 'lighthouse' });
  m.place('lighthouse', 96, 105, 'the lighthouse');
  m.blob(72.5, 104.5, 1.6, 1.2, 'q', 35, 0.1, 's');
  m.blob(76.5, 106, 1.3, 1.1, 'q', 36, 0.1, 's');
  m.place('mercat', 74, 103, 'the rock pools');
  for (const [x, y] of [
    [59, 98],
    [62, 97],
    [65, 98],
    [60, 102],
    [64, 103],
    [66, 101],
  ] as const)
    m.put('banana_tree', x, y);
  m.place('kevin', 62, 100, 'the banana grove');
  m.place('stuart', 64, 100);
  m.place('bob', 61, 104);
  m.place('minion_d', 66, 104);
  m.place('minion_e', 58, 103);
  m.place('banana_grove', 63, 101, 'the banana grove', 4);
  for (let i = 0; i < 6; i++) m.place('star_' + i, 70 + i * 4, 103 + (i % 2), undefined);
  for (const [t, x, y] of [
    ['sea_glass', 79, 105],
    ['sea_glass', 93, 106],
    ['starfish', 68, 106],
    ['driftwood', 88, 104],
    ['shell_spiral', 81, 102],
    ['pebble', 60, 107],
    ['pebble', 96, 97],
  ] as const)
    m.put(t, x, y, { margin: 0 });
  // Treasure Island, offshore
  m.blob(68, 114.5, 6, 2.2, 's', 37, 0.12, 'W');
  for (let y = 111; y < H; y++) for (let x = 60; x <= 76; x++) if (m.get(x, y) === 's') m.reg[y]![x] = 'T';
  m.place('treasure_landing', 64, 114, 'Treasure Island');
  m.put('boat', 62, 115, { id: 'boat_island', d: 'home', force: true });
  m.put('palm', 70, 113);
  // package 44b: the end of Dad's treasure trail, there once the fifth X is dug (flag dad_key)
  m.put('chest', 72, 114, {
    id: 'treasure_chest',
    d: 'emerald:25,treasure_crown:1,sticker.tr_crown:1,flag.trophy_crown:1',
    if: { flag: 'dad_key' },
  });
  m.put('dig_spot', 67, 115, { id: 'dig_island', d: 'treasure_coin:1,emerald:10,sticker.tr_coin:1' });
  m.put('bottle', 73, 115, { id: 'bottle_island', d: 'bottle7' });

  // ------------------------------------------------------------ Heeler Heights
  m.path(
    [
      [50, 100],
      [45, 100],
      [38, 101],
      [26, 101],
      [20, 100],
      [13, 99],
    ],
    2,
  );
  m.put('signpost', 47, 98, { id: 'sp_heeler', d: 'heeler' });
  m.place('sign_heeler', 47, 99, 'Heeler Heights');
  m.put('heeler_house', 10, 94, { id: 'heeler_house' });
  m.put('veranda', 10, 98, { margin: 0 });
  m.place('bandit', 12, 100, 'the Heeler house');
  // package 47a: Keepy Uppy again for a cup, the day after she first played it here
  m.put('game_post', 14, 103, { id: 'heeler_keepy_post', d: 'keepy', if: { cup: 'keepy' } });
  m.place('chilli', 15, 100, 'the Heeler house');
  m.place('bingo', 18, 101);
  m.place('bluey_home', 20, 102);
  m.put('poinciana', 22, 92, { id: 'poinciana' });
  m.place('poinciana', 24, 96, 'the big red tree', 2.5);
  m.place('backyard', 21, 99, 'the backyard', 3);
  m.place('backyard_edge', 30, 99, 'the creek', 3);
  m.put('workbench', 17, 92, { id: 'heeler_bench' });
  m.place('heeler_bench', 18, 93, 'the bench by the shed');
  m.put('trampoline', 16, 104);
  m.put('swing_set', 8, 102);
  m.put('paddling_pool', 12, 107, { id: 'heeler_pool', if: { done: 'sq_pool' } });
  m.place('creek_1', 38, 95, 'the creek', 2);
  m.place('creek_2', 31, 113, 'the creek', 2);
  m.place('creek_rock', 33, 107, 'the rock in the creek', 1.5);
  m.place('creek', 34, 103, 'the creek', 5);
  m.place('clue_1', 37, 99);
  m.zones.push({
    id: 'heeler_creek',
    region: 'U',
    rect: { x: 20, y: 92, w: 30, h: 26 },
    mobs: ['zombie', 'zombie', 'spider'],
    mode: 'night',
    max: 3,
  });

  // ------------------------------------------------------------ Bing's Garden
  m.path(
    [
      [50, 60],
      [40, 60],
      [28, 59],
      [16, 59],
      [12, 57],
    ],
    2,
  );
  m.path(
    [
      [30, 60],
      [30, 63],
    ],
    1,
  );
  m.path(
    [
      [32, 68],
      [34, 73],
    ],
    1,
  );
  m.put('signpost', 47, 58, { id: 'sp_bing', d: 'bing' });
  m.place('sign_bing', 47, 59, "Bing's Garden");
  m.put('bing_house', 10, 52, { id: 'bing_house' });
  m.place('flop', 13, 57, "Bing's house");
  m.place('bing_home', 15, 58);
  m.put('swing_set', 23, 64, { id: 'bing_swings' });
  m.put('slide', 29, 63, { id: 'bing_slide' });
  m.put('sandbox', 33, 64, { id: 'bing_sandbox' });
  // the see-saw is broken until Coco's quest mends it (see sideQuestPlaces)
  m.place('sula', 27, 67, 'the playground');
  m.place('pando', 31, 67, 'the playground');
  // package 47a: hide and seek again for a cup
  m.put('game_post', 30, 70, { id: 'pando_hide_post', d: 'hide', if: { cup: 'hide' } });
  m.place('coco', 36, 68, 'the playground');
  m.place('play_1', 24, 66, 'the swings', 1.8);
  m.place('play_2', 31, 66, 'the slide', 1.8);
  m.place('play_3', 34, 67, 'the sandpit', 1.8);
  m.place('nest', 19, 72, 'the nest', 2);
  m.place('herd_chicken_0', 19, 73);
  m.place('playground', 29, 67, 'the playground', 6);
  m.blob(39, 77, 5, 3.3, 'q', 41, 0.15, 'g');
  for (const [x, y] of [
    [37, 76],
    [40, 78],
    [42, 76],
  ] as const)
    m.put('lily', x, y, { force: true });
  m.place('ducks', 38, 72, 'the park pond', 3);
  m.put('picnic_blanket', 32, 74, { id: 'picnic', if: { flag: 'picnic' }, margin: 0 });
  m.place('picnic', 34, 75, 'the park pond', 3);
  m.place('pen_bing', 22, 76, 'the little pen', 1.6);
  for (const [x, y] of [
    [20, 75],
    [21, 74],
    [22, 74],
    [23, 74],
    [24, 75],
    [24, 76],
    [24, 77],
    [20, 76],
    [20, 77],
  ] as const)
    m.put('fence', x, y, { if: { flag: 'site_pen_bing' }, margin: 0 });
  m.put('workbench', 38, 62, { id: 'bing_bench' });
  m.place('bing_bench', 39, 63, 'the bench by the playground');
  m.sites.push({
    id: 'pen_bing',
    name: 'the little pen',
    rect: { x: 21, y: 75, w: 3, h: 3 },
    needs: { fence: 3 },
    flag: 'site_pen_bing',
    if: { flag: 'pen_plan' },
    at: { x: 22, y: 78 },
  });
  m.place('clue_2', 22, 66);
  m.zones.push({
    id: 'bing_field',
    region: 'B',
    rect: { x: 5, y: 62, w: 44, h: 22 },
    mobs: ['zombie', 'spider', 'zombie'],
    mode: 'night',
    max: 3,
  });

  // ------------------------------------------------------------ Peppa's Hill, the quarry and Muddy Valley
  m.path(
    [
      [78, 38],
      [78, 32],
      [76, 28],
      [76, 26],
    ],
    2,
  );
  m.path(
    [
      [74, 27],
      [62, 26],
      [52, 25],
    ],
    2,
  );
  m.path(
    [
      [78, 30],
      [86, 28],
      [90, 27],
    ],
    2,
  );
  m.path(
    [
      [76, 20],
      [76, 15],
    ],
    2,
  );
  m.put('signpost', 81, 37, { id: 'sp_peppa', d: 'peppa' });
  m.place('sign_peppa', 81, 38, "Peppa's Hill");
  m.put('peppa_house', 74, 21, { id: 'peppa_house' });
  m.place('mummy_pig', 78, 26, 'the little house');
  m.place('daddy_pig', 73, 27, 'the little house');
  m.place('george', 80, 28);
  m.place('peppa_home', 75, 28);
  m.place('garden_1', 69, 30, 'the garden', 1.8);
  m.place('garden_2', 82, 32, 'the garden', 1.8);
  m.place('garden_3', 72, 33, 'the garden', 1.8);
  m.blob(94, 25, 5.5, 8, 't', 43, 0.18, 'g');
  m.place('quarry', 90, 27, 'the quarry', 3);
  for (const [x, y] of [
    [92, 20],
    [95, 21],
    [97, 23],
    [93, 24],
    [96, 26],
    [92, 28],
    [95, 29],
    [97, 30],
    [93, 31],
    [94, 18],
    [91, 23],
    [96, 32],
  ] as const)
    if (m.get(x, y) === 't') m.put('rock', x, y, { margin: 0 });
  for (const [x, y] of [
    [98, 26],
    [97, 20],
    [95, 33],
    [98, 29],
  ] as const)
    if (m.walk(x, y)) m.put('coal_rock', x, y, { margin: 0 });
  m.place('clue_3', 89, 30);
  m.place('rex_hill', 82, 27);
  m.put('workbench', 70, 24, { id: 'peppa_bench' });
  m.place('peppa_bench', 71, 25, 'the bench by the little house');
  m.place('valley_gate', 76, 16, 'Muddy Valley');
  m.place('puddle_start', 62, 9, 'the puddle course', 2.5);
  for (let i = 0; i < 8; i++) m.put('puddle', 62 + i * 3, 8 + (i % 2) * 2, { margin: 0 });
  m.put('big_puddle', 87, 6, { id: 'big_puddle', margin: 0 });
  m.place('big_puddle', 89, 10, 'the biggest puddle', 3);
  m.zones.push({
    id: 'peppa_slopes',
    region: 'P',
    rect: { x: 52, y: 28, w: 46, h: 13 },
    mobs: ['zombie', 'skeleton', 'spider'],
    mode: 'night',
    max: 3,
  });

  // ------------------------------------------------------------ Gum Tree Grove
  m.path(
    [
      [48, 25],
      [40, 25],
      [32, 24],
      [26, 23],
    ],
    2,
  );
  m.put('signpost', 45, 23, { id: 'sp_gum', d: 'gum' });
  m.place('sign_gum', 45, 24, 'Gum Tree Grove');
  m.place('fallen_tree', 52, 25, 'the fallen gum tree', 2.5);
  m.put('treehouse', 22, 16, { id: 'treehouse', if: { flag: 'site_treehouse' } });
  m.sites.push({
    id: 'treehouse',
    name: 'the koala treehouse',
    rect: { x: 22, y: 16, w: 4, h: 4 },
    needs: { plank: 16, ladder: 3, fence: 4 },
    flag: 'site_treehouse',
    if: { flag: 'treehouse_plan' },
    at: { x: 24, y: 21 },
  });
  m.sites.push({
    id: 'treehouse_lights',
    name: 'the treehouse lights',
    rect: { x: 21, y: 20, w: 6, h: 1 },
    needs: { torch: 4 },
    flag: 'site_treehouse_lights',
    if: { flag: 'site_treehouse' },
    at: { x: 26, y: 21 },
  });
  m.place('mama_koala', 27, 23, 'the koala tree');
  // package 47a: Mama Koala's archery targets (chapter 4's set piece), and the post to play them again for cups
  m.put('game_post', 31, 24, { id: 'targets_post', d: 'targets', if: { flag: 'archery' } });
  m.place('gum_range', 31, 25, 'the targets', 2);
  m.place('pen_koala', 25, 23, 'Mama Koala', 2.2);
  m.put('log_hollow', 11, 12, { id: 'hollow_log' });
  m.place('herd_joey_1', 12, 14, 'the hollow log');
  m.place('herd_joey_2', 36, 10, 'the fern patch');
  m.place('herd_joey_3', 40, 33, 'the big rock');
  for (const [x, y] of [
    [35, 9],
    [37, 9],
    [36, 11],
    [34, 10],
    [38, 11],
  ] as const)
    m.put('fern', x, y, { margin: 0 });
  m.put('boulder', 41, 32, { id: 'gum_boulder' });
  m.place('clue_4', 24, 24);
  m.place('grove_edge', 33, 27, 'the grove', 3);
  m.put('workbench', 29, 20, { id: 'gum_bench' });
  m.place('gum_bench', 30, 21, 'the bench in the grove');
  // Feathers for arrows (phase 2, part D): a plain source in the grove, picked by hand, back each morning.
  for (const [x, y] of [
    [31, 25],
    [35, 24],
    [27, 26],
    [34, 30],
  ] as const)
    m.put('feather', x, y, { id: `grove_feather_${x}_${y}`, margin: 0 });
  for (const [x, y] of [
    [21, 20],
    [23, 20],
    [26, 20],
    [27, 19],
  ] as const)
    m.put('torch_stand', x, y, { if: { flag: 'site_treehouse_lights' }, margin: 0 });
  m.put('fairy_ring', 8, 30, { id: 'fairy_ring', if: { night: true }, margin: 1 });
  m.put('pickup', 9, 31, { id: 'fairy_gift', d: 'star_fragment:2,sticker.tr_fairy:1', if: { night: true } });
  m.zones.push({
    id: 'gum_grove',
    region: 'G',
    rect: { x: 5, y: 5, w: 43, h: 36 },
    mobs: ['spider', 'spider', 'zombie'],
    mode: 'night',
    max: 3,
  });

  // ------------------------------------------------------------ Blocky Plains
  m.path(
    [
      [105, 60],
      [120, 61],
      [134, 62],
    ],
    2,
    'k',
    'G',
  );
  m.path(
    [
      [134, 62],
      [134, 72],
    ],
    2,
    'k',
    'G',
  );
  m.path(
    [
      [120, 61],
      [120, 47],
    ],
    2,
    'k',
    'G',
  );
  m.put('signpost', 108, 58, { id: 'sp_plains', d: 'plains' });
  m.place('sign_plains', 108, 59, 'the Blocky Plains');
  gearBoard(m, 'gear_plains', 106, 56, 'stone_sword,leather_helmet');
  m.put('villager_house_a', 127, 57, { id: 'vhouse_1' });
  m.put('villager_house_b', 138, 57, { id: 'vhouse_2' });
  m.put('villager_house_b', 127, 66, { id: 'vhouse_3' });
  m.put('villager_house_a', 139, 66, { id: 'vhouse_4' });
  m.put('well', 133, 63, { id: 'village_well' });
  m.place('village_well', 136, 65, 'the village well', 3);
  m.place('woody_village', 133, 67, 'the village');
  m.place('jessie_village', 135, 68, 'the village');
  m.sites.push({
    id: 'village_fence',
    name: 'the village fence',
    rect: { x: 125, y: 72, w: 20, h: 1 },
    needs: { fence: 9 },
    flag: 'site_village_fence',
    if: { flag: 'village_help' },
    at: { x: 134, y: 73 },
  });
  m.place('golem', 131, 64, 'the village');
  m.place('villager_1', 130, 62);
  m.place('villager_2', 140, 63);
  m.place('villager_3', 131, 71);
  m.place('village_trader', 137, 62, 'the village');
  m.put('stall', 136, 67, { id: 'village_stall', d: 'village' });
  m.place('village', 134, 65, 'the village', 6);
  m.place('village_gate', 135, 75, 'the village gate', 3);
  m.put('workbench', 142, 62, { id: 'village_bench' });
  for (let x = 125; x <= 144; x++)
    if (x < 133 || x > 136) m.put('fence', x, 72, { if: { flag: 'site_village_fence' }, margin: 0 });
  for (const [x, y] of [
    [132, 62],
    [135, 62],
    [132, 65],
    [135, 65],
    [131, 63],
    [136, 64],
  ] as const)
    m.put('torch_stand', x, y, { if: { flag: 'site_well_torches' }, margin: 0 });
  m.place('bo_peep_plains', 121, 77);
  m.place('pen_bopeep', 124, 79, "Bo Peep's pen", 2.2);
  for (let x = 121; x <= 127; x++) for (const y of [76, 82]) if (x !== 124) m.put('fence', x, y, { margin: 0 });
  for (let y = 77; y <= 81; y++)
    for (const x of [121, 127]) if (!(x === 121 && y === 77)) m.put('fence', x, y, { margin: 0 });
  m.keepRect(121, 76, 7, 7);
  for (let i = 1; i <= 4; i++) m.place('herd_sheep_' + i, 112 + i * 2, 72 + (i % 2) * 5);
  for (let i = 1; i <= 3; i++) m.place('herd_cow_' + i, 144 + i * 2, 50 + (i % 2) * 3);
  for (let i = 1; i <= 3; i++) m.place('herd_pig_' + i, 110 + i * 3, 50 + (i % 2) * 3);
  for (let i = 1; i <= 4; i++) m.place('herd_chicken_' + i, 146 + i * 2, 75 + (i % 2) * 4);
  for (let x = 145; x <= 152; x++)
    for (let y = 60; y <= 67; y++) if ((x + y) % 2 === 0 && m.walk(x, y)) m.put('wheat_wild', x, y, { margin: 0 });
  m.place('wheat_field', 148, 68, 'the wheat field', 3);
  m.place('clue_5', 150, 69);
  m.place('wolf_den', 153, 83, 'the edge of the trees');
  for (const x of [112, 118, 126, 133, 141, 149]) if (m.walk(x, 86)) m.put('coal_rock', x, 86, { margin: 0 });
  m.zones.push({
    id: 'plains_night',
    region: 'L',
    rect: { x: 106, y: 48, w: 52, h: 38 },
    mobs: ['zombie', 'zombie', 'skeleton', 'spider', 'creeper', 'creeper', 'enderman'],
    mode: 'night',
    max: 3,
  });
  m.zones.push({
    id: 'village_night',
    region: 'L',
    rect: { x: 124, y: 55, w: 22, h: 20 },
    mobs: ['zombie'],
    mode: 'night',
    max: 3,
  });

  // ------------------------------------------------------------ Blocky Forest and the Mine mouth
  m.path(
    [
      [120, 47],
      [121, 38],
      [127, 28],
      [133, 18],
      [134, 11],
    ],
    2,
    'p',
    'd',
  );
  m.put('signpost', 117, 43, { id: 'sp_forest', d: 'forest' });
  m.place('sign_forest', 117, 44, 'the Blocky Forest');
  gearBoard(m, 'gear_forest', 115, 41, 'iron_sword,iron_helmet');
  for (let x = 133; x <= 136; x++) for (let y = 7; y <= 9; y++) m.set(x, y, 'd');
  m.put('mine_mouth', 133, 7, { id: 'mine_mouth' });
  gearBoard(m, 'gear_mine', 130, 10, 'iron_sword,iron_helmet');
  m.door(134, 10, 'mine1', 4, 3, 'down', { if: { flag: 'site_mine_torches' }, hint: 'mine_dark' });
  m.door(135, 10, 'mine1', 5, 3, 'down', { if: { flag: 'site_mine_torches' }, hint: 'mine_dark' });
  m.sites.push({
    id: 'mine_torches',
    name: 'the Mine lights',
    rect: { x: 132, y: 10, w: 6, h: 1 },
    needs: { torch: 8 },
    flag: 'site_mine_torches',
    if: { flag: 'mine_plan' },
    at: { x: 135, y: 12 },
  });
  m.place('mine_mouth', 135, 12, 'the Mine', 3);
  for (const x of [131, 132, 137, 138])
    for (const y of [10, 11]) m.put('torch_stand', x, y, { if: { flag: 'site_mine_torches' }, margin: 0 });
  m.place('grandad_mine', 137, 12, 'the Mine');
  m.put('big_furnace', 139, 10, { id: 'mine_furnace', if: { flag: 'mine_plan' } });
  m.put('workbench', 130, 11, { id: 'mine_bench', if: { flag: 'mine_plan' } });
  m.put('minecart', 128, 13, { id: 'cart_mine', d: 'mine' });
  m.place('sign_cart_mine', 128, 14);
  m.place('clue_6', 141, 13);
  // Chapter 6 (package 33b): coal by the Mine door, for the torches and Grandad's furnace.
  for (const [x, y] of [
    [137, 14],
    [139, 14],
    [138, 16],
  ] as const)
    if (m.walk(x, y)) m.put('coal_rock', x, y, { margin: 0 });
  m.door(107, 8, 'cave', 5, 6, 'up');
  m.set(107, 8, 'd');
  m.set(107, 9, 'd');
  m.place('waterfall', 108, 11, 'the waterfall', 3);
  m.put('waterfall', 102, 3, { id: 'waterfall', force: true });
  m.zones.push({
    id: 'forest_shade',
    region: 'F',
    rect: { x: 106, y: 11, w: 34, h: 34 },
    mobs: ['skeleton', 'zombie', 'spider', 'skeleton'],
    mode: 'always',
    max: 2,
  });
  m.zones.push({
    id: 'forest_deep',
    region: 'F',
    rect: { x: 140, y: 11, w: 17, h: 34 },
    mobs: ['skeleton', 'creeper', 'spider', 'zombie'],
    mode: 'always',
    max: 3,
  });

  // ------------------------------------------------------------ Creeper Crater
  m.path(
    [
      [109, 104],
      [118, 103],
      [126, 100],
      [132, 99],
    ],
    2,
    't',
    'a',
  );
  m.put('signpost', 111, 102, { id: 'sp_crater', d: 'crater' });
  m.place('sign_crater', 111, 103, 'Creeper Crater');
  gearBoard(m, 'gear_crater', 109, 100, 'diamond_sword,iron_armour');
  m.place('crater_wall', 106, 104, 'the boulder wall', 2);
  for (let x = 131; x <= 134; x++) for (let y = 95; y <= 97; y++) m.set(x, y, 'a');
  m.put('hall_gate', 131, 95, { id: 'hall_gate' });
  m.door(132, 98, 'hall', 13, 18, 'up', { if: { flag: 'hall_open' }, hint: 'need_shards' });
  m.door(133, 98, 'hall', 14, 18, 'up', { if: { flag: 'hall_open' }, hint: 'need_shards' });
  m.put('socket_stone', 128, 98, { id: 'sockets' });
  m.place('hall_gate', 133, 100, "the King's Hall", 2.5);
  for (const [x, y] of [
    [120, 96],
    [124, 108],
    [140, 104],
    [146, 97],
    [116, 112],
    [138, 112],
    [150, 110],
  ] as const)
    m.put('flower_bed', x, y, { margin: 0 });
  for (const [x, y] of [
    [119, 100],
    [128, 105],
    [143, 100],
    [136, 108],
    [122, 113],
    [148, 106],
  ] as const)
    m.put('scorch', x, y, { margin: 0 });
  m.put('sign', 122, 97, { id: 'sign_practice', d: 'practice' });
  m.put('sign', 142, 107, { id: 'sign_sorry', d: 'sorry' });
  for (const [x, y] of [
    [152, 96],
    [154, 100],
    [153, 113],
  ] as const)
    m.put('gold_rock', x, y);
  for (const [x, y] of [
    [155, 106],
    [151, 115],
  ] as const)
    m.put('diamond_rock', x, y);
  m.place('king_garden', 140, 106, "the King's garden", 3);
  m.zones.push({
    id: 'crater_floor',
    region: 'C',
    rect: { x: 112, y: 100, w: 44, h: 17 },
    // a creeper now and then: the Creeper Crater has creepers, and one can be lured to the cracked rock in the rim
    mobs: ['zombie', 'skeleton', 'spider', 'creeper'],
    mode: 'always',
    max: 2,
  });

  // ------------------------------------------------------------ the clue trail: a scorch mark and one flower after each shard
  for (let n = 1; n <= 6; n++) {
    const p = m.places['clue_' + n]!;
    m.put('scorch', p.x, p.y, { id: 'clue_scorch_' + n, if: { flag: 'shard' + n }, margin: 0 });
    m.put('lone_flower', p.x + 1, p.y, { id: 'clue_flower_' + n, if: { flag: 'shard' + n }, margin: 0 });
  }

  sideQuestPlaces(m);
  homeAndDens(m);
  islandProjects(m);
  scatterAll(m);
  secrets(m);
  landmarkFinds(m);
  wildStretches(m);
  // Five more houses she can walk into (phase 2, part F): a door tile in front of each house picture's door.
  for (const d of HOUSE_DOORS) m.door(d.x, d.y, d.room, d.tx, d.ty, 'up');
  secretShow(m);
  // Package 72: a door into every other building, added last so every door before keeps its place in the list. A
  // building that waits for a flag opens its door with it, with no hint (that tile is its build site's hand-over point).
  for (const d of ROOM_DOORS) m.door(d.x, d.y, d.room, d.tx, d.ty, 'up', d.if ? { if: d.if } : {});
  // A lantern beside the lighthouse door (added last). The one-tile way between the tower and its chest runs past
  // that door; with a solid on one side the door takes her in only from its own tile (src/core/grid.ts doorInto), not
  // from the way beside it, so nobody walking past is pulled in.
  m.put('lantern', 95, 104, { id: 'lighthouse_lantern', margin: 0 });
  // The same beside every other new door: a lamp by each door. The treehouse needs none: its two torches stand either
  // side of its door once lit. Village houses 3 and 4 get a flower pot; the windmill and the hill lookout a torch that
  // comes with the building.
  for (const [x, y, id] of [
    [71, 52, 'cafe_lantern'],
    [85, 52, 'dollhouse_lantern'],
    [94, 52, 'post_office_lantern'],
    [59, 58, 'nanny_nook_lantern'],
    [62, 67, 'school_lantern'],
    [84, 67, 'greenhouse_lantern'],
    [91, 101, 'lookout_lantern'],
    [129, 61, 'vhouse_1_lantern'],
  ] as const)
    m.put('lantern', x, y, { id, margin: 0 });
  m.put('block_flowerpot', 129, 70, { id: 'vhouse_3_pot', margin: 0 });
  m.put('block_flowerpot', 141, 70, { id: 'vhouse_4_pot', margin: 0 });
  m.put('torch_stand', 152, 58, { id: 'mill_torch', if: { flag: 'site_mill' }, margin: 0 });
  m.put('torch_stand', 116, 9, { id: 'beacon_torch', if: { flag: 'site_beacon' }, margin: 0 });
  return m;
}

/**
 * Package 70: the secret after the credits. Three quiet corners she already knows (the waterfall, the sea in Gum
 * Tree Grove, the far plains) and the night show by the orange trees in Wishing Square. Placed last, on tiles that are already
 * clear, so nothing else on the island moves.
 */
function secretShow(m: MapMaker): void {
  m.place('secret_rumi', 109, 8, 'the waterfall');
  m.place('secret_mic', 112, 8);
  m.place('secret_mira', 27, 6, 'the sea');
  m.place('secret_zoey', 150, 50, 'the far plains');
  // the show: by the orange trees in the Square's quiet north-east corner (the rest of the Square is busy at night,
  // and a screen holds at most 5 named characters)
  m.place('secret_stage', 99, 48, 'the orange trees', 3);
  m.place('secret_stage_r', 99, 47);
  m.place('secret_stage_m', 97, 47);
  m.place('secret_stage_z', 101, 47);
  m.place('secret_mobs', 101, 50);
}

/**
 * Package 41: the four mob dens (a ring of standing stones away from the paths, its chest in the middle once it is
 * cleared), the build site at her door for the house steps, and where a visiting friend stands. Before the scatter,
 * so nothing grows inside a ring.
 */
function homeAndDens(m: MapMaker): void {
  const DENS: [string, number, number, string][] = [
    ['plains', 140, 80, 'emerald:12,iron_ingot:3'],
    ['forest', 137, 40, 'emerald:15,lamp:1'],
    ['mine', 120, 14, 'diamond:1,emerald:10'],
    ['crater', 140, 95, 'diamond:2,emerald:20,trophy_star:1'],
  ];
  for (const [id, cx, cy, loot] of DENS) {
    m.place('den_' + id, cx, cy, 'the den', 4);
    m.keepRect(cx - 5, cy - 5, 11, 11);
    // ten stones on a ring of 4.5 tiles, with two gaps (south and east) to walk in by
    for (let i = 0; i < 12; i++) {
      if (i === 3 || i === 0) continue;
      const a = (i / 12) * Math.PI * 2;
      const x = Math.round(cx + Math.cos(a) * 4.5);
      const y = Math.round(cy + Math.sin(a) * 4.5);
      if (!m.walk(x, y)) continue;
      m.put('den_stone', x, y, { id: `den_${id}_stone_${i}`, margin: 0, force: true });
    }
    m.put('chest', cx, cy, { id: 'chest_den_' + id, d: loot, if: { flag: 'den_' + id }, margin: 0, force: true });
  }
  // the house steps (43a's home chapters): one build site at her door, shown while its step is open
  const needs: Record<number, Record<string, number>> = {
    1: { plank: 12, log: 6 },
    2: { plank: 16, cobblestone: 8, glass: 2 },
    3: { glass: 3, plank: 8 },
  };
  for (const n of [1, 2, 3])
    m.sites.push({
      id: 'house_' + n,
      name: n === 1 ? 'the bigger room' : n === 2 ? 'the biggest room' : 'the window and photo wall',
      rect: { x: 80, y: 73, w: 2, h: 2 },
      needs: needs[n]!,
      flag: `house${n}_paid`,
      if: { flag: `house${n}_open` },
      at: { x: 80, y: 75 },
    });
  m.place('house_site', 80, 75, 'the building spot');
  m.keepRect(79, 72, 4, 4);
}

/** Package 41: the small find beside each landmark that has a chest or a note (src/data/world.ts names them). */
function landmarkFinds(m: MapMaker): void {
  const near = (x: number, y: number): [number, number] => {
    for (let r = 1; r < 7; r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const tx = x + dx;
          const ty = y + dy;
          if (!m.in(tx, ty) || !m.walk(tx, ty) || m.taken[ty * m.w + tx] || !'gGdsa'.includes(m.get(tx, ty))) continue;
          if (Object.values(m.places).some((p) => Math.abs(p.x - tx) <= 1 && Math.abs(p.y - ty) <= 1)) continue;
          return [tx, ty];
        }
    throw new Error(`map: no room for a landmark find near ${x},${y}`);
  };
  const FINDS: [string, string, string, string][] = [
    ['sign', 'note_toybox', 'toybox', 'note_toybox'],
    ['sign', 'note_puddle', 'big_puddle', 'note_puddle'],
    ['chest', 'chest_heeler_yard', 'bandit', 'emerald:5,toy_drum:1'],
    ['chest', 'chest_playground', 'playground', 'emerald:4,toy_rocket:1'],
    ['chest', 'chest_village', 'village_well', 'emerald:6,bread:2'],
    ['chest', 'chest_bananas', 'banana_grove', 'banana:4,emerald:3'],
    ['chest', 'chest_quarry', 'quarry', 'emerald:5,bread:2'],
  ];
  for (const [type, id, at, d] of FINDS) {
    const p = m.places[at]!;
    const [x, y] = near(p.x + 2, p.y + 1);
    m.put(type, x, y, { id, d, margin: 0 });
  }
}

/** Build sites, search spots and results for the side quests and friend lines. */
/**
 * A picture board at the way into a tough region (package 31): the sword and the armour that suit it, as pictures.
 * It goes on the nearest free tiles to (x, y) off the paths, so it never blocks the way.
 */
function gearBoard(m: MapMaker, id: string, x: number, y: number, d: string): void {
  for (let r = 0; r < 6; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const tx = x + dx;
        const ty = y + dy;
        if (!m.free('gear_board', tx, ty)) continue;
        if (m.keep[ty * m.w + tx] || m.keep[ty * m.w + tx + 1]) continue;
        m.put('gear_board', tx, ty, { id, d, margin: 0 });
        return;
      }
  throw new Error(`map: no room for the gear board ${id} near ${x},${y}`);
}

function sideQuestPlaces(m: MapMaker): void {
  const site = (
    id: string,
    name: string,
    x: number,
    y: number,
    w: number,
    h: number,
    needs: Record<string, number>,
    quest: string,
    result: string,
    ax: number,
    ay: number,
  ) => {
    m.sites.push({
      id,
      name,
      rect: { x, y, w, h },
      needs,
      flag: 'site_' + id,
      if: { active: quest },
      at: { x: ax, y: ay },
    });
    m.keepRect(x - 1, y - 1, w + 2, h + 3);
    if (result) m.put(result, x, y, { id: 'built_' + id, if: { flag: 'site_' + id }, margin: 0 });
  };
  // Package 14: the den and the fort need logs only (no wool exists that early); their blankets come from a friend.
  site('den', 'the den', 58, 69, 2, 2, { log: 6 }, 'sq_alex_den', 'den', 60, 70);
  site('fort', 'the blanket fort', 25, 103, 3, 2, { log: 6 }, 'sq_bandit_fort', 'blanket_fort', 26, 105);
  site(
    'banana_stand',
    'the banana stand',
    67,
    98,
    3,
    2,
    { plank: 8, stick: 4, banana: 4 },
    'sq_kevin_stand',
    'banana_stand',
    68,
    100,
  );
  site('king_bench', 'the garden bench', 138, 108, 3, 1, { plank: 6 }, 'sq_king_garden', 'garden_bench', 139, 109);
  site('seesaw', 'the see-saw', 26, 71, 3, 1, { plank: 6, stick: 4 }, 'sq_coco_seesaw', 'seesaw', 27, 72);
  // Chapter 4: a hide and seek post by the finished treehouse.
  m.put('game_post', 28, 22, { id: 'joey_post', d: 'hide', if: { flag: 'site_treehouse' } });
  // Chapter 6: the skeletons catch her up on the path, clear of Grandad, his bench and the cart.
  m.place('mine_path', 133, 17, 'the path to the Mine', 2.5);
  // Chapter 5: Bo Peep's sheep course, a race round the flags by her pen.
  m.put('game_post', 119, 77, { id: 'sheep_post', d: 'race', if: { flag: 'village_help' } });
  // Chapter 7: places for the quiet walk through the Crater, the King's potting bench and his hide and seek post.
  m.place('practice_sign', 122, 98, 'the wobbly sign', 2);
  m.place('tally_marks', 128, 106, 'the scorch marks', 2.5);
  m.place('crater_bed', 124, 110, 'the flower bed', 3);
  m.place('bloom_1', 120, 97);
  m.place('bloom_2', 116, 113);
  m.place('bloom_3', 138, 113);
  m.place('bloom_4', 146, 98);
  m.place('crater_gold', 152, 98, 'the gold rocks', 3);
  // Package 33b: the diamonds for her diamond sword, and the King's potting bench, there before she meets him.
  m.place('crater_gems', 153, 106, 'the shiny rocks', 3);
  m.put('workbench', 136, 105, { id: 'king_potting' });
  m.place('potting_bench', 137, 106, 'the potting bench', 2);
  m.put('game_post', 141, 109, { id: 'king_post', d: 'hide', if: { flag: 'king_friend' } });
  m.put('game_post', 134, 110, { id: 'crater_race_post', d: 'race', if: { flag: 'king_friend' } });
  // The creepers' see-saw stands in the garden once the King is a friend (it was a build step; the fun panel cut it).
  m.put('seesaw', 130, 108, { id: 'creeper_seesaw', if: { flag: 'king_friend' }, margin: 0 });
  // Chapters 1 to 3 (second pass): story jobs that appear when a step sets their flag, so no site stands near a fight.
  const job = (
    id: string,
    name: string,
    x: number,
    y: number,
    w: number,
    h: number,
    needs: Record<string, number>,
    flag: string,
    result: string,
    ax: number,
    ay: number,
  ) => {
    m.sites.push({ id, name, rect: { x, y, w, h }, needs, flag: 'site_' + id, if: { flag }, at: { x: ax, y: ay } });
    m.keepRect(x - 1, y - 1, w + 2, h + 3);
    m.put(result, x, y, { id: 'built_' + id, if: { flag: 'site_' + id }, margin: 0 });
  };
  // Chapter 1: Bluey's treasure hunt and race, the round tracks, the bunny house and the ladder to the roof.
  m.place('heeler_tramp', 17, 106, 'the jumping mat', 1.8);
  m.place('heeler_swing', 9, 104, 'the swings', 1.8);
  m.place('heeler_veranda', 13, 99, 'the veranda', 2);
  m.place('heeler_race', 20, 107, 'the flag post in the yard');
  m.put('game_post', 20, 106, { id: 'heeler_race_post', d: 'race', if: { flag: 'bluey_race' } });
  m.place('heeler_dog', 8, 112, 'the long dog', 1.8);
  m.place('trail_1', 42, 95, 'the round tracks', 2);
  m.place('trail_2', 50, 98, 'the stepping stones', 2);
  job('bunny_house', 'the bunny house', 7, 105, 2, 2, { plank: 6, stick: 2 }, 'party_jobs', 'kennel', 8, 107);
  job('roof_ladder', 'the ladder to the roof', 16, 96, 1, 1, { ladder: 3 }, 'party_jobs', 'ladder_up', 16, 97);
  // Chapter 2: the picnic table by the pond and three spots round the water for the duck in the shorts.
  job('picnic_table', 'the picnic table', 29, 73, 2, 2, { plank: 6, stick: 2 }, 'picnic_jobs', 'cafe_table', 30, 75);
  m.place('pond_w', 33, 77, 'the park pond', 1.8);
  m.place('pond_s', 38, 82, 'the park pond', 1.8);
  m.place('pond_e', 45, 77, 'the park pond', 1.8);
  m.place('bread_1', 18, 60, 'the path to the pond');
  m.place('bread_2', 26, 61, 'the path to the pond');
  m.place('bread_3', 33, 70, 'the path to the pond');
  m.put('game_post', 31, 79, { id: 'pond_race_post', d: 'race', if: { flag: 'duck_race' } });
  m.place('pond_race', 31, 80, 'the flag post by the pond');
  // Chapter 3: George's hole in the quarry, open grass for a short fight, the welly box lights and a first puddle for Rex.
  m.place('quarry_hole', 96, 24, 'the hole in the quarry', 2);
  m.place('quarry_lawn', 88, 34, 'the grass by the quarry', 2.5);
  job('welly_lights', 'the lights by the welly box', 79, 23, 1, 1, { torch: 2 }, 'welly_hunt', 'torch_stand', 79, 24);
  job('pig_wall', 'the garden wall', 66, 29, 3, 1, { cobblestone: 6 }, 'pig_wall', 'stone_wall', 67, 30);
  for (const x of [67, 68]) m.put('stone_wall', x, 29, { if: { flag: 'site_pig_wall' }, margin: 0 });
  m.put('puddle', 84, 30, { id: 'rex_puddle', margin: 0 });
  m.place('rex_puddle', 84, 31, 'the little puddle', 1.8);
  // The six sockets: she sets one shard at a time along the gate, and each one glows.
  [126, 127, 130, 131, 134, 135].forEach((x, i) => {
    m.place('socket_' + (i + 1), x, 99, "the King's Hall", 1.3);
    m.put('crystal', x, 98, { id: 'socket_glow_' + (i + 1), if: { flag: 'socket_' + (i + 1) }, margin: 0 });
  });
  m.sites.push({
    id: 'forest_lamps',
    name: 'the forest lamps',
    rect: { x: 122, y: 33, w: 2, h: 2 },
    needs: { torch: 6 },
    flag: 'site_forest_lamps',
    if: { active: 'sq_alex_lights' },
    at: { x: 123, y: 35 },
  });
  m.keepRect(120, 31, 6, 7);
  for (const [x, y] of [
    [122, 33],
    [123, 30],
    [125, 27],
    [128, 24],
    [130, 20],
    [132, 16],
  ] as const)
    m.put('torch_stand', x, y, { if: { flag: 'site_forest_lamps' }, margin: 0, force: true });
  m.place('forest_path', 122, 37, 'the forest path', 3.5);
  for (const [i, x, y] of [
    [1, 68, 58],
    [2, 90, 59],
    [3, 76, 67],
    [4, 86, 62],
    [5, 62, 61],
  ] as const)
    m.place('post_' + i, x, y);
  m.place('cat_spot', 64, 59, "Nanny's nook", 2);
  for (const [x, y] of [
    [65, 62],
    [87, 59],
    [71, 71],
    [83, 70],
    [60, 96],
  ] as const)
    m.put('feather', x, y, { margin: 0 });
  m.place('herd_cat_1', 65, 59);
  m.place('herd_wolf_1', 152, 84);
  m.place('quarry_back', 96, 34, 'the back of the quarry', 2);
  m.place('lighthouse_rocks', 93, 106, 'the lighthouse rocks', 2);
  // Package 14 (side quests on the path): small builds she can see afterwards, and the places their steps name.
  site('den_roof', 'the den roof', 58, 69, 2, 2, { stick: 4 }, 'sq_alex_den', '', 60, 70);
  m.put('lantern', 58, 71, { id: 'den_lantern', if: { flag: 'site_den_roof' }, margin: 0 });
  m.place('square_apples', 72, 65, 'the apple tree');
  m.place('cafe_apples', 70, 57, 'the apple tree by the cafe');
  m.place('orange_shade', 99, 52, 'the orange trees');
  m.place('bay_race', 87, 102, 'the flags by the lookout');
  m.put('dig_spot', 81, 107, { id: 'dig_dad', d: 'emerald:5,toy_boat:1', if: { active: 'sq_dad_map' } });
  m.place('dad_x', 81, 108, 'the X on the sand', 2);
  site('jetty_mend', 'the jetty', 83, 106, 1, 1, { plank: 4 }, 'sq_dad_map', 'jetty_post', 83, 105);
  m.place('wool_2', 66, 62);
  m.place('wool_3', 68, 65);
  site('tea_table', 'the tea table', 81, 71, 2, 2, { plank: 6, stick: 2 }, 'sq_pad_marmalade', 'cafe_table', 83, 72);
  site('granny_crow', 'the scarecrow', 92, 66, 1, 1, { stick: 3, wheat: 3 }, 'sq_granny_soup', 'scarecrow', 92, 67);
  m.place('granny_crow', 92, 67, 'the scarecrow', 2);
  site('post_box', 'the parcel box', 96, 54, 1, 1, { plank: 4 }, 'sq_aunty_letters', 'crate', 96, 55);
  site('hog_home', 'the hedgehog home', 62, 71, 2, 1, { log: 2, stick: 4 }, 'sq_teacher_nature', 'log_hollow', 63, 70);
  site(
    'cafe_flowers',
    'the cafe flower pots',
    75,
    50,
    2,
    1,
    { flower_pink: 2, flower_yellow: 2 },
    'sq_mimmy_flowers',
    'flower_bed',
    75,
    51,
  );
  m.put('flower_bed', 76, 50, { id: 'cafe_flowers_2', if: { flag: 'site_cafe_flowers' }, margin: 0 });
  m.place('alien_spot', 67, 87, 'the star radar');
  m.place('coin_spot', 61, 83, 'the toy fort');
  m.put('chest', 98, 105, { id: 'chest_lighthouse', d: 'emerald:6,potato_arms:1' });
  m.place('pen_farm', 141, 52, 'the farm pen', 2.2);
  for (let x = 138; x <= 144; x++) {
    m.put('fence', x, 49, { margin: 0 });
    if (x !== 141) m.put('fence', x, 55, { margin: 0 });
  }
  for (let y = 50; y <= 54; y++) for (const x of [138, 144]) m.put('fence', x, y, { margin: 0 });
  m.keepRect(138, 49, 7, 8);
  m.put('game_post', 61, 8, { id: 'puddle_post', d: 'puddles' });
  // Two game posts on the grass by her home: friends and neighbours come here to play (home chapters).
  m.put('game_post', 84, 75, { id: 'home_hide_post', d: 'hide', if: { flag: 'day2' } });
  m.put('game_post', 87, 75, { id: 'home_keepy_post', d: 'keepy', if: { done: 'ch1' } });
  m.place('home_post', 85, 76, 'the game posts by your home', 2);
  // Slinky stretches over the gorge creek between Bing's Garden and Heeler Heights.
  let top = 999;
  let bottom = -1;
  for (let y = 82; y <= 92; y++)
    for (const x of [20, 21])
      if ('wW'.includes(m.get(x, y))) {
        m.set(x, y, 'b');
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
  m.barriers.push({
    id: 'slinky_gap',
    rect: { x: 20, y: top, w: 2, h: bottom - top + 1 },
    flag: 'slinky_bridge',
    hint: 'gate_slinky',
    art: 'water',
  });
  m.put('slinky_bridge', 20, top, { id: 'slinky_stretched', if: { flag: 'slinky_bridge' }, force: true, margin: 0 });
  m.place('slinky_gap', 20, bottom + 1, 'the Slinky bridge', 2);
  m.keepRect(18, top - 2, 6, bottom - top + 6);
}

function scatterAll(m: MapMaker): void {
  const inReg = (code: string, t: string) => (x: number, y: number) => m.region(x, y) === code && m.get(x, y) === t;
  const clump = (code: string, t: string, scale: number, cut: number, seed: number) => (x: number, y: number) =>
    m.region(x, y) === code && m.get(x, y) === t && noise(x / scale, y / scale, seed) > cut;
  // Gum Tree Grove: tall gums in drifts, with ordinary trees for wood
  m.scatter('gum_tree', 0.16, 101, clump('G', 'g', 5, 0.45, 61));
  m.scatter('oak', 0.03, 102, inReg('G', 'g'));
  m.scatter('fern', 0.03, 103, inReg('G', 'g'));
  m.scatter('mushroom', 0.006, 104, inReg('G', 'g'));
  m.scatter('flower_white', 0.01, 105, inReg('G', 'g'));
  m.scatter('stick_pile', 0.008, 106, inReg('G', 'g'));
  // Peppa's Hill
  m.scatter('oak', 0.035, 111, clump('P', 'g', 6, 0.5, 62));
  m.scatter('bush', 0.015, 112, inReg('P', 'g'));
  m.scatter('flower_yellow', 0.014, 113, inReg('P', 'g'));
  m.scatter('flower_pink', 0.01, 114, inReg('P', 'g'));
  m.scatter('stick_pile', 0.006, 115, inReg('P', 'g'));
  m.scatter('reeds', 0.035, 116, inReg('V', 'm'));
  // Bing's Garden
  m.scatter('oak', 0.05, 121, clump('B', 'g', 6, 0.55, 63));
  m.scatter('birch', 0.02, 122, clump('B', 'g', 5, 0.5, 64));
  m.scatter('bush', 0.02, 123, inReg('B', 'g'));
  m.scatter('flower_red', 0.012, 124, inReg('B', 'g'));
  m.scatter('flower_blue', 0.012, 125, inReg('B', 'g'));
  m.scatter('stick_pile', 0.007, 126, inReg('B', 'g'));
  m.scatter('feather', 0.003, 127, inReg('B', 'g'));
  // Wishing Square and Home Meadow: tidy, a few flowers, sticks to pick up
  m.scatter('flower_red', 0.008, 131, inReg('W', 'g'));
  m.scatter('flower_yellow', 0.008, 132, inReg('W', 'g'));
  m.scatter('bush', 0.01, 133, inReg('W', 'g'));
  m.scatter('oak', 0.03, 134, clump('H', 'g', 5, 0.55, 65));
  m.scatter('stick_pile', 0.012, 135, inReg('H', 'g'));
  m.scatter('flower_white', 0.01, 136, inReg('H', 'g'));
  m.scatter('flower_pink', 0.01, 137, inReg('H', 'g'));
  // Sandy Bay
  m.scatter('palm', 0.012, 141, inReg('S', 's'));
  m.scatter('shell_pink', 0.03, 142, inReg('S', 's'));
  m.scatter('shell_spiral', 0.008, 143, inReg('S', 's'));
  m.scatter('starfish', 0.005, 144, inReg('S', 's'));
  m.scatter('sea_glass', 0.004, 145, inReg('S', 's'));
  m.scatter('driftwood', 0.005, 146, inReg('S', 's'));
  // Heeler Heights
  m.scatter('oak', 0.04, 151, clump('U', 'g', 6, 0.5, 66));
  m.scatter('palm', 0.012, 152, inReg('U', 'g'));
  m.scatter('bush', 0.015, 153, inReg('U', 'g'));
  m.scatter('flower_red', 0.012, 154, inReg('U', 'g'));
  m.scatter('flower_yellow', 0.01, 155, inReg('U', 'g'));
  m.scatter('stick_pile', 0.007, 156, inReg('U', 'g'));
  // Blocky Plains
  m.scatter('block_oak', 0.014, 161, inReg('L', 'G'));
  m.scatter('sunflower_wild', 0.007, 162, inReg('L', 'G'));
  m.scatter('pumpkin_wild', 0.004, 163, inReg('L', 'G'));
  m.scatter('hay_bale', 0.003, 164, inReg('L', 'G'));
  m.scatter('pebble', 0.004, 165, inReg('L', 'G'));
  // Blocky Forest: dense, with winding gaps
  m.scatter('dark_oak', 0.3, 171, clump('F', 'd', 4.5, 0.42, 67));
  m.scatter('dark_oak', 0.04, 172, inReg('F', 'd'));
  m.scatter('mushroom', 0.012, 173, inReg('F', 'd'));
  m.scatter('web', 0.008, 174, inReg('F', 'd'));
  m.scatter('stick_pile', 0.008, 175, inReg('F', 'd'));
  m.scatter('pine_cone', 0.005, 176, inReg('F', 'd'));
  // Creeper Crater
  m.scatter('burnt_tree', 0.02, 181, inReg('C', 'a'));
  m.scatter('boulder', 0.012, 182, inReg('C', 'a'));
  m.scatter('lone_flower', 0.012, 183, inReg('C', 'a'));
  // Decoration baked into the ground
  m.scatter('grass_tuft', 0.05, 191, (x, y) => 'gGd'.includes(m.get(x, y)));
  void hash2;
}

/** Hidden things: long dogs, the lost joeys, bottles from Dad, X-marks, chests and cracked rocks. */
function secrets(m: MapMaker): void {
  const near = (x: number, y: number): [number, number] => {
    for (let r = 0; r < 6; r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          const tx = x + dx;
          const ty = y + dy;
          if (
            m.in(tx, ty) &&
            m.walk(tx, ty) &&
            !m.taken[ty * m.w + tx] &&
            m.get(tx, ty) !== 'b' &&
            m.get(tx, ty) !== 'e'
          )
            return [tx, ty];
        }
    throw new Error(`no free tile near ${x},${y}`);
  };
  const hide = (type: string, id: string, x: number, y: number, d: string) => {
    const [tx, ty] = near(x, y);
    m.put(type, tx, ty, { id, d, margin: 0 });
  };
  const dogs: [number, number][] = [
    [57, 94],
    [99, 49],
    [6, 50],
    [46, 82],
    [8, 112],
    [55, 18],
    [99, 38],
    [6, 8],
    [112, 84],
  ];
  // nine long dogs on the island; the tenth is in the Mine (tools/map/interiors.ts)
  dogs.forEach(([x, y], i) => hide('long_dog', 'long_dog_' + (i + 1), x, y, `sticker.longdog_${i + 1}:1`));
  const joeys: [number, number][] = [
    [96, 94],
    [44, 50],
    [5, 100],
    [99, 17],
    [156, 50],
  ];
  joeys.forEach(([x, y], i) =>
    hide('joey', 'joey_' + (i + 4), x, y, `sticker.joey_${i + 4}:1,flag.joey_${i + 4}:1,lost_joey:1`),
  );
  const bottles: [number, number][] = [
    [60, 106],
    [98, 106],
    [5, 60],
    [48, 114],
    [70, 5],
    [6, 38],
    [0, 0],
    [155, 84],
    [154, 20],
    [114, 114],
  ];
  bottles.forEach(([x, y], i) => {
    if (i === 6) return; // the seventh is on Treasure Island
    hide('bottle', 'bottle_' + (i + 1), x, y, 'bottle' + (i + 1));
  });
  hide('dig_spot', 'dig_bay', 92, 105, 'emerald:8,treasure_pearl:1,sticker.tr_pearl:1');
  hide('dig_spot', 'dig_bing', 44, 70, 'emerald:6,dino_green:1');
  hide('dig_spot', 'dig_plains', 156, 60, 'emerald:10,treasure_ring:1,sticker.tr_ring:1');
  hide('dig_spot', 'dig_gum', 6, 20, 'emerald:8,disc_gum:1');
  hide('chest', 'chest_ledge', 100, 72, 'emerald:5,toy_block:2');
  hide('chest', 'chest_heeler', 5, 116, 'emerald:8,dino_red:1');
  hide('chest', 'chest_forest', 155, 30, 'emerald:12,disc_forest:1,treasure_goblet:1,sticker.tr_goblet:1');
  hide('chest', 'chest_valley', 55, 6, 'emerald:8,potato_ears:1');
  hide('chest', 'chest_crater', 154, 92, 'emerald:15,treasure_gem:1,sticker.tr_gem:1');
  // Dad's treasure trail (package 44b, sq_dad_trail): five X marks in far corners, each there only at its own step.
  // Bing's west shore, the bay's west tip, the Grove's south shore, the Plains' far north-east, the Crater's far
  // south-east. Each gives a key piece (an item and a journal part) and a few emeralds.
  (
    [
      [6, 80],
      [58, 107],
      [22, 40],
      [154, 48],
      [150, 113],
    ] as const
  ).forEach(([x, y], i) => {
    const [tx, ty] = near(x, y);
    const last = i === 4 ? ',flag.dad_key:1' : '';
    m.put('dig_spot', tx, ty, {
      id: `trail_dig${i + 1}`,
      d: `key_piece:1,sticker.dadkey_${i + 1}:1,emerald:4${last}`,
      if: { atStep: ['sq_dad_trail', i, i] },
      margin: 0,
    });
    m.place(`trail_x${i + 1}`, tx, ty);
  });
  // Stuart's little guitar is dug out by the lighthouse rocks (package 44b, sq_stuart_uke step 2)
  const [ux, uy] = near(94, 107);
  m.put('dig_spot', ux, uy, { id: 'dig_uke', d: 'ukulele:1', if: { atStep: ['sq_stuart_uke', 1, 1] }, margin: 0 });
  m.place('uke_dig', ux, uy);
  // where two board jobs' mobs wait for her (package 44b: j_forest_mobs, j_crater_mobs)
  m.place('deep_forest', ...near(149, 28));
  m.place('crater_far', ...near(145, 111));
  // Cracked rocks: only a creeper's boom (or TNT) opens them. Each hides a chest in a pocket of the cliff.
  const pocket = (id: string, x: number, y: number, d: string) => {
    m.set(x, y, 'g');
    m.set(x, y + 1, 'g');
    m.put('chest', x, y, { id: 'chest_' + id, d, margin: 0 });
    m.put('cracked_rock', x, y + 1, { id: 'cracked_' + id, margin: 0 });
  };
  pocket('rim', 138, 88, 'emerald:10,potato_nose:1');
  // one tile west of the first spot: a dark oak stood on the only tile in front of the rock
  pocket('mine', 125, 8, 'emerald:10,disc_cave:1');
  pocket('falls', 99, 6, 'emerald:8,dino_yellow:1');
}

// ------------------------------------------------------------ package 44a: a wild stretch before each shard
// Each is a small piece of country built like a tiny dungeon from what the game has: walls she cannot pass (boulders,
// trees, the crater rim) and walls she can work through (rock with coal and iron, webs to cut, webs to shoot down),
// two fights, something for her gear and one landmark. Built last, so it clears the scatter in its own rectangle;
// a named thing (a joey, a bottle, a chest) that lands on a wall moves to the nearest open tile of the stretch.

/** Stamp a stretch: one row a line, one character a tile, from (x0, y0). '.' is open ground, ' ' is left alone. */
function stamp(m: MapMaker, x0: number, y0: number, rows: string[], legend: Record<string, string>, floor = ''): void {
  const w = Math.max(...rows.map((r) => r.length));
  const auto = new RegExp(`^${m.id[0]}_[a-z_]+_\\d+$`);
  const inside = (x: number, y: number) => {
    const ch = rows[y - y0]?.charAt(x - x0) ?? ' ';
    return ch !== ' ' && ch !== '';
  };
  const wall = (x: number, y: number) => {
    const ch = rows[y - y0]?.charAt(x - x0) ?? ' ';
    return ch !== ' ' && ch !== '' && ch !== '.';
  };
  // clear the scatter (and anything else without a name) inside the stamp
  const moved: MapObj[] = [];
  for (let i = m.objects.length - 1; i >= 0; i--) {
    const o = m.objects[i]!;
    if (!inside(o.x, o.y)) continue;
    if (auto.test(o.id)) {
      m.objects.splice(i, 1);
      m.taken[o.y * m.w + o.x] = 0;
    } else if (wall(o.x, o.y)) moved.push(o);
  }
  for (let j = 0; j < rows.length; j++)
    for (let i = 0; i < w; i++) {
      const ch = rows[j]!.charAt(i);
      const x = x0 + i;
      const y = y0 + j;
      if (ch === ' ' || ch === '') continue;
      if (floor && !m.walk(x, y)) m.set(x, y, floor);
      else if (floor && ch === '.') m.set(x, y, floor);
      m.taken[y * m.w + x] = 0;
      m.keepRect(x, y, 1, 1);
      if (ch === '.') continue;
      // package 47a: 'w' is water inside a stretch (a stream or a gully a bridge goes over)
      if (ch === 'w') {
        m.set(x, y, 'w');
        continue;
      }
      const type = legend[ch];
      if (!type) throw new Error(`map: stretch legend has no "${ch}"`);
      m.put(type, x, y, { margin: 0, force: true });
    }
  // Package 60: an open tile on the stretch's edge is a way in. The scatter (a tree, a bush) on the tiles just
  // outside it goes, or the way in is a pocket a held key cannot find (Bing's Garden had an oak each side of it).
  const way = (x: number, y: number) => rows[y - y0]?.charAt(x - x0) === '.';
  for (let i = m.objects.length - 1; i >= 0; i--) {
    const o = m.objects[i]!;
    const t = objects[o.type];
    if (inside(o.x, o.y) || !auto.test(o.id) || !t?.solid || !(t.node || o.type === 'bush' || o.type === 'boulder'))
      continue;
    let byWay = false;
    for (let dy = -1; dy <= 1 && !byWay; dy++)
      for (let dx = -1; dx <= 1 && !byWay; dx++) {
        const x = o.x + dx;
        const y = o.y + dy;
        if (!inside(x, y) || !way(x, y)) continue;
        // only a way in on the edge: one of its four sides is outside the stretch
        byWay = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
      }
    if (!byWay) continue;
    m.objects.splice(i, 1);
    m.taken[o.y * m.w + o.x] = 0;
  }
  // named things that were on a wall tile go to the nearest open tile inside
  for (const o of moved) {
    let best: [number, number] | null = null;
    for (let r = 1; r < 8 && !best; r++)
      for (let dy = -r; dy <= r && !best; dy++)
        for (let dx = -r; dx <= r && !best; dx++) {
          const x = o.x + dx;
          const y = o.y + dy;
          if (inside(x, y) && !wall(x, y) && !m.taken[y * m.w + x] && m.walk(x, y)) best = [x, y];
        }
    if (!best) throw new Error(`map: no room to move ${o.id} out of a stretch wall`);
    m.taken[o.y * m.w + o.x] = 0;
    o.x = best[0];
    o.y = best[1];
    m.taken[o.y * m.w + o.x] = 1;
  }
}

/** A stretch drawn on a blank sheet in map coordinates (' ' leaves the map alone), for stamp(). Package 47a. */
function sketch(x0: number, y0: number, w: number, h: number, fill = ' ') {
  const g = Array.from({ length: h }, () => Array<string>(w).fill(fill));
  const at = (x: number, y: number, ch: string) => {
    if (x < x0 || y < y0 || x >= x0 + w || y >= y0 + h) throw new Error(`map: sketch tile ${x},${y} is outside`);
    g[y - y0]![x - x0] = ch;
  };
  return {
    at,
    box(xa: number, ya: number, xb: number, yb: number, ch: string) {
      for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) at(x, y, ch);
    },
    rows: () => g.map((r) => r.join('')),
  };
}

/** A broken bridge inside a stretch, over its water: she mends it with what `needs` says once `plan` is set. */
function stretchBridge(
  m: MapMaker,
  id: string,
  name: string,
  x: number,
  y: number,
  needs: Record<string, number>,
  plan: string,
  at: { x: number; y: number },
): void {
  const rect = crossing(m, x, y, 2, 2);
  m.barriers.push({ id, rect, flag: 'site_' + id, hint: 'gate_ford', art: 'broken_bridge' });
  m.sites.push({ id, name, rect, needs, flag: 'site_' + id, if: { flag: plan }, at });
}

/** Move a named thing to a new tile (it keeps its id). */
function moveObj(m: MapMaker, id: string, x: number, y: number): void {
  const o = m.objects.find((q) => q.id === id);
  if (!o) return;
  m.taken[o.y * m.w + o.x] = 0;
  o.x = x;
  o.y = y;
  m.taken[o.y * m.w + o.x] = 1;
}

function wildStretches(m: MapMaker): void {
  // Chapter 3, Peppa's Hill: the quarry cave. In at the back of the quarry, a chamber of zombies with iron and coal
  // in the walls, George's glow, then (package 47a) a rock fall to mine through, a dark chamber to the west with an
  // underground stream and an old bridge to mend (a chest of planks beside it), and out at the top into Muddy Valley.
  // B boulder, R rock, C coal, I iron, S stalagmite, F rock fall, w the stream
  const cave = { B: 'boulder', R: 'rock', C: 'coal_rock', I: 'iron_rock', S: 'stalagmite', F: 'rock_fall' };
  // the note by the valley path stays outside the cave's new west chamber
  moveObj(m, 'note_puddle', 83, 15);
  const cv = sketch(84, 15, 17, 20);
  [
    'BBBBBBBBBBBB..BBB',
    'B..............IB',
    'B.......BBBBBBBBB',
    'BwwwwwwwBBBBBBBBB',
    'BwwwwwwwBS......B',
    'B...............B',
    'B...............B',
    'BBBBBBBBBBBFFBBBB',
  ].forEach((r, j) => {
    for (let i = 0; i < r.length; i++) cv.at(84 + i, 15 + j, r[i]!);
  });
  [
    'BS......B',
    'BS.....CB',
    'BS......B',
    'BS..RRRRB',
    'BB.....IB',
    'BBRRR...B',
    'BS......B',
    'BS......B',
    'BBI....CB',
    'BS..RRRRB',
    'BB......B',
    'BBBB..BBB',
  ].forEach((r, j) => {
    for (let i = 0; i < r.length; i++) cv.at(92 + i, 23 + j, r[i]!);
  });
  stamp(m, 84, 15, cv.rows(), cave, 't');
  stretchBridge(m, 'cave_bridge', 'the cave bridge', 87, 18, { plank: 4 }, 'cave_plan', { x: 87, y: 20 });
  m.put('chest', 85, 21, { id: 'chest_cave', d: 'plank:4,emerald:3', margin: 0 });
  // the open quarry outside keeps a few rocks for the cobblestone she mines first
  for (const [x, y] of [
    [89, 24],
    [91, 25],
    [88, 26],
    [90, 31],
    [88, 32],
  ] as const)
    if (m.free('rock', x, y)) m.put('rock', x, y, { margin: 0 });
  m.place('quarry_cave', 96, 33, 'the quarry cave', 2);
  m.place('cave_a', 96, 29, 'the first cave', 2.5);
  m.place('cave_fall', 96, 20, 'the rock fall', 1.5);
  m.place('cave_top', 97, 16, 'the top of the cave', 2);
  // the quarry's chest (its landmark find) sits in the first cave
  moveObj(m, 'chest_quarry', 99, 30);

  // Chapter 4, Gum Tree Grove: the web trail to the big rock (package 47a: four long lanes under the gum trees). Webs
  // to cut, a fallen gum tree to chop through with the stone axe, two webs hung too high for a sword (the new bow),
  // spiders at the mouth, a chest of arrows down the dead end beside it, and Nod to lead home all the way back.
  // T gum tree, W web (cut it), H high web (shoot it), O the big rock
  const trail = { T: 'gum_tree', W: 'web_wall', H: 'web_high', O: 'boulder' };
  for (let i = m.objects.length - 1; i >= 0; i--) {
    const o = m.objects[i]!;
    if (o.type === 'boulder' && o.x >= 9 && o.x <= 48 && o.y >= 27 && o.y <= 39) {
      m.taken[o.y * m.w + o.x] = 0;
      m.objects.splice(i, 1);
    }
  }
  const tr = sketch(9, 27, 40, 13, 'T');
  tr.box(33, 27, 34, 27, '.');
  for (const y of [28, 31, 34, 37]) tr.box(10, y, 47, y + 1, '.');
  tr.box(10, 30, 11, 30, '.');
  tr.box(46, 33, 47, 33, '.');
  tr.box(10, 36, 11, 36, '.');
  for (const x of [16, 24]) tr.box(x, 28, x, 29, 'W');
  for (const x of [22, 37]) tr.box(x, 34, x, 35, 'H');
  for (const [x, y] of [
    [29, 28],
    [20, 29],
    [20, 31],
    [32, 32],
    [40, 31],
    [15, 34],
    [30, 35],
    [43, 35],
    [18, 37],
    [28, 38],
    [36, 37],
  ] as const)
    tr.at(x, y, 'T');
  tr.at(47, 37, 'O');
  stamp(m, 9, 27, tr.rows(), trail);
  // the fallen gum tree closes the way down from the second lane (chop it with a stone axe)
  m.put('fallen_gum', 46, 32, { id: 'trail_gum', margin: 0, force: true });
  m.put('chest', 47, 28, { id: 'chest_webs', d: 'arrow:8,emerald:6', margin: 0 });
  // Nod sleeps by the big rock at the end of the trail
  const nod = m.places.herd_joey_3!;
  nod.x = 45;
  nod.y = 38;
  nod.r = 1.2; // story mobs land in her lane, not behind the trees in the one above
  m.place('web_trail', 33, 28, 'the web trail', 2);
  m.place('trail_spiders', 30, 28, 'the web trail', 1);
  m.place('trail_webs', 12, 31, 'the web trail', 1.5);
  m.place('trail_gum', 44, 35, 'the fallen gum tree', 1.5);

  // Chapter 5, the Blocky Plains: the far fields over the old ford. A brook from the crater rim to the sea fences in
  // the south-east corner; its bridge is broken and she mends it with planks she makes. Skeletons wait in the yard by
  // the ford; past it (package 47a) hedges, thorns to cut and a rock fall to mine, Bo Peep's sheep in the meadow at
  // the bottom with zombies after them, and a chest down the dead end in the middle.
  for (let y = 72; y <= 86; y++) for (const x of [145, 146]) if (m.walk(x, y)) m.set(x, y, 'w');
  for (let x = 145; x <= 155; x++) for (const y of [71, 72]) if (m.get(x, y) !== 'W') m.set(x, y, 'w');
  const ford = crossing(m, 145, 78, 2, 2);
  m.barriers.push({ id: 'ford_bridge', rect: ford, flag: 'site_ford_bridge', hint: 'gate_ford', art: 'broken_bridge' });
  m.sites.push({
    id: 'ford_bridge',
    name: 'the old bridge',
    rect: ford,
    needs: { plank: 12, stick: 4 },
    flag: 'site_ford_bridge',
    if: { flag: 'ford_plan' },
    at: { x: 144, y: 79 },
  });
  stamp(m, 143, 70, ['.............', '.............', '...............'], {});
  for (let y = 73; y <= 87; y++) stamp(m, 144, y, ['...'], {});
  // h hedge, % thorn bush, F rock fall
  stamp(
    m,
    147,
    73,
    [
      '.........',
      '.........',
      '%%%h.hh..',
      '...h..h..',
      '...h..h..',
      '...h..h..',
      '...h..h..',
      '...h..hFF',
      '...hhhh..',
      'hhhhhhh..',
      '.........',
      '.........',
      '.........',
      '.........',
    ],
    { h: 'hedge', '%': 'thorn_bush', F: 'rock_fall' },
  );
  m.place('ford', 143, 79, 'the old ford', 2);
  m.place('ford_far', 148, 79, 'the far fields', 1.2); // the guards stand in the yard, not in the pocket behind the hedge
  m.place('far_fields', 151, 84, 'the far fields', 3);
  m.put('chest', 152, 77, { id: 'chest_ford', d: 'iron_ingot:2,arrow:6,emerald:6', margin: 0 });
  // Bo Peep's sheep graze in the meadow at the bottom: more of them wander in there when a pen needs them
  for (const [i, x, y] of [
    [1, 150, 84],
    [2, 153, 85],
    [3, 148, 85],
    [4, 154, 83],
  ] as const) {
    const p = m.places['herd_sheep_' + i]!;
    p.x = x;
    p.y = y;
  }
  // the hens stay on the open plains, north of the brook
  for (const [i, x, y] of [
    [1, 150, 58],
    [2, 153, 61],
    [3, 148, 63],
    [4, 154, 65],
  ] as const) {
    const p = m.places['herd_chicken_' + i]!;
    p.x = x;
    p.y = y;
  }

  // Chapter 7, Creeper Crater: the way down the rocky drop to the diamonds (package 47a: five ledges). The rim rock
  // makes each ledge; one gap leads down to the next. A guard on each of the first three, a web over the second gap
  // (an arrow brings it down), a cracked boulder in the third (the iron pickaxe breaks it), two diamonds on the fourth,
  // the crater chest on the first, and a cracked rock at the bottom she breaks to get back out.
  // R rim rock, D diamond, G gold, K cracked rock, H high web
  const ledges = { R: 'rim_rock', D: 'diamond_rock', G: 'gold_rock', K: 'cracked_rock', H: 'web_high' };
  stamp(
    m,
    147,
    90,
    [
      'RRRRRRRR',
      '.......R',
      '.......R',
      'RG..D..R',
      'RRRRR..R',
      'R......R',
      'R..R...R',
      'R......R',
      'R..G...R',
      'RHHRRRRR',
      'R......R',
      'R...R..R',
      'R......R',
      'R.G....R',
      'RRRRR..R',
      'R......R',
      'R...D..R',
      'R......R',
      'R.D....R',
      'R..RRRRR',
      'R......R',
      'R...R..R',
      'K......R',
      'R......R',
      'RRRRRRRR',
    ],
    ledges,
  );
  // the cracked boulder across the third gap
  m.put('boulder_wall', 152, 103, { id: 'drop_crack', margin: 0, force: true });
  // the diamonds of the Crater are on the ledges now
  for (let i = m.objects.length - 1; i >= 0; i--) {
    const o = m.objects[i]!;
    if (o.type === 'diamond_rock' && m.region(o.x, o.y) === 'C' && (o.x < 147 || o.y > 114)) m.objects.splice(i, 1);
  }
  m.place('ledges_top', 145, 92, 'the rocky drop', 2);
  m.place('ledge_1', 151, 92, 'the top of the drop', 2.5);
  m.place('ledge_2', 151, 97, 'the middle of the drop', 2.5);
  m.place('ledge_web', 149, 100, 'the web over the drop', 1.5);
  m.place('ledge_3', 151, 102, 'the bottom of the drop', 2.5);
  m.place('ledge_crack', 149, 106, 'the diamond ledge', 1.5);
  m.place('ledges_out', 145, 112, 'the way out', 2);

  // Package 47a, chapter 1, Heeler Heights: the creek bush. Over the creek from the backyard, a winding way through
  // the bushes: a thorn bush to cut, a gully to lay logs over (oaks beside it for the axe), a zombie by the string,
  // and a chest down the dead end at the start. b bush, T oak, % thorn bush, w the gully
  stamp(
    m,
    37,
    103,
    [
      'bbbbbbb..bbbbbb',
      'b.............b',
      'b.............b',
      'bbbbbbbbbbbb..b',
      'b........%....b',
      'b........%....b',
      'b..TTTbwwbbbbbb',
      'b......ww.....b',
      'b......ww.....b',
      'bbbbbbbwwbbbbbb',
    ],
    { b: 'bush', T: 'oak', '%': 'thorn_bush' },
  );
  stretchBridge(m, 'bush_bridge', 'the log bridge', 44, 110, { log: 4 }, 'bush_plan', { x: 43, y: 110 });
  m.put('chest', 38, 104, { id: 'chest_bush', d: 'emerald:3,cookie:1', margin: 0 });
  m.place('bush_in', 44, 104, 'the creek bush', 2);
  m.place('bush_end', 49, 111, 'the creek bush', 1.5);

  // Package 47a, chapter 2, Bing's Garden: the long grass. Hoppity's footprints wind through three long lanes of
  // hedges north of the path: a thorn bush in two of them, a zombie in the first, out at the west end by the swings.
  // h hedge, % thorn bush, f footprints
  const lg = sketch(18, 48, 32, 10, 'h');
  for (const y of [49, 52, 55]) lg.box(19, y, 48, y + 1, '.');
  lg.box(49, 49, 49, 50, '.');
  lg.box(19, 51, 20, 51, '.');
  lg.box(47, 54, 48, 54, '.');
  lg.box(19, 57, 20, 57, '.');
  lg.box(34, 49, 34, 50, '%');
  lg.box(30, 55, 30, 56, '%');
  for (const [x, y] of [
    [26, 49],
    [41, 50],
    [24, 53],
    [38, 52],
    [44, 53],
    [40, 55],
    [24, 56],
  ] as const)
    lg.at(x, y, 'h');
  for (const [x, y] of [
    [45, 50],
    [37, 49],
    [29, 50],
    [21, 49],
    [27, 52],
    [42, 53],
    [44, 56],
    [35, 55],
    [22, 55],
  ] as const)
    lg.at(x, y, 'f');
  stamp(m, 18, 48, lg.rows(), { h: 'hedge', '%': 'thorn_bush', f: 'footprints' });
  m.place('grass_in', 47, 49, 'the long grass', 2);
  m.place('grass_mid', 36, 49, 'the long grass', 1.2);
  m.place('grass_out', 19, 56, 'the long grass', 1.5);
}

/** A crossing over the water inside a rectangle (a smaller copy of the one at the top, for the ford). */
function crossing(m: MapMaker, x: number, y: number, w: number, h: number) {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) m.set(x + i, y + j, 'b');
  m.keepRect(x - 1, y - 1, w + 2, h + 2);
  return { x, y, w, h };
}

/**
 * Package 47b: ten island projects. Each is a build site that shows while its board job is taken (quest 'p_<id>'),
 * is paid in things she gathers and crafts, and stays built for good (flag 'site_<id>'). Before the scatter, so
 * nothing grows on them. Four of them change the ground: the footbridge, the pond jetty, the raft and the cove steps.
 */
function islandProjects(m: MapMaker): void {
  const site = (id: string, name: string, r: Rect, needs: Record<string, number>, ax: number, ay: number) => {
    m.sites.push({ id, name, rect: r, needs, flag: 'site_' + id, if: { active: 'p_' + id }, at: { x: ax, y: ay } });
    m.keepRect(r.x - 1, r.y - 1, r.w + 2, r.h + 3);
  };
  const built = (type: string, x: number, y: number, id: string, site: string, d?: string) =>
    m.put(type, x, y, { id, if: { flag: 'site_' + site }, margin: 0, d });
  /** water tiles in the box become planks behind a broken-bridge gap until the site is built */
  const span = (id: string, x0: number, y0: number, x1: number, y1: number): Rect => {
    let a = 999;
    let b = 999;
    let c = -1;
    let d = -1;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++)
        if ('wWq'.includes(m.get(x, y))) {
          m.set(x, y, 'b');
          a = Math.min(a, x);
          b = Math.min(b, y);
          c = Math.max(c, x);
          d = Math.max(d, y);
        }
    const r = { x: a, y: b, w: c - a + 1, h: d - b + 1 };
    m.barriers.push({ id, rect: r, flag: 'site_' + id, hint: 'gate_project', art: 'broken_bridge' });
    return r;
  };

  // Home Meadow: a well by the cottage
  site('well', 'the well', { x: 66, y: 73, w: 2, h: 2 }, { cobblestone: 10, plank: 4 }, 68, 74);
  built('well', 66, 73, 'built_well', 'well');
  // the river west of home: a footbridge to Bing's pond, a short cut
  const fb = span('footbridge', 51, 79, 57, 80);
  site('footbridge', 'the little bridge', fb, { plank: 10, stick: 6 }, fb.x + fb.w, fb.y);
  // Bing's pond: a jetty to fish from, an old crab pot at its end
  const jt = span('jetty', 41, 77, 43, 77);
  site('jetty', 'the jetty', jt, { plank: 8, log: 4, string: 2 }, jt.x + jt.w, jt.y);
  m.put('chest', jt.x, jt.y, { id: 'chest_jetty', d: 'emerald:8,pond_carp:1,goldfish:1', margin: 0 });
  // Heeler Heights: a row of lamps along the creek path keeps the night free of mobs there (flag lit:heeler)
  site('lamps', 'the lamp row', { x: 28, y: 98, w: 1, h: 1 }, { lantern: 3, iron_ingot: 2 }, 28, 99);
  for (const [i, x] of [16, 22, 28, 40, 46].entries()) built('lamp_post', x, 98, 'built_lamp_' + i, 'lamps');
  // Peppa's Hill: a bench with a view over Muddy Valley, and a spot for a photo
  site('bench', 'the view bench', { x: 70, y: 17, w: 3, h: 1 }, { plank: 6, cobblestone: 6 }, 71, 18);
  built('garden_bench', 70, 17, 'built_bench', 'bench');
  built('photo_spot', 71, 18, 'built_bench_photo', 'bench');
  m.place('view_bench', 71, 18, 'the view bench', 2);
  // Gum Tree Grove: a little cove under a cliff on the north shore; steps down to it, a chest inside
  for (let x = 20; x <= 28; x++) m.set(x, 4, 's');
  for (let x = 23; x <= 25; x++) m.set(x, 3, 's');
  for (let x = 19; x <= 29; x++) m.set(x, 5, x === 24 ? 'e' : 'c');
  m.set(19, 4, 'c');
  m.set(29, 4, 'c');
  m.barriers.push({ id: 'cove', rect: { x: 24, y: 5, w: 1, h: 1 }, flag: 'site_cove', hint: 'gate_project' });
  site('cove', 'the beach steps', { x: 24, y: 5, w: 1, h: 1 }, { cobblestone: 12, plank: 6, torch: 2 }, 24, 6);
  m.put('chest', 24, 3, { id: 'chest_cove', d: 'diamond:2,emerald:15', margin: 0 });
  m.place('cove', 24, 4, 'the hidden beach', 2);
  m.keepRect(18, 2, 13, 6);
  // Blocky Plains: the old mill by the cows, mended, sells bread
  site('mill', 'the old mill', { x: 152, y: 56, w: 3, h: 2 }, { plank: 12, wool: 4, iron_ingot: 2 }, 153, 58);
  built('windmill', 152, 56, 'built_mill', 'mill', 'mill');
  // the river between the quarry and the forest: a raft crossing, a short cut into the forest
  const rf = span('raft', 100, 36, 106, 37);
  site('raft', 'the raft', rf, { log: 10, string: 6 }, rf.x - 1, rf.y);
  // by the Mine: a beacon on the hill, a lookout with a fire
  site('beacon', 'the lookout', { x: 116, y: 6, w: 3, h: 3 }, { cobblestone: 16, coal: 8, iron_ingot: 3 }, 117, 9);
  built('lookout', 116, 6, 'built_beacon', 'beacon');
  built('campfire', 120, 8, 'built_beacon_fire', 'beacon');
  // Wishing Square: a bandstand for the party
  site('bandstand', 'the party stage', { x: 70, y: 66, w: 6, h: 2 }, { plank: 12, glass: 4, gold_ingot: 2 }, 72, 68);
  built('bandstand', 70, 66, 'built_bandstand', 'bandstand');
  // Sandy Bay: Dad's fish board by his jetty, once she has a rod (no talk: the view shows the ten fish)
  m.put('fish_board', 83, 103, { id: 'fish_board', d: 'fishboard', if: { done: 'ch4' }, margin: 0 });
  // Toy Box Corner, by Hamm's prize counter: the cup shelf, from day 2 (the day the first cups can open)
  m.put('cup_shelf', 57, 75, { id: 'cup_shelf', d: 'cups', if: { day: 2 }, margin: 0 });
}
