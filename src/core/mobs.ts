// Mobs: where they appear, how they move and fight, and what the sword does to them.
// Only mobs are ever fought. A beaten mob goes in a puff of smoke.
import { give, take, toolTier } from './bag.ts';
import { bossHit, spawnBoss, stepBoss, stepRing } from './bosses.ts';
import { count, isNight, rand, randInt } from './cond.ts';
import { bowDmg, swordDmg } from './gear.ts';
import { findPath, free, objLive, regionAt } from './grid.ts';
import { lampKeeps } from './lamp.ts';
import { DIRV, gather, hurtHero, nudge } from './hero.ts';
import { HALF } from './walk.ts';
import { denBeaten, inClearedDen } from './island.ts';
import { place, questEvent, sticker } from './quests.ts';
import type { Game, Mob, MobDef, Shot, SpawnZone } from './types.ts';

export { SWORD_DMG } from './gear.ts';

/** A zombie's health near home; the regions' `tough` sets it further out (phase 2, part E). */
export const HOME_TOUGH = 3;
/**
 * Health of a mob made here: tougher the further she is from home. A mob's own health is for home ground; out in
 * the plains, the forest or the crater it scales with the region's `tough` (a zombie has 3, 6, 8, 12). Bosses keep
 * their own rules.
 */
export function mobHp(g: Game, id: string, area: string, x: number, y: number): number {
  const def = g.c.mobs[id]!;
  if (def.role === 'boss') return def.hp;
  const a = g.c.areas[area];
  if (!a) return def.hp;
  const code = regionAt(a, Math.floor(x), Math.floor(y));
  let tough = HOME_TOUGH;
  for (const rid in g.c.regions) if (g.c.regions[rid]!.code === code) tough = g.c.regions[rid]!.tough ?? HOME_TOUGH;
  return Math.max(1, Math.round((def.hp * tough) / HOME_TOUGH));
}
/** Package 60: seconds a mob that has just seen her stands with its mark up before it comes (its first swing waits). */
const NOTICE = 0.45;
const SWING_REACH = 1.75;

/** The creeper (phase 2, part E): it fuses this close and its blast (the ring on the ground) reaches this far. Once
 * lit, the fuse always runs out where it stands (G, package 51: walking away no longer puts it out). A hit still puts
 * it out. */
export const CREEPER_FUSE_AT = 2.1;
export const CREEPER_BLAST = 2.3;
/** 1.5 s (checked in package 53a): from right beside it she walks out of the ring in 0.4 s at 4.5 tiles a second,
 * so a child has over 1 s to see the hiss and step back, or hit it (a hit puts it out). */
export const CREEPER_FUSE = 1.5;
/** The first creeper she ever meets (chapter 2's teaching one) burns longer, so "hit, then step back" can be learnt. */
export const CREEPER_FUSE_FIRST = 3;

/** Hostile mobs after her at once, and creepers among them: Gentle, then Normal. Bosses and the village defence aside. */
export function mobCaps(g: Game): { all: number; creepers: number } {
  return g.s.opts.gentle ? { all: 2, creepers: 1 } : { all: 3, creepers: 2 };
}

/**
 * The play view in tiles (World.ts: zoom 1.25 on 1920 x 1080 with 64 px tiles is 24 x 13.5), its centre sitting
 * 0.625 tiles above her and kept inside the area. A mob is never made closer than SPAWN_MARGIN beyond its edge.
 */
export const VIEW_W = 24;
export const VIEW_H = 13.5;
export const SPAWN_MARGIN = 1.5;
/** How far past that edge a spawn may land. */
const SPAWN_BAND = 4;

export function viewCentre(g: Game): { x: number; y: number } {
  const a = g.c.areas[g.s.area]!;
  const cx = a.w <= VIEW_W ? a.w / 2 : Math.max(VIEW_W / 2, Math.min(a.w - VIEW_W / 2, g.s.x));
  const cy = a.h <= VIEW_H ? a.h / 2 : Math.max(VIEW_H / 2, Math.min(a.h - VIEW_H / 2, g.s.y - 0.625));
  return { x: cx, y: cy };
}
/** Is this spot at least SPAWN_MARGIN tiles beyond the edge of the view? */
export function offView(g: Game, x: number, y: number): boolean {
  const c = viewCentre(g);
  return Math.abs(x - c.x) >= VIEW_W / 2 + SPAWN_MARGIN || Math.abs(y - c.y) >= VIEW_H / 2 + SPAWN_MARGIN;
}

/** The sprite's drawn width either side of its feet and a little of shadow and swing, in tiles (package 86b). */
const SPRITE_HALF_W = 1;
const SPRITE_PAD = 0.75;
/**
 * Is the whole mob, not only its feet, out of the view? Its sprite stands on (x, y) and rises `tall` tiles (a mob is 2
 * by default): below the view its top edge must clear the bottom of the view, above it the feet must clear the top.
 * It also holds offView's own margin. (Package 86b: a spot just past the margin below still showed the mob's head.)
 */
export function spriteOffView(g: Game, x: number, y: number, tall = 2): boolean {
  if (!offView(g, x, y)) return false;
  const c = viewCentre(g);
  if (Math.abs(x - c.x) >= VIEW_W / 2 + SPRITE_HALF_W + SPRITE_PAD) return true;
  // above the view offView's own margin already clears the feet, so the whole sprite is out
  if (y <= c.y - VIEW_H / 2) return true;
  return y - tall >= c.y + VIEW_H / 2 + SPRITE_PAD;
}

// ai states
export const IDLE = 0;
export const CHASE = 1;
export const WINDUP = 2;
export const STRIKE = 3;
export const RECOVER = 4;
export const FUSE = 5;
export const LEAVE = 6;

export function regionLit(g: Game, code: string): boolean {
  for (const id in g.c.regions) {
    const r = g.c.regions[id]!;
    // package 73a: or the lighthouse lamp is on at night and this is the bay
    if (r.code === code) return !!r.safe || !!g.s.flags['lit:' + id] || lampKeeps(g, code);
  }
  return true;
}

export function makeMob(g: Game, id: string, x: number, y: number, zone = ''): Mob {
  const m: Mob = {
    k: g.rt.nextK++,
    id,
    kind: 'mob',
    area: g.s.area,
    x,
    y,
    px: x,
    py: y,
    dir: 'down',
    clip: 'idle',
    ct: 0,
    hp: mobHp(g, id, g.s.area, x, y),
    st: IDLE,
    t: 0.5 + rand(g),
    vx: 0,
    vy: 0,
    hurtT: 0,
    zone,
    phase: 0,
    fuse: 0,
  };
  g.rt.mobs.push(m);
  g.ev.push({ t: 'fx', id: 'spawn', x, y });
  return m;
}

