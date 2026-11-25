// Sprite sheet layouts: which pose sits in which cell, per role and body type.
// The same table writes the prompts and slices the finished sheets, so the two can never drift apart.
import type { ArtBody, CastArt } from './cast.ts';

export type Facing = 'down' | 'side' | 'up';
export interface Cell {
  clip: string;
  facing: Facing;
  n: number;
  pose: string;
}
export interface Sheet {
  key: string;
  grid: number;
  cells: Cell[];
}

const BASE_VIEW: Record<Facing, string> = {
  down: 'FRONT VIEW facing the viewer',
  side: 'SIDE VIEW (profile), facing RIGHT',
  up: 'BACK VIEW (seen from behind, walking away from the viewer, face not visible)',
};

type Poses = Record<string, string[]>;
const BIPED: Record<Facing, Poses> = {
  down: {
    idle: ['Idle: standing relaxed, eyes open.', 'Idle: same pose, eyes closed in a blink, shoulders a little higher.'],
    walk: [
      'Walk: left leg lifted with bent knee, right arm swung forward.',
      'Walk: both feet on the ground close together, standing tall.',
      'Walk: right leg lifted with bent knee, left arm swung forward.',
      'Walk: both feet on the ground close together, arms swung the other way.',
    ],
    talk: ['Talk: mouth wide open, arms relaxed.', 'Talk: mouth half open, one hand lifted in a small gesture.'],
    wave: [
      'Wave: one arm raised high, waving, big smile.',
      'Wave: the same arm raised and tilted the other way, big smile.',
    ],
    swing: [
      'Swing: right arm raised high above the shoulder, hand closed as if holding a tool (hand empty), body leaning back.',
      'Swing: right arm swung forward at chest height, body leaning forward.',
      'Swing: right arm swung down low in front, knees bent.',
    ],
    hurt: [
      'Hurt: flinching, eyes squeezed shut, arms pulled in.',
      'Hurt: leaning back, mouth open in an "ouch", one foot off the ground.',
    ],
    cheer: [
      'Cheer: crouching a little, fists by the chest, big grin.',
      'Cheer: jumping, both arms straight up, feet off the ground.',
    ],
    laugh: [
      'Laugh: head tipped back, eyes closed, mouth wide open.',
      'Laugh: leaning forward, one hand on the tummy, eyes closed.',
    ],
    surprised: ['Surprised: eyes very wide, mouth a small "o", arms out.'],
    think: ['Thinking: one hand on the chin, eyes looking up.'],
    sleep: [
      'Asleep on their feet: eyes closed, head tilted to one side, peaceful smile, arms relaxed.',
      'Asleep on their feet: the same, head a little lower, mouth slightly open.',
    ],
    sit: ['Sitting on the ground, legs out in front, happy.'],
    attack: [
      'Attack: both arms raised up high.',
      'Attack: both arms swung down forward, body lunging forward.',
      'Attack: arms low after the swing, leaning forward.',
    ],
    dizzy: ['Dizzy: wobbling, swirly eyes, arms loose.', 'Dizzy: leaning the other way, swirly eyes.'],
    calm: ['Calm: sitting down small and quiet, gentle smile.', 'Calm: sitting, eyes closed, taking a slow breath.'],
  },
  side: {
    idle: ['Idle: standing relaxed, eyes open.', 'Idle: same pose, eye closed in a blink.'],
    walk: [
      'Walk: front leg stretched forward, back leg stretched behind (wide stride), arms swinging opposite.',
      'Walk: legs passing under the body, one knee lifted.',
      'Walk: the other leg stretched forward (wide stride), arms swinging opposite.',
      'Walk: legs passing under the body, the other knee lifted.',
    ],
    talk: ['Talk: mouth wide open.', 'Talk: mouth half open, one hand lifted.'],
    swing: [
      'Swing: arm raised high behind the head, hand closed as if holding a tool (hand empty).',
      'Swing: arm swung forward at chest height, body leaning forward.',
      'Swing: arm swung down low in front, knees bent.',
    ],
    hurt: ['Hurt: flinching backwards, eyes squeezed shut.', 'Hurt: leaning far back, mouth open in an "ouch".'],
    fish: [
      'Fishing: both hands held forward as if gripping a rod (hands empty), leaning back a little.',
      'Fishing: the same, leaning forward, watching closely.',
      'Fishing: pulling back hard with both hands, excited face.',
    ],
    attack: [
      'Attack: both arms raised up high.',
      'Attack: both arms swung down forward, body lunging forward.',
      'Attack: arms low after the swing, leaning forward.',
    ],
    dizzy: ['Dizzy: wobbling, swirly eye, arms loose.', 'Dizzy: leaning the other way, swirly eye.'],
    wave: ['Wave: one arm raised, waving.', 'Wave: the same arm tilted the other way.'],
  },
  up: {
    idle: ['Idle: standing relaxed.', 'Idle: same pose, shoulders a little higher.'],
    walk: [
      'Walk: left leg lifted with bent knee, right arm swung back.',
      'Walk: both feet on the ground close together, standing tall.',
      'Walk: right leg lifted with bent knee, left arm swung back.',
      'Walk: both feet on the ground close together, arms swung the other way.',
    ],
    swing: [
      'Swing: right arm raised high above the shoulder, hand closed as if holding a tool (hand empty).',
      'Swing: right arm swung forward at chest height.',
      'Swing: right arm swung down low, knees bent.',
    ],
    attack: [
      'Attack: both arms raised up high.',
      'Attack: both arms swung down forward.',
      'Attack: arms low after the swing.',
    ],
    hurt: ['Hurt: flinching, shoulders hunched.', 'Hurt: stumbling, one foot off the ground.'],
    look: ['Idle: looking over one shoulder.'],
    wave: ['Wave: one arm raised, waving.'],
  },
};
const QUAD: Record<Facing, Poses> = {
  down: {
    idle: [
      'Idle: standing on all four legs, looking at the viewer.',
      'Idle: head lowered to sniff or graze, eyes closed.',
    ],
    walk: [
      'Walk towards the viewer: front left leg lifted.',
      'Walk: all four feet on the ground.',
      'Walk: front right leg lifted.',
      'Walk: all four feet on the ground, body a little lower.',
    ],
    hop: ['Hop: a small jump, all four feet off the ground, legs tucked.', 'Hop: landing, legs bent, happy.'],
    talk: ['Talk: mouth wide open, head up.', 'Talk: mouth half open, head tilted.'],
    wave: ['Wave: one front leg lifted in a little wave.', 'Wave: the same leg lifted higher, big smile.'],
  },
  side: {
    idle: ['Idle: standing on all four legs, head up.', 'Idle: head lowered to sniff or graze.'],
    walk: [
      'Walk: legs spread wide in a stride.',
      'Walk: legs gathered under the body.',
      'Walk: the other legs spread wide in a stride.',
      'Walk: legs gathered under the body, body a little higher.',
    ],
    hop: ['Hop: a small jump, all four feet off the ground.', 'Hop: landing, legs bent.'],
    talk: ['Talk: mouth wide open, head up.', 'Talk: mouth half open.'],
  },
  up: {
    idle: ['Idle: standing on all four legs.', 'Idle: head lowered, tail swished to one side.'],
    walk: [
      'Walk away from the viewer: back left leg lifted.',
      'Walk: all four feet on the ground.',
      'Walk: back right leg lifted.',
      'Walk: all four feet on the ground, body a little lower.',
    ],
    hop: ['Hop: a small jump, all four feet off the ground.', 'Hop: landing, legs bent.'],
    look: ['Idle: looking back over the shoulder.'],
  },
};
const BIRD: Record<Facing, Poses> = {
  down: {
    idle: ['Idle: standing, looking at the viewer.', 'Idle: pecking at the ground, head down.'],
    walk: [
      'Walk towards the viewer: left foot lifted, head forward.',
      'Walk: both feet down, head back.',
      'Walk: right foot lifted, head forward.',
      'Walk: both feet down, head back.',
    ],
    hop: ['Hop: a flappy jump, wings out, feet off the ground.', 'Hop: landing, wings half folded.'],
  },
  side: {
    idle: ['Idle: standing, head up.', 'Idle: pecking at the ground, head down.'],
    walk: [
      'Walk: one foot stepping forward, head forward.',
      'Walk: feet together, head back.',
      'Walk: the other foot stepping forward, head forward.',
      'Walk: feet together, head back.',
    ],
    hop: ['Hop: a flappy jump, wings out, feet off the ground.', 'Hop: landing, wings half folded.'],
  },
  up: {
    idle: ['Idle: standing.', 'Idle: pecking at the ground, tail up.'],
    walk: [
      'Walk away: left foot lifted.',
      'Walk: both feet down.',
      'Walk: right foot lifted.',
      'Walk: both feet down.',
    ],
    hop: ['Hop: a flappy jump, wings out.', 'Hop: landing.'],
    look: ['Idle: looking back over the shoulder.'],
  },
};
const blobFront: Poses = {
  idle: ['Idle: standing still.', 'Idle: head tilted a little to one side.'],
  walk: [
    'Walk: the left pair of feet stepped forward.',
    'Walk: all feet together.',
    'Walk: the right pair of feet stepped forward.',
    'Walk: all feet together, body leaning a little.',
  ],
  attack: [
    'About to pop: body a little swollen, colour lighter.',
    'About to pop: body more swollen, flashing almost white.',
    'About to pop: body at its biggest, bright white, tiny sparks around it.',
  ],
  hurt: ['Hurt: knocked backwards, eyes squeezed.', 'Hurt: wobbling to one side.'],
  dizzy: ['Dizzy: swaying, swirly eyes, little stars above the head.', 'Dizzy: swaying the other way, swirly eyes.'],
  calm: [
    'Calm: sitting down small and quiet, holding one little flower.',
    'Calm: sitting, eyes closed, taking a slow breath.',
  ],
  surprised: ['Surprised: eyes very wide.'],
  stomp: [
    'Stomp: one side lifted high, about to stamp.',
    'Stomp: slammed down, dust at the feet.',
    'Stomp: crouched after the stamp.',
  ],
  summon: [
    'Calling: head thrown back, mouth open.',
    'Calling: leaning forward, mouth open wide.',
    'Calling: standing tall, worried.',
  ],
};
const BLOB: Record<Facing, Poses> = {
  down: blobFront,
  side: blobFront,
  up: { ...blobFront, look: ['Idle: turned slightly as if listening.'] },
};
const spiderPoses: Poses = {
  idle: ['Idle: crouched low, legs spread.', 'Idle: body raised a little, legs spread.'],
  walk: [
    'Walk: legs on one side forward, the others back.',
    'Walk: all legs level.',
    'Walk: the other legs forward.',
    'Walk: all legs level, body a little higher.',
  ],
  attack: [
    'Attack: reared up, front legs raised high.',
    'Attack: pouncing forward, front legs stretched out.',
    'Attack: landed low, legs bent.',
  ],
  hurt: ['Hurt: knocked back, legs curled.', 'Hurt: flipped half over, legs in the air.'],
  hop: ['Hop: jumping, all legs tucked.', 'Hop: landing, legs spread wide.'],
  dizzy: ['Dizzy: wobbling, swirly eyes.', 'Dizzy: wobbling the other way.'],
};
const SPIDER: Record<Facing, Poses> = {
  down: spiderPoses,
  side: spiderPoses,
  up: { ...spiderPoses, look: ['Idle: turned slightly.'] },
};
const LIB: Record<ArtBody, Record<Facing, Poses>> = {
  biped: BIPED,
  quad: QUAD,
  bird: BIRD,
  blob: BLOB,
  spider: SPIDER,
};

