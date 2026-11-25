// Gold rings on the ground (G, 22 Nov 2026): where Space starts a mini-game, and where a place step's thing goes, with a
// faint ghost of that thing. The rules are in src/core/spots.ts; this only draws them. One texture made once and a small
// pool of images, so nothing is made per frame.
import type Phaser from 'phaser';
import { joinSpots, placeSpot } from '../../core/spots.ts';
import type { Game } from '../../core/types.ts';
import { PLACED_ART, worldFrame } from '../assets.ts';

const T = 64;
const TEX = 'fx_goldring';
/** the texture's size and the ring's radius in it */
const SIZE = 160;
const RAD = 70;
/** on the ground: above flat things on the floor, under everyone's feet */
const DEPTH = -595;

function makeTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(TEX)) return;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  const c = SIZE / 2;
  // a faint gold floor inside, so the whole round reads as "stand here"
  g.fillStyle(0xffd54a, 0.14).fillCircle(c, c, RAD);
  // a soft glow either side of the line
  for (let i = 4; i >= 1; i--) g.lineStyle(4 + i * 4, 0xffc83a, 0.07).strokeCircle(c, c, RAD);
  // a dark edge so it shows on pale sand and snow, then the gold line and a light inner line
  g.lineStyle(9, 0x5a3a08, 0.45).strokeCircle(c, c, RAD);
  g.lineStyle(6, 0xffcf40, 1).strokeCircle(c, c, RAD);
  g.lineStyle(2, 0xfff4c0, 0.9).strokeCircle(c, c, RAD - 2);
  g.generateTexture(TEX, SIZE, SIZE);
  g.destroy();
}

export class GoldRings {
  private rings: Phaser.GameObjects.Image[] = [];
  private ghost: Phaser.GameObjects.Image;
  private t = 0;
  private scene: Phaser.Scene;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    makeTexture(scene);
    this.ghost = scene.add.image(0, 0, '__DEFAULT').setVisible(false);
  }

  private ring(i: number): Phaser.GameObjects.Image {
    let img = this.rings[i];
    if (!img) {
      img = this.scene.add.image(0, 0, TEX).setDepth(DEPTH);
      this.rings.push(img);
    }
    return img;
  }

  /**
   * Draw this frame's rings. `alpha` is how far between rule steps the frame is (people's feet are drawn there);
   * `light` adds a small glow at night so a ring still shows in the dark.
   */
  update(
    g: Game,
    show: boolean,
    alpha: number,
    dt: number,
    still: boolean,
    light: (x: number, y: number, r: number, k: number) => void,
  ): void {
    this.t += dt;
    let used = 0;
    let ghost = false;
    if (show) {
      const s = g.s;
      const beat = still ? 0.5 : 0.5 + 0.5 * Math.sin(this.t * 3.2);
      for (const sp of joinSpots(g)) {
        let x = sp.x;
        let y = sp.y;
        if (sp.k) {
          for (const n of g.rt.npcs)
            if (n.k === sp.k) {
              x = n.px + (n.x - n.px) * alpha;
              y = n.py + (n.y - n.py) * alpha;
            }
        }
        if (Math.abs(x - s.x) > 18 || Math.abs(y - s.y) > 12) continue;
        const inside = Math.hypot(x - s.x, y - s.y) <= sp.r;
        const size = ((sp.r * T) / RAD) * (1 + (inside ? 0.03 : 0.05) * beat);
        this.ring(used++)
          .setVisible(true)
          .setPosition(x * T, y * T)
          .setScale(size)
          .setAlpha(inside ? 1 : sp.wanted ? 0.75 + 0.25 * beat : 0.55 + 0.25 * beat);
        light(x * T, y * T, sp.r + 0.6, inside ? 0.7 : 0.45);
      }
      const ps = placeSpot(g);
      if (ps && ps.area === s.area) {
        const cx = ps.x + ps.w / 2;
        const cy = ps.y + ps.h / 2;
        const r = Math.max(ps.w, ps.h) / 2 + 0.45;
        this.ring(used++)
          .setVisible(true)
          .setPosition(cx * T, cy * T)
          .setScale(((r * T) / RAD) * (1 + 0.06 * beat))
          .setAlpha(0.7 + 0.3 * beat);
        light(cx * T, cy * T, r + 0.8, 0.6);
        const def = g.c.items[ps.item]?.place;
        if (def) {
          const w = ps.w * T;
          const h = ps.h * T;
          const f = worldFrame(this.scene, PLACED_ART[ps.item] ?? ps.item, w, h);
          if (this.ghost.texture.key !== f.key || (f.frame && this.ghost.frame.name !== f.frame))
            this.ghost.setTexture(f.key, f.frame);
          const floor = def.layer === 'floor';
          this.ghost
            .setVisible(true)
            .setScale(f.frame ? 1 / 1.5 : 1)
            .setOrigin(0.5, floor ? 0.5 : 1)
            .setPosition(cx * T, floor ? cy * T : (ps.y + ps.h) * T)
            .setDepth(floor ? DEPTH + 1 : (ps.y + ps.h) * T)
            .setAlpha(0.35 + 0.2 * beat);
          ghost = true;
        }
      }
    }
    for (let i = used; i < this.rings.length; i++) this.rings[i]!.setVisible(false);
    if (!ghost) this.ghost.setVisible(false);
  }
}
