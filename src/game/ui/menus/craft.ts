// The recipe list at a crafting table or furnace, read at a glance: four tabs with pictures (Tools, Gear, Home,
// Food), only the recipes she knows. It opens on the thing her quest wants (or the step towards it), listed first
// and glowing. Each ingredient is a picture: a tick when she has enough, else a red number of how many more.
import type Phaser from 'phaser';
import { countWithChests } from '../../../core/bag.ts';
import { count } from '../../../core/cond.ts';
import { hasAll, recipeList } from '../../../core/craft.ts';
import { eatsGoal, goalRecipe, whereFrom } from '../../../core/source.ts';
import { upgradeHere } from '../../../core/gear.ts';
import type { Game, RecipeDef } from '../../../core/types.ts';
import { Sound } from '../../audio.ts';
import type { UI } from '../../scenes/UI.ts';
import { Ask } from '../ask.ts';
import { glint, plusOf, slotOf } from '../gear.ts';
import {
  doneButton,
  GOLD,
  icon,
  INK,
  makeUiTextures,
  onDone,
  panel,
  SOFT,
  stepDone,
  text,
  title,
  type Txt,
  W,
} from '../kit.ts';
import { Menu, within } from '../menu.ts';
import { register } from '../registry.ts';

export const TABS = ['tools', 'gear', 'home', 'food'] as const;
export type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = { tools: 'Tools', gear: 'Gear', home: 'Home', food: 'Food' };
const TAB_ICON: Record<Tab, string> = { tools: 'wood_pick', gear: 'wood_sword', home: 'bed', food: 'bread' };
const EMPTY: Record<Tab, string> = {
  tools: 'No tool recipes yet.',
  gear: 'No gear recipes yet.',
  home: 'No home recipes yet.',
  food: 'No food recipes yet.',
};
const ROWS = 5;
const ROW_H = 100;
const LIST_Y = 300;
/** the top of the Done button, under the list and the where-from line */
const DONE_Y = 900;
const TAB_W = 270;
const TAB_X = W / 2 - (TABS.length * TAB_W) / 2;
/** Things to place that are not furniture or blocks: they still belong to the home. */
const HOME_TOO = new Set(['torch', 'ladder']);

/** Which tab a recipe sits on, from what it makes. */
export function tabOf(g: Game, r: RecipeDef): Tab {
  const d = g.c.items[r.out];
  if (!d) return 'tools';
  if (d.kind === 'food' || d.heal) return 'food';
  if (slotOf(g, r.out) || r.out === 'arrow') return 'gear';
  if (d.kind === 'furniture' || d.kind === 'block' || HOME_TOO.has(r.out) || (d.place && d.kind !== 'material'))
    return 'home';
  return 'tools';
}

/** The known recipe (from this list) that makes an item, or null. */
function recipeFor(g: Game, known: string[], item: string): string | null {
  return known.find((id) => g.c.recipes[id]!.out === item) ?? null;
}

/** What the tracked quest's current step wants made, when she knows its recipe here and still needs some. */
export function questWant(g: Game, known: string[]): string | null {
  const qid = g.s.tracked;
  const q = qid ? g.s.quests[qid] : undefined;
  const st = qid && q && !q.done ? g.c.quests[qid]?.steps[q.step] : undefined;
  if (!st) return null;
  if (st.t === 'craft') return recipeFor(g, known, st.item);
  if (st.t === 'deliver' || st.t === 'fetch')
    return count(g, st.item) < (st.n ?? 1) ? recipeFor(g, known, st.item) : null;
  if (st.t === 'site') {
    const site = Object.values(g.c.areas)
      .flatMap((a) => a.sites)
      .find((b) => b.id === st.site);
    for (const k in site?.needs ?? {}) {
      const id = countWithChests(g, k) < site!.needs[k]! ? recipeFor(g, known, k) : null;
      if (id) return id;
    }
  }
  return null;
}

/**
 * The recipe to open on: what the quest wants, or, when she cannot make that yet, a missing ingredient she can make
 * right now (logs into planks for the sword). Null when the quest wants nothing from this station.
 */
