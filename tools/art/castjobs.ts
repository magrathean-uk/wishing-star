// Write the job lists for the cast: node tools/art/castjobs.ts models|sheets|fine [--only a,b] [--cameos] [--out file.json]
// fine: the finer sheets of package 58 (D63); --tag t writes <key>-t.png instead, to compare two models
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { cast } from './cast.ts';
import type { ArtJob } from './gen.ts';
import { fineSheetsFor, modelPrompt, sheetPrompt, sheetsFor } from './sheets.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const argv = process.argv.slice(2);
const what = argv[0] ?? 'models';
const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1]!.split(',') : null;
const cameos = argv.includes('--cameos');
const tag = argv.includes('--tag') ? `-${argv[argv.indexOf('--tag') + 1]}` : '';
const dir = (id: string) => `art/masters/chars/${id}/`;
const jobs: ArtJob[] = [];
for (const c of cast) {
  if (only && !only.includes(c.id)) continue;
  if (!only && !!c.cameo !== cameos) continue;
  // Real people share one storybook look: the first person drawn is the style reference for the rest.
  const family = c.family ?? (c.style === 'person' && c.id !== 'amelia' ? 'amelia' : undefined);
  const famRef = family ? [dir(family) + 'model.png'] : [];
  // a likeness reference from the other game (D21, D24): shown to the image tool only, never shipped
  const like = c.likeness ? [c.likeness.replace(/^~\//, `${homedir()}/`)] : [];
  if (what === 'models') {
    const soft = c.soft ?? c.desc;
    if (like.length && !famRef.length) {
      jobs.push({
        id: `${c.id}_model`,
        out: dir(c.id) + 'model.png',
        refs: like,
        prompt: modelPrompt(c, c.desc, false, true),
        alts: [
          { prompt: modelPrompt(c, soft, false, true), refs: like },
          { prompt: modelPrompt(c, soft, false), refs: [] },
        ],
      });
      continue;
    }
    jobs.push({
      id: `${c.id}_model`,
      out: dir(c.id) + 'model.png',
      refs: famRef,
      prompt: modelPrompt(c, c.desc, famRef.length > 0),
      alts: [
        { prompt: modelPrompt(c, soft, famRef.length > 0), refs: famRef },
        { prompt: modelPrompt(c, soft, false), refs: [] },
        { prompt: modelPrompt(c, soft, famRef.length > 0), refs: famRef },
        { prompt: modelPrompt(c, soft, false), refs: [] },
      ],
    });
  } else {
    if (!existsSync(resolve(ROOT, dir(c.id) + 'model.png'))) continue;
    for (const sh of what === 'fine' ? fineSheetsFor(c) : sheetsFor(c)) {
      const model = [dir(c.id) + 'model.png'];
      jobs.push({
        id: `${c.id}_${sh.key}`,
        out: dir(c.id) + sh.key + tag + '.png',
        refs: [...model, ...like],
        prompt: sheetPrompt(c, sh, 'ref', c.desc, like.length > 0),
        alts: [
          ...(like.length ? [{ prompt: sheetPrompt(c, sh, 'ref', c.desc), refs: model }] : []),
          { prompt: sheetPrompt(c, sh, 'own', c.desc), refs: model },
          { prompt: sheetPrompt(c, sh, 'text', c.soft ?? c.desc), refs: [] },
          { prompt: sheetPrompt(c, sh, 'text', c.soft ?? c.desc), refs: [] },
        ],
      });
    }
  }
}
mkdirSync(resolve(ROOT, 'art/jobs'), { recursive: true });
const out = argv.includes('--out')
  ? resolve(argv[argv.indexOf('--out') + 1]!)
  : resolve(ROOT, `art/jobs/${what}${cameos ? '-cameos' : ''}.jobs.json`);
writeFileSync(out, JSON.stringify(jobs, null, 1));
const all = cast.filter((c) => !!c.cameo === cameos);
console.log(`${jobs.length} jobs written to ${out}`);
if (what === 'models') {
  let total = 0;
  for (const c of all) total += sheetsFor(c).length;
  console.log(`cast: ${all.length} looks, ${total} animation sheets to follow`);
}
