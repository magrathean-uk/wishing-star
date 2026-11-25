// Touch run (package 65): the game on an iPad, by finger only, in headless WebKit at 1180 x 820 with touch on and in
// Chrome's emulation of an iPad. The title by taps, a new game by taps, walking with the stick (and the stick with a
// button at the same time), talk, pick up, the bag and the map opened and closed, a fight, Keepy Uppy and the pause
// menu; then texture memory and frame time. With --players-dist it also runs players mode on its own server: the
// list by taps, the password typed through the hidden input, and Continue at the same place after the page is
// dropped. A laptop check: Chrome without touch draws no touch control. Muted, headless, page titles start with TEST.
// Run: node tools/bot/touch.ts --url http://127.0.0.1:4194/ [--players-dist <built game>] [--only webkit|chrome]
//      [--soak <minutes>] Prints TOUCH OK or the failures.
import { type ChildProcess, spawn } from 'node:child_process';
import { copyFileSync, cpSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { CDPSession, Page } from '@playwright/test';
import { debug, Fails, heroPos, type Launched, launch, RESULTS, ROOT, shot, sleep, waitFor } from './lib.ts';

const argv = process.argv.slice(2);
const arg = (k: string, d = '') => {
  const i = argv.indexOf(k);
  return i >= 0 ? (argv[i + 1] ?? d) : d;
};
const URL_ = arg('--url', 'http://127.0.0.1:4194/');
const PLAYERS_DIST = arg('--players-dist');
const PLAYERS_PORT = Number(arg('--players-port', '4198'));
const ONLY = arg('--only');
const SOAK_MIN = Number(arg('--soak', '10'));
const DIR = join(RESULTS, 'touch');
const FOR_G = '/Volumes/4TB/dev/work/jobs/wishing-star/for-G/touch';
mkdirSync(DIR, { recursive: true });
const fails = new Fails();
const numbers: string[] = [];
const ok = (cond: boolean, what: string) => {
  if (cond) console.log(`  ok   ${what}`);
  else fails.add(what);
  return cond;
};

// ---------------------------------------------------------------- touching

/** One way to put fingers on the screen: real touch events in Chrome (DevTools), pointer events in WebKit. */
interface Hand {
  down(id: number, x: number, y: number): Promise<void>;
  move(id: number, x: number, y: number): Promise<void>;
  up(id: number): Promise<void>;
}
function cdpHand(cdp: CDPSession): Hand {
  const pts = new Map<number, { x: number; y: number; id: number }>();
  const send = (type: string) =>
    cdp.send('Input.dispatchTouchEvent', { type: type as 'touchStart', touchPoints: [...pts.values()] });
  return {
    async down(id, x, y) {
      pts.set(id, { x, y, id });
      await send('touchStart');
    },
    async move(id, x, y) {
      pts.set(id, { x, y, id });
      await send('touchMove');
    },
    async up(id) {
      pts.delete(id);
      await send(pts.size ? 'touchEnd' : 'touchEnd');
    },
  };
}
function pointerHand(page: Page): Hand {
  const fire = (type: string, id: number, x: number, y: number) =>
    page.evaluate(
      ([type, id, x, y]) => {
        const st = ((window as any).__touchAt ??= {}) as Record<number, Element>;
        const t = type === 'pointerdown' ? document.elementFromPoint(x as number, y as number) : st[id as number];
        if (type === 'pointerdown' && t) st[id as number] = t;
        (t ?? window).dispatchEvent(
          new PointerEvent(type as string, {
            pointerId: id as number,
            pointerType: 'touch',
            isPrimary: id === 1,
            clientX: x as number,
            clientY: y as number,
            bubbles: true,
            cancelable: true,
          }),
        );
      },
      [type, id, x, y] as [string, number, number, number],
    );
  const last = new Map<number, [number, number]>();
  return {
    async down(id, x, y) {
      last.set(id, [x, y]);
      await fire('pointerdown', id, x, y);
    },
    async move(id, x, y) {
      last.set(id, [x, y]);
      await fire('pointermove', id, x, y);
    },
    async up(id) {
      const [x, y] = last.get(id) ?? [0, 0];
      await fire('pointerup', id, x, y);
    },
  };
}

/** Game screen (1920 x 1080) to page pixels. */
async function g2c(page: Page, gx: number, gy: number): Promise<[number, number]> {
  return page.evaluate(
    ([x, y]) => {
      const r = (window as any).__game.game.canvas.getBoundingClientRect();
      return [r.left + (x! * r.width) / 1920, r.top + (y! * r.height) / 1080] as [number, number];
    },
    [gx, gy],
  );
}
async function tapGame(page: Page, gx: number, gy: number): Promise<void> {
  const [x, y] = await g2c(page, gx, gy);
  await page.touchscreen.tap(x, y);
}
async function centre(page: Page, sel: string): Promise<[number, number]> {
  const b = await page.locator(sel).first().boundingBox();
  if (!b) throw new Error(`${sel} is not on the page`);
  return [b.x + b.width / 2, b.y + b.height / 2];
}
async function tapEl(page: Page, sel: string): Promise<void> {
  const [x, y] = await centre(page, sel);
  await page.touchscreen.tap(x, y);
}
async function holdEl(page: Page, hand: Hand, sel: string, ms: number, id = 7): Promise<void> {
  const [x, y] = await centre(page, sel);
  await hand.down(id, x, y);
  await sleep(ms);
  await hand.up(id);
}
/** The stick: a thumb lands in the left half and slides `dx, dy`, held `ms`. */
async function stick(page: Page, hand: Hand, dx: number, dy: number, ms: number, during?: () => Promise<void>) {
  const vp = page.viewportSize()!;
  const x0 = vp.width * 0.18;
  const y0 = vp.height * 0.62;
  await hand.down(1, x0, y0);
  for (let i = 1; i <= 5; i++) {
    await hand.move(1, x0 + (dx * i) / 5, y0 + (dy * i) / 5);
    await sleep(16);
  }
  if (during) await during();
  await sleep(ms);
  await hand.up(1);
}

const where = (page: Page) =>
  page.evaluate(() => {
    const w = (window as any).__game;
    const sc = String(w?.scene ?? '');
    const g = w?.g;
    const ui = w?.game.scene.getScene('UI');
    return {
      scene: sc,
      mode: g?.rt.mode ?? '',
      talk: !!g?.rt.talk,
      cut: !!g?.rt.cut,
      // what menu is open, from its own fields (class names are shortened in a build)
      overlay:
        !ui?.sys.isActive() || !ui.overlay
          ? ''
          : 'zone' in ui.overlay
            ? 'Bag'
            : 'signs' in ui.overlay
              ? 'Map'
              : 'bars' in ui.overlay
                ? 'Quest'
                : 'leaving' in ui.overlay
                  ? 'Pause'
                  : 'Menu',
    };
  });
const spaceWord = (page: Page) => page.evaluate(() => document.querySelector('#touch .space')?.textContent ?? '');
const controlsOn = (page: Page) => page.evaluate(() => !!document.querySelector('#touch.on'));

/** Through story scenes and talk by finger only: hold X on a scene, tap the screen on talk and cards. */
async function toPlay(page: Page, hand: Hand, ms = 120000): Promise<number> {
  const t0 = Date.now();
  let taps = 0;
  for (;;) {
    const w = await where(page);
    if (w.mode === 'play' && !w.talk && !w.cut && !w.overlay) {
      await sleep(500);
      const again = await where(page);
      if (again.mode === 'play' && !again.talk && !again.cut && !again.overlay) return taps;
    }
    if (Date.now() - t0 > ms) throw new Error(`not in play after ${ms} ms (mode ${w.mode})`);
    if (w.cut) await holdEl(page, hand, '#touch .x', 1500);
    else if (w.overlay) await tapEl(page, '#touch .x');
    else await tapGame(page, 960, 500);
    taps++;
    await sleep(250);
  }
}

// ---------------------------------------------------------------- one engine

async function run(name: string, L: Launched, isChrome: boolean): Promise<void> {
  const { page } = L;
  const dir = join(DIR, name);
  mkdirSync(dir, { recursive: true });
  const hand = isChrome ? cdpHand(await L.ctx.newCDPSession(page)) : pointerHand(page);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  console.log(`\n${name}: ${JSON.stringify(page.viewportSize())}`);
  const t0 = Date.now();
  await page.goto(URL_);
  await waitFor(
    page,
    () => {
      const t = (window as any).__game?.game.scene.getScene('Title');
      return t?.sys.isActive() && t.mode === 'menu' && t.items?.length;
    },
    'the title menu',
    60000,
  );
  numbers.push(`${name}: title after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  const atBoot = await controlsOn(page);
  console.log(`  controls at boot (coarse pointer): ${atBoot}`);
  if (!atBoot) await page.touchscreen.tap(20, 20);
  ok(await controlsOn(page), 'touch controls show on a touch device');
  await sleep(300);
  ok((await spaceWord(page)) === 'Go', `Space says Go on the title (${await spaceWord(page)})`);
  await sleep(600);
  await shot(page, dir, '01-title');

  // the title by taps: Play
  const row = await page.evaluate(() => {
    const t = (window as any).__game.game.scene.getScene('Title');
    const i = (t.items as string[]).indexOf('Play');
    const b = t.labels[i].getBounds();
    return [b.centerX, b.centerY] as [number, number];
  });
  await tapGame(page, row[0], row[1]);
  ok(
    await waitFor(page, () => String((window as any).__game.scene).includes('HeroSelect'), 'hero select', 8000)
      .then(() => true)
      .catch(() => false),
    'a tap on Play opens hero select',
  );
  await sleep(800);
  await shot(page, dir, '02-hero');
  // a tap on Koala moves there and picks her
  const koala = await page.evaluate(() => {
    const h = (window as any).__game.game.scene.getScene('HeroSelect');
    const i = (h.ids as string[]).indexOf('koala');
    const b = h.puppets[i].sprite.getBounds();
    return [b.centerX, b.centerY, i, h.sel] as [number, number, number, number];
  });
  await tapGame(page, koala[0], koala[1]);
  ok(
    await waitFor(page, () => String((window as any).__game.scene).includes('World'), 'the world', 15000)
      .then(() => true)
      .catch(() => false),
    `a tap on Koala (index ${koala[2]}, chosen was ${koala[3]}) starts the game`,
  );
  const hero = await page.evaluate(() => (window as any).__game.g?.s.hero);
  ok(hero === 'koala', `the hero is the one tapped (${hero})`);
  await sleep(1500);
  await shot(page, dir, '03-first-scene');
  const taps = await toPlay(page, hand);
  console.log(`  into play by finger: ${taps} taps or holds`);
  await sleep(800);
  await shot(page, dir, '04-play');

  // walk with the stick
  const p0 = await heroPos(page);
  await stick(page, hand, 70, 0, 900, () => shot(page, dir, '05-stick').then(() => undefined));
  const p1 = await heroPos(page);
  await stick(page, hand, 0, 70, 700);
  const p2 = await heroPos(page);
  ok(p1.x > p0.x || p2.y > p1.y, `the stick walks her (${p0.x},${p0.y} to ${p1.x},${p1.y} to ${p2.x},${p2.y})`);
  // the stick and Space at the same time: Space goes down while an arrow is held
  await page.evaluate(() => {
    const log: string[] = [];
    (window as any).__keylog = log;
    const held = new Set<string>();
    window.addEventListener('keydown', (e) => {
      held.add(e.code);
      if (e.code === 'Space') log.push([...held].join('+'));
    });
    window.addEventListener('keyup', (e) => held.delete(e.code));
  });
  const [sx, sy] = await centre(page, '#touch .space');
  await stick(page, hand, -70, 0, 300, async () => {
    await hand.down(2, sx, sy);
    await sleep(120);
    await hand.up(2);
  });
  const both = await page.evaluate(() => ((window as any).__keylog as string[]).join(' '));
  ok(/Arrow\w+\+Space|Space\+Arrow/.test(both), `stick and button at once (${both || 'nothing'})`);

  // talk: stand by a friend and tap Space; the button names it
  await debug(page, 'tp', 'grandad');
  await sleep(600);
  const npc = await page.evaluate(() => {
    const g = (window as any).__game.g;
    const s = g.s;
    let best: any = null;
    for (const n of g.rt.npcs ?? []) {
      if (n.area && n.area !== s.area) continue;
      const d = Math.hypot(n.x - s.x, n.y - s.y);
      if (!best || d < best.d) best = { d, x: n.x, y: n.y, id: n.id };
    }
    return best;
  });
  let talked = false;
  if (npc) {
    // put her next to the friend, facing them
    await page.evaluate(
      ([x, y]) => {
        const s = (window as any).__game.g.s;
        s.x = x;
        s.y = (y as number) + 1.2;
        s.dir = 'up';
      },
      [npc.x, npc.y],
    );
    await sleep(500);
    const word = await spaceWord(page);
    await shot(page, dir, '06-talk-word');
    await tapEl(page, '#touch .space');
    talked = await waitFor(page, () => !!(window as any).__game.g.rt.talk, 'talk', 3000)
      .then(() => true)
      .catch(() => false);
    console.log(`  Space said "${word}" by ${npc.id}`);
    if (talked) {
      await sleep(700);
      await shot(page, dir, '07-talk');
    }
  }
  ok(talked, `talk by the Space button (${npc?.id ?? 'no friend near'})`);
  await toPlay(page, hand, 60000);

  // pick up: a thing on the ground in front of her, then Space
  const before = await page.evaluate(() => {
    const s = (window as any).__game.g.s;
    s.dir = 'down';
    s.drops.push({ area: s.area, x: s.x, y: s.y + 1, id: 'apple', n: 1 });
    return s.drops.length;
  });
  await sleep(300);
  await tapEl(page, '#touch .space');
  await sleep(600);
  let after = await page.evaluate(() => (window as any).__game.g.s.drops.length);
  if (after >= before) {
    await stick(page, hand, 0, 70, 400);
    after = await page.evaluate(() => (window as any).__game.g.s.drops.length);
  }
  ok(after < before, `pick up an apple from the ground (${before} to ${after} things on the ground)`);
  await toPlay(page, hand, 30000);

  // the bag and the map from the row at the top; a tap outside the panel closes them (outdoors: no table near)
  await debug(page, 'tp', 'sign_square');
  await toPlay(page, hand, 30000);
  for (const [k, file, want] of [
    ['KeyE', '08-bag', 'Bag'],
    ['KeyM', '09-map', 'Map'],
    ['KeyQ', '10-quests', 'Quest'],
  ] as const) {
    await tapEl(page, `#touch .row [data-key="${k}"]`);
    const open = await waitFor(page, () => !!(window as any).__game.game.scene.getScene('UI').overlay, 'a menu', 3000)
      .then(() => true)
      .catch(() => false);
    const which = (await where(page)).overlay;
    ok(open && which.includes(want), `the ${want} button opens it (${which})`);
    await sleep(600);
    await shot(page, dir, file);
    if (k === 'KeyE') {
      // a tap on a cell moves there and picks it
      const cell = await page.evaluate(() => {
        const o = (window as any).__game.game.scene.getScene('UI').overlay;
        return ['zone' in (o ?? {}) ? 'bag' : 'not the bag', o?.sel] as [string, number];
      });
      // the bag's cells are drawn with kit.slot(): find the 10th one on the screen
      const target = await page.evaluate(() => {
        const o = (window as any).__game.game.scene.getScene('UI').overlay;
        const imgs: any[] = [];
        const walk = (l: any[]) => {
          for (const c of l) {
            if (c.list) walk(c.list);
            else if (c.type === 'Image' && c.visible) imgs.push(c);
          }
        };
        walk(o.root.list);
        return [o.sel, imgs.length] as [number, number];
      });
      await tapGame(page, 960 - 200, 330);
      await sleep(1500);
      const cell2 = await page.evaluate(() => {
        const o = (window as any).__game.game.scene.getScene('UI').overlay;
        return ['zone' in (o ?? {}) ? 'bag' : 'not the bag', o?.sel, o?.held ?? ''] as [string, number, unknown];
      });
      console.log(`  bag: ${cell.join(' ')} then a tap on a cell: ${cell2.join(' ')} (${target.join(' ')})`);
      ok(cell2[1] !== cell[1], 'a tap on a bag cell moves the choice there');
      await shot(page, dir, '08b-bag-tapped');
      await tapEl(page, '#touch .x');
      await sleep(400);
    }
    // outside every panel: the dark band at the very top
    for (let i = 0; i < 3 && (await where(page)).overlay; i++) {
      await tapGame(page, 960, 4);
      await sleep(500);
    }
    ok(!(await where(page)).overlay, `a tap outside closes the ${want}`);
  }

  // a fight: a wooden sword, a zombie in front of her in the forest, Space swings
  await debug(page, 'tp', 'sign_forest');
  await toPlay(page, hand, 30000);
  await page.evaluate(() => {
    const g = (window as any).__game.g;
    g.s.dir = 'right';
    g.s.gear.sword = 'wood_sword';
    g.s.pouch.wood_sword = Math.max(1, g.s.pouch.wood_sword ?? 0);
  });
  await debug(page, 'spawn', 'zombie:1');
  const mob0 = await page.evaluate(() => {
    const g = (window as any).__game.g;
    const m = g.rt.mobs[g.rt.mobs.length - 1];
    if (!m) return null;
    m.x = g.s.x + 1;
    m.y = g.s.y;
    m.calm = false;
    return { hp: m.hp, n: g.rt.mobs.length };
  });
  let swung = false;
  if (mob0) {
    await sleep(300);
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => {
        const g = (window as any).__game.g;
        const m = g.rt.mobs[g.rt.mobs.length - 1];
        if (m) {
          m.x = g.s.x + 1;
          m.y = g.s.y;
        }
        g.s.dir = 'right';
      });
      await tapEl(page, '#touch .space');
      if (i === 1) await shot(page, dir, '11-fight');
      await sleep(450);
    }
    const mob1 = await page.evaluate(() => {
      const g = (window as any).__game.g;
      const m = g.rt.mobs[g.rt.mobs.length - 1];
      return { hp: m?.hp ?? 0, n: g.rt.mobs.length };
    });
    swung = mob1.n < mob0.n || mob1.hp < mob0.hp;
    console.log(`  fight: zombie hp ${mob0.hp} to ${mob1.hp}, mobs ${mob0.n} to ${mob1.n}`);
  }
  ok(swung, 'Space swings and hits a zombie');
  await page.evaluate(() => {
    const g = (window as any).__game.g;
    g.rt.mobs.length = 0;
    g.s.hp = g.s.maxHp;
  });
  await toPlay(page, hand, 30000);

  // Keepy Uppy: the start card by a tap, then the stick and Space
  await debug(page, 'mini', 'keepy');
  const inMini = await waitFor(page, () => (window as any).__game.g.rt.mode === 'mini', 'Keepy Uppy', 4000)
    .then(() => true)
    .catch(() => false);
  ok(inMini, 'Keepy Uppy starts');
  if (inMini) {
    await sleep(900);
    await shot(page, dir, '12-keepy-card');
    const m0 = await page.evaluate(() => JSON.stringify((window as any).__game.g.rt.mini?.st ?? null));
    await tapGame(page, 960, 520);
    await sleep(700);
    await tapEl(page, '#touch .space');
    for (let i = 0; i < 4; i++) {
      await stick(page, hand, i % 2 ? 70 : -70, 0, 300, async () => {
        await hand.down(2, sx, sy);
        await sleep(80);
        await hand.up(2);
      });
    }
    await shot(page, dir, '13-keepy-play');
    const m1 = await page.evaluate(() => JSON.stringify((window as any).__game.g.rt.mini?.st ?? null));
    ok(m0 !== m1, 'Keepy Uppy answers taps and the stick');
    await debug(page, 'skip', 3);
    await sleep(1200);
    await toPlay(page, hand, 30000);
  }

  // the pause menu: a tap on Options moves there and picks it; a tap outside goes back
  await tapEl(page, '#touch .row [data-key="KeyP"]');
  const paused = await waitFor(
    page,
    () => 'leaving' in ((window as any).__game.game.scene.getScene('UI').overlay ?? {}),
    'pause',
    3000,
  )
    .then(() => true)
    .catch(() => false);
  ok(paused, 'the pause button opens the pause menu');
  await sleep(600);
  ok(await page.evaluate(() => !!document.querySelector('#touch .full:not(.hide)')), 'Full screen shows in pause');
  await shot(page, dir, '14-pause');
  const opt = await page.evaluate(() => {
    const o = (window as any).__game.game.scene.getScene('UI').overlay;
    const t = o.labels[2];
    const b = t.getBounds();
    return [b.centerX + 200, b.centerY] as [number, number];
  });
  await tapGame(page, opt[0], opt[1]);
  const optOpen = await waitFor(
    page,
    () => (window as any).__game.game.scene.getScene('UI').overlay?.mode === 'options',
    'options',
    5000,
  )
    .then(() => true)
    .catch(() => false);
  ok(optOpen, 'a tap on Options opens Options');
  await sleep(500);
  await shot(page, dir, '15-options');
  await tapGame(page, 120, 540);
  await sleep(600);
  const mode1 = await page.evaluate(() => (window as any).__game.game.scene.getScene('UI').overlay?.mode ?? 'closed');
  ok(mode1 === 'main', `a tap outside goes back to the pause page (${mode1})`);
  await tapGame(page, 120, 540);
  await sleep(600);
  ok(!(await where(page)).overlay, 'a second tap outside closes the pause menu');

  // every other menu by taps (package 67)
  await toPlay(page, hand, 30000);
  await menus(page, hand, !isChrome);
  await toPlay(page, hand, 30000);
  await eatTap(page, !isChrome);

  // held upright: the turn card, and the game waits; sideways again: it carries on
  const vp = page.viewportSize()!;
  await page.setViewportSize({ width: vp.height, height: vp.width });
  await sleep(800);
  const t1 = await page.evaluate(() => (window as any).__game.g.s.time);
  await sleep(1000);
  const up = await page.evaluate(() => ({
    card: !!document.querySelector('#touch-card.on'),
    time: (window as any).__game.g.s.time,
  }));
  await shot(page, dir, '15b-upright');
  ok(up.card && up.time === t1, `held upright: the turn card shows and the game waits (${up.card}, ${t1} ${up.time})`);
  await page.setViewportSize(vp);
  await sleep(800);
  const side = await page.evaluate(() => ({
    card: !!document.querySelector('#touch-card.on'),
    time: (window as any).__game.g.s.time,
  }));
  await sleep(600);
  const moved = await page.evaluate((t) => (window as any).__game.g.s.time !== t, side.time);
  ok(!side.card && moved, 'sideways again: the card goes and the game carries on');

  // memory and frame time (WebKit counts for the iPad)
  await measure(page, name, 'after the first play');
  if (!isChrome && SOAK_MIN > 0) {
    await soak(page, hand, SOAK_MIN);
    await measure(page, name, `after ${SOAK_MIN} min of play`);
    await shot(page, dir, '16-after-soak');
  }
  const gameErr = await page.evaluate(() => (window as any).__game.errors as string[]);
  ok(errors.length === 0 && gameErr.length === 0, `no page errors (${[...errors, ...gameErr].join(' | ')})`);
}

