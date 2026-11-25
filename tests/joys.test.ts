// Package 74 (D79): the small joys. Every animal's word (I1), the swing push (I8), feeding the pond (I9), her pet
// indoors and its tricks (I10), the tidy bag and pins (I11), where a friend is (I12). Plain Node, no browser.
import { describe, expect, it } from 'vitest';
import { adoptPet, animalAct, petRest, TRICK_SECS } from '../src/core/animals.ts';
import { count } from '../src/core/cond.ts';
import { endFun, FUN, funPose, LEAP_SECS, PUSH_WINDOW, pushGap, startFun, swingHeight } from '../src/core/fun.ts';
import { free, rebuildArea } from '../src/core/grid.ts';
import { enterArea, findTarget } from '../src/core/hero.ts';
import { FEED_MAX, fedToday, placeName, residents, whereLine } from '../src/core/joys.ts';
import { newGame } from '../src/core/state.ts';
import { NO_INPUT, step } from '../src/core/step.ts';
import { moveAllowed, pinned, tidyBag, tidyGroup } from '../src/core/tidy.ts';
import type { Ev, FunRun, Game, Input } from '../src/core/types.ts';
import { content } from '../src/data/content.ts';
import { animals } from '../src/data/world.ts';

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
const run = (g: Game, inp: Partial<Input>, frames: number): Ev[] => {
  const out: Ev[] = [];
  for (let i = 0; i < frames; i++) {
    step(g, { ...NO_INPUT, ...inp });
    out.push(...g.ev);
    g.ev.length = 0;
  }
  return out;
};
const words = (evs: Ev[]) =>
  evs.filter((e) => e.t === 'fx' && e.id === 'word').map((e) => (e as { item?: string }).item);

describe('I1: every animal says its word', () => {
  it('every animal kind has a word of one word and "!"', () => {
    for (const kind in animals) {
      const w = content.strings[`say:${kind}`];
      expect(w, kind).toMatch(/^[A-Z][a-z]+!$/);
    }
  });
  it('stroking a sheep sends its word over it', () => {
    const g = playing();
    const k = g.s.nextK++;
    g.s.animals.push({ k, kind: 'sheep', area: 'island', x: g.s.x + 1, y: g.s.y, hx: g.s.x + 1, hy: g.s.y });
    animalAct(g, k);
    expect(words(g.ev)).toEqual(['say:sheep']);
  });
});

