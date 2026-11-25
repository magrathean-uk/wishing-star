// The story's set-piece scenes, played in the world with the animated characters.
import type { CutAct, CutsceneDef } from '../core/types.ts';

const C: Record<string, CutsceneDef> = {};
const scene = (id: string, acts: CutAct[]) => {
  C[id] = { id, acts };
};

/** The Minion building crew swarm a site, work in a cloud of dust and run off again. */
function swarm(id: string, at: string, lines: string[], after: string[]): void {
  const crew = ['kevin', 'stuart', 'bob', 'minion_d', 'minion_e'];
  const acts: CutAct[] = [
    { a: 'cam', at },
    { a: 'wait', s: 0.5 },
    { a: 'sfx', id: 'giggle' },
  ];
  crew.forEach((who, i) =>
    acts.push({ a: 'spawn', who, at, x: -9 - i * 1.2, y: 3 + (i % 3) - 1, dir: 'right', clip: 'walk' }),
  );
  crew.forEach((who, i) =>
    acts.push({ a: 'move', who, at, x: -2 + i, y: 2 + (i % 2), speed: 5.5, go: i < crew.length - 1 }),
  );
  for (const l of lines) acts.push({ a: 'say', l });
  acts.push({ a: 'fx', id: 'build', at, s: 4 }, { a: 'sfx', id: 'build' });
  crew.forEach((who) => acts.push({ a: 'clip', who, clip: 'cheer' }));
  acts.push(
    { a: 'wait', s: 1.4 },
    { a: 'fx', id: 'build', at, s: 4 },
    { a: 'sfx', id: 'build' },
    { a: 'wait', s: 1.2 },
    { a: 'fx', id: 'confetti', at },
  );
  for (const l of after) acts.push({ a: 'say', l });
  crew.forEach((who, i) =>
    acts.push({ a: 'move', who, at, x: 10 + i, y: 4 + (i % 2), speed: 6, go: i < crew.length - 1 }),
  );
  crew.forEach((who) => acts.push({ a: 'hide', who }));
  acts.push({ a: 'cam' });
  scene(id, acts);
}
swarm(
  'minions_bridge',
  'sign_peppa',
  ['kevin: Hibbo! Build build build!'],
  ['stuart: Ta da! Bridge!', 'say: One is left hanging off the side!'],
);
swarm(
  'minions_treehouse',
  'mama_koala',
  ['kevin: Tree house! Up up up!'],
  ['bob: Koala! Fluffy!', 'mama_koala: Lovely! It only needs light.'],
);
swarm('minions_east', 'sign_plains', ['kevin: Stone bridge! Heavy! Go go go!'], ['bob: Ta da!']);

scene('picnic', [
  { a: 'cam', at: 'picnic' },
  { a: 'spawn', who: 'duck', at: 'ducks', x: 0, y: 2, dir: 'down', clip: 'walk' },
  { a: 'move', who: 'duck', at: 'picnic', x: -1, y: -1, speed: 1.6 },
  { a: 'say', l: 'pando: It is too hot for shorts. Whee!' },
  { a: 'sfx', id: 'quack' },
  { a: 'say', l: 'say: A duck walks off with the shorts on its head.' },
  { a: 'fx', id: 'heart', at: 'picnic' },
  { a: 'hide', who: 'duck' },
  { a: 'cam' },
]);

scene('king_calm', [
  { a: 'spawn', who: 'creeper_king', at: 'king_seat', dir: 'down', clip: 'dizzy' },
  { a: 'cam', at: 'king_seat', y: 2 },
  { a: 'wait', s: 0.8 },
  { a: 'clip', who: 'creeper_king', clip: 'calm' },
  { a: 'say', l: 'creeper_king: I did not pop. I am so, so sorry.' },
  { a: 'spawn', who: 'mum', at: 'hall_entry', x: -1, y: 1, dir: 'up', clip: 'walk' },
  { a: 'spawn', who: 'chilli', at: 'hall_entry', x: 1, y: 1, dir: 'up', clip: 'walk' },
  { a: 'move', who: 'mum', at: 'hall_mum', speed: 3.4, go: true },
  { a: 'move', who: 'chilli', at: 'hall_chilli', speed: 3.4 },
  { a: 'say', l: 'chilli: It is all right. Nobody is cross with you.' },
  { a: 'hide', who: 'mum' },
  { a: 'hide', who: 'chilli' },
  { a: 'hide', who: 'creeper_king' },
  { a: 'cam' },
]);

