// Package 71 (D78, G: "when bing is on swing etc, ghosting happens"): does her picture move on every drawn frame?
// The rules tick 60 times a second; a screen may draw 120. On a swing, a slide and a see-saw (and beside one walking
// mob) this reads where her picture (and the mob's) is drawn on every requestAnimationFrame for the turn, and fails
// when the picture stands still on two frames in a row while it is moving (the frame before and the frame after
// differ). A held pose shows on a fast screen as a double picture.
// Package 75 (D78): --mini does the same inside the mini-games (the view draws what the rules move between their last
// two steps). It starts each game that has something moving, reads the drawn place of every such thing on each
// requestAnimationFrame (MiniView.probe) and fails when a thing is drawn in the same place on two frames in a row
// while its rules value is changing (a pair of equal frames shows on a 120 a second screen as a double picture).
// Run: node tools/bot/smooth.ts --url http://127.0.0.1:4196/ [--headed] [--mini]
// --headed opens a real Chrome window on the Mac's own display (the lead's run, at the screen's 120 a second);
// without it, headless Chrome (about 60 a second: it proves the probe works, not the 120 a second case).
import type { Page } from '@playwright/test';
import {
  advanceToPlay,
  debug,
  Fails,
  gameErrors,
  launch,
  openTitle,
  shot,
  sleep,
  startNewGame,
  startServer,
  tap,
  waitFor,
} from './lib.ts';

const HEADED = process.argv.includes('--headed');
const MINI = process.argv.includes('--mini');
const OUT = 'smooth';

interface Frame {
  /** ms since the last frame */
  dt: number;
  x: number;
  y: number;
  a: number;
  /** a turn is running (her picture) / the mob exists (the mob's) */
  on: boolean;
  /** rules ticks run in this frame */
  steps: number;
}

/** Put her beside the island's first thing of this type and press Space, as a child would (each side in turn). */
async function startTurn(page: Page, type: string): Promise<string> {
  for (let side = 0; side < 4; side++) {
    const ok = await page.evaluate(
      ([type, side]) => {
        const g = (window as any).__game.g;
        const o = g.c.areas.island.objects.find((x: any) => x.type === type);
        if (!o || g.s.area !== 'island') return false;
        const t = g.c.objects[type];
        const w = t.w ?? 1;
        const h = t.h ?? 1;
        // below it facing up, above it facing down, left of it facing right, right of it facing left
        const spots: [number, number, string][] = [
          [o.x + w / 2, o.y + h + 0.55, 'up'],
          [o.x + w / 2, o.y - 0.55, 'down'],
          [o.x - 0.55, o.y + h / 2, 'right'],
          [o.x + w + 0.55, o.y + h / 2, 'left'],
        ];
        const [x, y, dir] = spots[side]!;
        g.s.x = x;
        g.s.y = y;
        g.rt.px = x;
        g.rt.py = y;
        g.s.dir = dir;
        return true;
      },
      [type, side] as [string, number],
    );
    if (!ok) return `no ${type} on the island`;
    await sleep(250);
    await tap(page, 'Space', 60, 160);
    const move = await page.evaluate(() => (window as any).__game.g.rt.fun?.move ?? '');
    if (move) return '';
  }
  return `Space did not start a turn on the ${type}`;
}

/** Read her picture (or a mob's, by key) on every frame for `ms`. */
function record(page: Page, ms: number, mob = 0): Promise<Frame[]> {
  return page.evaluate(
    ([ms, mob]) =>
      new Promise<Frame[]>((done) => {
        const api = (window as any).__game;
        const w = api.game.scene.getScene('World');
        const out: Frame[] = [];
        let last = performance.now();
        const t0 = last;
        const tick = (now: number) => {
          const g = api.g;
          const p = mob ? w.actors.get(mob) : w.hero;
          const spr = p?.sprite;
          out.push({
            dt: now - last,
            x: spr ? spr.x : 0,
            y: spr ? spr.y : 0,
            a: spr ? spr.angle : 0,
            on: mob ? !!g.rt.mobs.find((m: any) => m.k === mob && !m.gone) : !!g.rt.fun,
            steps: w.stepsRun ?? 0,
          });
          last = now;
          if (now - t0 < ms) requestAnimationFrame(tick);
          else done(out);
        };
        requestAnimationFrame(tick);
      }),
    [ms, mob] as [number, number],
  );
}

/**
 * Frames where the picture moved, and holds: it moved into a frame, stood still on the next, then moved on (the
 * stutter a fast screen shows as a double picture). Starting or stopping is not a hold.
 */
function holds(frames: Frame[]): { moving: number; held: number; rate: number } {
  const same = (p: Frame, q: Frame) => p.x === q.x && p.y === q.y && p.a === q.a;
  let moving = 0;
  let held = 0;
  let time = 0;
  for (let i = 2; i < frames.length - 1; i++) {
    const [z, a, b, c] = [frames[i - 2]!, frames[i - 1]!, frames[i]!, frames[i + 1]!];
    if (!z.on || !a.on || !b.on || !c.on || b.dt < 2) continue;
    if (!same(a, b)) {
      moving++;
      time += b.dt;
    } else if (!same(z, a) && !same(b, c)) held++;
  }
  return { moving, held, rate: moving ? Math.round((1000 * moving) / time) : 0 };
}

