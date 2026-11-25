// A local-only fallback for a rejected or off-model character sheet. It colours existing, approved
// frames; it never invents a pose or sends a character image to an image generator.
//
//  node tools/art/cast-finish.ts anchor --ids peppa,buzz --baseline art/src --atlas public/assets --out "$TMPDIR/cast-anchor.json"
//  node tools/art/cast-finish.ts apply --anchor "$TMPDIR/cast-anchor.json" --plate /path/to/plate.png --out "$TMPDIR/cast-stage"
//
// The anchor records every input byte, including the current atlas and index. Apply verifies it
// before staging. The output has src/chars/<id>, assets/chars/<selected pages>, and a complete
// merged index. It NEVER writes into the baseline. Review the staged animation before installing it.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import sharp from 'sharp';
import { cast, type ArtBody, type ArtStyle } from './cast.ts';
import { alphaBox, blank, components, load, over, resize, savePng, type Img } from './imgutil.ts';
import { packChars } from './pack.ts';
import type { CharMeta } from './process.ts';

type Material = 'cel' | 'felt' | 'vinyl' | 'voxel' | 'textile' | 'plastic';
type StyleProfile = {
  material: Material;
  head: number;
  amount: number;
  flat?: boolean;
  volume?: number;
  helmet?: boolean;
  leatherBoots?: boolean;
  slinkySurfaces?: boolean;
  minionSurfaces?: boolean;
  horseSurfaces?: boolean;
};
type Tile = { w: number; h: number; luminance: Float32Array; mean: number; deviation: number };
export type MaterialPlate = Record<Material, Tile>;
type AtlasIndex = {
  groups: Record<string, string[]>;
  lazy: Record<string, unknown>;
  sets: Record<string, unknown>;
};
type Anchor = {
  version: 1;
  baseline: string;
  atlas: string;
  ids: string[];
  files: Record<string, string>;
};

const STYLE: Record<ArtStyle, StyleProfile> = {
  person: { material: 'textile', head: 0.49, amount: 22 },
  toy: { material: 'vinyl', head: 0.48, amount: 32, volume: 1 },
  show: { material: 'cel', head: 0.5, amount: 20 },
  block: { material: 'voxel', head: 0.43, amount: 12, flat: true },
  kawaii: { material: 'cel', head: 0.7, amount: 10, flat: true },
  crayon: { material: 'cel', head: 0.55, amount: 10, flat: true },
};
// Further restrict the candidate area where a character's face occupies more of the silhouette.
// Plush and shiny toys take their own swatches. These are image masks, not likeness descriptions.
const BY_ID: Record<string, Partial<StyleProfile>> = {
  amelia: { head: 0.5, material: 'textile' },
  buzz: { head: 0.43, material: 'plastic', volume: 1.15, helmet: true },
  peppa: { head: 0.55 },
  george: { head: 0.56 },
  hello_kitty: { head: 0.71 },
  kuromi: { head: 0.71 },
  koala: { material: 'felt', head: 0.58, volume: 0.7 },
  flop: { material: 'felt', head: 0.54, volume: 0.7 },
  woody: { material: 'textile', head: 0.42, volume: 0.8, leatherBoots: true },
  jessie: { material: 'textile', head: 0.45, volume: 0.8, leatherBoots: true },
  slinky: { material: 'plastic', amount: 32, volume: 1, slinkySurfaces: true },
  bullseye: { material: 'vinyl', amount: 32, volume: 1, horseSurfaces: true },
  bob: { material: 'plastic', amount: 32, volume: 1, minionSurfaces: true },
  stuart: { material: 'plastic', amount: 32, volume: 1, minionSurfaces: true },
  minion_d: { material: 'plastic', amount: 32, volume: 1, minionSurfaces: true },
  minion_e: { material: 'plastic', amount: 32, volume: 1, minionSurfaces: true },
  zombie: { head: 0.43 },
};
const BODY_HEAD: Record<ArtBody, number> = { biped: 0, quad: 0.5, bird: 0.57, blob: 0.58, spider: 0.6 };

