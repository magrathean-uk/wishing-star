import { describe, expect, it } from 'vitest';
import { enterArea } from '../src/core/hero.ts';
import { plotRect } from '../src/core/bag.ts';
import { placeItem, removeAt } from '../src/core/build.ts';
import { NO_INPUT, step } from '../src/core/step.ts';
import { newGame } from '../src/core/state.ts';
import type { Game } from '../src/core/types.ts';
import { content } from '../src/data/content.ts';
import { PlacedTileMask } from '../src/game/world/placed-mask.ts';

function putInBag(g: Game, item: string): void {
  g.s.bag[0] = { id: item, n: 1 };
}

describe('placed tile vegetation mask', () => {
  it('tracks the real home plot through placement, removal, replacement, and world revisions', () => {
    const g = newGame(content, { seed: 13, hero: 'amelia' });
    g.rt.mode = 'play';
    enterArea(g, 'island', 72.5, 78.5, 'down');
    const area = content.areas.island!;
    const plot = plotRect(g);
    const x = 72;
    const y = 79;
    expect(x).toBeGreaterThanOrEqual(plot.x);
    expect(y).toBeGreaterThanOrEqual(plot.y);
    expect(area.terrain[y]!.charAt(x)).toBe('g');
    expect(area.region[y]!.charAt(x)).toBe('H');

    const mask = new PlacedTileMask();
    expect(mask.refresh(g, area)).toBe(true);
    expect(mask.has(area, x, y)).toBe(false);

    const beforeFloor = g.rt.worldRev;
    putInBag(g, 'farmland');
    expect(placeItem(g, 'farmland', x, y)).toBe(true);
    step(g, NO_INPUT);
    expect(g.rt.worldRev).toBeGreaterThan(beforeFloor);
    expect(mask.refresh(g, area)).toBe(true);
    expect(mask.has(area, x, y)).toBe(true);
    expect(mask.refresh(g, area)).toBe(false);

    const beforeRemoval = g.rt.worldRev;
    expect(removeAt(g, x, y)).toBe(true);
    step(g, NO_INPUT);
    expect(g.rt.worldRev).toBeGreaterThan(beforeRemoval);
    expect(mask.refresh(g, area)).toBe(true);
    expect(mask.has(area, x, y)).toBe(false);

    const beforeRug = g.rt.worldRev;
    putInBag(g, 'rug');
    expect(placeItem(g, 'rug', x, y)).toBe(true);
    step(g, NO_INPUT);
    expect(g.rt.worldRev).toBeGreaterThan(beforeRug);
    expect(mask.refresh(g, area)).toBe(true);
    for (const [tx, ty] of [
      [72, 79],
      [73, 79],
      [72, 80],
      [73, 80],
    ] as const)
      expect(mask.has(area, tx, ty)).toBe(true);

    expect(removeAt(g, x, y)).toBe(true);
    step(g, NO_INPUT);
    const beforeFurniture = g.rt.worldRev;
    putInBag(g, 'bench');
    expect(placeItem(g, 'bench', x, y)).toBe(true);
    step(g, NO_INPUT);
    expect(g.rt.worldRev).toBeGreaterThan(beforeFurniture);
    expect(mask.refresh(g, area)).toBe(true);
    expect(mask.has(area, x, y)).toBe(true);
    expect(mask.has(area, x + 1, y)).toBe(true);
    expect(mask.has(area, x, y + 1)).toBe(false);
  });
});
