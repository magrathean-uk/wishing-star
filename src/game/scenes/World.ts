// The world scene: runs the rules at a fixed 60 steps a second and draws what they say, smoothly, at any refresh rate.
import Phaser from 'phaser';
import { canPlace, placeables } from '../../core/build.ts';
import { toolTier } from '../../core/bag.ts';
import { RING_SPEED } from '../../core/bosses.ts';
import { count, isNight } from '../../core/cond.ts';
import { castleArt, castleOn, funPose, funThing } from '../../core/fun.ts';
import { plusOf, worn } from '../../core/gear.ts';
import { findTarget, toolInHand } from '../../core/hero.ts';
import { LAMP_ROOM, lampGlow, lampOn, lampShines } from '../../core/lamp.ts';
import { beamTexture } from '../ui/menus/lookout.ts';
import { CREEPER_BLAST, CREEPER_FUSE, FUSE } from '../../core/mobs.ts';
import { step } from '../../core/step.ts';
import { cast } from '../../core/talk.ts';
import type { Actor, Clip, Dir, Ev, Game, Mob } from '../../core/types.ts';
import { art, frameFor, PLACED_ART, pumpUploads, sweepChars, wantChar, worldFrame } from '../assets.ts';
import { Sound } from '../audio.ts';
import { hasTune } from '../music.ts';
import { FADE_PLACE, FADE_SCENE } from '../musicplayer.ts';
import { Keys } from '../input.ts';
import { prefersLessMotion, Puppet } from '../puppet.ts';
import { ActionMarks, BossLook, Fx, HIT_FLASH, HIT_TINT, WINDUP_TINT } from '../world/fx.ts';
import { playEmote } from '../world/emotes.ts';
import { FindSparkle } from '../world/sparkle.ts';
import { GlossPicture } from '../world/gloss.ts';
import { JockeyRider } from '../world/jockey.ts';
import { Ground } from '../world/ground.ts';
import { GoldRings } from '../world/rings.ts';
import { type ReflectionSource, WaterReflections } from '../world/reflections.ts';
import { Sky } from '../world/sky.ts';
import { Things, type CutPoint } from '../world/things.ts';

const T = 64;
const STEP = 1000 / 60;
/** The play view: about 24 by 13.5 tiles (phase 2, part G). A staged scene keeps 1.5, so its 1280 x 720 backdrop fills the screen. */
const ZOOM = 1.25;
const STAGE_ZOOM = 1.5;
const FRONT = 80000;
/** package 57a: she (and a friend) on a thing to play on draw in front of it */
const FUN_BIAS = 48;
/** the regions drawn in blocks, whose bright grass needs a deeper night (as BLOCKY in world/things.ts) */
const BLOCKY_LANDS = 'LFCMK';
/** Footstep sound per terrain letter (see TERRAIN in src/core/grid.ts); anything else is grass. */
const STEPS: Record<string, string> = {
  s: 'step_sand',
  a: 'step_sand',
  p: 'step_sand',
  k: 'step_stone',
  t: 'step_stone',
  e: 'step_stone',
  f: 'step_wood',
  b: 'step_wood',
  m: 'step_mud',
};
/**
 * Boss fights (phase 2, part D): the camera keeps the boss's head this many screen pixels below the top, clear of the
 * hearts and the banner lane, zooming out a little (never below BOSS_MIN_ZOOM) when she is far below him.
 */
const BOSS_TOP = 300;
/** ...and keeps her feet this many screen pixels above the bottom, clear of the hotbar. */
const BOSS_BOTTOM = 170;
const BOSS_MIN_ZOOM = 0.85;
/**
 * Heroes a helmet does not sit right on (tall ears, a hat or a helmet of their own): they wear a small crest on the
 * chest instead. Chosen from headless screenshots of all 14 heroes (test-results/gear/).
 */
const CREST = new Set<string>(['bluey', 'bing', 'flop', 'woody', 'buzz', 'jessie', 'paddington']);
/** The live-world cutscene that fills the Square with its own cast (src/data/scenes.ts). */
const FINALE = 'finale';
/** Emerald and ticket runs: one note for 1, a little climb for more. */
const RUN = [0, 2, 4, 7, 9, 12, 14, 16];

export class World extends Phaser.Scene {
  g!: Game;
  keys!: Keys;
  fx!: Fx;
  private boss!: BossLook;
  /** time spent in our own code this frame, for the frame gate */
  jsMs = 0;
  stepsRun = 0;
  private acc = 0;
  private ground!: Ground;
  private reflections!: WaterReflections;
  private reflectedSources: ReflectionSource[] = [];
  private surfaceState = { darkness: 0, paused: false, reducedMotion: false, winter: false };
  private things!: Things;
  /** G, 22 Nov 2026: the gold rings where Space starts a mini-game or puts a place step's thing */
  private rings!: GoldRings;
  private ringLight = (x: number, y: number, r: number, k: number): void => this.sky.light(x, y, r, k);
  private sky!: Sky;
  private hero!: Puppet;
  private heroId = '';
  private actors = new Map<number, Puppet>();
  private cutActors = new Map<string, Puppet>();
  private seen = new Set<number>();
  private marks: Phaser.GameObjects.Image[] = [];
  /** the creeper's blast ring, dozing mobs and her arrow count */
  private action!: ActionMarks;
  private shotsSeen = 0;
  private shotShowT = 0;
  private shots: Phaser.GameObjects.Image[] = [];
  private tool!: Phaser.GameObjects.Image;
  private swingItem: string | null = null;
  /** The axe keeps its tree target for the follow-through, even after the last hit leaves a stump. */
  private axeTarget: { area: string; index: number; point: CutPoint } | null = null;
  /** her bow, drawn for a moment as she shoots */
  private bowImg!: Phaser.GameObjects.Image;
  private bowShowT = 0;
  /** glints already made this swing (an upgraded sword sparkles once or twice a swing) */
  private glints = 0;
  /** the camera's zoom without the juice: ZOOM, or a little less in a boss fight */
  private baseZoom = ZOOM;
  /** item pictures on the gear boards of this area */
  private boardIcons: Phaser.GameObjects.Image[] = [];
  private bobber!: Phaser.GameObjects.Image;
  private line!: Phaser.GameObjects.Graphics;
  private cursor!: Phaser.GameObjects.Rectangle;
  private ghost!: Phaser.GameObjects.Image;
  private backdrop!: Phaser.GameObjects.Image;
  private fade!: Phaser.GameObjects.Rectangle;
  private areaId = '';
  private camX = 0;
  private camY = 0;
  private shakeAmt = 0;
  private t = 0;
  /** seconds the drawn moment is behind the last tick (package 71) */
  private lag = 0;
  /** the UI scene sets this while a menu is open */
  menuOpen = false;
  // juice: a short clip the hero plays for what she just did, hit-stop, camera hold and zoom, coin runs
  private actClip: Clip = 'idle';
  private actT = 0;
  private actNew = false;
  private stopMs = 0;
  private holdT = 0;
  private zoomPeak = 0;
  private zoomHoldT = 0;
  private zoomAdd = 0;
  /** extra depth for her when a boss or an animal stands over her (last frame's, so she is set once a frame) */
  private heroLift = 0;
  /** package 57a: the thing and the friend of the last turn on a thing to play on, to put back after it */
  private funObj = -1;
  private funMate = 0;
  /** package 71: the sandcastles' pictures (two each: the castle and, until Codex's pictures come, a tower on top) */
  private castleImgs: Phaser.GameObjects.Image[] = [];
  /** package 73a (I2): the lamp's two beams over the bay at night, and its glow in the lamp room */
  private lampFx: Phaser.GameObjects.Image[] = [];
  private beamA = -Math.PI / 2;
  private stepN = 0;
  private batchSfx = '';
  private sparkle = new FindSparkle();
  private gloss: GlossPicture | null = null;
  private jockey: JockeyRider | null = null;
  private coinPending = false;
  private coinRun = 0;
  private lightTick = -1;
  private shardTick = -1;
  private lightWait = 0;
  private lastConfetti = { x: 0, y: 0 };
  // a cutscene holds on its first frame until its whole cast can be drawn
  private castId = '';
  private castT = -1;
  private castIds: string[] = [];

  constructor() {
    super('World');
  }

