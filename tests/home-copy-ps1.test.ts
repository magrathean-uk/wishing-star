// Package 81 (D87): the Windows launcher's server (tools/release/play-server.ps1) keeps the second copy of every save
// too. The same cases as home-copy-server.test.ts, run against the real script under pwsh (PowerShell 7 on this Mac;
// the laptop has Windows PowerShell 5.1, which this cannot prove). Skipped when pwsh is not installed.
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SCRIPT = resolve(import.meta.dirname, '../tools/release/play-server.ps1');
const PWSH = ['/opt/homebrew/bin/pwsh', '/usr/local/bin/pwsh', 'pwsh'].find(
  (p) => spawnSync(p, ['-NoProfile', '-Command', '1'], { stdio: 'ignore' }).status === 0,
);
if (!PWSH) console.warn('home-copy-ps1: pwsh is not installed, so the Windows server tests are skipped');
const PORT = 4208;
const dir = mkdtempSync(join(tmpdir(), 'ws-home-ps1-'));
const data = join(dir, 'data');
const hist = join(data, 'home', 'history');
let proc: ChildProcess | undefined;
const base = `http://127.0.0.1:${PORT}/`;

const save = (extra: Record<string, unknown> = {}) => JSON.stringify({ v: 3, hero: 'amelia', ...extra });
const put = (n: number | string, body: string) => fetch(`${base}api/home/save/${n}`, { method: 'PUT', body });
const get = (n: number | string) => fetch(`${base}api/home/save/${n}`);
const del = (n: number | string) => fetch(`${base}api/home/save/${n}`, { method: 'DELETE' });
const histFiles = (n: number) => readdirSync(hist).filter((f) => f.startsWith(`slot${n}-`));
const slotFile = (n: number) => join(data, 'home', `slot${n}.json`);

