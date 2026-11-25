// Quests: offers, steps, objectives, rewards. Everything is driven by the data in src/data/quests.
import { canReach } from './guide.ts';
import { give, take, toolTier } from './bag.ts';
import { count, DAWN_AT, DUSK_AT, isNight, NIGHT_AT, test } from './cond.ts';
import { startCut } from './cutscene.ts';
import { shieldBack, upgradedIn } from './gear.ts';
import { adoptPet, restock } from './animals.ts';
import { objLive } from './grid.ts';
import { islandSpot, spotGone } from './island.ts';
import { spawnAt } from './mobs.ts';
import { cast, charName, fill, say } from './talk.ts';
import { placeSpot } from './spots.ts';
import type { BuildSite, Effects, Game, Line, Place, QuestDef, Step } from './types.ts';

export const OFFERS_PER_DAY = 3;

const need = (st: Step): number => ('n' in st && st.n ? st.n : 1);
const plural = (g: Game, id: string, n: number): string => {
  const d = g.c.items[id];
  if (!d) return id;
  return n === 1 ? d.name : (d.names ?? d.name + 's');
};

// ---------------------------------------------------------------- effects

export function applyFx(g: Game, fx: Effects | undefined): void {
  if (!fx) return;
  const s = g.s;
  if (fx.take) for (const id in fx.take) take(g, id, fx.take[id]!);
  if (fx.give) for (const id in fx.give) give(g, id, fx.give[id]!);
  if (fx.emeralds) {
    s.emeralds += fx.emeralds;
    g.ev.push({
      t: 'toast',
      kind: 'item',
      text: g.c.items.emerald?.name ?? 'Emerald',
      item: 'emerald',
      n: fx.emeralds,
    });
    g.ev.push({ t: 'sfx', id: 'coin' });
  }
  if (fx.recipes)
    for (const r of fx.recipes) {
      if (s.recipes.includes(r)) continue;
      s.recipes.push(r);
      const out = g.c.recipes[r]?.out ?? r;
      g.ev.push({ t: 'toast', kind: 'recipe', text: g.c.items[out]?.name ?? out, item: out });
      g.ev.push({ t: 'reward', kind: 'recipe', id: r });
    }
  if (fx.flags)
    for (const f of fx.flags) {
      if (!s.flags[f]) {
        s.flags[f] = 1;
        g.rt.dirty = true;
        if (f.startsWith('secret:')) g.ev.push({ t: 'reward', kind: 'secret', id: f });
      }
    }
  if (fx.clear)
    for (const f of fx.clear) {
      if (s.flags[f]) {
        delete s.flags[f];
        g.rt.dirty = true;
      }
    }
  if (fx.stickers) for (const id of fx.stickers) sticker(g, id);
  if (fx.hearts) addHearts(g, fx.hearts);
  if (fx.hug) {
    // Mum's hug in the prologue: always shown, so she sees what a hug does (package 46)
    shieldBack(g);
    s.hp = s.maxHp;
    g.ev.push({ t: 'fx', id: 'heart', x: s.x, y: s.y - 1, n: 5 });
    g.ev.push({ t: 'sfx', id: 'heart' });
    g.ev.push({ t: 'act', kind: 'hug' });
  }
  if (fx.shard) winShard(g, fx.shard);
  if (fx.mail) for (const m of fx.mail) if (!s.letters.includes(m) && !s.inbox.includes(m)) s.flags['mq:' + m] = 1;
  if (fx.mailNow)
    for (const m of fx.mailNow)
      if (!s.letters.includes(m) && !s.inbox.includes(m)) {
        s.inbox.push(m);
        g.ev.push({ t: 'reward', kind: 'mail', id: m });
      }
  if (fx.hero && !s.heroes.includes(fx.hero)) {
    s.heroes.push(fx.hero);
    g.ev.push({ t: 'toast', kind: 'hero', text: charName(g, fx.hero), item: fx.hero });
    g.ev.push({ t: 'reward', kind: 'hero', id: fx.hero });
  }
  if (fx.time === 'dusk' && s.time < DUSK_AT) s.time = DUSK_AT;
  // package 47a: a story night is a whole night, also when she comes at its last minute or at dawn
  if (fx.time === 'night' && !(s.time >= NIGHT_AT && s.time < DAWN_AT - 60)) s.time = NIGHT_AT;
  if (fx.time === 'morning' && s.time >= DUSK_AT && s.time < DAWN_AT + 21) s.time = DAWN_AT + 21;
  if (fx.toast) g.ev.push({ t: 'toast', kind: 'info', text: fx.toast });
  if (fx.music) g.ev.push({ t: 'music', id: fx.music });
  if (fx.spawn) for (const sp of fx.spawn) spawnAt(g, sp.mob, sp.n, sp.at);
  if (fx.start) startQuest(g, fx.start);
  if (fx.cut) startCut(g, fx.cut);
  if (fx.open) g.ev.push({ t: 'open', ui: fx.open });
  if (fx.claw) s.counts.clawGoes = (s.counts.clawGoes ?? 0) + fx.claw;
  if (fx.pet) adoptPet(g, fx.pet);
  g.rt.questRev++;
}

/** The journal's three sticker tabs. Anything else in the sticker list is a quiet record: a part of a set, a find for the Nature Table. */
export const JOURNAL_TABS = ['creatures', 'treasures', 'places'] as const;
/** What a finished tab gives, once: something for the house, or emeralds. */
export const TAB_PRIZE: Record<string, { item?: string; emeralds?: number }> = {
  creatures: { item: 'trophy_star' },
  treasures: { emeralds: 30 },
  places: { item: 'star_lamp' },
};
const isTab = (page: string): boolean => (JOURNAL_TABS as readonly string[]).includes(page);