  create(): void {
    // The scene object lives on when the scene starts again (back from the title): pictures made last time are dead.
    this.marks = [];
    this.shots = [];
    this.boardIcons = [];
    this.g = this.registry.get('game') as Game;
    this.keys = new Keys(this);
    Sound.init(this);
    const cam = this.cameras.main;
    cam.setZoom(ZOOM);
    cam.setRoundPixels(false);
    this.ground = new Ground(this);
    this.reflections = new WaterReflections(this);
    this.things = new Things(this, this.g);
    this.fx = new Fx(this);
    this.boss = new BossLook(this, this.fx);
    this.action = new ActionMarks(this, this.fx);
    this.sky = new Sky(this);
    this.rings = new GoldRings(this);
    const mk = (key: string, draw: (g: Phaser.GameObjects.Graphics) => void, w: number, h: number) => {
      if (this.textures.exists(key)) return;
      const gr = this.make.graphics({ x: 0, y: 0 }, false);
      draw(gr);
      gr.generateTexture(key, w, h);
      gr.destroy();
    };
    mk(
      'ui_arrowshot',
      (g) => g.fillStyle(0xe8e0d0, 1).fillRect(0, 5, 30, 4).fillStyle(0x8a8a96, 1).fillTriangle(30, 0, 40, 7, 30, 14),
      40,
      14,
    );
    mk(
      'ui_bobber',
      (g) => g.fillStyle(0xffffff, 1).fillCircle(10, 10, 9).fillStyle(0xff4a4a, 1).fillRect(1, 1, 18, 9),
      20,
      20,
    );
    this.tool = this.add.image(0, 0, '__DEFAULT').setVisible(false);
    this.bowImg = this.add.image(0, 0, '__DEFAULT').setVisible(false);
    this.bobber = this.add.image(0, 0, 'ui_bobber').setVisible(false);
    this.line = this.add.graphics();
    this.cursor = this.add
      .rectangle(0, 0, T, T, 0x7be37b, 0.35)
      .setOrigin(0, 0)
      .setStrokeStyle(4, 0xffffff, 1)
      .setVisible(false)
      .setDepth(70000);
    this.ghost = this.add.image(0, 0, '__DEFAULT').setVisible(false).setAlpha(0.7).setDepth(70001);
    this.backdrop = this.add
      .image(0, 0, '__DEFAULT')
      .setOrigin(0, 0)
      .setVisible(false)
      .setDepth(FRONT - 10);
    this.fade = this.add
      .rectangle(0, 0, this.scale.width, this.scale.height, 0x000000, 1)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(95000)
      .setAlpha(0);
    this.makeHero();
    this.enterArea(true);
    if (!this.scene.isActive('UI')) this.scene.launch('UI');
    this.events.once('shutdown', () => {
      this.reflections.destroy();
      this.reflectedSources.length = 0;
      this.actors.clear();
      this.cutActors.clear();
    });
  }

  /** Swap in another save (Continue, Import, a new game). */
  setGame(g: Game): void {
    this.g = g;
    this.registry.set('game', g);
    this.things.setGame(g);
    for (const p of this.actors.values()) p.destroy();
    this.actors.clear();
    this.makeHero();
    this.enterArea(true);
  }

  private tallOf(id: string): number {
    const c = this.g.c;
    return c.chars[id]?.tall ?? c.mobs[id]?.tall ?? c.animals[id]?.tall ?? 2;
  }
  /** The art set for a character: Grandad wears his red hat when the Christmas layer is on, and so on. */
  private artOf(id: string): string {
    if (this.g.s.xmas && art.chars.sets[id + '_xmas']) return id + '_xmas';
    const alias: Record<string, string> = {
      villager_1: 'villager_a',
      villager_3: 'villager_a',
      trader: 'villager_a',
      villager_2: 'villager_b',
      villager_trader: 'villager_b',
      mini_creeper: 'creeper',
    };
    return alias[id] ?? id;
  }
  private makeHero(): void {
    if (this.hero) this.hero.destroy();
    this.heroId = this.g.s.hero;
    this.hero = new Puppet(this, this.artOf(this.heroId), this.tallOf(this.heroId));
    this.hero.onStep = () => this.footstep();
  }

  /** Dust and a soft footstep that matches the ground, alternating feet so it never sounds like a machine. */
  private footstep(): void {
    const g = this.g;
    const s = g.s;
    if (g.rt.mode !== 'play') return;
    const a = g.c.areas[s.area]!;
    const c = a.terrain[Math.floor(s.y)]?.charAt(Math.floor(s.x)) ?? 'g';
    let id = STEPS[c] ?? 'step_grass';
    const snow = s.xmas && !a.indoor && (id === 'step_grass' || c === 'p');
    if (snow) id = 'step_snow';
    this.fx.play(
      'footstep',
      this.hero.shadow.x / T,
      (this.hero.shadow.y - 2) / T,
      this.hero.height,
      snow ? 'snow' : undefined,
    );
    this.stepN++;
    Sound.sfx(id, this.stepN % 2 ? 0.75 : 0.6, 0, this.stepN % 2 ? 1 : 0.9);
  }

  /** The hero plays a short clip for what she just did (only over standing still: walking and swinging win). */
  private heroDo(clip: Clip, secs: number): void {
    this.actT = clip === this.actClip && this.actT > 0 ? Math.max(this.actT, secs) : secs;
    this.actClip = clip;
    this.actNew = true;
  }

  /** Zoom in a touch and keep the camera on her for a beat. Fewer effects keeps the hold but not the zoom. */
  private pulse(add: number, hold: number): void {
    this.holdT = Math.max(this.holdT, hold + 0.4);
    if (this.g.s.opts.lowFx) return;
    this.zoomPeak = this.zoomHoldT > 0 ? Math.max(this.zoomPeak, add) : add;
    this.zoomHoldT = Math.max(this.zoomHoldT, hold);
  }
  private shake(amt: number): void {
    if (!this.g.s.opts.lowFx) this.shakeAmt = Math.max(this.shakeAmt, amt);
  }

  /** A star shard: the biggest moment of a chapter after the light. */
  private shardMoment(): void {
    const s = this.g.s;
    this.shardTick = this.g.rt.tick;
    this.shake(9);
    this.fx.play('shardburst', s.x, s.y);
    this.pulse(0.25, 1.1);
    this.heroDo('cheer', 2);
    this.stopMs = Math.max(this.stopMs, 70);
  }

  /** A region lights up: warm wash, chime, camera ease. Two regions on one shard share one wash. */
  private lightMoment(): void {
    if (this.lightTick === this.g.rt.tick) return;
    this.lightTick = this.g.rt.tick;
    // After a shard, wait for its banner to finish, so the light lands with its own banner.
    if (this.shardTick === this.g.rt.tick) this.lightWait = 1.95;
    else this.lightNow();
  }
  private lightNow(): void {
    const s = this.g.s;
    this.fx.play('light', s.x, s.y);
    Sound.sfx('glow', 0.9);
    Sound.arp('bell', [0, 4, 7, 12, 16, 19, 24], 0.1, 0.8);
    this.pulse(0.18, 1.6);
    this.heroDo('cheer', 2.4);
  }

  private enterArea(instant = false): void {
    const s = this.g.s;
    this.areaId = s.area;
    const area = this.g.c.areas[s.area]!;
    this.ground.setArea(area, s.xmas);
    this.reflections.setArea(area);
    this.things.setArea(area);
    this.makeBoards();
    for (const p of this.actors.values()) p.destroy();
    this.actors.clear();
    this.camX = s.x * T;
    this.camY = s.y * T;
    if (!instant) {
      this.fade.setAlpha(1);
      this.tweens.add({ targets: this.fade, alpha: 0, duration: 320 });
    }
    this.enterMusic(FADE_PLACE);
  }

  /**
   * Gear boards (phase 2, part E): at the way into a tough region, the sword and the armour that suit it are pinned
   * to the board as pictures. The board's art is drawn by Things; the two pictures sit on its panel.
   */
  private makeBoards(): void {
    for (const img of this.boardIcons) img.destroy();
    this.boardIcons.length = 0;
    const area = this.g.c.areas[this.g.s.area]!;
    for (const o of area.objects) {
      if (o.type !== 'gear_board' || !o.d) continue;
      const ids = o.d.split(',');
      const bottom = (o.y + 1) * T;
      ids.forEach((id, i) => {
        const f = frameFor(this, id, 96, 96);
        const img = this.add.image((o.x + 1 + (i - (ids.length - 1) / 2) * 0.82) * T, bottom - 76, f.key, f.frame);
        const size = Math.max(img.width, img.height) || 96;
        img.setScale(46 / size).setDepth(bottom - 5);
        this.boardIcons.push(img);
      });
    }
  }

