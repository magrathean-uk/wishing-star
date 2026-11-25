// The two bosses. Neither is ever destroyed: the Spider Jockey runs off, and the Creeper King calms down.
//
// Both fights are made of rounds. A round is: the boss attacks (closed: a hit goes "clang"), then it is dizzy
// (open). One hit while it is open counts, whatever the sword, and closes it again. So hits = rounds.
// Every attack has a wind-up with a warning mark, and nothing here can be lost for good: the hits landed are
// kept in the save, and if her hearts run out she wakes at the door with full hearts.
import { rand } from './cond.ts';
import { free } from './grid.ts';
import { hurtHero, nudge } from './hero.ts';
import { CHASE, explode, IDLE, makeMob, moveMob, puff, RECOVER, STRIKE, WINDUP } from './mobs.ts';
import { applyFx, place, questEvent } from './quests.ts';
import type { Game, Mob, MobDef } from './types.ts';

/** Added to m.phase while the boss cannot be hit. m.phase % SHIELD is the part of the fight. */
export const SHIELD = 100;
/** Boss states beside the shared ones: dizzy and open, and backing off after a hit. */
export const OPEN = 7;
export const BACK = 8;

const DT = 1 / 60;
/** She must come this close before a waiting boss starts. */
const WAKE = 12;
/** Seconds before the first attack and after a new part begins: time to read the toast. */
const INTRO = 2.5;
const NEW_PART = 3.2;
/** Seconds a boss reels after a hit before it starts again. */
const REEL = 1.3;

// Spider Jockey
/** Hits on the rider once he is off the spider (the spider takes the rest). */
export const RIDER_HITS = 3;
export const HOP_WINDUP = 0.8;
export const HOP_TIME = 0.45;
/** Farthest a hop carries, in tiles. */
export const HOP_REACH = 5;
/** She is bumped when the spider lands this close. */
export const HOP_HIT = 1.2;
export const SHOT_WINDUP = 0.8;
const ARROW_SPEED = 5;

// Creeper King
/** Tiles a second the stomp ring rolls out, and where it stops. */
export const RING_SPEED = 3.2;
export const RING_REACH = 5.5;
export const RING_WINDUP = 1.2;
export const FUSE_TIME = 4.5;
/** The little creepers: the second follows the first after MINI_GAP seconds, and they give up after MINI_TIME. */
const MINI_GAP = 1.5;
const MINI_TIME = 10;
/** Half hearts on Normal (Gentle halves them): the ring costs 1 heart. The big boom is his touch value: 2 hearts. */
const RING_HURT = 2;

function face(m: Mob, dx: number, dy: number): void {
  m.dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'down';
}
function clip(m: Mob, c: Mob['clip']): void {
  if (m.clip !== c) {
    m.clip = c;
    m.ct = 0;
  }
}
const part = (m: Mob): number => m.phase % SHIELD;
const hitsOn = (m: Mob, def: MobDef): number => def.hp - m.hp;

/** Which part of the fight the hits left belong to. */
function partFor(def: MobDef, hp: number): number {
  if (def.ai === 'jockey') return hp > RIDER_HITS ? 0 : 1;
  return hp > 6 ? 0 : hp > 3 ? 1 : hp > 0 ? 2 : 3;
}

export function stepBoss(g: Game, m: Mob, def: MobDef, dx: number, dy: number, dist: number): void {
  if (def.ai === 'jockey') jockey(g, m, def, dx, dy, dist);
  else if (def.ai === 'king') king(g, m, def, dx, dy, dist);
}

/** A story spawn of a boss: always at its named place, with the hits already landed. Never two at once. */
export function spawnBoss(g: Game, id: string, at: string): void {
  const p = place(g, at);
  const def = g.c.mobs[id];
  if (!p || !def || p.area !== g.s.area) return;
  for (const o of g.rt.mobs) if (o.id === id && !o.gone) return;
  const m = makeMob(g, id, p.x + 0.5, p.y + 0.5, at);
  m.tag = 'story';
  const hits = Math.max(0, Math.min(def.hp - 1, g.s.counts['boss:' + id] ?? 0));
  m.hp = def.hp - hits;
  rest(g, m, def);
}

