// Atlas packing: processed frames and icons into lossless WebP pages with Phaser 3 "JSON Hash" atlases.
//   node tools/art/pack.ts [--src art/src] [--out public/assets]
//   node tools/art/pack.ts --add-objects id,id   repack the shared additions pages of an existing atlas
// Characters: <src>/chars/<id>/ -> <out>/chars/<id>-<page>.webp/.json (each character its own tight page, so a
// visitor never pulls in anybody else's frames) and <out>/chars/index.json.
// Flat sets: <src>/items, <src>/objects, <src>/ui -> <out>/atlas/<set>-<page>.webp/.json and <out>/atlas/index.json.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { alphaBox, blank, crop, type Img, load, toSharp } from './imgutil.ts';
import type { CharMeta } from './process.ts';

const ROOT = new URL('../../', import.meta.url).pathname;
const PAGE = 2048;
// No gap between sprites: the 1 px extruded edge is all bilinear filtering ever reads (no mipmaps are made).
const PAD = 0;
const EXTRUDE = 1;
/** Clips only the hero being played ever shows (swinging, fishing, sleeping, sitting, getting hurt). */
const LAZY_CLIPS = ['swing', 'hurt', 'fish', 'sleep', 'sit'];

export interface Sprite {
  name: string;
  img: Img;
  /** trim offset inside the source canvas */
  sx: number;
  sy: number;
  srcW: number;
  srcH: number;
}
interface Placed extends Sprite {
  page: number;
  x: number;
  y: number;
}

export function trim(name: string, src: Img): Sprite {
  const b = alphaBox(src) ?? { x0: 0, y0: 0, x1: 1, y1: 1 };
  return { name, img: crop(src, b), sx: b.x0, sy: b.y0, srcW: src.w, srcH: src.h };
}

/** Shelf packing into pages `width` wide, tallest first, then by name: deterministic. */
function shelfPack(sprites: Sprite[], width = PAGE): { placed: Placed[]; sizes: { w: number; h: number }[] } {
  const order = [...sprites].sort((a, b) => b.img.h - a.img.h || a.name.localeCompare(b.name));
  const placed: Placed[] = [];
  const sizes: { w: number; h: number }[] = [];
  let page = 0;
  let x = 0;
  let y = 0;
  let shelf = 0;
  for (const s of order) {
    const sw = s.img.w + EXTRUDE * 2;
    const sh = s.img.h + EXTRUDE * 2;
    if (sw > width || sh > PAGE) throw new Error(`${s.name}: ${s.img.w} x ${s.img.h} does not fit a ${width} page`);
    if (x + sw > width) {
      x = 0;
      y += shelf + PAD;
      shelf = 0;
    }
    if (y + sh > PAGE) {
      page++;
      x = 0;
      y = 0;
      shelf = 0;
    }
    placed.push({ ...s, page, x: x + EXTRUDE, y: y + EXTRUDE });
    const size = (sizes[page] ??= { w: 0, h: 0 });
    size.w = Math.max(size.w, x + sw);
    size.h = Math.max(size.h, y + sh);
    x += sw + PAD;
    shelf = Math.max(shelf, sh);
  }
  return { placed, sizes };
}

/** Copy the sprite in and repeat its edge pixels outward by EXTRUDE, so filtering never samples a neighbour. */
function blitExtruded(page: Img, s: Placed): void {
  const { img } = s;
  for (let y = -EXTRUDE; y < img.h + EXTRUDE; y++) {
    const sy = Math.min(img.h - 1, Math.max(0, y));
    for (let x = -EXTRUDE; x < img.w + EXTRUDE; x++) {
      const sx = Math.min(img.w - 1, Math.max(0, x));
      const i = (sy * img.w + sx) * 4;
      const t = ((s.y + y) * page.w + (s.x + x)) * 4;
      page.d[t] = img.d[i]!;
      page.d[t + 1] = img.d[i + 1]!;
      page.d[t + 2] = img.d[i + 2]!;
      page.d[t + 3] = img.d[i + 3]!;
    }
  }
}

/** Bytes the GPU holds for a packing (pages rounded up to 4 px as written). */
function packBytes(sizes: { w: number; h: number }[]): number {
  return sizes.reduce((n, z) => n + Math.ceil(z.w / 4) * 4 * Math.ceil(z.h / 4) * 4 * 4, 0);
}

/** The shelf packing with the fewest resident bytes over page widths from the widest sprite to PAGE. */
function tightPack(sprites: Sprite[], preferFewerPages = false): ReturnType<typeof shelfPack> {
  const widest = Math.max(...sprites.map((s) => s.img.w + EXTRUDE * 2));
  let best = shelfPack(sprites);
  let bestBytes = packBytes(best.sizes);
  for (let w = Math.ceil(widest / 4) * 4; w < PAGE; w += 4) {
    const p = shelfPack(sprites, w);
    const b = packBytes(p.sizes);
    const fewer = preferFewerPages && p.sizes.length < best.sizes.length;
    if (fewer || ((!preferFewerPages || p.sizes.length === best.sizes.length) && b < bestBytes)) {
      best = p;
      bestBytes = b;
    }
  }
  return best;
}

