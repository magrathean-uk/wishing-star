// Juice: every action gets a visible effect. Pooled sprites only; nothing here allocates in steady play.
import Phaser from 'phaser';
import { FUSE_TIME, SHIELD, sheltered } from '../../core/bosses.ts';
import { CHASE, STRIKE, WINDUP } from '../../core/mobs.ts';
import type { Game, Mob } from '../../core/types.ts';
import { frameFor, wantChar } from '../assets.ts';
import { Sound } from '../audio.ts';
import { Puppet } from '../puppet.ts';

interface Bit {
  img: Phaser.GameObjects.Image;
  vx: number;
  vy: number;
  g: number;
  life: number;
  max: number;
  spin: number;
  grow: number;
  /** flies to a target and vanishes (pick-ups hopping into the bag) */
  home: boolean;
  tx: number;
  ty: number;
}

/** A ground mark that holds still (it does not fly or fade like a bit): it eases from one size to another. */
interface Mark {
  img: Phaser.GameObjects.Image;
  life: number;
  max: number;
  s0: number;
  s1: number;
  a: number;
  /** throbs this many times a second (0: steady) */
  pulse: number;
  /** fades out over the last part of its life (seconds) */
  out: number;
}

const T = 64;
/** Ground marks sit above the floor and flat things, under everything that stands. */
const GROUND = -600;
/** a mob's hurt timer starts at 0.22 s: above this it flashes white (about 2 frames), below it a light warm tint */
export const HIT_FLASH = 0.185;
export const HIT_TINT = 0xffc4b4;
/** the wind-up blink before a strike: a warm red tint, never a solid shape */
export const WINDUP_TINT = 0xff8c8c;

/** seconds a word over an animal stays (package 71) */
const WORD_LIFE = 1.1;

