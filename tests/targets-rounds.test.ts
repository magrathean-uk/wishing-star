import { describe, expect, it } from 'vitest';
import { startMini } from '../src/core/minigames.ts';
import { newGame } from '../src/core/state.ts';
import { NO_INPUT, step } from '../src/core/step.ts';
import { content } from '../src/data/content.ts';

describe('targets rounds', () => {
  it('finishes all three rounds when the player keeps shooting', () => {
    const g = newGame(content, { seed: 7 });
    g.s.quests.prologue!.done = true;
    g.s.quests.ch4 = { step: content.quests.ch4!.steps.findIndex((s) => s.t === 'mini' && s.game === 'targets'), n: 0 };
    g.s.tracked = 'ch4';
    startMini(g, 'targets');
    for (let i = 0; i < 30; i++) step(g, NO_INPUT);
    step(g, { ...NO_INPUT, act: true });
    const rounds = new Set<number>();
    for (let i = 0; i < 180 * 60 && g.rt.mini?.st === 1; i++) {
      rounds.add(g.rt.mini.round ?? 0);
      step(g, { ...NO_INPUT, act: i % 25 === 0 });
      g.ev.length = 0;
    }
    expect([...rounds]).toEqual([0, 1, 2]);
    expect(g.rt.mini?.st).toBe(2);
  });
});
