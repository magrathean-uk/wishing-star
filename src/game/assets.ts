// Art loading: atlases decoded off the main thread, one upload a frame, with coded stand-ins for anything not drawn yet.
import Phaser from 'phaser';

export const BASE = `${import.meta.env.BASE_URL}assets/`;

/**
 * The Magrathean mark (the website's white logo) for the title's watermark: G's own brand, not show art. `size` is its
 * height on the 1920 x 1080 game screen (the SVG is drawn at twice that, crisp on the largest drawing buffer); `alpha`
 * keeps it a light watermark.
 */
export const BRAND = { key: 'brand_magrathean', url: `${BASE}brand/magrathean.svg`, size: 72, alpha: 0.45 };

export interface AnimSetDef {
  group: string;
  tall: number;
  w: number;
  h: number;
  footY: number;
  px: number;
  clips: Record<string, Record<string, string[]>>;
  /** Seconds per frame and foot contacts; a facing may override contacts when its drawings differ. */
  timing?: Record<
    string,
    {
      durs: number[];
      dursByFacing?: Partial<Record<'down' | 'side' | 'up', number[]>>;
      step?: number[];
      stepByFacing?: Partial<Record<'down' | 'side' | 'up', number[]>>;
    }
  >;
}
interface CharIndex {
  groups: Record<string, string[]>;
  /** pages a character needs only while played as the hero, with the frame names on them */
  lazy?: Record<string, { pages: string[]; frames: string[] }>;
  sets: Record<string, AnimSetDef>;
}
/** Talk box portraits (tools/art/portraits.ts): idle and talk facing down at the masters' full detail, one page each. */
export interface PortraitDef {
  page: string;
  w: number;
  h: number;
  footY: number;
  px: number;
  clips: Record<string, Record<string, string[]>>;
}
interface AtlasIndex {
  items: string[];
  objects: string[];
  ui: string[];
  frames: Record<string, Record<string, [number, number]>>;
}
interface GroundIndex {
  chunk: number;
  areas: Record<string, { cw: number; ch: number; sets: string[] }>;
}

export const art = {
  chars: { groups: {}, sets: {} } as CharIndex,
  portraits: { sets: {} } as { sets: Record<string, PortraitDef> },
  atlas: { items: [], objects: [], ui: [], frames: {} } as AtlasIndex,
  ground: { chunk: 1024, areas: {} } as GroundIndex,
  /** frame name to atlas page key, for items, objects and ui */
  where: {} as Record<string, string>,
  /**
   * package 67: frame name to page for world objects only. Some names are both an item icon and a furniture picture
   * (chest): the bag and menus show the icon (where), the world shows the furniture (objWhere), whichever page
   * loads first.
   */
  objWhere: {} as Record<string, string>,
  /** resident texture bytes by kind, for the frame gate */
  bytes: { chars: 0, ground: 0, other: 0 },
};

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}
async function getBitmap(url: string): Promise<ImageBitmap | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return await createImageBitmap(await r.blob());
  } catch {
    return null;
  }
}

/** Read the index files. Missing ones mean "no art yet": the game runs on stand-ins. */
export async function loadIndexes(): Promise<void> {
  const [c, a, g, p] = await Promise.all([
    getJson<CharIndex>(`${BASE}chars/index.json`),
    getJson<AtlasIndex>(`${BASE}atlas/index.json`),
    getJson<GroundIndex>(`${BASE}ground/index.json`),
    getJson<{ sets: Record<string, PortraitDef> }>(`${BASE}portraits/index.json`),
  ]);
  if (c) art.chars = c;
  if (p) art.portraits = p;
  if (a) art.atlas = { ...art.atlas, ...a };
  if (g) art.ground = g;
}

// ---------------------------------------------------------------- one upload a frame

type Job = () => void;
const uploads: Job[] = [];
/** Call once a frame: hands at most one decoded picture to the GPU. */
export function pumpUploads(): void {
  const job = uploads.shift();
  if (job) job();
}
export function uploadsWaiting(): number {
  return uploads.length;
}

const wanted = new Set<string>();
const loaded = new Set<string>();

