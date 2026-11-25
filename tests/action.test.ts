// Phase 2, step 1 (package 27): the bow, the creeper and the caps, the held X that skips a scene, the met record,
// the calm start, and the review 22 fixes (points 5 to 9). Plain Node, no browser.
import { describe, expect, it } from 'vitest';
import { BAG_SLOTS, CHEST_SLOTS, give } from '../src/core/bag.ts';
import { count, DUSK_AT, NIGHT_AT } from '../src/core/cond.ts';
import { tomorrow } from '../src/core/clock.ts';
import { startCut } from '../src/core/cutscene.ts';
import { wear } from '../src/core/gear.ts';
import { enterArea } from '../src/core/hero.ts';
import {
  BOW,
  CREEPER_BLAST,
  CREEPER_FUSE,
  CREEPER_FUSE_FIRST,
  FUSE,
  makeMob,
  mobCaps,
  mobHp,
  offView,
  VIEW_H,
  VIEW_W,
  viewCentre,
} from '../src/core/mobs.ts';
import { finishQuest, startQuest } from '../src/core/quests.ts';
import { load, serialize } from '../src/core/save.ts';
import { newGame } from '../src/core/state.ts';
import { NO_INPUT, step } from '../src/core/step.ts';
import { fill, say } from '../src/core/talk.ts';
import type { Content, Game, Input, Mob } from '../src/core/types.ts';
import { content } from '../src/data/content.ts';

const playing = (g: Game): Game => {
  g.rt.mode = 'play';
  g.rt.talk = null;
  g.rt.cut = null;
  g.rt.q = [];
  for (const id in g.s.quests) g.s.quests[id]!.done = true;
  return g;
};
const fresh = (seed = 3, c: Content = content): Game => playing(newGame(c, { seed, hero: 'amelia' }));
/** Out on the plains at night, with no zone spawns unless a test wants them. */
const field = (gentle = true): Game => {
  const g = fresh();
  g.s.opts.gentle = gentle;
  // an open stretch of the plains night zone: nothing solid for 10 tiles to her right
  enterArea(g, 'island', 115.5, 50.5, 'right');
  g.s.time = NIGHT_AT + 20;
  g.rt.spawnT = 1e9;
  g.rt.mobs.length = 0;
  return g;
};
const run = (g: Game, n: number, inp: Input = NO_INPUT) => {
  for (let i = 0; i < n; i++) {
    g.s.time = Math.max(g.s.time, NIGHT_AT + 20);
    step(g, inp);
  }
};
const story = (g: Game, id: string, dx: number, dy: number): Mob => {
  const m = makeMob(g, id, g.s.x + dx, g.s.y + dy);
  m.tag = 'story';
  return m;
};
const FIRE: Input = { ...NO_INPUT, fire: true };

