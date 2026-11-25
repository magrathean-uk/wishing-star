// The friendly people of the island: where they stand, how they amble about, and what happens when she talks to them.
import { hash2, isNight, rand, test } from './cond.ts';
import { shieldBack } from './gear.ts';
import { findPath, free, regionAt, solidAt } from './grid.ts';
import { LAMP_REGION } from './lamp.ts';
import { foundGuest, islandSpot, spotGone } from './island.ts';
import { DIRV } from './hero.ts';
import { startMini } from './minigames.ts';
import { tickPerson } from './people.ts';
import { npcMark, place, talkTo } from './quests.ts';
import { say } from './talk.ts';
import type { CharDef, Dir, Game, Npc, Spot } from './types.ts';

const REACH = 1.55;

/** Where someone stands now (their first spot that holds), or null when they are not about. */
export function activeSpot(g: Game, c: CharDef): Spot | null {
  if (islandSpot(g, c.id) === 'none') return null;
  const night = isNight(g);
  for (const sp of c.spots) {
    if (spotGone(g, sp)) continue;
    if (sp.dayOnly && night) continue;
    if (sp.nightOnly && !night) continue;
    if (test(g, sp.if)) return sp;
  }
  return null;
}

/** Work out who is in this area right now. Keeps people who are already here where they are. */
export function refreshNpcs(g: Game): void {
  const s = g.s;
  const old = g.rt.npcs;
  const next: Npc[] = [];
  for (const id in g.c.chars) {
    const c = g.c.chars[id]!;
    if (id === s.hero) continue;
    if (c.role === 'hostile' || c.role === 'animal') continue;
    const sp = activeSpot(g, c);
    if (!sp) continue;
    const p = place(g, sp.at);
    if (!p || p.area !== s.area) continue;
    const hx = p.x + 0.5;
    const hy = p.y + 0.5;
    const n0 = id.length * 31 + id.charCodeAt(0);
    let n = old.find((o) => o.id === id);
    if (n && Math.abs(n.hx - hx) < 0.01 && Math.abs(n.hy - hy) < 0.01) {
      n.roam = sp.roam ?? 0;
    } else {
      n = {
        k: g.rt.nextK++,
        id,
        kind: 'npc',
        area: s.area,
        x: hx,
        y: hy,
        px: hx,
        py: hy,
        dir: sp.dir ?? 'down',
        clip: 'idle',
        ct: hash2(n0, 7, 3) * 2,
        hx,
        hy,
        roam: sp.roam ?? 0,
        path: null,
        pi: 0,
        wait: 1 + hash2(n0, 11, 5) * 4,
        mark: 0,
        talkT: 0,
      };
    }
    n.mark = npcMark(g, id);
    next.push(n);
  }
  g.rt.npcs = next;
}

export function refreshMarks(g: Game): void {
  for (const n of g.rt.npcs) n.mark = npcMark(g, n.id);
}

export function stepNpcs(g: Game): void {
  const s = g.s;
  const talkingTo = g.rt.talk?.npc ?? 0;
  for (const n of g.rt.npcs) {
    n.px = n.x;
    n.py = n.y;
    n.ct += 1 / 60;
    const dx = s.x - n.x;
    const dy = s.y - n.y;
    const d2 = dx * dx + dy * dy;
    tickPerson(n, d2);
    if (d2 > 30 * 30) continue;
    // package 67: stepping out of her way (src/core/people.ts) goes before everything else
    const aside = !!n.aside && !!n.path;
    if (n.k === talkingTo && !aside) {
      face(n, dx, dy);
      const speaking = g.rt.talk && g.rt.talk.who === n.id && g.rt.talk.shown < g.rt.talk.text.length;
      setClip(n, speaking ? 'talk' : 'idle');
      n.path = null;
      continue;
    }
    if (n.talkT > 0 && !aside) {
      n.talkT -= 1 / 60;
      if (n.talkT <= 0) setClip(n, 'idle');
      continue;
    }
    // package 60: someone the game marks for her stands still and turns to her while she is within 6 tiles (a
    // marked friend who wandered off whenever she came near could never be spoken to)
    if (n.mark && d2 < 6 * 6 && !aside) {
      if (n.path) {
        n.path = null;
        n.wait = 1;
        setClip(n, 'idle');
      }
      if (d2 >= 2.6 * 2.6) {
        face(n, dx, dy);
        continue;
      }
    }
    if (n.path) {
      const tx = n.path[n.pi]! + 0.5;
      const ty = n.path[n.pi + 1]! + 0.5;
      const mx = tx - n.x;
      const my = ty - n.y;
      const dist = Math.hypot(mx, my);
      const sp = Math.max(aside ? 3 : 0, g.c.chars[n.id]!.speed ?? 1.7) / 60;
      if (d2 < 1.2 && !aside) {
        // She is in the way: stop and let her pass rather than push.
        n.path = null;
        n.wait = 1.5;
        setClip(n, 'idle');
        face(n, dx, dy);
      } else if (dist <= sp) {
        n.x = tx;
        n.y = ty;
        n.pi += 2;
        if (n.pi >= n.path.length) {
          n.path = null;
          n.wait = 2 + rand(g) * 6;
          setClip(n, 'idle');
        }
      } else {
        n.x += (mx / dist) * sp;
        n.y += (my / dist) * sp;
        face(n, mx, my);
        setClip(n, 'walk');
      }
      continue;
    }
    if (d2 < 2.6 * 2.6) {
      face(n, dx, dy);
      if (!g.s.flags['waved:' + n.id + ':' + s.day] && g.c.chars[n.id]!.role !== 'speakingMob') {
        g.s.flags['waved:' + n.id + ':' + s.day] = 1;
        setClip(n, 'wave');
        n.talkT = 1.1;
      }
      continue;
    }
    if (n.roam > 0 && g.rt.mode === 'play') {
      n.wait -= 1 / 60;
      if (n.wait <= 0) {
        const a = g.c.areas[s.area]!;
        const gx = Math.floor(n.hx + (rand(g) * 2 - 1) * n.roam);
        const gy = Math.floor(n.hy + (rand(g) * 2 - 1) * n.roam);
        n.wait = 3 + rand(g) * 5;
        // never onto a tile where someone else stands or is going: two people on one tile cannot be told apart
        const taken = g.rt.npcs.some(
          (o) =>
            o !== n &&
            ((Math.floor(o.x) === gx && Math.floor(o.y) === gy) ||
              (!!o.path && o.path[o.path.length - 2] === gx && o.path[o.path.length - 1] === gy)),
        );
        if (!taken && !solidAt(g, s.area, gx, gy)) {
          const path = findPath(g.rt.solid[s.area]!, a.w, a.h, Math.floor(n.x), Math.floor(n.y), gx, gy, 0, 500);
          if (path && path.length > 0 && path.length <= 40) {
            n.path = path;
            n.pi = 0;
          }
        }
      }
    }
  }
}

