// Split and key the generated plant sheet into bottom-anchored runtime frames.
// Water glints stay a separate tile so the ground renderer can animate their offset.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import sharp from 'sharp';

const root = resolve(import.meta.dirname, '../..');
const master = join(root, 'art/masters/environment');
const sourceObjects = join(root, 'art/src/objects');
const sourceLandscape = join(root, 'art/src/landscape');
const atlasDir = join(root, 'public/assets/atlas');
const waterDir = join(root, 'public/assets/ground');
const vegetationSheet = join(master, 'vegetation-sheet-key.png');

const sheet = await sharp(vegetationSheet).removeAlpha().raw().toBuffer({
  resolveWithObject: true,
});
if (sheet.info.width % 3 !== 0 || sheet.info.height % 3 !== 0 || sheet.info.channels !== 3)
  throw new Error('Expected a square three-by-three RGB plant sheet');

const cellSize = sheet.info.width / 3;
if (sheet.info.height / 3 !== cellSize) throw new Error('Plant cells must be square');
const frameSize = 192;
const baseline = 174;
const targetW = 166;
const targetH = 148;
const frames: Buffer[] = [];
const reports: Array<{ id: string; cut: number; box: [number, number, number, number]; root: [number, number] }> = [];

for (let index = 0; index < 9; index++) {
  const col = index % 3;
  const row = Math.floor(index / 3);
  const cell = Buffer.from(
    await sharp(vegetationSheet)
      .extract({ left: col * cellSize, top: row * cellSize, width: cellSize, height: cellSize })
      .removeAlpha()
      .raw()
      .toBuffer(),
  );
  const alpha = new Uint8Array(cellSize * cellSize);
  const background = new Uint8Array(cellSize * cellSize);
  const opacity = new Uint8Array(cellSize * cellSize);
  const keyed = Buffer.alloc(cellSize * cellSize * 3);
  const queue = new Uint32Array(cellSize * cellSize);
  let head = 0;
  let tail = 0;
  for (let y = 0; y < cellSize; y++) {
    for (let x = 0; x < cellSize; x++) {
      const p = y * cellSize + x;
      const offset = p * 3;
      const r = cell[offset]!;
      const g = cell[offset + 1]!;
      const b = cell[offset + 2]!;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      if ((r - 255) ** 2 + g ** 2 + (b - 255) ** 2 < 42 ** 2) {
        background[p] = 1;
        alpha[p] = 1;
        continue;
      }
      if (max - min > 24 || min < 180) continue;
      background[p] = 1;
      if (x === 0 || y === 0 || x === cellSize - 1 || y === cellSize - 1) {
        queue[tail++] = p;
        alpha[p] = 1;
      }
    }
  }

  // The image tool drew a pale checkerboard behind the plants. Remove only its connected regions,
  // which preserves pale clover heads contained inside a leaf cluster.
  while (head < tail) {
    const p = queue[head++]!;
    const x = p % cellSize;
    const y = Math.floor(p / cellSize);
    for (let dy = -1; dy <= 1; dy++) {
      const ny = y + dy;
      if (ny < 0 || ny >= cellSize) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        if ((dx === 0 && dy === 0) || nx < 0 || nx >= cellSize) continue;
        const next = ny * cellSize + nx;
        if (background[next] && !alpha[next]) {
          alpha[next] = 1;
          queue[tail++] = next;
        }
      }
    }
  }

  // Estimate partial edge coverage, then remove the magenta that was blended into plant edges.
  for (let p = 0; p < alpha.length; p++) {
    if (alpha[p]) continue;
    const from = p * 3;
    const r = cell[from]!;
    const g = cell[from + 1]!;
    const b = cell[from + 2]!;
    const distance = Math.sqrt((r - 255) ** 2 + g ** 2 + (b - 255) ** 2);
    const amount = Math.min(1, distance / 300);
    if (amount < 0.12) continue;
    opacity[p] = Math.round(amount * 255);
    keyed[from] = Math.max(0, Math.min(255, Math.round((r - 255 * (1 - amount)) / amount)));
    keyed[from + 1] = Math.max(0, Math.min(255, Math.round(g / amount)));
    keyed[from + 2] = Math.max(0, Math.min(255, Math.round((b - 255 * (1 - amount)) / amount)));
  }

  let x0 = cellSize;
  let y0 = cellSize;
  let x1 = -1;
  let y1 = -1;
  let removed = 0;
  for (let p = 0; p < alpha.length; p++) {
    if (opacity[p] < 64) {
      removed++;
      continue;
    }
    const x = p % cellSize;
    const y = Math.floor(p / cellSize);
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  if (x1 < x0 || y1 < y0 || removed < cellSize * cellSize * 0.2)
    throw new Error(`Plant ${index + 1} has no clean silhouette`);

  const baseX: number[] = [];
  for (let y = Math.max(y0, y1 - 24); y <= y1; y++)
    for (let x = x0; x <= x1; x++) if (opacity[y * cellSize + x] >= 128) baseX.push(x);
  if (!baseX.length)
    throw new Error(`Plant ${index + 1} has no ground anchor in rows ${y1 - 24}–${y1} within ${x0}–${x1}`);
  baseX.sort((a, b) => a - b);
  const rootX = baseX[Math.floor(baseX.length / 2)]!;

  const cropWidth = x1 - x0 + 1;
  const cropHeight = y1 - y0 + 1;
  const leftOfRoot = rootX - x0;
  const rightOfRoot = x1 - rootX;
  const anchorLimit = Math.min(
    leftOfRoot ? (frameSize / 2 - 5) / leftOfRoot : Infinity,
    rightOfRoot ? (frameSize / 2 - 5) / rightOfRoot : Infinity,
  );
  const scale = Math.min(targetW / cropWidth, targetH / cropHeight, anchorLimit);
  const width = Math.max(1, Math.round(cropWidth * scale));
  const height = Math.max(1, Math.round(cropHeight * scale));
  const cropped = Buffer.alloc(cropWidth * cropHeight * 4);
  for (let y = 0; y < cropHeight; y++) {
    for (let x = 0; x < cropWidth; x++) {
      const source = (y + y0) * cellSize + x + x0;
      if (opacity[source] < 64) continue;
      const from = source * 3;
      const to = (y * cropWidth + x) * 4;
      cropped[to] = keyed[from]!;
      cropped[to + 1] = keyed[from + 1]!;
      cropped[to + 2] = keyed[from + 2]!;
      cropped[to + 3] = opacity[source]!;
    }
  }
  const scaled = await sharp(cropped, {
    raw: { width: cropWidth, height: cropHeight, channels: 4 },
  })
    .resize(width, height, { kernel: 'lanczos3' })
    .raw()
    .toBuffer();

  const anchorX = Math.round((rootX - x0) * scale);
  const anchorY = Math.round((y1 - y0) * scale);
  const top = baseline - anchorY;
  const frame = Buffer.alloc(frameSize * frameSize * 4);
  const placementX = frameSize / 2 - anchorX;
  if (placementX < 0 || placementX + width > frameSize || top < 0 || top + height > frameSize)
    throw new Error(`Plant ${index + 1} does not fit around its ground anchor`);
  for (let y = 0; y < height; y++) {
    const from = y * width * 4;
    const to = ((top + y) * frameSize + placementX) * 4;
    scaled.copy(frame, to, from, from + width * 4);
  }

  const id = `wind_grass_${String(index + 1).padStart(2, '0')}`;
  const output = join(sourceObjects, `${id}.png`);
  mkdirSync(dirname(output), { recursive: true });
  await sharp(frame, { raw: { width: frameSize, height: frameSize, channels: 4 } })
    .png()
    .toFile(output);
  frames.push(frame);
  reports.push({ id, cut: removed, box: [x0, y0, x1, y1], root: [frameSize / 2, baseline] });
}

