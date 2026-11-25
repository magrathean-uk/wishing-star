// Package 73b (I4): the island friends' notes at the Post Office. One comes each game day, in turn, beside Dad's
// December notes (those live only in personal.json). Original words; a few carry emeralds. The words are strings
// `post:<n>` so the reading check sees them; who sends each and what is inside is `content.post`.
import type { PostNoteDef } from '../core/types.ts';

const NOTES: (PostNoteDef & { text: string })[] = [
  { from: 'peppa', text: 'I jumped in the biggest muddy puddle! Come and jump with me.' },
  { from: 'bluey', text: 'We built a blanket fort today. You can play in it too!' },
  { from: 'paddington', text: 'I found a shiny emerald by the river. It is for you!', gems: 1 },
  { from: 'bing', text: 'I planted a carrot. It is very small, but it is mine.' },
  { from: 'hello_kitty', text: 'Thank you for being my friend. Here are 3 emeralds!', gems: 3 },
  { from: 'woody', text: 'The island is a happier place with you on it.' },
  { from: 'buzz', text: 'To the stars and back! Here are 2 emeralds for you.', gems: 2 },
  { from: 'gabby', text: 'I made you a paper flower. It smells like cupcakes!' },
  { from: 'kuromi', text: 'Do not tell anyone. I think you are quite nice.' },
  { from: 'pando', text: 'Hide and seek later? I am very good at hiding.' },
];

export const post: PostNoteDef[] = NOTES.map(({ from, gems }) => (gems ? { from, gems } : { from }));
export const postStrings: Record<string, string> = Object.fromEntries(NOTES.map((n, i) => [`post:${i + 1}`, n.text]));
