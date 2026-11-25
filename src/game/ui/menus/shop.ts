// Shop stalls (Buy and Sell tabs) and the jukebox.
import Phaser from 'phaser';
import { stockLeft } from '../../../core/craft.ts';
import { count, test } from '../../../core/cond.ts';
import { Sound } from '../../audio.ts';
import type { UI } from '../../scenes/UI.ts';
import { doneButton, GOLD, icon, INK, onDone, panel, SOFT, stepDone, text, title, W } from '../kit.ts';
import { Ask } from '../ask.ts';
import { Menu, within } from '../menu.ts';
import { register } from '../registry.ts';
import { pageFor } from './projects.ts';

const ROWS = 7;
/** the panel's height, and the top of its Done button under the seventh row */
const PANEL_H = 940;
const DONE_Y = 918;

interface Row {
  icon: string;
  name: string;
  detail: string;
  ok: boolean;
  /** index in the stall (buy) or bag slot (sell) */
  at: number;
  /** package 68: none left to buy */
  out?: boolean;
  price?: number;
}

export class ShopMenu extends Menu {
  private stall: string;
  private tab: 'buy' | 'sell' = 'buy';
  private list: Row[] = [];
  private sel = 0;
  /** the first row on screen */
  private top = 0;
  private sig = '';
  private dyn: Phaser.GameObjects.GameObject[] = [];
  private space: Phaser.Input.Keyboard.Key;
  private hold = 0;
  /** package 68: the cursor goes to the first thing she can buy once the list is first made (and on a new tab) */
  private placed = false;
  /** package 68: "Buy the rug for 6 tickets?" before a prize or a big price */
  private ask: Ask | null = null;
  private askRow: Row | null = null;

