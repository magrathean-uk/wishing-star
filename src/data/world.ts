// Regions, mobs, animals, fish and shop stalls.
import type { AnimalDef, DenDef, FishDef, LandmarkDef, MobDef, RegionDef, StallDef } from '../core/types.ts';

export const regions: Record<string, RegionDef> = {
  home: { id: 'home', code: 'H', name: 'Home Meadow', sign: 'home', safe: true, music: 'home' },
  square: { id: 'square', code: 'W', name: 'Wishing Square', sign: 'square', safe: true, music: 'square' },
  bay: { id: 'bay', code: 'S', name: 'Sandy Bay', sign: 'bay', safe: true, music: 'bay' },
  treasure: { id: 'treasure', code: 'T', name: 'Treasure Island', safe: true, music: 'treasure' },
  heeler: { id: 'heeler', code: 'U', name: 'Heeler Heights', sign: 'heeler', shard: 1, music: 'heeler' },
  bing: { id: 'bing', code: 'B', name: "Bing's Garden", sign: 'bing', shard: 2, music: 'bing' },
  peppa: { id: 'peppa', code: 'P', name: "Peppa's Hill", sign: 'peppa', shard: 3, music: 'peppa' },
  valley: { id: 'valley', code: 'V', name: 'Muddy Valley', shard: 3, music: 'valley' },
  gum: { id: 'gum', code: 'G', name: 'Gum Tree Grove', sign: 'gum', shard: 4, music: 'gum' },
  plains: {
    id: 'plains',
    code: 'L',
    name: 'the Blocky Plains',
    sign: 'plains',
    shard: 5,
    blocky: true,
    music: 'plains',
    tough: 6,
  },
  forest: {
    id: 'forest',
    code: 'F',
    name: 'the Blocky Forest',
    sign: 'forest',
    shard: 6,
    blocky: true,
    music: 'forest',
    tough: 8,
  },
  crater: {
    id: 'crater',
    code: 'C',
    name: 'Creeper Crater',
    sign: 'crater',
    shard: 7,
    blocky: true,
    music: 'crater',
    tough: 12,
  },
  mine: { id: 'mine', code: 'M', name: 'the Mine', blocky: true, music: 'cave', tough: 8 },
  hall: { id: 'hall', code: 'K', name: "the King's Hall", blocky: true, music: 'hall', tough: 12 },
  indoors: { id: 'indoors', code: 'I', name: 'your cottage', safe: true, music: 'cottage' },
};

const y = (item: string, min: number, max = min, p?: number) => ({ item, min, max, p });
export const mobs: Record<string, MobDef> = {
  zombie: {
    id: 'zombie',
    name: 'zombie',
    hp: 3,
    speed: 1.55,
    touch: 2,
    ai: 'chase',
    // leather scraps feed her first armour (phase 2, part D)
    drops: [y('leather_scrap', 2, 3), y('rotten_flesh', 1, 1, 0.4)],
    role: 'hostile',
    body: 'biped',
    sfx: 'groan',
  },
  creeper: {
    id: 'creeper',
    name: 'creeper',
    hp: 3,
    // it comes at her (phase 2, part E): she walks at 4.5, so she can still always get away
    speed: 2.3,
    touch: 4,
    ai: 'creeper',
    drops: [y('gunpowder', 1, 2)],
    role: 'hostile',
    body: 'blob',
    sfx: 'hiss',
  },
  skeleton: {
    id: 'skeleton',
    name: 'skeleton',
    hp: 3,
    speed: 1.9,
    touch: 2,
    ai: 'ranged',
    drops: [y('bone', 1, 2), y('arrow', 2, 3)],
    role: 'hostile',
    body: 'biped',
    sfx: 'rattle',
  },
  spider: {
    id: 'spider',
    name: 'spider',
    hp: 2,
    speed: 3,
    touch: 2,
    ai: 'hopper',
    drops: [y('string', 1, 2)],
    role: 'hostile',
    body: 'spider',
    dayFriendly: true,
    tall: 1.1,
    sfx: 'skitter',
  },
  enderman: {
    id: 'enderman',
    name: 'enderman',
    hp: 6,
    speed: 1.4,
    touch: 3,
    ai: 'ender',
    drops: [y('ender_pearl', 1)],
    role: 'hostile',
    body: 'biped',
    tall: 3,
    sfx: 'blink',
  },
  mini_creeper: {
    id: 'mini_creeper',
    name: 'little creeper',
    hp: 1,
    speed: 2.2,
    touch: 2,
    ai: 'mini',
    drops: [],
    role: 'hostile',
    body: 'blob',
    tall: 1.2,
    sfx: 'hiss',
  },
  spider_jockey: {
    id: 'spider_jockey',
    name: 'Spider Jockey',
    hp: 6,
    speed: 2.3,
    touch: 2,
    ai: 'jockey',
    drops: [],
    role: 'boss',
    body: 'spider',
    tall: 2.6,
    sfx: 'rattle',
  },
  creeper_king: {
    id: 'creeper_king',
    name: 'Creeper King',
    hp: 9,
    speed: 0,
    touch: 4,
    ai: 'king',
    drops: [],
    role: 'boss',
    body: 'blob',
    tall: 4,
    sfx: 'hiss',
  },
};