/** Back to its place, closed and waiting for her to come near. */
function rest(g: Game, m: Mob, def: MobDef): void {
  const p = place(g, m.zone);
  if (p) {
    m.x = p.x + 0.5;
    m.y = p.y + 0.5;
    m.px = m.x;
    m.py = m.y;
  }
  m.phase = partFor(def, m.hp) + SHIELD;
  m.st = IDLE;
  m.t = 0;
  m.n2 = 0;
  m.fuse = 0;
  m.vx = 0;
  m.vy = 0;
  m.hurtT = 0;
  clip(m, 'idle');
}

/** She has come near: the boss starts. Any ordinary mob about leaves, so the fight is easy to read. */
function wake(g: Game, m: Mob, toast: string): void {
  m.st = RECOVER;
  m.t = INTRO;
  for (const o of g.rt.mobs)
    if (o !== m && !o.gone && o.tag !== 'story' && g.c.mobs[o.id]?.role === 'hostile') puff(g, o);
  g.ev.push({ t: 'toast', kind: 'info', text: toast });
}

/** A hit that counts (the boss was open): one hit a swing, and it closes up again. Called by damage(). */
export function bossHit(g: Game, m: Mob, def: MobDef): void {
  m.hp = Math.max(0, m.hp - 1);
  g.s.counts['boss:' + m.id] = hitsOn(m, def);
  m.phase = part(m) + SHIELD;
  m.st = BACK;
  m.t = REEL;
  m.n2 = 0;
  m.fuse = 0;
}

/**
 * Her hearts ran out while a boss is about: nothing is lost. She wakes at the door of the hall (or the mouth of
 * the cave) with full hearts, and the boss goes back to its place with the hits it already has.
 */
export function bossFaint(g: Game): boolean {
  const s = g.s;
  let boss: Mob | null = null;
  for (const m of g.rt.mobs) if (!m.gone && m.area === s.area && g.c.mobs[m.id]?.role === 'boss') boss = m;
  if (!boss) return false;
  s.hp = s.maxHp;
  g.rt.safeT = 3;
  const door = place(g, s.area + '_entry');
  if (door && door.area === s.area) {
    s.x = door.x + 0.5;
    s.y = door.y + 0.5;
    g.rt.px = s.x;
    g.rt.py = s.y;
  }
  s.counts.bossFaints = (s.counts.bossFaints ?? 0) + 1;
  rest(g, boss, g.c.mobs[boss.id]!);
  // Marked, not removed: this can be called from inside the loops over the mobs and the shots.
  for (const o of g.rt.mobs) if (o.id === 'mini_creeper') o.gone = true;
  for (const sh of g.rt.shots) sh.life = 0;
  nudge(g, boss.id === 'creeper_king' ? 'king_again' : 'jockey_again', 6);
  g.ev.push({ t: 'flash', color: 0xfff3b0 });
  g.ev.push({ t: 'sfx', id: 'heart' });
  g.ev.push({ t: 'fx', id: 'heart', x: s.x, y: s.y - 1, n: 4 });
  return true;
}

