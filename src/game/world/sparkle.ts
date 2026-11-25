// The find sparkle in the world: twice a second it asks the rules for the nearest missing find within 10 tiles,
// and while there is one, a small twinkle rises from it now and then with a soft chime.
import { nearFind } from '../../core/finds.ts';
import type { Game } from '../../core/types.ts';
import { Sound } from '../audio.ts';
import type { Fx } from './fx.ts';

const T = 64;
const LOOK_EVERY = 0.5;
const TWINKLE_EVERY = 1.4;

export class FindSparkle {
  private lookT = 0;
  private twinkleT = 0;
  private at: { x: number; y: number } | null = null;

  update(g: Game, fx: Fx, dt: number, quiet: boolean): void {
    this.lookT -= dt;
    if (this.lookT <= 0) {
      this.lookT = LOOK_EVERY;
      const o = nearFind(g);
      this.at = o ? { x: o.x + 0.5, y: o.y + 0.3 } : null;
    }
    if (!this.at || quiet) return;
    this.twinkleT -= dt;
    if (this.twinkleT > 0) return;
    this.twinkleT = TWINKLE_EVERY;
    fx.burst('fx_star', this.at.x * T, this.at.y * T - 16, 3, [0xfff3b0, 0xffffff, 0xffd24a], 50, 0.8, {
      up: 60,
      scale: 0.4,
    });
    const d = Math.hypot(this.at.x - g.s.x, this.at.y - g.s.y);
    Sound.sfx('sparkle', Math.max(0.05, 0.35 * (1 - d / 10)));
  }
}
