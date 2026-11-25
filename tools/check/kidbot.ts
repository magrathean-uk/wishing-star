// Kid bot: plays each mini-game on Gentle like a 9-year-old would. It reacts 350 ms late (it acts on what it saw
// 21 steps ago, knowing only its own keys since then), and one decision in ten is a mistake (a wrong or missed press).
// Ten runs per game with different seeds; a game passes when at least 8 end with 2 stars or more and the average
// run is as long as a set piece should be (45 to 90 s; the claw machine 8 to 20 s).
// The two bosses are fought the same way on Gentle: the arena is set up through the rules (enterArea, spawnAt, the
// sword and hearts the story gives her by then, three loaves in the hotbar) and then only step() is called. She
// plays them the way the toasts tell her, and is careless in one go of the boss in ten. A boss passes when every
// fight is won, with at most 1 faint a fight on average, in the time a set piece should take.
// Writes test-results/kidbot.json (seconds per game and per boss) for the playtime report.
// Run: node tools/check/kidbot.ts [--game id] [--boss id] [--sword wood|stone|iron|diamond] [--normal]
import { mkdirSync, writeFileSync } from 'node:fs';
import {
  CLAW,
  CUP_STARS,
  cartStretch,
  HIDE,
  KEEPY,
  MINIS,
  PUDDLES,
  puddleLeap,
  SNOW,
  startMini,
  TARGETS,
} from '../../src/core/minigames.ts';
import { NIGHT_AT } from '../../src/core/cond.ts';
import { findPath, free } from '../../src/core/grid.ts';
import { shieldMax, wear } from '../../src/core/gear.ts';
import { enterArea } from '../../src/core/hero.ts';
import { refreshQuests } from '../../src/core/quests.ts';
import { RING_REACH } from '../../src/core/bosses.ts';
import { FUSE, spawnAt, STRIKE, WINDUP } from '../../src/core/mobs.ts';
import { newGame } from '../../src/core/state.ts';
import { step } from '../../src/core/step.ts';
import type { Game, Input, MiniRt } from '../../src/core/types.ts';
import { content } from '../../src/data/content.ts';

export const DELAY = 21;
export const MISTAKE = 0.1;
const RUNS = 10;
const NEED = 8;
const DT = 1 / 60;
/** Fastest a child presses Space twice. */
export const PRESS_GAP = 9;

export interface Snap {
  t: number;
  n: number[];
  objs: { x: number; y: number; vx: number; vy: number; k: number; a: number }[];
}

/** A small seeded random stream for the mistakes (never Math.random, so runs repeat exactly). */
export class Rng {
  s: number;
  constructor(seed: number) {
    this.s = seed | 0;
  }
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}

/** What the child does this step, from the old picture and their own state. */
export interface Ctx {
  /** what she saw 350 ms ago */
  obs: Snap;
  /** the live game, read only for her own avatar (she knows which keys she pressed) */
  m: MiniRt;
  rng: Rng;
  mem: Record<string, number>;
  inp: Input;
  /** true when this decision is one of the mistakes */
  oops: () => boolean;
  /** a careful child: no hunches, no rushing */
  careful?: boolean;
}
export type Policy = (c: Ctx) => void;

const sign = (v: number, dead: number) => (v > dead ? 1 : v < -dead ? -1 : 0);

// ---------------------------------------------------------------- the seven games

const keepy: Policy = ({ obs, m, inp, oops, mem }) => {
  const [, bx, by, vx, vy] = obs.n as [number, number, number, number, number];
  // where the balloon is now, and where it will be when it comes down to hitting height
  const nx = bx + vx * 0.35;
  const ny = by + vy * 0.35;
  const nvy = Math.min(2.6, vy + 2.3 * 0.35);
  const fall = nvy > 0.3 ? Math.max(0, (5.4 - ny) / nvy) : 0.6;
  let target = nx + vx * Math.min(fall, 1.2);
  target = Math.max(0.6, Math.min(KEEPY.w - 0.6, target));
  const hx = m.n[0]!;
  inp.mx = sign(target - hx, 0.25);
  if (ny > KEEPY.hitTop + 0.15 && nvy > -0.5 && Math.abs(hx - nx) < 1.1 && m.n[6]! <= 0 && !mem.lock) {
    mem.lock = 1;
    if (!oops()) inp.act = true;
  }
  // the balloon is on its way up again: ready for the next hit
  if (nvy < -0.5) mem.lock = 0;
};

const puddles: Policy = ({ obs, m, inp, oops, mem, rng }) => {
  if (m.n[4] === 1) {
    // the timing bar: she watches the marker (350 ms late, so she leads it) and presses near the middle
    if (obs.n[4] !== 1 || obs.n[6]! < 0.5) return;
    // a mistake: she just presses, wherever the marker is
    if (mem.barAim === undefined) mem.barAim = oops() ? rng.next() : 0.5 + (rng.next() * 2 - 1) * 0.15;
    const u = ((obs.n[6]! + 0.35) / PUDDLES.barSweep) % 2;
    if (Math.abs((u < 1 ? u : 2 - u) - mem.barAim) < 0.05) inp.act = true;
    return;
  }
  if (m.n[4] !== 0 || m.n[1]! > 0) return;
  const pos = obs.n[0]! + PUDDLES.speeds[m.n[11]!]! * 0.35;
  const next = obs.objs.find((p) => p.a === 0 && p.x + 0.9 > pos + 2.0);
  if (!next) return;
  const land = puddleLeap(next.vy);
  if (mem.wait === undefined) mem.wait = (rng.next() * 2 - 1) * 0.08;
  if (pos + land >= next.x - 0.25 + mem.wait && pos + land < next.x + 0.9) {
    mem.wait = undefined as unknown as number;
    if (oops()) {
      // a mistake: jump a beat too late
      mem.late = 14;
      return;
    }
    inp.act = true;
  }
  if (mem.late && --mem.late === 0) inp.act = true;
};

/** How often she peeks into a place on a hunch, without waiting to hear a giggle. */
const HUNCH = 0.3;
const hide: Policy = ({ obs, m, inp, oops, mem, rng, careful }) => {
  // counting, peeking or cheering: nothing to do
  if (m.n[6] !== 1 || obs.n[6] !== 1 || obs.n[5] !== m.n[5]) return;
  const hx = m.n[0]!;
  const hy = m.n[1]!;
  const spots = obs.objs;
  const forget = () => {
    for (let i = 0; i < 16; i++) mem['quiet' + i] = 0;
  };
  if (mem.round !== m.n[5]) {
    // a new round: everyone hid again
    mem.round = m.n[5]!;
    mem.heard = -1;
    mem.sawMove = 0;
    forget();
    for (let i = 0; i < 16; i++) mem['came' + i] = 0;
  }
  // a friend ran to a new place: most times she sees where to, and nowhere is surely empty any more
  if (obs.n[13]! >= 0 && !mem.sawMove) {
    mem.sawMove = 1;
    forget();
    if (!oops()) mem.heard = obs.n[13]!;
  }
  // a loud giggle from across the lawn: she heads for it
  const loud = spots.findIndex((o) => o.k === 0 && o.vy > 0);
  if (loud >= 0) mem.heard = loud;
  if (mem.heard! >= 0 && spots[mem.heard!]?.k !== 0) mem.heard = -1;
  // remember spots she stood by without hearing a giggle
  spots.forEach((o, i) => {
    const near = Math.abs(o.x - hx) <= 1 && Math.abs(o.y - hy) <= 1;
    if (near && o.k === 0 && o.a === 0) mem['quiet' + i] = (mem['quiet' + i] ?? 0) + DT;
  });
  const giggle = spots.findIndex((o) => o.k === 0 && o.a > 0);
  let target = giggle >= 0 ? giggle : mem.heard!;
  if (target < 0) {
    let best = 1e9;
    spots.forEach((o, i) => {
      if (o.k !== 0 || (mem['quiet' + i] ?? 0) > 1) return;
      const d = Math.abs(o.x - hx) + Math.abs(o.y - hy);
      if (d < best) {
        best = d;
        target = i;
      }
    });
  }
  if (target < 0) {
    // heard nothing anywhere: forget and look again
    forget();
    return;
  }
  const t = spots[target]!;
  const adj = Math.abs(t.x - hx) + Math.abs(t.y - hy) === 1;
  if (adj) {
    // she looks when she hears a giggle there, or sometimes just on a hunch
    if (!mem['came' + target]) mem['came' + target] = !careful && rng.next() < HUNCH ? 2 : 1;
    const sure = target === giggle || target === mem.heard || mem['came' + target] === 2;
    if (sure && (mem.pressT ?? 0) <= 0) {
      // one look, then a short pause before looking again (a missed press just comes a moment later)
      mem.pressT = 30;
      if (oops()) return;
      inp.act = true;
    }
    mem.pressT = (mem.pressT ?? 0) - 1;
    return;
  }
  mem.pressT = 0;
  // one step towards a free cell beside the spot (breadth-first over the little grid)
  const blocked = (x: number, y: number) =>
    x < 0 || y < 0 || x >= HIDE.w || y >= HIDE.h || m.objs.some((o) => o.x === x && o.y === y);
  const goal = (x: number, y: number) => Math.abs(t.x - x) + Math.abs(t.y - y) === 1;
  const prev = new Map<number, number>();
  const start = hy * 16 + hx;
  const queue = [start];
  prev.set(start, -1);
  let end = -1;
  while (queue.length) {
    const k = queue.shift()!;
    const x = k % 16;
    const y = (k - x) / 16;
    if (goal(x, y)) {
      end = k;
      break;
    }
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx;
      const ny = y + dy;
      const nk = ny * 16 + nx;
      if (blocked(nx, ny) || prev.has(nk)) continue;
      prev.set(nk, k);
      queue.push(nk);
    }
  }
  if (end < 0) return;
  let k = end;
  while (prev.get(k) !== start && prev.get(k) !== -1) k = prev.get(k)!;
  const nx = k % 16;
  const ny = (k - nx) / 16;
  inp.mx = nx - hx;
  inp.my = inp.mx ? 0 : ny - hy;
  // a mistake: now and then a step goes the wrong way (one decision per step on the grid)
  if (m.n[4]! <= 0 && oops()) {
    inp.mx = -inp.mx;
    inp.my = -inp.my;
  }
};