/** A sticker lands quietly: the record, a soft sound and a sparkle on the K hint. No banner. */
/** "Long dogs 3 of 10": a set's name with how many of its parts she has (package 60: a find says so when picked up). */
export function setLine(g: Game, part: string): string {
  const of = g.c.stickers[part]?.of;
  if (!of) return '';
  let have = 0;
  let all = 0;
  for (const k in g.c.stickers)
    if (g.c.stickers[k]!.of === of) {
      all++;
      if (g.s.stickers[k]) have++;
    }
  const set = g.c.stickers[of]?.name ?? '';
  return `${set.charAt(0).toUpperCase() + set.slice(1)} ${have} of ${all}`;
}

export function sticker(g: Game, id: string): void {
  if (g.s.stickers[id]) return;
  const def = g.c.stickers[id];
  if (!def) return;
  g.s.stickers[id] = g.s.day || 1;
  // one of a set: the set's own sticker lands with the first part, and the journal counts the rest
  if (def.of) {
    sticker(g, def.of);
    return;
  }
  if (!isTab(def.page)) return;
  g.ev.push({ t: 'reward', kind: 'sticker', id });
  g.ev.push({ t: 'sfx', id: 'sticker' });
  pageCheck(g, def.page);
  fullBook(g);
}

/**
 * A full journal (all three tabs finished) brings Dad's letter with the next morning's post, once. It is asked each
 * morning too, for a save whose book was full before the letter existed.
 */
export function fullBook(g: Game): void {
  const s = g.s;
  if (s.letters.includes('dad_stickers') || s.inbox.includes('dad_stickers') || s.flags['mq:dad_stickers']) return;
  // full means she holds every sticker the tabs list today, not that old per-tab prize flags say so (a save from an
  // earlier build can hold the whole book without them)
  for (const id in g.c.stickers) {
    const d = g.c.stickers[id]!;
    if (!d.of && isTab(d.page) && !s.stickers[id]) return;
  }
  s.flags['mq:dad_stickers'] = 1;
  g.rt.dirty = true;
}

/** A finished journal tab gives its prize once. */
function pageCheck(g: Game, page: string): void {
  if (g.s.flags['page:' + page]) return;
  for (const id in g.c.stickers) {
    const d = g.c.stickers[id]!;
    if (d.page === page && !d.of && !g.s.stickers[id]) return;
  }
  g.s.flags['page:' + page] = 1;
  g.rt.dirty = true;
  const prize = TAB_PRIZE[page];
  if (prize?.item) give(g, prize.item, 1, true);
  if (prize?.emeralds) g.s.emeralds += prize.emeralds;
  g.ev.push({ t: 'reward', kind: 'secret', id: 'page:' + page });
}

export function addHearts(g: Game, n: number): void {
  g.s.maxHp = Math.min(28, g.s.maxHp + n * 2);
  g.s.hp = g.s.maxHp;
  g.ev.push({ t: 'toast', kind: 'heart', text: 'new_heart' });
  g.ev.push({ t: 'reward', kind: 'heart', id: 'heart' + g.s.maxHp });
  g.ev.push({ t: 'sfx', id: 'heart' });
}

function winShard(g: Game, n: number): void {
  const s = g.s;
  if (s.flags['shard' + n]) return;
  s.flags['shard' + n] = 1;
  s.shards++;
  s.pouch.shard = (s.pouch.shard ?? 0) + 1;
  g.ev.push({ t: 'toast', kind: 'shard', text: 'shard_won', item: 'shard', n: s.shards });
  g.ev.push({ t: 'reward', kind: 'shard', id: 'shard' + n });
  g.ev.push({ t: 'sfx', id: 'shard' });
  g.ev.push({ t: 'flash', color: 0xfff3b0 });
  addHearts(g, 1);
  for (const id in g.c.regions) {
    const r = g.c.regions[id]!;
    if (r.shard === n && !s.flags['lit:' + id]) {
      s.flags['lit:' + id] = 1;
      g.ev.push({ t: 'light', region: id });
      g.ev.push({ t: 'reward', kind: 'region', id });
    }
  }
  g.rt.dirty = true;
}

// ---------------------------------------------------------------- lifecycle

/**
 * The goal line's one rule (package 53a): it shows the current step of the quest she is on. A quest becomes the one she
 * is on when nothing is (or the one she was on is done), when she chooses it (takes it from its giver or a board,
 * picks it in the quest book), or when she is in the middle of one of its steps (talks to its person, digs its X).
 * A quest that merely starts by itself never takes the line from one with a step left.
 */
export function engage(g: Game, id: string): void {
  const q = g.s.quests[id];
  if (!q || q.done || g.s.tracked === id) return;
  g.s.tracked = id;
  g.rt.target = null;
  g.rt.questRev++;
}

/** Is the line on a story quest with a step left, and is `def` not a story quest itself? */
function storyLeft(g: Game, def: QuestDef): boolean {
  const t = g.s.tracked;
  const q = t ? g.s.quests[t] : undefined;
  if (!t || !q || q.done || def.kind === 'main') return false;
  const on = g.c.quests[t];
  return on?.kind === 'main' && q.step < on.steps.length;
}

/** Start a quest. `chosen`: she took it herself (from its giver or a board), so it becomes the one she is on. */
export function startQuest(g: Game, id: string, chosen = false): void {
  const def = g.c.quests[id];
  if (!def) throw new Error(`unknown quest ${id}`);
  const old = g.s.quests[id];
  if (old && !old.done) return;
  if (old?.done && !def.repeat) return;
  g.s.quests[id] = { step: 0, n: 0, times: old?.times, day: old?.day };
  // package 69: a job she takes from someone (or a board) while a story step is left goes into the quest book only;
  // the line moves to it when she picks it there or does one of its steps (engage), and back when it is done
  if ((chosen && !storyLeft(g, def)) || !g.s.tracked || !g.s.quests[g.s.tracked] || g.s.quests[g.s.tracked]!.done)
    g.s.tracked = id;
  g.ev.push({ t: 'toast', kind: 'quest', text: fill(g, def.name), item: 'new' });
  g.ev.push({ t: 'sfx', id: 'quest' });
  g.rt.dirty = true;
  if (def.onStart) applyFx(g, def.onStart);
  enterStep(g, def, 0);
  g.rt.questRev++;
}

