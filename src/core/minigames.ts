// Mini-games. Arrow keys and Space only. None can be lost: there is always at least one star and another go.
// Each game is a tiny state machine over MiniRt so the view can draw it and the kid bot can play it headless.
import { give } from './bag.ts';
import { cupOpen, rand, randInt } from './cond.ts';
import { meet } from './npcs.ts';
import { questEvent } from './quests.ts';
import type { Game, Input, MiniRt } from './types.ts';

export interface MiniDef {
  goal: number;
  init(g: Game, m: MiniRt): void;
  step(g: Game, m: MiniRt, inp: Input): void;
  /** Back (X, or Escape) leaves while she plays, as "Not now" does on the start card: for a game that has no other
   * use for X. The story step stays, so she can play again from the same person or post. */
  leave?: boolean;
}

const dt = 1 / 60;
/** Package 73b: games with no game post and no cups (the school quiz), added by their own file when started. */
const MORE: Record<string, MiniDef> = {};
export function addMini(id: string, def: MiniDef): void {
  MORE[id] = def;
}

// ---------------------------------------------------------------- cups (package 47a)
// Every mini-game can be played again at its post for a cup: bronze is the game as it is, silver and gold ask for
// more (faster, longer or tighter, never more waiting). Bronze is won with 2 stars, silver and gold with 3 in their
// harder game.
/** Stars a go needs to win the cup it is played for, by tier (bronze, silver, gold). */
export const CUP_STARS = [0, 2, 3, 3];
/** How much harder a go is: 0 for the story and bronze, 1 silver, 2 gold. */
export function hard(m: MiniRt): number {
  return Math.max(0, Math.min(2, m.cup - 1));
}
/** The tier she would play for at a post now: 0 when the cups are not open yet, else the next cup (gold again once won). */
export function cupNext(g: Game, game: string): 0 | 1 | 2 | 3 {
  if (!MINIS[game] || !cupOpen(g, game)) return 0;
  return Math.min(3, (g.s.cups[game] ?? 0) + 1) as 1 | 2 | 3;
}

/** The cup a go at a post is played for: none while a quest is waiting for this game (that go is the story's). */
export function postCup(g: Game, game: string): number {
  for (const qid in g.s.quests) {
    const q = g.s.quests[qid]!;
    const st = q.done ? undefined : g.c.quests[qid]?.steps[q.step];
    if (st && st.t === 'mini' && st.game === game) return 0;
  }
  return cupNext(g, game);
}

/** The claw machine gives a free go for a cup she has not won yet (the cup is what she plays for). */
export function freeCupGo(g: Game): boolean {
  const cup = postCup(g, 'claw');
  return cup > 0 && (g.s.cups.claw ?? 0) < cup;
}

/** Would the claw machine give a go now (the free one, a quest's, or one she has earned)? As hero.ts uses it. */
export function clawReady(g: Game): boolean {
  if (freeCupGo(g) || (g.s.counts.clawGoes ?? 0) > 0 || !g.s.flags.claw_free) return true;
  for (const qid in g.s.quests) {
    const q = g.s.quests[qid]!;
    const st = q.done ? undefined : g.c.quests[qid]?.steps[q.step];
    if (st && st.t === 'mini' && st.game === 'claw') return true;
  }
  return false;
}

export function startMini(
  g: Game,
  game: string,
  then: ((stars: number) => void) | null = null,
  host = '',
  cup = 0,
  clawCharge: 'free' | 'earned' | null = null,
): void {
  const def = MINIS[game] ?? MORE[game];
  if (!def) throw new Error(`unknown mini-game ${game}`);
  if (g.rt.mode !== 'play') {
    g.rt.q.push(() => startMini(g, game, then, host, cup, clawCharge));
    return;
  }
  const m: MiniRt = {
    game,
    host: host || postHost(g),
    st: 0,
    t: 0,
    score: 0,
    goal: def.goal,
    stars: 0,
    n: [],
    objs: [],
    msg: '',
    then,
    best: g.s.stars[game] ?? 0,
    cup: Math.max(0, Math.min(3, cup)),
    cupWon: 0,
  };
  if (clawCharge) m.charge = clawCharge;
  def.init(g, m);
  g.rt.mini = m;
  g.rt.mode = 'mini';
  g.ev.push({ t: 'music', id: 'mini' });
}

/** At a game post nobody was spoken to: the post's own id says who she plays with (the view picks the cast). */
function postHost(g: Game): string {
  let best = '';
  let bd = 3;
  for (const o of g.c.areas[g.s.area]?.objects ?? []) {
    if (o.type !== 'game_post') continue;
    const d = Math.hypot(o.x + 0.5 - g.s.x, o.y + 0.5 - g.s.y);
    if (d < bd) {
      bd = d;
      best = o.id;
    }
  }
  return best;
}

export function stepMini(g: Game, inp: Input): void {
  const m = g.rt.mini;
  if (!m) {
    g.rt.mode = 'play';
    return;
  }
  m.t += dt;
  if (m.st === 0) {
    if (inp.act && m.t > 0.3) {
      // the claw machine's go is spent when play begins, so "Not now" on the start card keeps it
      if (m.charge === 'free') g.s.flags.claw_free = 1;
      else if (m.charge === 'earned') g.s.counts.clawGoes = Math.max(0, (g.s.counts.clawGoes ?? 0) - 1);
      m.charge = undefined;
      m.st = 1;
      m.t = 0;
      m.round = roundOf(m);
      g.ev.push({ t: 'sfx', id: 'go' });
    } else if (inp.back && m.t > 0.3) {
      // package 69: X (or Escape) on the start card is "Not now": she leaves without playing
      closeMini(g);
    }
    return;
  }
  if (m.st === 1 && inp.back && miniLeaves(m)) {
    closeMini(g);
    return;
  }
  if (m.st === 2) {
    if ((inp.act || inp.back) && m.t > 0.8) closeMini(g);
    return;
  }
  // package 69: a new round waits a second with its name up ("Round 2 of 3") before it begins
  const r = roundOf(m);
  if (m.round === undefined) m.round = r;
  else if (r !== m.round) {
    m.round = r;
    m.roundT = 1;
  }
  if ((m.roundT ?? 0) > 0) {
    m.roundT! -= dt;
    return;
  }
  (MINIS[m.game] ?? MORE[m.game])!.step(g, m, inp);
}

/** Package 69: the round of a game with rounds or waves (hide and seek, the targets, snowballs); 0 for the rest. */
function roundOf(m: MiniRt): number {
  if (m.game === 'hide') return m.n[5] ?? 0;
  if (m.game === 'targets' || m.game === 'snowball') return m.n[4] ?? 0;
  return 0;
}

export function finish(g: Game, m: MiniRt, stars: number, why = ''): void {
  m.st = 2;
  // package 68: a game that ends before the goal says why on its card ("Time is up!")
  m.why = why;
  m.t = 0;
  m.stars = Math.max(1, Math.min(3, stars));
  const before = g.s.stars[m.game] ?? 0;
  if (m.stars > before) {
    g.s.stars[m.game] = m.stars;
    give(g, 'ticket', m.stars - before);
    g.ev.push({ t: 'reward', kind: 'secret', id: `stars:${m.game}:${m.stars}` });
  }
  // the cups of a game open the day after she first plays it
  g.s.counts['cupday:' + m.game] ??= g.s.day + 1;
  if (m.cup > 0 && m.stars >= CUP_STARS[m.cup]! && m.cup > (g.s.cups[m.game] ?? 0)) {
    const tier = m.cup as 1 | 2 | 3;
    g.s.cups[m.game] = tier;
    m.cupWon = tier;
    g.ev.push({ t: 'cup', game: m.game, tier });
    if (tier === 3) g.s.flags['cup_' + m.game] = 1;
  }
  g.ev.push({ t: 'sfx', id: 'fanfare' });
  g.ev.push({ t: 'act', kind: 'mini', id: m.game });
}

/** Can she leave this game part way with Back (and lose nothing but the go)? */
export function miniLeaves(m: MiniRt): boolean {
  return m.st === 1 && !!(MINIS[m.game] ?? MORE[m.game])?.leave;
}

export function closeMini(g: Game): void {
  const m = g.rt.mini;
  if (!m) return;
  g.rt.mini = null;
  g.rt.mode = 'play';
  g.ev.push({ t: 'music', id: '' });
  if (m.st === 2) {
    questEvent(g, 'mini', m.game, m.stars);
    if (m.then) m.then(m.stars);
  }
}

/** Finish at once with the given stars (the solver may skip skill). */
export function winMini(g: Game, stars = 3): void {
  const m = g.rt.mini;
  if (!m) return;
  if (m.game === 'claw' && m.st !== 2) clawPrize(g, m);
  finish(g, m, stars);
  closeMini(g);
}