/** Story spawns: a few mobs near a named place. */
export function spawnAt(g: Game, id: string, n: number, at: string): void {
  const p = place(g, at);
  if (!p || p.area !== g.s.area) return;
  if (g.c.mobs[id]?.role === 'boss') {
    // a boss stands exactly on its place and remembers the hits it already has
    spawnBoss(g, id, at);
    return;
  }
  for (let i = 0; i < n; i++) {
    for (let tries = 0; tries < 30; tries++) {
      const x = p.x + 0.5 + (rand(g) * 2 - 1) * (p.r ?? 3);
      const y = p.y + 0.5 + (rand(g) * 2 - 1) * (p.r ?? 3);
      if (!free(g, g.s.area, x, y, 0.3)) continue;
      const m = makeMob(g, id, x, y, at);
      m.tag = 'story';
      break;
    }
  }
}

function hostileCount(g: Game): number {
  let n = 0;
  for (const m of g.rt.mobs) if (!m.calm && !m.gone) n++;
  return n;
}

function trySpawn(g: Game): void {
  const s = g.s;
  const a = g.c.areas[s.area]!;
  if (a.zones.length === 0) return;
  const cap = s.opts.gentle ? 2 : 3;
  if (hostileCount(g) >= cap) return;
  // A boss fight is hers and the boss's alone: nothing else walks in while a boss is about.
  for (const m of g.rt.mobs) if (!m.gone && g.c.mobs[m.id]?.role === 'boss') return;
  const night = isNight(g);
  let zone: SpawnZone | null = null;
  let best = 1e9;
  for (const z of a.zones) {
    if (z.mode === 'night' && (!night || regionLit(g, z.region))) continue;
    const cx = Math.max(z.rect.x, Math.min(s.x, z.rect.x + z.rect.w));
    const cy = Math.max(z.rect.y, Math.min(s.y, z.rect.y + z.rect.h));
    const d = Math.hypot(cx - s.x, cy - s.y);
    if (d < VIEW_W / 2 + SPAWN_MARGIN + SPAWN_BAND && d < best) {
      best = d;
      zone = z;
    }
  }
  if (!zone) return;
  // Calm mobs (spiders by day) do not count: a zone full of them must still send her something to fight.
  // So they cannot pile up either, a calm one far from her wanders off when the zone is crowded.
  let inZone = 0;
  let all = 0;
  let far: Mob | null = null;
  for (const m of g.rt.mobs) {
    if (m.zone !== zone.id || m.gone) continue;
    all++;
    if (!m.calm) inZone++;
    else if (Math.hypot(m.x - s.x, m.y - s.y) > 12) far = m;
  }
  if (inZone >= zone.max) return;
  if (all >= zone.max + 2) {
    if (!far) return;
    far.gone = true;
  }
  // Nothing pops in: a spawn lands in a band just beyond the edge of the view, never on screen.
  const c = viewCentre(g);
  const hw = VIEW_W / 2 + SPAWN_MARGIN;
  const hh = VIEW_H / 2 + SPAWN_MARGIN;
  for (let tries = 0; tries < 16; tries++) {
    const x = c.x + (rand(g) * 2 - 1) * (hw + SPAWN_BAND);
    const y = c.y + (rand(g) * 2 - 1) * (hh + SPAWN_BAND);
    if (Math.abs(x - c.x) < hw && Math.abs(y - c.y) < hh) continue;
    if (x < zone.rect.x || y < zone.rect.y || x >= zone.rect.x + zone.rect.w || y >= zone.rect.y + zone.rect.h)
      continue;
    if (!free(g, s.area, x, y, 0.3)) continue;
    // nothing ever comes back to a cleared den
    if (inClearedDen(g, x, y)) continue;
    const code = regionAt(a, Math.floor(x), Math.floor(y));
    if ((zone.mode === 'night' && regionLit(g, code)) || lampKeeps(g, code)) continue;
    const id = zone.mobs[randInt(g, 0, zone.mobs.length - 1)]!;
    makeMob(g, id, x, y, zone.id);
    return;
  }
}

function setClip(m: Mob, clip: Mob['clip']): void {
  if (m.clip !== clip) {
    m.clip = clip;
    m.ct = 0;
  }
}
function face(m: Mob, dx: number, dy: number): void {
  m.dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'down';
}
export function moveMob(g: Game, m: Mob, dx: number, dy: number): boolean {
  let moved = false;
  if (dx && free(g, m.area, m.x + dx, m.y, 0.3)) {
    m.x += dx;
    moved = true;
  }
  if (dy && free(g, m.area, m.x, m.y + dy, 0.3)) {
    m.y += dy;
    moved = true;
  }
  return moved;
}

export function stepMobs(g: Game): void {
  const s = g.s;
  const rt = g.rt;
  rt.spawnT -= 1 / 60;
  if (rt.spawnT <= 0) {
    rt.spawnT = 1.6;
    trySpawn(g);
  }
  const a = g.c.areas[s.area]!;
  const night = isNight(g);
  wakeUp(g);
  for (let i = rt.mobs.length - 1; i >= 0; i--) {
    const m = rt.mobs[i];
    // the list was emptied under us (she was carried home by the mob before this one): nothing left to step
    if (!m) continue;
    m.px = m.x;
    m.py = m.y;
    m.ct += 1 / 60;
    if (m.gone) {
      rt.mobs.splice(i, 1);
      continue;
    }
    const def = g.c.mobs[m.id]!;
    const dx = s.x - m.x;
    const dy = s.y - m.y;
    const dist = Math.hypot(dx, dy) || 0.001;
    if (m.hurtT > 0) {
      m.hurtT -= 1 / 60;
      moveMob(g, m, m.vx / 60, m.vy / 60);
      m.vx *= 0.86;
      m.vy *= 0.86;
      if (m.hurtT <= 0 && m.st !== FUSE && def.role !== 'boss') setClip(m, 'idle');
      continue;
    }
    // Night mobs leave at sunrise, in lit regions, or when she has gone far away.
    if (def.role === 'hostile' && m.tag !== 'story' && !m.tag?.startsWith('den:')) {
      const z = a.zones.find((q) => q.id === m.zone);
      const nightOnly = !z || z.mode === 'night';
      const code = regionAt(a, Math.floor(m.x), Math.floor(m.y));
      // package 73a: a mob of any zone leaves the bay while the lighthouse lamp shines
      if ((nightOnly && (!night || regionLit(g, code))) || lampKeeps(g, code) || dist > 26) {
        puff(g, m);
        continue;
      }
    }
    if (!s.hints.fight && def.role === 'hostile' && dist < 6.5 && !m.calm) {
      s.hints.fight = 1;
      nudge(g, toolTier(g, 'sword') > 0 ? 'fight_hint' : 'fight_no_sword', 7);
    }
    m.calm = def.dayFriendly ? !night && !a.dark : m.calm;
    if (m.doze) {
      // asleep where it stands until fewer are after her
      if (m.clip !== 'idle') setClip(m, 'idle');
      continue;
    }
    if (comeBack(g, m, def, dx, dy, dist)) continue;
    switch (def.ai) {
      case 'chase':
        aiChase(g, m, def, dx, dy, dist);
        break;
      case 'hopper':
        aiHopper(g, m, def, dx, dy, dist);
        break;
      case 'creeper':
      case 'mini':
        aiCreeper(g, m, def, dx, dy, dist);
        break;
      case 'ranged':
        aiRanged(g, m, def, dx, dy, dist);
        break;
      case 'ender':
        aiEnder(g, m, def, dx, dy, dist);
        break;
      default:
        stepBoss(g, m, def, dx, dy, dist);
        break;
    }
  }
  stepShots(g);
}

