// The hero: walking, facing, the one action key and everything it can do.
import { HALF, slide } from './walk.ts';
import { animalAct, animalNear, petsFollow } from './animals.ts';
import { atHome, bestTool, give, makeRoom, plotRect, promised, take, toolTier } from './bag.ts';
import { placeItem } from './build.ts';
import { bossFaint } from './bosses.ts';
import { newDay, sleep } from './clock.ts';
import { count, DAWN_AT, DUSK_AT, NIGHT_AT, rand, randInt } from './cond.ts';
import { cropAct, cropAt, useSeed } from './farm.ts';
import { CAFE_SEAT, cafeSit } from './cafe.ts';
import { openPost } from './post.ts';
import { potAct } from './pots.ts';
import { startQuiz } from './quiz.ts';
import { shieldTakes, stepGear } from './gear.ts';
import { startFishing } from './fishing.ts';
import { barrierAt, free, nearestFree, objLive, rebuildArea, solidAt, TERRAIN, terrainAt } from './grid.ts';
import { endFun, funHint, placedFun, startFun, stepFun } from './fun.ts';
import { freeCupGo, postCup, startMini } from './minigames.ts';
import { canFeed, feedPond, whereLine } from './joys.ts';
import { foeBeside, shoot, swingHit } from './mobs.ts';
import { DOOR_SLACK, doorInto } from './grid.ts';

export { doorInto };
import { refreshBeasts } from './animals.ts';
import { npcBeside, npcNear, refreshNpcs, talkNpc } from './npcs.ts';
import { personBlock } from './people.ts';
import { boardJobs } from './island.ts';
import { besidePlace, joinAt, placeSpot } from './spots.ts';
import { applyFx, projectGateLine, projectNear, questEvent, setLine, sticker } from './quests.ts';
import { fill, say } from './talk.ts';
import { lightLamp } from './lamp.ts';
import { startLook } from './lookout.ts';
import { FIND_PREFIX, roomFound } from './rooms.ts';
import type { BuildSite, Dir, FunSpot, Game, Input, MapObj, ObjectType, Placed } from './types.ts';

export const WALK_SPEED = 4.5;
export { HALF } from './walk.ts';
const SWING_TIME = 0.34;
const SWING_HIT_AT = 0.12;

export const DIRV: Record<Dir, [number, number]> = { down: [0, 1], up: [0, -1], left: [-1, 0], right: [1, 0] };

export interface Target {
  kind:
    | 'npc'
    | 'animal'
    | 'obj'
    | 'placed'
    | 'site'
    | 'project'
    | 'questPlace'
    | 'questPlant'
    | 'water'
    | 'feed'
    | 'crop'
    | 'swing'
    | 'sand'
    | 'none';
  hint: string;
  seed?: string;
  obj?: MapObj;
  objIndex?: number;
  type?: ObjectType;
  placed?: Placed;
  site?: BuildSite;
  k?: number;
  /** a thing to play on (package 57a) */
  fun?: FunSpot;
  /** package 69: not straight ahead but beside her; Space turns her to it first */
  beside?: boolean;
  tx: number;
  ty: number;
}
const T: Target = { kind: 'none', hint: '', tx: 0, ty: 0 };

function frontTile(g: Game): [number, number] {
  const [dx, dy] = DIRV[g.s.dir];
  return [Math.floor(g.s.x + dx * 0.85), Math.floor(g.s.y + dy * 0.85)];
}

/**
 * The thing she faces (package 57a): the tile straight ahead, or, when that is empty, the tile ahead a little to
 * either side, so a tree, a chest or a swing she is half a tile off still answers Space. -1 when none.
 */
function facedObj(g: Game, a: { w: number; h: number }, objAt: Int32Array): number {
  const s = g.s;
  const [dx, dy] = DIRV[s.dir];
  for (const side of [0, 0.42, -0.42]) {
    const tx = Math.floor(s.x + dx * 0.85 + dy * side);
    const ty = Math.floor(s.y + dy * 0.85 + dx * side);
    if (tx < 0 || ty < 0 || tx >= a.w || ty >= a.h) continue;
    const oi = objAt[ty * a.w + tx]!;
    if (oi < 0) continue;
    const t = g.c.objects[g.c.areas[s.area]!.objects[oi]!.type];
    if (!t || (!t.interact && !t.node)) continue;
    if (t.node && g.s.nodes[g.c.areas[s.area]!.objects[oi]!.id] !== undefined && !t.interact) continue;
    if (side === 0 || t.interact !== 'fun' || t.solid) return oi;
  }
  return -1;
}

/**
 * Small finds lying on the ground (a long dog, a lost joey, a bottle, an X mark) are walked over, so Space reaches
 * them from anywhere within this many tiles of the middle of their tile, standing on them or beside them, facing
 * any way (package 51: before, only the one tile straight ahead counted, and never the one under her feet).
 */
export const PICK_REACH = 1.3;
const WALK_OVER = new Set(['pickup', 'bottle', 'dig']);
/** set by nearPick: how far (squared) the find it returned is */
let pickD2 = 0;

/** The walk-over find in reach: the nearest, with one in front of her winning a near tie. -1 when none. */
export function nearPick(g: Game): number {
  const s = g.s;
  const a = g.c.areas[s.area]!;
  const objAt = g.rt.objAt[s.area];
  if (!objAt) return -1;
  const [fx, fy] = DIRV[s.dir];
  const cx = Math.floor(s.x);
  const cy = Math.floor(s.y);
  let best = -1;
  let bestScore = 1e9;
  for (let ty = cy - 2; ty <= cy + 2; ty++)
    for (let tx = cx - 2; tx <= cx + 2; tx++) {
      if (tx < 0 || ty < 0 || tx >= a.w || ty >= a.h) continue;
      const oi = objAt[ty * a.w + tx]!;
      if (oi < 0) continue;
      const o = a.objects[oi]!;
      const t = g.c.objects[o.type];
      if (!t || t.solid || !t.interact || !WALK_OVER.has(t.interact)) continue;
      // an X mark she cannot dig yet must not take Space from what she is facing (a rock to mine, say)
      if (t.interact === 'dig' && toolTier(g, 'spade') === 0) continue;
      const dx = o.x + 0.5 - s.x;
      const dy = o.y + 0.5 - s.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > PICK_REACH * PICK_REACH) continue;
      const score = d2 - 0.3 * Math.max(0, dx * fx + dy * fy);
      if (score < bestScore) {
        best = oi;
        bestScore = score;
        pickD2 = d2;
      }
    }
  return best;
}

/** Is this spot where the tracked quest step points? That one wins when several things are in reach. */
function wanted(g: Game, x: number, y: number): boolean {
  const p = g.rt.target;
  return !!p && p.area === g.s.area && Math.abs(p.x + 0.5 - x) < 1.5 && Math.abs(p.y + 0.5 - y) < 1.5;
}

/** Does a (person or animal at x, y) beat the walk-over find `pick`? The quest's one first, then the nearer. */
function beatsPick(g: Game, pick: number, x: number, y: number): boolean {
  if (pick < 0) return true;
  const o = g.c.areas[g.s.area]!.objects[pick]!;
  const wa = wanted(g, x, y);
  const wb = wanted(g, o.x + 0.5, o.y + 0.5);
  if (wa !== wb) return wa;
  return (x - g.s.x) ** 2 + (y - g.s.y) ** 2 <= pickD2;
}

export function placedAt(g: Game, area: string, tx: number, ty: number, layer?: 'object' | 'floor'): Placed | null {
  let floor: Placed | null = null;
  for (const p of g.s.placed) {
    if (p.area !== area) continue;
    const def = g.c.items[p.item]?.place;
    if (!def) continue;
    const w = p.rot && p.rot % 2 ? (def.h ?? 1) : (def.w ?? 1);
    const h = p.rot && p.rot % 2 ? (def.w ?? 1) : (def.h ?? 1);
    if (tx < p.x || ty < p.y || tx >= p.x + w || ty >= p.y + h) continue;
    if (def.layer === 'object') {
      if (layer !== 'floor') return p;
    } else floor = p;
  }
  return layer === 'object' ? null : floor;
}

/** Does she know a recipe that makes a tool of this kind? */
export function knowsTool(g: Game, tool: string): boolean {
  for (const id of g.s.recipes) {
    const out = g.c.recipes[id]?.out;
    if (out && g.c.items[out]?.tool?.type === tool) return true;
  }
  return false;
}

const NODE_NEED: Record<string, string> = {
  axe: 'need_axe',
  pick: 'need_pick',
  sword: 'need_sword',
  spade: 'need_spade',
};