  constructor(ui: UI, stall: string) {
    super(ui, 'Up and down: choose    Space: buy or sell    X: back');
    this.stall = stall;
    this.space = ui.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE, false, false);
    panel(this.g2, W / 2 - 620, 70, 1240, PANEL_H);
    const def = this.g.c.stalls[stall];
    this.add(title(ui, W / 2, 90, def ? def.name.replace(/^./, (c) => c.toUpperCase()) : 'Shop', 52).setOrigin(0.5, 0));
  }

  private canSell(): boolean {
    return !!this.g.c.stalls[this.stall]?.buys;
  }
  private currency(): string {
    return this.stall === 'prizes' ? 'ticket' : 'emerald';
  }
  private purse(): number {
    return this.stall === 'prizes' ? count(this.g, 'ticket') : this.g.s.emeralds;
  }

  private build(): Row[] {
    const g = this.g;
    const def = g.c.stalls[this.stall];
    const out: Row[] = [];
    if (!def) return out;
    if (this.tab === 'buy') {
      def.sells.forEach((row, i) => {
        if (!test(g, row.if)) return;
        const left = stockLeft(g, this.stall, i);
        if (left === 0 && row.recipe && g.s.recipes.includes(row.recipe)) return;
        const item = g.c.items[row.item];
        const nm = item?.name ?? row.item;
        const label = row.recipe ? `Recipe: ${g.c.items[g.c.recipes[row.recipe]?.out ?? row.item]?.name ?? nm}` : nm;
        const extra = left === 0 ? 'Sold out' : row.stock !== undefined ? `${left} left` : '';
        out.push({
          icon: row.item,
          name: label,
          detail: `${row.price}${extra ? '    ' + extra : ''}`,
          ok: left > 0 && this.purse() >= row.price,
          at: i,
          out: left === 0,
          price: row.price,
        });
      });
    } else {
      g.s.bag.forEach((sl, i) => {
        const d = sl ? g.c.items[sl.id] : null;
        if (!sl || !d?.sell) return;
        out.push({ icon: sl.id, name: d.name, detail: `${d.sell} each    x${sl.n}`, ok: true, at: i });
      });
    }
    return out;
  }

  private signature(): string {
    const g = this.g;
    let s = `${this.tab}|${this.sel}|${g.s.emeralds}|${count(g, 'ticket')}|${g.s.recipes.length}`;
    for (const sl of g.s.bag) s += sl ? `|${sl.id}${sl.n}` : '|';
    for (const k in g.s.bought) s += `|${k}${g.s.bought[k]}`;
    return s;
  }

  private draw(): void {
    for (const o of this.dyn) o.destroy();
    this.dyn = [];
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => {
      this.dyn.push(o);
      return this.add(o);
    };
    const g2 = add(this.ui.add.graphics());
    // tabs and purse
    const tabs: ['buy' | 'sell', string][] = this.canSell()
      ? [
          ['buy', 'Buy'],
          ['sell', 'Sell'],
        ]
      : [['buy', 'Buy']];
    tabs.forEach(([k, label], i) => {
      const x = W / 2 - 580 + i * 220;
      g2.fillStyle(this.tab === k ? GOLD : 0xe8d9b5, 1).fillRoundedRect(x, 170, 200, 64, 18);
      add(text(this.ui, x + 100, 180, label, 38, INK).setOrigin(0.5, 0));
    });
    add(icon(this.ui, this.currency() === 'ticket' ? 'ticket' : 'emerald', W / 2 + 420, 202, 56));
    add(text(this.ui, W / 2 + 460, 178, String(this.purse()), 44, INK));
    if (this.canSell()) add(text(this.ui, W / 2 - 100, 184, 'Left and right: Buy or Sell', 28, SOFT));
    // Done, after the last row: Space there closes the stall (issue 23: the prize counter had no way out but X)
    add(doneButton(this.ui, g2, W / 2, DONE_Y, this.sel === this.list.length));
    if (this.list.length === 0) {
      add(
        text(
          this.ui,
          W / 2,
          520,
          this.tab === 'sell' ? 'Nothing to sell right now.' : 'Nothing for sale today.',
          40,
          SOFT,
        ).setOrigin(0.5, 0),
      );
      return;
    }
    const top = Math.max(0, Math.min(this.sel - 3, this.list.length - ROWS));
    this.top = top;
    for (let i = 0; i < ROWS; i++) {
      const r = this.list[top + i];
      if (!r) break;
      const y = 256 + i * 94;
      const chosen = top + i === this.sel;
      g2.fillStyle(chosen ? GOLD : 0xe8d9b5, 1).fillRoundedRect(W / 2 - 580, y, 1160, 84, 20);
      g2.fillStyle(r.ok ? 0xfffdf2 : 0xefe6d2, 1).fillRoundedRect(W / 2 - 574, y + 6, 1148, 72, 16);
      const pic = add(icon(this.ui, r.icon, W / 2 - 520, y + 42, 64));
      if (!r.ok) pic.setAlpha(0.55);
      add(text(this.ui, W / 2 - 470, y + 20, r.name, 36, r.ok ? INK : SOFT));
      const d = add(text(this.ui, W / 2 + 560, y + 20, r.detail, 34, r.ok ? INK : SOFT).setOrigin(1, 0));
      void d;
    }
    if (this.list.length > ROWS) {
      const at = Math.min(this.sel + 1, this.list.length);
      add(text(this.ui, W / 2 + 520, 100, `${at}/${this.list.length}`, 28, SOFT));
    }
  }

  /** Touch: a tab changes tab, a row buys or sells it, Done or outside is back. */
  tap(x: number, y: number): boolean {
    if (this.ask) {
      if (this.ask.tap(x, y) === 'pick') this.tapPick = true;
      else this.closeAsk();
      return true;
    }
    if (!within(x, y, W / 2 - 620, 70, 1240, PANEL_H) || onDone(x, y, W / 2, DONE_Y)) {
      this.done = true;
      return true;
    }
    if (y >= 160 && y <= 244) {
      const i = Math.floor((x - (W / 2 - 590)) / 220);
      const k = i === 0 ? 'buy' : i === 1 && this.canSell() ? 'sell' : null;
      if (k && k !== this.tab) {
        this.tab = k;
        this.sel = 0;
        this.placed = false;
        Sound.sfx('tick');
      }
      return true;
    }
    const i = Math.floor((y - 251) / 94);
    const at = this.top + i;
    if (i < 0 || i >= ROWS || at >= this.list.length || Math.abs(x - W / 2) > 600) return true;
    if (at !== this.sel) Sound.sfx('tick');
    this.sel = at;
    this.tapPick = true;
    return true;
  }

  private closeAsk(): void {
    this.ask?.destroy();
    this.ask = null;
    this.askRow = null;
  }

  update(dt: number): void {
    this.t += dt;
    const n = this.nav(dt);
    if (this.ask) {
      const a = this.ask.step(n.y, this.act(), this.back());
      if (a === 'yes' && this.askRow) this.keys.send({ c: 'buy', stall: this.stall, i: this.askRow.at });
      if (a) this.closeAsk();
      return;
    }
    if (n.x && this.canSell()) {
      this.tab = n.x > 0 ? 'sell' : 'buy';
      this.sel = 0;
      this.placed = false;
    }
    if (n.y) this.sel = stepDone(this.sel, n.y, this.list.length);
    let go = this.act();
    if (this.tab === 'sell') {
      if (go) this.hold = 0.4;
      else if (this.space.isDown && this.hold > 0) {
        this.hold -= dt;
        if (this.hold <= 0) {
          this.hold = 0.12;
          go = true;
        }
      } else if (!this.space.isDown) this.hold = 0;
    }
    if (go && this.sel === this.list.length) {
      this.done = true;
      return;
    }
    if (go) {
      const r = this.list[this.sel]!;
      if (this.tab === 'buy') {
        const tickets = this.currency() === 'ticket';
        if (r.ok && (tickets || (r.price ?? 0) > 5)) {
          // package 68: a prize or a big price asks once, the kind answer first
          const S = this.g.c.strings;
          this.askRow = r;
          this.ask = new Ask(
            this.ui,
            (o) => this.add(o),
            (S.shop_ask ?? 'Buy the {what} for {n} {money}?')
              .replace('{what}', r.name)
              .replace('{n}', String(r.price ?? 0))
              .replace('{money}', tickets ? 'tickets' : 'emeralds'),
            S.shop_keep ?? 'No, not now',
            S.shop_yes ?? 'Yes, buy it',
          );
        } else if (r.ok) this.keys.send({ c: 'buy', stall: this.stall, i: r.at });
        else Sound.sfx('nope');
      } else this.keys.send({ c: 'sell', slot: r.at });
    }
    if (this.back() || this.keys.takeAny('KeyE', 'Escape')) this.done = true;
    // state changes a step after a command, so redraw when it differs
    const sg = this.signature();
    if (sg !== this.sig) {
      const onDoneBefore = this.sel === this.list.length;
      this.list = this.build();
      if (!this.placed && this.list.length) {
        // package 68: start on the first thing she can buy, never on a sold-out one
        this.placed = true;
        let i = this.list.findIndex((r) => r.ok);
        if (i < 0) i = this.list.findIndex((r) => !r.out);
        this.sel = Math.max(0, i);
      }
      // a row sold out or sold away under the cursor: stay on the rows (held Space never walks onto Done)
      if (this.sel > this.list.length || (this.sel === this.list.length && !onDoneBefore))
        this.sel = Math.max(0, this.list.length - 1);
      this.sig = this.signature();
      this.draw();
    }
  }
}