beforeAll(async () => {
  if (!PWSH) return;
  copyFileSync(SCRIPT, join(dir, 'play-server.ps1'));
  mkdirSync(join(dir, 'game'));
  writeFileSync(join(dir, 'game', 'index.html'), '<!doctype html><title>t</title>');
  proc = spawn(PWSH, ['-NoProfile', '-File', join(dir, 'play-server.ps1'), '-Port', String(PORT), '-NoBrowser'], {
    env: { ...process.env, WS_DATA: data },
    stdio: 'ignore',
  });
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(base)).status === 200) return;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw new Error('the PowerShell server did not start on port 4208');
}, 30000);
afterAll(async () => {
  if (proc && proc.exitCode === null) {
    await new Promise<void>((ok) => {
      proc!.once('exit', () => ok());
      proc!.kill('SIGTERM');
    });
  }
  rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(!PWSH)('play-server.ps1: the second copy of a save', () => {
  it('has no copy at first: 404 with the JSON answer, and makes no folder yet', async () => {
    const r = await get(1);
    expect(r.status).toBe(404);
    expect(r.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(await r.text()).toBe('{"error":"none"}');
    expect(existsSync(join(data, 'home'))).toBe(false);
  });

  it('PUT keeps a copy, GET gives back exactly the bytes sent (UTF-8, no BOM, no re-serialising)', async () => {
    const body = ` ${save({ day: 4, word: 'café ✓', n: 1.0 })}\n`;
    const r0 = await put(1, body);
    expect(r0.status).toBe(200);
    expect(await r0.text()).toBe('{"ok":true}');
    const r = await get(1);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(Buffer.from(await r.arrayBuffer()).equals(Buffer.from(body, 'utf8'))).toBe(true);
    expect(readFileSync(slotFile(1)).equals(Buffer.from(body, 'utf8'))).toBe(true);
    // no temporary file is left behind
    expect(readdirSync(join(data, 'home')).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('refuses what is not a save, a bad slot and a body over 1 MB, and keeps the old copy', async () => {
    const before = readFileSync(slotFile(1), 'utf8');
    for (const bad of [
      'not json',
      '[1,2]',
      '[{"v":1}]',
      '',
      '{}',
      JSON.stringify({ hero: 'amelia' }),
      '{"v":"3"}',
      '{"v":true}',
      '{"V":3}',
      '\u{feff}{"v":3}',
    ]) {
      const r = await put(1, bad);
      expect(r.status, `body ${JSON.stringify(bad)}`).toBe(400);
      expect(await r.text()).toBe('{"error":"not a save"}');
    }
    expect((await put(4, save())).status).toBe(404);
    expect((await put(0, save())).status).toBe(404);
    expect((await put('x', save())).status).toBe(404);
    const big = save({ pad: 'x'.repeat(1024 * 1024) });
    expect((await put(1, big)).status).toBe(413);
    // just under the limit goes in
    const ok = save({ pad: 'x'.repeat(1024 * 1024 - 100) });
    expect((await put(3, ok)).status).toBe(200);
    expect(readFileSync(slotFile(3), 'utf8')).toBe(ok);
    expect(readFileSync(slotFile(1), 'utf8')).toBe(before);
  });

  it('keeps at most one history file per slot in 10 minutes', async () => {
    expect(histFiles(1)).toHaveLength(1);
    const first = readFileSync(join(hist, histFiles(1)[0]!), 'utf8');
    for (let i = 0; i < 5; i++) expect((await put(1, save({ day: 5 + i }))).status).toBe(200);
    expect(histFiles(1)).toHaveLength(1);
    // the history file is the first save of the window: nothing newer overwrote it
    expect(readFileSync(join(hist, histFiles(1)[0]!), 'utf8')).toBe(first);
    expect(JSON.parse(await (await get(1)).text()).day).toBe(9);
  });

  it('thins the history to the newest 40 per slot, and leaves other slots alone', async () => {
    const stampOf = (i: number) => `2026010${1 + Math.floor(i / 24)}T${String(i % 24).padStart(2, '0')}0000Z`;
    for (let i = 0; i < 45; i++) writeFileSync(join(hist, `slot2-${stampOf(i)}.json`), save({ old: i }));
    writeFileSync(join(hist, 'slot3-20260101T000000Z.json'), save());
    expect((await put(2, save({ day: 1 }))).status).toBe(200);
    const files = histFiles(2).sort();
    expect(files).toHaveLength(40);
    expect(files).not.toContain(`slot2-${stampOf(0)}.json`);
    expect(files).not.toContain(`slot2-${stampOf(5)}.json`);
    expect(files).toContain(`slot2-${stampOf(6)}.json`);
    expect(files.at(-1)).toMatch(/^slot2-20(2[7-9]|[3-9]\d|261[12])/);
    expect(existsSync(join(hist, 'slot3-20260101T000000Z.json'))).toBe(true);
  });

  it('DELETE moves the copy into history: nothing is destroyed, and it does not come back', async () => {
    const text = readFileSync(slotFile(1), 'utf8');
    const r = await del(1);
    expect(r.status).toBe(200);
    expect(await r.text()).toBe('{"ok":true}');
    const gone = await get(1);
    expect(gone.status).toBe(404);
    expect(existsSync(slotFile(1))).toBe(false);
    const moved = histFiles(1).filter((f) => f.includes('deleted'));
    expect(moved).toHaveLength(1);
    expect(moved[0]).toMatch(/^slot1-\d{8}T\d{6}Z-deleted\.json$/);
    expect(readFileSync(join(hist, moved[0]!), 'utf8')).toBe(text);
    const again = await del(1);
    expect(again.status).toBe(404);
    expect(await again.text()).toBe('{"error":"none"}');
    // a later save is a new copy again
    expect((await put(1, save({ day: 20 }))).status).toBe(200);
    expect((await get(1)).status).toBe(200);
  });

  it('only GET, PUT and DELETE; other /api/home/ paths are 404; the game files are still served', async () => {
    const post = await fetch(`${base}api/home/save/1`, { method: 'POST', body: save() });
    expect(post.status).toBe(405);
    expect(post.headers.get('content-type')).toContain('json');
    expect((await fetch(`${base}api/home/other`)).status).toBe(404);
    expect((await fetch(`${base}api/home/save/4`)).status).toBe(404);
    expect((await fetch(base)).status).toBe(200);
    expect((await fetch(`${base}index.html`, { method: 'POST', body: 'x' })).status).toBe(405);
  });

  it('answers many saves at once without losing the newest', async () => {
    const rs = await Promise.all(Array.from({ length: 12 }, (_, i) => put(3, save({ n: i }))));
    expect(rs.map((r) => r.status)).toEqual(Array(12).fill(200));
    expect(typeof JSON.parse(await (await get(3)).text()).n).toBe('number');
    expect(readdirSync(join(data, 'home')).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });
});

describe.skipIf(!PWSH)('play-server.ps1: one address', () => {
  const ask = (host: string, path: string, method = 'GET') =>
    new Promise<{ status: number; location: string | undefined }>((ok, fail) => {
      const r = request({ host: '127.0.0.1', port: PORT, path, method, headers: { Host: host } }, (res) => {
        res.resume();
        ok({ status: res.statusCode ?? 0, location: res.headers.location });
      });
      r.on('error', fail);
      r.end();
    });

  it('sends localhost on to 127.0.0.1 on the same port, path and query', async () => {
    expect(await ask(`localhost:${PORT}`, '/')).toEqual({ status: 302, location: `http://127.0.0.1:${PORT}/` });
    expect(await ask(`LocalHost:${PORT}`, '/a/b.html?x=1')).toEqual({
      status: 302,
      location: `http://127.0.0.1:${PORT}/a/b.html?x=1`,
    });
    expect((await ask(`localhost:${PORT}`, '/api/home/save/1')).status).toBe(302);
    expect((await ask(`localhost:${PORT}`, '/api/home/save/1', 'PUT')).status).toBe(302);
    // no port in Host: the port the server listens on
    expect((await ask('localhost', '/x')).location).toBe(`http://127.0.0.1:${PORT}/x`);
  });
  it('leaves 127.0.0.1 alone', async () => {
    expect((await ask(`127.0.0.1:${PORT}`, '/')).status).toBe(200);
  });
});
