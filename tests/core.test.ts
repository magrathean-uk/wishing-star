// Rules engine: the bag, crafting, quest steps and the night's sleep. Plain Node, no browser.
import { describe, expect, it } from 'vitest';
import { BAG_SLOTS, give, take } from '../src/core/bag.ts';
import { count } from '../src/core/cond.ts';
import { craft } from '../src/core/craft.ts';
import { OPEN, RING_REACH, SHIELD, sheltered } from '../src/core/bosses.ts';
import { rebuildArea } from '../src/core/grid.ts';
import { enterArea } from '../src/core/hero.ts';
import { damage, spawnAt } from '../src/core/mobs.ts';
import { newGame } from '../src/core/state.ts';
import { NO_INPUT, step } from '../src/core/step.ts';
import type { Game, Input } from '../src/core/types.ts';
import { content } from '../src/data/content.ts';

const fresh = (): Game => newGame(content, { seed: 7, hero: 'amelia' });
const run = (g: Game, n: number, inp: Input = NO_INPUT) => {
  for (let i = 0; i < n; i++) step(g, inp);
};
/** A plain material with a stack limit, for the bag tests. */
const material = Object.values(content.items).find((d) => d.kind === 'material' && !d.pouch && (d.stack ?? 99) > 1)!;

describe('bag', () => {
  it('stacks the same item in one slot', () => {
    const g = fresh();
    give(g, material.id, 3);
    give(g, material.id, 2);
    const slots = g.s.bag.filter((sl) => sl?.id === material.id);
    expect(slots).toHaveLength(1);
    expect(slots[0]!.n).toBe(5);
    expect(count(g, material.id)).toBe(5);
  });

  it('starts a new stack when one is full', () => {
    const g = fresh();
    const max = material.stack ?? 99;
    give(g, material.id, max + 4);
    const slots = g.s.bag.filter((sl) => sl?.id === material.id);
    expect(slots.map((sl) => sl!.n)).toEqual([max, 4]);
  });

  it('takes items away, and takes nothing when there are not enough', () => {
    const g = fresh();
    give(g, material.id, 4);
    expect(take(g, material.id, 3)).toBe(true);
    expect(count(g, material.id)).toBe(1);
    expect(take(g, material.id, 2)).toBe(false);
    expect(count(g, material.id)).toBe(1);
    expect(take(g, material.id, 1)).toBe(true);
    expect(g.s.bag.some((sl) => sl?.id === material.id)).toBe(false);
  });

  it('puts tools in the pouch, never in the bag', () => {
    const g = fresh();
    give(g, 'wood_axe', 1);
    expect(g.s.pouch.wood_axe).toBe(1);
    expect(g.s.bag.some((sl) => sl?.id === 'wood_axe')).toBe(false);
    expect(g.s.bag).toHaveLength(BAG_SLOTS);
  });
});

describe('crafting', () => {
  /** Stand her right beside the first crafting bench on the island. */
  const atBench = (g: Game) => {
    const a = content.areas.island!;
    const bench = a.objects.find((o) => content.objects[o.type]?.interact === 'table')!;
    g.s.area = 'island';
    g.s.x = bench.x - 0.5;
    g.s.y = bench.y + 0.5;
    rebuildArea(g, 'island');
  };

  it('needs a station close by', () => {
    const g = fresh();
    give(g, 'log', 1);
    expect(g.s.area).toBe('cottage');
    expect(craft(g, 'plank')).toBe(false);
    expect(count(g, 'log')).toBe(1);
  });

  it('turns inputs into the output at a bench', () => {
    const g = fresh();
    atBench(g);
    give(g, 'log', 2);
    expect(craft(g, 'plank', 2)).toBe(true);
    expect(count(g, 'log')).toBe(0);
    expect(count(g, 'plank')).toBe(8);
    expect(g.s.counts.crafted).toBe(2);
  });

  it('refuses a recipe she does not know', () => {
    const g = fresh();
    atBench(g);
    give(g, 'stick', 7);
    expect(g.s.recipes).not.toContain('ladder');
    expect(craft(g, 'ladder')).toBe(false);
    expect(count(g, 'stick')).toBe(7);
  });
});

