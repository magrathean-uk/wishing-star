// Everything that stands in the world. Art ids default to the type id; the art manifest lists the same ids.
import type { Interact, ObjectType, ToolType, YieldDef } from '../core/types.ts';

const T: Record<string, ObjectType> = {};
const y = (item: string, min: number, max = min, p?: number): YieldDef => ({ item, min, max, p });
function o(id: string, w = 1, h = 1, solid = true, extra: Partial<ObjectType> = {}): void {
  T[id] = { id, w, h, solid, ...extra };
}
function node(
  id: string,
  verb: string,
  tool: ToolType | undefined,
  tier: number,
  hits: number,
  yields: YieldDef[],
  extra: Partial<ObjectType> & { regrow?: boolean; stump?: boolean; sfx?: string } = {},
): void {
  const { regrow = true, stump = false, sfx, ...rest } = extra;
  T[id] = { id, w: 1, h: 1, solid: true, ...rest, node: { tool, tier, hits, yield: yields, regrow, stump, verb, sfx } };
}
const use = (id: string, interact: Interact, w = 1, h = 1, solid = true, extra: Partial<ObjectType> = {}) =>
  o(id, w, h, solid, { interact, ...extra });
const decor = (id: string, extra: Partial<ObjectType> = {}) => o(id, 1, 1, false, { flat: true, ...extra });

// ---- trees and wood
for (const t of ['oak', 'pine', 'palm', 'dark_oak', 'block_oak', 'birch'])
  node(t, 'chop', 'axe', 1, 3, [y('log', 2, 3), y('stick', 1, 1, 0.5)], {
    stump: true,
    frames: 2,
    winter: t === 'oak' || t === 'pine' || t === 'birch',
  });
node('gum_tree', 'shake', undefined, 0, 1, [y('gum_leaf', 2, 3)], { stump: true, frames: 2, sfx: 'rustle' });
node('apple_tree', 'shake', undefined, 0, 1, [y('apple', 2, 3)], { stump: true, frames: 2, sfx: 'rustle' });
node('orange_tree', 'shake', undefined, 0, 1, [y('orange', 2, 3)], { stump: true, frames: 2, sfx: 'rustle' });
node('banana_tree', 'shake', undefined, 0, 1, [y('banana', 2, 3)], { stump: true, frames: 2, sfx: 'rustle' });
node('stick_pile', 'pick', undefined, 0, 1, [y('stick', 2, 3)], { solid: false, sfx: 'pickup' });
node('thorn_bush', 'cut', 'sword', 1, 2, [y('stick', 1, 2)], { regrow: false, sfx: 'rustle' });
node('fallen_gum', 'chop', 'axe', 2, 6, [y('log', 6, 8)], { regrow: false, w: 2, h: 3 });
node('web', 'cut', 'sword', 1, 1, [y('string', 1, 2)], { solid: false, sfx: 'rustle' });
// Package 44a, the wild stretches: a web across the way (cut it) and one hung too high for a sword (shoot it down)
node('web_wall', 'cut', 'sword', 1, 2, [y('string', 1, 2)], { regrow: false, sfx: 'rustle', art: 'web', name: 'web' });
node('web_high', 'shoot', 'bow', 1, 1, [y('string', 1, 1)], {
  regrow: false,
  sfx: 'rustle',
  art: 'web',
  name: 'high web',
});

