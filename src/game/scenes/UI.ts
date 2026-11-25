// The HUD and every menu, drawn over the world at a fixed 1920 x 1080.
import Phaser from 'phaser';
import { placeables } from '../../core/build.ts';
import { count, DAY_LEN } from '../../core/cond.ts';
import { canSkip } from '../../core/cutscene.ts';
import { goalLine } from '../../core/goal.ts';
import { guideOf } from '../../core/guide.ts';
import { hintOffer } from '../../core/hints.ts';
import { placeRingLine, TAB_PRIZE } from '../../core/quests.ts';
import { cast, charName, fill } from '../../core/talk.ts';
import type { Ev, Game } from '../../core/types.ts';
import { art } from '../assets.ts';
import { Sound } from '../audio.ts';
import { type Keys, touchState } from '../input.ts';
import { Puppet } from '../puppet.ts';
import { saveNow } from '../save.ts';
import { MiniView } from '../ui/miniview.ts';
import { PostMark } from '../ui/postmark.ts';
import { QuizView } from '../ui/quizview.ts';
import { potHint, potOf } from '../../core/pots.ts';
import { HintView } from '../ui/hintview.ts';
import { LookView } from '../ui/menus/lookout.ts';
import { lampOn } from '../../core/lamp.ts';
import { shieldMax, worn } from '../ui/gear.ts';
import { stationNear } from '../../core/craft.ts';
import { type Overlay, hasOverlay, makeOverlay } from '../ui/overlays.ts';
import {
  colour,
  CREAM,
  fitSize,
  GOLD,
  H,
  clampOnScreen,
  icon,
  INK,
  LAYER,
  makeUiTextures,
  outlined,
  panel,
  setIcon,
  slot,
  SOFT,
  text,
  title,
  type Txt,
  W,
} from '../ui/kit.ts';
import type { World } from './World.ts';
import { bestTool } from '../../core/bag.ts';
import { portraitShown, portraitZoom } from '../portraitFit.ts';

const T = 64;

/**
 * One message: a banner at the top (the few big moments) or a small strip on the right (things gained, short notes).
 * They all share one queue. One shows at a time, with at least GAP seconds of clear screen between two, and never
 * over a talk box, a story scene, a card, a menu or a mini-game.
 */
interface Msg {
  /** 'card': the morning card (a guest has come to stay, or a friend dropped in), in the look of the Tomorrow card */
  kind: 'banner' | 'toast' | 'card';
  /** higher goes first; strips are 0 */
  pri: number;
  head: string;
  sub: string;
  item: string | undefined;
  color: number;
  /** sound and sparkle when a banner lands: 'gold' adds confetti (shards and boss wins only) */
  chime: '' | 'soft' | 'gold';
  /** a strip of things gained: several fold into one strip */
  parts: { item: string; label: string; n: number }[];
  /** "Put it on? Space": the gear the rules are asking about (Space while it shows sends `wear`) */
  wear?: string;
  /** the morning card: who, and the present a visitor brought */
  who?: string;
  gift?: string;
  n?: number;
}
/** The message on screen now. */
interface Shown {
  m: Msg;
  box: Phaser.GameObjects.Container;
  /** seconds left, and seconds shown so far */
  life: number;
  age: number;
  leaving: boolean;
}
/** Seconds of clear screen between two messages. */
const GAP = 1.5;
/** Small strips slide in under the clock. */
const TOAST_Y = 300;
/** The banner lane: below the hearts row, clear of the clock on the right. */
const BANNER_Y = 120;
const CLOCK_LEFT = W - 340;
/** Boss fight lines that come as a big banner (one at a time), with the face of who it is about. */
const BOSS_BANNERS: Record<string, string> = {
  jockey_start: 'face_spider_jockey',
  jockey_off: 'face_skeleton',
  jockey_again: 'face_spider_jockey',
  king_phase0: 'face_creeper_king',
  king_phase1: 'face_creeper_king',
  king_phase2: 'face_creeper_king',
  king_hide: 'face_creeper_king',
  king_again: 'face_creeper_king',
};
/** A pooled screen-space particle. */
interface UBit {
  img: Phaser.GameObjects.Image;
  vx: number;
  vy: number;
  g: number;
  life: number;
  max: number;
  spin: number;
}
const MAX_BITS = 160;
/** A place name on the screen: 0.4 s in, 1.6 s held, 0.4 s out. */
const NAME_S = 2.4;
/** How long the morning card stays when Space does not close it first. */
const CARD_S = 5;
/**
 * Package 71 (D78, G: "the yellow arrow is too big"): the guide arrow's size on the 1920 x 1080 screen, in pixels across
 * its longest side, and its gentle pulse (a share of that size). With the pulse it stays under 40 pixels. The star over
 * the goal shrinks by the same share of its old size.
 */
export const ARROW_PX = 36;
/** G (22 Nov 2026: "very rapid moving and bounces around"): the pulse is very gentle and slow, and nothing bobs. */
export const ARROW_PULSE = 0.03;
const PULSE_RATE = 2;
/**
 * The arrow turns towards where the guide aims with this time constant (seconds), and ignores a change of aim smaller
 * than ARROW_DEAD (radians, about 5 degrees), so it glides instead of jumping and stays still while she stands still.
 */
export const ARROW_TAU = 0.4;
export const ARROW_DEAD = 0.09;
const HELP_SHARE = 0.6;
/** Package 78: the red marker at the screen's edge for what hit her from off screen: how wide, and how long it stays. */
export const HIT_PX = 34;
export const HIT_SECS = 1;
/** The signs the objective chip shows for a kind of step when there is no thing to bring. */
const STEP_SIGN: Record<string, string> = {
  talk: 'ui_sign_talk',
  reach: 'ui_sign_go',
  night: 'ui_sign_go',
  sleep: 'ui_sign_go',
  lead: 'ui_sign_go',
  craft: 'ui_sign_make',
  place: 'ui_sign_make',
  defeat: 'ui_sign_fight',
  mini: 'ui_sign_play',
};
/** A picture bubble over someone who is waiting for a thing. */
interface Bubble {
  box: Phaser.GameObjects.Container;
  pic: Phaser.GameObjects.Image;
  n: Txt;
  tick: Phaser.GameObjects.Image;
  item: string;
}

/**
 * Issue 64: tips that name a key, as an iPad says them: the button's own word (the big button says Swing when a mob is
 * in reach; the small one says Bow once she has one).
 */
const TOUCH_TIPS: Record<string, string> = {
  fight_hint: 'Tap Swing when you see it. Then step back.',
  too_high: 'Too high for a sword. Tap Bow to shoot it.',
};

export class UI extends Phaser.Scene {
  world!: World;
  keys!: Keys;
  overlay: Overlay | null = null;
  private hearts: Phaser.GameObjects.Image[] = [];
  private heartKey = '';
  /** blue shield hearts came back: they bump once */
  private shieldBump = false;
  // the arrow count by the hotbar, when she wears a bow
  private arrowIcon!: Phaser.GameObjects.Image;
  private arrowText!: Txt;
  private arrowsShown = -1;
  private dial!: Phaser.GameObjects.Image;
  private hand!: Phaser.GameObjects.Image;
  private dayText!: Txt;
  private gemText!: Txt;
  private objBox!: Phaser.GameObjects.Graphics;
  private objText!: Txt;
  private objKey = '';
  private nudgeText!: Txt;
  /** the last tip turned into iPad words, and what it became */
  private tipFrom = '';
  private tipTo = '';
  private lastNudge = '';
  private bossNudge = '';
  private hot: { img: Phaser.GameObjects.Image; n: Txt; id: string; count: number }[] = [];
  private hotG!: Phaser.GameObjects.Graphics;
  private hotSel = -1;
  private hintText!: Txt;
  /** package 78: "R: Eat" while the strip shows it (a tap on that end of the strip eats, on touch) */
  private eatLabel = '';
  /** issue 68: the touch layer's word for the big button while "Put it on?" asks ('' when it does not) */
  askWord = '';
  private hintKey = '';
  private arrow!: Phaser.GameObjects.Image;
  private marker!: Phaser.GameObjects.Image;
  /** G (22 Nov 2026): a small house sign by the star on a door, or by the edge arrow, when the goal is inside */
  private houseSign!: Phaser.GameObjects.Image;
  /**
   * The arrow as shown, eased (view only): its angle, the aim it is turning to (moved only past ARROW_DEAD), where it
   * is drawn, whether it is beside her or at the edge, and what it last aimed for (her area and the goal's) so a new
   * goal or area snaps it once instead of swinging it across the screen.
   */
  private arrowSm = { on: false, ang: 0, goal: 0, x: 0, y: 0, edge: false, key: '' };
  /** package 78: where the last thing that hurt her stood (tiles), and the seconds its edge marker has left */
  private hitFrom = { x: 0, y: 0, left: 0 };
  private hitArrow!: Phaser.GameObjects.Image;
  /** the frames-a-second read-out (the ` key), and seconds until it is written again */
  private fpsText!: Phaser.GameObjects.Text;
  private fpsT = 0;
  /** package 73a (I3): the island from above while she looks out of a telescope or a window */
  private lookView!: LookView;
  // messages: one queue, one on screen at a time
  private msgQ: Msg[] = [];
  private cur: Shown | null = null;
  /** seconds since the last message left the screen */
  private clearT = 99;
  /** for the calm check and the smoke run: how many showed, the most at once, the shortest gap between two */
  readonly msgStats = { shown: 0, now: 0, most: 0, minGap: 99 };
  /** seconds the screen has been free of talk, cutscenes, cards and menus (queued fanfares wait for a short gap) */
  private freeT = 0;
  // dialogue
  private dlg!: Phaser.GameObjects.Container;
  private dlgName!: Txt;
  private dlgText!: Txt;
  private dlgMore!: Phaser.GameObjects.Image;
  private dlgChoices: Txt[] = [];
  /** the talk box itself, redrawn taller when its choices lift it */
  private dlgBox!: Phaser.GameObjects.Graphics;
  private dlgPick!: Phaser.GameObjects.Image;
  private dlgLine = '';
  private dlgSpeaker = '';
  private dlgShown = -1;
  private portrait: Puppet | null = null;
  private portraitId = '';
  private dlgRight = false;
  // cards
  private card!: Phaser.GameObjects.Container;
  private cardTitle!: Txt;
  private cardLines!: Txt;
  private cardKey = '';
  // build strip
  private buildBox!: Phaser.GameObjects.Container;
  private buildIcons: Phaser.GameObjects.Image[] = [];
  private buildKey = '';
  private buildText!: Txt;
  private areaBanner!: Txt;
  private lastRegion = '';
  /** place names waiting to show, and seconds left of the one showing */
  private nameQ: { name: string; sub: string }[] = [];
  /** region by its map code, built once (looked up as she walks) */
  private regionByCode: Record<string, { name: string }> = {};
  private nameT = 0;
  /** the last name shown and when, so a place found and a region walked into never say the same name twice */
  private nameSaid = '';
  private nameAt = -99;
  /** the day the morning card was shown: one card a morning */
  private morningDay = -1;
  private areaSub!: Txt;
  private t = 0;
  private extra: Phaser.GameObjects.GameObject[] = [];
  private mini!: MiniView;
  /** package 73b: the school quiz's board and the Post Office's "new" mark */
  private quiz!: QuizView;
  private postMark!: PostMark;
  /** a hint when she struggles (src/core/hints.ts) */
  private hints!: HintView;
  // the objective chip: a picture, a number, a few words
  private objIcon!: Phaser.GameObjects.Image;
  private objNum!: Txt;
  private objW = 0;
  private bubbles: Bubble[] = [];
  // the journal hint (K) and the hold-X-to-skip ring
  private kIcon!: Phaser.GameObjects.Image;
  private kText!: Txt;
  private kDot!: Phaser.GameObjects.Arc;
  private skipBox!: Phaser.GameObjects.Container;
  private skipRing!: Phaser.GameObjects.Graphics;
  private skipShown = -1;
  // juice
  private bits: UBit[] = [];
  private bitPool: UBit[] = [];
  private redEdge!: Phaser.GameObjects.Image;
  private objFlash!: Phaser.GameObjects.Graphics;
  private objTick!: Phaser.GameObjects.Image;
  /** seconds the done step's line stays with its tick before the next goal comes */
  private tickHold = 0;
  /** "H: hint", small under the goal line when she has not moved it forward for a while */
  private hintAsk!: Txt;
  private dlgKeys!: Txt;
  // package 46: small pictures of keys, shown the first times they matter and then gone
  private walkHint!: Phaser.GameObjects.Container;
  private walkLabel!: Txt;
  private walkFrom: { x: number; y: number } | null = null;
  private walked = false;
  private spaceCap!: Phaser.GameObjects.Container;
  private hintCap!: Phaser.GameObjects.Container;
  private mIcon!: Phaser.GameObjects.Image;
  private mText!: Txt;
  private hasMap = false;
  private handG!: Phaser.GameObjects.Graphics;
  private handImg!: Phaser.GameObjects.Image;
  private handId = '';
  private dialLabel!: Txt;
  private dialLabelDone = false;
  private gemIcon!: Phaser.GameObjects.Image;
  private gemsShown = -1;
  private lastMode = '';
  // package 67: on an iPad (the touch layer shown) the key pictures give way to words and the buttons' own names
  private touchOn = false;
  private cardMore!: Txt;
  private hotNums: Txt[] = [];
  private walkCaps: Phaser.GameObjects.Container[] = [];
  private skipLabel!: Txt;
  private skipX!: Txt;
  private buildDone!: Txt;

