// The seven mini-games as set pieces: each is the right length, cannot be lost, pays a careful child 3 stars and a
// careless one 2, and has the round-by-round twists the design asks for. Played headless through the real rules.
import { describe, expect, it } from 'vitest';
import {
  CART,
  CLAW,
  CLAW_PRIZES,
  cartStretch,
  closeMini,
  HIDE,
  MINIS,
  miniPraise,
  PUDDLES,
  puddleLeap,
  RACE,
  SNOW,
  startMini,
} from '../src/core/minigames.ts';
import { newGame } from '../src/core/state.ts';
import { NO_INPUT, step } from '../src/core/step.ts';
import type { Game, Input, MiniRt } from '../src/core/types.ts';
import { content } from '../src/data/content.ts';
import { GAME_SECS, playOne } from '../tools/check/kidbot.ts';

const fresh = (seed = 7, gentle = false): Game => {
  const g = newGame(content, { seed, hero: 'amelia', opts: { gentle } });
  g.rt.mode = 'play';
  g.rt.talk = null;
  g.rt.q = [];
  return g;
};
/** Start a game and press Space on its intro card. */
const begin = (game: string, seed = 7, gentle = false): { g: Game; m: MiniRt } => {
  const g = fresh(seed, gentle);
  startMini(g, game);
  for (let i = 0; i < 60 && g.rt.mini!.st === 0; i++) step(g, { ...NO_INPUT, act: true });
  return { g, m: g.rt.mini! };
};
const press = (over: Partial<Input>): Input => ({ ...NO_INPUT, ...over });
/** Step until the test says stop (or the game ends); returns the steps taken. */
const until = (g: Game, stop: () => boolean, inp: () => Input = () => NO_INPUT, max = 60 * 240): number => {
  let i = 0;
  for (; i < max && g.rt.mini && g.rt.mini.st === 1 && !stop(); i++) step(g, inp());
  return i;
};
const SEEDS = [1000, 1097, 1194, 1291];