export function profileFor(id: string, style: ArtStyle, body: ArtBody): StyleProfile {
  const p = { ...STYLE[style], ...BY_ID[id] };
  p.head = Math.max(p.head, BODY_HEAD[body]);
  return p;
}

const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const ramp = (v: number, from: number, to: number) => {
  const t = Math.max(0, Math.min(1, (v - from) / (to - from)));
  return t * t * (3 - 2 * t);
};

/** A broad skin exclusion, also used on exposed hands. An excluded colour is left byte-for-byte alone. */
export function isSkin(r: number, g: number, b: number): boolean {
  return r >= 95 && r > g + 8 && g > b + 9 && r - g < 90 && g - b < 90 && r > b * 1.18;
}

/** Resample six generated neutral swatches; discard their colours and retain only relative light. */
export async function readPlate(file: string): Promise<MaterialPlate> {
  const img = await load(file);
  assert.ok(img.w >= 96 && img.h >= 96, 'material plate must be at least 96 x 96');
  const names: Material[] = ['cel', 'felt', 'vinyl', 'voxel', 'textile', 'plastic'];
  const tiles = {} as MaterialPlate;
  for (let n = 0; n < names.length; n++) {
    const col = n % 3;
    const row = Math.floor(n / 3);
    // Stay inside a cell, away from any generated join between swatches.
    const x0 = Math.floor(((col + 0.05) * img.w) / 3);
    const x1 = Math.floor(((col + 0.95) * img.w) / 3);
    const y0 = Math.floor(((row + 0.05) * img.h) / 2);
    const y1 = Math.floor(((row + 0.95) * img.h) / 2);
    const d = new Uint8Array((x1 - x0) * (y1 - y0) * 4);
    for (let y = y0; y < y1; y++) {
      const from = (y * img.w + x0) * 4;
      d.set(img.d.subarray(from, from + (x1 - x0) * 4), (y - y0) * (x1 - x0) * 4);
    }
    const tile = await resize({ w: x1 - x0, h: y1 - y0, d }, 96, 96);
    const light = new Float32Array(tile.w * tile.h);
    let total = 0;
    for (let i = 0; i < light.length; i++) {
      assert.ok(tile.d[i * 4 + 3]! >= 240, 'material plate must be opaque');
      light[i] = luma(tile.d[i * 4]!, tile.d[i * 4 + 1]!, tile.d[i * 4 + 2]!);
      total += light[i]!;
    }
    const mean = total / light.length;
    const deviation = Math.sqrt(light.reduce((sum, v) => sum + (v - mean) ** 2, 0) / light.length);
    tiles[names[n]!] = { w: tile.w, h: tile.h, luminance: light, mean, deviation };
  }
  return tiles;
}

/** True only in an opaque, similarly coloured interior, never on an outline or fine detail. */
function safeInterior(img: Img, x: number, y: number, radius: number, leather = false): boolean {
  const i = (y * img.w + x) * 4;
  const r = img.d[i]!;
  const g = img.d[i + 1]!;
  const b = img.d[i + 2]!;
  // The pipeline's Lanczos/composite output often stores solid interiors at alpha 253.
  if (img.d[i + 3]! < 250 || luma(r, g, b) < (leather ? 30 : 52) || (!leather && isSkin(r, g, b))) return false;
  for (let dy = -radius; dy <= radius; dy++)
    for (let dx = -radius; dx <= radius; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= img.w || ny < 0 || ny >= img.h) return false;
      const q = (ny * img.w + nx) * 4;
      if (
        img.d[q + 3]! < 250 ||
        Math.abs(img.d[q]! - r) > 24 ||
        Math.abs(img.d[q + 1]! - g) > 24 ||
        Math.abs(img.d[q + 2]! - b) > 24
      )
        return false;
    }
  return true;
}

