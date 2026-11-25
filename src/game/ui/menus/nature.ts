// The teacher's Nature Table: a shelf for each kind of find, with what she has collected and how many are still to come.
import type Phaser from 'phaser';
import type { StickerDef, StickerPage } from '../../../core/types.ts';
import type { UI } from '../../scenes/UI.ts';
import { icon, INK, panel, SOFT, text, title, W } from '../kit.ts';
import { Menu } from '../menu.ts';
import { register } from '../registry.ts';

const SHELVES: { page: StickerPage; name: string }[] = [
  { page: 'beach', name: 'Beach finds' },
  { page: 'flowers', name: 'Flowers' },
  { page: 'ores', name: 'Rocks and ores' },
];
const DARK = 0x1c1626;

export class NatureMenu extends Menu {
  private pics: Phaser.GameObjects.Image[] = [];

  constructor(ui: UI) {
    super(ui, 'X: back');
    const g = this.g;
    panel(this.g2, 100, 50, W - 200, 960);
    this.add(title(ui, W / 2, 66, 'Nature Table', 58).setOrigin(0.5, 0));
    let left = 0;
    const rowH = 210;
    SHELVES.forEach((sh, r) => {
      const list: StickerDef[] = Object.values(g.c.stickers).filter((s) => s.page === sh.page);
      const have = list.filter((s) => g.s.stickers[s.id]).length;
      left += list.length - have;
      const y = 150 + r * rowH;
      this.add(text(ui, 150, y, sh.name, 36, INK));
      this.add(text(ui, W - 150, y + 2, `${have} of ${list.length}`, 34, SOFT).setOrigin(1, 0));
      this.g2.fillStyle(0xa8794a, 1).fillRoundedRect(140, y + 150, W - 280, 22, 8);
      const size = Math.min(100, Math.floor((W - 300) / Math.max(1, list.length)) - 8);
      list.forEach((s, i) => {
        const x = 150 + size / 2 + i * (size + 8);
        const pic = this.add(icon(ui, s.art, x, y + 100, size));
        if (!g.s.stickers[s.id]) pic.setTintFill(DARK).setAlpha(0.55);
        this.pics.push(pic);
      });
      if (!list.length) this.add(text(ui, 150, y + 70, 'Nothing here yet.', 32, SOFT));
    });
    this.add(
      text(ui, W / 2, 960 - 30, left > 0 ? `${left} still to find!` : 'You found everything!', 40, '#b3541e').setOrigin(
        0.5,
        0,
      ),
    );
  }

  /** Touch: a page to look at; any tap closes it, as any of its keys does. */
  tap(): boolean {
    this.done = true;
    return true;
  }

  update(dt: number): void {
    this.t += dt;
    this.nav(dt);
    if (this.back() || this.act() || this.keys.take('KeyE')) this.done = true;
  }
}

register('nature', (ui) => new NatureMenu(ui));
