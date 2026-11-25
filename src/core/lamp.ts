// Package 73a (I2): the lighthouse lamp. At the top of the tower she turns the big lamp on with Space. It stays on
// until the next morning (the game day it was lit is kept in `counts`, so a reload keeps it). While it is on and it is
// night, its beam sweeps the bay (drawn by the view) and the bay is a safe region: no mob comes and any there leave
// (src/core/mobs.ts asks `lampKeeps`, the same test as a lit region).
import { DUSK_AT, isNight } from './cond.ts';
import { say } from './talk.ts';
import type { Game, MapObj } from './types.ts';

/** The `counts` key that holds the game day the lamp was lit. */
export const LAMP_DAY = 'lamp';
/** The region the beam keeps safe. */
export const LAMP_REGION = 'bay';
/** The room the lamp stands in. */
export const LAMP_ROOM = 'lamp_in';

/** The lamp was lit today: it stays on until the next morning. */
export function lampOn(g: Game): boolean {
  return g.s.counts[LAMP_DAY] === g.s.day;
}

/** The lamp is on and it is night: the beam sweeps the bay. */
export function lampShines(g: Game): boolean {
  return lampOn(g) && isNight(g);
}

/** How much the lamp room glows: faint while it is day outside, full from dusk to the next morning. */
export const LAMP_DAY_GLOW = 0.3;
export function lampGlow(g: Game): number {
  return g.s.time < DUSK_AT ? LAMP_DAY_GLOW : 1;
}

/** Does the lamp keep this region (by its map code) safe right now? */
export function lampKeeps(g: Game, code: string): boolean {
  return code === g.c.regions[LAMP_REGION]?.code && lampShines(g);
}

/** Space on the big lamp: on it goes, with a hum. The first time ever it says what it does. */
export function lightLamp(g: Game, o: MapObj): void {
  if (lampOn(g)) return;
  const first = g.s.counts[LAMP_DAY] === undefined;
  g.s.counts[LAMP_DAY] = g.s.day;
  g.rt.dirty = true;
  g.ev.push({ t: 'sfx', id: 'hum' });
  g.ev.push({ t: 'fx', id: 'sparkle', x: o.x + 0.5, y: o.y + 0.5, n: 6 });
  g.ev.push({ t: 'act', kind: 'lamp', id: o.id });
  if (first) say(g, ['say: ' + (g.c.strings.lamp_on ?? '')]);
}