/**
 * After a load: every quest's current step gets what it puts in the world (its drop flag makes this safe to repeat),
 * so a step reached by loading, or by moving an old save to new step numbers, has its find at its mark (review 55).
 * `old`: the save came from an earlier build, so a reward quest it never started (a finished quest's `start`) starts.
 */
export function settleQuests(g: Game, old = false): void {
  for (const id in g.s.quests) {
    const q = g.s.quests[id]!;
    const def = g.c.quests[id];
    if (!def) continue;
    if (!q.done) enterStep(g, def, q.step);
    else if (old && def.rewards?.start && !g.s.quests[def.rewards.start] && g.c.quests[def.rewards.start])
      startQuest(g, def.rewards.start);
  }
}

function enterStep(g: Game, def: QuestDef, i: number): void {
  const st = def.steps[i];
  if (!st) return;
  if (st.drop)
    st.drop.forEach((d, j) => {
      const f = `qd:${def.id}:${i}:${j}`;
      if (g.s.flags[f]) return;
      g.s.flags[f] = 1;
      const p = place(g, d.at);
      if (p) g.s.drops.push({ area: p.area, x: p.x + 0.5, y: p.y + 0.5, id: d.item, n: 1 });
    });
}

export function completeStep(g: Game, id: string): void {
  const def = g.c.quests[id]!;
  const q = g.s.quests[id];
  if (!q || q.done) return;
  const st = def.steps[q.step];
  q.step++;
  q.n = 0;
  g.ev.push({ t: 'reward', kind: 'step', id: `${id}:${q.step}` });
  g.ev.push({ t: 'sfx', id: 'step' });
  // package 60: a hand-in says so in one strip ("Apples given") before the goal moves on
  if (st?.t === 'deliver') {
    const n = need(st);
    const text = (g.c.strings.given ?? 'You gave {n} {item}.')
      .replace('{n}', String(n))
      .replace('{item}', plural(g, st.item, n));
    g.ev.push({ t: 'toast', kind: 'item', text, item: st.item, n });
  }
  g.ev.push({ t: 'save' });
  if (st?.fx) applyFx(g, st.fx);
  g.rt.dirty = true;
  if (q.step < def.steps.length) {
    enterStep(g, def, q.step);
    g.ev.push({ t: 'toast', kind: 'step', text: objective(g, id) });
  } else if (!def.close) finishQuest(g, id);
  g.rt.questRev++;
}

export function finishQuest(g: Game, id: string): void {
  const def = g.c.quests[id]!;
  const q = g.s.quests[id];
  if (!q || q.done) return;
  q.done = true;
  q.times = (q.times ?? 0) + 1;
  q.day = g.s.day;
  g.s.counts.quests = (g.s.counts.quests ?? 0) + 1;
  g.ev.push({ t: 'toast', kind: 'quest', text: fill(g, def.name), item: 'done' });
  g.ev.push({ t: 'reward', kind: 'quest', id });
  g.ev.push({ t: 'sfx', id: 'fanfare' });
  g.ev.push({ t: 'fx', id: 'confetti', x: g.s.x, y: g.s.y });
  g.ev.push({ t: 'save' });
  applyFx(g, def.rewards);
  // Every Wanted poster also pays a prize ticket, so the prize counter can never run short of a thing a quest needs.
  if (def.kind === 'bounty') give(g, 'ticket', 1);
  if (g.s.tracked === id) {
    g.s.tracked = null;
    for (const k of g.c.questOrder) {
      const o = g.s.quests[k];
      if (o && !o.done && (g.c.quests[k]!.kind === 'main' || !g.s.tracked)) {
        g.s.tracked = k;
        if (g.c.quests[k]!.kind === 'main') break;
      }
    }
  }
  g.rt.dirty = true;
  g.rt.questRev++;
  refreshQuests(g);
}

/** Is this quest waiting to be picked up (shown with a star over its giver, or on a board)? */
export function offered(g: Game, def: QuestDef): boolean {
  const q = g.s.quests[def.id];
  if (q && !q.done) return false;
  if (q?.done && (!def.repeat || q.day === g.s.day)) return false;
  if (def.auto) return false;
  if (!test(g, def.requires)) return false;
  // the board holds its own jobs (package 41): they are not part of the three new offers a day
  if (def.kind === 'main' || def.kind === 'bounty' || def.board) return true;
  return !!g.s.flags['off:' + def.id];
}

/** Start story quests whose time has come, and put up to three new side quests on offer each day. */
export function refreshQuests(g: Game): void {
  const s = g.s;
  for (const id of g.c.questOrder) {
    const def = g.c.quests[id]!;
    const q = s.quests[id];
    if (def.auto && !q && test(g, def.requires)) startQuest(g, id);
  }
  const key = 'offers:' + s.day;
  let today = s.counts[key] ?? 0;
  if (today < OFFERS_PER_DAY)
    for (const id of g.c.questOrder) {
      const def = g.c.quests[id]!;
      if ((def.kind !== 'side' && def.kind !== 'friend') || def.board) continue;
      if (s.quests[id] || s.flags['off:' + id] || !test(g, def.requires)) continue;
      s.flags['off:' + id] = s.day || 1;
      today++;
      g.rt.dirty = true;
      if (today >= OFFERS_PER_DAY) break;
    }
  s.counts[key] = today;
}

// ---------------------------------------------------------------- progress

