// Glossary pictures in the world: when a line on screen first uses a flagged word, its picture pops up in a
// bubble above her head with the word under it, for a few seconds. The rules remember which she has seen.
import type Phaser from 'phaser';
import { firstGloss } from '../../core/gloss.ts';
import type { Game } from '../../core/types.ts';
import glossary from '../../data/glossary.json' with { type: 'json' };
import { Sound } from '../audio.ts';
import { frameFor } from '../assets.ts';

const T = 64;
const SHOW_SECS = 3.5;
const SIZE = 120;

const SHOW: Record<string, string> = {};
for (const [w, d] of Object.entries((glossary as { words: Record<string, { pic: string; show?: boolean }> }).words))
  if (d.show && d.pic) SHOW[w] = d.pic;

export class GlossPicture {
  private last = '';
  private box: Phaser.GameObjects.Container | null = null;
  private t = 0;
  private readonly scene: Phaser.Scene;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  update(g: Game, dt: number): void {
    const text = g.rt.talk?.text ?? '';
    if (text !== this.last) {
      this.last = text;
      const hit = firstGloss(g, text, SHOW);
      if (hit) this.show(g, hit.word, hit.pic);
    }
    if (!this.box) return;
    this.t += dt;
    this.box.setPosition(g.s.x * T, g.s.y * T - 3.2 * T);
    const pop = Math.min(1, this.t / 0.18);
    this.box.setScale(0.6 + 0.4 * pop + (this.t < 0.3 ? Math.sin(this.t * 20) * 0.04 : 0));
    if (this.t > SHOW_SECS) this.box.setAlpha(Math.max(0, 1 - (this.t - SHOW_SECS) / 0.4));
    if (this.t > SHOW_SECS + 0.4) {
      this.box.destroy(true);
      this.box = null;
    }
  }

  private show(g: Game, word: string, pic: string): void {
    this.box?.destroy(true);
    this.t = 0;
    const s = this.scene;
    const bg = s.add.graphics();
    bg.fillStyle(0x000000, 0.2).fillRoundedRect(-SIZE / 2 - 14, -SIZE - 26, SIZE + 28, SIZE + 74, 24);
    bg.fillStyle(0xf2b84b, 1).fillRoundedRect(-SIZE / 2 - 16, -SIZE - 32, SIZE + 32, SIZE + 76, 24);
    bg.fillStyle(0xfff8e7, 1).fillRoundedRect(-SIZE / 2 - 10, -SIZE - 26, SIZE + 20, SIZE + 64, 20);
    const f = frameFor(s, pic, SIZE, SIZE);
    const img = s.add.image(0, -SIZE / 2 - 22, f.key, f.frame);
    const k = SIZE / Math.max(img.width, img.height, 1);
    img.setScale(k);
    const label = s.add
      .text(0, 10, word, { fontFamily: 'Nunito, sans-serif', fontSize: '26px', fontStyle: '800', color: '#3b2a1a' })
      .setOrigin(0.5, 0.5);
    this.box = s.add.container(g.s.x * T, g.s.y * T - 3.2 * T, [bg, img, label]).setDepth(9000);
    Sound.sfx('pick', 0.6);
  }
}