describe('I8: swing higher', () => {
  const onSwing = (g: Game): FunRun => {
    const objs = g.c.areas.island!.objects;
    const i = objs.findIndex((o) => o.type === 'swing_set');
    const o = objs[i]!;
    const t = g.c.objects.swing_set!;
    startFun(g, t.fun!, o.x, o.y, t.w ?? 1, t.h ?? 1, i);
    return g.rt.fun!;
  };
  /** Wait for a good moment (or a bad one), then press Space once. */
  const push = (g: Game, good: boolean): Ev[] => {
    const r = g.rt.fun!;
    const out: Ev[] = [];
    let n = 0;
    while (n++ < 400 && g.rt.fun) {
      const gap = Math.abs(pushGap(r.t + 1 / 60));
      if (good ? gap < 0.05 : gap > PUSH_WINDOW + 0.2) break;
      out.push(...run(g, {}, 1));
    }
    out.push(...run(g, { act: true }, 1));
    return out;
  };

  it('a good push makes the swing go higher, with a rising sound; a push at the wrong time does nothing', () => {
    const g = playing();
    const r = onSwing(g);
    run(g, {}, 30);
    push(g, false);
    expect(r.pushes ?? []).toEqual([]);
    expect(g.rt.fun).toBe(r);
    const evs = push(g, true);
    expect(r.pushes?.length).toBe(1);
    expect(evs.some((e) => e.t === 'sfx' && e.id === 'push1')).toBe(true);
    run(g, {}, 60);
    expect(swingHeight(r, r.t)).toBeGreaterThan(1.3);
  });

  it('three good pushes and she jumps off a tile ahead onto free ground with a "Wheee!"', () => {
    const g = playing();
    const r = onSwing(g);
    const seat = { x: r.ax, y: r.ay };
    run(g, {}, 30);
    const evs: Ev[] = [];
    for (let i = 0; i < 3; i++) {
      evs.push(...push(g, true));
      evs.push(...run(g, {}, 70));
    }
    expect(r.pushes?.length).toBe(3);
    expect(r.leap).toBeDefined();
    let n = 0;
    while (g.rt.fun && n++ < 600) evs.push(...run(g, {}, 1));
    expect(g.rt.fun).toBeNull();
    expect(words(evs)).toContain('say:wheee');
    expect(Math.abs(g.s.x - seat.x)).toBeLessThan(0.01);
    expect(g.s.y - seat.y).toBeGreaterThanOrEqual(0.99);
    expect(free(g, 'island', g.s.x, g.s.y, 0.28)).toBe(true);
    expect(evs.some((e) => e.t === 'fx' && e.id === 'heart')).toBe(true);
  });

  it('the jump off is smooth: her pose between ticks lies between the tick poses', () => {
    const g = playing();
    const r = onSwing(g);
    r.pushes = [0.4, 0.5, 0.6];
    r.leap = 2.125;
    r.secs = r.leap + LEAP_SECS;
    run(g, {}, Math.round(r.leap * 60) - 3);
    for (let k = 0; k < 30 && g.rt.fun; k++) {
      const a = { ...funPose(r, 0) };
      run(g, {}, 1);
      if (!g.rt.fun) break;
      const b = { ...funPose(r, 0) };
      const mid = funPose(r, 0, r.t - 1 / 120);
      // (near the top of the arc the middle may be a hair above both ends)
      expect(mid.lift).toBeGreaterThanOrEqual(Math.min(a.lift, b.lift) - 0.01);
      expect(mid.lift).toBeLessThanOrEqual(Math.max(a.lift, b.lift) + 0.01);
      expect(Math.abs(b.sway - a.sway)).toBeLessThan(0.1);
    }
  });

  it('a friend on the other swing goes as high as she does', () => {
    const g = playing();
    const r = onSwing(g);
    r.pushes = [1.7, 3.4];
    r.secs = 20;
    r.friend = 1;
    r.ft = 5;
    r.t = 6;
    // both reach the same top: the friend's swing is the same height function, a quarter swing behind
    let me = 0;
    let mate = 0;
    for (let t = 6; t < 8; t += 0.01) {
      me = Math.max(me, Math.abs(funPose(r, 0, t).sway));
      mate = Math.max(mate, Math.abs(funPose(r, 1, t).sway));
    }
    expect(me).toBeGreaterThan(0.3 * 1.7);
    expect(Math.abs(me - mate)).toBeLessThan(0.02);
  });

  it('walking still ends the turn at once, and Space alone never does', () => {
    const g = playing();
    const r = onSwing(g);
    run(g, {}, 30);
    run(g, { act: true }, 1);
    expect(g.rt.fun).toBe(r);
    run(g, { mx: 1 }, 1);
    expect(g.rt.fun).toBeNull();
    expect(FUN.swing.secs).toBeGreaterThan(3);
    endFun(g);
  });
});

describe('I9: feeding the pond', () => {
  const atJetty = (g: Game, built = true): void => {
    g.s.flags.site_jetty = built ? 1 : 0;
    rebuildArea(g, 'island');
    g.s.x = 42.5;
    g.s.y = 77.5;
    g.s.dir = 'down';
    g.s.bag[10] = { id: 'bread', n: 5 };
  };
  it('at the far end of the built jetty with bread, Space throws a piece and the fish come', () => {
    const g = playing();
    atJetty(g);
    const t = findTarget(g);
    expect(t.kind).toBe('feed');
    expect(t.hint).toBe('feed');
    const evs = run(g, { act: true }, 1);
    expect(count(g, 'bread')).toBe(4);
    expect(evs.filter((e) => e.t === 'fx' && e.id === 'ripple').length).toBeGreaterThanOrEqual(2);
    expect(evs.filter((e) => e.t === 'fx' && e.id === 'fishjump').length).toBe(3);
    expect(evs.filter((e) => e.t === 'fx' && e.id === 'heart').length).toBe(3);
  });
  it('3 pieces a day, then "They are full." and no more bread is used; next day they want more', () => {
    const g = playing();
    atJetty(g);
    for (let i = 0; i < FEED_MAX; i++) run(g, { act: true }, 30);
    expect(fedToday(g)).toBe(3);
    expect(count(g, 'bread')).toBe(2);
    run(g, { act: true }, 1);
    expect(count(g, 'bread')).toBe(2);
    expect(g.rt.nudge).toBe('They are full.');
    g.s.day++;
    expect(fedToday(g)).toBe(0);
    expect(findTarget(g).kind).toBe('feed');
  });
  it('full, with a rod, Space fishes again; with no bread or an unbuilt jetty it never feeds', () => {
    const g = playing();
    atJetty(g);
    g.s.counts.pond_fed_day = g.s.day + 1;
    g.s.counts.pond_fed = 3;
    g.s.pouch.fishing_rod = 1;
    expect(findTarget(g).kind).toBe('water');
    const h = playing();
    atJetty(h, false);
    expect(findTarget(h).kind).not.toBe('feed');
    const k = playing();
    atJetty(k);
    k.s.bag[10] = null;
    expect(findTarget(k).kind).not.toBe('feed');
  });
  it('the near end of the jetty, by the shore, is not the far end', () => {
    const g = playing();
    atJetty(g);
    g.s.x = 44.5;
    expect(findTarget(g).kind).not.toBe('feed');
  });
});