  constructor() {
    super('UI');
  }
  get g(): Game {
    return this.world.g;
  }

  create(): void {
    this.world = this.scene.get('World') as World;
    this.keys = this.world.keys;
    makeUiTextures(this);
    // package 60: the ` key (top left of the keyboard) shows a small frames-a-second read-out in the top left corner
    // for G, off by default (not a function key: checklist CT2)
    this.fpsText = this.add
      .text(6, 2, '', { fontFamily: 'monospace', fontSize: '20px', color: '#ffffff', backgroundColor: '#000000a0' })
      .setDepth(10000)
      .setVisible(false);
    this.input.keyboard?.on('keydown-BACKTICK', () => this.fpsText.setVisible(!this.fpsText.visible));
    this.lookView = new LookView(this);
    // hearts
    // red hearts, then up to 4 blue shield hearts after them
    for (let i = 0; i < 18; i++)
      this.hearts.push(this.add.image(54 + (i % 10) * 58, 54 + Math.floor(i / 10) * 54, 'ui_heart0').setVisible(false));
    // clock, day, emeralds
    this.dial = this.add.image(W - 86, 86, 'ui_dial');
    this.hand = this.add.image(W - 86, 86, 'ui_hand').setOrigin(0.5, 1);
    this.dayText = outlined(this, W - 170, 40, '', 34).setOrigin(1, 0);
    this.gemIcon = this.add.image(W - 190, 124, 'ui_emerald').setScale(0.85);
    this.extra.push(this.gemIcon);
    this.gemText = outlined(this, W - 220, 100, '0', 36).setOrigin(1, 0);
    // objective
    this.objBox = this.add.graphics();
    this.objIcon = this.add.image(64, 196, 'ui_starbig');
    this.objNum = title(this, 102, 170, '', 36, '#b3541e');
    this.objText = text(this, 102, 172, '', 32, INK, 520);
    this.nudgeText = outlined(this, 40, 268, '', 30, 620);
    // package 60: "H: help" was faint on grass: the size of the caption, full strength, on a soft dark plate
    this.hintAsk = outlined(this, 40, 268, '', 28).setVisible(false);
    this.hintAsk.setBackgroundColor('#2a1c10cc').setPadding(10, 4, 10, 4);
    // package 68: the words under the goal line sit on the same plate, so they read at night too
    this.nudgeText.setPadding(10, 4, 10, 4);
    // hotbar
    this.hotG = this.add.graphics();
    for (let i = 0; i < 8; i++) {
      const x = W / 2 - 4 * 92 + i * 92 + 46;
      const img = this.add.image(x, H - 70, '__DEFAULT').setVisible(false);
      const n = outlined(this, x + 36, H - 54, '', 24).setOrigin(1, 0);
      this.hot.push({ img, n, id: '', count: 0 });
      const num = outlined(this, x - 34, H - 110, String(i + 1), 20);
      this.hotNums.push(num);
      this.extra.push(num);
    }
    // package 71 (D78): the bag chooses what is on these buttons; the label says so (hidden with the bar, and on touch,
    // which has its own bag button), above the bar's right end, clear of the hint strip
    const bagCap = outlined(this, W / 2 + 4 * 92, H - 150, this.g.c.strings.hot_bag ?? 'E Bag', 26).setOrigin(1, 0);
    this.hotNums.push(bagCap);
    this.extra.push(bagCap);
    // arrows left, by the hotbar's left end (the hint strip has the right)
    this.arrowIcon = icon(this, 'arrow', W / 2 - 4 * 92 - 96, H - 70, 52)
      .setAngle(-45)
      .setVisible(false);
    this.arrowText = outlined(this, W / 2 - 4 * 92 - 60, H - 92, '', 32).setVisible(false);
    // hint strip
    this.hintText = outlined(this, W - 40, H - 78, '', 34).setOrigin(1, 0);
    // helper
    this.arrow = this.add.image(0, 0, 'ui_arrow').setVisible(false);
    this.marker = this.add.image(0, 0, 'ui_starbig').setVisible(false);
    this.hitArrow = this.add.image(0, 0, 'ui_arrow').setTint(0xff3b3b).setVisible(false);
    // dialogue
    const dg = this.add.graphics();
    panel(dg, 250, 772, 1420, 268);
    this.dlgBox = dg;
    const nameG = this.add.graphics();
    panel(nameG, 520, 728, 360, 76, GOLD, 0x3b2a1a, 22);
    this.dlgName = title(this, 700, 742, '', 38, '#3b2a1a').setOrigin(0.5, 0);
    this.dlgText = text(this, 320, 826, '', 40, INK, 1280);
    this.dlgMore = this.add.image(1610, 992, 'ui_arrow').setAngle(90).setScale(0.6);
    this.dlgPick = this.add.image(0, 0, 'ui_arrow').setScale(0.6);
    // a choice says its keys (package 53a)
    this.dlgKeys = text(this, 1640, 1000, this.g.c.strings.choose_keys ?? 'Up and down. Space.', 28, SOFT)
      .setOrigin(1, 1)
      .setVisible(false);
    this.dlg = this.add
      .container(0, 0, [dg, nameG, this.dlgName, this.dlgText, this.dlgMore, this.dlgPick, this.dlgKeys])
      .setVisible(false)
      .setDepth(LAYER.talk);
    for (let i = 0; i < 4; i++) {
      const c = text(this, 420, 0, '', 38, INK);
      this.dlgChoices.push(c);
      this.dlg.add(c);
    }
    // cards (Tomorrow, carried home)
    const cg = this.add.graphics();
    cg.fillStyle(0x10131f, 0.72).fillRect(0, 0, W, H);
    panel(cg, W / 2 - 520, 250, 1040, 560);
    this.cardTitle = title(this, W / 2, 292, '', 64).setOrigin(0.5, 0);
    this.cardLines = text(this, W / 2 - 420, 410, '', 40, INK, 840);
    const more = outlined(this, W / 2, 840, '', 34).setOrigin(0.5, 0);
    more.setText('Space');
    this.cardMore = more;
    this.card = this.add
      .container(0, 0, [cg, this.cardTitle, this.cardLines, more])
      .setVisible(false)
      .setDepth(LAYER.card);
    // build strip
    const bg = this.add.graphics();
    panel(bg, W / 2 - 560, H - 300, 1120, 150);
    this.buildText = text(this, W / 2 - 530, H - 196, '', 26, SOFT);
    // on an iPad there is no B key: a Done word on the strip ends building
    this.buildDone = title(this, W / 2 + 530, H - 204, '', 36, '#b3541e')
      .setOrigin(1, 0)
      .setVisible(false);
    this.buildBox = this.add.container(0, 0, [bg, this.buildText, this.buildDone]).setVisible(false);
    for (let i = 0; i < 9; i++) {
      const im = this.add.image(W / 2 - 480 + i * 96, H - 244, '__DEFAULT').setVisible(false);
      this.buildIcons.push(im);
      this.buildBox.add(im);
    }
    this.areaBanner = outlined(this, W / 2, 150, '', 60)
      .setOrigin(0.5, 0)
      .setAlpha(0);
    // a landmark's view: one short line under its name
    this.areaSub = outlined(this, W / 2, 232, '', 34, 1100)
      .setOrigin(0.5, 0)
      .setAlpha(0);
    for (const r of Object.values(this.g.c.regions)) this.regionByCode[r.code] = r;
    this.mini = new MiniView(this);
    this.quiz = new QuizView(this);
    this.postMark = new PostMark(this);
    this.hints = new HintView(this, this.mini);
    this.makeJuice();
    this.makeHints();
    this.makeKeys();
    this.world.events.on('ev', this.onEvent, this);
    this.keys.actHook = () => this.answerAsk();
    this.events.once('shutdown', () => {
      this.world.events.off('ev', this.onEvent, this);
      this.keys.actHook = null;
    });
  }

  // ---------------------------------------------------------------- events from the rules

  private onEvent(ev: Ev): void {
    const g = this.g;
    switch (ev.t) {
      case 'toast': {
        const S = g.c.strings;
        if (ev.kind === 'item') this.gained(ev.item ?? '', ev.text, ev.n ?? 1);
        else if (ev.kind === 'info') {
          if (ev.text === 'fish_away') Sound.sfx('away', 0.8);
          if (BOSS_BANNERS[ev.text]) this.bossBanner(ev.text);
          else if (ev.text !== 'page_done') this.note('', fill(g, S[ev.text] ?? ev.text), 0xe8f4ff);
        } else if (ev.kind === 'step') {
          // the objective chip says it (and flashes); a note only when no quest is on the chip
          if (!g.s.tracked) this.note('', ev.text, 0xfff3b0);
        } else if (ev.kind === 'recipe') this.note(ev.item ?? '', `New recipe: ${ev.text}`, 0xd6efff);
        else if (ev.kind === 'quest') {
          if (ev.item === 'done') this.big('Quest done!', ev.text, undefined, 0xffd24a, 3, 'soft');
          // a new quest that goes on the chip needs no message: the chip itself changes
          else if (fill(g, g.c.quests[g.s.tracked ?? '']?.name ?? '') !== ev.text)
            this.note('', `New quest: ${ev.text}`, 0xc9f2c0);
        } else if (ev.kind === 'heart') this.big('A new heart!', '', 'ui_heart2', 0xff9aa8, 2, 'soft');
        else if (ev.kind === 'shard')
          this.big('A star shard!', `${ev.n ?? g.s.shards} of 7`, 'shard', 0xfff3b0, 5, 'gold');
        else if (ev.kind === 'hero')
          this.big(`${ev.text} can now be your hero!`, 'Swap at the mirror.', undefined, 0xd9c2ff, 2, 'soft');
        // 'mail' is told by the reward event; 'sticker' lands quietly on the K hint
        break;
      }
      case 'reward':
        this.onReward(ev.kind, ev.id);
        break;
      case 'sfx':
        if (ev.id === 'ouch') this.hurtEdge();
        break;
      case 'fx':
        // package 78 and 86: the red mark over whatever hit her (hero.ts hurtHero; a mob's notice or wind-up mark is no hit): remember it for the screen's edge
        if (ev.id === 'warn' && ev.item === 'hit') this.hitFrom = { x: ev.x, y: ev.y, left: HIT_SECS };
        break;
      case 'open':
        this.open(ev.ui, ev.arg);
        break;
      case 'gear':
        if (ev.kind === 'ask' && ev.item) this.ask(ev.item);
        else if (ev.kind === 'shieldBack') this.shieldBump = true;
        // worn, off, upgrade: the rules play the sound; the Gear page and the upgrade menu show it
        break;
      case 'place':
        this.placeFound(ev.id);
        break;
      case 'arrive':
        this.morning({ who: ev.who });
        break;
      case 'visit':
        this.morning({ who: ev.who, gift: ev.gift, n: ev.n });
        break;
      case 'save':
        // saving is silent: the little star in the corner was a mark nobody could read (package 46)
        saveNow(g);
        break;
      case 'act':
        if (ev.kind === 'hug') this.hugHearts();
        break;
      default:
        // 'light' (a region lights up) needs no words: the world shows it, and the shard banner has just said why
        break;
    }
  }

  open(name: string, arg?: string): void {
    if (this.overlay) this.closeOverlay(true);
    if (name === 'build') {
      this.keys.send({ c: 'build', on: true });
      return;
    }
    if (name === 'bag' && !arg) {
      // By a table or furnace, E opens the recipe list (design section 3).
      if (stationNear(this.g, 'table')) name = 'craft';
      else if (stationNear(this.g, 'furnace')) {
        name = 'craft';
        arg = 'furnace';
      }
    }
    if (!hasOverlay(name)) return;
    if (name === 'journal' || name === 'stickers') this.kDot.setVisible(false).setData('on', false);
    const o = makeOverlay(this, name, arg);
    if (!o) return;
    this.overlay = o;
    this.world.menuOpen = true;
    this.keys.clearPresses();
    Sound.sfx('open');
  }
  closeOverlay(quiet = false): void {
    if (!this.overlay) return;
    if (!quiet) Sound.sfx('close', 0.8);
    this.overlay.close();
    this.overlay = null;
    this.world.menuOpen = false;
    this.keys.clearPresses();
    this.keys.reset();
  }

