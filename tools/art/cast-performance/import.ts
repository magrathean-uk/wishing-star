// Import one reviewed 3 x 2 performance sheet without rebuilding the rest of the cast.
import { createHash } from 'node:crypto';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp, { type OverlayOptions } from 'sharp';
import { cast } from '../cast.ts';
import {
  alphaBox,
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
  toSharp,
} from '../imgutil.ts';
import { packChars } from '../pack.ts';
import {
  frameChange,
  motionCheck,
  POSE_THRESHOLD,
  silhouetteChange,
  WALK_THRESHOLD,
  type CharMeta,
  type MotionResult,
} from '../process.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const CONTRACT = 'cast-performance-six-cel-v1';
const ID = /^[a-z][a-z0-9_]*$/;
const FRAME = /^[a-zA-Z0-9_-]+\.png$/;
type Row = 'walk' | 'talk';
type Facing = 'side' | 'down';
interface CandidateRow {
  clip: Row;
  facing: Facing;
  reference: string;
  frames: Img[];
  adjustment: { scale: number; shiftX: number };
}
interface Candidate {
  id: string;
  meta: CharMeta;
  approvals: Partial<Record<Row, string>>;
  errors: Partial<Record<Row, string>>;
  sheetSha256: string;
  walkSheetSha256?: string;
  pipelineSha256: string;
  targetSha256: string;
  rows: CandidateRow[];
  slices: Img[];
  walkPreview: Img[];
  boxes: ({ x0: number; y0: number; x1: number; y1: number } | null)[];
  keyedHoles: { x0: number; y0: number; x1: number; y1: number }[];
  walkBoxes?: Candidate['boxes'];
  walkKeyedHoles?: Candidate['keyedHoles'];
  sourceSize: { w: number; h: number };
  background: 'transparent' | 'magenta';
}
interface CharIndex {
  groups: Record<string, string[]>;
  lazy: Record<string, { pages: string[]; frames: string[] }>;
  sets: Record<string, unknown>;
  [key: string]: unknown;
}
interface MotionFile {
  results: Record<string, Record<string, MotionResult>>;
  [key: string]: unknown;
}
interface Decision {
  id: string;
  sheet: string;
  walkSheet?: string;
  approvals: Partial<Record<Row, string>>;
}