/** Narrow bands need an adjacent matching pixel, not an entire 3 x 3 patch. */
function matchingBandPixel(img: Img, x: number, y: number): boolean {
  const i = (y * img.w + x) * 4;
  const r = img.d[i]!;
  const g = img.d[i + 1]!;
  const b = img.d[i + 2]!;
  if (img.d[i + 3]! < 250) return false;
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || nx >= img.w || ny < 0 || ny >= img.h) continue;
    const q = (ny * img.w + nx) * 4;
    if (
      img.d[q + 3]! >= 250 &&
      Math.abs(img.d[q]! - r) <= 20 &&
      Math.abs(img.d[q + 1]! - g) <= 20 &&
      Math.abs(img.d[q + 2]! - b) <= 20
    )
      return true;
  }
  return false;
}

function metalInterior(img: Img, x: number, y: number): boolean {
  const i = (y * img.w + x) * 4;
  const rgb = [img.d[i]!, img.d[i + 1]!, img.d[i + 2]!];
  return (
    Math.min(...rgb) >= 90 &&
    Math.max(...rgb) <= 224 &&
    Math.max(...rgb) - Math.min(...rgb) <= 14 &&
    matchingBandPixel(img, x, y)
  );
}

/** Pixel geometry, alpha, edges, face area and original hues are retained. */
export function finishFrame(
  src: Img,
  plate: MaterialPlate,
  profile: StyleProfile,
  frameName = '',
): { img: Img; changed: number } {
  const img = { w: src.w, h: src.h, d: new Uint8Array(src.d) };
  const box = alphaBox(src, 96);
  assert.ok(box, 'empty character frame');
  const radius = Math.max(1, Math.min(2, Math.round((box.y1 - box.y0) / 100)));
  const mask = new Uint8Array(src.w * src.h);
  for (let y = box.y0; y < box.y1; y++) {
    const v = (y - box.y0) / Math.max(1, box.y1 - box.y0 - 1);
    for (let x = box.x0; x < box.x1; x++) {
      const u = (x - box.x0) / Math.max(1, box.x1 - box.x0 - 1);
      const i = (y * src.w + x) * 4;
      const r = src.d[i]!;
      const g = src.d[i + 1]!;
      const b = src.d[i + 2]!;
      // A dark brown boot is sometimes caught by the general skin exclusion. This narrow,
      // lower-body override does not include the lighter skin palette or the drawn outlines.
      const leather =
        profile.leatherBoots && v > 0.72 && r >= 55 && r < 175 && g < 120 && b < 100 && r > g * 1.2 && g > b * 1.1;
      // Slinky's paint has skin-like colours. Restrict it to the low body and saturated
      // orange/brown, leaving the paler muzzle, face details and upper head untouched.
      const dogPaint =
        profile.slinkySurfaces && v >= 0.65 && r >= 100 && g >= 45 && b < 110 && r > g * 1.2 && g > b * 1.4;
      const dogCoil =
        profile.slinkySurfaces &&
        (frameName.includes('_side_')
          ? u < 0.68 && v >= 0.4
          : frameName.includes('_down_')
            ? u < 0.35 && v >= 0.4
            : frameName.includes('_up_')
              ? v >= 0.48
              : v >= 0.65);
      const yellowPlastic = profile.minionSurfaces && r > 175 && g > 130 && b < 120 && r > b * 1.8 && g > b * 1.6;
      const blue = profile.minionSurfaces && b > r + 35 && b > g + 28 && r < 140;
      const denim = blue && v >= 0.52;
      const blueGoggle = blue && v < 0.52 && luma(r, g, b) >= 52;
      const goggleMetal = profile.minionSurfaces && v < 0.65;
      // The horse's head shares the chestnut palette with its body. Keep a facing-dependent
      // head exclusion and treat only the lower body, saddle and dark brown hoof interiors.
      const horseRegion = frameName.includes('_side_')
        ? (u < 0.7 && v >= 0.45) || v >= 0.75
        : frameName.includes('_down_')
          ? v >= 0.57
          : frameName.includes('_up_')
            ? v >= 0.53
            : v >= 0.75;
      const horsePaint =
        profile.horseSurfaces && horseRegion && r >= 70 && g >= 20 && b < 110 && r > g * 1.4 && g > b * 1.1;
      const horseLeather = horsePaint && r < 175 && g < 100;
      // Only the pale blue perimeter of this helmet is eligible above the face guard.
      const helmet =
        profile.helmet &&
        v < profile.head &&
        (v < 0.23 || u < 0.27 || u > 0.73) &&
        r > 95 &&
        r < 235 &&
        g > r + 2 &&
        b > r + 6 &&
        b > 150;
      const eligible = profile.slinkySurfaces
        ? dogPaint
        : profile.minionSurfaces
          ? yellowPlastic || denim
          : profile.horseSurfaces
            ? horsePaint
            : v >= profile.head || helmet;
      if (((dogCoil || goggleMetal) && metalInterior(src, x, y)) || (blueGoggle && matchingBandPixel(src, x, y)))
        mask[y * src.w + x] = 3;
      else if (eligible && safeInterior(src, x, y, radius, !!leather || !!dogPaint || !!horsePaint))
        mask[y * src.w + x] = helmet ? 2 : denim ? 4 : horseLeather ? 5 : 1;
    }
  }
  // Outlines and colour edges separate the mask into the existing surfaces: a chest plate,
  // sleeve, boot or helmet can each have its own gentle light rather than one image-wide tint.
  const regions = profile.volume ? components(mask, src.w, src.h) : null;
  let changed = 0;
  for (let y = box.y0; y < box.y1; y++) {
    const v = (y - box.y0) / Math.max(1, box.y1 - box.y0 - 1);
    for (let x = box.x0; x < box.x1; x++) {
      const pos = y * src.w + x;
      if (!mask[pos]) continue;
      const swatch = plate[mask[pos] === 4 ? 'textile' : mask[pos] === 5 ? 'plastic' : profile.material];
      const u = (x - box.x0) / Math.max(1, box.x1 - box.x0 - 1);
      let materialU = u;
      let materialV = (v - profile.head) / Math.max(0.01, 1 - profile.head);
      let model = 0;
      const region = regions?.blobs[(regions.labels[pos] ?? 0) - 1];
      if (region && region.area >= 20 && region.box.x1 - region.box.x0 >= 6 && region.box.y1 - region.box.y0 >= 6) {
        materialU = (x - region.box.x0) / Math.max(1, region.box.x1 - region.box.x0 - 1);
        materialV = (y - region.box.y0) / Math.max(1, region.box.y1 - region.box.y0 - 1);
        const highlight = Math.exp(-(((materialU - 0.28) / 0.32) ** 2 + ((materialV - 0.24) / 0.38) ** 2));
        const shadow = 18 * Math.max(0, materialU - 0.35) + 16 * Math.max(0, materialV - 0.4);
        model = (profile.volume ?? 0) * (18 * highlight - shadow);
      }
      const sx = Math.max(0, Math.min(swatch.w - 1, Math.round(materialU * (swatch.w - 1))));
      const sy = Math.max(0, Math.min(swatch.h - 1, Math.round(materialV * (swatch.h - 1))));
      const light = swatch.luminance[sy * swatch.w + sx]!;
      // The flat, voxel and mouthless styles receive only a uniform palette lift, with no new
      // texture or invented pixels. Its small strength is still derived from the generated swatch.
      const sample = profile.flat
        ? Math.max(0.7, Math.min(1.2, swatch.mean / 200))
        : -0.1 + Math.max(-1, Math.min(1, (light - swatch.mean) / Math.max(8, swatch.deviation * 2)));
      // Feather the position guards so they cannot draw a hard stripe across a continuous surface.
      const surfaceWeight = profile.horseSurfaces
        ? frameName.includes('_side_')
          ? Math.max(ramp(0.7 - u, 0, 0.12) * ramp(v, 0.45, 0.55), ramp(v, 0.75, 0.83))
          : frameName.includes('_down_')
            ? ramp(v, 0.57, 0.67)
            : frameName.includes('_up_')
              ? ramp(v, 0.53, 0.63)
              : ramp(v, 0.75, 0.83)
        : profile.slinkySurfaces && mask[pos] !== 3
          ? ramp(v, 0.65, 0.75)
          : 1;
      // Existing metal stripes retain their shape; a little extra neutral light reads as metal at game size.
      const metalLight = mask[pos] === 3 ? 10 : 0;
      const factor = 1 + ((profile.amount * sample + model + metalLight) * surfaceWeight) / 255;
      const i = (y * img.w + x) * 4;
      let did = false;
      for (let k = 0; k < 3; k++) {
        const next = Math.min(255, Math.max(0, Math.round(src.d[i + k]! * factor)));
        if (next !== src.d[i + k]) did = true;
        img.d[i + k] = next;
      }
      if (did) changed++;
    }
  }
  return { img, changed };
}

