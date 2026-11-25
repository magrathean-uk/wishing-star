import type Phaser from 'phaser';
import type { AreaDef } from '../../core/types.ts';
import { TERRAIN } from '../../core/grid.ts';

const BASE_PATH = `${import.meta.env.BASE_URL}assets/`;
const TILE = 64;
const BASE_KEY = 'ground_water';
const BASE_FALLBACK_KEY = 'fx_water_base';
const MATERIAL_KEY = 'water_material_tiles';
const GLINT_KEY = 'water_glint_tiles';
const GLINT_FALLBACK_KEY = 'fx_water_glint_tiles';
const SHORE_KEY = 'water_shore_tiles';
const BASE_DEPTH = -2002;
const MATERIAL_DEPTH = -2001;
const REFLECTION_DEPTH = -1999;
const WATERLIGHT_DEPTH = -1998;
const GROUND_DEPTH = -1500;
const MATERIAL_COLUMNS = 12;
const MATERIAL_VARIATIONS = 6;
const MATERIAL_PHASES = 3;
const RIVER_DIRECTIONS = 4;
const MATERIAL_OFFSETS = [0, 18, 90, 108] as const;
const MATERIAL_TILE_COUNT = 126;
const MATERIAL_ROWS = Math.ceil(MATERIAL_TILE_COUNT / MATERIAL_COLUMNS);
const SHORE_COLUMNS = 12;
const SHORE_BITS = { north: 1, east: 2, south: 4, west: 8 } as const;
const MATERIALS = ['sea', 'river', 'pond', 'cave'] as const;
const MATERIAL_NAMES = ['sea', 'river', 'pond', 'cave'] as const;
const STYLE_WASH: Record<WaterMaterialName, string> = {
  sea: 'rgba(68, 155, 184, 0.025)',
  river: 'rgba(64, 171, 165, 0.035)',
  pond: 'rgba(38, 145, 137, 0.045)',
  cave: 'rgba(32, 73, 131, 0.08)',
};
const MATERIAL_PERIOD: Record<WaterMaterialName, number> = {
  sea: 0.92,
  river: 0.42,
  pond: 1.16,
  cave: 1.5,
};
const GLINT_SPEED: Record<WaterMaterialName, number> = {
  sea: 0.72,
  river: 0.24,
  pond: 1.2,
  cave: 1.6,
};

export type WaterMaterialName = (typeof MATERIAL_NAMES)[number];

export interface WaterFrameState {
  /** Sky darkness, from 0 in daylight to 1 at the darkest. */
  darkness?: number;
  paused?: boolean;
  reducedMotion?: boolean;
  winter?: boolean;
}

export interface WaterGrid {
  base: number[][];
  /** Painted water expanded beneath translucent shore pixels and one outdoor sea border. */
  underlay: number[][];
  material: number[][];
  shore: number[][];
  shoreMask: number[][];
  flow: number[][];
  type: number[][];
  variation: number[][];
  phaseOffset: number[][];
  counts: Record<WaterMaterialName, number>;
  shorelineCells: number;
}

export interface WaterSnapshot {
  areaId: string;
  materialCounts: Record<WaterMaterialName, number>;
  shorelineCellCount: number;
  baseWaterTileCount: number;
  materialTileCount: number;
  glintTileCount: number;
  shoreTileCount: number;
  visibleWaterTileCount: number;
  visibleShoreTileCount: number;
  motionTime: number;
  paused: boolean;
  reducedMotion: boolean;
  winter: boolean;
  darkness: number;
  largestSurfaceCanvasPixels: number;
  largestAtlasTexturePixels: number;
  depths: { base: number; material: number; reflections: number; highlights: number; ground: number };
}

interface VisibleWaterCell {
  x: number;
  y: number;
  type: number;
  variation: number;
  phaseOffset: number;
  flow: number;
  shoreMask: number;
}

