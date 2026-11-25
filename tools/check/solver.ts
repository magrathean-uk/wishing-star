// Solver: proves the game can be finished by playing it headless through step(), and measures it.
// Run: node tools/check/solver.ts [--hero id] [--run 1|2|3] [--final] [--verbose]
// Run 1: each starting hero from a fresh save to the end of the story, doing things as soon as they open.
// Run 2: each friend hero the content unlocks, swapped in at the mirror at once, played to the end of all content.
// Run 3: in the Christmas layer, the story first, then every side quest, friend line and poster, then every
// collection (finds, cracked-rock pockets by a lured creeper, stall collectibles, 3 stars in each mini-game).
// Then the reward cadence (per starting hero) and the playtime report (main path). Exit 1 when a run got stuck;
// with --final the playtime range, the reading share, the whole game and the cadence limits fail the check too.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { newGame } from '../../src/core/state.ts';
import type { Content, Effects, Line } from '../../src/core/types.ts';
import { content } from '../../src/data/content.ts';
import personal from '../../src/data/personal.json' with { type: 'json' };
import { newDay } from '../../src/core/clock.ts';
import { Bot, COST, clock, type RunKind, type Tally, WPM } from './planner.ts';

const SEED = 20261225;
const MAX_STEPS = 60 * 60 * 60 * 14;
// 250 since D20 (G, 18 Nov 2026: "253 is fine"); it was 270.
// D31 and D32 (18 Nov 2026): a shorter main story is fine if the whole game stays at five hours.
// D50 (18 Nov 2026, 14:58 GMT): the main path's floor is 150 minutes.
// D59 (18 Nov 2026, 22:23 GMT, the lead's decision): main path 115 to 330 minutes for every starting hero.
// D61 (G, 19 Nov 2026, 06:00 GMT: "don't worry about game time, 200-300 is fine"): the whole game at least 200
// minutes; the main path's lower guard goes to 100 with it (the lead's number).
const RANGE = [100, 330] as const;
/**
 * Reward cadence (build plan section 6, restated in package 51): the median gap at most 90 s and no gap over 240 s,
 * as before. Walking was a share (at most a quarter of the path); with two thirds of the words cut on G's order the
 * share rose with nothing new to walk, so walking is now held in minutes: the path's walking is at most half of its
 * minutes, and no chapter walks longer than WALK_CAP.
 */
const CADENCE = { median: 90, worst: 240, walk: 0.5 };
/**
 * Package 51: the most walking each chapter may have, in solver minutes (walking x 1.5), as the mean of the six
 * starting heroes: the chapter's walking in build 5 (the same mean, measured on tag build-5) plus the new stretch
 * that package 47a gave it after build 5 (its measured growth: ch1 creek bush 2.6, ch2 long grass 1.8, ch3 quarry
 * cave 1.7, ch4 web trail 3.7, ch5 old ford 0.2, ch7 rocky drop 1.9). Means are compared to a tenth of a minute.
 * A chapter that grows past its cap fails; never raise a number here without a new stretch to show for it.
 * D60 (18 Nov 2026, the lead's decision): the cap carries a tolerance for route variance, 0.75 minutes or 15 percent
 * of the cap, whichever is larger (WALK_TOL), since the six routes shift with no content change.
 */
const WALK_CAP: Record<string, { build5: number; stretch: number }> = {
  prologue: { build5: 0.6, stretch: 0 },
  ch1: { build5: 1.28, stretch: 2.6 },
  ch2: { build5: 1.62, stretch: 1.8 },
  ch3: { build5: 4.37, stretch: 1.7 },
  ch4: { build5: 2.97, stretch: 3.7 },
  ch5: { build5: 5.05, stretch: 0.2 },
  ch6: { build5: 7.42, stretch: 0 },
  ch7: { build5: 2.98, stretch: 1.9 },
  finale: { build5: 1.55, stretch: 0 },
  home1: { build5: 1.29, stretch: 0 },
  home2: { build5: 2.61, stretch: 0 },
  home3: { build5: 3.41, stretch: 0 },
  home4: { build5: 2.47, stretch: 0 },
};
/** D60: route-variance tolerance on each chapter's WALK_CAP, in minutes: 0.75 or 15 percent, whichever is larger. */
const WALK_TOL = (cap: number) => Math.max(0.75, cap * 0.15);
/** D31: reading at most 30 percent of the main path. D61: the whole game at least 200 minutes (it was 300). */
const READ_MAX = 30;
const WHOLE_MIN = 200;
/** Rewards closer together than this count as one moment (a quest's fanfare and its gifts arrive together). */
const MOMENT = 1;