function digest(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function filesFor(id: string, baseline: string, atlas: string, index: AtlasIndex): string[] {
  const dir = join(baseline, 'chars', id);
  assert.ok(existsSync(dir), `${id}: missing baseline directory`);
  const names = readdirSync(dir)
    .filter((name) => name.endsWith('.png') || name === 'meta.json')
    .sort();
  assert.ok(names.includes('meta.json') && names.some((n) => n.endsWith('.png')), `${id}: missing meta or frames`);
  const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')) as CharMeta;
  assert.equal(meta.id, id, `${id}: meta id mismatch`);
  for (const facings of Object.values(meta.clips))
    for (const seq of Object.values(facings))
      for (const f of seq ?? []) {
        assert.equal(basename(f), f, `${id}: unsafe frame name`);
        assert.ok(names.includes(f), `${id}: missing ${f}`);
      }
  const pages = index.groups[id];
  assert.ok(pages?.length && index.sets[id], `${id}: missing atlas index entry`);
  for (const p of pages) assert.match(p, new RegExp(`^${id}(?:_x)?-\\d+$`), `${id}: unsafe page name`);
  return [
    ...names.map((f) => join(dir, f)),
    ...pages.flatMap((p) => [join(atlas, 'chars', `${p}.json`), join(atlas, 'chars', `${p}.webp`)]),
  ];
}

function readIndex(atlas: string): AtlasIndex {
  const data = JSON.parse(readFileSync(join(atlas, 'chars/index.json'), 'utf8')) as AtlasIndex;
  assert.ok(data.groups && data.lazy && data.sets, 'invalid atlas index');
  return data;
}

export function makeAnchor(ids: string[], baseline: string, atlas: string): Anchor {
  baseline = realpathSync(baseline);
  atlas = realpathSync(atlas);
  assert.ok(ids.length && new Set(ids).size === ids.length, 'give at least one unique id');
  const index = readIndex(atlas);
  const paths = [join(atlas, 'chars/index.json')];
  for (const id of ids) {
    assert.match(id, /^[a-z0-9_]+$/, 'invalid id');
    assert.ok(
      cast.some((c) => c.id === id),
      `${id}: unknown cast id`,
    );
    paths.push(...filesFor(id, baseline, atlas, index));
  }
  return { version: 1, baseline, atlas, ids, files: Object.fromEntries(paths.sort().map((p) => [p, digest(p)])) };
}

export function verifyAnchor(anchor: Anchor): void {
  assert.equal(anchor.version, 1, 'unsupported anchor');
  assert.deepEqual(
    makeAnchor(anchor.ids, anchor.baseline, anchor.atlas),
    anchor,
    'baseline or atlas changed since anchor',
  );
}

function isInside(path: string, parent: string): boolean {
  return path === parent || path.startsWith(parent + sep);
}

/** The output must be new and separate, so a second run cannot compound the changes. */
function createStage(path: string, anchor: Anchor): string {
  path = resolve(path);
  assert.ok(!existsSync(path), `output already exists: ${path}`);
  const dest = join(realpathSync(dirname(path)), basename(path));
  assert.ok(
    !isInside(dest, anchor.baseline) && !isInside(dest, anchor.atlas),
    'output must be separate from baseline and atlas',
  );
  mkdirSync(dest, { mode: 0o700 });
  return dest;
}

/** Nominal 1920 x 1080 world view: left is the source; right is the staged finish. */
async function makePreviews(source: string, target: string, meta: CharMeta, out: string): Promise<void> {
  const first = (clip: string, facing: 'down' | 'side' | 'up'): string | undefined => {
    const choices = meta.clips[clip];
    return choices?.[facing]?.[0] ?? choices?.down?.[0] ?? choices?.side?.[0] ?? choices?.up?.[0];
  };
  const poses = [
    ...new Set(
      [first('idle', 'down'), first('walk', 'side'), first('walk', 'up'), first('talk', 'down')].filter((x) => !!x),
    ),
  ];
  assert.ok(poses.length, `${meta.id}: no preview poses`);
  assert.ok(meta.px > 0 && meta.tall > 0, `${meta.id}: invalid game scale`);
  mkdirSync(out, { recursive: true });
  for (const multiplier of [1, 2]) {
    // World.ts uses camera zoom 1.25; Puppet uses tall * 64 / px before that zoom.
    const scale = ((meta.tall * 64) / meta.px) * 1.25 * multiplier;
    const w = Math.max(1, Math.round(meta.w * scale));
    const h = Math.max(1, Math.round(meta.h * scale));
    const gap = 12;
    const pageW = w + gap * 2;
    const pageH = poses.length * (h + gap) + gap;
    const background = (width: number, height: number): Img => {
      const img = blank(width, height);
      for (let i = 0; i < img.d.length; i += 4) img.d.set([103, 143, 94, 255], i);
      return img;
    };
    const left = background(pageW, pageH);
    const right = background(pageW, pageH);
    for (let row = 0; row < poses.length; row++) {
      for (const [dir, dest] of [
        [source, left],
        [target, right],
      ] as const) {
        const image = await sharp(join(dir, poses[row]!))
          .ensureAlpha()
          .resize(w, h, { kernel: 'linear' })
          .raw()
          .toBuffer();
        over(
          dest,
          { w, h, d: new Uint8Array(image.buffer, image.byteOffset, image.length) },
          gap,
          gap + row * (h + gap),
        );
      }
    }
    const comparison = background(pageW * 2, pageH);
    over(comparison, left, 0, 0);
    over(comparison, right, pageW, 0);
    await savePng(comparison, join(out, `${meta.id}-${multiplier}x.png`));
    if (multiplier === 1) {
      const pages = blank(pageW, pageH * 2);
      over(pages, left, 0, 0);
      over(pages, right, 0, pageH);
      await sharp(Buffer.from(pages.d), { raw: { width: pageW, height: pageH * 2, channels: 4, pageHeight: pageH } })
        .gif({ delay: [900, 900], loop: 0, dither: 0, effort: 3, keepDuplicateFrames: true })
        .toFile(join(out, `${meta.id}-blink.gif`));
    }
  }
}

export async function apply(anchor: Anchor, plateFile: string, out: string): Promise<void> {
  verifyAnchor(anchor);
  const plateHash = digest(plateFile);
  const plate = await readPlate(plateFile);
  const stage = createStage(out, anchor);
  const stats: Record<string, { frames: number; changedPixels: number; unchangedFrames: string[] }> = {};
  for (const id of anchor.ids) {
    const c = cast.find((x) => x.id === id)!;
    const profile = profileFor(id, c.style, c.body);
    const source = join(anchor.baseline, 'chars', id);
    const target = join(stage, 'src/chars', id);
    mkdirSync(target, { recursive: true });
    copyFileSync(join(source, 'meta.json'), join(target, 'meta.json'));
    let frames = 0;
    let changedPixels = 0;
    const unchangedFrames: string[] = [];
    for (const name of readdirSync(source)
      .filter((f) => f.endsWith('.png'))
      .sort()) {
      const original = await load(join(source, name));
      const result = finishFrame(original, plate, profile, name);
      await savePng(result.img, join(target, name));
      const saved = await load(join(target, name));
      assert.equal(saved.w, original.w, `${id}/${name}: width changed`);
      assert.equal(saved.h, original.h, `${id}/${name}: height changed`);
      for (let i = 3; i < original.d.length; i += 4)
        assert.equal(saved.d[i], original.d[i], `${id}/${name}: alpha changed at ${i >> 2}`);
      frames++;
      changedPixels += result.changed;
      if (!result.changed) unchangedFrames.push(name);
    }
    assert.ok(changedPixels > 0, `${id}: no safe interior pixels changed; manual review needed`);
    stats[id] = { frames, changedPixels, unchangedFrames };
    const meta = JSON.parse(readFileSync(join(source, 'meta.json'), 'utf8')) as CharMeta;
    await makePreviews(source, target, meta, join(stage, 'previews'));
    console.log(
      `${id}: ${frames} frames, ${changedPixels} interior pixels changed, ${unchangedFrames.length} unchanged, ${profile.material}${profile.flat ? ' flat' : ''}`,
    );
  }

  // packChars may delete stale pages, so only ever give it the newly created isolated stage.
  verifyAnchor(anchor);
  await packChars(join(stage, 'src'), join(stage, 'assets'));
  const previous = readIndex(anchor.atlas);
  const packed = readIndex(join(stage, 'assets'));
  for (const id of anchor.ids) {
    assert.ok(isDeepStrictEqual(previous.groups[id], packed.groups[id]), `${id}: atlas page layout changed`);
    assert.ok(isDeepStrictEqual(previous.lazy[id], packed.lazy[id]), `${id}: lazy frames changed`);
    assert.ok(isDeepStrictEqual(previous.sets[id], packed.sets[id]), `${id}: dimensions, clips or timing changed`);
    for (const p of packed.groups[id]!) {
      const before = JSON.parse(readFileSync(join(anchor.atlas, 'chars', `${p}.json`), 'utf8'));
      const after = JSON.parse(readFileSync(join(stage, 'assets/chars', `${p}.json`), 'utf8'));
      assert.ok(isDeepStrictEqual(before.frames, after.frames), `${p}: packed frame geometry changed`);
      assert.ok(isDeepStrictEqual(before.meta.size, after.meta.size), `${p}: texture footprint changed`);
    }
    previous.groups[id] = packed.groups[id]!;
    previous.sets[id] = packed.sets[id]!;
    if (packed.lazy[id]) previous.lazy[id] = packed.lazy[id];
    else delete previous.lazy[id];
  }
  verifyAnchor(anchor);
  assert.equal(digest(plateFile), plateHash, 'material plate changed during processing');
  writeFileSync(join(stage, 'assets/chars/index.json'), `${JSON.stringify(previous, null, 2)}\n`);
  writeFileSync(
    join(stage, 'cast-finish-report.json'),
    `${JSON.stringify({ anchor, plate: plateHash, stats }, null, 2)}\n`,
  );
  console.log(`CAST FINISH PASS: ${stage}`);
}

async function main(): Promise<void> {
  const [mode, ...args] = process.argv.slice(2);
  const opt = (name: string): string => {
    const i = args.indexOf(`--${name}`);
    assert.ok(i >= 0 && args[i + 1] && !args[i + 1]!.startsWith('--'), `missing --${name}`);
    return args[i + 1]!;
  };
  if (mode === 'anchor') {
    const anchor = makeAnchor(opt('ids').split(','), opt('baseline'), opt('atlas'));
    const requested = resolve(opt('out'));
    const out = join(realpathSync(dirname(requested)), basename(requested));
    assert.ok(
      !isInside(out, anchor.baseline) && !isInside(out, anchor.atlas),
      'anchor must be separate from baseline and atlas',
    );
    writeFileSync(out, `${JSON.stringify(anchor, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    console.log(`CAST ANCHOR PASS: ${anchor.ids.join(',')}`);
  } else if (mode === 'apply') {
    const anchor = JSON.parse(readFileSync(resolve(opt('anchor')), 'utf8')) as Anchor;
    await apply(anchor, resolve(opt('plate')), opt('out'));
  } else if (mode === 'verify') {
    const anchor = JSON.parse(readFileSync(resolve(opt('anchor')), 'utf8')) as Anchor;
    verifyAnchor(anchor);
    console.log(`CAST ANCHOR PASS: ${anchor.ids.join(',')}`);
  } else {
    throw new Error(
      'usage: cast-finish.ts anchor --ids a,b --baseline art/src --atlas public/assets --out anchor.json | apply --anchor anchor.json --plate plate.png --out new-stage | verify --anchor anchor.json',
    );
  }
}

if (import.meta.main) await main();
