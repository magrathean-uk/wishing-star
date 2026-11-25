// The journal (key K): a Friends page of everyone she has met, and three sticker tabs: Creatures, Treasures and
// Places. A page shows what she has and a count ("7 of 16"), never rows of blank shapes. A finished tab has a star.
import type Phaser from 'phaser';
import { JOURNAL_TABS, TAB_PRIZE } from '../../../core/quests.ts';
import { roomsCount } from '../../../core/rooms.ts';
import { charName, fill } from '../../../core/talk.ts';
import type { StickerDef } from '../../../core/types.ts';
import { Sound } from '../../audio.ts';
import { Puppet } from '../../puppet.ts';
import type { UI } from '../../scenes/UI.ts';
import { metIds } from '../friends.ts';
import { GOLD, icon, INK, makeUiTextures, panel, setIcon, SOFT, text, title, type Txt, W } from '../kit.ts';
import { Menu, within } from '../menu.ts';
import { register } from '../registry.ts';

const PAGES = ['friends', ...JOURNAL_TABS] as const;
const LABEL: Record<string, string> = {
  friends: 'Friends',
  creatures: 'Creatures',
  treasures: 'Treasures',
  places: 'Places',
};
/** What to do when a page is still empty. */
const EMPTY: Record<string, string> = {
  friends: 'Say hello to someone!',
  creatures: 'Find an animal or a mob.',
  treasures: 'Look for hidden things.',
  places: 'Go and explore!',
};
const COLS = 6;
const ROWS = 3;
const CW = 215;
const CH = 205;
const GX = 70;
const GY = 270;
const TAB_W = 330;
const TAB_X = (W - PAGES.length * TAB_W) / 2;

/** One thing on a page: a friend's face or a sticker she has. */
interface Entry {
  id: string;
  name: string;
  art: string;
  /** "3 of 10" for a set, or '' */
  note: string;
  /** the character to show standing, for a friend */
  char: string;
}
interface Cell {
  pic: Phaser.GameObjects.Image;
  name: Txt;
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

export class JournalMenu extends Menu {
  private page = 0;
  private sel = 0;
  private top = 0;
  /** the pointer is on the row of tabs (left and right change the page) or in the grid (arrows look around) */
  private inGrid = false;
  private list: Entry[] = [];
  private cells: Cell[] = [];
  private box: Phaser.GameObjects.Graphics;
  private tabs: Txt[] = [];
  private head: Txt;
  private countT: Txt;
  private emptyT: Txt;
  private prizeT: Txt;
  /** package 73a (I13): on the Places page, the buildings she has been inside ("Rooms 4 of 20") */
  private roomsT: Txt;
  private bigPic: Phaser.GameObjects.Image;
  private bigName: Txt;
  private bigNote: Txt;
  private star: Phaser.GameObjects.Image;
  private pup: Puppet | null = null;
  private pupId = '';
  private drawn = '';

  constructor(ui: UI, arg?: string) {
    super(ui, 'X: back');
    makeUiTextures(ui);
    panel(this.g2, 30, 40, W - 60, 960);
    panel(this.g2, 1420, 250, 440, 700, 0xfff3d0);
    this.box = this.add(ui.add.graphics());
    for (const [i, p] of PAGES.entries())
      this.tabs.push(this.add(text(ui, TAB_X + i * TAB_W + TAB_W / 2, 66, LABEL[p]!, 36).setOrigin(0.5, 0)));
    this.head = this.add(title(ui, GX, 170, '', 52));
    this.countT = this.add(text(ui, 1350, 184, '', 40, INK).setOrigin(1, 0));
    this.star = this.add(ui.add.image(0, 206, 'ui_starbig').setScale(0.7).setVisible(false));
    for (let i = 0; i < COLS * ROWS; i++) {
      const x = GX + (i % COLS) * CW;
      const y = GY + Math.floor(i / COLS) * CH;
      const pic = this.add(icon(ui, 'stick', x + CW / 2 - 8, y + 64, 92));
      const name = this.add(
        text(ui, x + CW / 2 - 8, y + 116, '', 25, INK, CW - 24)
          .setOrigin(0.5, 0)
          .setAlign('center'),
      );
      this.cells.push({ pic, name });
    }
    this.emptyT = this.add(text(ui, GX + (COLS * CW) / 2, 500, '', 44, SOFT).setOrigin(0.5, 0));
    this.prizeT = this.add(text(ui, GX, 912, '', 32, SOFT));
    this.roomsT = this.add(text(ui, 1350, 912, '', 32, SOFT).setOrigin(1, 0));
    this.bigPic = this.add(icon(ui, 'stick', 1640, 470, 240));
    this.bigName = this.add(text(ui, 1640, 760, '', 44, INK, 400).setOrigin(0.5, 0).setAlign('center'));
    this.bigNote = this.add(text(ui, 1640, 880, '', 34, '#b3541e').setOrigin(0.5, 0));
    const at = PAGES.indexOf((arg ?? '') as (typeof PAGES)[number]);
    this.page = Math.max(0, at);
    this.load();
  }

