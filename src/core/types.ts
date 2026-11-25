// Shared shapes for the rules (src/core), the content (src/data) and the view (src/game).
// Nothing in here touches Phaser, the DOM, the wall clock or Math.random.
import type { GuideRt } from './guide.ts';

export type Dir = 'down' | 'up' | 'left' | 'right';
export type Clip =
  | 'idle'
  | 'walk'
  | 'talk'
  | 'wave'
  | 'swing'
  | 'fish'
  | 'cheer'
  | 'hurt'
  | 'sleep'
  | 'attack'
  | 'hop'
  | 'dizzy'
  | 'calm'
  /** package 74: an animal's look up (its "sit" trick) */
  | 'look';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Pt {
  x: number;
  y: number;
}
/** A named spot: an area and a tile position (centre of the tile unless fractional). */
export interface Place extends Pt {
  area: string;
  r?: number;
  label?: string;
}

// ---------------------------------------------------------------- conditions and effects

/** A small test on the save. Every listed part must hold. */
export interface Cond {
  /** quest ids that must be done */
  done?: string | string[];
  /** quest id that must be active (optionally at or past a step) */
  active?: string;
  atStep?: [quest: string, min: number, max?: number];
  flag?: string | string[];
  noFlag?: string | string[];
  /** number of shards won back, at least */
  shards?: number;
  hero?: string;
  notHero?: string;
  christmas?: boolean;
  night?: boolean;
  /** package 78: the lighthouse lamp shines tonight and nobody has remarked on it yet tonight */
  lamp?: boolean;
  day?: number;
  has?: Record<string, number>;
  /** package 47a: the cups of this mini-game are open (she played it first on an earlier day) */
  cup?: string;
  any?: Cond[];
  not?: Cond;
}

/** Things that happen when a step or quest completes. */
export interface Effects {
  give?: Record<string, number>;
  take?: Record<string, number>;
  emeralds?: number;
  recipes?: string[];
  flags?: string[];
  clear?: string[];
  stickers?: string[];
  hearts?: number;
  shard?: number;
  mail?: string[];
  /** a letter that is in the mailbox at once, not next morning */
  mailNow?: string[];
  /** the nearest wild animal of this kind becomes her pet (not implemented yet: see passover) */
  pet?: string;
  /** extra goes on the claw machine (not implemented yet: see passover) */
  claw?: number;
  /** ask the view to open a menu or screen (ignored when playing headless) */
  open?: string;
  hero?: string;
  cut?: string;
  /** set the clock: jump forward to this phase today (never backwards) */
  time?: 'dusk' | 'night' | 'morning';
  toast?: string;
  music?: string;
  /** start another quest at once */
  start?: string;
  spawn?: { mob: string; n: number; at: string }[];
  /** Mum's hug: red hearts full, blue hearts back, and the hearts fill on screen even when they were full */
  hug?: boolean;
}

// ---------------------------------------------------------------- content: items, recipes, objects

export type ItemKind =
  | 'material'
  | 'tool'
  | 'food'
  | 'seed'
  | 'crop'
  | 'block'
  | 'furniture'
  | 'key'
  | 'find'
  | 'fish'
  | 'toy'
  | 'disc'
  | 'gift';
export type ToolType =
  | 'sword'
  | 'axe'
  | 'pick'
  | 'spade'
  | 'rod'
  | 'bucket'
  | 'wellies'
  | 'boat'
  | 'bow'
  | 'helmet'
  | 'armour';
/** The four things she can wear (package 31 and 32 contract). */
export type GearSlot = 'sword' | 'bow' | 'helmet' | 'armour';
export type StickerPage =
  | 'friends'
  | 'mobs'
  | 'fish'
  | 'beach'
  | 'flowers'
  | 'ores'
  | 'food'
  | 'joeys'
  | 'longdogs'
  | 'dinos'
  | 'potato'
  | 'discs'
  | 'treasures'
  | 'creatures'
  | 'places';

export interface PlaceDef {
  layer: 'floor' | 'object';
  solid?: boolean;
  w?: number;
  h?: number;
  light?: number;
  /** behaviour when placed */
  use?:
    | 'table'
    | 'furnace'
    | 'chest'
    | 'bed'
    | 'sign'
    | 'jukebox'
    | 'soil'
    | 'fence'
    | 'gate'
    | 'seat'
    | 'toy'
    | 'mirror'
    | 'anvil'
    | 'stand'
    /** the cooking pot (package 41): food made beside it comes out double */
    | 'pot';
  /** where it may go: the plot outside, the cottage inside, or both (default) */
  where?: 'plot' | 'house';
  rot?: boolean;
}
export interface ItemDef {
  id: string;
  name: string;
  /** plural name when it is not name + "s" */
  names?: string;
  kind: ItemKind;
  stack?: number;
  sell?: number;
  /** half-hearts restored when eaten */
  heal?: number;
  tool?: { type: ToolType; tier: number };
  /** armour: blue shield hearts it gives while worn (whole hearts) */
  shield?: number;
  place?: PlaceDef;
  /** seeds: the crop they grow into and the mornings it takes */
  grows?: { crop: string; days: number; n: number };
  page?: StickerPage;
  /** lives in the pouch: cannot be dropped, sold or lost */
  pouch?: boolean;
  /** shows its picture the first time its name is used on screen */
  gloss?: boolean;
  desc?: string;
}
export interface RecipeDef {
  id: string;
  out: string;
  n: number;
  in: Record<string, number>;
  at: 'table' | 'furnace';
  /** known from the start */
  start?: boolean;
}
export interface YieldDef {
  item: string;
  min: number;
  max: number;
  /** chance from 0 to 1; default 1 */
  p?: number;
}
export type Interact =
  | 'talk'
  | 'sign'
  | 'signpost'
  | 'bed'
  | 'mailbox'
  | 'mirror'
  | 'table'
  | 'furnace'
  | 'chest'
  | 'door'
  | 'board'
  | 'bounty'
  | 'stall'
  | 'claw'
  | 'jukebox'
  | 'naturetable'
  | 'present'
  | 'well'
  | 'minecart'
  | 'boat'
  | 'socket'
  | 'pickup'
  | 'bottle'
  | 'dig'
  | 'radar'
  | 'prize'
  | 'photo'
  | 'play'
  /** package 57a (D62): a thing to play on; ObjectType.fun says how */
  | 'fun'
  /** package 73b: the Post Office counter and pigeon holes (src/core/post.ts) */
  | 'post'
  /** package 73b: the school blackboard's quiz (src/core/quiz.ts) */
  | 'quiz'
  /** package 73b: one of her three greenhouse pots (src/core/pots.ts) */
  | 'grow'
  /** package 73a (I2): the lighthouse lamp (src/core/lamp.ts) */
  | 'lamp'
  /** package 73a (I3): a telescope or a window to look out of (src/core/lookout.ts) */
  | 'look';
