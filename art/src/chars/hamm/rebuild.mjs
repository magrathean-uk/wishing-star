// Rebuild Hamm's aligned source frames from the generated master sheet.
// The likeness reference is not shipped; the generated master is stored under art/masters/chars/hamm.
// Run from any directory: node art/src/chars/hamm/rebuild.mjs [path-to-master]
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sliceSheet } from '../../../../tools/art/process.ts';
import { blank, over, resize, savePng } from '../../../../tools/art/imgutil.ts';

const out = dirname(fileURLToPath(import.meta.url));
const master = resolve(process.argv[2] ?? resolve(out, '../../../masters/chars/hamm/hamm-ref-sheet.png'));
const names = [
  'idle_down_0', 'idle_down_1', 'idle_down_2', 'idle_down_3',
  'talk_down_0', 'talk_down_1', 'talk_down_2', 'talk_down_3',
  'wave_down_0', 'wave_down_1', 'wave_down_2', 'cheer_down_0',
  'hop_down_0', 'hop_down_1', 'hop_down_2', 'hop_down_3',
];
const source = await sliceSheet(master, 4, 4, true);
if (source.length !== names.length) throw new Error(`Expected ${names.length} poses, got ${source.length}`);
// Puppet holds idle 0 and 1, then shows the half-blink and closed blink in 2 and 3.
const order = [0, 3, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
const slices = order.map((i) => source[i]);
// One scale for every pose; the canvas and foot anchor match the existing game index.
const scale = 2 * Math.min(106 / Math.max(...slices.map((s) => s.img.w)), 97 / Math.max(...slices.map((s) => s.img.h)));
for (let i = 0; i < names.length; i++) {
  const src = slices[i].img;
  // Remove residual green spill from antialiased edges after the shared chroma-key utility.
  for (let p = 0; p < src.d.length; p += 4) {
    if (!src.d[p + 3]) continue;
    const excess = Math.max(0, src.d[p + 1] - Math.max(src.d[p], src.d[p + 2]));
    if (!excess) continue;
    const a = 255 - excess;
    src.d[p + 3] = Math.round((src.d[p + 3] * a) / 255);
    if (a) {
      src.d[p] = Math.min(255, Math.round((src.d[p] * 255) / a));
      src.d[p + 1] = Math.max(0, Math.round(((src.d[p + 1] - excess) * 255) / a));
      src.d[p + 2] = Math.min(255, Math.round((src.d[p + 2] * 255) / a));
    }
  }
  const img = await resize(src, src.w * scale, src.h * scale);
  const canvas = blank(224, 230);
  // The rear of the body anchors horizontally; only the spring and airborne hop leave the ground.
  const lift = i === 13 ? 10 : i === 14 ? 20 : 0;
  over(canvas, img, 218 - img.w, 222 - lift - img.h);
  await savePng(canvas, resolve(out, `${names[i]}.png`));
}
console.log(`Hamm: ${names.length} aligned frames from ${master}`);