// disc id to tune id (keys of MUSIC in src/game/music.ts)
const TUNES: Record<string, string> = {
  disc_gum: 'gum',
  disc_forest: 'forest',
  disc_cave: 'cave',
  disc_water: 'bay',
  disc_star: 'night',
};

/** the jukebox panel's height, and the top of its Done button under the last row */
const JUKE_H = 850;
const JUKE_DONE_Y = 902;

export class JukeboxMenu extends Menu {
  private discs: string[] = [];
  private sel = 0;
  private dyn: Phaser.GameObjects.GameObject[] = [];
  private playing = '';

  constructor(ui: UI) {
    super(ui, 'Up and down: choose    Space: play    X: back');
    panel(this.g2, W / 2 - 480, 150, 960, JUKE_H);
    this.add(title(ui, W / 2, 180, 'Jukebox', 58).setOrigin(0.5, 0));
    const pouch = this.g.s.pouch;
    this.discs = Object.keys(pouch).filter((k) => (pouch[k] ?? 0) > 0 && this.g.c.items[k]?.kind === 'disc');
    this.discs.push('');
    this.draw();
  }

  /** The rows to choose from: each disc and the usual music, or none when she has no discs. Done comes after them. */
  private get rows(): number {
    return this.discs.length > 1 ? this.discs.length : 0;
  }

