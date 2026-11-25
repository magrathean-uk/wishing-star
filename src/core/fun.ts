// Package 57a (G, D62): every thing that looks like it can be played on can be. Space on the trampoline, a swing,
// the slide, the toy train, a bench and the like gives a short, calm turn with its own movement and sound, and a
// friend standing near joins in. No prizes (nothing to farm): a heart, a sound, a little movement. It never takes
// Space from a talk or a pick-up (findTarget asks for it last) and it never blocks a quest (any key ends it).
import { findPath, free, nearestFree } from './grid.ts';
import { give } from './bag.ts';
import type { Castle, Dir, FunMove, FunRun, FunSpot, Game, Input, Npc } from './types.ts';

interface FunDef {
  /** how long one turn lasts, in seconds */
  secs: number;
  /** a friend may join in (there is a place for one) */
  join: boolean;
}
export const FUN: Record<FunMove, FunDef> = {
  bounce: { secs: 2.5, join: true },
  swing: { secs: 3.4, join: true },
  slide: { secs: 1.8, join: false },
  ride: { secs: 3.4, join: true },
  sit: { secs: 3, join: true },
  pat: { secs: 2.4, join: true },
  splash: { secs: 1.9, join: true },
  dance: { secs: 2.8, join: true },
  hide: { secs: 2.4, join: true },
  warm: { secs: 2.4, join: false },
  stack: { secs: 1.9, join: true },
  seesaw: { secs: 3.2, join: true },
  peek: { secs: 1.7, join: false },
  wave: { secs: 1.5, join: false },
  play: { secs: 1.7, join: false },
  drum: { secs: 1.9, join: false },
  dig: { secs: 3.6, join: true },
};

// ---------------------------------------------------------------- the sandpit (package 71, D78)
// G: "when they in sandpit, nothing happens, just sit." Now she digs: sand flies on each beat and a castle grows in
// three stages over the turn. It stays on that sandpit for the rest of the game day (run-time only, so a reload or
// the next morning clears it). The first dig of each game day turns up one small find; the rest give none (no farm).

/** The things that are sandpits: the playground's sandbox and the sandpit she places at home. */
export const SANDPITS = new Set(['sandbox', 'sandpit']);
/** The small finds, one a game day, taken in turn by the day. */
export const SAND_FINDS = ['shell_pink', 'shell_spiral'];
/** The counts key holding the last game day (plus 1) a sandpit gave a find: a key in a record, so no save change. */
export const SAND_DAY = 'sand_find_day';

/** The castle's picture for a stage (1 to 3). Codex's own pictures replace these by changing this one line. */
export const castleArt = (stage: number): string => 'sandcastle_' + stage;

/** The castle on this sandpit today, or null. */
export function castleOn(g: Game, key: string): Castle | null {
  const c = g.rt.castles?.[key];
  return c && c.day === g.s.day ? c : null;
}

/** She is digging: the castle grows with the turn (from the stage it had) and the first dig of the day finds a thing. */
function digStep(g: Game, r: FunRun): void {
  const c = r.castle ? g.rt.castles?.[r.castle] : undefined;
  if (!c) return;
  const grown = Math.min(3, Math.floor((r.t / r.secs) * 3 + 1e-6));
  if (grown > c.stage) {
    c.stage = grown;
    g.ev.push({ t: 'sfx', id: grown === 3 ? 'chime' : 'place' });
    if (grown === 3) g.ev.push({ t: 'fx', id: 'sparkle', x: c.x, y: c.y - 0.4 });
  }
  if (c.stage >= 1 && (g.s.counts[SAND_DAY] ?? 0) !== g.s.day + 1) {
    g.s.counts[SAND_DAY] = g.s.day + 1;
    const id = SAND_FINDS[g.s.day % SAND_FINDS.length]!;
    if (g.c.items[id]) {
      give(g, id, 1);
      g.ev.push({ t: 'fx', id: 'pop', x: c.x, y: c.y, item: id, n: 1 });
    }
  }
}