/** Package 57a (D62): the little turn a thing to play on gives her (src/core/fun.ts). */
export type FunMove =
  | 'bounce'
  | 'swing'
  | 'slide'
  | 'ride'
  | 'sit'
  | 'pat'
  | 'splash'
  | 'dance'
  | 'hide'
  | 'warm'
  | 'stack'
  | 'seesaw'
  | 'peek'
  | 'wave'
  | 'play'
  | 'drum'
  /** package 71: digging in a sandpit (a sandpit's 'pat'): a castle grows */
  | 'dig';
/**
 * Where she goes on a thing to play on, in tiles from its top-left corner (feet), where a friend who joins in goes,
 * and where a slide or a ride takes her. No `at`: she stays where she stands.
 */
export interface FunSpot {
  move: FunMove;
  at?: [number, number];
  mate?: [number, number];
  to?: [number, number];
}
/** A turn on a thing to play on, while it runs (package 57a). Positions in tiles. */
export interface FunRun {
  move: FunMove;
  /** the map object (index in the area) or -1, and the placed thing's key or 0 */
  obj: number;
  placed: number;
  t: number;
  secs: number;
  /** where she stood before, where she plays, where a slide ends (or how far a ride goes) */
  x0: number;
  y0: number;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  dir: Dir;
  /** the friend who joins in (npc key, 0 none): the way there, the spot, and where they started */
  friend: number;
  fpath: number[] | null;
  fpi: number;
  fx: number;
  fy: number;
  fx0: number;
  fy0: number;
  /** seconds since the friend got there, -1 while on the way */
  ft: number;
  /** sounds already played, so each plays once per beat */
  beat: number;
  /** package 71: digging: the sandcastle it builds (a key of `Runtime.castles`) */
  castle?: string;
  /** package 74 (I8): on a swing, the turn's times of her good pushes (at most 3), and when she jumps off */
  pushes?: number[];
  leap?: number;
}
/** Package 71 (D78): a sandcastle on a sandpit, for the rest of the game day (run-time only, never saved). */
export interface Castle {
  area: string;
  /** where it stands, in tiles (its foot) */
  x: number;
  y: number;
  /** the game day it was built on: the next morning it is gone */
  day: number;
  /** 0 nothing yet, 1 a heap, 2 towers, 3 a flag on top */
  stage: number;
}
export interface ObjectType {
  id: string;
  /** footprint in tiles; default 1 x 1 */
  w?: number;
  h?: number;
  solid?: boolean;
  /** art id; default is the type id */
  art?: string;
  /** drawn flat on the ground, under everything that stands */
  flat?: boolean;
  /** a resource: hit it to gather */
  node?: {
    tool?: ToolType;
    tier?: number;
    hits: number;
    yield: YieldDef[];
    /** grows back next morning; otherwise gone for good */
    regrow?: boolean;
    /** stays solid when used up (a stump); otherwise it disappears until it regrows */
    stump?: boolean;
    verb: string;
    sfx?: string;
  };
  interact?: Interact;
  light?: number;
  /** frames of gentle world animation (sway, smoke, water) */
  frames?: number;
  /** snow or festive variant exists */
  winter?: boolean;
  /** name for signs and the hint strip */
  name?: string;
  /** breaks when a creeper blast reaches it */
  cracked?: boolean;
  /** package 57a: a thing to play on (interact 'fun') */
  fun?: FunSpot;
}
export interface MapObj {
  id: string;
  type: string;
  x: number;
  y: number;
  if?: Cond;
  /** free data: sign text id, door target, stall id, item id of a pickup, site id */
  d?: string;
}
export interface Barrier {
  id: string;
  rect: Rect;
  /** flag that opens it */
  flag: string;
  /** message shown when she walks into it */
  hint: string;
  art?: string;
}
export interface SpawnZone {
  id: string;
  region: string;
  rect: Rect;
  mobs: string[];
  mode: 'night' | 'always';
  max: number;
}
export interface BuildSite {
  id: string;
  name: string;
  rect: Rect;
  needs: Record<string, number>;
  /** flag set when it is finished (opens barriers, swaps art) */
  flag: string;
  if?: Cond;
  /** where she stands to hand things over */
  at: Pt;
}
export interface Door {
  x: number;
  y: number;
  to: string;
  tx: number;
  ty: number;
  dir: Dir;
  if?: Cond;
  hint?: string;
}
export interface AreaDef {
  id: string;
  name: string;
  w: number;
  h: number;
  /** one character per tile, row by row: see TERRAIN in grid.ts */
  terrain: string[];
  /** one character per tile: region code */
  region: string[];
  objects: MapObj[];
  barriers: Barrier[];
  zones: SpawnZone[];
  sites: BuildSite[];
  doors: Door[];
  places: Record<string, Place>;
  /** dark inside: needs light */
  dark?: boolean;
  indoor?: boolean;
  music?: string;
}
export interface RegionDef {
  id: string;
  code: string;
  name: string;
  /** quick travel signpost place name */
  sign?: string;
  /** always safe at night */
  safe?: boolean;
  /** shard number that lights it */
  shard?: number;
  blocky?: boolean;
  music: string;
  /** how tough mobs are here: the health of a zombie (3 near home); others scale with it. Bosses keep their own. */
  tough?: number;
}

