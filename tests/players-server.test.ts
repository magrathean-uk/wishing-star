// Package 61 (D67): the play server's players mode, started for real on a spare port with a temporary data folder.
import { type ChildProcess, spawn } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SERVER = resolve(import.meta.dirname, '../tools/release/server.js');
const dir = mkdtempSync(join(tmpdir(), 'ws-players-'));
const data = join(dir, 'data');
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

async function start(players: boolean): Promise<string> {
  const port = await freePort();
  const env = { ...process.env, WS_PORT: String(port), WS_DATA: data, WS_TRUST_PROXY: '1' };
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
  return `http://127.0.0.1:${port}/`;
}
function stop(p: ChildProcess): Promise<void> {
  return new Promise((ok) => {
    p.once('exit', () => ok());
    p.kill('SIGTERM');
  });
}

let base = '';
const pw: Record<string, string> = {};
const json = (r: Response) => r.json() as Promise<Record<string, unknown>>;
// each call comes from its own address (through the trusted proxy header) unless one is given
let addr = 0;
const post = (path: string, body: unknown, from = `10.0.0.${++addr}`) =>
  fetch(base + path, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'X-Forwarded-For': `6.6.6.6, ${from}` },
  });
async function login(id: string, password: string): Promise<string> {
  const r = await post('api/login', { id, password });
  expect(r.status).toBe(200);
  return (await json(r)).token as string;
}
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

beforeAll(async () => {
  copyFileSync(SERVER, join(dir, 'server.js'));
  // players mode loads the shared place beside it (package 66)
  copyFileSync(resolve(import.meta.dirname, '../tools/release/room.js'), join(dir, 'room.js'));
  writeFileSync(join(dir, 'players-seed.json'), JSON.stringify({ heroPassword: '7777' }));
  mkdirSync(join(dir, 'game'));
  writeFileSync(join(dir, 'game', 'index.html'), '<!doctype html><title>t</title>');
  writeFileSync(join(dir, 'game', 'personal.json'), JSON.stringify({ greeting1: 'Hi', names: { amelia: 'Testy' } }));
  base = await start(true);
  for (const line of readFileSync(join(data, 'PASSWORDS.txt'), 'utf8').trim().split('\n')) {
    const [who, p] = line.split(': ');
    pw[who === 'Top of the list' ? 'hero' : `p${who!.replace('Player ', '')}`] = p!;
  }
}, 30000);
afterAll(async () => {
  await Promise.all(procs.filter((p) => p.exitCode === null).map(stop));
  rmSync(dir, { recursive: true, force: true });
});

