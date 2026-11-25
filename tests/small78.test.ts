// Package 78 (D85): ten small things. Plain Node, no browser. The lamp's glow by day (1) is a view rule checked by
// lampGlow here and by a picture; the red edge marker (7) and the tap on "R: Eat" (9) are in the picture and the bot.
import { describe, expect, it } from 'vitest';
import { petRest } from '../src/core/animals.ts';
import { lampNoteDue } from '../src/core/cond.ts';
import { tomorrow } from '../src/core/clock.ts';
import { findPath, free, regionAt } from '../src/core/grid.ts';
import { enterArea, findTarget } from '../src/core/hero.ts';
import { placeName } from '../src/core/joys.ts';
import { lampGlow } from '../src/core/lamp.ts';
import { AWAY_MAX, makeMob } from '../src/core/mobs.ts';
import { talkNpc } from '../src/core/npcs.ts';
import { newGame } from '../src/core/state.ts';
import { NO_INPUT, step } from '../src/core/step.ts';
import type { Dir, Ev, Game, MapObj, Npc } from '../src/core/types.ts';
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
const run = (g: Game, frames: number): Ev[] => {
  const out: Ev[] = [];
  for (let i = 0; i < frames; i++) {
    step(g, NO_INPUT);
    out.push(...g.ev);
    g.ev.length = 0;
  }
  return out;
};

describe('1: the lamp room glows faintly by day and fully from dusk', () => {
  it('lampGlow is faint before dusk and full after', () => {
    const g = playing();
    g.s.time = 100;
    expect(lampGlow(g)).toBeLessThan(0.5);
    g.s.time = 545;
    expect(lampGlow(g)).toBe(1);
    g.s.time = 790;
    expect(lampGlow(g)).toBe(1);
  });
});

describe('2: one short line about the lit lamp, once a night', () => {
  const bay = (g: Game) => {
    const a = g.c.areas.island!;
    const code = g.c.regions.bay!.code;
    for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) if (regionAt(a, x, y) === code) return { x, y };
    throw new Error('no bay');
  };
  const npcAt = (g: Game, id: string, x: number, y: number): Npc => {
    const n = {
      k: g.rt.nextK++,
      id,
      kind: 'npc',
      area: 'island',
      x: x + 0.5,
      y: y + 0.5,
      px: x + 0.5,
      py: y + 0.5,
      dir: 'down',
      clip: 'idle',
      ct: 0,
      hx: x + 0.5,
      hy: y + 0.5,
      roam: 0,
      path: null,
      pi: 0,
      wait: 0,
      mark: 0,
      talkT: 0,
    } as unknown as Npc;
    g.rt.npcs.push(n);
    return n;
  };
  const say = (g: Game, n: Npc): string => {
    g.rt.talk = null;
    g.rt.mode = 'play';
    talkNpc(g, n.k);
    return g.rt.talk ? JSON.stringify(g.rt.talk) : '';
  };
  it('someone in the bay says it once on a night the lamp shines, never by day or elsewhere', () => {
    const g = playing();
    const b = bay(g);
    g.s.counts.lamp = g.s.day;
    g.s.time = 700;
    expect(lampNoteDue(g)).toBe(true);
    const cat = npcAt(g, 'mercat', b.x, b.y);
    const first = say(g, cat);
    expect(first).toContain('The lamp is on');
    expect(lampNoteDue(g)).toBe(false);
    expect(say(g, cat)).not.toContain('The lamp is on');
    // next night it may say it again
    g.s.day++;
    g.s.counts.lamp = g.s.day;
    expect(lampNoteDue(g)).toBe(true);
    // by day: not due
    g.s.time = 200;
    expect(lampNoteDue(g)).toBe(false);
  });
  it('someone far from the bay does not say it, and the lamp stays due', () => {
    const g = playing();
    g.s.counts.lamp = g.s.day;
    g.s.time = 700;
    const cat = npcAt(g, 'mercat', 30, 68);
    expect(say(g, cat)).not.toContain('The lamp is on');
    expect(lampNoteDue(g)).toBe(true);
  });
});

