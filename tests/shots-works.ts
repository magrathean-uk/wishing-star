// Package 69: "after" pictures of the spots the blind runs on build 12 tripped on, played with real key presses in a
// muted, headless browser on our own build. Each scene starts from a save of build 8 (slot 1, then Space on the
// title), sets up the spot (her position, the time, a mob: the one shortcut), then uses only keys.
// Run: node tests/shots-works.ts --url http://127.0.0.1:4196/ --out test-results/works [--only a,b]
import fs from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { launch, sleep } from '../tools/bot/lib.ts';

const arg = (k: string) => (process.argv.includes(`--${k}`) ? process.argv[process.argv.indexOf(`--${k}`) + 1] : '');
const GAME = arg('url') || 'http://127.0.0.1:4196/';
const OUT = resolve(arg('out') || 'test-results/works');
const B8: Record<string, unknown> = JSON.parse(
  fs.readFileSync(new URL('./fixtures/saves-b8.data', import.meta.url), 'utf8'),
);
fs.mkdirSync(OUT, { recursive: true });
const notes: string[] = [];

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
const G = (page: Page, fn: string) => page.evaluate(`(() => { const g = window.__game.g; ${fn} })()`);

async function enter(save: unknown): Promise<{ page: Page; close: () => Promise<void> }> {
  const { page, close } = await launch('chromium', { width: 1280, height: 720 });
  await page.addInitScript((json: string) => {
    if (localStorage.getItem('ws_p69')) return;
    localStorage.setItem('ws_p69', '1');
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
  await free(page);
  return { page, close };
}
/** Space until she is free to walk (cards and lines at the start of a day). */
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
async function standAt(page: Page, x: number, y: number, dir = 'down', mobs = true): Promise<void> {
  const area = await G(page, `return g.s.area;`);
  if (area !== 'island' && x > 12) {
    await debug(page, 'tp', 'cottage_door');
    await free(page);
  }
  await G(
    page,
    `g.s.x = g.rt.px = ${x}; g.s.y = g.rt.py = ${y}; g.s.dir = '${dir}'; ${mobs ? 'g.rt.mobs.length = 0;' : ''}`,
  );
  await sleep(900);
}
async function snap(page: Page, name: string, what = ''): Promise<void> {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  const line = await G(
    page,
    `const s = g.s; return s.area + ' ' + s.x.toFixed(1) + ',' + s.y.toFixed(1) + ' ' + g.rt.mode + ' day ' + s.day;`,
  );
  console.log(`shot ${name} (${line}) ${what}`);
  notes.push(`${name}: ${line} ${what}`);
}
async function word(page: Page): Promise<string> {
  return String(await G(page, `return (g.rt.nudgeT > 0 ? g.rt.nudge : '');`));
}

const scenes: { name: string; save: () => unknown; play: (page: Page) => Promise<void> }[] = [
  {
    // item 1: an oak behind her, axe in the pouch: the prompt shows, Space turns her and chops, "N left" shows
    name: 'tree',
    save: () => B8.ch1_9,
    play: async (page) => {
      await debug(page, 'give', 'wood_axe:1');
      await debug(page, 'time', 300);
      // an oak near the cottage with an open tile below it: she stands there facing down, away from it
      const spot = (await G(
        page,
        `const a = g.c.areas.island; const sol = g.rt.solid.island; const at = g.rt.objAt.island;
         let best = null;
         for (const o of a.objects) {
           if (o.type !== 'oak' || g.s.taken[o.id] || g.s.nodes[o.id] !== undefined) continue;
           const k = (o.y + 1) * a.w + o.x;
           if (sol[k] || at[k] >= 0 || at[k + a.w] >= 0 || at[k - 1] >= 0 || at[k + 1] >= 0) continue;
           const d = Math.hypot(o.x - 74, o.y - 77);
           if (!best || d < best[2]) best = [o.x + 0.5, o.y + 1.5, d];
         }
         return best;`,
      )) as [number, number, number] | null;
      if (!spot) {
        notes.push('tree: no oak');
        return;
      }
      await standAt(page, spot[0], spot[1], 'down');
      await snap(
        page,
        'after-1-tree-prompt',
        `facing away from the oak above her: ${String(await G(page, 'return g.rt.hint;'))}`,
      );
      await hold(page, 'Space', 120);
      await sleep(150);
      await snap(page, 'after-1-tree-left', 'turned and chopped');
    },
  },
  {
    // item 2: a job taken from its giver while a story step is left: the goal line stays
    name: 'line',
    save: () => B8.ch2_1,
    play: async (page) => {
      const before = await G(page, `return g.s.tracked;`);
      const side = await G(
        page,
        `return g.c.questOrder.find((id) => g.c.quests[id].kind === 'side' && g.c.quests[id].giver && !g.s.quests[id]);`,
      );
      await page.evaluate((q) => (window as any).__game.cmd({ c: 'accept', quest: q }), String(side));
      await sleep(1200);
      const after = await G(page, `return g.s.tracked;`);
      await snap(page, 'after-2-line', `took ${side}; line ${before} -> ${after}`);
      await press(page, 'KeyQ');
      await sleep(500);
      await snap(page, 'after-2-book');
      await press(page, 'KeyX');
    },
  },
  {
    // item 3: hearts come back to 3; at 3 or fewer with food, "R: Eat"; R eats
    name: 'hearts',
    save: () => B8.ch6_2,
    play: async (page) => {
      await debug(page, 'tp', 'cottage_door');
      await free(page);
      await debug(page, 'time', 300);
      await G(page, `g.rt.mobs.length = 0; g.s.hp = 1;`);
      await sleep(400);
      await snap(page, 'after-3-one-heart');
      await sleep(12500);
      await snap(page, 'after-3-came-back', String(await G(page, `return 'hp ' + g.s.hp;`)));
      await debug(page, 'give', 'bread:2');
      await sleep(600);
      await snap(page, 'after-3-r-eat');
      await press(page, 'KeyR');
      await sleep(400);
      await snap(page, 'after-3-ate', String(await G(page, `return 'hp ' + g.s.hp;`)));
    },
  },
  {
    // item 4: a high web beside the trail; X from two tiles off, facing along the path: the arrow aims and it goes
    name: 'web',
    save: () => B8.ch4_10,
    play: async (page) => {
      await debug(page, 'give', 'bow:1');
      await debug(page, 'give', 'arrow:8');
      await G(page, `g.s.gear.bow = 'bow';`);
      await debug(page, 'time', 300);
      await standAt(page, 24.5, 34.5, 'down');
      await snap(
        page,
        'after-4-web-before',
        String(await G(page, `return 'web ' + (g.s.taken['i_web_high_1'] ? 'down' : 'up');`)),
      );
      await press(page, 'KeyX');
      await sleep(900);
      await snap(
        page,
        'after-4-web-shot',
        String(await G(page, `return 'web ' + (g.s.taken['i_web_high_1'] ? 'down' : 'up');`)),
      );
      await press(page, 'KeyX');
      await sleep(700);
      await press(page, 'KeyX');
      await sleep(600);
      await snap(page, 'after-4-nothing', await word(page));
    },
  },
  {
    // item 5: Space, Space at Mama Koala by the bench: the talk opens once; the next Space is the bench's
    name: 'talk',
    save: () => B8.ch4_3,
    play: async (page) => {
      await standAt(page, 30.5, 22.5, 'left');
      const mk = (await G(
        page,
        `const n = g.rt.npcs.find((n) => n.id === 'mama_koala'); return n ? [n.x, n.y] : null;`,
      )) as [number, number] | null;
      if (!mk) {
        notes.push('talk: Mama Koala not here');
        return;
      }
      await standAt(page, mk[0] + 1.1, mk[1], 'left');
      await press(page, 'Space');
      await sleep(600);
      await snap(page, 'after-5-talk-once');
      for (let i = 0; i < 4; i++) await press(page, 'Space');
      await sleep(500);
      await snap(page, 'after-5-no-reopen', String(await G(page, `return g.rt.mode + ' ' + (g.rt.talk?.who ?? '');`)));
    },
  },
  {
    // item 6: the hide and seek post's start card: X is "Not now"
    name: 'card',
    save: () => B8.ch2_1,
    play: async (page) => {
      await standAt(page, 84.5, 76.5, 'up');
      await press(page, 'Space');
      await sleep(700);
      await snap(
        page,
        'after-6-start-card',
        String(await G(page, `return g.rt.mode + ' ' + (g.rt.mini?.game ?? '');`)),
      );
      await press(page, 'KeyX');
      await sleep(600);
      await snap(page, 'after-6-not-now', String(await G(page, `return g.rt.mode;`)));
    },
  },
  {
    // item 7: the crafting table: Left and Right change the tab from the first row
    name: 'tabs',
    save: () => B8.ch4_3,
    play: async (page) => {
      await standAt(page, 29.5, 21.5, 'up');
      await press(page, 'Space');
      await sleep(700);
      await snap(page, 'after-7-bench');
      await hold(page, 'ArrowLeft', 400);
      await sleep(500);
      await snap(page, 'after-7-tab-left');
      await hold(page, 'ArrowDown', 200);
      await hold(page, 'ArrowRight', 400);
      await sleep(400);
      await snap(page, 'after-7-tab-right');
      await press(page, 'KeyX');
    },
  },
  {
    // item 8: the longest strip, "Bag full. Some went to your chest."
    name: 'toast',
    save: () => B8.ch4_3,
    play: async (page) => {
      await G(page, `g.ev.push({ t: 'toast', kind: 'info', text: 'bag_sent', item: 'log', n: 3 });`);
      await sleep(900);
      await snap(page, 'after-8-toast');
    },
  },
  {
    // item 9: run d 0064: over the bridge into the plains on "Beat the second skeleton": the arrow keeps east
    name: 'arrow',
    save: () => B8.ch6_2,
    play: async (page) => {
      await G(page, `const q = g.s.quests.ch6; q.step = 2; q.n = 0; g.s.tracked = 'ch6';`);
      await debug(page, 'time', 650);
      await standAt(page, 101.5, 59.5, 'right', false);
      await snap(page, 'after-9-bridge');
      await hold(page, 'ArrowRight', 1500);
      await sleep(400);
      await snap(
        page,
        'after-9-plains',
        String(
          await G(page, `const d = g.rt.guide ?? {}; return JSON.stringify({ wx: d.wx, wy: d.wy, t: g.rt.target });`),
        ),
      );
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
    notes.push(`${sc.name} failed: ${(e as Error).message}`);
  } finally {
    await close();
  }
}
fs.writeFileSync(`${OUT}/notes.txt`, notes.join('\n') + '\n');
