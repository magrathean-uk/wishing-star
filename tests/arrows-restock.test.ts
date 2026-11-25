// Issue 65: out of arrows at a high web on the chapter 4 trail, the goal and the star say where to get more; with
// arrows again they go back to the web.
import { describe, expect, it } from 'vitest';
import { give } from '../src/core/bag.ts';
import { wear } from '../src/core/gear.ts';
import { goalLine } from '../src/core/goal.ts';
import { enterArea } from '../src/core/hero.ts';
import { place, stepTarget } from '../src/core/quests.ts';
import { newGame } from '../src/core/state.ts';
import type { Game } from '../src/core/types.ts';
import { content } from '../src/data/content.ts';

function atHighWeb(): Game {
  const g = newGame(content, { seed: 7, hero: 'amelia' });
  g.s.quests.prologue!.done = true;
  g.s.quests.ch4 = {
    step: content.quests.ch4!.steps.findIndex((s) => s.t === 'reach' && s.place === 'herd_joey_3'),
    n: 0,
  };
  g.s.tracked = 'ch4';
  // she came down the trail: its webs are cut and its fallen tree is chopped; the high webs are still up
  g.s.taken.trail_gum = 1;
  for (const o of content.areas.island!.objects)
    if (o.type === 'web_wall' || o.type === 'fallen_gum') g.s.taken[o.id] = 1;
  g.s.recipes.push('bow', 'arrow');
  give(g, 'bow', 1, true);
  wear(g, 'bow');
  enterArea(g, 'island', 38.35, 34.5, 'left');
  return g;
}
const objAt = (x: number, y: number) =>
  content.areas.island!.objects.find((o) => o.x === x && o.y === y && content.objects[o.type]?.node);
const at = (g: Game) => {
  g.rt.target = stepTarget(g, 'ch4');
  return g.rt.target;
};

describe('out of arrows at a high web', () => {
  it('goes for a feather when she has none', () => {
    const g = atHighWeb();
    const t = at(g)!;
    expect(g.rt.restock).toBe('feather');
    expect(goalLine(g)!.text).toBe('Find a feather for arrows');
    expect(objAt(t.x, t.y)?.type).toBe('feather');
  });

  it('goes for a stick when she has a feather', () => {
    const g = atHighWeb();
    give(g, 'feather', 1, true);
    at(g);
    expect(g.rt.restock).toBe('stick');
    expect(goalLine(g)!.text).toBe('Find a stick for arrows');
  });

  it('goes to a bench when a stick and a feather are in her bag', () => {
    const g = atHighWeb();
    give(g, 'feather', 1, true);
    give(g, 'stick', 1, true);
    const t = at(g)!;
    expect(g.rt.restock).toBe('make');
    expect(goalLine(g)!.text).toBe('Make arrows at a bench');
    const o = content.areas.island!.objects.find((x) => x.x === t.x && x.y === t.y);
    expect(content.objects[o!.type]?.interact).toBe('table');
  });

  it('goes back to the web once she has arrows', () => {
    const g = atHighWeb();
    give(g, 'arrow', 4, true);
    expect(at(g)).toEqual(place(g, 'herd_joey_3'));
    expect(g.rt.restock).toBe('');
    expect(goalLine(g)!.text).toBe('Hit the high webs with arrows');
  });
});
