// The secret after the credits (package 70, D43): three singers in three quiet corners, then one night show.
// It opens with a morning card the first morning after the party (no banner, no new menu). Rumi is found by the
// waterfall (a find), Mira by the sea in Gum Tree Grove (a craft), Zoey on the far plains (a round of Keepy Uppy);
// then the last mobs come to the show in Wishing Square and the song sends them away while she fights them.
// The tune is the game's own (src/game/music.ts 'concert'): no lyrics, no show audio, no episode text.
import type { QuestDef } from '../../core/types.ts';

export const secret: QuestDef = {
  id: 'secret',
  name: 'The Secret Show',
  kind: 'side',
  region: 'square',
  giver: 'rumi',
  group: 'huntrix',
  style: 'explore',
  auto: true,
  card: { who: 'rumi', gift: 'ticket', if: { done: 'finale' }, home: ['rumi', 'mira', 'zoey'] },
  requires: { done: 'finale', flag: 'card:secret' },
  visible: 'Rumi, Mira and Zoey are her friends now.',
  steps: [
    {
      t: 'talk',
      who: 'rumi',
      goal: 'Find the singer by the waterfall',
      far: 'Go to the waterfall',
      mark: 'secret_rumi',
      say: ['rumi: Hi! I am Rumi. I sing with my friends.', 'rumi: I lost my mic in the woods. Can you find it?'],
    },
    {
      t: 'fetch',
      item: 'mic',
      drop: [{ item: 'mic', at: 'secret_mic' }],
      mark: 'secret_mic',
      goal: "Find Rumi's mic",
      far: 'Go to the waterfall',
      say: ['rumi: My mic! Thank you.', 'rumi: Now find Mira by the sea in Gum Tree Grove.'],
      fx: { take: { mic: 1 } },
    },
    {
      t: 'talk',
      who: 'mira',
      goal: 'Find Mira by the sea',
      far: 'Go to Gum Tree Grove',
      mark: 'secret_mira',
      say: ['mira: Hi, I am Mira. Our show needs lights.', 'mira: Make 3 light sticks? Zoey is on the far plains.'],
      fx: { recipes: ['light_stick'] },
    },
    {
      t: 'craft',
      item: 'light_stick',
      n: 3,
      far: 'Go to a crafting table',
      mark: 'plot_gate',
      say: ['you: 3 light sticks. Now to find Zoey!'],
    },
    {
      t: 'talk',
      who: 'zoey',
      goal: 'Find Zoey on the far plains',
      far: 'Go to the far plains',
      mark: 'secret_zoey',
      say: ['zoey: Hi! I am Zoey. Can you keep a beat?', 'zoey: Keep the balloon up with me!'],
    },
    {
      t: 'mini',
      game: 'keepy',
      goal: 'Play Keepy Uppy with Zoey',
      far: 'Go back to Zoey',
      mark: 'secret_zoey',
      say: ['zoey: You have the beat! The show is tonight.'],
      fx: { time: 'night', cut: 'secret_dusk' },
    },
    {
      t: 'night',
      place: 'secret_stage',
      goal: 'Go to the show',
      far: 'Go to Wishing Square',
      say: ['rumi: You came! We sing, you fight.', 'say: The last mobs creep out of the dark!'],
      fx: {
        music: 'concert',
        spawn: [
          { mob: 'zombie', n: 2, at: 'secret_mobs' },
          { mob: 'spider', n: 2, at: 'secret_mobs' },
        ],
      },
    },
    {
      t: 'defeat',
      mob: 'any',
      n: 4,
      goal: 'Beat the 4 mobs',
      far: 'Go to Wishing Square',
      mark: 'secret_mobs',
      say: ['say: The song grows. The mobs run away!'],
      fx: { cut: 'secret_show' },
    },
  ],
  rewards: { emeralds: 30, flags: ['huntrix'] },
};
