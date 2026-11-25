// Fit generated tree variants into the source frames so their ground anchors and map scale stay consistent.
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { alphaBox, blank, crop, load, over, resize, savePng, toSharp } from './imgutil.ts';

const root = resolve(import.meta.dirname, '../..');
const masters = join(root, 'art/masters/objects/graphics2');
const source = join(root, 'art/src/objects');
const variants = [
  'oak',
  'pine',
  'palm',
  'dark_oak',
  'block_oak',
  'birch',
  'gum_tree',
  'apple_tree',
  'orange_tree',
  'banana_tree',
  'burnt_tree',
];
const masterNames: Record<string, string> = { gum_tree: 'gum' };
const winterVariants = new Set([
  'oak',
  'pine',
  'birch',
  'apple_tree',
  'block_oak',
  'burnt_tree',
  'dark_oak',
  'gum_tree',
]);
const cutTargets: Record<string, [number, number]> = {
  oak: [0.49, 0.21],
  pine: [0.48, 0.2],
  birch: [0.465, 0.17],
  dark_oak: [0.47, 0.34],
  block_oak: [0.5, 0.35],
};

function trunkRange(image: Awaited<ReturnType<typeof load>>, y: number, centre: number, width: number, pale: boolean) {
  let left = image.w;
  let right = -1;
  const cx = Math.round(centre * image.w);
  const radius = Math.round(width * image.w * 0.5) + 4;
  for (let row = y - 2; row <= y + 2; row++) {
    for (let x = Math.max(0, cx - radius); x <= Math.min(image.w - 1, cx + radius); x++) {
      const pixel = (row * image.w + x) * 4;
      const red = image.d[pixel]!;
      const green = image.d[pixel + 1]!;
      const blue = image.d[pixel + 2]!;
      const alpha = image.d[pixel + 3]!;
      const bark = pale
        ? red > 145 && green > 120 && blue > 95 && Math.max(red, green, blue) - Math.min(red, green, blue) < 100
        : red > green * 1.05 && red > blue * 1.1;
      if (alpha <= 80 || !bark) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
    }
  }
  if (right < left) throw new Error(`No trunk at the cut target (${Math.round(centre * image.w)}, ${y})`);
  return { centre: (left + right) * 0.5, width: right - left };
}

async function assertCutAlignment(
  base: Awaited<ReturnType<typeof load>>,
  variant: Awaited<ReturnType<typeof load>>,
  id: string,
) {
  const [centre, width] = cutTargets[id]!;
  const stumpId = existsSync(join(source, `${id}_stump.png`)) ? `${id}_stump` : 'tree_stump';
  const stump = sharp(join(source, `${stumpId}.png`));
  const stumpSize = await stump.metadata();
  if (!stumpSize.height) throw new Error(`${id}: stump is missing its height`);
  const fromBase = Math.min(base.h * 0.4, stumpSize.height * 0.85);
  const cutY = Math.round(base.h - fromBase);
  const paleBark = id === 'birch';
  const original = trunkRange(base, cutY, centre, width, paleBark);
  const generated = trunkRange(variant, cutY, centre, width, paleBark);
  if (Math.abs(original.centre - generated.centre) > 3 || Math.abs(original.width - generated.width) > 5)
    throw new Error(`${id}: generated trunk misses its native stump cut alignment`);
}

for (const id of variants) {
  const winter = winterVariants.has(id);
  for (const season of winter ? ['', '_snow'] : ['']) {
    const stem = `${id}${season}`;
    const masterName = id === 'gum_tree' && season ? id : (masterNames[id] ?? id);
    const master = join(masters, `${masterName}${season}_variant.png`);
    if (!existsSync(master)) continue;
    const base = await load(join(source, `${stem}.png`));
    const baseBox = alphaBox(base, 8);
    const generated = await load(master);
    const generatedBox = alphaBox(generated, 8);
    if (!baseBox || !generatedBox) throw new Error(`${stem}: tree image has no visible pixels`);
    const targetW = baseBox.x1 - baseBox.x0;
    const targetH = baseBox.y1 - baseBox.y0;
    const altW = generatedBox.x1 - generatedBox.x0;
    const altH = generatedBox.y1 - generatedBox.y0;
    if (Math.abs(targetW / targetH - altW / altH) > 0.35)
      throw new Error(`${stem}: generated tree silhouette is too far from the source proportions`);
    const trimmed = crop(generated, generatedBox);
    const fitted = await resize(trimmed, targetW, targetH);
    const canvas = blank(base.w, base.h);
    over(canvas, fitted, baseBox.x0, baseBox.y0);
    const out = join(source, `${id}_v1${season}.png`);
    await savePng(canvas, out);
    const aligned = await load(out);
    const alignedBox = alphaBox(aligned, 8);
    if (
      !alignedBox ||
      alignedBox.x0 !== baseBox.x0 ||
      alignedBox.x1 !== baseBox.x1 ||
      alignedBox.y0 !== baseBox.y0 ||
      alignedBox.y1 !== baseBox.y1
    )
      throw new Error(`${stem}: visible tree bounds do not meet the native frame feet`);
    if (!season && cutTargets[id]) await assertCutAlignment(base, aligned, id);
  }
}

const crownProfiles: Record<string, [number, number, number][]> = {
  pine_v1: [
    [177, 71, 88],
    [183, 65, 93],
    [188, 63, 95],
  ],
  pine_v1_snow: [
    [185, 84, 84],
    [190, 82, 88],
    [195, 76, 95],
    [200, 73, 97],
    [205, 71, 97],
  ],
  dark_oak_v1: [
    [123, 64, 138],
    [127, 69, 132],
    [134, 72, 127],
    [137, 72, 127],
  ],
  dark_oak_v1_snow: [
    [121, 59, 144],
    [126, 67, 138],
    [131, 72, 130],
    [138, 73, 128],
  ],
};
const forestry = join(root, 'public/assets/forestry');
mkdirSync(forestry, { recursive: true });
for (const [name, profile] of Object.entries(crownProfiles)) {
  const file = join(source, `${name}.png`);
  if (!existsSync(file)) continue;
  const tree = await load(file);
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
    .toFile(join(forestry, `${name}_crown.webp`));
}
