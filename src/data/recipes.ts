// Recipes: Minecraft flavour, kept to a short list of ingredients. `start` ones are known from the first morning.
import type { RecipeDef } from '../core/types.ts';

const R: Record<string, RecipeDef> = {};
function r(
  out: string,
  n: number,
  inp: Record<string, number>,
  at: 'table' | 'furnace' = 'table',
  start = false,
  id = out,
): void {
  R[id] = { id, out, n, in: inp, at, start: start || undefined };
}

// known from the start
r('plank', 4, { log: 1 }, 'table', true);
r('stick', 4, { plank: 2 }, 'table', true);
r('crafting_table', 1, { plank: 4 }, 'table', true);
r('wood_sword', 1, { plank: 2, stick: 1 }, 'table', true);
r('wood_axe', 1, { plank: 3, stick: 2 }, 'table', true);
// taught by the story and by friends
r('wood_pick', 1, { plank: 3, stick: 2 });
r('wood_spade', 1, { plank: 1, stick: 2 });
r('chest', 1, { plank: 8 });
r('ladder', 3, { stick: 7 });
r('fence', 3, { plank: 4, stick: 2 });
r('gate', 1, { plank: 2, stick: 4 });
r('furnace', 1, { cobblestone: 8 });
r('stone_sword', 1, { cobblestone: 2, stick: 1 });
r('stone_axe', 1, { cobblestone: 3, stick: 2 });
r('stone_pick', 1, { cobblestone: 3, stick: 2 });
r('stone_spade', 1, { cobblestone: 1, stick: 2 });
r('torch', 4, { coal: 1, stick: 1 });
r('bed', 1, { wool: 3, plank: 3 });
r('fishing_rod', 1, { stick: 3, string: 2 });
r('boat', 1, { plank: 5 });
r('iron_ingot', 1, { iron_ore: 1, coal: 1 }, 'furnace');
r('gold_ingot', 1, { gold_ore: 1, coal: 1 }, 'furnace');
r('glass', 1, { sand: 1 }, 'furnace');
r('iron_sword', 1, { iron_ingot: 2, stick: 1 });
r('iron_axe', 1, { iron_ingot: 3, stick: 2 });
r('iron_pick', 1, { iron_ingot: 3, stick: 2 });
r('iron_spade', 1, { iron_ingot: 1, stick: 2 });
r('bucket', 1, { iron_ingot: 3 });
r('diamond_sword', 1, { diamond: 2, stick: 1 });
r('diamond_axe', 1, { diamond: 3, stick: 2 });
r('diamond_pick', 1, { diamond: 3, stick: 2 });
r('tnt', 1, { gunpowder: 5, sand: 4 });
r('wishing_star', 1, { shard: 7, gold_ingot: 2, glass: 1 });
// food
r('bread', 1, { wheat: 3 });
r('sugar', 1, { sugar_cane: 1 });
r('cake', 1, { milk: 3, sugar: 2, egg: 1, wheat: 3 });
r('carrot_cake', 1, { carrot: 3, egg: 1, wheat: 1, sugar: 1 });
r('apple_pie', 1, { apple: 3, wheat: 2, sugar: 1 });
r('marmalade', 1, { orange: 3, sugar: 1 });
r('cookie', 4, { wheat: 2, sugar: 1 });
r('hot_chocolate', 1, { milk: 1, sugar: 1 });
// blocks
r('wall_log', 2, { log: 2 });
r('wall_brick', 4, { cobblestone: 4 }, 'furnace');
r('wall_sandstone', 4, { sand: 4 });
r('wool_red', 1, { wool: 1, flower_red: 1 });
r('wool_blue', 1, { wool: 1, flower_blue: 1 });
r('wool_yellow', 1, { wool: 1, flower_yellow: 1 });
r('wool_green', 1, { wool: 1, gum_leaf: 1 });
r('wool_pink', 1, { wool: 1, flower_pink: 1 });
r('wool_purple', 1, { wool: 1, flower_blue: 1, flower_red: 1 });
r('floor_wood', 4, { plank: 2 });
r('floor_stone', 4, { cobblestone: 2 });
r('floor_brick', 4, { wall_brick: 2 });
r('path_gravel', 6, { cobblestone: 1, sand: 1 });
r('path_stone', 4, { cobblestone: 2, stick: 1 });
r('carpet_red', 2, { wool_red: 1 });
r('carpet_blue', 2, { wool_blue: 1 });
r('hay_block', 1, { wheat: 4 });
r('hedge_block', 2, { stick: 2, gum_leaf: 2 });
r('snow_block', 1, { snowball: 4 });
r('jack_lantern', 1, { pumpkin: 1, torch: 1 });
r('lantern', 1, { iron_ingot: 1, torch: 1 });
r('campfire', 1, { log: 2, stick: 3, coal: 1 });
// furniture
r('table', 1, { plank: 4, stick: 2 });
r('chair', 1, { plank: 2, stick: 2 });
r('rug', 1, { wool: 2 });
r('lamp', 1, { stick: 2, torch: 1, glass: 1 });
// package 70: taught by Mira in the secret show
r('light_stick', 3, { stick: 1, torch: 1 });
r('bookshelf', 1, { plank: 6 });
r('flower_pot', 1, { cobblestone: 1, flower_red: 1 });
r('painting_star', 1, { stick: 4, wool: 1, star_fragment: 1 });
r('painting_sea', 1, { stick: 4, wool: 1, shell_pink: 1 });
r('jukebox', 1, { plank: 8, diamond: 1 });
r('sign_item', 1, { plank: 2, stick: 1 });
r('swing', 1, { plank: 3, string: 2 });
r('sandpit', 1, { plank: 4, sand: 6 });
r('pool', 1, { plank: 4, glass: 2 });
r('kennel_item', 1, { plank: 6, wool: 1 });
r('scarecrow_item', 1, { stick: 3, wheat: 3, pumpkin: 1 });
r('well_item', 1, { cobblestone: 10, bucket: 1 });
r('bench', 1, { plank: 4 });
r('koala_statue', 1, { cobblestone: 6, gum_leaf: 2 });
r('xmas_tree', 1, { log: 2, gum_leaf: 4, star_fragment: 1 });
r('snowman_item', 1, { snowball: 6, carrot: 1, stick: 2 });
r('snow_golem', 1, { snow_block: 2, pumpkin: 1 });
r('fairy_string', 2, { string: 1, glass: 1, torch: 1 });
r('creeper_plush', 1, { wool: 4, gunpowder: 1 });
r('rocket_item', 1, { star_fragment: 3, glass: 1, plank: 2 });
r('star_lamp', 1, { star_fragment: 2, glass: 1, gold_ingot: 1 });
r('poppy_vase', 1, { glass: 1, flower_red: 2 });
r('mirror_item', 1, { glass: 2, plank: 2 });
// the bow (phase 2, part D): taught in chapter 4, where spiders give string; arrows need no flint
r('bow', 1, { stick: 3, string: 3 });
r('arrow', 4, { stick: 1, feather: 1 });
// gear (package 31): leather from scraps; a helmet takes 3 of its material, body armour 5
r('leather', 1, { leather_scrap: 2 });
r('leather_helmet', 1, { leather: 3 });
r('leather_armour', 1, { leather: 5 });
r('iron_helmet', 1, { iron_ingot: 3 });
r('iron_armour', 1, { iron_ingot: 5 });
r('diamond_helmet', 1, { diamond: 3 });
r('diamond_armour', 1, { diamond: 5 });
r('anvil', 1, { iron_ingot: 4, cobblestone: 2 });
r('armour_stand', 1, { plank: 2, stick: 4 });
r('cooking_pot', 1, { iron_ingot: 2, cobblestone: 1 });

export const recipes = R;