/** Package 69: how long a mob in a fight may stay out of her reach before it comes back to her. */
export const AWAY_MAX = 3;
const AWAY_REACH = 2;
/**
 * Package 69: a mob in a fight that has stayed out of her reach for 3 s (backed off, knocked back, stuck behind a tree,
 * or standing where she cannot walk) walks back to her round what is in the way. A skeleton then stands a moment
 * where it came back (beside her, or at its out-of-view spot, package 86) before it backs off again. Returns true when this step was spent on it.
 */
function comeBack(g: Game, m: Mob, def: MobDef, dx: number, dy: number, dist: number): boolean {
  if (m.calm || def.role !== 'hostile' || (def.ai !== 'chase' && def.ai !== 'hopper' && def.ai !== 'ranged')) {
    m.away = 0;
    return false;
  }
  if ((m.away ?? 0) < 0) {
    // just came back (beside her, or out of view): it stands a moment (a skeleton would back off at once)
    m.away = Math.min(0, m.away! + 1 / 60);
    if (def.ai !== 'ranged') return false;
    face(m, dx, dy);
    setClip(m, 'idle');
    return true;
  }
  const busy = m.st === WINDUP || m.st === STRIKE || m.st === FUSE;
  const out = dist > AWAY_REACH || !free(g, m.area, m.x, m.y, HALF);
  if (dist > 9 || busy || !out) {
    if (!out || dist > 9) m.away = 0;
    m.way = null;
    return false;
  }
  m.away = (m.away ?? 0) + 1 / 60;
  if (m.away < AWAY_MAX) return false;
  if (dist < 1.3 && free(g, m.area, m.x, m.y, HALF)) {
    m.away = -1.5;
    m.way = null;
    m.st = def.ai === 'ranged' ? RECOVER : CHASE;
    m.t = def.ai === 'ranged' ? 1.5 : 0;
    return false;
  }
  const a = g.c.areas[m.area]!;
  if (!m.way || (m.wi ?? 0) >= m.way.length || g.rt.tick % 30 === 0) {
    m.way = findPath(
      g.rt.solid[m.area]!,
      a.w,
      a.h,
      Math.floor(m.x),
      Math.floor(m.y),
      Math.floor(g.s.x),
      Math.floor(g.s.y),
      1,
      3000,
    );
    m.wi = 0;
  }
  let gx = dx;
  let gy = dy;
  if (m.way && (m.wi ?? 0) < m.way.length) {
    gx = m.way[m.wi!]! + 0.5 - m.x;
    gy = m.way[m.wi! + 1]! + 0.5 - m.y;
    if (Math.hypot(gx, gy) < 0.2) m.wi! += 2;
  }
  const gl = Math.hypot(gx, gy) || 1;
  const sp = Math.max(def.speed, 2.2) / 60;
  if (!moveMob(g, m, (gx / gl) * sp, (gy / gl) * sp)) {
    // nothing it can walk on between: it comes back out of view where it could have walked to (package 86), and else
    // (package 78) gives up: a mob never appears where it could not have walked to, nor on the screen
    m.way = null;
    if (m.away > AWAY_MAX + 2 && !comeBackOut(g, m, true)) giveUp(g, m);
  }
  face(m, gx, gy);
  setClip(m, 'walk');
  return true;
}
/** Is there a way on foot from where this mob stands to the tile at (x, y)? (Package 78.) */
export function canWalkTo(g: Game, m: Mob, x: number, y: number): boolean {
  const a = g.c.areas[m.area]!;
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  const sx = Math.floor(m.x);
  const sy = Math.floor(m.y);
  if (sx === tx && sy === ty) return true;
  return findPath(g.rt.solid[m.area]!, a.w, a.h, sx, sy, tx, ty, 0, 3000) !== null;
}

/**
 * Package 78: a mob with no way to her gives up. One of the story or a den is put out of view on ground she can walk to
 * (or, with none, stays where it is and tries again later); any other fades out where it stands (it is never put
 * beside her through a wall or over water).
 */
function giveUp(g: Game, m: Mob): void {
  if (m.tag === 'story' || m.tag?.startsWith('den:')) {
    // A fight she must win can never be left waiting where she cannot reach it (a quest would stop for good): the mob
    // comes round to open ground out of the view that she CAN walk to, and walks in from there. With no such ground
    // (a room smaller than the view, or she stands against an area edge) it stays where it is, in sight, and tries again
    // later.
    comeBackOut(g, m, false);
    m.away = -1.5;
    return;
  }
  puff(g, m);
}

/**
 * Package 86: where a mob that must come back to her may be put. A free tile out of the view (86b: no part of its
 * sprite is ever inside the camera, so nothing pops in on screen), 8.5 to 12 tiles from her so it still sees her and
 * walks in, that she can reach on foot. With `fromMob` the mob must also have a way on foot to that tile from where
 * it stands (a hostile one shut in a pocket has none and fades); a story or den mob is taken out of its pocket
 * whatever it stands in. Null when there is no such tile (a room smaller than the view: nothing comes back there
 * while she stands in it; it stays where it is and she can walk up to it).
 */
