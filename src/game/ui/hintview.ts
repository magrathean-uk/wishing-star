// Draws the one hint the struggling rule (src/core/hints.ts) may be showing: a soft pulse on the place or a glow
// round the helper arrow at the screen edge, a key picture by the thing to press, the needed tab or row marked in
// the recipe list, a mark in a mini-game. Mostly pictures; the world's few words go in the caption under the goal.
// It sits below every talk box, card and menu (only a menu mark sits on its menu, round the row, never over it),
// and it never takes a key. Nothing is made per frame: one graphics layer each, redrawn only while a hint is up.
import type Phaser from 'phaser';
import { hasAll } from '../../core/craft.ts';
import { hasArt } from '../assets.ts';
import { touchState } from '../input.ts';
import { routeFrom } from '../../core/guide.ts';
import { count } from '../../core/cond.ts';
import { goalRecipe, missing, whereFrom } from '../../core/source.ts';
import { cast } from '../../core/talk.ts';
import { TERRAIN } from '../../core/grid.ts';
import { foeBeside } from '../../core/mobs.ts';
import type { Game, HintShow } from '../../core/types.ts';
import { CraftMenu, TABS, tabOf } from './menus/craft.ts';
import { UpgradeMenu } from './menus/upgrade.ts';
import type { UI } from '../scenes/UI.ts';
import { CREAM, GOLD, H, icon, LAYER, outlined, panel, setIcon, title, type Txt, W } from './kit.ts';
import { arrow, keyCapG, note } from './minidraw.ts';
import type { MiniView } from './miniview.ts';

const T = 64;
/** above the HUD and the mini-game cards (25), below the speech bubbles (30) and everything she uses */
const DEPTH = 29;
// the recipe list's layout (src/game/ui/menus/craft.ts)
const TAB_W = 270;
const TAB_X = W / 2 - (TABS.length * TAB_W) / 2;
const LIST_Y = 300;
const ROW_H = 100;
const ROWS = 5;
const MARGIN_X = W / 2 - 640 - 70;

/** The few fields of the recipe list a mark needs (read, never changed). */
interface CraftLook {
  tab: number;
  sel: number;
  top: number;
  list: string[];
  focus: string | null;
}

export class HintView {
  private ui: UI;
  private mini: MiniView;
  private gfx: Phaser.GameObjects.Graphics;
  private menuG: Phaser.GameObjects.Graphics;
  private cap: Txt;
  private menuCap: Txt;
  private pic: Phaser.GameObjects.Image;
  private words: Txt;
  private on = false;
  private picId = '';
  private t = 0;
  /** package 60: the card she asked for with H: a small map of the way, drawn once per spot (not every frame) */
  private card: Phaser.GameObjects.Graphics;
  private cardKey = '';
  /** package 68: the card's words and the missing things' pictures (a few pooled, set only when the card changes) */
  private rowPics: Phaser.GameObjects.Image[] = [];
  private rowTxt: Txt[] = [];

  constructor(ui: UI, mini: MiniView) {
    this.ui = ui;
    this.mini = mini;
    this.gfx = ui.add.graphics().setDepth(DEPTH).setScrollFactor(0);
    this.menuG = ui.add
      .graphics()
      .setDepth(LAYER.menu + 1)
      .setScrollFactor(0);
    this.cap = title(ui, 0, 0, '', 28, '#3b2a1a').setOrigin(0.5).setDepth(DEPTH).setScrollFactor(0);
    this.menuCap = title(ui, 0, 0, '', 28, '#3b2a1a')
      .setOrigin(0.5)
      .setDepth(LAYER.menu + 1)
      .setScrollFactor(0);
    this.pic = icon(ui, 'wood_pick', 0, 0, 64).setDepth(DEPTH).setVisible(false);
    this.words = outlined(ui, 0, 0, '', 34).setOrigin(0.5).setDepth(DEPTH).setScrollFactor(0);
    this.card = ui.add.graphics().setDepth(DEPTH).setScrollFactor(0);
    for (let i = 0; i < 3; i++) {
      this.rowPics.push(icon(ui, 'wood_pick', 0, 0, 56).setDepth(DEPTH).setVisible(false));
      this.rowTxt.push(title(ui, 0, 0, '', 30, '#3b2a1a').setOrigin(0, 0.5).setDepth(DEPTH).setScrollFactor(0));
    }
    this.hideAll();
  }

