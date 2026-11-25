// Painting helpers for the mini-game views: backdrops and small props drawn with Graphics, no art needed.
import type Phaser from 'phaser';

type G = Phaser.GameObjects.Graphics;

/** Overshoots a little and settles, for things that pop in. t runs 0..1. */
export function easeBack(t: number): number {
  const c = 1.9;
  const u = Math.max(0, Math.min(1, t)) - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
}

export function sky(g: G, x: number, y: number, w: number, h: number, top: number, bottom: number): void {
  g.fillGradientStyle(top, top, bottom, bottom, 1).fillRect(x, y, w, h);
}

export function cloud(g: G, x: number, y: number, s: number, alpha = 0.95): void {
  g.fillStyle(0xffffff, alpha);
  g.fillEllipse(x, y, 160 * s, 60 * s);
  g.fillCircle(x - 40 * s, y - 14 * s, 34 * s);
  g.fillCircle(x + 14 * s, y - 26 * s, 44 * s);
  g.fillCircle(x + 52 * s, y - 6 * s, 28 * s);
}

export function sun(g: G, x: number, y: number, r: number): void {
  g.fillStyle(0xfff3b0, 0.35).fillCircle(x, y, r * 1.6);
  g.fillStyle(0xffe066, 1).fillCircle(x, y, r);
  g.fillStyle(0xfff8d0, 1).fillCircle(x - r * 0.25, y - r * 0.25, r * 0.45);
}

export function hills(g: G, y: number, color: number, bumps: number, amp: number, phase = 0, w = 1920): void {
  g.fillStyle(color, 1);
  g.beginPath();
  g.moveTo(0, 1080);
  for (let i = 0; i <= 48; i++) {
    const x = (i / 48) * w;
    g.lineTo(x, y - Math.abs(Math.sin((i / 48) * Math.PI * bumps + phase)) * amp);
  }
  g.lineTo(w, 1080);
  g.closePath();
  g.fillPath();
}

export function tree(g: G, x: number, y: number, s: number, leaf = 0x4caf50): void {
  g.fillStyle(0x7a4a24, 1).fillRect(x - 12 * s, y - 70 * s, 24 * s, 72 * s);
  g.fillStyle(0x2f7a35, 1).fillCircle(x, y - 110 * s, 64 * s);
  g.fillStyle(leaf, 1);
  g.fillCircle(x - 34 * s, y - 104 * s, 44 * s);
  g.fillCircle(x + 30 * s, y - 126 * s, 46 * s);
  g.fillCircle(x + 4 * s, y - 150 * s, 40 * s);
  g.fillStyle(0xffffff, 0.18).fillCircle(x - 18 * s, y - 150 * s, 18 * s);
}

export function bushBlob(g: G, x: number, y: number, s: number, color = 0x3f9a45): void {
  g.fillStyle(0x2c6e31, 1).fillEllipse(x, y, 120 * s, 70 * s);
  g.fillStyle(color, 1);
  g.fillCircle(x - 30 * s, y - 14 * s, 30 * s);
  g.fillCircle(x + 6 * s, y - 24 * s, 34 * s);
  g.fillCircle(x + 36 * s, y - 10 * s, 26 * s);
}

export function fence(g: G, x0: number, x1: number, y: number, h: number, color = 0xf3e2c0): void {
  g.fillStyle(0x8a6a44, 1)
    .fillRect(x0, y - h * 0.72, x1 - x0, 12)
    .fillRect(x0, y - h * 0.32, x1 - x0, 12);
  for (let x = x0; x < x1; x += 46) {
    g.fillStyle(0x8a6a44, 1).fillRect(x - 2, y - h - 2, 34, h + 4);
    g.fillStyle(color, 1).fillRect(x, y - h, 30, h);
    g.fillTriangle(x, y - h, x + 30, y - h, x + 15, y - h - 14);
  }
}

/** A five-pointed star. */
export function star(g: G, x: number, y: number, r: number, color: number, inner = 0.45): void {
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 ? r * inner : r;
    pts.push({ x: x + Math.cos(a) * rr, y: y + Math.sin(a) * rr });
  }
  g.fillStyle(color, 1).fillPoints(pts, true);
}

