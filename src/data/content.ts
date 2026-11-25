// All content, wired together. The rules never import data directly: they are handed this.
import type { AreaDef, Content, QuestDef } from '../core/types.ts';
import { cafeStalls } from './cafe.ts';
import { chars, heroes } from './chars.ts';
import { items } from './items.ts';
import interiors from './map/interiors.json' with { type: 'json' };
import island from './map/island.json' with { type: 'json' };
import { cutscenes, letters, stickers } from './misc.ts';
import { objects } from './objects.ts';
import { post } from './post.ts';
import { act1 } from './quests/act1.ts';
import { act2 } from './quests/act2.ts';
import { friends } from './quests/friends.ts';
import { homeQuests } from './quests/home.ts';
import { side1 } from './quests/side1.ts';
import { side2 } from './quests/side2.ts';
import { prologue } from './quests/prologue.ts';
import { quizWords } from './quiz.ts';
import { secret } from './quests/secret.ts';
import { recipes } from './recipes.ts';
import { scenes } from './scenes.ts';
import { strings } from './strings.ts';
import { animals, dens, fish, landmarks, mobs, regions, stalls, whereSkip } from './world.ts';

// package 70: the secret show comes last (after the credits)
const all: QuestDef[] = [...prologue, ...act1, ...homeQuests, ...act2, ...side1, ...side2, ...friends, secret];
const quests: Record<string, QuestDef> = {};
for (const q of all) {
  if (quests[q.id]) throw new Error(`duplicate quest ${q.id}`);
  quests[q.id] = q;
}

export const content: Content = {
  items,
  recipes,
  objects,
  areas: { island: island as unknown as AreaDef, ...(interiors as unknown as Record<string, AreaDef>) },
  regions,
  chars,
  heroes,
  mobs,
  animals,
  quests,
  questOrder: all.map((q) => q.id),
  cutscenes: { ...cutscenes, ...scenes },
  letters,
  stickers,
  stalls: { ...stalls, ...cafeStalls },
  fish,
  strings,
  landmarks,
  dens,
  post,
  words: quizWords,
  whereSkip,
};
