import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it('waits for an in-flight save before deleting and sends a later save after the deletion', async () => {
  const requests: { method: string; body?: string; finish: () => void }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((resolve) => {
          requests.push({
            method: init.method!,
            body: init.body as string | undefined,
            finish: () => resolve(new Response('{}', { headers: { 'content-type': 'application/json' } })),
          });
        }),
    ),
  );
  const { homeSend, homeDelete } = await import('../src/game/net.ts');
  homeSend(1, 'old', true);
  homeSend(1, 'superseded', true);
  homeDelete(1);
  homeSend(1, 'new', true);
  expect(requests.map((r) => r.method)).toEqual(['PUT']);
  requests[0]!.finish();
  await vi.waitFor(() => expect(requests.map((r) => r.method)).toEqual(['PUT', 'DELETE']));
  requests[1]!.finish();
  await vi.waitFor(() => expect(requests.map((r) => r.method)).toEqual(['PUT', 'DELETE', 'PUT']));
  expect(requests[2]!.body).toBe('new');
  requests[2]!.finish();
});
