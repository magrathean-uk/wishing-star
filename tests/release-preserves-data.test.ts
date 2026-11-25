// The release build, run for real in a temporary copy of the repo (it builds and signs the Mac program, so it is slow):
// a rebuild keeps the release's saved data, also when it fails, and the players-mode seed is copied when it is there
// (private, owner only) and not needed when it is not.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, expect, it } from 'vitest';

const fixture = mkdtempSync(join(tmpdir(), 'ws-release-data-'));
const release = join(fixture, 'release', 'Amelia and the Wishing Star');
const save = join(release, 'data', 'home', 'slot1.json');
const player = join(release, 'data', 'saves', 'p1.json');
const tools = join(fixture, 'tools', 'release');
const seed = join(tools, 'players-seed.json');

mkdirSync(tools, { recursive: true });
for (const file of ['build.ts', 'server.js', 'room.js', 'launcher.command.txt', 'launcher.bat.txt', 'play-server.ps1'])
  cpSync(resolve('tools', 'release', file), join(tools, file));
cpSync(resolve('README_FOR_DAD.md'), join(fixture, 'README_FOR_DAD.md'));
mkdirSync(join(release, 'data', 'home'), { recursive: true });
mkdirSync(join(release, 'data', 'saves'), { recursive: true });
writeFileSync(save, '{"day":7}');
writeFileSync(player, '{"day":9}');
writeFileSync(seed, '{"synthetic":true}\n');
const build = () => spawnSync(process.execPath, [join(tools, 'build.ts'), '--stub'], { encoding: 'utf8' });
const savesKept = () => {
  expect(readFileSync(save, 'utf8')).toBe('{"day":7}');
  expect(readFileSync(player, 'utf8')).toBe('{"day":9}');
};
afterAll(() => rmSync(fixture, { recursive: true, force: true }));

// Release assembly builds and signs the Mac executable. Three builds, one after another: generous for a busy machine.
it.runIf(process.platform === 'darwin')(
  'keeps saved data through good and failed rebuilds, and builds with or without the players seed',
  () => {
    const result = build();
    expect(result.status, result.stderr).toBe(0);
    savesKept();
    expect(existsSync(join(release, 'Play Amelia.command'))).toBe(true);
    expect(readFileSync(join(release, 'players-seed.json'), 'utf8')).toBe('{"synthetic":true}\n');
    expect(statSync(join(release, 'players-seed.json')).mode & 0o777).toBe(0o600);

    const launcher = readFileSync(join(tools, 'launcher.command.txt'));
    rmSync(join(tools, 'launcher.command.txt'));
    const failed = build();
    expect(failed.status).not.toBe(0);
    savesKept();

    // the public copy has no seed: home mode needs none
    writeFileSync(join(tools, 'launcher.command.txt'), launcher);
    rmSync(seed);
    const bare = build();
    expect(bare.status, bare.stderr).toBe(0);
    savesKept();
    expect(existsSync(join(release, 'Play Amelia.command'))).toBe(true);
    expect(existsSync(join(release, 'Play Amelia.bat'))).toBe(true);
    expect(existsSync(join(release, 'players-seed.json'))).toBe(false);
  },
  240_000,
);
