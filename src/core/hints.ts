// A hint when she struggles, everywhere, by one rule (G on build 5: "after at some scene amelia struggles, give her a
// hint what to do, all game wise"). Pure rules fed by the step clock: the view only draws what `rt.help.show` says.
//
// Struggling means no progress on what she is doing for a while:
// - in the world: the tracked step has not moved on, she has got no nearer its target and no menu is open, for 45 s
//   (60 s once a hint has been shown this session; 30 s when this very step has been hinted before), or she has been
//   hurt twice on a fight step without a hit landing;
// - in a mini-game: a round has gone by with no score, she has failed the same thing twice, or 25 s without a point;
// - at a menu the step needs (crafting, making stronger): open 20 s without the thing made.
// One hint at a time, mostly a picture (an arrow or a pulse on the place, a key picture, a marked row); words only
// where a picture cannot say it. It goes the moment she acts on it, after 15 s on its own, or when something else has
// the screen. H shows the hint for now at once.
import { count, isNight } from './cond.ts';
import { nudge } from './hero.ts';
import { charPlace, place, progress, stepTarget } from './quests.ts';
import type { Game, HelpRt, HintShow, Input, Place, Step } from './types.ts';

export const HELP = {
  /** seconds without progress in the world before the first hint, later hints and a step hinted before */
  world: 45,
  later: 60,
  again: 30,
  /** seconds a needed menu is open without the thing made */
  menu: 20,
  /** seconds in a mini-game without a point */
  mini: 25,
  /** the longest a hint stays, and how long before a key press can put it away */
  show: 15,
  settle: 0.6,
  /** the card she asked for with H stays this long unless she closes it (package 60) */
  card: 60,
  /** tiles nearer the target that count as getting somewhere */
  nearer: 2,
  /** steps between looks (the rule runs every 6th step, as the action target does) */
  every: 6,
  /** seconds without moving the goal forward before "H: hint" shows under the goal line */
  offer: 20,
};

/** Show "H: hint" under the goal line? (she has not moved the goal forward for a while; it goes when she does) */
export function hintOffer(g: Game): boolean {
  const h = g.rt.help;
  return h.ctx === CTX_WORLD && !h.show && !!h.qid && h.t >= HELP.offer;
}

/** The key that plays each mini-game, drawn by the thing she should use it on. */
export const MINI_KEY: Record<string, string> = {
  keepy: 'Space',
  puddles: 'Space',
  hide: 'Space',
  race: 'arrows',
  claw: 'Space',
  snowball: 'Space',
  minecart: 'arrows',
  targets: 'X',
};

export function newHelp(): HelpRt {
  return {
    ctx: 0,
    qid: '',
    step: -1,
    game: '',
    menu: '',
    menuWas: '',
    key: '',
    sig: -1,
    t: 0,
    best: 1e9,
    area: '',
    hp: 0,
    hurt: 0,
    round: 0,
    fails: 0,
    shown: 0,
    asked: false,
    show: null,
  };
}

/** H: show the hint for now at once, as a picture card (or put away the card that is up). */
export function askHint(g: Game): void {
  const h = g.rt.help;
  if (h.show?.asked) hideHint(g);
  else {
    // a hint that came by itself gives way to the card she asked for
    if (h.show) hideHint(g);
    h.asked = true;
  }
}

export function hideHint(g: Game): void {
  const h = g.rt.help;
  if (!h.show) return;
  if (h.show.text && g.rt.nudgeT > 0) g.rt.nudgeT = 0;
  h.show = null;
  h.t = 0;
}

/** Does this key picture's key count as acting on the hint? */
function pressed(inp: Input, key: string): boolean {
  switch (key) {
    case 'Space':
      return inp.act;
    case 'arrows':
      return inp.mx !== 0 || inp.my !== 0;
    case 'X':
      return !!inp.fire || inp.back;
    case 'R':
      return inp.use;
    default:
      return false;
  }
}

const CTX_NONE = 0;
const CTX_WORLD = 1;
const CTX_MINI = 2;
const CTX_MENU = 3;

