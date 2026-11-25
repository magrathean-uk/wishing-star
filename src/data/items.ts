// Every item in the game. Names are simple and the same everywhere (reading rules, design section 8).
import type { ItemDef, ItemKind, PlaceDef, StickerPage, ToolType } from '../core/types.ts';

const I: Record<string, ItemDef> = {};
function it(id: string, name: string, kind: ItemKind, extra: Partial<ItemDef> = {}): void {
  I[id] = { id, name, kind, ...extra };
}
const mat = (id: string, name: string, sell = 0, extra: Partial<ItemDef> = {}) =>
  it(id, name, 'material', { sell: sell || undefined, ...extra });
const tool = (id: string, name: string, type: ToolType, tier: number) =>
  it(id, name, 'tool', { tool: { type, tier }, pouch: true, stack: 1 });
const key = (id: string, name: string, extra: Partial<ItemDef> = {}) => it(id, name, 'key', { pouch: true, ...extra });
const food = (
  id: string,
  name: string,
  heal: number,
  sell: number,
  page: StickerPage | undefined = 'food',
  extra: Partial<ItemDef> = {},
) => it(id, name, 'food', { heal, sell, page, ...extra });
const find = (id: string, name: string, page: StickerPage, sell = 1, extra: Partial<ItemDef> = {}) =>
  it(id, name, 'find', { page, sell, ...extra });
const block = (id: string, name: string, place: PlaceDef, extra: Partial<ItemDef> = {}) =>
  it(id, name, 'block', { place, ...extra });
const furn = (id: string, name: string, place: Partial<PlaceDef> = {}, extra: Partial<ItemDef> = {}) =>
  it(id, name, 'furniture', { place: { layer: 'object', solid: true, ...place }, ...extra });
const wall: PlaceDef = { layer: 'object', solid: true };
const floor: PlaceDef = { layer: 'floor' };

// ---- materials
mat('log', 'log', 1);
mat('plank', 'plank', 0, { place: wall, desc: 'Wood for making things. You can build walls with it too.' });
mat('stick', 'stick');
mat('cobblestone', 'cobblestone', 1, { names: 'cobblestone', gloss: true, page: 'ores', place: wall });
mat('coal', 'coal', 2, { names: 'coal', page: 'ores' });
mat('iron_ore', 'iron ore', 2, { names: 'iron ore', page: 'ores' });
mat('iron_ingot', 'iron bar', 4);
mat('gold_ore', 'gold ore', 4, { names: 'gold ore', page: 'ores' });
mat('gold_ingot', 'gold bar', 8);
mat('diamond', 'diamond', 12, { page: 'ores' });
mat('sand', 'sand', 0, { names: 'sand', place: floor });
mat('glass', 'glass', 1, { names: 'glass', place: wall });
mat('wool', 'wool', 2, { names: 'wool', place: wall });
mat('string', 'string', 1, { names: 'string' });
mat('gunpowder', 'gunpowder', 2, { names: 'gunpowder', gloss: true });
mat('bone', 'bone', 1);
mat('arrow', 'arrow', 1);
mat('rotten_flesh', 'zombie crumb', 1);
mat('ender_pearl', 'ender pearl', 15);
mat('feather', 'feather', 1, { page: 'beach' });
mat('gum_leaf', 'gum leaf', 0, { names: 'gum leaves' });
mat('star_fragment', 'star bit', 5, { page: 'ores' });
mat('sugar', 'sugar', 1, { names: 'sugar' });
mat('snowball', 'snowball');
mat('pine_cone', 'pine cone', 1, { page: 'beach' });
mat('ticket', 'prize ticket', 0);
mat('ladder', 'ladder', 0, { place: { layer: 'object', solid: false } });
mat('torch', 'torch', 0, { names: 'torches', place: { layer: 'object', solid: false, light: 3.5 } });
mat('emerald', 'emerald', 0, { page: 'ores' });
mat('tnt', 'TNT', 0, { names: 'TNT' });

// ---- tools (they never break) and things she wears
const TIERS: [string, string][] = [
  ['wood', 'wooden'],
  ['stone', 'stone'],
  ['iron', 'iron'],
  ['diamond', 'diamond'],
];
TIERS.forEach(([id, name], i) => {
  tool(`${id}_sword`, `${name} sword`, 'sword', i + 1);
  tool(`${id}_axe`, `${name} axe`, 'axe', i + 1);
  tool(`${id}_pick`, `${name} pickaxe`, 'pick', i + 1);
  if (i < 3) tool(`${id}_spade`, `${name} spade`, 'spade', i + 1);
});
tool('fishing_rod', 'fishing rod', 'rod', 1);
tool('bucket', 'bucket', 'bucket', 1);
tool('wellies', 'wellies', 'wellies', 1);
tool('boat', 'boat', 'boat', 1);
I.wellies!.names = 'wellies';

