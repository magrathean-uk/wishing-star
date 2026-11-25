// Original looping tunes, written as notes (D86). Nothing here is from any show, film, game or song.
//
// A tune is written as a melody and a chord for each bar, in parts (A, B) and a form that strings the parts together
// with small changes. The bass, the chords, the soft counter line and the bell that doubles the tune are made from
// the chords below, so every tune has three or four voices and lasts 45 to 90 seconds before it repeats.
//
// A bar is a string of equal steps: a note name ("C4", "F#5", "Bb4"), notes sounded together ("C4+E4"), "-" to hold
// the note before it, "." for a rest. A note may end in "^" (a little louder) or "_" (softer).
// This file is plain data and maths: the game plays it through Web Audio (musicplayer.ts) and a Node script renders the
// same notes to WAV files (tools/music/render.ts).

export type Wave = 'sine' | 'triangle' | 'square' | 'sawtooth';
/** soft: gentle swell and fade; organ: steady; pad: slow in and out; pluck: quick fall; bell: pluck with a ring. */
export type Env = 'soft' | 'organ' | 'pad' | 'pluck' | 'bell';

export interface Voice {
  name: string;
  wave: Wave;
  vol: number;
  env: Env;
  /** how much of its written length a note sounds (1 = all of it) */
  long: number;
  bars: string[];
}
export interface Tune {
  bpm: number;
  /** beats in a bar */
  beats: number;
  /** low-pass on this tune's own bus, in Hz: lower is softer and darker */
  cutoff: number;
  /** a mini-game, fight sting or cutscene tune: allowed to loop sooner than 45 seconds */
  short?: boolean;
  voices: Voice[];
}

// ---------------------------------------------------------------- notes

const PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

