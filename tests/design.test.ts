// Design promises proved against the real rules in src/core (see docs/GAME_DESIGN.md).
// Titles are matched exactly by the design checklist script: do not reword them.
import { describe, expect, it } from 'vitest';
import { BAG_SLOTS, CHEST_SLOTS, HOTBAR, give } from '../src/core/bag.ts';
import { NIGHT_AT } from '../src/core/cond.ts';
import { newDay } from '../src/core/clock.ts';
import { canPlace } from '../src/core/build.ts';
import { refreshNpcs } from '../src/core/npcs.ts';
import { enterArea } from '../src/core/hero.ts';
import { closeMini, HIDE, MINIS, startMini } from '../src/core/minigames.ts';
import { FUSE, makeMob, WINDUP } from '../src/core/mobs.ts';
import { completeStep, objective, OFFERS_PER_DAY, place, refreshQuests } from '../src/core/quests.ts';
import { newGame } from '../src/core/state.ts';
import { NO_INPUT, step } from '../src/core/step.ts';
import type { Cmd, Game, Input } from '../src/core/types.ts';
import { content } from '../src/data/content.ts';

const fresh = (seed = 7): Game => newGame(content, { seed, hero: 'amelia' });
const run = (g: Game, n: number, inp: Input = NO_INPUT) => {
  for (let i = 0; i < n; i++) step(g, inp);
};
/** A new game opens with a chat; these tests start from free play. */
const playing = (g: Game): Game => {
  g.rt.mode = 'play';
  g.rt.talk = null;
  g.rt.q = [];
  return g;
};
const saves = (g: Game) => g.ev.filter((e) => e.t === 'save').length;

describe('mobs', () => {
  it('never more than 3 hostile mobs near the hero', () => {
    const g = fresh(11);
    // the middle of the plains night zone, on the island, in the dark
    enterArea(g, 'island', 132.5, 67.5, 'down');
    let most = 0;
    for (let i = 0; i < 60 * 240; i++) {
      g.s.time = NIGHT_AT + 20;
      g.s.hp = g.s.maxHp;
      step(g, NO_INPUT);
      g.ev.length = 0;
      let n = 0;
      for (const m of g.rt.mobs) {
        if (m.gone || m.calm || g.c.mobs[m.id]?.role !== 'hostile') continue;
        if (Math.hypot(m.x - g.s.x, m.y - g.s.y) <= 16) n++;
      }
      most = Math.max(most, n);
      expect(n).toBeLessThanOrEqual(3);
    }
    // the cap is only meaningful if the night really did send some
    expect(most).toBeGreaterThanOrEqual(1);
  });

  it('a mob winds up before it strikes', () => {
    const hostile = Object.values(content.mobs).filter((m) => m.role === 'hostile');
    expect(hostile.length).toBeGreaterThan(0);
    for (const def of hostile) {
      const g = fresh(5);
      enterArea(g, 'island', 132.5, 67.5, 'down');
      g.s.time = NIGHT_AT + 20;
      const m = makeMob(g, def.id, g.s.x + 2.5, g.s.y, '');
      m.tag = 'story';
      // an enderman is shy until it is hit: she has just hit it
      if (def.ai === 'ender') m.phase = 1;
      let warned = 0;
      let hurtAt = -1;
      for (let i = 0; i < 60 * 12 && hurtAt < 0; i++) {
        g.s.time = NIGHT_AT + 20;
        const hp = g.s.hp;
        step(g, NO_INPUT);
        g.ev.length = 0;
        if ((m.st === WINDUP || m.st === FUSE) && m.t > 0) warned++;
        if (g.s.hp < hp) hurtAt = i;
      }
      expect(hurtAt, `${def.id} never hurt her`).toBeGreaterThanOrEqual(0);
      // at least a fifth of a second (12 ticks) of warning before the first hit
      expect(warned, `${def.id} hit with no wind-up`).toBeGreaterThanOrEqual(12);
    }
  });
});

