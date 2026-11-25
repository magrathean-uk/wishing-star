// Players mode bot (package 61, D67): starts play-server --players on a built game with a fresh data folder and walks
// the player flow in headless Chrome (muted, TEST title): the list, a wrong password, Player 1's login, a minute of
// play, closing and opening the page (Continue carries on at the same place, on this computer and on a fresh one),
// Change player, and the hero's entry with Dad's words while Player 1 gets the built-in ones. Package 62f: two
// browsers for one player; the second plays on, the first comes back, is told its game moved on and carries on from
// the second's place, and the server's save is never replaced by the stale one.
// Run: node tools/bot/players.ts --dist <built game folder> [--port 4199] [--out <work folder>]
import { type ChildProcess, spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { launch, pressesToWalk, ROOT, shot, sleep, startNewGame, tap, waitFor, watch } from './lib.ts';

const arg = (n: string, d: string) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1]! : d);
const dist = resolve(arg('--dist', join(ROOT, 'dist')));
const port = Number(arg('--port', '4199'));
const work = resolve(arg('--out', '/Volumes/4TB/dev/work/jobs/wishing-star/61/players-run'));
const url = `http://127.0.0.1:${port}/`;
const DIR = 'players';
const fails: string[] = [];
const check = (ok: boolean, what: string) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) fails.push(what);
};

