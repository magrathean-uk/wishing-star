// Package 68 (D75): reach, by script. For every thing on the island and in every interior that Space uses (people,
// posts, benches, chests, signs, beds, shops, mini-game posts, things to play on) she stands on each walkable tile
// beside it, facing it, and Space must choose that thing. Every door must take her in when she walks into it.
// Package 69: trees, rocks, bushes and webs she can reach too, and every facing: facing away, Space takes this thing
// or another usable thing that is as near (never nothing); a tree may give way to a door that is as near.
// Run: node tests/reach.ts [--list] (plain Node, no browser; a few seconds). Prints REACH OK n/n or the misses.
import { rebuildArea } from '../src/core/grid.ts';
import { doorInto, findTarget, moveBody, WALK_SPEED } from '../src/core/hero.ts';
import { place } from '../src/core/quests.ts';
import { newGame } from '../src/core/state.ts';
import type { Content, Dir, Game, MapObj } from '../src/core/types.ts';
import { HALF } from '../src/core/walk.ts';
import { content } from '../src/data/content.ts';
import { free } from '../src/core/grid.ts';

/** walked over (any side, any facing): reach.test.ts covers those */
const WALK_OVER = new Set(['pickup', 'bottle', 'dig']);
const DIRS: Dir[] = ['down', 'up', 'left', 'right'];
const SIDES: [number, number, Dir][] = [
  [0, -1, 'down'],
  [0, 1, 'up'],
  [-1, 0, 'right'],
  [1, 0, 'left'],
];

/** Every object present at once (their `if` lifted), so each one is tried; nothing else in the way. */
function world(): { g: Game; c: Content } {
  const c = structuredClone(content) as Content;
  for (const a of Object.values(c.areas)) for (const o of a.objects) delete o.if;
  const g = newGame(c, { seed: 1, hero: 'amelia' });
  g.rt.mode = 'play';
  g.rt.talk = null;
  g.rt.mobs.length = 0;
  g.rt.npcs.length = 0;
  g.rt.beasts.length = 0;
  for (const id in c.areas) rebuildArea(g, id);
  // the best tool of every kind, worn and in the pouch, so every tree, rock and bush can be used
  const best: Record<string, [string, number]> = {};
  for (const [id, d] of Object.entries(c.items))
    if (d.tool && (!best[d.tool.type] || d.tool.tier > best[d.tool.type]![1])) best[d.tool.type] = [id, d.tool.tier];
  for (const [type, [id]] of Object.entries(best)) {
    g.s.pouch[id] = 1;
    if (type in g.s.gear || type === 'sword' || type === 'bow') (g.s.gear as Record<string, string>)[type] = id;
  }
  return { g, c };
}

interface Miss {
  what: string;
  at: string;
  got: string;
}

function standBeside(
  g: Game,
  area: string,
  x: number,
  y: number,
  w: number,
  h: number,
  ok: (facing: boolean) => boolean,
  what: string,
  miss: Miss[],
): number {
  let n = 0;
  const s = g.s;
  s.area = area;
  for (const [sx, sy, toward] of SIDES)
    for (let i = 0; i < (sx ? h : w); i++) {
      const tx = sx < 0 ? x - 1 : sx > 0 ? x + w : x + i;
      const ty = sy < 0 ? y - 1 : sy > 0 ? y + h : y + i;
      if (!free(g, area, tx + 0.5, ty + 0.5, HALF)) continue;
      for (const dir of DIRS) {
        s.x = tx + 0.5;
        s.y = ty + 0.5;
        s.dir = dir;
        n++;
        if (!ok(dir === toward)) {
          const t = findTarget(g);
          miss.push({
            what,
            at: `${area} ${tx},${ty} facing ${dir}`,
            got: `${t.kind}${t.obj ? ' ' + t.obj.type : ''}${t.placed ? ' ' + t.placed.item : ''}`,
          });
        }
      }
    }
  return n;
}