const race: Policy = ({ m, inp, oops, mem }) => {
  // she runs straight at the next flag (she does not steer round puddles or look for boost pads)
  const gate = m.objs[m.n[2]!];
  if (!gate || gate.k >= 10 || m.n[5]! > 0) return;
  // (the last flag of a lap is the line: she runs on over it)
  const line = m.objs[m.n[2]! + 1]?.k !== 0 && m.objs[m.n[2]! + 1]?.k !== 1;
  const dx = gate.x + (line ? 2 : 0) - m.n[0]!;
  const dy = gate.y - m.n[1]!;
  inp.mx = sign(dx, 0.3);
  inp.my = sign(dy, 0.3);
  if ((mem.decide ?? 0) <= 0) {
    mem.decide = 18;
    mem.wrong = oops() ? 1 : 0;
  }
  mem.decide!--;
  if (mem.wrong) {
    inp.mx = -inp.mx;
    inp.my = -inp.my;
  }
};

const claw: Policy = ({ obs, m, inp, oops, mem, rng, careful }) => {
  if (m.n[1] !== 0) {
    mem.try = -1;
    return;
  }
  if (mem.try !== m.n[4]) {
    // a new try: she picks the prize she wants (first any of them, after a miss the nearest)
    mem.try = m.n[4]!;
    let best = Math.floor(rng.next() * obs.objs.length);
    if (m.n[4]! > 0)
      for (let i = 0; i < obs.objs.length; i++)
        if (Math.abs(obs.objs[i]!.x - m.n[0]!) < Math.abs(obs.objs[best]!.x - m.n[0]!)) best = i;
    mem.target = obs.objs[best]?.x ?? CLAW.w / 2;
    // a mistake: she misjudges where the prize is
    if (oops()) mem.target += (rng.next() < 0.5 ? -1 : 1) * 0.7;
    // half the time she cannot wait for the claw to stop swinging
    mem.rush = !careful && rng.next() < 0.5 ? 1 : 0;
    mem.still = 0;
  }
  const d = mem.target! - m.n[0]!;
  inp.mx = sign(d, 0.1);
  if (inp.mx) {
    mem.still = 0;
    return;
  }
  mem.still = (mem.still ?? 0) + 1;
  if (mem.rush ? mem.still > 12 : mem.still > 55) inp.act = true;
};

const snowball: Policy = ({ obs, m, inp, oops, mem }) => {
  // (a ball coming back at her: she does not step aside, she is busy aiming)
  const hx = m.n[0]!;
  let best: Snap['objs'][number] | null = null;
  let bestX = 0;
  let bestD = 1e9;
  for (const o of obs.objs) {
    if (o.k === 3) {
      // the snowman slides along: she aims ahead of him
      if (o.vy || o.a < 1) continue;
      const lead = o.x + o.vx * (0.35 + (SNOW.h - 1.2 - o.y) / 9 + Math.abs(o.x - hx) / 8);
      if (lead < 0.6 || lead > SNOW.w - 0.6) continue;
      best = o;
      bestX = lead;
      break;
    }
    if (o.k !== 0 || o.vx || o.a < 0.7) continue;
    if (mem['aim' + Math.round(o.x * 10)] && m.t - mem['aim' + Math.round(o.x * 10)]! < 0.9) continue;
    const d = Math.abs(o.x - hx);
    if (d < bestD) {
      bestD = d;
      best = o;
      bestX = o.x;
    }
  }
  if (!best) return;
  inp.mx = sign(bestX - hx, 0.25);
  if (Math.abs(bestX - hx) < 0.35 && m.n[1]! <= 0) {
    if (best.k === 0) mem['aim' + Math.round(best.x * 10)] = m.t;
    if (oops()) return;
    inp.act = true;
  }
};

const minecart: Policy = ({ obs, m, inp, oops, mem }) => {
  const dist = obs.n[1]! + obs.n[2]! * 0.35;
  const lane = m.n[0]!;
  // in the dark tunnel she sees less far ahead, unless a lantern is lit
  const far = cartStretch(dist) === 1 && obs.n[6]! <= 0 ? 9 : 14;
  const ahead = obs.objs.filter((o) => o.a === 0 && o.y > dist + 0.6 && o.y < dist + far).sort((a, b) => a.y - b.y);
  let want = lane;
  const first = ahead[0];
  if (first) {
    const row = ahead.filter((o) => o.y - first.y < 0.1);
    const prize = row.find((o) => o.k !== 0);
    if (prize) want = prize.x;
    else if (row.some((o) => o.x === lane)) {
      // a rock on her rail: the clear rail with something to grab farther on, else the nearest clear one
      const clear = [0, 1, 2].filter((l) => !row.some((o) => o.x === l));
      const gem = ahead.find((o) => o.k !== 0 && clear.includes(o.x));
      want = gem ? gem.x : clear.sort((a, b) => Math.abs(a - lane) - Math.abs(b - lane))[0]!;
    }
  }
  if (want !== mem.want) {
    mem.want = want;
    mem.wrong = oops() ? 1 : 0;
  }
  if (want !== lane && m.n[4]! <= 0) inp.mx = Math.sign(want - lane) * (mem.wrong ? -1 : 1);
  if (mem.wrong && want !== lane && m.n[4]! <= 0) mem.wrong = 0;
};

