// Package 74 (D79): headless pictures of the small joys, for the report. A word over a cow (I1), the high swing and
// the jump off (I8), the fish at the jetty (I9), the cat on a rug indoors and a trick (I10), the tidied bag with a pin
// (I11), the "is at" line (I12). Headless Chromium, muted (launch() in tools/bot/lib.ts).
// Run: node tests/joys-shots.ts --url http://127.0.0.1:4198/
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
} from '../tools/bot/lib.ts';

const OUT = '74';
const G = 'window.__game.g';

async function put(page: Page, x: number, y: number, dir: string): Promise<void> {
  await page.evaluate(
    ([x, y, dir]) => {
      const g = (window as any).__game.g;
      g.s.x = x;
      g.s.y = y;
      g.rt.px = x;
      g.rt.py = y;
      g.s.dir = dir;
    },
    [x, y, dir] as [number, number, string],
  );
  await sleep(300);
}

/** A story scene or a card that came up meanwhile is skipped: back to plain play. */
async function calm(page: Page): Promise<void> {
  for (let i = 0; i < 20; i++) {
    const busy = await page.evaluate(() => {
      const g = (window as any).__game.g;
      return g.rt.mode !== 'play' || !!g.rt.cut || !!g.rt.talk || !!g.rt.card;
    });
    if (!busy) return;
    await debug(page, 'skip');
    await sleep(300);
  }
  await advanceToPlay(page);
}