describe('bag', () => {
  /** A bag full of one thing, nothing wanted by any quest, and a different thing to pick up. */
  const fullBag = () => {
    const g = fresh();
    g.s.quests = {};
    const mats = Object.values(content.items).filter((d) => d.kind === 'material' && !d.pouch && (d.stack ?? 99) > 1);
    const fill = mats[0]!;
    const extra = mats[1]!;
    give(g, fill.id, (fill.stack ?? 99) * BAG_SLOTS, true);
    expect(g.s.bag.every((sl) => sl?.id === fill.id)).toBe(true);
    g.ev.length = 0;
    return { g, fill, extra };
  };

  it('a full bag sends one spare stack home to a chest', () => {
    const { g, fill, extra } = fullBag();
    g.s.chests['1'] = new Array(CHEST_SLOTS).fill(null);
    const hotbar = g.s.bag.slice(0, HOTBAR).map((sl) => ({ ...sl! }));
    give(g, extra.id, 1, true);
    // the pick-up was not blocked and nothing was left on the floor
    expect(g.s.bag.some((sl) => sl?.id === extra.id)).toBe(true);
    expect(g.s.drops).toHaveLength(0);
    // exactly one stack went to the chest
    const home = g.s.chests['1']!.filter((sl) => sl);
    expect(home).toHaveLength(1);
    expect(home[0]!.id).toBe(fill.id);
    // the hotbar was never touched
    expect(g.s.bag.slice(0, HOTBAR)).toEqual(hotbar);
  });

  it('with no chest a full bag leaves the item waiting on the ground', () => {
    const { g, extra } = fullBag();
    g.s.chests = {};
    give(g, extra.id, 2, true);
    expect(g.s.bag.some((sl) => sl?.id === extra.id)).toBe(false);
    expect(g.s.drops).toEqual([expect.objectContaining({ id: extra.id, n: 2, area: g.s.area })]);
    // it waits: make room, stand on it, and she picks it up
    g.s.bag[20] = null;
    run(g, 2);
    expect(g.s.drops).toHaveLength(0);
    expect(g.s.bag.some((sl) => sl?.id === extra.id)).toBe(true);
  });
});

describe('autosave', () => {
  it('autosaves on sleep, on every quest step and every minute', () => {
    // every minute
    // (with no quests in the world, so only the minute timer can be saving)
    const g = playing(newGame({ ...content, quests: {}, questOrder: [] }, { seed: 7, hero: 'amelia' }));
    g.ev.length = 0;
    for (let i = 0; i < 60 * 60 * 3 + 30; i++) {
      playing(g);
      step(g, NO_INPUT);
    }
    expect(saves(g)).toBe(3);

    // on sleep
    const h = fresh();
    h.ev.length = 0;
    newDay(h, true);
    expect(saves(h)).toBeGreaterThanOrEqual(1);

    // on every quest step
    const q = fresh();
    const id = content.questOrder.find((k) => (content.quests[k]!.steps.length ?? 0) >= 2)!;
    q.s.quests[id] = { step: 0, n: 0 };
    q.ev.length = 0;
    completeStep(q, id);
    expect(saves(q)).toBe(1);
    completeStep(q, id);
    expect(saves(q)).toBe(2);
  });
});

describe('mini-games', () => {
  it('a mini-game always gives at least one star and can be replayed', () => {
    for (const game of Object.keys(MINIS)) {
      const g = fresh();
      g.s.time = 100;
      // play badly: press nothing but the start key, and let the time run out
      startMini(g, game, null, '');
      expect(g.rt.mode, game).toBe('mini');
      for (let i = 0; i < 60 * 3 && g.rt.mini!.st === 0; i++) step(g, { ...NO_INPUT, act: true });
      for (let i = 0; i < 60 * 240 && g.rt.mini!.st !== 2; i++) {
        g.s.time = 100;
        if (game === 'hide') {
          // hide and seek has no clock: play it as badly as possible, peeking at every bush in turn
          const m = g.rt.mini!;
          const o = m.objs.find((b) => b.k === 0);
          const to =
            o &&
            [
              [1, 0],
              [-1, 0],
              [0, 1],
              [0, -1],
            ]
              .map(([dx, dy]) => [o.x + dx!, o.y + dy!] as const)
              .find(
                ([x, y]) => x >= 0 && y >= 0 && x < HIDE.w && y < HIDE.h && !m.objs.some((b) => b.x === x && b.y === y),
              );
          if (to) {
            m.n[0] = to[0];
            m.n[1] = to[1];
          }
          step(g, { ...NO_INPUT, act: true });
        } else step(g, NO_INPUT);
      }
      expect(g.rt.mini!.st, `${game} never ended`).toBe(2);
      expect(g.rt.mini!.stars, game).toBeGreaterThanOrEqual(1);
      expect(g.s.stars[game], game).toBeGreaterThanOrEqual(1);
      closeMini(g);
      expect(g.rt.mode).toBe('play');
      // and again
      startMini(g, game, null, '');
      expect(g.rt.mode, `${game} replay`).toBe('mini');
      expect(g.rt.mini!.st).toBe(0);
    }
  });
});