// Archery (package 47a): she picks the gold target first, else the one she can line up with soonest, walks under it
// (or level with it on a flank), turns to face it and shoots a little ahead of a slider.
const targets: Policy = ({ obs, m, inp, oops, mem }) => {
  const T = TARGETS;
  const hx = m.n[0]!;
  const hy = m.n[1]!;
  const face = m.n[2]!;
  const ay = hy - 0.4;
  let best: Snap['objs'][number] | null = null;
  let bestCost = 1e9;
  for (const o of obs.objs) {
    if ((o.k !== 0 && o.k !== 2) || o.a < 0.45) continue;
    const top = o.x >= T.top.x0 - 0.5 && o.x <= T.top.x1 + 0.5;
    const cost = (top ? Math.abs(o.x - hx) : Math.abs(o.y - ay) + 0.6) - (o.k === 2 ? 3 : 0) + (o.a < 1.2 ? 1 : 0);
    if (cost < bestCost) {
      bestCost = cost;
      best = o;
    }
  }
  if (!best) {
    // nothing up: drift back to the middle, facing the far side
    inp.mx = sign(T.w / 2 - hx, 1.5);
    if (face !== 0 && !inp.mx) inp.my = -1;
    return;
  }
  const top = best.x >= T.top.x0 - 0.5 && best.x <= T.top.x1 + 0.5;
  const ready = m.n[3]! <= 0;
  if (top) {
    const flight = Math.max(0, ay - best.y) / T.arrow;
    let tx = best.x + best.vx * (0.35 + flight);
    tx = Math.max(T.top.x0, Math.min(T.top.x1, tx));
    inp.mx = sign(tx - hx, 0.15);
    if (face !== 0) inp.my = -1;
    else if (Math.abs(tx - hx) < 0.35 && ready) {
      if (!oops()) inp.act = true;
      else mem.miss = (mem.miss ?? 0) + 1;
    }
    return;
  }
  const left = best.x < T.w / 2;
  const flight = Math.abs(hx - best.x) / T.arrow;
  let ty = best.y + best.vy * (0.35 + flight);
  ty = Math.max(T.side.y0, Math.min(T.side.y1, ty));
  const dy = ty - ay;
  if (Math.abs(dy) > 0.3) {
    inp.my = sign(dy, 0.15);
    return;
  }
  const want = left ? 1 : 2;
  if (face !== want) inp.mx = left ? -1 : 1;
  else if (ready) {
    if (!oops()) inp.act = true;
    else mem.miss = (mem.miss ?? 0) + 1;
  }
};

/** The child's way of playing each mini-game (the timed play bot in tools/bot/playbot.ts uses them too). */
export const POLICY: Record<string, Policy> = { keepy, puddles, hide, race, claw, snowball, minecart, targets };

/** How long each game should take her, in seconds (the average of the runs must be inside). */
export const GAME_SECS: Record<string, [number, number]> = {
  keepy: [45, 90],
  puddles: [45, 90],
  hide: [45, 90],
  race: [45, 90],
  claw: [8, 20],
  snowball: [45, 90],
  minecart: [45, 90],
  targets: [45, 90],
};
/** Cups (package 47a): gold must be won within this many goes on average. */
const CUP_TRIES = 3;

// ---------------------------------------------------------------- the harness

export interface GameResult {
  game: string;
  wins: number;
  runs: number;
  stars: number[];
  seconds: number[];
}

/** One run. `mistake` 0 plays as a careful child would (the tests use it). */
export function playOne(
  game: string,
  seed: number,
  mistake = MISTAKE,
  cup = 0,
): { stars: number; secs: number; score: number; n: number[] } {
  const g = newGame(content, { seed, opts: { gentle: true } });
  startMini(g, game, null, '', cup);
  const m = g.rt.mini!;
  const rng = new Rng(seed * 7919 + 13);
  const hist: Snap[] = [];
  const mem: Record<string, number> = {};
  const inp: Input = { mx: 0, my: 0, act: false, hold: false, back: false, use: false, emote: false, cmd: null };
  let lastPress = -99;
  let start = 0;
  let end = 0;
  for (let i = 0; i < 60 * 180; i++) {
    inp.mx = 0;
    inp.my = 0;
    inp.act = false;
    if (g.rt.mode !== 'mini' || !g.rt.mini) break;
    if (m.st === 0) {
      // the intro card: she presses Space to start
      if (m.t > 0.6) inp.act = true;
    } else if (m.st === 2) {
      end = i;
      break;
    } else {
      if (!start) start = i;
      hist.push({ t: m.t, n: m.n.slice(), objs: m.objs.map((o) => ({ ...o })) });
      if (hist.length > DELAY + 1) hist.shift();
      const obs = hist[0]!;
      POLICY[game]!({ obs, m, rng, mem, inp, oops: () => rng.next() < mistake, careful: mistake === 0 });
      if (inp.act) {
        if (i - lastPress < PRESS_GAP) inp.act = false;
        else lastPress = i;
      }
    }
    step(g, inp);
    g.ev.length = 0;
  }
  if (process.env.KIDBOT_DEBUG)
    console.log(game, seed, 'score', m.score, 'n', m.n.map((v) => Math.round(v * 100) / 100).join(','));
  return {
    stars: m.st === 2 ? m.stars : 0,
    secs: start && end ? (end - start) / 60 : 0,
    score: m.score,
    n: m.n.slice(),
  };
}

// ---------------------------------------------------------------- the two bosses

interface Arena {
  /** where she stands when the story spawns the boss (the edge of the quest's "reach" circle) */
  area: string;
  x: number;
  y: number;
  /** the story place the boss is spawned at */
  at: string;
  /** hearts she has by then: ten to start and two more with each shard won, in half hearts */
  maxHp: number;
  flags: string[];
  win: string;
  /** how long the fight should take a child, in seconds (the average of the runs must be inside) */
  secs: [number, number];
  /** the gear a child has by then (the story's pieces only: no upgrades, no armour she was never asked for) */
  gear: string[];
}
const SHARDS = (n: number) => Array.from({ length: n }, (_, i) => `shard${i + 1}`);
const ARENAS: Record<string, Arena> = {
  // Chapter 6: shard 5 won and the iron sword made; she walks into the big cavern from the west
  spider_jockey: {
    area: 'mine3',
    x: 16.5,
    y: 14.5,
    at: 'jockey_spawn',
    maxHp: 20,
    flags: ['cart_done', ...SHARDS(5)],
    win: 'jockey_beaten',
    secs: [45, 75],
    // the leather set from chapter 5 and the bow from chapter 4; the iron helmet comes later in the Mine
    gear: ['iron_sword', 'bow', 'leather_helmet', 'leather_armour'],
  },
  // Chapter 7: shard 6 won; she walks into the hall from the south door
  creeper_king: {
    area: 'hall',
    x: 13.5,
    y: 16.4,
    at: 'king',
    maxHp: 22,
    flags: ['jockey_beaten', ...SHARDS(6)],
    win: 'king_calm',
    secs: [70, 100],
    // the diamond sword of chapter 7, the iron helmet of chapter 6, still the leather armour
    gear: ['diamond_sword', 'bow', 'iron_helmet', 'leather_armour'],
  },
};
const FIGHT_LIMIT = 60 * 240;
/** A boss must be won every time, with at most this many faints a fight on average. */
const BOSS_FAINTS = 1;
const SWORDS = ['wood', 'stone', 'iron', 'diamond'];

interface BMob {
  id: string;
  boss: boolean;
  x: number;
  y: number;
  st: number;
  clip: string;
  phase: number;
  calm: boolean;
  /** fuse seconds left, or -1 when not fused */
  fuse: number;
}
interface BShot {
  k: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  kind: string;
  r: number;
}
/** What she saw: herself, every mob and every shot as they were 350 ms ago. */
interface BSnap {
  hp: number;
  sx: number;
  sy: number;
  mobs: BMob[];
  shots: BShot[];
}
interface BCtx {
  g: Game;
  obs: BSnap;
  rng: Rng;
  mem: Record<string, number>;
  inp: Input;
  oops: () => boolean;
}

const hyp = Math.hypot;
const reachOf = (g: Game, id: string) => 1.75 + ((g.c.mobs[id]?.tall ?? 0) > 2.5 ? 0.6 : 0);

/** Walk straight at a point (or away from it). */
function goto(inp: Input, sx: number, sy: number, tx: number, ty: number, away = false): void {
  const k = away ? -1 : 1;
  inp.mx = sign(k * (tx - sx), 0.15);
  inp.my = sign(k * (ty - sy), 0.15);
}