function hash(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function pipelineFingerprint(): string {
  return hash(
    [
      fileURLToPath(import.meta.url),
      resolve(ROOT, 'tools/art/cast.ts'),
      resolve(ROOT, 'tools/art/imgutil.ts'),
      resolve(ROOT, 'tools/art/process.ts'),
      resolve(ROOT, 'tools/art/pack.ts'),
      resolve(ROOT, 'src/game/puppet.ts'),
    ]
      .map((file) => hash(readFileSync(file)))
      .join('\n'),
  );
}

function charDir(root: string, id: string): string {
  if (!ID.test(id)) throw new Error(`Invalid character id: ${id}`);
  return join(root, 'art/src/chars', id);
}

/** Bind a review to every referenced source frame, not just the two visible comparison frames. */
function targetFingerprint(dir: string, meta: CharMeta): string {
  const refs = new Set<string>();
  for (const facings of Object.values(meta.clips))
    for (const frames of Object.values(facings))
      for (const file of frames ?? []) {
        if (!FRAME.test(file)) throw new Error(`Unsafe frame name: ${file}`);
        refs.add(file);
      }
  const parts = [hash(readFileSync(join(dir, 'meta.json')))];
  for (const file of [...refs].sort()) parts.push(file, hash(readFileSync(join(dir, file))));
  return hash(parts.join('\n'));
}

function readMeta(root: string, id: string): CharMeta {
  const meta = JSON.parse(readFileSync(join(charDir(root, id), 'meta.json'), 'utf8')) as CharMeta;
  if (
    meta.id !== id ||
    !meta.clips?.idle ||
    !Number.isInteger(meta.w) ||
    !Number.isInteger(meta.h) ||
    meta.w < 1 ||
    meta.h < 1 ||
    !Number.isFinite(meta.px) ||
    meta.px <= 0 ||
    !Number.isFinite(meta.footY) ||
    meta.footY <= 0 ||
    meta.footY > meta.h
  )
    throw new Error(`${id}: invalid existing character metadata`);
  return meta;
}

function selectedRows(id: string, meta: CharMeta): { clip: Row; facing: Facing; reference: string }[] {
  const spec = cast.find((item) => item.id === id);
  if (!spec) throw new Error(`${id}: no cast entry`);
  const rows: { clip: Row; facing: Facing; reference: string }[] = [];
  if (spec.role !== 'fixed' && meta.clips.walk?.side?.length) {
    const reference = meta.clips.idle?.side?.[0];
    if (!reference) throw new Error(`${id}: side walk needs its own side idle reference`);
    rows.push({ clip: 'walk', facing: 'side', reference });
  }
  if (['hero', 'walker', 'fixed', 'speakingMob'].includes(spec.role) && meta.clips.talk?.down?.length) {
    const reference = meta.clips.idle?.down?.[0];
    if (!reference) throw new Error(`${id}: front talk needs its own front idle reference`);
    rows.push({ clip: 'talk', facing: 'down', reference });
  }
  if (!rows.length) throw new Error(`${id}: no compatible existing side walk or front talk`);
  return rows;
}

/** Key the border and small enclosed gaps matching its measured colour, not generic pink/purple clothing. */
export function keySheet(img: Img): { background: 'transparent' | 'magenta'; keyedHoles: Candidate['keyedHoles'] } {
  const border: number[] = [];
  for (let x = 0; x < img.w; x++) border.push(x, (img.h - 1) * img.w + x);
  for (let y = 1; y < img.h - 1; y++) border.push(y * img.w, y * img.w + img.w - 1);
  const transparent = border.filter((p) => img.d[p * 4 + 3]! <= 8).length / border.length >= 0.999;
  const nearMagenta = (p: number) => {
    const i = p * 4;
    return (
      img.d[i]! >= 210 &&
      img.d[i + 2]! >= 210 &&
      img.d[i + 1]! <= 48 &&
      Math.abs(img.d[i]! - img.d[i + 2]!) <= 24 &&
      img.d[i + 3]! >= 250
    );
  };
  const magenta = border.filter(nearMagenta).length / border.length >= 0.999;
  if (!transparent && !magenta) throw new Error('Sheet border must be transparent or a near-magenta background');
  const keyedHoles: Candidate['keyedHoles'] = [];
  if (magenta) {
    const { w, h, d } = img;
    const keyed = new Uint8Array(w * h);
    const queue = new Int32Array(w * h);
    let tail = 0;
    for (const p of border)
      if (!keyed[p] && nearMagenta(p)) {
        keyed[p] = 1;
        queue[tail++] = p;
      }
    for (let head = 0; head < tail; head++) {
      const p = queue[head]!;
      const x = p % w;
      const y = Math.floor(p / w);
      for (const q of [x ? p - 1 : -1, x + 1 < w ? p + 1 : -1, y ? p - w : -1, y + 1 < h ? p + w : -1])
        if (q >= 0 && !keyed[q] && nearMagenta(q)) {
          keyed[q] = 1;
          queue[tail++] = q;
        }
    }
    const original = Uint8Array.from(d);
    const bg = [0, 1, 2].map((k) => median(border.filter(nearMagenta).map((p) => original[p * 4 + k]!)));
    const islands = new Uint8Array(w * h);
    for (let p = 0; p < islands.length; p++) if (!keyed[p] && nearMagenta(p)) islands[p] = 1;
    const { labels, blobs } = components(islands, w, h);
    for (const blob of blobs) {
      // A key-coloured patch can also be a costume: only small, enclosed regions with the same measured
      // colour as the rim are cleared. The review still checks for missing details and coloured plugs.
      if (blob.area < 12 || blob.area > (w * h) / 120) continue;
      const colours: number[][] = [[], [], []];
      for (let y = blob.box.y0; y < blob.box.y1; y++)
        for (let x = blob.box.x0; x < blob.box.x1; x++) {
          const p = y * w + x;
          if (labels[p] !== blob.label) continue;
          for (let k = 0; k < 3; k++) colours[k]!.push(original[p * 4 + k]!);
        }
      // Median is robust to anti-aliased, shadow-coloured pixels at the edge of a small gap.
      if (colours.some((values, k) => Math.abs(median(values) - bg[k]!) > 6)) continue;
      keyedHoles.push(blob.box);
      for (let y = blob.box.y0; y < blob.box.y1; y++)
        for (let x = blob.box.x0; x < blob.box.x1; x++) {
          const p = y * w + x;
          if (labels[p] === blob.label) keyed[p] = 1;
        }
    }
    // Remove colour spill only from the first foreground pixel beside the key. A nearby non-magenta interior
    // pixel supplies its colour; otherwise leave it alone so pink/purple costume edges are not guessed away.
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++) {
        const p = y * w + x;
        if (keyed[p] || ![p - 1, p + 1, p - w, p + w].some((q) => keyed[q])) continue;
        const i = p * 4;
        const tint = Math.min(original[i]! - original[i + 1]!, original[i + 2]! - original[i + 1]!);
        if (tint < 30) continue;
        let neighbour = -1;
        for (const q of [p - 1, p + 1, p - w, p + w]) {
          if (keyed[q]) continue;
          const j = q * 4;
          const score = Math.min(original[j]! - original[j + 1]!, original[j + 2]! - original[j + 1]!);
          if (score < 50) {
            neighbour = q;
            break;
          }
        }
        if (neighbour < 0) continue;
        const j = neighbour * 4;
        let dot = 0;
        let norm = 0;
        for (let k = 0; k < 3; k++) {
          const direction = original[j + k]! - bg[k]!;
          dot += (original[i + k]! - bg[k]!) * direction;
          norm += direction * direction;
        }
        if (norm < 2500) continue;
        const alpha = Math.max(0, Math.min(1, dot / norm));
        if (alpha >= 0.98) continue;
        if (alpha < 0.05) {
          d[i + 3] = 0;
          continue;
        }
        for (let k = 0; k < 3; k++)
          d[i + k] = Math.max(0, Math.min(255, Math.round((original[i + k]! - (1 - alpha) * bg[k]!) / alpha)));
        d[i + 3] = Math.round(original[i + 3]! * alpha);
      }
    for (let p = 0; p < keyed.length; p++) if (keyed[p]) d[p * 4 + 3] = 0;
  }
  return { background: magenta ? 'magenta' : 'transparent', keyedHoles };
}

