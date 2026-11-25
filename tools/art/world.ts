// World art: job lists and slicing lists for objects, item icons, crops, ground textures and backdrops.
//   node tools/art/world.ts jobs                 writes art/jobs/world-*.json (gen.ts lists and process.ts sheet lists)
//   node tools/art/world.ts slice [objects|items] slices masters (objects to the stage folder, icons to art/src/items)
//   node tools/art/world.ts fit [id,id]          sizes staged objects into art/src/objects (96 px a tile, 1.5 x screen)
//   node tools/art/world.ts painted jobs|copy|slice   the painted props of phase 2 (see "painted props" below)
//   node tools/art/world.ts ground [name,name]   masters/ground -> art/src/ground/<name>.png (512, made seamless)
//   node tools/art/world.ts backdrops            masters/backdrops -> art/src/ui/bd_*.png (1280 x 720)
//   node tools/art/world.ts contact              contact sheets in the job folder for a look
//   node tools/art/world.ts all                  slice, fit, ground, backdrops, contact
// Generate with: node tools/art/gen.ts art/jobs/world-gen-<set>.json (under run-job). Nothing here is about real people.
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { items } from '../../src/data/items.ts';
import { objects } from '../../src/data/objects.ts';
import { contactSheet } from './contact.ts';
import type { ArtJob } from './gen.ts';
import { alphaBox, blank, components, crop, type Img, load, over, resize, toSharp } from './imgutil.ts';
import { regrade } from '../map/bakeutil.ts';
import { processSheets, type SheetJob } from './process.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const JOBDIR = process.env.WORLD_JOBS ?? '/Volumes/4TB/dev/work/jobs/wishing-star';
const STAGE = join(JOBDIR, 'world-stage');
const QA = join(JOBDIR, 'world-qa');
const PX = 96; // px per tile of art (1.5 x the 64 px screen tile)

// ---------------------------------------------------------------- style lock (words from the accepted spike)

const PROP_STYLE =
  'Style/medium: painted cartoon game props seen from a three-quarter top-down view (front face and a little of the top visible), soft shading with light from the top left, dark outline';
const BLOCK_STYLE =
  'Style/medium: voxel block-game props built from big square pixel blocks (chunky cubes with pixel-art faces), seen from a three-quarter top-down view (front face and a little of the top visible), soft shading with light from the top left, dark outline';
const FLAT_NOTE = '(seen from straight above, lying flat on the ground)';
const ALPHA = 'Scene/backdrop: fully transparent background (real alpha); no ground, no cast shadow, no glow';
const NO_TEXT = 'Constraints: no text, no letters, no numbers, no watermark';

// ---------------------------------------------------------------- world objects

type Kind = 'tree' | 'prop' | 'pick' | 'flat' | 'house' | 'big';
interface ObjArt {
  desc: string;
  kind: Kind;
  blocky?: boolean;
  /** target box in tiles [w, h]; the art is fitted inside it (contain), or stretched to it when fill is set */
  box?: [number, number];
  fill?: boolean;
}

