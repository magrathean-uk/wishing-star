// Issue 51: "Save and go to the title" leaves the game only once it is saved. In a story scene, or when the browser
// will not keep the save, the game stays open and the older save is untouched.
import { afterEach, expect, it, vi } from 'vitest';
import { newGame } from '../src/core/state.ts';
import { content } from '../src/data/content.ts';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

function browser(refuse = false) {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (refuse) throw new Error('QuotaExceededError');
      values.set(k, v);
    },
    removeItem: (k: string) => values.delete(k),
  });
  return values;
}
const game = () => {
  const g = newGame(content, { seed: 7, hero: 'amelia' });
  g.rt.mode = 'talk';
  g.s.emeralds = 40;
  return g;
};

it('saves and lets her leave in ordinary play', async () => {
  const values = browser();
  const { saveToLeave } = await import('../src/game/save.ts');
  expect(saveToLeave(game())).toBe('saved');
  expect(JSON.parse(values.get('ws_save_1')!).emeralds).toBe(40);
});

it('keeps her in the game during a story scene, without saving', async () => {
  const values = browser();
  const { saveToLeave } = await import('../src/game/save.ts');
  const g = game();
  g.rt.cut = { id: 'x' } as unknown as typeof g.rt.cut;
  expect(saveToLeave(g)).toBe('story');
  expect(values.size).toBe(0);
});

it('keeps her in the game when the browser refuses the save', async () => {
  browser(true);
  const { saveToLeave } = await import('../src/game/save.ts');
  expect(saveToLeave(game())).toBe('failed');
});