describe('players mode', () => {
  it('makes the data files private, with child-friendly passwords', () => {
    expect(statSync(data).mode & 0o777).toBe(0o700);
    for (const f of ['players.json', 'PASSWORDS.txt']) expect(statSync(join(data, f)).mode & 0o777).toBe(0o600);
    expect(pw.hero).toBe('7777');
    for (let n = 1; n <= 10; n++) expect(pw[`p${n}`]).toMatch(/^[a-hjkmnp-z2-9]{4}$/);
    expect(readFileSync(join(data, 'players.json'), 'utf8')).not.toContain(pw.p1!);
  });

  it('lists the players by label only', async () => {
    const r = await fetch(`${base}api/players`);
    expect(r.headers.get('cache-control')).toBe('no-store');
    const text = await r.text();
    const list = (JSON.parse(text) as { players: { id: string; label: string }[] }).players;
    expect(list.map((p) => p.label)).toEqual(['Testy', ...Array.from({ length: 10 }, (_, i) => `Player ${i + 1}`)]);
    for (const p of Object.values(pw)) expect(text).not.toContain(`"${p}"`);
    expect(text).not.toMatch(/hash|salt|password/);
  });

  it('locks one client address after 5 wrong tries across players; tries during the lock do not lengthen it', async () => {
    const from = '10.1.1.1';
    const who = ['p9', 'p10', 'p8', 'p7'];
    for (let i = 0; i < 4; i++)
      expect((await post('api/login', { id: who[i], password: 'zzzz' }, from)).status).toBe(401);
    const r = await post('api/login', { id: 'p6', password: 'zzzz' }, from);
    expect(r.status).toBe(429);
    const first = (await json(r)).locked as number;
    expect(first).toBeGreaterThan(50);
    expect(first).toBeLessThanOrEqual(60);
    for (let i = 0; i < 8; i++) {
      const again = await post('api/login', { id: who[i % 4], password: 'zzzz' }, from);
      expect(again.status).toBe(429);
      expect((await json(again)).locked).toBeLessThanOrEqual(first);
    }
    expect((await post('api/login', { id: 'p9', password: pw.p9 }, from)).status).toBe(429);
    // the first address in the header is the client's own word and is not trusted
    expect((await post('api/login', { id: 'p9', password: pw.p9 }, '10.1.1.2')).status).toBe(200);
  }, 30000);

  it('judges one login at a time per player: 120 at once give no token, at most 4 are judged', async () => {
    const tries = Array.from({ length: 120 }, (_, i) => (i === 60 ? pw.hero! : `x${String(i).padStart(3, '0')}`));
    // sent in order, a millisecond apart, as a script would
    const res = await Promise.all(
      tries.map(
        (password, i) =>
          new Promise<Response>((done) =>
            setTimeout(() => done(post('api/login', { id: 'hero', password }, '10.2.2.2')), i),
          ),
      ),
    );
    const codes = res.map((r) => r.status);
    expect(codes.filter((c) => c === 200)).toEqual([]);
    expect(codes.filter((c) => c === 401).length).toBeLessThanOrEqual(4);
    expect(codes.filter((c) => c === 429).length).toBeGreaterThanOrEqual(116);
    expect(codes.every((c) => c === 401 || c === 429)).toBe(true);
  }, 30000);

  it('caps a player at 10 wrong tries a day, except on a known device; the count survives a restart', async () => {
    const r = await post('api/login', { id: 'p2', password: pw.p2 });
    expect(r.status).toBe(200);
    const device = (await json(r)).device as string;
    expect(device).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(readFileSync(join(data, 'devices.json'), 'utf8')).not.toContain(device);
    for (let i = 0; i < 10; i++) expect((await post('api/login', { id: 'p2', password: 'zzzz' })).status).toBe(401);
    const eleventh = await post('api/login', { id: 'p2', password: 'zzzz' });
    expect(eleventh.status).toBe(429);
    expect(await json(eleventh)).toMatchObject({ day: true });
    expect((await post('api/login', { id: 'p2', password: pw.p2 })).status).toBe(429);
    const ok = await post('api/login', { id: 'p2', password: pw.p2, device });
    expect(ok.status).toBe(200);
    expect((await json(ok)).device).toBe(device);
    expect(statSync(join(data, 'tries.json')).mode & 0o777).toBe(0o600);
    await stop(procs.at(-1)!);
    base = await start(true);
    expect((await post('api/login', { id: 'p2', password: pw.p2 })).status).toBe(429);
    expect((await post('api/login', { id: 'p2', password: pw.p2, device })).status).toBe(200);
    // a made-up key is not a known device
    expect((await post('api/login', { id: 'p2', password: pw.p2, device: 'a'.repeat(43) })).status).toBe(429);
  }, 60000);

  it('logs in, saves and loads a save, keeping the one before', async () => {
    const t = await login('p1', pw.p1!);
    expect((await fetch(`${base}api/save`, { headers: bearer(t) })).status).toBe(204);
    for (const n of [1, 2]) {
      const put = await fetch(`${base}api/save`, {
        method: 'PUT',
        headers: bearer(t),
        body: JSON.stringify({ n, dev: 'A', save: { day: n } }),
      });
      expect(put.status).toBe(200);
    }
    const r = await fetch(`${base}api/save`, { headers: bearer(t) });
    expect(await json(r)).toEqual({ n: 2, dev: 'A', save: { day: 2 } });
    expect(JSON.parse(readFileSync(join(data, 'saves', 'p1.prev.json'), 'utf8'))).toEqual({
      n: 1,
      dev: 'A',
      save: { day: 1 },
    });
    // an older copy (a counter not above the server's) does not replace it
    const old = await fetch(`${base}api/save`, {
      method: 'PUT',
      headers: bearer(t),
      body: '{"n":1,"dev":"A","save":{}}',
    });
    expect(old.status).toBe(409);
    expect((await fetch(`${base}api/logout`, { method: 'POST', headers: bearer(t) })).status).toBe(200);
    expect((await fetch(`${base}api/save`, { headers: bearer(t) })).status).toBe(401);
  });

  it('takes a save only from the copy it came from or the same device, and keeps daily copies', async () => {
    const t = await login('p10', pw.p10!);
    const put = (body: unknown) =>
      fetch(`${base}api/save`, { method: 'PUT', headers: bearer(t), body: JSON.stringify(body) });
    const saved = () => JSON.parse(readFileSync(join(data, 'saves', 'p10.json'), 'utf8'));
    const saves = join(data, 'saves');
    for (const d of ['2020-01-01', '2020-01-02', '2020-01-03', '2020-01-04', '2020-01-05', '2020-01-06', '2020-01-07'])
      writeFileSync(join(saves, `p10.${d}.json`), '{}');
    expect((await put({ save: {} })).status).toBe(400);
    expect((await put({ n: 1.5, save: {} })).status).toBe(400);
    expect((await put({ n: '3', save: {} })).status).toBe(400);
    expect((await put({ n: 30, dev: 'A', base: 0, save: { by: 'A30' } })).status).toBe(200);
    // device B synced at 30 and plays on
    expect((await put({ n: 31, dev: 'B', base: 30, save: { by: 'B31' } })).status).toBe(200);
    expect((await put({ n: 60, dev: 'B', base: 30, save: { by: 'B60' } })).status).toBe(200);
    // device A still at 30: refused, the server's save is unchanged
    const stale = await put({ n: 99, dev: 'A', base: 30, save: { by: 'A99' } });
    expect(stale.status).toBe(409);
    expect((await json(stale)).n).toBe(60);
    expect(saved().save).toEqual({ by: 'B60' });
    // the same device with a higher counter is accepted; a lower one is not
    expect((await put({ n: 59, dev: 'B', base: 30, save: { by: 'B59' } })).status).toBe(409);
    expect((await put({ n: 61, dev: 'B', base: 30, save: { by: 'B61' } })).status).toBe(200);
    // made from the server's own save: accepted from any device
    expect((await put({ n: 62, dev: 'A', base: 61, save: { by: 'A62' } })).status).toBe(200);
    expect(saved().save).toEqual({ by: 'A62' });
    const today = new Date().toISOString().slice(0, 10);
    const daily = readdirSync(saves)
      .filter((f) => /^p10\.\d{4}-\d\d-\d\d\.json$/.test(f))
      .sort();
    expect(daily).toHaveLength(7);
    expect(daily.at(-1)).toBe(`p10.${today}.json`);
    expect(daily[0]).toBe('p10.2020-01-02.json');
    // made once a day: the first accepted save of the day
    expect(JSON.parse(readFileSync(join(saves, `p10.${today}.json`), 'utf8')).save).toEqual({ by: 'A30' });
    expect(statSync(join(saves, `p10.${today}.json`)).mode & 0o777).toBe(0o600);
  });

  it("never lets a token reach another player's save", async () => {
    const t3 = await login('p3', pw.p3!);
    const t4 = await login('p4', pw.p4!);
    await fetch(`${base}api/save`, { method: 'PUT', headers: bearer(t3), body: '{"n":1,"mine":3}' });
    await fetch(`${base}api/save?id=p3`, { method: 'PUT', headers: bearer(t4), body: '{"n":5,"mine":4}' });
    expect(await json(await fetch(`${base}api/save?id=p4`, { headers: bearer(t3) }))).toEqual({ n: 1, mine: 3 });
    expect(await json(await fetch(`${base}api/save`, { headers: bearer(t4) }))).toEqual({ n: 5, mine: 4 });
    expect((await fetch(`${base}api/save`, { headers: bearer('x'.repeat(43)) })).status).toBe(401);
    expect((await fetch(`${base}api/save`)).status).toBe(401);
  });

  it('refuses odd ids, odd paths, odd methods and bad bodies', async () => {
    for (const id of ['../p1', 'p11', 'admin', '__proto__', 'constructor', '']) {
      expect((await post('api/login', { id, password: 'aaaa' })).status).toBe(400);
    }
    expect((await post('api/login', ['p1'])).status).toBe(400);
    expect((await fetch(`${base}api/../api/players`)).status).toBe(200); // the URL itself folds the ..
    expect((await fetch(`${base}api/%2e%2e/data/players.json`)).status).toBe(404);
    expect((await fetch(`${base}..%2fdata/players.json`)).status).toBe(403);
    expect((await fetch(`${base}api/constructor`)).status).toBe(404);
    expect((await fetch(`${base}api/nothing`)).status).toBe(404);
    expect((await fetch(`${base}api/players`, { method: 'DELETE' })).status).toBe(405);
    expect((await fetch(`${base}index.html`, { method: 'POST' })).status).toBe(405);
    const t = await login('p5', pw.p5!);
    const big = JSON.stringify({ n: 1, pad: 'x'.repeat(600 * 1024) });
    const r = await fetch(`${base}api/save`, { method: 'PUT', headers: bearer(t), body: big }).catch(() => null);
    expect(r === null || r.status === 413).toBe(true);
    for (const body of ['[1,2]', 'null', '"x"', '{nope']) {
      expect((await fetch(`${base}api/save`, { method: 'PUT', headers: bearer(t), body })).status).toBe(400);
    }
  });

  it("serves personal.json only with the hero's token", async () => {
    const tp = await login('p6', pw.p6!);
    const th = await login('hero', pw.hero!);
    for (const path of ['personal.json', 'Personal.JSON', '/personal.json', './personal.json', 'x/../personal.json']) {
      for (const headers of [{}, bearer(tp)]) {
        const r = await fetch(base + path, { headers });
        // '//personal.json' is read as another host's root, so it is the index page: never the file
        expect(await r.text()).not.toContain('Testy');
        if (path !== '/personal.json') expect(r.status).toBe(401);
      }
    }
    const r = await fetch(`${base}personal.json`, { headers: bearer(th) });
    expect(r.status).toBe(200);
    expect(((await json(r)).names as Record<string, string>).amelia).toBe('Testy');
    expect((await fetch(base)).status).toBe(200);
  });

  it('makes the files once: a second start changes nothing', async () => {
    const before = ['players.json', 'PASSWORDS.txt'].map((f) => readFileSync(join(data, f), 'utf8'));
    await stop(procs.at(-1)!);
    base = await start(true);
    const after = ['players.json', 'PASSWORDS.txt'].map((f) => readFileSync(join(data, f), 'utf8'));
    expect(after).toEqual(before);
    await login('p7', pw.p7!);
  }, 30000);

  it('a token survives a restart', async () => {
    const t = await login('p8', pw.p8!);
    await stop(procs.at(-1)!);
    base = await start(true);
    expect((await fetch(`${base}api/save`, { headers: bearer(t) })).status).toBe(204);
  }, 30000);
});

describe('no flag', () => {
  it('says "no players" to the one question, has no other api/, and serves personal.json as before', async () => {
    await Promise.all(procs.filter((p) => p.exitCode === null).map(stop));
    const home = await start(false);
    // the home copy answers the game's one question with an empty list (no 404 in the console), nothing else
    const r = await fetch(`${home}api/players`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ players: [] });
    expect((await fetch(`${home}api/save`)).status).toBe(404);
    expect((await fetch(`${home}api/login`, { method: 'POST', body: '{}' })).status).toBe(405);
    expect((await fetch(`${home}personal.json`)).status).toBe(200);
    await stop(procs.at(-1)!);
  }, 30000);
});
