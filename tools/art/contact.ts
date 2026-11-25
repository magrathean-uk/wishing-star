// Contact sheet: thumbnails of many images on one page, labelled, for a quick look.
//   node tools/art/contact.ts <out.png> [--cols 4] [--cell 320] <files...>
import { basename } from 'node:path';
import sharp, { type OverlayOptions } from 'sharp';

export async function contactSheet(out: string, files: string[], cols = 4, cell = 320, bg = '#8a8f9c'): Promise<void> {
  const rows = Math.ceil(files.length / cols);
  const label = 22;
  const comps: OverlayOptions[] = [];
  for (let i = 0; i < files.length; i++) {
    const x = (i % cols) * cell;
    const y = Math.floor(i / cols) * (cell + label);
    const buf = await sharp(files[i])
      .resize(cell - 8, cell - 8, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    comps.push({ input: buf, left: x + 4, top: y + 4 });
    const name = basename(files[i]!)
      .replace(/\.\w+$/, '')
      .replace(/[<&>]/g, '');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cell}" height="${label}"><rect width="100%" height="100%" fill="#22252e"/><text x="6" y="16" font-family="Helvetica" font-size="14" fill="#fff">${name}</text></svg>`;
    comps.push({ input: Buffer.from(svg), left: x, top: y + cell });
  }
  await sharp({ create: { width: cols * cell, height: rows * (cell + label), channels: 4, background: bg } })
    .composite(comps)
    .png()
    .toFile(out);
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const take = (name: string, d: number) => {
    const i = argv.indexOf(`--${name}`);
    if (i < 0) return d;
    const v = Number(argv[i + 1]);
    argv.splice(i, 2);
    return v;
  };
  const cols = take('cols', 4);
  const cell = take('cell', 320);
  const [out, ...files] = argv;
  await contactSheet(out!, files, cols, cell);
  console.log(out);
}