/**
 * One step of the rule. Called every step, before the rules stop for a menu. Returns true when this step's Space
 * was used to close the card she asked for with H (then it does nothing else).
 */
export function stepHelp(g: Game, inp: Input): boolean {
  const rt = g.rt;
  const h = rt.help;
  let used = false;
  // Space closes the card she asked for; acting on a hint that came by itself puts it away too
  // (package 68: X and Escape close it too; Escape comes as the H command from the view)
  if (h.show?.asked && (inp.act || inp.back || inp.fire) && h.show.t > 0.2) {
    hideHint(g);
    used = true;
  } else if (h.show && h.show.t > HELP.settle && pressed(inp, h.show.key)) hideHint(g);
  if (rt.tick % HELP.every !== 0 && !h.asked) return used;
  const dt = HELP.every / 60;
  const ctx = context(g);
  if (ctx === CTX_NONE) {
    // a talk, a card, a scene or a menu the step does not need has the screen: the clock stands still and a world
    // hint waits unseen (the view does not draw it); it is put away only when what she is doing changes
    if (h.show && rt.paused && h.ctx === CTX_WORLD) hideHint(g);
    h.asked = false;
    return used;
  }
  // what is she doing? a new thing starts a new clock
  const s = g.s;
  const q = s.tracked ? s.quests[s.tracked] : undefined;
  const qid = s.tracked && q && !q.done ? s.tracked : '';
  const stepNo = q ? q.step : -1;
  const game = rt.mini?.game ?? '';
  if (ctx !== h.ctx || qid !== h.qid || stepNo !== h.step || game !== h.game || h.menu !== h.menuWas) {
    hideHint(g);
    h.ctx = ctx;
    h.qid = qid;
    h.step = stepNo;
    h.game = game;
    h.menuWas = h.menu;
    h.key = seenKey(h);
    h.sig = -1;
    h.best = 1e9;
    h.hurt = 0;
    h.hp = s.hp;
    h.area = s.area;
    h.round = ctx === CTX_MINI ? miniRound(g) : 0;
    h.fails = ctx === CTX_MINI ? miniFails(g) : 0;
  }
  // progress puts the hint away and starts the clock again
  const sig = signature(g, ctx, qid);
  let moved = sig !== h.sig;
  if (ctx === CTX_WORLD) {
    if (s.area !== h.area) {
      h.area = s.area;
      h.best = 1e9;
      moved = true;
    }
    const d = targetDist(g);
    if (d < h.best - HELP.nearer || (h.best >= 1e9 && d < 1e9)) {
      if (h.best < 1e9) moved = true;
      h.best = d;
    }
    if (s.hp < h.hp) h.hurt++;
    h.hp = s.hp;
  }
  if (moved) {
    if (h.sig !== -1) hideHint(g);
    h.sig = sig;
    h.t = 0;
    h.hurt = 0;
    if (ctx === CTX_MINI) {
      h.round = miniRound(g);
      h.fails = miniFails(g);
    }
  } else if (!h.show) h.t += dt;
  if (h.show) {
    h.show.t += dt;
    if (h.show.t >= (h.show.asked ? HELP.card : HELP.show)) hideHint(g);
    h.asked = false;
    return used;
  }
  if (!h.asked && !due(g, ctx, qid)) return used;
  const asked = h.asked;
  h.asked = false;
  const show = derive(g, ctx, qid) ?? (asked ? quiet() : null);
  if (!show) return used;
  if (asked && ctx === CTX_WORLD) show.asked = true;
  h.show = show;
  h.shown++;
  s.hints[h.key] = (s.hints[h.key] ?? 0) + 1;
  // the few words go in the caption under the goal, which is already there for nudges
  if (ctx === CTX_WORLD && show.text) nudge(g, show.text, HELP.show);
  return used;
}

/** Nothing to point at and nothing to do: H still answers, with a kind line. */
function quiet(): HintShow {
  return show('key', '', null, '', 'hint_free');
}