describe('quick travel', () => {
  it('quick travel goes only to visited signposts', () => {
    const signs = Object.values(content.areas)
      .flatMap((a) => Object.keys(a.places))
      .filter((k) => k.startsWith('sign_'))
      .map((k) => k.slice(5));
    expect(signs.length).toBeGreaterThanOrEqual(2);
    const [near, far] = signs as [string, string];
    const g = fresh();
    g.s.signs = [near];
    const here = { area: g.s.area, x: g.s.x, y: g.s.y };
    // not visited: she stays where she is
    step(g, { ...NO_INPUT, cmd: { c: 'travel', sign: far } });
    expect({ area: g.s.area, x: g.s.x, y: g.s.y }).toEqual(here);
    // visited: she arrives beside it
    step(g, { ...NO_INPUT, cmd: { c: 'travel', sign: near } });
    const p = place(g, 'sign_' + near)!;
    expect(g.s.area).toBe(p.area);
    expect(Math.hypot(g.s.x - (p.x + 0.5), g.s.y - (p.y + 0.5))).toBeLessThan(1.5);
  });
});

describe('quest book', () => {
  it('every tracked objective line starts with a verb', () => {
    const g = fresh();
    const lines: { at: string; text: string }[] = [];
    for (const id of content.questOrder) {
      const def = content.quests[id]!;
      for (let i = 0; i <= def.steps.length; i++) {
        g.s.quests[id] = { step: i, n: 0 };
        lines.push({ at: `${id}#${i}`, text: objective(g, id) });
      }
    }
    expect(lines.length).toBeGreaterThan(100);
    // the verbs the game's own objective templates use, plus the ones its quest writers chose
    const verbs = new Set<string>();
    for (const k in content.strings)
      if (k.startsWith('obj_')) verbs.add(content.strings[k]!.split(' ')[0]!.toLowerCase());
    for (const id of content.questOrder)
      for (const st of content.quests[id]!.steps) if (st.goal) verbs.add(st.goal.split(' ')[0]!.toLowerCase());
    const first = (t: string) => t.split(' ')[0]!.toLowerCase();
    const bad = lines.filter((l) => !l.text || l.text.includes('\n') || !verbs.has(first(l.text)));
    expect(bad).toEqual([]);
    // the verb list is a real list of verbs, not a list of nouns the writers happened to start with
    const NOT_VERBS = /^(the|a|an|your|my|our|one|two|three|some|no|new|more|every|all)$/;
    expect([...verbs].filter((v) => NOT_VERBS.test(v) || !/^[a-z]+$/.test(v))).toEqual([]);
  });

  it('the quest book offers at most 3 new side quests a day', () => {
    expect(OFFERS_PER_DAY).toBe(3);
    // every side quest and friend quest ready at once: the worst case for the book
    const quests = Object.fromEntries(
      Object.entries(content.quests).map(([k, q]) => [
        k,
        q.kind === 'side' || q.kind === 'friend' ? { ...q, requires: undefined } : q,
      ]),
    );
    const g = newGame({ ...content, quests }, { seed: 7, hero: 'amelia' });
    const offers = (day: number) => content.questOrder.filter((id) => g.s.flags['off:' + id] === day).length;
    let sawFull = false;
    for (let day = 1; day <= 12; day++) {
      g.s.day = day;
      // asking again and again on the same day never adds more
      for (let i = 0; i < 5; i++) refreshQuests(g);
      expect(offers(day)).toBeLessThanOrEqual(3);
      if (offers(day) === 3) sawFull = true;
      // she takes today's offers up, so tomorrow there are fresh ones to make
      for (const id of content.questOrder)
        if (g.s.flags['off:' + id] === day) g.s.quests[id] = { step: 0, n: 0, done: true, day };
    }
    expect(sawFull).toBe(true);
  });
});

