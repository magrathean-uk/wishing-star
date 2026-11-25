// The animation runtime. Every character on screen is a Puppet that plays drawn frame clips (D12: nobody is a still picture).
// The rules only say { clip, dir }; this file turns that into frames, flips, light, a shadow and a little movement.
import type Phaser from 'phaser';
import type { Clip, Dir, TalkRt } from '../core/types.ts';
import {
  type AnimSetDef,
  art,
  charPage,
  pinChar,
  pinPortrait,
  unpinChar,
  unpinPortrait,
  wantChar,
  wantPortrait,
} from './assets.ts';

/** Characters already reported as having no art, so dev mode warns once each. */
const warned = new Set<string>();
/** Seconds a puppet takes to fade in once its pictures have arrived. */
const FADE_IN = 0.15;
/** The hero travels 4.5 tiles per second; smaller characters take shorter strides. */
const WALK_REFERENCE = 4.5 * 64;
/** The typewriter runs at 48 characters per second. */
const TALK_CHARS_PER_SECOND = 48;

/** [frames a second, loops] per clip. Idle is special: mostly the first frame, with a quick blink. */
const TIMING: Record<string, [number, boolean]> = {
  idle: [0, true],
  walk: [8, true],
  run: [12, true],
  talk: [7, true],
  wave: [5, true],
  swing: [10, false],
  fish: [2, true],
  cheer: [6, true],
  hurt: [8, false],
  sleep: [0.8, true],
  attack: [7, false],
  hop: [6, true],
  dizzy: [4, true],
  calm: [1.2, true],
  laugh: [6, true],
  summon: [5, false],
  stomp: [7, false],
};
const FALLBACK: Record<string, string[]> = {
  cheer: ['wave', 'idle'],
  wave: ['cheer', 'idle'],
  hurt: ['surprised', 'idle'],
  sleep: ['idle'],
  swing: ['attack', 'wave', 'idle'],
  attack: ['swing', 'idle'],
  hop: ['walk', 'idle'],
  talk: ['idle'],
  fish: ['idle'],
  dizzy: ['hurt', 'idle'],
  calm: ['idle'],
  walk: ['hop', 'idle'],
  run: ['walk', 'idle'],
  laugh: ['cheer', 'talk', 'idle'],
  summon: ['attack', 'idle'],
  stomp: ['attack', 'idle'],
};

/**
 * Where the head is in a drawn frame, measured once from its pixels (phase 2, part D: the helmet is placed from the
 * top of each frame). In the frame's full source size: the top row, the head's middle and its width.
 */
interface Head {
  top: number;
  cx: number;
  w: number;
}
const heads = new Map<string, Head | null>();
let probe: CanvasRenderingContext2D | null = null;
function headOf(frame: Phaser.Textures.Frame): Head | null {
  const id = `${frame.texture.key}/${frame.name}`;
  const known = heads.get(id);
  if (known !== undefined) return known;
  let out: Head | null = null;
  const img = frame.source.image as CanvasImageSource | undefined;
  const w = Math.round(frame.cutWidth);
  const h = Math.round(frame.cutHeight);
  if (img && w > 2 && h > 2 && typeof document !== 'undefined') {
    if (!probe) probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    if (probe) {
      const cv = probe.canvas;
      if (cv.width < w || cv.height < h) {
        cv.width = Math.max(cv.width, w);
        cv.height = Math.max(cv.height, h);
      }
      probe.clearRect(0, 0, w, h);
      probe.drawImage(img, frame.cutX, frame.cutY, w, h, 0, 0, w, h);
      const px = probe.getImageData(0, 0, w, h).data;
      const solid = (x: number, y: number) => px[(y * w + x) * 4 + 3]! > 110;
      let top = -1;
      for (let y = 0; y < h && top < 0; y++) {
        let n = 0;
        for (let x = 0; x < w; x++) if (solid(x, y)) n++;
        if (n >= 3) top = y;
      }
      if (top >= 0) {
        // the head's middle from its top band, its width from a little lower down (the widest row there)
        let sx = 0;
        let n = 0;
        const band = Math.max(4, Math.round(h * 0.14));
        for (let y = top; y < Math.min(h, top + band); y++)
          for (let x = 0; x < w; x++)
            if (solid(x, y)) {
              sx += x;
              n++;
            }
        let span = 0;
        for (let y = top + Math.round(h * 0.06); y < Math.min(h, top + Math.round(h * 0.2)); y++) {
          let a = -1;
          let b = -1;
          for (let x = 0; x < w; x++)
            if (solid(x, y)) {
              if (a < 0) a = x;
              b = x;
            }
          if (a >= 0) span = Math.max(span, b - a + 1);
        }
        out = { top: top + frame.y, cx: (n ? sx / n : w / 2) + frame.x, w: Math.max(8, span) };
      }
    }
  }
  heads.set(id, out);
  return out;
}

