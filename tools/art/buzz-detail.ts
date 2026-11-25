// Reprocess the approved Buzz masters at higher native detail without changing his world size.
// The existing sheet prompts are in art/jobs/sheets.jobs.json. Generated files and the private
// masters stay local; packing is restricted to a fresh one-character staging folder in TMPDIR.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { cast } from './cast.ts';
import { packChars } from './pack.ts';
import { FRAME_SCALE, motionCheck, processChar, type CharMeta } from './process.ts';
import { sheetsFor } from './sheets.ts';

const root = resolve(import.meta.dirname, '../..');
const character = cast.find((c) => c.id === 'buzz');
assert.ok(character, 'Buzz must be in the art cast');
const old = JSON.parse(readFileSync(join(root, 'art/src/chars/buzz/meta.json'), 'utf8')) as CharMeta;
const targetPixels = 232;
const stage = mkdtempSync(join(tmpdir(), 'buzz-detail-'));
const input = join(stage, 'src');
const output = join(stage, 'packed');
const dir = join(input, 'chars/buzz');
const sheets = sheetsFor(character).map((s) => ({
  file: join(root, 'art/masters/chars/buzz', `${s.key}.png`),
  cols: s.grid,
  rows: s.grid,
  cells: s.cells,
}));
const meta = await processChar(
  { id: character.id, group: character.group, tall: targetPixels / (64 * FRAME_SCALE) },
  sheets,
  dir,
  join(stage, 'buzz-strip.png'),
);
// The runtime uses tall / px: retain the original world height and change only texture density.
assert.equal(meta.px, targetPixels);
assert.deepEqual(meta.clips, old.clips, 'the original clips, names and order must stay unchanged');
meta.tall = old.tall;
meta.group = old.group;
meta.timing = old.timing;
writeFileSync(join(dir, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
const motion = await motionCheck(dir);
for (const [name, result] of Object.entries(motion)) {
  console.log(`${name}: ${result.change.toFixed(3)} ${result.ok ? 'PASS' : 'FAIL'}`);
}
assert.ok(
  Object.values(motion).every((result) => result.ok),
  'all existing motion checks must pass',
);
await packChars(input, output);
console.log(`BUZZ_DETAIL_STAGE=${stage}`);
console.log(`px ${old.px} -> ${meta.px}; tall ${meta.tall}; canvas ${meta.w}x${meta.h}; footY ${meta.footY}`);
