import { afterEach, describe, expect, it, vi } from 'vitest';

const store = { getItem: (key: string) => (key === 'ws_save_1' ? 'older save' : null) };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('home copy availability', () => {
  it.each([
    ['offline', () => Promise.reject(new Error('offline'))],
    [
      'other JSON 404',
      () =>
        Promise.resolve(
          new Response('{"error":"other"}', { status: 404, headers: { 'content-type': 'application/json' } }),
        ),
    ],
    [
      'malformed JSON 404',
      () => Promise.resolve(new Response('{', { status: 404, headers: { 'content-type': 'application/json' } })),
    ],
    [
      'extra fields in JSON 404',
      () =>
        Promise.resolve(
          new Response('{"error":"none","detail":"other"}', {
            status: 404,
            headers: { 'content-type': 'application/json' },
          }),
        ),
    ],
    [
      'non-object JSON 404',
      () => Promise.resolve(new Response('null', { status: 404, headers: { 'content-type': 'application/json' } })),
    ],
    [
      'server error',
      () => Promise.resolve(new Response('{}', { status: 500, headers: { 'content-type': 'application/json' } })),
    ],
    [
      'missing route',
      () => Promise.resolve(new Response('not found', { status: 404, headers: { 'content-type': 'text/html' } })),
    ],
  ])('does not seed after %s', async (_description, reply) => {
    vi.stubGlobal('fetch', vi.fn(reply));
    const { homeFetch } = await import('../src/game/net.ts');
    const { seedHomeFrom } = await import('../src/game/save.ts');
    const send = vi.fn();
    expect(await seedHomeFrom(store, homeFetch, send)).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });

  it('seeds when the available server reports an empty slot', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response('{"error":"none"}', {
            status: 404,
            headers: { 'content-type': 'application/json' },
          }),
        ),
      ),
    );
    const { homeFetch } = await import('../src/game/net.ts');
    const { seedHomeFrom } = await import('../src/game/save.ts');
    const send = vi.fn();
    expect(await seedHomeFrom(store, homeFetch, send)).toEqual([1]);
    expect(send).toHaveBeenCalledWith(1, 'older save');
  });

  it('returns an existing disk save', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response('{"v":3}', {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        ),
      ),
    );
    const { homeFetch } = await import('../src/game/net.ts');
    expect(await homeFetch(1)).toBe('{"v":3}');
  });
});