export class Fx {
  private scene: Phaser.Scene;
  private pool: Bit[] = [];
  private live: Bit[] = [];
  /** where she stands this frame (set by the World before anything else is drawn) */
  readonly hero = { x: 0, y: 0 };
  /** "Fewer effects" in the pause menu: half the bits, no big washes */
  low = false;
  /** a menu is open: everything holds still */
  paused = false;
  /** the warm wash of a region lighting up: one pooled image */
  private washImg: Phaser.GameObjects.Image | null = null;
  private washT = 0;
  private washMax = 1;
  private washA = 0.6;
  private markPool: Mark[] = [];
  private marks: Mark[] = [];
  /** package 68: "2 left" over a mob she has just hit (one pooled text; a new hit replaces it) */
  private leftT: Phaser.GameObjects.Text | null = null;
  private leftLife = 0;
  /** package 71: the words over stroked animals */
  private words: { t: Phaser.GameObjects.Text; life: number }[] = [];

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    const mk = (key: string, draw: (g: Phaser.GameObjects.Graphics) => void, w: number, h: number) => {
      if (scene.textures.exists(key)) return;
      const g = scene.make.graphics({ x: 0, y: 0 }, false);
      draw(g);
      g.generateTexture(key, w, h);
      g.destroy();
    };
    mk('fx_dot', (g) => g.fillStyle(0xffffff, 1).fillCircle(16, 16, 15), 32, 32);
    mk(
      'fx_soft',
      (g) => {
        for (let i = 8; i > 0; i--) g.fillStyle(0xffffff, 0.12).fillCircle(32, 32, i * 4);
      },
      64,
      64,
    );
    mk('fx_sq', (g) => g.fillStyle(0xffffff, 1).fillRect(0, 0, 14, 14), 14, 14);
    mk('fx_ring', (g) => g.lineStyle(6, 0xffffff, 1).strokeCircle(64, 64, 58), 128, 128);
    mk(
      'fx_star',
      (g) => {
        g.fillStyle(0xffffff, 1);
        g.beginPath();
        for (let i = 0; i < 10; i++) {
          const r = i % 2 ? 7 : 16;
          const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
          if (i === 0) g.moveTo(16 + Math.cos(a) * r, 16 + Math.sin(a) * r);
          else g.lineTo(16 + Math.cos(a) * r, 16 + Math.sin(a) * r);
        }
        g.closePath().fillPath();
      },
      32,
      32,
    );
    mk(
      'fx_heart',
      (g) => {
        g.fillStyle(0xffffff, 1);
        g.fillCircle(10, 11, 8).fillCircle(22, 11, 8);
        g.fillTriangle(3, 15, 29, 15, 16, 30);
      },
      32,
      32,
    );
    mk(
      'fx_bang',
      (g) => {
        g.fillStyle(0xffffff, 1).fillRoundedRect(11, 2, 10, 18, 4).fillCircle(16, 27, 5);
      },
      32,
      32,
    );
    // Boss marks. Each has a dark edge, so it reads on snow and on cave floor alike (tint colours the light part).
    mk(
      'fx_mark',
      (g) => {
        g.lineStyle(14, 0x000000, 0.45).strokeCircle(64, 64, 54);
        g.lineStyle(7, 0xffffff, 1).strokeCircle(64, 64, 54);
      },
      128,
      128,
    );
    mk(
      'fx_star_edged',
      (g) => {
        const star = (cx: number, cy: number, ro: number, ri: number) => {
          g.beginPath();
          for (let i = 0; i < 10; i++) {
            const r = i % 2 ? ri : ro;
            const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
            if (i === 0) g.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
            else g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
          }
          g.closePath().fillPath();
        };
        g.fillStyle(0x2a1c10, 1);
        star(24, 25, 23, 12);
        g.fillStyle(0xffffff, 1);
        star(24, 24, 17, 8);
      },
      48,
      48,
    );
    mk('fx_disc', (g) => g.fillStyle(0xffffff, 1).fillCircle(64, 64, 60), 128, 128);
    mk(
      'fx_reach',
      (g) => {
        // a dashed circle, radius 240
        const n = 36;
        for (const [w, c, a] of [
          [16, 0x000000, 0.4],
          [8, 0xffffff, 1],
        ] as const) {
          g.lineStyle(w, c, a);
          for (let i = 0; i < n; i++) {
            const a0 = (i / n) * Math.PI * 2;
            g.beginPath();
            g.arc(256, 256, 240, a0, a0 + (Math.PI * 2) / n / 1.8);
            g.strokePath();
          }
        }
      },
      512,
      512,
    );
    mk(
      'fx_wave',
      (g) => {
        g.lineStyle(20, 0x000000, 0.35).strokeCircle(128, 128, 116);
        g.lineStyle(11, 0xffffff, 1).strokeCircle(128, 128, 116);
        g.lineStyle(4, 0xffffff, 0.5).strokeCircle(128, 128, 104);
      },
      256,
      256,
    );
    mk(
      'fx_shield',
      (g) => {
        const shape = (x: number, y: number, w: number, h: number) => {
          g.beginPath();
          g.moveTo(x, y + h * 0.12);
          g.lineTo(x + w / 2, y);
          g.lineTo(x + w, y + h * 0.12);
          g.lineTo(x + w, y + h * 0.5);
          g.lineTo(x + w / 2, y + h);
          g.lineTo(x, y + h * 0.5);
          g.closePath();
        };
        g.fillStyle(0x2a1c10, 1);
        shape(2, 2, 60, 72);
        g.fillPath();
        g.fillStyle(0x5ac8ff, 1);
        shape(8, 8, 48, 58);
        g.fillPath();
        g.fillStyle(0xffffff, 0.55);
        shape(14, 13, 18, 30);
        g.fillPath();
        g.fillStyle(0xffffff, 1).fillRect(29, 20, 6, 32).fillRect(19, 31, 26, 6);
      },
      64,
      76,
    );
  }

  /** A still mark on the ground (or over a head), easing from size s0 to s1 (pixels of radius) over its life. */
  mark(key: string, x: number, y: number, r0: number, r1: number, life: number, tint: number, a = 1, pulse = 0): Mark {
    let m = this.markPool.pop();
    if (!m) m = { img: this.scene.add.image(0, 0, key), life: 0, max: 1, s0: 1, s1: 1, a: 1, pulse: 0, out: 0.15 };
    const half = key === 'fx_reach' ? 240 : key === 'fx_wave' ? 116 : key === 'fx_disc' ? 60 : 54;
    m.img
      .setTexture(key)
      .setPosition(x, y)
      .setVisible(true)
      .setAngle(0)
      .setTint(tint)
      .setDepth(GROUND)
      .setBlendMode(Phaser.BlendModes.NORMAL)
      .setScale(r0 / half)
      .setAlpha(a);
    m.life = m.max = life;
    m.s0 = r0 / half;
    m.s1 = r1 / half;
    m.a = a;
    m.pulse = pulse;
    m.out = Math.min(0.12, life / 3);
    this.marks.push(m);
    return m;
  }

  /** The stomp ring has stopped: it lingers where it stopped and fades. */
  ringEnd(x: number, y: number, r: number): void {
    const m = this.mark('fx_wave', x, y, r, r + 18, 0.45, 0xb6ff8a, 0.9);
    m.out = 0.45;
  }

  setHero(x: number, y: number): void {
    this.hero.x = x;
    this.hero.y = y;
  }

  private bit(key: string, frame: string | undefined, x: number, y: number): Bit {
    let b = this.pool.pop();
    if (!b)
      b = {
        img: this.scene.add.image(0, 0, key, frame),
        vx: 0,
        vy: 0,
        g: 0,
        life: 0,
        max: 1,
        spin: 0,
        grow: 0,
        home: false,
        tx: 0,
        ty: 0,
      };
    b.img
      .setTexture(key, frame)
      .setPosition(x, y)
      .setVisible(true)
      .setAlpha(1)
      .setScale(1)
      .setAngle(0)
      .setTint(0xffffff)
      .setDepth(y + 400)
      .setBlendMode(Phaser.BlendModes.NORMAL);
    b.home = false;
    b.vx = 0;
    b.vy = 0;
    b.grow = 0;
    b.spin = 0;
    b.g = 0;
    this.live.push(b);
    return b;
  }

  burst(
    key: string,
    x: number,
    y: number,
    n: number,
    color: number | number[],
    speed: number,
    life: number,
    opts: { g?: number; scale?: number; up?: number; grow?: number; depth?: number } = {},
  ): void {
    if (this.low) n = Math.ceil(n / 2);
    for (let i = 0; i < n; i++) {
      const b = this.bit(key, undefined, x, y);
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.8);
      b.vx = Math.cos(a) * s;
      b.vy = Math.sin(a) * s - (opts.up ?? 0);
      b.g = opts.g ?? 0;
      b.life = b.max = life * (0.7 + Math.random() * 0.6);
      b.spin = (Math.random() - 0.5) * 500;
      b.grow = opts.grow ?? 0;
      b.img.setScale((opts.scale ?? 0.5) * (0.6 + Math.random() * 0.8));
      b.img.setTint(Array.isArray(color) ? color[Math.floor(Math.random() * color.length)]! : color);
      if (opts.depth !== undefined) b.img.setDepth(opts.depth);
    }
  }

  /**
   * Package 71 (D78): a short word over a thing in the world ("Meow!"): it rises and fades in about a second. The
   * same look for every animal; a few pooled texts, the oldest is reused.
   */
  word(say: string, tx: number, ty: number): void {
    if (!say) return;
    let w = this.words.find((x) => x.life <= 0);
    if (!w && this.words.length < 3) {
      const t = this.scene.add
        .text(0, 0, '', {
          fontFamily: 'Nunito, sans-serif',
          fontSize: '30px',
          fontStyle: '800',
          color: '#ffffff',
          stroke: '#2a1c10',
          strokeThickness: 7,
        })
        .setOrigin(0.5, 1);
      w = { t, life: 0 };
      this.words.push(w);
    }
    w ??= this.words.reduce((a, b) => (a.life < b.life ? a : b));
    w.life = WORD_LIFE;
    w.t
      .setText(say)
      .setPosition(tx * T, ty * T)
      .setDepth(90560)
      .setAlpha(1)
      .setScale(0.6)
      .setVisible(true);
  }

  /** An item icon pops out, then hops to the hero. */
  popItem(item: string, x: number, y: number, n = 1): void {
    const count = Math.min(4, Math.max(1, n));
    for (let i = 0; i < count; i++) {
      const f = frameFor(this.scene, item, 48, 48);
      const b = this.bit(f.key, f.frame, x, y);
      const size = Math.max(b.img.width, b.img.height) || 48;
      b.img.setScale(34 / size);
      b.vx = (Math.random() - 0.5) * 220;
      b.vy = -260 - Math.random() * 120;
      b.g = 900;
      b.life = b.max = 0.75 + i * 0.07;
      b.home = true;
    }
  }

  play(id: string, tx: number, ty: number, n = 0, item?: string): void {
    const x = tx * T;
    const y = ty * T;
    switch (id) {
      case 'hit':
        this.burst(
          'fx_sq',
          x,
          y - 30,
          7,
          item?.includes('rock') || item?.includes('boulder')
            ? [0x9a9aa6, 0x6e6e78, 0xc8c8d2]
            : [0x8a5a2e, 0xc79a5a, 0x5da048],
          240,
          0.45,
          { g: 900, up: 160, scale: 0.7 },
        );
        break;
      case 'hitmob':
        this.burst('fx_star', x, y - 50, 6, [0xffffff, 0xffe680], 260, 0.3, { scale: 0.6 });
        // a small knock-back puff at the feet
        this.burst('fx_soft', x, y - 6, 3, 0xf2f2f2, 80, 0.35, { up: 20, scale: 0.6, grow: 0.9 });
        break;
      case 'light':
        this.light(x, y);
        break;
      case 'shardburst': {
        const ring = this.bit('fx_ring', undefined, x, y - 60);
        ring.img.setTint(0xfff3b0).setScale(0.2).setBlendMode(Phaser.BlendModes.ADD).setDepth(90600);
        ring.grow = 7;
        ring.life = ring.max = 0.7;
        this.play('shards', tx, ty - 1);
        this.burst('fx_star', x, y - 70, 18, [0xfff3b0, 0xffffff, 0xffd24a, 0xffb3d1], 300, 1.1, {
          up: 160,
          g: 260,
          scale: 0.7,
        });
        break;
      }
      case 'bossburst': {
        const ring = this.bit('fx_ring', undefined, x, y - 60);
        ring.img.setTint(0xffffff).setScale(0.3).setDepth(90600);
        ring.grow = 8;
        ring.life = ring.max = 0.55;
        this.burst('fx_star', x, y - 80, 22, [0xffd24a, 0xffffff, 0xff8fa6, 0x9ad8ff], 420, 0.9, {
          up: 120,
          g: 300,
          scale: 0.8,
        });
        // a few small warm puffs, not a white cloud over her (package 53a)
        this.burst('fx_soft', x, y - 40, 6, [0xfff3b0, 0xffe9a0], 220, 0.6, { up: 50, scale: 0.8, grow: 1.1 });
        break;
      }
      case 'questdone':
        this.burst('fx_star', x, y - 120, 12, [0xffd24a, 0xffffff, 0xfff3b0], 260, 0.9, {
          up: 140,
          g: 300,
          scale: 0.6,
        });
        break;
      case 'cast':
        this.burst('fx_soft', x, y - 60, 4, 0xe8f4ff, 120, 0.35, { up: 40, scale: 0.5, grow: 0.8 });
        break;
      case 'night':
        this.burst('fx_star', x, y - 160, 10, [0x9ad8ff, 0xd9c2ff, 0xffffff], 160, 1.4, { up: 40, scale: 0.35 });
        break;
      case 'dawn':
        this.burst('fx_dot', x, y - 100, 12, [0xffe9a0, 0xffd27a, 0xffffff], 180, 1.3, { up: 70, scale: 0.25 });
        break;
      case 'zzz':
        this.burst('fx_dot', x, y - 120, 6, [0xd9c2ff, 0xffffff], 50, 1.6, { up: 70, scale: 0.3 });
        break;
      case 'puff':
      case 'spawn':
        this.burst('fx_soft', x, y - 30, 9, id === 'spawn' ? 0x55506a : 0xf2f2f2, 110, 0.6, {
          up: 40,
          scale: 1.1,
          grow: 1.2,
        });
        break;
      case 'footstep': {
        // Footsteps are small ground-level puffs, behind the whole cast even when she walks back towards them.
        const size = Math.max(0.55, Math.min(1.25, (n || 128) / 128));
        this.burst('fx_soft', x, y + 1, 3, item === 'snow' ? 0xf4f8ff : 0xd8c8a8, 25 * size, 0.3, {
          up: 4 * size,
          scale: 0.2 * size,
          grow: 0.12 * size,
          depth: GROUND,
        });
        break;
      }
      case 'sand':
        // package 71: a scoop of sand flies up and falls back (a few bits, as the dust puff)
        this.burst('fx_soft', x, y - 10, 6, [0xe8cf8a, 0xd9b870, 0xf2e0a8], 120, 0.55, {
          up: 170,
          g: 520,
          scale: 0.42,
        });
        break;
      case 'dust':
      case 'place':
        this.burst('fx_soft', x, y - 6, 6, 0xd8c8a8, 90, 0.45, { up: 30, scale: 0.7, grow: 0.8 });
        break;
      case 'pop':
      case 'pickup':
      case 'giveitem':
        if (item) this.popItem(item, x, y - 24, n || 1);
        break;
      case 'craft':
        this.burst('fx_star', x, y - 70, 8, [0xffe680, 0xffffff, 0xffb347], 200, 0.5, { up: 80, scale: 0.6 });
        if (item) this.popItem(item, x, y - 80, 1);
        break;
      case 'sparkle':
        this.burst('fx_star', x, y - 30, 8 + n, [0xfff3b0, 0xffffff, 0xffd24a], 190, 0.7, { up: 70, scale: 0.6 });
        break;
      case 'heart':
        this.burst('fx_heart', x, y - 20, 3 + n, [0xff5a7a, 0xff8fa6], 60, 0.9, { up: 110, scale: 0.7 });
        break;
      case 'confetti':
        this.burst('fx_sq', x, y - 60, 34, [0xff5a5a, 0xffd24a, 0x5ac8ff, 0x7be37b, 0xc78bff, 0xffffff], 360, 1.3, {
          g: 620,
          up: 300,
          scale: 0.8,
        });
        break;
      case 'emote':
        this.burst('fx_star', x, y - 110, 6, [0xfff3b0, 0xff8fa6, 0x9ad8ff], 150, 0.7, { up: 60, scale: 0.6 });
        break;
      case 'hitsleft': {
        const t = (this.leftT ??= this.scene.add
          .text(0, 0, '', {
            fontFamily: 'Nunito, sans-serif',
            fontSize: '30px',
            fontStyle: '800',
            color: '#ffffff',
            stroke: '#2a1c10',
            strokeThickness: 7,
          })
          .setOrigin(0.5, 1)
          .setDepth(90570));
        t.setText(`${n} left`)
          .setPosition(x, y - 120)
          .setAlpha(1)
          .setVisible(true);
        this.leftLife = 0.9;
        break;
      }
      case 'ouch':
        this.burst('fx_star', x, y - 60, 5, 0xff5a5a, 230, 0.35, { scale: 0.7 });
        break;
      case 'warn': {
        const b = this.bit('fx_bang', undefined, x, y - 150);
        b.img.setTint(0xff3b3b).setScale(1.2);
        b.life = b.max = 0.5;
        b.vy = -30;
        break;
      }
      case 'calm':
        this.burst('fx_heart', x, y - 110, 2, 0x7be37b, 40, 0.8, { up: 80, scale: 0.6 });
        break;
      case 'boom': {
        const size = n || 2;
        const ring = this.bit('fx_ring', undefined, x, y - 30);
        ring.img.setTint(0xfff3b0).setScale(0.3);
        ring.grow = 5 * size;
        ring.life = ring.max = 0.45;
        this.burst('fx_soft', x, y - 30, 22, [0xffffff, 0xffe9a0, 0xcfcfcf, 0x9a9a9a], 330 * Math.sqrt(size / 2), 0.9, {
          up: 60,
          scale: 1.6,
          grow: 1.5,
        });
        this.burst('fx_sq', x, y - 30, 16, [0x5da048, 0x3a783e, 0x8a5a2e], 420, 0.8, { g: 800, up: 220, scale: 0.8 });
        break;
      }
      case 'shards':
        for (let i = 0; i < 7; i++) {
          const b = this.bit('fx_star', undefined, x, y);
          const a = (i / 7) * Math.PI * 2 + 0.3;
          b.vx = Math.cos(a) * 720;
          b.vy = Math.sin(a) * 520 - 120;
          b.life = b.max = 1.3;
          b.spin = 700;
          b.img.setTint(0xfff3b0).setScale(1.3);
        }
        break;
      case 'rubble':
        this.burst('fx_sq', x, y - 20, 16, [0x9a9aa6, 0x6e6e78], 300, 0.7, { g: 900, up: 240, scale: 0.9 });
        break;
      case 'block':
        this.burst('fx_star', x, y - 90, 4, 0xbcd4ff, 160, 0.3, { scale: 0.6 });
        break;
      case 'blink':
        this.burst('fx_sq', x, y - 80, 12, [0xb44cff, 0x7a2bd4], 160, 0.6, { up: 40, scale: 0.5 });
        break;
      case 'fishjump': {
        // package 74 (I9): a fish comes up for the bread, one after another (n), and drops back with a ring
        const fish = item ?? 'goldfish';
        const jump = () => {
          const ring = this.bit('fx_ring', undefined, x, y);
          ring.img.setTint(0xffffff).setScale(0.12).setAlpha(0.8);
          ring.grow = 0.9;
          ring.life = ring.max = 0.6;
          const f = frameFor(this.scene, fish, 48, 48);
          const b = this.bit(f.key, f.frame, x, y - 10);
          const size = Math.max(b.img.width, b.img.height) || 48;
          b.img.setScale(40 / size);
          b.vx = n % 2 ? -70 : 70;
          b.vy = -330;
          b.g = 900;
          b.spin = n % 2 ? -260 : 260;
          b.life = b.max = 0.72;
        };
        if (n > 0) this.scene.time.delayedCall(n * 240, jump);
        else jump();
        break;
      }
      case 'ripple':
      case 'bite': {
        const ring = this.bit('fx_ring', undefined, x, y);
        ring.img.setTint(0xffffff).setScale(0.12).setAlpha(0.8);
        ring.grow = id === 'bite' ? 1.4 : 0.8;
        ring.life = ring.max = 0.6;
        if (id === 'bite') {
          const b = this.bit('fx_bang', undefined, x, y - 60);
          b.img.setTint(0xffd24a).setScale(1.3);
          b.life = b.max = 0.9;
        }
        break;
      }
      case 'sprout':
        this.burst('fx_sq', x, y - 8, 5, [0x7be37b, 0x5da048], 120, 0.5, { g: 500, up: 170, scale: 0.5 });
        break;
      case 'build':
        for (let i = 0; i < 4; i++)
          this.burst(
            'fx_soft',
            x + (Math.random() - 0.5) * (n || 3) * T,
            y + (Math.random() - 0.5) * 80,
            10,
            [0xe8dcc0, 0xd8c8a8, 0xffffff],
            160,
            1.1,
            { up: 50, scale: 1.8, grow: 1.6 },
          );
        this.burst('fx_star', x, y - 40, 14, [0xffe680, 0xffffff], 320, 0.9, { up: 120, scale: 0.7 });
        break;
      case 'shootingstar': {
        const b = this.bit('fx_star', undefined, x - 500, y - 700);
        b.vx = 900;
        b.vy = 380;
        b.life = b.max = 1.3;
        b.spin = 600;
        b.img.setTint(0xfff3b0).setScale(1.4).setDepth(99990);
        break;
      }
      case 'arrowland': {
        // her arrow lands: a puff of dust and a little bounce of splinters
        this.burst('fx_soft', x, y - 4, 4, 0xd8c8a8, 70, 0.35, { up: 20, scale: 0.5, grow: 0.7 });
        this.burst('fx_sq', x, y - 8, 3, [0x8a5a2e, 0xc79a5a], 140, 0.3, { g: 900, up: 120, scale: 0.4 });
        break;
      }
      case 'hopmark': {
        // where the spider will land: a red spot, and a ring closing in on it until it lands (1.25 s)
        const r = (n || 1.2) * T;
        this.mark('fx_disc', x, y, r, r, 1.25, 0xff4a2a, 0.26, 3);
        this.mark('fx_mark', x, y, r, r, 1.25, 0xff7a4a, 0.75);
        this.mark('fx_mark', x, y, r * 2.6, r, 1.25, 0xffd24a, 1);
        break;
      }
      case 'thump': {
        this.burst('fx_soft', x, y - 10, 12, [0xd8c8a8, 0xbfb29a, 0xf2f2f2], 260, 0.6, { up: 30, scale: 1, grow: 1.4 });
        this.burst('fx_sq', x, y - 10, 8, [0x8a7a5a, 0x6e6e78], 300, 0.5, { g: 900, up: 200, scale: 0.6 });
        const m = this.mark('fx_mark', x, y, 40, 150, 0.4, 0xffffff, 0.8);
        m.out = 0.4;
        break;
      }
      case 'ringmark': {
        // how far the stomp ring will roll: a soft circle at its reach, from the wind-up until the ring stops
        const r = (n || 5.5) * T;
        const life = 1.2 + (n || 5.5) / 3.2 + 0.15;
        this.mark('fx_disc', x, y, r, r, life, 0xff6a4a, 0.13);
        const edge = this.mark('fx_reach', x, y, r * 1.06, r, life, 0xfff3b0, 0.95, 2);
        edge.img.setAngle(Math.random() * 10);
        break;
      }
      case 'dizzy': {
        // the boss opens: a pop of stars round its head (the circling stars stay while it is open)
        const from = this.live.length;
        this.burst('fx_star_edged', x, y - 2.4 * T, 12, [0xffe14a, 0xffffff, 0xfff3b0], 260, 0.7, {
          up: 90,
          scale: 0.7,
        });
        for (let i = from; i < this.live.length; i++) this.live[i]!.img.setDepth(90555);
        break;
      }
      case 'glint': {
        const b = this.bit('fx_star', undefined, x, y);
        b.img
          .setTint(0xdfeaff)
          .setScale(0.25)
          .setBlendMode(Phaser.BlendModes.ADD)
          .setDepth(y + 2000);
        b.grow = 2.6;
        b.spin = 260;
        b.life = b.max = 0.42;
        break;
      }
      default:
        this.burst('fx_dot', x, y - 30, 5, 0xffffff, 120, 0.4, { scale: 0.3 });
    }
  }

  /** A region lights up: a warm wash spreads from her, a gold ring rolls out, and motes drift up across the view. */
  light(x: number, y: number): void {
    if (!this.washImg)
      this.washImg = this.scene.add
        .image(0, 0, 'fx_soft')
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(90600)
        .setVisible(false);
    this.washImg
      .setPosition(x, y - 50)
      .setTint(0xffc860)
      .setVisible(true)
      .setScale(1)
      .setAlpha(0);
    this.washT = this.washMax = 2.2;
    this.washA = this.low ? 0.3 : 0.75;
    const ring = this.bit('fx_ring', undefined, x, y - 50);
    ring.img.setTint(0xffd27a).setScale(0.2).setBlendMode(Phaser.BlendModes.ADD).setDepth(90601);
    ring.grow = 11;
    ring.life = ring.max = 1.3;
    const n = this.low ? 14 : 36;
    for (let i = 0; i < n; i++) {
      const b = this.bit('fx_dot', undefined, x + (Math.random() - 0.5) * 1100, y + (Math.random() - 0.5) * 700);
      b.vx = (Math.random() - 0.5) * 30;
      b.vy = -50 - Math.random() * 90;
      b.life = b.max = 1.6 + Math.random() * 1.2;
      b.img
        .setTint(Math.random() < 0.5 ? 0xffe9a0 : 0xffd27a)
        .setScale(0.16 + Math.random() * 0.2)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(90601);
    }
  }

  update(dt: number): void {
    if (this.paused) return;
    for (const w of this.words) {
      if (w.life <= 0) continue;
      w.life -= dt;
      const k = 1 - Math.max(0, w.life) / WORD_LIFE;
      // pops in, rises, fades over its last third
      w.t.y -= 34 * dt;
      w.t.setScale(Math.min(1, 0.6 + k * 4)).setAlpha(Math.min(1, (Math.max(0, w.life) / WORD_LIFE) * 3));
      if (w.life <= 0) w.t.setVisible(false);
    }
    if (this.leftLife > 0 && this.leftT) {
      this.leftLife -= dt;
      this.leftT.y -= 40 * dt;
      this.leftT.setAlpha(Math.min(1, this.leftLife / 0.3));
      if (this.leftLife <= 0) this.leftT.setVisible(false);
    }
    if (this.washT > 0 && this.washImg) {
      this.washT -= dt;
      const k = 1 - Math.max(0, this.washT) / this.washMax;
      // spreads fast, then lingers and fades
      this.washImg.setScale(1 + 46 * (1 - (1 - k) ** 3)).setAlpha(this.washA * Math.min(1, k * 6) * (1 - k) ** 1.4);
      if (this.washT <= 0) this.washImg.setVisible(false);
    }
    const marks = this.marks;
    for (let i = marks.length - 1; i >= 0; i--) {
      const m = marks[i]!;
      m.life -= dt;
      const k = 1 - Math.max(0, m.life) / m.max;
      // eases in fast, settles slow
      const e = 1 - (1 - k) ** 2;
      m.img.setScale(m.s0 + (m.s1 - m.s0) * e);
      let a = m.a * Math.min(1, (m.max - m.life) / 0.12, Math.max(0, m.life) / m.out);
      if (m.pulse) a *= 0.7 + 0.3 * Math.sin((m.max - m.life) * m.pulse * Math.PI * 2);
      m.img.setAlpha(a);
      if (m.life <= 0) {
        m.img.setVisible(false);
        marks[i] = marks[marks.length - 1]!;
        marks.pop();
        this.markPool.push(m);
      }
    }
    const live = this.live;
    for (let i = live.length - 1; i >= 0; i--) {
      const b = live[i]!;
      b.life -= dt;
      const k = b.life / b.max;
      if (b.home && k < 0.55) {
        // home in on the hero's bag
        const img = b.img;
        img.x += (this.hero.x - img.x) * Math.min(1, dt * 14);
        img.y += (this.hero.y - 50 - img.y) * Math.min(1, dt * 14);
        img.setScale(img.scaleX * (1 - dt * 2.5));
      } else {
        b.vy += b.g * dt;
        b.img.x += b.vx * dt;
        b.img.y += b.vy * dt;
        if (b.grow) b.img.setScale(b.img.scaleX + b.grow * dt);
        if (!b.home) b.img.setAlpha(Math.min(1, k * 2.2));
      }
      if (b.spin) b.img.angle += b.spin * dt;
      if (b.life <= 0) {
        b.img.setVisible(false);
        live[i] = live[live.length - 1]!;
        live.pop();
        this.pool.push(b);
      }
    }
  }
  get count(): number {
    return this.live.length + this.marks.length;
  }
}

