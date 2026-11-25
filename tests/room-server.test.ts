// Package 66 (D71): the shared place's WebSocket (tools/release/room.js), started for real with a temporary data folder
// and spoken to with Node's own WebSocket. Raw frames go over a plain TCP socket where a browser could not send them.
import { type ChildProcess, spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { connect, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const REL = resolve(import.meta.dirname, '../tools/release');
const dir = mkdtempSync(join(tmpdir(), 'ws-room-'));
const data = join(dir, 'data');
const procs: ChildProcess[] = [];
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

interface Numbers {
  AREA: { x0: number; y0: number; x1: number; y1: number };
  START: { x: number; y: number };
  STAND: { x: number; y: number };
  LAWN: { x0: number; y0: number; x1: number; y1: number };
  RACE_START: { x0: number; y0: number; x1: number; y1: number };
  RACE_FINISH_X: number;
  G: number;
  UP: number;
}
// the repo's package.json says ES modules, so the room (CommonJS, like the program it is packed into) is read from
// the temporary folder, where it also runs beside its server
copyFileSync(join(REL, 'room.js'), join(dir, 'room.js'));
const room = createRequire(join(dir, 'x.js'))('./room.js')._ as Numbers;

function freePort(): Promise<number> {
  return new Promise((done) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => done(p));
    });
  });
}
async function start(players: boolean, env: Record<string, string> = {}): Promise<number> {
  const port = await freePort();
  const p = spawn(process.execPath, [join(dir, 'server.js'), ...(players ? ['--players'] : [])], {
    env: { ...process.env, WS_PORT: String(port), WS_DATA: data, WS_TRUST_PROXY: '1', ...env },
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
  return port;
}

let port = 0;
const pw: Record<string, string> = {};
const tokens: Record<string, string> = {};
let addr = 0;
async function login(id: string): Promise<string> {
  const r = await fetch(`http://127.0.0.1:${port}/api/login`, {
    method: 'POST',
    body: JSON.stringify({ id, password: pw[id] }),
    headers: { 'X-Forwarded-For': `10.9.0.${++addr}` },
  });
  expect(r.status).toBe(200);
  return ((await r.json()) as { token: string }).token;
}

type Msg = Record<string, unknown> & { t: string };
/** A player's socket: every message kept, waits for one that matches, and the close code. */
class Client {
  ws: WebSocket;
  msgs: Msg[] = [];
  code = -1;
  /** where the server has this player (from the welcome and every fix) */
  pos = { x: 0, y: 0 };
  closed: Promise<number>;
  private wake: (() => void)[] = [];
  constructor(p = port) {
    this.ws = new WebSocket(`ws://127.0.0.1:${p}/api/room`);
    this.ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data)) as Msg;
      this.msgs.push(m);
      if (m.t === 'welcome' || m.t === 'fix') this.pos = { x: m.x as number, y: m.y as number };
      for (const w of this.wake.splice(0)) w();
    };
    this.closed = new Promise((ok) => {
      this.ws.onclose = (e) => {
        this.code = e.code;
        for (const w of this.wake.splice(0)) w();
        ok(e.code);
      };
    });
  }
  open(): Promise<void> {
    return new Promise((ok, fail) => {
      if (this.ws.readyState === WebSocket.OPEN) return ok();
      this.ws.onopen = () => ok();
      this.ws.onerror = () => fail(new Error('no socket'));
    });
  }
  send(m: unknown): void {
    this.ws.send(typeof m === 'string' ? m : JSON.stringify(m));
  }
  /** The first message (from `from` on) that passes `f`, or null after `ms`. */
  async wait(f: (m: Msg) => boolean, ms = 3000, from = 0): Promise<Msg | null> {
    const end = Date.now() + ms;
    for (;;) {
      const hit = this.msgs.slice(from).find(f);
      if (hit) return hit;
      if (Date.now() >= end || this.code >= 0) return null;
      await new Promise<void>((ok) => {
        this.wake.push(ok);
        setTimeout(ok, Math.max(1, end - Date.now()));
      });
    }
  }
  close(): void {
    this.ws.close();
  }
}
/** A player in the room, welcomed. */
async function enter(id: string, hero = 'bluey'): Promise<Client> {
  const c = new Client();
  await c.open();
  c.send({ t: 'hi', token: tokens[id], hero });
  expect(await c.wait((m) => m.t === 'welcome')).not.toBeNull();
  return c;
}
const open: Client[] = [];
async function player(id: string, hero?: string): Promise<Client> {
  const c = await enter(id, hero);
  open.push(c);
  return c;
}
function leaveAll(): void {
  for (const c of open.splice(0)) c.close();
}
const today = () => new Date().toISOString().slice(0, 10);
const logText = () => {
  try {
    return readFileSync(join(data, `chat-${today()}.log`), 'utf8');
  } catch {
    return '';
  }
};
/** Walk to a place in steps a walker could make (the server allows 6 tiles a second; this is 5.5). */
async function walk(c: Client, x: number, y: number): Promise<void> {
  const from = { ...c.pos };
  const n = Math.ceil(Math.hypot(x - from.x, y - from.y) / 0.6);
  for (let i = 1; i <= n; i++) {
    c.send({ t: 'mv', x: from.x + ((x - from.x) * i) / n, y: from.y + ((y - from.y) * i) / n, d: 'down', c: 'walk' });
    await sleep(110);
  }
  c.pos = { x, y };
}

