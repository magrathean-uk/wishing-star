import type Phaser from 'phaser';
import { TERRAIN } from '../../core/grid.ts';
import type { AreaDef, Game } from '../../core/types.ts';
import { worldFrame } from '../assets.ts';
import { PlacedTileMask } from './placed-mask.ts';

export { PlacedTileMask } from './placed-mask.ts';

const TILE = 64;
const CELL = 2;
const MAX_TUFTS = 112;
const BLOCKY = 'LFCMK';
const SOIL = new Set(['g', 'd']);
const WATER = new Set(['w', 'W', 'q', 'u']);
const OPEN_CELS = [1, 2, 3, 4, 5, 6, 10, 11, 12, 13, 14, 15];
const SHORE_CELS = [7, 8, 9, 16, 17, 18];
const TALL_CELS = new Set([7, 8, 9]);

export interface WindPoint {
  x: number;
  y: number;
  angle: number;
}

export interface VegetationSnapshot {
  time: number;
  paused: boolean;
  reducedMotion: boolean;
  grassCount: number;
  grass: readonly WindPoint[];
  blockyGrassCount: number;
  blockyGrass: readonly WindPoint[];
}

interface Clump {
  image: Phaser.GameObjects.Image;
  x: number;
  y: number;
  tileX: number;
  tileY: number;
  phase: number;
  touch: number;
  blocky: boolean;
}

