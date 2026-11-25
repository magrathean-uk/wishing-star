// Package 68 (D62, second pass): what the blind runs on build 11 tripped on. Plain Node, no browser.
import { describe, expect, it } from 'vitest';
import { give } from '../src/core/bag.ts';
import { wear } from '../src/core/gear.ts';
import { NIGHT_AT } from '../src/core/cond.ts';
import { farLine, goalLine } from '../src/core/goal.ts';
import { free, rebuildArea, TERRAIN } from '../src/core/grid.ts';
import { findTarget, HALF } from '../src/core/hero.ts';
import { makeMob } from '../src/core/mobs.ts';
import { objective, stepTarget } from '../src/core/quests.ts';
import { eatsGoal, goalRecipe, missing, whereFrom } from '../src/core/source.ts';
import { newGame } from '../src/core/state.ts';
import { NO_INPUT, step } from '../src/core/step.ts';
import type { Game, Input } from '../src/core/types.ts';
import { content } from '../src/data/content.ts';

const playing = (): Game => {
  const g = newGame(content, { seed: 3, hero: 'amelia' });
  g.rt.mode = 'play';
  g.rt.talk = null;
  g.rt.cut = null;
  g.rt.card = null;
  g.rt.q = [];
  g.rt.spawnT = 1e9;
  g.rt.mobs.length = 0;
  g.rt.npcs.length = 0;
  for (const id in g.s.quests) g.s.quests[id]!.done = true;
  return g;
};
const run = (g: Game, inp: Partial<Input>, frames: number) => {
  for (let i = 0; i < frames; i++) {
    step(g, { ...NO_INPUT, ...inp });
    g.ev.length = 0;
  }
};
const onStep = (g: Game, qid: string, stepNo: number) => {
  for (const id of g.c.questOrder) g.s.quests[id] = { step: 0, n: 0, done: true };
  g.s.quests[qid] = { step: stepNo, n: 0, done: false };
  g.s.tracked = qid;
  g.rt.target = stepTarget(g, qid);
};
/** An open sand tile on the island with open sand on every side. */
const sandSpot = (g: Game): [number, number] => {
  const a = g.c.areas.island!;
  for (let y = 2; y < a.h - 2; y++)
    for (let x = 2; x < a.w - 2; x++) {
      let ok = true;
      for (let dy = -1; dy <= 1 && ok; dy++)
        for (let dx = -2; dx <= 2 && ok; dx++)
          ok =
            TERRAIN[a.terrain[y + dy]!.charAt(x + dx)]?.name === 'sand' &&
            free(g, 'island', x + dx + 0.5, y + dy + 0.5, HALF);
      if (ok) return [x, y];
    }
  throw new Error('no sand');
};

describe('fights for a child who mashes Space (package 68)', () => {
  const armed = () => {
    const g = playing();
    g.s.area = 'island';
    rebuildArea(g, 'island');
    give(g, 'wood_sword', 1, true);
    wear(g, 'wood_sword');
    give(g, 'wood_spade', 1, true);
    g.s.time = NIGHT_AT + 20;
    return g;
  };

  it('Space beside a mob swings, never digs the sand she faces, and turns her to the mob', () => {
    const g = armed();
    const [x, y] = sandSpot(g);
    g.s.x = x + 0.5;
    g.s.y = y + 0.5;
    g.s.dir = 'down';
    // a zombie behind her, a tile and a half away: today's reach plus half a tile
    const m = makeMob(g, 'zombie', g.s.x, g.s.y - 2.1);
    expect(findTarget(g).kind).toBe('swing');
    const hp = m.hp;
    run(g, { act: true }, 1);
    expect(g.s.dir).toBe('up');
    run(g, {}, 20);
    expect(m.hp < hp || m.gone).toBe(true);
  });

  it('a hit on a mob with more in it says how many are left', () => {
    const g = armed();
    // an open stretch of the plains
    g.s.x = 115.5;
    g.s.y = 50.5;
    const m = makeMob(g, 'zombie', g.s.x + 1, g.s.y);
    m.hp = 10;
    step(g, { ...NO_INPUT, act: true });
    let left = -1;
    for (let i = 0; i < 20 && left < 0; i++) {
      g.ev.length = 0;
      step(g, NO_INPUT);
      for (const e of g.ev) if (e.t === 'fx' && e.id === 'hitsleft') left = e.n ?? 0;
    }
    expect(left).toBeGreaterThan(0);
  });
});

