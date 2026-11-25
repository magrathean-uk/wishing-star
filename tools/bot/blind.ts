// Blind play harness: lets an agent play the game with only keys and screenshots, like a person at a laptop.
// Server:  node tools/bot/blind.ts serve --url <game url> [--port 4197] --out <folder> [--save <saved game file>]
// Client:  node tools/bot/blind.ts press|hold|seq|wait|shot|status|stop ...   (see docs/phase2-notes/blind-play.md)
// It uses no debug hook of the game: only the keyboard and screenshots.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { launch, sleep } from './lib.ts';

const DEFAULT_PORT = 4197;
const FORBIDDEN_PORTS = new Set([4173, 4188, 4190]);
const TAP_MS = 80;
const SETTLE_MS = 350;
const MAX_HOLD = 5000;
const MAX_WAIT = 10000;
const MAX_STEPS = 20;

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

type Step = { kind: 'tap'; key: string } | { kind: 'hold'; key: string; ms: number } | { kind: 'wait'; ms: number };

function num(s: string | undefined, what: string, max: number): number {
  const n = Number(s);
  if (!s || !Number.isFinite(n) || n < 0) throw new Error(`${what} must be a number of milliseconds`);
  if (n > max) throw new Error(`${what} is at most ${max} ms`);
  return n;
}

function parseSeq(text: string): Step[] {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) throw new Error('seq needs at least one step');
  if (parts.length > MAX_STEPS) throw new Error(`seq takes at most ${MAX_STEPS} steps`);
  return parts.map((p): Step => {
    const [k, ms] = p.split(':');
    if (!k) throw new Error(`bad step "${p}"`);
    if (k === 'wait') return { kind: 'wait', ms: num(ms, 'wait', MAX_WAIT) };
    if (ms === undefined) return { kind: 'tap', key: k };
    return { kind: 'hold', key: k, ms: num(ms, 'hold', MAX_HOLD) };
  });
}

// ---------------------------------------------------------------- server

