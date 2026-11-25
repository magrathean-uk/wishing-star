// Browser smoke run (npm run smoke): the built game in Chromium and WebKit, a new game with real keys (counted: at most
// 6 from the title to walking, 3 with the held-X skip; nothing is typed), the first prologue beats, the early map, quest marker, a toast,
// the mirror, the Options page and the Christmas layer, then one checkpoint per chapter with the finale's letter,
// group photo and credits, the three rare surprises, then every menu. Prints SMOKE OK or the failures.
// Each screenshot waits for its scene to settle (tweens landed, pictures in) so a reviewer sees what she sees.
// Then the home and island screens (place name, cloudy map, board, morning cards, Q at the workbench).
// Flags: --dev serves the source on 5173 instead of dist/ on 4173; --url uses a server already running; --only chromium|webkit runs one engine.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import {
  advanceToPlay,
  debug,
  holdXToSkip,
  type Engine,
  Fails,
  face,
  gameErrors,
  launch,
  openTitle,
  pressesToWalk,
  shot,
  sleep,
  startNewGame,
  startServer,
  tap,
  waitFor,
  waitTitleMenu,
  walkTo,
  wander,
  watch,
} from './lib.ts';

const CHECKPOINTS = ['prologue', 'ch1', 'ch2', 'ch3', 'ch4', 'ch5', 'ch6', 'ch7', 'finale'];
/** Menus to photograph: [file name, how to open it]. Keys are the real ones; crafting needs a table, so it is opened directly. */
const MENUS: [string, string][] = [
  ['20-bag', 'KeyE'],
  ['21-craft', 'craft'],
  ['22-map', 'KeyM'],
  ['23-journal', 'KeyK'],
  ['24-quests', 'KeyQ'],
  ['25-pause', 'KeyP'],
];

/** Wait for the screen to settle, then take the picture. */
async function still(page: Page, dir: string, name: string, ms = 900): Promise<void> {
  await sleep(ms);
  await shot(page, dir, name);
}

const overlayOpen = () => !!(window as any).__game.game.scene.getScene('UI').overlay;

/**
 * The thing she is using (UI.focus(): menu, rules card, talk box, morning card) is the only one shown, nothing
 * passive is drawn above it, and all of it is on the 1920 x 1080 UI area (G, build 5). '' when that holds.
 */
async function focusOnTop(page: Page, where: string, fails: Fails): Promise<void> {
  const why = await page.evaluate(() => {
    const u = (window as any).__game.game.scene.getScene('UI');
    const f = u.focus();
    const els: Record<string, any> = { menu: u.overlay?.root, card: u.card, talk: u.dlg, morning: u.cur?.box };
    const el = els[f];
    if (!f || !el) return '';
    if (!el.visible) return `${f} is not shown`;
    const others = Object.entries(els).filter(([k, o]) => k !== f && o?.visible && o.alpha > 0.01);
    if (others.length) return `${f} shares the screen with ${others.map(([k]) => k).join(', ')}`;
    // above it only its own parts: a menu's puppets (above 70), the Space picture under the talk (51)
    const own = (o: any) => (f === 'menu' && o.depth > el.depth) || (f === 'talk' && o === u.spaceCap);
    // an empty graphics layer or text draws nothing
    const empty = (o: any) => (o.type === 'Graphics' && !o.commandBuffer?.length) || (o.type === 'Text' && !o.text);
    const over = u.children.list.filter(
      (o: any) => o !== el && o.visible && o.alpha > 0.01 && o.depth > el.depth && !empty(o),
    );
    const bad = over.filter((o: any) => !own(o));
    if (bad.length) return `${bad.length} passive thing(s) over the ${f} (depth ${bad[0].depth})`;
    const b = el.getBounds();
    if (b.x < -1 || b.y < -1 || b.right > 1921 || b.bottom > 1081) return `${f} is partly off the screen`;
    return '';
  });
  if (why) fails.add(`${where}: ${why}`);
}

async function menus(page: Page, dir: string, fails: Fails): Promise<void> {
  for (const [name, how] of MENUS) {
    if (how.startsWith('Key')) await tap(page, how);
    else await page.evaluate((m: string) => (window as any).__game.game.scene.getScene('UI').open(m), how);
    const opened = await waitFor(page, overlayOpen, `menu ${name}`, 4000).catch(() => false);
    if (!opened) {
      fails.add(`menu ${name} did not open`);
      continue;
    }
    await still(page, dir, name, 700);
    await focusOnTop(page, `menu ${name}`, fails);
    for (let k = 0; k < 4 && (await page.evaluate(overlayOpen)); k++) await tap(page, 'KeyX', 60, 200);
    if (await page.evaluate(overlayOpen)) fails.add(`menu ${name} did not close with X`);
    await sleep(200);
  }
}

const toPlay = async (page: Page) => {
  for (let k = 0; k < 20 && (await page.evaluate(() => (window as any).__game.g.rt.mode)) !== 'play'; k++)
    await debug(page, 'skip');
};

/**
 * Home and island screens (package 42): a place name from the rules' place event, the map under cloud, the board
 * with at most 3 jobs, a morning card on its own (and a visitor's the next morning), and Q at Grandad's workbench.
 */
