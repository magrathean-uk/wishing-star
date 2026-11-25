// Saves: a round trip keeps everything, old saves are migrated, broken ones are refused, and personal.json
// holds every name, letter and note the game reads from it.
import { describe, expect, it } from 'vitest';
import { give } from '../src/core/bag.ts';
import { load, serialize } from '../src/core/save.ts';
import { newGame, SAVE_VERSION } from '../src/core/state.ts';
import { fill } from '../src/core/talk.ts';
import { content } from '../src/data/content.ts';
import personal from '../src/data/personal.json' with { type: 'json' };

const busyGame = () => {
  const g = newGame(content, { seed: 11, hero: 'bluey', koala: 'Gumnut' });
  give(g, 'log', 5);
  give(g, 'wood_axe', 1);
  g.s.emeralds = 9;
  g.s.flags.day2 = 1;
  g.s.placed.push({ k: 50, item: 'crafting_table', area: 'island', x: 73, y: 81 });
  g.s.crops.push({ x: 72, y: 90, seed: 'wheat_seed', age: 1 });
  return g;
};

describe('save', () => {
  it('round-trips: serialize then load gives an equal state', () => {
    const g = busyGame();
    const json = serialize(g);
    const back = load(content, json);
    // the random stream is left out: boot() lets refreshNpcs and refreshBeasts draw from it (reported, see todo below)
    const a = { ...JSON.parse(json), rng: 0 };
    const b = { ...JSON.parse(serialize(back)), rng: 0 };
    expect(b).toEqual(a);
  });

  it('keeps the random stream on load, so a loaded game goes on exactly as the saved one would', () => {
    const g = busyGame();
    const json = serialize(g);
    const back = load(content, json);
    expect(JSON.parse(serialize(back)).rng).toEqual(JSON.parse(json).rng);
  });

  it('migrates a version 1 save (koalaName, no house size, no pets)', () => {
    const raw = JSON.parse(serialize(busyGame()));
    raw.v = 1;
    raw.koalaName = 'Gumnut';
    delete raw.koala;
    delete raw.houseSize;
    delete raw.pets;
    const g = load(content, JSON.stringify(raw));
    expect(g.s.v).toBe(SAVE_VERSION);
    // the old name moves across, but the game always says Koala now (phase 2, part A)
    expect(g.s.koala).toBe('Gumnut');
    expect(fill(g, '{koala}')).toBe('Koala');
    expect((g.s as unknown as Record<string, unknown>).koalaName).toBeUndefined();
    expect(g.s.houseSize).toBe(0);
    expect(g.s.pets).toEqual([]);
    expect(g.s.emeralds).toBe(9);
  });

  it('refuses a broken save', () => {
    expect(() => load(content, 'not a save at all')).toThrow();
    expect(() => load(content, '{}')).toThrow('not a save');
    expect(() => load(content, JSON.stringify({ v: SAVE_VERSION + 1 }))).toThrow('newer');
  });

  it('drops things a later build no longer has instead of crashing', () => {
    const raw = JSON.parse(serialize(busyGame()));
    raw.bag[5] = { id: 'no_such_item', n: 2 };
    raw.quests.no_such_quest = { step: 0, n: 0 };
    const g = load(content, JSON.stringify(raw));
    expect(g.s.bag[5]).toBeNull();
    expect(g.s.quests.no_such_quest).toBeUndefined();
  });

  it('keeps an inside chest opened when the save opened it under its old shared id', () => {
    const raw = JSON.parse(serialize(busyGame()));
    raw.taken.chest_cave = 1;
    const g = load(content, JSON.stringify(raw));
    expect(g.s.taken.chest_cave).toBe(1);
    expect(g.s.taken.chest_cave_in).toBe(1);
    expect(g.s.taken.chest_heeler_in).toBeUndefined();
  });
});

describe('personal.json', () => {
  const p = personal as unknown as {
    greeting1: string;
    greeting2: string;
    credits: string;
    names: Record<string, string>;
    letters: Record<string, { from?: string; pages?: string[] }>;
    bottles: Record<string, string>;
  };

  it('has the greeting and the credits line', () => {
    for (const k of ['greeting1', 'greeting2', 'credits'] as const)
      expect(typeof p[k] === 'string' && p[k].length > 0, k).toBe(true);
  });

  it('has a name for every token the story uses', () => {
    const used = new Set<string>();
    const text = JSON.stringify([
      content.quests,
      content.cutscenes,
      content.chars,
      content.letters,
      content.heroes,
      content.stickers,
    ]);
    for (const m of text.matchAll(/\{(\w+)\}/g)) used.add(m[1]!);
    used.delete('hero');
    const missing = [...used].filter((k) => !p.names[k]);
    expect(missing).toEqual([]);
  });

  it("has every one of Dad's letters and every bottle note", () => {
    const letters = Object.values(content.letters)
      .filter((l) => l.from === 'personal')
      .map((l) => l.id);
    expect(letters.filter((id) => !p.letters[id]?.pages?.length)).toEqual([]);
    const bottles = new Set<string>();
    for (const a in content.areas)
      for (const o of content.areas[a]!.objects)
        if (content.objects[o.type]?.interact === 'bottle') bottles.add(o.d ?? o.id);
    expect([...bottles].filter((id) => !p.bottles[id])).toEqual([]);
  });
});