/** What would Space do right now? Fills the shared target record (no allocation). */
export function findTarget(g: Game): Target {
  const s = g.s;
  const a = g.c.areas[s.area]!;
  const [tx, ty] = frontTile(g);
  T.kind = 'none';
  T.hint = '';
  T.seed = undefined;
  T.obj = undefined;
  T.placed = undefined;
  T.site = undefined;
  T.type = undefined;
  T.fun = undefined;
  T.beside = undefined;
  T.tx = tx;
  T.ty = ty;
  // A mob she can hit comes first: Space swings whenever the swing would land, whatever else she stands
  // beside (a bench, a cart, a build site, a friend). Otherwise a fight next to something usable cannot be won.
  if (foeBeside(g)) {
    T.kind = 'swing';
    T.hint = 'swing';
    return T;
  }
  // G, 22 Nov 2026: feet in a mini-game's gold ring, Space starts it, whichever way she faces (src/core/spots.ts).
  // Only someone the goal wants, straight ahead, still comes first; and a host a talk just ended with rests a moment.
  const join = joinAt(g);
  if (join) {
    const ahead = npcNear(g);
    const cool = g.rt.talkCool;
    if (
      join.k &&
      (!cool || cool.k !== join.k || g.rt.tick >= cool.until) &&
      !(ahead && ahead.k !== join.k && ahead.mark === 2)
    ) {
      T.kind = 'npc';
      T.k = join.k;
      T.hint = 'play';
      return T;
    }
    if (!join.k && !(ahead && ahead.mark === 2)) {
      const o = a.objects[join.obj]!;
      const t = g.c.objects[o.type]!;
      T.kind = 'obj';
      T.obj = o;
      T.objIndex = join.obj;
      T.type = t;
      T.beside = true;
      T.tx = o.x;
      T.ty = o.y;
      T.hint = t.interact!;
      return T;
    }
  }
  // ... and beside the gold ring where a place step's thing goes, Space puts it there
  const spot = foeAbout(g) ? null : placeSpot(g);
  if (spot && besidePlace(g, spot)) {
    T.kind = 'questPlace';
    T.tx = spot.x;
    T.ty = spot.y;
    T.hint = 'place';
    return T;
  }
  let pick = nearPick(g);
  // package 68 (reach): a thing she faces that is used with Space (a chest, a sign, a post) beats a find lying beside
  // it, unless the find is the one the quest wants; the find hops into her bag as she walks anyway
  if (pick >= 0) {
    const objAt = g.rt.objAt[s.area];
    const fo = objAt ? facedObj(g, a, objAt) : -1;
    const ft = fo >= 0 && fo !== pick ? g.c.objects[a.objects[fo]!.type] : undefined;
    const po = a.objects[pick]!;
    if (ft?.interact && !ft.node && !WALK_OVER.has(ft.interact) && !wanted(g, po.x + 0.5, po.y + 0.5)) pick = -1;
  }
  let npc = npcNear(g);
  // package 69: someone a talk just ended with takes no Space for half a second; someone who said their small talk
  // this step comes after anything else she could use here
  let later: number | undefined;
  if (npc && quiet(g, npc.k)) {
    if (g.rt.talkCool?.k !== npc.k) later = npc.k;
    npc = null;
  }
  if (npc && beatsPick(g, pick, npc.x, npc.y)) {
    T.kind = 'npc';
    T.k = npc.k;
    T.hint = 'talk';
    return T;
  }
  const beast = animalNear(g);
  if (beast && beatsPick(g, pick, beast.x, beast.y)) {
    T.kind = 'animal';
    T.k = beast.k;
    // (an animal that follows her is never offered: package 57a, it needs no key)
    T.hint = beast.hint;
    return T;
  }
  if (pick >= 0) {
    const o = a.objects[pick]!;
    const t = g.c.objects[o.type]!;
    T.kind = 'obj';
    T.obj = o;
    T.objIndex = pick;
    T.type = t;
    T.tx = o.x;
    T.ty = o.y;
    T.hint = t.interact!;
    return T;
  }
  for (const site of a.sites) {
    if (s.flags[site.flag]) continue;
    if (site.if && !applies(g, site)) continue;
    if (Math.abs(s.x - (site.at.x + 0.5)) < 1.6 && Math.abs(s.y - (site.at.y + 0.5)) < 1.6) {
      T.kind = 'site';
      T.site = site;
      T.hint = 'build';
      return T;
    }
  }
  if (tx >= 0 && ty >= 0 && tx < a.w && ty < a.h) {
    const objAt = g.rt.objAt[s.area]!;
    let oi = facedObj(g, a, objAt);
    // the ground straight ahead (sand to dig, water to fish, a thing she put down) beats a thing a little to the side
    if (oi >= 0 && objAt[ty * a.w + tx] !== oi && groundAct(g, a, tx, ty)) oi = -1;
    // a thing to play on that she stands in (the sandpit, a puddle, a picnic blanket)
    if (oi < 0 && !groundAct(g, a, tx, ty)) {
      const under = objAt[Math.floor(s.y) * a.w + Math.floor(s.x)] ?? -1;
      if (under >= 0 && g.c.objects[a.objects[under]!.type]?.interact === 'fun') oi = under;
    }
    if (oi >= 0) {
      const o = a.objects[oi]!;
      const t = g.c.objects[o.type]!;
      T.obj = o;
      T.objIndex = oi;
      T.type = t;
      if (t.node && g.s.nodes[o.id] === undefined) {
        T.kind = 'obj';
        T.hint = t.node.verb;
        return T;
      }
      if (t.interact === 'fun' && t.fun) {
        T.kind = 'obj';
        T.fun = t.fun;
        T.hint = funHint(t.fun.move, o.type);
        return T;
      }
      if (t.interact) {
        T.kind = 'obj';
        T.hint = benchUpgrade(g, o) ? 'upgrade' : t.interact;
        return T;
      }
    }
    const p = placedAt(g, s.area, tx, ty) ?? placedAt(g, s.area, Math.floor(s.x), Math.floor(s.y), 'floor');
    if (p) {
      const use = g.c.items[p.item]?.place?.use;
      const fun = placedFun(p.item, use);
      if (fun) {
        // a chair, a sofa or a toy she has put in a house (package 57a)
        T.kind = 'placed';
        T.placed = p;
        T.fun = fun;
        T.hint = funHint(fun.move);
        return T;
      }
      const crop = cropAt(g, p.x, p.y);
      if (use === 'soil') {
        if (crop) {
          T.kind = 'crop';
          T.placed = p;
          T.hint = crop.ripe ? 'pick' : '';
          if (crop.ripe) return T;
        }
      } else if (usable(g, use)) {
        T.kind = 'placed';
        T.placed = p;
        T.hint = useHint(use!, p);
        return T;
      }
    }
    const ter = TERRAIN[terrainAt(a, tx, ty)];
    // package 74 (I9): bread for the pond from the far end of the mended jetty
    if (ter?.water && canFeed(g, tx, ty, toolTier(g, 'rod') > 0)) {
      T.kind = 'feed';
      T.hint = 'feed';
      return T;
    }
    if (ter?.water && toolTier(g, 'rod') > 0) {
      T.kind = 'water';
      T.hint = 'fish';
      return T;
    }
    if (ter?.name === 'sand' && toolTier(g, 'spade') > 0 && !solidAt(g, s.area, tx, ty)) {
      T.kind = 'sand';
      T.hint = 'dig';
      return T;
    }
  }
  // Package 60, 69: nothing ahead, but a thing she stands right beside (a sign, a bench, a chest, a tree, a rock, a
  // bush, a web she can reach, a thing to play on), facing any way: the nearest answers Space (the goal's own thing
  // wins a tie) and Space turns her to it first. A tree, a rock or a bush never wins when a door is as near.
  {
    const objAt = g.rt.objAt[s.area]!;
    let best = -1;
    let bd = 1.25 * 1.25;
    let bw = false;
    let door = 99;
    for (const d of a.doors) {
      const nx = Math.max(d.x, Math.min(s.x, d.x + 1));
      const ny = Math.max(d.y, Math.min(s.y, d.y + 1));
      door = Math.min(door, (nx - s.x) ** 2 + (ny - s.y) ** 2);
    }
    for (let oy = -1; oy <= 1; oy++)
      for (let ox = -1; ox <= 1; ox++) {
        const tx = Math.floor(s.x) + ox;
        const ty = Math.floor(s.y) + oy;
        if (tx < 0 || ty < 0 || tx >= a.w || ty >= a.h) continue;
        const oi = objAt[ty * a.w + tx]!;
        if (oi < 0) continue;
        const o = a.objects[oi]!;
        const t = g.c.objects[o.type];
        if (!t || !besideUse(g, o, t)) continue;
        // the distance from her to the nearest point of that tile
        const nx = Math.max(tx, Math.min(s.x, tx + 1));
        const ny = Math.max(ty, Math.min(s.y, ty + 1));
        const d = (nx - s.x) ** 2 + (ny - s.y) ** 2;
        if (t.node && !t.interact && door <= d + 0.01) continue;
        const w = wanted(g, o.x + 0.5, o.y + 0.5);
        if (d < bd - 0.01 || (Math.abs(d - bd) <= 0.01 && w && !bw)) {
          bd = d;
          best = oi;
          bw = w;
        }
      }
    // a person beside her as near as the thing (or nearer) is who Space is for
    let nb = npcBeside(g);
    if (nb && quiet(g, nb.k)) {
      if (g.rt.talkCool?.k !== nb.k) later ??= nb.k;
      nb = null;
    }
    if (nb && (best < 0 || Math.max(0, Math.hypot(nb.x - s.x, nb.y - s.y) - 0.5) <= Math.sqrt(bd) + 0.1)) {
      T.kind = 'npc';
      T.k = nb.k;
      T.hint = 'talk';
      return T;
    }
    if (best >= 0) {
      const o = a.objects[best]!;
      const t = g.c.objects[o.type]!;
      T.kind = 'obj';
      T.obj = o;
      T.objIndex = best;
      T.type = t;
      T.beside = true;
      T.tx = o.x;
      T.ty = o.y;
      if (t.node && !t.interact) T.hint = t.node.verb;
      else if (t.interact === 'fun' && t.fun) {
        T.fun = t.fun;
        T.hint = funHint(t.fun.move, o.type);
      } else T.hint = benchUpgrade(g, o) ? 'upgrade' : t.interact!;
      return T;
    }
    // package 68: the same for a thing she has put in a house (the bed from any tile beside it, a chest, a bench)
    let near: Placed | null = null;
    for (const p of s.placed) {
      if (p.area !== s.area) continue;
      const def = g.c.items[p.item]?.place;
      if (!def || !usable(g, def.use)) continue;
      const w = p.rot && p.rot % 2 ? (def.h ?? 1) : (def.w ?? 1);
      const h = p.rot && p.rot % 2 ? (def.w ?? 1) : (def.h ?? 1);
      const nx = Math.max(p.x, Math.min(s.x, p.x + w));
      const ny = Math.max(p.y, Math.min(s.y, p.y + h));
      const d = (nx - s.x) ** 2 + (ny - s.y) ** 2;
      if (d < bd) {
        bd = d;
        near = p;
      }
    }
    if (near) {
      T.kind = 'placed';
      T.placed = near;
      T.hint = useHint(g.c.items[near.item]!.place!.use!, near);
      return T;
    }
  }
  if (later !== undefined) {
    T.kind = 'npc';
    T.k = later;
    T.hint = 'talk';
    return T;
  }
  // package 71 (D78): at the place of a project not yet built, Space shows what it needs and starts its job.
  // Not with an enemy about: Space is her sword then (the home well's place is right where a zombie may meet her).
  const proj = foeAbout(g) ? null : projectNear(g, tx, ty);
  if (proj) {
    T.kind = 'project';
    T.site = proj;
    T.hint = 'project';
    return T;
  }
  // A tracked placement can be completed with the action button on an empty tile at home.
  const quest = s.tracked ? s.quests[s.tracked] : undefined;
  const step = quest && !quest.done && s.tracked ? g.c.quests[s.tracked]?.steps[quest.step] : undefined;
  if (step?.t === 'place' && count(g, step.item) > 0 && !foeAbout(g) && !barrierAt(g, s.area, tx, ty)) {
    const item = g.c.items[step.item]?.place;
    const home = s.area === 'cottage' || (s.area === 'island' && atHome(g));
    if (
      item &&
      home &&
      !(item.where === 'house' && s.area !== 'cottage') &&
      !(item.where === 'plot' && s.area !== 'island') &&
      !solidAt(g, s.area, tx, ty) &&
      !placedAt(g, s.area, tx, ty)
    ) {
      T.kind = 'questPlace';
      T.hint = 'place';
      return T;
    }
  }
  if (step?.t === 'grow' && s.area === 'island' && toolTier(g, 'spade') > 0 && !foeAbout(g)) {
    const plot = plotRect(g);
    const soil = placedAt(g, 'island', tx, ty, 'floor');
    if (
      tx >= plot.x &&
      tx < plot.x + plot.w &&
      ty >= plot.y &&
      ty < plot.y + plot.h &&
      !solidAt(g, 'island', tx, ty) &&
      !placedAt(g, 'island', tx, ty, 'object') &&
      (!soil || g.c.items[soil.item]?.place?.use === 'soil') &&
      !cropAt(g, tx, ty) &&
      !barrierAt(g, s.area, tx, ty)
    ) {
      for (const slot of s.bag) {
        if (slot && slot.n > 0 && g.c.items[slot.id]?.grows?.crop === step.crop) {
          T.kind = 'questPlant';
          T.hint = 'plant';
          T.seed = slot.id;
          return T;
        }
      }
    }
  }
  // Space still swings anywhere, but says so only when an enemy is about (package 53a: no "Swing" indoors)
  if (toolTier(g, 'sword') > 0) {
    T.kind = 'swing';
    T.hint = foeAbout(g) ? 'swing' : '';
  }
  return T;
}
/**
 * Package 69: does a thing on a tile beside her answer Space from there? A sign, a bench, a chest; a tree, a rock or a
 * bush she has the tool for (a high web is for the bow, a cut one is gone); a thing to play on.
 */
