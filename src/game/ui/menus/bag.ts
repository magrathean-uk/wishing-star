// The bag (key E) and the chest: the hotbar, the 36 bag slots, the pouch, and a chest beside them when one is open.
import type Phaser from 'phaser';
import { BAG_SLOTS, CHEST_SLOTS, HOTBAR } from '../../../core/bag.ts';
import { moveAllowed, pinned } from '../../../core/tidy.ts';
import type { Slot } from '../../../core/types.ts';
import { Sound } from '../../audio.ts';
import { touchState } from '../../input.ts';
import type { UI } from '../../scenes/UI.ts';
import { GOLD, H, icon, INK, panel, setIcon, slot, SOFT, text, title, type Txt, W } from '../kit.ts';
import { glint, plusOf } from '../gear.ts';
import { Menu, within } from '../menu.ts';
import { register } from '../registry.ts';

const SZ = 76;
const PITCH = 84;
const BAG_COLS = 9;
const CHEST_COLS = 8;

type Zone = 'bag' | 'chest';
interface Cell {
  x: number;
  y: number;
  pic: Phaser.GameObjects.Image;
  num: Txt;
}

export class BagMenu extends Menu {
  private chestId: string | null;
  private zone: Zone = 'bag';
  private sel = 0;
  private held: number | null = null;
  private bagCells: Cell[] = [];
  private chestCells: Cell[] = [];
  private box: Phaser.GameObjects.Graphics;
  private nameT: Txt;
  private descT: Txt;
  private gemT: Txt;
  private pouchX = 0;
  private pouchObjs: Phaser.GameObjects.GameObject[] = [];
  private pouchKey = '';
  private bagX: number;
  private bagY = 250;
  private chestX = 0;

  /** package 71: the numbers 1 to 8 on the bottom row */
  private hotNums: Txt[] = [];
  /** package 74 (I11): the touch Tidy button's box, and a short line in place of the description for a moment */
  private tidyBox = { x: 0, y: 0, w: 0, h: 0 };
  private tidyT: Txt | null = null;
  /** issue 58: the Gear tab beside the title, and a tap on it (the Gear page opens on the next step, as Q does) */
  private gearBox = { x: 0, y: 0, w: 0, h: 0 };
  private gearTap = false;
  private sayT = 0;
  private pinG: Phaser.GameObjects.Graphics;

