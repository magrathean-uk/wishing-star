// Gear (phase 2, part D): four slots she wears, blue shield hearts from armour, and +1 / +2 upgrades for the sword
// and the bow. Plain rules: no Phaser, no DOM, no clock, no Math.random.
import { countWithChests, takeWithChests } from './bag.ts';
import { nudge } from './hero.ts';
import type { Game, GearSlot, GameState, ItemDef } from './types.ts';

export const GEAR_SLOTS: GearSlot[] = ['sword', 'bow', 'helmet', 'armour'];
/** Damage of a sword by tier (wood 1, stone 2, iron 3, diamond 4); an upgrade adds 1 a step. */
export const SWORD_DMG = [0, 1, 2, 3, 4];
export const BOW_DMG = 2;
/** Never more than 4 blue hearts, so a fight still matters (in half hearts). */
export const SHIELD_CAP = 8;
export const PLUS_MAX = 2;
/** What +1 and +2 cost (builder's numbers): ore from her bag or chests, emeralds from her purse. */
export const UPGRADE_COST: { items: Record<string, number>; emeralds: number }[] = [
  { items: { iron_ingot: 2 }, emeralds: 5 },
  { items: { diamond: 1 }, emeralds: 10 },
];
/** Seconds she has to answer "Put it on? Space" before the question goes (an empty slot is then filled anyway). */
export const ASK_SECS = 6;
/** How close she must stand to an anvil or Grandad's workbench to upgrade. */
const NEAR = 2.6;

export function emptyGear(): Record<GearSlot, string> {
  return { sword: '', bow: '', helmet: '', armour: '' };
}

/** The slot an item goes in, or null when it is not gear. */
export function slotOf(d: ItemDef | undefined): GearSlot | null {
  const t = d?.tool?.type;
  return t === 'sword' || t === 'bow' || t === 'helmet' || t === 'armour' ? t : null;
}

export function plusOf(g: Game, id: string): number {
  return g.s.plus[id] ?? 0;
}

/** What a piece is worth in its slot: damage for the sword and bow, shield for armour (with upgrades). */
export function gearValue(g: Game, id: string): number {
  const d = g.c.items[id];
  const slot = slotOf(d);
  if (!d || !slot) return 0;
  if (slot === 'sword') return (SWORD_DMG[d.tool!.tier] ?? 0) + plusOf(g, id);
  if (slot === 'bow') return BOW_DMG + plusOf(g, id);
  // armour of a higher tier is better even where the hearts are the same (iron and leather helmets)
  return (d.shield ?? 0) * 10 + d.tool!.tier;
}

const owns = (g: Game, id: string) => (g.s.pouch[id] ?? 0) > 0;
export function worn(g: Game, slot: GearSlot): string | null {
  const id = g.s.gear[slot];
  return id && owns(g, id) ? id : null;
}

/** Damage of one swing with the sword she wears (0 with none). */
export function swordDmg(g: Game): number {
  const id = worn(g, 'sword');
  return id ? gearValue(g, id) : 0;
}
/** Damage of one arrow from the bow she wears. */
export function bowDmg(g: Game): number {
  const id = worn(g, 'bow');
  return id ? gearValue(g, id) : 0;
}

/** Blue hearts the armour she wears gives, in half hearts, capped at 4 hearts. */
export function shieldMax(g: Game): number {
  let n = 0;
  for (const slot of ['helmet', 'armour'] as const) {
    const id = worn(g, slot);
    if (id) n += (g.c.items[id]!.shield ?? 0) * 2;
  }
  return Math.min(SHIELD_CAP, n);
}

/** Is this piece better than the one she wears in its slot (or the slot is empty)? A tie goes to the higher tier. */
export function better(g: Game, id: string): boolean {
  const slot = slotOf(g.c.items[id]);
  if (!slot) return false;
  const now = worn(g, slot);
  if (!now) return true;
  if (now === id) return false;
  const a = gearValue(g, id);
  const b = gearValue(g, now);
  return a > b || (a === b && g.c.items[id]!.tool!.tier > g.c.items[now]!.tool!.tier);
}

/** Put a piece on. A better shield adds its new hearts at once; swapping cannot refill them. */
export function wear(g: Game, id: string): boolean {
  const d = g.c.items[id];
  const slot = slotOf(d);
  if (!slot || !owns(g, id)) return false;
  const wasAsked = g.rt.ask === id;
  if (wasAsked) g.rt.ask = '';
  g.rt.askQ = g.rt.askQ.filter((q) => q !== id);
  if (g.s.gear[slot] !== id) {
    const before = shieldMax(g);
    g.s.gear[slot] = id;
    const after = shieldMax(g);
    if (after > before) g.s.shield = Math.min(after, g.s.shield + (after - before));
    g.s.shield = Math.min(g.s.shield, after);
    g.ev.push({ t: 'gear', kind: 'worn', item: id, slot });
    g.ev.push({ t: 'sfx', id: 'equip' });
    g.ev.push({ t: 'act', kind: 'wear', id });
  }
  if (wasAsked) nextAsk(g);
  return true;
}