/** The snow golem has no legs and a carved pumpkin face: it sways on its snow blocks and its carved mouth moves. */
const SNOW_GOLEM: Record<string, string[]> = {
  idle: [
    'Idle: standing straight, stick arms relaxed down at the sides, happy carved smile.',
    'Idle: the whole body swayed a little to one side, the pumpkin head tilted, one stick arm a little out.',
  ],
  talk: [
    'Talk: the carved mouth opened wide in a big round hole, stick arms relaxed.',
    'Talk: the carved mouth almost closed in a small smile, one stick arm lifted in a small gesture.',
  ],
  wave: [
    'Wave: the stick arm on the right side of the picture raised high above the head, waving, the other arm down, big carved smile.',
    'Wave: the same arm on the right side of the picture still raised, tilted outwards, the other arm still down, big carved smile.',
  ],
  cheer: ['Cheer: both stick arms straight up, a little hop off the ground, big carved grin.'],
  laugh: ['Laugh: pumpkin head tipped back, carved mouth wide open, stick arms out.'],
  surprised: ['Surprised: carved eyes and mouth round "o" shapes, stick arms flung out to the sides.'],
};

type Want = [clip: string, facing: Facing, count: number];
function build(c: CastArt, key: string, grid: number, wants: Want[], custom: Record<string, string[]> = {}): Sheet {
  const cells: Cell[] = [];
  for (const [clip, facing, count] of wants) {
    const poses = custom[clip] ?? LIB[c.body][facing][clip] ?? BIPED[facing][clip];
    if (!poses) throw new Error(`no poses for ${c.id} ${clip} ${facing}`);
    for (let n = 0; n < count; n++) cells.push({ clip, facing, n, pose: poses[n % poses.length]! });
  }
  if (cells.length !== grid * grid)
    throw new Error(`${c.id} ${key}: ${cells.length} cells for a ${grid} x ${grid} grid`);
  return { key, grid, cells };
}