// ---------------------------------------------------------------- content: characters and mobs

export type Role = 'hero' | 'walker' | 'fixed' | 'speakingMob' | 'hostile' | 'animal' | 'boss';
export type BodyType = 'biped' | 'quad' | 'bird' | 'blob' | 'spider';
export interface Spot {
  at: string;
  dir?: Dir;
  if?: Cond;
  /** tiles she may amble from the spot; 0 keeps her still */
  roam?: number;
  /** hidden indoors at night */
  dayOnly?: boolean;
  /**
   * A guest found out in the world (package 41 contract): this spot is used only while the flag is unset; talking
   * to the guest here sets it, and from the next morning (one arrival a morning, announced by a card) the guest
   * stands at the first later spot whose `if` holds, usually `if: { flag: '<the same flag>' }` at home.
   */
  found?: string;
  nightOnly?: boolean;
}
export interface CharDef {
  id: string;
  /** display name, or a token such as {mum} filled from personal.json */
  name: string;
  role: Role;
  group: string;
  body: BodyType;
  /** who takes over when this character is the hero */
  standIn?: string;
  /** first matching spot wins; none means not on the island right now */
  spots: Spot[];
  /** things said when there is nothing more important; first matching pool wins, lines rotate */
  chat: { if?: Cond; lines: string[] }[];
  /** height on screen in tiles, feet to top; default 2 */
  tall?: number;
  /** a service she keeps */
  service?: string;
  speed?: number;
  /** sticker earned on first talk */
  noSticker?: boolean;
  /**
   * A friend who may drop in on a comfortable morning (package 41 contract): the present they bring (an item id and
   * how many) and their one box of words, shown on the morning card. The visit is the card: nobody extra stands at home.
   */
  visit?: { gift: string; n?: number; line: string };
}
export interface HeroDef {
  id: string;
  /** shown from the start, or unlocked by a friend line */
  starter: boolean;
  emote: string;
  /** lines only this hero gets */
  lines: Record<string, string>;
}
export type MobAi = 'chase' | 'creeper' | 'ranged' | 'hopper' | 'ender' | 'jockey' | 'king' | 'mini';
export interface MobDef {
  id: string;
  name: string;
  /** hits of a wooden sword */
  hp: number;
  speed: number;
  /** half-hearts on touch (Normal); Gentle halves it */
  touch: number;
  ai: MobAi;
  drops: YieldDef[];
  role: Role;
  body: BodyType;
  tall?: number;
  /** friendly by day */
  dayFriendly?: boolean;
  sfx?: string;
}
export interface AnimalDef {
  id: string;
  name: string;
  food: string;
  gives?: { item: string; needs?: string };
  body: BodyType;
  tall?: number;
  sfx: string;
}

// ---------------------------------------------------------------- content: quests and dialogue

/** "speaker: words". Speaker is a character id, "you" (the hero) or "say" (a plain caption). */
export type Line = string | { l: string; if?: Cond; choices?: { text: string; then?: Line[]; fx?: Effects }[] };

export type Step =
  | ({ t: 'talk'; who: string } & StepCommon)
  | ({ t: 'fetch'; item: string; n?: number } & StepCommon)
  | ({ t: 'deliver'; item: string; n?: number; to: string } & StepCommon)
  | ({ t: 'craft'; item: string; n?: number } & StepCommon)
  | ({ t: 'place'; item: string; n?: number } & StepCommon)
  | ({ t: 'site'; site: string } & StepCommon)
  | ({ t: 'defeat'; mob: string; n?: number; zone?: string } & StepCommon)
  /** `clear`: things in the way (map object ids); the step is done once they are all cut, chopped or shot, as well as
   * when she gets to `place` (G, 22 Nov 2026: "cut the bushes" finished only once she had crossed the bridge) */
  | ({ t: 'reach'; place: string; clear?: string[] } & StepCommon)
  | ({ t: 'fish'; kind?: string; n?: number } & StepCommon)
  | ({ t: 'grow'; crop: string; n?: number } & StepCommon)
  | ({ t: 'lead'; animal: string; pen: string; n?: number } & StepCommon)
  | ({ t: 'mini'; game: string; stars?: number } & StepCommon)
  | ({ t: 'sleep' } & StepCommon)
  | ({ t: 'night'; place: string } & StepCommon)
  /** make a piece in this gear slot +1 (package 44a: the first time crafting makes her stronger, on the path once) */
  | ({ t: 'upgrade'; slot: 'sword' | 'bow' } & StepCommon);
