// Art processing: slice generated sprite sheets into aligned, outlined animation frames, plus QA strips and a motion check.
//   node tools/art/process.ts chars [--only id,id]   every cast entry with masters -> art/src/chars/<id>/, art/qa/strips/<id>.png
//   node tools/art/process.ts chars --test           spike sheets as scratch characters -> $TMPDIR/art-test, art/qa/strips/_test-*.png
//   node tools/art/process.ts sheets <list.json>     icons and world objects (see SheetJob)
//   node tools/art/process.ts motion [--only id,id]  re-run the motion check on art/src/chars -> art/qa/motion.json
//   node tools/art/process.ts faces [--only id,id]   face stickers (head and shoulders of idle_down_0) for every
//                                                    character, mob and animal in the game data -> art/src/ui/face_<id>.png
//                                                    (chars mode makes them too, after slicing)
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import sharp, { type OverlayOptions } from 'sharp';
import { type CastArt, cast } from './cast.ts';
import {
  alphaBox,
  type Blob,
  type Box,
  blank,
  components,
  crop,
  type Img,
  labelSvg,
  load,
  median,
  over,
  resize,
  savePng,
  stickerOutline,
  toSharp,
} from './imgutil.ts';
import { markFrame, mannerTiming } from './manner.ts';
import { type Cell, type Facing, fineSheetsFor, sheetsFor } from './sheets.ts';

const ROOT = new URL('../../', import.meta.url).pathname;
// a worktree has no masters of its own (art/masters is never committed): WS_ART_MASTERS points at the main checkout's
const MASTERS = process.env.WS_ART_MASTERS ?? join(ROOT, 'art/masters/chars');
const SRC = join(ROOT, 'art/src/chars');
const STRIPS = join(ROOT, 'art/qa/strips');
const MOTION = join(ROOT, 'art/qa/motion.json');

/** Alpha below this (about 40 percent) is glow or halo and is cleared. */
const ALPHA_CUT = 102;
/** Opaque specks smaller than this many pixels are dropped. */
const SPECK = 30;
/** Sticker outline width in px at the stored size: icons, objects and the face stickers used in menus. */
const OUTLINE = 5;
/**
 * World frames (characters, mobs, animals) carry no white ring (phase 2, part G): they stand in a painted world, not
 * on a sticker sheet. 0 means no edge at all; a positive width draws a thin edge in WORLD_EDGE_RGB instead.
 */
const WORLD_OUTLINE = 0;
const WORLD_EDGE_RGB: [number, number, number] = [40, 32, 30];
/**
 * Frames are stored at this many screen px per world px (the game scales each frame by tall x 64 / px, so this only
 * sets sharpness and texture memory). 1.3 covers the phase 2 camera zoom of 1.2 to 1.3 at about one texel a pixel.
 */
export const FRAME_SCALE = 1.3;
/**
 * Walk clips: smallest share of the lower third (feet and legs) whose coarse silhouette (4 px blocks) must change
 * between successive frames. Calibrated on the spike sheets: good walks measure 0.17 to 0.69 (front and back
 * walks are the lowest), while the same legs redrawn (idle and talk pairs) measure 0 to 0.07.
 */
export const WALK_THRESHOLD = 0.1;
const BLOCK = 4;
/** Every other animated clip: smallest share of opaque pixels that must change between successive frames. */
export const POSE_THRESHOLD = 0.01;

// ---------------------------------------------------------------- slicing

export interface Slice {
  img: Img;
  /** the cell's union box in sheet pixels */
  box: Box;
}

/** True when no pixel is meaningfully transparent. */
function allOpaque(img: Img): boolean {
  for (let i = 3; i < img.d.length; i += 4) if (img.d[i]! < 250) return false;
  return true;
}

/**
 * Key out a fake background on an image with no real alpha: flood from the border over near-uniform colour,
 * or over a light checkerboard (low saturation, light), which also clears enclosed checkerboard holes.
 */