// ---- rock and ore
node('rock', 'mine', 'pick', 1, 3, [y('cobblestone', 2, 3)], { sfx: 'mine' });
node('coal_rock', 'mine', 'pick', 2, 3, [y('coal', 2, 3), y('cobblestone', 1)], { sfx: 'mine' });
node('iron_rock', 'mine', 'pick', 2, 4, [y('iron_ore', 2, 3)], { sfx: 'mine' });
node('gold_rock', 'mine', 'pick', 3, 4, [y('gold_ore', 2, 2)], { sfx: 'mine' });
node('diamond_rock', 'mine', 'pick', 3, 5, [y('diamond', 1, 2)], { sfx: 'mine' });
node('boulder_wall', 'mine', 'pick', 3, 5, [y('cobblestone', 4, 6)], {
  regrow: false,
  w: 2,
  h: 3,
  sfx: 'mine',
  cracked: true,
});
// A cracked rock breaks to a creeper's pop or TNT, and (builder's decision, 18 Nov) to an iron pickaxe in 6 hits,
// so no hidden pocket depends on luring a creeper.
node('cracked_rock', 'mine', 'pick', 3, 6, [y('cobblestone', 1, 2)], { regrow: false, sfx: 'mine', cracked: true });
// Package 47a: loose rock fallen across a way in a wild stretch; any pickaxe clears it for good (rock's own picture)
node('rock_fall', 'mine', 'pick', 1, 4, [y('cobblestone', 1, 2)], { regrow: false, sfx: 'mine', art: 'rock' });
o('boulder');
// the ring round a mob den (package 41): standing stones she can see from a screen away
o('den_stone', 1, 1, true, { art: 'boulder', name: 'standing stone' });
o('stalagmite');
o('crystal', 1, 1, true, { light: 2.5 });

// ---- things to pick up by hand (they grow back each morning)
for (const f of ['flower_red', 'flower_yellow', 'flower_blue', 'flower_white', 'flower_pink', 'sunflower_wild'])
  node(f, 'pick', undefined, 0, 1, [y(f === 'sunflower_wild' ? 'sunflower' : f, 1)], {
    solid: false,
    sfx: 'pickup',
    frames: 2,
  });
for (const f of [
  'shell_pink',
  'shell_spiral',
  'starfish',
  'sea_glass',
  'driftwood',
  'feather',
  'mushroom',
  'pumpkin_wild',
  'wheat_wild',
  'pine_cone',
  'pebble',
])
  node(f, 'pick', undefined, 0, 1, [y(f.replace('_wild', ''), 1)], { solid: false, sfx: 'pickup' });
node('snow_pile', 'dig', 'spade', 1, 1, [y('snowball', 2, 3)], { solid: false, sfx: 'dig' });

// ---- plants and scenery
o('bush', 1, 1, true, { frames: 2, winter: true });
o('hedge');
o('reeds', 1, 1, false, { frames: 2 });
o('fern', 1, 1, false);
o('lily', 1, 1, false, { flat: true, frames: 2 });
o('burnt_tree');
o('cactus_pot');
use('hay_bale', 'fun', 1, 1, true, { fun: { move: 'sit', at: [0.5, 0.62] } });
o('barrel');
o('crate');
use('scarecrow', 'fun', 1, 1, true, { fun: { move: 'wave' } });
use('log_hollow', 'fun', 2, 1, true, { fun: { move: 'peek' } });
use('tree_stump', 'fun', 1, 1, true, { fun: { move: 'sit', at: [0.5, 0.6] } });
decor('grass_tuft', { frames: 2 });
decor('scorch');
decor('lone_flower');
decor('flower_bed');
use('picnic_blanket', 'fun', 2, 2, false, { flat: true, fun: { move: 'sit', at: [0.65, 1.25], mate: [1.4, 1.25] } });
decor('rail');
decor('rail_curve');
decor('toy_track');
decor('footprints');
decor('chalk_hopscotch', { w: 1, h: 3 });
use('puddle', 'fun', 1, 1, false, { flat: true, fun: { move: 'splash', at: [0.5, 0.55] } });
use('big_puddle', 'fun', 5, 4, false, { flat: true, fun: { move: 'splash', at: [2.2, 2], mate: [2.9, 2.1] } });
use('fairy_ring', 'fun', 3, 3, false, { flat: true, fun: { move: 'dance', at: [1.2, 1.6], mate: [1.9, 1.6] } });
decor('x_mark');

// ---- fences, walls, lights
o('fence');
o('fence_post');
o('plot_fence');
o('stone_wall');
o('rim_rock');
o('pillar', 1, 1, true);
o('lamp_post', 1, 1, true, { light: 4.5, winter: true });
o('lantern', 1, 1, true, { light: 3.5 });
use('campfire', 'fun', 1, 1, true, { light: 4, frames: 3, fun: { move: 'warm' } });
o('torch_stand', 1, 1, true, { light: 3.5, frames: 2 });
o('fairy_lights', 3, 1, false, { light: 3, frames: 2 });
// a string of lanterns and bunting on two posts, drawn by the view (src/game/world/things.ts); its lanterns glow at night
o('lantern_string', 6, 1, false, { light: 2 });
o('pond_lantern', 1, 1, false, { light: 3, frames: 2 });

