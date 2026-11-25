// Package 73a (D79): the lighthouse lamp (I2), looking out (I3) and a find in every room (I13). Plain Node, no browser.
import { describe, expect, it } from 'vitest';
import { newDay } from '../src/core/clock.ts';
import { NIGHT_AT } from '../src/core/cond.ts';
import { free } from '../src/core/grid.ts';
import { enterArea, findTarget, objLive } from '../src/core/hero.ts';
import { LAMP_DAY, lampKeeps, lampOn, lampShines } from '../src/core/lamp.ts';
import { LOOK_SECONDS } from '../src/core/lookout.ts';
import { makeMob, regionLit } from '../src/core/mobs.ts';
import { buildingRooms, roomsCount } from '../src/core/rooms.ts';
import { newGame } from '../src/core/state.ts';
import { NO_INPUT, step } from '../src/core/step.ts';
import type { Dir, Ev, Game, Input, MapObj } from '../src/core/types.ts';
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
/** Close whatever talk is up, as Space would. */
const closeTalk = (g: Game) => {
  for (let i = 0; i < 20 && g.rt.mode === 'talk'; i++) run(g, { act: true }, 1) && run(g, {}, 20);
};
/** Stand on a free tile beside a thing, facing it, with nobody about. */
const standBy = (g: Game, area: string, o: MapObj) => {
  const t = g.c.objects[o.type]!;
  const w = t.w ?? 1;
  const h = t.h ?? 1;
  const sides: [number, number, Dir][] = [
    [o.x, o.y + h, 'up'],
    [o.x - 1, o.y, 'right'],
    [o.x + w, o.y, 'left'],
    [o.x, o.y - 1, 'down'],
  ];
  enterArea(g, area, 1.5, 1.5, 'down');
  for (const [x, y, d] of sides)
    if (free(g, area, x + 0.5, y + 0.5, 0.3)) {
      enterArea(g, area, x + 0.5, y + 0.5, d);
      g.rt.mobs.length = 0;
      g.rt.npcs.length = 0;
      g.rt.beasts.length = 0;
      return;
    }
  throw new Error(`no free side by ${o.id}`);
};
const obj = (area: string, id: string): MapObj => g0.c.areas[area]!.objects.find((o) => o.id === id)!;
const g0 = playing();

describe('the lighthouse lamp (I2)', () => {
  it('Space turns it on, says its line the first time, and it stays on until the next morning', () => {
    const g = playing();
    standBy(g, 'lamp_in', obj('lamp_in', 'big_lamp'));
    expect(lampOn(g)).toBe(false);
    const ev = run(g, { act: true }, 1);
    expect(lampOn(g)).toBe(true);
    expect(g.s.counts[LAMP_DAY]).toBe(g.s.day);
    expect(ev.some((e) => e.t === 'sfx' && e.id === 'hum')).toBe(true);
    expect(g.rt.talk?.text ?? g.rt.talk?.lines.join(' ')).toContain('The lamp is on.');
    closeTalk(g);
    // on until the morning, through a reload (counts is saved)
    g.s.time = NIGHT_AT + 20;
    expect(lampShines(g)).toBe(true);
    const copy = structuredClone(g.s);
    expect(copy.counts[LAMP_DAY]).toBe(g.s.day);
    newDay(g, true);
    expect(lampOn(g)).toBe(false);
    // the second time no line
    run(g, {}, 30);
    g.rt.mode = 'play';
    g.rt.talk = null;
    g.rt.card = null;
    standBy(g, 'lamp_in', obj('lamp_in', 'big_lamp'));
    run(g, { act: true }, 1);
    expect(lampOn(g)).toBe(true);
    expect(g.rt.talk).toBeNull();
  });

  it('makes the bay safe at night only while it is on, and a mob there leaves', () => {
    const g = playing();
    const bay = g.c.regions.bay!.code;
    enterArea(g, 'island', 100.5, 100.5, 'down');
    g.rt.mobs.length = 0;
    g.s.time = NIGHT_AT + 20;
    expect(lampKeeps(g, bay)).toBe(false);
    // a crater mob (a zone that is out day and night) that has followed her into the bay stays without the lamp
    const at = { x: 103.5, y: 100.5 };
    expect(g.c.areas.island!.region[Math.floor(at.y)]!.charAt(Math.floor(at.x))).toBe(bay);
    const m = makeMob(g, 'zombie', at.x, at.y, 'crater_floor');
    m.hurtT = 0;
    run(g, {}, 2);
    expect(m.gone ?? false).toBe(false);
    g.rt.mobs.length = 0;
    // with the lamp on: the bay is lit and the mob goes
    g.s.counts[LAMP_DAY] = g.s.day;
    expect(lampKeeps(g, bay)).toBe(true);
    expect(regionLit(g, bay)).toBe(true);
    expect(lampKeeps(g, g.c.regions.crater!.code)).toBe(false);
    const m2 = makeMob(g, 'zombie', at.x, at.y, 'crater_floor');
    run(g, {}, 2);
    expect(m2.gone || !g.rt.mobs.includes(m2)).toBe(true);
    // by day the lamp keeps nothing (there is nothing to keep away)
    g.s.time = 100;
    expect(lampKeeps(g, bay)).toBe(false);
  });
});

