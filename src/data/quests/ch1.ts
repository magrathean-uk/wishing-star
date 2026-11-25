// Chapter 1, Heeler Heights: Keepy Uppy.
// One quest per file since phase 2 (18 Nov 2026). A choice is { text, then } and `then` holds the lines that follow.
// Package 46 (the first hour): it opens with a fight, not a fetch; no lost toy (chapter 2 has Hoppity); no run of
// talk-only steps; the ladders are made, not carried; the shard is the last thing but one.
import type { QuestDef } from '../../core/types.ts';

export const ch1: QuestDef = {
  id: 'ch1',
  name: 'Keepy Uppy',
  kind: 'main',
  chapter: 1,
  region: 'heeler',
  giver: 'bandit',
  auto: true,
  path: true,
  requires: {
    done: 'prologue',
  },
  visible: 'The Heeler backyard glows at night, and a red balloon hangs in the big red tree.',
  steps: [
    {
      t: 'talk',
      who: 'bandit',
      far: 'Go down to Heeler Heights',
      say: ['bandit: Help, kid! A sleepy zombie took my barbecue fork!'],
      fx: {
        spawn: [
          {
            mob: 'zombie',
            n: 1,
            at: 'heeler_dusk',
          },
        ],
      },
    },
    {
      t: 'defeat',
      far: 'Go to the sandy grass',
      mob: 'zombie',
      mark: 'heeler_dusk',
      goal: 'Get the fork back',
      say: [
        'you: It yawned and went puff. It was hugging the fork!',
        'bandit: Thanks, kid! Keepy Uppy time. Oh. Who hid the string?',
        {
          l: 'bluey: I did! Over the creek, in the bush.',
          if: {
            notHero: 'bluey',
          },
        },
        {
          l: 'bingo: Bluey hid it! Over the creek, in the bush.',
          if: {
            hero: 'bluey',
          },
        },
      ],
      fx: {
        toast: 'You gave the fork.',
        emeralds: 2,
        flags: ['bush_plan'],
      },
    },
    // package 47a: the creek bush, a short wild stretch on new ground (find the way, a thorn bush, logs for the gully, a zombie by the string)
    {
      t: 'site',
      far: 'Cross the creek',
      site: 'bush_bridge',
      goal: 'Build a log bridge',
      fx: {
        spawn: [
          {
            mob: 'zombie',
            n: 1,
            at: 'bush_end',
          },
        ],
      },
    },
    {
      t: 'defeat',
      mob: 'zombie',
      mark: 'bush_end',
      goal: 'Beat the zombie by the string',
    },
    {
      t: 'fetch',
      item: 'string',
      goal: 'Find the balloon string',
      mark: 'bush_end',
      drop: [
        {
          item: 'string',
          at: 'bush_end',
        },
      ],
      say: ['you: Got the string!'],
    },
    {
      t: 'mini',
      game: 'keepy',
      mark: 'bandit',
      goal: 'Play Keepy Uppy with Bandit',
      say: [
        'bandit: Good game! My face needs a rest.',
        {
          l: 'bluey: Dad needs a lie down. Race you round the yard!',
          if: {
            notHero: 'bluey',
          },
        },
        {
          l: 'bingo: Dad needs a lie down. Race me round the yard!',
          if: {
            hero: 'bluey',
          },
        },
      ],
      fx: {
        take: {
          string: 1,
        },
        flags: ['bluey_race'],
      },
    },
    {
      t: 'mini',
      far: 'Go to the yard',
      game: 'race',
      mark: 'heeler_race',
      goal: 'Race round the yard',
      say: [
        'bingo: Dad did not even start. Dad is the wet sock!',
        'bingo: Your prize is my secret. A long dog hides by the sand!',
      ],
      fx: {
        emeralds: 2,
      },
    },
    {
      t: 'reach',
      place: 'heeler_dog',
      goal: 'Find the long dog',
      say: [
        'you: A long dog! Oh no, the balloon is floating away!',
        'chilli: It is stuck in the big red tree. Make some ladders!',
      ],
      fx: {
        recipes: ['ladder'],
      },
    },
    {
      t: 'craft',
      far: 'Go to the shed bench',
      item: 'ladder',
      n: 3,
      mark: 'heeler_bench',
      goal: 'Make 3 ladders at the bench',
      say: ['bandit: Perfect. Oh no, zombies! They want our sausages!'],
      fx: {
        time: 'night',
        spawn: [
          {
            mob: 'zombie',
            n: 3,
            at: 'heeler_dusk',
          },
        ],
      },
    },
    {
      t: 'defeat',
      far: 'Go to the sandy grass',
      mob: 'zombie',
      n: 3,
      mark: 'heeler_dusk',
      say: ['bandit: Puff! Gone! The sausages are safe.', 'chilli: Oh! A spider in the big red tree!'],
      fx: {
        emeralds: 2,
        spawn: [
          {
            mob: 'spider',
            n: 1,
            at: 'poinciana',
          },
        ],
      },
    },
    {
      t: 'defeat',
      far: 'Go to the red tree',
      mob: 'spider',
      mark: 'poinciana',
      goal: 'Beat the spider in the tree',
      say: ['chilli: Up the ladders you go, love.'],
    },
    {
      t: 'reach',
      place: 'poinciana',
      goal: 'Climb the big red tree',
      say: ['you: A star shard! And the red balloon.', 'bingo: Look! A tiny light, over the stream.'],
      fx: {
        shard: 1,
        flags: ['clue:1', 'ch1_lit'],
        give: {
          balloon: 1,
        },
      },
    },
    {
      t: 'reach',
      place: 'clue_1',
      goal: 'Follow the tiny light',
      say: [
        'you: A black mark. And one flower, set down with care.',
        'you: Round tracks lead away. They step round every flower.',
      ],
      fx: {
        give: {
          painting_star: 1,
        },
      },
    },
  ],
  rewards: {
    recipes: ['pool', 'kennel_item'],
    mail: ['bandit_1'],
    emeralds: 5,
    flags: ['bounty_open'],
    // Bingo's thank-you (the toy bunny is no longer lost: package 46)
    give: {
      toy_bunny: 1,
    },
  },
};