export function comeBackSpot(g: Game, m: Mob, fromMob: boolean): { x: number; y: number } | null {
  const s = g.s;
  if (m.area !== s.area) return null;
  const a = g.c.areas[m.area]!;
  const hx = Math.floor(s.x);
  const hy = Math.floor(s.y);
  const base = Math.atan2(m.y - s.y, m.x - s.x);
  const tall = g.c.mobs[m.id]?.tall ?? 2;
  for (const r of [8.5, 9, 9.5, 10, 10.5, 11, 11.5, 12])
    for (let k = 0; k < 24; k++) {
      // twenty-four points round her, starting on the mob's own side
      const ang = base + (k % 2 ? -1 : 1) * Math.ceil(k / 2) * (Math.PI / 12);
      const x = Math.floor(s.x + Math.cos(ang) * r) + 0.5;
      const y = Math.floor(s.y + Math.sin(ang) * r) + 0.5;
      if (x < 0 || y < 0 || x >= a.w || y >= a.h) continue;
      if (!spriteOffView(g, x, y, tall) || !free(g, m.area, x, y, HALF)) continue;
      if (findPath(g.rt.solid[m.area]!, a.w, a.h, hx, hy, Math.floor(x), Math.floor(y), 0, 3000) === null) continue;
      if (fromMob && !canWalkTo(g, m, x, y)) continue;
      return { x, y };
    }
  return null;
}

/** Put a mob on its come-back spot, in a puff, to walk in from there. False when there is none (it stays or fades). */
function comeBackOut(g: Game, m: Mob, fromMob: boolean): boolean {
  const spot = comeBackSpot(g, m, fromMob);
  if (!spot) return false;
  g.ev.push({ t: 'fx', id: 'puff', x: m.x, y: m.y });
  m.x = m.px = spot.x;
  m.y = m.py = spot.y;
  m.vx = 0;
  m.vy = 0;
  m.way = null;
  m.away = -1.5;
  // it has seen her and comes (a skeleton keeps its own rhythm)
  const def = g.c.mobs[m.id]!;
  if (def.ai !== 'ranged') {
    m.st = CHASE;
    m.t = 0;
  }
  return true;
}

/** Does this mob take part in the caps? Bosses, their little creepers and a calm or peaceful mob do not. */
function capped(g: Game, m: Mob): boolean {
  const def = g.c.mobs[m.id]!;
  if (m.gone || m.calm || def.role !== 'hostile' || def.ai === 'mini') return false;
  return !(def.ai === 'ender' && m.phase === 0);
}

/**
 * The caps (phase 2, part E): at most 2 hostile mobs after her in Gentle and 3 otherwise, and among them 1 creeper
 * in Gentle and 2 otherwise. The rest doze where they stand, story mobs too, and wake one by one as she wins.
 * The ones already awake keep their place, then the nearest. A boss fight and the village defence have their own rules.
 */
export function wakeUp(g: Game): void {
  const rt = g.rt;
  let open = false;
  for (const m of rt.mobs) if (!m.gone && g.c.mobs[m.id]?.role === 'boss') open = true;
  if (open || g.s.flags.defence_on) {
    for (const m of rt.mobs) m.doze = false;
    return;
  }
  const list: Mob[] = [];
  for (const m of rt.mobs) {
    if (capped(g, m)) list.push(m);
    else m.doze = false;
  }
  if (list.length === 0) return;
  const s = g.s;
  list.sort(
    (p, q) =>
      (p.doze ? 1 : 0) - (q.doze ? 1 : 0) || Math.hypot(p.x - s.x, p.y - s.y) - Math.hypot(q.x - s.x, q.y - s.y),
  );
  const cap = mobCaps(g);
  let all = 0;
  let creepers = 0;
  for (const m of list) {
    const creeper = g.c.mobs[m.id]!.ai === 'creeper';
    // a lit creeper is never sent to sleep: its fuse always runs out (package 51)
    const sleep = m.st !== FUSE && (all >= cap.all || (creeper && creepers >= cap.creepers));
    if (sleep) {
      if (!m.doze) {
        m.doze = true;
        m.st = IDLE;
        m.fuse = 0;
        m.vx = 0;
        m.vy = 0;
      }
      continue;
    }
    m.doze = false;
    all++;
    if (creeper) creepers++;
  }
}

function wander(g: Game, m: Mob, def: MobDef): void {
  m.t -= 1 / 60;
  if (m.t <= 0) {
    m.t = 1.5 + rand(g) * 2.5;
    if (rand(g) < 0.6) {
      const ang = rand(g) * Math.PI * 2;
      m.vx = Math.cos(ang) * def.speed * 0.45;
      m.vy = Math.sin(ang) * def.speed * 0.45;
    } else {
      m.vx = 0;
      m.vy = 0;
    }
  }
  if (m.vx || m.vy) {
    if (!moveMob(g, m, m.vx / 60, m.vy / 60)) {
      m.vx = 0;
      m.vy = 0;
    }
    face(m, m.vx, m.vy);
    setClip(m, 'walk');
  } else setClip(m, 'idle');
}

function aiChase(g: Game, m: Mob, def: MobDef, dx: number, dy: number, dist: number): void {
  if (m.calm) {
    wander(g, m, def);
    return;
  }
  switch (m.st) {
    case IDLE:
      if (dist < 8) {
        m.st = CHASE;
        // package 60: it shows it has seen her (the mark and a growl) and stands a moment before it comes
        m.t = NOTICE;
        g.ev.push({ t: 'sfx', id: def.sfx ?? 'groan', x: m.x, y: m.y });
        g.ev.push({ t: 'fx', id: 'warn', x: m.x, y: m.y, n: m.k });
      } else wander(g, m, def);
      return;
    case CHASE: {
      if (dist > 12) {
        m.st = IDLE;
        return;
      }
      if (m.t > 0) {
        m.t -= 1 / 60;
        face(m, dx, dy);
        setClip(m, 'idle');
        return;
      }
      if (dist < 1.15) {
        m.st = WINDUP;
        m.t = 0.55;
        setClip(m, 'attack');
        g.ev.push({ t: 'fx', id: 'warn', x: m.x, y: m.y, n: m.k });
        return;
      }
      const sp = def.speed / 60;
      moveMob(g, m, (dx / dist) * sp, (dy / dist) * sp);
      face(m, dx, dy);
      setClip(m, 'walk');
      return;
    }
    case WINDUP:
      m.t -= 1 / 60;
      if (m.t <= 0) {
        const was = g.rt.safeT;
        if (dist < 1.45) hurtHero(g, def.touch, m.x, m.y);
        m.st = RECOVER;
        // a swing that landed: it steps back a little longer, so a child who froze is not hit again at once
        m.t = was <= 0 && g.rt.safeT > 0 ? 1.6 : 0.9;
      }
      return;
    default:
      m.t -= 1 / 60;
      if (m.t <= 0) {
        m.st = CHASE;
        setClip(m, 'idle');
      }
  }
}

