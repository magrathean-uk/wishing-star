// The cast: who they are, where they stand and when, and their small talk.
// Names of real people are tokens filled from personal.json. Lines never write a real name as plain text.
import type { BodyType, CharDef, Cond, HeroDef, Role, Spot } from '../core/types.ts';

const C: Record<string, CharDef> = {};
interface Opt {
  tall?: number;
  standIn?: string;
  body?: BodyType;
  service?: string;
  speed?: number;
  noSticker?: boolean;
}
function ch(
  id: string,
  name: string,
  role: Role,
  group: string,
  spots: (Spot | string)[],
  chat: (string[] | { if: Cond; lines: string[] })[],
  o: Opt = {},
): void {
  C[id] = {
    id,
    name,
    role,
    group,
    body: o.body ?? 'biped',
    standIn: o.standIn,
    spots: spots.map((s) =>
      typeof s === 'string' ? { at: s, roam: role === 'walker' || role === 'hero' ? 2 : 0 } : s,
    ),
    chat: chat.map((c) => (Array.isArray(c) ? { lines: c } : c)),
    tall: o.tall,
    service: o.service,
    speed: o.speed,
    noSticker: o.noSticker,
  };
}
const at = (place: string, cond?: Cond, extra: Partial<Spot> = {}): Spot => ({
  at: place,
  if: cond,
  roam: 2,
  ...extra,
});
const still = (place: string, cond?: Cond, extra: Partial<Spot> = {}): Spot => ({
  at: place,
  if: cond,
  roam: 0,
  ...extra,
});
const after = (n: number): Cond => ({ shards: n });

// A quiet home (phase 2, part B; checked by tools/check/calm.ts). Named characters in the home and Square regions:
// day 1: Mum, Dad, Grandad, Granny and the koala toy (or Amelia herself when she is not the hero);
// day 2: Aunty, and Hamm once found; 1 shard: Nanny; 2: the four classmates (Dad moves to his lookout);
// 3: Hello Kitty and Cakey; 4: the teacher, and Buzz once found (Kuromi's stall at night); 5: Woody, and Paddington
// once found; 6: Mimmy, and Mr Potato Head once found (Baku at night); 7: Gabby, and Kitty Fairy once found;
// after the party: DJ Catnip. Whoever has a side quest on the main path comes first.
// Found (package 43b; a `found` spot, then home after a morning card): the toys the boom scattered go back to the toy
// box, Hamm from the beach (day 2), Buzz from a gum tree in the Grove (4), Mr Potato Head from the Mine carts (6),
// Paddington from the jetty (5); Kitty Fairy from the Crater flowers (7). Forky stays on Treasure Island (party).
// Found where they stay: Slinky at the gorge creek (2), Rex with George on Peppa's Hill (3), Pandy on the beach and
// MerCat at the rock pools (4), Bo Peep on the Plains (4), Jessie and Bullseye at Bo Peep's pen (after chapter 5).
// The shop villager opens his stall with the first shard.
const party: Cond = { flag: 'postgame' };
/** Package 78: the lamp shines tonight and nobody has said so yet (one line a night, from someone in the bay). */
const lampNote: Cond = { lamp: true };
/** A stand-in keeps the place of a friend hero who is being played, from the shard that friend arrives with. */
const standsIn = (place: string, hero: string, n: number, extra: Cond = {}): Spot =>
  still(place, { hero, shards: n, ...extra });