export interface StepCommon {
  /** lines when the step is done (talk and deliver: what the two of you say) */
  say?: Line[];
  /** the same lines when a stand-in is speaking for a playable character */
  sayAlt?: Line[];
  fx?: Effects;
  /** replaces the built objective line (must start with a verb) */
  goal?: string;
  /** where the helper arrow points when the step has no place of its own */
  mark?: string;
  /** package 60: the goal line while the step's place is off the screen (at most 5 words: "Cross the creek") */
  far?: string;
  /** things put in the world while this step is the current one */
  drop?: { item: string; at: string }[];
}
export interface QuestDef {
  id: string;
  name: string;
  kind: 'main' | 'side' | 'friend' | 'bounty';
  chapter?: number;
  region: string;
  giver: string;
  /** play style for the scope check */
  style?: 'explore' | 'craft' | 'fight' | 'animals';
  /** group of the giver for the scope check */
  group?: string;
  requires?: Cond;
  /** starts by itself the moment it is allowed (main story) */
  auto?: boolean;
  /** offered at the noticeboard instead of by the giver in person */
  board?: boolean;
  repeat?: boolean;
  steps: Step[];
  /** the giver's lines when offering, and when she comes back with every step done */
  open?: Line[];
  close?: Line[];
  openAlt?: Line[];
  closeAlt?: Line[];
  rewards?: Effects;
  /** things given or taught the moment the quest starts (parcels to carry, the recipe it is about) */
  onStart?: Effects;
  /** what she can see afterwards */
  visible: string;
  /** on the timed main path for the playtime report */
  path?: boolean;
  /**
   * Package 70: the quest opens with a morning card. The first morning `if` holds (and no one else has a card), `who` drops in with the present
   * (the card of a friend who came to see her) and the flag `card:<quest id>` is set: put that flag in `requires`.
   * `home` are friends who count as arrived from then on (they need no card of their own to stand in the Square).
   */
  card?: { who: string; gift: string; n?: number; if?: Cond; home?: string[] };
}
export interface CutAct {
  /** a: actor does something; say: a line; wait: seconds; cam: move the camera; fx: effect; bg: backdrop on or off */
  a:
    | 'spawn'
    | 'move'
    | 'face'
    | 'clip'
    | 'hide'
    | 'say'
    | 'wait'
    | 'cam'
    | 'fx'
    | 'bg'
    | 'sfx'
    | 'music'
    | 'light'
    | 'do';
  who?: string;
  at?: string;
  x?: number;
  y?: number;
  dir?: Dir;
  clip?: Clip;
  l?: string;
  s?: number;
  id?: string;
  fx?: Effects;
  /** do not wait for this act to finish before starting the next */
  go?: boolean;
  speed?: number;
}
export interface CutsceneDef {
  id: string;
  acts: CutAct[];
  /** stage: a painted backdrop id, or the live world */
  backdrop?: string;
}
export interface LetterDef {
  id: string;
  /** who it is from: a character id for letters the game wrote, or "personal" for Dad's own words in personal.json */
  from: string;
  gift?: Record<string, number>;
  /** pages of a letter the game wrote (personal letters keep their words in personal.json) */
  text?: string[];
}
export interface StickerDef {
  id: string;
  page: StickerPage;
  name: string;
  art: string;
  /** a part of a set (one fish, one joey): a quiet record that lands its set's sticker in the journal */
  of?: string;
  /** a place sticker: the region she walks into, or the area or named spot (within r tiles) she gets to */
  spot?: { region?: string; area?: string; at?: string; r?: number };
}
/**
 * A landmark (package 41 contract): one of the about 20 places she finds by coming within `r` tiles (default 3) of
 * a named spot on the island, or by walking into an area. Its Places sticker is 'place_' + id. Its one small find
 * is a chest or a note (a map object placed beside it, by id) or a view (a line the view may show with the name).
 */
export interface LandmarkDef {
  id: string;
  name: string;
  /** a named spot (any area), or with `area` the whole area */
  at?: string;
  area?: string;
  r?: number;
  /** picture for the journal */
  art: string;
  find: { kind: 'chest' | 'note' | 'view'; obj?: string; line?: string };
}
/**
 * A mob den (package 41 contract): a ring of stones around a named spot. Stepping inside the ring starts wave 1;
 * when it is beaten wave 2 comes; when that is beaten the den is cleared, flag 'den_' + id is set and its chest
 * (a map object with `if: { flag: 'den_<id>' }`) appears. Nothing respawns in a cleared den.
 */
export interface DenDef {
  id: string;
  name: string;
  /** centre of the ring: a named spot on the island */
  at: string;
  region: string;
  /** radius of the ring in tiles: stepping inside starts the fight */
  r: number;
  /** mob ids of the two waves (the mob caps still hold: the rest wait their turn) */
  waves: [string[], string[]];
  /** what the chest holds, in the loot form of a map object's d ("diamond:1,emerald:6") */
  chest: string;
}
export interface StallDef {
  id: string;
  name: string;
  keeper: string;
  sells: { item: string; price: number; if?: Cond; recipe?: string; stock?: number; once?: boolean }[];
  buys?: boolean;
}
export interface FishDef {
  id: string;
  /** places (water kinds) and times it bites */
  water: ('sea' | 'river' | 'pond' | 'cave')[];
  time?: 'day' | 'night';
  weight: number;
}

export interface Content {
  items: Record<string, ItemDef>;
  recipes: Record<string, RecipeDef>;
  objects: Record<string, ObjectType>;
  areas: Record<string, AreaDef>;
  regions: Record<string, RegionDef>;
  chars: Record<string, CharDef>;
  heroes: Record<string, HeroDef>;
  mobs: Record<string, MobDef>;
  animals: Record<string, AnimalDef>;
  quests: Record<string, QuestDef>;
  questOrder: string[];
  cutscenes: Record<string, CutsceneDef>;
  letters: Record<string, LetterDef>;
  stickers: Record<string, StickerDef>;
  stalls: Record<string, StallDef>;
  fish: Record<string, FishDef>;
  strings: Record<string, string>;
  /** package 41: the landmarks and the four dens (src/data/world.ts) */
  landmarks: Record<string, LandmarkDef>;
  dens: Record<string, DenDef>;
  /** package 73b: the island friends' notes at the Post Office (words in strings `post:<n>`), and the quiz's words */
  post?: PostNoteDef[];
  words?: string[];
  /** package 78: place names (keys) that are not somewhere a person "is at": things lying about, animals, people (world.ts) */
  whereSkip?: string[];
}
/** Package 73b: who an island friend's note at the Post Office is from, and the emeralds inside (if any). */
export interface PostNoteDef {
  from: string;
  gems?: number;
}