function besideUse(g: Game, o: MapObj, t: ObjectType): boolean {
  if (t.node && !t.interact) {
    if (g.s.nodes[o.id] !== undefined || t.node.tool === 'bow') return false;
    return !t.node.tool || toolTier(g, t.node.tool) >= (t.node.tier ?? 1);
  }
  if (!t.interact || WALK_OVER.has(t.interact)) return false;
  return t.interact !== 'fun' || !!t.fun;
}
/** Package 69: a person who just spoke (half a second) or said their small talk this step does not take Space first. */
function quiet(g: Game, k: number): boolean {
  const c = g.rt.talkCool;
  if (c && c.k === k && g.rt.tick < c.until) return true;
  // someone with a quest for her (a step, a hand-in, a job to give) always takes Space
  if (g.rt.npcs.some((n) => n.k === k && n.mark > 0)) return false;
  return g.rt.chatted?.[k] === g.rt.questRev;
}
/** A thing put down in a house that answers Space (not a fence, a seat or a toy; the bed rests just after waking). */
function usable(g: Game, use: string | undefined): boolean {
  if (!use || use === 'fence' || use === 'seat' || use === 'toy' || use === 'soil') return false;
  return use !== 'bed' || (g.rt.bedT ?? 0) <= 0;
}
function useHint(use: string, p?: Placed): string {
  switch (use) {
    case 'bed':
      return 'sleep';
    case 'chest':
    case 'gate':
      return 'open';
    case 'sign':
      // issue 66: a sign with nothing on it yet is written on, not read
      return p && !p.text ? 'write' : 'read';
    case 'jukebox':
      return 'play';
    case 'mirror':
      return 'mirror';
    case 'stand':
      return 'gear';
    case 'anvil':
      return 'upgrade';
    default:
      return 'craft';
  }
}
/** Does the tile ahead do something by itself: sand to dig, water to fish, a thing she has put down? */
function groundAct(g: Game, a: { w: number; h: number; terrain: string[] }, tx: number, ty: number): boolean {
  const ter = TERRAIN[a.terrain[ty]?.charAt(tx) ?? ''];
  if (ter?.water && toolTier(g, 'rod') > 0) return true;
  if (ter?.name === 'sand' && toolTier(g, 'spade') > 0 && !solidAt(g, g.s.area, tx, ty)) return true;
  return !!placedAt(g, g.s.area, tx, ty, 'object');
}
/** A hostile mob within a few tiles of her, here. */
function foeAbout(g: Game): boolean {
  return foeNear(g, 6);
}
function foeNear(g: Game, r: number): boolean {
  for (const m of g.rt.mobs) {
    if (m.gone || m.calm || m.hp <= 0) continue;
    const role = g.c.mobs[m.id]?.role;
    if (role !== 'hostile' && role !== 'boss') continue;
    if ((m.x - g.s.x) ** 2 + (m.y - g.s.y) ** 2 < r * r) return true;
  }
  return false;
}
function applies(g: Game, site: BuildSite): boolean {
  // imported lazily to avoid a cycle at module load
  return testCond(g, site);
}
import { test } from './cond.ts';
const testCond = (g: Game, site: BuildSite) => test(g, site.if);

// ---------------------------------------------------------------- movement

