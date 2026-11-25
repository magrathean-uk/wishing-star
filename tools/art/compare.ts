// Old clips beside new ones (package 58): per clip and facing, a looping GIF at game size and twice that, played
// with the game's own timing, plus one still strip of every frame.
//   node tools/art/compare.ts <id> <oldDir> <newDir> <outDir> [--label old,new]
// oldDir and newDir hold <id>/meta.json and its frames (art/src/chars, or a scratch folder from process.ts --to).
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { CharMeta } from './process.ts';
import { blank, type Img, labelSvg, load, over, savePng } from './imgutil.ts';
import sharp, { type OverlayOptions } from 'sharp';

/** The game's rates for clips that carry no timing of their own (src/game/puppet.ts TIMING). */
const FPS: Record<string, [number, boolean]> = {
  walk: [8, true],
  run: [12, true],
  talk: [7, true],
  wave: [5, true],
  swing: [10, false],
  fish: [2, true],
  cheer: [6, true],
  hurt: [8, false],
  sleep: [0.8, true],
  attack: [7, false],
  hop: [6, true],
  dizzy: [4, true],
  calm: [1.2, true],
  laugh: [6, true],
  summon: [5, false],
  stomp: [7, false],
};
const STEP = 0.02;
const LENGTH = 3.2;

/** The frame shown at time t, as the puppet picks it (idle: rest and breath, a blink at 1.5 s). */
function frameAt(meta: CharMeta, clip: string, n: number, t: number): number {
  if (clip === 'idle') {
    const blink = t - 1.5;
    if (n >= 4) {
      if (blink >= 0 && blink < 0.18) return blink < 0.05 || blink > 0.13 ? 2 : 3;
      return Math.floor(t / 1.2) % 2;
    }
    return blink >= 0 && blink < 0.16 && n > 1 ? 1 : 0;
  }
  const durs = meta.timing?.[clip]?.durs;
  const [fps, loop] = FPS[clip] ?? [6, true];
  if (durs && durs.length === n) {
    const total = durs.reduce((a, b) => a + b, 0);
    let u =
      loop || !['swing', 'hurt', 'attack', 'summon', 'stomp'].includes(clip) ? t % total : Math.min(t, total - 1e-6);
    for (let i = 0; i < n; i++) {
      if (u < durs[i]!) return i;
      u -= durs[i]!;
    }
    return n - 1;
  }
  return loop ? Math.floor(t * fps) % n : Math.min(n - 1, Math.floor(t * fps));
}

