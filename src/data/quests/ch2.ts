// Chapter 2, Bing's Garden: Hoppity lost.
// One quest per file since phase 2 (18 Nov 2026). A choice is { text, then } and `then` holds the lines that follow.
// Package 46 (the first hour): its own shape, not chapter 1's: a creeper at the bridge first, then the chicken
// sitting on Hoppity, a pen she builds, the picnic Pando brings after a fight at dusk. Nothing is planted, slept on
// or carried back on the way to the shard: the carrot seeds and the spade come as a present at the end.
import type { QuestDef } from '../../core/types.ts';

export const ch2: QuestDef = {
  id: 'ch2',
  name: 'Hoppity Lost',
  kind: 'main',
  chapter: 2,
  region: 'bing',
  giver: 'sula',
  auto: true,
  path: true,
  requires: {
    done: 'prologue',
  },
  visible: 'Paper lanterns float on the park pond, and the chicken lives in its little pen.',
  steps: [
    {
      t: 'reach',
      place: 'sign_bing',
      clear: ['bridge_bush_60', 'bridge_bush_61'],
      goal: 'Cut the bushes on the bridge',
      mark: 'west_bridge',
      say: ['you: A creeper! Hit it, then step back when it hisses.'],
      fx: {
        spawn: [
          {
            mob: 'creeper',
            n: 1,
            at: 'bing_bench',
          },
        ],
      },
    },
    {
      t: 'defeat',
      far: 'Go to the playground',
      mob: 'creeper',
      mark: 'bing_bench',
      goal: 'Beat the creeper',
      say: ['sula: Well done! Oh dear. Have you seen Hoppity?', 'sula: I saw tiny footprints in the long grass.'],
      fx: {
        emeralds: 2,
      },
    },
    // package 47a: the long grass, a short wild stretch on new ground (three winding lanes, two thorn bushes, a zombie)
    {
      t: 'reach',
      place: 'grass_in',
      goal: 'Follow the footprints into the grass',
      fx: {
        spawn: [
          {
            mob: 'zombie',
            n: 1,
            at: 'grass_mid',
          },
        ],
      },
    },
    {
      t: 'defeat',
      mob: 'zombie',
      mark: 'grass_mid',
      goal: 'Beat the zombie in the grass',
    },
    // package 53b: one trail out of the grass, with a feather on the swings to pick up on the way
    {
      t: 'fetch',
      item: 'feather',
      goal: 'Follow the footprints to the swings',
      mark: 'play_1',
      drop: [
        {
          item: 'feather',
          at: 'play_1',
        },
      ],
      say: ['you: A white feather! The footprints go on.'],
    },
    {
      t: 'reach',
      place: 'nest',
      goal: 'Find who made the footprints',
      say: [
        'you: A chicken made of blocks! She sits on Hoppity.',
        'coco: Build her a pen. Make 3 fences at the bench.',
      ],
      fx: {
        recipes: ['fence'],
        flags: ['pen_plan', 'seeds_open'],
      },
    },
    {
      t: 'site',
      site: 'pen_bing',
      goal: 'Build the little pen',
      say: ['coco: A bit wobbly. Here, seeds. Chickens follow seeds.'],
      fx: {
        give: {
          wheat_seed: 2,
        },
      },
    },
    {
      t: 'lead',
      animal: 'chicken',
      pen: 'pen_bing',
      goal: 'Lead the chicken to the pen',
      mark: 'nest',
      say: [
        'you: In you go. Good chicken!',
        {
          l: 'coco: She needs a name. You pick!',
          choices: [
            {
              text: 'Nugget',
            },
            {
              text: 'Mrs Feathers',
            },
          ],
        },
        'you: Got you, Hoppity! Oh. You smell of chicken.',
      ],
      fx: {
        give: {
          egg: 1,
          hoppity: 1,
        },
      },
    },
    {
      t: 'reach',
      place: 'ducks',
      goal: 'Go to the park pond',
      say: ['you: 3 ducks. The big one sits on a star shard!', 'pando: Ducks love a picnic. First, hide and seek!'],
    },
    {
      t: 'mini',
      game: 'hide',
      mark: 'pando',
      say: ['pando: You found us every time!', 'say: It gets dark. 3 zombies sniff at the picnic!'],
      fx: {
        emeralds: 2,
        time: 'dusk',
        spawn: [
          {
            mob: 'zombie',
            n: 3,
            at: 'bing_dusk',
          },
        ],
      },
    },
    {
      t: 'defeat',
      far: 'Go to the pond',
      mob: 'zombie',
      n: 3,
      mark: 'bing_dusk',
      goal: 'Beat 3 zombies',
      say: ['pando: Puff, puff! Picnic time! Everybody come!'],
      fx: {
        flags: ['picnic'],
        cut: 'picnic',
      },
    },
    {
      t: 'reach',
      place: 'ducks',
      goal: 'Swap with the ducks',
      say: [
        'you: The ducks love our picnic. They gave me a star shard!',
        'pando: Has anybody seen my shorts?',
        'coco: The big duck has them on his head. He wants a race!',
      ],
      fx: {
        shard: 2,
        flags: ['duck_race'],
      },
    },
    {
      t: 'mini',
      far: 'Go to the pond',
      game: 'race',
      mark: 'pond_race',
      goal: 'Race the duck',
      say: ['say: The duck drops the shorts.', 'pando: He can keep them. He looks better in them.'],
      fx: {
        emeralds: 2,
      },
    },
    {
      t: 'reach',
      place: 'ducks',
      goal: 'Light a lantern on the pond',
      say: [
        'say: Everyone floats a paper lantern. The pond fills with lights.',
        {
          l: 'sula: Make a wish! What is yours?',
          choices: [
            {
              text: 'The star shines again',
            },
            {
              text: 'The shy one comes back',
            },
          ],
        },
        'pando: I wished for more shorts.',
      ],
    },
  ],
  rewards: {
    mail: ['granny_1'],
    emeralds: 5,
    recipes: ['wood_spade'],
    give: {
      carrot_seed: 3,
      toy_boat: 1,
    },
    // Hoppity goes home with Bing
    take: {
      hoppity: 1,
    },
  },
};
