// Ground baker helpers: deterministic hashing, periodic noise and the procedural stand-in textures.
// Every texture is a seamless TS x TS RGB square; the baker tiles it in world space.

export const TS = 512;
export type RGB = [number, number, number];

/** Integer hash to [0, 1). */
export function hash(x: number, y: number, s: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  h = Math.imul(h ^ (h >>> 16), 2246822519);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

export function smoothstep(a: number, b: number, x: number): number {
  const t = x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a);
  return t * t * (3 - 2 * t);
}

/** Periodic value noise: cx by cy lattice cells across a size x size square, wrapping at the edges. */
export function valueNoise(size: number, cx: number, cy: number, seed: number): Float32Array {
  const lat = new Float32Array(cx * cy);
  for (let i = 0; i < lat.length; i++) lat[i] = hash(i % cx, (i / cx) | 0, seed);
  const out = new Float32Array(size * size);
  const ix0 = new Int32Array(size);
  const ix1 = new Int32Array(size);
  const tx = new Float32Array(size);
  for (let x = 0; x < size; x++) {
    const f = (x * cx) / size;
    const i = Math.floor(f);
    const t = f - i;
    ix0[x] = i % cx;
    ix1[x] = (i + 1) % cx;
    tx[x] = t * t * (3 - 2 * t);
  }
  for (let y = 0; y < size; y++) {
    const f = (y * cy) / size;
    const j = Math.floor(f);
    let ty = f - j;
    ty = ty * ty * (3 - 2 * ty);
    const r0 = (j % cy) * cx;
    const r1 = ((j + 1) % cy) * cx;
    for (let x = 0; x < size; x++) {
      const a = lat[r0 + ix0[x]!]!;
      const b = lat[r0 + ix1[x]!]!;
      const c = lat[r1 + ix0[x]!]!;
      const d = lat[r1 + ix1[x]!]!;
      const t = tx[x]!;
      const top = a + (b - a) * t;
      out[y * size + x] = top + (c + (d - c) * t - top) * ty;
    }
  }
  return out;
}

/** Fractal value noise, stretched to fill [0, 1]. */
export function fbm(size: number, cells: number, octaves: number, seed: number, ay = 1): Float32Array {
  const out = new Float32Array(size * size);
  let amp = 1;
  for (let o = 0; o < octaves; o++) {
    const c = cells << o;
    const n = valueNoise(size, c, Math.max(1, Math.round(c * ay)), seed + o * 101);
    for (let i = 0; i < out.length; i++) out[i]! += n[i]! * amp;
    amp *= 0.5;
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < out.length; i++) {
    const v = out[i]!;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const k = hi > lo ? 1 / (hi - lo) : 0;
  for (let i = 0; i < out.length; i++) out[i] = (out[i]! - lo) * k;
  return out;
}

/** Periodic Voronoi cells: distance to the nearest and second nearest point, and a random tone per cell. */
export function voronoi(
  size: number,
  cells: number,
  seed: number,
): { f1: Float32Array; f2: Float32Array; id: Float32Array } {
  const cs = size / cells;
  const px = new Float32Array(cells * cells);
  const py = new Float32Array(cells * cells);
  const tone = new Float32Array(cells * cells);
  for (let j = 0; j < cells; j++)
    for (let i = 0; i < cells; i++) {
      const k = j * cells + i;
      px[k] = (i + 0.15 + 0.7 * hash(i, j, seed)) * cs;
      py[k] = (j + 0.15 + 0.7 * hash(i, j, seed + 1)) * cs;
      tone[k] = hash(i, j, seed + 2);
    }
  const f1 = new Float32Array(size * size);
  const f2 = new Float32Array(size * size);
  const id = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const cj = Math.floor(y / cs);
    for (let x = 0; x < size; x++) {
      const ci = Math.floor(x / cs);
      let d1 = 1e9;
      let d2 = 1e9;
      let best = 0;
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          const i = ci + di;
          const j = cj + dj;
          const wi = (i + cells) % cells;
          const wj = (j + cells) % cells;
          const k = wj * cells + wi;
          const qx = px[k]! + (i - wi) * cs;
          const qy = py[k]! + (j - wj) * cs;
          const d = Math.hypot(x + 0.5 - qx, y + 0.5 - qy);
          if (d < d1) {
            d2 = d1;
            d1 = d;
            best = k;
          } else if (d < d2) d2 = d;
        }
      const o = y * size + x;
      f1[o] = d1;
      f2[o] = d2;
      id[o] = tone[best]!;
    }
  }
  return { f1, f2, id };
}

