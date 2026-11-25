import type Phaser from 'phaser';
import { TERRAIN, TILE } from '../../core/grid.ts';
import type { AreaDef } from '../../core/types.ts';

const MAX_REFLECTIONS = 16;
const MAX_SHORE_DISTANCE = TILE * 1.5;
const REFLECTION_DEPTH = -1999;
const DAY_TINT = 0x86b8c4;
const NIGHT_TINT = 0x596d94;
const SNOW_TINT = 0xa9d3e2;

export type ReflectionSource = Phaser.GameObjects.Image | Phaser.GameObjects.Sprite;

export interface WaterSurface {
  edge: 'x' | 'y';
  coordinate: number;
  distance: number;
  kind: NonNullable<(typeof TERRAIN)[string]['water']>;
}

export interface ReflectionRipple {
  x: number;
  scaleY: number;
  angle: number;
}

export interface ReflectionBounds {
  width: number;
  height: number;
  originX: number;
  originY: number;
  angle: number;
}

export interface ReflectionProbe {
  active: number;
  max: number;
  area: string;
  surfaces: number;
  samples: Array<{
    source: string;
    texture: string;
    frame: string | number;
    x: number;
    surfaceX: number;
    surfaceY: number;
    y: number;
    alpha: number;
    waterCoverage: number;
    kind: WaterSurface['kind'];
    edge: WaterSurface['edge'];
  }>;
}

function considerSurface(
  area: AreaDef,
  tx: number,
  ty: number,
  edge: WaterSurface['edge'],
  coordinate: number,
  gap: number,
  maxDistance: number,
  nearestDistance: number,
  result: WaterSurface,
): number {
  if (gap < 0 || gap > maxDistance || gap >= nearestDistance) return nearestDistance;
  const kind = TERRAIN[area.terrain[ty]?.charAt(tx) ?? '']?.water;
  if (!kind) return nearestDistance;
  result.edge = edge;
  result.coordinate = coordinate;
  result.distance = gap;
  result.kind = kind;
  return gap;
}

/** Find the nearest bank in any direction while retaining vertical reflection for upright scenery. */
export function waterSurfaceNear(
  area: AreaDef,
  x: number,
  y: number,
  displayWidth: number,
  displayHeight: number,
  originX: number,
  originY: number,
  maxDistance = MAX_SHORE_DISTANCE,
  result: WaterSurface = { edge: 'y', coordinate: 0, distance: 0, kind: 'sea' },
): WaterSurface | null {
  if (area.indoor || displayWidth <= 0 || displayHeight <= 0) return null;

  const left = x - originX * displayWidth;
  const right = left + displayWidth;
  const top = y - originY * displayHeight;
  const bottom = top + displayHeight;
  const firstTileX = Math.max(0, Math.floor(left / TILE));
  const lastTileX = Math.min(area.w - 1, Math.floor((right - 0.01) / TILE));
  const firstTileY = Math.max(0, Math.floor(top / TILE));
  const lastTileY = Math.min(area.h - 1, Math.floor((bottom - 0.01) / TILE));
  let nearestDistance = Number.POSITIVE_INFINITY;

  const firstBelow = Math.max(0, Math.floor(y / TILE));
  const lastBelow = Math.min(area.h - 1, Math.floor((y + maxDistance) / TILE));
  for (let ty = firstBelow; ty <= lastBelow; ty++) {
    const yCoordinate = Math.max(y, ty * TILE);
    for (let tx = firstTileX; tx <= lastTileX; tx++) {
      const sideBank = ty === firstBelow && y > ty * TILE;
      const edge = sideBank ? 'x' : 'y';
      const coordinate = sideBank ? (tx * TILE + TILE / 2 >= x ? tx * TILE : (tx + 1) * TILE) : yCoordinate;
      const gap = sideBank ? 0 : coordinate - y;
      nearestDistance = considerSurface(area, tx, ty, edge, coordinate, gap, maxDistance, nearestDistance, result);
    }
  }

  const firstAbove = Math.min(area.h - 1, Math.floor((y - 0.01) / TILE));
  for (let ty = firstAbove; ty >= 0 && y - (ty + 1) * TILE <= maxDistance; ty--) {
    const coordinate = (ty + 1) * TILE;
    for (let tx = firstTileX; tx <= lastTileX; tx++)
      nearestDistance = considerSurface(
        area,
        tx,
        ty,
        'y',
        coordinate,
        y - coordinate,
        maxDistance,
        nearestDistance,
        result,
      );
  }

  if (nearestDistance <= TILE * 0.25) return result;

  const firstRight = Math.max(0, Math.ceil(right / TILE));
  const lastRight = Math.min(area.w - 1, Math.floor((right + maxDistance) / TILE));
  for (let tx = firstRight; tx <= lastRight; tx++) {
    const coordinate = Math.max(right, tx * TILE);
    for (let ty = firstTileY; ty <= lastTileY; ty++)
      nearestDistance = considerSurface(
        area,
        tx,
        ty,
        'x',
        coordinate,
        coordinate - right,
        maxDistance,
        nearestDistance,
        result,
      );
  }

  const firstLeft = Math.min(area.w - 1, Math.floor(left / TILE) - 1);
  for (let tx = firstLeft; tx >= 0 && left - (tx + 1) * TILE <= maxDistance; tx--) {
    const coordinate = Math.min(left, (tx + 1) * TILE);
    for (let ty = firstTileY; ty <= lastTileY; ty++)
      nearestDistance = considerSurface(
        area,
        tx,
        ty,
        'x',
        coordinate,
        left - coordinate,
        maxDistance,
        nearestDistance,
        result,
      );
  }

  return Number.isFinite(nearestDistance) ? result : null;
}

