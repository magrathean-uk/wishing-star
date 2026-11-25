// Saves: plain JSON with a version number. Old saves are migrated, never thrown away.
import { BAG_SLOTS, give } from './bag.ts';
import { count } from './cond.ts';
import { fixGear } from './gear.ts';
import { settleQuests } from './quests.ts';
import { boot, CONTENT_STAMP, DEFAULT_OPTS, newState, SAVE_VERSION } from './state.ts';
import type { Content, Effects, Game, GameState } from './types.ts';

/** A save is the state plus the content stamp of the build that wrote it (`cs`, see state.ts). */
export function serialize(g: Game): string {
  return JSON.stringify({ ...g.s, cs: CONTENT_STAMP });
}

type Raw = Record<string, any>;

/** One function per version step. Each takes a save at version n and returns it at n + 1. */
const MIGRATIONS: Record<number, (s: Raw) => Raw> = {
  // v1 kept the koala's name under "koalaName" and had no house size or pets.
  1: (s) => {
    if (s.koalaName !== undefined && s.koala === undefined) s.koala = s.koalaName;
    delete s.koalaName;
    s.houseSize ??= 0;
    s.pets ??= [];
    return s;
  },
  // v3 adds the content stamp; a v2 save has none, and restep works out its step layout from what it holds.
  2: (s) => s,
};

// ---------------------------------------------------------------- moving old saves to new step numbers (review 55)

/** An old-to-new step map: from each `[old, new]` on, old steps run on one for one from that new step. */
type StepMap = [from: number, to: number][];

/**
 * Build 6 put new steps into chapters 1 to 5 and 7 (builds 1 to 5 to build 6's layout; builds 6, 7 and 8 share it).
 * An old step whose steps before it gained new ones lands on the first of those new steps, so nothing is skipped.
 */
const TO_B6: Record<string, StepMap> = {
  ch1: [
    [0, 0],
    [3, 5],
  ],
  ch2: [
    [0, 0],
    [3, 6],
  ],
  ch3: [
    [0, 0],
    [17, 19],
  ],
  ch4: [
    [0, 0],
    [11, 12],
    [14, 16],
    [16, 19],
  ],
  ch5: [
    [0, 0],
    [10, 11],
  ],
  ch7: [
    [0, 0],
    [8, 9],
    [9, 11],
  ],
};

/** Build 9 (packages 53b and 54) renumbered these from build 8's layout. */
const TO_B9: Record<string, StepMap> = {
  // grass_out and play_1 became the feather at play_1: both, and the nest walk after them, land on the feather
  ch2: [
    [0, 0],
    [5, 4],
    [6, 4],
    [7, 6],
  ],
  ch3: [
    [0, 0],
    [24, 25],
  ],
  ch5: [
    [0, 0],
    [12, 13],
  ],
  // the walk to the sign became the first skeleton; the gold ore and the fossil zombie came in at 14 and 16
  ch6: [
    [0, 0],
    [2, 1],
    [3, 3],
    [15, 16],
    [16, 18],
  ],
  // the plush hand-over went: its step and the walk back both land on the walk back
  ch7: [
    [0, 0],
    [21, 20],
  ],
  sq_daddy_fossil: [
    [0, 0],
    [3, 4],
  ],
};

/**
 * A build 9 save carries the drop flag of its quest's new find step (entering a step lays its drop); a save from
 * builds 6 to 8 at a later step never does, because that step had no drop there.
 */
const B9_FIND: Record<string, number> = { ch2: 4, ch3: 23, ch5: 11, ch6: 14 };

function mapStep(m: StepMap | undefined, k: number): number {
  if (!m) return k;
  let out = k;
  for (const [from, to] of m) if (k >= from) out = to + (k - from);
  return out;
}

/**
 * Put every unfinished quest of a save written before content stamps on the step it means today.
 * - No `cups` record: written by build 5 or older (build 6 added it to every save it writes): both maps, exactly.
 * - Otherwise builds 6 to 8, or build 9 (also a build 6 to 8 save that build 9 loaded and saved again under the old
 *   numbers). A quest with its build 9 find flag is build 9 and stays; any other gets the earlier of its two
 *   readings, so she can never be put past a step she still needs (at worst she does one step again), unless a
 *   hand-over lies between them whose item she no longer has (then she made it: the later reading).
 */
