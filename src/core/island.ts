// Home and island (package 41): places she finds, the cloud over the map, the four mob dens, the board's jobs,
// guests who arrive one a morning, friends who drop in when the cottage is comfortable, and the house steps.
// Pure rules: no Phaser, no DOM, no wall clock, no Math.random (rand(g) is the save's own seeded random).
import { give } from './bag.ts';
import { rand, test } from './cond.ts';
import { free, regionAt } from './grid.ts';
import { makeMob, mobCaps } from './mobs.ts';
import { isPoster, offered, place, sticker } from './quests.ts';
import type { CharDef, DenDef, Game, Mob, QuestDef, Spot } from './types.ts';

// ---------------------------------------------------------------- places

/** She finds a landmark within this many tiles of it (unless it says otherwise). */
export const LANDMARK_R = 3;

/** Find a place: record it, land its sticker quietly and tell the view (its name shows without stopping play). */
export function findPlace(g: Game, id: string): void {
  if (g.s.places[id]) return;
  g.s.places[id] = 1;
  sticker(g, 'place_' + id);
  g.ev.push({ t: 'place', id });
}

/** The region she stands in, or '' (rooms have no region). */
export function regionHere(g: Game): string {
  const a = g.c.areas[g.s.area];
  if (!a) return '';
  const code = regionAt(a, Math.floor(g.s.x), Math.floor(g.s.y));
  if (!code || code === ' ') return '';
  for (const id in g.c.regions) if (g.c.regions[id]!.code === code) return id;
  return '';
}

function stepPlaces(g: Game): void {
  const s = g.s;
  const r = regionHere(g);
  if (r && !s.places[r]) findPlace(g, r);
  for (const id in g.c.landmarks) {
    if (s.places[id]) continue;
    const d = g.c.landmarks[id]!;
    if (d.area) {
      if (d.area === s.area) findPlace(g, id);
      continue;
    }
    const p = d.at ? place(g, d.at) : null;
    if (!p || p.area !== s.area) continue;
    const rr = d.r ?? LANDMARK_R;
    if ((p.x + 0.5 - s.x) ** 2 + (p.y + 0.5 - s.y) ** 2 <= rr * rr) findPlace(g, id);
  }
}

// ---------------------------------------------------------------- the cloud over the map

/** One cell of the cloud is this many tiles square. */
export const SEEN_CELL = 6;
/** She clears every cell this many tiles to each side of her (about the screen). */
export const SEEN_HALF_W = 12;
export const SEEN_HALF_H = 7;
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function grid(g: Game): { cols: number; rows: number } {
  const a = g.c.areas.island;
  return { cols: Math.ceil((a?.w ?? 0) / SEEN_CELL), rows: Math.ceil((a?.h ?? 0) / SEEN_CELL) };
}
function bit(seen: string, i: number): boolean {
  const ch = B64.indexOf(seen.charAt((i / 6) | 0));
  return ch > 0 && (ch & (1 << (i % 6))) !== 0;
}

/** Has she seen the island tile x, y (no cloud over it on the map)? */
export function seenAt(g: Game, x: number, y: number): boolean {
  const { cols, rows } = grid(g);
  const cx = Math.floor(x / SEEN_CELL);
  const cy = Math.floor(y / SEEN_CELL);
  if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return false;
  return bit(g.s.seen, cy * cols + cx);
}

/** Clear the cloud over a rectangle of island tiles. Returns true when a cell changed. */
export function clearSeen(g: Game, x0: number, y0: number, x1: number, y1: number): boolean {
  const { cols, rows } = grid(g);
  const n = Math.ceil((cols * rows) / 6);
  const arr: number[] = [];
  for (let i = 0; i < n; i++) arr.push(Math.max(0, B64.indexOf(g.s.seen.charAt(i))));
  let changed = false;
  const cx0 = Math.max(0, Math.floor(x0 / SEEN_CELL));
  const cy0 = Math.max(0, Math.floor(y0 / SEEN_CELL));
  const cx1 = Math.min(cols - 1, Math.floor(x1 / SEEN_CELL));
  const cy1 = Math.min(rows - 1, Math.floor(y1 / SEEN_CELL));
  for (let cy = cy0; cy <= cy1; cy++)
    for (let cx = cx0; cx <= cx1; cx++) {
      const i = cy * cols + cx;
      if (arr[(i / 6) | 0]! & (1 << (i % 6))) continue;
      arr[(i / 6) | 0]! |= 1 << (i % 6);
      changed = true;
    }
  if (changed) g.s.seen = arr.map((v) => B64.charAt(v)).join('');
  return changed;
}

