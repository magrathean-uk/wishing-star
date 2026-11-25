// The acceptance command (npm run verify). Runs every step in order, never stops early, prints one table and
// VERIFY PASS only when every step passed. --fast skips the steps marked slow: the frame gate and the walking soak
// (headed, they need the screen awake), the release launcher check (it needs port 4173, which G's own game may
// hold) and the soak report check (and then prints VERIFY FAST PASS, never VERIFY PASS).
// The browser steps play the build this run makes, served on 127.0.0.1:4188 (never 4173 or 4190: 4173 is the
// release launcher's, WebKit refuses 4190). --out <dir> builds into that folder instead of dist/ (a worker's own).
import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const FAST = process.argv.includes('--fast');
const OUT = process.argv.includes('--out') ? resolve(process.argv[process.argv.indexOf('--out') + 1] ?? 'dist') : '';
const PORT = 4188;
const URL = `http://127.0.0.1:${PORT}/`;

interface Step {
  name: string;
  cmd: string[];
  /** script that must exist, or the step is MISSING */
  file?: string;
  slow?: boolean;
  /** needs the preview server on PORT serving this run's build */
  served?: boolean;
}

const STEPS: Step[] = [
  { name: 'type check', cmd: ['npx', 'tsc', '--noEmit'] },
  { name: 'lint', cmd: ['npx', 'biome', 'check', 'src', 'tools', 'tests'] },
  { name: 'unit tests', cmd: ['npx', 'vitest', 'run'] },
  {
    name: 'data validation',
    cmd: ['node', 'tools/check/validate.ts', '--scope', '--art'],
    file: 'tools/check/validate.ts',
  },
  { name: 'map gate', cmd: ['node', 'tools/check/mapgate.ts'], file: 'tools/check/mapgate.ts' },
  { name: 'reading check', cmd: ['node', 'tools/check/reading.ts'], file: 'tools/check/reading.ts' },
  // before the solver: the playtime report uses the kid bot's measured times (test-results/kidbot.json)
  { name: 'kid bot', cmd: ['node', 'tools/check/kidbot.ts'], file: 'tools/check/kidbot.ts' },
  { name: 'solver + reports', cmd: ['node', 'tools/check/solver.ts', '--final'], file: 'tools/check/solver.ts' },
  { name: 'first ten minutes', cmd: ['node', 'tools/check/firstten.ts'], file: 'tools/check/firstten.ts' },
  {
    name: 'build',
    cmd: OUT ? ['npx', 'vite', 'build', '--outDir', OUT, '--emptyOutDir'] : ['npm', 'run', 'build'],
  },
  // Chromium and WebKit (WebKit stands in for Safari)
  {
    name: 'browser smoke',
    cmd: ['node', 'tools/bot/smoke.ts', '--url', URL],
    file: 'tools/bot/smoke.ts',
    served: true,
  },
  // after the smoke run: it counts the key presses from the title to walking
  { name: 'calm check', cmd: ['node', 'tools/check/calm.ts'], file: 'tools/check/calm.ts' },
  // after the solver and the smoke run: rows are proven by their events and screenshots
  { name: 'design checklist', cmd: ['node', 'tools/check/checklist.ts'], file: 'tools/check/checklist.ts' },
  {
    name: 'frame gate',
    cmd: ['node', 'tools/bot/framegate.ts', '--url', URL],
    file: 'tools/bot/framegate.ts',
    slow: true,
    served: true,
  },
  {
    name: 'walking soak',
    cmd: ['node', 'tools/bot/soak.ts', '--walk', '--url', URL],
    file: 'tools/bot/soak.ts',
    slow: true,
    served: true,
  },
  // the release folder started by its launcher, as G will (definition of done item 1; the only check on 4173)
  { name: 'release launcher', cmd: ['zsh', 'tools/release/check.sh'], file: 'tools/release/check.sh', slow: true },
];

type Result = 'PASS' | 'FAIL' | 'MISSING' | 'SKIPPED';
interface Row {
  name: string;
  result: Result;
  seconds: number;
  note: string;
}

/** Run one command with its output passed through; resolve with the exit code and the last output line. */
function run(cmd: string[]): Promise<{ code: number; last: string }> {
  return new Promise((done) => {
    const child = spawn(cmd[0]!, cmd.slice(1), {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '0' },
    });
    let tail = '';
    const keep = (d: Buffer, out: NodeJS.WriteStream) => {
      out.write(d);
      tail = (tail + String(d)).slice(-2000);
    };
    child.stdout.on('data', (d: Buffer) => keep(d, process.stdout));
    child.stderr.on('data', (d: Buffer) => keep(d, process.stderr));
    child.on('error', (e) => done({ code: 127, last: String(e.message) }));
    child.on('close', (code) => {
      const lines = tail
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      done({ code: code ?? 1, last: lines.at(-1) ?? '' });
    });
  });
}

