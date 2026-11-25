// Package 64 (D70): each show character moves the way its own series moves it, and keeps the marks its series gives it.
// Timing only (no new drawings): which of the drawn frames a clip shows and for how long. A frame given 0 seconds is
// skipped, so an 8-frame walk can play as the stiffer 6 or 4 poses a series uses. See docs/research/show-characters.md.
//
//   node tools/art/manner.ts            rewrite the timing in every art/src/chars/<id>/meta.json (no re-slicing)
//   node tools/art/manner.ts --list     print each character's series and walk, idle and talk timing
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Img } from './imgutil.ts';

export interface ClipTiming {
  durs: number[];
  dursByFacing?: Partial<Record<'down' | 'side' | 'up', number[]>>;
  step?: number[];
  stepByFacing?: Partial<Record<'down' | 'side' | 'up', number[]>>;
}
type Clips = Record<string, Partial<Record<'down' | 'side' | 'up', string[]>>>;

export type Series =
  | 'heeler'
  | 'heelerAdult'
  | 'bunny'
  | 'bunnyCarer'
  | 'pig'
  | 'toyStiff'
  | 'toyLoose'
  | 'toyGrace'
  | 'toyWaddle'
  | 'kawaii'
  | 'kawaiiNoMouth'
  | 'helper'
  | 'dollhouse'
  | 'bear'
  | 'blocky'
  | 'blockyMob'
  | 'plain';

/** Which series each show character comes from (research file section 0). The rest keep the plain timing. */
export const SERIES: Record<string, Series> = {
  bluey: 'heeler',
  bingo: 'heeler',
  muffin: 'heeler',
  socks: 'heeler',
  bandit: 'heelerAdult',
  chilli: 'heelerAdult',
  bing: 'bunny',
  sula: 'bunny',
  pando: 'bunny',
  coco: 'bunny',
  flop: 'bunnyCarer',
  amma: 'bunnyCarer',
  padget: 'bunnyCarer',
  peppa: 'pig',
  george: 'pig',
  mummy_pig: 'pig',
  daddy_pig: 'pig',
  suzy_sheep: 'pig',
  grandpa_pig: 'pig',
  granny_pig: 'pig',
  buzz: 'toyStiff',
  hamm: 'toyStiff',
  potato: 'toyStiff',
  alien: 'toyStiff',
  bo_peep: 'toyGrace',
  woody: 'toyLoose',
  jessie: 'toyLoose',
  slinky: 'toyLoose',
  bullseye: 'toyLoose',
  forky: 'toyLoose',
  rex: 'toyWaddle',
  hello_kitty: 'kawaiiNoMouth',
  mimmy: 'kawaiiNoMouth',
  kuromi: 'kawaii',
  baku: 'kawaii',
  my_melody: 'kawaii',
  bob: 'helper',
  kevin: 'helper',
  stuart: 'helper',
  minion_d: 'helper',
  minion_e: 'helper',
  gabby: 'dollhouse',
  pandy: 'dollhouse',
  cakey: 'dollhouse',
  mercat: 'dollhouse',
  dj_catnip: 'dollhouse',
  kitty_fairy: 'dollhouse',
  baby_box: 'dollhouse',
  catrat: 'dollhouse',
  pillow_cat: 'dollhouse',
  paddington: 'bear',
  villager_a: 'blocky',
  villager_b: 'blocky',
  wandering_trader: 'blocky',
  golem: 'blocky',
  chicken: 'blocky',
  pig: 'blocky',
  cow: 'blocky',
  sheep: 'blocky',
  wolf: 'blocky',
  cat: 'blocky',
  llama: 'blocky',
  zombie: 'blockyMob',
  skeleton: 'blockyMob',
  creeper: 'blockyMob',
  spider: 'blockyMob',
  enderman: 'blockyMob',
};

/**
 * One series' manner. walk8: weights for the 8 drawn walk frames (contact, weight, passing, lift, then the other leg;
 * 0 skips a frame) and the seconds of one stride. walk4: the same for the older 4-frame walks (lifted, together,
 * lifted, together). idle: seconds of rest, of breath, of the half blink and of the closed blink (the game's idle).
 * talk: seconds per talk frame (closed, half open, wide open, round "o"; 0 skips one).
 */