  // ---------------------------------------------------------------- messages

  /** Put a message in the queue: banners first (the highest first), then strips in the order they came. */
  private enqueue(m: Msg): void {
    let i = this.msgQ.length;
    while (i > 0 && this.msgQ[i - 1]!.pri < m.pri) i--;
    this.msgQ.splice(i, 0, m);
    // never a long backlog: the oldest plain strip gives way, then the lowest banner
    if (this.msgQ.length > 5) {
      const old = this.msgQ.findIndex((x) => x.kind === 'toast' && !x.parts.length);
      this.msgQ.splice(old >= 0 ? old : this.msgQ.length - 1, 1);
    }
  }

  /** Something gained. Things gained close together fold into one strip. */
  private gained(item: string, label: string, n: number): void {
    const fresh = this.cur && !this.cur.leaving && this.cur.m.parts.length && this.cur.age < 1.2 ? this.cur : null;
    const m = this.msgQ.find((x) => x.parts.length) ?? fresh?.m;
    if (!m) {
      this.enqueue({
        kind: 'toast',
        pri: 0,
        head: '',
        sub: '',
        item: undefined,
        color: 0xfff8e7,
        chime: '',
        parts: [{ item, label, n }],
      });
      return;
    }
    const same = m.parts.find((x) => x.item === item && x.label === label);
    if (same) same.n += n;
    else m.parts.push({ item, label, n });
    if (fresh && m === fresh.m) {
      this.fillToast(fresh.box, m);
      fresh.life = Math.max(fresh.life, 2.2);
    }
  }

  /** A short note as a small strip. The same note already showing or waiting is not said twice. */
  private note(item: string, label: string, color: number): void {
    if (!label) return;
    if (this.cur?.m.head === label || this.msgQ.some((x) => x.head === label)) return;
    this.enqueue({ kind: 'toast', pri: 0, head: label, sub: '', item: item || undefined, color, chime: '', parts: [] });
  }

  /** A banner for the few big moments: a quest done, a heart, a shard, a new hero, a full journal tab, a boss line. */
  private big(
    head: string,
    sub: string,
    item: string | undefined,
    color: number,
    pri = 1,
    chime: Msg['chime'] = '',
  ): void {
    this.enqueue({ kind: 'banner', pri, head, sub, item, color, chime, parts: [] });
  }

  /**
   * New gear: "Put it on? Space", one quiet strip with its picture, never a card. It goes first in the queue (the
   * question only waits a few seconds) and replaces an older question still waiting.
   */
  private ask(item: string): void {
    this.msgQ = this.msgQ.filter((x) => !x.wear);
    this.enqueue({
      kind: 'toast',
      pri: 6,
      // on an iPad the big button says Wear while this shows (issue 68)
      head: this.touchOn ? 'Put it on? Tap Wear.' : 'Put it on? Space',
      sub: '',
      item,
      color: 0xd6efff,
      chime: '',
      parts: [],
      wear: item,
    });
  }

  /** Space went down in play: when "Put it on? Space" is showing, it puts the gear on and takes the press. */
  private answerAsk(): boolean {
    const c = this.cur;
    const g = this.g;
    // Space closes the morning card (not the press that woke her: it has been up a moment first)
    if (c?.m.kind === 'card' && !c.leaving && !this.overlay && g.rt.mode === 'play' && c.age > 0.5) {
      this.hideMsg(false);
      return true;
    }
    // the board in the Square: Space opens the list of up to 3 jobs (the menu takes one with the accept command)
    if (!this.overlay && g.rt.mode === 'play' && (g.rt.hint === 'board' || g.rt.hint === 'bounty') && !c?.m.wear) {
      this.open('board');
      return true;
    }
    if (!c?.m.wear || c.leaving || this.overlay || g.rt.mode !== 'play' || g.rt.ask !== c.m.wear) return false;
    this.keys.send({ c: 'wear', item: c.m.wear });
    this.hideMsg(false);
    return true;
  }

  /**
   * A boss line as a banner: the first sentence is the heading, the rest goes under it. It goes to the front of the
   * queue, plain strips waiting behind it are dropped, and the same line is never said twice in a row.
   */
  private bossBanner(key: string): void {
    const line = fill(this.g, this.g.c.strings[key] ?? key);
    const cut = line.search(/[.!?] /);
    const head = cut > 0 ? line.slice(0, cut + 1) : line;
    const sub = cut > 0 ? line.slice(cut + 2) : '';
    if (this.cur?.m.head === head || this.msgQ.some((b) => b.head === head)) return;
    this.msgQ = this.msgQ.filter((x) => x.kind === 'banner');
    this.big(head, sub, BOSS_BANNERS[key], 0xffd9a8, 4);
  }

  /** The words and pictures of a strip. */
  private fillToast(box: Phaser.GameObjects.Container, m: Msg): number {
    box.removeAll(true);
    const g = this.add.graphics();
    box.add(g);
    let x = 22;
    let high = 62;
    if (m.parts.length <= 1) {
      const p = m.parts[0];
      const pic = p ? p.item : (m.item ?? '');
      if (pic) {
        box.add(icon(this, pic, x + 20, 31, 42));
        x += 52;
      }
      // package 69: never off the edge: a long line wraps inside the strip
      const t = text(this, x, 12, p ? `${p.n > 1 ? `${p.n} ` : ''}${p.label}` : m.head, 28, INK, 620 - x - 24);
      box.add(t);
      x += t.width;
      high = Math.max(62, t.height + 24);
    } else {
      // several things at once: pictures and numbers, no words to read
      const shown = m.parts.slice(0, 5);
      for (const p of shown) {
        if (p.item) {
          box.add(icon(this, p.item, x + 20, 31, 42));
          x += 46;
        }
        const t = text(this, x, 12, String(p.n), 28);
        box.add(t);
        x += t.width + 22;
      }
      if (m.parts.length > shown.length) {
        const t = text(this, x, 12, `+${m.parts.length - shown.length}`, 28, SOFT);
        box.add(t);
        x += t.width + 22;
      }
      x -= 22;
    }
    const w = Math.min(620, x + 24);
    panel(g, 0, 0, w, high, m.color, 0x3b2a1a, 18);
    return w;
  }

  private showMsg(m: Msg): void {
    const st = this.msgStats;
    st.shown++;
    st.now++;
    st.most = Math.max(st.most, st.now);
    if (st.shown > 1) st.minGap = Math.min(st.minGap, this.clearT);
    if (m.kind === 'toast') {
      const box = this.add.container(W + 20, TOAST_Y).setDepth(LAYER.msg);
      const w = this.fillToast(box, m);
      box.setData('w', w);
      // a question stays while the rules wait for the answer
      const life = m.wear ? Math.max(1.5, this.g.rt.ask === m.wear ? this.g.rt.askT : 0) : 2.8;
      this.cur = { m, box, life, age: 0, leaving: false };
      return;
    }
    if (m.kind === 'card') {
      this.showCard(m);
      return;
    }
    const { head, sub, item, color } = m;
    const g = this.add.graphics();
    const headT = title(this, 0, 18, head, 46).setOrigin(0.5, 0);
    const subT = sub ? text(this, 0, 82, sub, 34, SOFT).setOrigin(0.5, 0) : null;
    // as wide as its words, and never over the objective (top left) or the clock (top right)
    const w = Math.max(480, Math.min(760, Math.max(headT.width, subT?.width ?? 0) + (item ? 230 : 100)));
    const objRight = this.objKey && this.objBox.visible ? 24 + this.objW + 24 : 0;
    const cx = Math.min(CLOCK_LEFT - w / 2, Math.max(W / 2, objRight + w / 2));
    const off = item ? 50 : 0;
    headT.setX(off);
    subT?.setX(off);
    panel(g, -w / 2, 0, w, sub ? 150 : 110, color, 0x3b2a1a, 30);
    const parts: Phaser.GameObjects.GameObject[] = [g, headT];
    if (subT) parts.push(subT);
    if (item)
      parts.push(
        item.startsWith('ui_')
          ? this.add.image(-w / 2 + 80, sub ? 75 : 55, item).setScrollFactor(0)
          : icon(this, item, -w / 2 + 80, sub ? 75 : 55, 88),
      );
    const box = this.add.container(cx, -180, parts).setDepth(LAYER.banner);
    this.cur = { m, box, life: 2.9, age: 0, leaving: false };
    this.tweens.add({ targets: box, y: BANNER_Y, duration: 380, ease: 'Back.easeOut' });
    // land: a sparkle round the banner, and the sound the moment deserves
    const by = BANNER_Y + (sub ? 75 : 55);
    if (m.chime === 'gold') {
      this.sparks(cx, by, 26, [0xfff3b0, 0xffd24a, 0xffffff], 520, 1.1, 'fx_star');
      Sound.arp('bell', [0, 4, 7, 12], 0.09, 0.7);
      // confetti is for shards and boss wins only
      this.confetti(70);
    } else {
      this.sparks(cx, by, 12, [0xffffff, color], 380, 0.8, 'fx_star');
      if (m.chime === 'soft') Sound.arp('bell', [0, 4, 7], 0.07, 0.6);
    }
  }

  /** Take the message off the screen. `now` is for a talk or a scene taking over: nothing may show over those. */
  private hideMsg(now: boolean): void {
    const c = this.cur;
    if (!c) return;
    this.cur = null;
    // the clear time is counted from the moment it has slid away
    this.clearT = now ? 0 : -0.26;
    this.msgStats.now--;
    this.tweens.killTweensOf(c.box);
    if (now) {
      c.box.destroy();
      // cut short before she could read it: it comes back afterwards
      if (c.age < 1.2 && !c.leaving) this.msgQ.unshift({ ...c.m, chime: '' });
      return;
    }
    const out = c.m.kind === 'banner' ? { y: -200 } : c.m.kind === 'card' ? { alpha: 0 } : { x: W + 40 };
    this.tweens.add({ targets: c.box, ...out, duration: 260, ease: 'Quad.easeIn', onComplete: () => c.box.destroy() });
  }

  /** One message at a time, a clear screen between two, and nothing over a talk, a scene, a card or a menu. */
  private updateMsgs(dt: number, held: boolean): void {
    const c = this.cur;
    if (held) {
      this.hideMsg(true);
      this.clearT += dt;
      return;
    }
    if (c) {
      c.age += dt;
      // a question that has been answered (or has run out) goes at once
      if (c.m.wear && this.g.rt.ask !== c.m.wear) c.life = 0;
      // a short stay when others are waiting (a question keeps its time)
      c.life -= this.msgQ.length && !c.m.wear ? dt * 1.3 : dt;
      if (c.m.kind === 'toast') {
        const w = c.box.getData('w') as number;
        c.box.x += (W - w - 30 - c.box.x) * Math.min(1, dt * 12);
      }
      if (c.life <= 0) this.hideMsg(false);
      return;
    }
    this.clearT += dt;
    // a question nobody is waiting on any more is not asked
    this.msgQ = this.msgQ.filter((x) => !x.wear || this.g.rt.ask === x.wear);
    if (!this.msgQ.length || this.clearT < GAP || this.freeT < 0.4) return;
    // a banner would sit on a place name: it waits for the name to go
    if (this.msgQ[0]!.kind !== 'toast' && this.nameT > 0) return;
    this.showMsg(this.msgQ.shift()!);
  }

  // ---------------------------------------------------------------- juice