/** A little pennant flag on a pole. Feet at (x, y). */
export function flag(g: G, x: number, y: number, h: number, color: number, wave: number): void {
  g.fillStyle(0x5a3a1a, 1).fillRect(x - 4, y - h, 8, h);
  const top = y - h;
  g.fillStyle(color, 1).fillTriangle(x + 4, top, x + 4, top + h * 0.42, x + 4 + h * 0.55, top + h * 0.2 + wave);
  g.fillStyle(0xffd24a, 1).fillCircle(x, top - 4, 7);
}

export function gem(g: G, x: number, y: number, r: number, color = 0x2ecc71, light = 0xa8f5c4): void {
  g.fillStyle(0x0d3a2a, 1).fillPoints(
    [
      { x, y: y - r * 1.15 },
      { x: x + r, y: y - r * 0.3 },
      { x: x + r * 0.6, y: y + r },
      { x: x - r * 0.6, y: y + r },
      { x: x - r, y: y - r * 0.3 },
    ],
    true,
  );
  g.fillStyle(color, 1).fillPoints(
    [
      { x, y: y - r * 0.9 },
      { x: x + r * 0.78, y: y - r * 0.25 },
      { x: x + r * 0.45, y: y + r * 0.78 },
      { x: x - r * 0.45, y: y + r * 0.78 },
      { x: x - r * 0.78, y: y - r * 0.25 },
    ],
    true,
  );
  g.fillStyle(light, 1).fillTriangle(x, y - r * 0.75, x + r * 0.4, y - r * 0.2, x - r * 0.4, y - r * 0.2);
}

export function rock(g: G, x: number, y: number, r: number): void {
  g.fillStyle(0x3a3a44, 1).fillPoints(
    [
      { x: x - r, y: y + r * 0.5 },
      { x: x - r * 0.8, y: y - r * 0.4 },
      { x: x - r * 0.2, y: y - r * 0.9 },
      { x: x + r * 0.6, y: y - r * 0.6 },
      { x: x + r, y: y + r * 0.5 },
    ],
    true,
  );
  g.fillStyle(0x7a7a88, 1).fillPoints(
    [
      { x: x - r * 0.8, y: y + r * 0.4 },
      { x: x - r * 0.65, y: y - r * 0.3 },
      { x: x - r * 0.15, y: y - r * 0.72 },
      { x: x + r * 0.5, y: y - r * 0.46 },
      { x: x + r * 0.8, y: y + r * 0.4 },
    ],
    true,
  );
  g.fillStyle(0xa8a8b8, 1).fillCircle(x - r * 0.3, y - r * 0.35, r * 0.18);
}

/** A leaf, for a hiding place that turned out to be empty. */
export function leaf(g: G, x: number, y: number, s: number, ang: number): void {
  const c = Math.cos(ang);
  const sn = Math.sin(ang);
  const p = (u: number, v: number) => ({ x: x + (u * c - v * sn) * s, y: y + (u * sn + v * c) * s });
  g.fillStyle(0x2c6e31, 1).fillPoints([p(-26, 0), p(-8, -14), p(16, -12), p(28, 0), p(16, 12), p(-8, 14)], true);
  g.fillStyle(0x7bd36b, 1).fillPoints([p(-20, 0), p(-6, -9), p(14, -8), p(22, 0), p(14, 8), p(-6, 9)], true);
  g.lineStyle(3 * s, 0x2c6e31, 1).lineBetween(p(-24, 0).x, p(-24, 0).y, p(22, 0).x, p(22, 0).y);
}

export function snowPile(g: G, x: number, y: number, w: number, h: number): void {
  g.fillStyle(0xb8d4ec, 1).fillEllipse(x, y, w, h);
  g.fillStyle(0xffffff, 1).fillEllipse(x, y - h * 0.08, w * 0.94, h * 0.84);
  g.fillCircle(x - w * 0.25, y - h * 0.32, h * 0.35);
  g.fillCircle(x + w * 0.18, y - h * 0.38, h * 0.4);
  g.fillStyle(0xe6f2ff, 1).fillEllipse(x, y + h * 0.18, w * 0.8, h * 0.3);
}