export function keyBackground(img: Img, file: string, figure = false): void {
  const { w, h, d } = img;
  const n = w * h;
  const border: number[] = [];
  for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) border.push(y * w, y * w + w - 1);
  const lum = (i: number) => (d[i * 4]! * 0.299 + d[i * 4 + 1]! * 0.587 + d[i * 4 + 2]! * 0.114) | 0;
  const sat = (i: number) =>
    Math.max(d[i * 4]!, d[i * 4 + 1]!, d[i * 4 + 2]!) - Math.min(d[i * 4]!, d[i * 4 + 1]!, d[i * 4 + 2]!);
  const lightGrey = (i: number) => sat(i) <= 24 && lum(i) >= 180;
  const lightShare = border.filter(lightGrey).length / border.length;
  const lums = border.filter(lightGrey).map(lum);
  const spread = lums.length ? Math.max(...lums) - Math.min(...lums) : 0;
  // A character sheet's checkerboard must show a real second tone (at least a fifth of the border 15 or more levels
  // darker than the lightest): a flat white border with a little noise is a flat background, and treating it as a
  // checkerboard cleared every white area enclosed by an outline (faces, gloves, socks, teeth).
  const lightest = lums.length ? Math.max(...lums) : 0;
  const secondTone = lums.filter((l) => l <= lightest - 15).length / border.length;
  const checker = lightShare > 0.85 && spread >= 10 && (!figure || secondTone >= 0.2);
  const ref = [0, 1, 2].map((k) => median(border.map((i) => d[i * 4 + k]!)));
  const near = (i: number) =>
    Math.abs(d[i * 4]! - ref[0]!) + Math.abs(d[i * 4 + 1]! - ref[1]!) + Math.abs(d[i * 4 + 2]! - ref[2]!) <= 48;
  const isBg = checker ? lightGrey : near;
  const bg = new Uint8Array(n);
  const stack: number[] = [];
  for (const i of border)
    if (!bg[i] && isBg(i)) {
      bg[i] = 1;
      stack.push(i);
    }
  while (stack.length) {
    const p = stack.pop()!;
    const x = p % w;
    const y = (p - x) / w;
    for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1])
      if (q >= 0 && !bg[q] && isBg(q)) {
        bg[q] = 1;
        stack.push(q);
      }
  }
  let holes = 0;
  if (checker) {
    // enclosed holes showing the checkerboard: two-tone ones (gaps between bench slats and the like), and small
    // ones of pure neutral light grey (a single square showing through between branches)
    const rest = new Uint8Array(n);
    for (let i = 0; i < n; i++) rest[i] = !bg[i] && lightGrey(i) ? 1 : 0;
    const { labels, blobs } = components(rest, w, h);
    const hi = lums.length ? median(lums) : 240;
    const keep = new Set<number>();
    const counts = new Map<number, [number, number, number, number]>();
    for (let i = 0; i < n; i++) {
      const l = labels[i]!;
      if (!l) continue;
      const c = counts.get(l) ?? [0, 0, 0, 0];
      c[lum(i) >= hi - 4 ? 0 : 1]++;
      if (sat(i) <= 8 && lum(i) >= 236) c[2]++;
      if (sat(i) > 12) c[3]++;
      counts.set(l, c);
    }
    for (const b of blobs) {
      const [a, z, pure, tinted] = counts.get(b.label)!;
      const twoTone = b.area >= 300 && a / b.area >= 0.15 && z / b.area >= 0.15;
      // a lone white square seen between branches; on a character it is white paint (eyes, teeth, socks), so kept
      const plain = !figure && b.area >= 20 && pure / b.area >= 0.5 && tinted / b.area < 0.1;
      if (twoTone || plain) keep.add(b.label);
    }
    for (let i = 0; i < n; i++)
      if (keep.has(labels[i]!)) {
        bg[i] = 1;
        holes++;
      }
  }
  let cleared = 0;
  for (let i = 0; i < n; i++)
    if (bg[i]) {
      d[i * 4 + 3] = 0;
      cleared++;
    }
  console.warn(
    `warning: ${basename(file)} has no real transparency; keyed out a ${checker ? 'light checkerboard' : 'flat'} background (${((cleared / n) * 100).toFixed(1)}% of pixels${holes ? `, ${holes} in enclosed holes` : ''})`,
  );
}

/** A border whose median alpha is at least this is a translucent haze painted behind the art, not real transparency. */
const HAZE_BORDER = 32;
/** On a hazy sheet, alpha below this is haze (the art itself is drawn solid, about 250 and up). */
const HAZE_SOLID = 245;
/** Enclosed haze pockets (gaps between an arm and the body) at least this big are cleared too. */
const HAZE_POCKET = 64;

/**
 * Some sheets come back with a see-through white or grey haze for a background (alpha 60 to 230) instead of real
 * transparency. Clear every translucent pixel connected to the border, and enclosed translucent pockets.
 */
export function clearHaze(img: Img, file: string, figure = false): boolean {
  const { w, h, d } = img;
  const border: number[] = [];
  for (let x = 0; x < w; x++) border.push(d[x * 4 + 3]!, d[((h - 1) * w + x) * 4 + 3]!);
  for (let y = 0; y < h; y++) border.push(d[y * w * 4 + 3]!, d[(y * w + w - 1) * 4 + 3]!);
  // a character sheet may carry the haze along one edge only (a misty top band): any hazy side counts
  const a = (x: number, y: number) => d[(y * w + x) * 4 + 3]!;
  const sides = [
    median(Array.from({ length: w }, (_, x) => a(x, 0))),
    median(Array.from({ length: w }, (_, x) => a(x, h - 1))),
    median(Array.from({ length: h }, (_, y) => a(0, y))),
    median(Array.from({ length: h }, (_, y) => a(w - 1, y))),
  ];
  if (median(border) < HAZE_BORDER && !(figure && Math.max(...sides) >= HAZE_BORDER)) return false;
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) mask[i] = d[i * 4 + 3]! < HAZE_SOLID ? 1 : 0;
  const { labels, blobs } = components(mask, w, h);
  const drop = new Set(
    blobs
      .filter((b) => b.box.x0 === 0 || b.box.y0 === 0 || b.box.x1 === w || b.box.y1 === h || b.area >= HAZE_POCKET)
      .map((b) => b.label),
  );
  let cleared = 0;
  for (let i = 0; i < w * h; i++)
    if (drop.has(labels[i]!)) {
      d[i * 4 + 3] = 0;
      cleared++;
    }
  console.warn(
    `warning: ${basename(file)} has a translucent haze background; cleared it (${((cleared / (w * h)) * 100).toFixed(1)}% of pixels)`,
  );
  return true;
}

