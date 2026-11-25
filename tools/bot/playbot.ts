// Timed play bot: plays the prologue and chapter 1 of the real game in headed Chrome at a child's pace, with real key
// presses only (no debug commands), to calibrate the playtime report (build plan section 6: a timed play of the
// prologue and one chapter lands within 40 percent of their budget lines, 15 and 25 minutes).
//
// How it decides: before each move it copies the browser's game state into a headless copy of the rules and asks the
// solver's player (tools/check/planner.ts, story first, no quick travel) what it would do next. It plays that ahead on
// the copy until the first key that is not walking (Space, R or a menu command), then does the same in the browser
// with held arrow keys and real menu keys, and asks again. Fights, mini-games, talk boxes, cards and menus are played
// live from what the screen shows.
//
// Assumptions (stated, not tuned; change them here and say so in the report):
// - Reading: every dialogue box, card, letter page and scene line is read at 80 words a minute from the moment its
//   text is fully shown, then she presses Space.
// - Before each new action (a different thing to do), she pauses 1 to 2 s.
// - Walking: she follows the path with small stops (0.5 to 1.5 s every 8 to 15 s of walking) and, now and then, a
//   short wobble to one side.
// - Every 2.5 to 4 minutes of play she opens the bag, the map or the quest book, looks for 3 to 6 s and closes it.
// - Menus: 0.5 s per key press.
// - Fights: she reacts to what she saw 350 ms ago; one decision in ten is a mistake (a missed swing or a wrong turn).
// - Mini-games: the kid bot's policies (tools/check/kidbot.ts), 350 ms late, 10 percent mistakes, with real keys.
// - The seeded random stream below makes a run repeatable in its choices (the game itself runs in real time).
// The solver's side of the table uses the playtime formula: walking steps x 1.5, reading at 80 words a minute,
// 3 s a gather, 4 s a craft, 3 s a placement, 8 s a mob, kid-bot seconds per mini-game. Waiting is listed apart.
//
// Run: node tools/bot/playbot.ts [--hero amelia] [--url <base>] [--port 4180] [--minutes 150] [--seed 7] [--trace]
// Without --url it builds the game once into a folder of its own and serves that on --port: the dev server reloads the
// page whenever someone edits a source file, which would end a long timed play.
// Writes test-results/playbot.json and prints the two splits side by side.
import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { boot, newGame } from '../../src/core/state.ts';
import { step } from '../../src/core/step.ts';
import type { Game, GameState, Input, MiniRt } from '../../src/core/types.ts';
import { content } from '../../src/data/content.ts';
import { DELAY, MISTAKE, POLICY, PRESS_GAP, Rng, type Snap } from '../check/kidbot.ts';
import { Bot, COST, type Tally, WPM } from '../check/planner.ts';
import { kidTimes, letterWords, names } from '../check/solver.ts';
import { launch, openTitle, RESULTS, ROOT, type Server, sleep, startNewGame, startServer } from './lib.ts';

const QUESTS = ['prologue', 'ch1'] as const;
const BUDGET: Record<string, number> = { prologue: 15, ch1: 25 };
const KINDS = ['walking', 'reading', 'menus', 'gathering', 'fighting', 'minis', 'waiting'] as const;
type Kind = (typeof KINDS)[number];
const REACT_MS = (DELAY / 60) * 1000;
const MENU_KEY_MS = 500;

const args = process.argv.slice(2);
const arg = (k: string, d: string) => {
  const i = args.indexOf(k);
  return i >= 0 && args[i + 1] ? args[i + 1]! : d;
};
const HERO = arg('--hero', 'amelia');
const TRACE = args.includes('--trace');
/**
 * Scenes are read quickly and their reading time added at 80 words a minute afterwards: read in real time, the intro
 * scene crashes the view (a character atlas is swept while a hidden puppet still uses it; see the report).
 * --slow-scenes reads them in real time.
 */
const SLOW_SCENES = args.includes('--slow-scenes');
let sceneMs = 0;
let lastTrace = '';
let traceN = 0;
function trace(what: string): void {
  if (!TRACE) return;
  if (what === lastTrace) {
    if (++traceN % 10 !== 0) return;
    what += ` (x${traceN})`;
  } else {
    traceN = 0;
    lastTrace = what;
  }
  console.log(`${((Date.now() - T0) / 1000).toFixed(1).padStart(7)}  ${what}`);
}
const T0 = Date.now();
const CAP_MIN = Number(arg('--minutes', '150'));
const rng = new Rng(Number(arg('--seed', '7')));
const between = (a: number, b: number) => a + (b - a) * rng.next();

// ---------------------------------------------------------------- the clock, by quest and kind

