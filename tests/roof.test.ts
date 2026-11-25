// The chest on the school roof is drawn once, with its painted world picture, on top of the school (not behind it).
import { describe, expect, it } from 'vitest';
import { content } from '../src/data/content.ts';
import { roofDepth } from '../src/game/world/roof.ts';

describe('things on a roof', () => {
  it('a chest inside a building footprint draws above that building; chests on open ground keep their own depth', () => {
    let onRoofs = 0;
    let onGround = 0;
    for (const a of Object.values(content.areas))
      for (const o of a.objects) {
        const t = content.objects[o.type];
        if (t?.interact !== 'chest' && t?.interact !== 'pickup') continue;
        const d = roofDepth(a, content, o);
        if (d === null) {
          onGround++;
          continue;
        }
        onRoofs++;
        // the building under it draws at its own bottom edge less 6 (src/game/world/things.ts); the chest sits above
        const under = a.objects.find((b) => {
          const bt = content.objects[b.type]!;
          return b !== o && bt.solid && o.x >= b.x && o.x < b.x + (bt.w ?? 1) && o.y >= b.y && o.y < b.y + (bt.h ?? 1);
        })!;
        expect(d).toBeGreaterThan((under.y + (content.objects[under.type]!.h ?? 1)) * 64 - 6);
      }
    expect(onRoofs).toBeGreaterThan(0);
    expect(onGround).toBeGreaterThan(0);
  });
});