  private makeJuice(): void {
    const mk = (key: string, draw: (g: Phaser.GameObjects.Graphics) => void, w: number, h: number) => {
      if (this.textures.exists(key)) return;
      const gr = this.make.graphics({ x: 0, y: 0 }, false);
      draw(gr);
      gr.generateTexture(key, w, h);
      gr.destroy();
    };
    // a soft red edge, drawn small and stretched to the screen
    mk(
      'ui_redge',
      (g) => {
        for (let i = 0; i < 40; i++) {
          const a = ((40 - i) / 40) ** 2.2 * 0.5;
          g.lineStyle(2, 0xff2a3a, a).strokeRect(i, i, 480 - 2 * i, 270 - 2 * i);
        }
      },
      480,
      270,
    );
    mk(
      'ui_tick',
      (g) => {
        g.fillStyle(0x3b2a1a, 1).fillCircle(24, 24, 23);
        g.fillStyle(0x5cc85c, 1).fillCircle(24, 24, 19);
        g.lineStyle(7, 0xffffff, 1).beginPath().moveTo(13, 25).lineTo(21, 33).lineTo(36, 15).strokePath();
      },
      48,
      48,
    );
    this.redEdge = this.add
      .image(0, 0, 'ui_redge')
      .setOrigin(0, 0)
      .setDisplaySize(W, H)
      .setAlpha(0)
      .setDepth(LAYER.edge)
      .setVisible(false);
    this.objFlash = this.add.graphics().setAlpha(0);
    this.objTick = this.add.image(0, 0, 'ui_tick').setVisible(false);
    // the signs the objective chip uses for a kind of step: a gold disc with one plain shape
    const sign = (key: string, draw: (g: Phaser.GameObjects.Graphics) => void) =>
      mk(
        key,
        (g) => {
          g.fillStyle(0x3b2a1a, 1).fillCircle(32, 32, 32);
          g.fillStyle(0xffd24a, 1).fillCircle(32, 32, 27);
          g.fillStyle(0x3b2a1a, 1);
          draw(g);
        },
        64,
        64,
      );
    sign('ui_sign_talk', (g) => {
      g.fillRoundedRect(14, 16, 36, 24, 9).fillTriangle(22, 38, 34, 38, 20, 50);
      g.fillStyle(0xffd24a, 1).fillCircle(24, 28, 3).fillCircle(32, 28, 3).fillCircle(40, 28, 3);
    });
    sign('ui_sign_go', (g) => {
      g.fillRect(14, 27, 22, 10).fillTriangle(34, 16, 52, 32, 34, 48);
    });
    sign('ui_sign_make', (g) => {
      g.fillRoundedRect(16, 15, 30, 14, 4);
      g.lineStyle(7, 0x3b2a1a, 1).lineBetween(31, 29, 31, 50);
    });
    sign('ui_sign_fight', (g) => {
      g.lineStyle(7, 0x3b2a1a, 1).lineBetween(21, 43, 45, 17).lineBetween(17, 33, 31, 47);
      g.fillCircle(17, 47, 5);
    });
    sign('ui_sign_play', (g) => {
      const pts = Array.from({ length: 10 }, (_v, i) => ({
        x: 32 + Math.cos((i / 10) * Math.PI * 2 - Math.PI / 2) * (i % 2 ? 9 : 20),
        y: 33 + Math.sin((i / 10) * Math.PI * 2 - Math.PI / 2) * (i % 2 ? 9 : 20),
      }));
      g.fillPoints(pts, true);
    });
    // a house with an open door: the goal is inside (G, 22 Nov 2026)
    sign('ui_sign_door', (g) => {
      g.fillTriangle(10, 31, 32, 12, 54, 31).fillRect(16, 30, 32, 21);
      g.fillStyle(0xffd24a, 1).fillRoundedRect(27, 36, 10, 15, { tl: 5, tr: 5, bl: 0, br: 0 });
    });
    this.houseSign = this.add.image(0, 0, 'ui_sign_door').setVisible(false);
    // the bubble over someone who is waiting for a thing
    mk(
      'ui_want',
      (g) => {
        g.fillStyle(0x3b2a1a, 1).fillRoundedRect(0, 0, 84, 76, 22).fillTriangle(12, 70, 34, 70, 8, 92);
        g.fillStyle(0xfffdf2, 1).fillRoundedRect(5, 5, 74, 66, 18).fillTriangle(17, 68, 30, 68, 13, 83);
      },
      84,
      94,
    );
  }

  /** The journal hint by the clock (it sparkles when a sticker lands) and the hold-X-to-skip ring for story scenes. */
  private makeHints(): void {
    this.kIcon = icon(this, 'sticker_book', W - 64, 196, 52);
    this.kText = outlined(this, W - 104, 178, 'K', 30).setOrigin(1, 0);
    this.kDot = this.add
      .circle(W - 40, 174, 9, 0xffd24a)
      .setStrokeStyle(3, 0x3b2a1a)
      .setVisible(false);
    this.extra.push(this.kIcon, this.kText);
    this.skipRing = this.add.graphics();
    const label = outlined(this, -44, -20, 'Hold X to skip', 28).setOrigin(1, 0);
    const x = title(this, 0, -19, 'X', 28, '#3b2a1a').setOrigin(0.5, 0);
    this.skipLabel = label;
    this.skipX = x;
    // top right: the HUD is away during a scene, and the talk box has the bottom of the screen
    this.skipBox = this.add
      .container(W - 76, 76, [label, this.skipRing, x])
      .setDepth(LAYER.skip)
      .setVisible(false);
  }

  /**
   * Package 46: keys as small pictures, not words. The arrow keys before her first step, Space under the first talk
   * boxes and beside every action hint, M beside K once she has Dad's map, the number of the slot to pick when an
   * animal wants what she carries, the tool she will use beside the hotbar, and a one-word label on the clock.
   */
  private makeKeys(): void {
    const wk = [keyCap(this, 'up'), keyCap(this, 'left'), keyCap(this, 'down'), keyCap(this, 'right')];
    this.walkCaps = wk;
    wk[0]!.setPosition(0, -60);
    wk[1]!.setPosition(-66, 0);
    wk[3]!.setPosition(66, 0);
    this.walkLabel = outlined(this, 0, 36, 'Walk', 30).setOrigin(0.5, 0);
    this.walkHint = this.add
      .container(W / 2, H - 270, [...wk, this.walkLabel])
      .setDepth(LAYER.msg)
      .setVisible(false);
    this.spaceCap = keyCap(this, 'Space', 128).setPosition(1500, 990).setDepth(LAYER.talkKey).setVisible(false);
    this.hintCap = keyCap(this, 'Space', 128).setDepth(5).setVisible(false);
    this.mIcon = icon(this, 'dads_map', W - 214, 196, 52).setVisible(false);
    this.mText = outlined(this, W - 254, 178, 'M', 30)
      .setOrigin(1, 0)
      .setVisible(false);
    const hx = W / 2 + 4 * 92 + 22;
    this.handG = this.add.graphics();
    slot(this.handG, hx, H - 112, 84, false);
    this.handG.setVisible(false);
    this.handImg = this.add.image(hx + 42, H - 70, '__DEFAULT').setVisible(false);
    this.dialLabel = outlined(this, W - 86, 140, 'Time', 26)
      .setOrigin(0.5, 0)
      .setAlpha(0);
  }

  /** Mum's hug: the hearts empty and fill again one by one, with a sparkle each. */
  private hugHearts(): void {
    const n = Math.ceil(this.g.s.maxHp / 2);
    for (let i = 0; i < n; i++) {
      const h = this.hearts[i];
      if (!h) continue;
      h.setTexture('ui_heart0');
      this.time.delayedCall(250 + i * 110, () => {
        h.setTexture('ui_heart2');
        this.tweens.add({ targets: h, scale: { from: 1.5, to: 1 }, duration: 260, ease: 'Back.easeOut' });
        if (this.dial.visible) this.sparks(h.x, h.y, 5, [0xff8fa6, 0xffffff], 160, 0.5, 'fx_heart');
        if (i === n - 1) this.heartKey = '';
      });
    }
  }

  /** The key pictures, every frame. */
  private drawKeys(playing: boolean): void {
    const g = this.g;
    const s = g.s;
    const rt = g.rt;
    const hud = this.dial.visible;
    const pro = s.quests.prologue;
    const early = !!pro && !pro.done;
    // the arrow keys, from her first free moment until she has walked a little
    if (!this.walked && early && playing && !this.overlay && hud && s.area === 'cottage') {
      if (!this.walkFrom) this.walkFrom = { x: s.x, y: s.y };
      if (Math.hypot(s.x - this.walkFrom.x, s.y - this.walkFrom.y) > 1.5) {
        this.walked = true;
        this.tweens.add({ targets: this.walkHint, alpha: 0, duration: 400 });
      } else this.walkHint.setVisible(true).setY(H - 270 + Math.sin(this.t * 3) * 4);
    } else if (!this.walked) this.walkHint.setVisible(false);
    // Space under the first talk boxes (the prologue's talks)
    const talk = rt.talk;
    const typed = !!talk && this.focus() === 'talk' && talk.shown >= talk.text.length && !talk.choices;
    this.spaceCap.setVisible(typed && early && (pro?.step ?? 0) <= 4 && !this.touchOn);
    if (this.spaceCap.visible) this.spaceCap.setScale(1 + Math.sin(this.t * 5) * 0.04);
    // M beside K, once she has the map; it jumps in when Dad hands it over
    const map = count(g, 'dads_map') > 0;
    if (map && !this.hasMap) {
      this.hasMap = true;
      if (hud) {
        this.tweens.add({
          targets: [this.mIcon, this.mText],
          scale: { from: 1.8, to: 1 },
          duration: 500,
          ease: 'Back.easeOut',
          onComplete: () => fitSize(this.mIcon, 52),
        });
        this.sparks(W - 214, 196, 12, [0xfff3b0, 0xffd24a, 0xffffff], 300, 0.8, 'fx_star');
      }
    }
    this.mIcon.setVisible(hud && this.hasMap);
    this.mText.setVisible(hud && this.hasMap && !this.touchOn);
    // beside the hotbar: the sword she wears, always (package 60: it changed to the axe by a tree and back, which
    // read as the slot changing by itself; the right tool is used by itself, so she never has to pick one)
    const tool = s.gear?.sword || (bestTool(g, 'sword') ?? '');
    if (tool !== this.handId) {
      this.handId = tool;
      if (tool) setIcon(this, this.handImg, tool, 60);
    }
    this.handG.setVisible(hud && !!tool);
    this.handImg.setVisible(hud && !!tool);
    // the clock says what it is, once
    if (!this.dialLabelDone && hud && playing && early) {
      this.dialLabelDone = true;
      this.dialLabel.setAlpha(1);
      this.tweens.add({ targets: this.dialLabel, alpha: 0, delay: 5000, duration: 800 });
    }
    if (!hud) this.dialLabel.setAlpha(0);
  }

  /** A sticker landed: no banner, only a sparkle on the K hint and a dot that stays until she looks. */
  private kSparkle(): void {
    this.kDot.setVisible(this.dial.visible);
    this.kDot.setData('on', true);
    if (!this.dial.visible) return;
    this.tweens.killTweensOf(this.kIcon);
    const sc = this.kIcon.scale;
    this.tweens.add({
      targets: this.kIcon,
      scale: { from: sc * 1.5, to: sc },
      duration: 420,
      ease: 'Back.easeOut',
      onComplete: () => fitSize(this.kIcon, 52),
    });
    this.sparks(W - 64, 196, 12, [0xfff3b0, 0xffd24a, 0xffffff], 300, 0.8, 'fx_star');
  }

  /** "Hold X to skip" with a ring that fills, while a story scene that may be skipped is playing. */
  private drawSkip(): void {
    const g = this.g;
    const on = !!g.rt.cut && !this.overlay && canSkip(g);
    if (on !== this.skipBox.visible) {
      this.skipBox.setVisible(on);
      this.skipShown = -1;
    }
    if (!on) return;
    const v = Math.round((g.rt.skip ?? 0) * 40) / 40;
    if (v === this.skipShown) return;
    this.skipShown = v;
    const r = this.skipRing;
    r.clear();
    r.fillStyle(0x3b2a1a, 1).fillCircle(0, 0, 30);
    r.fillStyle(0xfff8e7, 1).fillCircle(0, 0, 25);
    if (v > 0) {
      r.lineStyle(8, 0xffb000, 1).beginPath();
      r.arc(0, 0, 24, -Math.PI / 2, -Math.PI / 2 + v * Math.PI * 2, false).strokePath();
    }
  }

  private onReward(kind: string, id: string): void {
    const g = this.g;
    if (kind === 'sticker') {
      this.kSparkle();
      // a boss is beaten (its sticker lands only then): confetti, as for a shard
      if (id === 'mob_spider_jockey' || id === 'mob_creeper_king') this.confetti(70);
    } else if (kind === 'mail') this.note('mailbox', 'Post! Look in your mailbox.', 0xfff8e7);
    else if (kind === 'secret') {
      if (id.startsWith('page:')) {
        // a journal tab is full: one banner, with the prize the rules have just given
        const page = id.slice(5);
        const prize = TAB_PRIZE[page];
        const what = prize?.item
          ? `a ${g.c.items[prize.item]?.name ?? prize.item}`
          : `${prize?.emeralds ?? 0} emeralds`;
        this.big(
          `${page.charAt(0).toUpperCase()}${page.slice(1)} page full!`,
          `Your prize: ${what}.`,
          prize?.item ?? 'emerald',
          0xffb3d1,
          3,
          'soft',
        );
      } else if (id.startsWith('sign:')) this.note('', fill(g, g.c.strings.sign_found ?? ''), 0xe8f4ff);
    } else if (kind === 'step') this.stepDone();
  }