interface RunOut {
  run: RunKind;
  hero: string;
  swapTo?: string;
  bot: Bot;
  ms: number;
}

const args = process.argv.slice(2);
const has = (k: string) => args.includes(k);
const arg = (k: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};

/** Seconds each mini-game and boss takes a child, from the kid bot's last run. */
export function kidTimes(): Record<string, number> {
  const path = 'test-results/kidbot.json';
  const out: Record<string, number> = {};
  if (!existsSync(path)) return out;
  try {
    const data = JSON.parse(readFileSync(path, 'utf8')) as { games?: Record<string, { avgSeconds?: number }> };
    for (const id in data.games ?? {}) {
      const s = data.games![id]!.avgSeconds;
      if (typeof s === 'number' && s > 0) out[id] = s;
    }
  } catch {
    // a broken file means no kid-bot times: 120 s each is used instead
  }
  return out;
}

/** Words in each of Dad's letters, for reading time. */
export function letterWords(): Record<string, number> {
  const out: Record<string, number> = {};
  const letters = (personal as unknown as { letters?: Record<string, { pages?: string[] }> }).letters ?? {};
  for (const id in letters)
    out[id] = (letters[id]!.pages ?? []).reduce((n, p) => n + p.split(/\s+/).filter(Boolean).length, 0);
  return out;
}

export function names(): Record<string, string> {
  return (personal as unknown as { names: Record<string, string> }).names;
}

export function play(
  c: Content,
  run: RunKind,
  hero: string,
  o: { swapTo?: string; verbose?: boolean; maxSteps?: number; stop?: (b: Bot) => boolean } = {},
): RunOut {
  const t0 = performance.now();
  // run 3 plays in the Christmas layer, as she will on Christmas morning, and goes on to every collection
  const g = newGame(c, { hero, seed: SEED, names: names(), xmas: run === 3 });
  const bot = new Bot(g, {
    run,
    swapTo: o.swapTo,
    maxSteps: o.maxSteps ?? MAX_STEPS,
    verbose: o.verbose,
    miniSecs: kidTimes(),
    letterWords: letterWords(),
    stop: o.stop,
    collect: run === 3,
  });
  bot.run();
  // The run ends when nothing is left to do, which can be the evening of the day a letter was earned: letters
  // come with the morning post, so one more morning passes (she sleeps once more) before the mailbox is read.
  if (!bot.stuck && Object.keys(g.s.flags).some((k) => k.startsWith('mq:'))) newDay(g, true);
  return { run, hero, swapTo: o.swapTo, bot, ms: performance.now() - t0 };
}

/** Friend heroes that some quest, choice or letter in the content unlocks. */
function unlockable(c: Content): string[] {
  const out = new Set<string>();
  const fx = (e: Effects | undefined) => {
    if (e?.hero) out.add(e.hero);
  };
  const lines = (ls: Line[] | undefined) => {
    for (const l of ls ?? []) if (typeof l !== 'string') for (const ch of l.choices ?? []) fx(ch.fx);
  };
  for (const id in c.quests) {
    const q = c.quests[id]!;
    fx(q.rewards);
    lines(q.open);
    lines(q.close);
    for (const st of q.steps) {
      fx(st.fx);
      lines(st.say);
    }
  }
  for (const id in c.cutscenes) for (const a of c.cutscenes[id]!.acts) fx(a.fx);
  return [...out].filter((h) => c.heroes[h] && !c.heroes[h]!.starter);
}