// ---------------------------------------------------------------- Keepy Uppy
// n: 0 hero x, 1 balloon x, 2 balloon y, 3 vx, 4 vy, 5 misses, 6 swing timer, 7 helper x
export const KEEPY = { w: 12, ground: 7, hitTop: 4.6 };
/** Cup tiers: hits to win, and how near she must be (times the usual reach). */
export const KEEPY_CUP = { goal: [20, 22, 24], reach: [1, 0.88, 0.78] };
const keepy: MiniDef = {
  goal: 20,
  init(_g, m) {
    m.n = [6, 6, 1.5, 0.6, 0, 0, 0, 2];
    m.goal = KEEPY_CUP.goal[hard(m)]!;
  },
  step(g, m, inp) {
    const n = m.n;
    n[0] = Math.max(0.6, Math.min(KEEPY.w - 0.6, n[0]! + inp.mx * 5.4 * dt));
    n[4] = Math.min(2.6, n[4]! + 2.3 * dt);
    n[1] = n[1]! + n[3]! * dt;
    n[2] = n[2]! + n[4]! * dt;
    if (n[1]! < 0.5 || n[1]! > KEEPY.w - 0.5) {
      n[3] = -n[3]!;
      n[1] = Math.max(0.5, Math.min(KEEPY.w - 0.5, n[1]!));
    }
    if (n[6]! > 0) n[6] = n[6]! - dt;
    // The helper (Bandit) shuffles under the balloon and sometimes saves it, which is the joke.
    // (never past the balloon: overshooting each step made him jitter left and right under it, a ghost on screen)
    n[7] = n[7]! + Math.max(-1.4 * dt, Math.min(1.4 * dt, n[1]! - n[7]!));
    const reach = (g.s.opts.gentle ? 1.45 : 1.1) * KEEPY_CUP.reach[hard(m)]!;
    if (inp.act && n[6]! <= 0) {
      n[6] = 0.3;
      if (Math.abs(n[0]! - n[1]!) < reach && n[2]! > KEEPY.hitTop && n[4]! > -1) {
        n[4] = -3.3 - rand(g) * 0.5;
        n[3] = (n[1]! - n[0]!) * 1.6 + (rand(g) * 2 - 1) * (m.score >= 10 || hard(m) === 2 ? 2 : 1.3);
        m.score++;
        g.ev.push({ t: 'sfx', id: 'boing' });
        if (m.score >= m.goal) {
          finish(g, m, n[5]! <= 2 ? 3 : n[5]! <= 7 ? 2 : 1);
          return;
        }
      } else g.ev.push({ t: 'sfx', id: 'swing' });
    }
    if (n[2]! >= KEEPY.ground) {
      // It touched the grass. No harm done: it bobs back up.
      n[5] = n[5]! + 1;
      n[4] = -3.4;
      n[3] = (rand(g) * 2 - 1) * 1.2;
      n[2] = KEEPY.ground - 0.05;
      m.msg = 'oops';
      g.ev.push({ t: 'sfx', id: 'bonk' });
      if (n[5]! >= 20) finish(g, m, 1, 'mini_why_drops');
    }
  },
};

// ---------------------------------------------------------------- Puddle jump
// Three parts that get a little faster (part 2 adds hop-hop pairs, part 3 has more of them), then the big finish
// puddle: she stops at the run-up line, a marker swings along a bar and Space on the green makes the biggest splash.
// n: 0 position, 1 jump time left (0 = on the ground), 2 next puddle index, 3 where the jump began,
//    4 phase (0 running, 1 the timing bar, 2 the big jump, 3 splashing about), 5 bar marker 0..1, 6 phase timer,
//    7 how good the big jump was (1..3), 8 start of part 2, 9 start of part 3, 10 the run-up line, 11 part (0..2)
// objs: the puddles. k 1 for a big one; a 0 ahead, 1 splashed, 2 missed; vx the take-off spot; vy its part
export const PUDDLES = {
  speeds: [3.3, 3.7, 4.1],
  jump: 0.62,
  small: 0.95,
  big: 1.15,
  counts: [10, 11, 11],
  /** the puddles (by place in their part) that sit one hop after the one before */
  pairs: [[], [2, 6], [2, 5, 8]] as number[][],
  first: 6,
  gap: 5.2,
  /** seconds for the marker to cross the bar once */
  barSweep: 0.9,
  /** half widths on the bar (0..1) of the perfect and the good zones */
  barPerfect: 0.1,
  barGood: 0.28,
  barWait: 7,
  bigJump: 1.1,
  bigLen: 4.2,
  splashT: 1.8,
};
/** How far a jump carries her in a part: the rules count whole 1/60 s steps until the jump time runs out. */
/** Cup tiers: the landing room and the timing bar's zones (times the usual). */
export const PUDDLE_CUP = [1, 0.75, 0.6];
/** Cup tiers: the score for 3 stars (out of 35). */
export const PUDDLE_THREE = [28, 31, 33];
export function puddleLeap(part: number): number {
  return (Math.ceil(PUDDLES.jump * 60 - 1e-9) * PUDDLES.speeds[part]!) / 60;
}
const puddles: MiniDef = {
  goal: PUDDLES.counts[0]! + PUDDLES.counts[1]! + PUDDLES.counts[2]! + 3,
  init(_g, m) {
    m.n = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    m.objs = [];
    let x = PUDDLES.first - PUDDLES.gap;
    for (let part = 0; part < 3; part++) {
      const count = PUDDLES.counts[part]!;
      for (let i = 0; i < count; i++) {
        const pair = PUDDLES.pairs[part]!.includes(i);
        x += pair ? puddleLeap(part) + 0.5 : PUDDLES.gap + (i % 3) * 0.6;
        m.objs.push({ x, y: 0, vx: x - puddleLeap(part), vy: part, k: i >= count - 3 && !pair ? 1 : 0, a: 0 });
      }
      if (part < 2) {
        m.n[8 + part] = x + 2.2;
        x += 3;
      }
    }
    m.n[10] = x + 4.5;
  },
  step(g, m, inp) {
    const n = m.n;
    n[6] = n[6]! + dt;
    if (n[4] === 1) {
      // the timing bar: the marker runs to and fro; Space (or a long wait) sets her off
      const u = (n[6]! / PUDDLES.barSweep) % 2;
      n[5] = u < 1 ? u : 2 - u;
      if ((inp.act && n[6]! > 0.4) || n[6]! > PUDDLES.barWait) {
        const off = Math.abs(n[5]! - 0.5);
        const kind = (g.s.opts.gentle ? 1.3 : 1) * PUDDLE_CUP[hard(m)]!;
        n[7] = !inp.act ? 1 : off < PUDDLES.barPerfect * kind ? 3 : off < PUDDLES.barGood * kind ? 2 : 1;
        n[4] = 2;
        n[6] = 0;
        n[3] = n[0]!;
        g.ev.push({ t: 'sfx', id: 'hop' });
        g.ev.push({ t: 'sfx', id: 'whoosh' });
      }
      return;
    }
    if (n[4] === 2) {
      // the big jump: a long arc into the middle of the finish puddle
      n[0] = n[3]! + PUDDLES.bigLen * Math.min(1, n[6]! / PUDDLES.bigJump);
      if (n[6]! >= PUDDLES.bigJump) {
        n[4] = 3;
        n[6] = 0;
        m.score += n[7]!;
        g.ev.push({ t: 'sfx', id: 'splash' });
        g.ev.push({ t: 'shake', amt: 4 + n[7]! * 4 });
        if (n[7]! >= 3) g.ev.push({ t: 'sfx', id: 'sparkle' });
      }
      return;
    }
    if (n[4] === 3) {
      if (n[6]! >= PUDDLES.splashT) finish(g, m, m.score >= PUDDLE_THREE[hard(m)]! ? 3 : m.score >= 16 ? 2 : 1);
      return;
    }
    const part = n[0]! >= n[9]! ? 2 : n[0]! >= n[8]! ? 1 : 0;
    if (part !== n[11]) {
      n[11] = part;
      g.ev.push({ t: 'sfx', id: 'go' });
    }
    n[0] = n[0]! + PUDDLES.speeds[part]! * dt;
    if (n[1]! > 0) {
      n[1] = n[1]! - dt;
      if (n[1]! <= 0) {
        const land = n[0]!;
        // puddles she sailed right over are behind her now
        const room = PUDDLE_CUP[hard(m)]!;
        let p = m.objs[n[2]!];
        while (p && land > p.x + (p.k ? PUDDLES.big : PUDDLES.small) * room) {
          p.a = 2;
          n[2] = n[2]! + 1;
          p = m.objs[n[2]!];
        }
        if (p && Math.abs(land - p.x) < (p.k ? PUDDLES.big : PUDDLES.small) * room) {
          p.a = 1;
          m.score++;
          n[2] = n[2]! + 1;
          g.ev.push({ t: 'sfx', id: 'splash' });
          g.ev.push({ t: 'shake', amt: p.k ? 9 : 3 });
        } else g.ev.push({ t: 'sfx', id: 'step' });
      }
    } else if (inp.act && n[2]! < m.objs.length) {
      n[1] = PUDDLES.jump;
      n[3] = n[0]!;
      g.ev.push({ t: 'sfx', id: 'hop' });
    }
    const p = m.objs[n[2]!];
    if (p && n[0]! > p.x + 1.4 && n[1]! <= 0) {
      p.a = 2;
      n[2] = n[2]! + 1;
    }
    // every puddle is behind her: run up to the line and stop for the big one
    if (n[2]! >= m.objs.length && n[1]! <= 0 && n[0]! >= n[10]!) {
      n[0] = n[10]!;
      n[4] = 1;
      n[6] = 0;
      g.ev.push({ t: 'sfx', id: 'chime' });
    }
  },
};

