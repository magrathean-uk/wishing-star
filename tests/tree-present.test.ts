// Issue 67: after the credits the goal names the thing to pick up (the star lamp by the Great Tree), not the
// Christmas presents there, and picking it up moves on to putting it in her home.
import { describe, expect, it } from 'vitest';
import { goalLine } from '../src/core/goal.ts';
import { enterArea } from '../src/core/hero.ts';
import { place, startQuest } from '../src/core/quests.ts';
import { newGame } from '../src/core/state.ts';
import { NO_INPUT, step } from '../src/core/step.ts';
import { content } from '../src/data/content.ts';

describe('the present under the Great Tree', () => {
  it.each([true, false])('says to pick up the star lamp, then to put it at home (Christmas %s)', (xmas) => {
    const g = newGame(content, { seed: 7, hero: 'amelia' });
    g.s.xmas = xmas;
    for (const id in g.s.quests) g.s.quests[id]!.done = true;
    g.rt.mode = 'play';
    g.rt.talk = null;
    g.rt.cut = null;
    g.rt.q = [];
    startQuest(g, 'sq_tree_present');
    g.s.tracked = 'sq_tree_present';
    const goal = goalLine(g)!.text;
    expect(goal).toMatch(/star lamp/);
    expect(goal).not.toMatch(/present/i);
    const drop = g.s.drops.find((d) => d.id === 'star_lamp')!;
    expect(drop).toBeTruthy();
    const tree = place(g, 'great_tree')!;
    expect(Math.hypot(drop.x - tree.x, drop.y - tree.y)).toBeLessThan(2);
    enterArea(g, 'island', drop.x, drop.y + 0.4, 'up');
    for (let i = 0; i < 120 && g.s.quests.sq_tree_present!.step === 0; i++) step(g, NO_INPUT);
    expect(g.s.quests.sq_tree_present!.step).toBe(1);
    expect(goalLine(g)!.text).toBe('Put the star lamp in your home');
  });
});