/** Share of the island's cells she has seen, 0 to 1 (for the bots and the map). */
export function seenShare(g: Game): number {
  const { cols, rows } = grid(g);
  let n = 0;
  for (let i = 0; i < cols * rows; i++) if (bit(g.s.seen, i)) n++;
  return cols * rows ? n / (cols * rows) : 0;
}

const lastCell = new WeakMap<Game, number>();
function stepSeen(g: Game): void {
  const s = g.s;
  if (s.area !== 'island') return;
  const cell = Math.floor(s.y / 2) * 1000 + Math.floor(s.x / 2);
  if (cell === lastCell.get(g) && s.seen) return;
  lastCell.set(g, cell);
  clearSeen(g, s.x - SEEN_HALF_W, s.y - SEEN_HALF_H, s.x + SEEN_HALF_W, s.y + SEEN_HALF_H);
}

/** An old save, or one from before the cloud: clear every region it had found. */
export function seedSeen(g: Game): void {
  const a = g.c.areas.island;
  if (!a) return;
  const codes = new Set<string>();
  for (const id in g.s.places) if (g.c.regions[id]) codes.add(g.c.regions[id]!.code);
  if (!codes.size) return;
  for (let y = 0; y < a.h; y += 2)
    for (let x = 0; x < a.w; x += 2) if (codes.has(regionAt(a, x, y))) clearSeen(g, x, y, x, y);
}

// ---------------------------------------------------------------- dens

/** She sees a den from about a screen away. */
export const DEN_SEE = 13;
/** She has run off: the wave's mobs go and the den waits for her again. */
export const DEN_LEAVE = 18;
const denTag = (id: string) => 'den:' + id;

export function denCentre(g: Game, d: DenDef): { x: number; y: number } | null {
  const p = place(g, d.at);
  return p && p.area === 'island' ? { x: p.x + 0.5, y: p.y + 0.5 } : null;
}

/** Is a cleared den's ring here? (no mob is made inside one, ever again) */
export function inClearedDen(g: Game, x: number, y: number): boolean {
  if (g.s.area !== 'island') return false;
  for (const id in g.c.dens) {
    if (g.s.dens[id] !== 2) continue;
    const d = g.c.dens[id]!;
    const c = denCentre(g, d);
    if (c && Math.hypot(c.x - x, c.y - y) <= d.r + 3) return true;
  }
  return false;
}

function spawnWave(g: Game, d: DenDef, wave: number): void {
  const c = denCentre(g, d)!;
  const list = d.waves[wave - 1] ?? [];
  let made = 0;
  list.forEach((id, i) => {
    // round the far side of the ring from her, so nothing lands on top of her
    const base = Math.atan2(c.y - g.s.y, c.x - g.s.x);
    for (let tries = 0; tries < 24; tries++) {
      const a = base + ((i - (list.length - 1) / 2) * 0.9 + (rand(g) - 0.5) * 0.6) + (tries > 8 ? rand(g) * 6 : 0);
      const rr = d.r * (0.55 + rand(g) * 0.35);
      const x = c.x + Math.cos(a) * rr;
      const y = c.y + Math.sin(a) * rr;
      if (!free(g, 'island', x, y, 0.3)) continue;
      const m = makeMob(g, id, x, y, '');
      m.tag = denTag(d.id);
      made++;
      break;
    }
  });
  g.rt.den = { id: d.id, wave, left: made };
  g.ev.push({ t: 'den', id: d.id, kind: 'wave', wave });
  g.ev.push({ t: 'sfx', id: 'go' });
}

function waveLeft(g: Game, id: string): Mob[] {
  const tag = denTag(id);
  return g.rt.mobs.filter((m) => m.tag === tag && !m.gone);
}
/** A den mob was beaten (by her, or it blew itself up): one fewer of the wave to go. */
export function denBeaten(g: Game): void {
  if (g.rt.den) g.rt.den.left--;
}

/** End a den fight without clearing it: its mobs go quietly (she walked away, slept or was carried home). */
export function dropDen(g: Game): void {
  const rt = g.rt;
  if (!rt.den) return;
  const tag = denTag(rt.den.id);
  for (const m of rt.mobs) if (m.tag === tag) m.gone = true;
  rt.den = null;
}

