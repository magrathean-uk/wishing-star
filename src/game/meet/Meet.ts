// The shared place (package 66, D71): the meadow where the players on the list meet as their heroes. The player's own
// hero runs on the story's rules in a visit game (./visit.ts) that is never saved; everyone else is drawn from what
// the server says (./room.ts), moving smoothly between its updates. The HUD (./MeetHud.ts) runs beside this scene.
import Phaser from 'phaser';
import { FUN, funPose, funThing } from '../../core/fun.ts';
import { step } from '../../core/step.ts';
import type { Clip, Dir, FunMove, FunRun, Game } from '../../core/types.ts';
import { app, xmasNow } from '../app.ts';
import { art, frameFor, pumpUploads, sweepChars } from '../assets.ts';
import { Sound } from '../audio.ts';
import { Keys } from '../input.ts';
import { prefersLessMotion, Puppet } from '../puppet.ts';
import { screenText } from '../ui/kit.ts';
import { playEmote } from '../world/emotes.ts';
import { Fx } from '../world/fx.ts';
import { Ground } from '../world/ground.ts';
import { Sky } from '../world/sky.ts';
import { Things } from '../world/things.ts';
import { ballAt, type BallNow } from './keepy.ts';
import { type BallCard, type Card, type In, RoomLink } from './room.ts';
import { keepVisit, MEET, NOON, visitGame } from './visit.ts';

const T = 64;
const STEP = 1000 / 60;
const ZOOM = 1.25;
const FUN_BIAS = 48;
/** a bubble stays this long (seconds) */
export const BUBBLE_SECS = 5;
/** where Space starts Keepy Uppy, the start box and the finish line (as in tools/release/room.js) */
const STAND = { x: 12.5, y: 14.5 };
const RACE_BOX = { x0: 3, y0: 20, x1: 7, y1: 23 };
const FINISH_X = 35;
/** how near the balloon's shadow a player must stand to bat it, and how low it must be (room.js: 1.5 and 2) */
const REACH = 1.5;
const LOW = 2;

/** Someone else in the place, as drawn here. */
interface Other {
  id: string;
  label: string;
  hero: string;
  puppet: Puppet;
  name: Phaser.GameObjects.Text;
  /** drawn place, and the newest place the server sent */
  x: number;
  y: number;
  tx: number;
  ty: number;
  d: Dir;
  c: string;
  /** a turn on a swing or the like, run here from its start for the look */
  fun: FunRun | null;
  /** an emote or a cheer playing, and for how long */
  act: string;
  actT: number;
  ribbonT: number;
}

export interface Bubble {
  id: string;
  text: string;
  t: number;
  box: Phaser.GameObjects.Container;
}

const DIRS: Dir[] = ['up', 'down', 'left', 'right'];

export class Meet extends Phaser.Scene {
  link!: RoomLink;
  /** the visit game: the player's own hero on the story's rules; null until the server has said hello */
  g: Game | null = null;
  keys!: Keys;
  fx!: Fx;
  you = '';
  hero = '';
  /** the HUD sets this while the chat line, the menu or a message holds the game's keys */
  frozen = false;
  /** a message for the HUD to show once (the HUD empties it) */
  notes: { kind: string; who?: string; n?: number }[] = [];
  /** typed chat is on (the server says) */
  chatOn = true;
  ball: BallCard | null = null;
  private ballT0 = 0;
  ballNow: BallNow = { x: 0, y: 0, h: 0 };
  best = 0;
  /** the race: 'count' with the time of go, 'run', or '' */
  race = '';
  raceGoAt = 0;
  others = new Map<string, Other>();
  bubbles: Bubble[] = [];
  private ground!: Ground;
  private things!: Things;
  private sky!: Sky;
  private puppet: Puppet | null = null;
  private myName: Phaser.GameObjects.Text | null = null;
  private ballImg!: Phaser.GameObjects.Image;
  private ballShadow!: Phaser.GameObjects.Ellipse;
  private ballString!: Phaser.GameObjects.Graphics;
  private board!: Phaser.GameObjects.Text;
  private acc = 0;
  private actClip: Clip | string = 'idle';
  private actT = 0;
  private lastFun: FunRun | null = null;
  private funObj = new Map<number, string>();
  private myRibbonT = 0;
  private ribbon!: Phaser.GameObjects.Image;
  private ribbons: Phaser.GameObjects.Image[] = [];
  private endedSaid = false;
  private camX = 0;
  private camY = 0;
  /** time spent in our own code this frame, for the frame measure */
  jsMs = 0;