export async function islandCheck(page: Page, dir: string, fails: Fails): Promise<void> {
  await toPlay(page);
  await closeUi(page);
  // a place name: forget the region she stands in, and the rules find it again and fire 'place'
  const region = await page.evaluate(() => {
    const g = (window as any).__game.g;
    const a = g.c.areas[g.s.area];
    const code = a.region[Math.floor(g.s.y)]?.charAt(Math.floor(g.s.x));
    const r = Object.values(g.c.regions as Record<string, { id: string; code: string; name: string }>).find(
      (x) => x.code === code,
    );
    if (!r) return '';
    delete g.s.places[r.id];
    const u = (window as any).__game.game.scene.getScene('UI');
    u.nameSaid = '';
    return r.name.charAt(0).toUpperCase() + r.name.slice(1);
  });
  if (!region) fails.add('island: she is not in a region to find');
  else {
    const named = await waitFor(
      page,
      () => {
        const u = (window as any).__game.game.scene.getScene('UI');
        return u.areaBanner.alpha > 0.3 ? u.areaBanner.text : '';
      },
      'a place name',
      6000,
    ).catch(() => '');
    console.log(`  island: place name "${named}"`);
    if (named !== region) fails.add(`island: the place name showed "${named}", not "${region}"`);
    else await still(page, dir, '31-place-name', 100);
  }
  // the map under cloud: half of it seen
  await page.evaluate(() => {
    const g = (window as any).__game.g;
    const a = g.c.areas.island;
    const n = Math.ceil((Math.ceil(a.w / 6) * Math.ceil(a.h / 6)) / 6);
    const half = Math.ceil(Math.ceil(a.w / 6) / 2);
    // one bit a cell, six cells a character: clear the left half of every row
    const bits: number[] = new Array(n).fill(0);
    const cols = Math.ceil(a.w / 6);
    for (let cy = 0; cy < Math.ceil(a.h / 6); cy++)
      for (let cx = 0; cx < half; cx++) {
        const i = cy * cols + cx;
        bits[Math.floor(i / 6)]! |= 1 << (i % 6);
      }
    const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    g.s.seen = bits.map((v) => B64.charAt(v)).join('');
  });
  await tap(page, 'KeyM');
  const map = await waitFor(
    page,
    () => 'signs' in ((window as any).__game.game.scene.getScene('UI').overlay ?? {}),
    'the map',
    4000,
  ).catch(() => false);
  if (!map) fails.add('island: M did not open the map');
  else {
    const cloud = await page.evaluate(() => {
      const u = (window as any).__game.game.scene.getScene('UI');
      const src = u.textures.get('ui_map_now').getSourceImage() as HTMLCanvasElement;
      const px = (x: number, y: number) => Array.from(src.getContext('2d')!.getImageData(x, y, 1, 1).data);
      // top right is under cloud (pale), the left half is the island's own colours
      return { right: px(src.width - 60, 60), left: px(60, src.height / 2) };
    });
    const pale = (c: number[]) => c[0]! > 200 && c[1]! > 200 && c[2]! > 200;
    console.log(`  island: map cloud ${JSON.stringify(cloud.right)}, seen ${JSON.stringify(cloud.left)}`);
    if (!pale(cloud.right)) fails.add('island: no cloud over the unseen half of the map');
    if (pale(cloud.left)) fails.add('island: cloud over the seen half of the map');
    await still(page, dir, '32-map-cloud', 500);
  }
  await closeUi(page);
  // the board: at most 3 jobs, with five side quests standing in as board jobs (the real ones come from 43b)
  await page.evaluate(() => {
    const g = (window as any).__game.g;
    let n = 0;
    for (const id of g.c.questOrder) {
      const q = g.c.quests[id];
      if (q.kind !== 'side' || g.s.quests[id] || n >= 5) continue;
      q.board = true;
      q.requires = undefined;
      q.auto = false;
      g.s.flags['off:' + id] = 1;
      n++;
    }
  });
  await openUi(page, 'board');
  const jobs = await waitFor(
    page,
    () => (window as any).__game.game.scene.getScene('UI').overlay?.ids,
    'the board',
    4000,
  ).catch(() => null);
  if (!Array.isArray(jobs)) fails.add('island: the board did not open');
  else {
    console.log(`  island: board lists ${jobs.length} jobs`);
    if (jobs.length > 3) fails.add(`island: the board lists ${jobs.length} jobs (at most 3)`);
    if (!jobs.length) fails.add('island: the board lists no jobs although five are open');
    await still(page, dir, '33-board', 500);
  }
  await closeUi(page);
  // a morning card, alone: an arrival, then a visitor the next morning
  await sleep(1800);
  for (const [n, ev] of [
    ['34-morning-arrive', { t: 'arrive', who: 'bingo' }],
    ['35-morning-visit', { t: 'visit', who: 'bluey', gift: 'apple', n: 2 }],
  ] as const) {
    // the checkpoints leave banners waiting (seven shards): the card comes on a quiet morning
    await waitFor(
      page,
      () => {
        const u = (window as any).__game.game.scene.getScene('UI');
        return !u.cur && !u.msgQ.length;
      },
      'a quiet screen',
      40000,
    ).catch(() => undefined);
    await page.evaluate((e) => {
      const g = (window as any).__game.g;
      g.s.day += 1;
      (window as any).__game.game.scene.getScene('UI').onEvent(e);
    }, ev);
    const card = await waitFor(
      page,
      () => {
        const u = (window as any).__game.game.scene.getScene('UI');
        return u.cur?.m?.kind === 'card' && u.cur.age > 0.6;
      },
      'a morning card',
      8000,
    ).catch(() => false);
    if (!card) {
      const why = await page.evaluate(() => {
        const u = (window as any).__game.game.scene.getScene('UI');
        const g = (window as any).__game.g;
        return JSON.stringify({
          mode: g.rt.mode,
          card: !!g.rt.card,
          talk: !!g.rt.talk,
          overlay: !!u.overlay,
          cur: u.cur ? `${u.cur.m.kind}:${u.cur.m.head}:${u.cur.age.toFixed(1)}/${u.cur.life.toFixed(1)}` : null,
          clearT: u.clearT,
          freeT: u.freeT,
          nameT: u.nameT,
          q: u.msgQ.map((m: { kind: string; head: string }) => `${m.kind}:${m.head}`),
          day: g.s.day,
          morningDay: u.morningDay,
        });
      });
      fails.add(`island: no morning card for ${ev.t} (${why})`);
      continue;
    }
    const alone = await page.evaluate(() => {
      const u = (window as any).__game.game.scene.getScene('UI');
      return u.msgStats.now === 1 && u.areaBanner.alpha < 0.05;
    });
    if (!alone) fails.add(`island: the ${ev.t} card did not show alone`);
    await still(page, dir, n, 100);
    await tap(page, 'Space');
    const gone = await waitFor(
      page,
      () => !(window as any).__game.game.scene.getScene('UI').cur,
      'card gone',
      3000,
    ).catch(() => false);
    if (!gone) fails.add(`island: Space did not close the ${ev.t} card`);
    await sleep(1700);
  }
  // a second card the same morning is not shown
  await page.evaluate(() => (window as any).__game.game.scene.getScene('UI').onEvent({ t: 'arrive', who: 'bing' }));
  await sleep(600);
  if (await page.evaluate(() => (window as any).__game.game.scene.getScene('UI').cur?.m?.kind === 'card'))
    fails.add('island: two morning cards on one morning');
  // Grandad's workbench: the recipe list has Q: Make stronger, and Q opens the upgrade menu
  await debug(page, 'flag', 'upgrades_open');
  await debug(page, 'tp', 'grandad');
  await toPlay(page);
  await sleep(500);
  await openUi(page, 'craft');
  await waitFor(page, overlayOpen, 'the recipe list', 4000).catch(() => undefined);
  await focusOnTop(page, "island: Grandad's workbench", fails);
  const canUp = await page.evaluate(() => !!(window as any).__game.game.scene.getScene('UI').overlay?.canUp);
  if (!canUp) fails.add("island: no Q: Make stronger at Grandad's workbench");
  else {
    await still(page, dir, '36-workbench-q', 500);
    await tap(page, 'KeyQ');
    const up = await waitFor(
      page,
      () => 'plusWas' in ((window as any).__game.game.scene.getScene('UI').overlay ?? {}),
      'upgrade',
      4000,
    ).catch(() => false);
    if (!up) fails.add('island: Q at the workbench did not open the upgrade menu');
  }
  await closeUi(page);
}