function setClip(n: Npc, clip: Npc['clip']): void {
  if (n.clip !== clip) {
    n.clip = clip;
    n.ct = 0;
  }
}
function face(n: { dir: Dir }, dx: number, dy: number): void {
  n.dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'down';
}

/** The character she would talk to: close by and roughly in front. */
export function npcNear(g: Game): Npc | null {
  const s = g.s;
  const [fx, fy] = DIRV[s.dir];
  let best: Npc | null = null;
  let bestD = REACH * REACH;
  // the one her goal wants (marker 2) wins over a nearer one when both are in reach (package 53a)
  let goal = false;
  for (const n of g.rt.npcs) {
    const dx = n.x - s.x;
    const dy = n.y - s.y;
    const d2 = dx * dx + dy * dy;
    if (d2 > REACH * REACH) continue;
    if (d2 > 0.8 && dx * fx + dy * fy < 0.15 * Math.sqrt(d2)) continue;
    const wanted = n.mark === 2;
    if (goal && !wanted) continue;
    if (d2 > bestD && wanted === goal) continue;
    best = n;
    bestD = d2;
    goal = wanted;
  }
  return best;
}

/**
 * Package 69: the nearest person beside her, facing any way (within `r` tiles, middle to middle): Space talks to them
 * when nothing is straight ahead. The goal's one wins a near tie.
 */
export function npcBeside(g: Game, r = 1.6): Npc | null {
  const s = g.s;
  let best: Npc | null = null;
  let bestD = r * r;
  for (const n of g.rt.npcs) {
    const d2 = (n.x - s.x) ** 2 + (n.y - s.y) ** 2 - (n.mark === 2 ? 0.05 : 0);
    if (d2 > bestD) continue;
    best = n;
    bestD = d2;
  }
  return best;
}

export function npcById(g: Game, id: string): Npc | null {
  for (const n of g.rt.npcs) if (n.id === id) return n;
  return null;
}

/** The first talk with someone: who she has met is its own record (phase 2, part C), never a sticker. */
export function meet(g: Game, id: string): void {
  if (g.s.met[id]) return;
  g.s.met[id] = g.s.day || 1;
  g.ev.push({ t: 'reward', kind: 'friend', id });
}

/**
 * She stops a tile short of the one she talks to, so neither hides behind the other (package 46). Side by side is
 * best (a body is two tiles tall, so one above the other overlaps); she steps beside them when that spot is free,
 * else back along the way she came. Only to a free spot; else she stays where she is.
 */
function standBack(g: Game, n: Npc): void {
  const s = g.s;
  const dx = s.x - n.x;
  const dy = s.y - n.y;
  if (Math.abs(dx) >= 1 && Math.abs(dy) < 0.6) return;
  const tall = g.c.chars[n.id]?.tall ?? 2;
  const side = dx < 0 ? -1 : 1;
  const tries: [number, number][] = [
    [n.x + side * 1.1, n.y],
    [n.x - side * 1.1, n.y],
    [s.x, dy < 0 ? n.y - Math.max(1.3, tall * 0.9) : n.y + 1.2],
  ];
  for (const [x, y] of tries) {
    if (Math.hypot(x - s.x, y - s.y) > 2.2 || !free(g, s.area, x, y)) continue;
    s.x = x;
    s.y = y;
    g.rt.px = x;
    g.rt.py = y;
    s.dir = x < n.x - 0.5 ? 'right' : x > n.x + 0.5 ? 'left' : y < n.y ? 'down' : 'up';
    return;
  }
}

