// The island map (key M) and the signpost or minecart travel list.
import type Phaser from 'phaser';
import { routeFrom } from '../../../core/guide.ts';
import { denCentre, SEEN_CELL, seenAt } from '../../../core/island.ts';
import { charPlace, stepTarget } from '../../../core/quests.ts';
import type { AreaDef, Game, Place } from '../../../core/types.ts';
import { Sound } from '../../audio.ts';
import type { UI } from '../../scenes/UI.ts';
import { GOLD, icon, INK, makeUiTextures, outlined, panel, SOFT, text, title, type Txt } from '../kit.ts';
import { Menu, within } from '../menu.ts';
import { register } from '../registry.ts';

export const MAP_W = 1100;
const MX = 50;
const MY = 120;

const COLOURS: Record<string, number> = {
  g: 0x7bc96f,
  G: 0x6fb05f,
  d: 0x4c8f4a,
  p: 0xd9c08a,
  k: 0xb7b0a6,
  s: 0xf0dc9a,
  m: 0x8a6a4a,
  f: 0xc99a62,
  t: 0x8f8f98,
  a: 0x6a656a,
  b: 0xa8794a,
  e: 0xbdb3a0,
  o: 0x6b4a2b,
  w: 0x5fb4ff,
  W: 0x3d86d9,
  q: 0x6fc4ff,
  u: 0x3a6aa0,
  c: 0x756f69,
  r: 0x7d7d84,
  v: 0x1b2236,
  h: 0x2f6b34,
};

/** The island coloured once per set of lit regions (a canvas kept between openings). */
let base: { key: string; canvas: HTMLCanvasElement } | null = null;
const MAP_KEY = 'ui_map_now';

function baseCanvas(g: Game, area: AreaDef, lit: Set<string>, S: number): HTMLCanvasElement {
  const key = `${area.id}_${[...lit].sort().join('')}`;
  if (base?.key === key) return base.canvas;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(area.w * S);
  canvas.height = Math.round(area.h * S);
  const ctx = canvas.getContext('2d')!;
  const codes: Record<string, boolean> = {};
  for (const id in g.c.regions) codes[g.c.regions[id]!.code] = lit.has(id);
  for (let y = 0; y < area.h; y++) {
    const trow = area.terrain[y]!;
    const rrow = area.region[y]!;
    for (let x = 0; x < area.w; x++) {
      let c = COLOURS[trow.charAt(x)] ?? 0x888888;
      const on = codes[rrow.charAt(x)] ?? true;
      if (!on) {
        const r = ((c >> 16) & 255) * 0.42 + 40;
        const gg = ((c >> 8) & 255) * 0.42 + 44;
        const b = (c & 255) * 0.42 + 64;
        c = (Math.round(r) << 16) | (Math.round(gg) << 8) | Math.round(b);
      }
      ctx.fillStyle = `#${c.toString(16).padStart(6, '0')}`;
      ctx.fillRect(Math.floor(x * S), Math.floor(y * S), Math.ceil(S), Math.ceil(S));
    }
  }
  base = { key, canvas };
  return canvas;
}

/**
 * The map picture for this opening: the island, then soft cloud over every cell she has not seen. Built once when
 * the map opens (one texture), never per frame. The cloud is drawn one pixel a cell and stretched with smoothing,
 * which gives soft edges for nothing, then a few white puffs for the look of cloud.
 */
