// Issue 11: when another tab of this browser takes the game over, the disk saves still waiting in the old tab are
// older than the new tab's game and must never land after its saves.
import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it('drops the waiting disk saves of an old tab when another tab takes over', async () => {
  const requests: { body?: string; finish: () => void }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((resolve) => {
          requests.push({
            body: init.body as string | undefined,
            finish: () => resolve(new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } })),
          });
        }),
    ),
  );
  let channel: { onmessage: ((e: { data: unknown }) => void) | null } | null = null;
  vi.stubGlobal(
    'BroadcastChannel',
    class {
      onmessage: ((e: { data: unknown }) => void) | null = null;
      constructor() {
        channel = this;
      }
      postMessage(): void {}
    },
  );
  // a hidden tab: it goes back to its title only when it is looked at again
  vi.stubGlobal('document', { title: 'Wishing Star', visibilityState: 'hidden', addEventListener: () => undefined });
  const { homeSend } = await import('../src/game/net.ts');
  await import('../src/game/save.ts');
  homeSend(1, 'day 6', true);
  homeSend(1, 'day 6 later', true);
  expect(requests.map((r) => r.body)).toEqual(['day 6']);
  channel!.onmessage!({ data: 'mine' });
  requests[0]!.finish();
  await new Promise((r) => setTimeout(r, 20));
  expect(requests.map((r) => r.body)).toEqual(['day 6']);
});
