// Draws the mini-game that is running (g.rt.mini) over the world. One small drawing routine per game.
// The rules (src/core/minigames.ts) move everything; this file only paints it, scaled from the game's own units.
import type Phaser from 'phaser';
import {
  CART,
  CLAW,
  CLAW_PRIZES,
  type Course,
  cartStretch,
  HIDE,
  KEEPY,
  miniPraise,
  PUDDLES,
  RACE,
  SNOW,
  TARGETS,
  targetSide,
} from '../../core/minigames.ts';
import type { Dir, Game, MiniRt } from '../../core/types.ts';
import { cast } from '../../core/talk.ts';
import { art } from '../assets.ts';
import { Sound } from '../audio.ts';
import { touchState } from '../input.ts';
import { Puppet } from '../puppet.ts';
import type { UI } from '../scenes/UI.ts';
import { CUP_NAME, makeCupTextures } from './cups.ts';
import { GOLD, GREEN, H, icon, INK, outlined, panel, RED, SOFT, setIcon, text, title, type Txt, W } from './kit.ts';
import {
  arrow,
  bushBlob,
  cloud,
  easeBack,
  fence,
  flag,
  gem,
  Glider,
  hills,
  keyCapG,
  lantern,
  leaf,
  rock,
  sky,
  snowPile,
  star,
  sun,
  tree,
} from './minidraw.ts';

type Gfx = Phaser.GameObjects.Graphics;
type Img = Phaser.GameObjects.Image;

/** Draw order on the UI layer: backdrop, moving ground, props, characters, things in front, words, the card on top. */
const D = { back: 20, mid: 20.2, icon: 20.4, pup: 21, front: 22, text: 23, over: 24, card: 25 };
/** The school friends: they hide and throw snowballs when nobody else is the host. */
const FRIENDS = ['robin', 'sam', 'alex', 'charlie'];
/** Who hides, by who she is playing with: a character she spoke to, or the game post she started at. */
const HIDERS: Record<string, string[]> = {
  pando: ['sula', 'pando', 'coco'],
  robin: FRIENDS,
  joey_post: ['joey', 'joey', 'joey'],
  king_post: ['creeper', 'creeper', 'creeper'],
};
/** The hiding places, by the same host: a lawn, the bush by the treehouse, the King's rocky garden. */
const SPOTS: Record<string, string[]> = {
  '': ['bush', 'slide', 'barrel', 'hay_bale', 'crate', 'log_hollow', 'sandbox', 'tree_stump', 'kennel', 'well'],
  joey_post: ['fern', 'log_hollow', 'bush', 'tree_stump', 'stick_pile', 'boulder', 'bush', 'hay_bale', 'fern'],
  king_post: ['boulder', 'cracked_rock', 'thorn_bush', 'crate', 'rim_rock', 'barrel', 'stalagmite', 'rock', 'bush'],
};
/** Who she races at each game post (a host she spoke to races her himself). */
const RIVALS: Record<string, string> = {
  sheep_post: 'sheep',
  pond_race_post: 'duck',
  crater_race_post: 'creeper',
  heeler_race_post: 'bluey',
};
/** Drawn smaller or bigger than their art: the little creepers are little, and the small animals must be seen. */
const SMALL: Record<string, number> = { creeper: 0.62, joey: 1.5, duck: 1.6, sheep: 1.15 };
/** The happy clip of someone who has no cheer drawn. */
const glad = (who: string): string =>
  who === 'creeper' ? 'calm' : who === 'joey' || who === 'sheep' || who === 'duck' ? 'hop' : 'cheer';
/** Hide and seek lawn: pixels a cell, and its top left corner. */
const HC = 130;
const HOX = (W - HIDE.w * HC) / 2;
const HOY = 228;
/** Race: pixels a step of the course. */
const RS = 90;
/** Archery (package 47a): pixels a tile of the clearing, and its top left corner. */
const TS = 108;
const TOX = (W - TARGETS.w * TS) / 2;
const TOY = 96;

interface Part {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  r: number;
  color: number;
}
interface PupSlot {
  p: Puppet;
  frame: number;
  /** seconds since this slot was last asked to walk, and the way it walked */
  walkT: number;
  walkDir: Dir;
  /** walk, or run in the races (package 58) */
  walkClip: string;
}
/**
 * Seconds a walker keeps walking after a frame that asks for idle. The rules step 60 times a second but the screen may
 * draw more often (120 Hz) or skip a step: on a frame with no step nothing moved, and without this hold the walker
 * would flash its front-facing idle pose between walk frames, which reads as a ghost.
 */
const WALK_HOLD = 0.1;
type Obj = MiniRt['objs'][number];
/** The rules' step, in milliseconds (the same STEP the world uses to find how far into a step the frame is). */
const STEP_MS = 1000 / 60;
interface SnowRec {
  slot: number;
  born: number;
  hit: number;
  frame: number;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export class MiniView {
  private ui: UI;
  private cur: MiniRt | null = null;
  private shown = false;
  private t = 0;
  private frame = 0;
  // layers
  private back: Gfx;
  private mid: Gfx;
  private front: Gfx;
  private over: Gfx;
  private overKey = '';
  private overTouch = false;
  // words
  private head: Txt;
  private score: Txt;
  private oops: Txt;
  private name: Txt;
  private how: Txt;
  private bestLabel: Txt;
  private go: Txt;
  private done: Txt;
  private newBest: Txt;
  private well: Txt;
  private banner: Txt;
  private bannerT = 0;
  private press: Txt;
  private prizeName: Txt;
  private labels: Txt[] = [];
  private labelN = 0;
  private labelSize: number[] = [];
  // pictures
  private bigStars: Img[] = [];
  private smallStars: Img[] = [];
  private prizeImg: Img;
  /** package 47b: the cup this go is played for (intro card) or won (result card), and its name */
  private cupImg: Img;
  private cupName: Txt;
  /** the word on a key picture drawn in a game (hide and seek's Space by the place she can look in) */
  private capT: Txt;
  private icons: Img[] = [];
  private iconN = 0;
  private pups = new Map<string, PupSlot>();
  private parts: Part[] = [];
  // what the rules looked like last frame, to spot hits, misses and moves
  private prev: number[] = new Array<number>(16).fill(0);
  private prevScore = 0;
  // per-game memory
  private hx = 0;
  private hy = 0;
  private hdir: Dir = 'down';
  private rx = 0;
  private ry = 0;
  private rdir: Dir = 'right';
  private squashT = 0;
  private oopsT = 0;
  private oopsX = 0;
  private cheerT = 0;
  private shakeT = 0;
  private popped = 0;
  private clawBase = 0;
  private splashAt: number[] = [];
  private foundAt: number[] = [];
  private emptyAt: number[] = [];
  private hideRound = 0;
  private movedT = 0;
  private readyT = 0;
  // the race camera (in steps of the course) and its calls
  private camX = 0;
  private camY = 0;
  private camNew = true;
  /** the rules' clock when the race camera last moved: it moves only when the runners do */
  private camT = 0;
  private raceLap = 0;
  private shortT = 0;
  private zoomT = 0;
  private goT = 0;
  // the minecart's view: tipped down the dip and up the climb, and how dark it is
  private pitch = 0;
  private dark = 0;
  private snowHit = new WeakSet<object>();
  private plusT = 0;
  private plusX = 0;
  private plusY = 0;
  /** the lap or round line under the score */
  private stage: Txt;
  private snow = new Map<object, SnowRec>();
  private snowSlots: boolean[] = [false, false, false, false, false];
  private snowNext = 0;
  /** archery: when each target came up, and which ones have burst already */
  private popAt = new WeakMap<object, number>();
  private shotAt = -1;
  /** where a hint points in this game (src/game/ui/hintview.ts): the thing to use the key on, else above her head */
  spotX = 0;
  spotY = 0;
  /** the key line (fun panel 7): up for the first seconds of play and again after a miss */
  private keyG: Gfx;
  private keyWords: Txt[] = [];
  private keyCaps: Txt[] = [];
  private keyStr = '';
  /** the words of the key line in use now */
  private keyOn: Txt[] = [];
  private playT = 0;
  private missT = 0;
  private missN = 0;
  private flyN = 0;
  /** fishing's one line while the float waits for a bite (drawn here: this view already runs every frame) */
  private fishLine: Txt;
  private fishTouch = false;
  // package 75 (D78): things the rules move 60 times a second are drawn between their last two steps, as the world is
  private gl = new Glider();
  private lastT = 0;

  constructor(ui: UI) {
    this.ui = ui;
    const sc = ui;
    this.back = sc.add.graphics().setDepth(D.back).setScrollFactor(0);
    this.mid = sc.add.graphics().setDepth(D.mid).setScrollFactor(0);
    this.front = sc.add.graphics().setDepth(D.front).setScrollFactor(0);
    this.over = sc.add.graphics().setDepth(D.over).setScrollFactor(0);
    this.head = outlined(sc, 48, 30, '', 46).setDepth(D.text);
    this.score = outlined(sc, W - 48, 26, '', 58)
      .setOrigin(1, 0)
      .setDepth(D.text);
    this.stage = outlined(sc, W - 48, 100, '', 40)
      .setOrigin(1, 0)
      .setDepth(D.text);
    this.oops = outlined(sc, 0, 0, '', 40).setOrigin(0.5).setDepth(D.text);
    this.name = title(sc, 1020, 262, '', 84).setOrigin(0.5, 0).setDepth(D.card);
    this.how = text(sc, 1020, 392, '', 42, INK, 880).setOrigin(0.5, 0).setAlign('center').setDepth(D.card);
    this.bestLabel = text(sc, 1010, 740, '', 36, SOFT).setOrigin(1, 0.5).setDepth(D.card);
    this.go = outlined(sc, W / 2, 880, '', 52)
      .setOrigin(0.5)
      .setDepth(D.card);
    this.done = title(sc, 1020, 246, '', 96).setOrigin(0.5, 0).setDepth(D.card);
    this.newBest = outlined(sc, 1020, 668, '', 38).setOrigin(0.5).setDepth(D.card);
    this.well = text(sc, 1020, 590, '', 40, INK, 1000).setOrigin(0.5, 0).setAlign('center').setDepth(D.card);
    this.banner = outlined(sc, W / 2, 330, '', 92)
      .setOrigin(0.5)
      .setDepth(D.text);
    this.press = outlined(sc, W / 2, 880, '', 52)
      .setOrigin(0.5)
      .setDepth(D.card);
    this.prizeName = text(sc, 1420, 580, '', 32, SOFT).setOrigin(0.5, 0).setDepth(D.card);
    for (let i = 0; i < 3; i++) {
      this.bigStars.push(sc.add.image(0, 0, 'ui_starbig').setDepth(D.card).setScrollFactor(0));
      this.smallStars.push(
        sc.add
          .image(1060 + i * 70, 740, 'ui_starbig')
          .setDepth(D.card)
          .setScrollFactor(0),
      );
    }
    this.prizeImg = icon(sc, 'toy_block', 1420, 480, 150).setDepth(D.card);
    makeCupTextures(sc);
    this.cupImg = sc.add.image(1420, 520, 'ui_cup1').setDepth(D.card).setScrollFactor(0);
    this.cupName = text(sc, 1420, 610, '', 34, INK).setOrigin(0.5, 0).setDepth(D.card);
    this.capT = title(sc, 0, 0, 'Space', 28, INK).setOrigin(0.5).setDepth(D.text).setVisible(false);
    this.keyG = sc.add.graphics().setDepth(D.text).setScrollFactor(0).setVisible(false);
    this.fishLine = outlined(sc, W / 2, H - 175, '', 40)
      .setOrigin(0.5)
      .setDepth(D.text)
      .setVisible(false);
    for (let i = 0; i < 64; i++) this.parts.push({ x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, r: 6, color: 0xffffff });
    this.setAll(false);
  }

  private get g(): Game {
    return this.ui.g;
  }

  // ---------------------------------------------------------------- drawing between rules steps (package 75)

  /**
   * Called once a frame before anything is drawn: how many rules steps ran since the last frame (the game's own clock
   * says so) and how far into the next step this frame is (the world scene keeps that, and draws walking by it too).
   */
  private beginFrame(m: MiniRt): void {
    const dm = m.t - this.lastT;
    this.lastT = m.t;
    const ticks = dm === 0 ? 0 : dm > 0 ? Math.max(1, Math.round(dm * 60)) : 1;
    const w = this.ui.scene.get('World') as unknown as { acc?: number } | undefined;
    const acc = typeof w?.acc === 'number' ? w.acc : 0;
    this.gl.begin(ticks, this.g.rt.paused ? 1 : acc / STEP_MS);
  }

  /** A number kept in the game's list of numbers (hero x, the balloon, the camera): drawn between the last two steps. */
  private sm(name: string, v: number, jump = 1): number {
    return this.gl.num(name, v, jump);
  }

  /** A field of one of the game's things (an arrow, a ball, a target that slides). */
  private so(o: Obj, key: 'x' | 'y' | 'a', jump = 1): number {
    return this.gl.field(o, key, o[key], jump);
  }

  /** For tools/bot/smooth.ts: by name, what was drawn this frame and the rules' value at the last step and before it. */
  probe(): { frame: number; v: Record<string, [number, number, number]> } {
    return this.gl.probe();
  }

  /** Called every frame. Shows itself while a mini-game runs and hides when it ends. */
  update(dt: number): void {
    this.drawFishLine();
    const m = this.g.rt.mini;
    if (!m) {
      if (this.shown) this.setAll(false);
      this.cur = null;
      return;
    }
    if (m !== this.cur) this.setup(m);
    this.t += dt;
    this.frame++;
    this.beginFrame(m);
    this.iconN = 0;
    this.labelN = 0;
    this.mid.clear();
    this.front.clear();
    this.capT.setVisible(false);
    switch (m.game) {
      case 'keepy':
        this.keepy(m, dt);
        break;
      case 'puddles':
        this.puddles(m, dt);
        break;
      case 'hide':
        this.hide(m, dt);
        break;
      case 'race':
        this.race(m, dt);
        break;
      case 'claw':
        this.claw(m, dt);
        break;
      case 'snowball':
        this.snowball(m, dt);
        break;
      case 'minecart':
        this.minecart(m, dt);
        break;
      case 'targets':
        this.targets(m, dt);
        break;
      default:
        break;
    }
    this.findSpot(m);
    this.drawParts(dt);
    this.drawWords(m, dt);
    this.drawKeyLine(m, dt);
    this.endFrame();
    for (let i = 0; i < this.prev.length; i++) this.prev[i] = m.n[i] ?? 0;
    this.prevScore = m.score;
  }

  // ---------------------------------------------------------------- shared plumbing

  private setAll(v: boolean): void {
    this.shown = v;
    for (const o of [this.back, this.mid, this.front, this.over, this.head, this.score, this.stage]) o.setVisible(v);
    if (!v) {
      for (const o of [
        this.oops,
        this.name,
        this.how,
        this.bestLabel,
        this.go,
        this.done,
        this.newBest,
        this.well,
        this.banner,
        this.press,
        this.prizeName,
        this.prizeImg,
        this.cupImg,
        this.cupName,
        this.capT,
        this.keyG,
        ...this.keyWords,
        ...this.keyCaps,
      ])
        o.setVisible(false);
      for (const o of [...this.bigStars, ...this.smallStars, ...this.icons, ...this.labels]) o.setVisible(false);
      for (const s of this.pups.values()) s.p.destroy();
      this.pups.clear();
      this.overKey = '';
    }
  }

  private setup(m: MiniRt): void {
    this.cur = m;
    this.gl.clear();
    this.lastT = m.t;
    this.setAll(true);
    this.overKey = '';
    for (let i = 0; i < this.prev.length; i++) this.prev[i] = m.n[i] ?? 0;
    this.prevScore = m.score;
    for (const p of this.parts) p.life = 0;
    this.squashT = this.oopsT = this.cheerT = this.shakeT = 0;
    this.popped = 0;
    this.hdir = 'down';
    this.splashAt = m.objs.map(() => -1);
    this.foundAt = new Array<number>(16).fill(-1);
    this.emptyAt = new Array<number>(16).fill(-1);
    this.hideRound = 0;
    this.movedT = this.readyT = this.shortT = this.zoomT = this.goT = this.plusT = this.bannerT = 0;
    this.playT = this.missT = this.missN = this.flyN = 0;
    this.camNew = true;
    this.raceLap = 0;
    this.pitch = this.dark = 0;
    this.back.setPosition(0, 0);
    this.snow.clear();
    this.snowSlots.fill(false);
    this.clawBase = this.g.s.counts.clawWon ?? 0;
    if (m.game === 'hide') {
      this.hx = HOX + (m.n[0]! + 0.5) * HC;
      this.hy = HOY + (m.n[1]! + 0.5) * HC + 50;
    }
    this.head.setText(cap(this.g.c.strings['mini:' + m.game] ?? m.game));
    this.paintBack(m.game, m.host);
  }

  /** The art set for a character, as the world uses it (Christmas outfits when the layer is on). */
  private artOf(id: string): string {
    return this.g.s.xmas && art.chars.sets[id + '_xmas'] ? id + '_xmas' : id;
  }

  /** Places an animated character with its feet at (x, y). k is pixels per tile of height, so tall people stay taller. */
  private actor(
    id: string,
    slot: number,
    x: number,
    y: number,
    k: number,
    clip: string,
    dir: Dir,
    dt: number,
    depth: number = D.pup,
    restart = false,
  ): Puppet {
    const key = this.artOf(id);
    const pk = key + '#' + slot;
    let s = this.pups.get(pk);
    if (!s) {
      const tall = this.g.c.chars[id]?.tall ?? art.chars.sets[key]?.tall ?? 2;
      s = { p: new Puppet(this.ui, key, tall, true), frame: 0, walkT: WALK_HOLD, walkDir: 'down', walkClip: 'walk' };
      this.pups.set(pk, s);
    }
    if (s.frame !== this.frame - 1) s.walkT = WALK_HOLD;
    s.frame = this.frame;
    if (clip === 'walk' || clip === 'run') {
      s.walkT = 0;
      s.walkDir = dir;
      s.walkClip = clip;
    } else if (clip === 'idle' && s.walkT < WALK_HOLD) {
      clip = s.walkClip;
      dir = s.walkDir;
    }
    s.walkT += dt;
    const p = s.p;
    p.zoom = Math.max(0.02, k / 64);
    p.play(clip, dir, restart);
    p.setPos(x, y);
    p.update(dt);
    p.sprite.setDepth(depth).setAngle(0).setAlpha(1);
    p.setVisible(true);
    if (slot === 0 && id === this.g.s.hero) {
      this.spotX = x;
      this.spotY = y - k * 2.4;
    }
    return p;
  }

  /**
   * The thing a hint marks: in hide and seek the place where the nearest friend still hides, in Keepy Uppy the
   * balloon. Every other game marks her (the key is pressed where she is).
   */
  private findSpot(m: MiniRt): void {
    const n = m.n;
    if (m.game === 'hide') {
      let bd = 1e9;
      for (const o of m.objs) {
        if (!o.vx || o.k !== 0) continue;
        const d = Math.abs(o.x - n[0]!) + Math.abs(o.y - n[1]!);
        if (d >= bd) continue;
        bd = d;
        this.spotX = HOX + (o.x + 0.5) * HC;
        this.spotY = HOY + (o.y + 0.5) * HC - 6;
      }
    } else if (m.game === 'keepy') {
      this.spotX = 210 + n[1]! * (1500 / KEEPY.w);
      this.spotY = 250 + n[2]! * 100 - 46;
    }
  }

  private img(name: string, x: number, y: number, size: number): Img {
    let im = this.icons[this.iconN];
    if (!im) {
      im = icon(this.ui, name, x, y, size).setDepth(D.icon);
      this.icons.push(im);
    } else setIcon(this.ui, im, name, size);
    this.iconN++;
    return im.setPosition(x, y).setAngle(0).setAlpha(1).setVisible(true);
  }

  private label(str: string, x: number, y: number, size = 30): Txt {
    let t = this.labels[this.labelN];
    if (!t) {
      t = outlined(this.ui, x, y, str, size).setOrigin(0.5).setDepth(D.text);
      this.labels.push(t);
    }
    // (labels are shared between uses, so each use sets its own size and stands upright again)
    if (this.labelSize[this.labelN] !== size) {
      this.labelSize[this.labelN] = size;
      t.setFontSize(size);
    }
    this.labelN++;
    if (t.text !== str) t.setText(str);
    return t.setPosition(x, y).setScale(1).setAlpha(1).setAngle(0).setVisible(true);
  }

  private endFrame(): void {
    for (let i = this.iconN; i < this.icons.length; i++) if (this.icons[i]!.visible) this.icons[i]!.setVisible(false);
    for (let i = this.labelN; i < this.labels.length; i++)
      if (this.labels[i]!.visible) this.labels[i]!.setVisible(false);
    // (a puppet still waiting for its pictures is not visible yet but must still be told to stay hidden)
    for (const s of this.pups.values()) if (s.frame !== this.frame) s.p.setVisible(false);
  }

  private burst(x: number, y: number, count: number, color: number, speed: number, color2 = color): void {
    let made = 0;
    for (const p of this.parts) {
      if (made >= count) break;
      if (p.life > 0) continue;
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.4 + Math.random() * 0.6);
      p.x = x;
      p.y = y;
      p.vx = Math.cos(a) * v;
      p.vy = Math.sin(a) * v - speed * 0.6;
      p.max = p.life = 0.5 + Math.random() * 0.4;
      p.r = 5 + Math.random() * 7;
      p.color = made % 2 ? color2 : color;
      made++;
    }
  }