/** Split on grid boundaries, never reassign a crossing blob to a neighbour. */
function cut(
  img: Img,
  columns = 3,
): { slices: Img[]; boxes: Candidate['boxes']; errors: Partial<Record<Row, string>> } {
  if (img.w < columns * 48 || img.h < 96) throw new Error('Sheet is too small for its cel grid');
  const slices: Img[] = [];
  const boxes: Candidate['boxes'] = [];
  const errors: Partial<Record<Row, string>> = {};
  for (let row = 0; row < 2; row++)
    for (let col = 0; col < columns; col++) {
      const x0 = Math.floor((col * img.w) / columns);
      const y0 = Math.floor((row * img.h) / 2);
      const cell = crop(img, {
        x0,
        y0,
        x1: Math.floor(((col + 1) * img.w) / columns),
        y1: Math.floor(((row + 1) * img.h) / 2),
      });
      const box = alphaBox(cell, 8);
      const label = `row ${row + 1}, column ${col + 1}`;
      const key: Row = columns === 4 || row === 0 ? 'walk' : 'talk';
      if (!box) {
        errors[key] ??= `${label}: empty cel`;
        boxes.push(null);
        slices.push(blank(1, 1));
        continue;
      }
      const margin = Math.max(2, Math.floor(Math.min(cell.w, cell.h) * 0.01));
      if (box.x0 < margin || box.y0 < margin || box.x1 > cell.w - margin || box.y1 > cell.h - margin)
        errors[key] ??= `${label}: artwork reaches a cell edge and may be cut or joined`;
      const width = box.x1 - box.x0;
      const height = box.y1 - box.y0;
      let pixels = 0;
      for (let i = 3; i < cell.d.length; i += 4) if (cell.d[i]! > 102) pixels++;
      if (height < cell.h * 0.24 || width < cell.w * 0.06 || pixels < cell.w * cell.h * 0.004)
        errors[key] ??= `${label}: artwork is too small to be a complete figure`;
      slices.push(crop(cell, box));
      boxes.push({ x0: x0 + box.x0, y0: y0 + box.y0, x1: x0 + box.x1, y1: y0 + box.y1 });
    }
  for (let row = 0; row < 2; row++) {
    const heights = slices.slice(row * columns, row * columns + columns).map((s) => s.h);
    if (Math.min(...heights) < Math.max(...heights) * 0.55)
      errors[columns === 4 || row === 0 ? 'walk' : 'talk'] ??= `row ${row + 1}: inconsistent cel heights`;
  }
  return { slices, boxes, errors };
}

/** Centre of the upper body, so varying legs do not pull a frame sideways. */
function upperCentre(img: Img, box: NonNullable<ReturnType<typeof alphaBox>>): number {
  const end = box.y0 + Math.ceil((box.y1 - box.y0) * 0.6);
  let sum = 0;
  let count = 0;
  for (let y = box.y0; y < end; y++)
    for (let x = box.x0; x < box.x1; x++) {
      if (img.d[(y * img.w + x) * 4 + 3]! > 102) {
        sum += x + 0.5;
        count++;
      }
    }
  if (!count) throw new Error('Cel has no solid upper body');
  return sum / count;
}

export async function fitRow(
  meta: CharMeta,
  reference: Img,
  slices: Img[],
  allowWalkAdjustment = false,
): Promise<{ frames: Img[]; adjustment: { scale: number; shiftX: number } }> {
  if (reference.w !== meta.w || reference.h !== meta.h) throw new Error('Reference dimensions disagree with metadata');
  const refBox = alphaBox(reference, 8);
  if (!refBox) throw new Error('Reference frame is empty');
  const scale = (refBox.y1 - refBox.y0) / median(slices.map((s) => s.h));
  const anchor = upperCentre(reference, refBox);
  const maxShift = allowWalkAdjustment ? Math.max(1, Math.floor(Math.min(meta.w, meta.px) * 0.03)) : 0;
  const factors = allowWalkAdjustment ? [1, 0.995, 0.99, 0.985, 0.98, 0.975, 0.97] : [1];
  for (const factor of factors) {
    const placed: { figure: Img; x: number; y: number }[] = [];
    let low = -maxShift;
    let high = maxShift;
    for (const slice of slices) {
      const figure = await resize(slice, slice.w * scale * factor, slice.h * scale * factor);
      const box = alphaBox(figure, 8);
      if (!box) throw new Error('Resizing made a cel empty');
      const x = Math.round(anchor - upperCentre(figure, box));
      const y = refBox.y1 - box.y1;
      low = Math.max(low, -x - box.x0);
      high = Math.min(high, meta.w - x - box.x1);
      if (y + box.y0 < 0 || y + box.y1 > meta.h) {
        low = 1;
        high = 0;
      }
      placed.push({ figure, x, y });
    }
    if (low > high) continue;
    const shiftX = Math.max(low, Math.min(0, high));
    const frames = placed.map(({ figure, x, y }) => {
      const canvas = blank(meta.w, meta.h);
      over(canvas, figure, x + shiftX, y);
      return canvas;
    });
    return { frames, adjustment: { scale: factor, shiftX } };
  }
  throw new Error(
    allowWalkAdjustment
      ? 'A new cel does not fit the original frame canvas within the 3% registration limit; do not crop it'
      : 'A new cel does not fit the original frame canvas; do not crop it',
  );
}

