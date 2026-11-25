// Chapter 4, Gum Tree Grove: the lost joeys.
// One quest per file since phase 2 (18 Nov 2026). A choice is { text, then } and `then` holds the lines that follow.
// Package 33a (phase 2, steps 3 and 5): half the words. She makes her stone axe; each joey is found a different way
// (led with leaves, saved from spiders, shot free on the big rock); the spiders' string makes the bow, used at once,
// and the shard falls out of their web: the peak is a fight, not a hand-over. Fishing moves to home4 (Dad's old rod).
// Package 44a (the wild stretch): the web trail to the big rock. Spiders, webs to cut, two webs hung too high for a
// sword (the new bow, used at once), a chest of arrows by the last one, then Nod on the rock.
import type { QuestDef } from '../../core/types.ts';

export const ch4: QuestDef = {
  id: 'ch4',
  name: 'The Lost Joeys',
  kind: 'main',
  chapter: 4,
  region: 'gum',
  giver: 'mama_koala',
  auto: true,
  path: true,
  requires: {
    done: ['ch3', 'home3'],
  },
  visible: 'The koala treehouse stands in the grove with its lights on, and three joeys are home with Mama Koala.',
  steps: [
    {
      t: 'talk',
      who: 'daddy_pig',
      goal: 'Ask Daddy Pig about the squeak',
      say: ['daddy_pig: A squeak past the fallen gum tree! You need a stone axe.'],
    },
    {
      t: 'craft',
      far: 'Go to the little house',
      item: 'stone_axe',
      mark: 'peppa_bench',
    },
    {
      t: 'reach',
      place: 'sign_gum',
      clear: ['fallen_gum'],
      goal: 'Chop through the fallen gum tree',
      mark: 'fallen_tree',
      say: ['you: Six big chops! Something squeaks.'],
    },
    {
      t: 'talk',
      who: 'mama_koala',
      say: [
        'mama_koala: The boom shook my 3 joeys out of our tree!',
        'mama_koala: Joeys love gum leaves. Shake a tree!',
        {
          l: 'mama_koala: A little cousin came to help. Thank you!',
          if: {
            hero: 'koala',
          },
        },
      ],
    },
    {
      t: 'fetch',
      item: 'gum_leaf',
      n: 3,
      goal: 'Find 3 gum leaves',
    },
    {
      t: 'lead',
      animal: 'joey',
      pen: 'pen_koala',
      goal: 'Lead Dot home from the log',
      mark: 'herd_joey_1',
      say: ['mama_koala: Dot! Bean ran to the ferns.'],
      fx: {
        stickers: ['joey_1'],
        emeralds: 2,
        time: 'night',
        spawn: [
          {
            mob: 'spider',
            n: 3,
            at: 'herd_joey_2',
          },
        ],
      },
    },
    {
      t: 'defeat',
      mob: 'spider',
      n: 3,
      mark: 'herd_joey_2',
      goal: 'Beat 3 spiders by the ferns',
      say: ['say: Bean hops out and hugs your leg.'],
      fx: {
        stickers: ['joey_2'],
        emeralds: 2,
      },
    },
    {
      t: 'talk',
      who: 'mama_koala',
      goal: 'Ask Mama Koala about the string',
      say: ['mama_koala: Make a bow and 4 arrows. Then try my targets!'],
      fx: {
        recipes: ['bow', 'arrow'],
        flags: ['archery'],
      },
    },
    {
      t: 'craft',
      item: 'bow',
      goal: 'Make a bow',
    },
    {
      t: 'craft',
      item: 'arrow',
      n: 4,
      goal: 'Make 4 arrows',
    },
    // package 47a: the chapter's set piece, straight after the bow (arrows are not used up in the game)
    {
      t: 'mini',
      game: 'targets',
      mark: 'gum_range',
      goal: 'Hit the targets',
      say: ['mama_koala: Now find Nod past the webs!'],
    },
    {
      t: 'reach',
      place: 'web_trail',
      goal: 'Go into the web trail',
      // it is dark under the big trees: the spiders are awake
      fx: {
        time: 'night',
        spawn: [
          {
            mob: 'spider',
            n: 3,
            at: 'trail_spiders',
          },
        ],
      },
    },
    {
      t: 'defeat',
      mob: 'spider',
      n: 3,
      mark: 'trail_spiders',
      goal: 'Beat 3 spiders on the trail',
    },
    {
      t: 'reach',
      place: 'trail_webs',
      clear: ['i_web_wall_1', 'i_web_wall_2', 'i_web_wall_3', 'i_web_wall_4'],
      goal: 'Cut through the webs',
    },
    // package 47a: a longer trail; a fallen gum tree across the way down (the stone axe chops it)
    {
      t: 'reach',
      place: 'trail_gum',
      clear: ['trail_gum'],
      goal: 'Chop through the fallen tree',
    },
    {
      t: 'reach',
      place: 'herd_joey_3',
      goal: 'Hit the high webs with arrows',
      say: ['you: Nod is asleep on top. Spiders are climbing up!'],
      fx: {
        spawn: [
          {
            mob: 'spider',
            n: 2,
            at: 'herd_joey_3',
          },
          {
            mob: 'zombie',
            n: 1,
            at: 'herd_joey_3',
          },
        ],
      },
    },
    {
      t: 'defeat',
      mob: 'any',
      n: 3,
      mark: 'herd_joey_3',
      goal: 'Save Nod from the spiders',
      say: ['say: Nod slides down. A star shard falls from the web!'],
      fx: {
        shard: 4,
        flags: ['clue:4'],
        stickers: ['joey_3'],
        emeralds: 2,
        time: 'morning',
      },
    },
    // package 47a: Nod goes home the way she came, back through the trail
    {
      t: 'lead',
      animal: 'joey',
      pen: 'pen_koala',
      goal: 'Lead Nod home',
      mark: 'herd_joey_3',
    },
    {
      t: 'talk',
      who: 'mama_koala',
      say: ['mama_koala: Our old tree is cracked. Build us a treehouse?'],
      fx: {
        flags: ['treehouse_plan'],
      },
    },
    {
      t: 'site',
      site: 'treehouse',
      goal: 'Build the koala treehouse',
      fx: {
        cut: 'minions_treehouse',
      },
    },
    {
      t: 'site',
      site: 'treehouse_lights',
      goal: 'Light the treehouse with 4 torches',
    },
    {
      t: 'reach',
      place: 'clue_4',
      goal: 'Look under the treehouse',
      say: ['you: A black mark and a flower.', 'say: Dot curls up. A sad green one stood here.'],
    },
  ],
  rewards: {
    mail: ['dad_2', 'kuromi_1'],
    emeralds: 8,
    give: {
      fishing_rod: 1,
    },
    recipes: ['boat', 'koala_statue', 'fishing_rod'],
  },
};