describe('every mini-game is a set piece', () => {
  it('a careful child gets 3 stars and a careless one at least 2, in the time a set piece takes', () => {
    for (const game of Object.keys(MINIS)) {
      const [lo, hi] = GAME_SECS[game]!;
      for (const seed of SEEDS) {
        const careful = playOne(game, seed, 0);
        expect(careful.stars, `${game} careful, seed ${seed}`).toBe(3);
        expect(careful.secs, `${game} careful, seed ${seed}`).toBeGreaterThan(game === 'claw' ? 5 : lo - 5);
        expect(careful.secs, `${game} careful, seed ${seed}`).toBeLessThan(hi);
        const careless = playOne(game, seed);
        expect(careless.stars, `${game} careless, seed ${seed}`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('pressing nothing at all still ends with a star and the result card', () => {
    for (const game of Object.keys(MINIS)) {
      if (game === 'hide') continue; // hide and seek has no clock: she can stand there as long as she likes
      const { g, m } = begin(game);
      until(g, () => false);
      expect(m.st, game).toBe(2);
      expect(m.stars, game).toBeGreaterThanOrEqual(1);
    }
  });

  it('the result card has a line of praise for every game and every number of stars', () => {
    for (const game of Object.keys(MINIS)) {
      for (const stars of [1, 2, 3]) {
        const m = { game, stars, score: 0, goal: 99, n: [9, 9, 9, 9, 9, 9, 9, 9, 9] } as unknown as MiniRt;
        const key = miniPraise(m);
        expect(key).toBe(`mini_well_${game}_${stars}`);
        expect(content.strings[key], key).toBeTruthy();
      }
    }
    // the special feats
    const feat = (game: string, over: Partial<MiniRt>) =>
      miniPraise({ game, stars: 3, score: 0, goal: 9, n: [0, 0, 0, 0, 0, 0, 0, 0, 0], ...over } as MiniRt);
    for (const key of [
      feat('keepy', { score: 20, goal: 20 }),
      feat('puddles', { score: 35, goal: 35 }),
      feat('hide', { score: 9 }),
      feat('snowball', {}),
      feat('minecart', {}),
    ]) {
      expect(key.endsWith('_x'), key).toBe(true);
      expect(content.strings[key], key).toBeTruthy();
    }
  });

  it('a game post tells the view who she is playing with', () => {
    const g = fresh();
    for (const post of ['joey_post', 'king_post']) {
      const o = content.areas.island!.objects.find((x) => x.id === post)!;
      expect(o, post).toBeTruthy();
      g.s.area = 'island';
      g.s.x = o.x + 0.5;
      g.s.y = o.y + 1.5;
      startMini(g, 'hide');
      expect(g.rt.mini!.host).toBe(post);
      closeMini(g);
    }
    // a host she spoke to stays the host
    startMini(g, 'hide', null, 'pando');
    expect(g.rt.mini!.host).toBe('pando');
  });
});

describe('hide and seek', () => {
  it('no two hiding places touch, so she can always walk round them', () => {
    const pool = HIDE.pool;
    for (let i = 0; i < pool.length; i++) {
      const [x, y] = pool[i]!;
      expect(x >= 0 && x < HIDE.w && y >= 0 && y < HIDE.h).toBe(true);
      expect(x === HIDE.home[0] && y === HIDE.home[1]).toBe(false);
      for (let j = i + 1; j < pool.length; j++)
        expect(Math.max(Math.abs(pool[j]![0] - x), Math.abs(pool[j]![1] - y)), `${i} and ${j}`).toBeGreaterThan(1);
    }
    expect(Math.max(...HIDE.places)).toBeLessThanOrEqual(pool.length);
  });

  /** Walk to a free cell beside a place (straight there: the test moves her like a chess piece) and peek. */
  const peekAt = (g: Game, m: MiniRt, i: number) => {
    const o = m.objs[i]!;
    const cell = (
      [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const
    )
      .map(([dx, dy]) => [o.x + dx, o.y + dy] as const)
      .find(([x, y]) => x >= 0 && y >= 0 && x < HIDE.w && y < HIDE.h && !m.objs.some((b) => b.x === x && b.y === y))!;
    m.n[0] = cell[0];
    m.n[1] = cell[1];
    // (only this place may be in reach: step so that it is the one she looks into)
    until(g, () => m.n[6] === 1);
    const round = m.n[5];
    step(g, press({ act: true }));
    until(g, () => m.n[6] !== 2 || m.n[5] !== round);
  };

  it('has three rounds with more places each time, a count to ten, and three friends to find', () => {
    const { g, m } = begin('hide', 21);
    for (let round = 0; round < 3; round++) {
      expect(m.n[5]).toBe(round);
      expect(m.n[6], 'she counts first').toBe(0);
      expect(m.objs.length).toBe(HIDE.places[round]);
      expect(m.objs.filter((o) => o.vx).length).toBe(3);
      expect(new Set(m.objs.filter((o) => o.vx).map((o) => o.vx)).size, 'three different friends').toBe(3);
      // she cannot move or peek while she counts
      const x = m.n[0];
      step(g, press({ mx: 1, act: true }));
      expect(m.n[0]).toBe(x);
      expect(m.n[6]).toBe(0);
      for (let k = 0; k < 3; k++) {
        const i = m.objs.findIndex((o) => o.vx && o.k === 0);
        peekAt(g, m, i);
      }
      until(g, () => m.n[5] !== round);
    }
    expect(m.st).toBe(2);
    expect(m.score).toBe(9);
    expect(m.stars).toBe(3);
  });

  it('round 2: a hidden friend giggles out loud; round 3: one friend moves once, to a place not yet looked in', () => {
    const { g, m } = begin('hide', 33);
    const clearRound = () => {
      const round = m.n[5];
      for (let k = 0; k < 3; k++)
        peekAt(
          g,
          m,
          m.objs.findIndex((o) => o.vx && o.k === 0),
        );
      until(g, () => m.n[5] !== round);
    };
    // round 1: nobody giggles from far away
    until(g, () => m.n[6] === 1);
    let loud = 0;
    until(
      g,
      () => false,
      () => {
        if (m.objs.some((o) => o.vy > 0)) loud++;
        return NO_INPUT;
      },
      60 * 12,
    );
    expect(loud, 'round 1 is quiet').toBe(0);
    clearRound();
    // round 2: wait at the base and a hidden friend gives herself away
    until(g, () => m.n[6] === 1);
    until(
      g,
      () => m.objs.some((o) => o.vy > 0),
      () => NO_INPUT,
      60 * 12,
    );
    const giggler = m.objs.find((o) => o.vy > 0)!;
    expect(giggler, 'round 2 has a loud giggle').toBeTruthy();
    expect(giggler.vx > 0 && giggler.k === 0, 'the giggle comes from a friend still hidden').toBe(true);
    clearRound();
    // round 3: an empty place first (it must stay empty), then the first friend: another one moves
    until(g, () => m.n[6] === 1);
    const empty = m.objs.findIndex((o) => !o.vx);
    peekAt(g, m, empty);
    expect(m.objs[empty]!.k).toBe(1);
    expect(m.n[10]).toBe(0);
    const before = m.objs.map((o) => o.vx);
    peekAt(
      g,
      m,
      m.objs.findIndex((o) => o.vx && o.k === 0),
    );
    expect(m.n[10], 'somebody moved').toBe(1);
    const from = m.n[12]!;
    const to = m.n[13]!;
    expect(before[from]).toBeGreaterThan(0);
    expect(m.objs[from]!.vx).toBe(0);
    expect(m.objs[to]!.vx).toBe(before[from]);
    expect(m.objs[to]!.k, 'the new place was not looked in yet').toBe(0);
    expect(to).not.toBe(empty);
    expect(m.objs.filter((o) => o.vx).length).toBe(3);
    // and only once
    peekAt(
      g,
      m,
      m.objs.findIndex((o) => o.vx && o.k === 0),
    );
    expect(m.n[12]).toBe(from);
    expect(m.n[13]).toBe(to);
  });

  it('a child who looks everywhere still finds everyone and gets a star', () => {
    const { g, m } = begin('hide', 5);
    for (let guard = 0; guard < 200 && m.st === 1; guard++) {
      until(g, () => m.n[6] === 1);
      if (m.st !== 1) break;
      const i = m.objs.findIndex((o) => o.k === 0);
      if (i >= 0) peekAt(g, m, i);
    }
    expect(m.st).toBe(2);
    expect(m.stars).toBeGreaterThanOrEqual(1);
    expect(m.n[3], 'wrong looks were counted').toBeGreaterThan(4);
  });
});

describe('the race', () => {
  it('has three laps, and the course changes each lap', () => {
    expect(RACE.laps.length).toBe(3);
    expect(RACE.laps[2]!.len, 'the short cut makes lap 3 shorter').toBeLessThan(RACE.laps[0]!.len - 5);
    const { m } = begin('race');
    const props = (k: number) => m.objs.filter((o) => o.k === k).length;
    expect(props(10), 'lap 1 has puddles').toBeGreaterThan(0);
    expect(props(11), 'lap 1 has no boost pads').toBe(0);
    expect(RACE.pads[1]!.length, 'lap 2 has boost pads').toBeGreaterThan(0);
    expect(RACE.pads[2]!.length).toBeGreaterThan(RACE.pads[1]!.length);
    expect(JSON.stringify(RACE.puddles[1])).not.toBe(JSON.stringify(RACE.puddles[0]));
  });

  it('grass and puddles slow her down and a boost pad speeds her up', () => {
    const speedAt = (x: number, y: number, boost = false): number => {
      const { g, m } = begin('race');
      until(g, () => m.n[5]! <= 0);
      for (const o of m.objs) if (o.k >= 10) o.x = -99;
      if (boost) {
        const pad = { x, y, vx: 0, vy: 0, k: 11, a: 0 };
        m.objs.push(pad);
      }
      m.n[0] = x;
      m.n[1] = y;
      step(g, press({ mx: 1 }));
      const x0 = m.n[0]!;
      step(g, press({ mx: 1 }));
      return (m.n[0]! - x0) * 60;
    };
    const track = speedAt(14, 3);
    const grass = speedAt(8, 7);
    // the pond in the middle is for wading
    expect(speedAt(RACE.ponds[0]![0], RACE.ponds[0]![1])).toBeCloseTo(RACE.speed * RACE.wet, 3);
    expect(track).toBeCloseTo(RACE.speed, 3);
    expect(grass).toBeCloseTo(RACE.speed * RACE.grass, 3);
    expect(speedAt(14, 3, true)).toBeCloseTo(RACE.speed * RACE.boost, 3);
    // a puddle on the track
    const { g, m } = begin('race');
    until(g, () => m.n[5]! <= 0);
    const puddle = m.objs.find((o) => o.k === 10)!;
    m.n[0] = puddle.x;
    m.n[1] = puddle.y;
    step(g, press({ mx: 1 }));
    expect(m.n[10]).toBe(2);
    const x0 = m.n[0]!;
    step(g, press({ mx: 1 }));
    expect((m.n[0]! - x0) * 60).toBeCloseTo(RACE.speed * RACE.wet, 3);
  });

  it('the finish is close however she plays: the rival waits for a dawdler and chases a sprinter', () => {
    // a dawdler: she stands still for 20 s; the rival eases right off, and she can still catch him
    const slow = begin('race', 9);
    until(slow.g, () => slow.m.t > 20);
    expect(slow.m.n[9]! - slow.m.n[13]!, 'the rival is not a lap ahead of a dawdler').toBeLessThan(
      RACE.laps[0]!.len * 0.8,
    );
    expect(RACE.rival.min).toBeLessThan(RACE.speed * 0.6);
    // whoever wins, it is by a few steps: the careless child and the careful one, on both settings of the game
    for (const seed of SEEDS)
      for (const mistake of [0.1, 0]) {
        const res = playOne('race', seed, mistake);
        const won = res.n[14] === 1;
        expect(res.stars, `seed ${seed}`).toBe(won ? 3 : 2);
        if (won) expect(res.n[13], `seed ${seed}: the rival is right behind`).toBeLessThan(8);
        if (mistake === 0) expect(won, 'a careful child wins').toBe(true);
      }
  });
});

describe('the claw machine', () => {
  it('gives three tries and always a prize by the third, one prize a go', () => {
    const { g, m } = begin('claw', 3);
    // park the claw as far from every prize as it goes, and drop it there three times
    const far = () => {
      m.n[0] = CLAW.w - 0.8;
      m.n[5] = 0;
      m.n[6] = 0;
    };
    const won0 = g.s.counts.clawWon ?? 0;
    for (let t = 0; t < CLAW.tries; t++) {
      until(g, () => m.n[1] === 0 && m.n[8]! > 0.3);
      expect(m.n[4]).toBe(t);
      for (const o of m.objs) o.x = Math.min(o.x, CLAW.w - 3);
      far();
      step(g, press({ act: true }));
      expect(m.n[1]).toBe(1);
      until(g, () => m.n[1] !== 1);
      if (t < CLAW.tries - 1) {
        expect(m.n[1], `try ${t + 1} comes up empty`).toBe(3);
        expect(m.st).toBe(1);
      } else expect(m.n[1], 'the third try always grabs').toBe(2);
    }
    until(g, () => false);
    expect(m.st).toBe(2);
    expect(m.stars).toBeGreaterThanOrEqual(1);
    expect(CLAW_PRIZES).toContain(m.msg);
    expect(g.s.counts.clawWon).toBe(won0 + 1);
  });

  it('a claw dropped right over a prize grabs it first time for 3 stars', () => {
    const { g, m } = begin('claw', 4);
    until(g, () => m.n[8]! > 0.3);
    m.n[0] = m.objs[2]!.x;
    m.n[6] = 0;
    step(g, press({ act: true }));
    until(g, () => false);
    expect(m.st).toBe(2);
    expect(m.stars).toBe(3);
    expect(m.n[4]).toBe(0);
  });

  it('the claw swings more while the carriage moves than when it rests', () => {
    const { g, m } = begin('claw', 5);
    for (let i = 0; i < 90; i++) step(g, press({ mx: i % 40 < 20 ? 1 : -1 }));
    const moving = m.n[6]!;
    for (let i = 0; i < 150; i++) step(g, NO_INPUT);
    expect(moving).toBeGreaterThan(m.n[6]! * 1.5);
    expect(m.n[6]!).toBeLessThan(CLAW.grab);
  });
});

describe('the snowball fight', () => {
  it('has three rising waves, a snowman worth more in each, and throws back that never hurt', () => {
    const { g, m } = begin('snowball', 11);
    const hp = g.s.hp;
    const snowmen = new Set<object>();
    const back = [0, 0, 0];
    const seen = new Set<object>();
    let wave = -1;
    const waves: number[] = [];
    until(
      g,
      () => false,
      () => {
        if (m.n[4] !== wave) {
          wave = m.n[4]!;
          waves.push(wave);
        }
        for (const o of m.objs) {
          if (o.k === 3) snowmen.add(o);
          if (o.k === 2 && !seen.has(o)) {
            seen.add(o);
            back[wave]!++;
          }
        }
        return NO_INPUT;
      },
    );
    expect(waves).toEqual([0, 1, 2]);
    expect(snowmen.size).toBe(3);
    expect(back[0], 'nobody throws back in wave 1').toBe(0);
    expect(back[1]).toBeGreaterThan(0);
    expect(back[2]).toBeGreaterThan(0);
    expect(m.n[7], 'she stood still, so some hit her').toBeGreaterThan(0);
    expect(g.s.hp, 'a splat never hurts').toBe(hp);
    expect(m.st).toBe(2);
    expect(SNOW.gaps[2]!).toBeLessThan(SNOW.gaps[0]!);
    expect(SNOW.waves[2]!).toBeGreaterThan(SNOW.waves[0]!);
  });

  it('a hit on the snowman is worth 3 and a splat only stops her throwing for a moment', () => {
    const { g, m } = begin('snowball', 12);
    m.objs.push({ x: 6, y: 0.35, vx: 0, vy: 0, k: 3, a: 5 });
    m.n[0] = 6;
    step(g, press({ act: true }));
    until(g, () => m.score > 0, undefined, 120);
    expect(m.score).toBe(SNOW.snowman);
    // a ball lands on her
    m.objs.push({ x: m.n[0]!, y: SNOW.h - 1, vx: 0, vy: 0, k: 2, a: 0.02 });
    until(g, () => m.n[6]! > 0, undefined, 30);
    expect(m.n[6]).toBeGreaterThan(0);
    const balls = m.objs.filter((o) => o.k === 1).length;
    m.n[1] = 0;
    step(g, press({ act: true }));
    expect(m.objs.filter((o) => o.k === 1).length, 'no throw with snow on her nose').toBe(balls);
    until(g, () => m.n[6]! <= 0, undefined, 120);
    step(g, press({ act: true }));
    expect(m.objs.filter((o) => o.k === 1).length).toBe(balls + 1);
  });
});

describe('the minecart ride', () => {
  it('has three stretches: the dip gets fast, the tunnel has lanterns, the climb is slow', () => {
    for (const seed of SEEDS) {
      const { g, m } = begin('minecart', seed);
      const lanterns = m.objs.filter((o) => o.k === 2);
      expect(lanterns.length).toBeGreaterThanOrEqual(4);
      for (const l of lanterns) expect(cartStretch(l.y), 'lanterns hang in the tunnel').toBe(1);
      expect(m.goal).toBe(m.objs.filter((o) => o.k !== 0).length);
      // never three rocks abreast, and after two abreast the next row is clear
      const rows = new Map<number, typeof m.objs>();
      for (const o of m.objs) rows.set(o.y, [...(rows.get(o.y) ?? []), o]);
      const ys = [...rows.keys()].sort((a, b) => a - b);
      ys.forEach((y, i) => {
        const rocks = rows.get(y)!.filter((o) => o.k === 0);
        expect(rocks.length).toBeLessThan(3);
        expect(new Set(rows.get(y)!.map((o) => o.x)).size, 'one thing a rail').toBe(rows.get(y)!.length);
        if (rocks.length === 2 && ys[i + 1] !== undefined)
          expect(
            rows.get(ys[i + 1]!)!.some((o) => o.k === 0),
            'a clear row after a wall',
          ).toBe(false);
      });
      // ride it without touching anything: top speed in each stretch
      for (const o of m.objs) o.a = 1;
      const top = [0, 0, 0];
      until(
        g,
        () => false,
        () => {
          const st = cartStretch(m.n[1]!);
          if (m.n[1]! > CART.stretch[st]! + 30) top[st] = Math.max(top[st]!, m.n[2]!);
          return NO_INPUT;
        },
      );
      expect(top[0]).toBeGreaterThan(top[1]!);
      expect(top[1]).toBeGreaterThan(top[2]!);
      expect(m.st).toBe(2);
    }
  });

  it('a lantern lights the tunnel for a while and counts as a find', () => {
    const { g, m } = begin('minecart', 2);
    const l = m.objs.find((o) => o.k === 2)!;
    for (const o of m.objs) if (o !== l) o.a = 1;
    m.n[1] = l.y - 2;
    m.n[0] = l.x;
    until(g, () => l.a === 1, undefined, 120);
    expect(m.n[6]).toBeCloseTo(CART.light, 1);
    expect(m.n[8]).toBe(1);
    expect(m.score).toBe(1);
  });
});

describe('the puddle jump', () => {
  it('has three parts that speed up, with hop-hop pairs from part 2', () => {
    const { m } = begin('puddles');
    expect(m.objs.length).toBe(PUDDLES.counts.reduce((a, b) => a + b, 0));
    expect(PUDDLES.speeds[2]!).toBeGreaterThan(PUDDLES.speeds[0]!);
    for (let part = 0; part < 3; part++) {
      const mine = m.objs.filter((o) => o.vy === part);
      expect(mine.length).toBe(PUDDLES.counts[part]);
      const close = mine.filter((o, i) => i > 0 && o.x - mine[i - 1]!.x < puddleLeap(part) + 1).length;
      expect(close, `pairs in part ${part + 1}`).toBe(PUDDLES.pairs[part]!.length);
      for (const o of mine) expect(o.vx).toBeCloseTo(o.x - puddleLeap(part), 6);
    }
  });

  it('a jump from the marked spot lands in the middle of every puddle, pairs too', () => {
    const { g, m } = begin('puddles');
    until(
      g,
      () => m.n[4] !== 0,
      () => {
        const next = m.objs[m.n[2]!];
        return press({ act: !!next && m.n[1]! <= 0 && m.n[0]! >= next.vx - 0.03 });
      },
    );
    expect(m.score).toBe(m.objs.length);
    expect(m.objs.every((o) => o.a === 1)).toBe(true);
  });

  it('ends with the big puddle: Space on the green is a perfect splash, no press still jumps', () => {
    for (const mode of ['perfect', 'wild', 'none'] as const) {
      const { g, m } = begin('puddles');
      for (const o of m.objs) o.a = 2;
      m.n[2] = m.objs.length;
      m.n[0] = m.n[10]! - 0.5;
      until(g, () => m.n[4] === 1);
      expect(m.n[4]).toBe(1);
      const before = m.score;
      if (mode === 'perfect') until(g, () => m.n[6]! > 0.5 && Math.abs(m.n[5]! - 0.5) < 0.03);
      if (mode === 'wild') until(g, () => m.n[6]! > 0.5 && m.n[5]! < 0.05);
      if (mode !== 'none') step(g, press({ act: true }));
      until(g, () => false);
      expect(m.st).toBe(2);
      expect(m.n[7]).toBe(mode === 'perfect' ? 3 : 1);
      expect(m.score - before).toBe(mode === 'perfect' ? 3 : 1);
      expect(m.stars).toBeGreaterThanOrEqual(1);
    }
  });
});
