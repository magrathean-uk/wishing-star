// Dialogue: a list of lines shown one box at a time, with a typewriter, tokens, stand-ins and choices.
import { test } from './cond.ts';
import { applyFx } from './quests.ts';
import { KOALA } from './state.ts';
import type { Game, Line } from './types.ts';

const TYPE_SPEED = 48; // characters a second

/** The character who really appears when the story names `id`: a playable character being played hands over to their stand-in. */
export function cast(g: Game, id: string): string {
  if (id === g.s.hero) return g.c.chars[id]?.standIn ?? id;
  return id;
}

export function charName(g: Game, id: string): string {
  if (id === 'you') id = g.s.hero;
  const c = g.c.chars[id];
  if (!c) return g.c.mobs[id]?.name ?? id;
  return fill(g, c.name);
}

/** Placeholders a caller fills in after `fill` (a count, an item, a list): `fill` leaves them alone. */
const LATER = new Set(['n', 'item', 'x', 'list', 'game', 'count', 'name']);

/** Replace {tokens}: {hero}, {koala}, and the names from personal.json. */
export function fill(g: Game, text: string): string {
  if (text.indexOf('{') < 0) return text;
  return text.replace(/\{(\w+)\}/g, (m, k: string) => {
    if (k === 'hero') return charName(g, g.s.hero);
    // The koala is always Koala, whatever an old save called it (phase 2, part A).
    if (k === 'koala') return KOALA;
    if (LATER.has(k)) return m;
    return g.rt.names[k] ?? g.c.strings['tok:' + k] ?? k;
  });
}

function split(l: string): [who: string, text: string] {
  const i = l.indexOf(': ');
  if (i < 1 || i > 24) return ['say', l];
  return [l.slice(0, i), l.slice(i + 2)];
}

function show(g: Game): void {
  const t = g.rt.talk!;
  for (;;) {
    if (t.i >= t.lines.length) {
      end(g);
      return;
    }
    const line = t.lines[t.i]!;
    const cond = typeof line === 'string' ? undefined : line.if;
    if (cond && !test(g, cond)) {
      t.i++;
      continue;
    }
    const raw = typeof line === 'string' ? line : line.l;
    const [who, text] = split(raw);
    t.who = who === 'you' ? g.s.hero : who === 'say' ? '' : cast(g, who);
    t.text = fill(g, text);
    t.choices = typeof line !== 'string' && line.choices ? line.choices.map((c) => fill(g, c.text)) : null;
    t.pick = 0;
    t.shown = 0;
    g.ev.push({ t: 'sfx', id: 'talk' });
    return;
  }
}

function end(g: Game): void {
  const t = g.rt.talk!;
  const then = t.then;
  g.rt.talk = null;
  // package 69: that person takes no Space for half a second (a held or mashed Space never opens the talk again)
  if (t.npc) g.rt.talkCool = { k: t.npc, until: g.rt.tick + 30 };
  g.rt.mode = g.rt.cut ? 'cut' : g.rt.mini ? 'mini' : 'play';
  // Whatever the talk settled (a hand-over, a step) is saved at the next moment of play.
  if (!g.rt.cut) g.rt.saveDue = true;
  if (then) then();
}

/** Start a conversation. `then` runs when the last box closes. If something else is on screen, it waits its turn. */
export function say(
  g: Game,
  lines: Line[] | undefined,
  then: (() => void) | null = null,
  npc = 0,
  force = false,
): void {
  if (!lines || lines.length === 0) {
    if (then) then();
    return;
  }
  if (g.rt.mode !== 'play' && !force) {
    g.rt.q.push(() => say(g, lines, then, npc));
    return;
  }
  g.rt.talk = { lines: lines.slice(), i: 0, who: '', text: '', choices: null, pick: 0, shown: 0, then, npc };
  g.rt.mode = 'talk';
  show(g);
}

export function stepTalk(g: Game, act: boolean, my: number, back: boolean): void {
  const t = g.rt.talk;
  if (!t) return;
  if (t.shown < t.text.length) {
    t.shown = Math.min(t.text.length, t.shown + TYPE_SPEED / 60);
    if (act || back) t.shown = t.text.length;
    return;
  }
  if (t.choices) {
    if (my !== 0) {
      // package 60: no wrapping round: a held key (it repeats) stays on the last answer instead of coming back
      const to = Math.max(0, Math.min(t.choices.length - 1, t.pick + my));
      if (to !== t.pick) g.ev.push({ t: 'sfx', id: 'tick' });
      t.pick = to;
    }
    if (act) choose(g, t.pick);
    // package 69: X (and Escape) on a question is the kind answer ("No", "Not now"): the one that changes nothing
    else if (back) {
      const k = kindChoice(t.lines[t.i]);
      if (k >= 0) choose(g, k);
    }
    return;
  }
  if (act || back) {
    t.i++;
    show(g);
  }
}

/** The answer to a question that does nothing (no flags, no more lines); -1 when every answer does something. */
export function kindChoice(line: Line | undefined): number {
  if (!line || typeof line === 'string' || !line.choices) return -1;
  for (let i = line.choices.length - 1; i >= 0; i--) {
    const c = line.choices[i]!;
    if (!c.fx && !c.then) return i;
  }
  return -1;
}

export function choose(g: Game, i: number): void {
  const t = g.rt.talk;
  if (!t?.choices) return;
  const line = t.lines[t.i]!;
  if (typeof line === 'string' || !line.choices) return;
  const c = line.choices[Math.max(0, Math.min(i, line.choices.length - 1))]!;
  g.ev.push({ t: 'sfx', id: 'pick' });
  if (c.then) t.lines.splice(t.i + 1, 0, ...c.then);
  if (c.fx) applyFx(g, c.fx);
  t.i++;
  show(g);
}

/** Skip to the end at once (the solver and the tests use it; the player cannot). */
export function skipTalk(g: Game): void {
  let guard = 0;
  while (g.rt.talk && guard++ < 500) {
    const t = g.rt.talk;
    t.shown = t.text.length;
    if (t.choices) choose(g, 0);
    else {
      t.i++;
      show(g);
    }
  }
}

/** Words in a set of lines, for the playtime report. */
export function wordCount(lines: Line[] | undefined): number {
  if (!lines) return 0;
  let n = 0;
  for (const l of lines) {
    const raw = typeof l === 'string' ? l : l.l;
    n += split(raw)[1].split(/\s+/).filter(Boolean).length;
    if (typeof l !== 'string' && l.choices) n += wordCount(l.choices[0]?.then);
  }
  return n;
}
