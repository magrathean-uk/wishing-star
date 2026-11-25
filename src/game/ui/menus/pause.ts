// The pause menu: carry on, save, options, how to play, back to the title.
import { app, setChristmas, setVolume } from '../../app.ts';
import { Sound } from '../../audio.ts';
import { touchState } from '../../input.ts';
import { net } from '../../net.ts';
import { saveNow, saveToLeave } from '../../save.ts';
import type { UI } from '../../scenes/UI.ts';
import { colour, INK, panel, SOFT, text, title, type Txt, W } from '../kit.ts';
import { Menu } from '../menu.ts';
import { register } from '../registry.ts';
import { SlotsPanel } from '../slots.ts';

type Mode = 'main' | 'options' | 'how' | 'confirm' | 'saves';

const KEYS: [string, string][] = [
  ['Arrow keys or W A S D', 'Walk'],
  ['Space or Enter', 'Talk, use, swing, choose'],
  ['E', 'Bag and recipes'],
  ['B', 'Build mode (at home)'],
  ['Q', 'Quest book'],
  ['M', 'Map'],
  ['K', 'Journal'],
  ['1 to 8', 'Pick a hotbar slot'],
  ['R', 'Use the picked item'],
  ['G', 'Your own emote'],
  ['X or Backspace', 'Back or cancel'],
  ['Hold X', 'Skip a story scene'],
  ['P or Esc', 'This menu'],
  ['F', 'Full screen'],
];

// on an iPad (the touch layer shown) there are no keys: the list says which button or finger does what (issue 19)
const TOUCH: [string, string][] = [
  ['Drag on the left', 'Walk'],
  ['Big button', 'Talk, use, swing, choose'],
  ['Small button', 'Back, or the bow'],
  ['Top buttons', 'Bag, quest book, map, help, this menu'],
  ['Tap a hotbar slot', 'Pick it, then tap again to use it'],
  ['Hold Skip', 'Skip a story scene'],
];

const ROW = 70;
const ROW_TOUCH = 84;
const TOP = 250;

export class PauseMenu extends Menu {
  private mode: Mode = 'main';
  private sel = 0;
  private labels: Txt[] = [];
  private head: Txt;
  private note: Txt;
  private extra: Txt[] = [];
  private leaving = false;
  private saves: SlotsPanel | null = null;

  constructor(ui: UI) {
    super(ui, 'Up and down: choose    Left and right: change    Space: pick    X: back');
    panel(this.g2, W / 2 - 520, 130, 1040, 840);
    this.head = this.add(title(ui, W / 2, 160, 'Paused', 60));
    this.head.setOrigin(0.5, 0);
    for (let i = 0; i < 10; i++) this.labels.push(this.add(text(ui, W / 2 - 420, TOP + i * ROW, '', 38)));
    this.note = this.add(text(ui, W / 2, 900, '', 32, '#2e7d32').setOrigin(0.5, 0));
    this.enter('main');
  }

  private rows(): string[] {
    const o = this.g.s.opts;
    if (this.mode === 'main') return ['Carry on', 'Save now', 'Options', 'How to play', 'Back to title'];
    if (this.mode === 'confirm') return ['Stay and play', 'Save and go to the title'];
    if (this.mode === 'options') {
      // on an iPad the two ends of a number row say what a tap there does (left is down, right is up), as on the title
      const vol = (name: string, v: number) =>
        touchState.shown ? `${name}:  -   ${Math.round(v * 10)} of 10   +` : `${name}:  ${Math.round(v * 10)} of 10`;
      return [
        `Gentle mode:  ${o.gentle ? 'On' : 'Off'}`,
        `Helper arrow:  ${o.helper ? 'On' : 'Off'}`,
        vol('Music', o.music),
        vol('Sound', o.sound),
        `Fewer effects:  ${o.lowFx ? 'On' : 'Off'}`,
        `Christmas:  ${app.christmas === 'auto' ? 'Auto' : app.christmas === 'on' ? 'On' : 'Off'}`,
        // players mode (D67): one game per player, kept on the server, so there is no saved-games page
        ...(net.on ? [] : ['Saved games']),
        'Back',
      ];
    }
    return [];
  }

  private enter(mode: Mode): void {
    this.mode = mode;
    this.sel = 0;
    this.note.setText('');
    // only the keys that do something on this page
    this.helpT?.setText(
      mode === 'options'
        ? 'Up and down: choose    Left and right: change    Space: pick    X: back'
        : mode === 'how'
          ? 'X: back'
          : 'Up and down: choose    Space: pick    X: back',
    );
    for (const e of this.extra) e.destroy();
    this.extra = [];
    this.head.setText(
      mode === 'options'
        ? 'Options'
        : mode === 'how'
          ? 'How to play'
          : mode === 'confirm'
            ? 'Leave the game?'
            : 'Paused',
    );
    if (mode === 'how') {
      const touch = touchState.shown;
      // the touch names are short, so their words start further left and the longest line still fits
      const dx = touch ? W / 2 - 140 : W / 2 - 40;
      (touch ? TOUCH : KEYS).forEach(([k, d], i) => {
        this.extra.push(this.add(text(this.ui, W / 2 - 460, 246 + i * 48, k, 30, '#b3541e')));
        this.extra.push(this.add(text(this.ui, dx, 246 + i * 48, d, 30, INK)));
      });
    }
    if (mode === 'confirm')
      this.extra.push(this.add(text(this.ui, W / 2, 250, 'Your game is saved first.', 34, SOFT).setOrigin(0.5, 0)));
    this.draw();
  }

