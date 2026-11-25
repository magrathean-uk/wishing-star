// Fence pieces for runs down the screen, gate posts and pen corners (package 57b, D62), made by machine from the
// painted fence pieces in art/src/objects (no new images). Art is at 1.5 x screen size, so a tile is 96 px; every
// piece keeps its foot on the same row as the sideways piece, so they line up in a run.
//
//   node tools/art/fences.ts [--look <out.png>]
//
// For each of fence (pickets) and plot_fence (log rails), plain and snow:
//   <id>_r   a run down the screen: two rails running up to the tile above, the uprights standing at the foot
//   <id>_rt  the top end of a run with nothing beside it: a capped gate post
//   <id>_rb  the bottom end of a run with nothing beside it: rails up and a capped gate post at the foot
//   <id>_rc  a corner below a run: the sideways piece with the rails of the run coming down into it
//   <id>_gl, <id>_gr   the sideways piece ending at a gate: a capped post at its left or right end
// The view picks them by neighbours (src/game/world/things.ts fencePiece). Package 52's _v, _vt and _vc pieces (made
// by tools/map/bake.ts --fences) were thin poles that did not read as fence; they are no longer used.
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { alphaBox, blank, crop, type Img, load, over, resize, savePng } from './imgutil.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const OBJ = join(ROOT, 'art/src/objects');
const AT = 96;

/** brightness factor on a copy */
function shade(img: Img, k: number): Img {
  const out = { w: img.w, h: img.h, d: new Uint8Array(img.d) };
  for (let i = 0; i < out.d.length; i += 4)
    for (let c = 0; c < 3; c++) out.d[i + c] = Math.min(255, Math.round(out.d[i + c]! * k));
  return out;
}

/** turn a quarter clockwise */
function turn(img: Img): Img {
  const out = blank(img.h, img.w);
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++) {
      const s = (y * img.w + x) * 4;
      const t = (x * out.w + (img.h - 1 - y)) * 4;
      for (let c = 0; c < 4; c++) out.d[t + c] = img.d[s + c]!;
    }
  return out;
}

const cols = (img: Img, min = 128): number[] => {
  const n: number[] = [];
  for (let x = 0; x < img.w; x++) {
    let k = 0;
    for (let y = 0; y < img.h; y++) if (img.d[(y * img.w + x) * 4 + 3]! > min) k++;
    n.push(k);
  }
  return n;
};
const rows = (img: Img, min = 128): number[] => {
  const n: number[] = [];
  for (let y = 0; y < img.h; y++) {
    let k = 0;
    for (let x = 0; x < img.w; x++) if (img.d[(y * img.w + x) * 4 + 3]! > min) k++;
    n.push(k);
  }
  return n;
};
/** runs of indexes where pred holds */
function spans(xs: number[], pred: (v: number) => boolean): [number, number][] {
  const out: [number, number][] = [];
  xs.forEach((v, i) => {
    if (!pred(v)) return;
    const last = out[out.length - 1];
    if (last && last[1] === i - 1) last[1] = i;
    else out.push([i, i]);
  });
  return out;
}
const footOf = (img: Img): number => {
  const r = rows(img, 24);
  let f = img.h - 1;
  while (f > 0 && r[f] === 0) f--;
  return f;
};

interface Parts {
  /** the sideways piece */
  side: Img;
  /** an upright standing on its foot (bottom row = foot) */
  upright: Img;
  /** a capped gate post standing on its foot */
  post: Img;
  /** one rail, end on, as a strip down the screen as long as a tile plus its own thickness */
  rail: Img;
  /** the height of the lower rail above the foot */
  railUp: number;
  /** a second upright half a tile up (the pickets), or none (the log fence) */
  mid: boolean;
  /** foot row of the sideways piece and its height */
  foot: number;
}