/** Give a piece of gear and answer "Put it on? Space" with a real Space while the question shows. */
async function answerAsk(page: Page, item: string, fails: Fails, pic = ''): Promise<boolean> {
  await debug(page, 'give', `${item}:1`);
  const asked = await waitFor(
    page,
    () => {
      const u = (window as any).__game.game.scene.getScene('UI');
      return !!u.cur?.m?.wear && !u.cur.leaving && u.cur.age > 0.5;
    },
    `the "Put it on?" question for ${item}`,
    8000,
  ).catch(() => false);
  if (!asked) {
    fails.add(`no "Put it on? Space" question for ${item}`);
    return false;
  }
  if (pic) await shot(page, pic.split('|')[0]!, pic.split('|')[1]!);
  await tap(page, 'Space');
  await sleep(400);
  const on = await page.evaluate((id: string) => Object.values((window as any).__game.g.s.gear).includes(id), item);
  if (!on) fails.add(`Space on "Put it on?" did not put on ${item}`);
  return on;
}

/**
 * Gear (phase 2 step 3): the question for new gear answered with Space, shield hearts and the arrow count on the HUD,
 * the Gear page from the bag (E, then Q) with Space taking off and putting on, the recipe tabs, the upgrade menu.
 */
async function gearCheck(page: Page, dir: string, fails: Fails): Promise<void> {
  if (!(await page.evaluate(() => !!(window as any).__game.g.s.gear))) {
    fails.add('the save has no gear record');
    return;
  }
  for (let k = 0; k < 20 && (await page.evaluate(() => (window as any).__game.g.rt.mode)) !== 'play'; k++)
    await debug(page, 'skip');
  // start bare, so each new piece asks (better gear from the chapters would not)
  await page.evaluate(() => {
    const g = (window as any).__game.g;
    for (const id of Object.keys(g.s.pouch)) if (/sword|^bow$|helmet|armour/.test(id)) delete g.s.pouch[id];
    g.s.gear = { sword: '', bow: '', helmet: '', armour: '' };
    g.s.plus = {};
    g.s.shield = 0;
  });
  await answerAsk(page, 'iron_sword', fails, `${dir}|26-put-it-on`);
  await answerAsk(page, 'leather_helmet', fails);
  await answerAsk(page, 'iron_armour', fails);
  await debug(page, 'give', 'arrow:12');
  await answerAsk(page, 'bow', fails);
  await sleep(600);
  const hud = await page.evaluate(() => {
    const u = (window as any).__game.game.scene.getScene('UI');
    const blue = u.hearts.filter((h: any) => h.visible && String(h.texture.key).startsWith('ui_shield')).length;
    return { blue, arrows: u.arrowText.visible ? u.arrowText.text : '' };
  });
  console.log(`  gear: ${hud.blue} shield hearts on the HUD, arrow count "${hud.arrows}"`);
  if (hud.blue < 1) fails.add('no blue shield hearts on the HUD with armour on');
  if (hud.arrows !== '12') fails.add(`the arrow count shows "${hud.arrows}", not 12`);
  await still(page, dir, '27-shield-hearts', 500);
  // the Gear page: E opens the bag, Q turns to the Gear page
  await tap(page, 'KeyE');
  await waitFor(page, overlayOpen, 'the bag', 4000).catch(() => undefined);
  await tap(page, 'KeyQ');
  const gearPage = await waitFor(
    page,
    () => 'lcol' in ((window as any).__game.game.scene.getScene('UI').overlay ?? {}),
    'the Gear page',
    4000,
  ).catch(() => false);
  if (!gearPage) {
    fails.add('Q in the bag did not open the Gear page');
    return;
  }
  await still(page, dir, '28-gear-page', 900);
  // the pointer starts on the sword slot: Space takes it off, then on the list Space puts it back on
  await tap(page, 'Space');
  await sleep(300);
  const off = await page.evaluate(() => (window as any).__game.g.s.gear.sword);
  if (off) fails.add(`Space on the worn sword did not take it off (${off})`);
  await tap(page, 'ArrowRight', 60, 150);
  await tap(page, 'ArrowRight', 60, 150);
  await tap(page, 'Space');
  await sleep(300);
  const back = await page.evaluate(() => (window as any).__game.g.s.gear.sword);
  if (back !== 'iron_sword') fails.add(`Space on a sword in the list did not put it on (${back})`);
  for (let k = 0; k < 4 && (await page.evaluate(overlayOpen)); k++) await tap(page, 'KeyX', 60, 200);
  // the recipe tabs
  await page.evaluate(() => (window as any).__game.game.scene.getScene('UI').open('craft'));
  await waitFor(page, overlayOpen, 'the recipe list', 4000).catch(() => undefined);
  const t0 = await page.evaluate(() => (window as any).__game.game.scene.getScene('UI').overlay?.tab);
  await tap(page, 'ArrowRight');
  await sleep(300);
  const t1 = await page.evaluate(() => (window as any).__game.game.scene.getScene('UI').overlay?.tab);
  if (typeof t0 !== 'number' || t0 === t1) fails.add(`the recipe tabs did not turn with the arrows (${t0} -> ${t1})`);
  await still(page, dir, '29-recipe-tabs', 500);
  for (let k = 0; k < 4 && (await page.evaluate(overlayOpen)); k++) await tap(page, 'KeyX', 60, 200);
  // the upgrade menu
  await page.evaluate(() => (window as any).__game.game.scene.getScene('UI').open('upgrade'));
  if (!(await waitFor(page, overlayOpen, 'the upgrade menu', 4000).catch(() => false)))
    fails.add('the upgrade menu did not open');
  await still(page, dir, '30-upgrade', 700);
  for (let k = 0; k < 4 && (await page.evaluate(overlayOpen)); k++) await tap(page, 'KeyX', 60, 200);
  if (await page.evaluate(overlayOpen)) fails.add('the upgrade menu did not close with X');
}