export const animals: Record<string, AnimalDef> = {
  chicken: {
    id: 'chicken',
    name: 'chicken',
    food: 'wheat_seed',
    gives: { item: 'egg' },
    body: 'bird',
    tall: 1,
    sfx: 'cluck',
  },
  pig: { id: 'pig', name: 'pig', food: 'carrot', body: 'quad', tall: 1.2, sfx: 'oink' },
  cow: {
    id: 'cow',
    name: 'cow',
    food: 'wheat',
    gives: { item: 'milk', needs: 'bucket' },
    body: 'quad',
    tall: 1.5,
    sfx: 'moo',
  },
  sheep: { id: 'sheep', name: 'sheep', food: 'wheat', gives: { item: 'wool' }, body: 'quad', tall: 1.3, sfx: 'baa' },
  joey: { id: 'joey', name: 'joey', food: 'gum_leaf', body: 'biped', tall: 0.9, sfx: 'squeak' },
  duck: { id: 'duck', name: 'duck', food: 'bread', body: 'bird', tall: 0.9, sfx: 'quack' },
  wolf: { id: 'wolf', name: 'wolf', food: 'bone', body: 'quad', tall: 1.2, sfx: 'woof' },
  cat: { id: 'cat', name: 'cat', food: 'sardine', body: 'quad', tall: 1, sfx: 'meow' },
  llama: { id: 'llama', name: 'llama', food: 'hay_block', body: 'quad', tall: 1.8, sfx: 'hum' },
};
(animals.sheep as AnimalDef & { names?: string }).names = 'sheep';

export const fish: Record<string, FishDef> = {
  sardine: { id: 'sardine', water: ['sea'], weight: 5 },
  mackerel: { id: 'mackerel', water: ['sea'], weight: 3 },
  puffer_fish: { id: 'puffer_fish', water: ['sea'], time: 'night', weight: 4 },
  moon_jelly: { id: 'moon_jelly', water: ['sea'], time: 'night', weight: 2 },
  trout: { id: 'trout', water: ['river'], weight: 5 },
  minnow: { id: 'minnow', water: ['river', 'pond'], weight: 4 },
  salmon: { id: 'salmon', water: ['river'], time: 'night', weight: 4 },
  goldfish: { id: 'goldfish', water: ['pond'], weight: 4 },
  pond_carp: { id: 'pond_carp', water: ['pond'], weight: 3 },
  glow_fish: { id: 'glow_fish', water: ['cave'], weight: 5 },
};