describe('the bow', () => {
  const armed = (arrows = 10) => {
    const g = field();
    give(g, 'bow', 1, true);
    wear(g, 'bow');
    give(g, 'arrow', arrows, true);
    g.ev.length = 0;
    return g;
  };

  it('aims a shot at a mob within 60 degrees and 7 tiles, and not at one outside (package 69)', () => {
    const g = armed();
    const near = story(g, 'zombie', 6, Math.tan((15 * Math.PI) / 180) * 6);
    step(g, FIRE);
    const sh = g.rt.shots.find((s) => !s.hostile)!;
    expect(sh.tgt).toBe(near.k);
    expect(Math.abs(sh.vy)).toBeGreaterThan(0.5);
    // 73 degrees off and over 4 tiles away, or 10 tiles away: the arrow flies straight the way she faces
    const g2 = armed();
    story(g2, 'zombie', 1.5, 5);
    story(g2, 'zombie', 10, 0);
    step(g2, FIRE);
    const sh2 = g2.rt.shots.find((s) => !s.hostile)!;
    expect(sh2.tgt).toBe(0);
    expect(sh2.vy).toBe(0);
    expect(sh2.vx).toBe(BOW.speed);
  });

  it('shoots once every 0.6 seconds, uses one arrow a shot and does 2 damage', () => {
    const g = armed(5);
    const m = story(g, 'zombie', 4, 0);
    m.hp = 9;
    let shots = 0;
    for (let i = 0; i < 60; i++) {
      step(g, FIRE);
      if (g.ev.some((e) => e.t === 'sfx' && e.id === 'bow')) shots++;
      g.ev.length = 0;
    }
    // held for a second: one shot at once and one 0.6 s later
    expect(shots).toBe(2);
    expect(count(g, 'arrow')).toBe(3);
    run(g, 30);
    expect(m.hp).toBe(9 - 2 * BOW.dmg);
  });

  it('needs a bow and an arrow, and X is the only key that shoots', () => {
    const g = field();
    story(g, 'zombie', 4, 0);
    step(g, FIRE);
    expect(g.rt.shots.length).toBe(0);
    give(g, 'bow', 1, true);
    wear(g, 'bow');
    step(g, { ...NO_INPUT, act: true, back: true });
    expect(g.rt.shots.length).toBe(0);
    g.rt.bowT = 0;
    step(g, FIRE);
    expect(g.rt.shots.length).toBe(0);
    expect(g.rt.nudge).toBe(content.strings.no_arrows);
  });

  it('hurts mobs only: it passes friends and calm mobs, and a closed boss takes nothing', () => {
    const g = armed();
    g.s.time = 100;
    // a spider by day is calm; an animal and a friend stand in the way too
    const calm = story(g, 'spider', 2, 0);
    g.rt.npcs.push({
      ...(g.rt.npcs[0] ?? { kind: 'npc', id: 'mum' }),
      k: 99,
      area: 'island',
      x: g.s.x + 3,
      y: g.s.y,
    } as any);
    const far = story(g, 'zombie', 6, 0);
    const before = calm.hp;
    for (let i = 0; i < 90; i++) {
      g.s.time = 100;
      step(g, i === 0 ? FIRE : NO_INPUT);
    }
    expect(calm.hp).toBe(before);
    expect(far.hp).toBeLessThan(mobHp(g, 'zombie', g.s.area, far.x, far.y));
    // a boss that is closed up takes no arrow
    const b = field();
    give(b, 'bow', 1, true);
    wear(b, 'bow');
    give(b, 'arrow', 5, true);
    const boss = makeMob(b, 'creeper_king', b.s.x + 4, b.s.y);
    boss.phase = 100;
    boss.hp = 9;
    b.rt.shots.push({
      k: 1,
      area: 'island',
      x: b.s.x + 3,
      y: boss.y - 0.5,
      vx: 13,
      vy: 0,
      life: 1,
      kind: 'arrow',
      r: 0.3,
      hostile: false,
      dmg: 2,
    });
    step(b, NO_INPUT);
    step(b, NO_INPUT);
    expect(boss.hp).toBe(9);
  });

  it('is made from 3 sticks and 3 string; a stick and a feather make 4 arrows; skeletons drop arrows', () => {
    expect(content.recipes.bow!.in).toEqual({ stick: 3, string: 3 });
    expect(content.recipes.arrow).toMatchObject({ out: 'arrow', n: 4, in: { stick: 1, feather: 1 } });
    expect(content.mobs.skeleton!.drops.some((d) => d.item === 'arrow' && d.p === undefined && d.min > 0)).toBe(true);
    // new items go last: the item pictures are cut from this order
    // (the gear of step 3 follows it: tests/gear.test.ts)
    const ids = Object.keys(content.items);
    expect(ids.indexOf('bow')).toBe(ids.indexOf('photo_frame') + 1);
  });
});

