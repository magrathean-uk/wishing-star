// A refused full screen request (Chrome: "not granted") never becomes an uncaught rejection.
import { describe, expect, it } from 'vitest';
import { quiet } from '../src/game/fullscreen.ts';

describe('quiet', () => {
  it('gives a rejection a handler and still hands back the same promise', async () => {
    const seen: unknown[] = [];
    const on = (r: unknown) => seen.push(r);
    process.on('unhandledRejection', on);
    const p = Promise.reject(new TypeError('not granted'));
    const f = quiet(() => p);
    expect(f()).toBe(p);
    await new Promise((r) => setTimeout(r, 20));
    process.off('unhandledRejection', on);
    expect(seen).toEqual([]);
    await expect(p).rejects.toThrow('not granted');
  });
  it('passes plain values and arguments through', () => {
    expect(quiet((a: number, b: number) => a + b)(2, 3)).toBe(5);
    expect(quiet(() => undefined)()).toBeUndefined();
  });
});