  constructor(ui: UI, chest?: string) {
    // package 71 (D78, G: "no way to swap the buttons on the bottom"): 1 to 8 puts a thing on a bottom button
    const keys = ui.g.c.strings.bag_keys ?? '';
    // package 74 (I11): T tidies the bag, N pins a thing to its bottom button
    const tidy = ui.g.c.strings.bag_tidy_keys ?? '';
    super(
      ui,
      chest
        ? `Arrows: move    Space: move stack across    ${keys}    X: back`
        : `Arrows: move    Space: pick up or drop    ${keys}    ${tidy}    R: eat    Q: gear    X: back`,
    );
    this.chestId = chest && ui.g.s.chests[chest] ? chest : null;
    const withChest = !!this.chestId;
    const bagW = BAG_COLS * PITCH + 40;
    const chestW = CHEST_COLS * PITCH + 40;
    const pouchW = 520;
    const total = withChest ? bagW + chestW + 40 : bagW + pouchW + 40;
    const left = Math.round((W - total) / 2);
    this.bagX = left + 20;
    panel(this.g2, left, 90, bagW, 740);
    this.add(title(ui, left + 30, 104, 'Bag', 48));
    // the Gear page is the bag's second page (Q, or a tap on its tab)
    if (!chest) {
      this.gearBox = { x: left + 138, y: 104, w: 128, h: 60 };
      if (touchState.shown) {
        // on touch it looks like a button, as Tidy does
        const b = this.gearBox;
        this.g2.fillStyle(0xf7dca0, 1).fillRoundedRect(b.x, b.y, b.w, b.h, 16);
        this.g2.lineStyle(4, 0xb7791f, 1).strokeRoundedRect(b.x, b.y, b.w, b.h, 16);
        this.add(text(ui, b.x + b.w / 2, 112, 'Gear', 34, '#7a4a12').setOrigin(0.5, 0));
      } else this.add(text(ui, left + 150, 114, 'Gear', 36, SOFT));
    }
    this.gemT = this.add(text(ui, left + bagW - 40, 112, '', 38, '#0d6a35').setOrigin(1, 0));
    // package 74 (I11): on touch, a Tidy button beside the title
    if (!chest && touchState.shown) {
      this.tidyBox = { x: left + 290, y: 104, w: 150, h: 60 };
      this.g2.fillStyle(0xf7dca0, 1).fillRoundedRect(this.tidyBox.x, this.tidyBox.y, 150, 60, 16);
      this.g2.lineStyle(4, 0xb7791f, 1).strokeRoundedRect(this.tidyBox.x, this.tidyBox.y, 150, 60, 16);
      this.tidyT = this.add(text(ui, this.tidyBox.x + 75, 112, ui.g.c.strings.touch_tidy ?? 'Tidy', 34, '#7a4a12'));
      this.tidyT.setOrigin(0.5, 0);
    }
    // the top row is the bottom bar of the game: boxed and named, with its button numbers
    this.add(text(ui, this.bagX, 168, ui.g.c.strings.bag_bottom ?? 'Bottom buttons', 30, '#7a4a12'));
    if (withChest) {
      this.chestX = left + bagW + 40;
      panel(this.g2, this.chestX, 90, chestW, 740);
      this.add(title(ui, this.chestX + 30, 104, 'Chest', 48));
      this.chestX += 20;
    } else {
      const px = left + bagW + 40;
      panel(this.g2, px, 90, pouchW, 740);
      this.add(title(ui, px + 30, 104, 'Pouch', 48));
      this.pouchX = px + 40;
    }
    panel(this.g2, left, 850, total, 150, 0xfff3d0);
    this.nameT = this.add(text(ui, left + 40, 868, '', 40));
    this.descT = this.add(text(ui, left + 40, 920, '', 32, SOFT, total - 80));
    this.box = this.add(ui.add.graphics());
    for (let i = 0; i < BAG_SLOTS; i++) {
      const p = this.bagPos(i);
      this.bagCells.push(this.makeCell(p.x, p.y));
      if (i < HOTBAR) {
        const n = this.add(text(ui, p.x + 8, p.y + 2, String(i + 1), 24, '#7a4a12'));
        n.setStroke('#fff8e7', 5);
        this.hotNums.push(n);
      }
    }
    // the pins go over the pictures
    this.pinG = this.add(ui.add.graphics());
    if (withChest) {
      for (let i = 0; i < CHEST_SLOTS; i++) {
        const p = this.chestPos(i);
        this.chestCells.push(this.makeCell(p.x, p.y));
      }
    }
    void H;
  }

  private bagPos(i: number): { x: number; y: number } {
    if (i < HOTBAR) return { x: this.bagX + i * PITCH, y: this.bagY - 40 };
    const j = i - HOTBAR;
    return { x: this.bagX + (j % BAG_COLS) * PITCH, y: this.bagY + 70 + Math.floor(j / BAG_COLS) * PITCH };
  }
  private chestPos(i: number): { x: number; y: number } {
    return { x: this.chestX + (i % CHEST_COLS) * PITCH, y: 180 + Math.floor(i / CHEST_COLS) * PITCH };
  }
  private makeCell(x: number, y: number): Cell {
    const pic = this.add(icon(this.ui, 'stick', x + SZ / 2, y + SZ / 2, SZ - 16)).setVisible(false);
    const num = this.add(text(this.ui, x + SZ - 6, y + SZ - 32, '', 28, INK).setOrigin(1, 0));
    num.setStroke('#fff8e7', 6);
    return { x, y, pic, num };
  }

  private slots(z: Zone): (Slot | null)[] {
    return z === 'bag' ? this.g.s.bag : this.g.s.chests[this.chestId!]!;
  }

