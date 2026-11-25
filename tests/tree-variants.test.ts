import { resolve } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

const objects = resolve(import.meta.dirname, '../art/src/objects');
const trees = [
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
const snowy = ['oak', 'pine', 'birch', 'apple_tree', 'block_oak', 'burnt_tree', 'dark_oak', 'gum_tree'];
const cuts: Record<string, [number, number]> = {
  oak: [0.49, 0.21],
  pine: [0.48, 0.2],
  birch: [0.465, 0.17],
  dark_oak: [0.47, 0.34],
  block_oak: [0.5, 0.35],
};

async function image(id: string) {
  return sharp(resolve(objects, `${id}.png`))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
}

function alphaBounds(data: Buffer, width: number, height: number): [number, number, number, number] {
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3]! <= 8) continue;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  return [x0, y0, x1, y1];
}

function barkRange(
  data: Buffer,
  width: number,
  y: number,
  centre: number,
  span: number,
  pale: boolean,
): [number, number] {
  let left = width;
  let right = -1;
  const cx = Math.round(centre * width);
  const radius = Math.round(span * width * 0.5) + 4;
  for (let row = y - 2; row <= y + 2; row++) {
    for (let x = Math.max(0, cx - radius); x <= Math.min(width - 1, cx + radius); x++) {
      const pixel = (row * width + x) * 4;
      const red = data[pixel]!;
      const green = data[pixel + 1]!;
      const blue = data[pixel + 2]!;
      const alpha = data[pixel + 3]!;
      const bark = pale
        ? red > 145 && green > 120 && blue > 95 && Math.max(red, green, blue) - Math.min(red, green, blue) < 100
        : red > green * 1.05 && red > blue * 1.1;
      if (alpha <= 80 || !bark) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
    }
  }
  return [left, right];
}

describe('tree picture variants', () => {
  it('keeps the visible feet aligned with each native tree and snow frame', async () => {
    for (const id of trees) {
      const base = await image(id);
      const variant = await image(`${id}_v1`);
      expect(alphaBounds(variant.data, variant.info.width, variant.info.height), id).toEqual(
        alphaBounds(base.data, base.info.width, base.info.height),
      );
    }

    for (const id of snowy) {
      const base = await image(`${id}_snow`);
      const variant = await image(`${id}_v1_snow`);
      expect(alphaBounds(variant.data, variant.info.width, variant.info.height), `${id} snow`).toEqual(
        alphaBounds(base.data, base.info.width, base.info.height),
      );
    }
  });

  it('keeps each chopped trunk centred on its native stump cut', async () => {
    for (const [id, [centre, span]] of Object.entries(cuts)) {
      const base = await image(id);
      const variant = await image(`${id}_v1`);
      const stumpPath = resolve(objects, `${id}_stump.png`);
      const stump = await sharp(stumpPath).metadata();
      expect(stump.height, `${id} stump height`).toBeDefined();
      const cutY = Math.round(base.info.height - Math.min(base.info.height * 0.4, stump.height! * 0.85));
      const pale = id === 'birch';
      const original = barkRange(base.data, base.info.width, cutY, centre, span, pale);
      const generated = barkRange(variant.data, variant.info.width, cutY, centre, span, pale);
      expect(generated[1], `${id} trunk at cut`).toBeGreaterThanOrEqual(generated[0]);
      expect(Math.abs((original[0] + original[1]) * 0.5 - (generated[0] + generated[1]) * 0.5), id).toBeLessThanOrEqual(
        3,
      );
      expect(
        Math.abs(original[1] - original[0] - (generated[1] - generated[0])),
        `${id} cut width`,
      ).toBeLessThanOrEqual(5);
    }
  });
});
