// Fishing: Space to cast, wait for the float to dip, Space again. It can never go wrong, only "it got away".
import { give } from './bag.ts';
import { isNight, rand } from './cond.ts';
import { TERRAIN, terrainAt } from './grid.ts';
import { setClip } from './hero.ts';
import { questEvent } from './quests.ts';
import type { Game } from './types.ts';

export function startFishing(g: Game, tx: number, ty: number): void {
  const a = g.c.areas[g.s.area]!;
  const water = TERRAIN[terrainAt(a, tx, ty)]?.water;
  if (!water) return;
  const night = isNight(g);
  let total = 0;
  const pool: [string, number][] = [];
  for (const id in g.c.fish) {
    const f = g.c.fish[id]!;
    if (!f.water.includes(water)) continue;
    if (f.time === 'day' && night) continue;
    if (f.time === 'night' && !night) continue;
    // A kind she has never caught is a little more likely, so the page fills up.
    const w = f.weight * (g.s.stickers[id] ? 1 : 1.8);
    pool.push([id, w]);
    total += w;
  }
  let pickId: string | null = null;
  let r = rand(g) * total;
  for (const [id, w] of pool) {
    r -= w;
    if (r <= 0) {
      pickId = id;
      break;
    }
  }
  g.rt.fish = { st: 0, t: 0.5, fx: tx + 0.5, fy: ty + 0.5, fish: pickId ?? pool[0]?.[0] ?? null };
  g.rt.mode = 'fishing';
  setClip(g, 'fish');
  g.ev.push({ t: 'sfx', id: 'cast' });
}

export function stepFishing(g: Game, act: boolean, back: boolean, moved: boolean): void {
  const f = g.rt.fish;
  if (!f) {
    g.rt.mode = 'play';
    return;
  }
  g.rt.ct += 1 / 60;
  f.t -= 1 / 60;
  const stop = () => {
    g.rt.fish = null;
    g.rt.mode = 'play';
    setClip(g, 'idle');
  };
  if (back || (moved && f.st < 2)) {
    stop();
    return;
  }
  switch (f.st) {
    case 0:
      if (f.t <= 0) {
        f.st = 1;
        f.t = 1.3 + rand(g) * 2.4;
        g.ev.push({ t: 'sfx', id: 'plop' });
        g.ev.push({ t: 'fx', id: 'ripple', x: f.fx, y: f.fy });
      }
      return;
    case 1:
      if (act) {
        // Too early: nothing lost, the float just settles again.
        f.t = Math.max(f.t, 0.8);
        g.ev.push({ t: 'fx', id: 'ripple', x: f.fx, y: f.fy });
        return;
      }
      if (f.t <= 0) {
        f.st = 2;
        f.t = g.s.opts.gentle ? 1.9 : 1.3;
        g.ev.push({ t: 'sfx', id: 'bite' });
        g.ev.push({ t: 'fx', id: 'bite', x: f.fx, y: f.fy });
      }
      return;
    case 2:
      if (act && f.fish) {
        f.st = 3;
        f.t = 0.9;
        give(g, f.fish, 1);
        g.ev.push({ t: 'sfx', id: 'catch' });
        g.ev.push({ t: 'fx', id: 'pop', x: f.fx, y: f.fy, item: f.fish, n: 1 });
        g.ev.push({ t: 'act', kind: 'fish', id: f.fish });
        g.s.counts.fish = (g.s.counts.fish ?? 0) + 1;
        questEvent(g, 'fish', f.fish);
        return;
      }
      if (f.t <= 0) {
        f.st = 4;
        f.t = 1.1;
        g.ev.push({ t: 'toast', kind: 'info', text: 'fish_away' });
      }
      return;
    default:
      if (f.t <= 0) stop();
  }
}