const O: Record<string, ObjArt> = {
  // trees
  oak: { desc: 'a round leafy oak tree', kind: 'tree' },
  pine: { desc: 'a tall pine tree', kind: 'tree', box: [1.7, 2.6] },
  palm: { desc: 'a tall palm tree with a curved trunk and big green fronds', kind: 'tree', box: [1.9, 2.6] },
  birch: { desc: 'a slim birch tree with a white trunk with black marks and light green leaves', kind: 'tree' },
  gum_tree: { desc: 'a eucalyptus gum tree with a pale smooth trunk and grey-green leaves', kind: 'tree' },
  apple_tree: { desc: 'a round fruit tree with shiny red apples among its leaves', kind: 'tree' },
  orange_tree: { desc: 'a round fruit tree with bright oranges among dark green leaves', kind: 'tree' },
  banana_tree: { desc: 'a banana plant with huge long leaves and a bunch of yellow bananas', kind: 'tree' },
  tree_stump: { desc: 'a short cut tree stump with rings on top', kind: 'prop', box: [0.9, 0.8] },
  block_oak: {
    desc: 'a block-game oak tree: a square brown log trunk and a big cube canopy of green leaf blocks',
    kind: 'tree',
    blocky: true,
  },
  dark_oak: {
    desc: 'a block-game dark oak tree: a thick dark brown square trunk and a wide dark green cube canopy',
    kind: 'tree',
    blocky: true,
  },
  burnt_tree: { desc: 'a bare burnt tree made of charcoal-grey square blocks, no leaves', kind: 'tree', blocky: true },
  poinciana: {
    desc: 'one big broad tree with a wide flat umbrella-shaped canopy covered in bright red-orange flowers and a sturdy brown trunk',
    kind: 'big',
    box: [4.6, 5],
  },
  great_tree: {
    desc: 'one huge ancient evergreen Christmas tree, very wide and tall, dark green and unlit, no decorations, no star, thick roots at the base',
    kind: 'big',
    box: [5.6, 7.6],
  },
  great_tree_lit: {
    desc: 'one huge ancient evergreen Christmas tree, very wide and tall, covered in warm glowing fairy lights and red and gold baubles, a big shining golden star on the very top, thick roots at the base',
    kind: 'big',
    box: [5.6, 7.6],
  },
  fallen_gum: {
    desc: 'one big fallen eucalyptus tree trunk lying on the ground, running from the top of the picture to the bottom, pale bark and a few leafy branches',
    kind: 'big',
    box: [2, 3],
  },
  // rock and ore
  rock: { desc: 'a grey rock', kind: 'prop' },
  coal_rock: { desc: 'a grey stone block with black coal lumps set in it', kind: 'prop', blocky: true },
  iron_rock: { desc: 'a grey stone block with peach and tan iron ore spots in it', kind: 'prop', blocky: true },
  gold_rock: { desc: 'a grey stone block with shiny gold ore spots in it', kind: 'prop', blocky: true },
  diamond_rock: { desc: 'a grey stone block with bright cyan diamond spots in it', kind: 'prop', blocky: true },
  boulder_wall: {
    desc: 'one tall wall of big grey stone blocks with cracks, blocking a path',
    kind: 'big',
    blocky: true,
    box: [2, 3.4],
  },
  cracked_rock: { desc: 'a grey boulder with big cracks across it, ready to break', kind: 'prop' },
  boulder: { desc: 'a big rounded grey boulder with moss on top', kind: 'prop', box: [1, 1.2] },
  stalagmite: {
    desc: 'a pointed cave stalagmite made of stacked grey stone blocks',
    kind: 'prop',
    blocky: true,
    box: [0.8, 1.4],
  },
  crystal: { desc: 'a cluster of glowing purple crystal blocks', kind: 'prop', blocky: true },
  // things to pick up
  flower_red: { desc: 'a small clump of red flowers', kind: 'pick' },
  flower_yellow: { desc: 'a small clump of yellow flowers', kind: 'pick' },
  flower_blue: { desc: 'a small clump of blue flowers', kind: 'pick' },
  flower_white: { desc: 'a small clump of white daisies', kind: 'pick' },
  flower_pink: { desc: 'a small clump of pink flowers', kind: 'pick' },
  sunflower_wild: { desc: 'one tall sunflower with a big yellow head', kind: 'pick', box: [0.7, 1.3] },
  shell_pink: { desc: 'a pink scallop seashell', kind: 'pick', box: [0.5, 0.5] },
  shell_spiral: { desc: 'a cream spiral seashell', kind: 'pick', box: [0.5, 0.5] },
  starfish: { desc: 'an orange starfish', kind: 'pick', box: [0.55, 0.55] },
  sea_glass: { desc: 'three small smooth pieces of green and blue sea glass', kind: 'pick', box: [0.5, 0.5] },
  driftwood: { desc: 'a pale grey piece of driftwood', kind: 'pick', box: [0.8, 0.5] },
  feather: { desc: 'a white and grey feather', kind: 'pick', box: [0.5, 0.5] },
  mushroom: { desc: 'a red-capped mushroom with white spots', kind: 'pick', box: [0.5, 0.55] },
  pumpkin_wild: { desc: 'an orange pumpkin on a curly vine', kind: 'pick', box: [0.75, 0.7] },
  wheat_wild: { desc: 'a clump of golden wheat stalks', kind: 'pick', box: [0.7, 0.9] },
  pine_cone: { desc: 'a brown pine cone', kind: 'pick', box: [0.45, 0.5] },
  pebble: { desc: 'a smooth round grey pebble', kind: 'pick', box: [0.45, 0.4] },
  snow_pile: { desc: 'a soft heap of white snow', kind: 'pick', box: [0.9, 0.6] },
  stick_pile: { desc: 'a small pile of sticks', kind: 'pick', box: [0.8, 0.5] },
  // plants and scenery
  bush: { desc: 'a round green bush', kind: 'prop' },
  hedge: { desc: 'a square block of neatly trimmed green hedge', kind: 'prop', box: [1, 1.3] },
  reeds: { desc: 'a clump of tall pond reeds with brown bulrush heads', kind: 'prop', box: [0.9, 1.3] },
  fern: { desc: 'a leafy green fern', kind: 'prop', box: [0.9, 0.9] },
  lily: { desc: `a round green lily pad with a pink water lily flower ${FLAT_NOTE}`, kind: 'flat', box: [0.9, 0.9] },
  thorn_bush: { desc: 'a tangled brown thorny bramble bush', kind: 'prop' },
  web: { desc: 'a big white spider web strung between two twigs, no spider', kind: 'prop' },
  cactus_pot: { desc: 'a small round cactus in a terracotta pot', kind: 'prop', box: [0.7, 0.9] },
  hay_bale: { desc: 'a square golden hay bale tied with string', kind: 'prop' },
  barrel: { desc: 'a wooden barrel with metal bands', kind: 'prop', box: [0.8, 1.1] },
  crate: { desc: 'a wooden crate', kind: 'prop', box: [0.9, 1] },
  scarecrow: { desc: 'a friendly scarecrow with a straw hat and a patched shirt', kind: 'prop', box: [1, 1.6] },
  log_hollow: { desc: 'a hollow fallen log lying sideways, with a dark round opening', kind: 'prop' },
  // flat decor
  grass_tuft: { desc: 'a small tuft of grass blades', kind: 'flat', box: [0.6, 0.5] },
  scorch: { desc: `a dark sooty scorch mark ${FLAT_NOTE}`, kind: 'flat', box: [0.9, 0.9] },
  lone_flower: { desc: 'one small white and yellow wild flower with two leaves', kind: 'flat', box: [0.4, 0.45] },
  flower_bed: {
    desc: `a small square flower bed of mixed bright flowers in dark soil ${FLAT_NOTE}`,
    kind: 'flat',
    box: [1, 1],
    fill: true,
  },
  picnic_blanket: {
    desc: `a red and white checked picnic blanket with a wicker basket on it ${FLAT_NOTE}`,
    kind: 'flat',
    fill: true,
  },
  rail: {
    desc: `a straight piece of block-game minecart rail track running from top to bottom ${FLAT_NOTE}`,
    kind: 'flat',
    blocky: true,
    fill: true,
  },
  rail_curve: {
    desc: `a curved piece of block-game minecart rail track turning a corner ${FLAT_NOTE}`,
    kind: 'flat',
    blocky: true,
    fill: true,
  },
  toy_track: {
    desc: `a straight piece of wooden toy train track running from top to bottom ${FLAT_NOTE}`,
    kind: 'flat',
    fill: true,
  },
  footprints: { desc: `a short trail of small muddy footprints ${FLAT_NOTE}`, kind: 'flat', box: [0.8, 0.9] },
  chalk_hopscotch: {
    desc: 'a long hopscotch pattern drawn in coloured chalk on the ground, seen from straight above, a single column of boxes with one pair of side-by-side boxes in the middle, filling a tall narrow strip about three times taller than wide; boxes only, no numbers',
    kind: 'big',
    fill: true,
  },
  puddle: { desc: `a small shiny blue rain puddle ${FLAT_NOTE}`, kind: 'flat', box: [0.9, 0.7] },
  big_puddle: {
    desc: `a big irregular muddy brown puddle with a shiny wet surface ${FLAT_NOTE}`,
    kind: 'flat',
    fill: true,
  },
  fairy_ring: {
    desc: `a ring of small white and red-spotted mushrooms in a perfect circle ${FLAT_NOTE}`,
    kind: 'flat',
    fill: true,
  },
  x_mark: { desc: `a big red painted X mark on the ground ${FLAT_NOTE}`, kind: 'flat', box: [0.8, 0.8] },
  sandbox: {
    desc: `a square wooden sandpit full of yellow sand with a little bucket and spade ${FLAT_NOTE}`,
    kind: 'flat',
    fill: true,
  },
  veranda: {
    desc: 'a long wooden deck of planks seen from straight above, very wide and shallow, about six times wider than it is deep, planks running left to right, a plain edge',
    kind: 'big',
    fill: true,
  },
  slinky_bridge: {
    desc: 'a long bridge made from a giant stretched rainbow-coloured coil spring toy, seen from straight above, running from the top of the picture to the bottom, about two and a half times taller than wide',
    kind: 'big',
    fill: true,
  },
  photo_spot: {
    desc: `a round gold star badge painted on the ground as a photo spot marker ${FLAT_NOTE}`,
    kind: 'flat',
    box: [0.8, 0.8],
  },
  // fences, walls, lights
  fence: { desc: 'a short section of white wooden picket fence, front view', kind: 'prop', box: [1, 1.1] },
  fence_post: { desc: 'a single square wooden fence post', kind: 'prop', box: [0.4, 1] },
  plot_fence: { desc: 'a short section of low rustic wooden rail fence, front view', kind: 'prop', box: [1, 0.9] },
  stone_wall: { desc: 'a short section of grey dry-stone wall, front view', kind: 'prop', box: [1, 1.1] },
  rim_rock: { desc: 'a jagged dark rock lump from the edge of a crater', kind: 'prop' },
  pillar: {
    desc: 'a tall square stone pillar built of grey stone-brick blocks',
    kind: 'prop',
    blocky: true,
    box: [0.9, 2.2],
  },
  lamp_post: {
    desc: 'an old-fashioned black iron street lamp post with a warm lit lantern on top',
    kind: 'prop',
    box: [0.8, 2.1],
  },
  lantern: { desc: 'a small lantern with a warm candle inside', kind: 'prop', box: [0.6, 0.9] },
  campfire: { desc: 'a cosy campfire: crossed logs in a ring of stones with bright flames', kind: 'prop' },
  torch_stand: {
    desc: 'a wooden torch stick with a bright flame on top, standing upright',
    kind: 'prop',
    blocky: true,
    box: [0.5, 1.3],
  },
  fairy_lights: {
    desc: 'a string of colourful glowing fairy lights hanging between two thin wooden poles',
    kind: 'prop',
    box: [3, 1.6],
  },
  pond_lantern: { desc: 'a small floating paper lantern glowing warm yellow', kind: 'prop', box: [0.6, 0.7] },
  xmas_arch: {
    desc: 'a wide archway of evergreen garland with red bows and glowing lights',
    kind: 'prop',
    box: [3, 2.4],
  },
  // buildings
  cottage: {
    desc: 'one cosy little storybook cottage: cream walls, red tiled roof, a round-topped wooden front door in the middle of the front wall, two small windows with flower boxes, a brick chimney',
    kind: 'house',
  },
  workshop: {
    desc: "one cosy timber woodworker's workshop: wide wooden double doors in the middle, a big window showing tools, a green tin roof and a short stove-pipe chimney",
    kind: 'house',
  },
  post_office: {
    desc: 'one small red-brick village post office: a red roof, a round clock above the blue front door in the middle, and a red post box beside the door',
    kind: 'house',
  },
  school: {
    desc: 'one small friendly village school: pale yellow walls, a grey slate roof with a little bell tower, a row of wide windows and a blue front door in the middle',
    kind: 'house',
  },
  cafe: {
    desc: 'one cute cafe building shaped like a giant shiny red apple with a green leaf and stalk on top, round windows, a red and white striped awning over the door in the middle',
    kind: 'house',
  },
  dollhouse: {
    desc: 'one tall toy dollhouse built life-size: pink and purple walls, a roof shaped like two pointy cat ears, many little windows with frilly shutters, a front door in the middle',
    kind: 'house',
  },
  nanny_nook: {
    desc: 'one tiny round cottage with a thatched roof, soft yellow walls, a round green door in the middle, and baskets of colourful balls of wool by the door',
    kind: 'house',
  },
  greenhouse: {
    desc: 'one small glass greenhouse with a white frame, green plants inside and a glass door in the middle',
    kind: 'house',
  },
  heeler_house: {
    desc: 'one wide Queenslander-style timber house on short stilts with a deep veranda all across the front, white railings, wooden steps up to the front door in the middle and a red corrugated roof',
    kind: 'house',
  },
  bing_house: {
    desc: 'one small cosy two-storey family house with cream walls, a red roof, a round window up in the gable and a green front door in the middle',
    kind: 'house',
  },
  peppa_house: {
    desc: 'one small square yellow house with a steep red-orange roof and a chimney, four square windows and a red front door in the middle',
    kind: 'house',
  },
  treehouse: {
    desc: 'one wooden treehouse built in a big eucalyptus tree: a little plank hut with a window on a platform in the branches and a rope ladder hanging down to the ground in the middle',
    kind: 'house',
    box: [4, 6],
  },
  villager_house_a: {
    desc: 'one block-game village house built of oak plank blocks and cobblestone blocks, a dark log frame, a stepped wooden roof, a wooden door in the middle and two glass windows',
    kind: 'house',
    blocky: true,
  },
  villager_house_b: {
    desc: 'one block-game village house built of sandstone blocks with a stepped hay-block roof, a wooden door in the middle and small square windows',
    kind: 'house',
    blocky: true,
  },
  lighthouse: {
    desc: 'one tall red and white striped lighthouse with a glass lamp room at the top and a little door at the bottom',
    kind: 'house',
    box: [3, 7],
  },
  lookout: {
    desc: 'one wooden lookout tower on four tall legs with a ladder up the front and a little roof on top',
    kind: 'house',
    box: [3, 5],
  },
  mine_mouth: {
    desc: 'one mine entrance in a block-game hillside: a dark square tunnel framed by wooden support beams, set in a slope of dirt, grass and stone blocks',
    kind: 'house',
    blocky: true,
  },
  hall_gate: {
    desc: 'one huge closed gate of dark stone-brick blocks with six star-shaped holes in a row across the middle, set in a block wall',
    kind: 'house',
    blocky: true,
  },
  waterfall: {
    desc: 'one small rocky cliff with a sparkling waterfall pouring down its front into a little foamy pool at the bottom',
    kind: 'big',
    box: [4, 5.4],
  },
  cliff_face: { desc: 'a chunk of brown rocky cliff face with ledges', kind: 'prop' },
  // play and props
  cardboard_fort: {
    desc: 'a big play fort built from cardboard boxes with a cut-out door and a little flag',
    kind: 'prop',
    box: [4, 3.6],
  },
  alphabet_blocks: { desc: 'a tumbled pile of big wooden toy blocks with plain coloured sides', kind: 'prop' },
  toy_train: { desc: 'a colourful wooden toy train engine with one carriage', kind: 'prop' },
  rocket_slide: { desc: 'a playground slide shaped like a red and white rocket', kind: 'prop', box: [2, 3.4] },
  swing_set: { desc: 'a playground swing set with two swings on a red frame', kind: 'prop' },
  slide: { desc: 'a playground slide with a ladder and a yellow chute', kind: 'prop', box: [2, 3.2] },
  seesaw: { desc: 'a playground seesaw, long plank on a red stand', kind: 'prop', box: [3, 1.4] },
  paddling_pool: { desc: 'a round blue inflatable paddling pool full of water', kind: 'prop', box: [3, 2] },
  kennel: { desc: 'a wooden dog kennel with a red roof', kind: 'prop' },
  trampoline: { desc: 'a round garden trampoline with a blue safety pad rim', kind: 'prop', box: [3, 2] },
  market_awning: {
    desc: 'a market stall awning: a striped red and white canopy on four poles over an empty table',
    kind: 'prop',
  },
  cafe_table: { desc: 'a small round outdoor cafe table with two chairs', kind: 'prop' },
  jetty_post: { desc: 'a thick wooden jetty post with a rope tied round it', kind: 'prop', box: [0.5, 1.2] },
  boat_wreck: { desc: 'a broken old wooden rowing boat stuck in the sand, tilted, with holes', kind: 'prop' },
  throne: {
    desc: 'a big block-game throne made of dark stone and gold blocks with purple cushions',
    kind: 'prop',
    blocky: true,
    box: [3, 2.6],
  },
  creeper_statue: {
    desc: 'a stone statue of a tall green block-game creature made of cubes with a dark square face',
    kind: 'prop',
    blocky: true,
    box: [1, 2.2],
  },
  snowman: { desc: 'a happy snowman with a carrot nose, a red scarf and coal buttons', kind: 'prop', box: [1, 1.5] },
  ladder_up: { desc: 'a wooden ladder leaning up', kind: 'prop', box: [0.8, 1.5] },
  den: { desc: 'a little den made of branches leaning together with a blanket over them', kind: 'prop' },
  blanket_fort: { desc: 'a cosy blanket fort: a colourful patchwork blanket draped over two chairs', kind: 'prop' },
  banana_stand: { desc: 'a little wooden fruit stand piled high with bunches of yellow bananas', kind: 'prop' },
  garden_bench: { desc: 'a wooden garden bench', kind: 'prop', box: [3, 1.4] },
  game_post: {
    desc: 'a short wooden post with a bright round button and a little bell on top',
    kind: 'prop',
    box: [0.7, 1.3],
  },
  // things to use
  signpost: { desc: 'a wooden signpost with two blank arrow boards', kind: 'prop', box: [1, 1.5] },
  sign: { desc: 'a small blank wooden sign board on a post', kind: 'prop', box: [0.9, 1.2] },
  mailbox: { desc: 'a red mailbox on a wooden post', kind: 'prop', box: [0.7, 1.4] },
  mirror: { desc: 'a tall oval standing mirror in a wooden frame', kind: 'prop', box: [0.8, 1.6] },
  bed_fixed: {
    desc: 'a cosy single bed with a patchwork quilt and a pillow, head end at the top',
    kind: 'prop',
    box: [1, 2.2],
  },
  workbench: { desc: 'a wooden crafting workbench with tools on top', kind: 'prop' },
  big_furnace: {
    desc: 'a big block-game furnace built of cobblestone blocks with a glowing orange fire opening',
    kind: 'prop',
    blocky: true,
  },
  noticeboard: { desc: 'a wooden noticeboard on two legs with pinned blank paper notes', kind: 'prop' },
  bounty_board: {
    desc: 'a wooden board on two legs with blank wanted posters pinned on it and a little roof',
    kind: 'prop',
  },
  stall: { desc: 'a wooden market stall with a green and white striped awning and goods on the counter', kind: 'prop' },
  windmill: { desc: 'a small wooden windmill with four cloth sails and a stone base', kind: 'prop' },
  bandstand: { desc: 'a round wooden bandstand with a pointed roof, steps and a string of lanterns', kind: 'prop' },
  night_stall: {
    desc: 'a market stall with a purple and black striped awning, little lanterns and spooky cute goods',
    kind: 'prop',
  },
  claw_machine: {
    desc: 'an arcade claw machine with a glass box full of soft toys and bright pink and blue panels',
    kind: 'prop',
    box: [1.6, 2.4],
  },
  nature_table: {
    desc: 'a long wooden table with leaves, shells, pine cones and a magnifying glass on it',
    kind: 'prop',
  },
  present_pile: { desc: 'a big pile of wrapped Christmas presents with ribbons and bows', kind: 'prop' },
  well: { desc: 'a stone well with a little roof', kind: 'prop' },
  minecart: { desc: 'a block-game minecart: an open grey iron box cart on little wheels', kind: 'prop', blocky: true },
  boat: { desc: 'a small wooden rowing boat with two oars, seen from above at an angle', kind: 'prop' },
  socket_stone: {
    desc: 'a low wide stone plinth made of grey blocks with a star-shaped hollow on top',
    kind: 'prop',
    blocky: true,
  },
  radar_dish: { desc: 'a toy-like white radar dish on a stand with a blinking red light', kind: 'prop' },
  prize_counter: { desc: 'a long prize counter with shelves of soft toys and prizes behind it', kind: 'prop' },
  chest: { desc: 'a wooden treasure chest', kind: 'prop', box: [0.9, 0.9] },
  pickup: { desc: 'a small brown paper parcel tied with string', kind: 'pick', box: [0.6, 0.55] },
  bottle: { desc: 'a glass bottle with a rolled paper message inside and a cork', kind: 'pick', box: [0.6, 0.5] },
  long_dog: {
    desc: 'a tiny funny cartoon sausage dog with a very very long body and short legs, standing sideways',
    kind: 'pick',
    box: [1, 0.5],
  },
  joey: { desc: 'a tiny fluffy grey baby koala sitting and looking up', kind: 'pick', box: [0.5, 0.55] },
};