export function mapTexture(scene: Phaser.Scene, g: Game, area: AreaDef, lit: Set<string>, key = MAP_KEY): string {
  const S = MAP_W / area.w;
  const src = baseCanvas(g, area, lit, S);
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const tex = scene.textures.createCanvas(key, src.width, src.height)!;
  const ctx = tex.getContext();
  ctx.drawImage(src, 0, 0);
  const cols = Math.ceil(area.w / SEEN_CELL);
  const rows = Math.ceil(area.h / SEEN_CELL);
  // one pixel a cell, with a ring of cloud round the edge so the island's rim fades in too
  const mask = document.createElement('canvas');
  mask.width = cols + 2;
  mask.height = rows + 2;
  const m = mask.getContext('2d')!;
  m.fillStyle = 'rgb(233,238,247)';
  m.fillRect(0, 0, cols + 2, rows + 2);
  const clear: boolean[] = [];
  for (let cy = 0; cy < rows; cy++)
    for (let cx = 0; cx < cols; cx++) {
      const seen = seenAt(g, cx * SEEN_CELL, cy * SEEN_CELL);
      clear.push(seen);
      if (seen) m.clearRect(cx + 1, cy + 1, 1, 1);
    }
  const cell = SEEN_CELL * S;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(mask, -cell, -cell, (cols + 2) * cell, (rows + 2) * cell);
  // puffs: a few soft white circles in each cloudy cell, placed by a fixed pattern (the same every time)
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  for (let cy = 0; cy < rows; cy++)
    for (let cx = 0; cx < cols; cx++) {
      if (clear[cy * cols + cx]) continue;
      const h = (cx * 73 + cy * 151) % 97;
      for (let k = 0; k < 2; k++) {
        const px = (cx + 0.25 + (((h + k * 41) % 10) / 10) * 0.5) * cell;
        const py = (cy + 0.25 + (((h + k * 29) % 7) / 7) * 0.5) * cell;
        ctx.beginPath();
        ctx.arc(px, py, cell * (0.38 + ((h + k) % 5) * 0.05), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  tex.refresh();
  return key;
}

/** A den on the map and in its legend: a ring of stones. */
function denMark(d: Phaser.GameObjects.Graphics, x: number, y: number): void {
  d.fillStyle(0x3b2a1a, 0.55).fillCircle(x, y, 20);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    d.fillStyle(0x3b2a1a, 1).fillCircle(x + Math.cos(a) * 17, y + Math.sin(a) * 17, 6);
    d.fillStyle(0xb7b0a6, 1).fillCircle(x + Math.cos(a) * 17, y + Math.sin(a) * 17, 4);
  }
}

export class MapMenu extends Menu {
  private area: AreaDef | undefined;
  private S = 1;
  private signs: string[] = [];
  private travel: boolean;
  /** package 60: her walkable way to the goal on this map (tiles), made the first time it is drawn */
  private route: number[] | undefined;
  private cart: boolean;
  private sel = 0;
  private dyn: Phaser.GameObjects.Graphics;
  /** her dot, above every label and face */
  private top: Phaser.GameObjects.Graphics;
  private selT: Txt;
  private star: Phaser.GameObjects.Image;
  /** the legend's "Goal" row, dimmed while there is no goal */
  private goalKey: (Phaser.GameObjects.Image | Txt)[] = [];
  /** friend faces on the map, so labels can keep clear of them */
  private faceAt: { x: number; y: number }[] = [];

  constructor(ui: UI, arg?: string, travel = false) {
    super(ui, travel ? 'Left and right: choose a sign    Space: go there    X: back' : 'X: close');
    makeUiTextures(ui);
    this.travel = travel;
    this.cart = !!arg?.startsWith('cart:');
    const g = this.g;
    this.area = g.c.areas.island;
    panel(this.g2, MX - 24, MY - 30, MAP_W + 48, 870);
    this.add(
      // above the panel: the map picture would cover a title placed inside it
      title(ui, MX + MAP_W / 2, 16, travel ? (this.cart ? 'Minecart stops' : 'Where to?') : 'Island map', 54, '#ffffff')
        .setOrigin(0.5, 0)
        .setStroke('#23306e', 10),
    );
    panel(this.g2, 1190, MY - 30, 690, 870);
    this.dyn = ui.add.graphics();
    this.top = ui.add.graphics();
    this.star = ui.add.image(0, 0, 'ui_starbig').setVisible(false);
    this.legend();
    this.selT = this.add(text(ui, 1226, MY + 320, '', 44, '#b3541e', 620));
    if (!this.area) {
      this.add(text(ui, MX + 80, MY + 300, 'The map is not ready yet.', 40, SOFT));
      this.add(this.dyn);
      this.add(this.top);
      return;
    }
    this.S = MAP_W / this.area.w;
    const lit = new Set<string>();
    for (const id in g.c.regions) {
      const r = g.c.regions[id]!;
      if (r.safe || g.s.flags[`lit:${id}`]) lit.add(id);
    }
    const key = mapTexture(ui, g, this.area, lit);
    this.add(ui.add.image(MX, MY, key).setOrigin(0, 0));
    this.add(this.dyn);
    this.faces();
    // the goal star and her dot are kept clear of labels too, so no name is hidden under them
    for (const m of [g.rt.target, { area: g.s.area, x: Math.floor(g.s.x), y: Math.floor(g.s.y) }]) {
      const at = m ? this.onIsland(m) : null;
      if (at) this.faceAt.push(this.px(at));
    }
    this.labels(lit);
    this.dens();
    // her dot and the goal star sit above every label, face and den
    this.add(this.top);
    this.add(this.star);
    this.shardRow();
    this.signs = g.s.signs.filter((id) => g.c.areas.island?.places[`sign_${id}`]);
    const here = arg && !this.cart ? this.signs.indexOf(arg) : -1;
    this.sel = Math.max(0, here);
    if (!this.signs.length && travel) this.add(text(ui, 1226, MY + 320, 'No signposts found yet.', 36, SOFT, 620));
  }

  private px(p: { x: number; y: number }): { x: number; y: number } {
    return { x: MX + (p.x + 0.5) * this.S, y: MY + (p.y + 0.5) * this.S };
  }

  /**
   * A picture key naming every kind of mark the map draws: her dot, the goal star, a shop face, a signpost, a den
   * (and a cleared one), the "?" of a shard still to find, and the cloud over places not found yet.
   */
  private legend(): void {
    const ui = this.ui;
    const g = this.g;
    const S = g.c.strings;
    const k = this.add(ui.add.graphics());
    const col = [1250, 1560];
    const row = (i: number): number => MY + 40 + i * 64;
    const word = (c: number, r: number, s: string): Txt =>
      this.add(text(ui, col[c]! + 36, row(r), s, 32, INK).setOrigin(0, 0.5));
    // her dot
    k.fillStyle(0xffffff, 1).fillCircle(col[0]!, row(0), 22);
    k.lineStyle(3, 0x3b2a1a, 1).strokeCircle(col[0]!, row(0), 22);
    k.fillStyle(0xe63946, 1).fillCircle(col[0]!, row(0), 15);
    word(0, 0, 'You');
    // the goal star, dimmed while there is no goal
    this.goalKey = [this.add(ui.add.image(col[1]!, row(0), 'ui_starbig').setScale(0.6)), word(1, 0, 'Goal')];
    // a shop: the face of a shopkeeper she has met, in its ring
    const shop = Object.keys(g.c.chars).find((id) => g.c.chars[id]!.service?.startsWith('shop:') && g.s.met[id]);
    this.add(ui.add.circle(col[0]!, row(1), 24, 0xfff8e7, 1).setStrokeStyle(4, 0x3b2a1a));
    if (shop) this.add(icon(ui, `face_${shop}`, col[0]!, row(1), 36));
    word(0, 1, S.map_shop ?? '');
    // a signpost
    k.fillStyle(0x3b2a1a, 1).fillCircle(col[1]!, row(1), 11);
    k.fillStyle(GOLD, 1).fillCircle(col[1]!, row(1), 7);
    word(1, 1, S.map_sign ?? '');
    // a den, and a cleared one
    denMark(k, col[0]!, row(2));
    word(0, 2, S.map_den ?? '');
    denMark(k, col[1]!, row(2));
    this.add(ui.add.image(col[1]! + 16, row(2) - 16, 'ui_tick').setScale(0.55));
    word(1, 2, S.map_den_done ?? '');
    // a shard still to find, and the cloud
    this.add(outlined(ui, col[0]!, row(3), '?', 44).setOrigin(0.5, 0.5).setColor('#ffe27a'));
    word(0, 3, S.map_shard ?? '');
    k.fillStyle(0xe9eef7, 1).fillRoundedRect(col[1]! - 24, row(3) - 16, 48, 32, 14);
    k.fillStyle(0xffffff, 1)
      .fillCircle(col[1]! - 8, row(3) - 10, 12)
      .fillCircle(col[1]! + 10, row(3) - 6, 10);
    k.lineStyle(2, 0xb7c0cc, 1).strokeRoundedRect(col[1]! - 24, row(3) - 16, 48, 32, 14);
    word(1, 3, S.map_cloud ?? '');
  }

  /** Where a place shows on the island map: indoors, the door that leads to it. Null when it has no island spot. */
  private onIsland(p: { area: string; x: number; y: number }): { x: number; y: number } | null {
    const a = this.area!;
    if (p.area === a.id) return p;
    const g = this.g;
    const d = a.doors.find((o) => o.to === p.area);
    if (d) return { x: d.x, y: d.y };
    const out = g.c.areas[p.area]?.doors.find((o) => o.to === a.id);
    return out ? { x: out.tx, y: out.ty } : null;
  }

  private labels(lit: Set<string>): void {
    const a = this.area!;
    const g = this.g;
    const sums: Record<string, { x: number; y: number; n: number }> = {};
    for (let y = 0; y < a.h; y += 2) {
      for (let x = 0; x < a.w; x += 2) {
        const c = a.region[y]!.charAt(x);
        const s = (sums[c] ??= { x: 0, y: 0, n: 0 });
        s.x += x;
        s.y += y;
        s.n++;
      }
    }
    for (const id in g.c.regions) {
      const r = g.c.regions[id]!;
      const s = sums[r.code];
      if (!s || s.n < 6) continue;
      const p = this.px({ x: s.x / s.n, y: s.y / s.n });
      // under the cloud nothing is named: a region's name shows once she has found it
      if (!g.s.places[id]) continue;
      const on = lit.has(id);
      const t = this.add(outlined(this.ui, p.x, p.y, r.name.replace(/^the /i, ''), 26).setOrigin(0.5, 0.5));
      this.fit(t, p);
      t.setAlpha(on ? 1 : 0.7);
      if (!on && r.shard) {
        const q = this.add(outlined(this.ui, t.x, t.y + 36, '?', 44).setOrigin(0.5, 0.5));
        q.setColor('#ffe27a');
      }
    }
  }

  /** Keeps a label inside the map frame and clear of every friend face: tries spots near its own, nearest first. */
  private fit(t: Txt, p: { x: number; y: number }): void {
    const hw = t.width / 2 + 4;
    const hh = t.height / 2 + 2;
    const right = MX + MAP_W;
    const bottom = MY + this.area!.h * this.S;
    const clampX = (x: number): number => Math.max(MX + hw + 6, Math.min(right - hw - 6, x));
    const clampY = (y: number): number => Math.max(MY + hh + 6, Math.min(bottom - hh - 6, y));
    const hits = (x: number, y: number): boolean =>
      this.faceAt.some((f) => Math.abs(f.x - x) < hw + 26 && Math.abs(f.y - y) < hh + 26);
    for (const dy of [0, 40, -40, 80, -80])
      for (const dx of [0, 60, -60, 120, -120]) {
        const x = clampX(p.x + dx);
        const y = clampY(p.y + dy);
        if (!hits(x, y)) {
          t.setPosition(x, y);
          return;
        }
      }
    t.setPosition(clampX(p.x), clampY(p.y));
  }

  private faces(): void {
    const g = this.g;
    for (const id in g.c.chars) {
      const c = g.c.chars[id]!;
      // only people she has met
      if (!c.service?.startsWith('shop:') || !g.s.met[id]) continue;
      const p = charPlace(g, id);
      if (p?.area !== 'island') continue;
      const q = this.px(p);
      this.faceAt.push(q);
      this.add(this.ui.add.circle(q.x, q.y, 24, 0xfff8e7, 1).setStrokeStyle(4, 0x3b2a1a));
      this.add(icon(this.ui, `face_${id}`, q.x, q.y, 36));
    }
  }

  /** Dens she has seen: a ring of stones, with a tick once cleared. */
  private dens(): void {
    const g = this.g;
    // its own layer: the map picture lies over the panel graphics
    const dg = this.add(this.ui.add.graphics());
    for (const id in g.c.dens) {
      const st = g.s.dens[id];
      if (!st) continue;
      const c = denCentre(g, g.c.dens[id]!);
      if (!c) continue;
      const q = this.px({ x: c.x - 0.5, y: c.y - 0.5 });
      denMark(dg, q.x, q.y);
      if (st === 2) this.add(this.ui.add.image(q.x + 16, q.y - 16, 'ui_tick').setScale(0.55));
    }
  }

  private shardRow(): void {
    const g = this.g;
    this.add(text(this.ui, 1226, MY + 560, 'Star shards', 34, SOFT));
    for (let i = 0; i < 7; i++) {
      const x = 1226 + i * 88 + 36;
      const y = MY + 650;
      this.g2.fillStyle(i < g.s.shards ? 0xfff3b0 : 0x3b2a1a, 1).fillCircle(x, y, 38);
      if (i < g.s.shards) this.add(icon(this.ui, 'shard', x, y, 56));
      else this.add(text(this.ui, x, y, '?', 48, '#ffe27a').setOrigin(0.5, 0.5));
    }
    this.add(text(this.ui, 1226, MY + 710, `${g.s.shards} of 7 found`, 34, INK));
  }

  /**
   * Touch: outside both panels closes it. Travelling, a tap on a signpost dot goes there and a tap on the chosen
   * sign's name goes to it (as Space); on the plain map a tap inside does nothing.
   */
  tap(x: number, y: number): boolean {
    if (!within(x, y, MX - 24, MY - 30, MAP_W + 48, 870) && !within(x, y, 1190, MY - 30, 690, 870)) {
      this.done = true;
      return true;
    }
    const a = this.area;
    if (!this.travel || !a || !this.signs.length) return true;
    if (within(x, y, 1206, MY + 300, 660, 140)) {
      this.tapPick = true;
      return true;
    }
    let best = -1;
    let bestD = 48;
    this.signs.forEach((id, i) => {
      const q = this.px(a.places[`sign_${id}`]!);
      const d = Math.hypot(q.x - x, q.y - y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best < 0) return true;
    if (best !== this.sel) Sound.sfx('tick');
    this.sel = best;
    this.tapPick = true;
    return true;
  }

  update(dt: number): void {
    this.t += dt;
    const g = this.g;
    const a = this.area;
    const n = this.nav(dt);
    if (this.travel && this.signs.length && n.x) this.sel = (this.sel + n.x + this.signs.length) % this.signs.length;
    if (this.travel && this.signs.length && n.y) this.sel = (this.sel + n.y + this.signs.length) % this.signs.length;
    if (this.travel && this.signs.length && this.act()) {
      this.keys.send({ c: 'travel', sign: this.signs[this.sel]! });
      Sound.sfx('pick');
      this.done = true;
    }
    if (this.back() || (!this.travel && this.keys.take('KeyM'))) this.done = true;

    const d = this.dyn;
    d.clear();
    const pulse = 1 + Math.sin(this.t * 6) * 0.2;
    if (a) {
      // found signposts
      for (const id of this.signs) {
        const p = a.places[`sign_${id}`]!;
        const q = this.px(p);
        d.fillStyle(0x3b2a1a, 1).fillCircle(q.x, q.y, 11);
        d.fillStyle(GOLD, 1).fillCircle(q.x, q.y, 7);
      }
      if (this.travel && this.signs.length) {
        const p = a.places[`sign_${this.signs[this.sel]!}`]!;
        const q = this.px(p);
        d.lineStyle(7, 0xffffff, 1).strokeCircle(q.x, q.y, 24 * pulse);
        d.lineStyle(4, 0xff6a3a, 1).strokeCircle(q.x, q.y, 24 * pulse);
        const label = (p as Place).label ?? 'the Mine cart';
        this.selT.setText(label);
      } else this.selT.setText('');
      // the goal: a gold star, gently pulsing (indoors: on the door that leads there)
      const tg = g.rt.target ?? (g.s.tracked ? stepTarget(g, g.s.tracked) : null);
      const gp = tg ? this.onIsland(tg) : null;
      if (gp) {
        const q = this.px(gp);
        this.star
          .setPosition(q.x, q.y)
          .setScale(0.8 + Math.sin(this.t * 3) * 0.1)
          .setRotation(Math.sin(this.t * 2) * 0.12)
          .setVisible(true);
      } else this.star.setVisible(false);
      for (const o of this.goalKey) o.setAlpha(gp ? 1 : 0.35);
      // her: a big red dot in a white ring with a soft halo, the clearest mark on the map
      const top = this.top;
      top.clear();
      // package 60: the way she can walk to the goal, as a dotted line (the same way the helper arrow follows)
      if (!this.travel && g.s.area === a.id) {
        this.route ??= routeFrom(g, 3000);
        const r = this.route;
        for (let i = 4; i < r.length - 2; i += 6) {
          const q = this.px({ x: r[i]!, y: r[i + 1]! });
          top.fillStyle(0x3b2a1a, 0.9).fillCircle(q.x, q.y, 6);
          top.fillStyle(GOLD, 1).fillCircle(q.x, q.y, 4);
        }
      }
      const hp = this.onIsland({ area: g.s.area, x: g.s.x - 0.5, y: g.s.y - 0.5 });
      if (hp) {
        const q = this.px(hp);
        const halo = 1 + (Math.sin(this.t * 4) + 1) * 0.25;
        top.fillStyle(0xffffff, 0.35).fillCircle(q.x, q.y, 30 * halo);
        top.fillStyle(0xffffff, 1).fillCircle(q.x, q.y, 22);
        top.lineStyle(3, 0x3b2a1a, 1).strokeCircle(q.x, q.y, 22);
        top.fillStyle(0xe63946, 1).fillCircle(q.x, q.y, 15);
      }
    }
  }
}

register('map', (ui, arg) => new MapMenu(ui, arg, false));
register('travel', (ui, arg) => new MapMenu(ui, arg, true));