const spent: Record<string, Record<Kind, number>> = {};
let kind: Kind = 'waiting';
let quest = 'prologue';
let since = Date.now();
function account(): void {
  const now = Date.now();
  const row = (spent[quest] ??= Object.fromEntries(KINDS.map((k) => [k, 0])) as Record<Kind, number>);
  row[kind] += now - since;
  since = now;
}
function doing(k: Kind): void {
  if (k === kind) return;
  account();
  kind = k;
}
async function wait(ms: number, k: Kind = 'waiting'): Promise<void> {
  doing(k);
  await sleep(ms);
}

// ---------------------------------------------------------------- reading the screen

interface Light {
  mode: string;
  paused: boolean;
  area: string;
  x: number;
  y: number;
  dir: string;
  ticks: number;
  talk: { text: string; shown: number; choices: string[] | null; i: number } | null;
  card: { title: string; lines: string[]; t: number } | null;
  cut: boolean;
  mini: { game: string; st: number; t: number; n: number[]; objs: Snap['objs']; score: number } | null;
  fish: number;
  build: { cx: number; cy: number; sel: number } | null;
  overlay: {
    kind: string;
    sel?: number;
    list?: string[];
    ids?: string[];
    open?: string | null;
    page?: number;
    pages?: string[];
  } | null;
  mobs: { k: number; id: string; x: number; y: number; calm: boolean; st: number; gone: boolean }[];
  ch1: boolean;
  sig: string;
  /** what Space would do now (the hint strip) */
  hint: string;
}

function light(page: Page): Promise<Light | null> {
  return page.evaluate(() => {
    const G = (window as any).__game;
    const g = G?.g;
    if (!g) return null;
    const ui = G.game.scene.getScene('UI');
    const ov = ui?.overlay;
    const rt = g.rt;
    const s = g.s;
    let sig = '';
    for (const k in s.quests) sig += `${k}:${s.quests[k].step}:${s.quests[k].n}:${s.quests[k].done ? 1 : 0};`;
    for (const sl of s.bag) if (sl) sig += `${sl.id}${sl.n},`;
    sig += `p${s.placed.length}e${s.emeralds}`;
    return {
      mode: rt.mode,
      paused: rt.paused,
      area: s.area,
      x: s.x,
      y: s.y,
      dir: s.dir,
      ticks: s.ticks,
      talk: rt.talk ? { text: rt.talk.text, shown: rt.talk.shown, choices: rt.talk.choices, i: rt.talk.i } : null,
      card: rt.card ? { title: rt.card.title, lines: rt.card.lines, t: rt.card.t } : null,
      cut: !!rt.cut,
      mini: rt.mini
        ? {
            game: rt.mini.game,
            st: rt.mini.st,
            t: rt.mini.t,
            n: rt.mini.n.slice(),
            objs: rt.mini.objs.map((o: any) => ({ ...o })),
            score: rt.mini.score,
          }
        : null,
      fish: rt.fish ? rt.fish.st : -1,
      build: rt.build ? { cx: rt.build.cx, cy: rt.build.cy, sel: rt.build.sel } : null,
      overlay: ov
        ? {
            kind: ov.constructor?.name ?? 'menu',
            sel: ov.sel,
            list: ov.list,
            ids: ov.ids,
            open: ov.open,
            page: ov.page,
            pages: ov.pages,
          }
        : null,
      mobs: rt.mobs.map((m: any) => ({ k: m.k, id: m.id, x: m.x, y: m.y, calm: !!m.calm, st: m.st, gone: !!m.gone })),
      ch1: !!s.quests.ch1?.done,
      sig,
      hint: rt.hint,
    };
  });
}

/** The whole save plus the moving people, to plan on a headless copy. */
function full(page: Page): Promise<{ s: GameState; npcs: unknown[]; mobs: unknown[]; beasts: unknown[] } | null> {
  return page.evaluate(() => {
    const g = (window as any).__game?.g;
    if (!g) return null;
    const plain = (v: unknown) => JSON.parse(JSON.stringify(v));
    return { s: plain(g.s), npcs: plain(g.rt.npcs), mobs: plain(g.rt.mobs), beasts: plain(g.rt.beasts) };
  });
}

const words = (t: string) => t.split(/\s+/).filter(Boolean).length;
const readMs = (n: number) => (n * 60000) / WPM;

// ---------------------------------------------------------------- keys

const held = new Set<string>();
let page: Page;
async function hold(keys: string[]): Promise<void> {
  for (const k of [...held])
    if (!keys.includes(k)) {
      await page.keyboard.up(k);
      held.delete(k);
    }
  for (const k of keys)
    if (!held.has(k)) {
      await page.keyboard.down(k);
      held.add(k);
    }
}
async function frame(n = 1): Promise<void> {
  for (let i = 0; i < n; i++) await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(0))));
}
async function tap(key: string, frames = 2): Promise<void> {
  await page.keyboard.down(key);
  await frame(frames);
  await page.keyboard.up(key);
}
/** A menu key at a child's pace. */
async function menuKey(key: string): Promise<void> {
  await tap(key);
  await wait(MENU_KEY_MS, 'menus');
}
const ARROW: Record<string, string> = { right: 'ArrowRight', left: 'ArrowLeft', down: 'ArrowDown', up: 'ArrowUp' };

