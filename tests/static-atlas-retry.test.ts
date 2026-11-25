import { afterEach, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: {} }));
import { art, loadStaticAtlases, pumpUploads } from '../src/game/assets.ts';

afterEach(() => vi.unstubAllGlobals());

it('retries a failed static page and completes startup', async () => {
  const key = 'retry-test-page';
  art.atlas.items = [key];
  art.atlas.objects = [];
  art.atlas.ui = [];
  let attempts = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.endsWith('.webp') && ++attempts === 1) throw new Error('interrupted');
      return { ok: true, blob: async () => ({}), json: async () => ({}) };
    }),
  );
  vi.stubGlobal('createImageBitmap', async () => ({ width: 1, height: 1, close() {} }));
  const textures = {
    exists: () => false,
    addAtlas: () => undefined,
    get: () => ({ getFrameNames: () => [] }),
  };
  const scene = { sys: { game: {} }, textures } as never;
  let done = false;
  loadStaticAtlases(scene, () => {
    done = true;
  });
  for (let i = 0; i < 30; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    pumpUploads();
  }
  expect(attempts).toBe(2);
  expect(done).toBe(true);
});

it('reports a page that fails twice', async () => {
  art.atlas.items = ['permanent-failure-test-page'];
  let attempts = 0;
  vi.stubGlobal('fetch', async () => {
    attempts++;
    throw new Error('unavailable');
  });
  let result: boolean | undefined;
  loadStaticAtlases({} as never, (ok) => {
    result = ok;
  });
  for (let i = 0; i < 10 && result === undefined; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  expect(attempts).toBe(4);
  expect(result).toBe(false);
});