  /** Quest step done: the tracker flashes and a green tick pops by it. */
  private stepDone(): void {
    if (!this.dial.visible || !this.objKey || this.g.rt.cut || this.g.rt.talk || this.g.rt.card) return;
    this.tickHold = 0.9;
    // package 68: a count that has just filled shows full for a second ("Spiders 3 of 3")
    const m = /^(.*?)(\d+) of (\d+)$/.exec(this.objNum.text);
    if (m && Number(m[2]) < Number(m[3])) {
      this.objNum.setText(`${m[1]}${m[3]} of ${m[3]}`);
      this.tickHold = 1;
    }
    const w = this.objW;
    const h = this.objText.height + 34;
    this.objFlash.clear().fillStyle(0xffffff, 1).fillRoundedRect(24, 156, w, h, 22);
    this.tweens.killTweensOf(this.objFlash);
    this.objFlash.setAlpha(0.85);
    this.tweens.add({ targets: this.objFlash, alpha: 0, duration: 450, ease: 'Quad.easeOut' });
    this.tweens.killTweensOf(this.objTick);
    this.objTick
      .setVisible(true)
      .setPosition(24 + w, 160)
      .setScale(0)
      .setAlpha(1);
    this.tweens.add({ targets: this.objTick, scale: 1, duration: 260, ease: 'Back.easeOut' });
    this.tweens.add({
      targets: this.objTick,
      alpha: 0,
      delay: 600,
      duration: 250,
      onComplete: () => this.objTick.setVisible(false),
    });
    this.sparks(24 + w, 160, 8, [0x7be37b, 0xffffff, 0xffd24a], 260, 0.6, 'fx_star');
  }

  /** She got hurt: a soft red edge for a moment (the shake comes from the rules). Not while her hearts are full. */
  private hurtEdge(): void {
    // her armour took the whole hit: the shake and her flinch say enough (fun panel 7)
    if (this.g.s.hp >= this.g.s.maxHp) return;
    this.tweens.killTweensOf(this.redEdge);
    this.redEdge.setVisible(true).setAlpha(this.g.s.opts.lowFx ? 0.3 : 0.6);
    this.tweens.add({
      targets: this.redEdge,
      alpha: 0,
      duration: 420,
      ease: 'Quad.easeIn',
      onComplete: () => this.redEdge.setVisible(false),
    });
  }

  private bit(key: string, x: number, y: number): UBit | null {
    let b = this.bitPool.pop();
    if (!b) {
      if (this.bits.length >= MAX_BITS) return null;
      b = { img: this.add.image(0, 0, key).setDepth(LAYER.bits), vx: 0, vy: 0, g: 0, life: 0, max: 1, spin: 0 };
    }
    b.img.setTexture(key).setPosition(x, y).setVisible(true).setAlpha(1).setAngle(0);
    this.bits.push(b);
    return b;
  }

  /** A burst of screen-space sparkles. */
  private sparks(x: number, y: number, n: number, colors: number[], speed: number, life: number, key: string): void {
    if (this.g.s.opts.lowFx) n = Math.ceil(n / 2);
    for (let i = 0; i < n; i++) {
      const b = this.bit(key, x, y);
      if (!b) return;
      const a = Math.random() * Math.PI * 2;
      const sp = speed * (0.35 + Math.random() * 0.75);
      b.vx = Math.cos(a) * sp;
      b.vy = Math.sin(a) * sp * 0.7 - 80;
      b.g = 500;
      b.life = b.max = life * (0.7 + Math.random() * 0.6);
      b.spin = (Math.random() - 0.5) * 600;
      b.img.setScale(0.5 + Math.random() * 0.6).setTint(colors[Math.floor(Math.random() * colors.length)]!);
    }
  }

  /** Confetti falling over the whole screen. */
  private confetti(n: number): void {
    if (this.g.s.opts.lowFx) n = Math.ceil(n / 2);
    const colors = [0xff5a5a, 0xffd24a, 0x5ac8ff, 0x7be37b, 0xc78bff, 0xffffff];
    for (let i = 0; i < n; i++) {
      const b = this.bit('fx_sq', Math.random() * W, -20 - Math.random() * 260);
      if (!b) return;
      b.vx = (Math.random() - 0.5) * 160;
      b.vy = 160 + Math.random() * 220;
      b.g = 120;
      b.life = b.max = 2.6 + Math.random() * 0.8;
      b.spin = (Math.random() - 0.5) * 700;
      b.img.setScale(0.9 + Math.random() * 0.8, 0.6 + Math.random() * 0.5).setTint(colors[i % colors.length]!);
    }
  }

  private updateJuice(dt: number): void {
    const g = this.g;
    const rt = g.rt;
    // queues wait while a menu, a card, a talk, a cutscene or a mini-game has the screen, then for a short gap
    const held = this.held();
    this.freeT = held ? 0 : this.freeT + dt;
    this.updateMsgs(dt, held);
    // the emerald counter bumps when it goes up
    const gems = g.s.emeralds;
    if (gems > this.gemsShown && this.gemsShown >= 0 && this.dial.visible) {
      this.tweens.killTweensOf([this.gemText, this.gemIcon]);
      this.tweens.add({ targets: this.gemText, scale: { from: 1.4, to: 1 }, duration: 320, ease: 'Back.easeOut' });
      this.tweens.add({ targets: this.gemIcon, scale: { from: 1.25, to: 0.85 }, duration: 320, ease: 'Back.easeOut' });
      this.sparks(W - 190, 124, 6, [0x7be37b, 0xffffff], 220, 0.5, 'fx_star');
    }
    this.gemsShown = gems;
    // mini-games: a whoosh going in (confetti is kept for shards and boss wins)
    if (rt.mode !== this.lastMode) {
      if (rt.mode === 'mini') Sound.sfx('whoosh', 0.8);
      this.lastMode = rt.mode;
    }
    // pooled bits
    const bits = this.bits;
    for (let i = bits.length - 1; i >= 0; i--) {
      const b = bits[i]!;
      b.life -= dt;
      b.vy += b.g * dt;
      b.img.x += b.vx * dt;
      b.img.y += b.vy * dt;
      b.img.angle += b.spin * dt;
      b.img.setAlpha(Math.min(1, (b.life / b.max) * 2.5));
      if (b.life <= 0) {
        b.img.setVisible(false);
        bits[i] = bits[bits.length - 1]!;
        bits.pop();
        this.bitPool.push(b);
      }
    }
  }

  /** Something she needs to read or watch has the screen. */
  private held(): boolean {
    const rt = this.g.rt;
    return !!this.overlay || !!rt.card || !!rt.talk || !!rt.cut || rt.mode === 'mini' || rt.mode === 'talk';
  }

  /**
   * The one thing she is using now, which alone is shown and takes the keys: the open menu, else a card from the
   * rules, else the talk box, else the morning card. One that arrives while another is open waits hidden until that
   * one closes (the rules stand still under a menu, so a talk begun there, such as Grandad's line when the sword is
   * made at his bench, waits unread). Everything passive sits below LAYER.talk and is held by held() meanwhile.
   */
  focus(): 'menu' | 'card' | 'talk' | 'morning' | '' {
    const rt = this.g.rt;
    if (this.overlay) return 'menu';
    if (rt.card) return 'card';
    if (rt.talk) return 'talk';
    if (this.cur?.m.kind === 'card') return 'morning';
    return '';
  }

  // ---------------------------------------------------------------- every frame

  update(_time: number, delta: number): void {
    const dt = delta / 1000;
    const g = this.g;
    const s = g.s;
    const rt = g.rt;
    this.t += dt;
    if (this.fpsText.visible && (this.fpsT -= dt) <= 0) {
      this.fpsT = 0.5;
      this.fpsText.setText(`${Math.round(this.game.loop.actualFps)} FPS`);
    }
    const keys = this.keys;
    if (touchState.shown !== this.touchOn) this.touchWords(touchState.shown);
    Sound.volumes(s.opts.music, s.opts.sound);
    if (this.overlay) {
      this.overlay.update(dt);
      if (this.overlay?.done) this.closeOverlay();
    } else this.hotkeys();
    const playing = rt.mode === 'play' || rt.mode === 'fishing' || rt.mode === 'build';
    // a cutscene or a mini-game has the whole screen: no objective chip, no hotbar
    // (a menu has its own screen too: nothing of the HUD shows through its dimmed edges)
    this.hudVisible(!rt.cut && rt.mode !== 'cut' && rt.mode !== 'mini' && !this.overlay);
    this.drawHearts();
    // clock
    this.hand.setRotation((s.time / DAY_LEN) * Math.PI * 2 - Math.PI * 0.5 + Math.PI * 0.02);
    const day = `Day ${s.day}`;
    if (this.dayText.text !== day) this.dayText.setText(day);
    const gems = String(s.emeralds);
    if (this.gemText.text !== gems) this.gemText.setText(gems);
    this.tickHold = Math.max(0, this.tickHold - dt);
    this.drawObjective();
    this.drawHotbar();
    this.drawArrows();
    // hint strip
    // while "Put it on? Space" shows, Space means that and nothing else
    const asking = (!!this.cur?.m.wear || this.cur?.m.kind === 'card') && !this.cur?.leaving;
    this.askWord = asking && this.cur?.m.wear && !this.overlay && rt.mode === 'play' ? 'Wear' : '';
    // the key is a picture beside the word (package 46)
    // package 74 (I8): on a swing, Space pushes
    const hk = rt.fun?.move === 'swing' && rt.fun.leap === undefined ? 'push' : rt.hint;
    const word = asking
      ? ''
      : playing && !this.overlay && hk
        ? this.hintWord(hk, rt.hintObj)
        : rt.mode === 'build'
          ? 'Place'
          : '';
    // package 69: hearts low and food in the bag: "R: Eat" beside the Space word (or alone)
    const eat = !asking && rt.mode === 'play' && !this.overlay && rt.eatHint ? (g.c.strings.r_eat ?? 'R: Eat') : '';
    const hint = word && eat ? `${word}    ${eat}` : word || eat;
    this.eatLabel = eat;
    if (hint !== this.hintKey) {
      this.hintKey = hint;
      // (package 68: on a dark plate, as "H: help" is, so it reads at night)
      this.hintText
        .setText(hint)
        .setPadding(8, 2, 8, 2)
        .setBackgroundColor(hint ? '#2a1c10cc' : '#00000000');
      this.hintCap.setPosition(W - 40 - this.hintText.width - 82, H - 58);
    }
    this.hintCap.setVisible(!!word && this.dial.visible && !this.touchOn);
    this.drawKeys(playing);
    this.drawHelper(dt, playing && !this.overlay);
    this.drawHit(dt, playing && !this.overlay);
    this.drawBubbles(rt.mode === 'play' && !this.overlay && !rt.cut);
    this.drawSkip();
    this.lookView.update(g, dt);
    this.drawTalk(dt);
    this.drawCard();
    this.drawBuild();
    this.drawRegion(dt);
    this.mini.update(dt);
    this.quiz.update(dt);
    this.postMark.update(dt, playing && !this.overlay && !this.screenBusy());
    this.hints.update(dt);
    this.updateJuice(dt);
    void keys;
  }

  private hudVisible(v: boolean): void {
    if (this.dial.visible === v) return;
    for (const o of [
      this.dial,
      this.hand,
      this.dayText,
      this.gemText,
      this.objBox,
      this.objIcon,
      this.objNum,
      this.objText,
      this.hotG,
      this.hintText,
      this.nudgeText,
    ])
      o.setVisible(v);
    for (const o of this.extra) (o as Phaser.GameObjects.Image).setVisible(v);
    if (this.touchOn) for (const o of [this.kText, ...this.hotNums]) o.setVisible(false);
    for (const h of this.hot) {
      h.img.setVisible(v && !!h.id);
      h.n.setVisible(v);
    }
    this.heartKey = '';
    this.arrowsShown = -2;
    if (!v) {
      this.arrowIcon.setVisible(false);
      this.arrowText.setVisible(false);
    }
    // the chip's picture and number only when there is a goal to show
    this.objIcon.setVisible(v && !!this.objText.text);
    this.objNum.setVisible(v && !!this.objText.text);
    this.kDot.setVisible(v && !!this.kDot.getData('on'));
    if (!v) for (const h of this.hearts) h.setVisible(false);
  }

