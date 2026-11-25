// Package 73a (I3): looking out. Space at a telescope or a lamp room window shows the island from above for a few
// seconds (the view draws the M screen's picture, the places she has found and a ring where she stands). It ends by
// itself, or sooner on any key. Then the line the thing already has (`sign:<id>`) shows, the first time only.
// While it shows, the world waits, as it does for a card.
import { say } from './talk.ts';
import type { Game, Input, MapObj } from './types.ts';

/** How long the picture shows, in seconds. */
export const LOOK_SECONDS = 4;
/** A key pressed sooner than this after Space does not end it (the Space that began it is still settling). */
export const LOOK_GRACE = 0.4;

/** Space at a telescope or a window. */
export function startLook(g: Game, o: MapObj): void {
  g.rt.look = { id: o.d ?? o.id, t: 0, mx: Number.NaN, my: Number.NaN };
  g.ev.push({ t: 'sfx', id: 'whoosh' });
}

/** One step while looking out. True while the picture shows (the rest of the step waits). */
export function stepLook(g: Game, inp: Input): boolean {
  const L = g.rt.look;
  if (!L) return false;
  // directions already held when it began do not count as a press
  if (Number.isNaN(L.mx)) {
    L.mx = inp.mx;
    L.my = inp.my;
  }
  const turned = (inp.mx !== 0 && inp.mx !== L.mx) || (inp.my !== 0 && inp.my !== L.my);
  const press = turned || inp.act || inp.back || inp.use || inp.emote || !!inp.fire;
  L.mx = inp.mx;
  L.my = inp.my;
  L.t += 1 / 60;
  // (a hair under, so 4 seconds of steps end it on the last one)
  if (L.t >= LOOK_SECONDS - 1e-6 || (L.t > LOOK_GRACE && press)) endLook(g);
  return true;
}

/** The picture goes; the thing's own line shows the first time she looks out of it. */
export function endLook(g: Game): void {
  const L = g.rt.look;
  if (!L) return;
  g.rt.look = null;
  const key = 'look:' + L.id;
  if (g.s.counts[key]) return;
  g.s.counts[key] = 1;
  g.rt.dirty = true;
  const line = g.c.strings['sign:' + L.id];
  if (line) say(g, ['say: ' + line]);
}