describe('looking out (I3)', () => {
  for (const [area, id] of [
    ['lookout_in', 'telescope_bay'],
    ['beacon_in', 'telescope_hill'],
    ['lamp_in', 'lamp_window_sea'],
  ] as const)
    it(`${id}: the picture shows, ends by itself, then its line shows once`, () => {
      const g = playing();
      standBy(g, area, obj(area, id));
      run(g, { act: true }, 1);
      expect(g.rt.look?.id).toBe(id);
      const x = g.s.x;
      // the world waits, and a key held from before (walking up to it) does not end it
      run(g, { my: -1 }, 60);
      expect(g.rt.look).toBeTruthy();
      expect(g.s.x).toBe(x);
      run(g, {}, Math.ceil(LOOK_SECONDS * 60) - 60);
      expect(g.rt.look).toBeNull();
      expect(g.rt.mode).toBe('talk');
      expect(g.rt.talk?.lines.join(' ')).toContain(g.c.strings[`sign:${id}`]!);
      closeTalk(g);
      expect(g.rt.mode).toBe('play');
      // the second look: any key ends it sooner, and the line is not said again
      run(g, { act: true }, 1);
      expect(g.rt.look).toBeTruthy();
      run(g, {}, 30);
      run(g, { act: true }, 1);
      expect(g.rt.look).toBeNull();
      expect(g.rt.talk).toBeNull();
    });
});

describe('a find in every room (I13)', () => {
  const rooms = [...buildingRooms(content).filter((r) => r !== 'cottage'), 'keeper_in', 'lamp_in'];
  it('every building and lighthouse floor but the cottage has one find', () => {
    expect(buildingRooms(content).length).toBe(20);
    for (const r of rooms) {
      const finds = content.areas[r]!.objects.filter((o) => content.objects[o.type]!.interact === 'chest');
      expect(finds.length, r).toBe(1);
      expect(finds[0]!.d, r).toBeTruthy();
    }
  });

  const fresh = rooms.filter((r) => content.areas[r]!.objects.some((o) => o.type.startsWith('find_')));
  it('16 new rooms: Space takes each find once and says what it was', () => {
    expect(fresh.length).toBe(16);
    const g = playing();
    for (const r of fresh) {
      const o = content.areas[r]!.objects.find((q) => q.type.startsWith('find_'))!;
      standBy(g, r, o);
      run(g, {}, 30);
      const gems = g.s.emeralds;
      const ev = run(g, { act: true }, 1);
      expect(g.s.taken[o.id], o.id).toBe(1);
      const note = ev.find((e) => e.t === 'toast' && e.kind === 'info');
      expect(note && note.t === 'toast' ? note.text : '', o.id).toMatch(/^You found .+!$/);
      if (o.d === 'emerald:5') {
        expect(g.s.emeralds - gems, o.id).toBe(5);
        expect(note && note.t === 'toast' ? note.text : '').toBe('You found 5 emeralds!');
      }
      // gone for good: Space no longer finds it, and the rule gives nothing a second time
      run(g, {}, 40);
      expect(findTarget(g).obj?.id, o.id).not.toBe(o.id);
      expect(objLive(g, o), o.id).toBe(false);
    }
  });
});

describe('the journal count (I13)', () => {
  it('counts the buildings she has been inside, from the save, with a cheer when full', () => {
    const g = playing();
    expect(roomsCount(g)).toEqual({ n: 1, of: 20 });
    enterArea(g, 'cafe_in', 9.5, 5.5, 'up');
    run(g, {}, 1);
    expect(roomsCount(g).n).toBe(2);
    // the lighthouse's upper floors are the same building
    enterArea(g, 'keeper_in', 3.5, 2.5, 'down');
    run(g, {}, 1);
    expect(roomsCount(g).n).toBe(2);
    // a room where something was taken before this rule counts too
    g.s.taken.chest_workshop = 1;
    expect(roomsCount(g).n).toBe(3);
    let cheers = 0;
    for (const r of buildingRooms(g.c)) {
      const a = g.c.areas[r]!;
      const exit = a.doors.find((d) => d.to === 'island')!;
      enterArea(g, r, exit.x + 0.5, exit.y - 0.5, 'up');
      g.rt.mode = 'play';
      cheers += run(g, {}, 1).filter((e) => e.t === 'toast' && e.text === 'rooms_all').length;
    }
    expect(roomsCount(g)).toEqual({ n: 20, of: 20 });
    expect(cheers).toBe(1);
  });
});