// ---------------------------------------------------------------- Hide and seek
// Three rounds on a lawn of hiding places. She counts at the base while three friends hide, then walks about and
// peeks. Each round has more places and a twist: round 2 a hidden friend giggles out loud now and then (the place
// shakes, wherever she is); round 3 one friend creeps to a new place after the first is found.
// n: 0 hero x, 1 hero y, 2 found this round, 3 wrong looks (all rounds), 4 move cooldown, 5 round (0..2),
//    6 phase (0 counting, 1 seeking, 2 peeking, 3 all found: a cheer, 4 found one: a hello), 7 phase timer
//    (counts down),
//    8 the place she is peeking into, 9 time to the next loud giggle, 10 1 once a friend has moved this round,
//    11 time left of the move (the view shows the dash), 12 where the mover left, 13 where she went (-1 nobody),
//    14 seconds since she last found someone this round (the loud giggles come sooner the longer it is)
// objs: this round's hiding places. k 0 not looked, 1 empty, 2 a friend found; vx 0 nobody, else which friend
//    hides there (1..3); a seconds she has been giggling with the seeker close by; vy seconds left of a loud giggle
export const HIDE = {
  w: 11,
  h: 6,
  home: [5, 3] as [number, number],
  places: [9, 11, 13],
  /** seconds she counts to ten before each round */
  count: 3.3,
  /** seconds of rustling before a place shows who is in it, and of "found you!" after */
  peek: 0.6,
  found: 0.8,
  cheer: 2.2,
  /** seconds a step takes */
  pace: 0.2,
  /** seconds without a find before round 1's friends start giggling out loud, and before every round's come
   * often (so a seeker who cannot work it out is always shown the way in the end), and how often then */
  clueFirst: 12,
  clueSoon: 24,
  clueGap: [6, 5, 7] as number[],
  clueSoonGap: 3,
  /** every cell a hiding place can be on: no two touch, even at a corner, so she can always walk round them */
  pool: [
    [1, 0],
    [5, 0],
    [8, 0],
    [3, 1],
    [10, 1],
    [0, 2],
    [6, 2],
    [8, 2],
    [2, 3],
    [4, 3],
    [10, 3],
    [7, 4],
    [0, 5],
    [3, 5],
    [5, 5],
    [9, 5],
  ] as [number, number][],
};
/** Cup tiers: the most wrong looks for 3 stars and for 2. */
export const HIDE_CUP = [
  [4, 12],
  [4, 10],
  [3, 8],
];
function hideRound(g: Game, m: MiniRt, round: number): void {
  const n = m.n;
  const cells = HIDE.pool.slice();
  for (let i = cells.length - 1; i > 0; i--) {
    const j = randInt(g, 0, i);
    const c = cells[i]!;
    cells[i] = cells[j]!;
    cells[j] = c;
  }
  // (the first three places of the shuffled list hide a friend; the view draws places by their cell, not their order)
  m.objs = cells.slice(0, HIDE.places[round]!).map(([x, y], i) => ({ x, y, vx: i < 3 ? i + 1 : 0, vy: 0, k: 0, a: 0 }));
  m.objs.sort((a, b) => a.y - b.y || a.x - b.x);
  n[0] = HIDE.home[0];
  n[1] = HIDE.home[1];
  n[2] = 0;
  n[4] = 0;
  n[5] = round;
  n[6] = 0;
  n[7] = HIDE.count;
  n[8] = -1;
  n[9] = 3;
  n[10] = 0;
  n[11] = 0;
  n[12] = -1;
  n[13] = -1;
  n[14] = 0;
}
/**
 * The place Space looks in: one beside her (a friend first when two are), else one at a corner of her cell.
 * -1 when there is none. The view marks the same place.
 */
export function hideLook(m: MiniRt): number {
  const n = m.n;
  let best = -1;
  let corner = -1;
  for (let i = 0; i < m.objs.length; i++) {
    const o = m.objs[i]!;
    if (o.k !== 0) continue;
    const dx = Math.abs(o.x - n[0]!);
    const dy = Math.abs(o.y - n[1]!);
    if (dx + dy === 1) {
      if (best < 0 || o.vx > m.objs[best]!.vx) best = i;
    } else if (dx === 1 && dy === 1 && (corner < 0 || o.vx > m.objs[corner]!.vx)) corner = i;
  }
  return best >= 0 ? best : corner;
}
const hide: MiniDef = {
  goal: 9,
  leave: true,
  init(g, m) {
    m.n = [HIDE.home[0], HIDE.home[1], 0, 0, 0, 0, 0, 0, -1, 0, 0, 0, -1, -1, 0];
    hideRound(g, m, 0);
  },
  step(g, m, inp) {
    const n = m.n;
    n[7] = Math.max(0, n[7]! - dt);
    if (n[11]! > 0) n[11] = Math.max(0, n[11]! - dt);
    if (n[6] === 0) {
      // counting at the base: a tick for every number, then off she goes
      const per = HIDE.count / 10;
      if (Math.floor(n[7]! / per) !== Math.floor((n[7]! + dt) / per) && n[7]! > 0) g.ev.push({ t: 'sfx', id: 'tick' });
      if (n[7]! <= 0) {
        n[6] = 1;
        g.ev.push({ t: 'sfx', id: 'go' });
      }
      return;
    }
    if (n[6] === 4) {
      if (n[7]! <= 0) n[6] = 1;
      return;
    }
    if (n[6] === 3) {
      if (n[7]! > 0) return;
      if (n[5]! >= 2) {
        const [three, two] = HIDE_CUP[hard(m)]!;
        finish(g, m, n[3]! <= three! ? 3 : n[3]! <= two! ? 2 : 1);
      } else hideRound(g, m, n[5]! + 1);
      return;
    }
    if (n[6] === 2) {
      // the peek: a rustle, a held breath, then whoever is (or is not) there
      if (n[7]! > 0) return;
      const o = m.objs[n[8]!]!;
      n[6] = 1;
      if (o.vx) {
        n[6] = 4;
        n[7] = HIDE.found;
        o.k = 2;
        o.a = 0;
        o.vy = 0;
        n[2] = n[2]! + 1;
        n[14] = 0;
        m.score = n[5]! * 3 + n[2]!;
        g.ev.push({ t: 'sfx', id: 'found' });
        if (n[2]! >= 3) {
          n[6] = 3;
          n[7] = HIDE.cheer;
          g.ev.push({ t: 'sfx', id: 'sparkle' });
        } else if (n[5] === 2 && !n[10]) {
          // round 3: while she is busy with the first friend, another one creeps somewhere new
          n[10] = 1;
          const from = m.objs.findIndex((p) => p.vx && p.k === 0);
          const free = m.objs.map((p, i) => (!p.vx && p.k === 0 && i !== from ? i : -1)).filter((i) => i >= 0);
          if (from >= 0 && free.length) {
            const to = free[randInt(g, 0, free.length - 1)]!;
            m.objs[to]!.vx = m.objs[from]!.vx;
            m.objs[from]!.vx = 0;
            m.objs[from]!.a = 0;
            m.objs[from]!.vy = 0;
            n[11] = 1;
            n[12] = from;
            n[13] = to;
            g.ev.push({ t: 'sfx', id: 'rustle' });
            g.ev.push({ t: 'sfx', id: 'giggle' });
          }
        }
      } else {
        o.k = 1;
        n[3] = n[3]! + 1;
        g.ev.push({ t: 'sfx', id: 'nope' });
      }
      return;
    }
    // seeking
    if (n[4]! > 0) n[4] = n[4]! - dt;
    if ((inp.mx || inp.my) && n[4]! <= 0) {
      const nx = Math.max(0, Math.min(HIDE.w - 1, n[0]! + inp.mx));
      const ny = Math.max(0, Math.min(HIDE.h - 1, n[1]! + (inp.mx ? 0 : inp.my)));
      const into = m.objs.findIndex((o) => o.x === nx && o.y === ny);
      if (into < 0) {
        n[0] = nx;
        n[1] = ny;
        g.ev.push({ t: 'sfx', id: 'step' });
      } else if (m.objs[into]!.k === 0 && (nx !== n[0] || ny !== n[1])) {
        // walking into a hiding place looks in it, as a child would (G, build 5: Space alone was not found)
        n[4] = HIDE.pace * 2;
        n[6] = 2;
        n[7] = HIDE.peek;
        n[8] = into;
        g.ev.push({ t: 'sfx', id: 'rustle' });
        return;
      }
      n[4] = HIDE.pace;
    }
    for (const o of m.objs) {
      // A hidden friend cannot help giggling when she is close.
      const near = Math.abs(o.x - n[0]!) <= 1 && Math.abs(o.y - n[1]!) <= 1;
      o.a = near && o.vx && o.k === 0 ? o.a + dt : 0;
      if (o.a > 0 && Math.floor(o.a * 60) % 70 === 1) g.ev.push({ t: 'sfx', id: 'giggle' });
      if (o.vy > 0) o.vy = Math.max(0, o.vy - dt);
    }
    // from round 2 a hidden friend giggles out loud now and then, so she knows which way to go; in round 1 only once
    // she has looked a while without finding anyone; and in any round, the longer she goes without a find, the more
    // often (issue 17: a seeker stuck near the start was never shown the way)
    n[14] = n[14]! + dt;
    const since = n[14]!;
    const gap =
      since >= HIDE.clueSoon ? HIDE.clueSoonGap : n[5]! >= 1 || since >= HIDE.clueFirst ? HIDE.clueGap[n[5]!]! : 0;
    if (gap > 0) {
      n[9] = Math.min(n[9]!, gap) - dt;
      if (n[9]! <= 0) {
        const hidden = m.objs.filter((o) => o.vx && o.k === 0);
        if (hidden.length) {
          hidden[randInt(g, 0, hidden.length - 1)]!.vy = 1.3;
          g.ev.push({ t: 'sfx', id: 'giggle' });
        }
        n[9] = gap;
      }
    }
    if (!inp.act) return;
    const best = hideLook(m);
    if (best < 0) return;
    n[6] = 2;
    n[7] = HIDE.peek;
    n[8] = best;
    g.ev.push({ t: 'sfx', id: 'rustle' });
  },
};

