// Package 75 (D78): things inside mini-games are drawn between the rules' last two steps, so none stands still on a
// frame when a 120 a second screen shows two frames to each 1/60 s step.
import { describe, expect, it } from 'vitest';
import { Glider } from '../src/game/ui/minidraw.ts';

/** A screen at `hz` frames a second over the rules' 60 steps: the steps that ran and how far into the next one. */
function screen(hz: number, frames: number): { ticks: number; alpha: number }[] {
  const step = 1000 / 60;
  const dt = 1000 / hz;
  let acc = 0;
  const out: { ticks: number; alpha: number }[] = [];
  for (let i = 0; i < frames; i++) {
    acc += dt;
    let ticks = 0;
    while (acc >= step - 1e-9) {
      acc -= step;
      ticks++;
    }
    out.push({ ticks, alpha: Math.max(0, acc) / step });
  }
  return out;
}

/** Run a thing moving `speed` a step for `frames` frames; returns what was drawn each frame. */
function run(hz: number, frames: number, speed: number, jump = 1): number[] {
  const g = new Glider();
  let v = 0;
  const drawn: number[] = [];
  for (const f of screen(hz, frames)) {
    v += f.ticks * speed;
    g.begin(f.ticks, f.alpha);
    drawn.push(g.num('x', v, jump));
  }
  return drawn;
}

describe('Glider (package 75)', () => {
  for (const hz of [60, 120, 144, 240]) {
    it(`a thing that moves each step is drawn in a new place on every frame at ${hz} a second`, () => {
      const d = run(hz, 240, 0.05);
      // (the first step or two only start it off)
      for (let i = Math.ceil(hz / 30) + 2; i < d.length; i++) expect(d[i]!).toBeGreaterThan(d[i - 1]!);
    });
  }

  it('is drawn between its last two steps, a step behind the rules', () => {
    // 120 a second: frame k is at step k/2; it shows the place of step (k/2 - 1) plus the share passed
    const d = run(120, 60, 1);
    for (let i = 4; i < d.length; i++) expect(Math.abs(d[i]! - (i / 2 - 1))).toBeLessThan(0.51);
    // never ahead of the rules and never more than a step and a bit behind
    const g = new Glider();
    let v = 0;
    for (const f of screen(120, 100)) {
      v += f.ticks;
      g.begin(f.ticks, f.alpha);
      const out = g.num('x', v, 1);
      expect(out).toBeLessThanOrEqual(v + 1e-9);
      expect(v - out).toBeLessThan(1.01);
    }
  });

  it('a thing that stands still is drawn where it stands', () => {
    const d = run(120, 60, 0);
    expect(new Set(d).size).toBe(1);
  });

  it('a jump on purpose (a reset) is not glided; a new thing starts where it is', () => {
    const g = new Glider();
    const seen: number[] = [];
    let v = 0;
    for (const f of screen(120, 60)) {
      v += f.ticks * 0.05;
      if (f.ticks && Math.abs(v - 0.5) < 0.026) v = 9; // a teleport of 8.5 steps of 0.05
      g.begin(f.ticks, f.alpha);
      seen.push(g.num('x', v, 1));
    }
    const at = seen.findIndex((x) => x > 5);
    expect(at).toBeGreaterThan(0);
    // the first frame after the jump already shows the new place (no sweep across)
    expect(seen[at]!).toBeGreaterThan(8.9);
    // a thing seen for the first time, or not asked for last frame, starts where it is
    const h = new Glider();
    h.begin(1, 0.5);
    expect(h.num('a', 7, 1)).toBe(7);
    h.begin(1, 0.5);
    h.begin(1, 0.5);
    expect(h.num('a', 3, 1)).toBe(3);
  });

  it('two steps in one frame (a 30 a second screen) still moves forward', () => {
    const d = run(30, 120, 0.05);
    for (let i = 3; i < d.length; i++) expect(d[i]!).toBeGreaterThan(d[i - 1]!);
  });

  it('a paused game (no steps, the whole step passed) draws the rules own place', () => {
    const g = new Glider();
    g.begin(1, 0.2);
    g.num('x', 0, 1);
    g.begin(1, 0.2);
    g.num('x', 1, 1);
    g.begin(0, 1);
    expect(g.num('x', 1, 1)).toBe(1);
  });

  it('things are followed by the thing itself, so a removed one does not shift the rest', () => {
    const g = new Glider();
    const a = { x: 0 };
    const b = { x: 10 };
    const frames = screen(120, 40);
    let seenB: number[] = [];
    frames.forEach((f, i) => {
      a.x += f.ticks * 0.1;
      b.x += f.ticks * 0.1;
      g.begin(f.ticks, f.alpha);
      if (i < 20) g.field(a, 'x', a.x, 1);
      seenB.push(g.field(b, 'x', b.x, 1));
    });
    for (let i = 3; i < seenB.length; i++) expect(seenB[i]!).toBeGreaterThan(seenB[i - 1]!);
    seenB = [];
    const p = g.probe();
    expect(Object.keys(p.v).length).toBe(1);
  });
});
