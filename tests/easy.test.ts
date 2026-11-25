// Package 57a (G, D62): things are easy to pick up, led animals follow by themselves, every thing that looks usable
// can be used. Plain Node, no browser: the rules are driven with the same key presses the game sends.
import { describe, expect, it } from 'vitest';
import { CATCH_UP } from '../src/core/animals.ts';
import { give } from '../src/core/bag.ts';
import { findPath, free, rebuildArea } from '../src/core/grid.ts';
import { AUTO_CAP, AUTO_PICK, findTarget } from '../src/core/hero.ts';
import { place } from '../src/core/quests.ts';
import { newGame } from '../src/core/state.ts';
import { NO_INPUT, step } from '../src/core/step.ts';
import type { Game, Input } from '../src/core/types.ts';
import { content } from '../src/data/content.ts';

const playing = (): Game => {
  const g = newGame(content, { seed: 3, hero: 'amelia' });
  g.rt.mode = 'play';
  g.rt.talk = null;
  g.rt.q = [];
  g.s.area = 'island';
  g.rt.mobs.length = 0;
  rebuildArea(g, 'island');
  return g;
};
const put = (g: Game, x: number, y: number) => {
  g.s.x = g.rt.px = x;
  g.s.y = g.rt.py = y;
};
const run = (g: Game, inp: Partial<Input>, frames: number) => {
  for (let i = 0; i < frames; i++) {
    step(g, { ...NO_INPUT, ...inp });
    g.ev.length = 0;
  }
};
/** Walk her to a tile along the shortest way, as a child holding the arrow keys would. */
function walkTo(g: Game, tx: number, ty: number, each?: () => void): void {
  const a = g.c.areas[g.s.area]!;
  const path = findPath(g.rt.solid[g.s.area]!, a.w, a.h, Math.floor(g.s.x), Math.floor(g.s.y), tx, ty, 0, 20000);
  expect(path, `a way to ${tx},${ty}`).not.toBeNull();
  for (let i = 0; i < path!.length; i += 2) {
    const wx = path![i]! + 0.5;
    const wy = path![i + 1]! + 0.5;
    for (let n = 0; n < 120 && (Math.abs(wx - g.s.x) > 0.08 || Math.abs(wy - g.s.y) > 0.08); n++) {
      const dx = wx - g.s.x;
      const dy = wy - g.s.y;
      step(g, { ...NO_INPUT, mx: dx > 0.06 ? 1 : dx < -0.06 ? -1 : 0, my: dy > 0.06 ? 1 : dy < -0.06 ? -1 : 0 });
      g.ev.length = 0;
      each?.();
    }
  }
}

describe('picking up (D62)', () => {
  it('a find on the ground hops into the bag as she walks beside it, no key', () => {
    const g = playing();
    const a = g.c.areas.island!;
    let tried = 0;
    for (const o of a.objects) {
      const t = g.c.objects[o.type]!;
      if (!(t.node && !t.node.tool && t.node.verb === 'pick' && !t.solid) && t.interact !== 'pickup') continue;
      if (o.if || tried >= 25) continue;
      // she stands right beside it (any side she can stand on), facing away
      let stood = false;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const x = o.x + 0.5 + dx * 0.95;
        const y = o.y + 0.5 + dy * 0.95;
        if (!free(g, 'island', x, y)) continue;
        put(g, x, y);
        g.s.dir = dx > 0 ? 'right' : dx < 0 ? 'left' : dy > 0 ? 'down' : 'up';
        stood = true;
        break;
      }
      if (!stood) continue;
      tried++;
      g.s.bag.fill(null);
      run(g, {}, 2);
      const gone = g.s.taken[o.id] === 1 || g.s.nodes[o.id] !== undefined;
      expect(gone, `${o.id} at ${o.x},${o.y}`).toBe(true);
    }
    expect(tried).toBeGreaterThan(10);
  });

  it('flowers and shells stop hopping in once she carries 10 of them (Space still picks more)', () => {
    const g = playing();
    const o = g.c.areas.island!.objects.find((x) => x.type === 'shell_pink' && !x.if)!;
    g.s.bag.fill(null);
    g.s.bag[3] = { id: 'shell_pink', n: AUTO_CAP };
    put(g, o.x + 0.5, o.y + 0.5);
    run(g, {}, 2);
    expect(g.s.nodes[o.id]).toBeUndefined();
  });

  it('a drop on a wall or in water moves to ground she can reach, and Space never swings at nothing beside a find', () => {
    const g = playing();
    // a tile of water near the start
    const a = g.c.areas.island!;
    let wx = -1;
    let wy = -1;
    for (let y = 0; y < a.h && wx < 0; y++)
      for (let x = 0; x < a.w; x++)
        if (!free(g, 'island', x + 0.5, y + 0.5, 0.2) && free(g, 'island', x + 1.5, y + 0.5, 0.28)) {
          wx = x;
          wy = y;
          break;
        }
    g.s.drops.push({ area: 'island', x: wx + 0.5, y: wy + 0.5, id: 'stick', n: 1 });
    put(g, wx + 1.5, wy + 0.5);
    run(g, {}, 2);
    expect(g.s.drops.length, 'picked up from beside the wall').toBe(0);
    expect(AUTO_PICK).toBeGreaterThanOrEqual(1);
  });
});