// ---------------------------------------------------------------- swing higher (package 74, D79, idea I8)
// Space near the bottom of the forward swing is a good push: the swing goes higher, three steps, with a rising sound.
// A push at the wrong time does nothing (she just keeps swinging). After the third good push she swings once more up
// high and jumps off at the top, landing a tile ahead with a "Wheee!". No prize, no counter, nothing to fail.

/** One swing there and back, in seconds. */
export const SWING_PER = 1.7;
/** A push this near the bottom of the forward swing (in seconds, either side) is a good one. */
export const PUSH_WINDOW = 0.3;
/** Good pushes before she jumps off. */
export const PUSHES = 3;
/** Seconds a good push takes to lift the swing to its new height; seconds the jump off takes. */
const PUSH_RISE = 0.8;
export const LEAP_SECS = 0.6;

/** Seconds from the bottom of the forward swing at turn time t: negative before it, positive after. */
export function pushGap(t: number): number {
  const ph = ((t % SWING_PER) + SWING_PER) % SWING_PER;
  return ph > SWING_PER / 2 ? ph - SWING_PER : ph;
}

/** How high the swing goes at turn time t: 1 at first, a step more for each good push (it rises smoothly). */
export function swingHeight(r: FunRun, t: number): number {
  let k = 1;
  for (const p of r.pushes ?? []) {
    const e = Math.max(0, Math.min(1, (t - p) / PUSH_RISE));
    k += 0.4 * e * e * (3 - 2 * e);
  }
  return k;
}

/** Space on the swing. A good push lifts it; any push keeps her swinging a little longer; a late one does nothing. */
function swingPush(g: Game, r: FunRun): void {
  if (r.leap !== undefined || r.secs - r.t < 0.7) return;
  r.secs = Math.max(r.secs, r.t + 2.6);
  const pushes = (r.pushes ??= []);
  const last = pushes[pushes.length - 1];
  if (Math.abs(pushGap(r.t)) > PUSH_WINDOW || (last !== undefined && r.t - last < SWING_PER * 0.6)) return;
  pushes.push(r.t);
  // a rising sound: the view plays each push a step higher
  g.ev.push({ t: 'sfx', id: `push${pushes.length}` });
  if (pushes.length < PUSHES) return;
  // one more swing up high, then off at the top of the forward swing
  r.leap = Math.ceil((r.t + 1.2 - SWING_PER / 4) / SWING_PER) * SWING_PER + SWING_PER / 4;
  r.secs = r.leap + LEAP_SECS;
  // she lands a tile ahead (the way she faces on the swing) on free ground, or where she stood before
  const [fx, fy] = r.dir === 'up' ? [0, -1] : r.dir === 'left' ? [-1, 0] : r.dir === 'right' ? [1, 0] : [0, 1];
  r.bx = r.x0;
  r.by = r.y0;
  for (const d of [1, 1.4, 2]) {
    const x = r.ax + fx * d;
    const y = r.ay + fy * d;
    if (free(g, g.s.area, x, y, 0.28)) {
      r.bx = x;
      r.by = y;
      break;
    }
  }
}

/** How far a friend may be to come and join in, in tiles, and how fast they run over. */
export const JOIN_R = 7;
const RUN = 5.5;

/** The hint word for a thing to play on (strings 'hint:fun:<move>'). */
export const funHint = (move: FunMove, thing?: string) => 'fun:' + (thing && SANDPITS.has(thing) ? 'dig' : move);

/** What a placed thing (furniture) gives to play: a seat to sit on, a toy to play with, a drum to bang. */
export function placedFun(item: string, use: string | undefined): FunSpot | null {
  if (use === 'seat') return { move: 'sit', at: [0.5, 0.55] };
  // the sandpit she places at home is dug in, as the playground's is (package 71)
  if (SANDPITS.has(item)) return { move: 'dig', at: [0.7, 1.3], mate: [1.4, 1.3] };
  if (use === 'toy') return { move: item === 'toy_drum' ? 'drum' : 'play' };
  return null;
}