  private get g(): Game {
    return this.ui.g;
  }

  update(dt: number): void {
    const g = this.g;
    const rt = g.rt;
    // tell the rule which menu is open: the recipe list and the upgrade bench can be what the step needs
    const o = this.ui.overlay;
    rt.help.menu = !o ? '' : o instanceof CraftMenu ? 'craft' : o instanceof UpgradeMenu ? 'upgrade' : 'other';
    const h = rt.help.show;
    if (!h || !this.drawable(h)) {
      if (this.on) this.hideAll();
      return;
    }
    this.on = true;
    this.t += dt;
    this.gfx.clear();
    this.menuG.clear();
    this.cap.setVisible(false);
    this.menuCap.setVisible(false);
    this.pic.setVisible(false);
    this.words.setVisible(false);
    // the layer on the menu shows only while a menu is the focus and it has a mark to draw
    this.menuG.setVisible(h.kind === 'menu');
    if (h.kind === 'mini') this.drawMini(h);
    else if (h.kind === 'menu') this.drawMenu(h);
    else this.drawWorld(h);
  }

  /** Only while nothing she has to read or use is open (a menu mark only on its own menu). */
  private drawable(h: HintShow): boolean {
    const rt = this.g.rt;
    if (rt.cut || rt.card || rt.talk) return false;
    const focus = this.ui.focus();
    if (h.kind === 'menu') return focus === 'menu';
    if (focus) return false;
    if (h.kind === 'mini') return rt.mode === 'mini' && rt.mini?.st === 1 && rt.mini.game === h.target;
    return rt.mode === 'play' || rt.mode === 'fishing' || rt.mode === 'build';
  }

  private hideAll(): void {
    this.on = false;
    this.gfx.clear();
    this.menuG.clear().setVisible(false);
    this.cap.setVisible(false);
    this.menuCap.setVisible(false);
    this.pic.setVisible(false);
    this.words.setVisible(false);
    this.card.clear();
    this.cardKey = '';
    this.hideRow();
  }

  private hideRow(): void {
    for (const p of this.rowPics) p.setVisible(false);
    for (const t of this.rowTxt) t.setVisible(false);
  }

  /** A key picture with its word on it. On an iPad there are no keys: the ring or the mark says it alone (package 67). */
  private key(gfx: Phaser.GameObjects.Graphics, label: Txt, x: number, y: number, key: string): void {
    if (!key || touchState.shown) return;
    const word = key.length > 1 && key !== 'Space' ? '' : key;
    const w = key === 'Space' ? 128 : 64;
    const bob = Math.sin(this.t * 5) * 5;
    keyCapG(gfx, x, y + bob, word ? '' : key, w, 58);
    if (word) {
      if (label.text !== word) label.setText(word);
      label.setPosition(x, y + bob - 4).setVisible(true);
    }
  }

  private ring(x: number, y: number, r: number): void {
    const p = (this.t * 1.4) % 1;
    this.gfx.lineStyle(7, GOLD, 0.9 - p * 0.7).strokeCircle(x, y, r + p * 26);
    this.gfx.lineStyle(4, 0xffffff, 0.55).strokeCircle(x, y, r);
  }

  private picture(id: string, x: number, y: number): void {
    // (package 60: a thing with no picture of its own, such as an enemy, showed a pink stand-in box with its id on
    // it, which read as an unexplained tag over the hedges: no picture then)
    if (!id || !hasArt(id)) return;
    if (id !== this.picId) {
      this.picId = id;
      setIcon(this.ui, this.pic, id, 72);
    }
    this.pic.setPosition(x, y + Math.sin(this.t * 3) * 4).setVisible(true);
  }

  // ---------------------------------------------------------------- the world

