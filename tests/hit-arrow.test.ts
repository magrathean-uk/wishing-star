// Package 86: the red edge arrow (UI.drawHit, package 78) points at what HIT her, and only that. A mob that merely
// notices her sends the same red mark, but no arrow may follow it from off screen.
import { describe, expect, it } from 'vitest';
import { rebuildArea } from '../src/core/grid.ts';
import { hurtHero } from '../src/core/hero.ts';
import { makeMob, stepMobs } from '../src/core/mobs.ts';
import { newGame } from '../src/core/state.ts';
import type { Game } from '../src/core/types.ts';
import { content } from '../src/data/content.ts';

const playing = (): Game => {
  const g = newGame(content, { seed: 3, hero: 'amelia' });
  g.rt.mode = 'play';
  g.rt.talk = null;
  g.rt.cut = null;
  g.rt.card = null;
  g.rt.q = [];
  g.rt.spawnT = 1e9;
  g.s.area = 'island';
  g.rt.mobs.length = 0;
  rebuildArea(g, 'island');
  g.s.x = g.rt.px = 80.5;
  g.s.y = g.rt.py = 64.5;
  return g;
};
const marks = (g: Game) => g.ev.filter((e) => e.t === 'fx' && e.id === 'warn');

describe('the hit arrow', () => {
  it('a hit sends one red mark at the one that hit her, flagged as a hit', () => {
    const g = playing();
    g.ev.length = 0;
    hurtHero(g, 2, 70, 60, { x: 71.5, y: 59.5 });
    expect(marks(g)).toEqual([{ t: 'fx', id: 'warn', x: 71.5, y: 59.5, item: 'hit' }]);
  });

  it('a mob that only notices her sends a red mark with no hit flag', () => {
    const g = playing();
    // a story mob, so daylight does not send it away; 7 tiles up is off the screen
    makeMob(g, 'zombie', 80.5, 64.5 - 7).tag = 'story';
    g.ev.length = 0;
    stepMobs(g);
    expect(marks(g).length).toBe(1);
    expect(marks(g).every((e) => e.t === 'fx' && e.item !== 'hit')).toBe(true);
  });
});