export function focusRecipe(g: Game, known: string[]): string | null {
  const want = questWant(g, known);
  if (!want) return null;
  const r = g.c.recipes[want]!;
  if (hasAll(g, r)) return want;
  for (const k in r.in) {
    if (countWithChests(g, k) >= r.in[k]!) continue;
    const step = recipeFor(g, known, k);
    if (step && hasAll(g, g.c.recipes[step]!)) return step;
  }
  return want;
}

/** A tool she already owns at the same or a better tier: listed last on its tab. */
export function ownedTool(g: Game, r: RecipeDef): boolean {
  const t = g.c.items[r.out]?.tool;
  if (!t) return false;
  if (count(g, r.out) > 0) return true;
  for (const id in g.s.pouch) {
    const o = g.c.items[id]?.tool;
    if (o && o.type === t.type && o.tier >= t.tier && g.s.pouch[id]! > 0) return true;
  }
  return false;
}

export class CraftMenu extends Menu {
  private all: string[] = [];
  private list: string[] = [];
  private tab = 0;
  /** package 69: she changed the tab herself */
  private chose = false;
  private sel = 0;
  private top = 0;
  private bits: Phaser.GameObjects.GameObject[] = [];
  private tabBits: Phaser.GameObjects.GameObject[] = [];
  private box: Phaser.GameObjects.Graphics;
  private dirty = true;
  private holdT = 0;
  /** the recipe the quest wants (or its next step), glowing */
  private focus: string | null = null;
  /** the goal's own recipe (chosen when the bench opens) */
  private want: string | null = null;
  private glow: Phaser.GameObjects.Graphics;
  private emptyT: Txt;
  private upT: Phaser.GameObjects.Image;
  private downT: Phaser.GameObjects.Image;
  /** by Grandad's workbench (once he has opened it) or an anvil: Q opens the upgrade menu */
  private canUp: boolean;
  /** a tap on the Q hint: the upgrade menu opens on the next step */
  private upTap = false;
  /** package 68: "The bow needs these. Make it anyway?" before a recipe uses up what the goal needs */
  private ask: Ask | null = null;
  private askId = '';

  constructor(ui: UI, kind: 'table' | 'furnace') {
    const up = upgradeHere(ui.g);
    super(ui, `Arrows: choose    Space: make${up ? '    Q: Make stronger' : ''}    X: back`);
    this.canUp = up;
    makeUiTextures(ui);
    panel(this.g2, W / 2 - 640, 60, 1280, 950);
    this.add(title(ui, W / 2, 78, kind === 'table' ? 'Crafting table' : 'Furnace', 54).setOrigin(0.5, 0));
    this.box = this.add(ui.add.graphics());
    this.glow = this.add(ui.add.graphics());
    this.emptyT = this.add(text(ui, W / 2, LIST_Y + 160, '', 36, SOFT).setOrigin(0.5, 0));
    this.upT = this.add(
      ui.add
        .image(W / 2 + 590, LIST_Y + 20, 'ui_arrow')
        .setAngle(-90)
        .setScale(0.45),
    );
    this.downT = this.add(
      ui.add
        .image(W / 2 + 590, LIST_Y + ROWS * ROW_H - 30, 'ui_arrow')
        .setAngle(90)
        .setScale(0.45),
    );
    if (up) {
      // the Q hint by the title, with the sword she would make stronger
      this.add(icon(ui, 'iron_sword', W / 2 + 330, 110, 52));
      this.add(text(ui, W / 2 + 362, 92, 'Q: Make stronger', 32, '#b3541e'));
    }
    this.all = recipeList(this.g, kind);
    // open on the tab of what her quest wants; else the first tab with something she can make now, else any
    const g = this.g;
    this.focus = focusRecipe(g, this.all);
    const can = TABS.findIndex((t) =>
      this.all.some((id) => tabOf(g, g.c.recipes[id]!) === t && hasAll(g, g.c.recipes[id]!)),
    );
    const used = new Set(this.all.map((id) => tabOf(g, g.c.recipes[id]!)));
    const any = TABS.findIndex((t) => used.has(t));
    // the tab that holds the goal's own recipe (package 53a: the sword's tab, even while planks come first)
    this.want = questWant(g, this.all);
    const goal = this.want ?? this.focus;
    const want = goal ? TABS.indexOf(tabOf(g, g.c.recipes[goal]!)) : -1;
    this.tab = Math.max(0, want >= 0 ? want : can >= 0 ? can : any);
    this.load();
  }