// ---------------------------------------------------------------- "R: Eat" by a tap (package 78)

/** Hearts low, food in the bag: the strip offers "R: Eat" and a tap on it eats, as R does. */
async function eatTap(page: Page, pic: boolean): Promise<void> {
  const food = await inGame<string>(
    page,
    `const f = Object.keys(g.c.items).find((k) => (g.c.items[k].heal ?? 0) > 0) ?? '';
    if (f) { g.s.bag = g.s.bag.map(() => null); g.s.bag[0] = { id: f, n: 3 }; }
    g.s.maxHp = Math.max(g.s.maxHp, 10); g.s.hp = 2; g.rt.eatHint = true; return f;`,
  );
  await sleep(900);
  const shown = await inGame<string>(page, 'return ui.hintText.visible ? ui.hintText.text : "";');
  ok(/R: Eat/.test(shown), `the strip offers "R: Eat" with low hearts (${shown.replace(/\s+/g, ' ')})`);
  if (pic) await shot(page, 'ends', 'menu-eat-prompt');
  const [bx, by] = await inGame<[number, number]>(
    page,
    'const b = ui.hintText.getBounds(); return [b.right - 30, b.centerY];',
  );
  const hp0 = await inGame<number>(page, 'return g.s.hp;');
  await tapGame(page, bx, by);
  await sleep(700);
  const hp1 = await inGame<number>(page, 'return g.s.hp;');
  ok(!!food && hp1 > hp0, `a tap on "R: Eat" eats (${food}: hearts ${hp0} to ${hp1})`);
}