// ---------------------------------------------------------------- the fourteen heroes (friends when not being played)
ch(
  'amelia',
  '{amelia}',
  'hero',
  'hero_amelia',
  [at('amelia_home')],
  [['It is a good day for an adventure!', 'I love my red top. It is my lucky one.', 'Shall we find the next shard?']],
  { standIn: 'mum', tall: 1.75 },
);
ch(
  'koala',
  '{koala}',
  'hero',
  'hero_koala',
  // her toy stays by the cottage when she is the hero; for the other heroes it is visiting its cousins in the grove
  [at('koala_home', { hero: 'amelia' }), at('koala_home', party), at('koala_grove', undefined, { roam: 1 })],
  [['I am small. I am brave too.', 'Gum leaves smell like home.', 'Hugs first. Then adventure.']],
  { standIn: 'mama_koala', tall: 1.3 },
);
ch(
  'bluey',
  'Bluey',
  'hero',
  'hero_bluey',
  [at('bluey_home')],
  [
    [
      'Wanna play a game? I know a hundred!',
      'For real life? That was amazing!',
      'Dad says I have too much energy. No way.',
    ],
  ],
  { standIn: 'bingo', tall: 1.7 },
);
ch(
  'bing',
  'Bing',
  'hero',
  'hero_bing',
  [still('in_bing', { done: 'ch2', hero: 'flop', night: true }), at('bing_home')],
  [
    {
      if: { night: true, hero: 'flop' },
      lines: ['I am not sleepy. Well, maybe a bit.', 'Can you read me a story? Please?'],
    },
    ['I like my garden. It has a swing!', 'Flop says go slow. I am trying.', 'Yup! I can do that.'],
  ],
  { standIn: 'flop', tall: 1.5 },
);
ch(
  'flop',
  'Flop',
  'hero',
  'hero_flop',
  [still('in_bing', { done: 'ch2', night: true }), still('flop')],
  [
    {
      if: { night: true, done: 'ch2' },
      lines: ['Bing is asleep. It was a big day.', 'Sit for a bit. Then off home to bed.'],
    },
    ['Good for you. One step at a time.', 'It is no big thing. We can fix it.', 'Indeed. Shall we try again together?'],
  ],
  { standIn: 'bing', tall: 1.15 },
);
ch(
  'peppa',
  'Peppa',
  'hero',
  'hero_peppa',
  [at('peppa_home')],
  [['I love jumping in muddy puddles!', 'Everybody loves muddy puddles.', 'My little house is on a very big hill.']],
  { standIn: 'mummy_pig', tall: 1.6 },
);
ch(
  'woody',
  'Woody',
  'hero',
  'hero_woody',
  // he rides in to the village defence in chapter 5, then moves in to Toy Box Corner with shard 5
  [at('woody_village', { flag: 'defence_on' }), at('woody', { done: 'ch5' })],
  [
    {
      if: after(1),
      lines: ['My posters are on the board in the Square.', 'Those zombies will not round up themselves.'],
    },
    ['Howdy, partner! All quiet in Toy Box Corner.', 'A good sheriff looks after his friends.'],
  ],
  { standIn: 'jessie', tall: 2.2 },
);
ch(
  'buzz',
  'Buzz',
  'hero',
  'hero_buzz',
  // found up a gum tree in the Grove (from shard 4), then home to the star radar
  [at('buzz_tree', after(4), { found: 'found_buzz', roam: 0 }), at('buzz', { flag: 'found_buzz' })],
  [
    [
      'The boom threw me into a gum tree. Thank you!',
      'Star radar is working. All clear, for now.',
      'I am watching the sky for falling stars.',
      'To the stars! And home in time for tea.',
    ],
  ],
  { standIn: 'rex', tall: 2 },
);
ch(
  'jessie',
  'Jessie',
  'hero',
  'hero_jessie',
  // she stands still at her place: when she roamed she could end up inside the paddock, where nobody can reach her
  [
    at('jessie_village', { flag: 'defence_on' }),
    standsIn('woody', 'woody', 5),
    at('jessie_plains', { done: 'ch5' }, { roam: 0 }),
  ],
  [['Yee-ha! Animals love a kind voice.', 'Hold out their food and walk slow.', 'Bullseye says hello. He is shy.']],
  { standIn: 'woody', tall: 2.1 },
);
ch(
  'hello_kitty',
  'Hello Kitty',
  'hero',
  'hero_hello_kitty',
  [still('hello_kitty', after(3))],
  [['Welcome to the Apple Cafe!', 'Apple pie makes everything better.', 'I baked something sweet today.']],
  { standIn: 'mimmy', tall: 1.6, service: 'shop:cafe' },
);
ch(
  'kuromi',
  'Kuromi',
  'hero',
  'hero_kuromi',
  [still('kuromi', { flag: 'kuromi_swap' }), still('kuromi', { shards: 4, night: true })],
  [
    [
      'Hee hee! Spooky things for sale.',
      'Creepers are cute. Do not tell anyone I said so.',
      'My stall opens when the moon is up.',
    ],
  ],
  { standIn: 'baku', tall: 1.6, service: 'shop:kuromi' },
);
ch(
  'gabby',
  'Gabby',
  'hero',
  'hero_gabby',
  [still('gabby', after(7))],
  [
    [
      'Hey there! Want to make your home pretty?',
      'A little box might be on its way to you.',
      'Every room needs one happy thing.',
    ],
  ],
  { standIn: 'pandy', tall: 1.8, service: 'shop:dollhouse' },
);
ch(
  'paddington',
  'Paddington',
  'hero',
  'hero_paddington',
  // found on the jetty with his suitcase (from shard 5), then home to the Post Office
  [
    still('paddington_jetty', after(5), { found: 'found_paddington', dayOnly: true }),
    at('paddington_post', { flag: 'found_paddington' }, { dayOnly: true }),
  ],
  [
    [
      'I came on the boat. What a lovely island.',
      'Good morning. I have a letter round to do.',
      'Aunt Lucy says to always be polite.',
      'A marmalade sandwich helps on a long walk.',
    ],
  ],
  { standIn: 'stuart', tall: 1.8 },
);
ch(
  'bob',
  'Bob',
  'hero',
  'hero_bob',
  [at('bob', { flag: 'minions_here' })],
  [['Hibbo! Banana?', 'Bob happy! La la la!', 'Teddy? Where teddy?']],
  { standIn: 'kevin', tall: 1.35 },
);