  private drawParts(dt: number): void {
    const f = this.front;
    for (const p of this.parts) {
      if (p.life <= 0) continue;
      p.life -= dt;
      p.vy += 1100 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      f.fillStyle(p.color, Math.max(0, p.life / p.max)).fillCircle(p.x, p.y, p.r);
    }
  }

  private shake(amount: number): void {
    if (!this.g.s.opts.lowFx) this.ui.cameras.main.shake(220, amount);
  }

  private shadow(x: number, y: number, w: number): void {
    this.mid.fillStyle(0x000000, 0.2).fillEllipse(x, y + 2, w, w * 0.26);
  }

  /** The direction of a move, by its bigger part. */
  private dirOf(dx: number, dy: number, was: Dir): Dir {
    if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return was;
    if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? 'left' : 'right';
    return dy < 0 ? 'up' : 'down';
  }

  // ---------------------------------------------------------------- intro, score line and result card

  private drawWords(m: MiniRt, dt: number): void {
    const S = this.g.c.strings;
    const st = m.st;
    const key = m.game + ':' + st;
    // the card's words name the touch buttons on an iPad, so they are written again when the touch layer comes or goes
    // (issues 19 and 21)
    const touch = touchState.shown;
    if (key !== this.overKey || touch !== this.overTouch) {
      this.overTouch = touch;
      this.how.setText((touch && S['touch_how:' + m.game]) || (S['how:' + m.game] ?? ''));
      this.go.setText((touch ? S.touch_mini_go : S.mini_go) ?? 'Press Space to start');
      this.press.setText((touch ? S.touch_mini_press : S.mini_press) ?? '');
    }
    if (key !== this.overKey) {
      this.overKey = key;
      this.over.clear();
      if (st !== 1) {
        this.over.fillStyle(0x10131f, 0.5).fillRect(0, 0, W, H);
        panel(this.over, 340, 220, 1240, 590);
      }
      this.popped = 0;
      this.name.setText(cap(S['mini:' + m.game] ?? m.game));
      this.done.setText((m.why && S[m.why]) || (S.mini_done ?? 'Well done!'));
      this.bestLabel.setText(S.mini_best ?? 'Your best');
      this.newBest.setText(S.mini_new_best ?? '');
      this.well.setText(st === 2 ? (S[miniPraise(m)] ?? '') : '');
    }
    // the score line
    const sc = m.game === 'claw' || st === 0 ? '' : `${m.score} of ${m.goal}`;
    if (this.score.text !== sc) this.score.setText(sc);
    // the line under the score: which round, lap, wave, part, try or stretch it is; Keepy Uppy says when the wind
    // picks up. Every change is also called out big in the middle of the screen for a moment.
    let sg = '';
    if (st === 1) {
      const n = m.n;
      const of3 = (key: string, v: number) => (S[key] ?? '').replace('{n}', String(Math.min(3, v + 1)));
      if (m.game === 'race') sg = of3('mini_lap', n[6] ?? 0);
      else if (m.game === 'hide') sg = of3('mini_round', n[5] ?? 0);
      else if (m.game === 'snowball') sg = of3('mini_wave', n[4] ?? 0);
      else if (m.game === 'targets') sg = of3('mini_round', n[4] ?? 0);
      else if (m.game === 'puddles') sg = n[4] ? '' : of3('mini_part', n[11] ?? 0);
      else if (m.game === 'claw') sg = of3('mini_try', n[4] ?? 0);
      else if (m.game === 'minecart') sg = S[['mini_dip', 'mini_tunnel', 'mini_climb'][n[7] ?? 0]!] ?? '';
      else if (m.game === 'keepy' && m.score >= 10) sg = S.mini_windy ?? '';
    }
    if (this.stage.text !== sg) {
      this.stage.setText(sg);
      if (sg) {
        this.tweens(this.stage);
        this.banner.setText(sg);
        this.bannerT = 1.7;
      }
    }
    this.bannerT = Math.max(0, this.bannerT - dt);
    this.banner
      .setVisible(st === 1 && this.bannerT > 0)
      .setAlpha(Math.min(1, this.bannerT * 2.5))
      .setScale(0.6 + 0.4 * easeBack((1.7 - this.bannerT) / 0.3));
    this.head.setVisible(st !== 0);
    const intro = st === 0;
    const result = st === 2;
    this.name.setVisible(intro);
    this.how.setVisible(intro);
    this.go.setVisible(intro && m.t > 0.3).setScale(1 + Math.sin(this.t * 5) * 0.05);
    this.done.setVisible(result);
    this.press.setVisible(result && m.t > 0.8).setScale(1 + Math.sin(this.t * 5) * 0.05);
    // a cup go's start card shows only the cup she plays for: "your best" stars beside it would not match it (53a)
    const bestOn = result || (intro && !(m.cup > 0));
    this.bestLabel.setVisible(bestOn);
    this.newBest.setVisible(result && m.stars > m.best && m.t > 1.5);
    this.well.setVisible(result && m.t > 0.4 + m.stars * 0.4);
    const best = result ? Math.max(m.best, this.g.s.stars[m.game] ?? 0) : m.best;
    for (let i = 0; i < 3; i++) {
      const s = this.smallStars[i]!;
      s.setVisible(bestOn).setScale(0.8);
      if (i < best) s.clearTint().setAlpha(1);
      else s.setTint(0x6a5a4a).setAlpha(0.45);
    }
    // the cheering hero on the card
    if (intro || result) this.actor(this.g.s.hero, 9, 480, 780, 165, result ? 'cheer' : 'wave', 'down', dt, D.card);
    // big stars that pop in one by one
    const prize = result && m.game === 'claw' && !!m.msg;
    const cx = prize ? 930 : 1020;
    for (let i = 0; i < 3; i++) {
      const s = this.bigStars[i]!;
      if (!result) {
        s.setVisible(false);
        continue;
      }
      const x = cx + (i - 1) * 190;
      const y = i === 1 ? 465 : 495;
      const base = 170 / 72;
      if (i < m.stars) {
        const k = (m.t - (0.3 + i * 0.4)) / 0.3;
        s.setVisible(k > 0)
          .clearTint()
          .setAlpha(1)
          .setPosition(x, y)
          .setScale(base * easeBack(k))
          .setAngle((1 - Math.min(1, k)) * -30);
        if (k > 0 && this.popped <= i) {
          this.popped = i + 1;
          Sound.sfx('sparkle', 0.8);
        }
      } else
        s.setVisible(true)
          .setTint(0x6a5a4a)
          .setAlpha(0.45)
          .setPosition(x, y)
          .setScale(base * 0.8)
          .setAngle(0);
    }
    this.drawCup(m, intro, result, prize);
    this.prizeImg.setVisible(prize);
    this.prizeName.setVisible(prize);
    if (prize) {
      setIcon(this.ui, this.prizeImg, m.msg, 150);
      this.prizeImg.setPosition(1420, 470 + Math.sin(this.t * 3) * 6);
      const nm = cap(this.g.c.items[m.msg]?.name ?? '');
      if (this.prizeName.text !== nm) this.prizeName.setText(nm);
    }
  }

  /**
   * The key line (fun panel 7): one small line under the game's name, such as "[Space] Jump". It stays for the first
   * 10 seconds of play and comes back for 3 seconds after each miss, then fades.
   */
  private drawKeyLine(m: MiniRt, dt: number): void {
    if (m.st !== 1) {
      this.setKeyLine(0);
      return;
    }
    this.playT += dt;
    if (this.missed(m)) this.missT = 3;
    this.missT = Math.max(0, this.missT - dt);
    const str = this.g.c.strings['keys:' + m.game] ?? '';
    if (str !== this.keyStr) this.layKeyLine(str);
    this.setKeyLine(Math.min(1, Math.max(10 - this.playT, this.missT) / 0.4));
  }

