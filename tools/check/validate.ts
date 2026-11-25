// Data validator: references, item sources, recipes, quests, stand-ins, scope numbers and (with --art) art.
// Run: node tools/check/validate.ts [--scope] [--art]
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLAW_PRIZES, MINIS } from '../../src/core/minigames.ts';
import type { Content, Cond, Effects, Line, QuestDef, Role, Step } from '../../src/core/types.ts';
import { content as realContent } from '../../src/data/content.ts';
import { cast as artCast } from '../art/cast.ts';
import scopeJson from '../../src/data/scope.json' with { type: 'json' };

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const STEP_TYPES = [
  'talk',
  'fetch',
  'deliver',
  'craft',
  'place',
  'site',
  'defeat',
  'reach',
  'fish',
  'grow',
  'lead',
  'mini',
  'sleep',
  'night',
  'upgrade',
];
const EXTRA_GROUPS = ['toys', 'sanrio', 'minions', 'gabby', 'paddington'];
const STYLES = ['explore', 'craft', 'fight', 'animals'];
const WALK_TERRAIN = new Set('gGdpksmftaboe'.split(''));
const CUT_ACTORS = ['you'];

export interface ValidateOpts {
  scope?: boolean;
  art?: boolean;
}
export interface ValidateResult {
  ok: boolean;
  problems: string[];
  stats: Record<string, number | string>;
  info: string[];
}

const asArray = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

/** Every Effects object in the content, with where it was found. */
function collectEffects(c: Content): { where: string; fx: Effects }[] {
  const out: { where: string; fx: Effects }[] = [];
  const lines = (where: string, ls: Line[] | undefined) => {
    for (const l of ls ?? [])
      if (typeof l !== 'string')
        for (const ch of l.choices ?? []) {
          if (ch.fx) out.push({ where, fx: ch.fx });
          lines(where, ch.then);
        }
  };
  for (const q of Object.values(c.quests)) {
    if (q.rewards) out.push({ where: `quest ${q.id} rewards`, fx: q.rewards });
    if (q.onStart) out.push({ where: `quest ${q.id} start`, fx: q.onStart });
    for (const k of ['open', 'close', 'openAlt', 'closeAlt'] as const) lines(`quest ${q.id}`, q[k]);
    q.steps.forEach((s, i) => {
      const w = `quest ${q.id} step ${i}`;
      if (s.fx) out.push({ where: w, fx: s.fx });
      lines(w, s.say);
      lines(w, s.sayAlt);
    });
  }
  for (const cs of Object.values(c.cutscenes))
    for (const a of cs.acts) if (a.fx) out.push({ where: `cutscene ${cs.id}`, fx: a.fx });
  return out;
}

function condQuests(cond: Cond | undefined): string[] {
  if (!cond) return [];
  const out = [...asArray(cond.done)];
  if (cond.active) out.push(cond.active);
  if (cond.atStep) out.push(cond.atStep[0]);
  for (const a of cond.any ?? []) out.push(...condQuests(a));
  if (cond.not) out.push(...condQuests(cond.not));
  return out;
}
function condHeroes(cond: Cond | undefined): string[] {
  if (!cond) return [];
  const out = [cond.hero, cond.notHero].filter((x): x is string => !!x);
  for (const a of cond.any ?? []) out.push(...condHeroes(a));
  if (cond.not) out.push(...condHeroes(cond.not));
  return out;
}
function condItems(cond: Cond | undefined): string[] {
  if (!cond) return [];
  const out = Object.keys(cond.has ?? {});
  for (const a of cond.any ?? []) out.push(...condItems(a));
  if (cond.not) out.push(...condItems(cond.not));
  return out;
}

function parseLoot(d: string | undefined): string[] {
  if (!d) return [];
  return d
    .split(',')
    .map((p) => p.split(':')[0]!.trim())
    .filter(Boolean);
}