/** Clear glow and halo (low alpha) and drop specks. */
export function cleanAlpha(img: Img, figure = false): void {
  const { w, h, d } = img;
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (d[i * 4 + 3]! < ALPHA_CUT) d[i * 4 + 3] = 0;
    else mask[i] = 1;
  }
  const { labels, blobs } = components(mask, w, h);
  const small = new Set(blobs.filter((b) => b.area < SPECK).map((b) => b.label));
  // on a character sheet a blob with no solid pixel at all is a stray glow (figures are drawn solid)
  if (figure) {
    const solid = new Set<number>();
    for (let i = 0; i < w * h; i++) if (labels[i] && d[i * 4 + 3]! >= 230) solid.add(labels[i]!);
    for (const b of blobs) if (!solid.has(b.label)) small.add(b.label);
  }
  if (small.size) for (let i = 0; i < w * h; i++) if (small.has(labels[i]!)) d[i * 4 + 3] = 0;
}

/**
 * Slice a sheet into cols x rows cells (reading order). Each opaque blob goes to the cell holding its centre,
 * so a hand that pokes over a cell edge stays with its owner.
 */
export async function sliceSheet(file: string, cols: number, rows: number, figure = false): Promise<Slice[]> {
  const img = await load(file);
  if (allOpaque(img)) keyBackground(img, file, figure);
  else clearHaze(img, file, figure);
  cleanAlpha(img, figure);
  const { w, h, d } = img;
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) mask[i] = d[i * 4 + 3]! > 0 ? 1 : 0;
  const { labels, blobs } = components(mask, w, h);
  const cw = w / cols;
  const ch = h / rows;
  const owned: Blob[][] = Array.from({ length: cols * rows }, () => []);
  for (const b of blobs) {
    const col = Math.min(cols - 1, Math.floor(b.cx / cw));
    const row = Math.min(rows - 1, Math.floor(b.cy / ch));
    owned[row * cols + col]!.push(b);
  }
  return owned.map((bs, i) => {
    if (!bs.length)
      throw new Error(
        `${basename(file)}: cell ${i + 1} (row ${Math.floor(i / cols) + 1}, column ${(i % cols) + 1}) is empty`,
      );
    const box: Box = { x0: w, y0: h, x1: 0, y1: 0 };
    for (const b of bs) {
      box.x0 = Math.min(box.x0, b.box.x0);
      box.y0 = Math.min(box.y0, b.box.y0);
      box.x1 = Math.max(box.x1, b.box.x1);
      box.y1 = Math.max(box.y1, b.box.y1);
    }
    const mine = new Set(bs.map((b) => b.label));
    const out = crop(img, box);
    for (let y = box.y0; y < box.y1; y++)
      for (let x = box.x0; x < box.x1; x++)
        if (!mine.has(labels[y * w + x]!)) out.d[((y - box.y0) * out.w + (x - box.x0)) * 4 + 3] = 0;
    return { img: out, box };
  });
}

// ---------------------------------------------------------------- characters

export interface CharSheet {
  file: string;
  cols: number;
  rows: number;
  cells: Cell[];
}
export interface CharSpec {
  id: string;
  group: string;
  tall: number;
  /** clips played with another clip's frames, as { played: drawn } */
  alias?: Record<string, string>;
  /** drawn on the finer sheets of package 58: frames are registered to the idle pose and get timings */
  fine?: boolean;
}
export interface CharMeta extends CharSpec {
  w: number;
  h: number;
  footY: number;
  px: number;
  clips: Record<string, Partial<Record<Facing, string[]>>>;
  /** package 58: per clip, seconds each frame shows (a loop or a one-shot) and the frames a foot lands on */
  timing?: Record<string, ClipTiming>;
}
export interface ClipTiming {
  durs: number[];
  dursByFacing?: Partial<Record<Facing, number[]>>;
  step?: number[];
  stepByFacing?: Partial<Record<Facing, number[]>>;
}

/**
 * Timings for the finer clips (package 58). The walk keeps its half-second stride (two steps) with a short hold on each
 * contact frame, and the footstep fires on the contact frames. Clips not listed keep the game's own rate.
 */
export function fineTiming(clips: CharMeta['clips']): Record<string, ClipTiming> {
  const t: Record<string, ClipTiming> = {};
  const n = (clip: string) => Math.max(0, ...Object.values(clips[clip] ?? {}).map((f) => f?.length ?? 0));
  const spread = (weights: number[], total: number) => {
    const sum = weights.reduce((a, b) => a + b, 0);
    return weights.map((w) => Math.round((w / sum) * total * 1000) / 1000);
  };
  if (n('walk') === 8) t.walk = { durs: spread([1.3, 1, 0.9, 0.9, 1.3, 1, 0.9, 0.9], 0.56), step: [0, 4] };
  if (n('run') === 4) t.run = { durs: spread([1.1, 0.9, 1.1, 0.9], 0.4), step: [1, 3] };
  if (n('swing') === 4) t.swing = { durs: [0.09, 0.06, 0.06, 0.14] };
  if (n('hurt') === 3) t.hurt = { durs: [0.1, 0.14, 0.16] };
  if (n('cheer') === 6) t.cheer = { durs: spread([1.2, 1, 1, 1, 1, 1.4], 1.1) };
  if (n('cheer') === 3) t.cheer = { durs: [0.22, 0.12, 0.26] };
  if (n('sleep') === 4) t.sleep = { durs: [1.1, 0.9, 1.3, 0.9] };
  if (n('wave') === 3) t.wave = { durs: [0.16, 0.2, 0.2] };
  if (n('laugh') === 3) t.laugh = { durs: [0.15, 0.15, 0.2] };
  if (n('fish') === 3) t.fish = { durs: [0.6, 0.5, 0.3] };
  return t;
}