/**
 * Start a turn on a thing to play on. `ox`, `oy`, `w`, `h`: the thing's tiles. `obj`: its index in the area (-1 for
 * a placed thing, which gives its key as `placed`).
 */
export function startFun(
  g: Game,
  given: FunSpot,
  ox: number,
  oy: number,
  w: number,
  h: number,
  obj: number,
  placed = 0,
): void {
  const s = g.s;
  // a sandpit's turn is digging (package 71): the object data still says 'pat', as a play mat's does
  const thing = obj >= 0 ? g.c.areas[s.area]!.objects[obj]?.type : undefined;
  const spot: FunSpot = given.move === 'pat' && thing && SANDPITS.has(thing) ? { ...given, move: 'dig' } : given;
  const def = FUN[spot.move];
  const ax = spot.at ? ox + spot.at[0] : s.x;
  const ay = spot.at ? oy + spot.at[1] : s.y;
  let bx = 0;
  let by = 0;
  let dir: Dir = spot.at ? 'down' : s.dir;
  if (spot.move === 'slide') {
    // the foot of the slide must be ground she can stand on, or she slides back to where she was
    bx = spot.to ? ox + spot.to[0] : s.x;
    by = spot.to ? oy + spot.to[1] : s.y;
    if (!free(g, s.area, bx, by, 0.28)) {
      bx = s.x;
      by = s.y;
    }
    dir = bx > ax + 0.3 ? 'right' : bx < ax - 0.3 ? 'left' : 'down';
  } else if (spot.move === 'ride') {
    // the train goes a few tiles along clear ground and back: the way with the most room
    const far = g.c.areas[s.area]!.indoor ? 2 : 3;
    let best = 0;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      let n = 0;
      while (n < far && clearRow(g, ox, oy, w, h, dx, dy, n + 1)) n++;
      if (n > best) {
        best = n;
        bx = dx * n;
        by = dy * n;
      }
    }
    dir = bx > 0 ? 'right' : bx < 0 ? 'left' : by < 0 ? 'up' : 'down';
  } else if (spot.move === 'warm' || spot.move === 'peek' || spot.move === 'wave' || spot.move === 'stack') dir = s.dir;
  const run: FunRun = {
    move: spot.move,
    obj,
    placed,
    t: 0,
    secs: def.secs,
    x0: s.x,
    y0: s.y,
    ax,
    ay,
    bx,
    by,
    dir,
    friend: 0,
    fpath: null,
    fpi: 0,
    fx: 0,
    fy: 0,
    fx0: 0,
    fy0: 0,
    ft: -1,
    beat: -1,
  };
  if (def.join && spot.mate) joinFriend(g, run, ox + spot.mate[0], oy + spot.mate[1]);
  if (spot.move === 'dig') {
    // the castle stands in the sandpit's upper middle, behind where she sits; today's castle grows on
    const key = `${s.area}:${obj >= 0 ? 'o' + obj : 'p' + placed}`;
    const castles = (g.rt.castles ??= {});
    if (!castleOn(g, key)) castles[key] = { area: s.area, x: ox + w * 0.5, y: oy + h * 0.32, day: s.day, stage: 0 };
    run.castle = key;
  }
  g.rt.fun = run;
  g.rt.swingT = 0;
  g.rt.emoteT = 0;
  s.dir = dir;
  s.x = ax;
  s.y = ay;
  g.rt.px = s.x;
  g.rt.py = s.y;
  s.counts['fun:' + spot.move] = (s.counts['fun:' + spot.move] ?? 0) + 1;
  g.ev.push({ t: 'sfx', id: START_SFX[spot.move] ?? 'pop' });
}
const START_SFX: Partial<Record<FunMove, string>> = {
  bounce: 'boing',
  swing: 'whoosh',
  slide: 'step_wood',
  ride: 'chime',
  sit: 'thump',
  pat: 'dig',
  dig: 'dig',
  splash: 'splash',
  dance: 'chime',
  hide: 'rustle',
  warm: 'glow',
  stack: 'place',
  seesaw: 'thump',
  peek: 'hum',
  wave: 'hum',
  play: 'boing',
  drum: 'thump',
};