interface ViewBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface TileLayerSet {
  map: Phaser.Tilemaps.Tilemap;
  tileset: Phaser.Tilemaps.Tileset;
  layer: Phaser.Tilemaps.TilemapLayer;
}

/** Build water type, atlas and bank data once when entering an area. */
export function makeWaterGrid(
  area: Pick<AreaDef, 'id' | 'w' | 'h' | 'terrain'> & {
    barriers?: AreaDef['barriers'];
    indoor?: boolean;
  },
): WaterGrid {
  const base = blankGrid(area.w, area.h);
  const underlay = blankGrid(area.w + 2, area.h + 2);
  const material = blankGrid(area.w, area.h);
  const shore = blankGrid(area.w, area.h);
  const shoreMaskGrid = blankGrid(area.w, area.h);
  const flow = blankGrid(area.w, area.h, 0);
  const typeGrid = blankGrid(area.w, area.h);
  const variationGrid = blankGrid(area.w, area.h);
  const phaseGrid = blankGrid(area.w, area.h, 0);
  const counts: Record<WaterMaterialName, number> = { sea: 0, river: 0, pond: 0, cave: 0 };
  const brokenBridge = new Uint8Array(area.w * area.h);
  let shorelineCells = 0;

  for (const barrier of area.barriers ?? []) {
    if (barrier.art !== 'broken_bridge') continue;
    const rect = barrier.rect;
    for (let y = rect.y; y < rect.y + rect.h; y++) {
      for (let x = rect.x; x < rect.x + rect.w; x++) {
        if (area.terrain[y]?.charAt(x) === 'b') brokenBridge[y * area.w + x] = 1;
      }
    }
  }

  const waterTypeAt = (x: number, y: number): number => {
    if (x < 0 || y < 0 || x >= area.w || y >= area.h) return area.indoor ? -1 : 0;
    if (brokenBridge[y * area.w + x]) return 1;
    const type = TERRAIN[area.terrain[y]?.charAt(x) ?? '']?.water;
    return type === 'sea' ? 0 : type === 'river' ? 1 : type === 'pond' ? 2 : type === 'cave' ? 3 : -1;
  };
  const hash = (x: number, y: number): number =>
    (Math.imul(x + 1, 0x45d9f3b) ^ Math.imul(y + 7, 0x119de1f3) ^ Math.imul(area.id.length, 0x3449)) >>> 0;

  for (let y = 0; y < area.h; y++) {
    for (let x = 0; x < area.w; x++) {
      const type = waterTypeAt(x, y);
      if (type < 0) continue;
      const name = MATERIALS[type]!;
      const seed = hash(x, y);
      const variation = seed % MATERIAL_VARIATIONS;
      const phaseOffset = (seed >>> 7) % 3;
      counts[name]++;
      const baseTile = modulo(y, 8) * 8 + modulo(x, 8);
      base[y]![x] = baseTile;
      underlay[y + 1]![x + 1] = baseTile;
      typeGrid[y]![x] = type;
      variationGrid[y]![x] = variation;
      phaseGrid[y]![x] = phaseOffset;

      const north = waterTypeAt(x, y - 1) >= 0;
      const east = waterTypeAt(x + 1, y) >= 0;
      const south = waterTypeAt(x, y + 1) >= 0;
      const west = waterTypeAt(x - 1, y) >= 0;
      let mask = 0;
      if (!north) mask |= SHORE_BITS.north;
      if (!east) mask |= SHORE_BITS.east;
      if (!south) mask |= SHORE_BITS.south;
      if (!west) mask |= SHORE_BITS.west;
      if (mask) {
        shoreMaskGrid[y]![x] = mask;
        // Reserve nine frames for each of sixteen bank shapes: three variations, three pulse frames.
        shore[y]![x] = mask * 9 + variation * 3 + phaseOffset;
        shorelineCells++;
      }

      if (name === 'river') {
        const horizontal = east || west;
        const vertical = north || south;
        if (horizontal && vertical) {
          const ne = north && east;
          const se = south && east;
          const sw = south && west;
          const nw = north && west;
          flow[y]![x] = ne || sw ? 1 : se || nw ? 3 : 0;
        } else flow[y]![x] = vertical ? 2 : 0;
      }

      material[y]![x] = materialTileIndex(type, variation, phaseOffset, flow[y]![x]!);
    }
  }

  // The baked ground texture has soft alpha around its painted banks. Continue only the base water beneath
  // that one-tile fringe; land art is drawn above it, and the texture remains a tilemap rather than a large bitmap.
  for (let y = -1; y <= area.h; y++) {
    for (let x = -1; x <= area.w; x++) {
      const inArea = x >= 0 && y >= 0 && x < area.w && y < area.h;
      if (inArea && typeGrid[y]![x]! >= 0) continue;
      if (!inArea && area.indoor) continue;
      let touchesWater = !inArea;
      for (let dy = -1; dy <= 1 && !touchesWater; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (waterTypeAt(x + dx, y + dy) >= 0) {
            touchesWater = true;
            break;
          }
        }
      }
      if (touchesWater) underlay[y + 1]![x + 1] = modulo(y, 8) * 8 + modulo(x, 8);
    }
  }

  return {
    base,
    underlay,
    material,
    shore,
    shoreMask: shoreMaskGrid,
    flow,
    type: typeGrid,
    variation: variationGrid,
    phaseOffset: phaseGrid,
    counts,
    shorelineCells,
  };
}

