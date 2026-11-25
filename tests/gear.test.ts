// Phase 2, step 3 (package 31): the gear rules. Slots and the "Put it on?" ask, blue shield hearts, upgrades,
// what mobs drop, mob health by region, and old saves. Plain Node, no browser.
import { describe, expect, it } from 'vitest';
import { give } from '../src/core/bag.ts';
import { newDay } from '../src/core/clock.ts';
import { NIGHT_AT } from '../src/core/cond.ts';
import {
  ASK_SECS,
  bowDmg,
  fixGear,
  SHIELD_CAP,
  shieldMax,
  swordDmg,
  UPGRADE_COST,
  upgrade,
  upgradeHere,
  upgradeWhy,
  wear,
} from '../src/core/gear.ts';
import { enterArea, hurtHero } from '../src/core/hero.ts';
import { damage, makeMob, mobHp } from '../src/core/mobs.ts';
import { hug } from '../src/core/npcs.ts';
import { load, migrate, serialize } from '../src/core/save.ts';
import { newGame } from '../src/core/state.ts';
import { NO_INPUT, step } from '../src/core/step.ts';
import type { Content, Game, GameState } from '../src/core/types.ts';
import { content } from '../src/data/content.ts';

const playing = (g: Game): Game => {
  g.rt.mode = 'play';
  g.rt.talk = null;
  g.rt.cut = null;
  g.rt.q = [];
  g.rt.spawnT = 1e9;
  for (const id in g.s.quests) g.s.quests[id]!.done = true;
  return g;
};
const fresh = (seed = 5, c: Content = content): Game => playing(newGame(c, { seed, hero: 'amelia' }));
const run = (g: Game, n: number, cmd: (typeof NO_INPUT)['cmd'] = null, act = false) => {
  for (let i = 0; i < n; i++) step(g, { ...NO_INPUT, cmd: i === 0 ? cmd : null, act: i === 0 && act });
};
const gearEvents = (g: Game) => g.ev.filter((e) => e.t === 'gear').map((e) => (e as { kind: string }).kind);
/** A tile of a region code on the island (the first one, scanning rows). */
const tileOf = (code: string): [number, number] => {
  const a = content.areas.island!;
  for (let y = 0; y < a.h; y++)
    for (let x = 0; x < a.w; x++) if (a.region[y]!.charAt(x) === code) return [x + 0.5, y + 0.5];
  throw new Error(`no ${code}`);
};

