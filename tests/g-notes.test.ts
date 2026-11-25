// Package 71 (D78): G's notes on build 14. Smooth play turns, a project's card at its place, the sandpit, the cat's
// word and a bag thing sent to a bottom button. Plain Node, no browser.
import { describe, expect, it } from 'vitest';
import { animalAct } from '../src/core/animals.ts';
import { count, test } from '../src/core/cond.ts';
import { castleOn, FUN, funPose, funThing, placedFun, SAND_FINDS, startFun } from '../src/core/fun.ts';
import { enterArea, findTarget } from '../src/core/hero.ts';
import { makeMob } from '../src/core/mobs.ts';
import { projectGateLine, projectInfo, projectNear, projectOf } from '../src/core/quests.ts';
import { newGame } from '../src/core/state.ts';
import { NO_INPUT, step } from '../src/core/step.ts';
import type { Ev, Game, Input } from '../src/core/types.ts';
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
  enterArea(g, 'island', 30.5, 68.5, 'down');
  g.rt.mobs.length = 0;
  g.rt.npcs.length = 0;
  g.rt.beasts.length = 0;
  return g;
};
/** Run frames; returns every event they sent. */
const run = (g: Game, inp: Partial<Input>, frames: number): Ev[] => {
  const out: Ev[] = [];
  for (let i = 0; i < frames; i++) {
    step(g, { ...NO_INPUT, ...inp });
    out.push(...g.ev);
    g.ev.length = 0;
  }
  return out;
};
/** Start a turn on the island's first thing of this type, as Space on it would. */
const play = (g: Game, type: string) => {
  const objs = g.c.areas.island!.objects;
  const i = objs.findIndex((o) => o.type === type);
  const o = objs[i]!;
  const t = g.c.objects[type]!;
  startFun(g, t.fun!, o.x, o.y, t.w ?? 1, t.h ?? 1, i);
  return g.rt.fun!;
};

describe('smooth play turns (D78 note 2)', () => {
  for (const type of ['swing_set', 'seesaw', 'trampoline']) {
    it(`a ${type} pose between two ticks lies between the two tick poses`, () => {
      const g = playing();
      const r = play(g, type);
      run(g, {}, 50);
      for (let k = 0; k < 20; k++) {
        const t0 = r.t;
        const a = { ...funPose(r, 0) };
        const ta = funThing(r).ang;
        run(g, {}, 1);
        const b = { ...funPose(r, 0) };
        const tb = funThing(r).ang;
        // the pose at the tick's own time is the tick pose
        expect(funPose(r, 0, r.t).lift).toBeCloseTo(b.lift, 9);
        const m = funPose(r, 0, t0 + 1 / 120);
        // (at the turn of a swing the curve may bulge a hair past both ends: a small slack)
        for (const [x, y, z, slack] of [
          [a.sway, b.sway, m.sway, 2e-3],
          [a.lift, b.lift, m.lift, 2e-3],
          [a.ang, b.ang, m.ang, 0.05],
        ] as const) {
          expect(z).toBeGreaterThanOrEqual(Math.min(x, y) - slack);
          expect(z).toBeLessThanOrEqual(Math.max(x, y) + slack);
          if (Math.abs(x - y) > 1e-6) expect(Math.abs(z - x)).toBeGreaterThan(1e-9);
        }
        const tm = funThing(r, t0 + 1 / 120).ang;
        expect(tm).toBeGreaterThanOrEqual(Math.min(ta, tb) - 0.05);
        expect(tm).toBeLessThanOrEqual(Math.max(ta, tb) + 0.05);
      }
    });
  }
  it('on the swing, the tick before is where she is (nothing pushes her off the seat between ticks)', () => {
    const g = playing();
    play(g, 'swing_set');
    for (let i = 0; i < 120; i++) {
      run(g, {}, 1);
      expect(g.rt.px).toBe(g.s.x);
      expect(g.rt.py).toBe(g.s.y);
    }
  });
  it('a friend on the swing beside her holds still between ticks too', () => {
    const g = newGame(content, { seed: 3, hero: 'amelia' });
    g.rt.mode = 'play';
    g.rt.talk = null;
    g.rt.cut = null;
    g.rt.q = [];
    for (const id in g.s.quests) g.s.quests[id]!.done = true;
    const objs = g.c.areas.island!.objects;
    const i = objs.findIndex((o) => o.type === 'swing_set');
    const o = objs[i]!;
    enterArea(g, 'island', o.x + 1, o.y + 2.5, 'up');
    g.rt.mobs.length = 0;
    g.rt.spawnT = 1e9;
    // a friend who walks about, two tiles off
    const n = g.rt.npcs.find((m) => g.c.chars[m.id]?.role === 'hero' && g.c.chars[m.id]?.body === 'biped');
    if (!n) throw new Error('no friend near');
    n.x = o.x + 3.5;
    n.y = o.y + 2.5;
    n.roam = 1;
    n.hidden = false;
    const r = play(g, 'swing_set');
    if (!r.friend) throw new Error('no friend joined');
    for (let k = 0; k < 400 && r.ft < 0.2 && g.rt.fun; k++) run(g, {}, 1);
    const f = g.rt.npcs.find((m) => m.k === r.friend)!;
    for (let k = 0; k < 60 && g.rt.fun; k++) {
      run(g, {}, 1);
      expect(f.px).toBe(f.x);
    }
  });
  it('a pose is never asked for past the end of the turn', () => {
    const g = playing();
    const r = play(g, 'swing_set');
    expect(funPose(r, 0, r.secs + 5).sway).toBeCloseTo(funPose(r, 0, r.secs).sway, 9);
  });
  it('the slide moves her in the rules, so the tick before is held for the view', () => {
    const g = playing();
    play(g, 'slide');
    run(g, {}, 40);
    const before = g.s.x;
    run(g, {}, 1);
    expect(g.rt.px).toBe(before);
    expect(g.s.x).not.toBe(before);
  });
});