/** Walk round the furniture to a point: the game's own path finder, then straight at the farthest corner she can see. */
function walkTo(g: Game, inp: Input, tx: number, ty: number, near = 0): void {
  const s = g.s;
  const a = g.c.areas[s.area]!;
  const path = findPath(
    g.rt.solid[s.area]!,
    a.w,
    a.h,
    Math.floor(s.x),
    Math.floor(s.y),
    Math.floor(tx),
    Math.floor(ty),
    near,
  );
  if (!path || path.length === 0) {
    goto(inp, s.x, s.y, tx, ty);
    return;
  }
  let wx = path[0]! + 0.5;
  let wy = path[1]! + 0.5;
  for (let k = 0; k < Math.min(path.length / 2, 10); k++) {
    const px = path[k * 2]! + 0.5;
    const py = path[k * 2 + 1]! + 0.5;
    const n = Math.ceil(hyp(px - s.x, py - s.y) / 0.2);
    let clear = true;
    for (let j = 1; j < n && clear; j++)
      clear = free(g, s.area, s.x + ((px - s.x) * j) / n, s.y + ((py - s.y) * j) / n, 0.3);
    if (clear) {
      wx = px;
      wy = py;
    }
  }
  goto(inp, s.x, s.y, wx, wy);
}

/** Walk up to the mob, face it and swing when it is in reach. Returns true when she is in reach. */
function strike(c: BCtx, m: BMob): boolean {
  const { g, inp, mem, oops } = c;
  const s = g.s;
  const dx = m.x - s.x;
  const dy = m.y - s.y;
  if (hyp(dx, dy) > reachOf(g, m.id) - 0.3) {
    walkTo(g, inp, m.x, m.y, 1);
    return false;
  }
  // in reach: turn towards it along the longer side, and swing
  if (Math.abs(dx) > Math.abs(dy)) inp.mx = Math.sign(dx);
  else inp.my = Math.sign(dy);
  if (mem.swingWait! <= 0) {
    mem.swingWait = PRESS_GAP;
    // a mistake: the press is missed and she tries again a moment later
    if (!oops()) inp.act = true;
  }
  return true;
}

/** Sidestep an arrow she can see coming (from the old picture: its line does not change). */
function dodgeShots(c: BCtx): boolean {
  const { g, obs, mem, inp, rng, oops } = c;
  const s = g.s;
  for (const sh of obs.shots) {
    if (sh.kind !== 'arrow') continue;
    const sp = hyp(sh.vx, sh.vy) || 1;
    const ux = sh.vx / sp;
    const uy = sh.vy / sp;
    const rx = s.x - sh.x;
    const ry = s.y - 0.5 - sh.y;
    const along = rx * ux + ry * uy;
    const side = rx * -uy + ry * ux;
    if (along < -0.5 || along > 10 || Math.abs(side) > 1.2) continue;
    const key = 'arrow' + sh.k;
    // she may simply not notice this one
    if (mem[key] === undefined) mem[key] = oops() ? 1 : 0;
    if (mem[key] === 1) continue;
    const dir = side === 0 ? (rng.next() < 0.5 ? -1 : 1) : Math.sign(side);
    inp.mx = sign(-uy * dir, 0.3);
    inp.my = sign(ux * dir, 0.3);
    return true;
  }
  return false;
}

/** The spot behind the pillar nearest to her, seen from a foe: where a child told "hide behind a pillar" goes. */
function hideSpot(g: Game, fx: number, fy: number): [number, number] | null {
  const s = g.s;
  let best: [number, number] | null = null;
  let bd = 1e9;
  for (const o of g.c.areas[s.area]!.objects) {
    if (o.type !== 'pillar') continue;
    const px = o.x + 0.5;
    const py = o.y + 0.5;
    const l = hyp(px - fx, py - fy);
    // a pillar right beside the foe hides nobody
    if (l < 2) continue;
    const hx = px + ((px - fx) / l) * 1.1;
    const hy = py + ((py - fy) / l) * 1.1;
    if (!free(g, s.area, hx, hy, 0.3)) continue;
    const dd = hyp(hx - s.x, hy - s.y);
    if (dd < bd) {
      bd = dd;
      best = [hx, hy];
    }
  }
  return best;
}

/** Once for each go of the boss (each time it closes up): is she careless this time? */
function careless(c: BCtx, boss: BMob): boolean {
  const { mem, oops } = c;
  const open = boss.phase < 100 ? 1 : 0;
  if (mem.wasOpen !== open || mem.part !== boss.phase % 100) {
    mem.wasOpen = open;
    mem.part = boss.phase % 100;
    if (!open) mem.ignore = oops() ? 1 : 0;
  }
  return mem.ignore === 1;
}

/**
 * The Spider Jockey, as the toasts tell her. On the spider: step off the spot when it crouches, hit it when it is
 * dizzy. Rider on foot: stand behind a pillar while he shoots, run in and hit him when he stops to reload.
 */
function jockeyPolicy(c: BCtx): void {
  const { g, obs, mem, inp, rng } = c;
  const s = g.s;
  const boss = obs.mobs.find((m) => m.boss);
  if (!boss) return;
  const slack = careless(c, boss);
  const d = hyp(boss.x - s.x, boss.y - s.y) || 1;
  if (boss.phase < 100) {
    strike(c, boss);
    return;
  }
  if (boss.phase % 100 === 0) {
    // on the spider
    const crouch = boss.st === WINDUP || boss.st === STRIKE;
    if (!crouch) mem.seen = 0;
    else if (!mem.seen) {
      // the mark on the ground is where she stood when it crouched
      mem.seen = 1;
      mem.markX = obs.sx;
      mem.markY = obs.sy;
      mem.strafe = rng.next() < 0.5 ? -1 : 1;
    }
    if (slack) {
      // careless: she runs at it and swings anyway (clang)
      strike(c, boss);
      return;
    }
    if (crouch) {
      if (hyp(s.x - mem.markX!, s.y - mem.markY!) > 2.4) return;
      // step off the mark, sideways to the spider (the other way if a wall is there)
      for (let n = 0; n < 2; n++) {
        const ux = (-(boss.y - s.y) / d) * mem.strafe!;
        const uy = ((boss.x - s.x) / d) * mem.strafe!;
        if (free(g, s.area, s.x + ux * 0.8, s.y + uy * 0.8, 0.3)) {
          inp.mx = sign(ux, 0.3);
          inp.my = sign(uy, 0.3);
          return;
        }
        // something in the way: go the other way, and keep to it
        mem.strafe = -mem.strafe!;
      }
      goto(inp, s.x, s.y, boss.x, boss.y, true);
      return;
    }
    // it is creeping up: wait a few steps off rather than run into it
    if (d > 4.6) walkTo(g, inp, boss.x, boss.y, 3);
    else if (d < 2.6) goto(inp, s.x, s.y, boss.x, boss.y, true);
    return;
  }
  // the rider on foot, shooting
  const spot = slack ? null : hideSpot(g, boss.x, boss.y);
  if (spot && hyp(spot[0] - s.x, spot[1] - s.y) < 0.35) return;
  if (dodgeShots(c)) return;
  if (spot) walkTo(g, inp, spot[0], spot[1]);
  else if (d > 6) walkTo(g, inp, boss.x, boss.y, 4);
}

/**
 * The Creeper King, as the toasts tell her. Little creepers: hit them, then hit him. Stomp: run back out of the
 * ring's reach, then hit him. Long fuse: hide behind a pillar until the boom, then hit him.
 */
function kingPolicy(c: BCtx): void {
  const { g, obs, inp } = c;
  const s = g.s;
  const king = obs.mobs.find((m) => m.boss);
  if (!king) return;
  const slack = careless(c, king);
  const ph = king.phase % 100;
  const kd = hyp(king.x - s.x, king.y - s.y);
  // a little creeper close by: hit it before it pops
  let foe: BMob | null = null;
  let fd = 3.2;
  for (const m of obs.mobs) {
    if (m.boss || m.calm) continue;
    const dd = hyp(m.x - s.x, m.y - s.y);
    if (dd < fd) {
      fd = dd;
      foe = m;
    }
  }
  if (foe) {
    strike(c, foe);
    return;
  }
  if (king.phase < 100) {
    strike(c, king);
    return;
  }
  if (slack) {
    // careless: she stays beside him and swings anyway (clang)
    strike(c, king);
    return;
  }
  const busy = king.st === WINDUP || king.st === STRIKE;
  if (ph === 1 && (busy || obs.shots.some((sh) => sh.kind === 'ring'))) {
    // the stomp: run back until she is clear of where the ring stops, on the door side of him
    if (kd < RING_REACH + 0.7) {
      const l = hyp(s.x - king.x, Math.max(0.5, s.y - king.y));
      const k = (RING_REACH + 1.2) / l;
      walkTo(g, inp, king.x + (s.x - king.x) * k, king.y + Math.max(0.5, s.y - king.y) * k);
    }
    return;
  }
  if (ph === 2 && busy) {
    // the long fuse: hide behind the nearest pillar until the boom
    const spot = hideSpot(g, king.x, king.y);
    if (spot && hyp(spot[0] - s.x, spot[1] - s.y) > 0.3) walkTo(g, inp, spot[0], spot[1]);
    return;
  }
  // nothing to do yet: wait a few steps in front of him
  if (kd > 4.2) walkTo(g, inp, king.x, king.y, 3);
}

