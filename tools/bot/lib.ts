// Shared helpers for the browser bots: the preview server, browser launchers, error watching and the new-game flow.
import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { type Browser, type BrowserContext, chromium, devices, type Page, webkit } from '@playwright/test';

export const ROOT = resolve(import.meta.dirname, '../..');
export const RESULTS = resolve(ROOT, 'test-results');

export interface Server {
  url: string;
  stop(): void;
}

async function up(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

const children = new Set<ChildProcess>();
function killAll(): void {
  for (const c of children) {
    try {
      if (c.pid) process.kill(-c.pid, 'SIGTERM');
    } catch {
      // already gone
    }
  }
  children.clear();
}
process.on('exit', killAll);
for (const sig of ['SIGINT', 'SIGTERM'] as const)
  process.on(sig, () => {
    killAll();
    process.exit(130);
  });

/**
 * Serve dist/ with `vite preview` on 127.0.0.1:4173. If something already answers on that port it is reused and left
 * running (another session may own it). `dev: true` serves the source with `vite` on 5173 instead.
 */
export async function startServer(opts: { dev?: boolean } = {}): Promise<Server> {
  // --url <base> points the bots at a game served elsewhere (another checkout or port).
  const i = process.argv.indexOf('--url');
  if (i > 0 && process.argv[i + 1]) return { url: process.argv[i + 1]!, stop: () => undefined };
  const port = opts.dev ? 5173 : 4173;
  const url = `http://127.0.0.1:${port}/`;
  if (await up(url)) return { url, stop: () => undefined };
  const args = opts.dev ? ['vite'] : ['vite', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'];
  const child = spawn('npx', args, { cwd: ROOT, detached: true, stdio: ['ignore', 'ignore', 'pipe'] });
  children.add(child);
  let err = '';
  child.stderr?.on('data', (d) => {
    err += String(d);
  });
  const t0 = Date.now();
  while (!(await up(url))) {
    if (child.exitCode !== null) throw new Error(`server exited: ${err.trim()}`);
    if (Date.now() - t0 > 30000) throw new Error(`server did not answer on ${url}`);
    await sleep(200);
  }
  return {
    url,
    stop() {
      try {
        if (child.pid) process.kill(-child.pid, 'SIGTERM');
      } catch {
        // already gone
      }
      children.delete(child);
    },
  };
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Flags for real GPU rendering and no background throttling (docs/research/tech-check.md section 3). */
export const GPU_ARGS = [
  '--ignore-gpu-blocklist',
  '--enable-gpu-rasterization',
  '--use-angle=metal',
  '--disable-renderer-backgrounding',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--autoplay-policy=no-user-gesture-required',
];

export type Engine = 'chrome' | 'chromium' | 'webkit';

export interface Launched {
  browser: Browser;
  ctx: BrowserContext;
  page: Page;
  close(): Promise<void>;
}

/**
 * `chrome`: headed Google Chrome with the GPU on, for the frame gate and soaks. `chromium`: headless Google Chrome and
 * `webkit`: headless WebKit, for the smoke runs. Every page title starts with "TEST"; a headed window also shows a red
 * tag in the corner (`label`, default "Test run").
 */
// A headed test window opens on the Mac's built-in display and gives the keyboard straight back (G, 18 Nov 2026, D48:
// "for anything testing, use the internal mac monitor and not this large. so my work is not interrupted").
// Chrome counts from the top left of the main display, macOS from its bottom left: hence the sum below.
function builtinDisplayCorner(): { x: number; y: number } | null {
  const jxa =
    'ObjC.import("AppKit");var s=$.NSScreen.screens,m=s.objectAtIndex(0).frame,o="";' +
    'for(var i=0;i<s.count;i++){var c=s.objectAtIndex(i),f=c.frame;' +
    'if(/built-in/i.test(ObjC.unwrap(c.localizedName)))' +
    'o=f.origin.x+","+(m.size.height-(f.origin.y+f.size.height));}o';
  try {
    const out = execFileSync('osascript', ['-l', 'JavaScript', '-e', jxa], { encoding: 'utf8', timeout: 5000 }).trim();
    const [x, y] = out.split(',').map(Number);
    return Number.isFinite(x) && Number.isFinite(y) ? { x: x as number, y: y as number } : null;
  } catch {
    return null;
  }
}

function frontAppPath(): string | null {
  try {
    const asn = execFileSync('lsappinfo', ['front'], { encoding: 'utf8', timeout: 3000 }).trim();
    const info = execFileSync('lsappinfo', ['info', '-only', 'bundlepath', asn], { encoding: 'utf8', timeout: 3000 });
    return /bundle path="([^"]+)"/.exec(info)?.[1] ?? null;
  } catch {
    return null;
  }
}

export async function launch(
  engine: Engine,
  opts: {
    width?: number;
    height?: number;
    christmas?: 'on' | 'off';
    extraArgs?: string[];
    label?: string;
    /** a touch screen (package 65): `true` for touch at the given size, or a Playwright device name such as "iPad Pro 11 landscape" */
    touch?: boolean | string;
  } = {},
): Promise<Launched> {
  const width = opts.width ?? 1280;
  const height = opts.height ?? 720;
  let browser: Browser;
  if (engine === 'chrome') {
    const corner = builtinDisplayCorner();
    if (!corner) console.log('TEST WINDOW: no built-in display found, the window opens on the main display');
    const front = frontAppPath();
    browser = await chromium.launch({
      channel: 'chrome',
      headless: false,
      args: [
        ...GPU_ARGS,
        // Test browsers stay silent on G's Mac (G, 18 Nov 2026: "can u mute sound?"). The game's sound code still runs.
        '--mute-audio',
        `--window-size=${width},${height + 120}`,
        `--window-position=${(corner?.x ?? 0) + 40},${(corner?.y ?? 0) + 40}`,
        // It is no longer the front window, so it must not slow itself down for being in the background.
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-background-timer-throttling',
        ...(opts.extraArgs ?? []),
      ],
    });
    // Hand the keyboard back to whatever G was using.
    if (front) {
      try {
        execFileSync('open', [front], { timeout: 5000 });
      } catch {
        // the app has gone: nothing to hand back to
      }
    }
  } else if (engine === 'chromium')
    // Google Chrome in its new headless mode: the bundled headless shell hangs on WebGL on this Mac.
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio'] });
  else browser = await webkit.launch({ headless: true });
  const device = typeof opts.touch === 'string' ? devices[opts.touch] : undefined;
  if (typeof opts.touch === 'string' && !device) throw new Error(`no device called ${opts.touch}`);
  const ctx = await browser.newContext(
    device
      ? { ...device }
      : opts.touch
        ? { viewport: { width, height }, hasTouch: true }
        : { viewport: { width, height } },
  );
  // Silent in every engine (D19): WebKit takes no mute flag, so the game's own music and sound are set to 0 as well.
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('ws_music', '0');
      localStorage.setItem('ws_sound', '0');
    } catch {
      // storage blocked: the browser flags above still mute Chrome
    }
  });
  if (opts.christmas) {
    const v = opts.christmas;
    await ctx.addInitScript((val: string) => {
      try {
        localStorage.setItem('ws_christmas', val);
      } catch {
        // storage blocked: the game falls back to auto
      }
    }, v);
  }
  // A test window must not pass for the game (G judged the game from a stress scene he saw in a test window, 18 Nov
  // 2026): the page title starts with TEST, and a window somebody can see carries a tag in the corner.
  await ctx.addInitScript(
    (tag: string) => {
      const mark = () => {
        if (!document.title.startsWith('TEST')) document.title = `TEST: ${document.title}`;
        if (!tag || document.getElementById('test-run-tag')) return;
        const d = document.createElement('div');
        d.id = 'test-run-tag';
        d.textContent = tag;
        d.style.cssText =
          'position:fixed;left:8px;top:8px;z-index:2147483647;pointer-events:none;padding:4px 12px;border-radius:6px;' +
          'background:#b3261e;color:#fff;font:bold 18px sans-serif;opacity:0.92';
        document.documentElement.appendChild(d);
      };
      document.addEventListener('DOMContentLoaded', mark);
      window.addEventListener('load', mark);
    },
    engine === 'chrome' ? (opts.label ?? 'Test run: not the game as played') : '',
  );
  const page = await ctx.newPage();
  return {
    browser,
    ctx,
    page,
    async close() {
      await ctx.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
    },
  };
}

