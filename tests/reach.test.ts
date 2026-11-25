// Package 51 (G: "hard to pick up dog"): small finds on the ground are walked over, so Space reaches them from on
// top or beside them facing any way; a wandering animal has a wider reach and stands still once patted; the quest's
// one wins when several things are in reach. Plain Node, no browser.
import { describe, expect, it } from 'vitest';
import { ANIMAL_REACH, addAnimal, refreshBeasts } from '../src/core/animals.ts';
import { rebuildArea } from '../src/core/grid.ts';
import { findTarget, PICK_REACH } from '../src/core/hero.ts';
import { newGame } from '../src/core/state.ts';
import { NO_INPUT, step } from '../src/core/step.ts';
import type { Dir, Game } from '../src/core/types.ts';
import { content } from '../src/data/content.ts';

const DIRS: Dir[] = ['down', 'up', 'left', 'right'];
const playing = (): Game => {
  const g = newGame(content, { seed: 3, hero: 'amelia' });
  g.rt.mode = 'play';
  g.rt.talk = null;
  g.rt.q = [];
  g.s.area = 'island';
  g.rt.npcs.length = 0;
  g.rt.mobs.length = 0;
  rebuildArea(g, 'island');
  return g;
};
const dog = content.areas.island.objects.find((o) => o.id === 'long_dog_5')!;

describe('reach', () => {
  it('a long dog is picked up from on it or beside it, facing any way', () => {
    const g = playing();
    const cx = dog.x + 0.5;
    const cy = dog.y + 0.5;
    for (const r of [0, 0.5, 1, PICK_REACH - 0.05])
      for (let a = 0; a < 8; a++)
        for (const d of DIRS) {
          g.s.x = cx + Math.cos((a * Math.PI) / 4) * r;
          g.s.y = cy + Math.sin((a * Math.PI) / 4) * r;
          g.s.dir = d;
          const t = findTarget(g);
          expect(t.kind === 'obj' && t.obj?.id === dog.id, `r ${r} dir ${a} facing ${d}`).toBe(true);
          expect(t.hint).toBe('pickup');
        }
    // further than that it is not lit, so the prompt never shows for nothing
    g.s.x = cx + PICK_REACH + 0.3;
    g.s.y = cy;
    g.s.dir = 'left';
    expect(findTarget(g).obj?.id).not.toBe(dog.id);
    // and Space does what the prompt says
    g.s.x = cx;
    g.s.y = cy;
    g.s.dir = 'up';
    g.rt.px = g.s.x;
    g.rt.py = g.s.y;
    step(g, { ...NO_INPUT, act: true });
    expect(g.s.taken[dog.id]).toBe(1);
  });

  it('a wandering animal is reached from 1.75 tiles and stands still once patted', () => {
    const g = playing();
    g.s.x = dog.x + 3.5;
    g.s.y = dog.y - 2.5;
    g.rt.px = g.s.x;
    g.rt.py = g.s.y;
    g.s.dir = 'right';
    const st = addAnimal(g, 'chicken', 'heeler_dog')!;
    st.x = st.hx = g.s.x + ANIMAL_REACH - 0.1;
    st.y = st.hy = g.s.y;
    refreshBeasts(g);
    const t = findTarget(g);
    expect(t.kind).toBe('animal');
    expect(t.k).toBe(st.k);
    step(g, { ...NO_INPUT, act: true });
    const x = st.x;
    const y = st.y;
    for (let i = 0; i < 80; i++) step(g, NO_INPUT);
    expect(Math.hypot(st.x - x, st.y - y)).toBeLessThan(0.05);
  });

  it('when a friend and a find are both in reach, the one the quest points at wins, else the nearer', () => {
    const g = playing();
    g.s.x = dog.x + 1.1;
    g.s.y = dog.y + 0.5;
    g.s.dir = 'right';
    const npc = { k: 999, id: 'bingo', x: g.s.x + 1.4, y: g.s.y };
    (g.rt.npcs as unknown as (typeof npc)[]).push(npc);
    // the dog is nearer: Space picks it up
    expect(findTarget(g).kind).toBe('obj');
    // the tracked step points at the friend: she wins
    g.rt.target = { area: 'island', x: Math.floor(npc.x), y: Math.floor(npc.y) } as Game['rt']['target'];
    expect(findTarget(g).kind).toBe('npc');
  });
});
