// Things the scenes share: Dad's personal text, the Christmas switch, starting and loading games.
import { postDay } from '../core/post.ts';
import { JOURNAL_TABS } from '../core/quests.ts';
import { newGame } from '../core/state.ts';
import type { Game } from '../core/types.ts';
import { content } from '../data/content.ts';
import { fetchPersonal, net, probe } from './net.ts';
import { isChristmas, loadSlot, usePlayer, useSlot } from './save.ts';

export interface Personal {
  greeting1: string;
  greeting2: string;
  credits: string;
  names: Record<string, string>;
  letters: Record<string, { from: string; pages: string[] }>;
  bottles: Record<string, string>;
  /** package 73b (D80): Dad's 25 December notes, "1" to "25", read at the Post Office */
  december: Record<string, string>;
}

/**
 * The built-in words: neutral, naming nobody. Dad's own words (names, letters, the greeting) are never in the bundle:
 * personal.json is only ever fetched, and in players mode only for the hero's own entry (D67). The names are the
 * stand-ins in strings.ts; a letter with no words of its own shows the mail page's warm line.
 */
function builtIn(): Personal {
  const names: Record<string, string> = {};
  for (const [k, v] of Object.entries(content.strings)) if (k.startsWith('tok:')) names[k.slice(4)] = v;
  return {
    greeting1: 'Merry Christmas!',
    greeting2: '',
    credits: 'Made with love.',
    names,
    letters: {},
    bottles: {},
    december: {},
  };
}

export const app = {
  personal: builtIn(),
  christmas: 'auto' as 'auto' | 'on' | 'off',
  /** music and sound, 0 to 1: set under Options on the title or in the pause menu, and kept for every game */
  music: 0.6,
  sound: 0.8,
  content,
  /** set when Dad's personal.json is there but has a mistake in it: the title shows one small line about it */
  personalBroken: false,
  /** Dad's personal.json was read and used (the home copy, or the hero's own entry in players mode) */
  ownWords: false,
};

/** The line on the title for Dad when his file has a mistake (reading rules: short, plain). */
export const PERSONAL_BROKEN = 'personal.json has a mistake. The built-in words are used.';

/** Where a JSON parse error is, as "line 3, column 14", from the position the browser gives (when it gives one). */
function whereIn(text: string, err: unknown): string {
  const m = /position (\d+)/.exec(String((err as Error)?.message ?? ''));
  // some browsers give no position: a curly quote from TextEdit is the usual mistake, so point at the first one
  const at = m ? Number(m[1]) : text.search(/[\u201c\u201d]/);
  if (at < 0) return '';
  const before = text.slice(0, at);
  const line = before.split('\n').length;
  return ` (line ${line}, column ${before.length - before.lastIndexOf('\n')})`;
}

/** Dad's file sits beside the game, outside the bundle. If it is missing or broken, the built-in copy is used. */
export async function loadPersonal(): Promise<void> {
  await probe();
  if (net.on) usePlayer(net.id);
  await readPersonal();
  try {
    const c = localStorage.getItem('ws_christmas');
    if (c === 'on' || c === 'off' || c === 'auto') app.christmas = c;
    const vol = (k: string, d: number): number => {
      const v = Number(localStorage.getItem(k) ?? '');
      return localStorage.getItem(k) !== null && v >= 0 && v <= 1 ? v : d;
    };
    app.music = vol('ws_music', app.music);
    app.sound = vol('ws_sound', app.sound);
  } catch {
    // default stays
  }
}

/** Players mode: a player has logged in or out. Their save becomes the one in use, and only the hero gets Dad's words. */
export async function playerChanged(): Promise<void> {
  usePlayer(net.id);
  await readPersonal();
}

/** A missing file stays silent; a file that is there but cannot be read is logged and shown on the title. */
async function readPersonal(): Promise<void> {
  app.personal = builtIn();
  app.personalBroken = false;
  app.ownWords = false;
  const url = `${import.meta.env.BASE_URL}personal.json`;
  let text: string;
  try {
    const r = net.on ? await fetchPersonal(url) : await fetch(url, { cache: 'no-store' });
    if (!r?.ok) return;
    text = await r.text();
  } catch {
    return; // keep the built-in copy
  }
  // a server that answers a missing file with its index page (or the dev server's empty stand-in): no file, silent
  if (/^\s*</.test(text) || /^\s*\{\s*\}\s*$/.test(text)) return;
  let p: Partial<Personal>;
  try {
    p = JSON.parse(text) as Partial<Personal>;
  } catch (err) {
    console.error(`personal.json has a mistake${whereIn(text, err)}: ${(err as Error).message}`);
    app.personalBroken = true;
    return;
  }
  try {
    if (!p || typeof p !== 'object' || typeof p.greeting1 !== 'string' || !p.names || !p.letters) {
      console.error('personal.json is not as the game expects: it needs greeting1, names and letters');
      app.personalBroken = true;
      return;
    }
    const b = builtIn();
    app.ownWords = true;
    app.personal = {
      greeting1: p.greeting1,
      greeting2: typeof p.greeting2 === 'string' ? p.greeting2 : b.greeting2,
      credits: typeof p.credits === 'string' ? p.credits : b.credits,
      names: { ...b.names, ...p.names },
      letters: { ...b.letters, ...p.letters },
      bottles: { ...b.bottles, ...(p.bottles ?? {}) },
      december: p.december && typeof p.december === 'object' ? p.december : {},
    };
  } catch (err) {
    console.error(`personal.json could not be used: ${(err as Error).message}`);
    app.personalBroken = true;
  }
}