/** Something happened in the world that a step may be waiting for. */
export function questEvent(g: Game, type: string, id: string, n = 1, extra = ''): void {
  for (const qid in g.s.quests) {
    const q = g.s.quests[qid]!;
    if (q.done) continue;
    const def = g.c.quests[qid]!;
    const st = def.steps[q.step];
    if (!st) continue;
    let hit = false;
    switch (st.t) {
      case 'craft':
        hit = type === 'craft' && st.item === id;
        break;
      case 'place':
        hit = type === 'place' && st.item === id;
        break;
      case 'site':
        hit = type === 'site' && st.site === id;
        break;
      case 'defeat':
        hit = type === 'defeat' && (st.mob === id || st.mob === 'any') && (!st.zone || st.zone === extra);
        break;
      case 'fish':
        hit = type === 'fish' && (!st.kind || st.kind === id);
        break;
      case 'grow':
        hit = type === 'grow' && st.crop === id;
        break;
      case 'lead':
        hit = type === 'lead' && st.animal === id && st.pen === extra;
        break;
      case 'mini':
        hit = type === 'mini' && st.game === id && n >= (st.stars ?? 1);
        if (hit) n = 1;
        break;
      case 'sleep':
        hit = type === 'sleep';
        break;
      default:
        break;
    }
    if (!hit) continue;
    q.n += n;
    if (q.n >= need(st)) stepDone(g, qid, st);
    else g.rt.questRev++;
  }
}

function stepDone(g: Game, qid: string, st: Step): void {
  completeStep(g, qid);
  if (!st.say) return;
  // (a talk still held back from the step before goes first, so no line is lost or out of order)
  const held = g.rt.sayLater;
  if (held) {
    g.rt.sayLater = undefined;
    say(g, held.lines);
  }
  // package 68: a count that has just filled shows full ("Spiders 3 of 3") for a second before the talk comes
  if (need(st) > 1 && g.rt.mode === 'play') g.rt.sayLater = { lines: st.say, t: 1 };
  else say(g, st.say);
}

/** Package 68: the talk a filled count held back, once its second is up (only in plain play). */
export function stepSayLater(g: Game): void {
  const w = g.rt.sayLater;
  if (!w || g.rt.mode !== 'play') return;
  w.t -= 1 / 60;
  if (w.t > 0) return;
  g.rt.sayLater = undefined;
  say(g, w.lines);
}

/** Steps that are met by a state of the world rather than an event. Called a few times a second. */
export function pollQuests(g: Game): void {
  const s = g.s;
  for (const qid in s.quests) {
    const q = s.quests[qid]!;
    if (q.done) continue;
    const def = g.c.quests[qid]!;
    const st = def.steps[q.step];
    if (!st) continue;
    let ok = false;
    switch (st.t) {
      case 'fetch':
      case 'craft':
        ok = count(g, st.item) >= need(st);
        break;
      case 'place': {
        let c = 0;
        for (const p of s.placed) if (p.item === st.item) c++;
        ok = c >= need(st);
        break;
      }
      case 'site':
        ok = !!s.flags[siteFlag(g, st.site)];
        break;
      case 'reach':
        ok = near(g, st.place) || cleared(g, st.clear);
        break;
      case 'night':
        ok = isNight(g) && near(g, st.place);
        break;
      case 'lead': {
        let c = 0;
        let loose = 0;
        for (const a of s.animals)
          if (a.kind === st.animal) {
            if (a.pen === st.pen) c++;
            else if (!a.pen) loose++;
          }
        // Earlier lead steps of this quest for the same pen have used up their animals: this one needs its own.
        let prior = 0;
        for (let i = 0; i < q.step; i++) {
          const e = def.steps[i]!;
          if (e.t === 'lead' && e.animal === st.animal && e.pen === st.pen) prior += need(e);
        }
        ok = c >= prior + need(st);
        // An animal that lives in one of her own pens never follows food again. If too few are left loose for this
        // step, more wander in at the herd nearest the pen, so the step can always be finished.
        if (!ok && loose < prior + need(st) - c) restock(g, st.animal, st.pen, prior + need(st) - c - loose);
        break;
      }
      case 'grow':
        ok = count(g, st.crop) >= need(st) && q.n > 0;
        break;
      case 'defeat':
        recall(g, def, q.step, need(st) - q.n);
        break;
      case 'upgrade':
        ok = upgradedIn(g, st.slot);
        break;
      default:
        break;
    }
    if (ok) stepDone(g, qid, st);
  }
}

/** Are all these things in the way gone (cut, chopped, shot)? False for none listed. */
export function cleared(g: Game, ids: string[] | undefined): boolean {
  if (!ids?.length) return false;
  for (const id of ids) if (!g.s.taken[id] && g.s.nodes[id] === undefined) return false;
  return true;
}

/**
 * A fight can never be lost for good. The story mobs a `defeat` step waits for (the spawn of the step before
 * it) are there again whenever she is in their area and too few of them are: after she left mid-fight, was
 * carried home, loaded a save, or was somewhere else when the story first sent them.
 */
function recall(g: Game, def: QuestDef, at: number, left: number): void {
  const st = def.steps[at]!;
  // the spawn is the step before; a run of fights sent together (ch6's two skeletons) looks back past its own fights
  let j = at - 1;
  while (j >= 0 && def.steps[j]!.t === 'defeat' && !def.steps[j]!.fx?.spawn) j--;
  const src = j >= 0 ? def.steps[j]!.fx?.spawn : def.onStart?.spawn;
  if (st.t !== 'defeat' || !src || left <= 0) return;
  const here = src.filter((sp) => (st.mob === 'any' || sp.mob === st.mob) && place(g, sp.at)?.area === g.s.area);
  if (here.length === 0) return;
  let alive = 0;
  for (const m of g.rt.mobs)
    if (!m.gone && m.tag === 'story' && here.some((sp) => sp.mob === m.id && sp.at === m.zone)) alive++;
  for (let i = 0; alive < left && i < 12; i++, alive++) {
    const sp = here[i % here.length]!;
    spawnAt(g, sp.mob, 1, sp.at);
  }
}

