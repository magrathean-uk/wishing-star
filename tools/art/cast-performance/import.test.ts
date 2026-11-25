import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import sharp, { type OverlayOptions } from 'sharp';
import { alphaBox, blank, load, over } from '../imgutil.ts';
import { mannerTiming } from '../manner.ts';
import { candidate, fitRow, installBatch, keySheet } from './import.ts';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (file: string) => JSON.parse(readFileSync(file, 'utf8'));

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'cast-performance-test-'));
  for (const id of ['bluey', 'alien', 'cow']) {
    const target = join(root, 'art/src/chars', id);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(join(repo, 'art/src/chars', id), target, { recursive: true });
  }
  for (const file of ['art/qa/motion.json', 'public/assets/chars/index.json']) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    cpSync(join(repo, file), join(root, file));
  }
  return root;
}

async function sheet(
  root: string,
  id: string,
  options: { background?: string; missing?: number; border?: boolean } = {},
): Promise<string> {
  const dir = join(root, 'art/src/chars', id);
  const meta = read(join(dir, 'meta.json'));
  const side = meta.clips.walk?.side ?? meta.clips.talk.down;
  const front = meta.clips.talk?.down ?? meta.clips.idle.down;
  // A four-beat walk repeats its passing pose on beat four. Sample its three distinct drawings.
  const walkPoses = side.length >= 5 ? [side[0], side[2], side[4]] : [side[0], side[1], side[2]];
  const files = [...walkPoses, front[0], front[1], front[2] ?? front[0]];
  const cell = 256;
  const overlays: OverlayOptions[] = [];
  for (let n = 0; n < 6; n++) {
    if (n === options.missing) continue;
    const image = await sharp(join(dir, files[n])).png().toBuffer();
    overlays.push({
      input: image,
      left: (n % 3) * cell + Math.floor((cell - meta.w) / 2),
      top: Math.floor(n / 3) * cell + Math.floor((cell - meta.h) / 2),
    });
  }
  if (options.border) {
    overlays.push({ input: { create: { width: 1, height: 1, channels: 4, background: '#ffffff' } }, left: 0, top: 0 });
  }
  const file = join(
    root,
    `${id}-${options.missing ?? 'full'}-${options.background ?? 'alpha'}-${options.border ?? false}.png`,
  );
  await sharp({
    create: { width: cell * 3, height: cell * 2, channels: 4, background: options.background ?? '#00000000' },
  })
    .composite(overlays)
    .png()
    .toFile(file);
  return file;
}

async function walkSheet(root: string, id: string, duplicate = false): Promise<string> {
  const dir = join(root, 'art/src/chars', id);
  const meta = read(join(dir, 'meta.json'));
  const cell = 256;
  const overlays: OverlayOptions[] = [];
  for (let n = 0; n < 8; n++) {
    const image = await sharp(join(dir, meta.clips.walk.side[duplicate && n === 7 ? 0 : n]))
      .png()
      .toBuffer();
    overlays.push({
      input: image,
      left: (n % 4) * cell + Math.floor((cell - meta.w) / 2),
      top: Math.floor(n / 4) * cell + Math.floor((cell - meta.h) / 2),
    });
  }
  const file = join(root, `eight-${duplicate}.png`);
  await sharp({ create: { width: cell * 4, height: cell * 2, channels: 4, background: '#00000000' } })
    .composite(overlays)
    .png()
    .toFile(file);
  return file;
}

function cleanup(root: string): void {
  rmSync(root, { recursive: true, force: true });
}

