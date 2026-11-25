import { describe, expect, it } from 'vitest';
import { NIGHT_AT } from '../src/core/cond.ts';
import { enterArea, findTarget } from '../src/core/hero.ts';
import { newGame } from '../src/core/state.ts';
import { NO_INPUT, step } from '../src/core/step.ts';
import { content } from '../src/data/content.ts';

function atBed(home: string, side: string) {
  const g = newGame(content, { seed: 7 });
  g.s.quests.prologue!.done = true;
  g.s.quests[home] = { step: content.quests[home]!.steps.findIndex((s) => s.t === 'sleep'), n: 0 };
  g.s.quests[side] = { step: content.quests[side]!.steps.findIndex((s) => s.t === 'night'), n: 0 };
  g.s.tracked = home;
  g.s.time = NIGHT_AT;
  enterArea(g, 'cottage', 2.5, 4.5, 'up');
  expect(findTarget(g).placed?.item).toBe('bed');
  return g;
}

describe('bed with overlapping quests', () => {
  it.each([
    ['home2', 'sq_pando_stars'],
    ['home3', 'sq_bingo_night'],
  ])('lets the player sleep for %s while %s awaits night', (home, side) => {
    const g = atBed(home, side);
    step(g, { ...NO_INPUT, act: true });
    expect(g.rt.card?.kind).toBe('tomorrow');
  });

  it('still helps the player wait for a tracked night quest', () => {
    const g = atBed('home2', 'sq_pando_stars');
    g.s.tracked = 'sq_pando_stars';
    g.s.time = 300;
    step(g, { ...NO_INPUT, act: true });
    expect(g.rt.talk?.text).toBe(content.strings.bed_night);
  });
});