// ---------------------------------------------------------------- Bluey's family (Heeler Heights)
ch(
  'bandit',
  'Bandit',
  'walker',
  'heeler',
  [at('bandit')],
  [
    { if: after(1), lines: ['The backyard glows now. Good work, kid.', 'Keepy Uppy again? I have been training.'] },
    ['A dad is always ready to play. Mostly.', 'My back is fine. It is totally fine.'],
  ],
  { tall: 2.2, service: 'mini:keepy' },
);
ch(
  'chilli',
  'Chilli',
  'walker',
  'heeler',
  [
    still('hall_chilli', { active: 'ch7', flag: 'king_calm' }),
    still('in_heeler', { done: 'ch1', night: true }),
    at('chilli'),
  ],
  [
    {
      if: { night: true, done: 'ch1' },
      lines: [
        'Shh. The girls are nearly asleep. Come in, quietly.',
        'Bandit is reading the bedtime story. With voices.',
      ],
    },
    { if: after(1), lines: ['It feels safe out here at night now.', 'Thank you for helping my girls.'] },
    ['Take your time. It is not a race.', 'You are doing great, you know.'],
  ],
  { tall: 2.1 },
);
ch(
  'bingo',
  'Bingo',
  'walker',
  'heeler',
  [at('bingo')],
  [
    [
      'I like looking at little things. Like ants.',
      'Can I come too? I can be very quiet.',
      'Bluey makes the rules. I make them fun.',
    ],
  ],
  { tall: 1.5 },
);

// ---------------------------------------------------------------- Peppa's family (Peppa's Hill)
ch(
  'mummy_pig',
  'Mummy Pig',
  'walker',
  'peppa',
  [still('in_peppa', { done: 'ch3', night: true }), at('mummy_pig')],
  [
    {
      if: { night: true, done: 'ch3' },
      lines: ['Hello, dear! George is in bed with his dinosaur.', 'Daddy Pig is mending the toy train. Again.'],
    },
    { if: after(3), lines: ['The valley is lovely and muddy again.', 'Wellies on before puddles, please.'] },
    ['Hello! Mind the hill. It is rather steep.', 'I do like a tidy garden.'],
  ],
  { tall: 2 },
);
ch(
  'daddy_pig',
  'Daddy Pig',
  'walker',
  'peppa',
  [at('daddy_pig')],
  [['I am a bit of an expert at rocks.', 'Now, where did I put my glasses?', 'Ho ho! A fine day for a walk.']],
  { tall: 2.2 },
);
ch('george', 'George', 'walker', 'peppa', [at('george')], [['Dine-saw! Grrr!', 'Dine-saw?', 'Hee hee! Grrr!']], {
  tall: 1.3,
});