  /** Column and row of a bag slot, and the first slot of each row. */
  private rowOf(i: number): { row: number; col: number } {
    if (i < HOTBAR) return { row: 0, col: i };
    const j = i - HOTBAR;
    return { row: 1 + Math.floor(j / BAG_COLS), col: j % BAG_COLS };
  }
  private bagIndex(row: number, col: number): number {
    if (row === 0) return Math.min(col, HOTBAR - 1);
    return Math.min(HOTBAR + (row - 1) * BAG_COLS + Math.min(col, BAG_COLS - 1), BAG_SLOTS - 1);
  }

  private move(dx: number, dy: number): void {
    if (this.zone === 'bag') {
      const { row, col } = this.rowOf(this.sel);
      const rows = 1 + Math.ceil((BAG_SLOTS - HOTBAR) / BAG_COLS);
      if (dx) {
        const len = row === 0 ? HOTBAR : BAG_COLS;
        if (this.chestId && dx > 0 && col === len - 1) {
          this.zone = 'chest';
          this.sel = Math.min(Math.max(0, row - 1), 5) * CHEST_COLS;
        } else this.sel = this.bagIndex(row, (col + dx + len) % len);
      }
      if (dy) this.sel = this.bagIndex((row + dy + rows) % rows, col);
    } else {
      const col = this.sel % CHEST_COLS;
      const row = Math.floor(this.sel / CHEST_COLS);
      if (dx) {
        if (dx < 0 && col === 0) {
          this.zone = 'bag';
          this.sel = this.bagIndex(Math.min(row + 1, 5), BAG_COLS - 1);
        } else this.sel = row * CHEST_COLS + ((col + dx + CHEST_COLS) % CHEST_COLS);
      }
      if (dy) this.sel = ((row + dy + 6) % 6) * CHEST_COLS + col;
    }
  }

  private fillCells(cells: Cell[], list: (Slot | null)[], z: Zone): void {
    const g = this.g;
    const b = this.box;
    if (z === 'bag') {
      // the bottom buttons' box
      b.lineStyle(4, 0xb7791f, 1);
      b.strokeRoundedRect(this.bagX - 8, this.bagY - 48, (HOTBAR - 1) * PITCH + SZ + 16, SZ + 16, 18);
    }
    cells.forEach((c, i) => {
      const s = list[i] ?? null;
      const here = this.zone === z && this.sel === i;
      const isHeld = z === 'bag' && this.held === i;
      slot(b, c.x, c.y, SZ, here, isHeld ? 0xcfe9ff : i < HOTBAR && z === 'bag' ? 0xf7dca0 : 0xf3e6c8);
      if (z === 'bag' && i === g.s.hot) {
        b.lineStyle(5, 0xff7a3a, 1);
        b.strokeRoundedRect(c.x - 3, c.y - 3, SZ + 6, SZ + 6, 16);
      }
      // package 74 (I11): a small pin on a pinned bottom button
      if (z === 'bag' && i < HOTBAR && pinned(g, i)) {
        const p = this.pinG;
        p.lineStyle(4, 0x5a3a1a, 1).lineBetween(c.x + SZ - 10, c.y + 8, c.x + SZ - 20, c.y + 22);
        p.fillStyle(0xe0403a, 1).fillCircle(c.x + SZ - 9, c.y + 6, 10);
        p.lineStyle(2, 0x7a1d1d, 1).strokeCircle(c.x + SZ - 9, c.y + 6, 10);
        p.fillStyle(0xffffff, 0.85).fillCircle(c.x + SZ - 12, c.y + 3, 3);
      }
      if (s && g.c.items[s.id]) {
        setIcon(this.ui, c.pic, s.id, SZ - 16);
        c.pic.setVisible(true).setAlpha(isHeld ? 0.5 : 1);
        const t = s.n > 1 ? String(s.n) : '';
        if (c.num.text !== t) c.num.setText(t);
      } else {
        c.pic.setVisible(false);
        if (c.num.text) c.num.setText('');
      }
    });
  }

