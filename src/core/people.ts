// Package 67: the friendly people are solid, indoors and out. She slides round a person like round a post; a person
// who stands in her way steps aside after half a second. A person never blocks a door or a one-tile lane: there,
// or when they have nowhere to step to, she passes through as before. Pure and deterministic.
import { free, solidAt } from './grid.ts';
import type { Game, Npc } from './types.ts';
import { HALF } from './walk.ts';

/** Half the width of a person's body, in tiles. */
export const BODY = 0.3;
/** How close her middle may come to a person's middle. */
export const REACH_BODY = BODY + HALF;
/** Seconds of pressing into someone before they step aside. */
export const ASIDE_AFTER = 0.5;

/** A tile on a door or beside one (where people never block the way in or out). */
function byDoor(g: Game, area: string, tx: number, ty: number): boolean {
  for (const d of g.c.areas[area]!.doors) if (Math.abs(d.x - tx) <= 1 && Math.abs(d.y - ty) <= 1) return true;
  return false;
}

/** A person here would close the way: on or by a door, or in a lane one tile wide. */
export function narrowAt(g: Game, area: string, tx: number, ty: number): boolean {
  if (byDoor(g, area, tx, ty)) return true;
  if (solidAt(g, area, tx - 1, ty) && solidAt(g, area, tx + 1, ty)) return true;
  if (solidAt(g, area, tx, ty - 1) && solidAt(g, area, tx, ty + 1)) return true;
  return false;
}

/**
 * After she moved from (ox, oy) by (dx, dy): keep her out of every solid person, as bossBlock does for a boss. A
 * step that does not take her closer is always allowed, so she can never be caught inside one.
 */
export function personBlock(g: Game, ox: number, oy: number, dx: number, dy: number): void {
  const s = g.s;
  const want = Math.hypot(dx, dy);
  for (const n of g.rt.npcs) {
    if (n.area !== s.area || n.hidden || n.pass) continue;
    const ex = s.x - n.x;
    const ey = s.y - n.y;
    const d = Math.hypot(ex, ey);
    if (d >= REACH_BODY) continue;
    const was = Math.hypot(ox - n.x, oy - n.y);
    if (d >= was) continue;
    // already well inside them (she came in through a door onto them, or they stepped onto her): let her through
    if (was < REACH_BODY * 0.6 || narrowAt(g, s.area, Math.floor(n.x), Math.floor(n.y))) {
      n.pass = true;
      continue;
    }
    const keep = Math.min(REACH_BODY, was);
    const nx = d > 1e-4 ? n.x + (ex / d) * keep : ox;
    const ny = d > 1e-4 ? n.y + (ey / d) * keep : oy;
    if (free(g, s.area, nx, ny, HALF)) {
      s.x = nx;
      s.y = ny;
    } else {
      s.x = ox;
      s.y = oy;
    }
    // she is held up (not just sliding round them): count, and after half a second they step aside
    if (Math.hypot(s.x - ox, s.y - oy) < want * 0.5) {
      n.push = (n.push ?? 0) + 1 / 60;
      if (n.push >= ASIDE_AFTER - 1e-9) stepAside(g, n, dx, dy);
    }
  }
}

/**
 * Move a person one tile out of her way, to the side across her walk (the side she is not on first). A tile they
 * go to is open, not by a door, clear of her and of anyone else. Nowhere to go: she may pass through them.
 */
export function stepAside(g: Game, n: Npc, dx: number, dy: number): void {
  const s = g.s;
  const tx = Math.floor(n.x);
  const ty = Math.floor(n.y);
  const across = Math.abs(dx) >= Math.abs(dy);
  // the side away from her first; when she is dead centre, the lower or right side first
  const off = across ? s.y - n.y : s.x - n.x;
  const first = off > 0 ? -1 : 1;
  n.push = 0;
  // a character drawn only standing (no walk pictures) has nowhere to step: she passes, as when they are hemmed in
  if (g.c.chars[n.id]?.role === 'fixed') {
    n.pass = true;
    return;
  }
  for (const sd of [first, -first]) {
    const cx = across ? tx : tx + sd;
    const cy = across ? ty + sd : ty;
    if (solidAt(g, s.area, cx, cy) || narrowAt(g, s.area, cx, cy)) continue;
    if (!free(g, s.area, cx + 0.5, cy + 0.5, BODY)) continue;
    if (Math.hypot(cx + 0.5 - s.x, cy + 0.5 - s.y) < REACH_BODY + 0.05) continue;
    let taken = false;
    for (const o of g.rt.npcs)
      if (o !== n && o.area === n.area && Math.hypot(o.x - cx - 0.5, o.y - cy - 0.5) < 0.8) taken = true;
    if (taken) continue;
    n.path = [cx, cy];
    n.pi = 0;
    n.aside = 1.5;
    n.talkT = 0;
    return;
  }
  n.pass = true;
}

/** Each frame for each person (stepNpcs): forget a push she gave up, and close them again once she is clear. */
export function tickPerson(n: Npc, d2: number): void {
  if (n.aside && n.aside > 0) n.aside = Math.max(0, n.aside - 1 / 60);
  if (d2 > (REACH_BODY + 0.4) ** 2) {
    n.push = 0;
    if (n.pass) n.pass = false;
  }
}