// ---------------------------------------------------------------- planning on a copy

interface Plan {
  why: string;
  cur: string;
  /** tile waypoints to walk, in the area she is in now */
  path: { x: number; y: number }[];
  /** what to do at the end */
  act: {
    kind: 'act' | 'use' | 'cmd' | 'idle' | 'done';
    dir?: string;
    hold?: boolean;
    cmd?: Input['cmd'];
    steps?: number;
  };
  /** the copy at the moment of the action (for menus and placing) */
  g: Game;
  /** on the copy she walked into someone standing still (people freeze while she is close) */
  blocked?: boolean;
  /** the path ends in a door, walked into this way */
  door?: { mx: number; my: number };
}

const fresh = (): Game => newGame(content, { hero: HERO, seed: 20261225, names: names() });
const bot = new Bot(fresh(), {
  run: 3,
  maxSteps: Number.MAX_SAFE_INTEGER,
  miniSecs: kidTimes(),
  letterWords: letterWords(),
  noTravel: true,
});

async function plan(): Promise<Plan | null> {
  const f = await full(page);
  if (!f) return null;
  const g = boot(content, f.s, names());
  g.rt.npcs = f.npcs as Game['rt']['npcs'];
  g.rt.mobs = f.mobs as Game['rt']['mobs'];
  g.rt.beasts = f.beasts as Game['rt']['beasts'];
  g.ev.length = 0;
  bot.rebind(g);
  bot.clear();
  const task = bot.decide();
  const path: { x: number; y: number }[] = [];
  const out: Plan = { why: bot.why, cur: bot.cur, path, act: { kind: 'idle', steps: 0 }, g };
  if (!task) {
    out.act = { kind: 'done' };
    return out;
  }
  const area = g.s.area;
  let idle = 0;
  let still = 0;
  for (let i = 0; i < 60 * 20; i++) {
    bot.clear();
    if (g.rt.mode !== 'play') break;
    const r = task.next();
    out.why = bot.why;
    out.cur = bot.cur;
    if (r.done) break;
    const inp = bot.inp;
    if (inp.act || inp.use || inp.cmd) {
      const d = inp.mx > 0 ? 'right' : inp.mx < 0 ? 'left' : inp.my > 0 ? 'down' : inp.my < 0 ? 'up' : g.s.dir;
      out.act = { kind: inp.cmd ? 'cmd' : inp.use ? 'use' : 'act', dir: d, hold: inp.hold, cmd: inp.cmd };
      return out;
    }
    const walking = inp.mx !== 0 || inp.my !== 0;
    const ox = g.s.x;
    const oy = g.s.y;
    step(g, inp);
    g.ev.length = 0;
    if (walking && Math.abs(g.s.x - ox) + Math.abs(g.s.y - oy) < 0.004) {
      if (++still > 25) {
        out.blocked = true;
        break;
      }
    } else still = 0;
    if (g.s.area !== area) {
      // through a door: the last waypoint is the door tile itself, walked into in the same direction
      path.push({ x: Math.floor(ox + inp.mx * 0.6), y: Math.floor(oy + inp.my * 0.6) });
      out.door = { mx: inp.mx, my: inp.my };
      break;
    }
    if (walking) {
      idle = 0;
      const t = { x: Math.floor(g.s.x), y: Math.floor(g.s.y) };
      const last = path[path.length - 1];
      if (!last || last.x !== t.x || last.y !== t.y) path.push(t);
      if (path.length > 40) break;
    } else if (++idle > 90 && !path.length) {
      out.act = { kind: 'idle', steps: idle };
      return out;
    } else if (idle > 30 && path.length) break;
  }
  if (!path.length) out.act = { kind: 'idle', steps: Math.max(30, idle) };
  return out;
}

// ---------------------------------------------------------------- doing

let lastAction = '';
let lastLook = Date.now();
let nextLook = between(150, 240) * 1000;
let walkedSince = Date.now();
let nextStop = between(8, 15) * 1000;

