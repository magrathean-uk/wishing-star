// The Gear page of the bag (Q in the bag, or the armour stand at home): her hero, wearing what she wears, between
// the four slots (sword, bow, helmet, armour), and every piece she has. Each piece shows what it does as a picture
// and a number. Space on a piece puts it on; Space on a worn slot takes it off. Q, or a tap on the Bag tab, goes
// back to the bag.
import type Phaser from 'phaser';
import type { GearSlot } from '../../../core/types.ts';
import { Sound } from '../../audio.ts';
import { touchState } from '../../input.ts';
import { art, frameFor } from '../../assets.ts';
import { Puppet } from '../../puppet.ts';
import type { UI } from '../../scenes/UI.ts';
import { damageOf, glint, owned, plusOf, SLOTS, shieldMax, shieldOf, slotOf, worn } from '../gear.ts';
import { GOLD, icon, INK, makeUiTextures, panel, slot, SOFT, text, title, type Txt, W } from '../kit.ts';
import { Menu, within } from '../menu.ts';
import { register } from '../registry.ts';

/** Where each slot sits: two on the left of her, two on the right. */
const SLOT_AT: Record<GearSlot, { x: number; y: number }> = {
  sword: { x: 210, y: 330 },
  bow: { x: 210, y: 590 },
  helmet: { x: 790, y: 330 },
  armour: { x: 790, y: 590 },
};
/** A faint picture in an empty slot, so she knows what goes there. */
const HOLDER: Record<GearSlot, string> = {
  sword: 'wood_sword',
  bow: 'bow',
  helmet: 'leather_helmet',
  armour: 'leather_armour',
};
const SZ = 150;
const HERO_X = 500;
const FEET_Y = 790;
const LIST_X = 1010;
const LIST_Y = 250;
const COLS = 5;
const PITCH = 156;
const CELL = 136;

/** Drawn bits that are rebuilt whenever what she wears or has changes. */
type Bits = Phaser.GameObjects.GameObject[];

export class GearMenu extends Menu {
  private box: Phaser.GameObjects.Graphics;
  private hero: Puppet | null = null;
  private heroId = '';
  /** 0 the left slots, 1 the right slots, 2 the list */
  private col = 0;
  private row = 0;
  private lcol = 0;
  private list: string[] = [];
  private bits: Bits = [];
  private wornBits: Bits = [];
  private key = '';
  private nameT: Txt;
  private infoT: Txt;
  private infoBits: Bits = [];
  private emptyT: Txt;
  private cheerT = 0;
  /** issue 58: the Bag tab, and a tap on it (the bag opens on the next step, as Q does) */
  private bagBox = { x: 106, y: 58, w: 112, h: 60 };
  private bagTap = false;

  constructor(ui: UI) {
    super(ui, 'Arrows: move    Space: put on or take off    Q: bag    X: back');
    makeUiTextures(ui);
    panel(this.g2, 40, 40, W - 80, 960);
    // the page tabs: the bag and this page (on touch the Bag tab looks like a button: a tap goes back to the bag)
    if (touchState.shown) {
      const b = this.bagBox;
      this.g2.fillStyle(0xf7dca0, 1).fillRoundedRect(b.x, b.y, b.w, b.h, 16);
      this.g2.lineStyle(4, 0xb7791f, 1).strokeRoundedRect(b.x, b.y, b.w, b.h, 16);
      this.add(text(ui, b.x + b.w / 2, 66, 'Bag', 34, '#7a4a12').setOrigin(0.5, 0));
    } else this.add(text(ui, 120, 66, 'Bag', 36, SOFT));
    this.add(title(ui, 260, 58, 'Gear', 52));
    this.g2.lineStyle(6, GOLD, 1).lineBetween(254, 128, 380, 128);
    this.add(text(ui, LIST_X, 160, 'Your gear', 40, INK));
    this.box = this.add(ui.add.graphics());
    this.emptyT = this.add(text(ui, LIST_X, LIST_Y + 20, 'Make a sword or a bow!', 36, SOFT));
    panel(this.g2, LIST_X - 20, 770, 860, 200, 0xfff3d0);
    this.nameT = this.add(text(ui, LIST_X + 10, 790, '', 40, INK));
    this.infoT = this.add(text(ui, LIST_X + 10, 900, '', 30, SOFT));
    this.makeHero();
    // start on the first worn slot, or on the list when nothing is worn
    const w = worn(this.g);
    const first = SLOTS.findIndex((s) => w[s]);
    if (first >= 0) {
      this.col = first < 2 ? 0 : 1;
      this.row = first % 2;
    } else this.col = owned(this.g).length ? 2 : 0;
  }

