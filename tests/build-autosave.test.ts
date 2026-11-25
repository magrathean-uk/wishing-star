// Issue 53: building is saved like play. The autosave clock runs in Build mode, and leaving Build mode after an edit
// saves at once, so a reload never undoes a stretch of building.
import { describe, expect, it, vi } from 'vitest';
import { canPlace } from '../src/core/build.ts';
import { load, serialize } from '../src/core/save.ts';
import { newGame } from '../src/core/state.ts';
import { NO_INPUT, step } from '../src/core/step.ts';
import type { Cmd, Game } from '../src/core/types.ts';
import { content } from '../src/data/content.ts';

/** A fresh game in free play in the cottage, its bag holding one kind of small thing that can go on the floor. */
function building(): { g: Game; item: string } {
  const g = newGame(content, { seed: 7, hero: 'amelia' });
  g.rt.mode = 'play';
  g.rt.talk = null;
  g.rt.q = [];
  g.s.quests = {};
  step(g, { ...NO_INPUT, cmd: { c: 'build', on: true } });
  const b = g.rt.build!;
  const item = Object.entries(content.items).find(
    ([id, d]) =>
      d.place &&
      d.place.where !== 'plot' &&
      d.place.layer === 'object' &&
      !d.place.solid &&
      (d.place.w ?? 1) === 1 &&
      (d.place.h ?? 1) === 1 &&
      canPlace(g, id, b.cx, b.cy) !== 'build_taken',
  )![0];
  g.s.bag.fill(null);
  g.s.bag[0] = { id: item, n: 6 };
  return { g, item };
}
const cmd = (g: Game, c: Cmd) => step(g, { ...NO_INPUT, cmd: c });
/** Steps the game and counts the saves it asks for. */
function frames(g: Game, n: number): number {
  let saves = 0;
  for (let i = 0; i < n; i++) {
    step(g, NO_INPUT);
    saves += g.ev.filter((e) => e.t === 'save').length;
    g.ev.length = 0;
  }
  return saves;
}

describe('saving while building', () => {
  it('asks for the autosave while Build mode stays open', () => {
    const { g } = building();
    expect(g.rt.mode).toBe('build');
    g.ev.length = 0;
    expect(frames(g, 61 * 60)).toBeGreaterThanOrEqual(1);
    expect(g.rt.mode).toBe('build');
  });

  it('asks for a save as soon as she leaves after an edit, and a second soon after', () => {
    const { g } = building();
    g.rt.saveT = 60;
    step(g, { ...NO_INPUT, act: true });
    expect(g.rt.saveDue).toBe(true);
    g.ev.length = 0;
    // no save while she is still building, short of the autosave
    expect(frames(g, 120)).toBe(0);
    cmd(g, { c: 'build', on: false });
    expect(g.rt.mode).toBe('play');
    expect(g.ev.filter((e) => e.t === 'save')).toHaveLength(1);
    // and once more within two seconds, in case the first came too soon after another save
    expect(g.rt.saveT).toBeLessThanOrEqual(2);
  });

  it('asks for no extra save when she leaves without changing anything', () => {
    const { g } = building();
    g.rt.saveT = 60;
    expect(g.rt.saveDue).toBe(false);
    g.ev.length = 0;
    cmd(g, { c: 'build', on: false });
    expect(g.ev.filter((e) => e.t === 'save')).toHaveLength(0);
    expect(g.rt.saveT).toBeGreaterThan(50);
  });

  it('a save made in Build mode holds the layout and the bag together', () => {
    const { g, item } = building();
    const b = g.rt.build!;
    for (const dx of [0, 1, 2]) {
      b.cx += dx ? 1 : 0;
      step(g, { ...NO_INPUT, act: true });
    }
    step(g, { ...NO_INPUT, back: true });
    const back = load(content, serialize(g));
    const placed = back.s.placed.filter((p) => p.item === item).length;
    const inBag = back.s.bag.reduce((n, sl) => n + (sl?.id === item ? sl.n : 0), 0);
    expect(placed).toBe(g.s.placed.filter((p) => p.item === item).length);
    expect(placed + inBag).toBe(6);
  });
});

describe('the browser save in Build mode', () => {
  it('writes an ordinary save while she builds', async () => {
    vi.resetModules();
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => values.get(k) ?? null,
      setItem: (k: string, v: string) => values.set(k, v),
      removeItem: (k: string) => values.delete(k),
    });
    const spy = vi.spyOn(performance, 'now').mockReturnValue(1e6);
    try {
      const { saveNow } = await import('../src/game/save.ts');
      const { g } = building();
      step(g, { ...NO_INPUT, act: true });
      expect(saveNow(g)).toBe(true);
      expect(JSON.parse(values.get('ws_save_1')!).placed.length).toBe(g.s.placed.length);
    } finally {
      spy.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});