/** Load an atlas page (image + Phaser JSON hash) without stalling a frame. */
export function loadAtlas(
  scene: Phaser.Scene,
  key: string,
  dir: string,
  kind: keyof typeof art.bytes,
  done?: () => void,
  failed?: () => void,
): void {
  if (loaded.has(key) || wanted.has(key)) {
    if (loaded.has(key) && done) done();
    return;
  }
  wanted.add(key);
  void Promise.all([getBitmap(`${BASE}${dir}/${key}.webp`), getJson<object>(`${BASE}${dir}/${key}.json`)]).then(
    ([bmp, json]) => {
      if (!bmp || !json) {
        bmp?.close();
        wanted.delete(key);
        failed?.();
        return;
      }
      uploads.push(() => {
        if (!scene.sys.game || scene.textures.exists(key)) return;
        scene.textures.addAtlas(key, bmp as unknown as HTMLImageElement, json);
        art.bytes[kind] += bmp.width * bmp.height * 4;
        loaded.add(key);
        wanted.delete(key);
        // a burst of new faces (one cutscene's cast after another's) frees the last cast now, not a second later
        if (kind === 'chars') sweepChars(scene, heroSet);
        if (done) done();
      });
    },
  );
}
export function unloadAtlas(scene: Phaser.Scene, key: string, kind: keyof typeof art.bytes): void {
  if (!loaded.has(key)) return;
  const t = scene.textures.get(key);
  const img = t.getSourceImage() as { width: number; height: number };
  art.bytes[kind] -= img.width * img.height * 4;
  scene.textures.remove(key);
  loaded.delete(key);
}
export function isLoaded(key: string): boolean {
  return loaded.has(key);
}

/** What is resident now, page by page, for the frame gate's breakdown. */
export function residentReport(scene: Phaser.Scene): { pages: [string, number][]; pins: string[]; chunks: number } {
  const pages: [string, number][] = [];
  for (const key of loaded) {
    if (!scene.textures.exists(key)) continue;
    const img = scene.textures.get(key).getSourceImage() as { width: number; height: number };
    pages.push([key, img.width * img.height * 4]);
  }
  let chunks = 0;
  for (const v of chunkState.values()) if (v === 2) chunks++;
  return { pages, pins: [...groupPins.keys()], chunks };
}
// the frame gate reads the breakdown from the page
(globalThis as { __artReport?: typeof residentReport }).__artReport = residentReport;

/** Items, objects and UI art: small, loaded once behind the loading screen. */
export function loadStaticAtlases(scene: Phaser.Scene, done: (ok: boolean) => void): void {
  const pages = [...art.atlas.items, ...art.atlas.objects, ...art.atlas.ui];
  let left = pages.length;
  if (left === 0) {
    done(true);
    return;
  }
  let failed = false;
  const finish = () => {
    if (--left === 0) done(!failed);
  };
  const start = (key: string, retry: boolean) =>
    loadAtlas(
      scene,
      key,
      'atlas',
      'other',
      () => {
        const obj = art.atlas.objects.includes(key);
        const items = art.atlas.frames.items ?? {};
        for (const name of scene.textures.get(key).getFrameNames()) {
          if (obj) art.objWhere[name] = key;
          if (!obj || !items[name]) art.where[name] = key;
        }
        finish();
      },
      () => {
        if (retry) start(key, false);
        else {
          failed = true;
          finish();
        }
      },
    );
  for (const key of pages) start(key, true);
}

// ---------------------------------------------------------------- characters, by group, on demand