/** The limits of docs/PHASE2.md part A: key presses from the title to walking, and the same with the held-X skip. */
const MAX_PRESSES = 6;
const MAX_PRESSES_SKIP = 3;
/** What each engine counted; the worst of them goes to the calm check (tools/check/calm.ts reads the file). */
const counted: { plain: number; skip: number }[] = [];
const PRESSES_FILE = 'test-results/calm-presses.json';

/**
 * The start, twice, on a fresh profile with real keys. First with the skip: Play, pick a hero, one held X. Then the
 * long way, reading every box. Counts the presses of both, fails over the limits, and leaves the second game running.
 */
async function startCounted(page: Page, url: string, dir: string, fails: Fails): Promise<void> {
  // 1. with the skip
  await waitTitleMenu(page);
  let skip = await startNewGame(page, 'amelia');
  if (await page.evaluate(() => document.getElementById('name-entry')?.classList.contains('open')))
    fails.add('a name box opened: nothing may ask her to name anyone');
  await waitFor(page, () => !!(window as any).__game.g.rt.cut, 'the intro scene', 8000).catch(() => undefined);
  await sleep(700);
  // one held X: the hint and its ring part filled, then the scene is skipped
  if (!(await holdXToSkip(page, 6000, () => shot(page, dir, '01a-hold-x-to-skip').then(() => undefined))))
    fails.add('holding X did not skip the intro');
  skip++;
  skip += await pressesToWalk(page);
  // 2. the long way, from a clean profile again
  await page.evaluate(() => localStorage.clear());
  await openTitle(page, url);
  await waitTitleMenu(page);
  let full = await startNewGame(page, 'amelia');
  await still(page, dir, '01-world', 1200);
  full += await pressesToWalk(page);
  console.log(
    `  presses from the title to walking: ${full} (limit ${MAX_PRESSES}), with the skip: ${skip} (limit ${MAX_PRESSES_SKIP})`,
  );
  counted.push({ plain: full, skip });
  if (full > MAX_PRESSES) fails.add(`${full} key presses from the title to walking (limit ${MAX_PRESSES})`);
  if (skip > MAX_PRESSES_SKIP) fails.add(`${skip} key presses with the skip (limit ${MAX_PRESSES_SKIP})`);
  const koala = await page.evaluate(() => (window as any).__game.g.s.koala);
  if (koala !== 'Koala') fails.add(`the koala is called "${koala}", expected "Koala"`);
}

