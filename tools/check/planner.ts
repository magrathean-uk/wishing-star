// The solver's player. It looks at the quests, decides what to do next and plays it through step(), the way a child
// at the keyboard would: walk with the arrow keys, face a thing, press Space. It may skip skill only: it heals itself,
// wins a running mini-game with winMini, skips cutscenes and dismisses cards. It never teleports, never gives itself
// items and never sets flags or finishes steps directly. Quick travel is used only from a signpost it has found.
import { countWithChests, HOTBAR, makeRoom, plotRect, promised, toolTier } from '../../src/core/bag.ts';
import { canPlace } from '../../src/core/build.ts';
import { count, isNight, test } from '../../src/core/cond.ts';
import { stationNear, stockLeft } from '../../src/core/craft.ts';
import { skipCut } from '../../src/core/cutscene.ts';
import { cropAt } from '../../src/core/farm.ts';
import { findPath, objLive, regionAt, TERRAIN, terrainAt } from '../../src/core/grid.ts';
import { doorInto, findTarget, placedAt, type Target } from '../../src/core/hero.ts';
import { cupNext, freeCupGo, winMini } from '../../src/core/minigames.ts';
import { better, slotOf, swordDmg, upgradeCost, worn } from '../../src/core/gear.ts';
import { foeBeside, mobHp, regionLit } from '../../src/core/mobs.ts';
import { boardJobs, denCentre } from '../../src/core/island.ts';
import { charPlace, findSite, isPoster, offered, place, stepTarget } from '../../src/core/quests.ts';
import { step } from '../../src/core/step.ts';
import { cast, wordCount } from '../../src/core/talk.ts';
import type {
  Cmd,
  Dir,
  Game,
  Input,
  MapObj,
  Mob,
  Npc,
  Placed,
  QuestDef,
  RecipeDef,
  Step,
  TalkRt,
} from '../../src/core/types.ts';

/** Seconds a child spends on each kind of action, for the playtime report and the reward clock (build plan section 6). */
export const COST = { gather: 3, craft: 4, place: 3, mob: 8, fish: 12, mini: 120, wear: 2 } as const;
/**
 * A fight is counted by its hits (D31), not a flat price: a little for closing in, then one swing for each hit her
 * best sword needs (the mob's health over the sword's damage), and a child lands about every other swing. Walking
 * round the mob is already on the walking clock; bosses use the kid bot's measured seconds.
 */
export const FIGHT = { close: 1.5, swing: 0.34, miss: 2 } as const;
export function fightSecs(hp: number, dmg: number): number {
  return FIGHT.close + Math.ceil(hp / Math.max(1, dmg)) * FIGHT.swing * FIGHT.miss;
}
/** Reading speed in words a minute. */
export const WPM = 80;

export type RunKind = 1 | 2 | 3;

export interface BotOpts {
  run: RunKind;
  /** run 2: the friend hero to swap to at the mirror as soon as it is unlocked */
  swapTo?: string;
  maxSteps: number;
  verbose?: boolean;
  /** seconds a child takes for each mini-game and boss (from the kid bot), for the clock */
  miniSecs?: Record<string, number>;
  /** words in each of Dad's personal letters (their text lives in personal.json) */
  letterWords?: Record<string, number>;
  /** stop early; checked once a game second */
  stop?: (b: Bot) => boolean;
  /** never use signpost quick travel (the timed play bot walks everywhere) */
  noTravel?: boolean;
  /** when every quest is done, go on to every collection: finds, stall collectibles and 3 stars in each mini-game */
  collect?: boolean;
}

/** What one quest cost, in steps and counts. */
export interface Tally {
  walk: number;
  wait: number;
  words: number;
  /** of `words`, those Dad wrote himself (his and the family's letters in personal.json): exempt from the reading share */
  own?: number;
  gather: number;
  craft: number;
  place: number;
  mob: number;
  /** seconds of fighting, by hits (see fightSecs) */
  fight?: number;
  /** seconds of gathering: by hits for a node worked with a tool, COST.gather for anything else (package 44a) */
  gatherSecs?: number;
  fish: number;
  minis: string[];
  bosses: string[];
}
export interface RewardRec {
  /** child's clock in seconds (walking x 1.5, reading, action times, mini-games, waiting) */
  kid: number;
  /** of that, seconds spent only waiting for night or morning */
  pass: number;
  /** of that, seconds spent on quests that are not on the main path (her own detours) */
  off: number;
  tick: number;
  kind: string;
  id: string;
  quest: string;
  doing: string;
}
export interface Mark {
  kid: number;
  tick: number;
  /** seconds of game steps plus reading time: the first-ten-minutes clock */
  ten: number;
  what: string;
}

/** A task: a generator that sets the shared input and yields once per game step. Returns true when it worked. */
type Gen = Generator<void, boolean, void>;
/** Why a step cannot be worked on now, and whether it is only a matter of time. */
interface Block {
  why: string;
  /** only a matter of time; 'later' means some other quest has to open the way first */
  wait?: 'night' | 'morning' | 'day' | 'later';
  /** mornings to wait before calling it stuck (default 3) */
  patience?: number;
}
type Plan = Gen | Block;
const isGen = (p: Plan | null): p is Gen => !!p && typeof (p as Gen).next === 'function';

const DIRS: Dir[] = ['right', 'left', 'down', 'up'];
const DX = [1, -1, 0, 0];
const DY = [0, 0, 1, -1];
const STUCK_TICKS = 20 * 60 * 60;
/** mobs.ts state number of a creeper's fuse */
const FUSE_ST = 5;

const words = (text: string): number => {
  let n = 0;
  let inWord = false;
  for (let i = 0; i < text.length; i++) {
    const sp = text.charCodeAt(i) <= 32;
    if (!sp && !inWord) n++;
    inWord = !sp;
  }
  return n;
};
const newTally = (): Tally => ({
  walk: 0,
  wait: 0,
  words: 0,
  gather: 0,
  craft: 0,
  place: 0,
  mob: 0,
  fight: 0,
  fish: 0,
  minis: [],
  bosses: [],
});

export class Bot {
  g: Game;
  o: BotOpts;
  inp: Input = { mx: 0, my: 0, act: false, hold: false, back: false, use: false, emote: false, cmd: null };
  task: Gen | null = null;
  /** what it is doing now, and for which quest */
  why = '';
  cur = '';
  kid = 0;
  /** seconds of the kid clock spent only waiting for the clock (night, day, morning) */
  pass = 0;
  /** seconds of the child's clock spent on quests off the main path, and the clock when that was last added up */
  off = 0;
  private lastClock = 0;
  /** each wait for the clock: when it began, how long, and what for */
  passes: { at: number; secs: number; why: string }[] = [];
  read = 0;
  tallies: Record<string, Tally> = {};
  rewards: RewardRec[] = [];
  marks: Mark[] = [];
  /** the reason the run stopped early, or null */
  stuck: string | null = null;
  done = false;
  /** collections: tries per target (a sticker or item key, or mini:<game>), and what was never collected */
  collectTried: Record<string, number> = {};
  collectLeft: string[] = [];
  /** quests she failed to take, by day: tried again the next day */
  private offerFail: Record<string, { day: number; n: number }> = {};
  /** a quest on offer whose giver is out only at night or only by day */
  private offerWait: { kind: 'night' | 'day'; why: string } | null = null;
  /** quests given up on in this run, with the reason */
  parked: Record<string, string> = {};
  notes: string[] = [];
  swapped = false;
  // counters the tasks watch
  nOpen = 0;
  lastOpen = '';
  nTalk = 0;
  nMini = 0;
  nRead = 0;
  // reading bookkeeping
  private talkRef: TalkRt | null = null;
  private talkI = -1;
  private cutRef: object | null = null;
  private cardRef: object | null = null;
  private waiting = false;
  private passing = false;
  private inPass = false;
  // progress watch
  private sig = -1;
  private sigTick = 0;
  // maps
  private reach: Record<string, Uint8Array> = {};
  private grids: Record<string, Uint8Array> = {};
  private gridRev: Record<string, number> = {};
  private nodesFor: Record<string, { area: string; i: number }[]> = {};
  private skipObj: Record<string, number> = {};
  private zeroSteps = 0;
  private lastWhy = '';
  private sleeps = 0;
  private sleepSig = -1;
  private fails: Record<string, number> = {};
  private zeroRuns = 0;
  private taskTick = 0;
  private choreAt: Record<string, number> = {};
  private lastZero = '';
  /** spawn zones that gave nothing to fight lately (full of day-calm spiders), and until when to leave them */
  private zoneBad: Record<string, number> = {};
  private fightZone = '';
  /** true while she fights a boss (see after()) */
  private bossFight = false;
  /** animals that would not move (wedged against something), left alone for a while */
  private skipBeast: Record<number, number> = {};

  constructor(g: Game, o: BotOpts) {
    this.g = g;
    this.o = o;
    for (const area in g.c.areas) {
      const a = g.c.areas[area]!;
      a.objects.forEach((ob, i) => {
        const t = g.c.objects[ob.type];
        if (!t?.node) return;
        for (const y of t.node.yield) (this.nodesFor[y.item] ??= []).push({ area, i });
      });
    }
  }

  // ------------------------------------------------------------------ the loop

  tally(q = this.cur): Tally {
    return (this.tallies[q || '(none)'] ??= newTally());
  }

  /** Play until the run's goal is met, the step budget runs out or it gets stuck. A crash in the rules ends the run. */
  run(): void {
    try {
      this.loop();
    } catch (e) {
      const err = e as Error;
      const at = (err.stack ?? '').split('\n').find((l) => l.includes('/src/')) ?? '';
      this.stuck = `the game crashed: ${err.message} (${at.trim()}) ${this.where()}`;
    }
  }

  private loop(): void {
    const g = this.g;
    while (!this.done && !this.stuck) {
      if (g.s.ticks >= this.o.maxSteps) {
        this.stuck = `step budget of ${this.o.maxSteps} used up ${this.where()}`;
        break;
      }
      if (this.o.stop && g.s.ticks % 60 === 0 && this.o.stop(this)) break;
      this.clear();
      if (g.rt.mode === 'play') {
        g.s.hp = g.s.maxHp;
        if (!this.task) {
          this.task = this.decide();
          this.taskTick = g.s.ticks;
          if (!this.task) break;
        }
        const r = this.task.next();
        if (r.done) {
          this.task = null;
          if (g.s.ticks === this.taskTick && this.why === this.lastZero) {
            if (++this.zeroRuns > 300 && this.cur && this.g.s.quests[this.cur] && !this.g.s.quests[this.cur]!.done) {
              this.give_up(this.cur, `${this.why}: the task ends at once and nothing changes`);
              this.zeroRuns = 0;
            }
          } else this.zeroRuns = 0;
          this.lastZero = this.why;
          if (!r.value) {
            // the same task failing again and again: give that quest up (or stop, for the story)
            const key = this.cur + '|' + this.why;
            this.fails[key] = (this.fails[key] ?? 0) + 1;
            if (this.fails[key]! >= 6 && this.cur && this.g.c.quests[this.cur] && !this.g.s.quests[this.cur]?.done)
              this.give_up(this.cur, this.why);
          }
          if (++this.zeroSteps < 4) continue;
        }
      } else this.auto();
      this.zeroSteps = 0;
      const walking = g.rt.mode === 'play' && (this.inp.mx !== 0 || this.inp.my !== 0);
      // "Put it on? Space": a child says yes to new or better gear
      if (!this.inp.cmd && g.rt.mode === 'play') {
        if (g.rt.ask) this.inp.cmd = { c: 'wear', item: g.rt.ask };
        else if (g.s.ticks % 60 === 0) {
          // a question she missed: better gear in her pouch goes on from the Gear page
          for (const id in g.s.pouch)
            if ((g.s.pouch[id] ?? 0) > 0 && better(g, id)) {
              this.inp.cmd = { c: 'wear', item: id };
              break;
            }
        }
      }
      step(g, this.inp);
      this.after(walking);
    }
  }

  clear(): void {
    const i = this.inp;
    i.mx = 0;
    i.my = 0;
    i.act = false;
    i.hold = false;
    i.back = false;
    i.use = false;
    i.emote = false;
    i.fire = false;
    i.cmd = null;
    this.waiting = false;
    this.passing = false;
  }

  /** Talk boxes, scenes, mini-games, cards and fishing run themselves; the task waits. */
  private auto(): void {
    const rt = this.g.rt;
    switch (rt.mode) {
      case 'talk':
        this.readTalk();
        this.inp.act = true;
        return;
      case 'cut':
        this.readCut();
        skipCut(this.g);
        return;
      case 'mini':
        if (rt.talk) {
          this.readTalk();
          this.inp.act = true;
          return;
        }
        if (rt.mini) {
          const id = rt.mini.game;
          this.nMini++;
          winMini(this.g, 3);
          this.mark(`mini-game ${id}`);
        }
        return;
      case 'card':
        if (rt.card && rt.card !== this.cardRef) {
          this.cardRef = rt.card;
          this.addWords(words(rt.card.title) + rt.card.lines.reduce((n, l) => n + words(l), 0));
        }
        if (rt.card && rt.card.t > 0.9) this.inp.act = true;
        return;
      case 'fishing':
        if (rt.fish && rt.fish.st === 2) this.inp.act = true;
        else this.waiting = true;
        return;
      case 'build':
        this.inp.cmd = { c: 'build', on: false };
        return;
      default:
        return;
    }
  }

  private readTalk(): void {
    const t = this.g.rt.talk;
    if (!t || (t === this.talkRef && t.i === this.talkI)) return;
    this.talkRef = t;
    this.talkI = t.i;
    let n = words(t.text);
    if (t.choices) for (const c of t.choices) n += words(c);
    this.addWords(n);
  }
  private readCut(): void {
    const cut = this.g.rt.cut;
    if (!cut || cut === this.cutRef) return;
    this.cutRef = cut;
    const def = this.g.c.cutscenes[cut.id]!;
    let n = this.g.rt.talk ? words(this.g.rt.talk.text) : 0;
    for (let i = cut.i; i < def.acts.length; i++) {
      const a = def.acts[i]!;
      if (a.a === 'say' && a.l) n += wordCount([a.l]);
    }
    this.addWords(n);
    this.mark(`scene ${cut.id}`);
  }
  addWords(n: number): void {
    if (n <= 0) return;
    this.read += n;
    this.kid += (n * 60) / WPM;
    this.tally().words += n;
  }

  private after(walking: boolean): void {
    const g = this.g;
    const t = this.tally();
    // what the clock gained since the last step belongs to the quest she is on: off the path, it is a detour
    const now = this.kid - this.pass;
    if (this.cur && g.c.quests[this.cur] && !g.c.quests[this.cur]!.path) this.off += now - this.lastClock;
    this.lastClock = now;
    // A boss fight is timed by the kid bot (its seconds are added when the boss is beaten), so the planner's own
    // steps in that fight are not counted a second time.
    if (this.bossFight) {
      // nothing: the kid bot's time stands for the whole fight
    } else if (walking) {
      t.walk++;
      this.kid += 1.5 / 60;
    } else if (this.waiting) {
      t.wait++;
      this.kid += 1 / 60;
    }
    if (this.waiting && this.passing) {
      // waiting for the clock (bounded by waitFor's own limit) is not being stuck
      this.sigTick = g.s.ticks;
      this.pass += 1 / 60;
      if (!this.inPass) this.passes.push({ at: this.kid, secs: 0, why: `${this.cur}: ${this.why}` });
      this.passes[this.passes.length - 1]!.secs += 1 / 60;
      this.inPass = true;
    } else if (g.rt.mode === 'play') this.inPass = false;
    for (const e of g.ev) {
      if (e.t === 'reward') {
        this.rewards.push({
          kid: this.kid,
          pass: this.pass,
          off: this.off,
          tick: g.s.ticks,
          kind: e.kind,
          id: e.id,
          quest: this.cur,
          doing: this.why,
        });
        if (e.kind === 'sticker' && e.id.startsWith('mob_') && g.c.mobs[e.id.slice(4)]?.role === 'boss') {
          const id = e.id.slice(4);
          t.bosses.push(id);
          this.kid += this.o.miniSecs?.[id] ?? COST.mini;
        }
        if (e.kind === 'step' || e.kind === 'quest') this.mark(`${e.kind} ${e.id}`);
      } else if (e.t === 'act') this.onAct(e.kind, e.id ?? '');
      else if (e.t === 'open') {
        this.nOpen++;
        this.lastOpen = e.ui + ':' + (e.arg ?? '');
      }
    }
    g.ev.length = 0;
    if (g.s.ticks % 60 === 0) this.watch();
  }

  private onAct(kind: string, id: string): void {
    const t = this.tally();
    switch (kind) {
      case 'gather': {
        // package 44a: mining, chopping and cutting with a tool are counted by their hits, as a fight is (D31)
        t.gather++;
        const node = this.g.c.objects[id]?.node;
        let secs: number = COST.gather;
        if (node?.tool && node.tool !== 'bow') {
          const better = Math.max(1, toolTier(this.g, node.tool) - (node.tier ?? 1) + 1);
          secs = FIGHT.close + Math.ceil(node.hits / better) * FIGHT.swing * FIGHT.miss;
        }
        t.gatherSecs = (t.gatherSecs ?? 0) + secs;
        this.kid += secs;
        return;
      }
      case 'plant':
      case 'harvest':
      case 'collect':
        t.gather++;
        t.gatherSecs = (t.gatherSecs ?? 0) + COST.gather;
        this.kid += COST.gather;
        return;
      case 'craft':
      case 'upgrade':
        // an upgrade is a craft at the anvil or Grandad's workbench: the same menu time
        t.craft++;
        this.kid += COST.craft;
        return;
      case 'wear':
        this.kid += COST.wear;
        return;
      case 'place':
      case 'build':
        t.place++;
        this.kid += COST.place;
        return;
      case 'defeat': {
        t.mob++;
        // its health where she fought it (tougher far from home), against the sword she wears
        const s = this.g.s;
        const hp = this.g.c.mobs[id] ? mobHp(this.g, id, s.area, s.x, s.y) : 3;
        const secs = fightSecs(hp, swordDmg(this.g) || 1);
        t.fight = (t.fight ?? 0) + secs;
        this.kid += secs;
        return;
      }
      case 'fish':
        t.fish++;
        this.kid += COST.fish;
        return;
      case 'mini':
        t.minis.push(id);
        this.kid += this.o.miniSecs?.[id] ?? COST.mini;
        return;
      case 'talk':
        this.nTalk++;
        return;
      case 'letter':
        this.nRead++;
        return;
      default:
        return;
    }
  }

  mark(what: string): void {
    this.marks.push({ kid: this.kid, tick: this.g.s.ticks, ten: this.g.s.ticks / 60 + (this.read * 60) / WPM, what });
    if (this.o.verbose) console.log(`  ${clock(this.kid)}  ${what}`);
  }

  /** Twenty game minutes with nothing changing at all ends the run. */
  private watch(): void {
    const s = this.g.s;
    let sig =
      this.rewards.length * 7 + s.placed.length * 13 + s.emeralds * 17 + s.drops.length * 23 + s.signs.length * 29;
    for (const k in s.quests) {
      const q = s.quests[k]!;
      sig += q.step * 31 + q.n * 37 + (q.done ? 41 : 0);
    }
    for (const sl of s.bag) if (sl) sig += sl.n * 43 + sl.id.length;
    for (const k in s.pouch) sig += s.pouch[k]! * 47;
    if (sig !== this.sig) {
      this.sig = sig;
      this.sigTick = s.ticks;
    } else if (s.ticks - this.sigTick > STUCK_TICKS)
      this.stuck = `no progress for 20 game minutes: ${this.why} ${this.where()}`;
  }

  where(): string {
    const s = this.g.s;
    const q = this.cur && s.quests[this.cur];
    const st = q ? this.g.c.quests[this.cur]!.steps[q.step] : undefined;
    return `[quest ${this.cur || '-'} step ${q ? q.step : '-'}${st ? ' ' + st.t : ''}; at ${s.area} ${s.x.toFixed(1)},${s.y.toFixed(1)}; day ${s.day} ${Math.floor(s.time)}s]`;
  }

  // ------------------------------------------------------------------ deciding

  /** Is the goal of this run met? */
  finished(): boolean {
    const g = this.g;
    for (const id of g.c.questOrder) {
      const def = g.c.quests[id]!;
      if (this.parked[id]) continue;
      if (this.o.run === 1 && def.kind !== 'main') continue;
      if (def.requires?.christmas && !g.s.xmas) continue;
      // package 44b: a board job whose moment has passed before she took it (a den she cleared on her own)
      if (def.requires?.noFlag && !g.s.quests[id] && !test(g, def.requires)) continue;
      // package 47a: a gold cup's prize comes only once that cup is won (the full run plays for the cups at the end)
      const fl = def.requires?.flag;
      if (typeof fl === 'string' && fl.startsWith('cup_') && !g.s.quests[id]) continue;
      if (!g.s.quests[id]?.done && !(g.s.quests[id]?.times ?? 0)) return false;
    }
    return true;
  }
  mainDone(): boolean {
    for (const id of this.g.c.questOrder)
      if (this.g.c.quests[id]!.kind === 'main' && !this.g.s.quests[id]?.done) return false;
    return true;
  }

