// Issue 58: on an iPad the Bag's Gear tab opens the Gear page, and the Gear page's Bag tab goes back, as Q does.
import { describe, expect, it } from 'vitest';
import { fakeUi } from './menu-harness.ts';
import { newGame } from '../src/core/state.ts';
import { content } from '../src/data/content.ts';

const { BagMenu } = await import('../src/game/ui/menus/bag.ts');
const { GearMenu } = await import('../src/game/ui/menus/gear.ts');

describe('the bag and gear tabs on touch', () => {
  it('a tap on the Gear tab opens the Gear page; a tap on a bag slot does not', () => {
    const g = newGame(content, { seed: 7, hero: 'amelia' });
    const { ui, opened, step } = fakeUi(g);
    const bag = new BagMenu(ui);
    // the bag's panel starts at x 282 on the 1920 wide screen; the Gear tab sits beside the title
    expect(bag.tap(282 + 200, 134)).toBe(true);
    step(bag, {});
    expect(opened).toEqual(['gear']);

    const again = new BagMenu(ui);
    expect(again.tap(320, 400)).toBe(false);
  });

  it('the chest has no Gear tab', () => {
    const g = newGame(content, { seed: 7, hero: 'amelia' });
    g.s.chests.c1 = Array(27).fill(null);
    const { ui, opened, step } = fakeUi(g);
    const bag = new BagMenu(ui, 'c1');
    bag.tap(282 + 200, 134);
    step(bag, {});
    expect(opened).toEqual([]);
  });

  it('a tap on the Bag tab goes back to the bag; elsewhere the page keeps its own taps', () => {
    const g = newGame(content, { seed: 7, hero: 'amelia' });
    const { ui, opened, step } = fakeUi(g);
    const gear = new GearMenu(ui);
    expect(gear.tap(1400, 500)).toBe(false);
    expect(gear.tap(160, 88)).toBe(true);
    step(gear, {});
    expect(opened).toEqual(['bag']);
  });
});