/** Clips each role needs, per facing (docs/BUILD_PLAN.md section 5). */
export const ROLE_CLIPS: Record<Role, Record<string, string[]>> = {
  hero: {
    down: ['idle', 'walk', 'talk', 'swing', 'hurt', 'cheer', 'sleep'],
    side: ['idle', 'walk', 'talk', 'swing', 'hurt', 'fish'],
    up: ['idle', 'walk', 'swing'],
  },
  walker: { down: ['idle', 'walk', 'talk', 'wave'], side: ['idle', 'walk', 'talk'], up: ['idle', 'walk'] },
  fixed: { down: ['idle', 'talk', 'wave'] },
  speakingMob: { down: ['idle', 'walk', 'talk'], side: ['idle', 'walk', 'talk'], up: ['idle', 'walk'] },
  hostile: {
    down: ['idle', 'walk', 'attack', 'hurt'],
    side: ['idle', 'walk', 'attack', 'hurt'],
    up: ['idle', 'walk', 'attack', 'hurt'],
  },
  animal: { down: ['idle', 'walk', 'hop'], side: ['idle', 'walk', 'hop'], up: ['idle', 'walk', 'hop'] },
  boss: { down: ['idle', 'walk', 'attack', 'dizzy', 'calm'], side: ['idle', 'walk', 'attack', 'dizzy', 'calm'] },
};
/**
 * Clips a role lists that the code never plays for one character (checked against src/core): the validator does not
 * ask for them. The Creeper King never walks (bosses.ts king), the Spider Jockey runs off instead of calming down,
 * and Bullseye is a horse whose lines are all narration.
 */
const NOT_PLAYED: Record<string, string[]> = {
  creeper_king: ['walk'],
  spider_jockey: ['calm'],
  bullseye: ['talk', 'wave'],
};
/** Clips the code plays beyond the role's list: the spider hops at her (mobs.ts aiHopper). */
const EXTRA_CLIPS: Record<string, string[]> = { spider: ['hop'] };
/** Idle and walk must face the way she sees them go; any other clip may use the puppet's fallback (down, then side). */
const OWN_FACING = new Set(['idle', 'walk']);
const CHAR_ALIAS: Record<string, string> = {
  mini_creeper: 'creeper',
  villager_1: 'villager_a',
  villager_3: 'villager_a',
  trader: 'villager_a',
  villager_2: 'villager_b',
  villager_trader: 'villager_b',
};