export function reachAll(): { tried: number; miss: Miss[]; things: number } {
  const { g, c } = world();
  const miss: Miss[] = [];
  let tried = 0;
  let things = 0;
  for (const area in c.areas) {
    const a = c.areas[area]!;
    for (const o of a.objects) {
      const t = c.objects[o.type];
      if (!t) continue;
      // trees, rocks, bushes, webs (package 69); a flower or a shell is walked over
      const node = !!t.node && !t.interact && !!t.node.tool;
      if (!node && (!t.interact || WALK_OVER.has(t.interact))) continue;
      // a web hung high is for the bow
      if (t.node?.tool === 'bow') continue;
      things++;
      const me = (x: MapObj) => x === o || (x.x === o.x && x.y === o.y && x.type === o.type);
      tried += standBeside(
        g,
        area,
        o.x,
        o.y,
        t.w ?? 1,
        t.h ?? 1,
        (facing) => {
          const r = findTarget(g);
          if (!facing && !(r.obj && me(r.obj))) return asNear(g, o.x, o.y, t.w ?? 1, t.h ?? 1, node);
          if (r.kind !== 'obj' || !r.obj) return false;
          // a find in reach goes first at a tree, a rock or a bush (never a tree by accident when a find is as near)
          if (node && WALK_OVER.has(r.type?.interact ?? '')) return true;
          // a find lying on the thing itself (the gift in the fairy ring) is picked up first; then Space does the thing
          const inside =
            WALK_OVER.has(r.type?.interact ?? '') &&
            r.obj.x >= o.x &&
            r.obj.y >= o.y &&
            r.obj.x < o.x + (t.w ?? 1) &&
            r.obj.y < o.y + (t.h ?? 1);
          return me(r.obj) || inside;
        },
        `${o.type} ${o.id}`,
        miss,
      );
    }
    // things she puts down (the bed, the chest and the bench in a new game's cottage)
    for (const p of g.s.placed) {
      if (p.area !== area) continue;
      const def = c.items[p.item]?.place;
      if (!def?.use || ['fence', 'seat', 'toy', 'soil'].includes(def.use)) continue;
      things++;
      tried += standBeside(
        g,
        area,
        p.x,
        p.y,
        def.w ?? 1,
        def.h ?? 1,
        (facing) => findTarget(g).placed === p || (!facing && asNear(g, p.x, p.y, def.w ?? 1, def.h ?? 1, false)),
        `placed ${p.item}`,
        miss,
      );
    }
  }
  // people: each character standing at each of their spots, still
  const k = 9000;
  const seen = new Set<string>();
  for (const ch of Object.values(c.chars))
    for (const spot of ch.spots) {
      const pl = place(g, spot.at);
      if (!pl || !c.areas[pl.area] || seen.has(`${ch.id}:${spot.at}`)) continue;
      seen.add(`${ch.id}:${spot.at}`);
      tried += person(g, ch.id, pl.area, pl.x, pl.y, k, miss);
      things++;
    }
  g.rt.npcs.length = 0;
  // doors: from the tile before it, walking into it for half a second takes her through
  for (const area in c.areas) {
    for (const d of c.areas[area]!.doors) {
      things++;
      tried++;
      through(g, area, d);
      if (g.s.area === area) miss.push({ what: `door to ${d.to}`, at: `${area} ${d.x},${d.y}`, got: 'stayed' });
      else if (g.s.area !== d.to) miss.push({ what: `door to ${d.to}`, at: `${area} ${d.x},${d.y}`, got: g.s.area });
    }
  }
  // package 72: every door has its way back. From where a door lands her, the nearest door of that room back to where
  // she came from must take her back, out beside the door she went in by
  for (const area in c.areas)
    for (const d of c.areas[area]!.doors) {
      things++;
      tried++;
      const near = (q: { x: number; y: number }) => (q.x - d.tx) ** 2 + (q.y - d.ty) ** 2;
      const q = c.areas[d.to]!.doors.filter((x) => x.to === area).sort((a, b) => near(a) - near(b))[0];
      if (!q) {
        miss.push({ what: `way back from ${d.to}`, at: `${area} ${d.x},${d.y}`, got: 'no door back' });
        continue;
      }
      through(g, d.to, q);
      if (g.s.area !== area) miss.push({ what: `way back from ${d.to}`, at: `${d.to} ${q.x},${q.y}`, got: g.s.area });
      else if (Math.abs(Math.floor(g.s.x) - d.x) > 1 || Math.abs(Math.floor(g.s.y) - d.y) > 2)
        miss.push({
          what: `way back from ${d.to}`,
          at: `${area} ${d.x},${d.y}`,
          got: `came out at ${Math.floor(g.s.x)},${Math.floor(g.s.y)}`,
        });
    }
  return { tried, miss, things };
}