// ---------------------------------------------------------------- Race round the park
// Three laps of a winding course twice the size of the screen (the view follows her). Running on the grass or
// through a puddle is slow; a boost pad is a burst of speed. The puddles and pads change each lap, and in lap 3
// the hedge gate opens: a short cut along the bottom. The rival keeps close whatever she does (he eases off when
// he is ahead and digs in when he is behind), so the finish is always a near thing.
// n: 0 hero x, 1 hero y, 2 next flag, 3 rival's distance round his lap, 4 the time the rival finished (0 = not yet),
//    5 countdown before the start, 6 her laps done, 7 rival's laps done, 8 boost seconds left,
//    9 how far she still has to run, 10 the ground under her (0 track, 1 grass, 2 puddle), 11 rival x, 12 rival y,
//    13 how far the rival still has to run, 14 her place at the end (1 or 2)
// objs: her lap's flags in order (k 0 ahead, 1 passed), then the lap's props (k 10 puddle, 11 boost pad; a pulses
//    when she touches one)
export interface Course {
  pts: [number, number][];
  /** distance from the start line to each point, and (last entry) all the way round */
  cum: number[];
  len: number;
}
function course(pts: [number, number][]): Course {
  const cum = [0];
  for (let i = 1; i <= pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i % pts.length]!;
    cum.push(cum[i - 1]! + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  return { pts, cum, len: cum[pts.length]! };
}
/** The point a distance s round a course, off steps to the right of the running line. */
export function courseAt(c: Course, s: number, off = 0): [number, number] {
  const u = ((s % c.len) + c.len) % c.len;
  let i = 0;
  while (i < c.pts.length - 1 && c.cum[i + 1]! <= u) i++;
  const a = c.pts[i]!;
  const b = c.pts[(i + 1) % c.pts.length]!;
  const seg = c.cum[i + 1]! - c.cum[i]! || 1;
  const f = (u - c.cum[i]!) / seg;
  const dx = (b[0] - a[0]) / seg;
  const dy = (b[1] - a[1]) / seg;
  return [a[0] + (b[0] - a[0]) * f - dy * off, a[1] + (b[1] - a[1]) * f + dx * off];
}
function courseDist(c: Course, x: number, y: number): number {
  let best = 1e9;
  for (let i = 0; i < c.pts.length; i++) {
    const a = c.pts[i]!;
    const b = c.pts[(i + 1) % c.pts.length]!;
    const vx = b[0] - a[0];
    const vy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((x - a[0]) * vx + (y - a[1]) * vy) / (vx * vx + vy * vy || 1)));
    best = Math.min(best, Math.hypot(x - a[0] - vx * t, y - a[1] - vy * t));
  }
  return best;
}
const RACE_LONG = course([
  [10, 3],
  [26, 3],
  [29, 6],
  [29, 13],
  [26, 15.5],
  [21, 15.5],
  [19, 13],
  [19, 9.5],
  [13, 9.5],
  [13, 13],
  [11, 15.5],
  [6, 15.5],
  [3, 13],
  [3, 6],
  [6, 3],
]);
const RACE_SHORT = course([
  [10, 3],
  [26, 3],
  [29, 6],
  [29, 13],
  [26, 15.5],
  [21, 15.5],
  [16, 15.5],
  [11, 15.5],
  [6, 15.5],
  [3, 13],
  [3, 6],
  [6, 3],
]);
export const RACE = {
  w: 32,
  h: 18,
  /** half the width of the track */
  half: 1.5,
  speed: 5,
  grass: 0.6,
  wet: 0.5,
  boost: 1.55,
  boostT: 1.3,
  /** how close she must come to a flag */
  reach: 1.7,
  puddleR: 1,
  padR: 0.95,
  countdown: 2.4,
  /** the course of each lap: the short cut is open in lap 3 */
  laps: [RACE_LONG, RACE_LONG, RACE_SHORT] as Course[],
  /** where the puddles and pads lie in each lap: [how far round the lap (0..1), steps off the running line] */
  puddles: [
    [
      [0.2, 0.5],
      [0.47, -0.4],
      [0.8, 0.3],
    ],
    [
      [0.1, -0.5],
      [0.33, 0.4],
      [0.6, -0.2],
      [0.9, 0.5],
    ],
    [
      [0.16, 0.3],
      [0.46, -0.5],
      [0.74, 0.4],
    ],
  ] as [number, number][][],
  pads: [
    [],
    [
      [0.26, -0.6],
      [0.7, 0.6],
    ],
    [
      [0.08, -0.6],
      [0.34, 0.6],
      [0.6, -0.5],
    ],
  ] as [number, number][][],
  /** the ponds [middle x, middle y, width, height]: she can wade through one, slowly */
  ponds: [
    [16, 6.2, 11, 2.2],
    [16, 12.4, 2.2, 1.6],
  ] as [number, number, number, number][],
  /** the rival: his pace when level, how hard the gap pulls him, and his limits */
  rival: { base: 4.6, pull: 0.4, min: 2.4, max: 6, off: -0.7 },
  limit: 200,
};
/** Cup tiers: how much quicker the rival runs. */
export const RACE_CUP = [0, 0.3, 0.55];
function raceLap(m: MiniRt, lap: number): void {
  const c = RACE.laps[lap]!;
  m.objs = [];
  for (let i = 0; i < c.pts.length; i++) {
    const p = c.pts[(i + 1) % c.pts.length]!;
    m.objs.push({ x: p[0], y: p[1], vx: 0, vy: 0, k: 0, a: 0 });
  }
  for (const [f, off] of RACE.puddles[lap]!) {
    const p = courseAt(c, f * c.len, off);
    m.objs.push({ x: p[0], y: p[1], vx: 0, vy: 0, k: 10, a: 0 });
  }
  for (const [f, off] of RACE.pads[lap]!) {
    const p = courseAt(c, f * c.len, off);
    m.objs.push({ x: p[0], y: p[1], vx: 0, vy: 0, k: 11, a: 0 });
  }
}
/** How far someone on lap `lap`, a distance `s` round it, still has to run. */
function raceLeft(lap: number, s: number): number {
  let left = 0;
  for (let l = lap; l < RACE.laps.length; l++) left += RACE.laps[l]!.len;
  return left - s;
}
const race: MiniDef = {
  goal: RACE.laps.reduce((sum, c) => sum + c.pts.length, 0),
  init(_g, m) {
    const r = courseAt(RACE_LONG, 0, RACE.rival.off);
    m.n = [10, 3.8, 0, 0, 0, RACE.countdown, 0, 0, 0, raceLeft(0, 0), 0, r[0], r[1], raceLeft(0, 0), 0];
    raceLap(m, 0);
  },
  step(g, m, inp) {
    const n = m.n;
    if (n[5]! > 0) {
      // ready, steady...
      const was = Math.ceil(n[5]! / 0.8);
      n[5] = Math.max(0, n[5]! - dt);
      if (Math.ceil(n[5]! / 0.8) !== was) g.ev.push({ t: 'sfx', id: n[5]! > 0 ? 'tick' : 'go' });
      return;
    }
    const lap = Math.min(2, n[6]!);
    const c = RACE.laps[lap]!;
    // the ground under her, and anything she is standing on
    let ground = courseDist(c, n[0]!, n[1]!) <= RACE.half ? 0 : 1;
    for (const [px, py, pw, ph] of RACE.ponds)
      if (Math.abs(n[0]! - px) < pw / 2 && Math.abs(n[1]! - py) < ph / 2) {
        if (n[10] !== 2) g.ev.push({ t: 'sfx', id: 'splash' });
        ground = 2;
      }
    for (const o of m.objs) {
      if (o.a > 0) o.a = Math.max(0, o.a - dt);
      if (o.k === 10 && Math.hypot(o.x - n[0]!, o.y - n[1]!) < RACE.puddleR) {
        if (n[10] !== 2) {
          o.a = 0.5;
          g.ev.push({ t: 'sfx', id: 'splash' });
        }
        ground = 2;
      } else if (o.k === 11 && n[8]! <= 0 && Math.hypot(o.x - n[0]!, o.y - n[1]!) < RACE.padR) {
        n[8] = RACE.boostT;
        o.a = 0.6;
        g.ev.push({ t: 'sfx', id: 'whoosh' });
      }
    }
    n[10] = ground;
    if (n[8]! > 0) n[8] = Math.max(0, n[8]! - dt);
    let mx = inp.mx;
    let my = inp.my;
    if (mx && my) {
      mx *= Math.SQRT1_2;
      my *= Math.SQRT1_2;
    }
    const v = RACE.speed * (ground === 2 ? RACE.wet : ground === 1 ? RACE.grass : 1) * (n[8]! > 0 ? RACE.boost : 1);
    n[0] = Math.max(0.5, Math.min(RACE.w - 0.5, n[0]! + mx * v * dt));
    n[1] = Math.max(0.5, Math.min(RACE.h - 0.5, n[1]! + my * v * dt));
    const per = c.pts.length;
    const gate = m.objs[n[2]!];
    let done = false;
    // a flag counts when she comes near it; the last one of a lap is the line itself, and she must run over it
    const line = n[2] === per - 1;
    const through =
      gate &&
      (line
        ? n[0]! >= gate.x && n[0]! < gate.x + 3 && Math.abs(n[1]! - gate.y) < RACE.half + 0.8
        : Math.hypot(gate.x - n[0]!, gate.y - n[1]!) < RACE.reach);
    if (gate && n[2]! < per && through) {
      gate.k = 1;
      n[2] = n[2]! + 1;
      m.score++;
      g.ev.push({ t: 'sfx', id: 'gate' });
      if (n[2]! >= per) {
        n[6] = n[6]! + 1;
        if (n[6]! >= RACE.laps.length) done = true;
        else {
          n[2] = 0;
          raceLap(m, n[6]!);
          g.ev.push({ t: 'sfx', id: 'go' });
        }
      }
    }
    // how far she still has to run: the flags behind her, and how near the next one is
    if (done) n[9] = 0;
    else {
      const hl = Math.min(2, n[6]!);
      const hc = RACE.laps[hl]!;
      const next = m.objs[n[2]!]!;
      const seg = hc.cum[n[2]! + 1]! - hc.cum[n[2]!]!;
      const d = Math.hypot(next.x - n[0]!, next.y - n[1]!);
      n[9] = raceLeft(hl, hc.cum[n[2]!]! + Math.max(0, Math.min(seg, seg - d)));
    }
    // the rival: level pace, pulled by the gap between them
    if (!n[4]) {
      const rc = RACE.laps[Math.min(2, n[7]!)]!;
      const gap = n[13]! - n[9]!;
      const R = RACE.rival;
      const base = R.base - (g.s.opts.gentle ? 0.25 : 0) + RACE_CUP[hard(m)]!;
      const pace = Math.max(R.min, Math.min(R.max, base + R.pull * gap));
      n[3] = n[3]! + pace * dt;
      if (n[3]! >= rc.len) {
        n[3] = n[3]! - rc.len;
        n[7] = n[7]! + 1;
        if (n[7]! >= RACE.laps.length) {
          n[3] = 0;
          n[4] = m.t;
          g.ev.push({ t: 'sfx', id: 'bell' });
        }
      }
      const rl = Math.min(2, n[7]!);
      const p = courseAt(RACE.laps[rl]!, n[3]!, R.off);
      n[11] = p[0];
      n[12] = p[1];
      n[13] = n[4] ? 0 : raceLeft(rl, n[3]!);
    }
    if (done) {
      n[14] = n[4] ? 2 : 1;
      finish(g, m, !n[4] ? 3 : m.t - n[4]! < 8 ? 2 : 1);
    } else if (m.t > RACE.limit) {
      n[14] = n[4] ? 2 : 1;
      finish(g, m, 1, 'mini_why_time');
    }
  },
};

