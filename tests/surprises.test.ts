// Rare surprises (design section 4): a Minion stampede, a Kuromi prank and a chicken jockey.
// Titles are matched exactly by the design checklist script: do not reword them.
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { newDay } from '../src/core/clock.ts';
import { skipCut } from '../src/core/cutscene.ts';
import { makeMob } from '../src/core/mobs.ts';
import { place } from '../src/core/quests.ts';
import { newGame } from '../src/core/state.ts';
import { NO_INPUT, step } from '../src/core/step.ts';
import {
  POST_MORNING_END,
  SLOTS,
  SURPRISES,
  stepPostRound,
  stepSurprise,
  surpriseToday,
} from '../src/core/surprises.ts';
import type { Game } from '../src/core/types.ts';
import { content } from '../src/data/content.ts';

const ready = (seed: number): Game => {
  const g = newGame(content, { seed, hero: 'amelia' });
  g.rt.mode = 'play';
  g.rt.talk = null;
  g.rt.q = [];
  g.s.flags.minions_here = 1;
  g.s.shards = 4;
  g.s.quests.ch1 = { step: 99, n: 0, done: true, day: 1 };
  g.s.day = 2;
  return g;
};
const standNear = (g: Game, name: string) => {
  const p = place(g, name)!;
  g.s.area = p.area;
  g.s.x = p.x + 0.5;
  g.s.y = p.y + 2.5;
};

describe('rare surprises', () => {
  it('a rare surprise plays at most once a day, near its spot, never in a fight, and gives a sticker', () => {
    const seen: Record<string, number> = {};
    let days = 0;
    let surpriseDays = 0;
    for (const seed of [1, 2, 3]) {
      const g = ready(seed);
      for (let d = 0; d < 20; d++) {
        newDay(g, true);
        days++;
        const sp = surpriseToday(g);
        if (!sp) continue;
        surpriseDays++;
        // its own time of day only
        const [from, to] = SLOTS[g.s.counts.surpSlot ?? 0]!;
        g.s.time = from - 5;
        standNear(g, sp.near);
        stepSurprise(g);
        expect(g.rt.cut).toBeNull();
        g.s.time = (from + to) / 2;
        // far from its spot: nothing
        g.s.x += 40;
        stepSurprise(g);
        expect(g.rt.cut).toBeNull();
        standNear(g, sp.near);
        // in a fight: nothing
        const m = makeMob(g, 'zombie', g.s.x + 2, g.s.y);
        g.rt.mobs.push(m);
        stepSurprise(g);
        expect(g.rt.cut).toBeNull();
        m.gone = true;
        // a quiet moment by its spot: it plays, and the sticker comes when it ends
        stepSurprise(g);
        expect(g.rt.cut?.id).toBe(sp.cut);
        skipCut(g);
        for (let i = 0; i < 5; i++) step(g, NO_INPUT);
        expect(g.s.stickers[sp.sticker]).toBeTruthy();
        seen[sp.id] = (seen[sp.id] ?? 0) + 1;
        // and never twice in one day
        g.rt.mode = 'play';
        g.rt.cut = null;
        stepSurprise(g);
        expect(g.rt.cut).toBeNull();
      }
    }
    // rare, but every one of the three comes round
    expect(surpriseDays).toBeGreaterThan(0);
    expect(surpriseDays).toBeLessThan(days * 0.6);
    for (const sp of SURPRISES) expect(seen[sp.id], sp.id).toBeGreaterThan(0);
  });

  it('every surprise scene has its sticker and characters with art', () => {
    for (const sp of SURPRISES) {
      expect(content.cutscenes[sp.cut], sp.cut).toBeTruthy();
      expect(content.stickers[sp.sticker], sp.sticker).toBeTruthy();
      expect(place({ c: content } as Game, sp.near), sp.near).toBeTruthy();
      const who = new Set(content.cutscenes[sp.cut]!.acts.filter((a) => a.a === 'spawn').map((a) => a.who!));
      for (const id of who) {
        expect(content.chars[id] || content.animals[id] || content.mobs[id], id).toBeTruthy();
        // the chicken jockey's rider is drawn by the view from the zombie's sheet
        if (sp.id === 'jockey') expect(existsSync('public/assets/chars/zombie-0.json')).toBe(true);
        expect(existsSync(`public/assets/chars/${id}-0.json`), `${id} has art`).toBe(true);
      }
    }
  });

  it('Paddington carries the post to the mailbox on a morning with post', () => {
    const g = ready(4);
    g.s.flags['mq:dad_1'] = 1;
    newDay(g, true);
    expect(g.s.inbox).toContain('dad_1');
    // not while she is far from home
    standNear(g, 'great_tree');
    g.s.time = 60;
    stepPostRound(g);
    expect(g.rt.cut).toBeNull();
    // near home in the morning: he walks it to the mailbox
    standNear(g, 'mailbox');
    stepPostRound(g);
    expect(g.rt.cut?.id).toBe('post_round');
    const acts = content.cutscenes.post_round!.acts;
    expect(acts.some((a) => a.a === 'spawn' && a.who === 'paddington')).toBe(true);
    expect(
      acts.some((a) => a.a === 'move' && a.who === 'paddington' && a.at === 'mailbox' && Math.abs(a.x ?? 9) <= 1),
    ).toBe(true);
    skipCut(g);
    g.rt.mode = 'play';
    // once a day, mornings only, and only on a day with post
    stepPostRound(g);
    expect(g.rt.cut).toBeNull();
    newDay(g, true);
    g.rt.mode = 'play';
    standNear(g, 'mailbox');
    g.s.time = 60;
    stepPostRound(g);
    expect(g.rt.cut).toBeNull();
    g.s.flags['mq:mum_1'] = 1;
    newDay(g, true);
    g.rt.mode = 'play';
    standNear(g, 'mailbox');
    g.s.time = POST_MORNING_END + 10;
    stepPostRound(g);
    expect(g.rt.cut).toBeNull();
  });
});
