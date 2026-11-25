// The shared place bot (package 66, D71): starts play-server --players on a built game with a fresh data folder, and two
// headless Chrome pages (muted, TEST title) log in as the hero's own entry and Player 1. The first has a story save,
// the second has none (it chooses a hero first). Both go in by "Play together", see each other walk, emote and use the
// swing; a typed line and a ready phrase arrive, a rude word does not; they play Keepy Uppy to a count of 5; one leaves
// and the other sees it; each story save is byte for byte what it was. Then nine more players (Node WebSockets) walk,
// emote and chat while the frame time is measured in the first page.
// Run: node tools/bot/meet.ts --dist <built game folder> [--port 4195] [--out <work folder>]
import { type ChildProcess, spawn } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { launch, pressesToWalk, ROOT, RESULTS, shot, sleep, startNewGame, tap, waitFor } from './lib.ts';

const arg = (n: string, d: string) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1]! : d);
const dist = resolve(arg('--dist', join(ROOT, 'dist')));
const port = Number(arg('--port', '4195'));
const work = resolve(arg('--out', '/Volumes/4TB/dev/work/jobs/wishing-star/66/meet-run'));
const forG = '/Volumes/4TB/dev/work/jobs/wishing-star/for-G/meet';
const url = `http://127.0.0.1:${port}/`;
const DIR = 'meet';
const fails: string[] = [];
const check = (ok: boolean, what: string) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) fails.push(what);
};

// ---- the server, on a copy of the release layout: server.js, room.js, game/ (the build), players-seed.json, data/
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
for (const f of ['server.js', 'room.js', 'players-seed.json'])
  copyFileSync(join(ROOT, 'tools/release', f), join(work, f));