export function stepHero(g: Game, inp: Input): void {
  const s = g.s;
  const rt = g.rt;
  // package 60: standing inside something solid (an old save where a bench now stands, a thing placed on her):
  // she steps out to the nearest open spot, or no key could ever move her
  // Package 71 (D78): not during a turn on a thing to play on. She sits on the swing or the slide, which are solid:
  // unstick moved her off it each tick and the turn put her back, so the tick before (rt.px) was the spot off it and
  // the view drew her half way between the two on every other frame (G's "ghosting"). The turn's end steps her out.
  if (!rt.fun && !free(g, s.area, s.x, s.y, HALF)) unstick(g);
  rt.px = s.x;
  rt.py = s.y;
  rt.ct += 1 / 60;
  if (rt.safeT > 0) rt.safeT -= 1 / 60;
  if (rt.bowT > 0) rt.bowT -= 1 / 60;
  stepGear(g);
  if (rt.fun) {
    // a turn on a thing to play on (package 57a); a knock ends it
    if (rt.hurtT > 0) endFun(g);
    else if (stepFun(g, inp)) return;
  }
  if (rt.hurtT > 0) {
    rt.hurtT -= 1 / 60;
    if (rt.hurtT <= 0) setClip(g, 'idle');
    return;
  }
  if (rt.swingT > 0) {
    const before = rt.swingT;
    rt.swingT -= 1 / 60;
    const hitAt = SWING_TIME - SWING_HIT_AT;
    if (before > hitAt && rt.swingT <= hitAt) swingLands(g);
    if (rt.swingT <= 0) {
      setClip(g, 'idle');
      if (inp.hold) press(g);
    }
    return;
  }
  if (rt.emoteT > 0) {
    rt.emoteT -= 1 / 60;
    if (rt.emoteT <= 0 || inp.mx || inp.my) {
      rt.emoteT = 0;
      setClip(g, 'idle');
    } else return;
  }
  let mx = inp.mx;
  let my = inp.my;
  if (mx || my) {
    if (mx && my) {
      mx *= Math.SQRT1_2;
      my *= Math.SQRT1_2;
    }
    if (inp.mx && !inp.my) s.dir = inp.mx < 0 ? 'left' : 'right';
    else if (inp.my && !inp.mx) s.dir = inp.my < 0 ? 'up' : 'down';
    else if (
      !(
        (s.dir === 'left' && inp.mx < 0) ||
        (s.dir === 'right' && inp.mx > 0) ||
        (s.dir === 'up' && inp.my < 0) ||
        (s.dir === 'down' && inp.my > 0)
      )
    )
      s.dir = inp.mx < 0 ? 'left' : 'right';
    const a = g.c.areas[s.area]!;
    const here = terrainAt(a, Math.floor(s.x), Math.floor(s.y));
    const speed = (here === 'm' ? 3.3 : WALK_SPEED) / 60;
    moveBody(g, mx * speed, my * speed);
    setClip(g, 'walk');
    rt.under = here;
    s.counts.walked = (s.counts.walked ?? 0) + 1;
  } else setClip(g, 'idle');
  if (inp.act) press(g);
  // X shoots when she has a bow and an arrow.
  if (inp.fire) shoot(g);
  if (inp.use) useHot(g);
  if (inp.emote) {
    rt.emoteT = 1.6;
    setClip(g, 'cheer');
    g.ev.push({ t: 'sfx', id: 'emote' });
    g.ev.push({ t: 'fx', id: 'emote', x: s.x, y: s.y });
    g.ev.push({ t: 'act', kind: 'emote' });
  }
}

/** Move her to the nearest spot she can stand on, searching outwards in quarter tiles. */
function unstick(g: Game): void {
  const s = g.s;
  for (let r = 1; r <= 16; r++)
    for (let i = 0; i < r * 8; i++) {
      const a = (i / (r * 8)) * Math.PI * 2;
      const x = s.x + Math.cos(a) * r * 0.25;
      const y = s.y + Math.sin(a) * r * 0.25;
      if (free(g, s.area, x, y, HALF)) {
        s.x = x;
        s.y = y;
        return;
      }
    }
}

export function setClip(g: Game, clip: Game['rt']['clip']): void {
  if (g.rt.clip !== clip) {
    g.rt.clip = clip;
    g.rt.ct = 0;
  }
}

/** Move with sliding along walls and a little help round corners (src/core/walk.ts). */
export function moveBody(g: Game, dx: number, dy: number): void {
  const s = g.s;
  const area = s.area;
  const ox = s.x;
  const oy = s.y;
  const r = slide(g, area, s.x, s.y, dx, dy);
  s.x = r.x;
  s.y = r.y;
  if (r.bumpX) bump(g, r.bumpX, 0);
  else if (r.bumpY) bump(g, 0, r.bumpY);
  bossBlock(g, ox, oy);
  personBlock(g, ox, oy, dx, dy);
  const a = g.c.areas[area]!;
  const tx = Math.floor(s.x);
  const ty = Math.floor(s.y);
  for (const d of a.doors) {
    // package 68: a door takes her in only when she walks into it, never when she walks past along its front; walking
    // into it takes her in from anywhere on its row (or column) within a little over half a tile of it
    const into = doorInto(g, area, d);
    const here =
      (d.x === tx && d.y === ty) ||
      (!!into &&
        (into[0]
          ? tx === d.x && Math.abs(s.y - (d.y + 0.5)) < DOOR_SLACK
          : ty === d.y && Math.abs(s.x - (d.x + 0.5)) < DOOR_SLACK));
    if (here) {
      if (into && dx * into[0] + dy * into[1] <= 0) continue;
      if (d.if && !test(g, d.if)) {
        if (d.hint) nudge(g, d.hint);
        break;
      }
      enterArea(g, d.to, d.tx + 0.5, d.ty + 0.5, d.dir);
      break;
    }
  }
}

/**
 * A living boss is a round solid as wide as its picture: she slides round it. A step that does not take her
 * closer is always allowed, so she can never be stuck inside one (the spider lands where she stood).
 */
function bossBlock(g: Game, ox: number, oy: number): void {
  const s = g.s;
  for (const m of g.rt.mobs) {
    if (m.gone || m.area !== s.area || m.hp <= 0 || m.calm) continue;
    const def = g.c.mobs[m.id];
    if (def?.role !== 'boss') continue;
    // the rider on foot is a slim skeleton; the spider is wide, the King wider
    const body =
      m.phase % 100 === 1 && def.ai === 'jockey' ? 0.45 : (def.tall ?? 2) * (def.body === 'spider' ? 0.36 : 0.26);
    const r = body + HALF;
    const dx = s.x - m.x;
    const dy = s.y - m.y;
    const d = Math.hypot(dx, dy);
    if (d >= r) continue;
    const was = Math.hypot(ox - m.x, oy - m.y);
    if (d >= was) continue;
    const keep = Math.min(r, was);
    const nx = d > 1e-4 ? m.x + (dx / d) * keep : ox;
    const ny = d > 1e-4 ? m.y + (dy / d) * keep : oy;
    if (free(g, s.area, nx, ny, HALF)) {
      s.x = nx;
      s.y = ny;
    } else {
      s.x = ox;
      s.y = oy;
    }
  }
}

function bump(g: Game, dx: number, dy: number): void {
  if (g.rt.tick % 6) return;
  const tx = Math.floor(g.s.x + Math.sign(dx) * 0.8);
  const ty = Math.floor(g.s.y + Math.sign(dy) * 0.8);
  const b = barrierAt(g, g.s.area, tx, ty) ?? barrierAt(g, g.s.area, tx + Math.sign(dx), ty + Math.sign(dy));
  if (b) nudge(g, gateLine(g, b));
  else if (terrainAt(g.c.areas[g.s.area]!, tx, ty) === 'm' && !g.s.pouch.wellies) nudge(g, 'need_wellies');
}

/** What a closed way says: its own line when the strings have one ("Use the stepping stones"), else its hint. */
function gateLine(g: Game, b: { id: string; hint: string; flag: string }): string {
  if (g.c.strings[`gate:${b.id}`]) return `gate:${b.id}`;
  return (b.hint === 'gate_project' && projectGateLine(g, b.flag)) || b.hint;
}

/** A short line under the objective; keys come from the strings table. */
export function nudge(g: Game, key: string, secs = 3.5): void {
  const text = fill(g, g.c.strings[key] ?? key);
  if (g.rt.nudge === text && g.rt.nudgeT > 0) return;
  g.rt.nudge = text;
  g.rt.nudgeT = secs;
}

export function enterArea(g: Game, area: string, x: number, y: number, dir: Dir): void {
  const from = g.s.area;
  const ox = g.s.x;
  const oy = g.s.y;
  g.s.area = area;
  g.s.x = x;
  g.s.y = y;
  g.s.dir = dir;
  g.rt.px = x;
  g.rt.py = y;
  g.rt.mobs.length = 0;
  g.rt.shots.length = 0;
  g.rt.leading = 0;
  for (const a of g.s.animals) if (a.led) a.led = false;
  rebuildArea(g, area);
  // package 74 (I10): her pet comes through the door with her (the wolf from anywhere)
  petsFollow(g, from, area, ox, oy);
  refreshNpcs(g);
  refreshBeasts(g);
  // package 74 (I12): a friend's home with nobody in says where the nearest of them is (once, as she comes in)
  const where = from !== area && !(g.rt.nudgeT > 0) ? whereLine(g, area) : '';
  if (where) nudge(g, where, 4.5);
  g.ev.push({ t: 'area', from, to: area });
  g.ev.push({ t: 'sfx', id: 'door' });
}

// ---------------------------------------------------------------- the action key