const mix = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
const ramp = (lo: RGB, mid: RGB, hi: RGB, v: number): RGB =>
  v < 0.5 ? mix(lo, mid, v * 2) : mix(mid, hi, (v - 0.5) * 2);
const scale = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];

function paint(fn: (i: number, x: number, y: number) => RGB): Uint8Array {
  const out = new Uint8Array(TS * TS * 3);
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const i = y * TS + x;
      const c = fn(i, x, y);
      out[i * 3] = Math.max(0, Math.min(255, Math.round(c[0])));
      out[i * 3 + 1] = Math.max(0, Math.min(255, Math.round(c[1])));
      out[i * 3 + 2] = Math.max(0, Math.min(255, Math.round(c[2])));
    }
  return out;
}

function grassy(seed: number, lo: RGB, mid: RGB, hi: RGB, blade: RGB): Uint8Array {
  const n1 = fbm(TS, 4, 3, seed);
  const n2 = fbm(TS, 16, 3, seed + 10);
  const st = fbm(TS, 32, 2, seed + 30, 0.25);
  const n3 = valueNoise(TS, 128, 128, seed + 20);
  return paint((i) => {
    const v = 0.5 * n1[i]! + 0.32 * n2[i]! + 0.18 * st[i]!;
    let c = ramp(lo, mid, hi, v);
    const f = n3[i]!;
    if (f > 0.78) c = mix(c, blade, Math.min(1, (f - 0.78) * 3));
    return c;
  });
}

function planks(seed: number, base: RGB, gap: RGB, along: number, across: number, vertical: boolean): Uint8Array {
  const grain = vertical ? fbm(TS, 64, 2, seed, 1 / 16) : fbm(TS, 4, 2, seed, 16);
  const n1 = fbm(TS, 4, 2, seed + 5);
  return paint((i, x, y) => {
    const u = vertical ? y : x;
    const v = vertical ? x : y;
    const row = Math.floor(v / across);
    const lv = v % across;
    const off = Math.floor(hash(row, 0, seed) * TS);
    const uu = (u + off) % TS;
    const seg = Math.floor(uu / along);
    const tone = 0.86 + 0.24 * hash(row, seg, seed + 1);
    let c = scale(base, tone * (0.88 + 0.22 * grain[i]!) * (0.94 + 0.12 * n1[i]!));
    if (lv < 2 || uu % along < 2) c = gap;
    else if (lv < 4) c = scale(c, 1.1);
    else if (lv > across - 3) c = scale(c, 0.88);
    return c;
  });
}

function cells(seed: number, n: number, lo: RGB, hi: RGB, mortar: RGB, mortarW: number, round: number): Uint8Array {
  const vo = voronoi(TS, n, seed);
  const n2 = fbm(TS, 16, 3, seed + 3);
  const r = TS / n / 1.6;
  return paint((i) => {
    const f1 = vo.f1[i]!;
    const edge = vo.f2[i]! - f1;
    if (edge < mortarW) return mortar;
    let c = mix(lo, hi, 0.65 * vo.id[i]! + 0.35 * n2[i]!);
    const q = Math.min(1, f1 / r);
    c = scale(c, 1 - round * q * q);
    if (edge < mortarW + 2) c = mix(c, mortar, 0.45);
    return c;
  });
}

function snow(seed: number, shadow: RGB): Uint8Array {
  const n1 = fbm(TS, 4, 3, seed);
  const n2 = fbm(TS, 16, 2, seed + 7);
  const n3 = valueNoise(TS, 128, 128, seed + 9);
  return paint((i) => {
    const v = 0.62 * n1[i]! + 0.38 * n2[i]!;
    let c = ramp(shadow, [230, 238, 248], [249, 251, 255], v);
    if (n3[i]! > 0.9) c = mix(c, [255, 255, 255], 0.7);
    return c;
  });
}