// ---------------------------------------------------------------- the boss fights, read from the picture alone

const ORBIT = 3;
/** Seconds between two glints on a closed boss. */
const GLINT_EVERY = 1.6;
const RUNNER_TIME = 1.7;

/**
 * What a boss is doing, drawn on it: stars round its head while it is open ("hit me now"), a glint while it is
 * closed, the King's countdown, the shield over her head when a pillar hides her, the spider running off when the
 * rider gets down, and the stomp ring lingering where it stops. Everything is pooled.
 */
export class BossLook {
  private scene: Phaser.Scene;
  private fx: Fx;
  private stars: Phaser.GameObjects.Image[] = [];
  private starsUsed = 0;
  private num: Phaser.GameObjects.Text | null = null;
  private numN = 0;
  private numAt = 0;
  private numUsed = false;
  private shield: Phaser.GameObjects.Image | null = null;
  private shieldOn = false;
  private shieldT = 0;
  /** a boss she could hide from this frame (its middle) */
  private threat: Mob | null = null;
  private glintT = new Map<number, number>();
  private foot = new Map<number, boolean>();
  private runner: Puppet | null = null;
  private runT = 0;
  private runVx = 0;
  private runVy = 0;
  private runX = 0;
  private runY = 0;
  private runArea = '';
  private rings = new Map<number, { x: number; y: number; r: number; seen: boolean }>();
  private t = 0;