function stepDens(g: Game): void {
  const s = g.s;
  const rt = g.rt;
  if (s.area !== 'island') {
    if (rt.den) dropDen(g);
    return;
  }
  for (const id in g.c.dens) {
    const d = g.c.dens[id]!;
    const c = denCentre(g, d);
    if (!c) continue;
    const dist = Math.hypot(c.x - s.x, c.y - s.y);
    if (!s.dens[id] && dist <= DEN_SEE) {
      s.dens[id] = 1;
      g.ev.push({ t: 'den', id, kind: 'seen' });
    }
    if (s.dens[id] === 2) continue;
    if (rt.den?.id === id) {
      if (dist > DEN_LEAVE) {
        dropDen(g);
        continue;
      }
      if (rt.den.left > 0) {
        // the wave went without being beaten (she was carried home, a door): the den waits for her again
        if (!waveLeft(g, id).length) dropDen(g);
        continue;
      }
      if (rt.den.wave === 1) spawnWave(g, d, 2);
      else clearDen(g, d);
      continue;
    }
    if (!rt.den && rt.mode === 'play' && dist <= d.r) {
      // a boss fight is hers and the boss's alone
      if (rt.mobs.some((m) => !m.gone && g.c.mobs[m.id]?.role === 'boss')) continue;
      spawnWave(g, d, 1);
    }
  }
}

function clearDen(g: Game, d: DenDef): void {
  g.s.dens[d.id] = 2;
  g.s.flags['den_' + d.id] = 1;
  g.s.counts.dens = (g.s.counts.dens ?? 0) + 1;
  g.rt.den = null;
  g.rt.dirty = true;
  g.ev.push({ t: 'den', id: d.id, kind: 'clear' });
  g.ev.push({ t: 'sfx', id: 'fanfare' });
  g.ev.push({ t: 'reward', kind: 'secret', id: 'den:' + d.id });
}

/** How many mobs of a wave can be after her at once (the caps hold: the rest doze until it is their turn). */
export function denCap(g: Game): number {
  return mobCaps(g).all;
}

// ---------------------------------------------------------------- the board

/** The board shows at most this many jobs. */
export const BOARD_MAX = 3;
const isJob = (d: QuestDef): boolean => !!d.board || d.kind === 'bounty';

/**
 * The jobs she can take from the board right now: never-taken first, then the one done longest ago, at most 3.
 * Taking one is the `accept` command with its quest id.
 */
export function boardJobs(g: Game): string[] {
  const list: { id: string; day: number; i: number }[] = [];
  // one Wanted poster at a time, as before; a job or a project running blocks nothing (package 53a)
  const bounty = Object.keys(g.s.quests).some((k) => isPoster(g.c.quests[k]!) && !g.s.quests[k]!.done);
  g.c.questOrder.forEach((qid, i) => {
    const def = g.c.quests[qid]!;
    if (!isJob(def)) return;
    if (isPoster(def) && bounty) return;
    const q = g.s.quests[qid];
    if (q && !q.done) return;
    if (!offered(g, def)) return;
    list.push({ id: qid, day: q?.done ? (q.day ?? 0) : -1, i });
  });
  list.sort((a, b) => a.day - b.day || a.i - b.i);
  return list.slice(0, BOARD_MAX).map((j) => j.id);
}
/** Is this quest a board job she can take now? */
export function onBoard(g: Game, qid: string): boolean {
  return boardJobs(g).includes(qid);
}

// ---------------------------------------------------------------- arrivals

/** Region codes that count as home: Home Meadow, Wishing Square, her cottage. */
const HOME_CODES = new Set(['H', 'W', 'I']);