// ---------------------------------------------------------------- Bing's friends (Bing's Garden)
ch(
  'sula',
  'Sula',
  'walker',
  'bing',
  [at('sula')],
  [['I love to sing while I swing!', 'Bing lost a thing again. Oh dear.', 'Shall we play a clapping game?']],
  { tall: 1.5 },
);
ch(
  'pando',
  'Pando',
  'walker',
  'bing',
  [at('pando')],
  [['I can run so fast! Watch me!', 'Shorts are for taking off. Whee!', 'Can we have a snack now?']],
  { tall: 1.5, service: 'mini:hide' },
);
ch(
  'coco',
  'Coco',
  'walker',
  'bing',
  [at('coco')],
  [
    [
      'I am the biggest. So I know best.',
      'Chickens love seeds. Everyone knows that.',
      'Do it like this. No, like THIS.',
    ],
  ],
  { tall: 1.7 },
);

// ---------------------------------------------------------------- koalas (Gum Tree Grove)
ch(
  'mama_koala',
  'Mama Koala',
  'walker',
  'gum',
  [at('mama_koala', undefined, { roam: 1 })],
  [
    { if: after(4), lines: ['The treehouse is warm and bright.', 'All my joeys sleep well now. Thank you.'] },
    ['Mind the low branches, little one.', 'My joeys love a soft gum leaf.'],
  ],
  { tall: 1.9 },
);

// ---------------------------------------------------------------- Toy Box Corner
ch(
  'rex',
  'Rex',
  'walker',
  'home',
  // found on Peppa's Hill by chapter 3; he stays there with George, his new friend
  [standsIn('buzz', 'buzz', 4), at('rex_hill', after(3))],
  [
    {
      if: { done: 'ch3' },
      lines: ['George thinks I am the best dinosaur!', 'I roared and nobody ran. I am so happy.'],
    },
    ['Was that a growl? Oh. It was my tummy.', 'I am a scary dinosaur. Am I scary?'],
  ],
  { tall: 2.2 },
);
ch(
  'hamm',
  'Hamm',
  'fixed',
  'home',
  // found on the sand at Sandy Bay (from day 2), then home to the prize counter
  [still('hamm_beach', { flag: 'day2' }, { found: 'found_hamm' }), still('hamm', { flag: 'found_hamm' })],
  [
    [
      'Thanks for finding me, kid. Sand everywhere!',
      'Step right up to the prize counter.',
      'Tickets come from stars. Stars come from games.',
      'I am a piggy bank. I know value.',
    ],
  ],
  { tall: 1.2, service: 'shop:prizes', body: 'quad' },
);
ch(
  'slinky',
  'Slinky',
  'walker',
  'home',
  [at('slinky_wait', after(2), { roam: 0 })],
  [['Golly bob howdy! Good to see you.', 'I can stretch a mighty long way.', 'A good dog sticks by his friends.']],
  { tall: 1.1, body: 'quad' },
);
ch(
  'potato',
  'Mr Potato Head',
  'fixed',
  'home',
  // found by the Mine carts (from shard 6), then home to Toy Box Corner
  [still('potato_carts', after(6), { found: 'found_potato' }), still('potato', { flag: 'found_potato' })],
  [
    [
      'Hey! Have you seen my nose?',
      'Some of my parts flew off in the boom.',
      'I would look for them but I lost my eyes.',
    ],
  ],
  { tall: 1.5 },
);
ch(
  'bo_peep',
  'Bo Peep',
  'walker',
  'plains',
  [at('bo_peep_plains', after(4), { roam: 1 })],
  [
    [
      'My sheep wander off the moment I blink.',
      'Wool keeps the whole island warm.',
      'A steady hand and a kind word. That is all.',
    ],
  ],
  { tall: 2.1 },
);
ch(
  'alien',
  'Alien',
  'fixed',
  'home',
  // He is out of the claw machine only while Hamm's side quest looks for him (package 14).
  [still('alien_spot', { flag: 'alien_out' })],
  [['We came in a prize ball. We like it here!']],
  {
    tall: 1.3,
    noSticker: true,
  },
);
ch(
  'forky',
  'Forky',
  'fixed',
  'home',
  // found on Treasure Island after the party, where he stays: Toy Box Corner already holds 5
  [still('forky_found', party)],
  [['I am not a toy. I was made for soup!', 'Is this the bin? I like the bin.', 'Oh. I am a friend now. Good.']],
  { tall: 1.2 },
);
ch(
  'bullseye',
  'Bullseye',
  'walker',
  'home',
  [at('bullseye_plains', { done: 'ch5' }, { roam: 1 })],
  [['say: Bullseye nods and stamps a hoof.', 'say: Bullseye nuzzles your hand.']],
  { tall: 1.8, body: 'quad' },
);