// ---- story things (they live in the pouch and cannot be lost)
key('shard', 'star shard');
key('dads_map', "Dad's map");
key('sticker_book', 'Sticker Book');
key('parcel', 'parcel');
key('toy_bunny', 'toy bunny');
key('hoppity', 'Hoppity');
key('glasses', 'glasses', { names: 'glasses' });
key('teddy', 'teddy');
key('wishing_star', 'the Wishing Star');
key('poppy', 'poppy', { page: 'flowers', names: 'poppies' });
key('balloon', 'red balloon');
key('bridge_plan', 'bridge plan');
key('hat_parcel', 'hat box');
key('space_part', 'rocket part');
key('lasso', 'lasso');
key('george_dino', 'toy dinosaur');
key('jumpers', 'tiny jumpers', { names: 'tiny jumpers' });
key('ukulele', 'little guitar');
key('fossil', 'fossil');
key('lost_joey', 'lost joey');
for (const [id, name] of [
  ['potato_ears', 'toy ears'],
  ['potato_nose', 'toy nose'],
  ['potato_hat', 'toy hat'],
  ['potato_eyes', 'toy eyes'],
  ['potato_arms', 'toy arms'],
] as const)
  key(id, name, { page: 'potato', names: name });

// ---- food and crops
food('apple', 'apple', 2, 1);
food('orange', 'orange', 2, 1);
food('banana', 'banana', 2, 1);
food('carrot', 'carrot', 2, 2);
food('bread', 'bread', 4, 3, 'food', { names: 'bread' });
food('cake', 'cake', 8, 10);
food('carrot_cake', 'carrot cake', 6, 8);
food('apple_pie', 'apple pie', 6, 7);
food('marmalade', 'marmalade', 4, 6, 'food', { names: 'marmalade', gloss: true });
food('egg', 'egg', 1, 2);
food('milk', 'milk', 2, 3, 'food', { names: 'milk' });
food('mushroom', 'mushroom', 1, 1, 'beach');
food('cookie', 'cookie', 3, 2, undefined);
food('hot_chocolate', 'hot chocolate', 5, 4, undefined);
it('wheat', 'wheat', 'crop', { sell: 2, page: 'food', names: 'wheat' });
it('pumpkin', 'pumpkin', 'crop', { sell: 4, page: 'food' });
it('sunflower', 'sunflower', 'crop', { sell: 2, page: 'flowers' });
it('sugar_cane', 'sugar cane', 'crop', { sell: 1, page: 'food', names: 'sugar cane' });
it('carrot_seed', 'carrot seed', 'seed', { grows: { crop: 'carrot', days: 1, n: 2 } });
it('wheat_seed', 'wheat seed', 'seed', { grows: { crop: 'wheat', days: 1, n: 3 } });
it('pumpkin_seed', 'pumpkin seed', 'seed', { grows: { crop: 'pumpkin', days: 2, n: 1 } });
it('sunflower_seed', 'sunflower seed', 'seed', { grows: { crop: 'sunflower', days: 1, n: 2 } });
it('cane_seed', 'sugar cane seed', 'seed', { grows: { crop: 'sugar_cane', days: 2, n: 3 } });

// ---- fish (ten kinds, by water and time of day)
for (const [id, name, sell] of [
  ['sardine', 'sardine', 2],
  ['mackerel', 'mackerel', 3],
  ['puffer_fish', 'puffer fish', 6],
  ['moon_jelly', 'moon jelly', 7],
  ['trout', 'trout', 3],
  ['minnow', 'minnow', 2],
  ['salmon', 'salmon', 5],
  ['goldfish', 'goldfish', 4],
  ['pond_carp', 'pond carp', 4],
  ['glow_fish', 'glow fish', 9],
] as const)
  it(id, name, 'fish', { sell, page: 'fish', heal: 2, names: name });

// ---- finds
find('shell_pink', 'pink shell', 'beach');
find('shell_spiral', 'spiral shell', 'beach', 2);
find('starfish', 'starfish', 'beach', 2, { names: 'starfish' });
find('sea_glass', 'sea glass', 'beach', 3, { names: 'sea glass' });
find('driftwood', 'driftwood', 'beach', 1, { names: 'driftwood' });
find('pebble', 'smooth pebble', 'beach', 1);
find('flower_red', 'red flower', 'flowers');
find('flower_yellow', 'yellow flower', 'flowers');
find('flower_blue', 'blue flower', 'flowers');
find('flower_white', 'white flower', 'flowers');
find('flower_pink', 'pink flower', 'flowers');
for (const [id, name] of [
  ['dino_red', 'red dinosaur'],
  ['dino_green', 'green dinosaur'],
  ['dino_yellow', 'yellow dinosaur'],
  ['dino_blue', 'blue dinosaur'],
  ['dino_purple', 'purple dinosaur'],
] as const)
  it(id, name, 'toy', { page: 'dinos', place: { layer: 'object', solid: false, use: 'toy' } });