/** A procedural stand-in for one terrain (by TERRAIN name), or null when it has no texture (water). */
export function standIn(name: string): Uint8Array | null {
  switch (name) {
    case 'grass':
      return grassy(11, [66, 132, 60], [98, 168, 74], [142, 196, 92], [166, 214, 112]);
    case 'blockgrass':
      return grassy(12, [84, 168, 58], [112, 196, 72], [150, 220, 96], [176, 232, 116]);
    case 'darkgrass':
      return grassy(13, [32, 82, 44], [46, 106, 54], [70, 132, 66], [92, 150, 80]);
    case 'hedge': {
      const vo = voronoi(TS, 32, 14);
      const n2 = fbm(TS, 16, 2, 15);
      return paint((i) => {
        const v = 0.6 * vo.id[i]! + 0.4 * n2[i]!;
        const q = Math.min(1, vo.f1[i]! / 11);
        return scale(ramp([26, 66, 36], [42, 94, 50], [70, 128, 66], v), 1.12 - 0.55 * q * q);
      });
    }
    case 'path': {
      const n1 = fbm(TS, 4, 3, 21);
      const n2 = fbm(TS, 16, 3, 22);
      const vo = voronoi(TS, 32, 23);
      return paint((i) => {
        const c = ramp([178, 140, 96], [208, 172, 120], [228, 198, 148], 0.55 * n1[i]! + 0.45 * n2[i]!);
        const f = vo.f1[i]!;
        if (vo.id[i]! > 0.55 && f < 3.2) return f < 1.4 ? mix(c, [236, 220, 190], 0.6) : mix(c, [150, 120, 88], 0.75);
        return c;
      });
    }
    case 'cobble':
      return cells(31, 16, [128, 128, 136], [170, 170, 176], [86, 84, 92], 2.2, 0.32);
    case 'sand': {
      const n1 = fbm(TS, 4, 3, 41);
      const n2 = fbm(TS, 32, 2, 42, 0.35);
      const n3 = valueNoise(TS, 128, 128, 43);
      return paint((i) => {
        let c = ramp([216, 194, 134], [236, 216, 156], [248, 234, 188], 0.6 * n1[i]! + 0.4 * n2[i]!);
        if (n3[i]! > 0.86) c = mix(c, [196, 172, 118], 0.45);
        return c;
      });
    }
    case 'mud': {
      const n1 = fbm(TS, 4, 3, 51);
      const n2 = fbm(TS, 16, 3, 52);
      const wet = fbm(TS, 8, 2, 53);
      return paint((i) => {
        let c = ramp([96, 66, 42], [124, 88, 58], [148, 110, 74], 0.6 * n1[i]! + 0.4 * n2[i]!);
        const w = wet[i]!;
        c = mix(c, [82, 58, 42], smoothstep(0.6, 0.75, w) * 0.8);
        c = mix(c, [120, 104, 96], smoothstep(0.82, 0.95, w) * 0.35);
        return c;
      });
    }
    case 'floor':
      return planks(61, [176, 122, 74], [96, 60, 34], 128, 32, false);
    case 'bridge':
      return planks(62, [172, 128, 84], [88, 58, 34], 256, 16, true);
    case 'stone':
      return cells(71, 8, [134, 140, 154], [164, 170, 184], [102, 108, 122], 1.6, 0.12);
    case 'ash': {
      const n1 = fbm(TS, 4, 3, 81);
      const n2 = fbm(TS, 16, 3, 82);
      const n3 = valueNoise(TS, 128, 128, 83);
      return paint((i) => {
        let c = ramp([110, 118, 102], [138, 146, 126], [162, 168, 150], 0.55 * n1[i]! + 0.45 * n2[i]!);
        if (n3[i]! > 0.84) c = mix(c, [78, 82, 74], 0.6);
        return c;
      });
    }
    case 'steps': {
      const n1 = fbm(TS, 8, 3, 91);
      return paint((i) => ramp([116, 116, 124], [148, 148, 154], [176, 176, 182], n1[i]!));
    }
    case 'soil': {
      const n2 = fbm(TS, 16, 3, 101);
      return paint((i, _x, y) => {
        const f = 0.5 + 0.5 * Math.cos((2 * Math.PI * (y % 16)) / 16);
        return scale(mix([66, 44, 30], [112, 78, 52], f), 0.88 + 0.24 * n2[i]!);
      });
    }
    case 'cliff':
      return cells(111, 8, [74, 70, 86], [104, 98, 114], [40, 36, 48], 1.8, 0.3);
    case 'rock':
      return cells(121, 12, [88, 84, 94], [120, 114, 124], [46, 42, 52], 1.6, 0.3);
    case 'void':
      return paint(() => [20, 20, 28]);
    default:
      return null;
  }
}