function blankGrid(width: number, height: number, fill = -1): number[][] {
  return Array.from({ length: height }, () => Array(width).fill(fill));
}

function modulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function materialTileIndex(type: number, variation: number, phase: number, flow: number): number {
  const direction = type === 1 ? flow % RIVER_DIRECTIONS : 0;
  return MATERIAL_OFFSETS[type]! + (direction * MATERIAL_VARIATIONS + variation) * MATERIAL_PHASES + phase;
}

function createCanvasTexture(
  scene: Phaser.Scene,
  key: string,
  width: number,
  height: number,
): Phaser.Textures.CanvasTexture | null {
  return scene.textures.exists(key)
    ? (scene.textures.get(key) as Phaser.Textures.CanvasTexture)
    : scene.textures.createCanvas(key, width, height);
}

function createFallbackWater(scene: Phaser.Scene): void {
  if (scene.textures.exists(BASE_FALLBACK_KEY)) return;
  const texture = createCanvasTexture(scene, BASE_FALLBACK_KEY, 512, 512);
  if (!texture) return;
  const context = texture.getContext();
  context.fillStyle = '#4f9eae';
  context.fillRect(0, 0, 512, 512);
  for (let row = 0; row < 12; row++) {
    const y = row * 43 + 12;
    context.strokeStyle = 'rgba(225,255,244,0.11)';
    context.lineWidth = 3;
    context.lineCap = 'round';
    context.beginPath();
    context.moveTo(0, y);
    context.bezierCurveTo(150, y - 11, 332, y + 9, 512, y - 2);
    context.stroke();
  }
  texture.refresh();
}

function createFallbackGlints(scene: Phaser.Scene): void {
  if (scene.textures.exists(GLINT_FALLBACK_KEY)) return;
  const texture = createCanvasTexture(scene, GLINT_FALLBACK_KEY, 512, 512);
  if (!texture) return;
  const context = texture.getContext();
  const marks = [
    [37, 53, 47, 3],
    [147, 102, 57, -4],
    [318, 75, 67, 3],
    [430, 126, 43, -5],
    [73, 207, 55, -3],
    [232, 178, 68, 4],
    [379, 237, 59, -3],
    [481, 310, 42, 2],
    [118, 334, 73, 4],
    [290, 377, 61, -4],
    [22, 431, 48, -2],
    [416, 457, 64, 4],
  ];
  for (const [x, y, length, bend] of marks) {
    context.strokeStyle = 'rgba(232,255,249,0.36)';
    context.lineWidth = 2.6;
    context.lineCap = 'round';
    context.beginPath();
    context.moveTo(x!, y!);
    context.quadraticCurveTo(x! + length! / 2, y! + bend!, x! + length!, y!);
    context.stroke();
    context.strokeStyle = 'rgba(164,221,222,0.23)';
    context.lineWidth = 1.4;
    context.beginPath();
    context.moveTo(x! + 4, y! + 6);
    context.quadraticCurveTo(x! + length! / 2, y! + bend! + 6, x! + length! - 5, y! + 6);
    context.stroke();
  }
  texture.refresh();
}

function makeMaterialTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(MATERIAL_KEY)) return;
  const texture = createCanvasTexture(scene, MATERIAL_KEY, MATERIAL_COLUMNS * TILE, MATERIAL_ROWS * TILE);
  if (!texture) return;
  const context = texture.getContext();

  for (let material = 0; material < MATERIALS.length; material++) {
    const directions = material === 1 ? RIVER_DIRECTIONS : 1;
    for (let direction = 0; direction < directions; direction++) {
      for (let variation = 0; variation < MATERIAL_VARIATIONS; variation++) {
        for (let phase = 0; phase < MATERIAL_PHASES; phase++) {
          const index = materialTileIndex(material, variation, phase, direction);
          const x = (index % MATERIAL_COLUMNS) * TILE;
          const y = Math.floor(index / MATERIAL_COLUMNS) * TILE;
          const name = MATERIALS[material]!;
          const random = (slot: number): number => textureRandom(material, direction, variation, phase, slot);
          context.save();
          context.translate(x, y);
          context.fillStyle = STYLE_WASH[name];
          context.fillRect(0, 0, TILE, TILE);

          // Keep movement to broken, hand-painted curls. Direction only turns the marks in the atlas;
          // the full water tile stays unrotated, with no bright lines carried across tile seams.
          const angle = name === 'river' ? (direction * Math.PI) / 4 : (random(0) - 0.5) * 0.56;
          context.translate(TILE / 2, TILE / 2);
          context.rotate(angle);
          context.translate(-TILE / 2, -TILE / 2);
          context.lineCap = 'round';
          context.lineJoin = 'round';
          context.lineWidth = name === 'pond' ? 1.1 : 1.25;

          if (name === 'pond') {
            context.strokeStyle = `rgba(209,255,238,${0.035 + phase * 0.012})`;
            context.beginPath();
            context.ellipse(
              31 + (random(1) - 0.5) * 5,
              32 + (random(2) - 0.5) * 5,
              8 + phase * 2.2,
              4.2 + phase * 1.2,
              random(3) * 0.4,
              -0.15,
              Math.PI * (1.05 + phase * 0.13),
            );
            context.stroke();
          } else {
            const waveCount = name === 'river' ? 2 : 1;
            const colour = name === 'cave' ? '174,222,255' : name === 'river' ? '225,255,245' : '225,255,248';
            const alpha =
              name === 'cave' ? 0.055 + phase * 0.012 : name === 'river' ? 0.045 + phase * 0.012 : 0.035 + phase * 0.01;
            context.strokeStyle = `rgba(${colour},${alpha})`;
            for (let wave = 0; wave < waveCount; wave++) {
              const centreX = 32 + (random(4 + wave * 4) - 0.5) * (name === 'river' ? 5 : 26);
              const centreY = 32 + (random(5 + wave * 4) - 0.5) * (name === 'river' ? 5 : 24);
              const length = (name === 'river' ? 23 : 14) + random(6 + wave * 4) * (name === 'river' ? 7 : 12);
              const drift = (phase - 1) * 2.2;
              const sway = (random(7 + wave * 4) - 0.5) * (name === 'river' ? 7 : 10);
              context.beginPath();
              context.moveTo(centreX - length / 2 + drift, centreY - sway * 0.15);
              context.bezierCurveTo(
                centreX - length * 0.2,
                centreY + sway,
                centreX + length * 0.18,
                centreY - sway,
                centreX + length / 2 + drift,
                centreY + sway * 0.12,
              );
              context.stroke();
            }
          }
          context.restore();
        }
      }
    }
  }
  texture.refresh();
}

