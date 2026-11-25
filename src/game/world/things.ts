// Everything that stands in the world: map objects (culled to the camera), things she has placed, crops,
// items lying on the ground, build-site outlines and closed gates (the unbuilt part of the cottage, broken and mended bridges).
import type Phaser from 'phaser';
import { cropAt } from '../../core/farm.ts';
import { POT_AREA, potAt, potCropN, potStage } from '../../core/pots.ts';
import { test } from '../../core/cond.ts';
import type { AreaDef, Barrier, Game, MapObj, ObjectType, Rect } from '../../core/types.ts';
import { art, frameFor, hasArt, PLACED_ART, worldFrame } from '../assets.ts';
import { Puppet } from '../puppet.ts';
import { roofDepth } from './roof.ts';
import { Vegetation, windStrength, type VegetationSnapshot, type WindPoint } from './vegetation.ts';

const T = 64;
const BUCKET = 8;
/** stored art is 1.5 times screen size */
const ART_SCALE = 1 / 1.5;

interface Thing {
  img: Phaser.GameObjects.Image;
  /** a soft contact shadow of its own, for things the ground bake cannot know about (built later, or placed) */
  shadow?: Phaser.GameObjects.Image;
  /** the picture a placed fence shows, so it changes when a neighbour comes or goes */
  piece?: string;
  light: number;
  sway: number;
  baseX: number;
  baseY: number;
  shake: number;
  sx: number;
  sy: number;
  /** tall enough to hide her: fades to FADE when she walks behind it */
  fade: boolean;
  /** extra lights along it (x offsets from baseX, y offsets from baseY), as on a lantern string */
  lamps?: [number, number][];
  /** Standing harvestable tree, including its partial cut, if any. */
  tree?: TreeCut;
  /** A living tree suitable for reflection, tracked only while it is visible. */
  reflectable?: boolean;
  windPhase: number;
}

interface TreeCut {
  /** Trunk centre and width as fractions of the original picture, before any flip. */
  centre: number;
  width: number;
  fromBase: number;
  /** The open side of the notch, in world coordinates. */
  side: -1 | 1;
  progress: number;
  notch?: Phaser.GameObjects.Image;
}

interface FallingTree {
  img: Phaser.GameObjects.Image;
  notch?: Phaser.GameObjects.Image;
  notchOffset: number;
  direction: -1 | 1;
  time: number;
}

/** World-space opening of a tree's painted cut, for the striking tool. */
export interface CutPoint {
  x: number;
  y: number;
  depth: number;
}