  private makeHero(): void {
    const g = this.g;
    if (this.heroId === g.s.hero) return;
    this.hero?.destroy();
    this.heroId = g.s.hero;
    const tall = g.c.chars[g.s.hero]?.tall ?? 2;
    // her Christmas clothes when the world shows them
    const xid = `${g.s.hero}_xmas`;
    const p = new Puppet(this.ui, g.s.xmas && art.chars.sets[xid] ? xid : g.s.hero, tall, true);
    p.zoom = Math.min(4, 420 / (tall * 64));
    p.sprite.setDepth(71);
    p.setPos(HERO_X, FEET_Y);
    this.hero = p;
  }

  /** The slot under the pointer, when it is on the slots. */
  private slotAt(): GearSlot | null {
    if (this.col === 2) return null;
    return SLOTS[this.col * 2 + this.row]!;
  }
  private pieceAt(): string {
    return this.list[this.row * COLS + this.lcol] ?? '';
  }

  private move(dx: number, dy: number): void {
    const rows = Math.max(1, Math.ceil(this.list.length / COLS));
    if (this.col < 2) {
      if (dy) this.row = (this.row + dy + 2) % 2;
      if (dx > 0) {
        if (this.col === 0) this.col = 1;
        else if (this.list.length) {
          this.col = 2;
          this.lcol = 0;
          this.row = Math.min(this.row, rows - 1);
        }
      } else if (dx < 0 && this.col === 1) this.col = 0;
      return;
    }
    if (dy) this.row = (this.row + dy + rows) % rows;
    if (dx < 0 && this.lcol === 0) {
      this.col = 1;
      this.row = Math.min(this.row, 1);
      return;
    }
    if (dx) this.lcol = Math.max(0, Math.min(COLS - 1, this.lcol + dx));
    // never past the last piece
    const last = this.list.length - 1;
    if (this.row * COLS + this.lcol > last) {
      this.row = Math.floor(last / COLS);
      this.lcol = last % COLS;
    }
  }

  /** A picture and a number for what a piece does: damage for a sword or bow, blue hearts for armour. */
  private stat(id: string, x: number, y: number, size: number, out: Bits): void {
    const g = this.g;
    const s = slotOf(g, id);
    if (!s) return;
    if (s === 'sword' || s === 'bow') {
      out.push(this.add(this.ui.add.image(x, y, 'ui_dmg').setScale(size / 64)));
      out.push(
        this.add(text(this.ui, x + size * 0.62, y - size * 0.5, String(damageOf(g, id)), Math.round(size * 0.8))),
      );
    } else {
      out.push(this.add(this.ui.add.image(x, y, 'ui_shield2').setScale(size / 56)));
      out.push(
        this.add(text(this.ui, x + size * 0.62, y - size * 0.5, String(shieldOf(g, id)), Math.round(size * 0.8))),
      );
    }
  }

  /** Rebuild the pictures when what she wears or has changed. */
  private rebuild(): void {
    const g = this.g;
    for (const b of this.bits) b.destroy();
    this.bits = [];
    const w = worn(g);
    // the four slots
    for (const s of SLOTS) {
      const at = SLOT_AT[s];
      const id = w[s];
      if (id) {
        this.bits.push(this.add(icon(this.ui, id, at.x, at.y, SZ - 30)));
        for (const o of glint(this.ui, at.x, at.y, SZ - 30, plusOf(g, id))) this.bits.push(this.add(o));
        this.stat(id, at.x - 30, at.y + SZ / 2 + 44, 46, this.bits);
      } else this.bits.push(this.add(icon(this.ui, HOLDER[s], at.x, at.y, SZ - 50).setAlpha(0.18)));
    }
    // her shield hearts in all, under her feet
    const sh = Math.ceil(shieldMax(g) / 2);
    for (let i = 0; i < sh; i++)
      this.bits.push(this.add(this.ui.add.image(HERO_X - ((sh - 1) * 60) / 2 + i * 60, FEET_Y + 90, 'ui_shield2')));
    // the list of every piece she has
    this.list = owned(g);
    this.emptyT.setVisible(!this.list.length);
    this.list.forEach((id, i) => {
      const x = LIST_X + (i % COLS) * PITCH + CELL / 2;
      const y = LIST_Y + Math.floor(i / COLS) * PITCH + CELL / 2;
      this.bits.push(this.add(icon(this.ui, id, x, y, CELL - 36)));
      for (const o of glint(this.ui, x, y, CELL - 36, plusOf(g, id))) this.bits.push(this.add(o));
      if (w[slotOf(g, id)!] === id)
        this.bits.push(this.add(this.ui.add.image(x - CELL / 2 + 22, y - CELL / 2 + 22, 'ui_tick').setScale(0.6)));
    });
    if (this.col === 2 && !this.list.length) this.col = 0;
    if (this.col === 2) this.move(0, 0);
    this.dressHero(w);
  }

