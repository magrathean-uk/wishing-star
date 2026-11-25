import { beforeEach, describe, expect, it, vi } from 'vitest';
import { serialize } from '../src/core/save.ts';
import { newGame } from '../src/core/state.ts';
import { content } from '../src/data/content.ts';
import { loadSlot, readSlot, slotInfo, usePlayer } from '../src/game/save.ts';

const saved = (day: number) => {
  const game = newGame(content, { hero: 'bluey', seed: 7 });
  game.s.day = day;
  return serialize(game);
};

describe('browser save recovery', () => {
  let values: Map<string, string>;
  beforeEach(() => {
    values = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    usePlayer('');
  });

  it.each([
    ['temporary copy', null, saved(6), null, 6],
    ['corrupt current', 'broken', null, saved(4), 4],
    ['invalid current', '{}', null, saved(4), 4],
    ['current first', saved(8), saved(6), saved(4), 8],
    ['temporary before previous', 'broken', saved(6), saved(4), 6],
  ])('%s uses one loadable copy for display, export and play', (_label, current, temporary, previous, day) => {
    if (current) values.set('ws_save_1', current);
    if (temporary) values.set('ws_save_1_tmp', temporary);
    if (previous) values.set('ws_save_1_prev', previous);
    expect(slotInfo(content, 1)?.day).toBe(day);
    expect(JSON.parse(readSlot(1)!).day).toBe(day);
    expect(loadSlot(content, 1, {}, false)?.s.day).toBe(day);
  });

  it('loads an older save from the previous copy', () => {
    const old = JSON.parse(saved(4));
    old.v = 1;
    delete old.cs;
    delete old.houseSize;
    delete old.pets;
    values.set('ws_save_1', 'broken');
    values.set('ws_save_1_prev', JSON.stringify(old));
    expect(slotInfo(content, 1)?.day).toBe(4);
    expect(JSON.parse(readSlot(1)!).v).toBe(1);
    expect(loadSlot(content, 1, {}, false)?.s.day).toBe(4);
  });

  it('treats a slot with no loadable copies as empty', () => {
    values.set('ws_save_1', '{}');
    values.set('ws_save_1_tmp', 'bad');
    values.set('ws_save_1_prev', '{}');
    expect(slotInfo(content, 1)).toBeNull();
    expect(readSlot(1)).toBeNull();
    expect(loadSlot(content, 1, {}, false)).toBeNull();
  });
});