const openUi = (page: Page, name: string, arg?: string) =>
  page.evaluate(([m, x]) => (window as any).__game.game.scene.getScene('UI').open(m, x), [name, arg] as [
    string,
    string | undefined,
  ]);
async function closeUi(page: Page): Promise<void> {
  for (let k = 0; k < 5 && (await page.evaluate(overlayOpen)); k++) await tap(page, 'KeyX', 60, 200);
}

/** Early game views: the map before regions glow, the quest marker, a toast, the mirror, Options, Christmas. */
async function earlyViews(page: Page, dir: string, fails: Fails): Promise<void> {
  // the quest star and the edge arrow: stand well away from the tracked target
  await debug(page, 'tp', 'sign_square');
  for (let k = 0; k < 20 && (await page.evaluate(() => (window as any).__game.g.rt.mode)) !== 'play'; k++)
    await debug(page, 'skip');
  await still(page, dir, '04-quest-arrow', 900);
  await tap(page, 'KeyM');
  if (await waitFor(page, overlayOpen, 'early map', 4000).catch(() => false))
    await still(page, dir, '05-map-early', 700);
  else fails.add('the map did not open early on');
  await closeUi(page);
  // a toast for a pick-up
  await debug(page, 'give', 'apple:3');
  // one message at a time, after a clear moment: the strip slides in about two seconds on
  await waitFor(page, () => !!(window as any).__game.game.scene.getScene('UI').cur, 'a toast', 6000).catch(() =>
    fails.add('no toast for a thing gained'),
  );
  await still(page, dir, '06-toast', 500);
  await openUi(page, 'mirror');
  if (await waitFor(page, overlayOpen, 'mirror', 4000).catch(() => false)) await still(page, dir, '07-mirror', 900);
  else fails.add('the mirror did not open');
  await closeUi(page);
  // the pause menu's Options page: volume rows
  await tap(page, 'KeyP');
  if (await waitFor(page, overlayOpen, 'pause', 4000).catch(() => false)) {
    await tap(page, 'ArrowDown', 60, 160);
    await tap(page, 'ArrowDown', 60, 160);
    await tap(page, 'Space', 60, 300);
    await still(page, dir, '08-options', 600);
  } else fails.add('the pause menu did not open');
  await closeUi(page);
  // the Christmas layer on: go indoors and out so the island is drawn again with snow
  await page.evaluate(() => {
    (window as any).__game.g.s.xmas = true;
  });
  await debug(page, 'tp', 'bed_side');
  await sleep(500);
  await debug(page, 'tp', 'great_tree');
  await still(page, dir, '09-christmas', 1500);
  await page.evaluate(() => {
    (window as any).__game.g.s.xmas = false;
  });
  await debug(page, 'tp', 'bed_side');
  await sleep(500);
  await debug(page, 'tp', 'great_tree');
  await sleep(400);
}

/** The finale's own screens: Dad's letter, picking 5 friends for the photo, the photo, the credits. */
async function finaleScreens(page: Page, dir: string, fails: Fails): Promise<void> {
  const kind = () => {
    const o = (window as any).__game.game.scene.getScene('UI').overlay;
    if (!o) return 'none';
    const c = o.child?.constructor?.name;
    return `${o.constructor?.name}:${o.phase ?? ''}:${c ?? ''}`;
  };
  if (
    !(await waitFor(
      page,
      () => !!(window as any).__game.game.scene.getScene('UI').overlay?.phase,
      'finale screens',
      6000,
    ).catch(() => false))
  ) {
    fails.add(`the finale screens did not open (${await page.evaluate(kind)})`);
    return;
  }
  await still(page, dir, '18a-letter', 700);
  for (
    let k = 0;
    k < 12 && (await page.evaluate(() => (window as any).__game.game.scene.getScene('UI').overlay?.phase)) === 'letter';
    k++
  )
    await tap(page, 'Space', 60, 250);
  await still(page, dir, '18b-photo-pick', 900);
  for (
    let k = 0;
    k < 5 && (await page.evaluate(() => (window as any).__game.game.scene.getScene('UI').overlay?.phase)) === 'photo';
    k++
  ) {
    await tap(page, 'Space', 60, 250);
    await tap(page, 'ArrowRight', 60, 200);
  }
  await still(page, dir, '18c-photo', 1200);
  if (!(await page.evaluate(() => !!(window as any).__game.g.s.flags.photo))) fails.add('no group photo was taken');
  await waitFor(
    page,
    () => (window as any).__game.game.scene.getScene('UI').overlay?.phase === 'credits',
    'credits',
    8000,
  ).catch(() => fails.add('the credits did not roll'));
  await still(page, dir, '18d-credits', 5000);
  for (let k = 0; k < 4 && (await page.evaluate(overlayOpen)); k++) await tap(page, 'Space', 60, 400);
  if (await page.evaluate(overlayOpen)) fails.add('the credits did not close with Space');
}

