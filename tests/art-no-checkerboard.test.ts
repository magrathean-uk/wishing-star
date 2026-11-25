// A picture must not carry a painted background. The image tool sometimes paints a light checkerboard where it means
// "see-through"; one such master (the snowy oak variant) reached the game as a chequered box round the tree (G,
// 21 Nov 2026). An object or character frame whose corners are solid, light and colourless is that mistake.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../public/assets/', import.meta.url).pathname;

type Frame = { x: number; y: number; w: number; h: number };
function framesOf(file: string): [string, Frame][] {
  const j = JSON.parse(fs.readFileSync(file, 'utf8')) as { frames?: unknown };
  if (Array.isArray(j.frames)) return j.frames.map((f: { filename: string; frame: Frame }) => [f.filename, f.frame]);
  return Object.entries((j.frames ?? {}) as Record<string, { frame: Frame }>).map(([k, v]) => [k, v.frame]);
}

async function boxed(dir: string, pick: RegExp): Promise<string[]> {
  const bad: string[] = [];
  for (const f of fs.readdirSync(dir).filter((n) => pick.test(n))) {
    const page = path.join(dir, f.replace(/\.json$/, '.webp'));
    if (!fs.existsSync(page)) continue;
    const { data, info } = await sharp(page).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (const [name, fr] of framesOf(path.join(dir, f))) {
      if (fr.w < 40 || fr.h < 40) continue;
      let corners = 0;
      for (const [cx, cy] of [
        [fr.x + 2, fr.y + 2],
        [fr.x + fr.w - 8, fr.y + 2],
        [fr.x + 2, fr.y + fr.h - 8],
        [fr.x + fr.w - 8, fr.y + fr.h - 8],
      ] as const) {
        let solid = 0;
        for (let dy = 0; dy < 6; dy++)
          for (let dx = 0; dx < 6; dx++) {
            const i = ((cy + dy) * info.width + cx + dx) * 4;
            const [r, g, b, a] = [data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!];
            if (a > 200 && r > 185 && Math.abs(r - g) < 8 && Math.abs(g - b) < 8) solid++;
          }
        if (solid >= 30) corners++;
      }
      if (corners >= 3) bad.push(`${f.replace(/\.json$/, '')}/${name}`);
    }
  }
  return bad;
}

describe('no picture carries a painted checkerboard or white box', () => {
  it('objects', async () => {
    expect(await boxed(path.join(ROOT, 'atlas'), /^objects.*\.json$/)).toEqual([]);
  }, 60000);
  it('characters', async () => {
    expect(await boxed(path.join(ROOT, 'chars'), /\.json$/)).toEqual([]);
  }, 120000);
});