interface Manner {
  walk8?: [number[], number];
  walk4?: [number[], number];
  idle?: [number, number, number, number];
  talk?: number[];
}

const MANNER: Record<Series, Manner> = {
  // bouncy, loose, upright children's walk: hold the low weight frame and the high lift frame, rush the passing
  heeler: {
    walk8: [[1, 1.3, 0.6, 1.3, 1, 1.3, 0.6, 1.3], 0.5],
    idle: [0.7, 0.6, 0.04, 0.07],
    talk: [0.1, 0.12, 0.14, 0.12],
  },
  // the grown-ups lope: a longer, easier stride with the same bounce, a little calmer
  heelerAdult: { walk8: [[1.2, 1.2, 0.8, 1.2, 1.2, 1.2, 0.8, 1.2], 0.64], idle: [1, 0.9, 0.05, 0.08] },
  // a soft toddler waddle (6 poses, no lift), slow and short; big slow blinks; small, gentle mouth shapes
  bunny: {
    walk8: [[1.3, 1.4, 1, 0, 1.3, 1.4, 1, 0], 0.72],
    idle: [1.6, 1.5, 0.09, 0.18],
    talk: [0.18, 0.14, 0.16, 0.14],
  },
  // the carers potter: still, watchful, slow blinks
  bunnyCarer: {
    walk8: [[1.3, 1.3, 1, 0, 1.3, 1.3, 1, 0], 0.76],
    idle: [2.2, 1.4, 0.09, 0.18],
    talk: [0.2, 0.16, 0.18, 0.16],
  },
  // the flat stage walk: stiff stick legs, 6 even poses with a small bob (weight low, passing high), no lift
  pig: { walk8: [[1, 1, 1, 0, 1, 1, 1, 0], 0.6], idle: [1, 1, 0.05, 0.1], talk: [0.12, 0.12, 0.14, 0] },
  // hard plastic toys: 4 rigid poses held evenly, and they freeze still between moves
  toyStiff: { walk8: [[1, 0, 1, 0, 1, 0, 1, 0], 0.64], walk4: [[1, 1, 1, 1], 0.6], idle: [2.6, 0.5, 0.04, 0.06] },
  // soft, floppy toys: the full swing of the limbs, a touch quicker
  toyLoose: { walk8: [[1.2, 1, 0.9, 1, 1.2, 1, 0.9, 1], 0.52], idle: [1.8, 0.8, 0.04, 0.07] },
  // the porcelain shepherdess: an upright, even, graceful step, all 8 poses
  toyGrace: { walk8: [[1, 1, 1, 1, 1, 1, 1, 1], 0.62], idle: [2, 1, 0.05, 0.08] },
  // the big plastic dinosaur waddles: a heavy hold on each footfall
  toyWaddle: { walk8: [[1.6, 1.2, 0.8, 0.7, 1.6, 1.2, 0.8, 0.7], 0.66], idle: [1.4, 1, 0.05, 0.08] },
  // quick, short toddle steps (4 poses); slow head sway when still
  kawaii: { walk8: [[1, 0, 1, 0, 1, 0, 1, 0], 0.44], idle: [1.5, 1.5, 0.06, 0.1] },
  // no mouth at all: the talk frames have their mouths filled in (noMouth), so talk is the head tilts and the hand
  kawaiiNoMouth: {
    walk8: [[1, 0, 1, 0, 1, 0, 1, 0], 0.44],
    idle: [1.5, 1.5, 0.06, 0.1],
    talk: [0.26, 0.26, 0.26, 0.26],
  },
  // the yellow helpers: a quick shuffling waddle, a wobbly idle, fast gibberish
  helper: { walk8: [[1, 1, 1, 0, 1, 1, 1, 0], 0.38], walk4: [[1, 1, 1, 1], 0.36], idle: [0.5, 0.5, 0.04, 0.08] },
  // springy cats: hold the lift for a hop in every step; bob to a beat when still
  dollhouse: {
    walk8: [[0.9, 1, 0.8, 1.5, 0.9, 1, 0.8, 1.5], 0.5],
    idle: [0.45, 0.45, 0.05, 0.08],
    talk: [0.1, 0.12, 0.14, 0.12],
  },
  // polite small steps with a hold on each contact
  bear: { walk8: [[1.4, 1.1, 0.9, 0.8, 1.4, 1.1, 0.9, 0.8], 0.62], idle: [1.6, 1.2, 0.05, 0.09] },
  // rigid box limbs swinging: 4 even poses, a calm walk
  blocky: { walk8: [[1, 0, 1, 0, 1, 0, 1, 0], 0.6], idle: [1.4, 1.4, 0.05, 0.08] },
  blockyMob: { walk8: [[1, 0, 1, 0, 1, 0, 1, 0], 0.66] },
  plain: {},
};