  /**
   * Point the player at another copy of the game (the timed play bot plans on a fresh copy of the browser's state each
   * time). What it has learned (quests given up, things to skip) stays; the map caches are dropped.
   */
  rebind(g: Game): void {
    this.g = g;
    this.task = null;
    this.reach = {};
    this.grids = {};
    this.gridRev = {};
  }

  /** Choose the next task (it reads the game, and `inp` once a step when run). Null when the run is over or stuck. */
  decide(): Gen | null {
    const g = this.g;
    const s = g.s;
    this.computeReach();
    if (this.finished()) {
      // a friend hero unlocked by the very last quest still gets the swap at the mirror (run 2)
      if (this.o.swapTo && s.heroes.includes(this.o.swapTo) && s.hero !== this.o.swapTo)
        return this.named(`swap to ${this.o.swapTo}`, this.mirror(this.o.swapTo));
      if (this.o.collect) {
        // package 44b: the best gear she can make first (diamond helmet and armour, both weapons at +2)
        const gear = this.gearNext();
        if (gear) return gear;
        // the island first (package 41): the four dens and every place she has not found yet
        const isl = this.islandNext();
        if (isl) return isl;
        // package 47a: every cup, bronze to gold, at the games' posts
        const cup = this.cupsNext();
        if (cup) return cup;
        const p = this.collectNext();
        if (p) return p;
      }
      this.done = true;
      return null;
    }
    const chore = this.cur;
    this.cur = this.mainQuest() ?? '(after)';
    // a friend hero waiting at the mirror (run 2)
    if (this.o.swapTo && s.heroes.includes(this.o.swapTo) && s.hero !== this.o.swapTo)
      return this.named(`swap to ${this.o.swapTo}`, this.mirror(this.o.swapTo));
    // post first: letters carry presents
    if (s.inbox.length && (this.choreAt.mail ?? -1) < s.ticks) {
      const p = this.readMail();
      if (isGen(p)) return this.chore('mail', 'read the post', p);
    }
    // a signpost close by that she has not found yet
    const sign = this.signNear();
    if (sign) return sign;
    // gear: make her sword or bow +1 or +2 when she can pay from what she has
    const up = this.upgradeChore();
    if (up) return up;
    // pick up offers
    const off = this.offers();
    if (off) return off;
    // the quests themselves
    let waitNight = '';
    let waitKind: 'night' | 'day' = 'night';
    let waitMorning = '';
    const later: [string, string][] = [];
    let patience = 3;
    for (const qid of this.priority()) {
      const p = this.planQuest(qid);
      if (isGen(p)) {
        this.cur = qid;
        if (this.why !== this.lastWhy) {
          this.lastWhy = this.why;
          if (this.o.verbose) console.log(`  ${clock(this.kid)}  [${qid}] ${this.why}`);
        }
        return p;
      }
      if (p.wait === 'night' || p.wait === 'day') {
        if (!waitNight) {
          waitNight = `${qid}: ${p.why}`;
          waitKind = p.wait;
        }
      } else if (p.wait === 'morning') {
        waitMorning ||= `${qid}: ${p.why}`;
        patience = Math.max(patience, p.patience ?? 3);
      } else if (p.wait === 'later') later.push([qid, p.why]);
      else this.give_up(qid, p.why);
      if (this.stuck) return null;
    }
    // a quest on offer whose giver only comes out at night (or by day): wait for them rather than sleep
    if (!waitNight && this.offerWait) {
      waitNight = this.offerWait.why;
      waitKind = this.offerWait.kind;
    }
    // nothing to do this minute: wait for night, or sleep till morning
    if (waitNight) {
      this.why = `wait (${waitNight})`;
      return this.waitFor(() => isNight(g) === (waitKind === 'night'), 60 * 60 * 14, true);
    }
    if (waitMorning || this.offersTomorrow()) {
      // three nights in a row with no quest moving on means the wait will never end
      const qs = this.questSig();
      if (qs === this.sleepSig) this.sleeps++;
      else {
        this.sleeps = 0;
        this.sleepSig = qs;
      }
      if (this.sleeps >= patience) {
        const never = waitMorning ? '' : `quests that are allowed but never offered: ${this.unoffered().join(', ')}`;
        this.stuck = `waited ${patience} days and nothing moved on: ${waitMorning || never} ${this.where()}`;
        return null;
      }
      this.why = `sleep (${waitMorning || 'more quests tomorrow'})`;
      this.cur = chore && s.quests[chore] && !s.quests[chore]!.done ? chore : this.cur;
      return this.sleep();
    }
    // quests that wait for a way that nothing left can open
    if (later.length) {
      for (const [qid, why] of later) this.give_up(qid, why);
      if (this.stuck) return null;
      this.why = 'look again';
      return this.idleGen(1);
    }
    const never = g.c.questOrder.filter(
      (id) => !s.quests[id] && !this.parked[id] && (this.o.run !== 1 || g.c.quests[id]!.kind === 'main'),
    );
    this.stuck = `nothing left to do but the run is not finished${never.length ? '; never offered: ' + never.map((id) => `${id} (needs ${JSON.stringify(g.c.quests[id]!.requires ?? {})})`).join(', ') : ''} ${this.where()}`;
    return null;
  }

  /** What counts as moving on between mornings: quest steps, things in the bag and crops growing. */
  private questSig(): number {
    const s = this.g.s;
    let n = 0;
    for (const k in s.quests) {
      const q = s.quests[k]!;
      n += q.step * 3 + q.n * 7 + (q.done ? 101 : 0) + 1009;
    }
    for (const sl of s.bag) if (sl) n += sl.n * 13 + sl.id.length * 5;
    for (const k in s.pouch) n += s.pouch[k]! * 17;
    for (const c of s.crops) n += (c.age + 1) * 19;
    return n;
  }

  /**
   * Upgrade the sword (then the bow) she wears when what she already has pays for it, at an anvil she placed or at
   * Grandad's workbench once he opened it. She keeps 10 emeralds back for the stalls.
   */
  private upgradeChore(): Gen | null {
    const g = this.g;
    const s = g.s;
    if ((this.choreAt.upgrade ?? -1) >= s.ticks) return null;
    let at: { area: string; x: number; y: number } | null = null;
    for (const p of s.placed) if (g.c.items[p.item]?.place?.use === 'anvil') at = { area: p.area, x: p.x, y: p.y };
    if (!at && s.flags.upgrades_open)
      for (const area in g.c.areas)
        for (const o of g.c.areas[area]!.objects) if (o.id === 'grandad_bench') at = { area, x: o.x, y: o.y };
    if (!at) return null;
    for (const slot of ['sword', 'bow'] as const) {
      const id = worn(g, slot);
      const cost = id ? upgradeCost(g, id) : null;
      if (!id || !cost || s.emeralds < cost.emeralds + 10) continue;
      // like a child who plans ahead: the iron sword gets +1, the diamond sword +2; the bow any time
      const tier = g.c.items[id]!.tool!.tier;
      if (slot === 'sword' && (tier < 3 || (s.plus[id] ?? 0) >= tier - 2)) continue;
      let ok = true;
      for (const k in cost.items) {
        if (countWithChests(g, k) >= cost.items[k]!) continue;
        ok = false;
        // fetch what is missing when she can make or find it now (iron bars once she smelts, diamonds she mines)
        if (!g.s.recipes.includes(k) && k !== 'diamond') continue;
        const p = this.obtain(k, cost.items[k]!, []);
        if (isGen(p)) {
          this.cur = 'gear';
          return this.chore('upgrade', `get ${k} to upgrade ${id}`, p);
        }
      }
      if (!ok) continue;
      const where = at;
      const before = s.plus[id] ?? 0;
      const self = this;
      const gen = (function* (): Gen {
        if (!(yield* self.goNear(where.area, where.x, where.y, 1))) return false;
        self.inp.cmd = { c: 'upgrade', item: id };
        yield;
        if ((s.plus[id] ?? 0) > before) self.mark(`upgrade ${id} +${s.plus[id]}`);
        return (s.plus[id] ?? 0) > before;
      })();
      // an errand of her own choosing, not the story's walking: counted as gear, like the armour errands below
      this.cur = 'gear';
      return this.chore('upgrade', `upgrade ${id}`, gen);
    }
    return null;
  }

  /** Package 44a: the `upgrade` step. Make the piece she wears in the slot +1 at Grandad's bench (or her anvil). */
  private upgradePlan(slot: 'sword' | 'bow', moved: () => boolean): Plan {
    const g = this.g;
    const s = g.s;
    const id = worn(g, slot);
    if (!id) return { why: `no ${slot} to upgrade` };
    const cost = upgradeCost(g, id);
    if (!cost) return { why: `${id} cannot be upgraded` };
    for (const k in cost.items) {
      if (countWithChests(g, k) >= cost.items[k]!) continue;
      const p = this.obtain(k, cost.items[k]!, []);
      if (p) return p;
    }
    if (s.emeralds < cost.emeralds) return { why: `${cost.emeralds} emeralds to upgrade ${id}`, wait: 'later' };
    let at: { area: string; x: number; y: number } | null = null;
    for (const p of s.placed) if (g.c.items[p.item]?.place?.use === 'anvil') at = { area: p.area, x: p.x, y: p.y };
    if (!at)
      for (const area in g.c.areas)
        for (const o of g.c.areas[area]!.objects) if (o.id === 'grandad_bench') at = { area, x: o.x, y: o.y };
    if (!at) return { why: 'no bench for upgrades' };
    const where = at;
    this.why = `upgrade ${id}`;
    const self = this;
    return (function* (): Gen {
      if (!(yield* self.goNear(where.area, where.x, where.y, 1))) return false;
      self.inp.cmd = { c: 'upgrade', item: id };
      yield;
      if ((s.plus[id] ?? 0) > 0) self.mark(`upgrade ${id} +${s.plus[id]}`);
      for (let k = 0; k < 30 && !moved(); k++) yield;
      return moved();
    })();
  }

  /** Put a piece of gear on (what a child does when "Put it on? Space" shows, or on the Gear page). */
  private *wearGen(id: string): Gen {
    this.inp.cmd = { c: 'wear', item: id };
    yield;
    return this.g.s.gear[slotOf(this.g.c.items[id])!] === id;
  }

  /** A chore that, if it fails, is left alone for five game minutes so it never blocks the quests. */
  private *chore(key: string, why: string, gen: Gen): Gen {
    this.why = why;
    const ok = yield* gen;
    if (!ok) this.choreAt[key] = this.g.s.ticks + 60 * 60 * 5;
    return ok;
  }

  /**
   * Package 44b, the full run: the best gear she can make. The diamond helmet and armour once she knows them (made,
   * then put on), then the sword and the bow she wears up to +2 at her anvil or Grandad's bench. Each piece is tried
   * a few times; the time goes on its own tally ('gear'), which the whole game counts.
   */
  private gearNext(): Gen | null {
    const g = this.g;
    const s = g.s;
    const tries = (k: string) => this.collectTried[k] ?? 0;
    const tried = (k: string) => (this.collectTried[k] = tries(k) + 1);
    for (const id of ['diamond_helmet', 'diamond_armour']) {
      const key = 'gear:' + id;
      const slot = slotOf(g.c.items[id]);
      if (!slot || s.gear[slot] === id || !s.recipes.includes(id) || tries(key) >= 12) continue;
      tried(key);
      this.cur = 'gear';
      this.sigTick = s.ticks;
      if (count(g, id) > 0) return this.named(`put on ${id}`, this.wearGen(id));
      const p = this.obtain(id, 1, []);
      if (p && isGen(p)) return this.named(`make ${id}`, p);
    }
    let at: { area: string; x: number; y: number } | null = null;
    for (const p of s.placed) if (g.c.items[p.item]?.place?.use === 'anvil') at = { area: p.area, x: p.x, y: p.y };
    if (!at && s.flags.upgrades_open)
      for (const area in g.c.areas)
        for (const o of g.c.areas[area]!.objects) if (o.id === 'grandad_bench') at = { area, x: o.x, y: o.y };
    if (!at) return null;
    const where = at;
    for (const slot of ['sword', 'bow'] as const) {
      const id = worn(g, slot);
      const key = 'gear:' + slot;
      const cost = id ? upgradeCost(g, id) : null;
      if (!id || !cost || tries(key) >= 12) continue;
      tried(key);
      this.cur = 'gear';
      this.sigTick = s.ticks;
      let short = false;
      for (const k in cost.items) {
        if (countWithChests(g, k) >= cost.items[k]!) continue;
        const p = this.obtain(k, cost.items[k]!, []);
        if (p && isGen(p)) return this.named(`get ${k} to upgrade ${id}`, p);
        short = true;
      }
      if (short || s.emeralds < cost.emeralds) continue;
      const before = s.plus[id] ?? 0;
      const self = this;
      return this.named(
        `upgrade ${id}`,
        (function* (): Gen {
          if (!(yield* self.goNear(where.area, where.x, where.y, 1))) return false;
          self.inp.cmd = { c: 'upgrade', item: id };
          yield;
          if ((s.plus[id] ?? 0) > before) self.mark(`upgrade ${id} +${s.plus[id]}`);
          return (s.plus[id] ?? 0) > before;
        })(),
      );
    }
    return null;
  }

  /**
   * Package 47a, the full run: play every mini-game at its post for each cup in turn, bronze, silver and gold, once
   * its cups are open. Each go counts at the kid bot's seconds on its own tally ('cups'), which the whole game counts.
   */
  private cupsNext(): Gen | null {
    const g = this.g;
    const s = g.s;
    // package 57a: a gold cup's prize goes into the bag; keep a slot free for it (put down a flower or a shell)
    if (!s.bag.some((sl) => !sl)) {
      const junk = this.junkSlot();
      if (junk >= 0) {
        const self = this;
        return this.named(
          'make room for a prize',
          (function* (): Gen {
            self.inp.cmd = { c: 'drop', slot: junk };
            yield;
            return true;
          })(),
        );
      }
    }
    for (const game of this.miniGames()) {
      const tier = cupNext(g, game);
      const key = 'cup:' + game;
      if (!tier || (s.cups[game] ?? 0) >= 3 || (this.collectTried[key] ?? 0) >= 6) continue;
      this.collectTried[key] = (this.collectTried[key] ?? 0) + 1;
      const p = this.playMini(game, () => (s.cups[game] ?? 0) >= tier, undefined, true);
      if (!isGen(p)) {
        if (process.env.CUP_DEBUG) console.log(`cup ${game}: ${p.why}`);
        continue;
      }
      this.cur = 'cups';
      this.sigTick = s.ticks;
      return this.named(`play ${game} for cup ${tier}`, p);
    }
    return null;
  }

  /**
   * Package 41, the full run: clear each den she can reach (two waves, then its chest), then walk to every region and
   * landmark she has not found. Each target is tried at most 3 times. Time goes on its own tally ('den:<id>',
   * 'places') so the playtime report can count it in the whole game.
   */
  private islandNext(): Gen | null {
    const g = this.g;
    const s = g.s;
    const tried = (k: string) => (this.collectTried[k] = (this.collectTried[k] ?? 0) + 1);
    for (const id in g.c.dens) {
      const key = 'den:' + id;
      const d = g.c.dens[id]!;
      const c = denCentre(g, d);
      if (!c || (this.collectTried[key] ?? 0) >= 3) continue;
      const chest = 'chest_den_' + id;
      if (s.dens[id] === 2 && s.taken[chest]) continue;
      if (!this.reachTile('island', Math.floor(c.x), Math.floor(c.y) + Math.ceil(d.r) + 1)) continue;
      tried(key);
      this.cur = key;
      this.sigTick = s.ticks;
      const self = this;
      return this.named(
        `clear the den ${id}`,
        (function* (): Gen {
          if (s.dens[id] !== 2) {
            const sw = self.needSword([]);
            if (sw) return isGen(sw) ? yield* sw : false;
            // walk in by the south gap, then fight round the middle until both waves are beaten
            if (!(yield* self.goNear('island', Math.floor(c.x), Math.floor(c.y) + 1, 1))) return false;
            yield* self.fight('island', Math.floor(c.x), Math.floor(c.y), 6, () => s.dens[id] === 2, null);
            if ((s.dens[id] as number) !== 2) return false;
          }
          const a = g.c.areas.island!;
          const i = a.objects.findIndex((o) => o.id === chest);
          if (i < 0) return true;
          const o = a.objects[i]!;
          return yield* self.actAt(
            'island',
            o.x,
            o.y,
            1,
            1,
            (tg) => tg.kind === 'obj' && tg.objIndex === i,
            () => !!s.taken[chest],
            false,
            3,
          );
        })(),
      );
    }
    // Treasure Island is a place too: across the water in her own boat
    if (!s.places.treasure && s.pouch.boat && (this.collectTried['place:treasure'] ?? 0) < 3) {
      const b = this.boatTo(true);
      if (isGen(b)) {
        tried('place:treasure');
        this.cur = 'places';
        return this.named('find treasure', b);
      }
    }
    // places: the nearest unfound landmark or region she can walk to
    let best: { key: string; area: string; x: number; y: number } | null = null;
    let bestD = 1e9;
    const consider = (key: string, area: string, x: number, y: number) => {
      if ((this.collectTried[key] ?? 0) >= 3 || !this.reachTile(area, x, y)) return;
      const dd = this.distTo(area, x, y);
      if (dd < bestD) {
        bestD = dd;
        best = { key, area, x, y };
      }
    };
    for (const id in g.c.landmarks) {
      if (s.places[id]) continue;
      const d = g.c.landmarks[id]!;
      if (d.area) {
        const e = this.entry(d.area);
        if (e) consider('place:' + id, d.area, e.x, e.y);
        continue;
      }
      const p = d.at ? place(g, d.at) : null;
      if (p) consider('place:' + id, p.area, p.x, p.y);
    }
    const isl = g.c.areas.island!;
    for (const id in g.c.regions) {
      if (s.places[id]) continue;
      const code = g.c.regions[id]!.code;
      for (const n in isl.places) {
        const p = isl.places[n]!;
        if (regionAt(isl, p.x, p.y) !== code) continue;
        consider('place:' + id, 'island', p.x, p.y);
        if (best && (best as { key: string }).key === 'place:' + id) break;
      }
    }
    if (!best) return null;
    const b = best as { key: string; area: string; x: number; y: number };
    tried(b.key);
    this.cur = 'places';
    this.sigTick = s.ticks;
    return this.named(`find ${b.key.slice(6)}`, this.goNear(b.area, b.x, b.y, 2));
  }

  private named(why: string, gen: Gen): Gen {
    this.why = why;
    return gen;
  }

  private give_up(qid: string, why: string): void {
    const def = this.g.c.quests[qid]!;
    if (this.parked[qid]) return;
    const q = this.g.s.quests[qid];
    const st = q ? def.steps[q.step] : undefined;
    const msg = `${qid} step ${q?.step ?? '-'}${st ? ' (' + st.t + ')' : ''}: ${why}`;
    if (def.kind === 'main') {
      this.cur = qid;
      this.stuck = `${msg} ${this.where()}`;
      return;
    }
    // a quest she could not take yet (the board gave another poster, the giver walked off): try again tomorrow,
    // and give up only after three days of it
    if (!q) {
      const f = (this.offerFail[qid] ??= { day: -1, n: 0 });
      if (f.day !== this.g.s.day) {
        f.day = this.g.s.day;
        f.n++;
      }
      if (f.n < 3) return;
    }
    this.parked[qid] = msg;
    this.notes.push(`gave up ${msg}`);
  }

  private mainQuest(): string | null {
    for (const id of this.g.c.questOrder) {
      const q = this.g.s.quests[id];
      if (q && !q.done && this.g.c.quests[id]!.kind === 'main') return id;
    }
    return null;
  }

  /** Which active quests to work on, in order. Runs 1 and 2 do side quests as soon as they open; run 3 does the story first. */
  private priority(): string[] {
    const g = this.g;
    const main: string[] = [];
    const side: string[] = [];
    for (const id of g.c.questOrder) {
      const q = g.s.quests[id];
      if (!q || q.done || this.parked[id]) continue;
      (g.c.quests[id]!.kind === 'main' ? main : side).push(id);
    }
    return this.o.run === 3 ? [...main, ...side] : [...side, ...main];
  }

  private wantsOffer(def: QuestDef): boolean {
    if (this.parked[def.id]) return false;
    if (this.offerFail[def.id]?.day === this.g.s.day) return false;
    const q = this.g.s.quests[def.id];
    if (q?.done || (q?.times ?? 0) > 0) return false;
    if (this.o.run === 1 && def.kind !== 'main' && this.mainDone()) return false;
    if (this.o.run === 3 && def.kind !== 'main' && !this.mainDone()) return false;
    return offered(this.g, def);
  }