// ------------------------------------------------------------------ reports

function sumTally(b: Bot, filter: (qid: string) => boolean): Tally & { secs: number } {
  const t: Tally & { secs: number } = {
    walk: 0,
    wait: 0,
    words: 0,
    gather: 0,
    craft: 0,
    place: 0,
    mob: 0,
    fish: 0,
    minis: [],
    bosses: [],
    secs: 0,
  };
  for (const q in b.tallies) {
    if (!filter(q)) continue;
    const x = b.tallies[q]!;
    t.walk += x.walk;
    t.wait += x.wait;
    t.words += x.words;
    t.own = (t.own ?? 0) + (x.own ?? 0);
    t.gather += x.gather;
    t.craft += x.craft;
    t.place += x.place;
    t.mob += x.mob;
    t.fight = (t.fight ?? 0) + (x.fight ?? 0);
    t.gatherSecs = (t.gatherSecs ?? 0) + (x.gatherSecs ?? x.gather * COST.gather);
    t.fish += x.fish;
    t.minis.push(...x.minis);
    t.bosses.push(...x.bosses);
  }
  return t;
}

/** Minutes for one tally, by the playtime formula in the build plan. */
export function minutes(t: Tally, miniSecs: Record<string, number>) {
  const walk = (t.walk / 60) * 1.5;
  const read = (t.words * 60) / WPM;
  const minis =
    t.minis.reduce((n, id) => n + (miniSecs[id] ?? COST.mini), 0) +
    t.bosses.reduce((n, id) => n + (miniSecs[id] ?? COST.mini), 0);
  const acts =
    (t.gatherSecs ?? t.gather * COST.gather) +
    t.craft * COST.craft +
    t.place * COST.place +
    (t.fight ?? 0) +
    t.fish * COST.fish;
  return {
    walk: walk / 60,
    read: read / 60,
    /** of `read`, the minutes spent on Dad's own words (his letters in personal.json) */
    own: ((t.own ?? 0) * 60) / WPM / 60,
    minis: minis / 60,
    acts: acts / 60,
    wait: t.wait / 3600,
    total: (walk + read + minis + acts) / 60,
  };
}

export interface Cadence {
  /** waits for the clock (night, day, morning): left out of the gaps and listed apart */
  waits: number;
  waitSecs: number;
  longestWait: number;
  longestWaitWhy: string;
  n: number;
  median: number;
  worst: number;
  worstAt: number;
  worstWhat: string;
  walkShare: number;
  total: number;
}
/**
 * The build plan judges the cadence "along the main story": `until` cuts the log at the moment the finale ends, so
 * late optional side quests (a wait for a night stall, a hunt for a rare mob) do not count as gaps in the story.
 */
export function cadence(
  b: Bot,
  until = Number.POSITIVE_INFINITY,
  onStory: (quest: string) => boolean = () => true,
): Cadence {
  // the cadence clock leaves out time spent only waiting for night or morning (a child would sleep or play on)
  const times: number[] = [0];
  const what: string[] = ['start'];
  const story: boolean[] = [true];
  for (const r of b.rewards) {
    // detours on optional quests are taken off the clock as well, so a gap is time spent on the story itself
    const t = r.kid - r.pass - (r.off ?? 0);
    if (t > until) break;
    if (t - times[times.length - 1]! < MOMENT) continue;
    times.push(t);
    what.push(`${r.kind} ${r.id} [${r.quest}: ${r.doing}]`);
    story.push(onStory(r.quest));
  }
  const gaps: number[] = [];
  let worst = 0;
  let worstAt = 0;
  let worstWhat = '';
  for (let i = 1; i < times.length; i++) {
    // A stretch that ends in a reward of an optional quest was time she chose to spend off the story.
    if (!story[i]) continue;
    const gap = times[i]! - times[i - 1]!;
    gaps.push(gap);
    if (gap > worst) {
      worst = gap;
      worstAt = times[i - 1]!;
      worstWhat = what[i]!;
    }
  }
  gaps.sort((a, c) => a - c);
  const median = gaps.length ? gaps[Math.floor(gaps.length / 2)]! : 0;
  let walk = 0;
  for (const q in b.tallies) walk += b.tallies[q]!.walk;
  const walkSecs = (walk / 60) * 1.5;
  let longestWait = 0;
  let longestWaitWhy = '';
  for (const p of b.passes)
    if (p.secs > longestWait) {
      longestWait = p.secs;
      longestWaitWhy = p.why;
    }
  return {
    waits: b.passes.length,
    waitSecs: b.pass,
    longestWait,
    longestWaitWhy,
    n: times.length - 1,
    median,
    worst,
    worstAt,
    worstWhat,
    walkShare: b.kid - b.pass > 0 ? walkSecs / (b.kid - b.pass) : 0,
    total: b.kid - b.pass,
  };
}