// ---------------------------------------------------------------- the save

export interface Slot {
  id: string;
  n: number;
}
export interface Placed {
  /** unique id, never reused */
  k: number;
  item: string;
  area: string;
  x: number;
  y: number;
  rot?: number;
  text?: string;
}
export interface Crop {
  x: number;
  y: number;
  seed: string;
  /** mornings grown so far */
  age: number;
}
export interface AnimalState {
  k: number;
  kind: string;
  name?: string;
  area: string;
  x: number;
  y: number;
  /** id of the pen it lives in, once home */
  pen?: string;
  /** following the hero */
  led?: boolean;
  /** a pet: follows her everywhere (a wolf helps in fights; a cat lives at the cottage) */
  pet?: boolean;
  /** has something to give this morning */
  ready?: boolean;
  /** where it started, to return to when the lead is dropped */
  hx: number;
  hy: number;
}
export interface QuestState {
  /** current step index; steps.length means "go back to the giver" */
  step: number;
  /** progress count inside the step */
  n: number;
  done?: boolean;
  /** times finished (repeatable quests) */
  times?: number;
  /** day it was last finished */
  day?: number;
}
export interface Options {
  gentle: boolean;
  helper: boolean;
  christmas: 'auto' | 'on' | 'off';
  music: number;
  sound: number;
  lowFx: boolean;
}
export interface GameState {
  v: number;
  seed: number;
  rng: number;
  hero: string;
  koala: string;
  area: string;
  x: number;
  y: number;
  dir: Dir;
  /** half-hearts */
  hp: number;
  maxHp: number;
  day: number;
  /** seconds since this morning */
  time: number;
  /** steps played in total */
  ticks: number;
  emeralds: number;
  /** slots 0 to 7 are the hotbar, the rest the bag */
  bag: (Slot | null)[];
  hot: number;
  pouch: Record<string, number>;
  recipes: string[];
  flags: Record<string, number>;
  quests: Record<string, QuestState>;
  tracked: string | null;
  shards: number;
  stickers: Record<string, number>;
  /** everyone she has talked to: character id to the day they first met (its own record, not a sticker) */
  met: Record<string, number>;
  gloss: string[];
  heroes: string[];
  /** resource objects used up: object id to the day it was used */
  nodes: Record<string, number>;
  /** one-off things taken or done: object ids */
  taken: Record<string, number>;
  placed: Placed[];
  nextK: number;
  chests: Record<string, (Slot | null)[]>;
  crops: Crop[];
  animals: AnimalState[];
  /** things lying on the ground; `put`: she put it down herself and has not walked away yet (package 57a) */
  drops: { area: string; x: number; y: number; id: string; n: number; put?: boolean }[];
  /** letters waiting in the mailbox, and letters already read */
  inbox: string[];
  letters: string[];
  /** stall stock bought today: "stall:item" to count */
  bought: Record<string, number>;
  /** signposts found */
  signs: string[];
  /** best stars per mini-game */
  stars: Record<string, number>;
  /** package 47a: the best cup won in each mini-game at its post (1 bronze, 2 silver, 3 gold) */
  cups: Record<string, 0 | 1 | 2 | 3>;
  /** counts for stats and bounties: "mob:zombie", "chop", ... */
  counts: Record<string, number>;
  /** chat rotation per character */
  chatAt: Record<string, number>;
  /** times each one-time hint has been shown */
  hints: Record<string, number>;
  houseSize: number;
  pets: { kind: string; name: string }[];
  opts: Options;
  /** real hero name fallbacks are in personal.json; this is the Christmas switch as decided at load */
  xmas: boolean;
  /** what she wears: an item id per slot, or '' (gear contract) */
  gear: Record<GearSlot, string>;
  /** upgrades: item id to 0, 1 or 2 */
  plus: Record<string, number>;
  /** blue shield hearts left, in half hearts like hp */
  shield: number;
  // ---- package 41: home and island
  /** places she has found: the 15 region ids and the landmark ids */
  places: Record<string, 1>;
  /** the cloud over the island map: one bit per cell of SEEN_CELL tiles, packed six to a character (src/core/island.ts) */
  seen: string;
  /** dens: 1 seen, 2 cleared */
  dens: Record<string, 1 | 2>;
  /** who came to stay this morning ('' when nobody): the view shows the morning card */
  arrive: string;
  /** guests who have come home and been announced (a guest due at home but not in here waits for a morning) */
  home: Record<string, 1>;
  /** a friend who dropped in this morning with a present, or null */
  visit: { who: string; gift: string; n: number } | null;
}

// ---------------------------------------------------------------- runtime (never saved)

export type Mode = 'play' | 'talk' | 'cut' | 'mini' | 'build' | 'card' | 'fishing';

