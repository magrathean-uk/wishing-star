// The goal line (package 53a). One rule: it shows the current step of the quest she is on (`s.tracked`, kept by
// `engage` and `startQuest` in quests.ts); while she fights a den she chose, it shows the den. The view hides it while
// a talk, a scene or a card has the screen, so it moves on only once the step's talk has closed.
//
// Package 60: while the place the step needs is off the screen (or in another area), the line says the going first
// ("Cross the creek", from the step's `far` line, or "Go to <the place>" made from the place's name), and the doing
// once she is there. The counter names what it counts ("Logs 3 of 4") and goes when it is full, so the line moves on
// to the next thing by itself. When there is no way there today, a closed barrier's own line says what is missing.
import { count } from './cond.ts';
import { upgradeShort } from './gear.ts';
import { guideOf } from './guide.ts';
import { findSite, objective, progress, stepTarget } from './quests.ts';
import { goalRecipe, missing } from './source.ts';
import { cast, charName, fill } from './talk.ts';
import type { Game, Step } from './types.ts';

export interface Goal {
  /** the quest it belongs to ('' for a den) */
  qid: string;
  text: string;
  /** what it counts, "Logs 3 of 4", or '' (also '' once it is full) */
  num: string;
  /** the line says the going (the place is off the screen) */
  far: boolean;
  /** the current step (undefined: back to the giver, or a den) */
  step: Step | undefined;
  den: boolean;
  /** the line says to go into a house (its door is the way): the chip shows the house sign */
  inside: boolean;
}

export function goalLine(g: Game): Goal | null {
  const s = g.s;
  const den = g.rt.den;
  if (den) {
    const text = (g.c.strings.goal_den ?? 'Beat the mobs in the ring').replace('{w}', String(den.wave));
    return { qid: '', text, num: '', step: undefined, den: true, far: false, inside: false };
  }
  const id = s.tracked;
  const q = id ? s.quests[id] : undefined;
  if (!id || !q || q.done) return null;
  const p = progress(g, id);
  const st = g.c.quests[id]?.steps[q.step];
  let text = objective(g, id);
  // Package 57a: a led animal follows when the food is anywhere in her bag (no slot to hold). Without the food the
  // goal says to get it first ("Get wheat seeds for the chicken").
  if (st?.t === 'lead') {
    const food = g.c.animals[st.animal]?.food;
    const fd = food ? g.c.items[food] : undefined;
    if (fd && count(g, food!) === 0)
      text = (g.c.strings.goal_lead_food ?? 'Get {food} for the {animal}')
        .replace('{food}', fd.names ?? fd.name + 's')
        .replace('{animal}', g.c.animals[st.animal]!.name);
  }
  const gd = guideOf(g);
  const tgt = g.rt.target;
  // the going: only for a step whose place is off the screen (a step that is itself a walk says it already)
  let far = false;
  let inside = false;
  // (a fight step's star on an enemy near her is not a place to go to)
  const foe = st?.t === 'defeat' && g.rt.targetUp > 0;
  // (while the counter still has some to get, the getting comes first: "Logs 0 of 4" with the doing)
  let num = counter(g, st, p);
  // package 68: a craft step counts what is still missing ("Sticks 1 of 3"), then says where to make it
  if (st?.t === 'craft') {
    const want = goalRecipe(g);
    if (want) {
      const short = missing(g, want.r, want.times)[0];
      if (short) num = ofWord(g, itemsName(g, short.item), short.have, short.need);
      else if (!/ (at|in) /.test(text))
        text = (g.c.strings.goal_make_at ?? '{goal} at the {at}')
          .replace('{goal}', text)
          .replace('{at}', g.c.strings[`at:${want.r.at}`] ?? want.r.at);
    }
  }
  // issue 65: out of arrows by a high web: what to get first, and the star goes there (quests.ts, stepTarget)
  if (g.rt.restock && st?.t !== 'defeat') {
    const S = g.c.strings;
    const what = g.rt.restock;
    text =
      what === 'make'
        ? (S.goal_arrows_make ?? 'Make arrows at a bench')
        : (S.goal_arrows_get ?? 'Find a {item} for arrows').replace('{item}', g.c.items[what]?.name ?? what);
    num = '';
  }
  // issue 62: a story upgrade counts what it still lacks ("Emeralds 4 of 5")
  if (st?.t === 'upgrade') {
    const worn = s.gear[st.slot];
    const short = worn ? upgradeShort(g, worn) : null;
    if (short) num = ofWord(g, itemsName(g, short.item), short.have, short.need);
  }
  if (tgt && gd.far && !foe && !num && st?.t !== 'reach' && st?.t !== 'night') {
    const going = farLine(g, id, st);
    if (going) {
      text = going;
      far = true;
    }
  }
  // G (22 Nov 2026): the goal is inside a house (or the Mine, a cave, the Hall) and she is outside: the line says to
  // go in ("Go into this house" by its door, else "Go into the Bakery"), and the doing comes back once she is in.
  // (not while she still has things to get first for a craft, an upgrade or a building job)
  const gather = !!num && (st?.t === 'craft' || st?.t === 'upgrade' || st?.t === 'site');
  if (tgt && gd.house && gd.door && !foe && !gather && !g.rt.restock && st?.t !== 'night') {
    text = goInLine(g, gd.door.to, gd.doorNear, st);
    far = true;
    inside = true;
  }
  if (tgt && gd.none && gd.why && g.c.strings[gd.why]) {
    text = fill(g, g.c.strings[gd.why]!);
    far = true;
    inside = false;
  }
  return { qid: id, text, num, step: st, den: false, far, inside };
}

