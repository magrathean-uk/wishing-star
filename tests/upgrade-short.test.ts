// Issue 62: at the story's sword upgrade with 2 iron bars and 4 emeralds, the game names what is missing, the iron
// bars cannot be sold to pay for it, and at 5 emeralds the upgrade works and the story goes on.
import { describe, expect, it } from 'vitest';
import { give } from '../src/core/bag.ts';
import { sell } from '../src/core/craft.ts';
import { upgrade, upgradeShort, wear } from '../src/core/gear.ts';
import { goalLine } from '../src/core/goal.ts';
import { enterArea } from '../src/core/hero.ts';
import { pollQuests } from '../src/core/quests.ts';
import { whereFrom } from '../src/core/source.ts';
import { newGame } from '../src/core/state.ts';
import type { Game } from '../src/core/types.ts';
import { content } from '../src/data/content.ts';

function atAnvil(): { g: Game; at: number } {
  const g = newGame(content, { seed: 5, hero: 'amelia' });
  g.s.quests.prologue!.done = true;
  const at = content.quests.ch3!.steps.findIndex((s) => s.t === 'upgrade');
  g.s.quests.ch3 = { step: at, n: 0 };
  g.s.tracked = 'ch3';
  g.s.flags.upgrades_open = 1;
  g.s.pouch.stone_sword = 1;
  wear(g, 'stone_sword');
  give(g, 'iron_ingot', 2, true);
  g.s.emeralds = 4;
  const bench = content.areas.island!.objects.find((o) => o.id === 'grandad_bench')!;
  enterArea(g, 'island', bench.x + 1, bench.y + 1.8, 'up');
  return { g, at };
}

describe('the story sword upgrade, one emerald short', () => {
  it('names the shortfall on the goal line and says where emeralds come from', () => {
    const { g } = atAnvil();
    expect(upgradeShort(g, 'stone_sword')).toEqual({ item: 'emerald', have: 4, need: 5 });
    expect(goalLine(g)!.num).toBe('Emeralds 4 of 5');
    expect(whereFrom(g, 'emerald')).toBe('Sell things at a shop');
  });

  it('keeps the iron bars out of a sale', () => {
    const { g } = atAnvil();
    const slot = g.s.bag.findIndex((sl) => sl?.id === 'iron_ingot');
    expect(sell(g, slot)).toBe(false);
    expect(g.s.emeralds).toBe(4);
  });

  it('works at 5 emeralds and the story moves on', () => {
    const { g, at } = atAnvil();
    g.s.emeralds = 5;
    expect(upgradeShort(g, 'stone_sword')).toBeNull();
    expect(upgrade(g, 'stone_sword')).toBe(true);
    pollQuests(g);
    expect(g.s.quests.ch3!.step > at || !!g.s.quests.ch3!.done).toBe(true);
    // and once it is done, the bars are hers to sell again
    give(g, 'iron_ingot', 1, true);
    const slot = g.s.bag.findIndex((sl) => sl?.id === 'iron_ingot');
    expect(sell(g, slot)).toBe(true);
  });
});