export interface Actor {
  /** unique runtime id */
  k: number;
  /** character id, mob id or animal kind */
  id: string;
  kind: 'npc' | 'mob' | 'animal' | 'actor';
  area: string;
  x: number;
  y: number;
  /** position one step ago, for smooth drawing */
  px: number;
  py: number;
  dir: Dir;
  clip: Clip;
  /** seconds into the clip */
  ct: number;
  hidden?: boolean;
  /** package 74 (I10): her own pet: the trick it is doing (1 sit, 2 spin, 3 jump, 0 none) and seconds into it */
  trick?: number;
  trickT?: number;
  /** package 74 (I10): her pet lies down indoors (on a rug, or by the door) */
  rest?: boolean;
}
export interface Npc extends Actor {
  kind: 'npc';
  /** home spot */
  hx: number;
  hy: number;
  roam: number;
  /** path being walked: flat list of tile coordinates, and the index of the next one */
  path: number[] | null;
  pi: number;
  wait: number;
  /** quest marker: 0 none, 1 has a quest to give, 2 is the target of the tracked step, 3 service */
  mark: number;
  talkT: number;
  /** package 67: seconds she has pressed into this person (src/core/people.ts) */
  push?: number;
  /** seconds left of stepping out of her way */
  aside?: number;
  /** she may pass through (a doorway, a one-tile lane, nowhere to step to) until she is clear of them */
  pass?: boolean;
}
export interface Mob extends Actor {
  kind: 'mob';
  hp: number;
  /** ai state and timer */
  st: number;
  t: number;
  vx: number;
  vy: number;
  hurtT: number;
  zone: string;
  /** boss phase, fuse and the like */
  phase: number;
  fuse: number;
  /** the length of the fuse that is burning (the view fills the ring by it) */
  fuseLen?: number;
  /** calmed or friendly: will not hurt */
  calm?: boolean;
  /** dies without drops (despawn) */
  gone?: boolean;
  tag?: string;
  /** a spare counter for boss patterns */
  n2?: number;
  /** asleep where it stands: too many of its kind are already after her (the creeper and mob caps) */
  doze?: boolean;
  /** package 69: seconds out of her reach in a fight (after 3 it comes back to her), its way back, and where on it */
  away?: number;
  way?: number[] | null;
  wi?: number;
}
export interface Shot {
  k: number;
  area: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  kind: 'arrow' | 'ring' | 'snowball';
  r: number;
  hostile: boolean;
  /** her arrows: damage, and the mob they bend towards */
  dmg?: number;
  tgt?: number;
  /** package 69: a mob's arrow: the mob that shot it (a hit marks who did it) */
  from?: number;
  /** package 69: her arrow aimed at a high web (its object index): the first arrow that reaches it brings it down */
  web?: number;
}
export interface TalkRt {
  lines: Line[];
  i: number;
  /** the speaker actually on screen (after stand-ins) and their words, ready for the view */
  who: string;
  text: string;
  choices: string[] | null;
  pick: number;
  /** characters shown so far, for the typewriter */
  shown: number;
  /** what to do when the last line closes */
  then: (() => void) | null;
  /** the npc being spoken to, to turn and animate */
  npc: number;
}
export interface CutRt {
  id: string;
  i: number;
  t: number;
  actors: Record<string, Actor>;
  cam: Pt | null;
  backdrop: string | null;
  /** acts still running in the background */
  moving: { who: string; tx: number; ty: number; speed: number }[];
  then: (() => void) | null;
  dark: number;
}
export interface BuildRt {
  cx: number;
  cy: number;
  /** index into the list of placeable items in the bag */
  sel: number;
  rot: number;
}
export interface FishRt {
  /** 0 cast, 1 waiting, 2 bite, 3 landed, 4 got away */
  st: number;
  t: number;
  fx: number;
  fy: number;
  fish: string | null;
}
export interface CardRt {
  kind: 'tomorrow' | 'carried' | 'chapter' | 'shard';
  lines: string[];
  title: string;
  t: number;
  then: (() => void) | null;
}

/** One step of input. Menus in the view send commands; the solver sends them directly. */
export interface Input {
  mx: number;
  my: number;
  /** Space or Enter went down this step */
  act: boolean;
  /** Space is held */
  hold: boolean;
  /** X or Backspace went down */
  back: boolean;
  /** X (only X) went down: the bow shoots in play */
  fire?: boolean;
  /** X is held: held for 1 second it skips a story scene */
  holdX?: boolean;
  /** R went down: use the picked hotbar item */
  use: boolean;
  /** G went down: emote */
  emote: boolean;
  cmd: Cmd | null;
}
export type Cmd =
  | { c: 'craft'; recipe: string; times?: number }
  | { c: 'hot'; i: number }
  | { c: 'move'; from: number; to: number }
  /** package 74 (I11): T in the bag sorts it; N pins or unpins the thing on a bottom button */
  | { c: 'tidy' }
  | { c: 'pin'; slot: number }
  | { c: 'chest'; chest: string; from: number; toChest: boolean }
  | { c: 'drop'; slot: number }
  | { c: 'eat'; slot: number }
  | { c: 'track'; quest: string }
  | { c: 'build'; on: boolean }
  | { c: 'bsel'; d: number }
  | { c: 'place'; item: string; x: number; y: number; rot?: number; text?: string }
  | { c: 'remove'; x: number; y: number }
  | { c: 'buy'; stall: string; i: number; n?: number }
  | { c: 'sell'; slot: number; n?: number }
  | { c: 'travel'; sign: string }
  | { c: 'hero'; id: string }
  | { c: 'koala'; name: string }
  | { c: 'sleep' }
  | { c: 'read'; letter: string }
  | { c: 'choose'; i: number }
  | { c: 'opt'; key: keyof Options; value: number | boolean | string }
  | { c: 'accept'; quest: string }
  | { c: 'signtext'; k: number; text: string }
  | { c: 'name'; k: number; name: string }
  | { c: 'photo'; friends: string[] }
  | { c: 'wear'; item: string }
  | { c: 'unwear'; slot: GearSlot }
  | { c: 'upgrade'; item: string }
  | { c: 'debug'; what: string; arg?: string | number }
  /** H: the hint for now (src/core/hints.ts) */
  | { c: 'hint' }
  /** package 69: Escape on a start or end card or a question: the kind answer ("Not now") */
  | { c: 'back' };

