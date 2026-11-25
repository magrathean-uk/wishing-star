// Package 60 (G, D62: "make it easier"): what the blind player tripped on. Plain Node, no browser: the rules are
// driven with the same key presses the game sends.
import { describe, expect, it } from 'vitest';
import { give } from '../src/core/bag.ts';
import { goalLine } from '../src/core/goal.ts';
import { guideOf, stepGuide } from '../src/core/guide.ts';
import { free, rebuildArea } from '../src/core/grid.ts';
import { findTarget, HALF, hurtHero, moveBody, WALK_SPEED } from '../src/core/hero.ts';
import { place, stepTarget } from '../src/core/quests.ts';
import { newGame } from '../src/core/state.ts';
import { NO_INPUT, step } from '../src/core/step.ts';
import { choose, say, stepTalk } from '../src/core/talk.ts';
import type { Game, Input } from '../src/core/types.ts';
import { content } from '../src/data/content.ts';

const playing = (): Game => {
  const g = newGame(content, { seed: 3, hero: 'amelia' });
  g.rt.mode = 'play';
  g.rt.talk = null;
  g.rt.cut = null;
  g.rt.card = null;
  g.rt.q = [];
  g.rt.spawnT = 1e9;
  g.s.area = 'island';
  g.rt.mobs.length = 0;
  rebuildArea(g, 'island');
  return g;
};
const put = (g: Game, x: number, y: number, area = 'island') => {
  g.s.area = area;
  g.s.x = g.rt.px = x;
  g.s.y = g.rt.py = y;
};
const run = (g: Game, inp: Partial<Input>, frames: number) => {
  for (let i = 0; i < frames; i++) {
    step(g, { ...NO_INPUT, ...inp });
    g.ev.length = 0;
  }
};
/** Hold one key for a number of frames with only the walking rule (doors included). */
const hold = (g: Game, mx: number, my: number, frames: number) => {
  for (let f = 0; f < frames; f++) moveBody(g, (mx * WALK_SPEED) / 60, (my * WALK_SPEED) / 60);
};
/** Make a quest step the one she is on. */
const onStep = (g: Game, qid: string, stepNo: number) => {
  for (const id of g.c.questOrder) g.s.quests[id] = { step: 0, n: 0, done: true };
  g.s.quests[qid] = { step: stepNo, n: 0, done: false };
  g.s.tracked = qid;
  g.rt.target = stepTarget(g, qid);
};

describe('the goal line says where first (package 60)', () => {
  it('a step whose place is off the screen says the going, and the doing once she is there', () => {
    const g = playing();
    // chapter 1, "Build a log bridge": its own far line is "Cross the creek"
    const i = g.c.quests.ch1!.steps.findIndex((s) => s.t === 'site');
    onStep(g, 'ch1', i);
    const tgt = g.rt.target!;
    expect(tgt).not.toBeNull();
    // at the Heelers' yard, well off the screen from the site and with a way there
    g.s.pouch.wood_sword = 1;
    g.s.gear.sword = 'wood_sword';
    // with the logs it needs (while some are still to get, the line says the getting)
    for (const b of g.c.areas[tgt.area]!.sites)
      if (b.at.x === tgt.x && b.at.y === tgt.y) for (const k in b.needs) give(g, k, 99, true);
    const yard = place(g, 'heeler_veranda')!;
    put(g, yard.x + 0.5, yard.y + 0.5);
    stepGuide(g);
    expect(guideOf(g).none).toBe(false);
    expect(goalLine(g)!.text).toBe('Cross the creek');
    put(g, tgt.x + 1.5, tgt.y + 0.5);
    stepGuide(g);
    expect(goalLine(g)!.text).toBe('Build a log bridge');
  });
  it('the counter names what it counts and goes when it is full', () => {
    const g = playing();
    const i = g.c.quests.ch1!.steps.findIndex((s) => s.t === 'site');
    onStep(g, 'ch1', i);
    const tgt = g.rt.target!;
    put(g, tgt.x + 1.5, tgt.y + 0.5);
    stepGuide(g);
    const num = goalLine(g)!.num;
    expect(num).toMatch(/^[A-Z][a-z]+ \d+ of \d+$/);
    for (const k in g.c.areas[tgt.area]!.sites.find((b) => b.at.x === tgt.x && b.at.y === tgt.y)?.needs ?? {})
      give(g, k, 99, true);
    expect(goalLine(g)!.num).toBe('');
  });
  it('a step with no far line of its own reads "Go to" and the place, at most 5 words', () => {
    const g = playing();
    for (const qid of g.c.questOrder)
      g.c.quests[qid]!.steps.forEach((st, n) => {
        if (st.far) expect(st.far.split(/\s+/).length, `${qid} ${n}`).toBeLessThanOrEqual(5);
      });
  });
});

