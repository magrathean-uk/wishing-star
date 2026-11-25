// Fit a painted wall to one tile high. Mirroring the second panel makes the horizontal repeat seamless.
import { join } from 'node:path';
import sharp from 'sharp';

const id = process.argv[2];
const vista = id === 'wall_bay' || id === 'wall_hill';
if (!vista && id !== 'wall_tower' && id !== 'wall_glass') throw new Error('Unknown room wall');
const art = join(import.meta.dirname, '../../art');
const master = sharp(join(art, 'masters/graphics2', id + '.png')).removeAlpha();
const out = join(art, 'src/ground', id + '.png');
if (vista) {
  // The entire horizon is visible through the open side of the six-tile lookout.
  await master.resize(384, 64, { fit: 'fill' }).png().toFile(out);
} else {
  const panel = await master.resize(128, 64, { fit: 'fill' }).png().toBuffer();
  const back = await sharp(panel).flop().png().toBuffer();
  await sharp({ create: { width: 256, height: 64, channels: 3, background: '#ffffff' } })
    .composite([
      { input: panel, left: 0, top: 0 },
      { input: back, left: 128, top: 0 },
    ])
    .png()
    .toFile(out);
}