export type Ev =
  | { t: 'sfx'; id: string; x?: number; y?: number }
  | { t: 'fx'; id: string; x: number; y: number; n?: number; item?: string; area?: string }
  | {
      t: 'toast';
      kind: 'item' | 'recipe' | 'quest' | 'step' | 'sticker' | 'heart' | 'hero' | 'info' | 'mail' | 'shard';
      text: string;
      item?: string;
      n?: number;
    }
  | {
      t: 'reward';
      kind:
        | 'item'
        | 'sticker'
        | 'recipe'
        | 'step'
        | 'quest'
        | 'friend'
        | 'secret'
        | 'heart'
        | 'shard'
        | 'hero'
        | 'region'
        | 'mail';
      id: string;
    }
  | { t: 'act'; kind: string; id?: string }
  /** package 47a: a cup was won at a game post (1 bronze, 2 silver, 3 gold) */
  | { t: 'cup'; game: string; tier: 1 | 2 | 3 }
  | { t: 'shake'; amt: number }
  | { t: 'flash'; color?: number }
  | { t: 'music'; id: string }
  | { t: 'save' }
  | { t: 'area'; from: string; to: string }
  | { t: 'open'; ui: string; arg?: string }
  | { t: 'bubble'; k: number; text: string }
  | { t: 'map' }
  | { t: 'light'; region: string }
  /** package 41: a region or landmark was found (its name shows without stopping play) */
  | { t: 'place'; id: string }
  /** package 41: a den was seen, a wave began (wave 1 or 2), or it was cleared */
  | { t: 'den'; id: string; kind: 'seen' | 'wave' | 'clear'; wave?: number }
  /** package 41: the morning card: a guest has come to stay */
  | { t: 'arrive'; who: string }
  /** package 41: the morning card: a friend dropped in with a present (already in her bag) */
  | { t: 'visit'; who: string; gift: string; n: number }
  /**
   * Gear for the view. 'ask': new or better gear arrived; the view shows "Put it on? Space" in its message queue and
   * sends `wear` when Space is pressed while it shows (the rules do not handle that Space). 'worn' and 'off': a slot
   * changed. 'upgrade': an item became +1 or +2. 'shieldHurt' and 'shieldBack': the blue hearts changed.
   * Opening menus uses 'open' with ui 'gear' (the armour stand) and 'upgrade' (Grandad's workbench, an anvil).
   */
  | {
      t: 'gear';
      kind: 'ask' | 'worn' | 'off' | 'upgrade' | 'shieldHurt' | 'shieldBack';
      item?: string;
      slot?: GearSlot;
    };

export interface Runtime {
  mode: Mode;
  tick: number;
  /** the region she was last seen in, so the goal can follow the place she walks into (package 46) */
  here?: string;
  /** collision per area: 1 is blocked */
  solid: Record<string, Uint8Array>;
  /** index into area.objects per tile, or -1 */
  objAt: Record<string, Int32Array>;
  /** objects that are present right now (their if-conditions hold), per area */
  live: Record<string, Uint8Array>;
  /** bumped whenever solid or live changes, so the view can refresh */
  worldRev: number;
  npcs: Npc[];
  mobs: Mob[];
  shots: Shot[];
  nextK: number;
  talk: TalkRt | null;
  cut: CutRt | null;
  build: BuildRt | null;
  fish: FishRt | null;
  card: CardRt | null;
  mini: MiniRt | null;
  /** hero animation */
  clip: Clip;
  ct: number;
  px: number;
  py: number;
  swingT: number;
  hurtT: number;
  safeT: number;
  /** package 69: seconds since the last hit on her, and toward the next heart that comes back by itself */
  calmT?: number;
  healT?: number;
  /** package 69: hearts are low and there is food in the bag: the strip shows "R: Eat" */
  eatHint?: boolean;
  /** package 69: a fight step's star keeps to one enemy (and where it was last seen) so the arrow never flips */
  foe?: { key: string; k: number; area: string; x: number; y: number };
  /** package 69: the person a talk just ended with takes no Space until this tick */
  talkCool?: { k: number; until: number };
  /** package 69: people who said their small talk, by npc k, at this quest revision (once a step) */
  chatted?: Record<number, number>;
  emoteT: number;
  /** what Space would do now, for the hint strip */
  hint: string;
  hintObj: number;
  /** where the helper arrow points, or null */
  target: Place | null;
  /** how far the star stands above the target, in tiles (0: centred on a thing on the ground) */
  targetUp: number;
  /** issue 65: out of arrows by a high web on the way: what to get first ('make' at a bench, or 'stick' or 'feather') */
  restock?: string;
  /** seconds until the next autosave */
  saveT: number;
  /** quests whose giver has something to say, refreshed when quest state changes */
  questRev: number;
  /** the thing being held by a build site hand-over, a mirror and so on */
  ui: string | null;
  spawnT: number;
  ambientT: number;
  /** first-fight lesson given this session */
  lastHitBy: string;
  nearSecret: boolean;
  /** hero is standing in mud, water edge and so on, for the view */
  under: string;
  /** things waiting for play to resume: talks, cards, cutscenes */
  q: (() => void)[];
  /** the world changed: rebuild collision and people at the end of the step */
  dirty: boolean;
  /** pause for menus: the view sets it, the rules only run commands */
  paused: boolean;
  /** names from personal.json: token to display name */
  names: Record<string, string>;
  /** a running lesson or nudge shown as a caption under the objective */
  nudge: string;
  nudgeT: number;
  /** package 68: a step's talk held back a second so its filled count can be seen */
  sayLater?: { lines: Line[]; t: number };
  /** package 68: seconds the bed rests after she wakes (Space does not put her to bed again) */
  bedT?: number;
  /** the animal being led, by key, or 0 */
  leading: number;
  /** actors standing in for animals this session */
  beasts: Actor[];
  /** last step's direction keys, to turn a held key into one move in menus and build mode */
  navX: number;
  navY: number;
  navT: number;
  /** progress of a held X towards skipping the scene, 0 to 1, for the view's ring */
  skip: number;
  /** X is still down from the last skip: let go first */
  skipHeld: boolean;
  /** seconds until the bow can shoot again */
  bowT: number;
  /** a scene or a talk has just ended: ask for a save at the next moment of play */
  saveDue: boolean;
  /** gear that asked "Put it on?" and is waiting for an answer, and seconds left to answer ('' when none) */
  ask: string;
  askT: number;
  /** more gear that came while a question was up: asked in turn */
  askQ: string[];
  /** package 41: the den fight under way (its wave, and how many of that wave are still to beat), or null */
  den: { id: string; wave: number; left: number } | null;
  /** the struggling rule and the one hint it may be showing (src/core/hints.ts) */
  help: HelpRt;
  /** package 57a: a turn on a thing to play on, while it runs */
  fun?: FunRun | null;
  /** package 71: sandcastles by sandpit (area and object index, or area and placed key) */
  castles?: Record<string, Castle>;
  /** package 74 (I10): how many tricks her pet has done, so the next is the next in turn */
  tricks?: number;
  /** package 73a (I3): looking out over the island, while it shows (src/core/lookout.ts) */
  look?: LookRt | null;
  /** package 60: the walkable way to the goal for the helper arrow (src/core/guide.ts), made when first asked for */
  guide?: GuideRt;
  /** package 60: a menu was open last step, and seconds after one closed in which Space opens no bench again */
  wasPaused?: boolean;
  shutT?: number;
  /**
   * package 73b (D81): the December post by the real date, from the view (0 before December, the date in December, 25
   * from Christmas Day on), and the days that have one of Dad's notes in this copy's personal file (none for a player)
   */
  today?: number;
  dec?: number[];
}