  /** Keys that open things, when nothing is open. */
  /**
   * Package 67: the touch layer came or went. On an iPad the key pictures go: a prompt says the word alone or the
   * button's own name, the M and K labels by the map and journal go (the pictures answer a tap) and so do the hotbar's
   * numbers. A laptop never comes here unless it has a touch screen and is touched.
   */
  private touchWords(on: boolean): void {
    this.touchOn = on;
    const S = this.g.c.strings;
    for (const c of this.walkCaps) c.setVisible(!on);
    this.walkLabel.setText(on ? 'Drag on the left to walk' : 'Walk');
    const hud = this.dial.visible;
    this.kText.setVisible(hud && !on);
    for (const n of this.hotNums) n.setVisible(hud && !on);
    this.cardMore.setText(on ? (S.touch_ok ?? 'OK') : 'Space');
    this.dlgKeys.setText((on ? S.touch_choose : S.choose_keys) ?? '');
    this.skipLabel.setText(on ? (S.touch_hold_skip ?? '') : 'Hold X to skip');
    this.skipX.setVisible(!on);
    this.buildDone.setText(on ? (S.touch_done ?? '') : '').setVisible(on);
    this.buildKey = '';
    this.hintAsk.setText('');
  }

  /** A tap during a mini-game, from src/game/touch.ts: true when the school quiz took it (an answer card, or a tap while it runs). */
  miniTap(x: number, y: number): boolean {
    return this.quiz.tap(x, y);
  }

  /**
   * Package 67: a tap on the play screen (1920 x 1080), from src/game/touch.ts. Answers the key to press for the HUD
   * thing under the finger ('' for nothing): the journal and map pictures, the Help word, and in building the strip's
   * pictures (tap one to choose it, tap the chosen one to turn it) and its Done word.
   */
  hudTap(x: number, y: number): string {
    const g = this.g;
    const near = (o: Phaser.GameObjects.Image | Txt, pad: number) =>
      o.visible && Phaser.Geom.Rectangle.Inflate(o.getBounds(), pad, pad).contains(x, y);
    if (g.rt.mode === 'build' && this.buildBox.visible) {
      if (near(this.buildDone, 16)) return 'KeyB';
      const list = placeables(g);
      const sel = g.rt.build?.sel ?? 0;
      const first = Math.max(0, Math.min(sel - 4, list.length - 9));
      for (let i = 0; i < this.buildIcons.length; i++) {
        const im = this.buildIcons[i]!;
        if (!im.visible || Math.abs(x - im.x) > 46 || Math.abs(y - im.y) > 50) continue;
        if (first + i === sel) return 'KeyR';
        this.keys.send({ c: 'bsel', d: first + i - sel });
        return 'done';
      }
      return '';
    }
    if (g.rt.mode !== 'play' || this.overlay || !this.dial.visible) return '';
    if (near(this.kIcon, 20)) return 'KeyK';
    if (near(this.mIcon, 20)) return 'KeyM';
    if (near(this.hintAsk, 12)) return 'KeyH';
    // package 78: a tap on "R: Eat" (the right end of the strip) eats, as R does
    if (this.eatLabel && this.hintText.visible) {
      const b = Phaser.Geom.Rectangle.Inflate(this.hintText.getBounds(), 16, 16);
      const w = b.width * (this.eatLabel.length / Math.max(1, this.hintKey.length));
      if (x >= b.right - w - 16 && x <= b.right && y >= b.y && y <= b.bottom) return 'KeyR';
    }
    return '';
  }

  private hotkeys(): void {
    const g = this.g;
    const k = this.keys;
    const mode = g.rt.mode;
    if (k.take('KeyF')) this.scale.toggleFullscreen();
    if (mode === 'build') {
      if (k.takeAny('KeyB')) k.send({ c: 'build', on: false });
      const d = k.takeDigit();
      if (d >= 0) k.send({ c: 'bsel', d: d - (g.rt.build?.sel ?? 0) });
      if (k.take('KeyQ')) k.send({ c: 'bsel', d: -1 });
      if (k.take('KeyE')) k.send({ c: 'bsel', d: 1 });
      return;
    }
    if (mode !== 'play') {
      // package 68: Escape in a talk does nothing (it opened the pause menu, which read as a lost talk); P still does
      // package 69: on a mini-game's start or end card and on a question, Escape is the kind answer ("Not now")
      if ((mode === 'mini' || (mode === 'talk' && g.rt.talk?.choices)) && k.take('Escape')) k.send({ c: 'back' });
      if (mode === 'talk') k.take('Escape');
      if (k.takeAny('KeyP', 'Escape') && (mode === 'talk' || mode === 'card')) this.open('pause');
      k.takeAny('KeyE', 'KeyQ', 'KeyM', 'KeyK', 'KeyB');
      k.takeDigit();
      return;
    }
    const d = k.takeDigit();
    if (d >= 0) k.send({ c: 'hot', i: d });
    if (k.take('KeyE')) this.open('bag');
    else if (k.take('KeyQ')) this.open('quests');
    else if (k.take('KeyM')) this.open('map');
    else if (k.take('KeyK')) this.open('journal');
    // package 68: Escape closes the help card she asked for with H (the pause menu waits for the next press)
    else if (g.rt.help.show?.asked && k.take('Escape')) k.send({ c: 'hint' });
    else if (k.takeAny('KeyP', 'Escape')) this.open('pause');
    else if (k.take('KeyB')) k.send({ c: 'build', on: true });
  }

  /** Red hearts, then the blue shield hearts her armour gives (at most 4), in the same row. */
  private drawHearts(): void {
    const g = this.g;
    const s = g.s;
    const sMax = shieldMax(g);
    const sh = Math.min(s.shield ?? 0, sMax);
    const key = `${s.hp}/${s.maxHp}/${sh}/${sMax}`;
    if (key === this.heartKey || !this.dial.visible) return;
    const grew = this.heartKey !== '' && Number(this.heartKey.split('/')[0]) < s.hp;
    this.heartKey = key;
    const n = Math.ceil(s.maxHp / 2);
    const m = Math.ceil(sMax / 2);
    for (let i = 0; i < this.hearts.length; i++) {
      const h = this.hearts[i]!;
      h.setVisible(i < n + m);
      if (i < n) h.setTexture('ui_heart' + Math.max(0, Math.min(2, s.hp - i * 2)));
      else if (i < n + m) h.setTexture('ui_shield' + Math.max(0, Math.min(2, sh - (i - n) * 2)));
    }
    if (grew)
      this.tweens.add({
        targets: this.hearts.slice(0, n),
        scale: { from: 1.35, to: 1 },
        duration: 260,
        ease: 'Back.easeOut',
      });
    if (this.shieldBump && m) {
      this.shieldBump = false;
      this.tweens.add({
        targets: this.hearts.slice(n, n + m),
        scale: { from: 1.35, to: 1 },
        duration: 260,
        ease: 'Back.easeOut',
      });
    }
  }

  /** A small arrow count by the hotbar, only when she wears a bow. */
  private drawArrows(): void {
    const g = this.g;
    const on = this.dial.visible && !!worn(g).bow;
    const n = on ? count(g, 'arrow') : -1;
    if (n === this.arrowsShown) return;
    this.arrowsShown = n;
    this.arrowIcon.setVisible(on);
    this.arrowText.setVisible(on).setText(on ? String(n) : '');
  }

  /** The objective chip: a picture (the thing to bring, or a sign for the kind of step), a number, a few words. */
  /** The word on the hint strip. Package 47b: the fish board and the cup shelf are stalls that only show a page. */
  private hintWord(hint: string, obj: number): string {
    const g = this.g;
    if (hint === 'stall' && obj >= 0) {
      const d = g.c.areas[g.s.area]?.objects[obj]?.d;
      if (d === 'fishboard' || d === 'cups') return g.c.strings['hint:sign'] ?? 'Read';
    }
    // package 73b: her greenhouse pot says Plant, Pick or Look
    const pot = hint === 'grow' && obj >= 0 ? g.c.areas[g.s.area]?.objects[obj] : undefined;
    if (pot && potOf(pot)) {
      const h = potHint(g, potOf(pot));
      return g.c.strings[h === 'plant' ? 'hint:grow' : `hint:grow_${h}`] ?? hint;
    }
    // package 73a: the lamp says "Light" while it is off, nothing once it is on
    if (hint === 'lamp' && lampOn(g)) return '';
    return g.c.strings['hint:' + hint] ?? hint;
  }

  /** A talk, a scene or a card (the rules' or a morning card) has the screen: the goal line and the star wait. */
  private screenBusy(): boolean {
    const rt = this.g.rt;
    return !!rt.talk || !!rt.cut || !!rt.card || (this.cur?.m.kind === 'card' && !this.cur.leaving);
  }

  private drawObjective(): void {
    const g = this.g;
    // The goal line (package 53a, rule in core/goal.ts): hidden while a talk, a scene or a card has the screen, so it
    // moves on only once the step's talk has closed and nothing ever covers it. When a step is done in plain play,
    // the old line stays a moment with its tick, then the new one comes.
    const busy = this.screenBusy();
    const goal = busy ? null : goalLine(g);
    let line = '';
    let num = '';
    let pic = '';
    if (goal) {
      line = goal.text;
      num = goal.num;
      const st = goal.step;
      // the place ring's line names the button on an iPad ("Tap Place.")
      if (this.touchOn && st?.t === 'place' && line === placeRingLine(g, st.item, false))
        line = placeRingLine(g, st.item, true);
      if (goal.den) pic = 'ui_sign_fight';
      else if (goal.inside) pic = 'ui_sign_door';
      else if (!st) pic = 'ui_sign_talk';
      else if (st.t === 'fetch' || st.t === 'deliver') pic = st.item;
      else if (st.t === 'grow') pic = st.crop;
      else if (st.t === 'fish') pic = st.kind ?? 'fishing_rod';
      else pic = STEP_SIGN[st.t] ?? 'ui_sign_go';
    }
    if (busy) {
      this.tickHold = 0;
      this.objTick.setVisible(false);
    }
    const hold = this.tickHold > 0 && this.objKey !== '';
    const key = hold ? this.objKey : `${pic}|${num}|${line}`;
    if (key !== this.objKey) {
      const first = this.objKey === '';
      const sameStep = this.objKey.endsWith(`|${line}`) && this.objKey.startsWith(`${pic}|`);
      this.objKey = key;
      if (!sameStep) this.objTick.setVisible(false);
      const show = !!line && this.dial.visible;
      this.objBox.clear();
      this.objIcon.setVisible(show);
      this.objNum.setText(num).setVisible(show);
      this.objText.setText(line);
      if (line) {
        if (pic.startsWith('ui_')) this.objIcon.setTexture(pic).setScale(0.8);
        else setIcon(this, this.objIcon, pic, 54);
        const tx = 102 + (num ? this.objNum.width + 14 : 0);
        this.objText.setX(tx);
        this.objW = Math.min(720, tx - 24 + this.objText.width + 26);
        panel(this.objBox, 24, 156, this.objW, this.objText.height + 34, CREAM, GOLD, 22);
        // a new goal makes the chip jump; a number going up only bumps the number
        if (!first && !sameStep)
          this.tweens.add({
            targets: this.objText,
            scale: { from: 1.12, to: 1 },
            duration: 260,
            ease: 'Back.easeOut',
          });
        else if (!first)
          this.tweens.add({ targets: this.objNum, scale: { from: 1.3, to: 1 }, duration: 240, ease: 'Back.easeOut' });
      }
      this.nudgeText.setY(156 + (line ? this.objText.height + 50 : 0));
      this.hintAsk.setY(this.nudgeText.y);
    }
    let nudge = g.rt.nudgeT > 0 ? g.rt.nudge : '';
    // on an iPad a tip names the button she will tap, not a key (issue 64)
    if (nudge && this.touchOn) nudge = this.touchTip(nudge);
    if (nudge !== this.lastNudge) {
      this.lastNudge = nudge;
      this.bossNudge = '';
      for (const k in BOSS_BANNERS)
        if (nudge && fill(g, g.c.strings[k] ?? k) === nudge) {
          this.bossNudge = nudge;
          this.bossBanner(k);
        }
    }
    // a boss line shows as a banner: while that banner is up, it is not said again under the objective
    if (nudge && nudge === this.bossNudge && this.cur && nudge.startsWith(this.cur.m.head)) nudge = '';
    if (this.nudgeText.text !== nudge)
      this.nudgeText.setText(nudge).setBackgroundColor(nudge ? '#2a1c10cc' : '#00000000');
    // "H: hint" only when nothing else is said under the goal line
    const offer = !nudge && !!this.objText.text && this.dial.visible && hintOffer(g);
    if (offer && !this.hintAsk.text)
      this.hintAsk.setText((this.touchOn ? g.c.strings.touch_help : g.c.strings.hint_key) ?? 'H: help');
    this.hintAsk.setVisible(offer);
  }

  /** A tip as an iPad says it (TOUCH_TIPS), worked out once each time the tip changes. */
  private touchTip(tip: string): string {
    if (tip !== this.tipFrom) {
      this.tipFrom = tip;
      this.tipTo = tip;
      for (const k in TOUCH_TIPS) if (tip === fill(this.g, this.g.c.strings[k] ?? k)) this.tipTo = TOUCH_TIPS[k]!;
    }
    return this.tipTo;
  }