describe('3: "is at" never names a person, an animal or a part of a room', () => {
  it('every skipped key is a real place, and the skipped labels are never returned', () => {
    const g = playing();
    const skip = g.c.whereSkip ?? [];
    expect(skip.length).toBeGreaterThan(20);
    let checked = 0;
    for (const area in g.c.areas) {
      const a = g.c.areas[area]!;
      for (const k of skip) {
        const p = a.places?.[k];
        if (!p?.label) continue;
        const same = Object.entries(a.places!).some(([k2, q]) => !skip.includes(k2) && q.label === p.label);
        if (same) continue;
        expect(placeName(g, area, Math.floor(p.x), Math.floor(p.y)), `${area}/${k}`).not.toBe(p.label);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(10);
  });
});

describe('4: a pet lies on the free tile nearest the middle, never at a door or under a thing', () => {
  it('with no rug or mat the spot is open floor, two tiles from every door', () => {
    const g = playing();
    for (const area in g.c.areas) {
      const a = g.c.areas[area]!;
      if (!a.doors?.length || area === 'island') continue;
      enterArea(g, area, a.doors[0]!.x + 0.5, a.doors[0]!.y - 0.5, 'up');
      const spot = petRest(g, area);
      if (!spot) continue;
      for (const d of a.doors)
        expect(
          Math.max(Math.abs(Math.floor(spot.x) - d.x), Math.abs(Math.floor(spot.y) - d.y)),
          area,
        ).toBeGreaterThanOrEqual(2);
      for (const o of a.objects) {
        const t = g.c.objects[o.type];
        if (!t || (t.w ?? 1) * (t.h ?? 1) === 0) continue;
        const under = spot.x >= o.x && spot.x < o.x + (t.w ?? 1) && spot.y >= o.y && spot.y < o.y + (t.h ?? 1);
        expect(
          under && g.rt.solid[area]![Math.floor(spot.y) * a.w + Math.floor(spot.x)],
          `${area} ${o.type}`,
        ).toBeFalsy();
      }
    }
  });
});

describe('5: the bedtime "crops ready" line counts pot crops at the pot pace', () => {
  const seed = Object.keys(content.items).find((k) => content.items[k]!.grows)!;
  const days = content.items[seed]!.grows!.days;
  const line = (age: number, x: number, y: number) => {
    const g = playing();
    g.s.crops.push({ x, y, seed, age });
    return tomorrow(g).includes(content.strings.tm_crops!);
  };
  it('a pot crop two days short is ready tomorrow midday; a field crop two days short is not', () => {
    expect(line(days - 2, 30, 70)).toBe(false);
    expect(line(days - 1, 30, 70)).toBe(true);
    expect(line(days - 2, -1, -1)).toBe(true);
    expect(line(days - 3, -1, -1)).toBe(false);
  });
});

describe('6: a find behind a full bag keeps its place, with one plain line', () => {
  const room = 'nook_in';
  const standBy = (g: Game, o: MapObj) => {
    const t = g.c.objects[o.type]!;
    const w = t.w ?? 1;
    const h = t.h ?? 1;
    const sides: [number, number, Dir][] = [
      [o.x, o.y + h, 'up'],
      [o.x - 1, o.y, 'right'],
      [o.x + w, o.y, 'left'],
      [o.x, o.y - 1, 'down'],
    ];
    for (const [x, y, d] of sides)
      if (free(g, room, x + 0.5, y + 0.5, 0.3)) {
        enterArea(g, room, x + 0.5, y + 0.5, d);
        g.rt.mobs.length = 0;
        g.rt.npcs.length = 0;
        g.rt.beasts.length = 0;
        return;
      }
    throw new Error('no free side');
  };
  const press = (g: Game): Ev[] => {
    const out: Ev[] = [];
    step(g, { ...NO_INPUT, act: true });
    out.push(...g.ev);
    g.ev.length = 0;
    return out;
  };
  const texts = (evs: Ev[]) => evs.filter((e) => e.t === 'toast').map((e) => (e as { text: string }).text);
  it('says the bag is full, leaves it, and takes it with its own words first once there is room', () => {
    const g = playing();
    const o = content.areas[room]!.objects.find(
      (q) => q.type.startsWith('find_') && q.d && !q.d.startsWith('emerald'),
    )!;
    expect(o, 'a find with a thing in it').toBeTruthy();
    const keep = g.s.bag.map((b) => b);
    const junk = Object.keys(content.items).filter((k) => !content.items[k]!.kind?.startsWith('pouch'));
    g.s.bag = g.s.bag.map((_, i) => ({ id: junk[i]!, n: content.items[junk[i]!]!.stack ?? 99 }));
    g.s.chests = {};
    standBy(g, o);
    run(g, 30);
    const t1 = texts(press(g));
    expect(g.s.taken[o.id]).toBeFalsy();
    expect(g.rt.nudge).toBe(content.strings.find_no_room);
    expect(t1.filter((x) => x.startsWith('You found')).length).toBe(0);
    g.s.bag[0] = null;
    run(g, 30);
    const t2 = texts(press(g));
    expect(g.s.taken[o.id]).toBe(1);
    expect(t2[0]).toMatch(/^You found/);
    expect(findTarget(g).obj?.id).not.toBe(o.id);
    void keep;
  });
});

describe('8: a mob with no path to her is never put beside her', () => {
  it("a hostile mob shut in by walls fades; a story mob comes round to ground she can reach, out of arm's reach", () => {
    for (const tag of ['', 'story']) {
      const g = playing();
      const a = g.c.areas.island!;
      g.s.x = g.rt.px = 40.5;
      g.s.y = g.rt.py = 60.5;
      const m = makeMob(g, 'zombie', 36.5, 60.5);
      m.tag = tag;
      g.rt.mobs.push(m);
      const solid = g.rt.solid.island!;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) if (dx || dy) solid[(60 + dy) * a.w + 36 + dx] = 1;
      m.away = AWAY_MAX + 3;
      run(g, 30);
      if (tag === 'story') {
        // a fight she must win is never left where she cannot get to it: it is out of its box, on a tile she can walk to
        expect(m.gone).toBeFalsy();
        expect(Math.hypot(m.x - 36.5, m.y - 60.5), tag).toBeGreaterThan(1.6);
        expect(
          findPath(solid, a.w, a.h, Math.floor(g.s.x), Math.floor(g.s.y), Math.floor(m.x), Math.floor(m.y), 0, 3000),
        ).not.toBeNull();
      } else expect(m.gone).toBe(true);
      expect(Math.hypot(m.x - g.s.x, m.y - g.s.y), tag).toBeGreaterThan(2);
    }
  });
});