/** The spot a character would use now, ignoring day and night and whether it is waiting to arrive. */
function spotFor(g: Game, c: CharDef): Spot | null {
  for (const sp of c.spots) {
    if (sp.found && g.s.flags[sp.found] === 1) continue;
    if (test(g, sp.if && 'night' in sp.if ? { ...sp.if, night: undefined } : sp.if)) return sp;
  }
  return null;
}
function atHomeSpot(g: Game, sp: Spot): boolean {
  if (sp.found) return false;
  const p = place(g, sp.at);
  if (!p) return false;
  const a = g.c.areas[p.area];
  if (!a) return false;
  if (p.area === 'cottage') return true;
  return HOME_CODES.has(regionAt(a, p.x, p.y));
}
/** Characters who never wait for a morning card: heroes (and their stand-ins), mobs and animals. */
function exempt(g: Game, id: string): boolean {
  const c = g.c.chars[id]!;
  if (c.role !== 'walker' && c.role !== 'fixed') return true;
  if (g.c.heroes[id]) return true;
  return false;
}
/** A quest that is going on needs this character now: they come at once, card or not. */
function needed(g: Game, id: string): boolean {
  for (const qid in g.s.quests) {
    const q = g.s.quests[qid]!;
    if (q.done) continue;
    const def = g.c.quests[qid]!;
    if (def.giver === id) return true;
    const st = def.steps[q.step];
    if (st && ((st.t === 'talk' && st.who === id) || (st.t === 'deliver' && st.to === id))) return true;
  }
  for (const qid of g.c.questOrder) {
    const def = g.c.quests[qid]!;
    if (def.kind === 'main' && def.giver === id && !g.s.quests[qid] && test(g, def.requires)) return true;
  }
  return false;
}

/** Is this guest due at home but not yet announced (so not on the island until a morning card)? */
export function waiting(g: Game, id: string): boolean {
  if (g.s.home[id]) return false;
  const c = g.c.chars[id];
  if (!c || exempt(g, id)) return false;
  const sp = spotFor(g, c);
  if (!sp || !atHomeSpot(g, sp)) return false;
  if (needed(g, id)) {
    g.s.home[id] = 1;
    return false;
  }
  return true;
}

/** Everyone at home right now counts as already arrived: a new game, or an old save that had no record. */
export function seedHome(g: Game): void {
  for (const id in g.c.chars) {
    const c = g.c.chars[id]!;
    if (exempt(g, id)) continue;
    const sp = spotFor(g, c);
    if (sp && atHomeSpot(g, sp)) g.s.home[id] = 1;
  }
  g.s.flags.home_seeded = 1;
}

/**
 * Talking to a guest at the spot where she finds them sets its flag (2: found today, still standing there). The
 * next morning it becomes 1: they leave that spot and wait for their morning card at home.
 */
export function foundGuest(g: Game, id: string): void {
  const c = g.c.chars[id];
  if (!c) return;
  for (const sp of c.spots) {
    if (!sp.found) continue;
    if (g.s.flags[sp.found]) return;
    if (!test(g, sp.if)) continue;
    g.s.flags[sp.found] = 2;
    g.s.counts.found = (g.s.counts.found ?? 0) + 1;
    g.ev.push({ t: 'sfx', id: 'found' });
    return;
  }
}

/** The guests waiting to come home, in the order the cards will announce them. */
export function arrivals(g: Game): string[] {
  const out: string[] = [];
  for (const id in g.c.chars) if (waiting(g, id)) out.push(id);
  return out;
}

// ---------------------------------------------------------------- comfort and visitors

/** Kinds of furniture standing in her cottage. */
export function comfort(g: Game): number {
  const kinds = new Set<string>();
  for (const p of g.s.placed) if (p.area === 'cottage' && g.c.items[p.item]?.kind === 'furniture') kinds.add(p.item);
  return kinds.size;
}
/** Comfort steps: at 5, 10 and 20 kinds a friend may drop in, more often at each step. */
export const COMFORT_STEPS = [5, 10, 20] as const;
const VISIT_CHANCE = [0, 0.3, 0.45, 0.6];
/** A present when a friend has none of her own in the data. */
const DEFAULT_GIFTS = ['cookie', 'apple_pie', 'cake', 'flower_pot', 'emerald'];

export function comfortStep(g: Game): number {
  const n = comfort(g);
  let i = 0;
  for (const t of COMFORT_STEPS) if (n >= t) i++;
  return i;
}

/** Friends who may drop in: met, not family, not the hero, and not here yesterday. */
export function visitors(g: Game): string[] {
  const out: string[] = [];
  const any = Object.values(g.c.chars).some((c) => c.visit);
  for (const id in g.s.met) {
    const c = g.c.chars[id];
    if (!c || id === g.s.hero || c.group === 'family' || exempt(g, id)) continue;
    if (any ? !c.visit : false) continue;
    if (g.s.flags['visited:' + id] && g.s.day - g.s.flags['visited:' + id]! < 4) continue;
    out.push(id);
  }
  return out;
}

// ---------------------------------------------------------------- the house

