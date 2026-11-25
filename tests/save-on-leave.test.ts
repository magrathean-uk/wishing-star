// Issue 52: when the page is hidden or closed, the game being played is saved at once (not held back by a save a
// moment ago), never in a story scene or a talk, and its disk copy is sent straight away.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { newGame } from '../src/core/state.ts';
import { content } from '../src/data/content.ts';

// a clock well past the page's first moments, standing still: two saves in a row are "a moment apart"
beforeEach(() => {
  vi.spyOn(performance, 'now').mockReturnValue(1e6);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

function browser() {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => values.set(k, v),
    removeItem: (k: string) => values.delete(k),
  });
  return values;
}
const playing = () => {
  const g = newGame(content, { seed: 7, hero: 'amelia' });
  g.rt.mode = 'play';
  return g;
};
const stored = (values: Map<string, string>) => JSON.parse(values.get('ws_save_1')!).emeralds as number;

it('saves play from just after an autosave, which an ordinary save would hold back', async () => {
  const values = browser();
  const { saveNow, saveOnLeave } = await import('../src/game/save.ts');
  const g = playing();
  expect(saveNow(g)).toBe(true);
  g.s.emeralds = 12;
  expect(saveNow(g)).toBe(false);
  expect(stored(values)).toBe(0);
  expect(saveOnLeave(g)).toBe(true);
  expect(stored(values)).toBe(12);
});

it('keeps the save from before a story scene or a talk', async () => {
  const values = browser();
  const { saveNow, saveOnLeave } = await import('../src/game/save.ts');
  const g = playing();
  saveNow(g);
  g.s.emeralds = 12;
  g.rt.cut = { id: 'x' } as unknown as typeof g.rt.cut;
  expect(saveOnLeave(g)).toBe(false);
  g.rt.cut = null;
  g.rt.mode = 'talk';
  expect(saveOnLeave(g)).toBe(false);
  expect(stored(values)).toBe(0);
});

it('saves the game first when the page goes, then sends its disk copy at once', async () => {
  const listeners: Record<string, () => void> = {};
  const on = (type: string, fn: () => void) => void (listeners[type] = fn);
  vi.stubGlobal('window', { addEventListener: on });
  vi.stubGlobal('document', { title: 'Wishing Star', visibilityState: 'visible', addEventListener: on });
  vi.stubGlobal(
    'BroadcastChannel',
    class {
      onmessage = null;
      postMessage(): void {}
    },
  );
  browser();
  const sent: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_u: string, init: RequestInit) => {
      sent.push(init.body as string);
      return new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } });
    }),
  );
  const { onLeave } = await import('../src/game/net.ts');
  const { saveNow, saveOnLeave } = await import('../src/game/save.ts');
  const g = playing();
  g.s.day = -1;
  saveNow(g);
  await new Promise((r) => setTimeout(r, 10));
  expect(sent.length).toBe(1);
  g.s.emeralds = 12;
  onLeave.save = () => saveOnLeave(g);
  listeners.pagehide!();
  await new Promise((r) => setTimeout(r, 10));
  expect(sent.length).toBe(2);
  expect(JSON.parse(sent[1]!).emeralds).toBe(12);
});