interface Frame {
  clip: string;
  facing: Facing;
  img: Img;
  /** px below (+) or above (-) the row's ground line */
  off: number;
  /** horizontal anchor: centre of the feet and legs */
  cx: number;
}

/** Centre of mass of the opaque pixels in the lower 40 percent of the figure; the box centre when there are none. */
function feetCentre(img: Img): number {
  let sx = 0;
  let n = 0;
  for (let y = Math.floor(img.h * 0.6); y < img.h; y++)
    for (let x = 0; x < img.w; x++)
      if (img.d[(y * img.w + x) * 4 + 3]! >= 128) {
        sx += x + 0.5;
        n++;
      }
  return n ? sx / n : img.w / 2;
}

/**
 * Package 58: line every frame up sideways with the first idle frame of its facing, by the best overlap of the head
 * and body (the upper part of the figure), so the drawing does not slide left and right as the legs and arms move.
 * Feet stay on their row's baseline; only the horizontal anchor moves, by at most a few pixels.
 */
function register(frames: Frame[], px: number): void {
  const top = (f: Frame) => f.off - f.img.h;
  const upper = -0.42 * px;
  const opaque = (f: Frame, x: number, y: number) => {
    const ix = Math.round(x + f.cx);
    const iy = y - top(f);
    if (ix < 0 || iy < 0 || ix >= f.img.w || iy >= f.img.h) return false;
    return f.img.d[(iy * f.img.w + ix) * 4 + 3]! >= 128;
  };
  for (const facing of ['down', 'side', 'up'] as Facing[]) {
    const ref = frames.find((f) => f.facing === facing && f.clip === 'idle');
    if (!ref) continue;
    const pts: [number, number][] = [];
    for (let y = top(ref); y < upper; y++)
      for (let x = -ref.cx; x < ref.img.w - ref.cx; x++) if (opaque(ref, x, y)) pts.push([x, y]);
    if (pts.length < 50) continue;
    for (const f of frames) {
      if (f === ref || f.facing !== facing || f.clip === 'sit' || f.clip === 'sleep') continue;
      const lim = f.clip === 'walk' || f.clip === 'idle' || f.clip === 'talk' ? 8 : 4;
      let best = 0;
      let bestScore = -1;
      let own = 0;
      for (let y = top(f); y < upper; y++)
        for (let x = 0; x < f.img.w; x++) if (f.img.d[((y - top(f)) * f.img.w + x) * 4 + 3]! >= 128) own++;
      for (let dx = -lim; dx <= lim; dx++) {
        let inter = 0;
        for (const [x, y] of pts) if (opaque(f, x - dx, y)) inter++;
        const score = inter / (pts.length + own - inter || 1) - Math.abs(dx) * 0.002;
        if (score > bestScore) {
          bestScore = score;
          best = dx;
        }
      }
      f.cx -= best;
    }
  }
}

/** Cells that show the figure standing with feet together: the scale reference. */
const isStanding = (c: Cell) => c.clip === 'idle' || (c.clip === 'walk' && c.n % 2 === 1);