// ---------------------------------------------------------------- Claw machine
// Three tries. The claw hangs on its cable and swings: a little when the carriage is still, a lot while it moves.
// Space drops it where it hangs. Over a prize it grabs it; if not it comes up empty and she goes again. The third
// try never misses: the nearest prize slides into its grip. The prize rides to the chute and drops out.
// n: 0 carriage x, 1 state (0 aiming, 1 dropping, 2 lifting a prize, 3 lifting nothing, 4 carrying to the chute,
//    5 the prize falls out), 2 claw y, 3 prize grabbed (-1 none), 4 tries used so far (0..2), 5 swing angle,
//    6 swing size, 7 claw x (where it hangs or fell), 8 seconds aiming this try, 9 how far off the grab was
// objs: prizes; k is the prize's place in the list
export const CLAW = {
  w: 10,
  top: 1,
  floor: 6.2,
  tries: 3,
  /** how near the claw must fall to a prize to grab it (wider on Gentle) */
  grab: 0.42,
  grabGentle: 0.6,
  chute: 0.9,
  /** swing: seconds there and back, and how far it swings still and moving */
  period: 1.5,
  still: 0.26,
  moving: 0.8,
  /** she is given this long to aim before the claw drops by itself */
  wait: 12,
};
export const CLAW_PRIZES = [
  'toy_block',
  'toy_train',
  'toy_robot',
  'toy_rocket',
  'alien_plush',
  'toy_drum',
  'toy_boat',
  'dino_blue',
];
/** Cup tiers: how near the claw must fall (times the usual). */
export const CLAW_CUP = [1, 0.7, 0.5];
function clawPrize(g: Game, m: MiniRt): void {
  const won = (g.s.counts.clawWon ?? 0) % CLAW_PRIZES.length;
  const id = CLAW_PRIZES[won]!;
  g.s.counts.clawWon = (g.s.counts.clawWon ?? 0) + 1;
  m.msg = id;
  give(g, id, 1);
  meet(g, 'alien');
}
const claw: MiniDef = {
  goal: 1,
  init(g, m) {
    m.n = [5, 0, CLAW.top, -1, 0, 0, CLAW.still, 5, 0, 0];
    m.objs = [];
    for (let i = 0; i < 6; i++)
      m.objs.push({ x: 2.3 + i * 1.36 + rand(g) * 0.3, y: CLAW.floor, vx: 0, vy: 0, k: i, a: 0 });
  },
  step(g, m, inp) {
    const n = m.n;
    if (n[1] === 0) {
      n[0] = Math.max(0.8, Math.min(CLAW.w - 0.8, n[0]! + inp.mx * 3.4 * dt));
      n[5] = n[5]! + ((Math.PI * 2) / CLAW.period) * dt;
      n[6] = n[6]! + ((inp.mx ? CLAW.moving : CLAW.still) - n[6]!) * (inp.mx ? 3 : 1.6) * dt;
      n[7] = n[0]! + Math.sin(n[5]!) * n[6]!;
      n[8] = n[8]! + dt;
      if ((inp.act && n[8]! > 0.25) || n[8]! > CLAW.wait) {
        n[1] = 1;
        g.ev.push({ t: 'sfx', id: 'claw' });
      }
      return;
    }
    if (n[1] === 1) {
      n[2] = n[2]! + 2.6 * dt;
      if (n[2]! >= CLAW.floor - 0.5) {
        let best = 0;
        for (let i = 1; i < m.objs.length; i++)
          if (Math.abs(m.objs[i]!.x - n[7]!) < Math.abs(m.objs[best]!.x - n[7]!)) best = i;
        const off = Math.abs(m.objs[best]!.x - n[7]!);
        // The third try always comes up with something: the nearest prize slides into its grip.
        const grab = (g.s.opts.gentle ? CLAW.grabGentle : CLAW.grab) * CLAW_CUP[hard(m)]!;
        if (off < grab || n[4]! >= CLAW.tries - 1) {
          n[3] = best;
          n[9] = off;
          n[1] = 2;
          g.ev.push({ t: 'sfx', id: 'grab' });
        } else {
          n[1] = 3;
          g.ev.push({ t: 'sfx', id: 'nope' });
        }
      }
      return;
    }
    if (n[1] === 3) {
      // (the claw swings back under the carriage on its way up, so nothing jumps at the top)
      n[2] = n[2]! - 3.2 * dt;
      n[7] = n[7]! + (n[0]! - n[7]!) * 0.12;
      if (n[2]! <= CLAW.top) {
        n[2] = CLAW.top;
        n[4] = n[4]! + 1;
        n[1] = 0;
        n[8] = 0;
        n[7] = n[0]!;
        n[5] = 0;
        n[6] = CLAW.still;
        g.ev.push({ t: 'sfx', id: 'go' });
      }
      return;
    }
    const o = m.objs[n[3]!]!;
    if (n[1] === 2) {
      n[7] = n[7]! + (n[0]! - n[7]!) * 0.06;
      o.x += (n[7]! - o.x) * 0.2;
      n[2] = Math.max(CLAW.top, n[2]! - 2.2 * dt);
      o.y = n[2]! + 0.5;
      if (n[2]! <= CLAW.top) {
        n[1] = 4;
        n[7] = n[0]!;
      }
      return;
    }
    if (n[1] === 4) {
      n[0] = Math.max(CLAW.chute, n[0]! - 2.4 * dt);
      n[7] = n[0]!;
      o.x = n[0]!;
      if (n[0]! <= CLAW.chute) {
        n[1] = 5;
        g.ev.push({ t: 'sfx', id: 'pop' });
      }
      return;
    }
    o.y += 7 * dt;
    if (o.y >= CLAW.floor + 0.9) {
      clawPrize(g, m);
      m.score = 1;
      finish(g, m, n[4] === 0 ? 3 : n[4] === 1 || (n[9]! < 1 && !hard(m)) ? 2 : 1);
    }
  },
};

