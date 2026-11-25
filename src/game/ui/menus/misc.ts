// Small dialogs: sign writing, build site needs, a project's card at its place, Buzz's star radar, and the finale group photo.
import { count } from '../../../core/cond.ts';
import { findSite, projectInfo } from '../../../core/quests.ts';
import { charName } from '../../../core/talk.ts';
import { askText } from '../../app.ts';
import { Sound } from '../../audio.ts';
import { touchState } from '../../input.ts';
import { Puppet } from '../../puppet.ts';
import type { UI } from '../../scenes/UI.ts';
import { metIds } from '../friends.ts';
import { GOLD, icon, INK, panel, SOFT, text, title, type Txt, W } from '../kit.ts';
import { Menu, within } from '../menu.ts';
import { register } from '../registry.ts';

/** Writing a sign: the words come from the normal text field over the game. */
export class SignTextMenu extends Menu {
  private asked = false;

  constructor(ui: UI, k: number) {
    super(ui, '');
    panel(this.g2, W / 2 - 400, 380, 800, 200);
    this.add(text(ui, W / 2, 440, 'Write on your sign!', 48).setOrigin(0.5, 0));
    this.asked = true;
    void askText(ui.game, 'What should the sign say?', '', 'Type, then press Enter or Done', 40).then((words) => {
      if (words) this.keys.send({ c: 'signtext', k, text: words });
      this.done = true;
    });
  }
  /** Touch: the words are typed in the text field over the game; a tap on the game does nothing. */
  tap(): boolean {
    return true;
  }
  update(dt: number): void {
    this.t += dt;
    // nothing to do while the text field is open; swallow stray presses
    if (this.asked) {
      this.act();
      this.back();
    }
  }
}

/** A menu that closes on any key press. */
abstract class AnyKeyMenu extends Menu {
  private hit = false;
  private onKey = (): void => {
    if (this.t > 0.25) this.hit = true;
  };

  constructor(ui: UI, help: string) {
    super(ui, help);
    ui.input.keyboard!.on('keydown', this.onKey);
  }
  /** Touch: any tap closes it, as any key does. */
  tap(): boolean {
    if (this.t > 0.25) this.done = true;
    return true;
  }
  update(dt: number): void {
    this.t += dt;
    this.act();
    this.back();
    if (this.hit) this.done = true;
  }
  close(): void {
    this.ui.input.keyboard?.off('keydown', this.onKey);
    super.close();
  }
}

export class SiteMenu extends AnyKeyMenu {
  constructor(ui: UI, id: string) {
    super(ui, 'Press any key to close');
    panel(this.g2, W / 2 - 520, 200, 1040, 640);
    const site = findSite(this.g, id);
    this.add(title(ui, W / 2, 230, site ? site.name : 'Building site', 56).setOrigin(0.5, 0));
    if (!site) {
      this.add(text(ui, W / 2, 440, 'Nothing to build here yet.', 40, SOFT).setOrigin(0.5, 0));
      return;
    }
    this.add(text(ui, W / 2, 320, 'This needs:', 38, SOFT).setOrigin(0.5, 0));
    let y = 400;
    for (const k in site.needs) {
      const need = site.needs[k]!;
      const have = Math.min(need, count(this.g, k));
      this.add(icon(ui, k, W / 2 - 300, y + 30, 64));
      this.add(text(ui, W / 2 - 230, y + 6, this.g.c.items[k]?.name ?? k, 40));
      this.add(
        text(ui, W / 2 + 440, y + 6, `${have} of ${need}`, 40, have >= need ? '#2e7d32' : '#b3261e').setOrigin(1, 0),
      );
      y += 84;
    }
  }
}

/**
 * Package 71 (D78): the card at a project's place: its name, what it needs and how many of each she has. When its job
 * can be taken, Space takes it here (the board's own start, toast and all) and the build site shows; when not, one
 * line says what comes first. X closes it.
 */
export class ProjectMenu extends Menu {
  private qid = '';
  private can = false;