  constructor() {
    super('Meet');
  }

  create(data: { hero?: string }): void {
    this.g = null;
    this.others = new Map();
    this.bubbles = [];
    this.notes = [];
    this.frozen = false;
    this.ball = null;
    this.race = '';
    this.puppet = null;
    this.myName = null;
    this.endedSaid = false;
    this.lastFun = null;
    this.funObj.clear();
    this.ribbons = [];
    this.link = new RoomLink();
    this.keys = new Keys(this);
    Sound.init(this);
    Sound.volumes(app.music, app.sound);
    this.cameras.main.setBackgroundColor(0x5f9f4c);
    this.hero = data.hero ?? '';
    this.scene.launch('MeetHud', { meet: this });
    this.events.once('shutdown', () => {
      this.link.close();
      for (const o of this.others.values()) this.dropOther(o);
      this.others.clear();
      this.puppet?.destroy();
      this.puppet = null;
      for (const b of this.bubbles) b.box.destroy();
      this.bubbles = [];
      this.scene.stop('MeetHud');
    });
    if (this.hero) void this.connect(this.hero);
  }

  /** Into the place as `hero`. Resolves false (and the HUD says so) when the server does not answer. */
  async connect(hero: string): Promise<boolean> {
    this.hero = hero;
    const ok = await this.link.open(hero);
    if (!this.sys.isActive()) return false;
    if (!ok) {
      this.notes.push({ kind: this.link.ended === 'login' ? 'login' : 'offline' });
      return false;
    }
    return true;
  }

  /** The server said hello: make the meadow and the player's hero. */
  private enter(w: Extract<In, { t: 'welcome' }>): void {
    this.you = w.you;
    this.chatOn = w.chat;
    this.best = w.best;
    const g = visitGame(app.content, this.hero, xmasNow(), w.x, w.y);
    g.s.opts.music = app.music;
    g.s.opts.sound = app.sound;
    this.g = g;
    this.ground = new Ground(this);
    this.things = new Things(this, g);
    this.fx = new Fx(this);
    this.sky = new Sky(this);
    this.ground.setArea(MEET, g.s.xmas);
    this.things.setArea(MEET);
    this.cameras.main.setZoom(ZOOM).setRoundPixels(false);
    this.cameras.main.setBounds(0, 0, MEET.w * T, MEET.h * T);
    this.camX = g.s.x * T;
    this.camY = g.s.y * T;
    this.puppet = this.makePuppet(this.hero);
    this.myName = this.nameTag(app.content.strings.meet_you ?? '');
    this.ballShadow = this.add.ellipse(0, 0, 46, 18, 0x000000, 0.22).setVisible(false);
    this.ballString = this.add.graphics().setVisible(false);
    const f = frameFor(this, 'heeler_balloon', 64, 64);
    this.ballImg = this.add.image(0, 0, f.key, f.frame).setOrigin(0.5, 1).setVisible(false);
    this.board = this.add
      .text(STAND.x * T - 64, (STAND.y - 4.3) * T, '', {
        fontFamily: 'Fredoka, Nunito, sans-serif',
        fontSize: '26px',
        color: '#ffffff',
        stroke: '#3b2a1a',
        strokeThickness: 6,
      })
      .setOrigin(0.5, 1)
      .setDepth((STAND.y - 2) * T);
    this.ribbon = this.add.image(0, 0, ribbonTex(this)).setVisible(false).setDepth(90000);
    for (const p of w.players) this.addOther(p);
    if (w.ball) this.setBall(w.ball);
    if (w.race?.phase === 'count') {
      this.race = 'count';
      this.raceGoAt = performance.now() + w.race.ms;
    } else if (w.race?.phase === 'run') this.race = 'run';
    this.showBest();
    Sound.music(MEET.music ?? 'day');
    // Space at the stand, under the balloon or in the start box goes to the server, not to the swing
    this.keys.actHook = () => this.space();
  }