// ---------------------------------------------------------------- Snowball fight (Christmas layer)
// Three waves of friends popping up behind the snow forts, each wave a little quicker. From wave 2 a friend
// sometimes throws one back: it lands where she stood, so she can step aside (a hit is only a splat, a laugh and a
// moment with snow on her nose). Once a wave a snowman slides along the back: he is worth 3.
// n: 0 hero x, 1 throw cooldown, 2 friends shown this wave, 3 time to the next friend, 4 wave (0..2),
//    5 time left of the wave's opening (no friends yet), 6 seconds of snow on her nose (she cannot throw),
//    7 times she was splatted, 8 1 once this wave's snowman has come, 9 time to the next throw back
// objs: k 0 a friend (a = time left, vx 1 when hit, vy seconds of throwing pose), k 1 her snowball,
//    k 2 a snowball coming back (vx, vy its speed, a time until it lands), k 3 the snowman (vx his speed,
//    vy 1 when hit, a time left)
export const SNOW = {
  w: 12,
  h: 7,
  waves: [8, 10, 12],
  gaps: [1.8, 1.5, 1.25],
  opening: [1.6, 2.2, 2.2],
  /** seconds between throws back in each wave (0 = nobody throws) */
  back: [0, 3.6, 2.8],
  flight: 1.4,
  snowman: 3,
  /** seconds a friend stays up (longer on Gentle), and how much of that in each wave */
  stay: 2.6,
  stayGentle: 3.4,
  stays: [1, 0.9, 0.8],
};
/** Cup tiers: how long a friend stays up and the gap between them (times the usual). */
export const SNOW_CUP = [1, 0.8, 0.66];
const snowball: MiniDef = {
  goal: SNOW.waves[0]! + SNOW.waves[1]! + SNOW.waves[2]! + 3 * SNOW.snowman,
  init(_g, m) {
    m.n = [6, 0, 0, 0.3, 0, SNOW.opening[0]!, 0, 0, 0, 2];
    m.objs = [];
  },
  step(g, m, inp) {
    const n = m.n;
    const wave = n[4]!;
    n[0] = Math.max(0.6, Math.min(SNOW.w - 0.6, n[0]! + inp.mx * 6 * dt));
    if (n[1]! > 0) n[1] = n[1]! - dt;
    if (n[6]! > 0) n[6] = Math.max(0, n[6]! - dt);
    if (inp.act && n[1]! <= 0 && n[6]! <= 0) {
      n[1] = 0.35;
      m.objs.push({ x: n[0]!, y: SNOW.h - 1.2, vx: 0, vy: -9, k: 1, a: 0 });
      g.ev.push({ t: 'sfx', id: 'throw' });
    }
    if (n[5]! > 0) n[5] = n[5]! - dt;
    else {
      n[3] = n[3]! - dt;
      if (n[3]! <= 0 && n[2]! < SNOW.waves[wave]!) {
        n[3] = SNOW.gaps[wave]! * SNOW_CUP[hard(m)]!;
        n[2] = n[2]! + 1;
        // not on top of a friend who is already up
        let x = 0;
        for (let tries = 0; tries < 6; tries++) {
          x = 1.2 + rand(g) * (SNOW.w - 2.4);
          if (!m.objs.some((o) => o.k === 0 && Math.abs(o.x - x) < 1.7)) break;
        }
        m.objs.push({
          x,
          y: 1 + rand(g) * 1.6,
          vx: 0,
          vy: 0,
          k: 0,
          a: (g.s.opts.gentle ? SNOW.stayGentle : SNOW.stay) * SNOW.stays[wave]! * SNOW_CUP[hard(m)]!,
        });
        g.ev.push({ t: 'sfx', id: 'pop' });
      }
      // the snowman comes by half way through the wave
      if (!n[8] && n[2]! >= SNOW.waves[wave]! / 2) {
        n[8] = 1;
        const left = rand(g) < 0.5;
        const v = 1.5 + wave * 0.35;
        m.objs.push({ x: left ? 0.4 : SNOW.w - 0.4, y: 0.35, vx: left ? v : -v, vy: 0, k: 3, a: (SNOW.w - 0.8) / v });
        g.ev.push({ t: 'sfx', id: 'bell' });
      }
      // a friend throws one back at where she stands
      if (SNOW.back[wave]! > 0) {
        n[9] = n[9]! - dt;
        if (n[9]! <= 0) {
          const up = m.objs.filter((o) => o.k === 0 && !o.vx && o.a > 1);
          if (up.length) {
            const f = up[randInt(g, 0, up.length - 1)]!;
            const T = SNOW.flight * (g.s.opts.gentle ? 1.25 : 1);
            f.vy = 0.5;
            m.objs.push({ x: f.x, y: f.y, vx: (n[0]! - f.x) / T, vy: (SNOW.h - 0.9 - f.y) / T, k: 2, a: T });
            g.ev.push({ t: 'sfx', id: 'throw' });
            n[9] = SNOW.back[wave]!;
          } else n[9] = 0.4;
        }
      }
    }
    let live = 0;
    for (let i = m.objs.length - 1; i >= 0; i--) {
      const o = m.objs[i]!;
      if (o.k === 1) {
        o.y += o.vy * dt;
        let gone = o.y < -0.6;
        for (const tgt of m.objs) {
          if (gone) break;
          if (tgt.k === 0 && !tgt.vx && Math.abs(tgt.x - o.x) < 0.75 && Math.abs(tgt.y - o.y) < 0.7) {
            tgt.vx = 1;
            tgt.a = 0.5;
            m.score++;
            gone = true;
            g.ev.push({ t: 'sfx', id: 'splat' });
          } else if (tgt.k === 3 && !tgt.vy && Math.abs(tgt.x - o.x) < 0.95 && Math.abs(tgt.y - o.y) < 0.8) {
            tgt.vy = 1;
            tgt.vx = 0;
            tgt.a = 0.9;
            m.score += SNOW.snowman;
            gone = true;
            g.ev.push({ t: 'sfx', id: 'splat' });
            g.ev.push({ t: 'sfx', id: 'sparkle' });
            g.ev.push({ t: 'shake', amt: 4 });
          } else if (tgt.k === 2 && tgt.a > 0 && Math.abs(tgt.x - o.x) < 0.6 && Math.abs(tgt.y - o.y) < 0.6) {
            // two snowballs meet in the air: poof
            tgt.a = -1;
            gone = true;
            g.ev.push({ t: 'sfx', id: 'puff' });
          }
        }
        if (gone) m.objs.splice(i, 1);
      } else if (o.k === 2) {
        if (o.a < 0) {
          m.objs.splice(i, 1);
          continue;
        }
        o.x += o.vx * dt;
        o.y += o.vy * dt;
        o.a -= dt;
        live++;
        if (o.a <= 0) {
          if (Math.abs(o.x - n[0]!) < 0.75) {
            n[6] = 0.8;
            n[7] = n[7]! + 1;
            g.ev.push({ t: 'sfx', id: 'splat' });
            g.ev.push({ t: 'sfx', id: 'giggle' });
          } else g.ev.push({ t: 'sfx', id: 'puff' });
          m.objs.splice(i, 1);
        }
      } else {
        if (o.k === 3) o.x += o.vx * dt;
        else if (o.vy > 0) o.vy = Math.max(0, o.vy - dt);
        o.a -= dt;
        if (o.a <= 0) m.objs.splice(i, 1);
        else live++;
      }
    }
    if (n[5]! <= 0 && n[2]! >= SNOW.waves[wave]! && live === 0) {
      if (wave >= 2) finish(g, m, m.score >= 28 ? 3 : m.score >= 12 ? 2 : 1);
      else {
        n[4] = wave + 1;
        n[2] = 0;
        n[3] = 0.3;
        n[5] = SNOW.opening[wave + 1]!;
        n[8] = 0;
        n[9] = 2;
        g.ev.push({ t: 'sfx', id: 'go' });
      }
    }
  },
};