  /**
   * Somebody is waiting for a thing: a small picture bubble over them shows it (with the number when it is more
   * than one, and a green tick once she has enough). At most three at a time, only in play.
   */
  private drawBubbles(show: boolean): void {
    const g = this.g;
    const s = g.s;
    let used = 0;
    if (show) {
      const zoom = this.world.cameras.main.zoom;
      for (const qid in s.quests) {
        if (used >= 3) break;
        const q = s.quests[qid]!;
        const st = q.done ? undefined : g.c.quests[qid]?.steps[q.step];
        if (st?.t !== 'deliver') continue;
        const who = cast(g, st.to);
        const n = g.rt.npcs.find((m) => m.id === who && m.area === s.area && !m.hidden);
        if (!n) continue;
        const tall = g.c.chars[who]?.tall ?? 2;
        const p = this.world.toScreen(n.x * T, n.y * T);
        const x = p.x + 46 * zoom;
        const y = p.y - tall * T * zoom - 30;
        if (x < 60 || x > W - 60 || y < 150 || y > H - 200) continue;
        let b = this.bubbles[used];
        if (!b) {
          const bg = this.add.image(0, 0, 'ui_want').setOrigin(0.1, 1);
          const pic = icon(this, st.item, 34, -56, 50);
          const num = title(this, 70, -44, '', 26, '#3b2a1a').setOrigin(1, 0);
          num.setStroke('#fffdf2', 6);
          const tick = this.add.image(72, -84, 'ui_tick').setScale(0.6);
          b = {
            box: this.add.container(0, 0, [bg, pic, num, tick]).setDepth(LAYER.bubble),
            pic,
            n: num,
            tick,
            item: '',
          };
          this.bubbles.push(b);
        }
        const need = st.n ?? 1;
        if (b.item !== st.item) {
          b.item = st.item;
          setIcon(this, b.pic, st.item, 50);
        }
        const label = need > 1 ? String(need) : '';
        if (b.n.text !== label) b.n.setText(label);
        b.tick.setVisible(count(g, st.item) >= need);
        b.box.setVisible(true).setPosition(x, y + Math.sin(this.t * 3 + used) * 4);
        used++;
      }
    }
    for (let i = used; i < this.bubbles.length; i++) this.bubbles[i]!.box.setVisible(false);
  }

  private drawHotbar(): void {
    const s = this.g.s;
    if (s.hot !== this.hotSel) {
      if (this.hotSel >= 0 && this.dial.visible) Sound.sfx('tick', 0.7);
      this.hotSel = s.hot;
      this.hotG.clear();
      for (let i = 0; i < 8; i++) slot(this.hotG, W / 2 - 4 * 92 + i * 92 + 4, H - 112, 84, i === s.hot);
    }
    for (let i = 0; i < 8; i++) {
      const sl = s.bag[i];
      const h = this.hot[i]!;
      const id = sl ? sl.id : '';
      const n = sl ? sl.n : 0;
      if (id !== h.id) {
        h.id = id;
        h.img.setVisible(!!id && this.dial.visible);
        if (id) setIcon(this, h.img, id, 60);
      }
      if (n !== h.count) {
        h.count = n;
        h.n.setText(n > 1 ? String(n) : '');
      }
    }
  }

  /**
   * The star over the next target, or an arrow at the screen edge when it is out of view. G (22 Nov 2026): the arrow
   * glides to its aim and does not bob; when the goal is inside a house she is outside of, the star sits on that
   * house's door with a small house sign, and the edge arrow carries the sign too.
   */
  private drawHelper(dt: number, show: boolean): void {
    const g = this.g;
    const tgt = g.rt.target;
    const sm = this.arrowSm;
    // no star while a talk, a scene or a card has the screen, or while she fights a den (the goal is the ring)
    const busy = this.screenBusy() || !!g.rt.den;
    // standing on a thing on the ground: the star would only hide her
    const onIt =
      !!tgt && tgt.area === g.s.area && !g.rt.targetUp && Math.hypot(tgt.x + 0.5 - g.s.x, tgt.y + 0.5 - g.s.y) < 1.1;
    const hide = () => {
      this.arrow.setVisible(false);
      sm.on = false;
      this.houseSign.setVisible(false);
    };
    if (!show || !tgt || !g.s.opts.helper || busy || onIt) {
      hide();
      this.marker.setVisible(false);
      return;
    }
    // Package 60: the arrow points along the way she can walk (src/core/guide.ts), not in a straight line at the goal.
    const gd = guideOf(g);
    // the goal inside a house she is outside of: its door is where the star goes
    const door = gd.house ? gd.door : null;
    const p = door
      ? this.world.toScreen((door.x + 0.5) * T, (door.y + 0.5) * T)
      : this.world.toScreen((tgt.x + 0.5) * T, (tgt.y + 0.5) * T);
    const me = this.world.toScreen(g.s.x * T, g.s.y * T);
    const m = 90;
    const seen = (!!door || tgt.area === g.s.area) && p.x > m && p.x < W - m && p.y > m + 60 && p.y < H - m - 80;
    const zoom = this.world.cameras.main.zoom;
    if (seen) {
      // over a person's or an enemy's head; on a thing on the ground, just above its middle (package 53a); over a
      // door, above the doorway (a door tile is the house's front wall)
      const up = door ? 0.9 : g.rt.targetUp;
      // package 71 (D78, G: "the yellow arrow is too big"): the star is 60 percent of its old size, as the arrow is
      const lift = up > 0 ? up * T * zoom + 34 : 46;
      const sy = p.y - lift + Math.sin(this.t * 2.5) * 3;
      this.marker
        .setVisible(true)
        .setPosition(p.x, sy)
        .setScale(HELP_SHARE * (0.95 + Math.sin(this.t * 2.5) * 0.03));
      this.houseSign.setVisible(!!door);
      if (door) this.houseSign.setPosition(p.x + 50, sy + 10).setScale(0.75);
    } else {
      this.marker.setVisible(false);
      this.houseSign.setVisible(false);
    }
    // no arrow when she can walk straight to a star she can see, or when there is no way today (the goal line says)
    if (gd.none || !gd.has || (seen && gd.direct)) {
      this.arrow.setVisible(false);
      sm.on = false;
      return;
    }
    const w = this.world.toScreen(gd.wx * T, gd.wy * T);
    const aimAng = Math.atan2(w.y - me.y, w.x - me.x);
    const edge = !seen;
    const key = `${g.s.area}|${tgt.area}`;
    const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
    if (!sm.on || sm.key !== key) {
      // first shown, or a new goal area or her own: straight to the right angle, no swing across the screen
      sm.ang = sm.goal = aimAng;
    } else {
      if (Math.abs(wrap(aimAng - sm.goal)) > ARROW_DEAD) sm.goal = aimAng;
      const k = 1 - Math.exp(-Math.min(dt, 0.1) / ARROW_TAU);
      sm.ang = wrap(sm.ang + wrap(sm.goal - sm.ang) * k);
    }
    const ang = sm.ang;
    // package 71 (D78): one size everywhere, at most ARROW_PX wide with its pulse, and no growing off screen
    const size = ARROW_PX / (Math.max(this.arrow.width, this.arrow.height) || 64);
    const pulse = size * (1 + Math.sin(this.t * PULSE_RATE) * ARROW_PULSE);
    let tx: number;
    let ty: number;
    if (!edge) {
      // the star is in sight but the way bends (a hedge, a river): the arrow beside her shows which way to go
      tx = me.x + Math.cos(ang) * 100;
      ty = me.y - 40 + Math.sin(ang) * 100;
    } else {
      const cx = W / 2;
      const cy = H / 2;
      // kept clear of the goal line at the top and the hotbar at the bottom
      const vy = Math.sin(ang) < 0 ? cy - 300 : cy - 220;
      const k = Math.min((cx - m) / Math.abs(Math.cos(ang) || 1e-6), vy / Math.abs(Math.sin(ang) || 1e-6));
      tx = cx + Math.cos(ang) * k;
      ty = cy + Math.sin(ang) * k;
    }
    if (!sm.on || sm.key !== key) {
      sm.x = tx;
      sm.y = ty;
    } else if (sm.edge !== edge || Math.hypot(tx - sm.x, ty - sm.y) > 4) {
      // from beside her to the edge (or back), or round a corner of the screen: it glides there too
      const k = 1 - Math.exp(-Math.min(dt, 0.1) / (ARROW_TAU * 0.6));
      sm.x += (tx - sm.x) * k;
      sm.y += (ty - sm.y) * k;
    } else {
      sm.x = tx;
      sm.y = ty;
    }
    sm.on = true;
    sm.edge = edge;
    sm.key = key;
    this.arrow.setVisible(true).setPosition(sm.x, sm.y).setRotation(ang).setScale(pulse);
    if (edge && door) {
      // the goal is in a house off the screen: the house sign rides just inside the arrow
      this.houseSign
        .setVisible(true)
        .setPosition(sm.x - Math.cos(ang) * 52, sm.y - Math.sin(ang) * 52)
        .setScale(0.7);
    }
  }

  /**
   * Package 78: a small red arrow at the screen's edge, pointing at what hurt her, for a second, when that thing is not
   * on the screen (when it is, its own red mark over it says enough). No bigger than the guide arrow.
   */
  private drawHit(dt: number, show: boolean): void {
    const h = this.hitFrom;
    if (h.left <= 0 || !show) {
      this.hitArrow.setVisible(false);
      if (!show) h.left = 0;
      return;
    }
    h.left -= dt;
    const p = this.world.toScreen(h.x * T, h.y * T);
    if (h.left <= 0 || (p.x >= 0 && p.x <= W && p.y >= 0 && p.y <= H)) {
      this.hitArrow.setVisible(false);
      return;
    }
    const me = this.world.toScreen(this.g.s.x * T, this.g.s.y * T);
    const ang = Math.atan2(p.y - me.y, p.x - me.x);
    const m = 60;
    const cx = W / 2;
    const cy = H / 2;
    const k = Math.min((cx - m) / Math.abs(Math.cos(ang) || 1e-6), (cy - m) / Math.abs(Math.sin(ang) || 1e-6));
    const size = HIT_PX / (Math.max(this.hitArrow.width, this.hitArrow.height) || 64);
    this.hitArrow
      .setVisible(true)
      .setPosition(cx + Math.cos(ang) * k, cy + Math.sin(ang) * k)
      .setRotation(ang)
      .setScale(size)
      .setAlpha(Math.min(1, h.left / 0.3));
  }

  private drawTalk(dt: number): void {
    const g = this.g;
    // only while the talk is the thing she is using (it waits under a menu or a card, unseen)
    const talk = this.focus() === 'talk' ? g.rt.talk : null;
    if (!talk) {
      if (this.dlg.visible) {
        this.dlg.setVisible(false);
        this.portrait?.setVisible(false);
        this.dlgLine = '';
        this.dlgSpeaker = '';
      }
      return;
    }
    this.dlg.setVisible(true);
    if (talk.text !== this.dlgLine || talk.who !== this.dlgSpeaker) {
      this.dlgLine = talk.text;
      this.dlgSpeaker = talk.who;
      this.dlgShown = -1;
      const who = talk.who;
      this.dlgName.setText(who ? charName(g, who) : '');
      this.dlgName.setVisible(!!who);
      const plate = this.dlg.list[1] as Phaser.GameObjects.Graphics;
      plate.setVisible(!!who);
      // the portrait and the name stand on the side of the screen the speaker is on
      this.dlgRight = !!who && this.speakerRight(who);
      const shift = this.dlgRight ? W - 880 - 520 : 0;
      plate.setX(shift);
      this.dlgName.setX(700 + shift);
      const id = who ? this.worldArt(who) : '';
      if (id !== this.portraitId) {
        this.portrait?.destroy();
        this.portrait = null;
        this.portraitId = id;
        if (id) {
          const tall = g.c.chars[who]?.tall ?? g.c.mobs[who]?.tall ?? 2;
          // drawn from the portrait page (the masters' full detail), not the small world frames enlarged
          const p = new Puppet(this, id, tall, true, true);
          p.zoom = portraitZoom(tall, art.chars.sets[id]);
          // behind the box, so the box hides the body and the head and shoulders stand clear above it
          p.sprite.setDepth(LAYER.portrait);
          this.portrait = p;
        }
      }
    }
    const shown = Math.floor(talk.shown);
    if (shown !== this.dlgShown) {
      this.dlgShown = shown;
      this.dlgText.setText(talk.text.slice(0, shown));
    }
    const done = talk.shown >= talk.text.length;
    this.dlgMore.setVisible(done && !talk.choices).setY(992 + Math.sin(this.t * 7) * 6);
    const choices = done ? talk.choices : null;
    // the choices stay inside the box (its bottom is 1040): rows close up a little, then the whole box lifts. On an
    // iPad each row is a finger high (issue 41: 84 is 44 CSS pixels on the smallest iPad), so the box lifts more.
    const top = 826 + this.dlgText.height + 18;
    const n = choices?.length ?? 0;
    const row = n ? (this.touchOn ? 84 : Math.max(46, Math.min(54, (1026 - top) / n))) : 54;
    const lift = n ? Math.max(0, top + n * row - 1026) : 0;
    if (this.dlg.y !== -lift) {
      this.dlg.setY(-lift);
      // the box grows by as much as it lifts: its bottom stays at 1040 and every choice sits inside it
      this.dlgBox.clear();
      panel(this.dlgBox, 250, 772, 1420, 268 + lift);
    }
    for (let i = 0; i < this.dlgChoices.length; i++) {
      const c = this.dlgChoices[i]!;
      const label = choices?.[i];
      c.setVisible(!!label);
      if (label) {
        c.setText(label).setPosition(420, top + i * row);
        colour(c, i === talk.pick ? '#b3541e' : INK);
      }
    }
    this.dlgPick.setVisible(!!choices);
    this.dlgKeys.setVisible(!!choices);
    if (choices) this.dlgPick.setPosition(376, top + 26 + talk.pick * row);
    if (this.portrait) {
      const p = this.portrait;
      // feet below the box top so head and shoulders (or all of a small animal) show above it
      const body = p.bodyPx;
      const above = portraitShown(body);
      p.setVisible(true);
      p.setPos(this.dlgRight ? W - 400 : 400, 772 - above + body - lift);
      p.playDialogue('idle', 'down', talk, talk.who);
      p.update(dt);
      // Cut at the box top: a wide body must not protrude beside the box or below its rounded corners.
      p.cropBelow(772 - lift);
    }
  }

