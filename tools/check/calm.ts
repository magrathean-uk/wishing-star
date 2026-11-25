// Calm check (phase 2, docs/PHASE2.md parts A, B, C and I): the limits that keep the start quiet, read from data.
// It prints one table and exits 1 when a limit is broken. Rows marked "later" are reported and never fail:
// they belong to later steps of phase 2.
// Run: node tools/check/calm.ts [--verbose]
import { existsSync, readFileSync } from 'node:fs';
import { NIGHT_AT } from '../../src/core/cond.ts';
import { refreshNpcs } from '../../src/core/npcs.ts';
import { objective } from '../../src/core/quests.ts';
import { test } from '../../src/core/cond.ts';
import { newGame } from '../../src/core/state.ts';
import type { Cond, Content, Game, Line, QuestDef } from '../../src/core/types.ts';
import { content } from '../../src/data/content.ts';
import { JOURNAL_TABS, journalStickers } from '../../src/data/stickers.ts';

// ---------------------------------------------------------------- the limits
export const LIMITS = {
  intro: { boxes: 3, words: 25, cast: 5 },
  prologue: { steps: 8, words: 250, speakers: 4 },
  /** words a main quest may hold (first choice only); the intro's words count towards the prologue */
  words: { prologue: 250, chapter: 400, home: 250, finale: 350 },
  /** boxes in one talk */
  talk: 3,
  /** words in a goal line */
  goal: 6,
  /** steps after the shard is won in a chapter */
  tail: 4,
  /** named characters in the home and Square regions */
  home: { day1: 5, early: 8, perShard: 2 },
  /** named characters one screen may hold */
  screen: 5,
  /** one screen in tiles at zoom 1.25 */
  view: { w: 24, h: 13.5 },
  stickers: { all: 60, tabs: 3 },
  /** key presses from the title to walking, and with the intro skipped */
  presses: { plain: 6, skip: 3 },
};
/** Quests held to their limits now. The others are reported as "later". */
const NOW = new Set(['prologue', 'ch1', 'ch2']);
/** Regions where a crowded screen fails now. */
const STRICT = new Set(['home', 'square', 'heeler', 'bing']);
/** Who may stand in the home and Square regions on day 1 (the hero's own character never stands there). */
const DAY1 = new Set(['mum', 'dad', 'grandad', 'granny', 'koala', 'amelia']);
const CREW = new Set(['kevin', 'stuart', 'bob', 'minion_d', 'minion_e']);