/** Materialise the old 8 fps default only when a changed frame count needs a stable cycle length. */
function defaultWalkDurations(meta: CharMeta, newCount: number): number[] | undefined {
  const side = meta.timing?.walk?.dursByFacing?.side;
  if (side?.length && side.every((d) => Number.isFinite(d) && d >= 0) && side.some((d) => d > 0)) return undefined;
  const durs = meta.timing?.walk?.durs;
  if (durs?.length && durs.every((d) => Number.isFinite(d) && d >= 0) && durs.some((d) => d > 0)) return undefined;
  const oldCount = meta.clips.walk?.side?.length ?? 0;
  if (oldCount === newCount) return undefined;
  const counts = Object.values(meta.clips.walk ?? {}).map((frames) => frames?.length ?? 0);
  if (!oldCount || counts.some((count) => count !== oldCount))
    throw new Error('walk: cannot preserve a default-timed cycle across facings of different lengths');
  return Array(oldCount).fill(1 / 8) as number[];
}

export async function candidate(root: string, id: string, sheet: string, walkSheet?: string): Promise<Candidate> {
  const dir = charDir(root, id);
  const meta = readMeta(root, id);
  const chosen = selectedRows(id, meta);
  const sheetSha256 = hash(readFileSync(sheet));
  const pipelineSha256 = pipelineFingerprint();
  const targetSha256 = targetFingerprint(dir, meta);
  const image = await load(sheet);
  const sourceSize = { w: image.w, h: image.h };
  let background: Candidate['background'] = 'transparent';
  let keyedHoles: Candidate['keyedHoles'] = [];
  let slices: Img[] = Array.from({ length: 6 }, () => blank(1, 1));
  let boxes: Candidate['boxes'] = Array(6).fill(null);
  let errors: Candidate['errors'] = {};
  try {
    ({ background, keyedHoles } = keySheet(image));
    ({ slices, boxes, errors } = cut(image));
  } catch (error) {
    if (!walkSheet) throw error;
    const message = error instanceof Error ? error.message : String(error);
    errors = { walk: message, talk: message };
  }
  let walkSlices = slices.slice(0, 3);
  let walkSheetSha256: string | undefined;
  let walkBoxes: Candidate['walkBoxes'];
  let walkKeyedHoles: Candidate['walkKeyedHoles'];
  if (walkSheet) {
    delete errors.walk;
    try {
      walkSheetSha256 = hash(readFileSync(walkSheet));
      const eightImage = await load(walkSheet);
      walkKeyedHoles = keySheet(eightImage).keyedHoles;
      const eight = cut(eightImage, 4);
      walkSlices = eight.slices;
      walkBoxes = eight.boxes;
      if (eight.errors.walk) errors.walk = eight.errors.walk;
    } catch (error) {
      errors.walk = error instanceof Error ? error.message : String(error);
    }
  }
  const rows: CandidateRow[] = [];
  const approvals: Candidate['approvals'] = {};
  for (const row of chosen) {
    if (errors[row.clip]) continue;
    try {
      const reference = await load(join(dir, row.reference));
      const { frames, adjustment } = await fitRow(
        meta,
        reference,
        row.clip === 'walk' ? walkSlices : slices.slice(3, 6),
        row.clip === 'walk',
      );
      const change = (a: Img, b: Img) =>
        row.clip === 'walk' ? silhouetteChange(a, b, meta.footY - Math.round(meta.px / 3), meta.h) : frameChange(a, b);
      const loop = frames.length === 3 ? [frames[0]!, frames[1]!, frames[2]!, frames[1]!] : frames;
      if (frames.length === 8 && new Set(frames.map((frame) => hash(Buffer.from(frame.d)))).size !== 8)
        throw new Error('walk: eight-cel sheet contains repeated frames');
      const gap = row.clip === 'walk' && loop.length >= 8 ? 2 : 1;
      const least = Math.min(...loop.map((frame, i) => change(frame, loop[(i + gap) % loop.length]!)));
      const threshold = row.clip === 'walk' ? WALK_THRESHOLD : POSE_THRESHOLD;
      if (least < threshold) throw new Error(`${row.clip}: motion ${least.toFixed(3)} is below the ${threshold} gate`);
      if (row.clip === 'walk') defaultWalkDurations(meta, loop.length);
      rows.push({ ...row, frames, adjustment });
      approvals[row.clip] = hash(
        [
          CONTRACT,
          pipelineSha256,
          id,
          row.clip,
          row.clip === 'walk' && walkSheetSha256 ? walkSheetSha256 : sheetSha256,
          targetSha256,
        ].join('\n'),
      );
    } catch (error) {
      errors[row.clip] = error instanceof Error ? error.message : String(error);
    }
  }
  return {
    id,
    meta,
    approvals,
    errors,
    sheetSha256,
    walkSheetSha256,
    pipelineSha256,
    targetSha256,
    rows,
    slices,
    walkPreview: walkSlices,
    boxes,
    keyedHoles,
    walkBoxes,
    walkKeyedHoles,
    sourceSize,
    background,
  };
}

