// Players mode on the title (D67): "Who is playing?" (her entry at the top, then Player 1 to 10) and the password's
// four boxes. Arrow keys and Space or Enter, or the mouse, on the list; typing, Backspace, Enter and Esc for the
// password. On an iPad a tap on the list, and the iPad's own keyboard through a hidden input (package 65). Also the
// credit line (D68): small, bottom right, for every player but her own entry.
import type Phaser from 'phaser';
import { app } from '../app.ts';
import { touchState } from '../input.ts';
import { movedOn, net, showCredit } from '../net.ts';
import { carryOnNext } from '../save.ts';
import { INK, panel, SOFT, text, title, type Txt, W } from './kit.ts';

const S = (k: string) => app.content.strings[k] ?? '';
const CREDIT_URL = 'https://magrathean.uk';

const TOP = 110;
const ROW = 64;
const LIST_W = 720;

/** The credit line: the game's smallest text, in the bottom right corner. One text object, made once. */
export function creditLine(scene: Phaser.Scene, faint: boolean): Txt {
  return text(scene, W - 14, scene.scale.height - 8, S('credit_line'), 20, '#ffffff')
    .setOrigin(1, 1)
    .setAlpha(faint ? 0.55 : 0.85)
    .setShadow(0, 2, 'rgba(0,0,0,0.6)', 2, false, true);
}

/** A click on the credit line opens the address in a new tab. */
export function openCredit(): void {
  window.open(CREDIT_URL, '_blank', 'noopener');
}

/**
 * The credit during play, for Player 1 to 10: one small, faint line under everything else in the UI scene, hidden
 * in story scenes, the finale, menus, mini-games and anything that is not plain walking. It takes no clicks.
 */
let hooked = false;
export function creditInPlay(game: Phaser.Game): void {
  if (hooked) return;
  hooked = true;
  const ui = game.scene.getScene('UI');
  ui.events.on('create', () => {
    if (net.on) movedCard(ui);
    if (!showCredit()) return;
    const t = creditLine(ui, true).setDepth(0).setVisible(false);
    const tick = () => {
      const g = ui.registry.get('game') as { rt: { mode: string; cut: unknown } } | undefined;
      const on = !!g && g.rt.mode === 'play' && !g.rt.cut && !(ui as unknown as { overlay: unknown }).overlay;
      if (on !== t.visible) t.setVisible(on);
    };
    ui.events.on('postupdate', tick);
    ui.events.once('shutdown', () => ui.events.off('postupdate', tick));
  });
}

interface PlayView {
  s: { area: string; x: number; y: number };
  rt: {
    mode: string;
    cut: unknown;
    talk: unknown;
    mini: unknown;
    hurtT: number;
    mobs: { area: string; x: number; y: number; calm?: boolean; gone?: boolean; doze?: boolean }[];
  };
}
/** Calm: plain walking, with no talk, story scene, menu, mini-game or mob close by. */
function calm(ui: Phaser.Scene): boolean {
  const g = ui.registry.get('game') as PlayView | undefined;
  if (g?.rt.mode !== 'play' || g.rt.cut || g.rt.talk || g.rt.mini || g.rt.hurtT > 0) return false;
  if ((ui as unknown as { overlay: unknown }).overlay) return false;
  return !g.rt.mobs.some(
    (m) => m.area === g.s.area && !m.calm && !m.gone && !m.doze && Math.hypot(m.x - g.s.x, m.y - g.s.y) < 9,
  );
}

/**
 * The server's game moved on without this device (a 409, package 62f): at the next calm moment one card, "Your game
 * moved on. Space: carry on from there." Space (or a tap) opens a fresh page that carries straight on from the
 * server's game; this device's own play is kept aside for Dad and never uploaded.
 */
function movedCard(ui: Phaser.Scene): void {
  let shown = false;
  const tick = () => {
    if (shown || !movedOn() || !calm(ui)) return;
    shown = true;
    const H = ui.scale.height;
    const box = ui.add.container(0, 0).setDepth(90000);
    const gr = ui.add.graphics();
    gr.fillStyle(0x10131f, 0.7).fillRect(0, 0, W, H);
    panel(gr, W / 2 - 520, H / 2 - 160, 1040, 320);
    box.add(gr);
    box.add(title(ui, W / 2, H / 2 - 100, S('pl_moved'), 54).setOrigin(0.5, 0));
    box.add(text(ui, W / 2, H / 2 + 30, S('pl_moved_go'), 36, INK).setOrigin(0.5, 0));
    if (ui.scene.isActive('World')) ui.scene.pause('World');
    ui.scene.pause();
    const go = () => {
      window.removeEventListener('keydown', onKey, true);
      ui.game.canvas.removeEventListener('pointerdown', go);
      carryOnNext();
      window.location.reload();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' && e.code !== 'Enter') return;
      e.preventDefault();
      go();
    };
    window.addEventListener('keydown', onKey, true);
    ui.game.canvas.addEventListener('pointerdown', go);
  };
  ui.events.on('postupdate', tick);
  ui.events.once('shutdown', () => ui.events.off('postupdate', tick));
}