export function sheetsFor(c: CastArt): Sheet[] {
  const D: Facing = 'down';
  const S: Facing = 'side';
  const U: Facing = 'up';
  if (c.layout === 'forky')
    return [
      build(
        c,
        'f9',
        3,
        [
          ['idle', D, 2],
          ['talk', D, 2],
          ['wave', D, 2],
          ['hop', D, 3],
        ],
        {
          hop: [
            'Hop: a little bounce, both stick feet off the ground, arms up.',
            'Hop: landing, stick legs bent, wobbling.',
            'Hop: standing again, leaning the other way, happy.',
          ],
        },
      ),
    ];
  switch (c.role) {
    case 'hero': {
      const e = c.emote ?? 'a happy dance';
      const emote = [
        `Their own happy move, step 1 of 4: ${e}.`,
        `Step 2 of 4 of the same move: ${e}.`,
        `Step 3 of 4 of the same move: ${e}.`,
        `Step 4 of 4, the big finish of the same move: ${e}.`,
      ];
      return [
        build(c, 'f16', 4, [
          ['idle', D, 2],
          ['walk', D, 4],
          ['talk', D, 2],
          ['swing', D, 3],
          ['hurt', D, 2],
          ['wave', D, 2],
          ['surprised', D, 1],
        ]),
        build(c, 's16', 4, [
          ['idle', S, 2],
          ['walk', S, 4],
          ['talk', S, 2],
          ['swing', S, 3],
          ['hurt', S, 2],
          ['fish', S, 3],
        ]),
        build(c, 'b9', 3, [
          ['idle', U, 2],
          ['walk', U, 4],
          ['swing', U, 3],
        ]),
        build(
          c,
          'x9',
          3,
          [
            ['cheer', D, 4],
            ['sleep', D, 2],
            ['sit', D, 1],
            ['laugh', D, 2],
          ],
          { cheer: emote },
        ),
      ];
    }
    case 'walker':
      if (c.frontOnly)
        return [
          build(c, 'f16', 4, [
            ['idle', D, 2],
            ['walk', D, 4],
            ['talk', D, 2],
            ['wave', D, 2],
            ['cheer', D, 2],
            ['laugh', D, 2],
            ['surprised', D, 1],
            ['think', D, 1],
          ]),
        ];
      return [
        build(c, 'f16', 4, [
          ['idle', D, 2],
          ['walk', D, 4],
          ['talk', D, 2],
          ['wave', D, 2],
          ['cheer', D, 2],
          ['laugh', D, 2],
          ['surprised', D, 1],
          ['think', D, 1],
        ]),
        build(c, 'sb16', 4, [
          ['idle', S, 2],
          ['walk', S, 4],
          ['talk', S, 2],
          ['idle', U, 2],
          ['walk', U, 4],
          ['look', U, 1],
          ['wave', U, 1],
        ]),
      ];
    case 'fixed':
      return [
        build(
          c,
          'f9',
          3,
          c.body === 'quad'
            ? [
                ['idle', D, 2],
                ['talk', D, 2],
                ['wave', D, 2],
                ['hop', D, 2],
                ['walk', D, 1],
              ]
            : [
                ['idle', D, 2],
                ['talk', D, 2],
                ['wave', D, 2],
                ['cheer', D, 1],
                ['laugh', D, 1],
                ['surprised', D, 1],
              ],
          c.id === 'snow_golem' ? SNOW_GOLEM : {},
        ),
      ];
    case 'speakingMob':
      return [
        build(c, 'f9', 3, [
          ['idle', D, 2],
          ['walk', D, 4],
          ['talk', D, 2],
          ['surprised', D, 1],
        ]),
        build(c, 'sb16', 4, [
          ['idle', S, 2],
          ['walk', S, 4],
          ['talk', S, 2],
          ['idle', U, 2],
          ['walk', U, 4],
          ['look', U, 1],
          ['wave', U, 1],
        ]),
      ];
    case 'hostile':
      return [
        build(
          c,
          'f16',
          4,
          [
            ['idle', D, 2],
            ['walk', D, 4],
            ['attack', D, 3],
            ['hurt', D, 2],
            ['dizzy', D, 2],
            ['calm', D, 2],
            ['surprised', D, 1],
          ],
          c.body === 'spider'
            ? {
                calm: ['Friendly: crouched low, relaxed.', 'Friendly: one front leg lifted in a little wave.'],
                surprised: ['Surprised: jumped up a little.'],
              }
            : {},
        ),
        build(c, 's16', 4, [
          ['idle', S, 2],
          ['walk', S, 4],
          ['attack', S, 3],
          ['hurt', S, 2],
          ['dizzy', S, 2],
          ['idle', S, 2],
          ['walk', S, 1],
        ]),
        build(c, 'b9', 3, [
          ['idle', U, 2],
          ['walk', U, 4],
          ['attack', U, 3],
        ]),
      ];
    case 'animal':
      if (c.body === 'biped')
        return [
          build(c, 'f9', 3, [
            ['idle', D, 2],
            ['walk', D, 4],
            ['cheer', D, 2],
            ['sit', D, 1],
          ]),
          build(c, 'sb16', 4, [
            ['idle', S, 2],
            ['walk', S, 4],
            ['wave', S, 2],
            ['idle', U, 2],
            ['walk', U, 4],
            ['look', U, 1],
            ['wave', U, 1],
          ]),
        ];
      return [
        build(c, 'fs16', 4, [
          ['idle', D, 2],
          ['walk', D, 4],
          ['hop', D, 2],
          ['idle', S, 2],
          ['walk', S, 4],
          ['hop', S, 2],
        ]),
        build(c, 'b9', 3, [
          ['idle', U, 2],
          ['walk', U, 4],
          ['hop', U, 2],
          ['look', U, 1],
        ]),
      ];
    case 'boss':
      if (c.id === 'creeper_king')
        return [
          build(c, 'f16', 4, [
            ['idle', D, 2],
            ['summon', D, 3],
            ['stomp', D, 3],
            ['attack', D, 3],
            ['dizzy', D, 2],
            ['calm', D, 2],
            ['hurt', D, 1],
          ]),
          build(c, 's9', 3, [
            ['idle', S, 2],
            ['walk', S, 4],
            ['dizzy', S, 2],
            ['hurt', S, 1],
          ]),
        ];
      return [
        build(
          c,
          'f16',
          4,
          [
            ['idle', D, 2],
            ['walk', D, 4],
            ['attack', D, 3],
            ['hop', D, 2],
            ['dizzy', D, 2],
            ['hurt', D, 2],
            ['idle', D, 1],
          ],
          {
            attack: ['The rider draws the bow back.', 'The rider lets an arrow fly.', 'The rider lowers the bow.'],
            dizzy: ['Dizzy: both wobbling, swirly eyes.', 'Dizzy: wobbling the other way.'],
          },
        ),
        build(
          c,
          's16',
          4,
          [
            ['idle', S, 2],
            ['walk', S, 4],
            ['attack', S, 3],
            ['hop', S, 2],
            ['dizzy', S, 2],
            ['hurt', S, 2],
            ['idle', S, 1],
          ],
          {
            attack: ['The rider draws the bow back.', 'The rider lets an arrow fly.', 'The rider lowers the bow.'],
            dizzy: ['Dizzy: both wobbling, swirly eyes.', 'Dizzy: wobbling the other way.'],
          },
        ),
      ];
  }
}

const STYLE: Record<CastArt['style'], string> = {
  show: 'flat 2D cartoon game sprite; flat colours; clean confident outlines; no gradients, no texture, no 3D shading',
  toy: 'flat 2D cartoon game sprite; flat colours; clean confident dark outlines; no gradients, no 3D shading',
  kawaii: 'flat 2D kawaii cartoon game sprite; flat colours; thick clean dark outline; no gradients, no 3D shading',
  person:
    'flat 2D storybook cartoon game sprite; chibi proportions (large round head about one third of the height, small body); simple friendly face with dot eyes and a warm smile; flat colours; clean dark-brown outlines; no gradients, no texture, no 3D shading',
  crayon:
    'flat 2D preschool cartoon game sprite; flat colours with no shading; a thin, slightly wobbly crayon-like dark outline; no gradients, no texture, no 3D shading',
  block:
    'flat 2D game sprite of a blocky voxel-game character; pixel-art surface texture with big square pixels; clean dark outline; no gradients, no soft shading',
};
const BACKDROP =
  'Scene/backdrop: fully transparent background (real alpha); no ground, no cast shadow, no glow, no halo, no scenery';
