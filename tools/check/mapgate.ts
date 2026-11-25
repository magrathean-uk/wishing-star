// Map gate check: a flood fill over the whole island (doors included) proving each region opens only through its gate.
// Run: node tools/check/mapgate.ts
import { test } from '../../src/core/cond.ts';
import { rebuildAll } from '../../src/core/grid.ts';
import { newGame } from '../../src/core/state.ts';
import type { Content, Game } from '../../src/core/types.ts';
import { content as realContent } from '../../src/data/content.ts';

const START = 'cottage_door';

interface Reach {
  seen: Record<string, Uint8Array>;
  regions: Set<string>;
  areas: Set<string>;
}

function findPlace(g: Game, name: string) {
  for (const id in g.c.areas) {
    const p = g.c.areas[id]!.places[name];
    if (p) return p;
  }
  return null;
}

/** Flood from the start through doors that are open right now. Tool nodes always block (a hero with no tools). */
function reach(g: Game): Reach {
  rebuildAll(g);
  // Every live node that needs a tool is solid for this check.
  const solid: Record<string, Uint8Array> = {};
  for (const id in g.c.areas) {
    const a = g.c.areas[id]!;
    const s = Uint8Array.from(g.rt.solid[id]!);
    for (let i = 0; i < a.objects.length; i++) {
      const o = a.objects[i]!;
      const t = g.c.objects[o.type];
      if (!t?.node?.tool || !g.rt.live[id]![i]) continue;
      for (let dy = 0; dy < (t.h ?? 1); dy++)
        for (let dx = 0; dx < (t.w ?? 1); dx++) {
          const x = o.x + dx;
          const y = o.y + dy;
          if (x >= 0 && y >= 0 && x < a.w && y < a.h) s[y * a.w + x] = 1;
        }
    }
    solid[id] = s;
  }
  const seen: Record<string, Uint8Array> = {};
  for (const id in g.c.areas) seen[id] = new Uint8Array(g.c.areas[id]!.w * g.c.areas[id]!.h);
  const start = findPlace(g, START);
  const stack: [string, number, number][] = [];
  const push = (area: string, x: number, y: number) => {
    const a = g.c.areas[area]!;
    if (x < 0 || y < 0 || x >= a.w || y >= a.h) return;
    const k = y * a.w + x;
    if (seen[area]![k] || solid[area]![k]) return;
    seen[area]![k] = 1;
    stack.push([area, x, y]);
  };
  if (start) push(start.area, start.x, start.y);
  const doorsDone = new Set<string>();
  for (;;) {
    while (stack.length) {
      const [area, x, y] = stack.pop()!;
      push(area, x + 1, y);
      push(area, x - 1, y);
      push(area, x, y + 1);
      push(area, x, y - 1);
    }
    // doors whose tile (or a neighbour, when the door tile is solid) was reached
    let more = false;
    for (const id in g.c.areas) {
      const a = g.c.areas[id]!;
      a.doors.forEach((d, i) => {
        const key = `${id}#${i}`;
        if (doorsDone.has(key)) return;
        if (d.if && !test(g, d.if)) return;
        const at = (x: number, y: number) => x >= 0 && y >= 0 && x < a.w && y < a.h && seen[id]![y * a.w + x] === 1;
        if (!(at(d.x, d.y) || at(d.x + 1, d.y) || at(d.x - 1, d.y) || at(d.x, d.y + 1) || at(d.x, d.y - 1))) return;
        doorsDone.add(key);
        const to = g.c.areas[d.to];
        if (to) {
          push(d.to, d.tx, d.ty);
          more = true;
        }
      });
    }
    if (!more && !stack.length) break;
  }
  const regions = new Set<string>();
  const areas = new Set<string>();
  for (const id in g.c.areas) {
    const a = g.c.areas[id]!;
    for (let y = 0; y < a.h; y++)
      for (let x = 0; x < a.w; x++)
        if (seen[id]![y * a.w + x]) {
          areas.add(id);
          if (id === 'island') regions.add(a.region[y]!.charAt(x));
        }
  }
  return { seen, regions, areas };
}

const codeOf = (c: Content, id: string) => c.regions[id]!.code;

