// Build mode: free grid building on the home plot and inside the cottage. Everything placed can be picked up again.
import { CHEST_SLOTS, give, plotRect, take } from './bag.ts';
import { count } from './cond.ts';
import { cropAt } from './farm.ts';
import { findPath, solidAt, terrainAt } from './grid.ts';
import { DIRV, nudge, placedAt } from './hero.ts';
import { place, questEvent } from './quests.ts';
import type { Game, Input, PlaceDef } from './types.ts';

/** Things in the bag that can be placed, in bag order. */
export function placeables(g: Game): string[] {
  const out: string[] = [];
  for (const sl of g.s.bag) if (sl && g.c.items[sl.id]?.place && !out.includes(sl.id)) out.push(sl.id);
  return out;
}

function zone(g: Game) {
  if (g.s.area === 'island') return plotRect(g);
  const a = g.c.areas[g.s.area]!;
  return { x: 1, y: 1, w: a.w - 2, h: a.h - 2 };
}
function size(def: PlaceDef, rot: number): [number, number] {
  return rot % 2 ? [def.h ?? 1, def.w ?? 1] : [def.w ?? 1, def.h ?? 1];
}

/** Why this cannot go here, as a strings key, or null when it can. */
export function canPlace(g: Game, item: string, x: number, y: number, rot = 0): string | null {
  const s = g.s;
  const def = g.c.items[item]?.place;
  if (!def) return 'build_no';
  if (s.area !== 'island' && s.area !== 'cottage') return 'build_home_only';
  if (def.where === 'plot' && s.area !== 'island') return 'build_outside';
  if (def.where === 'house' && s.area !== 'cottage') return 'build_inside';
  if (count(g, item) < 1) return 'build_none';
  const z = zone(g);
  const a = g.c.areas[s.area]!;
  const [w, h] = size(def, rot);
  for (let dy = 0; dy < h; dy++)
    for (let dx = 0; dx < w; dx++) {
      const tx = x + dx;
      const ty = y + dy;
      if (tx < z.x || ty < z.y || tx >= z.x + z.w || ty >= z.y + z.h) return 'build_edge';
      const ter = terrainAt(a, tx, ty);
      if (def.layer === 'object') {
        if (solidAt(g, s.area, tx, ty) || placedAt(g, s.area, tx, ty, 'object')) return 'build_taken';
        if (def.solid && (ter === 'p' || ter === 'e')) return 'build_path';
        if (def.solid && Math.floor(s.x) === tx && Math.floor(s.y) === ty) return 'build_feet';
        if (cropAt(g, tx, ty)) return 'build_taken';
      } else {
        if (placedAt(g, s.area, tx, ty, 'floor')) return 'build_taken';
        if (s.area === 'cottage' ? ter !== 'f' : ter === 'w' || ter === 'q') return 'build_taken';
      }
    }
  if (def.layer === 'object' && def.solid) {
    // Never let her wall herself in: the way out must stay open.
    const solid = g.rt.solid[s.area]!;
    const exit = place(g, s.area === 'island' ? 'plot_gate' : 'cottage_exit');
    if (exit) {
      const saved: number[] = [];
      for (let dy = 0; dy < h; dy++)
        for (let dx = 0; dx < w; dx++) {
          const k = (y + dy) * a.w + x + dx;
          saved.push(solid[k]!);
          solid[k] = 1;
        }
      const ok = findPath(solid, a.w, a.h, Math.floor(s.x), Math.floor(s.y), exit.x, exit.y, 0, 4000);
      let i = 0;
      for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) solid[(y + dy) * a.w + x + dx] = saved[i++]!;
      if (!ok) return 'build_stuck';
    }
  }
  return null;
}