/** Object sheets (3 x 3 unless the list is shorter: 4 makes 2 x 2), and single images for the rest. */
const OBJ_SHEETS: Record<string, string[]> = {
  trees: ['oak', 'pine', 'palm', 'birch', 'gum_tree', 'apple_tree', 'orange_tree', 'banana_tree', 'tree_stump'],
  blocky_a: [
    'block_oak',
    'dark_oak',
    'burnt_tree',
    'creeper_statue',
    'torch_stand',
    'pillar',
    'throne',
    'minecart',
    'big_furnace',
  ],
  blocky_b: [
    'coal_rock',
    'iron_rock',
    'gold_rock',
    'diamond_rock',
    'crystal',
    'stalagmite',
    'socket_stone',
    'rail',
    'rail_curve',
  ],
  rocks: [
    'rock',
    'boulder',
    'cracked_rock',
    'rim_rock',
    'cliff_face',
    'stone_wall',
    'fence',
    'fence_post',
    'plot_fence',
  ],
  flowers: [
    'flower_red',
    'flower_yellow',
    'flower_blue',
    'flower_white',
    'flower_pink',
    'sunflower_wild',
    'mushroom',
    'pumpkin_wild',
    'wheat_wild',
  ],
  finds: [
    'shell_pink',
    'shell_spiral',
    'starfish',
    'sea_glass',
    'driftwood',
    'feather',
    'pine_cone',
    'pebble',
    'snow_pile',
  ],
  plants: ['bush', 'hedge', 'reeds', 'fern', 'lily', 'thorn_bush', 'stick_pile', 'web', 'cactus_pot'],
  farm: ['hay_bale', 'barrel', 'crate', 'scarecrow', 'log_hollow', 'well', 'chest', 'signpost', 'sign'],
  decor: [
    'grass_tuft',
    'scorch',
    'lone_flower',
    'flower_bed',
    'puddle',
    'x_mark',
    'footprints',
    'toy_track',
    'photo_spot',
  ],
  ground_big: ['picnic_blanket', 'fairy_ring', 'sandbox', 'big_puddle'],
  lights: [
    'lamp_post',
    'lantern',
    'campfire',
    'fairy_lights',
    'pond_lantern',
    'xmas_arch',
    'mailbox',
    'mirror',
    'snowman',
  ],
  boards: [
    'workbench',
    'noticeboard',
    'bounty_board',
    'nature_table',
    'present_pile',
    'prize_counter',
    'game_post',
    'bed_fixed',
    'cafe_table',
  ],
  market: [
    'stall',
    'night_stall',
    'claw_machine',
    'market_awning',
    'banana_stand',
    'boat',
    'radar_dish',
    'jetty_post',
    'boat_wreck',
  ],
  play: [
    'swing_set',
    'slide',
    'rocket_slide',
    'seesaw',
    'paddling_pool',
    'trampoline',
    'kennel',
    'alphabet_blocks',
    'toy_train',
  ],
  misc: ['cardboard_fort', 'den', 'blanket_fort', 'garden_bench', 'ladder_up', 'pickup', 'bottle', 'long_dog', 'joey'],
};

// ---------------------------------------------------------------- crops

const CROPS: Record<string, [string, string, string]> = {
  carrot: [
    'a tiny carrot seedling: two small feathery green leaves',
    'a young carrot plant: a bushy tuft of feathery green leaves',
    'a ripe carrot plant: a big feathery green top with the orange carrot shoulder poking out',
  ],
  wheat: [
    'a tiny wheat seedling: a few thin green shoots',
    'a young wheat plant: a clump of tall green stalks',
    'ripe golden wheat: a clump of tall golden stalks with full ears',
  ],
  pumpkin: [
    'a tiny pumpkin seedling: two round green leaves',
    'a young pumpkin vine: big green leaves and a small green pumpkin',
    'a ripe pumpkin: a big round orange pumpkin with green leaves',
  ],
  sunflower: [
    'a tiny sunflower seedling: two green leaves on a short stem',
    'a young sunflower: a tall green stem with leaves and a closed green bud',
    'a ripe sunflower: a tall stem with a big bright yellow flower head',
  ],
  sugar_cane: [
    'a tiny sugar cane shoot: a short green sprout',
    'young sugar cane: a few green jointed canes half grown',
    'ripe sugar cane: a clump of tall green jointed canes',
  ],
};
const CROP_BOX: [number, number][] = [
  [0.55, 0.45],
  [0.75, 0.8],
  [0.95, 1.15],
];

// ---------------------------------------------------------------- items