/** The reward cadence along the main story: gaps on the path quests, and walking over the path quests' time. */
function storyCadence(
  b: Bot,
  c: typeof import('../../src/data/content.ts')['content'],
  miniSecs: Record<string, number>,
): Cadence {
  const onPath = (q: string) => !c.quests[q] || !!c.quests[q]!.path;
  const cd = cadence(b, storyEnd(b), onPath);
  const m = minutes(
    sumTally(b, (q) => !!c.quests[q]?.path),
    miniSecs,
  );
  if (m.total > 0) cd.walkShare = m.walk / m.total;
  return cd;
}

/** The cadence clock at the last reward of the finale (the end of the main story), or forever when it never ended. */
function storyEnd(b: Bot): number {
  let end = Number.POSITIVE_INFINITY;
  for (const r of b.rewards) if (r.quest === 'finale') end = r.kid - r.pass - (r.off ?? 0);
  return end;
}

function pad(s: string | number, n: number): string {
  const t = String(s);
  return t.length >= n ? t + ' ' : t + ' '.repeat(n - t.length);
}
const f1 = (n: number) => n.toFixed(1);

function summary(r: RunOut, c: Content): string {
  const s = r.bot.g.s;
  const kinds: Record<string, [number, number]> = {};
  for (const id of c.questOrder) {
    const def = c.quests[id]!;
    const k = (kinds[def.kind] ??= [0, 0]);
    k[1]++;
    if (s.quests[id]?.done || (s.quests[id]?.times ?? 0) > 0) k[0]++;
  }
  const done = Object.entries(kinds)
    .map(([k, [a, b]]) => `${k} ${a}/${b}`)
    .join(', ');
  const status = r.bot.stuck ? 'STUCK' : r.bot.done ? 'OK' : 'STOPPED';
  const who = r.swapTo ? `${r.hero}>${r.swapTo}` : r.hero;
  return `run ${r.run}  ${pad(who, 16)}${pad(status, 8)}${pad(done, 34)}day ${pad(s.day, 4)}${pad(Math.round(s.ticks / 1000) + 'k steps', 12)}play ${pad(clock(r.bot.kid), 9)}real ${(r.ms / 1000).toFixed(1)} s`;
}