const LIMITS = 'no text, no letters, no numbers, no logo, no watermark, no border, no white sticker outline';

export function modelPrompt(c: CastArt, desc: string, withFamily: boolean, withLikeness = false): string {
  const view =
    c.body === 'quad' || c.body === 'bird' || c.body === 'spider' || c.role === 'boss'
      ? 'three-quarter SIDE VIEW, facing right'
      : (c.views?.down ?? 'FRONT VIEW facing the viewer');
  const pose =
    c.id === 'aunty' ? `${desc}. Full figure with the counter, ${view}` : `${desc}. Standing, full body, ${view}`;
  return [
    'Use case: stylized-concept',
    'Asset type: 2D game character sprite, model image for a home-made game',
    withFamily
      ? 'Input images: Image 1: another character from the same picture book (match its art style, line weight and colour style; draw a different character)'
      : withLikeness
        ? 'Input images: Image 1: likeness reference of this very character (match its body shape, proportions, face, ears and colours closely; redraw it as a flat 2D cartoon in the style below, not a copy of the picture)'
        : '',
    `Primary request: ${pose}`,
    'Composition/framing: exactly one character, centred, square canvas, whole body inside the frame with a clear margin',
    `Style/medium: ${STYLE[c.style]}`,
    BACKDROP,
    `Constraints: ${LIMITS}`,
  ]
    .filter(Boolean)
    .join('\n');
}

export function sheetPrompt(
  c: CastArt,
  sheet: Sheet,
  mode: 'ref' | 'own' | 'text',
  desc: string,
  withLikeness = false,
): string {
  const facings = [...new Set(sheet.cells.map((x) => x.facing))];
  const VIEW = { ...BASE_VIEW, ...c.views };
  const viewLine =
    facings.length === 1
      ? `every pose in ${VIEW[facings[0]!]}`
      : `cells 1 to ${sheet.cells.findIndex((x) => x.facing !== facings[0])} in ${VIEW[facings[0]!]}, the rest in ${VIEW[facings[1]!]}`;
  const poses = sheet.cells
    .map(
      (cell, i) =>
        `${i + 1}. ${facings.length > 1 ? (cell.facing === 'down' ? 'Front' : cell.facing === 'side' ? 'Side' : 'Back') + ', ' : ''}${cell.pose}`,
    )
    .join('\n');
  const who = mode === 'text' ? `one character: ${desc}` : 'the same character as Image 1';
  const head =
    mode === 'ref'
      ? [
          'Use case: identity-preserve',
          'Asset type: 2D game sprite sheet (animation frames)',
          'Input images: Image 1: model image of the character (keep identity, proportions, colours and line style exactly)',
          ...(withLikeness
            ? [
                'Image 2: likeness reference of the same character, for body shape, ears and colours only (where they differ, Image 1 wins; keep the flat 2D style of Image 1)',
              ]
            : []),
        ]
      : mode === 'own'
        ? [
            'Use case: stylized-concept',
            'Asset type: 2D game sprite sheet (animation frames) for a home-made game',
            'Input images: Image 1: our own character design sheet (keep proportions, colours and line style exactly)',
          ]
        : ['Use case: stylized-concept', 'Asset type: 2D game sprite sheet (animation frames) for a home-made game'];
  return [
    ...head,
    `Primary request: Draw ${who} as a sprite sheet: a ${sheet.grid} x ${sheet.grid} grid of ${sheet.grid * sheet.grid} equal square cells on one square canvas, one full-body pose per cell, ${viewLine}. Poses, left to right, top row first:`,
    poses,
    ...(c.sheetNote && mode !== 'text' ? [`Character notes: ${c.sheetNote}`] : []),
    ...(sheet.key.startsWith('n') ? [FINE_NOTE] : []),
    ...(sheet.key.startsWith('n') && MOVE_NOTE[c.id] ? [MOVE_NOTE[c.id]!] : []),
    'Composition/framing: the character is the same size in every cell, same camera angle, centred in its cell, feet on the same baseline in every row; clear empty space between cells; no grid lines, no cell borders, no labels',
    `Style/medium: ${STYLE[c.style]}`,
    BACKDROP,
    `Constraints: the same character design in every cell; whole body inside each cell; ${LIMITS}`,
  ].join('\n');
}

// ---------------------------------------------------------------- finer clips (package 58, D63)
// Walk 8 frames a facing (contact, weight, passing, lift, then the other leg), idle 4 (rest, breath, half blink,
// blink), talk 4 with a finer mouth and a small head tilt, and in-between frames for the special clips.
// A character uses these sheets only when every one of them exists (see `mastersFor`): all old or all new.

const fineWalk = (front: string, back: string, view: 'down' | 'side' | 'up'): string[] => {
  const legs = (lead: string, trail: string, arm: string) =>
    view === 'side'
      ? [
          `Walk 1 of 4 for the ${lead} leg (contact): the ${lead} leg stretched forward with the heel just touching the ground, the ${trail} leg stretched behind on its toes; the arm on the ${trail} side swung forward; hair and loose clothes trail back a little.`,
          `Walk 2 of 4 for the ${lead} leg (weight): the ${lead} foot flat, knee softly bent taking the weight, the whole body a little lower; the ${trail} foot just lifting off behind; arms closer to the body.`,
          `Walk 3 of 4 for the ${lead} leg (passing): standing straight on the ${lead} leg under the body, the ${trail} knee lifted and passing it; arms by the sides; body back to full height.`,
          `Walk 4 of 4 for the ${lead} leg (lift): up on the toes of the ${lead} foot, body at its highest, the ${trail} knee bent and swinging forward, its foot still close under the hips (not yet a wide stride); arms nearly by the sides; hair bounces up a little.`,
        ]
      : [
          `Walk 1 of 4 for the ${lead} foot (contact): the ${lead} foot stepping ${front} and just landing, the ${trail} foot behind it on its toes; the ${arm} arm swung ${front}, the other arm ${back}; hair swings a little to one side.`,
          `Walk 2 of 4 for the ${lead} foot (weight): the weight landing on the ${lead} foot, knee softly bent, the whole body a little lower; both arms closer to the sides; hair settling.`,
          `Walk 3 of 4 for the ${lead} foot (passing): standing straight on the ${lead} leg, the ${trail} knee lifted and passing it, arms by the sides; body back to full height.`,
          `Walk 4 of 4 for the ${lead} foot (lift): up on the toes of the ${lead} foot, body at its highest, the ${trail} foot swinging ${front}; the other arm starting ${front}; hair bounces a little.`,
        ];
  return [...legs('right', 'left', 'left'), ...legs('left', 'right', 'right')];
};