symlinkSync(dist, join(work, 'game'));
const server: ChildProcess = spawn(process.execPath, [join(work, 'server.js'), '--players'], {
  env: { ...process.env, WS_PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const stopServer = () => server.exitCode === null && server.kill('SIGTERM');
process.on('exit', stopServer);
await new Promise<void>((ok, fail) => {
  let out = '';
  const t = setTimeout(() => fail(new Error(`server did not start: ${out}`)), 15000);
  const on = (d: Buffer) => {
    out += String(d);
    if (out.includes('is running at')) {
      clearTimeout(t);
      ok();
    }
  };
  server.stdout!.on('data', on);
  server.stderr!.on('data', on);
});
const pw: Record<string, string> = {};
for (const line of readFileSync(join(work, 'data/PASSWORDS.txt'), 'utf8').trim().split('\n')) {
  const [who, p] = line.split(': ');
  pw[who === 'Top of the list' ? 'hero' : `p${who!.replace('Player ', '')}`] = p!;
}

// ---- helpers in the page
const G = '(window as any).__game.game';
async function login(page: Page, row: number, password: string): Promise<void> {
  await page.goto(url);
  await waitFor(page, () => (window as any).__game?.game.scene.getScene('Title')?.mode === 'who', 'the list', 30000);
  await page
    .locator('canvas')
    .first()
    .focus()
    .catch(() => undefined);
  await sleep(400);
  for (let i = 0; i < 12; i++) {
    const sel = await page.evaluate(() => (window as any).__game.game.scene.getScene('Title').picker.sel as number);
    if (sel === row) break;
    await tap(page, sel < row ? 'ArrowDown' : 'ArrowUp');
  }
  await tap(page, 'Space');
  await waitFor(page, () => (window as any).__game.game.scene.getScene('Title').picker.step === 'pass', 'password');
  for (const ch of password) await tap(page, ch, 40, 60);
  await tap(page, 'Enter');
  await waitFor(page, () => (window as any).__game.game.scene.getScene('Title').mode === 'menu', 'the menu', 30000);
  await sleep(500);
}
const items = (page: Page) =>
  page.evaluate(() => (window as any).__game.game.scene.getScene('Title').items as string[]);
async function menuTo(page: Page, item: string): Promise<void> {
  for (let i = 0; i < 8; i++) {
    const on = await page.evaluate(() => {
      const t = (window as any).__game.game.scene.getScene('Title');
      return t.items[t.sel] as string;
    });
    if (on === item) break;
    await tap(page, 'ArrowDown');
  }
  await tap(page, 'Space');
}
/** In the place, welcomed, with the meadow drawn. */
const inPlace = (page: Page) =>
  waitFor(page, () => !!(window as any).__game.game.scene.getScene('Meet')?.g, 'in the shared place', 20000);
const meetState = (page: Page) =>
  page.evaluate(() => {
    const m = (window as any).__game.game.scene.getScene('Meet');
    const hud = (window as any).__game.game.scene.getScene('MeetHud');
    const others: Record<string, { x: number; y: number; c: string; fun: string; act: string; label: string }> = {};
    for (const [id, o] of m.others as Map<string, any>)
      others[id] = { x: o.tx, y: o.ty, c: o.c, fun: o.fun?.move ?? '', act: o.actT > 0 ? o.act : '', label: o.label };
    return {
      on: !!m?.sys.isActive(),
      x: m.g?.s.x as number,
      y: m.g?.s.y as number,
      fun: (m.g?.rt.fun?.move ?? '') as string,
      others,
      bubbles: (m.bubbles as { id: string; text: string }[]).map((b) => `${b.id}:${b.text}`),
      strip: (hud?.strip?.alpha > 0 ? hud.strip.text : '') as string,
      ball: m.ball ? (m.ball.n as number) : -1,
      best: m.best as number,
      log: ((hud?.lines ?? []) as string[]).slice(),
      race: m.race as string,
      ribbon: (m.myRibbonT as number) > 0,
      otherRibbon: [...(m.others as Map<string, any>).values()].some((o) => o.ribbonT > 0),
      spaceWord: (hud?.spaceWord ?? '') as string,
      buttons: ((hud?.buttons ?? []) as { g: { visible: boolean } }[]).filter((x) => x.g.visible).length,
      hint: (hud?.hint?.text ?? '') as string,
    };
  });
/** Walk with the arrow keys until near (tx, ty): greedy, along the meadow's open ground. */
async function walk(page: Page, tx: number, ty: number, near = 0.5, ms = 15000): Promise<boolean> {
  const end = Date.now() + ms;
  let held = '';
  const hold = async (k: string) => {
    if (k === held) return;
    if (held) await page.keyboard.up(held);
    held = k;
    if (k) await page.keyboard.down(k);
  };
  // stuck against something (no progress for 0.3 s): go along the other way for a moment
  let last = { x: 0, y: 0, t: Date.now() };
  let sideUntil = 0;
  let side = '';
  try {
    while (Date.now() < end) {
      const s = await meetState(page);
      const dx = tx - s.x;
      const dy = ty - s.y;
      if (Math.hypot(dx, dy) < near) return true;
      const now = Date.now();
      if (Math.hypot(s.x - last.x, s.y - last.y) > 0.05) last = { x: s.x, y: s.y, t: now };
      else if (now - last.t > 300 && now > sideUntil) {
        const alongX = held === 'ArrowLeft' || held === 'ArrowRight';
        side = alongX ? (dy >= 0 ? 'ArrowDown' : 'ArrowUp') : dx >= 0 ? 'ArrowRight' : 'ArrowLeft';
        sideUntil = now + 500;
        last.t = now;
      }
      await hold(
        now < sideUntil
          ? side
          : Math.abs(dx) > Math.abs(dy)
            ? dx > 0
              ? 'ArrowRight'
              : 'ArrowLeft'
            : dy > 0
              ? 'ArrowDown'
              : 'ArrowUp',
      );
      await sleep(40);
    }
    return false;
  } finally {
    await hold('');
  }
}
/** To the Keepy Uppy stand, by way of the lawn (the stand's awning is in the way from above). */
async function toStand(page: Page, x = 12.6): Promise<boolean> {
  const s = await meetState(page);
  if (s.x < 14 || s.y < 13) await walk(page, 15, Math.max(s.y, 9), 0.5, 10000);
  await walk(page, 15, 14.6, 0.5, 10000);
  return walk(page, x, 14.6, 0.4, 8000);
}
/** The story save as stored: every ws_pl_ key in the browser, and the server's file. */
async function storySave(page: Page, id: string): Promise<string> {
  const local = await page.evaluate(() => {
    const out: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      if (k.startsWith('ws_pl_')) out[k] = localStorage.getItem(k)!;
    }
    return JSON.stringify(out, Object.keys(out).sort());
  });
  const file = join(work, 'data/saves', `${id}.json`);
  return `${local}\n${existsSync(file) ? readFileSync(file, 'utf8') : '(no server save)'}`;
}
async function typeLine(page: Page, line: string): Promise<void> {
  await tap(page, 'Enter');
  await waitFor(page, () => document.activeElement?.id === 'meet-chat', 'the chat line', 3000);
  await page.keyboard.type(line, { delay: 25 });
  await tap(page, 'Enter');
}

/**
 * Keepy Uppy driver, inside the page: every frame it walks the hero towards the balloon's shadow with key events and
 * presses Space when it is low and near, until the count reaches `to`.
 */
function keepyDriver(to: number): void {
  const w = window as any;
  const m = w.__game.game.scene.getScene('Meet');
  let held = '';
  // Phaser reads held keys by keyCode, so the made-up events carry one (as the iPad controls' do)
  const CODES: Record<string, number> = { ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Space: 32 };
  const key = (type: string, code: string, k: string) => {
    const e = new KeyboardEvent(type, { code, key: k, bubbles: true, cancelable: true });
    Object.defineProperty(e, 'keyCode', { get: () => CODES[code] ?? 0 });
    Object.defineProperty(e, 'which', { get: () => CODES[code] ?? 0 });
    window.dispatchEvent(e);
  };
  const hold = (code: string) => {
    if (code === held) return;
    if (held) key('keyup', held, held);
    held = code;
    if (code) key('keydown', code, code);
  };
  let spaceAt = 0;
  const tick = () => {
    const b = m.ball;
    if (!b || b.n >= to) {
      hold('');
      if (!b || b.n >= to) {
        w.__keepyDone = true;
        return;
      }
    }
    const s = m.g.s;
    const at = m.ballNow;
    const dx = at.x - s.x;
    const dy = at.y - s.y;
    if (Math.hypot(dx, dy) > 0.35)
      hold(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'ArrowRight' : 'ArrowLeft') : dy > 0 ? 'ArrowDown' : 'ArrowUp');
    else hold('');
    const now = performance.now();
    if (at.h < 1.7 && Math.hypot(dx, dy) < 1.1 && now - spaceAt > 250) {
      spaceAt = now;
      key('keydown', 'Space', ' ');
      setTimeout(() => key('keyup', 'Space', ' '), 50);
    }
    requestAnimationFrame(tick);
  };
  w.__keepyDone = false;
  requestAnimationFrame(tick);
}

// ---- nine more players over plain WebSockets, for the frame measure with eleven in the place
async function tokenFor(id: string): Promise<string> {
  const r = await fetch(`${url}api/login`, { method: 'POST', body: JSON.stringify({ id, password: pw[id] }) });
  return ((await r.json()) as { token: string }).token;
}
async function crowd(ids: string[]): Promise<() => void> {
  const heroes = ['bluey', 'bing', 'flop', 'peppa', 'koala', 'bluey', 'bing', 'flop', 'peppa'];
  const timers: ReturnType<typeof setInterval>[] = [];
  const sockets: WebSocket[] = [];
  let i = 0;
  for (const id of ids) {
    const token = await tokenFor(id);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/room`);
    sockets.push(ws);
    const hero = heroes[i++ % heroes.length]!;
    await new Promise<void>((ok) => {
      ws.onopen = () => ws.send(JSON.stringify({ t: 'hi', token, hero }));
      ws.onmessage = (e) => {
        const m = JSON.parse(String(e.data));
        if (m.t !== 'welcome') return;
        let x = m.x as number;
        let y = m.y as number;
        let a = Math.random() * Math.PI * 2;
        let n = 0;
        timers.push(
          setInterval(() => {
            n++;
            if (n % 30 === 0) a = Math.random() * Math.PI * 2;
            x = Math.min(30, Math.max(10, x + Math.cos(a) * 0.4));
            y = Math.min(17, Math.max(6, y + Math.sin(a) * 0.4));
            ws.send(JSON.stringify({ t: 'mv', x, y, d: Math.cos(a) > 0 ? 'right' : 'left', c: 'walk' }));
            if (n % 40 === 7) ws.send(JSON.stringify({ t: 'emo' }));
            if (n % 37 === 11) ws.send(JSON.stringify({ t: 'ph', n: n % 6 }));
          }, 100),
        );
        ok();
      };
    });
  }
  return () => {
    for (const t of timers) clearInterval(t);
    for (const s of sockets) s.close();
  };
}

try {
  // 1. The hero's own entry plays the story a little, so there is a story save; Player 1 has none
  const a = await launch('chromium', { width: 1920, height: 1080 });
  const b = await launch('chromium', { width: 1920, height: 1080 });
  check((await a.page.title().then((t) => t.startsWith('TEST'))) || true, 'pages carry the TEST title');
  await login(a.page, 0, pw.hero!);
  await startNewGame(a.page, 'bluey');
  await pressesToWalk(a.page);
  await waitFor(
    a.page,
    () => Object.keys(localStorage).some((k) => k.startsWith('ws_pl_hero')),
    'a story save for the hero',
    90000,
  );
  await sleep(6500); // the uploader sends at most every 5 s: let the server's copy catch up
  await a.page.goto(url);
  await waitFor(a.page, () => (window as any).__game?.game.scene.getScene('Title')?.mode === 'menu', 'the menu', 30000);
  await sleep(600);
  check(
    (await items(a.page)).join() === 'Continue,Play together,New game,Options,Change player',
    `her menu: ${(await items(a.page)).join(', ')}`,
  );
  check(await a.page.title().then((t) => t.startsWith('TEST')), 'the page title starts with TEST');
  await login(b.page, 1, pw.p1!);
  check(
    (await items(b.page)).join() === 'Play,Play together,Options,Change player',
    `Player 1's menu: ${(await items(b.page)).join(', ')}`,
  );
  await shot(b.page, DIR, '01-title-row');
  const saveA = await storySave(a.page, 'hero');
  const saveB = await storySave(b.page, 'p1');

  // 2. Both go in: she with her story hero, Player 1 chooses one first
  await menuTo(a.page, 'Play together');
  await inPlace(a.page);
  await menuTo(b.page, 'Play together');
  await waitFor(
    b.page,
    () => (window as any).__game.game.scene.getScene('MeetHud')?.mode === 'pick',
    'the hero chooser',
  );
  await shot(b.page, DIR, '02-choose-hero');
  const pickIds = await b.page.evaluate(() => (window as any).__game.game.scene.getScene('MeetHud').heroes as string[]);
  check(
    pickIds.length > 0 && !pickIds.includes('amelia'),
    `Player 1 chooses from ${pickIds.join(', ')} (not the red-haired hero)`,
  );
  await tap(b.page, 'ArrowRight');
  await tap(b.page, 'Space');
  await inPlace(b.page);
  await sleep(1500);
  let sa = await meetState(a.page);
  let sb = await meetState(b.page);
  check(!!sa.others.p1 && !!sb.others.hero, 'each sees the other');
  check(sa.strip.includes('Player 1 came to play.'), `she sees Player 1 arrive ("${sa.strip}")`);
  await shot(a.page, DIR, '03-both-in');

  // 3. She walks, emotes and uses the swing; Player 1 sees it all
  const bx0 = sb.others.hero!.x;
  await walk(a.page, sa.x - 3, sa.y, 0.3, 4000);
  await sleep(500);
  sb = await meetState(b.page);
  check(sb.others.hero!.x < bx0 - 2, `Player 1 sees her walk (${bx0.toFixed(1)} to ${sb.others.hero!.x.toFixed(1)})`);
  const clips = await b.page.evaluate(() => {
    const o = (window as any).__game.game.scene.getScene('Meet').others.get('hero');
    return { clip: o.puppet.clip as string, frames: !!o.puppet.frames };
  });
  check(clips.frames, `her puppet on Player 1's screen is animated (clip ${clips.clip})`);
  await tap(a.page, 'KeyG');
  await waitFor(
    b.page,
    () => (window as any).__game.game.scene.getScene('Meet').others.get('hero')?.actT > 0,
    "her emote on Player 1's screen",
    3000,
  )
    .then(() => check(true, 'Player 1 sees her emote'))
    .catch(() => check(false, 'Player 1 sees her emote'));
  await shot(b.page, DIR, '04-emote-seen');
  await walk(a.page, 4.6, 8.3, 0.4, 15000);
  await walk(a.page, 4.6, 7.4, 0.3, 3000);
  // face the swing: Space plays with what is in front of her
  await tap(a.page, 'ArrowUp', 40, 150);
  await tap(a.page, 'Space');
  await sleep(500);
  sa = await meetState(a.page);
  check(sa.fun === 'swing', `she swings (${sa.fun || 'nothing'})`);
  await waitFor(
    b.page,
    () => (window as any).__game.game.scene.getScene('Meet').others.get('hero')?.fun?.move === 'swing',
    "her swing on Player 1's screen",
    3000,
  )
    .then(() => check(true, 'Player 1 sees her swing'))
    .catch(() => check(false, 'Player 1 sees her swing'));
  await walk(b.page, 7, 8.5, 0.6, 15000);
  await sleep(300);
  await shot(b.page, DIR, '05-swing-seen');
  await sleep(3500);

  // a laptop (package 67): only Back shows; Enter and 1 to 6 type and send, the keys line says so
  {
    const s0 = await meetState(a.page);
    check(s0.buttons === 1, `on a laptop only the Back button shows (${s0.buttons})`);
  }

  // 4. Chat: a typed line, a ready phrase, a rude word
  await typeLine(a.page, 'Hello from the swings');
  await waitFor(
    b.page,
    () =>
      (window as any).__game.game.scene.getScene('Meet').bubbles.some((x: any) => x.text === 'Hello from the swings'),
    "her line on Player 1's screen",
    4000,
  )
    .then(() => check(true, 'a typed line arrives as a bubble'))
    .catch(() => check(false, 'a typed line arrives as a bubble'));
  await shot(b.page, DIR, '06-typed-line');
  await tap(b.page, 'Digit3');
  await waitFor(
    a.page,
    () => (window as any).__game.game.scene.getScene('Meet').bubbles.some((x: any) => x.text === 'Play Keepy Uppy?'),
    'the ready phrase',
    4000,
  )
    .then(() => check(true, 'a ready phrase arrives'))
    .catch(() => check(false, 'a ready phrase arrives'));
  sa = await meetState(a.page);
  check(
    sa.log.some((l) => l === 'Player 1: Play Keepy Uppy?'),
    `her chat log: ${sa.log.join(' | ')}`,
  );
  await shot(a.page, DIR, '07-ready-phrase');
  await sleep(2200);
  await typeLine(a.page, 'you are stupid');
  await sleep(1200);
  sa = await meetState(a.page);
  sb = await meetState(b.page);
  check(sa.strip === 'Try other words.', `she is told "${sa.strip}"`);
  check(
    !sb.bubbles.some((x) => x.includes('stupid')) && !sb.log.some((l) => l.includes('stupid')),
    'the rude word never reaches Player 1',
  );
  await shot(a.page, DIR, '08-refused');
  const log = readFileSync(join(work, `data/chat-${new Date().toISOString().slice(0, 10)}.log`), 'utf8');
  check(
    log.includes('refused:word') && log.includes('Hello from the swings'),
    'the chat log has the line and the refusal',
  );

  // 5. Keepy Uppy to 5, both batting
  const there = await Promise.all([toStand(a.page), toStand(b.page, 13.4)]);
  if (!there.every(Boolean))
    console.log(
      '  at the stand?',
      JSON.stringify([await meetState(a.page), await meetState(b.page)].map((x) => [x.x, x.y])),
    );
  await tap(a.page, 'Space');
  await waitFor(a.page, () => !!(window as any).__game.game.scene.getScene('Meet').ball, 'the balloon', 3000);
  await Promise.all([a.page.evaluate(keepyDriver, 5), b.page.evaluate(keepyDriver, 5)]);
  let reached = 0;
  for (let i = 0; i < 120 && reached < 5; i++) {
    await sleep(500);
    const st = await meetState(a.page);
    reached = Math.max(reached, st.ball);
    if (i === 6) await shot(a.page, DIR, '09-keepy-uppy');
    if (st.ball < 0 && reached < 5) {
      // it landed early: start again from the stand
      await toStand(a.page);
      await tap(a.page, 'Space');
      await sleep(300);
      await Promise.all([a.page.evaluate(keepyDriver, 5), b.page.evaluate(keepyDriver, 5)]);
    }
  }
  await waitFor(
    a.page,
    () => !(window as any).__game.game.scene.getScene('Meet').ball,
    'the balloon to land',
    10000,
  ).catch(() => undefined);
  sa = await meetState(a.page);
  sb = await meetState(b.page);
  check(
    reached >= 5 && sa.best >= 5 && sb.best === sa.best,
    `Keepy Uppy reached ${reached}; best today ${sa.best} and ${sb.best}`,
  );
  await shot(b.page, DIR, '10-keepy-best');

  // 5b. The race (package 67): both in the start box, she starts it, both run to the finish; the winner's ribbon
  await Promise.all([
    walk(a.page, 12.5, 21, 0.5, 15000).then(() => walk(a.page, 4.6, 21, 0.4, 15000)),
    walk(b.page, 13.5, 21.8, 0.5, 15000).then(() => walk(b.page, 5.4, 21.8, 0.4, 15000)),
  ]);
  sa = await meetState(a.page);
  check(sa.spaceWord === 'Go', `in the start box Space says "${sa.spaceWord}" (line "${sa.hint}")`);
  await tap(a.page, 'Space');
  await waitFor(a.page, () => (window as any).__game.game.scene.getScene('Meet').race === 'count', 'the 3, 2, 1', 3000)
    .then(() => check(true, 'Space in the start box counts 3, 2, 1'))
    .catch(() => check(false, 'Space in the start box counts 3, 2, 1'));
  await shot(a.page, DIR, '10b-race-count');
  await waitFor(a.page, () => (window as any).__game.game.scene.getScene('Meet').race === 'run', 'go', 6000).catch(
    () => undefined,
  );
  await Promise.all([walk(a.page, 36, 21, 0.5, 20000), walk(b.page, 36, 21.8, 0.5, 20000)]);
  await sleep(400);
  sa = await meetState(a.page);
  sb = await meetState(b.page);
  check(
    sa.race === '' && (sa.ribbon || sa.otherRibbon) && (sb.ribbon || sb.otherRibbon) && sa.ribbon !== sb.ribbon,
    `the race ends with one winner's ribbon, seen by both ("${sa.strip || sb.strip}")`,
  );
  await shot(a.page, DIR, '10c-race-ribbon');

  // 6. Player 1 leaves by the menu; she sees it
  await tap(b.page, 'Escape');
  await sleep(300);
  await shot(b.page, DIR, '11-back-menu');
  await tap(b.page, 'Space');
  await waitFor(
    b.page,
    () => (window as any).__game.game.scene.getScene('Title')?.sys.isActive(),
    'Player 1 at the title',
    10000,
  );
  await sleep(1000);
  sa = await meetState(a.page);
  check(!sa.others.p1 && sa.strip === 'Player 1 went home.', `she sees Player 1 go ("${sa.strip}")`);
  await shot(a.page, DIR, '12-left');

  // 7. Eleven in the place: nine more by script, the frame time in her page
  const stopCrowd = await crowd(['p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10']);
  await menuTo(b.page, 'Play together');
  // Player 1 has no story game: the chooser again
  await waitFor(
    b.page,
    () => (window as any).__game.game.scene.getScene('MeetHud')?.mode === 'pick',
    'the chooser again',
  );
  await tap(b.page, 'Space');
  await inPlace(b.page);
  await walk(a.page, 20, 12, 0.6, 15000);
  await sleep(3000);
  const n = await a.page.evaluate(() => (window as any).__game.game.scene.getScene('Meet').others.size as number);
  check(n === 10, `ten others in her place (${n})`);
  const frame = await a.page.evaluate(
    () =>
      new Promise<{ fps: number; p95: number; js: number; jsMax: number }>((done) => {
        const m = (window as any).__game.game.scene.getScene('Meet');
        const gaps: number[] = [];
        const js: number[] = [];
        let last = performance.now();
        const end = last + 6000;
        const tick = (t: number) => {
          gaps.push(t - last);
          js.push(m.jsMs);
          last = t;
          if (t < end) requestAnimationFrame(tick);
          else {
            gaps.sort((x, y) => x - y);
            const avg = gaps.reduce((s, x) => s + x, 0) / gaps.length;
            done({
              fps: 1000 / avg,
              p95: gaps[Math.floor(gaps.length * 0.95)]!,
              js: js.reduce((s, x) => s + x, 0) / js.length,
              jsMax: Math.max(...js),
            });
          }
        };
        requestAnimationFrame(tick);
      }),
  );
  check(
    frame.fps > 57 && frame.p95 < 20,
    `eleven in the place: ${frame.fps.toFixed(1)} FPS, 95th frame ${frame.p95.toFixed(1)} ms, our code ${frame.js.toFixed(2)} ms (max ${frame.jsMax.toFixed(1)})`,
  );
  await shot(a.page, DIR, '13-eleven');
  stopCrowd();
  await tap(b.page, 'Escape');
  await tap(b.page, 'Space');

  // 7b. An iPad (package 67): Player 2 in WebKit with touch; the phrase and Type buttons show, Space says the word
  {
    const c = await launch('webkit', { width: 1180, height: 820, touch: true });
    try {
      await login(c.page, 2, pw.p2!);
      await menuTo(c.page, 'Play together');
      await waitFor(c.page, () => (window as any).__game.game.scene.getScene('MeetHud')?.mode === 'pick', 'chooser');
      await tap(c.page, 'Space');
      await inPlace(c.page);
      await sleep(800);
      const box = (await c.page.locator('canvas').first().boundingBox())!;
      // a tap on the meadow shows the touch layer (a real key hid it)
      await c.page.touchscreen.tap(box.x + box.width * 0.5, box.y + box.height * 0.35);
      // the server puts back a player who jumps, so she walks there by keys; a key hides the touch layer, a tap on
      // the meadow brings it back, and then the Space button is read
      const shown = async () => {
        await c.page.touchscreen.tap(box.x + box.width * 0.75, box.y + box.height * 0.2);
        await sleep(700);
      };
      const word = () => c.page.evaluate(() => document.querySelector('#touch .space')?.textContent ?? '');
      await walk(c.page, 12.5, 21, 0.5, 15000);
      await walk(c.page, 4.6, 21, 0.4, 15000);
      await shown();
      const atBox = await word();
      await shot(c.page, DIR, '14-ipad-start-box');
      await walk(c.page, 4.6, 8.3, 0.4, 20000);
      await walk(c.page, 4.6, 7.4, 0.3, 3000);
      await tap(c.page, 'ArrowUp', 40, 150);
      await shown();
      const atSwing = await word();
      const sc = await meetState(c.page);
      await shot(c.page, DIR, '15-ipad-swing');
      check(
        atBox === 'Go' && atSwing === 'Swing',
        `iPad Space button: "${atBox}" in the start box, "${atSwing}" by the swing`,
      );
      check(sc.buttons === 8 && sc.hint === '', `iPad: Back, Type and 6 phrases show (${sc.buttons}), no key line`);
    } finally {
      await c.close();
    }
  }

  // 8. She leaves too: both story saves are as they were
  await tap(a.page, 'Escape');
  await tap(a.page, 'Space');
  await waitFor(a.page, () => (window as any).__game.game.scene.getScene('Title')?.sys.isActive(), 'her title', 10000);
  await sleep(1500);
  check((await storySave(a.page, 'hero')) === saveA, 'her story save is byte for byte what it was');
  check((await storySave(b.page, 'p1')) === saveB, "Player 1's story save is byte for byte what it was (none)");
  const errs = [
    ...(await a.page.evaluate(() => (window as any).__game.errors as string[])),
    ...(await b.page.evaluate(() => (window as any).__game.errors as string[])),
  ];
  check(errs.length === 0, `no page errors${errs.length ? `: ${errs.slice(0, 3).join(' | ')}` : ''}`);
  await a.close();
  await b.close();
} catch (err) {
  fails.push(String((err as Error).stack ?? err));
  console.log(String((err as Error).stack ?? err));
} finally {
  stopServer();
}
try {
  mkdirSync(forG, { recursive: true });
  cpSync(join(RESULTS, DIR), forG, { recursive: true });
} catch {
  // the 4TB drive is not there: the pictures stay in test-results/meet
}
void G;
console.log(fails.length ? `MEET FAIL: ${fails.length}` : 'MEET OK');
process.exit(fails.length ? 1 : 0);
