// Chapter 6, the Mine: deep and dark.
// One quest per file since phase 2 (18 Nov 2026). A choice is { text, then } and `then` holds the lines that follow.
// Package 33b (phase 2, steps 3 and 5): a fight on the forest path straight away, coal she mines by the Mine door
// for the torches, an iron sword and helmet she makes herself at Grandad's bench (he shows them; zombies come up the
// path to try the sword on), one walk out of the Mine, the gold she keeps for the star and the anvil plan for home.
// Package 53b: the skeletons meet her at the forest sign; a find halfway on each long walk in the Mine; the walk up
// to {grandad} brings the clue, and the coal for the gold comes with shard 6.
import type { QuestDef } from '../../core/types.ts';

export const ch6: QuestDef = {
  id: 'ch6',
  name: 'Deep and Dark',
  kind: 'main',
  chapter: 6,
  region: 'forest',
  giver: 'grandad',
  auto: true,
  path: true,
  requires: {
    done: 'ch5',
  },
  visible: 'Torches line the Mine mouth, the forest paths glow, and the minecart runs again.',
  steps: [
    {
      t: 'talk',
      who: 'grandad',
      say: ['grandad: A shard fell down the old Mine. Meet me there!'],
      // package 53b: the skeletons wait at the start of the forest path, so the first fight comes early
      fx: {
        flags: ['mine_plan'],
        spawn: [
          {
            mob: 'skeleton',
            n: 2,
            at: 'sign_forest',
          },
        ],
      },
    },
    {
      t: 'defeat',
      mob: 'skeleton',
      goal: 'Beat the first skeleton on the forest path',
      mark: 'sign_forest',
    },
    {
      t: 'defeat',
      mob: 'skeleton',
      goal: 'Beat the second skeleton',
      mark: 'sign_forest',
    },
    {
      t: 'talk',
      who: 'grandad',
      say: ['grandad: You made it! Hot chocolate? Half now, half for later.'],
    },
    {
      t: 'site',
      site: 'mine_torches',
      goal: 'Light the Mine door',
      say: ['grandad: I lost my old lamp in there, long ago.'],
    },
    {
      t: 'reach',
      place: 'mine_iron',
      goal: 'Find iron in the Mine',
      say: [
        {
          l: 'you: It is so quiet down here.',
          choices: [
            {
              text: 'Shout "Hello!"',
              then: ['say: Hello, hello, hello. The Mine says it back.'],
            },
            {
              text: 'Sing one note',
              then: ['say: The note comes back lower. The Mine sings like {grandad}.'],
            },
          ],
        },
        'you: Orange spots! That is iron ore.',
      ],
    },
    {
      t: 'fetch',
      item: 'iron_ore',
      n: 8,
      goal: 'Mine 8 iron ore',
      mark: 'mine_iron',
    },
    {
      t: 'fetch',
      item: 'lamp',
      goal: 'Pick up the old lamp',
      mark: 'mine_cart',
      drop: [
        {
          item: 'lamp',
          at: 'mine_cart',
        },
      ],
      say: ["you: {grandad}'s lamp! It still works."],
    },
    {
      t: 'talk',
      who: 'grandad',
      goal: 'Show the lamp to {grandad}',
      say: [
        'grandad: My lamp! A noise in the dark made me drop it.',
        'grandad: It was only a lost puppy. We kept her 12 years.',
        'grandad: Now melt that iron. Take my coal.',
      ],
      fx: {
        give: {
          coal: 8,
        },
        recipes: [
          'iron_ingot',
          'iron_sword',
          'iron_helmet',
          'iron_pick',
          'iron_armour',
          'iron_axe',
          'iron_spade',
          'bucket',
        ],
      },
    },
    {
      t: 'craft',
      item: 'iron_ingot',
      n: 8,
      goal: 'Make 8 iron bars',
      mark: 'grandad_mine',
    },
    {
      t: 'craft',
      item: 'iron_sword',
      mark: 'grandad_mine',
      say: ['grandad: Zombies! Try your new sword.'],
      fx: {
        spawn: [
          {
            mob: 'zombie',
            n: 2,
            at: 'mine_path',
          },
        ],
      },
    },
    {
      t: 'defeat',
      far: 'Go to the Mine path',
      mob: 'zombie',
      n: 2,
      mark: 'mine_path',
      say: ['grandad: Now a helmet. Skeletons shoot from the dark.'],
    },
    {
      t: 'craft',
      item: 'iron_helmet',
      mark: 'grandad_mine',
      say: ['grandad: Last, a pickaxe. Stone cannot dig gold.'],
    },
    {
      t: 'craft',
      item: 'iron_pick',
      mark: 'grandad_mine',
    },
    // package 53b: a find halfway down to the fossil
    {
      t: 'fetch',
      item: 'gold_ore',
      goal: 'Pick up the gold by the old rails',
      mark: 'mine_cart',
      drop: [
        {
          item: 'gold_ore',
          at: 'mine_cart',
        },
      ],
    },
    {
      t: 'reach',
      place: 'fossil_spot',
      goal: 'Look at the odd rock',
      say: ['you: A fossil! A big jaw and a long tail.', 'you: George would shout "Dine-saw!"'],
      fx: {
        emeralds: 3,
        // package 53b: something happens early and often in the Mine
        spawn: [
          {
            mob: 'zombie',
            n: 1,
            at: 'fossil_spot',
          },
        ],
      },
    },
    {
      t: 'defeat',
      mob: 'zombie',
      goal: 'Beat the zombie by the fossil',
      mark: 'fossil_spot',
    },
    {
      t: 'reach',
      place: 'cart_webs',
      goal: 'Follow the old rails',
      say: ['you: Thick webs. And the webs are moving!'],
      fx: {
        spawn: [
          {
            mob: 'spider',
            n: 2,
            at: 'cart_webs',
          },
        ],
      },
    },
    {
      t: 'defeat',
      far: 'Go to the tunnel webs',
      mob: 'spider',
      n: 2,
      mark: 'cart_webs',
    },
    {
      t: 'site',
      site: 'cart_track',
      goal: 'Fix the track with cobblestone',
      mark: 'mine_ride',
    },
    {
      t: 'mini',
      game: 'minecart',
      mark: 'mine_ride',
      goal: 'Ride the minecart',
      fx: {
        flags: ['cart_done'],
      },
    },
    {
      t: 'reach',
      place: 'jockey_cave',
      goal: 'Go down to the deepest cave',
      say: ['say: A skeleton rides out on a giant spider!', 'you: The spider first, then the rider. Use the pillars!'],
      fx: {
        spawn: [
          {
            mob: 'spider_jockey',
            n: 1,
            at: 'jockey_spawn',
          },
        ],
        music: 'hall',
      },
    },
    {
      t: 'defeat',
      mob: 'spider_jockey',
      goal: 'Beat the Spider Jockey',
      mark: 'jockey_cave',
      fx: {
        music: '',
      },
    },
    {
      t: 'reach',
      place: 'shard_cave',
      goal: 'Go to the glowing cave',
      say: ['you: Shard 6! And gold all round it.', 'you: The carts link up now. I can ride one!'],
      fx: {
        shard: 6,
        flags: ['clue:6', 'minecart'],
        recipes: ['gold_ingot'],
        // coal for the gold bars, so the way up is the last walk
        give: {
          coal: 2,
        },
      },
    },
    {
      t: 'fetch',
      item: 'gold_ore',
      n: 3,
      goal: 'Get 3 gold ore',
      mark: 'shard_cave',
    },
    {
      t: 'talk',
      who: 'grandad',
      far: 'Go up to {grandad}',
      goal: 'Give {grandad} the gold',
      say: [
        'grandad: Six shards! Look, the biggest scorch mark yet.',
        'grandad: Flowers point to the Crater. Somebody wants to say sorry.',
      ],
    },
    // package 53b: the coal came with shard 6, so the bars are made at once
    {
      t: 'craft',
      item: 'gold_ingot',
      n: 2,
      goal: 'Make 2 gold bars',
      mark: 'grandad_mine',
      say: ['grandad: Keep the gold for the star. And here, the other half of the hot chocolate!'],
      fx: {
        give: {
          hot_chocolate: 1,
        },
        recipes: ['anvil'],
      },
    },
  ],
  rewards: {
    mail: ['teacher_1'],
    emeralds: 10,
    recipes: ['hot_chocolate', 'tnt'],
  },
};