/** Walk the waypoints with held arrows, steering on the live position. False when she got stuck. */
async function walkPath(
  path: { x: number; y: number }[],
  area: string,
  door?: { mx: number; my: number },
): Promise<boolean> {
  let i = 0;
  let stuckT = Date.now();
  let lx = -1;
  let ly = -1;
  doing('walking');
  try {
    while (i < path.length) {
      const l = await light(page);
      if (l?.mode !== 'play' || l.overlay) {
        trace(`walk ends: mode ${l?.mode} menu ${l?.overlay?.kind}`);
        return true;
      }
      if (l.area !== area) return true;
      const w = path[i]!;
      const last = i === path.length - 1;
      if (last && door) {
        // keep walking into the door until the area changes
        const keys: string[] = [];
        if (door.mx) keys.push(door.mx > 0 ? 'ArrowRight' : 'ArrowLeft');
        if (door.my) keys.push(door.my > 0 ? 'ArrowDown' : 'ArrowUp');
        await hold(keys);
        if (Date.now() - stuckT > 1500) return false;
        await sleep(20);
        continue;
      }
      const dx = w.x + 0.5 - l.x;
      const dy = w.y + 0.5 - l.y;
      const inTile = Math.floor(l.x) === w.x && Math.floor(l.y) === w.y;
      if (last ? inTile && Math.abs(dx) < 0.3 && Math.abs(dy) < 0.3 : Math.abs(dx) < 0.3 && Math.abs(dy) < 0.3) {
        i++;
        continue;
      }
      if (Math.hypot(l.x - lx, l.y - ly) > 0.05) {
        lx = l.x;
        ly = l.y;
        stuckT = Date.now();
      } else if (Date.now() - stuckT > 1200) return false;
      // a child's walk: now and then a stop, or a little wobble to one side
      if (Date.now() - walkedSince > nextStop) {
        await hold([]);
        walkedSince = Date.now();
        nextStop = between(8, 15) * 1000;
        if (rng.next() < 0.3) {
          const side =
            Math.abs(dx) > Math.abs(dy)
              ? rng.next() < 0.5
                ? 'ArrowUp'
                : 'ArrowDown'
              : rng.next() < 0.5
                ? 'ArrowLeft'
                : 'ArrowRight';
          await hold([side]);
          await sleep(between(250, 500));
          await hold([]);
        } else await wait(between(500, 1500));
        doing('walking');
        stuckT = Date.now();
        continue;
      }
      const keys: string[] = [];
      const tol = last ? 0.12 : 0.18;
      if (dx > tol) keys.push('ArrowRight');
      else if (dx < -tol) keys.push('ArrowLeft');
      if (dy > tol) keys.push('ArrowDown');
      else if (dy < -tol) keys.push('ArrowUp');
      await hold(keys);
      await sleep(15);
    }
    return true;
  } finally {
    await hold([]);
  }
}

/** Turn to face a way with the lightest tap (one or two frames of the arrow). */
async function faceDir(dir: string): Promise<void> {
  const l = await light(page);
  if (l && l.dir === dir) return;
  // hold the arrow until the game has seen it (a press and release inside one frame is never seen)
  await page.keyboard.down(ARROW[dir]!);
  try {
    for (let k = 0; k < 8; k++) {
      await frame(1);
      if ((await page.evaluate(() => (window as any).__game?.g?.s?.dir)) === dir) break;
    }
  } finally {
    await page.keyboard.up(ARROW[dir]!);
  }
  await frame(1);
}

/** Bag counts and quest steps, to see that pressing did something. */
async function sigNow(): Promise<string> {
  return (await light(page))?.sig ?? '';
}

async function doAction(p: Plan): Promise<void> {
  const a = p.act;
  const label = `${p.cur}|${p.why.split(':')[0]}|${a.kind}`;
  if (label !== lastAction && a.kind !== 'idle') {
    await wait(between(1000, 2000));
    lastAction = label;
  }
  const why = p.why;
  if (a.kind === 'idle') {
    await wait(Math.min(3000, ((a.steps ?? 30) * 1000) / 60));
    return;
  }
  if (a.kind === 'use') {
    if (a.dir) await faceDir(a.dir);
    await tap('KeyR');
    await wait(300);
    return;
  }
  if (a.kind === 'act') {
    if (/^fight|^go to fight|^wait for/.test(why) || (a.hold && /fight/.test(why))) {
      await fight();
      return;
    }
    if (a.dir) await faceDir(a.dir);
    const gather = /^(chop|mine|pick|dig|gather|cut|collect|open|harvest)/.test(why);
    doing(gather ? 'gathering' : 'waiting');
    if (a.hold) {
      // hold Space until something lands in the bag (or up to 4 s)
      const before = await sigNow();
      await page.keyboard.down('Space');
      const t0 = Date.now();
      try {
        while (Date.now() - t0 < 4000) {
          await sleep(120);
          if ((await sigNow()) !== before) break;
        }
      } finally {
        await page.keyboard.up('Space');
      }
    } else {
      const h = await light(page);
      trace(`press Space at ${h?.x.toFixed(2)},${h?.y.toFixed(2)} facing ${h?.dir} (wanted ${a.dir}): hint ${h?.hint}`);
      await tap('Space');
      await frame(3);
    }
    return;
  }
  if (a.kind === 'cmd' && a.cmd) await doCmd(p);
}

