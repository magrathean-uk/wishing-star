// Renders every tune to a WAV file for listening (D86), through a plain offline synth that plays the same notes and
// the same envelopes as the game (src/game/music.ts). Also renders three cross-fades between neighbouring places, the
// way the game's player does them. Checks each file: not silent, peak under 0.9, the right length.
//   node tools/music/render.ts [outdir]
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  barNotes,
  barSeconds,
  type Curve,
  hz,
  loopBars,
  loopSeconds,
  MUSIC,
  shape,
  type Tune,
} from '../../src/game/music.ts';

const RATE = 24000;
/** the game's music bus at full music volume in Options (audio.ts: music * 0.5) */
const BUS = 0.5;
const FADE = 1.8;
const out = resolve(process.argv[2] ?? '/Volumes/4TB/dev/work/jobs/wishing-star/music79');
mkdirSync(out, { recursive: true });

function envAt(c: Curve, t: number, k: { i: number; v: number; t: number }): number {
  // walks the curve forward (k keeps the place), with Web Audio's meaning of set / linear / exponential
  while (k.i < c.length && c[k.i]![0] <= t) {
    k.v = c[k.i]![1];
    k.t = c[k.i]![0];
    k.i++;
  }
  const nx = c[k.i];
  if (!nx || nx[2] === 'set') return k.v;
  const f = (t - k.t) / (nx[0] - k.t);
  if (nx[2] === 'exp' && k.v > 0 && nx[1] > 0) return k.v * (nx[1] / k.v) ** f;
  return k.v + (nx[1] - k.v) * f;
}

function wave(w: string, ph: number): number {
  const x = ph - Math.floor(ph);
  if (w === 'sine') return Math.sin(2 * Math.PI * x);
  if (w === 'triangle') return x < 0.25 ? 4 * x : x < 0.75 ? 2 - 4 * x : 4 * x - 4;
  if (w === 'square') return x < 0.5 ? 1 : -1;
  return 2 * x - 1;
}

/** One tune from its first bar, `secs` long, starting `start` seconds into the buffer, with a gain curve on its bus. */
function play(buf: Float32Array, t: Tune, start: number, secs: number, bus: Curve): void {
  const tmp = new Float32Array(buf.length);
  const bars = Math.ceil(secs / barSeconds(t)) + 1;
  for (let b = 0; b < bars; b++) {
    const at0 = start + b * barSeconds(t);
    if (at0 >= start + secs) break;
    for (const v of t.voices)
      for (const e of barNotes(t, v, b)) {
        const f = hz(e.midi);
        const s = shape(v.env, at0 + e.at, e.len, v.vol * e.amp, f);
        const parts: [string, number, Curve][] = [[v.wave, f, s.curve]];
        if (s.ring) parts.push(['sine', f * s.ring.mul, s.ring.curve]);
        for (const [w, fr, c] of parts) {
          const i0 = Math.max(0, Math.floor(c[0]![0] * RATE));
          const i1 = Math.min(buf.length, Math.ceil(Math.min(s.end, start + secs) * RATE));
          const k = { i: 0, v: 0, t: 0 };
          for (let i = i0; i < i1; i++) {
            const tt = i / RATE;
            tmp[i] = tmp[i]! + wave(w, fr * (tt - c[0]![0])) * envAt(c, tt, k);
          }
        }
      }
  }
  // the tune's own low-pass (RBJ biquad, Q 0.7), then its fade
  const w0 = (2 * Math.PI * t.cutoff) / RATE;
  const al = Math.sin(w0) / (2 * 0.7);
  const cw = Math.cos(w0);
  const a0 = 1 + al;
  const b0 = (1 - cw) / 2 / a0;
  const b1 = (1 - cw) / a0;
  const a1 = (-2 * cw) / a0;
  const a2 = (1 - al) / a0;
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  const k = { i: 0, v: 0, t: 0 };
  for (let i = 0; i < buf.length; i++) {
    const x = tmp[i]!;
    const y = b0 * x + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    buf[i] = buf[i]! + y * envAt(bus, i / RATE, k) * BUS;
  }
}

function wav(path: string, buf: Float32Array): void {
  const data = Buffer.alloc(44 + buf.length * 2);
  data.write('RIFF', 0);
  data.writeUInt32LE(36 + buf.length * 2, 4);
  data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(RATE, 24);
  data.writeUInt32LE(RATE * 2, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write('data', 36);
  data.writeUInt32LE(buf.length * 2, 40);
  for (let i = 0; i < buf.length; i++)
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, buf[i]!)) * 32767), 44 + i * 2);
  writeFileSync(path, data);
}

const stats = (buf: Float32Array): { peak: number; rms: number } => {
  let peak = 0;
  let sq = 0;
  for (const x of buf) {
    peak = Math.max(peak, Math.abs(x));
    sq += x * x;
  }
  return { peak, rms: Math.sqrt(sq / buf.length) };
};

let bad = 0;
const lines: string[] = [];
const seen = new Set<Tune>();
for (const [id, t] of Object.entries(MUSIC)) {
  if (seen.has(t)) continue; // "day" is the square's tune
  seen.add(t);
  const secs = loopSeconds(t);
  const buf = new Float32Array(Math.round(secs * RATE));
  play(buf, t, 0, secs, [[0, 1, 'set']]);
  const { peak, rms } = stats(buf);
  const okLen = Math.abs(buf.length / RATE - loopBars(t) * barSeconds(t)) < 1 / RATE + 1e-9;
  const ok = peak > 0.02 && peak < 0.9 && rms > 0.01 && okLen;
  if (!ok) bad++;
  wav(resolve(out, `${id}.wav`), buf);
  lines.push(
    `${ok ? 'ok ' : 'BAD'} ${id.padEnd(16)} ${secs.toFixed(1).padStart(5)} s  peak ${peak.toFixed(2)}  rms ${rms.toFixed(3)}`,
  );
}

// cross-fades between neighbours, as the player does them: at 12 s the old tune fades out over FADE while the new
// one starts on its own gain and fades in
for (const [a, b] of [
  ['home', 'bay'],
  ['peppa', 'valley'],
  ['plains', 'forest'],
] as const) {
  const at = 12;
  const len = 26;
  const buf = new Float32Array(len * RATE);
  play(buf, MUSIC[a]!, 0, at + FADE, [
    [0, 1, 'set'],
    [at, 1, 'set'],
    [at + FADE, 0, 'lin'],
  ]);
  play(buf, MUSIC[b]!, at + 0.05, len - at, [
    [0, 0, 'set'],
    [at, 0, 'set'],
    [at + FADE, 1, 'lin'],
  ]);
  const { peak, rms } = stats(buf);
  const ok = peak < 0.9 && rms > 0.01;
  if (!ok) bad++;
  wav(resolve(out, `fade_${a}_to_${b}.wav`), buf);
  lines.push(`${ok ? 'ok ' : 'BAD'} fade ${a} -> ${b}  ${len} s  peak ${peak.toFixed(2)}  rms ${rms.toFixed(3)}`);
}
writeFileSync(resolve(out, 'CHECK.txt'), `${lines.join('\n')}\n`);
console.log(lines.join('\n'));
console.log(bad ? `RENDER BAD ${bad}` : `RENDER OK ${lines.length} files in ${out}`);
process.exitCode = bad ? 1 : 0;