// ---- buildings (the door tile is on the map, in front of the bottom row)
const house = (id: string, w: number, h: number, extra: Partial<ObjectType> = {}) =>
  o(id, w, h, true, { light: 4, winter: true, ...extra });
house('cottage', 5, 4);
house('workshop', 5, 4);
house('post_office', 5, 4);
house('school', 6, 4);
house('cafe', 5, 4);
house('dollhouse', 5, 4);
house('nanny_nook', 4, 3);
house('greenhouse', 4, 3);
house('heeler_house', 6, 4);
house('bing_house', 5, 4);
house('peppa_house', 4, 4);
house('treehouse', 4, 4);
house('villager_house_a', 4, 4, { winter: false });
house('villager_house_b', 4, 4, { winter: false });
house('lighthouse', 3, 4, { light: 7 });
house('lookout', 3, 3);
o('great_tree', 5, 5, true, { frames: 2, winter: true, light: 0 });
o('great_tree_lit', 5, 5, true, { frames: 2, winter: true, light: 9 });
o('poinciana', 4, 4, true, { frames: 2 });
o('mine_mouth', 4, 3);
o('hall_gate', 4, 3);
o('waterfall', 4, 5, true, { frames: 3 });
o('cliff_face', 2, 2);
use('cardboard_fort', 'fun', 4, 3, true, { fun: { move: 'hide', at: [1.7, 2.55], mate: [2.4, 2.55] } });
use('alphabet_blocks', 'fun', 2, 2, true, { fun: { move: 'stack' } });
use('toy_train', 'fun', 2, 1, true, { frames: 2, fun: { move: 'ride', at: [1.55, 0.5], mate: [0.72, 0.45] } });
use('rocket_slide', 'fun', 2, 3, true, { fun: { move: 'slide', at: [0.62, 1.66], to: [2.4, 2.85] } });
use('swing_set', 'fun', 3, 2, true, { frames: 2, fun: { move: 'swing', at: [1.04, 1.62], mate: [2.0, 1.62] } });
use('slide', 'fun', 2, 3, true, { fun: { move: 'slide', at: [0.62, 1.66], to: [2.4, 2.85] } });
use('sandbox', 'fun', 3, 3, false, { flat: true, fun: { move: 'pat', at: [1.1, 1.75], mate: [1.95, 1.75] } });
use('seesaw', 'fun', 3, 1, true, { fun: { move: 'seesaw', at: [0.72, 0.32], mate: [2.28, 0.32] } });
use('paddling_pool', 'fun', 3, 2, true, { fun: { move: 'splash', at: [1.1, 1.2], mate: [1.9, 1.2] } });
use('kennel', 'fun', 2, 2, true, { fun: { move: 'peek' } });
// the mat's middle is 0.66 down the picture's two tiles: feet a touch in front of it, so the top of a bounce stays on the mat
use('trampoline', 'fun', 3, 2, true, { fun: { move: 'bounce', at: [1.08, 0.84], mate: [1.92, 0.84] } });
o('veranda', 6, 1, false, { flat: true });
o('market_awning', 3, 2);
o('cafe_table', 2, 2);
o('jetty_post');
o('boat_wreck', 3, 2);
use('throne', 'fun', 3, 2, true, { fun: { move: 'sit', at: [1.5, 1.45] } });
o('creeper_statue', 1, 2);
use('snowman', 'fun', 1, 1, true, { frames: 2, fun: { move: 'wave' } });
o('ladder_up', 1, 1, false);
o('den', 2, 2);
use('blanket_fort', 'fun', 3, 2, true, { fun: { move: 'hide', at: [1.2, 1.6], mate: [1.85, 1.6] } });
o('banana_stand', 3, 2);
use('garden_bench', 'fun', 3, 1, true, { fun: { move: 'sit', at: [1.05, 0.72], mate: [1.95, 0.72] } });
o('slinky_bridge', 2, 5, false, { flat: true });
use('game_post', 'play');
o('xmas_arch', 3, 1, false, { light: 3 });

