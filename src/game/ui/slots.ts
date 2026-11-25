// The saved games, under Options on the title and in the pause menu: look at the three slots, keep a copy of one
// as a file, put a copy back, or delete one; on the title also play any of them (issue 49). By keys, or by taps from
// the touch layer (issue 18: SlotsPanel.tap).
import type Phaser from 'phaser';
import type { Game } from '../../core/types.ts';
import { adopt, app, xmasNow } from '../app.ts';
import { touchState } from '../input.ts';
import { Sound } from '../audio.ts';
import { currentSlot, deleteSlot, importSave, lastSlot, readSlot, saveNow, slotInfo, useSlot } from '../save.ts';
import { GOLD, icon, INK, panel, SOFT, text, title, type Txt, W } from './kit.ts';

export interface PanelKeys {
  x: number;
  y: number;
  act: boolean;
  back: boolean;
}

const ACTIONS = ['Keep a copy', 'Put a copy back', 'Delete'];
/** On the title the first action plays the chosen game: Play on the title menu only carries on the newest one. */
const PLAY = 'Play';
const TOP = 330;
const ROW = 120;
/** the action words' line, and the space between two of them */
const ACT_Y = TOP + 3 * ROW + 28;
const ACT_GAP = 48;

/** The saved games panel open now (title or pause menu), for the touch layer; null when none is. */
let openPanel: SlotsPanel | null = null;
export function openSlotsPanel(): SlotsPanel | null {
  // a scene that stopped took the panel's pictures with it
  return openPanel?.alive() ? openPanel : null;
}

/** The name a slot shows for its hero. */
export function heroLabel(hero: string): string {
  const c = app.content.chars[hero];
  if (!c) return hero;
  const n = c.name.startsWith('{') ? (app.personal.names[c.name.slice(1, -1)] ?? hero) : c.name;
  return n.charAt(0).toUpperCase() + n.slice(1);
}
/** One line for a slot: who, which day, how many shards. */
export function slotLine(n: number): string {
  const info = slotInfo(app.content, n);
  return info ? `${heroLabel(info.hero)}   Day ${info.day}   ${info.shards} of 7 shards` : 'Empty';
}

export class SlotsPanel {
  done = false;
  private box: Phaser.GameObjects.Container;
  private g: Phaser.GameObjects.Graphics;
  private rows: Txt[] = [];
  private faces: (Phaser.GameObjects.Image | null)[] = [null, null, null];
  private acts: Txt[] = [];
  private actions: string[];
  /** each action word's tap span across the screen */
  private actSpan: [number, number][] = [];
  private note: Txt;
  private help: Txt;
  private sel = 0;
  private act = 0;
  private asking = false;
  private busy = false;
  /** counts the waits for the file chooser: a wait she left with X is not answered any more */
  private wait = 0;
  private was = 1;
  private scene: Phaser.Scene;
  /** the game being played (pause menu), or null on the title */
  private game: Game | null;
  private onLoad: ((g: Game) => void) | null;
  /** the title's: start playing slot n; false when it cannot be read */
  private onPlay: ((n: number) => boolean) | null;

  constructor(
    scene: Phaser.Scene,
    depth: number,
    game: Game | null = null,
    onLoad: ((g: Game) => void) | null = null,
    onPlay: ((n: number) => boolean) | null = null,
  ) {
    this.scene = scene;
    this.game = game;
    this.onLoad = onLoad;
    this.onPlay = onPlay;
    this.actions = onPlay ? [PLAY, ...ACTIONS] : [...ACTIONS];
    this.g = scene.add.graphics();
    this.box = scene.add.container(0, 0, [this.g]).setDepth(depth);
    this.box.add(title(scene, W / 2, 230, 'Saved games', 54).setOrigin(0.5, 0));
    for (let i = 0; i < 3; i++) {
      const t = text(scene, W / 2 - 330, TOP + i * ROW + 30, '', 36);
      this.rows.push(t);
      this.box.add(t);
    }
    // the words sit side by side, centred, each as wide as it is when chosen ("▶ " in front), so nothing jumps
    const widths = this.actions.map((a) => {
      const t = text(scene, 0, ACT_Y, `▶ ${a}`, 32).setOrigin(0, 0);
      this.acts.push(t);
      this.box.add(t);
      return t.width;
    });
    let x = W / 2 - (widths.reduce((a, b) => a + b, 0) + ACT_GAP * (widths.length - 1)) / 2;
    this.acts.forEach((t, i) => {
      t.setX(x);
      this.actSpan.push([x - ACT_GAP / 2, x + widths[i]! + ACT_GAP / 2]);
      x += widths[i]! + ACT_GAP;
    });
    this.note = text(scene, W / 2, TOP + 3 * ROW + 96, '', 30, '#2e7d32').setOrigin(0.5, 0);
    this.help = text(scene, W / 2, TOP + 3 * ROW + 150, '', 28, SOFT).setOrigin(0.5, 0);
    this.box.add([this.note, this.help]);
    this.sel = Math.max(0, (game ? currentSlot() : 1) - 1);
    openPanel = this;
    this.draw();
  }

  alive(): boolean {
    return !!this.box.scene && !this.done;
  }

  private playing(n: number): boolean {
    return !!this.game && currentSlot() === n;
  }