/** The share of a helmet picture, from its top, drawn on a head: the dome without the face guard. */
const DOME = 0.56;
/** The dome's width against the head's, its widest against her height, and how far (in dome widths) it rises above the head's top. */
const HAT_W = 0.86;
const HAT_MAX = 0.34;
const HAT_UP = 0.1;

let shadowKey = '';
function shadowTex(scene: Phaser.Scene): string {
  if (shadowKey && scene.textures.exists(shadowKey)) return shadowKey;
  shadowKey = 'fx_shadow';
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  // A soft, slightly offset ambient shadow and a tighter contact shadow share one texture and one draw call.
  for (let i = 0; i < 7; i++) {
    g.fillStyle(0x20232c, 0.035);
    g.fillEllipse(50, 19, 92 - i * 10, 30 - i * 3);
  }
  g.fillStyle(0x171a21, 0.11);
  g.fillEllipse(48, 17, 34, 8);
  g.generateTexture(shadowKey, 96, 36);
  g.destroy();
  return shadowKey;
}

let reducedMotion: MediaQueryList | undefined;
export function prefersLessMotion(): boolean {
  if (!reducedMotion && typeof window !== 'undefined' && typeof window.matchMedia === 'function')
    reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  return reducedMotion?.matches ?? false;
}

type Speech = Pick<TalkRt, 'who' | 'text' | 'shown'>;

/** Fit the authored timing to another facing with a different number of frames, keeping the cycle length. */
function fitDurations(durs: number[] | undefined, n: number): number[] | null {
  if (!durs?.length || !n || durs.some((d) => !Number.isFinite(d) || d < 0)) return null;
  if (durs.reduce((a, b) => a + b, 0) <= 0) return null;
  if (durs.length === n) return durs;
  return Array.from({ length: n }, (_, i) => {
    const start = (i * durs.length) / n;
    const end = ((i + 1) * durs.length) / n;
    let duration = 0;
    for (let j = Math.floor(start); j < Math.ceil(end); j++)
      duration += durs[j]! * (Math.min(end, j + 1) - Math.max(start, j));
    return duration;
  });
}

/** Close the mouth briefly between phrases, without changing how fast the text or game rules advance. */
function speechPause(text: string, shown: number): boolean {
  const i = Math.max(0, Math.min(text.length - 1, Math.floor(shown) - 1));
  if (shown < 1 || /[\s.,!?;:]/u.test(text[i] ?? '')) return true;
  if (i > 0 && /\s/u.test(text[i - 1]!)) return true;
  return /[.,!?;:]\s*.{0,2}$/u.test(text.slice(Math.max(0, i - 4), i + 1));
}

