// Package 68: "after" pictures of the spots the blind runs on build 11 tripped on, played with real key presses in a
// muted, headless browser on our own build. Each scene starts from a save of build 8 (slot 1, then Space on the
// title), sets up the spot (her position, the time, a mob: the one shortcut), then uses only keys.
// Run: node tests/shots-easier2.ts --url http://127.0.0.1:4196/ --out test-results/easier2 [--only a,b]
import fs from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { launch, sleep } from '../tools/bot/lib.ts';

const arg = (k: string) => (process.argv.includes(`--${k}`) ? process.argv[process.argv.indexOf(`--${k}`) + 1] : '');
const GAME = arg('url') || 'http://127.0.0.1:4196/';
const OUT = resolve(arg('out') || 'test-results/easier2');
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
    if (localStorage.getItem('ws_p68')) return;
    localStorage.setItem('ws_p68', '1');
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
    // item 1: ch1 step 0, "Talk to Bandit" by him, the going far from him, the quest book says the same
    name: 'talk',
    save: () => B8.ch1_0,
    play: async (page) => {
      await G(page, `g.s.quests.ch1 = { step: 0, n: 0, done: false }; g.s.tracked = 'ch1';`);
      await standAt(page, 74.5, 79.5, 'down');
      await snap(page, 'after-1-talk-far');
      const b = (await G(page, `const n = g.rt.npcs.find((n) => n.id === 'bandit'); return n ? [n.x, n.y] : null;`)) as
        | [number, number]
        | null;
      if (b) {
        await standAt(page, b[0] + 2, b[1] + 0.5, 'left');
        await snap(page, 'after-1-talk-near');
        // a few steps either way: the line does not flip
        await hold(page, 'ArrowRight', 500);
        await snap(page, 'after-1-talk-walk');
        await press(page, 'KeyQ');
        await sleep(500);
        await snap(page, 'after-1-journal');
        await press(page, 'KeyX');
        // item 3: H, the help card: Bandit's face and "Talk", closed by X
        await press(page, 'KeyH');
        await sleep(500);
        await snap(page, 'after-3-card-talk');
        await press(page, 'KeyX');
        await sleep(400);
        await snap(page, 'after-3-card-closed-x');
        // item 7: Escape in a talk closes nothing and opens nothing
        await standAt(page, b[0] + 1.2, b[1] + 0.1, 'left');
        await press(page, 'Space');
        await sleep(500);
        await press(page, 'Escape');
        await sleep(400);
        await snap(page, 'after-7-escape-talk');
      } else notes.push('talk: Bandit not here');
    },
  },
  {
    // item 2: a zombie behind her at night; Space turns her and hits, "2 left", no key bubble over them
    name: 'fight',
    save: () => B8.ch2_1,
    play: async (page) => {
      await debug(page, 'time', 650);
      await standAt(page, 115.5, 50.5, 'down');
      await debug(page, 'spawn', 'zombie:1');
      await G(
        page,
        `const m = g.rt.mobs[g.rt.mobs.length - 1]; m.calm = false; m.x = m.px = g.s.x + 0.2; m.y = m.py = g.s.y - 2.0; m.hp = 6; m.st = 0; m.t = 9;`,
      );
      await sleep(300);
      await snap(page, 'after-2-zombie-behind');
      await press(page, 'Space');
      await sleep(120);
      await snap(page, 'after-2-turned-hit');
      await press(page, 'Space');
      await press(page, 'Space');
      await sleep(200);
      await snap(page, 'after-2-mash');
    },
  },
  {
    // item 2: a spider hops at her: it lands short, never on her picture
    name: 'spider',
    save: () => B8.ch4_5,
    play: async (page) => {
      await debug(page, 'time', 650);
      await standAt(page, 115.5, 50.5, 'down');
      await debug(page, 'spawn', 'spider:1');
      await G(
        page,
        `const m = g.rt.mobs[g.rt.mobs.length - 1]; m.calm = false; m.x = m.px = g.s.x - 2.5; m.y = m.py = g.s.y; m.st = 0; m.t = 0;`,
      );
      await sleep(1500);
      await snap(page, 'after-2-spider-hop');
    },
  },
  {
    // item 4: the bow at the bench (ch4 step 8): the goal line counts the string, the bench opens on the bow with
    // the star, says where string comes from, and asks before arrows use the bow's sticks
    name: 'bench',
    save: () => B8.ch4_5,
    play: async (page) => {
      await G(
        page,
        `const q = g.s.quests.ch4; const i = g.c.quests.ch4.steps.findIndex((s) => s.t === 'craft' && s.item === 'bow'); q.step = i; q.n = 0; g.s.tracked = 'ch4'; for (const r of ['bow', 'arrow']) if (!g.s.recipes.includes(r)) g.s.recipes.push(r);`,
      );
      await G(
        page,
        `const out = (l) => { for (let i = 0; i < l.length; i++) if (l[i] && ['stick', 'string', 'feather', 'arrow'].includes(l[i].id)) l[i] = null; }; out(g.s.bag); for (const k in g.s.chests) out(g.s.chests[k]);`,
      );
      await debug(page, 'give', 'stick:3');
      await debug(page, 'give', 'string:1');
      await debug(page, 'give', 'feather:2');
      await debug(page, 'tp', 'bed_side');
      await free(page);
      const t = (await G(
        page,
        `const p = g.s.placed.find((p) => p.area === g.s.area && p.item === 'crafting_table'); return p ? [p.x, p.y] : null;`,
      )) as [number, number] | null;
      if (!t) {
        notes.push('bench: no table');
        return;
      }
      await standAt(page, t[0] + 0.5, t[1] + 1.5, 'up');
      await snap(page, 'after-4-goal-count');
      await press(page, 'KeyH');
      await sleep(500);
      await snap(page, 'after-3-card-craft');
      await press(page, 'KeyH');
      await press(page, 'Space');
      await sleep(600);
      await snap(page, 'after-4-bench');
      // the next row down (made things she can make come next: the arrows), and Space, as the blind player did
      await press(page, 'ArrowDown');
      await sleep(300);
      await snap(page, 'after-4-bench-row2');
      await press(page, 'Space');
      await sleep(500);
      const arrows = await G(
        page,
        `let n = 0; for (const sl of g.s.bag) if (sl && sl.id === 'arrow') n += sl.n; return n;`,
      );
      await snap(page, 'after-4-ask', `arrows now ${arrows}`);
      await press(page, 'Space');
      await sleep(400);
      const sticks = await G(
        page,
        `let n = 0; for (const sl of g.s.bag) if (sl && sl.id === 'stick') n += sl.n; return n;`,
      );
      await snap(page, 'after-4-kept', `sticks ${sticks}`);
    },
  },
  {
    // item 5: Space from beside the bed (not the starred tile); the Space that closes the morning card does not put
    // her to bed again; she stands clear of the bed
    name: 'bed',
    save: () => B8.ch2_1,
    play: async (page) => {
      await debug(page, 'tp', 'bed_side');
      await free(page);
      await debug(page, 'time', 650);
      const b = (await G(
        page,
        `const p = g.s.placed.find((p) => p.area === g.s.area && p.item === 'bed'); return p ? [p.x, p.y] : null;`,
      )) as [number, number] | null;
      if (!b) {
        notes.push('bed: none');
        return;
      }
      await standAt(page, b[0] + 1.5, b[1] + 1.5, 'down');
      await snap(page, 'after-5-bed-beside');
      await press(page, 'Space');
      await sleep(1500);
      await snap(page, 'after-5-bed-card');
      await press(page, 'Space');
      await sleep(300);
      await press(page, 'Space');
      await sleep(300);
      await press(page, 'Space');
      await sleep(800);
      await snap(page, 'after-5-bed-woke');
    },
  },
  {
    // item 5: walking along the cottage front past the door does not go in; walking up into it does; the roof is solid
    name: 'door',
    save: () => B8.ch2_1,
    play: async (page) => {
      await standAt(page, 71.5, 76.5, 'right');
      await hold(page, 'ArrowRight', 1100);
      await snap(page, 'after-5-door-past');
      await standAt(page, 74.5, 79.5, 'up');
      await hold(page, 'ArrowUp', 1200);
      await sleep(600);
      await snap(page, 'after-5-door-in');
    },
  },
  {
    name: 'roof',
    save: () => B8.ch2_1,
    play: async (page) => {
      await standAt(page, 74.5, 68.5, 'down');
      await hold(page, 'ArrowDown', 1500);
      await snap(page, 'after-5-roof');
    },
  },
  {
    // item 6: the prize counter: the cursor on the first thing she can buy; a prize asks once
    name: 'shop',
    save: () => B8.ch3_1,
    play: async (page) => {
      await debug(page, 'give', 'ticket:12');
      await standAt(page, 62.5, 73.6, 'up');
      await press(page, 'Space');
      await sleep(700);
      await snap(page, 'after-6-prizes');
      await press(page, 'Space');
      await sleep(500);
      await snap(page, 'after-6-ask');
      await press(page, 'Space');
      await sleep(400);
      await snap(page, 'after-6-kept');
    },
  },
  {
    // item 7: the place name never lies over the goal line
    name: 'place',
    save: () => B8.ch4_5,
    play: async (page) => {
      await standAt(page, 55.5, 25.5, 'left');
      await hold(page, 'ArrowLeft', 1400);
      await sleep(300);
      await snap(page, 'after-7-place-name');
    },
  },
  {
    // item 7: a race that runs out of time says so
    name: 'race',
    save: () => B8.ch3_1,
    play: async (page) => {
      await debug(page, 'mini', 'race');
      await sleep(800);
      await press(page, 'Space');
      await sleep(4500);
      await G(page, `if (g.rt.mini) g.rt.mini.t = 1e4;`);
      await sleep(1200);
      await snap(page, 'after-7-race-time');
    },
  },
  {
    // item 7: the trampoline: a second Space does not stop the bounce
    name: 'tramp',
    save: () => B8.ch3_1,
    play: async (page) => {
      await standAt(page, 17.5, 106.6, 'up');
      await hold(page, 'Space', 300);
      await sleep(400);
      await hold(page, 'Space', 300);
      await sleep(500);
      await snap(page, 'after-7-bounce');
    },
  },
  {
    // item 7: an X mark with no spade says where one comes from; the broken footbridge says to use the stones
    name: 'spade',
    save: () => B8.ch3_1,
    play: async (page) => {
      const x = (await G(
        page,
        `const a = g.c.areas.island; const o = a.objects.find((o) => g.c.objects[o.type]?.interact === 'dig' || g.c.objects[o.type]?.node?.tool === 'spade'); return o ? [o.x, o.y, o.type] : null;`,
      )) as [number, number, string] | null;
      await G(
        page,
        `for (const k of Object.keys(g.s.pouch)) if (/spade/.test(k)) delete g.s.pouch[k]; if (!g.s.recipes.includes('wood_spade')) g.s.recipes.push('wood_spade');`,
      );
      if (x) {
        await standAt(page, x[0] + 0.5, x[1] + 1.5, 'up');
        await press(page, 'Space');
        await sleep(300);
        await snap(page, 'after-7-spade', `${x[2]}: "${await word(page)}"`);
      }
    },
  },
  {
    // item 7: the broken footbridge says to use the stepping stones; at night the words sit on a dark plate
    name: 'bridge',
    save: () => B8.ch1_0,
    play: async (page) => {
      await debug(page, 'time', 650);
      await standAt(page, 57.4, 80.5, 'left');
      await press(page, 'Space');
      await sleep(300);
      await snap(page, 'after-7-bridge-night', `"${await word(page)}"`);
    },
  },
  {
    // item 7: the arrow by the cliff west of the plains (run c 0090, 0091): where it points from her spot
    name: 'arrowwall',
    save: () => B8.ch4_5,
    play: async (page) => {
      await G(
        page,
        `const q = g.s.quests.ch4; q.step = g.c.quests.ch4.steps.findIndex((s) => s.goal === 'Beat 3 spiders by the ferns'); q.n = 2; g.s.tracked = 'ch4';`,
      );
      for (const [x, y, n] of [
        [51.5, 29.5, 'a'],
        [52.5, 31.5, 'b'],
        [51.5, 27.6, 'c'],
      ] as const) {
        await standAt(page, x, y, 'up');
        await sleep(600);
        const gd = await G(
          page,
          `const d = g.rt.guide ?? {}; return JSON.stringify({ wx: d.wx, wy: d.wy, far: d.far, direct: d.direct, has: d.has, t: g.rt.target });`,
        );
        await snap(page, `after-7-arrow-${n}`, String(gd));
      }
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