/** Is the row of tiles `n` steps beyond a thing (moving dx, dy) clear for it to roll on? */
function clearRow(g: Game, ox: number, oy: number, w: number, h: number, dx: number, dy: number, n: number): boolean {
  const area = g.s.area;
  const sx = dx > 0 ? ox + w - 1 + n : dx < 0 ? ox - n : ox;
  const sy = dy > 0 ? oy + h - 1 + n : dy < 0 ? oy - n : oy;
  const cw = dx ? 1 : w;
  const chh = dy ? 1 : h;
  for (let y = sy; y < sy + chh; y++)
    for (let x = sx; x < sx + cw; x++) if (!free(g, area, x + 0.5, y + 0.5, 0.2)) return false;
  return true;
}

/** The nearest friend who can come and join in: a person who walks about, a short run away. */
function joinFriend(g: Game, run: FunRun, mx: number, my: number): void {
  const area = g.s.area;
  const a = g.c.areas[area]!;
  const talking = g.rt.talk?.npc ?? 0;
  let best: Npc | null = null;
  let bestPath: number[] | null = null;
  let bestD = JOIN_R * JOIN_R;
  for (const n of g.rt.npcs) {
    if (n.k === talking || n.hidden || n.roam <= 0) continue;
    const c = g.c.chars[n.id];
    if (!c || (c.role !== 'hero' && c.role !== 'walker') || c.body !== 'biped') continue;
    const d2 = (n.x - mx) ** 2 + (n.y - my) ** 2;
    if (d2 > bestD) continue;
    const path = findPath(
      g.rt.solid[area]!,
      a.w,
      a.h,
      Math.floor(n.x),
      Math.floor(n.y),
      Math.floor(mx),
      Math.floor(my),
      1,
      600,
    );
    if (!path || path.length > 2 * 14) continue;
    best = n;
    bestPath = path;
    bestD = d2;
  }
  if (!best) return;
  run.friend = best.k;
  run.fpath = bestPath;
  run.fpi = 0;
  run.fx = mx;
  run.fy = my;
  run.fx0 = best.x;
  run.fy0 = best.y;
  // the turn lasts a little longer while the friend runs over
  run.secs += Math.min(1.4, (bestPath!.length / 2 + 1) / RUN);
}

/** One step of a turn. True while it runs (she does nothing else meanwhile). */
export function stepFun(g: Game, inp: Input): boolean {
  const r = g.rt.fun;
  if (!r) return false;
  const s = g.s;
  r.t += 1 / 60;
  // a key ends it at once (after a moment, so the Space that started it does not end it too); a slide finishes.
  // Package 68: Space again does not end it (a child presses it again to bounce: run a 0122 ended the bounce
  // before it could be seen); walking off does.
  if (r.t > 0.35 && r.move !== 'slide' && (inp.mx || inp.my || inp.use || inp.fire || inp.emote)) {
    endFun(g);
    return false;
  }
  // package 74 (I8): Space on a swing is a push
  if (r.move === 'swing' && inp.act && r.t > 0.35) swingPush(g, r);
  if (r.leap !== undefined && r.t >= r.leap && r.t - 1 / 60 < r.leap) {
    g.ev.push({ t: 'fx', id: 'word', x: s.x, y: s.y - 2, item: 'say:wheee' });
    g.ev.push({ t: 'sfx', id: 'giggle' });
  }
  const at = funAt(r, 0);
  s.x = at.x;
  s.y = at.y;
  beats(g, r);
  if (r.move === 'dig') digStep(g, r);
  if (r.t >= r.secs) {
    endFun(g);
    return false;
  }
  return true;
}