  private makePuppet(hero: string): Puppet {
    const c = app.content;
    const id = artOf(hero);
    return new Puppet(this, id, c.chars[hero]?.tall ?? 2);
  }
  private nameTag(label: string): Phaser.GameObjects.Text {
    return this.add
      .text(0, 0, label, {
        fontFamily: 'Fredoka, Nunito, sans-serif',
        fontStyle: '600',
        fontSize: '22px',
        color: '#ffffff',
        stroke: '#23306e',
        strokeThickness: 5,
      })
      .setOrigin(0.5, 1);
  }

  private addOther(p: Card): void {
    const old = this.others.get(p.id);
    if (old) this.dropOther(old);
    const hero = app.content.heroes[p.hero] ? p.hero : 'koala';
    const o: Other = {
      id: p.id,
      label: p.label,
      hero,
      puppet: this.makePuppet(hero),
      name: this.nameTag(p.label),
      x: p.x,
      y: p.y,
      tx: p.x,
      ty: p.y,
      d: DIRS.includes(p.d as Dir) ? (p.d as Dir) : 'down',
      c: p.c,
      fun: null,
      act: '',
      actT: 0,
      ribbonT: 0,
    };
    this.others.set(p.id, o);
  }
  private dropOther(o: Other): void {
    o.puppet.destroy();
    o.name.destroy();
    this.funEnded(o.id);
    for (const b of this.bubbles.filter((x) => x.id === o.id)) b.t = 0;
  }

  private setBall(b: BallCard): void {
    this.ball = b;
    this.ballT0 = performance.now() - b.age;
  }
  private showBest(): void {
    const S = app.content.strings;
    this.board.setText(`${S.meet_keepy ?? ''}\n${(S.meet_best ?? '').replace('{n}', String(this.best))}`);
  }

  /** Space in play: true when it went to the server (Keepy Uppy or the race) instead of the rules. */
  private space(): boolean {
    const g = this.g;
    if (!g || g.rt.fun) return false;
    const s = g.s;
    if (this.ball) {
      if (this.ballNow.h < LOW + 0.4 && Math.hypot(s.x - this.ballNow.x, s.y - this.ballNow.y) < REACH + 0.4) {
        this.link.kick();
        this.heroDo('swing', 0.35);
        return true;
      }
      return false;
    }
    if (Math.hypot(s.x - STAND.x, s.y - STAND.y) <= 2) {
      this.link.kick();
      this.heroDo('cheer', 0.8);
      return true;
    }
    if (!this.race && inBox(s.x, s.y)) {
      this.link.race();
      return true;
    }
    return false;
  }
  /** What Space does here, for the HUD's hint ('' for none: the rules' own hint is shown). */
  spaceHint(): string {
    const g = this.g;
    if (!g || g.rt.fun) return '';
    const s = g.s;
    if (this.ball)
      return this.ballNow.h < LOW + 0.4 && Math.hypot(s.x - this.ballNow.x, s.y - this.ballNow.y) < REACH + 0.4
        ? 'meet_hit'
        : '';
    if (Math.hypot(s.x - STAND.x, s.y - STAND.y) <= 2) return 'meet_keepy_go';
    if (!this.race && inBox(s.x, s.y)) return 'meet_race_go';
    return '';
  }

  private heroDo(clip: Clip | string, secs: number): void {
    this.actClip = clip;
    this.actT = secs;
  }

