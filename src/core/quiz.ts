// Package 73b (I6, D79): the school quiz at the blackboard. One minute, one question at a time, three answers: Left
// and Right choose, Space picks (a tap picks at once). Times tables up to 12 x 12 and "which is spelled right?" take
// turns. A right answer chimes and counts; a wrong one shows the right answer for a second and goes on. No penalty.
// Her best score and the day of her last gold star live in `counts`.
import { randInt } from './cond.ts';
import { addMini, finish, type MiniDef, startMini } from './minigames.ts';
import { applyFx } from './quests.ts';
import type { Game, MiniRt, QuizRt } from './types.ts';

export const QUIZ = {
  /** seconds of play */
  time: 60,
  /** seconds the answer stays up after a right pick, and after a wrong one (the right one shows) */
  right: 0.45,
  wrong: 1.2,
  /** a score that earns the day's gold star, and the emeralds it brings */
  star: 5,
  gems: 3,
  /** scores for 2 and 3 stars on the result card */
  stars: [5, 10],
};
const dt = 1 / 60;

const VOWELS = 'aeiou';
/** Sounds a child may spell another way, in the order the wrong forms are made. */
const SOUNDS: [string, string][] = [
  ['ph', 'f'],
  ['tion', 'shun'],
  ['ture', 'cher'],
  ['ous', 'us'],
  ['ight', 'ite'],
  ['ough', 'off'],
  ['ci', 'si'],
  ['qu', 'kw'],
  ['ck', 'k'],
  ['y', 'ie'],
];
const MIX: Record<string, string> = { a: 'e', e: 'i', i: 'e', o: 'u', u: 'o' };

/**
 * Wrong forms of a word, made by rule, most likely first: ie and ei swapped, a double letter made single, a single one
 * doubled, a quiet letter or the last e left out, a sound spelled another way, a vowel mixed up, two letters swapped. Never the word
 * itself or another word on the list.
 */
export function misspell(word: string, list: ReadonlySet<string> = new Set()): string[] {
  const out: string[] = [];
  const add = (w: string) => {
    if (w.length >= 3 && w !== word && !list.has(w) && !out.includes(w)) out.push(w);
  };
  if (word.includes('ie')) add(word.replace('ie', 'ei'));
  if (word.includes('ei')) add(word.replace('ei', 'ie'));
  const dbl = /([a-z])\1/.exec(word);
  if (dbl) add(word.slice(0, dbl.index) + word.slice(dbl.index + 1));
  for (let i = 1; i < word.length - 1; i++) {
    const ch = word[i]!;
    const after = word[i + 1];
    if (!/[bcdfglmnprst]/.test(ch) || !VOWELS.includes(word[i - 1]!) || ch === after || after === 'h') continue;
    add(word.slice(0, i) + ch + word.slice(i));
    break;
  }
  if (word.startsWith('kn') || word.startsWith('wr')) add(word.slice(1));
  if (word.endsWith('mb')) add(word.slice(0, -1));
  if (word.endsWith('e') && word.length > 4) add(word.slice(0, -1));
  for (const [a, b] of SOUNDS) if (word.includes(a)) add(word.replace(a, b));
  for (let i = word.length - 2; i >= 1; i--) {
    const m = MIX[word[i]!];
    if (m) add(word.slice(0, i) + m + word.slice(i + 1));
  }
  for (let i = 1; i < word.length - 2; i++)
    if (word[i] !== word[i + 1]) add(word.slice(0, i) + word[i + 1] + word[i] + word.slice(i + 2));
  return out;
}

/** Two different things from a list, in random order (the game's own random). */
function two<T>(g: Game, list: readonly T[]): [T, T] {
  const a = randInt(g, 0, list.length - 1);
  let b = randInt(g, 0, list.length - 2);
  if (b >= a) b++;
  return [list[a]!, list[b]!];
}

/** A times-table question: a times b, both 2 to 12, and two near wrong answers. */
function timesQ(g: Game): Omit<QuizRt, 'pick' | 'picked' | 'show' | 'mx' | 'asked'> {
  const a = randInt(g, 2, 12);
  const b = randInt(g, 2, 12);
  const r = a * b;
  const near = [a * (b + 1), a * (b - 1), (a + 1) * b, (a - 1) * b, r + 1, r - 1, r + 2, r + 10, r - 10];
  const wrong = [...new Set(near)].filter((n) => n > 0 && n !== r);
  const [w1, w2] = two(g, wrong);
  return {
    kind: 0,
    key: `t:${Math.min(a, b)}x${Math.max(a, b)}`,
    text: `${a} x ${b}`,
    ...shuffle(g, `${r}`, [`${w1}`, `${w2}`]),
  };
}