describe('gear: four slots and the ask', () => {
  it('appends the new items after the bow, in the order their icons were packed', () => {
    const ids = Object.keys(content.items);
    const at = ids.indexOf('bow');
    expect(ids.slice(at, at + 15)).toEqual([
      'bow',
      'leather_scrap',
      'leather',
      'leather_helmet',
      'leather_armour',
      'iron_helmet',
      'iron_armour',
      'diamond_helmet',
      'diamond_armour',
      'anvil',
      'armour_stand',
      'cooking_pot',
      'key_piece',
      // package 70: the secret show's two things
      'mic',
      'light_stick',
    ]);
    expect(ids.length).toBe(at + 15);
  });

  it('a new game wears nothing; her first sword asks and fills the empty slot if she does not answer', () => {
    const g = fresh();
    expect(g.s.gear).toEqual({ sword: '', bow: '', helmet: '', armour: '' });
    g.ev.length = 0;
    give(g, 'wood_sword');
    expect(g.rt.ask).toBe('wood_sword');
    expect(gearEvents(g)).toEqual(['ask']);
    expect(swordDmg(g)).toBe(0);
    run(g, Math.ceil(ASK_SECS * 60) + 2);
    expect(g.s.gear.sword).toBe('wood_sword');
    expect(g.rt.ask).toBe('');
    expect(swordDmg(g)).toBe(1);
  });

  it('a better sword asks again; Space (the wear command) puts it on and does not swing', () => {
    const g = fresh();
    give(g, 'wood_sword');
    wear(g, 'wood_sword');
    give(g, 'stone_sword');
    expect(g.rt.ask).toBe('stone_sword');
    run(g, 1, { c: 'wear', item: 'stone_sword' }, true);
    expect(g.s.gear.sword).toBe('stone_sword');
    expect(g.rt.swingT).toBe(0);
    expect(g.rt.ask).toBe('');
    // a worse one never asks, and an unanswered better one is not forced over the one she wears
    g.s.plus.stone_sword = 2;
    give(g, 'iron_sword');
    expect(g.rt.ask).toBe('');
    g.s.plus.stone_sword = 0;
    give(g, 'diamond_sword');
    expect(g.rt.ask).toBe('diamond_sword');
    run(g, Math.ceil(ASK_SECS * 60) + 2);
    expect(g.s.gear.sword).toBe('stone_sword');
  });

  it('asks one question at a time, and a tie goes to the higher tier', () => {
    const g = fresh();
    give(g, 'stone_sword');
    wear(g, 'stone_sword');
    give(g, 'iron_helmet');
    give(g, 'iron_sword');
    expect(g.rt.ask).toBe('iron_helmet');
    expect(g.rt.askQ).toEqual(['iron_sword']);
    run(g, 1, { c: 'wear', item: 'iron_helmet' });
    expect(g.rt.ask).toBe('iron_sword');
    run(g, 1, { c: 'wear', item: 'iron_sword' });
    expect(g.rt.ask).toBe('');
    // an iron sword +1 does 4, like a diamond one: the diamond one still asks
    g.s.plus.iron_sword = 1;
    give(g, 'diamond_sword');
    expect(g.rt.ask).toBe('diamond_sword');
  });

  it('takes a piece off; the bow shoots only from the bow slot', () => {
    const g = fresh();
    give(g, 'bow');
    wear(g, 'bow');
    give(g, 'arrow', 5);
    expect(bowDmg(g)).toBe(2);
    // package 69: an arrow flies only when there is something to shoot
    makeMob(g, 'zombie', g.s.x + 3, g.s.y).tag = 'story';
    run(g, 1, { c: 'unwear', slot: 'bow' });
    expect(g.s.gear.bow).toBe('');
    step(g, { ...NO_INPUT, fire: true });
    expect(g.rt.shots.length).toBe(0);
    run(g, 1, { c: 'wear', item: 'bow' });
    step(g, { ...NO_INPUT, fire: true });
    expect(g.rt.shots.length).toBe(1);
  });

  it('cannot wear what she does not have, or a thing that is not gear', () => {
    const g = fresh();
    expect(wear(g, 'iron_helmet')).toBe(false);
    give(g, 'wood_axe');
    expect(wear(g, 'wood_axe')).toBe(false);
    expect(g.s.gear.helmet).toBe('');
  });
});