/** One frame of the mini-game probe: what was drawn, the rules' value at the last step and the one before, by name. */
interface MiniFrame {
  dt: number;
  frame: number;
  v: Record<string, [number, number, number]>;
}

/** Read MiniView.probe() on every frame for `ms`; frames the view did not draw (same frame number) are dropped. */
function recordMini(page: Page, ms: number): Promise<MiniFrame[]> {
  return page.evaluate(
    (ms) =>
      new Promise<MiniFrame[]>((done) => {
        const ui = (window as any).__game.game.scene.getScene('UI');
        const out: MiniFrame[] = [];
        let last = performance.now();
        const t0 = last;
        let seen = -1;
        const tick = (now: number) => {
          const p = ui.mini.probe();
          if (p.frame !== seen) out.push({ dt: now - last, frame: p.frame, v: p.v });
          seen = p.frame;
          last = now;
          if (now - t0 < ms) requestAnimationFrame(tick);
          else done(out);
        };
        requestAnimationFrame(tick);
      }),
    ms,
  );
}

/**
 * Per thing: frames where it is moving (the rules value changed just before and just after) and, of those, the frames
 * drawn exactly where the frame before drew it. Runs are cut where a thing is missing or a frame was dropped.
 */
function miniHolds(frames: MiniFrame[]): Map<string, { moving: number; held: number }> {
  const names = new Set<string>();
  for (const f of frames) for (const k of Object.keys(f.v)) names.add(k);
  const res = new Map<string, { moving: number; held: number }>();
  for (const k of names) {
    let moving = 0;
    let held = 0;
    let run: { dt: number; out: number; cur: number; old: number }[] = [];
    const judge = () => {
      for (let i = 3; i < run.length - 2; i++) {
        const b = run[i]!;
        if (b.dt < 2) continue;
        const before = run[i - 3]!.cur !== run[i - 1]!.cur;
        const after = b.cur !== run[i + 2]!.cur;
        if (!before || !after) continue;
        moving++;
        // (a step in which it did not move at all is a stand, not a hold)
        if (b.out === run[i - 1]!.out && b.cur !== b.old) held++;
      }
      run = [];
    };
    let prev = -1;
    for (const f of frames) {
      const v = f.v[k];
      if (!v || (prev >= 0 && f.frame !== prev + 1)) judge();
      if (v) run.push({ dt: f.dt, out: v[0], cur: v[1], old: v[2] });
      prev = v ? f.frame : -1;
    }
    judge();
    res.set(k, { moving, held });
  }
  return res;
}

/** What to do in each game while it is recorded: keys held for a time, and Space taps. */
const MINI_PLAN: { game: string; ms: number; keys: string[]; space: boolean; setup?: string }[] = [
  { game: 'keepy', ms: 4000, keys: ['ArrowRight', 'ArrowLeft'], space: true },
  { game: 'puddles', ms: 4000, keys: [], space: false },
  { game: 'hide', ms: 3000, keys: [], space: false },
  { game: 'race', ms: 4000, keys: ['ArrowRight', 'ArrowDown'], space: false, setup: 'race' },
  { game: 'claw', ms: 4000, keys: [], space: false },
  { game: 'snowball', ms: 5000, keys: ['ArrowRight', 'ArrowLeft'], space: true },
  { game: 'minecart', ms: 4000, keys: [], space: false },
  { game: 'targets', ms: 5000, keys: ['ArrowRight', 'ArrowLeft', 'ArrowUp'], space: true },
];

