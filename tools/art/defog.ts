// Clear a pale see-through haze left at the edge of a character frame. The slicer (process.ts) clears haze that
// reaches the sheet's border, but a band that only touches the drawing's outline survives: one north-facing idle
// frame of Mummy Pig kept a whitish bar over her ears that way (issue 38).
//   node tools/art/defog.ts art/src/chars/<id>/<frame>.png [...]      clears it in place; then node tools/art/pack.ts,
//                                                                      keeping only that character's pages (a full
//                                                                      pack also lays the object atlas out afresh)
//   node tools/art/defog.ts --check art/src/chars/<id>                  lists frames with haze, changes nothing
// Only pale, nearly colourless, see-through pixels reached from the clear background go. The drawing stays: its solid
// pixels and its soft edge, which carries the outline's or the fill's colour. The soft edge of a character drawn in
// white would go too, so this is a tool for one frame at a time, not a pass over every sheet.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { type Img, load, savePng } from './imgutil.ts';

/** At or above this alpha a pixel is the drawing itself. */
const SOLID = 245;
/** Haze is light (luma at least this) ... */
const PALE = 150;
/** ... and nearly colourless (largest minus smallest channel at most this). */
const GREY = 60;

/** Clears the haze in place; returns how many pixels it cleared. */
export function clearFog(img: Img): number {
  const { w, h, d } = img;
  const fog = (i: number): boolean => {
    const a = d[i * 4 + 3]!;
    if (a === 0 || a >= SOLID) return false;
    const r = d[i * 4]!;
    const g = d[i * 4 + 1]!;
    const b = d[i * 4 + 2]!;
    return 0.299 * r + 0.587 * g + 0.114 * b >= PALE && Math.max(r, g, b) - Math.min(r, g, b) <= GREY;
  };
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let i = 0; i < w * h; i++)
    if (d[i * 4 + 3] === 0) {
      seen[i] = 1;
      stack.push(i);
    }
  let cleared = 0;
  while (stack.length) {
    const p = stack.pop()!;
    const x = p % w;
    const y = (p - x) / w;
    for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1])
      if (q >= 0 && !seen[q] && fog(q)) {
        seen[q] = 1;
        d[q * 4 + 3] = 0;
        cleared++;
        stack.push(q);
      }
  }
  return cleared;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  if (argv[0] === '--check') {
    for (const dir of argv.slice(1))
      for (const f of readdirSync(dir)
        .filter((n) => n.endsWith('.png'))
        .sort()) {
        const n = clearFog(await load(join(dir, f)));
        if (n) console.log(`${join(dir, f)}: ${n} haze pixels`);
      }
  } else
    for (const file of argv) {
      const img = await load(file);
      const n = clearFog(img);
      if (n) await savePng(img, file);
      console.log(`${file}: ${n ? `cleared ${n} haze pixels` : 'no haze'}`);
    }
}
