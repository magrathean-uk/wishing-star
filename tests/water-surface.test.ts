import { describe, expect, it, vi } from 'vitest';
import { makeWaterGrid, WaterSurface } from '../src/game/world/waterSurface.ts';
import type { AreaDef } from '../src/core/types.ts';

function area(
  terrain: string[],
  barriers: AreaDef['barriers'] = [],
  indoor = true,
): Pick<AreaDef, 'id' | 'w' | 'h' | 'terrain'> & { barriers?: AreaDef['barriers']; indoor?: boolean } {
  return { id: 'water-test', w: terrain[0]!.length, h: terrain.length, terrain, barriers, indoor };
}

describe('painted water surfaces', () => {
  it('distinguishes sea, river, pond and cave water cells', () => {
    const grid = makeWaterGrid(area(['gWwquu', 'gggggg']));
    expect(grid.counts).toEqual({ sea: 1, river: 1, pond: 1, cave: 2 });
    expect(grid.material[0]).toHaveLength(6);
    expect(grid.material[0]![1]).toBeGreaterThanOrEqual(0);
    expect(grid.material[0]![1]).toBeLessThan(18);
    expect(grid.material[0]![2]).toBeGreaterThanOrEqual(18);
    expect(grid.material[0]![2]).toBeLessThan(90);
    expect(grid.material[0]![3]).toBeGreaterThanOrEqual(90);
    expect(grid.material[0]![4]).toBeGreaterThanOrEqual(108);
    expect(grid.material[1]).toEqual([-1, -1, -1, -1, -1, -1]);
  });

  it('marks only banks where a water tile meets a non-water tile', () => {
    const grid = makeWaterGrid(area(['WWg', 'Wgg', 'ggg']));
    expect(grid.shoreMask[0]![0]).toBe(9);
    expect(grid.shoreMask[0]![1]).toBe(7);
    expect(grid.shoreMask[1]![0]).toBe(14);
    expect(grid.shoreMask[1]![1]).toBe(-1);
    expect(grid.shore[0]![0]).toBeGreaterThanOrEqual(81);
    expect(grid.shore[0]![0]).toBeLessThan(90);
    expect(grid.shorelineCells).toBe(3);
  });

  it('keeps outdoor map edges joined to the surrounding sea while retaining internal banks', () => {
    const grid = makeWaterGrid(area(['WWW', 'WgW', 'WWW'], [], false));
    expect(grid.counts).toEqual({ sea: 8, river: 0, pond: 0, cave: 0 });
    expect(grid.shoreMask[0]![0]).toBe(-1);
    expect(grid.shoreMask[0]![1]).toBe(4);
    expect(grid.shoreMask[1]![0]).toBe(2);
    expect(grid.shoreMask[1]![2]).toBe(8);
    expect(grid.shoreMask[2]![1]).toBe(1);
    expect(grid.shorelineCells).toBe(4);
    expect(grid.underlay).toHaveLength(5);
    expect(grid.underlay[0]).toHaveLength(5);
    expect(grid.underlay[0]![0]).toBeGreaterThanOrEqual(0);
    expect(grid.underlay[2]![2]).toBeGreaterThanOrEqual(0);
  });

  it('keeps cave edges closed to water outside the room', () => {
    const grid = makeWaterGrid(area(['uuu', 'u.u', 'uuu']));
    expect(grid.shoreMask[0]![0]).toBe(9);
    expect(grid.shoreMask[0]![1]).toBe(5);
    expect(grid.shoreMask[1]![0]).toBe(10);
    expect(grid.shorelineCells).toBe(8);
    expect(grid.underlay[0]![0]).toBe(-1);
    expect(grid.underlay[2]![2]).toBeGreaterThanOrEqual(0);
  });

  it('selects directional river marks without rotating the full tile', () => {
    const grid = makeWaterGrid(area(['gwg', 'gww', 'ggw']));
    expect(grid.flow[0]![1]).toBe(2);
    expect(grid.flow[1]![1]).toBe(1);
    expect(grid.flow[1]![2]).toBe(1);
    expect(grid.flow[2]![2]).toBe(2);
    expect(grid.material[0]![1]).toBeGreaterThanOrEqual(54);
    expect(grid.material[0]![1]).toBeLessThan(72);
    expect(grid.material[1]![1]).toBeGreaterThanOrEqual(36);
    expect(grid.material[1]![1]).toBeLessThan(54);
  });

  it('keeps flow stable for the same map and leaves unrelated terrain empty', () => {
    const terrain = ['ggwwgg', 'ggwggg', 'ggwwgg'];
    expect(makeWaterGrid(area(terrain))).toEqual(makeWaterGrid(area(terrain)));
    expect(makeWaterGrid(area(terrain)).counts).toEqual({ sea: 0, river: 5, pond: 0, cave: 0 });
  });

  it('fills only broken bridge tiles as river water, matching the baked ground mask', () => {
    const grid = makeWaterGrid(
      area(
        ['gbbwg', 'gbggg'],
        [{ id: 'bridge', art: 'broken_bridge', flag: 'fixed', hint: 'bridge', rect: { x: 1, y: 0, w: 2, h: 2 } }],
      ),
    );
    expect(grid.counts).toEqual({ sea: 0, river: 4, pond: 0, cave: 0 });
    expect(grid.type[0]!.slice(1, 4)).toEqual([1, 1, 1]);
    expect(grid.type[1]![1]).toBe(1);
    expect(grid.type[1]![2]).toBe(-1);
    expect(grid.underlay[1]![1]).toBeGreaterThanOrEqual(0);
    expect(grid.underlay[2]![2]).toBeGreaterThanOrEqual(0);
  });

  it('updates winter water tint in place and reports the live winter state', () => {
    const tint = { base: vi.fn(), glints: vi.fn(), shore: vi.fn() };
    const layer = (setTint: (colour: number) => void) => ({
      layer: {
        setTint,
        setAlpha: vi.fn(),
      },
    });
    const surface = Object.assign(Object.create(WaterSurface.prototype), {
      area: { id: 'water-test' },
      grid: makeWaterGrid(area(['W'])),
      base: layer(tint.base),
      material: layer(vi.fn()),
      glints: layer(tint.glints),
      shore: layer(tint.shore),
      visibleCells: [],
      seconds: 0,
      paused: false,
      reducedMotion: false,
      darkness: 0,
      winter: false,
      cave: false,
      refreshVisibleCells: vi.fn(),
      animateVisibleCells: vi.fn(),
    }) as WaterSurface;
    const camera = { worldView: {} } as Phaser.Cameras.Scene2D.Camera;

    surface.update(camera, 0, { winter: true });
    expect(surface.snapshot().winter).toBe(true);
    expect(tint.base).toHaveBeenLastCalledWith(0xeaf6ff);
    expect(tint.glints).toHaveBeenLastCalledWith(0xe5fbff);
    expect(tint.shore).toHaveBeenLastCalledWith(0xe5f6ff);

    surface.update(camera, 0, { winter: false });
    expect(surface.snapshot().winter).toBe(false);
    expect(tint.base).toHaveBeenLastCalledWith(0xffffff);
    expect(tint.glints).toHaveBeenLastCalledWith(0xffffff);
    expect(tint.shore).toHaveBeenLastCalledWith(0xffffff);
  });
});