async function doCmd(p: Plan): Promise<void> {
  const c = p.act.cmd!;
  switch (c.c) {
    case 'hot':
      await tap(`Digit${c.i + 1}`);
      await wait(MENU_KEY_MS, 'menus');
      return;
    case 'craft': {
      // E by a table or furnace opens the recipe list
      await menuKey('KeyE');
      let l = await light(page);
      trace(`craft menu: ${l?.overlay?.kind} list ${JSON.stringify(l?.overlay?.list)} want ${c.recipe}`);
      if (!l?.overlay?.list) {
        await menuKey('KeyX');
        return;
      }
      const idx = l.overlay.list.indexOf(c.recipe);
      if (idx < 0) {
        await menuKey('KeyX');
        return;
      }
      for (let k = 0; k < 40 && l?.overlay && l.overlay.sel !== idx; k++) {
        await menuKey((l.overlay.sel ?? 0) < idx ? 'ArrowDown' : 'ArrowUp');
        l = await light(page);
      }
      for (let k = 0; k < (c.times ?? 1); k++) await menuKey('Space');
      await menuKey('KeyX');
      return;
    }
    case 'place': {
      await menuKey('KeyB');
      let l = await light(page);
      if (l?.mode !== 'build') return;
      // which placeable is picked: they are listed in bag order
      const list: string[] = [];
      const fs = await full(page);
      for (const sl of fs?.s.bag ?? [])
        if (sl && content.items[sl.id]?.place && !list.includes(sl.id)) list.push(sl.id);
      const want = list.indexOf(c.item);
      for (let k = 0; k < 20 && l?.build && l.build.sel !== want && want >= 0; k++) {
        await menuKey(l.build.sel < want ? 'KeyE' : 'KeyQ');
        l = await light(page);
      }
      for (let k = 0; k < 40 && l?.build && (l.build.cx !== c.x || l.build.cy !== c.y); k++) {
        const b = l.build;
        await menuKey(b.cx < c.x ? 'ArrowRight' : b.cx > c.x ? 'ArrowLeft' : b.cy < c.y ? 'ArrowDown' : 'ArrowUp');
        l = await light(page);
      }
      await menuKey('Space');
      await menuKey('KeyB');
      return;
    }
    case 'build':
      if (!c.on) await menuKey('KeyB');
      return;
    default:
      // a menu the timed bot does not drive yet: say so in the result rather than use a debug command
      unsupported.add(c.c);
      await wait(1000);
      return;
  }
}
const unsupported = new Set<string>();

/** Live fighting: she sees mobs 350 ms late, walks at the nearest, swings when close, backs off a hissing creeper. */
async function fight(): Promise<void> {
  doing('fighting');
  const hist: { t: number; l: Light }[] = [];
  let lastSwing = 0;
  let quietSince = Date.now();
  const startSig = await sigNow();
  const t0 = Date.now();
  try {
    while (Date.now() - t0 < 90000) {
      const l = await light(page);
      if (l?.mode !== 'play' || l.overlay) return;
      hist.push({ t: Date.now(), l });
      while (hist.length > 2 && hist[1]!.t < Date.now() - REACT_MS) hist.shift();
      const seen = hist[0]!.l;
      const foes = seen.mobs.filter((m) => !m.gone && !m.calm && content.mobs[m.id]?.role !== 'animal');
      let best: (typeof foes)[number] | null = null;
      let bd = 12;
      for (const m of foes) {
        const d = Math.hypot(m.x - l.x, m.y - l.y);
        if (d < bd) {
          bd = d;
          best = m;
        }
      }
      if (!best) {
        await hold([]);
        if (Date.now() - quietSince > 4000 || (await sigNow()) !== startSig) return;
        await sleep(50);
        continue;
      }
      quietSince = Date.now();
      const dx = best.x - l.x;
      const dy = best.y - l.y;
      const ai = content.mobs[best.id]?.ai;
      const mistake = rng.next() < MISTAKE / 6;
      if ((ai === 'creeper' || ai === 'mini') && best.st === 5 && bd < 4.2) {
        await hold([dx > 0 ? 'ArrowLeft' : 'ArrowRight', dy > 0 ? 'ArrowUp' : 'ArrowDown']);
      } else if (bd > 1.25) {
        const keys: string[] = [];
        if (Math.abs(dx) > 0.3) keys.push(dx > 0 ? 'ArrowRight' : 'ArrowLeft');
        if (Math.abs(dy) > 0.3) keys.push(dy > 0 ? 'ArrowDown' : 'ArrowUp');
        await hold(mistake ? [] : keys);
      } else {
        await hold([]);
        const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
        if (Date.now() - lastSwing > (PRESS_GAP / 60) * 1000 * 2) {
          await faceDir(dir);
          if (rng.next() >= MISTAKE) await tap('Space');
          lastSwing = Date.now();
        }
      }
      await sleep(40);
    }
  } finally {
    await hold([]);
  }
}

