// Ways a child could get stuck for good, found by the rules review of 18 Nov 2026. Plain Node, no browser.
import { describe, expect, it } from 'vitest';
import { give } from '../src/core/bag.ts';
import { count } from '../src/core/cond.ts';
import { talkTo } from '../src/core/quests.ts';
import { newGame } from '../src/core/state.ts';
import { NO_INPUT, step } from '../src/core/step.ts';
import type { Game } from '../src/core/types.ts';
import { content } from '../src/data/content.ts';

const fresh = (): Game => {
  const g = newGame(content, { seed: 5, hero: 'amelia' });
  g.rt.mode = 'play';
  g.rt.talk = null;
  g.rt.cut = null;
  g.rt.q = [];
  return g;
};
type St = (typeof content.quests)[string]['steps'][number];
/**
 * Put the story at the first step that matches: in the named quest, else in any quest, else (the story moved on in
 * phase 2) in a one-step test quest made from `stand`. Returns the quest id and the step.
 */
const at = (g: Game, quest: string, pred: (st: St) => boolean, stand?: St): { q: string; i: number } => {
  let q = quest;
  let i = content.quests[quest]?.steps.findIndex(pred) ?? -1;
  if (i < 0)
    for (const id of content.questOrder) {
      i = content.quests[id]!.steps.findIndex(pred);
      if (i >= 0) {
        q = id;
        break;
      }
    }
  if (i < 0 && stand) {
    q = 't_review';
    i = 0;
    g.c = {
      ...g.c,
      quests: {
        ...g.c.quests,
        t_review: { id: q, name: 'Test', kind: 'side', region: 'home', giver: 'mum', steps: [stand], visible: '' },
      },
    };
  }
  expect(i).toBeGreaterThanOrEqual(0);
  for (const id in g.s.quests) g.s.quests[id]!.done = true;
  g.s.quests[q] = { step: i, n: 0 };
  return { q, i };
};

describe('review findings', () => {
  it('the claw machine gives a go when the story asks for one, even after the free go is used', () => {
    const g = fresh();
    at(g, 'prologue', (st) => st.t === 'mini' && st.game === 'claw', { t: 'mini', game: 'claw' });
    g.s.flags.claw_free = 1;
    g.s.counts.clawGoes = 0;
    const m = content.areas.island!.objects.find((o) => o.type === 'claw_machine')!;
    g.s.area = 'island';
    g.s.x = g.rt.px = m.x + 1;
    g.s.y = g.rt.py = m.y + 2.5;
    g.s.dir = 'up';
    step(g, { ...NO_INPUT, act: true });
    expect(g.rt.mode).toBe('mini');
    expect(g.rt.mini?.game).toBe('claw');
  });

  it('a hand-over takes the thing only when the talk ends, together with the step', () => {
    const g = fresh();
    const { q, i } = at(g, 'prologue', (st) => st.t === 'deliver' && !!content.items[st.item] && st.to !== 'you');
    const st = g.c.quests[q]!.steps[i]!;
    if (st.t !== 'deliver') throw new Error('not a deliver step');
    const n = st.n ?? 1;
    give(g, st.item, n);
    expect(talkTo(g, st.to)).toBe(true);
    // in the middle of the talk (where the pause menu can save): she still has it, and the step is not done
    expect(g.rt.mode).toBe('talk');
    expect(count(g, st.item)).toBe(n);
    expect(g.s.quests[q]!.step).toBe(i);
    for (let k = 0; k < 600 && g.rt.mode !== 'play'; k++) step(g, { ...NO_INPUT, act: k % 2 === 0 });
    expect(count(g, st.item)).toBe(0);
    expect(g.s.quests[q]!.step).toBeGreaterThan(i);
  });

  it('a lead step never runs out of animals: more join the herd when hers live in her own pens', () => {
    const g = fresh();
    const { i } = at(g, 'ch2', (st) => st.t === 'lead' && st.animal === 'chicken');
    for (const a of g.s.animals) if (a.kind === 'chicken') a.pen = 'home_pen';
    const loose = () => g.s.animals.filter((a) => a.kind === 'chicken' && !a.pen).length;
    expect(loose()).toBe(0);
    for (let k = 0; k < 60; k++) step(g, NO_INPUT);
    expect(loose()).toBeGreaterThanOrEqual(1);
    const before = g.s.animals.length;
    for (let k = 0; k < 120; k++) step(g, NO_INPUT);
    // and it does not keep adding once there are enough
    expect(g.s.animals.length).toBe(before);
    expect(g.s.quests.ch2!.step).toBe(i);
  });
});