// ---------------------------------------------------------------- Sanrio (Wishing Square)
ch(
  'mimmy',
  'Mimmy',
  'walker',
  'square',
  [standsIn('hello_kitty', 'hello_kitty', 3), at('mimmy', after(6), { roam: 1 })],
  [['I am the twin with the yellow bow.', 'My sister bakes. I do the flowers.', 'Do try the apple pie.']],
  { tall: 1.6 },
);
ch(
  'baku',
  'Baku',
  'walker',
  'square',
  [
    standsIn('kuromi', 'kuromi', 4, { flag: 'kuromi_swap' }),
    // nightOnly rather than a night condition, so the morning card can announce him (package 43b)
    still('kuromi', { hero: 'kuromi', shards: 4 }, { nightOnly: true }),
    at('baku', after(6), { roam: 1, nightOnly: true }),
  ],
  [
    [
      'I carry the stall. All of it. Every night.',
      'Kuromi is the boss. I am the friend.',
      'Night is the best time for a snack.',
    ],
  ],
  { tall: 1.3 },
);

// ---------------------------------------------------------------- the Minions (Sandy Bay banana grove)
const minion = (id: string, name: string, place: string, lines: string[], tall = 1.5, lamp?: string) =>
  ch(
    id,
    name,
    'walker',
    'bay',
    [at(place, { flag: 'minions_here' })],
    lamp ? [{ if: lampNote, lines: [lamp] }, lines] : [lines],
    {
      tall,
    },
  );
minion(
  'kevin',
  'Kevin',
  'kevin',
  ['Hibbo! Kevin big boss. Ha ha!', 'Build build build! Okay!', 'Banana for work. Good deal!'],
  1.8,
  'Big light! Ooh! Bay is safe!',
);
minion('stuart', 'Stuart', 'stuart', ['La la la. Stuart sing!', 'Banana? Ooh. Banana.', 'Byebo! Hee hee.'], 1.5);
minion('minion_d', 'Dave', 'minion_d', ['Weeoo! Weeoo!', 'Fanka! Ha ha ha.', 'Ooh! Shiny!'], 1.6);
minion('minion_e', 'Jerry', 'minion_e', ['Buddies! Yay!', 'Me want banana. Pleeease.', 'Loolaloo! Ha ha.'], 1.4);

// ---------------------------------------------------------------- Gabby's Dollhouse friends
ch(
  'pandy',
  'Pandy Paws',
  'walker',
  'square',
  [standsIn('gabby', 'gabby', 7), at('pandy_bay', after(4), { roam: 1 })],
  [['Hug attack! Got you.', 'I have a snack in my bag. Always.', 'Paw-some day for a delivery!']],
  { tall: 1.4 },
);
ch(
  'cakey',
  'Cakey',
  'fixed',
  'square',
  [still('cakey', after(3))],
  [
    [
      'Sprinkle party! Oh, I love sprinkles.',
      'I get a bit wobbly when things go wrong.',
      'Baking is just mixing with love.',
    ],
  ],
  { tall: 1.2 },
);
ch(
  'mercat',
  'MerCat',
  'fixed',
  'bay',
  [still('mercat', after(4))],
  [
    { if: lampNote, lines: ['The lamp is on! The bay feels safe.'] },
    [
      'The rock pools are full of sparkle today.',
      'Fish like a quiet float and a still hand.',
      'Sea water is very good for the fur.',
    ],
  ],
  { tall: 1.6 },
);
ch(
  'dj_catnip',
  'DJ Catnip',
  'fixed',
  'square',
  [still('dj_catnip', party)],
  [['Feel the beat, little friend.', 'Bring me a music disc and we will dance.', 'Every place has its own tune.']],
  { tall: 1.6, service: 'jukebox' },
);
ch(
  'kitty_fairy',
  'Kitty Fairy',
  'fixed',
  'square',
  // found in the Crater flower bed (from shard 7), then home to Granny's Garden
  [still('kitty_found', after(7), { found: 'found_kitty_fairy' }), still('kitty_fairy', { flag: 'found_kitty_fairy' })],
  [
    [
      'Flowers hear you when you are kind.',
      'A little kitty dust helps things grow.',
      'This garden hums when it is happy.',
    ],
  ],
  { tall: 1.3 },
);

