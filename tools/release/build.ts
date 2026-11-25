// Assembles release/Amelia and the Wishing Star/.
// Usage: node tools/release/build.ts [--stub] [--skip-build] [--windows-only] [--build <n>] [--notes <file>]
// --windows-only  skip the Mac program, its launcher and the players seed (a Linux box can build the Windows folder;
//                 tools/release/check-win-dell.sh sends only that part to the Dell)
//   --build n      a build number for G (phase 2 hands him a build at every step); written into VERSION.txt
//   --notes file   a few lines on what is new and where to look; copied in as WHAT_IS_NEW.txt
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const args = new Set(argv);
const opt = (name: string): string => (argv.includes(name) ? (argv[argv.indexOf(name) + 1] ?? '') : '');
const buildNo = opt('--build');
const notes = opt('--notes');
const stub = args.has('--stub');
const skipBuild = args.has('--skip-build');
const windowsOnly = args.has('--windows-only');
const out = join(repo, 'release', 'Amelia and the Wishing Star');
const dist = join(repo, 'dist');

function run(cmd: string, argv: string[], cwd = repo): string {
  return execFileSync(cmd, argv, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
}

// 1. The game files.
let gameSource = dist;
const scratch = mkdtempSync(join(tmpdir(), 'amelia-release-'));
try {
  if (stub) {
    gameSource = join(scratch, 'dist');
    mkdirSync(gameSource, { recursive: true });
    writeFileSync(join(gameSource, 'index.html'), '<!doctype html><title>stub</title><p>stub</p>\n');
    writeFileSync(join(gameSource, 'personal.json'), '{ "hero": "Stub" }\n');
  } else if (!skipBuild) {
    run('npm', ['run', 'build']);
  }
  if (!existsSync(join(gameSource, 'index.html')))
    throw new Error('dist/index.html is missing: run npm run build, or use --stub');

  mkdirSync(out, { recursive: true });
  // The launcher keeps saves in data. Leave that directory in place, including while a rebuild is in progress.
  for (const name of readdirSync(out)) {
    if (name !== 'data') rmSync(join(out, name), { recursive: true, force: true });
  }
  cpSync(gameSource, join(out, 'game'), { recursive: true });

  if (!windowsOnly) {
    // 2. The server as one executable (Node single-executable application).
    const seaConfig = join(scratch, 'sea-config.json');
    const exe = join(out, 'play-server');
    // A single-executable program can require only Node's own modules, so the room (package 66) is put inside the
    // server's text in place of its require: one script, the same code.
    const serverText = readFileSync(join(repo, 'tools', 'release', 'server.js'), 'utf8');
    const roomText = readFileSync(join(repo, 'tools', 'release', 'room.js'), 'utf8');
    const need = "require('./room.js')";
    if (serverText.split(need).length !== 2) throw new Error(`server.js must hold ${need} exactly once`);
    // a function, so a $ in the room's text is never read as a replacement pattern
    const packed = serverText.replace(
      need,
      () =>
        `((() => { const module = { exports: {} }; ${roomText.replace(/^'use strict';/m, '')}\n return module.exports; })())`,
    );
    const packedMain = join(scratch, 'play-server.js');
    writeFileSync(packedMain, packed);
    writeFileSync(
      seaConfig,
      JSON.stringify({
        main: packedMain,
        output: exe,
        disableExperimentalSEAWarning: true,
      }),
    );
    run(process.execPath, ['--build-sea', seaConfig]);
    chmodSync(exe, 0o755);
    run('codesign', ['--force', '--sign', '-', exe]);

    // 2b. Players mode (D67): her fixed password, read by the server on its first start with --players. It sits beside
    // the program, never inside game/, so the web server cannot hand it out and the bundle never holds it.
    const playersSeed = join(repo, 'tools', 'release', 'players-seed.json');
    if (existsSync(playersSeed)) {
      cpSync(playersSeed, join(out, 'players-seed.json'));
      chmodSync(join(out, 'players-seed.json'), 0o600);
    } else console.warn('No players-seed.json: home mode works; players mode needs one before its first start.');

    // 3. Launcher.
    const launcher = join(out, 'Play Amelia.command');
    writeFileSync(launcher, readFileSync(join(repo, 'tools', 'release', 'launcher.command.txt')));
    chmodSync(launcher, 0o755);
  }

  // 3b. Windows: the same folder starts with a double-click on Play Amelia.bat (PowerShell file server, nothing to install).
  cpSync(join(repo, 'tools', 'release', 'play-server.ps1'), join(out, 'play-server.ps1'));
  cpSync(join(repo, 'tools', 'release', 'launcher.bat.txt'), join(out, 'Play Amelia.bat'));

  // 4. Notes for Dad.
  cpSync(join(repo, 'README_FOR_DAD.md'), join(out, 'README_FOR_DAD.md'));

  // 5. Version.
  let commit = 'unknown';
  try {
    commit = run('git', ['rev-parse', 'HEAD']).trim();
    if (run('git', ['status', '--porcelain']).trim()) commit += ' (with uncommitted changes)';
  } catch {}
  writeFileSync(
    join(out, 'VERSION.txt'),
    `Amelia and the Wishing Star\n${buildNo ? `Build: ${buildNo}\n` : ''}Commit: ${commit}\nBuilt: ${new Date().toISOString()}${stub ? '\nSTUB BUILD\n' : '\n'}`,
  );
  if (notes) cpSync(resolve(notes), join(out, 'WHAT_IS_NEW.txt'));
  console.log(`Release written to ${out}`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
