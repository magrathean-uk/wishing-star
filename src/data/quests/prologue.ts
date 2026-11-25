// The prologue: the first morning and the first night, in 8 steps (phase 2, docs/PHASE2.md part A).
// It teaches only this: a hug from Mum fills hearts, Dad's map, Grandad's axe, chop a tree, make a sword in
// 2 crafts, beat the first zombie, sleep. Limits (tools/check/calm.ts): 8 steps, 250 words with the intro scene,
// 4 named speakers, 3 boxes a talk, 6 words a goal. The first ten minutes are checked by tools/check/firstten.ts.
// Package 46 (the first hour): one box a talk, so her hands are on the axe after 5 boxes and about 40 words.
// Keys are shown as pictures by the view (Space under the first boxes, M beside K once she has the map),
// so the lines do not teach them. The zombie comes on her way home, so bedtime is a few steps and one card.
import type { QuestDef } from '../../core/types.ts';

export const prologue: QuestDef[] = [
  {
    id: 'prologue',
    name: 'The Night the Star Went Boom',
    kind: 'main',
    chapter: 0,
    region: 'home',
    giver: 'mum',
    auto: true,
    path: true,
    visible: 'She carries a wooden sword she made herself, and the flag on her mailbox is up.',
    steps: [
      {
        t: 'reach',
        place: 'start',
        fx: {
          cut: 'intro',
        },
      },
      {
        t: 'talk',
        who: 'mum',
        say: ['mum: Morning, love! A big hug!'],
        fx: {
          hug: true,
        },
      },
      {
        t: 'talk',
        who: 'dad',
        say: ['dad: I drew you a map. I only got lost twice!'],
        fx: {
          give: {
            dads_map: 1,
          },
        },
      },
      {
        t: 'talk',
        who: 'grandad',
        say: ['grandad: Take my axe, and chop us 2 logs!'],
        fx: {
          give: {
            wood_axe: 1,
          },
        },
      },
      {
        t: 'fetch',
        far: 'Go to the trees',
        item: 'log',
        n: 2,
        mark: 'first_tree',
        goal: 'Chop 2 logs',
        say: ['grandad: Good chopping! Now make a sword at my bench.'],
      },
      {
        t: 'craft',
        item: 'wood_sword',
        mark: 'workshop',
        goal: 'Make a wooden sword',
        say: ['grandad: A fine sword! Oh look, a zombie. Go on!'],
        fx: {
          time: 'dusk',
          spawn: [
            {
              mob: 'zombie',
              n: 1,
              at: 'square_s',
            },
          ],
        },
      },
      {
        t: 'defeat',
        mob: 'zombie',
        mark: 'square_s',
        goal: 'Beat the zombie',
        say: ['grandad: Puff! Gone! Now off to bed, my hero.'],
        fx: {
          emeralds: 3,
          mail: ['dad_1'],
          flags: ['tm:shards'],
        },
      },
      {
        t: 'sleep',
        goal: 'Sleep in your bed',
        fx: {
          flags: ['day2'],
        },
      },
    ],
    rewards: {
      emeralds: 5,
    },
  },
];