const spread = (weights: number[], total: number) => {
  const sum = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => Math.round((w / sum) * total * 1000) / 1000);
};
const count = (clips: Clips, clip: string) =>
  Math.max(0, ...Object.values(clips[clip] ?? {}).map((f) => f?.length ?? 0));
const even = (clips: Clips, clip: string) => {
  const ns = Object.values(clips[clip] ?? {}).map((f) => f?.length ?? 0);
  return ns.length > 0 && ns.every((n) => n === ns[0]);
};

/**
 * The series' timing on top of the plain one (`base`). Only clips whose every facing has the drawn frame count the
 * manner was written for are changed, so a character drawn some other way keeps its plain timing.
 */
export function mannerTiming(id: string, clips: Clips, base: Record<string, ClipTiming>): Record<string, ClipTiming> {
  const m = MANNER[SERIES[id] ?? 'plain'];
  const t = { ...base };
  const walk = count(clips, 'walk');
  if (m.walk8 && walk === 8 && even(clips, 'walk')) t.walk = { ...t.walk, durs: spread(...m.walk8), step: [0, 4] };
  if (m.walk4 && walk === 4 && even(clips, 'walk')) t.walk = { ...t.walk, durs: spread(...m.walk4), step: [1, 3] };
  if (m.idle && count(clips, 'idle') === 4 && even(clips, 'idle')) t.idle = { ...t.idle, durs: [...m.idle] };
  if (m.talk && count(clips, 'talk') === 4 && even(clips, 'talk')) t.talk = { ...t.talk, durs: [...m.talk] };
  // the yellow-bow twin's two middle talk frames keep a mouth the fill cannot reach: they are skipped
  if (id === 'mimmy' && t.talk) t.talk = { ...t.talk, durs: [0.3, 0, 0, 0.3] };
  return t;
}

// ---------------------------------------------------------------- marks the series gives a character

/**
 * The blue heeler pup's back: two dark patches over the shoulders and a round dark spot low on the right of her back.
 * The finer back views drew the patches but lost the spot, so it is painted back on every back-facing frame: placed
 * from the two patches, and only over her light blue fur, so it never covers an arm, the tail or the outline.
 */
