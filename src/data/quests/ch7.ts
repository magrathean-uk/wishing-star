// Chapter 7, the Crater: the lonely King.
// One quest per file since phase 2 (18 Nov 2026). A choice is { text, then } and `then` holds the lines that follow.
// Package 33b (phase 2, steps 3 and 5): Dad shows the diamond sword and says who will follow her; the little creepers
// lead her to the diamonds; she makes the sword at the King's potting bench and saves his flower bed with it at once.
// One creeper guard, the King, the twist, then only the count to ten with Mum and the plush Mum made.
// Package 44a (the wild stretch): the way down the three crater ledges, a guard and a diamond on each.
import type { QuestDef } from '../../core/types.ts';

export const ch7: QuestDef = {
  id: 'ch7',
  name: 'The Lonely King',
  kind: 'main',
  chapter: 7,
  region: 'crater',
  giver: 'chilli',
  auto: true,
  path: true,
  requires: {
    done: 'ch6',
  },
  visible: 'The Crater glows green and gold, the boulder wall is gone, and the Creeper King tends his flower garden.',
  steps: [
    {
      t: 'talk',
      who: 'dad',
      far: "Go to {dad}'s lookout",
      say: ['dad: Diamonds shine in the Crater. They make the best sword!', 'dad: {mum} and Chilli will follow soon.'],
      fx: {
        recipes: ['diamond_sword', 'diamond_pick', 'diamond_axe', 'diamond_helmet', 'diamond_armour'],
      },
    },
    {
      t: 'reach',
      place: 'crater_wall',
      goal: 'Follow the hum to the Crater',
      say: ['you: Boulders! My pickaxe can break them.'],
    },
    {
      t: 'reach',
      place: 'sign_crater',
      goal: 'Break the boulder wall',
      mark: 'crater_wall',
      say: ['you: Little gardens. So quiet!'],
    },
    {
      t: 'reach',
      place: 'practice_sign',
      goal: 'Read the wobbly sign',
      say: [
        'you: "Count to ten. Do not pop." Who wrote that?',
        'say: 3 little creepers peek out and wave!',
        {
          l: 'you: Hello! What shall I call you?',
          choices: [
            {
              text: 'Hop, Skip and Jump',
            },
            {
              text: 'Pat, Pit and Pot',
            },
          ],
        },
      ],
    },
    {
      t: 'reach',
      place: 'ledges_top',
      goal: 'Climb down the rocky drop',
      say: ['say: The creepers point down. Diamonds!'],
      fx: {
        spawn: [
          {
            mob: 'skeleton',
            n: 1,
            at: 'ledge_1',
          },
        ],
      },
    },
    {
      t: 'defeat',
      far: 'Go to the rocky drop',
      mob: 'skeleton',
      mark: 'ledge_1',
      goal: 'Beat the first guard',
      fx: {
        spawn: [
          {
            mob: 'zombie',
            n: 1,
            at: 'ledge_2',
          },
          {
            mob: 'skeleton',
            n: 1,
            at: 'ledge_2',
          },
        ],
      },
    },
    {
      t: 'defeat',
      far: 'Go down the drop',
      mob: 'any',
      n: 2,
      mark: 'ledge_2',
      goal: 'Beat the 2 guards in the middle',
    },
    // package 47a: a deeper drop; a web over the next gap (an arrow brings it down), a cracked boulder after it
    {
      t: 'reach',
      place: 'ledge_web',
      goal: 'Hit the web with an arrow',
      fx: {
        spawn: [
          {
            mob: 'skeleton',
            n: 1,
            at: 'ledge_3',
          },
          {
            mob: 'zombie',
            n: 1,
            at: 'ledge_3',
          },
        ],
      },
    },
    {
      t: 'defeat',
      far: 'Go down the drop',
      mob: 'any',
      n: 2,
      mark: 'ledge_3',
      goal: 'Beat the 2 guards below',
    },
    {
      t: 'reach',
      place: 'ledge_crack',
      goal: 'Break the cracked boulder',
    },
    {
      t: 'fetch',
      item: 'diamond',
      n: 2,
      goal: 'Mine 2 diamonds',
      mark: 'ledge_crack',
    },
    {
      t: 'reach',
      place: 'ledges_out',
      goal: 'Break out at the bottom',
      say: ['say: The creepers lead you to their bench.'],
    },
    {
      t: 'craft',
      item: 'diamond_sword',
      mark: 'potting_bench',
      say: ['you: A diamond sword! It shines like the star.', 'say: Stomp, stomp! Mobs on the flower bed!'],
      fx: {
        spawn: [
          {
            mob: 'zombie',
            n: 2,
            at: 'crater_bed',
          },
          {
            mob: 'skeleton',
            n: 1,
            at: 'crater_bed',
          },
        ],
      },
    },
    {
      t: 'defeat',
      mob: 'any',
      n: 3,
      goal: 'Save the flower bed',
      mark: 'crater_bed',
      say: ['say: The little creepers do a tiny dance.'],
      fx: {
        emeralds: 3,
      },
    },
    {
      t: 'reach',
      place: 'hall_gate',
      goal: "Go to the King's gate",
      say: ['say: You set 6 shards in the gate. They hum.', 'say: A balloon. Ducks. Mud. Joeys. A golem. A cart ride!'],
      fx: {
        flags: ['socket_1', 'socket_2', 'socket_3', 'socket_4', 'socket_5', 'socket_6'],
      },
    },
    {
      t: 'reach',
      place: 'hall_entry',
      goal: 'Open the gate at the stone',
      mark: 'socket_1',
      say: ['you: Star pictures on every wall!', 'say: A creeper guard jumps out, shaking!'],
      fx: {
        spawn: [
          {
            mob: 'creeper',
            n: 1,
            at: 'hall_mid',
          },
        ],
      },
    },
    {
      t: 'defeat',
      mob: 'creeper',
      goal: 'Calm the creeper guard',
      mark: 'hall_mid',
      say: [
        'say: Puff! The guard sits down.',
        'creeper_king: Who is there? Oh no, I will pop!',
        'you: He is not angry. He is scared!',
      ],
      fx: {
        spawn: [
          {
            mob: 'creeper_king',
            n: 1,
            at: 'king',
          },
        ],
        music: 'hall',
      },
    },
    {
      t: 'defeat',
      mob: 'creeper_king',
      goal: 'Calm the Creeper King',
      mark: 'king',
      fx: {
        cut: 'king_calm',
        music: '',
      },
    },
    // package 53b: after the King is calm, three boxes in all (the scene has two), then straight to {mum}
    {
      t: 'talk',
      who: 'creeper_king',
      say: [
        {
          l: 'creeper_king: I just wanted to see the star. Then I went boom.',
          choices: [
            {
              text: 'It is all right',
            },
            {
              text: 'We forgive you',
            },
          ],
        },
      ],
      fx: {
        shard: 7,
        // he stays on his seat in the Hall until now; then he moves to his garden
        flags: ['king_friend'],
      },
    },
    {
      t: 'talk',
      who: 'mum',
      say: ['mum: Come to our party! If a pop comes, we count to ten.'],
    },
  ],
  rewards: {
    emeralds: 15,
    recipes: ['creeper_plush'],
    give: {
      poppy_vase: 1,
    },
  },
};