function siteFlag(g: Game, site: string): string {
  for (const a in g.c.areas) for (const b of g.c.areas[a]!.sites) if (b.id === site) return b.flag;
  return 'site:' + site;
}

export function place(g: Game, name: string): Place | null {
  for (const a in g.c.areas) {
    const p = g.c.areas[a]!.places[name];
    if (p) return p;
  }
  return null;
}
/** She stands on the spot of another quest's find step (a dig X): that is the quest she is in the middle of. */
export function engageHere(g: Game): void {
  for (const qid in g.s.quests) {
    if (qid === g.s.tracked) continue;
    const q = g.s.quests[qid]!;
    const st = q.done ? undefined : g.c.quests[qid]?.steps[q.step];
    if (st?.t === 'fetch' && st.mark && near(g, st.mark)) {
      engage(g, qid);
      return;
    }
  }
}

function near(g: Game, name: string): boolean {
  const p = place(g, name);
  if (!p || p.area !== g.s.area) return false;
  const r = p.r ?? 2.5;
  const dx = g.s.x - (p.x + 0.5);
  const dy = g.s.y - (p.y + 0.5);
  return dx * dx + dy * dy <= r * r;
}

// ---------------------------------------------------------------- talking to people

const lines = (g: Game, who: string, main: Line[] | undefined, alt: Line[] | undefined): Line[] | undefined =>
  who === g.s.hero && alt ? alt : main;

/** She pressed Space on a character. Returns true when a quest had something to say. */
export function talkTo(g: Game, charId: string, npc = 0): boolean {
  const s = g.s;
  /** A hand-over she cannot make yet: only said when this character has nothing else for her. */
  let short: (() => void) | null = null;
  const order = s.tracked ? [s.tracked, ...g.c.questOrder.filter((k) => k !== s.tracked)] : g.c.questOrder;
  for (const qid of order) {
    const q = s.quests[qid];
    if (!q || q.done) continue;
    const def = g.c.quests[qid]!;
    const st = def.steps[q.step];
    if (!st) {
      if (cast(g, def.giver) !== charId) continue;
      engage(g, qid);
      say(g, lines(g, def.giver, def.close, def.closeAlt), () => finishQuest(g, qid), npc);
      return true;
    }
    if (st.t === 'talk' && cast(g, st.who) === charId) {
      engage(g, qid);
      say(g, lines(g, st.who, st.say, st.sayAlt), () => completeStep(g, qid), npc);
      return true;
    }
    if (st.t === 'deliver' && cast(g, st.to) === charId) {
      const n = need(st);
      const have = count(g, st.item);
      if (have < n) {
        short ??= () => {
          // the placeholders first, then the name tokens (fill must never see {n} or {item})
          g.rt.nudge = fill(
            g,
            (g.c.strings.need_more ?? '')
              .replace('{n}', String(n - have))
              .replace('{item}', plural(g, st.item, n - have)),
          );
          g.rt.nudgeT = 4;
          g.ev.push({ t: 'sfx', id: 'nope' });
        };
        continue;
      }
      engage(g, qid);
      g.ev.push({ t: 'fx', id: 'giveitem', x: g.s.x, y: g.s.y, item: st.item });
      // The thing leaves her bag in the same moment the step is done, so a save made in the middle of the talk
      // can never hold "thing gone, step not done".
      say(
        g,
        lines(g, st.to, st.say, st.sayAlt),
        () => {
          take(g, st.item, n);
          completeStep(g, qid);
        },
        npc,
      );
      return true;
    }
  }
  for (const qid of g.c.questOrder) {
    const def = g.c.quests[qid]!;
    if (def.board || def.kind === 'bounty') continue;
    if (cast(g, def.giver) !== charId || !offered(g, def)) continue;
    say(g, lines(g, def.giver, def.open, def.openAlt), () => startQuest(g, qid, true), npc);
    return true;
  }
  if (short) {
    short();
    // Someone who keeps a game or a hug still keeps it while a hand-over waits (review 22, note 11).
    return !g.c.chars[charId]?.service;
  }
  return false;
}

/** The noticeboard and Woody's bounty board hand out the next quest they hold. */
export function boardOffer(g: Game, kind: 'board' | 'bounty'): boolean {
  // A poster she has never taken comes first, then the one she did longest ago, so every poster comes round.
  let best: string | null = null;
  let bestDay = Infinity;
  for (const qid of g.c.questOrder) {
    const def = g.c.quests[qid]!;
    if (kind === 'board' ? !def.board : def.kind !== 'bounty') continue;
    if (kind === 'bounty' && activeBounty(g)) continue;
    if (!offered(g, def)) continue;
    const day = g.s.quests[qid]?.done ? (g.s.quests[qid]!.day ?? 0) : -1;
    if (day < bestDay) {
      best = qid;
      bestDay = day;
    }
  }
  if (!best) return false;
  const id = best;
  say(g, g.c.quests[id]!.open, () => startQuest(g, id, true));
  return true;
}
function activeBounty(g: Game): boolean {
  for (const qid in g.s.quests) if (!g.s.quests[qid]!.done && isPoster(g.c.quests[qid]!)) return true;
  return false;
}
/** A Wanted poster (Woody's fight job that comes round again), as against a one-off board job. */
export const isPoster = (d: QuestDef): boolean => d.kind === 'bounty' && !!d.repeat;