  // ---------------------------------------------------------------- what the server said
  private handle(m: In): void {
    switch (m.t) {
      case 'welcome':
        this.enter(m);
        break;
      case 'join':
        if (m.id === this.you) break;
        if (!this.others.has(m.id)) this.notes.push({ kind: 'join', who: m.label });
        this.addOther(m);
        break;
      case 'leave': {
        const o = this.others.get(m.id);
        if (!o) break;
        this.notes.push({ kind: 'leave', who: o.label });
        this.dropOther(o);
        this.others.delete(m.id);
        break;
      }
      case 'pos':
        for (const [id, x, y, d, c] of m.p) {
          const o = this.others.get(id);
          if (!o) continue;
          o.tx = x;
          o.ty = y;
          if (DIRS.includes(d as Dir)) o.d = d as Dir;
          o.c = c;
        }
        break;
      case 'fix':
        if (this.g && !this.g.rt.fun) {
          this.g.s.x = m.x;
          this.g.s.y = m.y;
          this.g.rt.px = m.x;
          this.g.rt.py = m.y;
        }
        break;
      case 'fun': {
        const o = this.others.get(m.id);
        const def = FUN[m.m as FunMove];
        if (!o || !def) break;
        this.funEnded(o.id);
        o.fun = {
          move: m.m as FunMove,
          obj: m.o,
          placed: 0,
          t: 0,
          secs: def.secs,
          x0: o.x,
          y0: o.y,
          ax: m.ax,
          ay: m.ay,
          bx: m.bx,
          by: m.by,
          dir: DIRS.includes(m.d as Dir) ? (m.d as Dir) : 'down',
          friend: 0,
          fpath: null,
          fpi: 0,
          fx: 0,
          fy: 0,
          fx0: 0,
          fy0: 0,
          ft: -1,
          beat: -1,
        };
        if (m.o >= 0) this.funObj.set(m.o, o.id);
        break;
      }
      case 'emo': {
        const o = this.others.get(m.id);
        if (!o || !this.g) break;
        const e = playEmote(this.fx, app.content.heroes[o.hero]?.emote, o.x, o.y);
        o.act = e.clip;
        o.actT = e.secs;
        break;
      }
      case 'say':
        this.bubble(m.id, m.text);
        break;
      case 'ph':
        this.bubble(m.id, app.content.strings[`meet_ph${m.n + 1}`] ?? '');
        break;
      case 'no':
      case 'slow':
      case 'muted':
        this.notes.push({ kind: m.t });
        break;
      case 'chat':
        this.chatOn = m.on;
        if (!m.on) this.notes.push({ kind: 'chatoff' });
        break;
      case 'ball':
        this.setBall(m);
        break;
      case 'hit': {
        const o = this.others.get(m.id);
        if (o) {
          o.act = 'swing';
          o.actT = 0.35;
        }
        Sound.sfx('pop', 0.6);
        this.fx.play('sparkle', this.ballNow.x, this.ballNow.y - this.ballNow.h, 3);
        break;
      }
      case 'land':
        this.ball = null;
        this.best = m.best;
        this.showBest();
        this.notes.push({ kind: 'land', n: m.n });
        break;
      case 'race':
        if (m.phase === 'count') {
          this.race = 'count';
          this.raceGoAt = performance.now() + (m.ms ?? 3000);
        } else if (m.phase === 'go') {
          this.race = 'run';
          this.notes.push({ kind: 'go' });
        } else {
          this.race = '';
          const win = m.win ?? '';
          const label = win === this.you ? (app.content.strings.meet_you ?? '') : (this.others.get(win)?.label ?? '');
          this.notes.push({ kind: win ? 'win' : 'nowin', who: label });
          if (win === this.you) this.myRibbonT = 6;
          else {
            const o = this.others.get(win);
            if (o) o.ribbonT = 6;
          }
        }
        break;
      default:
        break;
    }
  }