type Step = 'list' | 'pass';

/** The picker on screen, for the hidden input. */
let current: PlayerPicker | null = null;
let inp: HTMLInputElement | null = null;

/** A key press on the window, as the game's keyboard reads it (Enter sends, Escape goes back). */
function sendKey(code: 'Enter' | 'Escape', keyCode: number): void {
  const e = new KeyboardEvent('keydown', { code, key: code, bubbles: true, cancelable: true });
  Object.defineProperty(e, 'keyCode', { get: () => keyCode });
  window.dispatchEvent(e);
  const u = new KeyboardEvent('keyup', { code, key: code, bubbles: true, cancelable: true });
  Object.defineProperty(u, 'keyCode', { get: () => keyCode });
  setTimeout(() => window.dispatchEvent(u), 60);
}

/**
 * A real text box kept out of sight: focused inside the tap that opens the password, so the iPad's own keyboard
 * comes up. What she types is mirrored into the four drawn boxes; 4 letters send it. The page must not jump or zoom:
 * the box sits fixed at the top left in 16 pixel letters (Safari zooms on anything smaller).
 */
function hiddenInput(): HTMLInputElement {
  if (inp) return inp;
  const i = document.createElement('input');
  i.type = 'text';
  i.id = 'pass-input';
  i.maxLength = 4;
  for (const [k, v] of Object.entries({
    autocapitalize: 'off',
    autocomplete: 'off',
    autocorrect: 'off',
    spellcheck: 'false',
    inputmode: 'text',
    enterkeyhint: 'go',
    'aria-label': 'Password',
  }))
    i.setAttribute(k, v);
  i.style.cssText =
    'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;border:0;padding:0;margin:0;font-size:16px;' +
    'caret-color:transparent;color:transparent;background:transparent;pointer-events:none;z-index:-1';
  i.addEventListener('keydown', (e) => {
    // the game's keyboard must not read these letters twice; Enter and Escape go to it as keys
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      sendKey('Enter', 13);
    } else if (e.key === 'Escape') sendKey('Escape', 27);
  });
  i.addEventListener('input', () => {
    const p = current;
    const v = i.value
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 4);
    if (i.value !== v) i.value = v;
    if (p?.step !== 'pass') return;
    p.setTyped(v);
    if (v.length === 4) sendKey('Enter', 13);
  });
  i.addEventListener('blur', () => window.scrollTo(0, 0));
  document.body.appendChild(i);
  inp = i;
  return i;
}

/** The hidden input for the password (touch only): open inside a tap, closed when the boxes go. */
export const typing = {
  open(): void {
    if (!touchState.device) return;
    const i = hiddenInput();
    i.value = current?.step === 'pass' ? current.typed : '';
    i.focus({ preventScroll: true });
    // opened for a tap on the list: if the boxes do not follow, put the keyboard away again
    setTimeout(() => {
      if (current?.step !== 'pass') typing.close();
    }, 1200);
  },
  close(): void {
    if (inp && document.activeElement === inp) inp.blur();
  },
};

/** The list and the password, drawn over the title. */
export class PlayerPicker {
  step: Step = 'list';
  sel = 0;
  typed = '';
  private scene: Phaser.Scene;
  private root: Phaser.GameObjects.Container;
  private g: Phaser.GameObjects.Graphics;
  private rows: Txt[] = [];
  private head: Txt;
  private sub: Txt;
  private boxes: Txt[] = [];
  private msg: Txt;
  private help: Txt;

  constructor(scene: Phaser.Scene, depth: number) {
    this.scene = scene;
    this.root = scene.add.container(0, 0).setDepth(depth);
    this.g = scene.add.graphics();
    this.root.add(this.g);
    this.head = title(scene, W / 2, 0, '', 54).setOrigin(0.5, 0);
    this.sub = text(scene, W / 2, 0, '', 36, INK).setOrigin(0.5, 0);
    this.msg = text(scene, W / 2, 0, '', 36, '#b3261e').setOrigin(0.5, 0);
    this.help = text(scene, W / 2, 0, '', 28, SOFT).setOrigin(0.5, 0);
    this.root.add([this.head, this.sub, this.msg, this.help]);
    for (let i = 0; i < net.players.length; i++) {
      const t = text(scene, W / 2, TOP + 124 + i * ROW, net.players[i]!.label, 38, INK).setOrigin(0.5, 0);
      this.rows.push(t);
      this.root.add(t);
    }
    for (let i = 0; i < 4; i++) {
      const t = title(scene, W / 2 - 195 + i * 130, 500, '', 72).setOrigin(0.5, 0.5);
      this.boxes.push(t);
      this.root.add(t);
    }
    const at = net.players.findIndex((p) => p.id === net.id);
    this.sel = Math.max(0, at);
    current = this;
    this.draw();
  }

