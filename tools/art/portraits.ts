// Talk box portraits: the idle and talk frames facing down, sliced again from the masters at their own full detail
// (about twice the world frames), cut to the part that shows above the talk box and packed as lossy WebP, one page
// a character. The world frames are about 140 px a figure and the talk box draws them three to four times larger,
// which was soft and blocky on an iPad (G, 22 Nov 2026).
//   WS_ART_MASTERS=<main checkout>/art/masters/chars node tools/art/portraits.ts [--only id,id]
//   -> public/assets/portraits/<id>_talk-0.webp/.json and public/assets/portraits/index.json (page names differ from
//   the world pages <id>-0: the game keys every page by its name)
// A character whose masters are missing, or whose sliced frames no longer match its world frames (redrawn since),
// is left out: the game then draws its world frames, as before.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { portraitShown, portraitZoom } from '../../src/game/portraitFit.ts';
import { cast } from './cast.ts';
import { type Img, load, median, resize } from './imgutil.ts';
import { type Sprite, trim, writeAtlas } from './pack.ts';
import { type CharMeta, FRAME_SCALE, mastersFor, processChar, sliceSheet } from './process.ts';

const ROOT = new URL('../../', import.meta.url).pathname;
const WORLD = join(ROOT, 'art/src/chars');
const OUT = join(ROOT, 'public/assets/portraits');
/** The clips the talk box plays (Puppet.playDialogue('idle', 'down')): idle, and talk while a line types out. */
const CLIPS = ['idle', 'talk'] as const;
/** WebP quality for the portrait pages: no visible loss at the size they are drawn, a fifth of lossless. */
const QUALITY = 90;
/** Portraits never go above this many pixels a figure (the largest the talk box draws one, 4.2 x 2 tiles). */
const MAX_PX = 540;
/** Below this overlap with the world frame's outline the masters are not the drawing the game shows. */
const MIN_MATCH = 0.88;

interface PortraitSet {
  page: string;
  w: number;
  h: number;
  footY: number;
  px: number;
  clips: Record<string, { down: string[] }>;
}

/** Share of opaque pixels shared by the world frame and the portrait frame brought down to the world size. */
async function match(world: Img, wm: CharMeta, por: Img, pm: CharMeta): Promise<number> {
  const k = wm.px / pm.px;
  const small = await resize(por, Math.max(1, Math.round(por.w * k)), Math.max(1, Math.round(por.h * k)));
  const dx = small.w / 2 - wm.w / 2;
  const dy = pm.footY * k - wm.footY;
  let both = 0;
  let either = 0;
  for (let y = 0; y < world.h; y++)
    for (let x = 0; x < world.w; x++) {
      const a = world.d[(y * world.w + x) * 4 + 3]! >= 128;
      const sx = Math.round(x + dx);
      const sy = Math.round(y + dy);
      const b = sx >= 0 && sy >= 0 && sx < small.w && sy < small.h && small.d[(sy * small.w + sx) * 4 + 3]! >= 128;
      if (a && b) both++;
      if (a || b) either++;
    }
  return either ? both / either : 0;
}

/** Clear everything below the row the talk box hides, so the packed page holds only what shows. */
function cutBelow(img: Img, row: number): void {
  const from = Math.max(0, Math.min(img.h, Math.ceil(row)));
  img.d.fill(0, from * img.w * 4);
}

