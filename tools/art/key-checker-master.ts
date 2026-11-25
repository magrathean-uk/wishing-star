// One-off (21 Nov 2026): a generated master came with a painted light checkerboard instead of real transparency
// (art/masters/objects/graphics2/oak_snow_variant.png: the snowy oak variant showed a chequered box in the game).
// The usual keyer (process.ts keyBackground) clears every light, colourless pixel, which would take the snow too.
// This one clears only pixels of the checkerboard's own two tones: those reached from the border, and enclosed
// patches that show both tones (gaps between branches). The untouched master is kept beside it as *-checker.png.
// usage: node tools/art/key-checker-master.ts <master.png> [--out <file.png>]
import { copyFileSync, existsSync } from 'node:fs';
import sharp from 'sharp';

const file = process.argv[2]!;
const outAt = process.argv.indexOf('--out');
const out = outAt > 0 ? process.argv[outAt + 1]! : file;
const { data: d, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const w = info.width;
const h = info.height;
const n = w * h;
const flat = (i: number) =>
  Math.max(d[i * 4]!, d[i * 4 + 1]!, d[i * 4 + 2]!) - Math.min(d[i * 4]!, d[i * 4 + 1]!, d[i * 4 + 2]!) <= 5;
// the two tones, read from the border
const hist = new Map<number, number>();
for (let x = 0; x < w; x++)
  for (const y of [0, 1, h - 2, h - 1]) {
    const i = y * w + x;
    if (flat(i)) hist.set(d[i * 4]!, (hist.get(d[i * 4]!) ?? 0) + 1);
  }
const top = [...hist.entries()].sort((a, b) => b[1] - a[1]);
const hi = top[0]![0];
const lo = top.find(([v]) => Math.abs(v - hi) >= 15)?.[0];
if (lo === undefined || hi < 200 || lo < 180) throw new Error(`${file}: no light two-tone checkerboard on the border`);
const [light, dark] = hi > lo ? [hi, lo] : [lo, hi];
const tone = (i: number): 0 | 1 | 2 => {
  if (!flat(i)) return 0;
  const v = d[i * 4]!;
  return Math.abs(v - light) <= 4 ? 1 : Math.abs(v - dark) <= 11 ? 2 : 0;
};
const bg = new Uint8Array(n);
const stack: number[] = [];
const push = (i: number) => {
  if (!bg[i] && tone(i)) {
    bg[i] = 1;
    stack.push(i);
  }
};
for (let x = 0; x < w; x++) {
  push(x);
  push((h - 1) * w + x);
}
for (let y = 0; y < h; y++) {
  push(y * w);
  push(y * w + w - 1);
}
while (stack.length) {
  const p = stack.pop()!;
  const x = p % w;
  if (x > 0) push(p - 1);
  if (x < w - 1) push(p + 1);
  if (p >= w) push(p - w);
  if (p < n - w) push(p + w);
}
// enclosed patches: both tones present
const seen = new Uint8Array(n);
let holes = 0;
for (let s = 0; s < n; s++) {
  if (seen[s] || bg[s] || !tone(s)) continue;
  const comp: number[] = [s];
  seen[s] = 1;
  let a = 0;
  let z = 0;
  for (let k = 0; k < comp.length; k++) {
    const p = comp[k]!;
    if (tone(p) === 1) a++;
    else z++;
    const x = p % w;
    for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p >= w ? p - w : -1, p < n - w ? p + w : -1])
      if (q >= 0 && !seen[q] && !bg[q] && tone(q)) {
        seen[q] = 1;
        comp.push(q);
      }
  }
  if (comp.length >= 400 && a / comp.length >= 0.12 && z / comp.length >= 0.12) {
    for (const p of comp) bg[p] = 1;
    holes += comp.length;
  }
}
// Leftovers: the thin lines between the squares (a blend of the two tones) and squares a shade off. First thin
// colourless light pixels with background nearly all round them (a line has it on both sides, the rim of a snow cap
// on one side only); then whole colourless light patches that touch nothing coloured.
const pale = (i: number) =>
  d[i * 4]! >= dark - 14 &&
  Math.max(d[i * 4]!, d[i * 4 + 1]!, d[i * 4 + 2]!) - Math.min(d[i * 4]!, d[i * 4 + 1]!, d[i * 4 + 2]!) <= 10;
