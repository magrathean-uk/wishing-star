// Base for every menu: a dimmed screen, a tidy list of things to destroy on close, and keyboard helpers.
import type Phaser from 'phaser';
import type { Game } from '../../core/types.ts';
import { Sound } from '../audio.ts';
import type { Keys } from '../input.ts';
import { Repeater, touchState } from '../input.ts';
import type { UI } from '../scenes/UI.ts';
import { H, LAYER, outlined, W } from './kit.ts';

export abstract class Menu {
  done = false;
  protected ui: UI;
  protected keys: Keys;
  protected root: Phaser.GameObjects.Container;
  protected g2: Phaser.GameObjects.Graphics;
  private rx = new Repeater();
  private ry = new Repeater();
  protected t = 0;
  /** the key help line at the bottom, for menus whose keys change with the page */
  protected helpT: Phaser.GameObjects.Text | null = null;

  constructor(ui: UI, help = 'Arrows: move    Space: choose    X: back') {
    this.ui = ui;
    this.keys = ui.keys;
    this.root = ui.add.container(0, 0).setDepth(LAYER.menu);
    const dim = ui.add.rectangle(0, 0, W, H, 0x10131f, 0.62).setOrigin(0, 0);
    this.g2 = ui.add.graphics();
    this.root.add([dim, this.g2]);
    if (help) {
      this.helpT = outlined(ui, W / 2, H - 62, help, 28).setOrigin(0.5, 0);
      // on an iPad the keys line names keys she does not have: the buttons say Pick and Back instead (package 65)
      if (touchState.shown) this.helpT.setVisible(false);
      this.root.add(this.helpT);
    }
  }
  /**
   * Touch (package 65): a menu may answer a tap itself (x and y on the 1920 x 1080 screen) and return true. Without
   * it, src/game/touch.ts moves to the row or cell under the finger with the arrow keys and picks it with Space, and
   * a tap outside the menu's panels is X.
   */
  tap?(x: number, y: number): boolean;
  get g(): Game {
    return this.ui.g;
  }
  protected add<T extends Phaser.GameObjects.GameObject>(o: T): T {
    this.root.add(o);
    return o;
  }
  /** One move per press, then a slow repeat while held: -1, 0 or 1 on each axis. */
  protected nav(dt: number): { x: number; y: number } {
    const x = this.rx.step(this.keys.rawX(), dt);
    const y = this.ry.step(this.keys.rawY(), dt);
    if (x || y) Sound.sfx('tick');
    return { x, y };
  }
  /** Touch (package 67): a tap that picks the chosen thing; the next act() answers it once, as Space would. */
  protected tapPick = false;
  protected act(): boolean {
    const t = this.tapPick;
    this.tapPick = false;
    return this.keys.menuAct() || t;
  }
  protected back(): boolean {
    return this.keys.menuBack();
  }
  abstract update(dt: number): void;
  close(): void {
    this.root.destroy(true);
  }
}
export type Overlay = Menu;
/** Touch: is (x, y) inside this box, grown by `pad` on every side. */
export const within = (x: number, y: number, bx: number, by: number, bw: number, bh: number, pad = 0): boolean =>
  x >= bx - pad && x <= bx + bw + pad && y >= by - pad && y <= by + bh + pad;
