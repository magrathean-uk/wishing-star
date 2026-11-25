// Package 44a: the wild stretches. The `upgrade` step, webs too high for a sword (an arrow brings them down), the
// web trail's night, and the four stretches on the map. Plain Node, no browser.
import { describe, expect, it } from 'vitest';
import { NIGHT_AT } from '../src/core/cond.ts';
import { upgradedIn, wear } from '../src/core/gear.ts';
import { rebuildArea } from '../src/core/grid.ts';
import { enterArea } from '../src/core/hero.ts';
import { spawnAt } from '../src/core/mobs.ts';
import { pollQuests } from '../src/core/quests.ts';
import { newGame } from '../src/core/state.ts';
import { NO_INPUT, step } from '../src/core/step.ts';
import type { Game } from '../src/core/types.ts';
import { content } from '../src/data/content.ts';

const playing = (g: Game): Game => {
  g.rt.mode = 'play';
  g.rt.talk = null;
  g.rt.cut = null;
  g.rt.q = [];
  g.rt.spawnT = 1e9;
  for (const id in g.s.quests) g.s.quests[id]!.done = true;
  return g;
};
const fresh = (seed = 5): Game => playing(newGame(content, { seed, hero: 'amelia' }));
const island = content.areas.island!;
const obj = (type: string) => island.objects.filter((o) => o.type === type);

describe('the upgrade step', () => {
  it('waits until she owns a +1 piece for the slot', () => {
    const g = fresh();
    const steps = content.quests.ch3!.steps;
    const at = steps.findIndex((st) => st.t === 'upgrade');
    expect(at).toBeGreaterThan(0);
    g.s.quests.ch3 = { step: at, n: 0 };
    g.s.pouch.stone_sword = 1;
    wear(g, 'stone_sword');
    pollQuests(g);
    expect(g.s.quests.ch3!.step).toBe(at);
    expect(upgradedIn(g, 'sword')).toBe(false);
    g.s.plus.stone_sword = 1;
    pollQuests(g);
    expect(upgradedIn(g, 'sword')).toBe(true);
    expect(g.s.quests.ch3!.step === at + 1 || !!g.s.quests.ch3!.done).toBe(true);
  });
});

describe('webs too high for a sword', () => {
  // the one in the middle of the trail, with open ground to its left
  const high = obj('web_high').find((o) => o.x === 37 && o.y === 34)!;
  const stand = (g: Game) => {
    // she stands one tile to the left of the web, facing it
    enterArea(g, 'island', high.x - 1.5, high.y + 0.5, 'right');
    g.s.dir = 'right';
    rebuildArea(g, 'island');
  };
  it('cannot be cut with Space', () => {
    const g = fresh();
    g.s.pouch.iron_sword = 1;
    wear(g, 'iron_sword');
    stand(g);
    enterArea(g, 'island', high.x - 0.5, high.y + 0.5, 'right');
    for (let i = 0; i < 90; i++) step(g, { ...NO_INPUT, act: i % 10 === 0 });
    expect(g.s.taken[high.id]).toBeFalsy();
  });
  it('comes down to one arrow', () => {
    const g = fresh();
    g.s.pouch.bow = 1;
    wear(g, 'bow');
    g.s.bag[1] = { id: 'arrow', n: 3 };
    stand(g);
    // the tile to the left must be open ground for this test to mean anything
    expect(g.rt.solid.island![high.y * island.w + high.x - 1]).toBe(0);
    step(g, { ...NO_INPUT, fire: true });
    for (let i = 0; i < 60; i++) step(g, NO_INPUT);
    expect(g.s.taken[high.id]).toBe(1);
    expect(g.s.bag[1]?.n ?? 0).toBe(2);
  });
});

describe('the web trail', () => {
  it('is dark under the big trees: its mouth brings the night, so the spiders are awake', () => {
    const st = content.quests.ch4!.steps.find((x) => x.t === 'reach' && x.place === 'web_trail')!;
    expect(st.fx?.time).toBe('night');
    const g = fresh();
    const p = island.places.trail_spiders!;
    enterArea(g, 'island', p.x + 0.5, p.y + 0.5, 'up');
    g.s.time = NIGHT_AT + 10;
    spawnAt(g, 'spider', 1, 'trail_spiders');
    for (let i = 0; i < 10; i++) step(g, NO_INPUT);
    const spider = g.rt.mobs.find((m) => m.id === 'spider' && m.tag === 'story');
    expect(spider).toBeTruthy();
    expect(spider!.calm).toBeFalsy();
  });
});

describe('the four stretches on the map', () => {
  it('has its places, its webs and its bridge', () => {
    for (const p of [
      'quarry_cave',
      'cave_a',
      'cave_top',
      'web_trail',
      'trail_webs',
      'ford',
      'far_fields',
      'ledges_top',
      // package 47a: the fuller stretches and the two short ones of chapters 1 and 2
      'cave_fall',
      'trail_gum',
      'ledge_web',
      'ledge_crack',
      'bush_in',
      'bush_end',
      'grass_in',
      'grass_out',
    ])
      expect(island.places[p], p).toBeTruthy();
    expect(obj('web_wall').length).toBeGreaterThanOrEqual(4);
    expect(obj('web_high').length).toBeGreaterThanOrEqual(2);
    expect(island.barriers.some((b) => b.id === 'ford_bridge')).toBe(true);
    expect(island.sites.some((b) => b.id === 'ford_bridge')).toBe(true);
    for (const id of ['cave_bridge', 'bush_bridge']) {
      expect(
        island.barriers.some((b) => b.id === id),
        id,
      ).toBe(true);
      expect(
        island.sites.some((b) => b.id === id),
        id,
      ).toBe(true);
    }
    expect(obj('rock_fall').length).toBeGreaterThanOrEqual(4);
    expect(obj('fallen_gum').some((o) => o.id === 'trail_gum')).toBe(true);
    expect(obj('boulder_wall').some((o) => o.id === 'drop_crack')).toBe(true);
    // iron and coal in the cave walls, a diamond on each of the three ledges
    const inRect = (o: { x: number; y: number }, x0: number, y0: number, x1: number, y1: number) =>
      o.x >= x0 && o.x <= x1 && o.y >= y0 && o.y <= y1;
    expect(obj('iron_rock').filter((o) => inRect(o, 92, 15, 100, 34)).length).toBeGreaterThanOrEqual(3);
    expect(obj('coal_rock').filter((o) => inRect(o, 92, 15, 100, 34)).length).toBeGreaterThanOrEqual(2);
    expect(obj('diamond_rock').filter((o) => inRect(o, 147, 90, 154, 114)).length).toBe(3);
  });
  it('gives each stretch a landmark and keeps the journal at 60', () => {
    for (const id of ['quarry', 'web_trail', 'ford', 'ledges']) expect(content.landmarks[id], id).toBeTruthy();
    expect(Object.keys(content.landmarks).length).toBe(17);
  });
});
