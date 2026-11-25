// Every hero's own emote (the G key): a clip and a burst of its own, so no two heroes do the same thing.
// The rules only say "emote"; the hero's emote id in src/data/chars.ts picks the look here.
import type { Clip } from '../../core/types.ts';
import type { Fx } from './fx.ts';

const T = 64;

interface Look {
  clip: Clip;
  secs: number;
  key: string;
  colors: number[];
  n: number;
  speed: number;
  /** extra lift at the start */
  up: number;
  /** pull down (falls like confetti or water) */
  g?: number;
  scale: number;
  /** height above her feet in pixels */
  dy: number;
  grow?: number;
}

export const EMOTE_LOOKS: Record<string, Look> = {
  // a spin with hearts
  twirl: {
    clip: 'cheer',
    secs: 1.6,
    key: 'fx_heart',
    colors: [0xff8fa6, 0xff5a7a],
    n: 8,
    speed: 170,
    up: 40,
    scale: 0.6,
    dy: 90,
  },
  // a sleepy roll, little leaves
  roll: {
    clip: 'hop',
    secs: 1.4,
    key: 'fx_dot',
    colors: [0x7bbf5a, 0x5da048],
    n: 7,
    speed: 90,
    up: 30,
    g: 200,
    scale: 0.6,
    dy: 40,
  },
  // a dance, music-coloured squares
  dance: {
    clip: 'cheer',
    secs: 1.8,
    key: 'fx_sq',
    colors: [0x5ac8ff, 0xffd24a, 0xff8f3a],
    n: 10,
    speed: 200,
    up: 120,
    g: 500,
    scale: 0.55,
    dy: 80,
  },
  // a big hop with a ring
  hop: {
    clip: 'hop',
    secs: 1.2,
    key: 'fx_ring',
    colors: [0xfff3b0],
    n: 2,
    speed: 10,
    up: 0,
    scale: 0.5,
    dy: 10,
    grow: 2.2,
  },
  // a calm bow, soft puffs
  bow: {
    clip: 'wave',
    secs: 1.4,
    key: 'fx_soft',
    colors: [0xf2f2f2, 0xd8f0ff],
    n: 5,
    speed: 50,
    up: 30,
    scale: 0.6,
    dy: 20,
    grow: 0.8,
  },
  // a muddy splash
  splash: {
    clip: 'hop',
    secs: 1.2,
    key: 'fx_dot',
    colors: [0x8a5a2e, 0x6b4423, 0xa9744a],
    n: 12,
    speed: 230,
    up: 220,
    g: 900,
    scale: 0.7,
    dy: 10,
  },
  // a cowboy hat tip, gold stars
  tip_hat: {
    clip: 'wave',
    secs: 1.2,
    key: 'fx_star',
    colors: [0xffd24a, 0xffe680],
    n: 5,
    speed: 110,
    up: 50,
    scale: 0.55,
    dy: 130,
  },
  // a space salute, green and purple sparks
  salute: {
    clip: 'wave',
    secs: 1.4,
    key: 'fx_star',
    colors: [0x7be37b, 0xc78bff, 0xffffff],
    n: 9,
    speed: 260,
    up: 0,
    scale: 0.5,
    dy: 110,
  },
  // a yodel, notes floating up
  yodel: {
    clip: 'cheer',
    secs: 1.8,
    key: 'fx_dot',
    colors: [0xff5a5a, 0xffd24a],
    n: 6,
    speed: 60,
    up: 160,
    scale: 0.6,
    dy: 120,
  },
  // a friendly wave, pink bows
  wave: {
    clip: 'wave',
    secs: 1.4,
    key: 'fx_heart',
    colors: [0xff5a9a, 0xffffff],
    n: 5,
    speed: 90,
    up: 70,
    scale: 0.55,
    dy: 110,
  },
  // a cheeky cackle, dark purple puffs
  cackle: {
    clip: 'cheer',
    secs: 1.5,
    key: 'fx_soft',
    colors: [0x6a3a8a, 0x3b2a4a, 0xff8fd0],
    n: 7,
    speed: 120,
    up: 60,
    scale: 0.6,
    dy: 100,
    grow: 0.6,
  },
  // a sparkly twirl, rainbow stars
  sparkle: {
    clip: 'cheer',
    secs: 1.6,
    key: 'fx_star',
    colors: [0xff5a5a, 0xffd24a, 0x7be37b, 0x5ac8ff, 0xc78bff],
    n: 12,
    speed: 220,
    up: 40,
    scale: 0.5,
    dy: 100,
  },
  // a marmalade sandwich from under the hat: orange squares
  marmalade: {
    clip: 'wave',
    secs: 1.6,
    key: 'fx_sq',
    colors: [0xff9a2a, 0xffc04a],
    n: 6,
    speed: 120,
    up: 140,
    g: 600,
    scale: 0.6,
    dy: 150,
  },
  // a giggle, banana-yellow dots bouncing
  giggle: {
    clip: 'hop',
    secs: 1.4,
    key: 'fx_dot',
    colors: [0xffe14a, 0xfff3b0],
    n: 9,
    speed: 150,
    up: 180,
    g: 700,
    scale: 0.6,
    dy: 90,
  },
};

const DEFAULT: Look = EMOTE_LOOKS.twirl!;

/** Play the burst for this emote at a tile and return the clip and seconds the hero should do. */
export function playEmote(fx: Fx, emote: string | undefined, tx: number, ty: number): { clip: Clip; secs: number } {
  const e = (emote && EMOTE_LOOKS[emote]) || DEFAULT;
  fx.burst(e.key, tx * T, ty * T - e.dy, e.n, e.colors, e.speed, 0.9, {
    up: e.up,
    g: e.g,
    scale: e.scale,
    grow: e.grow,
  });
  return { clip: e.clip, secs: e.secs };
}