/** House steps: a build site at her door ('house_<n>', flag 'house<n>_paid'); the Minions build it overnight. */
export const HOUSE_STEPS = [1, 2, 3] as const;
/** Bosses whose prize goes on the trophy wall of the biggest room, by flag 'trophy_<boss>'. */
export const TROPHIES: Record<string, string> = {
  spider_queen: 'trophy_star',
  jockey: 'trophy_star',
  king: 'trophy_star',
};

// ---------------------------------------------------------------- each step and each morning

/** Called every step of play from step.ts. Cheap: the place and cloud checks run a few times a second. */
export function stepIsland(g: Game): void {
  if (g.rt.mode !== 'play' && g.rt.mode !== 'build') return;
  if (g.rt.tick % 15 === 0) {
    stepPlaces(g);
    stepSeen(g);
  }
  stepDens(g);
}

/** The morning (from newDay): the overnight house build, then one arrival, or else perhaps one visitor. */
export function islandMorning(g: Game): void {
  const s = g.s;
  s.arrive = '';
  s.visit = null;
  for (const id in g.c.chars)
    for (const sp of g.c.chars[id]!.spots) if (sp.found && s.flags[sp.found] === 2) s.flags[sp.found] = 1;
  for (const n of HOUSE_STEPS)
    if (s.flags[`house${n}_paid`] && !s.flags[`house${n}`]) {
      s.flags[`house${n}`] = 1;
      s.houseSize = Math.max(s.houseSize, n);
      g.rt.dirty = true;
    }
  const due = arrivals(g);
  if (due.length) {
    const who = due[0]!;
    s.home[who] = 1;
    s.arrive = who;
    g.rt.dirty = true;
    g.ev.push({ t: 'arrive', who });
    return;
  }
  // package 70: a quest's card takes the first morning with no arrival and no visitor (the dice roll as before)
  const step = comfortStep(g);
  if (!step || rand(g) >= VISIT_CHANCE[step]!) {
    questCard(g);
    return;
  }
  const list = visitors(g);
  if (!list.length) {
    questCard(g);
    return;
  }
  const who = list[Math.floor(rand(g) * list.length) % list.length]!;
  const c = g.c.chars[who]!;
  let gift = c.visit?.gift ?? '';
  let n = c.visit?.n ?? 1;
  if (!gift || !g.c.items[gift]) {
    const ok = DEFAULT_GIFTS.filter((id) => g.c.items[id]);
    gift = ok[s.day % ok.length] ?? '';
    n = gift === 'emerald' ? 5 : 1;
  }
  if (!gift) {
    questCard(g);
    return;
  }
  if (gift === 'emerald') s.emeralds += n;
  else give(g, gift, n, true);
  s.visit = { who, gift, n };
  s.flags['visited:' + who] = s.day;
  g.rt.dirty = true;
  g.ev.push({ t: 'visit', who, gift, n });
}

/**
 * Package 70: a quest that opens with a morning card (`QuestDef.card`): on the first morning that has no arrival and
 * no visitor (one card a morning). Returns true when this morning's card is taken.
 */
function questCard(g: Game): boolean {
  const s = g.s;
  for (const qid of g.c.questOrder) {
    const card = g.c.quests[qid]!.card;
    if (!card || s.flags['card:' + qid] || s.quests[qid] || !test(g, card.if)) continue;
    const n = card.n ?? 1;
    if (card.gift === 'emerald') s.emeralds += n;
    else if (g.c.items[card.gift]) give(g, card.gift, n, true);
    s.flags['card:' + qid] = 1;
    for (const id of card.home ?? []) s.home[id] = 1;
    s.visit = { who: card.who, gift: card.gift, n };
    g.rt.dirty = true;
    g.ev.push({ t: 'visit', who: card.who, gift: card.gift, n });
    return true;
  }
  return false;
}

/** Where a character stands now by the island's rules: nowhere while waiting for a morning card, else null (use the spots). */
export function islandSpot(g: Game, id: string): 'none' | null {
  return waiting(g, id) ? 'none' : null;
}
/** A found spot whose guest has gone home is skipped. */
export function spotGone(g: Game, sp: Spot): boolean {
  return !!sp.found && g.s.flags[sp.found] === 1;
}

/** One-time set-up for a save: the home record and the cloud. */
export function islandBoot(g: Game): void {
  if (!g.s.flags.home_seeded) seedHome(g);
  if (!g.s.seen) seedSeen(g);
}
