// Acts two and three: chapters 4 to 7 and the finale. Each quest lives in its own file.
import type { QuestDef } from '../../core/types.ts';
import { ch4 } from './ch4.ts';
import { ch5 } from './ch5.ts';
import { ch6 } from './ch6.ts';
import { ch7 } from './ch7.ts';
import { finale } from './finale.ts';

export const act2: QuestDef[] = [ch4, ch5, ch6, ch7, finale];