const FINE_BIPED: Record<Facing, Poses> = {
  down: {
    idle: [
      'Idle: standing relaxed, eyes open, arms loose by the sides.',
      'Idle, breathing in: exactly the same pose, chest and shoulders a little higher, arms a touch further from the body.',
      'Idle, blinking: exactly the same pose as cell 1, eyes half closed.',
      'Idle, blinking: exactly the same pose as cell 1, eyes fully closed.',
    ],
    walk: fineWalk('towards the viewer', 'back', 'down'),
    talk: [
      'Talk: mouth closed in a smile, head straight, arms relaxed.',
      'Talk: mouth half open, head tilted slightly to the left.',
      'Talk: mouth wide open, one hand lifted a little in a small gesture.',
      'Talk: mouth a small round "o", head tilted slightly to the right.',
    ],
    swing: [
      'Swing 1 of 4: right arm drawn back and up above the shoulder, hand closed as if holding a tool (hand empty), body leaning back.',
      'Swing 2 of 4: right arm coming over the head, body starting to lean forward.',
      'Swing 3 of 4: right arm swung forward at chest height, body leaning forward, front knee bent.',
      'Swing 4 of 4: right arm swung down low in front, knees bent, follow-through.',
    ],
    hurt: [
      'Hurt 1 of 3: flinching, eyes squeezed shut, arms pulled in.',
      'Hurt 2 of 3: leaning back, mouth open in an "ouch", one foot off the ground.',
      'Hurt 3 of 3: steadying again, one hand rubbing the arm, small frown.',
    ],
    wave: [
      'Wave 1 of 3: one arm raised high, hand open, big smile.',
      'Wave 2 of 3: the same arm tilted out to the side, big smile.',
      'Wave 3 of 3: the same arm tilted in over the head, big smile.',
    ],
    cheer: [
      'Cheer 1 of 3: crouching a little, fists by the chest, big grin.',
      'Cheer 2 of 3: springing up, arms rising, feet leaving the ground.',
      'Cheer 3 of 3: in the air, both arms straight up, feet off the ground.',
    ],
    laugh: [
      'Laugh 1 of 3: head tipped back, eyes closed, mouth wide open.',
      'Laugh 2 of 3: leaning forward, one hand on the tummy, eyes closed.',
      'Laugh 3 of 3: upright again, eyes squeezed in a grin, shoulders up.',
    ],
    sleep: [
      'Asleep on their feet 1 of 4: eyes closed, head tilted to one side, peaceful smile, arms relaxed.',
      'Asleep on their feet 2 of 4: the same, head a little lower, chest rising in a slow breath.',
      'Asleep on their feet 3 of 4: the same, head lowest, mouth slightly open.',
      'Asleep on their feet 4 of 4: the same, head lifting a little again, breathing out.',
    ],
    surprised: ['Surprised: eyes very wide, mouth a small "o", arms out.'],
    think: ['Thinking: one hand on the chin, eyes looking up.'],
    sit: ['Sitting on the ground, legs out in front, happy.'],
  },
  side: {
    idle: [
      'Idle: standing relaxed, eye open, arms loose.',
      'Idle, breathing in: exactly the same pose, chest a little forward and shoulders a little higher.',
      'Idle, blinking: exactly the same pose as cell 1, eye half closed.',
      'Idle, blinking: exactly the same pose as cell 1, eye fully closed.',
    ],
    walk: fineWalk('forward', 'back', 'side'),
    talk: [
      'Talk: mouth closed in a smile, head straight.',
      'Talk: mouth half open, head tilted slightly up.',
      'Talk: mouth wide open, one hand lifted a little in a small gesture.',
      'Talk: mouth a small round "o", head tilted slightly down.',
    ],
    swing: [
      'Swing 1 of 4: arm drawn back high behind the head, hand closed as if holding a tool (hand empty), leaning back.',
      'Swing 2 of 4: arm coming over the top of the head, starting to lean forward.',
      'Swing 3 of 4: arm swung forward at chest height, body leaning forward, front knee bent.',
      'Swing 4 of 4: arm swung down low in front, knees bent, follow-through.',
    ],
    hurt: [
      'Hurt 1 of 3: flinching backwards, eye squeezed shut.',
      'Hurt 2 of 3: leaning far back, mouth open in an "ouch".',
      'Hurt 3 of 3: steadying again, small frown.',
    ],
    fish: [
      'Fishing 1 of 3: both hands held forward as if gripping a rod (hands empty), leaning back a little.',
      'Fishing 2 of 3: the same, leaning forward, watching closely.',
      'Fishing 3 of 3: pulling back hard with both hands, excited face.',
    ],
    run: [
      'Run 1 of 4: running fast in flight, right leg stretched far forward, left leg stretched far behind, both feet off the ground, elbows bent, arms pumping, body leaning forward.',
      'Run 2 of 4: landed on the right foot under the body, knee bent, left knee driving forward and up, arms passing.',
      'Run 3 of 4: running fast in flight, left leg stretched far forward, right leg stretched far behind, both feet off the ground, arms pumping the other way, body leaning forward.',
      'Run 4 of 4: landed on the left foot under the body, knee bent, right knee driving forward and up, arms passing.',
    ],
  },
  up: {
    idle: [
      'Idle: standing relaxed, seen from behind.',
      'Idle, breathing in: exactly the same pose, shoulders a little higher.',
      'Idle: exactly the same pose as cell 1, head lowered very slightly.',
      'Idle: exactly the same pose as cell 1, head lowered a little more.',
    ],
    walk: fineWalk('away from the viewer', 'back towards the viewer', 'up'),
    swing: [
      'Swing 1 of 4: right arm drawn back and up above the shoulder, hand closed as if holding a tool (hand empty).',
      'Swing 2 of 4: right arm coming over the head.',
      'Swing 3 of 4: right arm swung forward at chest height.',
      'Swing 4 of 4: right arm swung down low, knees bent.',
    ],
    look: ['Idle: looking over one shoulder.'],
    wave: [
      'Wave 1 of 3: one arm raised high, waving.',
      'Wave 2 of 3: the same arm tilted out to the side.',
      'Wave 3 of 3: the same arm tilted in over the head.',
    ],
  },
};

const attack4 = (front: boolean) => [
  `Attack 1 of 4: both arms raised up high, leaning back${front ? ', growling' : ''}.`,
  'Attack 2 of 4: both arms coming down, body starting to lean forward.',
  'Attack 3 of 4: both arms swung down forward, body lunging forward.',
  'Attack 4 of 4: arms low after the swing, leaning forward, recovering.',
];
const dizzy3 = (eye: string) => [
  `Dizzy 1 of 3: wobbling to the left, swirly ${eye}, arms loose.`,
  `Dizzy 2 of 3: upright, swirly ${eye}, little stars above the head.`,
  `Dizzy 3 of 3: wobbling to the right, swirly ${eye}.`,
];
const calm3 = [
  'Calm 1 of 3: sitting down small and quiet, gentle smile.',
  'Calm 2 of 3: sitting, eyes closed, a slow breath in.',
  'Calm 3 of 3: sitting, breathing out, a little smile.',
];
const hop4 = [
  'Hop 1 of 4: crouched low, knees bent, ready to jump.',
  'Hop 2 of 4: springing up, body stretched, feet leaving the ground.',
  'Hop 3 of 4: at the top of a small jump, feet tucked up.',
  'Hop 4 of 4: landing, knees bent, body squashed a little lower, happy.',
];
for (const f of ['down', 'side', 'up'] as Facing[]) {
  FINE_BIPED[f].attack = attack4(f === 'down');
  FINE_BIPED[f].hop = hop4;
}
FINE_BIPED.down.dizzy = dizzy3('eyes');
FINE_BIPED.side.dizzy = dizzy3('eye');
FINE_BIPED.down.calm = calm3;
FINE_BIPED.down.hurt = FINE_BIPED.down.hurt!;

