// Package 60: following only the arrow always arrives. Run: node tests/arrow-walk.ts [--saves] (heavy: use the slot)
// The planner plays the main story once; at every new step of a main quest that has a place, the game is copied.
// From each copy a walker starts at the cottage door and at three other spots and does only what the screen says:
// while the helper arrow shows (the goal off the screen, or no straight way to it) it presses the arrow key nearest
// the arrow's direction for half a second; otherwise it walks at the star. It must reach the place every time.
// --saves also walks from the 53 saves of build 8 (tests/fixtures/saves-b8.data), starting where each save stands.
import fs from 'node:fs';
import { guideOf, stepGuide } from '../src/core/guide.ts';
import { findTarget, moveBody, WALK_SPEED } from '../src/core/hero.ts';
import { stepNpcs } from '../src/core/npcs.ts';
import { stepTarget } from '../src/core/quests.ts';
import { load, serialize } from '../src/core/save.ts';
import { newGame } from '../src/core/state.ts';
import { NO_INPUT, step } from '../src/core/step.ts';
import type { Game } from '../src/core/types.ts';
import { content } from '../src/data/content.ts';
import { Bot } from '../tools/check/planner.ts';

const PRESS = 30;
const MAX_PRESSES = 500;
/** Other starts on the island: the square by the signpost, the bay's signpost, Bing's Garden by the bridge. */
const STARTS: [string, string, number, number][] = [
  ['cottage', 'island', 74.5, 77.5],
  ['square', 'island', 84.5, 63.5],
  ['bay', 'island', 80.5, 99.5],
  ['garden', 'island', 46.5, 60.5],
];

/** Walk by the arrow until she reaches the goal; null when she arrives, else where she gave up. */
export function followArrow(g: Game): string | null {
  const gd = guideOf(g);
  g.rt.mobs.length = 0;
  for (let n = 0; n < MAX_PRESSES; n++) {
    const tgt = stepTarget(g, g.s.tracked ?? '');
    g.rt.target = tgt;
    if (!tgt) return 'no goal place';
    // a save standing inside something solid: the first step of play moves her out
    if (n === 0) step(g, NO_INPUT);
    gd.aimT = 0;
    stepGuide(g);
    const tx = tgt.x + 0.5;
    const ty = tgt.y + 0.5;
    if (tgt.area === g.s.area && Math.hypot(tx - g.s.x, ty - g.s.y) < 1.8) return null;
    if (gd.none) return `no way from ${g.s.area} ${g.s.x.toFixed(1)},${g.s.y.toFixed(1)}`;
    const arrow = gd.far || !gd.direct;
    if (arrow && !gd.has) return `no arrow at ${g.s.area} ${g.s.x.toFixed(1)},${g.s.y.toFixed(1)}`;
    const dx = (arrow ? gd.wx : tx) - g.s.x;
    const dy = (arrow ? gd.wy : ty) - g.s.y;
    const mx = Math.abs(dx) >= Math.abs(dy) ? Math.sign(dx) : 0;
    const my = Math.abs(dx) >= Math.abs(dy) ? 0 : Math.sign(dy);
    g.s.dir = mx > 0 ? 'right' : mx < 0 ? 'left' : my > 0 ? 'down' : 'up';
    const x0 = g.s.x;
    const y0 = g.s.y;
    for (let f = 0; f < PRESS; f++) {
      const area = g.s.area;
      // package 68: people are solid since package 67 and step aside after half a second: they move as in play
      stepNpcs(g);
      moveBody(g, (mx * WALK_SPEED) / 60, (my * WALK_SPEED) / 60);
      if (g.s.area !== area) break;
    }
    // stopped by a thorn bush, a web or a rock fall on the way: its Space prompt shows, so press Space as she would
    if (Math.hypot(g.s.x - x0, g.s.y - y0) < 0.05) {
      const t = findTarget(g);
      if (t.kind === 'obj' && t.type?.node)
        for (let i = 0; i < 8 && findTarget(g).kind === 'obj'; i++) {
          // a web hung high is shot with an arrow (X); everything else answers Space
          step(g, { ...NO_INPUT, act: t.type.node.tool !== 'bow', fire: t.type.node.tool === 'bow' });
          for (let f = 0; f < 30; f++) step(g, NO_INPUT);
          g.ev.length = 0;
          g.rt.mobs.length = 0;
        }
    }
  }
  return `gave up at ${g.s.area} ${g.s.x.toFixed(1)},${g.s.y.toFixed(1)}`;
}