  constructor(ui: UI, id: string) {
    const S = ui.g.c.strings;
    const info = projectInfo(ui.g, id);
    super(ui, (info?.can ? S.proj_keys_take : S.proj_keys_close) ?? '');
    panel(this.g2, W / 2 - 520, 200, 1040, 640);
    if (!info) {
      this.done = true;
      return;
    }
    this.qid = info.qid;
    this.can = info.can;
    const name = info.site.name.charAt(0).toUpperCase() + info.site.name.slice(1);
    this.add(title(ui, W / 2, 230, name, 56).setOrigin(0.5, 0));
    this.add(text(ui, W / 2, 316, 'This needs:', 36, SOFT).setOrigin(0.5, 0));
    let y = 380;
    for (const k in info.site.needs) {
      const need = info.site.needs[k]!;
      const have = Math.min(need, count(this.g, k));
      this.add(icon(ui, k, W / 2 - 300, y + 30, 64));
      this.add(text(ui, W / 2 - 230, y + 6, this.g.c.items[k]?.name ?? k, 40));
      this.add(
        text(ui, W / 2 + 440, y + 6, `${have} of ${need}`, 40, have >= need ? '#2e7d32' : '#b3261e').setOrigin(1, 0),
      );
      y += 80;
    }
    const line = info.can ? (S.proj_can ?? '') : info.why;
    this.add(text(ui, W / 2, Math.max(y + 24, 700), line, 40, info.can ? '#0d6a35' : INK, 900).setOrigin(0.5, 0));
  }
  /** Touch: a tap on the card takes the job when it can be taken; anywhere else closes it. */
  tap(x: number, y: number): boolean {
    if (this.t < 0.25) return true;
    if (this.can && within(x, y, W / 2 - 520, 200, 1040, 640)) this.take();
    else this.done = true;
    return true;
  }
  private take(): void {
    this.keys.send({ c: 'accept', quest: this.qid });
    Sound.sfx('pop');
    this.done = true;
  }
  update(dt: number): void {
    this.t += dt;
    const act = this.act();
    const back = this.back();
    if (this.t < 0.25) return;
    if (act && this.can) this.take();
    else if (act || back) this.done = true;
  }
}

export class RadarMenu extends AnyKeyMenu {
  constructor(ui: UI) {
    super(ui, 'Press any key to close');
    panel(this.g2, W / 2 - 520, 220, 1040, 600);
    this.add(title(ui, W / 2, 250, "Buzz's star radar", 56).setOrigin(0.5, 0));
    this.add(icon(ui, 'star_fragment', W / 2 - 200, 400, 96));
    this.add(text(ui, W / 2 - 120, 370, `Star bits found: ${count(this.g, 'star_fragment')}`, 44));
    const fell = !!this.g.s.flags.starnight;
    this.add(
      text(
        ui,
        W / 2,
        500,
        fell ? 'Beep beep! A star fell tonight!' : 'No star has fallen tonight.',
        42,
        fell ? '#b3541e' : INK,
      ).setOrigin(0.5, 0),
    );
    this.add(
      text(
        ui,
        W / 2,
        600,
        fell ? 'Look near the glowing spot on your map.' : 'Stars fall on some nights. Check again at dusk.',
        36,
        SOFT,
        900,
      ).setOrigin(0.5, 0),
    );
  }
}

const COLS = 6;
const CELL_W = 280;
const CELL_H = 270;
const SHOWN = 3;

export class PhotoMenu extends Menu {
  private ids: string[] = [];
  private need = 5;
  private picked = new Set<string>();
  private sel = 0;
  private top = 0;
  private puppets = new Map<string, Puppet>();
  private names: Txt[] = [];
  private count: Txt;
  /** issue 57: in the finale a tap beside the panel does nothing; only Back (X) skips the photo, on purpose */
  private finale: boolean;

  constructor(ui: UI, finale = false) {
    super(ui, `Arrows: move    Space: pick a friend    X: ${finale ? 'skip the photo' : 'back'}`);
    this.finale = finale;
    const g = this.g;
    // everyone she has met, from the same record as the journal's Friends page
    this.ids = metIds(g);
    this.need = Math.min(5, this.ids.length);
    panel(this.g2, 60, 40, 1800, 990);
    this.add(title(ui, W / 2, 56, 'Pick 5 friends for the photo!', 54).setOrigin(0.5, 0));
    this.count = this.add(text(ui, W - 120, 70, '', 38, SOFT).setOrigin(1, 0));
    if (this.ids.length === 0)
      this.add(text(ui, W / 2, 440, 'Meet some friends first, then come back!', 42, SOFT).setOrigin(0.5, 0));
    // on an iPad the keys line is hidden: say here which button skips the photo
    else if (finale && touchState.shown)
      this.add(text(ui, W / 2, 976, 'Back: skip the photo', 30, SOFT).setOrigin(0.5, 0));
    this.layout();
  }