describe('a held key gets her through (package 60)', () => {
  it('through every one-tile gap on the island, from both sides, half a tile or a whole tile off', () => {
    const g = playing();
    const a = g.c.areas.island!;
    const sol = g.rt.solid.island!;
    const S = (x: number, y: number) => x < 0 || y < 0 || x >= a.w || y >= a.h || sol[y * a.w + x] === 1;
    const door = (x: number, y: number) => a.doors.some((d) => Math.abs(d.x - x) <= 2 && Math.abs(d.y - y) <= 2);
    let tried = 0;
    const stuck: string[] = [];
    for (let y = 2; y < a.h - 2; y++)
      for (let x = 2; x < a.w - 2; x++) {
        if (S(x, y) || door(x, y)) continue;
        for (const [ax, ay] of [
          [1, 0],
          [0, 1],
        ] as const) {
          const lx = ay;
          const ly = ax;
          if (!(S(x - lx, y - ly) && S(x + lx, y + ly))) continue;
          if ([1, 2, 3].some((k) => S(x - k * ax, y - k * ay) || S(x + k * ax, y + k * ay))) continue;
          for (const sgn of [1, -1])
            for (const off of [-1, -0.45, 0, 0.45, 1]) {
              const sx = x + 0.5 - sgn * ax * 2.5 + lx * off;
              const sy = y + 0.5 - sgn * ay * 2.5 + ly * off;
              if (!free(g, 'island', sx, sy, HALF)) continue;
              put(g, sx, sy);
              tried++;
              hold(g, sgn * ax, sgn * ay, 75);
              const along = (g.s.x - (x + 0.5)) * ax + (g.s.y - (y + 0.5)) * ay;
              if (along * sgn < 1) stuck.push(`${x},${y} ${ax ? 'east-west' : 'north-south'} ${sgn} ${off}`);
            }
        }
      }
    expect(tried).toBeGreaterThan(200);
    expect(stuck, stuck.slice(0, 10).join('; ')).toEqual([]);
  });
  it("into Bing's Garden by the lane mouth (blind run 2, 0065 to 0081)", () => {
    const g = playing();
    // the mouth of the long grass is at 49,49 and 49,50; she came up the shore to the east of it
    put(g, 51.5, 52.5);
    hold(g, 0, -1, 40);
    hold(g, -1, 0, 60);
    expect(g.s.x).toBeLessThan(48.5);
    expect(g.s.y).toBeGreaterThan(48.9);
    expect(g.s.y).toBeLessThan(51);
  });
});

describe('the arrow shows the way (package 60)', () => {
  it("following only the arrow from the cottage reaches the long grass in Bing's Garden", () => {
    const g = playing();
    const grass = place(g, 'grass_in')!;
    // the bushes on the bridge (chapter 2's first step) are cut
    for (const o of g.c.areas.island!.objects) if (o.type === 'thorn_bush' && o.x === 53) g.s.taken[o.id] = 1;
    rebuildArea(g, 'island');
    put(g, 74.5, 77.5);
    g.rt.target = grass;
    const gd = guideOf(g);
    let arrived = false;
    for (let n = 0; n < 200 && !arrived; n++) {
      gd.aimT = 0;
      stepGuide(g);
      expect(gd.none).toBe(false);
      const arrow = gd.far || !gd.direct;
      const dx = (arrow ? gd.wx : grass.x + 0.5) - g.s.x;
      const dy = (arrow ? gd.wy : grass.y + 0.5) - g.s.y;
      if (Math.abs(dx) >= Math.abs(dy)) hold(g, Math.sign(dx), 0, 30);
      else hold(g, 0, Math.sign(dy), 30);
      arrived = Math.hypot(grass.x + 0.5 - g.s.x, grass.y + 0.5 - g.s.y) < 1.8;
    }
    expect(arrived).toBe(true);
  });
});

