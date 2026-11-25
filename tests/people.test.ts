// Package 67: people are solid indoors and out; one who stands in her way steps aside after half a second, and no
// one ever closes a door or a one-tile lane. Plain Node: the walking rule and the people's step, frame by frame.
import { describe, expect, it } from 'vitest';
import { rebuildArea } from '../src/core/grid.ts';
import { moveBody, WALK_SPEED } from '../src/core/hero.ts';
import { stepNpcs, talkNpc } from '../src/core/npcs.ts';
import { REACH_BODY } from '../src/core/people.ts';
import { newGame } from '../src/core/state.ts';
import type { Game, Npc } from '../src/core/types.ts';
import { content } from '../src/data/content.ts';

const cottage = (): Game => {
  const g = newGame(content, { seed: 3, hero: 'amelia' });
  g.rt.mode = 'play';
  g.rt.talk = null;
  g.rt.cut = null;
  g.s.area = 'cottage';
  g.rt.mobs.length = 0;
  rebuildArea(g, 'cottage');
  return g;
};
const person = (g: Game, x: number, y: number): Npc => {
  const n: Npc = {
    k: g.rt.nextK++,
    id: 'dad',
    kind: 'npc',
    area: g.s.area,
    x,
    y,
    px: x,
    py: y,
    dir: 'down',
    clip: 'idle',
    ct: 0,
    hx: x,
    hy: y,
    roam: 0,
    path: null,
    pi: 0,
    wait: 99,
    mark: 0,
    talkT: 9,
  };
  g.rt.npcs = [n];
  return n;
};
const put = (g: Game, x: number, y: number) => {
  g.s.x = g.rt.px = x;
  g.s.y = g.rt.py = y;
};
/** Hold a key for some frames: her walking rule, then the people's step, as the game runs them. */
const hold = (g: Game, mx: number, my: number, frames: number) => {
  for (let f = 0; f < frames; f++) {
    moveBody(g, (mx * WALK_SPEED) / 60, (my * WALK_SPEED) / 60);
    stepNpcs(g);
  }
};

describe('people are solid (package 67)', () => {
  it('Dad in the cottage stops her, then steps aside after half a second and she walks on', () => {
    const g = cottage();
    const n = person(g, 6.5, 5.5);
    put(g, 3.5, 5.5);
    // about 0.4 s of walking brings her to him; then a moment of pressing
    hold(g, 1, 0, 30);
    expect(Math.hypot(g.s.x - n.x, g.s.y - n.y)).toBeGreaterThanOrEqual(REACH_BODY - 1e-6);
    expect(g.s.x).toBeLessThan(n.x);
    expect(n.path).toBeNull();
    // pressing on: by half a second he is on his way out of her way, and soon she is past where he stood
    hold(g, 1, 0, 40);
    expect(n.y).not.toBeCloseTo(5.5, 1);
    hold(g, 1, 0, 60);
    expect(g.s.x).toBeGreaterThan(7.2);
    expect(n.pass).toBeFalsy();
  });

  it('is the same every time (no dice, no clock)', () => {
    const a = cottage();
    const b = cottage();
    const na = person(a, 6.5, 5.5);
    const nb = person(b, 6.5, 5.5);
    put(a, 3.5, 5.5);
    put(b, 3.5, 5.5);
    hold(a, 1, 0, 120);
    hold(b, 1, 0, 120);
    expect([a.s.x, a.s.y, na.x, na.y]).toEqual([b.s.x, b.s.y, nb.x, nb.y]);
  });

  it('never blocks the door: someone standing by it lets her through', () => {
    const g = cottage();
    // the cottage door is at 6,9; he stands just inside it
    const n = person(g, 6.5, 8.5);
    put(g, 6.5, 5.5);
    hold(g, 0, 1, 90);
    expect(n.pass).toBe(true);
    // she reached the door and went out
    expect(g.s.area).toBe('island');
  });

  it('never blocks a one-tile lane: she passes through', () => {
    const g = cottage();
    // a wall down the room at x = 6 with one gap, and he stands in the gap
    const sol = g.rt.solid.cottage!;
    for (let y = 1; y < 9; y++) if (y !== 5) sol[y * 16 + 6] = 1;
    const n = person(g, 6.5, 5.5);
    put(g, 3.5, 5.5);
    hold(g, 1, 0, 40);
    expect(n.pass).toBe(true);
    hold(g, 1, 0, 50);
    // she went through him; he stayed in the gap
    expect(g.s.x).toBeGreaterThan(7.2);
    expect([n.x, n.y]).toEqual([6.5, 5.5]);
  });

  it('lets her pass a character drawn only standing, who never slides aside (issue 39)', () => {
    const g = cottage();
    const n = person(g, 6.5, 5.5);
    n.id = 'mercat';
    expect(content.chars.mercat?.role).toBe('fixed');
    put(g, 3.5, 5.5);
    // she reaches her and presses for half a second: no step aside, she may walk through
    hold(g, 1, 0, 70);
    expect(n.pass).toBe(true);
    expect(n.path).toBeNull();
    hold(g, 1, 0, 60);
    // she went through; the MerCat stayed where she stands
    expect(g.s.x).toBeGreaterThan(7.2);
    expect([n.x, n.y]).toEqual([6.5, 5.5]);
  });

  it('slides her round when she brushes past off centre', () => {
    const g = cottage();
    const n = person(g, 6.5, 5.5);
    put(g, 3.5, 5.1);
    hold(g, 1, 0, 70);
    expect(g.s.x).toBeGreaterThan(n.x);
    expect(n.path).toBeNull();
  });
});

it('keeps Bullseye’s response to Jessie as a narrated gesture', () => {
  const g = cottage();
  g.s.hero = 'jessie';
  const horse = person(g, g.s.x + 1, g.s.y);
  horse.id = 'bullseye';
  talkNpc(g, horse.k);
  expect(g.rt.talk?.who).toBe('');
  expect(g.rt.talk?.text).toBe('Bullseye dances in a happy circle.');
});