test('six cels install as four-frame loops while preserving facings, extras and lazy aliases', async () => {
  const root = fixture();
  try {
    const file = await sheet(root, 'bluey');
    const item = await candidate(root, 'bluey', file);
    assert.deepEqual(item.errors, {});
    assert.ok(item.approvals.walk);
    assert.ok(item.approvals.talk);
    const before = read(join(root, 'art/src/chars/bluey/meta.json'));
    const indexBefore = read(join(root, 'public/assets/chars/index.json'));
    await installBatch(root, [{ id: 'bluey', sheet: file, approvals: item.approvals }]);
    const meta = read(join(root, 'art/src/chars/bluey/meta.json'));
    const index = read(join(root, 'public/assets/chars/index.json'));
    assert.deepEqual(meta.clips.walk.down, before.clips.walk.down);
    assert.deepEqual(meta.clips.walk.up, before.clips.walk.up);
    assert.deepEqual(meta.clips.talk.side, before.clips.talk.side);
    assert.deepEqual(meta.clips.swing, before.clips.swing);
    assert.deepEqual([meta.w, meta.h, meta.px, meta.footY], [before.w, before.h, before.px, before.footY]);
    for (const clip of ['walk', 'talk']) {
      const f = meta.clips[clip][clip === 'walk' ? 'side' : 'down'];
      assert.equal(f.length, 4);
      assert.equal(f[1], f[3]);
      assert.notEqual(f[0], f[2]);
    }
    assert.deepEqual(meta.timing.walk.durs, before.timing.walk.durs);
    assert.deepEqual(meta.timing.walk.step, before.timing.walk.step);
    assert.deepEqual(meta.timing.walk.stepByFacing.side, [0, 2]);
    assert.deepEqual(index.groups.alien, indexBefore.groups.alien);
    assert.deepEqual(index.sets.alien, indexBefore.sets.alien);
    assert.deepEqual(index.lazy.bluey, indexBefore.lazy.bluey);
    const pages = index.groups.bluey.map((p: string) => read(join(root, 'public/assets/chars', `${p}.json`)).frames);
    for (const facings of Object.values(index.sets.bluey.clips) as Record<string, string[]>[])
      for (const frames of Object.values(facings))
        for (const frame of frames)
          assert.ok(
            pages.some((page: Record<string, unknown>) => page[frame]),
            `missing atlas frame ${frame}`,
          );
    const main = pages[pages.length - 1];
    for (const frame of index.lazy.bluey.frames) assert.ok(main[frame], `missing fallback alias ${frame}`);
    assert.ok(read(join(root, 'art/qa/motion.json')).results.bluey.walk_side.ok);
    assert.ok(existsSync(join(root, 'art/qa/cast-performance/bluey.png')));
  } finally {
    cleanup(root);
  }
});

test('rows are independently rejectable, including a missing cel', async () => {
  const root = fixture();
  try {
    const file = await sheet(root, 'bluey', { missing: 1 });
    const item = await candidate(root, 'bluey', file);
    assert.match(item.errors.walk ?? '', /empty cel/);
    assert.equal(item.approvals.walk, undefined);
    assert.ok(item.approvals.talk);
    const before = read(join(root, 'art/src/chars/bluey/meta.json'));
    await installBatch(root, [{ id: 'bluey', sheet: file, approvals: { talk: item.approvals.talk } }]);
    const after = read(join(root, 'art/src/chars/bluey/meta.json'));
    assert.deepEqual(after.clips.walk, before.clips.walk);
    assert.notDeepEqual(after.clips.talk.down, before.clips.talk.down);
  } finally {
    cleanup(root);
  }
});

test('fixed and non-speaking roles do not acquire inappropriate clips', async () => {
  const root = fixture();
  try {
    const fixedFile = await sheet(root, 'alien');
    const animalFile = await sheet(root, 'cow');
    const fixed = await candidate(root, 'alien', fixedFile);
    const animal = await candidate(root, 'cow', animalFile);
    assert.equal(fixed.approvals.walk, undefined);
    assert.ok(fixed.approvals.talk);
    assert.ok(animal.approvals.walk);
    assert.equal(animal.approvals.talk, undefined);
    const before = read(join(root, 'art/src/chars/cow/meta.json'));
    await installBatch(root, [
      { id: 'alien', sheet: fixedFile, approvals: fixed.approvals },
      { id: 'cow', sheet: animalFile, approvals: animal.approvals },
    ]);
    const animalMeta = read(join(root, 'art/src/chars/cow/meta.json'));
    assert.equal(animalMeta.clips.talk, undefined);
    assert.deepEqual(animalMeta.clips.hop, before.clips.hop);
    assert.equal(read(join(root, 'art/src/chars/alien/meta.json')).clips.walk, undefined);
  } finally {
    cleanup(root);
  }
});