// Finale: everyone gathers in groups round the Square (never more than 6 in view); the camera visits each group for one line.
// Package 33b: the group before leaves the stage as the next one comes on, so the scene never has more than 6 on at once;
// the classmates, the teacher and Aunty have a group of their own (a wave, no line).
const group = (at: string, who: string[], line: string, before: string[] = []): CutAct[] => [
  ...before.map((w): CutAct => ({ a: 'hide', who: w })),
  ...who.map(
    (w, i): CutAct => ({
      a: 'spawn',
      who: w,
      at,
      x: (i - (who.length - 1) / 2) * 1.5,
      y: i % 2 ? 0.6 : 0,
      dir: 'down',
      clip: 'wave',
    }),
  ),
  { a: 'cam', at },
  { a: 'wait', s: line ? 0.7 : 1.6 },
  ...(line ? [{ a: 'say', l: line } as CutAct] : []),
];
const HEELERS = ['bandit', 'chilli', 'bingo', 'bluey'];
const PIGS = ['mummy_pig', 'daddy_pig', 'george', 'peppa', 'rex'];
const GARDEN = ['sula', 'pando', 'coco', 'bing', 'flop'];
const TOYS = ['woody', 'buzz', 'jessie', 'slinky', 'bo_peep'];
const SQUARE = ['hello_kitty', 'mimmy', 'kuromi', 'gabby', 'paddington', 'kevin'];
const SCHOOL = ['robin', 'sam', 'alex', 'charlie', 'teacher', 'aunty'];
// Package 53b: the star goes on and the tree lights first; then the groups arrive, most of them with only a wave.
scene('finale', [
  { a: 'music', id: 'finale' },
  { a: 'light', id: 'dark', s: 0.75 },
  { a: 'cam', at: 'great_tree', y: -2 },
  { a: 'spawn', who: 'you', at: 'great_tree', y: 0, dir: 'up' },
  { a: 'wait', s: 0.6 },
  { a: 'clip', who: 'you', clip: 'cheer' },
  { a: 'sfx', id: 'shard' },
  { a: 'fx', id: 'sparkle', at: 'great_tree', y: -4, s: 20 },
  { a: 'do', fx: { flags: ['tree_lit', 'presents'] } },
  { a: 'light', id: 'dark', s: 0.35 },
  { a: 'say', l: 'say: The Wishing Star shines again!' },
  { a: 'light', id: 'square' },
  { a: 'fx', id: 'boom', at: 'great_tree', x: -5, y: -6, s: 2 },
  { a: 'sfx', id: 'boom' },
  { a: 'wait', s: 0.6 },
  { a: 'light', id: 'heeler' },
  { a: 'fx', id: 'confetti', at: 'great_tree', x: 5, y: -5 },
  { a: 'wait', s: 0.5 },
  { a: 'light', id: 'bing' },
  { a: 'fx', id: 'boom', at: 'great_tree', x: 3, y: -7, s: 2 },
  { a: 'sfx', id: 'boom' },
  { a: 'wait', s: 0.5 },
  { a: 'light', id: 'peppa' },
  { a: 'fx', id: 'confetti', at: 'great_tree', x: -4, y: -4 },
  { a: 'light', id: 'gum' },
  { a: 'wait', s: 0.5 },
  { a: 'light', id: 'plains' },
  { a: 'fx', id: 'boom', at: 'great_tree', x: -2, y: -8, s: 2 },
  { a: 'sfx', id: 'boom' },
  { a: 'light', id: 'forest' },
  { a: 'wait', s: 0.5 },
  { a: 'light', id: 'crater' },
  ...group('party_1', HEELERS, 'bandit: We brought the sausages. And the balloon!'),
  ...group('party_2', PIGS, 'daddy_pig: Ho ho! I am an expert at parties.', HEELERS),
  ...group('party_4', GARDEN, '', PIGS),
  ...group('party_5', TOYS, 'buzz: What a star! The best party in space!', GARDEN),
  ...group('party_6', SQUARE, '', TOYS),
  ...group('party_7', SCHOOL, '', SQUARE),
  ...group('party_3', ['mum', 'dad', 'granny', 'nanny', 'grandad'], '', SCHOOL),
  { a: 'spawn', who: 'creeper_king', at: 'square_e', dir: 'left', clip: 'walk' },
  { a: 'cam', at: 'party_king' },
  { a: 'move', who: 'creeper_king', at: 'party_king', speed: 2 },
  { a: 'say', l: 'creeper_king: Am I late? I am trying not to pop!' },
  { a: 'spawn', who: 'mum', at: 'party_king', x: -2, y: 0.5, dir: 'right', clip: 'talk' },
  { a: 'say', l: 'mum: Count with us. One, two, three, four, five.' },
  { a: 'clip', who: 'creeper_king', clip: 'attack' },
  { a: 'wait', s: 0.8 },
  { a: 'clip', who: 'creeper_king', clip: 'calm' },
  { a: 'fx', id: 'confetti', at: 'party_king', y: -2 },
  { a: 'sfx', id: 'pop' },
  { a: 'say', l: 'say: Six, seven, eight, nine, ten! Just one tiny puff of confetti.' },
  { a: 'sfx', id: 'fanfare' },
  { a: 'spawn', who: 'dad', at: 'party_king', x: 2, y: 0.5, dir: 'left', clip: 'talk' },
  { a: 'say', l: 'dad: You lit up the whole island. I am so proud of you.' },
  { a: 'light', id: 'dark', s: 0 },
  { a: 'do', fx: { mailNow: ['dad_finale'], open: 'finale' } },
  { a: 'cam' },
]);