  private drawPouch(): void {
    const g = this.g;
    const ids = Object.keys(g.s.pouch).filter((id) => g.s.pouch[id]! > 0 && g.c.items[id]);
    const key = ids.map((id) => `${id}:${g.s.pouch[id]}:${plusOf(g, id)}`).join(',');
    if (key === this.pouchKey) return;
    this.pouchKey = key;
    for (const o of this.pouchObjs) o.destroy();
    this.pouchObjs = [];
    if (!ids.length) {
      this.pouchObjs.push(this.add(text(this.ui, this.pouchX, 200, 'Tools and keys\nwill go here.', 34, SOFT)));
      return;
    }
    // rows shrink to fit the panel (it ends at 830); past 15 things the last row says how many more
    const fit = 15;
    const shown = ids.length > fit ? ids.slice(0, fit - 1) : ids;
    const rows = shown.length + (ids.length > fit ? 1 : 0);
    const pitch = Math.max(40, Math.min(60, Math.floor(620 / rows)));
    const font = Math.max(24, Math.round(pitch * 0.57));
    const ic = Math.round(pitch * 0.85);
    shown.forEach((id, i) => {
      const y = 186 + i * pitch;
      const n = g.s.pouch[id]!;
      this.pouchObjs.push(this.add(icon(this.ui, id, this.pouchX + ic / 2, y + pitch / 2 - 4, ic)));
      // an upgraded sword or bow glints here too
      for (const o of glint(this.ui, this.pouchX + ic / 2, y + pitch / 2 - 4, ic, plusOf(g, id)))
        this.pouchObjs.push(this.add(o));
      this.pouchObjs.push(
        this.add(
          text(
            this.ui,
            this.pouchX + ic + 18,
            y + (pitch - font * 1.3) / 2 - 4,
            `${g.c.items[id]!.name}${n > 1 ? '  x' + n : ''}`,
            font,
            INK,
          ),
        ),
      );
    });
    if (ids.length > fit)
      this.pouchObjs.push(
        this.add(
          text(this.ui, this.pouchX, 186 + shown.length * pitch, `and ${ids.length - shown.length} more`, font, SOFT),
        ),
      );
  }

  /** Package 71: send the held thing, or the one under the cursor, to bottom button `to` (0 to 7). */
  private toButton(to: number, cur: Slot | null): void {
    const from = this.held ?? (this.zone === 'bag' && cur ? this.sel : -1);
    if (from < 0 || !this.g.s.bag[from]) {
      Sound.sfx('nope');
      return;
    }
    if (from !== to && !moveAllowed(this.g, from, to)) {
      this.stays();
      return;
    }
    if (from !== to) this.keys.send({ c: 'move', from, to });
    this.held = null;
    this.zone = 'bag';
    this.sel = to;
    Sound.sfx('pick');
  }

  /**
   * Touch (package 71): a thing dragged in the bag and let go on a bottom button goes there, swapping what was there.
   * The x and y are on the 1920 x 1080 screen; false when the drag did not start on a thing or end on a button.
   */
  drop(x0: number, y0: number, x1: number, y1: number): boolean {
    const at = (x: number, y: number): number => {
      for (let i = 0; i < BAG_SLOTS; i++) {
        const c = this.bagCells[i]!;
        if (x >= c.x && x <= c.x + SZ && y >= c.y && y <= c.y + SZ) return i;
      }
      return -1;
    };
    const from = at(x0, y0);
    const to = at(x1, y1);
    if (from < 0 || to < 0 || to >= HOTBAR || from === to || !this.g.s.bag[from]) return false;
    if (!moveAllowed(this.g, from, to)) {
      this.stays();
      return true;
    }
    this.keys.send({ c: 'move', from, to });
    this.held = null;
    this.zone = 'bag';
    this.sel = to;
    Sound.sfx('pick');
    return true;
  }

  /** Package 74: a pinned thing stays put: a "no" and a short line saying so. */
  private stays(): void {
    Sound.sfx('nope');
    this.held = null;
    this.sayT = 2;
  }

  /** Package 74 (I11): sort the bag. */
  private tidy(): void {
    this.held = null;
    this.keys.send({ c: 'tidy' });
  }

  /** Package 74 (I11): pin or unpin the thing on bottom button i. */
  private pin(i: number): boolean {
    if (i < 0 || i >= HOTBAR || !this.g.s.bag[i]) {
      Sound.sfx('nope');
      return false;
    }
    this.keys.send({ c: 'pin', slot: i });
    return true;
  }