describe('I10: her pet indoors, and its tricks', () => {
  const withCat = (): Game => {
    const g = playing();
    adoptPet(g, 'cat');
    const cat = g.s.animals.find((a) => a.pet && a.kind === 'cat')!;
    // she stands at the cottage door with the cat beside her
    g.s.x = 74.5;
    g.s.y = 77.5;
    cat.x = 75.5;
    cat.y = 78;
    return g;
  };
  it('the cat comes in through the door with her, lies down off the door, and comes out with her', () => {
    const g = withCat();
    enterArea(g, 'cottage', 6.5, 8.5, 'up');
    const cat = g.s.animals.find((a) => a.pet && a.kind === 'cat')!;
    expect(cat.area).toBe('cottage');
    run(g, {}, 400);
    const b = g.rt.beasts.find((x) => x.k === cat.k)!;
    expect(b.rest).toBe(true);
    const spot = petRest(g, 'cottage')!;
    expect(Math.hypot(b.x - spot.x, b.y - spot.y)).toBeLessThan(0.05);
    const door = g.c.areas.cottage!.doors[0]!;
    expect(Math.max(Math.abs(Math.floor(b.x) - door.x), Math.abs(Math.floor(b.y) - door.y))).toBeGreaterThanOrEqual(2);
    enterArea(g, 'island', 74.5, 77.5, 'down');
    expect(cat.area).toBe('island');
    expect(Math.hypot(cat.x - g.s.x, cat.y - g.s.y)).toBeLessThan(1.2);
  });
  it('a cat far from her stays where it is', () => {
    const g = withCat();
    const cat = g.s.animals.find((a) => a.pet && a.kind === 'cat')!;
    cat.x = 60;
    enterArea(g, 'cottage', 6.5, 8.5, 'up');
    expect(cat.area).toBe('island');
  });
  it('the cat lies on a rug when the room has one', () => {
    const g = withCat();
    g.s.placed.push({ k: g.s.nextK++, item: 'rug', area: 'cottage', x: 3, y: 3, layer: 'floor' } as never);
    expect(petRest(g, 'cottage')).toEqual({ x: 4, y: 4 });
  });
  it('the wolf follows her into any room', () => {
    const g = playing();
    adoptPet(g, 'wolf');
    enterArea(g, 'bing_in', 5.5, 5.5, 'up');
    expect(g.s.animals.find((a) => a.pet && a.kind === 'wolf')!.area).toBe('bing_in');
  });
  it('Space on her own pet does sit, spin, jump in turn, each with its word and a heart', () => {
    const g = withCat();
    refresh(g);
    const cat = g.s.animals.find((a) => a.pet && a.kind === 'cat')!;
    const seen: number[] = [];
    for (let i = 0; i < 4; i++) {
      g.ev.length = 0;
      animalAct(g, cat.k);
      const b = g.rt.beasts.find((x) => x.k === cat.k)!;
      seen.push(b.trick!);
      expect(words(g.ev)).toEqual(['say:cat']);
      expect(g.ev.some((e) => e.t === 'fx' && e.id === 'heart')).toBe(true);
      run(g, {}, Math.ceil(TRICK_SECS * 60) + 1);
      expect(b.trick).toBe(0);
    }
    expect(seen).toEqual([1, 2, 3, 1]);
  });
});
/** The beasts of her area, as entering it builds them. */
function refresh(g: Game): void {
  enterArea(g, g.s.area, g.s.x, g.s.y, g.s.dir);
}

