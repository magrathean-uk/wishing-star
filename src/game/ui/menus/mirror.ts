// The mirror: every hero stands in a row. Friends she has met are animated puppets; the rest are friendly dark shapes.
import type Phaser from 'phaser';
import { charName } from '../../../core/talk.ts';
import { Sound } from '../../audio.ts';
import { touchState } from '../../input.ts';
import { heroAllowed } from '../../net.ts';
import { Puppet } from '../../puppet.ts';
import type { UI } from '../../scenes/UI.ts';
import { GOLD, INK, panel, SOFT, text, title, type Txt, W } from '../kit.ts';
import { Menu, within } from '../menu.ts';
import { register } from '../registry.ts';

const COLS = 7;
const CW = 250;
const SHADE = 0x1c1626;

export class MirrorMenu extends Menu {
  private ids: string[] = [];
  private puppets: Puppet[] = [];
  private names: Txt[] = [];
  private sel = 0;
  private box: Phaser.GameObjects.Graphics;
  private noteT: Txt;

  constructor(ui: UI) {
    super(ui, 'Arrows: choose    Space: be this hero    X: back');
    const g = this.g;
    panel(this.g2, 40, 60, W - 80, 940);
    this.add(title(ui, W / 2, 80, 'Magic mirror', 60).setOrigin(0.5, 0));
    this.box = this.add(ui.add.graphics());
    this.ids = Object.keys(g.c.heroes).filter(heroAllowed);
    this.sel = Math.max(0, this.ids.indexOf(g.s.hero));
    this.ids.forEach((id, i) => {
      const c = g.c.chars[id];
      const p = new Puppet(ui, id, c?.tall ?? 2, true);
      p.zoom = 1.35;
      p.setPos(this.cx(i), this.fy(i));
      p.sprite.setDepth(90);
      this.puppets.push(p);
      this.names.push(this.add(text(ui, this.cx(i), this.fy(i) + 22, '', 32, INK).setOrigin(0.5, 0)));
    });
    this.noteT = this.add(text(ui, W / 2, 925, '', 36, SOFT).setOrigin(0.5, 0));
  }

  private cx(i: number): number {
    const inRow = Math.min(COLS, this.ids.length - Math.floor(i / COLS) * COLS);
    return W / 2 + ((i % COLS) - (inRow - 1) / 2) * CW;
  }
  private fy(i: number): number {
    return 430 + Math.floor(i / COLS) * 400;
  }

  /** Touch: a hero's card picks them (as Space), outside is back. */
  tap(x: number, y: number): boolean {
    if (!within(x, y, 40, 60, W - 80, 940)) {
      this.done = true;
      return true;
    }
    const i = this.ids.findIndex((_, k) => within(x, y, this.cx(k) - CW / 2 + 8, this.fy(k) - 290, CW - 16, 370, 6));
    if (i < 0) return true;
    if (i !== this.sel) Sound.sfx('tick');
    this.sel = i;
    this.tapPick = true;
    return true;
  }

  update(dt: number): void {
    this.t += dt;
    const g = this.g;
    const n = this.nav(dt);
    const len = this.ids.length;
    if (len) {
      if (n.x) this.sel = (this.sel + n.x + len) % len;
      if (n.y) {
        const next = this.sel + n.y * COLS;
        if (next >= 0 && next < len) this.sel = next;
        else
          this.sel =
            n.y > 0 ? this.sel % COLS : Math.min(len - 1, (Math.ceil(len / COLS) - 1) * COLS + (this.sel % COLS));
      }
    }
    const id = this.ids[this.sel];
    if (this.act() && id) {
      if (!g.s.heroes.includes(id)) Sound.sfx('nope');
      else {
        if (id !== g.s.hero) this.keys.send({ c: 'hero', id });
        this.done = true;
      }
    }
    if (this.back() || this.keys.take('KeyE')) this.done = true;

    const b = this.box;
    b.clear();
    this.puppets.forEach((p, i) => {
      const hid = this.ids[i]!;
      const open = g.s.heroes.includes(hid);
      const here = i === this.sel;
      const x = this.cx(i);
      const y = this.fy(i);
      b.fillStyle(here ? GOLD : 0xd9c59a, 1).fillRoundedRect(x - CW / 2 + 8, y - 290, CW - 16, 370, 20);
      b.fillStyle(here ? 0xfffbe8 : 0xf3e6c8, 1).fillRoundedRect(x - CW / 2 + 13, y - 285, CW - 26, 360, 16);
      p.play(here && open ? 'cheer' : 'idle', 'down');
      p.update(dt);
      if (open) p.sprite.clearTint();
      else p.sprite.setTintFill(SHADE);
      const nm = open ? charName(g, hid) : '???';
      const label = `${hid === g.s.hero ? '* ' : ''}${nm}`;
      if (this.names[i]!.text !== label) this.names[i]!.setText(label);
    });
    const open = !!id && g.s.heroes.includes(id);
    this.noteT.setText(
      !id
        ? ''
        : open
          ? id === g.s.hero
            ? 'This is you now.'
            : touchState.shown
              ? (g.c.strings.touch_swap ?? '')
              : 'Press Space to swap.'
          : 'Meet this friend to unlock them.',
    );
  }

  close(): void {
    for (const p of this.puppets) p.destroy();
    this.puppets = [];
    super.close();
  }
}

register('mirror', (ui) => new MirrorMenu(ui));