describe('a talk step says who (package 68)', () => {
  it('chapter 1 opens with "Talk to Bandit", and "Go down to Heeler Heights" while he is far', () => {
    const g = playing();
    onStep(g, 'ch1', 0);
    const st = g.c.quests.ch1!.steps[0]!;
    expect(objective(g, 'ch1')).toBe('Talk to Bandit');
    expect(farLine(g, 'ch1', st)).toBe('Go down to Heeler Heights');
    // far from Bandit: the going; the line is the same in the quest book (goalLine)
    g.s.area = 'cottage';
    g.s.x = 3.5;
    g.s.y = 5.5;
    for (let i = 0; i < 20; i++) step(g, NO_INPUT);
    expect(goalLine(g)?.text).toBe('Go down to Heeler Heights');
  });

  it('a talk step with no far line of its own is "Find <who>", never a house', () => {
    const g = playing();
    for (const id in g.c.quests) {
      const steps = g.c.quests[id]!.steps;
      steps.forEach((st, i) => {
        if ((st.t !== 'talk' && st.t !== 'deliver') || st.far) return;
        onStep(g, id, i);
        expect(farLine(g, id, st), `${id}:${i}`).toMatch(/^Find /);
      });
    }
  });
});

describe('the bed after waking (package 68)', () => {
  it('Space works from beside the bed; after the morning card the bed rests and she stands clear of it', () => {
    const g = playing();
    g.s.area = 'cottage';
    rebuildArea(g, 'cottage');
    const bed = g.s.placed.find((p) => p.item === 'bed')!;
    // beside its foot, facing along the room (not at it)
    g.s.x = bed.x + 1.5;
    g.s.y = bed.y + 1.5;
    g.s.dir = 'down';
    expect(findTarget(g).hint).toBe('sleep');
    g.s.time = NIGHT_AT + 30;
    run(g, { act: true }, 1);
    expect(g.rt.mode).toBe('card');
    const day = g.s.day;
    run(g, {}, 60);
    run(g, { act: true }, 1);
    expect(g.s.day).toBe(day + 1);
    expect(g.rt.mode).toBe('play');
    // the next Spaces do not put her to bed again
    run(g, { act: true }, 1);
    run(g, {}, 30);
    run(g, { act: true }, 1);
    expect(g.rt.mode).toBe('play');
    expect(g.s.day).toBe(day + 1);
    const gap = Math.max(bed.x - g.s.x, g.s.x - (bed.x + 1), bed.y - g.s.y, g.s.y - (bed.y + 2));
    expect(gap).toBeGreaterThan(1);
  });
});

describe('crafting never eats what the goal needs (package 68)', () => {
  it('arrows ask first while the bow still needs the sticks; the goal line counts what is missing', () => {
    const g = playing();
    const i = g.c.quests.ch4!.steps.findIndex((s) => s.t === 'craft' && s.item === 'bow');
    onStep(g, 'ch4', i);
    if (!g.s.recipes.includes('bow')) g.s.recipes.push('bow');
    if (!g.s.recipes.includes('arrow')) g.s.recipes.push('arrow');
    give(g, 'stick', 3, true);
    give(g, 'string', 1, true);
    give(g, 'feather', 2, true);
    const want = goalRecipe(g)!;
    expect(want.r.out).toBe('bow');
    expect(missing(g, want.r, want.times)).toEqual([{ item: 'string', have: 1, need: 3 }]);
    expect(goalLine(g)?.num).toBe('String 1 of 3');
    expect(whereFrom(g, 'string')).toBe('From spiders');
    expect(eatsGoal(g, 'arrow')).toBe(true);
    expect(eatsGoal(g, 'bow')).toBe(false);
    give(g, 'string', 2, true);
    expect(goalLine(g)?.text).toMatch(/at the bench$/);
  });
});