  private offers(): Gen | null {
    const g = this.g;
    this.offerWait = null;
    for (const id of g.c.questOrder) {
      const def = g.c.quests[id]!;
      if (!this.wantsOffer(def)) continue;
      const before = g.s.quests[id];
      const started = () => !!g.s.quests[id] && g.s.quests[id] !== before;
      let p: Plan;
      // package 53a: only Wanted posters wait for each other; a board job is taken like any other board job
      if (isPoster(def)) {
        if (Object.keys(g.s.quests).some((k) => isPoster(g.c.quests[k]!) && !g.s.quests[k]!.done)) continue;
        if (!boardJobs(g).includes(id)) continue;
        // the board hands out the first bounty it holds, which may be another one (a repeat): any new one will do
        const was = Object.values(g.s.quests);
        p = this.useBoard(
          'bounty',
          () =>
            g.c.questOrder.some(
              (k) => g.c.quests[k]!.kind === 'bounty' && !!g.s.quests[k] && !was.includes(g.s.quests[k]!),
            ),
          id,
        );
      } else if (def.board) {
        // only the (at most 3) jobs on the board today can be taken
        if (!boardJobs(g).includes(id)) continue;
        p = this.useBoard('board', started, id);
      } else if (this.heldUp(cast(g, def.giver), id)) continue;
      else p = this.talk(cast(g, def.giver));
      if (!isGen(p) && (p.wait === 'night' || p.wait === 'day'))
        this.offerWait ??= { kind: p.wait, why: `${id}: ${p.why}` };
      if (isGen(p)) {
        this.cur = id;
        this.why = `take the quest ${id}`;
        if (this.o.verbose && this.why !== this.lastWhy) console.log(`  ${clock(this.kid)}  [${id}] ${this.why}`);
        this.lastWhy = this.why;
        return p;
      }
    }
    return null;
  }
  /**
   * Another active quest that would take the key press when she talks to this character: the rules answer the first
   * talk or deliver step for them, and a deliver without enough things only says "you need more" (quests.ts talkTo).
   */
  private heldUp(who: string, want: string): string | null {
    const g = this.g;
    const s = g.s;
    const order = s.tracked ? [s.tracked, ...g.c.questOrder.filter((k) => k !== s.tracked)] : g.c.questOrder;
    for (const qid of order) {
      const q = s.quests[qid];
      if (!q || q.done) continue;
      const def = g.c.quests[qid]!;
      const st = def.steps[q.step];
      const hit = !st
        ? cast(g, def.giver) === who
        : (st.t === 'talk' && cast(g, st.who) === who) || (st.t === 'deliver' && cast(g, st.to) === who);
      if (!hit) continue;
      if (qid === want) return null;
      if (st?.t === 'deliver' && count(g, st.item) < (st.n ?? 1)) return qid;
      return null;
    }
    return null;
  }

  /** When another quest's delivery to this character comes first in the rules, get its things first. */
  private unblock(who: string, qid: string): Plan | null {
    const by = this.heldUp(who, qid);
    if (!by) return null;
    const bs = this.g.c.quests[by]!.steps[this.g.s.quests[by]!.step];
    if (bs?.t !== 'deliver') return null;
    const p = this.obtain(bs.item, bs.n ?? 1);
    if (!p) return null;
    if (isGen(p)) this.cur = by;
    return p;
  }

  /** Side quests whose conditions hold that the game has not put on offer. */
  private unoffered(): string[] {
    const g = this.g;
    return g.c.questOrder.filter((id) => {
      const def = g.c.quests[id]!;
      return def.kind !== 'main' && !this.parked[id] && !g.s.quests[id] && test(g, def.requires);
    });
  }

  /** Side quests waiting for tomorrow's offers. */
  private offersTomorrow(): boolean {
    const g = this.g;
    for (const id of g.c.questOrder) {
      const def = g.c.quests[id]!;
      if (def.kind === 'main' || this.parked[id] || g.s.quests[id]) continue;
      if (this.o.run === 1 || (def.requires?.christmas && !g.s.xmas)) continue;
      if (this.o.run === 3 && !this.mainDone()) continue;
      if (test(g, def.requires)) return true;
      // package 70: a quest that opens with a morning card comes the morning after its card is due
      if (def.card && !g.s.flags['card:' + id] && test(g, def.card.if)) return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ one quest step

  private planQuest(qid: string): Plan {
    const g = this.g;
    const s = g.s;
    const def = g.c.quests[qid]!;
    const q = s.quests[qid]!;
    const st = def.steps[q.step];
    const at = q.step;
    const moved = () => !s.quests[qid] || s.quests[qid]!.done || s.quests[qid]!.step !== at;
    if (!st) {
      const u = this.unblock(cast(g, def.giver), qid);
      if (u) return u;
      this.why = `go back to ${cast(g, def.giver)}`;
      return this.talk(cast(g, def.giver));
    }
    const n = 'n' in st && st.n ? st.n : 1;
    // package 44b: Treasure Island is across the water (the end of Dad's trail): the boat takes her over for a step
    // whose place is there, and home again for any other
    const isle = this.isleBoat(qid);
    if (isle) return isle;
    switch (st.t) {
      case 'talk': {
        const u = this.unblock(cast(g, st.who), qid);
        if (u) return u;
        this.why = `talk to ${cast(g, st.who)}`;
        return this.talk(cast(g, st.who));
      }
      case 'deliver': {
        const p = this.obtain(st.item, n);
        if (p) return p;
        const u = this.unblock(cast(g, st.to), qid);
        if (u) return u;
        this.why = `give ${n} ${st.item} to ${cast(g, st.to)}`;
        return this.talk(cast(g, st.to));
      }
      case 'fetch': {
        const p = this.obtain(st.item, n);
        if (p) return p;
        return this.idle(13, 'wait for the fetch step');
      }
      case 'craft': {
        if (count(g, st.item) >= n) return this.idle(13, 'wait for the craft step');
        // package 57a: a thing given into a full bag waits on the ground: pick it up first (making room if needed)
        if (this.dropOf(st.item)) {
          const p = this.obtain(st.item, n);
          if (p) return p;
        }
        return this.craftPlan(st.item, n - count(g, st.item), []);
      }
      case 'place': {
        let have = 0;
        for (const p of s.placed) if (p.item === st.item) have++;
        if (have >= n) return this.idle(13, 'wait for the place step');
        const p = this.obtain(st.item, 1);
        if (p) return p;
        this.why = `place ${st.item}`;
        return this.placeItem(st.item, st.mark);
      }
      case 'site':
        return this.sitePlan(st.site);
      case 'defeat':
        return this.defeatPlan(st, moved);
      case 'reach': {
        const p = place(g, st.place);
        if (!p) return { why: `no place called ${st.place}` };
        // package 47a: clear the way when the place itself is shut off (a high web over the gap), not just near it
        const clear = this.clearWay(p.area, p.x, p.y, Math.max(0, (p.r ?? 2.5) - 0.6));
        if (clear) return clear;
        const goals = this.circle(p.area, p.x, p.y, Math.max(0, (p.r ?? 2.5) - 0.6), true);
        if (!goals.length) return { why: `cannot reach ${st.place}` };
        this.why = `go to ${st.place}`;
        const self = this;
        return (function* (): Gen {
          if (!(yield* self.walk(p.area, goals))) return false;
          return yield* self.idleGen(13);
        })();
      }
      case 'night': {
        const p = place(g, st.place);
        if (!p) return { why: `no place called ${st.place}` };
        // package 47a: clear the way when the place itself is shut off (a high web over the gap), not just near it
        const clear = this.clearWay(p.area, p.x, p.y, Math.max(0, (p.r ?? 2.5) - 0.6));
        if (clear) return clear;
        const goals = this.circle(p.area, p.x, p.y, Math.max(0, (p.r ?? 2.5) - 0.6), true);
        if (!goals.length) return { why: `cannot reach ${st.place}` };
        this.why = `go to ${st.place} and wait for night`;
        const self = this;
        return (function* (): Gen {
          if (!(yield* self.walk(p.area, goals))) return false;
          return yield* self.waitFor(() => isNight(g) || moved(), 60 * 60 * 14, true);
        })();
      }
      case 'fish':
        return this.fishPlan(st.kind, moved);
      case 'grow':
        return this.growPlan(st.crop, n, moved);
      case 'lead':
        return this.leadPlan(st.animal, st.pen, moved);
      case 'mini':
        return this.miniPlan(st, moved);
      case 'sleep':
        this.why = 'go to bed';
        return this.sleep();
      case 'upgrade':
        return this.upgradePlan(st.slot, moved);
      default:
        return { why: `the solver does not know step type ${(st as Step).t}` };
    }
  }

  // ------------------------------------------------------------------ getting things

  /** Plan to have n of an item. Null when she has them already. */
  obtain(item: string, n: number, chain: string[] = []): Plan | null {
    const g = this.g;
    const s = g.s;
    const c = g.c;
    const have = count(g, item);
    if (have >= n) return null;
    if (!c.items[item]) return { why: `unknown item ${item}` };
    if (chain.includes(item) || chain.length > 7) return { why: `goes round in a circle at ${item}` };
    const ch = [...chain, item];
    const held: { wait: Block | null; why: string } = { wait: null, why: '' };
    const keep = (p: Plan): Gen | null => {
      if (isGen(p)) return p;
      if (p.wait && (!held.wait || (held.wait.wait === 'later' && p.wait !== 'later'))) held.wait = p;
      held.why ||= p.why;
      return null;
    };
    // 1. lying on the ground
    const d = this.dropOf(item);
    if (d) {
      this.why = `pick up ${item}`;
      // package 57a: flowers and shells hop into the bag by themselves, so a long game can fill it; a full bag (and
      // full chests) makes room the way a child would, by putting down a flower or a shell she only walked past
      const junk = makeRoom(g, item) ? -1 : this.junkSlot();
      // a thing she put down herself stays down until she has walked 2.5 tiles away: step away, then come back
      const put = g.s.drops.some((o) => o.put && o.id === item && o.area === d.area && o.x === d.x && o.y === d.y);
      if (junk >= 0 || put) {
        const self = this;
        return (function* (): Gen {
          if (junk >= 0) {
            self.inp.cmd = { c: 'drop', slot: junk };
            yield;
          }
          if (put && s.area === d.area) {
            const ring = self.circle(d.area, Math.floor(d.x), Math.floor(d.y), 5);
            const far: number[] = [];
            for (let i = 0; i < ring.length; i += 2)
              if (Math.hypot(ring[i]! + 0.5 - d.x, ring[i + 1]! + 0.5 - d.y) > 3) far.push(ring[i]!, ring[i + 1]!);
            if (far.length) yield* self.walk(d.area, far);
          }
          const go = self.goTo(d.area, Math.floor(d.x), Math.floor(d.y));
          return isGen(go) ? yield* go : false;
        })();
      }
      return this.goTo(d.area, Math.floor(d.x), Math.floor(d.y));
    }
    // 2. a letter in the mailbox carries it
    if (s.inbox.some((l) => c.letters[l]?.gift?.[item])) {
      const p = keep(this.readMail());
      if (p) return p;
    }
    // 2b. a chest, a dig spot or something lying about whose loot holds it
    const pl = keep(this.viaLoot(item));
    if (pl) return pl;
    // 2c. prize tickets: a new star in a mini-game pays them
    if (item === 'ticket') {
      const pt = keep(this.earnTickets(n));
      if (pt) return pt;
    }
    // 3. a recipe she knows
    for (const id of s.recipes) {
      const r = c.recipes[id];
      if (!r || r.out !== item) continue;
      const p = keep(this.viaRecipe(r, n - have, ch));
      if (p) return p;
    }
    // 4. a resource node
    const pn = keep(this.viaNode(item, n, ch));
    if (pn) return pn;
    // 4b. sand: dig it from the beach with a spade
    if (item === 'sand') {
      const pd = keep(this.digSand(n));
      if (pd) return pd;
    }
    // 5. a mob that drops it
    const pmRaw = this.viaMob(item, n, ch);
    const pm = keep(pmRaw);
    if (pm) return pm;
    // a night fight beats a walk to a stall whose keeper comes and goes (the wandering trader): wait for dark
    if (!isGen(pmRaw) && pmRaw.wait === 'night' && this.onlyComesAndGoes(item)) return pmRaw;
    // 6. a stall that sells it, or teaches its recipe; a stall whose keeper comes and goes (the wandering trader)
    // only when nothing else will do, not even waiting for the night or the morning
    const ps = keep(this.viaStall(item, n - have, ch));
    if (ps && this.onlyComesAndGoes(item) && held.wait && held.wait.wait !== 'later') return held.wait;
    if (ps) return ps;
    // 7. an animal that gives it
    const pa = keep(this.viaAnimal(item));
    if (pa) return pa;
    // 8. a fish
    if (c.fish[item]) {
      const pf = keep(this.fishPlan(item, () => count(g, item) >= n));
      if (pf) return pf;
    }
    // 9. a crop
    const pc = keep(this.viaCrop(item, n, ch));
    if (pc) return pc;
    return held.wait ?? { why: `no way to get ${item}${held.why ? ' (' + held.why + ')' : ''}` };
  }

  /** One-off loot: chests, dig spots and pickups whose data names the item. */
  private viaLoot(item: string): Plan {
    const g = this.g;
    const s = g.s;
    let best: { area: string; i: number; o: MapObj; w: number; h: number; dig: boolean } | null = null;
    let bestD = 1e9;
    let later: Block | null = null;
    for (const area in g.c.areas) {
      const a = g.c.areas[area]!;
      for (let i = 0; i < a.objects.length; i++) {
        const o = a.objects[i]!;
        const t = g.c.objects[o.type]!;
        if (t.interact !== 'chest' && t.interact !== 'dig' && t.interact !== 'pickup') continue;
        if (s.taken[o.id] || !lootOf(o.d, item.startsWith('sticker.'))[item]) continue;
        if (!this.reachArea(area) || !this.standable(area, o.x, o.y, t.w ?? 1, t.h ?? 1)) {
          // a way her tools can open for good (a cracked rock for an iron pickaxe): open it and come back
          if (this.reachArea(area)) {
            const br = this.breakBeside(area, o);
            if (br && isGen(br)) return br;
            const clear = this.clearWay(area, o.x, o.y);
            if (clear && isGen(clear)) return clear;
          }
          later ??= { why: `the ${o.type} with ${item} is somewhere she cannot reach yet`, wait: 'later' };
          continue;
        }
        if (o.if && !test(g, o.if)) {
          if (o.if.night && !isNight(g) && test(g, { ...o.if, night: undefined }))
            later = { why: `the ${o.type} with ${item} only shows at night`, wait: 'night' };
          continue;
        }
        if ((this.skipObj[area + ':' + i] ?? -1) >= s.ticks) {
          // a try that failed a moment ago (a mob in the way, say): it is still there, so look again later
          later ??= { why: `the ${o.type} with ${item} could not be opened just now`, wait: 'later' };
          continue;
        }
        const d = this.distTo(area, o.x, o.y);
        if (d < bestD) {
          bestD = d;
          best = { area, i, o, w: t.w ?? 1, h: t.h ?? 1, dig: t.interact === 'dig' };
        }
      }
    }
    if (!best) return later ?? { why: `no chest or find holds ${item}` };
    const b = best;
    if (b.dig && toolTier(g, 'spade') === 0)
      return this.toolItem('spade', 1, [item]) ?? { why: `needs a spade to dig up ${item}` };
    this.why = `open the ${b.o.type} ${b.o.id} for ${item}`;
    const self = this;
    return (function* (): Gen {
      const ok = yield* self.actAt(
        b.area,
        b.o.x,
        b.o.y,
        b.w,
        b.h,
        (tg) => tg.kind === 'obj' && tg.objIndex === b.i,
        () => !!s.taken[b.o.id],
        false,
        3,
      );
      if (!ok) self.skipObj[b.area + ':' + b.i] = s.ticks + 60 * 60 * 5;
      return ok;
    })();
  }

  /** Prize tickets: play a mini-game she has not got 3 stars in yet (each new star pays one ticket). */
  private earnTickets(n: number): Plan {
    const g = this.g;
    let first: Plan | null = null;
    for (const game of this.miniGames()) {
      if ((g.s.stars[game] ?? 0) >= 3) continue;
      const p = this.playMini(game, () => count(g, 'ticket') >= n || (g.s.stars[game] ?? 0) >= 3);
      if (isGen(p)) {
        this.why = `play ${game} for prize tickets (${count(g, 'ticket')}/${n})`;
        return p;
      }
      first ??= p;
    }
    return first ?? { why: 'every mini-game has 3 stars: no more prize tickets' };
  }

  /** Every mini-game something in the world can start. */
  private miniGames(): string[] {
    const g = this.g;
    const out = new Set<string>();
    for (const id in g.c.chars) {
      const sv = g.c.chars[id]!.service;
      if (sv?.startsWith('mini:')) out.add(sv.slice(5));
    }
    for (const area in g.c.areas)
      for (const o of g.c.areas[area]!.objects) {
        const t = g.c.objects[o.type]!;
        if (t.interact === 'play' && o.d) out.add(o.d);
        if (t.interact === 'minecart' && o.d === 'ride') out.add('minecart');
        if (t.interact === 'claw') out.add('claw');
      }
    return [...out];
  }

  /**
   * Go to whatever starts a mini-game and start it: a host (a character whose service is mini:<game>), a game post,
   * the minecart that says "ride", or the claw machine. `near` prefers the starter closest to a mark.
   */
  private playMini(
    game: string,
    done: () => boolean,
    near?: { area: string; x: number; y: number },
    postOnly = false,
  ): Plan {
    const g = this.g;
    const s = g.s;
    type Starter = { d: number; gen: () => Gen };
    const opts: Starter[] = [];
    let why = `nothing starts the mini-game ${game}`;
    const far = (area: string, x: number, y: number) =>
      near ? (near.area === area ? 0 : 500) + Math.abs(near.x - x) + Math.abs(near.y - y) : this.distTo(area, x, y);
    for (const area in this.reach) {
      const a = g.c.areas[area]!;
      for (let i = 0; i < a.objects.length; i++) {
        const o = a.objects[i]!;
        const t = g.c.objects[o.type]!;
        const hit =
          (t.interact === 'play' && o.d === game) ||
          (t.interact === 'minecart' && o.d === 'ride' && game === 'minecart') ||
          (t.interact === 'claw' && game === 'claw');
        if (!hit || !g.rt.live[area]?.[i] || !this.standable(area, o.x, o.y, t.w ?? 1, t.h ?? 1)) continue;
        if (game === 'claw' && s.flags.claw_free && (s.counts.clawGoes ?? 0) <= 0 && !freeCupGo(g)) {
          why = 'no goes left on the claw machine';
          continue;
        }
        opts.push({
          d: far(area, o.x, o.y),
          gen: () =>
            this.actAt(
              area,
              o.x,
              o.y,
              t.w ?? 1,
              t.h ?? 1,
              (tg) => tg.kind === 'obj' && tg.objIndex === i,
              () => this.nMini > before || done(),
              false,
              3,
            ),
        });
      }
    }
    let before = this.nMini;
    for (const id in g.c.chars) {
      if (postOnly || g.c.chars[id]!.service !== 'mini:' + game) continue;
      if (game === 'snowball' && !s.xmas) {
        why = 'the snowball game is only at Christmas';
        continue;
      }
      const sp = charPlace(g, id);
      if (!sp || !this.reachArea(sp.area)) continue;
      opts.push({ d: far(sp.area, sp.x, sp.y), gen: () => this.talkGen(id) });
    }
    if (!opts.length) return { why };
    opts.sort((p, q) => p.d - q.d);
    const self = this;
    return (function* (): Gen {
      for (const o of opts) {
        before = self.nMini;
        yield* o.gen();
        // the host may ask first: the talk box and the mini-game run themselves (auto)
        for (let k = 0; k < 30 && self.nMini === before && !done(); k++) yield;
        if (self.nMini > before || done()) return true;
      }
      return self.fail(`could not start ${game}`);
    })();
  }

  private viaRecipe(r: RecipeDef, need: number, chain: string[]): Plan {
    const times = Math.max(1, Math.ceil(need / r.n));
    for (const k in r.in) {
      const p = this.obtain(k, r.in[k]! * times, chain);
      if (p) return p;
    }
    this.why = `craft ${r.out} x${times}`;
    return this.craftAt(r.id, times);
  }

  /** A craft step: only crafting counts, so it never picks things up or buys them. */
  private craftPlan(item: string, need: number, chain: string[]): Plan {
    const g = this.g;
    for (const id of g.s.recipes) {
      const r = g.c.recipes[id];
      if (r && r.out === item) return this.viaRecipe(r, need, chain);
    }
    for (const stall in g.c.stalls) {
      const rows = g.c.stalls[stall]!.sells;
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]!;
        if (row.recipe && g.c.recipes[row.recipe]?.out === item && test(g, row.if) && stockLeft(g, stall, i) > 0)
          return this.buyPlan(stall, i, 1, chain);
      }
    }
    return { why: `does not know a recipe for ${item}` };
  }