/** Match the puppet's fitDurations: integrate authored durations over the active frame's interval. */
function previewDurations(durs: number[] | undefined, n: number): number[] | undefined {
  if (!durs?.length || !n || durs.some((d) => !Number.isFinite(d) || d < 0) || durs.every((d) => d === 0))
    return undefined;
  return Array.from({ length: n }, (_, i) => {
    const a = (i * durs.length) / n;
    const b = ((i + 1) * durs.length) / n;
    return durs.reduce((sum, duration, j) => sum + duration * Math.max(0, Math.min(b, j + 1) - Math.max(a, j)), 0);
  });
}

/** Leave every new cel visible for at least half the mean frame time, preserving the old cycle length. */
function performanceDurations(durs: number[]): number[] | undefined {
  const total = durs.reduce((sum, duration) => sum + duration, 0);
  if (!durs.length || total <= 0) return undefined;
  const minimum = total / durs.length / 2;
  const needed = durs.reduce((sum, duration) => sum + Math.max(0, minimum - duration), 0);
  if (needed < 1e-12) return undefined;
  const available = durs.reduce((sum, duration) => sum + Math.max(0, duration - minimum), 0);
  return durs.map((duration) =>
    duration < minimum ? minimum : duration - ((duration - minimum) * needed) / available,
  );
}

function rowDurations(meta: CharMeta, clip: Row, facing: Facing, count: number): number[] | undefined {
  const timing = meta.timing?.[clip];
  return previewDurations(timing?.dursByFacing?.[facing], count) ?? previewDurations(timing?.durs, count);
}

/** Show current and candidate cycles at the same scale, with the idle transition in the first column. */
export async function preview(root: string, item: Candidate, file: string): Promise<void> {
  const size = 150;
  const label = 24;
  const overlays: OverlayOptions[] = [];
  const dir = charDir(root, item.id);
  const views: { title: string; clip: Row; facing: Facing; next: boolean }[] = [
    { title: 'walk old', clip: 'walk', facing: 'side', next: false },
    { title: 'walk new', clip: 'walk', facing: 'side', next: true },
    { title: 'talk old', clip: 'talk', facing: 'down', next: false },
    { title: 'talk new', clip: 'talk', facing: 'down', next: true },
  ];
  for (let r = 0; r < views.length; r++) {
    const view = views[r]!;
    const row = item.rows.find((it) => it.clip === view.clip);
    const reference = item.meta.clips.idle?.[view.facing]?.[0];
    const idle = reference ? await load(join(dir, reference)) : null;
    const oldFiles = item.meta.clips[view.clip]?.[view.facing] ?? [];
    let frames: Img[];
    if (!view.next) frames = await Promise.all(oldFiles.map((f) => load(join(dir, f))));
    else if (row)
      frames = row.frames.length === 3 ? [row.frames[0]!, row.frames[1]!, row.frames[2]!, row.frames[1]!] : row.frames;
    else if (item.errors[view.clip]) frames = view.clip === 'walk' ? item.walkPreview : item.slices.slice(3, 6);
    else frames = [];
    const first = view.next && row?.frames.length === 3 ? `${view.title}: 3 drawn` : view.title;
    const imgs = [idle, ...frames];
    let durations = rowDurations(item.meta, view.clip, view.facing, frames.length);
    if (!durations && view.clip === 'walk' && frames.length) {
      const materialised = view.next && row ? defaultWalkDurations(item.meta, frames.length) : undefined;
      durations = previewDurations(materialised ?? Array(frames.length).fill(1 / 8), frames.length);
    }
    if (!durations && frames.length) durations = Array(frames.length).fill(1 / 7) as number[];
    if (view.next && row && durations) durations = performanceDurations(durations) ?? durations;
    const walkTiming = item.meta.timing?.walk as
      | { durs: number[]; step?: number[]; stepByFacing?: { side?: number[] } }
      | undefined;
    const globalContacts = walkTiming?.step ?? [1, 3];
    const sourceCount = walkTiming?.durs?.length || 4;
    const contacts =
      view.clip !== 'walk'
        ? []
        : view.next && row
          ? row.frames.length === 3
            ? [0, 2]
            : [0, 4]
          : (walkTiming?.stepByFacing?.side ??
            globalContacts
              .filter((n) => Number.isInteger(n) && n >= 0 && n < sourceCount)
              .map((n) => Math.floor((n * frames.length) / sourceCount)));
    for (let c = 0; c < 9; c++) {
      const duration = durations?.[c - 1];
      const time = duration === undefined ? '' : duration === 0 ? ' skipped' : ` ${duration.toFixed(2)}s`;
      const contact = contacts.includes(c - 1) ? '*' : '';
      const caption = c === 0 ? first : c <= frames.length ? `frame ${c}${contact}${time}` : '';
      overlays.push({ input: labelSvg(caption, size, label), left: c * size, top: r * (size + label) });
      const img = imgs[c];
      if (!img) continue;
      const input = await toSharp(img)
        .resize(size - 8, size - 8, { fit: 'contain', background: '#00000000' })
        .png()
        .toBuffer();
      overlays.push({ input, left: c * size + 4, top: r * (size + label) + label + 4 });
    }
  }
  mkdirSync(dirname(file), { recursive: true });
  await sharp({ create: { width: size * 9, height: (size + label) * 4, channels: 4, background: '#30343b' } })
    .composite(overlays)
    .png()
    .toFile(file);
}

