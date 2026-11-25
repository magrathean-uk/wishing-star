// Package 73b: pictures of the post at the Post Office (the list and one friend's note, never a page of Dad's words),
// the cafe counter's shop, a quiz question of each kind and a planted pot. A muted, headless browser on our own build,
// from a build 8 save; the page's clock says 25 December 2026 so the whole December post is there.
// Run: node tests/shots-73b.ts --url http://127.0.0.1:4201/ --out test-results/73b
import fs from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { launch, sleep } from '../tools/bot/lib.ts';

const arg = (k: string) => (process.argv.includes(`--${k}`) ? process.argv[process.argv.indexOf(`--${k}`) + 1] : '');
const GAME = arg('url') || 'http://127.0.0.1:4201/';
const OUT = resolve(arg('out') || 'test-results/73b');
const B8: Record<string, unknown> = JSON.parse(
  fs.readFileSync(new URL('./fixtures/saves-b8.data', import.meta.url), 'utf8'),
);
fs.mkdirSync(OUT, { recursive: true });
const notes: string[] = [];

const G = (page: Page, fn: string) => page.evaluate(`(() => { const g = window.__game.g; ${fn} })()`);
async function press(page: Page, key: string, ms = 80): Promise<void> {
  await page.keyboard.down(key);
  await sleep(ms);
  await page.keyboard.up(key);
  await sleep(300);
}
async function free(page: Page): Promise<void> {
  for (let i = 0; i < 30; i++) {
    await sleep(450);
    const busy = await page.evaluate(() => {
      const rt = (window as any).__game?.g?.rt;
      return rt?.mode !== 'play' || !!(rt?.talk || rt?.card || rt?.cut);
    });
    if (!busy) break;
    await press(page, 'Space');
  }
  await sleep(400);
}
async function debug(page: Page, what: string, a?: string | number): Promise<void> {
  await page.evaluate(([w, x]) => (window as any).__game.debug(w, x), [what, a] as [
    string,
    string | number | undefined,
  ]);
  await sleep(300);
}
async function snap(page: Page, name: string, what = ''): Promise<void> {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  const line = await G(page, `return g.s.area + ' ' + g.s.x.toFixed(1) + ',' + g.s.y.toFixed(1) + ' ' + g.rt.mode;`);
  console.log(`shot ${name} (${line}) ${what}`);
  notes.push(`${name}: ${line} ${what}`);
}
/** Into a room by its place, then stand at (x, y) facing `dir`. */
async function stand(page: Page, place: string, x: number, y: number, dir: string): Promise<void> {
  await debug(page, 'tp', place);
  await free(page);
  await G(page, `g.s.x = g.rt.px = ${x}; g.s.y = g.rt.py = ${y}; g.s.dir = '${dir}'; g.rt.mobs.length = 0;`);
  await sleep(900);
}

const { page, close } = await launch('chromium', { width: 1280, height: 720 });
try {
  await page.addInitScript((json: string) => {
    // the page's clock: 25 December 2026, 9 in the morning (the game's own timing uses performance.now)
    const Real = Date;
    const off = new Real(2026, 11, 25, 9, 0, 0).getTime() - Real.now();
    class Fake extends Real {
      constructor(...a: unknown[]) {
        if (a.length === 0) super(Real.now() + off);
        else super(...(a as [number]));
      }
      static now(): number {
        return Real.now() + off;
      }
    }
    (globalThis as any).Date = Fake;
    if (localStorage.getItem('ws_73b')) return;
    localStorage.setItem('ws_73b', '1');
    localStorage.setItem('ws_save_1', json);
    localStorage.setItem('ws_slot', '1');
  }, JSON.stringify(B8.ch3_1));
  await page.goto(GAME, { waitUntil: 'load' });
  for (let i = 0; i < 80; i++) {
    const sc = await page.evaluate(() => String((window as any).__game?.scene ?? ''));
    if (sc.includes('Title')) break;
    await sleep(250);
  }
  await sleep(800);
  await press(page, 'Space');
  await free(page);
  await debug(page, 'time', 200);
  await sleep(2500);
  console.log('post', await G(page, `return JSON.stringify({ today: g.rt.today, dec: (g.rt.dec || []).length });`));

  // I4: the "new" mark over the Post Office door, the list, one friend's note
  await G(page, `g.s.area = g.s.area;`);
  await debug(page, 'tp', 'post_in_exit');
  await free(page);
  await press(page, 'ArrowDown', 900);
  await free(page);
  await sleep(1500);
  await snap(page, '01-post-office-mark', 'the new mark over the Post Office door');
  await stand(page, 'in_post', 5.5, 4.6, 'up');
  await snap(page, '02-post-counter', 'the counter, its mark and the Space word');
  await press(page, 'Space');
  await sleep(600);
  await snap(page, '03-post-list', 'Your post: Dad notes by day, then the friend note');
  await press(page, 'ArrowUp');
  await press(page, 'Space');
  await sleep(500);
  await snap(page, '04-friend-note', 'a note from an island friend');
  await press(page, 'Space');
  await sleep(500);
  await snap(page, '05-post-list-read', 'the friend note read, still in the list');
  await press(page, 'KeyX');
  await press(page, 'KeyX');
  await free(page);

  // I5: the cafe counter's shop
  await stand(page, 'in_cafe', 2.5, 3.6, 'up');
  await snap(page, '06-cafe-counter', 'at the counter');
  await press(page, 'Space');
  await sleep(700);
  await snap(page, '07-cafe-shop', 'the cafe counter shop');
  await press(page, 'KeyX');
  await free(page);

  // I6: the quiz, a question of each kind, the end card
  await stand(page, 'in_school', 8, 2.7, 'up');
  await press(page, 'Space');
  await sleep(900);
  await snap(page, '08-quiz-start', 'Play the quiz?');
  await press(page, 'Space');
  await sleep(700);
  await snap(page, '09-quiz-times', String(await G(page, 'return g.rt.mini.quiz.key;')));
  await press(page, 'ArrowRight');
  await press(page, 'Space');
  await sleep(150);
  await snap(page, '10-quiz-picked', 'after a pick: the right answer shows');
  await sleep(1400);
  await snap(page, '11-quiz-spell', String(await G(page, 'return g.rt.mini.quiz.key;')));
  await G(page, `g.rt.mini.score = 7; g.rt.mini.t = 59.9;`);
  await press(page, 'Space');
  await sleep(2600);
  await snap(page, '12-quiz-end', 'You got N, her best');
  await press(page, 'Space');
  await free(page);

  // I7: a planted pot, then the same pot ready to pick
  await debug(page, 'give', 'carrot_seed:2');
  await stand(page, 'in_green', 15.5, 3.6, 'up');
  await snap(page, '13-pots', 'her three pots, Space word');
  await press(page, 'Space');
  await sleep(500);
  // step aside so the pot shows
  await G(page, `g.s.x = g.rt.px = 13.2; g.s.y = g.rt.py = 3.6; g.s.dir = 'right';`);
  await sleep(700);
  await snap(page, '14-pot-planted', 'a seed in pot 2');
  await G(page, `for (const c of g.s.crops) if (c.y === -1) c.age = 1; g.rt.worldRev++;`);
  await sleep(700);
  await snap(page, '15-pot-ready', 'ready to pick');
  const errs = await page.evaluate(() => (window as any).__game?.errors ?? []);
  console.log('errors', JSON.stringify(errs).slice(0, 400));
} finally {
  fs.writeFileSync(`${OUT}/notes.txt`, `${notes.join('\n')}\n`);
  await close();
}