  private draw(): void {
    const rows = this.rows();
    const y0 = this.mode === 'confirm' ? 340 : TOP;
    // on an iPad every row is a finger high (issue 41: 84 is 44 CSS pixels on the smallest iPad)
    const pitch = touchState.shown ? ROW_TOUCH : ROW;
    this.labels.forEach((l, i) => {
      const s = rows[i];
      l.setVisible(s !== undefined);
      if (s === undefined) return;
      l.setPosition(W / 2 - 420, y0 + i * pitch);
      l.setText(`${i === this.sel ? '>  ' : '    '}${s}`);
      colour(l, i === this.sel ? '#b3541e' : INK);
    });
  }

  private step(by: number): void {
    const o = this.g.s.opts;
    const vol = (v: number) => Math.max(0, Math.min(1, Math.round((v + by * 0.1) * 10) / 10));
    switch (this.sel) {
      case 0:
        this.keys.send({ c: 'opt', key: 'gentle', value: !o.gentle });
        break;
      case 1:
        this.keys.send({ c: 'opt', key: 'helper', value: !o.helper });
        break;
      case 2:
        // the volume is kept for every game on this computer, and in this save
        setVolume('music', vol(o.music));
        this.keys.send({ c: 'opt', key: 'music', value: app.music });
        break;
      case 3:
        setVolume('sound', vol(o.sound));
        this.keys.send({ c: 'opt', key: 'sound', value: app.sound });
        break;
      case 4:
        this.keys.send({ c: 'opt', key: 'lowFx', value: !o.lowFx });
        break;
      case 5: {
        const order = ['auto', 'on', 'off'] as const;
        const at = order.indexOf(app.christmas);
        setChristmas(order[(at + by + 3) % 3]!, this.g);
        break;
      }
      default:
        return;
    }
    Sound.sfx('pick');
  }

  private pickMain(): void {
    switch (this.sel) {
      case 0:
        this.done = true;
        break;
      case 1:
        this.note.setText(
          this.g.rt.cut
            ? 'It will save after the story.'
            : saveNow(this.g, true)
              ? 'Saved!'
              : 'Could not save. Try again.',
        );
        break;
      case 2:
        this.enter('options');
        break;
      case 3:
        this.enter('how');
        break;
      default:
        this.enter('confirm');
    }
  }

  private pickOptions(): void {
    if (this.sel < 6) this.step(1);
    else if (this.sel === 6 && !net.on) {
      // the three saved games: look, keep a copy, put a copy back, delete
      this.mode = 'saves';
      this.helpT?.setVisible(false);
      this.saves = new SlotsPanel(this.ui, 80, this.g, (ng) => {
        this.ui.world.setGame(ng);
        this.done = true;
      });
    } else this.enter('main');
  }

  update(dt: number): void {
    this.t += dt;
    if (this.leaving) return;
    if (this.saves) {
      const p = this.saves;
      const n = this.nav(dt);
      p.update({ x: n.x, y: n.y, act: this.act(), back: this.back() });
      this.keys.takeAny('KeyP', 'Escape');
      if (p.done) {
        p.destroy();
        this.saves = null;
        this.helpT?.setVisible(true);
        if (!this.done) {
          this.enter('options');
          this.sel = 6;
          this.draw();
        }
      }
      return;
    }
    const n = this.nav(dt);
    const rows = this.rows();
    if (rows.length && n.y) this.sel = (this.sel + n.y + rows.length) % rows.length;
    if (n.x && this.mode === 'options') this.step(n.x);
    if (this.act()) {
      if (this.mode === 'main') this.pickMain();
      else if (this.mode === 'options') this.pickOptions();
      else if (this.mode === 'how') this.enter('main');
      else if (this.sel === 0) this.enter('main');
      else {
        // the game is left only once it is saved: in a story scene, or when the browser will not keep it, she stays
        const saved = saveToLeave(this.g);
        if (saved === 'story') this.note.setText('Finish the story first.');
        else if (saved === 'failed') this.note.setText('Could not save. Try again.');
        else {
          this.leaving = true;
          // A fresh page, so the title comes up clean. (Starting the World scene a second time froze the game: its
          // pooled pictures from the first run were still in its lists.)
          window.location.reload();
          return;
        }
      }
    }
    const out = this.back() || this.keys.takeAny('KeyP', 'Escape');
    if (out) {
      if (this.mode === 'main') this.done = true;
      else this.enter(this.mode === 'confirm' ? 'main' : 'main');
    }
    this.draw();
  }

  close(): void {
    this.saves?.destroy();
    this.saves = null;
    super.close();
  }
}

register('pause', (ui) => new PauseMenu(ui));
