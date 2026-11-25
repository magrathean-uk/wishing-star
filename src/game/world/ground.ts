// The ground: baked chunks (their size is in the ground index) streamed in a ring round the camera, over one sheet of moving water.
import type Phaser from 'phaser';
import { TERRAIN } from '../../core/grid.ts';
import type { AreaDef } from '../../core/types.ts';
import { art, dropChunk, wantChunk } from '../assets.ts';
import { WaterSurface, type WaterFrameState, type WaterSnapshot } from './waterSurface.ts';

/** Size of a coloured stand-in chunk, for maps that have not been baked. */
const FLAT_CHUNK = 1024;
const TILES = 16;
const FLAT: Record<string, number> = {
  g: 0x6cbe58,
  G: 0x7ec846,
  d: 0x3a783e,
  p: 0xd6b884,
  k: 0xb0aaa0,
  s: 0xeedca0,
  m: 0x8c6446,
  f: 0xc8a06e,
  t: 0x96969e,
  a: 0x606e54,
  b: 0xa06e3c,
  e: 0xc8c8c8,
  o: 0x78503c,
  c: 0x6e6056,
  r: 0x464046,
  v: 0x14141c,
  h: 0x28643a,
};

export class Ground {
  private scene: Phaser.Scene;
  private water: WaterSurface;
  private images = new Map<string, Phaser.GameObjects.Image>();
  /** dark bands round a room, so the cave water sheet never shows beyond the map's edge */
  private frame: Phaser.GameObjects.Rectangle[] = [];
  private area: AreaDef | null = null;
  private set = 'n';
  private winter = false;
  private baked = false;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.water = new WaterSurface(scene);
    scene.events.once('shutdown', () => this.destroy());
  }

  setArea(area: AreaDef, snow: boolean): void {
    const info = art.ground.areas[area.id];
    const set = snow && info?.sets.includes('s') ? 's' : 'n';
    // A hop inside the same ground (quick travel on the island) keeps its chunks: the ring frees what is now far.
    // Otherwise every chunk goes, freed by texture key (the map is keyed by chunk position).
    if (this.area?.id !== area.id || this.set !== set) {
      for (const img of this.images.values()) {
        dropChunk(this.scene, img.texture.key);
        img.destroy();
      }
      this.images.clear();
    }
    this.area = area;
    this.winter = snow;
    this.baked = !!info;
    this.set = set;
    const cave = area.id.startsWith('mine') || area.id === 'cave';
    this.water.setArea(area, snow);
    this.water.setVisible(!area.indoor || cave);
    for (const r of this.frame) r.destroy();
    this.frame = [];
    if (area.indoor) {
      const W = area.w * 64;
      const H = area.h * 64;
      const M = 4096;
      for (const [x, y, w, h] of [
        [-M, -M, W + 2 * M, M],
        [-M, H, W + 2 * M, M],
        [-M, 0, M, H],
        [W, 0, M, H],
      ] as const)
        this.frame.push(this.scene.add.rectangle(x, y, w, h, 0x14141c, 1).setOrigin(0, 0).setDepth(-1600));
    }
  }

  /** A plain coloured stand-in chunk, drawn from the tile grid, for maps that have not been baked. */
  private flatChunk(cx: number, cy: number): string {
    const a = this.area!;
    const key = `flat_${a.id}_${cx}_${cy}`;
    if (this.scene.textures.exists(key)) return key;
    const g = this.scene.make.graphics({ x: 0, y: 0 }, false);
    const s = 16;
    for (let ty = 0; ty < TILES; ty++)
      for (let tx = 0; tx < TILES; tx++) {
        const x = cx * TILES + tx;
        const y = cy * TILES + ty;
        const ch = x < a.w && y < a.h ? a.terrain[y]!.charAt(x) : 'v';
        if (TERRAIN[ch]?.water) continue;
        const shade = (x + y) % 2 ? 0 : 0x060606;
        g.fillStyle((FLAT[ch] ?? 0xff00ff) - shade, 1);
        g.fillRect(tx * s, ty * s, s, s);
      }
    g.generateTexture(key, TILES * s, TILES * s);
    g.destroy();
    return key;
  }

  update(cam: Phaser.Cameras.Scene2D.Camera, dt: number, waterState: WaterFrameState = {}): void {
    if (this.area && waterState.winter !== undefined && this.winter !== waterState.winter)
      this.setArea(this.area, waterState.winter);
    const view = cam.worldView;
    const CHUNK = this.baked ? art.ground.chunk : FLAT_CHUNK;
    this.water.update(cam, dt, waterState);
    const a = this.area;
    if (!a) return;
    const pad = 420;
    const cx0 = Math.max(0, Math.floor((view.x - pad) / CHUNK));
    const cy0 = Math.max(0, Math.floor((view.y - pad) / CHUNK));
    const cx1 = Math.min(Math.ceil((a.w * 64) / CHUNK) - 1, Math.floor((view.right + pad) / CHUNK));
    const cy1 = Math.min(Math.ceil((a.h * 64) / CHUNK) - 1, Math.floor((view.bottom + pad) / CHUNK));
    for (let cy = cy0; cy <= cy1; cy++)
      for (let cx = cx0; cx <= cx1; cx++) {
        const id = `${cx}_${cy}`;
        if (this.images.has(id)) continue;
        if (!this.baked) {
          const key = this.flatChunk(cx, cy);
          this.images.set(
            id,
            this.scene.add
              .image(cx * CHUNK, cy * CHUNK, key)
              .setOrigin(0, 0)
              .setScale(4)
              .setDepth(-1500),
          );
          continue;
        }
        const areaId = a.id;
        const season = this.set;
        wantChunk(this.scene, areaId, season, cx, cy, (key) => {
          // a chunk that lands after she left the area (or the ring) is let go, not left resident
          if (this.area?.id !== areaId || this.set !== season) {
            dropChunk(this.scene, key);
            return;
          }
          if (this.images.has(id)) return;
          this.images.set(
            id,
            this.scene.add
              .image(cx * CHUNK, cy * CHUNK, key)
              .setOrigin(0, 0)
              .setDepth(-1500),
          );
        });
      }
    // Let go of chunks well outside the ring.
    for (const [id, img] of this.images) {
      const [cx, cy] = id.split('_').map(Number) as [number, number];
      if (cx < cx0 - 1 || cx > cx1 + 1 || cy < cy0 - 1 || cy > cy1 + 1) {
        const key = img.texture.key;
        img.destroy();
        this.images.delete(id);
        if (this.baked) dropChunk(this.scene, key);
      }
    }
  }

  waterSnapshot(): WaterSnapshot {
    return this.water.snapshot();
  }

  destroy(): void {
    this.water.destroy();
    for (const img of this.images.values()) {
      if (this.baked) dropChunk(this.scene, img.texture.key);
      img.destroy();
    }
    this.images.clear();
    for (const frame of this.frame) frame.destroy();
    this.frame = [];
  }
}