export class Puppet {
  readonly sprite: Phaser.GameObjects.Sprite;
  readonly shadow: Phaser.GameObjects.Image;
  private scene: Phaser.Scene;
  private setId: string;
  private def: AnimSetDef | undefined;
  private tall: number;
  private clip = 'idle';
  private facing: 'down' | 'side' | 'up' = 'down';
  private frames: string[] | null = null;
  /** The chosen fallback can have different timing and contacts to the requested clip. */
  private frameClip = 'idle';
  private frameFacing: 'down' | 'side' | 'up' = 'down';
  private frameDurs: number[] | null = null;
  private frameSteps: number[] = [];
  private speech: Speech | null = null;
  private spokeExpression = false;
  private frameAt = -1;
  private t = 0;
  /** seconds since the puppet was made, for the slow idle breath */
  private life = 0;
  private blinkAt = 2 + Math.random() * 3;
  private real = false;
  private baseScale = 1;
  private squash = 0;
  private fixedView: boolean;
  /** Changes in the actual ground position, never the pre-drawn gait or a screen-space portrait. */
  private lastX = Number.NaN;
  private lastY = Number.NaN;
  private dx = 0;
  private dy = 0;
  private vx = 0;
  private vy = 0;
  private poseAngle = 0;
  private raised = 0;
  private shadowScale = 1;
  private shadowAlpha = 1;
  /** the atlas group this puppet holds in memory while it lives */
  private pinned = '';
  /** visibility and alpha the caller asked for; the puppet only shows once its pictures are in */
  private want = true;
  private alphaWant = 1;
  private fade = 0;
  /** called when a walking foot lands */
  onStep: (() => void) | null = null;
  y0 = 0;
  /** added to the depth, so a cutscene's actors can stand in front of a backdrop */
  bias = 0;
  /** extra scale for the menus, where the camera does not zoom */
  zoom = 1;
  readonly id: string;
  /** a helmet on her head (an item picture), or a small crest on the chest for heroes a helmet does not suit */
  private hat: Phaser.GameObjects.Image | null = null;
  private hatKey = '';
  private hatCrest = false;
  /** The talk box draws this puppet large: it plays its portrait page (idle and talk facing down) once that is in. */
  private portrait: boolean;
  private portraitPage = '';

  constructor(scene: Phaser.Scene, charId: string, tall: number, ui = false, portrait = false) {
    this.scene = scene;
    this.setId = charId;
    this.id = charId;
    this.tall = tall;
    this.fixedView = ui;
    this.portrait = ui && portrait;
    this.def = art.chars.sets[charId];
    this.shadow = scene.add.image(0, 0, shadowTex(scene)).setOrigin(0.5, 0.5);
    this.sprite = scene.add.sprite(0, 0, '__DEFAULT');
    if (ui) this.shadow.setScrollFactor(0);
    if (ui) this.sprite.setScrollFactor(0);
    this.shadowScale = (this.tall * 64 * 0.55) / 96;
    this.shadow.setScale(this.shadowScale);
    if (!this.def && Object.keys(art.chars.sets).length > 0 && !warned.has(charId)) {
      warned.add(charId);
      if (import.meta.env.DEV) console.warn(`puppet: no art for "${charId}", kept hidden`);
    }
    if (this.def) this.pinned = pinChar(charId);
    this.apply();
    this.resolve();
  }

  /** Nothing of a puppet shows until its drawn frames are in: never a stand-in, never a freed page. */
  private apply(): void {
    const on = this.want && this.real;
    this.sprite.setVisible(on);
    this.shadow.setVisible(on && !this.fixedView);
    const a = this.alphaWant * this.fade;
    this.sprite.setAlpha(a);
    this.shadow.setAlpha(a * this.shadowAlpha);
    this.hat?.setVisible(on && this.hatKey !== '').setAlpha(a);
  }

  /**
   * Put a helmet on (its item picture: `key` and `frame` from frameFor), or take it off with null. `crest` draws it
   * small on the chest instead, for heroes whose ears or hat a helmet would sit wrong on.
   */
  setHat(pic: { key: string; frame?: string } | null, crest = false): void {
    const key = pic ? `${pic.key}/${pic.frame ?? ''}` : '';
    this.hatCrest = crest;
    if (key === this.hatKey) return;
    this.hatKey = key;
    if (!pic) {
      this.hat?.setVisible(false);
      return;
    }
    if (!this.hat) {
      this.hat = this.scene.add.image(0, 0, pic.key, pic.frame);
      if (this.fixedView) this.hat.setScrollFactor(0);
    } else this.hat.setTexture(pic.key, pic.frame);
    this.apply();
  }