// ---------------------------------------------------------------- every other menu by taps (package 67)

/** Runs `body` in the page with w (the debug API), g (the game), ui (the UI scene) and o (the open menu). */
const inGame = <T>(page: Page, body: string): Promise<T> =>
  page.evaluate(
    `(() => { const w = window.__game; const g = w.g; const ui = w.game.scene.getScene('UI'); const o = ui.overlay; ${body} })()`,
  ) as Promise<T>;
const openMenu = async (page: Page, name: string, arg = ''): Promise<void> => {
  await inGame(page, `ui.open(${JSON.stringify(name)}, ${arg ? JSON.stringify(arg) : 'undefined'});`);
  await sleep(500);
};
const isOpen = async (page: Page) => !!(await where(page)).overlay;
/** A tap outside every panel (the dark band at the very top) closes the menu, as X does. */
async function outside(page: Page, want: string, times = 1): Promise<void> {
  for (let i = 0; i < times && (await isOpen(page)); i++) {
    await tapGame(page, 960, 4);
    await sleep(500);
  }
  ok(!(await isOpen(page)), `${want}: a tap outside closes it`);
}

/**
 * Each menu that answers taps itself (package 67): opened from the game, one thing picked with a tap and its effect
 * checked, then closed by a tap outside. `pics`: keep a picture of each after its tap in test-results/ends.
 */
