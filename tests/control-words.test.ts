// Issue 66: the armour stand, sign and minecart lines name no key (an iPad has none), and the button by a sign that
// has no words yet says Write.
import { describe, expect, it } from 'vitest';
import { enterArea, findTarget } from '../src/core/hero.ts';
import { newGame } from '../src/core/state.ts';
import type { Line, Step } from '../src/core/types.ts';
import { content } from '../src/data/content.ts';

const lines = (st: Step | undefined): string[] => (st?.say ?? []).map((l: Line) => (typeof l === 'string' ? l : l.l));

describe('story lines that teach a control', () => {
  it('say what to do, not which key', () => {
    const home1 = content.quests.home1!.steps;
    const stand = home1.find((s) => s.t === 'place' && s.item === 'armour_stand');
    const sign = home1.find((s) => s.t === 'talk' && lines(s).some((l) => l.includes('sign')));
    const carts = content.quests.ch6!.steps.find((s) => s.t === 'reach' && s.place === 'shard_cave');
    for (const st of [stand, sign, carts]) {
      expect(lines(st).length).toBeGreaterThan(0);
      for (const l of lines(st)) expect(l).not.toMatch(/\bSpace\b/);
    }
  });

  it('offers Write by a blank sign and Read once it has words', () => {
    const g = newGame(content, { seed: 7, hero: 'amelia' });
    g.s.quests.prologue!.done = true;
    enterArea(g, 'cottage', 3.5, 3.5, 'right');
    g.rt.npcs = [];
    g.s.placed.push({ k: 900, item: 'sign_item', area: 'cottage', x: 4, y: 3 });
    expect(findTarget(g).hint).toBe('write');
    g.s.placed.at(-1)!.text = 'Hello';
    expect(findTarget(g).hint).toBe('read');
  });
});