describe('quests', () => {
  it('starts the story by itself', () => {
    const g = fresh();
    expect(g.s.quests.prologue).toBeDefined();
    expect(g.s.tracked).toBe('prologue');
  });

  it('completes a fetch step when she has the things', () => {
    const g = fresh();
    // the first quest with a fetch step (the prologue had one until phase 2 rewrote it)
    const id = content.questOrder.find((k) => content.quests[k]!.steps.some((st) => st.t === 'fetch'))!;
    const def = content.quests[id]!;
    const at = def.steps.findIndex((st) => st.t === 'fetch');
    const st = def.steps[at]!;
    if (st.t !== 'fetch') throw new Error('not a fetch step');
    for (const k in g.s.quests) g.s.quests[k]!.done = true;
    g.s.quests[id] = { step: at, n: 0 };
    run(g, 12);
    expect(g.s.quests[id]!.step).toBe(at);
    give(g, st.item, st.n ?? 1);
    run(g, 12);
    while (g.rt.mode !== 'play') run(g, 1, { ...NO_INPUT, act: true });
    expect(g.s.quests[id]!.step).toBe(at + 1);
  });
});

describe('the night', () => {
  it('rolls the day over on sleep: crops grow, used nodes come back, hearts refill', () => {
    const g = fresh();
    const tree = content.areas.island!.objects.find((o) => o.type === 'oak')!;
    g.s.nodes[tree.id] = g.s.day;
    g.s.crops.push({ x: 1, y: 1, seed: 'wheat_seed', age: 0 });
    g.s.hp = 3;
    const day = g.s.day;
    g.s.time = 600;
    g.s.quests.prologue!.done = true;
    // the bed in the cottage: place one where she stands and press Space on it, then dismiss the card
    g.s.placed.push({ k: 999, item: 'bed', area: 'cottage', x: 4, y: 4 });
    g.s.x = 4.5;
    g.s.y = 6.5;
    g.s.dir = 'up';
    rebuildArea(g, 'cottage');
    run(g, 1, { ...NO_INPUT, act: true });
    expect(g.rt.mode).toBe('card');
    run(g, 60);
    run(g, 1, { ...NO_INPUT, act: true });
    expect(g.s.day).toBe(day + 1);
    expect(g.s.time).toBe(0);
    expect(g.s.crops[0]!.age).toBe(1);
    expect(g.s.nodes[tree.id]).toBeUndefined();
    expect(g.s.hp).toBe(g.s.maxHp);
  });
});

