// Issue 17: a seeker who stays near the start in Hide and Seek is shown the way by giggles that come sooner the
// longer she goes without a find, and Back leaves a round part way without losing the story step.
import { describe, expect, it } from 'vitest';
import { HIDE, startMini } from '../src/core/minigames.ts';
import { newGame } from '../src/core/state.ts';
import { NO_INPUT, step } from '../src/core/step.ts';
import type { Game } from '../src/core/types.ts';
import { content } from '../src/data/content.ts';

function seeking(): Game {
  const g = newGame(content, { seed: 7, hero: 'amelia' });
  g.s.quests.prologue!.done = true;
  g.rt.mode = 'play';
  g.rt.talk = null;
  g.rt.q = [];
  const at = content.quests.ch2!.steps.findIndex((s) => s.t === 'mini' && s.game === 'hide');
  g.s.quests.ch2 = { step: at, n: 0 };
  g.s.tracked = 'ch2';
  startMini(g, 'hide');
  for (let i = 0; i < 60 && g.rt.mini!.st === 0; i++) step(g, { ...NO_INPUT, act: true });
  // past the count to ten
  for (let i = 0; i < 60 * (HIDE.count + 0.5); i++) step(g, NO_INPUT);
  expect(g.rt.mini!.n[6]).toBe(1);
  return g;
}

describe('hide and seek when she cannot find anyone', () => {
  it('starts loud giggles in round 1 and makes them come more often', () => {
    const g = seeking();
    const m = g.rt.mini!;
    const times: number[] = [];
    for (let i = 0; i < 60 * 40; i++) {
      step(g, NO_INPUT);
      if (g.ev.some((e) => e.t === 'sfx' && e.id === 'giggle') && m.objs.some((o) => o.vy >= 1.29)) times.push(i / 60);
      g.ev.length = 0;
    }
    expect(m.n[5]).toBe(0);
    expect(m.n[2]).toBe(0);
    expect(times.length).toBeGreaterThan(0);
    // nothing out loud at first: round 1 is still a plain search
    expect(times[0]!).toBeGreaterThanOrEqual(HIDE.clueFirst - 1);
    expect(times[0]!).toBeLessThan(HIDE.clueFirst + HIDE.clueGap[0]!);
    // and once she has looked a long time, a giggle every few seconds
    const late = times.filter((t) => t >= HIDE.clueSoon + HIDE.clueGap[0]!);
    expect(late.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < late.length; i++) expect(late[i]! - late[i - 1]!).toBeLessThanOrEqual(HIDE.clueSoonGap + 0.1);
  });

  it('goes back to the slow giggles after a find', () => {
    const g = seeking();
    const m = g.rt.mini!;
    m.n[14] = HIDE.clueSoon + 5;
    // walk into the place where a friend hides
    const friend = m.objs.find((o) => o.vx)!;
    m.n[0] = friend.x;
    m.n[1] = friend.y + (friend.y > 0 ? -1 : 1);
    for (let i = 0; i < 30 && m.n[2] === 0; i++) {
      step(g, { ...NO_INPUT, act: true });
      for (let k = 0; k < 60; k++) step(g, NO_INPUT);
    }
    expect(m.n[2]).toBe(1);
    expect(m.n[14]!).toBeLessThan(HIDE.clueSoon);
  });

  it('leaves the round with Back and keeps the story step', () => {
    const g = seeking();
    const before = g.s.quests.ch2!.step;
    step(g, { ...NO_INPUT, back: true });
    expect(g.rt.mini).toBeNull();
    expect(g.rt.mode).toBe('play');
    expect(g.s.quests.ch2!.step).toBe(before);
    expect(g.s.quests.ch2!.done).toBeFalsy();
  });

  it('leaves the round with Escape too', () => {
    const g = seeking();
    const before = g.s.quests.ch2!.step;
    step(g, { ...NO_INPUT, cmd: { c: 'back' } });
    expect(g.rt.mini).toBeNull();
    expect(g.s.quests.ch2!.step).toBe(before);
  });

  it('does not leave a game that shoots with Escape', () => {
    const g = newGame(content, { seed: 7, hero: 'amelia' });
    g.rt.mode = 'play';
    g.rt.talk = null;
    g.rt.q = [];
    startMini(g, 'targets');
    for (let i = 0; i < 60 && g.rt.mini!.st === 0; i++) step(g, { ...NO_INPUT, act: true });
    for (let i = 0; i < 30; i++) step(g, NO_INPUT);
    step(g, { ...NO_INPUT, cmd: { c: 'back' } });
    expect(g.rt.mini?.game).toBe('targets');
  });

  it('does not leave a game that shoots with X', () => {
    const g = newGame(content, { seed: 7, hero: 'amelia' });
    g.rt.mode = 'play';
    g.rt.talk = null;
    g.rt.q = [];
    startMini(g, 'targets');
    for (let i = 0; i < 60 && g.rt.mini!.st === 0; i++) step(g, { ...NO_INPUT, act: true });
    for (let i = 0; i < 30; i++) step(g, NO_INPUT);
    step(g, { ...NO_INPUT, back: true, fire: true });
    expect(g.rt.mini?.game).toBe('targets');
  });
});
