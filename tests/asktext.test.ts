// The text box over the game (writing a sign): Done and Back work by tap or click, as Enter and Escape do, and the
// box lets go of every listener when it closes.
import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: {} }));

type Fn = (e: any) => void;
class El {
  value = '';
  maxLength = 0;
  textContent = '';
  open = false;
  listeners = new Map<string, Set<Fn>>();
  classList = {
    add: () => {
      this.open = true;
    },
    remove: () => {
      this.open = false;
    },
  };
  addEventListener(t: string, f: Fn) {
    if (!this.listeners.has(t)) this.listeners.set(t, new Set());
    this.listeners.get(t)!.add(f);
  }
  removeEventListener(t: string, f: Fn) {
    this.listeners.get(t)?.delete(f);
  }
  fire(t: string, e: any = {}) {
    for (const f of [...(this.listeners.get(t) ?? [])]) f({ stopPropagation: () => undefined, ...e });
  }
  count() {
    let n = 0;
    for (const s of this.listeners.values()) n += s.size;
    return n;
  }
  focus() {}
  select() {}
}

const els: Record<string, El> = {};
for (const id of ['name-entry', 'name-input', 'name-label', 'name-hint', 'name-back', 'name-done']) els[id] = new El();
const noop = () => undefined;
(globalThis as any).document = { getElementById: (id: string) => els[id], addEventListener: noop };
(globalThis as any).window = { focus: noop, addEventListener: noop };

const { askText } = await import('../src/game/app.ts');

function fakeGame() {
  const keyboard = { enabled: true, preventDefault: true };
  return {
    keyboard,
    game: {
      input: { keyboard },
      scene: { getScenes: () => [] },
      canvas: { focus: () => undefined },
    } as any,
  };
}

describe('the text box over the game', () => {
  it('Done gives the typed words and Back gives the starting words', async () => {
    const { game, keyboard } = fakeGame();
    const p = askText(game, 'What should the sign say?', 'Hello', 'Type, then press Enter or Done');
    expect(els['name-entry']!.open).toBe(true);
    expect(keyboard.enabled).toBe(false);
    els['name-input']!.value = 'Ice cream here';
    els['name-done']!.fire('click');
    await expect(p).resolves.toBe('Ice cream here');
    expect(els['name-entry']!.open).toBe(false);
    expect(keyboard.enabled).toBe(true);

    const q = askText(game, 'What should the sign say?', 'Hello', '');
    els['name-input']!.value = 'Changed my mind';
    els['name-back']!.fire('click');
    await expect(q).resolves.toBe('Hello');
  });

  it('Enter in the box gives the words, Enter on a button does not, and Escape goes back', async () => {
    const { game } = fakeGame();
    const p = askText(game, 'What should the sign say?', 'Hello', '');
    els['name-input']!.value = 'Typed';
    els['name-entry']!.fire('keydown', { key: 'Enter', target: els['name-back'] });
    expect(els['name-entry']!.open).toBe(true);
    els['name-entry']!.fire('keydown', { key: 'Enter', target: els['name-input'] });
    await expect(p).resolves.toBe('Typed');

    const q = askText(game, 'What should the sign say?', 'Hello', '');
    els['name-input']!.value = 'Typed';
    els['name-entry']!.fire('keydown', { key: 'Escape', target: els['name-done'] });
    await expect(q).resolves.toBe('Hello');
  });

  it('lets go of every listener when it closes', async () => {
    const { game } = fakeGame();
    const p = askText(game, 'What should the sign say?', '', '');
    els['name-done']!.fire('click');
    await p;
    for (const id of ['name-entry', 'name-input', 'name-back', 'name-done']) expect(els[id]!.count()).toBe(0);
  });
});