  /** A chat bubble over a player for 5 seconds (a new one from the same player replaces it). */
  private bubble(id: string, text: string): void {
    if (!text) return;
    for (const b of this.bubbles) if (b.id === id) b.t = 0;
    const style = {
      fontFamily: 'Fredoka, Nunito, sans-serif',
      fontSize: '24px',
      color: '#3b2a1a',
      wordWrap: { width: 300, useAdvancedWrap: true },
      align: 'center',
    } as Phaser.Types.GameObjects.Text.TextStyle;
    const t = screenText(this, 0, 0, text, style).setOrigin(0.5, 1);
    const w = Math.max(60, t.width + 28);
    const h = t.height + 18;
    const g = this.add.graphics();
    g.fillStyle(0xffffff, 0.95).fillRoundedRect(-w / 2, -h - 12, w, h, 14);
    g.fillTriangle(-10, -13, 10, -13, 0, 0);
    g.lineStyle(3, 0x3b2a1a, 0.5).strokeRoundedRect(-w / 2, -h - 12, w, h, 14);
    t.setPosition(0, -21);
    const box = this.add.container(0, 0, [g, t]).setDepth(91000);
    this.bubbles.push({ id, text, t: BUBBLE_SECS, box });
    this.events.emit('chatline', id, text);
  }

  /** The player's own line, from the HUD. */
  say(text: string): void {
    this.link.say(text);
  }
  phrase(n: number): void {
    this.link.phrase(n);
  }
  labelOf(id: string): string {
    if (id === this.you) return app.content.strings.meet_you ?? '';
    return this.others.get(id)?.label ?? '';
  }
  /** The way out: the line is closed and the title comes back. Nothing was saved. */
  leave(): void {
    this.link.close();
    this.scene.stop('MeetHud');
    this.scene.start('Title');
  }

  private funEnded(id: string): void {
    for (const [obj, who] of this.funObj)
      if (who === id) {
        this.things?.pose(obj, 0, 0, 0, 1);
        this.funObj.delete(obj);
      }
  }

  // ---------------------------------------------------------------- every frame
  update(_time: number, delta: number): void {
    const t0 = performance.now();
    pumpUploads();
    Sound.update();
    for (const m of this.link.inbox.splice(0)) this.handle(m);
    // the line broke after the hello (the server went, or this player came in on another screen)
    if (this.g && this.link.ended && !this.endedSaid) {
      this.endedSaid = true;
      this.notes.push({ kind: this.link.ended === 'replaced' ? 'replaced' : 'offline' });
    }
    const g = this.g;
    if (!g || !this.puppet) {
      this.jsMs = performance.now() - t0;
      return;
    }
    const dt = Math.min(delta, 100) / 1000;
    // the start box holds still for 3, 2, 1
    const hold = this.frozen || (this.race === 'count' && inBox(g.s.x, g.s.y));
    this.acc += Math.min(delta, 100);
    let n = 0;
    while (this.acc >= STEP && n < 5) {
      step(g, this.keys.next(hold));
      keepVisit(g);
      for (const ev of g.ev) {
        if (ev.t === 'act' && ev.kind === 'emote') {
          const e = playEmote(this.fx, app.content.heroes[g.s.hero]?.emote, g.s.x, g.s.y);
          this.heroDo(e.clip, e.secs);
          this.link.emote();
        } else if (ev.t === 'sfx' && ev.id !== 'coin') Sound.sfx(ev.id, 0.8);
      }
      g.ev.length = 0;
      this.acc -= STEP;
      n++;
    }
    if (n === 5) this.acc = 0;
    // a new turn on a swing or the like: the others are told once
    const fun = g.rt.fun;
    if (fun && fun !== this.lastFun) this.link.fun(fun.move, fun.obj, fun.ax, fun.ay, fun.bx, fun.by, fun.dir);
    this.lastFun = fun ?? null;
    this.draw(Math.min(1, this.acc / STEP), dt);
    this.jsMs = performance.now() - t0;
  }