/** Where she is (who 0) or the friend (who 1) during a turn, in tiles: the slide and the ride move them. */
const AT = { x: 0, y: 0 };
export function funAt(r: FunRun, who: 0 | 1): { x: number; y: number } {
  const x = who ? r.fx : r.ax;
  const y = who ? r.fy : r.ay;
  if (r.move === 'slide' && !who) {
    const k = Math.max(0, Math.min(1, (r.t - 0.45) / 0.95));
    const e = k * k * (3 - 2 * k);
    AT.x = r.ax + (r.bx - r.ax) * e;
    AT.y = r.ay + (r.by - r.ay) * e;
    return AT;
  }
  if (r.move === 'swing' && !who && r.leap !== undefined && r.t > r.leap) {
    // jumping off (package 74): from the seat to the spot a tile ahead
    const e = leapK(r, r.t);
    AT.x = r.ax + (r.bx - r.ax) * e;
    AT.y = r.ay + (r.by - r.ay) * e;
    return AT;
  }
  if (r.move === 'ride') {
    const k = Math.sin(Math.PI * Math.max(0, Math.min(1, rideT(r))));
    AT.x = x + r.bx * k;
    AT.y = y + r.by * k;
    return AT;
  }
  AT.x = x;
  AT.y = y;
  return AT;
}
/** How far through the jump off the swing she is, 0 to 1, eased. */
function leapK(r: FunRun, t: number): number {
  const k = Math.max(0, Math.min(1, (t - (r.leap ?? 0)) / LEAP_SECS));
  return k * k * (3 - 2 * k);
}
/** How far through the ride it is, 0 to 1 (it waits for a friend to climb on). `now`: the turn's time. */
function rideT(r: FunRun, now = r.t): number {
  const start = r.friend ? r.secs - FUN.ride.secs : 0;
  return (now - start - 0.3) / (FUN.ride.secs - 0.6);
}

/**
 * Package 71 (D78, G: "ghosting on the swing"): the rules tick 60 times a second and a screen may draw 120. The
 * view asks for a pose at a time between two ticks (`at`, the turn's own clock), so she moves on every drawn frame.
 * Kept inside the turn: never before 0 nor past its end.
 */
export function funClock(r: FunRun, at: number | undefined): number {
  return at === undefined ? r.t : Math.max(0, Math.min(r.secs, at));
}