async function main(): Promise<void> {
  const [id, oldDir, newDir, outDir] = process.argv.slice(2);
  if (!id || !oldDir || !newDir || !outDir) throw new Error('usage: compare.ts <id> <oldDir> <newDir> <outDir>');
  const li = process.argv.indexOf('--label');
  const labels = li >= 0 ? process.argv[li + 1]!.split(',') : ['today', 'new'];
  const metas = [oldDir, newDir].map((d) => JSON.parse(readFileSync(join(d, id, 'meta.json'), 'utf8')) as CharMeta);
  const dirs = [join(oldDir, id), join(newDir, id)];
  mkdirSync(outDir, { recursive: true });
  const W = Math.max(...metas.map((m) => m.w));
  const H = Math.max(...metas.map((m) => m.footY)) + 8;
  // each side drawn at the same world height: the puppet scales by tall * 64 / px
  const scl = metas.map((m) => (m.tall * 64 * 1.25) / m.px);
  const clips = new Set<string>();
  for (const m of metas)
    for (const [c, f] of Object.entries(m.clips)) for (const k of Object.keys(f)) clips.add(`${c} ${k}`);
  const stripRows: { label: string; imgs: Img[][] }[] = [];
  for (const key of [...clips].sort()) {
    const [clip, facing] = key.split(' ') as [string, 'down'];
    const sides = await Promise.all(
      metas.map(async (m, s) => Promise.all((m.clips[clip]?.[facing] ?? []).map((f) => load(join(dirs[s]!, f))))),
    );
    stripRows.push({ label: key, imgs: sides });
    // animated: both side by side on a grass tone, feet on one line
    const cellW = Math.ceil(W * Math.max(...scl)) + 16;
    const cellH = Math.ceil(H * Math.max(...scl)) + 24;
    const tmp = join(outDir, `.f-${clip}-${facing}`);
    rmSync(tmp, { recursive: true, force: true });
    mkdirSync(tmp);
    const steps = Math.round(LENGTH / STEP);
    let last = '';
    let k = 0;
    const list: string[] = [];
    for (let i = 0; i < steps; i++) {
      const t = i * STEP;
      const pick = sides.map((imgs, s) => (imgs.length ? frameAt(metas[s]!, clip, imgs.length, t) : -1));
      const sig = pick.join(',');
      if (sig === last) {
        list[list.length - 1] = list[list.length - 1]!.replace(/ (\d+)$/, (_, d) => ` ${Number(d) + 2}`);
        continue;
      }
      last = sig;
      const canvas = blank(cellW * 2, cellH);
      for (let p = 0; p < canvas.w * canvas.h; p++) canvas.d.set([118, 170, 92, 255], p * 4);
      for (let s = 0; s < 2; s++) {
        if (pick[s]! < 0) continue;
        const img = sides[s]![pick[s]!]!;
        const m = metas[s]!;
        const w = Math.round(img.w * scl[s]!);
        const h = Math.round(img.h * scl[s]!);
        const raw = await sharp(Buffer.from(img.d.buffer, img.d.byteOffset, img.d.length), {
          raw: { width: img.w, height: img.h, channels: 4 },
        })
          .resize(w, h, { kernel: 'lanczos3' })
          .raw()
          .toBuffer();
        over(
          canvas,
          { w, h, d: new Uint8Array(raw) },
          s * cellW + Math.round(cellW / 2 - w / 2),
          cellH - 12 - Math.round(m.footY * scl[s]!),
        );
      }
      const file = join(tmp, `${String(k++).padStart(4, '0')}.png`);
      await savePng(canvas, file);
      list.push(`${file} 2`);
    }
    const args: string[] = ['-dispose', 'Background', '-loop', '0'];
    for (const l of list) {
      const [f, d] = l.split(' ');
      args.push('-delay', d!, f!);
    }
    const gif = join(outDir, `${id}-${clip}-${facing}.gif`);
    execFileSync('magick', [...args, gif]);
    execFileSync('magick', [gif, '-coalesce', '-scale', '200%', '-layers', 'Optimize', gif.replace('.gif', '-x2.gif')]);
    rmSync(tmp, { recursive: true, force: true });
  }
  // the still strip: per clip, today's frames on the left, the new ones on the right
  const lab = 20;
  const most = Math.max(...stripRows.map((r) => r.imgs[0]!.length)) * W + 40;
  const most2 = Math.max(...stripRows.map((r) => r.imgs[1]!.length)) * W;
  const width = Math.max(400, most + most2 + 20);
  const rowH = lab + Math.max(...metas.map((m) => m.h)) + 6;
  const comps: OverlayOptions[] = [];
  stripRows.forEach((r, i) => {
    const y = i * rowH;
    comps.push({
      input: labelSvg(`${r.label}: ${labels[0]} ${r.imgs[0]!.length}, ${labels[1]} ${r.imgs[1]!.length}`, width, lab),
      left: 0,
      top: y,
    });
    r.imgs.forEach((imgs, s) =>
      imgs.forEach((img, k) =>
        comps.push({
          input: Buffer.from(img.d.buffer, img.d.byteOffset, img.d.length),
          raw: { width: img.w, height: img.h, channels: 4 },
          left: (s ? most + 20 : 0) + k * W,
          top: y + lab,
        }),
      ),
    );
  });
  await sharp({
    create: { width, height: stripRows.length * rowH, channels: 4, background: { r: 118, g: 170, b: 92, alpha: 1 } },
  })
    .composite(comps)
    .png()
    .toFile(join(outDir, `${id}-strip.png`));
  console.log(`${id}: ${stripRows.length} clips -> ${outDir}`);
}

if (import.meta.main) await main();