// ---- the server, on a copy of the release layout: server.js, game/ (the build), players-seed.json, data/
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
copyFileSync(join(ROOT, 'tools/release/server.js'), join(work, 'server.js'));
copyFileSync(join(ROOT, 'tools/release/room.js'), join(work, 'room.js'));
copyFileSync(join(ROOT, 'tools/release/players-seed.json'), join(work, 'players-seed.json'));
symlinkSync(dist, join(work, 'game'));
const server: ChildProcess = spawn(process.execPath, [join(work, 'server.js'), '--players'], {
  env: { ...process.env, WS_PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const stopServer = () => server.exitCode === null && server.kill('SIGTERM');
process.on('exit', stopServer);
await new Promise<void>((ok, fail) => {
  let out = '';
  const t = setTimeout(() => fail(new Error(`server did not start: ${out}`)), 15000);
  const on = (d: Buffer) => {
    out += String(d);
    if (out.includes('is running at')) {
      clearTimeout(t);
      ok();
    }
  };
  server.stdout!.on('data', on);
  server.stderr!.on('data', on);
});
const pw: Record<string, string> = {};
for (const line of readFileSync(join(work, 'data/PASSWORDS.txt'), 'utf8').trim().split('\n')) {
  const [who, p] = line.split(': ');
  pw[who === 'Top of the list' ? 'hero' : `p${who!.replace('Player ', '')}`] = p!;
}
const personal = JSON.parse(readFileSync(join(dist, 'personal.json'), 'utf8')) as { greeting1: string };

// ---- helpers in the page
const title = (page: Page) =>
  page.evaluate(() => {
    const t = (window as any).__game.game.scene.getScene('Title');
    const texts: string[] = [];
    const walk = (list: any[]) => {
      for (const o of list) {
        if (o.type === 'Text' && o.visible) texts.push(o.text as string);
        if (o.type === 'Container' && o.visible) walk(o.list);
      }
    };
    if (t.sys.isActive()) walk(t.children.list);
    return { mode: t.mode as string, items: (t.items ?? []) as string[], step: t.picker?.step ?? '', texts };
  });
async function atTitle(page: Page, mode: string): Promise<void> {
  await waitFor(page, () => String((window as any).__game?.scene ?? '').includes('Title'), 'the title scene', 30000);
  await page
    .locator('canvas')
    .first()
    .focus()
    .catch(() => undefined);
  await waitFor(
    page,
    new Function(
      `return (window.__game.game.scene.getScene('Title').mode === ${JSON.stringify(mode)})`,
    ) as () => boolean,
    `title mode ${mode}`,
    20000,
  );
  await sleep(500);
}
async function choose(page: Page, row: number): Promise<void> {
  for (let i = 0; i < 12; i++) {
    const sel = await page.evaluate(() => (window as any).__game.game.scene.getScene('Title').picker.sel as number);
    if (sel === row) break;
    await tap(page, sel < row ? 'ArrowDown' : 'ArrowUp');
  }
  await tap(page, 'Space');
}
async function typePassword(page: Page, p: string): Promise<void> {
  for (const ch of p) await tap(page, ch, 40, 60);
  await tap(page, 'Enter');
}
async function menuTo(page: Page, item: string): Promise<void> {
  for (let i = 0; i < 6; i++) {
    const on = await page.evaluate(() => {
      const t = (window as any).__game.game.scene.getScene('Title');
      return t.items[t.sel] as string;
    });
    if (on === item) break;
    await tap(page, 'ArrowDown');
  }
  await tap(page, 'Space');
}
const where = (page: Page) =>
  page.evaluate(() => {
    const s = (window as any).__game.g.s;
    return { area: s.area as string, x: s.x as number, y: s.y as number, ticks: s.ticks as number };
  });
const serverSave = () => {
  try {
    return JSON.parse(readFileSync(join(work, 'data/saves/p1.json'), 'utf8')) as {
      n: number;
      dev: string;
      save: { area: string; x: number; y: number; ticks: number };
    };
  } catch {
    return null;
  }
};
const CREDIT = 'A Magrathean UK production -- https://magrathean.uk';
const KEYS = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'];
async function walk(page: Page, ms: number): Promise<void> {
  const t0 = Date.now();
  for (let i = 0; Date.now() - t0 < ms; i++) {
    await page.keyboard.down(KEYS[i % 4]!);
    await sleep(600);
    await page.keyboard.up(KEYS[i % 4]!);
    if (await page.evaluate(() => !!(window as any).__game.g.rt.talk || !!(window as any).__game.g.rt.card))
      await tap(page, 'Space', 60, 300);
  }
}
/** Pause menu: Save now, then close the menu. */
async function saveFromMenu(page: Page): Promise<void> {
  await tap(page, 'KeyP', 60, 600);
  await tap(page, 'ArrowDown', 60, 200);
  await tap(page, 'Space', 60, 400);
  await tap(page, 'KeyP', 60, 600);
}
const inWorld = (page: Page) =>
  waitFor(page, () => !!(window as any).__game?.g && String((window as any).__game.scene).includes('World'), 'world');

try {
  // 1. The list, a wrong password, Player 1's login
  const a = await launch('chromium', { width: 1920, height: 1080 });
  const w = watch(a.page);
  await a.page.goto(url);
  await atTitle(a.page, 'who');
  let t = await title(a.page);
  check(t.texts.includes('Who is playing?') && t.texts.some((x) => x.endsWith('Player 10')), 'the player list shows');
  check(t.texts.includes(CREDIT), 'the credit shows on the list');
  check(await a.page.title().then((x) => x.startsWith('TEST')), 'the page title starts with TEST');
  await shot(a.page, DIR, '01-list');
  await choose(a.page, 1);
  await waitFor(a.page, () => (window as any).__game.game.scene.getScene('Title').picker.step === 'pass', 'password');
  const wrong = pw.p1 === 'zzzz' ? 'yyyy' : 'zzzz';
  await typePassword(a.page, wrong);
  await sleep(1200);
  t = await title(a.page);
  check(t.texts.includes('Not quite. Try again.') && t.mode === 'who', 'a wrong password is refused');
  await typePassword(a.page, pw.p1!.slice(0, 3));
  await shot(a.page, DIR, '02-password');
  await tap(a.page, 'Backspace');
  await typePassword(a.page, pw.p1!.slice(2));
  await atTitle(a.page, 'menu');
  t = await title(a.page);
  check(t.items.join() === 'Play,Play together,Options,Change player', `menu after login: ${t.items.join(', ')}`);
  check(t.texts.includes('Player 1 is playing.'), 'the title shows who is playing');
  check(t.texts.includes(CREDIT) && t.texts.includes('Merry Christmas!'), 'Player 1: credit and built-in greeting');
  check(
    (await a.page.evaluate(() => fetch('personal.json').then((r) => r.status))) === 401,
    'Player 1 gets no personal.json',
  );
  await shot(a.page, DIR, '03-title-player1');

  // 2. A new game and a minute of play
  await startNewGame(a.page, 'koala');
  await pressesToWalk(a.page);
  const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'];
  const t0 = Date.now();
  let creditSeen = false;
  for (let i = 0; Date.now() - t0 < 60000; i++) {
    await a.page.keyboard.down(keys[i % 4]!);
    await sleep(700);
    await a.page.keyboard.up(keys[i % 4]!);
    // a talk or a card on the way: Space through it
    if (await a.page.evaluate(() => !!(window as any).__game.g.rt.talk || !!(window as any).__game.g.rt.card))
      await tap(a.page, 'Space', 60, 300);
    if (!creditSeen)
      creditSeen = await a.page.evaluate((c) => {
        const ui = (window as any).__game.game.scene.getScene('UI');
        return (ui.children.list as any[]).some((o) => o.type === 'Text' && o.text === c && o.visible && o.alpha < 0.7);
      }, CREDIT);
  }
  check(creditSeen, 'the faint credit shows in play');
  await shot(a.page, DIR, '04-play-player1');
  // Save now from the pause menu, so the place she left is the place saved; then close the page
  await sleep(6000);
  await tap(a.page, 'KeyP', 60, 600);
  await tap(a.page, 'ArrowDown', 60, 200);
  await tap(a.page, 'Space', 60, 400);
  await shot(a.page, DIR, '05-saved');
  const before = await where(a.page);
  await sleep(1000);
  await a.page.close(); // pagehide sends anything still waiting
  await sleep(1500);
  const saved = serverSave();
  check(!!saved && saved.n > 1 && saved.save.ticks > 0, `the server holds Player 1's save (n ${saved?.n})`);

  // 3. Open the page again on the same computer: no password, Continue carries on at the same place
  const page2 = await a.ctx.newPage();
  await page2.goto(url);
  await atTitle(page2, 'menu');
  t = await title(page2);
  check(t.items[0] === 'Continue', `same computer: no password, Continue first (${t.items.join(', ')})`);
  await tap(page2, 'Space');
  await waitFor(
    page2,
    () => !!(window as any).__game?.g && String((window as any).__game.scene).includes('World'),
    'world',
  );
  const after = await where(page2);
  const near = (p: typeof after, q: typeof after) => p.area === q.area && Math.hypot(p.x - q.x, p.y - q.y) < 3;
  check(
    near(after, before) && after.ticks >= saved!.save.ticks,
    `same place again: ${after.area} ${after.x.toFixed(1)},${after.y.toFixed(1)} (left at ${before.x.toFixed(1)},${before.y.toFixed(1)})`,
  );

  // 4. Change player: back to the list, the login is gone
  await page2.goto(url);
  await atTitle(page2, 'menu');
  await menuTo(page2, 'Change player');
  await atTitle(page2, 'who');
  check((await page2.evaluate(() => localStorage.getItem('ws_token'))) === null, 'Change player logs out');

  // 5. Her entry: Dad's words, no credit
  await choose(page2, 0);
  await typePassword(page2, pw.hero!);
  await atTitle(page2, 'menu');
  t = await title(page2);
  check(t.texts.includes(personal.greeting1), "the hero's entry shows Dad's greeting");
  check(!t.texts.includes(CREDIT), "no credit on the hero's entry");
  await shot(page2, DIR, '06-title-hero');
  await a.close();

  // 6. A fresh computer: Player 1 logs in and Continue carries on from the server's save
  const b = await launch('chromium', { width: 1920, height: 1080 });
  await b.page.goto(url);
  await atTitle(b.page, 'who');
  await choose(b.page, 1);
  await typePassword(b.page, pw.p1!);
  await atTitle(b.page, 'menu');
  await tap(b.page, 'Space');
  await waitFor(
    b.page,
    () => !!(window as any).__game?.g && String((window as any).__game.scene).includes('World'),
    'world',
  );
  const fresh = await where(b.page);
  const s2 = serverSave()!.save;
  check(
    near(fresh, { ...s2 }),
    `fresh computer: the server's place (${fresh.area} ${fresh.x.toFixed(1)},${fresh.y.toFixed(1)})`,
  );

  // 7. Two browsers, one player (62f): C plays on; B comes back, gets the card and carries on from C's place
  const c = await launch('chromium', { width: 1920, height: 1080 });
  await c.page.goto(url);
  await atTitle(c.page, 'who');
  await choose(c.page, 1);
  await typePassword(c.page, pw.p1!);
  await atTitle(c.page, 'menu');
  await tap(c.page, 'Space');
  await inWorld(c.page);
  await walk(c.page, 15000);
  await sleep(5500);
  await saveFromMenu(c.page);
  await sleep(2500);
  const cDev = await c.page.evaluate(() => localStorage.getItem('ws_device'));
  const cPlace = await where(c.page);
  await c.close();
  await sleep(1000);
  const sC = serverSave()!;
  check(
    sC.dev === cDev && near(cPlace, { ...sC.save }),
    `the second browser's game is on the server (n ${sC.n}, ${sC.dev === cDev ? 'its device' : 'another device'})`,
  );
  await walk(b.page, 4000);
  await sleep(5500);
  await saveFromMenu(b.page);
  await waitFor(
    b.page,
    () => {
      const ui = (window as any).__game.game.scene.getScene('UI');
      return (ui.children.list as any[]).some(
        (o) => o.type === 'Container' && o.list.some((x: any) => x.type === 'Text' && x.text === 'Your game moved on.'),
      );
    },
    'the moved-on card',
    30000,
  );
  check(true, 'the first browser comes back and shows "Your game moved on."');
  await shot(b.page, DIR, '07-moved-on');
  const sStill = serverSave()!;
  check(sStill.n === sC.n && sStill.dev === cDev, `the stale game did not replace the server's (n ${sStill.n})`);
  check(
    !!(await b.page.evaluate(() => localStorage.getItem('ws_pl_p1_fork'))),
    "the first browser's own play is kept aside",
  );
  await tap(b.page, 'Space');
  await sleep(1500);
  await inWorld(b.page);
  const back = await where(b.page);
  check(
    near(back, { ...sC.save }),
    `carries on from the second's place: ${back.area} ${back.x.toFixed(1)},${back.y.toFixed(1)} (C left ${cPlace.x.toFixed(1)},${cPlace.y.toFixed(1)})`,
  );
  await shot(b.page, DIR, '08-carried-on');
  await walk(b.page, 3000);
  await sleep(5500);
  await saveFromMenu(b.page);
  await sleep(2500);
  const sB = serverSave()!;
  check(sB.n > sC.n && sB.dev !== cDev, `uploads go again after the card (n ${sB.n})`);
  await b.close();
  check(!w.page.length, `no page errors${w.page.length ? `: ${w.page[0]}` : ''}`);
} catch (err) {
  fails.push(String((err as Error).message ?? err));
  console.log(`  FAIL ${(err as Error).message}`);
} finally {
  stopServer();
}
console.log(fails.length ? `PLAYERS FAIL: ${fails.length}` : 'PLAYERS OK');
process.exit(fails.length ? 1 : 0);