export interface Watch {
  console: string[];
  page: string[];
}

/** Collect console errors and uncaught page errors. */
export function watch(page: Page): Watch {
  const w: Watch = { console: [], page: [] };
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const where = m.location()?.url;
    w.console.push(where && m.text().startsWith('Failed to load') ? `${m.text()} [${where}]` : m.text());
  });
  // the message and where it was thrown (the first line of the stack that names a file), so a failure can be found
  page.on('pageerror', (e) => {
    const at = String(e.stack ?? '')
      .split('\n')
      .find((l) => /\.(js|ts):\d+/.test(l));
    w.page.push(String(e.message ?? e) + (at ? ` [${at.trim()}]` : ''));
  });
  return w;
}

/** Errors the game itself caught on window (window.__game.errors). */
export async function gameErrors(page: Page): Promise<string[]> {
  return page.evaluate(() => ((window as any).__game?.errors as string[] | undefined) ?? []);
}

/** Wait until fn (run in the page) returns truthy; returns its value. */
export async function waitFor<T>(page: Page, fn: () => T, what: string, timeout = 20000): Promise<T> {
  try {
    const h = await page.waitForFunction(fn, undefined, { timeout, polling: 50 });
    return (await h.jsonValue()) as T;
  } catch {
    throw new Error(`timed out waiting for ${what}`);
  }
}