// ---------------------------------------------------------------- Minecart ride
// One long track in three stretches: the dip (it gets fast), the dark tunnel (grab a lantern to light the way)
// and the last climb (slow, with more to grab). Lean left and right between three rails.
// n: 0 lane (0..2), 1 distance, 2 speed, 3 bumps, 4 lane change cooldown, 5 drawn lane (smooth),
//    6 seconds of lantern light left, 7 stretch (0..2), 8 lanterns grabbed
// objs: x lane, y distance, k 0 rock / 1 gem / 2 lantern, a 1 when passed
export const CART = {
  length: 470,
  /** where the tunnel and the climb begin */
  stretch: [0, 150, 320],
  /** distance between rows of things in each stretch */
  rows: [6.5, 5.5, 5],
  /** the speed the cart settles at in each stretch (the dip builds up to it) */
  speeds: [10.5, 8.5, 6.6],
  light: 6,
};
/** Cup tiers: the cart's speed (times the usual). */
export const CART_CUP = [1, 1.2, 1.38];
/** Cup tiers: the share of gems and lanterns for 3 stars. */
export const CART_THREE = [0.7, 0.8, 0.85];
/** Which stretch a distance is in. */
export function cartStretch(d: number): number {
  return d >= CART.stretch[2]! ? 2 : d >= CART.stretch[1]! ? 1 : 0;
}
const minecart: MiniDef = {
  goal: 1,
  init(g, m) {
    m.n = [1, 0, 7, 0, 0, 1, 0, 0, 0];
    m.objs = [];
    const put = (lane: number, d: number, k: number) => m.objs.push({ x: lane, y: d, vx: 0, vy: 0, k, a: 0 });
    let d = 14;
    let lit = CART.stretch[1]! - 12;
    let rest = false;
    while (d < CART.length - 10) {
      const st = cartStretch(d);
      const lane = randInt(g, 0, 2);
      const other = (lane + randInt(g, 1, 2)) % 3;
      const r = rand(g);
      if (rest) {
        // after two rocks side by side comes a row with nothing in the way
        put(lane, d, 1);
        rest = false;
      } else if (st === 1 && d - lit >= 22) {
        // a lantern every few rows of the tunnel: each one lights the way to about the next
        put(lane, d, 2);
        lit = d;
      } else if (r < 0.2) {
        // a trail of gems down one rail
        for (let i = 0; i < 3 && d < CART.length - 10; i++) {
          put(lane, d, 1);
          if (i < 2) d += CART.rows[st]!;
        }
      } else if (r < 0.45) put(lane, d, 1);
      else if (r < 0.75) {
        // a choice: the rock on one rail, the gem on another
        put(lane, d, 0);
        put(other, d, 1);
      } else if (r < 0.87 || st === 0) put(lane, d, 0);
      else {
        // two rocks side by side: only one rail is clear
        put(lane, d, 0);
        put(other, d, 0);
        rest = true;
      }
      d += CART.rows[st]!;
    }
    m.goal = m.objs.filter((o) => o.k !== 0).length;
  },
  step(g, m, inp) {
    const n = m.n;
    if (n[4]! > 0) n[4] = n[4]! - dt;
    if (inp.mx && n[4]! <= 0) {
      n[0] = Math.max(0, Math.min(2, n[0]! + inp.mx));
      n[4] = 0.2;
      g.ev.push({ t: 'sfx', id: 'lean' });
    }
    n[5] = n[5]! + (n[0]! - n[5]!) * 0.25;
    const st = cartStretch(n[1]!);
    if (st !== n[7]) {
      n[7] = st;
      g.ev.push({ t: 'sfx', id: 'whoosh' });
    }
    if (n[6]! > 0) n[6] = Math.max(0, n[6]! - dt);
    // the cart picks up speed (slowly in the dip, so it builds) and eases off on the climb
    const want = CART.speeds[st]! * CART_CUP[hard(m)]!;
    n[2] = n[2]! < want ? Math.min(want, n[2]! + (st === 0 ? 0.6 : 1.5) * dt) : Math.max(want, n[2]! - 2.5 * dt);
    n[1] = n[1]! + n[2]! * dt;
    for (const o of m.objs) {
      if (o.a || o.y > n[1]! + 0.5 || o.y < n[1]! - 0.5) continue;
      if (o.x !== n[0]) continue;
      o.a = 1;
      if (o.k === 1) {
        m.score++;
        g.ev.push({ t: 'sfx', id: 'gem' });
      } else if (o.k === 2) {
        m.score++;
        n[8] = n[8]! + 1;
        n[6] = CART.light;
        g.ev.push({ t: 'sfx', id: 'chime' });
      } else {
        n[3] = n[3]! + 1;
        n[2] = 3.5;
        g.ev.push({ t: 'sfx', id: 'bonk' });
        g.ev.push({ t: 'shake', amt: 5 });
      }
    }
    const three = CART_THREE[hard(m)]!;
    if (n[1]! >= CART.length) finish(g, m, m.score >= m.goal * three ? 3 : m.score >= m.goal * 0.35 ? 2 : 1);
  },
};