function seenKey(h: HelpRt): string {
  return h.ctx === CTX_MINI ? 'stuck:' + h.game : 'stuck:' + h.qid + ':' + h.step + (h.ctx === CTX_MENU ? ':m' : '');
}

function context(g: Game): number {
  const rt = g.rt;
  if (rt.talk || rt.cut || rt.card) return CTX_NONE;
  if (rt.paused) return rt.help.menu && menuNeeded(g, rt.help.menu) ? CTX_MENU : CTX_NONE;
  if (rt.mode === 'mini') return rt.mini && rt.mini.st === 1 && MINI_KEY[rt.mini.game] ? CTX_MINI : CTX_NONE;
  if (rt.mode !== 'play') return CTX_NONE;
  return CTX_WORLD;
}

/** A number that changes whenever she gets somewhere with what she is doing. */
function signature(g: Game, ctx: number, qid: string): number {
  if (ctx === CTX_MINI) return g.rt.mini!.score;
  if (!qid) return 0;
  const q = g.s.quests[qid]!;
  const st = g.c.quests[qid]!.steps[q.step];
  let v = q.step * 1e6 + q.n * 1e3;
  const p = progress(g, qid);
  if (p) v += p[0] * 10;
  if (st && 'item' in st) v += count(g, st.item);
  // a boss losing a heart is a hit landed
  if (st?.t === 'defeat' && g.c.mobs[st.mob]?.role === 'boss')
    for (const m of g.rt.mobs) if (m.id === st.mob) v += m.hp * 100;
  return v;
}

function targetDist(g: Game): number {
  const t = g.rt.target;
  if (!t || t.area !== g.s.area) return 1e9;
  return Math.hypot(t.x + 0.5 - g.s.x, t.y + 0.5 - g.s.y);
}

function due(g: Game, ctx: number, qid: string): boolean {
  const h = g.rt.help;
  if (ctx === CTX_MENU) return h.t >= HELP.menu;
  if (ctx === CTX_MINI) {
    if (miniRound(g) > h.round) return true;
    if (miniFails(g) - h.fails >= 2) return true;
    return h.t >= HELP.mini;
  }
  if (!qid) return h.t >= (h.shown ? HELP.later : HELP.world);
  const st = g.c.quests[qid]!.steps[g.s.quests[qid]!.step];
  if (st?.t === 'defeat' && h.hurt >= 2) return true;
  const seen = (g.s.hints[h.key] ?? 0) > 0;
  return h.t >= (seen ? HELP.again : h.shown ? HELP.later : HELP.world);
}

// ---------------------------------------------------------------- mini-games

/** Which round, lap, wave, part, try or stretch a mini-game is in (-1 for one with none). */
export function miniRound(g: Game): number {
  const m = g.rt.mini;
  if (!m) return 0;
  const n = m.n;
  switch (m.game) {
    case 'race':
      return n[6] ?? 0;
    case 'hide':
      return n[5] ?? 0;
    case 'snowball':
    case 'targets':
    case 'claw':
      return n[4] ?? 0;
    case 'puddles':
      return n[11] ?? 0;
    case 'minecart':
      return n[7] ?? 0;
    default:
      return -1;
  }
}

/** How many times she has failed at the game's one thing (a miss, a wrong look, a bump, a snowy nose). */
export function miniFails(g: Game): number {
  const m = g.rt.mini;
  if (!m) return 0;
  const n = m.n;
  switch (m.game) {
    case 'keepy':
      return n[5] ?? 0;
    case 'hide':
      return n[3] ?? 0;
    case 'snowball':
      return n[7] ?? 0;
    case 'minecart':
      return n[3] ?? 0;
    case 'puddles': {
      let missed = 0;
      for (const o of m.objs) if (o.a === 2) missed++;
      return missed;
    }
    default:
      return 0;
  }
}

// ---------------------------------------------------------------- menus