export function heelerBackSpot(img: Img): boolean {
  const { w, h, d } = img;
  const at = (x: number, y: number) => (y * w + x) * 4;
  let top = h;
  let bot = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (d[at(x, y) + 3]! >= 128) {
        if (top === h) top = y;
        bot = y;
      }
  if (bot < 0) return false;
  const fig = bot - top;
  const isNavy = (i: number) => d[i + 3]! >= 128 && d[i]! < 110 && d[i + 2]! < 135 && d[i + 2]! > 55;
  const isFur = (i: number) =>
    d[i + 3]! >= 200 && Math.abs(d[i]! - 125) < 28 && Math.abs(d[i + 1]! - 170) < 28 && Math.abs(d[i + 2]! - 225) < 28;
  // the two shoulder patches: the biggest dark areas between a fifth and three fifths of the way down
  const seen = new Uint8Array(w * h);
  const blobs: { n: number; x0: number; x1: number; y1: number }[] = [];
  for (let y = top + Math.round(fig * 0.12); y < top + fig * 0.62; y++)
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (seen[p] || !isNavy(p * 4)) continue;
      const b = { n: 0, x0: x, x1: x, y1: y };
      const stack = [p];
      seen[p] = 1;
      while (stack.length) {
        const q = stack.pop()!;
        const qx = q % w;
        const qy = (q - qx) / w;
        b.n++;
        b.x0 = Math.min(b.x0, qx);
        b.x1 = Math.max(b.x1, qx);
        b.y1 = Math.max(b.y1, qy);
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const nx = qx + dx;
          const ny = qy + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h || ny < top + fig * 0.12) continue;
          const r = ny * w + nx;
          if (!seen[r] && isNavy(r * 4)) {
            seen[r] = 1;
            stack.push(r);
          }
        }
      }
      blobs.push(b);
    }
  blobs.sort((a, b) => b.n - a.n);
  const pair = blobs
    .filter((b) => b.n > fig * 2.5)
    .slice(0, 2)
    .sort((a, b) => a.x0 - b.x0);
  if (pair.length < 2) return false;
  const [l, r] = pair as [(typeof blobs)[0], (typeof blobs)[0]];
  const span = r.x1 - l.x0;
  const cx = (l.x1 + r.x0) / 2 + span * 0.15;
  const cy = Math.max(l.y1, r.y1) + fig * 0.12;
  const rad = fig * 0.064;
  // a back view drawn with its spot already there keeps it as drawn
  const below = Math.max(l.y1, r.y1);
  if (blobs.some((b) => b !== l && b !== r && b.n > rad * rad * 1.2 && b.y1 > below + fig * 0.04)) return false;
  // the line colour of her patches, from the patch itself
  const navy = [64, 61, 90];
  let painted = 0;
  for (let y = Math.floor(cy - rad - 1); y <= Math.ceil(cy + rad + 1); y++)
    for (let x = Math.floor(cx - rad - 1); x <= Math.ceil(cx + rad + 1); x++) {
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const i = at(x, y);
      if (!isFur(i)) continue;
      // soft edge: coverage from the distance to the circle's rim
      const cover = Math.max(0, Math.min(1, rad + 0.5 - Math.hypot(x + 0.5 - cx, y + 0.5 - cy)));
      if (cover <= 0) continue;
      for (let k = 0; k < 3; k++) d[i + k] = Math.round(d[i + k]! * (1 - cover) + navy[k]! * cover);
      painted++;
    }
  return painted > rad * rad;
}

/**
 * The toy space ranger wears a close purple hood over his whole head (the finer redraw was refused by the image tool):
 * the brown hair his front and side views were drawn with is recoloured to the purple of his own back view.
 */
export function rangerHood(img: Img): number {
  const { w, h, d } = img;
  let top = h;
  let bot = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (d[(y * w + x) * 4 + 3]! >= 128) {
        if (top === h) top = y;
        bot = y;
      }
  const purple = [112, 64, 140];
  let n = 0;
  const y1 = top + (bot - top) * 0.36;
  for (let y = top; y < y1; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = d[i]!;
      const g = d[i + 1]!;
      const b = d[i + 2]!;
      if (d[i + 3]! < 40 || !(r > g + 18 && g > b + 4 && r < 190 && r > 45)) continue;
      // keep the drawing's light and shade: scale the purple by the hair's brightness against its middle tone
      const k = Math.min(1.5, (r + g + b) / 3 / 60);
      for (let c = 0; c < 3; c++) d[i + c] = Math.min(255, Math.round(purple[c]! * k));
      n++;
    }
  return n;
}

/**
 * The white kitten twins have no mouth at all. Their talk and cheer frames were drawn with one, so any shape lying
 * wholly inside the white face below the yellow nose (the mouth, outline and all) is filled with the face's white.
 */