export const stalls: Record<string, StallDef> = {
  shop: {
    id: 'shop',
    name: 'the shop stall',
    keeper: 'trader',
    buys: true,
    sells: [
      { item: 'chest', price: 6, recipe: 'chest' },
      { item: 'gate', price: 5, recipe: 'gate' },
      { item: 'table', price: 4, recipe: 'table' },
      { item: 'chair', price: 4, recipe: 'chair' },
      { item: 'bookshelf', price: 6, recipe: 'bookshelf' },
      { item: 'lamp', price: 8, recipe: 'lamp', if: { shards: 3 } },
      { item: 'bench', price: 5, recipe: 'bench' },
      { item: 'sign_item', price: 3, recipe: 'sign_item' },
      { item: 'floor_wood', price: 4, recipe: 'floor_wood' },
      { item: 'path_gravel', price: 4, recipe: 'path_gravel', if: { shards: 3 } },
      { item: 'wall_log', price: 4, recipe: 'wall_log' },
      { item: 'path_stone', price: 4, recipe: 'path_stone', if: { shards: 3 } },
      { item: 'campfire', price: 6, recipe: 'campfire', if: { shards: 3 } },
      { item: 'well_item', price: 10, recipe: 'well_item', if: { shards: 5 } },
      // furniture for her gear and her kitchen (package 31; step 4 may move where they are taught)
      { item: 'armour_stand', price: 6, recipe: 'armour_stand', if: { shards: 5 } },
      { item: 'cooking_pot', price: 6, recipe: 'cooking_pot', if: { shards: 4 } },
      { item: 'bucket', price: 12, stock: 1, if: { shards: 4 } },
      { item: 'torch', price: 2, stock: 8, if: { shards: 3 } },
    ],
  },
  seeds: {
    id: 'seeds',
    name: "Granny's seed stall",
    keeper: 'granny',
    buys: true,
    sells: [
      { item: 'wheat_seed', price: 1, if: { flag: 'seeds_open' } },
      { item: 'carrot_seed', price: 1, if: { flag: 'seeds_open' } },
      { item: 'sunflower_seed', price: 2, if: { flag: 'seeds_open' } },
      { item: 'pumpkin_seed', price: 3, if: { flag: 'seeds_open' } },
      { item: 'cane_seed', price: 3, if: { flag: 'seeds_open' } },
      { item: 'scarecrow_item', price: 8, recipe: 'scarecrow_item', if: { shards: 2 } },
      { item: 'hay_block', price: 4, recipe: 'hay_block', if: { shards: 2 } },
      { item: 'hedge_block', price: 4, recipe: 'hedge_block', if: { shards: 4 } },
    ],
  },
  cafe: {
    id: 'cafe',
    name: 'the Apple Cafe',
    keeper: 'hello_kitty',
    buys: true,
    sells: [
      { item: 'cookie', price: 2, stock: 4 },
      { item: 'apple_pie', price: 6, stock: 2 },
      { item: 'hot_chocolate', price: 4, stock: 3, if: { christmas: true } },
      { item: 'cookie', price: 5, recipe: 'cookie' },
      { item: 'bread', price: 5, recipe: 'bread', if: { shards: 2 } },
      { item: 'carrot_cake', price: 8, recipe: 'carrot_cake', if: { shards: 2 } },
      { item: 'cake', price: 12, recipe: 'cake', if: { shards: 5 } },
      { item: 'hot_chocolate', price: 6, recipe: 'hot_chocolate', if: { shards: 5 } },
    ],
  },
  kuromi: {
    id: 'kuromi',
    name: "Kuromi's night stall",
    keeper: 'kuromi',
    sells: [
      { item: 'spooky_lantern', price: 10, stock: 1 },
      { item: 'purple_rug', price: 8, stock: 1 },
      { item: 'bat_bunting', price: 6, stock: 2 },
      { item: 'black_pot', price: 9, stock: 1 },
      { item: 'jack_lantern', price: 8, recipe: 'jack_lantern' },
      { item: 'creeper_plush', price: 10, recipe: 'creeper_plush' },
      { item: 'wool_purple', price: 5, recipe: 'wool_purple' },
    ],
  },
  village: {
    id: 'village',
    name: 'the village stall',
    keeper: 'villager_trader',
    buys: true,
    sells: [
      { item: 'bucket', price: 10, stock: 1 },
      { item: 'wool', price: 3, stock: 6 },
      { item: 'coal', price: 2, stock: 8 },
      { item: 'iron_ingot', price: 6, stock: 3 },
      { item: 'lantern', price: 10, recipe: 'lantern' },
      { item: 'wall_brick', price: 6, recipe: 'wall_brick' },
      { item: 'floor_stone', price: 5, recipe: 'floor_stone' },
      { item: 'floor_brick', price: 5, recipe: 'floor_brick' },
      { item: 'wall_sandstone', price: 5, recipe: 'wall_sandstone' },
      { item: 'jukebox', price: 20, recipe: 'jukebox', if: { shards: 6 } },
    ],
  },
  nook: {
    id: 'nook',
    name: "Nanny's knitting nook",
    keeper: 'nanny',
    buys: true,
    sells: [
      { item: 'rug', price: 5, recipe: 'rug' },
      { item: 'wool_red', price: 3, recipe: 'wool_red' },
      { item: 'wool_blue', price: 3, recipe: 'wool_blue' },
      { item: 'wool_yellow', price: 3, recipe: 'wool_yellow' },
      { item: 'wool_green', price: 3, recipe: 'wool_green' },
      { item: 'wool_pink', price: 3, recipe: 'wool_pink' },
      { item: 'carpet_red', price: 4, recipe: 'carpet_red', if: { shards: 2 } },
      { item: 'carpet_blue', price: 4, recipe: 'carpet_blue', if: { shards: 2 } },
    ],
  },
  dollhouse: {
    id: 'dollhouse',
    name: "Gabby's Dollhouse",
    keeper: 'gabby',
    sells: [
      { item: 'cat_bed', price: 8, stock: 1, if: { shards: 3 } },
      { item: 'rainbow_rug', price: 10, stock: 1, if: { shards: 3 } },
      { item: 'cupcake_table', price: 12, stock: 1, if: { shards: 4 } },
      { item: 'cat_sofa', price: 14, stock: 1, if: { shards: 5 } },
      { item: 'mermaid_fountain', price: 25, stock: 1, if: { shards: 6 } },
      { item: 'flower_pot', price: 4, recipe: 'flower_pot' },
      { item: 'painting_star', price: 6, recipe: 'painting_star' },
      { item: 'painting_sea', price: 6, recipe: 'painting_sea' },
      { item: 'mirror_item', price: 8, recipe: 'mirror_item' },
    ],
  },
  prizes: {
    id: 'prizes',
    name: "Hamm's prize counter",
    keeper: 'hamm',
    sells: [
      { item: 'dino_purple', price: 3, stock: 1, once: true },
      { item: 'trophy_star', price: 6, stock: 1, once: true },
      { item: 'star_lamp', price: 5, stock: 1, once: true },
      { item: 'disc_star', price: 8, stock: 1, once: true },
      { item: 'potato_eyes', price: 4, stock: 1, once: true },
      { item: 'koala_statue', price: 4, stock: 1, once: true },
    ],
  },
  trader: {
    id: 'trader',
    name: 'the wandering trader',
    keeper: 'wandering_trader',
    sells: [
      { item: 'star_fragment', price: 6, stock: 2 },
      { item: 'diamond', price: 15, stock: 1 },
      { item: 'ender_pearl', price: 12, stock: 1 },
      { item: 'xmas_tree', price: 12, recipe: 'xmas_tree' },
      { item: 'fairy_string', price: 8, recipe: 'fairy_string' },
    ],
  }, // package 47b: Dad's fish board by his jetty; the view draws its own page for it, nothing is sold
  fishboard: { id: 'fishboard', name: 'the fish board', keeper: 'dad', sells: [] },
  // package 47b: the cup shelf at Toy Box Corner shows the eight games and the cups she has won; nothing is sold
  cups: { id: 'cups', name: 'the cup shelf', keeper: 'hamm', sells: [] },
  // package 47b: the old mill in the Blocky Plains, once she has mended it (a board project)
  mill: {
    id: 'mill',
    name: 'the mill',
    keeper: 'villager_trader',
    sells: [
      { item: 'bread', price: 2 },
      { item: 'cake', price: 6 },
      { item: 'wheat_seed', price: 1 },
    ],
  },
};