  private draw(): void {
    const g = this.g;
    g.clear();
    g.fillStyle(0x10131f, 0.72).fillRect(0, 0, W, 1080);
    panel(g, W / 2 - 520, 200, 1040, 720);
    for (let i = 0; i < 3; i++) {
      const y = TOP + i * ROW;
      const on = i === this.sel;
      g.fillStyle(on ? GOLD : 0xe8d9b5, 1).fillRoundedRect(W / 2 - 460, y, 920, 104, 20);
      g.fillStyle(0xfffdf2, 1).fillRoundedRect(W / 2 - 454, y + 6, 908, 92, 16);
      const info = slotInfo(app.content, i + 1);
      this.faces[i]?.destroy();
      this.faces[i] = null;
      if (info) {
        const f = icon(this.scene, 'face_' + info.hero, W / 2 - 394, y + 52, 76);
        this.faces[i] = f;
        this.box.add(f);
      }
      this.rows[i]!.setText(`${i + 1}.  ${slotLine(i + 1)}${this.playing(i + 1) ? '   (this game)' : ''}`).setColor(
        on ? '#b3541e' : INK,
      );
    }
    this.acts.forEach((t, i) => {
      t.setText(`${i === this.act && !this.asking ? '▶ ' : ''}${this.actions[i]}`);
      t.setColor(i === this.act ? '#b3541e' : INK);
    });
    this.help.setText(
      this.asking
        ? touchState.shown
          ? 'Go: yes, delete it    Back: no'
          : 'Space: yes, delete it    X: no'
        : touchState.shown
          ? 'Tap a game. Then tap what to do.'
          : 'Up and down: game    Left and right: choose    Space: go    X: back',
    );
  }

  private say(msg: string, good = true): void {
    this.note.setText(msg).setColor(good ? '#2e7d32' : '#b3261e');
  }

  /** Hand over the slot's save as a file to keep. */
  private keep(n: number): void {
    if (this.playing(n) && this.game) saveNow(this.game, true);
    const json = readSlot(n);
    if (!json) {
      Sound.sfx('nope');
      this.say('There is no game here.', false);
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    a.download = `amelia-wishing-star-slot${n}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    this.say('Your copy is ready to keep.');
  }

  /** Ask for a save file and put it in the slot. The slot in play starts playing it at once. */
  private putBack(n: number): void {
    const was = this.game ? currentSlot() : lastSlot();
    const here = this.playing(n);
    const id = ++this.wait;
    this.was = was;
    this.busy = true;
    this.say('Choose a save file.');
    useSlot(n);
    void importSave(app.content, app.personal.names, xmasNow(), () => id === this.wait).then((ng) => {
      if (id !== this.wait) return;
      this.busy = false;
      if (ng) {
        adopt(ng);
        saveNow(ng, true);
      }
      if (this.game && !here) {
        // carry on with the game in play; its next save goes to its own slot again
        useSlot(was);
        saveNow(this.game, true);
      } else if (!ng) useSlot(was);
      if (!ng) this.say('That was not a save file. No problem!', false);
      else if (here && this.onLoad) {
        this.onLoad(ng);
        this.done = true;
        return;
      } else this.say('The copy is in.');
      this.draw();
    });
  }

  update(k: PanelKeys): void {
    if (this.busy && k.back) {
      // the file chooser is the browser's own and may never answer: X stops waiting, and nothing is changed
      this.wait++;
      this.busy = false;
      useSlot(this.was);
      this.say('');
      this.draw();
      return;
    }
    if (this.busy || this.done) return;
    const n = this.sel + 1;
    if (this.asking) {
      if (k.act) {
        deleteSlot(n);
        Sound.sfx('pick');
        this.asking = false;
        this.say('Deleted.');
        this.draw();
      } else if (k.back) {
        this.asking = false;
        this.say('');
        this.draw();
      }
      return;
    }
    if (k.y) {
      this.sel = (this.sel + k.y + 3) % 3;
      this.say('');
    }
    if (k.x) this.act = (this.act + k.x + this.actions.length) % this.actions.length;
    if (k.back) {
      this.done = true;
      return;
    }
    if (k.act) {
      const what = this.actions[this.act];
      if (what === PLAY) this.play(n);
      else if (what === ACTIONS[0]) this.keep(n);
      else if (what === ACTIONS[1]) this.putBack(n);
      else if (this.playing(n)) {
        Sound.sfx('nope');
        this.say('You are playing this one.', false);
      } else if (!slotInfo(app.content, n)) {
        Sound.sfx('nope');
        this.say('There is no game here.', false);
      } else {
        this.asking = true;
        this.say('Delete this game for good?', false);
      }
    }
    if (k.x || k.y || k.act) this.draw();
  }

  /** Title only: carry on with the chosen game. */
  private play(n: number): void {
    if (slotInfo(app.content, n) && this.onPlay?.(n)) {
      Sound.sfx('pick');
      this.done = true;
      return;
    }
    Sound.sfx('nope');
    this.say('There is no game here.', false);
  }

  /**
   * A tap from the touch layer, on the game screen (issue 18). A game row chooses that game; an action word does it at
   * once, inside the tap, so the iPad lets "Put a copy back" open its file chooser (Delete still asks first, and Go
   * answers); a tap off the panel is Back. While the panel is open nothing behind it takes a tap.
   */
  tap(x: number, y: number): void {
    if (this.done) return;
    if (Math.abs(x - W / 2) > 520 || y < 200 || y > 920) {
      this.update({ x: 0, y: 0, act: false, back: true });
      return;
    }
    if (this.busy || this.asking) return;
    const row = Math.floor((y - TOP) / ROW);
    if (Math.abs(x - W / 2) <= 460 && row >= 0 && row < 3 && y <= TOP + row * ROW + 104) {
      if (row !== this.sel) {
        this.sel = row;
        this.say('');
        Sound.sfx('tick');
        this.draw();
      }
      return;
    }
    const a = this.actSpan.findIndex(([l, r]) => x >= l && x <= r);
    if (a < 0 || y < ACT_Y - 30 || y > ACT_Y + 66) return;
    this.act = a;
    this.update({ x: 0, y: 0, act: true, back: false });
  }

  destroy(): void {
    if (openPanel === this) openPanel = null;
    this.box.destroy(true);
  }
}
