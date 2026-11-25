// Build anonymous, reference-free image jobs for the private cast.
// The image generator sees only the approved description column and generic art directions.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../..');
const work = process.env.ART_WORK;
if (!work) throw new Error('ART_WORK must identify the private image job directory');

const masters = resolve(root, 'art/masters/cast-series/private');
const descriptions = new Map<string, string>();
for (const line of readFileSync(resolve(root, 'docs/PEOPLE.md'), 'utf8').split('\n')) {
  if (!line.startsWith('|')) continue;
  const cells = line
    .slice(1, -1)
    .split('|')
    .map((s) => s.trim());
  if (cells.length === 5 && cells[0] !== 'Id' && cells[0] !== '---') {
    descriptions.set(cells[0]!, cells[3]!);
  }
}

// The two alias keys and the alternate look are local integration IDs, never image job IDs.
const cast = [
  ['amelia', 'amelia'],
  ['mum', 'mum'],
  ['dad', 'dad'],
  ['aunty', 'aunty_lou'],
  ['granny', 'granny'],
  ['nanny', 'nanny'],
  ['grandad', 'grandad'],
  ['grandad_xmas', 'grandad'],
  ['robin', 'robin'],
  ['sam', 'sam'],
  ['alex', 'alex'],
  ['charlie', 'charlie'],
  ['teacher', 'ms_lee'],
] as const;

const sheet = [
  'Create a single 3 columns by 2 rows animation sprite sheet, landscape 3:2 ratio, ideally 1536 by 1024 pixels.',
  'Use exactly six equal cells. Each cell contains a single complete pose of the same character, centred at a consistent size. Leave wide empty gutters between figures and ample empty space around each figure, so no part of a figure or its accessories crosses a cell boundary.',
  'Style: flat 2D storybook cartoon game sprite, chibi proportions, large round head and small body, simple friendly face, flat colours, clean dark-brown outlines, no gradients, no texture, no 3D shading.',
  'All six cells must use a uniform solid chroma magenta #ff00ff background. No shadows, ground, borders, grids, labels, letters, extra characters, or decorative elements.',
];
const walking = [
  'Top row: three sequential full-body walking poses in side profile facing RIGHT. First: one foot forward and the other back. Second: legs passing under the body. Third: the opposite foot forward. Arms move naturally with the steps.',
  'Bottom row: three front-facing talking poses, same stance and face in each: mouth closed, mouth half open, mouth open.',
];
const seated = [
  'Top row: three front-facing poses with the figure and all described furniture remaining seated and in place throughout. Use three small sequential hand gestures, no walking.',
  'Bottom row: three front-facing talking poses, preserving the same seated position and furniture: mouth closed, mouth half open, mouth open.',
];

const jobs = [];
const mapping: Record<string, string> = {};
for (const [index, [id, source]] of cast.entries()) {
  const description = descriptions.get(source);
  if (!description) throw new Error('A cast description is missing');
  const anonymous = `sheet-${String(index + 1).padStart(3, '0')}`;
  const destination = resolve(masters, `${anonymous}.png`);
  mapping[id] = destination;
  const option =
    id === 'grandad'
      ? 'Use the first option in the following description in every cell, without its optional variant.'
      : id === 'grandad_xmas'
        ? 'Use the variant option in the following description in every cell.'
        : '';
  const prompt = [...sheet, ...(id === 'aunty' ? seated : walking), option, 'Character description:', description]
    .filter(Boolean)
    .join('\n');
  jobs.push({ id: anonymous, out: destination, prompt });
}

mkdirSync(work, { recursive: true, mode: 0o700 });
writeFileSync(resolve(work, 'jobs.json'), JSON.stringify(jobs, null, 2) + '\n', { mode: 0o600 });
mkdirSync(masters, { recursive: true, mode: 0o700 });
writeFileSync(resolve(masters, 'private-map.json'), JSON.stringify(mapping, null, 2) + '\n', { mode: 0o600 });
console.log(`Prepared ${jobs.length} anonymous sheets and a local mapping.`);
