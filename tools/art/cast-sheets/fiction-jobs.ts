// Produce one private, six-pose source plate for each registered fictional look.
// Run: node tools/art/cast-sheets/fiction-jobs.ts [--masters DIR] [--frames DIR]
//   [--output DIR] [--jobs FILE]
// Generation itself is performed only by tools/art/gen.ts, with one try per job.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { cast, type CastArt } from '../cast.ts';
import type { ArtJob } from '../gen.ts';
import { materialNote } from './fiction-materials.ts';

const root = resolve(import.meta.dirname, '../../..');
const args = process.argv.slice(2);
function option(name: string, fallback: string): string {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return fallback;
  if (!args[i + 1] || args[i + 1]!.startsWith('--')) throw new Error(`--${name} requires a path`);
  return resolve(args[i + 1]!);
}
const masters = option('masters', join(root, 'art/masters/chars'));
const frames = option('frames', join(root, 'art/src/chars'));
const output = option('output', join(root, 'art/masters/cast-series/fiction'));
const manifest = join(root, 'public/assets/chars/index.json');
const jobsFile = option('jobs', join(root, 'art/jobs/cast-series-fiction.json'));
// In-checkout paths stay relative so the default manifest is portable.
function jobPath(path: string): string {
  const local = relative(root, path);
  return local === '..' || local.startsWith('../') || isAbsolute(local) ? path : local;
}
type Indexed = { clips: Record<string, Record<string, string[]>> };
const sets = (JSON.parse(readFileSync(manifest, 'utf8')) as { sets: Record<string, Indexed> }).sets;
const excluded = new Set(['koala', 'hamm']);
const mouthless = new Set(['hello_kitty', 'mimmy']);

function walkPoses(c: CastArt): string[] {
  if (c.body === 'quad' || c.body === 'blob') {
    return [
      'Side walk contact: the near foreleg reaches towards the right of the picture and the far hind leg reaches left; other feet support the body.',
      'Side walk passing: those feet pass under the body, one forefoot and the opposite hind foot lifted.',
      'Side walk opposite contact: the near foreleg reaches left and the far hind leg reaches right, visibly reversing the first pose.',
    ];
  }
  if (c.body === 'spider') {
    return [
      'Side walk contact: first alternating group of four legs reaches right, the other four reach left.',
      'Side walk passing: the eight legs pass under the body, half lifted a little.',
      'Side walk opposite contact: the first four legs now reach left and the other four reach right, visibly reversing the first pose.',
    ];
  }
  if (c.body === 'bird') {
    return [
      'Side walk contact: the near foot reaches towards the right of the picture, the far foot reaches left.',
      'Side walk passing: feet pass under the body, one foot lifted.',
      'Side walk opposite contact: the near foot now reaches left, the far foot reaches right, visibly reversing the first pose.',
    ];
  }
  return [
    'Side walk contact: the near leg reaches towards the right of the picture and the far leg reaches left; the near arm swings left.',
    'Side walk passing: legs pass under the body, one knee lifted; arms pass at the sides.',
    'Side walk opposite contact: the near leg now reaches left and the far leg reaches right; the near arm swings right. Visibly reverse the first pose.',
  ];
}

function frontPoses(c: CastArt): { kind: string; poses: string[]; note: string } {
  if (mouthless.has(c.id)) {
    return {
      kind: 'mouthless_communication',
      poses: [
        'Front, calm and relaxed, paws down.',
        'Front, a small welcoming paw gesture.',
        'Front, an expressive two-paw gesture.',
      ],
      note: 'The character has no mouth; communication uses gestures only.',
    };
  }
  if (c.id === 'snow_golem') {
    return {
      kind: 'carved_face_communication',
      poses: [
        'Front, calm, stick arms down.',
        'Front, one stick arm lifted in a small gesture.',
        'Front, both stick arms lifted in an expressive greeting.',
      ],
      note: 'The carved pumpkin face remains unchanged; communication uses stick-arm gestures.',
    };
  }
  if (c.role === 'animal') {
    return {
      kind: 'animal_reaction',
      poses: [
        'Front, calm and alert in a neutral pose.',
        'Front, a small head tilt or blink.',
        'Front, a lively natural animal reaction, as if calling.',
      ],
      note: 'Animals do not speak; the lower row shows natural animal reactions.',
    };
  }
  if (c.role === 'hostile' || c.role === 'boss') {
    return {
      kind: 'mob_action',
      poses: [
        'Front, calm alert idle pose.',
        'Front, a small wind-up for the creature’s own attack.',
        'Front, a readable attack pose, without added objects or effects.',
      ],
      note: 'Hostiles and bosses do not speak; the lower row shows idle, wind-up and attack.',
    };
  }
  return {
    kind: 'talk',
    poses: [
      'Front talk: mouth closed, neutral listening pose.',
      'Front talk: mouth partly open, a small vowel shape.',
      'Front talk: mouth open expressively, a small speaking gesture.',
    ],
    note: 'The lower row shows closed, middle-vowel and expressive-open speech poses.',
  };
}