async function miniChecks(page: Page, fails: Fails): Promise<void> {
  for (const plan of MINI_PLAN) {
    // a game's result can leave a talk box open (a prize, a word): clear it so the next game can start
    await page.evaluate(() => {
      const rt = (window as any).__game.g.rt;
      rt.talk = null;
      rt.card = null;
      if (rt.mode !== 'mini') rt.mode = 'play';
    });
    await debug(page, 'mini', plan.game);
    const on = await waitFor(page, () => (window as any).__game.g.rt.mode === 'mini', plan.game, 4000)
      .then(() => true)
      .catch(() => false);
    if (!on) {
      const st = await page.evaluate(() => {
        const rt = (window as any).__game.g.rt;
        return `mode ${rt.mode}, talk ${!!rt.talk}, card ${!!rt.card}, mini ${rt.mini?.game ?? 'none'}`;
      });
      fails.add(`${plan.game}: did not start (${st})`);
      continue;
    }
    await sleep(500);
    await tap(page, 'Space', 60, 200);
    const playing = await waitFor(page, () => (window as any).__game.g.rt.mini?.st === 1, `${plan.game} playing`, 3000)
      .then(() => true)
      .catch(() => false);
    if (!playing) {
      fails.add(`${plan.game}: the start card did not go`);
      await debug(page, 'mini');
      continue;
    }
    // the race counts down first: skip it
    if (plan.setup === 'race') await page.evaluate(() => ((window as any).__game.g.rt.mini.n[5] = 0));
    // keys and Space go in at the same time as the recording
    const rec = recordMini(page, plan.ms);
    const t0 = Date.now();
    let held = '';
    let i = 0;
    while (Date.now() - t0 < plan.ms - 100) {
      if (plan.keys.length) {
        const k = plan.keys[i % plan.keys.length]!;
        if (held) await page.keyboard.up(held);
        await page.keyboard.down(k);
        held = k;
        i++;
      }
      if (plan.space) await tap(page, 'Space', 50, 120);
      await sleep(500);
    }
    if (held) await page.keyboard.up(held);
    const frames = await rec;
    await shot(page, OUT, `mini-${plan.game}`);
    const res = miniHolds(frames);
    // names of the same kind of thing (arrows, balls) are one line in the report
    let moving = 0;
    let heldN = 0;
    const bad: string[] = [];
    const kinds = new Map<string, { n: number; moving: number; held: number }>();
    for (const [name, r] of res) {
      if (r.moving < 20) continue;
      moving += r.moving;
      heldN += r.held;
      if (r.held > 0) bad.push(`${name} ${r.held}/${r.moving}`);
      const kind = name.replace(/^obj\d+/, 'obj');
      const e = kinds.get(kind) ?? { n: 0, moving: 0, held: 0 };
      e.n++;
      e.moving += r.moving;
      e.held += r.held;
      kinds.set(kind, e);
    }
    const parts = [...kinds].map(([kind, e]) => `${kind}${e.n > 1 ? ` x${e.n}` : ''} ${e.held}/${e.moving}`);
    const secs = frames.reduce((a, f) => a + f.dt, 0) / 1000;
    console.log(
      `  ${plan.game}: ${Math.round(frames.length / Math.max(0.1, secs))} frames a second; moving things (held/moving frames): ${parts.join(', ') || 'none'}`,
    );
    if (!kinds.size) fails.add(`${plan.game}: nothing was seen moving`);
    else if (heldN > 0)
      fails.add(`${plan.game}: drawn in the same place on two frames in a row: ${bad.slice(0, 6).join(', ')}`);
    await debug(page, 'mini');
    await sleep(300);
    void moving;
  }
}

async function worldChecks(page: Page, fails: Fails): Promise<void> {
  // daylight, nothing hostile about, at the playground
  await debug(page, 'tp', 'playground');
  await waitFor(page, () => (window as any).__game.g.s.area === 'island', 'the island');
  await page.evaluate(() => {
    const g = (window as any).__game.g;
    g.s.time = 200;
    g.rt.spawnT = 1e9;
    g.rt.mobs.length = 0;
  });
  // the playground's see-saw is a build job: stand it up
  await debug(page, 'flag', 'site_seesaw');
  await sleep(800);
  for (const type of ['swing_set', 'slide', 'seesaw']) {
    const why = await startTurn(page, type);
    if (why) {
      fails.add(why);
      continue;
    }
    const frames = await record(page, 3200);
    await shot(page, OUT, type);
    const h = holds(frames);
    console.log(`  ${type}: ${h.moving} moving frames at about ${h.rate} a second, ${h.held} held`);
    if (h.moving < 20) fails.add(`${type}: only ${h.moving} moving frames were seen`);
    else if (h.held > 0) fails.add(`${type}: her picture stood still on ${h.held} of ${h.moving} moving frames`);
    await page.keyboard.press('ArrowDown');
    await sleep(600);
  }
  // one walking mob beside her
  await debug(page, 'spawn', 'zombie:1');
  const k = await page.evaluate(() => {
    const g = (window as any).__game.g;
    const m = g.rt.mobs[g.rt.mobs.length - 1];
    if (!m) return 0;
    // it walks at her (she cannot be hurt meanwhile)
    m.x = g.s.x + 4;
    m.px = m.x;
    m.calm = false;
    g.rt.safeT = 8;
    return m.k;
  });
  if (!k) fails.add('no mob came');
  else {
    const frames = await record(page, 3000, k);
    const h = holds(frames);
    console.log(`  mob: ${h.moving} moving frames at about ${h.rate} a second, ${h.held} held`);
    if (h.moving >= 20 && h.held > 0) fails.add(`the mob stood still on ${h.held} of ${h.moving} moving frames`);
    if (h.moving < 20) console.log('  (the mob hardly moved: not judged)');
  }
}

async function main(): Promise<void> {
  const server = await startServer();
  const fails = new Fails();
  const run = await launch(HEADED ? 'chrome' : 'chromium', { label: 'Test run: smooth play turns' });
  const page = run.page;
  try {
    await openTitle(page, server.url);
    await startNewGame(page);
    await advanceToPlay(page);
    if (MINI) await miniChecks(page, fails);
    if (!MINI) await worldChecks(page, fails);
    for (const e of await gameErrors(page)) fails.add(`page error: ${e}`);
  } catch (e) {
    fails.add(String(e));
  } finally {
    await run.close();
    server.stop();
  }
  console.log(fails.ok ? 'SMOOTH OK' : `SMOOTH FAIL (${fails.list.length})`);
  process.exit(fails.ok ? 0 : 1);
}

await main();