// ---------------------------------------------------------------- real family and friends (see docs/PEOPLE.md)
ch(
  'mum',
  '{mum}',
  'walker',
  'home',
  [
    still('mum_inside', { atStep: ['prologue', 0, 2] }),
    still('hall_mum', { active: 'ch7', flag: 'king_calm' }),
    at('mum_garden', undefined, { roam: 1 }),
  ],
  [
    {
      if: { night: true },
      lines: ['It is dark out. Zombies keep away from lamps.', 'Bed is waiting whenever you are ready.'],
    },
    ['Come here, you. A hug fixes most things.', 'I am so proud of you. Off you go!'],
  ],
  { tall: 2.05, service: 'hug' },
);
ch(
  'dad',
  '{dad}',
  'walker',
  'home',
  [
    still('dad_inside', { atStep: ['prologue', 0, 2] }),
    at('dad_lookout', after(2), { roam: 1 }),
    at('dad_home', undefined, { roam: 1 }),
  ],
  [
    { if: after(4), lines: ['The sea is full of fish today.', 'I can see the whole bay from up here.'] },
    ['I drew the whole island on that map.', 'Look for the star on your map. That is where to go.'],
  ],
  { tall: 2.1 },
);
ch(
  'grandad',
  '{grandad}',
  'walker',
  'square',
  [
    still('grandad_mine', { atStep: ['ch6', 1, 99] }),
    still('in_workshop', { shards: 2, night: true }),
    at('grandad', undefined, { roam: 1 }),
  ],
  [
    {
      if: { night: true, shards: 2 },
      lines: ['My forge keeps me warm at night. Use it any time.', 'There is tea on the stove. Have a warm sip.'],
    },
    { if: after(3), lines: ['Stone tools now! You learn fast.', 'Bring me a puzzle and I am happy.'] },
    ['A good tool is a friend for life.', 'Measure twice. Cut once. Then have tea.'],
  ],
  { tall: 2.05 },
);
ch(
  'granny',
  '{granny}',
  'walker',
  'square',
  [at('granny', undefined, { roam: 1 })],
  [
    {
      if: { flag: 'seeds_open' },
      lines: ['The seed stall is open. Take your pick.', 'Plant today. Pick tomorrow. Easy.'],
    },
    ['Seeds are small. Give them time.', 'My garden likes a chat in the morning.'],
  ],
  { tall: 1.95, service: 'shop:seeds' },
);
ch(
  'nanny',
  '{nanny}',
  'walker',
  'square',
  [at('nanny', after(1), { roam: 1 })],
  [
    [
      'Knit one, loop one. That is the trick.',
      'Wool keeps a home soft and warm.',
      'Bring me wool and I will show you rugs.',
    ],
  ],
  { tall: 1.95, service: 'shop:nook' },
);
ch(
  'aunty',
  '{aunty}',
  'fixed',
  'square',
  [still('aunty', { flag: 'day2' }, { dayOnly: true })],
  [
    [
      'Post for everyone! I love a full sack.',
      'A letter is a hug you can keep.',
      'Check your mailbox in the morning, my love.',
    ],
  ],
  { tall: 1.9 },
);
ch(
  'teacher',
  '{teacher}',
  'walker',
  'square',
  [at('teacher', after(4), { roam: 1 })],
  [
    [
      'What did you find today? Show me!',
      'Every sticker tells a little story.',
      'The Nature Table is looking wonderful.',
    ],
  ],
  { tall: 2 },
);
ch(
  'robin',
  '{robin}',
  'walker',
  'square',
  [at('robin', after(2))],
  [['I know the best hiding places.', 'Do you want to play after this?', 'I saw a shooting star last night!']],
  { tall: 1.75, service: 'mini:hide' },
);
ch(
  'sam',
  '{sam}',
  'walker',
  'square',
  [at('sam', after(2))],
  [['Race you round the square!', 'I am so fast. My sister is faster.', 'Did you really fight a zombie?']],
  { tall: 1.7, service: 'mini:race' },
);
ch(
  'alex',
  '{alex}',
  'walker',
  'square',
  [at('alex', after(2))],
  [
    [
      'I am building a den. It needs a roof.',
      'My brother is great at games. I like building.',
      'Can I see your journal?',
    ],
  ],
  { tall: 1.7, service: 'mini:snowball' },
);
// D69: the fourth classmate. She arrives with the other three and hosts Keepy Uppy with her star balloon.
ch(
  'charlie',
  '{charlie}',
  'walker',
  'square',
  [at('charlie', after(2))],
  [
    [
      'I love drawing stars. Want to see?',
      'My balloon is shaped like a star!',
      'You can sit with us at lunch.',
      'I can keep a balloon up for ages!',
    ],
  ],
  { tall: 1.7, service: 'mini:keepy' },
);

