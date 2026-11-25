// Crafting from a recipe list at a table or furnace, and the shop.
import { countWithChests, give, promised, take, takeWithChests } from './bag.ts';
import { count, test } from './cond.ts';
import { nudge } from './hero.ts';
import { questEvent } from './quests.ts';
import type { Game, RecipeDef } from './types.ts';

/** Is she standing by a crafting table or furnace (her own or one in the world)? */
export function stationNear(g: Game, kind: 'table' | 'furnace'): boolean {
  const s = g.s;
  const a = g.c.areas[s.area]!;
  const live = g.rt.live[s.area]!;
  for (let i = 0; i < a.objects.length; i++) {
    if (!live[i]) continue;
    const o = a.objects[i]!;
    const t = g.c.objects[o.type]!;
    if (t.interact !== kind) continue;
    if (Math.abs(o.x + (t.w ?? 1) / 2 - s.x) < 2.6 && Math.abs(o.y + (t.h ?? 1) / 2 - s.y) < 2.6) return true;
  }
  for (const p of s.placed) {
    if (p.area !== s.area || g.c.items[p.item]?.place?.use !== kind) continue;
    if (Math.abs(p.x + 0.5 - s.x) < 2.6 && Math.abs(p.y + 0.5 - s.y) < 2.6) return true;
  }
  return false;
}

export function hasAll(g: Game, r: RecipeDef, times = 1): boolean {
  for (const k in r.in) if (countWithChests(g, k) < r.in[k]! * times) return false;
  return true;
}

/** Recipes she knows for a station, makeable ones first. */
export function recipeList(g: Game, kind: 'table' | 'furnace'): string[] {
  const out = g.s.recipes.filter((id) => g.c.recipes[id]?.at === kind);
  return out.sort((a, b) => Number(hasAll(g, g.c.recipes[b]!)) - Number(hasAll(g, g.c.recipes[a]!)));
}

/** Is she beside a cooking pot in her own house? */
export function potNear(g: Game): boolean {
  for (const p of g.s.placed) {
    if (p.area !== g.s.area || g.c.items[p.item]?.place?.use !== 'pot') continue;
    if (Math.abs(p.x + 0.5 - g.s.x) < 2.6 && Math.abs(p.y + 0.5 - g.s.y) < 2.6) return true;
  }
  return false;
}
/** Food made beside the cooking pot comes out double. */
export function cooks(g: Game, r: RecipeDef): boolean {
  return r.at === 'table' && g.c.items[r.out]?.kind === 'food' && potNear(g);
}

export function craft(g: Game, id: string, times = 1): boolean {
  const r = g.c.recipes[id];
  if (!r || !g.s.recipes.includes(id)) return false;
  const pot = cooks(g, r);
  if (!pot && !stationNear(g, r.at)) {
    nudge(g, r.at === 'table' ? 'need_table' : 'need_furnace');
    return false;
  }
  if (!hasAll(g, r, times)) {
    g.ev.push({ t: 'sfx', id: 'nope' });
    return false;
  }
  for (const k in r.in) takeWithChests(g, k, r.in[k]! * times);
  give(g, r.out, r.n * times * (pot ? 2 : 1));
  if (pot) g.s.counts.cooked = (g.s.counts.cooked ?? 0) + times;
  g.s.counts.crafted = (g.s.counts.crafted ?? 0) + times;
  g.ev.push({ t: 'sfx', id: r.at === 'furnace' ? 'smelt' : 'craft' });
  g.ev.push({ t: 'fx', id: 'craft', x: g.s.x, y: g.s.y, item: r.out });
  g.ev.push({ t: 'act', kind: 'craft', id: r.out });
  questEvent(g, 'craft', r.out, r.n * times * (pot ? 2 : 1));
  return true;
}

// ---------------------------------------------------------------- the shop

export function stockLeft(g: Game, stall: string, i: number): number {
  const row = g.c.stalls[stall]?.sells[i];
  if (!row) return 0;
  if (row.recipe && g.s.recipes.includes(row.recipe)) return 0;
  if (row.once && g.s.flags[`bought:${stall}:${i}`]) return 0;
  if (row.stock === undefined) return 99;
  return Math.max(0, row.stock - (g.s.bought[stall + ':' + i] ?? 0));
}

export function buy(g: Game, stall: string, i: number, n = 1): boolean {
  const def = g.c.stalls[stall];
  const row = def?.sells[i];
  if (!def || !row || !test(g, row.if)) return false;
  n = Math.min(n, stockLeft(g, stall, i));
  if (n <= 0) return false;
  const currency = stall === 'prizes' ? 'ticket' : null;
  const cost = row.price * n;
  if (currency ? count(g, currency) < cost : g.s.emeralds < cost) {
    nudge(g, currency ? 'need_tickets' : 'need_emeralds', 2.5);
    g.ev.push({ t: 'sfx', id: 'nope' });
    return false;
  }
  if (currency) take(g, currency, cost);
  else g.s.emeralds -= cost;
  g.s.bought[stall + ':' + i] = (g.s.bought[stall + ':' + i] ?? 0) + n;
  if (row.once) g.s.flags[`bought:${stall}:${i}`] = 1;
  if (row.recipe) {
    g.s.recipes.push(row.recipe);
    const out = g.c.recipes[row.recipe]?.out ?? row.item;
    g.ev.push({ t: 'toast', kind: 'recipe', text: g.c.items[out]?.name ?? out, item: out });
    g.ev.push({ t: 'reward', kind: 'recipe', id: row.recipe });
  } else give(g, row.item, n);
  g.ev.push({ t: 'sfx', id: 'coin' });
  g.ev.push({ t: 'act', kind: 'buy', id: row.item });
  return true;
}

export function sell(g: Game, slot: number, n = 1): boolean {
  const sl = g.s.bag[slot];
  if (!sl) return false;
  const d = g.c.items[sl.id]!;
  if (!d.sell) {
    g.ev.push({ t: 'sfx', id: 'nope' });
    return false;
  }
  n = Math.min(n, sl.n, count(g, sl.id) - promised(g, sl.id));
  if (n <= 0) {
    g.ev.push({ t: 'sfx', id: 'nope' });
    g.ev.push({ t: 'toast', kind: 'info', text: 'keep_that' });
    return false;
  }
  take(g, sl.id, n);
  g.s.emeralds += d.sell * n;
  g.ev.push({ t: 'sfx', id: 'coin' });
  g.ev.push({ t: 'toast', kind: 'item', text: g.c.items.emerald?.name ?? 'Emerald', item: 'emerald', n: d.sell * n });
  g.ev.push({ t: 'act', kind: 'sell', id: sl.id });
  return true;
}
