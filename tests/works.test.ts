// Package 69 (D75): what still stopped the blind players on build 12. Plain Node, no browser.
import { describe, expect, it } from 'vitest';
import { give } from '../src/core/bag.ts';
import { wear } from '../src/core/gear.ts';
import { free, rebuildArea } from '../src/core/grid.ts';
import { findTarget, HALF, hurtHero, LOW_HP, REGEN_EVERY } from '../src/core/hero.ts';
import { closeMini, MINIS, startMini, targetAim } from '../src/core/minigames.ts';
import { AIM, bowPick, makeMob, shoot } from '../src/core/mobs.ts';
import { startQuest, stepTarget } from '../src/core/quests.ts';
import { newGame } from '../src/core/state.ts';
import { NO_INPUT, step } from '../src/core/step.ts';
import { say } from '../src/core/talk.ts';
import type { Dir, Game, Input, MapObj } from '../src/core/types.ts';
import { content } from '../src/data/content.ts';

const playing = (): Game => {
  const g = newGame(content, { seed: 3, hero: 'amelia' });
  g.rt.mode = 'play';
  g.rt.talk = null;
  g.rt.cut = null;
  g.rt.card = null;
  g.rt.q = [];
  g.rt.spawnT = 1e9;
  g.rt.mobs.length = 0;
  g.rt.npcs.length = 0;
  for (const id in g.s.quests) g.s.quests[id]!.done = true;
  g.s.tracked = null;
  return g;
};
const run = (g: Game, inp: Partial<Input>, frames: number) => {
  for (let i = 0; i < frames; i++) {
    step(g, { ...NO_INPUT, ...inp });
    g.ev.length = 0;
  }
};
const SIDES: [number, number, Dir][] = [
  [0, 1, 'up'],
  [0, -1, 'down'],
  [-1, 0, 'right'],
  [1, 0, 'left'],
];
const AWAY: Record<Dir, Dir> = { up: 'down', down: 'up', left: 'right', right: 'left' };

/** An oak on the island with an open tile beside it and nothing else usable round that tile. */
function lonelyOak(g: Game): { o: MapObj; x: number; y: number; toward: Dir } {
  const a = g.c.areas.island!;
  for (const o of a.objects) {
    if (o.type !== 'oak') continue;
    for (const [sx, sy, toward] of SIDES) {
      const x = o.x + sx;
      const y = o.y + sy;
      if (!free(g, 'island', x + 0.5, y + 0.5, HALF)) continue;
      g.s.x = x + 0.5;
      g.s.y = y + 0.5;
      g.s.dir = toward;
      if (findTarget(g).obj !== o) continue;
      // facing away: nothing else straight ahead or nearer
      g.s.dir = AWAY[toward];
      const t = findTarget(g);
      if (t.obj === o && t.beside) return { o, x, y, toward };
    }
  }
  throw new Error('no lonely oak');
}

describe('Space beside a thing uses it, whichever way she faces (package 69, item 1)', () => {
  it('chops the tree behind her, turns her to it and says how many hits are left', () => {
    const g = playing();
    g.s.area = 'island';
    rebuildArea(g, 'island');
    give(g, 'wood_axe', 1, true);
    const { o, x, y, toward } = lonelyOak(g);
    g.s.x = x + 0.5;
    g.s.y = y + 0.5;
    g.s.dir = AWAY[toward];
    expect(findTarget(g).hint).toBe('chop');
    step(g, { ...NO_INPUT, act: true });
    expect(g.s.dir).toBe(toward);
    let left = false;
    for (let i = 0; i < 40; i++) {
      step(g, NO_INPUT);
      if (g.ev.some((e) => e.t === 'fx' && e.id === 'hitsleft')) left = true;
      g.ev.length = 0;
    }
    expect(left).toBe(true);
    expect(g.s.flags[`hit:${o.id}`]).toBeGreaterThan(0);
  });
});