function textureRandom(material: number, direction: number, variation: number, phase: number, slot: number): number {
  let seed =
    Math.imul(material + 1, 0x45d9f3b) ^
    Math.imul(direction + 3, 0x119de1f3) ^
    Math.imul(variation + 7, 0x3449) ^
    Math.imul(phase + 11, 0x27d4eb2d) ^
    Math.imul(slot + 17, 0x165667b1);
  seed = Math.imul(seed ^ (seed >>> 16), 0x7feb352d);
  seed = Math.imul(seed ^ (seed >>> 15), 0x846ca68b);
  return ((seed ^ (seed >>> 16)) >>> 0) / 4294967296;
}

function makeShoreTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(SHORE_KEY)) return;
  const texture = createCanvasTexture(scene, SHORE_KEY, SHORE_COLUMNS * TILE, 12 * TILE);
  if (!texture) return;
  const context = texture.getContext();
  for (let mask = 1; mask < 16; mask++) {
    for (let variation = 0; variation < 3; variation++) {
      for (let phase = 0; phase < 3; phase++) {
        const index = mask * 9 + variation * 3 + phase;
        const x = (index % SHORE_COLUMNS) * TILE;
        const y = Math.floor(index / SHORE_COLUMNS) * TILE;
        context.save();
        context.translate(x, y);
        const alpha = phase === 1 ? 0.42 : phase === 0 ? 0.25 : 0.12;
        context.strokeStyle = `rgba(225,255,246,${alpha})`;
        context.lineCap = 'round';
        context.lineJoin = 'round';
        const edges = [
          [SHORE_BITS.north, 0],
          [SHORE_BITS.east, Math.PI / 2],
          [SHORE_BITS.south, Math.PI],
          [SHORE_BITS.west, -Math.PI / 2],
        ] as const;
        for (const [bit, rotation] of edges) {
          if (!(mask & bit)) continue;
          context.save();
          context.translate(TILE / 2, TILE / 2);
          context.rotate(rotation);
          context.translate(-TILE / 2, -TILE / 2);
          context.lineWidth = 1.7 + ((variation + phase + bit) % 2) * 0.45;
          for (let wave = 0; wave < 2; wave++) {
            const start = 5 + wave * 28 + variation * 2 + phase * 1.5;
            context.beginPath();
            context.moveTo(start, 5 + (wave % 2));
            context.bezierCurveTo(start + 7, 10 + variation - phase, start + 18, 1 + variation + phase, start + 25, 7);
            context.stroke();
          }
          context.fillStyle = `rgba(237,255,251,${alpha * 0.8})`;
          context.beginPath();
          context.ellipse(17 + variation * 8 + phase, 13 + variation * 2, 2.5, 1.4, 0, 0, Math.PI * 2);
          context.fill();
          context.restore();
        }
        context.restore();
      }
    }
  }
  texture.refresh();
}

function loadImageTexture(scene: Phaser.Scene, key: string, url: string, onLoaded: () => void): void {
  if (scene.textures.exists(key)) {
    onLoaded();
    return;
  }
  const image = new Image();
  image.onload = () => {
    if (!scene.sys.game) return;
    if (!scene.textures.exists(key)) scene.textures.addImage(key, image);
    onLoaded();
  };
  image.onerror = () => undefined;
  image.src = url;
}

