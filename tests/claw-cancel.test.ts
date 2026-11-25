import { describe, expect, it } from 'vitest';
import { enterArea } from '../src/core/hero.ts';
import { newGame } from '../src/core/state.ts';
import { NO_INPUT, step } from '../src/core/step.ts';
import { content } from '../src/data/content.ts';

function ready() {
  const g = newGame(content, { seed: 7 });
  g.s.quests.prologue!.done = true;
  enterArea(g, 'island', 60.5, 72.5, 'left');
  return g;
}

function open(g: ReturnType<typeof ready>) {
  step(g, { ...NO_INPUT, act: true });
  expect(g.rt.mini?.game).toBe('claw');
  for (let i = 0; i < 30; i++) step(g, NO_INPUT);
}

describe('claw attempts', () => {
  it('keeps the first free attempt when the player leaves the start card', () => {
    const g = ready();
    open(g);
    step(g, { ...NO_INPUT, back: true });
    expect(g.s.flags.claw_free).toBeUndefined();
    open(g);
    step(g, { ...NO_INPUT, act: true });
    expect(g.rt.mini?.st).toBe(1);
    expect(g.s.flags.claw_free).toBe(1);
  });

  it('keeps an earned attempt when the player leaves, then uses one when play starts', () => {
    const g = ready();
    g.s.flags.claw_free = 1;
    g.s.counts.clawGoes = 2;
    open(g);
    step(g, { ...NO_INPUT, back: true });
    expect(g.s.counts.clawGoes).toBe(2);
    open(g);
    step(g, { ...NO_INPUT, act: true });
    expect(g.s.counts.clawGoes).toBe(1);
  });
});