  /** What she wears, drawn on her: the helmet on her head, the armour on her chest, the sword and bow at her sides. */
  private dressHero(w: Record<GearSlot, string>): void {
    for (const b of this.wornBits) b.destroy();
    this.wornBits = [];
    const p = this.hero;
    if (!p) return;
    const body = p.bodyPx;
    const top = FEET_Y - body;
    const put = (id: string, x: number, y: number, size: number, angle = 0) => {
      if (!id) return;
      const im = icon(this.ui, id, x, y, size).setAngle(angle).setDepth(72);
      this.wornBits.push(im);
    };
    put(w.armour, HERO_X, top + body * 0.58, body * 0.3);
    // the helmet as the world draws it: on the top of her head, frame by frame
    p.setHat(w.helmet ? frameFor(this.ui, w.helmet, 96, 96) : null);
    put(w.sword, HERO_X + body * 0.3, top + body * 0.62, body * 0.3, 20);
    put(w.bow, HERO_X - body * 0.32, top + body * 0.58, body * 0.3, -10);
  }

  private drawSel(): void {
    const b = this.box;
    b.clear();
    const w = worn(this.g);
    for (const s of SLOTS) {
      const at = SLOT_AT[s];
      const on = this.slotAt() === s;
      slot(b, at.x - SZ / 2, at.y - SZ / 2, SZ, on, w[s] ? 0xf7dca0 : 0xf3e6c8);
    }
    this.list.forEach((_id, i) => {
      const x = LIST_X + (i % COLS) * PITCH;
      const y = LIST_Y + Math.floor(i / COLS) * PITCH;
      slot(b, x, y, CELL, this.col === 2 && this.row * COLS + this.lcol === i);
    });
  }

  /** The box at the bottom right: the name of what the pointer is on, what it does, and what Space will do. */
  private drawInfo(): void {
    const g = this.g;
    for (const b of this.infoBits) b.destroy();
    this.infoBits = [];
    const s = this.slotAt();
    const id = s ? worn(g)[s] : this.pieceAt();
    if (!id) {
      this.nameT.setText(s ? `${s.charAt(0).toUpperCase()}${s.slice(1)}: nothing on` : '');
      this.infoT.setText('');
      return;
    }
    const d = g.c.items[id];
    const p = plusOf(g, id);
    const name = d ? d.name.charAt(0).toUpperCase() + d.name.slice(1) : id;
    this.nameT.setText(p ? `${name} +${p}` : name);
    this.stat(id, LIST_X + this.nameT.width + 70, 818, 46, this.infoBits);
    const on = worn(g)[slotOf(g, id)!] === id;
    const S = g.c.strings;
    if (touchState.shown) this.infoT.setText((on ? S.touch_gear_off : S.touch_gear_on) ?? '');
    else this.infoT.setText(on ? 'Space: take it off' : 'Space: put it on');
  }

  /** Touch: the Bag tab goes back to the bag (issue 58). Elsewhere a tap moves to the slot or piece under it. */
  tap(x: number, y: number): boolean {
    const b = this.bagBox;
    if (!within(x, y, b.x, b.y, b.w, b.h, 12)) return false;
    this.bagTap = true;
    return true;
  }

  update(dt: number): void {
    this.t += dt;
    const g = this.g;
    if (g.s.hero !== this.heroId) this.makeHero();
    const w = worn(g);
    const key = `${SLOTS.map((s) => w[s]).join(',')}|${owned(g).join(',')}|${JSON.stringify(g.s.plus ?? {})}`;
    const changed = key !== this.key;
    if (changed) {
      if (this.key) {
        this.cheerT = 1.2;
        Sound.sfx('pick');
      }
      this.key = key;
      this.rebuild();
    }
    const n = this.nav(dt);
    if (n.x || n.y) this.move(n.x, n.y);
    if (this.act()) {
      const s = this.slotAt();
      if (s) {
        if (w[s]) this.keys.send({ c: 'unwear', slot: s });
        else Sound.sfx('nope');
      } else {
        const id = this.pieceAt();
        const ps = id ? slotOf(g, id) : null;
        if (!id || !ps) Sound.sfx('nope');
        else if (w[ps] === id) this.keys.send({ c: 'unwear', slot: ps });
        else this.keys.send({ c: 'wear', item: id });
      }
    }
    const bagTap = this.bagTap;
    this.bagTap = false;
    if (this.keys.take('KeyQ') || bagTap) {
      this.ui.open('bag', 'bag');
      return;
    }
    if (this.back() || this.keys.take('KeyE')) this.done = true;
    this.drawSel();
    if (n.x || n.y || changed || this.t < 0.05) this.drawInfo();
    // her hero: a little cheer when she puts something on, then idle
    const p = this.hero;
    if (p) {
      this.cheerT -= dt;
      p.play(this.cheerT > 0 ? 'cheer' : 'idle', 'down');
      p.update(dt);
    }
  }

  close(): void {
    this.hero?.destroy();
    this.hero = null;
    for (const b of this.wornBits) b.destroy();
    super.close();
  }
}

register('gear', (ui) => new GearMenu(ui));