export function xmasNow(): boolean {
  return isChristmas(app.christmas);
}
/**
 * Package 73b (D81): the December post goes by the real date. The rules get the day of the post and the days that have
 * one of Dad's notes in this copy's personal file (none for a player in players mode); never the words themselves.
 */
export function postNow(g: Game, now = new Date()): void {
  // With the Christmas switch set to "on" in Options it is Christmas Day for the post too, so Dad can read the
  // whole bundle before December (D81: she first plays on 25 December, when every note is there).
  g.rt.today = app.christmas === 'on' ? 25 : postDay(now.getFullYear(), now.getMonth(), now.getDate());
  g.rt.dec = Object.keys(app.personal.december)
    .map(Number)
    .filter((d) => Number.isInteger(d) && typeof app.personal.december[String(d)] === 'string');
}
export function setChristmas(v: 'auto' | 'on' | 'off', g?: Game): void {
  app.christmas = v;
  try {
    localStorage.setItem('ws_christmas', v);
  } catch {
    // not saved, still applies now
  }
  if (g) {
    g.s.opts.christmas = v;
    g.s.xmas = xmasNow();
    g.rt.dirty = true;
    postNow(g);
  }
}

/** Music or sound, 0 to 1, from Options. It is kept in the browser and, when a game is running, in its save too. */
export function setVolume(which: 'music' | 'sound', v: number, g?: Game): void {
  const val = Math.max(0, Math.min(1, Math.round(v * 10) / 10));
  app[which] = val;
  try {
    localStorage.setItem('ws_' + which, String(val));
  } catch {
    // not saved, still applies now
  }
  if (g) g.s.opts[which] = val;
}

/** A new game. Nobody is named by the player: the koala is always Koala. */
export function startNew(slot: number, hero: string): Game {
  useSlot(slot);
  const g = newGame(content, {
    hero,
    koala: 'Koala',
    xmas: xmasNow(),
    names: app.personal.names,
    seed: (Date.now() & 0x7fffffff) | 1,
    opts: { christmas: app.christmas, music: app.music, sound: app.sound },
  });
  postNow(g);
  return g;
}
export function continueSlot(slot: number): Game | null {
  const g = loadSlot(content, slot, app.personal.names, xmasNow());
  if (g) {
    useSlot(slot);
    adopt(g);
  }
  return g;
}
/** A game that has just been loaded or imported takes the Options set on this computer and a tidy journal. */
export function adopt(g: Game): void {
  g.s.opts.christmas = app.christmas;
  g.s.opts.music = app.music;
  g.s.opts.sound = app.sound;
  tidyJournal(g);
  postNow(g);
}

/**
 * An old save may hold stickers the journal no longer has (food, ores, the friend stickers): they are dropped
 * quietly. A set she had started gets its own sticker, and a finished-page mark is kept only for a tab that is
 * still full.
 */
export function tidyJournal(g: Game): void {
  const s = g.s;
  const list = g.c.stickers;
  for (const id in s.stickers) if (!list[id]) delete s.stickers[id];
  for (const id in s.stickers) {
    const of = list[id]?.of;
    if (of && list[of] && !s.stickers[of]) s.stickers[of] = s.stickers[id]!;
  }
  for (const f in s.flags) {
    if (!f.startsWith('page:')) continue;
    const page = f.slice(5);
    const full =
      (JOURNAL_TABS as readonly string[]).includes(page) &&
      Object.values(list).every((d) => d.page !== page || !!d.of || !!s.stickers[d.id]);
    if (!full) delete s.flags[f];
  }
}

/** Typed text goes through a normal text field over the game, so spaces and accented letters work. */
export function askText(game: Phaser.Game, label: string, initial: string, hint: string, max = 40): Promise<string> {
  return new Promise((done) => {
    const box = document.getElementById('name-entry')!;
    const inp = document.getElementById('name-input') as HTMLInputElement;
    const back = document.getElementById('name-back')!;
    const confirm = document.getElementById('name-done')!;
    document.getElementById('name-label')!.textContent = label;
    document.getElementById('name-hint')!.textContent = hint;
    inp.value = initial;
    inp.maxLength = max;
    box.classList.add('open');
    const kb = game.input.keyboard;
    if (kb) {
      kb.enabled = false;
      kb.preventDefault = false;
    }
    const focusTimer = setTimeout(() => {
      inp.focus();
      inp.select();
    }, 30);
    const finish = (v: string) => {
      clearTimeout(focusTimer);
      box.removeEventListener('keydown', onKey);
      back.removeEventListener('click', onBack);
      confirm.removeEventListener('click', onConfirm);
      box.classList.remove('open');
      if (kb) {
        kb.enabled = true;
        kb.preventDefault = true;
      }
      for (const sc of game.scene.getScenes(true)) sc.input.keyboard?.resetKeys();
      game.canvas.focus();
      window.focus();
      done(v.trim().slice(0, max));
    };
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Enter' && e.target === inp) finish(inp.value || initial);
      else if (e.key === 'Escape') finish(initial);
    };
    const onBack = () => finish(initial);
    const onConfirm = () => finish(inp.value || initial);
    box.addEventListener('keydown', onKey);
    back.addEventListener('click', onBack);
    confirm.addEventListener('click', onConfirm);
  });
}
import type Phaser from 'phaser';
