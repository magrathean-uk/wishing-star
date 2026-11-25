// Art QA summary: one row per cast character with the clips the game holds for it and the result of the motion
// check, written to art/qa/SUMMARY.md. Run: node tools/art/summary.ts
// It reads what the game ships (public/assets/chars/index.json), the cast list (tools/art/cast.ts), the motion
// check (art/qa/motion.json) and the clips accepted by eye (art/qa/motion-ok.json). It decides nothing itself:
// `node tools/check/validate.ts --art` is the gate; this is the page a person reads.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cast } from './cast.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const json = <T>(p: string): T => JSON.parse(readFileSync(join(ROOT, p), 'utf8')) as T;

interface CharSet {
  group: string;
  clips: Record<string, Record<string, string[]>>;
}
const sets = json<{ sets: Record<string, CharSet> }>('public/assets/chars/index.json').sets;
const motion = json<{ results: Record<string, Record<string, { change: number; ok: boolean }>> }>(
  'art/qa/motion.json',
).results;
const byEye = json<Record<string, Record<string, string> | string>>('art/qa/motion-ok.json');

/** "2/2/2" frames facing down, side and up; "-" where the clip is not drawn. */
function frames(set: CharSet, clip: string): string {
  const by = set.clips[clip];
  if (!by) return '-';
  return ['down', 'side', 'up'].map((f) => String(by[f]?.length ?? 0)).join('/');
}

const MAIN = ['idle', 'walk', 'talk'];
const rows: string[] = [];
const tally = { all: 0, idle: 0, walk: 0, talk: 0, eye: 0, fail: 0, still: 0 };
const roles: Record<string, number> = {};
const skipped: string[] = [];
for (const c of [...cast].sort((a, b) => a.group.localeCompare(b.group) || a.id.localeCompare(b.id))) {
  const set = sets[c.id];
  if (!set && c.cameo) {
    // "cameos if time allows" in the build plan: never drawn, so not in the game either
    skipped.push(c.id);
    continue;
  }
  tally.all++;
  roles[c.role] = (roles[c.role] ?? 0) + 1;
  if (!set) {
    rows.push(`| ${c.id} | ${c.group} | ${c.role} | - | - | - | - | NO ART | no |`);
    tally.fail++;
    continue;
  }
  const has = (clip: string) => Object.values(set.clips[clip] ?? {}).some((f) => f.length >= 2);
  if (has('idle')) tally.idle++;
  if (has('walk')) tally.walk++;
  if (has('talk')) tally.talk++;
  // a character with no clip of two or more frames would be a still picture
  const alive = Object.keys(set.clips).some(has);
  if (!alive) tally.still++;
  const others = Object.keys(set.clips)
    .filter((k) => !MAIN.includes(k))
    .join(', ');
  const res = motion[c.id] ?? {};
  const waived = (typeof byEye[c.id] === 'object' ? byEye[c.id] : {}) as Record<string, string>;
  const failed = Object.entries(res).filter(([k, v]) => !v.ok && !waived[k]);
  const eye = Object.entries(res).filter(([k, v]) => !v.ok && waived[k]);
  if (eye.length) tally.eye++;
  if (failed.length) tally.fail++;
  const check = failed.length
    ? `FAILS ${failed.map(([k]) => k).join(', ')}`
    : eye.length
      ? `ok (${eye.map(([k]) => k).join(', ')} by eye)`
      : 'ok';
  const note = c.frontOnly ? ' (front view only)' : c.cameo ? ' (cameo)' : '';
  rows.push(
    `| ${c.id}${note} | ${c.group} | ${c.role} | ${frames(set, 'idle')} | ${frames(set, 'walk')} | ${frames(set, 'talk')} | ${others || '-'} | ${check} | ${failed.length || !alive ? 'no' : 'yes'} |`,
  );
}

let gate = '';
try {
  gate = execFileSync('node', ['tools/check/validate.ts', '--scope', '--art'], { cwd: ROOT, encoding: 'utf8' })
    .trim()
    .split('\n')
    .slice(-2)
    .join(' / ');
} catch (e) {
  gate = `FAILED: ${String((e as { stdout?: string }).stdout ?? e)
    .trim()
    .split('\n')
    .slice(-3)
    .join(' / ')}`;
}
let commit = 'unknown';
try {
  commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
} catch {}

const accepted = tally.all - tally.fail - tally.still;
const out = `# Art QA summary

Made by \`node tools/art/summary.ts\` at commit ${commit}. The gate is \`node tools/check/validate.ts --art\`; the
frame-by-frame notes are in \`art/qa/REVIEW.md\` and the strips in \`art/qa/review/\`.

- Cast characters: **${tally.all}**. Accepted: **${accepted}**. Open: **${tally.fail + tally.still}**.
- Animated: ${tally.idle} have an idle clip of two or more frames, ${tally.walk} a walk clip, ${tally.talk} a talk clip.
  Still pictures: ${tally.still}.
- Motion check (frames must differ enough to read as movement): ${tally.all - tally.eye - tally.fail} pass on the numbers
  alone, ${tally.eye} have one or more walk clips under the threshold that were looked at frame by frame and accepted
  (reasons in \`art/qa/motion-ok.json\`), ${tally.fail} fail.
- By role: ${Object.entries(roles)
  .map(([r, n]) => `${n} ${r}`)
  .join(', ')}.
- Gate: ${gate}
- Optional cameos on the build plan's list that were not drawn and are not in the game (${skipped.length}):
  ${skipped.join(', ') || 'none'}.

Frames are given as down/side/up (facing the camera, sideways, away). A dash means the role does not use that clip:
animals and hostile mobs do not speak, fixed characters do not walk.

| Character | Group | Role | Idle | Walk | Talk | Other clips | Motion check | Accepted |
|---|---|---|---|---|---|---|---|---|
${rows.join('\n')}
`;
writeFileSync(join(ROOT, 'art/qa/SUMMARY.md'), out);
console.log(out.split('\n').slice(4, 14).join('\n'));
console.log(
  `\nart/qa/SUMMARY.md written: ${tally.all} characters, ${accepted} accepted, ${tally.fail + tally.still} open`,
);