/** Sounds and small effects on the beat of each turn. */
function beats(g: Game, r: FunRun): void {
  const per =
    r.move === 'bounce'
      ? 0.62
      : r.move === 'splash'
        ? 0.62
        : r.move === 'swing'
          ? 1.7
          : r.move === 'seesaw'
            ? 0.75
            : r.move === 'pat' || r.move === 'dig'
              ? 0.6
              : r.move === 'dance'
                ? 0.7
                : r.move === 'stack'
                  ? 0.42
                  : r.move === 'drum'
                    ? 0.3
                    : r.move === 'play'
                      ? 0.55
                      : 0;
  if (!per) {
    // one-off moments: the bottom of the slide, the middle of the ride, out of the fort, a warm glow
    const at = r.move === 'slide' ? 0.45 : r.move === 'ride' ? r.secs / 2 : r.move === 'hide' ? 1.9 : 0.6;
    if (r.beat < 0 && r.t >= at) {
      r.beat = 0;
      const id = { slide: 'whoosh', ride: 'bell', hide: 'giggle', warm: 'sparkle', peek: 'giggle' }[r.move as string];
      if (id && r.move !== 'warm') g.ev.push({ t: 'sfx', id });
      if (r.move === 'warm') g.ev.push({ t: 'fx', id: 'sparkle', x: g.s.x, y: g.s.y - 0.6, n: 2 });
      if (r.move === 'peek' || r.move === 'hide') g.ev.push({ t: 'fx', id: 'heart', x: g.s.x, y: g.s.y - 1 });
    }
    return;
  }
  const n = Math.floor(r.t / per);
  if (n === r.beat) return;
  r.beat = n;
  const s = g.s;
  switch (r.move) {
    case 'bounce':
      g.ev.push({ t: 'sfx', id: 'boing' });
      break;
    case 'splash':
      g.ev.push({ t: 'sfx', id: 'splash' });
      g.ev.push({ t: 'fx', id: 'ripple', x: s.x, y: s.y });
      break;
    case 'swing':
      if (n > 0) g.ev.push({ t: 'sfx', id: 'whoosh' });
      break;
    case 'seesaw':
      if (n > 0) g.ev.push({ t: 'sfx', id: 'thump' });
      break;
    case 'pat':
      g.ev.push({ t: 'sfx', id: 'dig' });
      g.ev.push({ t: 'fx', id: 'dust', x: s.x + 0.3, y: s.y });
      break;
    case 'dig': {
      // sand flies from her hands, and from the friend's who digs beside her
      g.ev.push({ t: 'sfx', id: 'dig' });
      const side = n % 2 ? 0.35 : -0.35;
      g.ev.push({ t: 'fx', id: 'sand', x: s.x + side, y: s.y - 0.1 });
      if (r.friend && r.ft >= 0) g.ev.push({ t: 'fx', id: 'sand', x: r.fx - side, y: r.fy - 0.1 });
      break;
    }
    case 'dance':
      g.ev.push({ t: 'sfx', id: n % 2 ? 'twinkle' : 'chime' });
      break;
    case 'stack':
      if (n < 3) g.ev.push({ t: 'sfx', id: 'place' });
      else if (n === 3) g.ev.push({ t: 'sfx', id: 'giggle' });
      break;
    case 'drum':
      g.ev.push({ t: 'sfx', id: 'thump' });
      break;
    case 'play':
      if (n < 3) g.ev.push({ t: 'sfx', id: 'boing' });
      break;
  }
}

/** The turn is over (or a key ended it): she stands where she was (or at the foot of the slide); the friend goes back. */
export function endFun(g: Game): void {
  const r = g.rt.fun;
  if (!r) return;
  const s = g.s;
  g.rt.fun = null;
  // the foot of the slide, or where she landed off the swing (package 74)
  const off = (r.move === 'slide' && r.t > 0.9) || (r.move === 'swing' && r.leap !== undefined && r.t >= r.leap);
  let x = off ? r.bx : r.x0;
  let y = off ? r.by : r.y0;
  if (!free(g, s.area, x, y, 0.28)) {
    const out = nearestFree(g, s.area, Math.floor(x), Math.floor(y), 6);
    if (out) {
      x = out.x + 0.5;
      y = out.y + 0.5;
    }
  }
  s.x = x;
  s.y = y;
  g.rt.px = x;
  g.rt.py = y;
  g.rt.clip = 'idle';
  g.rt.ct = 0;
  if (r.t > 1) g.ev.push({ t: 'fx', id: 'heart', x, y: y - 1 });
  const n = r.friend ? g.rt.npcs.find((m) => m.k === r.friend) : null;
  if (n) {
    // back to where they were, on foot
    if (!free(g, s.area, n.x, n.y, 0.25)) {
      const out = nearestFree(g, s.area, Math.floor(n.x), Math.floor(n.y), 4);
      if (out) {
        n.x = out.x + 0.5;
        n.y = out.y + 0.5;
        n.px = n.x;
        n.py = n.y;
      }
    }
    const a = g.c.areas[s.area]!;
    const path = findPath(
      g.rt.solid[s.area]!,
      a.w,
      a.h,
      Math.floor(n.x),
      Math.floor(n.y),
      Math.floor(r.fx0),
      Math.floor(r.fy0),
      0,
      600,
    );
    n.path = path?.length ? path : null;
    n.pi = 0;
    n.wait = 2;
    n.clip = 'idle';
  }
}

