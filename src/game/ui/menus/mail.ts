// The mailbox list and the letter reader (also used for notes in bottles).
import type Phaser from 'phaser';
import { KIND_FROM, KIND_FROM_LIST, kindPages } from '../../../core/kind.ts';
import { type PostEntry, postList } from '../../../core/post.ts';
import { fill, charName } from '../../../core/talk.ts';
import { app } from '../../app.ts';
import { Sound } from '../../audio.ts';
import type { UI } from '../../scenes/UI.ts';
import { GOLD, icon, INK, panel, SOFT, text, title, W } from '../kit.ts';
import { Menu, within } from '../menu.ts';
import { register } from '../registry.ts';

/**
 * Package 60, 67: a letter or bottle whose words are not in this copy's personal file (a player in players mode has
 * none) is a kind one from a friend on the island (src/core/kind.ts), never an empty page.
 */
const LIST_HELP = 'Up and down: choose    Space: open    X: back';

/**
 * A short page that ends in a comma ("My dear ...," or "Love,") shares its page with the next one, so no page holds
 * only a greeting or a sign-off.
 */
export function joinShort(list: string[]): string[] {
  const pages = [...list];
  const out: string[] = [];
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i]!;
    const next = pages[i + 1];
    if (next !== undefined && p.length <= 40 && p.trimEnd().endsWith(',')) {
      pages[i + 1] = `${p.trimEnd()}\n\n${next}`;
      continue;
    }
    out.push(p);
  }
  return out;
}

export class MailMenu extends Menu {
  private ids: string[] = [];
  private sel = 0;
  /** the letter being read, or null for the list */
  private open: string | null = null;
  private page = 0;
  private pages: string[] = [];
  private from = '';
  private single: boolean;
  private dyn: Phaser.GameObjects.GameObject[] = [];
  /** package 73b: "Your post" at the Post Office: notes stay in the list once read */
  private post: PostEntry[] | null = null;

  constructor(ui: UI, letter?: string, post = false) {
    super(ui, LIST_HELP);
    this.single = !!letter;
    if (post) this.refreshPost();
    else if (letter) this.read(letter);
    else this.ids = [...this.g.s.inbox];
    this.draw();
  }

  private refreshPost(): void {
    this.post = postList(this.g);
    this.ids = this.post.map((p) => p.id);
  }

  private sender(id: string): string {
    const g = this.g;
    const e = this.post?.find((x) => x.id === id);
    if (e) {
      const S = g.c.strings;
      if (e.day) return (S.post_day ?? '{n} December').replace('{n}', String(e.day));
      return (S.post_from ?? 'A note from {name}').replace('{name}', charName(g, e.from));
    }
    if (id.startsWith('bottle')) return 'A message in a bottle';
    const def = g.c.letters[id];
    if (def?.text) return charName(g, def.from);
    const p = app.personal.letters[id];
    return fill(g, p?.pages?.length ? (p.from ?? 'Someone kind') : KIND_FROM);
  }

  private read(id: string): void {
    const g = this.g;
    const def = g.c.letters[id];
    this.open = id;
    this.page = 0;
    this.from = '';
    const p = this.post?.find((e) => e.id === id);
    if (p) {
      // Dad's words come only from his file; a friend's from the game's own strings
      const own = p.day ? app.personal.december[String(p.day)] : g.c.strings[p.text];
      this.pages = joinShort([fill(g, own ?? '')].filter((t) => t.trim()));
      if (!this.pages.length) this.pages = kindPages(g.c.strings, 'letter').map((t) => fill(g, t));
      return;
    }
    if (id.startsWith('bottle')) {
      const own = app.personal.bottles[id];
      this.pages = own ? [own] : kindPages(g.c.strings, id);
    } else if (def?.text?.length) {
      this.pages = [...def.text];
      this.from = charName(g, def.from);
    } else {
      const p = app.personal.letters[id];
      this.pages = p?.pages?.length ? [...p.pages] : kindPages(g.c.strings, id);
    }
    this.pages = joinShort(this.pages.map((s) => fill(g, s)));
  }