/** Is something solid (a pillar) between a point and her? Kind: one of three close lines is enough. */
export function sheltered(g: Game, fromX: number, fromY: number): boolean {
  const s = g.s;
  const a = g.c.areas[s.area]!;
  const solid = g.rt.solid[s.area]!;
  const dx = s.x - fromX;
  const dy = s.y - fromY;
  const d = Math.hypot(dx, dy);
  if (d < 1) return false;
  const steps = Math.ceil(d * 4);
  for (let side = -1; side <= 1; side++) {
    // the same line moved a little to her left and right
    const ox = (-dy / d) * side * 0.4;
    const oy = (dx / d) * side * 0.4;
    for (let i = 1; i < steps; i++) {
      const x = Math.floor(fromX + ox + (dx * i) / steps);
      const y = Math.floor(fromY + oy + (dy * i) / steps);
      if (x < 0 || y < 0 || x >= a.w || y >= a.h) continue;
      if (solid[y * a.w + x]) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------- Spider Jockey

/**
 * Spider Jockey: a skeleton riding a spider. Six hits.
 *  Part 0, three rounds on the spider: it creeps up, crouches (0.8 s, a mark where it will land: the spot she
 *   stood on when the crouch began), hops there and is dizzy. One hop in round one, then two, then three.
 *  Part 1, three rounds on foot: the rider keeps his distance and shoots two or three slow arrows, each after a
 *   0.8 s wind-up. Pillars stop arrows. Then he reloads: dizzy and open.
 * After the last hit they both run away.
 */
function jockey(g: Game, m: Mob, def: MobDef, dx: number, dy: number, dist: number): void {
  m.t -= DT;
  if (m.hp <= 0) {
    m.gone = true;
    g.ev.push({ t: 'fx', id: 'puff', x: m.x, y: m.y });
    g.ev.push({ t: 'fx', id: 'confetti', x: m.x, y: m.y });
    g.ev.push({ t: 'sfx', id: 'fanfare' });
    g.s.counts['mob:' + m.id] = (g.s.counts['mob:' + m.id] ?? 0) + 1;
    applyFx(g, { flags: ['jockey_beaten', 'trophy_spider_jockey'], stickers: ['mob_spider_jockey'] });
    questEvent(g, 'defeat', 'spider_jockey');
    return;
  }
  const want = partFor(def, m.hp);
  if (want !== part(m)) {
    // The spider has had enough and scuttles off. The rider gets down.
    m.phase = want + SHIELD;
    m.st = RECOVER;
    m.t = NEW_PART;
    m.n2 = 0;
    clip(m, 'hurt');
    g.ev.push({ t: 'fx', id: 'puff', x: m.x, y: m.y });
    g.ev.push({ t: 'sfx', id: 'pop' });
    g.ev.push({ t: 'toast', kind: 'info', text: 'jockey_off' });
    // a part of the fight won is a moment of its own (the tracker ticks, and the pacing check sees it)
    g.ev.push({ t: 'reward', kind: 'step', id: 'boss:spider_jockey:' + want });
    return;
  }
  const foot = want === 1;
  const round = hitsOn(m, def) - (foot ? def.hp - RIDER_HITS : 0);
  if (m.st !== STRIKE || foot) face(m, dx, dy);
  switch (m.st) {
    case IDLE:
      clip(m, 'idle');
      if (dist < WAKE) {
        wake(g, m, foot ? 'jockey_off' : 'jockey_start');
        g.ev.push({ t: 'sfx', id: def.sfx ?? 'rattle', x: m.x, y: m.y });
      }
      return;
    case BACK: {
      // just hit: it backs away from her, then comes again
      clip(m, 'hurt');
      const sp = (foot ? 3.6 : 3) * DT;
      if (dist < 7) moveMob(g, m, (-dx / dist) * sp, (-dy / dist) * sp);
      if (m.t <= 0) {
        m.st = RECOVER;
        m.t = 0.3;
      }
      return;
    }
    case RECOVER:
      clip(m, 'idle');
      if (m.t <= 0) {
        m.st = CHASE;
        m.t = m.n2 ? 0.7 + rand(g) * 0.4 : 1.6 + rand(g) * 0.8;
      }
      return;
    case OPEN:
      clip(m, 'dizzy');
      if (m.t <= 0) {
        // she missed the moment: it shakes its head and starts again
        m.phase = want + SHIELD;
        m.n2 = 0;
        m.st = RECOVER;
        m.t = 0.5;
      }
      return;
    default:
      break;
  }
  if (!foot) {
    const hops = round + 1;
    switch (m.st) {
      case CHASE: {
        const sp = def.speed * DT;
        if (dist > 2.8) moveMob(g, m, (dx / dist) * sp, (dy / dist) * sp);
        clip(m, 'walk');
        // crouch once she is in hopping range (or after a long wait, wherever she is)
        if ((m.t <= 0 && dist < HOP_REACH) || m.t <= -4) {
          const far = Math.min(dist, HOP_REACH);
          m.vx = ((dx / dist) * far) / HOP_TIME;
          m.vy = ((dy / dist) * far) / HOP_TIME;
          m.st = WINDUP;
          m.t = HOP_WINDUP;
          clip(m, 'attack');
          g.ev.push({ t: 'fx', id: 'warn', x: m.x, y: m.y, n: m.k });
          g.ev.push({ t: 'fx', id: 'hopmark', x: m.x + m.vx * HOP_TIME, y: m.y + m.vy * HOP_TIME, n: HOP_HIT });
        }
        return;
      }
      case WINDUP:
        if (m.t <= 0) {
          m.st = STRIKE;
          m.t = HOP_TIME;
          clip(m, 'hop');
          g.ev.push({ t: 'sfx', id: 'hop', x: m.x, y: m.y });
        }
        return;
      case STRIKE:
        moveMob(g, m, m.vx * DT, m.vy * DT);
        if (m.t <= 0) {
          g.ev.push({ t: 'fx', id: 'thump', x: m.x, y: m.y });
          g.ev.push({ t: 'shake', amt: 4 });
          if (Math.hypot(g.s.x - m.x, g.s.y - m.y) < HOP_HIT) hurtHero(g, def.touch, m.x, m.y);
          // she may have been carried to the cave mouth by that: then it is already back in its place
          if (m.st !== STRIKE) return;
          m.n2 = (m.n2 ?? 0) + 1;
          if (m.n2 >= hops) open(g, m, 2.8);
          else {
            m.st = RECOVER;
            m.t = 0.5;
          }
        }
        return;
      default:
        m.st = RECOVER;
        return;
    }
  }
  // on foot
  const arrows = round === 0 ? 2 : 3;
  switch (m.st) {
    case CHASE: {
      // he keeps 5 to 7 tiles away, then stands and shoots
      const sp = def.speed * 0.9 * DT;
      if (dist < 5) {
        moveMob(g, m, (-dx / dist) * sp, (-dy / dist) * sp);
        clip(m, 'walk');
      } else if (dist > 7.5) {
        moveMob(g, m, (dx / dist) * sp, (dy / dist) * sp);
        clip(m, 'walk');
      } else clip(m, 'idle');
      if (m.t <= 0 && dist < 10) aim(g, m);
      return;
    }
    case WINDUP:
      if (m.t <= 0) {
        g.rt.shots.push({
          k: g.rt.nextK++,
          area: m.area,
          x: m.x,
          y: m.y - 0.6,
          vx: (dx / dist) * ARROW_SPEED,
          vy: (dy / dist) * ARROW_SPEED,
          life: 2.6,
          kind: 'arrow',
          r: 0.35,
          hostile: true,
          from: m.k,
        });
        g.ev.push({ t: 'sfx', id: 'arrow', x: m.x, y: m.y });
        m.n2 = (m.n2 ?? 0) + 1;
        if (m.n2 >= arrows) open(g, m, 3.4);
        else {
          m.st = STRIKE;
          m.t = 0.45;
          clip(m, 'idle');
        }
      }
      return;
    case STRIKE:
      // the short pause between two arrows
      if (m.t <= 0) aim(g, m);
      return;
    default:
      m.st = RECOVER;
  }
}
function aim(g: Game, m: Mob): void {
  m.st = WINDUP;
  m.t = SHOT_WINDUP;
  clip(m, 'attack');
  g.ev.push({ t: 'fx', id: 'warn', x: m.x, y: m.y, n: m.k });
}
/** Dizzy: the open moment. */
function open(g: Game, m: Mob, secs: number): void {
  m.st = OPEN;
  m.t = secs;
  m.phase = part(m);
  m.fuse = 0;
  clip(m, 'dizzy');
  g.ev.push({ t: 'fx', id: 'dizzy', x: m.x, y: m.y, n: m.k });
}

// ---------------------------------------------------------------- Creeper King

/**
 * The Creeper King. He is panicking, not wicked. Nine hits calm him: three in each part, and he never moves.
 *  Part 0: he sends two little creepers and stays closed until they have popped or been hit. Then he rests: open.
 *  Part 1: he stomps (1.2 s wind-up) and a ring rolls out to RING_REACH tiles. Run back out of its reach or
 *   stand behind a pillar. Two rings in a round, three in the last. Then he is dizzy: open.
 *  Part 2: the long fuse. Hide behind a pillar until the boom, then hit him while he is dizzy.
 * m.phase holds the part, plus SHIELD while he cannot be hit. m.hp counts down from 9.
 */
function king(g: Game, m: Mob, def: MobDef, dx: number, dy: number, dist: number): void {
  const ph = part(m);
  m.t -= DT;
  face(m, dx, dy);
  const want = partFor(def, m.hp);
  if (want === 3) {
    if (!g.s.flags.king_calm) {
      clip(m, 'calm');
      m.calm = true;
      m.phase = 3;
      sweep(g);
      g.ev.push({ t: 'sfx', id: 'fanfare' });
      g.ev.push({ t: 'fx', id: 'confetti', x: m.x, y: m.y });
      applyFx(g, { flags: ['king_calm', 'trophy_creeper_king'], stickers: ['mob_creeper_king'] });
      // From here he is a friend: the story takes over and the fighting figure steps aside.
      m.gone = true;
      questEvent(g, 'defeat', 'creeper_king');
    }
    return;
  }
  if (want !== ph) {
    m.phase = want + SHIELD;
    m.st = RECOVER;
    m.t = NEW_PART;
    m.n2 = 0;
    m.fuse = 0;
    sweep(g);
    clip(m, 'hurt');
    g.ev.push({ t: 'toast', kind: 'info', text: 'king_phase' + want });
    g.ev.push({ t: 'shake', amt: 6 });
    if (want > 0) g.ev.push({ t: 'reward', kind: 'step', id: 'boss:creeper_king:' + want });
    return;
  }
  const round = hitsOn(m, def) - ph * 3;
  switch (m.st) {
    case IDLE:
      clip(m, 'idle');
      if (dist < WAKE) wake(g, m, 'king_phase' + ph);
      return;
    case BACK:
      // just hit: he wobbles, then starts his next go
      clip(m, 'hurt');
      if (m.t <= 0) {
        m.st = RECOVER;
        m.t = 0.5;
      }
      return;
    case OPEN:
      clip(m, 'dizzy');
      if (m.t <= 0) {
        m.phase = ph + SHIELD;
        m.n2 = 0;
        m.st = RECOVER;
        m.t = 0.8;
      }
      return;
    case RECOVER:
      if (m.t > 0) return;
      m.st = WINDUP;
      clip(m, 'attack');
      g.ev.push({ t: 'fx', id: 'warn', x: m.x, y: m.y, n: m.k });
      if (ph === 0) m.t = 1;
      else if (ph === 1) {
        m.t = RING_WINDUP;
        g.ev.push({ t: 'fx', id: 'ringmark', x: m.x, y: m.y, n: RING_REACH });
      } else {
        m.t = FUSE_TIME;
        m.fuse = FUSE_TIME;
        g.ev.push({ t: 'sfx', id: 'hiss' });
        if (round === 0) g.ev.push({ t: 'toast', kind: 'info', text: 'king_hide' });
        else nudge(g, 'king_hide', FUSE_TIME);
      }
      return;
    default:
      break;
  }
  if (ph === 0) {
    if (m.st === WINDUP) {
      if (m.t > 0) return;
      sendMini(g, m, dx, dy, 1);
      m.n2 = 1;
      m.st = STRIKE;
      m.t = MINI_TIME;
      clip(m, 'idle');
      return;
    }
    // STRIKE: the little ones are out, the second a moment after the first so she can take them one at a time.
    // He rests when both are gone (they give up after MINI_TIME seconds).
    if (m.n2 === 1 && m.t <= MINI_TIME - MINI_GAP) {
      sendMini(g, m, dx, dy, -1);
      m.n2 = 2;
    }
    let minis = 0;
    for (const o of g.rt.mobs) {
      if (o.id !== 'mini_creeper' || o.gone) continue;
      if (m.t <= 0) puff(g, o);
      else minis++;
    }
    if (minis === 0 && m.n2 === 2) open(g, m, 3.8);
    return;
  }
  if (ph === 1) {
    const rings = round < 2 ? 2 : 3;
    if (m.st === WINDUP) {
      if (m.t > 0) return;
      g.rt.shots.push({
        k: g.rt.nextK++,
        area: m.area,
        x: m.x,
        y: m.y,
        vx: 0,
        vy: 0,
        // it starts under his feet, so standing right inside him is no safe spot
        life: RING_REACH / RING_SPEED,
        kind: 'ring',
        r: 0,
        hostile: true,
      });
      g.ev.push({ t: 'sfx', id: 'stomp' });
      g.ev.push({ t: 'shake', amt: 8 });
      m.n2 = (m.n2 ?? 0) + 1;
      m.st = STRIKE;
      m.t = RING_REACH / RING_SPEED + 0.15;
      clip(m, 'idle');
      return;
    }
    // STRIKE: the ring is rolling
    if (m.t > 0) return;
    if ((m.n2 ?? 0) >= rings) open(g, m, 3.8);
    else {
      m.st = WINDUP;
      m.t = RING_WINDUP;
      clip(m, 'attack');
      g.ev.push({ t: 'fx', id: 'warn', x: m.x, y: m.y, n: m.k });
      g.ev.push({ t: 'fx', id: 'ringmark', x: m.x, y: m.y, n: RING_REACH });
    }
    return;
  }
  // part 2: the long fuse
  if (m.st === WINDUP) {
    m.fuse = Math.max(0.01, m.t);
    if (m.t > 0) return;
    g.ev.push({ t: 'sfx', id: 'boom' });
    g.ev.push({ t: 'fx', id: 'boom', x: m.x, y: m.y, n: 3 });
    g.ev.push({ t: 'shake', amt: 12 });
    g.ev.push({ t: 'flash' });
    if (!sheltered(g, m.x, m.y)) hurtHero(g, def.touch, m.x, m.y);
    // she may have been carried to the door by that: then he is already back in his place, waiting
    if (m.st === WINDUP) open(g, m, 4.5);
    return;
  }
  m.st = RECOVER;
}

/** One little creeper, to one side of the way to her. */
function sendMini(g: Game, m: Mob, dx: number, dy: number, side: number): void {
  const base = Math.atan2(dy, dx);
  let x = m.x;
  let y = m.y + 1.8;
  for (let tries = 0; tries < 8; tries++) {
    const ang = base + side * (0.5 + rand(g) * 0.4 + tries * 0.7);
    x = m.x + Math.cos(ang) * 1.8;
    y = m.y + Math.sin(ang) * 1.8;
    if (free(g, m.area, x, y, 0.3)) break;
  }
  const c = makeMob(g, 'mini_creeper', x, y, 'king');
  // part of the boss: it keeps its own health, not the region's
  c.hp = g.c.mobs.mini_creeper!.hp;
  c.tag = 'story';
  c.st = CHASE;
  g.ev.push({ t: 'sfx', id: 'hiss', x, y });
}

/** Clear his little creepers and rings away (a new part starts, or he is calm). */
function sweep(g: Game): void {
  for (const o of g.rt.mobs) if (o.id === 'mini_creeper' && !o.gone) puff(g, o);
  for (const sh of g.rt.shots) sh.life = 0;
}

/** The stomp ring, one step: it grows, and bumps her as its edge passes unless a pillar is in the way. */
export function stepRing(g: Game, sh: { x: number; y: number; r: number }): void {
  sh.r += RING_SPEED * DT;
  if (g.rt.safeT > 0) return;
  const d = Math.hypot(g.s.x - sh.x, g.s.y - sh.y);
  if (Math.abs(d - sh.r) < 0.3 && !sheltered(g, sh.x, sh.y)) hurtHero(g, RING_HURT, sh.x, sh.y);
}
export { explode };
