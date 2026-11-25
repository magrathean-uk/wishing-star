// Issue 50: a game saved while the "Safe at home" card shows (or any save with no hearts) wakes her at home the next
// morning with full hearts, the same bag and the same quest, and a second reload does not do the morning again.
import { describe, expect, it } from 'vitest';
import { count } from '../src/core/cond.ts';
import { enterArea, hurtHero } from '../src/core/hero.ts';
import { load, serialize } from '../src/core/save.ts';
import { newGame } from '../src/core/state.ts';
import { NO_INPUT, step } from '../src/core/step.ts';
import type { Game } from '../src/core/types.ts';
import { content } from '../src/data/content.ts';

function out(): Game {
  const g = newGame(content, { seed: 7, hero: 'amelia' });
  g.s.quests.prologue!.done = true;
  g.s.quests.ch1 = { step: 2, n: 0 };
  g.s.tracked = 'ch1';
  g.s.bag[3] = { id: 'bread', n: 2 };
  g.rt.mode = 'play';
  g.rt.talk = null;
  g.rt.cut = null;
  g.rt.q = [];
  enterArea(g, 'island', 80.5, 60.5, 'down');
  g.s.hp = 1;
  hurtHero(g, 4, g.s.x + 1, g.s.y);
  expect(g.s.hp).toBe(0);
  expect(g.rt.card?.kind).toBe('carried');
  return g;
}

/** Load a save and play until a card shows (or a few seconds pass), then close it with Space. */
function wake(json: string): Game {
  const g = load(content, json);
  g.rt.mode = 'play';
  g.rt.talk = null;
  g.rt.cut = null;
  g.rt.q = [];
  for (let i = 0; i < 120 && !g.rt.card; i++) step(g, NO_INPUT);
  expect(g.rt.card?.kind).toBe('carried');
  for (let i = 0; i < 90; i++) step(g, NO_INPUT);
  step(g, { ...NO_INPUT, act: true });
  return g;
}

describe('a save made with no hearts', () => {
  it('wakes her at home next morning with everything kept', () => {
    const g = out();
    const day = g.s.day;
    const carried = g.s.counts.carried;
    const g2 = wake(serialize(g));
    expect(g2.rt.card).toBeNull();
    expect(g2.s.hp).toBe(g2.s.maxHp);
    expect(g2.s.day).toBe(day + 1);
    expect(count(g2, 'bread')).toBe(2);
    expect(g2.s.quests.ch1!.step).toBe(2);
    expect(g2.s.tracked).toBe('ch1');
    // the same faint, not a second one
    expect(g2.s.counts.carried).toBe(carried);

    // and once she is up, another reload is an ordinary one
    const g3 = load(content, serialize(g2));
    g3.rt.mode = 'play';
    g3.rt.talk = null;
    g3.rt.cut = null;
    g3.rt.q = [];
    for (let i = 0; i < 120; i++) step(g3, NO_INPUT);
    expect(g3.rt.card?.kind).not.toBe('carried');
    expect(g3.s.day).toBe(day + 1);
    expect(g3.s.hp).toBe(g3.s.maxHp);
  });

  it('mends an older save that already has zero hearts', () => {
    const g = newGame(content, { seed: 7, hero: 'amelia' });
    g.s.quests.prologue!.done = true;
    g.s.hp = 0;
    const day = g.s.day;
    const g2 = wake(serialize(g));
    expect(g2.s.hp).toBe(g2.s.maxHp);
    expect(g2.s.day).toBe(day + 1);
  });
});