/** Press a key and hold it long enough for at least a few game frames to see it. */
export async function tap(page: Page, key: string, holdMs = 60, gapMs = 90): Promise<void> {
  await page.keyboard.down(key);
  await sleep(holdMs);
  await page.keyboard.up(key);
  await sleep(gapMs);
}

export async function shot(page: Page, dir: string, name: string): Promise<string> {
  const d = resolve(RESULTS, dir);
  mkdirSync(d, { recursive: true });
  const file = resolve(d, `${name}.png`);
  await page.screenshot({ path: file });
  return file;
}

export function gitHead(): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

/** Mode of the running game, or '' when the world is not up. */
export async function mode(page: Page): Promise<string> {
  return page.evaluate(() => (window as any).__game?.g?.rt?.mode ?? '');
}

/** Open the page and wait for the title scene. */
export async function openTitle(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await waitFor(page, () => String((window as any).__game?.scene ?? '').includes('Title'), 'the title scene', 30000);
  await page
    .locator('canvas')
    .first()
    .focus()
    .catch(() => undefined);
  await sleep(400);
}

/** The title menu is up and waiting for a key. */
export async function waitTitleMenu(page: Page): Promise<void> {
  await waitFor(
    page,
    () => {
      const t = (window as any).__game?.game.scene.getScene('Title');
      return t?.sys.isActive() && t.mode === 'menu' && t.items?.length;
    },
    'the title menu',
  );
}

/**
 * From the title into the world as `hero`, with real key presses: Play on a fresh profile, New game when a save
 * exists (and the "which game should go" list when all three slots are full), then hero select. Nothing is typed:
 * nobody is named. Returns the number of key presses it took.
 */
