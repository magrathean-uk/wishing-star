import { beforeEach, expect, it, vi } from 'vitest';
import { newGame } from '../src/core/state.ts';
import { content } from '../src/data/content.ts';

const net = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('../src/game/net.ts', () => ({
  deviceId: () => 'test',
  fetchSave: vi.fn(),
  homeDelete: vi.fn(),
  homeDrop: vi.fn(),
  homeFetch: vi.fn(),
  homeFlush: vi.fn(),
  homeSend: net.send,
  resumeUploads: vi.fn(),
  upload: vi.fn(),
  uploads: {},
}));

beforeEach(() => {
  vi.resetModules();
  net.send.mockReset();
});

it('attempts the disk copy when browser storage is full and reports the local failure', async () => {
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
    removeItem: vi.fn(),
  });
  const { saveNow } = await import('../src/game/save.ts');
  const game = newGame(content, { seed: 7, hero: 'amelia' });
  game.rt.cut = null;
  game.rt.mode = 'play';
  expect(saveNow(game, true)).toBe(false);
  expect(net.send).toHaveBeenCalledOnce();
  expect(net.send.mock.calls[0]?.[0]).toBe(1);
  expect(JSON.parse(net.send.mock.calls[0]?.[1]).hero).toBe('amelia');
  expect(net.send.mock.calls[0]?.[2]).toBe(true);
});

it('saves locally and sends the disk copy on a forced save', async () => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  const { saveNow } = await import('../src/game/save.ts');
  const game = newGame(content, { seed: 7, hero: 'amelia' });
  game.rt.cut = null;
  game.rt.mode = 'play';
  expect(saveNow(game, true)).toBe(true);
  expect(net.send).toHaveBeenCalledOnce();
  expect(values.get('ws_save_1')).toBe(net.send.mock.calls[0]?.[1]);
});
