// G, 22 Nov 2026, on the iPad: "cut the bushes on the bridge: only recognises done, once i cross the bridge"; "play hide
// and seek: hard to open ... it must display a round on the ground to show where to press space"; "place the stand in
// cottage, again, not easy to find". Plain Node, no browser.
import { describe, expect, it } from 'vitest';
import { give } from '../src/core/bag.ts';
import { wear } from '../src/core/gear.ts';
import { rebuildArea } from '../src/core/grid.ts';
import { enterArea, findTarget } from '../src/core/hero.ts';
import { refreshNpcs } from '../src/core/npcs.ts';
import { objective, pollQuests, stepTarget } from '../src/core/quests.ts';
import { HOST_RING, joinAt, joinSpots, placeSpot } from '../src/core/spots.ts';
import { newGame } from '../src/core/state.ts';
import { NO_INPUT, step } from '../src/core/step.ts';
import type { Dir, Game } from '../src/core/types.ts';
import { content } from '../src/data/content.ts';

const DIRS: Dir[] = ['down', 'up', 'left', 'right'];

function playing(): Game {
  const g = newGame(content, { seed: 7, hero: 'amelia' });
  g.rt.mode = 'play';
  g.rt.cut = null;
  g.rt.talk = null;
  g.rt.q = [];
  g.rt.mobs.length = 0;
  return g;
}

describe('a step to cut things in the way', () => {
  it('the bridge bushes step is done when the last bush is cut, on this side of the bridge', () => {
    const g = playing();
    g.s.quests = { prologue: { step: 99, n: 0, done: true, day: 1 }, ch2: { step: 0, n: 0, done: false, day: 1 } };
    g.s.tracked = 'ch2';
    enterArea(g, 'island', 56.5, 60.5, 'left');
    g.s.taken.bridge_bush_60 = 1;
    pollQuests(g);
    expect(g.s.quests.ch2!.step).toBe(0);
    g.s.taken.bridge_bush_61 = 1;
    pollQuests(g);
    expect(g.s.quests.ch2!.step).toBe(1);
  });

  it('the bushes go to a real sword cut and the step moves on there and then', () => {
    const g = playing();
    g.s.quests = { prologue: { step: 99, n: 0, done: true, day: 1 }, ch2: { step: 0, n: 0, done: false, day: 1 } };
    g.s.tracked = 'ch2';
    give(g, 'wood_sword', 1, true);
    wear(g, 'wood_sword');
    enterArea(g, 'island', 54.5, 60.5, 'left');
    g.rt.npcs.length = 0;
    for (const y of [60.5, 61.5]) {
      g.s.x = 54.5;
      g.s.y = y;
      g.s.dir = 'left';
      step(g, { ...NO_INPUT, act: true });
      for (let i = 0; i < 40; i++) step(g, NO_INPUT);
    }
    expect(g.s.taken.bridge_bush_60).toBe(1);
    expect(g.s.taken.bridge_bush_61).toBe(1);
    expect(g.s.quests.ch2!.step).toBeGreaterThan(0);
  });

  it('every step that says to cut or chop through something lists the things in the way', () => {
    for (const q of Object.values(content.quests))
      for (const st of q.steps)
        if (st.t === 'reach' && /^(Cut|Chop) (the|through)\b/.test(st.goal ?? ''))
          expect(st.clear?.length, `${q.id}: ${st.goal}`).toBeGreaterThan(0);
  });
});

