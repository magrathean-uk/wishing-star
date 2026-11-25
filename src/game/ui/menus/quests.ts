// The quest book (key Q): three goals (a minute, ten minutes, an hour), the active quests, and a count of finished ones.
import type Phaser from 'phaser';
import { test } from '../../../core/cond.ts';
import { goalLine } from '../../../core/goal.ts';
import { activeQuests, objective, progress } from '../../../core/quests.ts';
import { charName, fill } from '../../../core/talk.ts';
import type { Game } from '../../../core/types.ts';
import { Sound } from '../../audio.ts';
import type { UI } from '../../scenes/UI.ts';
import { GOLD, INK, panel, SOFT, text, title, type Txt, W } from '../kit.ts';
import { Menu, within } from '../menu.ts';
import { register } from '../registry.ts';

const ROWS = 5;

/** Ten-minute goal: the next thing to build, or the next tool to find. */
function tenMinutes(g: Game): string {
  const qid = g.s.tracked;
  const q = qid ? g.c.quests[qid] : undefined;
  const st = q && qid ? q.steps[g.s.quests[qid]?.step ?? -1] : undefined;
  if (st && st.t === 'site') {
    const site = g.c.areas.island?.sites.find((s) => s.id === st.site);
    if (site) return `Build ${site.name}`;
  }
  for (const site of g.c.areas.island?.sites ?? []) {
    if (!g.s.flags[site.flag] && test(g, site.if)) return `Build ${site.name}`;
  }
  const tools = ['pick', 'axe', 'spade', 'rod', 'bucket', 'wellies', 'boat'];
  for (const t of tools) {
    const owned = Object.keys(g.s.pouch).some((id) => g.c.items[id]?.tool?.type === t || id === t);
    if (!owned && g.c.items[t]) return `Find the ${g.c.items[t]!.name}`;
  }
  return 'Keep exploring the island';
}

/** One-hour goal: shards and the next friend who can be your hero. */
function oneHour(g: Game): string {
  const left = 7 - g.s.shards;
  const next = Object.keys(g.c.heroes).find((id) => !g.s.heroes.includes(id));
  const a = left > 0 ? `Find the shards: ${g.s.shards} of 7` : 'All 7 shards are found!';
  return next ? `${a}\nMeet ${charName(g, next)}` : a;
}

export class QuestMenu extends Menu {
  private list: string[] = [];
  private sel = 0;
  private top = 0;
  private box: Phaser.GameObjects.Graphics;
  private rows: Txt[] = [];
  private bars: Txt[] = [];
  private oneT: Txt;
  private tenT: Txt;
  private hourT: Txt;
  private countT: Txt;
  private noteT: Txt;
  private moreT: Txt;
  private drawn = '';

  constructor(ui: UI) {
    super(ui, 'Up and down: choose    Space: follow this quest    X: back');
    panel(this.g2, W / 2 - 800, 70, 1600, 930);
    this.add(title(ui, W / 2, 86, 'Quest book', 56).setOrigin(0.5, 0));
    this.add(text(ui, W / 2 - 760, 170, 'Right now', 30, '#b3541e'));
    this.oneT = this.add(text(ui, W / 2 - 760, 206, '', 38, INK, 1500));
    this.add(text(ui, W / 2 - 760, 290, 'Next', 30, '#b3541e'));
    this.tenT = this.add(text(ui, W / 2 - 760, 326, '', 36, INK, 700));
    this.add(text(ui, W / 2 + 20, 290, 'Big goal', 30, '#b3541e'));
    this.hourT = this.add(text(ui, W / 2 + 20, 326, '', 36, INK, 740));
    this.add(text(ui, W / 2 - 760, 450, 'Your quests', 30, '#b3541e'));
    this.countT = this.add(text(ui, W / 2 + 760, 450, '', 30, SOFT).setOrigin(1, 0));
    this.box = this.add(ui.add.graphics());
    for (let i = 0; i < ROWS; i++) {
      this.rows.push(this.add(text(ui, W / 2 - 740, 500 + i * 90 + 8, '', 36, INK, 1100)));
      this.bars.push(this.add(text(ui, W / 2 + 740, 500 + i * 90 + 12, '', 32, SOFT).setOrigin(1, 0)));
    }
    this.noteT = this.add(text(ui, W / 2 - 740, 540, 'No quests yet. Talk to your friends!', 38, SOFT));
    this.moreT = this.add(text(ui, W / 2, 955 - 6, '', 28, SOFT).setOrigin(0.5, 0));
    this.refresh();
  }

