// Package 73b (I4): the game's usual "new" mark (the bobbing star people wear when they have something for her) over
// the Post Office door and its counter while post waits. It also keeps the December post's date fresh for the rules.
import type Phaser from 'phaser';
import { postNew } from '../../core/post.ts';
import { postNow } from '../app.ts';
import type { UI } from '../scenes/UI.ts';

const T = 64;
/** Where the mark stands, by area: the Post Office's door on the island, the counter inside (tile, then lift). */
const SPOTS: Record<string, [number, number]> = { island: [93.5, 50.4], post_in: [5.5, 2.2] };

export class PostMark {
  private img: Phaser.GameObjects.Image;
  private t = 0;
  /** seconds to the next look at the date and the post */
  private next = 0;
  private waiting = false;

  private readonly ui: UI;

  constructor(ui: UI) {
    this.ui = ui;
    this.img = ui.add.image(0, 0, 'fx_star').setVisible(false).setScale(0.9);
  }

  update(dt: number, show: boolean): void {
    const g = this.ui.g;
    this.t += dt;
    if ((this.next -= dt) <= 0) {
      this.next = 2;
      postNow(g);
      this.waiting = postNew(g);
    }
    const at = SPOTS[g.s.area];
    if (!show || !this.waiting || !at) {
      this.img.setVisible(false);
      return;
    }
    const p = this.ui.world.toScreen(at[0] * T, at[1] * T);
    this.img
      .setVisible(p.x > -40 && p.x < 1960 && p.y > -40 && p.y < 1120)
      .setPosition(p.x, p.y + Math.sin(this.t * 5) * 6);
  }
}
