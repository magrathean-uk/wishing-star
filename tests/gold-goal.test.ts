// Issue 60: the chapter 6 gold step asks for what the counter counts (3 in her bag), however many she already has.
import { describe, expect, it } from 'vitest';
import { give } from '../src/core/bag.ts';
import { goalLine } from '../src/core/goal.ts';
import { pollQuests } from '../src/core/quests.ts';
import { newGame } from '../src/core/state.ts';
import { content } from '../src/data/content.ts';

function atGold(have: number) {
  const g = newGame(content, { seed: 7, hero: 'amelia' });
  g.s.quests.prologue!.done = true;
  const at = content.quests.ch6!.steps.findIndex((s) => s.t === 'fetch' && s.item === 'gold_ore' && (s.n ?? 1) === 3);
  g.s.quests.ch6 = { step: at, n: 0 };
  g.s.tracked = 'ch6';
  if (have) give(g, 'gold_ore', have, true);
  return { g, at };
}

describe('the gold ore step', () => {
  it.each([0, 1, 2])('says the same thing as its counter with %i ore', (have) => {
    const { g } = atGold(have);
    const goal = goalLine(g)!;
    expect(goal.text).toBe('Get 3 gold ore');
    expect(goal.num).toMatch(new RegExp(`${have} of 3$`));
  });

  it('moves on at 3', () => {
    const { g, at } = atGold(3);
    pollQuests(g);
    expect(g.s.quests.ch6!.step).toBe(at + 1);
  });
});
