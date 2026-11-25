// The bag: 8 hotbar slots plus 36 bag slots, a pouch for tools and key things, and chests at home.
import { count } from './cond.ts';
import { gearArrived, slotOf, upgradeCost, upgradedIn } from './gear.ts';
import { sticker } from './quests.ts';
import type { Game, ItemDef, Slot, ToolType } from './types.ts';

export const HOTBAR = 8;
export const BAG_SLOTS = 44;
export const CHEST_SLOTS = 48;

export function itemDef(g: Game, id: string): ItemDef {
  const d = g.c.items[id];
  if (!d) throw new Error(`unknown item ${id}`);
  return d;
}
const inPouch = (d: ItemDef) => d.pouch || d.kind === 'tool' || d.kind === 'key';

/** Put items in. Returns how many did not fit (they are left on the ground by the caller). */
export function addTo(g: Game, slots: (Slot | null)[], id: string, n: number): number {
  const max = itemDef(g, id).stack ?? 99;
  for (let i = 0; i < slots.length && n > 0; i++) {
    const sl = slots[i];
    if (sl && sl.id === id && sl.n < max) {
      const take = Math.min(n, max - sl.n);
      sl.n += take;
      n -= take;
    }
  }
  for (let i = 0; i < slots.length && n > 0; i++) {
    if (!slots[i]) {
      const take = Math.min(n, max);
      slots[i] = { id, n: take };
      n -= take;
    }
  }
  return n;
}

/**
 * Give the hero something. Tools and key things go to the pouch and can never be lost.
 * Anything that does not fit waits on the ground at her feet. Fires the toast, the sticker and the first-time reward.
 */
export function give(g: Game, id: string, n = 1, quiet = false): void {
  if (n <= 0) return;
  const d = itemDef(g, id);
  const first = !g.s.flags['had:' + id];
  if (inPouch(d)) {
    const had = (g.s.pouch[id] ?? 0) > 0;
    g.s.pouch[id] = (g.s.pouch[id] ?? 0) + n;
    if (!had && slotOf(d)) gearArrived(g, id);
  } else {
    let left = addTo(g, g.s.bag, id, n);
    // A full bag never stops her: one stack she does not need right now is sent home to a chest.
    while (left > 0 && sendHome(g, id)) left = addTo(g, g.s.bag, id, left);
    if (left > 0) {
      g.s.drops.push({ area: g.s.area, x: g.s.x, y: g.s.y, id, n: left });
      if (!quiet) g.ev.push({ t: 'toast', kind: 'info', text: 'bag_full' });
    }
  }
  if (first) {
    g.s.flags['had:' + id] = 1;
    g.ev.push({ t: 'reward', kind: 'item', id });
    if (d.page) sticker(g, id);
  }
  if (!quiet) g.ev.push({ t: 'toast', kind: 'item', text: d.name, item: id, n });
  g.rt.questRev++;
}

/**
 * What her current quest steps ask for (and what those crafts and build sites use up), and every thing that a step
 * of an unfinished quest names when it is one of a kind (a find, a toy, a disc): found early, it must still be in her
 * bag when its quest asks for it.
 */
function wanted(g: Game, later = true): Set<string> {
  const w = new Set<string>();
  if (later)
    for (const qid in g.c.quests) {
      if (g.s.quests[qid]?.done) continue;
      for (const st of g.c.quests[qid]!.steps) {
        if ((st.t !== 'fetch' && st.t !== 'deliver') || !st.item) continue;
        // one-of-a-kind things only: wood, wheat and apples are named by many quests and can always be had again
        const k = g.c.items[st.item]?.kind;
        if (k === 'find' || k === 'toy' || k === 'disc') w.add(st.item);
      }
    }
  for (const qid in g.s.quests) {
    const qs = g.s.quests[qid]!;
    if (qs.done) continue;
    const st = g.c.quests[qid]?.steps[qs.step];
    if (!st) continue;
    if ('item' in st && st.item) {
      w.add(st.item);
      const r = g.c.recipes[st.item];
      if (st.t === 'craft' && r) for (const k in r.in) w.add(k);
    }
    if (st.t === 'site')
      for (const a of Object.values(g.c.areas))
        for (const b of a.sites) if (b.id === st.site) for (const k in b.needs) w.add(k);
  }
  return w;
}

/** How many of this thing someone in an active quest is waiting to be handed. She may not eat or sell those. */
export function promised(g: Game, id: string): number {
  let n = 0;
  for (const qid in g.s.quests) {
    const qs = g.s.quests[qid]!;
    if (qs.done) continue;
    const st = g.c.quests[qid]?.steps[qs.step];
    if (st && st.t === 'deliver' && st.item === id) n = Math.max(n, st.n ?? 1);
    // issue 62: what a story upgrade costs is kept too (no selling the iron bars to pay its emeralds)
    if (st && st.t === 'upgrade' && !upgradedIn(g, st.slot)) {
      const worn = g.s.gear[st.slot];
      const need = worn ? upgradeCost(g, worn)?.items[id] : undefined;
      if (need) n = Math.max(n, need);
    }
  }
  return n;
}

/** Move one bag stack (never the hotbar, never a thing a quest wants) into a home chest. False when nothing can go. */
function sendHome(g: Game, keep: string): boolean {
  if (sendHomeOnce(g, keep, wanted(g))) return true;
  // package 68: a thing a step asks for right now (a prize, say) never waits on the ground for a bag full of
  // finds for later quests: one of those goes home instead (it stays hers, in the chest).
  const now = wanted(g, false);
  return now.has(keep) && sendHomeOnce(g, keep, now);
}