  constructor(scene: Phaser.Scene, fx: Fx) {
    this.scene = scene;
    this.fx = fx;
  }

  /** The art a boss is drawn with: once the rider is off the spider, the skeleton. */
  static art(m: Mob): string | null {
    return m.id === 'spider_jockey' && m.phase % SHIELD === 1 ? 'skeleton' : null;
  }

  /** One boss, after its puppet has been posed for this frame. It sets the boss's tint and swell. */
  mob(g: Game, m: Mob, p: Puppet, x: number, y: number, dt: number): void {
    const spr = p.sprite;
    const top = y - p.height;
    const jockey = m.id === 'spider_jockey';
    // the rider gets down: the spider runs off
    if (jockey) {
      const onFoot = m.phase % SHIELD === 1;
      const was = this.foot.get(m.k);
      if (was === false && onFoot) this.runOff(g, x, y);
      this.foot.set(m.k, onFoot);
      if (!onFoot) {
        // the rider and the runaway spider are ready before they are needed
        wantChar(this.scene, 'skeleton');
        wantChar(this.scene, 'spider');
      }
    }
    const open = m.phase < SHIELD && m.hp > 0;
    const asleep = m.st === 0;
    // tint and swell
    // hit: a white flash for about 2 frames, then a light warm tint while it lasts (a still never shows a white blob)
    if (m.hurtT > HIT_FLASH) spr.setTintFill(0xffffff);
    else if (m.hurtT > 0) spr.setTint(HIT_TINT);
    else if (m.fuse > 0) {
      // the long fuse: he swells and blinks faster and faster
      const k = 1 - Math.min(1, m.fuse / FUSE_TIME);
      if ((this.t * (1 + k * 6.5)) % 1 < 0.3) spr.setTintFill(0xffffff);
      else spr.setTint(0xffd0c0);
      spr.setScale(spr.scaleX * (1 + k * 0.16), spr.scaleY * (1 + k * 0.16));
    } else if (open) spr.setTint(0xfff0c8);
    else if (m.st === WINDUP && Math.floor(this.t * 12) % 2) spr.setTint(WINDUP_TINT);
    else spr.clearTint();
    // open: stars circle its head
    if (open) {
      const rx = Math.max(36, Math.min(70, p.height * 0.3));
      for (let i = 0; i < ORBIT; i++) {
        const a = this.t * 3.2 + (i / ORBIT) * Math.PI * 2;
        const st = this.star(this.starsUsed++);
        const front = Math.sin(a) > 0;
        const sx = x + Math.cos(a) * rx;
        const sy = top + p.height * 0.1 + Math.sin(a) * rx * 0.32;
        // a star that passes over her goes faint, so she is never lost behind them (fun panel 7)
        const onHer = Math.abs(sx - this.fx.hero.x) < 44 && sy > this.fx.hero.y - 140 && sy < this.fx.hero.y + 10;
        st.setPosition(sx, sy)
          // above the night and the cave dark, so the "hit me now" sign is never lost
          .setDepth(front ? 90560 : 90550)
          .setScale(front ? 1 : 0.75)
          .setAngle(this.t * 200 + i * 40)
          .setAlpha(onHer ? 0.3 : front ? 1 : 0.75);
      }
    } else if (!asleep && m.hp > 0) {
      // closed: now and then a cold glint runs over it, like armour
      const left = (this.glintT.get(m.k) ?? GLINT_EVERY * 0.5) - dt;
      if (left <= 0) {
        const w = p.height * 0.28;
        const gx = x + (Math.random() - 0.5) * w;
        const gy = y - p.height * (0.35 + Math.random() * 0.4);
        // never a glint over her face when she is right up against it
        const h = this.fx.hero;
        if (!(Math.abs(gx - h.x) < 56 && gy > h.y - 150 && gy < h.y + 10)) this.fx.play('glint', gx / T, gy / T);
      }
      this.glintT.set(m.k, left <= 0 ? GLINT_EVERY : left);
    }
    // the long fuse: a big countdown over his head, ticking up in pitch
    if (m.fuse > 0) {
      const n = Math.ceil(m.fuse);
      const txt = (this.num ??= this.scene.add
        .text(0, 0, '', {
          fontFamily: 'Fredoka, Nunito, sans-serif',
          fontStyle: '700',
          fontSize: '96px',
          color: '#ffffff',
        })
        .setOrigin(0.5, 1)
        .setStroke('#2a1c10', 14));
      if (n !== this.numN) {
        this.numN = n;
        this.numAt = this.t;
        txt.setText(String(n)).setColor(n <= 2 ? '#ff6a5a' : '#ffd24a');
        Sound.sfx('fusetick', 0.9, 0, 1 + (5 - n) * 0.2);
      }
      const since = this.t - this.numAt;
      const pop = 1 + 0.55 * Math.max(0, 1 - since / 0.25);
      // on his chest, and never up under the banners: he is tall and she is often well below him
      const view = this.scene.cameras.main.worldView;
      const ny = Math.max(view.y + 300, Math.min(view.bottom - 20, y - p.height * 0.35));
      txt.setVisible(true).setPosition(x, ny).setScale(pop).setDepth(90500);
      this.numUsed = true;
    }
    // something she can hide from right now
    const foot = jockey && m.phase % SHIELD === 1;
    if (
      (m.id === 'creeper_king' && (m.fuse > 0 || (m.phase % SHIELD === 1 && (m.st === WINDUP || m.st === STRIKE)))) ||
      (foot && (m.st === CHASE || m.st === WINDUP || m.st === STRIKE))
    )
      this.threat = m;
  }