  /** Touch: the Gear tab (issue 58) and the Tidy button (package 74). Elsewhere the menu's own taps work as before. */
  tap(x: number, y: number): boolean {
    const gb = this.gearBox;
    if (gb.w && within(x, y, gb.x, gb.y, gb.w, gb.h, 12)) {
      this.gearTap = true;
      return true;
    }
    const b = this.tidyBox;
    if (!this.tidyT || x < b.x || x > b.x + b.w || y < b.y || y > b.y + b.h) return false;
    this.tidy();
    return true;
  }

  /** Touch (package 74): a long press on a bottom button pins or unpins the thing on it. */
  hold(x: number, y: number): boolean {
    for (let i = 0; i < HOTBAR; i++) {
      const c = this.bagCells[i]!;
      if (x >= c.x && x <= c.x + SZ && y >= c.y && y <= c.y + SZ) {
        this.zone = 'bag';
        this.sel = i;
        return this.pin(i);
      }
    }
    return false;
  }

  update(dt: number): void {
    this.t += dt;
    const g = this.g;
    const n = this.nav(dt);
    if (n.x || n.y) this.move(n.x, n.y);
    const list = this.slots(this.zone);
    const cur = list[this.sel] ?? null;
    if (this.act()) {
      if (this.chestId) {
        if (cur) this.keys.send({ c: 'chest', chest: this.chestId, from: this.sel, toChest: this.zone === 'bag' });
        else Sound.sfx('nope');
      } else if (this.held === null) {
        if (cur) {
          this.held = this.sel;
          Sound.sfx('pick');
        } else Sound.sfx('nope');
      } else if (this.held !== this.sel && !moveAllowed(g, this.held, this.sel)) this.stays();
      else {
        if (this.held !== this.sel) this.keys.send({ c: 'move', from: this.held, to: this.sel });
        this.held = null;
        Sound.sfx('pick');
      }
    }
    // 1 to 8: the thing picked up (or under the cursor) goes to that bottom button, swapping what was there
    const digit = this.keys.takeDigit();
    if (digit >= 0) this.toButton(digit, cur);
    if (!this.chestId && this.keys.take('KeyT')) this.tidy();
    if (!this.chestId && this.keys.take('KeyN')) this.pin(this.zone === 'bag' ? this.sel : -1);
    if (this.zone === 'bag' && this.keys.take('KeyR')) {
      const d = cur ? g.c.items[cur.id] : undefined;
      if (d?.heal) this.keys.send({ c: 'eat', slot: this.sel });
      else Sound.sfx('nope');
    }
    if (this.back()) {
      if (this.held !== null) this.held = null;
      else this.done = true;
    }
    if (this.keys.take('KeyE')) this.done = true;
    const gearTap = this.gearTap;
    this.gearTap = false;
    if (!this.chestId && (gearTap || (this.held === null && this.keys.take('KeyQ')))) {
      this.held = null;
      this.ui.open('gear');
      return;
    }

    this.box.clear();
    this.pinG.clear();
    this.fillCells(this.bagCells, g.s.bag, 'bag');
    if (this.chestId) this.fillCells(this.chestCells, this.slots('chest'), 'chest');
    const s = this.slots(this.zone)[this.sel] ?? null;
    const d = s ? g.c.items[s.id] : undefined;
    this.nameT.setText(d && s ? `${s.n > 1 ? s.n + ' ' : ''}${s.n > 1 ? (d.names ?? d.name + 's') : d.name}` : 'Empty');
    this.sayT = Math.max(0, this.sayT - dt);
    this.descT.setText(
      this.sayT > 0
        ? (g.c.strings.bag_pinned ?? '')
        : d
          ? (d.desc ?? (d.heal ? 'Press R to eat it and get hearts back.' : ''))
          : '',
    );
    this.gemT.setText(`${g.s.emeralds} emeralds`);
    if (!this.chestId) this.drawPouch();
    void GOLD;
  }
}

register('bag', (ui) => new BagMenu(ui));
register('chest', (ui, arg) => new BagMenu(ui, arg));