function aiHopper(g: Game, m: Mob, def: MobDef, dx: number, dy: number, dist: number): void {
  if (m.calm) {
    wander(g, m, def);
    return;
  }
  m.t -= 1 / 60;
  switch (m.st) {
    case IDLE:
    case CHASE:
      setClip(m, 'idle');
      face(m, dx, dy);
      if (dist > 11) {
        if (m.t <= 0) m.t = 1;
        return;
      }
      if (m.t <= 0) {
        // Crouch, flash, then hop.
        m.st = WINDUP;
        m.t = 0.4;
        if (dist < 3.2) g.ev.push({ t: 'fx', id: 'warn', x: m.x, y: m.y, n: m.k });
      }
      return;
    case WINDUP:
      if (m.t <= 0) {
        m.st = STRIKE;
        m.t = 0.42;
        // package 68: it lands just short of her, never on top of her picture where it cannot be seen
        const hop = Math.max(0, Math.min(dist - 1.05, 2.6)) / 0.42;
        m.vx = (dx / dist) * hop;
        m.vy = (dy / dist) * hop;
        setClip(m, 'hop');
        g.ev.push({ t: 'sfx', id: 'hop', x: m.x, y: m.y });
      }
      return;
    case STRIKE:
      moveMob(g, m, m.vx / 60, m.vy / 60);
      if (m.t <= 0) {
        if (dist < 1.25) hurtHero(g, def.touch, m.x, m.y);
        m.st = IDLE;
        m.t = 0.7 + rand(g) * 0.5;
      }
      return;
    default:
      m.st = IDLE;
  }
}

function aiCreeper(g: Game, m: Mob, def: MobDef, dx: number, dy: number, dist: number): void {
  if (m.calm) {
    wander(g, m, def);
    return;
  }
  switch (m.st) {
    case IDLE:
      if (dist < 7) m.st = CHASE;
      else wander(g, m, def);
      return;
    case CHASE: {
      if (dist > 12) {
        m.st = IDLE;
        return;
      }
      if (dist < CREEPER_FUSE_AT) {
        m.st = FUSE;
        m.fuse =
          def.ai === 'mini' ? 1.1 : m.tag === 'story' && !g.s.counts['mob:' + m.id] ? CREEPER_FUSE_FIRST : CREEPER_FUSE;
        m.fuseLen = m.fuse;
        setClip(m, 'attack');
        g.ev.push({ t: 'sfx', id: 'hiss', x: m.x, y: m.y });
        return;
      }
      const sp = def.speed / 60;
      moveMob(g, m, (dx / dist) * sp, (dy / dist) * sp);
      face(m, dx, dy);
      setClip(m, 'walk');
      return;
    }
    case FUSE:
      m.fuse -= 1 / 60;
      // It goes off where it stands however far she runs: she is safe once outside the ring.
      if (m.fuse <= 0) explode(g, m, dist);
      return;
    default:
      m.t -= 1 / 60;
      if (m.t <= 0) m.st = CHASE;
  }
}

/** The boom: hurts only if she is close, and breaks cracked rocks. The creeper itself is gone (no drops). */
export function explode(g: Game, m: Mob, dist: number): void {
  const a = g.c.areas[m.area]!;
  g.ev.push({ t: 'sfx', id: 'boom', x: m.x, y: m.y });
  g.ev.push({ t: 'fx', id: 'boom', x: m.x, y: m.y });
  g.ev.push({ t: 'shake', amt: 14 });
  g.ev.push({ t: 'flash' });
  // a little creeper's pop is a small one (its own touch value); a full creeper costs 2 hearts on Normal
  if (dist < CREEPER_BLAST) hurtHero(g, g.c.mobs[m.id]?.ai === 'mini' ? g.c.mobs[m.id]!.touch : 4, m.x, m.y);
  const live = g.rt.live[m.area]!;
  for (let i = 0; i < a.objects.length; i++) {
    if (!live[i]) continue;
    const o = a.objects[i]!;
    if (!g.c.objects[o.type]?.cracked) continue;
    if (Math.hypot(o.x + 0.5 - m.x, o.y + 0.5 - m.y) > 3.5) continue;
    g.s.taken[o.id] = 1;
    g.rt.dirty = true;
    g.ev.push({ t: 'fx', id: 'rubble', x: o.x + 0.5, y: o.y + 0.5 });
    g.ev.push({ t: 'reward', kind: 'secret', id: o.id });
  }
  m.gone = true;
  if (m.tag?.startsWith('den:')) denBeaten(g);
  g.s.counts.booms = (g.s.counts.booms ?? 0) + 1;
  // A mob that pops by itself still counts for a quest that is counting it, so a fight can never get stuck.
  questEvent(g, 'defeat', m.id, 1, m.zone);
}

function aiRanged(g: Game, m: Mob, def: MobDef, dx: number, dy: number, dist: number): void {
  if (m.calm) {
    wander(g, m, def);
    return;
  }
  face(m, dx, dy);
  if (m.st === WINDUP) {
    m.t -= 1 / 60;
    if (m.t <= 0) {
      const sp = 5.2;
      g.rt.shots.push({
        k: g.rt.nextK++,
        area: m.area,
        x: m.x,
        y: m.y - 0.6,
        vx: (dx / dist) * sp,
        vy: (dy / dist) * sp,
        life: 2.4,
        kind: 'arrow',
        r: 0.35,
        hostile: true,
        from: m.k,
      });
      g.ev.push({ t: 'sfx', id: 'arrow', x: m.x, y: m.y });
      m.st = RECOVER;
      m.t = 1.9 + rand(g) * 0.8;
      setClip(m, 'idle');
    }
    return;
  }
  if (dist > 13) {
    wander(g, m, def);
    return;
  }
  const sp = def.speed / 60;
  if (dist < 3.6) {
    moveMob(g, m, (-dx / dist) * sp, (-dy / dist) * sp);
    setClip(m, 'walk');
  } else if (dist > 6.2) {
    moveMob(g, m, (dx / dist) * sp, (dy / dist) * sp);
    setClip(m, 'walk');
  } else setClip(m, 'idle');
  m.t -= 1 / 60;
  if (m.t <= 0 && dist < 8.5) {
    m.st = WINDUP;
    m.t = 0.6;
    setClip(m, 'attack');
    g.ev.push({ t: 'fx', id: 'warn', x: m.x, y: m.y, n: m.k });
  }
}