export async function processChar(
  spec: CharSpec,
  sheets: CharSheet[],
  outDir: string,
  stripFile: string,
): Promise<CharMeta> {
  const px = Math.round(spec.tall * 64 * FRAME_SCALE);
  const frames: Frame[] = [];
  const posed = new Set<string>();
  for (const sh of sheets) {
    const slices = await sliceSheet(sh.file, sh.cols, sh.rows, true);
    if (slices.length !== sh.cells.length)
      throw new Error(`${basename(sh.file)}: ${slices.length} cells sliced, layout has ${sh.cells.length}`);
    const fine = basename(sh.file).startsWith('n');
    let refs = sh.cells
      .map((c, i) => ((fine ? c.clip === 'idle' : isStanding(c)) ? slices[i]!.box.y1 - slices[i]!.box.y0 : -1))
      .filter((v) => v > 0);
    if (!refs.length) refs = slices.map((s) => s.box.y1 - s.box.y0);
    const scale = px / median(refs);
    for (let r = 0; r < sh.rows; r++) {
      const row = slices.slice(r * sh.cols, (r + 1) * sh.cols);
      // finer sheets have rows of jumps and runs: the ground is the second lowest foot, not the middle one
      const ys = row.map((s) => s.box.y1).sort((a, b) => b - a);
      const ground = fine && ys.length >= 3 ? ys[1]! : median(ys);
      for (let k = 0; k < row.length; k++) {
        const s = row[k]!;
        const cell = sh.cells[r * sh.cols + k]!;
        // a spare cell that starts a clip's poses over again (layouts pad a grid that way) would show the same
        // picture twice in a row: keep the first only
        const key = `${cell.clip} ${cell.facing} ${cell.n}`;
        if (posed.has(key)) continue;
        posed.add(key);
        const img = await resize(s.img, s.img.w * scale, s.img.h * scale);
        frames.push({
          clip: cell.clip,
          facing: cell.facing,
          img,
          off: Math.round((s.box.y1 - ground) * scale),
          cx: feetCentre(img),
        });
      }
    }
  }
  if (!frames.length) throw new Error(`${spec.id}: no frames`);
  if (spec.fine) register(frames, px);

  const pad = WORLD_OUTLINE + 3;
  const half = Math.ceil(Math.max(...frames.map((f) => Math.max(f.cx, f.img.w - f.cx)))) + pad;
  const above = Math.max(...frames.map((f) => f.img.h - f.off));
  const below = Math.max(0, ...frames.map((f) => f.off));
  const W = half * 2;
  const footY = above + pad;
  const H = footY + below + pad;

  mkdirSync(outDir, { recursive: true });
  for (const f of readdirSync(outDir)) if (f.endsWith('.png')) rmSync(join(outDir, f));
  const clips: CharMeta['clips'] = {};
  const rowsOut: { label: string; imgs: Img[] }[] = [];
  for (const f of frames) {
    const canvas = blank(W, H);
    over(canvas, f.img, Math.round(half - f.cx), footY + f.off - f.img.h);
    markFrame(spec.id, f.clip, f.facing, canvas);
    const done = WORLD_OUTLINE > 0 ? stickerOutline(canvas, WORLD_OUTLINE, WORLD_EDGE_RGB) : canvas;
    const list = ((clips[f.clip] ??= {})[f.facing] ??= []);
    const name = `${f.clip}_${f.facing}_${list.length}.png`;
    list.push(name);
    await savePng(done, join(outDir, name));
    const label = `${f.clip} ${f.facing}`;
    let row = rowsOut.find((x) => x.label === label);
    if (!row) rowsOut.push((row = { label, imgs: [] }));
    row.imgs.push(done);
  }
  for (const [to, from] of Object.entries(spec.alias ?? {}))
    if (clips[from] && !clips[to]) clips[to] = structuredClone(clips[from]);
  const meta: CharMeta = { id: spec.id, group: spec.group, tall: spec.tall, w: W, h: H, footY, px, clips };
  // package 64: each show character keeps the timing of its own series (tools/art/manner.ts)
  const timing = mannerTiming(spec.id, clips, spec.fine ? fineTiming(clips) : {});
  if (Object.keys(timing).length) meta.timing = timing;
  writeFileSync(join(outDir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');
  await writeStrip(stripFile, rowsOut, W, H, footY);
  return meta;
}

/** One row per clip and facing, frames side by side on mid grey, a label per row and a faint ground line. */
async function writeStrip(
  file: string,
  rows: { label: string; imgs: Img[] }[],
  W: number,
  H: number,
  footY: number,
): Promise<void> {
  const lab = 20;
  const gap = 6;
  const most = Math.max(...rows.map((r) => r.imgs.length));
  const width = Math.max(320, most * (W + gap) + gap);
  const height = rows.length * (lab + H + gap);
  const comps: OverlayOptions[] = [];
  rows.forEach((r, i) => {
    const y = i * (lab + H + gap);
    comps.push({ input: labelSvg(`${r.label} (${r.imgs.length})`, width, lab), left: 0, top: y });
    comps.push({
      input: { create: { width, height: 1, channels: 4, background: { r: 60, g: 60, b: 70, alpha: 0.6 } } },
      left: 0,
      top: y + lab + footY,
    });
    r.imgs.forEach((img, k) => {
      comps.push({
        input: Buffer.from(img.d.buffer, img.d.byteOffset, img.d.length),
        raw: { width: img.w, height: img.h, channels: 4 },
        left: gap + k * (W + gap),
        top: y + lab,
      });
    });
  });
  mkdirSync(join(file, '..'), { recursive: true });
  await sharp({ create: { width, height, channels: 4, background: { r: 128, g: 128, b: 128, alpha: 1 } } })
    .composite(comps)
    .png()
    .toFile(file);
}

/** The masters that exist for a cast entry, with their layouts. */
export function mastersFor(c: CastArt, tag = ''): CharSheet[] {
  // package 58: a character is drawn either wholly on the finer sheets or wholly on the old ones
  const fine = fineSheetsFor(c);
  if (fine.length && fine.every((s) => existsSync(join(MASTERS, c.id, `${s.key}${tag}.png`))))
    return fine.map((s) => ({
      file: join(MASTERS, c.id, `${s.key}${tag}.png`),
      cols: s.grid,
      rows: s.grid,
      cells: s.cells,
    }));
  let sheets: ReturnType<typeof sheetsFor>;
  try {
    sheets = sheetsFor(c);
  } catch (e) {
    console.warn(`warning: ${c.id}: ${(e as Error).message}`);
    return [];
  }
  return sheets
    .map((s) => ({ file: join(MASTERS, c.id, `${s.key}.png`), cols: s.grid, rows: s.grid, cells: s.cells }))
    .filter((s) => existsSync(s.file));
}

// ---------------------------------------------------------------- motion check

/** Share of the pixels opaque in either frame (rows y0..y1) that differ in coverage or clearly in colour. */
export function frameChange(a: Img, b: Img, y0 = 0, y1 = a.h): number {
  let union = 0;
  let diff = 0;
  for (let y = Math.max(0, y0); y < Math.min(a.h, y1); y++)
    for (let x = 0; x < a.w; x++) {
      const i = (y * a.w + x) * 4;
      const oa = a.d[i + 3]! >= 128;
      const ob = b.d[i + 3]! >= 128;
      if (!oa && !ob) continue;
      union++;
      if (oa !== ob) diff++;
      else if (
        Math.abs(a.d[i]! - b.d[i]!) + Math.abs(a.d[i + 1]! - b.d[i + 1]!) + Math.abs(a.d[i + 2]! - b.d[i + 2]!) >
        60
      )
        diff++;
    }
  return union ? diff / union : 0;
}

/** Share of the 4 px blocks (rows y0..y1) covered in either frame whose coverage differs: silhouette change only. */
export function silhouetteChange(a: Img, b: Img, y0 = 0, y1 = a.h, k = BLOCK): number {
  let union = 0;
  let diff = 0;
  y0 = Math.max(0, y0);
  y1 = Math.min(a.h, y1);
  for (let by = y0; by < y1; by += k)
    for (let bx = 0; bx < a.w; bx += k) {
      let ca = 0;
      let cb = 0;
      let n = 0;
      for (let y = by; y < Math.min(by + k, y1); y++)
        for (let x = bx; x < Math.min(bx + k, a.w); x++) {
          const i = (y * a.w + x) * 4 + 3;
          n++;
          if (a.d[i]! >= 128) ca++;
          if (b.d[i]! >= 128) cb++;
        }
      const oa = ca * 2 > n;
      const ob = cb * 2 > n;
      if (!oa && !ob) continue;
      union++;
      if (oa !== ob) diff++;
    }
  return union ? diff / union : 0;
}

export interface MotionResult {
  change: number;
  ok: boolean;
  /** the successive frames (indices in the clip) that changed least */
  pair: [number, number];
}

/**
 * The build plan's rule that no character reads as a still picture: walk clips must change their silhouette in the
 * lower third between every pair of successive frames (wrapping round; two apart in an 8-frame walk); other clips with two or more frames must
 * change at least 1 percent of their opaque pixels.
 * `change` is the smallest successive change in the clip.
 */
export async function motionCheck(dir: string): Promise<Record<string, MotionResult>> {
  const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')) as CharMeta;
  const out: Record<string, MotionResult> = {};
  for (const [clip, facings] of Object.entries(meta.clips))
    for (const [facing, files] of Object.entries(facings)) {
      if (!files || files.length < 2) continue;
      const imgs = await Promise.all(files.map((f) => load(join(dir, f))));
      const walk = clip === 'walk';
      const y0 = meta.footY - Math.round(meta.px / 3);
      let least = 1;
      let pair: [number, number] = [0, 1];
      const pairs = imgs.length === 2 ? 1 : imgs.length;
      // an 8-frame walk (package 58) has an in-between after every pose of the 4-frame one: its stride is two frames
      const gap = walk && imgs.length >= 8 ? 2 : 1;
      for (let i = 0; i < pairs; i++) {
        const a = imgs[i]!;
        const b = imgs[(i + gap) % imgs.length]!;
        const change = walk ? silhouetteChange(a, b, y0, meta.h) : frameChange(a, b);
        if (change < least) {
          least = change;
          pair = [i, (i + gap) % imgs.length];
        }
      }
      out[`${clip}_${facing}`] = {
        change: Math.round(least * 1000) / 1000,
        ok: least >= (walk ? WALK_THRESHOLD : POSE_THRESHOLD),
        pair,
      };
    }
  return out;
}

async function runMotion(dirs: [string, string][], file: string | null): Promise<void> {
  const prev =
    file && existsSync(file)
      ? (JSON.parse(readFileSync(file, 'utf8')) as { results: Record<string, Record<string, MotionResult>> })
      : null;
  const results: Record<string, Record<string, MotionResult>> = prev?.results ?? {};
  const fails: string[] = [];
  for (const [id, dir] of dirs) {
    results[id] = await motionCheck(dir);
    for (const [k, r] of Object.entries(results[id]!))
      if (!r.ok)
        fails.push(`${id.padEnd(16)} ${k.padEnd(18)} ${r.change.toFixed(3)}  frames ${r.pair[0]} and ${r.pair[1]}`);
  }
  if (file) {
    const sorted = Object.fromEntries(Object.entries(results).sort(([a], [b]) => a.localeCompare(b)));
    writeFileSync(
      file,
      JSON.stringify({ threshold: { walk: WALK_THRESHOLD, other: POSE_THRESHOLD }, results: sorted }, null, 2) + '\n',
    );
  }
  for (const [id] of dirs)
    console.log(
      `motion ${id}: ${Object.entries(results[id]!)
        .map(([k, r]) => `${k} ${r.change.toFixed(3)}${r.ok ? '' : ' FAIL'}`)
        .join(', ')}`,
    );
  if (fails.length)
    console.log(`motion failures (walk needs ${WALK_THRESHOLD}, others ${POSE_THRESHOLD}):\n${fails.join('\n')}`);
  else console.log('motion: all clips move');
}

// ---------------------------------------------------------------- face stickers

const UI = join(ROOT, 'art/src/ui');
/** Face sticker size in px (square). */
const FACE = 128;
/** Share of the trimmed figure, from the top, that makes the head-and-shoulders picture. */
const FACE_TOP = 0.55;
/** Looks whose head is a smaller share of the figure (a tall dinosaur on a long neck) cut less. */
const FACE_TOP_BY_ID: Record<string, number> = { rex: 0.36 };
/** Characters, mobs and animals drawn with another set's art (the same table as the game's). */
export const FACE_ALIAS: Record<string, string> = {
  villager_1: 'villager_a',
  villager_3: 'villager_a',
  trader: 'villager_a',
  villager_2: 'villager_b',
  villager_trader: 'villager_b',
  mini_creeper: 'creeper',
};

/** Head and shoulders from one frame: top 55 percent of the trimmed figure, fitted to a square with a sticker edge. */
export async function faceSticker(frame: string, topShare = FACE_TOP): Promise<Img> {
  const src = await load(frame);
  const box = alphaBox(src, 96);
  if (!box) throw new Error(`${frame} is empty`);
  // a low wide figure (spider) keeps its whole height; its face is at the front, not on top
  const share = box.x1 - box.x0 > box.y1 - box.y0 ? 1 : topShare;
  const y1 = box.y0 + Math.max(1, Math.round((box.y1 - box.y0) * share));
  // a wide cut (a desk, a crook, eight legs) narrows to a near square round the head: the opaque centre of its top rows
  const most = Math.round((y1 - box.y0) * 1.15);
  let { x0, x1 } = box;
  if (x1 - x0 > most) {
    let sx = 0;
    let n = 0;
    for (let y = box.y0; y < box.y0 + Math.max(1, Math.round((y1 - box.y0) * 0.4)); y++)
      for (let x = x0; x < x1; x++)
        if (src.d[(y * src.w + x) * 4 + 3]! >= 128) {
          sx += x;
          n++;
        }
    const cx = n ? sx / n : (x0 + x1) / 2;
    x0 = Math.max(box.x0, Math.min(box.x1 - most, Math.round(cx - most / 2)));
    x1 = x0 + most;
  }
  const top = crop(src, { x0, y0: box.y0, x1, y1 });
  // world frames carry no ring (WORLD_OUTLINE): the face sticker gets the whole menu ring here, the cut included
  const edge = OUTLINE + 3;
  const room = FACE - (edge + 2) * 2;
  const k = room / Math.max(top.w, top.h);
  const art = await resize(top, top.w * k, top.h * k);
  const canvas = blank(FACE, FACE);
  // sit the cut on the bottom margin so the face fills the top of the sticker
  over(canvas, art, Math.floor((FACE - art.w) / 2), FACE - edge - 2 - art.h);
  return stickerOutline(canvas, edge);
}

/** face_<id>.png in art/src/ui for every character, mob and animal the game data names. */
export async function makeFaces(only: Set<string> | null): Promise<string[]> {
  const { chars } = await import('../../src/data/chars.ts');
  const { mobs, animals } = await import('../../src/data/world.ts');
  const ids = [...new Set([...Object.keys(chars), ...Object.keys(mobs), ...Object.keys(animals)])].sort();
  mkdirSync(UI, { recursive: true });
  const missing: string[] = [];
  let made = 0;
  for (const id of ids) {
    if (only && !only.has(id) && !only.has(FACE_ALIAS[id] ?? id)) continue;
    const dir = join(SRC, FACE_ALIAS[id] ?? id);
    const frame = ['idle_down_0', 'idle_side_0', 'walk_down_0']
      .map((f) => join(dir, `${f}.png`))
      .find((f) => existsSync(f));
    if (!frame) {
      missing.push(id);
      continue;
    }
    if (!frame.endsWith('idle_down_0.png'))
      console.warn(`warning: face_${id} cut from ${basename(frame, '.png')} (no idle_down_0)`);
    const art = FACE_ALIAS[id] ?? id;
    await savePng(await faceSticker(frame, FACE_TOP_BY_ID[art] ?? FACE_TOP), join(UI, `face_${id}.png`));
    made++;
  }
  console.log(`faces: ${made} written to art/src/ui${missing.length ? `; no art for ${missing.join(' ')}` : ''}`);
  return missing;
}

// ---------------------------------------------------------------- generic sheets

export interface SheetJob {
  master: string;
  cols: number;
  rows: number;
  /** one per cell in reading order; "" skips the cell */
  names: string[];
  out: string;
  /** longer side of the art in px (with fit 'contain': the side of the square canvas, padding included) */
  size: number;
  fit?: 'contain';
  /** sticker outline, on by default */
  outline?: boolean;
  /** clear margin round the art in px; defaults to the outline width plus 2 when outlined, else 0 */
  pad?: number;
}

export async function processSheets(jobs: SheetJob[]): Promise<void> {
  for (const job of jobs) {
    const slices = await sliceSheet(resolve(ROOT, job.master), job.cols, job.rows);
    const outline = job.outline !== false;
    const pad = job.pad ?? (outline ? OUTLINE + 2 : 0);
    const outDir = resolve(ROOT, job.out);
    mkdirSync(outDir, { recursive: true });
    for (let i = 0; i < slices.length; i++) {
      const name = job.names[i];
      if (!name) continue;
      const s = slices[i]!.img;
      const side = job.fit === 'contain' ? job.size - pad * 2 : job.size;
      const k = side / Math.max(s.w, s.h);
      const art = await resize(s, s.w * k, s.h * k);
      const cw = job.fit === 'contain' ? job.size : art.w + pad * 2;
      const ch = job.fit === 'contain' ? job.size : art.h + pad * 2;
      let canvas = blank(cw, ch);
      over(canvas, art, Math.floor((cw - art.w) / 2), Math.floor((ch - art.h) / 2));
      if (outline) canvas = stickerOutline(canvas, OUTLINE);
      await toSharp(canvas)
        .png({ compressionLevel: 9 })
        .toFile(join(outDir, `${name}.png`));
    }
    console.log(`${job.master}: ${job.names.filter(Boolean).length} images -> ${job.out}`);
  }
}

// ---------------------------------------------------------------- test material

/** Spike sheets as scratch characters, for checking the pipeline without touching the cast list. */
function testChars(): { spec: CharSpec; sheets: CharSheet[] }[] {
  const spike = (f: string) => join(ROOT, 'art/masters/spike', f);
  const hero = {
    id: 'spike',
    role: 'hero',
    body: 'biped',
    style: 'person',
    desc: '',
    tall: 1.75,
    group: 'test',
  } as CastArt;
  const walker = { ...hero, role: 'walker' } as CastArt;
  const [f16, , b9] = sheetsFor(hero);
  const [, sb16] = sheetsFor(walker);
  const cells = (list: [string, Facing, number][]): Cell[] =>
    list.flatMap(([clip, facing, k]) => Array.from({ length: k }, (_, n) => ({ clip, facing, n, pose: '' })));
  return [
    {
      spec: { id: '_test-person', group: 'test', tall: 1.75 },
      sheets: [
        { file: spike('person_sheet_front16.png'), cols: 4, rows: 4, cells: f16!.cells },
        { file: spike('person_sheet_mixed16.png'), cols: 4, rows: 4, cells: sb16!.cells },
      ],
    },
    {
      spec: { id: '_test-bluey', group: 'test', tall: 1.7 },
      sheets: [
        { file: spike('bluey_sheet_back.png'), cols: 3, rows: 2, cells: b9!.cells.slice(0, 6) },
        {
          file: spike('bluey_sheet_side.png'),
          cols: 3,
          rows: 3,
          cells: cells([
            ['idle', 'side', 2],
            ['walk', 'side', 4],
            ['talk', 'side', 2],
            ['hurt', 'side', 1],
          ]),
        },
      ],
    },
    {
      spec: { id: '_test-mob', group: 'test', tall: 2 },
      sheets: [
        {
          file: spike('mob_sheet_side.png'),
          cols: 3,
          rows: 3,
          cells: cells([
            ['idle', 'side', 2],
            ['walk', 'side', 4],
            ['attack', 'side', 3],
          ]),
        },
      ],
    },
  ];
}

// ---------------------------------------------------------------- command line

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const mode = argv[0];
  const oi = argv.indexOf('--only');
  const only = oi >= 0 ? new Set(argv[oi + 1]!.split(',')) : null;
  if (mode === 'chars' && argv.includes('--test')) {
    const base = join(process.env.TMPDIR ?? tmpdir(), 'art-test');
    const dirs: [string, string][] = [];
    for (const t of testChars()) {
      const dir = join(base, 'chars', t.spec.id);
      const meta = await processChar(t.spec, t.sheets, dir, join(STRIPS, `${t.spec.id}.png`));
      console.log(`${t.spec.id}: ${meta.w} x ${meta.h}, footY ${meta.footY}, px ${meta.px} -> ${dir}`);
      dirs.push([t.spec.id, dir]);
    }
    await runMotion(dirs, join(base, 'motion.json'));
  } else if (mode === 'chars') {
    const dirs: [string, string][] = [];
    const failed: string[] = [];
    // --tag t --to dir: slice the <key>-t.png masters into a scratch folder instead (comparing two models)
    const ti = argv.indexOf('--tag');
    const tag = ti >= 0 ? `-${argv[ti + 1]}` : '';
    const toi = argv.indexOf('--to');
    const to = toi >= 0 ? resolve(argv[toi + 1]!) : null;
    if (tag && !to) throw new Error('--tag needs --to <dir>');
    for (const c of cast) {
      if (only && !only.has(c.id)) continue;
      const sheets = mastersFor(c, tag);
      if (!sheets.length) continue;
      const fine = basename(sheets[0]!.file).startsWith('n');
      const dir = join(to ?? SRC, c.id);
      // One bad sheet must not stop the whole cast: note it and carry on.
      let meta: Awaited<ReturnType<typeof processChar>>;
      try {
        meta = await processChar(
          { id: c.id, group: c.group, tall: c.tall, alias: c.alias, fine },
          sheets,
          dir,
          join(to ?? STRIPS, `${c.id}.png`),
        );
      } catch (e) {
        console.log(`FAILED ${c.id}: ${(e as Error).message}`);
        failed.push(`${c.id}: ${(e as Error).message}`);
        continue;
      }
      console.log(
        `${c.id}: ${sheets.map((s) => basename(s.file, '.png')).join(' ')} -> ${meta.w} x ${meta.h}, ${Object.keys(meta.clips).length} clips`,
      );
      dirs.push([c.id, dir]);
    }
    if (!dirs.length) console.log('no cast entry has sheet masters yet');
    else {
      await runMotion(dirs, to ? null : MOTION);
      if (!to) await makeFaces(only);
    }
    if (failed.length) console.log(`\n${failed.length} character(s) could not be sliced:\n  ${failed.join('\n  ')}`);
  } else if (mode === 'motion') {
    const ids = existsSync(SRC)
      ? readdirSync(SRC).filter((id) => existsSync(join(SRC, id, 'meta.json')) && (!only || only.has(id)))
      : [];
    await runMotion(
      ids.sort().map((id) => [id, join(SRC, id)]),
      MOTION,
    );
  } else if (mode === 'faces') {
    await makeFaces(only);
  } else if (mode === 'sheets' && argv[1]) {
    await processSheets(JSON.parse(readFileSync(argv[1], 'utf8')) as SheetJob[]);
  } else {
    console.log(
      'usage: node tools/art/process.ts chars [--only id,id] | faces [--only id,id] | sheets <list.json> | motion [--only id,id]',
    );
    process.exitCode = 2;
  }
}