  /** What she has on this page, and its count line. */
  private load(): void {
    const g = this.g;
    const p = PAGES[this.page]!;
    this.sel = 0;
    this.top = 0;
    this.inGrid = false;
    this.head.setText(LABEL[p]!);
    let done = false;
    if (p === 'friends') {
      this.list = metIds(g).map((id) => ({ id, name: charName(g, id), art: 'face_' + id, note: '', char: id }));
      this.countT.setText(this.list.length === 1 ? '1 friend' : `${this.list.length} friends`);
      this.prizeT.setText('');
    } else if (p === 'places') {
      // the places she has found (regions and landmarks), from the rules' own record
      const total = Object.keys(g.c.regions).length + Object.keys(g.c.landmarks ?? {}).length;
      this.list = Object.keys(g.s.places ?? {})
        .filter((id) => g.c.regions[id] || g.c.landmarks?.[id])
        .map((id) => {
          const lm = g.c.landmarks?.[id];
          const name = lm?.name ?? g.c.regions[id]!.name;
          const art = g.c.stickers['place_' + id]?.art ?? lm?.art ?? 'map';
          return { id, name: cap(fill(g, name)), art, note: '', char: '' };
        });
      this.countT.setText(`${this.list.length} of ${total}`);
      done = this.prizeLine(p);
    } else {
      const all = Object.values(g.c.stickers).filter((s) => s.page === p && !s.of);
      const parts = (s: StickerDef): string => {
        const set = Object.values(g.c.stickers).filter((x) => x.of === s.id);
        return set.length ? `${set.filter((x) => g.s.stickers[x.id]).length} of ${set.length}` : '';
      };
      this.list = all
        .filter((s) => g.s.stickers[s.id])
        .map((s) => ({ id: s.id, name: cap(fill(g, s.name)), art: s.art, note: parts(s), char: '' }));
      this.countT.setText(`${this.list.length} of ${all.length}`);
      done = this.prizeLine(p);
    }
    const rooms = roomsCount(g);
    const roomLine = (g.c.strings.journal_rooms ?? '')
      .replace('{n}', String(rooms.n))
      .replace('{of}', String(rooms.of));
    this.roomsT.setText(p === 'places' ? roomLine : '').setColor(rooms.n >= rooms.of ? '#b3541e' : SOFT);
    this.star.setVisible(done).setX(1350 - this.countT.width - 44);
    this.emptyT.setText(this.list.length ? '' : `Nothing here yet.\n${EMPTY[p]}`).setAlign('center');
    this.helpT?.setText('');
  }

  /** The prize line under a sticker tab; true when the tab is full. */
  private prizeLine(p: string): boolean {
    const g = this.g;
    const done = !!g.s.flags[`page:${p}`];
    const prize = TAB_PRIZE[p];
    const what = prize?.item ? `a ${g.c.items[prize.item]?.name ?? prize.item}` : `${prize?.emeralds ?? 0} emeralds`;
    this.prizeT.setText(done ? `Page full! You won ${what}.` : `Fill this page to win ${what}.`);
    return done;
  }

  private pupFor(e: Entry | undefined): void {
    const id = e?.char ?? '';
    if (id === this.pupId) return;
    this.pup?.destroy();
    this.pup = null;
    this.pupId = id;
    if (!id) return;
    this.pup = new Puppet(this.ui, id, this.g.c.chars[id]?.tall ?? 2, true);
    this.pup.zoom = 1.7;
    this.pup.setPos(1640, 700);
    this.pup.sprite.setDepth(90);
  }

  /** Touch: a tab turns to that page, a sticker or friend is looked at, outside is back (as X). */
  tap(x: number, y: number): boolean {
    if (!within(x, y, 30, 40, W - 60, 960)) {
      if (this.inGrid) this.inGrid = false;
      else this.done = true;
      return true;
    }
    if (y >= 46 && y <= 130) {
      const i = Math.floor((x - TAB_X) / TAB_W);
      if (i >= 0 && i < PAGES.length && i !== this.page) {
        this.page = i;
        this.load();
        Sound.sfx('tick');
      }
      return true;
    }
    const c = Math.floor((x - GX) / CW);
    const r = Math.floor((y - GY) / CH);
    const at = (this.top + r) * COLS + c;
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS || at >= this.list.length) return true;
    if (at !== this.sel || !this.inGrid) Sound.sfx('tick');
    this.sel = at;
    this.inGrid = true;
    return true;
  }

