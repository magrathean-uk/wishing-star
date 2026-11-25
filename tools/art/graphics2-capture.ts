// Headless visual and texture check for graphics job 2.
// Run against the preview server on 4202. Every browser is created by bot/lib.ts, which mutes it and uses headless Chromium.
// Example: node tools/art/graphics2-capture.ts --url http://127.0.0.1:4202/ --group A,B,C,D,E --ipad
// The optional iPad pass uses Playwright's iPad Pro 11 landscape profile with headless WebKit on this computer.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { debug, launch, openTitle, pressesToWalk, sleep, startNewGame, waitFor } from '../bot/lib.ts';

const argument = (name: string, fallback: string) => {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? fallback : (process.argv[index + 1] ?? fallback);
};

const GAME = argument('url', 'http://127.0.0.1:4202/');
const OUT = resolve(argument('out', 'test-results/graphics2'));
const IPAD = process.argv.includes('--ipad');
const GROUPS = argument('group', 'A,B,C,D,E')
  .split(',')
  .map((group) => group.trim().toUpperCase())
  .filter(Boolean);

const ROOMS = {
  B: [
    { area: 'lighthouse_in', place: 'in_lighthouse', x: 5.5, y: 5.5 },
    { area: 'keeper_in', place: 'in_keeper', x: 5.5, y: 5.5 },
    { area: 'lamp_in', place: 'in_lamp', x: 6.5, y: 4.8 },
  ],
  C: [
    { area: 'cafe_in', place: 'in_cafe', x: 9.5, y: 5.3 },
    { area: 'post_in', place: 'in_post', x: 6.5, y: 5.3 },
    { area: 'school_in', place: 'in_school', x: 8.5, y: 7 },
    { area: 'green_in', place: 'in_green', x: 8.5, y: 3 },
    { area: 'lookout_in', place: 'in_lookout', x: 4, y: 4 },
    { area: 'beacon_in', place: 'in_beacon', x: 4, y: 4 },
  ],
  D: [
    { area: 'doll_in', place: 'in_doll', x: 6.5, y: 5.4 },
    { area: 'nook_in', place: 'in_nook', x: 5, y: 5.2 },
    { area: 'tree_in', place: 'in_tree', x: 5, y: 3.5 },
    { area: 'vh1_in', place: 'in_vh1', x: 6.5, y: 4.5 },
    { area: 'vh3_in', place: 'in_vh3', x: 6, y: 5.5 },
    { area: 'vh4_in', place: 'in_vh4', x: 7, y: 5.5 },
    { area: 'mill_in', place: 'in_mill', x: 7, y: 5.5 },
  ],
} as const;

const DAY_VIEWS = [
  { name: 'workshop-trees', place: 'first_tree', x: 58, y: 51 },
  { name: 'koala-grove', place: 'koala_grove', x: 29, y: 24 },
  { name: 'forest-path', place: 'forest_path', x: 122, y: 37 },
  { name: 'sandy-bay', place: 'pandy_bay', x: 83, y: 101 },
] as const;

type Results = {
  screenshots: string[];
  memory: { where: string; bytes: { chars: number; ground: number; other: number; all: number } }[];
  frame: { where: string; averageMs: number; p95Ms: number; stepsPerSecond: number }[];
  browserChecks: {
    where: string;
    title: string;
    music: string | null;
    sound: string | null;
    touchPoints: number;
    viewport: { width: number; height: number };
  }[];
  previewFrames: { frame: string; atlas: string; renderedPixels: number }[];
  omitted: { name: string; reason: string }[];
  errors: string[];
};

const emptyResults = (): Results => ({
  screenshots: [],
  memory: [],
  frame: [],
  browserChecks: [],
  previewFrames: [],
  omitted: [],
  errors: [],
});

let results = emptyResults();

mkdirSync(OUT, { recursive: true });