async function parts(id: string, snow: boolean): Promise<Parts | null> {
  const sfx = snow ? '_snow' : '';
  const file = join(OBJ, `${id}${sfx}.png`);
  if (!existsSync(file)) return null;
  const side = await load(file);
  const plain = await load(join(OBJ, `${id}.png`));
  const foot = footOf(side);
  const H = plain.h;
  // the uprights: columns solid nearly top to bottom (measured on the plain piece, where no snow cap joins them)
  const c = cols(plain);
  const pFoot = footOf(plain);
  const ups = spans(c, (v) => v > (pFoot + 1) * 0.75);
  const rr = rows(plain);
  const rails = spans(rr, (v) => v > plain.w * 0.8);
  if (!ups.length || rails.length < 2) throw new Error(`${id}: uprights ${ups.length}, rails ${rails.length}`);
  // the snow piece is taller by its caps, at the top
  const dy = side.h - H;
  const mid = ups[Math.floor(ups.length / 2)]!;
  const upright0 = crop(side, { x0: mid[0] - 1, y0: 0, x1: mid[1] + 2, y1: foot + 1 });
  const ub = alphaBox(upright0, 8)!;
  const upright = crop(upright0, { x0: 0, y0: ub.y0, x1: upright0.w, y1: upright0.h });
  // a rail: a stretch of the lower rail where no upright crosses it, turned end on and stretched down a tile
  const lower = rails[rails.length - 1]!;
  let gap: [number, number] = [2, 2];
  for (let i = 0; i + 1 < ups.length; i++) {
    const g: [number, number] = [ups[i]![1] + 2, ups[i + 1]![0] - 2];
    if (g[1] - g[0] > gap[1] - gap[0]) gap = g;
  }
  if (ups[0]![0] - 4 > gap[1] - gap[0]) gap = [2, ups[0]![0] - 2];
  const thick = lower[1] - lower[0] + 1;
  const seg = crop(plain, { x0: gap[0], y0: lower[0], x1: gap[1] + 1, y1: lower[1] + 1 });
  const rail = await resize(turn(seg), Math.max(6, Math.round(thick * 0.95)), AT + thick);
  const railUp = pFoot - lower[1] + Math.round(thick / 2);
  // the capped gate post: the fence post picture for the pickets; a thicker, taller log for the log fence
  let post: Img;
  const fp = join(OBJ, `fence_post${sfx}.png`);
  if (id === 'fence' && existsSync(fp)) {
    const raw = await load(fp);
    const b = alphaBox(raw, 8)!;
    const p = crop(raw, { x0: b.x0, y0: b.y0, x1: b.x1, y1: footOf(raw) + 1 });
    const k = (side.h - dy) / p.h; // about as tall as the pickets, a little more
    post = await resize(p, p.w * k * 0.92, p.h * k * 1.12);
  } else post = await resize(upright, upright.w * 1.35, upright.h * 1.3);
  void dy;
  // pickets down a run are seen end on and foreshortened: shorter, so the rails show between them
  const runUp = id === 'fence' ? await resize(upright, upright.w, upright.h * 0.7) : upright;
  return { side, upright: runUp, post, rail, railUp, mid: id === 'fence', foot };
}

/** the canvas of a run piece: as wide as the sideways piece, tall enough for a tile of rails and the uprights */
function canvas(p: Parts): { img: Img; foot: number; cx: number } {
  const below = p.side.h - 1 - p.foot;
  const h = AT + p.side.h + 8;
  return { img: blank(p.side.w, h), foot: h - 1 - below, cx: Math.round(p.side.w / 2) };
}

/** the two rails from this foot up to the tile above */
function rails(img: Img, p: Parts, foot: number, cx: number): void {
  const top = foot - p.railUp - AT;
  // the pickets stand between the two rails, so the rails show either side of them
  const off = p.mid ? Math.round(p.upright.w / 2 + p.rail.w * 0.15) : Math.round(p.rail.w * 0.75);
  over(img, shade(p.rail, 0.86), cx + off - Math.round(p.rail.w / 2), top);
  over(img, p.rail, cx - off - Math.round(p.rail.w / 2), top);
}
// the pickets down a run between the foot uprights: two more, a third of a tile apart, so the run reads as pickets
const mids = (img: Img, p: Parts, foot: number, cx: number): void => {
  if (!p.mid) return;
  for (const k of [2, 1]) stand(img, p.upright, foot - Math.round((AT * k) / 3), cx, 0.95);
};
const stand = (img: Img, part: Img, foot: number, cx: number, k = 1): void =>
  over(img, k === 1 ? part : shade(part, k), cx - Math.round(part.w / 2), foot - part.h + 1);