  private star(i: number): Phaser.GameObjects.Image {
    let s = this.stars[i];
    if (!s) this.stars.push((s = this.scene.add.image(0, 0, 'fx_star_edged').setTint(0xffe14a)));
    return s.setVisible(true);
  }

  private runOff(g: Game, x: number, y: number): void {
    this.runner?.destroy();
    const tall = g.c.mobs.spider?.tall ?? 1.1;
    this.runner = new Puppet(this.scene, 'spider', tall * 1.4);
    let dx = x / T - g.s.x;
    let dy = y / T - g.s.y;
    const d = Math.hypot(dx, dy) || 1;
    dx /= d;
    dy /= d;
    // mostly sideways, so it scuttles across the view and away
    const sx = Math.abs(dx) < 0.3 ? (dx < 0 ? -1 : 1) : Math.sign(dx);
    this.runVx = sx * 8.5 * T;
    this.runVy = dy * 2 * T;
    this.runX = x;
    this.runY = y;
    this.runT = RUNNER_TIME;
    this.runArea = g.s.area;
    Sound.sfx('skitter', 0.8);
  }

  /** Once a frame, after every mob: her shield, the runaway spider, the rings, and hiding what nobody used. */
  end(g: Game, hx: number, hy: number, heroH: number, dt: number): void {
    this.t += dt;
    for (let i = this.starsUsed; i < this.stars.length; i++) this.stars[i]!.setVisible(false);
    this.starsUsed = 0;
    if (!this.numUsed && this.num?.visible) {
      this.num.setVisible(false);
      this.numN = 0;
    }
    this.numUsed = false;
    // the shield: a pillar is between her and the danger
    const m = this.threat;
    this.threat = null;
    const safe = !!m && !m.gone && m.area === g.s.area && sheltered(g, m.x, m.y);
    if (safe && !this.shieldOn) {
      this.shieldT = 0;
      Sound.sfx('gate', 0.5, 0, 1.4);
    }
    this.shieldOn = safe;
    if (safe) {
      this.shieldT += dt;
      const sh = (this.shield ??= this.scene.add.image(0, 0, 'fx_shield').setOrigin(0.5, 1));
      const pop = 1 + 0.5 * Math.max(0, 1 - this.shieldT / 0.2);
      sh.setVisible(true)
        .setPosition(hx, hy - heroH - 18 + Math.sin(this.t * 4) * 4)
        .setScale(0.85 * pop)
        .setDepth(90500);
    } else this.shield?.setVisible(false);
    // the runaway spider
    if (this.runner) {
      this.runT -= dt;
      if (this.runT <= 0 || g.s.area !== this.runArea) {
        this.runner.destroy();
        this.runner = null;
      } else {
        this.runX += this.runVx * dt;
        this.runY += this.runVy * dt;
        this.runner.setPos(this.runX, this.runY);
        this.runner.play('walk', this.runVx < 0 ? 'left' : 'right');
        this.runner.setAlpha(Math.min(1, this.runT / 0.35));
        this.runner.update(dt);
      }
    }
    // the stomp rings: a soft whoosh as one rolls out, and it lingers where it stops
    for (const r of this.rings.values()) r.seen = false;
    for (const sh of g.rt.shots) {
      if (sh.kind !== 'ring' || sh.area !== g.s.area) continue;
      const r = this.rings.get(sh.k);
      if (!r) {
        this.rings.set(sh.k, { x: sh.x * T, y: sh.y * T, r: sh.r * T, seen: true });
        Sound.sfx('ringroll', 0.8);
      } else {
        r.r = sh.r * T;
        r.seen = true;
      }
    }
    for (const [k, r] of this.rings)
      if (!r.seen) {
        if (r.r > T) this.fx.ringEnd(r.x, r.y, r.r);
        this.rings.delete(k);
      }
  }
}