// ---------------------------------------------------------------- words and boxes
const WORD = /[A-Za-z][A-Za-z'’-]*[A-Za-z]|[A-Za-z]|\d+(?:[.,]\d+)?|\{[^}]*\}/g;
const spoken = (l: string): string => {
  const i = l.indexOf(': ');
  return i > 0 && i < 24 && !l.slice(0, i).includes(' ') ? l.slice(i + 2) : l;
};
const speaker = (l: string): string => {
  const i = l.indexOf(': ');
  return i > 0 && i < 24 && !l.slice(0, i).includes(' ') ? l.slice(0, i) : '';
};
export const countWords = (text: string): number => (text.match(WORD) ?? []).length;

/**
 * Could she read this line on a first play as the hero `hero`? Lines for another hero are left out. A line that
 * hangs on a flag is read in one of two worlds (`flags` true: every flag is set), and the larger count is used.
 */
function shown(cond: Cond | undefined, hero: string, flags: boolean): boolean {
  if (!cond) return true;
  if (cond.hero !== undefined && cond.hero !== hero) return false;
  if (cond.notHero !== undefined && cond.notHero === hero) return false;
  if (cond.flag !== undefined && !flags) return false;
  if (cond.noFlag !== undefined && flags) return false;
  return true;
}
interface Tally {
  words: number;
  boxes: number;
  speakers: Set<string>;
}
function tally(lines: Line[] | undefined, hero: string, flags: boolean, out: Tally): void {
  for (const l of lines ?? []) {
    if (typeof l === 'string') {
      out.words += countWords(spoken(l));
      out.boxes++;
      out.speakers.add(speaker(l));
      continue;
    }
    if (!shown(l.if, hero, flags)) continue;
    out.words += countWords(spoken(l.l));
    out.boxes++;
    out.speakers.add(speaker(l.l));
    const first = l.choices?.[0];
    if (first) {
      out.words += countWords(first.text);
      tally(first.then, hero, flags, out);
    }
  }
}
/** Words and boxes of some lines: first choice only, the larger of the two flag worlds. */
export function measure(lines: Line[] | undefined, hero = 'amelia'): Tally {
  const a: Tally = { words: 0, boxes: 0, speakers: new Set() };
  const b: Tally = { words: 0, boxes: 0, speakers: new Set() };
  tally(lines, hero, false, a);
  tally(lines, hero, true, b);
  const big = b.words > a.words ? b : a;
  return { words: big.words, boxes: Math.max(a.boxes, b.boxes), speakers: new Set([...a.speakers, ...b.speakers]) };
}
/** Every talk of a quest: its offer, each step's lines and its close. */
export function talks(q: QuestDef): { where: string; lines: Line[] }[] {
  const out: { where: string; lines: Line[] }[] = [];
  if (q.open) out.push({ where: 'open', lines: q.open });
  q.steps.forEach((st, i) => {
    if (st.say) out.push({ where: `step ${i + 1}`, lines: st.say });
  });
  if (q.close) out.push({ where: 'close', lines: q.close });
  return out;
}
/** Words of a quest: its own lines and the story scenes its steps play (the intro counts towards the prologue). */
export function questWords(q: QuestDef, c: Content = content): { words: number; boxes: number; speakers: Set<string> } {
  let words = 0;
  let boxes = 0;
  const speakers = new Set<string>();
  for (const st of q.steps)
    if (st.fx?.cut) {
      const sc = sceneWords(c, st.fx.cut);
      words += sc.words;
      boxes += sc.boxes;
    }
  for (const t of talks(q)) {
    const m = measure(t.lines);
    words += m.words;
    boxes += m.boxes;
    for (const s of m.speakers) speakers.add(s);
  }
  return { words, boxes, speakers };
}
export function sceneWords(c: Content, id: string): { words: number; boxes: number; cast: number } {
  const acts = c.cutscenes[id]?.acts ?? [];
  let words = 0;
  let boxes = 0;
  const on = new Set<string>();
  let cast = 0;
  for (const a of acts) {
    if (a.a === 'say' && a.l) {
      words += countWords(spoken(a.l));
      boxes++;
    }
    // a second spawn of someone moves them: off the stage when x is far outside it
    if (a.a === 'spawn' && a.who) {
      if (a.at === undefined && a.x !== undefined && (a.x < 0 || a.x > 20)) on.delete(a.who);
      else on.add(a.who);
    }
    if (a.a === 'hide' && a.who) on.delete(a.who);
    cast = Math.max(cast, on.size);
  }
  return { words, boxes, cast };
}

// ---------------------------------------------------------------- who stands where
/** Named: a character with a name and lines. Blocky villagers, the golem and animals are not. */
const named = (c: Content, id: string): boolean => {
  const ch = c.chars[id];
  return !!ch && ch.role !== 'speakingMob' && ch.role !== 'hostile' && ch.role !== 'animal';
};
const regionOf = (c: Content, area: string, x: number, y: number): string => {
  if (area === 'cottage') return 'home';
  const a = c.areas[area];
  const code = a?.region?.[Math.floor(y)]?.[Math.floor(x)];
  for (const id in c.regions) if (c.regions[id]!.code === code) return id;
  return area;
};
interface Who {
  id: string;
  area: string;
  x: number;
  y: number;
  region: string;
}
interface State {
  label: string;
  hero: string;
  /** shards won; -1 is day 1 (the prologue) */
  shards: number;
  night: boolean;
  step?: number;
  after?: boolean;
  /** package 41: every guest she could have found by now has been found (and has come home) */
  found?: boolean;
}
const CHAPTERS = ['ch1', 'ch2', 'ch3', 'ch4', 'ch5', 'ch6', 'ch7'];
/** Put a fresh game into a story state and list every named character on the island and in her cottage. */
function people(c: Content, st: State): Who[] {
  const g: Game = newGame(c, { hero: st.hero });
  const s = g.s;
  s.time = st.night ? NIGHT_AT + 20 : 100;
  s.flags = {};
  if (st.shards < 0) {
    s.quests = { prologue: { step: st.step ?? 0, n: 0 } };
    s.shards = 0;
  } else {
    s.quests = { prologue: { step: 0, n: 0, done: true } };
    s.day = 2 + st.shards;
    s.flags.day2 = 1;
    s.shards = st.shards;
    for (let i = 0; i < st.shards; i++) {
      s.flags['shard' + (i + 1)] = 1;
      s.quests[CHAPTERS[i]!] = { step: 0, n: 0, done: true };
    }
    if (st.shards >= 3) s.flags.minions_here = 1;
    if (st.after) {
      s.quests.finale = { step: 0, n: 0, done: true };
      for (const f of ['postgame', 'king_calm', 'king_friend', 'tree_lit']) s.flags[f] = 1;
    }
  }
  // package 41: the fullest case. Everyone due at home has had their morning card, and (with `found`) every guest
  // she could have found out in the world has been found and has come home.
  s.flags.home_seeded = 1;
  for (const id in c.chars) s.home[id] = 1;
  if (st.found)
    for (const id in c.chars)
      for (const sp of c.chars[id]!.spots) if (sp.found && test(g, sp.if)) s.flags[sp.found] = 1;
  const out: Who[] = [];
  // her cottage and the five rooms she can walk into count as well (package 34)
  const rooms = Object.keys(c.areas).filter((a) => a === 'cottage' || a.endsWith('_in'));
  for (const area of ['island', ...rooms]) {
    if (!c.areas[area]) continue;
    s.area = area;
    g.rt.npcs = [];
    refreshNpcs(g);
    let crew = false;
    for (const n of g.rt.npcs) {
      if (!named(c, n.id)) continue;
      // the Minion crew counts as one
      if (CREW.has(n.id)) {
        if (crew) continue;
        crew = true;
      }
      out.push({ id: n.id, area, x: n.hx, y: n.hy, region: regionOf(c, area, n.hx, n.hy) });
    }
  }
  return out;
}
const atHome = (w: Who[]): Who[] => w.filter((p) => p.region === 'home' || p.region === 'square');

/** The fullest screen: a window of one view slid over an area, by the regions of the people inside it. */
function fullest(w: Who[]): Map<string, { n: number; ids: string[] }> {
  const best = new Map<string, { n: number; ids: string[] }>();
  const areas = new Set(w.map((p) => p.area));
  for (const area of areas) {
    const here = w.filter((p) => p.area === area);
    for (const a of here)
      for (const b of here) {
        const x0 = a.x;
        const y0 = b.y;
        const inside = here.filter(
          (p) => p.x >= x0 && p.x <= x0 + LIMITS.view.w && p.y >= y0 && p.y <= y0 + LIMITS.view.h,
        );
        for (const region of new Set(inside.map((p) => p.region))) {
          const old = best.get(region);
          if (!old || inside.length > old.n) best.set(region, { n: inside.length, ids: inside.map((p) => p.id) });
        }
      }
  }
  return best;
}

// ---------------------------------------------------------------- key presses (supplied by the smoke run)
/**
 * KEY PRESSES: the smoke run (tools/bot/smoke.ts) counts the presses from the title to walking, plain and with
 * the intro skipped, and writes them here as { "plain": n, "skip": n }. Until that file exists the row is "later".
 */
export const PRESSES_FILE = 'test-results/calm-presses.json';
function presses(): { plain: number; skip: number } | null {
  if (!existsSync(PRESSES_FILE)) return null;
  try {
    const d = JSON.parse(readFileSync(PRESSES_FILE, 'utf8')) as { plain?: number; skip?: number };
    return typeof d.plain === 'number' && typeof d.skip === 'number' ? { plain: d.plain, skip: d.skip } : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- the table
export interface Row {
  what: string;
  value: string;
  limit: string;
  verdict: 'ok' | 'FAIL' | 'later';
  note?: string;
}

export function calm(c: Content, verbose = false): { ok: boolean; rows: Row[] } {
  const rows: Row[] = [];
  const row = (what: string, value: number | string, limit: number | string, bad: boolean, note = '', later = false) =>
    rows.push({
      what,
      value: String(value),
      limit: String(limit),
      verdict: later ? (bad ? 'later' : 'ok') : bad ? 'FAIL' : 'ok',
      note,
    });
  const starters = Object.values(c.heroes)
    .filter((h) => h.starter)
    .map((h) => h.id);

  // 1. the intro scene
  const intro = sceneWords(c, 'intro');
  row('intro: boxes', intro.boxes, LIMITS.intro.boxes, intro.boxes > LIMITS.intro.boxes);
  row('intro: words', intro.words, LIMITS.intro.words, intro.words > LIMITS.intro.words);
  row('intro: characters on screen', intro.cast, LIMITS.intro.cast, intro.cast > LIMITS.intro.cast);

  // 2. the prologue
  const pro = c.quests.prologue;
  if (pro) {
    const m = questWords(pro, c);
    const who = [...m.speakers].filter((s) => named(c, s));
    row('prologue: steps', pro.steps.length, LIMITS.prologue.steps, pro.steps.length > LIMITS.prologue.steps);
    row(
      'prologue: named speakers',
      who.length,
      LIMITS.prologue.speakers,
      who.length > LIMITS.prologue.speakers,
      who.join(' '),
    );
  }

  // 3. words in each main quest
  let total = 0;
  for (const id of c.questOrder) {
    const q = c.quests[id]!;
    if (q.kind !== 'main') continue;
    const kind =
      id === 'prologue' ? 'prologue' : id === 'finale' ? 'finale' : id.startsWith('home') ? 'home' : 'chapter';
    const limit = LIMITS.words[kind];
    const words = questWords(q, c).words;
    total += words;
    row(`words: ${id}`, words, limit, words > limit, '', !NOW.has(id));
  }
  row('words: the main path', total, 4600, total > 4600, '', true);

  // 4. talks, goals and endings in the quests held to their limits now
  for (const id of NOW) {
    const q = c.quests[id];
    if (!q) continue;
    const long: string[] = [];
    for (const t of talks(q)) {
      const boxes = Math.max(...starters.map((h) => measure(t.lines, h).boxes));
      if (boxes > LIMITS.talk) long.push(`${t.where} (${boxes})`);
    }
    row(`talks over ${LIMITS.talk} boxes: ${id}`, long.length, 0, long.length > 0, long.join(', '));
    const g = newGame(c, { hero: 'amelia' });
    const goals: string[] = [];
    q.steps.forEach((_, i) => {
      g.s.quests[id] = { step: i, n: 0 };
      const text = objective(g, id);
      if (countWords(text) > LIMITS.goal) goals.push(`step ${i + 1} "${text}"`);
    });
    row(`goals over ${LIMITS.goal} words: ${id}`, goals.length, 0, goals.length > 0, goals.join(', '));
    const shardAt = q.steps.findIndex((st) => st.fx?.shard);
    if (shardAt >= 0) {
      const tail = q.steps.length - 1 - shardAt;
      row(`steps after the shard: ${id}`, tail, LIMITS.tail, tail > LIMITS.tail);
    }
  }

  // 5. who stands in the home and Square regions
  const steps = pro?.steps.length ?? 0;
  let day1 = 0;
  const strangers = new Set<string>();
  const screens = new Map<string, { n: number; ids: string[]; when: string }>();
  const see = (st: State, w: Who[]) => {
    for (const [region, f] of fullest(w)) {
      const old = screens.get(region);
      if (!old || f.n > old.n) screens.set(region, { ...f, when: st.label });
    }
  };
  for (const hero of starters)
    for (let step = 0; step <= steps; step++)
      for (const night of [false, true]) {
        const st: State = { label: `day 1, step ${step + 1}, ${hero}`, hero, shards: -1, night, step };
        const w = people(c, st);
        const home = atHome(w);
        day1 = Math.max(day1, home.length);
        for (const p of home) if (!DAY1.has(p.id)) strangers.add(p.id);
        see(st, w);
      }
  row('home and Square: day 1', day1, LIMITS.home.day1, day1 > LIMITS.home.day1);
  row('home and Square: day 1, others', strangers.size, 0, strangers.size > 0, [...strangers].join(' '));
  let before = 0;
  const census: string[] = [];
  for (let shards = 0; shards <= 7; shards++) {
    let most = 0;
    let list: string[] = [];
    for (const hero of starters)
      for (const night of [false, true])
        for (const found of [false, true]) {
          const st: State = {
            label: `${shards} shards, ${night ? 'night' : 'day'}, ${hero}${found ? ', all found' : ''}`,
            hero,
            shards,
            night,
            found,
          };
          const w = people(c, st);
          const home = atHome(w);
          if (home.length > most) {
            most = home.length;
            list = home.map((p) => p.id);
          }
          see(st, w);
        }
    // never more than 8 until the second shard is won, and each shard adds at most 2
    const limit = LIMITS.home.early + Math.max(0, shards - 1) * LIMITS.home.perShard;
    const grew = shards > 0 && most - before > LIMITS.home.perShard;
    row(
      shards === 0 ? 'home and Square: day 2' : `home and Square: ${shards} shard${shards === 1 ? '' : 's'}`,
      most,
      limit,
      most > limit || grew,
      grew ? `${most - before} more than with ${shards - 1}` : '',
    );
    census.push(`  ${shards} shards: ${list.sort().join(' ')}`);
    before = most;
  }
  {
    const st: State = { label: 'after the party', hero: 'amelia', shards: 7, night: false, after: true };
    const w = people(c, st);
    row('home and Square: after the party', atHome(w).length, '-', false, 'everyone comes home', true);
    const f = fullest(w);
    let n = 0;
    for (const v of f.values()) n = Math.max(n, v.n);
    row('fullest screen: after the party', n, LIMITS.screen, n > LIMITS.screen, '', true);
  }

  // 6. the fullest screen in each region
  for (const id in c.regions) {
    const f = screens.get(id);
    if (!f) continue;
    row(
      `fullest screen: ${id}`,
      f.n,
      LIMITS.screen,
      f.n > LIMITS.screen,
      f.n > LIMITS.screen ? `${f.when}: ${f.ids.join(' ')}` : '',
      !STRICT.has(id),
    );
  }

  // 6b. the rooms she can walk into (package 34) and her cottage
  for (const [id, f] of screens) {
    if (c.regions[id]) continue;
    row(
      `fullest screen: ${id}`,
      f.n,
      LIMITS.screen,
      f.n > LIMITS.screen,
      f.n > LIMITS.screen ? `${f.when}: ${f.ids.join(' ')}` : '',
    );
  }

  // 7. stickers: the journal's three tabs (src/data/stickers.ts; the Friends page is not counted)
  const stickers = journalStickers(c.stickers).length;
  row('stickers in the journal', stickers, LIMITS.stickers.all, stickers > LIMITS.stickers.all);
  row('sticker tabs', JOURNAL_TABS.length, LIMITS.stickers.tabs, JOURNAL_TABS.length > LIMITS.stickers.tabs);

  // 8. KEY PRESSES: see presses() above
  const p = presses();
  if (p) {
    row('key presses: title to walking', p.plain, LIMITS.presses.plain, p.plain > LIMITS.presses.plain);
    row('key presses: with the skip', p.skip, LIMITS.presses.skip, p.skip > LIMITS.presses.skip);
  } else
    rows.push({
      what: 'key presses: title to walking',
      value: '-',
      limit: `${LIMITS.presses.plain} (${LIMITS.presses.skip})`,
      verdict: 'later',
      note: `the smoke run writes ${PRESSES_FILE}`,
    });

  if (verbose) {
    console.log('Who stands in the home and Square regions (the fullest case):');
    for (const l of census) console.log(l);
  }
  return { ok: rows.every((r) => r.verdict !== 'FAIL'), rows };
}

function main(): void {
  const r = calm(content, process.argv.includes('--verbose'));
  const w = Math.max(...r.rows.map((x) => x.what.length));
  console.log(`${'what'.padEnd(w)}  value  limit     verdict`);
  for (const x of r.rows)
    console.log(
      `${x.what.padEnd(w)}  ${x.value.padStart(5)}  ${x.limit.padEnd(8)}  ${x.verdict}${x.note ? `  ${x.note}` : ''}`,
    );
  const bad = r.rows.filter((x) => x.verdict === 'FAIL').length;
  console.log(bad ? `CALM FAIL (${bad} limits broken)` : 'CALM OK');
  process.exit(bad ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
