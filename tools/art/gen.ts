// Art generation through `codex2` and its built-in image tool (D15: no image API spend).
// One image per codex2 run, so a refusal, a crash or a muddled worker can only ever cost one image.
//
//   node tools/art/gen.ts <jobs.json> [--jobs 4] [--tries 3] [--only id,id] [--force]
//
// jobs.json: [{ id, out, prompt, refs?: string[], alts?: string[] }]
//   out    where the PNG goes (relative to the repo root); skipped when it already exists
//   refs   images shown to the model as "Image 1", "Image 2", ... (relative to the repo root)
//   alts   other wordings to try when the first is refused
// Nothing about real people may be in a prompt except the PEOPLE.md prompt description (project rule).
import { execFileSync, spawn } from 'node:child_process';
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export interface ArtJob {
  id: string;
  out: string;
  prompt: string;
  refs?: string[];
  alts?: (string | { prompt: string; refs?: string[] })[];
}

const ROOT = resolve(import.meta.dirname, '../..');
const CODEX2_HOME = join(homedir(), 'dev/machine/state/codex2');
const WORK = process.env.ART_WORK ?? '/Volumes/4TB/dev/work/jobs/wishing-star/art-gen';
const MODEL = process.env.ART_MODEL ?? 'gpt-6-luna';
const EFFORT = process.env.ART_EFFORT ?? 'low';
const LOG = join(ROOT, 'art/qa/gen-log.tsv');

const WORKER = `You are an image-generation worker for a private, non-commercial family project (a home-made game for one child; nothing is published or sold).
Call the built-in image_gen tool exactly once, passing the PROMPT below word for word. Do not rewrite, shorten or embellish it.
ATTACHED
Do not run shell commands, do not read or write files, do not browse, do not use the CLI fallback or any API key.
When the tool returns, reply with the single word: done. If the tool refuses or fails, reply: refused, then the reason in a few words. Do not try again.

PROMPT:
`;