async function menus(page: Page, hand: Hand, pics: boolean): Promise<void> {
  const snap = (name: string) => (pics ? shot(page, 'ends', `menu-${name}`).then(() => undefined) : Promise.resolve());
  await debug(page, 'tp', 'sign_square');
  await toPlay(page, hand, 30000);
  const bagCount = `const n = (id) => g.s.bag.reduce((a, sl) => a + (sl && sl.id === id ? sl.n : 0), 0) + (g.s.pouch[id] ?? 0);`;

  // craft: by a table, a tab tap changes the tab, a row tap makes it
  await debug(page, 'give', 'log:30');
  await debug(page, 'give', 'cobblestone:20');
  await inGame(
    page,
    `
    const s = g.s; const a = g.c.areas[s.area];
    const i = a.objects.findIndex((ob, k) => g.rt.live[s.area][k] && g.c.objects[ob.type]?.interact === 'table');
    if (i >= 0) { const ob = a.objects[i]; s.x = ob.x + 0.5; s.y = ob.y + (g.c.objects[ob.type].h ?? 1) + 0.6; return; }
    const item = Object.keys(g.c.items).find((k) => g.c.items[k].place?.use === 'table');
    s.placed.push({ k: 990001, item, area: s.area, x: Math.floor(s.x), y: Math.floor(s.y) + 1 });`,
  );
  await openMenu(page, 'craft');
  const t0 = await inGame<number>(page, 'return o.tab;');
  const t1 = (t0 + 1) % 4;
  await tapGame(page, 420 + t1 * 270 + 135, 212);
  await sleep(300);
  const t2 = await inGame<number>(page, 'return o.tab;');
  ok(t2 === t1, `craft: a tap on a tab changes the tab (${t0} to ${t2})`);
  let made = '';
  for (let tab = 0; tab < 4 && !made; tab++) {
    await tapGame(page, 420 + tab * 270 + 135, 212);
    await sleep(300);
    const row = await inGame<[number, string, number] | null>(
      page,
      `${bagCount}
      for (let i = o.top; i < Math.min(o.top + 5, o.list.length); i++) {
        const r = g.c.recipes[o.list[i]];
        if (Object.keys(r.in).every((k) => n(k) >= r.in[k])) return [i - o.top, r.out, g.s.counts.crafted ?? 0];
      }
      return null;`,
    );
    if (!row) continue;
    await tapGame(page, 960, 300 + row[0] * 100 + 45);
    await sleep(600);
    const after = await inGame<number>(page, 'return g.s.counts.crafted ?? 0;');
    if (after > row[2]) made = row[1];
  }
  ok(!!made, `craft: a tap on a row makes it (${made || 'nothing made'})`);
  await snap('craft');
  await outside(page, 'craft');

  // upgrade: a row tap answers as Space does (here: go to an anvil, or it is made better)
  await inGame(
    page,
    `g.s.gear.sword = g.s.gear.sword || 'wood_sword'; g.s.pouch[g.s.gear.sword] = Math.max(1, g.s.pouch[g.s.gear.sword] ?? 0);`,
  );
  await openMenu(page, 'upgrade');
  const k0 = await inGame<string>(page, 'return o.key;');
  await tapGame(page, 960, 410);
  await sleep(500);
  const up = await inGame<[string, string]>(page, 'return [o?.key ?? "", o?.noteT?.text ?? ""];');
  ok(up[0] !== k0 || !!up[1], `upgrade: a tap on the sword answers (${up[1] || 'made better'})`);
  await snap('upgrade');
  await outside(page, 'upgrade');
  await toPlay(page, hand, 30000);

  // shop: Sell and Buy tabs by taps, a row tap buys
  const stall = await inGame<string>(
    page,
    `const ids = Object.keys(g.c.stalls).filter((k) => g.c.stalls[k].sells?.length && k !== 'prizes');
    return ids.find((k) => g.c.stalls[k].buys) ?? ids[0] ?? '';`,
  );
  await inGame(page, 'g.s.emeralds += 60;');
  await openMenu(page, 'shop', stall);
  const canSell = await inGame<boolean>(page, 'return !!g.c.stalls[o.stall]?.buys;');
  if (canSell) {
    await tapGame(page, 960 - 580 + 220 + 100, 202);
    await sleep(300);
    ok((await inGame<string>(page, 'return o.tab;')) === 'sell', 'shop: a tap on Sell changes the tab');
    await tapGame(page, 960 - 580 + 100, 202);
    await sleep(300);
  }
  const buy = await inGame<[number, number] | null>(
    page,
    `const i = o.list.findIndex((r) => r.ok); return i < 0 ? null : [i - o.top, g.s.emeralds];`,
  );
  if (buy) {
    await tapGame(page, 960, 256 + buy[0] * 94 + 42);
    await sleep(500);
    // package 68: a price over 5 emeralds asks first; the second row of the box is "Yes, buy it"
    if (await inGame<boolean>(page, 'return !!o.ask;')) {
      await tapGame(page, 960, 612);
      await sleep(500);
    }
    const e1 = await inGame<number>(page, 'return g.s.emeralds;');
    ok(e1 < buy[1], `shop ${stall}: a tap on a row buys it (${buy[1]} to ${e1} emeralds)`);
  } else ok(false, `shop ${stall}: nothing to buy`);
  await snap('shop');
  await outside(page, 'shop');

  // jukebox: a row tap plays that disc
  const disc = await inGame<string>(
    page,
    `const d = Object.keys(g.c.items).find((k) => g.c.items[k].kind === 'disc') ?? ''; if (d) g.s.pouch[d] = 1; return d;`,
  );
  await openMenu(page, 'jukebox');
  await tapGame(page, 960, 290 + 44);
  await sleep(400);
  const playing = await inGame<string>(page, 'return o.playing;');
  ok(!!disc && playing === disc, `jukebox: a tap on a disc plays it (${playing || 'nothing'})`);
  await snap('jukebox');
  await outside(page, 'jukebox');

  // quests: a row tap follows that quest
  await openMenu(page, 'quests');
  const q = await inGame<[number, string, string] | null>(
    page,
    `if (!o.list.length) return null; const j = o.list.length > 1 ? 1 : 0; return [j - o.top, o.list[j], g.s.tracked ?? ''];`,
  );
  if (q) {
    await tapGame(page, 960, 500 + q[0] * 90 + 40);
    await sleep(500);
    const tr = await inGame<string>(page, 'return g.s.tracked;');
    ok(tr === q[1], `quests: a tap on a row follows it (${q[2]} to ${tr})`);
    await snap('quests');
    if (q[2] && q[2] !== tr) await inGame(page, `w.cmd({ c: 'track', quest: ${JSON.stringify(q[2])} });`);
  } else console.log('  quests: no quest to follow');
  await outside(page, 'quests');

  // the plain map: a tap inside keeps it, outside closes it
  await openMenu(page, 'map');
  await tapGame(page, 600, 500);
  await sleep(400);
  ok(await isOpen(page), 'map: a tap on the map keeps it open');
  await snap('map');
  await outside(page, 'map');

  // travel: a tap on a signpost goes there
  await inGame(
    page,
    `
    const isl = g.c.areas.island;
    for (const k in isl.places) if (k.startsWith('sign_') && !g.s.signs.includes(k.slice(5))) g.s.signs.push(k.slice(5));`,
  );
  await openMenu(page, 'travel');
  const sign = await inGame<[number, number, string] | null>(
    page,
    `if (o.signs.length < 2) return null; const j = (o.sel + 1) % o.signs.length;
    const q = o.px(o.area.places['sign_' + o.signs[j]]); return [q.x, q.y, o.signs[j]];`,
  );
  if (sign) {
    const p0 = await heroPos(page);
    await tapGame(page, sign[0], sign[1]);
    await sleep(1500);
    const p1 = await heroPos(page);
    ok(!(await isOpen(page)) && (p1.x !== p0.x || p1.y !== p0.y), `travel: a tap on a signpost goes to ${sign[2]}`);
  } else ok(false, 'travel: fewer than 2 signposts');
  await toPlay(page, hand, 30000);

  // mirror: a tap on another hero's card moves the choice there (a friend not met yet: it stays open)
  await openMenu(page, 'mirror');
  const m = await inGame<[number, number, number, boolean]>(
    page,
    `let j = o.ids.findIndex((id, i) => i !== o.sel && !g.s.heroes.includes(id));
    if (j < 0) j = (o.sel + 1) % o.ids.length;
    return [o.cx(j), o.fy(j) - 100, j, g.s.heroes.includes(o.ids[j])];`,
  );
  const hero0 = await inGame<string>(page, 'return g.s.hero;');
  await tapGame(page, m[0], m[1]);
  await sleep(500);
  if (m[3]) {
    const h1 = await inGame<string>(page, 'return g.s.hero;');
    ok(h1 !== hero0 && !(await isOpen(page)), `mirror: a tap on a hero swaps to them (${h1})`);
    await inGame(page, `w.cmd({ c: 'hero', id: ${JSON.stringify(hero0)} });`);
  } else {
    ok(
      (await inGame<number>(page, 'return o?.sel ?? -1;')) === m[2],
      `mirror: a tap on a card moves the choice to ${m[2]}`,
    );
    await snap('mirror');
    await outside(page, 'mirror');
  }
  await toPlay(page, hand, 30000);

  // journal: a tab tap turns the page, a cell tap looks at it, outside is back then close
  await openMenu(page, 'journal');
  await tapGame(page, 300 + 2 * 330 + 165, 88);
  await sleep(300);
  ok((await inGame<number>(page, 'return o.page;')) === 2, 'journal: a tap on a tab turns to that page');
  await tapGame(page, 300 + 165, 88);
  await sleep(300);
  const friends = await inGame<number>(page, 'return o.list.length;');
  if (friends) {
    await tapGame(page, 70 + 100, 270 + 90);
    await sleep(300);
    ok(await inGame<boolean>(page, 'return o.inGrid && o.sel === 0;'), 'journal: a tap on a friend looks at them');
  }
  await snap('journal');
  await outside(page, 'journal', 2);

  // mail: a row tap opens the letter, taps on it read it to the end
  const letter = await inGame<string>(
    page,
    `const id = Object.keys(g.c.letters).find((k) => g.c.letters[k].text?.length && k !== 'dad_finale') ?? Object.keys(g.c.letters)[0];
    if (id && !g.s.inbox.includes(id)) g.s.inbox.push(id); return id ?? '';`,
  );
  await openMenu(page, 'mail');
  const mrow = await inGame<number>(
    page,
    `const i = o.ids.indexOf(${JSON.stringify(letter)}); const top = Math.max(0, Math.min(o.sel - 3, o.ids.length - 7)); return i - top;`,
  );
  await tapGame(page, 960, 250 + mrow * 96 + 42);
  await sleep(400);
  ok((await inGame<string>(page, 'return o.open ?? "";')) === letter, `mail: a tap on a letter opens it (${letter})`);
  await snap('mail');
  for (let i = 0; i < 8 && (await inGame<boolean>(page, 'return !!o?.open;')); i++) {
    await tapGame(page, 960, 500);
    await sleep(300);
  }
  ok(
    await inGame<boolean>(page, `return !g.s.inbox.includes(${JSON.stringify(letter)});`),
    'mail: taps on the letter read it to the end',
  );
  await outside(page, 'mail');
  await toPlay(page, hand, 30000);

  // the board: a card tap takes the job (early in the game no job is up yet: one is put up for this check only)
  await inGame(
    page,
    `const d = Object.values(g.c.quests).find((q) => q.board && !g.s.quests[q.id]);
     if (d) { window.__req = [d.id, d.requires]; d.requires = undefined; }`,
  );
  await openMenu(page, 'board');
  const job = await inGame<[number, string] | null>(page, 'return o.ids.length ? [o.cardX(0) + 230, o.ids[0]] : null;');
  if (job) {
    await tapGame(page, job[0], 250 + 210);
    await sleep(500);
    ok(
      !(await isOpen(page)) && (await inGame<boolean>(page, `return !!g.s.quests[${JSON.stringify(job[1])}];`)),
      `board: a tap on a job takes it (${job[1]})`,
    );
    await toPlay(page, hand, 30000);
  } else {
    fails.add('board: no job to take');
    await snap('board');
    await outside(page, 'board');
  }

  // put the board's job back as it was
  await inGame(page, 'const r = window.__req; if (r) g.c.quests[r[0]].requires = r[1];');

  // the photo: a cell tap picks a friend (3 friends met for this check, so there is a choice)
  await inGame(page, `g.s.met ??= {}; for (const id of Object.keys(g.c.chars).slice(0, 4)) g.s.met[id] ??= g.s.day;`);
  await openMenu(page, 'photo');
  const need = await inGame<number>(page, 'return o.need;');
  if (need > 1) {
    await tapGame(page, 960 - 3 * 280 + 140, 150 + 135);
    await sleep(400);
    ok((await inGame<number>(page, 'return o.picked.size;')) === 1, 'photo: a tap on a friend picks them');
    await snap('photo');
  } else fails.add(`photo: ${need} friends met, nothing to pick`);
  await outside(page, 'photo');

  // the look-only pages and the any-key cards: any tap closes them
  const site = await inGame<string>(page, 'return g.c.areas.island.sites[0]?.id ?? "";');
  for (const [name, arg] of [
    ['shop', 'fishboard'],
    ['shop', 'cups'],
    ['nature', ''],
    ['site', site],
    ['radar', ''],
  ] as const) {
    await openMenu(page, name, arg);
    ok(await isOpen(page), `${arg || name} opens`);
    if (name === 'nature' || arg === 'cups') await snap(arg || name);
    await tapGame(page, 960, 520);
    await sleep(500);
    ok(!(await isOpen(page)), `${arg || name}: any tap closes it`);
  }

  // writing a sign: a tap on the game does nothing while the text field is open; Escape in the field closes it
  await openMenu(page, 'signtext', '0');
  await tapGame(page, 960, 900);
  await sleep(300);
  ok(await isOpen(page), 'sign words: a tap on the game keeps the text field');
  await snap('signtext');
  await page.evaluate(() =>
    document
      .getElementById('name-input')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
  );
  await sleep(400);
  ok(!(await isOpen(page)), 'sign words: Escape closes it');

  // the finale: taps read the letter, Back skips the photo, taps end the credits
  await openMenu(page, 'finale');
  const phases: string[] = [];
  for (let i = 0; i < 30 && (await isOpen(page)); i++) {
    const ph = await inGame<string>(page, 'return o?.phase ?? "";');
    if (phases.at(-1) !== ph) phases.push(ph);
    if (ph === 'credits' && pics && !phases.includes('shot')) {
      await snap('finale');
      phases.push('shot');
    }
    // the photo picker keeps its picks on a tap outside (issue 57): Back skips it, as she would
    if (ph === 'photo') await tapEl(page, '#touch .x');
    else await tapGame(page, 960, 500);
    await sleep(ph === 'snap' ? 1200 : 500);
  }
  const fin = phases.filter((p) => p !== 'shot').join(' ');
  ok(!(await isOpen(page)) && fin.includes('credits'), `finale: taps carry it to the end (${fin})`);
  await toPlay(page, hand, 30000);
}