function fresh(json: string): Game {
  const g = load(content, json);
  g.rt.mode = 'play';
  g.rt.spawnT = 1e9;
  return g;
}

/** Copies of the game at each new main-story step that has a place. */
function storySteps(): { label: string; json: string }[] {
  const g = newGame(content, { hero: 'amelia', seed: 20261225 });
  const out: { label: string; json: string }[] = [];
  let last = '';
  const look = () => {
    const id = g.s.tracked;
    const q = id ? g.s.quests[id] : undefined;
    if (!id || !q || q.done || g.c.quests[id]?.kind !== 'main' || g.rt.mode !== 'play') return;
    const key = `${id}:${q.step}`;
    if (key === last) return;
    last = key;
    if (stepTarget(g, id)) out.push({ label: key, json: serialize(g) });
  };
  const bot = new Bot(g, {
    run: 1,
    maxSteps: 60 * 60 * 60 * 6,
    stop: () => {
      look();
      return !!g.s.quests.finale?.done;
    },
  });
  bot.run();
  if (bot.stuck) console.log(`planner: ${bot.stuck}`);
  return out;
}

function main(): void {
  const t0 = performance.now();
  let runs = 0;
  const fails: string[] = [];
  // --dir <folder>: walk from copies saved before (--keep) instead of playing the story again
  const dir = process.argv.includes('--dir') ? process.argv[process.argv.indexOf('--dir') + 1]! : '';
  const steps = dir
    ? fs
        .readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => ({ label: f.replace('.json', '').replace('_', ':'), json: fs.readFileSync(`${dir}/${f}`, 'utf8') }))
    : storySteps();
  // --keep <folder>: write every story step's copy there too (for pictures from the very step)
  const keep = process.argv.includes('--keep') ? process.argv[process.argv.indexOf('--keep') + 1] : '';
  if (keep) for (const st of steps) fs.writeFileSync(`${keep}/${st.label.replace(':', '_')}.json`, st.json);
  for (const st of steps) {
    // the place she stood when the step came, then the four starts (each only if she could stand there today)
    for (const [name, area, x, y] of [['as played', '', 0, 0] as const, ...STARTS]) {
      const g = fresh(st.json);
      if (area) {
        g.s.area = area;
        g.s.x = g.rt.px = x;
        g.s.y = g.rt.py = y;
        g.rt.target = stepTarget(g, g.s.tracked ?? '');
        stepGuide(g);
        // a start she cannot walk to from the cottage today (behind a gate she has not opened) is skipped
        if (guideOf(g).none) continue;
      }
      runs++;
      const r = followArrow(g);
      if (r) {
        fails.push(`${st.label} from ${name}: ${r}`);
        const dump = process.argv[process.argv.indexOf('--dump') + 1];
        if (process.argv.includes('--dump') && dump && name === 'as played')
          fs.writeFileSync(`${dump}/${st.label.replace(':', '_')}.json`, st.json);
        else if (
          process.argv.includes('--dump') &&
          dump &&
          !fs.existsSync(`${dump}/${st.label.replace(':', '_')}.json`)
        )
          fs.writeFileSync(`${dump}/${st.label.replace(':', '_')}.json`, st.json);
      }
    }
  }
  if (process.argv.includes('--saves')) {
    const saves: Record<string, unknown> = JSON.parse(
      fs.readFileSync(new URL('./fixtures/saves-b8.data', import.meta.url), 'utf8'),
    );
    for (const name in saves) {
      const g = fresh(JSON.stringify(saves[name]));
      if (!g.s.tracked || !stepTarget(g, g.s.tracked ?? '')) continue;
      runs++;
      const r = followArrow(g);
      if (r) fails.push(`save ${name}: ${r}`);
    }
  }
  for (const f of fails) console.log(`FAIL ${f}`);
  const secs = ((performance.now() - t0) / 1000).toFixed(0);
  console.log(
    `${fails.length ? 'ARROW WALK FAIL' : 'ARROW WALK OK'}: ${runs - fails.length} of ${runs} walks arrived (${steps.length} story steps, ${secs} s)`,
  );
  process.exitCode = fails.length ? 1 : 0;
}

if (process.argv[1]?.endsWith('arrow-walk.ts')) main();