const ITEM_DESC: Record<string, string> = {
  log: 'a short wooden log',
  wood_sword: 'a wooden sword',
  wood_axe: 'a wooden axe',
  wood_pick: 'a wooden pickaxe',
  wood_spade: 'a wooden spade',
  stone_sword: 'a sword with a grey stone blade and a wooden handle',
  stone_axe: 'an axe with a grey stone head and a wooden handle',
  stone_pick: 'a pickaxe with a grey stone head and a wooden handle',
  stone_spade: 'a spade with a grey stone blade and a wooden handle',
  iron_sword: 'a shiny silver iron sword with a wooden handle',
  iron_axe: 'a shiny silver iron axe with a wooden handle',
  iron_pick: 'a shiny silver iron pickaxe with a wooden handle',
  iron_spade: 'a shiny silver iron spade with a wooden handle',
  diamond_sword: 'a sparkling cyan diamond sword with a wooden handle',
  diamond_axe: 'a sparkling cyan diamond axe with a wooden handle',
  diamond_pick: 'a sparkling cyan diamond pickaxe with a wooden handle',
  apple: 'a red apple',
  orange: 'an orange',
  banana: 'a yellow banana',
  carrot: 'an orange carrot with green leaves',
  plank: 'a stack of wooden planks',
  stick: 'a bundle of sticks',
  cobblestone: 'a grey cobblestone block',
  coal: 'a lump of black coal',
  iron_ore: 'a grey rock lump with peach iron ore spots',
  iron_ingot: 'a shiny silver-grey iron bar',
  gold_ore: 'a grey rock lump with gold ore spots',
  gold_ingot: 'a shiny gold bar',
  diamond: 'a sparkling cyan diamond',
  sand: 'a small heap of yellow sand',
  glass: 'a clear pane of glass with a shine',
  wool: 'a ball of white wool',
  string: 'a small coil of white string',
  gunpowder: 'a small heap of grey powder',
  bone: 'a white cartoon bone',
  arrow: 'a wooden arrow with a feather end',
  rotten_flesh: 'a lumpy greenish crumbly biscuit',
  ender_pearl: 'a dark teal glassy pearl with a green swirl',
  feather: 'a white feather',
  gum_leaf: 'a long slim grey-green eucalyptus leaf',
  star_fragment: 'a small glowing yellow star crystal bit',
  sugar: 'a small heap of white sugar',
  snowball: 'a round white snowball',
  pine_cone: 'a brown pine cone',
  ticket: 'a red paper prize ticket with a star on it',
  ladder: 'a short wooden ladder',
  torch: 'a burning wooden torch',
  emerald: 'a green emerald gem',
  tnt: 'a red block-game explosive block with a fuse on top',
  fishing_rod: 'a wooden fishing rod with a red float',
  bucket: 'a metal bucket',
  wellies: 'a pair of green wellington boots',
  boat: 'a small wooden rowing boat',
  shard: 'a glowing golden five-pointed star shard',
  dads_map: 'a folded treasure map with a red dotted line',
  sticker_book: 'a chunky sticker album with a gold star on the cover',
  parcel: 'a brown paper parcel tied with string',
  toy_bunny: 'a small soft grey toy bunny',
  hoppity: 'a small blue toy hero figure with long ears and a red cape',
  glasses: 'a pair of round reading glasses',
  teddy: 'a small brown teddy bear',
  wishing_star: 'a big shining golden five-pointed star with little sparkles',
  poppy: 'a red poppy flower',
  balloon: 'a red balloon on a string',
  bridge_plan: 'a rolled blue paper plan tied with a ribbon',
  hat_parcel: 'a round striped hat box with a lid',
  space_part: 'a shiny silver rocket fin part',
  lasso: 'a coiled rope lasso',
  george_dino: 'a small green toy dinosaur',
  jumpers: 'three tiny knitted jumpers in a pile',
  ukulele: 'a small four-string ukulele',
  fossil: 'a stone with a curled fossil shell print',
  lost_joey: 'a tiny fluffy grey baby koala',
  potato_ears: 'a pair of pink toy ears',
  potato_nose: 'a round pink toy nose',
  potato_hat: 'a small black bowler hat',
  potato_eyes: 'a pair of big round googly toy eyes',
  potato_arms: 'a pair of small white toy arms with hands',
  bread: 'a loaf of bread',
  cake: 'a round iced cake with a cherry',
  carrot_cake: 'a slice of carrot cake with white icing',
  apple_pie: 'an apple pie with a lattice top',
  marmalade: 'a jar of orange marmalade',
  egg: 'a brown egg',
  milk: 'a glass bottle of milk',
  mushroom: 'a red-capped mushroom with white spots',
  cookie: 'a round chocolate chip cookie',
  hot_chocolate: 'a mug of hot chocolate with marshmallows',
  wheat: 'a bundle of golden wheat',
  pumpkin: 'an orange pumpkin',
  sunflower: 'a bright yellow sunflower head',
  sugar_cane: 'three green sugar cane stalks',
  carrot_seed: 'a little paper seed packet with a carrot picture',
  wheat_seed: 'a little paper seed packet with a wheat picture',
  pumpkin_seed: 'a little paper seed packet with a pumpkin picture',
  sunflower_seed: 'a little paper seed packet with a sunflower picture',
  cane_seed: 'a little paper seed packet with a sugar cane picture',
  sardine: 'a small silver sardine',
  mackerel: 'a blue-striped mackerel fish',
  puffer_fish: 'a round yellow puffer fish with little spikes',
  moon_jelly: 'a pale blue see-through moon jellyfish',
  trout: 'a speckled brown trout',
  minnow: 'a tiny silver minnow',
  salmon: 'a pink-silver salmon',
  goldfish: 'an orange goldfish',
  pond_carp: 'an orange and white pond carp',
  glow_fish: 'a little fish that glows soft green',
  shell_pink: 'a pink scallop seashell',
  shell_spiral: 'a cream spiral seashell',
  starfish: 'an orange starfish',
  sea_glass: 'a smooth piece of green sea glass',
  driftwood: 'a pale grey piece of driftwood',
  pebble: 'a smooth round grey pebble',
  flower_red: 'a red flower',
  flower_yellow: 'a yellow flower',
  flower_blue: 'a blue flower',
  flower_white: 'a white daisy',
  flower_pink: 'a pink flower',
  dino_red: 'a small red toy dinosaur',
  dino_green: 'a small green toy long-neck dinosaur',
  dino_yellow: 'a small yellow toy dinosaur with spikes',
  dino_blue: 'a small blue toy dinosaur with three horns',
  dino_purple: 'a small purple toy flying dinosaur',
  disc_gum: 'a round music record with a green gum leaf label',
  disc_forest: 'a round music record with a dark green tree label',
  disc_cave: 'a round music record with a purple crystal label',
  disc_water: 'a round music record with a blue water drop label',
  disc_star: 'a round music record with a gold star label',
  treasure_crown: 'a tiny gold crown with red jewels',
  treasure_coin: 'an old gold coin',
  treasure_pearl: 'a white pearl in an open shell',
  treasure_ring: 'a gold ring with a blue gem',
  treasure_goblet: 'a silver cup',
  treasure_gem: 'a red cut gem',
  treasure_shell: 'a shiny rainbow shell',
  wall_log: 'a square wall block made of stacked logs',
  wall_brick: 'a square block of grey stone bricks',
  wall_sandstone: 'a square block of sandy yellow bricks',
  wool_red: 'a square block of red wool',
  wool_blue: 'a square block of blue wool',
  wool_yellow: 'a square block of yellow wool',
  wool_green: 'a square block of green wool',
  wool_pink: 'a square block of pink wool',
  wool_purple: 'a square block of purple wool',
  floor_wood: 'a square tile of wooden floorboards',
  floor_stone: 'a square tile of grey stone floor',
  floor_brick: 'a square tile of red brick floor',
  path_gravel: 'a square tile of grey gravel path',
  path_stone: 'a square tile of round stepping stones',
  carpet_red: 'a square of red carpet',
  carpet_blue: 'a square of blue carpet',
  fence: 'a short section of wooden fence',
  gate: 'a small wooden garden gate',
  farmland: 'a square block of tilled brown soil',
  hay_block: 'a square golden hay bale',
  hedge_block: 'a square block of green hedge',
  snow_block: 'a square block of snow',
  jack_lantern: 'a carved pumpkin lantern with a friendly smile',
  lantern: 'a small lantern with a warm light',
  campfire: 'a small campfire',
  crafting_table: 'a wooden crafting table with tools on top',
  furnace: 'a stone furnace with a fire inside',
  chest: 'a wooden treasure chest',
  bed: 'a cosy bed with a red quilt',
  table: 'a small wooden table',
  chair: 'a wooden chair',
  rug: 'a round woven rug',
  lamp: 'a table lamp with a shade',
  bookshelf: 'a bookshelf full of colourful books',
  flower_pot: 'a flower pot with pink flowers',
  painting_star: 'a framed painting of a starry night',
  painting_sea: 'a framed painting of the sea',
  jukebox: 'a wooden music box player with a round speaker',
  sign_item: 'a small blank wooden sign on a post',
  swing: 'a garden swing on a frame',
  sandpit: 'a small square sandpit',
  pool: 'a round blue paddling pool',
  kennel_item: 'a wooden dog kennel',
  scarecrow_item: 'a friendly scarecrow',
  well_item: 'a stone well with a little roof',
  bench: 'a wooden bench',
  koala_statue: 'a small grey stone koala statue',
  xmas_tree: 'a small decorated Christmas tree',
  snowman_item: 'a small snowman with a red scarf',
  fairy_string: 'a string of colourful fairy lights',
  creeper_plush: 'a green plush toy made of cubes with a dark square face',
  toy_block: 'a big wooden toy block',
  toy_train: 'a wooden toy train engine',
  toy_robot: 'a small tin toy robot',
  toy_rocket: 'a small red and white toy rocket',
  alien_plush: 'a little green three-eyed alien plush toy',
  toy_drum: 'a small red toy drum with sticks',
  toy_boat: 'a small toy sailing boat',
  spooky_lantern: 'a purple lantern with a little bat on top',
  purple_rug: 'a round purple rug',
  bat_bunting: 'a string of small purple bat-shaped flags',
  black_pot: 'a round black cooking pot on three legs',
  cat_sofa: 'a pink sofa with cat ears on the back',
  cat_bed: 'a round pink cat bed with a cushion',
  rainbow_rug: 'a round rainbow-striped rug',
  cupcake_table: 'a round table shaped like a big pink cupcake',
  mermaid_fountain: 'a little stone fountain with a mermaid tail statue',
  star_lamp: 'a lamp shaped like a glowing yellow star',
  poppy_vase: 'a vase of red poppies',
  trophy_star: 'a gold trophy cup with a star on top',
  rocket_item: 'a tall silver model rocket painted with stars',
  mirror_item: 'a standing oval mirror',
  snow_golem: 'a snowman made of two snow blocks with a carved pumpkin head',
  photo_frame: 'a wooden picture frame holding a colourful party photo of balloons and confetti',
};
const ITEM_SINGLE = 'wishing_star';

// ---------------------------------------------------------------- ground and backdrops

/**
 * Art that is not a map object type: barrier art drawn by the view (src/game/world/things.ts) and room pieces the ground
 * baker paints into rooms (tools/map/bake.ts). Each is one image with its own prompt.
 */
const ROOM_ART: Record<string, { box: [number, number]; fill?: boolean; flat?: boolean; desc: string }> = {
  wall_boards: {
    box: [1, 1],
    fill: true,
    flat: true,
    desc: 'a square panel of a rough temporary wall: unpainted light pine boards standing upright side by side with thin dark gaps, one wide plank nailed straight across the middle, small nail heads; flat front view; the boards fill the whole square canvas edge to edge, no background showing',
  },
  building_props: {
    box: [1.7, 1.1],
    desc: 'a small neat pile of new wooden planks with a hand saw lying on top, a hammer and a little pot of paint with a brush beside it, ready to build more rooms',
  },
  door_mat: {
    box: [1, 0.66],
    flat: true,
    desc: `a cosy woven doormat, a rounded rectangle wider than it is tall, warm red and brown stripes with a cream border ${FLAT_NOTE}`,
  },
  rug_round: {
    box: [2.6, 1.9],
    flat: true,
    desc: `a big oval braided rag rug in warm rings of red, cream, mustard and soft blue ${FLAT_NOTE}`,
  },
  window_wall: {
    box: [0.9, 0.8],
    flat: true,
    desc: 'a cosy cottage window seen from inside the room, flat front view: four square panes in a white wooden frame, bright blue sky and a little cloud outside, red and white checked curtains tied back at both sides',
  },
  picture_wall: {
    box: [0.7, 0.6],
    flat: true,
    desc: 'a small framed painting hanging on a wall, flat front view: a wooden frame round a cheerful painting of green hills and a yellow sun',
  },
};

const GROUND: Record<string, string> = {
  grass:
    'grass ground texture; lush mid-green grass with gentle lighter and darker brush patches and a few tiny blade marks',
  darkgrass: 'forest floor grass ground texture; deep dark green grass with a few fallen leaves and moss patches',
  path: 'dirt path ground texture; packed light brown earth with a few tiny pebbles',
  cobble: 'cobblestone street ground texture; rounded grey and warm beige cobbles in rows',
  sand: 'beach sand ground texture; soft pale golden sand with gentle ripples',
  mud: 'mud ground texture; wet dark brown mud with shiny puddle patches',
  floor: 'indoor wooden floorboards texture; warm honey-coloured planks running left to right',
  wall_wood:
    'indoor cottage wall texture; warm brown wooden wall planks standing upright side by side with darker grooves between them',
  wall_stone: 'castle wall texture; big grey stone blocks in neat staggered rows with pale mortar lines',
  stone: 'cave stone floor ground texture; smooth grey stone with faint cracks',
  ash: 'crater ground texture; dark grey ash and cinders with a few warm ember-orange flecks',
  bridge: 'wooden bridge deck texture; weathered brown planks running left to right with small nail heads',
  steps: 'stone steps texture; wide grey stone steps running left to right',
  soil: 'farm soil ground texture; tilled dark brown earth in neat furrows running left to right',
  cliff: 'cliff rock texture; brown and grey layered rock face with ledges',
  rock: 'solid rock texture; rough grey-brown rock with cracks',
  hedge: 'hedge texture seen from above; dense green leafy hedge top',
  grass_snow: 'snowy grass ground texture; soft white snow with a few green grass tufts poking through',
  darkgrass_snow: 'snowy forest floor texture; white snow with dark green moss and needles showing through',
  path_snow: 'snowy dirt path texture; trodden snow over light brown earth',
  cobble_snow: 'snowy cobblestone street texture; grey cobbles with snow in the gaps and on top',
  sand_snow: 'frosty beach sand texture; pale sand with thin patches of white frost and snow',
};
/** Block-game terrains: generated, then snapped to a grid of big square pixels. */
const GROUND_BLOCK: Record<string, string> = {
  blockgrass: 'block-game grass ground texture; flat bright green grass made of big square pixels in several greens',
  blockgrass_snow:
    'block-game snowy ground texture; flat white snow made of big square pixels in several whites and pale blues',
};
const BLOCK_CELLS = 16;
/** Textures whose features came out too big for a 64 px tile: tiled n x n inside the 512 px texture. */
const GROUND_REPEAT: Record<string, number> = { cobble: 2, cobble_snow: 2 };
/** Not marked winter in objects.ts, but common in the Christmas layer: they fill the winter sheet. */
const WINTER_EXTRA = ['fence', 'hedge', 'signpost'];
/**
 * Added later (package 16): the Christmas layer follows the real date, so she plays all of December in it. These are the
 * commonest outdoor objects without a snow look, in their own sheets so the first winter sheets keep their contents.
 */
const WINTER_MORE = [
  ['dark_oak', 'gum_tree', 'plot_fence', 'block_oak', 'rock', 'boulder', 'hay_bale', 'stick_pile', 'burnt_tree'],
  ['fern', 'wheat_wild', 'mushroom', 'torch_stand', 'reeds', 'thorn_bush', 'log_hollow', 'workbench', 'game_post'],
];
const WINTER_MORE_BIG = ['villager_house_a', 'villager_house_b'];

const BACKDROPS: Record<string, string> = {
  bd_title:
    'a snowy night village with cosy lit cottages under one huge dark evergreen tree towering over everything; deep blue starry sky; plenty of calm empty sky at the top third for big title text',
  bd_party:
    'one huge tall evergreen fir Christmas tree at night in a snowy village square, its dark green branches covered in warm fairy lights and red and gold baubles, with a big glowing golden star on the very top; long party tables with lanterns, cakes and cups in front of it; happy warm glow',
  bd_creep:
    'the same huge evergreen tree seen closer, darker and moonlit, cold blue light, long soft shadows, a little mysterious but not scary, no decorations lit',
  bd_boom:
    'the huge evergreen tree at night with a bright white-gold burst of light where the star on top was, and seven bright streaks of coloured light flying off into the night sky in different directions',
};