  private drawWorld(h: HintShow): void {
    if (h.asked) {
      this.drawCard(h);
      return;
    }
    const g = this.g;
    const s = g.s;
    const cam = this.ui.world.cameras.main;
    const vx = cam.worldView.x;
    const vy = cam.worldView.y;
    const z = cam.zoom;
    const hx = (s.x * T - vx) * z;
    const hy = (s.y * T - vy) * z;
    const at = h.at;
    // package 68: in a fight the key never sits over her or the mob (the strip at the bottom says "Space Swing")
    const tq = s.tracked ? s.quests[s.tracked] : undefined;
    const fight = foeBeside(g) || (!!tq && !tq.done && g.c.quests[s.tracked!]?.steps[tq.step]?.t === 'defeat');
    if (fight) return;
    if (!at) {
      // nothing to point at: the key (and what it is about) above her head
      this.key(this.gfx, this.cap, hx, hy - 170, h.key);
      this.picture(h.icon, hx + (h.key ? 110 : 0), hy - 170);
      return;
    }
    let wx = (at.x + 0.5) * T;
    let wy = (at.y + 0.5) * T;
    if (at.area !== s.area) {
      // the way out of here towards it
      const doors = g.c.areas[s.area]!.doors;
      let d = doors[0];
      for (const x of doors) if (x.to === at.area) d = x;
      if (!d) return;
      wx = (d.x + 0.5) * T;
      wy = (d.y + 0.5) * T;
    }
    const px = (wx - vx) * z;
    const py = (wy - vy) * z;
    const m = 90;
    if (px > m && px < W - m && py > m + 60 && py < H - m - 80) {
      // in view: the key picture over the thing (package 60: the star marks it already; a ring beside it read as
      // a second, unexplained mark, so the pulse is drawn only when the helper star is off)
      if (!s.opts.helper) this.ring(px, py, 56);
      this.key(this.gfx, this.cap, px, py - 120, h.key);
      this.picture(h.icon, px + (h.key ? (h.key === 'Space' ? 120 : 90) : 0), py - 120);
      return;
    }
    // out of view, with the helper on: the helper arrow already shows the way (along the route, package 60), so the
    // hint only shows what it is about, over her head
    if (s.opts.helper) {
      this.picture(h.icon, hx, hy - 170);
      return;
    }
    // out of view, helper off: an arrow of its own at the edge
    const cx = W / 2;
    const cy = H / 2;
    const ang = Math.atan2(py - cy, px - cx);
    const k = Math.min((cx - m) / Math.abs(Math.cos(ang) || 1e-6), (cy - m - 60) / Math.abs(Math.sin(ang) || 1e-6));
    const ex = cx + Math.cos(ang) * k;
    const ey = cy + Math.sin(ang) * k;
    // package 71 (D78): 60 percent of its old size, under 40 pixels across, as the helper arrow is
    arrow(this.gfx, ex, ey, ang, 22, GOLD);
    this.ring(ex, ey, 34);
    this.picture(h.icon, ex - Math.cos(ang) * 110, ey - Math.sin(ang) * 110);
  }

