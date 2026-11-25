// Chapter 3, Peppa's Hill: the biggest puddle.
// One quest per file since phase 2 (18 Nov 2026). A choice is { text, then } and `then` holds the lines that follow.
// Package 33a (phase 2, steps 3 and 5): half the words; she makes her own pickaxe and stone sword, the sword is used
// on the quarry zombies two steps later, and at the end Grandad's workbench opens for upgrades (`upgrades_open`).
// Package 44a (the wild stretch): the quarry cave. Two chambers of zombies, iron and coal in the walls, George's glow,
// and out at the top into Muddy Valley. At the end she melts her iron in Grandad's forge and makes her sword +1.
import type { QuestDef } from '../../core/types.ts';

export const ch3: QuestDef = {
  id: 'ch3',
  name: 'The Biggest Puddle',
  kind: 'main',
  chapter: 3,
  region: 'peppa',
  giver: 'mummy_pig',
  auto: true,
  path: true,
  requires: {
    done: ['ch1', 'ch2', 'home2'],
  },
  visible: 'The north bridge is mended, the hill and the valley glow, and the valley is full of happy muddy puddles.',
  steps: [
    {
      t: 'talk',
      who: 'grandad',
      say: ['grandad: The next shard is over the river. Mend the bridge!'],
      fx: {
        give: {
          bridge_plan: 1,
        },
        flags: ['plan_north'],
      },
    },
    {
      t: 'site',
      site: 'north_bridge',
      say: [],
      fx: {
        flags: ['minions_here'],
        cut: 'minions_bridge',
      },
    },
    {
      t: 'talk',
      who: 'peppa',
      far: 'Cross to the hill',
      say: ['peppa: Hooray, our bridge! Daddy lost his glasses. Again!'],
      sayAlt: ['mummy_pig: Peppa, dear! You are back.', 'mummy_pig: Daddy Pig has lost his glasses. Again!'],
    },
    {
      t: 'fetch',
      item: 'glasses',
      drop: [
        {
          item: 'glasses',
          at: 'garden_3',
        },
      ],
      goal: 'Find the glasses in the garden',
      mark: 'garden_3',
      say: ['you: On top of a pumpkin! With cake crumbs.'],
    },
    {
      t: 'deliver',
      item: 'glasses',
      to: 'daddy_pig',
      say: ['daddy_pig: My glasses! Ho ho!', 'daddy_pig: Make a wooden pickaxe at my bench.'],
      fx: {
        recipes: ['wood_pick'],
        emeralds: 2,
      },
    },
    {
      t: 'craft',
      far: 'Go to the little house',
      item: 'wood_pick',
      mark: 'peppa_bench',
      fx: {
        recipes: ['furnace', 'stone_axe', 'stone_pick', 'stone_sword', 'stone_spade'],
      },
    },
    {
      t: 'fetch',
      item: 'cobblestone',
      n: 8,
      goal: 'Mine 8 cobblestone at the quarry',
      mark: 'quarry',
      say: ['you: Zombies snore in the cave! I need stone tools.'],
    },
    {
      t: 'craft',
      far: 'Go to the little house',
      item: 'stone_sword',
      mark: 'peppa_bench',
      say: ['daddy_pig: Stone tools hit twice as hard!'],
    },
    {
      t: 'craft',
      far: 'Go to the little house',
      item: 'stone_pick',
      mark: 'peppa_bench',
    },
    {
      t: 'talk',
      who: 'mummy_pig',
      say: [
        {
          l: 'mummy_pig: The shard is in Muddy Valley. Wellies, dear?',
          choices: [
            {
              text: 'The squeaky pair',
              then: ['mummy_pig: Squeak, squeak! Just your size.'],
            },
            {
              text: 'The very muddy pair',
              then: ['mummy_pig: Full of old mud. Lovely!'],
            },
          ],
        },
      ],
      fx: {
        give: {
          wellies: 1,
        },
      },
    },
    {
      t: 'reach',
      place: 'quarry_cave',
      goal: 'Go into the quarry cave',
      say: ['you: Dark in here. Zombies!'],
      fx: {
        spawn: [
          {
            mob: 'zombie',
            n: 2,
            at: 'cave_a',
          },
        ],
      },
    },
    {
      t: 'defeat',
      mob: 'zombie',
      n: 2,
      mark: 'cave_a',
      goal: 'Beat 2 zombies in the cave',
      fx: {
        emeralds: 2,
      },
    },
    {
      t: 'fetch',
      item: 'iron_ore',
      n: 3,
      mark: 'cave_a',
      goal: 'Mine 3 iron in the cave walls',
    },
    {
      t: 'fetch',
      item: 'coal',
      n: 2,
      mark: 'cave_a',
      goal: 'Mine 2 coal for the forge',
    },
    {
      t: 'reach',
      place: 'quarry_hole',
      goal: 'Look at the glow in the cave',
      say: ['you: A warm star bit! Oh no, 2 more zombies!'],
      fx: {
        give: {
          star_fragment: 1,
        },
        spawn: [
          {
            mob: 'zombie',
            n: 2,
            at: 'quarry_hole',
          },
        ],
      },
    },
    {
      t: 'defeat',
      far: 'Go to the quarry hole',
      mob: 'zombie',
      n: 2,
      mark: 'quarry_hole',
      goal: 'Beat 2 zombies by the glow',
      fx: {
        emeralds: 2,
      },
    },
    // package 47a: deeper in the cave, a rock fall to mine through and a stream to bridge (planks in the old chest)
    {
      t: 'reach',
      place: 'cave_fall',
      goal: 'Mine through the rock fall',
      fx: {
        flags: ['cave_plan'],
      },
    },
    {
      t: 'site',
      site: 'cave_bridge',
      goal: 'Mend the bridge over the stream',
    },
    {
      t: 'reach',
      place: 'cave_top',
      goal: 'Climb out at the top',
    },
    {
      t: 'mini',
      game: 'puddles',
      mark: 'puddle_start',
      goal: 'Jump the puddles in Muddy Valley',
      say: ['you: Mud everywhere! That was the best.'],
    },
    {
      t: 'reach',
      place: 'big_puddle',
      goal: 'Jump in the biggest puddle',
      say: ['say: One jump. Two jumps. Three huge jumps!', 'you: A star shard pops out of the mud!'],
      fx: {
        shard: 3,
        flags: ['clue:3'],
      },
    },
    {
      t: 'talk',
      who: 'rex',
      far: 'Go up the hill',
      say: ['rex: Hello! I am Rex. A little pig roared at me.', 'rex: I roared back. Now we are friends!'],
      fx: {
        emeralds: 2,
      },
    },
    {
      t: 'reach',
      place: 'clue_3',
      goal: 'Look at the black mark',
      say: ['you: A black mark and a flower. Someone shy is following me!'],
    },
    // package 53b: the long walk back to {grandad} has a second flower on it, by the hill sign
    {
      t: 'fetch',
      item: 'poppy',
      goal: 'Pick up the flower by the sign',
      mark: 'sign_peppa',
      drop: [
        {
          item: 'poppy',
          at: 'sign_peppa',
        },
      ],
    },
    {
      t: 'talk',
      who: 'grandad',
      say: ['grandad: Three shards! Now make your sword stronger.'],
      fx: {
        flags: ['upgrades_open'],
        recipes: ['iron_ingot'],
      },
    },
    {
      t: 'craft',
      item: 'iron_ingot',
      n: 2,
      mark: 'in_workshop',
      goal: 'Make 2 iron bars in the forge',
    },
    {
      t: 'upgrade',
      slot: 'sword',
      mark: 'in_workshop',
      goal: 'Make your sword +1',
      say: ['grandad: Feel that? It hits harder now.'],
    },
  ],
  rewards: {
    mail: ['grandad_1', 'gabby_1'],
    emeralds: 8,
    recipes: ['chest', 'wall_brick'],
  },
};