export function placeItem(g: Game, item: string, x: number, y: number, rot = 0, text?: string): boolean {
  const why = canPlace(g, item, x, y, rot);
  if (why) {
    nudge(g, why, 2.5);
    g.ev.push({ t: 'sfx', id: 'nope' });
    return false;
  }
  const s = g.s;
  take(g, item, 1);
  const k = s.nextK++;
  s.placed.push({ k, item, area: s.area, x, y, rot: rot || undefined, text });
  if (g.c.items[item]!.place!.use === 'chest') s.chests[String(k)] = new Array(CHEST_SLOTS).fill(null);
  s.counts.placed = (s.counts.placed ?? 0) + 1;
  g.rt.dirty = true;
  // saved as soon as she is back in play (and by the autosave while she keeps building)
  g.rt.saveDue = true;
  g.ev.push({ t: 'sfx', id: 'place' });
  g.ev.push({ t: 'fx', id: 'place', x: x + 0.5, y: y + 0.5 });
  g.ev.push({ t: 'act', kind: 'place', id: item });
  questEvent(g, 'place', item);
  return true;
}

export function removeAt(g: Game, x: number, y: number): boolean {
  const s = g.s;
  const p = placedAt(g, s.area, x, y);
  if (!p) return false;
  if (s.chests[String(p.k)]?.some((sl) => sl)) {
    nudge(g, 'chest_full', 2.5);
    return false;
  }
  const crop = cropAt(g, p.x, p.y);
  if (crop) {
    const c = s.crops[crop.i]!;
    s.crops.splice(crop.i, 1);
    give(g, c.seed, 1, true);
  }
  delete s.chests[String(p.k)];
  s.placed.splice(s.placed.indexOf(p), 1);
  if (p.item !== 'farmland') give(g, p.item, 1, true);
  g.rt.dirty = true;
  g.rt.saveDue = true;
  g.ev.push({ t: 'sfx', id: 'pickup' });
  g.ev.push({ t: 'fx', id: 'puff', x: x + 0.5, y: y + 0.5 });
  return true;
}

export function setBuild(g: Game, on: boolean): void {
  const s = g.s;
  if (!on) {
    if (g.rt.mode === 'build') g.rt.mode = 'play';
    g.rt.build = null;
    return;
  }
  if (g.rt.mode !== 'play') return;
  const z = zone(g);
  const inside =
    s.area === 'cottage' ||
    (s.area === 'island' && s.x >= z.x - 1 && s.y >= z.y - 1 && s.x < z.x + z.w + 1 && s.y < z.y + z.h + 1);
  if (!inside) {
    nudge(g, 'build_home_only');
    g.ev.push({ t: 'sfx', id: 'nope' });
    return;
  }
  const [dx, dy] = DIRV[s.dir];
  const cx = Math.max(z.x, Math.min(z.x + z.w - 1, Math.floor(s.x) + dx));
  const cy = Math.max(z.y, Math.min(z.y + z.h - 1, Math.floor(s.y) + dy));
  g.rt.build = { cx, cy, sel: 0, rot: 0 };
  g.rt.mode = 'build';
  g.ev.push({ t: 'sfx', id: 'open' });
}

export function stepBuild(g: Game, inp: Input, edgeX: number, edgeY: number): void {
  const b = g.rt.build;
  if (!b) {
    g.rt.mode = 'play';
    return;
  }
  const z = zone(g);
  if (edgeX || edgeY) {
    b.cx = Math.max(z.x, Math.min(z.x + z.w - 1, b.cx + edgeX));
    b.cy = Math.max(z.y, Math.min(z.y + z.h - 1, b.cy + edgeY));
    g.ev.push({ t: 'sfx', id: 'tick' });
  }
  const list = placeables(g);
  if (b.sel >= list.length) b.sel = Math.max(0, list.length - 1);
  if (inp.use) b.rot = (b.rot + 1) % 4;
  if (inp.act && list.length) placeItem(g, list[b.sel]!, b.cx, b.cy, g.c.items[list[b.sel]!]!.place!.rot ? b.rot : 0);
  if (inp.back) removeAt(g, b.cx, b.cy);
}