  /**
   * H (package 60): a small calm card under the goal line with a little map of the way from her to the goal (her red
   * dot, the gold dots of the route, the star), the picture of the thing to use and the key for it. Space or H
   * closes it. Without a place, the picture and the key alone, and the few words in the caption.
   */
  private drawCard(h: HintShow): void {
    const g = this.g;
    const s = g.s;
    const cw = 600;
    let ch = 360;
    const x0 = 24;
    const y0 = 250;
    const route = h.at ? routeFrom(g, 400) : [];
    // package 68: what to do, in a picture and 3 words: the person's face and "Talk", the thing and its key, or for
    // a thing to make the missing things with "2 of 3" and where each comes from
    const row = cardRow(g, h);
    const rowKey = row.map((r) => `${r.pic}/${r.words}`).join(',');
    const key = `${s.area}:${Math.floor(s.x)}:${Math.floor(s.y)}:${route.length}:${h.icon}:${h.key}:${rowKey}`;
    const rowH = row.length ? 110 : 0;
    // (no way to draw: the card is only its words row, nothing empty above it)
    if (route.length < 2 && row.length) ch = rowH + 20;
    if (key !== this.cardKey) {
      this.cardKey = key;
      const c = this.card.clear();
      this.hideRow();
      if (route.length < 2 && !h.icon && !h.key && !row.length) return;
      panel(c, x0, y0, cw, ch, CREAM, GOLD, 24);
      if (row.length) {
        if (route.length >= 2)
          c.lineStyle(3, GOLD, 0.6).lineBetween(x0 + 20, y0 + ch - rowH, x0 + cw - 20, y0 + ch - rowH);
        const colW = (cw - 40) / Math.max(1, row.length);
        row.forEach((r, i) => {
          const cx = x0 + 20 + colW * i;
          const cy = y0 + ch - rowH / 2;
          const pic = this.rowPics[i]!;
          if (r.pic && hasArt(r.pic)) {
            setIcon(this.ui, pic, r.pic, 72);
            pic.setPosition(cx + 40, cy).setVisible(true);
          }
          this.rowTxt[i]!.setText(r.words)
            .setPosition(cx + (r.pic ? 86 : 8), cy)
            .setVisible(true);
        });
      }
      if (route.length >= 2) {
        // the box round her and the route, at least 16 by 9 tiles, with a little room round it
        let ax = s.x;
        let bx = s.x;
        let ay = s.y;
        let by = s.y;
        for (let i = 0; i < route.length; i += 2) {
          ax = Math.min(ax, route[i]!);
          bx = Math.max(bx, route[i]! + 1);
          ay = Math.min(ay, route[i + 1]!);
          by = Math.max(by, route[i + 1]! + 1);
        }
        const mx = Math.max(0, 16 - (bx - ax)) / 2 + 2;
        const my = Math.max(0, 9 - (by - ay)) / 2 + 2;
        ax = Math.floor(ax - mx);
        bx = Math.ceil(bx + mx);
        ay = Math.floor(ay - my);
        by = Math.ceil(by + my);
        const iw = cw - 40;
        const ih = ch - 40 - rowH;
        const k = Math.min(iw / (bx - ax), ih / (by - ay), 28);
        const ox = x0 + 20 + (iw - (bx - ax) * k) / 2;
        const oy = y0 + 20 + (ih - (by - ay) * k) / 2;
        const a = g.c.areas[s.area]!;
        const solid = g.rt.solid[s.area]!;
        for (let ty = ay; ty < by; ty++)
          for (let tx = ax; tx < bx; tx++) {
            const out = tx < 0 || ty < 0 || tx >= a.w || ty >= a.h;
            const ter = out ? undefined : TERRAIN[a.terrain[ty]!.charAt(tx)];
            const col = out
              ? 0x5c4a3a
              : ter?.water
                ? 0x7cb8e0
                : solid[ty * a.w + tx]
                  ? 0x4f7a45
                  : ter?.name === 'path' || ter?.name === 'cobble' || ter?.name === 'bridge'
                    ? 0xe3cfa0
                    : 0xa9d18e;
            c.fillStyle(col, 1).fillRect(ox + (tx - ax) * k, oy + (ty - ay) * k, Math.ceil(k), Math.ceil(k));
          }
        for (let i = 2; i < route.length; i += 4) {
          const px = ox + (route[i]! - ax + 0.5) * k;
          const py = oy + (route[i + 1]! - ay + 0.5) * k;
          c.fillStyle(0x3b2a1a, 0.9).fillCircle(px, py, k * 0.32 + 2);
          c.fillStyle(GOLD, 1).fillCircle(px, py, k * 0.32);
        }
        const ex = ox + (route.at(-2)! - ax + 0.5) * k;
        const ey = oy + (route.at(-1)! - ay + 0.5) * k;
        c.fillStyle(0xffffff, 1).fillCircle(ex, ey, k * 0.7 + 3);
        c.fillStyle(GOLD, 1).fillCircle(ex, ey, k * 0.7);
        const hx = ox + (s.x - ax) * k;
        const hy = oy + (s.y - ay) * k;
        c.fillStyle(0xffffff, 1).fillCircle(hx, hy, k * 0.6 + 3);
        c.fillStyle(0xe63946, 1).fillCircle(hx, hy, k * 0.6);
      }
    }
    // the key, in the card's lower right corner (beside the words; a craft row has none: the bench says Space)
    const kx = x0 + cw - 90;
    const ky = y0 + ch - 55;
    if (!row.length) {
      if (h.icon) this.picture(h.icon, h.key ? kx - 110 : kx, ky);
      this.key(this.gfx, this.cap, kx, ky, h.key);
    }
  }

  // ---------------------------------------------------------------- mini-games