// ---- rare surprises (src/core/surprises.ts): short, silly and safe, each ends with a sticker
{
  const crew = ['kevin', 'stuart', 'minion_d', 'minion_e'];
  const acts: CutAct[] = [
    { a: 'cam', at: 'great_tree', y: 3 },
    { a: 'sfx', id: 'giggle' },
    { a: 'say', l: 'say: The ground rumbles!' },
  ];
  for (const [i, who] of crew.entries())
    acts.push({ a: 'spawn', who, at: 'great_tree', x: -13 - i * 1.3, y: 3.5 + (i % 2), dir: 'right', clip: 'walk' });
  for (const [i, who] of crew.entries())
    acts.push({ a: 'move', who, at: 'great_tree', x: 15 - i * 1.3, y: 3.5 + (i % 2), speed: 6.5, go: true });
  acts.push(
    { a: 'wait', s: 1.2 },
    { a: 'say', l: 'kevin: Banana! Banana! Banana!' },
    { a: 'say', l: 'say: A Minion stampede, chasing one banana!' },
    { a: 'sfx', id: 'giggle' },
    { a: 'say', l: 'stuart: Bee-do! Bee-do! Ha ha!' },
    { a: 'wait', s: 0.8 },
  );
  for (const who of crew) acts.push({ a: 'hide', who });
  acts.push({ a: 'say', l: 'say: A sticker blows past. You catch it!' }, { a: 'cam' });
  scene('surprise_stampede', acts);
}
scene('surprise_prank', [
  { a: 'cam', at: 'kuromi', x: -2, y: 2 },
  { a: 'move', who: 'you', at: 'kuromi', x: -3, y: 3 },
  { a: 'face', who: 'you', dir: 'up' },
  { a: 'say', l: 'say: It is quiet. Too quiet.' },
  { a: 'spawn', who: 'kuromi', at: 'kuromi', x: -3, y: 4.4, dir: 'up', clip: 'idle' },
  { a: 'sfx', id: 'pop' },
  { a: 'clip', who: 'kuromi', clip: 'cheer' },
  { a: 'say', l: 'kuromi: Boo!' },
  { a: 'clip', who: 'you', clip: 'hurt' },
  { a: 'fx', id: 'confetti', at: 'kuromi', x: -3, y: 3 },
  { a: 'face', who: 'you', dir: 'down' },
  { a: 'say', l: 'you: Kuromi! You made me jump out of my socks!' },
  { a: 'clip', who: 'you', clip: 'idle' },
  { a: 'say', l: 'kuromi: Hee-hee! Got you!' },
  { a: 'say', l: 'kuromi: Here, a sticker of my best trick!' },
  { a: 'move', who: 'kuromi', at: 'kuromi', x: 0, y: 0, speed: 3 },
  { a: 'hide', who: 'kuromi' },
  { a: 'cam' },
]);
scene('surprise_jockey', [
  { a: 'cam', at: 'sign_home', y: 1 },
  { a: 'sfx', id: 'cluck' },
  { a: 'say', l: 'say: Cluck cluck! Something small is trotting down the path.' },
  { a: 'spawn', who: 'chicken', at: 'sign_home', x: -11, y: 1, dir: 'right', clip: 'walk' },
  { a: 'move', who: 'chicken', at: 'sign_home', x: 11, y: 1, speed: 2.6, go: true },
  { a: 'wait', s: 2.2 },
  { a: 'say', l: 'say: It is a chicken jockey! A tiny zombie rides a chicken.' },
  { a: 'sfx', id: 'cluck' },
  { a: 'say', l: 'you: Go, little zombie! Hold on tight!' },
  { a: 'wait', s: 2 },
  { a: 'hide', who: 'chicken' },
  { a: 'say', l: 'say: They leave a sticker behind in the dust.' },
  { a: 'cam' },
]);