export function unwear(g: Game, slot: GearSlot): boolean {
  if (!g.s.gear[slot]) return false;
  const id = g.s.gear[slot];
  g.s.gear[slot] = '';
  g.s.shield = Math.min(g.s.shield, shieldMax(g));
  g.ev.push({ t: 'gear', kind: 'off', item: id, slot });
  return true;
}

/**
 * New gear came into her pouch. An empty slot, or a piece better than the one she wears, asks once
 * "Put it on? Space" (the view shows it and sends `wear`). The question waits ASK_SECS of play; an empty slot is
 * filled when it runs out, so she never walks into a fight with nothing in her hand.
 */
export function gearArrived(g: Game, id: string): void {
  const slot = slotOf(g.c.items[id]);
  if (!slot || !better(g, id)) return;
  // one question at a time: more gear waits its turn
  if (g.rt.ask && g.rt.ask !== id) {
    if (!g.rt.askQ.includes(id)) g.rt.askQ.push(id);
    return;
  }
  g.rt.ask = id;
  g.rt.askT = ASK_SECS;
  g.ev.push({ t: 'gear', kind: 'ask', item: id, slot });
}

/** The next waiting question, if it is still worth asking. */
function nextAsk(g: Game): void {
  while (g.rt.askQ.length && !g.rt.ask) {
    const id = g.rt.askQ.shift()!;
    if (owns(g, id)) gearArrived(g, id);
  }
}

/** The question ran out (or another took its place): an empty slot takes the piece anyway. */
function settleAsk(g: Game): void {
  const id = g.rt.ask;
  g.rt.ask = '';
  g.rt.askT = 0;
  const slot = slotOf(g.c.items[id]);
  if (slot && !worn(g, slot)) wear(g, id);
  nextAsk(g);
}

/** Once a step of play. */
export function stepGear(g: Game): void {
  if (!g.rt.ask) return;
  g.rt.askT -= 1 / 60;
  if (g.rt.askT <= 0) settleAsk(g);
}

/** A hit lands: the blue hearts take it first. Returns the half hearts left for her red hearts. */
export function shieldTakes(g: Game, dmg: number): number {
  const s = g.s;
  if (s.shield <= 0 || dmg <= 0) return dmg;
  const a = Math.min(s.shield, dmg);
  s.shield -= a;
  g.ev.push({ t: 'gear', kind: 'shieldHurt' });
  return dmg - a;
}

/** Sleep and Mum's hug bring the blue hearts back. Returns true when any came back. */
export function shieldBack(g: Game): boolean {
  const max = shieldMax(g);
  if (g.s.shield >= max) {
    g.s.shield = max;
    return false;
  }
  g.s.shield = max;
  g.ev.push({ t: 'gear', kind: 'shieldBack' });
  return true;
}

// ---------------------------------------------------------------- upgrades

function near(g: Game, x: number, y: number, w: number, h: number): boolean {
  return Math.abs(x + w / 2 - g.s.x) < NEAR && Math.abs(y + h / 2 - g.s.y) < NEAR;
}

/** Is she by an anvil she built, or by Grandad's workbench once he has opened it for upgrades? */
export function upgradeHere(g: Game): boolean {
  const s = g.s;
  for (const p of s.placed)
    if (p.area === s.area && g.c.items[p.item]?.place?.use === 'anvil' && near(g, p.x, p.y, 1, 1)) return true;
  if (!s.flags.upgrades_open) return false;
  const a = g.c.areas[s.area];
  const live = g.rt.live[s.area];
  if (!a || !live) return false;
  for (let i = 0; i < a.objects.length; i++) {
    const o = a.objects[i]!;
    if (!live[i] || !o.id.startsWith('grandad_bench')) continue;
    const t = g.c.objects[o.type]!;
    if (near(g, o.x, o.y, t.w ?? 1, t.h ?? 1)) return true;
  }
  return false;
}

/** Does she own a piece for this slot that is +1 or better? (package 44a: the `upgrade` quest step) */
export function upgradedIn(g: Game, slot: 'sword' | 'bow'): boolean {
  for (const id in g.s.pouch)
    if ((g.s.pouch[id] ?? 0) > 0 && slotOf(g.c.items[id]) === slot && plusOf(g, id) > 0) return true;
  return false;
}