const R = 4;
for (let pass = 0; pass < 3; pass++) {
  const sum = new Int32Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      sum[(y + 1) * (w + 1) + x + 1] =
        bg[y * w + x]! + sum[y * (w + 1) + x + 1]! + sum[(y + 1) * (w + 1) + x]! - sum[y * (w + 1) + x]!;
  const add: number[] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (bg[i] || !pale(i)) continue;
      const x0 = Math.max(0, x - R);
      const y0 = Math.max(0, y - R);
      const x1 = Math.min(w, x + R + 1);
      const y1 = Math.min(h, y + R + 1);
      const got = sum[y1 * (w + 1) + x1]! - sum[y0 * (w + 1) + x1]! - sum[y1 * (w + 1) + x0]! + sum[y0 * (w + 1) + x0]!;
      if (got / ((x1 - x0) * (y1 - y0)) >= 0.62) add.push(i);
    }
  for (const i of add) bg[i] = 1;
  if (!add.length) break;
}
const seen2 = new Uint8Array(n);
for (let s = 0; s < n; s++) {
  if (seen2[s] || bg[s] || !pale(s)) continue;
  const comp: number[] = [s];
  seen2[s] = 1;
  let coloured = false;
  for (let k = 0; k < comp.length; k++) {
    const p = comp[k]!;
    const x = p % w;
    for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p >= w ? p - w : -1, p < n - w ? p + w : -1]) {
      if (q < 0 || bg[q]) continue;
      if (!pale(q)) coloured = true;
      else if (!seen2[q]) {
        seen2[q] = 1;
        comp.push(q);
      }
    }
  }
  if (!coloured) for (const p of comp) bg[p] = 1;
}
// Squares stuck to the outline: a patch of one even tone, no bigger than a square of the board, and open to the
// cleared background on a good part of its edge (an even highlight inside a snow cap is not).
const cell = 30;
const even = (p: number, q: number) => !bg[q] && flat(q) && Math.abs(d[p * 4]! - d[q * 4]!) <= 2;
function squares(): void {
  const seen3 = new Uint8Array(n);
  for (let s = 0; s < n; s++) {
    if (seen3[s] || bg[s] || !flat(s) || d[s * 4]! < dark - 14) continue;
    const comp: number[] = [s];
    seen3[s] = 1;
    let x0 = w;
    let x1 = 0;
    let y0 = h;
    let y1 = 0;
    let open = 0;
    for (let k = 0; k < comp.length; k++) {
      const p = comp[k]!;
      const x = p % w;
      const y = (p - x) / w;
      if ((x > 0 && bg[p - 1]) || (x < w - 1 && bg[p + 1]) || (p >= w && bg[p - w]) || (p < n - w && bg[p + w])) open++;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p >= w ? p - w : -1, p < n - w ? p + w : -1])
        if (q >= 0 && !seen3[q] && even(p, q)) {
          seen3[q] = 1;
          comp.push(q);
        }
    }
    if (comp.length >= 30 && x1 - x0 < cell && y1 - y0 < cell && open >= 12) for (const p of comp) bg[p] = 1;
  }
}
/** The pale fringe the board left round the outline: one pixel of colourless light rim per pass. */
function peel(passes: number): void {
  for (let pass = 0; pass < passes; pass++) {
    const rim: number[] = [];
    for (let i = 0; i < n; i++) {
      if (bg[i] || !pale(i)) continue;
      const x = i % w;
      if ((x > 0 && bg[i - 1]) || (x < w - 1 && bg[i + 1]) || (i >= w && bg[i - w]) || (i < n - w && bg[i + w]))
        rim.push(i);
    }
    for (const i of rim) bg[i] = 1;
  }
}
peel(2);
squares();
peel(2);
let cleared = 0;
for (let i = 0; i < n; i++)
  if (bg[i]) {
    d[i * 4 + 3] = 0;
    cleared++;
  }
if (out === file) {
  const keep = file.replace(/\.png$/, '-checker.png');
  if (!existsSync(keep)) copyFileSync(file, keep);
}
await sharp(d, { raw: { width: w, height: h, channels: 4 } })
  .png()
  .toFile(out);
console.log(
  `${file}: tones ${light} and ${dark}; cleared ${((cleared / n) * 100).toFixed(1)}% (${holes} px in enclosed gaps) -> ${out}`,
);