beforeAll(async () => {
  copyFileSync(join(REL, 'server.js'), join(dir, 'server.js'));
  copyFileSync(join(REL, 'room.js'), join(dir, 'room.js'));
  writeFileSync(join(dir, 'players-seed.json'), JSON.stringify({ heroPassword: '7777' }));
  mkdirSync(join(dir, 'game'));
  writeFileSync(join(dir, 'game', 'index.html'), '<!doctype html><title>t</title>');
  writeFileSync(join(dir, 'game', 'personal.json'), JSON.stringify({ names: { amelia: 'Testy' }, letter: 'secret' }));
  port = await start(true);
  for (const line of readFileSync(join(data, 'PASSWORDS.txt'), 'utf8').trim().split('\n')) {
    const [who, p] = line.split(': ');
    pw[who === 'Top of the list' ? 'hero' : `p${who!.replace('Player ', '')}`] = p!;
  }
  for (const id of ['hero', 'p1', 'p2', 'p3', 'p4', 'p5']) tokens[id] = await login(id);
}, 30000);
afterAll(async () => {
  leaveAll();
  await Promise.all(
    procs
      .filter((p) => p.exitCode === null)
      .map(
        (p) =>
          new Promise<void>((ok) => {
            p.once('exit', () => ok());
            p.kill('SIGTERM');
          }),
      ),
  );
  rmSync(dir, { recursive: true, force: true });
});