  private load(): void {
    const g = this.g;
    const t = TABS[this.tab]!;
    // the quest's thing first, then makeable first (recipeList sorts that way), tools she already has last
    // the goal's recipe first and chosen; the thing to make for it now (planks for the sword) comes next, on this tab
    const rank = (id: string): number =>
      id === this.want ? 0 : id === this.focus ? 1 : ownedTool(g, g.c.recipes[id]!) ? 3 : 2;
    this.list = this.all
      .filter((id) => tabOf(g, g.c.recipes[id]!) === t || (id === this.focus && this.tabHasWant(t)))
      .sort((a, b) => rank(a) - rank(b));
    this.sel = 0;
    this.top = 0;
    this.dirty = true;
  }

  private tabHasWant(t: (typeof TABS)[number]): boolean {
    return !!this.want && tabOf(this.g, this.g.c.recipes[this.want]!) === t;
  }

  private clear(list: Phaser.GameObjects.GameObject[]): void {
    for (const o of list) o.destroy();
    list.length = 0;
  }

  /** The four tabs: a picture and a word each; a green dot on a tab with something she can make now. */
  private drawTabs(): void {
    const g = this.g;
    this.clear(this.tabBits);
    const b = this.box;
    TABS.forEach((t, i) => {
      const x = TAB_X + i * TAB_W;
      const on = i === this.tab;
      const ids = this.all.filter((id) => tabOf(g, g.c.recipes[id]!) === t);
      b.fillStyle(on ? GOLD : 0xe8d9b5, 1).fillRoundedRect(x + 8, 160, TAB_W - 16, 104, 22);
      b.fillStyle(on ? 0xfffbe8 : 0xf3e6c8, 1).fillRoundedRect(x + 14, 166, TAB_W - 28, 92, 18);
      const pic = this.add(icon(this.ui, TAB_ICON[t], x + 66, 212, 64));
      const label = this.add(text(this.ui, x + 110, 188, TAB_LABEL[t], 36, on ? '#b3541e' : ids.length ? INK : SOFT));
      if (!ids.length) {
        pic.setAlpha(0.35);
        label.setAlpha(0.6);
      }
      this.tabBits.push(pic, label);
      if (ids.some((id) => hasAll(g, g.c.recipes[id]!)))
        this.tabBits.push(this.add(this.ui.add.circle(x + TAB_W - 34, 182, 11, 0x5cc85c).setStrokeStyle(3, 0x3b2a1a)));
    });
  }

