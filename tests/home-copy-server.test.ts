// Package 80 (D87): the home copy's second copy of every save on disk, and the one address. The real server is started
// for real on a spare port with a temporary data folder (model: players-server.test.ts).
import { type ChildProcess, spawn } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SERVER = resolve(import.meta.dirname, '../tools/release/server.js');
const dir = mkdtempSync(join(tmpdir(), 'ws-home-'));
const data = join(dir, 'data');
const hist = join(data, 'home', 'history');
const procs: ChildProcess[] = [];

function freePort(): Promise<number> {
  return new Promise((done) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => done(p));
    });
  });
}
async function start(players: boolean, where: string): Promise<{ base: string; port: number }> {
  const port = await freePort();
  const env = { ...process.env, WS_PORT: String(port), WS_DATA: where, WS_TRUST_PROXY: '1' };
  const p = spawn(process.execPath, [join(dir, 'server.js'), ...(players ? ['--players'] : [])], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  procs.push(p);
  await new Promise<void>((ok, fail) => {
    let out = '';
    const t = setTimeout(() => fail(new Error(`server did not start: ${out}`)), 15000);
    const on = (d: Buffer) => {
      out += String(d);
      if (out.includes('is running at')) {
        clearTimeout(t);
        ok();
      }
    };
    p.stdout!.on('data', on);
    p.stderr!.on('data', on);
  });
  return { base: `http://127.0.0.1:${port}/`, port };
}
function stop(p: ChildProcess): Promise<void> {
  return new Promise((ok) => {
    p.once('exit', () => ok());
    p.kill('SIGTERM');
  });
}

let base = '';
let port = 0;
const save = (extra: Record<string, unknown> = {}) => JSON.stringify({ v: 3, hero: 'amelia', ...extra });
const put = (n: number | string, body: string) => fetch(`${base}api/home/save/${n}`, { method: 'PUT', body });
const get = (n: number | string) => fetch(`${base}api/home/save/${n}`);
const del = (n: number | string) => fetch(`${base}api/home/save/${n}`, { method: 'DELETE' });
const histFiles = (n: number) => readdirSync(hist).filter((f) => f.startsWith(`slot${n}-`));

beforeAll(async () => {
  copyFileSync(SERVER, join(dir, 'server.js'));
  copyFileSync(resolve(import.meta.dirname, '../tools/release/room.js'), join(dir, 'room.js'));
  writeFileSync(join(dir, 'players-seed.json'), JSON.stringify({ heroPassword: '7777' }));
  mkdirSync(join(dir, 'game'));
  writeFileSync(join(dir, 'game', 'index.html'), '<!doctype html><title>t</title>');
  ({ base, port } = await start(false, data));
}, 30000);
afterAll(async () => {
  await Promise.all(procs.filter((p) => p.exitCode === null).map(stop));
  rmSync(dir, { recursive: true, force: true });
});

describe('home copy: the second copy of a save', () => {
  it('has no copy at first: 404 with a JSON answer, and makes no folder yet', async () => {
    const r = await get(1);
    expect(r.status).toBe(404);
    expect(r.headers.get('content-type')).toContain('json');
    expect(await r.json()).toEqual({ error: 'none' });
    expect(existsSync(join(data, 'home'))).toBe(false);
  });

  it('reports a slot read failure without treating it as missing or changing it', async () => {
    const slot = join(data, 'home', 'slot2.json');
    mkdirSync(slot, { recursive: true });
    try {
      const r = await get(2);
      expect(r.status).toBe(500);
      expect(statSync(slot).isDirectory()).toBe(true);
    } finally {
      rmSync(slot, { recursive: true });
    }
  });

  it('PUT keeps a copy, GET gives it back exactly, files are private', async () => {
    const body = save({ day: 4 });
    expect((await put(1, body)).status).toBe(200);
    const r = await get(1);
    expect(r.status).toBe(200);
    expect(await r.text()).toBe(body);
    expect(readFileSync(join(data, 'home', 'slot1.json'), 'utf8')).toBe(body);
    expect(statSync(join(data, 'home')).mode & 0o777).toBe(0o700);
    expect(statSync(hist).mode & 0o777).toBe(0o700);
    expect(statSync(join(data, 'home', 'slot1.json')).mode & 0o777).toBe(0o600);
    // no temporary file is left behind
    expect(readdirSync(join(data, 'home')).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('refuses what is not a save, a bad slot and a body over 1 MB, and keeps the old copy', async () => {
    const before = readFileSync(join(data, 'home', 'slot1.json'), 'utf8');
    expect((await put(1, 'not json')).status).toBe(400);
    expect((await put(1, '[1,2]')).status).toBe(400);
    expect((await put(1, JSON.stringify({ hero: 'amelia' }))).status).toBe(400);
    expect((await put(1, JSON.stringify({ v: '3' }))).status).toBe(400);
    expect((await put(4, save())).status).toBe(404);
    expect((await put(0, save())).status).toBe(404);
    expect((await put('x', save())).status).toBe(404);
    const big = save({ pad: 'x'.repeat(1024 * 1024) });
    expect((await put(1, big)).status).toBe(413);
    // just under the limit goes in
    const ok = save({ pad: 'x'.repeat(1024 * 1024 - 100) });
    expect((await put(3, ok)).status).toBe(200);
    expect(readFileSync(join(data, 'home', 'slot1.json'), 'utf8')).toBe(before);
  });

  it('keeps at most one history file per slot in 10 minutes', async () => {
    expect(histFiles(1)).toHaveLength(1);
    for (let i = 0; i < 5; i++) expect((await put(1, save({ day: 5 + i }))).status).toBe(200);
    expect(histFiles(1)).toHaveLength(1);
    // the history file is the first save of the window: nothing newer overwrote it
    expect(readFileSync(join(hist, histFiles(1)[0]!), 'utf8')).toBe(save({ day: 4 }));
    expect(JSON.parse(await (await get(1)).text()).day).toBe(9);
  });

  it('thins the history to the newest 40 per slot, and leaves other slots alone', async () => {
    const stampOf = (i: number) => `2026010${1 + Math.floor(i / 24)}T${String(i % 24).padStart(2, '0')}0000Z`;
    for (let i = 0; i < 45; i++) writeFileSync(join(hist, `slot2-${stampOf(i)}.json`), save({ old: i }));
    writeFileSync(join(hist, 'slot3-20260101T000000Z.json'), save());
    expect((await put(2, save({ day: 1 }))).status).toBe(200);
    const files = histFiles(2).sort();
    expect(files).toHaveLength(40);
    // the oldest went; the new one (today) is the newest
    expect(files).not.toContain(`slot2-${stampOf(0)}.json`);
    expect(files).not.toContain(`slot2-${stampOf(5)}.json`);
    expect(files).toContain(`slot2-${stampOf(6)}.json`);
    expect(files.at(-1)).toMatch(/^slot2-2026112\d|^slot2-20[3-9]\d/);
    expect(existsSync(join(hist, 'slot3-20260101T000000Z.json'))).toBe(true);
  });

  it('DELETE moves the copy into history: nothing is destroyed, and it does not come back', async () => {
    const text = readFileSync(join(data, 'home', 'slot1.json'), 'utf8');
    expect((await del(1)).status).toBe(200);
    expect((await get(1)).status).toBe(404);
    expect(existsSync(join(data, 'home', 'slot1.json'))).toBe(false);
    const moved = histFiles(1).filter((f) => f.includes('deleted'));
    expect(moved).toHaveLength(1);
    expect(readFileSync(join(hist, moved[0]!), 'utf8')).toBe(text);
    expect((await del(1)).status).toBe(404);
    // a later save is a new copy again
    expect((await put(1, save({ day: 20 }))).status).toBe(200);
    expect((await get(1)).status).toBe(200);
  });

  it('only GET, PUT and DELETE; the game files are still served', async () => {
    expect((await fetch(`${base}api/home/save/1`, { method: 'POST', body: save() })).status).toBe(405);
    expect((await fetch(`${base}api/home/other`)).status).toBe(404);
    expect((await fetch(base)).status).toBe(200);
    expect((await (await fetch(`${base}api/players`)).json()).players).toEqual([]);
  });
});

describe('home copy: one address', () => {
  const ask = (host: string, path: string) =>
    new Promise<{ status: number; location: string | undefined }>((ok, fail) => {
      const r = request({ host: '127.0.0.1', port, path, headers: { Host: host } }, (res) => {
        res.resume();
        ok({ status: res.statusCode ?? 0, location: res.headers.location });
      });
      r.on('error', fail);
      r.end();
    });

  it('sends localhost on to 127.0.0.1 on the same port and path', async () => {
    expect(await ask(`localhost:${port}`, '/')).toEqual({ status: 302, location: `http://127.0.0.1:${port}/` });
    expect(await ask(`LocalHost:${port}`, '/a/b.html?x=1')).toEqual({
      status: 302,
      location: `http://127.0.0.1:${port}/a/b.html?x=1`,
    });
    expect((await ask(`localhost:${port}`, '/api/home/save/1')).status).toBe(302);
  });
  it('leaves 127.0.0.1 alone', async () => {
    expect((await ask(`127.0.0.1:${port}`, '/')).status).toBe(200);
  });
});

describe('players mode keeps its own saves and gets none of this', () => {
  it('has no home routes and no redirect, and makes no home folder', async () => {
    const where = join(dir, 'pdata');
    const p = await start(true, where);
    expect((await fetch(`${p.base}api/home/save/1`, { method: 'PUT', body: save() })).status).toBe(404);
    expect((await fetch(`${p.base}api/home/save/1`)).status).toBe(404);
    const r = await new Promise<number>((ok, fail) => {
      const q = request(
        { host: '127.0.0.1', port: p.port, path: '/', headers: { Host: `localhost:${p.port}` } },
        (res) => {
          res.resume();
          ok(res.statusCode ?? 0);
        },
      );
      q.on('error', fail);
      q.end();
    });
    expect(r).toBe(200);
    expect(existsSync(join(where, 'home'))).toBe(false);
  }, 30000);
});