function press(g: Game): void {
  const t = findTarget(g);
  const s = g.s;
  // package 69: a thing beside her that she does not face: she turns to it first
  if (t.beside && t.obj) faceTile(g, t.obj.x, t.obj.y, t.type?.w ?? 1, t.type?.h ?? 1);
  switch (t.kind) {
    case 'npc':
      talkNpc(g, t.k!);
      return;
    case 'animal':
      animalAct(g, t.k!);
      return;
    case 'questPlant':
      if (t.seed) useSeed(g, t.seed);
      return;
    case 'questPlace': {
      const spot = placeSpot(g);
      if (spot && spot.x === t.tx && spot.y === t.ty && besidePlace(g, spot)) {
        placeItem(g, spot.item, spot.x, spot.y);
        return;
      }
      const id = s.tracked;
      const quest = id ? s.quests[id] : undefined;
      const st = id && quest ? g.c.quests[id]?.steps[quest.step] : undefined;
      if (st?.t === 'place') placeItem(g, st.item, t.tx, t.ty);
      return;
    }
    case 'site':
      useSite(g, t.site!);
      return;
    case 'project':
      g.ev.push({ t: 'sfx', id: 'pop' });
      g.ev.push({ t: 'open', ui: 'project', arg: t.site!.id });
      return;
    case 'crop':
      cropAct(g, t.placed!);
      return;
    case 'placed':
      if (t.fun) {
        const p = t.placed!;
        const def = g.c.items[p.item]!.place!;
        const w = p.rot && p.rot % 2 ? (def.h ?? 1) : (def.w ?? 1);
        const h = p.rot && p.rot % 2 ? (def.w ?? 1) : (def.h ?? 1);
        startFun(g, t.fun, p.x, p.y, w, h, -1, p.k);
        return;
      }
      usePlaced(g, t.placed!);
      return;
    case 'water':
      startFishing(g, t.tx, t.ty);
      return;
    case 'feed':
      feedPond(g, t.tx, t.ty);
      return;
    case 'sand':
      if (count(g, 'sand') >= 99) return;
      startSwing(g);
      return;
    case 'obj': {
      const node = t.type!.node;
      if (node && s.nodes[t.obj!.id] === undefined) {
        if (node.tool === 'bow') {
          if (toolTier(g, 'bow') > 0) shoot(g, t.objIndex);
          else {
            nudge(g, 'too_high');
            g.ev.push({ t: 'sfx', id: 'nope' });
          }
          return;
        }
        if (node.tool && toolTier(g, node.tool) < (node.tier ?? 1)) {
          const none = toolTier(g, node.tool) === 0;
          const key = none ? (NODE_NEED[node.tool] ?? 'need_tool') : 'need_better_' + node.tool;
          // package 68: and where one comes from, when she knows how to make one ("Make one at the bench.")
          nudge(g, none && knowsTool(g, node.tool) && g.c.strings[`${key}_make`] ? `${key}_make` : key);
          g.ev.push({ t: 'sfx', id: 'nope' });
          return;
        }
        if (node.tool) startSwing(g);
        else gather(g, t.obj!, t.objIndex!, t.type!);
        return;
      }
      if (t.fun) {
        const ty = t.type!;
        startFun(g, t.fun, t.obj!.x, t.obj!.y, ty.w ?? 1, ty.h ?? 1, t.objIndex!);
        // package 73b: at a cafe table she eats something from the counter
        if (t.obj!.type === CAFE_SEAT) cafeSit(g, s.x, s.y);
        return;
      }
      if ((g.rt.shutT ?? 0) > 0 && (t.type!.interact === 'table' || t.type!.interact === 'furnace')) return;
      useObject(g, t.obj!, t.type!);
      return;
    }
    case 'swing': {
      // package 68: Space at a broken bridge or a closed way says what it needs (run a 0082)
      const gate = t.hint ? null : barrierAt(g, s.area, t.tx, t.ty);
      if (gate) nudge(g, gateLine(g, gate));
      startSwing(g);
      return;
    }
    default: {
      const gate = barrierAt(g, s.area, t.tx, t.ty);
      if (gate) nudge(g, gateLine(g, gate));
      return;
    }
  }
}

/** Turn her to the nearest point of a thing (x, y, w, h in tiles). */
function faceTile(g: Game, x: number, y: number, w: number, h: number): void {
  const s = g.s;
  const dx = Math.max(x, Math.min(s.x, x + w)) - s.x;
  const dy = Math.max(y, Math.min(s.y, y + h)) - s.y;
  if (Math.abs(dx) < 0.02 && Math.abs(dy) < 0.02) return;
  s.dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'down';
}

function startSwing(g: Game): void {
  // package 68: a child who mashes Space beside a mob hits it: she turns to the nearest one first
  const m = foeBeside(g);
  if (m) {
    const dx = m.x - g.s.x;
    const dy = m.y - g.s.y;
    if (Math.hypot(dx, dy) > 0.05)
      g.s.dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'down';
  }
  g.rt.swingT = SWING_TIME;
  setClip(g, 'swing');
  g.ev.push({ t: 'sfx', id: 'swing' });
}

/** The moment the swing connects: mobs first, then whatever she is facing. */
function swingLands(g: Game): void {
  if (swingHit(g)) return;
  const t = findTarget(g);
  if (t.kind === 'obj' && t.type?.node && g.s.nodes[t.obj!.id] === undefined) {
    const node = t.type.node;
    if (node.tool !== 'bow' && (!node.tool || toolTier(g, node.tool) >= (node.tier ?? 1)))
      gather(g, t.obj!, t.objIndex!, t.type);
  } else if (t.kind === 'sand') {
    give(g, 'sand', 1);
    g.ev.push({ t: 'fx', id: 'dust', x: t.tx + 0.5, y: t.ty + 0.5 });
    g.ev.push({ t: 'sfx', id: 'dig' });
    g.ev.push({ t: 'act', kind: 'gather', id: 'sand' });
  }
}

/** One hit on a resource. The last hit pops the goods out and uses the node up until morning. */
export function gather(g: Game, o: MapObj, index: number, t: ObjectType): void {
  const node = t.node!;
  const key = 'hit:' + o.id;
  const better = node.tool ? Math.max(1, toolTier(g, node.tool) - (node.tier ?? 1) + 1) : 1;
  const hits = (g.s.flags[key] ?? 0) + better;
  const cx = o.x + (t.w ?? 1) / 2;
  const cy = o.y + (t.h ?? 1) / 2;
  g.ev.push({ t: 'sfx', id: node.sfx ?? 'chop' });
  g.ev.push({ t: 'fx', id: 'hit', x: cx, y: cy, n: index, item: t.id });
  // package 60: a thorn bush or a web in the way goes at the first cut (two Spaces read as "nothing happened")
  const need = node.tool === 'sword' ? 1 : node.hits;
  if (hits < need) {
    g.s.flags[key] = hits;
    // package 69: every hit that counts says how many are left, as a mob does
    g.ev.push({ t: 'fx', id: 'hitsleft', x: cx, y: cy, n: Math.ceil((need - hits) / better) });
    return;
  }
  delete g.s.flags[key];
  if (node.regrow) g.s.nodes[o.id] = g.s.day;
  else g.s.taken[o.id] = 1;
  for (const y of node.yield) {
    if (y.p !== undefined && rand(g) > y.p) continue;
    const n = randInt(g, y.min, y.max);
    give(g, y.item, n);
    g.ev.push({ t: 'fx', id: 'pop', x: cx, y: cy, item: y.item, n });
  }
  g.s.counts[node.verb] = (g.s.counts[node.verb] ?? 0) + 1;
  g.ev.push({ t: 'act', kind: 'gather', id: t.id });
  g.ev.push({ t: 'fx', id: 'puff', x: cx, y: cy });
  g.rt.dirty = true;
}

/** How near (in tiles, from her middle to the thing's) a thing on the ground hops into the bag by itself. */
export const AUTO_PICK = 1.05;
/** A flower, a shell or a stick hops in by itself only while she carries fewer than this many (Space picks more). */
export const AUTO_CAP = 10;
/** ... and starts a new stack only while this many bag slots are still empty. */
export const AUTO_SPARE = 12;

/** Things on the ground hop into the bag as she walks over or beside them (package 57a: no key needed). */
export function pickUpDrops(g: Game): void {
  const s = g.s;
  for (let i = s.drops.length - 1; i >= 0; i--) {
    const d = s.drops[i]!;
    if (d.area !== s.area) continue;
    // a drop that landed in water, on a wall or under a tree is moved once to the nearest ground she can reach
    if (!free(g, d.area, d.x, d.y, 0.2)) {
      const out = nearestFree(g, d.area, Math.floor(d.x), Math.floor(d.y), 6);
      if (out) {
        d.x = out.x + 0.5;
        d.y = out.y + 0.5;
      }
    }
    const dx = d.x - s.x;
    const dy = d.y - s.y;
    // a thing she put down herself stays down until she has walked away from it
    if (d.put) {
      if (dx * dx + dy * dy > 2.5 * 2.5) d.put = undefined;
      continue;
    }
    if (dx * dx + dy * dy > AUTO_PICK * AUTO_PICK) continue;
    if (!makeRoom(g, d.id)) {
      nudge(g, 'bag_full_ground');
      continue;
    }
    s.drops.splice(i, 1);
    g.ev.push({ t: 'fx', id: 'pickup', x: d.x, y: d.y, item: d.id });
    g.ev.push({ t: 'sfx', id: 'pickup' });
    give(g, d.id, d.n);
  }
}

