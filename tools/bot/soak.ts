// Soaks in headed Chrome.
//   node tools/bot/soak.ts            30 minute random-key soak: no error, no stuck state, the save still loads.
//                                     Writes release/soak-report.md with the commit.
//   node tools/bot/soak.ts --walk     10 minute walk over the whole map: no frame over 50 ms, no heap growth trend.
// Flags: --minutes n (shorter, for development), --dev (serve the source on 5173), --seed n.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import {
  advanceToPlay,
  debug,
  gameErrors,
  gitHead,
  launch,
  openTitle,
  RESULTS,
  ROOT,
  shot,
  sleep,
  startNewGame,
  startServer,
  tap,
  waitFor,
  watch,
} from './lib.ts';

const argv = process.argv.slice(2);
const WALK = argv.includes('--walk');
const MINUTES = argv.includes('--minutes') ? Number(argv[argv.indexOf('--minutes') + 1]) : WALK ? 10 : 30;
let seed = argv.includes('--seed') ? Number(argv[argv.indexOf('--seed') + 1]) : 20261225;
/** Small seeded generator so a failing soak can be replayed. */
function rnd(): number {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
}
const pick = <T>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)]!;

/** Track the worst frame gap and frames over 50 ms in the page, without per-frame allocation. */
async function installHitchMeter(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as any;
    const m = { last: 0, max: 0, over50: 0, frames: 0, on: false, worstAt: '' };
    w.__hitch = m;
    const tick = (t: number) => {
      if (m.on && !document.hidden && m.last > 0) {
        const d = t - m.last;
        m.frames++;
        if (d > m.max) {
          m.max = d;
          const s = w.__game?.g?.s;
          m.worstAt = s ? `${s.area} ${Math.round(s.x)},${Math.round(s.y)}` : '';
        }
        if (d > 50) m.over50++;
      }
      m.last = document.hidden ? 0 : t;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function heapMB(page: Page): Promise<number> {
  return page.evaluate(() => {
    (window as any).gc?.();
    return ((performance as any).memory?.usedJSHeapSize ?? 0) / 1048576;
  });
}

// ------------------------------------------------------------------ walking soak

async function walkSoak(page: Page): Promise<{ ok: boolean; lines: string[] }> {
  const places = await page.evaluate(() => {
    const gm = (window as any).__game.g;
    const p = gm.c.areas.island.places as Record<string, unknown>;
    const signs = Object.keys(p).filter((k) => k.startsWith('sign_'));
    const others = Object.keys(p).filter((k) => !k.startsWith('sign_'));
    return { signs, others };
  });
  await page.evaluate(() => {
    (window as any).__hitch.on = true;
  });
  const t0 = Date.now();
  const end = t0 + MINUTES * 60000;
  const heap: { min: number; mb: number }[] = [];
  let nextHeap = t0;
  let hops = 0;
  const arrows = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
  while (Date.now() < end) {
    // Mostly signposts, sometimes another named place, so the walk covers the whole island.
    const to = hops % 3 === 2 ? pick(places.others) : places.signs[hops % places.signs.length]!;
    await debug(page, 'tp', to);
    for (let k = 0; k < 10 && (await page.evaluate(() => (window as any).__game.g.rt.mode)) !== 'play'; k++)
      await debug(page, 'skip');
    hops++;
    const leg = Date.now() + 15000;
    while (Date.now() < Math.min(leg, end)) {
      const a = pick(arrows);
      const b = rnd() < 0.3 ? pick(arrows) : null;
      await page.keyboard.down(a);
      if (b && b !== a) await page.keyboard.down(b);
      await sleep(400 + rnd() * 1600);
      await page.keyboard.up(a);
      if (b && b !== a) await page.keyboard.up(b);
      if ((await page.evaluate(() => (window as any).__game.g.rt.mode)) !== 'play') await debug(page, 'skip');
      if (Date.now() >= nextHeap) {
        heap.push({ min: (Date.now() - t0) / 60000, mb: await heapMB(page) });
        nextHeap += 15000;
      }
    }
  }
  heap.push({ min: (Date.now() - t0) / 60000, mb: await heapMB(page) });
  const h = await page.evaluate(() => {
    const m = (window as any).__hitch;
    m.on = false;
    return {
      max: m.max as number,
      over50: m.over50 as number,
      frames: m.frames as number,
      worstAt: m.worstAt as string,
    };
  });
  // Heap at minute 2 (or a fifth of the way on a short run) against the end, averaged over nearby samples.
  const early = Math.min(2, MINUTES / 5);
  const near = (m: number) => {
    const xs = heap.filter((s) => Math.abs(s.min - m) <= 0.5).map((s) => s.mb);
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : Number.NaN;
  };
  const hEarly = near(early);
  const hEnd = near(heap.at(-1)!.min);
  const growth = (100 * (hEnd - hEarly)) / hEarly;
  const lines = [
    `walk: ${MINUTES} min, ${hops} hops, ${h.frames} frames, worst frame ${h.max.toFixed(1)} ms at ${h.worstAt}, ${h.over50} over 50 ms`,
    `heap: ${hEarly.toFixed(1)} MB at minute ${early.toFixed(1)}, ${hEnd.toFixed(1)} MB at the end (${growth >= 0 ? '+' : ''}${growth.toFixed(1)}%)`,
  ];
  const ok = h.over50 === 0 && Number.isFinite(growth) && growth <= 10;
  if (h.over50 > 0) lines.push(`FAIL ${h.over50} frames over 50 ms`);
  if (!Number.isFinite(growth)) lines.push('FAIL no heap reading (performance.memory missing)');
  else if (growth > 10) lines.push(`FAIL heap grew ${growth.toFixed(1)}% (limit 10%)`);
  mkdirSync(RESULTS, { recursive: true });
  writeFileSync(
    resolve(RESULTS, 'soak-walk.json'),
    JSON.stringify({ minutes: MINUTES, hops, ...h, heap, ok }, null, 1),
  );
  return { ok, lines };
}

// ------------------------------------------------------------------ random-key soak

/** Every key the game uses (docs/GAME_DESIGN.md section 3), weighted roughly like a child plays. */
const KEYS: [string, number][] = [
  ['ArrowUp', 8],
  ['ArrowDown', 8],
  ['ArrowLeft', 8],
  ['ArrowRight', 8],
  ['KeyW', 2],
  ['KeyA', 2],
  ['KeyS', 2],
  ['KeyD', 2],
  ['Space', 12],
  ['Enter', 4],
  ['KeyE', 2],
  ['KeyB', 1.5],
  ['KeyQ', 1.5],
  ['KeyM', 1.5],
  ['KeyK', 1.5],
  ['Digit1', 0.5],
  ['Digit2', 0.5],
  ['Digit3', 0.5],
  ['Digit4', 0.5],
  ['Digit5', 0.5],
  ['Digit6', 0.5],
  ['Digit7', 0.5],
  ['Digit8', 0.5],
  ['KeyR', 1.5],
  ['KeyG', 1],
  ['KeyX', 4],
  ['Backspace', 1.5],
  ['KeyP', 1],
  ['Escape', 1],
  ['KeyF', 0.2],
];
const WSUM = KEYS.reduce((a, [, w]) => a + w, 0);
function randomKey(): string {
  let r = rnd() * WSUM;
  for (const [k, w] of KEYS) if ((r -= w) <= 0) return k;
  return 'Space';
}
const isMove = (k: string) => k.startsWith('Arrow') || ['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(k);

async function stateSig(page: Page): Promise<string> {
  return page.evaluate(() => {
    const gm = (window as any).__game;
    const g = gm?.g;
    const ui = gm?.game.scene.getScene('UI');
    const ov = ui?.overlay
      ? (ui.overlay.constructor?.name ?? 'menu') + ':' + (ui.overlay.page ?? ui.overlay.sel ?? '')
      : '';
    const box = document.getElementById('name-entry')?.classList.contains('open') ? 'text' : '';
    if (!g) return `scene ${gm?.scene}`;
    const rt = g.rt;
    const sub = `${rt.build ? `b${rt.build.cx},${rt.build.cy},${rt.build.sel},${rt.build.rot}` : ''}${rt.talk ? `t${rt.talk.i},${rt.talk.pick}` : ''}${rt.cut ? `c${rt.cut.i}` : ''}${rt.mini ? `m${rt.mini.st},${rt.mini.score}` : ''}`;
    return `${g.s.area} ${g.s.x.toFixed(1)},${g.s.y.toFixed(1)} ${rt.mode} ${sub} ${ov} ${box} ${gm.scene}`;
  });
}

/** Close whatever is open with real keys, then P, down to "Save now", Space. True when the save was written. */
async function saveByMenu(page: Page): Promise<boolean> {
  const state = () =>
    page.evaluate(() => {
      const gm = (window as any).__game;
      return {
        box: !!document.getElementById('name-entry')?.classList.contains('open'),
        overlay: !!gm.game.scene.getScene('UI')?.overlay,
        mode: (gm.g?.rt.mode ?? '') as string,
      };
    });
  for (let i = 0; i < 40; i++) {
    const st = await state();
    if (!st.box && !st.overlay && st.mode === 'play') break;
    if (st.box) await page.keyboard.press('Enter');
    else if (st.overlay || st.mode === 'build') await tap(page, st.mode === 'build' ? 'KeyB' : 'KeyX', 50, 250);
    else await tap(page, 'Space', 50, 250);
  }
  const t0 = await page.evaluate(() => performance.now());
  await page.evaluate(() => {
    (window as any).__savedAt = 0;
    const orig = localStorage.setItem.bind(localStorage);
    localStorage.setItem = (k: string, v: string) => {
      if (k.startsWith('ws_save_') && !k.endsWith('_tmp') && !k.endsWith('_prev'))
        (window as any).__savedAt = performance.now();
      orig(k, v);
    };
  });
  await tap(page, 'KeyP', 50, 400);
  await tap(page, 'ArrowDown', 60, 250);
  await tap(page, 'Space', 50, 400);
  const saved = await page.evaluate((t: number) => ((window as any).__savedAt as number) > t, t0);
  await tap(page, 'KeyX', 50, 300);
  return saved;
}

async function randomSoak(page: Page, w: ReturnType<typeof watch>): Promise<{ ok: boolean; lines: string[] }> {
  const t0 = Date.now();
  const end = t0 + MINUTES * 60000;
  const fails: string[] = [];
  let presses = 0;
  let sig = await stateSig(page);
  let changedAt = Date.now();
  let lastCheck = 0;
  let longestStill = 0;
  while (Date.now() < end) {
    const k = randomKey();
    const hold = isMove(k) ? 100 + rnd() * 900 : 30 + rnd() * (rnd() < 0.1 ? 1000 : 120);
    const k2 = isMove(k) && rnd() < 0.25 ? randomKey() : null;
    await page.keyboard.down(k);
    if (k2 && k2 !== k) await page.keyboard.down(k2);
    await sleep(hold);
    if (k2 && k2 !== k) await page.keyboard.up(k2);
    await page.keyboard.up(k);
    presses++;
    await sleep(rnd() * 120);
    if (Date.now() - lastCheck > 1000) {
      lastCheck = Date.now();
      const s = await stateSig(page);
      if (s !== sig) {
        sig = s;
        changedAt = Date.now();
      }
      const still = Date.now() - changedAt;
      longestStill = Math.max(longestStill, still);
      if (still > 60000) {
        fails.push(`stuck for 60 s at: ${s}`);
        await shot(page, 'soak', `stuck-${fails.length}`);
        changedAt = Date.now();
      }
      const ge = await gameErrors(page);
      if (ge.length || w.page.length || w.console.length) break;
      // Leave full screen if a stray F turned it on, so the window keeps its size.
      await page
        .evaluate(() => (document.fullscreenElement ? document.exitFullscreen() : undefined))
        .catch(() => undefined);
    }
  }
  const played = (Date.now() - t0) / 60000;
  await shot(page, 'soak', 'end-of-keys');
  // The save must still load: note whether autosave ran, then save from the pause menu with keys, reload, Continue.
  const slot = await page.evaluate(() => Number(localStorage.getItem('ws_slot') ?? '1') || 1);
  const auto = await page.evaluate((n: number) => !!localStorage.getItem(`ws_save_${n}`), slot);
  const menuSaved = await saveByMenu(page);
  const before = await page.evaluate((n: number) => !!localStorage.getItem(`ws_save_${n}`), slot);
  let loaded = false;
  let loadNote = '';
  if (!before) loadNote = `no save in slot ${slot} after ${played.toFixed(1)} min`;
  else {
    await page.reload();
    await waitFor(
      page,
      () => String((window as any).__game?.scene ?? '').includes('Title'),
      'the title after reload',
      30000,
    );
    await sleep(500);
    const items = await page.evaluate(() => (window as any).__game.game.scene.getScene('Title').items as string[]);
    if (items[0] !== 'Play') loadNote = `title shows ${items.join(', ')} instead of Play`;
    else {
      await page.keyboard.press('Space');
      await sleep(400);
      // More than one slot means a slot list: Space plays the highlighted one.
      if (!String(await page.evaluate(() => (window as any).__game.scene)).includes('World'))
        await page.keyboard.press('Space');
      try {
        await waitFor(
          page,
          () => !!(window as any).__game?.g && String((window as any).__game.scene).includes('World'),
          'the world after Continue',
        );
        loaded = true;
        await shot(page, 'soak', 'continued');
      } catch (e) {
        loadNote = String((e as Error).message);
      }
    }
  }
  if (!loaded) fails.push(`save did not load: ${loadNote}`);
  const ge = await gameErrors(page);
  for (const m of [
    ...w.console.map((m) => `console: ${m}`),
    ...w.page.map((m) => `page: ${m}`),
    ...ge.map((m) => `game: ${m}`),
  ])
    fails.push(m);
  const lines = [
    `random keys: ${played.toFixed(1)} of ${MINUTES} min, ${presses} presses, longest still ${(longestStill / 1000).toFixed(0)} s`,
    `autosave before the end: ${auto ? 'yes' : 'no'}; Save now from the pause menu: ${menuSaved ? 'yes' : 'no'}`,
    loaded ? 'save: reloaded the page, Continue loaded the world' : `save: FAILED (${loadNote})`,
    ...fails.map((f) => `FAIL ${f}`),
  ];
  return { ok: fails.length === 0 && played >= MINUTES - 0.05, lines };
}

// ------------------------------------------------------------------ main

async function main(): Promise<void> {
  const caff = spawn('caffeinate', ['-dimsu', '-w', String(process.pid)], { stdio: 'ignore' });
  const server = await startServer({ dev: argv.includes('--dev') });
  const startedAt = new Date();
  const b = await launch('chrome', {
    extraArgs: ['--enable-precise-memory-info', '--js-flags=--expose-gc'],
    label: WALK ? 'Test run: walking soak' : 'Test run: random keys, not the game as played',
  });
  const w = watch(b.page);
  // "Put a copy back" opens the browser's own file chooser, which no key can close: answer it with no file
  b.page.on('filechooser', (fc) => void fc.setFiles([]).catch(() => undefined));
  let res: { ok: boolean; lines: string[] };
  try {
    await b.page.bringToFront();
    await openTitle(b.page, server.url);
    await installHitchMeter(b.page);
    await startNewGame(b.page, 'koala');
    await advanceToPlay(b.page);
    res = WALK ? await walkSoak(b.page) : await randomSoak(b.page, w);
    if (WALK) {
      const ge = await gameErrors(b.page);
      const errs = [...w.console, ...w.page, ...ge];
      if (errs.length) {
        res.ok = false;
        res.lines.push(...errs.slice(0, 10).map((e) => `FAIL error: ${e}`));
      }
    }
  } catch (e) {
    res = { ok: false, lines: [`FAIL ${String((e as Error).message ?? e)}`] };
    await shot(b.page, 'soak', 'failure').catch(() => undefined);
  } finally {
    await b.close();
    server.stop();
    caff.kill();
  }
  for (const l of res.lines) console.log(l);
  if (!WALK) {
    const dir = resolve(ROOT, 'release');
    mkdirSync(dir, { recursive: true });
    const md = [
      '# Soak report',
      '',
      `- Commit: ${gitHead()}`,
      `- Date: ${startedAt.toISOString()}`,
      `- Duration: ${MINUTES} minutes`,
      `- Kind: random keys (every key the game uses), seed ${argv.includes('--seed') ? argv[argv.indexOf('--seed') + 1] : 20261225}`,
      `- Result: ${res.ok ? 'PASS' : 'FAIL'}`,
      '',
      ...res.lines.map((l) => `- ${l}`),
      '',
    ].join('\n');
    writeFileSync(resolve(dir, 'soak-report.md'), md);
    console.log('wrote release/soak-report.md');
  }
  console.log(res.ok ? `SOAK ${WALK ? 'WALK ' : ''}PASS` : `SOAK ${WALK ? 'WALK ' : ''}FAIL`);
  process.exit(res.ok ? 0 : 1);
}

await main();