/** The three rare surprises, each set up for now and played where it happens. */
/**
 * Package 47b: three island projects before and after (taken from the board, paid at the site with Space), Dad's
 * fish board, a cup on a mini-game card and the cup shelf. Screenshots in test-results/projects/.
 */
async function projectCheck(page: Page, engine: Engine, fails: Fails): Promise<void> {
  const dir = 'projects';
  await closeUi(page);
  await toPlay(page);
  for (const id of ['well', 'footbridge', 'bench']) {
    // take the job, stand at the site, then pay for it with Space
    const at = await page.evaluate((site: string) => {
      const w = (window as any).__game;
      const g = w.g;
      w.debug('quest', 'p_' + site);
      const b = g.c.areas.island.sites.find((x: any) => x.id === site);
      if (b.at.x < 0) return null;
      if (g.s.area !== 'island') w.debug('tp', 'sign_bay');
      g.s.x = b.at.x + 0.5;
      g.s.y = b.at.y + 0.5;
      g.s.time = 0.3;
      g.rt.mobs.length = 0;
      return b.needs as Record<string, number>;
    }, id);
    if (!at) {
      fails.add(`projects: no site ${id}`);
      continue;
    }
    await sleep(700);
    await shot(page, dir, `${engine}-${id}-before`);
    for (const [k, n] of Object.entries(at)) await debug(page, 'give', `${k}:${n}`);
    await sleep(300);
    await tap(page, 'Space');
    let built = false;
    for (let k = 0; k < 40 && !built; k++) {
      built = await page.evaluate((site: string) => !!(window as any).__game.g.s.flags['site_' + site], id);
      if (!built) await sleep(100);
    }
    if (!built) fails.add(`projects: Space at the ${id} site did not build it`);
    await toPlay(page);
    const done = await page.evaluate((site: string) => !!(window as any).__game.g.s.quests['p_' + site]?.done, id);
    if (!done) fails.add(`projects: the job p_${id} did not end when the ${id} was built`);
    console.log(`  projects: ${id} built ${built}, job done ${done}`);
    await sleep(1500);
    await shot(page, dir, `${engine}-${id}-after`);
  }
  // the board shows a project as its picture
  await page.evaluate(() => {
    const g = (window as any).__game.g;
    for (const id of ['p_jetty', 'p_lamps', 'p_cove']) delete g.s.quests[id];
  });
  await openUi(page, 'board');
  await sleep(600);
  await shot(page, dir, `${engine}-board`);
  await closeUi(page);
  // Dad's fish board: four kinds caught, the board waiting for the next
  await page.evaluate(() => {
    const w = (window as any).__game;
    const g = w.g;
    for (const f of ['sardine', 'trout', 'minnow', 'goldfish']) g.s.stickers[f] = 1;
    w.debug('finish', 'fb_1');
    w.debug('quest', 'fb_2');
  });
  await toPlay(page);
  await openUi(page, 'shop', 'fishboard');
  const fishOpen = await waitFor(
    page,
    () => (window as any).__game.game.scene.getScene('UI').overlay?.page === 'fishboard',
    'the fish board',
    4000,
  ).catch(() => false);
  if (!fishOpen) fails.add('projects: the fish board did not open');
  await sleep(500);
  await shot(page, dir, `${engine}-fish-board`);
  await closeUi(page);
  // a cup go at a post: the intro card shows the cup, the result card the cup won
  const cupGame = await page.evaluate(() => {
    const g = (window as any).__game.g;
    if (!g.s.cups) return '';
    g.s.cups.keepy = 1;
    g.s.counts['cupday:keepy'] = 0;
    g.s.stars.keepy = Math.max(1, g.s.stars.keepy ?? 0);
    // any flag rebuilds which things stand in the world, so the post (shown once its cups are open) appears
    (window as any).__game.debug('flag', 'smoke_cups');
    return 'keepy';
  });
  if (cupGame) {
    const started = await page.evaluate(() => {
      const w = (window as any).__game;
      const g = w.g;
      const post = g.c.areas.island.objects.find((o: any) => o.type === 'game_post' && o.d === 'keepy');
      if (!post) return false;
      g.s.x = post.x + 0.5;
      g.s.y = post.y + 1.5;
      g.s.dir = 'up';
      return true;
    });
    if (started) {
      await sleep(400);
      await tap(page, 'Space');
      const intro = await waitFor(page, () => (window as any).__game.g.rt.mini?.cup ?? 0, 'a cup go', 4000).catch(
        () => 0,
      );
      if (!intro) fails.add('projects: Space at the Keepy Uppy post did not start a cup go');
      await sleep(700);
      await shot(page, dir, `${engine}-cup-choice`);
      // start the go, then win it with 3 stars: the result card shows the cup won
      await tap(page, 'Space');
      await sleep(900);
      await debug(page, 'skip', 3);
      await sleep(900);
      const won = await page.evaluate(() => (window as any).__game.g.s.cups?.keepy ?? 0);
      if (won < 2) fails.add(`projects: 3 stars at the silver cup go left the Keepy Uppy cup at ${won}`);
      console.log(`  projects: cup go for tier ${intro}, won ${won}`);
      await toPlay(page);
    } else fails.add('projects: no Keepy Uppy post');
  } else console.log('  projects: no cups in the rules yet (47a)');
  await openUi(page, 'shop', 'cups');
  const shelf = await waitFor(
    page,
    () => (window as any).__game.game.scene.getScene('UI').overlay?.page === 'cups',
    'the cup shelf',
    4000,
  ).catch(() => false);
  if (!shelf) fails.add('projects: the cup shelf did not open');
  await sleep(500);
  await shot(page, dir, `${engine}-cup-shelf`);
  await closeUi(page);
}