test('invalid background and stale approvals are rejected before writing any batch output', async () => {
  const root = fixture();
  try {
    const file = await sheet(root, 'bluey');
    const broken = await sheet(root, 'bluey', { background: '#ffffff' });
    await assert.rejects(candidate(root, 'bluey', broken), /transparent or a near-magenta/);
    const item = await candidate(root, 'bluey', file);
    const metaFile = join(root, 'art/src/chars/bluey/meta.json');
    const indexFile = join(root, 'public/assets/chars/index.json');
    const beforeMeta = readFileSync(metaFile);
    const beforeIndex = readFileSync(indexFile);
    await assert.rejects(
      installBatch(root, [{ id: 'bluey', sheet: file, approvals: { talk: 'wrong' } }]),
      /approval does not match/,
    );
    assert.deepEqual(readFileSync(metaFile), beforeMeta);
    assert.deepEqual(readFileSync(indexFile), beforeIndex);
    writeFileSync(metaFile, `${beforeMeta.toString()} `);
    await assert.rejects(
      installBatch(root, [{ id: 'bluey', sheet: file, approvals: item.approvals }]),
      /approval does not match/,
    );
    assert.deepEqual(readFileSync(indexFile), beforeIndex);
  } finally {
    cleanup(root);
  }
});

test('exact magenta is keyed and accepts a valid row', async () => {
  const root = fixture();
  try {
    const file = await sheet(root, 'bluey', { background: '#ff00ff' });
    const item = await candidate(root, 'bluey', file);
    assert.equal(item.background, 'magenta');
    assert.ok(item.approvals.walk);
    assert.ok(item.approvals.talk);
  } finally {
    cleanup(root);
  }
});

test('an eight-drawing walk keeps eight unique frames and its authored timing', async () => {
  const root = fixture();
  try {
    const file = await sheet(root, 'bluey');
    const eight = await walkSheet(root, 'bluey');
    const item = await candidate(root, 'bluey', file, eight);
    assert.ok(item.approvals.walk, item.errors.walk ?? 'walk approval missing');
    const before = read(join(root, 'art/src/chars/bluey/meta.json'));
    await installBatch(root, [
      { id: 'bluey', sheet: file, walkSheet: eight, approvals: { walk: item.approvals.walk } },
    ]);
    const after = read(join(root, 'art/src/chars/bluey/meta.json'));
    assert.equal(after.clips.walk.side.length, 8);
    assert.equal(new Set(after.clips.walk.side).size, 8);
    assert.deepEqual(after.timing.walk.durs, before.timing.walk.durs);
    assert.deepEqual(after.timing.walk.step, before.timing.walk.step);
    assert.deepEqual(after.timing.walk.stepByFacing.side, [0, 4]);
    assert.deepEqual(after.clips.talk, before.clips.talk);
    const duplicate = await walkSheet(root, 'bluey', true);
    const rejected = await candidate(root, 'bluey', file, duplicate);
    assert.match(rejected.errors.walk ?? '', /repeated frames/);
    assert.ok(rejected.approvals.talk);
  } finally {
    cleanup(root);
  }
});

test('a default-timed walk keeps its cycle length without changing other facings', async () => {
  const root = fixture();
  try {
    const metaFile = join(root, 'art/src/chars/bluey/meta.json');
    const meta = read(metaFile);
    delete meta.timing.walk;
    writeFileSync(metaFile, JSON.stringify(meta));
    const file = await sheet(root, 'bluey');
    const item = await candidate(root, 'bluey', file);
    assert.ok(item.approvals.walk, item.errors.walk ?? 'walk approval missing');
    await installBatch(root, [{ id: 'bluey', sheet: file, approvals: { walk: item.approvals.walk } }]);
    const after = read(metaFile);
    assert.deepEqual(after.timing.walk.durs, Array(8).fill(0.125));
    assert.deepEqual(after.timing.walk.step, [2, 6]);
    assert.deepEqual(after.timing.walk.stepByFacing.side, [0, 2]);
    assert.deepEqual(after.clips.walk.up, meta.clips.walk.up);
    assert.deepEqual(after.clips.walk.down, meta.clips.walk.down);
  } finally {
    cleanup(root);
  }
});