  /** Keep the helmet on the head of the frame being drawn. */
  private placeHat(): void {
    const hat = this.hat;
    if (!hat || !this.hatKey || !this.real || !this.def) return;
    const head = headOf(this.sprite.frame);
    if (!head) {
      hat.setVisible(false);
      return;
    }
    hat.setVisible(this.sprite.visible);
    const sx = this.sprite.scaleX;
    const sy = this.sprite.scaleY;
    const flip = this.sprite.flipX ? -1 : 1;
    const fw = this.sprite.frame.realWidth;
    const fh = this.sprite.frame.realHeight;
    const localX = (head.cx - fw * this.sprite.originX) * sx * flip;
    const localTop = (head.top - fh * this.sprite.originY) * sy;
    const angle = (this.sprite.angle * Math.PI) / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const point = (x: number, y: number) => ({
      x: this.sprite.x + x * cos - y * sin,
      y: this.sprite.y + x * sin + y * cos,
    });
    const size = Math.max(hat.width, hat.height) || 96;
    if (this.hatCrest) {
      // a small crest on the chest, like a knight's badge, a little over half way up from her feet
      const d = this.tall * 64 * 0.2 * this.zoom;
      const chest = point(localX, localTop * 0.42);
      hat
        .setCrop()
        .setOrigin(0.5, 0.5)
        .setScale(d / size)
        .setPosition(chest.x, chest.y);
    } else {
      // only the dome of the helmet picture (its top part), a little narrower than the head and never wider than
      // HAT_MAX of her height, sitting on the crown: hair shows at its sides and below its rim, her face stays clear
      const d = Math.min(head.w * sx * HAT_W, this.tall * 64 * this.zoom * HAT_MAX);
      const crown = point(localX, localTop - d * HAT_UP);
      hat
        .setCrop(0, 0, hat.frame.realWidth, hat.frame.realHeight * DOME)
        .setOrigin(0.5, 0)
        .setScale(d / size)
        .setPosition(crown.x, crown.y);
    }
    hat
      .setFlipX(flip < 0)
      .setAngle(this.sprite.angle)
      .setDepth(this.sprite.depth + 0.5);
  }

  /** Back to hidden (its page went away): it fades in again when the pictures are back. */
  private goHidden(): void {
    this.real = false;
    this.fade = 0;
    this.frames = null;
    this.frameAt = -1;
    this.sprite.setTexture('__DEFAULT');
    this.apply();
  }

  /** Switch to the drawn frames as soon as this character's atlas has arrived. */
  private resolve(): void {
    if (this.real) return;
    if (!this.def) {
      this.def = art.chars.sets[this.setId];
      if (!this.def) return;
      this.pinned = pinChar(this.setId);
    }
    // a portrait that is in already needs nothing else; one still loading waits behind the world frames
    if (!this.takePortrait() && !wantChar(this.scene, this.setId)) return;
    this.real = true;
    this.fade = 0;
    this.sprite.clearTint();
    this.fitDef();
  }

  /** Origin, scale and frames for the current drawing set (the world frames or the portrait). */
  private fitDef(): void {
    const def = this.def!;
    this.sprite.setOrigin(0.5, def.footY / def.h);
    this.baseScale = (this.tall * 64) / def.px;
    this.shadowScale = (def.w * this.baseScale * 0.62) / 96;
    this.shadow.setScale(this.shadowScale);
    this.frames = null;
    this.frameAt = -1;
    this.pick();
  }

  /**
   * Switch to the portrait page once it has arrived: the same idle and talk frames drawn at the masters' full detail,
   * so the talk box's large picture is sharp (G, 22 Nov 2026). True when the portrait is in use.
   */
  private takePortrait(): boolean {
    if (!this.portrait || this.portraitPage) return !!this.portraitPage;
    const page = wantPortrait(this.scene, this.setId);
    const p = art.portraits.sets[this.setId];
    const world = art.chars.sets[this.setId];
    if (!page || !p || !world) return false;
    this.portraitPage = page;
    pinPortrait(page);
    this.def = { ...world, w: p.w, h: p.h, footY: p.footY, px: p.px, clips: p.clips };
    return true;
  }

