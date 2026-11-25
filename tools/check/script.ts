// Prints the story as a script, for reviewers: every quest on the main path (or the ids given), step by step,
// with the objective line she sees and every line that is spoken, the story scenes a step plays, and the words in
// each quest (first choice only, counted as tools/check/calm.ts counts them). Family names stay as tokens.
// Run: node tools/check/script.ts [quest ids...] [--side] > script.txt
import { objective } from '../../src/core/quests.ts';
import { newGame } from '../../src/core/state.ts';
import type { Line } from '../../src/core/types.ts';
import { content } from '../../src/data/content.ts';
import { questWords } from './calm.ts';

const args = process.argv.slice(2);
const side = args.includes('--side');
const ids = args.filter((a) => !a.startsWith('--'));
const c = content;
const g = newGame(c);
const order = ids.length
  ? ids
  : c.questOrder.filter((id) => (side ? c.quests[id]!.kind === 'side' : c.quests[id]!.kind === 'main'));

const text = (l: Line): string => {
  if (typeof l === 'string') return l;
  const cond = l.if ? ` [if ${JSON.stringify(l.if)}]` : '';
  const ch = l.choices ? `  (she picks: ${l.choices.map((x) => `"${x.text}"`).join(' / ')})` : '';
  return `${l.l}${cond}${ch}`;
};
for (const id of order) {
  const q = c.quests[id];
  if (!q) continue;
  console.log(`\n=== ${id}: ${q.name}${q.chapter ? ` (chapter ${q.chapter})` : ''}${q.path ? '' : ' [optional]'} ===`);
  for (const l of q.open ?? []) console.log(`    ${text(l)}`);
  q.steps.forEach((st, i) => {
    g.s.quests[id] = { step: i, n: 0 };
    let goal = '';
    try {
      goal = objective(g, id);
    } catch {
      goal = st.goal ?? st.t;
    }
    console.log(`  ${i + 1}. [${st.t}] ${goal}`);
    for (const l of st.say ?? []) console.log(`       ${text(l)}`);
    const fx = st.fx;
    const got: string[] = [];
    if (fx?.shard) got.push(`star shard ${fx.shard}`);
    if (fx?.give) got.push(...Object.entries(fx.give).map(([k, n]) => `${n} ${c.items[k]?.name ?? k}`));
    if (fx?.recipes) got.push(`recipes: ${fx.recipes.map((r) => c.items[r]?.name ?? r).join(', ')}`);
    if (fx?.emeralds) got.push(`${fx.emeralds} emeralds`);
    if (fx?.time) got.push(`time moves to ${fx.time}`);
    if (fx?.spawn) got.push(`mobs appear: ${fx.spawn.map((s) => `${s.n} ${s.mob}`).join(', ')}`);
    if (fx?.cut) got.push(`a story scene plays (${fx.cut})`);
    if (got.length) console.log(`       -> ${got.join('; ')}`);
    if (fx?.cut)
      for (const a of c.cutscenes[fx.cut]?.acts ?? []) if (a.a === 'say' && a.l) console.log(`          ${a.l}`);
  });
  delete g.s.quests[id];
  for (const l of q.close ?? []) console.log(`    ${text(l)}`);
  const w = questWords(q, c);
  console.log(`  words: ${w.words} in ${w.boxes} boxes, ${q.steps.length} steps`);
  const r = q.rewards;
  if (r)
    console.log(
      `  reward: ${[r.emeralds ? `${r.emeralds} emeralds` : '', r.recipes ? `recipes ${r.recipes.join(', ')}` : '', r.mail ? `a letter next morning` : '', r.give ? Object.keys(r.give).join(', ') : ''].filter(Boolean).join('; ')}`,
    );
}
