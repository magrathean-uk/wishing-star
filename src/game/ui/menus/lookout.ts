// Package 73a (I3): looking out from a telescope or a lamp room window. While the rules say she is looking out
// (`rt.look`, src/core/lookout.ts), the island from above shows: the M screen's own picture, the names of the regions
// she has found, a ring where she stands and, from the lamp room at night with the lamp on, its beam. It is built once
// when the look begins (one texture, as the map is) and fades out when the rules end it.
import Phaser from 'phaser';
import { LAMP_ROOM, lampShines } from '../../../core/lamp.ts';
import type { Game } from '../../../core/types.ts';
import { H, LAYER, outlined, panel, W } from '../kit.ts';
import { MAP_W, mapTexture } from './map.ts';

const KEY = 'ui_map_look';

/** The lamp's beam (made once, shared with the world view): a long wedge from its left middle, brighter near the lamp,
 * soft at its edges (three wedges laid over). */
export function beamTexture(scene: Phaser.Scene): string {
  if (scene.textures.exists('fx_beam')) return 'fx_beam';
  const tex = scene.textures.createCanvas('fx_beam', 512, 192)!;
  const c = tex.getContext();
  for (const [spread, a] of [
    [92, 0.18],
    [62, 0.22],
    [34, 0.3],
  ] as const) {
    const grd = c.createLinearGradient(0, 0, 512, 0);
    grd.addColorStop(0, `rgba(255,244,200,${a})`);
    grd.addColorStop(0.6, `rgba(255,236,180,${a * 0.5})`);
    grd.addColorStop(1, 'rgba(255,230,170,0)');
    c.fillStyle = grd;
    c.beginPath();
    c.moveTo(0, 92);
    c.lineTo(512, 96 - spread);
    c.lineTo(512, 96 + spread);
    c.lineTo(0, 100);
    c.closePath();
    c.fill();
  }
  tex.refresh();
  return 'fx_beam';
}

export class LookView {
  private scene: Phaser.Scene;
  private box: Phaser.GameObjects.Container | null = null;
  private ring: Phaser.GameObjects.Graphics | null = null;
  private beam: Phaser.GameObjects.Image | null = null;
  private t = 0;
  private leaving = false;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  /** Every frame: show, pulse and hide the picture as the rules' look-out begins and ends. */
  update(g: Game, dt: number): void {
    const on = !!g.rt.look;
    if (on && (!this.box || this.leaving)) this.build(g);
    if (!this.box) return;
    this.t += dt;
    if (!on && !this.leaving) {
      this.leaving = true;
      this.t = 0;
    }
    if (this.leaving) {
      this.box.setAlpha(Math.max(0, 1 - this.t / 0.25));
      if (this.t >= 0.25) this.clear();
      return;
    }
    this.box.setAlpha(Math.min(1, this.t / 0.25));
    const k = 1 + Math.sin(this.t * 5) * 0.12;
    this.ring?.setScale(k);
    if (this.beam && !g.rt.paused) this.beam.rotation += dt * 0.5;
  }

  private clear(): void {
    this.box?.destroy();
    this.box = null;
    this.ring = null;
    this.beam = null;
  }

  private build(g: Game): void {
    this.clear();
    this.t = 0;
    this.leaving = false;
    const sc = this.scene;
    const isle = g.c.areas.island;
    const box = sc.add.container(0, 0).setDepth(LAYER.card);
    this.box = box;
    box.add(sc.add.rectangle(0, 0, W, H, 0x0b1430, 0.6).setOrigin(0, 0));
    if (!isle) return;
    const S = MAP_W / isle.w;
    const ph = isle.h * S;
    const mx = (W - MAP_W) / 2;
    const my = (H - ph) / 2;
    const frame = sc.add.graphics();
    panel(frame, mx - 22, my - 22, MAP_W + 44, ph + 44);
    box.add(frame);
    const lit = new Set<string>();
    for (const id in g.c.regions) if (g.c.regions[id]!.safe || g.s.flags[`lit:${id}`]) lit.add(id);
    box.add(sc.add.image(mx, my, mapTexture(sc, g, isle, lit, KEY)).setOrigin(0, 0));
    const at = (x: number, y: number) => ({ x: mx + (x + 0.5) * S, y: my + (y + 0.5) * S });
    // the names of the regions she has found, where the region lies
    const sums: Record<string, { x: number; y: number; n: number }> = {};
    for (let y = 0; y < isle.h; y += 3)
      for (let x = 0; x < isle.w; x += 3) {
        const s = (sums[isle.region[y]!.charAt(x)] ??= { x: 0, y: 0, n: 0 });
        s.x += x;
        s.y += y;
        s.n++;
      }
    for (const id in g.c.regions) {
      const r = g.c.regions[id]!;
      const s = sums[r.code];
      if (!s || s.n < 4 || !g.s.places[id]) continue;
      const p = at(s.x / s.n, s.y / s.n);
      box.add(outlined(sc, p.x, p.y, r.name.replace(/^the /i, ''), 26).setOrigin(0.5, 0.5));
    }
    // the lamp's beam, from the lamp room at night with the lamp on
    const lh = isle.objects.find((o) => o.type === 'lighthouse');
    if (lh && g.s.area === LAMP_ROOM && lampShines(g)) {
      const p = at(lh.x + 1, lh.y);
      this.beam = sc.add
        .image(p.x, p.y, beamTexture(sc))
        .setOrigin(0, 0.5)
        .setScale(0.6, 0.5)
        .setRotation(-Math.PI / 2)
        .setBlendMode(Phaser.BlendModes.ADD);
      box.add(this.beam);
    }
    // a ring where she stands: indoors, at the door of the building she is in
    let here = { x: Math.floor(g.s.x), y: Math.floor(g.s.y) };
    if (g.s.area !== isle.id) {
      let room = g.s.area;
      // up the lighthouse stairs: the door of the tower
      for (let i = 0; i < 4 && !isle.doors.some((d) => d.to === room); i++)
        room = g.c.areas[room]?.doors.find((d) => d.to !== 'island')?.to ?? room;
      const d = isle.doors.find((q) => q.to === room);
      if (d) here = { x: d.x, y: d.y };
    }
    const p = at(here.x, here.y);
    const ring = sc.add.graphics().setPosition(p.x, p.y);
    ring.lineStyle(10, 0x3b2a1a, 1).strokeCircle(0, 0, 26);
    ring.lineStyle(6, 0xffd24a, 1).strokeCircle(0, 0, 26);
    ring.fillStyle(0xe63946, 1).fillCircle(0, 0, 9);
    box.add(ring);
    this.ring = ring;
    box.setAlpha(0);
  }
}