  private pick(): void {
    if (!this.real || !this.def) {
      this.frames = null;
      return;
    }
    let selectedFacing = this.facing;
    const tryClip = (clip: string): string[] | null => {
      const c = this.def!.clips[clip];
      if (!c) return null;
      // a run drawn only from the side plays the walk when facing down or up
      const facing = c[this.facing]?.length
        ? this.facing
        : clip === 'run'
          ? null
          : c.down?.length
            ? 'down'
            : c.side?.length
              ? 'side'
              : null;
      if (!facing) return null;
      selectedFacing = facing;
      return c[facing]!;
    };
    let chosen = this.clip;
    let fr = tryClip(chosen);
    if (!fr)
      for (const alt of FALLBACK[this.clip] ?? ['idle'])
        if ((fr = tryClip(alt))) {
          chosen = alt;
          break;
        }
    if (!fr) {
      chosen = 'idle';
      fr = tryClip(chosen);
    }
    this.frames = fr;
    this.frameClip = chosen;
    this.frameFacing = selectedFacing;
    const timing = this.def.timing?.[chosen];
    const n = fr?.length ?? 0;
    this.frameDurs = fitDurations(timing?.dursByFacing?.[selectedFacing], n) ?? fitDurations(timing?.durs, n);
    const facingContacts = timing?.stepByFacing?.[selectedFacing];
    const contacts = facingContacts ?? timing?.step ?? (chosen === 'walk' || chosen === 'run' ? [1, 3] : []);
    // Facing-specific contacts already refer to the active drawing, not to the global timing's frame count.
    const sourceCount = facingContacts ? n : timing?.durs?.length || 4;
    this.frameSteps = contacts
      .filter((i) => Number.isInteger(i) && i >= 0 && i < sourceCount)
      .map((i) => Math.floor((i * n) / sourceCount));
    this.frameAt = -1;
  }

  play(clip: Clip | string, dir: Dir, restart = false): void {
    this.speech = null;
    const facing = dir === 'down' ? 'down' : dir === 'up' ? 'up' : 'side';
    this.sprite.setFlipX(dir === 'left');
    if (clip === this.clip && facing === this.facing && !restart) return;
    if (clip !== this.clip || restart) this.t = 0;
    this.clip = clip;
    this.facing = facing;
    this.pick();
  }

  /** A speaking pose follows the visible line; movement and one-shot actions take precedence. */
  playDialogue(
    clip: Clip | string,
    dir: Dir,
    talk: Speech | null,
    who: string,
    visible = true,
    restart = false,
    staged = false,
  ): void {
    const expression = staged && (clip === 'wave' || clip === 'cheer' || clip === 'calm');
    const canSpeak = clip === 'idle' || clip === 'talk' || expression;
    const speaking = canSpeak && visible && !!who && !!talk && talk.who === who && talk.shown < talk.text.length;
    if (!expression || !talk) this.spokeExpression = false;
    if (speaking && expression) this.spokeExpression = true;
    const waiting = expression && !!talk && this.spokeExpression;
    this.play(speaking ? 'talk' : clip === 'talk' || waiting ? 'idle' : clip, dir, restart);
    this.speech = speaking ? talk : null;
  }