  private draw(): void {
    const g = this.g;
    // after she makes something the quest's next thing may change (planks made: now the sword); follow it
    const f = focusRecipe(g, this.all);
    const w = questWant(g, this.all);
    if (f !== this.focus || w !== this.want) {
      this.focus = f;
      this.want = w;
      const goal = w ?? f;
      // package 69: a tab she chose with Left or Right stays (run c 0142: the menu kept going back to the goal's tab)
      if (goal && !this.chose) this.tab = TABS.indexOf(tabOf(g, g.c.recipes[goal]!));
      this.load();
    }
    this.clear(this.bits);
    this.box.clear();
    this.drawTabs();
    const b = this.box;
    const t = TABS[this.tab]!;
    this.emptyT.setText(this.list.length ? '' : EMPTY[t]);
    this.top = Math.max(0, Math.min(this.sel - 2, this.list.length - ROWS));
    this.glow.clear().setVisible(false);
    for (let i = 0; i < ROWS; i++) {
      const id = this.list[this.top + i];
      if (!id) break;
      const r = g.c.recipes[id]!;
      const y = LIST_Y + i * ROW_H;
      const can = hasAll(g, r);
      const chosen = this.top + i === this.sel;
      b.fillStyle(chosen ? GOLD : 0xe8d9b5, 1).fillRoundedRect(W / 2 - 570, y, 1140, ROW_H - 10, 20);
      b.fillStyle(can ? 0xfffdf2 : 0xefe6d2, 1).fillRoundedRect(W / 2 - 564, y + 6, 1128, ROW_H - 22, 16);
      // package 68: the goal's own recipe carries the goal's star
      if (id === this.want)
        this.bits.push(this.add(this.ui.add.image(W / 2 - 548, y + 14, 'ui_starbig').setScale(0.5)));
      if (id === this.focus) {
        this.glow.lineStyle(14, 0xffd23f, 0.45).strokeRoundedRect(W / 2 - 578, y - 8, 1156, ROW_H + 6, 26);
        this.glow.lineStyle(6, 0xffc21a, 1).strokeRoundedRect(W / 2 - 574, y - 4, 1148, ROW_H - 2, 24);
        this.glow.setVisible(true);
      }
      const out = g.c.items[r.out]!;
      const pic = this.add(icon(this.ui, r.out, W / 2 - 510, y + 45, 68));
      if (!can) pic.setAlpha(0.55);
      this.bits.push(pic, ...glint(this.ui, W / 2 - 510, y + 45, 68, plusOf(g, r.out)).map((o) => this.add(o)));
      const name = `${r.n > 1 ? r.n + ' ' : ''}${r.n > 1 ? (out.names ?? out.name + 's') : out.name}`;
      this.bits.push(this.add(text(this.ui, W / 2 - 450, y + 22, name, 36, can ? INK : SOFT)));
      let x = W / 2 + 30;
      for (const k in r.in) {
        const have = countWithChests(g, k);
        const need = r.in[k]!;
        // a picture each: enough gets a tick (and how many it takes, when more than 1); short gets a red number
        // of how many more she needs. Never "have/need".
        this.bits.push(this.add(icon(this.ui, k, x, y + 45, 56)));
        if (have >= need) {
          this.bits.push(this.add(this.ui.add.image(x + 26, y + 22, 'ui_tick').setScale(0.5)));
          if (need > 1) this.bits.push(this.add(text(this.ui, x + 36, y + 34, String(need), 30, INK)));
        } else this.bits.push(this.add(text(this.ui, x + 36, y + 34, String(need - have), 32, '#b3261e')));
        x += 150;
      }
    }
    // package 68: where each thing the chosen recipe lacks comes from, in 3 words, under the list
    const cur = this.list[this.sel] ? g.c.recipes[this.list[this.sel]!] : undefined;
    if (cur) {
      let wx = W / 2 - 540;
      for (const k in cur.in) {
        if (countWithChests(g, k) >= cur.in[k]!) continue;
        this.bits.push(this.add(icon(this.ui, k, wx + 28, LIST_Y + ROWS * ROW_H + 50, 48)));
        const t = this.add(text(this.ui, wx + 62, LIST_Y + ROWS * ROW_H + 30, whereFrom(g, k), 30, SOFT));
        this.bits.push(t);
        wx += 90 + t.width;
        if (wx > W / 2 + 400) break;
      }
    }
    // more above or below: small arrows, never a count
    this.upT.setVisible(this.top > 0);
    this.downT.setVisible(this.top + ROWS < this.list.length);
    // Done, after the last recipe: Space there closes the table
    this.bits.push(this.add(doneButton(this.ui, b, W / 2, DONE_Y, this.sel === this.list.length)));
    this.ask?.raise(this.root);
  }