/** Texture memory the game holds (its own count of resident art) and frame time over 5 s. */
async function measure(page: Page, name: string, when: string): Promise<void> {
  const m = await page.evaluate(async () => {
    const w = (window as any).__game;
    const b = w.perf().bytes as { chars: number; ground: number; other: number };
    // every texture source Phaser holds, to catch what the count above leaves out
    let all = 0;
    const tm = w.game.textures;
    for (const k of tm.getTextureKeys()) for (const s of tm.get(k).source) all += (s.width || 0) * (s.height || 0) * 4;
    const d: number[] = [];
    await new Promise<void>((done) => {
      let last = performance.now();
      const t0 = last;
      const f = (t: number) => {
        d.push(t - last);
        last = t;
        if (t - t0 < 5000) requestAnimationFrame(f);
        else done();
      };
      requestAnimationFrame(f);
    });
    d.shift();
    d.sort((a, b) => a - b);
    const avg = d.reduce((a, b) => a + b, 0) / Math.max(1, d.length);
    return {
      chars: b.chars,
      ground: b.ground,
      other: b.other,
      all,
      avg,
      p95: d[Math.floor(d.length * 0.95)] ?? 0,
      heap: (performance as any).memory?.usedJSHeapSize ?? 0,
    };
  });
  const MB = (n: number) => (n / 1048576).toFixed(0);
  const line =
    `${name} ${when}: textures ${MB(m.all)} MB in all (chars ${MB(m.chars)}, ground ${MB(m.ground)}, ` +
    `other ${MB(m.other)}), frame ${m.avg.toFixed(1)} ms average, ${m.p95.toFixed(1)} ms p95` +
    (m.heap ? `, JS heap ${MB(m.heap)} MB` : '');
  numbers.push(line);
  console.log(`  ${line}`);
}