/** Per area: the finds lying on the ground, by tile (built once; the map does not move). */
const findsAt = new Map<string, Map<number, number[]>>();
function findsOf(g: Game, area: string): Map<number, number[]> {
  let m = findsAt.get(area);
  if (m) return m;
  m = new Map();
  const a = g.c.areas[area]!;
  a.objects.forEach((o, i) => {
    const t = g.c.objects[o.type];
    if (!t || t.solid) return;
    const find = (t.interact && WALK_OVER.has(t.interact)) || (t.node && !t.node.tool && t.node.verb === 'pick');
    if (!find) return;
    const k = o.y * a.w + o.x;
    const list = m!.get(k);
    if (list) list.push(i);
    else m!.set(k, [i]);
  });
  findsAt.set(area, m);
  return m;
}

/**
 * Finds hop into the bag by themselves (G, D62: "some items are hard to pick up"): a shell, a flower, a stick pile,
 * a long dog, a bottle or anything else lying on the ground, as she walks over it or right beside it, facing any
 * way, even when a tree or a person stands over it. An X mark digs itself when she stands on it with a spade.
 * A full bag leaves it where it is (a word for a real find), and so does carrying AUTO_CAP of a flower or a shell
 * already, so the bag and the chests at home never fill up with things she only walked past.
 */
export function autoPick(g: Game): void {
  const s = g.s;
  const a = g.c.areas[s.area];
  if (!a || g.rt.fun) return;
  const finds = findsOf(g, s.area);
  if (!finds.size) return;
  const cx = Math.floor(s.x);
  const cy = Math.floor(s.y);
  for (let ty = cy - 1; ty <= cy + 1; ty++)
    for (let tx = cx - 1; tx <= cx + 1; tx++) {
      if (tx < 0 || ty < 0 || tx >= a.w || ty >= a.h) continue;
      const list = finds.get(ty * a.w + tx);
      if (!list) continue;
      for (const i of list) {
        const o = a.objects[i]!;
        const d2 = (o.x + 0.5 - s.x) ** 2 + (o.y + 0.5 - s.y) ** 2;
        if (d2 > AUTO_PICK * AUTO_PICK) continue;
        if (!objLive(g, o)) continue;
        const t = g.c.objects[o.type]!;
        if (t.node) {
          if (s.nodes[o.id] !== undefined) continue;
          if (!roomFor(g, t.node.yield, false) || t.node.yield.some((y) => carried(g, y.item) >= AUTO_CAP)) continue;
          gather(g, o, i, t);
          continue;
        }
        if (t.interact === 'dig') {
          // the X mark: she stands on it, and only with a spade (without one Space says she needs one)
          if (d2 > 0.6 * 0.6 || toolTier(g, 'spade') === 0) continue;
        } else if (t.interact === 'pickup' && !roomFor(g, Object.keys(parseLoot(o.d)), true)) continue;
        useObject(g, o, t);
      }
    }
}
/**
 * Is there room in the bag itself for each of these? Says so (when `tell`) when there is not. A find picked up by itself
 * never sends a stack home to make room (that is for what she picks on purpose): the chests at home must not fill up
 * with shells and flowers she only walked past.
 */
/** How many of a thing are in her bag (not the chests at home). */
function carried(g: Game, id: string): number {
  let n = 0;
  for (const sl of g.s.bag) if (sl && sl.id === id) n += sl.n;
  return n;
}
function roomFor(g: Game, ids: (string | { item: string })[], tell: boolean): boolean {
  for (const k of ids) {
    const id = typeof k === 'string' ? k : k.item;
    const d = g.c.items[id];
    if (!d) continue;
    const max = d.stack ?? 99;
    const pouch = d.pouch || d.kind === 'tool' || d.kind === 'key';
    if (pouch || g.s.bag.some((sl) => sl && sl.id === id && sl.n < max)) continue;
    // a new kind starts a stack only while there is room to spare: a flower or a shell never takes the last slots,
    // which belong to what she picks on purpose (a real find needs just one)
    let empty = 0;
    for (const sl of g.s.bag) if (!sl) empty++;
    if (empty < (tell ? 1 : AUTO_SPARE)) {
      if (tell && g.rt.nudgeT <= 0) nudge(g, 'bag_full');
      return false;
    }
  }
  return true;
}

function useSite(g: Game, site: BuildSite): void {
  for (const k in site.needs) {
    if (count(g, k) < site.needs[k]!) {
      const parts: string[] = [];
      for (const j in site.needs) {
        const d = g.c.items[j]!;
        parts.push(`${site.needs[j]} ${site.needs[j] === 1 ? d.name : (d.names ?? d.name + 's')}`);
      }
      nudge(g, (g.c.strings.site_needs ?? '{list}').replace('{list}', parts.join(', ')), 5);
      g.ev.push({ t: 'sfx', id: 'nope' });
      g.ev.push({ t: 'open', ui: 'site', arg: site.id });
      return;
    }
  }
  for (const k in site.needs) take(g, k, site.needs[k]!);
  finishSite(g, site);
}
export function finishSite(g: Game, site: BuildSite): void {
  g.s.flags[site.flag] = 1;
  g.rt.dirty = true;
  g.ev.push({
    t: 'fx',
    id: 'build',
    x: site.rect.x + site.rect.w / 2,
    y: site.rect.y + site.rect.h / 2,
    n: Math.max(site.rect.w, site.rect.h),
  });
  g.ev.push({ t: 'sfx', id: 'build' });
  g.ev.push({ t: 'shake', amt: 4 });
  g.ev.push({ t: 'reward', kind: 'secret', id: 'site:' + site.id });
  g.ev.push({ t: 'act', kind: 'build', id: site.id });
  questEvent(g, 'site', site.id);
}

function usePlaced(g: Game, p: Placed): void {
  const use = g.c.items[p.item]!.place!.use;
  switch (use) {
    case 'table':
    case 'furnace':
      g.ev.push({ t: 'open', ui: 'craft', arg: use });
      return;
    case 'pot':
      // the craft menu on its Food tab: food made here comes out double
      g.ev.push({ t: 'open', ui: 'craft', arg: 'pot' });
      return;
    case 'chest':
      g.ev.push({ t: 'open', ui: 'chest', arg: String(p.k) });
      return;
    case 'bed':
      askSleep(g);
      return;
    case 'sign':
      if (p.text) say(g, ['say: ' + p.text]);
      else g.ev.push({ t: 'open', ui: 'signtext', arg: String(p.k) });
      return;
    case 'jukebox':
      g.ev.push({ t: 'open', ui: 'jukebox' });
      return;
    case 'mirror':
      g.ev.push({ t: 'open', ui: 'mirror' });
      return;
    case 'anvil':
      g.ev.push({ t: 'open', ui: 'upgrade' });
      return;
    case 'stand':
      g.ev.push({ t: 'open', ui: 'gear' });
      return;
    default:
      return;
  }
}

/** A `night` step she is on right now, if any: the bed must not sleep the night away. */
function nightStep(g: Game): boolean {
  for (const qid in g.s.quests) {
    const q = g.s.quests[qid]!;
    if (!q.done && g.c.quests[qid]?.steps[q.step]?.t === 'night') return true;
  }
  return false;
}

function askSleep(g: Game): void {
  const S = g.c.strings;
  const tracked = g.s.tracked ? g.s.quests[g.s.tracked] : undefined;
  const sleepGoal = tracked && !tracked.done && g.c.quests[g.s.tracked!]?.steps[tracked.step]?.t === 'sleep';
  if (!sleepGoal && nightStep(g)) {
    // A step waits for the night: the bed offers to wait for it (a key press, not ten minutes), never to sleep.
    if (g.s.time >= NIGHT_AT && g.s.time < DAWN_AT) {
      nudge(g, 'bed_night_now');
      return;
    }
    say(
      g,
      [
        {
          l: 'say: ' + (S.bed_night ?? ''),
          choices: [{ text: S.bed_night_yes ?? 'Yes', fx: { flags: ['_night'] } }, { text: S.bed_no ?? 'No' }],
        },
      ],
      () => {
        if (!g.s.flags._night) return;
        delete g.s.flags._night;
        // At dawn the night has gone: a new morning first, then straight on to its night.
        if (g.s.time >= DAWN_AT) newDay(g, true);
        if (g.s.time < NIGHT_AT) g.s.time = NIGHT_AT;
        g.ev.push({ t: 'sfx', id: 'night' });
        g.rt.dirty = true;
      },
    );
    return;
  }
  if (g.s.time >= DUSK_AT) {
    sleep(g);
    return;
  }
  say(
    g,
    [
      {
        l: 'say: ' + (S.bed_early ?? ''),
        choices: [{ text: S.bed_yes ?? 'Yes', fx: { flags: ['_sleep'] } }, { text: S.bed_no ?? 'No' }],
      },
    ],
    () => {
      if (g.s.flags._sleep) {
        delete g.s.flags._sleep;
        sleep(g);
      }
    },
  );
}