describe('the creeper', () => {
  it('comes at her at 2.3 tiles a second', () => {
    expect(content.mobs.creeper!.speed).toBe(2.3);
  });

  it('only 1 creeper is after her at a time in Gentle and 2 otherwise; the rest doze, story ones too', () => {
    for (const gentle of [true, false]) {
      const g = field(gentle);
      story(g, 'creeper', 5, 0);
      story(g, 'creeper', -5, 0);
      story(g, 'creeper', 0, 5);
      run(g, 12);
      const awake = g.rt.mobs.filter((m) => !m.gone && !m.doze);
      expect(awake.length).toBe(gentle ? 1 : 2);
      // beat the awake ones: the next wakes
      for (const m of awake) m.gone = true;
      run(g, 12);
      expect(g.rt.mobs.filter((m) => !m.gone && !m.doze).length).toBe(gentle ? 1 : 1);
    }
  });

  it('never more than 2 hostile mobs after her in Gentle and 3 otherwise, zone and story spawns together', () => {
    for (const gentle of [true, false]) {
      const g = field(gentle);
      g.rt.spawnT = 0;
      for (let i = 0; i < 4; i++) story(g, 'zombie', 6 + i, 3);
      let most = 0;
      for (let i = 0; i < 60 * 60; i++) {
        g.s.hp = g.s.maxHp;
        run(g, 1);
        const n = g.rt.mobs.filter(
          (m) => !m.gone && !m.doze && !m.calm && content.mobs[m.id]!.role === 'hostile',
        ).length;
        most = Math.max(most, n);
      }
      expect(most).toBeLessThanOrEqual(mobCaps(g).all);
      expect(most).toBeGreaterThan(0);
    }
  });

  it('a zone spawn never pops in on screen: it lands 1.5 tiles beyond the edge of the view', () => {
    const g = field();
    g.rt.spawnT = 0;
    let seen = 0;
    for (let i = 0; i < 60 * 300; i++) {
      g.s.hp = g.s.maxHp;
      const before = new Set(g.rt.mobs.map((m) => m.k));
      run(g, 1);
      for (const m of g.rt.mobs)
        if (!before.has(m.k) && m.tag !== 'story') {
          seen++;
          expect(offView(g, m.x, m.y), `${m.id} at ${m.x.toFixed(1)},${m.y.toFixed(1)}`).toBe(true);
        }
      // beat whatever comes so more can come
      for (const m of g.rt.mobs) if (Math.hypot(m.x - g.s.x, m.y - g.s.y) < 6) m.gone = true;
    }
    expect(seen).toBeGreaterThan(3);
    const c = viewCentre(g);
    expect(offView(g, c.x + VIEW_W / 2 + 1, c.y)).toBe(false);
    expect(offView(g, c.x, c.y + VIEW_H / 2 + 1.6)).toBe(true);
  });

  it('shows its fuse, and she is safe outside the 2.3 tile ring', () => {
    // she stands just outside the ring: it pops, she keeps her hearts
    const g = field();
    const m = story(g, 'creeper', 2, 0);
    run(g, 20);
    expect(m.st).toBe(FUSE);
    g.s.x = m.x - (CREEPER_BLAST + 0.2);
    g.s.y = m.y;
    const hp = g.s.hp;
    run(g, Math.ceil(CREEPER_FUSE_FIRST * 60) + 10);
    expect(m.gone).toBe(true);
    expect(g.s.hp).toBe(hp);
    expect(count(g, 'gunpowder')).toBe(0);
  });

  it('the first creeper she meets burns 3 s, every later one 1.5 s (package 53a)', () => {
    const g = field();
    const m = story(g, 'creeper', 2, 0);
    run(g, 20);
    expect(m.st).toBe(FUSE);
    expect(m.fuseLen).toBe(CREEPER_FUSE_FIRST);
    const h = field();
    h.s.counts['mob:creeper'] = 1;
    const n = story(h, 'creeper', 2, 0);
    run(h, 20);
    expect(n.fuseLen).toBe(CREEPER_FUSE);
    expect(CREEPER_FUSE).toBeGreaterThanOrEqual(1.5);
  });

  it('once lit it goes off where it stands however far she runs (package 51)', () => {
    // she runs far away: the fuse does not stop, it pops where it stood
    const h = field();
    const c = story(h, 'creeper', 2, 0);
    run(h, 20);
    expect(c.st).toBe(FUSE);
    const at = c.x;
    h.s.x = c.x - 8;
    run(h, Math.ceil(CREEPER_FUSE_FIRST * 60));
    expect(c.gone).toBe(true);
    expect(c.x).toBeCloseTo(at, 5);
    expect(count(h, 'gunpowder')).toBe(0);
    // from right beside it, walking straight away the moment it hisses gets her out of the ring unhurt
    const g = field();
    const m = story(g, 'creeper', -1, 0);
    for (let i = 0; i < 10 && m.st !== FUSE; i++) run(g, 1);
    expect(m.st).toBe(FUSE);
    const hp = g.s.hp;
    for (let i = 0; i < 200 && !m.gone; i++) run(g, 1, { ...NO_INPUT, mx: 1 });
    expect(m.gone).toBe(true);
    expect(g.s.hp).toBe(hp);
  });

  it('drops gunpowder when beaten before it explodes', () => {
    const g = field();
    give(g, 'diamond_sword', 1, true);
    wear(g, 'diamond_sword');
    const m = story(g, 'creeper', 1.2, 0);
    // a home-ground creeper: one diamond swing (out on the plains it takes two, tests/gear.test.ts)
    m.hp = 3;
    g.s.dir = 'right';
    run(g, 2, { ...NO_INPUT, act: true });
    run(g, 30);
    expect(m.gone).toBe(true);
    expect(count(g, 'gunpowder')).toBeGreaterThan(0);
  });
});

