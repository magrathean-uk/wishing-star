// Package 86: a mob that comes back to her (mobs.ts comeBack) is put where it is out of view and she can walk to,
// never beside her and never through a wall. Plain Node, no browser.
import { describe, expect, it } from 'vitest';
import { findPath, free } from '../src/core/grid.ts';
import { enterArea, HALF } from '../src/core/hero.ts';
import {
  AWAY_MAX,
  comeBackSpot,
  makeMob,
  offView,
  spriteOffView,
  VIEW_H,
  VIEW_W,
  viewCentre,
} from '../src/core/mobs.ts';
import { newGame } from '../src/core/state.ts';
import { NO_INPUT, step } from '../src/core/step.ts';
import type { Game } from '../src/core/types.ts';
import { content } from '../src/data/content.ts';

const playing = (): Game => {
  const g = newGame(content, { seed: 3, hero: 'amelia' });
  g.rt.mode = 'play';
  g.rt.talk = null;
  g.rt.cut = null;
  g.rt.card = null;
  g.rt.q = [];
  g.rt.spawnT = 1e9;
  for (const id in g.s.quests) g.s.quests[id]!.done = true;
  g.s.tracked = null;
  enterArea(g, 'island', 40.5, 60.5, 'down');
  g.rt.mobs.length = 0;
  g.rt.npcs.length = 0;
  g.rt.beasts.length = 0;
  return g;
};
const run = (g: Game, frames: number) => {
  for (let i = 0; i < frames; i++) {
    step(g, NO_INPUT);
    g.ev.length = 0;
  }
};
/** Wall in the tile the mob stands on: all eight tiles round it are solid. */
const seal = (g: Game, x: number, y: number) => {
  const a = g.c.areas.island!;
  const solid = g.rt.solid.island!;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) solid[(y + dy) * a.w + x + dx] = 1;
};
const reach = (g: Game, x: number, y: number) => {
  const a = g.c.areas.island!;
  return findPath(
    g.rt.solid.island!,
    a.w,
    a.h,
    Math.floor(g.s.x),
    Math.floor(g.s.y),
    Math.floor(x),
    Math.floor(y),
    0,
    3000,
  );
};

describe('where a mob comes back', () => {
  it('on open ground the spot is out of view, free, and she can walk to it', () => {
    const g = playing();
    const m = makeMob(g, 'zombie', 36.5, 60.5);
    const spot = comeBackSpot(g, m, true);
    expect(spot).not.toBeNull();
    expect(offView(g, spot!.x, spot!.y)).toBe(true);
    expect(free(g, 'island', spot!.x, spot!.y, HALF)).toBe(true);
    expect(reach(g, spot!.x, spot!.y)).not.toBeNull();
    expect(Math.hypot(spot!.x - g.s.x, spot!.y - g.s.y)).toBeGreaterThan(8);
  });

  it('a hostile mob shut in a pocket has no spot; a story mob is taken out of its pocket', () => {
    const g = playing();
    const m = makeMob(g, 'zombie', 36.5, 60.5);
    seal(g, 36, 60);
    expect(comeBackSpot(g, m, true)).toBeNull();
    const spot = comeBackSpot(g, m, false);
    expect(spot).not.toBeNull();
    expect(offView(g, spot!.x, spot!.y)).toBe(true);
    expect(reach(g, spot!.x, spot!.y)).not.toBeNull();
  });

  it('a story mob stuck in a pocket comes out of view, never beside her, and walks in from there', () => {
    const g = playing();
    const m = makeMob(g, 'zombie', 36.5, 60.5);
    m.tag = 'story';
    seal(g, 36, 60);
    m.away = AWAY_MAX + 3;
    // the frame it is taken out of its pocket: it is out of view, with a way to her
    let out = false;
    for (let i = 0; i < 30 && !out; i++) {
      run(g, 1);
      out = Math.hypot(m.x - 36.5, m.y - 60.5) > 2;
    }
    expect(out).toBe(true);
    expect(m.gone).toBeFalsy();
    expect(offView(g, m.x, m.y)).toBe(true);
    expect(reach(g, m.x, m.y)).not.toBeNull();
  });

  it('no part of the returning sprite is in the camera, from any side (a tall sprite shows its head first)', () => {
    const g = playing();
    const tall = g.c.mobs.zombie?.tall ?? 2;
    const c = viewCentre(g);
    const inCam = (x: number, y: number) =>
      x + 1 > c.x - VIEW_W / 2 && x - 1 < c.x + VIEW_W / 2 && y > c.y - VIEW_H / 2 && y - tall < c.y + VIEW_H / 2;
    let found = 0;
    for (let k = 0; k < 24; k++) {
      const ang = (k * Math.PI) / 12;
      const m = makeMob(g, 'zombie', g.s.x + Math.cos(ang) * 4, g.s.y + Math.sin(ang) * 4);
      const spot = comeBackSpot(g, m, false);
      if (!spot) continue;
      found++;
      expect(inCam(spot.x, spot.y)).toBe(false);
    }
    expect(found).toBeGreaterThan(0);
    // the spot the review found: just past the point margin below the view, where the head was still in sight
    expect(spriteOffView(g, 38.5, 68.5)).toBe(false);
    expect(spriteOffView(g, 38.5, 71)).toBe(true);
  });

  it('in a room too small to leave the view nothing comes back, and a story mob stays where it is, alive', () => {
    const g = playing();
    enterArea(g, 'cave', g.c.areas.cave!.w / 2, g.c.areas.cave!.h / 2, 'down');
    const m = makeMob(g, 'zombie', g.s.x - 1, g.s.y);
    expect(comeBackSpot(g, m, true)).toBeNull();
    expect(comeBackSpot(g, m, false)).toBeNull();
    m.tag = 'story';
    m.away = AWAY_MAX + 3;
    const [x, y] = [m.x, m.y];
    for (let i = 0; i < 90; i++) {
      run(g, 1);
      expect(m.gone).toBeFalsy();
      // it is never put on a new spot: whatever it does, it walks from where it stood
      expect(Math.hypot(m.x - x, m.y - y)).toBeLessThan(3);
    }
  });
});