// ---------------------------------------------------------------- prompts

const list = (ids: string[], d: (id: string) => string) => ids.map((id, i) => `${i + 1} ${d(id)}`).join('; ');

function objSheetPrompt(ids: string[]): string {
  const n = Math.sqrt(ids.length);
  const blocky = ids.every((id) => O[id]!.blocky);
  const mixed = !blocky && ids.some((id) => O[id]!.blocky);
  const desc = (id: string) =>
    mixed && O[id]!.blocky ? `${O[id]!.desc} (voxel block style, big square pixels)` : O[id]!.desc;
  return [
    'Use case: stylized-concept',
    'Asset type: 2D game world object sheet',
    `Primary request: a ${n} x ${n} grid of ${ids.length} separate world objects for a top-down 2D adventure game on one square canvas, one object per equal cell, left to right, top row first: ${list(ids, desc)}`,
    blocky ? BLOCK_STYLE : PROP_STYLE,
    'Composition/framing: each object centred in its cell with its base near the bottom of the cell; clear empty space between cells; no grid lines, no cell borders, no labels',
    ALPHA,
    NO_TEXT,
  ].join('\n');
}

function objSinglePrompt(id: string): string {
  const o = O[id]!;
  const flatBig = o.fill;
  return [
    'Use case: stylized-concept',
    `Asset type: 2D game world ${o.kind === 'house' ? 'building sprite' : 'object sprite'}`,
    `Primary request: ${o.desc}, for a top-down 2D adventure game`,
    flatBig
      ? `Style/medium: painted cartoon game ground decoration seen from straight above, soft shading, dark outline${o.blocky ? ', voxel block style with big square pixels' : ''}`
      : (o.blocky ? BLOCK_STYLE : PROP_STYLE).replace('props', o.kind === 'house' ? 'building' : 'prop'),
    `Composition/framing: exactly one ${o.kind === 'house' ? 'building' : 'object'}, centred, whole ${o.kind === 'house' ? 'building' : 'object'} inside the frame with a clear margin${flatBig ? '' : ', square canvas'}`,
    `${ALPHA}${o.kind === 'house' ? ', no plants around it' : ''}`,
    NO_TEXT,
  ].join('\n');
}

function roomPrompt(desc: string, flat: boolean): string {
  return [
    'Use case: stylized-concept',
    'Asset type: 2D game room decoration sprite',
    `Primary request: ${desc}, for a cosy top-down 2D adventure game`,
    flat
      ? 'Style/medium: painted cartoon game decoration, flat front-on view, soft shading, dark outline'
      : PROP_STYLE.replace('props', 'prop'),
    'Composition/framing: exactly one object, centred, whole object inside the frame with a clear margin, square canvas',
    ALPHA,
    NO_TEXT,
  ].join('\n');
}

function cropPrompt(rows: string[]): string {
  const cells = rows.flatMap((c) => CROPS[c]!);
  return [
    'Use case: stylized-concept',
    'Asset type: 2D game crop growth stages sheet',
    `Primary request: a grid of ${rows.length} rows by 3 columns of separate farm crop plants for a top-down 2D farming game, one plant per equal cell, left to right, top row first; each row is one crop growing from seedling (left) to ripe (right): ${cells.map((c, i) => `${i + 1} ${c}`).join('; ')}`,
    PROP_STYLE.replace('props', 'plants'),
    'Composition/framing: each plant centred in its cell with its base near the bottom of the cell; no soil mound, no pot; clear empty space between cells; no grid lines, no cell borders, no labels',
    ALPHA,
    NO_TEXT,
  ].join('\n');
}

function itemSheetPrompt(ids: string[], cols: number): string {
  return [
    'Use case: stylized-concept',
    'Asset type: game UI icon sheet',
    `Primary request: a ${cols} x ${ids.length / cols} grid of ${ids.length} separate game item icons on one square canvas, one icon per equal cell, left to right, top row first: ${list(ids, (id) => ITEM_DESC[id] ?? `a ${items[id]!.name}`)}`,
    'Style/medium: flat 2D cartoon game icons; flat colours with one soft highlight; bold dark outline; chunky and friendly',
    'Composition/framing: each icon centred in its cell and filling about three quarters of it; clear empty space between cells; no grid lines, no cell borders, no labels',
    'Scene/backdrop: fully transparent background (real alpha); no glow',
    'Constraints: no text, no letters, no numbers, no watermark, no white sticker outline',
  ].join('\n');
}

function groundPrompt(desc: string, blocky: boolean): string {
  const [what, look] = desc.split('; ');
  return [
    'Use case: stylized-concept',
    'Asset type: tileable game texture',
    `Primary request: seamless tileable top-down ${what} for a cosy cartoon 2D adventure game for children`,
    blocky
      ? `Style/medium: ${look}; voxel block-game look, every block a flat square; even flat lighting`
      : `Style/medium: soft hand-painted look; ${look}; even flat lighting`,
    'Composition/framing: straight top-down view filling the whole square canvas edge to edge',
    'Constraints: seamless edges; no objects, no focal elements; no text; no watermark',
  ].join('\n');
}

function backdropPrompt(desc: string): string {
  return [
    'Use case: stylized-concept',
    'Asset type: full-screen background painting for a 2D adventure game',
    `Primary request: ${desc}`,
    'Style/medium: soft painted cosy cartoon storybook look matching a children’s top-down adventure game; painted buildings with dark outlines; rich warm and cool night colours',
    'Composition/framing: landscape 16:9, full bleed edge to edge',
    'Constraints: no people, no characters, no animals, no text, no letters, no logo, no watermark',
  ].join('\n');
}

// ---------------------------------------------------------------- job lists

interface Plan {
  gen: Record<string, ArtJob[]>;
  objSlices: SheetJob[];
  itemSlices: SheetJob[];
  singles: string[];
}

/** Objects the game draws in code (src/game/world/things.ts): no picture to make, slice or fit. */
const CODE_DRAWN = new Set(['lantern_string']);
/** Objects painted by their own jobs (package 50: art/jobs/pkg50-*.json; package 57b: the house furniture,
 * art/masters/objects/painted57/furn_*.png, fitted by its job folder's furnfit.py): this planner leaves them alone. */
const OWN_JOBS =
  /^(bandstand|windmill|heeler_(?!house)|peppa_(?!house)|bing_(?!house)|shop_|block_(bookshelf|craft|bed|flowerpot))/;
const objIds = () =>
  [
    ...new Set(
      Object.values(objects)
        .map((t) => t.art ?? t.id)
        .filter((id) => !CODE_DRAWN.has(id) && !OWN_JOBS.test(id)),
    ),
  ].sort();
const itemIds = () => Object.keys(items);

function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

export function plan(): Plan {
  // coverage: every art id has a description, and sits in exactly one sheet or single
  const need = objIds();
  const missing = need.filter((id) => !O[id]);
  if (missing.length) throw new Error(`no description for objects: ${missing.join(' ')}`);
  const inSheet = Object.values(OBJ_SHEETS).flat();
  const dup = inSheet.filter((id, i) => inSheet.indexOf(id) !== i);
  if (dup.length) throw new Error(`in two sheets: ${dup.join(' ')}`);
  const singles = need.filter((id) => !inSheet.includes(id));
  const stray = inSheet.filter((id) => !need.includes(id));
  if (stray.length) throw new Error(`sheet ids that are not objects: ${stray.join(' ')}`);

  const gen: Record<string, ArtJob[]> = { objects: [], items: [], ground: [], backdrops: [] };
  const objSlices: SheetJob[] = [];
  for (const [name, ids] of Object.entries(OBJ_SHEETS)) {
    const n = Math.sqrt(ids.length);
    if (!Number.isInteger(n)) throw new Error(`sheet ${name}: ${ids.length} is not a square number`);
    const master = `art/masters/objects/sheet_${name}.png`;
    gen.objects!.push({ id: `w-obj-${name}`, out: master, prompt: objSheetPrompt(ids) });
    objSlices.push({ master, cols: n, rows: n, names: ids, out: join(STAGE, 'objects'), size: 640, outline: false });
  }
  for (const id of singles) {
    const master = `art/masters/objects/${id}.png`;
    gen.objects!.push({ id: `w-obj-${id}`, out: master, prompt: objSinglePrompt(id) });
    objSlices.push({ master, cols: 1, rows: 1, names: [id], out: join(STAGE, 'objects'), size: 1024, outline: false });
  }
  for (const [id, r] of Object.entries(ROOM_ART)) {
    const master = `art/masters/objects/${id}.png`;
    gen.objects!.push({ id: `w-room-${id}`, out: master, prompt: roomPrompt(r.desc, !!r.flat) });
    objSlices.push({ master, cols: 1, rows: 1, names: [id], out: join(STAGE, 'objects'), size: 1024, outline: false });
  }
  // crops: 3 x 3 (carrot, wheat, pumpkin) and 3 x 2 (sunflower, sugar cane)
  for (const [name, rows] of [
    ['a', ['carrot', 'wheat', 'pumpkin']],
    ['b', ['sunflower', 'sugar_cane']],
  ] as const) {
    const master = `art/masters/objects/sheet_crops_${name}.png`;
    gen.objects!.push({ id: `w-crops-${name}`, out: master, prompt: cropPrompt([...rows]) });
    objSlices.push({
      master,
      cols: 3,
      rows: rows.length,
      names: rows.flatMap((c) => [0, 1, 2].map((s) => `crop_${c}_${s}`)),
      out: join(STAGE, 'objects'),
      size: 512,
      outline: false,
    });
  }
  if (gen.objects!.some((j) => j.prompt.includes('crop'))) {
    const b = gen.objects!.find((j) => j.id === 'w-crops-b')!;
    b.prompt = b.prompt.replace(
      'Composition/framing:',
      'Composition/framing: landscape canvas, 3 cells across and 2 rows;',
    );
  }

  // items: 4 x 4 sheets in data order, one single
  const all = itemIds();
  const missingItems = all.filter((id) => !ITEM_DESC[id]);
  if (missingItems.length) console.warn(`items without a description (name used): ${missingItems.join(' ')}`);
  const sheetItems = all.filter((id) => id !== ITEM_SINGLE);
  const itemSlices: SheetJob[] = [];
  const groups = chunk(sheetItems, 16);
  groups.forEach((ids, k) => {
    // Sheets are 4 by 4, or 3 by 3 and 2 by 2 for a short last one. Sheet 14 was drawn 4 by 3 (the bow and the gear
    // of phase 2): its cells are cut by position, so it works while the item list still holds only some of its ids.
    const rowsOf: Record<number, number> = { 14: 3 };
    const fixed = rowsOf[k + 1];
    const cols = fixed ? 4 : ids.length === 16 ? 4 : ids.length === 9 ? 3 : ids.length === 4 ? 2 : 0;
    if (!cols || (fixed && ids.length > 4 * fixed))
      throw new Error(`item sheet ${k + 1} has ${ids.length} icons: needs 16, 9 or 4 (sheet 14: up to 12)`);
    const master = `art/masters/items/sheet_${String(k + 1).padStart(2, '0')}.png`;
    gen.items!.push({ id: `w-items-${k + 1}`, out: master, prompt: itemSheetPrompt(ids, cols) });
    itemSlices.push({
      master,
      cols,
      rows: fixed ?? ids.length / cols,
      names: ids,
      out: 'art/src/items',
      size: 96,
      fit: 'contain',
    });
  });
  {
    const master = `art/masters/items/${ITEM_SINGLE}.png`;
    gen.items!.push({
      id: `w-items-${ITEM_SINGLE}`,
      out: master,
      prompt: itemSheetPrompt([ITEM_SINGLE], 1).replace(
        'a 1 x 1 grid of 1 separate game item icons on one square canvas, one icon per equal cell, left to right, top row first: 1 ',
        'one game item icon on a square canvas: ',
      ),
    });
    itemSlices.push({ master, cols: 1, rows: 1, names: [ITEM_SINGLE], out: 'art/src/items', size: 96, fit: 'contain' });
  }

  for (const [name, d] of Object.entries(GROUND))
    gen.ground!.push({ id: `w-ground-${name}`, out: `art/masters/ground/${name}.png`, prompt: groundPrompt(d, false) });
  for (const [name, d] of Object.entries(GROUND_BLOCK))
    gen.ground!.push({ id: `w-ground-${name}`, out: `art/masters/ground/${name}.png`, prompt: groundPrompt(d, true) });
  for (const [name, d] of Object.entries(BACKDROPS))
    gen.backdrops!.push({ id: `w-${name}`, out: `art/masters/backdrops/${name}.png`, prompt: backdropPrompt(d) });
  return { gen, objSlices, itemSlices, singles };
}