/** The snow version of a terrain texture, or null when the terrain is unchanged in snow. */
export function snowify(name: string, base: Uint8Array): Uint8Array | null {
  switch (name) {
    case 'grass':
      return snow(201, [198, 212, 234]);
    case 'blockgrass':
      return snow(202, [204, 218, 238]);
    case 'darkgrass':
      return snow(203, [186, 202, 230]);
    case 'path':
    case 'cobble': {
      const n = fbm(TS, 16, 3, name === 'path' ? 211 : 212);
      const sn = snow(213, [206, 218, 236]);
      return paint((i) => {
        // package 48: the bare ground under the snow is cold and muted, and the snow lies over it in soft drifts
        const t = smoothstep(0.3, 0.68, n[i]!) * 0.85;
        const k = i * 3;
        const bare = mix([base[k]!, base[k + 1]!, base[k + 2]!], [172, 168, 166], 0.45);
        return mix(bare, [sn[k]!, sn[k + 1]!, sn[k + 2]!], t);
      });
    }
    case 'sand':
      return paint((i) => {
        const k = i * 3;
        return mix([base[k]!, base[k + 1]!, base[k + 2]!], [246, 244, 238], 0.45);
      });
    default:
      return null;
  }
}

// ---------------------------------------------------------------- the painted look (phase 2, part G)

/** A seeded generator in [0, 1): the same seed paints the same ground every time. */
export function seeded(seed: number): () => number {
  let v = seed >>> 0;
  return () => {
    v = (Math.imul(v, 1664525) + 1013904223) >>> 0;
    return v / 4294967296;
  };
}

/** Rotate the hue of a colour by deg degrees and scale its saturation (HSV). */
export function hueShift(r: number, g: number, b: number, deg: number, sat: number): RGB {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const d = mx - mn;
  let h = 0;
  if (d > 0) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  h = (((h + deg) % 360) + 360) % 360;
  const s = mx > 0 ? Math.min(1, (d / mx) * sat) : 0;
  const c = mx * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = mx - c;
  const [a, bb, cc] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  return [a + m, bb + m, cc + m];
}

/**
 * Repaint an RGB texture in a new colour while keeping its brushwork: each pixel's brightness relative to the mean
 * (stretched by contrast) scales the target colour. keep (0 to 1) holds back some of the original colour.
 */
export function regrade(px: Uint8Array, target: RGB, contrast: number, keep = 0): Uint8Array {
  const n = px.length / 3;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += px[i * 3]! * 0.3 + px[i * 3 + 1]! * 0.59 + px[i * 3 + 2]! * 0.11;
  mean /= n;
  const out = new Uint8Array(px.length);
  for (let i = 0; i < n; i++) {
    const o = i * 3;
    const l = px[o]! * 0.3 + px[o + 1]! * 0.59 + px[o + 2]! * 0.11;
    const k = 1 + (l / mean - 1) * contrast;
    for (let c = 0; c < 3; c++) {
      const v = target[c]! * k * (1 - keep) + px[o + c]! * keep;
      out[o + c] = Math.max(0, Math.min(255, Math.round(v)));
    }
  }
  return out;
}

/**
 * Wrap-blend so a square texture tiles. One axis at a time: near the left and right edges the picture fades into a copy
 * shifted half a repeat sideways (whose own seam sits in the middle, where the original is kept), then the same top
 * and bottom. Package 52: the old single pass left a seam crossing at the middle of each edge.
 */
export function seamless(px: Uint8Array, n: number, ch: number): Uint8Array {
  const band = n / 4;
  const wgt = (e: number) => {
    const t = Math.min(1, e / band);
    return t * t * (3 - 2 * t);
  };
  const a = new Uint8Array(px.length);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const w = wgt(Math.min(x, n - 1 - x));
      const s = (y * n + ((x + n / 2) % n)) * ch;
      const o = (y * n + x) * ch;
      for (let c = 0; c < ch; c++) a[o + c] = Math.round(px[o + c]! * w + px[s + c]! * (1 - w));
    }
  const out = new Uint8Array(px.length);
  for (let y = 0; y < n; y++) {
    const w = wgt(Math.min(y, n - 1 - y));
    for (let x = 0; x < n; x++) {
      const s = (((y + n / 2) % n) * n + x) * ch;
      const o = (y * n + x) * ch;
      for (let c = 0; c < ch; c++) out[o + c] = Math.round(a[o + c]! * w + a[s + c]! * (1 - w));
    }
  }
  return out;
}
