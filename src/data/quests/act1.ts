// Act one: chapters 1 to 3. Chapters 1 and 2 can be done in either order. Each quest lives in its own file.
import type { QuestDef } from '../../core/types.ts';
import { ch1 } from './ch1.ts';
import { ch2 } from './ch2.ts';
import { ch3 } from './ch3.ts';

export const act1: QuestDef[] = [ch1, ch2, ch3];