function restep(c: Content, s: Raw, pre6: boolean): void {
  for (const id in s.quests) {
    const q = s.quests[id];
    const def = c.quests[id];
    if (!def || !q || q.done || typeof q.step !== 'number') continue;
    let k = q.step;
    if (pre6) k = mapStep(TO_B9[id], mapStep(TO_B6[id], k));
    else if (!(B9_FIND[id] !== undefined && s.flags?.[`qd:${id}:${B9_FIND[id]}:0`])) {
      const other = mapStep(TO_B9[id], k);
      // a hand-over between the two readings of something she no longer has means she is past it
      const gone = def.steps
        .slice(Math.min(k, other), Math.max(k, other))
        .some((st) => st.t === 'deliver' && rawCount(s, st.item) < (st.n ?? 1));
      k = gone ? Math.max(k, other) : Math.min(k, other);
    }
    k = Math.max(0, Math.min(k, def.steps.length));
    if (k !== q.step) {
      q.step = k;
      q.n = 0;
    }
  }
}

/** How many of an item an unbooted save holds, in the bag and the pouch (cond.ts count, before there is a Game). */
function rawCount(s: Raw, id: string): number {
  let n = Number(s.pouch?.[id] ?? 0);
  for (const sl of Array.isArray(s.bag) ? s.bag : []) if (sl?.id === id) n += Number(sl.n ?? 0);
  return n;
}

/** Flags the clock or the world clear by themselves: never put back. */
const passing = (f: string): boolean => f.startsWith('tm:') || f.startsWith('_') || f.startsWith('hit:');

/**
 * The lasting effects (flags, recipes) of every step behind her, made true for a save from an earlier build: a step
 * she skipped over in the move, or one whose effect moved to an earlier step since (home 3's house3_open, chapter 7's
 * king_friend, chapter 2's pen plan). Items, emeralds, fights and the clock are left alone: nothing is paid twice
 * and nothing is sent to the wrong place.
 */
function catchUp(c: Content, s: Raw): void {
  s.flags ??= {};
  for (const id in s.quests) {
    const q = s.quests[id];
    const def = c.quests[id];
    if (!def || !q) continue;
    const fxs: (Effects | undefined)[] = [def.onStart];
    const upTo = q.done ? def.steps.length : Math.min(q.step, def.steps.length);
    for (let i = 0; i < upTo; i++) fxs.push(def.steps[i]!.fx);
    if (q.done) fxs.push(def.rewards);
    const want: Record<string, boolean> = {};
    for (const fx of fxs) {
      for (const f of fx?.flags ?? []) want[f] = true;
      for (const f of fx?.clear ?? []) want[f] = false;
      for (const r of fx?.recipes ?? [])
        if (c.recipes[r] && Array.isArray(s.recipes) && !s.recipes.includes(r)) s.recipes.push(r);
    }
    for (const f in want) {
      if (passing(f)) continue;
      if (want[f] && !s.flags[f]) s.flags[f] = 1;
      else if (!want[f] && s.flags[f]) delete s.flags[f];
    }
  }
}

