// Package 79 (D86): the music player cross-fades on two gains, waits a moment at a border, turns a fade round from
// where it is, and leaves no node behind. Driven with a fake audio clock.
import { describe, expect, it } from 'vitest';
import { DWELL, FADE_PLACE, FADE_SCENE, MusicPlayer } from '../src/game/musicplayer.ts';

type Ev = { t: number; v: number; how: 'set' | 'lin' | 'exp' };
class Param {
  value = 0;
  ev: Ev[] = [];
  setValueAtTime(v: number, t: number) {
    this.ev.push({ t, v, how: 'set' });
  }
  linearRampToValueAtTime(v: number, t: number) {
    this.ev.push({ t, v, how: 'lin' });
  }
  exponentialRampToValueAtTime(v: number, t: number) {
    this.ev.push({ t, v, how: 'exp' });
  }
  cancelScheduledValues(t: number) {
    this.ev = this.ev.filter((e) => e.t < t);
  }
  at(t: number): number {
    let v = this.value;
    let t0 = 0;
    for (const e of this.ev) {
      if (e.t <= t) {
        v = e.v;
        t0 = e.t;
        continue;
      }
      if (e.how === 'set') return v;
      return v + ((e.v - v) * (t - t0)) / (e.t - t0);
    }
    return v;
  }
}
class Node {
  out: Node[] = [];
  gone = false;
  connect<T extends Node>(n: T): T {
    this.out.push(n);
    return n;
  }
  disconnect() {
    this.out = [];
    this.gone = true;
  }
}
class Gain extends Node {
  gain = new Param();
}
class Osc extends Node {
  type = 'sine';
  frequency = new Param();
  start = (t: number) => {
    this.startAt = t;
  };
  stop = (t: number) => {
    this.stops.push(t);
  };
  startAt = -1;
  stops: number[] = [];
}
class Filter extends Node {
  type = 'lowpass';
  frequency = new Param();
  Q = new Param();
}
class Ctx {
  currentTime = 0;
  osc: Osc[] = [];
  gains: Gain[] = [];
  createGain() {
    const g = new Gain();
    this.gains.push(g);
    return g;
  }
  createOscillator() {
    const o = new Osc();
    this.osc.push(o);
    return o;
  }
  createBiquadFilter() {
    return new Filter();
  }
}

function rig() {
  const ctx = new Ctx();
  const out = new Node();
  const p = new MusicPlayer(ctx as unknown as BaseAudioContext, out as unknown as AudioNode);
  const run = (secs: number) => {
    const end = ctx.currentTime + secs;
    while (ctx.currentTime < end - 1e-9) {
      ctx.currentTime = Math.min(end, ctx.currentTime + 1 / 60);
      p.tick();
    }
  };
  const bus = (id: string) => p.decks.find((d) => d.id === id)?.bus as unknown as Gain | undefined;
  return { ctx, p, run, bus };
}