/** Four legs: diagonal pairs step together, with a dip on each landing. */
const quadWalk = (view: 'down' | 'side' | 'up'): string[] => {
  const half = (a: string, b: string) =>
    view === 'side'
      ? [
          `Walk: the ${a} reaching forward (a diagonal pair), the other pair stretched back; body level.`,
          `Walk: the ${a} landing, knees soft, body dipping a little lower.`,
          'Walk: all four legs gathered under the body, passing; body level.',
          `Walk: the ${b} lifting and starting forward, body a little higher.`,
        ]
      : [
          `Walk ${view === 'down' ? 'towards the viewer' : 'away from the viewer'}: the ${a} stepping and landing, the other pair pushing off; head level.`,
          `Walk: weight on the ${a}, body dipping a little lower, head nodding ${view === 'down' ? 'down' : 'a little'}.`,
          'Walk: legs passing under the body, body back to full height.',
          `Walk: the ${b} lifting and reaching, body at its highest.`,
        ];
  const p1 = view === 'side' ? 'near front leg and far back leg' : 'front left leg and back right leg';
  const p2 = view === 'side' ? 'far front leg and near back leg' : 'front right leg and back left leg';
  return [...half(p1, p2), ...half(p2, p1)].map((s, i) => s.replace('Walk', `Walk ${i + 1} of 8`));
};
const quadIdle = (eyes: string, back: boolean): string[] =>
  back
    ? [
        'Idle: standing on all four legs, seen from behind.',
        'Idle, breathing in: exactly the same pose, body a little fuller.',
        'Idle: exactly the same pose as cell 1, tail swished a little to one side.',
        'Idle: exactly the same pose as cell 1, tail swished further to that side.',
      ]
    : [
        `Idle: standing on all four legs, head up, ${eyes} open.`,
        'Idle, breathing in: exactly the same pose, body a little fuller, tail flicked to one side.',
        `Idle, blinking: exactly the same pose as cell 1, ${eyes} half closed.`,
        `Idle, blinking: exactly the same pose as cell 1, ${eyes} fully closed.`,
      ];
const quadHop = [
  'Hop 1 of 4: crouched low on all four legs, ready to jump.',
  'Hop 2 of 4: springing up, legs stretching, feet leaving the ground.',
  'Hop 3 of 4: at the top of a small jump, all four feet off the ground, legs tucked.',
  'Hop 4 of 4: landing, legs bent, body squashed a little lower, happy.',
];
const animalTalk = [
  'Talk: mouth closed, head up.',
  'Talk: mouth half open, head tilted slightly.',
  'Talk: mouth wide open.',
  'Talk: mouth a small round "o", head tilted the other way.',
];
const FINE_QUAD: Record<Facing, Poses> = {
  down: {
    idle: quadIdle('eyes', false),
    walk: quadWalk('down'),
    hop: quadHop,
    talk: animalTalk,
    wave: [
      'Wave 1 of 3: one front leg lifted in a little wave.',
      'Wave 2 of 3: the same leg lifted higher, big smile.',
      'Wave 3 of 3: the same leg tilted out to the side, big smile.',
    ],
    cheer: ['Cheer: a happy little bounce, big smile, tail up.'],
  },
  side: { idle: quadIdle('eye', false), walk: quadWalk('side'), hop: quadHop, talk: animalTalk },
  up: { idle: quadIdle('eyes', true), walk: quadWalk('up'), hop: quadHop },
};
const birdWalk = (view: 'down' | 'side' | 'up'): string[] => {
  const where = view === 'down' ? ' towards the viewer' : view === 'up' ? ' away from the viewer' : '';
  const half = (a: string, b: string) => [
    `Walk${where}: the ${a} foot stepping forward and landing, head pushed forward.`,
    `Walk: weight on the ${a} foot, body dipping a little, head pulled back.`,
    `Walk: the ${b} foot passing under the body, body up, head level.`,
    `Walk: the ${b} foot lifting forward, head pushed forward again.`,
  ];
  return [...half('left', 'right'), ...half('right', 'left')].map((s, i) => s.replace('Walk', `Walk ${i + 1} of 8`));
};
const birdIdle = (eyes: string, back: boolean): string[] =>
  back
    ? [
        'Idle: standing, seen from behind.',
        'Idle, breathing in: exactly the same pose, feathers puffed a little.',
        'Idle: exactly the same pose as cell 1, tail flicked up a little.',
        'Idle: exactly the same pose as cell 1, tail flicked up a little more.',
      ]
    : [
        `Idle: standing, head up, ${eyes} open.`,
        'Idle, breathing in: exactly the same pose, feathers puffed a little.',
        `Idle, blinking: exactly the same pose as cell 1, ${eyes} half closed.`,
        `Idle, blinking: exactly the same pose as cell 1, ${eyes} fully closed.`,
      ];