/** What the next upgrade of an item costs, or null when it cannot be upgraded any more (or is not a sword or bow). */
export function upgradeCost(g: Game, id: string): { items: Record<string, number>; emeralds: number } | null {
  const slot = slotOf(g.c.items[id]);
  if (slot !== 'sword' && slot !== 'bow') return null;
  return UPGRADE_COST[plusOf(g, id)] ?? null;
}

/** What an upgrade of this item still lacks first (issue 62): the thing, how many she has and how many it needs. */
export function upgradeShort(g: Game, id: string): { item: string; have: number; need: number } | null {
  const cost = upgradeCost(g, id);
  if (!cost) return null;
  for (const k in cost.items) {
    const have = countWithChests(g, k);
    if (have < cost.items[k]!) return { item: k, have, need: cost.items[k]! };
  }
  if (g.s.emeralds < cost.emeralds) return { item: 'emerald', have: g.s.emeralds, need: cost.emeralds };
  return null;
}

/** Why an upgrade cannot happen now ('' when it can): for the view's menu and for the bots. */
export function upgradeWhy(g: Game, id: string): '' | 'not_gear' | 'max' | 'not_here' | 'not_owned' | 'short' {
  const slot = slotOf(g.c.items[id]);
  if (slot !== 'sword' && slot !== 'bow') return 'not_gear';
  if (!owns(g, id)) return 'not_owned';
  const cost = upgradeCost(g, id);
  if (!cost) return 'max';
  if (!upgradeHere(g)) return 'not_here';
  if (g.s.emeralds < cost.emeralds) return 'short';
  for (const k in cost.items) if (countWithChests(g, k) < cost.items[k]!) return 'short';
  return '';
}

export function upgrade(g: Game, id: string): boolean {
  const why = upgradeWhy(g, id);
  if (why) {
    if (why === 'not_here') nudge(g, 'upgrade_where');
    g.ev.push({ t: 'sfx', id: 'nope' });
    return false;
  }
  const cost = upgradeCost(g, id)!;
  for (const k in cost.items) takeWithChests(g, k, cost.items[k]!);
  g.s.emeralds -= cost.emeralds;
  g.s.plus[id] = plusOf(g, id) + 1;
  g.s.counts.upgraded = (g.s.counts.upgraded ?? 0) + 1;
  g.ev.push({ t: 'gear', kind: 'upgrade', item: id, slot: slotOf(g.c.items[id])! });
  g.ev.push({ t: 'sfx', id: 'upgrade' });
  g.ev.push({ t: 'fx', id: 'craft', x: g.s.x, y: g.s.y, item: id });
  g.ev.push({ t: 'act', kind: 'upgrade', id });
  return true;
}

// ---------------------------------------------------------------- saves

/**
 * Fill the gear record of a save from before the slots: she wears her best sword and her bow, has no upgrades and
 * no blue hearts. Also mends a record that names something she no longer has.
 */
export function fixGear(c: Game['c'], s: GameState): void {
  const raw = s as Partial<GameState>;
  if (!raw.gear || typeof raw.gear !== 'object') {
    s.gear = emptyGear();
    for (const slot of GEAR_SLOTS) {
      let best = '';
      let bestTier = 0;
      for (const id in s.pouch) {
        const d = c.items[id];
        if (slotOf(d) === slot && (s.pouch[id] ?? 0) > 0 && d!.tool!.tier > bestTier) {
          best = id;
          bestTier = d!.tool!.tier;
        }
      }
      s.gear[slot] = best;
    }
  }
  for (const slot of GEAR_SLOTS) {
    const id = s.gear[slot];
    if (typeof id !== 'string' || (id && (slotOf(c.items[id]) !== slot || !(s.pouch[id]! > 0)))) s.gear[slot] = '';
  }
  if (!raw.plus || typeof raw.plus !== 'object') s.plus = {};
  for (const k in s.plus) {
    const n = s.plus[k];
    if (!c.items[k] || typeof n !== 'number') delete s.plus[k];
    else s.plus[k] = Math.max(0, Math.min(PLUS_MAX, Math.floor(n)));
  }
  if (typeof raw.shield !== 'number' || !(raw.shield >= 0)) s.shield = 0;
  let max = 0;
  for (const slot of ['helmet', 'armour'] as const) if (s.gear[slot]) max += (c.items[s.gear[slot]]!.shield ?? 0) * 2;
  s.shield = Math.min(s.shield, Math.min(SHIELD_CAP, max));
}
