import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { finishFrame, isSkin, makeAnchor, profileFor, verifyAnchor, type MaterialPlate } from './cast-finish.ts';
import type { Img } from './imgutil.ts';

function material(): MaterialPlate {
  const values = Float32Array.from({ length: 64 }, (_, i) => 170 + i);
  const tile = { w: 8, h: 8, luminance: values, mean: 200, deviation: 20 };
  return { cel: tile, felt: tile, vinyl: tile, voxel: tile, textile: tile, plastic: tile };
}

function example(): Img {
  const img: Img = { w: 40, h: 40, d: new Uint8Array(40 * 40 * 4) };
  for (let y = 3; y < 37; y++)
    for (let x = 3; x < 37; x++) {
      const i = (y * img.w + x) * 4;
      img.d.set([210, 30, 30, 255], i);
    }
  // Deliberate skin patch and dark line in the treatment area.
  for (let y = 24; y < 31; y++) for (let x = 9; x < 16; x++) img.d.set([220, 164, 128, 255], (y * img.w + x) * 4);
  for (let y = 21; y < 35; y++) img.d.set([20, 20, 20, 255], (y * img.w + 21) * 4);
  return img;
}

test('material treatment keeps alpha, face, skin, edges and outlines exactly', () => {
  const src = example();
  const { img, changed } = finishFrame(src, material(), profileFor('buzz', 'toy', 'biped'));
  assert.ok(changed > 0);
  for (let y = 0; y < src.h; y++)
    for (let x = 0; x < src.w; x++) {
      const i = (y * src.w + x) * 4;
      assert.equal(img.d[i + 3], src.d[i + 3]);
      if (y < 17 || (x >= 9 && x < 16 && y >= 24 && y < 31) || (x === 21 && y >= 21 && y < 35) || src.d[i + 3] === 0)
        assert.deepEqual(img.d.slice(i, i + 4), src.d.slice(i, i + 4));
    }
  assert.ok(isSkin(220, 164, 128));
  assert.ok(!isSkin(210, 30, 30));
});

test('flat cartoon and voxel profiles never add spatial texture to a solid colour', () => {
  const src = example();
  for (const p of [profileFor('peppa', 'crayon', 'biped'), profileFor('zombie', 'block', 'biped')]) {
    const { img, changed } = finishFrame(src, material(), p);
    assert.ok(changed > 0);
    const one = (26 * src.w + 27) * 4;
    const two = (32 * src.w + 32) * 4;
    assert.deepEqual(img.d.slice(one, one + 4), img.d.slice(two, two + 4));
  }
  assert.equal(profileFor('hello_kitty', 'kawaii', 'biped').flat, true);
});

test('toy surfaces get local form, with a separately guarded blue helmet', () => {
  const src = example();
  for (let y = 5; y < 14; y++) for (let x = 5; x < 14; x++) src.d.set([165, 197, 220, 255], (y * src.w + x) * 4);
  const profile = { ...profileFor('buzz', 'toy', 'biped'), amount: 0 };
  const { img } = finishFrame(src, material(), profile);
  const pixel = (x: number, y: number) => img.d.slice((y * src.w + x) * 4, (y * src.w + x) * 4 + 4);
  assert.notDeepEqual(pixel(27, 20), pixel(32, 32), 'a single surface needs light and shade');
  assert.notDeepEqual(pixel(8, 8), src.d.slice((8 * src.w + 8) * 4, (8 * src.w + 8) * 4 + 4));
  assert.deepEqual(pixel(11, 27), src.d.slice((27 * src.w + 11) * 4, (27 * src.w + 11) * 4 + 4));
});

test('the named toy boot override reaches brown leather but leaves lighter skin alone', () => {
  const src = example();
  for (let y = 28; y < 35; y++) for (let x = 26; x < 35; x++) src.d.set([130, 70, 40, 255], (y * src.w + x) * 4);
  const { img } = finishFrame(src, material(), profileFor('woody', 'toy', 'biped'));
  const boot = (31 * src.w + 30) * 4;
  const skin = (27 * src.w + 11) * 4;
  assert.notDeepEqual(img.d.slice(boot, boot + 4), src.d.slice(boot, boot + 4));
  assert.deepEqual(img.d.slice(skin, skin + 4), src.d.slice(skin, skin + 4));
});

test('the dog surface mask reaches brown paint and a narrow coil while leaving the face and outlines alone', () => {
  const src = example();
  for (let y = 3; y < 37; y++) for (let x = 3; x < 37; x++) src.d.set([210, 120, 48, 255], (y * src.w + x) * 4);
  for (let y = 19; y < 30; y++) {
    src.d.set([150, 150, 150, 255], (y * src.w + 7) * 4);
    src.d.set([150, 150, 150, 255], (y * src.w + 8) * 4);
    src.d.set([20, 20, 20, 255], (y * src.w + 9) * 4);
  }
  const { img } = finishFrame(src, material(), profileFor('slinky', 'toy', 'quad'), 'walk_side_0.png');
  const p = (x: number, y: number) => (y * src.w + x) * 4;
  assert.notDeepEqual(img.d.slice(p(7, 24), p(7, 24) + 4), src.d.slice(p(7, 24), p(7, 24) + 4));
  assert.notDeepEqual(img.d.slice(p(28, 32), p(28, 32) + 4), src.d.slice(p(28, 32), p(28, 32) + 4));
  assert.deepEqual(img.d.slice(p(25, 10), p(25, 10) + 4), src.d.slice(p(25, 10), p(25, 10) + 4));
  assert.deepEqual(img.d.slice(p(9, 24), p(9, 24) + 4), src.d.slice(p(9, 24), p(9, 24) + 4));
  for (let i = 3; i < img.d.length; i += 4) assert.equal(img.d[i], src.d[i]);
});