describe('the island', () => {
  it('never more than 6 named characters on one screen', () => {
    // 1920 x 1080 canvas at world zoom 1.5 and 64 px tiles is 20 x 11.25 tiles; a window of 20 x 11 is used
    const W = 20;
    const H = 11;
    const FLAGS = [
      'defence_on',
      'shard2',
      'kuromi_swap',
      'day2',
      'minions_here',
      'king_calm',
      'trader',
      'postgame',
      'king_friend',
    ];
    // story stages the spots test: nothing, the prologue early and late, chapter 5 and 7 active, chapter 6 step 1 on
    const STAGES: [string, Record<string, { step: number; n: number }>][] = [
      ['start', {}],
      ['prologue 2', { prologue: { step: 2, n: 0 } }],
      ['prologue 14', { prologue: { step: 14, n: 0 } }],
      ['ch5', { ch5: { step: 0, n: 0 } }],
      ['ch6 step 2', { ch6: { step: 2, n: 0 } }],
      ['ch7', { ch7: { step: 0, n: 0 } }],
    ];
    const g = fresh();
    // A character can only appear at one of its declared spots. Areas with at most six
    // possible named characters cannot contain a crowded window in any story state.
    const possibleByArea = new Map<string, Set<string>>();
    for (const c of Object.values(content.chars)) {
      if (c.id === g.s.hero || ['hostile', 'animal', 'speakingMob'].includes(c.role)) continue;
      for (const spot of c.spots) {
        const area = place(g, spot.at)?.area;
        if (!area) continue;
        if (!possibleByArea.has(area)) possibleByArea.set(area, new Set());
        possibleByArea.get(area)!.add(c.id);
      }
    }
    const seen = new Map<
      string,
      { area: string; time: string; who: string; ids: [string, number, number][]; why: string }
    >();
    for (const area of Object.keys(content.areas)) {
      if ((possibleByArea.get(area)?.size ?? 0) <= 6) continue;
      g.s.area = area;
      const crowds = new Map<string, { time: string; ids: [string, number, number][]; why: string }>();
      const bySig = new Set<string>();
      for (const night of [false, true])
        for (const xmas of [false, true])
          for (const [stage, quests] of STAGES)
            for (let shards = 0; shards <= 7; shards++)
              for (let mask = 0; mask < 1 << FLAGS.length; mask++) {
                g.s.time = night ? NIGHT_AT + 20 : 100;
                g.s.xmas = xmas;
                g.s.quests = quests;
                g.s.shards = shards;
                g.s.flags = {};
                FLAGS.forEach((f, i) => {
                  if (mask & (1 << i)) g.s.flags[f] = 1;
                });
                g.rt.npcs = [];
                refreshNpcs(g);
                // named: a character with a name of their own; plain villagers, the golem and the shop villager
                // (speaking mobs) are not, and the hero is the player
                const named = g.rt.npcs.filter((n) => content.chars[n.id]?.role !== 'speakingMob' && n.id !== g.s.hero);
                if (named.length <= 6) continue;
                const pts = named.map((n) => [n.id, Math.floor(n.hx), Math.floor(n.hy)] as [string, number, number]);
                const sig =
                  (night ? 'n' : 'd') +
                  pts
                    .map((p) => p.join(':'))
                    .sort()
                    .join(',');
                if (bySig.has(sig)) continue;
                bySig.add(sig);
                const why = `${stage}, ${shards} shards, ${xmas ? 'xmas' : 'no xmas'}, flags [${FLAGS.filter((_, i) => mask & (1 << i)).join(' ')}]`;
                for (const a of pts)
                  for (const b of pts) {
                    const inside = pts.filter(
                      (p) => p[1] >= a[1] && p[1] < a[1] + W && p[2] >= b[2] && p[2] < b[2] + H,
                    );
                    if (inside.length <= 6) continue;
                    const key =
                      (night ? 'night ' : 'day ') +
                      inside
                        .map((p) => p[0])
                        .sort()
                        .join(',');
                    if (!crowds.has(key)) crowds.set(key, { time: night ? 'night' : 'day', ids: inside, why });
                  }
              }
      // keep only the largest crowds: drop one that is a subset of another at the same time
      const list = [...crowds.entries()];
      for (const [key, c] of list) {
        const mine = new Set(key.split(' ')[1]!.split(','));
        const covered = list.some(
          ([k2, c2]) =>
            k2 !== key &&
            c2.time === c.time &&
            [...mine].every((id) => k2.split(' ')[1]!.split(',').includes(id)) &&
            k2.split(' ')[1]!.split(',').length > mine.size,
        );
        if (!covered)
          seen.set(area + key, { area, time: c.time, who: c.ids.map((p) => p[0]).join(','), ids: c.ids, why: c.why });
      }
    }
    const lines = [...seen.values()].map((c) => {
      const x0 = Math.min(...c.ids.map((p) => p[1]));
      const y0 = Math.min(...c.ids.map((p) => p[2]));
      return `${c.area} ${c.time}, ${c.ids.length} named in a ${W}x${H} window from tile ${x0},${y0}: ${c.ids.map((p) => `${p[0]}(${p[1]},${p[2]})`).join(' ')}; first reached at ${c.why}`;
    });
    expect(lines, `crowded windows:\n${lines.join('\n')}`).toEqual([]);
  }, 120_000);
});

