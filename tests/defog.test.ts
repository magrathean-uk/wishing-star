// Issue 38: a pale see-through band over Mummy Pig's ears in one north-facing idle frame. The art tool that clears
// such haze keeps the drawing, and the frame itself is now as clean as its neighbours.
import { describe, expect, it } from 'vitest';
import { clearFog } from '../tools/art/defog.ts';
import { blank, load } from '../tools/art/imgutil.ts';

const px = (d: Uint8Array, w: number, x: number, y: number, rgba: number[]) => d.set(rgba, (y * w + x) * 4);
const alpha = (d: Uint8Array, w: number, x: number, y: number) => d[(y * w + x) * 4 + 3]!;

describe('clearing haze from a frame', () => {
  it('clears a pale see-through band touching the drawing, and keeps the drawing and its coloured soft edge', () => {
    const w = 20;
    const img = blank(w, 20);
    // the drawing: a dark outlined pink square, with a soft pink edge pixel on its left
    for (let y = 8; y < 16; y++)
      for (let x = 6; x < 14; x++)
        px(img.d, w, x, y, y === 8 || y === 15 || x === 6 || x === 13 ? [70, 20, 40, 255] : [250, 150, 200, 255]);
    px(img.d, w, 5, 12, [240, 140, 185, 140]);
    // the haze: a whitish see-through band from the top edge down onto the drawing's top
    for (let y = 2; y < 8; y++) for (let x = 3; x < 17; x++) px(img.d, w, x, y, [242, 236, 239, 115]);
    expect(clearFog(img)).toBe(6 * 14);
    expect(alpha(img.d, w, 10, 4)).toBe(0);
    expect(alpha(img.d, w, 10, 8)).toBe(255);
    expect(alpha(img.d, w, 10, 12)).toBe(255);
    expect(alpha(img.d, w, 5, 12)).toBe(140);
  });

  it("Mummy Pig's north-facing idle frames carry no more haze than an ordinary soft edge", async () => {
    for (const f of ['idle_up_0', 'idle_up_1', 'idle_up_2', 'idle_up_3']) {
      const img = await load(new URL(`../art/src/chars/mummy_pig/${f}.png`, import.meta.url).pathname);
      expect(clearFog(img), f).toBeLessThan(100);
    }
  });
});