async function surprises(page: Page, dir: string, fails: Fails): Promise<void> {
  const list = [
    ['stampede', 'great_tree', 'surprise_stampede'],
    ['prank', 'kuromi', 'surprise_prank'],
    ['jockey', 'sign_home', 'surprise_jockey'],
  ];
  for (let i = 0; i < list.length; i++) {
    const [id, at, sticker] = list[i]!;
    await page.evaluate((n: number) => {
      const s = (window as any).__game.g.s;
      s.counts.surpWhich = n;
      s.counts.surpSlot = 0;
      s.time = 120;
      s.flags.minions_here = 1;
    }, i + 1);
    await debug(page, 'tp', at!);
    const ok = await waitFor(
      page,
      () => !!(window as any).__game.g.rt.cut?.id?.startsWith('surprise_'),
      `surprise ${id}`,
      6000,
    ).catch(() => false);
    if (!ok) {
      fails.add(`the ${id} surprise did not start`);
      continue;
    }
    // past the first line (the typewriter, then the line itself), so the characters are on screen
    await waitFor(page, () => !!(window as any).__game.g.rt.talk, `the ${id} first line`, 4000).catch(() => undefined);
    const line0 = await page.evaluate(() => (window as any).__game.g.rt.talk?.text ?? '');
    for (let k = 0; k < 6 && (await page.evaluate(() => (window as any).__game.g.rt.talk?.text ?? '')) === line0; k++)
      await tap(page, 'Space', 60, 350);
    await sleep(id === 'jockey' ? 1300 : 1600);
    await shot(page, dir, `3${i}-surprise-${id}`);
    for (let k = 0; k < 30 && (await page.evaluate(() => (window as any).__game.g.rt.mode)) !== 'play'; k++)
      await tap(page, 'Space', 60, 220);
    await sleep(300);
    if (!(await page.evaluate((st: string) => !!(window as any).__game.g.s.stickers[st], sticker!)))
      fails.add(`the ${id} surprise gave no sticker`);
  }
}

async function prologueBeats(page: Page, dir: string, fails: Fails): Promise<void> {
  await advanceToPlay(page);
  await still(page, dir, '02-intro-done');
  // The first step (arrive at the start) completes on the next quest poll after the intro.
  await waitFor(
    page,
    () => ((window as any).__game.g.s.quests.prologue?.step ?? 0) >= 1,
    'prologue step 1',
    5000,
  ).catch(() => undefined);
  const before = await page.evaluate(() => (window as any).__game.g.s.quests.prologue?.step ?? -1);
  // package 46: the arrow keys show as a picture on her first free frame
  const walkHint = await page.evaluate(() => !!(window as any).__game.game.scene.getScene('UI').walkHint?.visible);
  if (!walkHint) fails.add('no arrow-key picture on the first free frame');
  const mum = await page.evaluate(() => {
    const g = (window as any).__game.g;
    const n = g.rt.npcs.find((m: any) => m.id === 'mum' && m.area === g.s.area && !m.hidden);
    return n ? { x: n.x as number, y: n.y as number } : null;
  });
  if (!mum) {
    fails.add('Mum is not in the hero area after the intro');
    return;
  }
  // Walk to her (she may amble, so re-read her spot a few times), face her, press Space.
  let reached = false;
  for (let i = 0; i < 4 && !reached; i++) {
    const at = await page.evaluate(() => {
      const n = (window as any).__game.g.rt.npcs.find((m: any) => m.id === 'mum');
      return { x: n.x as number, y: n.y as number };
    });
    reached = await walkTo(page, at.x, at.y, 1.3, 12000);
  }
  if (!reached) {
    fails.add('could not walk to Mum with the arrow keys');
    return;
  }
  for (let tries = 0; tries < 4; tries++) {
    const at = await page.evaluate(() => {
      const n = (window as any).__game.g.rt.npcs.find((m: any) => m.id === 'mum');
      return { x: n.x as number, y: n.y as number };
    });
    await face(page, at.x, at.y);
    await tap(page, 'Space');
    await page.waitForTimeout(250);
    if ((await page.evaluate(() => (window as any).__game.g.rt.mode)) !== 'play') break;
  }
  await still(page, dir, '03-talk-mum', 1500);
  // package 46: she stands a tile short of Mum, so neither hides behind the other; Space shows as a key picture
  const talk = await page.evaluate(() => {
    const w = window as any;
    const g = w.__game.g;
    const n = g.rt.npcs.find((m: any) => m.id === 'mum');
    const ui = w.__game.game.scene.getScene('UI');
    return { d: n ? Math.hypot(n.x - g.s.x, n.y - g.s.y) : 9, space: !!ui.spaceCap?.visible, talking: !!g.rt.talk };
  });
  if (talk.talking && talk.d < 0.9) fails.add(`she stands ${talk.d.toFixed(2)} tiles from Mum while they talk`);
  if (talk.talking && !talk.space) fails.add('no Space key picture under the first talk box');
  await advanceToPlay(page, 30000);
  const after = await page.evaluate(() => (window as any).__game.g.s.quests.prologue?.step ?? -1);
  if (!(after > before)) fails.add(`prologue step did not advance after talking to Mum (${before} -> ${after})`);
  else console.log(`  prologue step ${before} -> ${after} by real keys`);
}

