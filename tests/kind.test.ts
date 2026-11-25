// Package 67: a player in players mode has no personal file, so every letter and bottle that would carry Dad's words
// gets a kind built-in one from a friend on the island: never empty, never "undefined", no token left unfilled and no
// name from Dad's file.
import { describe, expect, it } from 'vitest';
import { kindPages } from '../src/core/kind.ts';
import { newGame } from '../src/core/state.ts';
import { fill } from '../src/core/talk.ts';
import { content } from '../src/data/content.ts';
import personal from '../src/data/personal.json' with { type: 'json' };

const names: Record<string, string> = {};
for (const [k, v] of Object.entries(content.strings)) if (k.startsWith('tok:')) names[k.slice(4)] = v;
const g = newGame(content, { seed: 1, hero: 'koala', names, xmas: false });

const own = (personal as { letters: Record<string, unknown>; bottles: Record<string, unknown> }).letters;
const ids = [
  ...Object.keys(content.letters).filter((id) => !content.letters[id]!.text?.length),
  ...Object.keys(own),
  ...Object.keys((personal as { bottles: Record<string, unknown> }).bottles),
];
const real = Object.entries((personal as { names: Record<string, string> }).names)
  .filter(([k]) => !k.startsWith('trail_note') && k !== 'koala')
  .map(([, v]) => v.toLowerCase());

describe('kind built-in letters and bottles', () => {
  it('covers every letter and bottle that has words in the personal file', () => {
    expect(ids.length).toBeGreaterThan(15);
    for (const id of ids) {
      const pages = kindPages(content.strings, id).map((p) => fill(g, p));
      expect(pages.length, id).toBeGreaterThan(0);
      expect(content.strings[`kind:${id}:1`], `${id} has its own words`).toBeTruthy();
      for (const p of pages) {
        expect(p.trim().length, id).toBeGreaterThan(0);
        expect(p, id).not.toMatch(/undefined|\{|\}/);
        for (const n of real) expect(p.toLowerCase(), id).not.toMatch(new RegExp(`\\b${n}\\b`));
      }
      expect(pages.at(-1), id).toMatch(/a friend on the island$/);
    }
  });

  it('falls back to the general words for an unknown id', () => {
    expect(kindPages(content.strings, 'nobody_9').length).toBeGreaterThan(0);
    expect(kindPages(content.strings, 'bottle99')[0]).toContain('whoever finds this');
    expect(kindPages({}, 'x')[0]).toContain('{hero}');
  });
});