/** The friend who joined in: runs over, then plays alongside. Runs after the people have taken their step. */
export function stepFunFriend(g: Game): void {
  const r = g.rt.fun;
  if (!r?.friend) return;
  const n = g.rt.npcs.find((m) => m.k === r.friend);
  if (!n) {
    r.friend = 0;
    return;
  }
  // the people's own step may have set off on a stroll: this one is busy
  n.path = null;
  n.wait = 2;
  n.talkT = 0;
  if (r.ft < 0) {
    const sp = RUN / 60;
    let gx = r.fx;
    let gy = r.fy;
    if (r.fpath && r.fpi < r.fpath.length) {
      gx = r.fpath[r.fpi]! + 0.5;
      gy = r.fpath[r.fpi + 1]! + 0.5;
    }
    const dx = gx - n.x;
    const dy = gy - n.y;
    const d = Math.hypot(dx, dy);
    if (d <= sp) {
      n.x = gx;
      n.y = gy;
      if (r.fpath && r.fpi < r.fpath.length) r.fpi += 2;
      else r.ft = 0;
    } else {
      n.x += (dx / d) * sp;
      n.y += (dy / d) * sp;
      n.dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'down';
    }
    n.clip = 'walk';
    return;
  }
  r.ft += 1 / 60;
  const at = funAt(r, 1);
  n.x = at.x;
  n.y = at.y;
  n.dir = r.move === 'ride' ? r.dir : 'down';
  n.clip = 'idle';
}

