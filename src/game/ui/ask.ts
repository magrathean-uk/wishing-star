// Package 68: a small "are you sure?" box over a menu (the bench before it uses up what the goal needs, a shop before
// a prize or a big price). The kind answer comes first and is chosen; X means that answer too. Taps pick a row.
import type Phaser from 'phaser';
import { Sound } from '../audio.ts';
import type { UI } from '../scenes/UI.ts';
import { CREAM, GOLD, INK, panel, text, title, type Txt, W } from './kit.ts';
import { within } from './menu.ts';

const BW = 760;
const BH = 330;
const BX = W / 2 - BW / 2;
const BY = 360;

export class Ask {
  /** 0: the kind answer (keep), 1: go ahead */
  sel = 0;
  private g: Phaser.GameObjects.Graphics;
  private q: Txt;
  private rows: Txt[];
  private bits: Phaser.GameObjects.GameObject[];

  constructor(
    ui: UI,
    add: <T extends Phaser.GameObjects.GameObject>(o: T) => T,
    question: string,
    no: string,
    yes: string,
  ) {
    this.g = add(ui.add.graphics());
    this.q = add(title(ui, W / 2, BY + 40, question, 38, INK).setOrigin(0.5, 0));
    this.rows = [no, yes].map((s, i) => add(text(ui, W / 2, BY + 150 + i * 80, s, 36, INK).setOrigin(0.5, 0)));
    this.bits = [this.g, this.q, ...this.rows];
    this.draw();
  }

  private draw(): void {
    const g = this.g.clear();
    panel(g, BX, BY, BW, BH, CREAM, GOLD, 24);
    for (let i = 0; i < 2; i++) {
      const y = BY + 140 + i * 80;
      g.fillStyle(i === this.sel ? GOLD : 0xe8d9b5, 1).fillRoundedRect(BX + 80, y, BW - 160, 64, 18);
    }
  }

  /** One step: arrows choose, Space picks, X is the kind answer. 'yes', 'no' or null while it waits. */
  step(ny: number, act: boolean, back: boolean): 'yes' | 'no' | null {
    if (ny) {
      this.sel = this.sel ? 0 : 1;
      this.draw();
    }
    if (back) return 'no';
    if (act) return this.sel ? 'yes' : 'no';
    return null;
  }

  /** A tap on a row chooses it (the next act() picks it); outside the box is the kind answer. */
  tap(x: number, y: number): 'pick' | 'no' {
    if (!within(x, y, BX, BY, BW, BH)) return 'no';
    const i = y >= BY + 140 + 80 ? 1 : 0;
    if (i !== this.sel) Sound.sfx('tick');
    this.sel = i;
    this.draw();
    return 'pick';
  }

  /** Back on top of the menu's things after the menu drew itself again. */
  raise(c: Phaser.GameObjects.Container): void {
    for (const b of this.bits) c.bringToTop(b);
  }

  destroy(): void {
    for (const b of this.bits) b.destroy();
  }
}