describe('I11: the tidy bag and pins', () => {
  it('tidy sorts the bag rows into groups by name and stacks them; the bottom buttons stay', () => {
    const g = playing();
    g.s.bag.fill(null);
    g.s.bag[0] = { id: 'plank', n: 3 };
    g.s.bag[3] = { id: 'apple', n: 1 };
    g.s.bag[9] = { id: 'wheat_seed', n: 2 };
    g.s.bag[12] = { id: 'plank', n: 4 };
    g.s.bag[20] = { id: 'apple', n: 2 };
    g.s.bag[30] = { id: 'bread', n: 1 };
    g.s.bag[40] = { id: 'cobblestone', n: 5 };
    g.s.bag[41] = { id: 'wheat_seed', n: 3 };
    const before = g.s.bag.slice(0, 8).map((s) => (s ? { ...s } : null));
    tidyBag(g);
    // the bottom row keeps its things; its stacks take the same things from the bag
    expect(g.s.bag[0]).toEqual({ id: 'plank', n: 7 });
    expect(g.s.bag[3]).toEqual({ id: 'apple', n: 3 });
    expect(g.s.bag.slice(0, 8).map((s) => s?.id ?? null)).toEqual(before.map((s) => s?.id ?? null));
    const rest = g.s.bag.slice(8).filter(Boolean) as { id: string; n: number }[];
    expect(rest.map((s) => s.id)).toEqual(['bread', 'wheat_seed', 'cobblestone']);
    expect(rest[1]!.n).toBe(5);
    expect(g.s.bag.slice(8, 11).every(Boolean)).toBe(true);
    // groups go in order
    const groups = rest.map((s) => tidyGroup(g.c.items[s.id]!));
    expect([...groups].sort((a, b) => a - b)).toEqual(groups);
  });
  it('N pins a bottom button: moves onto or off it are refused, topping it up is fine; pins last across a reload', () => {
    const g = playing();
    g.s.bag[2] = { id: 'apple', n: 2 };
    g.s.bag[20] = { id: 'plank', n: 5 };
    g.s.bag[21] = { id: 'apple', n: 1 };
    run(g, { cmd: { c: 'pin', slot: 2 } }, 1);
    expect(pinned(g, 2)).toBe(true);
    run(g, { cmd: { c: 'move', from: 20, to: 2 } }, 1);
    expect(g.s.bag[2]).toEqual({ id: 'apple', n: 2 });
    expect(moveAllowed(g, 2, 20)).toBe(false);
    run(g, { cmd: { c: 'move', from: 21, to: 2 } }, 1);
    expect(g.s.bag[2]).toEqual({ id: 'apple', n: 3 });
    // the save keeps its shape: the pin is a counts key
    const back = JSON.parse(JSON.stringify(g.s)) as Game['s'];
    expect(Object.keys(back).sort()).toEqual(Object.keys(g.s).sort());
    g.s = back;
    expect(pinned(g, 2)).toBe(true);
    run(g, { cmd: { c: 'pin', slot: 2 } }, 1);
    expect(pinned(g, 2)).toBe(false);
    run(g, { cmd: { c: 'move', from: 20, to: 2 } }, 1);
    expect(g.s.bag[2]).toEqual({ id: 'plank', n: 5 });
  });
  it('a pin belongs to its thing: used up and something else put there, that is not pinned', () => {
    const g = playing();
    g.s.bag[4] = { id: 'apple', n: 1 };
    run(g, { cmd: { c: 'pin', slot: 4 } }, 1);
    g.s.bag[4] = { id: 'plank', n: 1 };
    expect(pinned(g, 4)).toBe(false);
  });
});

describe('I12: where a friend is', () => {
  it('who lives where comes from the cast data', () => {
    const g = playing();
    expect(residents(g, 'bing_in')).toContain('bing');
    expect(residents(g, 'heeler_in')).toContain('bluey');
    expect(residents(g, 'peppa_in')).toContain('peppa');
    expect(residents(g, 'island')).toEqual([]);
  });
  it('walking into a home with nobody in says where the nearest of them is, once', () => {
    const g = playing();
    // daytime: Bing is in his garden and Flop by the house
    const line = whereLine(g, 'bing_in');
    expect(line).toMatch(/^(Bing|Flop) is (at [^{}]+|just outside)\.$/);
    g.rt.nudgeT = 0;
    enterArea(g, 'bing_in', 5.5, 5.5, 'up');
    expect(g.rt.nudge).toBe(line);
  });
  it('a friend far off is named by the nearest named place', () => {
    const g = playing();
    expect(whereLine(g, 'heeler_in')).toMatch(/^[A-Z][a-z]+ is (at [a-zA-Z' ]+|just outside)\.$/);
    const pg = g.c.areas.island!.places.playground!;
    expect(placeName(g, 'island', pg.x, pg.y)).toBe(pg.label);
  });
  it('names come from the cast tokens, never left as tokens', () => {
    const g = playing();
    for (const id in g.c.areas) {
      const l = whereLine(g, id);
      expect(l).not.toMatch(/[{}]/);
    }
  });
  it('someone who lives there is in: no line', () => {
    const g = playing();
    const who = residents(g, 'bing_in');
    expect(who.length).toBeGreaterThan(0);
    // night after chapter 2: Bing and Flop are at home
    g.s.quests.ch2 = { step: 99, n: 0, done: true };
    g.s.time = 700;
    const l = whereLine(g, 'bing_in');
    expect(l).toBe('');
  });
});