/** Ten minutes of play by finger: places all over the world, the stick, menus, talk. */
async function soak(page: Page, hand: Hand, minutes: number): Promise<void> {
  const places = await page.evaluate(() => {
    const g = (window as any).__game.g;
    const out: string[] = [];
    for (const [id, a] of Object.entries(g.c.areas) as [string, any][])
      for (const o of a.objects ?? []) if (o.type === 'sign' || o.type === 'signpost') out.push(o.id ?? id);
    return out.filter(Boolean);
  });
  const fallback = ['great_tree', 'grandad', 'sign_square', 'sign_forest', 'sign_home', 'kuromi', 'bed_side'];
  const list = places.length >= 4 ? places : fallback;
  const end = Date.now() + minutes * 60000;
  let i = 0;
  while (Date.now() < end) {
    await debug(page, 'tp', list[i % list.length]!);
    await toPlay(page, hand, 30000).catch(() => undefined);
    for (const [dx, dy] of [
      [70, 0],
      [0, 70],
      [-70, 0],
      [0, -70],
    ])
      await stick(page, hand, dx!, dy!, 1200);
    if (i % 3 === 0) {
      await tapEl(page, '#touch .row [data-key="KeyE"]');
      await sleep(1200);
      await tapGame(page, 960, 4);
      await sleep(400);
    }
    i++;
  }
  console.log(`  soak: ${i} places in ${minutes} min`);
}