/** Package 73a (I3): the island from above, shown for a few seconds from a telescope or a lamp room window. */
export interface LookRt {
  /** the object looked out of (its id, or its d): its `sign:` line shows once afterwards */
  id: string;
  /** seconds shown so far */
  t: number;
  /** the directions held when it began (a held key does not end it; a new press does); NaN until the first step */
  mx: number;
  my: number;
}

// ---------------------------------------------------------------- hints when she struggles (src/core/hints.ts)
/** One hint: mostly a picture. The view draws it; the rules decide when and what. */
export interface HintShow {
  /** 'go' an arrow to `at` or a pulse on it; 'key' a key picture by her; 'menu' a mark in the open menu; 'mini' a
   * mark in the mini-game */
  kind: 'go' | 'key' | 'menu' | 'mini';
  /** the key picture: 'Space', 'E', 'B', 'R', 'Q', 'X', 'arrows' or '' for none */
  key: string;
  at: Place | null;
  /** an item or mob id shown as a picture, or '' */
  icon: string;
  /** a strings key for at most 6 easy words, or '' */
  text: string;
  /** the mini-game or the menu it is about */
  target: string;
  /** seconds shown */
  t: number;
  /** package 60: she pressed H for it: the view shows it as a small picture card that stays until Space or H */
  asked?: boolean;
}
export interface HelpRt {
  /** what she is doing: 0 nothing that counts, 1 the world, 2 a mini-game, 3 a menu the step needs */
  ctx: number;
  qid: string;
  step: number;
  game: string;
  /** the open menu, set by the view ('' none), and the one the clock was started for */
  menu: string;
  menuWas?: string;
  /** the save's record of hints shown for what she is doing ('stuck:<quest>:<step>', 'stuck:<game>') */
  key: string;
  /** progress signature, seconds without progress, nearest she has been to the target */
  sig: number;
  t: number;
  best: number;
  area: string;
  hp: number;
  /** hurts on a fight step since the last progress */
  hurt: number;
  /** mini-game round and fails when the clock started */
  round: number;
  fails: number;
  /** hints shown this session */
  shown: number;
  /** H was pressed */
  asked: boolean;
  show: HintShow | null;
}

/** Mini-games share one small shape so the view can draw them and the kid bot can play them. */
export interface MiniRt {
  /** package 69: a new round waits this long with its name up ("Round 2 of 3"), and the round it is for */
  roundT?: number;
  round?: number;
  game: string;
  /** who she is playing with (the character she spoke to), so the view can draw the right friends; '' at a game post */
  host: string;
  /** 0 intro, 1 playing, 2 result */
  st: number;
  t: number;
  score: number;
  goal: number;
  stars: number;
  /** generic numbers and lists for the game's own state */
  n: number[];
  objs: { x: number; y: number; vx: number; vy: number; k: number; a: number }[];
  msg: string;
  then: ((stars: number) => void) | null;
  /** replay allowed and never punished */
  best: number;
  /** package 47a: the cup this go is played for (0 none, 1 bronze, 2 silver, 3 gold); higher tiers are harder */
  cup: number;
  /** the cup won by this go (0 none), set on the result card */
  cupWon: number;
  /** package 68: a strings key saying why it ended before the goal ('' when it ended as it should) */
  why?: string;
  /** package 73b: the school quiz's question (src/core/quiz.ts) */
  quiz?: QuizRt;
  /** the claw machine's go this play spends when it begins: the free one or an earned one */
  charge?: 'free' | 'earned';
}
/** Package 73b: one question of the school quiz, and how she is answering it. */
export interface QuizRt {
  /** 0 times tables, 1 spelling */
  kind: number;
  /** the question as text ("7 x 8"), and its id, so the same one never comes twice in a row */
  text: string;
  key: string;
  answers: string[];
  right: number;
  /** the answer the cursor is on, and the one she picked (-1 while she chooses) */
  pick: number;
  picked: number;
  /** seconds the right answer stays up after a pick */
  show: number;
  /** the last left or right held, so a held key moves once */
  mx: number;
  /** questions asked this go */
  asked: number;
}

export interface Game {
  c: Content;
  s: GameState;
  rt: Runtime;
  ev: Ev[];
}