const jobs: (ArtJob & { metadata: Record<string, unknown> })[] = [];
for (const c of cast) {
  if (c.style === 'person' || excluded.has(c.id) || !sets[c.id]) continue;
  const set = sets[c.id]!;
  const side = set.clips.walk?.side?.[0];
  const front = set.clips.talk?.down?.[0] ?? set.clips.idle?.down?.[0] ?? set.clips.idle?.side?.[0];
  if (!front) throw new Error(`${c.id}: no suitable registered front frame`);
  const model = join(masters, c.id, 'model.png');
  const frontRef = join(frames, `${front}.png`);
  const sideRef = side ? join(frames, `${side}.png`) : null;
  const absoluteRefs = sideRef ? [model, sideRef, frontRef] : [model, frontRef];
  for (const ref of absoluteRefs) if (!existsSync(ref)) throw new Error(`${c.id}: missing reference ${ref}`);
  const refs = absoluteRefs.map(jobPath);
  const fixed = !side;
  const top = fixed
    ? [
        'Front neutral idle, arms resting.',
        'Front, a small one-handed or natural body gesture.',
        'Front, a welcoming expressive gesture, keeping the body in place.',
      ]
    : walkPoses(c);
  const bottom = frontPoses(c);
  const transparent = /magenta/i.test(c.desc);
  // Family terms are unnecessary in image prompts, even for fictional characters.
  const description = c.desc.replace(/\b(?:mother|father)\b/gi, 'adult');
  const background = transparent
    ? 'a truly transparent background with alpha, not a checkerboard and no coloured matte'
    : 'one perfectly uniform opaque flat magenta (#ff00ff) background';
  const face = c.views?.down ?? 'front-facing body and face towards the viewer';
  const sideView = c.views?.side ?? 'profile body and head facing RIGHT, the same direction as Image 2';
  const refsText = fixed
    ? 'Image 1 is the existing character model and Image 2 is the current front game sprite. Match their character and visual style.'
    : 'Image 1 is the existing character model, Image 2 the current side game sprite, Image 3 the current front game sprite. Match their character and visual style.';
  const notes = [
    c.sheetNote,
    c.id === 'spider_jockey'
      ? 'The skeleton remains seated on the spider, with the bow and all eight spider legs in every cell.'
      : '',
    c.id === 'slinky' ? 'The same continuous metal coil joins head and hindquarters in every cell.' : '',
    mouthless.has(c.id) ? 'Never add a mouth to this character.' : '',
    c.id === 'snow_golem'
      ? 'The carved pumpkin face keeps exactly the same fixed carved smile in every cell; the body has no legs.'
      : '',
  ]
    .filter(Boolean)
    .join(' ');
  const prompt = [
    'Make one clean 2D game animation sprite sheet with exactly 3 equal columns and 2 equal rows: exactly six separate full-body drawings of the SAME character.',
    refsText,
    `Character: ${description}.`,
    `Top row view: ${fixed ? face : sideView}. Bottom row view: ${face}.`,
    'In reading order, left to right:',
    ...top.map((pose, i) => `Top ${i + 1}: ${pose}`),
    ...bottom.poses.map((pose, i) => `Bottom ${i + 1}: ${pose}`),
    fixed
      ? ''
      : 'Top 1 and Top 3 are different moments, not duplicates: show the visible near legs and natural arms in opposite positions.',
    'Maintain identical character identity, costume, colours, proportions, art technique, apparent size, camera height and foot baseline in all six drawings. Do not change the design or add accessories. Keep carried props the same in every pose.',
    materialNote(c.id),
    notes,
    `Place each complete figure centred wholly within its own equal cell, with generous clear gutters and margin on all four sides, including ears, tails and held props. Do not crop, overlap cells, use grid lines or borders. Use ${background}.`,
    'No floor, ground, cast shadows, glow, text, labels, letters, logo, watermark, panel frame, additional characters or extra poses.',
  ]
    .filter(Boolean)
    .join('\n');
  jobs.push({
    id: `fiction_${c.id}`,
    out: jobPath(join(output, `${c.id}.png`)),
    refs,
    prompt,
    metadata: {
      character: c.id,
      role: c.role,
      body: c.body,
      tall: c.tall,
      grid: { columns: 3, rows: 2 },
      top: {
        kind: fixed ? 'fixed_gesture' : 'walk',
        facing: fixed ? 'down' : 'side',
        direction: fixed ? null : 'right',
        poses: top,
      },
      bottom: { kind: bottom.kind, facing: 'down', poses: bottom.poses },
      background: transparent ? 'transparent' : 'magenta',
      deviation: fixed ? `Fixed role: top row uses front gestures. ${bottom.note}` : bottom.note,
    },
  });
}
if (new Set(jobs.map((j) => j.id)).size !== jobs.length) throw new Error('Duplicate fictional character jobs');
writeFileSync(jobsFile, `${JSON.stringify(jobs, null, 2)}\n`);
console.log(`${jobs.length} fictional character jobs written to ${jobsFile}`);
