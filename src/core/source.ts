// Package 68: what the goal wants made, what it still lacks, and where each thing comes from in 3 words. One place
// for the goal line ("Sticks 1 of 3"), the help card (the missing things as pictures) and the bench (the goal's
// recipe chosen first, and a warning before another recipe uses up what the goal needs).
import { countWithChests } from './bag.ts';
import { count } from './cond.ts';
import { craftWant } from './hints.ts';
import type { Game, RecipeDef } from './types.ts';

export interface Want {
  r: RecipeDef;
  /** how many times the recipe must be made */
  times: number;
}

/** The recipe the tracked step wants made now, or null. */
export function goalRecipe(g: Game): Want | null {
  const item = craftWant(g);
  if (!item) return null;
  let r: RecipeDef | undefined;
  for (const id of g.s.recipes) if (g.c.recipes[id]?.out === item) r = g.c.recipes[id];
  if (!r) return null;
  const s = g.s;
  const q = s.tracked ? s.quests[s.tracked] : undefined;
  const st = s.tracked && q ? g.c.quests[s.tracked]?.steps[q.step] : undefined;
  let need = 1;
  if (st && (st.t === 'craft' || st.t === 'fetch' || st.t === 'deliver')) need = st.n ?? 1;
  else if (st?.t === 'site')
    for (const a in g.c.areas) for (const b of g.c.areas[a]!.sites) if (b.id === st.site) need = b.needs[item] ?? 1;
  const left = Math.max(1, need - count(g, item));
  return { r, times: Math.ceil(left / r.n) };
}

export interface Short {
  item: string;
  have: number;
  need: number;
}

/** The things a recipe still lacks for `times` makes (bag and home chests count, as at the bench). */
export function missing(g: Game, r: RecipeDef, times: number): Short[] {
  const out: Short[] = [];
  for (const k in r.in) {
    const need = r.in[k]! * times;
    const have = Math.min(need, countWithChests(g, k));
    if (have < need) out.push({ item: k, have, need });
  }
  return out;
}

/** Would making `id` this many times use up things the goal's recipe still needs? (never for the goal's own) */
export function eatsGoal(g: Game, id: string, times = 1): boolean {
  const want = goalRecipe(g);
  const r = g.c.recipes[id];
  if (!want || !r || want.r.id === id) return false;
  for (const k in r.in) {
    const goalNeeds = (want.r.in[k] ?? 0) * want.times;
    if (goalNeeds > 0 && countWithChests(g, k) - r.in[k]! * times < goalNeeds) return true;
  }
  return false;
}

const TREES = new Set(['oak', 'pine', 'palm', 'dark_oak', 'block_oak', 'birch', 'fallen_gum']);

/** Where a thing comes from, in 3 words or fewer ("Chop a tree", "From spiders", "Make at bench"). */
export function whereFrom(g: Game, item: string): string {
  const S = g.c.strings;
  const own = S[`from:${item}`];
  if (own) return own;
  // a mob that always or often drops it
  for (const id in g.c.mobs) {
    const m = g.c.mobs[id]!;
    if (m.role === 'hostile' && m.drops.some((d) => d.item === item && (d.p ?? 1) >= 0.5)) return `From ${m.name}s`;
  }
  // a thing in the world: the kind there are most of
  const many: Record<string, number> = {};
  for (const a in g.c.areas) for (const o of g.c.areas[a]!.objects) many[o.type] = (many[o.type] ?? 0) + 1;
  let best = '';
  let bestN = 0;
  for (const id in g.c.objects) {
    const n = g.c.objects[id]!.node;
    if (!n || n.tool === 'bow' || !n.yield.some((y) => y.item === item && (y.p ?? 1) >= 0.5)) continue;
    const k = TREES.has(id) ? 1e6 : (many[id] ?? 0);
    if (k > bestN) {
      bestN = k;
      best = id;
    }
  }
  if (best) {
    const n = g.c.objects[best]!.node!;
    if (TREES.has(best)) return 'Chop a tree';
    const name = (g.c.objects[best]!.name ?? best).replace(/_/g, ' ');
    if (n.verb === 'pick') return `Find ${name}s`;
    const verb = n.verb.charAt(0).toUpperCase() + n.verb.slice(1);
    return `${verb} ${name}s`;
  }
  for (const id of g.s.recipes) {
    const r = g.c.recipes[id];
    if (r?.out === item) return r.at === 'furnace' ? 'Make at furnace' : 'Make at bench';
  }
  for (const id in g.c.stalls) if (g.c.stalls[id]!.sells.some((x) => x.item === item)) return 'Buy at a shop';
  return S.from_look ?? 'Look around';
}