/** Package 78: will every bag item in this loot fit (the bag may send a stack home to make room)? Pouch things always do. */
function findFits(g: Game, loot: Record<string, number>): boolean {
  for (const id in loot) {
    if (id === 'emerald' || id.startsWith('sticker.') || id.startsWith('flag.')) continue;
    if (!makeRoom(g, id)) return false;
  }
  return true;
}

function parseLoot(d: string | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  if (!d) return out;
  for (const part of d.split(',')) {
    const [id, n] = part.split(':');
    if (id) out[id.trim()] = n ? Number(n) : 1;
  }
  return out;
}

function benchUpgrade(g: Game, o: MapObj): boolean {
  const id = g.s.tracked;
  const q = id ? g.s.quests[id] : undefined;
  return !!(
    o.id.startsWith('grandad_bench') &&
    g.s.flags.upgrades_open &&
    q &&
    !q.done &&
    id &&
    g.c.quests[id]?.steps[q.step]?.t === 'upgrade'
  );
}

function useObject(g: Game, o: MapObj, t: ObjectType): void {
  const s = g.s;
  const S = g.c.strings;
  switch (t.interact) {
    case 'sign':
      say(g, ['say: ' + (S['sign:' + (o.d ?? o.id)] ?? t.name ?? '')]);
      return;
    case 'signpost': {
      const id = o.d ?? o.id;
      if (!s.signs.includes(id)) {
        s.signs.push(id);
        g.ev.push({ t: 'toast', kind: 'info', text: 'sign_found' });
        g.ev.push({ t: 'reward', kind: 'secret', id: 'sign:' + id });
        g.ev.push({ t: 'sfx', id: 'sticker' });
      }
      g.ev.push({ t: 'open', ui: 'travel', arg: id });
      return;
    }
    case 'bed':
      askSleep(g);
      return;
    case 'mailbox':
      if (s.inbox.length) g.ev.push({ t: 'open', ui: 'mail' });
      else say(g, ['say: ' + (S.no_post ?? '')]);
      return;
    case 'mirror':
      g.ev.push({ t: 'open', ui: 'mirror' });
      return;
    case 'table':
    case 'furnace':
      if (benchUpgrade(g, o)) g.ev.push({ t: 'open', ui: 'upgrade' });
      else g.ev.push({ t: 'open', ui: 'craft', arg: t.interact });
      return;
    case 'chest':
    case 'pickup':
    case 'dig': {
      if (t.interact === 'dig' && toolTier(g, 'spade') === 0) {
        // package 68: and where one comes from (the toy spade in the sandpit is not one)
        nudge(g, knowsTool(g, 'spade') ? 'need_spade_make' : 'need_spade');
        return;
      }
      const loot = parseLoot(o.d);
      // package 78: a room's find that will not fit says so once, in plain words, and stays where it is for later
      if (o.type.startsWith(FIND_PREFIX) && !findFits(g, loot)) {
        nudge(g, 'find_no_room');
        return;
      }
      s.taken[o.id] = 1;
      g.rt.dirty = true;
      g.ev.push({ t: 'sfx', id: t.interact === 'pickup' ? 'pickup' : 'chest' });
      g.ev.push({ t: 'fx', id: t.interact === 'pickup' ? 'pickup' : 'sparkle', x: o.x + 0.5, y: o.y + 0.5 });
      // package 78: the find's own words come before anything the bag says about it
      roomFound(g, o);
      for (const id in loot) {
        if (id === 'emerald') applyFx(g, { emeralds: loot[id] });
        else if (id.startsWith('sticker.')) {
          const part = id.slice(8);
          const had = !!s.stickers[part];
          sticker(g, part);
          // a find that is one of a set says so every time (the first also lands the set's sticker)
          const line = had ? '' : setLine(g, part);
          if (line) g.ev.push({ t: 'toast', kind: 'item', text: line, item: g.c.stickers[part]?.art ?? '', n: 1 });
        } else if (id.startsWith('flag.')) applyFx(g, { flags: [id.slice(5)] });
        else give(g, id, loot[id]);
      }
      if (t.interact !== 'pickup') g.ev.push({ t: 'reward', kind: 'secret', id: o.id });
      g.ev.push({ t: 'act', kind: 'find', id: o.id });
      return;
    }
    case 'lamp':
      lightLamp(g, o);
      return;
    case 'look':
      startLook(g, o);
      return;
    case 'bottle': {
      s.taken[o.id] = 1;
      g.rt.dirty = true;
      const id = o.d ?? o.id;
      if (!s.letters.includes(id)) s.letters.push(id);
      g.ev.push({ t: 'sfx', id: 'chest' });
      g.ev.push({ t: 'reward', kind: 'secret', id: o.id });
      g.ev.push({ t: 'open', ui: 'letter', arg: id });
      s.counts.bottles = (s.counts.bottles ?? 0) + 1;
      return;
    }
    case 'board':
    case 'bounty':
      // the board lists up to 3 jobs (package 41); the menu sends 'accept' with the one she picks
      if (boardJobs(g).length) g.ev.push({ t: 'open', ui: 'board' });
      else say(g, ['say: ' + (S.board_empty ?? '')]);
      return;
    case 'stall':
      g.ev.push({ t: 'open', ui: 'shop', arg: o.d ?? '' });
      return;
    case 'claw': {
      // A quest that waits for the claw game always gets its go, even when the free go was used before the quest
      // asked for it (the machine stands a short walk from her door from the first minute).
      let wanted = false;
      for (const qid in s.quests) {
        const q = s.quests[qid]!;
        const st = q.done ? undefined : g.c.quests[qid]!.steps[q.step];
        if (st && st.t === 'mini' && st.game === 'claw') wanted = true;
      }
      if (freeCupGo(g)) {
        startMini(g, 'claw', null, '', postCup(g, 'claw'));
        return;
      }
      if (wanted || (s.counts.clawGoes ?? 0) > 0 || !s.flags.claw_free) {
        const charge = !s.flags.claw_free ? 'free' : wanted ? null : 'earned';
        startMini(g, 'claw', null, '', postCup(g, 'claw'), charge);
      } else say(g, ['say: ' + (S.claw_none ?? '')]);
      return;
    }
    case 'jukebox':
      g.ev.push({ t: 'open', ui: 'jukebox' });
      return;
    case 'naturetable':
      g.ev.push({ t: 'open', ui: 'nature' });
      return;
    case 'present': {
      const n = (s.counts.presents ?? 0) + 1;
      if (s.counts.presentDay === s.day) {
        say(g, ['say: ' + (S.present_wait ?? '')]);
        return;
      }
      if (n > 12) {
        say(g, ['say: ' + (S.present_done ?? '')]);
        return;
      }
      s.counts.presents = n;
      s.counts.presentDay = s.day;
      const loot = parseLoot(S['present:' + n]);
      g.ev.push({ t: 'sfx', id: 'chest' });
      g.ev.push({ t: 'fx', id: 'confetti', x: o.x + 0.5, y: o.y + 0.5 });
      for (const id in loot) {
        if (id === 'emerald') applyFx(g, { emeralds: loot[id] });
        else give(g, id, loot[id]);
      }
      g.ev.push({ t: 'reward', kind: 'secret', id: 'present' + n });
      return;
    }
    case 'socket':
      if (s.shards >= 6) {
        applyFx(g, { flags: ['hall_open'] });
        g.ev.push({ t: 'sfx', id: 'shard' });
        g.ev.push({ t: 'fx', id: 'sparkle', x: o.x + 0.5, y: o.y + 0.5, n: 6 });
        g.ev.push({ t: 'shake', amt: 5 });
      } else nudge(g, 'need_shards');
      return;
    case 'play':
      if (o.d) startMini(g, o.d, null, '', postCup(g, o.d));
      return;
    case 'minecart':
      if (o.d === 'ride') {
        startMini(g, 'minecart', null, '', postCup(g, 'minecart'));
        return;
      }
      if (s.flags.minecart) g.ev.push({ t: 'open', ui: 'travel', arg: 'cart:' + (o.d ?? '') });
      else nudge(g, 'cart_later');
      return;
    case 'boat':
      if (s.pouch.boat) {
        const to = o.d === 'home' ? findPlace(g, 'jetty_boat') : findPlace(g, 'treasure_landing');
        if (to) {
          enterArea(g, to.area, to.x + 0.5, to.y + 0.5, 'down');
          g.ev.push({ t: 'sfx', id: 'splash' });
        }
      } else nudge(g, 'need_boat');
      return;
    case 'well':
      say(g, ['say: ' + (S.well ?? '')]);
      return;
    case 'radar':
      g.ev.push({ t: 'open', ui: 'radar' });
      return;
    case 'prize':
      g.ev.push({ t: 'open', ui: 'shop', arg: 'prizes' });
      return;
    case 'photo':
      g.ev.push({ t: 'open', ui: 'photo' });
      return;
    // package 73b: the Post Office, the school quiz, her greenhouse pots
    case 'post':
      openPost(g);
      return;
    case 'quiz':
      startQuiz(g);
      return;
    case 'grow':
      potAct(g, o);
      return;
    case 'door':
      return;
    default:
      return;
  }
}
function findPlace(g: Game, name: string) {
  for (const a in g.c.areas) {
    const p = g.c.areas[a]!.places[name];
    if (p) return p;
  }
  return null;
}

