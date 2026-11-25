// The look of every menu: cream panels with a warm border, big rounded letters, high contrast.
import type Phaser from 'phaser';
import { frameFor } from '../assets.ts';

export const W = 1920;
export const H = 1080;
/**
 * The UI scene's layers, lowest first. Everything passive (the HUD, key pictures, bubbles, messages, sparkles, the
 * hurt edge, the skip ring) sits below TALK; the things she uses (talk box, rules card, morning card, menu) sit at
 * TALK and above. Only one of those is shown at a time: UI.focus() picks it (G, build 5: "make sure always the
 * element interacting with is on the screen above others").
 */
export const LAYER = {
  bubble: 30,
  msg: 40,
  banner: 45,
  bits: 46,
  edge: 47,
  skip: 48,
  portrait: 49,
  talk: 50,
  talkKey: 51,
  morning: 58,
  card: 60,
  menu: 70,
} as const;
/** Move a panel (a container or an image) so all of it lies inside the W x H UI area. */
export function clampOnScreen(o: Phaser.GameObjects.Container | Phaser.GameObjects.Image): void {
  const b = o.getBounds();
  const dx = b.x < 0 ? -b.x : b.right > W ? W - b.right : 0;
  const dy = b.y < 0 ? -b.y : b.bottom > H ? H - b.bottom : 0;
  if (dx || dy) o.setPosition(o.x + dx, o.y + dy);
}
export const INK = '#3b2a1a';
export const SOFT = '#7a5a35';
export const CREAM = 0xfff8e7;
export const GOLD = 0xf2b84b;
export const BROWN = 0x3b2a1a;
export const SKYBLUE = 0x9ad8ff;
export const GREEN = 0x7be37b;
export const RED = 0xff6a6a;

export type Txt = Phaser.GameObjects.Text;

/** Phaser text owns a bitmap. Repaint it when the WebGL buffer changes density, keeping its bounds in game units. */
export function screenText(
  scene: Phaser.Scene,
  x: number,
  y: number,
  str: string,
  style: Phaser.Types.GameObjects.Text.TextStyle,
): Txt {
  const renderer = scene.game.renderer;
  const density = () => Math.max(1, renderer.width / W);
  const t = scene.add.text(x, y, str, { ...style, resolution: density() });
  const refresh = () => {
    const next = density();
    if (t.style.resolution !== next) t.setResolution(next);
  };
  renderer.on('resize', refresh);
  t.once('destroy', () => renderer.off('resize', refresh));
  return t;
}

export function text(scene: Phaser.Scene, x: number, y: number, str: string, size = 32, color = INK, wrap = 0): Txt {
  const t = screenText(scene, x, y, str, {
    fontFamily: 'Nunito, sans-serif',
    fontStyle: '700',
    fontSize: `${size}px`,
    color,
    wordWrap: wrap ? { width: wrap, useAdvancedWrap: true } : undefined,
    lineSpacing: 6,
  });
  t.setScrollFactor(0);
  return t;
}
export function title(scene: Phaser.Scene, x: number, y: number, str: string, size = 48, color = INK): Txt {
  const t = screenText(scene, x, y, str, {
    fontFamily: 'Fredoka, Nunito, sans-serif',
    fontStyle: '600',
    fontSize: `${size}px`,
    color,
  });
  t.setScrollFactor(0);
  return t;
}
/**
 * A Done button at the foot of a menu whose Space never closes it (a shop, the crafting table, the jukebox): the
 * arrows reach it after the last choice and Space or a tap on it closes the menu, so a child with only the arrows
 * and Space can always leave. Drawn into `g`, centred on `cx`, with its top at `y`; returns the word.
 */
export const DONE_W = 240;
export const DONE_H = 70;
export function doneButton(
  scene: Phaser.Scene,
  g: Phaser.GameObjects.Graphics,
  cx: number,
  y: number,
  on: boolean,
): Txt {
  g.fillStyle(on ? GOLD : 0xe8d9b5, 1).fillRoundedRect(cx - DONE_W / 2, y, DONE_W, DONE_H, 20);
  g.fillStyle(0xfffdf2, 1).fillRoundedRect(cx - DONE_W / 2 + 6, y + 6, DONE_W - 12, DONE_H - 12, 16);
  return text(scene, cx, y + 16, 'Done', 36, INK).setOrigin(0.5, 0);
}
/** Touch: is (x, y) on the Done button drawn at `cx`, `y` (a little grown, for a finger)? */
export const onDone = (x: number, y: number, cx: number, top: number): boolean =>
  x >= cx - DONE_W / 2 - 8 && x <= cx + DONE_W / 2 + 8 && y >= top - 8 && y <= top + DONE_H + 8;
