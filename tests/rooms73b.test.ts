// Package 73b (D79 to D81): post for her at the Post Office, the cafe counter, the school quiz, her greenhouse pots.
// Plain Node, no browser. Dad's words are never read here: the rules only ever see which days have a note.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CAFE_STALL, cafeSit } from '../src/core/cafe.ts';
import { count } from '../src/core/cond.ts';
import { enterArea } from '../src/core/hero.ts';
import { closeMini } from '../src/core/minigames.ts';
import { dadDays, openPost, POST_DAYS, postDay, postList, postNew, postRead, stepPost } from '../src/core/post.ts';
import { POT_NOON, potAct, potAt, potCrop, potHint, stepPots } from '../src/core/pots.ts';
import { misspell, QUIZ, quizPick } from '../src/core/quiz.ts';
import { load, serialize } from '../src/core/save.ts';
import { newGame } from '../src/core/state.ts';
import { NO_INPUT, step } from '../src/core/step.ts';
import { fill } from '../src/core/talk.ts';
import type { Ev, Game, Input } from '../src/core/types.ts';
import { content } from '../src/data/content.ts';
import personal from '../src/data/personal.json' with { type: 'json' };

const playing = (): Game => {
  const g = newGame(content, { seed: 7, hero: 'amelia' });
  g.rt.mode = 'play';
  g.rt.talk = null;
  g.rt.cut = null;
  g.rt.card = null;
  g.rt.q = [];
  g.rt.spawnT = 1e9;
  for (const id in g.s.quests) g.s.quests[id]!.done = true;
  g.s.tracked = null;
  g.rt.mobs.length = 0;
  g.rt.npcs.length = 0;
  g.rt.beasts.length = 0;
  return g;
};
const run = (g: Game, inp: Partial<Input>, frames: number): Ev[] => {
  const out: Ev[] = [];
  for (let i = 0; i < frames; i++) {
    step(g, { ...NO_INPUT, ...inp });
    out.push(...g.ev);
    g.ev.length = 0;
  }
  return out;
};
const ALL = Array.from({ length: POST_DAYS }, (_, i) => i + 1);
/** A morning: what sleeping does to the save's crops and day (the clock's own morning is tested elsewhere). */
const morning = (g: Game) => {
  g.s.day++;
  g.s.time = 0;
  for (const c of g.s.crops) c.age++;
};

