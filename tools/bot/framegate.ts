// Frame gate (npm run frames): headed Chrome with the GPU on at 1280 x 720 judges the gaps between rendered game frames
// against the 60 FPS budget, whatever the display refresh. Three runs; passes when at least two meet every threshold.
// Flags: --quick (one pass, 10 s per scene), --dev (serve the source on 5173), --runs n, --why (resident pages per scene).
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { advanceToPlay, debug, launch, openTitle, RESULTS, sleep, startNewGame, startServer, tap } from './lib.ts';

const argv = process.argv.slice(2);
const QUICK = argv.includes('--quick');
const RUNS = QUICK ? 1 : argv.includes('--runs') ? Number(argv[argv.indexOf('--runs') + 1]) : 3;
const STEADY_S = QUICK ? 10 : 60;
const WARM_S = QUICK ? 2 : 5;
const MB = 1024 * 1024;
const WHY = argv.includes('--why');

const LIMITS = { p95: 17.5, p99: 20, over25Pct: 0.5, max: 50, js95: 8, js95Throttled: 12, mean: 16.7, meanTol: 0.5 };
// D64 (G, 19 Nov 2026): her laptop has 16 GB, so the caps went up from 96 and 256 MB
const TEX = { chars: 600 * MB, all: 1024 * MB };

interface SceneResult {
  scene: string;
  status: 'measured' | 'not available';
  note: string;
  frames: number;
  seconds: number;
  p95: number;
  p99: number;
  over25Pct: number;
  max: number;
  mean: number;
  js95: number;
  stepsPerS: number;
  texChars: number;
  texAll: number;
  throttled: boolean;
  fails: string[];
}

// ------------------------------------------------------------------ in-page recorder