describe('gear: blue shield hearts', () => {
  it('gives the builder numbers and never more than 4 hearts', () => {
    const g = fresh();
    const put = (...ids: string[]) => {
      for (const id of ids) {
        g.s.pouch[id] = 1;
        wear(g, id);
      }
    };
    put('leather_helmet', 'leather_armour');
    expect(shieldMax(g)).toBe(4);
    put('iron_helmet', 'iron_armour');
    expect(shieldMax(g)).toBe(6);
    put('diamond_helmet', 'diamond_armour');
    expect(shieldMax(g)).toBe(8);
    expect(SHIELD_CAP).toBe(8);
    // a heavier piece still stops at the cap
    const c: Content = { ...content, items: { ...content.items } };
    c.items.diamond_armour = { ...content.items.diamond_armour!, shield: 5 };
    const h = fresh(5, c);
    for (const id of ['diamond_helmet', 'diamond_armour']) {
      h.s.pouch[id] = 1;
      wear(h, id);
    }
    expect(shieldMax(h)).toBe(8);
    expect(h.s.shield).toBe(8);
  });

  it('putting armour on adds its hearts once; swapping cannot refill them', () => {
    const g = fresh();
    g.s.pouch.leather_helmet = 1;
    g.s.pouch.iron_armour = 1;
    g.s.pouch.leather_armour = 1;
    wear(g, 'leather_helmet');
    expect(g.s.shield).toBe(2);
    wear(g, 'iron_armour');
    expect(g.s.shield).toBe(6);
    g.s.shield = 1;
    wear(g, 'leather_armour');
    expect(g.s.shield).toBe(1);
    wear(g, 'iron_armour');
    expect(g.s.shield).toBe(3);
  });

  it('takes hits before her red hearts, in order, after Gentle halves them', () => {
    const g = fresh();
    g.s.opts.gentle = false;
    g.s.pouch.leather_helmet = 1;
    g.s.pouch.leather_armour = 1;
    wear(g, 'leather_helmet');
    wear(g, 'leather_armour');
    expect(g.s.shield).toBe(4);
    const hp = g.s.hp;
    g.ev.length = 0;
    hurtHero(g, 3, g.s.x + 1, g.s.y);
    expect(g.s.shield).toBe(1);
    expect(g.s.hp).toBe(hp);
    expect(gearEvents(g)).toContain('shieldHurt');
    g.rt.safeT = 0;
    g.rt.hurtT = 0;
    hurtHero(g, 3, g.s.x + 1, g.s.y);
    expect(g.s.shield).toBe(0);
    expect(g.s.hp).toBe(hp - 2);
    g.rt.safeT = 0;
    hurtHero(g, 2, g.s.x + 1, g.s.y);
    expect(g.s.hp).toBe(hp - 4);
    // Gentle: 4 half hearts become 2, all taken by the shield
    g.s.opts.gentle = true;
    g.s.shield = 4;
    g.rt.safeT = 0;
    hurtHero(g, 4, g.s.x + 1, g.s.y);
    expect(g.s.shield).toBe(2);
  });

  it('come back when she sleeps and when she gets a hug', () => {
    const g = fresh();
    g.s.pouch.iron_helmet = 1;
    wear(g, 'iron_helmet');
    g.s.shield = 0;
    g.ev.length = 0;
    newDay(g, true);
    expect(g.s.shield).toBe(2);
    expect(gearEvents(g)).toContain('shieldBack');
    g.s.shield = 1;
    g.ev.length = 0;
    hug(g);
    expect(g.s.shield).toBe(2);
    expect(gearEvents(g)).toContain('shieldBack');
    // a morning without sleep (she was carried home is a sleep too) leaves a full shield alone
    g.ev.length = 0;
    hug(g);
    expect(gearEvents(g)).not.toContain('shieldBack');
  });
});

