// Package 73b (I7, D79): her three pots in the greenhouse. Space with seeds plants them (no spade needed), a crop in a
// pot grows in half the days of the same crop outside, in any weather, and Space picks it by the game's crop rules.
// A pot's crop is an ordinary entry in the save's crop list: the list has no area, so a pot crop stands on a tile no
// map has, x = -n for pot n (1 to 3) and y = -1. The farm's own rules never meet it: they look at island tiles only.
// It grows twice a day: the morning (as every crop does) and midday, here; the day of the last midday is in `counts`.
import { give, HOTBAR, promised, take } from './bag.ts';
import { count, DUSK_AT } from './cond.ts';
import { nudge } from './hero.ts';
import { questEvent } from './quests.ts';
import type { Crop, Game, MapObj } from './types.ts';

export const POT_AREA = 'green_in';
/** Midday, when a pot's crop grows its second half-day. */
export const POT_NOON = DUSK_AT / 2;
const POT_Y = -1;

/** Which pot (1 to 3) a map object is; 0 when it is not one. */
export function potOf(o: MapObj): number {
  const n = Number(o.d);
  return o.type === 'her_pot' && n >= 1 && n <= 3 ? n : 0;
}
/** Pot n's object in the greenhouse (for the picture of what grows in it). */
export function potAt(g: Game, n: number): MapObj | undefined {
  return g.c.areas[POT_AREA]?.objects.find((o) => potOf(o) === n);
}
/** Is this crop in a pot, and which (1 to 3)? 0 for a crop outside. */
export function potCropN(c: Crop): number {
  return c.y === POT_Y && c.x <= -1 && c.x >= -3 ? -c.x : 0;
}
/** The crop in pot n, and its place in the list. */
export function potCrop(g: Game, n: number): { c: Crop; i: number } | null {
  const i = g.s.crops.findIndex((c) => c.x === -n && c.y === POT_Y);
  return i < 0 ? null : { c: g.s.crops[i]!, i };
}
/** How much a crop grows between tonight and tomorrow midday: a crop outside grows once a day, one in a pot twice (package 78). */
export function growthTomorrow(c: Crop): number {
  return potCropN(c) ? 2 : 1;
}
/** Half-days a crop needs in a pot: its days outside, counted twice a day. */
export function potRipe(g: Game, c: Crop): boolean {
  return c.age >= (g.c.items[c.seed]?.grows?.days ?? 1);
}
/** How far on a pot's crop is for the picture: 0 just planted, 1 half way, 2 ready. */
export function potStage(g: Game, c: Crop): number {
  const days = g.c.items[c.seed]?.grows?.days ?? 1;
  return c.age >= days ? 2 : c.age * 2 >= days ? 1 : 0;
}
/** What Space does at pot n: 'pick' a ready crop, 'plant' in an empty pot, or 'wait' while it grows. */
export function potHint(g: Game, n: number): 'pick' | 'plant' | 'wait' {
  const p = potCrop(g, n);
  if (p) return potRipe(g, p.c) ? 'pick' : 'wait';
  return 'plant';
}

/** The seed she plants: the one picked on the bar, else the first in the bag that no quest is waiting for. */
function seedFor(g: Game): string {
  const s = g.s;
  const ok = (id: string | undefined) => !!id && !!g.c.items[id]?.grows && count(g, id) > promised(g, id);
  const held = s.hot < HOTBAR ? s.bag[s.hot]?.id : undefined;
  if (ok(held)) return held!;
  for (const sl of s.bag) if (ok(sl?.id)) return sl!.id;
  return '';
}

/** Space at one of her pots: pick a ready crop, plant a seed in an empty pot, or say it is still growing. */
export function potAct(g: Game, o: MapObj): void {
  const n = potOf(o);
  if (!n) return;
  const p = potCrop(g, n);
  const x = o.x + 0.5;
  const y = o.y + 0.5;
  if (p) {
    if (!potRipe(g, p.c)) {
      nudge(g, 'pot_growing');
      return;
    }
    const def = g.c.items[p.c.seed]!.grows!;
    g.s.crops.splice(p.i, 1);
    give(g, def.crop, def.n);
    g.rt.worldRev++;
    g.ev.push({ t: 'sfx', id: 'pickup' });
    g.ev.push({ t: 'fx', id: 'pop', x, y, item: def.crop, n: def.n });
    g.ev.push({ t: 'act', kind: 'harvest', id: def.crop });
    g.s.counts.harvest = (g.s.counts.harvest ?? 0) + 1;
    questEvent(g, 'grow', def.crop, def.n);
    return;
  }
  const seed = seedFor(g);
  if (!seed) {
    nudge(g, 'pot_seeds');
    return;
  }
  take(g, seed, 1);
  g.s.crops.push({ x: -n, y: POT_Y, seed, age: 0 });
  g.rt.worldRev++;
  g.ev.push({ t: 'sfx', id: 'plant' });
  g.ev.push({ t: 'fx', id: 'sprout', x, y });
  g.ev.push({ t: 'act', kind: 'plant', id: seed });
}

/** Twice a second in play: at midday every pot's crop grows its second half-day (once a day). */
export function stepPots(g: Game): void {
  const s = g.s;
  if (s.time < POT_NOON || s.counts.pot_noon === s.day) return;
  s.counts.pot_noon = s.day;
  let grew = false;
  for (const c of s.crops)
    if (potCropN(c)) {
      c.age++;
      grew = true;
    }
  if (grew) g.rt.worldRev++;
}
