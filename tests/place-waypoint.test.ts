import { describe, expect, it } from 'vitest';
import { goalLine } from '../src/core/goal.ts';
import { place, stepTarget } from '../src/core/quests.ts';
import { newGame } from '../src/core/state.ts';
import { NO_INPUT, step } from '../src/core/step.ts';
import { content } from '../src/data/content.ts';

function game(quest: string, index: number, area: string) {
  const g = newGame(content, { seed: 7, hero: 'amelia' });
  g.rt.mode = 'play';
  g.rt.talk = null;
  g.rt.cut = null;
  g.rt.card = null;
  g.rt.q = [];
  g.s.quests = { [quest]: { step: index, n: 0, done: false } };
  g.s.tracked = quest;
  g.s.area = area;
  for (let i = 0; i < 20; i++) step(g, NO_INPUT);
  return g;
}

describe('placement guidance', () => {
  it('keeps the cottage objective visible once inside', () => {
    const g = game('home1', 2, 'cottage');
    expect(goalLine(g)?.text).toBe('Place the stand in your cottage');
    expect(stepTarget(g, 'home1')).toBeNull();
  });

  it('guides a house-only item to the cottage from outside', () => {
    const g = game('home1', 2, 'island');
    expect(stepTarget(g, 'home1')).toEqual(place(g, 'bed'));
  });

  it('keeps outdoor placement aimed at the plot', () => {
    const g = game('home1', 5, 'cottage');
    expect(stepTarget(g, 'home1')).toEqual(place(g, 'plot_gate'));
  });

  it('keeps the cottage objective for furniture usable outdoors', () => {
    const index = content.quests.home3!.steps.findIndex((st) => st.t === 'place' && st.item === 'furnace');
    const g = game('home3', index, 'cottage');
    expect(goalLine(g)?.text).toBe('Place the furnace in your cottage');
    expect(stepTarget(g, 'home3')).toBeNull();
  });
});