describe('a held X skips a scene', () => {
  const scene: Content = {
    ...content,
    cutscenes: {
      ...content.cutscenes,
      t_skip: {
        id: 't_skip',
        acts: [
          { a: 'say', l: 'mum: One.' },
          { a: 'move', who: 'you', x: 10.5, y: 12.5 },
          { a: 'say', l: 'mum: Two.' },
          { a: 'do', fx: { flags: ['t_skip_done'], give: { apple: 2 } } },
          { a: 'wait', s: 3 },
        ],
      },
    },
  };

  it('keeps every effect, leaves her where the scene would, and saves after', () => {
    const g = fresh(3, scene);
    enterArea(g, 'island', 20.5, 20.5, 'down');
    startCut(g, 't_skip');
    run(g, 2);
    expect(g.rt.cut?.id).toBe('t_skip');
    // X pressed and let go: one line on, no skip
    step(g, { ...NO_INPUT, back: true, holdX: true });
    step(g, NO_INPUT);
    expect(g.rt.cut).not.toBeNull();
    g.ev.length = 0;
    for (let i = 0; i < 59; i++) step(g, { ...NO_INPUT, holdX: true });
    expect(g.rt.cut).not.toBeNull();
    expect(g.rt.skip).toBeGreaterThan(0.9);
    step(g, { ...NO_INPUT, holdX: true });
    expect(g.rt.cut).toBeNull();
    expect(g.s.flags.t_skip_done).toBe(1);
    expect(count(g, 'apple')).toBe(2);
    expect([g.s.x, g.s.y]).toEqual([10.5, 12.5]);
    step(g, NO_INPUT);
    expect(g.ev.some((e) => e.t === 'save')).toBe(true);
  });

  it('the finale plays in full the first time through', () => {
    const g = fresh();
    g.s.area = 'island';
    startCut(g, 'finale');
    for (let i = 0; i < 120; i++) step(g, { ...NO_INPUT, holdX: true });
    expect(g.rt.cut?.id).toBe('finale');
    expect(g.rt.skip).toBe(0);
  });
});

describe('a calm start', () => {
  it('a new game has a bed, a crafting table and a chest in the cottage; Koala is always Koala', () => {
    const g = newGame(content, { seed: 1, koala: 'Gumnut' });
    const inside = g.s.placed.filter((p) => p.area === 'cottage').map((p) => p.item);
    expect(inside).toEqual(expect.arrayContaining(['bed', 'crafting_table', 'chest']));
    const chest = g.s.placed.find((p) => p.item === 'chest')!;
    expect(g.s.chests[String(chest.k)]?.length).toBe(CHEST_SLOTS);
    expect(fill(g, '{koala}')).toBe('Koala');
    step(g, { ...NO_INPUT, cmd: { c: 'koala', name: 'Gumnut' } });
    expect(fill(g, 'Hello {koala}!')).toBe('Hello Koala!');
  });

  it('met is its own record: set on the first talk, filled from friend stickers in an old save', () => {
    const g = fresh();
    const npc = g.rt.npcs.find((n) => !content.chars[n.id]!.noSticker)!;
    expect(npc).toBeTruthy();
    g.s.x = npc.x;
    g.s.y = npc.y + 0.9;
    g.s.dir = 'up';
    step(g, { ...NO_INPUT, act: true });
    expect(g.s.met[npc.id]).toBe(g.s.day);
    expect(g.s.stickers['friend_' + npc.id]).toBeUndefined();
    const raw = JSON.parse(serialize(g));
    delete raw.met;
    raw.stickers = { friend_bluey: 2, mob_zombie: 1 };
    expect(load(content, JSON.stringify(raw)).s.met).toEqual({ bluey: 2 });
  });
});

