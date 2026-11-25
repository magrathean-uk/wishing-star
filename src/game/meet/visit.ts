// The visit (package 66): a game made only for the shared place. It runs the same rules as the story (walking, the
// swing, the trampoline, her emote) on content that holds the meadow alone: no quests, no scenes, no letters, no
// dens, so nothing can start. It is never saved and never touches the story save; it is thrown away on the way out.
import { DUSK_AT } from '../../core/cond.ts';
import { rebuildAll } from '../../core/grid.ts';
import { newGame } from '../../core/state.ts';
import type { AreaDef, Content, Game } from '../../core/types.ts';
import meet from '../../data/map/meet.json' with { type: 'json' };

export const MEET = meet as unknown as AreaDef;
/** Midday, always: no night in the shared place. */
export const NOON = DUSK_AT / 2;

/** The story's content with the meadow as its only area and nothing that could begin a story. */
export function visitContent(c: Content): Content {
  return {
    ...c,
    areas: { meet: MEET },
    quests: {},
    questOrder: [],
    cutscenes: {},
    letters: {},
    landmarks: {},
    dens: {},
    stalls: {},
  };
}

/** A fresh visit as `hero`, standing at (x, y) in the meadow. */
export function visitGame(c: Content, hero: string, xmas: boolean, x: number, y: number): Game {
  const g = newGame(visitContent(c), { hero, xmas });
  const s = g.s;
  s.area = 'meet';
  s.x = x;
  s.y = y;
  s.dir = 'down';
  s.time = NOON;
  s.placed = [];
  s.animals = [];
  g.rt.px = x;
  g.rt.py = y;
  rebuildAll(g);
  g.rt.npcs = [];
  g.rt.mobs = [];
  return g;
}

/** After every step: still midday, still in play, full hearts, nobody else from the story about. */
export function keepVisit(g: Game): void {
  const s = g.s;
  const rt = g.rt;
  s.time = NOON;
  s.hp = s.maxHp;
  if (rt.mode !== 'play' && rt.mode !== 'mini') {
    rt.mode = 'play';
    rt.cut = null;
    rt.talk = null;
    rt.card = null;
  }
  if (rt.npcs.length) rt.npcs = [];
  if (rt.mobs.length) rt.mobs = [];
  if (s.area !== 'meet') {
    s.area = 'meet';
    s.x = rt.px;
    s.y = rt.py;
  }
}