async function run(engine: Engine, url: string): Promise<string[]> {
  const dir = `smoke/${engine}`;
  const fails = new Fails();
  console.log(`smoke: ${engine}`);
  const b = await launch(engine);
  const w = watch(b.page);
  try {
    await openTitle(b.page, url);
    // the second greeting line lands at 1.1 s and the logo at 1.5 s
    await still(b.page, dir, '00-title', 2000);
    await startCounted(b.page, url, dir, fails);
    await prologueBeats(b.page, dir, fails);
    await earlyViews(b.page, dir, fails);
    const have = await b.page.evaluate(() => Object.keys((window as any).__game.g.c.quests));
    let i = 0;
    for (const q of CHECKPOINTS) {
      if (!have.includes(q)) {
        console.log(`  skip ${q}: not in the content yet`);
        continue;
      }
      if (q === 'finale')
        // friends she has met, for the group photo
        await b.page.evaluate(() => {
          const s = (window as any).__game.g.s;
          for (const id of ['bluey', 'bingo', 'peppa', 'bing', 'flop', 'mum', 'grandad']) s.met[id] = 1;
        });
      await debug(b.page, 'finish', q);
      if (q === 'finale') {
        for (let k = 0; k < 20 && (await b.page.evaluate(() => (window as any).__game.g.rt.mode)) !== 'play'; k++)
          await debug(b.page, 'skip');
        await finaleScreens(b.page, dir, fails);
      }
      // Whatever follows (closing lines, cards, a cutscene) is skipped, then a few steps of walking.
      for (let k = 0; k < 20 && (await b.page.evaluate(() => (window as any).__game.g.rt.mode)) !== 'play'; k++)
        await debug(b.page, 'skip');
      // Go to the chapter's own region so each screenshot shows a different part of the island.
      const sign = await b.page.evaluate((id: string) => {
        const c = (window as any).__game.g.c;
        const r = c.regions[c.quests[id].region];
        return r?.sign && c.areas.island.places['sign_' + r.sign] ? 'sign_' + r.sign : null;
      }, q);
      if (sign) await debug(b.page, 'tp', sign);
      for (let k = 0; k < 20 && (await b.page.evaluate(() => (window as any).__game.g.rt.mode)) !== 'play'; k++)
        await debug(b.page, 'skip');
      await wander(b.page, 1000);
      const done = await b.page.evaluate((id: string) => !!(window as any).__game.g.s.quests[id]?.done, q);
      if (!done) fails.add(`debug finish ${q} did not mark it done`);
      else
        console.log(
          `  checkpoint ${q} done, walked on in ${await b.page.evaluate(() => (window as any).__game.g.s.area)}`,
        );
      await still(b.page, dir, `1${i++}-${q}`, 600);
    }
    await surprises(b.page, dir, fails);
    await menus(b.page, dir, fails);
    await gearCheck(b.page, dir, fails);
    await islandCheck(b.page, dir, fails);
    await projectCheck(b.page, engine, fails);
    await waitFor(b.page, () => true, 'settle', 1000);
    // one message at a time, with a clear screen between two (docs/PHASE2.md part C)
    const ms = await b.page.evaluate(() => (window as any).__game.game.scene.getScene('UI').msgStats);
    console.log(
      `  messages: ${ms.shown} shown, at most ${ms.most} at once, shortest gap ${Number(ms.minGap).toFixed(2)} s`,
    );
    if (ms.most > 1) fails.add(`${ms.most} messages were on screen at once`);
    if (ms.shown > 1 && ms.minGap < 1.5)
      fails.add(`two messages came ${Number(ms.minGap).toFixed(2)} s apart (limit 1.5)`);
  } catch (e) {
    fails.add(String((e as Error).message ?? e));
    await shot(b.page, dir, 'zz-failure').catch(() => undefined);
  }
  const ge = await gameErrors(b.page).catch(() => [] as string[]);
  for (const m of w.console) fails.add(`console error: ${m}`);
  for (const m of w.page) fails.add(`page error: ${m}`);
  for (const m of ge) fails.add(`__game.errors: ${m}`);
  await b.close();
  return fails.list.map((f) => `${engine}: ${f}`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null;
  const engines = (['chromium', 'webkit'] as Engine[]).filter((e) => !only || e === only);
  // fresh evidence every run: old pictures never stand in for new ones
  for (const e of engines) rmSync(`test-results/smoke/${e}`, { recursive: true, force: true });
  // --url: a server someone else runs (a worker's own preview port); otherwise start one
  const at = argv.includes('--url') ? argv[argv.indexOf('--url') + 1] : null;
  const server = at ? { url: at, stop: () => undefined } : await startServer({ dev: argv.includes('--dev') });
  const all: string[] = [];
  try {
    for (const e of engines) all.push(...(await run(e, server.url)));
  } finally {
    server.stop();
  }
  if (counted.length) {
    mkdirSync('test-results', { recursive: true });
    const worst = { plain: Math.max(...counted.map((c) => c.plain)), skip: Math.max(...counted.map((c) => c.skip)) };
    writeFileSync(PRESSES_FILE, `${JSON.stringify(worst)}\n`);
  }
  if (all.length === 0) {
    console.log('SMOKE OK');
    process.exit(0);
  }
  console.log(`SMOKE FAIL (${all.length})`);
  for (const f of all) console.log(`  ${f}`);
  process.exit(1);
}

await main();