export async function startNewGame(page: Page, hero = 'koala'): Promise<number> {
  let presses = 0;
  await waitTitleMenu(page);
  for (let i = 0; i < 4; i++) {
    const [on, items] = await page.evaluate(() => {
      const t = (window as any).__game.game.scene.getScene('Title');
      return [t.items[t.sel] as string, t.items as string[]];
    });
    if (on === 'New game' || (on === 'Play' && !items.includes('New game'))) break;
    await tap(page, 'ArrowDown');
    presses++;
  }
  await tap(page, 'Space');
  presses++;
  await waitFor(
    page,
    () =>
      String((window as any).__game.scene).includes('HeroSelect') ||
      (window as any).__game.game.scene.getScene('Title').mode === 'replace',
    'hero select',
  );
  if (!(await page.evaluate(() => String((window as any).__game.scene).includes('HeroSelect')))) {
    await tap(page, 'Space');
    presses++;
    await waitFor(page, () => String((window as any).__game.scene).includes('HeroSelect'), 'hero select');
  }
  await sleep(300);
  const idx = await page.evaluate(
    (h: string) => ((window as any).__game.game.scene.getScene('HeroSelect').ids as string[]).indexOf(h),
    hero,
  );
  if (idx < 0) throw new Error(`hero ${hero} is not on hero select`);
  for (let i = 0; i < 12; i++) {
    const sel = await page.evaluate(() => (window as any).__game.game.scene.getScene('HeroSelect').sel as number);
    if (sel === idx) break;
    await tap(page, 'ArrowRight', 60, 260);
    presses++;
  }
  await tap(page, 'Space');
  presses++;
  await waitFor(
    page,
    () => !!(window as any).__game?.g && String((window as any).__game.scene).includes('World'),
    'the world',
  );
  await page
    .locator('canvas')
    .first()
    .focus()
    .catch(() => undefined);
  return presses;
}

/** She can walk: play mode with no scene, talk or card, steady for a moment. */
async function walking(page: Page): Promise<boolean> {
  const free = () =>
    page.evaluate(() => {
      const rt = (window as any).__game?.g?.rt;
      return !!rt && rt.mode === 'play' && !rt.cut && !rt.talk && !rt.card;
    });
  if (!(await free())) return false;
  await sleep(500);
  return free();
}

/**
 * From the world's first frame to walking, the way a child who reads each line does it: one Space for each box,
 * pressed once the line is fully shown. Returns the number of presses.
 */
export async function pressesToWalk(page: Page, timeout = 90000): Promise<number> {
  const t0 = Date.now();
  let presses = 0;
  while (!(await walking(page))) {
    if (Date.now() - t0 > timeout) throw new Error(`not walking after ${timeout} ms and ${presses} presses`);
    const ready = await page.evaluate(() => {
      const rt = (window as any).__game.g.rt;
      if (rt.talk) return rt.talk.shown >= rt.talk.text.length;
      return !!rt.card;
    });
    if (!ready) {
      await sleep(120);
      continue;
    }
    // a card takes a key only after a short moment
    if (await page.evaluate(() => !!(window as any).__game.g.rt.card)) await sleep(1000);
    await tap(page, 'Space', 60, 250);
    presses++;
  }
  return presses;
}

/**
 * Hold X until the story scene is skipped: one press. `midway` runs 400 ms into the hold (for a screenshot of the
 * ring). Returns false if the scene did not skip.
 */
export async function holdXToSkip(page: Page, timeout = 6000, midway?: () => Promise<void>): Promise<boolean> {
  await page.keyboard.down('KeyX');
  const t0 = Date.now();
  let out = false;
  if (midway) {
    await sleep(400);
    await midway();
  }
  while (Date.now() - t0 < timeout) {
    if (!(await page.evaluate(() => !!(window as any).__game.g.rt.cut))) {
      out = true;
      break;
    }
    await sleep(100);
  }
  await page.keyboard.up('KeyX');
  return out;
}

