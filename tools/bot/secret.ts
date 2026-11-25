// Package 70: the secret show played headless with real keys from a finished-game save, a picture at each step.
// Run: node tools/bot/secret.ts --url http://127.0.0.1:4195/ --save <finished save .json> [--out test-results/secret]
// Long trips between the island's corners use the debug teleport the smoke run uses (the solver and the unit test
// prove the walking); every talk, pick-up, craft, game and fight is done with the keyboard. Muted, no window.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { debug, heroPos, launch, mode, openTitle, RESULTS, shot, sleep, tap, walkTo } from './lib.ts';

const arg = (k: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const url = arg('url') ?? 'http://127.0.0.1:4195/';
const out = resolve(arg('out') ?? resolve(RESULTS, 'secret'));
const saveFile = arg('save');
if (!saveFile) throw new Error('--save <file> is needed');
mkdirSync(out, { recursive: true });

const log: string[] = [];
const note = (s: string) => {
  log.push(s);
  console.log(s);
};
let n = 0;
const pic = async (page: Page, name: string) => shot(page, out, `${String(++n).padStart(2, '0')}-${name}`);

const state = (page: Page) =>
  page.evaluate(() => {
    const g = (window as any).__game.g;
    const q = g.s.quests.secret;
    return {
      mode: g.rt.mode as string,
      step: q ? (q.done ? 99 : q.step) : -1,
      card: !!g.s.flags['card:secret'],
      time: g.s.time as number,
      title: document.title,
    };
  });

/** Press Space through talk, cards and scenes until she can walk again, with pictures along the way. */
async function through(page: Page, name: string, every = 3): Promise<void> {
  for (let i = 0; i < 80; i++) {
    const md = await mode(page);
    // a mini-game is played by its own loop
    if (md === 'play' || md === 'mini') break;
    if (i % every === 0) await pic(page, `${name}-${i}`);
    await tap(page, 'Space', 60, 450);
  }
}

/** Walk to a named place with the arrow keys, after a teleport near it. */
async function goNear(page: Page, placeId: string, dx = 0, dy = 2): Promise<void> {
  const p = await page.evaluate((id) => {
    const g = (window as any).__game.g;
    for (const a of Object.values(g.c.areas) as any[]) if (a.places[id]) return { ...a.places[id] };
    return null;
  }, placeId);
  if (!p) throw new Error(`no place ${placeId}`);
  await debug(page, 'tp', placeId);
  await through(page, 'tp', 99);
  // step off and walk back with the keys, so she arrives the way she would
  await walkTo(page, p.x + 0.5 + dx, p.y + 0.5 + dy, 0.6, 8000);
}

/** Walk up to a character (each side in turn), face them and press Space until the talk or their game starts. */
async function talk(page: Page, who: string, name: string, every = 1): Promise<void> {
  const sides: [number, number, string][] = [
    [0, 1.1, 'ArrowUp'],
    [1.1, 0, 'ArrowLeft'],
    [-1.1, 0, 'ArrowRight'],
    [0, -1.1, 'ArrowDown'],
  ];
  for (const [dx, dy, face] of sides) {
    const npc = await page.evaluate((id) => {
      const n = (window as any).__game.g.rt.npcs.find((x: any) => x.id === id);
      return n ? { x: n.x, y: n.y } : null;
    }, who);
    if (!npc) throw new Error(`${who} is not on the screen`);
    await walkTo(page, npc.x + dx, npc.y + dy, 0.3, 6000);
    await tap(page, face, 30, 120);
    await pic(page, `${name}-before`);
    await tap(page, 'Space', 60, 500);
    const md = await mode(page);
    note(`${name}: Space from ${face} side gives mode ${md}`);
    if (md !== 'play') break;
  }
  await through(page, name, every);
}

async function keepy(page: Page): Promise<void> {
  const held = new Set<string>();
  const hold = async (k: string | null) => {
    for (const h of [...held])
      if (h !== k) {
        await page.keyboard.up(h);
        held.delete(h);
      }
    if (k && !held.has(k)) {
      await page.keyboard.down(k);
      held.add(k);
    }
  };
  for (let i = 0; i < 30 && !(await page.evaluate(() => !!(window as any).__game.g.rt.mini)); i++) await sleep(100);
  const t0 = Date.now();
  let shotAt = 0;
  let loops = 0;
  let last = '';
  while (Date.now() - t0 < 180000) {
    const m = await page.evaluate(() => {
      const g = (window as any).__game.g;
      const mm = g.rt.mini;
      return mm ? { n: [...mm.n], st: mm.st, score: mm.score, stars: mm.stars } : null;
    });
    loops++;
    if (!m) break;
    last = `st ${m.st} score ${m.score} stars ${m.stars}`;
    // the how-to card first: Space starts the round
    if (m.st === 0) {
      if (loops === 1) await pic(page, 'keepy-start');
      await tap(page, 'Space', 60, 300);
      continue;
    }
    if (m.st !== 1 && m.stars > 0) {
      await hold(null);
      await pic(page, 'keepy-result');
      await tap(page, 'Space', 60, 600);
      continue;
    }
    const [hx, bx, by] = m.n as number[];
    const d = bx! - hx!;
    await hold(Math.abs(d) > 0.25 ? (d > 0 ? 'ArrowRight' : 'ArrowLeft') : null);
    if (by! > 4.7 && Math.abs(d) < 0.9) await tap(page, 'Space', 40, 0);
    if (m.score >= 6 && !shotAt) shotAt = await pic(page, 'keepy').then(() => 1);
    await sleep(16);
  }
  await hold(null);
  note(`keepy: ${loops} looks, last ${last}, ${Math.round((Date.now() - t0) / 1000)} s`);
}

async function fight(page: Page): Promise<void> {
  const t0 = Date.now();
  let shots = 0;
  while (Date.now() - t0 < 120000) {
    const st = await state(page);
    if (st.step !== 7) break;
    if (st.mode !== 'play') {
      await tap(page, 'Space', 60, 300);
      continue;
    }
    const foe = await page.evaluate(() => {
      const g = (window as any).__game.g;
      const ms = g.rt.mobs.filter((m: any) => !m.gone && !m.calm);
      let best: any = null;
      for (const m of ms) {
        const d = Math.hypot(m.x - g.s.x, m.y - g.s.y);
        if (!best || d < best.d) best = { x: m.x, y: m.y, d };
      }
      return best;
    });
    if (!foe) {
      await sleep(200);
      continue;
    }
    if (foe.d > 1.1) await walkTo(page, foe.x, foe.y, 1, 1500);
    const p = await heroPos(page);
    const dx = foe.x - p.x;
    const dy = foe.y - p.y;
    await tap(
      page,
      Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'ArrowRight' : 'ArrowLeft') : dy > 0 ? 'ArrowDown' : 'ArrowUp',
      40,
      20,
    );
    await tap(page, 'Space', 60, 120);
    if (shots < 3 && Date.now() - t0 > shots * 2500) {
      await pic(page, `fight-${shots}`);
      shots++;
    }
  }
}