for (const [id, name] of [
  ['disc_gum', 'gum tree disc'],
  ['disc_forest', 'forest disc'],
  ['disc_cave', 'cave disc'],
  ['disc_water', 'waterfall disc'],
  ['disc_star', 'star disc'],
] as const)
  it(id, name, 'disc', { page: 'discs', pouch: true });
for (const [id, name, sell] of [
  ['treasure_crown', 'tiny crown', 30],
  ['treasure_coin', 'old coin', 12],
  ['treasure_pearl', 'pearl', 15],
  ['treasure_ring', 'gold ring', 18],
  ['treasure_goblet', 'silver cup', 20],
  ['treasure_gem', 'red gem', 25],
  ['treasure_shell', 'rainbow shell', 15],
] as const)
  it(id, name, 'find', { sell });

// ---- building blocks (walls stand, floors lie flat)
block('wall_log', 'log wall', wall);
block('wall_brick', 'stone brick wall', wall);
block('wall_sandstone', 'sand brick wall', wall);
for (const [id, name] of [
  ['wool_red', 'red wool'],
  ['wool_blue', 'blue wool'],
  ['wool_yellow', 'yellow wool'],
  ['wool_green', 'green wool'],
  ['wool_pink', 'pink wool'],
  ['wool_purple', 'purple wool'],
] as const)
  block(id, name, wall, { names: name });
block('floor_wood', 'wood floor', floor, { names: 'wood floor' });
block('floor_stone', 'stone floor', floor, { names: 'stone floor' });
block('floor_brick', 'brick floor', floor, { names: 'brick floor' });
block('path_gravel', 'gravel path', floor, { names: 'gravel path' });
block('path_stone', 'stone path', floor, { names: 'stone path' });
block('carpet_red', 'red carpet', floor);
block('carpet_blue', 'blue carpet', floor);
block('fence', 'fence', { layer: 'object', solid: true, use: 'fence' });
block('gate', 'gate', { layer: 'object', solid: false, use: 'gate' });
block('farmland', 'soil', { layer: 'floor', use: 'soil', where: 'plot' }, { names: 'soil' });
block('hay_block', 'hay bale', wall);
block('hedge_block', 'hedge', wall);
block('snow_block', 'snow block', wall);
block('jack_lantern', "jack o'lantern", { layer: 'object', solid: true, light: 3.5 });
block('lantern', 'lantern', { layer: 'object', solid: true, light: 4 });
block('campfire', 'campfire', { layer: 'object', solid: true, light: 4.5, where: 'plot' });

