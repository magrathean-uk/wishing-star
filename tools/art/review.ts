// Review pages, labelled by character id:
//   node tools/art/review.ts models [per]          model images -> art/qa/models/page-N.png
//   node tools/art/review.ts strips [id,id]        every processed frame of a character on one compact page, on a
//                                                  dark teal ground so halos, holes and checkerboard bits show
//                                                  -> art/qa/review/<id>.png
//   node tools/art/review.ts faces                 every face sticker on one page -> art/qa/review/_faces.png
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import sharp, { type OverlayOptions } from 'sharp';
import { contactSheet } from './contact.ts';
import { labelSvg } from './imgutil.ts';
import type { CharMeta } from './process.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const what = process.argv[2] ?? 'models';
const GROUND = { r: 46, g: 92, b: 104, alpha: 1 };

/** All frames of one character in reading order (clip, facing, frame), 8 to a row, each cell labelled. */
async function stripPage(id: string, out: string): Promise<void> {
  const dir = resolve(ROOT, 'art/src/chars', id);
  const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')) as CharMeta;
  const files: string[] = [];
  for (const facings of Object.values(meta.clips))
    for (const list of Object.values(facings)) files.push(...(list ?? []));
  const cols = 8;
  const cell = 190;
  const lab = 18;
  const rows = Math.ceil(files.length / cols);
  const k = Math.min(1, (cell - 6) / Math.max(meta.w, meta.h));
  const comps: OverlayOptions[] = [];
  for (let i = 0; i < files.length; i++) {
    const x = (i % cols) * cell;
    const y = Math.floor(i / cols) * (cell + lab);
    const buf = await sharp(join(dir, files[i]!))
      .resize(Math.round(meta.w * k), Math.round(meta.h * k))
      .png()
      .toBuffer();
    comps.push({ input: buf, left: x + 3, top: y + 3 });
    // the ground line, so a frame that floats or sinks shows
    comps.push({
      input: { create: { width: cell - 6, height: 1, channels: 4, background: { r: 255, g: 200, b: 0, alpha: 0.5 } } },
      left: x + 3,
      top: y + 3 + Math.round(meta.footY * k),
    });
    comps.push({ input: labelSvg(files[i]!.replace(/\.png$/, ''), cell, lab), left: x, top: y + cell });
  }
  await sharp({ create: { width: cols * cell, height: rows * (cell + lab), channels: 4, background: GROUND } })
    .composite(comps)
    .png()
    .toFile(out);
}

if (what === 'models') {
  const per = Number(process.argv[3] ?? 24);
  const out = resolve(ROOT, 'art/qa', what);
  mkdirSync(out, { recursive: true });
  const tmp = join(tmpdir(), 'ws-review');
  mkdirSync(tmp, { recursive: true });
  const files: string[] = [];
  const dir = resolve(ROOT, 'art/masters/chars');
  for (const id of readdirSync(dir).sort()) {
    const f = join(dir, id, 'model.png');
    if (!existsSync(f)) continue;
    const named = join(tmp, id + '.png');
    copyFileSync(f, named);
    files.push(named);
  }
  for (let i = 0, page = 0; i < files.length; i += per, page++) {
    await contactSheet(join(out, `page-${page}.png`), files.slice(i, i + per), 6, 200);
    console.log(join('art/qa', what, `page-${page}.png`));
  }
} else if (what === 'strips') {
  const src = resolve(ROOT, 'art/src/chars');
  const only = process.argv[3]?.split(',');
  const out = resolve(ROOT, 'art/qa/review');
  mkdirSync(out, { recursive: true });
  for (const id of readdirSync(src).sort()) {
    if (only && !only.includes(id)) continue;
    if (!existsSync(join(src, id, 'meta.json'))) continue;
    await stripPage(id, join(out, `${id}.png`));
    console.log(join('art/qa/review', `${id}.png`));
  }
} else if (what === 'faces') {
  const dir = resolve(ROOT, 'art/src/ui');
  const files = readdirSync(dir)
    .filter((f) => f.startsWith('face_') && f.endsWith('.png'))
    .sort()
    .map((f) => join(dir, f));
  const out = resolve(ROOT, 'art/qa/review');
  mkdirSync(out, { recursive: true });
  await contactSheet(join(out, '_faces.png'), files, 10, 150, '#2e5c68');
  console.log(`art/qa/review/_faces.png: ${files.length} faces`);
} else {
  console.log('usage: node tools/art/review.ts models [per] | strips [id,id] | faces');
  process.exitCode = 2;
}