describe('I4: post for her (D80, D81)', () => {
  it('goes by the real date: none before December, the date in December, all 25 from Christmas Day on', () => {
    expect(postDay(2026, 10, 30)).toBe(0);
    expect(postDay(2026, 11, 1)).toBe(1);
    expect(postDay(2026, 11, 3)).toBe(3);
    expect(postDay(2026, 11, 24)).toBe(24);
    expect(postDay(2026, 11, 25)).toBe(25);
    expect(postDay(2026, 11, 31)).toBe(25);
    expect(postDay(2027, 0, 2)).toBe(25);
    expect(postDay(2027, 6, 1)).toBe(25);
  });

  it('on 3 December 3 notes wait, on 25 December and 2 January all 25, none before December', () => {
    const g = playing();
    g.rt.dec = ALL;
    g.rt.today = postDay(2026, 11, 3);
    expect(dadDays(g)).toEqual([1, 2, 3]);
    g.rt.today = postDay(2026, 11, 25);
    expect(dadDays(g)).toEqual(ALL);
    g.rt.today = postDay(2027, 0, 2);
    expect(dadDays(g)).toEqual(ALL);
    g.rt.today = postDay(2026, 10, 20);
    expect(dadDays(g)).toEqual([]);
    expect(postList(g).filter((e) => e.day)).toEqual([]);
  });

  it('the personal file has the 25 December notes the rules are told about', () => {
    const dec = (personal as { december?: Record<string, unknown> }).december ?? {};
    expect(
      Object.keys(dec)
        .map(Number)
        .sort((a, b) => a - b),
    ).toEqual(ALL);
    for (const v of Object.values(dec)) expect(typeof v).toBe('string');
  });

  it('a read note is marked read and stays in the list; the save keeps it', () => {
    const g = playing();
    g.rt.dec = ALL;
    g.rt.today = 25;
    expect(postNew(g)).toBe(true);
    openPost(g);
    const list = postList(g);
    expect(list.slice(0, 25).map((e) => e.day)).toEqual(ALL);
    expect(list.every((e) => e.unread)).toBe(true);
    step(g, { ...NO_INPUT, cmd: { c: 'read', letter: 'post:dad:1' } });
    const after = postList(g);
    expect(after.length).toBe(list.length);
    expect(after[0]!.unread).toBe(false);
    expect(after[1]!.unread).toBe(true);
    // read twice: nothing more happens
    postRead(g, 'post:dad:1');
    const g2 = load(content, serialize(g), {}, false);
    g2.rt.dec = ALL;
    g2.rt.today = 25;
    expect(postList(g2)[0]!.unread).toBe(false);
  });

  it('one friend note comes each game day, in turn; its emeralds come once', () => {
    const g = playing();
    g.rt.dec = [];
    g.rt.today = 0;
    expect(postNew(g)).toBe(true);
    openPost(g);
    openPost(g);
    expect(postList(g).length).toBe(1);
    const first = postList(g)[0]!;
    expect(first.from).toBe(content.post![0]!.from);
    postRead(g, first.id);
    expect(postNew(g)).toBe(false);
    const gems = content.post!.reduce((n, p) => n + (p.gems ?? 0), 0);
    const e0 = g.s.emeralds;
    for (let d = 0; d < 12; d++) {
      morning(g);
      expect(postNew(g)).toBe(true);
      openPost(g);
      const top = postList(g)[0]!;
      postRead(g, top.id);
      postRead(g, top.id);
    }
    // 13 notes came: the list keeps the last 10, newest first; the presents came once each
    const list = postList(g);
    expect(list.length).toBe(10);
    expect(list[0]!.id).toBe('post:fr:12');
    expect(g.s.emeralds - e0).toBe(gems - (content.post![0]!.gems ?? 0));
  });

  it('a player without the personal file gets no note from Dad and no name from the file', () => {
    const names: Record<string, string> = {};
    for (const [k, v] of Object.entries(content.strings)) if (k.startsWith('tok:')) names[k.slice(4)] = v;
    const g = newGame(content, { seed: 2, hero: 'koala', names, xmas: true });
    for (const id in g.s.quests) g.s.quests[id]!.done = true;
    g.rt.dec = [];
    g.rt.today = 25;
    for (let d = 0; d < 10; d++) {
      openPost(g);
      morning(g);
    }
    const list = postList(g);
    expect(list.length).toBe(10);
    expect(list.some((e) => e.day > 0)).toBe(false);
    const real = Object.entries((personal as { names: Record<string, string> }).names)
      .filter(([k]) => !k.startsWith('trail_note') && k !== 'koala')
      .map(([, v]) => v.toLowerCase());
    for (const e of list) {
      const words = fill(g, content.strings[e.text]!).toLowerCase();
      expect(words).not.toMatch(/undefined|\{|\}/);
      for (const n of real) expect(words).not.toMatch(new RegExp(`\\b${n}\\b`));
    }
  });

  it('the line "Post for you" comes the first time post waits and again when new notes from Dad arrive', () => {
    const g = playing();
    g.rt.dec = ALL;
    g.rt.today = 3;
    const said = () => {
      stepPost(g);
      const n = g.ev.filter((e) => e.t === 'toast' && e.text === 'post_there').length;
      g.ev.length = 0;
      return n;
    };
    expect(said()).toBe(1);
    expect(said()).toBe(0);
    g.rt.today = 4;
    expect(said()).toBe(1);
    morning(g);
    expect(said()).toBe(0);
  });

  it('Space at the post counter opens "Your post"', () => {
    const g = playing();
    g.rt.dec = ALL;
    g.rt.today = 25;
    const a = g.c.areas.post_in!;
    const o = a.objects.find((x) => x.type === 'post_counter')!;
    enterArea(g, 'post_in', o.x + 1.5, o.y + 1.6, 'up');
    g.rt.npcs.length = 0;
    const ev = run(g, { act: true }, 1);
    expect(ev.some((e) => e.t === 'open' && e.ui === 'post')).toBe(true);
  });
});

describe('I5: the cafe serves', () => {
  it('the counter sells things to eat and drink, each fills hearts', () => {
    const def = content.stalls[CAFE_STALL]!;
    expect(def.sells.length).toBeGreaterThanOrEqual(3);
    for (const r of def.sells) expect(content.items[r.item]!.heal).toBeGreaterThan(0);
    const cafe = content.areas.cafe_in!.objects.find((o) => o.type === 'cafe_counter')!;
    expect(cafe.d).toBe(CAFE_STALL);
    expect(content.objects.cafe_counter!.interact).toBe('stall');
  });

  it('buying at the counter costs emeralds; eating fills hearts', () => {
    const g = playing();
    g.s.emeralds = 20;
    const i = content.stalls[CAFE_STALL]!.sells.findIndex((r) => r.item === 'apple_pie');
    step(g, { ...NO_INPUT, cmd: { c: 'buy', stall: CAFE_STALL, i } });
    expect(g.s.emeralds).toBe(14);
    expect(count(g, 'apple_pie')).toBe(1);
    g.s.hp = 2;
    const slot = g.s.bag.findIndex((s) => s?.id === 'apple_pie');
    step(g, { ...NO_INPUT, cmd: { c: 'eat', slot } });
    expect(g.s.hp).toBe(2 + content.items.apple_pie!.heal!);
  });

  it('sitting at a cafe table with cafe food and hearts not full eats it there, with a happy sound', () => {
    const g = playing();
    g.s.emeralds = 20;
    step(g, { ...NO_INPUT, cmd: { c: 'buy', stall: CAFE_STALL, i: 0 } });
    expect(count(g, 'cookie')).toBe(1);
    g.s.hp = g.s.maxHp;
    expect(cafeSit(g, 1, 1)).toBe(false);
    g.s.hp = 2;
    expect(cafeSit(g, 1, 1)).toBe(true);
    expect(count(g, 'cookie')).toBe(0);
    expect(g.s.hp).toBeGreaterThan(2);
    expect(g.ev.some((e) => e.t === 'sfx' && e.id === 'chime')).toBe(true);
  });
});