describe('gentler first hits (package 60)', () => {
  it('after a hit she cannot be hit again for 1.5 seconds, and is pushed a step away', () => {
    const g = playing();
    put(g, 80.5, 64.5);
    const hp = g.s.hp;
    hurtHero(g, 2, 79.5, 64.5);
    const hit = hp - g.s.hp;
    expect(hit).toBeGreaterThan(0);
    expect(g.s.x - 80.5).toBeGreaterThan(0.7);
    run(g, {}, 85);
    hurtHero(g, 2, g.s.x - 1, g.s.y);
    expect(g.s.hp).toBe(hp - hit);
    run(g, {}, 20);
    hurtHero(g, 2, g.s.x - 1, g.s.y);
    expect(g.s.hp).toBe(hp - 2 * hit);
  });
});

describe('a hit never pushes her into a walled-in pocket', () => {
  it('stops at the first blocked step instead of jumping past a corner', () => {
    const g = playing();
    // by the forest sign, tile 115,39 is walled in by dark oaks on all four sides (their stumps stay solid too)
    for (const [x, y] of [
      [115, 38],
      [114, 39],
      [116, 39],
      [115, 40],
    ] as const)
      expect(free(g, 'island', x + 0.5, y + 0.5, HALF)).toBe(false);
    expect(free(g, 'island', 115.5, 39.5, HALF)).toBe(true);
    // a skeleton's arrow from down and to the left, as the solver met it
    put(g, 114.62, 40.55);
    hurtHero(g, 1, 114.62 - 0.72, 40.55 + 0.69);
    expect([Math.floor(g.s.x), Math.floor(g.s.y)]).not.toEqual([115, 39]);
    expect(free(g, 'island', g.s.x, g.s.y, HALF)).toBe(true);
  });

  it('still goes the whole 1.2 tiles on open ground', () => {
    const g = playing();
    put(g, 80.5, 64.5);
    hurtHero(g, 1, 79.5, 64.5);
    expect(g.s.x).toBeCloseTo(81.7, 5);
    expect(g.s.y).toBeCloseTo(64.5, 5);
  });
});

describe('the right tool by itself (package 60)', () => {
  it('Space at a tree chops with the axe from her pouch, whatever is in her hand', () => {
    const g = playing();
    const a = g.c.areas.island!;
    g.s.pouch.wood_axe = 1;
    give(g, 'log', 1, true);
    g.s.hot = g.s.bag.findIndex((b) => b?.id === 'log');
    // a tree with open ground to its south
    const tree = a.objects.find(
      (o) =>
        o.type === 'oak' && !o.if && free(g, 'island', o.x + 0.5, o.y + 1.5, HALF) && g.s.nodes[o.id] === undefined,
    )!;
    put(g, tree.x + 0.5, tree.y + 1.5);
    g.s.dir = 'up';
    expect(findTarget(g).hint).toBe('chop');
    const logs = g.s.bag.reduce((n, b) => n + (b?.id === 'log' ? b.n : 0), 0);
    for (let i = 0; i < 6; i++) {
      run(g, { act: true }, 1);
      run(g, {}, 30);
    }
    const after = g.s.bag.reduce((n, b) => n + (b?.id === 'log' ? b.n : 0), 0);
    expect(after).toBeGreaterThan(logs);
  });
  it('a thorn bush goes at the first cut', () => {
    const g = playing();
    const a = g.c.areas.island!;
    const bush = a.objects.find(
      (o) => o.type === 'thorn_bush' && !o.if && free(g, 'island', o.x - 0.5, o.y + 0.5, HALF),
    )!;
    g.s.pouch.wood_sword = 1;
    g.s.gear.sword = 'wood_sword';
    put(g, bush.x - 0.5, bush.y + 0.5);
    g.s.dir = 'right';
    run(g, { act: true }, 1);
    run(g, {}, 30);
    expect(g.s.taken[bush.id]).toBe(1);
  });
});

describe('questions (package 60)', () => {
  it('a held key stays on the last answer instead of coming back round', () => {
    const g = playing();
    say(g, [{ l: 'bandit: Shall we play?', choices: [{ text: 'Yes, play!' }, { text: 'Not now' }] }]);
    g.rt.mode = 'talk';
    const t = g.rt.talk!;
    t.shown = t.text.length;
    stepTalk(g, false, 1, false);
    stepTalk(g, false, 1, false);
    expect(t.pick).toBe(1);
    void choose;
  });
});