describe("a project's card at its place (D78 note 4)", () => {
  it('all ten projects are found by one rule', () => {
    const g = playing();
    const sites = g.c.areas.island!.sites.filter((s) => projectOf(g, s));
    expect(sites.length).toBe(10);
    for (const site of sites) {
      g.s.x = site.at.x + 0.5;
      g.s.y = site.at.y + 0.5;
      expect(projectNear(g, -1, -1)?.id).toBe(site.id);
      expect(projectInfo(g, site.id)?.qid).toBe('p_' + site.id);
    }
  });
  it('with an enemy about, Space at a project is her sword, not the card', () => {
    const g = playing();
    const site = g.c.areas.island!.sites.find((s) => s.id === 'jetty')!;
    g.s.x = site.at.x + 0.5;
    g.s.y = site.at.y + 0.5;
    g.s.dir = 'right';
    g.s.pouch.wood_sword = 1;
    g.s.gear.sword = 'wood_sword';
    expect(findTarget(g).kind).toBe('project');
    // a zombie four tiles off: not beside her, but about
    makeMob(g, 'zombie', g.s.x + 4, g.s.y);
    expect(findTarget(g).kind).toBe('swing');
  });
  it('Space at the jetty opens its card; it says what comes first when the job cannot be taken', () => {
    const g = playing();
    const site = g.c.areas.island!.sites.find((s) => s.id === 'jetty')!;
    g.s.shards = 0;
    g.s.x = site.at.x + 0.5;
    g.s.y = site.at.y + 0.5;
    g.s.dir = 'left';
    expect(findTarget(g).kind).toBe('project');
    const ev = run(g, { act: true }, 1);
    expect(ev.some((e) => e.t === 'open' && e.ui === 'project' && e.arg === 'jetty')).toBe(true);
    const info = projectInfo(g, 'jetty')!;
    expect(info.can).toBe(false);
    expect(info.why).toBe('Find 2 more star shards first.');
    expect(g.s.quests.p_jetty).toBeUndefined();
  });
  it('when the job can be taken, the card takes it there and the build site shows', () => {
    const g = playing();
    const site = g.c.areas.island!.sites.find((s) => s.id === 'jetty')!;
    g.s.shards = 2;
    const info = projectInfo(g, 'jetty')!;
    expect(info.can).toBe(true);
    expect(test(g, site.if)).toBe(false);
    // the card sends the board's own start
    const ev = run(g, { cmd: { c: 'accept', quest: info.qid } }, 1);
    expect(ev.some((e) => e.t === 'toast' && e.kind === 'quest')).toBe(true);
    expect(g.s.quests.p_jetty?.done).toBeFalsy();
    expect(test(g, site.if)).toBe(true);
    expect(projectInfo(g, 'jetty')).toBeNull();
    g.s.x = site.at.x + 0.5;
    g.s.y = site.at.y + 0.5;
    expect(findTarget(g).kind).toBe('site');
  });
  it('the gap names the thing', () => {
    const g = playing();
    expect(projectGateLine(g, 'site_jetty')).toBe('The jetty is broken.');
    expect(projectGateLine(g, 'site_cove')).toBe('The beach steps are broken.');
  });
});