test('measured magenta gaps are keyed but different pink and purple details survive', () => {
  const img = blank(300, 200);
  const fill = (x0: number, y0: number, x1: number, y1: number, rgba: number[]) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) img.d.set(rgba, (y * img.w + x) * 4);
  };
  fill(0, 0, img.w, img.h, [249, 6, 249, 255]);
  fill(10, 10, 80, 70, [25, 25, 25, 255]);
  fill(18, 18, 32, 32, [246, 5, 243, 255]);
  fill(40, 18, 54, 32, [232, 14, 234, 255]);
  fill(60, 18, 74, 32, [255, 110, 190, 255]);
  const keyed = keySheet(img);
  const pixel = (x: number, y: number) => Array.from(img.d.slice((y * img.w + x) * 4, (y * img.w + x) * 4 + 4));
  assert.equal(keyed.keyedHoles.length, 1);
  assert.equal(pixel(22, 22)[3], 0);
  assert.deepEqual(pixel(45, 22), [232, 14, 234, 255]);
  assert.deepEqual(pixel(65, 22), [255, 110, 190, 255]);
});

test('a whole walk can shift a few pixels without cropping, moving its feet or rescaling', async () => {
  const meta = { id: 'wolf', group: 'animals', tall: 1, w: 100, h: 100, footY: 90, px: 80, clips: {} };
  const reference = blank(100, 100);
  const figure = blank(56, 80);
  for (let y = 10; y < 90; y++) for (let x = 50; x < 90; x++) reference.d.set([70, 70, 70, 255], (y * 100 + x) * 4);
  for (let y = 0; y < 80; y++)
    for (let x = 0; x < (y < 48 ? 48 : 56); x++) figure.d.set([70, 70, 70, 255], (y * 56 + x) * 4);
  await assert.rejects(fitRow(meta, reference, [figure, figure, figure]), /does not fit/);
  const result = await fitRow(meta, reference, [figure, figure, figure], true);
  assert.deepEqual(result.adjustment, { scale: 1, shiftX: -2 });
  for (const frame of result.frames) assert.deepEqual(alphaBox(frame), { x0: 44, y0: 10, x1: 100, y1: 90 });
  const tooWide = blank(80, 80);
  for (let y = 0; y < 80; y++)
    for (let x = 0; x < (y < 48 ? 48 : 80); x++) tooWide.d.set([70, 70, 70, 255], (y * 80 + x) * 4);
  await assert.rejects(fitRow(meta, reference, [tooWide, tooWide, tooWide], true), /registration limit/);
});

test('Kuromi and Jessie retain their existing opaque colours against a magenta key', async () => {
  for (const id of ['kuromi', 'jessie']) {
    const original = await load(join(repo, 'art/src/chars', id, 'idle_down_0.png'));
    const canvas = blank(original.w + 100, original.h + 100);
    for (let i = 0; i < canvas.d.length; i += 4) canvas.d.set([249, 6, 249, 255], i);
    over(canvas, original, 50, 50);
    const before = Uint8Array.from(canvas.d);
    keySheet(canvas);
    let pink = 0;
    let pale = 0;
    for (let y = 1; y < original.h - 1; y++)
      for (let x = 1; x < original.w - 1; x++) {
        const i = (y * original.w + x) * 4;
        const neighbours = [i - 4, i + 4, i - original.w * 4, i + original.w * 4];
        if (original.d[i + 3]! < 250 || neighbours.some((j) => original.d[j + 3]! < 250)) continue;
        const pixel = Array.from(original.d.slice(i, i + 4));
        if (pixel[0]! > 160 && pixel[1]! > 40 && pixel[1]! < 200 && pixel[2]! > 80) pink++;
        if (pixel[0]! > 200 && pixel[1]! > 200 && pixel[2]! > 200) pale++;
        const actual = ((y + 50) * canvas.w + x + 50) * 4;
        assert.deepEqual(
          Array.from(canvas.d.slice(actual, actual + 4)),
          Array.from(before.slice(actual, actual + 4)),
          `${id} interior colour changed`,
        );
      }
    assert.ok(id === 'kuromi' ? pink > 0 : pale > 0, `${id} reference did not exercise its coloured detail`);
  }
});

