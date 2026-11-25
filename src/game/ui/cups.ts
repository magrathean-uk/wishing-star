// Package 47b: small drawn pictures for the cups, the fish board's water and the sun and moon. Made once per scene.
import type Phaser from 'phaser';

/** Cup colours by tier: 0 an empty place on the shelf, 1 bronze, 2 silver, 3 gold. */
export const CUP_FILL = [0x6b5a44, 0xc8794a, 0xc9d3dc, 0xf5c542] as const;
export const CUP_NAME = ['', 'bronze', 'silver', 'gold'] as const;
/** Cup colours as text on the cream panels: darker than the fill so the words read clearly. */
export const CUP_INK = ['#7a6a55', '#9a4e22', '#5f6f7d', '#a87a00'] as const;

function mk(scene: Phaser.Scene, key: string, w: number, h: number, draw: (g: Phaser.GameObjects.Graphics) => void) {
  if (scene.textures.exists(key)) return;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  draw(g);
  g.generateTexture(key, w, h);
  g.destroy();
}

/** 'ui_cup0' to 'ui_cup3', 'ui_sun', 'ui_moon', 'ui_water_<sea|river|pond|cave>'. */
export function makeCupTextures(scene: Phaser.Scene): void {
  CUP_FILL.forEach((c, tier) =>
    mk(scene, 'ui_cup' + tier, 96, 112, (g) => {
      const edge = tier ? 0x3b2a1a : 0x4a3d2e;
      const a = tier ? 1 : 0.45;
      // handles, bowl, stem and base, outlined
      g.lineStyle(7, edge, 1);
      g.strokeCircle(16, 34, 13);
      g.strokeCircle(80, 34, 13);
      g.lineStyle(6, c, a);
      g.strokeCircle(16, 34, 13);
      g.strokeCircle(80, 34, 13);
      g.fillStyle(edge, 1).fillRoundedRect(14, 8, 68, 58, { tl: 6, tr: 6, bl: 30, br: 30 });
      g.fillStyle(c, a).fillRoundedRect(18, 12, 60, 50, { tl: 4, tr: 4, bl: 26, br: 26 });
      g.fillStyle(edge, 1).fillRect(40, 62, 16, 22).fillRoundedRect(22, 82, 52, 22, 6);
      g.fillStyle(c, a).fillRect(44, 62, 8, 22).fillRoundedRect(26, 86, 44, 14, 4);
      if (tier) g.fillStyle(0xffffff, 0.45).fillRoundedRect(26, 18, 10, 30, 5);
    }),
  );
  mk(scene, 'ui_sun', 80, 80, (g) => {
    g.fillStyle(0xffb52e, 1);
    for (let i = 0; i < 8; i++) {
      const r = (i / 8) * Math.PI * 2;
      g.fillCircle(40 + Math.cos(r) * 30, 40 + Math.sin(r) * 30, 6);
    }
    g.fillStyle(0xffd84a, 1).fillCircle(40, 40, 20);
  });
  mk(scene, 'ui_moon', 80, 80, (g) => {
    g.fillStyle(0x2b3a6b, 1).fillCircle(40, 40, 36);
    g.fillStyle(0xfff3b0, 1).fillCircle(40, 40, 24);
    g.fillStyle(0x2b3a6b, 1).fillCircle(52, 32, 22);
    g.fillStyle(0xffffff, 1).fillCircle(18, 18, 2).fillCircle(62, 62, 2);
  });
  const water = (kind: string, sky: number, deep: number, ground: number, round: boolean) =>
    mk(scene, 'ui_water_' + kind, 120, 90, (g) => {
      g.fillStyle(ground, 1).fillRoundedRect(0, 0, 120, 90, 16);
      if (round) g.fillStyle(deep, 1).fillEllipse(60, 48, 96, 54);
      else g.fillStyle(deep, 1).fillRect(0, 30, 120, 44);
      g.lineStyle(4, sky, 1);
      for (const [x, y] of [
        [24, 44],
        [62, 56],
        [92, 42],
      ] as const) {
        g.beginPath();
        g.arc(x, y, 8, Math.PI * 1.1, Math.PI * 1.9);
        g.strokePath();
      }
    });
  water('sea', 0xd8f4ff, 0x2f8fd8, 0xf2d79a, false);
  water('river', 0xd8f4ff, 0x4aa8e0, 0x7cc66a, false);
  water('pond', 0xd8f4ff, 0x4fb8c8, 0x7cc66a, true);
  water('cave', 0x9be8ff, 0x2a6a8a, 0x5a5560, true);
}