describe('the music player', () => {
  it('a change ramps the old gain down and the new one up over the fade, then stops the old notes', () => {
    const { ctx, p, run, bus } = rig();
    p.want('home', FADE_PLACE);
    run(3);
    const home = bus('home')!;
    expect(home.gain.at(ctx.currentTime)).toBeCloseTo(1, 5);
    const t = ctx.currentTime;
    p.want('bay', FADE_PLACE);
    const bay = bus('bay')!;
    expect(p.decks.length).toBe(2);
    expect(home.gain.at(t + FADE_PLACE / 2)).toBeCloseTo(0.5, 2);
    expect(bay.gain.at(t + FADE_PLACE / 2)).toBeCloseTo(0.5, 2);
    expect(home.gain.at(t + FADE_PLACE)).toBeCloseTo(0, 5);
    expect(bay.gain.at(t + FADE_PLACE)).toBeCloseTo(1, 5);
    // the old tune keeps playing through its fade
    run(FADE_PLACE - 0.1);
    expect(bus('home')).toBe(home);
    const homeNotes = p.decks.find((d) => d.id === 'home')!.notes.flatMap((n) => n.osc) as unknown as Osc[];
    expect(homeNotes.length).toBeGreaterThan(0);
    run(0.2);
    expect(bus('home')).toBeUndefined();
    expect(home.gone).toBe(true);
    // every note scheduled for the old tune is stopped by the end of its fade
    for (const o of homeNotes) {
      expect(o.gone).toBe(true);
      expect(Math.min(...o.stops)).toBeLessThanOrEqual(t + FADE_PLACE + 1 / 60 + 1e-9);
    }
  });

  it('a border walked over and back within a second changes nothing', () => {
    const { p, run, bus } = rig();
    p.want('home', FADE_PLACE);
    run(2);
    const home = bus('home')!;
    const ramps = home.gain.ev.length;
    p.want('bay', FADE_PLACE, DWELL);
    run(0.5);
    p.want('home', FADE_PLACE, DWELL);
    run(3);
    expect(p.target).toBe('home');
    expect(p.decks.map((d) => d.id)).toEqual(['home']);
    expect(home.gain.ev.length).toBe(ramps);
    // staying over the border for a second does change it
    p.want('bay', FADE_PLACE, DWELL);
    run(DWELL / 2);
    p.want('bay', FADE_PLACE, DWELL);
    run(DWELL / 2 + 0.05);
    expect(p.target).toBe('bay');
  });

  it('a tune fading out and wanted again fades back in from where it is, without starting over', () => {
    const { ctx, p, run, bus } = rig();
    p.want('home', FADE_PLACE);
    run(2);
    const home = bus('home')!;
    const deck = p.decks[0]!;
    const bar = deck.bar;
    p.want('mini', FADE_SCENE);
    run(FADE_SCENE / 2);
    const mid = home.gain.at(ctx.currentTime);
    expect(mid).toBeGreaterThan(0.3);
    expect(mid).toBeLessThan(0.7);
    p.want('home', FADE_SCENE);
    expect(bus('home')).toBe(home);
    expect(home.gain.at(ctx.currentTime)).toBeCloseTo(mid, 5);
    expect(home.gain.at(ctx.currentTime + FADE_SCENE)).toBeCloseTo(1, 5);
    run(2);
    expect(p.decks.map((d) => d.id)).toEqual(['home']);
    expect(p.decks[0]).toBe(deck);
    expect(deck.bar).toBeGreaterThan(bar);
  });

  it('silence fades too', () => {
    const { ctx, p, run, bus } = rig();
    p.want('night', FADE_PLACE);
    run(2);
    const night = bus('night')!;
    p.want('', FADE_SCENE);
    expect(night.gain.at(ctx.currentTime + FADE_SCENE / 2)).toBeCloseTo(0.5, 2);
    run(1);
    expect(p.decks).toEqual([]);
    expect(p.live()).toBe(0);
  });

  it('after ten changes only the last tune is left, and every other node is stopped and freed', () => {
    const { ctx, p, run } = rig();
    const ids = ['home', 'square', 'bay', 'mini', 'treasure', 'heeler', 'cafe', 'bing', 'peppa', 'valley', 'gum'];
    let peak = 0;
    for (const [i, id] of ids.entries()) {
      p.want(id, i % 2 ? FADE_SCENE : FADE_PLACE);
      for (let k = 0; k < 30; k++) {
        run(0.1);
        peak = Math.max(peak, p.live());
      }
    }
    run(5);
    expect(p.decks.map((d) => d.id)).toEqual(['gum']);
    const live = new Set(p.decks.flatMap((d) => d.notes.flatMap((n) => n.osc)) as unknown as Osc[]);
    const now = ctx.currentTime;
    for (const o of ctx.osc) {
      if (live.has(o)) continue;
      expect(o.gone).toBe(true);
      expect(Math.min(...o.stops)).toBeLessThanOrEqual(now);
    }
    const liveGains = p.decks.flatMap((d) => [d.bus, ...d.notes.flatMap((n) => n.gain)]) as unknown as Gain[];
    for (const g of ctx.gains) if (!liveGains.includes(g)) expect(g.gone).toBe(true);
    // a handful of notes at once, even mid cross-fade
    expect(peak).toBeLessThan(80);
  });

  it('a page that slept does not play the lost bars all at once', () => {
    const { ctx, p, run } = rig();
    p.want('square', FADE_PLACE);
    run(3);
    const before = ctx.osc.length;
    ctx.currentTime += 30;
    p.tick();
    const late = ctx.osc.slice(before).filter((o) => o.startAt < ctx.currentTime - 0.01);
    expect(late).toEqual([]);
  });
});