async function openGame(
  christmas: 'on' | 'off',
  where: string,
  engine: 'chromium' | 'webkit' = 'chromium',
  touch?: string,
): Promise<{ page: Page; close: () => Promise<void> }> {
  const browser = await launch(engine, { width: 1280, height: 720, christmas, touch });
  try {
    await openTitle(browser.page, GAME);
    await startNewGame(browser.page, 'koala');
    await waitFor(browser.page, () => !!(window as any).__game?.g, 'a new game');
    const browserCheck = await browser.page.evaluate(() => ({
      title: document.title,
      music: localStorage.getItem('ws_music'),
      sound: localStorage.getItem('ws_sound'),
      touchPoints: navigator.maxTouchPoints,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    }));
    results.browserChecks.push({ where, ...browserCheck });
    if (!browserCheck.title.startsWith('TEST') || browserCheck.music !== '0' || browserCheck.sound !== '0')
      throw new Error(`${where}: expected a TEST-titled, muted browser, got ${JSON.stringify(browserCheck)}`);
    await pressesToWalk(browser.page);
    await browser.page.evaluate(() => {
      const tag = document.createElement('small');
      tag.textContent = 'Test run';
      tag.style.cssText =
        'position:fixed;right:8px;bottom:8px;background:#702924;color:white;padding:3px 7px;z-index:9999';
      document.body.appendChild(tag);
    });
    await debug(browser.page, 'time', 200);
    await sleep(700);
    return { page: browser.page, close: browser.close };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

async function inspectMemory(page: Page, where: string): Promise<void> {
  const bytes = await page.evaluate(() => {
    const game = (window as any).__game;
    const loaded = game.perf().bytes as { chars: number; ground: number; other: number };
    let all = 0;
    const textures = game.game.textures;
    for (const key of textures.getTextureKeys())
      for (const source of textures.get(key).source) all += (source.width || 0) * (source.height || 0) * 4;
    return { ...loaded, all };
  });
  results.memory.push({ where, bytes });
  console.log(
    `memory ${where}: ${(bytes.all / 1048576).toFixed(1)} MB total, ` +
      `${(bytes.chars / 1048576).toFixed(1)} MB characters, ` +
      `${(bytes.ground / 1048576).toFixed(1)} MB ground, ${(bytes.other / 1048576).toFixed(1)} MB other`,
  );
}

async function inspectFrames(page: Page, where: string): Promise<void> {
  const frame = await page.evaluate(async () => {
    const game = (window as any).__game;
    const intervals: number[] = [];
    const start = performance.now();
    let previous = start;
    const world = game.game.scene.getScene('World');
    let steps = 0;
    const countSteps = () => {
      steps += world.stepsRun;
    };
    world.events.on('postupdate', countSteps);
    await new Promise<void>((resolveSample) => {
      const sample = (time: number) => {
        intervals.push(time - previous);
        previous = time;
        if (time - start < 5000) requestAnimationFrame(sample);
        else resolveSample();
      };
      requestAnimationFrame(sample);
    });
    world.events.off('postupdate', countSteps);
    intervals.shift();
    intervals.sort((a, b) => a - b);
    return {
      averageMs: intervals.reduce((total, value) => total + value, 0) / Math.max(1, intervals.length),
      p95Ms: intervals[Math.floor(intervals.length * 0.95)] ?? 0,
      stepsPerSecond: steps / ((performance.now() - start) / 1000),
    };
  });
  results.frame.push({ where, ...frame });
  console.log(
    `frames ${where}: ${frame.averageMs.toFixed(1)} ms average, ${frame.p95Ms.toFixed(1)} ms p95, ` +
      `${frame.stepsPerSecond.toFixed(1)} game steps/s`,
  );
}

async function position(page: Page, place: string, area: string, x: number, y: number): Promise<void> {
  await debug(page, 'tp', place);
  await sleep(350);
  // Arriving at a new landmark can start its first conversation after the camera has settled.
  for (let i = 0; i < 30; i++) {
    if (
      await page.evaluate(() => {
        const rt = (window as any).__game.g.rt;
        return rt.mode === 'play' && !rt.cut;
      })
    )
      break;
    await debug(page, 'skip');
  }
  await page.evaluate(
    ([wantedArea, px, py]) => {
      const game = (window as any).__game.g;
      game.s.area = wantedArea;
      game.s.x = game.rt.px = px;
      game.s.y = game.rt.py = py;
      game.s.dir = 'down';
      game.rt.mobs.length = 0;
      game.rt.fun = null;
    },
    [area, x, y],
  );
  await sleep(2000);
  const arrived = await page.evaluate(() => {
    const { area, x, y } = (window as any).__game.g.s;
    return { area, x, y };
  });
  if (arrived.area !== area || Math.hypot(arrived.x - x, arrived.y - y) > 0.25)
    throw new Error(`Camera target ${place} moved to ${JSON.stringify(arrived)}`);
}

async function capture(page: Page, group: string, name: string, expectedArea?: string): Promise<void> {
  const state = await page.evaluate(() => {
    const g = (window as any).__game.g;
    const area = g.c.areas[g.s.area];
    const tile = Math.floor(g.s.y) * area.w + Math.floor(g.s.x);
    return {
      area: g.s.area,
      x: g.s.x,
      y: g.s.y,
      mode: g.rt.mode,
      snow: g.s.xmas,
      indoor: !!area.indoor,
      blocked: g.rt.solid[g.s.area]?.[tile] === 1,
      centreDistance: Math.hypot(g.s.x - area.w / 2, g.s.y - area.h / 2),
    };
  });
  if (state.mode !== 'play' || (expectedArea && state.area !== expectedArea))
    throw new Error(`${name}: expected ${expectedArea ?? 'play'} but got ${state.area} (${state.mode})`);
  if (state.indoor && state.blocked) throw new Error(`${name}: hero position overlaps a blocked room tile`);
  const directory = resolve(OUT, group);
  mkdirSync(directory, { recursive: true });
  const file = resolve(directory, `${name}.png`);
  await page.screenshot({ path: file });
  results.screenshots.push(file);
  console.log(
    `shot ${group}/${name}: ${state.area} at ${state.x.toFixed(1)},${state.y.toFixed(1)}` +
      `${state.indoor ? `, ${state.centreDistance.toFixed(1)} tiles from room centre` : ''}` +
      `${state.snow ? ' snow' : ''}`,
  );
  await inspectMemory(page, `${group}/${name}`);
}

async function captureDayViews(page: Page): Promise<void> {
  for (const view of DAY_VIEWS) {
    await position(page, view.place, 'island', view.x + 0.5, view.y + 0.5);
    await capture(page, 'A-day', view.name, 'island');
  }
  await inspectFrames(page, 'A-day-outdoors');
}

async function captureRooms(page: Page, group: 'B' | 'C' | 'D'): Promise<void> {
  for (const room of ROOMS[group]) {
    if (room.area === 'green_in') {
      // Keep the first pot empty and exercise the real crop drawing over the other two.
      await page.evaluate(() => {
        const crops = (window as any).__game.g.s.crops;
        crops.push({ x: -2, y: -1, seed: 'wheat_seed', age: 0 }, { x: -3, y: -1, seed: 'wheat_seed', age: 8 });
      });
    }
    await position(page, room.place, room.area, room.x, room.y);
    await capture(page, group, room.area, room.area);
  }
  await inspectFrames(page, `${group}-rooms`);
}

async function captureJetty(page: Page, season: 'day' | 'snow'): Promise<void> {
  await position(page, 'pond_e', 'island', 44.5, 77.5);
  await capture(page, 'E', `pond-jetty-${season}-broken`, 'island');
  await debug(page, 'flag', 'site_jetty');
  await waitFor(
    page,
    () => {
      const scene = (window as any).__game.game.scene.getScene('World');
      return scene.children.list.some(
        (child: any) =>
          child.visible && child.frame?.name === 'bridge_jetty' && child.x === 41 * 64 - 12 && child.y === 77 * 64 - 12,
      );
    },
    'the whole jetty over the three-tile gap',
  );
  await capture(page, 'E', `pond-jetty-${season}-mended`, 'island');
}

async function showPackedCastle(page: Page, stage: number): Promise<string | null> {
  const preview = await page.evaluate((stageNumber: number) => {
    const g = (window as any).__game.g;
    const scene = g ? (window as any).__game.game.scene.getScene('World') : null;
    if (!scene) return null;
    g.rt.castles = {};
    for (const image of scene.castleImgs ?? []) image.setVisible(false);
    for (const child of [...scene.children.list]) if (child.getData?.('graphics2PackedCastlePreview')) child.destroy();
    const name = `sandcastle_${stageNumber}`;
    const textures = scene.textures;
    const atlas = textures.getTextureKeys().find((key: string) => textures.get(key).getFrameNames().includes(name));
    if (!atlas) return null;
    const x = 34.5 * 64;
    // Match the sandpit anchor in core/fun and the three draw sizes in World.drawCastles.
    const y = (64 + 3 * 0.32) * 64;
    const renderedPixels = [0, 34, 48, 58][stageNumber]!;
    scene.add
      .image(x, y, atlas, name)
      .setOrigin(0.5, 1)
      .setDisplaySize(renderedPixels, renderedPixels)
      .setDepth(y)
      .setData('graphics2PackedCastlePreview', true);
    return { atlas, renderedPixels };
  }, stage);
  if (!preview) return null;
  results.previewFrames.push({ frame: `sandcastle_${stage}`, ...preview });
  await sleep(180);
  return preview.atlas;
}

async function captureCastles(page: Page): Promise<void> {
  await position(page, 'pond_e', 'island', 34.5, 68.5);
  for (const stage of [1, 2, 3]) {
    const atlas = await showPackedCastle(page, stage);
    if (!atlas) {
      results.omitted.push({
        name: `sandcastle_${stage}-packed-preview`,
        reason: `frame sandcastle_${stage} is not in a loaded atlas`,
      });
      console.log(`skip E/sandcastle_${stage}-packed-preview: frame is not in a loaded atlas`);
      continue;
    }
    await capture(page, 'E', `sandcastle_${stage}-packed-preview`, 'island');
  }
}

async function measurePage(
  page: Page,
  where: string,
  place: string,
  area: string,
  x: number,
  y: number,
): Promise<void> {
  await position(page, place, area, x, y);
  await inspectMemory(page, where);
  await inspectFrames(page, where);
}

async function measureIpad(groups: string[]): Promise<void> {
  console.log('iPad check uses emulated iPad Pro 11 landscape in WebKit on this computer');
  const browser = await openGame('off', 'iPad Pro 11 landscape (WebKit emulation)', 'webkit', 'iPad Pro 11 landscape');
  try {
    const page = browser.page;
    if (groups.includes('A')) {
      for (const view of DAY_VIEWS)
        await measurePage(page, `iPad-A-day/${view.name}`, view.place, 'island', view.x + 0.5, view.y + 0.5);
      const snowBrowser = await openGame(
        'on',
        'iPad Pro 11 landscape Christmas (WebKit emulation)',
        'webkit',
        'iPad Pro 11 landscape',
      );
      try {
        await measurePage(snowBrowser.page, 'iPad-A-snow/forest-path', 'forest_path', 'island', 122.5, 37.5);
        results.errors.push(...(await snowBrowser.page.evaluate(() => (window as any).__game.errors as string[])));
      } finally {
        await snowBrowser.close();
      }
    }
    for (const group of ['B', 'C', 'D'] as const) {
      if (!groups.includes(group)) continue;
      for (const room of ROOMS[group])
        await measurePage(page, `iPad-${group}-rooms/${room.area}`, room.place, room.area, room.x, room.y);
    }
    if (groups.includes('E')) {
      await measurePage(page, 'iPad-E-pond-jetty-broken', 'pond_e', 'island', 44.5, 77.5);
      await position(page, 'pond_e', 'island', 34.5, 68.5);
      for (const stage of [1, 2, 3]) {
        const atlas = await showPackedCastle(page, stage);
        const where = `iPad-E-sandcastle_${stage}-packed-preview`;
        if (!atlas) {
          results.omitted.push({
            name: where,
            reason: `frame sandcastle_${stage} is not in a loaded atlas`,
          });
          continue;
        }
        await inspectMemory(page, where);
        await inspectFrames(page, where);
      }
    }
    results.errors.push(...(await page.evaluate(() => (window as any).__game.errors as string[])));
  } finally {
    await browser.close();
  }
}

function writeGroupReports(data: Results, groups: string[], suffix = ''): string[] {
  const paths: string[] = [];
  for (const group of groups) {
    const screenshotMatches = (file: string) =>
      group === 'A' ? file.includes('/A-day/') || file.includes('/A-snow/') : file.includes(`/${group}/`);
    const sceneMatches = (where: string) =>
      group === 'A'
        ? where.includes('A-day') || where.includes('A-snow')
        : where.includes(`${group}-`) || where.startsWith(`${group}/`);
    const file = resolve(OUT, `report-${group}${suffix ? `-${suffix}` : ''}.json`);
    writeFileSync(
      file,
      `${JSON.stringify(
        {
          url: GAME,
          group,
          captureMode: suffix || 'desktop',
          screenshots: data.screenshots.filter(screenshotMatches),
          memory: data.memory.filter((sample) => sceneMatches(sample.where)),
          frame: data.frame.filter((sample) => sceneMatches(sample.where)),
          browserChecks: data.browserChecks,
          previewFrames: data.previewFrames,
          omitted: data.omitted,
          errors: data.errors,
        },
        null,
        2,
      )}\n`,
    );
    paths.push(file);
  }
  return paths;
}

async function main(): Promise<void> {
  const valid = new Set(['A', 'B', 'C', 'D', 'E']);
  for (const group of GROUPS) if (!valid.has(group)) throw new Error(`unknown group ${group}`);
  if (!GROUPS.length) throw new Error('choose at least one group with --group A,B,C,D,E');

  const browser = await openGame('off', 'desktop Chromium');
  try {
    const { page } = browser;
    if (GROUPS.includes('A')) await captureDayViews(page);

    if (GROUPS.includes('B')) await captureRooms(page, 'B');
    if (GROUPS.includes('C')) await captureRooms(page, 'C');
    if (GROUPS.includes('D')) await captureRooms(page, 'D');
    if (GROUPS.includes('E')) {
      await captureJetty(page, 'day');
      await captureCastles(page);
    }
    results.errors.push(...(await page.evaluate(() => (window as any).__game.errors as string[])));
  } finally {
    await browser.close();
  }

  if (GROUPS.includes('A') || GROUPS.includes('E')) {
    const snowBrowser = await openGame('on', 'desktop Christmas Chromium');
    try {
      if (GROUPS.includes('A')) {
        await position(snowBrowser.page, 'forest_path', 'island', 122.5, 37.5);
        await capture(snowBrowser.page, 'A-snow', 'forest-path', 'island');
        await inspectFrames(snowBrowser.page, 'A-snow-outdoors');
      }
      if (GROUPS.includes('E')) await captureJetty(snowBrowser.page, 'snow');
      results.errors.push(...(await snowBrowser.page.evaluate(() => (window as any).__game.errors as string[])));
    } finally {
      await snowBrowser.close();
    }
  }

  const desktopResults = results;
  const desktopReports = writeGroupReports(desktopResults, GROUPS);
  console.log(`saved ${desktopResults.screenshots.length} screenshots and ${desktopReports.join(', ')}`);
  if (IPAD) {
    results = emptyResults();
    await measureIpad(GROUPS);
    const ipadReports = writeGroupReports(results, GROUPS, 'ipad-webkit');
    console.log(`saved iPad-emulation measurements in ${ipadReports.join(', ')}`);
  }
  const errors = IPAD ? [...desktopResults.errors, ...results.errors] : desktopResults.errors;
  console.log(`errors ${JSON.stringify(errors)}`);
  if (errors.length) process.exitCode = 1;
}

await main();