  setPos(x: number, y: number): void {
    if (Number.isFinite(this.lastX)) {
      this.dx += x - this.lastX;
      this.dy += y - this.lastY;
    }
    this.lastX = x;
    this.lastY = y;
    this.raised = 0;
    this.poseAngle = 0;
    this.sprite.setPosition(x, y + this.y0);
    this.shadow.setPosition(x, y + 2);
    if (!this.fixedView) {
      this.sprite.setDepth(y + this.bias);
      this.shadow.setDepth(y - 0.5 + this.bias);
    }
  }
  setVisible(v: boolean): void {
    this.want = v;
    if (v && this.real && !this.pageOk()) this.goHidden();
    this.apply();
  }
  setAlpha(a: number): void {
    this.alphaWant = a;
    this.apply();
  }
  /** True when this puppet is drawing its real frames (not waiting for them). */
  get ready(): boolean {
    return this.real;
  }
  /** The page its current frame lives on is still resident. */
  private pageOk(): boolean {
    const key = this.sprite.texture.key;
    return key === '__DEFAULT' || this.scene.textures.exists(key);
  }
  /**
   * Clip the picture at a screen line (for the talk portrait, whose body hides behind the box).
   * Only for puppets drawn without a scrolling camera.
   */
  cropBelow(screenY: number): void {
    if (!this.real || !this.def) return;
    const s = this.sprite.scaleY || 1;
    const top = this.sprite.y - this.def.footY * s;
    const h = Math.max(1, Math.min(this.def.h, (screenY - top) / s));
    this.sprite.setCrop(0, 0, this.sprite.frame.realWidth, h);
  }
  /** Screen height of the character from feet to the top of the head. */
  get bodyPx(): number {
    return this.tall * 64 * this.zoom;
  }
  /**
   * Package 57a: up off the ground by `px` pixels and tilted `ang` degrees (a bounce, a swing, a see-saw); the shadow
   * stays on the ground. Call after setPos each frame it applies; lift(0) puts it back.
   */
  lift(px: number, ang = 0): void {
    this.raised = Math.max(0, px);
    this.poseAngle = ang;
    if (px) this.sprite.y -= px;
    if (this.sprite.angle !== ang) this.sprite.setAngle(ang);
  }
  /** A quick squash, for landings, hits and pick-ups. */
  bump(amount = 0.12): void {
    this.squash = amount;
  }
  get height(): number {
    return this.tall * 64;
  }