export interface BossResult {
  boss: string;
  won: boolean;
  /** times her hearts ran out (she wakes at the door and the fight goes on) */
  faints: number;
  secs: number;
  /** times she was hurt */
  hits: number;
}

/** One fight: the arena is entered and the boss spawned by the rules, then only step() is called. */
export function fightOne(boss: string, seed: number, sword = '', gentle = true): BossResult {
  const arena = ARENAS[boss]!;
  const g = newGame(content, { seed, opts: { gentle } });
  const s = g.s;
  // What she would own by then: her gear (worn), the hearts and some bread on the hotbar.
  // --sword swaps the sword for another tier.
  for (const id of arena.gear) {
    const it = sword && id.endsWith('_sword') ? `${sword}_sword` : id;
    s.pouch[it] = 1;
    wear(g, it);
  }
  s.shield = shieldMax(g);
  s.bag[1] = { id: 'arrow', n: 12 };
  s.maxHp = arena.maxHp;
  s.hp = arena.maxHp;
  s.bag[0] = { id: 'bread', n: 3 };
  s.hot = 0;
  for (const f of arena.flags) s.flags[f] = 1;
  enterArea(g, arena.area, arena.x, arena.y, 'right');
  g.rt.mode = 'play';
  spawnAt(g, boss, 1, arena.at);
  const rng = new Rng(seed * 6007 + 31);
  const hist: BSnap[] = [];
  const mem: Record<string, number> = { swingWait: 0, eatWait: 0 };
  const inp: Input = { mx: 0, my: 0, act: false, hold: false, back: false, use: false, emote: false, cmd: null };
  const policy = boss === 'creeper_king' ? kingPolicy : jockeyPolicy;
  let hits = 0;
  let i = 0;
  let won = false;
  for (; i < FIGHT_LIMIT; i++) {
    inp.mx = 0;
    inp.my = 0;
    inp.act = false;
    inp.use = false;
    if (s.flags[arena.win]) {
      won = true;
      break;
    }
    if ((g.rt.mode as string) !== 'play') {
      // anything else on screen: she taps Space
      if (i % 20 === 0) inp.act = true;
    } else {
      hist.push({
        hp: s.hp,
        sx: s.x,
        sy: s.y,
        mobs: g.rt.mobs.map((m) => ({
          id: m.id,
          boss: g.c.mobs[m.id]?.role === 'boss',
          x: m.x,
          y: m.y,
          st: m.st,
          clip: m.clip,
          phase: m.phase,
          calm: !!m.calm,
          fuse: m.st === FUSE ? m.fuse : -1,
        })),
        shots: g.rt.shots
          .filter((sh) => sh.hostile)
          .map((sh) => ({ k: sh.k, x: sh.x, y: sh.y, vx: sh.vx, vy: sh.vy, kind: sh.kind, r: sh.r })),
      });
      if (hist.length > DELAY + 1) hist.shift();
      mem.swingWait!--;
      mem.eatWait!--;
      const ctx: BCtx = { g, obs: hist[0]!, rng, mem, inp, oops: () => rng.next() < MISTAKE };
      policy(ctx);
      // low on hearts: eat a loaf from the hotbar (R)
      if (s.bag[0] && hist[0]!.hp <= Math.max(6, s.maxHp * 0.3) && mem.eatWait! <= 0) {
        mem.eatWait = 40;
        if (!ctx.oops()) inp.use = true;
      }
    }
    const hp0 = s.hp;
    const f0 = s.counts.bossFaints ?? 0;
    step(g, inp);
    g.ev.length = 0;
    const fainted = (s.counts.bossFaints ?? 0) > f0;
    if (s.hp < hp0 || fainted) {
      hits++;
      if (process.env.KIDBOT_DEBUG)
        console.log(
          fainted ? '  FAINT at' : '  hurt at',
          (i / 60).toFixed(1),
          's by',
          hp0 - s.hp,
          g.rt.mobs.map((m) => `${m.id} st${m.st} ph${m.phase}`).join(' '),
          'shots',
          g.rt.shots.map((x) => x.kind).join(','),
        );
    }
  }
  const faints = s.counts.bossFaints ?? 0;
  if (process.env.KIDBOT_DEBUG)
    console.log(boss, seed, won ? 'WIN' : 'TIMEOUT', (i / 60).toFixed(1), 's hp', s.hp, 'hits', hits, 'faints', faints);
  return { boss, won, faints, secs: i / 60, hits };
}

// ---------------------------------------------------------------- the four dens (package 41)

/** What she has when she first walks up to each den: the gear on the picture board at the way into its region. */
const DEN_KIT: Record<string, { gear: string[]; maxHp: number; flags: string[] }> = {
  plains: { gear: ['stone_sword', 'bow', 'leather_helmet'], maxHp: 18, flags: SHARDS(4) },
  forest: { gear: ['iron_sword', 'bow', 'iron_helmet', 'leather_armour'], maxHp: 20, flags: SHARDS(5) },
  mine: { gear: ['iron_sword', 'bow', 'iron_helmet', 'leather_armour'], maxHp: 20, flags: SHARDS(5) },
  crater: { gear: ['diamond_sword', 'bow', 'iron_helmet', 'iron_armour'], maxHp: 22, flags: SHARDS(6) },
};
/** A den fight (two waves) should take a child about this long, in seconds. */
const DEN_SECS: [number, number] = [10, 150];
export interface DenResult {
  den: string;
  won: boolean;
  /** her hearts ran out: she wakes at home and the den waits for her */
  faints: number;
  secs: number;
  hits: number;
}