function runOne(
  job: ArtJob,
  prompt: string,
  refList: string[],
  n: number,
): Promise<{ ok: boolean; why: string; secs: number }> {
  return new Promise((done) => {
    const dir = join(WORK, `${job.id}-${n}`);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    // WebP references (the other game's likeness pictures) go to the image tool as PNG copies in the job folder
    const refs = refList.map((r, i) => {
      const abs = resolve(ROOT, r);
      if (!abs.endsWith('.webp')) return abs;
      const png = join(dir, `ref-${i + 1}.png`);
      execFileSync('sips', ['-s', 'format', 'png', abs, '--out', png], { stdio: 'ignore' });
      return png;
    });
    const attached = refs.length
      ? `${refs.length} image${refs.length > 1 ? 's are' : ' is'} attached to this message: in the prompt they are "Image 1"${refs.length > 1 ? ', "Image 2", ...' : ''} in the order attached. Generate the new image as an edit or variation that uses them as the prompt says.`
      : 'No image is attached: generate a new image.';
    const text = WORKER.replace('ATTACHED', attached) + prompt + '\n';
    writeFileSync(join(dir, 'prompt.md'), text);
    const args = ['exec'];
    for (const r of refs) args.push('-i', r);
    args.push(
      '-m',
      MODEL,
      '-c',
      `model_reasoning_effort=${EFFORT}`,
      '-s',
      'read-only',
      '--skip-git-repo-check',
      '--json',
      '-C',
      dir,
      '-',
    );
    const t0 = Date.now();
    const p = spawn('codex2', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.stdin.end(text);
    const timer = setTimeout(() => p.kill('SIGTERM'), 8 * 60 * 1000);
    p.on('close', () => {
      clearTimeout(timer);
      const secs = Math.round((Date.now() - t0) / 1000);
      writeFileSync(join(dir, 'out.jsonl'), out);
      writeFileSync(join(dir, 'err.txt'), err);
      const all = out + err;
      const thread =
        /"thread_id"\s*:\s*"([0-9a-f-]{20,})"/.exec(out)?.[1] ?? /session id:\s*([0-9a-f-]{20,})/i.exec(all)?.[1];
      let file: string | null = null;
      if (thread) {
        const gdir = join(CODEX2_HOME, 'generated_images', thread);
        if (existsSync(gdir)) {
          const pngs = readdirSync(gdir)
            .filter((f) => f.endsWith('.png'))
            .map((f) => join(gdir, f))
            .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
          file = pngs[0] ?? null;
        }
      }
      if (file) {
        const dest = resolve(ROOT, job.out);
        mkdirSync(dirname(dest), { recursive: true });
        copyFileSync(file, dest);
        done({ ok: true, why: 'ok', secs });
      } else {
        const why = /moderation_blocked|safety system/i.test(all)
          ? 'refused'
          : /usage limit|rate limit|quota|429/i.test(all)
            ? 'limit'
            : thread
              ? 'no image'
              : 'no session';
        done({ ok: false, why, secs });
      }
    });
  });
}

async function runJob(job: ArtJob, tries: number): Promise<string> {
  const prompts = [job.prompt, ...(job.alts ?? [])];
  for (let n = 0; n < tries; n++) {
    const p = prompts[Math.min(n, prompts.length - 1)]!;
    const prompt = typeof p === 'string' ? p : p.prompt;
    const refs = typeof p === 'string' ? (job.refs ?? []) : (p.refs ?? []);
    const r = await runOne(job, prompt, refs, n);
    appendFileSync(LOG, `${new Date().toISOString()}\t${job.id}\t${n + 1}\t${r.secs}\t${r.why}\n`);
    if (r.ok) return 'ok';
    if (r.why === 'limit') return 'limit';
  }
  return 'failed';
}

async function main() {
  const argv = process.argv.slice(2);
  const file = argv.find((a) => !a.startsWith('--'));
  if (!file) throw new Error('usage: node tools/art/gen.ts <jobs.json> [--jobs 4] [--tries 3] [--only a,b] [--force]');
  const opt = (name: string, d: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1]! : d;
  };
  const par = Number(opt('jobs', '4'));
  const tries = Number(opt('tries', '3'));
  const only = opt('only', '');
  const force = argv.includes('--force');
  let jobs: ArtJob[] = JSON.parse(readFileSync(resolve(file), 'utf8'));
  if (only) jobs = jobs.filter((j) => only.split(',').includes(j.id));
  const todo = jobs.filter((j) => force || !existsSync(resolve(ROOT, j.out)));
  mkdirSync(dirname(LOG), { recursive: true });
  mkdirSync(WORK, { recursive: true, mode: 0o700 });
  console.log(`art: ${todo.length} to make, ${jobs.length - todo.length} already there, ${par} at a time`);
  const t0 = Date.now();
  const tally: Record<string, string[]> = { ok: [], failed: [], limit: [] };
  let stop = false;
  // A job whose refs are not there yet waits for an earlier job in the same list to make them.
  const pending = new Set(todo.map((j) => j.id));
  const worker = async () => {
    while (!stop) {
      const i = todo.findIndex(
        (j, k) =>
          k >= 0 && pending.has(j.id) && !(j as any).taken && (j.refs ?? []).every((r) => existsSync(resolve(ROOT, r))),
      );
      if (i < 0) {
        if ([...pending].some((id) => (todo.find((j) => j.id === id) as any).taken)) {
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }
        return;
      }
      const job = todo[i]!;
      (job as any).taken = true;
      const res = await runJob(job, tries);
      pending.delete(job.id);
      tally[res]!.push(job.id);
      console.log(`  [${tally.ok!.length + tally.failed!.length}/${todo.length}] ${job.id}: ${res}`);
      if (res === 'limit') stop = true;
    }
  };
  await Promise.all(Array.from({ length: par }, worker));
  const blocked = [...pending].filter((id) => !(todo.find((j) => j.id === id) as any).taken);
  const mins = ((Date.now() - t0) / 60000).toFixed(1);
  console.log(
    `art: ${tally.ok!.length} made, ${tally.failed!.length} failed, ${blocked.length} waiting on a missing reference, ${mins} min`,
  );
  if (tally.failed!.length) console.log(`failed: ${tally.failed!.join(' ')}`);
  if (blocked.length) console.log(`waiting: ${blocked.join(' ')}`);
  if (stop) console.log('STOPPED: codex2 reported a usage limit');
  process.exitCode = tally.failed!.length || blocked.length || stop ? 1 : 0;
}

if (import.meta.main) await main();
