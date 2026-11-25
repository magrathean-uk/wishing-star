import { describe, expect, it } from 'vitest';
import type { AreaDef } from '../src/core/types.ts';
import {
  reflectionIntersectsView,
  reflectionRipple,
  reflectionWaterCoverage,
  waterSurfaceNear,
} from '../src/game/world/reflections.ts';

function area(terrain: string[], indoor = false): AreaDef {
  return {
    id: 'water-test',
    name: 'Water test',
    w: terrain[0]!.length,
    h: terrain.length,
    terrain,
    region: terrain.map((row) => row.replaceAll(/./g, 'g')),
    objects: [],
    barriers: [],
    zones: [],
    sites: [],
    doors: [],
    places: {},
    indoor,
  };
}

describe('water reflections', () => {
  it('starts the reflected image at the nearest painted waterline beneath its footprint', () => {
    const map = area(['gggg', 'ggWW', 'gWww']);

    expect(waterSurfaceNear(map, 1.5 * 64, 40, 2.5 * 64, 24, 0.5, 1)).toEqual({
      edge: 'y',
      coordinate: 64,
      distance: 24,
      kind: 'sea',
    });
  });

  it('does not reflect beyond nearby water or across an indoor scene', () => {
    const dry = area(['gggg', 'gggg', 'gWgg']);

    expect(waterSurfaceNear(dry, 32, 32, 48, 60, 0.5, 1)).toBeNull();
    expect(waterSurfaceNear(dry, 64, 32, 48, 60, 0.5, 1, 64)).toBeNull();
    expect(waterSurfaceNear(area(['gW'], true), 32, 0, 64, 60, 0.5, 1)).toBeNull();
  });

  it('detects distinct river, pond and cave surfaces', () => {
    const map = area(['gwqu']);

    expect(waterSurfaceNear(map, 96, 0, 48, 32, 0.5, 0.5)?.kind).toBe('river');
    expect(waterSurfaceNear(map, 160, 0, 48, 32, 0.5, 0.5)?.kind).toBe('pond');
    expect(waterSurfaceNear(map, 224, 0, 48, 32, 0.5, 0.5)?.kind).toBe('cave');
  });

  it('finds open water along the four banks of a land cell', () => {
    const south = area(['ggg', 'ggw', 'ggg']);
    const west = area(['wgg', 'ggg', 'ggg']);

    expect(waterSurfaceNear(south, 64, 64, 64, 60, 0.5, 0.9)).toMatchObject({
      edge: 'x',
      coordinate: 128,
      kind: 'river',
    });
    expect(waterSurfaceNear(west, 160, 96, 64, 60, 0.5, 0.9)).toMatchObject({
      edge: 'x',
      coordinate: 64,
      kind: 'river',
    });
  });

  it('points reflections into north and south water and clips lateral banks to wet sprite area', () => {
    const north = area(['gWg', 'ggg', 'ggg']);
    const south = area(['ggg', 'ggg', 'gWg']);
    const side = area(['gggg', 'ggww', 'gggg']);
    const northEdge = waterSurfaceNear(north, 96, 76, 32, 60, 0.5, 1);
    const southEdge = waterSurfaceNear(south, 96, 120, 32, 32, 0.5, 1);
    const sideEdge = waterSurfaceNear(side, 110, 70, 64, 80, 0.5, 0.9);

    expect(northEdge).toMatchObject({ edge: 'y', coordinate: 64 });
    expect(southEdge).toMatchObject({ edge: 'y', coordinate: 128 });
    expect(sideEdge).toMatchObject({ edge: 'x', coordinate: 128 });
    if (!northEdge || !southEdge || !sideEdge) throw new Error('Expected reflections from each nearby bank');
    expect(2 * northEdge.coordinate - 76).toBeLessThan(76);
    expect(2 * southEdge.coordinate - 120).toBeGreaterThan(120);
    expect(sideEdge.coordinate).toBeGreaterThan(110);

    const bounds = { width: 64, height: 80, originX: 0.5, originY: 0.9, angle: 0 };
    const northWetPart = reflectionWaterCoverage(
      north,
      { width: 32, height: 60, originX: 0.5, originY: 1, angle: 0 },
      96,
      northEdge.coordinate * 2 - 76,
    );
    const wetPart = reflectionWaterCoverage(side, bounds, 110, 70);
    const dryPart = reflectionWaterCoverage(side, bounds, 40, 70);
    expect(northWetPart).toBeGreaterThan(0.1);
    expect(northWetPart).toBeLessThan(1);
    expect(wetPart).toBeGreaterThan(0.1);
    expect(wetPart).toBeLessThan(1);
    expect(dryPart).toBe(0);
  });

  it('keeps ripples stable in reduced-motion mode and deterministic for a world position', () => {
    expect(reflectionRipple(2, 24, true)).toEqual({ x: 0, scaleY: 1, angle: 0 });
    expect(reflectionRipple(2, 24, false)).toEqual(reflectionRipple(2, 24, false));
    expect(reflectionRipple(2, 24, false)).not.toEqual(reflectionRipple(2, 25, false));
  });

  it('culls by the reflected image bounds at the right and bottom camera edges', () => {
    const bounds = { width: 30, height: 40, originX: 0.5, originY: 0.9, angle: 0 };

    expect(reflectionIntersectsView(bounds, 100, 200, { left: 0, top: 0, right: 115, bottom: 220 })).toBe(true);
    expect(reflectionIntersectsView(bounds, 100, 200, { left: 0, top: 0, right: 84, bottom: 220 })).toBe(false);
    expect(reflectionIntersectsView(bounds, 100, 200, { left: 0, top: 0, right: 200, bottom: 205 })).toBe(true);
    expect(reflectionIntersectsView(bounds, 100, 200, { left: 0, top: 0, right: 200, bottom: 195 })).toBe(false);
  });
});