export function noMouth(img: Img): number {
  const { w, h, d } = img;
  const at = (p: number) => p * 4;
  const isWhite = (p: number) => d[at(p) + 3]! >= 200 && d[at(p)]! > 225 && d[at(p) + 1]! > 225 && d[at(p) + 2]! > 225;
  const isYellow = (p: number) => d[at(p)]! > 200 && d[at(p) + 1]! > 150 && d[at(p) + 2]! < 110;
  let top = h;
  let bot = -1;
  for (let p = 0; p < w * h; p++)
    if (d[at(p) + 3]! >= 128) {
      const y = Math.floor(p / w);
      if (top === h) top = y;
      bot = y;
    }
  const yEnd = Math.min(h, Math.round(top + (bot - top) * 0.6));
  const seen = new Uint8Array(w * h);
  const shapes: { px: number[]; y0: number; y1: number; yellow: number }[] = [];
  for (let p = top * w; p < yEnd * w; p++) {
    if (seen[p] || d[at(p) + 3]! < 128 || isWhite(p)) continue;
    const px: number[] = [];
    const stack = [p];
    seen[p] = 1;
    let shut = true;
    while (stack.length) {
      const q = stack.pop()!;
      px.push(q);
      const x = q % w;
      for (const r of [q - 1, q + 1, q - w, q + w]) {
        const rx = r % w;
        if (r < 0 || r >= w * h || Math.abs(rx - x) > 1 || r >= yEnd * w) {
          shut = false;
          continue;
        }
        if (seen[r]) continue;
        if (isWhite(r)) continue;
        if (d[at(r) + 3]! < 128) {
          shut = false;
          continue;
        }
        seen[r] = 1;
        stack.push(r);
      }
    }
    if (!shut || px.length > w * h * 0.02) continue;
    const ys = px.map((q) => Math.floor(q / w));
    shapes.push({ px, y0: Math.min(...ys), y1: Math.max(...ys), yellow: px.filter(isYellow).length / px.length });
  }
  const nose = shapes.filter((s) => s.yellow > 0.08).sort((a, b) => b.yellow * b.px.length - a.yellow * a.px.length)[0];
  if (!nose) return 0;
  let n = 0;
  // a mouth drawn touching the nose is part of the nose's shape: keep the nose and its outline only
  const yb = Math.max(...nose.px.filter(isYellow).map((q) => Math.floor(q / w)));
  for (const q of nose.px)
    if (Math.floor(q / w) > yb + 2) {
      d[at(q)] = 255;
      d[at(q) + 1] = 255;
      d[at(q) + 2] = 255;
      n++;
    }
  for (const s of shapes) {
    if (s === nose || s.y0 <= nose.y1 - 1 - (nose.y1 - yb)) continue;
    for (const q of s.px) {
      d[at(q)] = 255;
      d[at(q) + 1] = 255;
      d[at(q) + 2] = 255;
      n++;
    }
  }
  return n;
}

/** Marks painted onto a finished frame (full size, before it is saved), per character. */
export function markFrame(id: string, clip: string, facing: string, img: Img): void {
  if (id === 'bluey' && facing === 'up' && clip !== 'sleep' && clip !== 'sit') heelerBackSpot(img);
  if (id === 'buzz' && facing !== 'up') rangerHood(img);
  if ((id === 'hello_kitty' || id === 'mimmy') && facing === 'down' && clip === 'talk') noMouth(img);
}

// ---------------------------------------------------------------- CLI: retime the frames already sliced

if (import.meta.main) {
  const SRC = join(import.meta.dirname, '../../art/src/chars');
  const list = process.argv.includes('--list');
  for (const id of readdirSync(SRC).sort()) {
    const file = join(SRC, id, 'meta.json');
    if (!existsSync(file)) continue;
    const meta = JSON.parse(readFileSync(file, 'utf8'));
    const series = SERIES[id];
    if (!series) continue;
    const before = JSON.stringify(meta.timing ?? {});
    // idle and talk timings come only from a manner; the walk and the rest are the plain timing or a manner's
    const plain = { ...(meta.timing ?? {}) };
    delete plain.idle;
    delete plain.talk;
    meta.timing = mannerTiming(id, meta.clips, plain);
    if (!Object.keys(meta.timing).length) delete meta.timing;
    if (list) {
      const t = meta.timing ?? {};
      const f = (c: string) => (t[c] ? t[c].durs.join('/') : '-');
      console.log(`${id.padEnd(16)} ${series.padEnd(14)} walk ${f('walk')}  idle ${f('idle')}  talk ${f('talk')}`);
    }
    if (JSON.stringify(meta.timing ?? {}) !== before) writeFileSync(file, JSON.stringify(meta, null, 2) + '\n');
  }
}