/** How she (who 0) or the friend (who 1) looks right now: lift off the ground, sway and tilt, clip, see-through. */
export interface FunPose {
  /** tiles up off the ground */
  lift: number;
  /** tiles to the side */
  sway: number;
  /** degrees */
  ang: number;
  clip: string;
  alpha: number;
}
const POSE: FunPose = { lift: 0, sway: 0, ang: 0, clip: 'idle', alpha: 1 };
export function funPose(r: FunRun, who: 0 | 1, at?: number): FunPose {
  const p = POSE;
  const now = funClock(r, at);
  p.lift = 0;
  p.sway = 0;
  p.ang = 0;
  p.alpha = 1;
  p.clip = 'idle';
  if (who && r.ft < 0) {
    p.clip = 'walk';
    return p;
  }
  // the friend's clock started when they arrived: it moves on by the same share as hers
  const t = who ? Math.max(0, r.ft + now - r.t) : now;
  const left = (who ? r.secs - (now - t) : r.secs) - t;
  // swings and see-saws start and stop gently
  const ease = Math.max(0, Math.min(1, t / 0.7, left / 0.6));
  switch (r.move) {
    case 'bounce': {
      const ph = ((t + (who ? 0.31 : 0)) % 0.62) / 0.62;
      // no higher than the mat is deep, so even at the top of a jump her feet are over the mat, not past its far rim
      p.lift = 0.48 * Math.sin(Math.PI * ph) * Math.min(1, left / 0.3);
      p.clip = p.lift > 0.16 ? 'cheer' : 'idle';
      break;
    }
    case 'splash': {
      const ph = ((t + (who ? 0.31 : 0)) % 0.62) / 0.62;
      p.lift = 0.42 * Math.sin(Math.PI * ph) * Math.min(1, left / 0.3);
      p.clip = 'cheer';
      break;
    }
    case 'swing': {
      // package 74 (I8): good pushes swing her higher, and a friend on the other swing goes as high as she does
      if (!who && r.leap !== undefined && now >= r.leap) {
        // off at the top: from the seat's sway and lift, up in an arc and down a tile ahead
        const a0 = Math.sin((2 * Math.PI * r.leap) / SWING_PER) * swingHeight(r, r.leap);
        const e = leapK(r, now);
        p.sway = 0.3 * a0 * (1 - e);
        p.lift = 0.16 * a0 * a0 * (1 - e) + 0.9 * Math.sin(Math.PI * e);
        p.ang = 10 * a0 * (1 - e);
        p.clip = 'cheer';
        break;
      }
      const a = Math.sin((2 * Math.PI * (t + (who ? 0.25 : 0))) / SWING_PER) * ease * swingHeight(r, now);
      p.sway = 0.3 * a;
      p.lift = 0.16 * a * a;
      p.ang = 10 * a;
      p.clip = 'sit';
      break;
    }
    case 'seesaw': {
      const a = Math.sin((2 * Math.PI * t) / 1.5) * ease;
      p.lift = 0.16 * (1 + (who ? -a : a));
      p.clip = 'sit';
      break;
    }
    case 'slide':
      p.clip = now < 0.45 ? 'idle' : now < 1.45 ? 'sit' : 'cheer';
      p.lift = now < 0.45 ? 0.25 * (now / 0.45) : 0;
      break;
    case 'ride':
      p.clip = 'sit';
      p.lift = 0.04 * Math.abs(Math.sin(t * 17));
      break;
    case 'sit':
    case 'pat':
    case 'play':
      p.clip = 'sit';
      break;
    case 'dig': {
      // a scoop on each beat: the swing clip moves her arms (it plays once, so a moment crouched starts it again)
      const ph = ((t + (who ? 0.3 : 0)) % 0.6) / 0.6;
      p.clip = ph < 0.7 ? 'swing' : 'sit';
      p.lift = 0.04 * Math.sin(Math.PI * ph);
      p.sway = (who ? -0.04 : 0.04) * Math.sin(2 * Math.PI * ph);
      break;
    }
    case 'dance':
      p.clip = Math.floor(t / 0.4) % 2 ? 'wave' : 'cheer';
      p.sway = 0.1 * Math.sin(t * 7.5 + who);
      break;
    case 'hide':
      p.alpha = t > 0.25 && left > 0.45 ? 0.3 : 1;
      p.clip = left <= 0.45 ? 'laugh' : 'idle';
      break;
    case 'stack':
      p.clip = t < 1.25 ? 'swing' : 'cheer';
      break;
    case 'drum':
      p.clip = 'swing';
      break;
    case 'peek':
      p.clip = t < 0.6 ? 'surprised' : 'laugh';
      break;
    case 'wave':
      p.clip = 'wave';
      break;
    case 'warm':
      p.clip = 'idle';
      break;
  }
  return p;
}

/** How the thing itself moves: the train rolls, the see-saw tips, the trampoline dips, the blocks wobble. */
export interface FunThing {
  dx: number;
  dy: number;
  ang: number;
  /** 1 is its own height; a little less is a dip */
  sy: number;
}
const THING: FunThing = { dx: 0, dy: 0, ang: 0, sy: 1 };
export function funThing(r: FunRun, at?: number): FunThing {
  const p = THING;
  p.dx = 0;
  p.dy = 0;
  p.ang = 0;
  p.sy = 1;
  const t = funClock(r, at);
  switch (r.move) {
    case 'ride': {
      const k = Math.sin(Math.PI * Math.max(0, Math.min(1, rideT(r, t))));
      p.dx = r.bx * k;
      p.dy = r.by * k;
      break;
    }
    case 'seesaw':
      p.ang = -7 * Math.sin((2 * Math.PI * t) / 1.5) * Math.max(0, Math.min(1, t / 0.7, (r.secs - t) / 0.6));
      break;
    case 'bounce': {
      const ph = (t % 0.62) / 0.62;
      p.sy = ph < 0.1 || ph > 0.9 ? 0.95 : 1;
      break;
    }
    case 'stack':
    case 'play':
    case 'drum':
    case 'wave':
      p.ang = t < 1.3 ? 3 * Math.sin(t * 22) : 0;
      break;
  }
  return p;
}