const birdHop = [
  'Hop 1 of 4: crouched, wings a little out, ready to jump.',
  'Hop 2 of 4: a flappy jump, wings up, feet leaving the ground.',
  'Hop 3 of 4: at the top of the jump, wings down, feet tucked.',
  'Hop 4 of 4: landing, wings half folded, body squashed a little lower.',
];
const FINE_BIRD: Record<Facing, Poses> = {
  down: { idle: birdIdle('eyes', false), walk: birdWalk('down'), hop: birdHop },
  side: { idle: birdIdle('eye', false), walk: birdWalk('side'), hop: birdHop },
  up: { idle: birdIdle('eyes', true), walk: birdWalk('up'), hop: birdHop },
};
const blobPoses: Poses = {
  idle: [
    'Idle: standing still.',
    'Idle, breathing in: exactly the same pose, body very slightly taller.',
    'Idle: exactly the same pose as cell 1, leaning a tiny bit to one side.',
    'Idle: exactly the same pose as cell 1, leaning a little more to that side.',
  ],
  walk: [
    'Walk 1 of 8: the left pair of feet stepped forward and landing, body level.',
    'Walk 2 of 8: weight on the left feet, body dipping a little lower.',
    'Walk 3 of 8: all feet together under the body, body back up.',
    'Walk 4 of 8: the right pair of feet lifting, body leaning a little.',
    'Walk 5 of 8: the right pair of feet stepped forward and landing, body level.',
    'Walk 6 of 8: weight on the right feet, body dipping a little lower.',
    'Walk 7 of 8: all feet together under the body, body back up.',
    'Walk 8 of 8: the left pair of feet lifting, body leaning a little the other way.',
  ],
  attack: [
    'About to pop 1 of 4: body a little swollen, colour a little lighter.',
    'About to pop 2 of 4: body more swollen, colour lighter.',
    'About to pop 3 of 4: body swollen, flashing almost white.',
    'About to pop 4 of 4: body at its biggest, bright white, tiny sparks around it.',
  ],
  hurt: [
    'Hurt 1 of 3: knocked backwards, eyes squeezed.',
    'Hurt 2 of 3: wobbling to one side.',
    'Hurt 3 of 3: steadying again.',
  ],
  dizzy: [
    'Dizzy 1 of 3: swaying to the left, swirly eyes.',
    'Dizzy 2 of 3: upright, swirly eyes, little stars above the head.',
    'Dizzy 3 of 3: swaying to the right, swirly eyes.',
  ],
  calm: [
    'Calm 1 of 3: sitting down small and quiet, holding one little flower.',
    'Calm 2 of 3: sitting, eyes closed, a slow breath in.',
    'Calm 3 of 3: sitting, breathing out, holding the flower.',
  ],
  stomp: [
    'Stomp 1 of 4: one side lifted high, about to stamp.',
    'Stomp 2 of 4: coming down hard.',
    'Stomp 3 of 4: slammed down, dust at the feet.',
    'Stomp 4 of 4: crouched after the stamp.',
  ],
  summon: [
    'Calling 1 of 4: head thrown back, mouth open.',
    'Calling 2 of 4: head back further, mouth wide.',
    'Calling 3 of 4: leaning forward, mouth open wide.',
    'Calling 4 of 4: standing tall, worried.',
  ],
};
const FINE_BLOB: Record<Facing, Poses> = { down: blobPoses, side: blobPoses, up: blobPoses };
const spiderFine: Poses = {
  idle: [
    'Idle: crouched low, legs spread.',
    'Idle, breathing in: exactly the same pose, body raised a little.',
    'Idle: exactly the same pose as cell 1, eyes dimmed a little.',
    'Idle: exactly the same pose as cell 1, eyes dimmed more.',
  ],
  walk: [
    'Walk 1 of 8: legs on one side reaching forward, the others back.',
    'Walk 2 of 8: those legs landing, body dipping a little.',
    'Walk 3 of 8: all legs level, body up.',
    'Walk 4 of 8: the other legs lifting forward.',
    'Walk 5 of 8: the other legs reaching forward, the first ones back.',
    'Walk 6 of 8: those legs landing, body dipping a little.',
    'Walk 7 of 8: all legs level, body up.',
    'Walk 8 of 8: the first legs lifting forward again.',
  ],
  attack: [
    'Attack 1 of 4: rearing up, front legs rising.',
    'Attack 2 of 4: reared up, front legs raised high.',
    'Attack 3 of 4: pouncing forward, front legs stretched out.',
    'Attack 4 of 4: landed low, legs bent.',
  ],
  hurt: [
    'Hurt 1 of 3: knocked back, legs curled.',
    'Hurt 2 of 3: flipped half over, legs in the air.',
    'Hurt 3 of 3: back on its feet, wobbling.',
  ],
  hop: [
    'Hop 1 of 3: crouched, ready to jump.',
    'Hop 2 of 3: jumping, all legs tucked.',
    'Hop 3 of 3: landing, legs spread wide.',
  ],
  dizzy: [
    'Dizzy 1 of 3: wobbling to the left, swirly eyes.',
    'Dizzy 2 of 3: upright, swirly eyes, little stars above.',
    'Dizzy 3 of 3: wobbling to the right, swirly eyes.',
  ],
  calm: [
    'Friendly 1 of 3: crouched low, relaxed.',
    'Friendly 2 of 3: one front leg lifted in a little wave.',
    'Friendly 3 of 3: the leg lifted higher, waving.',
  ],
  surprised: ['Surprised: jumped up a little.'],
};
const FINE_SPIDER: Record<Facing, Poses> = { down: spiderFine, side: spiderFine, up: spiderFine };
const FINE_LIB: Record<ArtBody, Record<Facing, Poses>> = {
  biped: FINE_BIPED,
  quad: FINE_QUAD,
  bird: FINE_BIRD,
  blob: FINE_BLOB,
  spider: FINE_SPIDER,
};

/**
 * Package 64 (D70): the heeler family wag when they stand, as in their series. Their idle's breath frame swishes the
 * tail; the blinks keep the rest pose, so the wag shows between blinks.
 */
export const WAG = new Set(['bluey', 'bingo', 'bandit', 'chilli', 'muffin', 'socks']);
const WAG_IDLE: Record<Facing, string[]> = {
  down: [
    'Idle: standing relaxed, eyes open, arms loose by the sides, the tail hanging low behind one leg.',
    'Idle, wagging: exactly the same pose, chest a little higher, the tail swished up high and out to the other side in a happy wag.',
    'Idle, blinking: exactly the same pose as cell 1, eyes half closed.',
    'Idle, blinking: exactly the same pose as cell 1, eyes fully closed.',
  ],
  side: [
    'Idle: standing relaxed, eye open, arms loose, the tail hanging low behind.',
    'Idle, wagging: exactly the same pose, chest a little forward, the tail swished up high behind in a happy wag.',
    'Idle, blinking: exactly the same pose as cell 1, eye half closed.',
    'Idle, blinking: exactly the same pose as cell 1, eye fully closed.',
  ],
  up: [
    'Idle: standing relaxed, seen from behind, the tail hanging down to one side.',
    'Idle, wagging: exactly the same pose, the tail swished up high to the other side in a happy wag.',
    'Idle: exactly the same pose as cell 1, head lowered very slightly.',
    'Idle: exactly the same pose as cell 1, head lowered a little more.',
  ],
};
const WAG_NOTE =
  'Movement: a lively cartoon puppy: a bouncy, loose, upright walk with the arms swinging freely and the tail swinging; ears flop a little with each step.';
/** How a character moves in its own series, added to its finer sheets' prompts (package 64). */
export const MOVE_NOTE: Record<string, string> = {
  ...Object.fromEntries([...WAG].map((id) => [id, WAG_NOTE])),
  buzz: 'Movement: a hard plastic action figure: a stiff-legged walk with a straight back and a proud chest; arms move in blunt, rigid chops.',
  woody:
    'Movement: a soft pull-string rag doll: loose, floppy limbs that swing freely and a head that bobs loosely with each step.',
  bo_peep: 'Movement: a porcelain figure: an upright, graceful, steady walk, the crook held in one hand.',
  zombie:
    'Movement: in the idle and walk cells both arms are held stiffly straight out in front at shoulder height, parallel, and they do not swing; only the legs swing, as rigid blocks.',
};

function fineBuild(c: CastArt, key: string, grid: number, wants: Want[], custom: Record<string, string[]> = {}): Sheet {
  const cells: Cell[] = [];
  for (const [clip, facing, count] of wants) {
    const own =
      custom[clip] ??
      (WAG.has(c.id) && clip === 'idle' ? WAG_IDLE[facing] : undefined) ??
      FINE_LIB[c.body][facing][clip];
    // a body without its own finer poses for a clip borrows the old ones (or a person's), never repeating a pose
    const poses = own ?? LIB[c.body][facing][clip] ?? (c.body === 'biped' ? undefined : FINE_BIPED[facing][clip]);
    if (!poses) throw new Error(`no poses for ${c.id} ${clip} ${facing}`);
    if (poses.length < count) throw new Error(`${c.id} ${clip} ${facing}: ${count} cells, ${poses.length} poses`);
    for (let n = 0; n < count; n++) cells.push({ clip, facing, n, pose: poses[n]! });
  }
  if (cells.length !== grid * grid)
    throw new Error(`${c.id} ${key}: ${cells.length} cells for a ${grid} x ${grid} grid`);
  return { key, grid, cells };
}

/** Mobs walk with weight (package 58): slower, heavier steps. */
const heavy = (poses: string[]) => poses.map((p) => `${p} A heavy, plodding step.`);