describe('the sandpit (D78 note 3)', () => {
  it('she digs, the castle grows in three stages and one find comes a day', () => {
    const g = playing();
    const shells = () => SAND_FINDS.reduce((n, id) => n + count(g, id), 0);
    const before = shells();
    const r = play(g, 'sandbox');
    expect(r.move).toBe('dig');
    const key = r.castle!;
    const stages: number[] = [];
    for (let i = 0; i < FUN.dig.secs * 60 + 5; i++) {
      run(g, {}, 1);
      const st = castleOn(g, key)?.stage ?? 0;
      if (st !== stages[stages.length - 1]) stages.push(st);
    }
    expect(stages).toEqual([0, 1, 2, 3]);
    expect(g.rt.fun).toBeNull();
    expect(shells()).toBe(before + 1);
    // again the same day: the castle stays, nothing more is found
    play(g, 'sandbox');
    run(g, {}, FUN.dig.secs * 60 + 5);
    expect(castleOn(g, key)?.stage).toBe(3);
    expect(shells()).toBe(before + 1);
    // the next morning the castle has gone and the first dig finds a thing again
    g.s.day++;
    expect(castleOn(g, key)).toBeNull();
    play(g, 'sandbox');
    run(g, {}, FUN.dig.secs * 60 + 5);
    expect(shells()).toBe(before + 2);
  });
  it('the sandpit she places at home is dug in too', () => {
    expect(placedFun('sandpit', undefined)?.move).toBe('dig');
  });
});

describe("the cat's word (D78 note 6)", () => {
  it('stroking a cat pops "Meow!" over it', () => {
    const g = playing();
    const k = g.s.nextK++;
    g.s.animals.push({ k, kind: 'cat', area: 'island', x: g.s.x + 1, y: g.s.y, hx: g.s.x + 1, hy: g.s.y });
    animalAct(g, k);
    const w = g.ev.find((e) => e.t === 'fx' && e.id === 'word');
    expect(w && w.t === 'fx' && g.c.strings[w.item ?? '']).toBe('Meow!');
  });
  it('package 74 (I1): the cow has its word too', () => {
    const g = playing();
    const k = g.s.nextK++;
    g.s.animals.push({ k, kind: 'cow', area: 'island', x: g.s.x + 1, y: g.s.y, hx: g.s.x + 1, hy: g.s.y });
    animalAct(g, k);
    const w = g.ev.find((e) => e.t === 'fx' && e.id === 'word');
    expect(w && w.t === 'fx' && g.c.strings[w.item ?? '']).toBe('Moo!');
  });
});

describe('the bottom buttons (D78 note 7)', () => {
  it('a bag thing sent to button 3 swaps with what was there', () => {
    const g = playing();
    g.s.bag[2] = { id: 'apple', n: 2 };
    g.s.bag[20] = { id: 'plank', n: 5 };
    run(g, { cmd: { c: 'move', from: 20, to: 2 } }, 1);
    expect(g.s.bag[2]).toEqual({ id: 'plank', n: 5 });
    expect(g.s.bag[20]).toEqual({ id: 'apple', n: 2 });
  });
});