/** 0 nothing, 1 has a quest to give or a step for her, 2 the tracked quest wants her, 3 keeps a service. */
export function npcMark(g: Game, charId: string): number {
  const s = g.s;
  let mark = 0;
  for (const qid in s.quests) {
    const q = s.quests[qid]!;
    if (q.done) continue;
    const def = g.c.quests[qid]!;
    const st = def.steps[q.step];
    const who = !st ? def.giver : st.t === 'talk' ? st.who : st.t === 'deliver' ? st.to : null;
    if (who && cast(g, who) === charId) {
      if (qid === s.tracked) return 2;
      mark = 1;
    }
  }
  if (mark) return mark;
  for (const qid of g.c.questOrder) {
    const def = g.c.quests[qid]!;
    if (def.board || def.kind === 'bounty') continue;
    if (cast(g, def.giver) === charId && offered(g, def)) return 1;
  }
  // the green dot for "keeps a shop or a game" went (package 46: a mark nobody could read); she finds out by talking
  return 0;
}

// ---------------------------------------------------------------- what the HUD shows

export function objective(g: Game, qid: string): string {
  const def = g.c.quests[qid];
  const q = g.s.quests[qid];
  if (!def || !q) return '';
  const S = g.c.strings;
  const st = def.steps[q.step];
  if (!st) return (S.obj_return ?? '').replace('{who}', charName(g, cast(g, def.giver)));
  // G, 22 Nov 2026: at home with the thing in her bag, the line says where it goes and what to press
  if (st.t === 'place' && placeSpot(g)?.qid === qid) return placeRingLine(g, st.item, false);
  if (st.goal) return fill(g, st.goal);
  const n = need(st);
  const t = (S['obj_' + st.t] ?? st.t).replace('{n}', String(n));
  switch (st.t) {
    case 'talk':
      return t.replace('{who}', charName(g, cast(g, st.who)));
    case 'fetch':
    case 'craft':
    case 'place':
      return t.replace('{item}', plural(g, st.item, n));
    case 'deliver':
      return t.replace('{item}', plural(g, st.item, n)).replace('{who}', charName(g, cast(g, st.to)));
    case 'site':
      return t.replace('{site}', siteName(g, st.site));
    case 'defeat': {
      const m = g.c.mobs[st.mob];
      return t.replace('{mob}', m ? (n === 1 ? m.name : m.name + 's') : (S.mob_any ?? 'mobs'));
    }
    case 'reach':
    case 'night':
      return t.replace('{place}', place(g, st.place)?.label ?? st.place);
    case 'fish':
      return st.kind ? t.replace('fish', plural(g, st.kind, n)) : t;
    case 'grow':
      return t.replace('{crop}', plural(g, st.crop, n));
    case 'lead': {
      const a = g.c.animals[st.animal];
      return t
        .replace('{animal}', a ? (n === 1 ? a.name : a.name + 's') : st.animal)
        .replace('{pen}', place(g, st.pen)?.label ?? st.pen);
    }
    case 'mini':
      return t.replace('{game}', S['mini:' + st.game] ?? st.game);
    default:
      return t;
  }
}
/** "Put the armour stand in the gold ring. Press Space." (on an iPad: "Tap Place.") */
export function placeRingLine(g: Game, item: string, touch: boolean): string {
  const S = g.c.strings;
  const t = (touch ? S.touch_place_ring : S.place_ring) ?? '';
  return t.replace('{item}', g.c.items[item]?.name ?? item);
}
function siteName(g: Game, site: string): string {
  for (const a in g.c.areas) for (const b of g.c.areas[a]!.sites) if (b.id === site) return b.name;
  return site;
}

/** [have, need] for steps that count, or null. */
export function progress(g: Game, qid: string): [number, number] | null {
  const def = g.c.quests[qid];
  const q = g.s.quests[qid];
  const st = def?.steps[q?.step ?? 0];
  if (!def || !q || !st) return null;
  const n = need(st);
  switch (st.t) {
    case 'fetch':
    case 'craft':
    case 'deliver':
      return n > 1 ? [Math.min(n, count(g, st.item)), n] : null;
    case 'defeat':
    case 'fish':
    case 'lead':
    case 'grow':
      return n > 1 ? [Math.min(n, q.n), n] : null;
    case 'site': {
      const site = findSite(g, st.site);
      if (!site) return null;
      let have = 0;
      let all = 0;
      for (const k in site.needs) {
        all += site.needs[k]!;
        have += Math.min(site.needs[k]!, count(g, k));
      }
      return [have, all];
    }
    default:
      return null;
  }
}
export function findSite(g: Game, id: string) {
  for (const a in g.c.areas) for (const b of g.c.areas[a]!.sites) if (b.id === id) return { ...b, area: a };
  return null;
}

// ---------------------------------------------------------------- island projects at their own place (package 71)
// G (D78): "no way of fixing the attached bridge?" A project's build site shows only once its board job is taken;
// before that the place said nothing useful. Now Space at the place of any project not yet built opens one card: its
// name, what it needs, how many of each she has, and either "Space: start the job" or what comes first. One rule for
// every project: a build site whose `if` is "this board job is running", where that job has a step for this site.

/** The board job that builds this site, or '' when the site is not a project. */
export function projectOf(g: Game, site: BuildSite): string {
  const qid = site.if?.active;
  const def = qid ? g.c.quests[qid] : undefined;
  if (!def?.board) return '';
  return def.steps.some((st) => st.t === 'site' && st.site === site.id) ? def.id : '';
}

export interface ProjectInfo {
  site: BuildSite;
  qid: string;
  /** the job can be taken now */
  can: boolean;
  /** what comes first, as one short line ('' when it can be taken) */
  why: string;
}

/** The card for a project not yet built and whose job is not taken, or null (built, running, or not a project). */
export function projectInfo(g: Game, siteId: string): ProjectInfo | null {
  const site = findSite(g, siteId);
  if (!site || g.s.flags[site.flag]) return null;
  const qid = projectOf(g, site);
  if (!qid) return null;
  const q = g.s.quests[qid];
  if (q && !q.done) return null;
  const def = g.c.quests[qid]!;
  const can = offered(g, def);
  return { site, qid, can, why: can ? '' : firstLine(g, def) };
}