// ---- things to use
use('signpost', 'signpost');
use('sign', 'sign');
use('mailbox', 'mailbox');
use('mirror', 'mirror');
use('bed_fixed', 'bed', 1, 2);
use('workbench', 'table', 2, 1);
use('big_furnace', 'furnace', 2, 2, true, { light: 3, frames: 2 });
use('noticeboard', 'board', 2, 1);
// a picture board at the way into a tough region: the sword and armour that suit it (d: two item ids), no words
o('gear_board', 2, 1, true, { art: 'noticeboard', name: 'gear sign' });
use('bounty_board', 'bounty', 2, 1);
// package 47b: Dad's fish board at his jetty (the view opens its own page for the stall id 'fishboard')
use('fish_board', 'stall', 2, 1, true, { art: 'noticeboard', name: 'fish board' });
// package 47b: the cup shelf by Hamm's prize counter (the view opens its page for the stall id 'cups')
use('cup_shelf', 'stall', 3, 1, true, { art: 'nature_table', name: 'cup shelf' });
use('stall', 'stall', 3, 2, true, { winter: true });
use('night_stall', 'stall', 3, 2, true, { light: 4 });
// package 50: painted project buildings: the mended mill (sells bread, as the stall it replaces) and the Square's party stage
use('windmill', 'stall', 3, 2, true, { winter: true, name: 'windmill' });
use('bandstand', 'fun', 6, 2, true, {
  winter: true,
  light: 2,
  fun: { move: 'dance', at: [2.6, 1.2], mate: [3.4, 1.2] },
});
use('claw_machine', 'claw', 2, 2, true, { light: 3, frames: 2 });
use('nature_table', 'naturetable', 3, 1);
use('present_pile', 'present', 3, 2);
use('well', 'well', 2, 2);
use('minecart', 'minecart', 2, 1);
use('boat', 'boat', 2, 1, false);
use('socket_stone', 'socket', 2, 1, true, { light: 2 });
use('radar_dish', 'radar', 2, 2, true, { frames: 2 });
use('prize_counter', 'prize', 3, 1);
use('photo_spot', 'photo', 1, 1, false, { flat: true });
use('chest', 'chest');
use('pickup', 'pickup', 1, 1, false);
use('bottle', 'bottle', 1, 1, false, { frames: 2 });
use('dig_spot', 'dig', 1, 1, false, { flat: true, art: 'x_mark' });
use('long_dog', 'pickup', 1, 1, false);
use('joey', 'pickup', 1, 1, false, { frames: 2 });

// ---- furniture in the houses she can walk into (package 57b, D62): each home looks like its family's
const seat = (id: string, w: number, at: [number, number], mate?: [number, number]) =>
  use(id, 'fun', w, 1, true, { fun: { move: 'sit', at, ...(mate ? { mate } : {}) } });
// the Heelers: a long couch, a kitchen corner, a toy box, a play mat, a plant and a balloon to keep up
seat('heeler_couch', 3, [1.05, 0.72], [1.95, 0.72]);
o('heeler_kitchen', 3, 1);
o('heeler_toybox');
// a flat thing with no use is baked into the floor by tools/map/bake.ts, so the mat is a place to play on
use('heeler_playmat', 'fun', 2, 2, false, { flat: true, fun: { move: 'pat', at: [0.7, 1.2], mate: [1.4, 1.2] } });
o('heeler_plant');
o('heeler_balloon', 1, 1, false, { frames: 2 });
// Peppa's: a red sofa, a dresser of plates, the kitchen table, muddy boots by the door, books and a lamp
seat('peppa_sofa', 2, [0.62, 0.72], [1.38, 0.72]);
o('peppa_dresser', 2, 1);
o('peppa_table', 2, 2);
o('peppa_boots', 1, 1, false);
o('peppa_books');
o('peppa_lamp', 1, 1, true, { light: 3 });
// Bing's: a craft table (a crafting station), a knitted armchair, a bean bag, a toy shelf, carrots and a sunflower
use('bing_craft', 'table', 2, 1);
seat('bing_armchair', 1, [0.5, 0.62]);
seat('bing_beanbag', 1, [0.5, 0.62]);
o('bing_shelf', 2, 1);
o('bing_snack');
o('bing_sunflower');
// Grandad's workshop: a tool board, a saw horse, shelves, a stool, planks and a toolbox
o('shop_toolboard', 2, 1);
o('shop_sawhorse', 2, 1);
o('shop_shelves', 2, 1);
seat('shop_stool', 1, [0.5, 0.6]);
o('shop_planks');
o('shop_toolbox');
// a village house: a blocky bookshelf, crafting table (a station), bed and flower pot
o('block_bookshelf', 2, 1);
use('block_craft', 'table');
o('block_bed', 2, 1);
o('block_flowerpot');

