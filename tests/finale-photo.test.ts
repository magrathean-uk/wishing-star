// Issue 57: in the finale, a tap on the blank margin beside the photo picker keeps it open with her picks; only Back
// (X) skips the photo, and five picks still take it.
import { describe, expect, it } from 'vitest';
import { fakeUi } from './menu-harness.ts';
import { newGame } from '../src/core/state.ts';
import { content } from '../src/data/content.ts';

const { PhotoMenu } = await import('../src/game/ui/menus/misc.ts');

function metGame() {
  const g = newGame(content, { seed: 7, hero: 'amelia' });
  const friends = Object.keys(content.chars)
    .filter((id) => id !== 'amelia' && content.chars[id]!.role === 'walker')
    .slice(0, 8);
  g.s.met = Object.fromEntries(friends.map((id, i) => [id, i + 1]));
  return g;
}

describe('the finale photo picker', () => {
  it('a tap on the margin keeps it open, before any pick and after two', () => {
    const g = metGame();
    const { ui, step } = fakeUi(g);
    const m = new PhotoMenu(ui, true);
    expect(m.tap(20, 500)).toBe(true);
    step(m, {});
    expect(m.done).toBe(false);
    step(m, { act: true });
    step(m, { x: 1 });
    step(m, { act: true });
    expect((m as any).picked.size).toBe(2);
    m.tap(1900, 1060);
    step(m, {});
    expect(m.done).toBe(false);
    expect((m as any).picked.size).toBe(2);
  });

  it('Back skips the photo on purpose, and five picks take it', () => {
    const g = metGame();
    const skip = fakeUi(g);
    const a = new PhotoMenu(skip.ui, true);
    skip.step(a, { back: true });
    expect(a.done).toBe(true);
    expect(skip.sent).toEqual([]);

    const take = fakeUi(g);
    const b = new PhotoMenu(take.ui, true);
    for (let i = 0; i < 5; i++) {
      take.step(b, { act: true });
      if (i < 4) take.step(b, { x: 1 });
    }
    expect(b.done).toBe(true);
    expect(take.sent).toEqual([{ c: 'photo', friends: expect.any(Array) }]);
    expect((take.sent[0] as any).friends).toHaveLength(5);
  });

  it('away from the finale, a tap beside the panel still closes it, as in every menu', () => {
    const g = metGame();
    const { ui } = fakeUi(g);
    const m = new PhotoMenu(ui);
    m.tap(20, 500);
    expect(m.done).toBe(true);
  });
});
