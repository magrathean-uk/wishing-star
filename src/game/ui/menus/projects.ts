// Package 47b: Dad's fish board by his jetty and the cup shelf at Toy Box Corner. Both are pictures, no talk.
// The world opens them as the shop of the stall ids 'fishboard' and 'cups' (see shop.ts).
import type Phaser from 'phaser';
import { cupOpen } from '../../../core/cond.ts';
import { MINIS } from '../../../core/minigames.ts';
import type { Game } from '../../../core/types.ts';
import type { UI } from '../../scenes/UI.ts';
import { CUP_INK, CUP_NAME, CUP_FILL, makeCupTextures } from '../cups.ts';
import { GOLD, icon, INK, makeUiTextures, panel, SOFT, slot, text, title, W } from '../kit.ts';
import { Menu } from '../menu.ts';

const DARK = 0x1c1626;
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** A drawn texture of this scene (the cups, the water) or else an art picture, fitted into a square. */
function pic(ui: UI, key: string, x: number, y: number, size: number): Phaser.GameObjects.Image {
  if (!ui.textures.exists(key)) return icon(ui, key, x, y, size);
  const img = ui.add.image(x, y, key).setScrollFactor(0);
  img.setScale(size / (Math.max(img.width, img.height) || size));
  return img;
}
/** The fish board's prize quests, in order: 3, 6 and 10 kinds. */
const BOARD = ['fb_1', 'fb_2', 'fb_3'] as const;

/** The ten fish in the board's order, read from the prize quests' steps. */
export function boardFish(g: Game): string[] {
  const out: string[] = [];
  for (const id of BOARD)
    for (const st of g.c.quests[id]?.steps ?? []) if (st.t === 'fish' && st.kind) out.push(st.kind);
  return out;
}
/** The fish the board points to now: the step the board is waiting for, else the first she has not caught. */
export function nextFish(g: Game): string | null {
  for (const id of BOARD) {
    const q = g.s.quests[id];
    if (!q || q.done) continue;
    const st = g.c.quests[id]!.steps[q.step];
    if (st?.t === 'fish' && st.kind) return st.kind;
  }
  return boardFish(g).find((f) => !g.s.stickers[f]) ?? null;
}

export class FishBoardMenu extends Menu {
  /** for the smoke bot */
  readonly page = 'fishboard';

  constructor(ui: UI) {
    super(ui, 'X: back');
    makeUiTextures(ui);
    makeCupTextures(ui);
    const g = this.g;
    const fish = boardFish(g);
    panel(this.g2, 160, 50, W - 320, 940);
    this.add(title(ui, W / 2, 70, 'Fish board', 60).setOrigin(0.5, 0));
    // the ten fish, two rows of five: caught ones in colour with a tick, the others dark
    const size = 150;
    const gap = 40;
    const left = W / 2 - (5 * size + 4 * gap) / 2;
    fish.forEach((id, i) => {
      const x = left + (i % 5) * (size + gap);
      const y = 170 + Math.floor(i / 5) * (size + 40);
      slot(this.g2, x, y, size, id === nextFish(g));
      const pic = this.add(icon(ui, id, x + size / 2, y + size / 2, size - 34));
      if (!g.s.stickers[id]) pic.setTintFill(DARK).setAlpha(0.5);
      else this.add(ui.add.image(x + size - 18, y + 18, 'ui_tick').setScrollFactor(0));
    });
    // where the next one bites, in pictures and in words: the fish, its water, a sun or a moon (both: any time)
    const next = nextFish(g);
    const ny = 560;
    if (next) {
      const f = g.c.fish[next];
      const S = g.c.strings;
      this.add(icon(ui, next, W / 2 - 420, ny + 60, 130));
      const fishName = g.c.items[next]?.name ?? next.replace(/_/g, ' ');
      this.add(title(ui, W / 2 - 320, ny + 30, (S.fish_next ?? '').replace('{fish}', fishName), 44).setOrigin(0, 0.5));
      const waters = f?.water ?? ['sea'];
      const where = waters.join(' or ');
      const time = f?.time ?? 'any';
      const line = (S.fish_where ?? '')
        .replace('{water}', where.charAt(0).toUpperCase() + where.slice(1))
        .replace('{when}', S['fish_when:' + time] ?? '');
      this.add(text(ui, W / 2 - 320, ny + 95, line, 40, SOFT).setOrigin(0, 0.5));
      this.add(pic(ui, 'ui_water_' + waters[0], W / 2 + 300, ny + 60, 120));
      const when = time === 'night' ? ['ui_moon'] : time === 'day' ? ['ui_sun'] : ['ui_sun', 'ui_moon'];
      when.forEach((k, i) => this.add(pic(ui, k, W / 2 + 430 + i * 90, ny + 60, 80)));
    } else this.add(title(ui, W / 2, ny + 40, 'All 10 caught!', 56, '#2f7a3a').setOrigin(0.5, 0));
    // the three prizes: at 3, 6 and 10 kinds
    const caught = fish.filter((f) => g.s.stickers[f]).length;
    const prizes = [
      { n: 3, pic: 'emerald', id: 'fb_1' },
      { n: 6, pic: 'mermaid_fountain', id: 'fb_2' },
      { n: 10, pic: 'trophy_star', id: 'fb_3' },
    ];
    prizes.forEach((p, i) => {
      const x = W / 2 + (i - 1) * 300;
      const y = 800;
      const won = !!g.s.quests[p.id]?.done;
      this.g2.fillStyle(won ? GOLD : 0xd9c59a, 1).fillRoundedRect(x - 120, y - 20, 240, 160, 20);
      this.g2.fillStyle(won ? 0xfffbe8 : 0xf3e6c8, 1).fillRoundedRect(x - 112, y - 12, 224, 144, 16);
      this.add(title(ui, x - 70, y + 60, String(p.n), 64, won ? '#2f7a3a' : SOFT).setOrigin(0.5));
      const pic = this.add(icon(ui, p.pic, x + 50, y + 60, 100));
      if (!won) pic.setAlpha(0.45);
      if (won) this.add(ui.add.image(x + 100, y, 'ui_tick').setScrollFactor(0));
    });
    this.add(text(ui, W / 2, 955, `${caught} of ${fish.length}`, 34, SOFT).setOrigin(0.5, 0.5));
  }

