// G (22 Nov 2026, on the iPad): the arrow must not jump about, and when the next story thing is inside a house the
// guide says to go in. The arrow's aim keeps the key it had while that key still gets her nearer (no one-aim blips),
// and the goal line says "Go into this house" by the door, "Go into <the place>" further off, and the doing inside.
import { describe, expect, it } from 'vitest';
import { goalLine, goInLine } from '../src/core/goal.ts';
import { guideOf, stepGuide } from '../src/core/guide.ts';
import { moveBody, WALK_SPEED } from '../src/core/hero.ts';
import { objective, stepTarget } from '../src/core/quests.ts';
import { newGame } from '../src/core/state.ts';
import type { Game } from '../src/core/types.ts';
import { content } from '../src/data/content.ts';

/** A game on one step of one quest, with her standing at (x, y) in an area. */
function at(qid: string, stepNo: number, area: string, x: number, y: number): Game {
  const g = newGame(content, { seed: 7, hero: 'amelia' });
  g.rt.mode = 'play';
  g.rt.talk = null;
  g.rt.cut = null;
  g.rt.card = null;
  g.rt.q = [];
  g.rt.spawnT = 1e9;
  for (const id of g.c.questOrder) g.s.quests[id] = { step: 0, n: 0, done: true };
  g.s.quests[qid] = { step: stepNo, n: 0, done: false };
  g.s.tracked = qid;
  g.s.area = area;
  g.s.x = g.rt.px = x;
  g.s.y = g.rt.py = y;
  g.rt.target = stepTarget(g, qid);
  stepGuide(g);
  return g;
}
const cottageDoor = content.areas.island!.doors.find((d) => d.to === 'cottage')!;

describe('a goal inside a house', () => {
  it('says the house by name when she is far from it, and points the way at its door', () => {
    // the prologue: talk to Mum, who is inside the cottage
    const g = at('prologue', 1, 'island', 84.5, 63.5);
    const gd = guideOf(g);
    expect(g.rt.target!.area).toBe('cottage');
    expect(gd.house).toBe(true);
    expect(gd.door).toMatchObject({
      x: cottageDoor.x,
      y: cottageDoor.y,
      to: 'cottage',
    });
    expect(gd.doorNear).toBe(false);
    expect(goalLine(g)!.text).toBe('Go into your cottage');
  });

  it('says "Go into this house" by the door, and the doing once she is inside', () => {
    const g = at('prologue', 1, 'island', cottageDoor.x + 0.5, cottageDoor.y + 2.5);
    expect(guideOf(g).doorNear).toBe(true);
    expect(goalLine(g)!.text).toBe('Go into this house');
    // a few steps back the line holds (no flicker at the edge)
    g.s.x += 8;
    stepGuide(g);
    expect(goalLine(g)!.text).toBe('Go into this house');
    g.s.x += 3;
    stepGuide(g);
    expect(goalLine(g)!.text).toBe('Go into your cottage');
    const inside = at('prologue', 1, 'cottage', 6.5, 7.5);
    expect(guideOf(inside).house).toBe(false);
    expect(goalLine(inside)!.text).toBe(objective(inside, 'prologue'));
  });

  it('keeps "Go home" for bed until she is at the door', () => {
    expect(goalLine(at('prologue', 7, 'island', 84.5, 63.5))!.text).toBe('Go home');
    expect(goalLine(at('prologue', 7, 'island', cottageDoor.x + 0.5, cottageDoor.y + 2.5))!.text).toBe(
      'Go into this house',
    );
  });

  it('names a place plainly, and the Mine or a cave even by the door', () => {
    const g = at('prologue', 1, 'island', 84.5, 63.5);
    expect(goInLine(g, 'vh1_in', false)).toBe("Go into the baker's house");
    expect(goInLine(g, 'peppa_in', false)).toBe("Go into Peppa's house");
    expect(goInLine(g, 'cafe_in', true)).toBe('Go into the cafe');
    expect(goInLine(g, 'mine1', true)).toBe('Go into the Mine');
    expect(goInLine(g, 'cave', false)).toBe('Go into the cave');
    expect(goInLine(g, 'nowhere', false)).toBe('Go into the house');
  });
});

describe('the arrow aim', () => {
  // walk by the arrow frame by frame, as a player holding the key nearest it; note the arrow's angle at every aim
  function walk(qid: string, stepNo: number, x: number, y: number, phase: number): { angs: number[]; area: string } {
    const g = at(qid, stepNo, 'island', x, y);
    const gd = guideOf(g);
    // (the frame the aims fall on changes the walk a little: try them all)
    gd.aimT += phase;
    const angs: number[] = [];
    for (let f = 0; f < 60 * 60 && g.s.area === 'island'; f++) {
      g.rt.target = stepTarget(g, qid);
      stepGuide(g);
      if (!gd.has) continue;
      const dx = gd.wx - g.s.x;
      const dy = gd.wy - g.s.y;
      if (gd.aimT === 8) angs.push((Math.atan2(dy, dx) * 180) / Math.PI);
      const mx = Math.abs(dx) >= Math.abs(dy) ? Math.sign(dx) : 0;
      const my = mx ? 0 : Math.sign(dy);
      moveBody(g, (mx * WALK_SPEED) / 60, (my * WALK_SPEED) / 60);
    }
    return { angs, area: g.s.area };
  }
  const turn = (a: number, b: number) => Math.abs(((b - a + 540) % 360) - 180);

  it('does not swing away for one aim and straight back, and still gets her there', () => {
    for (const [q, n, x, y, end] of [
      ['ch3', 25, 74.5, 77.5, 'workshop_in'],
      ['prologue', 1, 61.5, 60.5, 'cottage'],
      ['ch3', 25, 61.5, 60.5, 'workshop_in'],
    ] as const)
      for (let phase = 0; phase < 8; phase++) {
        const { angs, area } = walk(q, n, x, y, phase);
        expect(area).toBe(end);
        expect(angs.length).toBeGreaterThan(10);
        // the flicker G saw: a turn of more than 40 degrees for one aim, then back to within 10 of where it was
        const blips = angs.filter(
          (a, i) => i > 0 && i < angs.length - 1 && turn(angs[i - 1]!, a) > 40 && turn(angs[i - 1]!, angs[i + 1]!) < 10,
        );
        expect(blips, `${q} phase ${phase}`).toEqual([]);
      }
  });
});