/**
 * The marks of the action (phase 2, part E and D): a creeper's blast ring on the ground for the whole fuse (outside
 * it she is safe), a slow "z" over a mob that dozes because enough are already after her, and the arrows she has
 * left, by her feet, while a fight is on.
 */
export class ActionMarks {
  private scene: Phaser.Scene;
  private fx: Fx;
  private discs: Phaser.GameObjects.Image[] = [];
  private edges: Phaser.GameObjects.Image[] = [];
  private used = 0;
  private zT = new Map<number, number>();
  private icon: Phaser.GameObjects.Image;
  private count: Phaser.GameObjects.Text;
  private shown = 0;
  private t = 0;

  constructor(scene: Phaser.Scene, fx: Fx) {
    this.scene = scene;
    this.fx = fx;
    this.icon = scene.add.image(0, 0, '__DEFAULT').setVisible(false).setDepth(90500);
    this.count = scene.add
      .text(0, 0, '', {
        fontFamily: 'Nunito, sans-serif',
        fontSize: '26px',
        fontStyle: 'bold',
        color: '#ffffff',
        stroke: '#2a2030',
        strokeThickness: 6,
      })
      .setOrigin(0, 0.5)
      .setVisible(false)
      .setDepth(90501);
  }

  begin(dt: number): void {
    this.used = 0;
    this.t += dt;
  }