  /** Touch: a page to look at; any tap closes it, as any of its keys does. */
  tap(): boolean {
    this.done = true;
    return true;
  }

  update(dt: number): void {
    this.t += dt;
    this.nav(dt);
    if (this.back() || this.act()) this.done = true;
  }
}

export class CupMenu extends Menu {
  /** for the smoke bot */
  readonly page = 'cups';

  constructor(ui: UI) {
    super(ui, 'X: back');
    makeUiTextures(ui);
    makeCupTextures(ui);
    const g = this.g;
    const S = g.c.strings;
    panel(this.g2, 160, 50, W - 320, 940);
    this.add(title(ui, W / 2, 70, 'Cups', 60).setOrigin(0.5, 0));
    const games = Object.keys(MINIS);
    games.forEach((game, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = 240 + col * 760;
      const y = 180 + row * 190;
      // the best cup won, plainly: that one cup in its colour, its name, and its stars (bronze 1, silver 2, gold 3)
      const best = (g.s.cups?.[game] ?? 0) as 0 | 1 | 2 | 3;
      const open = best > 0 || cupOpen(g, game);
      this.g2.fillStyle(best ? CUP_FILL[best] : 0xd9c59a, 1).fillRoundedRect(x, y, 680, 160, 22);
      this.g2.fillStyle(best ? 0xfffbe8 : 0xf3e6c8, 1).fillRoundedRect(x + 7, y + 7, 666, 146, 18);
      const name = S['mini:' + game] ?? game;
      const label = this.add(text(ui, x + 30, y + 80, name.charAt(0).toUpperCase() + name.slice(1), 38, INK, 280));
      label.setOrigin(0, 0.5);
      if (!open) label.setAlpha(0.4);
      const cup = this.add(pic(ui, 'ui_cup' + best, x + 380, y + 80, best ? 112 : 84));
      if (!best) {
        cup.setAlpha(0.5);
        this.add(text(ui, x + 450, y + 80, S.cup_none ?? '', 32, SOFT).setOrigin(0, 0.5));
        return;
      }
      const won = (S.cup_won ?? '{cup}').replace('{cup}', cap(CUP_NAME[best]));
      this.add(title(ui, x + 450, y + 52, won, 38, CUP_INK[best]).setOrigin(0, 0.5));
      for (let t = 0; t < best; t++)
        this.add(
          ui.add
            .image(x + 474 + t * 58, y + 112, 'ui_starbig')
            .setScrollFactor(0)
            .setScale(0.55),
        );
    });
    const gold = games.filter((k) => (g.s.cups?.[k] ?? 0) >= 3).length;
    this.add(text(ui, W / 2, 955, `${gold} of ${games.length} gold`, 34, SOFT).setOrigin(0.5, 0.5));
  }

  /** Touch: a page to look at; any tap closes it, as any of its keys does. */
  tap(): boolean {
    this.done = true;
    return true;
  }

  update(dt: number): void {
    this.t += dt;
    this.nav(dt);
    if (this.back() || this.act()) this.done = true;
  }
}

/** shop.ts: these stall ids open a page instead of a shop. */
export function pageFor(ui: UI, stall: string): Menu | null {
  if (stall === 'fishboard') return new FishBoardMenu(ui);
  if (stall === 'cups') return new CupMenu(ui);
  return null;
}