// ---- landmarks (package 41): with the 15 regions they are the places of her journal. She finds one within 3 tiles
// of its spot (or by walking into its area). Each has one small find: a chest or a note beside it (map objects in
// tools/map/island.ts), or a view (a line shown under the goal, at most 12 words).
const lm = (
  id: string,
  name: string,
  art: string,
  at: string,
  find: LandmarkDef['find'],
  more: Partial<LandmarkDef> = {},
) => ({
  id,
  name,
  art,
  at,
  find,
  ...more,
});
export const landmarks: Record<string, LandmarkDef> = Object.fromEntries(
  [
    lm('great_tree', 'the Great Tree', 'great_tree', 'great_tree', {
      kind: 'view',
      line: 'The Great Tree is older than anyone on the island.',
    }),
    lm('toybox', 'Toy Box Corner', 'blanket_fort', 'toybox', { kind: 'note', obj: 'note_toybox' }),
    lm('lighthouse', 'the lighthouse', 'lighthouse', 'lighthouse', { kind: 'chest', obj: 'chest_lighthouse' }),
    lm(
      'lookout',
      "Dad's lookout",
      'lookout',
      'dad_lookout',
      { kind: 'view', line: 'You can see the whole bay from up here.' },
      { r: 4 },
    ),
    lm('heeler_house', 'the Heeler house', 'heeler_house', 'bandit', { kind: 'chest', obj: 'chest_heeler_yard' }),
    lm('bing_house', "Bing's house", 'bing_house', 'flop', { kind: 'view', line: 'Bing waves from the window.' }),
    lm('playground', 'the playground', 'rocket_slide', 'playground', { kind: 'chest', obj: 'chest_playground' }),
    lm('peppa_house', "Peppa's house", 'peppa_house', 'mummy_pig', {
      kind: 'view',
      line: 'A little house on top of a big hill.',
    }),
    lm('big_puddle', 'the biggest puddle', 'big_puddle', 'big_puddle', { kind: 'note', obj: 'note_puddle' }),
    // package 44a: a landmark in each wild stretch, in place of three she could never miss (the koala tree, the
    // village well and the King's garden), so the journal stays at 60
    lm('web_trail', 'the web trail', 'web', 'web_trail', { kind: 'chest', obj: 'chest_webs' }),
    lm('ford', 'the old ford', 'jetty_post', 'ford_far', { kind: 'chest', obj: 'chest_ford' }),
    lm('waterfall', 'the waterfall', 'waterfall', 'waterfall', {
      kind: 'view',
      line: 'Listen. Is there a cave behind the water?',
    }),
    lm(
      'cave',
      'the secret cave',
      'crystal',
      '',
      { kind: 'view', line: 'The crystals glow all by themselves.' },
      { area: 'cave' },
    ),
    lm('ledges', 'the rocky drop', 'diamond_rock', 'ledge_1', { kind: 'chest', obj: 'chest_crater' }),
    lm(
      'deep_cave',
      'the deepest cave',
      'stalagmite',
      '',
      { kind: 'view', line: 'This is as deep as anyone has ever been.' },
      { area: 'mine3' },
    ),
    lm('banana_grove', 'the banana grove', 'banana_stand', 'banana_grove', { kind: 'chest', obj: 'chest_bananas' }),
    lm('quarry', 'the quarry cave', 'boulder', 'cave_a', { kind: 'chest', obj: 'chest_quarry' }),
  ].map((d) => [d.id, d]),
);