  /** Whether she just missed: the balloon fell, a puddle passed by, a wrong look, a bump, a throw or a shot gone wide. */
  private missed(m: MiniRt): boolean {
    const n = m.n;
    const p = this.prev;
    switch (m.game) {
      case 'keepy':
        return n[5]! > p[5]!;
      case 'puddles': {
        const c = m.objs.filter((o) => o.a === 2).length;
        const was = this.missN;
        this.missN = c;
        return c > was;
      }
      case 'hide':
        return n[3]! > p[3]!;
      case 'race':
        return n[10] !== 0 && p[10] === 0;
      case 'claw':
        return n[1] === 3 && p[1] !== 3;
      case 'minecart':
        return n[3]! > p[3]!;
      case 'snowball':
      case 'targets': {
        // a snowball or an arrow went away and the score did not go up
        const c = m.objs.filter((o) => o.k === 1).length;
        const gone = c < this.flyN && m.score === this.prevScore;
        this.flyN = c;
        return gone || (m.game === 'snowball' && n[7]! > p[7]!);
      }
      default:
        return false;
    }
  }

  /** Lays out the key line once: key pictures from {left}, {Space} and the like, and the words between them. */
  private layKeyLine(str: string): void {
    this.keyStr = str;
    const g = this.keyG.clear();
    for (const t of [...this.keyWords, ...this.keyCaps]) t.setVisible(false);
    this.keyOn = [];
    let x = 48;
    const y = 132;
    const h = 44;
    let nw = 0;
    let nc = 0;
    for (const part of str.split(/(\{[^}]+\})/)) {
      if (!part) continue;
      const tok = /^\{(.+)\}$/.exec(part)?.[1];
      if (tok && ['up', 'down', 'left', 'right'].includes(tok)) {
        keyCapG(g, x + 24, y, tok, 48, h);
        x += 54;
      } else if (tok) {
        let t = this.keyCaps[nc];
        if (!t) {
          t = title(this.ui, 0, 0, '', 24, INK)
            .setOrigin(0.5)
            .setDepth(D.text + 0.01);
          this.keyCaps.push(t);
        }
        nc++;
        t.setText(tok);
        const w = Math.max(48, t.width + 30);
        keyCapG(g, x + w / 2, y, '', w, h);
        t.setPosition(x + w / 2, y - 3);
        this.keyOn.push(t);
        x += w + 6;
      } else {
        const word = part.trim();
        if (!word) continue;
        let t = this.keyWords[nw];
        if (!t) {
          t = outlined(this.ui, 0, 0, '', 30).setOrigin(0, 0.5).setDepth(D.text);
          this.keyWords.push(t);
        }
        nw++;
        t.setText(word).setPosition(x + 6, y);
        this.keyOn.push(t);
        x += t.width + 34;
      }
    }
  }

  /** Shows the key line at this strength (0 hides it). */
  private setKeyLine(a: number): void {
    const on = a > 0 && !!this.keyStr;
    this.keyG.setVisible(on).setAlpha(a);
    for (const t of this.keyOn) t.setVisible(on).setAlpha(a);
  }

  /** Fishing: while the line is out and nothing has bitten yet, how to catch one. */
  private drawFishLine(): void {
    const f = this.g.rt.fish;
    const on = this.g.rt.mode === 'fishing' && !!f && f.st <= 1;
    // on an iPad it names the Catch button, not Space (issue 21)
    if (this.fishTouch !== touchState.shown) {
      this.fishTouch = touchState.shown;
      this.fishLine.setText('');
    }
    if (on && !this.fishLine.text) {
      const S = this.g.c.strings;
      this.fishLine.setText((this.fishTouch ? S.touch_fish_wait : S.fish_wait) ?? '');
    }
    if (this.fishLine.visible !== on) this.fishLine.setVisible(on);
  }

  /**
   * Package 47b: the cup on the card. The intro shows the cup this go is played for; the result shows the cup won,
   * popping in after the stars, or the same cup dim when this go did not win it.
   */
  private drawCup(m: MiniRt, intro: boolean, result: boolean, prize: boolean): void {
    const tier = result ? m.cupWon || m.cup : m.cup;
    const on = tier > 0 && (intro || (result && m.t > 0.4 + m.stars * 0.4));
    this.cupImg.setVisible(on);
    this.cupName.setVisible(on);
    if (!on) return;
    const won = result && m.cupWon > 0;
    const x = result && prize ? 640 : 1420;
    const k = result ? Math.min(1, (m.t - (0.4 + m.stars * 0.4)) / 0.35) : 1;
    this.cupImg
      .setTexture('ui_cup' + tier)
      .setPosition(x + (result ? 0 : 20), (result ? 470 : 690) + (won ? Math.sin(this.t * 3) * 6 : 0))
      .setScale((won ? 1.6 : result ? 1.3 : 1) * (result ? easeBack(k) : 1))
      .setAlpha(result && !won ? 0.45 : 1);
    const name = `${cap(CUP_NAME[tier] ?? '')} cup${won ? '!' : ''}`;
    if (this.cupName.text !== name) this.cupName.setText(name);
    this.cupName.setPosition(x + (result ? 0 : 20), result ? 560 : 752);
  }

  /** A little bounce when the lap or round line changes. */
  private tweens(t: Txt): void {
    this.ui.tweens.killTweensOf(t);
    this.ui.tweens.add({ targets: t, scale: { from: 1.35, to: 1 }, duration: 320, ease: 'Back.easeOut' });
  }

  /** The race rival: the game post's own runner, or whoever challenged her if they have a walk to run with; else the race host. */
  private rival(): string {
    const raw = this.g.rt.mini?.host ?? '';
    const h = RIVALS[raw] ? cast(this.g, RIVALS[raw]!) : this.g.c.chars[raw] ? raw : '';
    const set = h ? art.chars.sets[this.artOf(h)] : undefined;
    return h && h !== this.g.s.hero && set?.clips.walk ? h : cast(this.g, 'sam');
  }

  // ---------------------------------------------------------------- backdrops (painted once per game)

  private paintBack(game: string, host: string): void {
    const b = this.back;
    b.clear();
    if (game === 'keepy') {
      sky(b, 0, 0, W, H, 0x7cc4f4, 0xd8f1ff);
      sun(b, 1700, 170, 70);
      cloud(b, 420, 170, 1);
      cloud(b, 1180, 120, 0.8);
      cloud(b, 1480, 270, 0.6);
      b.fillStyle(0x9fdc7c, 1).fillRect(0, 690, W, 400);
      tree(b, 170, 780, 1.7);
      tree(b, 1000, 760, 1.15, 0x5cbf60);
      tree(b, 1790, 780, 1.5);
      fence(b, -20, W + 40, 820, 120);
      b.fillStyle(0x7cc85a, 1).fillRect(0, 820, W, 260);
      for (let i = 0; i < 5; i++) b.fillStyle(0x86d26a, 1).fillRect(0, 838 + i * 52, W, 24);
      for (let i = 0; i < 36; i++) {
        const x = (i * 263 + 40) % W;
        const y = 850 + ((i * 97) % 210);
        b.fillStyle([0xffffff, 0xffd24a, 0xff8ab0][i % 3]!, 1).fillCircle(x, y, 6);
        b.fillStyle(0xffe066, 1).fillCircle(x, y, 2.5);
      }
    } else if (game === 'puddles') {
      sky(b, 0, 0, W, H, 0x8fcff6, 0xe8f6ff);
      sun(b, 1560, 160, 64);
      cloud(b, 300, 150, 0.9);
      cloud(b, 900, 220, 0.7);
      cloud(b, 1300, 110, 0.6);
      hills(b, 640, 0xb8e4a4, 2, 120, 0.4);
    } else if (game === 'hide') {
      // a lawn; by the treehouse it is leafier, and in the King's garden it is stone
      const tone =
        host === 'king_post'
          ? { field: 0x8f9a86, dot: 0x838e7a, edge: 0x6a6a5a, rim: 0xb9b4a0, a: 0xcfcab6, b: 0xc3bea9 }
          : host === 'joey_post'
            ? { field: 0x6fbf5a, dot: 0x62b04e, edge: 0x4a7a2e, rim: 0xb6d98a, a: 0xd3e9a6, b: 0xc6df96 }
            : { field: 0x7cc85a, dot: 0x6fb84e, edge: 0x5a3a1e, rim: 0xe2c88a, a: 0xf3e0ad, b: 0xead39a };
      b.fillStyle(tone.field, 1).fillRect(0, 0, W, H);
      for (let i = 0; i < 60; i++) b.fillStyle(tone.dot, 1).fillCircle((i * 331) % W, (i * 173) % H, 10 + (i % 4) * 4);
      tree(b, 110, 520, 1.2);
      tree(b, 100, 1000, 1.1, 0x5cbf60);
      tree(b, 1815, 560, 1.3);
      tree(b, 1820, 1010, 1.1);
      bushBlob(b, 1800, 300, 1);
      bushBlob(b, 110, 260, 0.9);
      b.fillStyle(tone.edge, 0.35).fillRoundedRect(HOX - 18, HOY - 14, HIDE.w * HC + 36, HIDE.h * HC + 36, 34);
      b.fillStyle(tone.rim, 1).fillRoundedRect(HOX - 20, HOY - 20, HIDE.w * HC + 40, HIDE.h * HC + 40, 34);
      for (let y = 0; y < HIDE.h; y++)
        for (let x = 0; x < HIDE.w; x++)
          b.fillStyle((x + y) % 2 ? tone.a : tone.b, 1).fillRoundedRect(
            HOX + x * HC + 3,
            HOY + y * HC + 3,
            HC - 6,
            HC - 6,
            16,
          );
      // the base, where she counts
      const bx = HOX + (HIDE.home[0] + 0.5) * HC;
      const by = HOY + (HIDE.home[1] + 0.5) * HC;
      b.lineStyle(8, 0xffffff, 0.8).strokeCircle(bx, by, HC * 0.4);
      star(b, bx, by, HC * 0.22, 0xffffff);
    } else if (game === 'race') {
      // the whole park, twice the size of the screen: the race view slides this picture under the runners
      const s = RS;
      b.fillStyle(0x7cc85a, 1).fillRect(-300, -300, RACE.w * s + 600, RACE.h * s + 600);
      for (let i = 0; i < 150; i++)
        b.fillStyle(0x6fb84e, 1).fillCircle((i * 389) % (RACE.w * s), (i * 211) % (RACE.h * s), 10 + (i % 3) * 6);
      for (let i = 0; i < 70; i++) {
        const x = (i * 613 + 90) % (RACE.w * s);
        const y = (i * 347 + 60) % (RACE.h * s);
        b.fillStyle([0xffffff, 0xffd24a, 0xff8ab0][i % 3]!, 1).fillCircle(x, y, 6);
        b.fillStyle(0xffe066, 1).fillCircle(x, y, 2.5);
      }
      const lane = (pts: [number, number][], closed: boolean, half: number, color: number) => {
        b.fillStyle(color, 1);
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i]!;
          b.fillCircle(a[0] * s, a[1] * s, half * s);
          if (!closed && i === pts.length - 1) break;
          const c = pts[(i + 1) % pts.length]!;
          const len = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
          const nx = (-(c[1] - a[1]) / len) * half * s;
          const ny = ((c[0] - a[0]) / len) * half * s;
          b.fillPoints(
            [
              { x: a[0] * s + nx, y: a[1] * s + ny },
              { x: c[0] * s + nx, y: c[1] * s + ny },
              { x: c[0] * s - nx, y: c[1] * s - ny },
              { x: a[0] * s - nx, y: a[1] * s - ny },
            ],
            true,
          );
        }
      };
      const long: Course = RACE.laps[0]!;
      const cut: [number, number][] = [
        [21, 15.5],
        [11, 15.5],
      ];
      lane(long.pts, true, RACE.half + 0.12, 0xc9a464);
      lane(cut, false, RACE.half + 0.12, 0xc9a464);
      lane(cut, false, RACE.half, 0xdcc48c);
      lane(long.pts, true, RACE.half, 0xecd29a);
      // the pond in the middle of the park, and a small one inside the loop
      const pond = (x: number, y: number, w: number, h: number) => {
        b.fillStyle(0x8a7a5a, 1).fillRoundedRect(
          (x - w / 2) * s - 14,
          (y - h / 2) * s - 14,
          w * s + 28,
          h * s + 28,
          60,
        );
        b.fillStyle(0x3a90d0, 1).fillRoundedRect((x - w / 2) * s, (y - h / 2) * s, w * s, h * s, 50);
        b.fillStyle(0x6ac0f0, 1).fillRoundedRect(
          (x - w / 2) * s + 20,
          (y - h / 2) * s + 16,
          w * s - 40,
          h * s - 40,
          40,
        );
        for (const [lx, ly] of [
          [0.2, 0.35],
          [0.7, 0.6],
          [0.45, 0.7],
        ] as [number, number][]) {
          b.fillStyle(0x3f9a45, 1).fillCircle((x - w / 2 + w * lx) * s, (y - h / 2 + h * ly) * s, 20);
          b.fillStyle(0xff8ab0, 1).fillCircle((x - w / 2 + w * lx) * s + 6, (y - h / 2 + h * ly) * s - 6, 7);
        }
      };
      for (const [px, py, pw, ph] of RACE.ponds) pond(px, py, pw, ph);
      for (const [x, y, k] of [
        [8, 9.6, 1.3],
        [6.6, 12.2, 1.1],
        [9.6, 12.6, 1.2],
        [24, 9.6, 1.3],
        [25.6, 12.2, 1.1],
        [22.6, 12.6, 1.2],
        [1, 2, 1.2],
        [31, 2.4, 1.2],
        [0.9, 16.6, 1.2],
        [31, 16.8, 1.3],
        [16, 0.9, 1.1],
      ] as [number, number, number][])
        tree(b, x * s, y * s, k, (x * 7) % 2 > 1 ? 0x5cbf60 : 0x4caf50);
      // start and finish line
      const sx0 = long.pts[0]![0] * s;
      const sy0 = (long.pts[0]![1] - RACE.half) * s;
      for (let i = 0; i < 16; i++)
        for (let j = 0; j < 2; j++)
          b.fillStyle((i + j) % 2 ? 0x222222 : 0xffffff, 1).fillRect(
            sx0 + j * 14 - 14,
            sy0 + (i * RACE.half * 2 * s) / 16,
            14,
            (RACE.half * 2 * s) / 16,
          );
    } else if (game === 'claw') {
      sky(b, 0, 0, W, H, 0x4a2a7a, 0x22163e);
      for (let i = 0; i < 26; i++)
        b.fillStyle([0xff6a6a, 0xffd24a, 0x7be37b, 0x9ad8ff][i % 4]!, 1).fillCircle(
          i * 78 + 20,
          70 + Math.sin(i * 0.9) * 18,
          9,
        );
      b.fillStyle(0x2e2050, 1).fillRect(0, 980, W, 100);
      for (let i = 0; i < 24; i++) b.fillStyle(0x3a2a60, 1).fillRect(i * 80 + (i % 2) * 40, 1000, 40, 80);
      const s = 95;
      const X = (u: number) => 640 + u * s;
      const Y = (v: number) => 290 + v * s;
      b.fillStyle(0x3b1a2a, 1).fillRoundedRect(X(-0.7) - 8, Y(-1.7) - 8, 11.4 * s + 16, 1100 - Y(-1.7), 30);
      b.fillStyle(0xe24a5a, 1).fillRoundedRect(X(-0.7), Y(-1.7), 11.4 * s, 1100 - Y(-1.7), 26);
      b.fillStyle(0xffd24a, 1).fillRoundedRect(X(0.4), Y(-1.5), 9.2 * s, 0.95 * s, 20);
      for (let i = 0; i < 7; i++) star(b, X(1.1 + i * 1.3), Y(-1.03), 26, [0xff6a6a, 0x9ad8ff, 0x7be37b][i % 3]!);
      b.fillStyle(0x1e2a4a, 1).fillRect(X(0), Y(-0.3), 10 * s, 7.3 * s);
      b.fillStyle(0x9ad8ff, 0.12).fillRect(X(0), Y(-0.3), 10 * s, 7.3 * s);
      // the pile the prizes sit on
      for (let i = 0; i < 46; i++)
        b.fillStyle([0xff6a6a, 0xffd24a, 0x7be37b, 0x9ad8ff, 0xd9c2ff][i % 5]!, 1).fillCircle(
          X(0.3 + ((i * 0.613) % 9.4)),
          Y(6.55 + ((i * 37) % 7) / 10),
          24,
        );
      b.fillStyle(0x9aa0b0, 1).fillRect(X(0), Y(0.42) - 7, 10 * s, 14);
      // the chute the prize drops down
      b.fillStyle(0xffd24a, 1).fillRoundedRect(X(0.12), Y(5.5), 1.56 * s, 1.6 * s, 14);
      b.fillStyle(0x10131f, 1).fillRoundedRect(X(0.24), Y(5.62), 1.32 * s, 1.5 * s, 10);
      b.fillStyle(0xffd24a, 1).fillTriangle(X(0.55), Y(6.1), X(1.25), Y(6.1), X(0.9), Y(6.6));
      // control panel
      b.fillStyle(0xb8323f, 1).fillRect(X(-0.7), Y(7.05), 11.4 * s, 0.6 * s);
      b.fillStyle(0x222222, 1).fillCircle(X(2), Y(7.35), 22);
      b.fillStyle(0xff3a3a, 1).fillCircle(X(2), Y(7.35) - 30, 18);
      b.fillStyle(0x22aa44, 1).fillCircle(X(5), Y(7.35), 26);
    } else if (game === 'snowball') {
      sky(b, 0, 0, W, H, 0x86b0e8, 0xe6f2ff);
      hills(b, 300, 0xdce9f8, 2, 80, 0.3);
      for (let i = 0; i < 9; i++) {
        const x = 80 + i * 230;
        const y = 300 - (i % 2) * 30;
        b.fillStyle(0x2c6e4a, 1).fillTriangle(x - 50, y, x + 50, y, x, y - 150);
        b.fillStyle(0xffffff, 1).fillTriangle(x - 26, y - 76, x + 26, y - 76, x, y - 150);
      }
      b.fillStyle(0xf4f9ff, 1).fillRect(0, 290, W, 800);
      // the fort line where the friends hide
      for (let i = 0; i < 4; i++) {
        const x = 330 + i * 330;
        b.fillStyle(0xc6dcf2, 1).fillRoundedRect(x, 380, 280, 200, 20);
        b.fillStyle(0xffffff, 1).fillRoundedRect(x + 8, 372, 264, 190, 18);
        for (let j = 0; j < 4; j++) b.fillStyle(0xffffff, 1).fillRect(x + 12 + j * 70, 346, 44, 40);
        b.lineStyle(3, 0xd6e6f6, 1);
        for (let r = 0; r < 3; r++) b.lineBetween(x + 14, 420 + r * 50, x + 266, 420 + r * 50);
      }
      for (let i = 0; i < 40; i++) b.fillStyle(0xdce9f8, 1).fillEllipse((i * 277) % W, 640 + ((i * 89) % 420), 40, 12);
    } else if (game === 'targets') {
      // a clearing among the gum trees: the far bank of trees, a trodden patch in the middle, trees on the flanks
      sky(b, 0, 0, W, H, 0x8cc8ec, 0xe2f3ff);
      b.fillStyle(0x8fc46a, 1).fillRect(0, 150, W, H - 150);
      b.fillStyle(0x7fb25e, 1).fillRect(0, 150, W, 70);
      for (let i = 0; i < 12; i++) tree(b, 40 + i * 168, 210 + (i % 2) * 14, 1.05, i % 3 ? 0x7fa86a : 0x6e9a5c);
      const x0 = TOX + TARGETS.walk.x0 * TS;
      const x1 = TOX + TARGETS.walk.x1 * TS;
      const y0 = TOY + TARGETS.walk.y0 * TS;
      const y1 = TOY + TARGETS.walk.y1 * TS;
      b.fillStyle(0xc9b27c, 0.55).fillRoundedRect(x0 - 30, y0 - 20, x1 - x0 + 60, y1 - y0 + 60, 60);
      for (let i = 0; i < 30; i++)
        b.fillStyle(0x6fa04f, 0.6).fillEllipse((i * 263) % W, 260 + ((i * 97) % 760), 34, 10);
      for (const side of [0, 1]) {
        const x = side ? TOX + TARGETS.side.right * TS + 70 : TOX + TARGETS.side.left * TS - 70;
        tree(b, x, TOY + 3.4 * TS, 1, 0x6e9a5c);
        tree(b, x, TOY + 8.6 * TS, 1.1, 0x7fa86a);
      }
    } else if (game === 'minecart') {
      b.fillStyle(0x0e0a14, 1).fillRect(0, -120, W, 130);
      b.fillGradientStyle(0x0e0a14, 0x0e0a14, 0x2a1e1a, 0x2a1e1a, 1).fillRect(0, 0, W, H);
      // rocky lumps in the roof, some with a crystal; the walls and floor are painted over their lower edge
      for (let i = 0; i < 18; i++) {
        const x = (i * 211) % W;
        const y = 150 + ((i * 131) % 420);
        b.fillStyle(0x241a1e, 1).fillEllipse(x, y, 140, 70);
        if (i % 3 === 0) gem(b, x + 30, y - 4, 10, 0x9ad8ff, 0xffffff);
      }
      b.fillStyle(0x3a2a22, 1).fillPoints(
        [
          { x: 0, y: 1200 },
          { x: 0, y: 760 },
          { x: 900, y: 300 },
          { x: 1020, y: 300 },
          { x: W, y: 760 },
          { x: W, y: 1200 },
        ],
        true,
      );
      b.fillStyle(0x4a3628, 1).fillPoints(
        [
          { x: 160, y: 1200 },
          { x: 910, y: 300 },
          { x: 1010, y: 300 },
          { x: 1760, y: 1200 },
        ],
        true,
      );
      b.fillStyle(0x6a4a3a, 0.6).fillEllipse(960, 296, 150, 70);
      b.fillStyle(0xffd27a, 0.25).fillEllipse(960, 296, 70, 34);
    }
  }

  // ---------------------------------------------------------------- Keepy Uppy

  private keepy(m: MiniRt, dt: number): void {
    const n = m.n;
    const sx = 1500 / KEEPY.w;
    const sy = 100;
    const X = (u: number) => 210 + u * sx;
    const Y = (v: number) => 250 + v * sy;
    const gy = Y(KEEPY.ground);
    // (package 75: what the rules move is drawn between their last two steps)
    const heroU = this.sm('hero.x', n[0]!);
    const ballU = this.sm('balloon.x', n[1]!);
    const ballV = this.sm('balloon.y', n[2]!);
    const helpU = this.sm('helper.x', n[7]!);
    const bx = X(ballU);
    if (m.score > this.prevScore) {
      this.squashT = 0.28;
      this.burst(bx, Y(ballV) - 46, 10, 0xffd24a, 380, 0xffffff);
    }
    if (n[5]! > this.prev[5]!) {
      this.squashT = 0.28;
      this.oopsT = 1.3;
      this.oopsX = bx;
      this.burst(bx, gy, 8, 0x7cc85a, 260, 0xffffff);
    }
    this.squashT = Math.max(0, this.squashT - dt);
    this.oopsT = Math.max(0, this.oopsT - dt);
    // her reach on the grass, so she can see where to stand
    const reach = this.g.s.opts.gentle ? 1.45 : 1.1;
    this.mid.fillStyle(0xffffff, 0.22).fillEllipse(X(heroU), gy + 4, reach * 2 * sx, 34);
    // after 10 hits the wind picks up: streaks blow across the sky
    if (m.score >= 10 && m.st === 1)
      for (let i = 0; i < 7; i++) {
        const wx = ((this.t * (520 + i * 60) + i * 331) % 1900) - 100;
        const wy = 300 + ((i * 97) % 380);
        this.mid.lineStyle(6, 0xffffff, 0.6).lineBetween(wx, wy, wx + 110 + (i % 3) * 40, wy - 8);
        // and a few leaves tumble along with it
        if (i % 2 === 0) leaf(this.mid, wx + 180, wy + 46 + Math.sin(this.t * 5 + i) * 22, 0.8, this.t * 6 + i);
      }
    // the balloon's shadow grows as it comes down
    const high = Math.max(0, Math.min(1, (KEEPY.ground - ballV) / KEEPY.ground));
    this.mid.fillStyle(0x000000, 0.2).fillEllipse(bx, gy + 4, 96 * (1 - high * 0.6), 26 * (1 - high * 0.6));
    // Bandit shuffles under the balloon (or the friend who asked her to play: D69)
    const bm = Math.abs(n[7]! - this.prev[7]!) > 1e-4;
    this.shadow(X(helpU), gy - 8, 140);
    this.actor(
      cast(this.g, m.host === 'charlie' || m.host === 'zoey' ? m.host : 'bandit'),
      0,
      X(helpU),
      gy - 8,
      112,
      m.st === 2 ? 'cheer' : bm ? 'walk' : 'idle',
      bm ? (n[7]! < this.prev[7]! ? 'left' : 'right') : 'down',
      dt,
      D.pup,
    );
    // the hero
    const dx = n[0]! - this.prev[0]!;
    const moving = Math.abs(dx) > 1e-4;
    if (moving) this.hdir = dx < 0 ? 'left' : 'right';
    const swing = n[6]! > 0.1;
    const side: Dir = n[1]! < n[0]! ? 'left' : 'right';
    const clip = m.st === 2 ? 'cheer' : swing ? 'swing' : moving ? 'run' : 'idle';
    const dir: Dir = m.st === 2 ? 'down' : swing ? side : moving ? this.hdir : 'down';
    this.shadow(X(heroU), gy + 10, 120);
    this.actor(this.g.s.hero, 0, X(heroU), gy + 10, 115, clip, dir, dt, D.pup + 0.1, n[6]! > this.prev[6]! + 0.01);
    // the balloon: it glows when a hit would count (the same test the rules use)
    const f = this.front;
    const q = Math.sin((this.squashT / 0.28) * Math.PI) * 0.35;
    const bw = 92 * (1 + q);
    const bh = 106 * (1 - q);
    const by = Y(ballV) - 46;
    const hittable = m.st === 1 && Math.abs(n[0]! - n[1]!) < reach && n[2]! > KEEPY.hitTop && n[4]! > -1;
    if (hittable) f.fillStyle(0xfff3b0, 0.5 + 0.25 * Math.sin(this.t * 14)).fillEllipse(bx, by, bw + 40, bh + 40);
    f.lineStyle(3, 0x5a3a2a, 1);
    f.beginPath();
    f.moveTo(bx, by + bh / 2 + 6);
    for (let i = 1; i <= 6; i++)
      f.lineTo(bx + Math.sin(this.t * 6 + i) * 5 - n[3]! * 5 * (i / 6), by + bh / 2 + 6 + i * 17);
    f.strokePath();
    f.fillStyle(0xb02a34, 1).fillTriangle(bx - 8, by + bh / 2 + 9, bx + 8, by + bh / 2 + 9, bx, by + bh / 2 - 4);
    f.fillStyle(0xb02a34, 1).fillEllipse(bx, by, bw, bh);
    f.fillStyle(0xff4a4a, 1).fillEllipse(bx - 3, by - 4, bw * 0.88, bh * 0.88);
    f.fillStyle(0xffffff, 0.7).fillEllipse(bx - bw * 0.2, by - bh * 0.22, bw * 0.18, bh * 0.28);
    if (this.oopsT > 0) {
      const o = this.label(this.g.c.strings.mini_oops ?? 'Oops!', this.oopsX, gy - 190 - (1.3 - this.oopsT) * 50, 40);
      o.setAlpha(Math.min(1, this.oopsT * 3));
    }
  }

  // ---------------------------------------------------------------- Puddle jump

  private puddles(m: MiniRt, dt: number): void {
    const S = this.g.c.strings;
    const n = m.n;
    const s = 130;
    const hx = 560;
    const gy = 905;
    // (package 75: her place, the jump and the marker are drawn between the rules' steps)
    const n0 = this.sm('run.x', n[0]!, 1.5);
    const jumpT = this.sm('jump.t', n[1]!, 0.1);
    const phaseT = this.sm('phase.t', n[6]!, 0.1);
    const WX = (u: number) => hx + (u - n0) * s;
    const md = this.mid;
    const f = this.front;
    hills(md, 760, 0x9fd88a, 3, 90, n0 * 0.05);
    hills(md, 830, 0x86cc6e, 5, 50, n0 * 0.12);
    md.fillStyle(0x7cc85a, 1).fillRect(0, 830, W, 20);
    md.fillStyle(0x8a5e34, 1).fillRect(0, 846, W, 128);
    md.fillStyle(0xa8794a, 1).fillRect(0, 856, W, 108);
    md.fillStyle(0x7cc85a, 1).fillRect(0, 974, W, 106);
    // tufts and pebbles roll past at her speed
    const step = 1.3;
    for (let k = Math.floor((n0 - 6) / step); k * step < n0 + 13; k++) {
      const x = WX(k * step);
      md.fillStyle(0x5aa83e, 1)
        .fillTriangle(x - 12, 980, x + 12, 980, x, 950)
        .fillTriangle(x + 6, 980, x + 24, 980, x + 18, 958);
      md.fillStyle(0x7a5430, 1).fillEllipse(x + 40, 868 + ((((k * 37) % 50) + 50) % 50) * 1.6, 18, 9);
    }
    // a flag where each new part begins
    for (const at of [n[8]!, n[9]!]) {
      const x = WX(at);
      if (x > -100 && x < W + 100) flag(md, x, 850, 150, GOLD, Math.sin(this.t * 6) * 8);
    }
    // events
    if (m.score > this.prevScore && n[4] === 0) {
      const i = n[2]! - 1;
      const p = m.objs[i];
      if (p) {
        this.splashAt[i] = this.t;
        this.burst(hx, gy, p.k ? 26 : 16, 0x7a5a3a, p.k ? 620 : 460, 0x9ad8ff);
        if (p.k) this.shake(0.008);
      }
    }
    // puddles, and a marker showing where to take off so she lands in the middle
    for (let i = 0; i < m.objs.length; i++) {
      const o = m.objs[i]!;
      const x = WX(o.x);
      if (x < -400 || x > W + 400) continue;
      const win = o.k ? PUDDLES.big : PUDDLES.small;
      const w = win * 2 * s;
      const h = o.k ? 92 : 68;
      md.fillStyle(0x5a3a1e, 1).fillEllipse(x, gy, w + 18, h + 14);
      md.fillStyle(o.k ? 0x5e4228 : 0x76563a, 1).fillEllipse(x, gy, w, h);
      md.fillStyle(0x9ab8d0, 0.5).fillEllipse(x - w * 0.18, gy - h * 0.18, w * 0.4, h * 0.22);
      if (o.a === 1 && this.splashAt[i]! >= 0) {
        const since = this.t - this.splashAt[i]!;
        for (let r = 0; r < 2; r++) {
          const k = (since * 0.8 + r * 0.5) % 1;
          md.lineStyle(4, 0xd8ecff, 1 - k).strokeEllipse(x, gy, w * (0.3 + k * 0.7), h * (0.3 + k * 0.7));
        }
      }
      if (o.a === 0) {
        const tx = WX(o.vx);
        const next = i === n[2];
        const pulse = next ? 0.5 + 0.5 * Math.sin(this.t * 9) : 0;
        md.fillStyle(0xfff3b0, next ? 0.3 + pulse * 0.15 : 0.16).fillRoundedRect(
          tx - win * s,
          900,
          win * 2 * s,
          20,
          10,
        );
        f.fillStyle(0x3b2a1a, 1).fillTriangle(tx - 20, gy + 52, tx + 20, gy + 52, tx, gy + 18);
        f.fillStyle(next ? GOLD : 0xfff3b0, 1).fillTriangle(tx - 13, gy + 47, tx + 13, gy + 47, tx, gy + 25);
      }
    }
    // the big finish puddle, with its run-up line
    const bx = WX(n[10]! + PUDDLES.bigLen);
    const lx = WX(n[10]!);
    if (bx < W + 700) {
      const bw = 5.2 * s;
      md.fillStyle(0x5a3a1e, 1).fillEllipse(bx, gy + 6, bw + 26, 150);
      md.fillStyle(0x5e4228, 1).fillEllipse(bx, gy + 6, bw, 128);
      md.fillStyle(0x9ab8d0, 0.5).fillEllipse(bx - bw * 0.2, gy - 16, bw * 0.36, 30);
      for (let i = 0; i < 6; i++)
        md.fillStyle((i % 2 ? 0x222222 : 0xffffff) as number, 1).fillRect(lx - 9, 856 + i * 18, 18, 18);
      if (n[4] === 3) {
        // she is in: rings roll out and the splash keeps coming
        for (let r = 0; r < 3; r++) {
          const k = (phaseT * 0.9 + r / 3) % 1;
          md.lineStyle(6, 0xd8ecff, 1 - k).strokeEllipse(bx, gy + 6, bw * (0.2 + k * 0.8), 128 * (0.2 + k * 0.8));
        }
      }
    }
    if (n[4] === 2 && this.prev[4] === 1) this.burst(hx, gy, 12, 0xffffff, 380, 0xa8794a);
    if (n[4] === 3 && this.prev[4] === 2) {
      const q = n[7]!;
      this.burst(hx, gy, 20 + q * 12, 0x7a5a3a, 520 + q * 160, 0x9ad8ff);
      this.burst(hx + 60, gy, 10 + q * 6, 0x9ad8ff, 420 + q * 140, 0xffffff);
      this.shake(0.006 + q * 0.004);
      this.cheerT = 1.6;
    }
    if (n[4] === 3 && this.frame % 14 === 0)
      this.burst(hx + Math.sin(this.t * 9) * 120, gy, 5, 0x9ad8ff, 380, 0x7a5a3a);
    // the timing bar: the marker runs along it and green is the place to press
    if (n[4] === 1) {
      const kind = this.g.s.opts.gentle ? 1.3 : 1;
      const x0 = 520;
      const bwid = 880;
      const by = 360;
      f.fillStyle(0x3b2a1a, 1).fillRoundedRect(x0 - 10, by - 10, bwid + 20, 76, 22);
      f.fillStyle(0xff8a6a, 1).fillRoundedRect(x0, by, bwid, 56, 14);
      const zone = (half: number, color: number) =>
        f.fillStyle(color, 1).fillRect(x0 + bwid * (0.5 - half * kind), by, bwid * half * kind * 2, 56);
      zone(PUDDLES.barGood, 0xffd24a);
      zone(PUDDLES.barPerfect, 0x5fd06a);
      star(f, x0 + bwid / 2, by + 28, 20, 0xffffff);
      const mx = x0 + bwid * this.sm('bar.x', n[5]!, 0.2);
      f.fillStyle(0x3b2a1a, 1).fillTriangle(mx - 26, by - 34, mx + 26, by - 34, mx, by + 6);
      f.fillStyle(0xffffff, 1).fillTriangle(mx - 17, by - 30, mx + 17, by - 30, mx, by - 2);
      f.fillStyle(0x3b2a1a, 1).fillRect(mx - 4, by, 8, 56);
      this.label(S.mini_big ?? '', W / 2, 270, 46).setScale(1 + Math.sin(this.t * 6) * 0.03);
    }
    this.cheerT = Math.max(0, this.cheerT - dt);
    if (n[4] === 3 && this.cheerT > 0) {
      const key = n[7]! >= 3 ? 'mini_perfect' : n[7]! >= 2 ? 'mini_good' : 'mini_splash';
      this.label(S[key] ?? '', hx + 40, gy - 330 - (1.6 - this.cheerT) * 40, 72).setAlpha(Math.min(1, this.cheerT * 2));
    }
    // the hero runs, hops and lands
    const big = n[4] === 2;
    const air = n[1]! > 0 || big;
    const p = big ? Math.min(1, phaseT / PUDDLES.bigJump) : 1 - jumpT / PUDDLES.jump;
    const lift = air ? Math.sin(p * Math.PI) * (big ? 330 : 150) : 0;
    this.shadow(hx, gy, 110 * (1 - lift / 500));
    const clip = m.st === 0 || n[4] === 1 ? 'idle' : m.st === 2 || n[4] === 3 ? 'cheer' : air ? 'hop' : 'walk';
    const hero = this.actor(
      this.g.s.hero,
      0,
      hx,
      gy + 4 - lift,
      110,
      clip,
      m.st === 2 || n[4] === 3 ? 'down' : 'right',
      dt,
    );
    if (this.prev[1]! > 0 && !air) hero.bump(0.18);
  }

  // ---------------------------------------------------------------- Hide and seek

  private hide(m: MiniRt, dt: number): void {
    const S = this.g.c.strings;
    const n = m.n;
    const C = HC;
    const round = n[5] ?? 0;
    // a new round: everyone hid again, so nobody is found yet
    if (round !== this.hideRound) {
      this.hideRound = round;
      this.foundAt.fill(-1);
      this.emptyAt.fill(-1);
    }
    const raw = m.host;
    const hiders = HIDERS[raw] ?? FRIENDS;
    const spots = SPOTS[raw] ?? SPOTS['']!;
    const cx = (x: number) => HOX + (x + 0.5) * C;
    const cy = (y: number) => HOY + (y + 0.5) * C;
    const f = this.front;
    const phase = n[6]!;
    // the place Space would look in now; with two in reach the key goes over her head instead, so it never gives
    // away which of them hides a friend (the rules look in that one first)
    // (a place beside her, else one at a corner: the rules' hideLook)
    let look = -1;
    let reach = 0;
    let ring = 1;
    for (let pass = 1; pass <= 2 && reach === 0; pass++)
      for (let i = 0; i < m.objs.length; i++) {
        const o = m.objs[i]!;
        const dx = Math.abs(o.x - n[0]!);
        const dy = Math.abs(o.y - n[1]!);
        if (o.k !== 0 || (pass === 1 ? dx + dy !== 1 : dx !== 1 || dy !== 1)) continue;
        reach++;
        look = i;
        ring = pass;
      }
    if (reach > 1) look = -2;
    for (let i = 0; i < m.objs.length; i++) {
      const o = m.objs[i]!;
      const x = cx(o.x);
      const y = cy(o.y);
      // each cell of the lawn always holds the same thing, round after round
      const cell = HIDE.pool.findIndex((c) => c[0] === o.x && c[1] === o.y);
      const im = this.img(spots[Math.max(0, cell) % spots.length]!, x, y - 6, 122);
      const peeking = phase === 2 && n[8] === i;
      if (peeking) {
        // she is looking in: a rustle, a held breath
        im.setAngle(Math.sin(this.t * 46) * 9);
        this.label('?', x, y - 96, 56).setScale(1 + Math.sin(this.t * 16) * 0.12);
      } else if (o.k === 0 && o.vy > 0) {
        // a giggle out loud: the whole place shakes, and anyone can see it from across the lawn
        im.setAngle(Math.sin(this.t * 40) * 12).setScale(im.scale * (1 + Math.sin(this.t * 20) * 0.06));
        f.lineStyle(6, 0xffffff, 0.5 + 0.4 * Math.sin(this.t * 12)).strokeCircle(x, y - 6, 80 + ((this.t * 90) % 40));
        this.label(S.mini_giggle ?? '', x, y - 104, 40).setAngle(Math.sin(this.t * 9) * 6);
      } else if (o.k === 0 && o.a > 0) {
        // a friend who cannot stop giggling makes the hiding place wiggle
        im.setAngle(Math.sin(this.t * 38) * 7);
        const rise = (this.t * 50) % 40;
        f.fillStyle(0xffffff, 1 - rise / 40).fillCircle(x + 46 + Math.sin(this.t * 6) * 6, y - 66 - rise, 7);
        f.fillStyle(0xffffff, 1 - rise / 40).fillCircle(x - 40 - Math.sin(this.t * 7) * 6, y - 56 - rise * 0.8, 5);
      }
      // the places she could look at from here
      const ox = Math.abs(o.x - n[0]!);
      const oy = Math.abs(o.y - n[1]!);
      if (m.st === 1 && phase === 1 && o.k === 0 && reach > 0 && (ring === 1 ? ox + oy === 1 : ox === 1 && oy === 1))
        f.lineStyle(7, GOLD, 0.55 + 0.4 * Math.sin(this.t * 8)).strokeRoundedRect(
          x - C / 2 + 6,
          y - C / 2 + 6,
          C - 12,
          C - 12,
          18,
        );
      if (m.st === 1 && phase === 1 && i === look) {
        // the key that looks in, on the place it would look in (the same choice the rules make)
        const ky = y - C / 2 - 8 + Math.sin(this.t * 5) * 4;
        keyCapG(f, x, ky, '', 118, 52);
        this.capT.setPosition(x, ky - 4).setVisible(true);
      }
      if (o.k === 1) {
        if (this.emptyAt[i]! < 0) {
          this.emptyAt[i] = this.t;
          this.burst(x, y - 30, 8, 0x7bd36b, 300, 0x2c6e31);
        }
        im.setAlpha(0.6);
        leaf(f, x + 30, y - 36, 1.3, -0.5 + Math.sin(this.t * 2 + i) * 0.12);
        const since = this.t - this.emptyAt[i]!;
        if (since < 1)
          this.label(S.mini_empty ?? '', x, y - 90 - since * 20, 30).setAlpha(Math.min(1, (1 - since) * 3));
      }
      if (o.k === 2) {
        if (this.foundAt[i]! < 0) {
          this.foundAt[i] = this.t;
          this.burst(x, y - 40, 16, 0xffd24a, 520, 0xff8ab0);
        }
        const since = this.t - this.foundAt[i]!;
        const pop = easeBack(since / 0.35);
        const who = hiders[(o.vx - 1 + hiders.length) % hiders.length]!;
        this.shadow(x + 26, y + 52, 90 * pop);
        this.actor(
          who,
          o.vx,
          x + 26,
          y + 52,
          74 * pop * (SMALL[who] ?? 1),
          since < 1.6 ? glad(who) : 'wave',
          'down',
          dt,
          D.pup + y / 10000,
        );
        if (since < 1.1)
          this.label(S.mini_found ?? '', x, y - 104 - since * 16, 38).setAlpha(Math.min(1, (1.1 - since) * 3));
      }
    }
    // round 3: somebody runs for a new place (she sees the start of the dash, not where it ends)
    if (n[11]! > 0 && n[12]! >= 0 && n[13]! >= 0) {
      const a = m.objs[n[12]!]!;
      const b = m.objs[n[13]!]!;
      const p = 1 - this.sm('dash', n[11]!, 0.1);
      const who = hiders[(b.vx - 1 + hiders.length) % hiders.length]!;
      const x = cx(a.x + (b.x - a.x) * p);
      const y = cy(a.y + (b.y - a.y) * p) + 40;
      if (this.frame % 5 === 0) this.burst(x, y, 2, 0xe2c88a, 160, 0xffffff);
      const pup = this.actor(
        who,
        7,
        x,
        y,
        70 * (SMALL[who] ?? 1),
        'walk',
        this.dirOf(b.x - a.x, b.y - a.y, 'right'),
        dt,
        D.pup + y / 10000,
      );
      pup.sprite.setAlpha(Math.max(0, Math.min(1, (0.62 - p) * 5)));
      this.movedT = 2.4;
    }
    this.movedT = Math.max(0, this.movedT - dt);
    if (this.movedT > 0 && phase !== 3)
      this.label(S.mini_moved ?? '', W / 2, 190, 48).setAlpha(Math.min(1, this.movedT * 2));
    // the hero glides from cell to cell
    const tx = cx(n[0]!);
    const ty = cy(n[1]!) + 50;
    if (n[0] !== this.prev[0] || n[1] !== this.prev[1])
      this.hdir = this.dirOf(n[0]! - this.prev[0]!, n[1]! - this.prev[1]!, this.hdir);
    const k = Math.min(1, dt * 14);
    this.hx += (tx - this.hx) * k;
    this.hy += (ty - this.hy) * k;
    const moving = Math.hypot(tx - this.hx, ty - this.hy) > 4;
    const happy = m.st === 2 || phase === 3 || phase === 4;
    this.shadow(this.hx, this.hy, 96);
    this.actor(
      this.g.s.hero,
      0,
      this.hx,
      this.hy,
      72,
      happy ? 'cheer' : moving ? 'walk' : 'idle',
      happy ? 'down' : phase === 0 ? 'up' : !moving ? 'down' : this.hdir,
      dt,
      D.pup + this.hy / 10000,
    );
    // counting at the base, back turned, while everyone hides
    if (m.st === 1 && phase === 0) {
      const left = this.sm('count', n[7]!, 0.1);
      const num = Math.max(1, Math.min(10, Math.floor((HIDE.count - n[7]!) / (HIDE.count / 10)) + 1));
      const beat = ((HIDE.count - left) / (HIDE.count / 10)) % 1;
      if (raw === 'king_post') {
        // the King counts out loud, as he practised: no popping
        this.actor('creeper_king', 0, 122, 760, 62, 'idle', 'right', dt, D.pup + 0.2);
        f.fillStyle(0xffffff, 1).fillRoundedRect(46, 372, 152, 124, 30);
        f.fillStyle(0xffffff, 1).fillTriangle(100, 490, 144, 490, 122, 528);
        this.label(String(num), 122, 434, 84).setScale(1.25 - beat * 0.25);
      } else this.label(String(num), this.hx, this.hy - 190, 92).setScale(1.3 - beat * 0.3);
      this.label(S.mini_count ?? '', W / 2, 190, 48);
      // while she counts, her friends run off and hide (she sees them go, not who went where at the end)
      const run = Math.min(1, (HIDE.count - left) / (HIDE.count * 0.8));
      const bx = cx(HIDE.home[0]);
      const by = cy(HIDE.home[1]) + 40;
      for (const o of m.objs) {
        if (!o.vx) continue;
        const who = hiders[(o.vx - 1 + hiders.length) % hiders.length]!;
        const ex = cx(o.x);
        const ey = cy(o.y) + 40;
        const x = bx + (ex - bx) * run;
        const y = by + (ey - by) * run;
        const pup = this.actor(
          who,
          20 + o.vx,
          x,
          y,
          66 * (SMALL[who] ?? 1),
          'walk',
          this.dirOf(ex - bx, ey - by, 'right'),
          dt,
          D.pup + y / 10000,
        );
        pup.sprite.setAlpha(Math.max(0, Math.min(1, (1 - run) * 4)));
      }
    }
    // found this round: a star for each friend, lit when found
    if (m.st === 1)
      for (let i = 0; i < 3; i++) {
        const sx = W - 70 - (2 - i) * 62;
        const lit = i < (n[2] ?? 0);
        star(f, sx, 178, 26, lit ? 0xffd24a : 0x6a5a4a, 0.45);
        if (!lit) f.fillStyle(0x10131f, 0.25).fillCircle(sx, 178, 10);
      }
    if (m.st === 1 && phase === 1 && look === -2) {
      const ky = this.hy - 200 + Math.sin(this.t * 5) * 4;
      keyCapG(f, this.hx, ky, '', 118, 52);
      this.capT.setPosition(this.hx, ky - 4).setVisible(true);
    }
    if (m.st === 1 && phase === 1 && this.prev[6] === 0) this.readyT = 1.2;
    this.readyT = Math.max(0, this.readyT - dt);
    if (this.readyT > 0) this.label(S.mini_ready ?? '', W / 2, 190, 52).setAlpha(Math.min(1, this.readyT * 3));
  }

  // ---------------------------------------------------------------- Race round the park

  private race(m: MiniRt, dt: number): void {
    const S = this.g.c.strings;
    const n = m.n;
    const s = RS;
    // the view follows her round the course
    const tcx = Math.max(0, Math.min(RACE.w - W / s, n[0]! - W / s / 2));
    // (it may slide a little past the top of the park, so the top straight is not under the score and the strip)
    const tcy = Math.max(-1.4, Math.min(RACE.h - H / s, n[1]! - H / s / 2));
    if (this.camNew) {
      this.camX = tcx;
      this.camY = tcy;
      this.camNew = false;
    } else {
      // by the rules' time, not the screen's: on a frame with no rule step (a 120 Hz screen, a skipped step) the
      // runners stand still, and a camera still gliding would slide them back, then forward again: a ghost
      const k = Math.min(1, Math.max(0, m.t - this.camT) * 7);
      this.camX += (tcx - this.camX) * k;
      this.camY += (tcy - this.camY) * k;
    }
    this.camT = m.t;
    // (package 75: the camera moves with the rules' steps, so it is drawn between them like the runners)
    const camX = this.sm('cam.x', this.camX, 3);
    const camY = this.sm('cam.y', this.camY, 3);
    this.back.setPosition(-camX * s, -camY * s);
    const X = (u: number) => (u - camX) * s;
    const Y = (v: number) => (v - camY) * s;
    const md = this.mid;
    const f = this.front;
    const lap = Math.min(2, n[6]!);
    const open = lap >= 2 || n[7]! >= 2;
    if (lap !== this.raceLap) {
      this.raceLap = lap;
      if (lap === 2) this.shortT = 3.2;
    }
    // the hedge across the short cut: shut for two laps, then pushed aside
    for (const gx of [20.3, 11.7]) {
      const x = X(gx);
      const y = Y(15.5);
      if (x < -200 || x > W + 200) continue;
      if (open) {
        bushBlob(md, x, y - 1.75 * s, 1.1);
        bushBlob(md, x, y + 1.75 * s, 1.1);
      } else for (let i = -1; i <= 1; i++) bushBlob(md, x, y + i * 1.05 * s + 20, 1.25);
    }
    if (open)
      for (let i = 0; i < 5; i++) {
        // arrows along the short cut, pointing the way round
        const x = X(19 - i * 1.5 - ((this.t * 2) % 1.5));
        const y = Y(15.5);
        md.fillStyle(0xffffff, 0.55).fillTriangle(x + 22, y - 26, x + 22, y + 26, x - 22, y);
      }
    // puddles and boost pads
    for (const o of m.objs) {
      if (o.k < 10) continue;
      const x = X(o.x);
      const y = Y(o.y);
      if (x < -200 || x > W + 200 || y < -200 || y > H + 200) continue;
      const oa = o.a > 0 ? this.so(o, 'a', 0.2) : 0;
      if (o.k === 10) {
        const w = RACE.puddleR * 2 * s;
        md.fillStyle(0x5a3a1e, 1).fillEllipse(x, y, w + 14, w * 0.62 + 12);
        md.fillStyle(0x4a86c8, 1).fillEllipse(x, y, w, w * 0.62);
        md.fillStyle(0x9ad8ff, 0.7).fillEllipse(x - w * 0.16, y - w * 0.1, w * 0.4, w * 0.16);
        if (o.a > 0) {
          const k = 1 - oa / 0.5;
          md.lineStyle(5, 0xffffff, 1 - k).strokeEllipse(x, y, w * (0.4 + k * 0.7), w * 0.62 * (0.4 + k * 0.7));
        }
      } else {
        const r = RACE.padR * s;
        const pulse = 0.5 + 0.5 * Math.sin(this.t * 8);
        md.fillStyle(0xfff3b0, 0.25 + pulse * 0.2).fillCircle(x, y, r + 16);
        md.fillStyle(0xe2882a, 1).fillCircle(x, y, r);
        md.fillStyle(0xffd24a, 1).fillCircle(x, y, r - 9);
        star(md, x, y, r * (0.62 + pulse * 0.08), 0xffffff);
        if (o.a > 0) md.lineStyle(8, 0xffffff, oa / 0.6).strokeCircle(x, y, r + (1 - oa / 0.6) * 90);
      }
    }
    // the flags of her lap: the next one glows, and its ring is the rules' reach
    const next = n[2]!;
    let nextX = 0;
    let nextY = 0;
    for (let i = 0; i < m.objs.length; i++) {
      const o = m.objs[i]!;
      if (o.k >= 10) break;
      const x = X(o.x);
      const y = Y(o.y);
      const isNext = i === next && m.st !== 2;
      if (isNext) {
        nextX = x;
        nextY = y;
      }
      if (x < -200 || x > W + 200 || y < -200 || y > H + 200) continue;
      if (isNext) {
        md.fillStyle(0xfff3b0, 0.2 + 0.12 * Math.sin(this.t * 8)).fillCircle(x, y, RACE.reach * s);
        md.lineStyle(5, GOLD, 0.6 + 0.3 * Math.sin(this.t * 8)).strokeCircle(x, y, RACE.reach * s);
      }
      const color = o.k ? GREEN : isNext ? (Math.sin(this.t * 10) > 0 ? GOLD : 0xffe9a0) : RED;
      md.fillStyle(0x000000, 0.2).fillEllipse(x, y + 2, 34, 10);
      flag(md, x, y, isNext ? 110 : 84, color, Math.sin(this.t * 6 + i) * 6);
    }
    // the rival
    const rx = X(this.sm('rival.x', n[11]!, 1.5));
    const ry = Y(this.sm('rival.y', n[12]!, 1.5));
    const rmove = m.st === 1 && !n[4] && n[5]! <= 0;
    // (which way the rival faces comes from the course, not the screen, where the moving camera would turn them round)
    if (rmove) this.rdir = this.dirOf(n[11]! - this.rx, n[12]! - this.ry, this.rdir);
    this.rx = n[11]!;
    this.ry = n[12]!;
    const rival = this.rival();
    this.shadow(rx, ry, 70);
    this.actor(
      rival,
      0,
      rx,
      ry,
      70 * (SMALL[rival] ?? 1),
      n[4] ? glad(rival) : rmove ? 'run' : 'idle',
      n[4] || !rmove ? 'down' : this.rdir,
      dt,
      D.pup + ry / 10000,
    );
    // the hero
    const dx = n[0]! - this.prev[0]!;
    const dy = n[1]! - this.prev[1]!;
    const moving = Math.abs(dx) + Math.abs(dy) > 1e-4;
    if (moving) this.hdir = this.dirOf(dx, dy, this.hdir);
    const hx = X(this.sm('hero.x', n[0]!, 1.5));
    const hy = Y(this.sm('hero.y', n[1]!, 1.5));
    if (n[8]! > 0) {
      // boosted: a streak of sparks behind her
      if (this.frame % 2 === 0) this.burst(hx - dx * s * 4, hy - 30 - dy * s * 4, 2, 0xffd24a, 160, 0xffffff);
      if (this.prev[8]! <= 0) this.zoomT = 1;
    }
    if (n[10] === 2 && moving && this.frame % 6 === 0) this.burst(hx, hy, 4, 0x9ad8ff, 260, 0xffffff);
    if (n[10] === 1 && moving && this.frame % 10 === 0) this.burst(hx, hy, 2, 0x5aa83e, 160, 0x86d26a);
    this.shadow(hx, hy, 74);
    const hero = this.actor(
      this.g.s.hero,
      0,
      hx,
      hy,
      70,
      m.st === 2 ? 'cheer' : moving ? 'run' : 'idle',
      m.st === 2 || !moving ? 'down' : this.hdir,
      dt,
      D.pup + hy / 10000,
    );
    if (m.score > this.prevScore) hero.bump(0.14);
    this.zoomT = Math.max(0, this.zoomT - dt);
    if (this.zoomT > 0) this.label(S.mini_zoom ?? '', hx, hy - 150 - (1 - this.zoomT) * 30, 44).setAlpha(this.zoomT);
    // which way to the next flag: a little arrow by her, and a big one at the edge when the flag is out of sight
    if (m.st === 1 && n[5]! <= 0 && next < m.objs.length) {
      const ang = Math.atan2(nextY - hy + 40, nextX - hx);
      const far = Math.hypot(nextX - hx, nextY - hy + 40);
      if (far > 230) {
        const ax = hx + Math.cos(ang) * 120;
        const ay = hy - 40 + Math.sin(ang) * 120;
        arrow(f, ax, ay, ang, 26, GOLD);
      }
      if (nextX < 40 || nextX > W - 40 || nextY < 150 || nextY > H - 40) {
        const ex = Math.max(70, Math.min(W - 70, nextX));
        const ey = Math.max(200, Math.min(H - 70, nextY));
        arrow(f, ex, ey, ang, 48 + Math.sin(this.t * 8) * 6, GOLD);
      }
    }
    // who is in front, on a strip at the top: her star and the rival's dot
    const total = RACE.laps.reduce((sum, c) => sum + c.len, 0);
    const bar0 = 610;
    const barW = 700;
    f.fillStyle(0x000000, 0.4).fillRoundedRect(bar0, 150, barW, 22, 11);
    for (let l = 1; l < 3; l++) {
      let at = 0;
      for (let k = 0; k < l; k++) at += RACE.laps[k]!.len;
      f.fillStyle(0xffffff, 0.7).fillRect(bar0 + (barW * at) / total - 2, 144, 4, 34);
    }
    f.fillStyle(RED, 1).fillCircle(bar0 + barW * (1 - this.sm('rival.left', n[13]!, 2) / total), 161, 13);
    star(f, bar0 + barW * (1 - this.sm('hero.left', n[9]!, 2) / total), 161, 22, 0xffd24a);
    flag(f, bar0 + barW + 14, 182, 52, 0xffffff, 0);
    if (m.st === 1 && n[5]! <= 0) {
      const ahead = n[9]! <= n[13]!;
      this.label(S[ahead ? 'mini_1st' : 'mini_2nd'] ?? '', bar0 + barW / 2, 204, 34);
    }
    this.shortT = Math.max(0, this.shortT - dt);
    if (this.shortT > 0 && this.shortT < 1.8)
      this.label(S.mini_shortcut ?? '', W / 2, 330, 64).setAlpha(Math.min(1, this.shortT * 2));
    // ready, steady, go
    if (m.st === 1 && n[5]! > 0) {
      const num = Math.ceil(n[5]! / 0.8);
      const beat = 1 - ((n[5]! / 0.8) % 1);
      this.label(String(num), W / 2, 560, 190).setScale(1.3 - beat * 0.3);
    } else if (m.st === 1 && this.prev[5]! > 0) this.goT = 0.8;
    this.goT = Math.max(0, this.goT - dt);
    if (this.goT > 0) this.label(S.mini_start ?? '', W / 2, 560, 190).setAlpha(Math.min(1, this.goT * 3));
  }

  // ---------------------------------------------------------------- Claw machine

  private claw(m: MiniRt, dt: number): void {
    const S = this.g.c.strings;
    const n = m.n;
    const s = 95;
    const X = (u: number) => 640 + u * s;
    const Y = (v: number) => 290 + v * s;
    const f = this.front;
    const state = n[1]!;
    const grabbed = n[3]!;
    if (state === 2 && this.prev[1] !== 2) {
      const o = m.objs[grabbed];
      if (o) this.burst(X(o.x), Y(o.y), 14, 0xffd24a, 420, 0xffffff);
      this.cheerT = 1.3;
    }
    if (state === 3 && this.prev[1] !== 3) this.oopsT = 1.3;
    if (state === 5 && this.prev[1] !== 5) this.burst(X(CLAW.chute), Y(CLAW.floor), 10, 0xffffff, 300, 0xffd24a);
    this.cheerT = Math.max(0, this.cheerT - dt);
    this.oopsT = Math.max(0, this.oopsT - dt);
    // prizes: each one is a real toy; the one in the claw is the toy she will take home
    for (let i = 0; i < m.objs.length; i++) {
      const o = m.objs[i]!;
      const id =
        i === grabbed
          ? m.msg || CLAW_PRIZES[this.clawBase % CLAW_PRIZES.length]!
          : CLAW_PRIZES[(this.clawBase + o.k + 1) % CLAW_PRIZES.length]!;
      if (o.y > CLAW.floor + 0.75) continue;
      const im = this.img(
        id,
        X(i === grabbed ? this.so(o, 'x') : o.x),
        Y(i === grabbed ? this.so(o, 'y') : o.y) + 12,
        110,
      );
      if (i === grabbed && state >= 2) im.setAngle(Math.sin(this.t * 9) * 6);
    }
    // (package 75: the claw, its car and the prize it carries are drawn between the rules' steps)
    const cx = X(this.sm('claw.x', n[7]!, 0.5));
    const cy = Y(this.sm('claw.y', n[2]!, 1));
    const carX = X(this.sm('car.x', n[0]!, 1));
    const reach = this.g.s.opts.gentle ? CLAW.grabGentle : CLAW.grab;
    // aim line under the swinging claw: green when a drop right now would grab (the rules' own reach)
    if (m.st === 1 && state === 0) {
      let d = 99;
      for (const o of m.objs) d = Math.min(d, Math.abs(o.x - n[7]!));
      const sure = n[4]! >= CLAW.tries - 1;
      const col = d < reach || sure ? GREEN : 0xffffff;
      for (let y = cy + 64; y < Y(CLAW.floor) - 40; y += 26) f.fillStyle(col, 0.7).fillRect(cx - 3, y, 6, 13);
      f.lineStyle(5, col, 0.9).strokeEllipse(cx, Y(CLAW.floor) + 12, reach * 2 * s, 0.28 * s);
    }
    // carriage, cable and claw (the cable leans as the claw swings)
    f.fillStyle(0x5a6070, 1).fillRoundedRect(carX - 42, Y(0.42) - 18, 84, 36, 8);
    f.fillStyle(0x8a90a0, 1).fillRoundedRect(carX - 34, Y(0.42) - 12, 68, 22, 6);
    f.lineStyle(5, 0x40404a, 1).lineBetween(carX, Y(0.42) + 18, cx, cy - 24);
    const shut = state >= 2 || m.st === 2 ? 0.25 : 1;
    f.lineStyle(9, 0x8a90a0, 1);
    for (const side of [-1, 1]) {
      f.beginPath();
      f.moveTo(cx + side * 12, cy - 6);
      f.lineTo(cx + side * (22 + 30 * shut), cy + 22);
      f.lineTo(cx + side * (6 + 22 * shut), cy + 48);
      f.strokePath();
    }
    f.fillStyle(0xc8ccd8, 1).fillCircle(cx, cy - 14, 24);
    f.fillStyle(0x6a7080, 1).fillCircle(cx, cy - 14, 10);
    // glass glare
    f.fillStyle(0xffffff, 0.08).fillPoints(
      [
        { x: X(0.6), y: Y(-0.3) },
        { x: X(2.2), y: Y(-0.3) },
        { x: X(0.6), y: Y(5) },
        { x: X(0), y: Y(5) },
      ],
      true,
    );
    f.fillStyle(0xffffff, 0.06).fillPoints(
      [
        { x: X(3), y: Y(-0.3) },
        { x: X(3.7), y: Y(-0.3) },
        { x: X(0.9), y: Y(7) },
        { x: X(0.2), y: Y(7) },
      ],
      true,
    );
    // three lamps on the machine: one for each try
    for (let i = 0; i < CLAW.tries; i++) {
      const lx = X(8.2 + i * 0.75);
      const on = i >= n[4]! && m.st !== 2;
      f.fillStyle(0x3b1a2a, 1).fillCircle(lx, Y(7.36), 24);
      f.fillStyle(on ? 0x7be37b : 0x5a4a58, 1).fillCircle(lx, Y(7.36), 18);
      if (on && i === n[4]) f.fillStyle(0xffffff, 0.4 + 0.3 * Math.sin(this.t * 8)).fillCircle(lx - 5, Y(7.36) - 5, 7);
    }
    if (this.oopsT > 0)
      this.label(S.mini_close ?? '', cx, cy - 90 - (1.3 - this.oopsT) * 30, 48).setAlpha(Math.min(1, this.oopsT * 3));
    if (this.cheerT > 0)
      this.label(S.mini_got ?? '', cx, cy - 90 - (1.3 - this.cheerT) * 30, 48).setAlpha(Math.min(1, this.cheerT * 3));
    if (m.st === 1 && state === 0 && n[4]! >= CLAW.tries - 1 && n[8]! < 2)
      this.label(S.mini_last ?? '', X(5), Y(2.2), 60).setAlpha(Math.min(1, (2 - n[8]!) * 2));
    // the hero works the controls, then cheers
    const happy = m.st === 2 || state === 2 || state >= 4;
    this.shadow(370, 1040, 130);
    this.actor(this.g.s.hero, 0, 370, 1040, 150, happy ? 'cheer' : 'idle', happy ? 'down' : 'right', dt);
  }

  // ---------------------------------------------------------------- Snowball fight

  private snowball(m: MiniRt, dt: number): void {
    const S = this.g.c.strings;
    const n = m.n;
    const s = 108;
    const X = (u: number) => 312 + u * s;
    const Y = (v: number) => 210 + v * s;
    const f = this.front;
    const md = this.mid;
    // (package 75: the balls, the snowman and the hero are drawn between the rules' steps; the friends in the snow
    // piles stand still)
    for (const o of m.objs) {
      if (o.k === 1) {
        const x = X(this.so(o, 'x', 2));
        const y = Y(this.so(o, 'y', 2));
        f.fillStyle(0xdce9f8, 0.6).fillCircle(x, y + 14, 10);
        f.fillStyle(0x9ab8d8, 1).fillCircle(x + 3, y + 4, 18);
        f.fillStyle(0xffffff, 1).fillCircle(x, y, 17);
        continue;
      }
      if (o.k === 2) {
        // one coming back: a ring on the snow shows where it will land, so she can step aside
        const ox = this.so(o, 'x', 2);
        const oy = this.so(o, 'y', 2);
        const lx = X(ox + o.vx * Math.max(0, this.so(o, 'a', 0.5)));
        const ly = Y(SNOW.h - 0.3);
        const p = Math.max(0, Math.min(1, (oy - 1) / (SNOW.h - 1.9)));
        md.lineStyle(6, 0x4a86c8, 0.5 + 0.4 * Math.sin(this.t * 14)).strokeEllipse(lx, ly, 150, 44);
        md.fillStyle(0x4a86c8, 0.18).fillEllipse(lx, ly, 150 * p, 44 * p);
        const x = X(ox);
        const y = Y(oy) - Math.sin(p * Math.PI) * 150;
        const r = 14 + p * 16;
        f.fillStyle(0x9ab8d8, 1).fillCircle(x + 3, y + 4, r + 1);
        f.fillStyle(0xffffff, 1).fillCircle(x, y, r);
        continue;
      }
      if (o.k === 3) {
        // the snowman slides along the back: worth more
        const x = X(this.so(o, 'x', 2));
        const y = Y(o.y) + 20;
        if (o.vy && !this.snowHit.has(o)) {
          this.snowHit.add(o);
          this.burst(x, y - 40, 22, 0xffffff, 520, 0xffd24a);
          this.plusT = 1.2;
          this.plusX = x;
          this.plusY = y - 120;
        }
        const im = this.img('snowman', x, y - 50 + Math.sin(this.t * 5) * 5, 170);
        if (o.vy) im.setAngle(Math.sin(this.t * 30) * 14).setAlpha(Math.min(1, o.a * 2));
        else {
          im.setAngle(Math.sin(this.t * 3) * 4);
          star(f, x + 60, y - 130, 22 + Math.sin(this.t * 8) * 4, 0xffd24a);
          this.label('3', x + 60, y - 130, 26);
          if (o.a > (SNOW.w - 0.8) / Math.abs(o.vx || 1) - 1.6) this.label(S.mini_snowman ?? '', W / 2, 190, 48);
        }
        continue;
      }
      // a friend pops up out of a snow pile
      let rec = this.snow.get(o);
      if (!rec) {
        let slot = 0;
        for (let i = 0; i < this.snowSlots.length; i++) {
          const c = (this.snowNext + i) % this.snowSlots.length;
          if (!this.snowSlots[c]) {
            slot = c;
            break;
          }
        }
        this.snowSlots[slot] = true;
        this.snowNext = slot + 1;
        rec = { slot, born: this.t, hit: -1, frame: 0 };
        this.snow.set(o, rec);
      }
      rec.frame = this.frame;
      const x = X(o.x);
      const feet = Y(o.y + 0.78);
      if (o.vx && rec.hit < 0) {
        rec.hit = this.t;
        this.burst(x, Y(o.y), 14, 0xffffff, 420, 0xcfe6ff);
      }
      let rise = easeBack((this.t - rec.born) / 0.28);
      if (!o.vx && o.a < 0.25) rise = Math.min(rise, o.a / 0.25);
      if (o.vx && o.a < 0.2) rise = Math.min(rise, o.a / 0.2);
      const who = FRIENDS[rec.slot % FRIENDS.length]!;
      this.actor(
        who,
        rec.slot,
        x,
        feet,
        95 * Math.max(0.05, rise),
        o.vx ? 'laugh' : o.vy > 0 ? 'wave' : 'idle',
        'down',
        dt,
        D.pup + feet / 10000,
      );
      snowPile(f, x, feet + 6, 190, 76);
      if (o.vx) {
        f.fillStyle(0xffffff, 0.95).fillCircle(x + 12, Y(o.y) - 26 * rise, 24 * rise);
        f.fillStyle(0xffffff, 0.9).fillCircle(x - 14, Y(o.y) - 10 * rise, 10 * rise);
      }
    }
    for (const [o, rec] of this.snow)
      if (rec.frame !== this.frame) {
        this.snowSlots[rec.slot] = false;
        this.snow.delete(o);
      }
    this.plusT = Math.max(0, this.plusT - dt);
    if (this.plusT > 0)
      this.label('+3', this.plusX, this.plusY - (1.2 - this.plusT) * 60, 72).setAlpha(Math.min(1, this.plusT * 2));
    // the hero at the bottom
    const dx = n[0]! - this.prev[0]!;
    const moving = Math.abs(dx) > 1e-4;
    if (moving) this.hdir = dx < 0 ? 'left' : 'right';
    const snowy = n[6]! > 0;
    const throwing = n[1]! > 0.18;
    const clip = m.st === 2 ? 'cheer' : snowy ? 'laugh' : throwing ? 'swing' : moving ? 'walk' : 'idle';
    const dir: Dir = m.st === 2 || snowy ? 'down' : moving && !throwing ? this.hdir : 'up';
    const hx = X(this.sm('hero.x', n[0]!));
    const hy = Y(SNOW.h - 0.25);
    this.shadow(hx, hy, 120);
    this.actor(this.g.s.hero, 0, hx, hy, 100, clip, dir, dt, D.pup + 0.5, n[1]! > this.prev[1]! + 0.1);
    if (snowy) {
      // splat: a snowy nose and a laugh, nothing worse
      if (this.prev[6]! <= 0) this.burst(hx, hy - 130, 18, 0xffffff, 460, 0xcfe6ff);
      f.fillStyle(0xffffff, 0.95)
        .fillCircle(hx + 8, hy - 150, 26)
        .fillCircle(hx - 16, hy - 132, 14);
      f.fillStyle(0xdce9f8, 1).fillCircle(hx + 14, hy - 142, 10);
      this.label(S.mini_splat ?? '', hx, hy - 240, 40);
    }
  }

  // ---------------------------------------------------------------- Archery (package 47a)

  private targets(m: MiniRt, dt: number): void {
    const n = m.n;
    const f = this.front;
    const md = this.mid;
    const X = (u: number) => TOX + u * TS;
    const Y = (v: number) => TOY + v * TS;
    for (const o of m.objs) {
      if (o.k === 1) {
        // an arrow in flight: a shaft and a head, pointing the way it flies
        const a = Math.atan2(o.vy, o.vx);
        const x = X(this.so(o, 'x', 2));
        const y = Y(this.so(o, 'y', 2));
        const cx = Math.cos(a);
        const cy = Math.sin(a);
        f.lineStyle(7, 0x7a4a24, 1).lineBetween(x - cx * 54, y - cy * 54, x, y);
        f.fillStyle(0xd8dde6, 1).fillTriangle(x + cx * 18, y + cy * 18, x - cy * 9, y + cx * 9, x + cy * 9, y - cx * 9);
        f.fillStyle(0xffffff, 1).fillTriangle(
          x - cx * 54,
          y - cy * 54,
          x - cx * 40 - cy * 10,
          y - cy * 40 + cx * 10,
          x - cx * 40 + cy * 10,
          y - cy * 40 - cx * 10,
        );
        continue;
      }
      // a target on a wooden stand: it pops up, wobbles when hit and falls flat
      let born = this.popAt.get(o);
      if (born === undefined) {
        born = this.t;
        this.popAt.set(o, born);
      }
      // (a target that slides is drawn between steps; one that stands is the same number every time)
      const x = X(this.so(o, 'x', 1.5));
      const y = Y(this.so(o, 'y', 1.5));
      const gold = o.k === 2;
      const side = targetSide(o);
      let rise = easeBack((this.t - born) / 0.25);
      if (o.a > 0 && o.a < 0.3) rise = Math.min(rise, o.a / 0.3);
      if (o.a < 0) {
        if (o.a < -0.55) this.burst(x, y, gold ? 26 : 14, gold ? 0xffd24a : 0xff6a6a, 480, 0xffffff);
        rise = Math.max(0, -o.a / 0.6);
      }
      const r = (gold ? 40 : 52) * Math.max(0.05, rise);
      md.fillStyle(0x000000, 0.2).fillEllipse(x, y + 62, 90, 20);
      md.fillStyle(0x7a4a24, 1).fillRect(x - 6, y, 12, 62 * Math.max(0.2, rise));
      const sq = side ? 0.62 : 1;
      const rings = gold ? [0xffd24a, 0xfff2b0, 0xffb020, 0xfff2b0] : [0xe24a4a, 0xffffff, 0xe24a4a, 0xffffff];
      for (let i = 0; i < 4; i++) {
        const rr = r * (1 - i * 0.24);
        f.fillStyle(rings[i]!, 1).fillEllipse(x, y, rr * 2 * sq, rr * 2);
      }
      f.fillStyle(gold ? 0xe08a00 : 0xe24a4a, 1).fillEllipse(x, y, r * 0.4 * sq, r * 0.4);
      f.lineStyle(4, 0x5a3a1a, 1).strokeEllipse(x, y, r * 2 * sq, r * 2);
      if (gold && o.a > 0) {
        star(f, x + 48, y - 48, 20 + Math.sin(this.t * 8) * 4, 0xffd24a);
        this.label('3', x + 48, y - 48, 24);
      }
      // a target about to drop blinks its rim
      if (o.a > 0 && o.a < 1)
        f.lineStyle(6, 0xffffff, 0.5 + 0.5 * Math.sin(this.t * 20)).strokeEllipse(x, y, r * 2.2 * sq, r * 2.2);
    }
    if (m.score > this.prevScore) {
      this.plusT = 0.8;
      this.plusX = X(n[0]!);
      this.plusY = Y(n[1]!) - 200;
    }
    this.plusT = Math.max(0, this.plusT - dt);
    if (this.plusT > 0)
      this.label(`+${m.score - this.prevScore || 1}`, this.plusX, this.plusY - (0.8 - this.plusT) * 60, 56).setAlpha(
        Math.min(1, this.plusT * 3),
      );
    // the hero, the way she faces, with a faint line where her arrow will fly
    const face: Dir = (['up', 'left', 'right', 'down'] as Dir[])[n[2]!] ?? 'up';
    const hx = X(this.sm('hero.x', n[0]!));
    const hy = Y(this.sm('hero.y', n[1]!));
    const moving = Math.abs(n[0]! - this.prev[0]!) + Math.abs(n[1]! - this.prev[1]!) > 1e-4;
    if (n[9]! > this.prev[9]!) this.shotAt = this.t;
    const shooting = this.t - this.shotAt < 0.25;
    if (m.st === 1) {
      const ax = face === 'left' ? -1 : face === 'right' ? 1 : 0;
      const ay = face === 'up' ? -1 : face === 'down' ? 1 : 0;
      const sy = hy - 0.4 * TS;
      const len = 7 * TS;
      for (let i = 1; i < 12; i++) {
        const d = (i / 12) * len;
        md.fillStyle(0xffffff, 0.35 * (1 - i / 12)).fillCircle(hx + ax * d, sy + ay * d, 6);
      }
      // the bow in her hands
      const bx = hx + ax * 46;
      const by = sy + ay * 30 + (face === 'up' ? -10 : 0);
      const ang = Math.atan2(ay, ax);
      f.lineStyle(7, 0x8a5a2a, 1).beginPath();
      f.arc(bx, by, 34, ang - 1.1, ang + 1.1);
      f.strokePath();
      const pull = shooting ? 0 : 10;
      f.lineStyle(2, 0xf4f4f4, 1).lineBetween(
        bx + Math.cos(ang - 1.1) * 34,
        by + Math.sin(ang - 1.1) * 34,
        bx - ax * pull + Math.cos(ang + 1.1) * 0,
        by - ay * pull,
      );
      f.lineBetween(bx - ax * pull, by - ay * pull, bx + Math.cos(ang + 1.1) * 34, by + Math.sin(ang + 1.1) * 34);
    }
    const clip = m.st === 2 ? 'cheer' : shooting ? 'swing' : moving ? 'walk' : 'idle';
    this.shadow(hx, hy, 110);
    this.actor(this.g.s.hero, 0, hx, hy, 96, clip, m.st === 2 ? 'down' : face, dt, D.pup + 0.5);
    // Mama Koala watches from the corner and claps a hit
    const glee = m.st === 2 || this.plusT > 0;
    this.actor('mama_koala', 1, X(1.2), Y(8.6), 90, glee ? 'cheer' : 'idle', 'right', dt, D.pup + 0.4);
  }

  // ---------------------------------------------------------------- Minecart ride

  private minecart(m: MiniRt, dt: number): void {
    const n = m.n;
    // (package 75: the way she has gone, the lane she leans from and the lantern's light are drawn between the
    // rules' steps)
    const n1 = this.sm('cart.d', n[1]!, 3);
    const laneU = this.sm('cart.lane', n[5]!, 3);
    const lampT = this.sm('cart.lamp', n[6]!, 0.2);
    const st = cartStretch(n1);
    // the dip tips the view down the slope and the climb tips it up; the tunnel is level
    const tilt = m.st === 0 ? 0 : [58, 0, -46][st]!;
    this.pitch += (tilt - this.pitch) * Math.min(1, dt * 1.6);
    this.back.setPosition(0, this.pitch);
    const hz = 300 + this.pitch;
    const z0 = 2.5;
    const base = 975;
    const F = (base - hz) * z0;
    const zs = (d: number) => z0 / (d + z0);
    const yOf = (d: number) => hz + F / (d + z0);
    const laneX = (lane: number, sc: number) => W / 2 + (lane - 1) * 300 * sc;
    const md = this.mid;
    const f = this.front;
    if (n[3]! > this.prev[3]!) {
      this.shakeT = 0.45;
      this.shake(0.007);
      this.burst(laneX(n[0]!, 1), base - 60, 14, 0x7a7a88, 520, 0x4a3628);
    }
    if (m.score > this.prevScore) {
      const lamp = n[8]! > this.prev[8]!;
      this.cheerT = 0.7;
      this.burst(laneX(n[0]!, 1), base - 170, 16, lamp ? 0xffd27a : 0x2ecc71, 520, lamp ? 0xffffff : 0xa8f5c4);
    }
    this.shakeT = Math.max(0, this.shakeT - dt);
    this.cheerT = Math.max(0, this.cheerT - dt);
    // how dark it is: black in the tunnel until a lantern is lit (the light fades out at the end of its time)
    const inDark = n1 > CART.stretch[1]! - 6 && n1 < CART.stretch[2]!;
    const lit = Math.min(1, Math.max(0, lampT) / 1.2);
    this.dark += ((inDark ? 1 : 0) - this.dark) * Math.min(1, dt * 2.5);
    // lamps on the tunnel walls rush past (the dark tunnel has none)
    for (let k = 7; k >= 0; k--) {
      const d = k * 7 - (n1 % 7);
      if (d < -1.5) continue;
      const at = n1 + d;
      if (at > CART.stretch[1]! && at < CART.stretch[2]!) continue;
      const sc = zs(d);
      const y = yOf(d) - 420 * sc;
      for (const side of [-1, 1]) {
        const x = W / 2 + side * 760 * sc;
        md.fillStyle(0xffc860, 0.12)
          .fillCircle(x, y, 80 * sc)
          .fillStyle(0xffd27a, 0.22)
          .fillCircle(x, y, 40 * sc);
        md.fillStyle(0x3a2a1a, 1).fillRect(x - 10 * sc, y - 20 * sc, 20 * sc, 40 * sc);
        md.fillStyle(0xffd27a, 1).fillRect(x - 6 * sc, y - 14 * sc, 12 * sc, 26 * sc);
      }
    }
    // sleepers and rails for the three lanes
    for (let k = 34; k >= 0; k--) {
      const d = k * 1.4 - (n1 % 1.4) - 1;
      if (d < -1.2) continue;
      const sc = zs(d);
      const y = yOf(d);
      for (let l = 0; l < 3; l++)
        md.fillStyle(0x6a4a2a, 1).fillRect(laneX(l, sc) - 115 * sc, y - 9 * sc, 230 * sc, 18 * sc);
    }
    const dn = -1.2;
    const df = 50;
    for (let l = 0; l < 3; l++)
      for (const side of [-1, 1]) {
        const xn = laneX(l, zs(dn)) + side * 80 * zs(dn);
        const xf = laneX(l, zs(df)) + side * 80 * zs(df);
        const wn = 9 * zs(dn);
        const wf = 9 * zs(df);
        md.fillStyle(0xa8acb8, 1).fillPoints(
          [
            { x: xn - wn, y: yOf(dn) },
            { x: xn + wn, y: yOf(dn) },
            { x: xf + wf, y: yOf(df) },
            { x: xf - wf, y: yOf(df) },
          ],
          true,
        );
      }
    // the mouth of the dark tunnel coming up, and the daylight at the very end
    const mouth = CART.stretch[1]! - n1;
    if (mouth > 0 && mouth < 46) {
      const sc = zs(mouth);
      md.fillStyle(0x08060c, 1).fillEllipse(W / 2, yOf(mouth) - 300 * sc, 1500 * sc, 1100 * sc);
    }
    const out = CART.length - n1;
    if (out > 0 && out < 46 && m.st === 1) {
      const sc = zs(out);
      md.fillStyle(0xfff3b0, 0.9).fillEllipse(W / 2, yOf(out) - 280 * sc, 1300 * sc, 1000 * sc);
      md.fillStyle(0xffffff, 0.9).fillEllipse(W / 2, yOf(out) - 280 * sc, 900 * sc, 700 * sc);
    }
    // rocks, gems and lanterns, far ones first; anything grabbed or smashed is gone
    const near: number[] = [];
    const lamps: number[] = [];
    for (let i = m.objs.length - 1; i >= 0; i--) {
      const o = m.objs[i]!;
      const d = o.y - n1;
      if (d > 46 || d < -1.3 || o.a) continue;
      if (o.k === 2) {
        lamps.push(i);
        continue;
      }
      if (d < 0) {
        near.push(i);
        continue;
      }
      this.cartThing(md, o.x, o.k, d, i, zs, yOf, laneX);
    }
    // the dark: it hides what is far away; a lit lantern pushes it right back
    if (this.dark > 0.01) {
      const reach = 9 + lit * 30;
      const edge = yOf(reach);
      const a = this.dark * (0.96 - lit * 0.5);
      const low = this.dark * (0.3 - lit * 0.26);
      md.fillStyle(0x05040a, a).fillRect(0, 0, W, Math.max(0, edge - 90));
      md.fillGradientStyle(0x05040a, 0x05040a, 0x05040a, 0x05040a, a, a, low, low).fillRect(0, edge - 90, W, 300);
      md.fillStyle(0x05040a, low).fillRect(0, edge + 210, W, H);
    }
    // lanterns shine through the dark
    for (const i of lamps) {
      const o = m.objs[i]!;
      this.cartThing(o.y - n1 < 0 ? f : md, o.x, 2, o.y - n1, i, zs, yOf, laneX);
    }
    // the cart leans into a lane change and shakes on a bump
    const shx = Math.sin(this.t * 70) * 14 * (this.shakeT / 0.45);
    const cx = laneX(laneU, 1) + shx;
    const lean = (n[0]! - laneU) * 0.16;
    const hurt = this.shakeT > 0;
    const happy = m.st === 2 || this.cheerT > 0;
    // her own lamp glow in the dark: soft rings, brighter and wider while a lantern is lit
    if (this.dark > 0.01)
      for (let i = 0; i < 5; i++)
        md.fillStyle(0xffd27a, this.dark * (0.035 + lit * 0.03)).fillEllipse(
          cx,
          base - 120,
          (520 + lit * 520) * (1 - i * 0.16),
          (300 + lit * 220) * (1 - i * 0.16),
        );
    const hero = this.actor(
      this.g.s.hero,
      0,
      cx,
      base - 70,
      112,
      hurt ? 'hurt' : happy ? 'cheer' : 'idle',
      happy && !hurt ? 'down' : 'up',
      dt,
    );
    hero.sprite.setAngle((lean * 180) / Math.PI);
    const c = Math.cos(lean);
    const sn = Math.sin(lean);
    const pv = base - 40;
    const P = (x: number, y: number) => ({ x: cx + x * c - y * sn, y: pv + x * sn + y * c });
    f.fillStyle(0x222222, 1).fillCircle(P(-82, 22).x, P(-82, 22).y, 26).fillCircle(P(82, 22).x, P(82, 22).y, 26);
    f.fillStyle(0x777777, 1).fillCircle(P(-82, 22).x, P(-82, 22).y, 10).fillCircle(P(82, 22).x, P(82, 22).y, 10);
    f.fillStyle(0x5a3a24, 1).fillPoints([P(-140, -120), P(140, -120), P(118, 14), P(-118, 14)], true);
    f.fillStyle(0x8a5a3a, 1).fillPoints([P(-126, -100), P(126, -100), P(108, 0), P(-108, 0)], true);
    f.fillStyle(0xb0b4c0, 1).fillPoints([P(-150, -136), P(150, -136), P(146, -112), P(-146, -112)], true);
    f.fillStyle(0xd8dce6, 1).fillCircle(P(-90, -56).x, P(-90, -56).y, 7).fillCircle(P(90, -56).x, P(90, -56).y, 7);
    // a lantern on the cart while its light lasts
    if (n[6]! > 0) lantern(f, P(118, -150).x, P(118, -150).y, 0.8, 0.6 + 0.4 * lit);
    // wind lines when the dip gets fast
    if (st === 0 && m.st === 1 && n[2]! > 8.5)
      for (let i = 0; i < 6; i++) {
        const wy = 420 + ((i * 131 + this.frame * 37) % 560);
        const wx = i % 2 ? 120 + ((i * 53) % 260) : W - 380 + ((i * 71) % 260);
        f.fillStyle(0xffffff, 0.22).fillRect(wx, wy, 5, 90);
      }
    for (const i of near) {
      const o = m.objs[i]!;
      this.cartThing(f, o.x, o.k, o.y - n1, i, zs, yOf, laneX);
    }
    // how far to go, with a notch where each stretch begins
    const pr = Math.max(0, Math.min(1, n1 / CART.length));
    f.fillStyle(0x000000, 0.4).fillRoundedRect(560, 150, 800, 24, 12);
    if (pr * 800 > 24) f.fillStyle(GOLD, 1).fillRoundedRect(560, 150, 800 * pr, 24, 12);
    for (const at of [CART.stretch[1]!, CART.stretch[2]!])
      f.fillStyle(0xffffff, 0.8).fillRect(560 + (800 * at) / CART.length - 2, 144, 4, 36);
    f.fillStyle(0x8a5a3a, 1).fillRoundedRect(560 + 800 * pr - 18, 140, 36, 26, 6);
    star(f, 1380, 162, 26, 0xffd24a);
  }

  private cartThing(
    gr: Gfx,
    lane: number,
    kind: number,
    d: number,
    i: number,
    zs: (d: number) => number,
    yOf: (d: number) => number,
    laneX: (lane: number, sc: number) => number,
  ): void {
    const sc = zs(d);
    const x = laneX(lane, sc);
    const y = yOf(d);
    if (kind === 2) {
      const bob = Math.sin(this.t * 3 + i) * 6 * sc;
      lantern(gr, x, y - 120 * sc + bob, 1.5 * sc, 0.8 + 0.2 * Math.sin(this.t * 9 + i));
    } else if (kind === 1) {
      const bob = Math.sin(this.t * 4 + i) * 8 * sc;
      gr.fillStyle(0x2ecc71, 0.2).fillCircle(x, y - 80 * sc + bob, 60 * sc);
      gem(gr, x, y - 80 * sc + bob, 44 * sc);
    } else rock(gr, x, y - 40 * sc, 76 * sc);
  }
}
