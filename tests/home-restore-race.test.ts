import { describe, expect, it } from 'vitest';
import { serialize } from '../src/core/save.ts';
import { newGame } from '../src/core/state.ts';
import { content } from '../src/data/content.ts';
import { seedHomeFrom, takeBackInto } from '../src/game/save.ts';

function storage() {
  const entries = new Map<string, string>();
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, value);
    },
  };
}

function deferred() {
  let resolve!: (value: string | null) => void;
  const promise = new Promise<string | null>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const game = serialize(newGame(content, { hero: 'amelia', seed: 7 }));

describe('home copy while another tab saves', () => {
  it.each(['ws_save_1', 'ws_save_1_tmp', 'ws_save_1_prev'])('keeps a newly written %s', async (key) => {
    const store = storage();
    const pending = deferred();
    const restored = takeBackInto(content, store, (n) => (n === 1 ? pending.promise : Promise.resolve(null)));
    store.setItem(key, 'newer');
    pending.resolve(game);
    expect(await restored).toEqual([]);
    expect(store.getItem(key)).toBe('newer');
    if (key !== 'ws_save_1') expect(store.getItem('ws_save_1')).toBeNull();
  });

  it('restores into a slot that stays empty', async () => {
    const store = storage();
    const restored = await takeBackInto(content, store, (n) => Promise.resolve(n === 1 ? game : null));
    expect(restored).toEqual([1]);
    expect(store.getItem('ws_save_1')).toBe(game);
  });

  it('does not upload a stale browser copy when it changes during the check', async () => {
    const store = storage();
    store.setItem('ws_save_1', 'old');
    const pending = deferred();
    const sends: string[] = [];
    const seeded = seedHomeFrom(
      store,
      () => pending.promise,
      (_n, json) => sends.push(json),
    );
    store.setItem('ws_save_1', 'new');
    pending.resolve(null);
    expect(await seeded).toEqual([]);
    expect(sends).toEqual([]);
  });

  it('does not seed after a failed disk request', async () => {
    const store = storage();
    store.setItem('ws_save_1', 'old');
    const sends: string[] = [];
    const seeded = await seedHomeFrom(
      store,
      () => Promise.reject(new Error('offline')),
      (_n, json) => sends.push(json),
    );
    expect(seeded).toEqual([]);
    expect(sends).toEqual([]);
  });

  it('seeds an unchanged browser copy only when the disk has none', async () => {
    const store = storage();
    store.setItem('ws_save_1', 'old');
    store.setItem('ws_save_2', 'other');
    const sends: Array<[number, string]> = [];
    const seeded = await seedHomeFrom(
      store,
      (n) => Promise.resolve(n === 1 ? null : 'existing'),
      (n, json) => sends.push([n, json]),
    );
    expect(seeded).toEqual([1]);
    expect(sends).toEqual([[1, 'old']]);
  });
});
