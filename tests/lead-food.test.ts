// Issue 56: at the sheep step with no wheat, the star goes to wheat she can pick, then to the sheep, then to the pen.
import { describe, expect, it } from 'vitest';
import { give } from '../src/core/bag.ts';
import { enterArea } from '../src/core/hero.ts';
import { place, stepTarget } from '../src/core/quests.ts';
import { newGame } from '../src/core/state.ts';
import type { Game } from '../src/core/types.ts';
import { content } from '../src/data/content.ts';

function atSheep(): Game {
  const g = newGame(content, { seed: 7, hero: 'amelia' });
  g.s.quests.prologue!.done = true;
  const at = content.quests.ch5!.steps.findIndex((s) => s.t === 'lead' && s.animal === 'sheep');
  g.s.quests.ch5 = { step: at, n: 0 };
  g.s.tracked = 'ch5';
  // over the old ford, on the way to the far fields
  g.s.flags.site_ford_bridge = 1;
  g.s.flags.ford_plan = 1;
  enterArea(g, 'island', 142.5, 72.5, 'right');
  return g;
}

describe('leading the sheep', () => {
  it('points to wheat she can pick while her bag has none', () => {
    const g = atSheep();
    const t = stepTarget(g, 'ch5')!;
    expect(t).not.toEqual(place(g, 'far_fields'));
    const o = content.areas.island!.objects.find((x) => x.x === t.x && x.y === t.y);
    expect(o?.type).toBe('wheat_wild');
    // the nearest patch, a short walk away
    expect(Math.hypot(t.x - g.s.x, t.y - g.s.y)).toBeLessThan(20);
  });

  it('points to the sheep once she has wheat, and to the pen once they follow', () => {
    const g = atSheep();
    give(g, 'wheat', 1, true);
    expect(stepTarget(g, 'ch5')).toEqual(place(g, 'far_fields'));
    g.s.animals.push({ k: 999, kind: 'sheep', led: true } as never);
    expect(stepTarget(g, 'ch5')).toEqual(place(g, 'pen_bopeep'));
  });

  it('keeps the field mark when no wheat can be picked here', () => {
    const g = atSheep();
    for (const o of content.areas.island!.objects) if (o.type === 'wheat_wild') g.s.taken[o.id] = 1;
    expect(stepTarget(g, 'ch5')).toEqual(place(g, 'far_fields'));
  });
});