// ---------------------------------------------------------------- Minecraft friends
const hrmm = ['Hrmm.', 'Hrmm? Hrmm.', 'Hrmm!'];
// While chapter 5 needs them the villagers are out at any hour; once the night defence starts they hide.
const villager = (id: string): Spot[] => [
  at(id, { active: 'ch5', noFlag: 'defence_on' }),
  at(id, undefined, { dayOnly: true }),
];
ch('trader', 'Shop villager', 'speakingMob', 'square', [still('trader', after(1))], [hrmm], {
  tall: 2,
  service: 'shop:shop',
});
ch('villager_1', 'Villager', 'speakingMob', 'plains', villager('villager_1'), [hrmm], {
  tall: 2,
});
ch(
  'villager_2',
  'Farmer',
  'speakingMob',
  'plains',
  [still('in_village', { done: 'ch5', night: true }), ...villager('villager_2')],
  [hrmm],
  {
    tall: 2,
  },
);
ch('villager_3', 'Villager', 'speakingMob', 'plains', villager('villager_3'), [hrmm], {
  tall: 2,
});
ch('villager_trader', 'Village trader', 'speakingMob', 'plains', [still('village_trader')], [hrmm], {
  tall: 2,
  service: 'shop:village',
});
ch(
  'golem',
  'Iron Golem',
  'speakingMob',
  'plains',
  [at('golem', undefined, { roam: 3 })],
  [['say: The iron golem looks at you kindly.', 'say: The golem creaks and holds out a flower.']],
  { tall: 2.9, speed: 1.1 },
);
ch(
  'wandering_trader',
  'Wandering trader',
  'speakingMob',
  'plains',
  [still('square_s', { flag: 'trader' }, { dayOnly: true })],
  [hrmm],
  { tall: 2, service: 'shop:trader' },
);

ch(
  'creeper_king',
  'Creeper King',
  'boss',
  'mobs',
  [
    still('king_seat', { flag: 'king_calm', noFlag: 'king_friend' }),
    still('party_king', { flag: 'postgame', night: true }, { nightOnly: true }),
    still('king_garden', { flag: 'king_friend' }),
  ],
  [
    [
      'I am counting to ten. One, two, three.',
      'These flowers are for everyone. I planted every one.',
      'Thank you for not being scared of me.',
    ],
  ],
  { tall: 3.2, body: 'blob' },
);

// ---------------------------------------------------------------- the secret show (package 70, after the credits)
// Three singers, found one at a time in three quiet corners; on the night of the show they stand by the orange
// trees in Wishing Square, then go back to their corners as her friends. The quest's card counts them home.
const showTime: Cond = { atStep: ['secret', 6] };
ch(
  'rumi',
  'Rumi',
  'walker',
  'huntrix',
  [still('secret_stage_r', showTime), at('secret_rumi', { flag: 'card:secret' }, { roam: 1 })],
  [['Sing with your whole heart!', 'My mic sounds better than ever.']],
  { tall: 1.9 },
);
ch(
  'mira',
  'Mira',
  'walker',
  'huntrix',
  [
    still('secret_stage_m', showTime),
    at('secret_mira', { any: [{ atStep: ['secret', 2] }, { done: 'secret' }] }, { roam: 1 }),
  ],
  [['My light stick still glows!']],
  { tall: 2 },
);
ch(
  'zoey',
  'Zoey',
  'walker',
  'huntrix',
  [
    still('secret_stage_z', showTime),
    at('secret_zoey', { any: [{ atStep: ['secret', 4] }, { done: 'secret' }] }, { roam: 1 }),
  ],
  [['Want to play again? I love a beat!']],
  { tall: 1.8, service: 'mini:keepy' },
);