  private refresh(): void {
    const g = this.g;
    this.list = activeQuests(g);
    // drawn again only when something changed, not every frame (the Dell laptop, D37)
    // package 68: "Right now" is the banner's own line (the going while she is far, the doing once there)
    const gl = goalLine(g);
    const now = gl && !gl.den && gl.qid === g.s.tracked ? gl.text + (gl.num ? `  (${gl.num})` : '') : '';
    const key = `${this.sel}|${g.s.tracked}|${now}|${this.list.join(',')}|${this.list.map((id) => progress(g, id)?.[0] ?? '').join(',')}`;
    if (key === this.drawn) return;
    this.drawn = key;
    if (this.sel >= this.list.length) this.sel = Math.max(0, this.list.length - 1);
    const tr = g.s.tracked && g.s.quests[g.s.tracked] && !g.s.quests[g.s.tracked]!.done ? g.s.tracked : this.list[0];
    this.oneT.setText(now || (tr ? objective(g, tr) || 'Talk to your friends' : 'Talk to your friends'));
    this.tenT.setText(tenMinutes(g));
    this.hourT.setText(oneHour(g));
    const done = Object.values(g.s.quests).filter((q) => q.done).length;
    this.countT.setText(`${done} finished`);
    this.noteT.setVisible(this.list.length === 0);
    this.top = Math.max(0, Math.min(this.sel - 2, this.list.length - ROWS));
    this.box.clear();
    for (let i = 0; i < ROWS; i++) {
      const id = this.list[this.top + i];
      const y = 500 + i * 90;
      if (!id) {
        this.rows[i]!.setText('');
        this.bars[i]!.setText('');
        continue;
      }
      const chosen = this.top + i === this.sel;
      this.box.fillStyle(chosen ? GOLD : 0xe8d9b5, 1).fillRoundedRect(W / 2 - 760, y, 1520, 80, 18);
      this.box.fillStyle(0xfffdf2, 1).fillRoundedRect(W / 2 - 754, y + 6, 1508, 68, 14);
      // issue 61: a name with a token ("{dad}'s Treasure Trail") reads as the game says it everywhere else
      const nm = fill(g, g.c.quests[id]?.name ?? id);
      this.rows[i]!.setText(`${id === g.s.tracked ? '★ ' : ''}${nm}`);
      const p = progress(g, id);
      this.bars[i]!.setText(p ? `${p[0]} of ${p[1]}` : '');
    }
    this.moreT.setText(this.list.length > ROWS ? `${this.sel + 1} of ${this.list.length}` : '');
  }

  /** Touch: a quest row follows it, outside is back. */
  tap(x: number, y: number): boolean {
    if (!within(x, y, W / 2 - 800, 70, 1600, 930)) {
      this.done = true;
      return true;
    }
    const i = Math.floor((y - 495) / 90);
    const at = this.top + i;
    if (i < 0 || i >= ROWS || at >= this.list.length || Math.abs(x - W / 2) > 780) return true;
    if (at !== this.sel) Sound.sfx('tick');
    this.sel = at;
    this.tapPick = true;
    return true;
  }

  update(dt: number): void {
    this.t += dt;
    const n = this.nav(dt);
    if (n.y && this.list.length) this.sel = (this.sel + n.y + this.list.length) % this.list.length;
    if (this.act() && this.list.length) {
      this.keys.send({ c: 'track', quest: this.list[this.sel]! });
      Sound.sfx('pick');
    }
    if (this.back() || this.keys.take('KeyQ')) this.done = true;
    this.refresh();
  }
}

register('quests', (ui) => new QuestMenu(ui));
