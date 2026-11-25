// Build every map: node tools/map/build.ts
// Writes src/data/map/island.json, interiors.json and meet.json (the meeting meadow, outside the story world), and a labelled overview picture for a look.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { objects } from '../../src/data/objects.ts';
import {
  buildCave,
  buildCottage,
  buildHall,
  buildHouses,
  buildMine1,
  buildMine2,
  buildMine3,
  INTERIOR_MUSIC,
} from './interiors.ts';
import { buildIsland } from './island.ts';
import type { MapMaker } from './lib.ts';
import { buildMeet, checkMeet } from './meet.ts';
import { buildRooms, ROOM_MUSIC } from './rooms.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const COLORS: Record<string, [number, number, number]> = {
  g: [108, 190, 88],
  G: [126, 200, 70],
  d: [58, 120, 62],
  p: [214, 184, 132],
  k: [176, 170, 160],
  s: [238, 220, 160],
  m: [140, 100, 70],
  f: [200, 160, 110],
  t: [150, 150, 158],
  a: [96, 110, 84],
  b: [160, 110, 60],
  e: [200, 200, 200],
  o: [120, 80, 50],
  w: [80, 160, 230],
  W: [50, 120, 200],
  q: [100, 190, 230],
  u: [60, 110, 160],
  c: [110, 96, 86],
  r: [70, 64, 70],
  v: [20, 20, 28],
  h: [40, 100, 50],
};

async function overview(m: MapMaker, out: string, px = 6): Promise<void> {
  const w = m.w * px;
  const h = m.h * px;
  const buf = Buffer.alloc(w * h * 3);
  const dot = (x: number, y: number, c: [number, number, number], inset = 0) => {
    for (let j = inset; j < px - inset; j++)
      for (let i = inset; i < px - inset; i++) {
        const k = ((y * px + j) * w + x * px + i) * 3;
        buf[k] = c[0];
        buf[k + 1] = c[1];
        buf[k + 2] = c[2];
      }
  };
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) dot(x, y, COLORS[m.get(x, y)] ?? [255, 0, 255]);
  for (const o of m.objects) {
    const t = objects[o.type]!;
    if (t.flat && !t.interact) continue;
    const c: [number, number, number] = t.interact
      ? [255, 220, 40]
      : t.node
        ? t.node.tool === 'pick'
          ? [90, 90, 100]
          : t.node.tool === 'axe'
            ? [30, 90, 40]
            : [230, 90, 160]
        : t.solid
          ? [120, 60, 30]
          : [240, 240, 240];
    for (let j = 0; j < (t.h ?? 1); j++)
      for (let i = 0; i < (t.w ?? 1); i++) dot(o.x + i, o.y + j, c, (t.w ?? 1) > 1 || (t.h ?? 1) > 1 ? 0 : 1);
  }
  for (const b of m.barriers)
    for (let j = 0; j < b.rect.h; j++)
      for (let i = 0; i < b.rect.w; i++) dot(b.rect.x + i, b.rect.y + j, [255, 60, 60], 1);
  for (const d of m.doors) dot(d.x, d.y, [255, 0, 255]);
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">`;
  for (const name in m.places) {
    const p = m.places[name]!;
    svg += `<circle cx="${p.x * px + px / 2}" cy="${p.y * px + px / 2}" r="2" fill="#000"/>`;
    if (px >= 6)
      svg += `<text x="${p.x * px + px}" y="${p.y * px + 3}" font-family="Helvetica" font-size="7" fill="#000" stroke="#fff" stroke-width="2" paint-order="stroke">${name}</text>`;
  }
  svg += '</svg>';
  await sharp(buf, { raw: { width: w, height: h, channels: 3 } })
    .composite([{ input: Buffer.from(svg) }])
    .png()
    .toFile(out);
}

const maps = [
  buildIsland(),
  buildCottage(),
  buildMine1(),
  buildMine2(),
  buildMine3(),
  buildHall(),
  buildCave(),
  ...buildHouses(),
  ...buildRooms(),
];
const meet = buildMeet();
let bad = 0;
for (const m of maps)
  for (const msg of m.check()) {
    console.log(`  ${m.id}: ${msg}`);
    bad++;
  }
for (const msg of checkMeet(meet)) {
  console.log(`  meet: ${msg}`);
  bad++;
}
const dir = resolve(ROOT, 'src/data/map');
mkdirSync(dir, { recursive: true });
mkdirSync(resolve(ROOT, 'art/qa'), { recursive: true });
const island = maps[0]!;
writeFileSync(resolve(dir, 'island.json'), JSON.stringify(island.toArea({ music: 'day' })));
const inner: Record<string, unknown> = {};
for (const m of maps.slice(1))
  inner[m.id] = m.toArea({
    indoor: true,
    dark: m.id.startsWith('mine') || m.id === 'cave',
    music: ROOM_MUSIC[m.id] ?? INTERIOR_MUSIC[m.id] ?? 'home',
  });
writeFileSync(resolve(dir, 'interiors.json'), JSON.stringify(inner));
writeFileSync(resolve(dir, 'meet.json'), JSON.stringify(meet.toArea({ indoor: false, music: 'day' })));
await overview(meet, resolve(ROOT, 'art/qa/map-meet.png'), 16);
await overview(island, resolve(ROOT, 'art/qa/map-island.png'), 8);
for (const m of maps.slice(1)) await overview(m, resolve(ROOT, `art/qa/map-${m.id}.png`), 16);
const counts: Record<string, number> = {};
for (const o of island.objects) counts[o.type] = (counts[o.type] ?? 0) + 1;
console.log(
  `island: ${island.objects.length} objects, ${Object.keys(island.places).length} places, ${island.sites.length} sites, ${island.zones.length} zones`,
);
console.log(
  Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 14)
    .map(([k, v]) => `${k} ${v}`)
    .join(', '),
);
if (bad) {
  console.log(`MAP FAIL: ${bad} problems`);
  process.exit(1);
}
console.log('MAP OK');