function main(): void {
  const c = content;
  const verbose = has('--verbose');
  const final = has('--final');
  const onlyRun = arg('--run') ? (Number(arg('--run')) as RunKind) : null;
  const onlyHero = arg('--hero') ?? null;
  const miniSecs = kidTimes();
  const starters = Object.values(c.heroes)
    .filter((h) => h.starter)
    .map((h) => h.id);
  const friends = unlockable(c);
  const all: RunOut[] = [];
  const kinds: Record<string, number> = {};
  for (const id of c.questOrder) kinds[c.quests[id]!.kind] = (kinds[c.quests[id]!.kind] ?? 0) + 1;
  console.log(
    `SOLVER  ${c.questOrder.length} quests (${Object.entries(kinds)
      .map(([k, n]) => `${n} ${k}`)
      .join(
        ', ',
      )})   kid-bot times: ${Object.keys(miniSecs).length ? Object.keys(miniSecs).join(' ') : 'none (120 s each)'}`,
  );
  const say = (r: RunOut) => {
    console.log(summary(r, c));
    if (r.bot.stuck) console.log(`        STUCK: ${r.bot.stuck}`);
    for (const n of r.bot.notes) {
      const q = /^gave up (\S+)/.exec(n)?.[1];
      console.log(`        note: ${n}${q && r.bot.g.s.quests[q]?.done ? ' (done later)' : ''}`);
    }
  };
  if (!onlyRun || onlyRun === 1)
    for (const hero of starters) {
      if (onlyHero && hero !== onlyHero) continue;
      if (verbose) console.log(`-- run 1 ${hero}`);
      const r = play(c, 1, hero, { verbose });
      all.push(r);
      say(r);
    }
  if (!onlyRun || onlyRun === 2) {
    const locked = Object.values(c.heroes)
      .filter((h) => !h.starter && !friends.includes(h.id))
      .map((h) => h.id);
    if (locked.length) console.log(`run 2  not unlocked by any quest yet: ${locked.join(', ')}`);
    for (const hero of friends) {
      if (onlyHero && hero !== onlyHero) continue;
      if (verbose) console.log(`-- run 2 ${hero}`);
      const r = play(c, 2, 'amelia', { swapTo: hero, verbose });
      all.push(r);
      say(r);
      if (!r.bot.swapped && !r.bot.stuck) {
        r.bot.stuck = `${hero} was never unlocked`;
        console.log(`        STUCK: ${r.bot.stuck}`);
      }
    }
  }
  if ((!onlyRun || onlyRun === 3) && (!onlyHero || onlyHero === 'amelia')) {
    if (verbose) console.log('-- run 3 amelia');
    const r = play(c, 3, 'amelia', { verbose });
    all.push(r);
    say(r);
  }

  // ---- reward cadence, along the main story (run 1)
  const ones = all.filter((r) => r.run === 1);
  let cadenceBad = false;
  if (ones.length) {
    console.log(
      '\nREWARD CADENCE (run 1, along the main story to the end of the finale; rewards within 1 s count as one moment; waits for night or morning are listed apart)',
    );
    console.log(
      `${pad('hero', 12)}${pad('rewards', 9)}${pad('median', 9)}${pad('worst gap', 11)}${pad('walking', 9)}${pad('waits', 22)}verdict`,
    );
    let worstHero: { hero: string; c: Cadence } | null = null;
    for (const r of ones) {
      const cd = storyCadence(r.bot, c, miniSecs);
      const bad: string[] = [];
      if (cd.median > CADENCE.median) bad.push(`median over ${CADENCE.median} s`);
      if (cd.worst > CADENCE.worst) bad.push(`gap over ${CADENCE.worst} s`);
      if (cd.walkShare > CADENCE.walk) bad.push(`walking over ${Math.round(CADENCE.walk * 100)}%`);
      if (bad.length) cadenceBad = true;
      console.log(
        `${pad(r.hero, 12)}${pad(cd.n, 9)}${pad(Math.round(cd.median) + ' s', 9)}${pad(Math.round(cd.worst) + ' s', 11)}${pad(Math.round(cd.walkShare * 100) + '%', 9)}${pad(`${cd.waits} (${f1(cd.waitSecs / 60)} min)`, 22)}${bad.length ? 'FAIL: ' + bad.join(', ') : 'ok'}`,
      );
      if (!worstHero || cd.worst > worstHero.c.worst) worstHero = { hero: r.hero, c: cd };
    }
    if (worstHero)
      console.log(
        `worst gap: ${worstHero.hero}, ${Math.round(worstHero.c.worst)} s from ${clock(worstHero.c.worstAt)}, ending with ${worstHero.c.worstWhat}`,
      );
    const longWait = ones
      .map((r) => ({ hero: r.hero, c: storyCadence(r.bot, c, miniSecs) }))
      .sort((a, b) => b.c.longestWait - a.c.longestWait)[0];
    if (longWait && longWait.c.longestWait > 0)
      console.log(
        `longest wait for the clock: ${longWait.hero}, ${Math.round(longWait.c.longestWait)} s (${longWait.c.longestWaitWhy})`,
      );
    // walking per chapter in minutes (package 51), the mean of the heroes run against build 5 plus its new stretch
    console.log(
      '\nWALKING BY CHAPTER (solver minutes, mean of the heroes run; cap = build 5 + its new stretch + D60 tolerance)',
    );
    console.log(
      `${pad('chapter', 10)}${pad('build 5', 9)}${pad('stretch', 9)}${pad('cap', 7)}${pad('now', 7)}${pad('heroes', 13)}verdict`,
    );
    for (const ch in WALK_CAP) {
      const cap = WALK_CAP[ch]!;
      const each = ones.map(
        (r) =>
          minutes(
            sumTally(r.bot, (q) => q === ch),
            miniSecs,
          ).walk,
      );
      const mean = each.reduce((a, b) => a + b, 0) / each.length;
      const capMin = cap.build5 + cap.stretch + WALK_TOL(cap.build5 + cap.stretch);
      const over = Math.round(mean * 10) > Math.round(capMin * 10);
      if (over) cadenceBad = true;
      console.log(
        `${pad(ch, 10)}${pad(f1(cap.build5), 9)}${pad(f1(cap.stretch), 9)}${pad(f1(capMin), 7)}${pad(f1(mean), 7)}${pad(`${f1(Math.min(...each))} to ${f1(Math.max(...each))}`, 13)}${over ? 'FAIL: more walking than build 5 plus its stretch and tolerance' : 'ok'}`,
      );
    }
  }

  // ---- playtime report, main path (run 1)
  let rangeBad = false;
  let readBad = false;
  let wholeBad = false;
  let wholeMin = 0;
  if (ones.length) {
    const first = ones[0]!;
    const path = c.questOrder.filter((id) => c.quests[id]!.path);
    console.log(
      `\nPLAYTIME (main path, run 1 as ${first.hero}; minutes: walking x 1.5, reading at ${WPM} wpm, mini-games and bosses, actions)`,
    );
    console.log(
      `${pad('quest', 14)}${pad('walk', 7)}${pad('read', 7)}${pad('minis', 7)}${pad('acts', 7)}${pad('total', 8)}${pad('(waiting)', 10)}done`,
    );
    for (const id of path) {
      const m = minutes(
        sumTally(first.bot, (q) => q === id),
        miniSecs,
      );
      const done = first.bot.g.s.quests[id]?.done ? 'yes' : 'no';
      console.log(
        `${pad(id, 14)}${pad(f1(m.walk), 7)}${pad(f1(m.read), 7)}${pad(f1(m.minis), 7)}${pad(f1(m.acts), 7)}${pad(f1(m.total), 8)}${pad(f1(m.wait), 10)}${done}`,
      );
    }
    console.log('per hero, main path total:');
    for (const r of ones) {
      const m = minutes(
        sumTally(r.bot, (q) => !!c.quests[q]?.path),
        miniSecs,
      );
      const inRange = m.total >= RANGE[0] && m.total <= RANGE[1];
      if (!inRange) rangeBad = true;
      console.log(
        `  ${pad(r.hero, 10)}${pad(f1(m.total) + ' min', 12)}${pad(`read ${f1(m.read)} (${Math.round(m.total ? (m.read / m.total) * 100 : 0)}%)`, 18)}${inRange ? 'in range' : `outside ${RANGE[0]} to ${RANGE[1]}`}`,
      );
    }
    // the two lines the lead quotes (package 41): the main path's range over the starting heroes and its reading
    // share (the worst hero), and the whole game: the full run's story, side quests, posters, dens, places and house
    // steps (its collections and 3-star replays left out)
    const mins = ones.map((r) =>
      minutes(
        sumTally(r.bot, (q) => !!c.quests[q]?.path),
        miniSecs,
      ),
    );
    const lo = Math.min(...mins.map((m) => m.total));
    const hi = Math.max(...mins.map((m) => m.total));
    // The reading share is of the game's own writing. Dad's own letters are exempt (docs/PHASE2.md: "Everything Dad
    // writes himself in personal.json (his letters and notes) is exempt"): G's letters of 20 Nov 2026 (D80) are 525
    // words longer than the placeholders, and no story line should be cut to pay for them. Both figures are printed.
    const readPct = Math.max(
      ...mins.map((m) => (m.total - m.own > 0 ? ((m.read - m.own) / (m.total - m.own)) * 100 : 0)),
    );
    const withOwn = Math.max(...mins.map((m) => (m.total ? (m.read / m.total) * 100 : 0)));
    console.log(
      `MAIN PATH ${f1(lo)} to ${f1(hi)} min, reading ${Math.round(readPct)} percent (${Math.round(withOwn)} with Dad's own letters)`,
    );
    if (readPct > READ_MAX) readBad = true;
    const full = all.find((r) => r.run === 3);
    if (full) {
      const w = minutes(
        // package 44b: and the best gear she can make ('gear')
        // package 47a: and every cup at the games' posts ('cups')
        sumTally(
          full.bot,
          (q) => !!c.quests[q] || q.startsWith('den:') || q === 'places' || q === 'gear' || q === 'cups',
        ),
        miniSecs,
      ).total;
      wholeMin = w;
      console.log(`WHOLE GAME ${f1(w)} min`);
      if (w < WHOLE_MIN) wholeBad = true;
    }
    const storyDone = ones.every((r) => r.bot.done);
    const mainCount = c.questOrder.filter((id) => c.quests[id]!.kind === 'main').length;
    if (!final)
      console.log(
        `range ${RANGE[0]} to ${RANGE[1]} min is checked with --final (${mainCount} main quests in the content today${storyDone ? '' : ', story not finished'})`,
      );
  }

  // the event log, for the fun panel and for looking back at a run
  mkdirSync('test-results', { recursive: true });
  writeFileSync(
    'test-results/solver.json',
    JSON.stringify(
      all.map((r) => ({
        run: r.run,
        hero: r.hero,
        swapTo: r.swapTo,
        stuck: r.bot.stuck,
        // quests given up for a while and done in the end are not given up
        gaveUp: Object.fromEntries(Object.entries(r.bot.parked).filter(([q]) => !r.bot.g.s.quests[q]?.done)),
        playSeconds: Math.round(r.bot.kid),
        waitSeconds: Math.round(r.bot.pass),
        waits: r.bot.passes.map((p) => ({ t: Math.round(p.at), secs: Math.round(p.secs), why: p.why })),
        steps: r.bot.g.s.ticks,
        // the reward cadence along the main story, as the report above prints it (run 1 only)
        cadence:
          r.run === 1
            ? (({ median, worst, walkShare }) => ({
                median: Math.round(median),
                worst: Math.round(worst),
                walk: Math.round(walkShare * 100),
              }))(storyCadence(r.bot, c, miniSecs))
            : undefined,
        // every letter that reached her mailbox, read or not
        post: [...new Set([...r.bot.g.s.letters, ...r.bot.g.s.inbox])],
        rewards: r.bot.rewards.map((e) => ({
          t: Math.round(e.kid),
          play: Math.round(e.kid - e.pass),
          tick: e.tick,
          kind: e.kind,
          id: e.id,
          quest: e.quest,
          doing: e.doing,
        })),
        marks: r.bot.marks.map((m) => ({ t: Math.round(m.kid), tick: m.tick, what: m.what })),
      })),
      null,
      1,
    ) + '\n',
  );

  const stuck = all.filter((r) => r.bot.stuck);
  const fail = stuck.length > 0 || (final && (rangeBad || cadenceBad || readBad || wholeBad));
  void wholeMin;
  console.log(
    fail
      ? `\nSOLVER FAIL (${stuck.length} run(s) stuck${final && rangeBad ? ', playtime out of range' : ''}${final && cadenceBad ? ', cadence' : ''}${final && readBad ? `, reading over ${READ_MAX} percent` : ''}${final && wholeBad ? `, whole game under ${WHOLE_MIN} min` : ''})`
      : '\nSOLVER OK',
  );
  process.exit(fail ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