/** What the tracked step wants made, when she knows a recipe for it and has too few ('' when nothing). */
export function craftWant(g: Game): string {
  const s = g.s;
  const q = s.tracked ? s.quests[s.tracked] : undefined;
  const st = s.tracked && q && !q.done ? g.c.quests[s.tracked]?.steps[q.step] : undefined;
  if (!st) return '';
  let item = '';
  if (st.t === 'craft') item = st.item;
  else if ((st.t === 'fetch' || st.t === 'deliver') && count(g, st.item) < (st.n ?? 1)) item = st.item;
  else if (st.t === 'site') {
    for (const a in g.c.areas)
      for (const b of g.c.areas[a]!.sites)
        if (b.id === st.site) for (const k in b.needs) if (!item && count(g, k) < b.needs[k]! && knows(g, k)) item = k;
  }
  return item && knows(g, item) ? item : '';
}
function knows(g: Game, item: string): boolean {
  for (const id of g.s.recipes) if (g.c.recipes[id]?.out === item) return true;
  return false;
}

/** A menu the step needs: the recipe list when it wants something made, the upgrade bench for an upgrade step. */
export function menuNeeded(g: Game, menu: string): boolean {
  const s = g.s;
  const q = s.tracked ? s.quests[s.tracked] : undefined;
  const st = s.tracked && q && !q.done ? g.c.quests[s.tracked]?.steps[q.step] : undefined;
  if (menu === 'craft') return !!craftWant(g) || st?.t === 'upgrade';
  if (menu === 'upgrade') return st?.t === 'upgrade';
  return false;
}

// ---------------------------------------------------------------- what the hint is

function show(
  kind: HintShow['kind'],
  key: string,
  at: Place | null,
  icon: string,
  text: string,
  target = '',
): HintShow {
  return { kind, key, at, icon, text, target, t: 0 };
}

function derive(g: Game, ctx: number, qid: string): HintShow | null {
  if (ctx === CTX_MINI) return show('mini', MINI_KEY[g.rt.mini!.game] ?? 'Space', null, '', '', g.rt.mini!.game);
  if (ctx === CTX_MENU) {
    const want = craftWant(g);
    return show('menu', 'Space', null, want, '', g.rt.help.menu);
  }
  if (!qid) {
    // nothing on the goal chip: the quest book has her quests
    for (const id in g.s.quests) if (!g.s.quests[id]!.done) return show('key', 'Q', null, '', '');
    return null;
  }
  return worldHint(g, qid);
}

/** The world hint for a quest step: derived from its target, verb and place, so every step has one. */
export function worldHint(g: Game, qid: string): HintShow {
  const s = g.s;
  const def = g.c.quests[qid]!;
  const q = s.quests[qid]!;
  const st: Step | undefined = def.steps[q.step];
  const target = stepTarget(g, qid);
  if (!st) return goOrKey(g, target ?? someWhere(g, def.giver), '', 'Space');
  switch (st.t) {
    case 'talk':
      return goOrKey(g, target ?? someWhere(g, st.who), '', 'Space');
    case 'mini':
    case 'sleep':
    case 'site':
      return goOrKey(g, target, '', 'Space');
    // package 57a: a led animal follows by itself, so the hint only shows the way (to it, then to its pen)
    case 'lead':
      return goOrKey(g, target, '', '');
    case 'reach':
    case 'night':
      return goOrKey(g, target, '', '');
    case 'place':
      return goOrKey(g, target, st.item, 'B');
    case 'grow':
      return goOrKey(g, target, st.crop, 'R');
    case 'upgrade':
      return station(g, 'table', '');
    case 'craft':
      // the step's own bench when it has one, else the nearest table or furnace
      return st.mark && target ? goOrKey(g, target, st.item, 'E') : station(g, recipeAt(g, st.item), st.item);
    case 'fetch':
    case 'deliver': {
      if (count(g, st.item) >= (st.n ?? 1)) return goOrKey(g, target, st.item, 'Space');
      if (target && st.t === 'fetch') return goOrKey(g, target, st.item, 'Space');
      if (knows(g, st.item)) return station(g, recipeAt(g, st.item), st.item);
      const node = nodeFor(g, st.item);
      if (node) return show('go', 'Space', node, st.item, '');
      return show('key', '', null, st.item, 'hint_look');
    }
    case 'defeat': {
      const boss = g.c.mobs[st.mob]?.role === 'boss';
      for (const m of g.rt.mobs)
        if (m.id === st.mob && m.area === s.area && !m.calm)
          return show(
            'go',
            'Space',
            { area: m.area, x: Math.floor(m.x), y: Math.floor(m.y) },
            st.mob,
            boss ? bossTip(g, st.mob, m.phase) : '',
          );
      if (target) return goOrKey(g, target, st.mob, 'Space');
      const nightOnly = nightMob(g, st.mob);
      return show('key', '', null, st.mob, nightOnly && !isNight(g) ? 'hint_night' : 'hint_look');
    }
    case 'fish':
      return goOrKey(g, target ?? place(g, 'jetty'), st.kind ?? 'fishing_rod', 'Space');
    default:
      return goOrKey(g, target, '', 'Space');
  }
}

