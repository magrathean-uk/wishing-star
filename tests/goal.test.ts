// The goal line (package 53a): it shows the current step of the quest she is on, never another quest's while this one
// has a step left; a quest she chooses or is in the middle of becomes the one she is on; a den shows itself; the star
// sits on the enemy a fight step counts.
import { describe, expect, it } from 'vitest';
import { goalLine } from '../src/core/goal.ts';
import { rebuildArea } from '../src/core/grid.ts';
import { makeMob } from '../src/core/mobs.ts';
import { finishQuest, objective, place, startQuest, stepTarget, talkTo } from '../src/core/quests.ts';
import { newGame } from '../src/core/state.ts';
import { NO_INPUT, step } from '../src/core/step.ts';
import { cast } from '../src/core/talk.ts';
import type { Game, Step } from '../src/core/types.ts';
import { content } from '../src/data/content.ts';

const fresh = (): Game => {
  const g = newGame(content, { seed: 7, hero: 'amelia' });
  g.rt.mode = 'play';
  g.rt.talk = null;
  g.rt.cut = null;
  g.rt.card = null;
  g.rt.q = [];
  g.rt.spawnT = 1e9;
  for (const id of g.c.questOrder) g.s.quests[id] = { step: 0, n: 0, done: true };
  g.s.tracked = null;
  return g;
};
const reopen = (g: Game, id: string, stepNo = 0): void => {
  g.s.quests[id] = { step: stepNo, n: 0, done: false };
};
const mains = (g: Game): string[] => g.c.questOrder.filter((id) => g.c.quests[id]!.kind === 'main');
/** The first quest (of these kinds) with a step of this type, and that step's index. */
function withStep(g: Game, t: Step['t'], kinds: string[], skip: string[] = []): [string, number] {
  for (const id of g.c.questOrder) {
    const def = g.c.quests[id]!;
    if (!kinds.includes(def.kind) || skip.includes(id)) continue;
    const i = def.steps.findIndex((s) => s.t === t);
    if (i >= 0) return [id, i];
  }
  throw new Error(`no ${t} step`);
}

describe('the goal line', () => {
  it('stays on the quest she is on while a quest that starts by itself begins', () => {
    const g = fresh();
    const [a, b] = mains(g);
    reopen(g, a!, 1);
    g.s.tracked = a!;
    delete g.s.quests[b!];
    startQuest(g, b!);
    expect(g.s.tracked).toBe(a);
    expect(goalLine(g)!.text).toBe(objective(g, a!));
  });

  it('moves to the next open main quest when hers is done', () => {
    const g = fresh();
    const [a, b] = mains(g);
    reopen(g, a!, g.c.quests[a!]!.steps.length);
    reopen(g, b!, 0);
    g.s.tracked = a!;
    finishQuest(g, a!);
    expect(g.s.tracked).toBe(b);
  });

  it('follows a quest she takes herself', () => {
    const g = fresh();
    const [a] = mains(g);
    reopen(g, a!, 1);
    g.s.tracked = a!;
    const side = g.c.questOrder.find((id) => g.c.quests[id]!.kind === 'side')!;
    delete g.s.quests[side];
    startQuest(g, side, true);
    // package 69: while a story step is left, a job she takes goes into the quest book; picking it there moves the line
    expect(g.s.tracked).toBe(a);
    step(g, { ...NO_INPUT, cmd: { c: 'track', quest: side } });
    expect(g.s.tracked).toBe(side);
  });

  it('follows the quest whose person she talks to for its step', () => {
    const g = fresh();
    const [a] = mains(g);
    reopen(g, a!, 0);
    g.s.tracked = a!;
    const [qid, i] = withStep(g, 'talk', ['side', 'friend', 'main'], [a!]);
    reopen(g, qid, i);
    const st = g.c.quests[qid]!.steps[i] as Step & { t: 'talk' };
    expect(talkTo(g, cast(g, st.who))).toBe(true);
    expect(g.s.tracked).toBe(qid);
  });

  it('follows the quest whose X she stands on', () => {
    const g = fresh();
    const [a] = mains(g);
    reopen(g, a!, 0);
    g.s.tracked = a!;
    const id = 'sq_dad_trail';
    reopen(g, id, 0);
    const st = g.c.quests[id]!.steps[0]!;
    const p = place(g, st.mark!)!;
    g.s.area = p.area;
    g.s.x = p.x + 0.5;
    g.s.y = p.y + 0.5;
    for (let k = 0; k < 25; k++) step(g, NO_INPUT);
    expect(g.s.tracked).toBe(id);
  });

  it('shows the den while she fights one', () => {
    const g = fresh();
    const [a] = mains(g);
    reopen(g, a!, 0);
    g.s.tracked = a!;
    g.rt.den = { id: Object.keys(g.c.dens)[0]!, wave: 1, left: 2 };
    const gl = goalLine(g)!;
    expect(gl.den).toBe(true);
    expect(gl.text).toBe(g.c.strings.goal_den!.replace('{w}', '1'));
  });

  // package 57a (D62): a led animal follows with the food anywhere in the bag, so no slot key is named; without the
  // food the line says to get it first
  it('a lead step names no slot key, and asks for the food when she has none', () => {
    const g = fresh();
    const [qid, i] = withStep(g, 'lead', ['main', 'side', 'friend']);
    reopen(g, qid, i);
    g.s.tracked = qid;
    const st = g.c.quests[qid]!.steps[i] as Step & { t: 'lead' };
    const food = g.c.animals[st.animal]!.food!;
    g.s.bag.fill(null);
    g.s.bag[0] = { id: 'stick', n: 1 };
    expect(goalLine(g)!.text).toMatch(/^Get /);
    g.s.bag[5] = { id: food, n: 3 };
    g.s.hot = 0;
    const text = goalLine(g)!.text;
    expect(text).not.toMatch(/press/i);
    expect(text.split(/\s+/).length).toBeLessThanOrEqual(6);
  });

  it('puts the star on the nearest enemy a fight step counts', () => {
    const g = fresh();
    const [qid, i] = withStep(g, 'defeat', ['main']);
    reopen(g, qid, i);
    g.s.tracked = qid;
    const st = g.c.quests[qid]!.steps[i] as Step & { t: 'defeat' };
    const mob = st.mob === 'any' ? 'zombie' : st.mob;
    // out on open ground (package 60: the star sits only on an enemy she can walk to)
    g.s.area = 'island';
    g.s.x = 80.5;
    g.s.y = 64.5;
    rebuildArea(g, 'island');
    g.rt.mobs.length = 0;
    const far = makeMob(g, mob, g.s.x + 8, g.s.y, st.zone ?? '');
    const near = makeMob(g, mob, g.s.x + 3, g.s.y + 1, st.zone ?? '');
    const t = stepTarget(g, qid)!;
    expect(t.x + 0.5).toBeCloseTo(near.x);
    expect(t.y + 0.5).toBeCloseTo(near.y);
    expect(g.rt.targetUp).toBeGreaterThan(0);
    near.gone = true;
    expect(stepTarget(g, qid)!.x + 0.5).toBeCloseTo(far.x);
  });
});