/** A den on Gentle: walk in, hit the nearest mob, step back from a hissing creeper, eat when low. */
export function fightDen(den: string, seed: number, gentle = true): DenResult {
  const kit = DEN_KIT[den]!;
  const d = content.dens[den]!;
  const g = newGame(content, { seed, opts: { gentle } });
  const s = g.s;
  for (const id of kit.gear) {
    s.pouch[id] = 1;
    wear(g, id);
  }
  s.shield = shieldMax(g);
  s.bag[1] = { id: 'arrow', n: 12 };
  s.maxHp = kit.maxHp;
  s.hp = kit.maxHp;
  s.bag[0] = { id: 'bread', n: 3 };
  s.hot = 0;
  for (const f of kit.flags) s.flags[f] = 1;
  for (const id in s.quests) s.quests[id]!.done = true;
  g.rt.q = [];
  const p = content.areas.island!.places[d.at]!;
  // she comes in by the south gap, from a little way off, in the day
  s.time = 120;
  let start: [number, number] = [p.x + 0.5, p.y + d.r + 3.5];
  for (const a of [Math.PI / 2, 0, Math.PI, -Math.PI / 2]) {
    const x = p.x + 0.5 + Math.cos(a) * (d.r + 3);
    const y = p.y + 0.5 + Math.sin(a) * (d.r + 3);
    enterArea(g, 'island', x, y, 'up');
    // a start she can walk to the den from (package 44a: the plains den has the brook to its east)
    const isl = content.areas.island!;
    const way = findPath(g.rt.solid.island!, isl.w, isl.h, Math.floor(x), Math.floor(y), p.x, p.y, 1);
    if (free(g, 'island', x, y, 0.3) && way) {
      start = [x, y];
      break;
    }
  }
  enterArea(g, 'island', start[0], start[1], 'up');
  g.rt.mode = 'play';
  g.rt.spawnT = 1e9;
  const rng = new Rng(seed * 7919 + 13);
  const hist: BSnap[] = [];
  const mem: Record<string, number> = { swingWait: 0, eatWait: 0 };
  const inp: Input = { mx: 0, my: 0, act: false, hold: false, back: false, use: false, emote: false, cmd: null };
  let hits = 0;
  let i = 0;
  let faints = 0;
  for (; i < FIGHT_LIMIT; i++) {
    inp.mx = 0;
    inp.my = 0;
    inp.act = false;
    inp.use = false;
    if (s.dens[den] === 2) break;
    if (s.area !== 'island' || (s.hp <= 0 && !g.rt.den)) {
      faints++;
      break;
    }
    if ((g.rt.mode as string) !== 'play') {
      if (i % 20 === 0) inp.act = true;
    } else {
      hist.push({
        hp: s.hp,
        sx: s.x,
        sy: s.y,
        mobs: g.rt.mobs
          .filter((m) => !m.gone)
          .map((m) => ({
            id: m.id,
            boss: false,
            x: m.x,
            y: m.y,
            st: m.st,
            clip: m.clip,
            phase: m.phase,
            calm: !!m.calm || !!m.doze,
            fuse: m.st === FUSE ? m.fuse : -1,
          })),
        shots: g.rt.shots
          .filter((sh) => sh.hostile)
          .map((sh) => ({ k: sh.k, x: sh.x, y: sh.y, vx: sh.vx, vy: sh.vy, kind: sh.kind, r: sh.r })),
      });
      if (hist.length > DELAY + 1) hist.shift();
      mem.swingWait!--;
      mem.eatWait!--;
      const ctx: BCtx = { g, obs: hist[0]!, rng, mem, inp, oops: () => rng.next() < MISTAKE };
      const obs = hist[0]!;
      const fusing = obs.mobs.find((m) => m.fuse >= 0 && hyp(m.x - s.x, m.y - s.y) < 3.8);
      const awake = obs.mobs
        .filter((m) => !m.calm)
        .sort((a, b) => hyp(a.x - s.x, a.y - s.y) - hyp(b.x - s.x, b.y - s.y));
      if (fusing && !ctx.oops()) goto(inp, s.x, s.y, fusing.x, fusing.y, true);
      else if (dodgeShots(ctx)) {
        // sidestepped an arrow
      } else if (awake[0]) strike(ctx, awake[0]);
      else if (!g.rt.den) walkTo(g, inp, p.x + 0.5, p.y + 0.5);
      else if (obs.mobs[0]) strike(ctx, obs.mobs[0]);
      if (s.bag[0] && obs.hp <= Math.max(6, s.maxHp * 0.3) && mem.eatWait! <= 0) {
        mem.eatWait = 40;
        if (!ctx.oops()) inp.use = true;
      }
    }
    const hp0 = s.hp;
    step(g, inp);
    g.ev.length = 0;
    if (s.hp < hp0) hits++;
  }
  return { den, won: s.dens[den] === 2, faints, secs: i / 60, hits };
}

// ---------------------------------------------------------------- the four wild stretches (package 44a)

/**
 * What she has when she walks into each wild stretch (the solver's run, story pieces only: the sword +1 of chapter 3
 * is on the path), and where the stretch is: its quest, the step that opens it and how many fights it holds. The
 * fights come from the quest itself (each step's `spawn` in turn), so the bot fights what the story sends.
 */
const STRETCH: Record<
  string,
  {
    quest: string;
    start: string;
    fights: number;
    gear: string[];
    plus?: string[];
    maxHp: number;
    arrows: number;
    night?: boolean;
    /** where she walks in, when the step that opens it is a site (package 47a) */
    at?: string;
  }
> = {
  // package 47a: the short stretches of chapters 1 and 2 (the creek bush, the long grass)
  creek_bush: {
    quest: 'ch1',
    start: 'bush_bridge',
    at: 'bush_in',
    fights: 1,
    gear: ['wood_sword'],
    maxHp: 10,
    arrows: 0,
  },
  long_grass: { quest: 'ch2', start: 'grass_in', fights: 1, gear: ['wood_sword'], maxHp: 10, arrows: 0 },
  quarry_cave: { quest: 'ch3', start: 'quarry_cave', fights: 2, gear: ['stone_sword'], maxHp: 14, arrows: 0 },
  web_trail: {
    quest: 'ch4',
    start: 'web_trail',
    fights: 2,
    gear: ['stone_sword', 'bow'],
    plus: ['stone_sword'],
    maxHp: 16,
    arrows: 4,
    // dark under the big trees: the trail's mouth brings the night
    night: true,
  },
  ford: {
    quest: 'ch5',
    start: 'ford_bridge',
    fights: 2,
    gear: ['stone_sword', 'bow'],
    plus: ['stone_sword'],
    maxHp: 18,
    arrows: 8,
    at: 'ford',
  },
  ledges: {
    quest: 'ch7',
    start: 'ledges_top',
    fights: 3,
    gear: ['iron_sword', 'bow', 'iron_helmet', 'leather_armour'],
    maxHp: 22,
    arrows: 12,
  },
};
/** A stretch's fights should take a child about this long in all, in seconds. */
const STRETCH_SECS: [number, number] = [3, 150];
export interface StretchResult {
  id: string;
  won: boolean;
  faints: number;
  secs: number;
  hits: number;
}

/** The fights of a stretch, from its quest: the spawn list of the step that opens it and of the steps after it. */
export function stretchFights(id: string): { mob: string; n: number; at: string }[][] {
  const d = STRETCH[id]!;
  const steps = content.quests[d.quest]!.steps;
  const i0 = steps.findIndex(
    (st) => (st.t === 'reach' && st.place === d.start) || (st.t === 'site' && st.site === d.start),
  );
  if (i0 < 0) throw new Error(`stretch ${id}: no step opens it`);
  const out: { mob: string; n: number; at: string }[][] = [];
  for (let i = i0; i < steps.length && out.length < d.fights; i++)
    if (steps[i]!.fx?.spawn) out.push(steps[i]!.fx!.spawn!);
  return out;
}

/**
 * A stretch on Gentle: she walks in from its mouth with the gear she has by then, each fight of the story comes in
 * turn (the next only when the last is beaten), and she plays like a child (late, now and then wrong, eats when low).
 * The doing between the fights (mining, webs, the bridge) is the solver's; here only the fights are judged.
 */