/** A spelling question: the word and two of its likely wrong forms. */
function spellQ(g: Game): Omit<QuizRt, 'pick' | 'picked' | 'show' | 'mx' | 'asked'> {
  const words = g.c.words ?? [];
  const word = words[randInt(g, 0, words.length - 1)]!;
  const wrong = misspell(word, new Set(words)).slice(0, 4);
  const [w1, w2] = two(g, wrong);
  return { kind: 1, key: `s:${word}`, text: '', ...shuffle(g, word, [w1, w2]) };
}

function shuffle(g: Game, right: string, wrong: [string, string]): { answers: string[]; right: number } {
  const at = randInt(g, 0, 2);
  const answers = [...wrong];
  answers.splice(at, 0, right);
  return { answers, right: at };
}

/** The next question: the two kinds take turns, and none comes again while it is one of the last two of its kind. */
function next(g: Game, m: MiniRt): void {
  const was = m.quiz;
  const asked = (was?.asked ?? 0) + 1;
  const spell = asked % 2 === 0 && !!g.c.words?.length;
  const avoid = new Set([was?.key ?? '', m.msg]);
  let q = spell ? spellQ(g) : timesQ(g);
  for (let i = 0; i < 20 && avoid.has(q.key); i++) q = spell ? spellQ(g) : timesQ(g);
  // m.msg keeps the question before this one, so a kind's last question is not asked again on its next turn
  m.msg = was?.key ?? '';
  m.quiz = { ...q, pick: 1, picked: -1, show: 0, mx: was?.mx ?? 0, asked };
  // the score line reads "4 of 7": right answers of questions asked
  m.goal = asked;
}

/** She picks answer i (Space on the chosen one, or a tap on it). */
export function quizPick(g: Game, i: number): void {
  const m = g.rt.mini;
  const q = m?.quiz;
  if (m?.game !== 'quiz' || m.st !== 1 || !q || q.picked >= 0 || i < 0 || i >= q.answers.length) return;
  q.pick = i;
  q.picked = i;
  if (i === q.right) {
    m.score++;
    q.show = QUIZ.right;
    g.ev.push({ t: 'sfx', id: 'chime' });
  } else {
    q.show = QUIZ.wrong;
    g.ev.push({ t: 'sfx', id: 'tick' });
  }
}

/** The end of the minute: her best score is kept, and 5 or more brings the day's gold star once. */
function end(g: Game, m: MiniRt): void {
  const c = g.s.counts;
  c.quiz_best = Math.max(c.quiz_best ?? 0, m.score);
  // the result card's title says "A gold star!" when this go won the day's star, else "Time is up!"
  let why = 'mini_why_time';
  if (m.score >= QUIZ.star && c.quiz_star !== g.s.day) {
    c.quiz_star = g.s.day;
    why = 'quiz_why_gold';
    applyFx(g, { emeralds: QUIZ.gems });
  }
  finish(g, m, m.score >= QUIZ.stars[1]! ? 3 : m.score >= QUIZ.stars[0]! ? 2 : 1, why);
}

const quiz: MiniDef = {
  goal: QUIZ.stars[1]!,
  init(g, m) {
    m.n = [];
    m.msg = '';
    m.quiz = undefined;
    next(g, m);
  },
  step(g, m, inp) {
    const q = m.quiz!;
    if (q.show > 0) {
      q.show -= dt;
      if (q.show > 0) return;
      if (m.t >= QUIZ.time) {
        end(g, m);
        return;
      }
      next(g, m);
      return;
    }
    if (m.t >= QUIZ.time) {
      end(g, m);
      return;
    }
    const mx = Math.sign(inp.mx);
    if (mx && mx !== q.mx) {
      q.pick = Math.max(0, Math.min(q.answers.length - 1, q.pick + mx));
      g.ev.push({ t: 'sfx', id: 'tick' });
    }
    q.mx = mx;
    if (inp.act) quizPick(g, q.pick);
  },
};

/** Space at the blackboard: the quiz's start card asks "Play the quiz?" (Space starts, X is "Not now"). */
export function startQuiz(g: Game): void {
  addMini('quiz', quiz);
  startMini(g, 'quiz');
}

/** Seconds of the minute left, for the view. */
export function quizLeft(m: MiniRt): number {
  return Math.max(0, Math.ceil(QUIZ.time - (m.st === 1 ? m.t : 0)));
}
