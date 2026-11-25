import { expect, it } from 'vitest';
import { give, plotRect } from '../src/core/bag.ts';
import { canPlace } from '../src/core/build.ts';
import { wear } from '../src/core/gear.ts';
import { solidAt } from '../src/core/grid.ts';
import { enterArea, findTarget, placedAt } from '../src/core/hero.ts';
import { newGame } from '../src/core/state.ts';
import { NO_INPUT, step } from '../src/core/step.ts';
import { content } from '../src/data/content.ts';

it('places the requested stand with the action button', () => {
  const g = newGame(content, { seed: 7, hero: 'amelia' });
  g.rt.mode = 'play';
  g.rt.cut = null;
  g.rt.talk = null;
  g.rt.q = [];
  g.s.quests = { home1: { step: 2, n: 0, done: false, day: 1 } };
  g.s.tracked = 'home1';
  give(g, 'armour_stand', 1, true);
  enterArea(g, 'cottage', 3.5, 3.5, 'right');
  g.rt.npcs = [];
  let found = false;
  for (let y = 1; y < content.areas.cottage!.h - 1 && !found; y++) {
    for (let x = 1; x < content.areas.cottage!.w - 2; x++) {
      g.s.x = x + 0.5;
      g.s.y = y + 0.5;
      // (where she can stand: not inside the chest or the bench)
      if (solidAt(g, 'cottage', x, y)) continue;
      if (!canPlace(g, 'armour_stand', x + 1, y) && ['none', 'swing', 'questPlace'].includes(findTarget(g).kind)) {
        found = true;
        break;
      }
    }
  }
  expect(found).toBe(true);
  step(g, { ...NO_INPUT, act: true });
  expect(g.s.placed.some((p) => p.item === 'armour_stand')).toBe(true);
});

it('keeps the sword action when an enemy is beside the player', async () => {
  const { makeMob } = await import('../src/core/mobs.ts');
  const g = newGame(content, { seed: 7, hero: 'amelia' });
  g.rt.mode = 'play';
  g.rt.cut = null;
  g.rt.talk = null;
  g.rt.q = [];
  g.s.quests = { home1: { step: 2, n: 0, done: false, day: 1 } };
  g.s.tracked = 'home1';
  give(g, 'armour_stand', 1, true);
  enterArea(g, 'cottage', 4.5, 4.5, 'right');
  g.rt.npcs = [];
  give(g, 'wood_sword', 1, true);
  wear(g, 'wood_sword');
  g.s.time = 700;
  makeMob(g, 'zombie', 5.5, 4.5);
  expect(findTarget(g).kind).toBe('swing');
  step(g, { ...NO_INPUT, act: true });
  expect(g.s.placed.some((p) => p.item === 'armour_stand')).toBe(false);
});

it('plants the requested wheat with Space while the seeds are in the bag', () => {
  const g = newGame(content, { seed: 7, hero: 'amelia' });
  g.rt.mode = 'play';
  g.rt.cut = null;
  g.rt.talk = null;
  g.rt.q = [];
  g.s.quests = { home2: { step: 1, n: 0, done: false, day: 1 } };
  g.s.tracked = 'home2';
  give(g, 'wheat_seed', 6, true);
  give(g, 'wood_spade', 1, true);
  const plot = plotRect(g);
  enterArea(g, 'island', plot.x + 2.5, plot.y + 2.5, 'right');
  g.rt.npcs = [];
  g.rt.mobs = [];
  let found = false;
  for (let y = plot.y + 1; y < plot.y + plot.h - 1 && !found; y++) {
    for (let x = plot.x + 1; x < plot.x + plot.w - 2; x++) {
      g.s.x = x + 0.5;
      g.s.y = y + 0.5;
      if (
        !solidAt(g, 'island', x + 1, y) &&
        !placedAt(g, 'island', x + 1, y) &&
        ['none', 'swing', 'questPlant'].includes(findTarget(g).kind)
      ) {
        found = true;
        break;
      }
    }
  }
  expect(found).toBe(true);
  step(g, { ...NO_INPUT, act: true });
  expect(g.s.crops.some((crop) => crop.seed === 'wheat_seed')).toBe(true);
});
