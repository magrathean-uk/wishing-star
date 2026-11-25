// Package 74 (D79, idea I11): the tidy bag. One key sorts the bag's own rows (never the bottom buttons): tools and
// weapons, food, seeds, building bits, treasures, the rest, each group by name, the same things stacked. A thing on a
// bottom button can be pinned there: tidying, picking up and "put on a button" from elsewhere never move it. A pin is
// a counts key (`pin:<button>:<thing>`), so pins last across a reload with no change to the save's shape.
import { BAG_SLOTS, HOTBAR, itemDef } from './bag.ts';
import type { Game, ItemDef, Slot } from './types.ts';

const pinKey = (i: number, id: string) => `pin:${i}:${id}`;

/** Is the thing on bottom button i pinned there? */
export function pinned(g: Game, i: number): boolean {
  const sl = g.s.bag[i];
  return i >= 0 && i < HOTBAR && !!sl && g.s.counts[pinKey(i, sl.id)] === 1;
}

/** Pin the thing on bottom button i, or unpin it. A button holds one pin; nothing there, nothing happens. */
export function pinSlot(g: Game, i: number): void {
  const sl = g.s.bag[i];
  if (i < 0 || i >= HOTBAR || !sl) return;
  const was = pinned(g, i);
  for (const k of Object.keys(g.s.counts)) if (k.startsWith(`pin:${i}:`)) delete g.s.counts[k];
  if (!was) g.s.counts[pinKey(i, sl.id)] = 1;
  g.ev.push({ t: 'sfx', id: was ? 'close' : 'equip' });
}

/** May a thing move from bag slot `from` to `to`? Never a pinned thing, nor onto one (topping up its stack is fine). */
export function moveAllowed(g: Game, from: number, to: number): boolean {
  if (pinned(g, from)) return false;
  if (!pinned(g, to)) return true;
  const a = g.s.bag[from];
  return !!a && a.id === g.s.bag[to]!.id;
}

/** The tidy groups, in order: 0 tools and weapons, 1 food, 2 seeds, 3 building bits, 4 treasures, 5 the rest. */
export function tidyGroup(d: ItemDef): number {
  if (d.kind === 'tool' || d.tool || d.shield) return 0;
  if (d.kind === 'food' || d.heal) return 1;
  if (d.kind === 'seed' || d.grows) return 2;
  if (d.kind === 'material' || d.kind === 'block' || d.kind === 'furniture') return 3;
  if (d.kind === 'find' || d.kind === 'toy' || d.kind === 'disc' || d.kind === 'gift' || d.kind === 'key') return 4;
  return 5;
}

/** Sort the bag's own rows: grouped, by name, stacked full. The bottom buttons stay; their stacks are topped up. */
export function tidyBag(g: Game): void {
  const bag = g.s.bag;
  const end = Math.min(bag.length, BAG_SLOTS);
  const totals = new Map<string, number>();
  for (let i = HOTBAR; i < end; i++) {
    const sl = bag[i];
    if (sl && sl.n > 0) totals.set(sl.id, (totals.get(sl.id) ?? 0) + sl.n);
    bag[i] = null;
  }
  // the same thing on a bottom button takes what fits (it does not move)
  for (let i = 0; i < HOTBAR; i++) {
    const sl = bag[i];
    const n = sl ? totals.get(sl.id) : undefined;
    if (!sl || !n) continue;
    const t = Math.min(n, (itemDef(g, sl.id).stack ?? 99) - sl.n);
    if (t <= 0) continue;
    sl.n += t;
    totals.set(sl.id, n - t);
  }
  const ids = [...totals.keys()].filter((id) => totals.get(id)! > 0);
  const name = (id: string) => (g.c.items[id]?.name ?? id).toLowerCase();
  ids.sort((a, b) => {
    const ga = g.c.items[a] ? tidyGroup(g.c.items[a]!) : 6;
    const gb = g.c.items[b] ? tidyGroup(g.c.items[b]!) : 6;
    return ga - gb || (name(a) < name(b) ? -1 : name(a) > name(b) ? 1 : a < b ? -1 : a > b ? 1 : 0);
  });
  let at = HOTBAR;
  for (const id of ids) {
    let n = totals.get(id)!;
    const max = itemDef(g, id).stack ?? 99;
    while (n > 0 && at < end) {
      const put: Slot = { id, n: Math.min(n, max) };
      bag[at++] = put;
      n -= put.n;
    }
  }
  g.ev.push({ t: 'sfx', id: 'place' });
}