  private handle(ev: Ev): void {
    const s = this.g.s;
    switch (ev.t) {
      case 'sfx': {
        if (ev.id.startsWith('push')) {
          // package 74 (I8): a good push on the swing, each one a step higher
          const n = Number(ev.id.slice(4)) || 1;
          Sound.sfx('windup', 0.7, 0, 0.8 + 0.25 * n);
          Sound.sfx('whoosh', 0.6, 0, 0.9 + 0.12 * n);
          break;
        }
        let vol = 1;
        let pan = 0;
        if (ev.x !== undefined && ev.y !== undefined) {
          const d = Math.hypot(ev.x - s.x, ev.y - s.y);
          vol = Math.max(0, 1 - d / 16);
          pan = (ev.x - s.x) / 12;
        }
        if (ev.id === 'coin') {
          // decided at the end of the step: an emerald toast in the same step turns it into a run
          this.coinPending = true;
          break;
        }
        if (vol > 0.02) Sound.sfx(ev.id, vol, pan);
        this.batchSfx = ev.id;
        this.sfxJuice(ev.id);
        break;
      }
      case 'fx':
        if (ev.id === 'word') {
          // package 71: a stroked animal's word, over it for a moment
          this.fx.word(this.g.c.strings[ev.item ?? ''] ?? '', ev.x, ev.y);
          break;
        }
        if (ev.id === 'hit' && ev.n !== undefined) this.things.shake(ev.n);
        this.fx.play(ev.id, ev.x, ev.y, ev.id === 'hit' ? 0 : (ev.n ?? 0), ev.item);
        if (ev.id === 'pop' || ev.id === 'pickup') this.hero.bump(0.08);
        if (ev.id === 'hitmob') this.stopMs = Math.max(this.stopMs, 50);
        else if (ev.id === 'ripple' && this.batchSfx !== 'plop') Sound.sfx('plop', 0.4, 0, 1.3);
        else if (ev.id === 'giveitem') Sound.sfx('give', 0.8);
        else if (ev.id === 'shootingstar') Sound.sfx('twinkle', 0.7);
        else if (ev.id === 'dizzy') Sound.sfx('dizzy', 0.9);
        else if (ev.id === 'thump') Sound.sfx('thump', 0.9);
        else if (ev.id === 'hopmark') Sound.sfx('windup', 0.6);
        else if (ev.id === 'confetti') {
          this.lastConfetti.x = ev.x;
          this.lastConfetti.y = ev.y;
        }
        break;
      case 'shake':
        this.shake(ev.amt);
        break;
      case 'flash':
        // Fewer effects: no full-screen flash
        if (!s.opts.lowFx) this.cameras.main.flash(180, 255, 250, 220, false);
        break;
      case 'toast':
        if (ev.kind === 'item' && (ev.item === 'emerald' || ev.item === 'ticket')) this.coinRun += ev.n ?? 1;
        break;
      case 'reward':
        this.rewardJuice(ev.kind, ev.id);
        break;
      case 'act':
        this.actJuice(ev.kind);
        if (ev.kind === 'shoot') this.bowShowT = 0.3;
        break;
      case 'gear':
        if (ev.kind === 'shieldHurt') Sound.sfx('shield', 0.7);
        else if (ev.kind === 'shieldBack') this.fx.play('sparkle', s.x, s.y, 3);
        else if (ev.kind === 'worn') this.hero.bump(0.1);
        break;
      case 'light':
        this.lightMoment();
        break;
      case 'area':
        this.enterArea();
        break;
      case 'music':
        if (ev.id) Sound.music(ev.id);
        else this.enterMusic(FADE_SCENE);
        break;
      default:
        break;
    }
    this.events.emit('ev', ev);
  }
  /** Extra picture for things the rules only give a sound. */
  private sfxJuice(id: string): void {
    const s = this.g.s;
    switch (id) {
      case 'swing':
        if (this.g.rt.clip === 'swing') {
          // Holding the action key can begin the next stroke in the same rule tick that finished the last one.
          this.swingItem = toolInHand(this.g);
          this.axeTarget = null;
          this.latchAxeTarget();
          this.glints = 0;
          this.hero.play('swing', s.dir, true);
        }
        break;
      case 'ouch':
        this.stopMs = Math.max(this.stopMs, 34);
        break;
      case 'cast':
        this.fx.play('cast', s.x, s.y);
        break;
      case 'chest':
      case 'catch':
      case 'shard':
        this.heroDo('cheer', 1);
        break;
      case 'craft':
      case 'smelt':
      case 'place':
      case 'plant':
        this.heroDo('swing', 0.35);
        break;
      case 'dusk':
      case 'night':
        this.fx.play('night', s.x, s.y);
        break;
      case 'dawn':
      case 'morning':
        this.fx.play('dawn', s.x, s.y);
        break;
      case 'lullaby':
        this.fx.play('zzz', s.x, s.y);
        break;
      default:
        break;
    }
  }

  private rewardJuice(kind: string, id: string): void {
    const s = this.g.s;
    switch (kind) {
      case 'shard':
        this.shardMoment();
        break;
      case 'quest':
        this.heroDo('cheer', 1.5);
        this.fx.play('questdone', s.x, s.y);
        this.shake(4);
        break;
      case 'friend':
        this.heroDo('wave', 1.3);
        break;
      case 'heart':
        this.fx.play('heart', s.x, s.y, 5);
        break;
      case 'hero':
        this.fx.play('sparkle', s.x, s.y, 6);
        break;
      case 'secret':
        if (id.startsWith('sign:')) {
          this.fx.play('sparkle', s.x, s.y, 4);
          this.heroDo('cheer', 1);
        }
        break;
      case 'sticker': {
        // a boss sticker means the boss was just calmed or beaten
        const mob = id.startsWith('mob_') ? this.g.c.mobs[id.slice(4)] : undefined;
        if (mob?.role === 'boss') {
          const at = this.lastConfetti;
          this.fx.play('bossburst', at.x || s.x, at.y || s.y);
          this.shake(10);
          this.stopMs = Math.max(this.stopMs, 90);
          Sound.sfx('burst', 0.8);
          this.heroDo('cheer', 1.8);
        }
        break;
      }
      default:
        break;
    }
  }

  private actJuice(kind: string): void {
    const s = this.g.s;
    switch (kind) {
      case 'gather':
        // by hand: a reach and a bob (with a tool she is already swinging)
        if (this.g.rt.clip !== 'swing') this.heroDo('swing', 0.3);
        this.hero.bump(0.1);
        break;
      case 'find':
      case 'build':
      case 'hug':
      case 'fish':
      case 'hero':
        this.heroDo('cheer', 1.1);
        break;
      case 'eat':
        this.heroDo('cheer', 0.6);
        this.hero.bump(0.12);
        break;
      case 'letter':
      case 'pat':
      case 'collect':
      case 'lead':
        this.heroDo('wave', 0.8);
        break;
      case 'travel':
        this.heroDo('wave', 0.9);
        this.fx.play('sparkle', s.x, s.y, 2);
        break;
      case 'defeat':
        this.shake(3);
        break;
      case 'emote': {
        const e = playEmote(this.fx, this.g.c.heroes[s.hero]?.emote, s.x, s.y);
        this.heroDo(e.clip, e.secs);
        break;
      }
      default:
        break;
    }
  }

  /** Music follows the place (D86): the room's tune, or on the island the region's, hushed at night. */
  private enterMusic(fade: number): void {
    Sound.place(() => {
      const s = this.g.s;
      const area = this.g.c.areas[s.area]!;
      if (area.music && area.id !== 'island') return area.music;
      const region = Object.values(this.g.c.regions).find(
        (r) => r.code === area.region[Math.floor(s.y)]?.charAt(Math.floor(s.x)),
      );
      const id = region?.music ?? 'home';
      return isNight(this.g) && hasTune(`${id}_night`) ? `${id}_night` : id;
    }, fade);
  }