describe('the shared place: the wire', () => {
  it('closes a socket that never says who it is (5 s), and one with a wrong token', async () => {
    const quiet = new Client();
    await quiet.open();
    const wrong = new Client();
    await wrong.open();
    wrong.send({ t: 'hi', token: 'x'.repeat(43), hero: 'bluey' });
    expect(await wrong.closed).toBe(4003);
    expect(wrong.msgs).toEqual([]);
    const t0 = Date.now();
    expect(await quiet.closed).toBe(4001);
    expect(Date.now() - t0).toBeGreaterThan(3500);
    expect(quiet.msgs).toEqual([]);
  }, 10000);

  it('closes a socket for a message over 512 bytes, and for one that is not JSON', async () => {
    const big = await enter('p1');
    big.send({ t: 'say', text: 'a'.repeat(600) });
    expect(await big.closed).toBe(1009);
    const broken = await enter('p1');
    broken.send('{not json');
    expect(await broken.closed).toBe(1007);
  });

  it('closes a socket that sends more than 15 messages a second', async () => {
    const c = await enter('p2');
    for (let i = 0; i < 20; i++) c.send({ t: 'nothing' });
    expect(await c.closed).toBe(1008);
  });

  it('refuses frames a browser never sends: unmasked, fragmented, binary', async () => {
    const raw = (bytes: Buffer) =>
      new Promise<string>((ok) => {
        const s = connect(port, '127.0.0.1');
        let got = Buffer.alloc(0);
        s.on('connect', () =>
          s.write(
            'GET /api/room HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
              // the handshake nonce of RFC 6455's own example, built here so no key-shaped text sits in the file
              `Sec-WebSocket-Key: ${Buffer.from('the sample nonce').toString('base64')}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
          ),
        );
        s.on('data', (d: Buffer) => {
          got = Buffer.concat([got, d]);
          const text = got.toString('latin1');
          if (text.includes('\r\n\r\n') && !s.writableEnded && !(s as { sent?: boolean }).sent) {
            (s as { sent?: boolean }).sent = true;
            s.write(bytes);
          }
        });
        s.on('close', () => ok(got.toString('latin1')));
      });
    const masked = (op: number, fin: boolean, body: string) => {
      const b = Buffer.from(body);
      return Buffer.concat([Buffer.from([(fin ? 0x80 : 0) | op, 0x80 | b.length, 0, 0, 0, 0]), b]);
    };
    const accept = 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=';
    const unmasked = await raw(Buffer.from([0x81, 2, 0x7b, 0x7d]));
    expect(unmasked).toContain(accept);
    expect(unmasked).toContain('not masked');
    expect(await raw(masked(0x1, false, '{"t"'))).toContain('no fragments');
    expect(await raw(masked(0x2, true, 'ab'))).toContain('text only');
  });

  it('a second socket for one player closes the first', async () => {
    const first = await enter('p3');
    const second = await player('p3');
    expect(await first.closed).toBe(4000);
    expect(second.code).toBe(-1);
    leaveAll();
  });
});

describe('the shared place: seeing each other', () => {
  it('two players see each other arrive, move and leave; labels only, no personal words', async () => {
    const a = await player('hero', 'amelia');
    const b = await player('p1', 'amelia');
    const joined = await a.wait((m) => m.t === 'join' && m.id === 'p1');
    // Player 1 to 10 cannot be the red-haired hero (D71)
    expect(joined).toMatchObject({ label: 'Player 1', hero: 'koala' });
    const welcome = b.msgs.find((m) => m.t === 'welcome') as unknown as {
      players: { id: string; label: string; hero: string }[];
    };
    expect(welcome.players).toEqual([expect.objectContaining({ id: 'hero', label: 'Testy', hero: 'amelia' })]);
    for (const c of [a, b]) expect(JSON.stringify(c.msgs)).not.toContain('secret');
    await sleep(300);
    a.send({ t: 'mv', x: a.pos.x + 1, y: a.pos.y + 0.5, d: 'right', c: 'walk' });
    const seen = await b.wait(
      (m) => m.t === 'pos' && (m.p as unknown[][]).some((q) => q[0] === 'hero' && q[3] === 'right'),
    );
    const row = (seen!.p as [string, number, number, string, string][]).find((q) => q[0] === 'hero')!;
    expect(row[1]).toBeCloseTo(a.pos.x + 1, 1);
    expect(row[4]).toBe('walk');
    a.send({ t: 'emo' });
    expect(await b.wait((m) => m.t === 'emo' && m.id === 'hero')).not.toBeNull();
    a.send({ t: 'fun', m: 'swing', o: 3, ax: 4.04, ay: 6.62, bx: 0, by: 0, d: 'down' });
    expect(await b.wait((m) => m.t === 'fun' && m.id === 'hero' && m.m === 'swing')).not.toBeNull();
    const at = b.msgs.length;
    a.close();
    expect(await b.wait((m) => m.t === 'leave' && m.id === 'hero', 3000, at)).not.toBeNull();
    leaveAll();
  });

  it('keeps a place in the area and to a walking speed', async () => {
    const a = await player('p2');
    await sleep(200);
    a.send({ t: 'mv', x: -50, y: room.START.y, d: 'left', c: 'walk' });
    const fix = await a.wait((m) => m.t === 'fix');
    // far outside: moved only as far as a walker could, and never past the edge
    expect(fix!.x as number).toBeGreaterThanOrEqual(room.AREA.x0);
    const x0 = (a.msgs.find((m) => m.t === 'welcome') as Msg).x as number;
    expect(x0 - (fix!.x as number)).toBeCloseTo(2.5, 1);
    // asking for the far side 10 times at once moves no further than once
    for (let i = 0; i < 10; i++) a.send({ t: 'mv', x: -50, y: room.START.y, d: 'left', c: 'walk' });
    await sleep(300);
    const last = a.msgs.filter((m) => m.t === 'fix').at(-1)!;
    expect(x0 - (last.x as number)).toBeLessThan(2.5 + 6 * 0.6);
    // held on: it gets to the edge and stops there
    const at = a.msgs.length;
    for (let i = 0; i < 12; i++) {
      a.send({ t: 'mv', x: -50, y: room.START.y, d: 'left', c: 'walk' });
      await sleep(300);
    }
    const fixes = (await a.wait((m) => m.t === 'fix' && m.x === room.AREA.x0, 3000, at)) as Msg;
    expect(fixes.x).toBe(room.AREA.x0);
    a.send({ t: 'mv', x: Number.NaN, y: 'a', d: 'sideways', c: '<b>' });
    a.send({ t: 'mv', x: 1e308, y: -1e308 });
    expect(a.code).toBe(-1);
    leaveAll();
  }, 10000);
});

describe('the shared place: chat', () => {
  it('passes a clean line to everyone; refuses rude words, web addresses, @ and long numbers, to the sender only', async () => {
    const a = await player('p4');
    const b = await player('p5');
    a.send({ t: 'say', text: '  Hello\u0007 there! <b>😀🙂  ' });
    const said = await b.wait((m) => m.t === 'say');
    // the bell, the < > and the emoji that is not on the list are gone; spaces tidied
    expect(said).toMatchObject({ id: 'p4', text: 'Hello there! b😀' });
    const tries = [
      'you are STUP1D',
      'shit!',
      'go to www.example.com',
      'my number is 0770 0900',
      'mail me@home',
      'sh!t',
      'fuuuuck',
    ];
    for (const text of tries) {
      await sleep(2050);
      const at = a.msgs.length;
      a.send({ t: 'say', text });
      expect(await a.wait((m) => m.t === 'no', 2000, at)).not.toBeNull();
    }
    await sleep(300);
    expect(b.msgs.filter((m) => m.t === 'say')).toHaveLength(1);
    // words that only look like rude ones pass: "as" is not "ass", "class" holds "ass" but is its own word
    await sleep(2050);
    a.send({ t: 'say', text: 'as fast as my class' });
    expect(await b.wait((m) => m.t === 'say' && m.text === 'as fast as my class')).not.toBeNull();
    const log = logText();
    for (const why of ['refused:word', 'refused:web', 'refused:number', 'refused:at', '\tsent\t'])
      expect(log).toContain(why);
    expect(log).toMatch(/^\d{4}-\d\d-\d\dT[^\t]+\tp4\tsent\t"Hello there! b😀"$/m);
    expect(statSync(join(data, `chat-${today()}.log`)).mode & 0o777).toBe(0o600);
    leaveAll();
  }, 30000);

  it('holds a player to 1 message in 2 seconds and 10 a minute', async () => {
    const a = await player('p3');
    const b = await player('p5');
    a.send({ t: 'ph', n: 0 });
    a.send({ t: 'ph', n: 1 });
    expect(await a.wait((m) => m.t === 'slow')).not.toBeNull();
    await sleep(300);
    expect(b.msgs.filter((m) => m.t === 'ph')).toHaveLength(1);
    leaveAll();
  });

  it('Dad’s word list, the chat switch and a muted player, read again when room.json changes', async () => {
    writeFileSync(join(data, 'chat-words.txt'), 'Broccoli\n');
    const a = await player('p1');
    const b = await player('p2');
    await sleep(2100);
    a.send({ t: 'say', text: 'I like BROCC0LI' });
    expect(await a.wait((m) => m.t === 'no')).not.toBeNull();
    writeFileSync(join(data, 'room.json'), JSON.stringify({ chat: false, muted: ['p2'] }));
    await sleep(2100);
    let at = a.msgs.length;
    a.send({ t: 'say', text: 'hello' });
    expect(await a.wait((m) => m.t === 'chat' && m.on === false, 2000, at)).not.toBeNull();
    // ready phrases stay on with typed chat off
    await sleep(2050);
    a.send({ t: 'ph', n: 5 });
    expect(await b.wait((m) => m.t === 'ph' && m.n === 5)).not.toBeNull();
    // the muted player is silent, phrases too
    b.send({ t: 'ph', n: 0 });
    expect(await b.wait((m) => m.t === 'muted')).not.toBeNull();
    await sleep(300);
    expect(a.msgs.some((m) => m.t === 'ph' && m.id === 'p2')).toBe(false);
    writeFileSync(join(data, 'room.json'), JSON.stringify({ chat: true }));
    await sleep(2100);
    at = b.msgs.length;
    a.send({ t: 'say', text: 'back on' });
    expect(await b.wait((m) => m.t === 'say' && m.text === 'back on', 3000, at)).not.toBeNull();
    expect(logText()).toMatch(/\tp2\tmuted\t/);
    leaveAll();
  }, 20000);

  it('WS_CHAT=0 turns typed chat off for everyone', async () => {
    const other = await start(true, { WS_CHAT: '0' });
    const c = new Client(other);
    await c.open();
    c.send({ t: 'hi', token: tokens.p3, hero: 'bing' });
    const w = await c.wait((m) => m.t === 'welcome');
    expect(w!.chat).toBe(false);
    await sleep(2100);
    c.send({ t: 'say', text: 'hello' });
    expect(await c.wait((m) => m.t === 'chat' && m.on === false)).not.toBeNull();
    c.close();
  }, 10000);
});

describe('the shared place: Keepy Uppy', () => {
  it('starts at the stand; of two hits sent together one counts, and both players see the same count', async () => {
    const a = await player('hero', 'amelia');
    const b = await player('p1');
    await Promise.all([walk(a, room.STAND.x, room.STAND.y), walk(b, room.STAND.x + 1, room.STAND.y)]);
    a.send({ t: 'kick' });
    const ball = (await a.wait((m) => m.t === 'ball')) as Msg & Record<string, number>;
    expect(ball.n).toBe(0);
    expect(await b.wait((m) => m.t === 'ball')).not.toBeNull();
    // both go to where it will be 2.8 s after the hit (low again, before it lands at about 3.1 s)
    const t = 2.8 - ball.age / 1000;
    const x = ball.x0 + ball.vx * 2.8;
    const y = ball.y0 + ball.vy * 2.8;
    const start = Date.now();
    await Promise.all([walk(a, x, y), walk(b, x + 0.3, y)]);
    await sleep(Math.max(0, t * 1000 - (Date.now() - start)));
    const at = [a.msgs.length, b.msgs.length];
    a.send({ t: 'kick' });
    b.send({ t: 'kick' });
    const hitA = await a.wait((m) => m.t === 'ball' && m.n === 1, 2000, at[0]);
    const hitB = await b.wait((m) => m.t === 'ball' && m.n === 1, 2000, at[1]);
    expect(hitA).not.toBeNull();
    expect(hitB).toMatchObject({ x0: hitA!.x0, y0: hitA!.y0, vx: hitA!.vx, vy: hitA!.vy });
    await sleep(300);
    expect(a.msgs.slice(at[0]).filter((m) => m.t === 'hit')).toHaveLength(1);
    expect(a.msgs.slice(at[0]).filter((m) => m.t === 'ball')).toHaveLength(1);
    // nobody hits it again: it lands, and the best of the day is 1 for both
    const landA = await a.wait((m) => m.t === 'land', 5000, at[0]);
    const landB = await b.wait((m) => m.t === 'land', 5000, at[1]);
    expect(landA).toMatchObject({ n: 1, best: 1 });
    expect(landB).toMatchObject({ n: 1, best: 1 });
    leaveAll();
  }, 20000);

  it('the race: 3, 2, 1 from the start box, the first over the line wins', async () => {
    const a = await player('p4');
    const startBox = { x: room.RACE_START.x0 + 1.5, y: room.RACE_START.y0 + 1.5 };
    await walk(a, startBox.x, startBox.y);
    a.send({ t: 'race' });
    expect(await a.wait((m) => m.t === 'race' && m.phase === 'count')).toMatchObject({ ms: 3000 });
    const go = await a.wait((m) => m.t === 'race' && m.phase === 'go', 4000);
    expect(go!.ids).toEqual(['p4']);
    await walk(a, room.RACE_FINISH_X + 0.5, startBox.y);
    expect(await a.wait((m) => m.t === 'race' && m.phase === 'end')).toMatchObject({ win: 'p4' });
    leaveAll();
  }, 20000);
});

describe('the shared place: numbers and the home copy', () => {
  it('matches the map (src/data/map/meet.json)', () => {
    const map = JSON.parse(readFileSync(resolve(import.meta.dirname, '../src/data/map/meet.json'), 'utf8')) as {
      w: number;
      h: number;
      places: Record<string, { x: number; y: number }>;
    };
    const P = map.places;
    expect(room.START).toEqual({ x: P.meet_start!.x + 0.5, y: P.meet_start!.y + 0.5 });
    expect(room.STAND).toEqual({ x: P.balloon_stand!.x + 0.5, y: P.balloon_stand!.y + 0.5 });
    expect(room.RACE_FINISH_X).toBe(P.race_finish!.x);
    const s = P.race_start!;
    expect(s.x >= room.RACE_START.x0 && s.x < room.RACE_START.x1 && s.y >= room.RACE_START.y0).toBe(true);
    expect(room.AREA.x1).toBeLessThan(map.w);
    expect(room.AREA.y1).toBeLessThan(map.h);
  });

  it('has no api/room without --players', async () => {
    const home = await start(false);
    const c = new Client(home);
    await expect(c.open()).rejects.toThrow();
    const r = await fetch(`http://127.0.0.1:${home}/api/room`);
    expect(r.status).toBe(404);
  });
});
