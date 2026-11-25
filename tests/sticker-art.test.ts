// Every sticker the journal shows has a picture in the atlas: none is drawn as a grey stand-in.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { content } from '../src/data/content.ts';
import { journalStickers } from '../src/data/stickers.ts';

const index = JSON.parse(readFileSync(new URL('../public/assets/atlas/index.json', import.meta.url), 'utf8')) as {
  frames: Record<string, Record<string, unknown>>;
};
const named = new Set(Object.values(index.frames).flatMap((page) => Object.keys(page)));

describe('journal sticker pictures', () => {
  it('every journal sticker has art in the atlas', () => {
    const missing = journalStickers(content.stickers)
      .filter((s) => !named.has(s.art))
      .map((s) => `${s.id} (${s.art})`);
    expect(missing).toEqual([]);
  });
});