// ---------------------------------------------------------------- Archery (package 47a)
// Mama Koala's targets among the gum trees. She walks about the clearing and X (or Space) shoots an arrow the way
// she faces; arrows are never used up here. Targets pop up along the far side and on the two flanks, a few at a
// time, and drop again if she is too slow. Three rounds: still targets, then some that slide, then mostly sliders
// and a gold one worth 3 that runs fast. A target on top is shot facing up; one on a flank facing left or right.
// n: 0 hero x, 1 hero y, 2 facing (0 up, 1 left, 2 right, 3 down), 3 shot cooldown, 4 round (0..2),
//    5 targets shown this round, 6 time to the next target, 7 time left of the round's opening, 8 1 once this
//    round's gold target has come, 9 arrows shot, 10 targets hit, 11 seconds since she last moved
// objs: k 0 a target, k 2 the gold one (a time left up, or below 0 while it falls after a hit; vx, vy its slide),
//    k 1 an arrow (vx, vy its flight)
export const TARGETS = {
  w: 16,
  h: 9,
  /** where she may walk: the clearing in the middle and near side */
  walk: { x0: 2.2, x1: 13.8, y0: 3.4, y1: 8.3 },
  speed: 4.2,
  /** the far side (targets shot facing up) and the flanks (facing left or right) */
  top: { y0: 0.9, y1: 1.9, x0: 2.6, x1: 13.4 },
  side: { y0: 3.9, y1: 7.6, left: 0.9, right: 15.1 },
  sideShare: 0.3,
  arrow: 13,
  cooldown: 0.4,
  /** how near an arrow must pass (wider on Gentle), and for the small gold one */
  hit: 0.62,
  hitGentle: 0.7,
  hitGold: 0.55,
  counts: [7, 8, 9],
  gaps: [2.3, 2.0, 1.8],
  opening: [1.5, 2.0, 2.0],
  /** seconds a target stays up (longer on Gentle), by round */
  stay: [4.2, 3.8, 3.4],
  stayGentle: 1.2,
  /** the share of sliding targets in each round, and their speed */
  movers: [0, 0.5, 0.8],
  slide: 1.2,
  goldSlide: 1.9,
  goldStay: 3.2,
  goldPts: 3,
  /** at most this many targets up at once */
  up: 2,
};
/** Cup tiers: how long a target stays up and how fast the sliders go (times the usual). */
export const TARGETS_CUP = { stay: [1, 0.88, 0.8], slide: [1, 1.15, 1.3] };
/** Which way a target faces her: 0 on the far side, 1 on the left flank, 2 on the right. */
export function targetSide(o: { x: number }): number {
  return o.x < TARGETS.top.x0 - 0.5 ? 1 : o.x > TARGETS.top.x1 + 0.5 ? 2 : 0;
}
function targetPop(g: Game, m: MiniRt, gold: boolean): void {
  const T = TARGETS;
  const round = m.n[4]!;
  const h = hard(m);
  const busy = (x: number, y: number) =>
    m.objs.some((o) => (o.k === 0 || o.k === 2) && o.a > 0 && Math.hypot(o.x - x, o.y - y) < 2.2);
  let x = 0;
  let y = 0;
  let side = 0;
  for (let tries = 0; tries < 8; tries++) {
    side = !gold && rand(g) < T.sideShare ? (rand(g) < 0.5 ? 1 : 2) : 0;
    if (side === 0) {
      x = T.top.x0 + rand(g) * (T.top.x1 - T.top.x0);
      y = T.top.y0 + rand(g) * (T.top.y1 - T.top.y0);
    } else {
      x = side === 1 ? T.side.left : T.side.right;
      y = T.side.y0 + rand(g) * (T.side.y1 - T.side.y0);
    }
    if (!busy(x, y)) break;
  }
  const moves = gold || rand(g) < T.movers[round]!;
  const v = (gold ? T.goldSlide : T.slide) * TARGETS_CUP.slide[h]! * (rand(g) < 0.5 ? -1 : 1);
  const stay = (gold ? T.goldStay : T.stay[round]!) * (g.s.opts.gentle ? T.stayGentle : 1) * TARGETS_CUP.stay[h]!;
  m.objs.push({
    x,
    y,
    vx: moves && side === 0 ? v : 0,
    vy: moves && side !== 0 ? v * 0.75 : 0,
    k: gold ? 2 : 0,
    a: stay,
  });
  g.ev.push({ t: 'sfx', id: 'pop' });
}
/** Package 69: where an arrow from (x, y) facing `f` should fly: a unit vector, and the facing to turn to, if any. */
export function targetAim(
  m: MiniRt,
  x: number,
  y: number,
  f: number,
): { vx: number; vy: number; turn?: number } | null {
  const fv = [
    [0, -1],
    [-1, 0],
    [1, 0],
    [0, 1],
  ][f]!;
  let best: { vx: number; vy: number; turn?: number } | null = null;
  let bestD = 7;
  let near: { vx: number; vy: number; turn?: number } | null = null;
  let nearD = 4;
  for (const t of m.objs) {
    if ((t.k !== 0 && t.k !== 2) || t.a <= 0) continue;
    let d = Math.hypot(t.x - x, t.y - y);
    // lead a slider: where it will be when the arrow gets there
    const lead = d / TARGETS.arrow;
    const px = t.x + t.vx * lead;
    const py = t.y + t.vy * lead;
    const dx = px - x;
    const dy = py - y;
    d = Math.hypot(dx, dy) || 1;
    const c = (dx * fv[0]! + dy * fv[1]!) / d;
    if (c >= 0.5 && d <= bestD) {
      best = { vx: dx / d, vy: dy / d };
      bestD = d;
    } else if (d <= nearD) {
      near = {
        vx: dx / d,
        vy: dy / d,
        turn: Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 1 : 2) : dy < 0 ? 0 : 3,
      };
      nearD = d;
    }
  }
  return best ?? near;
}
const targets: MiniDef = {
  goal: TARGETS.counts[0]! + TARGETS.counts[1]! + TARGETS.counts[2]! + 2 * TARGETS.goldPts,
  init(_g, m) {
    m.n = [8, 6.5, 0, 0, 0, 0, 0.3, TARGETS.opening[0]!, 0, 0, 0, 0];
    m.objs = [];
  },
  step(g, m, inp) {
    const T = TARGETS;
    const n = m.n;
    const round = n[4]!;
    // walking: up or down turns her that way first, else left or right
    let mx = inp.mx;
    let my = inp.my;
    if (my) n[2] = my < 0 ? 0 : 3;
    else if (mx) n[2] = mx < 0 ? 1 : 2;
    if (mx && my) {
      mx *= Math.SQRT1_2;
      my *= Math.SQRT1_2;
    }
    n[0] = Math.max(T.walk.x0, Math.min(T.walk.x1, n[0]! + mx * T.speed * dt));
    n[1] = Math.max(T.walk.y0, Math.min(T.walk.y1, n[1]! + my * T.speed * dt));
    n[11] = mx || my ? 0 : n[11]! + dt;
    if (n[3]! > 0) n[3] = n[3]! - dt;
    if ((inp.fire || inp.act) && n[3]! <= 0) {
      n[3] = T.cooldown;
      n[9] = n[9]! + 1;
      // package 69: the arrow aims by itself at the nearest target within 7 tiles and 60 degrees of the way she
      // faces (where a slider will be), or she turns to one within 4 tiles; else it flies straight
      const aim = targetAim(m, n[0]!, n[1]! - 0.4, n[2]!);
      if (aim?.turn !== undefined) n[2] = aim.turn;
      const f = n[2]!;
      const vx = aim ? aim.vx * T.arrow : f === 1 ? -T.arrow : f === 2 ? T.arrow : 0;
      const vy = aim ? aim.vy * T.arrow : f === 0 ? -T.arrow : f === 3 ? T.arrow : 0;
      m.objs.push({ x: n[0]!, y: n[1]! - 0.4, vx, vy, k: 1, a: 0 });
      g.ev.push({ t: 'sfx', id: 'bow' });
    }
    // new targets
    if (n[7]! > 0) n[7] = n[7]! - dt;
    else {
      n[6] = n[6]! - dt;
      const up = m.objs.filter((o) => (o.k === 0 || o.k === 2) && o.a > 0).length;
      if (n[6]! <= 0 && n[5]! < T.counts[round]! && up < T.up) {
        n[6] = T.gaps[round]!;
        n[5] = n[5]! + 1;
        targetPop(g, m, false);
      }
      // the gold one comes half way through rounds 2 and 3
      if (round > 0 && !n[8] && n[5]! >= T.counts[round]! / 2) {
        n[8] = 1;
        targetPop(g, m, true);
        g.ev.push({ t: 'sfx', id: 'bell' });
      }
    }
    let live = 0;
    for (let i = m.objs.length - 1; i >= 0; i--) {
      const o = m.objs[i]!;
      if (o.k === 1) {
        o.x += o.vx * dt;
        o.y += o.vy * dt;
        let gone = o.x < -0.5 || o.x > T.w + 0.5 || o.y < -0.5 || o.y > T.h + 0.5;
        for (const t of m.objs) {
          if (gone) break;
          if ((t.k !== 0 && t.k !== 2) || t.a <= 0) continue;
          const r = t.k === 2 ? T.hitGold : g.s.opts.gentle ? T.hitGentle : T.hit;
          if (Math.hypot(t.x - o.x, t.y - o.y) < r) {
            t.a = -0.6;
            m.score += t.k === 2 ? T.goldPts : 1;
            n[10] = n[10]! + 1;
            gone = true;
            g.ev.push({ t: 'sfx', id: 'thunk' });
            if (t.k === 2) {
              g.ev.push({ t: 'sfx', id: 'sparkle' });
              g.ev.push({ t: 'shake', amt: 4 });
            }
          }
        }
        if (gone) m.objs.splice(i, 1);
        continue;
      }
      if (o.a < 0) {
        // knocked flat: it falls for a moment, then goes
        o.a += dt;
        if (o.a >= 0) m.objs.splice(i, 1);
        else live++;
        continue;
      }
      o.a -= dt;
      if (o.a <= 0) {
        m.objs.splice(i, 1);
        g.ev.push({ t: 'sfx', id: 'puff' });
        continue;
      }
      live++;
      // sliders run to and fro along their side
      if (o.vx) {
        o.x += o.vx * dt;
        if (o.x < T.top.x0 || o.x > T.top.x1) {
          o.vx = -o.vx;
          o.x = Math.max(T.top.x0, Math.min(T.top.x1, o.x));
        }
      } else if (o.vy) {
        o.y += o.vy * dt;
        if (o.y < T.side.y0 || o.y > T.side.y1) {
          o.vy = -o.vy;
          o.y = Math.max(T.side.y0, Math.min(T.side.y1, o.y));
        }
      }
    }
    if (n[7]! <= 0 && n[5]! >= T.counts[round]! && live === 0) {
      const most = m.goal;
      if (round >= 2) finish(g, m, m.score >= most * 0.8 ? 3 : m.score >= most * 0.45 ? 2 : 1);
      else {
        n[4] = round + 1;
        n[5] = 0;
        n[6] = 0.3;
        n[7] = T.opening[round + 1]!;
        n[8] = 0;
        g.ev.push({ t: 'sfx', id: 'go' });
      }
    }
  },
};

export const MINIS: Record<string, MiniDef> = { keepy, puddles, hide, race, claw, snowball, minecart, targets };

/**
 * The key of the line under the stars on the result card: one short true thing she did well. A special feat
 * (key ending in _x) comes first, else the line for the stars she got.
 */
export function miniPraise(m: MiniRt): string {
  const n = m.n;
  let feat = false;
  switch (m.game) {
    case 'keepy':
      feat = m.score >= m.goal && n[5] === 0;
      break;
    case 'puddles':
      feat = m.score >= m.goal - 1;
      break;
    case 'hide':
      feat = m.score >= m.goal && n[3] === 0;
      break;
    case 'race':
      feat = false;
      break;
    case 'snowball':
      feat = m.stars >= 3 && n[7] === 0;
      break;
    case 'minecart':
      feat = m.stars >= 2 && n[3] === 0;
      break;
    case 'targets':
      feat = m.stars >= 3 && n[9]! - n[10]! <= 2;
      break;
    default:
      break;
  }
  return `mini_well_${m.game}_${feat ? 'x' : m.stars}`;
}
