// Making a new game and its runtime.
import { addAnimal, refreshBeasts } from './animals.ts';
import { BAG_SLOTS, CHEST_SLOTS } from './bag.ts';
import { emptyGear } from './gear.ts';
import { newHelp } from './hints.ts';
import { islandBoot } from './island.ts';
import { rebuildAll } from './grid.ts';
import { refreshNpcs } from './npcs.ts';
import { place, refreshQuests } from './quests.ts';
import type { Content, Game, GameState, Options, Runtime } from './types.ts';

/** v3 (build 9): every save carries the content stamp below, so a later build knows which step layout wrote it. */
export const SAVE_VERSION = 3;
/**
 * The content stamp: the build number of the last build that renumbered a quest's steps. Raise it to this build's
 * number whenever a quest's steps are added, removed or reordered, and add that quest's old-to-new step map to
 * `restep` in save.ts, or an old save resumes on the wrong step (review 55). Saves written before stamps (v2) are
 * told apart by what they hold.
 */
export const CONTENT_STAMP = 9;
export const KOALA = 'Koala';

export const DEFAULT_OPTS: Options = {
  gentle: true,
  helper: true,
  christmas: 'auto',
  music: 0.6,
  sound: 0.8,
  lowFx: false,
};

export interface NewGameOpts {
  seed?: number;
  hero?: string;
  koala?: string;
  xmas?: boolean;
  names?: Record<string, string>;
  opts?: Partial<Options>;
}

export function makeRuntime(names: Record<string, string> = {}): Runtime {
  return {
    mode: 'play',
    tick: 0,
    solid: {},
    objAt: {},
    live: {},
    worldRev: 0,
    npcs: [],
    mobs: [],
    shots: [],
    nextK: 1_000_000,
    talk: null,
    cut: null,
    build: null,
    fish: null,
    card: null,
    mini: null,
    clip: 'idle',
    ct: 0,
    px: 0,
    py: 0,
    swingT: 0,
    hurtT: 0,
    safeT: 0,
    emoteT: 0,
    hint: '',
    hintObj: -1,
    target: null,
    targetUp: 0,
    saveT: 60,
    questRev: 0,
    ui: null,
    spawnT: 3,
    ambientT: 6,
    lastHitBy: '',
    nearSecret: false,
    under: 'g',
    q: [],
    dirty: false,
    paused: false,
    names,
    nudge: '',
    nudgeT: 0,
    leading: 0,
    beasts: [],
    navX: 0,
    navY: 0,
    navT: 0,
    skip: 0,
    skipHeld: false,
    bowT: 0,
    saveDue: false,
    ask: '',
    askT: 0,
    askQ: [],
    den: null,
    help: newHelp(),
  };
}

export function newState(c: Content, o: NewGameOpts = {}): GameState {
  const seed = (o.seed ?? 20261225) | 0;
  const start = c.areas.cottage?.places.start ?? { area: 'island', x: 80, y: 80 };
  return {
    v: SAVE_VERSION,
    seed,
    rng: seed,
    hero: o.hero ?? 'amelia',
    // The koala is always Koala (phase 2, part A): kept in the save only so old saves still load.
    koala: KOALA,
    area: start.area,
    x: start.x + 0.5,
    y: start.y + 0.5,
    dir: 'down',
    hp: 10,
    maxHp: 10,
    day: 1,
    time: 0,
    ticks: 0,
    emeralds: 0,
    bag: new Array(BAG_SLOTS).fill(null),
    hot: 0,
    pouch: {},
    recipes: Object.values(c.recipes)
      .filter((r) => r.start)
      .map((r) => r.id),
    flags: {},
    quests: {},
    tracked: null,
    shards: 0,
    stickers: {},
    met: {},
    gloss: [],
    heroes: Object.values(c.heroes)
      .filter((h) => h.starter)
      .map((h) => h.id),
    nodes: {},
    taken: {},
    placed: [],
    nextK: 1,
    chests: {},
    crops: [],
    animals: [],
    drops: [],
    inbox: [],
    letters: [],
    bought: {},
    signs: [],
    stars: {},
    cups: {},
    counts: {},
    chatAt: {},
    hints: {},
    houseSize: 0,
    pets: [],
    opts: { ...DEFAULT_OPTS, ...o.opts },
    xmas: o.xmas ?? false,
    gear: emptyGear(),
    plus: {},
    shield: 0,
    places: {},
    seen: '',
    dens: {},
    arrive: '',
    home: {},
    visit: null,
  };
}

/** Wrap a save in a running game: build collision, people and animals, and wake the quests. */
export function boot(c: Content, s: GameState, names: Record<string, string> = {}): Game {
  const g: Game = { c, s, rt: makeRuntime(names), ev: [] };
  g.rt.px = s.x;
  g.rt.py = s.y;
  rebuildAll(g);
  refreshQuests(g);
  rebuildAll(g);
  islandBoot(g);
  refreshNpcs(g);
  refreshBeasts(g);
  g.rt.dirty = false;
  return g;
}

/**
 * The cottage is her workshop from the first minute (phase 2, part F): a bed, a crafting table and a chest stand
 * ready in a new game. Only a new game gets them; an old save keeps what it has.
 */
export const STARTER_FURNITURE: { item: string; x: number; y: number }[] = [
  { item: 'bed', x: 2, y: 2 },
  // inside the starting room, not behind the walls that open as the house grows (package 46)
  { item: 'crafting_table', x: 4, y: 1 },
  { item: 'chest', x: 5, y: 1 },
];
function furnish(c: Content, s: GameState): void {
  if (!c.areas.cottage) return;
  for (const f of STARTER_FURNITURE) {
    if (!c.items[f.item]?.place) continue;
    const k = s.nextK++;
    s.placed.push({ k, item: f.item, area: 'cottage', x: f.x, y: f.y });
    if (c.items[f.item]!.place!.use === 'chest') s.chests[String(k)] = new Array(CHEST_SLOTS).fill(null);
  }
}

export function newGame(c: Content, o: NewGameOpts = {}): Game {
  const s = newState(c, o);
  furnish(c, s);
  const g: Game = { c, s, rt: makeRuntime(o.names ?? {}), ev: [] };
  // Herds: places named herd_<kind>_<n> start with one animal each.
  for (const areaId in c.areas)
    for (const name in c.areas[areaId]!.places) {
      const m = /^herd_([a-z]+)_\d+$/.exec(name);
      if (m && c.animals[m[1]!] && place(g, name)) addAnimal(g, m[1]!, name);
    }
  return boot(c, s, o.names ?? {});
}
