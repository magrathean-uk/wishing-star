// Package 73a: pictures of the lighthouse lamp (I2), looking out (I3) and a room's find with the journal line (I13),
// played with real key presses in a muted, headless browser on our own build. It starts from the late build 8 save
// ("full"), sets up the spot (where she stands, the time: the one shortcut), then uses only keys.
// Run: node tests/shots-lamp.ts --url http://127.0.0.1:4200/ --out test-results/73a
import fs from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { launch, sleep } from '../tools/bot/lib.ts';

const arg = (k: string) => (process.argv.includes(`--${k}`) ? process.argv[process.argv.indexOf(`--${k}`) + 1] : '');
const GAME = arg('url') || 'http://127.0.0.1:4200/';
const OUT = resolve(arg('out') || 'test-results/73a');
const B8: Record<string, unknown> = JSON.parse(
  fs.readFileSync(new URL('./fixtures/saves-b8.data', import.meta.url), 'utf8'),
);
fs.mkdirSync(OUT, { recursive: true });

const G = (page: Page, fn: string) => page.evaluate(`(() => { const g = window.__game.g; ${fn} })()`);
async function press(page: Page, key: string, ms = 80): Promise<void> {
  await page.keyboard.down(key);
  await sleep(ms);
  await page.keyboard.up(key);
  await sleep(250);
}
async function free(page: Page): Promise<void> {
  for (let i = 0; i < 30; i++) {
    await sleep(450);
    const busy = await G(page, `const rt = g.rt; return rt.mode !== 'play' || !!(rt.talk || rt.card || rt.cut);`);
    if (!busy) break;
    await press(page, 'Space');
  }
  await sleep(300);
}
async function debug(page: Page, what: string, a?: string | number): Promise<void> {
  await page.evaluate(([w, x]) => (window as any).__game.debug(w, x), [what, a] as [
    string,
    string | number | undefined,
  ]);
  await sleep(300);
}
/** Go to a room by one of its places, then stand on a tile facing a way. */
async function standIn(page: Page, place: string, x: number, y: number, dir: string): Promise<void> {
  await debug(page, 'tp', place);
  await free(page);
  await G(page, `g.s.x = g.rt.px = ${x}; g.s.y = g.rt.py = ${y}; g.s.dir = '${dir}'; g.rt.mobs.length = 0;`);
  await sleep(900);
}
async function snap(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  const line = await G(
    page,
    `const s = g.s; return s.area + ' ' + s.x.toFixed(1) + ',' + s.y.toFixed(1) + ' ' + g.rt.mode + ' t' + Math.round(s.time) + ' lamp ' + s.counts.lamp + ' look ' + (g.rt.look ? g.rt.look.id : '-') + ' gems ' + s.emeralds;`,
  );
  console.log(`shot ${name}: ${line}`);
}

const { page, close } = await launch('chromium', { width: 1280, height: 720 });
try {
  await page.addInitScript((json: string) => {
    if (localStorage.getItem('ws_73a')) return;
    localStorage.setItem('ws_73a', '1');
    localStorage.setItem('ws_save_1', json);
    localStorage.setItem('ws_slot', '1');
  }, JSON.stringify(B8.full));
  await page.goto(GAME, { waitUntil: 'load' });
  for (let i = 0; i < 80; i++) {
    const sc = await page.evaluate(() => String((window as any).__game?.scene ?? ''));
    if (sc.includes('Title')) break;
    await sleep(250);
  }
  await sleep(800);
  await press(page, 'Space');
  await free(page);

  // I2: the lamp at dusk: "Light", then Space, its line and the glow
  await debug(page, 'time', 600);
  await standIn(page, 'in_lamp', 4.5, 4.5, 'up');
  await snap(page, '01-lamp-off-hint-light');
  await press(page, 'Space');
  await sleep(700);
  await snap(page, '02-lamp-on-line');
  await free(page);
  await snap(page, '03-lamp-room-glow-no-hint');
  // I3 from the lamp room at night with the lamp on: the island from above, with the beam
  await debug(page, 'time', 700);
  await standIn(page, 'in_lamp', 4.5, 1.5, 'up');
  await press(page, 'Space');
  await sleep(1200);
  await snap(page, '04-lookout-lamp-night-beam');
  await sleep(3500);
  await snap(page, '05-after-look-its-line');
  await free(page);
  // the beam over the bay at night, twice a second and a half apart (it sweeps)
  await debug(page, 'tp', 'hamm_beach');
  await free(page);
  await G(page, `g.rt.mobs.length = 0;`);
  await sleep(1500);
  await snap(page, '06-beam-over-bay-night');
  await sleep(1500);
  await snap(page, '07-beam-later');
  // I3 by day from Dad's lookout: Space, the picture, a key ends it sooner
  await debug(page, 'time', 200);
  await standIn(page, 'in_lookout', 5.5, 3.5, 'up');
  await press(page, 'Space');
  await sleep(900);
  await snap(page, '08-lookout-telescope-day');
  await press(page, 'ArrowLeft');
  await sleep(600);
  await snap(page, '09-key-ended-it');
  await free(page);
  // I13: the find in the cafe (a cake) and in the dollhouse (5 emeralds)
  await standIn(page, 'in_cafe', 15.5, 6.5, 'right');
  await snap(page, '10-cafe-find-hint');
  await press(page, 'Space');
  await sleep(500);
  await snap(page, '11-cafe-find-taken');
  await free(page);
  await standIn(page, 'in_doll', 3.5, 2.5, 'up');
  await press(page, 'Space');
  await sleep(500);
  await snap(page, '12-doll-find-5-emeralds');
  await free(page);
  // the journal's Places page: "Rooms n of 20"
  await press(page, 'KeyK');
  await sleep(700);
  for (let i = 0; i < 3; i++) await press(page, 'ArrowRight');
  await sleep(500);
  await snap(page, '13-journal-rooms-line');
  await press(page, 'KeyX');
} finally {
  await close();
}