const groupUse = new Map<string, number>();
/** Live puppets per group (shown or hidden): the sweep never frees a group anybody can still draw. */
const groupPins = new Map<string, number>();
/** Mark a character's group as held by a live puppet; returns the group, to give back with unpinChar. */
export function pinChar(setId: string): string {
  const group = art.chars.sets[setId]?.group ?? '';
  if (group) groupPins.set(group, (groupPins.get(group) ?? 0) + 1);
  return group;
}
export function unpinChar(group: string): void {
  if (!group) return;
  const n = (groupPins.get(group) ?? 0) - 1;
  if (n > 0) groupPins.set(group, n);
  else groupPins.delete(group);
}
/** The set played as the hero (its play-only pages load too); told by the sweep each second. */
let heroSet = '';
const lazyFrames = new Map<string, Set<string>>();
function lazyOf(group: string): { pages: string[]; frames: Set<string> } | null {
  const l = art.chars.lazy?.[group];
  if (!l) return null;
  let f = lazyFrames.get(group);
  if (!f) lazyFrames.set(group, (f = new Set(l.frames)));
  return { pages: l.pages, frames: f };
}
/** The pages a character cannot be drawn without (play-only pages are extra, except for the hero). */
function needed(group: string): string[] {
  const all = art.chars.groups[group] ?? [];
  const lazy = lazyOf(group);
  return lazy && group !== heroSet ? all.filter((p) => !lazy.pages.includes(p)) : all;
}
/** True when every page this character needs is resident (no load is started). */
export function charReady(setId: string): boolean {
  const set = art.chars.sets[setId];
  if (!set) return false;
  const pages = needed(set.group);
  return pages.length > 0 && pages.every((p) => loaded.has(p));
}
/** Make sure a character's pages are on their way; returns true when it can be drawn now. */
export function wantChar(scene: Phaser.Scene, setId: string): boolean {
  const set = art.chars.sets[setId];
  if (!set) return false;
  const pages = needed(set.group);
  let ready = pages.length > 0;
  for (const p of pages) {
    if (!loaded.has(p)) {
      ready = false;
      loadAtlas(scene, p, 'chars', 'chars');
    }
  }
  groupUse.set(set.group, scene.time.now);
  return ready;
}
/**
 * Drop character pages nobody can draw (no live puppet pins them) once resident character art passes maxBytes:
 * those not asked for in 20 s first, then, if still over, any unpinned one, oldest first. Pinned ones always stay.
 * Runs each second from the world and after every character page upload.
 */
export function sweepChars(scene: Phaser.Scene, keep: string, maxBytes = 88 * 1024 * 1024): void {
  if (keep !== heroSet) {
    // the hero she stopped playing never swings or fishes again until chosen: its play-only pages go
    for (const p of lazyOf(heroSet)?.pages ?? []) unloadAtlas(scene, p, 'chars');
    heroSet = keep;
    // the new hero's play-only pages come in now, before she swings or fishes
    for (const p of lazyOf(keep)?.pages ?? []) loadAtlas(scene, p, 'chars', 'chars');
  }
  if (art.bytes.chars < maxBytes) return;
  const now = scene.time.now;
  // a page that landed after its group was swept has no use time: it counts as long unused, so it is found too
  for (const [group, pages] of Object.entries(art.chars.groups))
    if (!groupUse.has(group) && pages.some((p) => loaded.has(p))) groupUse.set(group, 0);
  const free = [...groupUse.entries()]
    // a group asked for in the last 250 ms is being waited for (a cast about to start): never free it under them
    .filter(([g, t]) => g !== keep && !groupPins.has(g) && now - t > 250)
    .sort((a, b) => Number(now - b[1] > 20000) - Number(now - a[1] > 20000) || a[1] - b[1]);
  for (const [group] of free) {
    for (const p of art.chars.groups[group] ?? []) unloadAtlas(scene, p, 'chars');
    groupUse.delete(group);
    if (art.bytes.chars < maxBytes * 0.8) break;
  }
}
/**
 * The atlas page holding a character frame. A play-only frame whose page is not in yet is drawn with its stand-in
 * pose from the main page (that page is fetched now), so a puppet never blinks out.
 */
export function charPage(scene: Phaser.Scene, setId: string, frame: string): string | null {
  const set = art.chars.sets[setId];
  if (!set) return null;
  const lazy = lazyOf(set.group);
  if (lazy?.frames.has(frame)) for (const p of lazy.pages) loadAtlas(scene, p, 'chars', 'chars');
  for (const p of art.chars.groups[set.group] ?? []) if (loaded.has(p) && scene.textures.get(p).has(frame)) return p;
  return null;
}

// ---------------------------------------------------------------- talk portraits, one at a time

/** Portrait pages kept after their talk (the last few speakers come back line after line). */
const PORTRAITS_KEPT = 3;
const portraitUse = new Map<string, number>();
const portraitPins = new Map<string, number>();
const portraitFailed = new Set<string>();