/** The going line for a step: its own `far` line, else "Go to" and the place's name, else '' (none fits). */
export function farLine(g: Game, qid: string, st: Step | undefined): string {
  if (st?.far) return fill(g, st.far);
  const S = g.c.strings;
  // a thing to put in her home, or bed: home is the place
  if (st?.t === 'place' || st?.t === 'sleep') return S.goal_home ?? 'Go home';
  // package 68: a person is found, not a house she cannot go into: "Find Bandit"
  if (st?.t === 'talk' || st?.t === 'deliver' || !st) {
    const def = g.c.quests[qid];
    const who = st?.t === 'talk' ? st.who : st?.t === 'deliver' ? st.to : def?.giver;
    if (who) return (S.goal_find ?? 'Find {who}').replace('{who}', charName(g, cast(g, who)));
  }
  const t = g.rt.target ?? stepTarget(g, qid);
  let name = t?.label ?? '';
  if (!name && st?.t === 'site') name = findSite(g, st.site)?.name ?? '';
  if (!name) return '';
  return (S.goal_far ?? 'Go to {place}').replace('{place}', name);
}

/**
 * The line for a goal inside: "Go into this house" by a house's door, else "Go into" and the place's name ("Go into the
 * Bakery"; a strings entry `in:<area>` names a place whose own name does not fit), else "Go into the house". Home stays
 * "Go home" until she is at its door. The Mine, a cave and the Hall (dark, or a wide door) are named even by the door.
 */
export function goInLine(g: Game, to: string, near: boolean, st?: Step): string {
  const S = g.c.strings;
  const a = g.c.areas[to];
  const doors = (g.c.areas[g.s.area]?.doors ?? []).filter((d) => d.to === to).length;
  if (near && a && !a.dark && doors <= 1) return S[`in_here:${to}`] ?? S.goal_in_here ?? 'Go into this house';
  if (st?.t === 'place' || st?.t === 'sleep') return S.goal_home ?? 'Go home';
  const name = S[`in:${to}`] ?? (a?.name ?? '').replace(/^(The|A|Your) /, (w) => w.toLowerCase());
  return name ? (S.goal_in ?? 'Go into {place}').replace('{place}', name) : (S.goal_in_house ?? 'Go into the house');
}

function itemsName(g: Game, id: string): string {
  const d = g.c.items[id];
  return d ? (d.names ?? d.name + 's') : id;
}
function ofWord(g: Game, noun: string, have: number, need: number): string {
  return have >= need
    ? ''
    : (g.c.strings.goal_count ?? '{what} {have} of {need}')
        .replace('{what}', noun.charAt(0).toUpperCase() + noun.slice(1))
        .replace('{have}', String(have))
        .replace('{need}', String(need));
}

/** "Logs 3 of 4": what the step counts, with its name; '' when it counts nothing or the count is full. */
function counter(g: Game, st: Step | undefined, p: [number, number] | null): string {
  if (!st || !p) return '';
  const S = g.c.strings;
  const of = (noun: string, have: number, need: number) =>
    have >= need
      ? ''
      : (S.goal_count ?? '{what} {have} of {need}')
          .replace('{what}', noun.charAt(0).toUpperCase() + noun.slice(1))
          .replace('{have}', String(have))
          .replace('{need}', String(need));
  const items = (id: string) => {
    const d = g.c.items[id];
    return d ? (d.names ?? d.name + 's') : id;
  };
  switch (st.t) {
    case 'site': {
      // the first thing still short, by name
      const site = findSite(g, st.site);
      if (!site) return '';
      for (const k in site.needs) {
        const have = Math.min(site.needs[k]!, count(g, k));
        if (have < site.needs[k]!) return of(items(k), have, site.needs[k]!);
      }
      return '';
    }
    case 'fetch':
    case 'craft':
    case 'deliver':
      return of(items(st.item), p[0], p[1]);
    case 'grow':
      return of(items(st.crop), p[0], p[1]);
    case 'fish':
      return of(st.kind ? items(st.kind) : (S.goal_fish ?? 'fish'), p[0], p[1]);
    case 'defeat': {
      const m = g.c.mobs[st.mob];
      return of(m ? m.name + 's' : (S.mob_any ?? 'mobs'), p[0], p[1]);
    }
    case 'lead': {
      const a = g.c.animals[st.animal];
      return of(a ? a.name + 's' : st.animal, p[0], p[1]);
    }
    default:
      return `${p[0]} of ${p[1]}`;
  }
}
