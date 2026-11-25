// Package 41: the rules of home and island. Places, the cloud over the map, dens (waves, chest once, no respawn),
// the board (3 at most), arrivals (one a morning), visitors (thresholds, one a morning) and old saves. Plain Node.
import { describe, expect, it } from 'vitest';
import { newDay } from '../src/core/clock.ts';
import { objLive } from '../src/core/grid.ts';
import { enterArea } from '../src/core/hero.ts';
import {
  BOARD_MAX,
  boardJobs,
  COMFORT_STEPS,
  comfort,
  denCentre,
  inClearedDen,
  seenAt,
  seenShare,
  waiting,
} from '../src/core/island.ts';
import { damage } from '../src/core/mobs.ts';
import { talkNpc } from '../src/core/npcs.ts';
import { load, migrate, serialize } from '../src/core/save.ts';
import { newGame } from '../src/core/state.ts';
import { NO_INPUT, step } from '../src/core/step.ts';
import type { CharDef, Content, Ev, Game, QuestDef } from '../src/core/types.ts';
import { content } from '../src/data/content.ts';
import { journalStickers } from '../src/data/stickers.ts';

const playing = (g: Game): Game => {
  g.rt.mode = 'play';
  g.rt.talk = null;
  g.rt.cut = null;
  g.rt.q = [];
  g.rt.spawnT = 1e9;
  for (const id in g.s.quests) g.s.quests[id]!.done = true;
  return g;
};
const fresh = (c: Content = content, seed = 7): Game => playing(newGame(c, { seed, hero: 'amelia' }));
const run = (g: Game, n: number): Ev[] => {
  const out: Ev[] = [];
  for (let i = 0; i < n; i++) {
    step(g, NO_INPUT);
    out.push(...g.ev);
    g.ev.length = 0;
    g.rt.mode = g.rt.mode === 'talk' || g.rt.mode === 'card' ? 'play' : g.rt.mode;
    g.rt.talk = null;
  }
  return out;
};
const goTo = (g: Game, x: number, y: number) => enterArea(g, 'island', x + 0.5, y + 0.5, 'down');
const morning = (g: Game): Ev[] => {
  newDay(g, true);
  const ev = [...g.ev];
  g.ev.length = 0;
  return ev;
};
/** A copy of the content with some extra characters and quests. */
const withExtra = (chars: Record<string, CharDef>, quests: QuestDef[] = []): Content => {
  const qs = { ...content.quests };
  for (const q of quests) qs[q.id] = q;
  return {
    ...content,
    chars: { ...content.chars, ...chars },
    quests: qs,
    questOrder: [...content.questOrder, ...quests.map((q) => q.id)],
  };
};
const guest = (id: string, spots: CharDef['spots'], more: Partial<CharDef> = {}): CharDef => ({
  id,
  name: id,
  role: 'walker',
  group: 'test',
  body: 'biped',
  spots,
  chat: [{ lines: [`${id}: Hello.`] }],
  ...more,
});

describe('places', () => {
  it('finds a region by walking in and a landmark within 3 tiles, quietly, by the rules', () => {
    const g = fresh();
    const lh = content.areas.island!.places.lighthouse!;
    goTo(g, lh.x + 2, lh.y + 1);
    const ev = run(g, 30);
    expect(g.s.places.bay).toBe(1);
    expect(g.s.places.lighthouse).toBe(1);
    expect(g.s.stickers.place_lighthouse).toBeTruthy();
    expect(ev.filter((e) => e.t === 'place').map((e) => (e as { id: string }).id)).toContain('lighthouse');
    // no banner: a found place is never a 'toast'
    expect(ev.some((e) => e.t === 'toast' && e.kind === 'sticker')).toBe(false);
  });
  it('does not find a landmark from further away', () => {
    const g = fresh();
    const lh = content.areas.island!.places.lighthouse!;
    goTo(g, lh.x - 6, lh.y);
    run(g, 30);
    expect(g.s.places.lighthouse).toBeUndefined();
  });
  it('has 15 regions, about 20 landmarks and keeps the journal at 60 stickers or fewer', () => {
    expect(Object.keys(content.regions).length).toBe(15);
    const n = Object.keys(content.landmarks).length;
    expect(n).toBeGreaterThanOrEqual(15);
    expect(n).toBeLessThanOrEqual(22);
    expect(journalStickers().length).toBeLessThanOrEqual(60);
    for (const id in content.landmarks) expect(content.stickers['place_' + id]).toBeTruthy();
  });
});