/** The portrait page for a character once it is in (null while it loads, or when it has none: use the world frames). */
export function wantPortrait(scene: Phaser.Scene, setId: string): string | null {
  const p = art.portraits.sets[setId];
  if (!p || portraitFailed.has(p.page)) return null;
  portraitUse.set(p.page, scene.time.now);
  if (loaded.has(p.page)) return p.page;
  loadAtlas(
    scene,
    p.page,
    'portraits',
    'other',
    () => sweepPortraits(scene),
    () => portraitFailed.add(p.page),
  );
  return null;
}
export function pinPortrait(page: string): void {
  portraitPins.set(page, (portraitPins.get(page) ?? 0) + 1);
}
export function unpinPortrait(page: string): void {
  const n = (portraitPins.get(page) ?? 0) - 1;
  if (n > 0) portraitPins.set(page, n);
  else portraitPins.delete(page);
}
/** Free the portraits used longest ago beyond the few kept; never one on screen. */
function sweepPortraits(scene: Phaser.Scene): void {
  const resident = [...portraitUse.keys()].filter((k) => loaded.has(k));
  resident.sort((a, b) => portraitUse.get(a)! - portraitUse.get(b)!);
  let n = resident.length;
  for (const k of resident) {
    if (n <= PORTRAITS_KEPT) break;
    if (portraitPins.has(k)) continue;
    unloadAtlas(scene, k, 'other');
    portraitUse.delete(k);
    n--;
  }
}

// ---------------------------------------------------------------- ground chunks

const chunkState = new Map<string, number>(); // 1 loading, 2 ready

/**
 * Phaser wraps a power-of-two texture (a ground chunk) with REPEAT, so filtering at a chunk's edge blends in the
 * far side of the same chunk: a thin line at every seam. Clamp it instead (state put back as found).
 */
function clampEdges(scene: Phaser.Scene, key: string): void {
  const r = scene.sys.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
  const w = scene.textures.get(key).source[0]?.glTexture;
  if (!r || !('gl' in r) || !w) return;
  const gl = r.gl;
  w.wrapS = gl.CLAMP_TO_EDGE;
  w.wrapT = gl.CLAMP_TO_EDGE;
  const was = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
  gl.bindTexture(gl.TEXTURE_2D, w.webGLTexture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_2D, was);
}
export function chunkKey(area: string, set: string, cx: number, cy: number): string {
  return `gr_${area}_${set}_${cx}_${cy}`;
}
export function wantChunk(
  scene: Phaser.Scene,
  area: string,
  set: string,
  cx: number,
  cy: number,
  done: (key: string) => void,
): void {
  const key = chunkKey(area, set, cx, cy);
  const st = chunkState.get(key);
  if (st === 2) {
    done(key);
    return;
  }
  if (st === 1) return;
  chunkState.set(key, 1);
  void getBitmap(`${BASE}ground/${area}/${set}/${cx}_${cy}.webp`).then((bmp) => {
    if (!bmp) {
      chunkState.delete(key);
      return;
    }
    uploads.push(() => {
      if (!scene.sys.game) return;
      if (!scene.textures.exists(key)) {
        scene.textures.addImage(key, bmp as unknown as HTMLImageElement);
        clampEdges(scene, key);
        art.bytes.ground += bmp.width * bmp.height * 4;
      }
      chunkState.set(key, 2);
      done(key);
    });
  });
}
export function dropChunk(scene: Phaser.Scene, key: string): void {
  if (chunkState.get(key) !== 2) return;
  if (scene.textures.exists(key)) {
    const img = scene.textures.get(key).getSourceImage() as { width: number; height: number };
    art.bytes.ground -= img.width * img.height * 4;
    scene.textures.remove(key);
  }
  chunkState.delete(key);
}

// ---------------------------------------------------------------- stand-ins drawn in code

function hashHue(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return ((h >>> 0) % 360) / 360;
}

