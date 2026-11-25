// The music player (D86): each tune plays on its own gain, and a change of tune cross-fades the two. It only talks to
// a Web Audio context and one output node, so a test can drive it with a fake clock.
import { barNotes, barSeconds, type Curve, hz, MUSIC, shape, type Tune } from './music.ts';

/** seconds to fade between two places, and into or out of a mini-game or a cutscene */
export const FADE_PLACE = 1.8;
export const FADE_SCENE = 0.7;
/** a new place's tune is taken only after she has been there this long, so a border walked back and forth is quiet */
export const DWELL = 1;
/** how far ahead of the audio clock bars are scheduled */
const AHEAD = 0.6;

interface Note {
  osc: OscillatorNode[];
  gain: GainNode[];
  end: number;
}
interface Deck {
  id: string;
  tune: Tune;
  bus: GainNode;
  lp: BiquadFilterNode;
  bar: number;
  next: number;
  notes: Note[];
  /** the bus gain's current ramp, so a fade can turn round from where it is */
  from: number;
  to: number;
  t0: number;
  t1: number;
  /** when a fading tune is stopped; Infinity while it is wanted */
  dieAt: number;
}

export class MusicPlayer {
  readonly ctx: BaseAudioContext;
  readonly out: AudioNode;
  decks: Deck[] = [];
  /** the tune being faded in or playing ('' = silence) */
  target = '';
  private pending: { id: string; fade: number; since: number; dwell: number } | null = null;

  constructor(ctx: BaseAudioContext, out: AudioNode) {
    this.ctx = ctx;
    this.out = out;
  }

  /**
   * Ask for a tune. With a dwell, the change waits until the same tune has been asked for that long; asking for the
   * tune already playing cancels a waiting change (a quick there-and-back changes nothing).
   */
  want(id: string, fade: number, dwell = 0): void {
    if (dwell <= 0) {
      this.pending = null;
      this.commit(id, fade);
      return;
    }
    if (id === this.target) {
      this.pending = null;
      return;
    }
    if (this.pending?.id === id) return;
    this.pending = { id, fade, since: this.ctx.currentTime, dwell };
  }

  /** Call every frame. */
  tick(): void {
    const now = this.ctx.currentTime;
    const p = this.pending;
    if (p && now - p.since >= p.dwell) {
      this.pending = null;
      this.commit(p.id, p.fade);
    }
    for (const d of [...this.decks]) {
      if (now >= d.dieAt) {
        this.kill(d);
        continue;
      }
      const len = barSeconds(d.tune);
      // the page slept (a hidden tab): skip the lost bars instead of playing them all at once
      if (d.next < now - 0.05) {
        const k = Math.ceil((now - d.next) / len);
        d.bar += k;
        d.next += k * len;
      }
      while (d.next < now + AHEAD && d.next < d.dieAt) {
        this.playBar(d, d.bar, d.next);
        d.bar++;
        d.next += len;
      }
      if (d.notes.length && d.notes[0]!.end < now) d.notes = d.notes.filter((n) => this.free(n, now));
    }
  }

  /** notes and nodes alive now (for tests and the frame budget) */
  live(): number {
    let n = 0;
    for (const d of this.decks) n += d.notes.length;
    return n;
  }

  private commit(id: string, fade: number): void {
    if (id === this.target) return;
    this.target = id;
    const now = this.ctx.currentTime;
    let found = false;
    for (const d of this.decks) {
      if (d.id === id) {
        found = true;
        d.dieAt = Number.POSITIVE_INFINITY;
        this.ramp(d, 1, fade, now);
      } else if (d.dieAt === Number.POSITIVE_INFINITY) {
        this.ramp(d, 0, fade, now);
        d.dieAt = now + fade;
      }
    }
    const tune = MUSIC[id];
    if (found || !tune) return;
    const bus = this.ctx.createGain();
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = tune.cutoff;
    lp.Q.value = 0.7;
    bus.gain.value = 0;
    bus.connect(lp).connect(this.out);
    const d: Deck = {
      id,
      tune,
      bus,
      lp,
      bar: 0,
      next: now + 0.05,
      notes: [],
      from: 0,
      to: 0,
      t0: now,
      t1: now,
      dieAt: Number.POSITIVE_INFINITY,
    };
    this.decks.push(d);
    this.ramp(d, 1, fade, now);
  }

  private ramp(d: Deck, to: number, fade: number, now: number): void {
    const v = now >= d.t1 ? d.to : d.from + ((d.to - d.from) * (now - d.t0)) / (d.t1 - d.t0);
    const g = d.bus.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(v, now);
    g.linearRampToValueAtTime(to, now + Math.max(0.01, fade));
    d.from = v;
    d.to = to;
    d.t0 = now;
    d.t1 = now + Math.max(0.01, fade);
  }

  private kill(d: Deck): void {
    const now = this.ctx.currentTime;
    for (const n of d.notes) {
      for (const o of n.osc) {
        try {
          o.stop(now);
        } catch {
          // already stopped
        }
      }
      this.free(n, Number.POSITIVE_INFINITY);
    }
    d.notes = [];
    d.bus.disconnect();
    d.lp.disconnect();
    this.decks.splice(this.decks.indexOf(d), 1);
  }

  /** Disconnects a note that has ended; returns whether it is still sounding. */
  private free(n: Note, now: number): boolean {
    if (n.end >= now) return true;
    for (const o of n.osc) o.disconnect();
    for (const g of n.gain) g.disconnect();
    return false;
  }

  private playBar(d: Deck, bar: number, at: number): void {
    for (const v of d.tune.voices)
      for (const e of barNotes(d.tune, v, bar)) {
        const f = hz(e.midi);
        const s = shape(v.env, at + e.at, e.len, v.vol * e.amp, f);
        const note: Note = { osc: [], gain: [], end: s.end };
        this.voice(d, note, v.wave, f, s.curve, s.end);
        if (s.ring) this.voice(d, note, 'sine', f * s.ring.mul, s.ring.curve, s.end);
        d.notes.push(note);
      }
    d.notes.sort((a, b) => a.end - b.end);
  }

  private voice(d: Deck, note: Note, wave: OscillatorType, f: number, curve: Curve, end: number): void {
    const o = this.ctx.createOscillator();
    o.type = wave;
    o.frequency.value = f;
    const g = this.ctx.createGain();
    for (const [t, v, how] of curve) {
      if (how === 'set') g.gain.setValueAtTime(v, t);
      else if (how === 'lin') g.gain.linearRampToValueAtTime(v, t);
      else g.gain.exponentialRampToValueAtTime(v, t);
    }
    o.connect(g).connect(d.bus);
    o.start(curve[0]![0]);
    o.stop(end);
    note.osc.push(o);
    note.gain.push(g);
  }
}