// ---- package 72 (D78): the rooms of every other building (tools/map/rooms.ts). Where the right picture does not
// exist yet, a thing of its own id shows the nearest picture we have (`art`, an object or an item picture), so
// Codex's picture can take its place by changing that one name (docs/phase2-notes/reports/72-pictures-wanted.md).
const art = (id: string, pic: string, w = 1, h = 1, solid = true, extra: Partial<ObjectType> = {}) =>
  o(id, w, h, solid, { art: pic, ...extra });
const sitOn = (id: string, pic: string, w: number, h: number, at: [number, number], mate?: [number, number]) =>
  use(id, 'fun', w, h, true, { art: pic, fun: { move: 'sit', at, ...(mate ? { mate } : {}) } });
const lookAt = (id: string, pic: string, name: string, w = 1, h = 1) => use(id, 'sign', w, h, true, { art: pic, name });
// the Apple Cafe: a counter with cakes under its awning, apple crates, tables to sit at
// package 73b: the counter serves (the stall `cafe_counter`)
use('cafe_counter', 'stall', 3, 2, true, { art: 'cafe_counter', name: 'cafe counter' });
art('cafe_cakes', 'cupcake_table');
art('apple_crate', 'apple_crate');
sitOn('cafe_seat', 'cafe_seat', 2, 2, [0.45, 1.5], [1.55, 1.5]);
// Gabby's Dollhouse: little rooms, a tiny stair, a craft table to play at, a cat sofa
art('doll_bed', 'bed');
art('doll_teddy', 'teddy', 1, 1, false);
use('doll_craft', 'fun', 2, 1, true, { art: 'doll_craft', fun: { move: 'play' } });
sitOn('doll_sofa', 'cat_sofa', 1, 1, [0.5, 0.62]);
art('tiny_stair', 'tiny_stair');
art('doll_vase', 'poppy_vase');
art('doll_catbed', 'cat_bed', 1, 1, false);
// the Post Office: pigeon holes, parcels, a post bag, the counter and a notice board to read
// package 73b: the counter and the pigeon holes hold her post
use('pigeon_holes', 'post', 2, 1, true, { art: 'pigeon_holes', name: 'pigeon holes' });
art('post_parcel', 'parcel');
art('post_bag', 'post_bag');
use('post_counter', 'post', 3, 1, true, { art: 'post_counter', name: 'post counter' });
lookAt('post_notices', 'post_notices', 'notice board', 2, 1);
// the school: a blackboard, desks to sit at, coat pegs, the teacher's desk
// package 73b: the blackboard has the school quiz
use('blackboard', 'quiz', 2, 1, true, { art: 'blackboard', name: 'class board' });
sitOn('school_desk', 'school_desk', 2, 1, [0.6, 0.85], [1.4, 0.85]);
art('coat_pegs', 'coat_pegs');
art('teacher_desk', 'teacher_desk');
// the greenhouse: plant benches, seed trays to pat, pots and a watering can
art('plant_bench', 'plant_bench', 3, 1);
use('seed_tray', 'fun', 1, 1, false, { art: 'seed_tray', flat: true, fun: { move: 'pat' } });
art('green_pot', 'flower_pot');
art('watering_can', 'watering_can');
// package 73b: her three pots, where seeds grow in half the days (src/core/pots.ts); `d` is the pot's number
use('her_pot', 'grow', 1, 1, true, { art: 'her_pot', name: 'pot' });
// Nanny's nook: a stove to warm by, a knitting basket, books, a table with cocoa, a cat bed
use('nook_stove', 'fun', 1, 1, true, { art: 'nook_stove', light: 3, fun: { move: 'warm' } });
art('knit_basket', 'knit_basket');
art('nook_books', 'bookshelf');
art('nook_table', 'table');
art('nook_cocoa', 'hot_chocolate');
art('nook_catbed', 'cat_bed', 1, 1, false);
// the koala treehouse: a den to hide in, cushions, a koala
use('tree_den', 'fun', 2, 2, true, { art: 'tree_den', fun: { move: 'hide', at: [1, 1.7] } });
sitOn('den_cushion', 'den_cushion', 1, 1, [0.5, 0.62]);
art('tree_koala', 'koala_statue');
// the lookouts: a telescope to look out with (package 73a, I3: Space shows the island from above, src/core/lookout.ts)
const lookOut = (id: string, pic: string, name: string, w = 1, h = 1) =>
  use(id, 'look', w, h, true, { art: pic, name });