function aiEnder(g: Game, m: Mob, def: MobDef, dx: number, dy: number, dist: number): void {
  // Shy and peaceful until hit. Then it blinks about and swats.
  if (m.phase === 0) {
    wander(g, m, def);
    return;
  }
  m.t -= 1 / 60;
  face(m, dx, dy);
  if (m.st === WINDUP) {
    if (m.t <= 0) {
      if (dist < 1.6) hurtHero(g, def.touch, m.x, m.y);
      m.st = RECOVER;
      m.t = 1.3;
      setClip(m, 'idle');
    }
    return;
  }
  if (m.t <= 0) {
    for (let tries = 0; tries < 10; tries++) {
      const ang = rand(g) * Math.PI * 2;
      const x = g.s.x + Math.cos(ang) * 1.3;
      const y = g.s.y + Math.sin(ang) * 1.3;
      // package 78: it blinks only to where it could have walked to (never to her side of a wall)
      if (!free(g, m.area, x, y, 0.3) || !canWalkTo(g, m, x, y)) continue;
      g.ev.push({ t: 'fx', id: 'blink', x: m.x, y: m.y });
      m.x = x;
      m.y = y;
      m.px = x;
      m.py = y;
      g.ev.push({ t: 'fx', id: 'blink', x, y });
      g.ev.push({ t: 'sfx', id: 'blink', x, y });
      break;
    }
    m.st = WINDUP;
    m.t = 0.7;
    setClip(m, 'attack');
    g.ev.push({ t: 'fx', id: 'warn', x: m.x, y: m.y, n: m.k });
  }
}

function stepShots(g: Game): void {
  const s = g.s;
  const shots = g.rt.shots;
  for (let i = shots.length - 1; i >= 0; i--) {
    const sh = shots[i];
    // the list was emptied under us (she was carried home by the shot before this one)
    if (!sh) continue;
    sh.x += sh.vx / 60;
    sh.y += sh.vy / 60;
    sh.life -= 1 / 60;
    let dead = sh.life <= 0;
    if (sh.kind === 'ring') {
      // The King's stomp ring rolls out and stops; a pillar between him and her blocks it.
      if (!dead) stepRing(g, sh);
    } else if (sh.hostile) {
      if (Math.hypot(s.x - sh.x, s.y - 0.5 - sh.y) < sh.r + 0.3) {
        // package 69: the hit marks the one that shot it, wherever it stands
        const by = sh.from !== undefined ? g.rt.mobs.find((m) => m.k === sh.from && !m.gone) : undefined;
        hurtHero(g, 2, sh.x - sh.vx, sh.y - sh.vy, by);
        dead = true;
      } else if (!free(g, sh.area, sh.x, sh.y + 0.6, 0.05)) dead = true;
    } else {
      // Her arrows: they bend towards the mob they were aimed at, hurt mobs only and pass everyone else.
      if (sh.tgt) steer(g, sh);
      // package 69: the high web it was aimed at goes with the first arrow that reaches it
      if (sh.web !== undefined && webHit(g, sh)) {
        shots.splice(i, 1);
        continue;
      }
      for (const m of g.rt.mobs) {
        if (m.gone || !arrowCanHit(g, m)) continue;
        if (Math.hypot(m.x - sh.x, m.y - 0.5 - sh.y) < sh.r + 0.4) {
          damage(g, m, sh.dmg ?? 1, sh.vx, sh.vy);
          dead = true;
          break;
        }
      }
      if (!dead && !free(g, sh.area, sh.x, sh.y + 0.6, 0.05)) {
        dead = true;
        if (!shootDown(g, sh)) landArrow(g, sh);
      } else if (!dead && sh.life <= 0) landArrow(g, sh);
    }
    if (dead) shots.splice(i, 1);
  }
}

// ---------------------------------------------------------------- the bow

/** The bow (phase 2, part D): 2 damage, one shot every 0.6 s, and it bends to a mob within 20 degrees and 8 tiles. */
export const BOW = { dmg: 2, every: 0.6, range: 8, cone: 20, speed: 13 } as const;
const COS_CONE = Math.cos((BOW.cone * Math.PI) / 180);

function arrowCanHit(g: Game, m: Mob): boolean {
  const def = g.c.mobs[m.id]!;
  if (def.role !== 'hostile' && def.role !== 'boss') return false;
  return !m.calm || def.ai === 'ender';
}

/** Package 69: X aims by itself at what an arrow is for within this range and cone, and turns to one this near. */
export const AIM = { range: 7, cone: 60, turn: 4 } as const;
const COS_AIM = Math.cos((AIM.cone * Math.PI) / 180);
export interface BowAim {
  x: number;
  /** ground y (an arrow flies 0.6 above it) */
  y: number;
  mob?: Mob;
  web?: number;
  /** she must turn to face it first */
  turn: boolean;
}
/**
 * Package 69: what X shoots at. The nearest hostile mob or high web within 7 tiles and 60 degrees of the way she
 * faces; else the nearest one within 4 tiles (she turns to it); else null. `near`: anything an arrow is for within
 * the bow's range in front of her (then the arrow still flies straight).
 */
export function bowPick(g: Game): { aim: BowAim | null; ahead: boolean } {
  const s = g.s;
  const [fx, fy] = DIRV[s.dir];
  let cone: BowAim | null = null;
  let coneD: number = AIM.range;
  let round: BowAim | null = null;
  let roundD: number = AIM.turn;
  let ahead = false;
  const look = (x: number, y: number, mob: Mob | undefined, web: number | undefined) => {
    const dx = x - s.x;
    const dy = y - s.y;
    const d = Math.hypot(dx, dy);
    if (d < 1e-3 || d > BOW.range) return;
    const c = (dx * fx + dy * fy) / d;
    if (c > 0) ahead = true;
    if (d <= coneD && c >= COS_AIM) {
      cone = { x, y, mob, web, turn: false };
      coneD = d;
    } else if (d <= roundD) {
      round = { x, y, mob, web, turn: true };
      roundD = d;
    }
  };
  for (const m of g.rt.mobs) if (!m.gone && m.area === s.area && arrowCanHit(g, m)) look(m.x, m.y, m, undefined);
  const a = g.c.areas[s.area]!;
  for (let i = 0; i < a.objects.length; i++) {
    const o = a.objects[i]!;
    if (g.c.objects[o.type]?.node?.tool !== 'bow' || !objLive(g, o) || g.s.nodes[o.id] !== undefined) continue;
    if (Math.abs(o.x + 0.5 - s.x) > BOW.range + 1 || Math.abs(o.y + 0.5 - s.y) > BOW.range + 1) continue;
    look(o.x + 0.5, o.y + 0.5, undefined, i);
  }
  return { aim: cone ?? round, ahead };
}