/** Winter variants for types marked winter: buildings and trees as single images, the small ones in one sheet. */
export function winterJobs(): { gen: ArtJob[]; slices: SheetJob[] } {
  const ids = [
    ...new Set(
      Object.values(objects)
        .filter((t) => t.winter)
        .map((t) => t.art ?? t.id),
    ),
  ].sort();
  // the game draws <id>_snow for any type in the Christmas layer, so spare cells go to common props
  const small = [...ids.filter((id) => O[id]!.kind !== 'house' && O[id]!.kind !== 'big'), ...WINTER_EXTRA];
  const big = [...ids.filter((id) => !small.includes(id)), ...WINTER_MORE_BIG];
  const gen: ArtJob[] = [];
  const slices: SheetJob[] = [];
  const snowy = (d: string) =>
    `${d}, in winter: soft white snow lying on top${/\btree\b|bush|hedge/.test(d) ? ' of the branches and leaves' : /awning|roof/.test(d) ? ' and on the roof' : ''}, a few icicles`;
  for (const id of big) {
    const o = O[id]!;
    const master = `art/masters/objects/${id}_snow.png`;
    const ref = `art/masters/objects/${id}.png`;
    gen.push({
      id: `w-obj-${id}_snow`,
      out: master,
      refs: [ref],
      prompt: `Image 1 shows a game ${o.kind === 'house' ? 'building' : 'object'}. Make the same ${o.kind === 'house' ? 'building' : 'object'}, same shape, colours, view and framing, in winter: soft white snow lying on top${o.kind === 'house' ? ' of the roof and window sills' : ''}, a few icicles. Keep a fully transparent background (real alpha); no ground, no cast shadow, no glow; no text.`,
      alts: [objSinglePrompt(id).replace(o.desc, snowy(o.desc))],
    });
    slices.push({
      master,
      cols: 1,
      rows: 1,
      names: [`${id}_snow`],
      out: join(STAGE, 'objects'),
      size: 1024,
      outline: false,
    });
  }
  const sheets = [...chunk(small, 9), ...WINTER_MORE.map((g) => [...g])];
  sheets.forEach((g, k) => {
    while (![1, 4, 9].includes(g.length)) g.push(g[g.length - 1]!);
    const n = Math.sqrt(g.length);
    const master = `art/masters/objects/sheet_winter_${k + 1}.png`;
    const p = objSheetPrompt(g).replace(/: 1 .*$/m, `: ${list(g, (id) => snowy(O[id]!.desc))}`);
    gen.push({ id: `w-obj-winter-${k + 1}`, out: master, prompt: p });
    const seen = new Set<string>();
    slices.push({
      master,
      cols: n,
      rows: n,
      names: g.map((id) => {
        if (seen.has(id)) return '';
        seen.add(id);
        return `${id}_snow`;
      }),
      out: join(STAGE, 'objects'),
      size: 640,
      outline: false,
    });
  });
  return { gen, slices };
}

// ---------------------------------------------------------------- painted props (phase 2, part G)
// The other game's painted props where they beat ours, and our most seen trees and buildings redrawn in that style
// (D21, PHASE2 part G). Masters live in art/masters/objects/painted/; their slices are cut after every other set, so
// they replace the older art of the same id. Same footprint and box as before: the fit step sizes them as it did.
//   node tools/art/world.ts painted jobs    writes art/jobs/world-gen-painted.json and world-slice-painted.json
//   node tools/art/world.ts painted copy    the chosen props of the other game -> painted masters (PNG)
//   node tools/art/world.ts painted slice   painted masters -> the stage folder (then: fit <ids>)
const PAINTED = 'art/masters/objects/painted';
const CODEX_ASSETS = join(homedir(), 'dev/amelia-gpt/game/assets');
/** our object id -> the other game's prop it takes (chosen side by side at screen size) */
const PAINTED_COPY: Record<string, string> = {
  treehouse: 'gum',
  mine_mouth: 'mine',
  garden_bench: 'bench',
  rock: 'rock',
  mailbox: 'letterbox',
  sign: 'sign',
  game_post: 'bell',
};
/** copied props that have a Christmas variant: drawn under snow from the copy */
const PAINTED_COPY_SNOW = ['treehouse', 'rock', 'game_post'];
/** style guide pictures for the image tool: the other game's painted props */
const STYLE_REFS = ['hut', 'coop'].map((n) => join(CODEX_ASSETS, `${n}.webp`));
const TREE_REFS = ['willow', 'gum'].map((n) => join(CODEX_ASSETS, `${n}.webp`));
const PAINT_STYLE =
  'Style/medium: a hand-painted storybook game picture in the same painting style as the style reference pictures: warm soft paint with a little brush texture, gentle light from the top left, soft painted edges, no dark outline, no white outline, no sticker border, calm natural colours, three-quarter view from above (the front and a little of the top visible)';
const PAINTED_TREES: Record<string, string> = {
  oak: 'a round leafy oak tree with a sturdy brown trunk',
  dark_oak:
    'a broad dark oak tree with a thick dark brown trunk and a deep green canopy made of a few big soft squarish clumps (a nod to a block-building game, but painted, not pixelated)',
  gum_tree: 'a eucalyptus gum tree with a smooth pale cream and grey trunk and airy grey-green leaf clusters',
  birch: 'a slim birch tree with a white trunk with dark marks and light green leaves',
};
/** redrawn one picture each, with today's art as the layout reference */
const PAINTED_SINGLES = [
  'cottage',
  'great_tree',
  'workshop',
  'stall',
  'heeler_house',
  'bing_house',
  'peppa_house',
  'great_tree_lit',
  // follow-up: the rest of the buildings
  'cafe',
  'post_office',
  'nanny_nook',
  'school',
  'greenhouse',
  'villager_house_a',
  'villager_house_b',
  'lighthouse',
  'lookout',
  'cardboard_fort',
];
/** extra words for a redraw */
const PAINT_NOTE: Record<string, string> = {
  villager_house_a: 'Keep its chunky look of big square blocks, painted with soft brushwork, not pixelated.',
  villager_house_b: 'Keep its chunky look of big square blocks, painted with soft brushwork, not pixelated.',
  cardboard_fort: 'Keep it looking home-made from brown cardboard boxes.',
};
/** small things share a sheet; every id here keeps its old box (fences fill their tile's width, so a run joins) */
const PAINTED_SMALL: { name: string; cols: number; rows: number; items: Record<string, string> }[] = [
  {
    name: 'small',
    cols: 3,
    rows: 3,
    items: {
      plot_fence:
        'one straight section of a low rustic wooden rail fence seen from the front: one round wooden post in the middle and two long level rails, both rails running straight from the left end to the right end of the section and reaching past the post on both sides, nothing else',
      fence:
        'one straight section of a white painted wooden picket fence seen from the front: four evenly spaced pointed pickets on two level rails, the rails reaching a little past the outer pickets at both ends',
      bush: 'a round soft leafy green bush',
      fern: 'a low leafy green fern',
      grass_tuft: 'a small low tuft of soft grass blades in muted green',
      lone_flower: 'one small white wild daisy with a yellow centre and two leaves',
      torch_stand:
        'a wooden torch post with a bright warm flame on top, standing upright (a square wooden stick as a nod to a block-building game, painted, not pixelated)',
      lamp_post: 'an old-fashioned black iron street lamp post with a warm lit lantern on top',
      signpost: 'a wooden signpost with two blank arrow boards pointing left and right',
    },
  },
  {
    name: 'flowers',
    cols: 3,
    rows: 2,
    items: {
      flower_red: 'a small low clump of red wild flowers with green leaves',
      flower_yellow: 'a small low clump of yellow wild flowers with green leaves',
      flower_pink: 'a small low clump of pink wild flowers with green leaves',
      flower_blue: 'a small low clump of blue wild flowers with green leaves',
      flower_white: 'a small low clump of white daisies with green leaves',
      apple_tree: 'a round apple tree with shiny red apples among its leaves and a sturdy brown trunk',
    },
  },
];
const SMALL_REFS = ['flowers', 'bench'].map((n) => join(CODEX_ASSETS, `${n}.webp`));
/** trees given the taller box (see boxFor) */
const TALL_TREES = new Set([...Object.keys(PAINTED_TREES), 'apple_tree']);
/** painted ground textures for the bake: masters in art/masters/ground/painted/, made seamless by `ground` */
const PAINTED_GROUND: Record<string, { desc: string; ref: string; to: [number, number, number]; contrast: number }> = {
  darkgrass: {
    desc: 'forest floor seen from straight above: deep green grass painted in soft clumps of lighter and darker green, a little moss and a few small fallen leaves, gentle light and shade so it does not look flat',
    ref: 'grass',
    // as deep as the old forest floor, with twice the light and shade of the picture
    to: [52, 92, 30],
    contrast: 2.2,
  },
  path_snow: {
    desc: 'a trodden snowy dirt path seen from straight above: smooth soft white and pale blue snow, evenly spread, with only a few faint warm brown earth marks showing through, no big blotches',
    ref: 'path',
    // warmer than the snow on grass (217, 231, 245), so the path still reads under snow
    to: [226, 214, 200],
    contrast: 2.5,
  },
};

export function paintedIds(): string[] {
  const small = PAINTED_SMALL.flatMap((g) => Object.keys(g.items));
  const ids = [...Object.keys(PAINTED_COPY), ...Object.keys(PAINTED_TREES), ...PAINTED_SINGLES, ...small];
  return [
    ...ids,
    ...[...PAINTED_COPY_SNOW, ...Object.keys(PAINTED_TREES), ...PAINTED_SINGLES, ...small].map((id) => `${id}_snow`),
  ];
}