describe('a job taken from someone keeps the story line (item 2)', () => {
  it('a side job from its giver goes into the quest book; the line stays on the story', () => {
    const g = playing();
    g.s.quests.ch2 = { step: 1, n: 0, done: false };
    g.s.tracked = 'ch2';
    delete g.s.quests.sq_granny_soup;
    startQuest(g, 'sq_granny_soup', true);
    expect(g.s.quests.sq_granny_soup?.done).toBeFalsy();
    expect(g.s.tracked).toBe('ch2');
    // picking it in the quest book moves the line
    step(g, { ...NO_INPUT, cmd: { c: 'track', quest: 'sq_granny_soup' } });
    expect(g.s.tracked).toBe('sq_granny_soup');
  });
  it('with no story step left, the job she takes is the one she is on', () => {
    const g = playing();
    delete g.s.quests.sq_granny_soup;
    startQuest(g, 'sq_granny_soup', true);
    expect(g.s.tracked).toBe('sq_granny_soup');
  });
});

describe('hearts come back (item 3)', () => {
  it('a heart comes back every 6 s up to 3 hearts when no enemy is near; then food', () => {
    const g = playing();
    g.s.area = 'island';
    rebuildArea(g, 'island');
    g.s.hp = 1;
    run(g, {}, 60 * 5);
    expect(g.s.hp).toBe(1);
    run(g, {}, 60 * (REGEN_EVERY + 0.2));
    expect(g.s.hp).toBe(3);
    run(g, {}, 60 * REGEN_EVERY * 4);
    expect(g.s.hp).toBe(LOW_HP);
  });
  it('an enemy within 6 tiles stops it; a hit restarts the wait', () => {
    const g = playing();
    g.s.area = 'island';
    rebuildArea(g, 'island');
    g.s.hp = 2;
    const m = makeMob(g, 'zombie', g.s.x + 4, g.s.y);
    m.tag = 'story';
    // it cannot hurt her here: only its being near counts
    g.rt.safeT = 1e9;
    run(g, {}, 60 * 15);
    expect(g.s.hp).toBe(2);
    m.gone = true;
    g.rt.safeT = 0;
    hurtHero(g, 0, g.s.x + 1, g.s.y);
    expect(g.ev.some((e) => e.t === 'fx' && e.id === 'warn')).toBe(true);
  });
  it('at 3 hearts or fewer R eats the best food from anywhere in the bag', () => {
    const g = playing();
    g.s.hp = 4;
    give(g, 'apple', 2, true);
    give(g, 'cake', 1, true);
    g.s.hot = 0;
    run(g, {}, 6);
    expect(g.rt.eatHint).toBe(true);
    step(g, { ...NO_INPUT, use: true });
    expect(g.s.hp).toBe(Math.min(12, g.s.maxHp));
  });
});

describe('X aims by itself (item 4)', () => {
  const armed = () => {
    const g = playing();
    g.s.area = 'island';
    rebuildArea(g, 'island');
    give(g, 'bow', 1, true);
    wear(g, 'bow');
    give(g, 'arrow', 10, true);
    return g;
  };
  it('aims at a mob within 60 degrees and turns to one behind her within 4 tiles', () => {
    const g = armed();
    g.s.dir = 'right';
    const m = makeMob(g, 'zombie', g.s.x + 4, g.s.y + 3);
    expect(bowPick(g).aim?.mob).toBe(m);
    expect(bowPick(g).aim?.turn).toBe(false);
    m.x = g.s.x - 3;
    m.y = g.s.y;
    expect(bowPick(g).aim?.turn).toBe(true);
    expect(shoot(g)).toBe(true);
    expect(g.s.dir).toBe('left');
  });
  it('spends no arrow when there is nothing to shoot', () => {
    const g = armed();
    const before = g.s.bag.reduce((n, s) => n + (s?.id === 'arrow' ? s.n : 0), 0);
    expect(shoot(g)).toBe(false);
    const after = g.s.bag.reduce((n, s) => n + (s?.id === 'arrow' ? s.n : 0), 0);
    expect(after).toBe(before);
    expect(AIM.range).toBe(7);
  });
  it("the targets game's arrow flies at the nearest target, leading a slider", () => {
    const g = playing();
    startMini(g, 'targets');
    const m = g.rt.mini!;
    m.objs = [{ x: 10, y: 1.5, vx: 1.2, vy: 0, k: 0, a: 3 }];
    const aim = targetAim(m, 8, 6, 0)!;
    expect(aim).toBeTruthy();
    expect(aim.vx).toBeGreaterThan(0.3);
    closeMini(g);
  });
});