test('an eight-cel walk gives every new pose time without changing the older facings', async () => {
  const root = fixture();
  try {
    const file = join(root, 'art/src/chars/bluey/meta.json');
    const before = read(file);
    before.timing.walk.durs = [0.137, 0.137, 0.106, 0, 0.137, 0.137, 0.106, 0];
    writeFileSync(file, JSON.stringify(before));
    const six = await sheet(root, 'bluey');
    const eight = await walkSheet(root, 'bluey');
    const item = await candidate(root, 'bluey', six, eight);
    assert.ok(item.approvals.walk, item.errors.walk ?? 'walk approval missing');
    await installBatch(root, [{ id: 'bluey', sheet: six, walkSheet: eight, approvals: { walk: item.approvals.walk } }]);
    const after = read(file);
    assert.deepEqual(after.timing.walk.durs, before.timing.walk.durs);
    assert.deepEqual(after.clips.walk.down, before.clips.walk.down);
    assert.deepEqual(after.clips.walk.up, before.clips.walk.up);
    assert.deepEqual(
      after.timing.walk.dursByFacing.side.map((n: number) => Number(n.toFixed(6))),
      [0.1191, 0.1191, 0.0943, 0.0475, 0.1191, 0.1191, 0.0943, 0.0475],
    );
    const packed = read(join(root, 'public/assets/chars/index.json')).sets.bluey.timing.walk;
    assert.deepEqual(packed.dursByFacing.side, after.timing.walk.dursByFacing.side);
  } finally {
    cleanup(root);
  }
});

test('a new front expression row remains fully visible without changing old side speech', async () => {
  const root = fixture();
  try {
    const file = join(root, 'art/src/chars/bluey/meta.json');
    const before = read(file);
    before.timing.talk.durs = [0.3, 0, 0, 0.3];
    writeFileSync(file, JSON.stringify(before));
    const six = await sheet(root, 'bluey');
    const item = await candidate(root, 'bluey', six);
    assert.ok(item.approvals.talk, item.errors.talk ?? 'talk approval missing');
    await installBatch(root, [{ id: 'bluey', sheet: six, approvals: { talk: item.approvals.talk } }]);
    const after = read(file);
    assert.deepEqual(after.timing.talk.durs, before.timing.talk.durs);
    assert.deepEqual(after.clips.talk.side, before.clips.talk.side);
    assert.deepEqual(
      after.timing.talk.dursByFacing.down.map((n: number) => Number(n.toFixed(6))),
      [0.225, 0.075, 0.075, 0.225],
    );
    const packed = read(join(root, 'public/assets/chars/index.json')).sets.bluey.timing.talk;
    assert.deepEqual(packed.dursByFacing.down, after.timing.talk.dursByFacing.down);
  } finally {
    cleanup(root);
  }
});

test('series retiming preserves the installed facing durations and foot contacts', () => {
  const eight = Array.from({ length: 8 }, (_, i) => `walk${i}`);
  const four = Array.from({ length: 4 }, (_, i) => `talk${i}`);
  const walk = { durs: [1], dursByFacing: { side: Array(8).fill(0.095) }, stepByFacing: { side: [0, 4] } };
  const talk = { durs: [1], dursByFacing: { down: [0.225, 0.075, 0.075, 0.225] } };
  const flop = mannerTiming('flop', { walk: { down: eight, side: eight, up: eight } }, { walk });
  const mimmy = mannerTiming('mimmy', { talk: { down: four, side: four } }, { talk });
  assert.deepEqual(flop.walk!.dursByFacing, walk.dursByFacing);
  assert.deepEqual(flop.walk!.stepByFacing, walk.stepByFacing);
  assert.deepEqual(mimmy.talk!.dursByFacing, talk.dursByFacing);
  assert.deepEqual(mimmy.talk!.durs, [0.3, 0, 0, 0.3]);
});

test('a later bad batch decision leaves earlier characters and shared indexes untouched', async () => {
  const root = fixture();
  try {
    const first = await sheet(root, 'bluey');
    const second = await sheet(root, 'alien');
    const approved = await candidate(root, 'bluey', first);
    const meta = join(root, 'art/src/chars/bluey/meta.json');
    const index = join(root, 'public/assets/chars/index.json');
    const oldMeta = readFileSync(meta);
    const oldIndex = readFileSync(index);
    await assert.rejects(
      installBatch(root, [
        { id: 'bluey', sheet: first, approvals: approved.approvals },
        { id: 'alien', sheet: second, approvals: { talk: 'wrong' } },
      ]),
      /approval does not match/,
    );
    assert.deepEqual(readFileSync(meta), oldMeta);
    assert.deepEqual(readFileSync(index), oldIndex);
  } finally {
    cleanup(root);
  }
});