// ---------------------------------------------------------------- players mode

async function players(
  name: string,
  L: Launched,
  isChrome: boolean,
  base: string,
  pw: Record<string, string>,
  row: number,
) {
  const { page } = L;
  const dir = join(DIR, `${name}-players`);
  mkdirSync(dir, { recursive: true });
  const hand = isChrome ? cdpHand(await L.ctx.newCDPSession(page)) : pointerHand(page);
  console.log(`\n${name} players mode`);
  await page.goto(base);
  await waitFor(page, () => (window as any).__game?.game.scene.getScene('Title')?.mode === 'who', 'the list', 30000);
  if (!(await controlsOn(page))) await page.touchscreen.tap(20, 20);
  await sleep(500);
  await shot(page, dir, '01-list');
  // a tap on Player 2 (not the chosen row): the boxes come and the hidden input has the keyboard
  // each engine its own player, so each starts with no saved game
  const rowAt = await page.evaluate((i) => {
    const t = (window as any).__game.game.scene.getScene('Title');
    return [960, 110 + 124 + i * 64 + 28, i, t.picker.sel] as [number, number, number, number];
  }, row);
  await tapGame(page, rowAt[0], rowAt[1]);
  const pass = await waitFor(
    page,
    () => (window as any).__game.game.scene.getScene('Title').picker?.step === 'pass',
    'the password',
    4000,
  )
    .then(() => true)
    .catch(() => false);
  const focused = await page.evaluate(() => document.activeElement?.id ?? '');
  ok(pass, `a tap on row ${rowAt[2]} opens its password (chosen was ${rowAt[3]})`);
  ok(focused === 'pass-input', `the hidden input has the keyboard (${focused || 'nothing'})`);
  const attrs = await page.evaluate(() => {
    const i = document.getElementById('pass-input') as HTMLInputElement | null;
    return i
      ? ['autocapitalize', 'autocomplete', 'autocorrect', 'spellcheck', 'inputmode']
          .map((a) => `${a}=${i.getAttribute(a)}`)
          .join(' ') + ` font=${getComputedStyle(i).fontSize}`
      : '';
  });
  console.log(`  input: ${attrs}`);
  const who = await page.evaluate(
    (i) =>
      (window as any).__game.game.scene.getScene('Title').picker.sel === i &&
      ((window as any).__game.game.scene.getScene('Title').picker as any).head?.text,
    row,
  );
  const id = `p${row}`;
  // a wrong one first, then the right one, typed as the iPad's keyboard types into the focused box
  await page.keyboard.type('zzzz', { delay: 60 });
  const wrong = await waitFor(
    page,
    () => /Not quite/.test((window as any).__game.game.scene.getScene('Title').picker?.msg?.text ?? ''),
    'not quite',
    5000,
  )
    .then(() => true)
    .catch(() => false);
  ok(wrong, 'a wrong password typed through the input says Not quite');
  await shot(page, dir, '02-wrong');
  const scroll0 = await page.evaluate(() => [window.scrollX, window.scrollY, visualViewport?.scale ?? 1].join(','));
  await page.keyboard.type(pw[id]!.slice(0, 3), { delay: 60 });
  await sleep(200);
  const mirrored = await page.evaluate(() => (window as any).__game.game.scene.getScene('Title').picker?.typed ?? '');
  ok(mirrored === pw[id]!.slice(0, 3), `typed letters show in the boxes (${mirrored.length} of 3)`);
  await shot(page, dir, '03-typing');
  await page.keyboard.type(pw[id]!.slice(3), { delay: 60 });
  const inMenu = await waitFor(
    page,
    () => {
      const t = (window as any).__game.game.scene.getScene('Title');
      return t?.sys.isActive() && t.mode === 'menu';
    },
    'logged in',
    10000,
  )
    .then(() => true)
    .catch(() => false);
  ok(inMenu, `the 4th letter logs ${String(who)} in`);
  ok(scroll0 === '0,0,1', `the page did not move or zoom while typing (${scroll0})`);
  await sleep(500);
  await shot(page, dir, '04-menu');
  // Play, a hero by tap, play a little, save from the pause menu by taps
  const play = await page.evaluate(() => {
    const t = (window as any).__game.game.scene.getScene('Title');
    const i = (t.items as string[]).findIndex((s) => s === 'Play' || s === 'Continue');
    const b = t.labels[i].getBounds();
    return [b.centerX, b.centerY] as [number, number];
  });
  await tapGame(page, play[0], play[1]);
  await waitFor(page, () => String((window as any).__game.scene).includes('HeroSelect'), 'hero select', 8000);
  await sleep(600);
  await tapGame(page, 960, 1080 - 140);
  await waitFor(page, () => String((window as any).__game.scene).includes('World'), 'the world', 15000);
  await toPlay(page, hand);
  await stick(page, hand, 70, 0, 800);
  await tapEl(page, '#touch .row [data-key="KeyP"]');
  await sleep(500);
  const saveRow = await page.evaluate(() => {
    const b = (window as any).__game.game.scene.getScene('UI').overlay.labels[1].getBounds();
    return [b.centerX + 150, b.centerY] as [number, number];
  });
  await tapGame(page, saveRow[0], saveRow[1]);
  await sleep(1200);
  await tapGame(page, 120, 540);
  await sleep(400);
  const at = await heroPos(page);
  // the screen locks: hidden, then the page is dropped (pagehide) with no goodbye
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
  });
  await sleep(1500);
  const token = await page.evaluate(() => localStorage.getItem('ws_pl_token') ?? localStorage.getItem('ws_token'));
  const server = await page.evaluate(async (tok) => {
    const r = await fetch('api/save', { headers: tok ? { authorization: `Bearer ${tok}` } : {} });
    if (r.status !== 200) return null;
    const j = await r.json();
    const s = j.save?.s ?? j.s ?? j.save ?? j;
    return { area: s?.area, x: Math.floor(s?.x ?? -1), y: Math.floor(s?.y ?? -1) };
  }, token);
  console.log(`  server save after hiding: ${JSON.stringify(server)} (hero at ${at.area} ${at.x},${at.y})`);
  await page.close();
  // coming back: a new page in the same Safari, on the title with Continue
  const p2 = await L.ctx.newPage();
  const hand2 = isChrome ? cdpHand(await L.ctx.newCDPSession(p2)) : pointerHand(p2);
  await p2.goto(base);
  await waitFor(
    p2,
    () => {
      const t = (window as any).__game?.game.scene.getScene('Title');
      return t?.sys.isActive() && t.mode === 'menu' && t.items?.length;
    },
    'the title after a reload',
    30000,
  );
  const items = await p2.evaluate(() => (window as any).__game.game.scene.getScene('Title').items as string[]);
  ok(items[0] === 'Continue', `the title after the page was dropped offers Continue (${items.join(', ')})`);
  if (!(await controlsOn(p2))) await p2.touchscreen.tap(20, 20);
  await shot(p2, dir, '05-continue');
  const cont = await p2.evaluate(() => {
    const t = (window as any).__game.game.scene.getScene('Title');
    const b = t.labels[0].getBounds();
    return [b.centerX, b.centerY] as [number, number];
  });
  await tapGame(p2, cont[0], cont[1]);
  await waitFor(p2, () => !!(window as any).__game?.g && String((window as any).__game.scene).includes('World'), 'w');
  await sleep(1500);
  const back = await heroPos(p2);
  ok(
    back.area === at.area && Math.abs(back.x - at.x) <= 1 && Math.abs(back.y - at.y) <= 1,
    `Continue lands at the same place (${at.area} ${at.x},${at.y} then ${back.area} ${back.x},${back.y})`,
  );
  await shot(p2, dir, '06-back');
  void hand2;
}