lookOut('telescope', 'telescope', 'looking glass', 2, 2);
// the lighthouse: a bucket in the store, the keeper's things, the big lamp and the windows of the lamp room
art('lh_bucket', 'lh_bucket');
// the stairs between the tower's floors (steps in the wall): walked through, never in the way
art('tower_stair', 'tower_stair', 1, 1, false);
art('keeper_bed', 'keeper_bed', 1, 2);
art('keeper_books', 'keeper_books');
sitOn('keeper_chair', 'keeper_chair', 1, 1, [0.5, 0.62]);
art('keeper_table', 'keeper_table');
art('keeper_pot', 'keeper_pot');
art('keeper_lamp', 'keeper_lamp', 1, 1, true, { light: 3 });
// a picture is drawn at its own size, so the tall standing lamp stands in for the big one (not the small lantern)
// package 73a (I2): Space turns it on until the next morning (src/core/lamp.ts)
use('big_lamp', 'lamp', 2, 2, true, { art: 'big_lamp', light: 7 });
lookOut('lamp_window', 'lamp_window', 'window');
// the baker's, the farmer's and the mason's houses in the village
use('bake_oven', 'fun', 2, 2, true, { art: 'bake_oven', light: 3, fun: { move: 'warm' } });
art('bread_table', 'bread_table', 3, 1);
art('baker_bread', 'bread');
art('flour_sack', 'flour_sack');
art('tool_rack', 'tool_rack', 2, 1);
art('milk_churn', 'milk_churn');
art('farm_bucket', 'bucket');
art('seed_sacks', 'seed_sacks');
sitOn('stone_bench', 'stone_bench', 3, 1, [1.05, 0.72], [1.95, 0.72]);
use('mason_fire', 'fun', 1, 1, true, { art: 'mason_fire', light: 3, fun: { move: 'warm' } });
art('mason_block', 'mason_block');
art('mason_anvil', 'anvil');
// the windmill: the mill stones to watch, sacks of wheat
lookAt('mill_stones', 'mill_stones', 'mill stones', 2, 2);
art('mill_sack', 'mill_sack');

// ---- package 73a (I13): one small find in each room, taken once by the chest rule (src/core/rooms.ts says what it
// was). Pictures the game already has; the swap is the second name.
const find = (id: string, pic: string, name: string) => use(id, 'chest', 1, 1, true, { art: pic, name });
find('find_box', 'heeler_toybox', 'little box');
find('find_tools', 'shop_toolbox', 'tool box');
find('find_parcel', 'parcel', 'parcel');
find('find_books', 'peppa_books', 'books');
find('find_cake', 'cake', 'cake');
find('find_cookies', 'cookie', 'cookie tin');
find('find_bread', 'bread', 'bread');
find('find_eggs', 'egg', 'eggs');

export const objects = T;