  /** The blast ring round a fusing creeper: radius r in pixels, k from 0 (fuse lit) to 1 (boom). */
  ring(x: number, y: number, r: number, k: number): void {
    const i = this.used++;
    let disc = this.discs[i];
    let edge = this.edges[i];
    if (!disc) this.discs.push((disc = this.scene.add.image(0, 0, 'fx_disc').setDepth(GROUND)));
    if (!edge) this.edges.push((edge = this.scene.add.image(0, 0, 'fx_reach').setDepth(GROUND + 1)));
    // it pulses, and faster as the fuse runs down
    const pulse = 0.5 + 0.5 * Math.sin(this.t * (10 + k * 14));
    disc
      .setVisible(true)
      .setPosition(x, y)
      .setScale(r / 60)
      .setTint(0xff3b2a)
      .setAlpha(0.14 + 0.16 * pulse + 0.1 * k);
    edge
      .setVisible(true)
      .setPosition(x, y)
      .setScale((r / 240) * (1 + 0.03 * pulse))
      .setTint(k > 0.66 ? 0xff7a5a : 0xfff3b0)
      .setAlpha(0.75 + 0.25 * pulse)
      .setAngle(this.t * 20);
  }

  /** A dozing mob: a slow puff of z over its head. */
  doze(k: number, x: number, y: number, dt: number): void {
    const left = (this.zT.get(k) ?? 0.4) - dt;
    if (left <= 0) this.fx.play('zzz', x / T, y / T);
    this.zT.set(k, left <= 0 ? 1.8 : left);
  }

