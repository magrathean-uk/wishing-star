import { describe, expect, it } from 'vitest';
import { give } from '../src/core/bag.ts';
import { count } from '../src/core/cond.ts';
import { wear } from '../src/core/gear.ts';
import { enterArea, findTarget } from '../src/core/hero.ts';
import { makeMob, shoot } from '../src/core/mobs.ts';
import { newGame } from '../src/core/state.ts';
import { NO_INPUT, step } from '../src/core/step.ts';
import { content } from '../src/data/content.ts';

function atHighWeb(arrows = 4, bow = true) {
  const g = newGame(content, { seed: 7 });
  g.s.quests.prologue!.done = true;
  g.s.quests.ch4 = {
    step: content.quests.ch4!.steps.findIndex((s) => s.t === 'reach' && s.place === 'herd_joey_3'),
    n: 0,
  };
  g.s.tracked = 'ch4';
  g.s.taken.trail_gum = 1;
  if (bow) {
    give(g, 'bow', 1, true);
    wear(g, 'bow');
  }
  if (arrows) give(g, 'arrow', arrows, true);
  enterArea(g, 'island', 38.35, 34.5, 'left');
  return g;
}

function runShot(g: ReturnType<typeof atHighWeb>, fire = false) {
  const web = findTarget(g).obj!;
  step(g, { ...NO_INPUT, act: true, fire });
  for (let i = 0; i < 60; i++) step(g, NO_INPUT);
  return web;
}

describe('high web action', () => {
  it('shows Shoot and clears the web with Space', () => {
    const g = atHighWeb();
    expect(findTarget(g).hint).toBe('shoot');
    const web = runShot(g);
    expect(g.s.taken[web.id]).toBeTruthy();
    expect(count(g, 'arrow')).toBe(3);
  });

  it('aims at the faced web when a closer mob is nearby', () => {
    const g = atHighWeb();
    const webIndex = findTarget(g).objIndex;
    g.rt.mobs.push(makeMob(g, 'zombie', g.s.x - 0.1, g.s.y + 0.8));
    expect(shoot(g, webIndex)).toBe(true);
    expect(g.rt.shots[0]?.web).toBe(webIndex);
    expect(g.rt.shots[0]?.tgt).toBe(0);
  });

  it('spends only one arrow when Space and X arrive together', () => {
    const g = atHighWeb();
    const web = runShot(g, true);
    expect(g.s.taken[web.id]).toBeTruthy();
    expect(count(g, 'arrow')).toBe(3);
  });

  it('keeps the web when the bow or arrows are missing', () => {
    for (const g of [atHighWeb(4, false), atHighWeb(0)]) {
      const web = runShot(g);
      expect(g.s.taken[web.id]).toBeFalsy();
      expect(g.rt.nudge).toBeTruthy();
    }
  });
});