/** A labelled rounded box for an object or item that has no art yet. */
export function standIn(scene: Phaser.Scene, id: string, w: number, h: number, label = true): string {
  const key = `ph_${id}_${w}x${h}`;
  if (scene.textures.exists(key)) return key;
  const tex = scene.textures.createCanvas(key, w, h)!;
  const c = tex.getContext();
  const col = Phaser.Display.Color.HSVToRGB(hashHue(id), 0.45, 0.85) as Phaser.Types.Display.ColorObject;
  c.fillStyle = `rgb(${col.r},${col.g},${col.b})`;
  c.strokeStyle = 'rgba(40,30,20,0.9)';
  c.lineWidth = 3;
  const r = Math.min(14, w / 4, h / 4);
  c.beginPath();
  c.roundRect(2, 2, w - 4, h - 4, r);
  c.fill();
  c.stroke();
  if (label && w >= 40) {
    c.fillStyle = 'rgba(30,20,10,0.9)';
    c.font = `600 ${Math.max(10, Math.min(15, w / 6))}px Nunito, sans-serif`;
    c.textAlign = 'center';
    const words = id.replace(/_/g, ' ').split(' ');
    words.forEach((word, i) => {
      c.fillText(word, w / 2, h / 2 + (i - (words.length - 1) / 2) * 14 + 4);
    });
  }
  tex.refresh();
  return key;
}

/** The frame to draw for a world object or item: real art when it exists, a stand-in otherwise. */
export function frameFor(scene: Phaser.Scene, name: string, w: number, h: number): { key: string; frame?: string } {
  const page = art.where[name];
  if (page) return { key: page, frame: name };
  return { key: standIn(scene, name, Math.max(16, Math.round(w)), Math.max(16, Math.round(h))) };
}
/** The frame for something standing in the world: its furniture picture first, then any art, then a stand-in. */
export function worldFrame(scene: Phaser.Scene, name: string, w: number, h: number): { key: string; frame?: string } {
  const page = art.objWhere[name];
  if (page) return { key: page, frame: name };
  return frameFor(scene, name, w, h);
}
/** The world picture of a placed thing: the furniture object it becomes, where that has its own name. */
export const PLACED_ART: Record<string, string> = { bed: 'bed_fixed' };
export function hasArt(name: string): boolean {
  return !!art.where[name];
}

/** A simple stand-in figure with real walking legs, for characters whose sheets are not in yet. */
export function standInFigure(scene: Phaser.Scene): string {
  const key = 'ph_figure';
  if (scene.textures.exists(key)) return key;
  const W = 96;
  const H = 144;
  const tex = scene.textures.createCanvas(key, W * 8, H)!;
  const c = tex.getContext();
  for (let f = 0; f < 8; f++) {
    const ox = f * W;
    const walk = f >= 2 && f < 6;
    const phase = f - 2;
    const up = f === 1 || f === 7 ? -3 : 0;
    c.save();
    c.translate(ox, up);
    c.lineWidth = 4;
    c.strokeStyle = '#fff';
    c.fillStyle = '#fff';
    // legs
    const l = walk ? [0, -10, 0, 10][phase]! : 0;
    c.fillStyle = '#5b6b8c';
    c.fillRect(30, 104 - Math.max(0, -l), 14, 34 + Math.min(0, l) + Math.max(0, -l) - (l < 0 ? 10 : 0));
    c.fillRect(52, 104 - Math.max(0, l), 14, 34 - (l > 0 ? 10 : 0));
    // body and head
    c.fillStyle = '#e9e4da';
    c.beginPath();
    c.roundRect(24, 62, 48, 50, 16);
    c.fill();
    c.beginPath();
    c.arc(48, 40, 30, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#2a2a33';
    if (f === 1) {
      c.fillRect(34, 38, 10, 3);
      c.fillRect(52, 38, 10, 3);
    } else {
      c.beginPath();
      c.arc(38, 38, 4, 0, Math.PI * 2);
      c.arc(58, 38, 4, 0, Math.PI * 2);
      c.fill();
    }
    c.beginPath();
    if (f >= 6) c.ellipse(48, 52, 6, f === 6 ? 6 : 3, 0, 0, Math.PI * 2);
    else c.arc(48, 50, 7, 0.15 * Math.PI, 0.85 * Math.PI);
    c.lineWidth = 3;
    c.strokeStyle = '#2a2a33';
    if (f >= 6) c.fill();
    else c.stroke();
    c.restore();
    tex.add(f, 0, ox, 0, W, H);
  }
  tex.refresh();
  return key;
}
