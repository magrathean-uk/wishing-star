import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

// Rebuild every frame from the retained original poses and generated plush swatch.
// Usage: node art/src/chars/koala/plush.mjs [output-directory] [swatch]
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../../..');
const original = join(root, 'art/masters/chars/koala/original-frames');
const swatch = process.argv[3] ? resolve(process.argv[3]) : join(root, 'art/masters/chars/koala/plush-swatch.png');
const target = process.argv[2] ? resolve(process.argv[2]) : here;
const meta = JSON.parse(readFileSync(join(original, 'meta.json'), 'utf8'));
const names = [...new Set(Object.values(meta.clips).flatMap((f) => Object.values(f).flat()))];
const w = meta.w;
const h = meta.h;
const info = await sharp(swatch).metadata();
// A fixed sample of the generated fabric is registered to the character canvas.
const tw = 420;
const th = 410;
if (info.width < tw || info.height < th) throw new Error('Plush swatch is too small');
// Materialise the alpha-free luminance first: Sharp may otherwise resize premultiplied RGBA before removing alpha.
const { data: luminance, info: luminanceInfo } = await sharp(swatch)
  .removeAlpha()
  .greyscale()
  .raw()
  .toBuffer({ resolveWithObject: true });
if (luminanceInfo.channels !== 1 || luminance.length !== info.width * info.height)
  throw new Error('Plush swatch is not single-channel luminance');
const { data: grain, info: grainInfo } = await sharp(luminance, {
  raw: { width: info.width, height: info.height, channels: 1 },
})
  .extract({ left: Math.floor((info.width - tw) / 2), top: Math.floor((info.height - th) / 2), width: tw, height: th })
  .resize(w, h)
  .greyscale()
  .raw()
  .toBuffer({ resolveWithObject: true });
if (grainInfo.channels !== 1 || grain.length !== w * h) throw new Error('Plush grain is not single-channel luminance');
const { data: grainBlur, info: blurInfo } = await sharp(grain, { raw: { width: w, height: h, channels: 1 } })
  .greyscale()
  .blur(1.3)
  .raw()
  .toBuffer({ resolveWithObject: true });
if (blurInfo.channels !== 1 || grainBlur.length !== w * h)
  throw new Error('Blurred plush grain is not single-channel luminance');
console.log(
  `Swatch: ${info.channels} source channels, ${luminanceInfo.channels} luminance channel, ${grainInfo.channels} grain channel, ${blurInfo.channels} blurred grain channel`,
);
mkdirSync(target, { recursive: true });
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
for (const name of names) {
  const { data, info } = await sharp(join(original, name)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width !== w || info.height !== h || info.channels !== 4) throw new Error(`${name}: unexpected geometry`);
  // Exclude coloured marks, dark ink and near-white eye highlights from the fur mask.
  const mask = Buffer.alloc(w * h);
  for (let i = 0; i < w * h; i++) {
    const j = i * 4;
    const r = data[j];
    const g = data[j + 1];
    const b = data[j + 2];
    const a = data[j + 3];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    if (a >= 128 && lum >= 110 && lum <= 245 && Math.max(r, g, b) - Math.min(r, g, b) <= 30) mask[i] = 255;
  }
  // The blurred mask supplies a soft upper-left highlight and lower-right form shadow.
  const soft = await sharp(mask, { raw: { width: w, height: h, channels: 1 } })
    .greyscale()
    .blur(3.7)
    .raw()
    .toBuffer();
  const sample = (x, y) => (x < 0 || x >= w || y < 0 || y >= h ? 0 : soft[y * w + x]);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const j = i * 4;
      const r = data[j];
      const g = data[j + 1];
      const b = data[j + 2];
      const a = data[j + 3];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      if (!mask[i]) continue;
      const inkProtection = clamp((lum - 110) / 25, 0, 1) * clamp((246 - lum) / 12, 0, 1);
      const alphaProtection = clamp((a - 128) / 96, 0, 1);
      const light = (sample(x + 6, y + 6) - sample(x - 6, y - 6)) / 255;
      const broad = (0.5 - x / (w - 1)) * 0.65 + (0.5 - y / (h - 1)) * 0.35;
      const tex = clamp((grain[i] - grainBlur[i]) * 0.3, -5, 5);
      const shade = (light * 37 + broad * 8 + tex) * inkProtection * alphaProtection * (lum > 200 ? 0.75 : 1);
      for (let k = 0; k < 3; k++) data[j + k] = Math.round(clamp(data[j + k] + shade, 0, 255));
    }
  }
  await sharp(data, { raw: { width: w, height: h, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(join(target, name));
}
console.log(`Koala plush: ${names.length} frames to ${target}`);