/** One short line on what she must do before this job opens. */
function firstLine(g: Game, def: QuestDef): string {
  const S = g.c.strings;
  const c = def.requires;
  if (c?.shards !== undefined && g.s.shards < c.shards) {
    const n = c.shards - g.s.shards;
    return (n === 1 ? S.proj_first_shard : S.proj_first_shards)?.replace('{n}', String(n)) ?? '';
  }
  return S.proj_first_story ?? '';
}

/**
 * The project whose place she is at (in this area), or null: beside where she would hand things over, beside the
 * site itself, or facing the gap it would mend.
 */
export function projectNear(g: Game, fx: number, fy: number): BuildSite | null {
  const s = g.s;
  const a = g.c.areas[s.area]!;
  for (const site of a.sites) {
    if (s.flags[site.flag] || !projectOf(g, site)) continue;
    const q = s.quests[projectOf(g, site)];
    if (q && !q.done) continue;
    const r = site.rect;
    const dx = Math.max(r.x - s.x, 0, s.x - (r.x + r.w));
    const dy = Math.max(r.y - s.y, 0, s.y - (r.y + r.h));
    const atSpot = Math.abs(s.x - (site.at.x + 0.5)) < 1.6 && Math.abs(s.y - (site.at.y + 0.5)) < 1.6;
    const facing = a.barriers.some(
      (b) =>
        b.flag === site.flag &&
        fx >= b.rect.x &&
        fy >= b.rect.y &&
        fx < b.rect.x + b.rect.w &&
        fy < b.rect.y + b.rect.h,
    );
    if (atSpot || facing || Math.hypot(dx, dy) <= 1.2) return site;
  }
  return null;
}

/** What a closed project gap says when she bumps it: it names the thing ("The jetty is broken."). */
export function projectGateLine(g: Game, flag: string): string {
  const site = g.c.areas[g.s.area]!.sites.find((x) => x.flag === flag);
  if (!site || !projectOf(g, site)) return '';
  const name = site.name.charAt(0).toUpperCase() + site.name.slice(1);
  const many = /s$/.test(site.name);
  return (g.c.strings[many ? 'gate_broken_many' : 'gate_broken'] ?? '{thing}').replace('{thing}', name);
}

/** Where a character stands right now according to their spots (not where they have wandered to). */
export function charPlace(g: Game, charId: string): Place | null {
  const c = g.c.chars[charId];
  if (!c) return null;
  if (islandSpot(g, charId) === 'none') return null;
  for (const sp of c.spots) if (!spotGone(g, sp) && test(g, sp.if)) return place(g, sp.at);
  return null;
}

/** Where the helper arrow should point for a quest, or null when the step has no single place. */
/** A fight step: the nearest enemy here that still counts for it, within a screen or so (package 53a). */
function nearestFoe(g: Game, st: Step & { t: 'defeat' }, key: string): { x: number; y: number; tall: number } | null {
  let best: { x: number; y: number; tall: number; k: number } | null = null;
  let bd = 16 * 16;
  const was = g.rt.foe?.key === key ? g.rt.foe : undefined;
  for (const m of g.rt.mobs) {
    if (m.gone || m.calm || (st.mob !== 'any' && m.id !== st.mob) || (st.zone && m.zone !== st.zone)) continue;
    if (st.mob === 'any' && g.c.mobs[m.id]?.role !== 'hostile' && g.c.mobs[m.id]?.role !== 'boss') continue;
    const d = (m.x - g.s.x) ** 2 + (m.y - g.s.y) ** 2;
    // package 69: the enemy the star was on stays the one (out to 24 tiles), so the arrow does not swap between two
    if (was && m.k === was.k && d < 24 * 24 && canReach(g, m.x, m.y)) {
      best = { x: m.x, y: m.y, tall: g.c.mobs[m.id]?.tall ?? 2, k: m.k };
      break;
    }
    // package 60: never a mob she cannot walk to (a spider over the water)
    if (d < bd && canReach(g, m.x, m.y)) {
      bd = d;
      best = { x: m.x, y: m.y, tall: g.c.mobs[m.id]?.tall ?? 2, k: m.k };
    }
  }
  if (best) {
    g.rt.foe = { key, k: best.k, area: g.s.area, x: best.x, y: best.y };
    return best;
  }
  // package 69: the enemy went out of sight: the star stays where it was last seen (never back to the step's mark
  // behind her, run d 0064) until she gets there
  if (was && was.area === g.s.area && Math.hypot(was.x - g.s.x, was.y - g.s.y) > 3)
    return { x: was.x, y: was.y, tall: 2 };
  return null;
}

export function stepTarget(g: Game, qid: string): Place | null {
  const t = stepPlace(g, qid);
  // issue 65: out of arrows by a high web she must shoot: first where she can make or find more
  const what = arrowsFirst(g, t);
  g.rt.restock = what;
  if (!what) return t;
  g.rt.targetUp = 0;
  return (what === 'make' ? benchNear(g) : sourceNear(g, what)) ?? t;
}

/** How near (in tiles each way) a high web must be for running out of arrows to send her off for more. */
const WEB_NEAR = 12;

/**
 * Issue 65: she wears a bow but has no arrows, knows how to make them, the step's place is beyond her reach and a high
 * web she can walk up to is near: what to get first. 'make' when a stick and a feather are in her bag (at a bench),
 * else the one she lacks; '' when none of this holds.
 */