  update(dt: number): void {
    this.t += dt;
    const n = this.nav(dt);
    const len = this.list.length;
    if (!this.inGrid) {
      if (n.x) {
        this.page = (this.page + n.x + PAGES.length) % PAGES.length;
        this.load();
      } else if ((n.y > 0 || this.act()) && len) this.inGrid = true;
    } else {
      // package 69: Left at a row's first thing and Right at its last change the page, from any row
      const col = this.sel % COLS;
      const end = Math.min(len - 1, this.sel - col + COLS - 1);
      if ((n.x < 0 && col === 0) || (n.x > 0 && this.sel >= end)) {
        this.page = (this.page + n.x + PAGES.length) % PAGES.length;
        this.load();
        this.inGrid = this.list.length > 0;
      } else if (n.x) this.sel = Math.max(0, Math.min(len - 1, this.sel + n.x));
      if (n.y < 0 && this.sel < COLS) this.inGrid = false;
      else if (n.y) this.sel = Math.max(0, Math.min(len - 1, this.sel + n.y * COLS));
    }
    if (this.keys.take('KeyK')) this.done = true;
    else if (this.back()) {
      if (this.inGrid) this.inGrid = false;
      else this.done = true;
    }
    const S = this.g.c.strings;
    const help = this.inGrid
      ? (S.journal_grid ?? '')
      : `${S.journal_tabs ?? ''}${len ? `    ${S.journal_look ?? ''}` : ''}    X: back`;
    this.helpDraw(help);
    const row = Math.floor(this.sel / COLS);
    this.top = Math.max(0, Math.min(row - 1, Math.ceil(len / COLS) - ROWS));
    // the page is drawn again only when something on it changed, not every frame (the Dell laptop, D37)
    const key = `${this.page}|${this.sel}|${this.top}|${this.inGrid}|${len}`;
    if (key !== this.drawn) {
      this.drawn = key;
      this.drawPage();
    }
    if (this.pup) {
      this.pup.play('idle', 'down');
      this.pup.update(dt);
    }
  }

  private drawPage(): void {
    const b = this.box;
    b.clear();
    b.fillStyle(this.inGrid ? 0x8a6a45 : 0x3b2a1a, 1).fillRoundedRect(
      TAB_X + this.page * TAB_W + 10,
      56,
      TAB_W - 20,
      64,
      18,
    );
    this.tabs.forEach((t, i) => {
      t.setColor(i === this.page ? '#ffffff' : INK);
    });
    this.cells.forEach((c, i) => {
      const idx = this.top * COLS + i;
      const e = this.list[idx];
      const x = GX + (i % COLS) * CW;
      const y = GY + Math.floor(i / COLS) * CH;
      c.pic.setVisible(!!e);
      if (!e) {
        if (c.name.text) c.name.setText('');
        return;
      }
      const here = this.inGrid && idx === this.sel;
      b.fillStyle(here ? GOLD : 0xd9c59a, 1).fillRoundedRect(x, y, CW - 16, CH - 14, 18);
      b.fillStyle(0xfffdf2, 1).fillRoundedRect(x + 5, y + 5, CW - 26, CH - 24, 14);
      setIcon(this.ui, c.pic, e.art, 92);
      if (c.name.text !== e.name) c.name.setText(e.name);
    });
    const cur = this.list[this.sel];
    if (cur) {
      setIcon(this.ui, this.bigPic, cur.art, 240);
      if (this.bigName.text !== cur.name) this.bigName.setText(cur.name);
      const note = cur.note ? `${cur.note} found` : '';
      if (this.bigNote.text !== note) this.bigNote.setText(note);
    } else {
      this.bigName.setText('');
      this.bigNote.setText('');
    }
    this.pupFor(cur);
    this.bigPic.setVisible(!!cur && !this.pup);
  }

  private helpDraw(s: string): void {
    if (this.helpT && this.helpT.text !== s) this.helpT.setText(s);
  }

  close(): void {
    this.pup?.destroy();
    this.pup = null;
    super.close();
  }
}

// "stickers" is the old name: anything that still asks for the Sticker Book gets the journal
register('journal', (ui, arg) => new JournalMenu(ui, arg));
register('stickers', (ui, arg) => new JournalMenu(ui, arg));
