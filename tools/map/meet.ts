// The meeting meadow (package 66): a small sunny field with a clubhouse front where up to 11 players meet and play.
// It is not part of the story world: it is written to src/data/map/meet.json on its own. The tile coordinates below
// are a contract with the server, so change them only together with it.
import { hash2 } from '../../src/core/cond.ts';
import { TERRAIN } from '../../src/core/grid.ts';
import { objects } from '../../src/data/objects.ts';
import { MapMaker } from './lib.ts';

export const MEET = {
  w: 40,
  h: 26,
  start: { x: 20, y: 8 },
  lawn: { x: 20, y: 13, r: 6, x0: 14, y0: 10, x1: 27, y1: 17 },
  track: { x0: 3, x1: 37, y0: 20, y1: 22 },
  startZone: { x0: 3, x1: 6, y0: 20, y1: 22 },
  raceStart: { x: 4, y: 21 },
  raceFinish: { x: 35, y: 21 },
};

export function buildMeet(): MapMaker {
  const m = new MapMaker('meet', 'The Meeting Meadow', MEET.w, MEET.h, objects, 'g', 'H');
  const L = MEET.lawn;
  const T = MEET.track;

  // ground: grass with a few darker patches; the outside of the hedge ring is dark and never reached
  m.blob(8, 20, 4, 2.2, 'd', 3, 0.3);
  m.blob(31, 23, 5, 1.6, 'd', 4, 0.3);
  m.blob(24, 5, 3, 1.4, 'd', 5, 0.3);
  m.blob(3, 3, 2, 1.2, 'd', 6, 0.3);
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (x < 1 || x > 38 || y < 2 || y > 25) m.set(x, y, 'd');

  // paths: clubhouse to the start, a spine across, the lawn's two sides, and down to the track
  m.path(
    [
      [20, 6],
      [20, 8],
    ],
    2,
  );
  m.path(
    [
      [2, 8],
      [37, 8],
    ],
    1,
  );
  for (const x of [6, 13, 28])
    m.path(
      [
        [x, 8],
        [x, 19],
      ],
      1,
    );
  m.rect(T.x0, T.y0, T.x1 - T.x0 + 1, T.y1 - T.y0 + 1, 'p');
  m.keepRect(T.x0 - 1, T.y0 - 1, T.x1 - T.x0 + 3, T.y1 - T.y0 + 3);
  // keep the lawn bare
  m.keepRect(L.x0 - 1, L.y0 - 1, L.x1 - L.x0 + 3, L.y1 - L.y0 + 3);

  // the ring: hedges round the edge, a clubhouse in the top gap, two poinciana trees above the top corners
  for (let x = 1; x <= 38; x++) {
    if (x < 18 || x > 22) m.put('hedge', x, 2, { margin: 0 });
    m.put('hedge', x, 25, { margin: 0 });
  }
  for (let y = 3; y <= 24; y++) {
    m.put('hedge', 1, y, { margin: 0 });
    m.put('hedge', 38, y, { margin: 0 });
  }
  m.put('poinciana', 2, -1, { margin: 0 });
  m.put('poinciana', 34, -1, { margin: 0 });
  m.put('cafe', 18, 2, { id: 'clubhouse' });
  m.put('lamp_post', 17, 5, { margin: 0 });
  m.put('lamp_post', 23, 5, { margin: 0 });

  // where everyone arrives, and the lawn
  m.place('meet_start', MEET.start.x, MEET.start.y, 'the meeting meadow');
  m.keepRect(MEET.start.x - 1, MEET.start.y - 1, 3, 3);
  m.place('lawn', L.x, L.y, 'the lawn', L.r);

  // balloon stand at the left edge of the lawn
  m.put('market_awning', 10, 11);
  m.put('heeler_balloon', 10, 10, { margin: 0 });
  m.put('heeler_balloon', 12, 10, { margin: 0 });
  m.place('balloon_stand', 12, 14, 'Keepy Uppy');

  // left corner: swing, trampoline, slide, seesaw, sandbox
  m.put('swing_set', 3, 5);
  m.place('meet_swing', 4, 7, 'the swings');
  m.put('trampoline', 3, 9);
  m.place('meet_trampoline', 4, 11, 'the trampoline');
  m.put('slide', 7, 5);
  m.place('meet_slide', 7, 8, 'the slide');
  m.put('seesaw', 7, 12);
  m.put('sandbox', 3, 14, { margin: 0 });

  // right corner: bandstand, benches, a picnic blanket
  m.put('bandstand', 31, 4);
  m.place('meet_bandstand', 33, 6, 'the bandstand');
  m.put('garden_bench', 30, 11);
  m.put('garden_bench', 34, 11);
  m.place('meet_bench', 31, 12, 'the benches');
  m.put('picnic_blanket', 32, 14, { margin: 0 });
  m.put('fairy_lights', 29, 3, { margin: 0 });
  m.put('lantern_string', 8, 3, { margin: 0 });

  // race track: chalk lines at x 6 and x 35, lamps beside both ends
  m.place('race_start', MEET.raceStart.x, MEET.raceStart.y, 'the start');
  m.place('race_finish', MEET.raceFinish.x, MEET.raceFinish.y, 'the finish');
  m.put('chalk_hopscotch', 6, T.y0, { margin: 0 });
  m.put('chalk_hopscotch', 35, T.y0, { margin: 0 });
  for (const x of [3, 6, 35, 37]) {
    m.put('lamp_post', x, T.y0 - 1, { margin: 0 });
    m.put('lamp_post', x, T.y1 + 1, { margin: 0 });
  }

  // flower beds and tufts: beside the paths and in the corners, never on the lawn or the track
  const bare = (x: number, y: number) =>
    !(x >= L.x0 - 1 && x <= L.x1 + 1 && y >= L.y0 - 1 && y <= L.y1 + 1) && !(y >= T.y0 - 1 && y <= T.y1 + 1);
  const near = (x: number, y: number) =>
    'p'.includes(m.get(x + 1, y)) ||
    'p'.includes(m.get(x - 1, y)) ||
    'p'.includes(m.get(x, y + 1)) ||
    'p'.includes(m.get(x, y - 1));
  m.scatter('flower_bed', 0.5, 21, (x, y) => bare(x, y) && near(x, y), 2, 3, 37, 24);
  m.scatter('lone_flower', 0.07, 22, bare, 2, 3, 37, 24);
  m.scatter('grass_tuft', 0.08, 23, bare, 2, 3, 37, 24);
  // flowers on the track verge, outside the running lanes
  for (let x = 8; x <= 33; x += 2) {
    if (hash2(x, 23, 24) < 0.7) m.put('flower_bed', x, 23, { margin: 0 });
    if (hash2(x, 19, 25) < 0.5 && !m.taken[19 * m.w + x] && m.get(x, 19) !== 'p')
      m.put('flower_bed', x, 19, { margin: 0 });
  }
  // bushes in the lower corners
  for (const [x, y] of [
    [2, 24],
    [3, 24],
    [36, 24],
    [37, 24],
    [2, 4],
    [37, 16],
  ] as [number, number][])
    if (!m.taken[y * m.w + x]) m.put('bush', x, y, { margin: 0 });
  return m;
}