  private viaNode(item: string, n: number, chain: string[]): Plan {
    const g = this.g;
    const s = g.s;
    const list = this.nodesFor[item];
    if (!list) return { why: `nothing to gather gives ${item}` };
    let best: { area: string; i: number; o: MapObj } | null = null;
    let bestD = 1e9;
    let needTool: { type: string; tier: number } | null = null;
    let used = false;
    for (const { area, i } of list) {
      const o = g.c.areas[area]!.objects[i]!;
      const t = g.c.objects[o.type]!;
      if (!this.reachArea(area)) continue;
      if (o.if && !test(g, o.if)) continue;
      if (s.taken[o.id]) continue;
      if (s.nodes[o.id] !== undefined) {
        if (t.node!.regrow) used = true;
        continue;
      }
      if ((this.skipObj[area + ':' + i] ?? -1) >= s.ticks) continue;
      if (!this.standable(area, o.x, o.y, t.w ?? 1, t.h ?? 1)) continue;
      const node = t.node!;
      if (node.tool && toolTier(g, node.tool) < (node.tier ?? 1)) {
        if (!needTool || (node.tier ?? 1) < needTool.tier) needTool = { type: node.tool, tier: node.tier ?? 1 };
        continue;
      }
      const d = this.distTo(area, o.x, o.y);
      if (d < bestD) {
        bestD = d;
        best = { area, i, o };
      }
    }
    if (!best) {
      if (needTool) {
        const tool = this.toolItem(needTool.type, needTool.tier, chain);
        if (tool) return tool;
        return { why: `needs a ${needTool.type} of tier ${needTool.tier}` };
      }
      if (used) return { why: `every node for ${item} is used up today`, wait: 'morning' };
      return { why: `nothing left to gather for ${item}` };
    }
    const { area, i, o } = best;
    const t = g.c.objects[o.type]!;
    this.why = `${t.node!.verb} ${o.type} for ${item} (${count(g, item)}/${n})`;
    const self = this;
    return (function* (): Gen {
      const ok = yield* self.actAt(
        area,
        o.x,
        o.y,
        t.w ?? 1,
        t.h ?? 1,
        (tg) => tg.kind === 'obj' && tg.objIndex === i,
        () => s.nodes[o.id] !== undefined || !!s.taken[o.id] || !objLive(g, o),
        !!t.node!.tool,
        900,
      );
      // a thing in front that is not the node (two objects on one tile): leave this node for half an hour
      if (!ok) self.skipObj[area + ':' + i] = s.ticks + 60 * 60 * 30;
      return ok;
    })();
  }

  /** Dig sand: face a sand tile with a spade and swing until there is enough. */
  private digSand(n: number): Plan {
    const g = this.g;
    if (toolTier(g, 'spade') === 0) return this.toolItem('spade', 1, ['sand']) ?? { why: 'needs a spade to dig sand' };
    let best: { area: string; x: number; y: number } | null = null;
    let bestD = 1e9;
    for (const area in this.reach) {
      const a = g.c.areas[area]!;
      const reach = this.reach[area]!;
      const grid = this.grid(area);
      for (let y = 1; y < a.h - 1; y++)
        for (let x = 1; x < a.w - 1; x++) {
          if (terrainAt(a, x, y) !== 's' || grid[y * a.w + x]) continue;
          let ok = false;
          for (let d = 0; d < 4 && !ok; d++) if (reach[(y + DY[d]!) * a.w + x + DX[d]!]) ok = true;
          if (!ok) continue;
          const dd = this.distTo(area, x, y);
          if (dd < bestD) {
            bestD = dd;
            best = { area, x, y };
          }
        }
    }
    if (!best) return { why: 'no sand she can reach' };
    const b = best;
    this.why = `dig sand (${count(g, 'sand')}/${n})`;
    return this.actAt(
      b.area,
      b.x,
      b.y,
      1,
      1,
      (t) => t.kind === 'sand',
      () => count(g, 'sand') >= n,
      true,
      60 * 30,
    );
  }

  /** Get the lowest tool of a type that does the job. */
  private toolItem(type: string, tier: number, chain: string[]): Plan | null {
    const g = this.g;
    // gear she owns but has not put on yet (the "Put it on?" is still up): put it on
    if (type === 'sword' || type === 'bow' || type === 'helmet' || type === 'armour') {
      const own = Object.keys(g.s.pouch).find(
        (id) => (g.s.pouch[id] ?? 0) > 0 && g.c.items[id]?.tool?.type === type && g.c.items[id]!.tool!.tier >= tier,
      );
      if (own) return this.named(`put on ${own}`, this.wearGen(own));
    }
    const opts = Object.values(g.c.items)
      .filter((d) => d.tool && d.tool.type === type && d.tool.tier >= tier)
      .sort((a, b) => a.tool!.tier - b.tool!.tier);
    let first: Plan | null = null;
    for (const d of opts) {
      const p = this.obtain(d.id, 1, chain);
      if (!p) continue;
      if (isGen(p)) return p;
      first ??= p;
    }
    return first;
  }

  private viaMob(item: string, n: number, chain: string[]): Plan {
    const g = this.g;
    const mobs = Object.values(g.c.mobs).filter(
      (m) => m.role === 'hostile' && m.drops.some((d) => d.item === item && (d.p ?? 1) > 0),
    );
    if (!mobs.length) return { why: `no mob drops ${item}` };
    let best: { area: string; id: string; x: number; y: number; night: boolean } | null = null;
    let bestD = 1e9;
    for (const m of mobs) {
      const z = this.bestZone(m.id);
      if (!z) continue;
      const d = this.distTo(z.area, z.x, z.y) + (z.night && !isNight(g) ? 400 : 0);
      if (d < bestD) {
        bestD = d;
        best = z;
      }
    }
    if (!best) return { why: `no spawn zone she can reach has a mob that drops ${item}`, wait: 'later' };
    const sw = this.needSword(chain);
    if (sw) return sw;
    if (best.night && !isNight(this.g)) return { why: `mobs for ${item} only come out at night`, wait: 'night' };
    const b = best;
    this.why = `fight for ${item} (${count(g, item)}/${n}) in ${b.id}`;
    this.fightZone = b.id;
    return this.fight(b.area, b.x, b.y, 6, () => count(g, item) >= n || (b.night && !isNight(g)), null);
  }

  /** Every stall that sells this item is kept by someone who is only on the island some days. */
  private onlyComesAndGoes(item: string): boolean {
    const g = this.g;
    const stalls = Object.values(g.c.stalls).filter((st) => st.sells.some((r) => r.item === item));
    return (
      stalls.length > 0 &&
      stalls.every((st) => {
        const k = st.keeper ? g.c.chars[st.keeper] : undefined;
        return !!k && k.spots.every((sp) => sp.if);
      })
    );
  }

  // ------------------------------------------------------------------ collections (run 3, after the quests)

  /** Finds she still lacks: sticker keys and collection items in chests, dig spots and pick-ups, and at stalls. */
  private collectTargets(): string[] {
    const g = this.g;
    const s = g.s;
    const out = new Set<string>();
    const want = (id: string) => !!g.c.stickers[id]?.page && !s.stickers[id];
    for (const area in g.c.areas)
      for (const o of g.c.areas[area]!.objects) {
        const t = g.c.objects[o.type];
        if (!t || (t.interact !== 'chest' && t.interact !== 'dig' && t.interact !== 'pickup') || s.taken[o.id])
          continue;
        for (const k in lootOf(o.d, true)) if (k.startsWith('sticker.') ? !s.stickers[k.slice(8)] : want(k)) out.add(k);
      }
    for (const st of Object.values(g.c.stalls)) for (const r of st.sells) if (r.item && want(r.item)) out.add(r.item);
    return [...out];
  }

  /** The next collection to go for, a wait for night, or null when nothing is left that she can get. */
  private collectNext(): Gen | null {
    const g = this.g;
    const s = g.s;
    const MAX = 4;
    let night = '';
    const attempt = (key: string, gen: Gen): Gen => {
      this.collectTried[key] = (this.collectTried[key] ?? 0) + 1;
      // each attempt is bounded (MAX tries a target), so a long one is not a stall
      this.sigTick = s.ticks;
      return this.named(`collect ${key}`, gen);
    };
    for (const key of this.collectTargets()) {
      if ((this.collectTried[key] ?? 0) >= MAX) continue;
      // Treasure Island is across the water: take the boat over (or back) first, from wherever she is (package 51b:
      // inside a mine or a house she is on neither shore, so the find's side is read from the map, not from her area)
      const at = this.lootObj(key);
      const isle =
        !!at && at.area === 'island' && regionAt(g.c.areas.island!, Math.floor(at.o.x), Math.floor(at.o.y)) === 'T';
      if (at && at.area === 'island' && isle !== this.isTreasure(s.x, s.y)) {
        const b = this.boatTo(isle);
        if (isGen(b)) return attempt(key, b);
      }
      let p: Plan = this.viaLoot(key);
      if (!isGen(p) && !key.startsWith('sticker.')) {
        const ps = this.viaStall(key, 1, [key]);
        if (isGen(ps)) p = ps;
      }
      if (!isGen(p) && /cannot reach/.test(p.why)) {
        const b = this.blastPlan(key);
        if (b) p = b;
      }
      if (isGen(p)) return attempt(key, p);
      if (process.env.BLAST_DEBUG) console.log(`collect ${key}: ${p.why} (${p.wait ?? '-'})`);
      if (p.wait === 'night' && !isNight(g)) night ||= `${key}: ${p.why}`;
      else this.collectTried[key] = MAX;
    }
    for (const game of this.miniGames()) {
      const key = 'mini:' + game;
      if ((s.stars[game] ?? 0) >= 3 || (this.collectTried[key] ?? 0) >= MAX) continue;
      const p = this.playMini(game, () => (s.stars[game] ?? 0) >= 3);
      if (isGen(p)) return attempt(key, p);
      this.collectTried[key] = MAX;
    }
    if (night) {
      this.why = `wait for night (${night})`;
      return this.waitFor(() => isNight(g), 60 * 60 * 14, true);
    }
    const left = this.collectTargets();
    for (const game of this.miniGames()) if ((s.stars[game] ?? 0) < 3) left.push('mini:' + game);
    if (left.length && !this.collectLeft.length) {
      this.collectLeft = left;
      this.notes.push(`never collected: ${left.join(' ')}`);
    }
    return null;
  }

  /** The first find (not yet taken) that holds this key, and its area. */
  private lootObj(key: string): { area: string; o: MapObj } | null {
    const g = this.g;
    for (const area in g.c.areas)
      for (const o of g.c.areas[area]!.objects)
        if (!g.s.taken[o.id] && lootOf(o.d, true)[key] && (!o.if || test(g, o.if))) return { area, o };
    return null;
  }
  private isTreasure(x: number, y: number): boolean {
    return this.g.s.area === 'island' && regionAt(this.g.c.areas.island!, Math.floor(x), Math.floor(y)) === 'T';
  }
  /** Package 44b: the boat over to Treasure Island when the step's place is there, or home when it is not; else null. */
  private isleBoat(qid: string): Plan | null {
    const g = this.g;
    if (g.s.area !== 'island') return null;
    const tg = stepTarget(g, qid);
    const want = !!tg && tg.area === 'island' && this.isTreasure(tg.x, tg.y);
    if (want === this.isTreasure(g.s.x, g.s.y)) return null;
    if (!g.s.pouch.boat) return { why: 'Treasure Island needs her boat', wait: 'later' };
    const b = this.boatTo(want);
    return isGen(b) ? b : null;
  }
  /** Take her own boat to Treasure Island, or back home from it. */
  private boatTo(treasure: boolean): Plan {
    const g = this.g;
    if (!g.s.pouch.boat) return { why: 'she has no boat yet' };
    const a = g.c.areas.island!;
    const i = a.objects.findIndex((o) => o.type === 'boat' && (o.d === 'home') === !treasure);
    if (i < 0) return { why: 'no boat to take' };
    const o = a.objects[i]!;
    const t = g.c.objects[o.type]!;
    this.why = treasure ? 'take the boat to Treasure Island' : 'take the boat home';
    return this.actAt(
      'island',
      o.x,
      o.y,
      t.w ?? 1,
      t.h ?? 1,
      (tg) => tg.kind === 'obj' && tg.objIndex === i,
      () => this.isTreasure(g.s.x, g.s.y) === treasure,
      false,
      3,
    );
  }

  /** A cracked rock right beside a find: break it with the pickaxe (an iron one does it) to open the pocket. */
  private breakBeside(area: string, o: MapObj): Plan | null {
    const g = this.g;
    const a = g.c.areas[area]!;
    for (let oi = 0; oi < a.objects.length; oi++) {
      const r = a.objects[oi]!;
      const t = g.c.objects[r.type]!;
      if (!t.node || t.node.regrow || !t.cracked) continue;
      if (Math.abs(r.x - o.x) + Math.abs(r.y - o.y) > 1 || g.s.taken[r.id] || !objLive(g, r)) continue;
      // no way to its side yet (the pocket opens from a land she has not reached): try again later
      if (!this.standable(area, r.x, r.y, t.w ?? 1, t.h ?? 1)) continue;
      const node = t.node;
      if (node.tool && toolTier(g, node.tool) < (node.tier ?? 1))
        return this.toolItem(node.tool, node.tier ?? 1, []) ?? { why: `needs a ${node.tool} to clear the ${r.type}` };
      this.why = `${node.verb} the ${r.type} in the way`;
      return this.actAt(
        area,
        r.x,
        r.y,
        t.w ?? 1,
        t.h ?? 1,
        (tg) => tg.kind === 'obj' && tg.objIndex === oi,
        () => !!g.s.taken[r.id] || !objLive(g, r),
        !!node.tool,
        900,
      );
    }
    return null;
  }

  /** A find behind a cracked rock: bring a creeper from the nearest zone and let its blast open the way. */
  private blastPlan(key: string): Plan | null {
    const g = this.g;
    const a = g.c.areas.island!;
    const o = a.objects.find((x) => !g.s.taken[x.id] && lootOf(x.d, true)[key]);
    if (!o) return null;
    const rock = a.objects.find(
      (r) => g.c.objects[r.type]?.cracked && Math.abs(r.x - o.x) + Math.abs(r.y - o.y) <= 1 && objLive(g, r),
    );
    if (!rock) return null;
    let z: { x: number; y: number; w: number; h: number } | null = null;
    let zNight = false;
    let best = 1e9;
    for (const zz of a.zones) {
      if (!zz.mobs.includes('creeper') || (zz.mode === 'night' && regionLit(g, zz.region))) continue;
      const nx = Math.max(zz.rect.x, Math.min(rock.x, zz.rect.x + zz.rect.w - 1));
      const ny = Math.max(zz.rect.y, Math.min(rock.y, zz.rect.y + zz.rect.h - 1));
      const d = Math.hypot(nx - rock.x, ny - rock.y);
      if (d < best) {
        best = d;
        z = zz.rect;
        zNight = zz.mode === 'night';
      }
    }
    if (!z) return { why: `no creepers come near ${rock.id}` };
    if (zNight && !isNight(g)) return { why: `creepers for ${rock.id} come out at night`, wait: 'night' };
    let spot: [number, number] | null = null;
    let spotD = 1e9;
    for (let i = 0; i < 4; i++) {
      const x = rock.x + DX[i]!;
      const y = rock.y + DY[i]!;
      if (x === o.x && y === o.y) continue;
      if (!this.reach.island?.[y * a.w + x]) continue;
      const d = Math.hypot(x - (z.x + z.w / 2), y - (z.y + z.h / 2));
      if (d < spotD) {
        spotD = d;
        spot = [x, y];
      }
    }
    if (!spot) {
      if (process.env.BLAST_DEBUG)
        for (let i = 0; i < 4; i++) {
          const x = rock.x + DX[i]!;
          const y = rock.y + DY[i]!;
          console.log(
            `  ${x},${y} reach ${this.reach.island?.[y * a.w + x]} terrain ${a.terrain[y]?.[x]} obj ${g.rt.objAt.island?.[y * a.w + x]}`,
          );
        }
      return { why: `no tile beside ${rock.id} to stand on` };
    }
    this.why = `bring a creeper to ${rock.id}`;
    return this.blastGen(rock, spot[0], spot[1], z);
  }

  private creeperNear(r: number): Mob | null {
    const g = this.g;
    let best: Mob | null = null;
    let bestD = r;
    for (const m of g.rt.mobs) {
      if (m.gone || m.calm || m.id !== 'creeper' || m.area !== g.s.area) continue;
      const d = Math.hypot(m.x - g.s.x, m.y - g.s.y);
      if (d < bestD) {
        bestD = d;
        best = m;
      }
    }
    return best;
  }

  /** Steer one step towards a point; true once there. */
  private stepTo(x: number, y: number): boolean {
    const s = this.g.s;
    const dx = x - s.x;
    const dy = y - s.y;
    this.inp.mx = dx > 0.08 ? 1 : dx < -0.08 ? -1 : 0;
    this.inp.my = dy > 0.08 ? 1 : dy < -0.08 ? -1 : 0;
    return !this.inp.mx && !this.inp.my;
  }

  private *blastGen(rock: MapObj, sx: number, sy: number, z: { x: number; y: number; w: number; h: number }): Gen {
    const g = this.g;
    const s = g.s;
    const a = g.c.areas.island!;
    const rx = rock.x + 0.5;
    const ry = rock.y + 0.5;
    let none = 0;
    // one try at a rock takes a few game minutes at most, so a hard one never looks like a stall
    const t0 = s.ticks;
    const late = () => s.ticks - t0 > 60 * 60 * 6;
    for (let tries = 0; tries < 5 && none < 2 && !s.taken[rock.id] && !late(); tries++) {
      // 1. find a creeper: go to the edge of its zone nearest the rock and wait for one to come
      let m = this.creeperNear(9);
      if (!m) {
        const zx = Math.max(z.x + 1, Math.min(z.x + z.w - 2, rock.x));
        const zy = Math.max(z.y + 1, Math.min(z.y + z.h - 2, rock.y));
        if (!(yield* this.goNear('island', zx, zy, 3))) return this.fail(`cannot reach the creepers for ${rock.id}`);
        // other mobs fill the zone: beat them so a creeper can come
        yield* this.fight('island', zx, zy, 6, () => !!this.creeperNear(9) || late(), null);
        for (let n = 0; n < 60 * 30 && !late() && !(m = this.creeperNear(9)); n++) {
          this.waiting = true;
          yield;
        }
        if (!m) {
          none++;
          if (process.env.BLAST_DEBUG)
            console.log(
              `blast ${rock.id} try ${tries}: no creeper near ${s.x.toFixed(1)},${s.y.toFixed(1)} night ${isNight(g)}`,
            );
          continue;
        }
      }
      none = 0;
      const cm = m;
      // 2. lead it to a point 4 to 6 tiles along the wall from the rock, walking on while it keeps up and waiting
      // when it falls behind. Then, with it close behind, walk along the wall to the rock: it comes in from the side
      // and hisses beside the rock, not straight out from it (head on it would hiss just out of reach).
      const px = sx - rock.x === 0 ? 1 : 0;
      const py = sy - rock.y === 0 ? 1 : 0;
      let side: [number, number] | null = null;
      for (const k of [6, -6, 5, -5, 4, -4]) {
        const tx = sx + px * k;
        const ty = sy + py * k;
        if (!this.reach.island?.[ty * a.w + tx] || !this.plan2('island', tx, ty, sx, sy)) continue;
        side = [tx, ty];
        break;
      }
      const lead = side ? this.plan('island', side[0], side[1], false) : this.plan('island', sx, sy, false);
      if (!lead) return this.fail(`cannot reach ${rock.id}`);
      const walkLead = function* (self: Bot, path: number[], wait: boolean): Generator<void, boolean, void> {
        let pi = 0;
        for (let n = 0; n < 60 * 60 * 4 && !cm.gone && !late(); n++) {
          const d = Math.hypot(cm.x - s.x, cm.y - s.y);
          if (pi >= path.length) return true;
          if (d > 12) return false;
          if ((wait && d > 5.5) || cm.st === FUSE_ST) {
            // let it catch up (or calm down if it hisses too soon)
            self.inp.mx = 0;
            self.inp.my = 0;
            if (cm.st === FUSE_ST && d < 4) self.stepTo(s.x - (cm.x - s.x), s.y - (cm.y - s.y));
            self.waiting = true;
            yield;
            continue;
          }
          if (self.stepTo(path[pi]! + 0.5, path[pi + 1]! + 0.5)) pi += 2;
          else yield;
        }
        return false;
      };
      if (!(yield* walkLead(this, lead, true))) continue;
      if (side) {
        // at the side point: let it come close (but not so close it hisses), then go
        for (let n = 0; n < 60 * 20 && !cm.gone && !late(); n++) {
          const d = Math.hypot(cm.x - s.x, cm.y - s.y);
          if (cm.st === FUSE_ST) this.stepTo(s.x - (cm.x - s.x), s.y - (cm.y - s.y));
          else if (d < 3.4) break;
          else this.stepTo(side[0] + 0.5, side[1] + 0.5);
          this.waiting = true;
          yield;
        }
        const run = this.plan2('island', side[0], side[1], sx, sy);
        if (!run || !(yield* walkLead(this, run, false))) continue;
      }
      for (let n = 0; n < 60 * 3 && !this.stepTo(sx + 0.5, sy + 0.5); n++) yield;
      if (process.env.BLAST_DEBUG)
        console.log(
          `blast ${rock.id} try ${tries}: led to ${s.x.toFixed(1)},${s.y.toFixed(1)} want ${sx},${sy}; creeper ${cm.gone ? 'gone' : `${cm.x.toFixed(1)},${cm.y.toFixed(1)} st ${cm.st}`}`,
        );
      if (cm.gone || Math.hypot(cm.x - s.x, cm.y - s.y) > 12) continue;
      // 3. by the rock: wait for the hiss, then step just out of the blast (it goes off) or right away (it calms)
      for (let n = 0; n < 60 * 40 && !cm.gone && !s.taken[rock.id] && !late(); n++) {
        const dx = cm.x - s.x;
        const dy = cm.y - s.y;
        const d = Math.hypot(dx, dy);
        if (cm.st === FUSE_ST) {
          const want = Math.hypot(cm.x - rx, cm.y - ry) <= 2.75 ? 2.8 : 4.2;
          if (process.env.BLAST_DEBUG && cm.fuse > 1.48)
            console.log(
              `  hiss at ${cm.x.toFixed(1)},${cm.y.toFixed(1)}, rock ${Math.hypot(cm.x - rx, cm.y - ry).toFixed(2)} away`,
            );
          if (d < want) this.stepTo(s.x - dx, s.y - dy);
          else {
            this.inp.mx = 0;
            this.inp.my = 0;
          }
          yield;
          if (process.env.BLAST_DEBUG && (cm.gone || cm.st !== FUSE_ST))
            console.log(
              `  after: gone ${cm.gone} st ${cm.st} her ${s.x.toFixed(1)},${s.y.toFixed(1)} d ${Math.hypot(cm.x - s.x, cm.y - s.y).toFixed(2)} taken ${!!s.taken[rock.id]} mode ${g.rt.mode}`,
            );
          continue;
        }
        if (!this.stepTo(sx + 0.5, sy + 0.5)) {
          yield;
          continue;
        }
        if (d > 12) break;
        this.waiting = true;
        yield;
      }
    }
    return !!s.taken[rock.id] || this.fail(`no creeper blast opened ${rock.id}`);
  }