/** A fat arrow head pointing along ang (radians), centred on (x, y). */
export function arrow(g: G, x: number, y: number, ang: number, r: number, color: number): void {
  const p = (d: number, a: number, k: number) => ({
    x: x + Math.cos(ang + a) * d * k,
    y: y + Math.sin(ang + a) * d * k,
  });
  g.fillStyle(0x3b2a1a, 1).fillPoints([p(r, 0, 1.3), p(r, 2.5, 1.2), p(r, Math.PI, 0.45), p(r, -2.5, 1.2)], true);
  g.fillStyle(color, 1).fillPoints([p(r, 0, 1), p(r, 2.5, 0.9), p(r, Math.PI, 0.25), p(r, -2.5, 0.9)], true);
}

/** A hanging lantern with its glow. s scales it; shine (0..1) is how bright the glow is. */
export function lantern(g: G, x: number, y: number, s: number, shine: number): void {
  g.fillStyle(0xffc860, 0.16 * shine).fillCircle(x, y, 120 * s);
  g.fillStyle(0xffd27a, 0.3 * shine).fillCircle(x, y, 64 * s);
  g.lineStyle(5 * s, 0x2a1e16, 1).strokeCircle(x, y - 46 * s, 12 * s);
  g.fillStyle(0x2a1e16, 1).fillRoundedRect(x - 26 * s, y - 38 * s, 52 * s, 76 * s, 8 * s);
  g.fillStyle(0xffd27a, 1).fillRoundedRect(x - 18 * s, y - 28 * s, 36 * s, 56 * s, 6 * s);
  g.fillStyle(0xfff8d0, 1).fillEllipse(x, y + 2 * s, 16 * s, 30 * s);
  g.fillStyle(0x2a1e16, 1)
    .fillRect(x - 30 * s, y - 42 * s, 60 * s, 8 * s)
    .fillRect(x - 30 * s, y + 36 * s, 60 * s, 8 * s);
}

/**
 * A small picture of a key, drawn into a graphics layer: a cream cap on a dark base with an arrow, or a word written
 * by the caller on top ('Space', 'E'). The same look as the HUD's key pictures. 'arrows' draws the four arrow keys.
 */
export function keyCapG(g: G, x: number, y: number, label: string, w = 64, h = 58): void {
  if (label === 'arrows') {
    keyCapG(g, x, y - 62, 'up', 58, 52);
    keyCapG(g, x - 62, y, 'left', 58, 52);
    keyCapG(g, x, y, 'down', 58, 52);
    keyCapG(g, x + 62, y, 'right', 58, 52);
    return;
  }
  g.fillStyle(0x3b2a1a, 1).fillRoundedRect(x - w / 2, y - h / 2 + 5, w, h, 11);
  g.fillStyle(0xfffdf2, 1).fillRoundedRect(x - w / 2 + 3, y - h / 2, w - 6, h - 6, 9);
  const a = 13;
  const cy = y - 3;
  g.fillStyle(0x3b2a1a, 1);
  if (label === 'up') g.fillTriangle(x, cy - a, x - a, cy + a * 0.7, x + a, cy + a * 0.7);
  else if (label === 'down') g.fillTriangle(x, cy + a, x - a, cy - a * 0.7, x + a, cy - a * 0.7);
  else if (label === 'left') g.fillTriangle(x - a, cy, x + a * 0.7, cy - a, x + a * 0.7, cy + a);
  else if (label === 'right') g.fillTriangle(x + a, cy, x - a * 0.7, cy - a, x - a * 0.7, cy + a);
}