/** From the tile before a door, she walks into it for half a second (every flag set). */
function through(g: Game, area: string, d: Game['c']['areas'][string]['doors'][number]): void {
  // the way in, or (a door with no clear way in) any side she can stand on
  const ways: [number, number][] = doorInto(g, area, d)
    ? [doorInto(g, area, d)!]
    : SIDES.map(([x, y]) => [-x, -y] as [number, number]).filter(([x, y]) =>
        free(g, area, d.x - x + 0.5, d.y - y + 0.5, HALF),
      );
  const was = g.s.flags;
  g.s.flags = new Proxy(was, { get: (t, p) => (typeof p === 'string' ? 1 : Reflect.get(t, p)) });
  for (const into of ways) {
    g.s.area = area;
    g.s.x = d.x - into[0] + 0.5;
    g.s.y = d.y - into[1] + 0.5;
    for (let f = 0; f < 30 && g.s.area === area; f++)
      moveBody(g, (into[0] * WALK_SPEED) / 60, (into[1] * WALK_SPEED) / 60);
    if (g.s.area !== area) break;
  }
  g.s.flags = was;
}

/** Nearest point of a rectangle, squared, from her. */
function near2(g: Game, x: number, y: number, w: number, h: number): number {
  const nx = Math.max(x, Math.min(g.s.x, x + w));
  const ny = Math.max(y, Math.min(g.s.y, y + h));
  return (nx - g.s.x) ** 2 + (ny - g.s.y) ** 2;
}
/**
 * Facing away from a thing, Space took something else: right when that is a thing as near as this one or straight
 * ahead (a person, a find, a thing she faces), or nothing when this is a tree and a door is as near.
 */
function asNear(g: Game, x: number, y: number, w: number, h: number, node: boolean): boolean {
  const r = findTarget(g);
  const d = near2(g, x, y, w, h) + 0.02;
  if (r.kind === 'npc' || r.kind === 'animal') return true;
  if (r.kind === 'obj' && r.obj) {
    const t = g.c.objects[r.obj.type]!;
    // a find lying in reach hops into the bag first (it would by itself as she walks)
    if (t.interact && WALK_OVER.has(t.interact)) return true;
    return !r.beside || near2(g, r.obj.x, r.obj.y, t.w ?? 1, t.h ?? 1) <= d;
  }
  if (r.kind === 'placed' || r.kind === 'site' || r.kind === 'water' || r.kind === 'sand' || r.kind === 'crop')
    return true;
  if (node) for (const dr of g.c.areas[g.s.area]!.doors) if (near2(g, dr.x, dr.y, 1, 1) <= d) return true;
  return false;
}

function person(g: Game, id: string, area: string, px: number, py: number, k: number, miss: Miss[]): number {
  {
    const sp = { char: id, area, x: px, y: py };
    const n = {
      k,
      id: sp.char,
      kind: 'npc',
      area: sp.area,
      x: sp.x + 0.5,
      y: sp.y + 0.5,
      px: sp.x + 0.5,
      py: sp.y + 0.5,
      dir: 'down',
      clip: 'idle',
      ct: 0,
      hx: sp.x,
      hy: sp.y,
      roam: 0,
      path: null,
      pi: 0,
      wait: 99,
      mark: 0,
      talkT: 0,
    } as unknown as Game['rt']['npcs'][number];
    g.rt.npcs.length = 0;
    g.rt.npcs.push(n);
    return standBeside(
      g,
      sp.area,
      sp.x,
      sp.y,
      1,
      1,
      (facing) => {
        const r = findTarget(g);
        return (r.kind === 'npc' && r.k === k) || (!facing && asNear(g, sp.x, sp.y, 1, 1, false));
      },
      `person ${sp.char}`,
      miss,
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = reachAll();
  const list = process.argv.includes('--list');
  for (const m of r.miss.slice(0, list ? 9999 : 40)) console.log(`  MISS ${m.what} at ${m.at}: got ${m.got}`);
  const ok = r.miss.length === 0;
  console.log(`${ok ? 'REACH OK' : 'REACH FAIL'} ${r.tried - r.miss.length}/${r.tried} (${r.things} things)`);
  process.exit(ok ? 0 : 1);
}
