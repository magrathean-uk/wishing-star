// Prepare the transparent forestry paintings from art/jobs/graphics-forestry.json.
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { load, toSharp } from './imgutil.ts';
import { sliceSheet } from './process.ts';

const root = resolve(import.meta.dirname, '../..');
const out = join(root, 'public/assets/forestry');
mkdirSync(out, { recursive: true });
for (const [sheet, names] of [
  ['axes', ['wood_axe', 'stone_axe', 'iron_axe']],
  ['diamond', ['diamond_axe']],
  ['notch', ['notch']],
] as const) {
  const cells = await sliceSheet(join(root, 'art/masters/forestry', `${sheet}.png`), names.length, 1);
  for (const [i, name] of names.entries()) {
    await toSharp(cells[i]!.img)
      .resize({ width: 192, height: 192, fit: 'inside' })
      .webp({ lossless: true })
      .toFile(join(out, `${name}.webp`));
  }
}

// These crowns hang lower than the cut. Trace the exposed trunk under the lowest boughs so the leaves stay on
// the falling tree. Points are [source row, left bark edge, right bark edge]; the last row is below the foliage.
const rootMasks: Record<string, [number, number, number][]> = {
  dark_oak: [
    [123, 64, 138],
    [127, 69, 132],
    [134, 72, 127],
    [137, 72, 127],
  ],
  dark_oak_snow: [
    [121, 59, 144],
    [126, 67, 138],
    [131, 72, 130],
    [138, 73, 128],
  ],
  pine: [
    [177, 71, 88],
    [183, 65, 93],
    [188, 63, 95],
  ],
  pine_snow: [
    [185, 84, 84],
    [190, 82, 88],
    [195, 76, 95],
    [200, 73, 96],
    [205, 71, 97],
  ],
};
for (const [name, profile] of Object.entries(rootMasks)) {
  const tree = await load(join(root, 'art/src/objects', `${name}.png`));
  for (let i = 1; i < profile.length; i++) {
    const [y0, l0, r0] = profile[i - 1]!;
    const [y1, l1, r1] = profile[i]!;
    for (let y = y0; y < y1; y++) {
      const t = (y - y0) / (y1 - y0);
      const left = Math.round(l0 + (l1 - l0) * t);
      const right = Math.round(r0 + (r1 - r0) * t);
      for (let x = left; x <= right; x++) tree.d[(y * tree.w + x) * 4 + 3] = 0;
    }
  }
  tree.d.fill(0, profile.at(-1)![0] * tree.w * 4);
  await toSharp(tree)
    .webp({ lossless: true })
    .toFile(join(out, `${name}_crown.webp`));
}