  private draw(alpha: number, dt: number): void {
    const g = this.g!;
    const s = g.s;
    const rt = g.rt;
    const now = performance.now();
    const hx = (rt.px + (s.x - rt.px) * alpha) * T;
    const hy = (rt.py + (s.y - rt.py) * alpha) * T;
    const fun = rt.fun;
    const pose = fun ? funPose(fun, 0) : null;
    const me = this.puppet!;
    me.bias = pose ? (fun!.obj >= 0 ? this.things.funBias(fun!.obj, hy, FUN_BIAS) : FUN_BIAS) : 0;
    me.setPos(hx + (pose ? pose.sway * T : 0), hy);
    me.lift(pose ? pose.lift * T : 0, pose ? pose.ang : 0);
    let clip: Clip | string = pose ? pose.clip : rt.clip;
    if (this.actT > 0 && !pose) {
      this.actT -= dt;
      if (rt.clip === 'idle') clip = this.actClip;
      else this.actT = 0;
    }
    me.play(clip, s.dir);
    me.update(dt);
    me.setAlpha(pose ? pose.alpha : 1);
    this.fx.setHero(hx, hy);
    this.myName!.setPosition(hx, hy - (app.content.chars[s.hero]?.tall ?? 2) * T * 0.9 - 8).setDepth(90000);
    this.link.place(s.x, s.y, s.dir, typeof clip === 'string' ? clip : 'idle', now);
    // the thing she plays on moves with her
    if (fun && fun.obj >= 0) {
      const m = funThing(fun);
      this.things.pose(fun.obj, m.dx, m.dy, m.ang, m.sy);
      this.funObj.set(fun.obj, this.you);
    } else this.funEnded(this.you);
    // everyone else: towards the newest place, quickly; a jump of more than 3 tiles is a snap
    const k = Math.min(1, dt * 12);
    for (const o of this.others.values()) {
      const far = Math.hypot(o.tx - o.x, o.ty - o.y);
      if (far > 3) {
        o.x = o.tx;
        o.y = o.ty;
      } else {
        o.x += (o.tx - o.x) * k;
        o.y += (o.ty - o.y) * k;
      }
      let op: ReturnType<typeof funPose> | null = null;
      if (o.fun) {
        o.fun.t += dt;
        if (o.fun.t >= o.fun.secs || (o.fun.t > 0.4 && o.c === 'walk')) {
          o.fun = null;
          this.funEnded(o.id);
        } else {
          op = funPose(o.fun, 0);
          if (o.fun.obj >= 0) {
            const m = funThing(o.fun);
            this.things.pose(o.fun.obj, m.dx, m.dy, m.ang, m.sy);
          }
        }
      }
      const p = o.puppet;
      p.bias = op ? (o.fun!.obj >= 0 ? this.things.funBias(o.fun!.obj, o.y * T, FUN_BIAS) : FUN_BIAS) : 0;
      p.setPos((o.x + (op ? op.sway : 0)) * T, o.y * T);
      p.lift(op ? op.lift * T : 0, op ? op.ang : 0);
      let oc: string = op ? op.clip : o.c === 'walk' || far > 0.08 ? 'walk' : o.c;
      if (o.actT > 0) {
        o.actT -= dt;
        if (!op && oc !== 'walk') oc = o.act;
      }
      p.play(oc, o.d);
      p.update(dt);
      p.setAlpha(op ? op.alpha : 1);
      const top = o.y * T - (app.content.chars[o.hero]?.tall ?? 2) * T * 0.9 - 8;
      o.name.setPosition(o.x * T, top).setDepth(90000);
      if (o.ribbonT > 0) o.ribbonT -= dt;
    }
    this.drawRibbons(hx, hy - (app.content.chars[s.hero]?.tall ?? 2) * T * 0.9 - 40, dt);
    this.drawBubbles(hx, hy, dt);
    this.drawBall(now);
    // camera: on her, gently
    const cam = this.cameras.main;
    const ease = 1 - Math.exp(-dt * 8);
    this.camX += (hx - this.camX) * ease;
    this.camY += (hy - 40 - this.camY) * ease;
    cam.centerOn(this.camX, this.camY);
    this.sky.begin(NOON, false, false, s.xmas, 0, dt, cam.scrollX, cam.scrollY, false);
    const reducedMotion = s.opts.lowFx || prefersLessMotion();
    this.ground.update(cam, dt, { darkness: this.sky.level, paused: this.frozen, reducedMotion, winter: s.xmas });
    this.things.update(cam, this.frozen ? 0 : dt, s.xmas, (x, y, r) => this.sky.light(x, y, r), reducedMotion);
    this.sky.end();
    this.fx.update(dt);
    if (Math.floor(now / 1000) !== Math.floor((now - dt * 1000) / 1000))
      sweepChars(this, art.chars.sets[artOf(s.hero)]?.group ?? '');
  }