export function arrowsFirst(g: Game, tgt: Place | null): string {
  const s = g.s;
  if (!tgt || tgt.area !== s.area || count(g, 'arrow') > 0 || toolTier(g, 'bow') === 0) return '';
  if (!s.recipes.includes('arrow') || canReach(g, tgt.x + 0.5, tgt.y + 0.5)) return '';
  const a = g.c.areas[s.area];
  if (!a) return '';
  let web = false;
  for (const o of a.objects) {
    if (Math.abs(o.x + 0.5 - s.x) > WEB_NEAR || Math.abs(o.y + 0.5 - s.y) > WEB_NEAR) continue;
    if (g.c.objects[o.type]?.node?.tool !== 'bow' || !objLive(g, o) || !canReach(g, o.x + 0.5, o.y + 0.5)) continue;
    web = true;
    break;
  }
  if (!web) return '';
  if (count(g, 'stick') > 0 && count(g, 'feather') > 0) return 'make';
  return count(g, 'feather') > 0 ? 'stick' : 'feather';
}

/** The nearest bench in her area (on the map or one she put down) she can walk to. */
function benchNear(g: Game): Place | null {
  const s = g.s;
  const a = g.c.areas[s.area];
  if (!a) return null;
  let best: Place | null = null;
  let bd = Number.POSITIVE_INFINITY;
  const look = (x: number, y: number) => {
    const d = (x + 0.5 - s.x) ** 2 + (y + 0.5 - s.y) ** 2;
    if (d < bd && canReach(g, x + 0.5, y + 0.5)) {
      bd = d;
      best = { area: a.id, x, y };
    }
  };
  for (const o of a.objects) if (g.c.objects[o.type]?.interact === 'table' && objLive(g, o)) look(o.x, o.y);
  for (const p of s.placed) if (p.area === s.area && g.c.items[p.item]?.place?.use === 'table') look(p.x, p.y);
  return best;
}

function stepPlace(g: Game, qid: string): Place | null {
  g.rt.targetUp = 0;
  const def = g.c.quests[qid];
  const q = g.s.quests[qid];
  if (!def || !q || q.done) return null;
  const st = def.steps[q.step];
  const who = (id: string): Place | null => {
    const c = cast(g, id);
    g.rt.targetUp = g.c.chars[c]?.tall ?? 2;
    return charPlace(g, c);
  };
  if (!st) return who(def.giver);
  if (st.t === 'defeat') {
    const m = nearestFoe(g, st, `${qid}:${q.step}`);
    if (m) {
      g.rt.targetUp = m.tall;
      // not snapped to a tile: the star rides on the enemy as it moves
      return { area: g.s.area, x: m.x - 0.5, y: m.y - 0.5 };
    }
  }
  // package 57a: once an animal follows her, the star moves from where it was found to its pen
  if (st.t === 'lead' && g.s.animals.some((a) => a.led && a.kind === st.animal)) return place(g, st.pen);
  // issue 56: and before that, while she has none of its food, to the nearest place here she can get some
  if (st.t === 'lead') {
    const food = g.c.animals[st.animal]?.food;
    const src = food && count(g, food) === 0 ? sourceNear(g, food) : null;
    if (src) return src;
  }
  if (st.t === 'deliver' && count(g, st.item) >= need(st)) {
    const recipient = who(st.to);
    if (recipient) return recipient;
    g.rt.targetUp = 0;
  }
  if (st.mark) return place(g, st.mark);
  switch (st.t) {
    case 'talk':
      return who(st.who);
    case 'deliver':
      return count(g, st.item) >= need(st) ? who(st.to) : null;
    case 'fetch':
    case 'craft': {
      // a thing that fell to the ground when her bag was full is marked where it lies
      for (const d of g.s.drops) if (d.id === st.item) return { area: d.area, x: Math.floor(d.x), y: Math.floor(d.y) };
      return null;
    }
    case 'site': {
      const b = findSite(g, st.site);
      return b ? { area: b.area, x: b.at.x, y: b.at.y } : null;
    }
    case 'reach':
    case 'night':
      return place(g, st.place);
    case 'lead':
      return place(g, st.pen);
    case 'place': {
      // the gold ring where it goes, once she is home with it (src/core/spots.ts)
      const spot = placeSpot(g);
      if (spot && spot.qid === qid) return { area: spot.area, x: spot.x, y: spot.y };
      const where = g.c.items[st.item]?.place?.where;
      const inside = where === 'house' || (where !== 'plot' && /\b(cottage|inside)\b/i.test(st.goal ?? ''));
      if (inside) return g.s.area === 'cottage' ? null : place(g, 'bed');
      return place(g, 'plot_gate');
    }
    case 'grow':
      return place(g, 'plot_gate');
    case 'sleep':
      return place(g, 'bed');
    default:
      return null;
  }
}

/** The nearest thing in her area she can pick or gather this item from now (with the tools she has), on ground she
 * can walk to; null when there is none. */
function sourceNear(g: Game, item: string): Place | null {
  const a = g.c.areas[g.s.area];
  if (!a) return null;
  let best: Place | null = null;
  let bd = Number.POSITIVE_INFINITY;
  for (const o of a.objects) {
    const node = g.c.objects[o.type]?.node;
    if (!node || node.tool === 'bow' || g.s.nodes[o.id] !== undefined || !objLive(g, o)) continue;
    if (node.tool && toolTier(g, node.tool) < (node.tier ?? 1)) continue;
    if (!node.yield.some((y) => y.item === item && (y.p ?? 1) >= 0.5)) continue;
    const d = (o.x + 0.5 - g.s.x) ** 2 + (o.y + 0.5 - g.s.y) ** 2;
    if (d < bd && canReach(g, o.x + 0.5, o.y + 0.5)) {
      bd = d;
      best = { area: a.id, x: o.x, y: o.y };
    }
  }
  return best;
}

/** Active quests, tracked first, for the quest book. */
export function activeQuests(g: Game): string[] {
  const out: string[] = [];
  for (const id of g.c.questOrder) {
    const q = g.s.quests[id];
    if (q && !q.done) out.push(id);
  }
  if (g.s.tracked) {
    const i = out.indexOf(g.s.tracked);
    if (i > 0) {
      out.splice(i, 1);
      out.unshift(g.s.tracked);
    }
  }
  return out;
}