/** The finer sheets for a cast entry, or [] when it keeps its old ones. Keys start with "n". */
export function fineSheetsFor(c: CastArt): Sheet[] {
  const D: Facing = 'down';
  const S: Facing = 'side';
  const U: Facing = 'up';
  // hand-made layouts and the snow golem's own poses stay as they are
  if (c.layout || c.id === 'snow_golem') return [];
  const b = (key: string, grid: number, wants: Want[], custom: Record<string, string[]> = {}) =>
    fineBuild(c, key, grid, wants, custom);
  const trio = (extra: Want[], up: Want[], custom: Record<string, string[]> = {}) => [
    b('nd16', 4, [['idle', D, 4], ['walk', D, 8], ...extra.map(([k, , n]) => [k, D, n] as Want)], custom),
    b('ns16', 4, [['idle', S, 4], ['walk', S, 8], ...extra.map(([k, , n]) => [k, S, n] as Want)], custom),
    b('nu16', 4, [['idle', U, 4], ['walk', U, 8], ...up], custom),
  ];
  switch (c.role) {
    case 'hero': {
      if (c.body !== 'biped') return [];
      const e = c.emote ?? 'a happy dance';
      const emote = [1, 2, 3, 4, 5, 6].map((k) =>
        k === 6
          ? `Their own happy move, step 6 of 6, the big finish: ${e}.`
          : `Their own happy move, step ${k} of 6: ${e}.`,
      );
      return [
        ...trio([['talk', D, 4]], [['swing', U, 4]]),
        b(
          'ndx25',
          5,
          [
            ['swing', D, 4],
            ['hurt', D, 3],
            ['wave', D, 3],
            ['surprised', D, 1],
            ['cheer', D, 6],
            ['sleep', D, 4],
            ['sit', D, 1],
            ['laugh', D, 3],
          ],
          { cheer: emote },
        ),
        b('nsx16', 4, [
          ['swing', S, 4],
          ['run', S, 4],
          ['hurt', S, 3],
          ['fish', S, 3],
          ['wave', S, 2],
        ]),
      ];
    }
    case 'walker':
      if (c.frontOnly) return [];
      return [
        b(
          'nd25',
          5,
          [
            ['idle', D, 4],
            ['walk', D, 8],
            ['talk', D, 4],
            ['wave', D, 3],
            ['cheer', D, 2],
            ['laugh', D, 2],
            ['surprised', D, 1],
            ['think', D, 1],
          ],
          c.body === 'biped'
            ? {}
            : {
                cheer: [
                  'Cheer: a happy little bounce, big smile, tail up.',
                  'Cheer: a bigger bounce, all feet off the ground, tail wagging.',
                ],
              },
        ),
        b('ns16', 4, [
          ['idle', S, 4],
          ['walk', S, 8],
          ['talk', S, 4],
        ]),
        b(
          'nu16',
          4,
          [
            ['idle', U, 4],
            ['walk', U, 8],
            ['look', U, 1],
            ['wave', U, 3],
          ],
          c.body === 'biped'
            ? {}
            : {
                wave: [
                  'Wave 1 of 3: one front leg lifted in a little wave, seen from behind.',
                  'Wave 2 of 3: the same leg lifted higher.',
                  'Wave 3 of 3: the same leg tilted out to the side.',
                ],
              },
        ),
      ];
    case 'fixed':
      return [
        b(
          'nf16',
          4,
          c.body === 'quad'
            ? [
                ['idle', D, 4],
                ['talk', D, 4],
                ['wave', D, 3],
                ['hop', D, 4],
                ['cheer', D, 1],
              ]
            : [
                ['idle', D, 4],
                ['talk', D, 4],
                ['wave', D, 3],
                ['cheer', D, 2],
                ['laugh', D, 2],
                ['surprised', D, 1],
              ],
          c.body === 'quad'
            ? {}
            : { cheer: ['Cheer: both arms up, big grin.', 'Cheer: both arms up higher, a little hop off the ground.'] },
        ),
      ];
    case 'speakingMob':
      return trio(
        [['talk', D, 4]],
        [
          ['look', U, 1],
          ['wave', U, 2],
          ['surprised', D, 1],
        ],
      );
    case 'hostile': {
      const walk = { walk: heavy(FINE_LIB[c.body].down.walk ?? []) };
      const sheets = [
        b(
          'nd16',
          4,
          [
            ['idle', D, 4],
            ['walk', D, 8],
            ['attack', D, 4],
          ],
          c.body === 'biped' ? { walk: heavy(FINE_BIPED.down.walk!) } : walk,
        ),
        b(
          'ns16',
          4,
          [
            ['idle', S, 4],
            ['walk', S, 8],
            ['attack', S, 4],
          ],
          c.body === 'biped' ? { walk: heavy(FINE_BIPED.side.walk!) } : walk,
        ),
        b(
          'nu16',
          4,
          [
            ['idle', U, 4],
            ['walk', U, 8],
            ['attack', U, 4],
          ],
          c.body === 'biped' ? { walk: heavy(FINE_BIPED.up.walk!) } : walk,
        ),
        b('ndx16', 4, [
          ['hurt', D, 3],
          ['dizzy', D, 3],
          ['calm', D, 3],
          ['surprised', D, 1],
          ['hurt', S, 3],
          ['dizzy', S, 3],
        ]),
      ];
      return sheets;
    }
    case 'animal':
      if (c.body === 'biped')
        return [
          b('nd16', 4, [
            ['idle', D, 4],
            ['walk', D, 8],
            ['cheer', D, 3],
            ['sit', D, 1],
          ]),
          b('ns16', 4, [
            ['idle', S, 4],
            ['walk', S, 8],
            ['hop', S, 4],
          ]),
          b('nu16', 4, [
            ['idle', U, 4],
            ['walk', U, 8],
            ['look', U, 1],
            ['wave', U, 3],
          ]),
        ];
      return trio(
        [['hop', D, 4]],
        [
          ['hop', U, 3],
          ['look', U, 1],
        ],
      );
    case 'boss':
      if (c.id === 'creeper_king')
        return [
          b('nd25', 5, [
            ['idle', D, 4],
            ['summon', D, 4],
            ['stomp', D, 4],
            ['attack', D, 4],
            ['dizzy', D, 3],
            ['calm', D, 3],
            ['hurt', D, 3],
          ]),
          b('ns16', 4, [
            ['idle', S, 4],
            ['walk', S, 8],
            ['dizzy', S, 2],
            ['hurt', S, 2],
          ]),
        ];
      {
        const rider = {
          attack: [
            'The rider draws the bow back.',
            'The rider holds the bow fully drawn, aiming.',
            'The rider lets an arrow fly.',
            'The rider lowers the bow.',
          ],
          dizzy: [
            'Dizzy 1 of 3: both wobbling to the left, swirly eyes.',
            'Dizzy 2 of 3: both upright, swirly eyes, little stars above.',
            'Dizzy 3 of 3: both wobbling to the right, swirly eyes.',
          ],
        };
        const want = (f: Facing): Want[] => [
          ['idle', f, 4],
          ['walk', f, 8],
          ['attack', f, 4],
          ['hop', f, 3],
          ['dizzy', f, 3],
          ['hurt', f, 3],
        ];
        return [b('nd25', 5, want(D), rider), b('ns25', 5, want(S), rider)];
      }
  }
  return [];
}

/** Extra lines for a finer sheet's prompt: it is one animation, so only the described part may change. */
export const FINE_NOTE =
  'Animation: the cells are successive frames of smooth animation cycles, so neighbouring cells of one action differ only by the small change described; the head, face, hair shape, clothes, colours and line weight are identical in every cell, and the character is drawn at exactly the same size in every cell.';