  private drawRibbons(hx: number, top: number, dt: number): void {
    if (this.myRibbonT > 0) this.myRibbonT -= dt;
    const want: [number, number][] = [];
    if (this.myRibbonT > 0) want.push([hx, top]);
    for (const o of this.others.values())
      if (o.ribbonT > 0) want.push([o.x * T, o.y * T - (app.content.chars[o.hero]?.tall ?? 2) * T * 0.9 - 40]);
    while (this.ribbons.length < want.length) this.ribbons.push(this.add.image(0, 0, ribbonTex(this)).setDepth(90001));
    this.ribbons.forEach((r, i) => {
      const w = want[i];
      r.setVisible(!!w);
      if (w) r.setPosition(w[0], w[1] + Math.sin(performance.now() / 300) * 3);
    });
    this.ribbon.setVisible(false);
  }

  private drawBubbles(hx: number, hy: number, dt: number): void {
    for (const b of this.bubbles) {
      b.t -= dt;
      let x = hx;
      let y = hy - (app.content.chars[this.g!.s.hero]?.tall ?? 2) * T * 0.9 - 36;
      if (b.id !== this.you) {
        const o = this.others.get(b.id);
        if (!o) {
          b.t = 0;
          continue;
        }
        x = o.x * T;
        y = o.y * T - (app.content.chars[o.hero]?.tall ?? 2) * T * 0.9 - 36;
      }
      b.box.setPosition(x, y).setAlpha(Math.min(1, b.t * 2));
    }
    for (const b of this.bubbles.filter((x) => x.t <= 0)) b.box.destroy();
    this.bubbles = this.bubbles.filter((x) => x.t > 0);
  }

  private drawBall(now: number): void {
    const b = this.ball;
    const on = !!b;
    this.ballImg.setVisible(on);
    this.ballShadow.setVisible(on);
    this.ballString.setVisible(on);
    if (!b) return;
    const at = ballAt(b, (now - this.ballT0) / 1000, this.ballNow);
    const x = at.x * T;
    const y = at.y * T;
    const lift = at.h * T;
    const sc = 1.1 + Math.min(0.4, at.h * 0.1);
    this.ballShadow
      .setPosition(x, y)
      .setScale(1 - Math.min(0.5, at.h * 0.12))
      .setDepth(y - 1);
    this.ballImg
      .setPosition(x, y - lift)
      .setScale(sc)
      .setDepth(y + 2000);
    this.ballString
      .clear()
      .lineStyle(2, 0xffffff, 0.7)
      .lineBetween(x, y - lift, x + 4, y - lift + 22)
      .setDepth(y + 1999);
  }
}

function inBox(x: number, y: number): boolean {
  return x >= RACE_BOX.x0 && x < RACE_BOX.x1 && y >= RACE_BOX.y0 && y < RACE_BOX.y1;
}
/** A hero's picture set: the Christmas one when the layer is on and it exists (as in the World scene). */
function artOf(id: string): string {
  return xmasNow() && art.chars.sets[id + '_xmas'] ? id + '_xmas' : id;
}
/** A small rosette for the race's winner, drawn once. */
function ribbonTex(scene: Phaser.Scene): string {
  const key = 'meet_ribbon';
  if (scene.textures.exists(key)) return key;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.fillStyle(0x2f6fd8, 1).fillTriangle(10, 22, 20, 22, 8, 44).fillTriangle(20, 22, 30, 22, 32, 44);
  g.fillStyle(0xf2b84b, 1).fillCircle(20, 18, 17);
  g.fillStyle(0xffe27a, 1).fillCircle(20, 18, 10);
  g.generateTexture(key, 40, 46);
  g.destroy();
  return key;
}