  update(dt: number): void {
    if (!this.real) this.resolve();
    else if (!this.pageOk()) this.goHidden();
    else if (this.portrait && !this.portraitPage && this.takePortrait()) this.fitDef();
    if (this.real && this.fade < 1) {
      this.fade = Math.min(1, this.fade + dt / FADE_IN);
      this.apply();
    }
    const walking = this.clip === 'walk' || this.clip === 'run';
    const game = (this.scene as unknown as { g?: { s?: { opts?: { lowFx?: boolean } }; rt?: { paused?: boolean } } }).g;
    const travel = Math.hypot(this.dx, this.dy);
    const teleported = travel > Math.max(32, dt * 900);
    // The drawn stride advances with ground covered, not the render clock. A blocked or paused actor keeps its feet
    // still, and a teleport does not race through a walk cycle. Portraits can still preview a walk in place.
    const stride = WALK_REFERENCE * Math.max(0.5, Math.min(1.5, this.tall / 2));
    this.t += walking && !this.fixedView ? (dt > 0 && !game?.rt?.paused && !teleported ? travel / stride : 0) : dt;
    this.life += dt;
    let idx = 0;
    const [fps, loop] = TIMING[this.frameClip] ?? [6, true];
    const n = this.frames?.length ?? 1;
    // package 58: clips drawn with finer frames carry their own seconds per frame
    const durs = this.frameDurs;
    const speechTime = this.speech ? this.speech.shown / TALK_CHARS_PER_SECOND : this.t;
    const rest = this.speech && speechPause(this.speech.text, this.speech.shown);
    if (this.frameClip === 'idle') {
      // four idle frames are rest, breath, half blink and blink; package 64: a series may set their seconds
      const [rest, breath, half, shut] = durs?.length === 4 && n >= 4 ? durs : [1.3, 1.3, 0.05, 0.08];
      if (n >= 4) idx = this.life % (rest! + breath!) < rest! ? 0 : 1;
      if (this.t > this.blinkAt) {
        const b = this.t - this.blinkAt;
        idx = n >= 4 ? (b < half! || b > half! + shut! ? 2 : 3) : n > 1 ? 1 : 0;
        if (b > (n >= 4 ? half! * 2 + shut! : 0.16)) {
          this.t = 0;
          this.blinkAt = 2 + Math.random() * 3.5;
        }
      }
    } else if (durs && durs.length === n) {
      const total = durs.reduce((a, b) => a + b, 0);
      let u = loop ? speechTime % total : Math.min(speechTime, total - 0.001);
      idx = 0;
      while (idx < n - 1 && u >= durs[idx]!) u -= durs[idx++]!;
    } else if (loop) idx = Math.floor(speechTime * fps) % n;
    else idx = Math.min(n - 1, Math.floor(speechTime * fps));
    const restFrame = rest ? (this.def?.clips.idle?.[this.frameFacing]?.[0] ?? this.frames?.[0]) : undefined;
    if (restFrame) idx = -2;
    if (idx !== this.frameAt && this.real && this.frames) {
      const was = this.frameAt;
      this.frameAt = idx;
      const name = restFrame ?? this.frames[idx]!;
      const page = this.portraitPage || charPage(this.scene, this.setId, name);
      if (page) this.sprite.setTexture(page, name);
      else {
        this.goHidden();
        return;
      }
      if (
        walking &&
        dt > 0 &&
        was >= 0 &&
        travel > 0 &&
        !teleported &&
        !game?.rt?.paused &&
        this.frameSteps.includes(idx) &&
        this.onStep
      )
        this.onStep();
    }
    // Use real travel for a small weight shift as well. The drawn gait already contains the foot contacts, so this
    // must not add another bob or move their feet on the ground.
    const settles = this.clip === 'idle';
    const less = !!game?.s?.opts?.lowFx || prefersLessMotion();
    let weight = 0;
    const motion = !this.fixedView && !less && this.raised === 0 && (walking || settles);
    if (motion && dt > 0 && dt <= 0.12 && (walking || this.vx !== 0 || this.vy !== 0)) {
      // A teleport or an area change must not fling the character across the new view.
      if (Math.hypot(this.dx, this.dy) > Math.max(32, dt * 900)) this.vx = this.vy = 0;
      else {
        const rawX = walking ? this.dx / dt : 0;
        const rawY = walking ? this.dy / dt : 0;
        const ease = 1 - Math.exp(-dt * 10);
        this.vx += (rawX - this.vx) * ease;
        this.vy += (rawY - this.vy) * ease;
        const change = (Math.hypot(rawX, rawY) - Math.hypot(this.vx, this.vy)) / 288;
        weight = Math.max(-1, Math.min(1, change)) * (change < 0 ? 0.022 : 0.012);
        if (!walking && Math.abs(this.vx) + Math.abs(this.vy) < 0.01) this.vx = this.vy = 0;
      }
    } else if (dt > 0) this.vx = this.vy = 0;
    this.dx = this.dy = 0;
    if (!this.fixedView) {
      const lean = motion ? Math.max(-2.5, Math.min(2.5, (this.vx / 288) * 2.5)) : 0;
      this.sprite.setAngle(this.poseAngle + lean);
      // Vertex colours add a quiet top-to-bottom light without another sprite; action tints may override it.
      this.sprite.setTint(0xfff9f1, 0xf9f5ef, 0xdde4e9, 0xe9e3dc);
    }
    const air = Math.min(1, this.raised / (this.height * 0.8));
    this.shadowAlpha = 1 - air * 0.48;
    this.shadow.setScale(this.shadowScale * (1 - air * 0.25));
    this.shadow.setAlpha(this.alphaWant * this.fade * this.shadowAlpha);
    // Breathing while idle; a springy squash that settles. Both pivot around the registered feet.
    this.squash *= 0.86;
    const breathe = this.clip === 'idle' || this.clip === 'talk' ? Math.sin(this.t * 2.4) * 0.012 : 0;
    const sy = 1 - this.squash + breathe + weight;
    const sx = 1 + this.squash * 0.8 - breathe * 0.5 - weight * 0.5;
    this.sprite.setScale(this.baseScale * this.zoom * sx, this.baseScale * this.zoom * sy);
    if (this.hatKey) this.placeHat();
  }

  destroy(): void {
    unpinChar(this.pinned);
    this.pinned = '';
    if (this.portraitPage) unpinPortrait(this.portraitPage);
    this.portraitPage = '';
    this.sprite.destroy();
    this.shadow.destroy();
    this.hat?.destroy();
    this.hat = null;
  }
}