/** The mob a shot from here would bend to: within the cone and the range, the one nearest her line of aim. */
export function bowAim(g: Game): Mob | null {
  const s = g.s;
  const [fx, fy] = DIRV[s.dir];
  let best: Mob | null = null;
  let bestCos = COS_CONE - 1e-9;
  for (const m of g.rt.mobs) {
    if (m.gone || m.area !== s.area || !arrowCanHit(g, m)) continue;
    const dx = m.x - s.x;
    const dy = m.y - s.y;
    const d = Math.hypot(dx, dy);
    if (d > BOW.range || d < 1e-3) continue;
    const c = (dx * fx + dy * fy) / d;
    if (c > bestCos) {
      bestCos = c;
      best = m;
    }
  }
  return best;
}

/** X with a bow and an arrow: shoot the way she faces. Returns true when an arrow flew. */
export function shoot(g: Game, webIndex?: number): boolean {
  const s = g.s;
  const rt = g.rt;
  if (toolTier(g, 'bow') === 0 || rt.bowT > 0) return false;
  if (count(g, 'arrow') <= 0) {
    nudge(g, 'no_arrows');
    g.ev.push({ t: 'sfx', id: 'nope' });
    return false;
  }
  // package 69: X aims by itself; with nothing to hit in range no arrow is spent
  const picked = bowPick(g);
  const web = webIndex === undefined ? undefined : g.c.areas[s.area]?.objects[webIndex];
  const aim = web ? { x: web.x + 0.5, y: web.y + 0.5, web: webIndex, turn: false } : picked.aim;
  if (!aim && !picked.ahead) {
    nudge(g, 'nothing_to_shoot', 2);
    rt.bowT = BOW.every;
    return false;
  }
  if (aim?.turn) {
    const tx = aim.x - s.x;
    const ty = aim.y - s.y;
    s.dir = Math.abs(tx) > Math.abs(ty) ? (tx < 0 ? 'left' : 'right') : ty < 0 ? 'up' : 'down';
  }
  take(g, 'arrow', 1);
  rt.bowT = BOW.every;
  const [fx, fy] = DIRV[s.dir];
  const y0 = s.y - 0.6;
  const m = aim?.mob ?? (aim ? null : bowAim(g));
  let vx = fx;
  let vy = fy;
  if (aim || m) {
    const dx = (aim?.x ?? m!.x) - s.x;
    const dy = (aim?.y ?? m!.y) - (m ? 0.5 : 0.6) - y0;
    const d = Math.hypot(dx, dy) || 1;
    vx = dx / d;
    vy = dy / d;
  }
  rt.shots.push({
    k: rt.nextK++,
    area: s.area,
    x: s.x + fx * 0.3,
    y: y0 + fy * 0.3,
    vx: vx * BOW.speed,
    vy: vy * BOW.speed,
    life: BOW.range / BOW.speed + 0.15,
    kind: 'arrow',
    r: 0.3,
    hostile: false,
    dmg: bowDmg(g),
    tgt: m ? m.k : 0,
    web: aim?.web,
  });
  s.counts.shots = (s.counts.shots ?? 0) + 1;
  g.ev.push({ t: 'sfx', id: 'bow', x: s.x, y: s.y });
  g.ev.push({ t: 'act', kind: 'shoot' });
  return true;
}

/** Turn an arrow towards its mob, a little each step, so a moving mob is still hit. */
function steer(g: Game, sh: Shot): void {
  let m: Mob | null = null;
  for (const q of g.rt.mobs) if (q.k === sh.tgt) m = q;
  // (package 60: a mob that turned calm, or one the arrow has already flown past, is no longer chased: the arrow
  // flew back to it and missed the enemy behind)
  const past = m && (m.x - sh.x) * sh.vx + (m.y - 0.5 - sh.y) * sh.vy < 0;
  if (!m || m.gone || !arrowCanHit(g, m) || past) {
    sh.tgt = 0;
    return;
  }
  const sp = Math.hypot(sh.vx, sh.vy) || BOW.speed;
  const dx = m.x - sh.x;
  const dy = m.y - 0.5 - sh.y;
  const d = Math.hypot(dx, dy) || 1;
  const k = 0.25;
  const nx = sh.vx / sp + (dx / d - sh.vx / sp) * k;
  const ny = sh.vy / sp + (dy / d - sh.vy / sp) * k;
  const n = Math.hypot(nx, ny) || 1;
  sh.vx = (nx / n) * sp;
  sh.vy = (ny / n) * sp;
}

/** Package 44a: an arrow that flies into a web hung too high for a sword (a node for the bow) brings it down. */
function shootDown(g: Game, sh: Shot): boolean {
  const a = g.c.areas[sh.area];
  const at = g.rt.objAt[sh.area];
  if (!a || !at) return false;
  const tx = Math.floor(sh.x);
  const ty = Math.floor(sh.y + 0.6);
  if (tx < 0 || ty < 0 || tx >= a.w || ty >= a.h) return false;
  const oi = at[ty * a.w + tx]!;
  if (oi < 0) return false;
  const o = a.objects[oi]!;
  const t = g.c.objects[o.type]!;
  if (t.node?.tool !== 'bow' || g.s.nodes[o.id] !== undefined || g.s.taken[o.id]) return false;
  // one arrow is enough: the web has 1 hit
  gather(g, o, oi, t);
  return true;
}

function webHit(g: Game, sh: Shot): boolean {
  const o = g.c.areas[sh.area]?.objects[sh.web!];
  if (!o) return false;
  if (Math.hypot(o.x + 0.5 - sh.x, o.y + 0.5 - (sh.y + 0.6)) > 0.75) return false;
  const t = g.c.objects[o.type]!;
  if (t.node?.tool !== 'bow' || g.s.nodes[o.id] !== undefined || g.s.taken[o.id]) return false;
  gather(g, o, sh.web!, t);
  return true;
}