/** A mini-game through its real controls, with the kid bot's policy, 350 ms late. */
async function playMini(): Promise<void> {
  doing('minis');
  const hist: { t: number; s: Snap }[] = [];
  const mem: Record<string, number> = {};
  let lastPress = 0;
  let readUntil = 0;
  for (let guard = 0; guard < 20000; guard++) {
    const l = await light(page);
    if (l?.mode !== 'mini' || !l.mini) break;
    const m = l.mini;
    if (l.talk) {
      await readBox(l);
      doing('minis');
      continue;
    }
    if (m.st === 0) {
      if (!readUntil) readUntil = Date.now() + 1500;
      if (Date.now() > readUntil) {
        await tap('Space');
        readUntil = 0;
      }
      await sleep(60);
      continue;
    }
    if (m.st === 2) {
      await hold([]);
      await wait(2500, 'minis');
      await tap('Space');
      await frame(4);
      continue;
    }
    hist.push({ t: Date.now(), s: { t: m.t, n: m.n, objs: m.objs } });
    while (hist.length > 2 && hist[1]!.t < Date.now() - REACT_MS) hist.shift();
    const inp: Input = { mx: 0, my: 0, act: false, hold: false, back: false, use: false, emote: false, cmd: null };
    const policy = POLICY[m.game];
    if (policy)
      policy({
        obs: hist[0]!.s,
        m: Object.assign({ goal: 0, stars: 0, msg: '', best: 0 }, m) as unknown as MiniRt,
        rng,
        mem,
        inp,
        oops: () => rng.next() < MISTAKE,
      });
    const keys: string[] = [];
    if (inp.mx > 0) keys.push('ArrowRight');
    if (inp.mx < 0) keys.push('ArrowLeft');
    if (inp.my > 0) keys.push('ArrowDown');
    if (inp.my < 0) keys.push('ArrowUp');
    if (inp.hold) keys.push('Space');
    await hold(keys);
    if (inp.act && Date.now() - lastPress > (PRESS_GAP / 60) * 1000) {
      lastPress = Date.now();
      if (!inp.hold) await tap('Space', 1);
    }
    await sleep(12);
  }
  await hold([]);
}

/** A talk box (in play, a scene or a mini-game): wait for the whole text, read it, press Space. */
async function readBox(l: Light): Promise<void> {
  doing('reading');
  const t = l.talk!;
  const n = words(t.text) + (t.choices ?? []).reduce((a, c) => a + words(c), 0);
  const t0 = Date.now();
  for (let k = 0; k < 400; k++) {
    const x = await light(page);
    if (!x?.talk || x.talk.text !== t.text || x.talk.shown >= x.talk.text.length) break;
    await sleep(50);
  }
  const left = readMs(n) - (Date.now() - t0);
  if (l.cut && !SLOW_SCENES) {
    if (left > 0) {
      sceneMs += left;
      const row = (spent[quest] ??= Object.fromEntries(KINDS.map((k) => [k, 0])) as Record<Kind, number>);
      row.reading += left;
    }
  } else if (left > 0) await sleep(left);
  await tap('Space');
  for (let k = 0; k < 30; k++) {
    const x = await light(page);
    if (!x?.talk || x.talk.text !== t.text || x.talk.i !== t.i) break;
    await sleep(30);
  }
}

/** Whatever menu is open: read the post, or close it. */
async function handleOverlay(l: Light): Promise<void> {
  const ov = l.overlay!;
  doing('menus');
  if (ov.ids && ov.open === null && ov.ids.length) {
    // the post: open each letter and read every page
    await menuKey('Space');
    return;
  }
  if (ov.open && ov.pages) {
    doing('reading');
    await sleep(readMs(words(ov.pages[ov.page ?? 0] ?? '')));
    await menuKey('Space');
    return;
  }
  await menuKey('KeyX');
}

/** Now and then she looks in the bag, at the map or in the quest book. */
async function lookAround(): Promise<void> {
  if (Date.now() - lastLook < nextLook) return;
  lastLook = Date.now();
  nextLook = between(150, 240) * 1000;
  const key = ['KeyE', 'KeyM', 'KeyQ'][Math.floor(rng.next() * 3)]!;
  await menuKey(key);
  await wait(between(3000, 6000), 'menus');
  for (let k = 0; k < 3; k++) {
    const l = await light(page);
    if (!l?.overlay) break;
    await menuKey('KeyX');
  }
}

// ---------------------------------------------------------------- the solver's side