  update(_time: number, delta: number): void {
    const t0 = performance.now();
    const g = this.g;
    pumpUploads();
    Sound.update();
    g.rt.paused = this.menuOpen || this.castHold(delta / 1000);
    this.fx.paused = this.menuOpen;
    this.fx.low = g.s.opts.lowFx;
    if (this.stopMs > 0 && !this.menuOpen) {
      // hit-stop: the world holds for two or three frames so a hit lands
      this.stopMs -= Math.min(delta, 100);
      this.stepsRun = 0;
      this.draw(Math.min(1, this.acc / STEP), 0);
      this.jsMs = performance.now() - t0;
      return;
    }
    this.acc += Math.min(delta, 100);
    let n = 0;
    while (this.acc >= STEP && n < 5) {
      step(g, this.keys.next(this.menuOpen));
      if (g.ev.length) {
        this.batchSfx = '';
        for (let i = 0; i < g.ev.length; i++) this.handle(g.ev[i]!);
        g.ev.length = 0;
        this.flushCoins();
      }
      this.acc -= STEP;
      n++;
    }
    if (n === 5) this.acc = 0;
    this.stepsRun = n;
    this.sparkle.update(g, this.fx, delta / 1000, this.menuOpen || g.rt.mode !== 'play');
    (this.gloss ??= new GlossPicture(this)).update(g, delta / 1000);
    this.draw(Math.min(1, this.acc / STEP), delta / 1000);
    this.jsMs = performance.now() - t0;
  }

  /**
   * True while a cutscene that just started waits for its cast's pictures (at most 4 s), so nobody pops in
   * half way through. The rules stand still meanwhile; a staged scene already shows its backdrop.
   */
  private castHold(dt: number): boolean {
    const cut = this.g.rt.cut;
    if (!cut) {
      this.castId = '';
      return false;
    }
    if (cut.id !== this.castId) {
      this.castId = cut.id;
      this.castT = 0;
      const ids = new Set<string>([this.artOf(this.g.s.hero)]);
      for (const a of this.g.c.cutscenes[cut.id]?.acts ?? [])
        if (a.who && a.who !== 'you') ids.add(this.artOf(cast(this.g, a.who)));
      this.castIds = [...ids];
    }
    if (this.castT < 0) return false;
    this.castT += Math.min(dt, 0.1);
    let ready = true;
    for (const id of this.castIds) if (art.chars.sets[id] && !wantChar(this, id)) ready = false;
    if (ready || this.castT > 4) {
      this.castT = -1;
      return false;
    }
    return true;
  }

  /** 1 emerald is a tick; 10 is a little run of notes; 100 is a longer one. */
  private flushCoins(): void {
    const n = this.coinRun;
    if (n > 1) {
      const notes = Math.min(RUN.length, 1 + Math.ceil(Math.log2(n)));
      Sound.arp('coin', RUN.slice(0, notes), 0.065, 0.8);
    } else if (n === 1 || this.coinPending) Sound.sfx('coin');
    this.coinRun = 0;
    this.coinPending = false;
  }

  private puppetFor(a: Actor): Puppet {
    let p = this.actors.get(a.k);
    if (!p) {
      p = new Puppet(this, this.artOf(a.id), this.tallOf(a.id));
      this.actors.set(a.k, p);
    }
    return p;
  }