// ---- the post round (src/core/surprises.ts): on a morning with post, Paddington brings it to her mailbox.
// He is on his round from the boat long before he moves in at the Post Office (with the fifth shard): a scene,
// so he is seen and not met, and home stays quiet.
scene('post_round', [
  { a: 'spawn', who: 'paddington', at: 'mailbox', x: -7, y: 1.2, dir: 'right', clip: 'walk' },
  { a: 'move', who: 'paddington', at: 'mailbox', x: -1, y: 1.2, speed: 3 },
  { a: 'face', who: 'paddington', dir: 'up' },
  { a: 'sfx', id: 'pick' },
  { a: 'fx', id: 'sparkle', at: 'mailbox', s: 2 },
  { a: 'clip', who: 'paddington', clip: 'wave' },
  { a: 'say', l: 'paddington: Morning! Post for you!' },
  { a: 'move', who: 'paddington', at: 'mailbox', x: 8, y: 1.2, speed: 3 },
  { a: 'hide', who: 'paddington' },
]);

// ---- the secret show (package 70, src/data/quests/secret.ts). After her game Zoey waves and runs off to get ready.
scene('secret_dusk', [
  { a: 'spawn', who: 'zoey', at: 'secret_zoey', dir: 'down', clip: 'wave' },
  { a: 'sfx', id: 'pop' },
  { a: 'wait', s: 1 },
  { a: 'move', who: 'zoey', at: 'secret_zoey', x: 10, y: 1, speed: 4 },
  { a: 'hide', who: 'zoey' },
]);
// The song sends the last mobs away: the three cheer by the orange trees, then wave and go home.
scene('secret_show', [
  { a: 'cam', at: 'secret_stage', y: -1 },
  { a: 'spawn', who: 'rumi', at: 'secret_stage_r', dir: 'down', clip: 'cheer' },
  { a: 'spawn', who: 'mira', at: 'secret_stage_m', dir: 'down', clip: 'cheer' },
  { a: 'spawn', who: 'zoey', at: 'secret_stage_z', dir: 'down', clip: 'cheer' },
  { a: 'fx', id: 'confetti', at: 'secret_stage', y: -2 },
  { a: 'sfx', id: 'fanfare' },
  { a: 'fx', id: 'sparkle', at: 'secret_stage_m', y: -1, s: 6 },
  { a: 'fx', id: 'sparkle', at: 'secret_stage_z', y: -1, s: 6 },
  { a: 'wait', s: 1.4 },
  { a: 'clip', who: 'rumi', clip: 'talk' },
  { a: 'say', l: 'rumi: Thank you! You are one of us now.' },
  { a: 'clip', who: 'zoey', clip: 'talk' },
  { a: 'say', l: 'zoey: Come and play any time!' },
  { a: 'clip', who: 'rumi', clip: 'wave' },
  { a: 'clip', who: 'mira', clip: 'wave' },
  { a: 'clip', who: 'zoey', clip: 'wave' },
  { a: 'wait', s: 1.2 },
  { a: 'move', who: 'mira', at: 'secret_stage_m', x: -6, y: 5, speed: 4, go: true },
  { a: 'move', who: 'zoey', at: 'secret_stage_z', x: -2, y: 7, speed: 4, go: true },
  { a: 'move', who: 'rumi', at: 'secret_stage_r', x: -4, y: 7, speed: 4 },
  { a: 'hide', who: 'rumi' },
  { a: 'hide', who: 'mira' },
  { a: 'hide', who: 'zoey' },
  { a: 'music' },
  { a: 'cam' },
]);

export const scenes = C;