/**
 * Pack the sprites into <dir>/<prefix>-<n>.webp + .json; returns the page names.
 * `aliases` adds frame names that point at another frame of the same page (a stand-in pose for a frame kept elsewhere).
 */
export async function writeAtlas(
  sprites: Sprite[],
  dir: string,
  prefix: string,
  tight: boolean | 'shared' = false,
  aliases: Record<string, string> = {},
  /** lossy WebP at this quality (the talk portraits); 0 keeps every page lossless */
  quality = 0,
): Promise<string[]> {
  const { placed, sizes } = tight ? tightPack(sprites, tight === 'shared') : shelfPack(sprites);
  const names: string[] = [];
  mkdirSync(dir, { recursive: true });
  for (let p = 0; p < sizes.length; p++) {
    const size = sizes[p]!;
    const w = Math.ceil(size.w / 4) * 4;
    const h = Math.ceil(size.h / 4) * 4;
    const page = blank(w, h);
    const frames: Record<string, unknown> = {};
    for (const s of placed.filter((q) => q.page === p).sort((a, b) => a.name.localeCompare(b.name))) {
      blitExtruded(page, s);
      frames[s.name] = {
        frame: { x: s.x, y: s.y, w: s.img.w, h: s.img.h },
        rotated: false,
        trimmed: s.img.w !== s.srcW || s.img.h !== s.srcH,
        spriteSourceSize: { x: s.sx, y: s.sy, w: s.img.w, h: s.img.h },
        sourceSize: { w: s.srcW, h: s.srcH },
      };
    }
    for (const [alias, target] of Object.entries(aliases)) if (frames[target]) frames[alias] = frames[target];
    const name = `${prefix}-${p}`;
    await toSharp(page)
      .webp(
        quality
          ? { quality, alphaQuality: 100, smartSubsample: true, effort: 6 }
          : { lossless: true, exact: true, effort: 6 },
      )
      .toFile(join(dir, `${name}.webp`));
    const json = {
      frames,
      meta: {
        app: 'wishing-star tools/art/pack.ts',
        version: '1',
        image: `${name}.webp`,
        format: 'RGBA8888',
        size: { w, h },
        scale: '1',
      },
    };
    writeFileSync(join(dir, `${name}.json`), JSON.stringify(json) + '\n');
    names.push(name);
  }
  return names;
}

/** Remove pages of a prefix left over from an earlier, larger run. */
function dropStale(dir: string, prefix: string, keep: string[]): void {
  if (!existsSync(dir)) return;
  const re = new RegExp(`^${prefix}-\\d+\\.(webp|json)$`);
  for (const f of readdirSync(dir)) if (re.test(f) && !keep.includes(f.replace(/\.\w+$/, ''))) rmSync(join(dir, f));
}

export async function packChars(srcRoot: string, outRoot: string): Promise<void> {
  const src = join(srcRoot, 'chars');
  const out = join(outRoot, 'chars');
  const ids = existsSync(src)
    ? readdirSync(src)
        .filter((id) => existsSync(join(src, id, 'meta.json')))
        .sort()
    : [];
  if (!ids.length) {
    console.log(`no characters under ${src}`);
    return;
  }
  const metas = ids.map((id) => JSON.parse(readFileSync(join(src, id, 'meta.json'), 'utf8')) as CharMeta);
  const index: {
    groups: Record<string, string[]>;
    lazy: Record<string, { pages: string[]; frames: string[] }>;
    sets: Record<string, unknown>;
  } = { groups: {}, lazy: {}, sets: {} };
  const keep: string[] = [];
  let bytes = 0;
  const frameName = (m: CharMeta, f: string) => `${m.id}/${f.replace(/\.png$/, '')}`;
  for (const m of metas) {
    // A hero's play-only clips go on a page of their own, loaded only while that hero is played; everywhere else
    // (a hero met as a friend) they are never shown. Their names stay on the main page as stand-in poses.
    const split = !!m.clips.fish;
    const coreFiles = new Set<string>();
    for (const [clip, facings] of Object.entries(m.clips))
      if (!split || !LAZY_CLIPS.includes(clip))
        for (const files of Object.values(facings)) for (const f of files ?? []) coreFiles.add(f);
    const core: Sprite[] = [];
    const lazy: Sprite[] = [];
    const aliases: Record<string, string> = {};
    // a clip drawn with another clip's frames (an alias) lists the same files: pack each once
    const done = new Set<string>();
    for (const [clip, facings] of Object.entries(m.clips))
      for (const [facing, files] of Object.entries(facings))
        for (const f of files ?? []) {
          const name = frameName(m, f);
          if (done.has(name)) continue;
          done.add(name);
          const sprite = trim(name, await load(join(src, m.id, f)));
          if (coreFiles.has(f)) core.push(sprite);
          else {
            lazy.push(sprite);
            const idle = m.clips.idle?.[facing as 'down'] ?? m.clips.idle?.down ?? [];
            if (idle[0]) aliases[name] = frameName(m, idle[0]);
            else throw new Error(`${m.id}: ${clip} needs an idle frame to stand in for it`);
          }
        }
    const pages = await writeAtlas(core, out, m.id, true, aliases);
    const lazyPages = lazy.length ? await writeAtlas(lazy, out, `${m.id}_x`, true) : [];
    // the extra page comes first, so a frame is found there (the real pose) before its stand-in on the main page
    index.groups[m.id] = [...lazyPages, ...pages];
    if (lazyPages.length) index.lazy[m.id] = { pages: lazyPages, frames: lazy.map((q) => q.name).sort() };
    keep.push(...pages, ...lazyPages);
    for (const p of pages) {
      const size = (
        JSON.parse(readFileSync(join(out, `${p}.json`), 'utf8')) as { meta: { size: { w: number; h: number } } }
      ).meta.size;
      bytes += size.w * size.h * 4;
    }
  }
  // pages of earlier runs (the old region groups, or a character that shrank) go
  for (const f of readdirSync(out))
    if (/\.(webp|json)$/.test(f) && f !== 'index.json' && !keep.includes(f.replace(/\.\w+$/, ''))) rmSync(join(out, f));
  console.log(`chars: ${metas.length} characters, ${(bytes / 1048576).toFixed(1)} MB of main pages if all were in`);
  for (const m of metas) {
    const clips: Record<string, Record<string, string[]>> = {};
    for (const [clip, facings] of Object.entries(m.clips))
      for (const [facing, files] of Object.entries(facings))
        (clips[clip] ??= {})[facing] = (files ?? []).map((f) => `${m.id}/${f.replace(/\.png$/, '')}`);
    index.sets[m.id] = {
      group: m.id,
      tall: m.tall,
      w: m.w,
      h: m.h,
      footY: m.footY,
      px: m.px,
      clips,
      ...(m.timing ? { timing: m.timing } : {}),
    };
  }
  writeFileSync(join(out, 'index.json'), JSON.stringify(index, null, 2) + '\n');
}

