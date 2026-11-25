// The design checklist gate (build plan section 6). docs/DESIGN_CHECKLIST.md is the single source: one row per
// promise in docs/GAME_DESIGN.md, each with the proof that it is true. This script parses the table, runs every
// proof it can, prints each unproven row with the reason and exits 1 if any row is unproven.
//
//   node tools/check/checklist.ts            summary, plus every unproven row
//   node tools/check/checklist.ts --verbose  every row with its result
//   node tools/check/checklist.ts --write    also refresh the status column of the .md (proven or unproven)
//
// Row: | id | promise | design section | proof kind | proof | status |
// The proof column is one or more segments separated by ";", each "kind: argument". The kind column names the
// kinds used, joined with "+" (it must agree with the proof column). Kinds:
//   data:       a named check below, run against the content (src/data), the personal file or the code
//   solver:     an event in test-results/solver.json. "reward <kind> <id> [<id>...]" (all ids), "mark <what>",
//               "run hero <id>" (a run for that hero that finished with nothing stuck or given up). Any run
//               counts, or add "run N" at the end of reward and mark events for one run.
//   test:       the exact it('...') or test('...') title in tests/*.test.ts (the file is read, not run)
//   screenshot: a file under test-results/ that must exist (the smoke run deletes its folder first, so it is fresh)
//   review:     a reviewer's reading written down in a file that ends with the line "Verdict: pass"
//   none:       not built, or built without proof yet: always unproven (the text after the colon says why)
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { AreaDef, Content, Line, QuestDef } from '../../src/core/types.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const MD = join(ROOT, 'docs/DESIGN_CHECKLIST.md');
const VERBOSE = process.argv.includes('--verbose');
const WRITE = process.argv.includes('--write');

// ---------------------------------------------------------------- loading what the checks look at

let c: Content;
let loadError = '';
let DEFAULT_OPTS: { christmas: string; gentle: boolean; helper: boolean; music: number; sound: number } | undefined;
let BAG: { BAG_SLOTS: number; HOTBAR: number; CHEST_SLOTS: number; PLOT_W: number; PLOT_H: number } | undefined;
let CLOCK: { DAY_LEN: number; DUSK_AT: number; NIGHT_AT: number; DAWN_AT: number } | undefined;
let isChristmas: ((s: 'auto' | 'on' | 'off', d: Date) => boolean) | undefined;
let validateArt: ((c: Content, o: { art?: boolean }) => { problems: string[] }) | undefined;
let JOURNAL:
  | (typeof import('../../src/data/stickers.ts') & { TAB_PRIZE: Record<string, { item?: string; emeralds?: number }> })
  | undefined;
let calmFn: typeof import('./calm.ts')['calm'] | undefined;
/** the tunes by name (package 79 builds them by code, so the file's text no longer lists them one per line) */
let TUNES: Record<string, unknown> | undefined;
try {
  c = (await import('../../src/data/content.ts')).content;
  TUNES = (await import('../../src/game/music.ts')).MUSIC;
  DEFAULT_OPTS = (await import('../../src/core/state.ts')).DEFAULT_OPTS;
  BAG = await import('../../src/core/bag.ts');
  CLOCK = await import('../../src/core/cond.ts');
  isChristmas = (await import('../../src/game/save.ts')).isChristmas;
  validateArt = (await import('./validate.ts')).validate;
  JOURNAL = {
    ...(await import('../../src/data/stickers.ts')),
    TAB_PRIZE: (await import('../../src/core/quests.ts')).TAB_PRIZE,
  };
  calmFn = (await import('./calm.ts')).calm;
} catch (e) {
  loadError = e instanceof Error ? e.message : String(e);
  c = undefined as unknown as Content;
}

function readJson<T>(rel: string): T | null {
  try {
    return JSON.parse(readFileSync(join(ROOT, rel), 'utf8')) as T;
  } catch {
    return null;
  }
}

interface SolverEvent {
  kind?: string;
  id?: string;
  what?: string;
}
interface SolverRun {
  post?: string[];
  run?: number;
  hero?: string;
  swapTo?: string;
  stuck?: unknown;
  gaveUp?: Record<string, unknown> | null;
  rewards?: SolverEvent[];
  marks?: SolverEvent[];
}
const solver = readJson<SolverRun[]>('test-results/solver.json');
const personal = readJson<{
  greeting1?: string;
  greeting2?: string;
  credits?: string;
  names?: Record<string, string>;
  letters?: Record<string, { from?: string; pages?: string[] }>;
  bottles?: Record<string, string>;
  december?: Record<string, string>;
}>('src/data/personal.json');
const motion = readJson<{ results: Record<string, Record<string, { ok?: boolean }>> }>('art/qa/motion.json');

