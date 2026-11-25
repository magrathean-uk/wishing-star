// A hint when she struggles (src/core/hints.ts): every step, mini-game and boss has one that can be derived, and the
// rule waits, shows one thing, goes when she acts and never counts while something else has the screen.
import { describe, expect, it } from 'vitest';
import { askHint, HELP, MINI_KEY, worldHint } from '../src/core/hints.ts';
import { MINIS, startMini } from '../src/core/minigames.ts';
import { place, startQuest } from '../src/core/quests.ts';
import { newGame } from '../src/core/state.ts';
import { NO_INPUT, step } from '../src/core/step.ts';
import type { Game, Input } from '../src/core/types.ts';
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
  return g;
};
const run = (g: Game, secs: number, inp: Partial<Input> = {}): void => {
  for (let i = 0; i < Math.round(secs * 60); i++) {
    step(g, { ...NO_INPUT, ...inp });
    g.ev.length = 0;
  }
};
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

/** A main quest at a step of this type, tracked. */
function atStep(g: Game, t: string): string {
  for (const id of g.c.questOrder) {
    const def = g.c.quests[id]!;
    if (def.kind !== 'main') continue;
    // (a place far from her, so walking is not needed to keep the step from finishing)
    const i = def.steps.findIndex((s) => {
      if (s.t !== t) return false;
      if (s.t !== 'reach') return true;
      const p = place(g, s.place);
      return !!p && (p.area !== g.s.area || Math.hypot(p.x - g.s.x, p.y - g.s.y) > 20);
    });
    if (i < 0) continue;
    g.s.quests[id] = { step: i, n: 0, done: false };
    g.s.tracked = id;
    g.rt.target = null;
    return id;
  }
  throw new Error(`no main step of type ${t}`);
}

describe('every hint can be derived', () => {
  it('gives every step of the main chapters a picture, a key or a few words', () => {
    const g = fresh();
    const texts = new Set<string>();
    let steps = 0;
    for (const id of g.c.questOrder) {
      const def = g.c.quests[id]!;
      if (def.kind !== 'main') continue;
      startQuest(g, id);
      g.s.tracked = id;
      for (let i = 0; i <= def.steps.length; i++) {
        g.s.quests[id]!.step = i;
        g.s.quests[id]!.done = false;
        const h = worldHint(g, id);
        expect(!!(h.at || h.key || h.icon || h.text), `${id} step ${i}`).toBe(true);
        if (h.text) texts.add(h.text);
        steps++;
      }
      g.s.quests[id]!.done = true;
    }
    expect(steps).toBeGreaterThan(40);
    // the few words: only strings that exist, each at most 6 words
    for (const t of texts) {
      const s = g.c.strings[t];
      expect(s, t).toBeTruthy();
      expect(words(s!), t).toBeLessThanOrEqual(t.startsWith('king_') || t.startsWith('jockey_') ? 12 : 6);
    }
  });

  it('gives every mini-game a key', () => {
    for (const game in MINIS) expect(MINI_KEY[game], game).toBeTruthy();
  });

  it('gives a boss step the boss tip for the fight', () => {
    const g = fresh();
    for (const id of g.c.questOrder) {
      const def = g.c.quests[id]!;
      def.steps.forEach((st, i) => {
        if (st.t !== 'defeat' || g.c.mobs[st.mob]?.role !== 'boss') return;
        startQuest(g, id);
        g.s.quests[id]!.step = i;
        g.s.quests[id]!.done = false;
        const h = worldHint(g, id);
        expect(h.icon || h.at, `${id} ${st.mob}`).toBeTruthy();
      });
    }
  });
});

