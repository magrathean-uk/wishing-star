// What the view needs to know about gear, read from the rules in src/core/gear.ts (package 31): which slot a thing
// goes in, what it does, what an upgrade costs; and the glint drawn on an upgraded item everywhere it shows.
import type Phaser from 'phaser';
import { countWithChests } from '../../core/bag.ts';
import {
  GEAR_SLOTS,
  gearValue,
  plusOf as plusRule,
  shieldMax as shieldRule,
  slotOf as slotRule,
} from '../../core/gear.ts';
import type { Game, GearSlot } from '../../core/types.ts';
import { text } from './kit.ts';

export const SLOTS: readonly GearSlot[] = GEAR_SLOTS;

/** The slot a thing is worn in, or null when it is not gear. */
export function slotOf(g: Game, id: string): GearSlot | null {
  return slotRule(g.c.items[id]);
}

/** What she wears now, slot by slot ('' for nothing). */
export function worn(g: Game): Record<GearSlot, string> {
  const out = { sword: '', bow: '', helmet: '', armour: '' };
  const gear = g.s.gear as Record<GearSlot, string> | undefined;
  if (!gear) return out;
  for (const s of SLOTS) {
    const id = gear[s];
    if (id && (g.s.pouch[id] ?? 0) > 0) out[s] = id;
  }
  return out;
}

/** Every piece of gear she has, in slot order and then by tier. */
export function owned(g: Game): string[] {
  const out: string[] = [];
  for (const id in g.s.pouch) if (g.s.pouch[id]! > 0 && slotOf(g, id)) out.push(id);
  const order = (id: string) => SLOTS.indexOf(slotOf(g, id)!) * 100 + (g.c.items[id]?.tool?.tier ?? 0);
  return out.sort((a, b) => order(a) - order(b));
}

export function plusOf(g: Game, id: string): number {
  return g.s.plus ? plusRule(g, id) : 0;
}

/** Damage of a sword or bow; with `plus` given, what it would do at that upgrade. 0 for anything else. */
export function damageOf(g: Game, id: string, plus?: number): number {
  const s = slotOf(g, id);
  if (s !== 'sword' && s !== 'bow') return 0;
  return gearValue(g, id) - plusOf(g, id) + (plus ?? plusOf(g, id));
}

/** Shield hearts (whole hearts) a piece gives. */
export function shieldOf(g: Game, id: string): number {
  return g.c.items[id]?.shield ?? 0;
}

/** Shield hearts her worn gear gives in all, in half hearts (at most 4 hearts). */
export function shieldMax(g: Game): number {
  return g.s.gear ? shieldRule(g) : 0;
}

/** How many of a thing she has for paying: emeralds from her purse, the rest from her bag, pouch and chests. */
export function have(g: Game, id: string): number {
  return id === 'emerald' ? g.s.emeralds : countWithChests(g, id);
}

/**
 * The glint on an upgraded item: a little star that twinkles at the top right of its picture, and "+1" or "+2" at
 * the bottom right. Returns what it made, for the caller to destroy (or add to a container).
 */
export function glint(
  scene: Phaser.Scene,
  x: number,
  y: number,
  size: number,
  plus: number,
): Phaser.GameObjects.GameObject[] {
  if (plus <= 0) return [];
  const star = scene.add
    .image(x + size * 0.36, y - size * 0.36, 'fx_star')
    .setScrollFactor(0)
    .setTint(0xfff3b0);
  const base = Math.max(0.35, size / 110);
  star.setScale(base);
  scene.tweens.add({
    targets: star,
    scale: { from: base * 0.6, to: base * 1.25 },
    angle: 90,
    alpha: { from: 0.6, to: 1 },
    duration: 700,
    yoyo: true,
    repeat: -1,
    ease: 'Sine.easeInOut',
  });
  const t = text(scene, x + size * 0.5, y + size * 0.5, `+${plus}`, Math.max(18, Math.round(size * 0.32)), '#1c6fd1')
    .setOrigin(1, 1)
    .setStroke('#ffffff', 6);
  return [star, t];
}
