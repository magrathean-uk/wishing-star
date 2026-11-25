// The board in the Square: up to 3 small jobs at a time, each a picture, a number and a few words. Space takes one.
import type Phaser from 'phaser';
import { boardJobs } from '../../../core/island.ts';
import { fill } from '../../../core/talk.ts';
import type { Game, QuestDef } from '../../../core/types.ts';
import { Sound } from '../../audio.ts';
import type { UI } from '../../scenes/UI.ts';
import { GOLD, icon, INK, makeUiTextures, panel, SOFT, text, title, type Txt, W } from '../kit.ts';
import { Menu, within } from '../menu.ts';
import { register } from '../registry.ts';

const CARD_W = 460;
const CARD_H = 420;
const TOP = 250;

/**
 * What a job asks for, as a picture and a number: the first step that names a thing. `kind` is that step's type,
 * so the number can be labelled ("Bring 8"); a place to find shows the place's own picture.
 */
export function jobPicture(q: QuestDef, g?: Game): { pic: string; n: number; kind: string } {
  for (const st of q.steps) {
    switch (st.t) {
      case 'site':
        // an island project (package 47b): the thing it builds, else the first thing it is paid in
        if (g) return { ...sitePicture(g, st.site), kind: 'site' };
        break;
      case 'fetch':
      case 'deliver':
      case 'craft':
      case 'place':
        return { pic: st.item, n: st.n ?? 1, kind: st.t };
      case 'grow':
        return { pic: st.crop, n: st.n ?? 1, kind: st.t };
      case 'fish':
        return { pic: st.kind ?? 'fishing_rod', n: st.n ?? 1, kind: st.t };
      case 'defeat':
        return { pic: `face_${st.mob}`, n: st.n ?? 1, kind: st.t };
      case 'lead':
        return { pic: `face_${st.animal}`, n: st.n ?? 1, kind: st.t };
      case 'reach':
        return { pic: placePicture(g, st.place), n: 1, kind: st.t };
      default:
        break;
    }
  }
  return { pic: `face_${q.giver}`, n: 1, kind: '' };
}

/** A place's picture: its Places sticker, else the landmark's art, else a signpost. */
function placePicture(g: Game | undefined, place: string): string {
  return g?.c.stickers['place_' + place]?.art ?? g?.c.landmarks?.[place]?.art ?? 'signpost';
}

/** A build site's picture: the object it puts up ('built_<site>'), else what it costs most of. */
function sitePicture(g: Game, site: string): { pic: string; n: number } {
  for (const id in g.c.areas) {
    const a = g.c.areas[id]!;
    const o = a.objects.find((x) => x.id === 'built_' + site);
    if (o) return { pic: g.c.objects[o.type]?.art ?? o.type, n: 1 };
    const b = a.sites.find((x) => x.id === site);
    if (b) {
      const [item, n] = Object.entries(b.needs).sort((p, q) => q[1] - p[1])[0] ?? ['plank', 1];
      return { pic: item, n };
    }
  }
  return { pic: 'plank', n: 1 };
}

/** At most 6 words: a board job is read at a glance. */
export function jobWords(g: Game, q: QuestDef): string {
  return fill(g, q.name).split(/\s+/).slice(0, 6).join(' ');
}

export class BoardMenu extends Menu {
  private ids: string[];
  private sel = 0;
  private box: Phaser.GameObjects.Graphics;
  private drawn = -1;

  constructor(ui: UI) {
    super(ui, 'Left and right: choose    Space: take this job    X: back');
    makeUiTextures(ui);
    const g = this.g;
    this.ids = boardJobs(g).slice(0, 3);
    const n = this.ids.length;
    const w = Math.max(1, n) * (CARD_W + 40) + 80;
    panel(this.g2, W / 2 - w / 2, 80, w, 680);
    this.add(title(ui, W / 2, 110, 'Jobs board', 60).setOrigin(0.5, 0));
    this.box = this.add(ui.add.graphics());
    if (!n) {
      this.add(
        text(ui, W / 2, 360, 'No jobs now.\nCome back tomorrow!', 44, SOFT)
          .setOrigin(0.5, 0)
          .setAlign('center'),
      );
      this.helpT?.setText('X: back');
      return;
    }
    this.ids.forEach((id, i) => {
      const q = g.c.quests[id]!;
      const x = this.cardX(i);
      const { pic, n: num, kind } = jobPicture(q, g);
      this.add(icon(ui, pic, x + CARD_W / 2, TOP + 130, 160));
      // the number with what it means ("Needs 10"), unless the job's own words already say it ("Bring 8 logs")
      const say = g.c.strings['job:' + kind];
      const words = jobWords(g, q);
      if (num > 1 && say && !words.split(/\s+/).includes(String(num))) {
        const t: Txt = this.add(title(ui, x + CARD_W / 2, TOP + 222, say.replace('{n}', String(num)), 46, '#b3541e'));
        t.setOrigin(0.5, 0);
      }
      this.add(
        text(ui, x + CARD_W / 2, TOP + 300, words, 38, INK, CARD_W - 60)
          .setOrigin(0.5, 0)
          .setAlign('center'),
      );
      if (g.s.quests[id] && !g.s.quests[id]!.done) this.add(ui.add.image(x + CARD_W - 40, TOP + 40, 'ui_tick'));
    });
  }

  private cardX(i: number): number {
    const n = this.ids.length;
    return W / 2 - (n * (CARD_W + 40) - 40) / 2 + i * (CARD_W + 40);
  }

  /** Touch: a job's card takes it (as Space), outside is back. */
  tap(x: number, y: number): boolean {
    const w = Math.max(1, this.ids.length) * (CARD_W + 40) + 80;
    if (!within(x, y, W / 2 - w / 2, 80, w, 680)) {
      this.done = true;
      return true;
    }
    const i = this.ids.findIndex((_, k) => within(x, y, this.cardX(k), TOP, CARD_W, CARD_H, 14));
    if (i < 0) return true;
    if (i !== this.sel) Sound.sfx('tick');
    this.sel = i;
    this.tapPick = true;
    return true;
  }

  update(dt: number): void {
    this.t += dt;
    const n = this.ids.length;
    const nav = this.nav(dt);
    if (n && nav.x) this.sel = (this.sel + nav.x + n) % n;
    if (n && this.act()) {
      const id = this.ids[this.sel]!;
      const q = this.g.s.quests[id];
      if (q && !q.done) Sound.sfx('nope');
      else {
        this.keys.send({ c: 'accept', quest: id });
        Sound.sfx('pick');
        this.done = true;
      }
    }
    if (this.back()) this.done = true;
    if (this.drawn === this.sel) return;
    this.drawn = this.sel;
    const b = this.box;
    b.clear();
    for (let i = 0; i < n; i++) {
      const x = this.cardX(i);
      const on = i === this.sel;
      b.fillStyle(on ? GOLD : 0xd9c59a, 1).fillRoundedRect(x, TOP, CARD_W, CARD_H, 26);
      b.fillStyle(on ? 0xfffbe8 : 0xfff3d0, 1).fillRoundedRect(x + 8, TOP + 8, CARD_W - 16, CARD_H - 16, 20);
    }
  }
}

register('board', (ui) => new BoardMenu(ui));
