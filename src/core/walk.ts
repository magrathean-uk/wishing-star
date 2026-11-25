// One frame of walking with sliding along walls and help round corners, as a pure step on a position. The hero's
// moveBody (hero.ts) uses it, and so does the helper arrow (guide.ts) when it tries a held key ahead of her, so the
// two can never disagree.
import { free } from './grid.ts';
import type { Game } from './types.ts';

/** Half the width of her body, in tiles. */
export const HALF = 0.28;

/**
 * How far to the side a held key looks for a way on when she walks into a corner (package 60: it was 0.34, so a
 * one-tile gap half a tile or more to the side could not be found and a held key left her stuck in front of it).
 */
const CORNER = [0.34, 0.5, 0.7, 0.9, 1.1, 1.3, 1.5];

/**
 * Walking straight at a wall: the side (within CORNER) where the way on is open and the slide there is clear.
 * Of those, the one with the longest open run ahead wins (a shore that steps back diagonally is open for a
 * moment on one side, but the real way through is the lane on the other); the nearer one when they tie.
 * Returns -1 or 1 for the side along the other axis, or 0 when there is none.
 */
function cornerSide(g: Game, area: string, x: number, y: number, dx: number, dy: number): number {
  const fx = Math.sign(dx);
  const fy = Math.sign(dy);
  // walking into a thing in the way that a tool clears (a thorn bush, a fallen tree, a rock fall): she stays at it,
  // facing it, so its Space prompt shows (sliding her off round it hid the prompt)
  if (blocker(g, area, Math.floor(x + fx * (HALF + 0.1)), Math.floor(y + fy * (HALF + 0.1)))) return 0;
  let best = 0;
  let bestRun = 0;
  for (const k of CORNER)
    for (const sd of [-1, 1]) {
      const lx = dy ? sd * k : 0;
      const ly = dx ? sd * k : 0;
      if (!free(g, area, x + lx, y + ly, HALF)) continue;
      // the way on is open, or it is a thing in the way to clear (she slides over to face it, and its prompt shows)
      const toThing = blocker(g, area, Math.floor(x + lx + fx * (HALF + 0.1)), Math.floor(y + ly + fy * (HALF + 0.1)));
      if (!toThing && !free(g, area, x + lx + dx, y + ly + dy, HALF)) continue;
      let clear = true;
      for (let t = 0.2; t < k && clear; t += 0.2) clear = free(g, area, x + (lx / k) * t, y + (ly / k) * t, HALF);
      if (!clear) continue;
      let run = toThing ? 8 : 1;
      while (run < 8 && free(g, area, x + lx + fx * run * 0.25, y + ly + fy * run * 0.25, HALF)) run++;
      if (run > bestRun) {
        bestRun = run;
        best = sd;
      }
    }
  return best;
}

/** A live one-off obstacle a tool clears, on this tile. */
function blocker(g: Game, area: string, tx: number, ty: number): boolean {
  const a = g.c.areas[area];
  if (!a || tx < 0 || ty < 0 || tx >= a.w || ty >= a.h) return false;
  const oi = g.rt.objAt[area]?.[ty * a.w + tx] ?? -1;
  if (oi < 0) return false;
  const o = a.objects[oi]!;
  const t = g.c.objects[o.type];
  const node = t?.node;
  return !!node && !node.regrow && !!node.tool && g.s.nodes[o.id] === undefined;
}

/** The result of one frame: where she ends, and whether a wall stopped her (for the "you need..." line). */
export const SLID = { x: 0, y: 0, bumpX: 0, bumpY: 0 };

/** One frame of walking from (x, y) by (dx, dy) tiles in an area. Fills SLID (no allocation). */
export function slide(g: Game, area: string, x: number, y: number, dx: number, dy: number): typeof SLID {
  SLID.bumpX = 0;
  SLID.bumpY = 0;
  if (dx) {
    if (free(g, area, x + dx, y, HALF)) x += dx;
    else if (!dy) {
      const step = Math.abs(dx);
      const sd = cornerSide(g, area, x, y, dx, 0);
      if (sd && free(g, area, x, y + sd * step, HALF)) y += sd * step;
      else SLID.bumpX = dx;
    }
  }
  if (dy) {
    if (free(g, area, x, y + dy, HALF)) y += dy;
    else if (!dx) {
      const step = Math.abs(dy);
      const sd = cornerSide(g, area, x, y, 0, dy);
      if (sd && free(g, area, x + sd * step, y, HALF)) x += sd * step;
      else SLID.bumpY = dy;
    }
  }
  SLID.x = x;
  SLID.y = y;
  return SLID;
}