  private needSword(chain: string[]): Plan | null {
    if (toolTier(this.g, 'sword') > 0) return null;
    return this.toolItem('sword', 1, chain) ?? { why: 'no way to get a sword' };
  }

  private viaStall(item: string, need: number, chain: string[]): Plan {
    const g = this.g;
    let first: Plan | null = null;
    for (const stall in g.c.stalls) {
      const rows = g.c.stalls[stall]!.sells;
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]!;
        if (!test(g, row.if) || stockLeft(g, stall, i) <= 0) continue;
        let p: Plan;
        if (row.recipe) {
          if (g.c.recipes[row.recipe]?.out !== item || g.s.recipes.includes(row.recipe)) continue;
          p = this.buyPlan(stall, i, 1, chain);
        } else {
          if (row.item !== item) continue;
          p = this.buyPlan(stall, i, Math.min(need, stockLeft(g, stall, i)), chain);
        }
        if (isGen(p)) return p;
        first ??= p;
      }
    }
    return first ?? { why: `no stall sells ${item} now` };
  }

  private buyPlan(stall: string, i: number, n: number, chain: string[]): Plan {
    const g = this.g;
    const row = g.c.stalls[stall]!.sells[i]!;
    const cost = row.price * n;
    if (stall === 'prizes') {
      if (count(g, 'ticket') < cost) return this.obtain('ticket', cost, chain) ?? { why: 'no tickets' };
    } else if (g.s.emeralds < cost) {
      const e = this.earn(cost - g.s.emeralds, chain);
      if (e) return e;
    }
    const where = this.stallSpot(stall);
    if (!where) {
      const keeper = g.c.stalls[stall]!.keeper;
      if (keeper === g.s.hero) return { why: `the ${stall} stall is kept by ${keeper}, who is the hero now` };
      if (keeper && g.c.chars[keeper] && !charPlace(g, keeper)) return this.absent(keeper);
      const hours = keeper ? this.hours(keeper) : null;
      if (hours) return hours;
      return { why: `cannot get to the stall ${stall} yet`, wait: 'later' };
    }
    this.why = `buy ${row.recipe ? 'the recipe for ' : ''}${row.item} x${n} at ${stall}`;
    const self = this;
    return (function* (): Gen {
      if (!(yield* where)) return false;
      self.inp.cmd = { c: 'buy', stall, i, n };
      yield;
      return true;
    })();
  }

  /** Find enough emeralds: sell spare things, or gather something to sell first. */
  private earn(amount: number, chain: string[]): Plan | null {
    const g = this.g;
    const keep = this.reserved();
    let value = 0;
    const slots: number[] = [];
    g.s.bag.forEach((sl, i) => {
      if (!sl || keep.has(sl.id)) return;
      const d = g.c.items[sl.id]!;
      if (!d.sell || d.pouch) return;
      value += d.sell * sl.n;
      slots.push(i);
    });
    if (value >= amount) {
      const stall = Object.values(g.c.stalls).find((st) => st.buys && this.stallSpot(st.id) !== null);
      if (!stall) return { why: 'no stall buys things' };
      const where = this.stallSpot(stall.id)!;
      this.why = `sell things at ${stall.id} for ${amount} emeralds`;
      const self = this;
      return (function* (): Gen {
        if (!(yield* where)) return false;
        for (const i of slots) {
          const sl = g.s.bag[i];
          if (!sl) continue;
          self.inp.cmd = { c: 'sell', slot: i, n: sl.n };
          yield;
        }
        return true;
      })();
    }
    // gather something that sells, close by
    let best: string | null = null;
    let bestScore = 0;
    for (const id in this.nodesFor) {
      const d = g.c.items[id];
      if (!d?.sell || keep.has(id) || chain.includes(id)) continue;
      const score = d.sell;
      if (score > bestScore) {
        const p = this.viaNode(id, count(g, id) + 1, [...chain, id]);
        if (isGen(p)) {
          best = id;
          bestScore = score;
          p.return(false);
        }
      }
    }
    if (!best) return { why: `needs ${amount} more emeralds and has nothing to sell` };
    return this.viaNode(best, count(g, best) + 4, chain);
  }

  /** Items the active quests still need: never sold. */
  private reserved(): Set<string> {
    const g = this.g;
    const out = new Set<string>();
    for (const id in g.s.quests) {
      const q = g.s.quests[id]!;
      if (q.done) continue;
      for (const st of g.c.quests[id]!.steps.slice(q.step)) {
        if ('item' in st) out.add(st.item);
        if (st.t === 'site') {
          const site = findSite(g, st.site);
          if (site) for (const k in site.needs) out.add(k);
        }
      }
    }
    return out;
  }

  private viaAnimal(item: string): Plan {
    const g = this.g;
    const kinds = Object.values(g.c.animals).filter((a) => a.gives?.item === item);
    if (!kinds.length) return { why: `no animal gives ${item}` };
    let penned = false;
    for (const a of g.s.animals) {
      if (!kinds.some((k) => k.id === a.kind) || !a.pen) continue;
      penned = true;
      if (!a.ready || !this.reachTile(a.area, a.x, a.y)) continue;
      const def = g.c.animals[a.kind]!;
      if (def.gives?.needs && count(g, def.gives.needs) === 0 && toolTier(g, 'bucket') === 0) {
        const p = this.obtain('bucket', 1);
        if (p) return p;
      }
      this.why = `collect ${item} from a ${a.kind}`;
      return this.withAnimal(a.k, () => !g.s.animals.find((x) => x.k === a.k)?.ready);
    }
    if (penned) return { why: `the animals give ${item} in the morning`, wait: 'morning' };
    return { why: `no animal that gives ${item} lives in a pen` };
  }

  private viaCrop(item: string, n: number, chain: string[]): Plan {
    const g = this.g;
    const seeds = Object.values(g.c.items).filter((d) => d.grows?.crop === item);
    if (!seeds.length) return { why: `${item} does not grow from seeds` };
    return this.growPlan(item, n, () => count(g, item) >= n, chain);
  }

  // ------------------------------------------------------------------ step plans

  private sitePlan(id: string): Plan {
    const g = this.g;
    const site = findSite(g, id);
    if (!site) return { why: `no build site ${id}` };
    for (const k in site.needs) {
      const p = this.obtain(k, site.needs[k]!);
      if (p) return p;
    }
    const clear = this.clearWay(site.area, site.at.x, site.at.y);
    if (clear) return clear;
    this.why = `build the site ${id}`;
    const self = this;
    return (function* (): Gen {
      const goals: number[] = [];
      // hand over from outside the site itself: what it builds may land on the tile she stands on
      const r = site.rect;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const x = site.at.x + dx;
          const y = site.at.y + dy;
          if (x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h) continue;
          goals.push(x, y);
        }
      let left = self.free(site.area, goals);
      const isSite = () => {
        const t = findTarget(g);
        return t.kind === 'site' && t.site?.id === id;
      };
      while (left.length && !g.s.flags[site.flag]) {
        if (!(yield* self.walk(site.area, left))) return false;
        const hx = Math.floor(g.s.x);
        const hy = Math.floor(g.s.y);
        // a friend or an animal standing close takes the key press: wait for them, or try another spot
        // (package 69: a mob that came back to her takes Space too: she swings at it until it is beaten)
        for (let k = 0, f = 0; k < 60 && !isSite(); k++) {
          if (foeBeside(g) && f++ < 1200) {
            self.inp.act = true;
            k = Math.min(k, 30);
          } else self.waiting = true;
          yield;
        }
        if (isSite()) {
          for (let k = 0; k < 30 && !g.s.flags[site.flag] && isSite(); k++) {
            self.inp.act = true;
            yield;
          }
        }
        const next: number[] = [];
        for (let i = 0; i < left.length; i += 2)
          if (left[i] !== hx || left[i + 1] !== hy) next.push(left[i]!, left[i + 1]!);
        left = next;
      }
      if (!g.s.flags[site.flag]) return self.fail(`something else is in the way at the site ${id}`);
      return true;
    })();
  }

  private defeatPlan(st: Extract<Step, { t: 'defeat' }>, moved: () => boolean): Plan {
    const g = this.g;
    const sw = this.needSword([]);
    if (sw) return sw;
    const mob = st.mob === 'any' ? null : st.mob;
    const mk = st.mark ? place(g, st.mark) : null;
    if (mk && !this.reachArea(mk.area)) return { why: `cannot reach ${st.mark} yet`, wait: 'later' };
    // package 44b: a board job at a den she has not cleared: walk into its ring (that starts the waves), fight there
    const den = st.mark ? Object.values(g.c.dens).find((d) => d.at === st.mark) : undefined;
    if (den && mk && g.s.dens[den.id] !== 2) {
      this.fightZone = '';
      this.why = `clear the den ${den.id} for ${st.goal ?? 'a job'}`;
      return this.fight(mk.area, mk.x, mk.y, 6, () => moved() || g.s.dens[den.id] === 2, mob);
    }
    // the fight is marked in another area (she made the sword indoors while the mobs wait outside): go to the mark
    // first, as a child following the star does, and look for them there
    if (mk && mk.area !== g.s.area) {
      this.why = `go to ${st.mark} for the fight`;
      return this.goNear(mk.area, mk.x, mk.y, 3);
    }
    // story mobs close by (spawned by the step before at this step's mark), or wanted ones round her now
    const at = mk && mk.area === g.s.area ? mk : { area: g.s.area, x: Math.floor(g.s.x), y: Math.floor(g.s.y) };
    const here = g.rt.mobs.some(
      (m) =>
        !m.gone &&
        !m.calm &&
        (mob === null || m.id === mob) &&
        (!st.zone || m.zone === st.zone) &&
        Math.hypot(m.x - at.x - 0.5, m.y - at.y - 0.5) < 14,
    );
    if (here) {
      this.fightZone = '';
      this.why = `fight ${st.mob} at ${at === mk ? st.mark : 'her side'}`;
      return this.fight(at.area, at.x, at.y, 6, moved, mob);
    }
    const z = this.bestZone(mob, st.zone);
    if (!z) {
      const boss = mob && g.c.mobs[mob]?.role === 'boss' ? (place(g, mob) ?? place(g, mob + '_spawn')) : null;
      if (boss) {
        this.why = `fight ${st.mob}`;
        return this.fight(boss.area, boss.x, boss.y, 6, moved, mob);
      }
      if (mk) {
        this.why = `wait for ${st.mob} at ${st.mark}`;
        return this.fight(mk.area, mk.x, mk.y, 6, moved, mob);
      }
      return { why: `no spawn zone she can reach has ${st.mob}`, wait: 'later' };
    }
    if (z.night && !isNight(g)) {
      if (g.s.area === z.area && this.distTo(z.area, z.x, z.y) < 6)
        return { why: `${st.mob} comes out at night`, wait: 'night' };
      this.why = `go to fight ${st.mob} at night (${z.id})`;
      return this.goNear(z.area, z.x, z.y, 3);
    }
    this.why = `fight ${st.mob} (${z.id})`;
    this.fightZone = z.id;
    return this.fight(z.area, z.x, z.y, 6, () => moved() || (z.night && !isNight(g)), mob);
  }

  /**
   * The spawn zone to fight a mob in: the one named, or the nearest she can reach that has it. Zones that spawn all
   * the time win by day; a night zone in a lit region never spawns.
   */
  private bestZone(
    mob: string | null,
    only?: string,
  ): { area: string; id: string; x: number; y: number; night: boolean } | null {
    const g = this.g;
    let best: { area: string; id: string; x: number; y: number; night: boolean } | null = null;
    let bestD = 1e9;
    for (const area in g.c.areas) {
      if (!this.reachArea(area)) continue;
      for (const z of g.c.areas[area]!.zones) {
        if (only ? z.id !== only : mob !== null && !z.mobs.includes(mob)) continue;
        if (!only && mob === null && !z.mobs.some((m) => g.c.mobs[m]?.role === 'hostile')) continue;
        if (z.mode === 'night' && regionLit(g, z.region)) continue;
        if ((this.zoneBad[z.id] ?? -1) > g.s.ticks) continue;
        const spot = this.zoneSpot(area, z.rect);
        if (!spot) continue;
        // a mob that is friendly by day can only be fought at night (or in the dark mines)
        const calmByDay = mob !== null && !!g.c.mobs[mob]?.dayFriendly && !g.c.areas[area]!.dark;
        const night = z.mode === 'night' || calmByDay;
        const d = this.distTo(area, spot.x, spot.y) + (night && !isNight(g) ? 400 : 0);
        if (d < bestD) {
          bestD = d;
          best = { area, id: z.id, x: spot.x, y: spot.y, night };
        }
      }
    }
    return best;
  }

  private fishPlan(kind: string | undefined, done: () => boolean): Plan {
    const g = this.g;
    if (toolTier(g, 'rod') === 0) {
      const p = this.toolItem('rod', 1, []);
      if (p) return p;
      return { why: 'no way to get a fishing rod' };
    }
    const def = kind ? g.c.fish[kind] : undefined;
    const waters = def ? def.water : (['sea', 'river', 'pond', 'cave'] as const);
    if (def?.time === 'night' && !isNight(g)) return { why: `${kind} bites at night`, wait: 'night' };
    if (def?.time === 'day' && isNight(g)) return { why: `${kind} bites by day`, wait: 'day' };
    const spot = this.waterSpot(waters as readonly string[]);
    if (!spot) return { why: `no water for ${kind ?? 'fish'} she can reach` };
    this.why = `fish for ${kind ?? 'anything'}`;
    const self = this;
    // a fish that bites only at night (or by day) cannot bite once the time turns: she stops casting then, as the
    // fish board's "when" tells her, and the plan waits for its time again (casts after dawn were counted as play)
    const inTime = () => !def?.time || (def.time === 'night') === isNight(g);
    return (function* (): Gen {
      for (let casts = 0; casts < 40 && !done() && inTime(); casts++) {
        const before = g.s.counts.fish ?? 0;
        const ok = yield* self.actAt(
          spot.area,
          spot.x,
          spot.y,
          1,
          1,
          (t) => t.kind === 'water',
          () => (g.s.counts.fish ?? 0) > before,
          false,
          4,
        );
        if (!ok && g.rt.mode === 'play' && !self.atTile(spot)) return false;
        // the float settles; the auto player strikes on the bite
        for (let k = 0; k < 400 && g.rt.mode === 'fishing'; k++) yield;
      }
      return done();
    })();
  }

  private growPlan(crop: string, n: number, done: () => boolean, chain: string[] = []): Plan {
    const g = this.g;
    const s = g.s;
    const seeds = Object.values(g.c.items).filter((d) => d.grows?.crop === crop);
    if (!seeds.length) return { why: `nothing grows into ${crop}` };
    // ripe ones first
    for (const c of s.crops) {
      if (!seeds.some((d) => d.id === c.seed)) continue;
      if (c.age >= g.c.items[c.seed]!.grows!.days) {
        this.why = `pick ${crop}`;
        return this.actAt(
          'island',
          c.x,
          c.y,
          1,
          1,
          (t) => t.kind === 'crop' && t.placed?.x === c.x && t.placed?.y === c.y,
          () => !s.crops.includes(c),
        );
      }
    }
    const growing = s.crops.filter((c) => seeds.some((d) => d.id === c.seed));
    const per = seeds[0]!.grows!.n;
    const want = Math.max(1, Math.ceil(n / per)) - growing.length;
    if (want <= 0) return { why: `${crop} is growing`, wait: 'morning' };
    if (toolTier(g, 'spade') === 0) {
      const p = this.toolItem('spade', 1, chain);
      if (p) return p;
      return { why: 'no way to get a spade to plant with' };
    }
    let seed = seeds.find((d) => count(g, d.id) > 0);
    if (!seed) {
      for (const d of seeds) {
        const p = this.obtain(d.id, want, [...chain, crop]);
        if (isGen(p)) return p;
      }
      return { why: `no seeds for ${crop}` };
    }
    seed = seed!;
    this.why = `plant ${seed.id}`;
    void done;
    return this.plant(seed.id, Math.min(want, count(g, seed.id)));
  }

  private leadPlan(kind: string, pen: string, moved: () => boolean): Plan {
    const g = this.g;
    const def = g.c.animals[kind];
    if (!def) return { why: `no animal ${kind}` };
    const p = this.obtain(def.food, 1);
    if (p) return p;
    const penAt = place(g, pen);
    if (!penAt) return { why: `no pen called ${pen}` };
    let best: (typeof g.s.animals)[number] | null = null;
    let bestD = 1e9;
    for (const a of g.s.animals) {
      if (a.kind !== kind || a.pen || !this.reachTile(a.area, a.x, a.y)) continue;
      if ((this.skipBeast[a.k] ?? -1) > g.s.ticks) continue;
      const d = this.distTo(a.area, a.x, a.y);
      if (d < bestD) {
        bestD = d;
        best = a;
      }
    }
    if (!best) return { why: `no ${kind} to lead home` };
    const a = best;
    this.why = `lead a ${kind} to ${pen}`;
    const self = this;
    return (function* (): Gen {
      if (!(yield* self.holdItem(def.food))) return false;
      if (!(yield* self.goNear(a.area, Math.floor(a.x), Math.floor(a.y), 2))) return false;
      if (!(yield* self.holdItem(def.food))) return false;
      for (let k = 0; k < 120 && !a.led; k++) {
        self.waiting = true;
        yield;
      }
      if (!a.led) return self.fail(`the ${kind} would not follow`);
      // walk slowly into the pen, waiting at every corner so the animal keeps close behind
      let goals = self.free(penAt.area, [penAt.x, penAt.y]);
      if (!goals.length) goals = self.circle(penAt.area, penAt.x, penAt.y, Math.max(0.5, (penAt.r ?? 1.5) - 0.5));
      if (g.s.area !== penAt.area || !goals.length) return self.fail(`cannot lead the ${kind} into another area`);
      const ok = yield* self.leadWalk(a, goals[0]!, goals[1]!);
      for (let k = 0; k < 300 && !a.pen && !moved(); k++) {
        self.waiting = true;
        yield;
      }
      if (!a.pen && !moved()) {
        self.skipBeast[a.k] = g.s.ticks + 60 * 60 * 30;
        return self.fail(
          `the ${kind} did not get into ${pen} (it is at ${a.x.toFixed(1)},${a.y.toFixed(1)}, led ${!!a.led})`,
        );
      }
      return ok || !!a.pen || moved();
    })();
  }

  private miniPlan(st: Extract<Step, { t: 'mini' }>, moved: () => boolean): Plan {
    const g = this.g;
    const mk = st.mark ? place(g, st.mark) : null;
    if (mk) {
      const clear = this.clearWay(mk.area, mk.x, mk.y);
      if (clear) return clear;
    }
    const p = this.playMini(st.game, moved, mk ?? undefined);
    if (isGen(p)) this.why = `play ${st.game}`;
    return p;
  }

  // ------------------------------------------------------------------ chores

  /** Open the mailbox and read every letter. */
  private readMail(): Plan {
    const g = this.g;
    const box = this.findObj((t) => t.interact === 'mailbox');
    if (!box) return { why: 'no mailbox' };
    const self = this;
    const personal = g.c.letters;
    return (function* (): Gen {
      const before = self.nOpen;
      if (
        !(yield* self.actAt(
          box.area,
          box.o.x,
          box.o.y,
          box.w,
          box.h,
          (t) => t.kind === 'obj' && t.objIndex === box.i,
          () => self.nOpen > before,
          false,
          3,
        ))
      )
        return false;
      while (g.s.inbox.length) {
        const id = g.s.inbox[0]!;
        const def = personal[id];
        if (def?.text) self.addWords(def.text.reduce((n, l) => n + words(l), 0));
        else {
          // a letter whose words are Dad's own (personal.json): read, and counted apart (see READ_MAX in solver.ts)
          const n = self.o.letterWords?.[id] ?? 40;
          self.addWords(n);
          const t = self.tally();
          t.own = (t.own ?? 0) + n;
        }
        self.inp.cmd = { c: 'read', letter: id };
        yield;
      }
      return true;
    })();
  }

  private mirror(hero: string): Gen {
    const g = this.g;
    const m = this.findObj((t) => t.interact === 'mirror');
    const self = this;
    return (function* (): Gen {
      if (m) {
        const before = self.nOpen;
        yield* self.actAt(
          m.area,
          m.o.x,
          m.o.y,
          m.w,
          m.h,
          (t) => t.kind === 'obj' && t.objIndex === m.i,
          () => self.nOpen > before,
          false,
          3,
        );
      } else {
        const p = g.s.placed.find((x) => g.c.items[x.item]?.place?.use === 'mirror');
        if (!p) return self.fail('no mirror to swap heroes at');
        const before = self.nOpen;
        yield* self.actAt(
          p.area,
          p.x,
          p.y,
          1,
          1,
          (t) => t.kind === 'placed' && t.placed === p,
          () => self.nOpen > before,
          false,
          3,
        );
      }
      self.inp.cmd = { c: 'hero', id: hero };
      yield;
      if (g.s.hero === hero) {
        self.swapped = true;
        self.mark(`swapped to ${hero}`);
      }
      return g.s.hero === hero;
    })();
  }

  /**
   * The board (package 41) lists up to 3 jobs: walk up to it, press Space (the menu opens), and take this one with
   * 'accept', as the menu does. A job not on the board today waits for the morning.
   */
  private useBoard(kind: 'board' | 'bounty', started: () => boolean, want?: string): Plan {
    const g = this.g;
    const jobs = boardJobs(g);
    const id =
      want && jobs.includes(want)
        ? want
        : kind === 'bounty'
          ? jobs.find((j) => g.c.quests[j]!.kind === 'bounty')
          : undefined;
    if (!id) return { why: `${want ?? 'a poster'} is not on the board today`, wait: 'morning' };
    const b = this.findObj((t) => t.interact === 'board') ?? this.findObj((t) => t.interact === kind);
    if (!b) return { why: `no ${kind} to read` };
    const self = this;
    return (function* (): Gen {
      const opened = self.nOpen;
      const ok = yield* self.actAt(
        b.area,
        b.o.x,
        b.o.y,
        b.w,
        b.h,
        (t) => t.kind === 'obj' && t.objIndex === b.i,
        () => self.nOpen !== opened || started(),
        false,
        3,
      );
      if (!ok) return false;
      self.inp.cmd = { c: 'accept', quest: id };
      yield;
      return started();
    })();
  }

  /** An unfound signpost within a few steps: press Space on it (it is a reward, and quick travel later). */
  private signNear(): Gen | null {
    const g = this.g;
    const s = g.s;
    const a = g.c.areas[s.area]!;
    for (let i = 0; i < a.objects.length; i++) {
      const o = a.objects[i]!;
      const t = g.c.objects[o.type]!;
      if (t.interact !== 'signpost' || !g.rt.live[s.area]?.[i]) continue;
      const id = o.d ?? o.id;
      if (s.signs.includes(id) || (this.skipObj[s.area + ':' + i] ?? -1) >= s.ticks) continue;
      if (Math.abs(o.x + 0.5 - s.x) + Math.abs(o.y + 0.5 - s.y) > 9) continue;
      if (!this.standable(s.area, o.x, o.y, t.w ?? 1, t.h ?? 1)) continue;
      this.why = `look at the signpost ${id}`;
      const self = this;
      const area = s.area;
      return (function* (): Gen {
        const ok = yield* self.actAt(
          area,
          o.x,
          o.y,
          t.w ?? 1,
          t.h ?? 1,
          (tg) => tg.kind === 'obj' && tg.objIndex === i,
          () => s.signs.includes(id),
          false,
          3,
        );
        if (!ok) self.skipObj[area + ':' + i] = s.ticks + 60 * 60 * 5;
        return ok;
      })();
    }
    return null;
  }

  /**
   * When a place cannot be reached, look for things in the way that can be cleared (thorn bushes, a fallen tree,
   * a boulder): plan to clear the first one, getting the right tool first. Null when the way is open or nothing helps.
   */
  private clearWay(area: string, x: number, y: number, near = 2): Plan | null {
    const g = this.g;
    const a = g.c.areas[area]!;
    if (!this.reach[area]) return this.openWay(area);
    if (this.circle(area, x, y, near, true).length) return null;
    const start = area === g.s.area ? { x: Math.floor(g.s.x), y: Math.floor(g.s.y) } : this.entry(area);
    if (!start) return null;
    // a grid where every node that can be used up for good counts as open ground
    const grid = new Uint8Array(this.grid(area));
    const owner = new Int32Array(a.w * a.h).fill(-1);
    const live = g.rt.live[area]!;
    a.objects.forEach((o, i) => {
      const t = g.c.objects[o.type]!;
      if (!t.node || t.node.regrow || t.node.stump || !live[i] || g.s.nodes[o.id] !== undefined) return;
      for (let dy = 0; dy < (t.h ?? 1); dy++)
        for (let dx = 0; dx < (t.w ?? 1); dx++) {
          const k = (o.y + dy) * a.w + o.x + dx;
          grid[k] = 0;
          owner[k] = i;
        }
    });
    let path: number[] | null = null;
    for (let r = 0; r <= 2 && !path; r++)
      for (let dy = -r; dy <= r && !path; dy++)
        for (let dx = -r; dx <= r && !path; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const tx = x + dx;
          const ty = y + dy;
          if (tx < 0 || ty < 0 || tx >= a.w || ty >= a.h || grid[ty * a.w + tx]) continue;
          path = findPath(grid, a.w, a.h, start.x, start.y, tx, ty, 0, 60000);
        }
    if (!path) return null;
    const real = this.grid(area);
    for (let i = 0; i < path.length; i += 2) {
      const k = path[i + 1]! * a.w + path[i]!;
      if (!real[k] || owner[k] < 0) continue;
      const oi = owner[k]!;
      const o = a.objects[oi]!;
      const t = g.c.objects[o.type]!;
      const node = t.node!;
      if (node.tool && toolTier(g, node.tool) < (node.tier ?? 1))
        return (
          this.toolItem(node.tool, node.tool === 'bow' ? 1 : (node.tier ?? 1), []) ?? {
            why: `needs a ${node.tool} to clear the ${o.type}`,
          }
        );
      if (node.tool === 'bow') {
        // package 44a: a web too high for a sword; an arrow brings it down
        if (count(g, 'arrow') <= 0) return this.obtain('arrow', 4) ?? { why: 'no arrows for the high web' };
        this.why = `shoot down the ${o.type} in the way`;
        return this.shootAt(area, o.x, o.y, () => !!g.s.taken[o.id] || !objLive(g, o));
      }
      this.why = `${node.verb} the ${o.type} in the way`;
      return this.actAt(
        area,
        o.x,
        o.y,
        t.w ?? 1,
        t.h ?? 1,
        (tg) => tg.kind === 'obj' && tg.objIndex === oi,
        () => g.s.nodes[o.id] !== undefined || !!g.s.taken[o.id] || !objLive(g, o),
        !!node.tool,
        900,
      );
    }
    return null;
  }

  /** A door into an area is shut: do what opens it (a build site, or the star stones by the hall gate). */
  private openWay(area: string): Plan | null {
    const g = this.g;
    for (const from in this.reach) {
      for (const d of g.c.areas[from]!.doors) {
        if (d.to !== area || !d.if || test(g, d.if) || !this.doorOpen(from, d.x, d.y)) continue;
        const flags = d.if.flag === undefined ? [] : typeof d.if.flag === 'string' ? [d.if.flag] : d.if.flag;
        for (const f of flags) {
          if (g.s.flags[f]) continue;
          for (const a in g.c.areas)
            for (const site of g.c.areas[a]!.sites)
              if (site.flag === f && test(g, site.if)) return this.sitePlan(site.id);
          if (f === 'hall_open') {
            const st = this.findObj((t) => t.interact === 'socket');
            if (st) {
              this.why = 'press Space at the star stones';
              return this.actAt(
                st.area,
                st.o.x,
                st.o.y,
                st.w,
                st.h,
                (t) => t.kind === 'obj' && t.objIndex === st.i,
                () => !!g.s.flags.hall_open,
                false,
                3,
              );
            }
          }
        }
      }
    }
    return null;
  }

  /** Where she first stands when she walks into an area she is not in. */
  private entry(area: string): { x: number; y: number } | null {
    const g = this.g;
    for (const from in this.reach) {
      if (from === area) continue;
      for (const d of g.c.areas[from]!.doors)
        if (d.to === area && (!d.if || test(g, d.if)) && this.doorOpen(from, d.x, d.y)) return { x: d.tx, y: d.ty };
    }
    return null;
  }

  // ------------------------------------------------------------------ doing

  /** Someone who is not about now: back at night, by day, or some morning (the wandering trader comes some days). */
  private absent(who: string): Block {
    const g = this.g;
    const c = g.c.chars[who];
    const night = isNight(g);
    for (const sp of c?.spots ?? []) {
      if (!sp.if || sp.if.night === undefined) continue;
      if (sp.if.night !== night && test(g, { ...sp.if, night: undefined }))
        return { why: `${who} comes out ${sp.if.night ? 'at night' : 'by day'}`, wait: sp.if.night ? 'night' : 'day' };
    }
    const byChance = c?.spots.some((sp) => sp.if?.flag === 'trader');
    return { why: `${who} is not on the island now`, wait: 'morning', patience: byChance ? 15 : 3 };
  }

  /** Someone whose spot today is by day only (indoors at night) or at night only, at the wrong time. */
  private hours(who: string): Block | null {
    const g = this.g;
    const sp = g.c.chars[who]?.spots.find((x) => test(g, x.if));
    if (!sp) return null;
    if (sp.dayOnly && isNight(g)) return { why: `${who} is indoors at night`, wait: 'day' };
    if (sp.nightOnly && !isNight(g)) return { why: `${who} comes out at night`, wait: 'night' };
    return null;
  }

  /** Walk up to a character and press Space. */
  private talk(who: string): Plan {
    const g = this.g;
    const sp = charPlace(g, who);
    if (!sp) return this.absent(who);
    const hours = this.hours(who);
    if (hours) return hours;
    const clear = this.clearWay(sp.area, sp.x, sp.y);
    if (clear) return clear;
    if (!this.reachArea(sp.area) || !this.circle(sp.area, sp.x, sp.y, 3, true).length)
      return { why: `cannot reach ${who} yet`, wait: 'later' };
    return this.talkGen(who);
  }

  private *talkGen(who: string): Gen {
    const g = this.g;
    const s = g.s;
    for (let tries = 0; tries < 8; tries++) {
      const sp = charPlace(g, who);
      if (!sp) return this.fail(`${who} is not on the island now`);
      let n = s.area === sp.area ? this.npc(who) : null;
      if (!n) {
        if (s.area === sp.area && Math.hypot(s.x - sp.x - 0.5, s.y - sp.y - 0.5) < 3) {
          // their spot is right here but they are not (a day or night spot): wait a little
          for (let k = 0; k < 120 && !this.npc(who); k++) {
            this.waiting = true;
            yield;
          }
          n = this.npc(who);
          if (!n) return this.fail(`${who} is not here now`);
        } else {
          if (!(yield* this.goNear(sp.area, sp.x, sp.y, 2))) return false;
          continue;
        }
      }
      const nn = n;
      // stand on a tile beside them where they are the nearest person in front
      const spot = this.talkSpot(nn, tries);
      if (!spot && g.rt.npcs.some((o) => o !== nn && Math.hypot(o.x - nn.x, o.y - nn.y) < 0.6)) {
        // two friends stand on one spot and stay still while she is close: step back and let them wander apart
        yield* this.stepBack(nn.x, nn.y);
        continue;
      }
      if (spot) {
        if (!(yield* this.walk(s.area, [spot.x, spot.y]))) continue;
      } else if (!(yield* this.chase(() => (nn.hidden ? null : nn), 1.05, 60 * 20))) continue;
      // a mob in swing reach takes the key press (Space swings first): deal with it, then talk
      const pest = () => {
        const m = this.nearestMob(null);
        return !!m && Math.hypot(m.x - s.x, m.y - s.y) < 2.4;
      };
      if (pest() && toolTier(g, 'sword') > 0) {
        yield* this.fight(s.area, Math.floor(s.x), Math.floor(s.y), 3, () => !pest(), null);
        continue;
      }
      let d = dirTo(nn.x - s.x, nn.y - s.y);
      for (let k = 0; k < 60 && !this.wouldHit(d, (t) => t.kind === 'npc' && t.k === nn.k); k++) {
        this.waiting = true;
        yield;
        d = dirTo(nn.x - s.x, nn.y - s.y);
      }
      if (!this.wouldHit(d, (t) => t.kind === 'npc' && t.k === nn.k)) continue;
      const before = this.nTalk;
      yield* this.turn(d);
      this.face(d);
      this.inp.act = true;
      yield;
      if (this.nTalk > before) return true;
    }
    return this.fail(`could not get to ${who}`);
  }

  /** A free tile beside a person, facing them, where nobody else is nearer. Tries the nearest first. */
  private talkSpot(n: Npc, skip: number): { x: number; y: number } | null {
    const g = this.g;
    const s = g.s;
    const tx = Math.floor(n.x);
    const ty = Math.floor(n.y);
    const out: { x: number; y: number; d: number }[] = [];
    for (let d = 0; d < 4; d++) {
      const x = tx - DX[d]!;
      const y = ty - DY[d]!;
      if (!this.free(s.area, [x, y]).length) continue;
      const cx = x + 0.5;
      const cy = y + 0.5;
      const mine = Math.hypot(n.x - cx, n.y - cy);
      if (g.rt.npcs.some((o) => o !== n && Math.hypot(o.x - cx, o.y - cy) <= mine + 0.05)) continue;
      out.push({ x, y, d: Math.abs(cx - s.x) + Math.abs(cy - s.y) });
    }
    if (!out.length) return null;
    out.sort((a, b) => a.d - b.d);
    return out[skip % out.length]!;
  }

  /** Walk up to an animal and press Space (collect or pat). */
  private *withAnimal(k: number, until: () => boolean): Gen {
    const g = this.g;
    const s = g.s;
    for (let tries = 0; tries < 12 && !until(); tries++) {
      const a = s.animals.find((x) => x.k === k);
      if (!a) return false;
      // walk over first: the chase is for the last few steps to an animal that ambles about
      if (
        (s.area !== a.area || Math.hypot(a.x - s.x, a.y - s.y) > 6) &&
        !(yield* this.goNear(a.area, Math.floor(a.x), Math.floor(a.y), 2))
      )
        return false;
      const b = g.rt.beasts.find((x) => x.k === k);
      if (!b) return false;
      if (!(yield* this.chase(() => b, 0.9))) {
        // another animal in the pen's gap, or it wandered behind a post: give them a moment to move
        for (let w = 0; w < 180; w++) {
          this.waiting = true;
          yield;
        }
        continue;
      }
      // standing on top of it: nothing is in front of her, so step back first
      if (Math.hypot(b.x - s.x, b.y - s.y) < 0.55) {
        yield* this.stepBack(b.x, b.y);
        if (!(yield* this.chase(() => b, 0.9))) continue;
      }
      this.face(dirTo(b.x - s.x, b.y - s.y));
      this.inp.act = true;
      yield;
    }
    return until();
  }

  /** Walk to a station and craft. */
  private craftAt(recipe: string, times: number): Gen {
    const g = this.g;
    const r = g.c.recipes[recipe]!;
    const self = this;
    return (function* (): Gen {
      if (!stationNear(g, r.at)) {
        const st = self.station(r.at);
        if (!st) return self.fail(`no ${r.at} to craft ${r.out} at`);
        const goals = self.stands(st.area, st.x, st.y, st.w, st.h, null);
        const flat: number[] = [];
        for (let i = 0; i < goals.length; i += 3) flat.push(goals[i]!, goals[i + 1]!);
        if (!(yield* self.walk(st.area, flat))) return false;
      }
      if (!stationNear(g, r.at)) return self.fail(`not close enough to a ${r.at}`);
      const before = g.s.counts.crafted ?? 0;
      self.inp.cmd = { c: 'craft', recipe, times };
      yield;
      if ((g.s.counts.crafted ?? 0) === before) return self.fail(`crafting ${r.out} did nothing`);
      return true;
    })();
  }

  /** Put a thing on the plot (or in the cottage), leaving room round it. */
  private placeItem(item: string, mark?: string): Gen {
    const g = this.g;
    const s = g.s;
    const def = g.c.items[item]!.place!;
    const inside =
      def.where === 'house' ||
      (def.where !== 'plot' && !!mark && (mark.startsWith('cottage') || place(g, mark)?.area === 'cottage'));
    const self = this;
    return (function* (): Gen {
      const area = inside ? 'cottage' : 'island';
      if (inside) {
        const p = place(g, 'start')!;
        if (!(yield* self.goNear('cottage', p.x, p.y, 1))) return false;
      } else {
        const pr = plotRect(g);
        if (!(yield* self.goNear('island', pr.x + Math.floor(pr.w / 2), pr.y + Math.floor(pr.h / 2), 3))) return false;
      }
      for (let tries = 0; tries < 6; tries++) {
        const spot = self.placeSpot(item, area);
        if (!spot) return self.fail(`no room to place ${item}`);
        const w = def.w ?? 1;
        const h = def.h ?? 1;
        const goals = self.stands(area, spot.x, spot.y, w, h, null);
        const flat: number[] = [];
        for (let i = 0; i < goals.length; i += 3) flat.push(goals[i]!, goals[i + 1]!);
        if (!(yield* self.walk(area, flat))) continue;
        if (canPlace(g, item, spot.x, spot.y, 0)) continue;
        const before = s.placed.length;
        self.inp.cmd = { c: 'place', item, x: spot.x, y: spot.y };
        yield;
        if (s.placed.length > before) return true;
      }
      return self.fail(`could not place ${item}`);
    })();
  }

  /** A free spot with a clear ring round it, nearest the hero. */
  private placeSpot(item: string, area: string): { x: number; y: number } | null {
    const g = this.g;
    const s = g.s;
    if (s.area !== area) return null;
    const def = g.c.items[item]!.place!;
    const a = g.c.areas[area]!;
    const w = def.w ?? 1;
    const h = def.h ?? 1;
    const z = area === 'island' ? plotRect(g) : { x: 1, y: 1, w: a.w - 2, h: a.h - 2 };
    const grid = this.grid(area);
    const exit = place(g, area === 'island' ? 'plot_gate' : 'cottage_exit');
    let best: { x: number; y: number } | null = null;
    let bestD = 1e9;
    for (let y = z.y + 1; y + h <= z.y + z.h - 1; y++)
      for (let x = z.x + 1; x + w <= z.x + z.w - 1; x++) {
        if (area === 'island' && ((x - z.x) % 3 !== 1 || (y - z.y) % 3 !== 1)) continue;
        if (exit && Math.abs(exit.x - x) <= 1 + w && Math.abs(exit.y - y) <= 1 + h) continue;
        let ok = true;
        for (let dy = -1; dy <= h && ok; dy++)
          for (let dx = -1; dx <= w && ok; dx++) {
            const tx = x + dx;
            const ty = y + dy;
            if (placedAt(g, area, tx, ty)) ok = false;
            else if (cropAt(g, tx, ty) && area === 'island') ok = false;
            else if (dx >= 0 && dx < w && dy >= 0 && dy < h && grid[ty * a.w + tx]) ok = false;
            else if (area === 'island' && grid[ty * a.w + tx]) ok = false;
          }
        if (!ok || canPlace(g, item, x, y, 0)) continue;
        const d = Math.abs(x - s.x) + Math.abs(y - s.y);
        if (d < bestD) {
          bestD = d;
          best = { x, y };
        }
      }
    if (best) return best;
    // a full plot: any free tile the rules accept that she can stand beside will do, as a child would squeeze it in
    for (let y = z.y + 1; y + h <= z.y + z.h - 1; y++)
      for (let x = z.x + 1; x + w <= z.x + z.w - 1; x++) {
        if (exit && Math.abs(exit.x - x) <= 1 && Math.abs(exit.y - y) <= 1) continue;
        if (canPlace(g, item, x, y, 0) || !this.stands(area, x, y, w, h, null).length) continue;
        const d = Math.abs(x - s.x) + Math.abs(y - s.y);
        if (d < bestD) {
          bestD = d;
          best = { x, y };
        }
      }
    return best;
  }

  /** Plant seeds on the plot, one tile each. */
  private plant(seed: string, n: number): Gen {
    const g = this.g;
    const s = g.s;
    const self = this;
    return (function* (): Gen {
      const pr = plotRect(g);
      if (!(yield* self.goNear('island', pr.x + 3, pr.y + pr.h - 3, 3))) return false;
      for (let k = 0; k < n; k++) {
        const t = self.plantSpot();
        if (!t) return self.fail('no free soil on the plot');
        const goals: number[] = [];
        const dirs: number[] = [];
        for (let d = 0; d < 4; d++) {
          const sx = t.x - DX[d]!;
          const sy = t.y - DY[d]!;
          if (!self.grid('island')[sy * g.c.areas.island!.w + sx]) {
            goals.push(sx, sy);
            dirs.push(d);
          }
        }
        if (!(yield* self.walk('island', goals))) return false;
        if (!(yield* self.holdItem(seed))) return false;
        const hx = Math.floor(s.x);
        const hy = Math.floor(s.y);
        let d = 0;
        for (let i = 0; i < dirs.length; i++) if (goals[i * 2] === hx && goals[i * 2 + 1] === hy) d = dirs[i]!;
        const before = s.crops.length;
        self.face(d);
        yield;
        self.inp.use = true;
        yield;
        if (s.crops.length === before) return self.fail(`planting ${seed} did nothing`);
      }
      return true;
    })();
  }
  private plantSpot(): { x: number; y: number } | null {
    const g = this.g;
    const pr = plotRect(g);
    const grid = this.grid('island');
    const w = g.c.areas.island!.w;
    // the bottom-left corner of the plot, in rows with a walkway between them
    for (let y = pr.y + pr.h - 2; y > pr.y; y -= 2)
      for (let x = pr.x + 1; x < pr.x + pr.w - 1; x++) {
        if (grid[y * w + x] || grid[(y + 1) * w + x]) continue;
        const p = placedAt(g, 'island', x, y);
        if (p && g.c.items[p.item]?.place?.use !== 'soil') continue;
        if (cropAt(g, x, y) || placedAt(g, 'island', x, y + 1, 'object')) continue;
        return { x, y };
      }
    return null;
  }

  /** Put an item in a hotbar slot and pick it. */
  private *holdItem(item: string): Gen {
    const g = this.g;
    const s = g.s;
    let i = s.bag.findIndex((sl) => sl?.id === item);
    if (i < 0) return this.fail(`has no ${item} to hold`);
    if (i >= HOTBAR) {
      let to = s.bag.findIndex((sl, j) => j < HOTBAR && !sl);
      if (to < 0) to = HOTBAR - 1;
      this.inp.cmd = { c: 'move', from: i, to };
      yield;
      i = to;
    }
    if (s.hot !== i) {
      this.inp.cmd = { c: 'hot', i };
      yield;
    }
    return s.bag[s.hot]?.id === item;
  }

  private sleep(): Gen {
    const g = this.g;
    const s = g.s;
    const self = this;
    return (function* (): Gen {
      const day = s.day;
      const bed = s.placed.find((p) => g.c.items[p.item]?.place?.use === 'bed');
      if (bed) {
        const def = g.c.items[bed.item]!.place!;
        const w = bed.rot && bed.rot % 2 ? (def.h ?? 1) : (def.w ?? 1);
        const h = bed.rot && bed.rot % 2 ? (def.w ?? 1) : (def.h ?? 1);
        return yield* self.actAt(
          bed.area,
          bed.x,
          bed.y,
          w,
          h,
          (t) => t.kind === 'placed' && t.placed === bed,
          () => s.day !== day,
          false,
          600,
        );
      }
      const b = self.findObj((t) => t.interact === 'bed');
      if (!b) return self.fail('no bed to sleep in');
      return yield* self.actAt(
        b.area,
        b.o.x,
        b.o.y,
        b.w,
        b.h,
        (t) => t.kind === 'obj' && t.objIndex === b.i,
        () => s.day !== day,
        false,
        600,
      );
    })();
  }

  private *idleGen(n: number): Gen {
    for (let i = 0; i < n; i++) yield;
    return true;
  }
  private idle(n: number, why: string): Gen {
    this.why = why;
    return this.idleGen(n);
  }
  /** Wait until something holds. `pass` marks waiting only for the clock (night or morning), which the cadence leaves out. */
  private *waitFor(until: () => boolean, max: number, pass = false): Gen {
    for (let i = 0; i < max && !until(); i++) {
      this.waiting = true;
      this.passing = pass;
      yield;
    }
    return until();
  }

  /** Fight whatever hostile mob comes near, round a spot, until `until` holds. */
  private *fight(area: string, x: number, y: number, r: number, until: () => boolean, mob: string | null): Gen {
    const boss = !!mob && this.g.c.mobs[mob]?.role === 'boss';
    this.bossFight = boss;
    try {
      return yield* this.fightLoop(area, x, y, r, until, mob);
    } finally {
      this.bossFight = false;
    }
  }
  private *fightLoop(area: string, x: number, y: number, r: number, until: () => boolean, mob: string | null): Gen {
    const g = this.g;
    const s = g.s;
    let quiet = 0;
    const skip = new Map<number, number>();
    let kills = this.tally().mob;
    let lastKill = s.ticks;
    for (let n = 0; n < 60 * 60 * 6; n++) {
      if (until()) return true;
      if (this.tally().mob !== kills) {
        kills = this.tally().mob;
        lastKill = s.ticks;
      } else if (s.ticks - lastKill > 60 * 120 && !(mob && g.c.mobs[mob]?.role === 'boss')) {
        // the zone is full of mobs she cannot hit (spiders are calm by day): try another zone, or the night
        if (this.fightZone) this.zoneBad[this.fightZone] = s.ticks + 60 * 60 * 10;
        return this.fail(`no ${mob ?? 'mob'} beaten in 2 minutes of fighting`);
      }
      if (s.area !== area || Math.hypot(s.x - x - 0.5, s.y - y - 0.5) > r + 8) {
        if (!(yield* this.goNear(area, x, y, 2))) return false;
        continue;
      }
      const m = this.nearestMob(mob, skip, s.ticks);
      if (!m) {
        if (++quiet > 60 * 60 * 3) return this.fail(`no ${mob ?? 'mob'} came for 3 minutes`);
        this.waiting = true;
        yield;
        continue;
      }
      quiet = 0;
      const dx = m.x - s.x;
      const dy = m.y - s.y;
      const d = Math.hypot(dx, dy);
      // a creeper hissing (package 51: the fuse no longer stops when she backs off, it always pops): with time left
      // on the fuse, hit it (a hit puts the fuse out); else step out of the ring (a blast takes it away uncounted)
      const ai = g.c.mobs[m.id]!.ai;
      if ((ai === 'creeper' || ai === 'mini') && m.st === FUSE_ST && d < 4.2) {
        if (m.fuse > 0.7 && d < 2.2) {
          if (d > 1.5) {
            this.inp.mx = dx > 0.2 ? 1 : dx < -0.2 ? -1 : 0;
            this.inp.my = dy > 0.2 ? 1 : dy < -0.2 ? -1 : 0;
          } else {
            this.face(dirTo(dx, dy));
            this.inp.act = true;
            this.inp.hold = true;
          }
          yield;
          continue;
        }
        this.inp.mx = dx > 0.2 ? -1 : dx < -0.2 ? 1 : 0;
        this.inp.my = dy > 0.2 ? -1 : dy < -0.2 ? 1 : 0;
        yield;
        continue;
      }
      // a boss is solid and tall: she cannot stand as close, and her swing reaches it from further out
      const hit = g.c.mobs[m.id]!.role === 'boss' ? 2.1 : 1.4;
      if (d > hit) {
        if (!(yield* this.chase(() => (m.gone ? null : m), hit - 0.1, 90))) {
          // cannot get to this one (across water, up a ledge): leave it for half a minute
          skip.set(m.k, s.ticks + 60 * 30);
          this.waiting = true;
          yield;
        }
        continue;
      }
      // Space would talk to a friend or use a thing in front instead of swinging: sidestep first
      const fd = dirTo(dx, dy);
      const ahead = this.lookAt(fd);
      if (ahead !== 'none' && ahead !== 'swing') {
        this.inp.mx = DY[fd]! !== 0 ? (n & 64 ? 1 : -1) : 0;
        this.inp.my = DX[fd]! !== 0 ? (n & 64 ? 1 : -1) : 0;
        yield;
        continue;
      }
      this.face(fd);
      this.inp.act = true;
      this.inp.hold = true;
      yield;
      // let the swing land before turning again
      for (let k = 0; k < 20 && g.rt.swingT > 0; k++) yield;
    }
    return until();
  }

  private nearestMob(mob: string | null, skip?: Map<number, number>, now = 0): Mob | null {
    const g = this.g;
    let best: Mob | null = null;
    let bestD = 16;
    for (const m of g.rt.mobs) {
      if (m.gone || (skip?.get(m.k) ?? -1) > now) continue;
      const def = g.c.mobs[m.id]!;
      if (def.role !== 'hostile' && def.role !== 'boss') continue;
      if (m.calm && def.ai !== 'ender') continue;
      if (mob && m.id !== mob && def.role !== 'boss') continue;
      const d = Math.hypot(m.x - g.s.x, m.y - g.s.y);
      if (d < bestD) {
        bestD = d;
        best = m;
      }
    }
    // anything attacking her comes first
    if (!best && mob) return this.nearestMob(null, skip, now);
    return best;
  }

  // ------------------------------------------------------------------ walking

  /** Walk to within r tiles of a tile (centre to centre). */
  goNear(area: string, x: number, y: number, r: number): Gen {
    return this.walk(area, this.circle(area, x, y, Math.max(0, r)));
  }
  goTo(area: string, x: number, y: number): Gen {
    return this.walk(area, [x, y]);
  }

  /** Walkable reachable tiles within r of a tile. */
  private circle(area: string, x: number, y: number, r: number, strict = false): number[] {
    const out: number[] = [];
    const R = Math.ceil(r);
    for (let dy = -R; dy <= R; dy++)
      for (let dx = -R; dx <= R; dx++) if (dx * dx + dy * dy <= r * r + 0.01) out.push(x + dx, y + dy);
    const f = this.free(area, out);
    if (f.length || strict) return f;
    // nothing free inside the circle: the nearest free ring outside it
    for (let rr = R + 1; rr <= R + 4; rr++) {
      const ring: number[] = [];
      for (let dy = -rr; dy <= rr; dy++)
        for (let dx = -rr; dx <= rr; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) === rr) ring.push(x + dx, y + dy);
      const fr = this.free(area, ring);
      if (fr.length) return fr;
    }
    return [];
  }

  /** Keep only tiles that can be stood on and reached. */
  private free(area: string, tiles: number[]): number[] {
    const a = this.g.c.areas[area]!;
    const grid = this.grid(area);
    const reach = this.reach[area];
    const out: number[] = [];
    for (let i = 0; i < tiles.length; i += 2) {
      const x = tiles[i]!;
      const y = tiles[i + 1]!;
      if (x < 0 || y < 0 || x >= a.w || y >= a.h) continue;
      const k = y * a.w + x;
      if (grid[k] || (reach && !reach[k])) continue;
      out.push(x, y);
    }
    return out;
  }

  /**
   * Walk to the nearest of some goal tiles (flat x, y list) in an area, crossing doors on the way.
   * `pause` holds her still while it is true (an animal catching up).
   */
  *walk(area: string, goals: number[], pause?: () => boolean): Gen {
    const g = this.g;
    const s = g.s;
    if (!goals.length) return this.fail(`nowhere to stand in ${area}`);
    let fails = 0;
    let travelled = false;
    for (let guard = 0; guard < 40; guard++) {
      if (s.area !== area) {
        const door = this.route(area);
        if (!door) return this.fail(`no way into ${area} from ${s.area}`);
        const before = s.area;
        const ok = yield* this.walkArea([door.x, door.y], true, pause);
        if ((!ok || s.area === before) && ++fails > 4) return this.fail(`could not use the door to ${door.to}`);
        continue;
      }
      // quick travel from a signpost she knows, when it saves a long walk
      if (area === 'island' && !travelled) {
        travelled = true;
        const tr = this.travelPlan(goals);
        if (tr) {
          yield* tr;
          continue;
        }
      }
      if (yield* this.walkArea(goals, false, pause)) return true;
      if (++fails > 4) return this.fail(`could not walk to ${goals[0]},${goals[1]} in ${area}`);
    }
    return false;
  }

  private *walkArea(goals: number[], door: boolean, pause?: () => boolean): Gen {
    const g = this.g;
    const s = g.s;
    const area = s.area;
    const a = g.c.areas[area]!;
    const reach = this.reach[area];
    let gx = -1;
    let gy = -1;
    let bd = 1e9;
    for (let i = 0; i < goals.length; i += 2) {
      const x = goals[i]!;
      const y = goals[i + 1]!;
      if (!door && reach && !reach[y * a.w + x]) continue;
      const d = Math.abs(x + 0.5 - s.x) + Math.abs(y + 0.5 - s.y);
      if (d < bd) {
        bd = d;
        gx = x;
        gy = y;
      }
    }
    if (gx < 0) return false;
    let path = this.plan(area, gx, gy, door);
    if (!path) return false;
    let pi = 0;
    let still = 0;
    let replans = 0;
    let rev = g.rt.worldRev;
    for (let guard = 0; guard < 60 * 60 * 4; guard++) {
      if (s.area !== area) return door;
      const hx = Math.floor(s.x);
      const hy = Math.floor(s.y);
      if (!door && hx === gx && hy === gy && Math.abs(s.x - gx - 0.5) < 0.12 && Math.abs(s.y - gy - 0.5) < 0.12)
        return true;
      if (g.rt.worldRev !== rev || still > 20) {
        if (still > 20 && ++replans > 6) return false;
        rev = g.rt.worldRev;
        path = this.plan(area, gx, gy, door);
        pi = 0;
        if (!path) return false;
        if (still > 20) {
          // shuffle sideways a little before trying again
          for (let k = 0; k < 6; k++) {
            this.inp.mx = (replans & 1) === 0 ? 1 : -1;
            this.inp.my = (replans & 2) === 0 ? 1 : -1;
            yield;
          }
        }
        still = 0;
      }
      let wx: number;
      let wy: number;
      while (pi < path.length && Math.abs(path[pi]! + 0.5 - s.x) < 0.1 && Math.abs(path[pi + 1]! + 0.5 - s.y) < 0.1)
        pi += 2;
      if (pi < path.length) {
        wx = path[pi]! + 0.5;
        wy = path[pi + 1]! + 0.5;
      } else {
        wx = gx + 0.5;
        wy = gy + 0.5;
      }
      if (pause?.()) {
        this.waiting = true;
        yield;
        continue;
      }
      const dx = wx - s.x;
      const dy = wy - s.y;
      this.inp.mx = dx > 0.06 ? 1 : dx < -0.06 ? -1 : 0;
      this.inp.my = dy > 0.06 ? 1 : dy < -0.06 ? -1 : 0;
      // package 68: on the door tile, walk into the door (a step along its front no longer goes through)
      if (door && hx === gx && hy === gy) {
        const into = doorInto(g, area, { x: gx, y: gy });
        if (into) {
          this.inp.mx = into[0];
          this.inp.my = into[1];
        }
      }
      const ox = s.x;
      const oy = s.y;
      yield;
      if (s.area !== area) return door;
      if (Math.abs(s.x - ox) + Math.abs(s.y - oy) < 0.004) still++;
      else still = 0;
    }
    return false;
  }

  /**
   * Walk to a tile with an animal following. It walks straight at her and slides along fences, so she stays at most a
   * tile or so ahead along the path, and steps back towards it when it gets caught on a corner.
   */
  private *leadWalk(b: { x: number; y: number; pen?: string }, gx: number, gy: number): Gen {
    const g = this.g;
    const s = g.s;
    const area = s.area;
    const path = this.plan(area, gx, gy, false);
    if (!path) return false;
    let pi = 0;
    let waited = 0;
    let bestClose = 1e9;
    for (let guard = 0; guard < 60 * 60 * 3 && !b.pen; guard++) {
      const close = Math.hypot(b.x - s.x, b.y - s.y);
      if (pi >= path.length && Math.abs(s.x - gx - 0.5) < 0.12 && Math.abs(s.y - gy - 0.5) < 0.12) return true;
      const wx = (pi < path.length ? path[pi]! : gx) + 0.5;
      const wy = (pi < path.length ? path[pi + 1]! : gy) + 0.5;
      if (pi < path.length && Math.abs(wx - s.x) < 0.1 && Math.abs(wy - s.y) < 0.1) {
        // at a waypoint: let the animal come close before the next one
        if (close > 1.6 && waited < 240) {
          if (close < bestClose - 0.05) {
            bestClose = close;
            waited = 0;
          } else waited++;
          // caught on a fence corner: go back a tile so it has a straight line again
          if (waited > 75 && pi >= 2) {
            pi -= 2;
            waited = 0;
            bestClose = 1e9;
            continue;
          }
          this.waiting = true;
          yield;
          continue;
        }
        waited = 0;
        bestClose = 1e9;
        pi += 2;
        continue;
      }
      const dx = wx - s.x;
      const dy = wy - s.y;
      this.inp.mx = dx > 0.06 ? 1 : dx < -0.06 ? -1 : 0;
      this.inp.my = dy > 0.06 ? 1 : dy < -0.06 ? -1 : 0;
      yield;
      if (s.area !== area) return false;
    }
    return !!b.pen;
  }

  /** Follow something that moves until within `within` tiles of it. */
  private *chase(get: () => { x: number; y: number } | null, within: number, max = 60 * 40): Gen {
    const g = this.g;
    const s = g.s;
    const area = s.area;
    const a = g.c.areas[area]!;
    let path: number[] | null = null;
    let pi = 0;
    let goalX = -99;
    let goalY = -99;
    let still = 0;
    for (let n = 0; n < max; n++) {
      const t = get();
      if (!t || s.area !== area) return false;
      const dx = t.x - s.x;
      const dy = t.y - s.y;
      if (Math.hypot(dx, dy) <= within) return true;
      const tx = Math.floor(t.x);
      const ty = Math.floor(t.y);
      if (!path || Math.abs(tx - goalX) + Math.abs(ty - goalY) > 1 || still > 12) {
        const grid = this.grid(area);
        const k = ty * a.w + tx;
        const was = grid[k]!;
        grid[k] = 0;
        path = findPath(grid, a.w, a.h, Math.floor(s.x), Math.floor(s.y), tx, ty, 0, 30000);
        grid[k] = was;
        if (!path) return false;
        goalX = tx;
        goalY = ty;
        pi = 0;
        still = 0;
      }
      while (pi < path.length && Math.abs(path[pi]! + 0.5 - s.x) < 0.1 && Math.abs(path[pi + 1]! + 0.5 - s.y) < 0.1)
        pi += 2;
      const wx = pi < path.length ? path[pi]! + 0.5 : t.x;
      const wy = pi < path.length ? path[pi + 1]! + 0.5 : t.y;
      const ddx = wx - s.x;
      const ddy = wy - s.y;
      this.inp.mx = ddx > 0.06 ? 1 : ddx < -0.06 ? -1 : 0;
      this.inp.my = ddy > 0.06 ? 1 : ddy < -0.06 ? -1 : 0;
      const ox = s.x;
      const oy = s.y;
      yield;
      if (Math.abs(s.x - ox) + Math.abs(s.y - oy) < 0.004) still++;
      else still = 0;
    }
    return false;
  }

  /**
   * Go to a stand tile beside a thing (a rect of tiles), face it and press Space until `until` holds.
   * `ok` checks that Space would really reach the thing (not a person standing in front of it).
   */
  *actAt(
    area: string,
    x: number,
    y: number,
    w: number,
    h: number,
    ok: (t: Target) => boolean,
    until: () => boolean,
    hold = false,
    limit = 240,
  ): Gen {
    const g = this.g;
    const s = g.s;
    const skip = new Set<number>();
    for (let attempt = 0; attempt < 5; attempt++) {
      if (until()) return true;
      const st = this.stands(area, x, y, w, h, skip);
      if (!st.length) return this.fail(`nowhere to stand by ${x},${y} in ${area}`);
      const flat: number[] = [];
      for (let i = 0; i < st.length; i += 3) flat.push(st[i]!, st[i + 1]!);
      if (!(yield* this.walk(area, flat))) return false;
      const hx = Math.floor(s.x);
      const hy = Math.floor(s.y);
      let d = -1;
      for (let i = 0; i < st.length; i += 3) if (st[i] === hx && st[i + 1] === hy) d = st[i + 2]!;
      if (d < 0) continue;
      if (!this.wouldHit(d, ok)) {
        for (let k = 0; k < 90 && !this.wouldHit(d, ok); k++) {
          this.waiting = true;
          yield;
        }
        if (!this.wouldHit(d, ok)) {
          const t = this.lookAt(d);
          if (t === 'npc' && attempt < 3 && !this.stillNpc(d)) {
            // a friend stands in front and stays still while she is close: step back and let them wander off
            yield* this.stepBack(x + w / 2, y + h / 2);
            continue;
          }
          if (t === 'swing' && attempt < 4) {
            // package 47a: a mob in reach takes Space first (behind a thorn bush, say): swing at it, then try again
            for (let k = 0; k < 120 && this.lookAt(d) === 'swing'; k++) {
              this.face(d);
              this.inp.act = k % 12 === 0;
              yield;
            }
            continue;
          }
          skip.add(hy * 4096 + hx);
          continue;
        }
      }
      yield* this.turn(d);
      this.face(d);
      this.inp.act = true;
      this.inp.hold = hold;
      yield;
      for (let k = 0; k < limit && !until(); k++) {
        if (s.area !== area || Math.floor(s.x) !== hx || Math.floor(s.y) !== hy) break;
        if (!hold && !this.wouldHit(d, ok)) break;
        this.inp.act = true;
        this.inp.hold = hold;
        yield;
      }
      if (until()) return true;
    }
    return until();
  }

  /** Package 44a: stand beside a thing, face it and press X until it comes down (an arrow at a time). */
  private *shootAt(area: string, x: number, y: number, until: () => boolean): Gen {
    const g = this.g;
    const s = g.s;
    for (let attempt = 0; attempt < 5; attempt++) {
      if (until()) return true;
      const st = this.stands(area, x, y, 1, 1, null);
      if (!st.length) return this.fail(`nowhere to stand by ${x},${y} in ${area}`);
      const flat: number[] = [];
      for (let i = 0; i < st.length; i += 3) flat.push(st[i]!, st[i + 1]!);
      if (!(yield* this.walk(area, flat))) return false;
      let d = -1;
      for (let i = 0; i < st.length; i += 3)
        if (st[i] === Math.floor(s.x) && st[i + 1] === Math.floor(s.y)) d = st[i + 2]!;
      if (d < 0) continue;
      this.face(d);
      yield;
      for (let k = 0; k < 240 && !until(); k++) {
        if (count(g, 'arrow') <= 0) return false;
        this.face(d);
        this.inp.fire = true;
        yield;
        for (let w = 0; w < 40 && !until(); w++) yield;
      }
      if (until()) return true;
    }
    return until();
  }

  /** Tiles beside a rect, each with the direction (0 right, 1 left, 2 down, 3 up) that faces it: flat x, y, d. */
  private stands(area: string, x: number, y: number, w: number, h: number, skip: Set<number> | null): number[] {
    const a = this.g.c.areas[area]!;
    const grid = this.grid(area);
    const reach = this.reach[area];
    const out: number[] = [];
    const add = (sx: number, sy: number, d: number) => {
      if (sx < 0 || sy < 0 || sx >= a.w || sy >= a.h) return;
      const k = sy * a.w + sx;
      if (grid[k] || (reach && !reach[k]) || skip?.has(sy * 4096 + sx)) return;
      out.push(sx, sy, d);
    };
    for (let i = 0; i < w; i++) {
      add(x + i, y - 1, 2);
      add(x + i, y + h, 3);
    }
    for (let j = 0; j < h; j++) {
      add(x - 1, y + j, 0);
      add(x + w, y + j, 1);
    }
    return out;
  }
  private standable(area: string, x: number, y: number, w: number, h: number): boolean {
    return this.stands(area, x, y, w, h, null).length > 0;
  }

  /** What Space would reach facing this way. */
  private lookAt(d: number): string {
    const s = this.g.s;
    const old = s.dir;
    s.dir = DIRS[d]!;
    const k = findTarget(this.g).kind;
    s.dir = old;
    return k;
  }

  /** Is a friend who never moves (roam 0) standing in front? Waiting for them is no use. */
  private stillNpc(d: number): boolean {
    const s = this.g.s;
    const old = s.dir;
    s.dir = DIRS[d]!;
    const t = findTarget(this.g);
    s.dir = old;
    if (t.kind !== 'npc') return false;
    const n = this.g.rt.npcs.find((x) => x.k === t.k);
    return !!n && n.roam === 0;
  }

  /** Walk a few tiles away from a spot and wait a little (people stand still while she is close). */
  private *stepBack(cx: number, cy: number): Gen {
    const s = this.g.s;
    const ring = this.circle(s.area, Math.floor(cx), Math.floor(cy), 5);
    const goals: number[] = [];
    for (let i = 0; i < ring.length; i += 2)
      if (Math.hypot(ring[i]! + 0.5 - cx, ring[i + 1]! + 0.5 - cy) > 3.6) goals.push(ring[i]!, ring[i + 1]!);
    if (goals.length) yield* this.walk(s.area, goals);
    for (let k = 0; k < 420; k++) {
      this.waiting = true;
      yield;
    }
    return true;
  }

  private face(d: number): void {
    this.inp.mx = DX[d]!;
    this.inp.my = DY[d]!;
  }

  /** A press is ignored in the middle of a swing: hold the way until she has turned (package 68). */
  private *turn(d: number): Gen {
    for (let k = 0; k < 90 && this.g.s.dir !== DIRS[d]; k++) {
      this.face(d);
      yield;
    }
    return true;
  }

  /** Would Space reach the wanted thing if she faced this way? (Looks only; the game is not changed.) */
  private wouldHit(d: number, ok: (t: Target) => boolean): boolean {
    const s = this.g.s;
    const old = s.dir;
    s.dir = DIRS[d]!;
    const r = ok(findTarget(this.g));
    s.dir = old;
    return r;
  }

  private atTile(p: { area: string; x: number; y: number }): boolean {
    const s = this.g.s;
    return s.area === p.area && Math.abs(Math.floor(s.x) - p.x) + Math.abs(Math.floor(s.y) - p.y) <= 1;
  }

  /** The door in this area that leads towards another area. */
  private route(to: string): { x: number; y: number; to: string } | null {
    const g = this.g;
    const from = g.s.area;
    const prev: Record<string, { area: string; x: number; y: number; to: string } | null> = { [from]: null };
    const queue = [from];
    while (queue.length) {
      const cur = queue.shift()!;
      if (cur === to) break;
      for (const d of g.c.areas[cur]!.doors) {
        if (d.if && !test(g, d.if)) continue;
        if (prev[d.to] !== undefined) continue;
        if (!this.doorOpen(cur, d.x, d.y)) continue;
        prev[d.to] = { area: cur, x: d.x, y: d.y, to: d.to };
        queue.push(d.to);
      }
    }
    if (prev[to] === undefined) return null;
    let step = prev[to]!;
    while (step.area !== from) step = prev[step.area]!;
    return step;
  }
  private doorOpen(area: string, x: number, y: number): boolean {
    const a = this.g.c.areas[area]!;
    const reach = this.reach[area];
    if (!reach) return false;
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d]!;
      const ny = y + DY[d]!;
      if (nx >= 0 && ny >= 0 && nx < a.w && ny < a.h && reach[ny * a.w + nx]) return true;
    }
    return false;
  }

  /** Signpost travel: walk to a known signpost near her, travel to the one nearest the goal. */
  private travelPlan(goals: number[]): Gen | null {
    const g = this.g;
    const s = g.s;
    if (this.o.noTravel || s.area !== 'island' || s.signs.length < 2) return null;
    const gx = goals[0]!;
    const gy = goals[1]!;
    const direct = Math.abs(gx - s.x) + Math.abs(gy - s.y);
    if (direct < 50) return null;
    const a = g.c.areas.island!;
    let from: { i: number; o: MapObj } | null = null;
    let fromD = 1e9;
    let to = '';
    let toD = 1e9;
    for (let i = 0; i < a.objects.length; i++) {
      const o = a.objects[i]!;
      if (g.c.objects[o.type]!.interact !== 'signpost' || !s.signs.includes(o.d ?? o.id)) continue;
      const d = Math.abs(o.x - s.x) + Math.abs(o.y - s.y);
      if (d < fromD && this.standable('island', o.x, o.y, 1, 1)) {
        fromD = d;
        from = { i, o };
      }
      const p = place(g, 'sign_' + (o.d ?? o.id));
      if (p?.area !== 'island') continue;
      const e = Math.abs(gx - p.x) + Math.abs(gy - p.y);
      if (e < toD) {
        toD = e;
        to = o.d ?? o.id;
      }
    }
    if (!from || !to || to === (from.o.d ?? from.o.id) || fromD + toD + 12 > direct) return null;
    const f = from;
    const self = this;
    return (function* (): Gen {
      const before = self.nOpen;
      const ok = yield* self.actAt(
        'island',
        f.o.x,
        f.o.y,
        1,
        1,
        (t) => t.kind === 'obj' && t.objIndex === f.i,
        () => self.nOpen > before,
        false,
        3,
      );
      if (!ok) return false;
      self.inp.cmd = { c: 'travel', sign: to } as Cmd;
      yield;
      return true;
    })();
  }

  // ------------------------------------------------------------------ maps

  /** Collision for planning: the game's collision plus every door tile (doors are only walked into on purpose). */
  private grid(area: string): Uint8Array {
    const g = this.g;
    const rev = g.rt.worldRev;
    let grid = this.grids[area];
    if (grid && this.gridRev[area] === rev) return grid;
    const a = g.c.areas[area]!;
    const solid = g.rt.solid[area]!;
    if (!grid) grid = this.grids[area] = new Uint8Array(solid.length);
    grid.set(solid);
    for (const d of a.doors) grid[d.y * a.w + d.x] = 1;
    this.gridRev[area] = rev;
    return grid;
  }

  private plan(area: string, gx: number, gy: number, door: boolean): number[] | null {
    const g = this.g;
    const a = g.c.areas[area]!;
    const grid = this.grid(area);
    const k = gy * a.w + gx;
    const was = grid[k]!;
    if (door) grid[k] = 0;
    const p = findPath(grid, a.w, a.h, Math.floor(g.s.x), Math.floor(g.s.y), gx, gy, 0, 60000);
    grid[k] = was;
    return p;
  }

  /** A path between two tiles of one area (not from where she stands). */
  private plan2(area: string, fx: number, fy: number, gx: number, gy: number): number[] | null {
    const a = this.g.c.areas[area]!;
    return findPath(this.grid(area), a.w, a.h, fx, fy, gx, gy, 0, 60000);
  }

  /** Which tiles of every area she can walk to from where she stands, through open doors. */
  private computeReach(): void {
    const g = this.g;
    const s = g.s;
    const out: Record<string, Uint8Array> = {};
    const todo: [string, number, number][] = [[s.area, Math.floor(s.x), Math.floor(s.y)]];
    while (todo.length) {
      const [area, x, y] = todo.pop()!;
      const a = g.c.areas[area]!;
      const seen = (out[area] ??= new Uint8Array(a.w * a.h));
      if (seen[y * a.w + x]) continue;
      const grid = this.grid(area);
      const stack = [y * a.w + x];
      seen[y * a.w + x] = 1;
      while (stack.length) {
        const k = stack.pop()!;
        const cx = k % a.w;
        const cy = (k - cx) / a.w;
        for (let d = 0; d < 4; d++) {
          const nx = cx + DX[d]!;
          const ny = cy + DY[d]!;
          if (nx < 0 || ny < 0 || nx >= a.w || ny >= a.h) continue;
          const nk = ny * a.w + nx;
          if (seen[nk] || grid[nk]) continue;
          seen[nk] = 1;
          stack.push(nk);
        }
      }
      for (const d of a.doors) {
        if (d.if && !test(g, d.if)) continue;
        let near = false;
        for (let k = 0; k < 4 && !near; k++) {
          const nx = d.x + DX[k]!;
          const ny = d.y + DY[k]!;
          if (nx >= 0 && ny >= 0 && nx < a.w && ny < a.h && seen[ny * a.w + nx]) near = true;
        }
        if (near) todo.push([d.to, d.tx, d.ty]);
      }
    }
    this.reach = out;
  }
  private reachArea(area: string): boolean {
    return !!this.reach[area];
  }
  /** Can she get next to this spot? */
  private reachTile(area: string, x: number, y: number): boolean {
    const r = this.reach[area];
    if (!r) return false;
    const a = this.g.c.areas[area]!;
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    for (let d = -1; d < 4; d++) {
      const nx = tx + (d < 0 ? 0 : DX[d]!);
      const ny = ty + (d < 0 ? 0 : DY[d]!);
      if (nx >= 0 && ny >= 0 && nx < a.w && ny < a.h && r[ny * a.w + nx]) return true;
    }
    return false;
  }

  /** A rough walking distance: straight line in the same area, plus a penalty for another area. */
  private distTo(area: string, x: number, y: number): number {
    const s = this.g.s;
    if (area === s.area) return Math.abs(x - s.x) + Math.abs(y - s.y);
    return 150 + Math.abs(x - s.x) + Math.abs(y - s.y);
  }

  /** A bag slot holding a flower, a shell or the like that no quest needs (package 57a), or -1. */
  private junkSlot(): number {
    const g = this.g;
    const finds = new Set<string>();
    for (const id in g.c.objects) {
      const n = g.c.objects[id]!.node;
      if (n && !n.tool && n.verb === 'pick') for (const y of n.yield) finds.add(y.item);
    }
    for (let i = g.s.bag.length - 1; i >= 0; i--) {
      const sl = g.s.bag[i];
      if (sl && finds.has(sl.id) && promised(g, sl.id) === 0) return i;
    }
    // package 68: no flower or shell to spare (bag and chests full): put down a mob's drop, as a child would
    const mobDrops = new Set<string>();
    for (const id in g.c.mobs) for (const d of g.c.mobs[id]!.drops) mobDrops.add(d.item);
    const now = new Set<string>();
    for (const qid in g.s.quests) {
      const q = g.s.quests[qid]!;
      const st = q.done ? null : g.c.quests[qid]?.steps[q.step];
      if (st && 'item' in st && st.item) now.add(st.item);
    }
    for (let i = g.s.bag.length - 1; i >= HOTBAR; i--) {
      const sl = g.s.bag[i];
      if (sl && mobDrops.has(sl.id) && !now.has(sl.id) && promised(g, sl.id) === 0) return i;
    }
    return -1;
  }

  private dropOf(item: string): { area: string; x: number; y: number } | null {
    const g = this.g;
    let best: { area: string; x: number; y: number } | null = null;
    let bestD = 1e9;
    for (const d of g.s.drops) {
      if (d.id !== item || !this.reach[d.area]) continue;
      const a = g.c.areas[d.area]!;
      if (!this.reach[d.area]![Math.floor(d.y) * a.w + Math.floor(d.x)]) continue;
      const dd = this.distTo(d.area, d.x, d.y);
      if (dd < bestD) {
        bestD = dd;
        best = d;
      }
    }
    return best;
  }

  /** A reachable spot inside a spawn zone, nearest its middle. */
  private zoneSpot(area: string, r: { x: number; y: number; w: number; h: number }): { x: number; y: number } | null {
    const cx = Math.floor(r.x + r.w / 2);
    const cy = Math.floor(r.y + r.h / 2);
    const R = Math.ceil(Math.max(r.w, r.h) / 2);
    for (let rr = 0; rr <= R; rr++) {
      const ring: number[] = [];
      for (let dy = -rr; dy <= rr; dy++)
        for (let dx = -rr; dx <= rr; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== rr) continue;
          const x = cx + dx;
          const y = cy + dy;
          if (x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h) ring.push(x, y);
        }
      const f = this.free(area, ring);
      if (f.length) return { x: f[0]!, y: f[1]! };
    }
    return null;
  }

  /** The nearest reachable tile of water of the given kinds that has somewhere to stand beside it. */
  private waterSpot(kinds: readonly string[]): { area: string; x: number; y: number } | null {
    const g = this.g;
    const s = g.s;
    let best: { area: string; x: number; y: number } | null = null;
    let bestD = 1e9;
    for (const area in this.reach) {
      const a = g.c.areas[area]!;
      const reach = this.reach[area]!;
      for (let y = 1; y < a.h - 1; y++)
        for (let x = 1; x < a.w - 1; x++) {
          const w = TERRAIN[terrainAt(a, x, y)]?.water;
          if (!w || !kinds.includes(w)) continue;
          let ok = false;
          for (let d = 0; d < 4 && !ok; d++) if (reach[(y + DY[d]!) * a.w + x + DX[d]!]) ok = true;
          if (!ok) continue;
          const dd = (area === s.area ? 0 : 150) + Math.abs(x - s.x) + Math.abs(y - s.y);
          if (dd < bestD) {
            bestD = dd;
            best = { area, x, y };
          }
        }
    }
    return best;
  }

  /** A live crafting station of a kind: her own, or one in the world. */
  private station(kind: 'table' | 'furnace'): { area: string; x: number; y: number; w: number; h: number } | null {
    const g = this.g;
    let best: { area: string; x: number; y: number; w: number; h: number } | null = null;
    let bestD = 1e9;
    for (const p of g.s.placed) {
      const def = g.c.items[p.item]?.place;
      if (def?.use !== kind || !this.reach[p.area]) continue;
      if (!this.standable(p.area, p.x, p.y, def.w ?? 1, def.h ?? 1)) continue;
      const d = this.distTo(p.area, p.x, p.y);
      if (d < bestD) {
        bestD = d;
        best = { area: p.area, x: p.x, y: p.y, w: def.w ?? 1, h: def.h ?? 1 };
      }
    }
    for (const area in this.reach) {
      const a = g.c.areas[area]!;
      a.objects.forEach((o, i) => {
        const t = g.c.objects[o.type]!;
        if (t.interact !== kind || !g.rt.live[area]?.[i]) return;
        if (!this.standable(area, o.x, o.y, t.w ?? 1, t.h ?? 1)) return;
        const d = this.distTo(area, o.x, o.y);
        if (d < bestD) {
          bestD = d;
          best = { area, x: o.x, y: o.y, w: t.w ?? 1, h: t.h ?? 1 };
        }
      });
    }
    return best;
  }

  /** The nearest live map object of a kind. */
  private findObj(
    pred: (t: { interact?: string; id: string }) => boolean,
  ): { area: string; i: number; o: MapObj; w: number; h: number } | null {
    const g = this.g;
    let best: { area: string; i: number; o: MapObj; w: number; h: number } | null = null;
    let bestD = 1e9;
    for (const area in this.reach) {
      const a = g.c.areas[area]!;
      for (let i = 0; i < a.objects.length; i++) {
        const o = a.objects[i]!;
        const t = g.c.objects[o.type]!;
        if (!pred(t) || !g.rt.live[area]?.[i]) continue;
        if (!this.standable(area, o.x, o.y, t.w ?? 1, t.h ?? 1)) continue;
        const d = this.distTo(area, o.x, o.y);
        if (d < bestD) {
          bestD = d;
          best = { area, i, o, w: t.w ?? 1, h: t.h ?? 1 };
        }
      }
    }
    return best;
  }

  /** How to reach a stall: its stand in the world, or its keeper. Returns a task that ends with the shop open. */
  private stallSpot(stall: string): Gen | null {
    const g = this.g;
    // a stall object whose data names this stall
    for (const area in this.reach) {
      const a = g.c.areas[area]!;
      for (let i = 0; i < a.objects.length; i++) {
        const o = a.objects[i]!;
        const t = g.c.objects[o.type]!;
        if ((t.interact !== 'stall' && t.interact !== 'prize') || !g.rt.live[area]?.[i]) continue;
        if ((t.interact === 'prize' ? 'prizes' : o.d) !== stall) continue;
        if (!this.standable(area, o.x, o.y, t.w ?? 1, t.h ?? 1)) continue;
        const before = this.nOpen;
        return this.actAt(
          area,
          o.x,
          o.y,
          t.w ?? 1,
          t.h ?? 1,
          (tg) => tg.kind === 'obj' && tg.objIndex === i,
          () => this.nOpen > before,
          false,
          3,
        );
      }
    }
    const keeper = Object.values(g.c.chars).find((c) => c.service === 'shop:' + stall);
    const sp = keeper && keeper.id !== g.s.hero ? charPlace(g, keeper.id) : null;
    if (keeper && sp && this.reach[sp.area] && this.circle(sp.area, sp.x, sp.y, 3, true).length)
      return this.talkGen(keeper.id);
    return null;
  }

  private npc(id: string): Npc | null {
    for (const n of this.g.rt.npcs) if (n.id === id) return n;
    return null;
  }

  /** Record why a task failed (shown when the run gets stuck) and return false. */
  private fail(why: string): false {
    this.why = `${this.why}: ${why}`;
    if (this.o.verbose) console.log(`  ${clock(this.kid)}  ! ${why}`);
    return false;
  }
}

/** Loot in a chest, dig spot or pickup's data: "emerald:5,potato_ears:1" (stickers and flags are not items). */
/** What a chest, dig spot or pick-up holds; sticker keys ("sticker.<id>") only when asked for. */
function lootOf(d: string | undefined, stickers = false): Record<string, number> {
  const out: Record<string, number> = {};
  for (const part of (d ?? '').split(',')) {
    const [id, n] = part.split(':');
    const k = id?.trim();
    if (!k || (k.startsWith('sticker.') && !stickers) || k.startsWith('flag.')) continue;
    out[k] = n ? Number(n) : 1;
  }
  return out;
}

/** The direction (0 right, 1 left, 2 down, 3 up) that faces along a vector. */
function dirTo(dx: number, dy: number): number {
  return Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 1 : 0) : dy < 0 ? 3 : 2;
}

export function clock(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export type { Placed };