export function validate(c: Content = realContent, opts: ValidateOpts = {}): ValidateResult {
  const problems: string[] = [];
  const info: string[] = [];
  const bad = (cat: string, msg: string) => problems.push(`${cat}: ${msg}`);

  const places = new Set<string>();
  for (const a of Object.values(c.areas)) for (const p of Object.keys(a.places)) places.add(p);
  const sites = new Set<string>();
  const zones = new Set<string>();
  const objIds = new Set<string>();
  for (const a of Object.values(c.areas)) for (const o of a.objects) objIds.add(o.id);
  for (const a of Object.values(c.areas)) {
    for (const s of a.sites) sites.add(s.id);
    for (const z of a.zones) zones.add(z.id);
  }
  const isItem = (id: string) => !!c.items[id];
  const isChar = (id: string) => !!c.chars[id];
  const isPlace = (id: string) => places.has(id);
  const checkItem = (where: string, id: string) => {
    if (!isItem(id)) bad('ref', `${where}: unknown item "${id}"`);
  };
  const checkPlace = (where: string, id: string | undefined) => {
    if (id !== undefined && !isPlace(id)) bad('ref', `${where}: unknown place "${id}"`);
  };
  const checkChar = (where: string, id: string | undefined) => {
    if (id !== undefined && !isChar(id)) bad('ref', `${where}: unknown character "${id}"`);
  };
  const checkCond = (where: string, cond: Cond | undefined) => {
    for (const q of condQuests(cond)) if (!c.quests[q]) bad('ref', `${where}: condition names unknown quest "${q}"`);
    for (const h of condHeroes(cond)) if (!c.heroes[h]) bad('ref', `${where}: condition names unknown hero "${h}"`);
    for (const i of condItems(cond)) checkItem(where, i);
  };

  // ---------------------------------------------------------------- 1. references
  for (const r of Object.values(c.recipes)) {
    checkItem(`recipe ${r.id} output`, r.out);
    for (const i of Object.keys(r.in)) checkItem(`recipe ${r.id} input`, i);
  }
  for (const t of Object.values(c.objects)) {
    for (const y of t.node?.yield ?? []) checkItem(`object ${t.id} yield`, y.item);
  }
  for (const m of Object.values(c.mobs)) for (const y of m.drops) checkItem(`mob ${m.id} drop`, y.item);
  for (const a of Object.values(c.animals)) {
    checkItem(`animal ${a.id} food`, a.food);
    if (a.gives) {
      checkItem(`animal ${a.id} gift`, a.gives.item);
      if (a.gives.needs) checkItem(`animal ${a.id} gift needs`, a.gives.needs);
    }
  }
  for (const f of Object.values(c.fish)) checkItem(`fish ${f.id}`, f.id);
  for (const it of Object.values(c.items)) {
    if (it.grows) {
      checkItem(`seed ${it.id} crop`, it.grows.crop);
    }
  }
  for (const s of Object.values(c.stalls)) {
    checkChar(`stall ${s.id} keeper`, s.keeper);
    for (const row of s.sells) {
      checkItem(`stall ${s.id} row`, row.item);
      if (row.recipe && !c.recipes[row.recipe]) bad('ref', `stall ${s.id} row: unknown recipe "${row.recipe}"`);
      checkCond(`stall ${s.id} row`, row.if);
    }
  }
  for (const l of Object.values(c.letters)) {
    if (l.from !== 'personal') checkChar(`letter ${l.id} from`, l.from);
    for (const i of Object.keys(l.gift ?? {})) checkItem(`letter ${l.id} gift`, i);
  }
  for (const { where, fx } of collectEffects(c)) {
    for (const i of Object.keys(fx.give ?? {})) checkItem(`${where} give`, i);
    for (const i of Object.keys(fx.take ?? {})) checkItem(`${where} take`, i);
    for (const r of fx.recipes ?? []) if (!c.recipes[r]) bad('ref', `${where}: unknown recipe "${r}"`);
    for (const s of fx.stickers ?? []) if (!c.stickers[s]) bad('ref', `${where}: unknown sticker "${s}"`);
    for (const m of fx.mail ?? []) if (!c.letters[m]) bad('ref', `${where}: unknown letter "${m}"`);
    if (fx.hero && !c.heroes[fx.hero]) bad('ref', `${where}: unknown hero "${fx.hero}"`);
    if (fx.cut && !c.cutscenes[fx.cut]) bad('ref', `${where}: unknown cutscene "${fx.cut}"`);
    if (fx.start && !c.quests[fx.start]) bad('ref', `${where}: unknown quest to start "${fx.start}"`);
    for (const sp of fx.spawn ?? []) {
      if (!c.mobs[sp.mob]) bad('ref', `${where}: spawn of unknown mob "${sp.mob}"`);
      checkPlace(`${where} spawn`, sp.at);
    }
  }
  for (const q of Object.values(c.quests)) {
    const w = `quest ${q.id}`;
    checkChar(`${w} giver`, q.giver);
    if (!c.regions[q.region]) bad('ref', `${w}: unknown region "${q.region}"`);
    checkCond(w, q.requires);
    q.steps.forEach((s, i) => {
      const sw = `${w} step ${i}`;
      checkPlace(`${sw} mark`, s.mark);
      for (const d of s.drop ?? []) {
        checkItem(`${sw} drop`, d.item);
        checkPlace(`${sw} drop`, d.at);
      }
      switch (s.t) {
        case 'talk':
          checkChar(sw, s.who);
          break;
        case 'deliver':
          checkChar(sw, s.to);
          checkItem(sw, s.item);
          break;
        case 'fetch':
        case 'craft':
        case 'place':
          checkItem(sw, s.item);
          break;
        case 'site':
          if (!sites.has(s.site)) bad('ref', `${sw}: unknown site "${s.site}"`);
          break;
        case 'defeat':
          if (s.mob !== 'any' && !c.mobs[s.mob]) bad('ref', `${sw}: unknown mob "${s.mob}"`);
          if (s.zone && !zones.has(s.zone)) bad('ref', `${sw}: unknown zone "${s.zone}"`);
          break;
        case 'reach':
        case 'night':
          checkPlace(sw, s.place);
          if (s.t === 'reach')
            for (const id of s.clear ?? [])
              if (!objIds.has(id)) bad('ref', `${sw}: clear names unknown map object "${id}"`);
          break;
        case 'fish':
          if (s.kind && !c.fish[s.kind]) bad('ref', `${sw}: unknown fish "${s.kind}"`);
          break;
        case 'grow':
          checkItem(sw, s.crop);
          break;
        case 'lead':
          if (!c.animals[s.animal]) bad('ref', `${sw}: unknown animal "${s.animal}"`);
          checkPlace(`${sw} pen`, s.pen);
          break;
        case 'mini':
          if (!MINIS[s.game]) bad('ref', `${sw}: unknown mini-game "${s.game}"`);
          break;
      }
    });
  }
  for (const cs of Object.values(c.cutscenes))
    for (const a of cs.acts) {
      checkPlace(`cutscene ${cs.id}`, a.at);
      if (a.who && !CUT_ACTORS.includes(a.who) && !c.chars[a.who] && !c.mobs[a.who] && !c.animals[a.who])
        bad('ref', `cutscene ${cs.id}: unknown actor "${a.who}"`);
    }
  for (const ch of Object.values(c.chars)) {
    ch.spots.forEach((sp, i) => {
      checkPlace(`char ${ch.id} spot ${i}`, sp.at);
      checkCond(`char ${ch.id} spot ${i}`, sp.if);
    });
    if (ch.standIn) checkChar(`char ${ch.id} standIn`, ch.standIn);
  }
  for (const r of Object.values(c.regions))
    if (r.sign && !isPlace(`sign_${r.sign}`)) bad('ref', `region ${r.id}: no place "sign_${r.sign}"`);
  for (const id of Object.keys(c.heroes)) checkChar(`hero ${id}`, id);
  for (const a of Object.values(c.areas)) {
    for (const d of a.doors) {
      const w = `area ${a.id} door (${d.x},${d.y})`;
      const to = c.areas[d.to];
      if (!to) {
        bad('ref', `${w}: unknown target area "${d.to}"`);
        continue;
      }
      const ch = d.ty >= 0 && d.ty < to.h && d.tx >= 0 && d.tx < to.w ? to.terrain[d.ty]!.charAt(d.tx) : 'v';
      if (!WALK_TERRAIN.has(ch)) bad('ref', `${w}: target tile (${d.tx},${d.ty}) in ${d.to} is not walkable ("${ch}")`);
      if (d.hint && !c.strings[d.hint]) bad('ref', `${w}: hint "${d.hint}" is not a string`);
      checkCond(w, d.if);
    }
    for (const b of a.barriers) {
      if (!b.hint || !c.strings[b.hint]) bad('ref', `area ${a.id} barrier ${b.id}: hint "${b.hint}" is not a string`);
    }
    for (const z of a.zones) for (const m of z.mobs) if (!c.mobs[m]) bad('ref', `zone ${z.id}: unknown mob "${m}"`);
    for (const s of a.sites) for (const i of Object.keys(s.needs)) checkItem(`site ${s.id} needs`, i);
    for (const o of a.objects) {
      const t = c.objects[o.type];
      if (!t) {
        bad('ref', `area ${a.id} object ${o.id}: unknown type "${o.type}"`);
        continue;
      }
      checkCond(`object ${o.id}`, o.if);
      if (t.interact === 'stall' && o.d && !c.stalls[o.d]) bad('ref', `object ${o.id}: unknown stall "${o.d}"`);
    }
  }

  // package 72: from every room a way of doors leads back out to the island (never a room she cannot leave)
  for (const a of Object.values(c.areas)) {
    if (!a.indoor) continue;
    const seen = new Set([a.id]);
    const todo = [a.id];
    while (todo.length)
      for (const d of c.areas[todo.pop()!]?.doors ?? []) if (!seen.has(d.to)) seen.add(d.to) && todo.push(d.to);
    if (!seen.has('island')) bad('ref', `area ${a.id}: no door leads back out to the island`);
  }

  // a find is marked taken by its id, so one id on two maps empties both (package 51b)
  const findAreas = new Map<string, string[]>();
  for (const a of Object.values(c.areas))
    for (const o of a.objects)
      if (['chest', 'dig_spot', 'pickup'].includes(o.type)) findAreas.set(o.id, [...(findAreas.get(o.id) ?? []), a.id]);
  for (const [id, areas] of findAreas)
    if (areas.length > 1) bad('ref', `find "${id}" is used more than once (${areas.join(', ')}); give each its own id`);

  // flags that something can set (for barriers)
  const flagSetters = new Set<string>();
  for (const a of Object.values(c.areas)) for (const s of a.sites) flagSetters.add(s.flag);
  for (const { fx } of collectEffects(c)) for (const f of fx.flags ?? []) flagSetters.add(f);
  for (const a of Object.values(c.areas))
    for (const o of a.objects)
      for (const id of parseLoot(o.d)) if (id.startsWith('flag.')) flagSetters.add(id.slice(5));
  flagSetters.add('hall_open'); // set by the socket stone in src/core/hero.ts
  // package 41 (src/core/island.ts): a paid house site ('house<n>_paid') is built overnight and sets 'house<n>';
  // a cleared den sets 'den_<id>'
  for (const a of Object.values(c.areas))
    for (const st of a.sites) {
      const m = /^house(\d)_paid$/.exec(st.flag);
      if (m) flagSetters.add('house' + m[1]);
    }
  for (const id in c.dens) flagSetters.add('den_' + id);
  for (const a of Object.values(c.areas))
    for (const b of a.barriers)
      if (!flagSetters.has(b.flag)) bad('ref', `area ${a.id} barrier ${b.id}: nothing sets flag "${b.flag}"`);

  // ---------------------------------------------------------------- 2. item sources
  const placedTypes = new Set<string>();
  for (const a of Object.values(c.areas)) for (const o of a.objects) placedTypes.add(o.type);
  const usedMobs = new Set<string>();
  for (const a of Object.values(c.areas)) for (const z of a.zones) for (const m of z.mobs) usedMobs.add(m);
  for (const { fx } of collectEffects(c)) for (const sp of fx.spawn ?? []) usedMobs.add(sp.mob);
  for (const cs of Object.values(c.cutscenes)) void cs;

  const direct = new Set<string>();
  const why = (id: string) => direct.add(id);
  // Sources that are rules, not data: sand is dug on the beach with the spade, shards come from the story's shard
  // effects, soil is made by planting, the party photo by the finale, snowballs from snow piles in the Christmas layer.
  for (const id of ['sand', 'shard', 'farmland', 'photo_frame', 'snowball']) why(id);
  for (const t of Object.values(c.objects)) if (placedTypes.has(t.id)) for (const y of t.node?.yield ?? []) why(y.item);
  for (const m of Object.values(c.mobs)) if (usedMobs.has(m.id)) for (const y of m.drops) why(y.item);
  for (const { fx } of collectEffects(c)) for (const i of Object.keys(fx.give ?? {})) why(i);
  for (const q of Object.values(c.quests)) for (const s of q.steps) for (const d of s.drop ?? []) why(d.item);
  for (const l of Object.values(c.letters)) for (const i of Object.keys(l.gift ?? {})) why(i);
  for (const s of Object.values(c.stalls)) for (const r of s.sells) why(r.item);
  for (const f of Object.keys(c.fish)) why(f);
  for (const a of Object.values(c.animals)) if (a.gives) why(a.gives.item);
  for (const i of CLAW_PRIZES) why(i);
  for (const a of Object.values(c.areas))
    for (const o of a.objects) {
      const t = c.objects[o.type];
      if (t && ['chest', 'dig', 'present', 'pickup'].includes(t.interact ?? ''))
        for (const id of parseLoot(o.d))
          if (!id.startsWith('sticker.') && !id.startsWith('flag.') && id !== 'emerald') why(id);
    }
  for (const k of Object.keys(c.strings))
    if (k.startsWith('present:'))
      for (const id of parseLoot(c.strings[k]))
        if (!id.startsWith('sticker.') && !id.startsWith('flag.') && id !== 'emerald') why(id);
  // crops from seeds with a source (repeat until stable)
  for (let again = true; again; ) {
    again = false;
    for (const it of Object.values(c.items))
      if (it.grows && direct.has(it.id) && !direct.has(it.grows.crop)) {
        why(it.grows.crop);
        again = true;
      }
  }
  const hasSource = new Set(direct);
  for (const r of Object.values(c.recipes)) hasSource.add(r.out);
  for (const id of Object.keys(c.items)) if (!hasSource.has(id)) bad('source', `item "${id}" has no source`);

  // ---------------------------------------------------------------- 3. recipes can be made
  const obtainable = new Set(direct);
  for (let again = true; again; ) {
    again = false;
    for (const r of Object.values(c.recipes))
      if (!obtainable.has(r.out) && Object.keys(r.in).every((i) => obtainable.has(i))) {
        obtainable.add(r.out);
        again = true;
      }
  }
  const taught = new Set<string>();
  for (const { fx } of collectEffects(c)) for (const r of fx.recipes ?? []) taught.add(r);
  for (const s of Object.values(c.stalls)) for (const r of s.sells) if (r.recipe) taught.add(r.recipe);
  for (const r of Object.values(c.recipes)) {
    const missing = Object.keys(r.in).filter((i) => !obtainable.has(i));
    if (missing.length) bad('recipe', `"${r.id}" cannot be made: inputs without a way in: ${missing.join(', ')}`);
    if (!r.start && !taught.has(r.id)) bad('recipe', `"${r.id}" is never taught (no start flag, quest or stall row)`);
  }

  // ---------------------------------------------------------------- 4. quests
  const hasSpot = (id: string) => (c.chars[id]?.spots.length ?? 0) > 0;
  const playable = (id: string) => !!c.heroes[id];
  const qids = Object.keys(c.quests);
  for (const q of Object.values(c.quests)) {
    const w = `quest ${q.id}`;
    if (c.quests[q.id] !== q) bad('quest', `${w}: id not unique`);
    if (!q.visible?.trim()) bad('quest', `${w}: empty "visible"`);
    q.steps.forEach((s: Step, i) => {
      if (!STEP_TYPES.includes(s.t)) bad('quest', `${w} step ${i}: unknown step type "${s.t}"`);
    });
    if (!hasSpot(q.giver)) bad('quest', `${w}: giver "${q.giver}" has no spot`);
    if (q.kind === 'main' && playable(q.giver)) bad('quest', `${w}: main quest given by playable "${q.giver}"`);
    if ((q.kind === 'side' || q.kind === 'friend') && playable(q.giver)) {
      if (q.open && !q.openAlt) bad('quest', `${w}: playable giver but no openAlt`);
      if (q.close && !q.closeAlt) bad('quest', `${w}: playable giver but no closeAlt`);
    }
    q.steps.forEach((s, i) => {
      if (s.t !== 'talk' && s.t !== 'deliver') return;
      const who = s.t === 'talk' ? s.who : s.to;
      if (!hasSpot(who)) bad('quest', `${w} step ${i}: "${who}" has no spot`);
      if (playable(who) && !s.sayAlt) bad('quest', `${w} step ${i}: names playable "${who}" without sayAlt`);
    });
    if (q.kind === 'side' && !q.steps.some((s) => s.t !== 'fetch' && s.t !== 'deliver'))
      bad('quest', `${w}: side quest is only fetching`);
  }
  // hard requirements (every listed quest must be done) form the graph for cycles
  const hard = (cond: Cond | undefined): string[] =>
    cond
      ? [...asArray(cond.done), ...(cond.active ? [cond.active] : []), ...(cond.atStep ? [cond.atStep[0]] : [])]
      : [];
  const state: Record<string, number> = {};
  const cyc = new Set<string>();
  const dfs = (id: string, path: string[]) => {
    if (!c.quests[id]) return;
    if (state[id] === 2) return;
    if (state[id] === 1) {
      const loop = [...path.slice(path.indexOf(id)), id];
      const key = [...loop].sort().join(',');
      if (!cyc.has(key)) {
        cyc.add(key);
        bad('quest', `circular requirement: ${loop.join(' > ')}`);
      }
      return;
    }
    state[id] = 1;
    for (const r of hard(c.quests[id]!.requires)) dfs(r, [...path, id]);
    state[id] = 2;
  };
  for (const id of qids) dfs(id, []);
  const reach = new Set<string>();
  const condOk = (cond: Cond | undefined): boolean => {
    if (!cond) return true;
    if (asArray(cond.done).some((d) => !reach.has(d))) return false;
    if (cond.active && !reach.has(cond.active)) return false;
    if (cond.atStep && !reach.has(cond.atStep[0])) return false;
    if (cond.any && !cond.any.some(condOk)) return false;
    return true;
  };
  for (let again = true; again; ) {
    again = false;
    for (const q of Object.values(c.quests))
      if (!reach.has(q.id) && (q.auto || condOk(q.requires))) {
        reach.add(q.id);
        again = true;
      }
  }
  for (const id of qids)
    if (!reach.has(id)) bad('quest', `"${id}" is unreachable (its requirement chain never bottoms out)`);

  // ---------------------------------------------------------------- 5. stand-ins
  for (const id of Object.keys(c.heroes)) {
    const ch = c.chars[id];
    if (!ch) continue;
    if (!ch.standIn) {
      bad('standin', `hero "${id}" has no standIn`);
      continue;
    }
    if (ch.standIn === id) bad('standin', `hero "${id}" stands in for itself`);
    else if (!c.chars[ch.standIn]) bad('standin', `hero "${id}": stand-in "${ch.standIn}" does not exist`);
    else if (!hasSpot(ch.standIn)) bad('standin', `hero "${id}": stand-in "${ch.standIn}" has no spot`);
  }

  // ---------------------------------------------------------------- 6. scope
  const scope = scopeJson as {
    sideQuestsMin: number;
    familyQuestsMin: number;
    perExtraGroupMin: number;
    perStyleMin: number;
    perRegionMin: number;
    friendLines: number;
    cuts: string[];
  };
  const side = Object.values(c.quests).filter((q) => q.kind === 'side');
  const tally = (list: QuestDef[], key: (q: QuestDef) => string | undefined) => {
    const m: Record<string, number> = {};
    for (const q of list) {
      const k = key(q);
      if (k) m[k] = (m[k] ?? 0) + 1;
    }
    return m;
  };
  const byGroup = tally(side, (q) => q.group);
  const byStyle = tally(side, (q) => q.style);
  const byRegion = tally(side, (q) => q.region);
  const lines: Record<string, number> = {};
  for (const q of Object.values(c.quests))
    if (q.kind === 'friend') {
      const h = q.rewards?.hero ?? q.steps.map((s) => s.fx?.hero).find(Boolean);
      const k = h ?? '(no hero)';
      lines[k] = (lines[k] ?? 0) + 1;
    }
  const scopeRows: [string, number, number][] = [
    ['side quests', side.length, scope.sideQuestsMin],
    ['family quests', byGroup.family ?? 0, scope.familyQuestsMin],
  ];
  for (const g of EXTRA_GROUPS) scopeRows.push([`group ${g}`, byGroup[g] ?? 0, scope.perExtraGroupMin]);
  for (const s of STYLES) scopeRows.push([`style ${s}`, byStyle[s] ?? 0, scope.perStyleMin]);
  for (const r of Object.values(c.regions))
    if (r.sign) scopeRows.push([`region ${r.id}`, byRegion[r.id] ?? 0, scope.perRegionMin]);
  scopeRows.push(['friend lines', Object.keys(lines).filter((k) => k !== '(no hero)').length, scope.friendLines]);
  info.push('scope                      have  need');
  for (const [name, have, need] of scopeRows) {
    info.push(
      `${name.padEnd(24)} ${String(have).padStart(6)} ${String(need).padStart(5)}${have < need ? '  SHORT' : ''}`,
    );
    if (opts.scope && have < need) bad('scope', `${name}: ${have} of ${need}`);
  }
  if (lines['(no hero)']) bad('quest', `${lines['(no hero)']} friend quest(s) unlock no hero`);
  if (scope.cuts.length) info.push(`cuts recorded: ${scope.cuts.join(', ')}`);

  // ---------------------------------------------------------------- 7. art
  if (opts.art) {
    const atlasFile = join(ROOT, 'public/assets/atlas/index.json');
    const charsFile = join(ROOT, 'public/assets/chars/index.json');
    const motionFile = join(ROOT, 'art/qa/motion.json');
    const atlas = existsSync(atlasFile)
      ? (JSON.parse(readFileSync(atlasFile, 'utf8')) as { frames?: Record<string, Record<string, unknown>> })
      : null;
    const chars = existsSync(charsFile)
      ? (JSON.parse(readFileSync(charsFile, 'utf8')) as {
          sets?: Record<string, { clips?: Record<string, Record<string, string[]>> }>;
        })
      : null;
    const motion = existsSync(motionFile)
      ? (JSON.parse(readFileSync(motionFile, 'utf8')) as { results?: Record<string, Record<string, { ok: boolean }>> })
      : null;
    if (!atlas) bad('art', 'public/assets/atlas/index.json is missing');
    else {
      const items = atlas.frames?.items ?? {};
      const objs = atlas.frames?.objects ?? {};
      for (const id of Object.keys(c.items)) if (!items[id]) bad('art', `item "${id}" has no atlas frame`);
      const seen = new Set<string>();
      // drawn by the view itself (src/game/world/things.ts), so there is no picture to pack
      const drawnInCode = new Set(['lantern_string']);
      for (const t of Object.values(c.objects)) {
        const art = t.art ?? t.id;
        // package 72: a stand-in may show an item picture, as a placed thing does (src/game/assets.ts worldFrame),
        // but never as a flat piece the ground bake would have to paint (the bake reads only object pictures)
        const itemPic = !objs[art] && !!items[art];
        if (itemPic && t.flat && !t.interact && !t.node)
          bad('art', `object "${t.id}": a flat piece needs an object picture`);
        if (!seen.has(art) && !objs[art] && !itemPic && !drawnInCode.has(t.id))
          bad('art', `object "${t.id}": no atlas frame "${art}"`);
        seen.add(art);
      }
      // barrier art, as src/game/world/things.ts draws it ('water' is the water in the ground)
      for (const area of Object.values(c.areas))
        for (const b of area.barriers) {
          const want =
            b.art === 'broken_bridge'
              ? [`bridge_${b.id}`]
              : b.art === 'wall'
                ? ['wall_boards', 'building_props']
                : !b.art || b.art === 'water'
                  ? []
                  : [b.art];
          for (const f of want) if (!objs[f]) bad('art', `barrier "${b.id}" (${b.art}): no atlas frame "${f}"`);
        }
    }
    if (!chars) bad('art', 'public/assets/chars/index.json is missing');
    else {
      const need: Record<string, Role> = {};
      for (const ch of Object.values(c.chars)) need[CHAR_ALIAS[ch.id] ?? ch.id] = ch.role;
      for (const m of Object.values(c.mobs)) need[CHAR_ALIAS[m.id] ?? m.id] = m.role;
      for (const a of Object.values(c.animals)) need[a.id] = 'animal';
      // looks drawn facing front only (their other views were refused by the image tool): they walk facing the camera
      const frontOnly = new Set(artCast.filter((x) => x.frontOnly).map((x) => x.id));
      const waived = existsSync(join(ROOT, 'art/qa/motion-ok.json'))
        ? (JSON.parse(readFileSync(join(ROOT, 'art/qa/motion-ok.json'), 'utf8')) as Record<
            string,
            Record<string, string>
          >)
        : {};
      for (const [id, role] of Object.entries(need)) {
        const set = chars.sets?.[id];
        if (!set) {
          bad('art', `no character set "${id}" (${role})`);
          continue;
        }
        const skip = NOT_PLAYED[id] ?? [];
        const wants: [string, string[]][] = Object.entries(ROLE_CLIPS[role]).map(([f, cl]) => [
          f,
          [...cl, ...(EXTRA_CLIPS[id] ?? [])],
        ]);
        for (const [facing, clips] of wants)
          for (const clip of clips) {
            if (skip.includes(clip)) continue;
            const by = set.clips?.[clip];
            let used = by?.[facing]?.length ? facing : '';
            if (!used && (!OWN_FACING.has(clip) || frontOnly.has(id)))
              used = by?.down?.length ? 'down' : by?.side?.length ? 'side' : '';
            if (!used) {
              bad('art', `${id}: missing ${clip} ${facing}`);
              continue;
            }
            const frames = by![used]!;
            if (frames.length < 2) continue;
            const key = `${clip}_${used}`;
            const m = motion?.results?.[id]?.[key];
            if (!m) bad('art', `${id}: ${clip} ${used} not in the motion check`);
            else if (!m.ok && !waived[id]?.[key]) bad('art', `${id}: ${clip} ${used} fails the motion check`);
          }
      }
      if (!motion) bad('art', 'art/qa/motion.json is missing');
      // talk portraits (tools/art/portraits.ts): every frame on its page, as many idle and talk frames as the world set
      const portraitsFile = join(ROOT, 'public/assets/portraits/index.json');
      const portraits = existsSync(portraitsFile)
        ? (JSON.parse(readFileSync(portraitsFile, 'utf8')) as {
            sets: Record<string, { page: string; clips: Record<string, Record<string, string[]>> }>;
          })
        : { sets: {} };
      for (const [id, p] of Object.entries(portraits.sets)) {
        const pageFile = join(ROOT, 'public/assets/portraits', `${p.page}.json`);
        const frames = existsSync(pageFile)
          ? (JSON.parse(readFileSync(pageFile, 'utf8')) as { frames: Record<string, unknown> }).frames
          : null;
        if (!frames) bad('art', `portrait "${id}": no page ${p.page}`);
        for (const clip of ['idle', 'talk']) {
          const list = p.clips[clip]?.down ?? [];
          if (list.length !== (chars.sets?.[id]?.clips?.[clip]?.down?.length ?? 0))
            bad('art', `portrait "${id}": ${clip} has ${list.length} frames, the world set a different number`);
          for (const f of list) if (frames && !frames[f]) bad('art', `portrait "${id}": frame ${f} not on its page`);
        }
      }
    }
  }

  const stats: Record<string, number | string> = {
    items: Object.keys(c.items).length,
    recipes: Object.keys(c.recipes).length,
    quests: qids.length,
    sideQuests: side.length,
    familyQuests: byGroup.family ?? 0,
    friendLines: Object.keys(lines).length,
    chars: Object.keys(c.chars).length,
    problems: problems.length,
  };
  return { ok: problems.length === 0, problems, stats, info };
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const r = validate(realContent, { scope: argv.includes('--scope'), art: argv.includes('--art') });
  console.log(r.info.join('\n'));
  console.log(
    Object.entries(r.stats)
      .map(([k, v]) => `${k}=${v}`)
      .join('  '),
  );
  if (r.problems.length) {
    const rows = r.problems.map((p) => {
      const i = p.indexOf(': ');
      return [p.slice(0, i), p.slice(i + 2)] as const;
    });
    console.log('\ncategory  problem');
    for (const [cat, msg] of rows.slice(0, 300)) console.log(`${cat.padEnd(9)} ${msg}`);
    if (rows.length > 300) console.log(`... and ${rows.length - 300} more`);
    console.log(`\n${r.problems.length} problem(s)`);
    process.exit(1);
  }
  console.log('DATA OK');
}