  /** Letters from the hidden input (touch). */
  setTyped(v: string): void {
    if (v === this.typed) return;
    this.typed = v;
    this.msg.setText('');
    this.draw();
  }

  /** Straight to the password for a player (a remembered player whose login has run out). */
  askPassword(id: string): void {
    this.sel = Math.max(
      0,
      net.players.findIndex((p) => p.id === id),
    );
    this.step = 'pass';
    this.typed = '';
    this.msg.setText('');
    this.draw();
  }
  backToList(): void {
    typing.close();
    this.step = 'list';
    this.typed = '';
    this.msg.setText('');
    this.draw();
  }
  say(line: string): void {
    this.msg.setText(line);
  }

  move(by: number): void {
    const n = net.players.length;
    this.sel = (this.sel + by + n) % n;
    this.draw();
  }

  /** A key on the password step: true when Enter sends four letters. */
  key(e: KeyboardEvent): 'send' | 'back' | 'typed' | '' {
    if (e.key === 'Escape') return 'back';
    if (e.key === 'Enter') return this.typed.length === 4 ? 'send' : '';
    if (e.key === 'Backspace') {
      this.typed = this.typed.slice(0, -1);
      this.msg.setText('');
      this.draw();
      return 'typed';
    }
    if (/^[a-zA-Z0-9]$/.test(e.key) && this.typed.length < 4) {
      this.typed += e.key.toLowerCase();
      this.msg.setText('');
      this.draw();
      return 'typed';
    }
    return '';
  }

  /** The row under a point on the 1920 x 1080 screen, or -1. */
  rowAt(x: number, y: number): number {
    if (this.step !== 'list' || Math.abs(x - W / 2) > LIST_W / 2 - 20) return -1;
    const i = Math.floor((y - (TOP + 114)) / ROW);
    return i >= 0 && i < net.players.length ? i : -1;
  }

  private draw(): void {
    const g = this.g;
    const H = this.scene.scale.height;
    g.clear();
    g.fillStyle(0x10131f, 0.72).fillRect(0, 0, W, H);
    const list = this.step === 'list';
    for (const r of this.rows) r.setVisible(list);
    for (const b of this.boxes) b.setVisible(!list);
    this.sub.setVisible(!list);
    if (list) {
      const h = 124 + net.players.length * ROW + 90;
      panel(g, W / 2 - LIST_W / 2, TOP, LIST_W, h);
      this.head.setText(S('pl_who')).setY(TOP + 30);
      this.rows.forEach((t, i) => {
        const on = i === this.sel;
        if (on) {
          g.fillStyle(0xf2b84b, 1).fillRoundedRect(
            W / 2 - LIST_W / 2 + 40,
            TOP + 116 + i * ROW,
            LIST_W - 80,
            ROW - 6,
            16,
          );
          g.fillStyle(0xfffdf2, 1).fillRoundedRect(
            W / 2 - LIST_W / 2 + 46,
            TOP + 122 + i * ROW,
            LIST_W - 92,
            ROW - 18,
            12,
          );
        }
        t.setText(`${on ? '▶ ' : ''}${net.players[i]!.label}`).setColor(on ? '#b3541e' : INK);
      });
      this.help.setText(S(touchState.shown ? 'pl_keys_list_touch' : 'pl_keys_list')).setY(TOP + h - 62);
      this.msg.setY(TOP + h + 20);
      return;
    }
    const top = 260;
    panel(g, W / 2 - 440, top, 880, 520);
    this.head.setText(net.players[this.sel]?.label ?? '').setY(top + 30);
    this.sub.setText(S('pl_pass')).setY(top + 110);
    for (let i = 0; i < 4; i++) {
      const x = W / 2 - 195 + i * 130;
      const on = i === Math.min(this.typed.length, 3);
      g.fillStyle(on ? 0xf2b84b : 0xd9c39a, 1).fillRoundedRect(x - 55, 440, 110, 120, 18);
      g.fillStyle(0xfffdf2, 1).fillRoundedRect(x - 49, 446, 98, 108, 14);
      this.boxes[i]!.setText(this.typed[i] ?? '').setColor(INK);
    }
    this.msg.setY(top + 320);
    this.help.setText(S(touchState.shown ? 'pl_keys_pass_touch' : 'pl_keys_pass')).setY(top + 420);
    if (inp && inp.value !== this.typed) inp.value = this.typed;
  }

  destroy(): void {
    typing.close();
    if (current === this) current = null;
    this.root.destroy(true);
  }
}