/** Everything the meeting meadow promises, as problems: lawn bare, track clear, no resource or story objects, all reachable. */
export function checkMeet(m: MapMaker): string[] {
  const bad = m.check();
  const L = MEET.lawn;
  const T = MEET.track;
  const solid = new Uint8Array(m.w * m.h);
  for (const o of m.objects) {
    const t = m.types[o.type]!;
    if (t.node || (t.interact && t.interact !== 'fun')) bad.push(`${o.id} is a resource or story object`);
    if (['game_post', 'signpost', 'stall'].includes(o.type)) bad.push(`${o.id} is not allowed here`);
    if (!t.solid) continue;
    for (let j = 0; j < (t.h ?? 1); j++)
      for (let i = 0; i < (t.w ?? 1); i++) if (m.in(o.x + i, o.y + j)) solid[(o.y + j) * m.w + o.x + i] = 1;
  }
  const open = (x: number, y: number) => m.in(x, y) && !solid[y * m.w + x] && TERRAIN[m.get(x, y)]?.walk === 1;
  for (const c of m.ter.flat()) if ('wWqu'.includes(c)) bad.push('water in the meadow');
  for (let y = 3; y <= 24; y++)
    for (let x = 2; x <= 37; x++) {
      const inPlay = m.objects.some((o) => {
        const t = m.types[o.type]!;
        return t.solid && x >= o.x && y >= o.y && x < o.x + (t.w ?? 1) && y < o.y + (t.h ?? 1);
      });
      if (!inPlay && !open(x, y)) bad.push(`tile ${x},${y} is not walkable`);
    }
  for (const o of m.objects)
    for (let j = 0; j < (m.types[o.type]!.h ?? 1); j++)
      for (let i = 0; i < (m.types[o.type]!.w ?? 1); i++) {
        const x = o.x + i;
        const y = o.y + j;
        if (x >= L.x0 && x <= L.x1 && y >= L.y0 && y <= L.y1) bad.push(`${o.id} stands on the lawn`);
        if (x >= T.x0 && x <= T.x1 && y >= T.y0 && y <= T.y1 && !(o.type === 'chalk_hopscotch'))
          bad.push(`${o.id} stands on the track`);
      }
  for (let y = T.y0; y <= T.y1; y++)
    for (let x = T.x0; x <= T.x1; x++) if (m.get(x, y) !== 'p') bad.push(`track tile ${x},${y} is not a path`);
  const st = m.places.meet_start!;
  for (let y = st.y - 1; y <= st.y + 1; y++)
    for (let x = st.x - 1; x <= st.x + 1; x++)
      if (!open(x, y) || m.taken[y * m.w + x]) bad.push(`start is crowded at ${x},${y}`);
  // flood fill from the start
  const seen = new Uint8Array(m.w * m.h);
  const stack = [st.y * m.w + st.x];
  seen[stack[0]!] = 1;
  while (stack.length) {
    const k = stack.pop()!;
    const x = k % m.w;
    const y = (k - x) / m.w;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as [number, number][]) {
      const nx = x + dx;
      const ny = y + dy;
      if (open(nx, ny) && !seen[ny * m.w + nx]) {
        seen[ny * m.w + nx] = 1;
        stack.push(ny * m.w + nx);
      }
    }
  }
  const reach = (x: number, y: number) => open(x, y) && !!seen[y * m.w + x];
  for (const n in m.places) {
    const p = m.places[n]!;
    if (!reach(p.x, p.y)) bad.push(`place ${n} at ${p.x},${p.y} cannot be reached on foot`);
  }
  for (const o of m.objects) {
    const t = m.types[o.type]!;
    if (t.interact !== 'fun') continue;
    let ok = false;
    for (let j = -1; j <= (t.h ?? 1); j++)
      for (let i = -1; i <= (t.w ?? 1); i++) if (reach(o.x + i, o.y + j)) ok = true;
    if (!ok) bad.push(`${o.id} cannot be reached`);
    if (t.fun?.to) {
      const fx = Math.floor(o.x + t.fun.to[0]);
      const fy = Math.floor(o.y + t.fun.to[1]);
      if (!reach(fx, fy)) bad.push(`the foot of ${o.id} at ${fx},${fy} is not walkable ground`);
    }
  }
  return bad;
}