describe('the cloud over the map', () => {
  it('starts cloudy and clears about a screen round her as she walks', () => {
    const g = fresh();
    goTo(g, 40, 60);
    expect(seenAt(g, 150, 10)).toBe(false);
    run(g, 20);
    expect(seenAt(g, 40, 60)).toBe(true);
    expect(seenAt(g, 50, 60)).toBe(true);
    expect(seenAt(g, 150, 10)).toBe(false);
    expect(seenShare(g)).toBeGreaterThan(0);
    expect(seenShare(g)).toBeLessThan(0.2);
    // small in the save: a few characters a row of cells
    expect(g.s.seen.length).toBeLessThanOrEqual(100);
  });
  it('an old save keeps clear every region it had found', () => {
    const g = fresh();
    const raw = JSON.parse(serialize(g));
    delete raw.places;
    delete raw.seen;
    raw.stickers = { place_plains: 1, place_lighthouse: 1 };
    const g2 = load(content, JSON.stringify(raw));
    expect(g2.s.places.plains).toBe(1);
    expect(g2.s.places.lighthouse).toBe(1);
    // the plains (104 to 159, 47 to 88) are clear, the forest is not
    expect(seenAt(g2, 130, 70)).toBe(true);
    expect(seenAt(g2, 130, 20)).toBe(false);
  });
});

describe('dens', () => {
  const den = content.dens.plains!;
  const kill = (g: Game) => {
    for (const m of g.rt.mobs) if (m.tag === 'den:' + den.id && !m.gone) damage(g, m, 999, 0, 0);
  };
  it('two waves, then the chest opens once, and nothing comes back', () => {
    const g = fresh();
    g.s.flags['lit:plains'] = 1;
    const c = denCentre(g, den)!;
    goTo(g, Math.floor(c.x) - 11, Math.floor(c.y));
    let ev = run(g, 5);
    expect(g.s.dens.plains).toBe(1);
    expect(ev.some((e) => e.t === 'den' && e.kind === 'seen')).toBe(true);
    goTo(g, Math.floor(c.x), Math.floor(c.y) + 1);
    ev = run(g, 2);
    expect(g.rt.den?.wave).toBe(1);
    const w1 = g.rt.mobs.filter((m) => m.tag === 'den:plains');
    expect(w1.length).toBe(den.waves[0].length);
    // health follows the region: a plains zombie has 6
    expect(w1.find((m) => m.id === 'zombie')!.hp).toBe(6);
    kill(g);
    ev = run(g, 3);
    expect(g.rt.den?.wave).toBe(2);
    kill(g);
    ev = run(g, 3);
    expect(g.s.dens.plains).toBe(2);
    expect(g.s.flags.den_plains).toBe(1);
    expect(ev.some((e) => e.t === 'den' && e.kind === 'clear')).toBe(true);
    // the chest is there now
    const a = content.areas.island!;
    const i = a.objects.findIndex((o) => o.id === 'chest_den_plains');
    expect(objLive(g, a.objects[i]!)).toBe(true);
    // walking in again starts nothing, and no mob is ever made inside the ring
    goTo(g, Math.floor(c.x) + 1, Math.floor(c.y) + 1);
    run(g, 10);
    expect(g.rt.den).toBe(null);
    expect(g.rt.mobs.filter((m) => m.tag?.startsWith('den:')).length).toBe(0);
    expect(inClearedDen(g, c.x + 2, c.y)).toBe(true);
  });
  it('walking away ends the fight and the den waits for her', () => {
    const g = fresh();
    const c = denCentre(g, den)!;
    goTo(g, Math.floor(c.x), Math.floor(c.y) + 1);
    run(g, 2);
    expect(g.rt.den).not.toBe(null);
    goTo(g, Math.floor(c.x) - 30, Math.floor(c.y));
    run(g, 3);
    expect(g.rt.den).toBe(null);
    expect(g.s.dens.plains).toBe(1);
  });
});

describe('the board', () => {
  it('lists at most 3 jobs that are open now', () => {
    const jobs: QuestDef[] = [1, 2, 3, 4, 5].map((n) => ({
      id: 'job_' + n,
      name: 'Job ' + n,
      kind: 'side',
      region: 'square',
      giver: 'mum',
      board: true,
      steps: [{ t: 'fetch', item: 'stick', n: 1 }],
      visible: '',
    }));
    const c = withExtra({}, jobs);
    const g = fresh(c);
    for (const id in g.s.quests) if (id.startsWith('job_')) delete g.s.quests[id];
    const list = boardJobs(g);
    expect(list.length).toBeLessThanOrEqual(BOARD_MAX);
    expect(list.length).toBe(3);
    step(g, { ...NO_INPUT, cmd: { c: 'accept', quest: list[0]! } });
    expect(g.s.quests[list[0]!]).toBeTruthy();
    expect(boardJobs(g)).not.toContain(list[0]);
    expect(boardJobs(g).length).toBe(3);
  });
});