describe('gear: upgrades', () => {
  /** At home, by an anvil she placed, with what +1 and +2 cost. */
  const atAnvil = (): Game => {
    const g = fresh();
    give(g, 'stone_sword');
    wear(g, 'stone_sword');
    const bed = g.s.placed.find((p) => p.item === 'bed')!;
    enterArea(g, 'cottage', bed.x + 2.5, bed.y + 0.5, 'right');
    g.s.placed.push({ k: g.s.nextK++, item: 'anvil', area: 'cottage', x: bed.x + 3, y: bed.y });
    return g;
  };

  it('costs the builder numbers and adds 1 damage a step, up to +2', () => {
    expect(UPGRADE_COST).toEqual([
      { items: { iron_ingot: 2 }, emeralds: 5 },
      { items: { diamond: 1 }, emeralds: 10 },
    ]);
    const g = atAnvil();
    expect(upgradeHere(g)).toBe(true);
    expect(upgradeWhy(g, 'stone_sword')).toBe('short');
    give(g, 'iron_ingot', 2);
    g.s.emeralds = 15;
    run(g, 1, { c: 'upgrade', item: 'stone_sword' });
    expect(g.s.plus.stone_sword).toBe(1);
    expect(g.s.emeralds).toBe(10);
    expect(swordDmg(g)).toBe(3);
    expect(gearEvents(g)).toContain('upgrade');
    give(g, 'diamond', 1);
    expect(upgrade(g, 'stone_sword')).toBe(true);
    expect(g.s.plus.stone_sword).toBe(2);
    expect(g.s.emeralds).toBe(0);
    expect(swordDmg(g)).toBe(4);
    give(g, 'diamond', 1);
    g.s.emeralds = 99;
    expect(upgradeWhy(g, 'stone_sword')).toBe('max');
    expect(upgrade(g, 'stone_sword')).toBe(false);
    expect(g.s.plus.stone_sword).toBe(2);
  });

  it('upgrades the bow too, never armour, and an upgraded arrow hits harder', () => {
    const g = atAnvil();
    give(g, 'bow');
    wear(g, 'bow');
    give(g, 'iron_ingot', 4);
    g.s.emeralds = 10;
    expect(upgrade(g, 'bow')).toBe(true);
    expect(bowDmg(g)).toBe(3);
    g.s.pouch.leather_helmet = 1;
    expect(upgradeWhy(g, 'leather_helmet')).toBe('not_gear');
  });

  it('works at Grandad’s workbench only once he has opened it, and not far from an anvil', () => {
    const g = fresh();
    give(g, 'wood_sword');
    wear(g, 'wood_sword');
    give(g, 'iron_ingot', 2);
    g.s.emeralds = 5;
    const o = content.areas.island!.objects.find((x) => x.id === 'grandad_bench')!;
    enterArea(g, 'island', o.x + 1, o.y + 1.8, 'up');
    expect(upgradeHere(g)).toBe(false);
    expect(upgrade(g, 'wood_sword')).toBe(false);
    g.s.flags.upgrades_open = 1;
    expect(upgradeHere(g)).toBe(true);
    expect(upgrade(g, 'wood_sword')).toBe(true);
    enterArea(g, 'island', o.x + 8, o.y + 8, 'up');
    expect(upgradeWhy(g, 'wood_sword')).toBe('not_here');
  });

  it('a +1 sword beats a zombie in fewer swings', () => {
    const g = fresh();
    give(g, 'wood_sword');
    wear(g, 'wood_sword');
    const m = makeMob(g, 'zombie', g.s.x + 1, g.s.y);
    expect(m.hp).toBe(3);
    damage(g, m, swordDmg(g), 1, 0);
    expect(m.hp).toBe(2);
    g.s.plus.wood_sword = 1;
    damage(g, m, swordDmg(g), 1, 0);
    expect(m.hp).toBe(0);
  });
});

describe('gear: mobs feed crafting', () => {
  const beat = (id: string) => {
    const g = fresh(11);
    const m = makeMob(g, id, g.s.x + 1, g.s.y);
    m.hp = 1;
    damage(g, m, 9, 1, 0);
    return g;
  };
  it('zombies drop leather scraps, skeletons bones and arrows, spiders string, beaten creepers gunpowder', () => {
    for (let seed = 0; seed < 5; seed++) {
      const z = beat('zombie');
      expect(z.s.bag.find((sl) => sl?.id === 'leather_scrap')?.n ?? 0).toBeGreaterThanOrEqual(2);
    }
    const k = beat('skeleton');
    expect(k.s.bag.some((sl) => sl?.id === 'bone')).toBe(true);
    expect(k.s.bag.some((sl) => sl?.id === 'arrow')).toBe(true);
    expect(beat('spider').s.bag.some((sl) => sl?.id === 'string')).toBe(true);
    expect(beat('creeper').s.bag.some((sl) => sl?.id === 'gunpowder')).toBe(true);
  });
  it('leather is made from scraps and never comes from an animal', () => {
    expect(content.recipes.leather!.in).toEqual({ leather_scrap: 2 });
    for (const a of Object.values(content.animals)) expect(a.gives?.item ?? '').not.toMatch(/leather/);
    for (const t of Object.values(content.objects))
      for (const y of t.node?.yield ?? []) expect(y.item).not.toMatch(/leather/);
    expect(content.recipes.leather_helmet!.in).toEqual({ leather: 3 });
    expect(content.recipes.iron_armour!.in).toEqual({ iron_ingot: 5 });
    expect(content.recipes.anvil!.in).toEqual({ iron_ingot: 4, cobblestone: 2 });
  });
});