describe('build mode', () => {
  it('build mode: Space places, X removes, R rotates, the picked item is what she places', () => {
    const g = playing(fresh());
    g.s.quests = {};
    const cmd = (c: Cmd) => step(g, { ...NO_INPUT, cmd: c });
    // she is in the cottage; find things that can go on the floor at the cursor, one that turns and one that does not
    cmd({ c: 'build', on: true });
    expect(g.rt.mode).toBe('build');
    const b = g.rt.build!;
    const ok = Object.entries(content.items).filter(
      ([id, d]) =>
        d.place &&
        d.place.where !== 'plot' &&
        d.place.layer === 'object' &&
        !d.place.solid &&
        (d.place.w ?? 1) === 1 &&
        (d.place.h ?? 1) === 1 &&
        canPlace(g, id, b.cx, b.cy) !== 'build_taken',
    );
    const turns = ok.find(([, d]) => d.place!.rot)?.[0];
    const plain = ok.filter(([, d]) => !d.place!.rot).map(([id]) => id);
    expect(turns, 'a placeable that rotates').toBeDefined();
    expect(plain.length).toBeGreaterThanOrEqual(2);
    const [a, c] = plain as [string, string];
    // the bag holds a plain one, a rotating one, and another plain one, in that order
    g.s.bag.fill(null);
    g.s.bag[0] = { id: a, n: 3 };
    g.s.bag[1] = { id: turns!, n: 3 };
    g.s.bag[2] = { id: c, n: 3 };
    const placedHere = () => g.s.placed.filter((p) => p.area === g.s.area && p.x === b.cx && p.y === b.cy);

    // Space places the picked item (the first, by default)
    expect(placedHere()).toHaveLength(0);
    step(g, { ...NO_INPUT, act: true });
    expect(placedHere().map((p) => p.item)).toEqual([a]);
    // X removes it and gives it back
    step(g, { ...NO_INPUT, back: true });
    expect(placedHere()).toHaveLength(0);
    expect(g.s.bag[0]).toEqual({ id: a, n: 3 });

    // the picked item is what she places: step the pick on, and Space puts down that one
    cmd({ c: 'bsel', d: 2 });
    expect(g.rt.build!.sel).toBe(2);
    step(g, { ...NO_INPUT, act: true });
    expect(placedHere().map((p) => p.item)).toEqual([c]);
    step(g, { ...NO_INPUT, back: true });
    cmd({ c: 'bsel', d: -1 });
    expect(g.rt.build!.sel).toBe(1);

    // R turns what she is holding, a quarter at a time, and Space places it turned
    expect(g.rt.build!.rot).toBe(0);
    step(g, { ...NO_INPUT, use: true });
    expect(g.rt.build!.rot).toBe(1);
    step(g, { ...NO_INPUT, use: true });
    expect(g.rt.build!.rot).toBe(2);
    step(g, { ...NO_INPUT, act: true });
    const turned = placedHere();
    expect(turned.map((p) => p.item)).toEqual([turns]);
    expect(turned[0]!.rot).toBe(2);

    // the hotbar pick is a command too
    cmd({ c: 'hot', i: 3 });
    expect(g.s.hot).toBe(3);

    // leaving build mode puts her back in play, and Space no longer places
    step(g, { ...NO_INPUT, back: true });
    cmd({ c: 'build', on: false });
    expect(g.rt.mode).toBe('play');
    const count = g.s.placed.length;
    step(g, { ...NO_INPUT, act: true });
    expect(g.s.placed).toHaveLength(count);
  });
});