// ---- the four mob dens (package 41): two short waves, then a chest. Health follows the region.
export const dens: Record<string, DenDef> = {
  plains: {
    id: 'plains',
    name: 'the plains den',
    at: 'den_plains',
    region: 'plains',
    r: 4,
    waves: [
      ['zombie', 'zombie'],
      ['skeleton', 'zombie', 'creeper'],
    ],
    chest: 'emerald:12,iron_ingot:3',
  },
  forest: {
    id: 'forest',
    name: 'the forest den',
    at: 'den_forest',
    region: 'forest',
    r: 4,
    waves: [
      ['zombie', 'skeleton'],
      ['skeleton', 'skeleton', 'zombie'],
    ],
    chest: 'emerald:15,lamp:1',
  },
  mine: {
    id: 'mine',
    name: "the den on the Mine's hill",
    at: 'den_mine',
    region: 'forest',
    r: 4,
    waves: [
      ['zombie', 'zombie', 'skeleton'],
      ['creeper', 'zombie', 'skeleton'],
    ],
    chest: 'diamond:1,emerald:10',
  },
  crater: {
    id: 'crater',
    name: 'the crater den',
    at: 'den_crater',
    region: 'crater',
    r: 4,
    waves: [
      ['zombie', 'skeleton', 'zombie'],
      ['creeper', 'skeleton', 'zombie', 'zombie'],
    ],
    chest: 'diamond:2,emerald:20,trophy_star:1',
  },
};

/**
 * Package 78: places (keys in an area's `places`) whose label is not somewhere a child would say someone "is at":
 * a person or an animal, or a thing lying about (marks, tracks, webs, a hole, rocks, a door). joys.ts skips them when
 * it names the nearest place to a friend ("Bluey is at the playground."); the next nearest label is used instead.
 */
export const whereSkip: string[] = [
  // people and animals
  'pen_koala', // Mama Koala
  'heeler_dog', // the long dog
  'king', // the Creeper King
  'granny_crow', // the scarecrow
  // things lying about
  'tally_marks', // the scorch marks
  'practice_sign', // the wobbly sign
  'dad_x', // the X on the sand
  'trail_1', // the round tracks
  'quarry_hole', // the hole in the quarry
  'rex_puddle', // the little puddle
  'crater_gold', // the gold rocks
  'crater_gems', // the shiny rocks
  'ledge_web', // the web over the drop
  'cart_webs', // the webs in the tunnel
  'nest', // the nest
  // parts of a room or a way through
  'mirror',
  'bed',
  'mine_iron',
  'fossil_spot',
  'mine_down_1',
  'mine_down_2',
  'ledges_out',
  'lighthouse_up',
  'keeper_down',
  'keeper_up',
  'lamp_down',
  'cottage_exit',
  // every other room's door
  'workshop_in_exit',
  'heeler_in_exit',
  'peppa_in_exit',
  'bing_in_exit',
  'village_in_exit',
  'cafe_in_exit',
  'doll_in_exit',
  'post_in_exit',
  'nook_in_exit',
  'school_in_exit',
  'green_in_exit',
  'lookout_in_exit',
  'lighthouse_in_exit',
  'tree_in_exit',
  'vh1_in_exit',
  'vh3_in_exit',
  'vh4_in_exit',
  'beacon_in_exit',
  'mill_in_exit',
];
