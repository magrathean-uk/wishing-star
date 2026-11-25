// Reading check: every string a player can see obeys the reading rules (docs/GAME_DESIGN.md section 8).
// Run: node tools/check/reading.ts. Also exported as checkReading() for other scripts.
import { readdirSync, readFileSync } from 'node:fs';
import type { Content, Line } from '../../src/core/types.ts';
import glossaryJson from '../../src/data/glossary.json' with { type: 'json' };

interface Glossary {
  words: Record<string, { pic?: string }>;
  names: string[];
  verbs: string[];
  nonsense: string[];
}
interface Personal {
  names?: Record<string, string>;
  letters?: Record<string, { from?: string; pages?: string[] }>;
  bottles?: Record<string, string>;
}
interface Result {
  ok: boolean;
  problems: string[];
  grade: number;
  count: number;
}
type Kind = 'prose' | 'box';
interface Item {
  where: string;
  text: string;
  kind: Kind;
  /** a line spoken in nonsense: the word test is skipped */
  nonsense?: boolean;
  /** a step goal: capital, verb and digits */
  goal?: boolean;
  /** held to the two-sentence limit */
  limit2: boolean;
}

const glossary = glossaryJson as Glossary;
const NONSENSE_SPEAKERS = new Set([
  'kevin',
  'stuart',
  'bob',
  'minion_d',
  'minion_e',
  'villager_1',
  'villager_2',
  'villager_3',
  'villager_trader',
  'trader',
  'wandering_trader',
]);
const NUMBER_WORDS = new Set(
  'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty'.split(
    ' ',
  ),
);
const MAX_WORDS = 12;
const MAX_SENTENCES = 2;
const MAX_GRADE = 4.0;
const MAX_PERSONAL = 220;

function loadCommon(): Set<string> {
  const url = new URL('./common-words.txt', import.meta.url);
  return new Set(
    readFileSync(url, 'utf8')
      .split('\n')
      .map((w) => w.trim().toLowerCase())
      .filter((w) => w && !w.startsWith('#')),
  );
}