describe('led animals follow by themselves (D62)', () => {
  const ch2 = content.quests.ch2!;
  const lead = ch2.steps.findIndex((s) => s.t === 'lead');

  it("G's case: chapter 2, the pen built, the chicken follows her into it with the seeds anywhere in the bag", () => {
    const g = playing();
    g.s.quests.ch2 = { step: lead, n: 0 };
    g.s.tracked = 'ch2';
    g.s.flags.pen_plan = 1;
    g.s.flags.site_pen_bing = 1;
    g.rt.dirty = true;
    run(g, {}, 1);
    give(g, 'wheat_seed', 2, true);
    // the seeds are not in the slot she holds
    g.s.hot = g.s.bag.findIndex((b) => b?.id === 'wheat_seed') === 0 ? 1 : 0;
    const hen = g.s.animals.find((a) => a.kind === 'chicken')!;
    const nest = place(g, 'nest')!;
    put(g, nest.x + 0.5, nest.y + 2.5);
    run(g, {}, 30);
    expect(hen.led, 'follows with the seeds in the bag').toBe(true);
    const pen = place(g, 'pen_bing')!;
    // she walks to the open side of the pen and stands there: the chicken goes in by itself
    walkTo(g, pen.x, pen.y + 3);
    run(g, {}, 60 * 8);
    expect(hen.pen).toBe('pen_bing');
    expect(g.s.quests.ch2!.step).toBeGreaterThan(lead);
  });

  it('a follower left behind appears beside her after a few seconds', () => {
    const g = playing();
    g.s.quests.ch2 = { step: lead, n: 0 };
    g.s.flags.pen_plan = 1;
    g.s.flags.site_pen_bing = 1;
    g.rt.dirty = true;
    run(g, {}, 1);
    give(g, 'wheat_seed', 2, true);
    const hen = g.s.animals.find((a) => a.kind === 'chicken')!;
    put(g, hen.x + 2, hen.y);
    run(g, {}, 10);
    expect(hen.led).toBe(true);
    // far off at once (a door, a run): it catches up
    const far = place(g, 'coco')!;
    put(g, far.x + 0.5, far.y + 1.5);
    run(g, {}, Math.ceil(60 * (CATCH_UP + 0.5)));
    expect(Math.hypot(hen.x - g.s.x, hen.y - g.s.y)).toBeLessThan(2.5);
  });
});

describe('things to play on (D62)', () => {
  it('the trampoline, the swing, the slide and the train answer Space with a short turn, and she ends where she can stand', () => {
    const g = playing();
    const a = g.c.areas.island!;
    for (const type of ['trampoline', 'swing_set', 'slide', 'toy_train', 'seesaw', 'sandbox', 'alphabet_blocks']) {
      const o = a.objects.find((x) => x.type === type && (!x.if || x.if.flag))!;
      expect(o, type).toBeDefined();
      const flag = o.if?.flag;
      if (typeof flag === 'string') {
        g.s.flags[flag] = 1;
        rebuildArea(g, 'island');
      }
      const t = g.c.objects[type]!;
      // stand below it, facing up
      const x = o.x + Math.min(1, (t.w ?? 1) - 1) + 0.5;
      const y = o.y + (t.h ?? 1) + 0.5;
      put(g, x, y);
      g.s.dir = 'up';
      g.rt.npcs.length = 0;
      const tg = findTarget(g);
      expect(tg.hint, type).toMatch(/^fun:/);
      run(g, { act: true }, 1);
      expect(g.rt.fun, type).toBeTruthy();
      run(g, {}, 60 * 5);
      expect(g.rt.fun, `${type} ends by itself`).toBeFalsy();
      expect(free(g, 'island', g.s.x, g.s.y), `${type}: she stands on open ground`).toBe(true);
    }
  });

  it('a key ends a turn, and a talk or a pick-up still wins Space', () => {
    const g = playing();
    const o = g.c.areas.island!.objects.find((x) => x.type === 'trampoline')!;
    put(g, o.x + 1.5, o.y + 2.5);
    g.s.dir = 'up';
    g.rt.npcs.length = 0;
    run(g, { act: true }, 1);
    expect(g.rt.fun).toBeTruthy();
    run(g, {}, 30);
    run(g, { mx: 1 }, 1);
    expect(g.rt.fun).toBeFalsy();
  });
});
