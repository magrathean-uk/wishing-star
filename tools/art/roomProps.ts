// Fit isolated, transparent room furniture paintings to their pixel-per-tile runtime canvases.
// node tools/art/roomProps.ts <manifest.json>
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { alphaBox, blank, crop, toSharp } from './imgutil.ts';
import { sliceSheet } from './process.ts';

interface Prop {
  id: string;
  master: string;
  size: [number, number];
  /** Optional row-major source cell for an evenly divided generated sheet. */
  grid?: [number, number];
  cell?: number;
}

const root = resolve(import.meta.dirname, '../..');
const manifest = resolve(process.argv[2] ?? 'art/jobs/graphics2-roomprops-fit.json');
const props = JSON.parse(readFileSync(manifest, 'utf8')) as Prop[];
const sheets = new Map<string, Awaited<ReturnType<typeof sliceSheet>>>();
for (const prop of props) {
  const file = resolve(root, prop.master);
  const [columns, rows] = prop.grid ?? [1, 1];
  const key = `${file}:${columns}x${rows}`;
  let cells = sheets.get(key);
  if (!cells) {
    cells = await sliceSheet(file, columns, rows);
    sheets.set(key, cells);
  }
  const cellIndex = prop.cell ?? 0;
  if (!Number.isInteger(cellIndex) || cellIndex < 0 || cellIndex >= cells.length)
    throw new Error(`${prop.id}: cell ${cellIndex} is outside ${columns}x${rows} sheet ${file}`);
  const source = cells[cellIndex];
  if (!source) throw new Error(`${prop.id}: no art in cell ${cellIndex} of ${file}`);
  const bounds = alphaBox(source.img);
  if (!bounds) throw new Error(`${prop.id}: empty art in ${file}`);
  const silhouette = crop(source.img, bounds);
  const [tilesWide, tilesHigh] = prop.size;
  const width = tilesWide * 96;
  const height = tilesHigh * 96;
  const scale = Math.min(width / silhouette.w, height / silhouette.h);
  const fittedWidth = Math.max(1, Math.round(silhouette.w * scale));
  const fittedHeight = Math.max(1, Math.round(silhouette.h * scale));
  const fitted = await toSharp(silhouette).resize(fittedWidth, fittedHeight, { fit: 'fill' }).png().toBuffer();
  const output = blank(width, height);
  await toSharp(output)
    .composite([{ input: fitted, left: Math.floor((width - fittedWidth) / 2), top: height - fittedHeight }])
    .png()
    .toFile(join(root, 'art/src/objects', `${prop.id}.png`));
  console.log(`${prop.id}: ${width}x${height}`);
}