export function fightStretch(id: string, seed: number, gentle = true): StretchResult {
  const d = STRETCH[id]!;
  const fights = stretchFights(id);
  const g = newGame(content, { seed, opts: { gentle } });
  const s = g.s;
  for (const it of d.gear) {
    s.pouch[it] = 1;
    wear(g, it);
  }
  for (const it of d.plus ?? []) s.plus[it] = 1;
  s.shield = shieldMax(g);
  s.bag[1] = d.arrows ? { id: 'arrow', n: d.arrows } : null;
  s.maxHp = d.maxHp;
  s.hp = d.maxHp;
  s.bag[0] = { id: 'bread', n: 3 };
  s.hot = 0;
  for (const qid in s.quests) s.quests[qid]!.done = true;
  g.rt.q = [];
  // the way through is open: the webs are cut, the bridge is built, the high webs are down
  s.flags.site_ford_bridge = 1;
  s.flags.ford_plan = 1;
  s.flags.site_bush_bridge = 1;
  s.flags.site_cave_bridge = 1;
  // package 47a: thorns cut, rock falls mined, the fallen gum chopped, the cracked boulder broken
  const open = new Set([
    'web_wall',
    'web_high',
    'cracked_rock',
    'thorn_bush',
    'rock_fall',
    'fallen_gum',
    'boulder_wall',
  ]);
  // Since reach steps take `clear` (D95), cutting a running quest's things would finish its step: chapter 2 starts by
  // itself here, and its cut bridge bushes would send its creeper across the map. Those stay; the rest are cut.
  refreshQuests(g);
  const keep = new Set<string>();
  for (const qid in s.quests)
    if (!s.quests[qid]!.done)
      for (const st of content.quests[qid]!.steps) if (st.t === 'reach') for (const c of st.clear ?? []) keep.add(c);
  for (const o of content.areas.island!.objects) if (open.has(o.type) && !keep.has(o.id)) s.taken[o.id] = 1;
  // in the day, at the mouth of the stretch (a bridge's site stands at its own place)
  const st0 = content.areas.island!.places[d.at ?? d.start]!;
  s.time = d.night ? NIGHT_AT + 10 : 120;
  enterArea(g, 'island', st0.x + 0.5, st0.y + 0.5, 'up');
  g.rt.mode = 'play';
  g.rt.spawnT = 1e9;
  const rng = new Rng(seed * 7919 + 29);
  const hist: BSnap[] = [];
  const mem: Record<string, number> = { swingWait: 0, eatWait: 0 };
  const inp: Input = { mx: 0, my: 0, act: false, hold: false, back: false, use: false, emote: false, cmd: null };
  let hits = 0;
  let i = 0;
  let faints = 0;
  let fight = -1;
  let won = false;
  const alive = () => g.rt.mobs.filter((m) => !m.gone && m.tag === 'story').length;
  for (; i < FIGHT_LIMIT; i++) {
    inp.mx = 0;
    inp.my = 0;
    inp.act = false;
    inp.use = false;
    if (s.area !== 'island' || s.hp <= 0) {
      faints++;
      break;
    }
    if (fight < 0 || alive() === 0) {
      // the next fight comes when she reaches its place (the story sends it as she walks in)
      if (fight + 1 >= fights.length) {
        won = true;
        break;
      }
      const next = fights[fight + 1]!;
      const p = content.areas.island!.places[next[0]!.at]!;
      if (Math.hypot(s.x - p.x - 0.5, s.y - p.y - 0.5) > 5 && fight >= 0) {
        walkTo(g, inp, p.x + 0.5, p.y + 0.5);
        step(g, inp);
        g.ev.length = 0;
        continue;
      }
      fight++;
      for (const sp of next) spawnAt(g, sp.mob, sp.n, sp.at);
    }
    if ((g.rt.mode as string) !== 'play') {
      if (i % 20 === 0) inp.act = true;
    } else {
      hist.push({
        hp: s.hp,
        sx: s.x,
        sy: s.y,
        mobs: g.rt.mobs
          .filter((m) => !m.gone)
          .map((m) => ({
            id: m.id,
            boss: false,
            x: m.x,
            y: m.y,
            st: m.st,
            clip: m.clip,
            phase: m.phase,
            calm: !!m.calm || !!m.doze,
            fuse: m.st === FUSE ? m.fuse : -1,
          })),
        shots: g.rt.shots
          .filter((sh) => sh.hostile)
          .map((sh) => ({ k: sh.k, x: sh.x, y: sh.y, vx: sh.vx, vy: sh.vy, kind: sh.kind, r: sh.r })),
      });
      if (hist.length > DELAY + 1) hist.shift();
      mem.swingWait!--;
      mem.eatWait!--;
      const ctx: BCtx = { g, obs: hist[0]!, rng, mem, inp, oops: () => rng.next() < MISTAKE };
      const obs = hist[0]!;
      const fusing = obs.mobs.find((m) => m.fuse >= 0 && hyp(m.x - s.x, m.y - s.y) < 3.8);
      const awake = obs.mobs
        .filter((m) => !m.calm)
        .sort((a, b) => hyp(a.x - s.x, a.y - s.y) - hyp(b.x - s.x, b.y - s.y));
      if (fusing && !ctx.oops()) goto(inp, s.x, s.y, fusing.x, fusing.y, true);
      else if (dodgeShots(ctx)) {
        // sidestepped an arrow
      } else if (awake[0]) strike(ctx, awake[0]);
      else if (obs.mobs[0]) strike(ctx, obs.mobs[0]);
      if (s.bag[0] && obs.hp <= Math.max(6, s.maxHp * 0.3) && mem.eatWait! <= 0) {
        mem.eatWait = 40;
        if (!ctx.oops()) inp.use = true;
      }
    }
    const hp0 = s.hp;
    step(g, inp);
    g.ev.length = 0;
    if (s.hp < hp0) hits++;
  }
  return { id, won, faints, secs: i / 60, hits };
}

interface Row {
  wins: number;
  runs: number;
  avgStars: number;
  avgSeconds: number;
  seconds: number[];
}