  /** Touch: a tab changes tab, a row makes it, the small arrows scroll, the Q hint makes stronger, outside is back. */
  tap(x: number, y: number): boolean {
    if (this.ask) {
      if (this.ask.tap(x, y) === 'pick') this.tapPick = true;
      else this.closeAsk();
      return true;
    }
    if (!within(x, y, W / 2 - 640, 60, 1280, 950)) {
      this.done = true;
      return true;
    }
    if (onDone(x, y, W / 2, DONE_Y)) {
      this.done = true;
      return true;
    }
    if (this.canUp && within(x, y, W / 2 + 290, 70, 350, 80)) {
      this.upTap = true;
      return true;
    }
    if (y >= 150 && y <= 274) {
      const i = Math.floor((x - TAB_X) / TAB_W);
      if (i >= 0 && i < TABS.length && i !== this.tab) {
        this.tab = i;
        this.chose = true;
        this.load();
        Sound.sfx('tick');
      }
      return true;
    }
    if (x > W / 2 + 572 && (this.upT.visible || this.downT.visible)) {
      // the scroll arrows: a page up or down
      const up = y < LIST_Y + (ROWS * ROW_H) / 2;
      this.sel = Math.max(0, Math.min(this.list.length - 1, this.sel + (up ? -ROWS : ROWS)));
      this.dirty = true;
      Sound.sfx('tick');
      return true;
    }
    const i = Math.floor((y - LIST_Y + 5) / ROW_H);
    const at = this.top + i;
    if (i < 0 || i >= ROWS || at >= this.list.length || Math.abs(x - W / 2) > 600) return true;
    if (at !== this.sel) Sound.sfx('tick');
    this.sel = at;
    this.dirty = true;
    this.tapPick = true;
    return true;
  }

  private closeAsk(): void {
    this.ask?.destroy();
    this.ask = null;
    this.dirty = true;
  }

  update(dt: number): void {
    this.t += dt;
    const n = this.nav(dt);
    if (this.ask) {
      const a = this.ask.step(n.y, this.act(), this.back());
      if (a === 'yes') {
        this.keys.send({ c: 'craft', recipe: this.askId });
        this.holdT = 0.12;
      }
      if (a) this.closeAsk();
      if (this.dirty || this.holdT > 0) {
        if (this.holdT > 0) this.holdT -= dt;
        this.dirty = this.holdT > 0;
        this.draw();
      }
      return;
    }
    if (n.x) {
      this.tab = (this.tab + n.x + TABS.length) % TABS.length;
      this.chose = true;
      this.load();
    }
    if (n.y) {
      this.sel = stepDone(this.sel, n.y, this.list.length);
      this.dirty = true;
    }
    if (this.holdT > 0) this.holdT -= dt;
    // the quest's row glows: a soft gold pulse
    if (this.glow.visible) this.glow.setAlpha(0.55 + Math.sin(this.t * 4) * 0.45);
    if (this.act()) {
      if (this.sel === this.list.length) {
        this.done = true;
        return;
      }
      const id = this.list[this.sel];
      const want = goalRecipe(this.g);
      if (id && hasAll(this.g, this.g.c.recipes[id]!) && want && eatsGoal(this.g, id)) {
        // the kind answer first: keep the things the goal needs
        const what = this.g.c.items[want.r.out]?.name ?? want.r.out;
        this.askId = id;
        this.ask = new Ask(
          this.ui,
          (o) => this.add(o),
          (this.g.c.strings.craft_eats ?? 'The {what} needs these. Make it anyway?').replace('{what}', what),
          this.g.c.strings.craft_keep ?? 'No, keep them',
          this.g.c.strings.craft_anyway ?? 'Yes, make it',
        );
      } else if (id && hasAll(this.g, this.g.c.recipes[id]!)) {
        this.keys.send({ c: 'craft', recipe: id });
        this.holdT = 0.12;
      } else Sound.sfx('nope');
      this.dirty = true;
    }
    if (this.canUp && (this.keys.take('KeyQ') || this.upTap)) {
      // the upgrade menu takes the screen; this menu is closed by UI.open
      this.ui.open('upgrade');
      return;
    }
    if (this.back() || this.keys.take('KeyE')) this.done = true;
    // counts change a step after the command is sent
    if (this.dirty || this.holdT > 0) {
      this.dirty = this.holdT > 0;
      this.draw();
    }
  }
}

register('craft', (ui, arg) => new CraftMenu(ui, arg === 'furnace' ? 'furnace' : 'table'));