export async function packFlat(srcRoot: string, outRoot: string): Promise<void> {
  const out = join(outRoot, 'atlas');
  const index: Record<string, unknown> = {};
  const frames: Record<string, Record<string, [number, number]>> = {};
  let any = false;
  for (const set of ['items', 'objects', 'ui']) {
    const dir = join(srcRoot, set);
    const files = existsSync(dir)
      ? readdirSync(dir)
          .filter((f) => f.endsWith('.png'))
          .sort()
      : [];
    index[set] = [];
    frames[set] = {};
    if (!files.length) continue;
    any = true;
    const sprites: Sprite[] = [];
    for (const f of files) {
      const s = trim(f.replace(/\.png$/, ''), await load(join(dir, f)));
      sprites.push(s);
      frames[set]![s.name] = [s.srcW, s.srcH];
    }
    const pages = await writeAtlas(sprites, out, set);
    dropStale(out, set, pages);
    index[set] = pages;
    console.log(`atlas ${set}: ${sprites.length} images on ${pages.length} page(s)`);
  }
  if (!any) return;
  index.frames = frames;
  writeFileSync(join(out, 'index.json'), JSON.stringify(index, null, 2) + '\n');
}

/** Add new object paintings without moving the already shipped frames or re-encoding unrelated pages. */
async function addObjects(src: string, out: string, ids: string[]): Promise<void> {
  const dir = join(out, 'atlas');
  const indexFile = join(dir, 'index.json');
  const index = JSON.parse(readFileSync(indexFile, 'utf8')) as {
    objects: string[];
    frames: { objects: Record<string, [number, number]> };
  };
  const prefix = 'objects-extra';
  const group = new Set<string>();
  const previous = index.objects.filter((page) => page.startsWith(prefix + '-'));
  for (const page of previous) {
    const data = JSON.parse(readFileSync(join(dir, page + '.json'), 'utf8'));
    for (const key of Object.keys(data.frames)) group.add(key);
  }
  for (const name of ids) {
    if (index.frames.objects[name] && !group.has(name)) throw new Error(`Frame already on a base page: ${name}`);
    group.add(name);
  }
  const sprites: Sprite[] = [];
  for (const name of [...group].sort()) {
    const img = await load(join(src, 'objects', name + '.png'));
    sprites.push(trim(name, img));
    index.frames.objects[name] = [img.w, img.h];
  }
  const pages = await writeAtlas(sprites, dir, prefix, 'shared');
  index.objects = [...index.objects.filter((page) => !previous.includes(page)), ...pages];
  writeFileSync(indexFile, JSON.stringify(index, null, 2) + '\n');
  dropStale(dir, prefix, pages);
  console.log(`atlas additions: ${sprites.length} object pictures on ${pages.length} shared page(s)`);
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const opt = (name: string, d: string) => {
    const i = argv.indexOf(`--${name}`);
    return resolve(ROOT, i >= 0 ? argv[i + 1]! : d);
  };
  const src = opt('src', 'art/src');
  const out = opt('out', 'public/assets');
  const add = argv.indexOf('--add-objects');
  if (add >= 0) await addObjects(src, out, (argv[add + 1] ?? '').split(',').filter(Boolean));
  else {
    await packChars(src, out);
    await packFlat(src, out);
  }
}