const TOKEN = /\{[^}]*\}/g;
const WORD = /[A-Za-z][A-Za-z'’-]*[A-Za-z]|[A-Za-z]|\d+(?:[.,]\d+)?/g;

/** "speaker: words" gives [speaker, words]; anything else gives ['', text]. */
function splitSpeaker(line: string): [string, string] {
  const i = line.indexOf(': ');
  if (i > 0 && i < 24 && !line.slice(0, i).includes(' ')) return [line.slice(0, i), line.slice(i + 2)];
  return ['', line];
}

/**
 * Sentences for the limits (12 words a sentence, 2 sentences a box). A call of one or two words ("Oh!", "Ha ha!",
 * "Thank you!") is read as part of the sentence it leans on, not as a sentence of its own: it joins the next
 * sentence (or the one before, when it comes last). The 12-word limit then applies to the joined sentence, so a box
 * can never hold more than 24 words. (Builder's refinement of design section 8, recorded in the passover.)
 */
function sentencesOf(text: string): string[] {
  const raw = text
    .replace(TOKEN, 'X')
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter((s) => /[A-Za-z0-9]/.test(s));
  const out: string[] = [];
  let carry = '';
  for (const s of raw) {
    const joined = carry ? `${carry} ${s}` : s;
    if ((s.match(WORD) ?? []).length <= 2) carry = joined;
    else {
      out.push(joined);
      carry = '';
    }
  }
  if (carry) {
    if (out.length) out[out.length - 1] = `${out[out.length - 1]} ${carry}`;
    else out.push(carry);
  }
  return out;
}
function wordsOf(text: string): string[] {
  return text.match(WORD) ?? [];
}

function syllables(word: string): number {
  if (/^\d/.test(word)) return 1;
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  let n = (w.match(/[aeiouy]+/g) ?? []).length;
  if (n > 1 && /[^aeiouyl]e$/.test(w) && !/(ed|es)$/.test(w)) n -= 1;
  return Math.max(1, n);
}

export function checkReading(content: Content, personal: Personal): Result {
  const common = loadCommon();
  const names = new Set(glossary.names.map((n) => n.toLowerCase()));
  const gloss = new Set(Object.keys(glossary.words).map((w) => w.toLowerCase()));
  const nonsense = new Set(glossary.nonsense.map((w) => w.toLowerCase()));
  const verbs = new Set(glossary.verbs.map((v) => v.toLowerCase()));
  const problems: { w: number; msg: string }[] = [];
  const items: Item[] = [];

  const baseKnown = (w: string): boolean => common.has(w) || gloss.has(w) || names.has(w);
  function known(raw: string): boolean {
    let w = raw.toLowerCase().replace(/’/g, "'");
    if (/^\d/.test(w)) return true;
    if (baseKnown(w) || nonsense.has(w)) return true;
    if (w.endsWith("'s") || w.endsWith("s'")) {
      w = w.slice(0, -2);
      if (baseKnown(w)) return true;
    }
    const tries: string[] = [];
    const cut = (suffix: string, add = '') => {
      if (w.endsWith(suffix) && w.length > suffix.length + 1) tries.push(w.slice(0, -suffix.length) + add);
    };
    for (const s of ['s', 'es', 'ed', 'd', 'ing', 'er', 'est', 'ly', 'r', 'st']) cut(s);
    cut('ies', 'y');
    cut('ied', 'y');
    cut('ier', 'y');
    cut('iest', 'y');
    cut('ily', 'y');
    cut('ing', 'e');
    cut('y', '');
    cut('ves', 'f');
    cut('ves', 'fe');
    cut('ying', 'y');
    // doubled consonant: stopping, hopped, bigger, biggest, funny
    for (const s of ['ing', 'ed', 'er', 'est', 'y']) {
      if (w.endsWith(s)) {
        const stem = w.slice(0, -s.length);
        if (stem.length > 2 && stem[stem.length - 1] === stem[stem.length - 2]) tries.push(stem.slice(0, -1));
      }
    }
    if (w.endsWith("n't"))
      tries.push(
        w.slice(0, -3),
        `${w.slice(0, -3)}o`,
        w.slice(0, -3) === 'ca' ? 'can' : w.slice(0, -3) === 'wo' ? 'will' : w.slice(0, -3),
        `${w.slice(0, -3)}n`,
      );
    for (const suf of ["'ll", "'ve", "'re", "'d", "'m", "'s"]) if (w.endsWith(suf)) tries.push(w.slice(0, -suf.length));
    if (tries.some(baseKnown)) return true;
    if (w.includes('-')) return w.split('-').every((p) => p === '' || known(p));
    return false;
  }

  const add = (where: string, text: unknown, kind: Kind, o: Partial<Item> = {}) => {
    if (typeof text !== 'string' || text === '') return;
    items.push({ where, text, kind, limit2: true, ...o });
  };
  const addLine = (where: string, line: Line, kind: Kind = 'box'): void => {
    if (typeof line === 'string') {
      const [who, words] = splitSpeaker(line);
      add(where, words, kind, { nonsense: NONSENSE_SPEAKERS.has(who) });
      return;
    }
    const [who, words] = splitSpeaker(line.l);
    add(where, words, kind, { nonsense: NONSENSE_SPEAKERS.has(who) });
    (line.choices ?? []).forEach((c, i) => {
      add(`${where}.choice${i}`, c.text, kind, { nonsense: NONSENSE_SPEAKERS.has(who) });
      (c.then ?? []).forEach((t, j) => {
        addLine(`${where}.choice${i}.then${j}`, t, kind);
      });
    });
  };
  const addLines = (where: string, lines?: Line[]): void => {
    (lines ?? []).forEach((l, i) => {
      addLine(`${where}[${i}]`, l);
    });
  };

  // ---- collect
  for (const [k, v] of Object.entries(content.strings)) {
    if (/^(tok|present|penflag):/.test(k) || k === 'credit_line') continue; // credit_line: a credit (D68)
    add(`strings.${k}`, v, 'prose', { goal: k.startsWith('obj_') });
  }
  for (const [id, it] of Object.entries(content.items)) {
    add(`items.${id}.name`, it.name, 'prose');
    add(`items.${id}.names`, it.names, 'prose');
    add(`items.${id}.desc`, it.desc, 'prose');
  }
  for (const [id, o] of Object.entries(content.objects)) add(`objects.${id}.name`, o.name, 'prose');
  for (const [id, o] of Object.entries(content.regions)) add(`regions.${id}.name`, o.name, 'prose');
  for (const [id, o] of Object.entries(content.stalls)) add(`stalls.${id}.name`, o.name, 'prose');
  for (const [id, o] of Object.entries(content.mobs)) add(`mobs.${id}.name`, o.name, 'prose');
  for (const [id, o] of Object.entries(content.animals)) add(`animals.${id}.name`, o.name, 'prose');
  for (const [id, o] of Object.entries(content.stickers)) add(`stickers.${id}.name`, o.name, 'prose');
  for (const [id, c] of Object.entries(content.chars)) {
    if (!/\{[^}]*\}/.test(c.name)) add(`chars.${id}.name`, c.name, 'prose');
    c.chat.forEach((pool, p) => {
      pool.lines.forEach((l, i) => {
        add(`chars.${id}.chat${p}[${i}]`, l, 'box', { nonsense: NONSENSE_SPEAKERS.has(id) });
      });
    });
  }
  for (const [id, h] of Object.entries(content.heroes))
    for (const [k, l] of Object.entries(h.lines))
      add(`heroes.${id}.lines.${k}`, l, 'box', { nonsense: NONSENSE_SPEAKERS.has(id) });
  for (const [id, q] of Object.entries(content.quests)) {
    add(`quest.${id}.name`, q.name, 'prose');
    addLines(`quest.${id}.open`, q.open);
    addLines(`quest.${id}.close`, q.close);
    addLines(`quest.${id}.openAlt`, q.openAlt);
    addLines(`quest.${id}.closeAlt`, q.closeAlt);
    q.steps.forEach((s, n) => {
      addLines(`quest.${id}.step${n}.say`, s.say);
      addLines(`quest.${id}.step${n}.sayAlt`, s.sayAlt);
      if (s.goal) add(`quest.${id}.step${n}.goal`, s.goal, 'prose', { goal: true });
    });
  }
  for (const [id, c] of Object.entries(content.cutscenes))
    c.acts.forEach((a, i) => {
      if (a.l) addLine(`cutscene.${id}[${i}]`, a.l);
    });
  for (const [id, l] of Object.entries(content.letters))
    (l.text ?? []).forEach((t, i) => {
      add(`letter.${id}[${i}]`, t, 'box');
    });

  // ---- check
  let totalWords = 0;
  let totalSentences = 0;
  let totalSyll = 0;
  for (const it of items) {
    const sents = sentencesOf(it.text);
    const longest = sents.reduce((m, s) => Math.max(m, wordsOf(s).length), 0);
    if (/[–—]/.test(it.text)) problems.push({ w: 9, msg: `[${it.where}] dash: "${it.text}"` });
    if (it.kind === 'box' && it.text.includes(';'))
      problems.push({ w: 9, msg: `[${it.where}] semicolon: "${it.text}"` });
    if (longest > MAX_WORDS)
      problems.push({ w: 100 + longest, msg: `[${it.where}] ${longest}-word sentence: "${it.text}"` });
    if (it.limit2 && sents.length > MAX_SENTENCES)
      problems.push({ w: 50 + sents.length, msg: `[${it.where}] ${sents.length} sentences: "${it.text}"` });
    if (it.goal) {
      const first = it.text.replace(TOKEN, '').trim().split(/\s+/)[0] ?? '';
      if (!/^[A-Z]/.test(it.text)) problems.push({ w: 20, msg: `[${it.where}] goal needs a capital: "${it.text}"` });
      if (!verbs.has(first.toLowerCase()))
        problems.push({ w: 20, msg: `[${it.where}] goal does not start with a listed verb: "${it.text}"` });
      const nw = wordsOf(it.text).filter((w) => NUMBER_WORDS.has(w.toLowerCase()));
      if (nw.length)
        problems.push({ w: 20, msg: `[${it.where}] goal uses number words (${nw.join(', ')}): "${it.text}"` });
    }
    if (it.nonsense) continue;
    const ws = wordsOf(it.text.replace(TOKEN, ' '));
    const unknown = ws.filter((w) => !known(w));
    if (unknown.length)
      problems.push({
        w: 10 + unknown.length,
        msg: `[${it.where}] unknown word${unknown.length > 1 ? 's' : ''}: ${[...new Set(unknown)].join(', ')} in "${it.text}"`,
      });
    // grade: glossary words, names and tokens are left out
    const counted = ws.filter((w) => {
      const l = w.toLowerCase();
      return !gloss.has(l) && !names.has(l) && !nonsense.has(l);
    });
    totalWords += counted.length;
    totalSentences += sents.length;
    for (const w of counted) totalSyll += syllables(w);
  }

  // ---- package 69: no words off the edge. Each toast, strip under the goal line and Space prompt, with the longest
  // item and person names filled in, must fit its box (an estimate of the game font's widths, on the wide side).
  for (const w of widthProblems(content, personal)) problems.push({ w: 40, msg: w });

  // ---- Dad's text: length and dashes only
  const pages: [string, string][] = [];
  for (const [id, l] of Object.entries(personal.letters ?? {}))
    (l.pages ?? []).forEach((p, i) => {
      pages.push([`personal.letters.${id}[${i}]`, p]);
    });
  for (const [id, t] of Object.entries(personal.bottles ?? {})) pages.push([`personal.bottles.${id}`, t]);
  for (const [where, t] of pages) {
    if (t.length > MAX_PERSONAL)
      problems.push({ w: 30, msg: `[${where}] ${t.length} characters (max ${MAX_PERSONAL})` });
    if (/[–—]/.test(t)) problems.push({ w: 9, msg: `[${where}] dash: "${t}"` });
  }

  const grade =
    totalWords && totalSentences ? 0.39 * (totalWords / totalSentences) + 11.8 * (totalSyll / totalWords) - 15.59 : 0;
  const out = problems.sort((a, b) => b.w - a.w).map((p) => p.msg);
  if (grade > MAX_GRADE) out.push(`grade ${grade.toFixed(1)} is above ${MAX_GRADE.toFixed(1)}`);
  return { ok: out.length === 0, problems: out, grade, count: items.length + pages.length };
}