  private draw(alpha: number, dt: number): void {
    const g = this.g;
    const s = g.s;
    const rt = g.rt;
    // Package 71 (D78): while the rules stand still (a menu) the last tick is drawn as it is, so nothing wobbles
    if (rt.paused) alpha = 1;
    // how far the drawn moment is behind the last tick, in seconds: things timed by the rules' clock use it so they
    // move on every frame of a 120 a second screen, not every other one
    this.lag = (1 - alpha) / 60;
    this.t += dt;
    // effect timers hold while a menu is open
    const edt = this.menuOpen ? 0 : dt;
    if (s.area !== this.areaId) this.enterArea();
    if (s.hero !== this.heroId) this.makeHero();
    const cut = rt.cut;
    const stage = !!cut?.backdrop;
    const bias = stage ? FRONT : 0;
    // hero
    const hx = (rt.px + (s.x - rt.px) * alpha) * T;
    const hy = (rt.py + (s.y - rt.py) * alpha) * T;
    // package 57a: on a thing to play on she bounces, swings or sits, drawn in front of it
    const fun = rt.fun;
    const funT = fun ? fun.t - this.lag : 0;
    const pose = fun ? funPose(fun, 0, funT) : null;
    this.hero.bias = bias + this.heroLift + (pose ? this.funBias(hy) : 0);
    this.hero.setPos(hx + (pose ? pose.sway * T : 0), hy);
    this.hero.lift(pose ? pose.lift * T : 0, pose ? pose.ang : 0);
    let clip: Clip | string = pose ? pose.clip : rt.clip;
    if (this.actT > 0 && !pose) {
      this.actT -= edt;
      if (rt.clip === 'idle' || (rt.clip === 'fish' && this.actClip === 'cheer')) clip = this.actClip;
      else if (rt.clip === 'walk') this.actT = 0;
    }
    // her helmet, placed from the top of each frame (or a small crest on heroes it does not suit)
    const helm = worn(g, 'helmet');
    this.hero.setHat(helm ? frameFor(this, helm, 96, 96) : null, CREST.has(s.hero));
    const talkVisible = !rt.paused && !rt.card;
    this.hero.playDialogue(
      clip,
      s.dir,
      rt.talk,
      s.hero,
      talkVisible,
      this.actNew && clip === this.actClip,
      !!cut && !pose && this.actT <= 0,
    );
    this.actNew = false;
    this.hero.update(rt.paused && clip === 'swing' ? 0 : dt);
    this.hero.setVisible(!(stage && s.x < -2));
    this.hero.setAlpha(rt.safeT > 0 && Math.floor(rt.safeT * 14) % 2 ? 0.45 : pose ? pose.alpha : 1);
    this.fx.setHero(hx, hy);
    // everyone else
    const seen = this.seen;
    seen.clear();
    let lift = 0;
    let mi = 0;
    this.action.begin(edt);
    if (!stage) {
      // the finale brings its own guests to the Square: the people who live there step aside and the night's mobs
      // and animals stay out of the picture, so only its cast shows (their puppets go and come back after)
      const crowd = cut?.id === FINALE;
      for (const n of rt.npcs) {
        // only people near the screen get a puppet
        if (Math.abs(n.x - s.x) > 17 || Math.abs(n.y - s.y) > 12) continue;
        seen.add(n.k);
        const p = this.puppetFor(n);
        const hidden = !!cut && (crowd || !!cut.actors[n.id]);
        p.setVisible(!hidden);
        if (hidden) continue;
        const x = (n.px + (n.x - n.px) * alpha) * T;
        const y = (n.py + (n.y - n.py) * alpha) * T;
        // the friend who joined her on a swing or a trampoline plays alongside (package 57a)
        const mate = fun?.friend === n.k ? funPose(fun, 1, funT) : null;
        p.bias = mate && fun!.ft >= 0 ? this.funBias(y) : 0;
        p.setPos(x + (mate ? mate.sway * T : 0), y);
        p.lift(mate ? mate.lift * T : 0, mate ? mate.ang : 0);
        if (mate) p.setAlpha(mate.alpha);
        else if (this.funMate === n.k) p.setAlpha(1);
        p.playDialogue(mate ? mate.clip : n.clip, n.dir, rt.talk, n.id, talkVisible);
        p.update(dt);
        if (n.mark) this.mark(mi++, x, y - p.height - 26, n.mark);
      }
      for (const m of rt.mobs) {
        if (crowd) continue;
        seen.add(m.k);
        this.drawMob(m, alpha, dt);
        const p = this.actors.get(m.k);
        if (p && !m.gone) lift = this.liftOver(lift, p, hx, hy);
      }
      for (const b of rt.beasts) {
        if (crowd || Math.abs(b.x - s.x) > 17 || Math.abs(b.y - s.y) > 12) continue;
        seen.add(b.k);
        const p = this.puppetFor(b);
        p.setPos((b.px + (b.x - b.px) * alpha) * T, (b.py + (b.y - b.py) * alpha) * T);
        // package 74 (I10): her pet's trick: a little jump, or a wobble as it spins round
        const tt = b.trick ? Math.max(0, (b.trickT ?? 0) - (1 - alpha) / 60) : 0;
        p.lift(
          b.trick === 3 ? 0.7 * T * Math.sin(Math.PI * Math.min(1, tt / 0.7)) : 0,
          b.trick === 2 ? 8 * Math.sin(tt * 20) : 0,
        );
        p.play(b.clip, b.dir);
        p.update(dt);
        lift = this.liftOver(lift, p, hx, hy);
      }
    }
    this.heroLift = lift;
    for (const [k, p] of this.actors)
      if (!seen.has(k)) {
        if (stage) p.setVisible(false);
        else {
          p.destroy();
          this.actors.delete(k);
        }
      }
    for (let i = mi; i < this.marks.length; i++) this.marks[i]!.setVisible(false);
    this.action.end();
    this.drawArrowCount(hx, hy, stage, edt);
    // cutscene actors
    if (cut) {
      for (const id in cut.actors) {
        const a = cut.actors[id]!;
        let p = this.cutActors.get(id);
        if (!p) this.cutActors.set(id, (p = new Puppet(this, this.artOf(id), this.tallOf(id))));
        p.bias = bias;
        p.setPos((a.px + (a.x - a.px) * alpha) * T, (a.py + (a.y - a.py) * alpha) * T);
        // A staged speaker pauses their wave, cheer or calm pose until the conversation is over.
        p.playDialogue(a.clip, a.dir, rt.talk, id, talkVisible, false, true);
        p.update(dt);
      }
    }
    (this.jockey ??= new JockeyRider(this)).update(this.g, alpha, dt);
    for (const [id, p] of this.cutActors)
      if (!cut?.actors[id]) {
        p.destroy();
        this.cutActors.delete(id);
      }
    this.drawShots();
    this.boss.end(g, hx, hy, this.hero.height, edt);
    this.drawBow(hx, hy, edt);
    this.drawFishing(hx, hy);
    this.drawBuild();
    // backdrop for staged scenes
    if (stage) {
      const f = frameFor(this, cut!.backdrop!, 1280, 720);
      // backdrops share an atlas page: compare the frame too, or the boom never replaces the creeper's night
      if (this.backdrop.texture.key !== f.key || (f.frame && this.backdrop.frame.name !== f.frame))
        this.backdrop.setTexture(f.key, f.frame);
      this.backdrop.setVisible(true).setDisplaySize(1280, 720).setPosition(0, 0);
    } else this.backdrop.setVisible(false);
    // camera
    const cam = this.cameras.main;
    const area = g.c.areas[s.area]!;
    let tx = hx;
    let ty = hy - 40;
    if (this.lightWait > 0 && (this.lightWait -= edt) <= 0) this.lightNow();
    if (this.holdT > 0) this.holdT -= edt;
    if (this.zoomHoldT > 0) this.zoomHoldT -= edt;
    const wantZoom = this.zoomHoldT > 0 ? this.zoomPeak : 0;
    this.zoomAdd += (wantZoom - this.zoomAdd) * (1 - Math.exp(-edt * (wantZoom > this.zoomAdd ? 5 : 2.2)));
    if (stage) this.zoomAdd = 0;
    // a boss fight: room for his head below the banner lane and for her below him
    const boss = stage || cut?.cam || rt.build ? null : this.fightBoss();
    // his drawn head (a crown, a rider) stands a little above his height in tiles
    const bossHead = boss ? (boss.y - (g.c.mobs[boss.id]?.tall ?? 2) * 1.15 - 0.35) * T : 0;
    let want = ZOOM;
    if (boss) {
      const span = Math.max(T, hy + 0.2 * T - bossHead);
      want = Math.max(BOSS_MIN_ZOOM, Math.min(ZOOM, (cam.height - BOSS_TOP - BOSS_BOTTOM) / span));
    }
    this.baseZoom += (want - this.baseZoom) * (1 - Math.exp(-edt * 2.5));
    const zoom = (stage ? STAGE_ZOOM : this.baseZoom) + (this.zoomAdd > 0.002 ? this.zoomAdd : 0);
    if (cam.zoom !== zoom) cam.setZoom(zoom);
    if (stage) {
      tx = 640;
      ty = 360;
    } else if (this.holdT > 0) {
      // hold the camera on her for the big moments
    } else if (cut?.cam) {
      tx = cut.cam.x * T;
      ty = cut.cam.y * T;
    } else if (rt.build) {
      tx = (rt.build.cx + 0.5) * T;
      ty = (rt.build.cy + 0.5) * T;
    }
    const vw = cam.width / zoom;
    const vh = cam.height / zoom;
    let aw = area.w * T;
    // a room whose far part is still walled off is centred on the part she can use (package 46: the cottage)
    for (const b of area.barriers) if (b.art === 'wall' && !s.flags[b.flag]) aw = Math.min(aw, (b.rect.x + 1) * T);
    const ah = area.h * T;
    if (boss && !this.holdT) {
      // his head stays below the banner lane; she stays on screen; he stays on screen side to side
      const maxTy = bossHead - BOSS_TOP / zoom + vh / 2;
      const minTy = hy + 0.2 * T + BOSS_BOTTOM / zoom - vh / 2;
      ty = Math.max(minTy, Math.min(maxTy, ty));
      const bx = boss.x * T;
      tx = Math.max(bx - vw / 2 + 1.5 * T, Math.min(bx + vw / 2 - 1.5 * T, tx));
      tx = Math.max(hx - vw / 2 + T, Math.min(hx + vw / 2 - T, tx));
    }
    tx = aw <= vw ? aw / 2 : Math.max(vw / 2, Math.min(aw - vw / 2, tx));
    // in a boss fight the camera may look a little past the top wall, so a boss near it keeps his head on screen
    if (boss) {
      if (ah > vh) ty = Math.min(ah - vh / 2, ty);
    } else ty = ah <= vh ? ah / 2 : Math.max(vh / 2, Math.min(ah - vh / 2, ty));
    if (stage) {
      this.camX = 640;
      this.camY = 360;
    } else {
      const k = 1 - Math.exp(-dt * (cut ? 4 : 9));
      this.camX += (tx - this.camX) * k;
      this.camY += (ty - this.camY) * k;
    }
    let sx = 0;
    let sy = 0;
    if (this.shakeAmt > 0.2 && !this.menuOpen) {
      sx = (Math.random() - 0.5) * this.shakeAmt;
      sy = (Math.random() - 0.5) * this.shakeAmt;
      this.shakeAmt *= Math.exp(-edt * 9);
    }
    cam.centerOn(this.camX + sx, this.camY + sy);
    // world layers
    const dark = cut ? cut.dark : 0;
    const blocky = BLOCKY_LANDS.includes(area.region[Math.floor(s.y)]?.charAt(Math.floor(s.x)) || '-');
    this.sky.begin(s.time, !!area.dark, !!area.indoor, s.xmas, dark, dt, cam.scrollX, cam.scrollY, blocky);
    const surface = this.surfaceState;
    surface.darkness = this.sky.level;
    surface.winter = s.xmas;
    surface.paused = rt.paused || stage;
    surface.reducedMotion = s.opts.lowFx || prefersLessMotion();
    this.ground.update(cam, dt, surface);
    this.reflectedSources.length = 0;
    if (!stage) {
      this.things.update(cam, dt, s.xmas, (x, y, r) => this.sky.light(x, y, r), surface.reducedMotion);
      // the thing she plays on moves with her (package 57a); put back once the turn is over
      const fobj = rt.fun && rt.fun.obj >= 0 ? rt.fun.obj : -1;
      if (fobj >= 0) {
        const m = funThing(rt.fun!, rt.fun!.t - this.lag);
        this.things.pose(fobj, m.dx, m.dy, m.ang, m.sy);
      } else if (this.funObj >= 0) this.things.pose(this.funObj, 0, 0, 0, 1);
      this.funObj = fobj;
      this.funMate = rt.fun?.friend ?? 0;
      this.drawCastles();
      this.rings.update(
        g,
        (rt.mode === 'play' || rt.mode === 'talk') && !cut && !rt.build && !this.menuOpen,
        alpha,
        dt,
        surface.reducedMotion,
        this.ringLight,
      );
      // her own soft pool, a little wider and warmer in a dark place or the deep night, so she always reads
      const deep = this.sky.level > 0.5;
      const torch = (s.pouch.torch ?? 0) > 0 || this.hasTorch();
      this.sky.light(hx, hy - 50, torch ? 4.2 : deep ? 3.4 : 2.8, deep ? 0.8 : 0.6);
      // and a faint one on every mob near her at night or in the dark, so a spider on a dark trail still shows
      if (this.sky.level > 0.3)
        for (const m of rt.mobs)
          if (!m.gone && Math.abs(m.x - s.x) < 14 && Math.abs(m.y - s.y) < 9)
            this.sky.light(m.x * T, m.y * T - 40, 1.6, 0.45);
    } else this.rings.update(g, false, alpha, dt, true, this.ringLight);
    if (!stage && !area.indoor) {
      this.reflectedSources.push(this.hero.sprite);
      for (const actor of this.actors.values()) this.reflectedSources.push(actor.sprite);
      for (const tree of this.things.getReflectionTargets()) this.reflectedSources.push(tree);
    }
    this.reflections.setPaused(surface.paused);
    this.reflections.setReducedMotion(surface.reducedMotion);
    this.reflections.update(this.reflectedSources, cam, dt, surface.darkness, s.xmas);
    this.drawLamp(!stage, dt, surface.reducedMotion);
    // The tree moves in Things.update, so aim the tool after its current-frame pose is known.
    this.drawTool(hx, hy);
    this.sky.end();
    this.fx.update(dt);
    if (Math.floor(this.t) !== Math.floor(this.t - dt))
      sweepChars(this, art.chars.sets[this.artOf(s.hero)]?.group ?? '');
  }

