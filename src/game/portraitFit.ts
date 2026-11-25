// The talk box portrait's size and how much of it shows above the box (UI.drawTalk). Plain TypeScript with no Phaser,
// because tools/art/portraits.ts cuts the portrait pictures to the same line.

/** Box top in the 1920 x 1080 view: the portrait's head and shoulders stand above it, the body is hidden behind. */
export const PORTRAIT_BOX_TOP = 772;

/** Extra scale for a portrait of a character `tall` tiles high whose world frames are `w` wide at `px` a figure. */
export function portraitZoom(tall: number, set?: { w: number; px: number }): number {
  const width = set ? (set.w * tall * 64) / set.px : 0;
  // Even a very wide character must fit around the portrait's centre on either side of the screen.
  return Math.min(4.2, 520 / (tall * 64), width ? 760 / width : 4.2);
}

/** How much of a portrait `body` pixels high shows above the box: head and shoulders, or most of a small animal. */
export function portraitShown(body: number): number {
  return body < 360 ? body * 0.8 : Math.min(250, body * 0.45);
}