function solverSplit(): Record<string, Record<Kind | 'total', number>> {
  // the same start the browser makes: a new game with this hero (the browser's random seed is its own)
  const b = new Bot(fresh(), {
    run: 3,
    maxSteps: 60 * 60 * 60 * 3,
    miniSecs: kidTimes(),
    letterWords: letterWords(),
    noTravel: true,
    stop: (x) => !!x.g.s.quests.ch1?.done,
  });
  b.run();
  const out: Record<string, Record<Kind | 'total', number>> = {};
  const mini = kidTimes();
  for (const q of QUESTS) {
    const t: Tally = b.tallies[q] ?? {
      walk: 0,
      wait: 0,
      words: 0,
      gather: 0,
      craft: 0,
      place: 0,
      mob: 0,
      fish: 0,
      minis: [],
      bosses: [],
    };
    const row = {
      walking: (t.walk / 60) * 1.5,
      reading: (t.words * 60) / WPM,
      menus: t.craft * COST.craft + t.place * COST.place,
      gathering: t.gather * COST.gather + t.fish * COST.fish,
      fighting: t.mob * COST.mob + t.bosses.reduce((n, id) => n + (mini[id] ?? COST.mini), 0),
      minis: t.minis.reduce((n, id) => n + (mini[id] ?? COST.mini), 0),
      waiting: t.wait / 60,
      total: 0,
    };
    row.total = row.walking + row.reading + row.menus + row.gathering + row.fighting + row.minis;
    for (const k in row) (row as Record<string, number>)[k] = (row as Record<string, number>)[k]! / 60;
    out[q] = row;
  }
  return out;
}

// ---------------------------------------------------------------- main

/** Build a copy of the game of its own and serve it (a long play must not reload when the source changes). */
async function ownServer(): Promise<Server> {
  if (args.includes('--url')) return startServer();
  const out = resolve(process.env.CLEAN_DEV_BUILDS ?? tmpdir(), 'wishing-star-playbot');
  mkdirSync(out, { recursive: true });
  console.log(`building the game into ${out}`);
  execFileSync('npx', ['vite', 'build', '--outDir', out, '--emptyOutDir', '--logLevel', 'warn'], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  copyFileSync(resolve(ROOT, 'src/data/personal.json'), resolve(out, 'personal.json'));
  const port = arg('--port', '4180');
  const child = spawn(
    'npx',
    ['vite', 'preview', '--outDir', out, '--port', port, '--strictPort', '--host', '127.0.0.1'],
    {
      cwd: ROOT,
      detached: true,
      stdio: 'ignore',
    },
  );
  const url = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) break;
    } catch {
      // not up yet
    }
    await sleep(200);
  }
  return {
    url,
    stop() {
      try {
        if (child.pid) process.kill(-child.pid, 'SIGTERM');
      } catch {
        // already gone
      }
    },
  };
}

