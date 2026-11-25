import { describe, expect, it } from 'vitest';
import { give } from '../src/core/bag.ts';
import { charPlace, place, stepTarget } from '../src/core/quests.ts';
import { newGame } from '../src/core/state.ts';
import { content } from '../src/data/content.ts';

describe('delivery guidance', () => {
  it.each([
    ['sq_mummy_eggs', 1, 'egg', 2, 'pen_bing', 'mummy_pig'],
    ['j_apples', 0, 'apple', 5, 'square_apples', 'mum'],
  ] as const)('guides %s from the source to the recipient', (quest, step, item, quantity, source, recipient) => {
    const g = newGame(content, { seed: 7, hero: 'amelia' });
    g.s.quests[quest] = { step, n: 0, done: false };
    expect(stepTarget(g, quest)).toEqual(place(g, source));
    give(g, item, quantity, true);
    expect(stepTarget(g, quest)).toEqual(charPlace(g, recipient));
  });

  it('keeps the source marker if the recipient has no location', () => {
    const chars = { ...content.chars, mummy_pig: { ...content.chars.mummy_pig!, spots: [] } };
    const g = newGame({ ...content, chars }, { seed: 7, hero: 'amelia' });
    g.s.quests.sq_mummy_eggs = { step: 1, n: 0, done: false };
    give(g, 'egg', 2, true);
    expect(stepTarget(g, 'sq_mummy_eggs')).toEqual(place(g, 'pen_bing'));
    expect(g.rt.targetUp).toBe(0);
  });
});