/** Small, world-anchored ripples keep reflected shapes soft without a per-frame texture upload. */
export function reflectionRipple(
  time: number,
  x: number,
  reducedMotion: boolean,
  result: ReflectionRipple = { x: 0, scaleY: 1, angle: 0 },
): ReflectionRipple {
  if (reducedMotion) {
    result.x = 0;
    result.scaleY = 1;
    result.angle = 0;
    return result;
  }
  const phase = time * 1.45 + x * 0.011;
  result.x = Math.sin(phase) * 1.4;
  result.scaleY = 0.97 + Math.sin(phase * 0.76) * 0.025;
  result.angle = Math.sin(phase * 0.58) * 0.65;
  return result;
}

/** Check the reflected shape's rotated bounds against Phaser's world-space camera view. */
export function reflectionIntersectsView(
  bounds: ReflectionBounds,
  reflectedX: number,
  reflectedY: number,
  view: { left: number; top: number; right: number; bottom: number },
  angle = -bounds.angle,
): boolean {
  const radians = (angle * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  const halfWidth = bounds.width / 2;
  const halfHeight = bounds.height / 2;
  const extentX = halfWidth * cos + halfHeight * sin;
  const extentY = halfWidth * sin + halfHeight * cos;
  const centreX = reflectedX + (0.5 - bounds.originX) * bounds.width;
  const reflectedOriginY = 1 - bounds.originY;
  const centreY = reflectedY + (0.5 - reflectedOriginY) * bounds.height;

  return (
    centreX + extentX >= view.left &&
    centreX - extentX <= view.right &&
    centreY + extentY >= view.top &&
    centreY - extentY <= view.bottom
  );
}

/** Fraction of the reflected sprite bounds that overlap actual water cells. */
export function reflectionWaterCoverage(
  area: AreaDef,
  bounds: ReflectionBounds,
  reflectedX: number,
  reflectedY: number,
  angle = -bounds.angle,
): number {
  const radians = (angle * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  const halfWidth = bounds.width / 2;
  const halfHeight = bounds.height / 2;
  const extentX = halfWidth * cos + halfHeight * sin;
  const extentY = halfWidth * sin + halfHeight * cos;
  const centreX = reflectedX + (0.5 - bounds.originX) * bounds.width;
  const centreY = reflectedY + (bounds.originY - 0.5) * bounds.height;
  const left = centreX - extentX;
  const right = centreX + extentX;
  const top = centreY - extentY;
  const bottom = centreY + extentY;
  const totalArea = (right - left) * (bottom - top);
  if (area.indoor || totalArea <= 0) return 0;

  const firstTileX = Math.max(0, Math.floor(left / TILE));
  const lastTileX = Math.min(area.w - 1, Math.floor((right - 0.01) / TILE));
  const firstTileY = Math.max(0, Math.floor(top / TILE));
  const lastTileY = Math.min(area.h - 1, Math.floor((bottom - 0.01) / TILE));
  let wetArea = 0;
  for (let ty = firstTileY; ty <= lastTileY; ty++) {
    const row = area.terrain[ty];
    if (!row) continue;
    const overlapY = Math.min(bottom, (ty + 1) * TILE) - Math.max(top, ty * TILE);
    if (overlapY <= 0) continue;
    for (let tx = firstTileX; tx <= lastTileX; tx++) {
      if (!TERRAIN[row.charAt(tx)]?.water) continue;
      const overlapX = Math.min(right, (tx + 1) * TILE) - Math.max(left, tx * TILE);
      if (overlapX > 0) wetArea += overlapX * overlapY;
    }
  }
  return wetArea / totalArea;
}

function reflectionTint(night: number, snow: boolean, kind: WaterSurface['kind']): number {
  if (kind === 'cave') return 0x4f6f8f;
  if (snow) return SNOW_TINT;
  return night > 0.5 ? NIGHT_TINT : DAY_TINT;
}

function surfaceStrength(kind: WaterSurface['kind']): number {
  switch (kind) {
    case 'pond':
      return 0.22;
    case 'river':
      return 0.2;
    case 'cave':
      return 0.14;
    default:
      return 0.18;
  }
}

/** A bounded pool of live, mirrored sprite frames, drawn under the painted shoreline. */
export class WaterReflections {
  private readonly scene: Phaser.Scene;
  private readonly pool: Phaser.GameObjects.Sprite[] = [];
  private area: AreaDef | null = null;
  private time = 0;
  private paused = false;
  private reducedMotion = false;
  private visible = false;
  private active = 0;
  private surfaces = 0;
  private readonly surfaceScratch: WaterSurface = { edge: 'y', coordinate: 0, distance: 0, kind: 'sea' };
  private readonly rippleScratch: ReflectionRipple = { x: 0, scaleY: 1, angle: 0 };
  private readonly boundsScratch: ReflectionBounds = { width: 0, height: 0, originX: 0.5, originY: 1, angle: 0 };
  private readonly sampleRows: ReflectionProbe['samples'] = Array.from({ length: MAX_REFLECTIONS }, () => ({
    source: '',
    texture: '',
    frame: '',
    x: 0,
    surfaceX: 0,
    surfaceY: 0,
    y: 0,
    alpha: 0,
    waterCoverage: 0,
    kind: 'sea',
    edge: 'y',
  }));
  private sampleCount = 0;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function')
      this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  setArea(area: AreaDef): void {
    this.area = area;
    this.visible = !area.indoor;
    this.hidePool();
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
  }

  update(
    sources: readonly ReflectionSource[],
    camera: Phaser.Cameras.Scene2D.Camera,
    dt: number,
    night: number,
    snow: boolean,
  ): void {
    const area = this.area;
    if (!area || !this.visible || !camera.visible) {
      this.hidePool();
      return;
    }

    if (!this.paused && !this.reducedMotion && Number.isFinite(dt)) this.time += Math.max(0, Math.min(0.1, dt));

    const view = camera.worldView;
    this.active = 0;
    this.surfaces = 0;
    this.sampleCount = 0;

    for (const source of sources) {
      if (this.active >= MAX_REFLECTIONS) break;
      if (!source.active || !source.visible || source.alpha <= 0 || source.isCropped) continue;
      if (!source.texture || source.texture.key === '__DEFAULT' || !source.frame) continue;
      if (source.scrollFactorX !== 1 || source.scrollFactorY !== 1 || source.scaleX === 0 || source.scaleY === 0)
        continue;

      const surface = waterSurfaceNear(
        area,
        source.x,
        source.y,
        Math.abs(source.displayWidth),
        Math.abs(source.displayHeight),
        source.originX,
        source.originY,
        MAX_SHORE_DISTANCE,
        this.surfaceScratch,
      );
      if (!surface) continue;
      this.surfaces++;

      const reflectionX = source.x;
      const reflectionY = surface.edge === 'y' ? surface.coordinate * 2 - source.y : source.y;
      const ripple = reflectionRipple(this.time, source.x, this.reducedMotion, this.rippleScratch);
      const angle = -source.angle + ripple.angle;
      const reflectedX = reflectionX + ripple.x;
      const sourceBounds = this.boundsScratch;
      sourceBounds.width = Math.abs(source.displayWidth);
      sourceBounds.height = Math.abs(source.displayHeight);
      sourceBounds.originX = source.originX;
      sourceBounds.originY = source.originY;
      sourceBounds.angle = source.angle;
      if (!reflectionIntersectsView(sourceBounds, reflectedX, reflectionY, view, angle)) continue;

      const waterCoverage = reflectionWaterCoverage(area, sourceBounds, reflectedX, reflectionY, angle);
      if (waterCoverage < 0.03) continue;

      const reflected = this.get(this.active);
      if (!this.sync(reflected, source)) {
        reflected.setVisible(false);
        continue;
      }

      const shoreFade = 1 - (surface.distance / MAX_SHORE_DISTANCE) * 0.24;
      const nightFade = 1 - Math.min(0.3, Math.max(0, night) * 0.18);
      const alpha = source.alpha * surfaceStrength(surface.kind) * shoreFade * nightFade;
      const flipX = source.flipX !== source.scaleX < 0;
      const flipY = !(source.flipY !== source.scaleY < 0);
      reflected
        .setPosition(reflectedX, reflectionY)
        .setOrigin(source.originX, 1 - source.originY)
        .setScale(Math.abs(source.scaleX), Math.abs(source.scaleY) * ripple.scaleY)
        .setFlipX(flipX)
        .setFlipY(flipY)
        .setAngle(angle)
        .setTint(reflectionTint(night, snow, surface.kind))
        .setAlpha(alpha)
        .setDepth(REFLECTION_DEPTH + Math.min(0.9, surface.coordinate / Math.max(1, area.h * TILE)) * 0.9)
        .setBlendMode(0)
        .setVisible(true);

      const sample = this.sampleRows[this.sampleCount];
      if (sample) {
        sample.source = source.name || source.texture.key;
        sample.texture = source.texture.key;
        sample.frame = source.frame.name;
        sample.x = source.x;
        sample.surfaceX = surface.edge === 'x' ? surface.coordinate : source.x;
        sample.surfaceY = surface.edge === 'y' ? surface.coordinate : source.y;
        sample.y = reflected.y;
        sample.alpha = alpha;
        sample.kind = surface.kind;
        sample.waterCoverage = waterCoverage;
        sample.edge = surface.edge;
        this.sampleCount++;
      }
      this.active++;
    }

    for (let i = this.active; i < this.pool.length; i++) this.pool[i]!.setVisible(false);
  }

  /** Test and diagnostics snapshot. Called on demand so the game loop creates no probe objects. */
  probe(): ReflectionProbe {
    return {
      active: this.active,
      max: MAX_REFLECTIONS,
      area: this.area?.id ?? '',
      surfaces: this.surfaces,
      samples: this.sampleRows.slice(0, this.sampleCount).map((sample) => ({ ...sample })),
    };
  }

  destroy(): void {
    for (const image of this.pool) image.destroy();
    this.pool.length = 0;
    this.active = 0;
    this.area = null;
  }

  private get(index: number): Phaser.GameObjects.Sprite {
    while (this.pool.length <= index) this.pool.push(this.scene.add.sprite(0, 0, '__DEFAULT').setVisible(false));
    return this.pool[index]!;
  }

  private sync(target: Phaser.GameObjects.Sprite, source: ReflectionSource): boolean {
    if (!this.scene.textures.exists(source.texture.key)) return false;
    if (target.texture !== source.texture || target.frame.name !== source.frame.name)
      target.setTexture(source.texture.key, source.frame.name);
    if (source.isCropped) return false;
    return true;
  }

  private hidePool(): void {
    this.active = 0;
    this.surfaces = 0;
    this.sampleCount = 0;
    for (const sprite of this.pool) sprite.setVisible(false);
  }
}