/** Press Space until the game is in play mode (intro lines, cards, cutscenes). */
export async function advanceToPlay(page: Page, timeout = 90000): Promise<void> {
  const t0 = Date.now();
  while ((await mode(page)) !== 'play') {
    if (Date.now() - t0 > timeout) throw new Error(`still in mode ${await mode(page)} after ${timeout} ms`);
    await tap(page, 'Space', 50, 200);
  }
}

/** Run a rules-side debug command and wait two frames for it to apply. */
export async function debug(page: Page, what: string, arg?: string | number): Promise<void> {
  await page.evaluate(([w, a]) => (window as any).__game.debug(w, a), [what, arg] as [
    string,
    string | number | undefined,
  ]);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

/** The hero's area and tile position. */
export async function heroPos(page: Page): Promise<{ area: string; x: number; y: number }> {
  return page.evaluate(() => {
    const s = (window as any).__game.g.s;
    return { area: s.area, x: s.x, y: s.y };
  });
}

const ARROW = { left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown' } as const;

/**
 * Walk towards a point with held arrow keys, steering greedily and sidestepping when stuck.
 * Returns true when within `near` tiles.
 */
export async function walkTo(page: Page, tx: number, ty: number, near = 1.2, timeout = 25000): Promise<boolean> {
  const t0 = Date.now();
  const held = new Set<string>();
  const hold = async (keys: string[]) => {
    for (const k of [...held]) {
      if (keys.includes(k)) continue;
      await page.keyboard.up(k);
      held.delete(k);
    }
    for (const k of keys) {
      if (held.has(k)) continue;
      await page.keyboard.down(k);
      held.add(k);
    }
  };
  let last = await heroPos(page);
  let stuckT = Date.now();
  let side = 0;
  try {
    while (Date.now() - t0 < timeout) {
      const p = await heroPos(page);
      const dx = tx - p.x;
      const dy = ty - p.y;
      if (Math.hypot(dx, dy) <= near) return true;
      if ((await mode(page)) !== 'play') {
        await hold([]);
        await tap(page, 'Space', 50, 150);
        continue;
      }
      if (Math.hypot(p.x - last.x, p.y - last.y) > 0.15) {
        last = p;
        stuckT = Date.now();
      } else if (Date.now() - stuckT > 600) {
        side = (side + 1) % 4;
        stuckT = Date.now();
      }
      const keys: string[] = [];
      if (side === 0 || side === 2) {
        if (Math.abs(dx) > 0.3) keys.push(dx > 0 ? ARROW.right : ARROW.left);
        if (Math.abs(dy) > 0.3) keys.push(dy > 0 ? ARROW.down : ARROW.up);
      } else {
        // Sidestep across the blocked direction for a moment.
        if (Math.abs(dx) > Math.abs(dy)) keys.push(side === 1 ? ARROW.up : ARROW.down);
        else keys.push(side === 1 ? ARROW.left : ARROW.right);
      }
      await hold(keys);
      await sleep(side % 2 ? 350 : 120);
      if (side % 2) side = (side + 1) % 4;
    }
    return false;
  } finally {
    await hold([]);
  }
}

/** Turn to face a point by tapping the arrow towards it. */
export async function face(page: Page, tx: number, ty: number): Promise<void> {
  const p = await heroPos(page);
  const dx = tx - p.x;
  const dy = ty - p.y;
  const key = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? ARROW.right : ARROW.left) : dy > 0 ? ARROW.down : ARROW.up;
  await tap(page, key, 40, 100);
}

/** Hold arrow keys in a small loop for a few steps of walking. */
export async function wander(page: Page, ms = 1200): Promise<void> {
  const seq = [ARROW.right, ARROW.down, ARROW.left, ARROW.up];
  for (const k of seq) await tap(page, k, ms / seq.length, 30);
}

/** Per-run failures in one list, printed at the end. */
export class Fails {
  list: string[] = [];
  add(msg: string): void {
    this.list.push(msg);
    console.log(`  FAIL ${msg}`);
  }
  get ok(): boolean {
    return this.list.length === 0;
  }
}