export function mapGates(c: Content = realContent): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  const bad = (m: string) => problems.push(m);
  const g = newGame(c);
  const island = c.areas.island;
  if (!island) return { ok: false, problems: ['no island area'] };
  if (!findPlace(g, START)) return { ok: false, problems: [`no place "${START}"`] };

  // 1. everything closed
  let r = reach(g);
  const base = ['H', 'W', 'S', 'U'];
  const none = ['B', 'P', 'V', 'G', 'L', 'F', 'C', 'T'];
  for (const code of base) if (!r.regions.has(code)) bad(`closed: region ${code} not reached from ${START}`);
  for (const code of none) if (r.regions.has(code)) bad(`closed: region ${code} reached with every gate closed`);
  for (const code of r.regions)
    if (!base.includes(code) && !none.includes(code)) bad(`closed: unexpected region code "${code}" reached`);
  for (const a of ['mine1', 'mine2', 'mine3', 'hall'])
    if (r.areas.has(a)) bad(`closed: area ${a} reached with every gate closed`);

  // 2. gates in order
  type Gate = { name: string; open: (g: Game) => void; regions?: string[]; areas?: string[] };
  const taken = (type: string, prefix?: string) => (g: Game) => {
    for (const o of island.objects) if (o.type === type && (!prefix || o.id.startsWith(prefix))) g.s.taken[o.id] = 1;
  };
  const gates: Gate[] = [
    { name: 'west bridge thorn bushes', open: taken('thorn_bush', 'bridge_bush_'), regions: ['B'] },
    { name: 'flag site_north_bridge', open: (g) => void (g.s.flags.site_north_bridge = 1), regions: ['P'] },
    { name: 'wellies', open: (g) => void (g.s.pouch.wellies = 1), regions: ['V'] },
    { name: 'fallen_gum taken', open: taken('fallen_gum'), regions: ['G'] },
    { name: 'flag site_east_bridge', open: (g) => void (g.s.flags.site_east_bridge = 1), regions: ['L', 'F'] },
    { name: 'flag site_mine_torches', open: (g) => void (g.s.flags.site_mine_torches = 1), areas: ['mine1', 'mine2'] },
    { name: 'boulder_wall taken', open: taken('boulder_wall'), regions: ['C'] },
    { name: 'flag hall_open', open: (g) => void (g.s.flags.hall_open = 1), areas: ['hall'] },
  ];
  if (!island.objects.some((o) => o.id.startsWith('bridge_bush_'))) bad('gate: no objects named bridge_bush_*');
  const gate = newGame(c);
  const known = new Set(base);
  const knownAreas = new Set<string>();
  for (const gt of gates) {
    // closed: everything before open, this one not
    r = reach(gate);
    for (const code of gt.regions ?? [])
      if (r.regions.has(code)) bad(`gate "${gt.name}" closed: region ${code} already reached`);
    for (const a of gt.areas ?? []) if (r.areas.has(a)) bad(`gate "${gt.name}" closed: area ${a} already reached`);
    gt.open(gate);
    r = reach(gate);
    for (const code of gt.regions ?? []) {
      if (!r.regions.has(code)) bad(`gate "${gt.name}" open: region ${code} still not reached`);
      known.add(code);
    }
    for (const a of gt.areas ?? []) {
      if (!r.areas.has(a)) bad(`gate "${gt.name}" open: area ${a} still not reached`);
      knownAreas.add(a);
    }
    // nothing beyond what has been opened so far may be reached
    for (const code of r.regions) if (!known.has(code)) bad(`gate "${gt.name}" open: region ${code} reached too early`);
    // a house room whose doors all lead to the island opens with the region its door stands in (checked above)
    // package 72: or a building of several rooms (the lighthouse's three floors) that leads only out to the island
    const room = (a: string) => {
      const seen = new Set([a]);
      const todo = [a];
      let out = false;
      while (todo.length)
        for (const d of c.areas[todo.pop()!]!.doors) {
          if (d.to === 'island') out = true;
          else if (!c.areas[d.to]!.indoor || c.areas[d.to]!.dark || d.to === 'hall' || d.to === 'cottage') return false;
          else if (!seen.has(d.to)) seen.add(d.to) && todo.push(d.to);
        }
      return out;
    };
    for (const a of r.areas)
      if (a !== 'island' && a !== 'cottage' && a !== 'cave' && !room(a) && !knownAreas.has(a))
        bad(`gate "${gt.name}" open: area ${a} reached too early`);
  }
  if (r.regions.has('T')) bad('Treasure Island (T) is reachable on foot');
  void codeOf;

  // 3. everything open: places, signposts, sites, marks
  const open = newGame(c);
  for (const gt of gates) gt.open(open);
  open.s.flags.cart_done = 1; // the minecart ride opens the deepest mine
  // package 44a: the ways through the wild stretches (webs cut or shot down, the old bridge at the ford mended)
  taken('web_wall')(open);
  taken('web_high')(open);
  open.s.flags.site_ford_bridge = 1;
  // package 47a: thorn bushes cut, rock falls mined, the stretch bridges mended (the creek bush, the quarry cave)
  taken('thorn_bush')(open);
  taken('rock_fall')(open);
  open.s.flags.site_bush_bridge = 1;
  open.s.flags.site_cave_bridge = 1;
  // package 47b: the island projects that change the ground (built)
  for (const id of ['footbridge', 'jetty', 'raft', 'cove']) open.s.flags['site_' + id] = 1;
  // package 72: the projects whose building has a room (the treehouse, the hill lookout, the windmill)
  for (const id of ['treehouse', 'beacon', 'mill']) open.s.flags['site_' + id] = 1;
  r = reach(open);
  const hit = (area: string, x: number, y: number) => {
    const a = c.areas[area]!;
    return x >= 0 && y >= 0 && x < a.w && y < a.h && r.seen[area]![Math.floor(y) * a.w + Math.floor(x)] === 1;
  };
  const near = (area: string, x: number, y: number) => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (hit(area, x + dx, y + dy)) return true;
    return false;
  };
  // Treasure Island is reached by the boat objects only; there are no cutscene-only places.
  const stage = new Set<string>(['treasure_landing', 'forky_found']);
  for (const a of Object.values(c.areas))
    for (const [name, p] of Object.entries(a.places)) {
      if (stage.has(name)) continue;
      if (!hit(p.area, p.x, p.y) && !near(p.area, p.x, p.y))
        bad(`place "${name}" (${p.area} ${p.x},${p.y}) is not reachable`);
    }
  for (const a of Object.values(c.areas))
    for (const s of a.sites)
      if (!hit(a.id, s.at.x, s.at.y) && !near(a.id, s.at.x, s.at.y))
        bad(`site "${s.id}" hand-over point (${a.id} ${s.at.x},${s.at.y}) is not reachable`);
  for (const rg of Object.values(c.regions))
    if (rg.sign) {
      const p = findPlace(open, `sign_${rg.sign}`);
      if (!p) bad(`signpost place "sign_${rg.sign}" is missing`);
      else if (!hit(p.area, p.x, p.y) && !near(p.area, p.x, p.y))
        bad(`signpost place "sign_${rg.sign}" (${p.area} ${p.x},${p.y}) is not reachable`);
    }
  for (const q of Object.values(c.quests))
    q.steps.forEach((s, i) => {
      for (const name of [s.mark, 'place' in s ? (s as { place?: string }).place : undefined]) {
        // Treasure Island's places are reached by boat (see `stage` above)
        if (!name || stage.has(name)) continue;
        const p = findPlace(open, name);
        if (p && !hit(p.area, p.x, p.y) && !near(p.area, p.x, p.y))
          bad(`quest ${q.id} step ${i}: place "${name}" (${p.area} ${p.x},${p.y}) is not reachable`);
      }
    });
  return { ok: problems.length === 0, problems };
}

if (import.meta.main) {
  const r = mapGates();
  if (r.problems.length) {
    console.log('map gate problems');
    for (const p of r.problems) console.log(`  ${p}`);
    console.log(`\n${r.problems.length} problem(s)`);
    process.exit(1);
  }
  console.log('MAP GATES OK');
}