async function make(id: string, snow: boolean): Promise<string[]> {
  const p = await parts(id, snow);
  if (!p) return [];
  const sfx = snow ? '_snow' : '';
  const made: string[] = [];
  const save = async (img: Img, name: string) => {
    await savePng(img, join(OBJ, `${id}_${name}${sfx}.png`));
    made.push(`${id}_${name}${sfx}`);
  };
  // _h: the sideways piece under its own name (the item icon "fence" shares the plain name, and the view may draw
  // that instead)
  await save(p.side, 'h');
  // _r: rails up, an upright half way up (pickets), an upright at the foot
  {
    const { img, foot, cx } = canvas(p);
    rails(img, p, foot, cx);
    mids(img, p, foot, cx);
    stand(img, p.upright, foot, cx);
    await save(img, 'r');
  }
  // _rt: a capped post
  {
    const { img, foot, cx } = canvas(p);
    stand(img, p.post, foot, cx);
    await save(img, 'rt');
  }
  // _rb: rails up and a capped post at the foot
  {
    const { img, foot, cx } = canvas(p);
    rails(img, p, foot, cx);
    mids(img, p, foot, cx);
    stand(img, p.post, foot, cx);
    await save(img, 'rb');
  }
  // _rc: the run's rails coming down into the sideways piece
  {
    const { img, foot, cx } = canvas(p);
    rails(img, p, foot, cx);
    mids(img, p, foot, cx);
    over(img, p.side, 0, foot - p.foot);
    await save(img, 'rc');
  }
  // _rk: the top of a run whose corner tile is empty but whose row above starts beside it (a pen drawn with its
  // corners cut): the run carries the corner piece itself, so the top row and the side meet
  {
    const { img, foot, cx } = canvas(p);
    over(img, p.side, 0, foot - AT - p.foot);
    rails(img, p, foot, cx);
    mids(img, p, foot, cx);
    stand(img, p.upright, foot, cx);
    await save(img, 'rk');
  }
  // _gl, _gr: the sideways piece with a capped post at the gate end
  for (const [name, left] of [
    ['gl', true],
    ['gr', false],
  ] as const) {
    const img = blank(p.side.w, Math.max(p.side.h, p.post.h + (p.side.h - 1 - p.foot) + 2));
    const foot = img.h - 1 - (p.side.h - 1 - p.foot);
    over(img, p.side, 0, foot - p.foot);
    stand(img, p.post, foot, left ? Math.round(p.post.w / 2) : p.side.w - Math.round(p.post.w / 2));
    await save(img, name);
  }
  return made;
}

/** The piece a fence tile shows, from which neighbours of its kind stand around it (the same rule as fencePiece in
 * src/game/world/things.ts). */
export function fenceChoice(id: string, at: (dx: number, dy: number) => boolean): string {
  const up = at(0, -1);
  const down = at(0, 1);
  const l = at(-1, 0);
  const r = at(1, 0);
  if (up || down) {
    if (l || r) return up ? `${id}_rc` : `${id}_h`;
    if (!up && (at(-1, -1) || at(1, -1))) return `${id}_rk`;
    return up ? (down ? `${id}_r` : `${id}_rb`) : `${id}_rt`;
  }
  if (l === r) return `${id}_h`;
  // a run that stops with more fence a few tiles on in the same row: a gate, so a capped post at that end
  const dir = l ? 1 : -1;
  for (let k = 2; k <= 5; k++) if (at(dir * k, 0)) return `${id}_${l ? 'gr' : 'gl'}`;
  return `${id}_h`;
}

/** a mock pen at game size on grass: a closed run, corners, a gate in the bottom side, and a run with a gate in it */
async function look(out: string): Promise<void> {
  const T = 64;
  const W = 15 * T;
  const Hh = 8 * T;
  const img = blank(W, Hh);
  for (let i = 0; i < img.d.length; i += 4) img.d.set([104, 140, 74, 255], i);
  for (const [n, id] of [
    [0, 'fence'],
    [1, 'plot_fence'],
  ] as const) {
    const ox = n * 7 + 1;
    // pen 5 wide, 5 tall: top row (the log pen with its top corners cut, as the little pen is), sides, a gate below
    const at = new Map<string, string>();
    for (let x = n ? 1 : 0; x < (n ? 4 : 5); x++) at.set(`${x},1`, id);
    for (let y = 2; y < 6; y++) {
      at.set(`0,${y}`, id);
      at.set(`4,${y}`, id);
    }
    for (const x of [0, 1, 3, 4]) at.set(`${x},6`, id);
    const has = (x: number, y: number) => at.has(`${x},${y}`);
    const cells = [...at.keys()].map((k) => k.split(',').map(Number) as [number, number]).sort((a, b) => a[1] - b[1]);
    for (const [x, y] of cells) {
      const piece = fenceChoice(id, (dx, dy) => has(x + dx, y + dy));
      const src = await load(join(OBJ, `${piece}.png`));
      const s = await resize(src, src.w / 1.5, src.h / 1.5);
      over(img, s, Math.round((ox + x + 0.5) * T - s.w / 2), Math.round((y + 1) * T - s.h));
    }
  }
  await savePng(img, out);
}

const args = process.argv.slice(2);
const made: string[] = [];
for (const id of ['fence', 'plot_fence']) for (const snow of [false, true]) made.push(...(await make(id, snow)));
console.log(`fence pieces: ${made.length} -> art/src/objects (run node tools/art/pack.ts)`);
const li = args.indexOf('--look');
if (li >= 0) await look(args[li + 1]!);