export function migrate(c: Content, raw: Raw): GameState {
  if (!raw || typeof raw !== 'object' || typeof raw.v !== 'number') throw new Error('not a save');
  if (raw.v > SAVE_VERSION) throw new Error('save is from a newer game');
  // A save always has its seed, a bag and a place: anything less is not a save (review 22, note 10).
  if (typeof raw.seed !== 'number' || !Array.isArray(raw.bag) || typeof raw.area !== 'string')
    throw new Error('not a save');
  let s = raw;
  // read before anything is filled in: the build that wrote it (see restep)
  const stamped = typeof s.cs === 'number' && s.cs >= CONTENT_STAMP;
  const pre6 = s.cups === undefined;
  delete s.cs;
  while (s.v < SAVE_VERSION) {
    const step = MIGRATIONS[s.v];
    if (!step) throw new Error(`no migration from version ${s.v}`);
    s = step(s);
    s.v++;
  }
  // Who she has met is its own record now; a save from before it is filled from its friend stickers.
  if (s.met === undefined) {
    s.met = {};
    for (const k in s.stickers ?? {}) if (k.startsWith('friend_')) s.met[k.slice(7)] = s.stickers[k];
  }
  // Places are their own record (package 41): an old save is filled from its place stickers; the cloud over the map
  // is then cleared over every region it had found (islandBoot in state.ts).
  if (s.places === undefined) {
    s.places = {};
    for (const k in s.stickers ?? {})
      if (k.startsWith('place_') && (c.regions[k.slice(6)] || c.landmarks[k.slice(6)])) s.places[k.slice(6)] = 1;
  }
  // Gear arrived in phase 2: an old save wears its best sword and its bow (before the generic fill below).
  fixGear(c, s as GameState);
  // Fill anything a later build added, so an old save never crashes on a missing field.
  const fresh = newState(c, { seed: s.seed, hero: s.hero }) as unknown as Raw;
  for (const k in fresh) if (s[k] === undefined) s[k] = fresh[k];
  s.opts = { ...DEFAULT_OPTS, ...s.opts };
  // Cups (package 47a): a save from before them has none; a broken entry is dropped, never trusted.
  if (!s.cups || typeof s.cups !== 'object' || Array.isArray(s.cups)) s.cups = {};
  // Package 51b: three inside chests shared an id with an island chest; a save that opened the old id keeps both opened.
  for (const k of ['chest_cave', 'chest_heeler', 'chest_village']) if (s.taken?.[k]) s.taken[`${k}_in`] ??= s.taken[k];
  for (const k in s.cups) if (![1, 2, 3].includes(s.cups[k])) delete s.cups[k];
  while (s.bag.length < BAG_SLOTS) s.bag.push(null);
  // Content can change between builds: drop what no longer exists rather than break.
  s.bag = s.bag.map((sl: any) => (sl && c.items[sl.id] ? sl : null));
  for (const k in s.pouch) if (!c.items[k]) delete s.pouch[k];
  for (const k in s.quests) if (!c.quests[k]) delete s.quests[k];
  s.placed = s.placed.filter((p: any) => c.items[p.item]?.place && c.areas[p.area]);
  s.recipes = s.recipes.filter((r: string) => c.recipes[r]);
  s.animals = s.animals.filter((a: any) => c.animals[a.kind] && c.areas[a.area]);
  s.drops = s.drops.filter((d: any) => c.items[d.id] && c.areas[d.area]);
  s.crops = s.crops.filter((p: any) => c.items[p.seed]?.grows);
  for (const k in s.chests) s.chests[k] = s.chests[k].map((sl: any) => (sl && c.items[sl.id] ? sl : null));
  if (!c.chars[s.hero]) s.hero = 'amelia';
  if (!c.areas[s.area]) {
    const start = c.areas.cottage!.places.start!;
    s.area = start.area;
    s.x = start.x + 0.5;
    s.y = start.y + 0.5;
  }
  if (s.tracked && !c.quests[s.tracked]) s.tracked = null;
  if (!stamped) {
    restep(c, s, pre6);
    catchUp(c, s);
  }
  return s as GameState;
}

export function load(c: Content, json: string, names: Record<string, string> = {}, xmas?: boolean): Game {
  const raw = JSON.parse(json);
  const old = !(raw && typeof raw.cs === 'number' && raw.cs >= CONTENT_STAMP);
  const s = migrate(c, raw);
  if (xmas !== undefined) s.xmas = xmas;
  const g = boot(c, s, names);
  if (old) keyPieces(g);
  settleQuests(g, old);
  return g;
}

/**
 * Build 8 made {dad}'s trail dig up key pieces (before: map pieces, taken as she went). A save from before keeps
 * its place on the trail and is given the pieces the steps behind her would have left in her bag.
 */
function keyPieces(g: Game): void {
  const q = g.s.quests.sq_dad_trail;
  const def = g.c.quests.sq_dad_trail;
  if (!q || q.done || !def || !g.c.items.key_piece) return;
  let need = 0;
  for (let i = 0; i < Math.min(q.step, def.steps.length); i++) {
    const st = def.steps[i]!;
    if (st.t === 'fetch' && st.item === 'key_piece') need = Math.max(need, st.n ?? 1);
  }
  const have = count(g, 'key_piece');
  if (have < need) give(g, 'key_piece', need - have, true);
}

/** The line shown on a save slot. */
export function summary(
  c: Content,
  json: string,
): { hero: string; day: number; shards: number; minutes: number } | null {
  try {
    const s = JSON.parse(json);
    return {
      hero: c.chars[s.hero] ? s.hero : 'amelia',
      day: s.day ?? 1,
      shards: s.shards ?? 0,
      minutes: Math.round((s.ticks ?? 0) / 3600),
    };
  } catch {
    return null;
  }
}
