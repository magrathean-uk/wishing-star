// The keys are the ones in the design (section 3); nothing sits on Y, Z, Ctrl, Cmd or a function key. On an iPad the
// touch controls (src/game/touch.ts) press these same keys, so every rule and menu has one code path.
import Phaser from 'phaser';
import type { Cmd, Input } from '../core/types.ts';

/** Touch (package 65): `device` is set at boot on a touch device; `shown` while the touch controls are on screen. */
export const touchState = { device: false, shown: false };

const K = Phaser.Input.Keyboard.KeyCodes;
type Key = Phaser.Input.Keyboard.Key;

export class Keys {
  private left: Key[];
  private right: Key[];
  private up: Key[];
  private down: Key[];
  private act: Key[];
  private all: Record<string, Key> = {};
  private pressed = new Set<string>();
  /** one-shot presses waiting to be handed to the rules */
  private edgeAct = false;
  private edgeBack = false;
  private edgeUse = false;
  private edgeEmote = false;
  /** X alone (never Backspace): the bow shoots on it, and held for a second it skips a story scene */
  private edgeFire = false;
  private xKey: Key;
  private cmds: Cmd[] = [];
  /** asked when Space goes down in play: true takes the press (the view answering "Put it on? Space") */
  actHook: (() => boolean) | null = null;
  readonly input: Input = {
    mx: 0,
    my: 0,
    act: false,
    hold: false,
    back: false,
    fire: false,
    holdX: false,
    use: false,
    emote: false,
    cmd: null,
  };

  constructor(scene: Phaser.Scene) {
    const kb = scene.input.keyboard!;
    const k = (code: number) => kb.addKey(code, true, false);
    this.left = [k(K.LEFT), k(K.A)];
    this.right = [k(K.RIGHT), k(K.D)];
    this.up = [k(K.UP), k(K.W)];
    this.down = [k(K.DOWN), k(K.S)];
    this.act = [k(K.SPACE), k(K.ENTER)];
    // Back (X or Backspace) is read from key events; Backspace is only registered so the browser does not use it.
    this.xKey = k(K.X);
    k(K.BACKSPACE);
    const names: Record<string, number> = {
      E: K.E,
      B: K.B,
      Q: K.Q,
      M: K.M,
      K: K.K,
      R: K.R,
      G: K.G,
      P: K.P,
      F: K.F,
      ESC: K.ESC,
      TAB: K.TAB,
      ONE: K.ONE,
      TWO: K.TWO,
      THREE: K.THREE,
      FOUR: K.FOUR,
      FIVE: K.FIVE,
      SIX: K.SIX,
      SEVEN: K.SEVEN,
      EIGHT: K.EIGHT,
    };
    for (const n in names) this.all[n] = k(names[n]!);
    kb.on('keydown', (e: KeyboardEvent) => {
      if (e.repeat) return;
      this.pressed.add(e.code);
      if (e.code === 'Space' || e.code === 'Enter') this.edgeAct = true;
      if (e.code === 'KeyX' || e.code === 'Backspace') this.edgeBack = true;
      if (e.code === 'KeyX') this.edgeFire = true;
      if (e.code === 'KeyR') this.edgeUse = true;
      if (e.code === 'KeyG') this.edgeEmote = true;
      // H: the hint for now, also over a menu (src/core/hints.ts)
      if (e.code === 'KeyH') this.cmds.push({ c: 'hint' });
    });
    scene.game.events.on('blur', () => this.reset());
    scene.game.events.on('hidden', () => this.reset());
  }
  reset(): void {
    this.pressed.clear();
    this.edgeAct = this.edgeBack = this.edgeUse = this.edgeEmote = this.edgeFire = false;
  }
  /** Was this key pressed since the last call? (for menus; uses event.code names such as "KeyE", "ArrowUp") */
  take(code: string): boolean {
    return this.pressed.delete(code);
  }
  takeAny(...codes: string[]): boolean {
    let hit = false;
    for (const c of codes) if (this.pressed.delete(c)) hit = true;
    return hit;
  }
  /** A digit key 1 to 8 pressed since the last call, as 0 to 7, or -1. */
  takeDigit(): number {
    for (let i = 1; i <= 8; i++) if (this.pressed.delete('Digit' + i)) return i - 1;
    return -1;
  }
  clearPresses(): void {
    this.pressed.clear();
  }
  send(cmd: Cmd): void {
    this.cmds.push(cmd);
  }
  /** Held direction keys, for menus. */
  rawX(): number {
    return (this.any(this.right) ? 1 : 0) - (this.any(this.left) ? 1 : 0);
  }
  rawY(): number {
    return (this.any(this.down) ? 1 : 0) - (this.any(this.up) ? 1 : 0);
  }
  private any(keys: Key[]): boolean {
    for (const k of keys) if (k.isDown) return true;
    return false;
  }
  /** Build the input for one step of the rules. One-shot presses are delivered once. `menu` blocks movement keys. */
  next(menu: boolean): Input {
    const i = this.input;
    i.mx = menu ? 0 : (this.any(this.right) ? 1 : 0) - (this.any(this.left) ? 1 : 0);
    i.my = menu ? 0 : (this.any(this.down) ? 1 : 0) - (this.any(this.up) ? 1 : 0);
    if (!menu && this.edgeAct && this.actHook?.()) this.edgeAct = false;
    i.hold = !menu && this.any(this.act);
    i.act = !menu && this.edgeAct;
    i.back = !menu && this.edgeBack;
    i.fire = !menu && this.edgeFire;
    i.holdX = !menu && this.xKey.isDown;
    i.use = !menu && this.edgeUse;
    i.emote = !menu && this.edgeEmote;
    if (!menu) this.edgeAct = this.edgeBack = this.edgeUse = this.edgeEmote = this.edgeFire = false;
    i.cmd = this.cmds.shift() ?? null;
    return i;
  }
  /** Menus read confirm and back themselves. */
  menuAct(): boolean {
    const v = this.edgeAct;
    this.edgeAct = false;
    this.pressed.delete('Space');
    this.pressed.delete('Enter');
    return v;
  }
  menuBack(): boolean {
    const v = this.edgeBack;
    this.edgeBack = this.edgeFire = false;
    this.pressed.delete('KeyX');
    this.pressed.delete('Backspace');
    return v;
  }
  hasCmds(): boolean {
    return this.cmds.length > 0;
  }
}

/** A held direction as one move, then a slow repeat: for menus. */
export class Repeater {
  private last = 0;
  private t = 0;
  step(dir: number, dt: number): number {
    if (dir !== this.last) {
      this.last = dir;
      this.t = 0.3;
      return dir;
    }
    if (dir === 0) return 0;
    this.t -= dt;
    if (this.t <= 0) {
      this.t = 0.11;
      return dir;
    }
    return 0;
  }
}