export function talkNpc(g: Game, k: number): void {
  const n = g.rt.npcs.find((x) => x.k === k);
  if (!n) return;
  const s = g.s;
  const c = g.c.chars[n.id]!;
  // While she plays as a character who keeps a stall or hosts a game, the stand-in keeps it for them.
  const me = g.c.chars[s.hero];
  const service = c.service ?? (me?.standIn === n.id ? me.service : undefined);
  s.dir = Math.abs(n.x - s.x) > Math.abs(n.y - s.y) ? (n.x < s.x ? 'left' : 'right') : n.y < s.y ? 'up' : 'down';
  n.path = null;
  standBack(g, n);
  if (!c.noSticker) meet(g, n.id);
  g.ev.push({ t: 'act', kind: 'talk', id: n.id });
  foundGuest(g, n.id);
  if (talkTo(g, n.id, k)) return;
  // A mini-game host: straight in when a quest is waiting for that game, otherwise she is asked first.
  if (service?.startsWith('mini:')) {
    const game = service.slice(5);
    let wanted = false;
    for (const qid in s.quests) {
      const q = s.quests[qid]!;
      const st = q.done ? undefined : g.c.quests[qid]!.steps[q.step];
      if (st && st.t === 'mini' && st.game === game) wanted = true;
    }
    // snow only falls at Christmas, but a snowball quest she started then is played to the end (review 55)
    if (game === 'snowball' && !s.xmas && !wanted) {
      const l = chatLine(g, c, n);
      if (l) say(g, [l], null, k);
      return;
    }
    if (wanted) {
      startMini(g, game, null, n.id);
      return;
    }
    const S = g.c.strings;
    say(
      g,
      [
        {
          l: `${n.id}: ${(S.play_q ?? 'Play {game}?').replace('{game}', S['mini:' + game] ?? game)}`,
          choices: [{ text: S.play_yes ?? 'Yes', fx: { flags: ['_play'] } }, { text: S.play_no ?? 'No' }],
        },
      ],
      () => {
        if (s.flags._play) {
          delete s.flags._play;
          startMini(g, game, null, n.id);
        }
      },
      k,
    );
    return;
  }
  const line = chatLine(g, c, n);
  const open = !service
    ? null
    : service === 'hug'
      ? () => hug(g)
      : service.startsWith('mini:')
        ? () => startMini(g, service!.slice(5), null, n.id)
        : () => g.ev.push({ t: 'open', ui: 'service', arg: service });
  // package 69: small talk once a step: then Space goes to what else is beside her (the bench behind her, say)
  if (!service) (g.rt.chatted ??= {})[k] = g.rt.questRev;
  if (line) say(g, [line], open, k);
  else if (open) open();
}

function smallTalkLine(id: string, line: string): string {
  const separator = line.indexOf(': ');
  return separator > 0 && separator < 24 ? line : `${id}: ${line}`;
}

/** Is this person standing in the bay the lamp keeps safe? */
function inLampBay(g: Game, n: Npc): boolean {
  const a = g.c.areas[n.area];
  return !!a && regionAt(a, Math.floor(n.x), Math.floor(n.y)) === g.c.regions[LAMP_REGION]?.code;
}

/** Small talk: the first pool whose condition holds, one line after another; now and then a line just for this hero. */
function chatLine(g: Game, c: CharDef, n?: Npc): string | null {
  const s = g.s;
  const own = g.c.heroes[s.hero]?.lines[c.id];
  if (own && !s.flags['own:' + s.hero + ':' + c.id]) {
    s.flags['own:' + s.hero + ':' + c.id] = 1;
    return smallTalkLine(c.id, own);
  }
  for (const pool of c.chat) {
    if (!test(g, pool.if) || pool.lines.length === 0) continue;
    // package 78: the lamp's one remark a night comes from someone standing in the lamp's bay, and keeps its place in
    // the rotation (it is not one of the usual lines)
    if (pool.if?.lamp) {
      if (!n || !inLampBay(g, n)) continue;
      s.counts.lamp_note = s.day;
      return smallTalkLine(c.id, pool.lines[0]!);
    }
    const i = s.chatAt[c.id] ?? 0;
    s.chatAt[c.id] = i + 1;
    const l = pool.lines[i % pool.lines.length]!;
    return smallTalkLine(c.id, l);
  }
  return null;
}

/** Mum's hug: her red hearts are full again, and her blue shield hearts come back too (phase 2, part D). */
export function hug(g: Game): void {
  const s = g.s;
  const shield = shieldBack(g);
  if (s.hp < s.maxHp || shield) {
    s.hp = s.maxHp;
    g.ev.push({ t: 'fx', id: 'heart', x: s.x, y: s.y - 1, n: 5 });
    g.ev.push({ t: 'sfx', id: 'heart' });
    g.ev.push({ t: 'act', kind: 'hug' });
  }
}
