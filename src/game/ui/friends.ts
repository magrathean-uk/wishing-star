// Who she has met: the one place the view reads it from (the journal's Friends page and the finale's photo picker).
import type { Game } from '../../core/types.ts';

/** Everyone she has met, in the order she met them. It reads the met record in the save (g.s.met). */
export function metIds(g: Game): string[] {
  const met = g.s.met ?? {};
  const order = Object.keys(g.c.chars);
  return Object.keys(met)
    .filter((id) => g.c.chars[id])
    .sort((a, b) => met[a]! - met[b]! || order.indexOf(a) - order.indexOf(b));
}