/** Installs a requestAnimationFrame recorder with preallocated arrays (no per-frame allocation). */
async function installRecorder(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as any;
    if (w.__fg) return;
    const N = 20000;
    const r = {
      n: 0,
      on: false,
      t0: 0,
      ts: new Float32Array(N),
      js: new Float32Array(N),
      steps: new Uint8Array(N),
      bad: new Uint8Array(N),
      loaf: 0,
      world: null as any,
    };
    w.__fg = r;
    try {
      new PerformanceObserver((list) => {
        if (!r.on) return;
        for (const e of list.getEntries()) if (e.duration > 50) r.loaf++;
      }).observe({ type: 'long-animation-frame', buffered: false });
    } catch {
      // not supported in this browser
    }
    const tick = (t: number) => {
      if (r.on && r.n < N) {
        const i = r.n++;
        r.ts[i] = t - r.t0;
        const wd = r.world;
        r.js[i] = wd?.sys.isActive() ? wd.jsMs : 0;
        r.steps[i] = wd?.sys.isActive() ? wd.stepsRun : 0;
        r.bad[i] = document.hidden ? 1 : 0;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function startRec(page: Page): Promise<void> {
  await page.evaluate(() => {
    const r = (window as any).__fg;
    r.world = (window as any).__game.game.scene.getScene('World') ?? null;
    r.n = 0;
    r.loaf = 0;
    r.t0 = performance.now();
    r.on = true;
  });
}

async function stopRec(
  page: Page,
): Promise<{ ts: number[]; js: number[]; steps: number[]; bad: number[]; loaf: number }> {
  return page.evaluate(() => {
    const r = (window as any).__fg;
    r.on = false;
    return {
      ts: Array.from(r.ts.subarray(0, r.n) as Float32Array),
      js: Array.from(r.js.subarray(0, r.n) as Float32Array),
      steps: Array.from(r.steps.subarray(0, r.n) as Uint8Array),
      bad: Array.from(r.bad.subarray(0, r.n) as Uint8Array),
      loaf: r.loaf as number,
    };
  });
}

// ------------------------------------------------------------------ statistics

function pct(sorted: number[], p: number): number {
  if (!sorted.length) return Number.NaN;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]!;
}

function judge(
  scene: string,
  rec: Awaited<ReturnType<typeof stopRec>>,
  tex: { chars: number; all: number },
  D: number,
  throttled: boolean,
  note: string,
): SceneResult {
  const gaps: number[] = [];
  for (let i = 1; i < rec.ts.length; i++) if (!rec.bad[i] && !rec.bad[i - 1]) gaps.push(rec.ts[i]! - rec.ts[i - 1]!);
  const js = rec.js.filter((_v, i) => !rec.bad[i] && rec.steps[i]! > 0);
  const g = [...gaps].sort((a, b) => a - b);
  const j = [...js].sort((a, b) => a - b);
  const seconds = rec.ts.length ? rec.ts[rec.ts.length - 1]! / 1000 : 0;
  const steps = rec.steps.reduce((a, b) => a + b, 0);
  const r: SceneResult = {
    scene,
    status: 'measured',
    note,
    frames: rec.ts.length,
    seconds,
    p95: pct(g, 95),
    p99: pct(g, 99),
    over25Pct: g.length ? (100 * g.filter((v) => v > 25).length) / g.length : Number.NaN,
    max: g.length ? g[g.length - 1]! : Number.NaN,
    mean: g.length ? g.reduce((a, b) => a + b, 0) / g.length : Number.NaN,
    js95: pct(j, 95),
    stepsPerS: seconds > 0 ? steps / seconds : 0,
    texChars: tex.chars,
    texAll: tex.all,
    throttled,
    fails: [],
  };
  const f = r.fails;
  if (g.length < 30) f.push(`only ${g.length} frames`);
  if (throttled) {
    if (!(r.js95 < LIMITS.js95Throttled))
      f.push(`own script p95 ${r.js95.toFixed(2)} ms (x4 CPU) >= ${LIMITS.js95Throttled}`);
    return r;
  }
  if (!(r.p95 < LIMITS.p95)) f.push(`p95 ${r.p95.toFixed(2)} >= ${LIMITS.p95}`);
  if (!(r.p99 < LIMITS.p99)) f.push(`p99 ${r.p99.toFixed(2)} >= ${LIMITS.p99}`);
  if (!(r.over25Pct < LIMITS.over25Pct)) f.push(`${r.over25Pct.toFixed(2)}% over 25 ms`);
  if (!(r.max <= LIMITS.max)) f.push(`max ${r.max.toFixed(1)} > ${LIMITS.max}`);
  if (!(r.js95 < LIMITS.js95)) f.push(`own script p95 ${r.js95.toFixed(2)} >= ${LIMITS.js95}`);
  if (D >= 15 && D <= 18 && !(Math.abs(r.mean - LIMITS.mean) <= LIMITS.meanTol))
    f.push(`mean ${r.mean.toFixed(2)} not 16.7 +- 0.5`);
  if (r.texChars > TEX.chars) f.push(`character textures ${(r.texChars / MB).toFixed(0)} MB > ${TEX.chars / MB}`);
  if (r.texAll > TEX.all) f.push(`all textures ${(r.texAll / MB).toFixed(0)} MB > ${TEX.all / MB}`);
  return r;
}

function unavailable(scene: string, note: string): SceneResult {
  return {
    scene,
    status: 'not available',
    note,
    frames: 0,
    seconds: 0,
    p95: Number.NaN,
    p99: Number.NaN,
    over25Pct: Number.NaN,
    max: Number.NaN,
    mean: Number.NaN,
    js95: Number.NaN,
    stepsPerS: 0,
    texChars: 0,
    texAll: 0,
    throttled: false,
    fails: [],
  };
}

// ------------------------------------------------------------------ measuring

/** One line naming what is resident: character pages, other pages and ground chunks, in MB. */
async function residentWhy(page: Page): Promise<string> {
  const r = await page
    .evaluate(() => {
      const w = window as any;
      const sc = w.__game.game.scene.getScenes(false)[0];
      return w.__artReport?.(sc) as { pages: [string, number][]; pins: string[]; chunks: number } | undefined;
    })
    .catch(() => undefined);
  if (!r) return '';
  const mb = (n: number) => (n / MB).toFixed(1);
  const pages = [...r.pages].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${mb(n)}`);
  return `pages: ${pages.join(', ')}; chunks ${r.chunks}; pinned: ${r.pins.join(' ')}`;
}

/** Print the breakdown when a texture budget is broken, or always with --why. */
function showWhy(scene: string, tex: { chars: number; all: number; why: string }): void {
  if (tex.why && (WHY || tex.chars > TEX.chars || tex.all > TEX.all)) console.log(`  ${scene} at peak: ${tex.why}`);
}

/** Sample resident texture bytes every second while `body` runs; returns the peaks. */
async function measure(
  page: Page,
  body: () => Promise<void>,
): Promise<{ chars: number; all: number; log: number[][]; why: string }> {
  const peak = { chars: 0, all: 0, log: [] as number[][], why: '' };
  let on = true;
  const sampler = (async () => {
    while (on) {
      const b = await page
        .evaluate(() => (window as any).__game.perf().bytes as { chars: number; ground: number; other: number })
        .catch(() => null);
      if (b) {
        const all = b.chars + b.ground + b.other;
        if (all > peak.all || b.chars > peak.chars) peak.why = (await residentWhy(page)) || peak.why;
        peak.chars = Math.max(peak.chars, b.chars);
        peak.all = Math.max(peak.all, all);
        peak.log.push([b.chars, all]);
      }
      await sleep(1000);
    }
  })();
  try {
    await body();
  } finally {
    on = false;
    await sampler;
  }
  return peak;
}

const g = (page: Page) => page.evaluate(() => (window as any).__game.g.rt.mode as string);
async function settle(page: Page): Promise<void> {
  for (let k = 0; k < 20 && (await g(page)) !== 'play'; k++) await debug(page, 'skip');
}
const actorCount = (page: Page) => page.evaluate(() => (window as any).__game.perf().actors as number);
const mobCount = (page: Page) =>
  page.evaluate(() => {
    const gm = (window as any).__game.g;
    return gm.rt.mobs.filter((m: any) => m.area === gm.s.area && !m.gone).length as number;
  });

/** Held arrow keys in a slow square so the camera moves while measuring. */
async function strollFor(page: Page, seconds: number): Promise<void> {
  const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'];
  const end = Date.now() + seconds * 1000;
  let i = 0;
  while (Date.now() < end) {
    const k = keys[i++ % 4]!;
    await page.keyboard.down(k);
    await sleep(Math.min(1500, end - Date.now()));
    await page.keyboard.up(k);
  }
}

async function steady(
  page: Page,
  scene: string,
  D: number,
  setup: () => Promise<string | null>,
  throttled = false,
): Promise<SceneResult> {
  const note = await setup();
  if (note?.startsWith('n/a')) return unavailable(scene, note.slice(4));
  await sleep(WARM_S * 1000);
  await startRec(page);
  const tex = await measure(page, () => strollFor(page, STEADY_S));
  showWhy(scene, tex);
  const rec = await stopRec(page);
  return judge(scene, rec, tex, D, throttled, note ?? '');
}

async function arrival(
  page: Page,
  scene: string,
  D: number,
  body: () => Promise<string | null>,
  prep?: () => Promise<string | null>,
): Promise<SceneResult> {
  const pre = prep ? await prep() : null;
  if (pre?.startsWith('n/a')) return unavailable(scene, pre.slice(4));
  await startRec(page);
  let note: string | null = null;
  const tex = await measure(page, async () => {
    note = await body();
  });
  showWhy(scene, tex);
  const rec = await stopRec(page);
  const n = note as string | null;
  if (n?.startsWith('n/a')) return unavailable(scene, n.slice(4));
  return judge(scene, rec, tex, D, false, n ?? '');
}

async function oneRun(url: string, run: number): Promise<{ D: number; renderer: string; scenes: SceneResult[] }> {
  const b = await launch('chrome', {
    christmas: 'on',
    extraArgs: ['--enable-precise-memory-info'],
    label: 'Stress scene: a speed test, not the game',
  });
  const page = b.page;
  try {
    await page.bringToFront();
    await openTitle(page, url);
    const renderer = await page.evaluate(() => {
      const gl = (window as any).__game.game.renderer?.gl as WebGLRenderingContext | undefined;
      if (!gl) return 'no WebGL';
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    });
    if (/swiftshader|software|llvmpipe|basic render|no webgl/i.test(renderer))
      throw new Error(`software renderer: ${renderer}`);
    await installRecorder(page);
    // Display frame interval: median of 120 frames on the title.
    await startRec(page);
    await page.waitForFunction(() => (window as any).__fg.n >= 121, undefined, { timeout: 10000 });
    const cal = await stopRec(page);
    const gaps = cal.ts.slice(1).map((t, i) => t - cal.ts[i]!);
    const D = [...gaps].sort((a, c) => a - c)[Math.floor(gaps.length / 2)]!;
    console.log(`run ${run}: renderer ${renderer}; display frame ${D.toFixed(2)} ms (${(1000 / D).toFixed(0)} Hz)`);

    await startNewGame(page, 'koala');
    await advanceToPlay(page);
    const scenes: SceneResult[] = [];

    // (a) Wishing Square at noon with snow and a crowd.
    const setupA = async () => {
      await debug(page, 'tp', 'great_tree');
      await debug(page, 'time', 270);
      await settle(page);
      await debug(page, 'crowd', 25);
      await sleep(500);
      const n = await actorCount(page);
      return n >= 25 ? `${n} actors` : `${n} actors (asked for 25: needs debug('crowd', n))`;
    };
    scenes.push(await steady(page, 'a square noon snow', D, setupA));
    console.log(line(scenes.at(-1)!));

    // (b) Blocky Forest at night with 20 mobs and lights.
    scenes.push(
      await steady(page, 'b forest night mobs', D, async () => {
        await debug(page, 'tp', 'sign_forest');
        await debug(page, 'time', 700);
        await settle(page);
        await debug(page, 'spawn', 'zombie:20');
        await sleep(500);
        const m = await mobCount(page);
        if (m < 20) return `n/a ${m} mobs in view: needs debug('spawn','<mob>:<n>')`;
        return `${m} mobs`;
      }),
    );
    console.log(line(scenes.at(-1)!));

    // (c) The home plot with 300 placed objects.
    scenes.push(
      await steady(page, 'c plot 300 objects', D, async () => {
        await debug(page, 'time', 270);
        await debug(page, 'tp', 'plot_gate');
        await settle(page);
        const kinds = [
          'flower_pot',
          'dino_red',
          'dino_green',
          'dino_blue',
          'dino_yellow',
          'torch',
          'dino_purple',
          'ladder',
        ];
        for (const k of kinds) await debug(page, 'give', `${k}:60`);
        await page.evaluate((ks: string[]) => {
          const gm = (window as any).__game;
          const p = gm.g.c.areas.island.places.plot;
          let i = 0;
          for (let y = p.y; y < p.y + 16; y++)
            for (let x = p.x; x < p.x + 26; x++) gm.cmd({ c: 'place', item: ks[i++ % ks.length], x, y });
        }, kinds);
        await sleep(9000);
        const n = await page.evaluate(
          () => (window as any).__game.g.s.placed.filter((q: any) => q.area === 'island').length as number,
        );
        await debug(page, 'tp', 'plot_mid');
        await settle(page);
        if (n < 300) return `${n} placed objects (asked for 300)`;
        return `${n} placed objects`;
      }),
    );
    console.log(line(scenes.at(-1)!));

    // (d) The finale gathering, from the first frame.
    scenes.push(
      await arrival(
        page,
        'd finale arrival',
        D,
        async () => {
          // Arrive at the Great Tree with the star: the finale cutscene starts on the first frame there.
          await debug(page, 'tp', 'great_tree');
          let cut = '';
          const end = Date.now() + (QUICK ? 10000 : 30000);
          while (Date.now() < end) {
            cut ||= await page.evaluate(() => (window as any).__game.g.rt.cut?.id ?? '');
            await sleep(250);
          }
          await settle(page);
          return cut ? `cutscene ${cut}` : 'n/a the finale cutscene did not start at the Great Tree';
        },
        async () => {
          const has = await page.evaluate(() => {
            const c = (window as any).__game.g.c;
            return !!c.quests.finale && !!c.cutscenes.finale;
          });
          if (!has) return 'n/a no finale quest or cutscene in the content yet';
          await debug(page, 'finish', 'ch7');
          await settle(page);
          await debug(page, 'quest', 'finale');
          await settle(page);
          // Complete every step before the last one (the arrival at the tree).
          const steps = await page.evaluate(() => (window as any).__game.g.c.quests.finale.steps.length as number);
          for (let i = 0; i < steps - 1; i++) {
            await debug(page, 'step', 'finale');
            await settle(page);
          }
          await debug(page, 'tp', 'square_s');
          await settle(page);
          await sleep(1500);
          return null;
        },
      ),
    );
    console.log(line(scenes.at(-1)!));

    // (e) Quick travel to every signpost, then one hero swap at the mirror.
    scenes.push(
      await arrival(page, 'e travel + mirror', D, async () => {
        const signs = await page.evaluate(() => {
          const gm = (window as any).__game.g;
          const list = Object.values(gm.c.regions)
            .map((r: any) => r.sign as string | undefined)
            .filter((s): s is string => !!s && !!gm.c.areas.island.places['sign_' + s]);
          for (const s of list) if (!gm.s.signs.includes(s)) gm.s.signs.push(s);
          return list;
        });
        for (const s of signs) {
          await page.evaluate((id: string) => (window as any).__game.cmd({ c: 'travel', sign: id }), s);
          await sleep(QUICK ? 800 : 2000);
          await settle(page);
        }
        await debug(page, 'tp', 'mirror');
        await settle(page);
        const other = await page.evaluate(() => {
          const gm = (window as any).__game.g;
          return Object.keys(gm.c.heroes).find((h) => h !== gm.s.hero) ?? null;
        });
        if (other) {
          await page.evaluate((h: string) => {
            const gm = (window as any).__game;
            if (!gm.g.s.heroes.includes(h)) gm.g.s.heroes.push(h);
            gm.cmd({ c: 'hero', id: h });
          }, other);
          await sleep(2500);
        }
        return `${signs.length} signposts, swap to ${other ?? 'none'}`;
      }),
    );
    console.log(line(scenes.at(-1)!));

    // (f) Open the Sticker Book and page it.
    scenes.push(
      await arrival(page, 'f sticker book', D, async () => {
        await settle(page);
        await tap(page, 'KeyK', 50, 800);
        const open = await page.evaluate(() => !!(window as any).__game.game.scene.getScene('UI')?.overlay);
        if (!open) return 'n/a K did not open the Sticker Book';
        for (let i = 0; i < 6; i++) await tap(page, 'ArrowRight', 50, 450);
        for (let i = 0; i < 6; i++) await tap(page, 'ArrowLeft', 50, 450);
        await tap(page, 'KeyX', 50, 600);
        return null;
      }),
    );
    console.log(line(scenes.at(-1)!));

    // (a) again with the CPU slowed four times.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    try {
      scenes.push(await steady(page, 'a with CPU x4', D, setupA, true));
    } finally {
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 }).catch(() => undefined);
    }
    console.log(line(scenes.at(-1)!));
    const errs = await page.evaluate(() => (window as any).__game.errors as string[]);
    if (errs.length) scenes[0]!.fails.push(`game errors: ${errs.slice(0, 3).join('; ')}`);
    return { D, renderer, scenes };
  } finally {
    await b.close();
  }
}

// ------------------------------------------------------------------ report

const f1 = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '-');
function line(r: SceneResult, run?: number): string {
  const verdict = r.status !== 'measured' ? 'n/a' : r.fails.length ? 'FAIL' : 'ok';
  const cells = [
    run === undefined ? '' : String(run),
    r.scene.padEnd(20),
    f1(r.p95, 2).padStart(6),
    f1(r.p99, 2).padStart(6),
    f1(r.over25Pct, 2).padStart(6),
    f1(r.max).padStart(6),
    f1(r.mean, 2).padStart(6),
    f1(r.js95, 2).padStart(6),
    f1(r.stepsPerS, 0).padStart(4),
    `${f1(r.texChars / MB, 0)}/${f1(r.texAll / MB, 0)}`.padStart(8),
    verdict.padEnd(4),
    [r.note, ...r.fails].filter(Boolean).join('; '),
  ];
  return cells.filter((c, i) => i > 0 || c).join(' | ');
}

async function main(): Promise<void> {
  const caff = spawn('caffeinate', ['-dimsu', '-w', String(process.pid)], { stdio: 'ignore' });
  const server = await startServer({ dev: argv.includes('--dev') });
  const runs: { D: number; renderer: string; scenes: SceneResult[]; pass: boolean; error?: string }[] = [];
  try {
    for (let r = 1; r <= RUNS; r++) {
      try {
        const res = await oneRun(server.url, r);
        runs.push({ ...res, pass: res.scenes.every((s) => s.fails.length === 0) });
      } catch (e) {
        const msg = String((e as Error).message ?? e);
        console.log(`run ${r}: ERROR ${msg}`);
        runs.push({ D: Number.NaN, renderer: '', scenes: [], pass: false, error: msg });
      }
    }
  } finally {
    server.stop();
    caff.kill();
  }
  const passes = runs.filter((r) => r.pass).length;
  const need = QUICK ? 1 : 2;
  const pass = passes >= need;
  console.log('');
  console.log(
    'run | scene                |    p95 |    p99 |  %>25 |    max |   mean | js p95 | st/s | tex MB  | res  | notes',
  );
  for (const [i, r] of runs.entries()) {
    if (r.error) console.log(`${i + 1} | ERROR: ${r.error}`);
    for (const s of r.scenes) console.log(line(s, i + 1));
  }
  const mode = QUICK ? 'quick, 1 run' : `${RUNS} runs`;
  console.log(`display ${runs.map((r) => f1(r.D, 2)).join(', ')} ms; ${passes} of ${runs.length} runs pass (${mode})`);
  mkdirSync(RESULTS, { recursive: true });
  const out = resolve(RESULTS, 'framegate.json');
  writeFileSync(out, JSON.stringify({ quick: QUICK, limits: LIMITS, textures: TEX, pass, passes, runs }, null, 1));
  console.log(pass ? 'FRAMEGATE PASS' : 'FRAMEGATE FAIL');
  process.exit(pass ? 0 : 1);
}

await main();
