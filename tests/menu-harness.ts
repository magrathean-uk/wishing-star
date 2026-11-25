// A stand-in for the UI scene, so a menu's own keyboard and touch rules can be driven without a browser: every
// picture or word it makes is a do-nothing object, and the keys are pressed by the test.
import { vi } from 'vitest';
import type { Cmd, Game } from '../src/core/types.ts';

vi.mock('phaser', () => ({
  default: { Input: { Keyboard: { KeyCodes: new Proxy({}, { get: () => 0 }) } } },
}));
vi.mock('../src/game/audio.ts', () => ({ Sound: { sfx: () => undefined, music: () => undefined } }));

/** A do-nothing game object: any call returns it again, so chained setters work. */
export function stub(): any {
  const target = () => undefined;
  const p: any = new Proxy(target, {
    get: (_t, k) => {
      if (k === 'width' || k === 'height' || k === 'x' || k === 'y' || k === 'displayWidth' || k === 'displayHeight')
        return 100;
      if (k === 'visible') return true;
      if (k === 'list') return [];
      if (k === Symbol.toPrimitive) return () => 0;
      if (k === 'then') return undefined;
      return p;
    },
    apply: () => p,
  });
  return p;
}

/** Keys pressed for one update: arrows as -1/0/1, Space (act), X (back) and named key codes. */
export interface Press {
  x?: number;
  y?: number;
  act?: boolean;
  back?: boolean;
  key?: string;
}

export function fakeUi(g: Game) {
  let press: Press = {};
  const sent: Cmd[] = [];
  const opened: string[] = [];
  const keys = {
    rawX: () => press.x ?? 0,
    rawY: () => press.y ?? 0,
    menuAct: () => {
      const a = !!press.act;
      press.act = false;
      return a;
    },
    menuBack: () => {
      const b = !!press.back;
      press.back = false;
      return b;
    },
    take: (code: string) => {
      if (press.key !== code) return false;
      press.key = undefined;
      return true;
    },
    takeAny: (...codes: string[]) => codes.some((c) => keys.take(c)),
    takeDigit: () => -1,
    clearPresses: () => undefined,
    send: (c: Cmd) => sent.push(c),
  };
  const ui: any = new Proxy(
    { g, keys, open: (name: string) => opened.push(name) },
    { get: (t: any, k) => (k in t ? t[k] : stub()) },
  );
  /** One update with these keys held, then one with nothing held (so the next press counts as new). */
  const step = (menu: { update(dt: number): void }, p: Press) => {
    press = { ...p };
    menu.update(1 / 60);
    press = {};
    menu.update(1 / 60);
  };
  return { ui, sent, opened, step };
}
