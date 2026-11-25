// Glossary pictures (design section 8): a word flagged to show its picture (furnace, cobblestone, marmalade,
// lighthouse) appears with that picture the first time it is used on screen. The game remembers which she has seen.
import type { Game } from './types.ts';

/** The first flagged word in this text she has not seen yet, marked as seen; null when there is none. */
export function firstGloss(g: Game, text: string, show: Record<string, string>): { word: string; pic: string } | null {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const word in show) {
    if (g.s.gloss.includes(word)) continue;
    // the whole word, or its plural
    if (!new RegExp(`\\b${word}(s|es)?\\b`).test(lower)) continue;
    g.s.gloss.push(word);
    return { word, pic: show[word]! };
  }
  return null;
}