export function paintedJobs(): { gen: ArtJob[]; slices: SheetJob[] } {
  const gen: ArtJob[] = [];
  const slices: SheetJob[] = [];
  const stage = join(STAGE, 'objects');
  const single = (id: string) =>
    slices.push({
      master: `${PAINTED}/${id}.png`,
      cols: 1,
      rows: 1,
      names: [id],
      out: stage,
      size: 1024,
      outline: false,
    });
  const kindOf = (id: string) =>
    O[id]!.kind === 'house' ? 'building' : /tree/.test(id) ? 'tree' : id === 'stall' ? 'market stall' : 'object';
  for (const id of Object.keys(PAINTED_COPY)) single(id);
  // trees: one 2 x 2 sheet, then the same sheet under snow
  const trees = Object.keys(PAINTED_TREES);
  const grid = (ds: string[]) =>
    `a 2 x 2 grid of 4 separate trees on one square canvas, one tree per equal cell, each tree whole and centred in its cell with clear space round it, left to right, top row first: ${ds.map((d, i) => `${i + 1} ${d}`).join('; ')}`;
  gen.push({
    id: 'p-trees',
    out: `${PAINTED}/sheet_trees.png`,
    refs: TREE_REFS,
    prompt: [
      'Images 1 and 2 are style references only: paint in their style, do not copy what they show.',
      PAINT_STYLE,
      `Composition/framing: ${grid(Object.values(PAINTED_TREES))}. Each tree stands on its own trunk base; no ground, no grass under it, no shadow.`,
      ALPHA,
      NO_TEXT,
    ].join('\n'),
  });
  gen.push({
    id: 'p-trees-snow',
    out: `${PAINTED}/sheet_trees_snow.png`,
    refs: [`${PAINTED}/sheet_trees.png`],
    prompt: `Image 1 shows four painted game trees in a 2 x 2 grid. Make the same four trees in the same grid, same shapes, colours, painting style, view and framing, in winter: soft white snow lying on top of the branches and leaves, no icicles. ${ALPHA}; ${NO_TEXT.toLowerCase()}.`,
  });
  slices.push({
    master: `${PAINTED}/sheet_trees.png`,
    cols: 2,
    rows: 2,
    names: trees,
    out: stage,
    size: 640,
    outline: false,
  });
  slices.push({
    master: `${PAINTED}/sheet_trees_snow.png`,
    cols: 2,
    rows: 2,
    names: trees.map((t) => `${t}_snow`),
    out: stage,
    size: 640,
    outline: false,
  });
  for (const id of PAINTED_SINGLES) {
    const kind = kindOf(id);
    const before = `art/qa/painted-before/${id}.png`;
    const lit = id === 'great_tree_lit';
    const what = lit
      ? `Image 1 is a painted ${kind}. Make the same ${kind}, same shape, size, colours, painting style, view and framing, now decorated for Christmas like Image 2: ${O[id]!.desc.replace(/^one huge ancient evergreen Christmas tree, very wide and tall, /, '')}.`
      : `Image 1 is a ${kind} from our game. Redraw it as one new picture: the same ${kind} with the same shape, layout, proportions, colours and framing as Image 1${kind === 'building' ? ', the front door in the same place in the middle of the front wall at the bottom, the base as wide as in Image 1, a warm light glowing in each window' : ''}. It is ${O[id]!.desc}. Images 2 and 3 are style references only: paint in their style, do not copy what they show.`;
    gen.push({
      id: `p-${id}`,
      out: `${PAINTED}/${id}.png`,
      refs: lit ? [`${PAINTED}/great_tree.png`, before] : [before, ...(kind === 'tree' ? TREE_REFS : STYLE_REFS)],
      prompt: [
        what,
        lit ? '' : PAINT_STYLE,
        PAINT_NOTE[id] ?? '',
        'Calm and simple: no extra props, no people, no animals, nothing busy.',
        `${ALPHA}`,
        NO_TEXT,
      ]
        .filter(Boolean)
        .join('\n'),
    });
    single(id);
  }
  for (const id of [...PAINTED_COPY_SNOW, ...PAINTED_SINGLES]) {
    const kind = PAINTED_COPY[id] ? 'object' : kindOf(id);
    gen.push({
      id: `p-${id}_snow`,
      out: `${PAINTED}/${id}_snow.png`,
      refs: [`${PAINTED}/${id}.png`],
      prompt: `Image 1 shows a painted game ${kind}. Make the same ${kind}, same shape, colours, painting style, view and framing, in winter: soft white snow lying on top${kind === 'building' ? ' of the roof and window sills, windows still glowing warm' : kind === 'market stall' ? ' of the awning and the counter' : /tree/.test(id) ? ' of the branches' : ''}, a few small icicles. ${ALPHA}; ${NO_TEXT.toLowerCase()}.`,
    });
    single(`${id}_snow`);
  }
  // small things: one sheet each, then the same sheet under snow
  for (const g of PAINTED_SMALL) {
    const ids = Object.keys(g.items);
    const n = ids.length;
    const master = `${PAINTED}/sheet_${g.name}.png`;
    const snowMaster = `${PAINTED}/sheet_${g.name}_snow.png`;
    const canvas = g.cols === g.rows ? 'one square canvas' : 'one landscape canvas';
    gen.push({
      id: `p-sheet-${g.name}`,
      out: master,
      refs: SMALL_REFS,
      prompt: [
        'Images 1 and 2 are style references only: paint in their style, do not copy what they show.',
        PAINT_STYLE,
        `Composition/framing: a ${g.cols} x ${g.rows} grid of ${n} separate game objects on ${canvas}, one object per equal cell, each whole and centred in its cell with clear space round it, all at the same scale as if standing side by side, left to right, top row first: ${Object.values(
          g.items,
        )
          .map((d, i) => `${i + 1} ${d}`)
          .join('; ')}. No ground, no grass under them, no shadow.`,
        ALPHA,
        NO_TEXT,
      ].join('\n'),
    });
    gen.push({
      id: `p-sheet-${g.name}_snow`,
      out: snowMaster,
      refs: [master],
      prompt: `Image 1 shows ${n} painted game objects in a ${g.cols} x ${g.rows} grid. Make the same ${n} objects in the same grid, same shapes, colours, painting style, view and framing, in winter: soft white snow lying on top of them, no icicles; lamps and flames still glowing warm. ${ALPHA}; ${NO_TEXT.toLowerCase()}.`,
    });
    const cut = (m: string, names: string[]) =>
      slices.push({ master: m, cols: g.cols, rows: g.rows, names, out: stage, size: 640, outline: false });
    cut(master, ids);
    cut(
      snowMaster,
      ids.map((id) => `${id}_snow`),
    );
  }
  for (const [name, t] of Object.entries(PAINTED_GROUND))
    gen.push({
      id: `p-ground-${name}`,
      out: `art/masters/ground/painted/${name}.png`,
      refs: [join(CODEX_ASSETS, `${t.ref}.webp`)],
      prompt: [
        'Image 1 is a style reference only: paint in its style, do not copy it.',
        'Asset type: seamless tileable game ground texture',
        `Primary request: ${t.desc}`,
        'Style/medium: soft hand-painted storybook look with a little brush texture, calm natural colours, even light',
        'Composition/framing: straight top-down view filling the whole square canvas edge to edge',
        'Constraints: seamless edges; no objects, no focal elements; no text; no watermark',
      ].join('\n'),
    });
  return { gen, slices };
}

async function paintedCopy(): Promise<void> {
  mkdirSync(join(ROOT, PAINTED), { recursive: true });
  for (const [id, theirs] of Object.entries(PAINTED_COPY)) {
    const out = join(ROOT, PAINTED, `${id}.png`);
    if (existsSync(out)) continue;
    await sharp(join(CODEX_ASSETS, `${theirs}.webp`))
      .png({ compressionLevel: 9 })
      .toFile(out);
  }
  // today's art of every redrawn single, kept as the layout reference (and the "before" picture)
  const qa = join(ROOT, 'art/qa/painted-before');
  mkdirSync(qa, { recursive: true });
  for (const id of PAINTED_SINGLES) {
    const out = join(qa, `${id}.png`);
    if (!existsSync(out)) await sharp(join(ROOT, 'art/src/objects', `${id}.png`)).toFile(out);
  }
  console.log(`painted: ${Object.keys(PAINTED_COPY).length} props copied, ${PAINTED_SINGLES.length} layout references`);
}

function writeJobs(): void {
  const p = plan();
  const w = winterJobs();
  const dir = join(ROOT, 'art/jobs');
  mkdirSync(dir, { recursive: true });
  const put = (name: string, v: unknown) => writeFileSync(join(dir, name), JSON.stringify(v, null, 2) + '\n');
  for (const [k, v] of Object.entries(p.gen)) put(`world-gen-${k}.json`, v);
  put('world-gen-winter.json', w.gen);
  put('world-gen-all.json', [...p.gen.objects!, ...p.gen.items!, ...p.gen.ground!, ...p.gen.backdrops!]);
  put('world-slice-objects.json', p.objSlices);
  put('world-slice-items.json', p.itemSlices);
  put('world-slice-winter.json', w.slices);
  const n = Object.values(p.gen).reduce((a, v) => a + v.length, 0);
  console.log(
    `world: ${n} images (${p.gen.objects!.length} objects incl. ${p.singles.length} singles and 2 crop sheets, ${p.gen.items!.length} items, ${p.gen.ground!.length} ground, ${p.gen.backdrops!.length} backdrops); winter ${w.gen.length}`,
  );
}

// ---------------------------------------------------------------- after generation

async function slice(jobs: SheetJob[]): Promise<string[]> {
  const failed: string[] = [];
  for (const j of jobs) {
    if (!existsSync(resolve(ROOT, j.master))) {
      failed.push(`${j.master} (not made)`);
      continue;
    }
    try {
      await processSheets([j]);
    } catch (e) {
      failed.push(`${j.master}: ${(e as Error).message}`);
    }
  }
  if (failed.length) console.log(`slice problems:\n  ${failed.join('\n  ')}`);
  return failed;
}

/** The target box of an object or crop in px. */
function boxFor(name: string): { w: number; h: number; fill: boolean } {
  const crop = /^crop_\w+_(\d)$/.exec(name);
  if (crop) {
    const [w, h] = CROP_BOX[Number(crop[1])]!;
    return { w: w * PX, h: h * PX, fill: false };
  }
  const base = name.replace(/_snow$/, '');
  const r = ROOM_ART[base];
  if (r) return { w: Math.round(r.box[0] * PX), h: Math.round(r.box[1] * PX), fill: !!r.fill };
  const o = O[base]!;
  const t = Object.values(objects).find((x) => (x.art ?? x.id) === base)!;
  const fw = t.w ?? 1;
  const fh = t.h ?? 1;
  // painted trees are broader for their height: a wider box keeps them as tall as before, so the treetop fade
  // (src/game/world/things.ts) still catches her on the tile above a trunk
  let box = TALL_TREES.has(base) ? ([2.1, 2.6] as [number, number]) : o.box;
  if (!box) {
    if (o.kind === 'tree') box = [1.9, 2.5];
    else if (o.kind === 'house' || o.kind === 'big') box = [fw, fh + 1.8];
    else if (o.kind === 'pick') box = [0.6, 0.7];
    else if (o.kind === 'flat') box = [fw, fh];
    else box = [fw * 0.95, fh + 0.9];
  }
  return { w: Math.round(box[0] * PX), h: Math.round(box[1] * PX), fill: !!o.fill };
}

/**
 * Peel light, colourless pixels off the silhouette edge: leftovers of a white haze or checkerboard round the dark outline
 * the style asks for. Only edge pixels go, a pass at a time.
 */