/** Where a character stands now, or else at any of their spots (someone away still has a home to point at). */
function someWhere(g: Game, id: string): Place | null {
  const now = charPlace(g, id);
  if (now) return now;
  for (const sp of g.c.chars[id]?.spots ?? []) {
    const p = place(g, sp.at);
    if (p) return p;
  }
  return null;
}

/** An arrow to the place; the key picture by it once she is close. With no place, a picture of what it is about. */
function goOrKey(g: Game, at: Place | null, icon: string, key: string): HintShow {
  if (!at) return show('key', key === 'Space' ? '' : key, null, icon, icon ? 'hint_look' : '');
  const near = at.area === g.s.area && Math.hypot(at.x + 0.5 - g.s.x, at.y + 0.5 - g.s.y) < 3;
  return show('go', near ? key : '', at, icon, '');
}

/** The crafting table or furnace nearest to her (in this area, else anywhere), with E to open it. */
function station(g: Game, kind: 'table' | 'furnace', item: string): HintShow {
  let best: Place | null = null;
  let bd = 1e9;
  for (const a in g.c.areas) {
    const area = g.c.areas[a]!;
    for (const o of area.objects) {
      if (g.c.objects[o.type]?.interact !== kind) continue;
      const d = a === g.s.area ? Math.hypot(o.x - g.s.x, o.y - g.s.y) : 1e6;
      if (d < bd) {
        bd = d;
        best = { area: a, x: o.x, y: o.y };
      }
    }
  }
  return show('go', 'E', best, item, '');
}

function recipeAt(g: Game, item: string): 'table' | 'furnace' {
  for (const id in g.c.recipes) if (g.c.recipes[id]!.out === item) return g.c.recipes[id]!.at;
  return 'table';
}

/** The nearest thing in her area she can hit for this item (a tree for logs, a rock for stone). */
function nodeFor(g: Game, item: string): Place | null {
  const area = g.c.areas[g.s.area]!;
  const live = g.rt.live[g.s.area];
  let best: Place | null = null;
  let bd = 1e9;
  for (let i = 0; i < area.objects.length; i++) {
    if (live && !live[i]) continue;
    const o = area.objects[i]!;
    const node = g.c.objects[o.type]?.node;
    if (!node?.yield.some((y) => y.item === item)) continue;
    const d = Math.hypot(o.x - g.s.x, o.y - g.s.y);
    if (d < bd) {
      bd = d;
      best = { area: area.id, x: o.x, y: o.y };
    }
  }
  return best;
}

function nightMob(g: Game, mob: string): boolean {
  let any = false;
  for (const a in g.c.areas)
    for (const z of g.c.areas[a]!.zones) {
      if (!z.mobs.includes(mob)) continue;
      if (z.mode !== 'night') return false;
      any = true;
    }
  return any;
}

/** The boss's own tip for the part of the fight she is in (the banners already say these). */
function bossTip(g: Game, mob: string, phase: number): string {
  const S = g.c.strings;
  if (mob === 'creeper_king') return S['king_phase' + phase] ? 'king_phase' + phase : 'king_phase0';
  return phase > 0 && S.jockey_off ? 'jockey_off' : 'jockey_start';
}