function gitHead(): Promise<string> {
  return new Promise((done) => {
    const c = spawn('git', ['rev-parse', 'HEAD'], { cwd: ROOT });
    let out = '';
    c.stdout.on('data', (d) => {
      out += String(d);
    });
    c.on('close', () => done(out.trim()));
    c.on('error', () => done(''));
  });
}

/** Serve this run's build on PORT for the browser steps; null when the port is taken or it never answers. */
async function serve(): Promise<{ child: ChildProcess } | { error: string }> {
  const dir = OUT || resolve(ROOT, 'dist');
  // something else on the port would be tested in place of this build
  const taken = await fetch(URL, { signal: AbortSignal.timeout(1000) }).then(
    () => true,
    () => false,
  );
  if (taken) return { error: `port ${PORT} is already in use` };
  // vite itself, not through npx, so that stopping it stops the server
  const vite = resolve(ROOT, 'node_modules/vite/bin/vite.js');
  const args = [vite, 'preview', '--outDir', dir, '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'];
  const child = spawn(process.execPath, args, { cwd: ROOT, stdio: 'ignore' });
  for (let i = 0; i < 80; i++) {
    if (child.exitCode !== null) return { error: `vite preview exited (port ${PORT} in use?)` };
    try {
      const r = await fetch(URL, { signal: AbortSignal.timeout(1000) });
      if (r.ok) return { child };
    } catch {
      // not up yet
    }
    await new Promise((d) => setTimeout(d, 250));
  }
  child.kill();
  return { error: `nothing answered on ${URL}` };
}

/** release/soak-report.md exists, names the current commit, passed and ran the full 30 minutes. */
async function reportCheck(): Promise<{ ok: boolean; note: string }> {
  const file = resolve(ROOT, 'release/soak-report.md');
  if (!existsSync(file)) return { ok: false, note: 'release/soak-report.md missing: run npm run soak' };
  const md = readFileSync(file, 'utf8');
  const head = await gitHead();
  const commit = /Commit:\s*([0-9a-f]{7,40})/.exec(md)?.[1] ?? '';
  const minutes = Number(/Duration:\s*([\d.]+)\s*minutes/.exec(md)?.[1] ?? 0);
  const passed = /Result:\s*PASS/.test(md);
  if (!head || commit !== head)
    return { ok: false, note: `report is for ${commit.slice(0, 8) || 'no commit'}, HEAD is ${head.slice(0, 8)}` };
  if (minutes < 30) return { ok: false, note: `report covers ${minutes} minutes, needs 30` };
  if (!passed) return { ok: false, note: 'report says FAIL' };
  return { ok: true, note: `commit ${head.slice(0, 8)}, ${minutes} min` };
}

async function main(): Promise<void> {
  const rows: Row[] = [];
  let server: { child: ChildProcess } | { error: string } | null = null;
  for (const s of STEPS) {
    if (FAST && s.slow) {
      rows.push({ name: s.name, result: 'SKIPPED', seconds: 0, note: '--fast' });
      continue;
    }
    if (s.file && !existsSync(resolve(ROOT, s.file))) {
      rows.push({ name: s.name, result: 'MISSING', seconds: 0, note: `${s.file} not written yet` });
      continue;
    }
    if (s.served && !server) server = await serve();
    if (s.served && server && 'error' in server) {
      rows.push({ name: s.name, result: 'FAIL', seconds: 0, note: server.error });
      continue;
    }
    console.log(`\n=== ${s.name}: ${s.cmd.join(' ')}`);
    const t0 = performance.now();
    const r = await run(s.cmd);
    rows.push({
      name: s.name,
      result: r.code === 0 ? 'PASS' : 'FAIL',
      seconds: (performance.now() - t0) / 1000,
      note: r.code === 0 ? '' : `exit ${r.code}: ${r.last.slice(0, 70)}`,
    });
  }
  if (server && 'child' in server) server.child.kill();
  if (FAST) rows.push({ name: 'soak report', result: 'SKIPPED', seconds: 0, note: '--fast' });
  else {
    const t0 = performance.now();
    const r = await reportCheck();
    rows.push({
      name: 'soak report',
      result: r.ok ? 'PASS' : 'FAIL',
      seconds: (performance.now() - t0) / 1000,
      note: r.note,
    });
  }

  const w = Math.max(...rows.map((r) => r.name.length));
  console.log('\n' + `${'step'.padEnd(w)} | result  | seconds | note`);
  console.log(`${'-'.repeat(w)}-|---------|---------|-----`);
  for (const r of rows)
    console.log(`${r.name.padEnd(w)} | ${r.result.padEnd(7)} | ${r.seconds.toFixed(1).padStart(7)} | ${r.note}`);
  const ok = rows.every((r) => r.result === 'PASS' || (FAST && r.result === 'SKIPPED'));
  if (ok) console.log(FAST ? 'VERIFY FAST PASS' : 'VERIFY PASS');
  else console.log('VERIFY FAIL');
  process.exit(ok ? 0 : 1);
}

await main();