/** Text of a source file or of every .ts file under a folder (for facts about the code). */
function src(rel: string): string {
  const p = join(ROOT, rel);
  if (!existsSync(p)) return '';
  if (statSync(p).isFile()) return readFileSync(p, 'utf8');
  return readdirSync(p, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.ts'))
    .map((f) => readFileSync(join(p, f), 'utf8'))
    .join('\n');
}

// ---------------------------------------------------------------- helpers for the checks

class Unproven extends Error {}
function need(ok: unknown, why: string): asserts ok {
  if (!ok) throw new Unproven(why);
}
const isl = (): AreaDef => c.areas.island;
const at = (x: number, y: number) => isl().region[y]?.[x] ?? '';
const objs = (type: string) => isl().objects.filter((o) => o.type === type);
const objsIn = (type: string, code: string) => objs(type).filter((o) => at(o.x, o.y) === code);
const anyArea = (type: string) => Object.values(c.areas).flatMap((a) => a.objects.filter((o) => o.type === type));
const quest = (id: string) => c.quests[id];
const place = (id: string) => isl().places[id];
const site = (id: string) => isl().sites.find((s) => s.id === id);
const sameNeeds = (got: Record<string, number> | undefined, want: Record<string, number>) =>
  !!got && JSON.stringify(Object.entries(got).sort()) === JSON.stringify(Object.entries(want).sort());

/** Every object in any area whose contents (`d`, "id:n,id:n") hold this id. */
const givers = (id: string) =>
  Object.values(c.areas).flatMap((a) =>
    a.objects.filter((o) => (o.d ?? '').split(',').some((part) => part.split(':')[0]!.trim() === id)),
  );

/** A set sticker in a journal tab with exactly `n` parts kept as quiet records (PHASE2 part C). */
function setOf(id: string, tab: string, n: number): void {
  need(c.stickers[id]?.page === tab, `no set sticker ${id} in the ${tab} tab`);
  const parts = Object.values(c.stickers).filter((s) => s.of === id);
  need(parts.length === n, `${id} has ${parts.length} parts, need ${n}`);
}

/** Rows of the calm check (tools/check/calm.ts) whose name matches: at least `atLeast` of them, none failing. */
let calmCache: { what: string; value: string; limit: string; verdict: string }[] | null = null;
function calmRows(match: RegExp, atLeast: number): void {
  need(calmFn, 'tools/check/calm.ts did not load');
  calmCache ??= calmFn(c).rows;
  const rows = calmCache.filter((r) => match.test(r.what));
  need(rows.length >= atLeast, `the calm check has ${rows.length} rows for ${match}, expected ${atLeast}`);
  const bad = rows.filter((r) => r.verdict === 'FAIL');
  need(!bad.length, bad.map((r) => `${r.what} ${r.value} (limit ${r.limit})`).join(', '));
}

/** Every string in personal.json under a key whose path mentions `word`. */
function personalStrings(word: RegExp): string[] {
  const out: string[] = [];
  const walk = (v: unknown, path: string) => {
    if (typeof v === 'string') {
      if (word.test(path)) out.push(v);
    } else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
  };
  walk(personal, '');
  return out;
}

/** Every listed object type stands in the region with this map code; every named place exists. */
function regionCheck(
  id: string,
  code: string | null,
  o: { objs?: string[]; places?: string[]; areas?: string[]; min?: Record<string, number> },
) {
  return () => {
    const r = c.regions[id];
    need(r, `no region "${id}"`);
    need(r.music, 'region has no music');
    if (code) {
      need(r.code === code, `region code is ${r.code}, expected ${code}`);
      need(
        isl().region.some((row) => row.includes(code)),
        `no ${code} tiles on the island map`,
      );
    }
    for (const t of o.objs ?? []) need(code ? objsIn(t, code).length : anyArea(t).length, `no ${t} in ${id}`);
    for (const [t, n] of Object.entries(o.min ?? {}))
      need((code ? objsIn(t, code) : anyArea(t)).length >= n, `fewer than ${n} ${t} in ${id}`);
    for (const p of o.places ?? []) need(place(p), `no place "${p}"`);
    for (const a of o.areas ?? []) need(c.areas[a], `no area "${a}"`);
    if (r.sign)
      need(
        objs('signpost').some((s) => s.d === r.sign),
        `no signpost for ${id}`,
      );
  };
}

const standIns: Record<string, string> = {
  amelia: 'mum',
  koala: 'mama_koala',
  bluey: 'bingo',
  peppa: 'mummy_pig',
  bing: 'flop',
  flop: 'bing',
  bob: 'kevin',
  woody: 'jessie',
  jessie: 'woody',
  buzz: 'rex',
  hello_kitty: 'mimmy',
  kuromi: 'baku',
  gabby: 'pandy',
  paddington: 'stuart',
};

/** The crafting table in the design, by recipe id: [output count, inputs]. */
const designRecipes: Record<string, [number, Record<string, number>]> = {
  plank: [4, { log: 1 }],
  stick: [4, { plank: 2 }],
  crafting_table: [1, { plank: 4 }],
  chest: [1, { plank: 8 }],
  furnace: [1, { cobblestone: 8 }],
  torch: [4, { coal: 1, stick: 1 }],
  wood_sword: [1, { plank: 2, stick: 1 }],
  stone_sword: [1, { cobblestone: 2, stick: 1 }],
  iron_sword: [1, { iron_ingot: 2, stick: 1 }],
  diamond_sword: [1, { diamond: 2, stick: 1 }],
  wood_pick: [1, { plank: 3, stick: 2 }],
  stone_axe: [1, { cobblestone: 3, stick: 2 }],
  iron_pick: [1, { iron_ingot: 3, stick: 2 }],
  wood_spade: [1, { plank: 1, stick: 2 }],
  iron_spade: [1, { iron_ingot: 1, stick: 2 }],
  bed: [1, { wool: 3, plank: 3 }],
  ladder: [3, { stick: 7 }],
  fence: [3, { plank: 4, stick: 2 }],
  fishing_rod: [1, { stick: 3, string: 2 }],
  boat: [1, { plank: 5 }],
  bucket: [1, { iron_ingot: 3 }],
  tnt: [1, { gunpowder: 5, sand: 4 }],
  iron_ingot: [1, { iron_ore: 1, coal: 1 }],
  gold_ingot: [1, { gold_ore: 1, coal: 1 }],
  glass: [1, { sand: 1 }],
  sugar: [1, { sugar_cane: 1 }],
  bread: [1, { wheat: 3 }],
  cake: [1, { milk: 3, sugar: 2, egg: 1, wheat: 3 }],
  carrot_cake: [1, { carrot: 3, egg: 1, wheat: 1, sugar: 1 }],
  jack_lantern: [1, { pumpkin: 1, torch: 1 }],
  apple_pie: [1, { apple: 3, wheat: 2, sugar: 1 }],
  marmalade: [1, { orange: 3, sugar: 1 }],
  rocket_item: [1, { star_fragment: 3, glass: 1, plank: 2 }],
  creeper_plush: [1, { wool: 4, gunpowder: 1 }],
  wishing_star: [1, { shard: 7, gold_ingot: 2, glass: 1 }],
};

/**
 * Clips the art check (node tools/check/validate.ts --art) finds missing or failing, by the validator's own rules:
 * its aliases (villagers share two looks), the puppet's fallbacks (only idle and walk need their own facing), clips
 * the code never plays, and the slow walks looked at one by one in art/qa/motion-ok.json.
 */
let artBad: { id: string; clip: string; facing: string }[] | null = null;
function artProblems(): { id: string; clip: string; facing: string }[] {
  if (artBad) return artBad;
  need(motion, 'art/qa/motion.json is missing');
  need(validateArt, `the art check did not load: ${loadError}`);
  const out: { id: string; clip: string; facing: string }[] = [];
  for (const p of validateArt(c, { art: true }).problems) {
    if (!p.startsWith('art: ')) continue;
    const m = /^art: ([a-z0-9_]+): (?:missing )?([a-z]+) ([a-z]+)/.exec(p);
    if (m) out.push({ id: m[1]!, clip: m[2]!, facing: m[3]! });
    else out.push({ id: '?', clip: '?', facing: p.slice(5) });
  }
  artBad = out;
  return out;
}
/** Characters (by role) the art check finds without a good clip of these kinds, for the "alive" rows. */
function motionMissing(roles: string[], clips: string[], only?: (id: string) => boolean): string[] {
  const want = new Set(clips.map((k) => k.split('_')[0]!));
  const facings = new Set(clips.map((k) => k.split('_')[1]!));
  const ids = new Set(
    [...Object.values(c.chars), ...Object.values(c.mobs)]
      .filter((x) => roles.includes(x.role) && (!only || only(x.id)))
      .map((x) => x.id),
  );
  if (roles.includes('animal')) for (const id in c.animals) ids.add(id);
  return artProblems()
    .filter((p) => p.id === '?' || ((ids.has(p.id) || !c.chars[p.id]) && want.has(p.clip) && facings.has(p.facing)))
    .map((p) => `${p.id}:${p.clip}_${p.facing}`);
}
function noneMissing(list: string[]) {
  need(
    list.length === 0,
    `${list.length} missing or failing: ${list.slice(0, 8).join(' ')}${list.length > 8 ? ' ...' : ''}`,
  );
}

// ---------------------------------------------------------------- the data checks, by name

const CHECKS: Record<string, () => void> = {
  // ---- section 2: title and personal touches
  personal_greeting: () => {
    need(personal, 'src/data/personal.json is missing');
    need(personal.greeting1?.includes('Boldog Karácsonyt'), 'greeting1 lacks the Hungarian greeting');
    need(personal.greeting2?.includes('Apától'), 'greeting2 lacks the sign-off');
  },
  personal_complete: () => {
    need(personal, 'src/data/personal.json is missing');
    need(personal.credits, 'no credits line');
    for (const t of [
      'amelia',
      'koala',
      'mum',
      'dad',
      'granny',
      'nanny',
      'grandad',
      'aunty',
      'teacher',
      'robin',
      'sam',
      'alex',
      'charlie',
    ])
      need(personal.names?.[t], `no name for {${t}}`);
    for (const l of Object.values(c.letters))
      if (l.from === 'personal') need(personal.letters?.[l.id]?.pages?.length, `no pages for letter ${l.id}`);
    const bottles = Object.keys(personal.bottles ?? {}).filter((k) => /^bottle\d+$/.test(k));
    need(bottles.length >= 10, `${bottles.length} bottle notes, need 10`);
    need(Object.keys(personal.december ?? {}).length === 25, 'december needs notes "1" to "25" (package 73b)');
  },
  personal_pages_short: () => {
    need(personal?.letters, 'no letters in personal.json');
    for (const [id, l] of Object.entries(personal.letters))
      for (const p of l.pages ?? []) need(p.length <= 220, `${id} has a page of ${p.length} characters`);
    for (const [id, b] of Object.entries(personal.bottles ?? {}))
      need(b.length <= 220, `${id} is ${b.length} characters`);
  },
  personal_outside_bundle: () => {
    need(/personal\.json/.test(src('tools/release/build.ts')), 'the release build does not handle personal.json');
    const app = src('src/game/app.ts');
    // the file is fetched (in players mode through net.ts with the hero's token, D67), never imported into the bundle
    need(
      /BASE_URL\}personal\.json/.test(app) && /fetch(Personal)?\(url/.test(app),
      'the game does not load personal.json at run time',
    );
    need(!/^import[^;]*personal\.json/m.test(app), 'personal.json is imported into the bundle');
    need(/catch/.test(app) && /builtIn/.test(app), 'no built-in fallback when personal.json is missing or broken');
  },
  letters_set: () => {
    for (const id of ['dad_1', 'mum_1', 'granny_1', 'nanny_1', 'grandad_1', 'aunty_1', 'friends_1', 'teacher_1'])
      need(c.letters[id], `no letter ${id}`);
    need(objs('mailbox').length, 'no mailbox at home');
  },
  letters_gifts: () =>
    need(Object.values(c.letters).filter((l) => l.gift).length >= 5, 'fewer than 5 letters carry a gift'),
  finale_letter: () => {
    need(c.letters.dad_finale, 'no dad_finale letter');
    need(personal?.letters?.dad_finale?.pages?.length, 'no finale letter text in personal.json');
  },
  xmas_window: () => {
    need(isChristmas, 'save.ts did not load');
    const d = (s: string) => new Date(`${s}T12:00:00`);
    need(
      isChristmas('auto', d('2026-12-01')) && isChristmas('auto', d('2027-01-06')),
      'Auto is off inside 1 Dec to 6 Jan',
    );
    need(
      !isChristmas('auto', d('2026-11-30')) && !isChristmas('auto', d('2027-01-07')),
      'Auto is on outside 1 Dec to 6 Jan',
    );
    need(
      isChristmas('on', d('2026-06-01')) && !isChristmas('off', d('2026-12-25')),
      'On and Off do not override the date',
    );
  },
  xmas_options: () => need(DEFAULT_OPTS?.christmas === 'auto', 'the Christmas option does not default to Auto'),
  xmas_world_art: () => {
    need(Object.values(c.objects).filter((o) => o.winter).length >= 8, 'fewer than 8 objects with a winter variant');
    need(c.objects.fairy_lights && c.objects.snowman, 'no fairy lights or snowman object');
    for (const i of ['xmas_tree', 'snowman_item', 'fairy_string', 'snow_block']) need(c.recipes[i], `no recipe ${i}`);
  },
  twelve_presents: () => {
    need(objs('present_pile').length, 'no present pile in the Square');
    for (let i = 1; i <= 12; i++) need(c.strings[`present:${i}`], `no text for present ${i}`);
  },
  grandad_xmas: () => need(existsSync(join(ROOT, 'art/src/chars/grandad_xmas')), 'no red-hat Grandad art'),
  snowball_fight: () => {
    need(c.chars.alex?.service === 'mini:snowball', '{alex} does not host the snowball fight');
    need(c.strings['how:snowball'] && c.strings['mini:snowball'], 'no snowball texts');
    need(c.recipes.snowman_item && c.recipes.snow_golem, 'no snowman or snow golem recipe');
  },
  story_without_christmas: () => {
    for (const q of Object.values(c.quests))
      if (q.kind === 'main')
        need(!JSON.stringify(q).includes('christmas'), `main quest ${q.id} needs the Christmas layer`);
    need(objs('great_tree').length && objs('great_tree_lit').length, 'the Great Tree has no plain and lit variants');
  },

  // ---- section 3: controls
  keymap: () => {
    const t = src('src/game');
    for (const k of [
      'KeyE',
      'KeyB',
      'KeyQ',
      'KeyM',
      'KeyK',
      'KeyR',
      'KeyG',
      'KeyX',
      'Backspace',
      'KeyP',
      'Escape',
      'KeyF',
      'KeyH',
      'Digit',
      'Space',
      'Enter',
    ])
      need(t.includes(k), `no handler for ${k}`);
  },
  no_yz_keys: () =>
    need(!/['"](Key[YZ]|F\d{1,2})['"]/.test(src('src/game')), 'an action sits on Y, Z or a function key'),
  page_scroll: () =>
    need(
      /capture:\s*\[[^\]]*\b32\b[^\]]*\b37\b/.test(src('src/main.ts')),
      'Space and the arrow keys are not captured away from the page',
    ),
  hint_strip: () => {
    need(/rt\.hint\s*=/.test(src('src/core')), 'the rules never set the Space hint');
    need(/hint/i.test(src('src/game/scenes/UI.ts')), 'the HUD never draws the hint');
  },

  // ---- section 4: story and structure
  intro_scene: () => {
    need(c.cutscenes.intro?.acts.length, 'no intro cutscene');
    need(quest('prologue')?.kind === 'main', 'no prologue quest');
    // PHASE2 part A: at most 3 boxes, 25 words and 5 characters on screen, as the calm check counts them
    calmRows(/^intro: /, 3);
  },
  chapter_1: () => {
    const q = quest('ch1');
    need(
      q?.region === 'heeler' && q.steps.some((s) => s.t === 'mini' && s.game === 'keepy'),
      'ch1 is not the Heeler Heights balloon chapter',
    );
    need(
      q.steps.some((s) => s.t === 'defeat'),
      'ch1 has no first fight',
    );
  },
  chapter_2: () => {
    const q = quest('ch2');
    need(q?.region === 'bing', "ch2 is not in Bing's Garden");
    need(
      q.steps.some((s) => s.t === 'site' && s.site === 'pen_bing'),
      'ch2 does not build the pen',
    );
    for (const t of ['lead', 'defeat', 'mini'])
      need(
        q.steps.some((s) => s.t === t),
        `ch2 has no ${t} step`,
      );
  },
  chapter_3: () => {
    const q = quest('ch3');
    need(q?.region === 'peppa', "ch3 is not on Peppa's Hill");
    need(
      q.steps.some((s) => s.t === 'site' && s.site === 'north_bridge') &&
        q.steps.some((s) => s.t === 'mini' && s.game === 'puddles'),
      'ch3 lacks the north bridge or the puddle course',
    );
  },
  chapter_4: () => {
    const q = quest('ch4');
    need(q?.region === 'gum', 'ch4 is not in Gum Tree Grove');
    need(
      q.steps.some((s) => s.t === 'site' && s.site === 'treehouse') &&
        q.steps.some((s) => s.t === 'craft' && s.item === 'bow') &&
        q.steps.some((s) => s.t === 'craft' && s.item === 'arrow') &&
        q.steps.some((s) => s.t === 'lead'),
      'ch4 lacks the treehouse, the bow and arrows or the rescue',
    );
    // fishing moved to home4 (package 43a): the home chapter after ch4 teaches it
    need(
      quest('home4')?.steps.some((s) => s.t === 'fish'),
      'no home chapter teaches fishing',
    );
  },
  chapter_5: () => {
    const q = quest('ch5');
    need(q?.region === 'plains', 'ch5 is not on the Blocky Plains');
    need(
      q.steps.some((s) => s.t === 'site' && s.site === 'east_bridge') &&
        q.steps.some((s) => s.t === 'site' && s.site === 'village_fence'),
      'ch5 lacks the east bridge or the village fence',
    );
    nightDefence();
  },
  chapter_6: () => {
    const q = quest('ch6');
    need(q?.region === 'forest', 'ch6 is not in the Blocky Forest');
    need(
      q.steps.some((s) => s.t === 'site' && s.site === 'mine_torches') &&
        q.steps.some((s) => s.t === 'defeat' && s.mob === 'spider_jockey'),
      'ch6 lacks the Mine torches or the Spider Jockey',
    );
  },
  chapter_7: () => {
    const q = quest('ch7');
    need(
      q?.region === 'crater' && q.steps.some((s) => s.t === 'defeat' && s.mob === 'creeper_king'),
      'ch7 does not end in the Creeper King fight',
    );
  },
  chapters_order: () => {
    const need12 = (id: string) => JSON.stringify(quest(id)?.requires ?? {});
    need(!need12('ch1').includes('ch2') && !need12('ch2').includes('ch1'), 'ch1 and ch2 depend on each other');
    need(need12('ch3').includes('ch1') && need12('ch3').includes('ch2'), 'ch3 does not wait for both ch1 and ch2');
    for (let i = 4; i <= 7; i++) need(need12(`ch${i}`).includes(`ch${i - 1}`), `ch${i} does not wait for ch${i - 1}`);
  },
  finale: () => {
    const q = quest('finale');
    need(
      q?.steps.some((s) => s.t === 'craft' && s.item === 'wishing_star') &&
        q.steps.some((s) => s.t === 'site' && s.site === 'tree_ladders'),
      'the finale quest lacks the star or the ladders',
    );
    need(
      sameNeeds(c.recipes.wishing_star?.in, { shard: 7, gold_ingot: 2, glass: 1 }),
      'the Wishing Star recipe is not 7 shards, 2 gold ingots, 1 glass',
    );
    need(c.cutscenes.finale?.acts.length > 20, 'no finale cutscene');
  },
  group_photo: () => {
    need(
      c.cutscenes.finale?.acts.some((a) => a.fx?.open === 'finale'),
      'the finale scene does not open the finale screens',
    );
    const f = src('src/game/ui/menus/finale.ts');
    need(/register\('finale'/.test(f) && /new PhotoMenu\(/.test(f), 'the finale screens do not take the group photo');
    const m = src('src/game/ui/menus/misc.ts');
    need(/Math\.min\(5,/.test(m) && /c: 'photo'/.test(m), 'the photo does not pick 5 friends');
    need(/case 'photo':[\s\S]{0,80}photo_frame/.test(src('src/core/step.ts')), 'the photo is not kept as a picture');
  },
  credits_line: () => {
    need(personal?.credits?.includes('Dad'), 'the credits line does not credit Dad');
    need(/app\.personal\.credits/.test(src('src/game/ui/menus/finale.ts')), 'the credits are never shown');
  },
  post_game: () => {
    need(quest('finale')?.rewards?.flags?.includes('postgame'), 'the finale does not open the post-game');
    const after = Object.values(c.quests).filter((q) => /"finale"|postgame/.test(JSON.stringify(q.requires ?? {})));
    need(after.length >= 1, 'no quest opens after the credits');
    need(
      c.chars.dj_catnip?.spots.some((p) => JSON.stringify(p.if ?? {}).includes('postgame')),
      'nobody new arrives after the credits',
    );
  },
  creeper_king_twist: () => {
    for (let i = 0; i < 3; i++) need(c.strings[`king_phase${i}`], `no text for King phase ${i}`);
    need(c.mobs.creeper_king?.hp === 9 && c.mobs.mini_creeper, 'the King is not a 9-hit boss with mini creepers');
    need(c.cutscenes.king_calm, 'no calm-down scene');
  },
  twist_clues: () => {
    need(objs('scorch').length >= 7 && objs('lone_flower').length >= 7, 'fewer than 7 scorch marks or lone flowers');
    for (let i = 1; i <= 6; i++) need(c.strings[`tm_clue${i}`], `no clue text ${i}`);
  },
  arrivals_gated: () => {
    for (const id of ['jessie', 'bullseye', 'rex', 'bo_peep', 'kuromi', 'baku', 'gabby', 'mercat', 'kevin'])
      need(
        c.chars[id]?.spots.some((s) => s.if),
        `${id} is on the island from the start (no arrival condition)`,
      );
  },
  tomorrow_card: () => {
    need(c.strings.tm_title, 'no Tomorrow card title');
    const n = Object.keys(c.strings).filter((k) => /^tm_/.test(k)).length;
    need(n >= 8, `only ${n} Tomorrow teasers`);
  },
  shooting_stars: () => {
    need(c.strings.shooting_star && c.items.star_fragment, 'no shooting star text or star fragment');
    need(objs('radar_dish').length, 'no star radar');
    need(
      Object.keys(isl().places).filter((p) => /^star_\d/.test(p)).length >= 3,
      'no star fragment landing places on the beach',
    );
  },
  wandering_trader: () => {
    need(c.stalls.trader?.keeper === 'wandering_trader' && c.chars.wandering_trader, 'no wandering trader stall');
    need(c.animals.llama, 'no llama');
  },
  gentle_default: () => need(DEFAULT_OPTS?.gentle === true, 'Gentle is not the default'),
  mine_levels: () => need(c.areas.mine1 && c.areas.mine2 && c.areas.mine3, 'the Mine does not have three levels'),

  // ---- section 5: cast
  starting_six: () => {
    for (const h of ['amelia', 'bluey', 'bing', 'flop', 'peppa', 'koala'])
      need(c.heroes[h]?.starter === true, `${h} is not a starting hero`);
    need(Object.values(c.heroes).filter((h) => h.starter).length === 6, 'the starting hero list is not exactly six');
  },
  friend_heroes: () => {
    for (const h of ['woody', 'buzz', 'jessie', 'hello_kitty', 'kuromi', 'gabby', 'paddington', 'bob']) {
      need(c.heroes[h] && !c.heroes[h].starter, `${h} is not a locked friend hero`);
      const q = Object.values(c.quests).find((x) => x.kind === 'friend' && x.rewards?.hero === h);
      need(q, `no friend quest line that unlocks ${h}`);
    }
  },
  mirror: () => {
    need(
      c.areas.cottage?.objects.some((o) => o.type === 'mirror'),
      'no mirror in the cottage',
    );
  },
  hero_emotes_lines: () => {
    const emotes = Object.values(c.heroes).map((h) => h.emote);
    const dup = emotes.filter((e, i) => emotes.indexOf(e) !== i);
    need(dup.length === 0, `heroes share the emote ${dup.join(', ')}`);
    const looks = src('src/game/world/emotes.ts');
    for (const e of emotes)
      need(new RegExp(`^\\s+${e}: \\{`, 'm').test(looks), `the emote ${e} has no look of its own`);
    for (const h of Object.values(c.heroes))
      need(Object.keys(h.lines).length >= 2, `${h.id} has fewer than 2 own lines`);
  },
  standin_table: () => {
    for (const [h, s] of Object.entries(standIns))
      need(c.chars[h]?.standIn === s, `${h} should have ${s} as stand-in, has ${c.chars[h]?.standIn}`);
  },
  standin_lines: () => {
    // Only lines the giver speaks need a stand-in version: a Wanted poster's lines are read off the board.
    const speaks = (q: QuestDef, ls: Line[] | undefined) =>
      (ls ?? []).some((l) => (typeof l === 'string' ? l : l.l).startsWith(`${q.giver}:`));
    for (const q of Object.values(c.quests))
      if (c.heroes[q.giver]) {
        if (speaks(q, q.open))
          need(q.openAlt?.length, `${q.id} (given by a playable character) lacks stand-in open lines`);
        if (speaks(q, q.close))
          need(q.closeAlt?.length, `${q.id} (given by a playable character) lacks stand-in close lines`);
      }
  },
  heroes_play_same: () => {
    const allowed = new Set(['id', 'starter', 'emote', 'lines']);
    for (const h of Object.values(c.heroes))
      for (const k of Object.keys(h)) need(allowed.has(k), `${h.id} has its own "${k}" stat`);
  },
  amelia_as_friend: () =>
    need(
      c.chars.amelia?.spots.length && c.chars.amelia.chat.length,
      '{amelia} has no spot or chat for when she is not the hero',
    ),
  heroes_at_home: () => {
    for (const h of Object.keys(c.heroes))
      need(c.chars[h]?.spots.length && c.chars[h].chat.length, `${h} has no home spot or chatter`);
  },
  group_bluey: () => groupChars(['bandit', 'chilli', 'bingo'], 'U', ['heeler_house', 'veranda']),
  group_peppa: () => groupChars(['mummy_pig', 'daddy_pig', 'george'], 'P', ['peppa_house']),
  group_bing: () => groupChars(['sula', 'pando', 'coco'], 'B', ['bing_house']),
  eight_joeys: () => {
    // PHASE2 part C: the joeys are one set sticker in the Creatures tab, its 8 parts kept as quiet records
    setOf('set_joeys', 'creatures', 8);
    need(quest('sq_mama_joeys')?.giver === 'mama_koala', 'no quest from Mama Koala for her joeys');
    need(c.chars.mama_koala && c.animals.joey, 'no Mama Koala or joey animal');
    need(
      objs('joey').length >= 5 && Object.keys(isl().places).filter((p) => p.startsWith('herd_joey')).length >= 3,
      'fewer than 5 hidden joeys or 3 led ones',
    );
  },
  toy_box_corner: () => {
    for (const id of [
      'woody',
      'buzz',
      'jessie',
      'bullseye',
      'rex',
      'hamm',
      'slinky',
      'potato',
      'bo_peep',
      'alien',
      'forky',
    ])
      need(c.chars[id], `no ${id}`);
    for (const t of ['alphabet_blocks', 'cardboard_fort', 'toy_train', 'claw_machine'])
      need(objsIn(t, 'H').length, `no ${t} in Toy Box Corner`);
    need(objs('toy_track').length >= 10, 'no toy train track');
    // PHASE2 part B: the boom scattered the toys; some are found out in the world and then come home
    const found = ['woody', 'buzz', 'jessie', 'bullseye', 'rex', 'hamm', 'slinky', 'potato', 'bo_peep'].filter((id) =>
      c.chars[id]?.spots.some((p) => p.found || p.if),
    );
    need(found.length >= 6, `only ${found.length} toys arrive or are found later`);
    need(
      c.chars.potato?.spots.some((p) => p.found),
      'no toy is found out in the world',
    );
  },
  bounty_board: () => {
    need(objsIn('bounty_board', 'H').length && c.chars.woody, 'no bounty board or Woody');
    // the Wanted posters (package 43b): Woody's four fights, on the Square board, each repeats and pays a ticket
    const posters = ['b_zombies', 'b_spiders', 'b_skeletons', 'b_creepers'].map((id) => quest(id));
    for (const q of posters) {
      need(q?.kind === 'bounty' && q.giver === 'woody', 'a Wanted poster is missing or not from Woody');
      need(q.repeat, `${q.id} does not repeat`);
      need(
        q.steps.some((s) => s.t === 'defeat'),
        `${q.id} is not a fight`,
      );
      need(q.rewards?.claw, `${q.id} pays no prize ticket`);
    }
  },
  board_jobs: () => {
    need(objsIn('noticeboard', 'W').length, 'no board in Wishing Square');
    const jobs = Object.values(c.quests).filter((q) => q.kind === 'bounty');
    need(jobs.length === 20, `${jobs.length} board jobs, the board has 20`);
    for (const q of jobs) need(q.board, `${q.id} is not on the board`);
  },
  star_radar: () => need(objs('radar_dish').length && c.chars.buzz, 'no star radar or Buzz'),
  jessie_leads: () => {
    need(c.chars.jessie && c.chars.bullseye, 'no Jessie or Bullseye');
    need(
      c.chars.jessie.spots.some((p) => p.if?.flag === 'defence_on') &&
        c.chars.woody?.spots.some((p) => p.if?.flag === 'defence_on'),
      'Jessie and Woody do not ride in for the village defence',
    );
    need(
      c.chars.bullseye.spots.some((p) => p.if?.done === 'ch5'),
      'Bullseye does not stay on the Plains after chapter 5',
    );
    need(
      quest('ch2')?.steps.some((s) => s.t === 'lead'),
      'ch2 does not teach leading an animal',
    );
  },
  george_rex: () => need(quest('sq_george_dino')?.giver === 'george' && c.chars.rex, 'no George and Rex quest'),
  prize_counter: () =>
    need(c.stalls.prizes?.keeper === 'hamm' && objs('prize_counter').length, 'no prize counter run by Hamm'),
  slinky_bridge: () => {
    need(
      isl().barriers.some((b) => b.id === 'slinky_gap' && b.flag === 'slinky_bridge'),
      'no Slinky gap barrier',
    );
    need(objs('slinky_bridge').length && quest('sq_slinky_bridge')?.giver === 'slinky', 'no Slinky bridge or quest');
  },
  potato_parts: () => {
    const q = quest('sq_potato_parts');
    need(q?.giver === 'potato', 'no Mr Potato Head quest');
    const parts = ['potato_ears', 'potato_nose', 'potato_hat', 'potato_eyes', 'potato_arms'];
    for (const p of parts) {
      need(c.items[p], `no item ${p}`);
      need(
        q.steps.some((s) => s.t === 'fetch' && s.item === p),
        `the quest does not ask for ${p}`,
      );
    }
  },
  bo_peep_wool: () => {
    need(c.chars.bo_peep && c.animals.sheep?.gives?.item === 'wool', 'no Bo Peep or wool from sheep');
    need(quest('sq_bo_wool')?.giver === 'bo_peep', 'no Bo Peep wool quest');
  },
  apple_cafe: () => {
    need(
      c.stalls.cafe?.keeper === 'hello_kitty' && objsIn('cafe', 'W').length,
      'no Apple Cafe run by Hello Kitty in the Square',
    );
    need(c.recipes.apple_pie, 'no apple pie recipe');
  },
  kuromi_stall: () => {
    need(c.stalls.kuromi?.keeper === 'kuromi', 'no Kuromi stall');
    const o = objsIn('night_stall', 'W')[0];
    need(o, 'no night stall in the Square');
    need(o.if && JSON.stringify(o.if).includes('night'), 'the night stall is not tied to night');
    need(JSON.stringify(o.if).match(/shards|done|flag/), 'the night stall is not tied to chapter 4');
  },
  minion_crew: () => {
    for (const s of ['minions_bridge', 'minions_treehouse', 'minions_east'])
      need(c.cutscenes[s], `no ${s} swarm scene`);
    for (const id of ['kevin', 'stuart', 'bob', 'minion_d', 'minion_e']) need(c.chars[id], `no ${id}`);
  },
  banana_grove: () =>
    need(
      objsIn('banana_tree', 'S').length >= 6 && objsIn('banana_stand', 'S').length && c.items.banana,
      'no banana grove on Sandy Bay',
    ),
  bob_teddy: () =>
    need(JSON.stringify(c.quests).includes('teddy') && quest('fr_bob'), 'no lost teddy quest line for Bob'),
  gabby_mentor: () => {
    need(
      c.stalls.dollhouse?.keeper === 'gabby' && objsIn('dollhouse', 'W').length,
      'no Dollhouse run by Gabby in the Square',
    );
    const furniture = c.stalls.dollhouse.sells.filter(
      (x) => c.items[x.item]?.kind === 'furniture' || c.items[x.item]?.kind === 'block',
    );
    need(furniture.length >= 5, 'the Dollhouse stall sells fewer than 5 furniture or block items');
  },
  gabby_deliveries: () => {
    for (const id of ['gabby_1', 'gabby_2', 'gabby_3'])
      need(c.letters[id]?.gift, `${id} is not a delivery with a gift`);
  },
  dj_catnip: () => {
    need(c.chars.dj_catnip?.service === 'jukebox' && c.recipes.jukebox, 'no jukebox keeper or jukebox recipe');
    setOf('set_discs', 'treasures', 5);
    // every disc is found somewhere: in a chest, a dig spot or a pick-up
    for (const s of Object.values(c.stickers).filter((x) => x.of === 'set_discs'))
      need(
        givers(s.id).length ||
          givers(`sticker.${s.id}`).length ||
          Object.values(c.stalls).some((st) => st.sells.some((x) => x.item === s.id)),
        `nothing gives ${s.id}`,
      );
  },
  gabby_cats_placed: () => {
    for (const id of ['cakey', 'mercat', 'kitty_fairy', 'pandy'])
      need(c.chars[id]?.spots.length, `${id} has no place on the island`);
    need(place('mercat') && place('kitty_fairy') && place('cakey'), 'no places for Cakey, MerCat and Kitty Fairy');
  },
  paddington_post: () => {
    need(
      c.chars.paddington && place('paddington_jetty') && place('paddington_post'),
      'no jetty and Post Office places for Paddington',
    );
    need(c.letters.lucy_1, 'no letter from Aunt Lucy');
    need(quest('sq_pad_marmalade'), 'no marmalade quest');
  },
  mum_hug: () => need(c.chars.mum?.service === 'hug', 'Mum does not give a hug'),
  dad_mapmaker: () =>
    need(
      place('dad_lookout') && objsIn('lookout', 'S').length && quest('sq_dad_map') && c.items.dads_map,
      'no Dad lookout, map item or map quest',
    ),
  grandad_workshop: () =>
    need(
      objsIn('workshop', 'W').length && c.chars.grandad && c.items.bridge_plan,
      'no workshop, Grandad or bridge plan',
    ),
  granny_garden: () => {
    need(c.stalls.seeds?.keeper === 'granny' && objsIn('greenhouse', 'W').length, 'no seed stall or garden');
    for (const s of ['wheat_seed', 'carrot_seed', 'pumpkin_seed', 'sunflower_seed', 'cane_seed'])
      need(
        c.stalls.seeds.sells.some((x) => x.item === s),
        `the seed stall does not sell ${s}`,
      );
  },
  nanny_nook: () => need(c.stalls.nook?.keeper === 'nanny' && objsIn('nanny_nook', 'W').length, 'no knitting nook'),
  aunty_post: () =>
    need(
      objsIn('post_office', 'W').length && c.chars.aunty && quest('sq_aunty_letters'),
      'no Post Office, Aunty or parcel round',
    ),
  teacher_school: () =>
    need(
      objsIn('school', 'W').length && objsIn('nature_table', 'W').length && quest('sq_teacher_nature'),
      'no school, Nature Table or collection quest',
    ),
  classmates: () => {
    need(
      c.chars.robin?.service === 'mini:hide' &&
        c.chars.sam?.service === 'mini:race' &&
        c.chars.alex?.service === 'mini:snowball' &&
        c.chars.charlie?.service === 'mini:keepy',
      'classmates do not host hide and seek, the race, the snowball fight and Keepy Uppy',
    );
    need(
      quest('sq_charlie_balloon')?.steps.some((s) => s.t === 'mini' && s.game === 'keepy'),
      'no star balloon quest',
    );
    need(quest('sq_alex_den') && site('den'), 'no den-building quest');
  },
  mob_zombie: () => mobIs('zombie', 3, ['rotten_flesh']),
  mob_creeper: () => {
    mobIs('creeper', 3, ['gunpowder']);
    need(objs('cracked_rock').length >= 3 && c.objects.cracked_rock?.cracked, 'no cracked rocks for a creeper blast');
  },
  mob_skeleton: () => mobIs('skeleton', 3, ['bone', 'arrow']),
  mob_spider: () => {
    mobIs('spider', 2, ['string']);
    need(c.mobs.spider.dayFriendly, 'the spider is not friendly by day');
  },
  mob_enderman: () => {
    mobIs('enderman', 6, ['ender_pearl']);
    need(
      isl().zones.some((z) => z.region === 'L' && z.mobs.includes('enderman')),
      'no enderman on the Plains at night',
    );
  },
  mob_jockey: () => {
    need(c.mobs.spider_jockey?.ai === 'jockey', 'no Spider Jockey');
    need(
      quest('ch6')?.steps.some((s) => s.t === 'defeat' && s.mob === 'spider_jockey'),
      'ch6 does not end with the jockey',
    );
  },
  mob_king: () =>
    need(
      c.mobs.creeper_king?.hp === 9 && c.mobs.creeper_king.ai === 'king' && c.mobs.mini_creeper,
      'the Creeper King is not a 9-hit boss with mini creepers',
    ),
  farm_animals: () => {
    const want: Record<string, [string, string]> = {
      chicken: ['wheat_seed', 'egg'],
      pig: ['carrot', ''],
      cow: ['wheat', 'milk'],
      sheep: ['wheat', 'wool'],
    };
    for (const [a, [food, gives]] of Object.entries(want)) {
      need(c.animals[a]?.food === food, `${a} does not follow ${food}`);
      if (gives) need(c.animals[a].gives?.item === gives, `${a} does not give ${gives}`);
    }
    need(c.animals.cow.gives?.needs === 'bucket', 'milk does not need a bucket');
  },
  villagers_golem: () => {
    need(c.stalls.village?.keeper === 'villager_trader' && c.stalls.village.buys, 'no villager trade');
    need(c.chars.golem && c.items.poppy, 'no iron golem or poppy');
  },
  pets: () => {
    need(
      c.animals.wolf?.food === 'bone' && c.animals.cat?.food === 'sardine',
      'wolf and cat are not tamed with bones and fish',
    );
    need(quest('sq_dad_wolf') && quest('sq_nanny_cat'), 'no wolf or cat quest');
  },
  snow_golem_item: () => need(c.recipes.snow_golem && c.items.snow_golem, 'no snow golem'),
  sword_tiers: () => {
    const t = (id: string) => c.items[id]?.tool?.tier;
    need(
      t('wood_sword') === 1 && t('stone_sword') === 2 && t('iron_sword') === 3 && t('diamond_sword') === 4,
      'sword tiers are not 1 to 4',
    );
  },
  hearts_growth: () => {
    const fromCollections = Object.values(c.quests)
      .filter((q) => q.kind !== 'main')
      .reduce((n, q) => n + (q.rewards?.hearts ?? 0), 0);
    need(fromCollections >= 2, 'fewer than 2 extra hearts are on offer from side quests and collections');
    need(Object.values(c.quests).filter((q) => q.kind === 'main').length >= 7, 'no seven main chapters');
  },
  carried_home: () => need(c.strings.carried && c.strings.carried_title, 'no carried-home card text'),

  // ---- section 6: world
  region_home: regionCheck('home', 'H', {
    objs: ['cottage', 'mailbox', 'alphabet_blocks', 'cardboard_fort', 'toy_train', 'claw_machine', 'bounty_board'],
    places: ['plot', 'cottage_door'],
    areas: ['cottage'],
  }),
  region_square: regionCheck('square', 'W', {
    objs: [
      'great_tree',
      'workshop',
      'stall',
      'post_office',
      'school',
      'noticeboard',
      'greenhouse',
      'nanny_nook',
      'cafe',
      'dollhouse',
      'apple_tree',
      'night_stall',
      'present_pile',
    ],
    places: ['great_tree', 'grandad'],
  }),
  region_bay: regionCheck('bay', 'S', {
    objs: ['lighthouse', 'lookout', 'banana_tree', 'boat', 'shell_spiral'],
    places: ['jetty', 'mercat', 'banana_grove'],
  }),
  region_treasure: regionCheck('treasure', 'T', { objs: ['dig_spot', 'boat', 'chest'], places: ['treasure_landing'] }),
  region_heeler: regionCheck('heeler', 'U', {
    objs: ['heeler_house', 'veranda', 'poinciana'],
    places: ['backyard', 'creek'],
  }),
  region_bing: regionCheck('bing', 'B', { objs: ['bing_house', 'slide', 'sandbox'], places: ['playground', 'ducks'] }),
  region_peppa: regionCheck('peppa', 'P', {
    objs: ['peppa_house', 'rock', 'coal_rock'],
    places: ['quarry', 'peppa_home'],
  }),
  region_valley: regionCheck('valley', 'V', {
    objs: ['big_puddle', 'game_post'],
    min: { puddle: 5 },
    places: ['big_puddle', 'valley_gate'],
  }),
  region_gum: regionCheck('gum', 'G', {
    objs: ['fallen_gum', 'treehouse', 'fairy_ring'],
    min: { gum_tree: 50 },
    places: ['mama_koala', 'fallen_tree'],
  }),
  region_plains: regionCheck('plains', 'L', {
    objs: ['well', 'villager_house_a', 'wheat_wild'],
    places: ['village', 'golem'],
  }),
  region_forest: regionCheck('forest', 'F', { objs: ['mine_mouth'], min: { dark_oak: 50 } }),
  region_crater: regionCheck('crater', 'C', { objs: ['boulder_wall', 'hall_gate', 'socket_stone'] }),
  region_mine: () => {
    regionCheck('mine', null, { areas: ['mine1', 'mine2', 'mine3'] })();
    need(
      c.areas.mine1.objects.some((o) => o.type === 'iron_rock') &&
        c.areas.mine3.objects.some((o) => o.type === 'gold_rock') &&
        c.areas.mine3.objects.some((o) => o.type === 'diamond_rock'),
      'ores are not on the right Mine levels',
    );
    need(c.areas.mine3.places.shard_cave, 'no shard cave on the last level');
  },
  region_hall: regionCheck('hall', null, { areas: ['hall'] }),
  island_size: () => need(isl().w === 160 && isl().h === 120, `the island is ${isl().w} x ${isl().h}, not 160 x 120`),
  plot_size: () => {
    need(BAG?.PLOT_W === 26 && BAG.PLOT_H === 16, 'the plot is not 26 x 16');
    need(objs('plot_fence').length >= 60, 'the plot has no fence');
  },
  lit_regions: () => {
    const want: Record<string, number> = {
      heeler: 1,
      bing: 2,
      peppa: 3,
      valley: 3,
      gum: 4,
      plains: 5,
      forest: 6,
      crater: 7,
    };
    for (const [r, n] of Object.entries(want)) need(c.regions[r]?.shard === n, `${r} is not lit by shard ${n}`);
    for (const r of ['home', 'square', 'bay']) need(c.regions[r]?.safe, `${r} is not always safe`);
  },
  always_zones: () => {
    const always = isl()
      .zones.filter((z) => z.mode === 'always')
      .map((z) => z.region);
    need(always.includes('F') && always.includes('C'), 'no always-dark zone in the Forest or the Crater');
    need(
      ['mine1', 'mine2', 'mine3'].every((a) => c.areas[a].zones.some((z) => z.mode === 'always')),
      'the Mine levels have no always zones',
    );
  },
  blocky_regions: () =>
    need(c.regions.plains?.blocky && c.regions.forest?.blocky, 'the Plains and the Forest are not blocky'),
  signposts: () => {
    const signs = new Set(objs('signpost').map((s) => s.d));
    for (const r of Object.values(c.regions)) if (r.sign) need(signs.has(r.sign), `no signpost for ${r.id}`);
    need(signs.size >= 10, 'fewer than 10 signposts');
  },
  gate_stones: () => {
    need(!isl().barriers.some((b) => /heeler|bay/.test(b.id)), 'a barrier blocks the stepping stones');
    need(
      objs('signpost').some((s) => s.d === 'heeler') && objs('signpost').some((s) => s.d === 'bay'),
      'no signposts past the stepping stones',
    );
  },
  gate_west_bush: () =>
    need(
      objs('thorn_bush').length >= 2 && c.objects.thorn_bush?.node?.tool === 'sword',
      'the west bridge bushes are not cut with the sword',
    ),
  gate_north_bridge: () => {
    const s = site('north_bridge');
    need(
      s && sameNeeds(s.needs, { plank: 12, stick: 4 }),
      'the north bridge site does not need 12 planks and 4 sticks',
    );
    need(
      isl().barriers.some((b) => b.id === 'north_bridge' && b.flag === s.flag),
      'no barrier tied to the north bridge site',
    );
    need(c.items.bridge_plan, 'no bridge plan item');
  },
  gate_valley: () =>
    need(
      c.items.wellies?.tool?.type === 'wellies' &&
        place('valley_gate') &&
        quest('ch3')?.steps.some((s) => s.t === 'fetch' || s.t === 'deliver'),
      'no wellies or valley gate',
    ),
  gate_fallen_gum: () =>
    need(
      objsIn('fallen_gum', 'G').length &&
        (c.objects.fallen_gum?.node?.tier ?? 0) >= 2 &&
        c.objects.fallen_gum.node?.tool === 'axe',
      'the fallen gum tree does not need a stone axe',
    ),
  gate_east_bridge: () => {
    const s = site('east_bridge');
    need(
      s && sameNeeds(s.needs, { cobblestone: 12, plank: 6 }),
      'the east bridge site does not need 12 cobblestone and 6 planks',
    );
    need(
      isl().barriers.some((b) => b.id === 'east_bridge' && b.flag === s.flag),
      'no barrier tied to the east bridge site',
    );
  },
  gate_mine: () => {
    need(sameNeeds(site('mine_torches')?.needs, { torch: 8 }), 'the Mine site does not need 8 torches');
    need(
      isl().doors.some((d) => d.to === 'mine1' && JSON.stringify(d.if).includes('site_mine_torches')),
      'the Mine door does not wait for the torches',
    );
  },
  gate_boulder: () => {
    // two walls since package 44a: the way into the crater and the stretch beyond it
    need(
      objs('boulder_wall').length >= 1 &&
        objs('boulder_wall').every((o) => at(o.x, o.y) === 'C') &&
        c.objects.boulder_wall?.node?.tool === 'pick' &&
        c.objects.boulder_wall.node.tier === 3,
      'the boulder wall does not need an iron pickaxe',
    );
    need(c.recipes.tnt && c.items.tnt, 'no TNT to blow the wall');
  },
  gate_hall: () => {
    need(objs('hall_gate').length && objs('socket_stone').length, 'no hall gate or sockets');
    need(
      isl().doors.some((d) => d.to === 'hall' && JSON.stringify(d.if).includes('hall_open')),
      'the hall door does not wait for the sockets',
    );
  },
  gate_ladders: () => {
    const s = site('tree_ladders');
    need(s && s.needs.ladder > 0 && objs('ladder_up').length, 'no tree ladders site');
  },
  minecart_ride: () => need(anyArea('minecart').length >= 2, 'fewer than 2 minecart stops'),

  // ---- secrets
  secrets_15: () => {
    const n =
      objs('chest').length +
      objs('dig_spot').length +
      objs('bottle').length +
      objs('cracked_rock').length +
      objs('long_dog').length +
      objs('fairy_ring').length;
    need(n >= 15, `only ${n} secrets`);
  },
  cracked_rocks: () =>
    need(objs('cracked_rock').length >= 3 && c.objects.cracked_rock?.cracked, 'fewer than 3 cracked rocks'),
  waterfall_cave: () => {
    need(objs('waterfall').length && c.areas.cave, 'no waterfall or cave');
    need(
      isl().doors.some((d) => d.to === 'cave'),
      'no door into the cave',
    );
    need(
      c.areas.cave.objects.some((o) => o.type === 'chest'),
      'no chest in the cave',
    );
  },
  x_marks: () =>
    need(objs('dig_spot').length >= 5 && c.items.wood_spade?.tool?.type === 'spade', 'fewer than 5 dig spots'),
  treasure_island: () => {
    need(objs('boat').length >= 2 && c.recipes.boat, 'no boat to the island');
    need(objsIn('chest', 'T').length && objsIn('dig_spot', 'T').length, 'no treasure on the island');
  },
  long_dogs: () => {
    const dogs = anyArea('long_dog');
    need(dogs.length === 10, `${dogs.length} long dogs placed, need 10`);
    // every find gives its own sticker: no sticker is hidden twice
    const seen = new Map<string, string>();
    for (const a of Object.values(c.areas))
      for (const o of a.objects)
        for (const part of (o.d ?? '').split(',')) {
          const id = part.split(':')[0]!.trim();
          if (!id.startsWith('sticker.')) continue;
          need(!seen.has(id), `${id.slice(8)} is hidden twice (${seen.get(id)} and ${o.id})`);
          seen.set(id, o.id);
        }
    for (let i = 1; i <= 10; i++) need(seen.has(`sticker.longdog_${i}`), `no long dog gives longdog_${i}`);
    setOf('set_longdogs', 'treasures', 10);
  },
  fairy_ring: () => {
    const o = objs('fairy_ring')[0];
    need(o && JSON.stringify(o.if ?? {}).includes('night'), 'no fairy ring that shows only at night');
    need(
      objs('pickup').some((p) => p.id === 'fairy_gift'),
      'no fairy gift',
    );
  },
  school_roof_chest: () => {
    const sc = objs('school')[0];
    need(sc, 'no school');
    const t = c.objects.school!;
    const roof = objs('chest').find(
      (ch) => ch.x >= sc.x && ch.x < sc.x + (t.w ?? 1) && ch.y >= sc.y && ch.y < sc.y + (t.h ?? 1),
    );
    need(roof, 'no chest on the school roof');
    const ladder = objs('ladder_up').find((l) => Math.abs(l.x - roof.x) + Math.abs(l.y - roof.y) === 1);
    need(ladder, 'no ladder beside the roof chest');
    const flag = JSON.stringify(roof.if ?? {});
    const st = isl().sites.find((x) => flag.includes(x.flag) && JSON.stringify(ladder.if ?? {}).includes(x.flag));
    need(st?.needs.ladder, 'the roof chest is not opened by building a ladder');
  },
  bottles_ten: () => {
    need(objs('bottle').length >= 10, `${objs('bottle').length} bottles placed, need 10`);
    for (let i = 1; i <= 10; i++) need(personal?.bottles?.[`bottle${i}`], `no note for bottle ${i}`);
  },
  treasure_page: () => {
    const tr = Object.values(c.stickers).filter((s) => s.page === 'treasures' && s.id.startsWith('tr_'));
    need(tr.length === 8, `${tr.length} treasures in the Treasures tab, need 8`);
    for (const s of tr) {
      const g = givers(`sticker.${s.id}`);
      need(g.length === 1, `${s.id} is given by ${g.length} finds, expected 1`);
      need(['chest', 'dig_spot', 'pickup'].includes(g[0]!.type), `${s.id} is not in a chest, dig spot or pick-up`);
    }
  },
  finds_unique: () => {
    // a find is marked taken by its id (s.taken), so two finds with one id share one fate
    const where = new Map<string, string[]>();
    for (const [area, a] of Object.entries(c.areas))
      for (const o of a.objects)
        if (o.d && ['chest', 'dig_spot', 'pickup'].includes(o.type))
          where.set(o.id, [...(where.get(o.id) ?? []), area]);
    const twice = [...where].filter(([, v]) => v.length > 1).map(([k, v]) => `${k} (${v.join(', ')})`);
    need(!twice.length, `finds share an id: ${twice.join(', ')}`);
  },

  // ---- section 7: systems
  clock_constants: () => {
    need(CLOCK, 'cond.ts did not load');
    need(
      CLOCK.DAY_LEN === 840 && CLOCK.DUSK_AT === 540 && CLOCK.NIGHT_AT === 630 && CLOCK.DAWN_AT === 780,
      'the day is not 9 + 1.5 + 2.5 + 1 minutes',
    );
  },
  bag_sizes: () => {
    need(BAG, 'bag.ts did not load');
    need(BAG.BAG_SLOTS === 44 && BAG.HOTBAR === 8, 'the bag is not 36 slots plus an 8 slot hotbar');
    need(BAG.CHEST_SLOTS === 48, 'chests do not hold 48 slots');
  },
  recipes_table: () => {
    const bad: string[] = [];
    for (const [id, [n, inputs]] of Object.entries(designRecipes)) {
      const r = c.recipes[id];
      if (!r) bad.push(`${id}: missing`);
      else if (r.n !== n || !sameNeeds(r.in, inputs)) bad.push(`${id}: differs`);
    }
    need(bad.length === 0, bad.join('; '));
  },
  recipes_unlock: () => {
    const all = Object.values(c.recipes);
    need(all.some((r) => r.start) && all.some((r) => !r.start), 'every recipe is known from the start, or none is');
    need(all.filter((r) => r.at === 'furnace').length >= 3, 'fewer than 3 furnace recipes');
  },
  fruit_trees: () => {
    need(
      objsIn('apple_tree', 'W').length >= 2 &&
        objs('orange_tree').length >= 1 &&
        objsIn('banana_tree', 'S').length >= 3,
      'no apple, orange or banana trees',
    );
    for (const t of ['apple_tree', 'orange_tree', 'banana_tree'])
      need(c.objects[t]?.node?.regrow, `${t} does not grow back`);
  },
  blocks_furniture: () => {
    const kinds = Object.values(c.items);
    need(kinds.filter((i) => i.kind === 'block').length >= 25, 'fewer than 25 building blocks');
    need(kinds.filter((i) => i.kind === 'furniture').length >= 40, 'fewer than 40 furniture and decorations');
  },
  tools_set: () => {
    const have = new Set(
      Object.values(c.items)
        .filter((i) => i.tool)
        .map((i) => i.tool?.type),
    );
    for (const t of ['sword', 'axe', 'pick', 'spade', 'rod', 'bucket', 'wellies', 'boat'])
      need(have.has(t as never), `no ${t} tool`);
    need(c.items.torch, 'no torch');
  },
  shop_prices: () => {
    for (const s of Object.values(c.stalls))
      for (const x of s.sells) need(x.price >= 1 && x.price <= 50, `${s.id} sells ${x.item} for ${x.price}`);
    need(c.stalls.shop?.buys && c.stalls.seeds?.buys, 'the stalls do not buy fish, crops and crafts');
  },
  sticker_book: () => {
    // PHASE2 part C: the journal has a Friends page (the met record) and three sticker tabs, at most 60 stickers
    need(JOURNAL?.JOURNAL_TABS.join(',') === 'creatures,treasures,places', 'the journal tabs are not the three');
    const n = JOURNAL.journalStickers(c.stickers).length;
    need(n >= 40 && n <= 60, `${n} stickers in the journal, the limit is 60`);
    need(!Object.values(c.stickers).some((s) => s.id.startsWith('friend_')), 'a friend is still a sticker');
    need(JOURNAL.TAB_PRIZE && Object.keys(JOURNAL.TAB_PRIZE).length === 3, 'not every tab has a prize');
  },
  save_slots: () => {
    need(/three slots/i.test(src('src/game/save.ts')), 'save.ts does not describe three slots');
    need(
      /exportSave/.test(src('src/game/save.ts')) && /importSave/.test(src('src/game/save.ts')),
      'no export or import of a save',
    );
    // since package 26 the saved games live under Options, on the title and in the pause menu
    const panel = src('src/game/ui/slots.ts');
    need(
      /Keep a copy/.test(panel) && /Put a copy back/.test(panel) && /importSave/.test(panel),
      'the saved games panel does not keep and put back a copy',
    );
    need(
      /SlotsPanel/.test(src('src/game/ui/menus/pause.ts')) && /SlotsPanel/.test(src('src/game/scenes/Title.ts')),
      'the saved games panel is not under Options on the title and in the pause menu',
    );
  },
  options_set: () =>
    need(
      DEFAULT_OPTS &&
        'helper' in DEFAULT_OPTS &&
        'music' in DEFAULT_OPTS &&
        'sound' in DEFAULT_OPTS &&
        DEFAULT_OPTS.helper,
      'options lack the helper, music or sound',
    ),

  // ---- building, farming, animals, fishing
  placeables: () => need(Object.values(c.items).filter((i) => i.place).length >= 50, 'fewer than 50 placeable items'),
  house_steps: () => {
    // PHASE2 part F: three steps of the home chapters, each a build site at her door
    const steps: [string, string][] = [];
    for (const id of ['home1', 'home2', 'home3', 'home4'])
      for (const s of quest(id)?.steps ?? [])
        if (s.t === 'site' && /^house_\d$/.test(s.site ?? '')) steps.push([id, s.site!]);
    need(steps.length === 3, `${steps.length} house steps in the home chapters, need 3`);
    for (const [, id] of steps) need(site(id), `no build site ${id}`);
    need(!quest('sq_house_1') && !quest('sq_house_2'), 'the old house side quests are still there');
  },
  build_sites: () => {
    for (const s of ['north_bridge', 'east_bridge', 'treehouse', 'village_fence', 'tree_ladders'])
      need(site(s), `no build site ${s}`);
  },
  swing_site: () =>
    need(
      isl().sites.some((s) => /swing|seesaw/.test(s.id)),
      'no swing (or seesaw) build site',
    ),
  seeds_grow: () => {
    for (const s of ['wheat_seed', 'carrot_seed', 'pumpkin_seed', 'sunflower_seed', 'cane_seed'])
      need(c.items[s]?.grows && c.items[s].grows.days <= 2, `${s} does not grow in 1 to 2 days`);
  },
  pens_produce: () => {
    need(quest('ch2')?.steps.some((s) => s.t === 'lead') && site('pen_bing'), 'no pen to lead an animal to');
    need(quest('sq_farmer_pens'), 'no farm pens quest');
  },
  milk_bucket: () =>
    need(c.stalls.village?.sells.some((s) => s.item === 'bucket') && c.recipes.bucket, 'no bucket sold by a villager'),
  fishing: () => {
    need(Object.keys(c.fish).length === 10, `${Object.keys(c.fish).length} kinds of fish, need 10`);
    const water = new Set(Object.values(c.fish).flatMap((f) => f.water));
    need(
      water.size >= 3 && Object.values(c.fish).some((f) => f.time === 'night'),
      'fish do not differ by place and time',
    );
    need(c.items.fishing_rod && place('jetty'), 'no rod or jetty');
  },

  // ---- quests and mini-games
  side_quest_counts: () => {
    const s = readJson<{ sideQuestsMin: number; familyQuestsMin: number; friendLines: number }>('src/data/scope.json');
    need(s, 'no scope.json');
    const side = Object.values(c.quests).filter((q) => q.kind === 'side');
    need(side.length >= s.sideQuestsMin, `${side.length} side quests, need ${s.sideQuestsMin}`);
    const family = ['mum', 'dad', 'grandad', 'granny', 'nanny', 'aunty', 'teacher', 'robin', 'sam', 'alex', 'charlie'];
    need(side.filter((q) => family.includes(q.giver)).length >= s.familyQuestsMin, 'too few family and friend quests');
  },
  friend_lines: () =>
    need(
      Object.values(c.quests).filter((q) => q.kind === 'friend').length === 8,
      'there are not 8 friend-hero quest lines',
    ),
  quests_visible: () => {
    const none = Object.values(c.quests)
      .filter((q) => !q.visible?.trim())
      .map((q) => q.id);
    need(none.length === 0, `quests with no visible result: ${none.slice(0, 6).join(' ')}`);
  },
  step_types: () => {
    const ok = new Set([
      'talk',
      'fetch',
      'deliver',
      'craft',
      'place',
      'site',
      'defeat',
      'reach',
      'fish',
      'grow',
      'lead',
      'mini',
      'sleep',
      'night',
      // phase 2 (package 44a): make a worn sword or bow +1 or +2
      'upgrade',
    ]);
    for (const q of Object.values(c.quests))
      for (const s of q.steps) need(ok.has(s.t), `${q.id} uses step type ${s.t}`);
  },
  mini_keepy: () => need(c.chars.bandit?.service === 'mini:keepy', 'Bandit does not host Keepy Uppy'),
  mini_puddles: () =>
    need(
      objs('game_post').some((o) => o.d === 'puddles'),
      'no puddle course post',
    ),
  mini_hide: () => need(c.chars.robin?.service === 'mini:hide', '{robin} does not host hide and seek'),
  mini_race: () => need(c.chars.sam?.service === 'mini:race', '{sam} does not host the race'),
  mini_claw: () => {
    need(objsIn('claw_machine', 'H').length && c.stalls.prizes, 'no claw machine or prizes');
    need(
      Object.values(c.quests).some((q) => q.kind === 'bounty' && q.rewards?.claw),
      'posters do not earn extra claw goes',
    );
  },
  night_defence: () => nightDefence(),
  mini_minecart: () =>
    need(
      anyArea('minecart').length >= 2 && quest('ch6')?.steps.some((s) => s.t === 'mini' && s.game === 'minecart'),
      'no minecart ride',
    ),

  // ---- letters at story milestones: main quests post letters, and the solver saw the post come on that many mornings
  letters_milestones: () => {
    const mails = (fx: { mail?: string[] } | undefined) => fx?.mail?.length ?? 0;
    const posting = Object.values(c.quests).filter(
      (q) => q.kind === 'main' && (mails(q.rewards) || q.steps.some((st) => mails(st.fx))),
    );
    need(posting.length >= 4, `only ${posting.length} story chapters post a letter`);
    need(solver, 'test-results/solver.json is missing');
    const want = new Set(
      posting.flatMap((q) => [...(q.rewards?.mail ?? []), ...q.steps.flatMap((st) => st.fx?.mail ?? [])]),
    );
    for (const r of solver.filter((x) => x.run === 1)) {
      need(r.post, 'test-results/solver.json does not list the post (run the solver again)');
      const lost = [...want].filter((id) => !r.post?.includes(id));
      need(!lost.length, `${r.hero}: the story's letters ${lost.join(' ')} never reached the mailbox`);
    }
  },
  // ---- controls in build mode: the view's keys (the rules' side is a test)
  build_keys: () => {
    const ui = src('src/game/scenes/UI.ts');
    const blk = /if \(mode === 'build'\) \{([\s\S]*?)return;/.exec(ui)?.[1] ?? '';
    need(/KeyB'\)\) k\.send\(\{ c: 'build', on: false \}\)/.test(blk), 'B does not leave build mode');
    need(/takeDigit\(\)/.test(blk) && /c: 'bsel'/.test(blk), '1 to 8 do not pick in build mode');
    need(
      /KeyQ'\)\) k\.send\(\{ c: 'bsel', d: -1 \}\)/.test(blk) && /KeyE'\)\) k\.send\(\{ c: 'bsel', d: 1 \}\)/.test(blk),
      'Q and E do not cycle',
    );
    const inp = src('src/game/input.ts');
    need(/KeyX'[^\n]*edgeBack = true/.test(inp) && /KeyR'\) this\.edgeUse = true/.test(inp), 'X or R is not wired');
  },
  // ---- the rare surprises and the post round
  surprises: () => {
    const sp = src('src/core/surprises.ts');
    for (const id of ['surprise_stampede', 'surprise_prank', 'surprise_jockey']) {
      need(c.cutscenes[id], `no scene ${id}`);
      need(c.stickers[id], `no sticker ${id}`);
    }
    need(/rand\(g\)/.test(sp) && !/Math\.random/.test(sp), "surprises do not use the save's own random numbers");
    const clock = src('src/core/clock.ts');
    need(/planSurprise\(g\)/.test(clock) && /stepSurprise\(g\)/.test(clock), 'surprises are not planned each morning');
    need(/new JockeyRider\(/.test(src('src/game/scenes/World.ts')), 'no rider is drawn on the chicken');
  },
  post_round: () => {
    need(
      c.cutscenes.post_round?.acts.some((a) => a.who === 'paddington'),
      'no post round scene with Paddington',
    );
    need(/stepPostRound\(g\)/.test(src('src/core/clock.ts')), 'the post round never plays');
  },
  // ---- something new every couple of minutes (design section 4): the solver's reward clock, run 1
  cadence: () => {
    need(solver, 'test-results/solver.json is missing');
    const ones = solver.filter((r) => r.run === 1);
    need(ones.length, 'no run 1 in test-results/solver.json');
    for (const r of ones) {
      // the solver's own figures along the main story (detours on optional quests are off the clock)
      const cd = (r as { cadence?: { median: number; worst: number; walk: number } }).cadence;
      need(cd, `${r.hero}: no cadence in test-results/solver.json`);
      if (!cd) continue;
      need(cd.median <= 150, `${r.hero}: half the gaps are over ${cd.median} s`);
      need(cd.worst <= 240, `${r.hero}: a ${cd.worst} s gap with nothing new (at most 240)`);
    }
  },

  // ---- look and sound
  alive_idle: () =>
    noneMissing(motionMissing(['hero', 'walker', 'fixed', 'speakingMob', 'boss', 'hostile', 'animal'], ['idle_down'])),
  alive_walk: () => noneMissing(motionMissing(['hero', 'walker', 'hostile', 'animal', 'boss'], ['walk_down'])),
  alive_talk: () => noneMissing(motionMissing(['hero', 'walker', 'fixed', 'speakingMob'], ['talk_down'])),
  hero_clips: () =>
    noneMissing(
      motionMissing(
        ['hero'],
        ['swing_down', 'fish_side', 'cheer_down', 'hurt_down', 'sleep_down'],
        (id) => c.heroes[id]?.starter,
      ),
    ),
  mob_clips: () =>
    noneMissing(
      motionMissing(['hostile'], ['attack_down', 'hurt_down'], (id) =>
        ['zombie', 'creeper', 'skeleton', 'spider'].includes(id),
      ),
    ),
  facings: () =>
    noneMissing(
      motionMissing(
        ['hero', 'walker'],
        ['idle_up', 'walk_up', 'walk_side'],
        (id) => !!c.heroes[id] || ['bandit', 'chilli', 'mum', 'dad', 'grandad'].includes(id),
      ),
    ),
  world_moves: () =>
    need(Object.values(c.objects).filter((o) => o.frames).length >= 10, 'fewer than 10 animated world objects'),
  lights: () =>
    need(Object.values(c.objects).filter((o) => (o.light ?? 0) > 0).length >= 8, 'fewer than 8 light sources'),
  music_set: () => {
    need(TUNES, 'src/game/music.ts could not be loaded');
    for (const r of Object.values(c.regions)) need(r.music && TUNES![r.music], `${r.id} has no tune`);
    need(
      new Set(Object.values(c.regions).map((r) => r.music)).size === Object.keys(c.regions).length,
      'two regions share a tune',
    );
    for (const w of ['festive', 'night', 'finale']) need(TUNES![w], `no ${w} tune`);
    need(
      quest('ch7')?.steps.some((s) => s.fx?.music),
      'the Creeper King fight starts no boss music',
    );
  },
  // package 70: the secret show after the credits (src/data/quests/secret.ts)
  secret_show: () => {
    const q = quest('secret');
    need(q, 'no secret quest');
    need(q.card?.who && q.card.if?.done === 'finale', 'the secret does not open with a morning card after the finale');
    need(
      q.auto && JSON.stringify(q.requires).includes('card:secret'),
      'the secret does not start by itself on its card',
    );
    need(
      !c.questOrder.some((id) => id !== 'secret' && JSON.stringify(c.quests[id]!.requires ?? {}).includes('secret')),
      'another quest waits on the secret',
    );
  },
  secret_jobs: () => {
    const q = quest('secret')!;
    const who = ['rumi', 'mira', 'zoey'];
    for (const id of who) need(c.chars[id]?.role === 'walker', `${id} is not on the island`);
    const corners = who.map((id) => c.chars[id]!.spots.find((sp) => !sp.at.startsWith('secret_stage'))?.at ?? '');
    const code = (id: string) => {
      const p = place(id);
      return p ? (c.areas[p.area]?.region[p.y]?.charAt(p.x) ?? '') : '';
    };
    need(new Set(corners.map(code).filter(Boolean)).size === 3, 'the three singers are not in 3 corners');
    const kinds = q.steps.map((st) => st.t);
    for (const k of ['fetch', 'craft', 'mini', 'night', 'defeat']) need(kinds.includes(k as never), `no ${k} step`);
    need(
      q.steps.find((st) => st.t === 'mini')?.t === 'mini' && c.chars.zoey!.service === 'mini:keepy',
      'Zoey hosts no game',
    );
    need(q.steps.some((st) => st.fx?.music === 'concert') && !!TUNES?.concert, 'no show tune');
    need(
      q.steps.every((st) => st.far),
      'a step has no going line',
    );
  },
  secret_limits: () => {
    const fresh = Object.values(c.chars).filter((ch) => ch.group === 'huntrix');
    need(fresh.length <= 3, `${fresh.length} new named characters`);
    const say = (l: Line) => (typeof l === 'string' ? l : l.l).replace(/^[a-z_]+: /, '');
    const q = quest('secret')!;
    const text = [
      q.name,
      q.visible,
      ...q.steps.flatMap((st) => [st.goal ?? '', st.far ?? '', ...(st.say ?? []).map(say)]),
    ];
    for (const id of ['secret_dusk', 'secret_show'])
      for (const a of c.cutscenes[id]?.acts ?? []) if (a.l) text.push(say(a.l));
    for (const ch of fresh) text.push(ch.name, ...ch.chat.flatMap((p) => p.lines));
    const n = text.reduce((t, x) => t + (x.match(/[A-Za-z][A-Za-z'’-]*|\d+/g) ?? []).length, 0);
    need(n <= 250, `${n} new words (250 at most)`);
  },
  sfx_set: () => {
    const s = src('src/game/sfx.ts');
    for (const w of ['hiss', 'boom', 'groan', 'cluck']) need(new RegExp(`\\b${w}\\b`).test(s), `no ${w} sound`);
    need(/hrmm|hum|hmm/i.test(s), 'no villager sound');
  },
  gloss_words: () => {
    for (const i of ['furnace', 'cobblestone', 'marmalade'])
      need(c.items[i]?.gloss, `${i} does not show its picture on first use`);
    const g = readJson<{ words: Record<string, { pic: string; show?: boolean }> }>('src/data/glossary.json');
    for (const w of ['furnace', 'cobblestone', 'marmalade', 'lighthouse']) {
      const pic = g?.words[w]?.pic;
      need(pic && g.words[w]!.show, `the glossary does not show a picture for ${w}`);
      need(
        existsSync(join(ROOT, `art/src/items/${pic}.png`)) || existsSync(join(ROOT, `art/src/objects/${pic}.png`)),
        `no art for the ${w} picture (${pic})`,
      );
    }
    need(/firstGloss\(/.test(src('src/game/world/gloss.ts')), 'the world never shows glossary pictures');
    need(/new GlossPicture\(/.test(src('src/game/scenes/World.ts')), 'the glossary pictures are not hooked in');
  },

  // ---- phase 2 (docs/PHASE2.md): rows added when the checklist was rewritten (package 51)
  koala_named_koala: () => {
    need(personal?.names?.koala === 'Koala', '{koala} is not "Koala" in personal.json');
    need(!/koalaName/.test(src('src/game/scenes')), 'a scene still asks for the koala name');
  },
  text_entry: () => {
    const uses = (src('src/game').match(/askText\(ui\.game/g) ?? []).length;
    need(uses === 1, `${uses} places ask her to type, only the sign may`);
    need(
      /askText\(ui\.game, 'What should the sign say\?', '', '[^']*', 40\)/.test(src('src/game/ui/menus/misc.ts')),
      'the sign does not keep 40 letters',
    );
  },
  calm_start: () => {
    calmRows(/^key presses: /, 2);
    calmRows(/^prologue: /, 2);
  },
  prologue_quiet: () => {
    const pro = quest('prologue');
    need(pro, 'no prologue');
    need(!JSON.stringify(pro).includes('sticker_book'), 'the prologue still hands over the Sticker Book');
    need(
      quest('ch1')?.requires?.done === 'prologue' && quest('ch2')?.requires?.done === 'prologue',
      'the two first chapters are not both open when the prologue ends',
    );
    for (const id of ['sq_aunty_letters', 'sq_teacher_nature']) {
      const q = quest(id);
      need(q?.kind === 'side', `${id} is not a side quest`);
      need((q.requires?.shards ?? 0) >= 1, `${id} is offered before the first shard`);
    }
  },
  calm_home: () => calmRows(/^home and Square: /, 10),
  calm_screens: () => {
    calmRows(/^fullest screen: (?!after)/, 10);
    // the party after the finale keeps the finale's limit of 6
    calmCache ??= calmFn!(c).rows;
    const party = calmCache.find((r) => r.what === 'fullest screen: after the party');
    need(party && Number(party.value) <= 6, `the party after the finale shows ${party?.value} named characters`);
  },
  calm_words: () => {
    calmRows(/^words: /, 10);
    calmRows(/^talks over 3 boxes: |^goals over 6 words: /, 6);
  },
  message_queue: () => {
    const ui = src('src/game/scenes/UI.ts');
    need(/const GAP = 1\.5;/.test(ui), 'the clear screen between two messages is not 1.5 s');
    need(/one queue/.test(ui) && /private enqueue\(/.test(ui), 'messages do not share one queue');
  },
  bow_set: () => {
    need(c.items.bow?.tool?.type === 'bow' && c.items.arrow, 'no bow or arrow');
    need(
      c.recipes.bow?.n === 1 && sameNeeds(c.recipes.bow.in, { stick: 3, string: 3 }),
      'the bow is not 3 sticks and 3 string',
    );
    need(
      c.recipes.arrow?.n === 4 && sameNeeds(c.recipes.arrow.in, { stick: 1, feather: 1 }),
      'a stick and a feather do not make 4 arrows',
    );
    need(
      c.mobs.skeleton?.drops.some((d) => d.item === 'arrow'),
      'skeletons do not drop arrows',
    );
    need(
      quest('ch4')?.steps.some((s) => s.t === 'craft' && s.item === 'bow'),
      'she does not make her first bow in chapter 4',
    );
  },
  armour_set: () => {
    const want: [string, string, number, number][] = [
      ['leather_helmet', 'helmet', 1, 1],
      ['iron_helmet', 'helmet', 2, 1],
      ['diamond_helmet', 'helmet', 3, 2],
      ['leather_armour', 'armour', 1, 1],
      ['iron_armour', 'armour', 2, 2],
      ['diamond_armour', 'armour', 3, 2],
    ];
    for (const [id, type, tier, shield] of want) {
      const it = c.items[id];
      need(it?.tool?.type === type && it.tool.tier === tier, `${id} is not a tier ${tier} ${type}`);
      need(it.shield === shield, `${id} gives ${it.shield} blue hearts, the design says ${shield}`);
      need(c.recipes[id], `no recipe for ${id}`);
    }
    need(
      c.recipes.leather && sameNeeds(c.recipes.leather.in, { leather_scrap: c.recipes.leather.in.leather_scrap ?? 0 }),
      'leather is not made from scraps',
    );
  },
  gear_signs: () => {
    const signs = objs('gear_board');
    need(signs.length >= 4, `${signs.length} gear signs, need one at each way into a tough region`);
    for (const o of signs) {
      need(!['H', 'W', 'S', 'U', 'B', 'P'].includes(at(o.x, o.y)), `the gear sign ${o.id} stands in a gentle region`);
      for (const id of (o.d ?? '').split(','))
        need(c.items[id.trim()], `the gear sign ${o.id} shows ${id}, no such item`);
    }
  },
  recipe_tabs: () => {
    const t = src('src/game/ui/menus/craft.ts');
    for (const tab of ['Tools', 'Gear', 'Home', 'Food'])
      need(t.includes(`'${tab}'`), `no ${tab} tab in the recipe list`);
    need(/recipeList/.test(t), 'the list is not the recipes she knows');
  },
  home_stations: () => {
    for (const [id, use] of [
      ['furnace', ''],
      ['anvil', 'anvil'],
      ['cooking_pot', 'pot'],
      ['armour_stand', 'stand'],
    ] as const) {
      need(c.items[id]?.place, `${id} cannot be placed`);
      if (use) need(c.items[id]!.place!.use === use, `${id} does nothing in the house`);
      need(c.recipes[id], `no recipe for ${id}`);
    }
  },
  trophy_wall: () => {
    const things = src('src/game/world/things.ts');
    const flags = [...(/const TROPHIES[\s\S]*?\n\];/.exec(things)?.[0] ?? '').matchAll(/flag: '([a-z_]+)'/g)].map(
      (m) => m[1]!,
    );
    need(flags.length >= 3, `${flags.length} trophies on the wall, need the two bosses and the crown`);
    need(flags.includes('trophy_crown'), 'the crown from Treasure Island has no place on the wall');
    const data = src('src/core') + src('src/data') + readFileSync(join(ROOT, 'src/data/map/island.json'), 'utf8');
    for (const f of flags) need(data.includes(`'${f}'`) || data.includes(`flag.${f}`), `nothing sets ${f}`);
  },
  insides_all: () => {
    // package 72 (D78): every house-kind building on the island and the windmill has a door in front of it to a room
    // of its own; the door waits for the same flag as the building; no two buildings share a room
    const kinds = new Set([...src('src/data/objects.ts').matchAll(/^house\('([a-z_]+)'/gm)].map((m) => m[1]!));
    kinds.add('windmill');
    const isle = c.areas.island!;
    const rooms = new Map<string, string>();
    let n = 0;
    for (const o of isle.objects) {
      if (!kinds.has(o.type)) continue;
      n++;
      const t = c.objects[o.type]!;
      const d = isle.doors.find((q) => q.y === o.y + (t.h ?? 1) && q.x >= o.x && q.x < o.x + (t.w ?? 1));
      need(d, `${o.id} at ${o.x},${o.y} has no door`);
      if (!d) continue;
      const room = c.areas[d.to];
      need(room?.indoor && !room.dark, `${o.id}'s door leads to ${d.to}, not a room`);
      need(
        JSON.stringify(d.if ?? null) === JSON.stringify(o.if ?? null),
        `${o.id}'s door does not wait for its building`,
      );
      need(!rooms.has(d.to), `${o.id} and ${rooms.get(d.to)} share the room ${d.to}`);
      rooms.set(d.to, o.id);
    }
    // 19 house pictures stand on the island (4 village houses, both lookouts) and the windmill
    need(n >= 20, `${n} buildings, expected 20`);
  },
  dens_four: () => {
    const dens = Object.values(c.dens);
    need(dens.length === 4, `${dens.length} dens, need 4`);
    for (const d of dens) {
      need(d.waves.length === 2, `${d.id} has ${d.waves.length} waves, need 2`);
      need(d.chest, `${d.id} has no chest`);
      need(place(d.at), `${d.id} has no place on the map`);
    }
  },
  projects_ten: () => {
    const ps = Object.values(c.quests).filter((q) => q.id.startsWith('p_'));
    need(ps.length === 10, `${ps.length} island projects, need 10`);
    for (const q of ps) {
      need(q.board, `${q.id} is not on the board`);
      const st = q.steps.find((s) => s.t === 'site');
      need(st && site(st.site!)?.needs, `${q.id} is not paid at a build site`);
    }
  },
  fish_board: () => {
    need(objsIn('fish_board', 'S').length, 'no fish board at Sandy Bay');
    need(Object.keys(c.fish).length === 10, 'there are not ten fish');
    const asked = new Set(
      ['fb_1', 'fb_2', 'fb_3'].flatMap(
        (id) =>
          quest(id)
            ?.steps.filter((s) => s.t === 'fish')
            .map((s) => s.kind) ?? [],
      ),
    );
    for (const f of Object.keys(c.fish)) need(asked.has(f), `the fish board never asks for ${f}`);
  },
  dad_trail: () => {
    const q = quest('sq_dad_trail');
    need(q?.giver === 'dad', 'no treasure trail from {dad}');
    for (let i = 1; i <= 5; i++) need(place(`trail_x${i}`), `no X number ${i} on the map`);
    need(q.steps.filter((s) => /^trail_x\d$/.test(s.mark ?? '')).length === 5, 'the trail does not have 5 digs');
    need(c.items.key_piece, 'no key_piece item');
    need(JSON.stringify(q).includes('key_piece'), 'the digs do not give a key piece');
  },
  trail_notes_personal: () => {
    need(personalStrings(/trail/i).length >= 5, "Dad's five trail notes are not in personal.json");
    need(!/A note from \{dad\}: "/.test(src('src/data/quests/side1.ts')), 'a trail note is still written in side1.ts');
  },
  cups_eight: () => {
    // the eight games with a post; the school quiz has none and gives a gold star instead (package 78)
    const games = ['keepy', 'puddles', 'hide', 'race', 'claw', 'snowball', 'minecart', 'targets'];
    for (const g of games) need(quest(`cup_prize_${g}`)?.requires?.flag === `cup_${g}`, `no gold cup prize for ${g}`);
    need(objsIn('cup_shelf', 'H').length, 'no cup shelf at home');
    need(/quiz_star/.test(src('src/core/quiz.ts')), 'the school quiz gives no gold star');
  },
  hint_key: () => {
    need(/KeyH/.test(src('src/game/input.ts')), 'H does not ask for a hint');
    need(
      /export function/.test(src('src/core/hints.ts')) && src('src/game/ui/hintview.ts'),
      'no hint rules or hint view',
    );
  },
  focus_panel: () => {
    need(/export const LAYER/.test(src('src/game/ui/kit.ts')), 'no layer order for panels');
    need(/\n {2}focus\(\): /.test(src('src/game/scenes/UI.ts')), 'nothing picks the one focused panel');
  },
  pick_reach: () => {
    const r = Number(/PICK_REACH = ([\d.]+)/.exec(src('src/core/hero.ts'))?.[1] ?? 0);
    need(r >= 1.2, `a find is reached from ${r} tiles, not from beside it`);
  },
  no_ring: () =>
    need(/const WORLD_OUTLINE = 0;/.test(src('tools/art/process.ts')), 'world frames still get a white ring'),
};

/** Chapter 5's night defence: night falls by the well, at least 3 waves of mobs come, and the golem is mended. */
function nightDefence() {
  const q = quest('ch5');
  need(q, 'no chapter 5');
  const dark = q.steps.findIndex((s) => s.t === 'night' || s.fx?.time === 'night');
  need(dark >= 0, 'chapter 5 never turns to night');
  const fights = q.steps.slice(dark).filter((s) => s.t === 'defeat');
  need(fights.length >= 3, `only ${fights.length} waves after dark`);
  const waves = q.steps.slice(dark).filter((s) => s.fx?.spawn?.length).length;
  need(waves >= 3, `only ${waves} waves of mobs are sent`);
  need(
    q.steps.some((s) => s.t === 'deliver' && s.to === 'golem') && c.chars.golem && c.chars.villager_1,
    'no golem mended and no villagers',
  );
  need(place('village_well'), 'no village well');
}

function groupChars(ids: string[], code: string, houses: string[]) {
  for (const id of ids) need(c.chars[id]?.spots.length, `no ${id}`);
  for (const t of houses) need(objsIn(t, code).length, `no ${t} in region ${code}`);
}
function mobIs(id: string, hp: number, drops: string[]) {
  const m = c.mobs[id];
  need(m, `no mob ${id}`);
  need(m.hp === hp, `${id} has ${m.hp} hits, design says ${hp}`);
  for (const d of drops)
    need(
      m.drops.some((x) => x.item === d),
      `${id} does not drop ${d}`,
    );
}

// ---------------------------------------------------------------- proofs

type Kind = 'data' | 'solver' | 'test' | 'screenshot' | 'review' | 'none';
interface Seg {
  kind: Kind;
  arg: string;
}
interface Row {
  id: string;
  promise: string;
  section: string;
  kindCol: string;
  proofCol: string;
  status: string;
  line: number;
  segs: Seg[];
}

function hasEvent(runs: SolverRun[], arg: string): string | null {
  const m = arg.match(/^(.*?)(?:\s+run\s+(\d+))?$/);
  const body = (m?.[1] ?? arg).trim();
  const only = m?.[2] ? Number(m[2]) : null;
  const pool = only === null ? runs : runs.filter((r, i) => (r.run ?? i + 1) === only);
  if (pool.length === 0) return only === null ? 'solver.json holds no runs' : `no solver run ${only}`;
  const words = body.split(/\s+/);
  if (words[0] === 'run' && (words[1] === 'hero' || words[1] === 'story')) {
    // the runs played as this hero: run 1 starts as them, run 2 swaps to them at the mirror
    const mine = runs.filter((r) => (r.swapTo ?? r.hero) === words[2]);
    if (!mine.length) return `no solver run for hero ${words[2]}`;
    for (const run of mine) {
      if (words[1] === 'story') {
        // the whole story: the finale done and nothing stuck (side quests given up do not count here)
        if (run.stuck || !run.rewards?.some((e) => e.kind === 'quest' && e.id === 'finale'))
          return `solver run ${run.run} for ${words[2]} did not finish the story${run.stuck ? ' (stuck)' : ''}`;
        continue;
      }
      const gave = Object.keys(run.gaveUp ?? {});
      if (run.stuck || gave.length)
        return `solver run ${run.run} for ${words[2]} did not finish everything (${run.stuck ? 'stuck' : `gave up ${gave.join(' ')}`})`;
    }
    return null;
  }
  if (words[0] === 'reward') {
    const kind = words[1];
    const missing = words
      .slice(2)
      .filter((id) => !pool.some((r) => r.rewards?.some((e) => e.kind === kind && e.id === id)));
    return missing.length ? `solver never rewarded ${kind} ${missing.join(' ')}` : null;
  }
  if (words[0] === 'mark') {
    const what = words.slice(1).join(' ');
    return pool.some((r) => r.marks?.some((e) => e.what === what)) ? null : `solver never marked "${what}"`;
  }
  return `unknown solver event "${body}"`;
}

let testText: string | null = null;
function hasTest(title: string): string | null {
  if (testText === null) {
    const dir = join(ROOT, 'tests');
    testText = existsSync(dir)
      ? readdirSync(dir)
          .filter((f) => f.endsWith('.test.ts'))
          .map((f) => readFileSync(join(dir, f), 'utf8'))
          .join('\n')
      : '';
  }
  for (const q of ["'", '"', '`'])
    for (const fn of ['it', 'test']) if (testText.includes(`${fn}(${q}${title}${q}`)) return null;
  return `no test titled "${title}" in tests/`;
}

function runSeg(s: Seg): string | null {
  switch (s.kind) {
    case 'data': {
      if (loadError) return `content failed to load: ${loadError}`;
      const fn = CHECKS[s.arg];
      if (!fn) return `no check named "${s.arg}" in checklist.ts`;
      try {
        fn();
        return null;
      } catch (e) {
        return e instanceof Unproven ? e.message : `check crashed: ${e instanceof Error ? e.message : String(e)}`;
      }
    }
    case 'solver':
      return solver ? hasEvent(solver, s.arg) : 'test-results/solver.json is missing (run tools/check/solver.ts)';
    case 'test':
      return hasTest(s.arg);
    case 'screenshot': {
      const p = join(ROOT, s.arg);
      return existsSync(p) && statSync(p).size > 0 ? null : `${s.arg} does not exist`;
    }
    case 'review': {
      // a reviewer's reading, written down: the file must end in a passing verdict
      const p = join(ROOT, s.arg);
      if (!existsSync(p)) return `${s.arg} does not exist`;
      const v = /^Verdict: (pass|fail)\s*$/m.exec(readFileSync(p, 'utf8'));
      return v?.[1] === 'pass' ? null : `${s.arg} has no passing verdict`;
    }
    case 'none':
      return s.arg ? `not proven yet: ${s.arg}` : 'not proven yet';
  }
}

// ---------------------------------------------------------------- parse the table

function parse(md: string): { rows: Row[]; errors: string[] } {
  const rows: Row[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  md.split('\n').forEach((line, i) => {
    if (!line.startsWith('|')) return;
    const cells = line
      .replace(/^\|/, '')
      .replace(/\|\s*$/, '')
      .split('|')
      .map((x) => x.trim());
    if (cells[0] === 'id' || /^-+$/.test(cells[0] ?? '')) return;
    if (cells.length !== 6) {
      errors.push(`line ${i + 1}: expected 6 columns, found ${cells.length}`);
      return;
    }
    const [id, promise, section, kindCol, proofCol, status] = cells;
    if (seen.has(id)) errors.push(`line ${i + 1}: duplicate id ${id}`);
    seen.add(id);
    const segs: Seg[] = [];
    for (const part of proofCol.split(';')) {
      const m = part.trim().match(/^(data|solver|test|screenshot|review|none)(?::\s*(.*))?$/);
      if (!m) {
        errors.push(`line ${i + 1} (${id}): cannot read proof "${part.trim()}"`);
        continue;
      }
      segs.push({ kind: m[1] as Kind, arg: (m[2] ?? '').trim() });
    }
    const kinds = [...new Set(segs.map((s) => s.kind))].join('+');
    if (kinds !== kindCol)
      errors.push(`line ${i + 1} (${id}): kind column says "${kindCol}" but the proof uses "${kinds}"`);
    rows.push({ id, promise, section, kindCol, proofCol, status, line: i + 1, segs });
  });
  return { rows, errors };
}

if (!existsSync(MD)) {
  console.log('docs/DESIGN_CHECKLIST.md does not exist');
  console.log('CHECKLIST FAIL (0 of 0 rows: no checklist)');
  process.exit(1);
}
const md = readFileSync(MD, 'utf8');
const { rows, errors } = parse(md);

interface Result {
  row: Row;
  why: string[];
}
const results: Result[] = rows.map((row) => ({
  row,
  why: row.segs.map(runSeg).filter((x): x is string => x !== null),
}));
const unproven = results.filter((r) => r.why.length > 0);

if (WRITE) {
  const status = new Map(results.map((r) => [r.row.id, r.why.length ? 'unproven' : 'proven']));
  const out = md.split('\n').map((line, i) => {
    const row = rows.find((r) => r.line === i + 1);
    if (!row) return line;
    const cells = line
      .replace(/^\|/, '')
      .replace(/\|\s*$/, '')
      .split('|');
    cells[5] = ` ${status.get(row.id)} `;
    return `|${cells.join('|')}|`;
  });
  writeFileSync(MD, out.join('\n'));
}

for (const e of errors) console.log(`TABLE ERROR ${e}`);
for (const r of results) {
  if (r.why.length) console.log(`UNPROVEN ${r.row.id} | ${r.row.promise} | ${r.why.join(' / ')}`);
  else if (VERBOSE) console.log(`proven   ${r.row.id} | ${r.row.promise} | ${r.row.proofCol}`);
}
const byKind: Record<string, number> = {};
for (const r of results)
  if (!r.why.length) for (const k of new Set(r.row.segs.map((s) => s.kind))) byKind[k] = (byKind[k] ?? 0) + 1;
console.log(
  `proven by kind: ${
    Object.entries(byKind)
      .map(([k, n]) => `${k} ${n}`)
      .join(', ') || 'none'
  }`,
);
if (unproven.length || errors.length) {
  console.log(
    `CHECKLIST FAIL (${unproven.length + (rows.length === 0 ? 0 : 0)} of ${rows.length} unproven${errors.length ? `, ${errors.length} table errors` : ''})`,
  );
  process.exit(1);
}
console.log(`CHECKLIST OK (${rows.length} rows)`);