  /** Package 71: today's sandcastles in this area, each the size of its stage. */
  /**
   * Package 73a (I2): while the lighthouse lamp is on at night, two soft wedges of light sweep slowly round from the top
   * of the tower; in the lamp room the lamp glows while it is on. Three images in all, made once, no full-screen layer.
   */
  private drawLamp(show: boolean, dt: number, still: boolean): void {
    const g = this.g;
    const area = g.s.area;
    const beam = show && area === 'island' && this.sky.level > 0.08 && lampShines(g);
    const glow = show && area === LAMP_ROOM && lampOn(g);
    if (!beam && !glow) {
      for (const img of this.lampFx) img.setVisible(false);
      return;
    }
    if (!this.lampFx.length) {
      beamTexture(this);
      for (let i = 0; i < 2; i++)
        this.lampFx.push(
          this.add.image(0, 0, 'fx_beam').setOrigin(0, 0.5).setBlendMode(Phaser.BlendModes.ADD).setDepth(90100),
        );
      this.lampFx.push(this.add.image(0, 0, 'fx_light').setBlendMode(Phaser.BlendModes.ADD).setDepth(90100));
    }
    const [b1, b2, light] = this.lampFx as [
      Phaser.GameObjects.Image,
      Phaser.GameObjects.Image,
      Phaser.GameObjects.Image,
    ];
    const objs = g.c.areas[area]!.objects;
    if (beam) {
      const lh = objs.find((o) => o.type === 'lighthouse');
      const x = lh ? (lh.x + 1.5) * T : 0;
      const y = lh ? (lh.y + 0.7) * T : 0;
      // slowly round: about 12 seconds a turn (half that speed with less motion)
      if (!g.rt.paused) this.beamA = (this.beamA + dt * (still ? 0.25 : 0.5)) % (Math.PI * 2);
      const alpha = Math.min(1, this.sky.level * 1.25) * 0.8;
      const near = !!lh && Math.abs(x - this.camX) < 40 * T && Math.abs(y - this.camY) < 30 * T;
      b1.setVisible(near).setPosition(x, y).setRotation(this.beamA).setScale(1.5, 1.2).setAlpha(alpha);
      b2.setVisible(near)
        .setPosition(x, y)
        .setRotation(this.beamA + Math.PI)
        .setScale(1.5, 1.2)
        .setAlpha(alpha);
      // the tower already has its own pool of light: only the two beams here
      light.setVisible(false);
    } else {
      b1.setVisible(false);
      b2.setVisible(false);
      const lamp = objs.find((o) => o.type === 'big_lamp');
      const pulse = still ? 0 : Math.sin(this.time.now / 600) * 0.06;
      light
        .setVisible(!!lamp)
        // the painted lamp is 2 by 2 tiles (graphics job 2): the glow sits on its bulb
        .setPosition(((lamp?.x ?? 0) + 1) * T, ((lamp?.y ?? 0) + 0.83) * T)
        .setScale(2.6)
        .setAlpha((0.75 + pulse) * lampGlow(g));
    }
  }

  private drawCastles(): void {
    const g = this.g;
    let n = 0;
    const put = (key: string, x: number, y: number, px: number, depth: number) => {
      let img = this.castleImgs[n];
      if (!img) this.castleImgs.push((img = this.add.image(0, 0, '__DEFAULT')));
      n++;
      const f = frameFor(this, key, 96, 96);
      if (img.texture.key !== f.key || (f.frame && img.frame.name !== f.frame)) img.setTexture(f.key, f.frame);
      const size = Math.max(img.width, img.height) || 96;
      img
        .setVisible(true)
        .setOrigin(0.5, 1)
        .setScale(px / size)
        .setPosition(x, y)
        .setDepth(depth);
    };
    for (const key in g.rt.castles) {
      const c = castleOn(g, key);
      if (!c || c.area !== g.s.area || c.stage < 1) continue;
      const art = castleArt(c.stage);
      const x = c.x * T;
      const y = c.y * T;
      const px = [0, 34, 48, 58][c.stage]!;
      put(art, x, y, px, y);
      // stage 3 from the stand-in pictures: a smaller tower on top, so the three stages read apart
      if (c.stage === 3 && !art.startsWith('sandcastle_')) put(art, x, y - px * 0.62, px * 0.55, y + 1);
    }
    for (let i = n; i < this.castleImgs.length; i++) this.castleImgs[i]!.setVisible(false);
  }

  /**
   * Fun panel 7: a boss or an animal standing in front of her and over her body would hide her. Return the depth she
   * needs to be drawn over it (or the lift so far, if that is more).
   */
  private liftOver(lift: number, p: Puppet, hx: number, hy: number): number {
    const x = p.sprite.x;
    const y = p.sprite.depth - p.bias;
    if (y <= hy || y - p.height >= hy) return lift;
    if (Math.abs(x - hx) > p.height * 0.4 + this.hero.height * 0.25) return lift;
    return Math.max(lift, y - hy + 1);
  }

  /** The boss she is fighting here, if any. */
  private fightBoss(): Mob | null {
    const g = this.g;
    for (const m of g.rt.mobs) if (!m.gone && m.area === g.s.area && g.c.mobs[m.id]?.role === 'boss') return m;
    return null;
  }

  private hasTorch(): boolean {
    for (const sl of this.g.s.bag) if (sl && sl.id === 'torch') return true;
    return false;
  }

  /** The draw-order lift for someone at feet y (world pixels) playing on the thing in use: always in front of it. */
  private funBias(y: number): number {
    const fun = this.g.rt.fun;
    return fun && fun.obj >= 0 ? this.things.funBias(fun.obj, y, FUN_BIAS) : FUN_BIAS;
  }