describe('I6: the school quiz', () => {
  const quiz = (g: Game) => {
    const a = g.c.areas.school_in!;
    const b = a.objects.find((o) => o.type === 'blackboard')!;
    enterArea(g, 'school_in', b.x + 1, b.y + 1.6, 'up');
    g.rt.npcs.length = 0;
    run(g, { act: true }, 1);
    expect(g.rt.mini?.game).toBe('quiz');
    run(g, {}, 30);
    run(g, { act: true }, 1);
    expect(g.rt.mini!.st).toBe(1);
  };
  /** Answer every question right (or wrong) until the minute is up. */
  const answer = (g: Game, right: boolean) => {
    const keys: string[] = [];
    while (g.rt.mini?.st === 1) {
      const q = g.rt.mini.quiz!;
      if (q.picked < 0) {
        keys.push(q.key);
        quizPick(g, right ? q.right : (q.right + 1) % 3);
      }
      run(g, {}, 1);
    }
    return keys;
  };

  it('Space at the blackboard opens the quiz; X on its start card is "Not now"', () => {
    const g = playing();
    const a = g.c.areas.school_in!;
    const b = a.objects.find((o) => o.type === 'blackboard')!;
    enterArea(g, 'school_in', b.x + 1, b.y + 1.6, 'up');
    g.rt.npcs.length = 0;
    run(g, { act: true }, 1);
    expect(g.rt.mini?.game).toBe('quiz');
    run(g, {}, 30);
    run(g, { back: true }, 1);
    expect(g.rt.mini).toBeNull();
    expect(g.rt.mode).toBe('play');
  });

  it('never asks the same question twice in a row, takes turns of the two kinds, and scores', () => {
    const g = playing();
    quiz(g);
    const keys = answer(g, true);
    expect(keys.length).toBeGreaterThan(20);
    for (let i = 1; i < keys.length; i++) {
      expect(keys[i]).not.toBe(keys[i - 1]);
      expect(keys[i]![0]).not.toBe(keys[i - 1]![0]);
    }
    for (let i = 2; i < keys.length; i++) expect(keys[i]).not.toBe(keys[i - 2]);
    expect(g.rt.mini!.st).toBe(2);
    expect(g.rt.mini!.score).toBe(keys.length);
    expect(g.s.counts.quiz_best).toBe(keys.length);
  });

  it('a wrong answer shows the right one for a second and goes on, with no penalty', () => {
    const g = playing();
    quiz(g);
    const q = g.rt.mini!.quiz!;
    quizPick(g, (q.right + 1) % 3);
    expect(g.rt.mini!.score).toBe(0);
    expect(q.show).toBeCloseTo(QUIZ.wrong);
    run(g, {}, Math.ceil(QUIZ.wrong * 60) + 1);
    expect(g.rt.mini!.quiz!.key).not.toBe(q.key);
    expect(g.rt.mini!.quiz!.picked).toBe(-1);
  });

  it('the questions are fair: times tables up to 12 x 12, three different answers, one right', () => {
    const g = playing();
    quiz(g);
    for (let n = 0; n < 40; n++) {
      const q = g.rt.mini!.quiz!;
      expect(new Set(q.answers).size).toBe(3);
      if (q.kind === 0) {
        const [a, b] = q.text.split(' x ').map(Number);
        expect(a! >= 2 && a! <= 12 && b! >= 2 && b! <= 12).toBe(true);
        expect(q.answers[q.right]).toBe(String(a! * b!));
      } else expect(content.words).toContain(q.answers[q.right]);
      quizPick(g, q.right);
      run(g, {}, Math.ceil(QUIZ.right * 60) + 1);
    }
  });

  it('5 or more gives the gold star once a game day', () => {
    const g = playing();
    const e0 = g.s.emeralds;
    quiz(g);
    answer(g, true);
    expect(g.rt.mini!.why).toBe('quiz_why_gold');
    expect(g.s.emeralds - e0).toBe(QUIZ.gems);
    closeMini(g);
    quiz(g);
    answer(g, true);
    expect(g.rt.mini!.why).toBe('mini_why_time');
    expect(g.s.emeralds - e0).toBe(QUIZ.gems);
    closeMini(g);
    g.s.day++;
    quiz(g);
    answer(g, false);
    expect(g.s.emeralds - e0).toBe(QUIZ.gems);
    closeMini(g);
    quiz(g);
    answer(g, true);
    expect(g.s.emeralds - e0).toBe(QUIZ.gems * 2);
  });

  it('starts by a tap on an answer as well (the choose command)', () => {
    const g = playing();
    quiz(g);
    const q = g.rt.mini!.quiz!;
    run(g, { cmd: { c: 'choose', i: q.right } }, 1);
    expect(g.rt.mini!.score).toBe(1);
  });

  it('the spelling words are about 120, and every wrong form is not a word she knows', () => {
    const words = content.words!;
    expect(words.length).toBeGreaterThanOrEqual(110);
    expect(new Set(words).size).toBe(words.length);
    const common = new Set(
      readFileSync(new URL('../tools/check/common-words.txt', import.meta.url), 'utf8')
        .split('\n')
        .map((w) => w.trim().toLowerCase()),
    );
    const real = new Set(['wood', 'resent', 'strait', 'color', 'favorite', 'neighbor', 'thou']);
    const list = new Set(words);
    for (const w of words) {
      expect(w).toMatch(/^[a-z]+$/);
      const wrong = misspell(w, list).slice(0, 4);
      expect(wrong.length, w).toBe(4);
      for (const x of wrong) {
        expect(common.has(x) || real.has(x) || list.has(x), `${w}: ${x}`).toBe(false);
        expect(x).not.toBe(w);
      }
    }
  });
});

