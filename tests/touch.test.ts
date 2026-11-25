// Package 65: the touch stick's directions. The stick gives the four arrow keys with a dead zone, and on the
// diagonal it keeps the held direction until the other axis clearly wins, so the hero never flickers between two.
import { describe, expect, it, vi } from 'vitest';
import { bestFood } from '../src/core/hero.ts';
import type { Game } from '../src/core/types.ts';

// the touch layer's page and game parts are not needed for the pure function under test
vi.mock('../src/core/hero.ts', () => ({ LOW_HP: 6, bestFood: vi.fn(() => 0) }));
vi.mock('phaser', () => ({ default: {} }));
vi.mock('../src/game/audio.ts', () => ({ Sound: {} }));
vi.mock('../src/game/input.ts', () => ({ touchState: { device: false, shown: false } }));
vi.mock('../src/game/ui/kit.ts', () => ({ drawn: { on: false }, W: 1920, H: 1080 }));
vi.mock('../src/game/ui/menus/map.ts', () => ({ MapMenu: class {} }));
vi.mock('../src/game/ui/menus/pause.ts', () => ({ PauseMenu: class {} }));
vi.mock('../src/game/ui/players.ts', () => ({ openCredit: () => undefined, typing: {} }));
vi.mock('../src/game/ui/slots.ts', () => ({ openSlotsPanel: () => null }));

const { fishWords, foodActionAvailable, miniWords, nearestRow, rowPick, stickDirection, worldTouchAction } =
  await import('../src/game/touch.ts');

describe('touch stick', () => {
  it('gives nothing inside the dead zone and the four arrows outside it', () => {
    expect(stickDirection(5, 5, '')).toBe('');
    expect(stickDirection(40, 0, '')).toBe('ArrowRight');
    expect(stickDirection(-40, 3, '')).toBe('ArrowLeft');
    expect(stickDirection(2, -40, '')).toBe('ArrowUp');
    expect(stickDirection(0, 40, '')).toBe('ArrowDown');
  });
  it('lets go a little closer to the middle than it starts', () => {
    expect(stickDirection(14, 0, '')).toBe('');
    expect(stickDirection(14, 0, 'ArrowRight')).toBe('ArrowRight');
    expect(stickDirection(8, 0, 'ArrowRight')).toBe('');
  });
  it('does not flicker on the diagonal', () => {
    // held right: a thumb just past the diagonal still walks right
    expect(stickDirection(30, 34, 'ArrowRight')).toBe('ArrowRight');
    expect(stickDirection(30, 44, 'ArrowRight')).toBe('ArrowDown');
    // held down: the same point keeps walking down
    expect(stickDirection(34, 30, 'ArrowDown')).toBe('ArrowDown');
    expect(stickDirection(44, 30, 'ArrowDown')).toBe('ArrowRight');
  });
});

describe('world touch action', () => {
  it('routes the food-only hint to eat and preserves the facing action when both hints are present', () => {
    expect(worldTouchAction('R: Eat', 'R: Eat')).toEqual({ word: 'Eat', code: 'KeyR' });
    expect(worldTouchAction('Talk    R: Eat', 'R: Eat')).toEqual({ word: 'Talk', code: 'Space' });
    expect(worldTouchAction('Talk', '')).toEqual({ word: 'Talk', code: 'Space' });
    expect(worldTouchAction('', '')).toEqual({ word: '', code: 'Space' });
  });
});

describe('food touch action eligibility', () => {
  it('rejects a stale hint after eating and other ineligible states', () => {
    const g = { rt: { mode: 'play', eatHint: true }, s: { hp: 2, maxHp: 8 } } as unknown as Game;
    expect(foodActionAvailable(g)).toBe(true);
    g.rt.eatHint = false;
    expect(foodActionAvailable(g)).toBe(false);
    g.rt.eatHint = true;
    g.s.hp = 8;
    expect(foodActionAvailable(g)).toBe(false);
    g.s.hp = 7;
    expect(foodActionAvailable(g)).toBe(false);
    g.s.hp = 2;
    vi.mocked(bestFood).mockReturnValueOnce(-1);
    expect(foodActionAvailable(g)).toBe(false);
    g.rt.mode = 'build';
    expect(foodActionAvailable(g)).toBe(false);
  });
});

describe('mini-game buttons', () => {
  it('say Go and Back on the start card and OK on the end card', () => {
    expect(miniWords(0, '{Space} Jump')).toEqual({ space: 'Go', x: 'Back' });
    expect(miniWords(2, '{Space} Jump')).toEqual({ space: 'OK', x: '' });
  });
  it("use the game's own words while it runs, and X only where it does something", () => {
    expect(miniWords(1, '{left}{right} Move   {Space} Hit')).toEqual({ space: 'Hit', x: '' });
    expect(miniWords(1, '{left}{right} Lean')).toEqual({ space: '', x: '' });
    // the targets shoot on X and on Space: one Shoot button, no Back that shoots
    expect(miniWords(1, '{up}{down}{left}{right} Walk   {X} Shoot')).toEqual({ space: 'Shoot', x: '' });
  });
});

describe('fishing buttons', () => {
  it('say Catch only while a fish bites, and Back on the small button', () => {
    const g = { rt: { mode: 'fishing', fish: { st: 1 } } } as unknown as Game;
    expect(fishWords(g)).toEqual({ space: '', x: 'Back' });
    g.rt.fish!.st = 2;
    expect(fishWords(g)).toEqual({ space: 'Catch', x: 'Back' });
    g.rt.mode = 'play';
    expect(fishWords(g)).toBeNull();
  });
});

describe('tap rows', () => {
  it('answer across the whole gap between rows, nearest first', () => {
    // rows 84 apart, 48 high: a tap 40 below a row still picks it, and the split is half way
    const c = [600, 684, 768];
    expect(nearestRow(c, 640, 48)).toBe(0);
    expect(nearestRow(c, 643, 48)).toBe(1);
    expect(nearestRow(c, 768 + 42, 48)).toBe(2);
    expect(nearestRow(c, 768 + 43, 48)).toBe(-1);
    expect(nearestRow(c, 600 - 43, 48)).toBe(-1);
  });
  it('keep at least the old reach around a row on its own', () => {
    expect(nearestRow([500], 500 + 32, 48)).toBe(0);
    expect(nearestRow([500], 500 + 33, 48)).toBe(-1);
  });
});

describe('number rows', () => {
  it('go down for a tap on the left half and up for the right half; other rows are picked', () => {
    expect(rowPick('▶ Music:  -   4 of 10   +', 900, 960)).toBe('ArrowLeft');
    expect(rowPick('Sound:  4 of 10', 1000, 960)).toBe('ArrowRight');
    expect(rowPick('Christmas:  Auto', 900, 960)).toBe('Space');
    expect(rowPick('Saved games', 1000, 960)).toBe('Space');
  });
});