function json(file: string, data: unknown): void {
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

interface Staged {
  item: Candidate;
  sheet: string;
  walkSheet?: string;
  selected: CandidateRow[];
  staged: string;
  stagedOut: string;
  packed: CharIndex;
  motion: Record<string, MotionResult>;
  newFiles: string[];
  previewFile: string;
  reportFile: string;
}

async function stage(root: string, decision: Decision, temporary: string): Promise<Staged> {
  const { id, sheet, walkSheet, approvals } = decision;
  if (!approvals || typeof approvals !== 'object' || Array.isArray(approvals))
    throw new Error(`${id}: approvals must be an object`);
  const requested = Object.keys(approvals);
  if (!requested.length || requested.some((key) => key !== 'walk' && key !== 'talk'))
    throw new Error(`${id}: specify one or both of walk and talk`);
  const item = await candidate(root, id, sheet, walkSheet);
  for (const clip of requested as Row[]) {
    if (item.errors[clip]) throw new Error(`${id}: ${clip}: ${item.errors[clip]}`);
    if (!item.approvals[clip] || approvals[clip] !== item.approvals[clip])
      throw new Error(`${id}: ${clip}: approval does not match the current sheet and source; review again`);
  }
  const selected = item.rows.filter((row) => requested.includes(row.clip));
  const base = join(temporary, id);
  const srcRoot = join(base, 'src');
  const outRoot = join(base, 'out');
  const staged = join(srcRoot, 'chars', id);
  mkdirSync(dirname(staged), { recursive: true });
  cpSync(charDir(root, id), staged, { recursive: true });
  const meta = structuredClone(item.meta);
  const newFiles: string[] = [];
  for (const row of selected) {
    const files: string[] = [];
    for (let i = 0; i < row.frames.length; i++) {
      const name = `performance_${row.clip}_${row.facing}_${item.approvals[row.clip]!.slice(0, 12)}_${i}.png`;
      await savePng(row.frames[i]!, join(staged, name));
      files.push(name);
      newFiles.push(name);
    }
    meta.clips[row.clip]![row.facing] = files.length === 3 ? [files[0]!, files[1]!, files[2]!, files[1]!] : files;
    if (row.clip === 'walk') {
      const timings = (meta.timing ??= {});
      const walkTiming = (timings.walk ??= { durs: [] }) as typeof timings.walk & {
        stepByFacing?: { down?: number[]; side?: number[]; up?: number[] };
      };
      const materialised = defaultWalkDurations(item.meta, meta.clips.walk!.side!.length);
      if (materialised) {
        const oldTiming = item.meta.timing?.walk;
        const sourceCount = oldTiming?.durs?.length || 4;
        walkTiming.step = (oldTiming?.step ?? [1, 3])
          .filter((n) => Number.isInteger(n) && n >= 0 && n < sourceCount)
          .map((n) => Math.floor((n * materialised.length) / sourceCount));
        walkTiming.durs = materialised;
      }
      walkTiming.stepByFacing = { ...walkTiming.stepByFacing, side: files.length === 3 ? [0, 2] : [0, 4] };
    }
    const count = meta.clips[row.clip]![row.facing]!.length;
    const durs =
      rowDurations(meta, row.clip, row.facing, count) ??
      (Array(count).fill(1 / (row.clip === 'walk' ? 8 : 7)) as number[]);
    const balanced = performanceDurations(durs);
    if (balanced) {
      const timing = ((meta.timing ??= {})[row.clip] ??= { durs: [] });
      timing.dursByFacing = { ...timing.dursByFacing, [row.facing]: balanced };
    }
  }
  json(join(staged, 'meta.json'), meta);
  const motion = await motionCheck(staged);
  for (const row of selected) {
    const key = `${row.clip}_${row.facing}`;
    if (!motion[key]?.ok)
      throw new Error(`${id}: ${key} fails the existing motion gate (${JSON.stringify(motion[key])})`);
  }
  await packChars(srcRoot, outRoot);
  const stagedOut = join(outRoot, 'chars');
  const packed = JSON.parse(readFileSync(join(stagedOut, 'index.json'), 'utf8')) as CharIndex;
  if (!packed.groups[id]?.length || !packed.sets[id]) throw new Error(`${id}: packer produced no atlas set`);
  const previewFile = join(base, 'preview.png');
  await preview(root, item, previewFile);
  const reportFile = join(base, 'report.json');
  json(reportFile, {
    contract: CONTRACT,
    id,
    approvals,
    sheetSha256: item.sheetSha256,
    walkSheetSha256: item.walkSheetSha256,
    pipelineSha256: item.pipelineSha256,
    targetSha256: item.targetSha256,
    sourceSize: item.sourceSize,
    background: item.background,
    boxes: item.boxes,
    keyedHoles: item.keyedHoles,
    walkBoxes: item.walkBoxes,
    walkKeyedHoles: item.walkKeyedHoles,
    rows: selected.map(({ clip, facing, reference, adjustment }) => ({ clip, facing, reference, adjustment })),
    motion: Object.fromEntries(selected.map((r) => [`${r.clip}_${r.facing}`, motion[`${r.clip}_${r.facing}`]])),
  });
  return { item, sheet, walkSheet, selected, staged, stagedOut, packed, motion, newFiles, previewFile, reportFile };
}

/** Stage all selected characters, then reconcile the shared indexes once and install the batch. */
export async function installBatch(
  root: string,
  decisions: Decision[],
  reports = join(root, 'art/qa/cast-performance'),
): Promise<void> {
  if (!Array.isArray(decisions) || !decisions.length) throw new Error('No approved characters in manifest');
  const ids = new Set<string>();
  for (const decision of decisions) {
    if (!decision || typeof decision.id !== 'string' || typeof decision.sheet !== 'string')
      throw new Error('Each entry needs id and sheet');
    charDir(root, decision.id);
    if (ids.has(decision.id)) throw new Error(`${decision.id}: duplicate manifest entry`);
    ids.add(decision.id);
  }
  const temporary = mkdtempSync(join(tmpdir(), 'cast-performance-'));
  try {
    const all: Staged[] = [];
    for (const decision of decisions) all.push(await stage(root, decision, temporary));
    const indexPath = join(root, 'public/assets/chars/index.json');
    const index = JSON.parse(readFileSync(indexPath, 'utf8')) as CharIndex;
    const motionPath = join(root, 'art/qa/motion.json');
    const motionFile = JSON.parse(readFileSync(motionPath, 'utf8')) as MotionFile;
    if (!index.groups || !index.sets || !index.lazy || !motionFile.results)
      throw new Error('Existing atlas or motion index is incomplete');
    const writes: [string, string][] = [];
    const removals: string[] = [];
    for (const s of all) {
      const { id } = s.item;
      const oldPages = index.groups[id];
      const newPages = s.packed.groups[id]!;
      if (!oldPages || !index.sets[id] || !motionFile.results[id])
        throw new Error(`${id}: existing atlas or motion entry is missing`);
      const pageName = new RegExp(`^${id}(?:_x)?-\\d+$`);
      for (const page of [...oldPages, ...newPages])
        if (!pageName.test(page)) throw new Error(`${id}: unexpected atlas page ${page}`);
      index.groups[id] = newPages;
      index.sets[id] = { ...(index.sets[id] as object), ...(s.packed.sets[id] as object) };
      if (s.packed.lazy[id]) index.lazy[id] = { ...index.lazy[id], ...s.packed.lazy[id]! };
      else delete index.lazy[id];
      motionFile.results[id] = s.motion;
      writes.push(...s.newFiles.map((f): [string, string] => [join(s.staged, f), join(charDir(root, id), f)]));
      writes.push([join(s.staged, 'meta.json'), join(charDir(root, id), 'meta.json')]);
      writes.push(
        ...newPages.flatMap((p): [string, string][] =>
          ['webp', 'json'].map((ext) => [
            join(s.stagedOut, `${p}.${ext}`),
            join(root, 'public/assets/chars', `${p}.${ext}`),
          ]),
        ),
      );
      writes.push([s.previewFile, join(reports, `${id}.png`)]);
      writes.push([s.reportFile, join(reports, `${id}.json`)]);
      removals.push(
        ...oldPages
          .filter((p) => !newPages.includes(p))
          .flatMap((p) => ['webp', 'json'].map((ext) => join(root, 'public/assets/chars', `${p}.${ext}`))),
      );
    }
    json(join(temporary, 'index.json'), index);
    json(join(temporary, 'motion.json'), motionFile);
    writes.push([join(temporary, 'index.json'), indexPath], [join(temporary, 'motion.json'), motionPath]);
    // A change during packing invalidates the review. Check every character before the first write.
    for (const s of all)
      if (
        hash(readFileSync(s.sheet)) !== s.item.sheetSha256 ||
        pipelineFingerprint() !== s.item.pipelineSha256 ||
        (s.walkSheet &&
          s.selected.some((row) => row.clip === 'walk') &&
          hash(readFileSync(s.walkSheet)) !== s.item.walkSheetSha256) ||
        targetFingerprint(charDir(root, s.item.id), readMeta(root, s.item.id)) !== s.item.targetSha256
      )
        throw new Error(`${s.item.id}: sheet or target changed during preparation; review again`);
    const targets = [...writes.map(([, dst]) => dst), ...removals];
    if (new Set(targets).size !== targets.length) throw new Error('Batch has conflicting output paths');
    const backups = targets.map((dst, i) => {
      const file = join(temporary, `backup-${i}`);
      if (existsSync(dst)) {
        copyFileSync(dst, file);
        return file;
      }
      return null;
    });
    try {
      for (const [src, dst] of writes) {
        mkdirSync(dirname(dst), { recursive: true });
        copyFileSync(src, dst);
      }
      for (const file of removals) if (existsSync(file)) rmSync(file);
    } catch (error) {
      for (let i = 0; i < targets.length; i++) {
        if (backups[i]) copyFileSync(backups[i]!, targets[i]!);
        else if (existsSync(targets[i]!)) rmSync(targets[i]!);
      }
      throw error;
    }
    for (const s of all)
      console.log(
        `${s.item.id}: installed ${s.selected.map((r) => `${r.clip}.${r.facing}`).join(', ')}; QA at ${join(reports, `${s.item.id}.png`)}`,
      );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  try {
    const [command, ...args] = process.argv.slice(2);
    const option = (name: string, required = true): string => {
      const i = args.indexOf(`--${name}`);
      if (i < 0 || !args[i + 1] || args[i + 1]!.startsWith('--')) {
        if (!required) return '';
        throw new Error(`Missing --${name}`);
      }
      return args[i + 1]!;
    };
    const root = resolve(option('root', false) || ROOT);
    const reports = resolve(
      option('reports', false) || join(homedir(), 'dev/machine/records/wishing-star/cast-performance'),
    );
    if (command === 'preview') {
      const id = option('id');
      const sheet = resolve(option('sheet'));
      const walkSheet = option('walk-sheet', false);
      const item = await candidate(root, id, sheet, walkSheet ? resolve(walkSheet) : undefined);
      const output = resolve(option('out'));
      await preview(root, item, output);
      console.log(
        JSON.stringify(
          {
            id,
            sheet,
            ...(walkSheet ? { walkSheet: resolve(walkSheet) } : {}),
            preview: output,
            approvals: item.approvals,
            errors: item.errors,
            adjustments: Object.fromEntries(item.rows.map(({ clip, adjustment }) => [clip, adjustment])),
            keyedHoles: item.keyedHoles,
            walkKeyedHoles: item.walkKeyedHoles,
          },
          null,
          2,
        ),
      );
      if (!item.rows.length) process.exitCode = 1;
    } else if (command === 'preview-batch') {
      const path = resolve(option('manifest'));
      const manifest = JSON.parse(readFileSync(path, 'utf8')) as { characters: Decision[] };
      if (!Array.isArray(manifest.characters) || !manifest.characters.length)
        throw new Error('Manifest must contain a non-empty characters array');
      const output = resolve(option('out-dir'));
      mkdirSync(output, { recursive: true });
      const results: unknown[] = [];
      const seen = new Set<string>();
      let failures = 0;
      for (const entry of manifest.characters) {
        try {
          if (!entry || typeof entry.id !== 'string' || typeof entry.sheet !== 'string')
            throw new Error('Entry needs id and sheet');
          charDir(root, entry.id);
          if (seen.has(entry.id)) throw new Error(`Duplicate character: ${entry.id}`);
          seen.add(entry.id);
          const sheet = resolve(dirname(path), entry.sheet);
          const walkSheet = entry.walkSheet ? resolve(dirname(path), entry.walkSheet) : undefined;
          const item = await candidate(root, entry.id, sheet, walkSheet);
          const file = join(output, `${entry.id}.png`);
          await preview(root, item, file);
          if (selectedRows(entry.id, item.meta).some((row) => item.errors[row.clip])) failures++;
          results.push({
            id: entry.id,
            sheet,
            ...(walkSheet ? { walkSheet } : {}),
            preview: file,
            candidateHashes: item.approvals,
            errors: item.errors,
            adjustments: Object.fromEntries(item.rows.map(({ clip, adjustment }) => [clip, adjustment])),
            keyedHoles: item.keyedHoles,
            ...(item.walkKeyedHoles ? { walkKeyedHoles: item.walkKeyedHoles } : {}),
          });
        } catch (error) {
          failures++;
          results.push({ id: entry?.id ?? null, error: error instanceof Error ? error.message : String(error) });
        }
      }
      const file = join(output, 'candidates.json');
      json(file, { candidates: results });
      console.log(`Previewed ${results.length} character(s); ${failures} need correction. Review ${file}`);
      if (failures) process.exitCode = 1;
    } else if (command === 'install') {
      const approvals: Decision['approvals'] = {};
      for (const clip of ['walk', 'talk'] as Row[]) {
        const value = option(clip, false);
        if (value) approvals[clip] = value;
      }
      const walkSheet = option('walk-sheet', false);
      await installBatch(
        root,
        [
          {
            id: option('id'),
            sheet: resolve(option('sheet')),
            ...(walkSheet ? { walkSheet: resolve(walkSheet) } : {}),
            approvals,
          },
        ],
        reports,
      );
    } else if (command === 'install-batch') {
      const path = resolve(option('manifest'));
      const manifest = JSON.parse(readFileSync(path, 'utf8')) as { characters: Decision[] };
      if (!Array.isArray(manifest.characters)) throw new Error('Manifest must contain a characters array');
      await installBatch(
        root,
        manifest.characters.map((d) => ({
          ...d,
          sheet: resolve(dirname(path), d.sheet),
          ...(d.walkSheet ? { walkSheet: resolve(dirname(path), d.walkSheet) } : {}),
        })),
        reports,
      );
    } else throw new Error('Use preview, preview-batch, install or install-batch');
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