/** Package 69: at this many half hearts or fewer, R eats the best food from anywhere in the bag. */
export const LOW_HP = 6;
/** Hearts come back by themselves up to this many half hearts (food is how she gets the rest). */
export const REGEN_TO = 6;
export const REGEN_EVERY = 6;
export const REGEN_CALM = 5;
const REGEN_FOE = 6;

/** The food R eats when hearts are low: the one that heals most that nobody is waiting for. -1 when none. */
export function bestFood(g: Game): number {
  let best = -1;
  let heal = 0;
  g.s.bag.forEach((sl, i) => {
    const h = sl ? (g.c.items[sl.id]?.heal ?? 0) : 0;
    if (!sl || h <= heal || count(g, sl.id) <= promised(g, sl.id)) return;
    best = i;
    heal = h;
  });
  return best;
}

/**
 * Package 69: hearts come back. With no hostile mob within 6 tiles and 5 s since the last hit, a heart comes back
 * every 6 s up to 3 hearts. And the strip offers "R: Eat" while hearts are low and there is food.
 */
export function stepHearts(g: Game): void {
  const s = g.s;
  const rt = g.rt;
  rt.calmT = (rt.calmT ?? REGEN_CALM) + 1 / 60;
  // issue 50: a game saved while the "Safe at home" card showed comes back in play with no hearts (the card is not
  // saved, and hearts never come back from none): she is carried home again, the same card and the same morning
  if (s.hp <= 0 && !rt.card) {
    carriedHome(g, true);
    return;
  }
  if (rt.tick % 6 === 0) rt.eatHint = s.hp <= LOW_HP && s.hp < s.maxHp && bestFood(g) >= 0;
  const to = Math.min(REGEN_TO, s.maxHp);
  if (s.hp >= to || s.hp <= 0) {
    rt.healT = 0;
    return;
  }
  if (rt.calmT < REGEN_CALM || foeNear(g, REGEN_FOE)) {
    rt.healT = 0;
    return;
  }
  rt.healT = (rt.healT ?? 0) + 1 / 60;
  if (rt.healT < REGEN_EVERY) return;
  rt.healT = 0;
  s.hp = Math.min(to, s.hp + 2);
  g.ev.push({ t: 'fx', id: 'heart', x: s.x, y: s.y - 1 });
}

/** R: use the picked hotbar item (eat, plant, pat). */
function useHot(g: Game): void {
  // package 69: hearts low and food in the bag: R eats the best food, whatever the hotbar holds
  if (g.s.hp <= LOW_HP && g.s.hp < g.s.maxHp) {
    const i = bestFood(g);
    if (i >= 0) {
      eat(g, g.s.bag[i]!.id);
      return;
    }
  }
  const sl = g.s.bag[g.s.hot];
  if (!sl) return;
  const d = g.c.items[sl.id]!;
  if (d.heal) {
    if (count(g, sl.id) <= promised(g, sl.id)) {
      // Somebody in a quest is waiting for this: she keeps it for them.
      nudge(g, 'keep_that');
      return;
    }
    if (g.s.hp >= g.s.maxHp) {
      nudge(g, 'hearts_full');
      return;
    }
    eat(g, sl.id);
    return;
  }
  if (d.grows) {
    useSeed(g, sl.id);
    return;
  }
  if (d.place) {
    if (atHome(g)) g.ev.push({ t: 'open', ui: 'build' });
    else nudge(g, 'build_home_only');
  }
}

function eat(g: Game, id: string): void {
  take(g, id, 1);
  g.s.hp = Math.min(g.s.maxHp, g.s.hp + (g.c.items[id]?.heal ?? 0));
  g.rt.eatHint = false;
  g.ev.push({ t: 'sfx', id: 'eat' });
  g.ev.push({ t: 'fx', id: 'heart', x: g.s.x, y: g.s.y - 1 });
  g.ev.push({ t: 'act', kind: 'eat', id });
}

/** The tool to draw in her hand for what she is doing. */
export function toolInHand(g: Game): string | null {
  if (g.rt.clip !== 'swing' && g.rt.clip !== 'fish') return null;
  if (g.rt.clip === 'fish') return bestTool(g, 'rod');
  const t = findTarget(g);
  const tool = t.kind === 'obj' && t.type?.node?.tool ? t.type.node.tool : t.kind === 'sand' ? 'spade' : 'sword';
  return bestTool(g, tool) ?? bestTool(g, 'sword');
}

/** A hit pushes her 1.2 tiles: 12 steps of a tenth of a tile, each one checked. */
const KNOCK_STEP = 0.1;
const KNOCK_STEPS = 12;

export function hurtHero(g: Game, half: number, fromX: number, fromY: number, by?: { x: number; y: number }): void {
  const rt = g.rt;
  const s = g.s;
  if (rt.safeT > 0 || rt.mode !== 'play') return;
  rt.calmT = 0;
  rt.healT = 0;
  // package 69: every hit shows who did it: a red mark over the one that hit her (a skeleton behind a tree too)
  // (item 'hit' marks it as a real hit: the screen's edge arrow follows only these, not a mob's notice or wind-up)
  g.ev.push({ t: 'fx', id: 'warn', x: by?.x ?? fromX, y: by?.y ?? fromY, item: 'hit' });
  const dmg = s.opts.gentle ? Math.max(1, Math.round(half / 2)) : half;
  // blue shield hearts from her armour take the hit first (phase 2, part D)
  s.hp = Math.max(0, s.hp - shieldTakes(g, dmg));
  rt.hurtT = 0.35;
  rt.safeT = 1.6;
  rt.swingT = 0;
  setClip(g, 'hurt');
  g.ev.push({ t: 'sfx', id: 'ouch' });
  g.ev.push({ t: 'shake', amt: 6 });
  g.ev.push({ t: 'fx', id: 'ouch', x: s.x, y: s.y });
  const dx = s.x - fromX;
  const dy = s.y - fromY;
  const d = Math.hypot(dx, dy) || 1;
  // pushed a step away (package 60: 1.2 tiles, or as far as the ground lets her), with 1.6 s before the next hit. She
  // slides there a tenth of a tile at a time and stops at the first step that is blocked, so a push can never carry
  // her past a corner into a pocket walled in on every side (the solver was knocked into one by the forest sign).
  const kx = (dx / d) * KNOCK_STEP;
  const ky = (dy / d) * KNOCK_STEP;
  for (let i = 0; i < KNOCK_STEPS && free(g, s.area, s.x + kx, s.y + ky, HALF); i++) {
    s.x += kx;
    s.y += ky;
  }
  if (s.hp <= 0) carriedHome(g);
}

/** Out of hearts: nothing is lost. She wakes at home next morning. (`again`: the same faint, after a reload) */
function carriedHome(g: Game, again = false): void {
  const s = g.s;
  // A boss fight cannot be lost either: she wakes at the door and the boss keeps the hits it has.
  if (bossFaint(g)) return;
  if (s.flags.defence_on) {
    // The night defence cannot be lost: the golem carries her to the well and she joins back in.
    const well = findPlace(g, 'village_well');
    s.hp = s.maxHp;
    g.rt.safeT = 3;
    if (well && well.area === s.area) {
      s.x = well.x + 0.5;
      s.y = well.y + 0.5;
    }
    nudge(g, 'golem_carry', 5);
    g.ev.push({ t: 'fx', id: 'heart', x: s.x, y: s.y - 1, n: 4 });
    return;
  }
  if (!again) s.counts.carried = (s.counts.carried ?? 0) + 1;
  g.rt.mobs.length = 0;
  g.rt.shots.length = 0;
  g.rt.card = {
    kind: 'carried',
    title: g.c.strings.carried_title ?? '',
    lines: [fill(g, g.c.strings.carried ?? '')],
    t: 0,
    then: () => sleep(g, true),
  };
  g.rt.mode = 'card';
  g.ev.push({ t: 'sfx', id: 'lullaby' });
}

export { objLive };