function main(): void {
  const args = process.argv.slice(2);
  const arg = (name: string) => {
    const k = args.indexOf(name);
    return k >= 0 ? (args[k + 1] ?? null) : null;
  };
  const onlyGame = arg('--game');
  const onlyBoss = arg('--boss');
  const onlyDen = arg('--den');
  const onlyStretch = arg('--stretch');
  const sword = arg('--sword') ?? '';
  /** --normal fights the bosses with full hurts (the game's Normal setting) instead of Gentle */
  const gentle = !args.includes('--normal');
  if (sword && !SWORDS.includes(sword)) throw new Error(`--sword must be one of ${SWORDS.join(', ')}`);
  const games = Object.keys(MINIS).filter((id) => !onlyGame || id === onlyGame);
  const bossIds = Object.values(content.mobs)
    .filter((m) => m.role === 'boss')
    .map((m) => m.id)
    .filter((id) => !onlyBoss || id === onlyBoss);
  // --game runs only the mini-games, --boss only the bosses, neither runs everything
  const doGames = !onlyBoss && !onlyDen && !onlyStretch;
  const doBosses = !onlyGame && !onlyDen && !onlyStretch;
  const doDens = (!onlyGame && !onlyBoss && !onlyStretch) || !!onlyDen;
  const doStretches = (!onlyGame && !onlyBoss && !onlyDen) || !!onlyStretch;
  const stretchOut: Record<string, unknown> = {};
  const cupOut: Record<string, unknown> = {};
  const denOut: Record<string, unknown> = {};
  const out: Record<string, Row> = {};
  const bossOut: Record<string, unknown> = {};
  const bad: string[] = [];
  console.log(
    `KID BOT  ${gentle ? 'Gentle' : 'Normal'}, ${((DELAY * 1000) / 60) | 0} ms reaction, ${MISTAKE * 100}% mistakes, ${RUNS} runs each (games: ${NEED} of ${RUNS} with 2 stars or more; bosses: every fight won, ${sword ? `${sword} sword` : "the story's gear"}, at most ${BOSS_FAINTS} faint a fight, the right length)`,
  );
  if (doGames) {
    console.log(`${'game'.padEnd(11)}${'wins'.padEnd(7)}${'stars'.padEnd(8)}${'seconds'.padEnd(10)}verdict`);
    for (const game of games) {
      if (!POLICY[game]) {
        bad.push(`${game} (no kid-bot player yet)`);
        console.log(`${game.padEnd(11)}-      -       -         NO PLAYER`);
        continue;
      }
      const stars: number[] = [];
      const secs: number[] = [];
      for (let r = 0; r < RUNS; r++) {
        const res = playOne(game, 1000 + r * 97);
        stars.push(res.stars);
        secs.push(Math.round(res.secs * 10) / 10);
      }
      const wins = stars.filter((s) => s >= 2).length;
      const avgStars = stars.reduce((a, b) => a + b, 0) / RUNS;
      const avgSeconds = secs.reduce((a, b) => a + b, 0) / RUNS;
      out[game] = {
        wins,
        runs: RUNS,
        avgStars: Math.round(avgStars * 10) / 10,
        avgSeconds: Math.round(avgSeconds),
        seconds: secs,
      };
      // enough runs with 2 stars or more, and the length a set piece should have
      const [lo, hi] = GAME_SECS[game] ?? [45, 90];
      const why: string[] = [];
      if (wins < NEED) why.push(`${wins} of ${RUNS}`);
      if (avgSeconds < lo || avgSeconds > hi) why.push(`${avgSeconds.toFixed(0)} s, wanted ${lo} to ${hi}`);
      const ok = why.length === 0;
      if (!ok) bad.push(`${game} (${why.join('; ')})`);
      console.log(
        `${game.padEnd(11)}${`${wins}/${RUNS}`.padEnd(7)}${avgStars.toFixed(1).padEnd(8)}${avgSeconds.toFixed(0).padEnd(10)}${ok ? 'ok' : 'FAIL'}`,
      );
      console.log(`           stars ${stars.join(' ')}   seconds ${secs.join(' ')}`);
      // cups: how often a silver go is won, and how many goes gold takes (each child keeps trying, at most 10)
      const silver = Array.from(
        { length: RUNS },
        (_, r) => playOne(game, 5000 + r * 89, MISTAKE, 2).stars >= CUP_STARS[2]!,
      ).filter(Boolean).length;
      const tries: number[] = [];
      const goldSecs: number[] = [];
      for (let r = 0; r < RUNS; r++) {
        let k = 0;
        for (; k < 10; k++) {
          const res = playOne(game, 6000 + r * 211 + k * 17, MISTAKE, 3);
          goldSecs.push(res.secs);
          if (res.stars >= CUP_STARS[3]!) break;
        }
        tries.push(k + 1);
      }
      const avgTries = tries.reduce((a, b) => a + b, 0) / RUNS;
      const goldAvg = goldSecs.reduce((a, b) => a + b, 0) / goldSecs.length;
      cupOut[game] = {
        silverWins: silver,
        goldTries: Math.round(avgTries * 10) / 10,
        goldSeconds: Math.round(goldAvg),
        tries,
      };
      const cupOk = avgTries <= CUP_TRIES;
      if (!cupOk) bad.push(`${game} gold cup (${avgTries.toFixed(1)} goes, wanted ${CUP_TRIES} or fewer)`);
      console.log(
        `           cups: silver ${silver}/${RUNS} won, gold in ${avgTries.toFixed(1)} goes (${tries.join(' ')}), ${goldAvg.toFixed(0)} s a go   ${cupOk ? 'ok' : 'FAIL'}`,
      );
    }
  }
  if (doBosses) {
    console.log(
      `${'boss'.padEnd(15)}${'wins'.padEnd(7)}${'avg s'.padEnd(8)}${'max s'.padEnd(8)}${'faints'.padEnd(8)}verdict`,
    );
    for (const id of bossIds) {
      if (!ARENAS[id]) {
        bad.push(`${id} (no arena set-up yet)`);
        console.log(`${id.padEnd(15)}-      -       -       -       NO ARENA`);
        continue;
      }
      const res: BossResult[] = [];
      for (let r = 0; r < RUNS; r++) res.push(fightOne(id, 2000 + r * 131, sword, gentle));
      const wins = res.filter((x) => x.won).length;
      const faints = res.reduce((n, x) => n + x.faints, 0);
      const timeouts = res.filter((x) => !x.won).length;
      const secs = res.map((x) => Math.round(x.secs * 10) / 10);
      const avg = secs.reduce((a, b) => a + b, 0) / RUNS;
      const winSecs = res.filter((x) => x.won).map((x) => x.secs);
      const avgWin = winSecs.length ? winSecs.reduce((a, b) => a + b, 0) / winSecs.length : 0;
      const max = Math.max(...secs);
      const hurt = res.map((x) => x.hits);
      const [lo, hi] = ARENAS[id]!.secs;
      out[id] = { wins, runs: RUNS, avgStars: 0, avgSeconds: Math.round(avg), seconds: secs };
      bossOut[id] = {
        wins,
        runs: RUNS,
        faints,
        timeouts,
        sword: sword || ARENAS[id]!.gear.find((x) => x.endsWith('_sword')),
        avgSeconds: Math.round(avg * 10) / 10,
        avgWinSeconds: Math.round(avgWin * 10) / 10,
        maxSeconds: max,
        seconds: secs,
        hurt,
      };
      // every fight won, few faints, and the length a set piece should have
      const why: string[] = [];
      if (wins < RUNS) why.push(`${wins} of ${RUNS} won`);
      if (faints / RUNS > BOSS_FAINTS) why.push(`${(faints / RUNS).toFixed(1)} faints a fight`);
      if (avg < lo || avg > hi) why.push(`${avg.toFixed(0)} s, wanted ${lo} to ${hi}`);
      if (why.length) bad.push(`${id} (${why.join('; ')})`);
      console.log(
        `${id.padEnd(15)}${`${wins}/${RUNS}`.padEnd(7)}${avg.toFixed(1).padEnd(8)}${max.toFixed(1).padEnd(8)}${String(faints).padEnd(8)}${why.length ? 'FAIL' : 'ok'}`,
      );
      console.log(
        `               seconds ${secs.join(' ')}   times hurt ${hurt.join(' ')}${timeouts ? `   timeouts ${timeouts}` : ''}`,
      );
    }
  }
  if (doDens) {
    console.log(
      `${'den'.padEnd(15)}${'wins'.padEnd(7)}${'avg s'.padEnd(8)}${'max s'.padEnd(8)}${'faints'.padEnd(8)}verdict`,
    );
    for (const id of Object.keys(content.dens).filter((x) => !onlyDen || x === onlyDen)) {
      const res: DenResult[] = [];
      for (let r = 0; r < RUNS; r++) res.push(fightDen(id, 3000 + r * 151, gentle));
      const wins = res.filter((x) => x.won).length;
      const faints = res.reduce((n, x) => n + x.faints, 0);
      const secs = res.map((x) => Math.round(x.secs * 10) / 10);
      const avg = secs.reduce((a, b) => a + b, 0) / RUNS;
      const max = Math.max(...secs);
      // a den may be lost now and then (she comes back with better gear), never most of the time
      const why: string[] = [];
      if (wins < NEED) why.push(`${wins} of ${RUNS} won`);
      if (avg < DEN_SECS[0] || avg > DEN_SECS[1])
        why.push(`${avg.toFixed(0)} s, wanted ${DEN_SECS[0]} to ${DEN_SECS[1]}`);
      if (why.length) bad.push(`den ${id} (${why.join('; ')})`);
      out['den_' + id] = { wins, runs: RUNS, avgStars: 0, avgSeconds: Math.round(avg), seconds: secs };
      denOut[id] = {
        wins,
        runs: RUNS,
        faints,
        avgSeconds: Math.round(avg * 10) / 10,
        maxSeconds: max,
        seconds: secs,
        hurt: res.map((x) => x.hits),
      };
      console.log(
        `${id.padEnd(15)}${`${wins}/${RUNS}`.padEnd(7)}${avg.toFixed(1).padEnd(8)}${max.toFixed(1).padEnd(8)}${String(faints).padEnd(8)}${why.length ? 'FAIL' : 'ok'}`,
      );
    }
  }
  if (doStretches) {
    console.log(
      `${'stretch'.padEnd(15)}${'wins'.padEnd(7)}${'avg s'.padEnd(8)}${'max s'.padEnd(8)}${'faints'.padEnd(8)}verdict`,
    );
    for (const id of Object.keys(STRETCH).filter((x) => !onlyStretch || x === onlyStretch)) {
      const res: StretchResult[] = [];
      for (let r = 0; r < RUNS; r++) res.push(fightStretch(id, 4000 + r * 173, gentle));
      const wins = res.filter((x) => x.won).length;
      const faints = res.reduce((n, x) => n + x.faints, 0);
      const secs = res.map((x) => Math.round(x.secs * 10) / 10);
      const avg = secs.reduce((a, b) => a + b, 0) / RUNS;
      const max = Math.max(...secs);
      // a wild stretch is on the main path: fair with the gear she has, every time
      const why: string[] = [];
      if (wins < RUNS) why.push(`${wins} of ${RUNS} won`);
      if (avg < STRETCH_SECS[0] || avg > STRETCH_SECS[1])
        why.push(`${avg.toFixed(0)} s, wanted ${STRETCH_SECS[0]} to ${STRETCH_SECS[1]}`);
      if (why.length) bad.push(`stretch ${id} (${why.join('; ')})`);
      stretchOut[id] = {
        wins,
        runs: RUNS,
        faints,
        avgSeconds: Math.round(avg * 10) / 10,
        maxSeconds: max,
        seconds: secs,
        hurt: res.map((x) => x.hits),
      };
      console.log(
        `${id.padEnd(15)}${`${wins}/${RUNS}`.padEnd(7)}${avg.toFixed(1).padEnd(8)}${max.toFixed(1).padEnd(8)}${String(faints).padEnd(8)}${why.length ? 'FAIL' : 'ok'}`,
      );
    }
  }
  if (!onlyGame && !onlyBoss && !onlyDen && !onlyStretch) {
    mkdirSync('test-results', { recursive: true });
    writeFileSync(
      'test-results/kidbot.json',
      JSON.stringify({ games: out, cups: cupOut, bosses: bossOut, dens: denOut, stretches: stretchOut }, null, 2) +
        '\n',
    );
  }
  console.log(bad.length ? `KID BOT FAIL: ${bad.join(', ')}` : 'KID BOT OK');
  process.exit(bad.length ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