  private draw(): void {
    for (const o of this.dyn) o.destroy();
    this.dyn = [];
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => {
      this.dyn.push(o);
      return this.add(o);
    };
    const g2 = add(this.ui.add.graphics());
    add(doneButton(this.ui, g2, W / 2, JUKE_DONE_Y, this.sel === this.rows));
    if (this.discs.length === 1) {
      add(text(this.ui, W / 2, 400, 'No discs yet. Find some on your travels!', 38, SOFT, 760).setOrigin(0.5, 0));
      return;
    }
    this.discs.forEach((id, i) => {
      const y = 290 + i * 100;
      const chosen = i === this.sel;
      g2.fillStyle(chosen ? GOLD : 0xe8d9b5, 1).fillRoundedRect(W / 2 - 420, y, 840, 88, 20);
      g2.fillStyle(0xfffdf2, 1).fillRoundedRect(W / 2 - 414, y + 6, 828, 76, 16);
      if (id) add(icon(this.ui, id, W / 2 - 360, y + 44, 64));
      const label = id ? (this.g.c.items[id]?.name ?? id) : 'Back to the usual music';
      add(text(this.ui, W / 2 - 300, y + 24, `${label}${id && id === this.playing ? '   (playing)' : ''}`, 36, INK));
    });
  }

  /** Touch: a row plays it, Done or outside is back. */
  tap(x: number, y: number): boolean {
    if (!within(x, y, W / 2 - 480, 150, 960, JUKE_H) || onDone(x, y, W / 2, JUKE_DONE_Y)) {
      this.done = true;
      return true;
    }
    const i = Math.floor((y - 285) / 100);
    if (this.discs.length < 2 || i < 0 || i >= this.discs.length || Math.abs(x - W / 2) > 440) return true;
    if (i !== this.sel) Sound.sfx('tick');
    this.sel = i;
    this.tapPick = true;
    return true;
  }

  update(dt: number): void {
    this.t += dt;
    const n = this.nav(dt);
    if (n.y) {
      this.sel = stepDone(this.sel, n.y, this.rows);
      this.draw();
    }
    const go = this.act();
    if (go && this.sel === this.rows) {
      this.done = true;
      return;
    }
    if (go) {
      const id = this.discs[this.sel]!;
      this.playing = id;
      Sound.music(id ? (TUNES[id] ?? 'home') : '');
      this.draw();
    }
    if (this.back()) this.done = true;
  }
}

// package 47b: Dad's fish board and the cup shelf stand in the world as stalls, but open their own pages
register('shop', (ui, arg) => pageFor(ui, arg ?? '') ?? new ShopMenu(ui, arg ?? 'shop'));
register('service', (ui, arg) => {
  if (arg === 'jukebox') return new JukeboxMenu(ui);
  if (arg?.startsWith('shop:')) return new ShopMenu(ui, arg.slice(5));
  return null;
});
register('jukebox', (ui) => new JukeboxMenu(ui));
