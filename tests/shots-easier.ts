// Package 60: "after" pictures of the spots the blind player tripped on, played with real key presses in a muted,
// headless browser on our own build. Each scene starts from a save (put in slot 1, then Space on the title), stands
// her at the spot (the one shortcut: her position is set, as the blind harness's saves did), then uses only keys.
// Run: node tests/shots-easier.ts --url http://127.0.0.1:4196/ --out test-results/easier [--steps <folder>]
import fs from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { launch, sleep } from '../tools/bot/lib.ts';

const arg = (k: string) => (process.argv.includes(`--${k}`) ? process.argv[process.argv.indexOf(`--${k}`) + 1] : '');
const GAME = arg('url') || 'http://127.0.0.1:4196/';
const OUT = resolve(arg('out') || 'test-results/easier');
const STEPS = arg('steps') || '/Volumes/4TB/dev/jobs/wishing-star/p60/steps';
const B8: Record<string, unknown> = JSON.parse(
  fs.readFileSync(new URL('./fixtures/saves-b8.data', import.meta.url), 'utf8'),
);
fs.mkdirSync(OUT, { recursive: true });

async function hold(page: Page, key: string, ms: number): Promise<void> {
  await page.keyboard.down(key);
  await sleep(ms);
  await page.keyboard.up(key);
  await sleep(120);
}
async function press(page: Page, key: string): Promise<void> {
  await hold(page, key, 80);
  await sleep(200);
}

/** A fresh browser with this save in slot 1, through the title into play. */
async function enter(save: unknown): Promise<{ page: Page; close: () => Promise<void> }> {
  const { page, close } = await launch('chromium', { width: 1280, height: 720 });
  await page.addInitScript((json: string) => {
    if (localStorage.getItem('ws_p60')) return;
    localStorage.setItem('ws_p60', '1');
    localStorage.setItem('ws_save_1', json);
    localStorage.setItem('ws_slot', '1');
  }, JSON.stringify(save));
  await page.goto(GAME, { waitUntil: 'load' });
  for (let i = 0; i < 80; i++) {
    const sc = await page.evaluate(() => String((window as any).__game?.scene ?? ''));
    if (sc.includes('Title')) break;
    await sleep(250);
  }
  await sleep(800);
  await press(page, 'Space');
  // cards and lines at the start of the day: Space until she is free to walk
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    const m = await page.evaluate(() => (window as any).__game?.g?.rt?.mode ?? '');
    const busy = await page.evaluate(() => {
      const rt = (window as any).__game?.g?.rt;
      return !!(rt?.talk || rt?.card || rt?.cut);
    });
    if (m === 'play' && !busy) break;
    await press(page, 'Space');
  }
  await sleep(500);
  return { page, close };
}

async function standAt(page: Page, x: number, y: number, dir = 'down'): Promise<void> {
  await page.evaluate(
    ([x, y, dir]) => {
      const g = (window as any).__game.g;
      g.s.x = g.rt.px = x;
      g.s.y = g.rt.py = y;
      g.s.dir = dir;
      g.rt.mobs.length = 0;
    },
    [x, y, dir] as const,
  );
  await sleep(900);
}

async function snap(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`shot ${name}`);
}

const scenes: { name: string; save: () => unknown; play: (page: Page) => Promise<void> }[] = [
  {
    // item 0 and 2: Bing's Garden. The star is in sight over the hedge; the small arrow by her shows the way in.
    name: 'garden',
    save: () => B8.ch2_1,
    play: async (page) => {
      await standAt(page, 52.5, 56.5, 'up');
      await snap(page, 'after-0-garden-arrow');
      await hold(page, 'ArrowUp', 1500);
      await hold(page, 'ArrowLeft', 1500);
      await snap(page, 'after-2-garden-in');
      await press(page, 'KeyM');
      await sleep(600);
      await snap(page, 'after-0-map-route');
    },
  },
  {
    // item 1: the log bridge from far off says where first
    name: 'far',
    save: () => JSON.parse(fs.readFileSync(`${STEPS}/ch1_2.json`, 'utf8')),
    play: async (page) => {
      await sleep(600);
      await snap(page, 'after-1-far-line');
      // item 5: H answers with the picture card at once
      await press(page, 'KeyH');
      await sleep(400);
      await snap(page, 'after-5-help-card');
      await press(page, 'Space');
      await sleep(400);
      await snap(page, 'after-5-help-closed');
    },
  },
  {
    // item 10: the signpost answers Space from below, facing along the path
    name: 'signpost',
    save: () => B8.ch2_1,
    play: async (page) => {
      await standAt(page, 47.5, 59.45, 'right');
      await snap(page, 'after-10-signpost-prompt');
    },
  },
  {
    // item 2: the cottage door from a tile to the left (run 1, 0111 to 0118): a held key slides her in
    name: 'door',
    save: () => B8.ch1_0,
    play: async (page) => {
      await standAt(page, 73.1, 77.6, 'up');
      await hold(page, 'ArrowUp', 1200);
      await sleep(800);
      await snap(page, 'after-2-door-in');
    },
  },
  {
    // item 10: dusk in Bing's Garden, the lanes and the hedge gaps
    name: 'dusk',
    save: () => B8.ch2_1,
    play: async (page) => {
      await page.evaluate(() => {
        (window as any).__game.g.s.time = 650;
      });
      await standAt(page, 40.5, 58.5, 'up');
      await snap(page, 'after-10-night-lanes');
    },
  },
  {
    // item 4: by a tree with a log in hand, the last slot is still the sword she wears
    name: 'hotbar',
    save: () => B8.ch2_1,
    play: async (page) => {
      await standAt(page, 57.5, 57.5, 'up');
      await press(page, 'Digit1');
      await snap(page, 'after-4-hotbar');
    },
  },
];

const only = arg('only');
for (const sc of scenes) {
  if (only && !only.split(',').includes(sc.name)) continue;
  const { page, close } = await enter(sc.save());
  try {
    await sc.play(page);
  } catch (e) {
    console.log(`scene ${sc.name} failed: ${(e as Error).message}`);
  } finally {
    await close();
  }
}