function defringe(img: Img, passes: number): void {
  const { w, h, d } = img;
  // first: any near-white region that touches the outside (haze left in the hollows under branches)
  const white = (i: number) =>
    d[i * 4 + 3]! > 0 &&
    Math.min(d[i * 4]!, d[i * 4 + 1]!, d[i * 4 + 2]!) > 200 &&
    Math.max(d[i * 4]!, d[i * 4 + 1]!, d[i * 4 + 2]!) - Math.min(d[i * 4]!, d[i * 4 + 1]!, d[i * 4 + 2]!) < 30;
  const out = (i: number) => d[i * 4 + 3] === 0;
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (!white(i)) continue;
    const x = i % w;
    const y = (i - x) / w;
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || out(i - 1) || out(i + 1) || out(i - w) || out(i + w)) {
      seen[i] = 1;
      stack.push(i);
    }
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    for (const q of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w])
      if (q >= 0 && q < w * h && !seen[q] && white(q)) {
        seen[q] = 1;
        stack.push(q);
      }
  }
  for (let i = 0; i < w * h; i++) if (seen[i]) d[i * 4 + 3] = 0;
  for (let p = 0; p < passes; p++) {
    const kill: number[] = [];
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!d[i * 4 + 3]) continue;
        const edge =
          x === 0 ||
          y === 0 ||
          x === w - 1 ||
          y === h - 1 ||
          !d[(i - 1) * 4 + 3] ||
          !d[(i + 1) * 4 + 3] ||
          !d[(i - w) * 4 + 3] ||
          !d[(i + w) * 4 + 3];
        if (!edge) continue;
        const r = d[i * 4]!;
        const g = d[i * 4 + 1]!;
        const bl = d[i * 4 + 2]!;
        const lum = r * 0.299 + g * 0.587 + bl * 0.114;
        if (Math.min(r, g, bl) > 150 || (lum > 200 && Math.max(r, g, bl) - Math.min(r, g, bl) < 40)) kill.push(i);
      }
    if (!kill.length) return;
    for (const i of kill) d[i * 4 + 3] = 0;
  }
}

/** Objects with no white of their own whose masters left white haze in enclosed gaps (between leaves). */
const HAZE_HOLES = ['oak', 'pine', 'orange_tree', 'apple_tree'];
function clearWhite(img: Img): void {
  const d = img.d;
  for (let i = 0; i < img.w * img.h; i++)
    if (
      Math.min(d[i * 4]!, d[i * 4 + 1]!, d[i * 4 + 2]!) > 190 &&
      Math.max(d[i * 4]!, d[i * 4 + 1]!, d[i * 4 + 2]!) - Math.min(d[i * 4]!, d[i * 4 + 1]!, d[i * 4 + 2]!) < 30
    )
      d[i * 4 + 3] = 0;
}

/** Clear loose crumbs of a hazy background (blobs under 1 percent of the biggest): they would widen the art box. */
export function dropCrumbs(img: Img): void {
  const mask = new Uint8Array(img.w * img.h);
  for (let i = 0; i < mask.length; i++) mask[i] = img.d[i * 4 + 3]! > 0 ? 1 : 0;
  const { labels, blobs } = components(mask, img.w, img.h);
  const big = Math.max(0, ...blobs.map((x) => x.area));
  const drop = new Set(blobs.filter((x) => x.area < big * 0.01).map((x) => x.label));
  if (drop.size) for (let i = 0; i < mask.length; i++) if (drop.has(labels[i]!)) img.d[i * 4 + 3] = 0;
}

async function fitObjects(only: Set<string> | null = null): Promise<void> {
  const src = join(STAGE, 'objects');
  const out = join(ROOT, 'art/src/objects');
  mkdirSync(out, { recursive: true });
  const files = existsSync(src)
    ? readdirSync(src).filter((f) => f.endsWith('.png') && (!only || only.has(f.replace(/\.png$/, ''))))
    : [];
  // painted art has no dark outline to stop the peel: pale trunks, white walls and snow would be eaten
  const painted = new Set(paintedIds());
  for (const f of files) {
    const name = f.replace(/\.png$/, '');
    let img = await load(join(src, f));
    if (painted.has(name)) dropCrumbs(img);
    const b = alphaBox(img);
    if (!b) continue;
    img = crop(img, b);
    if (!/snow|^web$/.test(name) && !painted.has(name)) defringe(img, 8);
    if (HAZE_HOLES.includes(name)) clearWhite(img);
    const box = boxFor(name);
    let w: number;
    let h: number;
    if (box.fill) {
      w = box.w;
      h = box.h;
    } else {
      const k = Math.min(box.w / img.w, box.h / img.h);
      w = Math.max(1, Math.round(img.w * k));
      h = Math.max(1, Math.round(img.h * k));
    }
    const art = await resize(img, w, h);
    const pad = 2;
    const canvas = blank(w + pad * 2, h + pad);
    over(canvas, art, pad, 0);
    await toSharp(canvas).png({ compressionLevel: 9 }).toFile(join(out, f));
  }
  console.log(`fit: ${files.length} objects -> art/src/objects`);
}

/** Wrap-blend so the texture tiles: the edges come from a half-shifted copy, which is seamless across the wrap. */
function seamless(px: Uint8Array, n: number, ch: number): Uint8Array {
  const out = new Uint8Array(px.length);
  const band = n / 4;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const e = Math.min(x, n - 1 - x, y, n - 1 - y);
      const t = Math.min(1, e / band);
      const wgt = t * t * (3 - 2 * t);
      const sx = (x + n / 2) % n;
      const sy = (y + n / 2) % n;
      for (let c = 0; c < ch; c++)
        out[(y * n + x) * ch + c] = Math.round(
          px[(y * n + x) * ch + c]! * wgt + px[(sy * n + sx) * ch + c]! * (1 - wgt),
        );
    }
  return out;
}

async function ground(only: Set<string> | null = null): Promise<void> {
  const out = join(ROOT, 'art/src/ground');
  mkdirSync(out, { recursive: true });
  const N = 512;
  let n = 0;
  for (const name of [...Object.keys(GROUND), ...Object.keys(GROUND_BLOCK)]) {
    if (only && !only.has(name)) continue;
    // a painted master (phase 2) wins over the older one
    const painted = join(ROOT, 'art/masters/ground/painted', `${name}.png`);
    const file = existsSync(painted) ? painted : join(ROOT, 'art/masters/ground', `${name}.png`);
    if (!existsSync(file)) continue;
    const { data } = await sharp(file)
      .removeAlpha()
      .resize(N, N, { fit: 'cover' })
      .raw()
      .toBuffer({ resolveWithObject: true });
    let px = seamless(new Uint8Array(data.buffer, data.byteOffset, data.length), N, 3);
    const grade = file === painted ? PAINTED_GROUND[name] : undefined;
    if (grade) px = regrade(px, grade.to, grade.contrast, 0.25);
    const rep = GROUND_REPEAT[name] ?? 1;
    if (rep > 1) {
      // smaller features: shrink the seamless texture and tile it
      const m = N / rep;
      const { data: small } = await sharp(Buffer.from(px), { raw: { width: N, height: N, channels: 3 } })
        .resize(m, m)
        .raw()
        .toBuffer({ resolveWithObject: true });
      const t = new Uint8Array(px.length);
      for (let y = 0; y < N; y++)
        for (let x = 0; x < N; x++)
          for (let k = 0; k < 3; k++) t[(y * N + x) * 3 + k] = small[((y % m) * m + (x % m)) * 3 + k]!;
      px = t;
    }
    if (GROUND_BLOCK[name]) {
      // average into big square cells; a grid of flat cells tiles by itself
      const c = N / BLOCK_CELLS;
      const q = new Uint8Array(px.length);
      for (let by = 0; by < BLOCK_CELLS; by++)
        for (let bx = 0; bx < BLOCK_CELLS; bx++) {
          const sum = [0, 0, 0];
          for (let y = 0; y < c; y++)
            for (let x = 0; x < c; x++)
              for (let k = 0; k < 3; k++) sum[k]! += px[((by * c + y) * N + bx * c + x) * 3 + k]!;
          for (let y = 0; y < c; y++)
            for (let x = 0; x < c; x++)
              for (let k = 0; k < 3; k++) q[((by * c + y) * N + bx * c + x) * 3 + k] = Math.round(sum[k]! / (c * c));
        }
      px = q;
    }
    await sharp(Buffer.from(px), { raw: { width: N, height: N, channels: 3 } })
      .png({ compressionLevel: 9 })
      .toFile(join(out, `${name}.png`));
    n++;
  }
  console.log(`ground: ${n} textures -> art/src/ground`);
}

async function backdrops(): Promise<void> {
  const out = join(ROOT, 'art/src/ui');
  mkdirSync(out, { recursive: true });
  let n = 0;
  for (const name of Object.keys(BACKDROPS)) {
    const file = join(ROOT, 'art/masters/backdrops', `${name}.png`);
    if (!existsSync(file)) continue;
    await sharp(file)
      .removeAlpha()
      .ensureAlpha()
      .resize(1280, 720, { fit: 'cover' })
      .png({ compressionLevel: 9 })
      .toFile(join(out, `${name}.png`));
    n++;
  }
  console.log(`backdrops: ${n} -> art/src/ui`);
}

async function contact(): Promise<void> {
  mkdirSync(QA, { recursive: true });
  const take = (dir: string, re = /\.png$/) =>
    existsSync(dir)
      ? readdirSync(dir)
          .filter((f) => re.test(f))
          .sort()
          .map((f) => join(dir, f))
      : [];
  const objs = take(join(ROOT, 'art/src/objects'));
  for (const [k, part] of chunk(objs, 48).entries()) await contactSheet(join(QA, `objects-${k + 1}.png`), part, 8, 200);
  const its = take(join(ROOT, 'art/src/items'));
  for (const [k, part] of chunk(its, 80).entries()) await contactSheet(join(QA, `items-${k + 1}.png`), part, 10, 128);
  const gr = take(join(ROOT, 'art/src/ground'));
  if (gr.length) await contactSheet(join(QA, 'ground.png'), gr, 6, 256);
  const bd = take(join(ROOT, 'art/src/ui'), /^bd_.*\.png$/);
  if (bd.length) await contactSheet(join(QA, 'backdrops.png'), bd, 2, 640);
  console.log(`contact sheets -> ${QA}`);
}

if (import.meta.main) {
  const [mode, what] = process.argv.slice(2);
  if (mode === 'jobs') writeJobs();
  else if (mode === 'slice' || mode === 'all') {
    const p = plan();
    if (mode === 'all' || !what || what === 'objects') await slice(p.objSlices);
    if (mode === 'all' || !what || what === 'items') await slice(p.itemSlices);
    if (mode === 'all' || what === 'winter')
      await slice(winterJobs().slices.filter((j) => existsSync(resolve(ROOT, j.master))));
    // painted art last, so it replaces the older art of the same id whatever else was cut
    if (what !== 'items') await slice(paintedJobs().slices.filter((j) => existsSync(resolve(ROOT, j.master))));
    if (mode === 'all') {
      await fitObjects();
      await ground();
      await backdrops();
      await contact();
    }
  } else if (mode === 'fit') await fitObjects(what ? new Set(what.split(',')) : null);
  else if (mode === 'painted') {
    const p = paintedJobs();
    if (what === 'jobs') {
      const dir = join(ROOT, 'art/jobs');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'world-gen-painted.json'), JSON.stringify(p.gen, null, 2) + '\n');
      writeFileSync(join(dir, 'world-slice-painted.json'), JSON.stringify(p.slices, null, 2) + '\n');
      console.log(`painted: ${p.gen.length} images to make, ${p.slices.length} slices`);
    } else if (what === 'copy') await paintedCopy();
    else if (what === 'slice') await slice(p.slices.filter((j) => existsSync(resolve(ROOT, j.master))));
    else console.log('usage: node tools/art/world.ts painted jobs|copy|slice');
  } else if (mode === 'ground') await ground(what ? new Set(what.split(',')) : null);
  else if (mode === 'backdrops') await backdrops();
  else if (mode === 'contact') await contact();
  else if (mode === 'prompt' && what) {
    const p = plan();
    const all = [...Object.values(p.gen).flat(), ...winterJobs().gen, ...paintedJobs().gen];
    console.log(all.find((j) => j.id === what)?.prompt ?? 'no such job');
  } else
    console.log(
      'usage: node tools/art/world.ts jobs | slice [objects|items|winter|painted] | fit [id,id] | painted jobs|copy|slice | ground | backdrops | contact | all | prompt <job id>',
    );
}
