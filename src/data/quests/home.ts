// Home chapters: between shards the story comes home, and each one ends with her home visibly better.
// Package 43a (phase 2, steps 4 and 5): home1 the armour stand and her own sign, with a night fight at the plot;
// home2 the bigger room (house step 1, paid at the build site at her door, built overnight); home3 the furnace corner,
// torches, a creeper in the dark, a lamp, and the window and photo wall (house step 3, by the Minions); home4 Dad's fishing lesson, the fish supper and the biggest
// room (house step 2, built overnight by the Minions). Iron comes in chapter 6, so the anvil and the cooking pot are
// not here. A choice is { text, then } and `then` holds the lines that follow.
import type { QuestDef } from '../../core/types.ts';

export const homeQuests: QuestDef[] = [
  {
    kind: 'main',
    auto: true,
    path: true,
    region: 'home',
    id: 'home1',
    name: 'A Home of Your Own',
    giver: 'mum',
    requires: {
      shards: 1,
    },
    visible: 'An armour stand shows her gear, and her own sign stands by her plot.',
    steps: [
      {
        t: 'talk',
        who: 'mum',
        say: ['mum: Your first shard! Now make a stand for your sword.'],
        fx: {
          recipes: ['armour_stand', 'sign_item'],
        },
      },
      {
        t: 'craft',
        item: 'armour_stand',
      },
      {
        t: 'place',
        item: 'armour_stand',
        goal: 'Place the stand in your cottage',
        say: ['you: Looks great! Use it to see all my gear.'],
      },
      {
        t: 'talk',
        who: 'dad',
        say: ['dad: Now make a sign. Stand by it and write on it.'],
      },
      {
        t: 'craft',
        item: 'sign_item',
      },
      {
        t: 'place',
        item: 'sign_item',
        goal: 'Place the sign on your plot',
        say: ['you: My own sign! Oh. It is dark already.'],
        fx: {
          time: 'night',
        },
      },
      {
        t: 'reach',
        place: 'plot_mid',
        goal: 'Go to the middle of your plot',
        say: ['you: Zombies by the fence!'],
        fx: {
          time: 'night',
          spawn: [
            {
              mob: 'zombie',
              n: 2,
              at: 'plot_mid',
            },
          ],
        },
      },
      {
        t: 'defeat',
        mob: 'zombie',
        n: 2,
        mark: 'plot_mid',
        goal: 'Beat 2 zombies on your plot',
        say: ['mum: You kept our home safe! Now a hug, and bed.'],
      },
      {
        t: 'sleep',
      },
    ],
    rewards: {
      emeralds: 6,
      mail: ['mum_1'],
      recipes: ['fence', 'gate', 'table', 'chair'],
    },
  },
  {
    kind: 'main',
    auto: true,
    path: true,
    region: 'home',
    id: 'home2',
    name: 'Market Day',
    giver: 'granny',
    requires: {
      done: ['ch1', 'ch2', 'home1'],
    },
    visible: 'Wheat grows on her plot, she has sold her own bread, and her room is bigger.',
    steps: [
      {
        t: 'talk',
        who: 'granny',
        say: ['granny: Two shards! Plant these 6 wheat seeds, then sleep.'],
        fx: {
          give: {
            wheat_seed: 6,
          },
          recipes: ['bread'],
        },
      },
      {
        t: 'grow',
        crop: 'wheat',
        n: 6,
        goal: 'Plant seeds. Sleep. Pick 6 wheat.',
        mark: 'plot_gate',
      },
      {
        t: 'craft',
        item: 'bread',
        n: 2,
        say: ['you: Warm bread! Press R to eat it.'],
      },
      {
        t: 'deliver',
        item: 'bread',
        to: 'trader',
        far: 'Go to the shop villager',
        goal: 'Give 1 bread to the shop villager',
        say: ['trader: Hrmm! Hrmm.', 'you: He buys things! I can sell more here.'],
        fx: {
          emeralds: 4,
        },
      },
      {
        t: 'talk',
        who: 'dad',
        say: ['dad: Your room is too small. Bandit and I will build!', 'dad: Leave planks and logs by your door.'],
        fx: {
          flags: ['house1_open'],
        },
      },
      {
        t: 'site',
        far: 'Go home',
        site: 'house_1',
        goal: 'Bring 12 planks and 6 logs',
      },
      {
        t: 'sleep',
        goal: 'Sleep while they build',
        say: ['say: Bang, bang, crash. Then a lot of laughing.', 'you: My room is so much bigger!'],
      },
    ],
    rewards: {
      emeralds: 6,
      recipes: ['floor_wood', 'bookshelf'],
      give: {
        carrot_seed: 4,
      },
    },
  },
  {
    kind: 'main',
    auto: true,
    path: true,
    region: 'home',
    id: 'home3',
    name: 'Warm and Bright',
    giver: 'grandad',
    requires: {
      done: ['ch3', 'home2'],
    },
    visible: 'A furnace hums in her cottage, torches light her plot, and a big window looks out on the island.',
    steps: [
      {
        t: 'talk',
        who: 'grandad',
        say: [
          'grandad: Three shards! Time for a furnace and torches.',
          'grandad: Coal is in the quarry. Use a stone pickaxe.',
        ],
        fx: {
          recipes: ['furnace', 'stone_pick', 'torch', 'glass', 'lamp'],
        },
      },
      {
        t: 'craft',
        item: 'stone_pick',
      },
      {
        t: 'fetch',
        item: 'coal',
        n: 2,
        goal: 'Mine 2 coal at the quarry',
        mark: 'quarry',
      },
      {
        t: 'craft',
        item: 'furnace',
        goal: 'Make a furnace from 8 cobblestone',
      },
      {
        t: 'place',
        item: 'furnace',
        goal: 'Place the furnace in your cottage',
        say: ['you: It hums. It is hungry for coal.'],
      },
      {
        t: 'craft',
        item: 'torch',
        n: 8,
      },
      {
        t: 'place',
        item: 'torch',
        n: 4,
        goal: 'Place 4 torches round your plot',
        say: ['you: My plot glows. Mobs do not like light.'],
        fx: {
          time: 'night',
        },
      },
      {
        t: 'reach',
        place: 'plot_mid',
        goal: 'Go to the middle of your plot',
        say: ['you: A hiss! A creeper!'],
        fx: {
          time: 'night',
          spawn: [
            {
              mob: 'creeper',
              n: 1,
              at: 'plot_mid',
            },
          ],
        },
      },
      {
        t: 'defeat',
        mob: 'creeper',
        mark: 'plot_mid',
        goal: 'Beat the creeper',
        say: ['you: Close! I need a lamp. Glass comes from sand.'],
        fx: {
          flags: ['house3_open'],
        },
      },
      // package 53b: {mum}'s two talks are one (the last); a find on the night walk to the beach for sand
      {
        t: 'fetch',
        item: 'sea_glass',
        goal: 'Find the sea glass on the beach',
        mark: 'sign_bay',
        drop: [
          {
            item: 'sea_glass',
            at: 'sign_bay',
          },
        ],
        say: ['you: Sea glass! It glows in the dark.'],
      },
      {
        t: 'craft',
        item: 'glass',
        n: 4,
        goal: 'Make 4 glass from beach sand',
      },
      {
        t: 'craft',
        item: 'lamp',
      },
      {
        t: 'place',
        item: 'lamp',
        goal: 'Place the lamp in your cottage',
      },
      {
        t: 'site',
        far: 'Go home',
        site: 'house_3',
        goal: 'Bring 3 glass and 8 planks',
      },
      {
        t: 'talk',
        who: 'mum',
        say: ['mum: Now we can read after dark!', 'mum: Sleep now. The Minions will fit your window.'],
      },
      {
        t: 'sleep',
        goal: 'Sleep while the Minions build',
        say: ['say: Tap, tap. "Hibbo!" Tap.', 'you: A window! And pictures on my wall!'],
      },
    ],
    rewards: {
      emeralds: 8,
      recipes: ['campfire', 'path_stone'],
    },
  },
  {
    kind: 'main',
    auto: true,
    path: true,
    region: 'home',
    id: 'home4',
    name: 'Fish Supper',
    giver: 'dad',
    requires: {
      done: ['ch4', 'home3'],
    },
    visible: 'A campfire burns on her plot, and her cottage has its biggest room with a wall for prizes.',
    steps: [
      {
        t: 'talk',
        who: 'dad',
        say: ['dad: Take my old rod! Stand by water and press Space.', 'dad: When the float dips, press Space again.'],
      },
      {
        t: 'fish',
        n: 3,
        mark: 'jetty',
        goal: 'Catch 3 fish at the jetty',
        say: ['dad: Three fish for supper! The Minions want to build your biggest room.'],
        fx: {
          flags: ['house2_open'],
          recipes: ['campfire'],
        },
      },
      {
        t: 'craft',
        item: 'glass',
        n: 2,
        goal: 'Make 2 glass from beach sand',
      },
      {
        t: 'site',
        far: 'Go home',
        site: 'house_2',
        goal: 'Fill the build spot at home',
      },
      {
        t: 'craft',
        item: 'campfire',
        goal: 'Make a campfire for supper',
      },
      {
        t: 'place',
        item: 'campfire',
        goal: 'Place the campfire on your plot',
        fx: {
          time: 'night',
        },
      },
      {
        t: 'reach',
        place: 'plot_mid',
        goal: 'Go to your fire for supper',
        say: ['dad: Look up. That is where the star should be.', 'say: A small cat watches. It wants a friend.'],
        fx: {
          time: 'night',
        },
      },
      {
        t: 'sleep',
        goal: 'Sleep while the Minions build',
        say: ['say: Bang, crash. "Hibbo!" Bang. Then quiet.', 'you: A wall for my prizes!'],
      },
    ],
    rewards: {
      emeralds: 8,
      recipes: ['bench'],
      give: {
        hot_chocolate: 2,
      },
    },
  },
];
