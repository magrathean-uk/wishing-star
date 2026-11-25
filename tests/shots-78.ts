// Package 78: pictures of the lamp room by day and by dusk (1), where the cat lies indoors (4) and the red edge marker
// for a hit from off screen (7). Muted, headless chromium on our own build; the save is the late build 8 ("full").
// Setup (where she stands, the time, the attacker's warn event) is the one shortcut; everything else is the game.
// Run: node tests/shots-78.ts --url http://127.0.0.1:4203/ --out test-results/78
import fs from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { launch, sleep } from '../tools/bot/lib.ts';

const arg = (k: string) => (process.argv.includes(`--${k}`) ? process.argv[process.argv.indexOf(`--${k}`) + 1] : '');
const GAME = arg('url') || 'http://127.0.0.1:4203/';
const OUT = resolve(arg('out') || 'test-results/78');
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
    `const s = g.s; return s.area + ' ' + s.x.toFixed(1) + ',' + s.y.toFixed(1) + ' t' + Math.round(s.time) + ' lamp ' + s.counts.lamp + ' day ' + s.day;`,
  );
  console.log(`shot ${name}: ${line}`);
}

const { page, close } = await launch('chromium', { width: 1280, height: 720 });
try {
  await page.addInitScript((json: string) => {
    if (localStorage.getItem('ws_78')) return;
    localStorage.setItem('ws_78', '1');
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

  // 1: the lamp is lit; by day its room glows faintly, at dusk fully
  await G(page, `g.s.counts.lamp = g.s.day;`);
  await debug(page, 'time', 200);
  await standIn(page, 'in_lamp', 4.5, 4.5, 'up');
  await snap(page, '01-lamp-room-day-faint');
  await debug(page, 'time', 560);
  await sleep(800);
  await snap(page, '02-lamp-room-dusk-full');

  // 4: her cat comes in with her and lies on open floor nearest the middle, off the door
  await debug(page, 'time', 300);
  await G(
    page,
    `const s = g.s; if (!s.animals.some((a) => a.pet && a.kind === 'cat')) {
      s.animals.push({ k: s.nextK++, kind: 'cat', pet: true, pen: 'pet', area: s.area, x: s.x + 1, y: s.y, hx: s.x + 1, hy: s.y });
      s.pets.push({ kind: 'cat', name: 'Cat' });
    }`,
  );
  await debug(page, 'tp', 'cottage_exit');
  await free(page);
  await G(
    page,
    `const c = g.s.animals.find((a) => a.pet && a.kind === 'cat'); c.area = g.s.area; c.x = g.s.x + 1; c.y = g.s.y;`,
  );
  await sleep(9000);
  await snap(page, '03-cat-lies-near-the-middle');

  // 7: a hit from off screen: the warn event at the attacker's place far to the east, then the marker for about a second
  await debug(page, 'tp', 'sign_square');
  await free(page);
  await G(page, `g.ev.push({ t: 'fx', id: 'warn', x: g.s.x + 22, y: g.s.y + 4, item: 'hit' });`);
  await sleep(250);
  await snap(page, '04-hit-from-off-screen-marker');
  await sleep(1400);
  await snap(page, '05-marker-gone-after-a-second');
  // and nothing when the attacker is on screen
  await G(page, `g.ev.push({ t: 'fx', id: 'warn', x: g.s.x + 3, y: g.s.y });`);
  await sleep(250);
  await snap(page, '06-attacker-on-screen-no-marker');
} finally {
  await close();
}