function placeHash(x: number, y: number, seed: number): number {
  let h = Math.imul(x * 374761393 + y * 668265263 + seed * 2147483647, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function areaSeed(id: string): number {
  let seed = 2166136261;
  for (let i = 0; i < id.length; i++) seed = Math.imul(seed ^ id.charCodeAt(i), 16777619);
  return seed | 0;
}

/** A continuous, gently travelling gust. Position offsets make one breeze cross a whole area as a wave. */
export function windStrength(time: number, x: number, y: number, phase = 0): number {
  const front = Math.sin(time * 0.46 - x * 0.00105 + y * 0.00072 + phase);
  const envelope = 0.62 + Math.sin(time * 0.18 - x * 0.0002 + y * 0.00017) * 0.2;
  const leaf = Math.sin(time * 1.17 - x * 0.0017 - y * 0.0011 + phase * 1.7) * 0.13;
  return front * envelope + leaf;
}

export class Vegetation {
  private readonly scene: Phaser.Scene;
  private game: Game;
  private readonly active = new Map<number, Clump>();
  private readonly pool: Phaser.GameObjects.Image[] = [];
  private readonly placedTiles = new PlacedTileMask();
  private area: AreaDef | null = null;
  private blocked = new Uint8Array();
  private authoredTufts = new Uint8Array();
  private areaSalt = 0;
  private time = 0;
  private snow = false;
  private paused = false;
  private reducedMotion = false;
  private lastRect = '';
  private previousHeroX = Number.NaN;
  private previousHeroY = Number.NaN;
  private touchDx = 0;
  private touchDy = 0;

  constructor(scene: Phaser.Scene, game: Game) {
    this.scene = scene;
    this.game = game;
  }

  setGame(game: Game): void {
    this.game = game;
    this.placedTiles.invalidate();
    if (this.area) this.setArea(this.area, this.snow);
  }

  setArea(area: AreaDef, snow: boolean): void {
    for (const tuft of this.active.values()) {
      tuft.image.setVisible(false);
      this.pool.push(tuft.image);
    }
    this.area = area;
    this.snow = snow;
    this.placedTiles.invalidate();
    this.areaSalt = areaSeed(area.id);
    this.lastRect = '';
    this.active.clear();
    this.blocked = new Uint8Array(area.w * area.h);
    this.authoredTufts = new Uint8Array(area.w * area.h);
    if (area.indoor) return;
    for (const object of area.objects) {
      const type = this.game.c.objects[object.type];
      if (object.type === 'grass_tuft') this.authoredTufts[object.y * area.w + object.x] = 1;
      if (type?.flat && object.type !== 'grass_tuft') {
        this.blocked[object.y * area.w + object.x] = 1;
        continue;
      }
      if (!type || (type.flat && !type.node)) continue;
      const width = type.w ?? 1;
      const height = type.h ?? 1;
      for (let y = object.y; y < object.y + height; y++)
        for (let x = object.x; x < object.x + width; x++)
          if (x >= 0 && y >= 0 && x < area.w && y < area.h) this.blocked[y * area.w + x] = 1;
    }
  }

  update(
    view: Phaser.Geom.Rectangle,
    dt: number,
    options: { paused: boolean; reducedMotion: boolean; lowFx: boolean; heroX: number; heroY: number },
  ): void {
    if (!this.area) return;
    if (this.placedTiles.refresh(this.game, this.area)) this.lastRect = '';
    const shouldFreeze = options.paused || options.reducedMotion;
    this.paused = options.paused;
    this.reducedMotion = options.reducedMotion;
    if (!shouldFreeze) this.time += dt;

    const movedX = Number.isFinite(this.previousHeroX) ? options.heroX - this.previousHeroX : 0;
    const movedY = Number.isFinite(this.previousHeroY) ? options.heroY - this.previousHeroY : 0;
    this.previousHeroX = options.heroX;
    this.previousHeroY = options.heroY;
    const stepped =
      !shouldFreeze && Math.abs(movedX) + Math.abs(movedY) > 0.003 && Math.abs(movedX) + Math.abs(movedY) < 0.5;
    if (stepped) {
      this.touchDx = Math.sign(movedX);
      this.touchDy = Math.sign(movedY);
    }

    const rect = `${Math.floor(view.x / (TILE * CELL))},${Math.floor(view.y / (TILE * CELL))},${Math.floor(view.right / (TILE * CELL))},${Math.floor(view.bottom / (TILE * CELL))}`;
    if (rect !== this.lastRect) {
      this.refresh(view);
      this.lastRect = rect;
    }

    const heroX = options.heroX * TILE;
    const heroY = options.heroY * TILE;
    const reduced = options.reducedMotion ? 0 : options.lowFx ? 0.44 : 1;
    for (const tuft of this.active.values()) {
      const distanceX = heroX - tuft.x;
      const distanceY = heroY - tuft.y;
      const distance = Math.hypot(distanceX, distanceY);
      if (stepped && distance < TILE * 0.86) {
        const approach = (this.touchDx * distanceX + this.touchDy * distanceY) / Math.max(1, distance);
        tuft.touch = Math.max(-1, Math.min(1, tuft.touch - approach * 0.48));
      }
      if (options.reducedMotion) tuft.touch = 0;
      else if (!options.paused) tuft.touch *= Math.exp(-dt * 5.2);
      const local = windStrength(this.time, tuft.x, tuft.y, tuft.phase);
      const footfall = tuft.touch * 8.5;
      const breeze = reduced * (tuft.blocky ? 3.25 : this.snow ? 3.7 : 5.1);
      const angle = options.reducedMotion ? 0 : local * breeze + footfall;
      if (Math.abs(tuft.image.angle - angle) > 0.02) tuft.image.setAngle(angle);
      // The grass and the render settle into a colder, quieter palette after the seasonal change.
      const alpha = this.snow ? 0.8 : 1;
      if (tuft.image.alpha !== alpha) tuft.image.setAlpha(alpha);
    }
  }

  snapshot(): VegetationSnapshot {
    const grass = Array.from(this.active.values(), (tuft) => ({ x: tuft.x, y: tuft.y, angle: tuft.image.angle }));
    const blockyGrass = Array.from(this.active.values())
      .filter((tuft) => tuft.blocky)
      .map((tuft) => ({ x: tuft.x, y: tuft.y, angle: tuft.image.angle }));
    return {
      time: this.time,
      paused: this.paused,
      reducedMotion: this.reducedMotion,
      grassCount: grass.length,
      grass,
      blockyGrassCount: blockyGrass.length,
      blockyGrass,
    };
  }

  destroy(): void {
    for (const tuft of this.active.values()) tuft.image.destroy();
    for (const image of this.pool) image.destroy();
    this.active.clear();
    this.pool.length = 0;
  }

  private refresh(view: Phaser.Geom.Rectangle): void {
    const area = this.area!;
    const isOutdoor = !area.indoor && !area.id.startsWith('mine') && area.id !== 'cave';
    const want = new Set<number>();
    if (isOutdoor) {
      const x0 = Math.max(1, Math.floor(view.left / (TILE * CELL)) - 1);
      const y0 = Math.max(1, Math.floor(view.top / (TILE * CELL)) - 1);
      const x1 = Math.min(Math.ceil(area.w / CELL) - 1, Math.floor(view.right / (TILE * CELL)) + 1);
      const y1 = Math.min(Math.ceil(area.h / CELL) - 1, Math.floor(view.bottom / (TILE * CELL)) + 1);
      for (let cy = y0; cy <= y1; cy++) {
        for (let cx = x0; cx <= x1; cx++) {
          const key = cy * 1000 + cx;
          const base = placeHash(cx, cy, this.areaSalt);
          if (base > 0.31) continue;
          const choice = placeHash(cx, cy, this.areaSalt ^ 0x5217);
          let tx = cx * CELL + Math.floor(choice * CELL);
          let ty = cy * CELL + Math.floor(placeHash(cx, cy, this.areaSalt ^ 0x749b) * CELL);
          if (!this.grassy(tx, ty)) {
            const found = this.findGrassy(cx, cy);
            if (!found) continue;
            [tx, ty] = found;
          }
          const blocky = this.blockyGrass(tx, ty);
          if (blocky && base > 0.15) continue;
          const active = this.active.get(key);
          if (active && (active.tileX !== tx || active.tileY !== ty || active.blocky !== blocky)) {
            active.image.setVisible(false);
            this.pool.push(active.image);
            this.active.delete(key);
          }
          want.add(key);
          if (this.active.has(key) || this.active.size >= MAX_TUFTS) continue;
          const x = (tx + 0.2 + placeHash(cx, cy, this.areaSalt ^ 0x5b21) * 0.6) * TILE;
          const y = (ty + 0.48 + placeHash(cy, cx, this.areaSalt ^ 0x27ae) * 0.38) * TILE;
          this.add(key, x, y, base, tx, ty, blocky);
        }
      }
    }
    for (const [key, tuft] of this.active) {
      if (want.has(key)) continue;
      tuft.image.setVisible(false);
      this.pool.push(tuft.image);
      this.active.delete(key);
    }
  }

  private grassy(x: number, y: number): boolean {
    const area = this.area!;
    if (x < 0 || y < 0 || x >= area.w || y >= area.h) return false;
    const region = area.region[y]?.charAt(x) ?? ' ';
    if (this.blocked[y * area.w + x] || this.placedTiles.has(area, x, y)) return false;
    const code = area.terrain[y]?.charAt(x) ?? 'v';
    if ((!SOIL.has(code) && code !== 'G') || !TERRAIN[code]) return false;
    if (BLOCKY.includes(region) || code === 'G') return !this.authoredTufts[y * area.w + x] && !TERRAIN[code]?.water;
    return !TERRAIN[code]?.water;
  }

  private blockyGrass(x: number, y: number): boolean {
    const area = this.area!;
    const region = area.region[y]?.charAt(x) ?? ' ';
    const code = area.terrain[y]?.charAt(x) ?? 'v';
    return BLOCKY.includes(region) || code === 'G';
  }

  private findGrassy(cx: number, cy: number): [number, number] | null {
    const start = Math.floor(placeHash(cx, cy, this.areaSalt ^ 0x1493) * 4);
    for (let offset = 0; offset < 4; offset++) {
      const i = (start + offset) % 4;
      const x = cx * CELL + (i & 1);
      const y = cy * CELL + (i >> 1);
      if (this.grassy(x, y)) return [x, y];
    }
    return null;
  }

  private nearWater(x: number, y: number): boolean {
    const area = this.area!;
    return [
      area.terrain[y - 1]?.charAt(x),
      area.terrain[y + 1]?.charAt(x),
      area.terrain[y]?.charAt(x - 1),
      area.terrain[y]?.charAt(x + 1),
    ].some((code) => !!code && WATER.has(code));
  }

  private add(key: number, x: number, y: number, seed: number, tx: number, ty: number, blocky: boolean): void {
    const shore = this.nearWater(tx, ty);
    const celList = shore && seed < 0.19 ? SHORE_CELS : OPEN_CELS;
    const cel = blocky ? 0 : celList[Math.floor(placeHash(tx, ty, this.areaSalt ^ 0x39f1) * celList.length)]!;
    const name = blocky ? (this.snow ? 'grass_tuft_snow' : 'grass_tuft') : `wind_grass_${String(cel).padStart(2, '0')}`;
    const tall = TALL_CELS.has(cel);
    const frame = worldFrame(this.scene, name, 44, tall ? 64 : blocky ? 29 : 39);
    const image = this.pool.pop() ?? this.scene.add.image(0, 0, frame.key, frame.frame);
    if (image.texture.key !== frame.key || image.frame.name !== frame.frame) image.setTexture(frame.key, frame.frame);
    const size = 0.82 + placeHash(tx, ty, this.areaSalt ^ 0x0f23) * 0.34;
    const width = (blocky ? 44 : 40) * size;
    const height = (tall ? 64 : blocky ? 29 : 39) * size;
    image
      .setVisible(true)
      .setOrigin(0.5, blocky ? 1 : 0.90625)
      .setDisplaySize(width, height)
      .setPosition(x, y)
      .setAngle(0)
      .setDepth(y + 1.5)
      .setTint(this.snow ? 0xe6edf6 : 0xffffff)
      .setFlipX(placeHash(tx, ty, this.areaSalt ^ 0x13a9) > 0.5);
    this.active.set(key, {
      image,
      x,
      y,
      tileX: tx,
      tileY: ty,
      phase: placeHash(tx, ty, this.areaSalt ^ 0x9c47) * Math.PI * 2,
      touch: 0,
      blocky,
    });
  }
}