  private drawMob(m: Mob, alpha: number, dt: number): void {
    // the Spider Jockey's rider on foot is drawn with the skeleton's art
    const swap = BossLook.art(m);
    let p = this.actors.get(m.k);
    if (p && p.id !== (swap ?? this.artOf(m.id))) {
      p.destroy();
      this.actors.delete(m.k);
      p = undefined;
    }
    if (!p) {
      p = swap ? new Puppet(this, swap, this.tallOf(swap)) : this.puppetFor(m);
      this.actors.set(m.k, p);
    }
    const x = (m.px + (m.x - m.px) * alpha) * T;
    const y = (m.py + (m.y - m.py) * alpha) * T;
    p.setPos(x, y);
    p.play(m.clip, m.dir);
    p.update(dt);
    const spr = p.sprite;
    const def = this.g.c.mobs[m.id];
    if (m.st === FUSE && m.fuse > 0 && (def?.ai === 'creeper' || def?.ai === 'mini')) {
      // the blast reaches this ring and no further: outside it she is safe
      const len = m.fuseLen ?? (def.ai === 'mini' ? 1.1 : CREEPER_FUSE);
      this.action.ring(x, y, CREEPER_BLAST * T, 1 - Math.min(1, m.fuse / len));
    }
    if (m.doze) this.action.doze(m.k, x, y - p.height, dt);
    if (def?.role === 'boss') this.boss.mob(this.g, m, p, x, y, dt);
    else if (m.hurtT > HIT_FLASH) spr.setTintFill(0xffffff);
    else if (m.hurtT > 0) spr.setTint(HIT_TINT);
    else if (m.fuse > 0) {
      // a creeper about to pop: it swells and blinks faster and faster
      const k = 1 - Math.min(1, m.fuse / (m.fuseLen ?? 1.5));
      // a warm red blink in each beat, never a white shape (fun panel 7)
      if ((this.t * (3 + k * 8)) % 1 < 0.4) spr.setTint(0xff8a8a);
      else spr.clearTint();
      spr.setScale(spr.scaleX * (1 + k * 0.18), spr.scaleY * (1 + k * 0.18));
    } else if (m.st === 2 && Math.floor(this.t * 12) % 2) spr.setTint(WINDUP_TINT);
    else if (m.doze) spr.setTint(0xb8b8c8);
    else spr.clearTint();
  }

  /** Her arrows by her feet: while a mob is after her, and for a few seconds after each shot. */
  private drawArrowCount(hx: number, hy: number, stage: boolean, dt: number): void {
    const g = this.g;
    const s = g.s;
    if (toolTier(g, 'bow') === 0 || stage) {
      this.action.arrows(0, false, hx, hy, { key: '__DEFAULT' }, 1);
      return;
    }
    const shots = s.counts.shots ?? 0;
    if (shots !== this.shotsSeen) {
      this.shotsSeen = shots;
      this.shotShowT = 3;
    }
    if (this.shotShowT > 0) this.shotShowT -= dt;
    let near = false;
    for (const m of g.rt.mobs) {
      if (m.gone || m.calm || m.doze) continue;
      const role = g.c.mobs[m.id]?.role;
      if ((role === 'hostile' || role === 'boss') && Math.hypot(m.x - s.x, m.y - s.y) < 9) near = true;
    }
    const n = count(g, 'arrow');
    this.action.arrows(n, near || this.shotShowT > 0, hx, hy, frameFor(this, 'arrow', 34, 34), dt);
  }

  private mark(i: number, x: number, y: number, kind: number): void {
    let img = this.marks[i];
    if (!img) this.marks.push((img = this.add.image(0, 0, 'fx_star')));
    const bob = Math.sin(this.t * 5 + i) * 6;
    img
      .setVisible(true)
      .setPosition(x, y + bob)
      // at night or in the dark the quest marks sit above the wash, so the goal is never lost
      .setDepth(this.sky.level > 0.3 ? 90540 : y + 2000)
      .setTexture(kind === 3 ? 'fx_dot' : 'fx_star');
    img
      .setTint(kind === 2 ? 0xffd24a : kind === 3 ? 0x7be37b : 0xffffff)
      .setScale(kind === 2 ? 1.25 : kind === 3 ? 0.6 : 0.9);
  }

  private drawShots(): void {
    const shots = this.g.rt.shots;
    for (let i = 0; i < shots.length; i++) {
      const sh = shots[i]!;
      let img = this.shots[i];
      if (!img) this.shots.push((img = this.add.image(0, 0, 'ui_arrowshot')));
      // drawn where it was at the drawn moment (it flies in a straight line), not where the last tick left it
      const lag = this.lag;
      img
        .setVisible(true)
        .setPosition((sh.x - sh.vx * lag) * T, (sh.y - sh.vy * lag) * T)
        .setDepth(sh.y * T + 60);
      if (sh.kind === 'ring')
        // a shock wave on the ground: flat, under everyone, with a dark edge so it reads on any floor
        img
          .setTexture('fx_wave')
          .setScale((Math.max(0, sh.r - RING_SPEED * lag) * T) / 116)
          .setRotation(0)
          .setTint(0xb6ff8a)
          .setAlpha(0.95)
          .setDepth(-590);
      else
        img
          .setTexture(sh.kind === 'arrow' ? 'ui_arrowshot' : 'fx_dot')
          .setScale(1)
          .setRotation(Math.atan2(sh.vy, sh.vx))
          .setTint(0xffffff)
          .setAlpha(1);
    }
    for (let i = shots.length; i < this.shots.length; i++) this.shots[i]!.setVisible(false);
  }

  /** One swing clip serves every tool: the tool is its own sprite, swept through an arc in front of her. */
  private drawTool(hx: number, hy: number): void {
    const rt = this.g.rt;
    // Keep the tool in her hand for the follow-through even if the hit just removed its target.
    if (rt.clip !== 'swing') {
      this.swingItem = null;
      this.axeTarget = null;
    } else if (!this.swingItem) {
      this.swingItem = toolInHand(this.g);
      this.latchAxeTarget();
    }
    const item = this.swingItem;
    if (!item) {
      this.tool.setVisible(false);
      this.glints = 0;
      return;
    }
    const held = `held-${item}`;
    if (this.textures.exists(held)) {
      // On the first frame in an area, Things may only just have brought the tree on screen.
      if (!this.axeTarget && rt.ct < 0.12) this.latchAxeTarget();
      this.drawAxe(held, hx, hy);
      return;
    }
    const f = frameFor(this, item, 56, 56);
    if (this.tool.texture.key !== f.key || (f.frame && this.tool.frame.name !== f.frame))
      this.tool.setTexture(f.key, f.frame);
    const k = Math.min(1, Math.max(0, rt.ct - this.lag) / 0.3);
    const dir: Dir = this.g.s.dir;
    const side = dir === 'left' ? -1 : 1;
    const sweep = -1.9 + k * 2.6;
    const h = this.hero.height;
    let x = hx;
    let y = hy - h * 0.55;
    let rot = sweep;
    if (dir === 'left' || dir === 'right') {
      x += side * (26 + Math.sin(k * Math.PI) * 26);
      y += -18 + k * 44;
      rot = side * sweep + (side < 0 ? Math.PI : 0);
    } else if (dir === 'down') {
      x += -30 + k * 60;
      y += 26 + Math.sin(k * Math.PI) * 22;
      rot = Math.PI / 2 + (k - 0.5) * 1.6;
    } else {
      x += 30 - k * 60;
      y += -44 - Math.sin(k * Math.PI) * 18;
      rot = -Math.PI / 2 + (k - 0.5) * 1.6;
    }
    const size = Math.max(this.tool.width, this.tool.height) || 56;
    this.tool
      .setVisible(true)
      .setOrigin(0.5)
      .setPosition(x, y)
      .setRotation(rot + Math.PI / 4)
      .setScale(58 / size)
      .setFlipX(side < 0 && (dir === 'left' || dir === 'right'))
      .setDepth((dir === 'up' ? hy - 2 : hy + 2) + this.heroLift);
    // an upgraded sword glints: once a swing at +1, twice at +2, near its tip
    const plus = item === worn(this.g, 'sword') ? plusOf(this.g, item) : 0;
    if (plus > this.glints && k >= (this.glints + 1) / (plus + 1)) {
      this.glints++;
      this.fx.play('glint', x / T, y / T);
    }
  }

  private latchAxeTarget(): void {
    const item = this.swingItem;
    if (!item || this.g.c.items[item]?.tool?.type !== 'axe') return;
    const target = findTarget(this.g);
    if (target.kind !== 'obj' || target.objIndex === undefined) return;
    const point = this.things.cutPoint(target.objIndex);
    if (point) this.axeTarget = { area: this.g.s.area, index: target.objIndex, point };
  }