  private layout(): void {
    for (const p of this.puppets.values()) p.destroy();
    this.puppets.clear();
    for (const n of this.names) n.destroy();
    this.names = [];
    const x0 = W / 2 - (COLS * CELL_W) / 2;
    for (let i = 0; i < COLS * SHOWN; i++) {
      const id = this.ids[this.top * COLS + i];
      if (!id) break;
      const cx = x0 + (i % COLS) * CELL_W + CELL_W / 2;
      const cy = 150 + Math.floor(i / COLS) * CELL_H;
      const def = this.g.c.chars[id]!;
      const p = new Puppet(this.ui, id, def.tall ?? 2, true);
      p.zoom = 1.1;
      p.setPos(cx, cy + 170);
      p.sprite.setDepth(80);
      p.play('idle', 'down');
      this.puppets.set(id, p);
      this.names.push(this.add(text(this.ui, cx, cy + 186, charName(this.g, id), 30).setOrigin(0.5, 0)));
    }
  }

  private draw(): void {
    const g = this.g2;
    g.clear();
    panel(g, 60, 40, 1800, 990);
    const x0 = W / 2 - (COLS * CELL_W) / 2;
    for (let i = 0; i < COLS * SHOWN; i++) {
      const idx = this.top * COLS + i;
      const id = this.ids[idx];
      if (!id) break;
      const x = x0 + (i % COLS) * CELL_W + 8;
      const y = 150 + Math.floor(i / COLS) * CELL_H;
      const on = this.picked.has(id);
      g.fillStyle(idx === this.sel ? GOLD : 0xb89a6a, 1).fillRoundedRect(x, y, CELL_W - 16, CELL_H - 16, 20);
      g.fillStyle(on ? 0xd8f5c8 : 0xfffbe8, 1).fillRoundedRect(x + 6, y + 6, CELL_W - 28, CELL_H - 28, 16);
      if (on) g.fillStyle(0x2e9d4a, 1).fillCircle(x + CELL_W - 52, y + 40, 24);
    }
    this.count.setText(`${this.picked.size} of ${this.need}`);
  }

  /** Touch: a friend's card picks or unpicks them (as Space), outside is back (but not in the finale: see `finale`). */
  tap(x: number, y: number): boolean {
    if (!this.ids.length || !within(x, y, 60, 40, 1800, 990)) {
      if (!this.ids.length || !this.finale) this.done = true;
      return true;
    }
    const c = Math.floor((x - (W / 2 - (COLS * CELL_W) / 2)) / CELL_W);
    const r = Math.floor((y - 150) / CELL_H);
    const at = (this.top + r) * COLS + c;
    if (c < 0 || c >= COLS || r < 0 || r >= SHOWN || at >= this.ids.length) return true;
    if (at !== this.sel) Sound.sfx('tick');
    this.sel = at;
    this.tapPick = true;
    return true;
  }

  update(dt: number): void {
    this.t += dt;
    for (const p of this.puppets.values()) p.update(dt);
    if (this.ids.length === 0) {
      if (this.act() || this.back()) this.done = true;
      return;
    }
    const n = this.nav(dt);
    if (n.x) this.sel = (this.sel + n.x + this.ids.length) % this.ids.length;
    if (n.y) this.sel = Math.max(0, Math.min(this.ids.length - 1, this.sel + n.y * COLS));
    const row = Math.floor(this.sel / COLS);
    const top = Math.max(0, Math.min(row - 1, Math.ceil(this.ids.length / COLS) - SHOWN));
    if (top !== this.top) {
      this.top = top;
      this.layout();
    }
    if (this.act()) {
      const id = this.ids[this.sel]!;
      if (this.picked.has(id)) this.picked.delete(id);
      else if (this.picked.size < this.need) this.picked.add(id);
      else Sound.sfx('nope');
      Sound.sfx('pick');
      if (this.picked.size === this.need) {
        this.keys.send({ c: 'photo', friends: [...this.picked] });
        this.done = true;
      }
    }
    if (this.back()) this.done = true;
    this.draw();
  }

  close(): void {
    for (const p of this.puppets.values()) p.destroy();
    this.puppets.clear();
    super.close();
  }
}

register('signtext', (ui, arg) => new SignTextMenu(ui, Number(arg)));
register('site', (ui, arg) => new SiteMenu(ui, arg ?? ''));
register('project', (ui, arg) => new ProjectMenu(ui, arg ?? ''));
register('radar', (ui) => new RadarMenu(ui));
register('photo', (ui) => new PhotoMenu(ui));