const gap = 2;
const edge = 2;
const pageSize = frameSize * 3 + gap * 2 + edge * 2;
const page = Buffer.alloc(pageSize * pageSize * 4);
const atlasFrames: Record<string, object> = {};
const index = JSON.parse(readFileSync(join(atlasDir, 'index.json'), 'utf8')) as {
  objects: string[];
  frames: { objects: Record<string, [number, number]> };
};
index.objects = index.objects.filter((page) => page !== 'objects-wind');
for (let i = 1; i <= 9; i++) delete index.frames.objects[`wind_grass_${String(i).padStart(2, '0')}`];
for (let i = 0; i < frames.length; i++) {
  const col = i % 3;
  const row = Math.floor(i / 3);
  const x = edge + col * (frameSize + gap);
  const y = edge + row * (frameSize + gap);
  for (let py = 0; py < frameSize; py++) {
    const from = py * frameSize * 4;
    const to = ((y + py) * pageSize + x) * 4;
    frames[i]!.copy(page, to, from, from + frameSize * 4);
  }
  const id = reports[i]!.id;
  atlasFrames[id] = {
    frame: { x, y, w: frameSize, h: frameSize },
    rotated: false,
    trimmed: false,
    spriteSourceSize: { x: 0, y: 0, w: frameSize, h: frameSize },
    sourceSize: { w: frameSize, h: frameSize },
  };
  index.frames.objects[id] = [frameSize, frameSize];
}
mkdirSync(atlasDir, { recursive: true });
await sharp(page, { raw: { width: pageSize, height: pageSize, channels: 4 } })
  .webp({ lossless: true })
  .toFile(join(atlasDir, 'objects-wind.webp'));
writeFileSync(
  join(atlasDir, 'objects-wind.json'),
  `${JSON.stringify(
    {
      frames: atlasFrames,
      meta: {
        app: 'wishing-star tools/art/prepare-environment.ts',
        version: '1',
        image: 'objects-wind.webp',
        format: 'RGBA8888',
        size: { w: pageSize, h: pageSize },
        scale: '1',
      },
    },
    null,
    2,
  )}\n`,
);
index.objects.push('objects-wind');
writeFileSync(join(atlasDir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);

const glints = await sharp(join(master, 'water-glints.png'))
  .resize(512, 512, { fit: 'fill', kernel: 'lanczos3' })
  .png()
  .toBuffer();
mkdirSync(sourceLandscape, { recursive: true });
mkdirSync(waterDir, { recursive: true });
writeFileSync(join(sourceLandscape, 'water-glints.png'), glints);
writeFileSync(join(waterDir, 'water-glints.png'), glints);
writeFileSync(join(root, 'art/qa/environment-vegetation.json'), `${JSON.stringify(reports, null, 2)}\n`);
console.log(
  `ENVIRONMENT ART PASS: ${reports.length} anchored frames, page ${pageSize} × ${pageSize}, water glints 512 × 512`,
);