// Friends who drop in on a comfortable morning (package 41's rule; words and presents by package 43a): one box each.
const visit = (id: string, gift: string, n: number, line: string): void => {
  if (C[id]) C[id].visit = { gift, n, line };
};
visit('bingo', 'flower_pot', 1, 'I brought you a flower. It is little, like me.');
visit('sula', 'cookie', 2, 'Flop and I baked cookies. These are for you!');
visit('george', 'toy_block', 1, 'Grrr! Dine-saw present! A block for your house.');
visit('hamm', 'ticket', 2, 'Tickets for the claw machine. Do not tell the others.');
visit('hello_kitty', 'cake', 1, 'Your home is so cosy! I made you a cake.');
visit('woody', 'toy_drum', 1, 'Howdy! This drum rolled out of the toy box.');
visit('paddington', 'marmalade', 1, 'Good morning. I always carry marmalade. For emergencies.');
visit('kevin', 'banana', 3, 'Hibbo! Banana! Banana for you!');
visit('rex', 'apple', 3, 'I am not scary. I brought you apples!');
visit('mama_koala', 'gum_leaf', 3, 'The joeys picked these leaves for you.');

export const chars = C;

// ---------------------------------------------------------------- hero definitions
const H: Record<string, HeroDef> = {};
function hero(id: string, starter: boolean, emote: string, lines: Record<string, string> = {}): void {
  H[id] = { id, starter, emote, lines };
}
hero('amelia', true, 'twirl', {
  mum: 'There is my girl. Look at you go!',
  dad: 'My brave explorer. The map is yours.',
  grandad: 'Ah, my best helper! Come in, come in.',
});
hero('koala', true, 'roll', {
  mama_koala: 'Well, hello, little cousin!',
  mum: 'Our koala can walk? Of course you can.',
  bluey: 'A koala! For real life!',
});
hero('bluey', true, 'dance', {
  bandit: 'Good morning, kid. Ready to play?',
  chilli: 'Look after yourself out there, Bluey.',
  mum: 'Hello, Bluey! Lovely to see you.',
});
hero('bing', true, 'hop', {
  flop: 'Good morning, Bing. Shall we try something new?',
  sula: 'Bing! Come and play with us!',
  mum: 'Hello, Bing. Mind the step.',
});
hero('flop', true, 'bow', {
  bing: 'Flop! Look what I can do!',
  sula: 'Hello, Flop! You are very small today.',
  mum: 'Good day, Flop. Always so calm.',
});
hero('peppa', true, 'splash', {
  mummy_pig: 'Peppa, dear. Wellies before puddles.',
  daddy_pig: 'Ho ho! Hello, my little piggy.',
  george: 'Peppa! Dine-saw!',
});
hero('woody', false, 'tip_hat', {
  buzz: 'Sheriff. The sky is quiet tonight.',
  jessie: 'Howdy, Woody! Race you to the fort.',
});
hero('buzz', false, 'salute', {
  woody: 'Looking sharp, Buzz. Any stars falling?',
  rex: 'Buzz! Will you teach me to be brave?',
});
hero('jessie', false, 'yodel', {
  woody: 'Howdy, Jessie! Best cowgirl on the island.',
  bullseye: 'say: Bullseye dances in a happy circle.',
});
hero('hello_kitty', false, 'wave', {
  mimmy: 'Sister! I picked flowers for the cafe.',
  cakey: 'Kitty! Can we add more sprinkles?',
});
hero('kuromi', false, 'cackle', {
  baku: 'Boss! I carried everything. Again.',
  hello_kitty: 'Oh, hello, Kuromi. No tricks in my cafe.',
});
hero('gabby', false, 'sparkle', { pandy: 'Gabby! Hug attack!', cakey: 'Gabby! Sprinkle party later?' });
hero('paddington', false, 'marmalade', {
  aunty: 'My best post bear! Hat on straight?',
  mum: 'Good morning, Paddington. Marmalade?',
});
hero('bob', false, 'giggle', { kevin: 'Bob! Hibbo! Banana?', stuart: 'Bob bob bob! La la!' });
export const heroes = H;