  /** The grip is at the lower left of the painted handle. Its head reaches the trunk on the rule's contact tick. */
  private drawAxe(texture: string, hx: number, hy: number): void {
    if (this.tool.texture.key !== texture) this.tool.setTexture(texture);
    const t = Math.max(0, this.g.rt.ct - this.lag);
    const drive = Math.min(1, t / 0.12) ** 2;
    const follow = Math.max(0, Math.min(1, (t - 0.12) / 0.1));
    const settle = Math.max(0, Math.min(1, (t - 0.22) / 0.12));
    const dir = this.g.s.dir;
    const target = this.axeTarget?.area === this.g.s.area ? this.axeTarget : null;
    if (target) target.point = this.things.cutPoint(target.index) ?? target.point;
    const side = dir === 'left' || ((dir === 'up' || dir === 'down') && target && target.point.x < hx) ? -1 : 1;
    const front = dir === 'down';
    const back = dir === 'up';
    const h = this.hero.height;
    const angle = (back ? -1.65 : front ? -0.2 : -0.8) + (back ? 1.1 : 1.8) * drive + 0.2 * follow - 0.3 * settle;
    const gripX = front || back ? 0.21 - drive * 0.08 : 0.19 + 0.14 * drive;
    const gripY = back ? 0.69 - drive * 0.04 : 0.56 - drive * (front ? 0.25 : 0.13);
    let scale = 64 / Math.max(this.tool.width, this.tool.height);
    let x = hx + side * gripX * h;
    let y = hy - gripY * h;
    let rot = side * angle;
    let depth = hy + this.heroLift + (back ? -2 : 2);
    if (target) {
      // The cutouts share this grip and the visible middle of their curved cutting edge.
      const bladeX = (0.99 - 0.17) * this.tool.width;
      const bladeY = (0.31 - 0.82) * this.tool.height;
      const baseLength = Math.hypot(bladeX, bladeY) * scale;
      const handX = hx + side * Math.min(28, Math.max(12, h * 0.2));
      const handY = hy - Math.min(48, Math.max(20, h * 0.32));
      const dx = target.point.x - handX;
      const dy = target.point.y - handY;
      const distance = Math.hypot(dx, dy);
      let length = Math.max(baseLength * 0.72, Math.min(baseLength * 1.22, distance));
      let aimX = distance > 0.001 ? target.point.x - (dx / distance) * length : handX;
      let aimY = distance > 0.001 ? target.point.y - (dy / distance) * length : handY;
      let reachable = distance > 0.001;
      if (aimY > hy + 4) {
        // At a long reach towards the camera the hand should not sink into the ground. Move it along the
        // foot line and allow a little more uniform size only when the ordinary axe cannot reach the cut.
        aimY = hy + 4;
        const vertical = target.point.y - aimY;
        const maxLength = baseLength * 1.45;
        if (Math.abs(vertical) > maxLength) reachable = false;
        else {
          const horizontal = Math.sqrt(maxLength * maxLength - vertical * vertical);
          aimX = Math.max(target.point.x - horizontal, Math.min(target.point.x + horizontal, handX));
          length = Math.hypot(target.point.x - aimX, vertical);
        }
      }
      // Do not pull her hand an implausible distance from her body for unusual target positions.
      if (reachable && Math.hypot(aimX - handX, aimY - handY) <= h * 0.5 + 8) {
        const aimRot = Math.atan2(target.point.y - aimY, target.point.x - aimX) - Math.atan2(bladeY, side * bladeX);
        const turn = Math.atan2(Math.sin(aimRot - rot), Math.cos(aimRot - rot));
        const hold = 1 - Math.max(0, Math.min(1, (t - 0.16) / 0.14));
        const blend = drive * hold;
        x += (aimX - x) * blend;
        y += (aimY - y) * blend;
        rot += turn * blend;
        scale *= 1 + (length / baseLength - 1) * blend;
        if (blend > 0.8) depth = Math.max(depth, target.point.depth);
      }
    }
    this.tool
      .setVisible(true)
      .setOrigin(0.17, 0.82)
      .setPosition(x, y)
      .setFlipX(false)
      .setScale(side * scale, scale)
      .setRotation(rot)
      .setDepth(depth);
  }

  /** Her bow, held out the way she shoots for a moment after each shot (an upgraded one glints). */
  private drawBow(hx: number, hy: number, dt: number): void {
    const id = worn(this.g, 'bow');
    if (this.bowShowT > 0) this.bowShowT -= dt;
    if (!id || this.bowShowT <= 0 || this.g.rt.mode !== 'play') {
      this.bowImg.setVisible(false);
      return;
    }
    const f = frameFor(this, id, 56, 56);
    if (this.bowImg.texture.key !== f.key || (f.frame && this.bowImg.frame.name !== f.frame))
      this.bowImg.setTexture(f.key, f.frame);
    const dir = this.g.s.dir;
    const [dx, dy] = dir === 'left' ? [-1, 0] : dir === 'right' ? [1, 0] : dir === 'up' ? [0, -1] : [0, 1];
    const h = this.hero.height;
    const x = hx + dx * 34;
    const y = hy - h * 0.45 + dy * 22;
    const size = Math.max(this.bowImg.width, this.bowImg.height) || 56;
    const fresh = this.bowShowT > 0.3 - dt * 1.5;
    this.bowImg
      .setVisible(true)
      .setPosition(x, y)
      .setScale(54 / size)
      .setRotation(Math.atan2(dy, dx) - Math.PI / 4)
      .setDepth((dir === 'up' ? hy - 2 : hy + 2) + this.heroLift)
      .setAlpha(Math.min(1, this.bowShowT / 0.1));
    if (fresh && plusOf(this.g, id) > 0) this.fx.play('glint', x / T, (y - 10) / T);
  }

  private drawFishing(hx: number, hy: number): void {
    const f = this.g.rt.fish;
    this.line.clear();
    if (!f) {
      this.bobber.setVisible(false);
      return;
    }
    const dip = f.st === 2 ? 8 + Math.sin(this.t * 30) * 3 : Math.sin(this.t * 3) * 2;
    const bx = f.fx * T;
    const by = f.fy * T + dip;
    this.bobber
      .setVisible(f.st >= 1 && f.st <= 2)
      .setPosition(bx, by)
      .setDepth(by + 10);
    const rodX = hx + (this.g.s.dir === 'left' ? -44 : this.g.s.dir === 'right' ? 44 : 0);
    const rodY = hy - this.hero.height * 0.9;
    this.line
      .lineStyle(2, 0xffffff, 0.9)
      .beginPath()
      .moveTo(rodX, rodY)
      .lineTo(bx, by - 6)
      .strokePath()
      .setDepth(by + 9);
  }

  private drawBuild(): void {
    const b = this.g.rt.build;
    if (!b) {
      this.cursor.setVisible(false);
      this.ghost.setVisible(false);
      return;
    }
    const list = placeables(this.g);
    const item = list[b.sel];
    const def = item ? this.g.c.items[item]!.place! : null;
    const w = def ? (b.rot % 2 ? (def.h ?? 1) : (def.w ?? 1)) : 1;
    const h = def ? (b.rot % 2 ? (def.w ?? 1) : (def.h ?? 1)) : 1;
    const ok = item ? canPlace(this.g, item, b.cx, b.cy, def!.rot ? b.rot : 0) === null : false;
    this.cursor
      .setVisible(true)
      .setPosition(b.cx * T, b.cy * T)
      .setSize(w * T, h * T)
      .setFillStyle(ok ? 0x7be37b : 0xff6a6a, 0.3 + Math.sin(this.t * 6) * 0.08);
    if (item) {
      const f = worldFrame(this, PLACED_ART[item] ?? item, w * T, h * T);
      if (this.ghost.texture.key !== f.key || (f.frame && this.ghost.frame.name !== f.frame))
        this.ghost.setTexture(f.key, f.frame);
      this.ghost
        .setVisible(true)
        .setScale(f.frame ? 1 / 1.5 : 1)
        .setOrigin(0.5, def!.layer === 'floor' ? 0.5 : 1)
        .setPosition((b.cx + w / 2) * T, def!.layer === 'floor' ? (b.cy + h / 2) * T : (b.cy + h) * T);
    } else this.ghost.setVisible(false);
  }

  /** World position to screen position, for the helper arrow in the HUD. */
  toScreen(wx: number, wy: number): { x: number; y: number } {
    const cam = this.cameras.main;
    return { x: (wx - cam.worldView.x) * cam.zoom, y: (wy - cam.worldView.y) * cam.zoom };
  }
  counts(): { actors: number; things: number; fx: number } {
    return { actors: this.actors.size + 1, things: this.things.count, fx: this.fx.count };
  }
}