  private draw(): void {
    for (const o of this.dyn) o.destroy();
    this.dyn = [];
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => {
      this.dyn.push(o);
      return this.add(o);
    };
    const g2 = add(this.ui.add.graphics());
    if (this.open) {
      const last = this.page >= this.pages.length - 1;
      panel(g2, W / 2 - 700, 90, 1400, 860, 0xfffdf2, 0xd9a441);
      add(text(this.ui, W / 2 - 640, 130, this.sender(this.open), 36, SOFT));
      add(text(this.ui, W / 2 - 640, 220, this.pages[this.page] ?? '', 48, INK, 1280));
      if (last && this.from) add(text(this.ui, W / 2 + 640, 700, `From ${this.from}`, 40, '#b3541e').setOrigin(1, 0));
      const gift = this.g.c.letters[this.open]?.gift;
      if (last && gift) {
        add(text(this.ui, W / 2 - 640, 790, 'A present is inside!', 36, SOFT));
        let x = W / 2 - 200;
        for (const k in gift) {
          add(icon(this.ui, k, x, 815, 72));
          add(text(this.ui, x + 44, 795, `x${gift[k]}`, 40, INK));
          x += 190;
        }
      }
      add(text(this.ui, W / 2 + 640, 130, `${this.page + 1} of ${this.pages.length}`, 30, SOFT).setOrigin(1, 0));
      // the one key line at the foot of the screen
      const S = this.g.c.strings;
      this.helpT?.setText((last ? S.letter_done : S.letter_next) ?? '');
      return;
    }
    const S = this.g.c.strings;
    this.helpT?.setText(this.post ? (S.post_help ?? LIST_HELP) : LIST_HELP);
    panel(g2, W / 2 - 560, 110, 1120, 820);
    add(title(this.ui, W / 2, 140, this.post ? (S.post_title ?? 'Your post') : 'Mailbox', 58).setOrigin(0.5, 0));
    if (this.ids.length === 0) {
      const none = this.post ? (S.post_none ?? '') : 'No new letters. Check again tomorrow!';
      add(text(this.ui, W / 2, 440, none, 40, SOFT).setOrigin(0.5, 0));
      return;
    }
    const top = Math.max(0, Math.min(this.sel - 3, this.ids.length - 7));
    for (let i = 0; i < 7; i++) {
      const id = this.ids[top + i];
      if (!id) break;
      const y = 250 + i * 96;
      const chosen = top + i === this.sel;
      g2.fillStyle(chosen ? GOLD : 0xe8d9b5, 1).fillRoundedRect(W / 2 - 500, y, 1000, 84, 20);
      g2.fillStyle(0xfffdf2, 1).fillRoundedRect(W / 2 - 494, y + 6, 988, 72, 16);
      add(icon(this.ui, 'mailbox', W / 2 - 440, y + 42, 56));
      const who = this.sender(id);
      const p = this.post?.[top + i];
      if (p) {
        add(text(this.ui, W / 2 - 380, y + 20, who, 36, INK));
        if (p.unread) add(text(this.ui, W / 2 + 470, y + 22, S.post_new ?? 'New', 32, '#b3541e').setOrigin(1, 0));
        continue;
      }
      add(text(this.ui, W / 2 - 380, y + 20, `A letter from ${who === KIND_FROM ? KIND_FROM_LIST : who}`, 36, INK));
    }
  }

  /** Touch: a letter's row opens it, a tap on the letter turns the page (as Space), outside is back (as X). */
  tap(x: number, y: number): boolean {
    if (this.open) {
      if (within(x, y, W / 2 - 700, 90, 1400, 860)) this.tapPick = true;
      else if (this.single) this.done = true;
      else {
        this.open = null;
        this.draw();
      }
      return true;
    }
    if (!within(x, y, W / 2 - 560, 110, 1120, 820)) {
      this.done = true;
      return true;
    }
    const top = Math.max(0, Math.min(this.sel - 3, this.ids.length - 7));
    const i = Math.floor((y - 244) / 96);
    const at = top + i;
    if (i < 0 || i >= 7 || at >= this.ids.length || Math.abs(x - W / 2) > 520) return true;
    if (at !== this.sel) Sound.sfx('tick');
    this.sel = at;
    this.tapPick = true;
    return true;
  }

  update(dt: number): void {
    this.t += dt;
    const n = this.nav(dt);
    if (!this.open) {
      if (n.y && this.ids.length) {
        this.sel = (this.sel + n.y + this.ids.length) % this.ids.length;
        this.draw();
      }
      if (this.act() && this.ids.length) {
        this.read(this.ids[this.sel]!);
        Sound.sfx('open');
        this.draw();
      }
      if (this.back() || this.keys.take('Escape')) this.done = true;
      return;
    }
    if (this.act()) {
      if (this.page < this.pages.length - 1) {
        this.page++;
        Sound.sfx('tick');
        this.draw();
      } else {
        this.keys.send({ c: 'read', letter: this.open });
        Sound.sfx('pick');
        if (this.single) this.done = true;
        else if (this.post) {
          // a read note stays in the list to read again (the rules mark it read this step)
          this.open = null;
          this.ui.time.delayedCall(50, () => {
            if (this.done) return;
            this.refreshPost();
            this.draw();
          });
          this.draw();
        } else {
          this.ids = this.ids.filter((x) => x !== this.open);
          this.sel = Math.max(0, Math.min(this.sel, this.ids.length - 1));
          this.open = null;
          this.draw();
        }
      }
    }
    if (this.back()) {
      // leaving early keeps the letter for later; a bottle note has nothing to keep
      if (this.single) this.done = true;
      else {
        this.open = null;
        this.draw();
      }
    }
  }
}

register('mail', (ui) => new MailMenu(ui));
register('letter', (ui, arg) => new MailMenu(ui, arg));
register('post', (ui) => new MailMenu(ui, undefined, true));