/** A music note: a giggle or a tune drawn without words. */
export function note(g: G, x: number, y: number, s: number, color = 0xffffff): void {
  g.fillStyle(0x3b2a1a, 1).fillEllipse(x + 2, y + 3, 30 * s, 22 * s);
  g.fillStyle(color, 1).fillEllipse(x, y, 26 * s, 19 * s);
  g.fillStyle(0x3b2a1a, 1).fillRect(x + 9 * s, y - 46 * s, 8 * s, 46 * s);
  g.fillStyle(color, 1).fillRect(x + 10 * s, y - 44 * s, 5 * s, 43 * s);
  g.fillStyle(color, 1).fillTriangle(x + 15 * s, y - 44 * s, x + 34 * s, y - 30 * s, x + 15 * s, y - 28 * s);
}

/** One number the rules move in steps: its value at the last two steps, for drawing between them. */
interface Track {
  name: string;
  cur: number;
  old: number;
  /** the frame this was last asked for, and what was drawn then */
  f: number;
  out: number;
}

/**
 * Package 75 (D78): the rules step 60 times a second but a screen may draw 120, so a thing drawn at its step's place
 * stands still on every second frame and shows as a double picture. A Glider remembers each thing's place at the last
 * two steps and answers with the place between them, by how far into the next step this frame is (`alpha`), as the
 * world does for walking. Pure: no Phaser, so it is tested alone (tests/miniglide.test.ts).
 */
export class Glider {
  private frame = 0;
  private ticks = 0;
  private alpha = 1;
  private tracks = new Map<string, Track>();
  private objTracks = new WeakMap<object, Record<string, Track>>();
  private objIds = new WeakMap<object, number>();
  private objN = 0;
  private all: Track[] = [];

  /** Once a frame, before anything is asked: rules steps run since the last frame, and the share of a step passed. */
  begin(ticks: number, alpha: number): void {
    this.frame++;
    this.ticks = ticks;
    this.alpha = Math.max(0, Math.min(1, alpha));
    if (this.frame % 120 === 0) this.all = this.all.filter((t) => t.f >= this.frame - 60);
  }

  /** A new game: forget every thing (nothing glides from the last game). */
  clear(): void {
    this.tracks.clear();
    this.objTracks = new WeakMap();
    this.all.length = 0;
  }

  /**
   * The drawn value of `v`, a number the rules change in steps. A change bigger than `jump` in one step is a jump on
   * purpose (a reset, a new round, a thing that just appeared): it is not glided. A thing not asked for on the last
   * frame starts afresh where it is.
   */
  num(name: string, v: number, jump: number): number {
    let t = this.tracks.get(name);
    if (!t) {
      t = this.track(name);
      this.tracks.set(name, t);
    }
    return this.glide(t, v, jump);
  }

  /** The same for one field of one of the game's things, found by the thing itself. */
  field(o: object, key: string, v: number, jump: number): number {
    let rec = this.objTracks.get(o);
    if (!rec) {
      rec = {};
      this.objTracks.set(o, rec);
      this.objIds.set(o, ++this.objN);
    }
    let t = rec[key];
    if (!t) {
      t = this.track(`obj${this.objIds.get(o)}.${key}`);
      rec[key] = t;
    }
    return this.glide(t, v, jump);
  }

  /** What was drawn this frame by name, with the rules' value at the last step and the one before. */
  probe(): { frame: number; v: Record<string, [number, number, number]> } {
    const v: Record<string, [number, number, number]> = {};
    for (const t of this.all) if (t.f === this.frame) v[t.name] = [t.out, t.cur, t.old];
    return { frame: this.frame, v };
  }

  private track(name: string): Track {
    const t: Track = { name, cur: 0, old: 0, f: -9, out: 0 };
    this.all.push(t);
    return t;
  }

  private glide(t: Track, v: number, jump: number): number {
    if (t.f === this.frame) return t.out;
    if (t.f !== this.frame - 1) {
      t.cur = t.old = v;
    } else if (this.ticks > 0 || v !== t.cur) {
      if (Math.abs(v - t.cur) > jump) t.old = v;
      else t.old = this.ticks > 1 ? t.cur + ((v - t.cur) * (this.ticks - 1)) / this.ticks : t.cur;
      t.cur = v;
    }
    t.f = this.frame;
    t.out = t.old + (t.cur - t.old) * this.alpha;
    return t.out;
  }
}
