// Recut the original paintings at twice the shipped atlas density. Doors and feet use the original padding.
// node tools/art/buildingDetail.ts [folder containing the painted building masters]
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { PAINTED_BUILDINGS } from '../../src/game/world/buildingArt.ts';
import { alphaBox, crop, toSharp } from './imgutil.ts';
import { sliceSheet } from './process.ts';
import { dropCrumbs } from './world.ts';

const root = resolve(import.meta.dirname, '../..');
const masters = resolve(process.argv[2] ?? join(root, 'art/masters/objects/painted'));
const out = join(root, 'public/assets/buildings');
mkdirSync(out, { recursive: true });
for (const id of PAINTED_BUILDINGS) {
  for (const season of ['', '_snow']) {
    const name = id + season;
    const filename = `${name}.png`;
    const [cell] = await sliceSheet(join(masters, filename), 1, 1);
    if (!cell) throw new Error(`Missing building in ${filename}`);
    dropCrumbs(cell.img);
    const bounds = alphaBox(cell.img);
    if (!bounds) throw new Error(`Empty building in ${filename}`);
    const { width, height } = await sharp(join(root, 'art/src/objects', filename)).metadata();
    // The base fitter adds two transparent pixels on each side and below the foot.
    await toSharp(crop(cell.img, bounds))
      .resize((width - 4) * 2, (height - 2) * 2, { fit: 'fill' })
      .extend({ left: 4, right: 4, top: 0, bottom: 4, background: '#00000000' })
      .webp({ quality: 88, alphaQuality: 100, effort: 5 })
      .toFile(join(out, `${name}.webp`));
  }
}