  end(): void {
    for (let i = this.used; i < this.discs.length; i++) {
      this.discs[i]!.setVisible(false);
      this.edges[i]!.setVisible(false);
    }
  }

  /**
   * Her arrows, by her feet: shown while a fight is near or for a while after a shot, so she never has to open the
   * bag to know. `frame` is the arrow's item picture.
   */
  arrows(
    n: number,
    show: boolean,
    x: number,
    y: number,
    frame: { key: string; frame?: string | number },
    dt: number,
  ): void {
    this.shown = show ? 1 : Math.max(0, this.shown - dt * 2.5);
    if (this.shown <= 0) {
      this.icon.setVisible(false);
      this.count.setVisible(false);
      return;
    }
    if (this.icon.texture.key !== frame.key || (frame.frame !== undefined && this.icon.frame.name !== frame.frame))
      this.icon.setTexture(frame.key, frame.frame);
    this.icon
      .setVisible(true)
      .setDisplaySize(34, 34)
      .setPosition(x - 22, y + 22)
      .setAlpha(this.shown);
    const text = 'x' + n;
    if (this.count.text !== text) this.count.setText(text);
    this.count
      .setVisible(true)
      .setPosition(x - 2, y + 22)
      .setColor(n === 0 ? '#ff8a7a' : '#ffffff')
      .setAlpha(this.shown);
  }
}
