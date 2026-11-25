// Secrets and finds (design section 6): the chest on the school roof and the sparkle near a missing find.
// Titles are matched exactly by the design checklist script: do not reword them.
import { describe, expect, it } from 'vitest';
import { nearFind, SPARKLE_TILES } from '../src/core/finds.ts';
import { rebuildArea } from '../src/core/grid.ts';
import { newGame } from '../src/core/state.ts';
import { NO_INPUT, step } from '../src/core/step.ts';
import type { Game } from '../src/core/types.ts';
import { content } from '../src/data/content.ts';

const playing = (): Game => {
  const g = newGame(content, { seed: 3, hero: 'amelia' });
  g.rt.mode = 'play';
  g.rt.talk = null;
  g.rt.q = [];
  return g;
};
const standAt = (g: Game, x: number, y: number, dir: Game['s']['dir']) => {
  g.s.area = 'island';
  g.s.x = x;
  g.s.y = y;
  g.rt.px = x;
  g.rt.py = y;
  g.s.dir = dir;
};
const press = (g: Game) => {
  step(g, { ...NO_INPUT, act: true });
  for (let i = 0; i < 30 && g.rt.mode !== 'play'; i++) step(g, NO_INPUT);
};

describe('secrets', () => {
  it('a chest on the school roof opens from the ladder', () => {
    const isl = content.areas.island;
    const school = isl.objects.find((o) => o.type === 'school')!;
    const chest = isl.objects.find((o) => o.id === 'chest_school_roof')!;
    const ladder = isl.objects.find((o) => o.id === 'school_ladder')!;
    const t = content.objects.school!;
    // on the roof: inside the school's footprint, with the ladder right beside it
    expect(chest.x).toBeGreaterThanOrEqual(school.x);
    expect(chest.x).toBeLessThan(school.x + (t.w ?? 1));
    expect(chest.y).toBeGreaterThanOrEqual(school.y);
    expect(chest.y).toBeLessThan(school.y + (t.h ?? 1));
    expect(Math.abs(ladder.x - chest.x) + Math.abs(ladder.y - chest.y)).toBe(1);

    const g = playing();
    // before the ladder: nothing to open from the ladder spot
    standAt(g, ladder.x + 0.5, ladder.y + 0.5, 'left');
    rebuildArea(g, 'island');
    const before = g.s.emeralds;
    press(g);
    expect(g.s.taken[chest.id]).toBeUndefined();
    // the ladder site is built: up she goes and opens it
    g.s.flags.site_school_ladder = 1;
    rebuildArea(g, 'island');
    standAt(g, ladder.x + 0.5, ladder.y + 0.5, 'left');
    press(g);
    expect(g.s.taken[chest.id]).toBe(1);
    expect(g.s.emeralds).toBeGreaterThan(before);
  });

  it('a sparkle shows when a missing find is within 10 tiles', () => {
    const g = playing();
    const dog = content.areas.island.objects.find((o) => o.id === 'long_dog_1')!;
    // far away: no sparkle
    standAt(g, dog.x + 0.5 + SPARKLE_TILES + 2, dog.y + 0.5, 'left');
    expect(nearFind(g)?.id).not.toBe(dog.id);
    // 9 tiles away: the sparkle points at it
    standAt(g, dog.x + 0.5 + 9, dog.y + 0.5, 'left');
    const near = nearFind(g);
    expect(near).not.toBeNull();
    expect(g.rt.nearSecret).toBe(true);
    expect(Math.hypot(near!.x - dog.x, near!.y - dog.y)).toBeLessThanOrEqual(9);
    // once she has its sticker, that find no longer sparkles
    g.s.stickers.longdog_1 = 1;
    expect(nearFind(g)?.id).not.toBe(dog.id);
    // and a find she has taken is gone too
    delete g.s.stickers.longdog_1;
    g.s.taken[dog.id] = 1;
    expect(nearFind(g)?.id).not.toBe(dog.id);
  });
});

describe('reading help', () => {
  it('a flagged glossary word shows its picture the first time only', async () => {
    const { firstGloss } = await import('../src/core/gloss.ts');
    const glossary = (await import('../src/data/glossary.json', { with: { type: 'json' } })).default as {
      words: Record<string, { pic: string; show?: boolean }>;
    };
    const show: Record<string, string> = {};
    for (const [w, d] of Object.entries(glossary.words)) if (d.show) show[w] = d.pic;
    expect(Object.keys(show).sort()).toEqual(['cobblestone', 'furnace', 'lighthouse', 'marmalade']);
    const g = playing();
    expect(firstGloss(g, 'Put the ore in the furnace.', show)).toEqual({ word: 'furnace', pic: 'furnace' });
    // seen once: never again, and it is kept in the save
    expect(firstGloss(g, 'The furnace is hot.', show)).toBeNull();
    expect(g.s.gloss).toContain('furnace');
    expect(firstGloss(g, 'You can see the lighthouse!', show)?.pic).toBe('lighthouse');
    expect(firstGloss(g, 'A plain line.', show)).toBeNull();
  });
});