  private drawMini(h: HintShow): void {
    const m = this.g.rt.mini;
    if (!m) return;
    const x = this.mini.spotX;
    const y = this.mini.spotY;
    if (m.game === 'hide') {
      // a note over the place a friend is giggling in, and Space once she stands beside it
      const n = m.n;
      if (n[6] !== 1) return;
      const wob = Math.sin(this.t * 9) * 8;
      // (to the side, clear of the Space key over the place)
      note(this.gfx, x + 58 + wob, y - 30, 1.1, 0xfff3b0);
      note(this.gfx, x + 92 - wob, y - 70, 0.8, 0xffffff);
      this.ring(x, y, 62);
      return;
    }
    this.ring(x, y, 54);
    this.key(this.gfx, this.cap, x, y - 110, h.key);
  }

  // ---------------------------------------------------------------- menus

  private drawMenu(h: HintShow): void {
    const g = this.g;
    const o = this.ui.overlay;
    if (o instanceof CraftMenu) {
      const c = o as unknown as CraftLook;
      const want = c.focus;
      if (!want) return;
      const r = g.c.recipes[want];
      if (!r) return;
      const tab = TABS.indexOf(tabOf(g, r));
      const bob = Math.sin(this.t * 5) * 5;
      const mg = this.menuG;
      if (tab !== c.tab) {
        // the tab it is on: an arrow key towards it, a ring round the tab
        const tx = TAB_X + tab * TAB_W + TAB_W / 2;
        mg.lineStyle(7, GOLD, 0.6 + 0.4 * Math.sin(this.t * 6)).strokeRoundedRect(
          tx - TAB_W / 2 + 2,
          154,
          TAB_W - 4,
          116,
          24,
        );
        if (!touchState.shown) keyCapG(mg, tx, 120 + bob, tab < c.tab ? 'left' : 'right', 64, 58);
        return;
      }
      const i = c.list.indexOf(want);
      const row = i - c.top;
      if (row < 0 || row >= ROWS) return;
      const y = LIST_Y + row * ROW_H + 45;
      if (!hasAll(g, r)) {
        // she is short of something: the red numbers say what; a few words say so
        if (this.words.text !== (g.c.strings.hint_more ?? '')) this.words.setText(g.c.strings.hint_more ?? '');
        this.words
          .setDepth(LAYER.menu + 1)
          .setPosition(W / 2 + 200, y + 72)
          .setVisible(true);
        return;
      }
      if (c.sel !== i) {
        if (!touchState.shown) keyCapG(mg, MARGIN_X, y + bob, c.sel < i ? 'down' : 'up', 64, 58);
      } else this.key(mg, this.menuCap, MARGIN_X, y, 'Space');
      return;
    }
    if (o instanceof UpgradeMenu) this.key(this.menuG, this.menuCap, MARGIN_X, 400, h.key || 'Space');
  }
}

interface CardBit {
  pic: string;
  words: string;
  craft?: boolean;
}

/** The help card's words row (package 68), from the tracked step. */
function cardRow(g: Game, h: HintShow): CardBit[] {
  const s = g.s;
  const q = s.tracked ? s.quests[s.tracked] : undefined;
  if (!s.tracked || !q || q.done) return [];
  const st = g.c.quests[s.tracked]?.steps[q.step];
  const S = g.c.strings;
  const want = goalRecipe(g);
  if (want) {
    const short = missing(g, want.r, want.times);
    if (short.length)
      return short.slice(0, 3).map((m) => ({
        pic: m.item,
        words: `${m.have} of ${m.need}\n${whereFrom(g, m.item)}`,
        craft: true,
      }));
    return [
      { pic: want.r.out, words: (S.card_make ?? 'Use the {at}').replace('{at}', S[`at:${want.r.at}`] ?? want.r.at) },
    ];
  }
  const who = !st
    ? g.c.quests[s.tracked]!.giver
    : st.t === 'talk'
      ? st.who
      : st.t === 'deliver' && count(g, st.item) >= (st.n ?? 1)
        ? st.to
        : '';
  if (who)
    return [
      { pic: `face_${cast(g, who)}`, words: (touchState.shown ? S.card_talk_touch : S.card_talk) ?? 'Talk: Space' },
    ];
  if (h.icon) return [{ pic: h.icon, words: touchState.shown ? '' : 'Space' }];
  return [];
}