describe('bosses', () => {
  /** She stands in the King's Hall on Normal with the boss spawned by the rules. */
  const inHall = (x: number, y: number, hits = 0): Game => {
    const g = newGame(content, { seed: 11, hero: 'amelia', opts: { gentle: false } });
    g.s.pouch.diamond_sword = 1;
    g.s.maxHp = 22;
    g.s.hp = 22;
    if (hits) g.s.counts['boss:creeper_king'] = hits;
    enterArea(g, 'hall', x, y, 'up');
    g.rt.mode = 'play';
    spawnAt(g, 'creeper_king', 1, 'king');
    return g;
  };
  const king = (g: Game) => g.rt.mobs.find((m) => m.id === 'creeper_king')!;
  /** Hold her on one spot and report each hurt as [seconds, half hearts]. */
  const stand = (g: Game, x: number, y: number, secs: number): number[][] => {
    const hurts: number[][] = [];
    for (let i = 0; i < secs * 60; i++) {
      const hp = g.s.hp;
      g.s.x = x;
      g.s.y = y;
      step(g, NO_INPUT);
      if (g.s.hp < hp) hurts.push([i / 60, hp - g.s.hp]);
    }
    return hurts;
  };
  const ch7 = content.quests.ch7!;
  const kingStep = ch7.steps.findIndex((st) => st.t === 'defeat' && st.mob === 'creeper_king');
  const guardStep = ch7.steps.findIndex((st) => st.t === 'defeat' && st.mob === 'creeper');

  it('takes one hit a swing whatever the sword, only while open, and closes again', () => {
    const g = inHall(13.5, 8);
    const m = king(g);
    expect(m.hp).toBe(9);
    expect(m.phase).toBeGreaterThanOrEqual(SHIELD);
    damage(g, m, 4, 0, -1);
    expect(m.hp).toBe(9);
    expect(g.ev.some((e) => e.t === 'sfx' && e.id === 'clang')).toBe(true);
    m.phase = 0;
    m.st = OPEN;
    m.t = 3;
    damage(g, m, 4, 0, -1);
    expect(m.hp).toBe(8);
    expect(m.phase).toBeGreaterThanOrEqual(SHIELD);
    damage(g, m, 4, 0, -1);
    expect(m.hp).toBe(8);
    expect(g.s.counts['boss:creeper_king']).toBe(1);
  });

  it('opens once in every round, so nine rounds calm the King', () => {
    const g = inHall(13.5, 16.4);
    g.s.quests.ch7 = { step: kingStep, n: 0 };
    let opens = 0;
    for (let i = 0; i < 60 * 240 && !g.s.flags.king_calm; i++) {
      const m = king(g);
      // safe from everything: this test counts rounds, not hearts
      g.rt.safeT = 1;
      if (m && m.phase < SHIELD) {
        opens++;
        damage(g, m, 1, 0, -1);
      }
      if (g.rt.mode === 'play') step(g, NO_INPUT);
      else break;
    }
    expect(opens).toBe(9);
    expect(g.s.flags.king_calm).toBe(1);
    expect(g.s.quests.ch7!.step).toBe(kingStep + 1);
  });

  it('rolls a ring that stops, and a pillar blocks it', () => {
    // 4 tiles south of him in the open: each ring costs 1 heart
    const near = stand(inHall(13.5, 9.5, 3), 13.5, 9.5, 8);
    expect(near.length).toBeGreaterThan(0);
    expect(near.every((h) => h[1] === 2)).toBe(true);
    // past where the ring stops
    expect(stand(inHall(13.5, 5.5 + RING_REACH + 0.5, 3), 13.5, 5.5 + RING_REACH + 0.5, 12)).toEqual([]);
    // behind the pillar at (9, 8), well inside the ring's reach
    const g = inHall(9.0, 9.0, 3);
    expect(Math.hypot(9.0 - 13.5, 9.0 - 5.5)).toBeLessThan(RING_REACH + 0.5);
    expect(sheltered(g, 13.5, 5.5)).toBe(true);
    expect(stand(g, 9.0, 9.0, 12)).toEqual([]);
  });

  it('warns for at least 1.1 s before each ring', () => {
    const g = inHall(13.5, 16.4, 3);
    let warnAt = -1;
    const gaps: number[] = [];
    for (let i = 0; i < 60 * 14; i++) {
      g.ev.length = 0;
      step(g, NO_INPUT);
      for (const e of g.ev) {
        if (e.t === 'fx' && e.id === 'ringmark') warnAt = i;
        if (e.t === 'sfx' && e.id === 'stomp') gaps.push((i - warnAt) / 60);
      }
    }
    expect(gaps.length).toBeGreaterThan(0);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(1.1);
  });

  it('the big boom costs 2 hearts in the open and nothing behind a pillar', () => {
    const open = stand(inHall(13.5, 12.5, 6), 13.5, 12.5, 11);
    expect(open[0]![1]).toBe(4);
    expect(stand(inHall(8.6, 9.2, 6), 8.6, 9.2, 11)).toEqual([]);
  });

  it('never loses the fight: out of hearts she wakes at the door and the hits stay', () => {
    const g = inHall(13.5, 9.5, 4);
    g.s.hp = 1;
    // (the faint refills her hearts, so it does not show as a hurt here)
    stand(g, 13.5, 9.5, 8);
    expect(g.rt.mode).toBe('play');
    expect(g.s.counts.bossFaints).toBe(1);
    expect(g.s.hp).toBe(g.s.maxHp);
    expect(g.s.area).toBe('hall');
    expect(king(g).hp).toBe(5);
    // the next step puts her back on our test spot; what matters is where the faint put her
    const g2 = inHall(13.5, 9.5, 4);
    g2.s.hp = 1;
    for (let i = 0; i < 60 * 8 && !g2.s.counts.bossFaints; i++) step(g2, NO_INPUT);
    const door = content.areas.hall!.places.hall_entry!;
    expect([g2.s.x, g2.s.y]).toEqual([door.x + 0.5, door.y + 0.5]);
  });

  it('brings the boss back when she walks in again, with the hits already landed', () => {
    const g = inHall(13.5, 16.4, 5);
    g.s.quests.ch7 = { step: kingStep, n: 0 };
    enterArea(g, 'island', 132.5, 100.5, 'down');
    run(g, 13);
    expect(king(g)).toBeUndefined();
    enterArea(g, 'hall', 13.5, 16.4, 'up');
    run(g, 13);
    expect(king(g).hp).toBe(4);
    expect(g.rt.mobs.filter((m) => m.id === 'creeper_king')).toHaveLength(1);
    const p = content.areas.hall!.places.king!;
    expect([king(g).x, king(g).y]).toEqual([p.x + 0.5, p.y + 0.5]);
  });

  it('brings back the story mobs a defeat step waits for, and only as many as are still needed', () => {
    const g = newGame(content, { seed: 12, hero: 'amelia' });
    // one guard still to calm, however many the chapter asks for (package 33b made it 1)
    const need = (ch7.steps[guardStep] as { n?: number }).n ?? 1;
    g.s.quests.ch7 = { step: guardStep, n: need - 1 };
    enterArea(g, 'hall', 13.5, 16.4, 'up');
    g.rt.mode = 'play';
    run(g, 13);
    expect(g.rt.mobs.filter((m) => m.id === 'creeper')).toHaveLength(1);
    run(g, 60);
    expect(g.rt.mobs.filter((m) => m.id === 'creeper')).toHaveLength(1);
  });
});
