// The finale: light the tree.
// One quest per file since phase 2 (18 Nov 2026). A choice is { text, then } and `then` holds the lines that follow.
// Package 33b (phase 2, steps 3 and 5): no party cards round the island and no chores. She melts the glass, makes
// the star with the gold she kept, Aunty has posted the cards, so the party comes to her; one quick fight for the
// party food, 3 ladders she makes, and the climb. Package 53b: the star lights the tree the moment she sets it;
// everyone arrives after that, most with a wave. Dad's letter and the photo are as they were.
import type { QuestDef } from '../../core/types.ts';

export const finale: QuestDef = {
  id: 'finale',
  name: 'Light the Tree',
  kind: 'main',
  chapter: 8,
  region: 'square',
  giver: 'grandad',
  auto: true,
  path: true,
  requires: {
    done: 'ch7',
  },
  visible: 'The Wishing Star shines on top of the Great Tree and the whole island is lit.',
  steps: [
    {
      t: 'talk',
      who: 'grandad',
      say: ['grandad: All 7 shards! Now melt sand into glass for the star.'],
      fx: {
        recipes: ['wishing_star', 'gold_ingot', 'glass'],
      },
    },
    {
      t: 'fetch',
      item: 'sand',
      goal: 'Dig 1 sand on the beach',
      mark: 'sign_bay',
    },
    {
      t: 'craft',
      item: 'glass',
      goal: 'Make glass from the sand',
      mark: 'plot_gate',
      say: ['you: Clear and shiny. Back to {grandad}!'],
    },
    {
      t: 'craft',
      item: 'wishing_star',
      goal: "Make the star at {grandad}'s bench",
      mark: 'workshop',
      say: ['grandad: There she is. Good as new!', 'say: Groan! Zombies at the Great Tree!'],
      fx: {
        flags: ['star_made'],
        spawn: [
          {
            mob: 'zombie',
            n: 2,
            at: 'party_1',
          },
        ],
      },
    },
    {
      t: 'defeat',
      mob: 'zombie',
      n: 2,
      mark: 'party_1',
      say: ['you: Not at our party!'],
    },
    {
      t: 'site',
      site: 'tree_ladders',
      goal: 'Put 3 ladders up the tree',
      say: [
        {
          l: 'you: This is it. The last climb.',
          choices: [
            {
              text: 'I am ready!',
              then: ['say: You hold the star tight. Up you go.'],
            },
            {
              text: 'One big breath first',
              then: ['say: In and out. Now you are ready.'],
            },
          ],
        },
      ],
      fx: {
        time: 'dusk',
      },
    },
    {
      t: 'reach',
      place: 'great_tree',
      goal: 'Put the star on the tree',
      fx: {
        cut: 'finale',
      },
    },
  ],
  rewards: {
    emeralds: 30,
    flags: ['postgame'],
    // package 53b: a present under the tree is the first thing to do after the credits
    start: 'sq_tree_present',
  },
};