async function main(): Promise<void> {
  const server = await ownServer();
  const L = await launch('chrome', { width: 1280, height: 720 });
  page = L.page;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e.message ?? e)));
  const t0 = Date.now();
  let lastSig = '';
  let lastSigT = Date.now();
  let stuck = '';
  try {
    await openTitle(page, server.url);
    await startNewGame(page, HERO);
    since = Date.now();
    kind = 'reading';
    for (;;) {
      if (Date.now() - t0 > CAP_MIN * 60000) {
        stuck = `time cap of ${CAP_MIN} minutes reached`;
        break;
      }
      const l = await light(page);
      if (!l) {
        await sleep(200);
        continue;
      }
      if (l.ch1) break;
      trace(
        `${l.mode}${l.overlay ? ' menu ' + l.overlay.kind : ''}${l.talk ? ' talk "' + l.talk.text.slice(0, 40) + '" ' + l.talk.shown : ''}${l.card ? ' card' : ''}`,
      );
      if (l.sig !== lastSig) {
        lastSig = l.sig;
        lastSigT = Date.now();
      } else if (Date.now() - lastSigT > 6 * 60000) {
        stuck = `nothing changed for 6 minutes: ${lastAction}`;
        break;
      }
      if (l.overlay) {
        await handleOverlay(l);
        continue;
      }
      if (l.talk && l.mode !== 'mini') {
        await readBox(l);
        continue;
      }
      switch (l.mode) {
        case 'card': {
          doing('reading');
          const c = l.card!;
          await sleep(Math.max(1000, readMs(words(c.title) + c.lines.reduce((n, x) => n + words(x), 0))));
          await tap('Space');
          await sleep(200);
          continue;
        }
        case 'cut':
          await wait(200, 'reading');
          continue;
        case 'mini':
          await playMini();
          continue;
        case 'fishing':
          if (l.fish === 2) {
            await sleep(REACT_MS);
            await tap('Space');
          } else await wait(100);
          continue;
        case 'build':
          await menuKey('KeyB');
          continue;
        case 'play':
          break;
        default:
          await wait(100);
          continue;
      }
      await lookAround();
      const p = await plan();
      if (!p) continue;
      trace(
        `plan [${p.cur}] ${p.why} -> ${p.act.kind}${p.act.cmd ? ' ' + JSON.stringify(p.act.cmd) : ''} path ${p.path.length}`,
      );
      account();
      quest = QUESTS.includes(p.cur as (typeof QUESTS)[number]) ? p.cur : quest;
      if (p.act.kind === 'done') {
        stuck = `the planner has nothing to do: ${bot.stuck ?? p.why}`;
        break;
      }
      if (p.blocked) {
        // someone stands in the way and stays still while she is close: go round, or step back and let them move
        await walkPath(p.path, l.area, p.door);
        const side = rng.next() < 0.5;
        await hold([side ? 'ArrowLeft' : 'ArrowRight']);
        await sleep(between(300, 600));
        await hold([side ? 'ArrowUp' : 'ArrowDown']);
        await sleep(between(300, 600));
        await hold([]);
        await wait(between(1000, 2000));
        continue;
      }
      if (p.path.length) {
        const ok = await walkPath(p.path, l.area, p.door);
        if (!ok) await wait(300);
        if (!ok || p.act.kind === 'idle') continue;
        // the copy walked further than the browser may have: let the next plan finish the walk
        const now = await light(page);
        const end = p.path[p.path.length - 1]!;
        if (!now || Math.floor(now.x) !== end.x || Math.floor(now.y) !== end.y) {
          trace(
            `not at the end of the path: at ${now?.x.toFixed(2)},${now?.y.toFixed(2)} ${now?.area}, end ${end.x},${end.y}`,
          );
          continue;
        }
      }
      await doAction(p);
    }
  } catch (e) {
    stuck = `error: ${(e as Error).message}`;
  } finally {
    account();
    await hold([]).catch(() => undefined);
    await L.close();
    server.stop();
  }

  // ---- the report
  const play: Record<string, Record<string, number>> = {};
  for (const q in spent) {
    const r = spent[q]!;
    const row: Record<string, number> = {};
    let tot = 0;
    for (const k of KINDS) {
      row[k] = r[k] / 60000;
      tot += r[k];
    }
    row.total = tot / 60000;
    play[q] = row;
  }
  const solver = solverSplit();
  const f = (n: number | undefined) => (n ?? 0).toFixed(1).padStart(6);
  console.log(`\nPLAY BOT (${HERO})  minutes per kind; play = this run in the browser, solver = the playtime formula`);
  console.log(
    `${'quest'.padEnd(10)}${'side'.padEnd(8)}${KINDS.map((k) => k.slice(0, 6).padStart(7)).join('')}${'total'.padStart(8)}  budget`,
  );
  const verdict: Record<string, string> = {};
  for (const q of QUESTS) {
    for (const [side, row] of [
      ['play', play[q]],
      ['solver', solver[q]],
    ] as const) {
      console.log(
        `${q.padEnd(10)}${side.padEnd(8)}${KINDS.map((k) => ` ${f(row?.[k])}`).join('')}  ${f(row?.total)}  ${side === 'play' ? BUDGET[q] : ''}`,
      );
    }
    const pt = play[q]?.total ?? 0;
    const off = (pt - BUDGET[q]!) / BUDGET[q]!;
    verdict[q] =
      `${pt.toFixed(1)} min against ${BUDGET[q]} (${off >= 0 ? '+' : ''}${Math.round(off * 100)}%): ${Math.abs(off) <= 0.4 ? 'within 40%' : 'outside 40%'}`;
    console.log(`  ${q}: ${verdict[q]}`);
  }
  if (unsupported.size) console.log(`menus the bot could not drive: ${[...unsupported].join(', ')}`);
  if (stuck) console.log(`STOPPED EARLY: ${stuck}`);
  if (errors.length) console.log(`page errors: ${errors.slice(0, 5).join(' | ')}`);
  writeFileSync(
    resolve(RESULTS, 'playbot.json'),
    `${JSON.stringify(
      {
        hero: HERO,
        when: new Date().toISOString(),
        finished: !stuck,
        stuck: stuck || null,
        realMinutes: (Date.now() - t0) / 60000,
        sceneReadingAddedMinutes: sceneMs / 60000,
        budget: BUDGET,
        verdict,
        play,
        solver,
        unsupported: [...unsupported],
        pageErrors: errors,
        assumptions: {
          readingWpm: WPM,
          pauseBeforeAction: '1-2 s',
          walkStops: '0.5-1.5 s every 8-15 s',
          looksInMenus: 'every 2.5-4 min for 3-6 s',
          menuKey: `${MENU_KEY_MS} ms`,
          reactionMs: Math.round(REACT_MS),
          mistakes: MISTAKE,
        },
      },
      null,
      1,
    )}\n`,
  );
  process.exit(stuck ? 1 : 0);
}

await main();
