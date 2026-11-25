// The find sparkle (design section 6): a sparkle shows when a find she is still missing is within 10 tiles.
// A find is a chest, dig spot or pick-up in her area that gives a sticker she has not got yet.
import { test } from './cond.ts';
import type { Game, MapObj } from './types.ts';

export const SPARKLE_TILES = 10;
const FINDS = new Set(['chest', 'dig', 'pickup']);

/** The stickers an object's loot gives (its d field, "sticker.id:1,emerald:3"). */
export function lootStickers(d: string | undefined): string[] {
  if (!d) return [];
  return d
    .split(',')
    .map((p) => p.split(':')[0]!.trim())
    .filter((id) => id.startsWith('sticker.'))
    .map((id) => id.slice(8));
}

/** The nearest missing find within `r` tiles of her, or null. Also sets rt.nearSecret for the view. */
export function nearFind(g: Game, r = SPARKLE_TILES): MapObj | null {
  const s = g.s;
  const area = g.c.areas[s.area];
  let best: MapObj | null = null;
  let bestD = r * r;
  for (const o of area?.objects ?? []) {
    const t = g.c.objects[o.type];
    if (!t?.interact || !FINDS.has(t.interact) || s.taken[o.id]) continue;
    const ids = lootStickers(o.d);
    if (!ids.length || ids.every((id) => s.stickers[id])) continue;
    const d = (o.x + 0.5 - s.x) ** 2 + (o.y + 0.5 - s.y) ** 2;
    if (d > bestD || (o.if && !test(g, o.if))) continue;
    best = o;
    bestD = d;
  }
  g.rt.nearSecret = !!best;
  return best;
}