test('the selected yellow toys treat plastic, denim and narrow goggles as distinct surfaces', () => {
  const src = example();
  for (let y = 3; y < 37; y++) for (let x = 3; x < 37; x++) src.d.set([248, 200, 32, 255], (y * src.w + x) * 4);
  for (let x = 6; x < 15; x++) {
    src.d.set([150, 150, 150, 255], (10 * src.w + x) * 4);
    src.d.set([150, 150, 150, 255], (11 * src.w + x) * 4);
    src.d.set([40, 90, 160, 255], (14 * src.w + x) * 4);
    src.d.set([40, 90, 160, 255], (15 * src.w + x) * 4);
  }
  for (let y = 24; y < 35; y++) for (let x = 8; x < 32; x++) src.d.set([40, 90, 160, 255], (y * src.w + x) * 4);
  src.d.set([20, 20, 20, 255], (12 * src.w + 20) * 4);
  const plate = material();
  plate.textile = { ...plate.textile, luminance: new Float32Array(64).fill(240) };
  plate.plastic = { ...plate.plastic, luminance: new Float32Array(64).fill(170) };
  const p = (x: number, y: number) => (y * src.w + x) * 4;
  for (const id of ['bob', 'stuart', 'minion_d', 'minion_e']) {
    const profile = profileFor(id, 'show', 'biped');
    const { img } = finishFrame(src, plate, profile, 'idle_down_0.png');
    for (const [x, y] of [
      [25, 8],
      [10, 10],
      [10, 14],
      [20, 30],
    ])
      assert.notDeepEqual(img.d.slice(p(x!, y!), p(x!, y!) + 4), src.d.slice(p(x!, y!), p(x!, y!) + 4));
    assert.deepEqual(img.d.slice(p(20, 12), p(20, 12) + 4), src.d.slice(p(20, 12), p(20, 12) + 4));
    const changedTextile = finishFrame(src, { ...plate, textile: plate.plastic }, profile, 'idle_down_0.png').img;
    assert.notDeepEqual(img.d.slice(p(20, 30), p(20, 30) + 4), changedTextile.d.slice(p(20, 30), p(20, 30) + 4));
    assert.deepEqual(img.d.slice(p(10, 14), p(10, 14) + 4), changedTextile.d.slice(p(10, 14), p(10, 14) + 4));
  }
});

test('the horse mask treats body, saddle and hooves while keeping its head and foot registration', () => {
  const src = example();
  for (let y = 3; y < 37; y++) for (let x = 3; x < 37; x++) src.d.set([200, 110, 50, 255], (y * src.w + x) * 4);
  for (let y = 20; y < 27; y++) for (let x = 8; x < 16; x++) src.d.set([130, 55, 30, 255], (y * src.w + x) * 4);
  for (let y = 30; y < 36; y++) for (let x = 27; x < 35; x++) src.d.set([90, 30, 18, 255], (y * src.w + x) * 4);
  const { img } = finishFrame(src, material(), profileFor('bullseye', 'toy', 'quad'), 'walk_side_0.png');
  const p = (x: number, y: number) => (y * src.w + x) * 4;
  for (const [x, y] of [
    [20, 24],
    [11, 23],
    [30, 32],
  ])
    assert.notDeepEqual(img.d.slice(p(x!, y!), p(x!, y!) + 4), src.d.slice(p(x!, y!), p(x!, y!) + 4));
  for (let y = 3; y < 27; y++)
    for (let x = 27; x < 37; x++)
      assert.deepEqual(img.d.slice(p(x, y), p(x, y) + 4), src.d.slice(p(x, y), p(x, y) + 4));
  for (let i = 3; i < img.d.length; i += 4) assert.equal(img.d[i], src.d[i]);
});

test('the anchor rejects even a single changed source byte', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cast-anchor-test-'));
  const baseline = join(dir, 'source');
  const atlas = join(dir, 'assets');
  mkdirSync(join(baseline, 'chars/peppa'), { recursive: true });
  mkdirSync(join(atlas, 'chars'), { recursive: true });
  writeFileSync(
    join(baseline, 'chars/peppa/meta.json'),
    JSON.stringify({ id: 'peppa', clips: { idle: { down: ['idle.png'] } } }),
  );
  writeFileSync(join(baseline, 'chars/peppa/idle.png'), 'approved');
  writeFileSync(
    join(atlas, 'chars/index.json'),
    JSON.stringify({ groups: { peppa: ['peppa-0'] }, lazy: {}, sets: { peppa: {} } }),
  );
  writeFileSync(join(atlas, 'chars/peppa-0.json'), '{}');
  writeFileSync(join(atlas, 'chars/peppa-0.webp'), 'page');
  const anchor = makeAnchor(['peppa'], baseline, atlas);
  verifyAnchor(anchor);
  writeFileSync(join(baseline, 'chars/peppa/idle.png'), 'changed');
  assert.throws(() => verifyAnchor(anchor), /changed since anchor/);
});