describe('gear: mobs are tougher far from home', () => {
  const g = fresh();
  it('a zombie has 3 health near home, 6 on the plains, 8 in the forest and the mine, 12 in the crater', () => {
    for (const code of ['U', 'B', 'P', 'G', 'H']) {
      const [x, y] = tileOf(code);
      expect(mobHp(g, 'zombie', 'island', x, y)).toBe(3);
    }
    expect(mobHp(g, 'zombie', 'island', ...tileOf('L'))).toBe(6);
    expect(mobHp(g, 'zombie', 'island', ...tileOf('F'))).toBe(8);
    expect(mobHp(g, 'zombie', 'mine2', 5, 5)).toBe(8);
    expect(mobHp(g, 'zombie', 'island', ...tileOf('C'))).toBe(12);
    // others scale with it; bosses keep their own
    expect(mobHp(g, 'spider', 'island', ...tileOf('L'))).toBe(4);
    expect(mobHp(g, 'creeper_king', 'hall', 5, 5)).toBe(content.mobs.creeper_king!.hp);
  });
  it('the right sword takes 3 or 4 hits, one tier lower takes more, two lower at least twice as many', () => {
    const tiers = { L: 2, F: 3, C: 4 } as const;
    for (const code of ['L', 'F', 'C'] as const) {
      const hp = mobHp(g, 'zombie', 'island', ...tileOf(code));
      const right = Math.ceil(hp / tiers[code]);
      const lower = Math.ceil(hp / (tiers[code] - 1));
      const two = Math.ceil(hp / Math.max(1, tiers[code] - 2));
      expect(right).toBeGreaterThanOrEqual(3);
      expect(right).toBeLessThanOrEqual(4);
      expect(lower).toBeGreaterThan(right);
      expect(two).toBeGreaterThanOrEqual(right * 2);
    }
  });
  it('a mob made out there gets that health', () => {
    const h = fresh();
    enterArea(h, 'island', 115.5, 50.5, 'right');
    h.s.time = NIGHT_AT + 20;
    const m = makeMob(h, 'zombie', h.s.x + 2, h.s.y);
    expect(m.hp).toBe(6);
  });
});

describe('gear: saves', () => {
  it('an old save wears its best sword and its bow, with no upgrades and no shield', () => {
    const g = fresh();
    g.s.pouch.wood_sword = 1;
    g.s.pouch.stone_sword = 1;
    g.s.pouch.bow = 1;
    const raw = JSON.parse(serialize(g));
    delete raw.gear;
    delete raw.plus;
    delete raw.shield;
    const s = migrate(content, raw);
    expect(s.gear).toEqual({ sword: 'stone_sword', bow: 'bow', helmet: '', armour: '' });
    expect(s.plus).toEqual({});
    expect(s.shield).toBe(0);
  });
  it('keeps gear, upgrades and shield across a save, and mends what does not fit', () => {
    const g = fresh();
    g.s.pouch.iron_sword = 1;
    g.s.pouch.iron_helmet = 1;
    wear(g, 'iron_sword');
    wear(g, 'iron_helmet');
    g.s.plus.iron_sword = 2;
    g.s.shield = 1;
    const back = load(content, serialize(g));
    expect(back.s.gear.sword).toBe('iron_sword');
    expect(back.s.gear.helmet).toBe('iron_helmet');
    expect(back.s.plus.iron_sword).toBe(2);
    expect(back.s.shield).toBe(1);
    const raw = JSON.parse(serialize(g)) as GameState;
    raw.gear.armour = 'diamond_armour';
    raw.gear.bow = 'iron_sword';
    raw.plus.iron_sword = 7;
    raw.plus.gone_item = 1;
    raw.shield = 9;
    fixGear(content, raw);
    expect(raw.gear.armour).toBe('');
    expect(raw.gear.bow).toBe('');
    expect(raw.plus).toEqual({ iron_sword: 2 });
    expect(raw.shield).toBe(2);
  });
});