function createLayer(
  scene: Phaser.Scene,
  key: string,
  data: number[][],
  depth: number,
  x = 0,
  y = 0,
): TileLayerSet | null {
  const map = scene.make.tilemap({ data, tileWidth: TILE, tileHeight: TILE, insertNull: true });
  const tileset = map.addTilesetImage(key, key, TILE, TILE, 0, 0, 0);
  if (!tileset) {
    map.destroy();
    return null;
  }
  const layer = map.createLayer(0, tileset, x, y);
  if (!layer) {
    map.destroy();
    return null;
  }
  layer.setDepth(depth);
  return { map, tileset, layer };
}

/** Camera-culled water cells with world-anchored currents, glints and bank pulses. */
export class WaterSurface {
  private readonly scene: Phaser.Scene;
  private area: AreaDef | null = null;
  private grid: WaterGrid | null = null;
  private base: TileLayerSet | null = null;
  private material: TileLayerSet | null = null;
  private glints: TileLayerSet | null = null;
  private shore: TileLayerSet | null = null;
  private readonly visibleCells: VisibleWaterCell[] = [];
  private bounds: ViewBounds | null = null;
  private seconds = 0;
  private paused = false;
  private reducedMotion = false;
  private darkness = 0;
  private winter = false;
  private cave = false;
  private lastMaterialPhases = [-1, -1, -1, -1];
  private lastGlintPhases = [-1, -1, -1, -1];
  private lastShorePulse = -1;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    createFallbackWater(scene);
    createFallbackGlints(scene);
    makeMaterialTexture(scene);
    makeShoreTexture(scene);
    loadImageTexture(scene, BASE_KEY, `${BASE_PATH}ground/water.webp`, () => this.replaceImage(BASE_KEY, this.base));
    loadImageTexture(scene, GLINT_KEY, `${BASE_PATH}ground/water-glints.png`, () =>
      this.replaceImage(GLINT_KEY, this.glints),
    );
  }

  setArea(area: AreaDef, snow: boolean): void {
    if (this.area === area) {
      if (this.winter !== snow) {
        this.winter = snow;
        this.applySeasonalTint();
      }
      return;
    }
    this.destroyLayers();
    this.area = area;
    this.winter = snow;
    this.cave = area.id.startsWith('mine') || area.id === 'cave';
    this.grid = makeWaterGrid(area);
    this.bounds = null;
    this.visibleCells.length = 0;
    this.lastMaterialPhases.fill(-1);
    this.lastGlintPhases.fill(-1);
    this.lastShorePulse = -1;

    if (this.grid.counts.sea + this.grid.counts.river + this.grid.counts.pond + this.grid.counts.cave === 0) return;

    const baseKey = this.scene.textures.exists(BASE_KEY) ? BASE_KEY : BASE_FALLBACK_KEY;
    const glintKey = this.scene.textures.exists(GLINT_KEY) ? GLINT_KEY : GLINT_FALLBACK_KEY;
    this.base = createLayer(this.scene, baseKey, this.grid.underlay, BASE_DEPTH, -TILE, -TILE);
    this.material = createLayer(this.scene, MATERIAL_KEY, this.grid.material, MATERIAL_DEPTH);
    this.glints = createLayer(this.scene, glintKey, this.glintGrid(this.grid), WATERLIGHT_DEPTH);
    this.shore = createLayer(this.scene, SHORE_KEY, this.grid.shore, WATERLIGHT_DEPTH + 0.1);
    this.applySeasonalTint();
    this.material?.layer.setAlpha(this.cave ? 0.88 : 1);
    this.glints?.layer.setAlpha(this.cave ? 0.21 : this.winter ? 0.38 : 0.46);
    this.shore?.layer.setAlpha(this.cave ? 0.28 : this.winter ? 0.7 : 0.56);
  }

  setVisible(visible: boolean): void {
    for (const layers of [this.base, this.material, this.glints, this.shore]) layers?.layer.setVisible(visible);
  }

  update(cam: Phaser.Cameras.Scene2D.Camera, dt: number, state: WaterFrameState = {}): void {
    if (!this.area || !this.grid || !this.base) return;
    this.paused = !!state.paused;
    this.reducedMotion = !!state.reducedMotion;
    this.darkness = Math.max(0, Math.min(1, state.darkness ?? 0));
    const winterChanged = state.winter !== undefined && this.winter !== state.winter;
    if (state.winter !== undefined) this.winter = state.winter;
    if (winterChanged) this.applySeasonalTint();
    if (!this.paused && !this.reducedMotion) this.seconds += Math.max(0, Math.min(dt, 0.05));
    this.material?.layer.setAlpha(this.cave ? 0.88 : 1 - this.darkness * 0.12);
    this.glints?.layer.setAlpha((this.cave ? 0.21 : this.winter ? 0.38 : 0.46) * (1 - this.darkness * 0.42));
    this.shore?.layer.setAlpha((this.cave ? 0.28 : this.winter ? 0.7 : 0.56) * (1 - this.darkness * 0.3));

    this.refreshVisibleCells(cam.worldView);
    this.animateVisibleCells();
  }

  snapshot(): WaterSnapshot {
    const counts = this.grid?.counts ?? { sea: 0, river: 0, pond: 0, cave: 0 };
    const materialTileCount = Object.values(counts).reduce((sum, count) => sum + count, 0);
    return {
      areaId: this.area?.id ?? '',
      materialCounts: { ...counts },
      shorelineCellCount: this.grid?.shorelineCells ?? 0,
      baseWaterTileCount: materialTileCount,
      materialTileCount,
      glintTileCount: materialTileCount,
      shoreTileCount: this.grid?.shorelineCells ?? 0,
      visibleWaterTileCount: this.visibleCells.length,
      visibleShoreTileCount: this.visibleCells.filter((cell) => cell.shoreMask > 0).length,
      motionTime: Number(this.seconds.toFixed(3)),
      paused: this.paused,
      reducedMotion: this.reducedMotion,
      winter: this.winter,
      darkness: Number(this.darkness.toFixed(3)),
      largestSurfaceCanvasPixels: 0,
      largestAtlasTexturePixels: 768 * 768,
      depths: {
        base: BASE_DEPTH,
        material: MATERIAL_DEPTH,
        reflections: REFLECTION_DEPTH,
        highlights: WATERLIGHT_DEPTH,
        ground: GROUND_DEPTH,
      },
    };
  }

  destroy(): void {
    this.destroyLayers();
    this.area = null;
    this.grid = null;
    this.bounds = null;
    this.visibleCells.length = 0;
  }

  private baseTint(): number {
    return this.winter ? 0xeaf6ff : this.cave ? 0x8599c3 : 0xffffff;
  }

  private applySeasonalTint(): void {
    this.base?.layer.setTint(this.baseTint());
    this.glints?.layer.setTint(this.winter ? 0xe5fbff : 0xffffff);
    this.shore?.layer.setTint(this.winter ? 0xe5f6ff : 0xffffff);
  }

  private glintGrid(grid: WaterGrid): number[][] {
    return grid.base.map((row) => row.map((source) => (source < 0 ? -1 : source)));
  }

  private replaceImage(key: string, layer: TileLayerSet | null): void {
    if (!layer) return;
    const texture = this.scene.textures.get(key);
    layer.tileset.setImage(texture);
  }

  private refreshVisibleCells(view: Phaser.Geom.Rectangle): void {
    if (!this.grid || !this.area) return;
    const left = Math.max(0, Math.floor(view.left / TILE) - 1);
    const top = Math.max(0, Math.floor(view.top / TILE) - 1);
    const right = Math.min(this.area.w - 1, Math.ceil(view.right / TILE) + 1);
    const bottom = Math.min(this.area.h - 1, Math.ceil(view.bottom / TILE) + 1);
    if (
      this.bounds &&
      this.bounds.left === left &&
      this.bounds.top === top &&
      this.bounds.right === right &&
      this.bounds.bottom === bottom
    )
      return;

    this.bounds = { left, top, right, bottom };
    this.visibleCells.length = 0;
    for (let y = top; y <= bottom; y++) {
      for (let x = left; x <= right; x++) {
        const type = this.grid.type[y]?.[x] ?? -1;
        if (type < 0) continue;
        this.visibleCells.push({
          x,
          y,
          type,
          variation: this.grid.variation[y]![x]!,
          phaseOffset: this.grid.phaseOffset[y]![x]!,
          flow: this.grid.flow[y]![x]!,
          shoreMask: this.grid.shoreMask[y]![x]!,
        });
      }
    }
    this.lastMaterialPhases.fill(-1);
    this.lastGlintPhases.fill(-1);
    this.lastShorePulse = -1;
    this.animateVisibleCells(true);
  }

  private animateVisibleCells(force = false): void {
    if (!this.visibleCells.length) return;
    const materialChanged = MATERIAL_NAMES.map((name, type) => {
      const phase = Math.floor(this.seconds / MATERIAL_PERIOD[name]) % MATERIAL_PHASES;
      if (force || this.lastMaterialPhases[type] !== phase) {
        this.lastMaterialPhases[type] = phase;
        return phase;
      }
      return -1;
    });
    const glintChanged = MATERIAL_NAMES.map((name, type) => {
      const phase = Math.floor(this.seconds / GLINT_SPEED[name]) % MATERIAL_PHASES;
      if (force || this.lastGlintPhases[type] !== phase) {
        this.lastGlintPhases[type] = phase;
        return phase;
      }
      return -1;
    });
    const shorePulse = Math.floor(this.seconds / 0.48) % MATERIAL_PHASES;
    const shoreChanged = force || this.lastShorePulse !== shorePulse;
    if (shoreChanged) this.lastShorePulse = shorePulse;
    if (
      !force &&
      materialChanged.every((phase) => phase < 0) &&
      glintChanged.every((phase) => phase < 0) &&
      !shoreChanged
    )
      return;

    for (const cell of this.visibleCells) {
      const localPhase = (materialChanged[cell.type]! + cell.phaseOffset + MATERIAL_PHASES) % MATERIAL_PHASES;
      if (force || materialChanged[cell.type]! >= 0) {
        const materialTile = this.material?.layer.layer.data[cell.y]?.[cell.x];
        const phase = force
          ? Math.floor(this.seconds / MATERIAL_PERIOD[MATERIAL_NAMES[cell.type]!] + cell.phaseOffset) % MATERIAL_PHASES
          : localPhase;
        if (materialTile) materialTile.index = materialTileIndex(cell.type, cell.variation, phase, cell.flow);
      }
      if (force || glintChanged[cell.type]! >= 0) {
        const glintTile = this.glints?.layer.layer.data[cell.y]?.[cell.x];
        if (glintTile) {
          const phase =
            Math.floor(this.seconds / GLINT_SPEED[MATERIAL_NAMES[cell.type]!] + cell.phaseOffset) % MATERIAL_PHASES;
          glintTile.alpha = 0.68 + (phase === 1 ? 0.18 : phase === 2 ? -0.12 : 0);
        }
      }
      if (shoreChanged && cell.shoreMask > 0) {
        const shoreTile = this.shore?.layer.layer.data[cell.y]?.[cell.x];
        if (shoreTile)
          shoreTile.index =
            cell.shoreMask * 9 + (cell.variation % 3) * 3 + ((shorePulse + cell.phaseOffset) % MATERIAL_PHASES);
      }
    }
  }

  private destroyLayers(): void {
    for (const layers of [this.base, this.material, this.glints, this.shore]) {
      layers?.layer.destroy();
      layers?.map.destroy();
    }
    this.base = null;
    this.material = null;
    this.glints = null;
    this.shore = null;
  }
}
