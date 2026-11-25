// Package 47a: archery (the eighth mini-game) and the cups every mini-game can be played for at its post, with the
// save that keeps them. Played headless through the real rules.
import { describe, expect, it } from 'vitest';
import { cupOpen } from '../src/core/cond.ts';
import {
  closeMini,
  cupNext,
  hard,
  MINIS,
  postCup,
  startMini,
  TARGETS,
  targetSide,
  winMini,
} from '../src/core/minigames.ts';
import { load, serialize } from '../src/core/save.ts';
import { newGame } from '../src/core/state.ts';
import { NO_INPUT, step } from '../src/core/step.ts';
import type { Game, Input } from '../src/core/types.ts';
import { content } from '../src/data/content.ts';
import { playOne } from '../tools/check/kidbot.ts';

const fresh = (seed = 7, gentle = false): Game => {
  const g = newGame(content, { seed, hero: 'amelia', opts: { gentle } });
  g.rt.mode = 'play';
  g.rt.talk = null;
  g.rt.q = [];
  return g;
};
const press = (over: Partial<Input>): Input => ({ ...NO_INPUT, ...over });
const begin = (g: Game, game: string, cup = 0) => {
  startMini(g, game, null, '', cup);
  for (let i = 0; i < 60 && g.rt.mini!.st === 0; i++) step(g, press({ act: true }));
  return g.rt.mini!;
};

describe('archery (targets)', () => {
  it('is the eighth mini-game', () => {
    expect(Object.keys(MINIS)).toHaveLength(8);
    expect(MINIS.targets).toBeDefined();
  });

  it('shoots the way she faces, and X alone shoots', () => {
    const g = fresh();
    const m = begin(g, 'targets');
    step(g, press({ mx: -1 }));
    expect(m.n[2]).toBe(1);
    for (let i = 0; i < 30; i++) step(g, NO_INPUT);
    step(g, press({ fire: true }));
    const arrow = m.objs.find((o) => o.k === 1)!;
    expect(arrow.vx).toBeLessThan(0);
    expect(arrow.vy).toBe(0);
    step(g, press({ my: -1 }));
    expect(m.n[2]).toBe(0);
  });

  it('never uses up her own arrows', () => {
    const g = fresh();
    const before = JSON.stringify(g.s.bag);
    const m = begin(g, 'targets');
    for (let i = 0; i < 600; i++) step(g, press({ fire: i % 30 === 0 }));
    expect(m.n[9]).toBeGreaterThan(5);
    expect(JSON.stringify(g.s.bag)).toBe(before);
  });

  it('puts flank targets on the flanks and sliders on their side', () => {
    expect(targetSide({ x: TARGETS.side.left })).toBe(1);
    expect(targetSide({ x: TARGETS.side.right })).toBe(2);
    expect(targetSide({ x: TARGETS.w / 2 })).toBe(0);
  });

  it('is a set piece a child wins: about a minute, 2 stars or more', () => {
    const runs = [1, 2, 3, 4, 5].map((k) => playOne('targets', 100 + k * 31));
    for (const r of runs) {
      expect(r.secs).toBeGreaterThan(45);
      expect(r.secs).toBeLessThan(90);
    }
    expect(runs.filter((r) => r.stars >= 2).length).toBeGreaterThanOrEqual(4);
  });

  it('still gives a star to a child who never hits anything', () => {
    const g = fresh();
    const m = begin(g, 'targets');
    for (let i = 0; i < 60 * 120 && m.st !== 2; i++) step(g, NO_INPUT);
    expect(m.st).toBe(2);
    expect(m.stars).toBe(1);
  });
});

describe('cups', () => {
  it('open the day after she first plays a game', () => {
    const g = fresh();
    expect(cupOpen(g, 'keepy')).toBe(false);
    expect(cupNext(g, 'keepy')).toBe(0);
    begin(g, 'keepy');
    winMini(g, 2);
    expect(cupOpen(g, 'keepy')).toBe(false);
    g.s.day += 1;
    expect(cupOpen(g, 'keepy')).toBe(true);
    expect(cupNext(g, 'keepy')).toBe(1);
  });

  it('go bronze, silver, gold; gold sets the flag and stays the tier', () => {
    const g = fresh();
    begin(g, 'race');
    winMini(g, 3);
    g.s.day += 1;
    for (const tier of [1, 2, 3] as const) {
      expect(cupNext(g, 'race')).toBe(tier);
      const m = begin(g, 'race', cupNext(g, 'race'));
      expect(hard(m)).toBe(tier - 1);
      g.ev.length = 0;
      winMini(g, 3);
      expect(g.s.cups.race).toBe(tier);
      expect(m.cupWon).toBe(tier);
      expect(g.ev).toContainEqual({ t: 'cup', game: 'race', tier });
    }
    expect(g.s.flags.cup_race).toBe(1);
    expect(cupNext(g, 'race')).toBe(3);
  });

  it('are not won with too few stars, and never go down', () => {
    const g = fresh();
    begin(g, 'snowball');
    winMini(g, 3);
    g.s.day += 1;
    begin(g, 'snowball', 1);
    winMini(g, 1);
    expect(g.s.cups.snowball ?? 0).toBe(0);
    begin(g, 'snowball', 1);
    winMini(g, 2);
    expect(g.s.cups.snowball).toBe(1);
    begin(g, 'snowball', 2);
    winMini(g, 2);
    expect(g.s.cups.snowball).toBe(1);
    begin(g, 'snowball', 1);
    winMini(g, 3);
    expect(g.s.cups.snowball).toBe(1);
  });

  it('make a go harder: gold Keepy Uppy asks for more hits', () => {
    const g = fresh();
    const m = begin(g, 'keepy', 3);
    expect(m.goal).toBeGreaterThan(20);
    closeMini(g);
  });

  it('wait while a quest wants the game: that go is the story one', () => {
    const g = fresh();
    begin(g, 'targets');
    winMini(g, 3);
    g.s.day += 1;
    expect(postCup(g, 'targets')).toBe(1);
    g.s.quests.ch4 = { step: content.quests.ch4!.steps.findIndex((s) => s.t === 'mini' && s.game === 'targets'), n: 0 };
    expect(postCup(g, 'targets')).toBe(0);
  });
});

describe('cups in the save', () => {
  it('round-trip', () => {
    const g = fresh();
    g.s.cups = { keepy: 2, targets: 3 };
    const back = load(content, serialize(g));
    expect(back.s.cups).toEqual({ keepy: 2, targets: 3 });
  });

  it('an old save without cups gets none, and broken entries are dropped', () => {
    const g = fresh();
    const raw = JSON.parse(serialize(g));
    delete raw.cups;
    expect(load(content, JSON.stringify(raw)).s.cups).toEqual({});
    raw.cups = { keepy: 7, race: 'gold', hide: 2 };
    expect(load(content, JSON.stringify(raw)).s.cups).toEqual({ hide: 2 });
    raw.cups = [1, 2];
    expect(load(content, JSON.stringify(raw)).s.cups).toEqual({});
  });
});