describe('a talk never opens by itself twice (item 5)', () => {
  it('after a talk ends, that person takes no Space for half a second', () => {
    const g = playing();
    g.s.area = 'island';
    rebuildArea(g, 'island');
    g.rt.npcs.push({
      k: 77,
      id: 'mum',
      kind: 'npc',
      area: 'island',
      x: g.s.x + 1,
      y: g.s.y,
      px: g.s.x + 1,
      py: g.s.y,
      dir: 'down',
      clip: 'idle',
      ct: 0,
      hx: 0,
      hy: 0,
      roam: 0,
      path: null,
      pi: 0,
      wait: 99,
      mark: 0,
      talkT: 0,
    } as unknown as Game['rt']['npcs'][number]);
    g.s.dir = 'right';
    expect(findTarget(g).kind).toBe('npc');
    say(g, ['mum: Hello.'], null, 77);
    run(g, { act: true }, 1);
    run(g, {}, 2);
    run(g, { act: true }, 1);
    expect(g.rt.talk).toBeNull();
    expect(findTarget(g).kind).not.toBe('npc');
    run(g, {}, 40);
    expect(findTarget(g).kind).toBe('npc');
  });
});

describe('every card has a way out (item 6)', () => {
  it('X on every mini-game start card is "Not now"; X ends every end card', () => {
    for (const id of Object.keys(MINIS)) {
      const g = playing();
      startMini(g, id);
      expect(g.rt.mode).toBe('mini');
      run(g, {}, 30);
      run(g, { back: true }, 1);
      expect(g.rt.mini, `${id} start`).toBeNull();
      expect(g.rt.mode).toBe('play');
      startMini(g, id);
      g.rt.mini!.st = 2;
      g.rt.mini!.t = 0;
      run(g, {}, 60);
      run(g, { back: true }, 1);
      expect(g.rt.mini, `${id} end`).toBeNull();
    }
  });
  it('Escape (the back command) answers a question with the kind answer', () => {
    const g = playing();
    let yes = false;
    say(g, [
      {
        l: 'mum: Play?',
        choices: [{ text: 'Yes', fx: { flags: ['_yes'] } }, { text: 'No' }],
      },
    ]);
    run(g, { act: true }, 1);
    step(g, { ...NO_INPUT, cmd: { c: 'back' } });
    yes = !!g.s.flags._yes;
    expect(yes).toBe(false);
    expect(g.rt.talk).toBeNull();
  });
  it('a new round waits a second with its name up', () => {
    const g = playing();
    startMini(g, 'targets');
    const m = g.rt.mini!;
    run(g, {}, 30);
    run(g, { act: true }, 1);
    expect(m.st).toBe(1);
    m.n[4] = 1;
    run(g, {}, 1);
    expect(m.roundT).toBeGreaterThan(0.9);
    const t = m.n[7];
    run(g, {}, 30);
    expect(m.n[7]).toBe(t);
  });
});

describe('the fight star keeps to one enemy (item 9)', () => {
  it('the star stays on the enemy it was on and where it was last seen', () => {
    const g = playing();
    g.s.area = 'island';
    rebuildArea(g, 'island');
    g.s.quests.ch6 = { step: 2, n: 0, done: false };
    g.s.tracked = 'ch6';
    const a = makeMob(g, 'skeleton', g.s.x + 6, g.s.y);
    const t1 = stepTarget(g, 'ch6')!;
    expect(Math.round(t1.x + 0.5)).toBe(Math.round(a.x));
    // a second one comes nearer: the star stays on the first
    makeMob(g, 'skeleton', g.s.x - 4, g.s.y);
    const t2 = stepTarget(g, 'ch6')!;
    expect(Math.round(t2.x + 0.5)).toBe(Math.round(a.x));
  });
});