/** Trees that vary one from the next (seeded by place): flipped, scaled 0.85 to 1.15, a slight shift of hue. */
const TREES = new Set<string>([
  'oak',
  'pine',
  'palm',
  'dark_oak',
  'birch',
  'gum_tree',
  'apple_tree',
  'orange_tree',
  'banana_tree',
]);
/** Tints a tree may take: the daylight below, a little greener, a little more golden, a little cooler. */
const TREE_TINTS = [0xfff4e6, 0xf0f8e2, 0xfff0d6, 0xeef2ec];
/** Cut positions match the cap of each tree's own stump, in the unflipped source picture. */
const TREE_CUTS: Record<string, [number, number]> = {
  oak: [0.49, 0.21],
  pine: [0.48, 0.2],
  palm: [0.34, 0.17],
  dark_oak: [0.47, 0.34],
  birch: [0.465, 0.17],
  block_oak: [0.5, 0.35],
};
const RECOIL = 0.24;
const FALL_START = 0.14;
const FALL_TIME = 0.68;
const FALL_FADE = 1.04;
const FALL_END = 1.34;
const MAX_FALLS = 8;
/** Fence and rail pieces: a shade deeper than the daylight. */
const FENCES = new Set(['fence', 'fence_post', 'plot_fence', 'rail_fence']);
/** Fences with their own pieces for runs down the screen, corners and gate posts (tools/art/fences.ts). */
const RUN_PIECES = new Set(['fence', 'plot_fence']);
/** Stones that stand in rows: each varies a little (flip, size, a small shift, a shade), seeded by place. */
const STONES = new Set(['boulder', 'rock', 'cracked_rock']);
const STONE_TINTS = [0xfff4e6, 0xf4f0e8, 0xfff8ee, 0xeceee6, 0xf8eedc];
/** Regions drawn in blocks: nothing there gets a soft shadow (as in the ground bake). */
const BLOCKY = 'LFCMK';
/** One warm daylight over everything standing outdoors (a tint costs nothing per frame); the snow keeps a cool light. */
const DAYLIGHT = 0xfff4e6;
/** A steady number from 0 to 1 for a map place, so a tree looks the same every time she comes back. */
function placeHash(x: number, y: number, s: number): number {
  let h = Math.imul(x * 374761393 + y * 668265263 + s * 2147483647, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Discover the numbered paintings once. Summer and winter share the same choice of silhouette.
function outdoorVariants(): Map<string, string[]> {
  const families = new Map<string, string[]>();
  for (const name of Object.keys(art.objWhere ?? {}).sort()) {
    const base = /^(.+)_v[1-9]\d*$/.exec(name)?.[1];
    if (!base) continue;
    const family = families.get(base) ?? [base];
    family.push(name);
    families.set(base, family);
  }
  return families;
}

/** How far a roof or treetop fades when she is behind it (the Codex game's idea, phase 2 part G). */
const FADE = 0.4;
/** The lanterns on a lantern string, as fractions along it, and how far the string sags. */
const STRING_LAMPS = [0.2, 0.5, 0.8];
const STRING_SAG = 30;
const STRING_TOP = 168;

/** Placed things drawn as their own animated character (D12), not a still picture: idle, and a wave when she is near. */
const LIVING = new Set<string>(['snow_golem']);
/** How near she comes, in tiles, before a living thing waves. */
const WAVE_R = 3;
interface Living {
  p: Puppet;
  x: number;
  y: number;
}

/**
 * The cottage's wall pieces that come with the house steps (package 41): the trophy wall of the biggest room, one
 * framed prize per boss (an empty frame until that boss is beaten), and with the third step a big window and a
 * small photo wall. Centres in tiles on the top wall (row 0).
 */
const TROPHIES: { flag: string; face: string; x: number }[] = [
  { flag: 'trophy_spider_jockey', face: 'face_spider_jockey', x: 11.62 },
  { flag: 'trophy_creeper_king', face: 'face_creeper_king', x: 12.42 },
  // package 51: the tiny crown from Dad's chest on Treasure Island (sq_dad_trail)
  { flag: 'trophy_crown', face: 'treasure_crown', x: 13.22 },
];
/** The board behind the trophies: wide enough to cover the small picture painted on that wall. */
const BOARD = { x: 12.42, w: 2.6 };
const WALL_Y = 0.5;
const HOUSE3_WINDOW = { x: 2.1, w: 1.2 };
const HOUSE3_PHOTOS: { id: string; x: number; y: number; s: number }[] = [
  { id: 'photo_frame', x: 7.05, y: 0.42, s: 0.5 },
  { id: 'painting_star', x: 7.85, y: 0.5, s: 0.42 },
  { id: 'painting_sea', x: 8.6, y: 0.4, s: 0.42 },
];

/** A wooden frame with a dark velvet mount for a trophy picture, drawn once into a canvas texture. */
function plaqueTex(scene: Phaser.Scene): string {
  const key = 'trophy_plaque';
  if (scene.textures.exists(key)) return key;
  const W = 46;
  const H = 48;
  const tex = scene.textures.createCanvas(key, W, H)!;
  const c = tex.getContext();
  c.fillStyle = 'rgba(40,24,12,0.3)';
  c.beginPath();
  c.roundRect(3, 4, W - 4, H - 4, 6);
  c.fill();
  c.fillStyle = '#6b4526';
  c.beginPath();
  c.roundRect(1, 1, W - 4, H - 4, 6);
  c.fill();
  c.strokeStyle = '#d6a861';
  c.lineWidth = 2;
  c.beginPath();
  c.roundRect(3, 3, W - 8, H - 8, 4);
  c.stroke();
  c.fillStyle = '#2f4a52';
  c.beginPath();
  c.roundRect(6, 6, W - 14, H - 14, 3);
  c.fill();
  c.fillStyle = 'rgba(255,255,255,0.08)';
  c.fillRect(7, 7, W - 16, 5);
  tex.refresh();
  return key;
}

/** The board the trophies hang on: a darker plank with a gold edge, drawn once. */
function boardTex(scene: Phaser.Scene): string {
  const key = 'trophy_board';
  if (scene.textures.exists(key)) return key;
  const W = BOARD.w * T;
  const H = 58;
  const tex = scene.textures.createCanvas(key, W, H)!;
  const c = tex.getContext();
  c.fillStyle = 'rgba(40,24,12,0.25)';
  c.beginPath();
  c.roundRect(3, 4, W - 4, H - 4, 8);
  c.fill();
  c.fillStyle = '#8a5a32';
  c.beginPath();
  c.roundRect(1, 1, W - 4, H - 4, 8);
  c.fill();
  c.strokeStyle = '#5a381c';
  c.lineWidth = 3;
  c.beginPath();
  c.roundRect(2.5, 2.5, W - 7, H - 7, 7);
  c.stroke();
  c.strokeStyle = 'rgba(255,214,140,0.35)';
  c.lineWidth = 1;
  for (const y of [18, 36]) {
    c.beginPath();
    c.moveTo(8, y);
    c.lineTo(W - 12, y);
    c.stroke();
  }
  tex.refresh();
  return key;
}

/** A lantern string with bunting on two posts, drawn once into a canvas texture (no picture needed). */
function lanternString(scene: Phaser.Scene, w: number): string {
  const key = `lantern_string_${w}`;
  if (scene.textures.exists(key)) return key;
  const W = w * T;
  const H = STRING_TOP + 24;
  const tex = scene.textures.createCanvas(key, W, H)!;
  const c = tex.getContext();
  c.lineCap = 'round';
  const top = H - STRING_TOP;
  // posts: dark wood with a lighter edge, a small foot shadow
  for (const x of [10, W - 10]) {
    c.fillStyle = 'rgba(66,54,32,0.22)';
    c.beginPath();
    c.ellipse(x, H - 6, 13, 4, 0, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = '#6e5238';
    c.lineWidth = 9;
    c.beginPath();
    c.moveTo(x, H - 6);
    c.lineTo(x, top - 4);
    c.stroke();
    c.strokeStyle = '#c7a87a';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(x - 1.5, H - 8);
    c.lineTo(x - 1.5, top - 2);
    c.stroke();
  }
  const at = (t: number): [number, number] => [10 + (W - 20) * t, top + 4 * STRING_SAG * t * (1 - t)];
  c.strokeStyle = '#5e4a34';
  c.lineWidth = 3;
  c.beginPath();
  for (let i = 0; i <= 40; i++) {
    const [x, y] = at(i / 40);
    if (i === 0) c.moveTo(x, y);
    else c.lineTo(x, y);
  }
  c.stroke();
  // bunting in soft colours
  const flags = ['#bc6350', '#e5ca8d', '#67867b', '#c99542'];
  const n = w * 3;
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (STRING_LAMPS.some((l) => Math.abs(l - t) < 0.5 / n)) continue;
    const [x, y] = at(t);
    const [ex, ey] = at(t + 0.7 / n);
    c.fillStyle = flags[i % 4]!;
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(ex, ey);
    c.lineTo((x + ex) / 2 + 1, Math.max(y, ey) + 24);
    c.closePath();
    c.fill();
  }
  // lanterns: a warm glass in a dark frame
  for (const t of STRING_LAMPS) {
    const [x, y] = at(t);
    c.strokeStyle = '#4a3a2a';
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x, y + 5);
    c.stroke();
    c.fillStyle = '#3f3226';
    c.fillRect(x - 10, y + 5, 20, 5);
    c.fillStyle = '#ffd98a';
    c.fillRect(x - 8, y + 10, 16, 20);
    c.fillStyle = '#fff2c8';
    c.fillRect(x - 4, y + 13, 7, 13);
    c.fillStyle = '#3f3226';
    c.fillRect(x - 10, y + 30, 20, 4);
  }
  tex.refresh();
  return key;
}

/** A soft dark ellipse, drawn once, laid under things the ground bake has no shadow for. */
function shadowKey(scene: Phaser.Scene): string {
  const key = 'contact_shadow';
  if (scene.textures.exists(key)) return key;
  const tex = scene.textures.createCanvas(key, 128, 64)!;
  const c = tex.getContext();
  const g = c.createRadialGradient(64, 32, 0, 64, 32, 64);
  g.addColorStop(0, 'rgba(36,40,30,0.95)');
  g.addColorStop(0.55, 'rgba(36,40,30,0.55)');
  g.addColorStop(1, 'rgba(36,40,30,0)');
  c.setTransform(1, 0, 0, 0.5, 0, 0);
  c.fillStyle = g;
  c.fillRect(0, 0, 128, 128);
  tex.refresh();
  return key;
}

/** The painted notch is loaded by the scene. Keep a small shared fallback for missing art. */
function notchKey(scene: Phaser.Scene): string {
  if (scene.textures.exists('forestry-notch')) return 'forestry-notch';
  const key = 'forestry-notch-fallback';
  if (scene.textures.exists(key)) return key;
  const tex = scene.textures.createCanvas(key, 80, 32)!;
  const c = tex.getContext();
  c.fillStyle = '#52331f';
  c.beginPath();
  c.moveTo(0, 1);
  c.lineTo(78, 16);
  c.lineTo(0, 31);
  c.closePath();
  c.fill();
  c.fillStyle = '#dfac6d';
  c.beginPath();
  c.moveTo(1, 5);
  c.lineTo(68, 16);
  c.lineTo(1, 25);
  c.closePath();
  c.fill();
  c.fillStyle = '#f4d49a';
  c.beginPath();
  c.moveTo(2, 7);
  c.lineTo(64, 16);
  c.lineTo(2, 14);
  c.closePath();
  c.fill();
  tex.refresh();
  return key;
}

function standInSize(t: ObjectType): [number, number] {
  const w = (t.w ?? 1) * T;
  const h = (t.h ?? 1) * T;
  if (t.flat) return [w, h];
  if (t.node?.tool === 'axe' || t.node?.verb === 'shake') return [w * 1.7, h * 2.4];
  if ((t.w ?? 1) >= 3 && (t.h ?? 1) >= 3) return [w, h * 1.45];
  if (t.solid && (t.w ?? 1) === 1) return [w * 0.9, h * 1.3];
  return [w, h * 1.1];
}

export class Things {
  private readonly variants = outdoorVariants();
  private scene: Phaser.Scene;
  private g: Game;
  private vegetation: Vegetation;
  private area: AreaDef | null = null;
  private buckets = new Map<number, number[]>();
  private objs = new Map<number, Thing>();
  private falling = new Map<number, FallingTree>();
  private placed = new Map<number, Thing>();
  private crops: Phaser.GameObjects.Image[] = [];
  private drops: Phaser.GameObjects.Image[] = [];
  private gates: Phaser.GameObjects.GameObject[] = [];
  private pool: Phaser.GameObjects.Image[] = [];
  private living = new Map<number, Living>();
  private decor: Phaser.GameObjects.Image[] = [];
  private decorKey = '';
  private readonly reflectionTargets: Phaser.GameObjects.Image[] = [];
  /** where each run piece of fence stands, by y * 10000 + x, for choosing the piece of a run down the screen */
  private runAt = new Map<number, string>();
  private rev = -1;
  private lastRect = '';
  private t = 0;
  private treeTime = 0;
  private xmas = false;

  constructor(scene: Phaser.Scene, g: Game) {
    this.scene = scene;
    this.g = g;
    this.vegetation = new Vegetation(scene, g);
  }

  setGame(g: Game): void {
    this.g = g;
    this.vegetation.setGame(g);
  }

  setArea(area: AreaDef): void {
    for (const t of this.objs.values()) this.drop(t);
    for (const f of this.falling.values()) this.dropFall(f);
    this.falling.clear();
    for (const t of this.placed.values()) this.drop(t);
    for (const l of this.living.values()) l.p.destroy();
    this.objs.clear();
    this.placed.clear();
    this.living.clear();
    for (const d of this.decor) d.destroy();
    this.decor.length = 0;
    this.decorKey = '';
    this.area = area;
    this.vegetation.setArea(area, this.xmas);
    this.reflectionTargets.length = 0;
    this.buckets.clear();
    this.runAt.clear();
    for (const o of area.objects) if (FENCES.has(o.type)) this.runAt.set(o.y * 10000 + o.x, o.type);
    area.objects.forEach((o, i) => {
      const t = this.g.c.objects[o.type];
      if (!t || this.isBaked(o, t)) return;
      const id = Math.floor(o.y / BUCKET) * 1000 + Math.floor(o.x / BUCKET);
      let list = this.buckets.get(id);
      if (!list) this.buckets.set(id, (list = []));
      list.push(i);
    });
    this.rev = -1;
    this.lastRect = '';
  }

  /** Flat decoration with no behaviour is painted into the ground by the baker (when it has art). */
  private isBaked(o: MapObj, t: ObjectType): boolean {
    return (
      !!t.flat && !t.interact && !t.node && !o.if && !!art.ground.areas[this.area?.id ?? ''] && hasArt(t.art ?? t.id)
    );
  }

  private get(): Phaser.GameObjects.Image {
    const img = this.pool.pop() ?? this.scene.add.image(0, 0, '__DEFAULT');
    img.setCrop().setVisible(true).setAlpha(1).setAngle(0).setTint(0xffffff).setFlipX(false);
    return img;
  }
  private free(img: Phaser.GameObjects.Image): void {
    img.setVisible(false);
    this.pool.push(img);
  }
  private drop(th: Thing): void {
    this.free(th.img);
    if (th.shadow) this.free(th.shadow);
    if (th.tree?.notch) this.free(th.tree.notch);
    th.shadow = undefined;
  }

  private dropFall(f: FallingTree): void {
    this.free(f.img);
    if (f.notch) this.free(f.notch);
  }

  /** The same stump selection is used before, during and after a fall. */
  private stumpFrame(t: ObjectType, sw: number, sh: number): { key: string; frame?: string } {
    const base = t.art ?? t.id;
    const stump = hasArt(`${base}_stump`) ? `${base}_stump` : 'tree_stump';
    const name = this.xmas && hasArt(`${stump}_snow`) ? `${stump}_snow` : stump;
    return frameFor(this.scene, name, sw, sh * 0.3);
  }

  private cutSide(th: Thing): -1 | 1 {
    const tree = th.tree!;
    const centre = th.img.flipX ? 1 - tree.centre : tree.centre;
    const x = th.baseX + (centre - 0.5) * th.img.width * th.sx;
    if (Math.abs(this.g.s.x * T - x) > 1) return this.g.s.x * T < x ? -1 : 1;
    return this.g.s.dir === 'left' ? 1 : -1;
  }

  private setCut(th: Thing, hits: number, total: number): void {
    const tree = th.tree!;
    tree.progress = Math.min(1, Math.max(0, hits / Math.max(1, total)));
    if (!tree.progress) return;
    tree.notch ??= this.get();
    const key = notchKey(this.scene);
    if (tree.notch.texture.key !== key) tree.notch.setTexture(key);
    tree.notch.setVisible(true).setDepth(th.img.depth + 0.01);
  }

  private cutPosition(th: Thing, side: -1 | 1): CutPoint {
    const tree = th.tree!;
    const img = th.img;
    const centre = img.flipX ? 1 - tree.centre : tree.centre;
    const dx = (img.width * (centre - 0.5) + side * img.width * tree.width * 0.5) * img.scaleX;
    const dy = -tree.fromBase * img.scaleY;
    const cos = Math.cos(img.rotation);
    const sin = Math.sin(img.rotation);
    return { x: img.x + dx * cos - dy * sin, y: img.y + dx * sin + dy * cos, depth: img.depth + 0.05 };
  }

  /** A standing tree's bark edge, or the still-visible edge on its falling top after the last hit. */
  cutPoint(objIndex: number): CutPoint | null {
    const th = this.objs.get(objIndex);
    if (th?.tree) return this.cutPosition(th, this.cutSide(th));
    const notch = this.falling.get(objIndex)?.notch;
    return notch ? { x: notch.x, y: notch.y, depth: notch.depth + 0.02 } : null;
  }

  /** Keep the painted cut on the moving trunk, including its seeded flip, sway and fading. */
  private positionCut(th: Thing): void {
    const tree = th.tree;
    const notch = tree?.notch;
    if (!tree || !notch) return;
    const key = notchKey(this.scene);
    if (notch.texture.key !== key) notch.setTexture(key);
    const img = th.img;
    const trunkWidth = img.width * tree.width;
    const point = this.cutPosition(th, tree.side);
    notch
      .setOrigin(tree.side < 0 ? 0 : 1, 0.5)
      .setFlipX(tree.side > 0)
      .setDisplaySize(trunkWidth * (0.35 + 0.65 * tree.progress) * img.scaleX, trunkWidth * 0.32 * img.scaleY)
      .setPosition(point.x, point.y)
      .setAngle(img.angle)
      .setAlpha(img.alpha);
  }

  /** A contact shadow under a thing the bake does not know (package 52): set once, no cost per frame. */
  private shade(th: Thing, x: number, y: number, w: number, h: number): void {
    const a = this.area!;
    if (a.indoor || BLOCKY.includes(a.region[Math.floor(y / T) - 1]?.charAt(Math.floor(x / T)) ?? '')) return;
    const img = this.get();
    img
      .setTexture(shadowKey(this.scene))
      .setOrigin(0.5, 0.5)
      .setPosition(x + 0.1 * T, y - 0.05 * T)
      .setDisplaySize(Math.max(0.84, w + 0.2) * T, (w >= 3 ? 0.9 : Math.min(0.68, 0.4 + 0.14 * h)) * T)
      .setAlpha(0.42)
      .setDepth(-880);
    th.shadow = img;
  }

  /** The piece a fence shows: a run down the screen gets its own pieces, so it is not a ladder of sideways rails. */
  private fencePiece(o: { x: number; y: number; type: string }, artId: string, runAt = this.runAt): string {
    if (!RUN_PIECES.has(o.type)) return artId;
    const at = (dx: number, dy: number) => {
      const k = runAt.get((o.y + dy) * 10000 + o.x + dx);
      return k === o.type || k === 'fence_post';
    };
    // package 57b (D62), pieces from tools/art/fences.ts (the same rule as fenceChoice there): a run down the screen
    // shows two rails with its uprights (_r), capped posts at its free ends (_rt, _rb), corners that meet (_rc, and
    // _rk where a pen's corner tile is empty), and a sideways run that stops at a gate ends in a capped post (_gl, _gr)
    const up = at(0, -1);
    const down = at(0, 1);
    const l = at(-1, 0);
    const r = at(1, 0);
    let v = '';
    if (up || down) {
      if (l || r) v = up ? `${artId}_rc` : '';
      else if (!up && (at(-1, -1) || at(1, -1))) v = `${artId}_rk`;
      else v = up ? (down ? `${artId}_r` : `${artId}_rb`) : `${artId}_rt`;
    } else if (l !== r) {
      const dir = l ? 1 : -1;
      for (let k = 2; k <= 5 && !v; k++) if (at(dir * k, 0)) v = `${artId}_${l ? 'gr' : 'gl'}`;
    }
    if (v && hasArt(v)) return v;
    // the plain sideways piece under its own name: the item icon 'fence' shares the plain name
    return hasArt(`${artId}_h`) ? `${artId}_h` : artId;
  }

  private make(artId: string, w: number, h: number, sw: number, sh: number): Thing {
    const img = this.get();
    const winter = this.xmas && hasArt(artId + '_snow');
    const name = winter ? artId + '_snow' : artId;
    const building = `building-${name}`;
    const detailed = this.scene.textures.exists(building);
    const f = detailed
      ? { key: building, frame: undefined }
      : artId === 'lantern_string' && !hasArt(artId)
        ? { key: lanternString(this.scene, Math.round(w)) }
        : worldFrame(this.scene, name, sw, sh);
    img.setTexture(f.key, f.frame);
    const scale = detailed ? ART_SCALE / 2 : f.frame ? ART_SCALE : 1;
    img.setScale(scale);
    void w;
    void h;
    return { img, light: 0, sway: 0, baseX: 0, baseY: 0, shake: 0, sx: scale, sy: scale, fade: false, windPhase: 0 };
  }

  private addObj(i: number): void {
    const o = this.area!.objects[i]!;
    const t = this.g.c.objects[o.type]!;
    const w = t.w ?? 1;
    const h = t.h ?? 1;
    const [sw, sh] = standInSize(t);
    const base = this.fencePiece(o, t.art ?? t.id);
    const choices = this.area!.indoor ? undefined : this.variants.get(base);
    const artId = choices?.[Math.floor(placeHash(o.x, o.y, 17) * choices.length)] ?? base;
    const th = this.make(artId, w, h, sw, sh);
    th.img.name = o.id;
    const x = (o.x + w / 2) * T;
    const y = (o.y + h) * T;
    th.baseX = x;
    th.baseY = y;
    if (t.flat)
      th.img
        .setOrigin(0.5, 0.5)
        .setPosition(x, (o.y + h / 2) * T)
        .setDepth(-900 + o.y * 0.01);
    else
      th.img
        .setOrigin(0.5, 1)
        .setPosition(x, y)
        .setDepth(roofDepth(this.area!, this.g.c, o) ?? y - 6);
    if (!this.area!.indoor && !this.xmas) th.img.setTint(DAYLIGHT);
    // package 48: fences a shade deeper, so a run sits in the grass instead of glowing on it (set once, no cost)
    if (!this.area!.indoor && FENCES.has(o.type)) th.img.setTint(this.xmas ? 0xe4e8f0 : 0xe2d2bc);
    if (TREES.has(o.type)) {
      // no two trees alike: flip, scale and hue, seeded by where the tree stands
      const k = 0.85 + 0.3 * placeHash(o.x, o.y, 1);
      th.sx *= k;
      th.sy *= k;
      th.img.setScale(th.sx, th.sy).setFlipX(placeHash(o.x, o.y, 2) < 0.5);
      if (!this.xmas) th.img.setTint(TREE_TINTS[Math.floor(placeHash(o.x, o.y, 3) * TREE_TINTS.length)]!);
    }
    if (STONES.has(o.type) && !this.area!.indoor) {
      // package 52: a row of stones does not read as copies: flip, size, a small shift and a shade each
      const k = 0.9 + 0.16 * placeHash(o.x, o.y, 6);
      th.sx *= k;
      th.sy *= k * (0.94 + 0.1 * placeHash(o.x, o.y, 7));
      th.baseX += (placeHash(o.x, o.y, 8) - 0.5) * 10;
      th.baseY += (placeHash(o.x, o.y, 9) - 0.5) * 6;
      th.img
        .setScale(th.sx, th.sy)
        .setPosition(th.baseX, th.baseY)
        .setFlipX(placeHash(o.x, o.y, 5) < 0.5);
      if (!this.xmas) th.img.setTint(STONE_TINTS[Math.floor(placeHash(o.x, o.y, 4) * STONE_TINTS.length)]!);
    }
    // built later (the bake cannot know it is there): a shadow of its own
    if (o.if && !t.flat) this.shade(th, x, y, w, h);
    th.light = t.light ?? 0;
    th.sway = t.frames && t.frames > 1 && !t.light ? 1 + ((o.x * 7 + o.y * 13) % 10) / 10 : 0;
    th.windPhase = placeHash(o.x, o.y, 10) * Math.PI * 2;
    th.reflectable = TREES.has(o.type) && this.g.s.nodes[o.id] === undefined;
    // roofs and treetops: anything broad and standing well over a tile tall can hide her (fun panel 7: the low gum
    // rows on the web trail hid her and the spiders at night, so they fade too)
    th.fade = !t.flat && th.img.displayHeight > T * 1.25 && th.img.displayWidth > T * 1.1;
    th.lamps = undefined;
    if (o.type === 'lantern_string') {
      th.lamps = STRING_LAMPS.map((p) => {
        const W = w * T;
        return [-W / 2 + 10 + (W - 20) * p, -STRING_TOP + 4 * STRING_SAG * p * (1 - p) + 20] as [number, number];
      });
      th.light = 0;
      th.fade = false;
    }
    if (t.node?.verb === 'chop' && t.node.tool === 'axe' && t.node.stump && this.g.s.nodes[o.id] === undefined) {
      const f = this.stumpFrame(t, sw, sh);
      const stump = this.scene.textures.getFrame(f.key, f.frame);
      const [centre, width] = TREE_CUTS[t.art ?? t.id] ?? [0.5, 0.22];
      th.tree = {
        centre,
        width,
        fromBase: Math.min(th.img.height * 0.4, (stump?.realHeight ?? th.img.height * 0.2) * 0.85),
        side: -1,
        progress: 0,
      };
      th.tree.side = this.cutSide(th);
      this.setCut(th, this.g.s.flags[`hit:${o.id}`] ?? 0, t.node.hits);
    }
    if (t.node && this.g.s.nodes[o.id] !== undefined) {
      // used up until morning: a stump, or a picked-clean tree
      if (t.node.verb === 'chop') {
        // D62: its own stump picture (cut to fit that tree's trunk foot), at the tree's size and flip; never a
        // squashed copy of the tree. Kinds with no stump picture use the plain one.
        const f = this.stumpFrame(t, sw, sh);
        th.img.setTexture(f.key, f.frame).setScale(th.sx, th.sy).setAngle(0);
        th.sway = 0;
        th.fade = false;
      } else th.img.setTint(0xb8c4b0);
    }
    this.objs.set(i, th);
  }

  /** Bring the sprites in line with what is live and near the camera. */
  private refresh(view: Phaser.Geom.Rectangle): void {
    const a = this.area!;
    const bx0 = Math.floor((view.x / T - 4) / BUCKET);
    const by0 = Math.floor((view.y / T - 3) / BUCKET);
    const bx1 = Math.floor((view.right / T + 4) / BUCKET);
    const by1 = Math.floor((view.bottom / T + 7) / BUCKET);
    const live = this.g.rt.live[a.id];
    const want = new Set<number>();
    for (let by = by0; by <= by1; by++)
      for (let bx = bx0; bx <= bx1; bx++) {
        const list = this.buckets.get(by * 1000 + bx);
        if (!list) continue;
        for (const i of list) if (!live || live[i]) want.add(i);
      }
    for (const [i, th] of this.objs) {
      if (want.has(i)) continue;
      this.drop(th);
      this.objs.delete(i);
    }
    for (const [i, f] of this.falling) {
      const o = a.objects[i];
      if (want.has(i) && o && this.g.s.nodes[o.id] !== undefined) continue;
      this.dropFall(f);
      this.falling.delete(i);
    }
    for (const i of want) if (!this.objs.has(i)) this.addObj(i);
    this.syncReflectionTargets();
  }

  private refreshPlaced(): void {
    const s = this.g.s;
    const seen = new Set<number>();
    // placed fences join into runs like the map's (package 52)
    const fenceAt = new Map<number, string>();
    for (const p of s.placed) if (p.area === s.area && RUN_PIECES.has(p.item)) fenceAt.set(p.y * 10000 + p.x, p.item);
    for (const p of s.placed) {
      if (p.area !== s.area) continue;
      seen.add(p.k);
      const piece = RUN_PIECES.has(p.item)
        ? this.fencePiece({ x: p.x, y: p.y, type: p.item }, p.item, fenceAt)
        : p.item;
      const had = this.placed.get(p.k);
      if (had && had.piece !== piece) {
        this.drop(had);
        this.placed.delete(p.k);
      }
      if (this.placed.has(p.k) || this.living.has(p.k)) continue;
      const def = this.g.c.items[p.item]!.place!;
      const w = p.rot && p.rot % 2 ? (def.h ?? 1) : (def.w ?? 1);
      const h = p.rot && p.rot % 2 ? (def.w ?? 1) : (def.h ?? 1);
      const set = LIVING.has(p.item) ? art.chars.sets[p.item] : undefined;
      if (set) {
        // its feet just above the foot of its tile, so she passes in front of it and behind it as with the picture
        const x = (p.x + w / 2) * T;
        const y = (p.y + h) * T - 8;
        const pup = new Puppet(this.scene, p.item, set.tall);
        pup.setPos(x, y);
        pup.play('idle', 'down');
        this.living.set(p.k, { p: pup, x, y });
        continue;
      }
      const floor = def.layer === 'floor';
      // package 67: a placed bed or chest draws its furniture picture, not its bag icon
      const th = this.make(PLACED_ART[piece] ?? piece, w, h, w * T, floor ? h * T : h * T * 1.25);
      th.piece = piece;
      if (floor)
        th.img
          .setOrigin(0.5, 0.5)
          .setPosition((p.x + w / 2) * T, (p.y + h / 2) * T)
          .setDepth(-800 + p.y * 0.01);
      else
        th.img
          .setOrigin(0.5, 1)
          .setPosition((p.x + w / 2) * T, (p.y + h) * T)
          .setDepth((p.y + h) * T - 6);
      th.img.setFlipX(p.rot === 1 || p.rot === 2);
      if (!this.area!.indoor && !this.xmas) th.img.setTint(DAYLIGHT);
      th.baseX = th.img.x;
      th.baseY = th.img.y;
      th.light = def.light ?? 0;
      if (!floor) this.shade(th, th.baseX, th.baseY, w, h);
      this.placed.set(p.k, th);
    }
    for (const [k, th] of this.placed)
      if (!seen.has(k)) {
        this.drop(th);
        this.placed.delete(k);
      }
    for (const [k, l] of this.living)
      if (!seen.has(k)) {
        l.p.destroy();
        this.living.delete(k);
      }
    this.syncDecor();
    // crops
    for (const c of this.crops) this.free(c);
    this.crops.length = 0;
    if (s.area === 'island' || s.area === POT_AREA)
      for (const c of s.crops) {
        // package 73b: a crop in one of her greenhouse pots is drawn in its pot, not on the island
        const n = potCropN(c);
        const pot = n ? potAt(this.g, n) : undefined;
        if (n ? s.area !== POT_AREA || !pot : s.area !== 'island') continue;
        const st = n ? null : cropAt(this.g, c.x, c.y);
        const days = this.g.c.items[c.seed]!.grows!.days;
        const stage = n ? potStage(this.g, c) : st?.ripe ? 2 : c.age >= days / 2 ? 1 : 0;
        const cx = pot ? pot.x : c.x;
        // The soil sits one quarter of the way down the painted pot.
        const baseY = (pot ? pot.y + 0.26 : c.y + 0.9) * T;
        const img = this.get();
        const f = frameFor(this.scene, `crop_${this.g.c.items[c.seed]!.grows!.crop}_${stage}`, 40, 30 + stage * 16);
        img
          .setTexture(f.key, f.frame)
          .setScale(f.frame ? ART_SCALE : 1)
          .setOrigin(0.5, 1)
          .setPosition((cx + 0.5) * T, baseY)
          .setDepth(pot ? (pot.y + 1) * T : baseY - 4);
        this.crops.push(img);
      }
    // gates: closed barriers and build sites not yet built
    for (const o of this.gates) o.destroy();
    this.gates.length = 0;
    const a = this.area!;
    const baked = !!art.ground.areas[a.id];
    for (const b of a.barriers) {
      const open = !!s.flags[b.flag];
      if (baked && b.art === 'broken_bridge') {
        // the ground is baked with the gap; once built, the whole bridge lies over it
        if (open && hasArt(`bridge_${b.id}`))
          this.gates.push(this.gateImage(`bridge_${b.id}`, b.rect.x * T - 12, b.rect.y * T - 12, -880));
        continue;
      }
      if (open) continue;
      // the water in the ground is the barrier
      if (baked && b.art === 'water') continue;
      if (b.art === 'wall') {
        this.unbuilt(b, a);
        continue;
      }
      const r = this.scene.add
        .rectangle(b.rect.x * T, b.rect.y * T, b.rect.w * T, b.rect.h * T, 0x5a3a22, 0.55)
        .setOrigin(0, 0)
        .setDepth(-700);
      r.setStrokeStyle(4, 0x3a2412, 0.9);
      this.gates.push(r);
    }
    for (const site of a.sites) {
      if (s.flags[site.flag] || !test(this.g, site.if)) continue;
      // a site under something big that stands there (the Great Tree's ladders) needs no outline round its foot
      if (this.covered(a, site.rect)) continue;
      const r = this.scene.add
        .rectangle(site.rect.x * T, site.rect.y * T, site.rect.w * T, site.rect.h * T, 0x7fd0ff, 0.28)
        .setOrigin(0, 0)
        .setDepth(-690)
        .setStrokeStyle(4, 0xffffff, 0.9);
      this.gates.push(r);
      this.scene.tweens.add({ targets: r, alpha: { from: 0.5, to: 1 }, duration: 800, yoyo: true, repeat: -1 });
    }
  }

  /** The cottage's trophy wall and third-step pieces, rebuilt only when a flag they show changes. */
  private syncDecor(): void {
    const a = this.area!;
    const f = this.g.s.flags;
    const key =
      a.id === 'cottage'
        ? `${f.house2 ? 1 : 0}${f.house3 ? 1 : 0}${TROPHIES.map((t) => (f[t.flag] ? 1 : 0)).join('')}`
        : '';
    if (key === this.decorKey) return;
    this.decorKey = key;
    for (const d of this.decor) d.destroy();
    this.decor.length = 0;
    if (!key) return;
    const wall = (name: string, x: number, y: number, size: number, depth: number) => {
      const fr = frameFor(this.scene, name, size, size);
      const img = this.scene.add.image(x * T, y * T, fr.key, fr.frame).setDepth(depth);
      img.setScale(size / (Math.max(img.width, img.height) || size));
      this.decor.push(img);
      return img;
    };
    if (f.house2) {
      this.decor.push(this.scene.add.image(BOARD.x * T, WALL_Y * T, boardTex(this.scene)).setDepth(-871));
      const plaque = plaqueTex(this.scene);
      for (const t of TROPHIES) {
        this.decor.push(this.scene.add.image(t.x * T, WALL_Y * T, plaque).setDepth(-870));
        if (f[t.flag]) wall(t.face, t.x, WALL_Y - 0.02, 34, -869);
      }
    }
    if (f.house3) {
      // a wide window on the island (the wall window, drawn larger) and three small pictures beside the mirror
      const fr = frameFor(this.scene, 'window_wall', 90, 75);
      const img = this.scene.add.image(HOUSE3_WINDOW.x * T, WALL_Y * T, fr.key, fr.frame).setDepth(-870);
      img.setScale((HOUSE3_WINDOW.w * T) / (img.width || 90));
      this.decor.push(img);
      for (const p of HOUSE3_PHOTOS) wall(p.id, p.x, p.y, p.s * 96, -870);
    }
  }

  /** A gate picture from the atlas (or its snow version in December), top left at x, y. */
  private gateImage(name: string, x: number, y: number, depth: number): Phaser.GameObjects.Image {
    const id = this.xmas && hasArt(name + '_snow') ? name + '_snow' : name;
    const f = frameFor(this.scene, id, T, T);
    return this.scene.add
      .image(x, y, f.key, f.frame)
      .setOrigin(0, 0)
      .setScale(f.frame ? ART_SCALE : 1)
      .setDepth(depth);
  }

  /** The part of a room not built yet: dark, behind a boarded partition with building things at its foot. */
  private unbuilt(b: Barrier, a: AreaDef): void {
    const { x, y, w, h } = b.rect;
    this.gates.push(
      this.scene.add
        .rectangle(x * T, (y - 1) * T, w * T, (h + 2) * T, 0x15121b, 1)
        .setOrigin(0, 0)
        .setDepth(-850),
    );
    // only the first closed piece shows the boards; the ones behind it are just dark
    const behind = a.barriers.some(
      (o) => o !== b && o.art === 'wall' && !this.g.s.flags[o.flag] && o.rect.x + o.rect.w === x,
    );
    if (behind) return;
    this.gates.push(
      this.scene.add
        .rectangle(x * T - 3, (y - 1) * T, 6, (h + 2) * T, 0x2a1a10, 0.85)
        .setOrigin(0, 0)
        .setDepth(-845),
    );
    for (let ty = y - 1; ty <= y + h; ty++) {
      const f = frameFor(this.scene, 'wall_boards', T, T);
      this.gates.push(
        this.scene.add
          .image(x * T, ty * T, f.key, f.frame)
          .setOrigin(0, 0)
          .setDisplaySize(T, T)
          .setDepth(-840),
      );
    }
    const f = frameFor(this.scene, 'building_props', T * 1.6, T);
    const props = this.scene.add
      .image((x + 0.15) * T, (y + h) * T - 2, f.key, f.frame)
      .setOrigin(0.5, 1)
      .setScale(f.frame ? ART_SCALE : 1);
    this.gates.push(props.setDepth(props.y - 6));
  }

  /** Is the middle of this rect under a standing (not flat) object that is there now? */
  private covered(a: AreaDef, r: Rect): boolean {
    const cx = Math.floor(r.x + r.w / 2);
    const cy = Math.floor(r.y + r.h / 2);
    return a.objects.some((o) => {
      const t = this.g.c.objects[o.type];
      if (!t || t.flat || (o.if && !test(this.g, o.if))) return false;
      return cx >= o.x && cx < o.x + (t.w ?? 1) && cy >= o.y && cy < o.y + (t.h ?? 1);
    });
  }

  private syncDrops(): void {
    const s = this.g.s;
    let n = 0;
    for (const d of s.drops) {
      if (d.area !== s.area) continue;
      let img = this.drops[n];
      if (!img) this.drops.push((img = this.scene.add.image(0, 0, '__DEFAULT')));
      const f = frameFor(this.scene, d.id, 48, 48);
      if (img.texture.key !== f.key || (f.frame && img.frame.name !== f.frame)) img.setTexture(f.key, f.frame);
      const size = Math.max(img.width, img.height) || 48;
      img
        .setVisible(true)
        .setScale(36 / size)
        .setPosition(d.x * T, d.y * T - 10 + Math.sin(this.t * 4 + n) * 4)
        .setDepth(d.y * T);
      n++;
    }
    for (let i = n; i < this.drops.length; i++) this.drops[i]!.setVisible(false);
  }

  shake(objIndex: number): void {
    const th = this.objs.get(objIndex);
    if (!th) return;
    const o = this.area?.objects[objIndex];
    const node = o && this.g.c.objects[o.type]?.node;
    if (!o || !node || !th.tree) {
      th.shake = 0.22;
      return;
    }
    const tree = th.tree;
    tree.side = this.cutSide(th);
    if (this.g.s.nodes[o.id] === undefined) {
      this.setCut(th, this.g.s.flags[`hit:${o.id}`] ?? 0, node.hits);
      th.shake = RECOIL;
      return;
    }

    // The rules have already paid the reward and rebuilt the world. Detach just the upper tree and put its
    // native stump in place immediately; the next world refresh is free to replace that stump, not the fall.
    this.setCut(th, node.hits, node.hits);
    th.img.setPosition(th.baseX, th.baseY).setScale(th.sx, th.sy).setAngle(0).setAlpha(1);
    this.positionCut(th);
    const direction = (tree.side < 0 ? 1 : -1) as -1 | 1;
    const centre = th.img.flipX ? 1 - tree.centre : tree.centre;
    const hinge = centre + direction * tree.width * 0.36;
    const cutY = th.img.height - tree.fromBase;
    const notchOffset = (centre + tree.side * tree.width * 0.5 - hinge) * th.img.width * th.sx;
    const crown = `crown-${th.img.frame.name}`;
    if (this.scene.textures.exists(crown)) th.img.setTexture(crown);
    else th.img.setCrop(0, 0, th.img.width, cutY);
    th.img
      .setOrigin(hinge, cutY / th.img.height)
      .setPosition(th.baseX + (hinge - 0.5) * th.img.width * th.sx, th.baseY - tree.fromBase * th.sy)
      .setDepth(th.baseY - 5.98);
    if (tree.notch) tree.notch.setDepth(th.baseY - 5.97);
    if (th.shadow) this.free(th.shadow);
    this.objs.delete(objIndex);
    if (this.falling.size >= MAX_FALLS) {
      const oldest = this.falling.keys().next().value as number;
      this.dropFall(this.falling.get(oldest)!);
      this.falling.delete(oldest);
    }
    this.falling.set(objIndex, { img: th.img, notch: tree.notch, notchOffset, direction, time: 0 });
    this.addObj(objIndex);
  }

  private updateFalls(dt: number): void {
    for (const [i, f] of this.falling) {
      f.time += dt;
      if (f.time >= FALL_END) {
        this.dropFall(f);
        this.falling.delete(i);
        continue;
      }
      const k = Math.min(1, Math.max(0, (f.time - FALL_START) / FALL_TIME));
      const low = this.g.s.opts.lowFx;
      const recoil = f.time < FALL_START ? Math.sin((f.time / FALL_START) * Math.PI) * (low ? 1.2 : 3) : 0;
      const settled = (f.time - FALL_START - FALL_TIME) / 0.2;
      const bounce = !low && settled > 0 && settled < 1 ? -3 * Math.sin(settled * Math.PI) * (1 - settled) : 0;
      const angle = f.direction * (90 * k * k * (3 - 2 * k) + recoil + bounce);
      f.img.setAngle(angle).setAlpha(f.time < FALL_FADE ? 1 : (FALL_END - f.time) / (FALL_END - FALL_FADE));
      if (f.notch) {
        if (f.time >= FALL_START) {
          this.free(f.notch);
          f.notch = undefined;
        } else {
          const rotation = (angle * Math.PI) / 180;
          f.notch
            .setPosition(f.img.x + f.notchOffset * Math.cos(rotation), f.img.y + f.notchOffset * Math.sin(rotation))
            .setAngle(angle);
        }
      }
    }
  }

  /**
   * Package 57a: a thing being played on moves (the toy train rolls, the see-saw tips, the trampoline dips). Offsets
   * in tiles from where it stands, an angle in degrees, and a height factor; pose(i, 0, 0, 0, 1) puts it back.
   * Only the one thing in use is posed, so nothing runs per frame for anything else.
   */
  pose(objIndex: number, dx: number, dy: number, ang: number, sy: number): void {
    const th = this.objs.get(objIndex);
    if (!th || th.shake > 0) return;
    const o = this.area?.objects[objIndex];
    if (!o || this.g.c.objects[o.type]?.flat) return;
    // she sits on it, so it never fades as if she stood behind it
    th.img
      .setPosition(th.baseX + dx * T, th.baseY + dy * T)
      .setAngle(ang)
      .setAlpha(1);
    th.img.setScale(th.sx, th.sy * sy);
  }

  /**
   * How far up the draw order someone standing at `feetY` (world pixels) must go to be drawn on the thing they play
   * on, never less than `min`. The trampoline's mat lies over a tile above its legs: a fixed lift left the jumpers
   * behind its rim, only their heads showing (G, 22 Nov 2026).
   */
  funBias(objIndex: number, feetY: number, min: number): number {
    const th = this.objs.get(objIndex);
    return th ? Math.max(min, th.img.depth - feetY + 2) : min;
  }

  update(
    cam: Phaser.Cameras.Scene2D.Camera,
    dt: number,
    xmas: boolean,
    light: (x: number, y: number, r: number) => void,
    reducedMotion = false,
  ): void {
    if (!this.area) return;
    this.t += dt;
    const treeDt = this.g.rt.paused ? 0 : dt;
    this.treeTime += treeDt;
    const view = cam.worldView;
    const hx = this.g.s.x * T;
    const hy = this.g.s.y * T;
    if (xmas !== this.xmas) {
      this.xmas = xmas;
      this.setArea(this.area);
    }
    const rect = `${Math.floor(view.x / (T * BUCKET))},${Math.floor(view.y / (T * BUCKET))},${Math.floor(view.right / (T * BUCKET))},${Math.floor(view.bottom / (T * BUCKET))}`;
    const rev = this.g.rt.worldRev;
    if (rev !== this.rev) {
      // Liveness may have changed: drop everything that is gone and rebuild what changed state.
      for (const [i, th] of this.objs) {
        this.drop(th);
        this.objs.delete(i);
      }
      this.refresh(view);
      this.refreshPlaced();
      this.rev = rev;
      this.lastRect = rect;
    } else if (rect !== this.lastRect) {
      this.refresh(view);
      this.lastRect = rect;
    }
    this.vegetation.update(view, dt, {
      paused: this.g.rt.paused,
      reducedMotion,
      lowFx: this.g.s.opts.lowFx,
      heroX: this.g.s.x,
      heroY: this.g.s.y,
    });
    for (const th of this.objs.values()) {
      if (th.tree) {
        th.shake = Math.max(0, th.shake - treeDt);
        const sway =
          th.sway && !reducedMotion
            ? windStrength(this.treeTime, th.baseX, th.baseY, th.windPhase) * (this.g.s.opts.lowFx ? 1.1 : 2.2)
            : 0;
        const k = th.shake / RECOIL;
        const recoil = Math.sin((1 - k) * Math.PI * 3) * 4 * k * (this.g.s.opts.lowFx ? 0.4 : 1);
        th.img
          .setPosition(th.baseX, th.baseY)
          .setScale(th.sx, th.sy)
          .setAngle(sway - th.tree.side * recoil);
      } else if (th.shake > 0) {
        th.shake -= dt;
        const k = Math.max(0, th.shake) / 0.22;
        th.img.x = th.baseX + Math.sin(th.shake * 70) * 5 * k;
        th.img.setScale(th.sx * (1 + 0.08 * k), th.sy * (1 - 0.1 * k));
      } else if (th.sway)
        th.img.setAngle(
          reducedMotion
            ? 0
            : windStrength(this.treeTime, th.baseX, th.baseY, th.windPhase) * (this.g.s.opts.lowFx ? 0.7 : 1.35),
        );
      if (th.light) light(th.baseX, th.baseY - 40, th.light);
      if (th.lamps) for (const [dx, dy] of th.lamps) light(th.baseX + dx, th.baseY + dy, 2);
      if (th.fade) {
        // she is behind it: her feet above its foot and inside the top part of the picture
        const img = th.img;
        const half = img.displayWidth * 0.38;
        const behind =
          hx > img.x - half && hx < img.x + half && hy < th.baseY - 12 && hy > th.baseY - img.displayHeight + 24;
        const want = behind ? FADE : 1;
        if (img.alpha !== want) img.setAlpha(img.alpha + (want - img.alpha) * Math.min(1, (th.tree ? treeDt : dt) * 8));
        if (Math.abs(img.alpha - want) < 0.01) img.setAlpha(want);
      }
      if (th.tree) this.positionCut(th);
    }
    this.updateFalls(treeDt);
    for (const th of this.placed.values()) if (th.light) light(th.baseX, th.baseY - 30, th.light);
    const near = WAVE_R * T;
    for (const l of this.living.values()) {
      const dx = hx - l.x;
      const dy = hy - l.y;
      l.p.play(dx * dx + dy * dy < near * near ? 'wave' : 'idle', 'down');
      l.p.update(dt);
    }
    this.syncDrops();
  }

  get count(): number {
    return this.objs.size + this.placed.size + this.living.size;
  }

  /** Visible natural tree images for water reflection passes. Rebuilt only when camera-visible objects change. */
  getReflectionTargets(): readonly Phaser.GameObjects.Image[] {
    return this.reflectionTargets;
  }

  /** Read-only world-space animation sample for browser checks and art review. Call only when inspecting. */
  windSnapshot(): {
    time: number;
    grassCount: number;
    grass: readonly WindPoint[];
    treeCount: number;
    trees: readonly WindPoint[];
  } {
    const grass: VegetationSnapshot = this.vegetation.snapshot();
    const trees = this.reflectionTargets.map((img) => ({ x: img.x, y: img.y, angle: img.angle }));
    return { ...grass, treeCount: trees.length, trees };
  }

  private syncReflectionTargets(): void {
    this.reflectionTargets.length = 0;
    for (const thing of this.objs.values())
      if (thing.reflectable && thing.img.visible) this.reflectionTargets.push(thing.img);
  }
}