  /** Is the speaker to the right of the one listening (or of the middle of the screen)? */
  private speakerRight(who: string): boolean {
    const g = this.g;
    const s = g.s;
    const rt = g.rt;
    const heroId = s.hero;
    // TalkRt.who is already the resolved speaker. A stand-in is a separate person, not the chosen hero.
    const isHero = who === 'you' || who === heroId;
    const at = (id: string): { x: number; y: number } | null => {
      const a = rt.cut?.actors[id];
      if (a) return a;
      const n =
        rt.npcs.find((m) => m.k === rt.talk?.npc && m.id === id) ??
        rt.npcs.find((m) => m.id === id && m.area === s.area);
      return n ?? null;
    };
    const other = isHero
      ? (rt.npcs.find((m) => m.k === rt.talk?.npc) ?? Object.values(rt.cut?.actors ?? {})[0] ?? null)
      : null;
    const me = isHero ? { x: s.x, y: s.y } : at(who);
    const them = isHero ? other : { x: s.x, y: s.y };
    if (!me) return false;
    if (them && Math.abs(me.x - them.x) > 0.3) return me.x > them.x;
    return this.world.toScreen(me.x * T, me.y * T).x > W / 2;
  }
  private worldArt(id: string): string {
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

  private drawCard(): void {
    const card = this.focus() === 'card' ? this.g.rt.card : null;
    if (!card) {
      if (this.card.visible) this.card.setVisible(false);
      this.cardKey = '';
      return;
    }
    const key = card.title + card.lines.join('|');
    if (key !== this.cardKey) {
      this.cardKey = key;
      this.cardTitle.setText(card.title);
      this.cardLines.setText(card.lines.map((l) => (card.kind === 'tomorrow' ? '★  ' + l : l)).join('\n\n'));
      this.card.setVisible(true).setAlpha(0);
      this.tweens.add({ targets: this.card, alpha: 1, duration: 300 });
    }
  }

  private drawBuild(): void {
    const b = this.g.rt.build;
    if (!b) {
      if (this.buildBox.visible) this.buildBox.setVisible(false);
      this.buildKey = '';
      return;
    }
    this.buildBox.setVisible(true);
    const list = placeables(this.g);
    // the strip is drawn again only when the choice or the list changed (the Dell laptop, D37)
    const key = `${b.sel}|${list.join(',')}`;
    if (key === this.buildKey) return;
    this.buildKey = key;
    const first = Math.max(0, Math.min(b.sel - 4, list.length - 9));
    for (let i = 0; i < this.buildIcons.length; i++) {
      const im = this.buildIcons[i]!;
      const id = list[first + i];
      im.setVisible(!!id);
      if (id) {
        setIcon(this, im, id, first + i === b.sel ? 84 : 58);
        im.setAlpha(first + i === b.sel ? 1 : 0.7);
      }
    }
    const name = list[b.sel] ? this.g.c.items[list[b.sel]!]!.name : 'Nothing to place';
    // on an iPad the footer names the small button as it reads (issue 63): Pick up, and building goes on
    const label = this.touchOn
      ? `${name}    Pick up: back in your bag`
      : `${name}    Arrows: move   Space: place   X: pick up   R: turn   B: done`;
    if (this.buildText.text !== label) this.buildText.setText(label);
  }

  /** A place name fades in, stays a moment and fades out, without stopping play. Names queue: one at a time. */
  private showName(name: string, sub = ''): void {
    const n = name.charAt(0).toUpperCase() + name.slice(1);
    // the same name is not said twice in a row (a region walked into and found in the same moment)
    if (n === this.nameSaid && this.t - this.nameAt < 8) return;
    this.nameSaid = n;
    this.nameAt = this.t;
    const last = this.nameQ[this.nameQ.length - 1];
    if (last?.name !== n) this.nameQ.push({ name: n, sub });
    if (this.nameQ.length > 2) this.nameQ.shift();
  }

  /** The rules found a place (a region or a landmark): its name shows, and a landmark's view line under it. */
  private placeFound(id: string): void {
    const g = this.g;
    const lm = g.c.landmarks?.[id];
    const name = lm?.name ?? g.c.regions[id]?.name ?? '';
    if (!name) return;
    const line = lm?.find.kind === 'view' ? (lm.find.line ?? '') : '';
    this.showName(fill(g, name), line ? fill(g, line) : '');
  }

  /**
   * The morning card: a guest has come to stay, or a friend dropped in with a present. One a morning, through the
   * one message queue, never with a banner of its own.
   */
  private morning(c: { who: string; gift?: string; n?: number }): void {
    const day = this.g.s.day;
    if (!c.who || this.morningDay === day) return;
    this.morningDay = day;
    this.msgQ = this.msgQ.filter((x) => x.kind !== 'card');
    this.enqueue({
      kind: 'card',
      pri: 5,
      head: '',
      sub: '',
      item: undefined,
      color: CREAM,
      chime: '',
      parts: [],
      who: c.who,
      gift: c.gift,
      n: c.n,
    });
  }

  /** The morning card itself: the face, a line, and for a visitor the present (it is in her bag already). */
  private showCard(m: Msg): void {
    const g = this.g;
    const who = m.who ?? '';
    const name = charName(g, who);
    const gift = m.gift ? g.c.items[m.gift] : undefined;
    const n = m.n ?? 1;
    const line = gift ? `${name} came to see you!` : `${name} has come to stay!`;
    const what = gift ? `A present: ${n > 1 ? `${n} ${gift.names ?? `${gift.name}s`}` : gift.name}` : '';
    const gr = this.add.graphics();
    const w = 880;
    const h = gift ? 420 : 380;
    panel(gr, -w / 2, 0, w, h);
    const parts: Phaser.GameObjects.GameObject[] = [gr];
    parts.push(title(this, 0, 26, 'Good morning!', 56).setOrigin(0.5, 0));
    parts.push(this.add.circle(-w / 2 + 150, 215, 92, 0xfff8e7).setStrokeStyle(6, GOLD));
    parts.push(icon(this, `face_${who}`, -w / 2 + 150, 215, 150));
    parts.push(text(this, -w / 2 + 280, 160, line, 42, INK, w - 320));
    if (gift && m.gift) {
      parts.push(icon(this, m.gift, -w / 2 + 320, 300, 76));
      parts.push(text(this, -w / 2 + 380, 276, what, 36, '#b3541e', w - 420));
    }
    const ok = this.touchOn ? (this.g.c.strings.touch_ok ?? 'OK') : 'Space';
    parts.push(text(this, w / 2 - 36, h - 58, ok, 30, SOFT).setOrigin(1, 0));
    const box = this.add
      .container(W / 2, 140, parts)
      .setDepth(LAYER.morning)
      .setAlpha(0);
    clampOnScreen(box);
    this.cur = { m, box, life: CARD_S, age: 0, leaving: false };
    this.tweens.add({ targets: box, alpha: 1, duration: 300 });
    Sound.arp('bell', [0, 4, 7], 0.07, 0.6);
  }

  /**
   * The name of a region shows for a moment each time she walks into it. Finding places is the rules' work: the
   * name of a place she finds for the first time comes with the 'place' event (placeFound).
   */
  private drawRegion(dt: number): void {
    const g = this.g;
    const s = g.s;
    const a = g.c.areas[s.area]!;
    const code = a.region[Math.floor(s.y)]?.charAt(Math.floor(s.x)) ?? ' ';
    const play = g.rt.mode === 'play';
    if (code !== this.lastRegion && code !== ' ') {
      const first = this.lastRegion === '';
      this.lastRegion = code;
      const r = this.regionByCode[code];
      if (r && !first && play) this.showName(r.name);
    }
    if (this.nameT > 0) {
      this.nameT -= dt;
      // a talk or a scene began: the name goes at once
      if (!play && g.rt.mode !== 'fishing' && g.rt.mode !== 'build') {
        this.nameT = 0;
        this.tweens.killTweensOf([this.areaBanner, this.areaSub]);
        this.areaBanner.setAlpha(0);
        this.areaSub.setAlpha(0);
      }
    } else if (this.nameQ.length && play && this.cur?.m.kind !== 'card') {
      this.nameT = NAME_S;
      const next = this.nameQ.shift()!;
      // under a banner when one is up, so the two never sit on each other
      const y = this.cur?.m.kind === 'banner' ? 300 : 150;
      this.areaBanner.setText(next.name).setAlpha(0).setY(y);
      this.areaSub
        .setText(next.sub)
        .setAlpha(0)
        .setY(y + 82);
      // package 68: never over the goal line: it moves right of the goal chip when the two would meet
      const half = Math.max(this.areaBanner.width, this.areaSub.width) / 2;
      const chip = this.objText.text && this.dial.visible ? 24 + this.objW + 30 : 0;
      const x = Math.min(W - 360 - half, Math.max(W / 2, chip + half));
      this.areaBanner.setX(x);
      this.areaSub.setX(x);
      // too long to fit beside it: under the goal line and its words instead
      if (chip && x - half < chip) {
        this.areaBanner.setX(W / 2).setY(y + 170);
        this.areaSub.setX(W / 2).setY(y + 252);
      }
      this.tweens.killTweensOf([this.areaBanner, this.areaSub]);
      const fade = { alpha: 1, duration: 400, yoyo: true, hold: 1600 };
      this.tweens.add({ targets: this.areaBanner, ...fade });
      if (next.sub) this.tweens.add({ targets: this.areaSub, ...fade, hold: 2400 });
    }
  }
}

/** A small picture of a key: a cream cap on a dark base, with a word, a number or an arrow on it (package 46). */
function keyCap(scene: Phaser.Scene, label: string, w = 64, h = 58): Phaser.GameObjects.Container {
  const g = scene.add.graphics();
  g.fillStyle(0x3b2a1a, 1).fillRoundedRect(-w / 2, -h / 2 + 5, w, h, 11);
  g.fillStyle(0xfffdf2, 1).fillRoundedRect(-w / 2 + 3, -h / 2, w - 6, h - 6, 9);
  const parts: Phaser.GameObjects.GameObject[] = [g];
  const a = 13;
  const cy = -3;
  g.fillStyle(0x3b2a1a, 1);
  if (label === 'up') g.fillTriangle(0, cy - a, -a, cy + a * 0.7, a, cy + a * 0.7);
  else if (label === 'down') g.fillTriangle(0, cy + a, -a, cy - a * 0.7, a, cy - a * 0.7);
  else if (label === 'left') g.fillTriangle(-a, cy, a * 0.7, cy - a, a * 0.7, cy + a);
  else if (label === 'right') g.fillTriangle(a, cy, -a * 0.7, cy - a, -a * 0.7, cy + a);
  else if (label) parts.push(title(scene, 0, -h / 2 + 8, label, 28, '#3b2a1a').setOrigin(0.5, 0));
  return scene.add.container(0, 0, parts);
}