/** Package 69: the width of a line in the game font (Nunito 700) at `size` px: a little wide on purpose. */
export function textWidth(t: string, size: number): number {
  let w = 0;
  for (const ch of t) {
    if (ch === ' ') w += 0.27;
    else if ("il.,:;!|'`".includes(ch)) w += 0.3;
    else if ('fjrt()1'.includes(ch)) w += 0.42;
    else if ('mwMW'.includes(ch)) w += 0.88;
    else if (/[A-Z]/.test(ch)) w += 0.68;
    else if (/[0-9]/.test(ch)) w += 0.58;
    else w += 0.56;
  }
  return w * size;
}
/** Box sizes (src/game/scenes/UI.ts): a toast's words at 28 px beside a picture in a strip at most 620 wide; the strip
 * under the goal line at 30 px wraps at 620 (2 lines at most); the Space prompt at 34 px. */
export const BOXES = {
  toast: 620 - 22 - 52 - 24,
  nudge: 620 * 2 - 40,
  prompt: 560,
  toast2: (620 - 22 - 52 - 24) * 2 - 60,
} as const;

function widthProblems(content: Content, personal: Personal): string[] {
  const out: string[] = [];
  const S = content.strings as Record<string, string>;
  const longest = (xs: string[]) => xs.reduce((a, b) => (b.length > a.length ? b : a), '');
  // (a name is short: a longer value in the names list is not a name)
  const person = longest(
    [...Object.values(personal.names ?? {}), ...Object.values(content.chars).map((c) => c.name)].filter(
      (n) => typeof n === 'string' && n.length <= 24,
    ),
  );
  const item = longest(Object.values(content.items).flatMap((i) => [i.name, i.names ?? '']));
  const fillLong = (t: string) =>
    t.replace(/\{(\w+)\}/g, (_m, k: string) =>
      k === 'n' ? '99' : k === 'item' || k === 'what' || k === 'list' ? item : person,
    );
  // which strings are toasts and which are strips: read from the rules' own code
  const src = readdirSync(new URL('../../src/core/', import.meta.url))
    .filter((f) => f.endsWith('.ts'))
    .map((f) => readFileSync(new URL(`../../src/core/${f}`, import.meta.url), 'utf8'))
    .join('\n');
  const toasts = new Set([...src.matchAll(/kind: 'info', text: '(\w+)'/g)].map((m) => m[1]!));
  // a toast with a picture has 52 px less for its words
  const pictured = new Set([...src.matchAll(/kind: 'info', text: '(\w+)', item/g)].map((m) => m[1]!));
  const nudges = new Set([...src.matchAll(/nudge\(g, '([\w:]+)'/g)].map((m) => m[1]!));
  for (const k of Object.keys(S)) if (/^(need_|gate:)/.test(k)) nudges.add(k);
  const check = (where: string, t: string | undefined, size: number, box: number) => {
    if (!t) return;
    const full = fillLong(t);
    const w = Math.round(textWidth(full, size));
    if (w > box) out.push(`[${where}] too wide for its box (${w} of ${box} px): "${full}"`);
  };
  // (the boss lines are big banners, not strips)
  for (const k of toasts)
    if (!/^(jockey|king)_/.test(k)) check(`strings.${k} (toast)`, S[k], 28, BOXES.toast + (pictured.has(k) ? 0 : 52));
  for (const k of nudges) check(`strings.${k} (strip)`, S[k], 30, BOXES.nudge);
  for (const k of Object.keys(S))
    if (k.startsWith('hint:')) check(`strings.${k} (prompt)`, `${S[k]}    ${S.r_eat ?? ''}`, 34, BOXES.prompt);
  // a find picked up: "99 <its name>"; a new recipe; a new quest
  for (const [id, it] of Object.entries(content.items)) {
    check(`items.${id} (toast)`, `99 ${it.names ?? it.name}`, 28, BOXES.toast);
  }
  // a quest's name may take the strip's second line (the strip wraps)
  for (const [id, q] of Object.entries(content.quests))
    check(`quest.${id}.name (toast)`, `New quest: ${q.name}`, 28, BOXES.toast2);
  return out;
}

if (import.meta.main) {
  const { content } = await import('../../src/data/content.ts');
  const personal = JSON.parse(
    readFileSync(new URL('../../src/data/personal.json', import.meta.url), 'utf8'),
  ) as Personal;
  const r = checkReading(content, personal);
  for (const p of r.problems.slice(0, 25)) console.log(p);
  if (r.problems.length > 25) console.log(`... and ${r.problems.length - 25} more`);
  if (r.ok) console.log(`READING OK (${r.count} strings, grade ${r.grade.toFixed(1)})`);
  else {
    console.log(`grade ${r.grade.toFixed(1)}, ${r.count} strings`);
    console.log(`READING FAIL: ${r.problems.length} problems`);
    process.exit(1);
  }
}