async function main(): Promise<void> {
  const server = await startServer();
  const fails = new Fails();
  const run = await launch('chromium', { label: 'Test run: small joys', width: 1280, height: 720 });
  const page = run.page;
  const say = (m: string) => console.log('  ' + m);
  try {
    await openTitle(page, server.url);
    await startNewGame(page, 'amelia');
    await advanceToPlay(page);
    await page.evaluate(() => {
      const g = (window as any).__game.g;
      g.s.time = 200;
      g.rt.spawnT = 1e9;
      g.rt.mobs.length = 0;
    });

    // I1: a word over a cow
    await debug(page, 'tp', 'herd_cow_1');
    await waitFor(page, () => (window as any).__game.g.s.area === 'island', 'the island');
    const cow = await page.evaluate(() => {
      const g = (window as any).__game.g;
      const b = g.rt.beasts.find((x: any) => x.id === 'cow');
      if (!b) return false;
      b.wait = 99;
      b.tx = b.x;
      b.ty = b.y;
      g.s.x = b.x - 1.1;
      g.s.y = b.y;
      g.rt.px = g.s.x;
      g.rt.py = g.s.y;
      g.s.dir = 'right';
      return true;
    });
    if (!cow) fails.add('no cow by herd_cow_1');
    await sleep(300);
    await tap(page, 'Space', 60, 250);
    await shot(page, OUT, '1-cow-word');
    say('1 cow word: ' + (await page.evaluate(() => (window as any).__game.g.rt.fun?.move ?? 'no turn')));

    // I8: the high swing and the jump off
    await debug(page, 'tp', 'playground');
    await sleep(500);
    const onSwing = await page.evaluate(() => {
      const g = (window as any).__game.g;
      const o = g.c.areas.island.objects.find((x: any) => x.type === 'swing_set');
      if (!o) return false;
      g.s.x = o.x + 1.5;
      g.s.y = o.y + 2.55;
      g.rt.px = g.s.x;
      g.rt.py = g.s.y;
      g.s.dir = 'up';
      return true;
    });
    if (!onSwing) fails.add('no swing');
    await sleep(300);
    await tap(page, 'Space', 60, 200);
    if ((await page.evaluate(() => (window as any).__game.g.rt.fun?.move)) !== 'swing') fails.add('no swing turn');
    for (let i = 0; i < 3; i++) {
      // wait for the bottom of the forward swing, then push
      await page.waitForFunction(
        () => {
          const r = (window as any).__game.g.rt.fun;
          if (!r) return true;
          const ph = ((r.t % 1.7) + 1.7) % 1.7;
          const last = r.pushes?.[r.pushes.length - 1] ?? -9;
          return (ph > 1.62 || ph < 0.05) && r.t - last > 1.2 && r.t > 0.5;
        },
        undefined,
        { timeout: 8000 },
      );
      await page.keyboard.down('Space');
      await sleep(50);
      await page.keyboard.up('Space');
      await sleep(200);
    }
    const pushes = await page.evaluate(() => (window as any).__game.g.rt.fun?.pushes?.length ?? -1);
    say(`8 swing: ${pushes} good pushes`);
    if (pushes !== 3) fails.add(`swing: ${pushes} good pushes, not 3`);
    // the top of the high swing, then the jump off
    await page.waitForFunction(
      () => {
        const r = (window as any).__game.g.rt.fun;
        return !r || r.leap === undefined || r.t > r.leap - 0.9;
      },
      undefined,
      { timeout: 8000 },
    );
    await shot(page, OUT, '2-swing-high');
    await page.waitForFunction(
      () => {
        const r = (window as any).__game.g.rt.fun;
        return !r || r.t > (r.leap ?? 0) + 0.25;
      },
      undefined,
      { timeout: 8000 },
    );
    await shot(page, OUT, '3-swing-wheee');
    await sleep(1200);
    say(`8 after the jump: turn ${await page.evaluate(() => (window as any).__game.g.rt.fun?.move ?? 'over')}`);

    // I9: the fish at the mended jetty
    await calm(page);
    await debug(page, 'flag', 'site_jetty');
    await debug(page, 'give', 'bread:3');
    await debug(page, 'tp', 'pond_e');
    await sleep(400);
    await put(page, 42.5, 77.5, 'down');
    const hint = await page.evaluate(() => (window as any).__game.g.rt.hint);
    say(`9 jetty hint: ${hint}`);
    if (hint !== 'feed') fails.add(`jetty: the hint is "${hint}", not feed`);
    await tap(page, 'Space', 60, 330);
    await shot(page, OUT, '4-jetty-fish');
    const bread = await page.evaluate(() =>
      (window as any).__game.g.s.bag.reduce((n: number, s: any) => n + (s?.id === 'bread' ? s.n : 0), 0),
    );
    say(`9 bread left: ${bread}`);

    // I10: her cat comes into the cottage and lies on a rug; a trick
    await calm(page);
    await debug(page, 'tp', 'amelia_home');
    await sleep(300);
    await page.evaluate(() => {
      const g = (window as any).__game.g;
      g.s.pets.push({ kind: 'cat', name: 'cat' });
      g.s.animals.push({
        k: g.s.nextK++,
        kind: 'cat',
        area: 'island',
        x: 75.6,
        y: 78,
        hx: 75.6,
        hy: 78,
        pet: true,
        pen: 'pet',
      });
      g.s.placed.push({ k: g.s.nextK++, item: 'rug', area: 'cottage', x: 4, y: 6, layer: 'floor' });
    });
    await put(page, 74.5, 77.4, 'up');
    await page.keyboard.down('ArrowUp');
    await waitFor(page, () => (window as any).__game.g.s.area === 'cottage', 'the cottage', 6000).catch(() => null);
    await page.keyboard.up('ArrowUp');
    await sleep(3500);
    const pet = await page.evaluate(() => {
      const g = (window as any).__game.g;
      const b = g.rt.beasts.find((x: any) => x.id === 'cat');
      return b ? `${g.s.area} cat at ${b.x.toFixed(1)},${b.y.toFixed(1)} rest ${b.rest}` : `${g.s.area}: no cat`;
    });
    say('10 ' + pet);
    if (!pet.includes('rest true')) fails.add('the cat did not lie down indoors');
    await shot(page, OUT, '5-cat-on-rug');
    await page.evaluate(() => {
      const g = (window as any).__game.g;
      const b = g.rt.beasts.find((x: any) => x.id === 'cat');
      g.s.x = b.x - 1;
      g.s.y = b.y;
      g.rt.px = g.s.x;
      g.rt.py = g.s.y;
      g.s.dir = 'right';
    });
    await sleep(200);
    await tap(page, 'Space', 60, 60);
    await tap(page, 'Space', 60, 1400);
    await tap(page, 'Space', 60, 250);
    await shot(page, OUT, '6-cat-trick-jump');

    // I11: the tidied bag with a pin
    await calm(page);
    await debug(page, 'give', 'plank:7');
    await debug(page, 'give', 'apple:3');
    await debug(page, 'give', 'wheat_seed:4');
    await debug(page, 'give', 'cobblestone:9');
    await page.evaluate(() => {
      const g = (window as any).__game.g;
      // muddle the bag: everything but button 1 goes to the bag rows, out of order
      const b = g.s.bag;
      const moved = b.filter((x: any, i: number) => x && i > 0);
      for (let i = 1; i < b.length; i++) b[i] = null;
      moved.forEach((s: any, i: number) => {
        const half = { id: s.id, n: Math.ceil(s.n / 2) };
        b[43 - i * 5] = half;
        if (s.n - half.n > 0) b[12 + i * 3] = { id: s.id, n: s.n - half.n };
      });
    });
    await tap(page, 'KeyE', 60, 500);
    await tap(page, 'KeyN', 60, 200);
    await shot(page, OUT, '7-bag-before-tidy');
    await tap(page, 'KeyT', 60, 300);
    await shot(page, OUT, '8-bag-tidy-pin');
    const bag = await page.evaluate(() => {
      const g = (window as any).__game.g;
      return `pin 0 ${!!Object.keys(g.s.counts).find((k) => k.startsWith('pin:0:'))}; rows ${g.s.bag
        .slice(8, 16)
        .map((s: any) => s?.id ?? '-')
        .join(' ')}`;
    });
    say('11 ' + bag);
    await tap(page, 'KeyE', 60, 400);

    // I12: Bing's house with nobody in
    await calm(page);
    await debug(page, 'tp', 'bing_home');
    await sleep(300);
    await put(page, 12.5, 57.4, 'up');
    await page.keyboard.down('ArrowUp');
    await waitFor(page, () => (window as any).__game.g.s.area === 'bing_in', "Bing's house", 6000).catch(() => null);
    await page.keyboard.up('ArrowUp');
    await sleep(500);
    const line = await page.evaluate(() => `${(window as any).__game.g.s.area}: ${(window as any).__game.g.rt.nudge}`);
    say('12 ' + line);
    if (!/ is (at .+|just outside)\./.test(line)) fails.add(`no "is at" line: ${line}`);
    await shot(page, OUT, '9-is-at-line');
    for (const e of await gameErrors(page)) fails.add(`page error: ${e}`);
  } catch (e) {
    fails.add(String(e));
    await shot(page, OUT, 'error').catch(() => null);
  } finally {
    await run.close();
    server.stop();
  }
  void G;
  console.log(fails.ok ? 'JOYS SHOTS OK' : `JOYS SHOTS FAIL: ${fails.list.join('; ')}`);
  process.exit(fails.ok ? 0 : 1);
}

await main();