async function serve(): Promise<void> {
  const url = flag('url');
  const out = flag('out');
  const port = Number(flag('port') ?? DEFAULT_PORT);
  if (!url || !out) throw new Error('serve needs --url <game url> and --out <folder>');
  if (!Number.isInteger(port) || FORBIDDEN_PORTS.has(port)) throw new Error(`port ${port} is not allowed`);
  const dir = resolve(out);
  mkdirSync(dir, { recursive: true });
  const logFile = resolve(dir, 'log.jsonl');
  writeFileSync(logFile, '');

  const { page, close } = await launch('chromium', { width: 1280, height: 720 });
  // --save <file>: start from a saved game (a capture file with a `save` part, or a bare save) put in slot 1 once,
  // so a later stretch of the story can be played blind. The play itself still uses only keys and screenshots.
  const saveFile = flag('save');
  if (saveFile) {
    const j = JSON.parse(readFileSync(resolve(saveFile), 'utf8'));
    await page.addInitScript(
      (json: string) => {
        if (localStorage.getItem('ws_blind_seeded')) return;
        localStorage.setItem('ws_blind_seeded', '1');
        localStorage.setItem('ws_save_1', json);
        localStorage.setItem('ws_slot', '1');
      },
      JSON.stringify(j.save ?? j),
    );
  }
  await page.goto(url, { waitUntil: 'load' });
  const t0 = Date.now();
  let count = 0;
  let commands = 0;
  let last = '';
  let busy: Promise<unknown> = Promise.resolve();

  const playTime = () => {
    const s = Math.round((Date.now() - t0) / 1000);
    return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
  };

  async function run(steps: Step[], p: Page): Promise<void> {
    for (const s of steps) {
      if (s.kind === 'wait') await sleep(s.ms);
      else if (s.kind === 'tap') {
        await p.keyboard.down(s.key);
        await sleep(TAP_MS);
        await p.keyboard.up(s.key);
        await sleep(60);
      } else {
        await p.keyboard.down(s.key);
        await sleep(s.ms);
        await p.keyboard.up(s.key);
      }
    }
  }

  async function snap(label: string): Promise<string> {
    await sleep(SETTLE_MS);
    count++;
    const file = resolve(dir, `${String(count).padStart(4, '0')}.png`);
    await p_shot(file);
    commands++;
    last = file;
    appendFileSync(
      logFile,
      `${JSON.stringify({ time: new Date().toISOString(), play: playTime(), command: label, screenshot: file })}\n`,
    );
    return file;
  }
  const p_shot = (file: string) => page.screenshot({ path: file }).then(() => undefined);

  function steps(cmd: string, args: string[]): Step[] | null {
    switch (cmd) {
      case 'press': {
        const key = args[0];
        if (!key) throw new Error('press needs a key');
        const times = args[1] ? Math.floor(num(args[1], 'times', 50)) : 1;
        return Array.from({ length: times }, () => ({ kind: 'tap', key }) as Step);
      }
      case 'hold':
        if (!args[0]) throw new Error('hold needs a key and milliseconds');
        return [{ kind: 'hold', key: args[0], ms: num(args[1], 'hold', MAX_HOLD) }];
      case 'seq':
        return parseSeq(args.join(' '));
      case 'wait':
        return [{ kind: 'wait', ms: num(args[0], 'wait', MAX_WAIT) }];
      case 'shot':
        return [];
      default:
        return null;
    }
  }

  let stopping = false;
  const server: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => {
      body += String(d);
    });
    req.on('end', () => {
      const reply = (code: number, text: string) => {
        res.writeHead(code, { 'content-type': 'text/plain' });
        res.end(text);
      };
      let msg: { cmd: string; args: string[] };
      try {
        msg = JSON.parse(body);
      } catch {
        reply(400, 'error: bad request');
        return;
      }
      if (msg.cmd === 'status') {
        reply(200, `commands ${commands}, play time ${playTime()}, last screenshot ${last || 'none'}`);
        return;
      }
      if (msg.cmd === 'stop') {
        reply(200, `stopped after ${commands} commands, play time ${playTime()}`);
        void shutdown(0);
        return;
      }
      // One command at a time, in order.
      busy = busy.then(async () => {
        try {
          const st = steps(msg.cmd, msg.args ?? []);
          if (st === null) return reply(400, `error: unknown command "${msg.cmd}"`);
          await run(st, page);
          const file = await snap([msg.cmd, ...(msg.args ?? [])].join(' '));
          reply(200, `${file} ${playTime()}`);
        } catch (e) {
          reply(400, `error: ${(e as Error).message}`);
        }
      });
    });
  });

  async function shutdown(code: number): Promise<void> {
    if (stopping) return;
    stopping = true;
    server.close();
    server.closeAllConnections();
    await close().catch(() => undefined);
    process.exit(code);
  }
  process.prependListener('SIGTERM', () => void shutdown(0));
  process.prependListener('SIGINT', () => void shutdown(0));

  await new Promise<void>((ok, bad) => {
    server.once('error', bad);
    server.listen(port, '127.0.0.1', () => ok());
  });
  console.log(`blind serve ready on 127.0.0.1:${port}, pictures in ${dir}`);
}

// ---------------------------------------------------------------- client

async function client(cmd: string, args: string[]): Promise<void> {
  const port = Number(flag('port') ?? DEFAULT_PORT);
  const rest = args.filter((a, i) => a !== '--port' && args[i - 1] !== '--port');
  try {
    const r = await fetch(`http://127.0.0.1:${port}/`, {
      method: 'POST',
      body: JSON.stringify({ cmd, args: rest }),
      signal: AbortSignal.timeout(120000),
    });
    const text = await r.text();
    console.log(text);
    if (!r.ok) process.exitCode = 1;
  } catch {
    console.log(
      `error: no blind server on 127.0.0.1:${port}; start it with: node tools/bot/blind.ts serve --url <game url> --out <folder>`,
    );
    process.exitCode = 1;
  }
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === 'serve') {
  serve().catch((e) => {
    console.log(`error: ${(e as Error).message}`);
    process.exit(1);
  });
} else if (cmd && ['press', 'hold', 'seq', 'wait', 'shot', 'status', 'stop'].includes(cmd)) {
  await client(cmd, args);
} else {
  console.log(
    'usage: serve --url <url> --out <folder> [--port 4197] | press <Key> [n] | hold <Key> <ms> | seq "<steps>" | wait <ms> | shot | status | stop',
  );
  process.exitCode = 1;
}
