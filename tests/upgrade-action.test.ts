import { expect, it } from 'vitest';
import { enterArea, findTarget } from '../src/core/hero.ts';
import { newGame } from '../src/core/state.ts';
import { NO_INPUT, step } from '../src/core/step.ts';
import { content } from '../src/data/content.ts';

it('opens the tracked sword upgrade with the action button at Grandad’s bench', () => {
  const g = newGame(content, { seed: 5, hero: 'amelia' });
  g.rt.mode = 'play';
  g.rt.talk = null;
  g.rt.cut = null;
  g.rt.q = [];
  g.rt.spawnT = 1e9;
  const index = content.quests.ch3!.steps.findIndex((s) => s.t === 'upgrade');
  g.s.quests.ch3 = { step: index, n: 0, done: false, day: 1 };
  g.s.tracked = 'ch3';
  g.s.flags.upgrades_open = 1;
  const bench = content.areas.island!.objects.find((o) => o.id === 'grandad_bench')!;
  enterArea(g, 'island', bench.x + 1, bench.y + 1.8, 'up');
  g.rt.npcs = [];
  g.rt.mobs = [];
  expect(findTarget(g).obj?.id).toBe('grandad_bench');
  expect(findTarget(g).hint).toBe('upgrade');
  g.s.tracked = null;
  expect(findTarget(g).hint).toBe('table');
  g.s.tracked = 'ch3';
  step(g, { ...NO_INPUT, act: true });
  expect(g.ev.some((e) => e.t === 'open' && e.ui === 'upgrade')).toBe(true);
});
