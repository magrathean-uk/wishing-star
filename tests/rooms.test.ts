// Package 72 (D78): every building can be entered. A door that waits for its building stays shut (and quiet) until
// the building stands; the lighthouse is three floors joined by stairs; each new room has its one thing to do.
import { describe, expect, it } from 'vitest';
import { rebuildArea } from '../src/core/grid.ts';
import { moveBody, WALK_SPEED } from '../src/core/hero.ts';
import { newGame } from '../src/core/state.ts';
import type { Game } from '../src/core/types.ts';
import { content } from '../src/data/content.ts';
import { ROOM_DOORS } from '../tools/map/rooms.ts';

const playing = (): Game => {
  const g = newGame(content, { seed: 3, hero: 'amelia' });
  g.rt.mode = 'play';
  g.rt.talk = null;
  g.rt.npcs.length = 0;
  g.rt.mobs.length = 0;
  for (const id in content.areas) rebuildArea(g, id);
  return g;
};
/** Stand on the tile below (x, y) in `area` and walk up for half a second. */
const walkUp = (g: Game, area: string, x: number, y: number) => {
  g.s.area = area;
  g.s.x = x + 0.5;
  g.s.y = y + 1.5;
  for (let f = 0; f < 30 && g.s.area === area; f++) moveBody(g, 0, -WALK_SPEED / 60);
};

describe('every building has an inside', () => {
  it('each new door leads to its own room, and the room is in the content', () => {
    const isle = content.areas.island!;
    const seen = new Set<string>();
    for (const d of ROOM_DOORS) {
      expect(content.areas[d.room], d.room).toBeTruthy();
      expect(seen.has(d.room)).toBe(false);
      seen.add(d.room);
      expect(isle.doors.some((q) => q.x === d.x && q.y === d.y && q.to === d.room)).toBe(true);
    }
    expect(seen.size).toBe(14);
  });

  it('the treehouse, the hill lookout and the windmill open only once built, and say nothing before', () => {
    for (const d of ROOM_DOORS.filter((r) => r.if)) {
      const g = playing();
      walkUp(g, 'island', d.x, d.y);
      expect(g.s.area, `${d.room} before`).toBe('island');
      expect(g.rt.nudgeT ?? 0).toBe(0);
      g.s.flags[(d.if as { flag: string }).flag] = 1;
      rebuildArea(g, 'island');
      walkUp(g, 'island', d.x, d.y);
      expect(g.s.area, `${d.room} after`).toBe(d.room);
    }
  });

  it('the lighthouse climbs from the store room to the lamp room and back down', () => {
    const g = playing();
    walkUp(g, 'island', 96, 104);
    expect(g.s.area).toBe('lighthouse_in');
    walkUp(g, 'lighthouse_in', 7, 1);
    expect(g.s.area).toBe('keeper_in');
    walkUp(g, 'keeper_in', 7, 1);
    expect(g.s.area).toBe('lamp_in');
    walkUp(g, 'lamp_in', 2, 1);
    expect(g.s.area).toBe('keeper_in');
    walkUp(g, 'keeper_in', 3, 1);
    expect(g.s.area).toBe('lighthouse_in');
  });

  it('each new room has one thing to do and a name', () => {
    const rooms = [...ROOM_DOORS.map((d) => d.room), 'keeper_in', 'lamp_in'];
    for (const id of rooms) {
      const a = content.areas[id]!;
      expect(a.name.length, id).toBeGreaterThan(0);
      const todo = a.objects.filter((o) => {
        const t = content.objects[o.type]!;
        // package 73a: a telescope or a window to look out of, and the lamp to light
        return (t.interact === 'fun' && t.fun) || ['sign', 'look', 'lamp'].includes(t.interact ?? '');
      });
      // the store room's thing to do is the climb itself
      if (id !== 'lighthouse_in') expect(todo.length, id).toBeGreaterThan(0);
      for (const o of todo.filter((x) => ['sign', 'look'].includes(content.objects[x.type]!.interact ?? '')))
        expect(content.strings[`sign:${o.d ?? o.id}`], o.id).toBeTruthy();
    }
  });
});