/**
 * Up or down through `n` choices and the Done after them (Done is choice `n`): Down from the last choice reaches
 * Done and then wraps to the first; Up from the first goes to the last choice, so Done is only ever met at the end.
 */
export function stepDone(sel: number, dy: number, n: number): number {
  if (dy < 0 && sel === 0 && n) return n - 1;
  return (sel + dy + n + 1) % (n + 1);
}

/** White letters with a dark edge, for text that sits straight on the world. */
export function outlined(scene: Phaser.Scene, x: number, y: number, str: string, size = 32, wrap = 0): Txt {
  const t = text(scene, x, y, str, size, '#ffffff', wrap);
  t.setStroke('#2a1c10', 8);
  t.setShadow(0, 3, 'rgba(0,0,0,0.35)', 0, true, false);
  return t;
}

/**
 * Touch (package 65): where panels and slots were drawn into a Graphics, so a tap can find the menu's edge and its
 * cells. Recorded only on a device with a touch screen (`drawn.on`, set at boot); src/game/touch.ts forgets a
 * Graphics' boxes when it is cleared.
 */
export interface DrawnBox {
  x: number;
  y: number;
  w: number;
  h: number;
  slot: boolean;
  on: boolean;
}
export const drawn = { on: false, boxes: new WeakMap<Phaser.GameObjects.Graphics, DrawnBox[]>() };
function note(g: Phaser.GameObjects.Graphics, b: DrawnBox): void {
  const list = drawn.boxes.get(g);
  if (list) list.push(b);
  else drawn.boxes.set(g, [b]);
}

export function panel(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  fill = CREAM,
  border = GOLD,
  r = 28,
): void {
  if (drawn.on) note(g, { x, y, w, h, slot: false, on: false });
  g.fillStyle(0x000000, 0.22);
  g.fillRoundedRect(x + 4, y + 10, w, h, r);
  g.fillStyle(border, 1);
  g.fillRoundedRect(x, y, w, h, r);
  g.fillStyle(fill, 1);
  g.fillRoundedRect(x + 7, y + 7, w - 14, h - 14, Math.max(4, r - 7));
}
export function slot(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  size: number,
  selected = false,
  fill = 0xf3e6c8,
): void {
  if (drawn.on) note(g, { x, y, w: size, h: size, slot: true, on: selected });
  g.fillStyle(selected ? GOLD : 0xb89a6a, 1);
  g.fillRoundedRect(x, y, size, size, 14);
  g.fillStyle(selected ? 0xfffbe8 : fill, 1);
  g.fillRoundedRect(x + 5, y + 5, size - 10, size - 10, 10);
}

/** Change a text's colour only when it is different: setColor draws the text again, so never call it every frame. */
export function colour(t: Phaser.GameObjects.Text, c: string): void {
  if (t.style.color !== c) t.setColor(c);
}

/** An item, object or UI picture fitted into a square. */
export function icon(scene: Phaser.Scene, name: string, x: number, y: number, size: number): Phaser.GameObjects.Image {
  const f = frameFor(scene, name, 64, 64);
  const img = scene.add.image(x, y, f.key, f.frame).setScrollFactor(0);
  fitSize(img, size);
  return img;
}
export function setIcon(scene: Phaser.Scene, img: Phaser.GameObjects.Image, name: string, size: number): void {
  const f = frameFor(scene, name, 64, 64);
  if (img.texture.key !== f.key || (f.frame !== undefined && img.frame.name !== f.frame))
    img.setTexture(f.key, f.frame);
  fitSize(img, size);
}
export function fitSize(img: Phaser.GameObjects.Image, size: number): void {
  const m = Math.max(img.width, img.height) || size;
  img.setScale(size / m);
}