function startPlayers(dist: string): { stop: () => void; ready: Promise<Record<string, string>> } {
  const work = '/Volumes/4TB/dev/work/jobs/wishing-star/65/players';
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  // server.js and the files it needs beside it (room.js since package 66)
  for (const f of readdirSync(join(ROOT, 'tools/release'))) {
    if (f.endsWith('.js')) copyFileSync(join(ROOT, 'tools/release', f), join(work, f));
  }
  copyFileSync(join(ROOT, 'tools/release/players-seed.json'), join(work, 'players-seed.json'));
  symlinkSync(resolve(dist), join(work, 'game'));
  const server: ChildProcess = spawn(process.execPath, [join(work, 'server.js'), '--players'], {
    env: { ...process.env, WS_PORT: String(PLAYERS_PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stop = () => {
    if (server.exitCode === null) server.kill('SIGTERM');
  };
  process.on('exit', stop);
  const ready = new Promise<Record<string, string>>((done, fail) => {
    let out = '';
    const t = setTimeout(() => fail(new Error(`players server did not start: ${out}`)), 15000);
    const on = (d: Buffer) => {
      out += String(d);
      if (!out.includes('is running at')) return;
      clearTimeout(t);
      const pw: Record<string, string> = {};
      for (const line of readFileSync(join(work, 'data/PASSWORDS.txt'), 'utf8').trim().split('\n')) {
        const [who, p] = line.split(': ');
        pw[who === 'Top of the list' ? 'hero' : `p${who!.replace('Player ', '')}`] = p!;
      }
      done(pw);
    };
    server.stdout!.on('data', on);
    server.stderr!.on('data', on);
  });
  return { stop, ready };
}

// ---------------------------------------------------------------- all of it

const engines: { name: string; isChrome: boolean; open: () => Promise<Launched> }[] = [
  { name: 'webkit', isChrome: false, open: () => launch('webkit', { width: 1180, height: 820, touch: true }) },
  { name: 'chrome-ipad', isChrome: true, open: () => launch('chromium', { touch: 'iPad Pro 11 landscape' }) },
].filter((e) => !ONLY || e.name.startsWith(ONLY));

// a laptop: no touch control is drawn
{
  const L = await launch('chromium', { width: 1280, height: 720 });
  await L.page.goto(URL_);
  await waitFor(L.page, () => (window as any).__game?.game.scene.getScene('Title')?.sys.isActive(), 'title', 60000);
  await L.page.keyboard.press('ArrowDown');
  const r = await L.page.evaluate(() => ({
    on: !!document.querySelector('#touch.on'),
    any: !!document.getElementById('touch'),
  }));
  console.log('laptop (Chrome, no touch)');
  ok(!r.on && !r.any, `no touch control on a laptop (layer made: ${r.any}, shown: ${r.on})`);
  await L.close();
}

for (const e of engines) {
  const L = await e.open();
  try {
    await run(e.name, L, e.isChrome);
  } catch (err) {
    fails.add(`${e.name}: ${String(err).split('\n')[0]}`);
    await shot(L.page, join(DIR, e.name), 'zz-failed').catch(() => undefined);
  }
  await L.close();
}

if (PLAYERS_DIST) {
  const srv = startPlayers(PLAYERS_DIST);
  try {
    const pw = await srv.ready;
    for (const e of engines) {
      const L = await e.open();
      try {
        await players(e.name, L, e.isChrome, `http://127.0.0.1:${PLAYERS_PORT}/`, pw, e.isChrome ? 3 : 2);
      } catch (err) {
        fails.add(`${e.name} players: ${String(err).split('\n')[0]}`);
      }
      await L.close();
    }
  } finally {
    srv.stop();
  }
}

try {
  mkdirSync(FOR_G, { recursive: true });
  cpSync(DIR, FOR_G, { recursive: true });
} catch {
  console.log(`could not copy the pictures to ${FOR_G}`);
}
console.log('\nnumbers:');
for (const n of numbers) console.log(`  ${n}`);
if (fails.ok) console.log('\nTOUCH OK');
else {
  console.log(`\nTOUCH FAILED (${fails.list.length})`);
  process.exitCode = 1;
}