function sendHomeOnce(g: Game, keep: string, w: Set<string>): boolean {
  const chests = Object.values(g.s.chests);
  if (chests.length === 0) return false;
  // Things for the home and the Sticker Book go first (they live at home anyway), then food, then raw materials:
  // the wood or ore she has just gathered for a job is the last thing to be sent away.
  const rank = (id: string): number => {
    const k = itemDef(g, id).kind;
    return k === 'material' ? 2 : k === 'food' || k === 'seed' || k === 'crop' || k === 'fish' ? 1 : 0;
  };
  let pick = -1;
  for (let i = HOTBAR; i < g.s.bag.length; i++) {
    const sl = g.s.bag[i];
    if (!sl || sl.id === keep || w.has(sl.id)) continue;
    if (pick < 0 || rank(sl.id) < rank(g.s.bag[pick]!.id)) pick = i;
  }
  if (pick < 0) return false;
  const sl = g.s.bag[pick]!;
  for (const c of chests) {
    const rest = addTo(g, c, sl.id, sl.n);
    if (rest === sl.n) continue;
    g.ev.push({ t: 'toast', kind: 'info', text: 'bag_sent', item: sl.id, n: sl.n - rest });
    if (rest > 0) {
      sl.n = rest;
      continue;
    }
    g.s.bag[pick] = null;
    return true;
  }
  return false;
}

/**
 * Is there room for one more of this thing? Tries sending a stack home first, as `give` would. False when the bag
 * and the chests are full: a thing on the ground then stays where it is instead of hopping in and out for ever.
 */
export function makeRoom(g: Game, id: string): boolean {
  const d = itemDef(g, id);
  if (inPouch(d)) return true;
  const max = d.stack ?? 99;
  for (const sl of g.s.bag) if (!sl || (sl.id === id && sl.n < max)) return true;
  return sendHome(g, id);
}

/** Take items away (bag first, then pouch). Returns true when she had enough; takes nothing otherwise. */
export function take(g: Game, id: string, n = 1): boolean {
  if (count(g, id) < n) return false;
  const bag = g.s.bag;
  for (let i = bag.length - 1; i >= 0 && n > 0; i--) {
    const sl = bag[i];
    if (sl && sl.id === id) {
      const t = Math.min(n, sl.n);
      sl.n -= t;
      n -= t;
      if (sl.n === 0) bag[i] = null;
    }
  }
  if (n > 0) {
    g.s.pouch[id] = (g.s.pouch[id] ?? 0) - n;
    if (g.s.pouch[id]! <= 0) delete g.s.pouch[id];
  }
  g.rt.questRev++;
  return true;
}

/** Best tier of a tool she owns, or 0. */
export function toolTier(g: Game, type: ToolType): number {
  // The sword and the bow are what she wears (phase 2, part D), not whatever is best in the pouch.
  if (type === 'sword' || type === 'bow' || type === 'helmet' || type === 'armour') {
    const id = g.s.gear[type];
    return id && (g.s.pouch[id] ?? 0) > 0 ? (g.c.items[id]?.tool?.tier ?? 0) : 0;
  }
  let best = 0;
  for (const id in g.s.pouch) {
    const t = g.c.items[id]?.tool;
    if (t && t.type === type && t.tier > best && g.s.pouch[id]! > 0) best = t.tier;
  }
  return best;
}
/** The item id of her best tool of a type, for the view to draw in her hand. */
export function bestTool(g: Game, type: ToolType): string | null {
  if (type === 'sword' || type === 'bow' || type === 'helmet' || type === 'armour') {
    const id = g.s.gear[type];
    return id && (g.s.pouch[id] ?? 0) > 0 ? id : null;
  }
  let best = 0;
  let id: string | null = null;
  for (const k in g.s.pouch) {
    const t = g.c.items[k]?.tool;
    if (t && t.type === type && t.tier > best && g.s.pouch[k]! > 0) {
      best = t.tier;
      id = k;
    }
  }
  return id;
}

/** Count including the chests at home, used when crafting on the plot or in the cottage. */
export function countWithChests(g: Game, id: string): number {
  let n = count(g, id);
  if (g.s.area === 'cottage' || atHome(g)) {
    for (const k in g.s.chests) for (const sl of g.s.chests[k]!) if (sl && sl.id === id) n += sl.n;
  }
  return n;
}
export function takeWithChests(g: Game, id: string, n: number): boolean {
  if (countWithChests(g, id) < n) return false;
  const have = Math.min(n, count(g, id));
  if (have > 0) take(g, id, have);
  n -= have;
  for (const k in g.s.chests) {
    const slots = g.s.chests[k]!;
    for (let i = 0; i < slots.length && n > 0; i++) {
      const sl = slots[i];
      if (sl && sl.id === id) {
        const t = Math.min(n, sl.n);
        sl.n -= t;
        n -= t;
        if (sl.n === 0) slots[i] = null;
      }
    }
  }
  return true;
}

/** Is the hero on her own plot? */
export function atHome(g: Game): boolean {
  if (g.s.area === 'cottage') return true;
  if (g.s.area !== 'island') return false;
  const p = g.c.areas.island!.places.plot;
  if (!p) return false;
  const r = plotRect(g);
  return g.s.x >= r.x - 2 && g.s.y >= r.y - 2 && g.s.x < r.x + r.w + 2 && g.s.y < r.y + r.h + 2;
}
export const PLOT_W = 26;
export const PLOT_H = 16;
export function plotRect(g: Game) {
  const p = g.c.areas.island!.places.plot!;
  return { x: p.x, y: p.y, w: PLOT_W, h: PLOT_H };
}
