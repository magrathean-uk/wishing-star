// Chapter 5, the blocky village: night at the village.
// One quest per file since phase 2 (18 Nov 2026). A choice is { text, then } and `then` holds the lines that follow.
// Package 33a (phase 2, steps 3 and 5): half the words. A fight comes at once (zombies in the wheat), their leather
// scraps make her leather helmet and armour, worn the same night; she makes the 9 fences herself; Woody rides in
// during the defence instead of being fetched; Bo Peep says what the wolf pup's bones are for.
// Package 44a (the wild stretch): the far fields over the old ford. She mends its broken bridge with planks she
// makes, beats the skeletons at the ford and the zombies chasing the sheep, and leads the sheep back over it.
import type { QuestDef } from '../../core/types.ts';

export const ch5: QuestDef = {
  id: 'ch5',
  name: 'Night at the Village',
  kind: 'main',
  chapter: 5,
  region: 'plains',
  giver: 'bo_peep',
  auto: true,
  path: true,
  requires: {
    done: ['ch4', 'home4'],
  },
  visible: 'The east bridge is built, the village has a fence, and its lamps stay lit all night.',
  steps: [
    {
      t: 'talk',
      who: 'grandad',
      say: ['grandad: Four shards! The next one is over the east brook.'],
      fx: {
        flags: ['plan_east'],
      },
    },
    {
      t: 'site',
      site: 'east_bridge',
      fx: {
        cut: 'minions_east',
      },
    },
    {
      t: 'talk',
      who: 'bo_peep',
      far: 'Go to the plains',
      say: ['bo_peep: Hello, star finder! Zombies are in the wheat!'],
      fx: {
        flags: ['village_help'],
        spawn: [
          {
            mob: 'zombie',
            n: 3,
            at: 'wheat_field',
          },
        ],
      },
    },
    {
      t: 'defeat',
      mob: 'zombie',
      n: 3,
      mark: 'wheat_field',
      goal: 'Beat 3 zombies in the wheat',
      say: ['bo_peep: Thank you! Keep the scraps. Our golem loves sunflowers.'],
      fx: {
        emeralds: 3,
      },
    },
    {
      t: 'deliver',
      item: 'sunflower',
      to: 'golem',
      goal: 'Give the golem a sunflower',
      say: ['say: The golem holds it gently. His eyes glow.'],
      fx: {
        emeralds: 2,
      },
    },
    {
      t: 'site',
      site: 'village_fence',
      goal: 'Mend the village fence',
    },
    {
      t: 'talk',
      who: 'bo_peep',
      say: ['bo_peep: Zombies chased my sheep over the old ford!'],
      fx: {
        flags: ['ford_plan'],
      },
    },
    {
      t: 'site',
      site: 'ford_bridge',
      goal: 'Mend the old bridge with planks',
      say: ['say: Bones rattle on the far side. Skeletons!'],
      fx: {
        spawn: [
          {
            mob: 'skeleton',
            n: 2,
            at: 'ford_far',
          },
        ],
      },
    },
    {
      t: 'defeat',
      mob: 'skeleton',
      n: 2,
      mark: 'ford_far',
      goal: 'Beat 2 skeletons at the ford',
    },
    // package 47a: the far fields are hedged; thorns to cut and a rock fall to mine on the way to the sheep
    {
      t: 'reach',
      place: 'far_fields',
      goal: 'Find the sheep in the hedges',
      fx: {
        spawn: [
          {
            mob: 'zombie',
            n: 3,
            at: 'far_fields',
          },
        ],
      },
    },
    {
      t: 'defeat',
      mob: 'zombie',
      n: 3,
      mark: 'far_fields',
      goal: 'Beat 3 zombies by the sheep',
      say: ['you: Safe! A sheep left wool on the thorns.'],
    },
    // package 53b: one sheep to lead (chapter 4 has its own lead home); the other ran home and left wool to pick up
    {
      t: 'fetch',
      item: 'wool',
      goal: 'Pick up the wool on the thorns',
      mark: 'far_fields',
      drop: [
        {
          item: 'wool',
          at: 'far_fields',
        },
      ],
    },
    {
      t: 'lead',
      animal: 'sheep',
      pen: 'pen_bopeep',
      goal: 'Lead the sheep home with wheat',
      mark: 'far_fields',
      say: ['bo_peep: My sheep! Thank you.'],
    },
    {
      t: 'talk',
      who: 'bo_peep',
      goal: 'Ask Bo Peep about the scraps',
      say: [
        'bo_peep: 2 scraps make leather. Leather makes a helmet and armour.',
        'bo_peep: Armour gives you blue hearts. They take the hits first.',
      ],
      fx: {
        recipes: ['leather', 'leather_helmet', 'leather_armour'],
      },
    },
    {
      t: 'craft',
      item: 'leather_helmet',
      goal: 'Make a leather helmet',
    },
    {
      t: 'craft',
      item: 'leather_armour',
      goal: 'Make leather armour',
      say: ['you: Blue hearts! I feel so brave.'],
      fx: {
        time: 'dusk',
      },
    },
    {
      t: 'reach',
      place: 'village_well',
      goal: 'Wait by the well for dark',
      say: ['bo_peep: Here they come. Stay near the golem!', 'bo_peep: If you fall, he carries you to the well.'],
      fx: {
        time: 'night',
        flags: ['defence_on'],
        spawn: [
          {
            mob: 'zombie',
            n: 3,
            at: 'village_gate',
          },
        ],
      },
    },
    {
      t: 'defeat',
      mob: 'any',
      n: 3,
      goal: 'Beat the first 3 mobs',
      mark: 'village_gate',
      say: ['woody: Howdy! Sorry we are late. Bullseye stopped for grass.'],
      fx: {
        spawn: [
          {
            mob: 'zombie',
            n: 2,
            at: 'village_gate',
          },
          {
            mob: 'skeleton',
            n: 1,
            at: 'village_gate',
          },
        ],
      },
    },
    {
      t: 'defeat',
      mob: 'any',
      n: 3,
      goal: 'Beat the next 3 mobs',
      mark: 'village_gate',
      say: ['say: A creeper tiptoes past with a flower. Nobody sees.'],
      fx: {
        spawn: [
          {
            mob: 'zombie',
            n: 2,
            at: 'village_gate',
          },
          {
            mob: 'spider',
            n: 1,
            at: 'village_gate',
          },
        ],
      },
    },
    {
      t: 'defeat',
      mob: 'any',
      n: 3,
      goal: 'Beat the last 3 mobs',
      mark: 'village_gate',
      say: ['bo_peep: That was the last one! Look, the sun!'],
      fx: {
        clear: ['defence_on'],
        time: 'morning',
      },
    },
    {
      t: 'talk',
      who: 'villager_trader',
      goal: 'Talk to the trader',
      say: ['villager_trader: Hrmm! Hrmm!', 'say: He found a star shard! The golem gives you a poppy.'],
      fx: {
        shard: 5,
        flags: ['clue:5'],
        give: {
          poppy: 1,
        },
        emeralds: 4,
      },
    },
    {
      t: 'reach',
      place: 'clue_5',
      goal: 'Look at the black mark',
      say: ['you: A black mark and one flower. Somebody green was here!'],
    },
    {
      t: 'talk',
      who: 'bo_peep',
      say: [
        'bo_peep: Wolves love bones. Bring 3 to the pup by the trees.',
        'bo_peep: The pens are yours now. Come back any time!',
      ],
    },
  ],
  rewards: {
    mail: ['aunty_1'],
    emeralds: 10,
    recipes: ['bed', 'lantern'],
  },
};