async function main(): Promise<void> {
  const { page, close } = await launch('chromium', { width: 1280, height: 720 });
  try {
    const j = JSON.parse(readFileSync(resolve(saveFile!), 'utf8'));
    await page.addInitScript(
      (json: string) => {
        if (localStorage.getItem('ws_secret_seeded')) return;
        localStorage.setItem('ws_secret_seeded', '1');
        localStorage.setItem('ws_save_1', json);
        localStorage.setItem('ws_slot', '1');
      },
      JSON.stringify(j.save ?? j),
    );
    await openTitle(page, url);
    await sleep(1500);
    await tap(page, 'Space', 60, 600);
    for (let i = 0; i < 40 && !(await page.evaluate(() => !!(window as any).__game?.g)); i++) {
      await tap(page, 'Space', 60, 400);
    }
    await through(page, 'start', 99);
    let st = await state(page);
    note(`loaded: secret step ${st.step}, card ${st.card}, title "${st.title}"`);
    await pic(page, 'before-morning');
    // the first morning after the credits: the day runs out
    // mornings pass (the day runs out) until the secret's card: an arrival or a visitor may take a morning first
    for (let day = 1; day <= 5 && !(await state(page)).card; day++) {
      const d0 = await page.evaluate(() => (window as any).__game.g.s.day as number);
      await debug(page, 'time', 838);
      for (let i = 0; i < 40 && (await page.evaluate(() => (window as any).__game.g.s.day as number)) === d0; i++)
        await sleep(100);
      let seen = false;
      for (let i = 0; i < 50 && !seen; i++) {
        await sleep(200);
        seen = await page.evaluate(() => (window as any).__game.game.scene.getScene('UI').cur?.m.kind === 'card');
      }
      await sleep(500);
      const who = await page.evaluate(() => (window as any).__game.game.scene.getScene('UI').cur?.m.who ?? '');
      note(`morning ${day}: card on screen ${seen} (${who})`);
      await pic(page, `morning-card-${day}`);
      await tap(page, 'Space', 60, 600);
      await through(page, 'morning', 99);
    }
    st = await state(page);
    note(`morning: card ${st.card}, secret step ${st.step}`);
    await pic(page, 'goal-line');

    // 1. Rumi by the waterfall, and her mic
    await goNear(page, 'secret_rumi', 0, 3);
    await pic(page, 'waterfall');
    await talk(page, 'rumi', 'rumi');
    const mic = await page.evaluate(() => {
      const g = (window as any).__game.g;
      const d = g.s.drops.find((x: any) => x.id === 'mic');
      return d ? { x: d.x, y: d.y } : null;
    });
    if (mic) {
      await walkTo(page, mic.x, mic.y, 0.4, 8000);
      await pic(page, 'mic');
      await tap(page, 'Space', 60, 500);
    }
    await through(page, 'mic-found', 1);
    note(`after Rumi: step ${(await state(page)).step}`);

    // 2. Mira by the sea, then 3 light sticks at a table
    await goNear(page, 'secret_mira', 0, 3);
    await talk(page, 'mira', 'mira');
    note(`after Mira: step ${(await state(page)).step}`);
    await debug(page, 'give', 'stick:2');
    await debug(page, 'give', 'torch:2');
    await goNear(page, 'grandad', 0, 2);
    await tap(page, 'ArrowUp', 60, 200);
    await tap(page, 'KeyE', 60, 700);
    const idx = await page.evaluate(() => {
      const o = (window as any).__game.game.scene.getScene('UI').overlay;
      const list: string[] = (o?.list ?? o?.rows ?? []).map((r: any) => r.id ?? r.recipe ?? r);
      return { at: list.indexOf('light_stick'), sel: o?.sel ?? 0, n: list.length };
    });
    note(`recipe list: light_stick at ${idx.at} of ${idx.n}, cursor ${idx.sel}`);
    for (let i = idx.sel; i < idx.at; i++) await tap(page, 'ArrowDown', 40, 60);
    await pic(page, 'craft-list');
    await tap(page, 'Space', 60, 600);
    await pic(page, 'crafted');
    const menu = () => page.evaluate(() => !!(window as any).__game.game.scene.getScene('UI').overlay);
    for (let i = 0; i < 6 && ((await menu()) || (await mode(page)) !== 'play'); i++) await tap(page, 'KeyX', 60, 400);
    await through(page, 'craft-done', 1);
    note(`after the craft: step ${(await state(page)).step}`);

    // 3. Zoey on the far plains, and a round of Keepy Uppy
    await goNear(page, 'secret_zoey', 0, 3);
    await talk(page, 'zoey', 'zoey');
    await talk(page, 'zoey', 'zoey-game', 99);
    await keepy(page);
    await through(page, 'after-keepy', 1);
    note(`after Zoey: step ${(await state(page)).step}, time ${(await state(page)).time}`);

    // 4. The show by the orange trees, at night
    await goNear(page, 'secret_stage', 0, 3);
    await walkTo(page, 99.5, 48.8, 0.8, 6000);
    await through(page, 'show-start', 1);
    await pic(page, 'show-mobs');
    await fight(page);
    await through(page, 'show-end', 1);
    st = await state(page);
    note(`after the show: secret ${st.step === 99 ? 'done' : `step ${st.step}`}`);
    await pic(page, 'after');
    // the three in the Journal
    await tap(page, 'KeyK', 60, 900);
    await pic(page, 'journal');
    await tap(page, 'Escape', 60, 400);
    const errs = await page.evaluate(() => (window as any).__game.errors as string[]);
    note(`page errors: ${errs.length}${errs.length ? ` (${errs.slice(0, 3).join(' | ')})` : ''}`);
  } finally {
    writeFileSync(resolve(out, 'log.txt'), log.join('\n') + '\n');
    await close();
  }
}

await main();
