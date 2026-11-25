// Shared raw-image helpers for the art pipeline: RGBA images as plain typed arrays, with sharp for file IO and resizing.
import sharp from 'sharp';

export interface Img {
  w: number;
  h: number;
  /** RGBA, 4 bytes per pixel, row-major */
  d: Uint8Array;
}
export interface Box {
  x0: number;
  y0: number;
  /** exclusive */
  x1: number;
  y1: number;
}

export const blank = (w: number, h: number): Img => ({ w, h, d: new Uint8Array(w * h * 4) });

export async function load(file: string): Promise<Img> {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { w: info.width, h: info.height, d: new Uint8Array(data.buffer, data.byteOffset, data.length) };
}

export const toSharp = (img: Img) =>
  sharp(Buffer.from(img.d.buffer, img.d.byteOffset, img.d.length), {
    raw: { width: img.w, height: img.h, channels: 4 },
  });

export async function savePng(img: Img, file: string): Promise<void> {
  await toSharp(img).png({ compressionLevel: 9 }).toFile(file);
}

/** Resize with premultiplied alpha (sharp handles that), Lanczos. */
export async function resize(img: Img, w: number, h: number): Promise<Img> {
  w = Math.max(1, Math.round(w));
  h = Math.max(1, Math.round(h));
  if (w === img.w && h === img.h) return img;
  const { data } = await toSharp(img)
    .resize(w, h, { fit: 'fill', kernel: 'lanczos3' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { w, h, d: new Uint8Array(data.buffer, data.byteOffset, data.length) };
}

export function crop(img: Img, b: Box): Img {
  const out = blank(b.x1 - b.x0, b.y1 - b.y0);
  for (let y = b.y0; y < b.y1; y++) {
    if (y < 0 || y >= img.h) continue;
    for (let x = b.x0; x < b.x1; x++) {
      if (x < 0 || x >= img.w) continue;
      const s = (y * img.w + x) * 4;
      const t = ((y - b.y0) * out.w + (x - b.x0)) * 4;
      out.d[t] = img.d[s]!;
      out.d[t + 1] = img.d[s + 1]!;
      out.d[t + 2] = img.d[s + 2]!;
      out.d[t + 3] = img.d[s + 3]!;
    }
  }
  return out;
}

/** Source-over composite of `src` onto `dst` at (ox, oy). */
export function over(dst: Img, src: Img, ox: number, oy: number): void {
  for (let y = 0; y < src.h; y++) {
    const ty = y + oy;
    if (ty < 0 || ty >= dst.h) continue;
    for (let x = 0; x < src.w; x++) {
      const tx = x + ox;
      if (tx < 0 || tx >= dst.w) continue;
      const s = (y * src.w + x) * 4;
      const sa = src.d[s + 3]! / 255;
      if (sa === 0) continue;
      const t = (ty * dst.w + tx) * 4;
      const da = dst.d[t + 3]! / 255;
      const oa = sa + da * (1 - sa);
      for (let k = 0; k < 3; k++) dst.d[t + k] = Math.round((src.d[s + k]! * sa + dst.d[t + k]! * da * (1 - sa)) / oa);
      dst.d[t + 3] = Math.round(oa * 255);
    }
  }
}

/** Bounding box of pixels with alpha above `min`; null when empty. */
export function alphaBox(img: Img, min = 0): Box | null {
  let x0 = img.w;
  let y0 = img.h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++)
      if (img.d[(y * img.w + x) * 4 + 3]! > min) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

export interface Blob {
  label: number;
  area: number;
  box: Box;
  cx: number;
  cy: number;
}

/** 8-connected components of `mask` (non-zero = set). Returns the label map (0 = none) and the blobs. */
export function components(mask: Uint8Array, w: number, h: number): { labels: Int32Array; blobs: Blob[] } {
  const labels = new Int32Array(w * h);
  const blobs: Blob[] = [];
  const stack = new Int32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || labels[i]) continue;
    const label = blobs.length + 1;
    let sp = 0;
    stack[sp++] = i;
    labels[i] = label;
    let area = 0;
    let sx = 0;
    let sy = 0;
    const box: Box = { x0: w, y0: h, x1: 0, y1: 0 };
    while (sp > 0) {
      const p = stack[--sp]!;
      const x = p % w;
      const y = (p - x) / w;
      area++;
      sx += x;
      sy += y;
      if (x < box.x0) box.x0 = x;
      if (y < box.y0) box.y0 = y;
      if (x + 1 > box.x1) box.x1 = x + 1;
      if (y + 1 > box.y1) box.y1 = y + 1;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          const q = ny * w + nx;
          if (mask[q] && !labels[q]) {
            labels[q] = label;
            stack[sp++] = q;
          }
        }
      }
    }
    blobs.push({ label, area, box, cx: sx / area, cy: sy / area });
  }
  return { labels, blobs };
}

/**
 * Die-cut sticker outline: dilate the silhouette by `r` px with a soft edge, fill it white, draw the art over it.
 * The image must already carry `r + 1` px of clear margin.
 */
export function stickerOutline(img: Img, r = 5, rgb: [number, number, number] = [255, 255, 255]): Img {
  const { w, h, d } = img;
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && d[(y * w + x) * 4 + 3]! >= 96;
  const cover = new Float32Array(w * h);
  const R = Math.ceil(r + 1);
  const offs: [number, number, number][] = [];
  for (let dy = -R; dy <= R; dy++)
    for (let dx = -R; dx <= R; dx++) {
      const v = Math.min(1, Math.max(0, r + 0.5 - Math.hypot(dx, dy)));
      if (v > 0) offs.push([dx, dy, v]);
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!solid(x, y)) continue;
      cover[y * w + x] = 1;
      // only edge pixels stamp the disc
      if (solid(x - 1, y) && solid(x + 1, y) && solid(x, y - 1) && solid(x, y + 1)) continue;
      for (const [dx, dy, v] of offs) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const q = ny * w + nx;
        if (cover[q]! < v) cover[q] = v;
      }
    }
  const out = blank(w, h);
  for (let i = 0; i < w * h; i++) {
    const a = Math.round(cover[i]! * 255);
    if (!a) continue;
    out.d[i * 4] = rgb[0];
    out.d[i * 4 + 1] = rgb[1];
    out.d[i * 4 + 2] = rgb[2];
    out.d[i * 4 + 3] = a;
  }
  over(out, img, 0, 0);
  return out;
}

export const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return Number.NaN;
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** A small text label as an SVG overlay buffer. */
export function labelSvg(text: string, w: number, h: number, bg = '#22252e', fg = '#ffffff'): Buffer {
  const t = text.replace(/[<&>]/g, '');
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="${bg}"/><text x="6" y="${Math.round(h * 0.72)}" font-family="Helvetica" font-size="${Math.round(h * 0.62)}" fill="${fg}">${t}</text></svg>`,
  );
}
