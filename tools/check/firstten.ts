// First ten minutes (phase 2, docs/PHASE2.md section 5 item 13), for a new game played by the solver's bot on its
// child's clock (`Bot.kid`: walking counts one and a half times, reading is at 80 words a minute, a mini-game takes
// what the kid bot measured, each chop, craft and fight has its price).
// Within a minute her hands are on the axe (package 46: about 5 boxes and 40 words before the first chop).
// By minute 6 she is roaming free (the prologue is done) and has swung at a mob.
// By minute 10 she walks freely, has fought a mob, crafted her sword, slept once and found one new place,
// and at minute 10 she has met no more than 5 people.
// Run: node tools/check/firstten.ts [--hero id] [--verbose]   (default: every starting hero)
import { count } from '../../src/core/cond.ts';
import type { Game } from '../../src/core/types.ts';
import { content } from '../../src/data/content.ts';
import { type Bot, clock } from './planner.ts';
import { play } from './solver.ts';

const AXE_BY = 60;
const FREE_BY = 360;
const LIMIT = 600;
const MAX_MET = 5;

/** Seconds on the child's clock. */
const kidClock = (b: Bot): number => b.kid;

/** Everyone she has talked to. The one place this check reads the met record (package 27: `g.s.met`). */
export const metCount = (g: Game): number => Object.keys(g.s.met ?? {}).length;

const regionAt = (g: Game): string => {
  const a = g.c.areas[g.s.area];
  if (g.s.area !== 'island' || !a) return '';
  const code = a.region[Math.floor(g.s.y)]?.[Math.floor(g.s.x)];
  for (const id in g.c.regions) if (g.c.regions[id]!.code === code) return id;
  return '';
};
/** Has a `defeat` step of any quest been passed? (The story's fights are steps.) */
const wonFight = (g: Game): boolean => {
  for (const id in g.s.quests) {
    const q = g.s.quests[id]!;
    const steps = g.c.quests[id]?.steps ?? [];
    for (let i = 0; i < Math.min(q.done ? steps.length : q.step, steps.length); i++)
      if (steps[i]!.t === 'defeat') return true;
  }
  return false;
};

interface Watch {
  /** a mob has been hit (seen with less than its full health) */
  swung: boolean;
  /** regions she has stood in, in order */
  regions: string[];
}
interface Goal {
  id: string;
  label: string;
  by: number;
  ok: (b: Bot, w: Watch) => boolean;
}
const GOALS: Goal[] = [
  { id: 'axe', label: 'has the axe in her hands', by: AXE_BY, ok: (b) => count(b.g, 'wood_axe') > 0 },
  { id: 'free6', label: 'roaming free (the prologue is done)', by: FREE_BY, ok: (b) => !!b.g.s.quests.prologue?.done },
  { id: 'swing6', label: 'swung at a mob', by: FREE_BY, ok: (b, w) => w.swung || wonFight(b.g) },
  { id: 'fight', label: 'fought a mob and won', by: LIMIT, ok: (b) => wonFight(b.g) },
  {
    id: 'sword',
    label: 'crafted her sword',
    by: LIMIT,
    ok: (b) => count(b.g, 'wood_sword') > 0 && (b.g.s.counts.crafted ?? 0) > 0,
  },
  { id: 'sleep', label: 'slept once', by: LIMIT, ok: (b) => b.g.s.day >= 2 },
  // her cottage is in Home Meadow: any other region she walks into is a new place
  { id: 'place', label: 'found one new place', by: LIMIT, ok: (_b, w) => w.regions.length >= 2 },
];

export function firstTen(hero: string, verbose = false): { ok: boolean; lines: string[] } {
  const reached: Record<string, number> = {};
  const w: Watch = { swung: false, regions: [] };
  let metAtTen = -1;
  const look = (b: Bot): number => {
    const t = kidClock(b);
    const g = b.g;
    if (!w.swung) w.swung = g.rt.mobs.some((m) => !m.gone && m.hp < (g.c.mobs[m.id]?.hp ?? 0));
    const r = regionAt(g);
    if (r && !w.regions.includes(r)) w.regions.push(r);
    for (const goal of GOALS) if (reached[goal.id] === undefined && goal.ok(b, w)) reached[goal.id] = t;
    if (t <= LIMIT) metAtTen = metCount(g);
    return t;
  };
  const r = play(content, 1, hero, { stop: (b) => look(b) >= LIMIT });
  const b = r.bot;
  // the run may end before ten minutes (stuck or finished): judge what was reached by then
  const end = look(b);
  const lines: string[] = [];
  if (verbose)
    for (const m of b.marks) {
      if (m.kid > LIMIT) break;
      lines.push(`  ${clock(m.kid)}  ${m.what}`);
    }
  const missing: string[] = [];
  for (const goal of GOALS) {
    const t = reached[goal.id];
    const ok = t !== undefined && t <= goal.by;
    if (!ok) missing.push(`${goal.label} by ${clock(goal.by)}`);
    lines.push(
      `  ${t !== undefined && t <= LIMIT ? clock(t).padStart(5) : '  -  '}  ${goal.label} (by ${clock(goal.by)})`,
    );
  }
  if (metAtTen > MAX_MET) missing.push(`met ${metAtTen} people, more than ${MAX_MET}`);
  lines.push(
    `  at ${clock(Math.min(end, LIMIT))}: met ${metAtTen} (${Object.keys(b.g.s.met ?? {}).join(' ')}), places ${w.regions.join(' ')}${b.stuck && end < LIMIT ? '; the run stopped early: ' + b.stuck : ''}`,
  );
  if (missing.length) lines.push(`  missing: ${missing.join('; ')}`);
  return { ok: missing.length === 0, lines };
}

function main(): void {
  const args = process.argv.slice(2);
  const i = args.indexOf('--hero');
  const only = i >= 0 ? args[i + 1] : null;
  const verbose = args.includes('--verbose');
  const heroes = Object.values(content.heroes)
    .filter((h) => h.starter && (!only || h.id === only))
    .map((h) => h.id);
  let bad = 0;
  for (const hero of heroes) {
    const res = firstTen(hero, hero === heroes[0] || verbose);
    console.log(`${hero}: ${res.ok ? 'ok' : 'MISSING'}`);
    for (const l of res.lines) console.log(l);
    if (!res.ok) bad++;
  }
  console.log(bad ? `FIRST TEN FAIL (${bad} of ${heroes.length} heroes)` : 'FIRST TEN OK');
  process.exit(bad ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