describe('the gold ring round a mini-game start', () => {
  it('anywhere in a game post ring, facing any way, Space starts its game', () => {
    const g = playing();
    g.s.quests = { prologue: { step: 99, n: 0, done: true, day: 1 } };
    enterArea(g, 'island', 61.5, 10.5, 'down');
    g.rt.npcs.length = 0;
    rebuildArea(g, 'island');
    const post = joinSpots(g).find((sp) => sp.game === 'puddles' && sp.obj >= 0)!;
    expect(post).toBeTruthy();
    for (const r of [1, post.r - 0.05])
      for (let a = 0; a < 8; a++)
        for (const d of DIRS) {
          const x = post.x + Math.cos((a * Math.PI) / 4) * r;
          const y = post.y + Math.sin((a * Math.PI) / 4) * r;
          if (Math.floor(x) === 61 && Math.floor(y) === 8) continue;
          g.s.x = x;
          g.s.y = y;
          g.s.dir = d;
          expect(joinAt(g)?.game, `r ${r} at ${a} facing ${d}`).toBe('puddles');
          const t = findTarget(g);
          expect(t.kind === 'obj' && t.obj?.id === 'puddle_post', `r ${r} at ${a} facing ${d}`).toBe(true);
        }
    g.s.x = post.x + 0.5;
    g.s.y = post.y + 1.2;
    g.s.dir = 'down';
    step(g, { ...NO_INPUT, act: true });
    expect(g.rt.mini?.game).toBe('puddles');
  });

  it('a host who walks about has a ring under their feet; Space in it plays, facing away', () => {
    const g = playing();
    g.s.quests = { prologue: { step: 99, n: 0, done: true, day: 1 } };
    enterArea(g, 'island', 30.5, 75.5, 'down');
    refreshNpcs(g);
    const pando = g.rt.npcs.find((n) => n.id === 'pando');
    expect(pando, 'Pando is about in the park').toBeTruthy();
    g.rt.npcs = [pando!];
    const sp = joinSpots(g).find((j) => j.k === pando!.k)!;
    expect(sp.game).toBe('hide');
    expect(sp.r).toBe(HOST_RING);
    g.s.x = pando!.x + 1.2;
    g.s.y = pando!.y;
    g.s.dir = 'right';
    const t = findTarget(g);
    expect(t.kind).toBe('npc');
    expect(t.k).toBe(pando!.k);
    expect(t.hint).toBe('play');
    g.s.x = pando!.x + HOST_RING + 0.6;
    expect(joinAt(g)).toBeNull();
  });
});

describe('the gold ring where a place step thing goes', () => {
  function home1(): Game {
    const g = playing();
    g.s.quests = { home1: { step: 2, n: 0, done: false, day: 1 } };
    g.s.tracked = 'home1';
    expect(content.quests.home1!.steps[2]).toMatchObject({ t: 'place', item: 'armour_stand' });
    give(g, 'armour_stand', 1, true);
    enterArea(g, 'cottage', 4.5, 5.5, 'down');
    g.rt.npcs = [];
    return g;
  }

  it('in the cottage the stand has a spot, the line says what to press, and the star points there', () => {
    const g = home1();
    const sp = placeSpot(g)!;
    expect(sp).toBeTruthy();
    expect(objective(g, 'home1')).toBe('Put the armour stand in the gold ring. Press Space.');
    expect(stepTarget(g, 'home1')).toEqual({ area: 'cottage', x: sp.x, y: sp.y });
  });

  it('Space beside the ring, facing away, puts the stand there and the step is done', () => {
    const g = home1();
    const sp = placeSpot(g)!;
    g.s.x = sp.x + 0.5;
    g.s.y = sp.y + sp.h + 0.6;
    g.s.dir = 'down';
    const t = findTarget(g);
    expect(t.kind).toBe('questPlace');
    step(g, { ...NO_INPUT, act: true });
    expect(g.s.placed.some((p) => p.item === 'armour_stand' && p.x === sp.x && p.y === sp.y)).toBe(true);
    for (let i = 0; i < 12; i++) step(g, NO_INPUT);
    expect(g.s.quests.home1!.step).toBe(3);
  });

  it('out on the island, away from home, there is no ring and the line is the step goal', () => {
    const g = home1();
    enterArea(g, 'island', 40.5, 60.5, 'down');
    expect(placeSpot(g)).toBeNull();
    expect(objective(g, 'home1')).toBe('Place the stand in your cottage');
  });

  it('every place step in the game gets a spot at home', () => {
    for (const q of Object.values(content.quests))
      q.steps.forEach((st, i) => {
        if (st.t !== 'place') return;
        const g = playing();
        g.s.quests = { [q.id]: { step: i, n: 0, done: false, day: 1 } };
        g.s.tracked = q.id;
        give(g, st.item, st.n ?? 1, true);
        const where = content.items[st.item]?.place?.where;
        if (where === 'plot') {
          const gate = content.areas.island!.places.plot_gate!;
          enterArea(g, 'island', gate.x + 0.5, gate.y + 2.5, 'down');
        } else enterArea(g, 'cottage', 4.5, 5.5, 'down');
        g.rt.npcs = [];
        expect(placeSpot(g), `${q.id} step ${i}: ${st.item}`).not.toBeNull();
      });
  });
});