async function portrait(id: string, stage: string): Promise<PortraitSet | string> {
  const c = cast.find((x) => x.id === id);
  if (!c) return 'not in the art cast';
  const wm = JSON.parse(readFileSync(join(WORLD, id, 'meta.json'), 'utf8')) as CharMeta;
  const sheets = mastersFor(c);
  if (!sheets.length) return 'no masters';
  const fine = sheets[0]!.file.split('/').pop()!.startsWith('n');
  // the full detail of the sheets the idle and talk frames come from: never enlarge a master
  let native = Infinity;
  for (const sh of sheets) {
    if (!sh.cells.some((cell) => cell.facing === 'down' && (CLIPS as readonly string[]).includes(cell.clip))) continue;
    const slices = await sliceSheet(sh.file, sh.cols, sh.rows, true);
    const refs = sh.cells
      .map((cell, i) =>
        (fine ? cell.clip === 'idle' : cell.clip === 'idle' || (cell.clip === 'walk' && cell.n % 2 === 1))
          ? slices[i]!.box.y1 - slices[i]!.box.y0
          : -1,
      )
      .filter((v) => v > 0);
    if (refs.length) native = Math.min(native, median(refs));
  }
  if (!Number.isFinite(native)) return 'no idle frames facing down on the masters';
  const px = Math.min(MAX_PX, Math.floor(native));
  if (px < wm.px * 1.25) return `masters only ${px} px a figure (world ${wm.px})`;
  const dir = join(stage, id);
  const pm = await processChar(
    { id, group: wm.group, tall: px / (64 * FRAME_SCALE), alias: c.alias, fine },
    sheets,
    dir,
    join(stage, `${id}-strip.png`),
  );
  for (const clip of CLIPS) {
    const a = wm.clips[clip]?.down?.length ?? 0;
    const b = pm.clips[clip]?.down?.length ?? 0;
    if (a !== b) return `${clip} has ${b} frames on the masters, ${a} in the game`;
  }
  const first = wm.clips.idle?.down?.[0];
  if (!first) return 'no idle frame facing down';
  const score = await match(await load(join(WORLD, id, first)), wm, await load(join(dir, first)), pm);
  if (score < MIN_MATCH) return `masters differ from the world frames (overlap ${score.toFixed(2)})`;
  // the same line as UI.drawTalk: the box hides the figure below `shown` from the top, plus a little for breathing
  const body = wm.tall * 64 * portraitZoom(wm.tall, wm);
  const shown = portraitShown(body) / body;
  const row = pm.footY - pm.px * (1 - shown) + pm.px * 0.05 + 4;
  const sprites: Sprite[] = [];
  const clips: PortraitSet['clips'] = {};
  const seen = new Set<string>();
  for (const clip of CLIPS) {
    const files = pm.clips[clip]?.down ?? [];
    clips[clip] = { down: files.map((f) => `${id}/${f.replace(/\.png$/, '')}`) };
    for (const f of files) {
      if (seen.has(f)) continue;
      seen.add(f);
      const img = await load(join(dir, f));
      cutBelow(img, row);
      sprites.push(trim(`${id}/${f.replace(/\.png$/, '')}`, img));
    }
  }
  const pages = await writeAtlas(sprites, OUT, `${id}_talk`, true, {}, QUALITY);
  if (pages.length !== 1) return `${pages.length} pages`;
  return { page: pages[0]!, w: pm.w, h: pm.h, footY: pm.footY, px: pm.px, clips };
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const oi = argv.indexOf('--only');
  const only = oi >= 0 ? new Set(argv[oi + 1]!.split(',')) : null;
  const indexFile = join(OUT, 'index.json');
  const index: { sets: Record<string, PortraitSet> } =
    only && existsSync(indexFile) ? JSON.parse(readFileSync(indexFile, 'utf8')) : { sets: {} };
  mkdirSync(OUT, { recursive: true });
  const stage = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'portraits-'));
  const ids = readdirSync(WORLD)
    .filter((id) => existsSync(join(WORLD, id, 'meta.json')) && (!only || only.has(id)))
    .sort();
  const skipped: string[] = [];
  for (const id of ids) {
    delete index.sets[id];
    let r: PortraitSet | string;
    try {
      r = await portrait(id, stage);
    } catch (e) {
      r = (e as Error).message;
    }
    if (typeof r === 'string') {
      skipped.push(`${id}: ${r}`);
      for (const f of [`${id}_talk-0.webp`, `${id}_talk-0.json`]) if (existsSync(join(OUT, f))) rmSync(join(OUT, f));
      continue;
    }
    index.sets[id] = r;
    console.log(`${id}: ${r.px} px a figure`);
  }
  const sorted = Object.fromEntries(Object.entries(index.sets).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(indexFile, JSON.stringify({ sets: sorted }, null, 1) + '\n');
  rmSync(stage, { recursive: true, force: true });
  console.log(`portraits: ${Object.keys(sorted).length} made, ${skipped.length} left to their world frames`);
  for (const s of skipped) console.log(`  ${s}`);
}