// ---- furniture and decorations
furn('crafting_table', 'crafting table', { use: 'table' }, { gloss: true });
furn('furnace', 'furnace', { use: 'furnace', light: 2.5 }, { gloss: true });
furn('chest', 'chest', { use: 'chest' });
furn('bed', 'bed', { use: 'bed', w: 1, h: 2, where: 'house' });
furn('table', 'table');
furn('chair', 'chair', { solid: false, use: 'seat', rot: true });
furn('rug', 'rug', { layer: 'floor', solid: false, w: 2, h: 2 });
furn('lamp', 'lamp', { light: 4 });
furn('bookshelf', 'bookshelf');
furn('flower_pot', 'flower pot', { solid: false });
furn('painting_star', 'star painting', { solid: false, where: 'house' });
furn('painting_sea', 'sea painting', { solid: false, where: 'house' });
furn('jukebox', 'jukebox', { use: 'jukebox' });
furn('sign_item', 'sign', { use: 'sign' });
furn('swing', 'swing', { w: 2, h: 1, where: 'plot' });
furn('sandpit', 'sandpit', { layer: 'floor', solid: false, w: 2, h: 2, where: 'plot' });
furn('pool', 'paddling pool', { w: 2, h: 2, where: 'plot' });
furn('kennel_item', 'kennel', { w: 2, h: 1, where: 'plot' });
furn('scarecrow_item', 'scarecrow', { where: 'plot' });
furn('well_item', 'well', { w: 2, h: 2, where: 'plot' });
furn('bench', 'bench', { solid: false, w: 2, h: 1, use: 'seat' });
furn('koala_statue', 'koala statue');
furn('xmas_tree', 'Christmas tree', { light: 4 });
furn('snowman_item', 'snowman', { where: 'plot' });
furn('fairy_string', 'fairy lights', { solid: false, light: 3 }, { names: 'fairy lights' });
furn('creeper_plush', 'creeper plush', { solid: false, use: 'toy' });
furn('toy_block', 'toy block', { use: 'toy' });
furn('toy_train', 'toy train', { solid: false, use: 'toy' });
furn('toy_robot', 'toy robot', { solid: false, use: 'toy' });
furn('toy_rocket', 'toy rocket', { solid: false, use: 'toy' });
furn('alien_plush', 'little green alien', { solid: false, use: 'toy' });
furn('toy_drum', 'toy drum', { solid: false, use: 'toy' });
furn('toy_boat', 'toy boat', { solid: false, use: 'toy' });
furn('spooky_lantern', 'spooky lantern', { light: 4 });
furn('purple_rug', 'purple rug', { layer: 'floor', solid: false, w: 2, h: 2 });
furn('bat_bunting', 'bat bunting', { solid: false }, { names: 'bat bunting' });
furn('black_pot', 'black pot');
furn('cat_sofa', 'cat sofa', { w: 2, h: 1, use: 'seat', solid: false });
furn('cat_bed', 'cat bed', { solid: false });
furn('rainbow_rug', 'rainbow rug', { layer: 'floor', solid: false, w: 2, h: 2 });
furn('cupcake_table', 'cupcake table');
furn('mermaid_fountain', 'mermaid fountain', { w: 2, h: 2, where: 'plot' });
furn('star_lamp', 'star lamp', { light: 5 });
furn('poppy_vase', 'poppy vase', { solid: false });
furn('trophy_star', 'star trophy', { solid: false });
furn('rocket_item', 'star rocket', { solid: false, where: 'plot' });
furn('mirror_item', 'mirror', { use: 'mirror', where: 'house' });
furn('snow_golem', 'snow golem', { where: 'plot' });
furn('photo_frame', 'party photo', { solid: false, where: 'house' });

// ---- phase 2: new items go at the very end, never in between (item pictures are cut from this order in sheets of 16)
tool('bow', 'bow', 'bow', 1);
I.bow!.desc = 'Press X to shoot. Arrows hurt mobs only.';
// Gear (phase 2, part D, package 31): leather comes from scraps zombies drop, never from an animal.
// Armour is worn, never lost (it lives in the pouch); shield is the blue hearts it gives.
mat('leather_scrap', 'leather scrap', 1);
mat('leather', 'leather', 2, { names: 'leather' });
const armour = (id: string, name: string, type: 'helmet' | 'armour', tier: number, shield: number) =>
  it(id, name, 'tool', { tool: { type, tier }, pouch: true, stack: 1, shield });
armour('leather_helmet', 'leather helmet', 'helmet', 1, 1);
armour('leather_armour', 'leather armour', 'armour', 1, 1);
armour('iron_helmet', 'iron helmet', 'helmet', 2, 1);
armour('iron_armour', 'iron armour', 'armour', 2, 2);
armour('diamond_helmet', 'diamond helmet', 'helmet', 3, 2);
armour('diamond_armour', 'diamond armour', 'armour', 3, 2);
for (const id of ['leather_armour', 'iron_armour', 'diamond_armour']) I[id]!.names = I[id]!.name;
furn('anvil', 'anvil', { use: 'anvil', where: 'house' });
furn('armour_stand', 'armour stand', { use: 'stand', where: 'house' });
// furniture for her kitchen (step 4): food made beside it comes out double (src/core/craft.ts)
furn('cooking_pot', 'cooking pot', { use: 'pot', where: 'house' });
I.leather_helmet!.desc = 'Gives 1 blue heart.';
I.leather_armour!.desc = 'Gives 1 blue heart.';
I.iron_helmet!.desc = 'Gives 1 blue heart.';
I.iron_armour!.desc = 'Gives 2 blue hearts.';
I.diamond_helmet!.desc = 'Gives 2 blue hearts.';
I.diamond_armour!.desc = 'Gives 2 blue hearts.';
I.anvil!.desc = 'Make your sword or bow stronger here.';
I.cooking_pot!.desc = 'Food you cook here comes out double.';

// package 51: what each X of Dad's treasure trail gives (the five open his chest on Treasure Island)
key('key_piece', 'key piece', { names: 'key pieces' });
// package 70: the secret show after the credits (Rumi's lost mic; the light sticks Mira asks for)
key('mic', 'mic');
mat('light_stick', 'light stick', 1);

export const items = I;