function landArrow(g: Game, sh: Shot): void {
  g.ev.push({ t: 'fx', id: 'arrowland', x: sh.x, y: sh.y + 0.6 });
  g.ev.push({ t: 'sfx', id: 'thunk', x: sh.x, y: sh.y });
}

export function puff(g: Game, m: Mob): void {
  m.gone = true;
  g.ev.push({ t: 'fx', id: 'puff', x: m.x, y: m.y });
}

export function damage(g: Game, m: Mob, dmg: number, kx: number, ky: number): void {
  const def = g.c.mobs[m.id]!;
  if (def.role === 'boss') {
    if (!bossOpen(m)) {
      g.ev.push({ t: 'sfx', id: 'clang', x: m.x, y: m.y });
      g.ev.push({ t: 'fx', id: 'block', x: m.x, y: m.y });
      return;
    }
    // A boss takes one hit a swing whatever the sword, is not knocked about, and closes up again at once.
    // Bosses are never destroyed: the boss code decides what "beaten" means.
    bossHit(g, m, def);
    m.hurtT = 0.22;
    m.vx = 0;
    m.vy = 0;
    m.clip = 'hurt';
    m.ct = 0;
    g.ev.push({ t: 'sfx', id: 'hit', x: m.x, y: m.y });
    g.ev.push({ t: 'fx', id: 'hitmob', x: m.x, y: m.y, n: 1 });
    g.ev.push({ t: 'shake', amt: 3 });
    return;
  }
  m.hp -= dmg;
  m.hurtT = 0.22;
  m.doze = false;
  const k = Math.hypot(kx, ky) || 1;
  m.vx = (kx / k) * 5.5;
  m.vy = (ky / k) * 5.5;
  if (def.ai === 'ender') m.phase = 1;
  if (m.st === FUSE) {
    m.st = RECOVER;
    m.t = 0.8;
    m.fuse = 0;
  }
  m.clip = 'hurt';
  m.ct = 0;
  g.ev.push({ t: 'sfx', id: 'hit', x: m.x, y: m.y });
  g.ev.push({ t: 'fx', id: 'hitmob', x: m.x, y: m.y, n: dmg });
  g.ev.push({ t: 'shake', amt: 2 });
  // package 68: a hit always shows what is left ("2 left") on a mob that takes more than one
  if (m.hp > 0) g.ev.push({ t: 'fx', id: 'hitsleft', x: m.x, y: m.y, n: Math.ceil(m.hp / Math.max(1, dmg)) });
  if (m.hp > 0) return;
  m.gone = true;
  g.ev.push({ t: 'fx', id: 'puff', x: m.x, y: m.y });
  g.ev.push({ t: 'sfx', id: 'pop', x: m.x, y: m.y });
  for (const y of def.drops) {
    if (y.p !== undefined && rand(g) > y.p) continue;
    const n = randInt(g, y.min, y.max);
    if (n > 0) {
      give(g, y.item, n);
      g.ev.push({ t: 'fx', id: 'pop', x: m.x, y: m.y, item: y.item, n });
    }
  }
  g.s.counts['mob:' + m.id] = (g.s.counts['mob:' + m.id] ?? 0) + 1;
  if (m.tag?.startsWith('den:')) denBeaten(g);
  sticker(g, 'mob_' + m.id);
  g.ev.push({ t: 'act', kind: 'defeat', id: m.id });
  questEvent(g, 'defeat', m.id, 1, m.zone);
}
/** Can a boss be hit right now? The boss code adds 100 to its phase while it is closed. */
export function bossOpen(m: Mob): boolean {
  return m.phase < 100;
}

/** The sword lands. Returns true when it hit a mob. */
/** Would a swing land on a mob right now? (Same reach and facing test as the swing itself.) */
/** Package 68: beside a mob means within its swing reach plus half a tile, whichever way she faces. */
const BESIDE = 0.5;

/** The nearest hostile mob beside her (any side), or null. Space swings at it and she turns to it first. */
export function foeBeside(g: Game): Mob | null {
  const s = g.s;
  if (toolTier(g, 'sword') === 0) return null;
  let best: Mob | null = null;
  let bd = 1e9;
  for (const m of g.rt.mobs) {
    if (m.gone) continue;
    const def = g.c.mobs[m.id]!;
    if (def.role !== 'hostile' && def.role !== 'boss') continue;
    if (m.calm && def.ai !== 'ender') continue;
    const d = Math.hypot(m.x - s.x, m.y - s.y);
    if (d > SWING_REACH + BESIDE + (def.tall && def.tall > 2.5 ? 0.6 : 0)) continue;
    if (d < bd) {
      bd = d;
      best = m;
    }
  }
  return best;
}

export function mobInReach(g: Game): boolean {
  const s = g.s;
  if (toolTier(g, 'sword') === 0) return false;
  const [fx, fy] = DIRV[s.dir];
  for (const m of g.rt.mobs) {
    if (m.gone) continue;
    const def = g.c.mobs[m.id]!;
    if (def.role !== 'hostile' && def.role !== 'boss') continue;
    if (m.calm && def.ai !== 'ender') continue;
    const dx = m.x - s.x;
    const dy = m.y - s.y;
    const d = Math.hypot(dx, dy);
    if (d > SWING_REACH + (def.tall && def.tall > 2.5 ? 0.6 : 0)) continue;
    if (d > 0.7 && dx * fx + dy * fy < 0.1 * d) continue;
    return true;
  }
  return false;
}

export function swingHit(g: Game): boolean {
  const s = g.s;
  const dmg = swordDmg(g);
  if (dmg === 0) return false;
  const [fx, fy] = DIRV[s.dir];
  let hit = false;
  for (const m of g.rt.mobs) {
    if (m.gone) continue;
    const def = g.c.mobs[m.id]!;
    if (def.role !== 'hostile' && def.role !== 'boss') continue;
    if (m.calm && def.ai !== 'ender') continue;
    const dx = m.x - s.x;
    const dy = m.y - s.y;
    const d = Math.hypot(dx, dy);
    // (she turned to a mob up to half a tile beyond the old reach: the swing reaches it too, package 68)
    const reach = SWING_REACH + BESIDE + (def.tall && def.tall > 2.5 ? 0.6 : 0);
    if (d > reach) continue;
    if (d > 0.7 && dx * fx + dy * fy < 0.1 * d) continue;
    damage(g, m, dmg, dx || fx, dy || fy);
    hit = true;
  }
  return hit;
}
