// Stickers, letters and cutscenes.
import type { CutsceneDef, LetterDef } from '../core/types.ts';

// the journal's sticker list lives in its own file
export { stickers } from './stickers.ts';

const personal = (id: string, gift?: Record<string, number>): LetterDef => ({ id, from: 'personal', gift });
export const letters: Record<string, LetterDef> = {
  dad_1: personal('dad_1'),
  mum_1: personal('mum_1', { rug: 1 }),
  granny_1: personal('granny_1', { carrot_seed: 4, wheat_seed: 4 }),
  nanny_1: personal('nanny_1', { wool: 3 }),
  grandad_1: personal('grandad_1', { lantern: 1 }),
  aunty_1: personal('aunty_1', { emerald: 5 }),
  friends_1: personal('friends_1'),
  teacher_1: personal('teacher_1', { trophy_star: 1 }),
  dad_2: personal('dad_2'),
  dad_finale: personal('dad_finale'),
  dad_stickers: personal('dad_stickers', { star_lamp: 1 }),
  gabby_1: {
    id: 'gabby_1',
    from: 'gabby',
    gift: { cat_bed: 1, flower_pot: 2 },
    text: ['Surprise! A Dollhouse Delivery, just for you.', 'Every home needs a cosy corner. Love, Gabby.'],
  },
  gabby_2: {
    id: 'gabby_2',
    from: 'gabby',
    gift: { rainbow_rug: 1, painting_star: 1 },
    text: ['Another box! This one is full of colour.', 'Send me a picture of your room. Love, Gabby.'],
  },
  gabby_3: {
    id: 'gabby_3',
    from: 'gabby',
    gift: { cupcake_table: 1, chair: 2 },
    text: ['It is party time! Here is a table for cake.', 'You are a pawsome decorator. Love, Gabby.'],
  },
  lucy_1: {
    id: 'lucy_1',
    from: 'paddington',
    gift: { marmalade: 2 },
    text: [
      'Dear friend of Paddington,',
      'Thank you for looking after my bear. Please keep him out of trouble.',
      'With love from Aunt Lucy.',
    ],
  },
  bandit_1: {
    id: 'bandit_1',
    from: 'bandit',
    gift: { emerald: 6 },
    text: ['Kid! Best Keepy Uppy I ever saw.', 'I pulled a muscle. Worth it. Bandit.'],
  },
  kuromi_1: {
    id: 'kuromi_1',
    from: 'kuromi',
    gift: { bat_bunting: 2 },
    text: ['Hee hee! A spooky gift from me.', 'Hang these up. Do not tell Hello Kitty. Kuromi.'],
  },
};

export const cutscenes: Record<string, CutsceneDef> = {
  // Phase 2, part A: at most 3 boxes, 25 words and 5 characters, about 20 seconds (tools/check/calm.ts).
  intro: {
    id: 'intro',
    backdrop: 'bd_party',
    acts: [
      { a: 'music', id: 'festive' },
      { a: 'spawn', who: 'you', x: 10, y: 7.0, dir: 'up' },
      { a: 'spawn', who: 'mum', x: 7.6, y: 6.8, dir: 'right', clip: 'wave' },
      { a: 'spawn', who: 'dad', x: 12.4, y: 6.8, dir: 'left', clip: 'wave' },
      { a: 'spawn', who: 'grandad', x: 5.2, y: 7.1, dir: 'right' },
      { a: 'clip', who: 'you', clip: 'cheer' },
      { a: 'say', l: 'say: Party night! The Wishing Star shines on the Great Tree.' },
      { a: 'bg', id: 'bd_creep' },
      { a: 'hide', who: 'mum' },
      { a: 'hide', who: 'dad' },
      { a: 'hide', who: 'grandad' },
      { a: 'spawn', who: 'you', x: -5, y: 7.0, dir: 'down' },
      { a: 'spawn', who: 'creeper', x: 18.5, y: 7.1, dir: 'left' },
      { a: 'music', id: 'sneak' },
      { a: 'move', who: 'creeper', x: 10.6, y: 7.0, speed: 2.4 },
      { a: 'clip', who: 'creeper', clip: 'attack' },
      { a: 'sfx', id: 'hiss' },
      { a: 'wait', s: 1.2 },
      { a: 'bg', id: 'bd_boom' },
      { a: 'hide', who: 'creeper' },
      { a: 'fx', id: 'boom', x: 10, y: 4.5, s: 7 },
      { a: 'sfx', id: 'boom' },
      { a: 'music', id: '' },
      { a: 'fx', id: 'shards', x: 10, y: 4.5, s: 7 },
      // the boom is seen, not read (package 46): the star cracks and 7 sparks fly off, with no words
      { a: 'wait', s: 2.4 },
      { a: 'light', id: 'dark', s: 1 },
      { a: 'wait', s: 1.2 },
      { a: 'bg' },
      { a: 'light', id: 'dark', s: 0 },
      { a: 'spawn', who: 'you', at: 'start', dir: 'down' },
      { a: 'music', id: 'home' },
      { a: 'say', l: 'you: I will find every one!' },
    ],
  },
};
