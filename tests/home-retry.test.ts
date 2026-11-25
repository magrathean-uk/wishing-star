// Issue 16: a disk save the launcher refused is kept and tried again (on Save now at once, otherwise after the usual
// wait), and never replaces a newer save or a deletion waiting for the same slot.
import { afterEach, expect, it, vi } from 'vitest';
import { newGame } from '../src/core/state.ts';
import { content } from '../src/data/content.ts';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

/** A launcher that answers each request with the next status, then 200. */
function launcher(statuses: number[]) {
  const sent: { method: string; body?: string }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      sent.push({ method: init.method ?? 'GET', body: init.body as string | undefined });
      const status = statuses.shift() ?? 200;
      return new Response(status === 200 ? '{"ok":true}' : '{"error":"x"}', {
        status,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return sent;
}
const settle = () => new Promise((r) => setTimeout(r, 10));

it('sends the same game again on a second Save now after the launcher refused the first', async () => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => values.set(k, v),
    removeItem: (k: string) => values.delete(k),
  });
  const sent = launcher([500]);
  const { saveNow } = await import('../src/game/save.ts');
  const g = newGame(content, { seed: 7, hero: 'amelia' });
  g.rt.mode = 'play';
  expect(saveNow(g, true)).toBe(true);
  await settle();
  expect(sent.length).toBe(1);
  expect(saveNow(g, true)).toBe(true);
  await settle();
  expect(sent.map((s) => s.method)).toEqual(['PUT', 'PUT']);
  expect(sent[1]!.body).toBe(sent[0]!.body);
  // taken now: a third Save now with nothing new sends nothing
  expect(saveNow(g, true)).toBe(true);
  await settle();
  expect(sent.length).toBe(2);
});

it('tries a refused save again on its own after the wait, and also after no answer at all', async () => {
  vi.useFakeTimers();
  try {
    const sent = launcher([503]);
    const { homeSend } = await import('../src/game/net.ts');
    homeSend(1, 'day 5', true);
    await vi.advanceTimersByTimeAsync(10);
    expect(sent.length).toBe(1);
    await vi.advanceTimersByTimeAsync(21000);
    expect(sent.map((s) => s.body)).toEqual(['day 5', 'day 5']);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u: string, init: RequestInit) => {
        sent.push({ method: init.method ?? 'GET', body: init.body as string | undefined });
        throw new Error('no answer');
      }),
    );
    homeSend(2, 'day 6', true);
    await vi.advanceTimersByTimeAsync(10);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u: string, init: RequestInit) => {
        sent.push({ method: init.method ?? 'GET', body: init.body as string | undefined });
        return new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } });
      }),
    );
    await vi.advanceTimersByTimeAsync(21000);
    expect(sent.map((s) => s.body)).toEqual(['day 5', 'day 5', 'day 6', 'day 6']);
  } finally {
    vi.useRealTimers();
  }
});

it('never lets a refused save replace a newer one or a deletion of its slot', async () => {
  let finish!: (r: Response) => void;
  const sent: { method: string; body?: string }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((_u: string, init: RequestInit) => {
      sent.push({ method: init.method ?? 'GET', body: init.body as string | undefined });
      if (sent.length === 1) return new Promise<Response>((r) => (finish = r));
      return Promise.resolve(new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } }));
    }),
  );
  const { homeSend, homeDelete, homeFlush } = await import('../src/game/net.ts');
  homeSend(1, 'old', true);
  homeSend(1, 'new', true);
  homeSend(2, 'two', true);
  homeDelete(2);
  finish(new Response('{"error":"x"}', { status: 500, headers: { 'content-type': 'application/json' } }));
  await settle();
  homeFlush();
  await settle();
  expect(sent.map((s) => `${s.method} ${s.body ?? ''}`.trim())).toEqual(['PUT old', 'DELETE', 'PUT new']);
});
