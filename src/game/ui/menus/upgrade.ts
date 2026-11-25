// The upgrade menu at Grandad's workbench (once he has opened it) and at an anvil: the sword and the bow she wears,
// what +1 or +2 costs as pictures and numbers, what it gives, and Space to do it. Keyboard only.
import type Phaser from 'phaser';
import { upgradeCost, upgradeShort, upgradeWhy } from '../../../core/gear.ts';
import { whereFrom } from '../../../core/source.ts';
import type { Game } from '../../../core/types.ts';
import { Sound } from '../../audio.ts';
import type { UI } from '../../scenes/UI.ts';
import { damageOf, glint, have, plusOf, worn } from '../gear.ts';
import {
  doneButton,
  GOLD,
  icon,
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

const ROW_Y = [300, 560];
/** "Have {n}." with the number put in. */
const fillN = (s: string | undefined, n: number): string => (s ?? '{n}').replace('{n}', String(n));
const ROW_H = 220;
const LEFT = W / 2 - 600;
/** The panel's height, and the shared Done button below the note line (issue 23). */
const PANEL_H = 880;
const DONE_Y = 900;

/** Issue 62: what is missing, by name, and where it comes from ("Get 1 more emerald. Sell things at a shop."). */
function shortLine(g: Game, id: string): string {
  const sh = upgradeShort(g, id);
  if (!sh) return 'You need a bit more.';
  const n = sh.need - sh.have;
  const d = g.c.items[sh.item];
  const name = d ? (n === 1 ? d.name : (d.names ?? `${d.name}s`)) : sh.item;
  const get = (g.c.strings.up_short ?? 'Get {n} more {item}.').replace('{n}', String(n)).replace('{item}', name);
  return `${get} ${whereFrom(g, sh.item)}.`;
}

export class UpgradeMenu extends Menu {
  private ids: string[] = [];
  private sel = 0;
  private box: Phaser.GameObjects.Graphics;
  private bits: Phaser.GameObjects.GameObject[] = [];
  private key = '';
  private noteT: Txt;
  private noteTime = 0;
  private plusWas: number[] = [];

  constructor(ui: UI) {
    super(ui, 'Up and down: choose    Space: make it better    X: back');
    makeUiTextures(ui);
    panel(this.g2, W / 2 - 660, 120, 1320, PANEL_H);
    this.add(title(ui, W / 2, 150, 'Make it better', 58).setOrigin(0.5, 0));
    this.box = this.add(ui.add.graphics());
    this.noteT = this.add(text(ui, W / 2, 795, '', 34, '#b3261e').setOrigin(0.5, 0));
  }

  private say(msg: string, good = false): void {
    this.noteT.setText(msg).setColor(good ? '#2e7d32' : '#b3261e');
    this.noteTime = 2.5;
  }

  private draw(): void {
    const g = this.g;
    for (const b of this.bits) b.destroy();
    this.bits = [];
    const b = this.box;
    b.clear();
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => {
      this.bits.push(this.add(o));
      return o;
    };
    if (!this.ids.length) {
      add(text(this.ui, W / 2, 470, g.c.strings.up_none ?? '', 40, SOFT).setOrigin(0.5, 0));
    }
    this.ids.forEach((id, i) => {
      const y = ROW_Y[i]!;
      const on = i === this.sel;
      b.fillStyle(on ? GOLD : 0xe8d9b5, 1).fillRoundedRect(LEFT, y, 1200, ROW_H, 26);
      b.fillStyle(0xfffdf2, 1).fillRoundedRect(LEFT + 7, y + 7, 1186, ROW_H - 14, 20);
      const p = plusOf(g, id);
      // the item as it is now, and its name as the row's title
      add(icon(this.ui, id, LEFT + 110, y + ROW_H / 2, 130));
      for (const o of glint(this.ui, LEFT + 110, y + ROW_H / 2, 130, p)) add(o);
      const nm = g.c.items[id]?.name ?? id;
      add(title(this.ui, LEFT + 240, y + 26, nm.charAt(0).toUpperCase() + nm.slice(1), 40));
      const cy = y + ROW_H / 2 + 30;
      const cost = upgradeCost(g, id);
      if (!cost) {
        // +2 already: the best it can be
        add(this.ui.add.image(LEFT + 280, cy, 'ui_dmg').setScale(0.9));
        add(text(this.ui, LEFT + 320, cy - 34, String(damageOf(g, id)), 52));
        add(title(this.ui, LEFT + 480, cy - 32, 'The best it can be!', 46, '#2e7d32'));
        return;
      }
      // what it gives: damage now, an arrow, damage after
      add(this.ui.add.image(LEFT + 270, cy, 'ui_dmg').setScale(0.9));
      add(text(this.ui, LEFT + 310, cy - 34, String(damageOf(g, id)), 52));
      add(this.ui.add.image(LEFT + 400, cy, 'ui_arrow').setScale(0.7));
      add(text(this.ui, LEFT + 450, cy - 34, String(damageOf(g, id, p + 1)), 52, '#2e7d32'));
      add(title(this.ui, LEFT + 520, cy - 30, `+${p + 1}`, 48, '#1c6fd1'));
      // what it costs: pictures with have and need
      const parts = { ...cost.items, emerald: cost.emeralds };
      let x = LEFT + 700;
      for (const k in parts) {
        const need = parts[k as keyof typeof parts]!;
        const got = have(g, k);
        add(icon(this.ui, k, x, cy, 72));
        const words = `${fillN(g.c.strings.up_have, Math.min(got, 99))}\n${fillN(g.c.strings.up_need, need)}`;
        add(text(this.ui, x + 46, cy - 38, words, 32, got >= need ? '#2e7d32' : '#b3261e'));
        x += 230;
      }
    });
    add(doneButton(this.ui, b, W / 2, DONE_Y, this.sel === this.ids.length));
  }

  /** Touch: a row makes it better (as Space); Done or outside is back. */
  tap(x: number, y: number): boolean {
    if (!within(x, y, W / 2 - 660, 120, 1320, PANEL_H) || onDone(x, y, W / 2, DONE_Y)) {
      this.done = true;
      return true;
    }
    const i = this.ids.findIndex((_, k) => within(x, y, LEFT, ROW_Y[k]!, 1200, ROW_H, 16));
    if (i < 0) return true;
    if (i !== this.sel) {
      Sound.sfx('tick');
      this.sel = i;
      this.draw();
    }
    this.tapPick = true;
    return true;
  }

  update(dt: number): void {
    this.t += dt;
    const g = this.g;
    const w = worn(g);
    const ids = [w.sword, w.bow].filter((x) => !!x);
    const key = `${ids.join(',')}|${ids.map((id) => plusOf(g, id)).join(',')}|${g.s.emeralds}`;
    if (key !== this.key) {
      // an upgrade landed: a happy note
      if (this.key && ids.join(',') === this.ids.join(',') && ids.some((id, i) => plusOf(g, id) > this.plusWas[i]!)) {
        this.say('It is stronger now!', true);
        Sound.arp('bell', [0, 4, 7, 12], 0.08, 0.6);
      }
      this.key = key;
      this.ids = ids;
      this.plusWas = ids.map((id) => plusOf(g, id));
      this.sel = Math.min(this.sel, ids.length);
      this.draw();
    }
    const n = this.nav(dt);
    if (n.y) {
      this.sel = stepDone(this.sel, n.y, ids.length);
      this.draw();
    }
    if (this.act()) {
      if (this.sel === ids.length) {
        this.done = true;
        return;
      }
      const id = ids[this.sel];
      const why = id ? upgradeWhy(g, id) : 'not_gear';
      if (!why) this.keys.send({ c: 'upgrade', item: id! });
      else {
        Sound.sfx('nope');
        if (why === 'short') this.say(shortLine(g, id!));
        else if (why === 'max') this.say('It is the best it can be.');
        else if (why === 'not_here') this.say('Go to an anvil.');
      }
    }
    if (this.noteTime > 0) {
      this.noteTime -= dt;
      if (this.noteTime <= 0) this.noteT.setText('');
    }
    if (this.back() || this.keys.take('KeyE')) this.done = true;
  }
}

register('upgrade', (ui) => new UpgradeMenu(ui));
