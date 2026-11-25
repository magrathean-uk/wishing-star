// Keepy Uppy in the shared place (package 66): the balloon's arc from its last hit. The server (tools/release/room.js)
// owns the balloon and uses the same numbers; every browser draws the same arc from the last hit it was told about.
import type { BallCard } from './room.ts';

/** tiles a second a second (G in room.js) */
export const GRAV = 2.4;

export interface BallNow {
  /** the shadow on the grass, in tiles */
  x: number;
  y: number;
  /** height above the grass, in tiles */
  h: number;
}

/** Where the balloon is `t` seconds after its last hit. */
export function ballAt(b: BallCard, t: number, out: BallNow = { x: 0, y: 0, h: 0 }): BallNow {
  out.x = b.x0 + b.vx * t;
  out.y = b.y0 + b.vy * t;
  out.h = Math.max(0, b.h0 + b.vh * t - (GRAV * t * t) / 2);
  return out;
}