/** Small drawn pictures the HUD needs before any art exists. */
export function makeUiTextures(scene: Phaser.Scene): void {
  const mk = (key: string, w: number, h: number, draw: (g: Phaser.GameObjects.Graphics) => void) => {
    if (scene.textures.exists(key)) return;
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    draw(g);
    g.generateTexture(key, w, h);
    g.destroy();
  };
  const heart = (g: Phaser.GameObjects.Graphics, color: number, half: boolean, edge = 0x3b1a1a, hole = 0x6a3a3a) => {
    g.fillStyle(edge, 1);
    g.fillCircle(17, 18, 15).fillCircle(39, 18, 15).fillTriangle(3, 24, 53, 24, 28, 52);
    g.fillStyle(hole, 1);
    g.fillCircle(17, 18, 11).fillCircle(39, 18, 11).fillTriangle(8, 24, 48, 24, 28, 46);
    if (color) {
      g.fillStyle(color, 1);
      if (half) {
        g.fillCircle(17, 18, 11);
        g.fillTriangle(8, 24, 28, 24, 28, 46);
      } else g.fillCircle(17, 18, 11).fillCircle(39, 18, 11).fillTriangle(8, 24, 48, 24, 28, 46);
      g.fillStyle(0xffffff, 0.55);
      g.fillCircle(13, 13, 4);
    }
  };
  mk('ui_heart2', 56, 56, (g) => heart(g, 0xff4a5e, false));
  mk('ui_heart1', 56, 56, (g) => heart(g, 0xff4a5e, true));
  mk('ui_heart0', 56, 56, (g) => heart(g, 0, false));
  // shield hearts: blue, from armour; they take hits before the red ones
  mk('ui_shield2', 56, 56, (g) => heart(g, 0x4aa8ff, false, 0x10264a, 0x34507a));
  mk('ui_shield1', 56, 56, (g) => heart(g, 0x4aa8ff, true, 0x10264a, 0x34507a));
  mk('ui_shield0', 56, 56, (g) => heart(g, 0, false, 0x10264a, 0x34507a));
  // damage: a small sword on a gold disc, for the Gear page and the upgrade menu
  mk('ui_dmg', 64, 64, (g) => {
    g.fillStyle(0x3b2a1a, 1).fillCircle(32, 32, 32);
    g.fillStyle(0xffd24a, 1).fillCircle(32, 32, 27);
    g.lineStyle(7, 0x3b2a1a, 1).lineBetween(21, 43, 45, 17).lineBetween(17, 33, 31, 47);
    g.fillStyle(0x3b2a1a, 1).fillCircle(17, 47, 5);
  });
  mk('ui_emerald', 44, 52, (g) => {
    g.fillStyle(0x0d5a2a, 1).fillPoints(
      [
        { x: 22, y: 0 },
        { x: 44, y: 14 },
        { x: 44, y: 38 },
        { x: 22, y: 52 },
        { x: 0, y: 38 },
        { x: 0, y: 14 },
      ],
      true,
    );
    g.fillStyle(0x2ecc71, 1).fillPoints(
      [
        { x: 22, y: 6 },
        { x: 38, y: 17 },
        { x: 38, y: 35 },
        { x: 22, y: 46 },
        { x: 6, y: 35 },
        { x: 6, y: 17 },
      ],
      true,
    );
    g.fillStyle(0xa8f5c4, 1).fillPoints(
      [
        { x: 22, y: 10 },
        { x: 32, y: 18 },
        { x: 22, y: 24 },
        { x: 12, y: 18 },
      ],
      true,
    );
  });
  mk('ui_arrow', 64, 64, (g) => {
    g.fillStyle(0x3b2a1a, 1).fillTriangle(60, 32, 14, 4, 14, 60);
    g.fillStyle(0xffd24a, 1).fillTriangle(52, 32, 20, 13, 20, 51);
  });
  mk('ui_starbig', 72, 72, (g) => {
    const pts = (r1: number, r2: number) =>
      Array.from({ length: 10 }, (_v, i) => ({
        x: 36 + Math.cos((i / 10) * Math.PI * 2 - Math.PI / 2) * (i % 2 ? r2 : r1),
        y: 36 + Math.sin((i / 10) * Math.PI * 2 - Math.PI / 2) * (i % 2 ? r2 : r1),
      }));
    g.fillStyle(0x3b2a1a, 1).fillPoints(pts(36, 17), true);
    g.fillStyle(0xffd24a, 1).fillPoints(pts(29, 13), true);
    g.fillStyle(0xfff3b0, 1).fillPoints(pts(16, 8), true);
  });
  mk('ui_dial', 120, 120, (g) => {
    g.fillStyle(0x3b2a1a, 1).fillCircle(60, 60, 60);
    g.fillStyle(0x8fd3ff, 1)
      .slice(60, 60, 53, Math.PI * 1.02, Math.PI * 1.98, false)
      .fillPath();
    g.fillStyle(0xffb86b, 1)
      .slice(60, 60, 53, Math.PI * 1.98, Math.PI * 2.24, false)
      .fillPath();
    g.fillStyle(0x2a3a7a, 1)
      .slice(60, 60, 53, Math.PI * 0.24, Math.PI * 0.86, false)
      .fillPath();
    g.fillStyle(0xffc98a, 1)
      .slice(60, 60, 53, Math.PI * 0.86, Math.PI * 1.02, false)
      .fillPath();
    g.fillStyle(0xfff8e7, 1).fillCircle(60, 60, 26);
  });
  mk('ui_hand', 36, 60, (g) => {
    g.fillStyle(0x3b2a1a, 1).fillTriangle(18, 0, 34, 30, 2, 30).fillRect(12, 26, 12, 30);
    g.fillStyle(0xff5a5a, 1).fillTriangle(18, 8, 27, 26, 9, 26);
  });
  mk('ui_px', 4, 4, (g) => g.fillStyle(0xffffff, 1).fillRect(0, 0, 4, 4));
}