/** "C4" is 60. Returns NaN for anything that is not a note name. */
export function midi(name: string): number {
  const m = /^([A-G])([#b]?)(\d)$/.exec(name);
  if (!m) return Number.NaN;
  return PC[m[1]!]! + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (Number(m[3]) + 1) * 12;
}
export const noteName = (n: number): string => NAMES[((n % 12) + 12) % 12]! + (Math.floor(n / 12) - 1);
export const hz = (n: number): number => 440 * 2 ** ((n - 69) / 12);
export const barSeconds = (t: Tune): number => (60 / t.bpm) * t.beats;
export const loopBars = (t: Tune): number => Math.max(...t.voices.map((v) => v.bars.length));
export const loopSeconds = (t: Tune): number => loopBars(t) * barSeconds(t);

export interface NoteEvent {
  /** seconds from the start of the bar */
  at: number;
  /** seconds it sounds */
  len: number;
  midi: number;
  /** loudness for this note, 1 = the voice's own */
  amp: number;
}

const parsed = new Map<string, { steps: number; notes: { i: number; hold: number; midi: number[]; amp: number }[] }>();
/** One bar string read into notes on its step grid (cached: the same bars come round again and again). */
export function readBar(text: string): {
  steps: number;
  notes: { i: number; hold: number; midi: number[]; amp: number }[];
} {
  let p = parsed.get(text);
  if (p) return p;
  const steps = text.trim().split(/\s+/);
  const notes: { i: number; hold: number; midi: number[]; amp: number }[] = [];
  for (let i = 0; i < steps.length; i++) {
    let s = steps[i]!;
    if (s === '.' || s === '-') continue;
    let amp = 1;
    if (s.endsWith('^')) {
      amp = 1.25;
      s = s.slice(0, -1);
    } else if (s.endsWith('_')) {
      amp = 0.62;
      s = s.slice(0, -1);
    }
    let hold = 1;
    while (steps[i + hold] === '-') hold++;
    notes.push({ i, hold, midi: s.split('+').map(midi), amp });
  }
  p = { steps: steps.length, notes };
  parsed.set(text, p);
  return p;
}

/** The notes one voice plays in one bar of the loop. */
export function barNotes(t: Tune, v: Voice, bar: number): NoteEvent[] {
  const b = readBar(v.bars[bar % v.bars.length]!);
  const step = barSeconds(t) / b.steps;
  const out: NoteEvent[] = [];
  for (const n of b.notes)
    for (const m of n.midi) out.push({ at: n.i * step, len: n.hold * step * v.long, midi: m, amp: n.amp });
  return out;
}

/** A gain curve: [time, value, how to get there]. Web Audio plays it with ramps; the WAV renderer walks the same points. */
export type Curve = [number, number, 'set' | 'lin' | 'exp'][];
export interface Shape {
  curve: Curve;
  /** when the oscillator stops */
  end: number;
  /** a bell's quick upper ring: frequency times mul, its own curve */
  ring?: { mul: number; curve: Curve };
}
const tiny = (v: number): number => Math.max(0.0001, v);
/** The envelope of one note that starts at `at`, is written `len` seconds long and peaks at `a`. */
export function shape(env: Env, at: number, len: number, a: number, f: number): Shape {
  len = Math.max(0.06, len);
  switch (env) {
    case 'organ':
      return {
        curve: [
          [at, 0, 'set'],
          [at + 0.012, a, 'lin'],
          [at + len - 0.04, a, 'set'],
          [at + len, 0, 'lin'],
        ],
        end: at + len + 0.02,
      };
    case 'pad': {
      const up = Math.min(0.28, len * 0.3);
      const down = Math.min(0.35, len * 0.3);
      return {
        curve: [
          [at, 0, 'set'],
          [at + up, a, 'lin'],
          [at + len - down, a * 0.85, 'lin'],
          [at + len, 0, 'lin'],
        ],
        end: at + len + 0.02,
      };
    }
    case 'pluck': {
      const fall = Math.min(0.9, Math.max(0.3, len));
      return {
        curve: [
          [at, 0, 'set'],
          [at + 0.005, a, 'lin'],
          [at + fall, tiny(a * 0.04), 'exp'],
          [at + fall + 0.04, 0, 'lin'],
        ],
        end: at + fall + 0.06,
      };
    }
    case 'bell': {
      const fall = Math.min(1.6, Math.max(0.6, len * 1.4));
      const mul = f * 4 < 4200 ? 4 : 2;
      return {
        curve: [
          [at, 0, 'set'],
          [at + 0.004, a, 'lin'],
          [at + fall, tiny(a * 0.03), 'exp'],
          [at + fall + 0.04, 0, 'lin'],
        ],
        end: at + fall + 0.06,
        ring: {
          mul,
          curve: [
            [at, 0, 'set'],
            [at + 0.003, a * 0.22, 'lin'],
            [at + 0.18, tiny(a * 0.005), 'exp'],
            [at + 0.2, 0, 'lin'],
          ],
        },
      };
    }
    default: {
      const t1 = at + Math.max(0.03, len * 0.7);
      return {
        curve: [
          [at, 0, 'set'],
          [at + 0.018, a, 'lin'],
          [t1, tiny(a * 0.4), 'exp'],
          [Math.max(t1 + 0.01, at + len), 0, 'lin'],
        ],
        end: Math.max(t1 + 0.01, at + len) + 0.02,
      };
    }
  }
}

// ---------------------------------------------------------------- writing tunes: melody and chords

interface Inst {
  wave?: Wave;
  vol: number;
  env?: Env;
  long?: number;
}
type BassStyle = 'hold' | 'two' | 'walk';
type HarmStyle = 'hold' | 'off' | 'arp' | 'arp2';
interface Part {
  /** one chord a bar ("C", "Am", "F#m", "G7", "Bb"); "C|G" splits a bar in two */
  ch: string;
  mel: string[];
  /** a counter melody of its own; without one, the counter is a soft line on the chords' thirds */
  cm?: string[];
}
interface Spec {
  bpm: number;
  beats: number;
  /** steps a beat for the made voices: 2 (straight eighths) or 3 (lilting triplets, 6/8) */
  sub?: number;
  cutoff?: number;
  short?: boolean;
  lead: Inst;
  bass: Inst & { style: BassStyle };
  harm?: Inst & { style: HarmStyle };
  counter?: Inst;
  bell?: Inst;
  /** a breath of wind: the chord's fifth held high and quiet */
  air?: Inst;
  /** a little clockwork tick, the same bar every bar */
  tick?: Inst & { bar: string };
  parts: Record<string, Part>;
  /**
   * The order of the parts, each with marks: "+" counter line on, "*" a bell doubles the tune an octave up,
   * "^" or "v" the tune an octave up or down, "=" the bass holds one low note, "-" no chords, "0" no tune,
   * "p" softer; ":4" plays only the first 4 bars.
   */
  form: string[];
}

const QUAL: Record<string, number[]> = {
  '': [0, 4, 7],
  m: [0, 3, 7],
  '7': [0, 4, 7, 10],
  m7: [0, 3, 7, 10],
  maj7: [0, 4, 7, 11],
  '6': [0, 4, 7, 9],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  dim: [0, 3, 6],
};
function chord(sym: string): { root: number; tones: number[] } {
  const m = /^([A-G])([#b]?)(.*)$/.exec(sym);
  const q = m ? QUAL[m[3]!] : undefined;
  if (!m || !q) throw new Error(`music: bad chord ${sym}`);
  const root = (PC[m[1]!]! + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12;
  return { root, tones: q.map((i) => (root + i) % 12) };
}
/** the lowest note of this pitch class at or above lo */
const above = (pc: number, lo: number): number => lo + ((pc - lo + 1200) % 12);

function shift(bar: string, by: number, mark: string): string {
  return bar
    .trim()
    .split(/\s+/)
    .map((s) => {
      if (s === '.' || s === '-') return s;
      const end = s.endsWith('^') || s.endsWith('_') ? s.slice(-1) : '';
      const core = end ? s.slice(0, -1) : s;
      const notes = by ? core.split('+').map((n) => noteName(midi(n) + by)) : [core];
      return notes.join('+') + (end || mark);
    })
    .join(' ');
}

const REST = '.';

function compile(id: string, s: Spec): Tune {
  const sub = s.sub ?? 2;
  const steps = s.beats * sub;
  const lead: string[] = [];
  const counter: string[] = [];
  const bell: string[] = [];
  const bass: string[] = [];
  const harm: string[] = [];
  const air: string[] = [];
  let guide = 64;
  for (const entry of s.form) {
    const m = /^([A-Z])([^:]*)(?::(\d+))?$/.exec(entry);
    const part = m ? s.parts[m[1]!] : undefined;
    if (!m || !part) throw new Error(`music: ${id}: bad form entry ${entry}`);
    const marks = m[2]!;
    const chords = part.ch.trim().split(/\s+/);
    if (chords.length !== part.mel.length)
      throw new Error(`music: ${id}: part ${m[1]} has ${part.mel.length} bars of tune and ${chords.length} chords`);
    if (part.cm && part.cm.length !== chords.length) throw new Error(`music: ${id}: part ${m[1]} counter length`);
    const n = m[3] ? Math.min(Number(m[3]), chords.length) : chords.length;
    const soft = marks.includes('p') ? '_' : '';
    const oct = marks.includes('^') ? 12 : marks.includes('v') ? -12 : 0;
    const pedal = marks.includes('=') ? chord(chords[0]!.split('|')[0]!).root : -1;
    for (let b = 0; b < n; b++) {
      const mel = part.mel[b]!;
      lead.push(marks.includes('0') ? REST : shift(mel, oct, soft));
      bell.push(marks.includes('*') ? shift(mel, oct + 12, '') : REST);
      const spans = chords[b]!.split('|').map(chord);
      if (steps % spans.length) throw new Error(`music: ${id}: ${chords[b]} does not split the bar`);
      const L = steps / spans.length;
      const nb = L / sub;
      const bBar: string[] = Array(steps).fill('.');
      const hBar: string[] = Array(steps).fill('.');
      const cBar: string[] = Array(steps).fill('.');
      const aBar: string[] = Array(steps).fill('.');
      const put = (arr: string[], i: number, len: number, notes: number[], mark = ''): void => {
        arr[i] = notes.map(noteName).join('+') + mark;
        for (let k = 1; k < len; k++) arr[i + k] = '-';
      };
      spans.forEach((c, k) => {
        const at = k * L;
        const root = above(pedal >= 0 ? pedal : c.root, 40);
        const fifth = root + 7;
        // the bass
        if (pedal >= 0 || s.bass.style === 'hold') put(bBar, at, L, [root]);
        else if (s.bass.style === 'two') {
          if (nb % 2 === 0) {
            put(bBar, at, L / 2, [root]);
            put(bBar, at + L / 2, L / 2, [fifth], '_');
          } else put(bBar, at, nb === 3 ? sub : L, [root]);
        } else
          for (let j = 0; j < nb; j++)
            put(bBar, at + j * sub, sub, [[root, fifth, root + 12, fifth][j % 4]!], j ? '_' : '');
        // the chords
        const v = c.tones.slice(0, 4).map((pc) => above(pc, 55));
        v.sort((x, y) => x - y);
        if (s.harm && !marks.includes('-')) {
          const st = s.harm.style;
          if (st === 'hold') put(hBar, at, L, v);
          else if (st === 'off') {
            for (let j = 1; j < nb; j++) if (nb === 3 || j % 2 === 1) put(hBar, at + j * sub, sub, v, j > 1 ? '_' : '');
          } else {
            const ring = [v[0]!, v[1]!, v[2]!, v[0]! + 12];
            const order = [0, 1, 2, 3, 2, 1];
            const every = st === 'arp' ? 1 : sub;
            for (let j = 0; j * every < L; j++) put(hBar, at + j * every, every, [ring[order[j % 6]!]!], j ? '_' : '');
          }
        }
        // the counter line: the third (or the seventh) nearest the last one, held
        if (marks.includes('+') && !part.cm) {
          const pick = [c.tones[1]!, ...(c.tones[3] !== undefined ? [c.tones[3]] : [])]
            .flatMap((pc) => [above(pc, 58), above(pc, 58) + 12])
            .filter((x) => x <= 74)
            .sort((x, y) => Math.abs(x - guide) - Math.abs(y - guide))[0]!;
          guide = pick;
          put(cBar, at, L, [pick]);
        }
        if (s.air) put(aBar, at, L, [above(c.tones[2] ?? c.tones[0]!, 76)]);
      });
      bass.push(bBar.join(' '));
      harm.push(hBar.join(' '));
      counter.push(marks.includes('+') ? (part.cm ? shift(part.cm[b]!, 0, soft) : cBar.join(' ')) : REST);
      air.push(aBar.join(' '));
    }
  }
  const voices: Voice[] = [];
  const add = (name: string, i: Inst | undefined, d: Inst & { wave: Wave; env: Env }, bars: string[]): void => {
    if (!i || bars.every((b) => !/[A-G]/.test(b))) return;
    voices.push({
      name,
      wave: i.wave ?? d.wave,
      vol: i.vol,
      env: i.env ?? d.env,
      long: i.long ?? d.long ?? 0.95,
      bars,
    });
  };
  add('lead', s.lead, { vol: 0, wave: 'triangle', env: 'soft' }, lead);
  add('counter', s.counter ?? { vol: s.lead.vol * 0.45 }, { vol: 0, wave: 'sine', env: 'pad', long: 1 }, counter);
  add('bell', s.bell ?? { vol: s.lead.vol * 0.4 }, { vol: 0, wave: 'sine', env: 'bell' }, bell);
  add('bass', s.bass, { vol: 0, wave: 'sine', env: 'soft', long: 1 }, bass);
  add('harm', s.harm, { vol: 0, wave: 'sine', env: 'pluck' }, harm);
  add('air', s.air, { vol: 0, wave: 'sine', env: 'pad', long: 1 }, air);
  if (s.tick)
    add(
      'tick',
      s.tick,
      { vol: 0, wave: 'sine', env: 'pluck', long: 0.3 },
      lead.map(() => s.tick!.bar),
    );
  return { bpm: s.bpm, beats: s.beats, cutoff: s.cutoff ?? 4200, short: s.short, voices };
}

const specLength = (s: Spec): number => {
  let bars = 0;
  for (const e of s.form) {
    const m = /^([A-Z])[^:]*(?::(\d+))?$/.exec(e)!;
    const len = s.parts[m[1]!]!.mel.length;
    bars += m[2] ? Math.min(Number(m[2]), len) : len;
  }
  return (bars * s.beats * 60) / s.bpm;
};
/** Keep a made-over tune inside 45 to 90 seconds: drop parts from the end, or play the opening again. */
function fitLength(s: Spec): Spec {
  const form = [...s.form];
  while (specLength({ ...s, form }) > 90 && form.length > 1) form.pop();
  let k = 0;
  while (specLength({ ...s, form }) < 45 && k < 8) form.push(s.form[k++ % s.form.length]!.replace(/[+*^]/g, ''));
  return { ...s, form };
}

/**
 * The same tune made quieter and plainer: a softer, slower version for indoors or for the night, or one floor up the
 * lighthouse. It keeps the melody, so a child still hears whose place it is.
 */
function hush(
  s: Spec,
  o: { tempo: number; cutoff: number; vol: number; bass?: BassStyle; harm?: HarmStyle | null; air?: number },
): Spec {
  return fitLength({
    ...s,
    bpm: Math.round(s.bpm * o.tempo),
    cutoff: o.cutoff,
    lead: { wave: 'sine', env: 'soft', vol: s.lead.vol * o.vol * 1.1, long: 0.95 },
    counter: undefined,
    bell: s.bell ? { ...s.bell, vol: s.bell.vol * o.vol } : undefined,
    bass: { wave: 'sine', env: 'soft', vol: s.bass.vol * o.vol, style: o.bass ?? 'hold', long: 1 },
    harm:
      o.harm === null || !s.harm
        ? undefined
        : { wave: 'sine', env: 'pad', vol: s.harm.vol * o.vol * 0.8, style: o.harm ?? 'hold' },
    air: o.air ? { vol: o.air } : s.air,
    tick: undefined,
    form: s.form.map((f) => f.replace(/[+*^]/g, '')),
  });
}

/** The pieces written before D86 (mini-games and cutscenes): each voice's bars repeated to one common length. */
function legacy(t: Omit<Tune, 'cutoff' | 'voices'> & { voices: Omit<Voice, 'name' | 'env' | 'long'>[] }): Tune {
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  const n = t.voices.reduce((l, v) => (l * v.bars.length) / gcd(l, v.bars.length), 1);
  return {
    ...t,
    cutoff: 4200,
    short: true,
    voices: t.voices.map((v, i) => ({
      name: i ? `v${i}` : 'lead',
      wave: v.wave,
      vol: v.vol,
      env: 'soft',
      long: 0.95,
      bars: Array.from({ length: n }, (_, k) => v.bars[k % v.bars.length]!),
    })),
  };
}

// ---------------------------------------------------------------- the island's regions

const SPECS: Record<string, Spec> = {
  // Home Meadow: G major, an easy walking tune with a harp of broken chords.
  home: {
    bpm: 88,
    beats: 4,
    lead: { vol: 0.15 },
    bass: { vol: 0.13, style: 'two' },
    harm: { vol: 0.055, style: 'arp' },
    parts: {
      A: {
        ch: 'G Em C D G Em Am|D G',
        mel: [
          'D4 - G4 - B4 - A4 G4',
          'E4 - G4 - B4 - - .',
          'C5 - B4 A4 G4 - E4 -',
          'D4 - - - F#4 - A4 .',
          'D4 - G4 - B4 - D5 -',
          'E5 - D5 - B4 - G4 -',
          'A4 - C5 B4 A4 - F#4 -',
          'G4 - - - - - . .',
        ],
      },
      B: {
        ch: 'C D Bm Em Am D G D',
        mel: [
          'E5 - - D5 C5 - G4 -',
          'F#4 - A4 - D5 - - .',
          'D5 - - C5 B4 - F#4 -',
          'G4 - B4 - E5 - - .',
          'E5 - - D5 C5 - A4 -',
          'D5 - - C5 A4 - F#4 -',
          'G4 - B4 - D5 - B4 -',
          'A4 - - - . . D4 .',
        ],
      },
    },
    form: ['A', 'A+', 'B', 'A*'],
  },
  // Wishing Square: C major, busy and bright, a walking bass and chords on the off beats.
  square: {
    bpm: 100,
    beats: 4,
    lead: { vol: 0.15 },
    bass: { vol: 0.13, style: 'walk', long: 0.8 },
    harm: { vol: 0.05, style: 'off', wave: 'triangle' },
    parts: {
      A: {
        ch: 'C F G C Am Dm G C',
        mel: [
          'G4 - C5 - E5 - D5 C5',
          'A4 - C5 - F5 - E5 D5',
          'B4 - D5 - G5 - F5 D5',
          'E5 - C5 - G4 - - .',
          'A4 B4 C5 - E5 - A5 -',
          'F5 - E5 D5 C5 - A4 -',
          'B4 - D5 - F5 - E5 D5',
          'C5 - - - . . G4 .',
        ],
      },
      B: {
        ch: 'F G Em Am F G C G',
        mel: [
          'C5 - - A4 F4 - A4 -',
          'B4 - - G4 D4 - G4 -',
          'E5 - - D5 B4 - G4 -',
          'C5 - - B4 A4 - - .',
          'A4 - C5 - F5 - - E5',
          'D5 - B4 - G4 - - .',
          'E5 - D5 - C5 - E5 -',
          'D5 - - - . . G4 .',
        ],
      },
    },
    form: ['A', 'B', 'A+', 'Bp*'],
  },
  // Sandy Bay: D major in a rocking six-eight, a flute over rolling waves.
  bay: {
    bpm: 56,
    beats: 2,
    sub: 3,
    lead: { wave: 'sine', vol: 0.18 },
    bass: { vol: 0.13, style: 'two' },
    harm: { vol: 0.05, style: 'arp' },
    parts: {
      A: {
        ch: 'D Bm G A D Bm Em|A D',
        mel: [
          'F#4 - A4 D5 - C#5',
          'B4 - - F#4 - .',
          'G4 - B4 D5 - B4',
          'A4 - - E4 - .',
          'F#4 - A4 D5 - E5',
          'F#5 - E5 D5 - B4',
          'G4 - B4 A4 - C#5',
          'D5 - - - - .',
        ],
      },
      B: {
        ch: 'G A F#m Bm Em A D A',
        mel: [
          'B4 - - D5 - B4',
          'C#5 - - E5 - C#5',
          'A4 - - F#4 - A4',
          'D5 - - - B4 .',
          'G4 - B4 E5 - D5',
          'C#5 - B4 A4 - .',
          'F#4 - A4 D5 - F#5',
          'E5 - - C#5 - A4',
        ],
      },
    },
    form: ['A', 'A+', 'B', 'A*'],
  },
  // Treasure Island: B minor, a swaying sea song of our own.
  treasure: {
    bpm: 62,
    beats: 2,
    sub: 3,
    lead: { vol: 0.15 },
    bass: { vol: 0.13, style: 'two' },
    harm: { vol: 0.05, style: 'off' },
    parts: {
      A: {
        ch: 'Bm A G F# Bm A G|F# Bm',
        mel: [
          'B4 - - F#4 - B4',
          'C#5 - D5 E5 - C#5',
          'D5 - - B4 - G4',
          'F#4 - - A#4 - C#5',
          'B4 - D5 F#5 - E5',
          'D5 - C#5 E5 - A4',
          'B4 - D5 C#5 - A#4',
          'B4 - - - . .',
        ],
      },
      B: {
        ch: 'D A Bm F#m G D Em F#',
        mel: [
          'F#5 - - E5 - D5',
          'E5 - - C#5 - A4',
          'D5 - - B4 - F#4',
          'C#5 - - A4 - .',
          'B4 - D5 G5 - F#5',
          'F#5 - E5 D5 - A4',
          'G4 - B4 E5 - D5',
          'C#5 - - A#4 - F#4',
        ],
      },
    },
    form: ['A', 'A+', 'B', 'A*', 'B+'],
  },
  // Heeler Heights: A major, quick and bouncy, short notes like a game of chase.
  heeler: {
    bpm: 112,
    beats: 4,
    lead: { vol: 0.17, long: 0.7 },
    bass: { vol: 0.13, style: 'walk', long: 0.7 },
    harm: { vol: 0.05, style: 'off' },
    parts: {
      A: {
        ch: 'A D E A F#m D E A',
        mel: [
          'E4 . A4 . C#5 . A4 B4',
          'D5 . C#5 . B4 . A4 .',
          'G#4 . B4 . E5 . D5 .',
          'C#5 - - . A4 . . .',
          'F#4 . A4 . C#5 . E5 .',
          'F#5 . E5 . D5 . A4 .',
          'B4 . C#5 . D5 . G#4 .',
          'A4 - - . . . E4 .',
        ],
      },
      B: {
        ch: 'D E C#m F#m D E A E',
        mel: [
          'F#4 - A4 - D5 - - .',
          'E4 - G#4 - B4 - - .',
          'C#5 . B4 . G#4 . E4 .',
          'F#4 . G#4 . A4 - - .',
          'A4 . B4 . D5 . F#5 .',
          'E5 . D5 . B4 . G#4 .',
          'A4 . C#5 . E5 . A5 .',
          'G#5 - - . E5 . . .',
        ],
      },
    },
    form: ['A', 'A+', 'B', 'A*'],
  },
  // Bing's Garden: F major waltz, a music box among the flowers.
  bing: {
    bpm: 96,
    beats: 3,
    cutoff: 3600,
    lead: { wave: 'sine', env: 'bell', vol: 0.17 },
    bass: { vol: 0.13, style: 'two' },
    harm: { vol: 0.045, style: 'off', env: 'pluck' },
    bell: { vol: 0.05 },
    parts: {
      A: {
        ch: 'F C Dm Bb F Gm C F',
        mel: [
          'A4 - C5 - F5 -',
          'E5 - D5 - C5 -',
          'D5 - A4 - F4 -',
          'D5 - - - Bb4 -',
          'C5 - F5 - A5 -',
          'G5 - F5 - D5 -',
          'G4 - C5 - E5 -',
          'F5 - - - . .',
        ],
      },
      B: {
        ch: 'Bb C Am Dm Bb C F C',
        mel: [
          'D5 - - - F5 -',
          'E5 - - - C5 -',
          'E5 - C5 - A4 -',
          'F4 - - - . .',
          'Bb4 - D5 - F5 -',
          'G5 - E5 - C5 -',
          'F5 - C5 - A4 -',
          'G4 - - - . .',
        ],
      },
    },
    form: ['A', 'A+', 'B', 'A*', 'B+'],
  },
  // Peppa's Hill: D major with a skip in its step (a shuffle).
  peppa: {
    bpm: 108,
    beats: 4,
    sub: 3,
    lead: { vol: 0.15, long: 0.85 },
    bass: { wave: 'triangle', vol: 0.12, style: 'two', env: 'organ', long: 0.6 },
    harm: { vol: 0.05, style: 'off' },
    parts: {
      A: {
        ch: 'D G D A D G A D',
        mel: [
          'F#4 - A4 D5 - - F#5 - E5 D5 - -',
          'B4 - D5 G5 - - F#5 - E5 D5 - -',
          'A4 - F#4 D4 - - F#4 - A4 D5 - -',
          'C#5 - - E5 - - A4 - - . . .',
          'F#4 - A4 D5 - - F#5 - E5 D5 - -',
          'G5 - - B4 - - E5 - D5 B4 - -',
          'A4 - B4 C#5 - - E5 - - G4 - -',
          'F#4 - - D4 - - . . . . . .',
        ],
      },
      B: {
        ch: 'G A F#m Bm Em A D A',
        mel: [
          'B4 - - D5 - B4 G4 - - . . .',
          'C#5 - - E5 - C#5 A4 - - . . .',
          'A4 - C#5 F#5 - - E5 - C#5 A4 - -',
          'B4 - - F#4 - - D5 - - . . .',
          'E5 - - G5 - - E5 - B4 G4 - -',
          'A4 - C#5 E5 - - C#5 - - . . .',
          'D5 - F#5 A5 - - F#5 - D5 A4 - -',
          'E5 - - C#5 - - A4 - - . . .',
        ],
      },
    },
    form: ['A', 'A+', 'B', 'A*'],
  },
  // Muddy Valley: G major, an oom-pah tuba and splashy short notes.
  valley: {
    bpm: 104,
    beats: 4,
    cutoff: 3200,
    lead: { vol: 0.15, long: 0.55 },
    bass: { wave: 'triangle', vol: 0.15, style: 'two', env: 'organ', long: 0.5 },
    harm: { vol: 0.05, style: 'off', wave: 'triangle', env: 'pluck' },
    parts: {
      A: {
        ch: 'G C G D G C D G',
        mel: [
          'G4 . B4 . D5 . B4 .',
          'C5 . E5 . C5 . G4 .',
          'B4 . D5 . G4 . B4 .',
          'A4 - - . F#4 . D4 .',
          'G4 . B4 . D5 . G5 .',
          'E5 . G5 . E5 . C5 .',
          'D5 . C5 . B4 . A4 .',
          'G4 - - . . . D4 .',
        ],
      },
      B: {
        ch: 'C D Bm Em C D G D',
        mel: [
          'E4 - - G4 C5 - - .',
          'F#4 - - A4 D5 - - .',
          'D5 . B4 . F#4 . B4 .',
          'G4 - - - . . E4 .',
          'G4 . C5 . E5 . G5 .',
          'F#5 . E5 . D5 . A4 .',
          'B4 . D5 . C5 . B4 .',
          'A4 - - . . . . .',
        ],
      },
    },
    form: ['A', 'A+', 'B', 'A*'],
  },
  // Gum Tree Grove: A major on five notes, slow and sunny, a flute over a held drone.
  gum: {
    bpm: 72,
    beats: 4,
    cutoff: 3200,
    lead: { wave: 'sine', vol: 0.16 },
    bass: { vol: 0.12, style: 'hold' },
    harm: { vol: 0.045, style: 'hold', env: 'pad' },
    parts: {
      A: {
        ch: 'A D A E A D E A',
        mel: [
          'E4 - A4 - - - B4 C#5',
          'B4 - A4 - F#4 - - .',
          'E4 - A4 - C#5 - E5 -',
          'B4 - - - - - . .',
          'C#5 - E5 - F#5 - E5 C#5',
          'B4 - A4 - F#4 - A4 -',
          'B4 - - C#5 B4 - E4 -',
          'A4 - - - - - . .',
        ],
      },
      B: {
        ch: 'F#m D A E F#m D E E',
        mel: [
          'F#5 - - E5 C#5 - - .',
          'B4 - - A4 F#4 - - .',
          'E4 - A4 - C#5 - B4 A4',
          'B4 - - - . . . .',
          'A4 - C#5 - F#5 - E5 -',
          'F#5 - E5 - D5 - B4 -',
          'B4 - - - E5 - - -',
          'B4 - - - . . E4 .',
        ],
      },
    },
    form: ['A', 'B', 'A+='],
  },
  // The Blocky Plains: C major with a bright F sharp, a wide open waltz of plucked strings.
  plains: {
    bpm: 88,
    beats: 3,
    lead: { env: 'pluck', vol: 0.17 },
    bass: { vol: 0.12, style: 'hold' },
    harm: { vol: 0.05, style: 'arp' },
    parts: {
      A: {
        ch: 'C D Em Am F D G G',
        mel: [
          'E4 - G4 - C5 -',
          'F#4 - A4 - D5 -',
          'B4 - - - G4 -',
          'A4 - - - E4 -',
          'F4 - A4 - C5 -',
          'D5 - C5 - A4 -',
          'B4 - D5 - G5 -',
          'D5 - - - - -',
        ],
      },
      B: {
        ch: 'Am Em F C Am Em D G',
        mel: [
          'C5 - - - A4 -',
          'B4 - - - E4 -',
          'A4 - C5 - F5 -',
          'E5 - - - - -',
          'E5 - D5 - C5 -',
          'B4 - G4 - E4 -',
          'F#4 - A4 - C5 -',
          'B4 - - - - -',
        ],
      },
    },
    form: ['A', 'A+', 'B', 'A*'],
  },
  // The Blocky Forest: E minor, slow, plucks dropping like rain between tall trees.
  forest: {
    bpm: 70,
    beats: 4,
    cutoff: 3000,
    lead: { vol: 0.14 },
    bass: { vol: 0.12, style: 'hold' },
    harm: { vol: 0.05, style: 'arp2' },
    parts: {
      A: {
        ch: 'Em C G D Em C Am B',
        mel: [
          'E4 - - - G4 - B4 -',
          'C5 - - - E5 - G4 -',
          'D5 - - - B4 - - .',
          'A4 - - - F#4 - - .',
          'G4 - - - B4 - E5 -',
          'E5 - - - D5 - C5 -',
          'C5 - - - A4 - E4 -',
          'D#4 - - - F#4 - - .',
        ],
      },
      B: {
        ch: 'Am Em C D Am Em C B',
        mel: [
          'A4 - - - C5 - E5 -',
          'D5 - - - B4 - - .',
          'C5 - - - E5 - G5 -',
          'F#5 - - - D5 - - .',
          'E5 - - - C5 - A4 -',
          'B4 - - - G4 - E4 -',
          'G4 - - - E4 - G4 -',
          'F#4 - - - D#4 - - .',
        ],
      },
    },
    form: ['A', 'B', 'A+'],
  },
  // Creeper Crater: B minor, a soft low pulse that keeps her watchful but never scared.
  crater: {
    bpm: 80,
    beats: 4,
    cutoff: 2800,
    lead: { vol: 0.14 },
    bass: { vol: 0.14, style: 'two' },
    harm: { vol: 0.045, style: 'off' },
    parts: {
      A: {
        ch: 'Bm G Bm F# Bm G Em F#',
        mel: [
          'B4 - - - D5 - C#5 B4',
          'B4 - - - G4 - - .',
          'F#4 - - - B4 - D5 -',
          'C#5 - - - A#4 - - .',
          'D5 - - - F#5 - E5 D5',
          'D5 - B4 - G4 - - .',
          'E4 - G4 - B4 - E5 -',
          'C#5 - - - - - . .',
        ],
      },
      B: {
        ch: 'G A F#m Bm G A Em F#',
        mel: [
          'D5 - - - B4 - G4 -',
          'C#5 - - - E5 - - .',
          'C#5 - - - A4 - F#4 -',
          'B4 - - - - - . .',
          'G4 - B4 - D5 - G5 -',
          'F#5 - E5 - C#5 - A4 -',
          'B4 - - - G4 - E4 -',
          'F#4 - - - A#4 - C#5 -',
        ],
      },
    },
    form: ['A', 'B', 'A+'],
  },
  // The Mine: D, slow bells that ring and fade like drips in the dark.
  cave: {
    bpm: 66,
    beats: 4,
    cutoff: 2400,
    lead: { wave: 'sine', env: 'bell', vol: 0.17 },
    bass: { vol: 0.12, style: 'hold' },
    harm: { vol: 0.04, style: 'hold', env: 'pad' },
    parts: {
      A: {
        ch: 'Dm G Am Dm Dm G C Am',
        mel: [
          'D4 . . . A4 . . .',
          '. . B4 . . . G4 .',
          'C5 . . . E4 . . .',
          '. . F4 . . . . .',
          'A4 . . . D5 . . .',
          '. . B4 . . . D5 .',
          'E5 . . . C5 . G4 .',
          'A4 . . . . . . .',
        ],
      },
      B: {
        ch: 'F C G Dm F C G Am',
        mel: [
          'C5 . . . F5 . . .',
          'E5 . . . G4 . . .',
          'D5 . . . B4 . . .',
          'A4 . . . F4 . . .',
          'A4 . C5 . . . F4 .',
          'G4 . . . E4 . . .',
          'B4 . D5 . G4 . . .',
          'E4 . . . A4 . . .',
        ],
      },
    },
    form: ['A', 'B', 'A+'],
  },
  // The King's Hall: E minor, a brave march for the big fight (the only fast one outside the mini-games).
  hall: {
    bpm: 120,
    beats: 4,
    lead: { vol: 0.16, long: 0.85 },
    bass: { wave: 'triangle', vol: 0.14, style: 'walk', env: 'organ', long: 0.6 },
    harm: { vol: 0.05, style: 'off', wave: 'triangle' },
    parts: {
      A: {
        ch: 'Em C D Em Em C B B',
        mel: [
          'E4 . E4 G4 B4 - G4 .',
          'C5 - B4 . A4 . G4 .',
          'F#4 . A4 . D5 - C5 .',
          'B4 - - . E4 . . .',
          'G4 . B4 . E5 - D5 .',
          'C5 . E5 . G5 - E5 .',
          'D#5 - - . B4 . F#4 .',
          'B4 - - . . . B3 .',
        ],
      },
      B: {
        ch: 'Am D G C Am B Em B',
        mel: [
          'A4 . C5 . E5 - C5 .',
          'D5 . F#5 . A5 - F#5 .',
          'G5 - D5 . B4 . G4 .',
          'E5 - - . C5 . . .',
          'C5 . A4 . E4 . A4 .',
          'B4 . D#5 . F#5 - D#5 .',
          'E5 - B4 . G4 . E4 .',
          'F#4 - - . D#4 . B3 .',
        ],
      },
    },
    form: ['A', 'A+', 'B', 'A*'],
  },
  // Your cottage: E flat, warm by the fire.
  cottage: {
    bpm: 76,
    beats: 4,
    cutoff: 2600,
    lead: { wave: 'sine', vol: 0.18 },
    bass: { vol: 0.12, style: 'two' },
    harm: { vol: 0.045, style: 'arp2' },
    parts: {
      A: {
        ch: 'Eb Cm Ab Bb Eb Cm Fm|Bb Eb',
        mel: [
          'G4 - - - Bb4 - Eb5 -',
          'D5 C5 - - G4 - - .',
          'Ab4 - C5 - Eb5 - D5 C5',
          'Bb4 - - - - - . .',
          'G4 - Bb4 - Eb5 - G5 -',
          'F5 - Eb5 - C5 - - .',
          'Ab4 - C5 - Bb4 - D5 -',
          'Eb5 - - - - - . .',
        ],
      },
      B: {
        ch: 'Ab Bb Gm Cm Fm Bb Eb Bb',
        mel: [
          'C5 - - - Eb5 - C5 -',
          'D5 - - - Bb4 - F4 -',
          'G4 - Bb4 - D5 - - .',
          'C5 - - - G4 - - .',
          'Ab4 - - - C5 - F5 -',
          'D5 - - - Bb4 - - .',
          'G4 - Bb4 - Eb5 - G5 -',
          'F5 - - - D5 - - .',
        ],
      },
    },
    form: ['A', 'B', 'A+'],
  },
};

// ---------------------------------------------------------------- rooms

const ROOMS: Record<string, Spec> = {
  // Behind the waterfall: E major, slow six-eight, bells and water.
  grotto: {
    bpm: 52,
    beats: 2,
    sub: 3,
    cutoff: 2800,
    lead: { wave: 'sine', env: 'bell', vol: 0.17 },
    bass: { vol: 0.11, style: 'hold' },
    harm: { vol: 0.045, style: 'arp' },
    parts: {
      A: {
        ch: 'E A E B E A B E',
        mel: [
          'B4 - - G#4 - -',
          'C#5 - - E5 - -',
          'B4 - G#4 E4 - -',
          'F#4 - - D#4 - -',
          'G#4 - B4 E5 - -',
          'E5 - C#5 A4 - -',
          'B4 - - D#5 - -',
          'E5 - - - - -',
        ],
      },
      B: {
        ch: 'C#m A E B C#m A F#m B',
        mel: [
          'E5 - - C#5 - -',
          'A4 - - C#5 - -',
          'B4 - - G#4 - -',
          'F#4 - - - - -',
          'G#4 - C#5 E5 - -',
          'E5 - C#5 A4 - -',
          'A4 - - C#5 - -',
          'B4 - - D#5 - -',
        ],
      },
    },
    form: ['A', 'B', 'A+'],
  },
  // Grandad's workshop: C major with a clockwork tick.
  workshop: {
    bpm: 100,
    beats: 4,
    lead: { env: 'pluck', vol: 0.17 },
    bass: { vol: 0.12, style: 'two' },
    harm: { vol: 0.045, style: 'arp2' },
    tick: { vol: 0.035, bar: 'C6 G5_ G5_ G5_' },
    parts: {
      A: {
        ch: 'C G Am Em F C Dm G',
        mel: [
          'C5 . G4 . E4 . G4 .',
          'B4 . D5 . B4 . G4 .',
          'A4 . C5 . E5 . C5 .',
          'B4 - - . G4 . . .',
          'A4 . C5 . F5 . C5 .',
          'G4 . C5 . E5 . G5 .',
          'F5 . E5 . D5 . A4 .',
          'B4 - - . D5 . . .',
        ],
      },
      B: {
        ch: 'F G Em Am Dm G C G',
        mel: [
          'F4 - A4 - C5 - - .',
          'D5 - B4 - G4 - - .',
          'E4 - G4 - B4 - - .',
          'C5 - - B4 A4 - - .',
          'D5 . F5 . A5 . F5 .',
          'D5 . B4 . G4 . B4 .',
          'C5 . E5 . G5 . E5 .',
          'D5 - - . . . . .',
        ],
      },
    },
    form: ['A', 'B', 'A+', 'B*'],
  },
  // The village homes: B flat, homely and unhurried.
  village: {
    bpm: 84,
    beats: 4,
    cutoff: 3000,
    lead: { vol: 0.15 },
    bass: { vol: 0.12, style: 'two' },
    harm: { vol: 0.045, style: 'off' },
    parts: {
      A: {
        ch: 'Bb Eb F Bb Gm Eb F Bb',
        mel: [
          'F4 - Bb4 - D5 - C5 Bb4',
          'G4 - - - Bb4 - . .',
          'A4 - C5 - F5 - Eb5 C5',
          'D5 - - - . . . .',
          'Bb4 - D5 - G5 - F5 -',
          'Eb5 - - - Bb4 - G4 -',
          'A4 - C5 - Eb5 - D5 C5',
          'Bb4 - - - . . . .',
        ],
      },
      B: {
        ch: 'Eb F Dm Gm Cm F Bb F',
        mel: [
          'G4 - Bb4 - Eb5 - - .',
          'F4 - A4 - C5 - - .',
          'D5 - C5 - A4 - F4 -',
          'G4 - - - - - . .',
          'C5 - Eb5 - G5 - Eb5 -',
          'F5 - Eb5 - C5 - A4 -',
          'Bb4 - D5 - F5 - D5 -',
          'C5 - - - . . . .',
        ],
      },
    },
    form: ['A', 'B', 'A+'],
  },
  // The Apple Cafe: F major with a lazy swing and a walking bass.
  cafe: {
    bpm: 96,
    beats: 4,
    sub: 3,
    cutoff: 3200,
    lead: { vol: 0.15, long: 0.85 },
    bass: { vol: 0.13, style: 'walk', long: 0.8 },
    harm: { vol: 0.045, style: 'off', env: 'soft' },
    parts: {
      A: {
        ch: 'F Dm Gm C Am Dm Gm|C F',
        mel: [
          'A4 - C5 F5 - - E5 - F5 C5 - -',
          'D5 - - A4 - - F4 - A4 D5 - -',
          'Bb4 - D5 G5 - - F5 - D5 Bb4 - -',
          'C5 - - E5 - - G4 - - . . .',
          'C5 - E5 A5 - - G5 - E5 C5 - -',
          'D5 - - F5 - - A4 - - . . .',
          'Bb4 - - G4 - - E4 - G4 C5 - -',
          'F4 - - - - - . . . . . .',
        ],
      },
      B: {
        ch: 'Bb C Am Dm Gm C F C',
        mel: [
          'D5 - - F5 - - D5 - Bb4 F4 - -',
          'E5 - - G5 - - E5 - C5 G4 - -',
          'A4 - C5 E5 - - C5 - - . . .',
          'F5 - E5 D5 - - A4 - - . . .',
          'G4 - Bb4 D5 - - G5 - - F5 - -',
          'E5 - - C5 - - G4 - - . . .',
          'F4 - A4 C5 - - F5 - E5 C5 - -',
          'G4 - - - - - . . . . . .',
        ],
      },
    },
    form: ['A', 'A+', 'B', 'A*'],
  },
  // Gabby's Dollhouse: E major, a tiny music box waltz.
  dollhouse: {
    bpm: 108,
    beats: 3,
    lead: { wave: 'sine', env: 'bell', vol: 0.16 },
    bass: { vol: 0.11, style: 'two' },
    harm: { vol: 0.04, style: 'arp' },
    parts: {
      A: {
        ch: 'E B C#m A E A B E',
        mel: [
          'B4 - E5 - G#5 -',
          'F#5 - D#5 - B4 -',
          'C#5 - E5 - G#5 -',
          'A5 - - - E5 -',
          'G#5 - F#5 - E5 -',
          'C#5 - E5 - A4 -',
          'B4 - D#5 - F#5 -',
          'E5 - - - - -',
        ],
      },
      B: {
        ch: 'A B G#m C#m A B E B7',
        mel: [
          'C#5 - - - A4 -',
          'D#5 - - - B4 -',
          'B4 - D#5 - G#5 -',
          'G#5 - - - E5 -',
          'E5 - C#5 - A4 -',
          'F#4 - B4 - D#5 -',
          'E5 - G#5 - B5 -',
          'A5 - F#5 - D#5 -',
        ],
      },
    },
    form: ['A', 'A+', 'B', 'A*', 'B+'],
  },
  // The Post Office: D major, busy little steps, parcels in and out.
  post: {
    bpm: 104,
    beats: 4,
    lead: { vol: 0.17, long: 0.6 },
    bass: { vol: 0.12, style: 'walk', long: 0.6 },
    harm: { vol: 0.045, style: 'off' },
    parts: {
      A: {
        ch: 'D A Bm G D A G|A D',
        mel: [
          'D5 . A4 . F#4 . A4 .',
          'C#5 . E5 . C#5 . A4 .',
          'B4 . D5 . F#5 . D5 .',
          'G4 - - . B4 - - .',
          'A4 . D5 . F#5 . A5 .',
          'G5 . E5 . C#5 . A4 .',
          'B4 . G4 . A4 . C#5 .',
          'D5 - - . . . . .',
        ],
      },
      B: {
        ch: 'G A F#m Bm Em A D A',
        mel: [
          'B4 - - D5 G5 - - .',
          'E5 - - C#5 A4 - - .',
          'F#4 . A4 . C#5 . F#5 .',
          'D5 - - . B4 . . .',
          'G4 . B4 . E5 . G5 .',
          'E5 . C#5 . A4 . E4 .',
          'F#4 . A4 . D5 . F#5 .',
          'E5 - - . C#5 . . .',
        ],
      },
    },
    form: ['A', 'A+', 'B', 'A*'],
  },
  // Nanny's nook: A flat, a slow warm waltz like a hug.
  nook: {
    bpm: 72,
    beats: 3,
    cutoff: 2400,
    lead: { wave: 'sine', vol: 0.16 },
    bass: { vol: 0.12, style: 'two' },
    harm: { vol: 0.04, style: 'hold', env: 'pad' },
    parts: {
      A: {
        ch: 'Ab Db Eb Ab Fm Db Eb Ab',
        mel: [
          'C5 - - - Eb5 -',
          'F5 - - - Db5 -',
          'Bb4 - - - G4 -',
          'Ab4 - - - - -',
          'C5 - Ab4 - F4 -',
          'Ab4 - F4 - Db5 -',
          'C5 - Bb4 - G4 -',
          'Ab4 - - - - -',
        ],
      },
      B: {
        ch: 'Db Eb Cm Fm Bbm Eb Ab Eb',
        mel: [
          'F4 - Ab4 - Db5 -',
          'Eb5 - - - Bb4 -',
          'C5 - Eb5 - G5 -',
          'F5 - - - C5 -',
          'Db5 - - - F5 -',
          'Eb5 - Db5 - Bb4 -',
          'C5 - - - Ab4 -',
          'G4 - - - Bb4 -',
        ],
      },
    },
    form: ['A', 'B', 'A+'],
  },
  // The school: G major, tidy steps up and down like scales on the blackboard.
  school: {
    bpm: 100,
    beats: 4,
    lead: { vol: 0.15 },
    bass: { vol: 0.12, style: 'walk', long: 0.8 },
    harm: { vol: 0.045, style: 'arp' },
    parts: {
      A: {
        ch: 'G C D G Em Am D G',
        mel: [
          'G4 A4 B4 C5 D5 - B4 -',
          'E5 - C5 - G4 - E4 -',
          'F#4 G4 A4 B4 C5 - A4 -',
          'B4 - G4 - D4 - - .',
          'E4 F#4 G4 A4 B4 - E5 -',
          'C5 - - B4 A4 - E4 -',
          'F#4 - A4 - D5 - C5 -',
          'B4 - - - G4 - . .',
        ],
      },
      B: {
        ch: 'C D Bm Em C D G D',
        mel: [
          'E5 - - - G5 - E5 -',
          'F#5 - - - D5 - A4 -',
          'B4 - D5 - F#5 - D5 -',
          'E5 - - - B4 - . .',
          'C5 D5 E5 - G5 - E5 -',
          'D5 E5 F#5 - A5 - F#5 -',
          'G5 - D5 - B4 - G4 -',
          'A4 - - - . . D4 .',
        ],
      },
    },
    form: ['A', 'A+', 'B', 'A*'],
  },
  // The greenhouse: A major, rolling broken chords, things growing.
  greenhouse: {
    bpm: 84,
    beats: 4,
    cutoff: 3400,
    lead: { wave: 'sine', vol: 0.17 },
    bass: { vol: 0.11, style: 'hold' },
    harm: { vol: 0.05, style: 'arp' },
    parts: {
      A: {
        ch: 'A E F#m D A E D E',
        mel: [
          'E4 - - - A4 - C#5 -',
          'B4 - - - G#4 - E4 -',
          'F#4 - - - A4 - C#5 -',
          'D5 - - - - - . .',
          'C#5 - - - E5 - A5 -',
          'G#5 - - - E5 - B4 -',
          'A4 - - - F#4 - D5 -',
          'B4 - - - - - . .',
        ],
      },
      B: {
        ch: 'D A Bm F#m D A E E',
        mel: [
          'F#5 - - - E5 - D5 -',
          'C#5 - - - E5 - A4 -',
          'B4 - - - D5 - F#5 -',
          'E5 - - - C#5 - - .',
          'A4 - D5 - F#5 - E5 -',
          'C#5 - - - A4 - - .',
          'B4 - - - E5 - G#5 -',
          'B5 - - - G#5 - - .',
        ],
      },
    },
    form: ['A', 'B', 'A+'],
  },
  // The lighthouse: D minor in six-eight, the sea turning below. Each floor up is thinner and windier.
  lighthouse: {
    bpm: 54,
    beats: 2,
    sub: 3,
    cutoff: 3000,
    lead: { vol: 0.15 },
    bass: { vol: 0.12, style: 'two' },
    harm: { vol: 0.045, style: 'arp' },
    parts: {
      A: {
        ch: 'Dm Bb F C Dm Bb Gm A',
        mel: [
          'D5 - - A4 - -',
          'Bb4 - D5 F5 - -',
          'C5 - - A4 - F4',
          'G4 - - E4 - -',
          'F4 - A4 D5 - F5',
          'D5 - - Bb4 - -',
          'G4 - Bb4 D5 - C5',
          'C#5 - - A4 - -',
        ],
      },
      B: {
        ch: 'F C Dm Am Bb F Gm A',
        mel: [
          'A4 - C5 F5 - -',
          'E5 - - C5 - -',
          'D5 - F5 A5 - -',
          'E5 - - C5 - -',
          'D5 - - F5 - D5',
          'C5 - - A4 - -',
          'Bb4 - - G4 - Bb4',
          'A4 - - E4 - -',
        ],
      },
    },
    form: ['A', 'A+', 'B', 'A*'],
  },
  // The lookouts and the treehouse: E major, high and airy, with the wind in it.
  lookout: {
    bpm: 80,
    beats: 4,
    cutoff: 3600,
    lead: { wave: 'sine', vol: 0.17 },
    bass: { vol: 0.1, style: 'hold' },
    harm: { vol: 0.045, style: 'arp2' },
    air: { vol: 0.022 },
    parts: {
      A: {
        ch: 'E A E B C#m A B B',
        mel: [
          'B4 - - - E5 - F#5 -',
          'E5 - - - C#5 - - .',
          'B4 - G#4 - E4 - G#4 -',
          'F#4 - - - - - . .',
          'G#4 - B4 - C#5 - E5 -',
          'F#5 - E5 - C#5 - - .',
          'B4 - - - F#5 - D#5 -',
          'B4 - - - - - . .',
        ],
      },
      B: {
        ch: 'A B G#m C#m A B E E',
        mel: [
          'C#5 - - - E5 - A5 -',
          'F#5 - - - D#5 - B4 -',
          'B4 - - - G#4 - D#5 -',
          'E5 - - - C#5 - - .',
          'A4 - C#5 - E5 - F#5 -',
          'F#5 - D#5 - B4 - F#4 -',
          'G#4 - B4 - E5 - G#5 -',
          'E5 - - - - - . .',
        ],
      },
    },
    form: ['A', 'B', 'A+'],
  },
  // The windmill: A minor, a turning waltz of broken chords.
  windmill: {
    bpm: 100,
    beats: 3,
    lead: { wave: 'sine', vol: 0.17 },
    bass: { vol: 0.12, style: 'two' },
    harm: { vol: 0.05, style: 'arp', wave: 'triangle' },
    parts: {
      A: {
        ch: 'Am G F E Am Dm E Am',
        mel: [
          'A4 - C5 - E5 -',
          'D5 - B4 - G4 -',
          'A4 - C5 - F5 -',
          'E5 - - - G#4 -',
          'A4 - C5 - E5 -',
          'F5 - D5 - A4 -',
          'B4 - D5 - G#4 -',
          'A4 - - - - -',
        ],
      },
      B: {
        ch: 'F G C Am Dm G C E',
        mel: [
          'C5 - - - F5 -',
          'D5 - - - B4 -',
          'E5 - G5 - E5 -',
          'C5 - - - A4 -',
          'D5 - F5 - A5 -',
          'G5 - F5 - D5 -',
          'E5 - - - C5 -',
          'B4 - - - G#4 -',
        ],
      },
    },
    form: ['A', 'A+', 'B', 'A*', 'B+'],
  },
};

// ---------------------------------------------------------------- the rest: title, night, mini-games, cutscenes

const OTHER: Record<string, Spec> = {
  // The title: F major, bright and festive, bells on top.
  festive: {
    bpm: 104,
    beats: 4,
    lead: { vol: 0.15 },
    bass: { vol: 0.13, style: 'walk', long: 0.8 },
    harm: { vol: 0.045, style: 'off' },
    bell: { vol: 0.06 },
    parts: {
      A: {
        ch: 'F Dm Bb C F Dm Gm|C F',
        mel: [
          'C5 - A4 - F4 - A4 C5',
          'D5 - - - A4 - - .',
          'Bb4 - D5 - F5 - D5 Bb4',
          'C5 - - - G4 - - .',
          'A4 - C5 - F5 - E5 F5',
          'D5 - C5 - A4 - - .',
          'Bb4 - D5 - C5 - E5 -',
          'F5 - - - . . C5 .',
        ],
      },
      B: {
        ch: 'Bb C Am Dm Bb C F C',
        mel: [
          'D5 - - F5 D5 - Bb4 -',
          'C5 - - E5 C5 - G4 -',
          'A4 - C5 - E5 - D5 C5',
          'D5 - - - A4 - - .',
          'F5 - D5 - Bb4 - D5 -',
          'E5 - C5 - G4 - E5 -',
          'F5 - C5 - A4 - C5 -',
          'G4 - - - . . C5 .',
        ],
      },
    },
    form: ['A*', 'A+', 'B', 'A*'],
  },
  // The night: A minor, a lullaby under the stars (the jukebox's star disc).
  night: {
    bpm: 66,
    beats: 3,
    cutoff: 2200,
    lead: { wave: 'sine', vol: 0.16 },
    bass: { vol: 0.11, style: 'hold' },
    harm: { vol: 0.04, style: 'hold', env: 'pad' },
    parts: {
      A: {
        ch: 'Am F C G Am F G C',
        mel: [
          'E5 - - - C5 -',
          'A4 - - - C5 -',
          'G4 - - - E4 -',
          'D4 - - - G4 -',
          'A4 - C5 - E5 -',
          'F5 - C5 - A4 -',
          'D5 - - - B4 -',
          'C5 - - - - -',
        ],
      },
      B: {
        ch: 'F G Em Am F C G G',
        mel: [
          'A4 - - - F4 -',
          'B4 - - - G4 -',
          'G4 - B4 - E5 -',
          'C5 - - - A4 -',
          'F4 - A4 - C5 -',
          'E5 - - - G4 -',
          'D5 - - - B4 -',
          'G4 - - - - -',
        ],
      },
    },
    form: ['A', 'B', 'A+'],
  },
  // Mini-games: C major, quick and cheerful (short: a game lasts about a minute).
  mini: {
    bpm: 132,
    beats: 4,
    short: true,
    lead: { vol: 0.15, long: 0.7 },
    bass: { wave: 'triangle', vol: 0.13, style: 'walk', env: 'organ', long: 0.5 },
    harm: { vol: 0.045, style: 'off' },
    parts: {
      A: {
        ch: 'C Dm C G',
        mel: ['C5 E5 G5 E5 C5 E5 G5 .', 'D5 F5 A5 F5 D5 F5 A5 .', 'E5 G5 C6 G5 E5 G5 C6 .', 'G5 . F5 . E5 . D5 .'],
      },
      B: {
        ch: 'F G Em|Am Dm|G',
        mel: ['A4 . C5 . F5 - - .', 'B4 . D5 . G5 - - .', 'E5 . D5 . C5 . A4 .', 'D5 - - . B4 . G4 .'],
      },
    },
    form: ['A', 'B', 'A+', 'B*'],
  },
};

const legacyTunes: Record<string, Tune> = {
  // A cutscene sting: tiptoeing in E (short).
  sneak: legacy({
    bpm: 80,
    beats: 4,
    voices: [
      {
        wave: 'triangle',
        vol: 0.13,
        bars: ['E3 . . G3 . . Bb3 .', 'A3 . . . . . . .', 'E3 . . G3 . . Bb3 .', 'B3 . . . . . . .'],
      },
      { wave: 'sine', vol: 0.12, bars: ['E2 - - - - - - -', 'A2 - - - - - - -'] },
    ],
  }),
  // package 70: the secret show. Our own bright pop tune in A minor, four on the floor; nothing from any film (short).
  concert: legacy({
    bpm: 124,
    beats: 4,
    voices: [
      {
        wave: 'triangle',
        vol: 0.15,
        bars: [
          'A4 . C5 E5 . D5 C5 .',
          'G4 . B4 D5 - C5 B4 .',
          'F4 . A4 C5 . E5 D5 C5',
          'E5 - - . G5 . E5 .',
          'A4 . C5 E5 . A5 G5 .',
          'G5 . F5 E5 - D5 C5 .',
          'D5 . E5 F5 . E5 D5 C5',
          'B4 - C5 - E5 - - .',
        ],
      },
      {
        wave: 'triangle',
        vol: 0.15,
        bars: [
          'A2 A2 A3 A2 A2 A2 A3 A2',
          'G2 G2 G3 G2 G2 G2 G3 G2',
          'F2 F2 F3 F2 F2 F2 F3 F2',
          'E2 E2 E3 E2 E2 E2 B2 E2',
        ],
      },
      { wave: 'sine', vol: 0.05, bars: ['A5 . . . A5 . . .', 'E5 . . . E5 . . .'] },
    ],
  }),
  // The ending (short: it plays under the last scene).
  finale: legacy({
    bpm: 108,
    beats: 4,
    voices: [
      {
        wave: 'triangle',
        vol: 0.17,
        bars: [
          'C5 . E5 . G5 - C6 -',
          'B5 . G5 . E5 - - .',
          'A5 . F5 . D5 - F5 -',
          'G5 - - . E5 . C5 .',
          'C5 . E5 . G5 - C6 -',
          'D6 . B5 . G5 - - .',
          'C6 . A5 . F5 . D5 .',
          'C5 - - - - - . .',
        ],
      },
      {
        wave: 'sine',
        vol: 0.14,
        bars: ['C3 - G3 - C3 - G3 -', 'E3 - B3 - E3 - B3 -', 'F2 - C3 - F2 - C3 -', 'G2 - D3 - C3 - G3 -'],
      },
      { wave: 'sine', vol: 0.05, bars: ['G5 . . . G5 . . .', '. . E5 . . . E5 .'] },
    ],
  }),
};

/** The island's regions that play a softer version of their own tune at night. */
export const NIGHT_REGIONS = [
  'home',
  'square',
  'bay',
  'treasure',
  'heeler',
  'bing',
  'peppa',
  'valley',
  'gum',
  'plains',
  'forest',
  'crater',
] as const;

function build(): Record<string, Tune> {
  const all: Record<string, Tune> = {};
  for (const [id, s] of Object.entries({ ...SPECS, ...ROOMS, ...OTHER })) all[id] = compile(id, s);
  // night outdoors: the region's own melody, slower and hushed, under a darker filter
  for (const id of NIGHT_REGIONS)
    all[`${id}_night`] = compile(`${id}_night`, hush(SPECS[id]!, { tempo: 0.86, cutoff: 1500, vol: 0.85 }));
  // indoors at a friend's: a quiet indoor version of their region's tune
  for (const id of ['heeler', 'peppa', 'bing'])
    all[`${id}_in`] = compile(`${id}_in`, hush(SPECS[id]!, { tempo: 0.92, cutoff: 2200, vol: 0.85, bass: 'two' }));
  // up the lighthouse: thinner and windier with each floor
  const lh = ROOMS.lighthouse!;
  all.lighthouse_mid = compile(
    'lighthouse_mid',
    hush(lh, { tempo: 0.96, cutoff: 2600, vol: 0.9, harm: 'arp', air: 0.02 }),
  );
  all.lighthouse_top = compile(
    'lighthouse_top',
    hush(lh, { tempo: 0.9, cutoff: 2200, vol: 0.8, harm: null, air: 0.035 }),
  );
  Object.assign(all, legacyTunes);
  // the meeting place (two players) and the island's own area entry ask for "day": the square's tune
  all.day = all.square!;
  return all;
}

export const MUSIC: Record<string, Tune> = build();
export const hasTune = (id: string): boolean => id in MUSIC;