describe('I7: her greenhouse pots', () => {
  const atPot = (g: Game, n: number) => {
    const o = potAt(g, n)!;
    enterArea(g, 'green_in', o.x + 0.5, o.y + 1.5, 'up');
    g.rt.npcs.length = 0;
    return o;
  };

  it('the greenhouse has three pots, after everything package 72 put there', () => {
    // the room's find (package 73a) was appended after them when the two packages were merged
    const pots = content.areas.green_in!.objects.map((o) => o.id).filter((id) => id?.startsWith('her_pot_'));
    expect(pots).toEqual(['her_pot_1', 'her_pot_2', 'her_pot_3']);
  });

  it('Space with seeds plants; the crop is ready in half the days of the same crop outside', () => {
    for (const seed of ['carrot_seed', 'pumpkin_seed']) {
      const g = playing();
      g.s.bag[0] = { id: seed, n: 2 };
      g.s.hot = 0;
      g.s.time = 10;
      const o = atPot(g, 2);
      expect(potHint(g, 2)).toBe('plant');
      run(g, { act: true }, 1);
      const p = potCrop(g, 2)!;
      expect(p.c.seed).toBe(seed);
      expect(count(g, seed)).toBe(1);
      const days = content.items[seed]!.grows!.days;
      // outside it needs `days` mornings; in the pot the crop also grows at midday
      let halfDays = 0;
      while (potHint(g, 2) !== 'pick') {
        if (g.s.time < POT_NOON) g.s.time = POT_NOON;
        else morning(g);
        stepPots(g);
        halfDays++;
        expect(halfDays).toBeLessThan(10);
      }
      expect(halfDays).toBe(days);
      const crop = content.items[seed]!.grows!.crop;
      const before = count(g, crop);
      g.ev.length = 0;
      potAct(g, o);
      expect(count(g, crop) - before).toBe(content.items[seed]!.grows!.n);
      expect(potCrop(g, 2)).toBeNull();
    }
  });

  it('with no seeds it says so; while it grows Space only looks', () => {
    const g = playing();
    const o = atPot(g, 1);
    potAct(g, o);
    expect(g.s.crops.length).toBe(0);
    expect(g.rt.nudge).toBe(content.strings.pot_seeds);
    g.s.bag[3] = { id: 'wheat_seed', n: 1 };
    potAct(g, o);
    expect(potHint(g, 1)).toBe('wait');
    potAct(g, o);
    expect(g.s.crops.length).toBe(1);
  });

  it('a pot crop survives a save and never shows as an island crop', () => {
    const g = playing();
    g.s.bag[0] = { id: 'carrot_seed', n: 1 };
    potAct(g, atPot(g, 3));
    const g2 = load(content, serialize(g), {}, false);
    expect(potCrop(g2, 3)?.c.seed).toBe('carrot_seed');
    expect(g2.s.crops.every((c) => c.x < 0 && c.y < 0)).toBe(true);
  });
});
