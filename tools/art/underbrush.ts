// Slice the graphics-2 foliage sheets into world-sized art frames.
//   node tools/art/underbrush.ts [master.png ...]
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { blank, load, over, resize, toSharp } from './imgutil.ts';
import { sliceSheet } from './process.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const MASTERS = join(ROOT, 'art/masters/graphics2');
const OBJECTS = join(ROOT, 'art/src/objects');

const SHEETS: { master: string; names: string[]; cols?: number; rows?: number; groundCover?: boolean }[] = [
  {
    master: 'underbrush-stones.png',
    names: [
      'rock_v1',
      'rock_v2',
      'boulder_v1',
      'boulder_v2',
      'cracked_rock_v1',
      'cracked_rock_v2',
      'bush_v1',
      'bush_v2',
      'fern_v1',
    ],
  },
  {
    master: 'underbrush-flowers.png',
    names: [
      'thorn_bush_v1',
      'thorn_bush_v2',
      'reeds_v1',
      'reeds_v2',
      'flower_red_v1',
      'flower_yellow_v1',
      'flower_blue_v1',
      'flower_white_v1',
      'flower_pink_v1',
    ],
  },
  {
    master: 'underbrush-wildflowers.png',
    names: [
      'sunflower_wild_v1',
      'mushroom_v1',
      'mushroom_v2',
      'wheat_wild_v1',
      'wheat_wild_v2',
      'pumpkin_wild_v1',
      'rock_v3',
      'boulder_v3',
      'bush_v3',
    ],
  },
  {
    master: 'underbrush-stones-snow.png',
    names: [
      'rock_v1_snow',
      'rock_v2_snow',
      'boulder_v1_snow',
      'boulder_v2_snow',
      'bush_v1_snow',
      'bush_v2_snow',
      'fern_v1_snow',
      'thorn_bush_v1_snow',
      'thorn_bush_v2_snow',
    ],
  },
  {
    master: 'underbrush-flowers-snow.png',
    names: [
      'reeds_v1_snow',
      'reeds_v2_snow',
      'mushroom_v1_snow',
      'mushroom_v2_snow',
      'wheat_wild_v1_snow',
      'wheat_wild_v2_snow',
      'rock_v3_snow',
      'boulder_v3_snow',
      'bush_v3_snow',
    ],
  },
  {
    master: 'ground-cover.png',
    names: Array.from({ length: 9 }, (_, i) => `wind_grass_${String(i + 10).padStart(2, '0')}`),
    groundCover: true,
  },
  {
    master: 'underbrush-rim-ores.png',
    names: [
      'hedge_v1',
      'hedge_v2',
      'hedge_v3',
      'rim_rock_v1',
      'rim_rock_v2',
      'coal_rock_v1',
      'iron_rock_v1',
      'gold_rock_v1',
      'diamond_rock_v1',
    ],
  },
  {
    master: 'underbrush-hedges-snow.png',
    cols: 1,
    rows: 3,
    names: ['hedge_v1_snow', 'hedge_v2_snow', 'hedge_v3_snow'],
  },
  {
    master: 'underbrush-coloured-flowers-snow.png',
    cols: 3,
    rows: 2,
    names: [
      'flower_red_v1_snow',
      'flower_yellow_v1_snow',
      'flower_blue_v1_snow',
      'flower_white_v1_snow',
      'flower_pink_v1_snow',
      '',
    ],
  },
];

function baseName(name: string): string {
  const stem = name.replace(/_v\d+_snow$/, '').replace(/_v\d+$/, '');
  return name.endsWith('_snow') ? `${stem}_snow` : stem;
}

async function saveVariant(name: string, image: Awaited<ReturnType<typeof sliceSheet>>[number]['img']): Promise<void> {
  const base = await load(join(OBJECTS, baseName(name) + '.png'));
  const scale = Math.min((base.w - 4) / image.w, (base.h - 2) / image.h);
  const art = await resize(image, Math.max(1, Math.round(image.w * scale)), Math.max(1, Math.round(image.h * scale)));
  const canvas = blank(base.w, base.h);
  over(canvas, art, Math.floor((base.w - art.w) / 2), base.h - art.h);
  await toSharp(canvas)
    .png({ compressionLevel: 9 })
    .toFile(join(OBJECTS, `${name}.png`));
}

async function saveGroundCover(names: string[], cells: Awaited<ReturnType<typeof sliceSheet>>): Promise<void> {
  const reference = await load(join(OBJECTS, 'wind_grass_01.png'));
  mkdirSync(OBJECTS, { recursive: true });
  for (const [index, name] of names.entries()) {
    const source = cells[index]!.img;
    const scale = Math.min(166 / source.w, 148 / source.h);
    const plant = await resize(source, Math.round(source.w * scale), Math.round(source.h * scale));
    const canvas = blank(reference.w, reference.h);
    over(canvas, plant, Math.floor((canvas.w - plant.w) / 2), 174 - plant.h);
    await toSharp(canvas)
      .png({ compressionLevel: 9 })
      .toFile(join(OBJECTS, `${name}.png`));
  }
}

let made = 0;
const requested = new Set(process.argv.slice(2));
for (const sheet of SHEETS) {
  if (requested.size && !requested.has(sheet.master)) continue;
  const path = join(MASTERS, sheet.master);
  if (!existsSync(path)) {
    console.log(`skip ${sheet.master}: master not present`);
    continue;
  }
  const cells = await sliceSheet(path, sheet.cols ?? 3, sheet.rows ?? 3);
  if ('groundCover' in sheet && sheet.groundCover) await saveGroundCover(sheet.names, cells);
  else {
    mkdirSync(OBJECTS, { recursive: true });
    for (const [index, name] of sheet.names.entries()) if (name) await saveVariant(name, cells[index]!.img);
  }
  const count = sheet.names.filter(Boolean).length;
  made += count;
  console.log(`${sheet.master}: ${count} images -> art/src/objects`);
}
console.log(`underbrush: ${made} images prepared`);