describe('the struggling rule', () => {
  it('waits 45 seconds of no progress, then shows one hint, and 30 s the next time on that step', () => {
    const g = fresh();
    atStep(g, 'reach');
    run(g, HELP.world - 1);
    expect(g.rt.help.show).toBeNull();
    run(g, 1.2);
    const first = g.rt.help.show;
    expect(first).not.toBeNull();
    expect(first!.kind).toBe('go');
    // it goes away on its own after a while, and comes back sooner on the same step
    run(g, HELP.show + 0.2);
    expect(g.rt.help.show).toBeNull();
    run(g, HELP.again - 1);
    expect(g.rt.help.show).toBeNull();
    run(g, 1.2);
    expect(g.rt.help.show).not.toBeNull();
  });

  it('goes as soon as she gets somewhere', () => {
    const g = fresh();
    const id = atStep(g, 'reach');
    run(g, HELP.world + 0.2);
    expect(g.rt.help.show).not.toBeNull();
    g.s.quests[id]!.step++;
    run(g, 0.2);
    expect(g.rt.help.show).toBeNull();
  });

  it('never counts while the game is paused or a talk box is open', () => {
    const g = fresh();
    atStep(g, 'reach');
    g.rt.paused = true;
    run(g, 120);
    expect(g.rt.help.show).toBeNull();
    g.rt.paused = false;
    g.rt.talk = { text: 'x' } as never;
    run(g, 120);
    expect(g.rt.help.show).toBeNull();
    expect(g.rt.help.t).toBe(0);
  });

  it('shows the hint at once on H', () => {
    const g = fresh();
    atStep(g, 'reach');
    run(g, 0.5);
    askHint(g);
    run(g, 0.2);
    expect(g.rt.help.show).not.toBeNull();
    // H again puts it away
    askHint(g);
    expect(g.rt.help.show).toBeNull();
  });

  it('marks the recipe list after 20 seconds open on a step that wants something made', () => {
    const g = fresh();
    const id = atStep(g, 'craft');
    const st = g.c.quests[id]!.steps[g.s.quests[id]!.step]!;
    if (st.t !== 'craft') throw new Error('not a craft step');
    const r = Object.values(g.c.recipes).find((x) => x.out === st.item)!;
    if (!g.s.recipes.includes(r.id)) g.s.recipes.push(r.id);
    g.rt.paused = true;
    g.rt.help.menu = 'craft';
    run(g, HELP.menu - 1);
    expect(g.rt.help.show).toBeNull();
    run(g, 1.2);
    expect(g.rt.help.show?.kind).toBe('menu');
    // a menu the step does not need never counts
    const g2 = fresh();
    atStep(g2, 'reach');
    g2.rt.paused = true;
    g2.rt.help.menu = 'journal';
    run(g2, 60);
    expect(g2.rt.help.show).toBeNull();
  });

  it('shows a mini-game hint after a stretch with no points, and a key press puts it away', () => {
    const g = fresh();
    startMini(g, 'hide');
    const m = g.rt.mini!;
    m.st = 1;
    run(g, HELP.mini + 0.2);
    expect(g.rt.help.show?.kind).toBe('mini');
    expect(g.rt.help.show?.target).toBe('hide');
    run(g, 1);
    run(g, 0.1, { act: true });
    expect(g.rt.help.show).toBeNull();
  });

  it('shows a mini-game hint after two wrong looks', () => {
    const g = fresh();
    startMini(g, 'hide');
    const m = g.rt.mini!;
    m.st = 1;
    run(g, 0.2);
    m.n[3] = 2;
    run(g, 0.2);
    expect(g.rt.help.show?.kind).toBe('mini');
  });
});

describe('hide and seek, played as a person would', () => {
  it('looks in a place when she walks into it, and Space works from a corner too', () => {
    const g = fresh();
    startMini(g, 'hide');
    const m = g.rt.mini!;
    m.st = 1;
    m.n[6] = 1;
    m.objs = [
      { x: 6, y: 3, vx: 1, vy: 0, k: 0, a: 0 },
      { x: 4, y: 2, vx: 0, vy: 0, k: 0, a: 0 },
    ];
    m.n[0] = 5;
    m.n[1] = 3;
    run(g, 0.1, { mx: 1 });
    expect(m.n[6]).toBe(2);
    expect(m.n[8]).toBe(0);
    run(g, 1.6);
    expect(m.objs[0]!.k).toBe(2);
    // the empty place is at a corner of her cell: Space looks in it
    m.n[6] = 1;
    m.n[4] = 0;
    run(g, 0.05, { act: true });
    expect(m.n[6]).toBe(2);
    expect(m.n[8]).toBe(1);
  });
});
