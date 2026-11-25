// Farming on the home plot: plant a seed with R, sleep, pick with Space. No watering.
import { give, plotRect, take, toolTier } from './bag.ts';
import { solidAt } from './grid.ts';
import { DIRV, knowsTool, nudge, placedAt } from './hero.ts';
import { questEvent } from './quests.ts';
import type { Game, Placed } from './types.ts';

export function cropAt(g: Game, x: number, y: number): { ripe: boolean; i: number } | null {
  const crops = g.s.crops;
  for (let i = 0; i < crops.length; i++) {
    const c = crops[i]!;
    if (c.x === x && c.y === y) return { ripe: c.age >= g.c.items[c.seed]!.grows!.days, i };
  }
  return null;
}

/** R with a seed picked: plant on the soil in front of her, tilling it first if it is bare plot grass. */
export function useSeed(g: Game, seed: string): void {
  const s = g.s;
  if (s.area !== 'island') {
    nudge(g, 'plant_home_only');
    return;
  }
  if (toolTier(g, 'spade') === 0) {
    nudge(g, knowsTool(g, 'spade') ? 'need_spade_make' : 'need_spade');
    return;
  }
  const [dx, dy] = DIRV[s.dir];
  const tx = Math.floor(s.x + dx * 0.85);
  const ty = Math.floor(s.y + dy * 0.85);
  const plot = plotRect(g);
  if (tx < plot.x || ty < plot.y || tx >= plot.x + plot.w || ty >= plot.y + plot.h) {
    nudge(g, 'plant_home_only');
    return;
  }
  let soil = placedAt(g, 'island', tx, ty, 'floor');
  if (soil && g.c.items[soil.item]?.place?.use !== 'soil') {
    nudge(g, 'plant_blocked');
    return;
  }
  if (!soil) {
    if (solidAt(g, 'island', tx, ty) || placedAt(g, 'island', tx, ty, 'object')) {
      nudge(g, 'plant_blocked');
      return;
    }
    soil = { k: s.nextK++, item: 'farmland', area: 'island', x: tx, y: ty };
    s.placed.push(soil);
    g.ev.push({ t: 'fx', id: 'dust', x: tx + 0.5, y: ty + 0.5 });
  }
  if (cropAt(g, tx, ty)) {
    nudge(g, 'plant_taken');
    return;
  }
  take(g, seed, 1);
  s.crops.push({ x: tx, y: ty, seed, age: 0 });
  g.rt.worldRev++;
  g.ev.push({ t: 'sfx', id: 'plant' });
  g.ev.push({ t: 'fx', id: 'sprout', x: tx + 0.5, y: ty + 0.5 });
  g.ev.push({ t: 'act', kind: 'plant', id: seed });
}

/** Space on a ripe crop: pick it. */
export function cropAct(g: Game, soil: Placed): void {
  const c = cropAt(g, soil.x, soil.y);
  if (!c?.ripe) return;
  const crop = g.s.crops[c.i]!;
  const def = g.c.items[crop.seed]!.grows!;
  g.s.crops.splice(c.i, 1);
  give(g, def.crop, def.n);
  g.rt.worldRev++;
  g.ev.push({ t: 'sfx', id: 'pickup' });
  g.ev.push({ t: 'fx', id: 'pop', x: soil.x + 0.5, y: soil.y + 0.5, item: def.crop, n: def.n });
  g.ev.push({ t: 'act', kind: 'harvest', id: def.crop });
  g.s.counts.harvest = (g.s.counts.harvest ?? 0) + 1;
  questEvent(g, 'grow', def.crop, def.n);
}

export function cropsMorning(g: Game): void {
  for (const c of g.s.crops) c.age++;
  g.rt.worldRev++;
}