describe('arrivals', () => {
  const home = (flag: string) => [{ at: 'mum_garden', if: { flag } }];
  it('one arrival a morning, a second waits a day, each with its card', () => {
    const c = withExtra({ g1: guest('g1', home('t_in')), g2: guest('g2', home('t_in')) });
    const g = fresh(c);
    g.s.flags.t_in = 1;
    expect(waiting(g, 'g1')).toBe(true);
    expect(waiting(g, 'g2')).toBe(true);
    let ev = morning(g);
    expect(ev.filter((e) => e.t === 'arrive').length).toBe(1);
    expect(g.s.arrive).toBe('g1');
    expect(waiting(g, 'g1')).toBe(false);
    expect(waiting(g, 'g2')).toBe(true);
    ev = morning(g);
    expect(ev.filter((e) => e.t === 'arrive').length).toBe(1);
    expect(g.s.arrive).toBe('g2');
    ev = morning(g);
    expect(ev.filter((e) => e.t === 'arrive').length).toBe(0);
    expect(g.s.arrive).toBe('');
  });
  it('a guest found out in the world comes home after a night, with a card', () => {
    const lh = 'lighthouse';
    const c = withExtra({
      f1: guest('f1', [
        { at: lh, found: 'found_f1' },
        { at: 'mum_garden', if: { flag: 'found_f1' } },
      ]),
    });
    const g = fresh(c);
    const p = c.areas.island!.places[lh]!;
    goTo(g, p.x, p.y + 1);
    run(g, 2);
    const n = g.rt.npcs.find((x) => x.id === 'f1');
    expect(n).toBeTruthy();
    talkNpc(g, n!.k);
    expect(g.s.flags.found_f1).toBe(2);
    // still standing there today
    g.rt.mode = 'play';
    g.rt.talk = null;
    run(g, 2);
    expect(g.rt.npcs.some((x) => x.id === 'f1')).toBe(true);
    const ev = morning(g);
    expect(g.s.flags.found_f1).toBe(1);
    expect(ev.some((e) => e.t === 'arrive' && e.who === 'f1')).toBe(true);
    expect(waiting(g, 'f1')).toBe(false);
  });
  it('the people already at home in a new game never wait for a card', () => {
    const g = fresh();
    for (const id of ['mum', 'dad', 'grandad', 'granny']) expect(waiting(g, id)).toBe(false);
  });
});

describe('visitors', () => {
  const furnish = (g: Game, kinds: string[]) => {
    g.s.placed = g.s.placed.filter((p) => p.area !== 'cottage');
    kinds.forEach((item, i) => {
      g.s.placed.push({ k: 900 + i, item, area: 'cottage', x: 1 + (i % 12), y: 1 + Math.floor(i / 12) });
    });
  };
  const KINDS = [
    'bed',
    'crafting_table',
    'chest',
    'table',
    'chair',
    'lamp',
    'bookshelf',
    'flower_pot',
    'rug',
    'jukebox',
  ];
  it('nobody drops in below 5 kinds of furniture', () => {
    const g = fresh();
    g.s.met = { hello_kitty: 1, bluey: 1, peppa: 1 };
    furnish(g, KINDS.slice(0, 4));
    expect(comfort(g)).toBe(4);
    for (let d = 0; d < 20; d++) expect(morning(g).some((e) => e.t === 'visit')).toBe(false);
  });
  it('at 5 or more a met friend drops in some mornings with a present, one at most, never with an arrival', () => {
    const c = withExtra({ g9: guest('g9', [{ at: 'mum_garden', if: { flag: 't_g9' } }]) });
    const g = fresh(c);
    g.s.met = { hello_kitty: 1, bluey: 1, peppa: 1, kevin: 1 };
    furnish(g, KINDS.slice(0, COMFORT_STEPS[0]));
    let visits = 0;
    for (let d = 0; d < 30; d++) {
      if (d === 10) g.s.flags.t_g9 = 1;
      const ev = morning(g);
      const v = ev.filter((e) => e.t === 'visit');
      const a = ev.filter((e) => e.t === 'arrive');
      expect(v.length).toBeLessThanOrEqual(1);
      if (a.length) expect(v.length).toBe(0);
      if (v.length) {
        visits++;
        const who = (v[0] as { who: string }).who;
        expect(g.s.met[who]).toBeTruthy();
        expect(content.chars[who]!.group).not.toBe('family');
      }
    }
    expect(visits).toBeGreaterThan(2);
    expect(visits).toBeLessThan(25);
  });
});

describe('save migration', () => {
  it('an old save gains places, the cloud, dens, the home record and no visitor', () => {
    const g = fresh();
    const raw = JSON.parse(serialize(g));
    for (const k of ['places', 'seen', 'dens', 'arrive', 'home', 'visit']) delete raw[k];
    const s = migrate(content, raw);
    expect(s.places).toEqual({});
    expect(s.dens).toEqual({});
    expect(s.arrive).toBe('');
    expect(s.visit).toBe(null);
    expect(typeof s.seen).toBe('string');
  });
});