describe('review 22, points 5 to 9', () => {
  it('5: a save is asked for when a talk or a scene ends', () => {
    const g = fresh();
    say(g, ['mum: Hello.']);
    g.ev.length = 0;
    let saved = false;
    for (let i = 0; i < 120 && !saved; i++) {
      step(g, { ...NO_INPUT, act: i % 10 === 0 });
      saved = g.ev.some((e) => e.t === 'save');
      g.ev.length = 0;
    }
    expect(g.rt.talk).toBeNull();
    expect(saved).toBe(true);
  });

  it('6: every Wanted poster pays a prize ticket, so the prize counter never runs short', () => {
    const g = fresh();
    const poster = Object.values(content.quests).find((q) => q.kind === 'bounty')!;
    startQuest(g, poster.id);
    finishQuest(g, poster.id);
    expect(count(g, 'ticket')).toBe(1);
  });

  it('7: fill leaves {n}, {item} and {x} for the caller', () => {
    const g = fresh();
    expect(fill(g, 'You need {n} more {item}.')).toBe('You need {n} more {item}.');
    const q = Object.values(content.quests).find((d) => d.kind === 'main' && d.steps.length > 1)!;
    g.s.quests[q.id] = { step: 0, n: 0 };
    g.s.tracked = q.id;
    for (const line of tomorrow(g)) expect(line).not.toMatch(/Next: x\.|\{x\}/);
  });

  it('8: with the bag and the chests full, a thing at her feet stays there', () => {
    const g = fresh();
    const mats = Object.values(content.items).filter((d) => d.kind === 'material' && !d.pouch && (d.stack ?? 99) > 1);
    const a = mats[0]!;
    const b = mats[1]!;
    give(g, a.id, (a.stack ?? 99) * BAG_SLOTS, true);
    for (const k in g.s.chests) g.s.chests[k] = g.s.chests[k]!.map(() => ({ id: a.id, n: a.stack ?? 99 }));
    g.s.drops.push({ area: g.s.area, x: g.s.x, y: g.s.y, id: b.id, n: 1 });
    g.ev.length = 0;
    run(g, 60);
    expect(g.s.drops.filter((d) => d.id === b.id).length).toBe(1);
    expect(g.ev.filter((e) => e.t === 'sfx' && e.id === 'pickup').length).toBe(0);
  });

  it('9: on a night step the bed waits for night at a key press, never sleeping the night away', () => {
    const g = fresh();
    const q = Object.values(content.quests).find((d) => d.steps.some((st) => st.t === 'night'))!;
    g.s.quests[q.id] = { step: q.steps.findIndex((st) => st.t === 'night'), n: 0 };
    g.s.time = DUSK_AT + 10;
    const bed = g.s.placed.find((p) => p.item === 'bed')!;
    enterArea(g, 'cottage', bed.x + 1.5, bed.y + 1.5, 'left');
    const day = g.s.day;
    step(g, { ...NO_INPUT, act: true });
    expect(g.rt.talk?.choices?.length).toBe(2);
    for (let i = 0; i < 200 && g.rt.talk; i++) step(g, { ...NO_INPUT, act: i % 5 === 0 });
    expect(g.s.day).toBe(day);
    expect(g.s.time).toBeGreaterThanOrEqual(NIGHT_AT);
    expect(g.rt.mode).toBe('play');
  });
});
