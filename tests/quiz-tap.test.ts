// The school quiz on an iPad: the touch layer hands a tap to the quiz view, which picks the answer card under it.
import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: {} }));
vi.mock('../src/game/ui/kit.ts', () => ({
  GOLD: '',
  H: 1080,
  INK: '',
  W: 1920,
  outlined: vi.fn(),
  text: vi.fn(),
  title: vi.fn(),
}));

const { QuizView } = await import('../src/game/ui/quizview.ts');

function view(mini: unknown) {
  const send = vi.fn();
  const v = Object.create(QuizView.prototype) as InstanceType<typeof QuizView>;
  Object.assign(v, { ui: { g: { rt: { mini } }, keys: { send } } });
  return { v, send };
}

describe('quiz tap', () => {
  it('picks the card under the finger while the quiz runs', () => {
    const { v, send } = view({ game: 'quiz', st: 1, quiz: { picked: -1 } });
    expect(v.tap(1440, 760)).toBe(true);
    expect(send).toHaveBeenCalledWith({ c: 'choose', i: 2 });
  });
  it('takes a tap off the cards without choosing, and never chooses twice', () => {
    const { v, send } = view({ game: 'quiz', st: 1, quiz: { picked: -1 } });
    expect(v.tap(960, 300)).toBe(true);
    const done = view({ game: 'quiz', st: 1, quiz: { picked: 1 } });
    expect(done.v.tap(480, 760)).toBe(true);
    expect(send).not.toHaveBeenCalled();
    expect(done.send).not.toHaveBeenCalled();
  });
  it('leaves the start and end cards and other mini-games to the touch layer', () => {
    expect(view({ game: 'quiz', st: 0, quiz: { picked: -1 } }).v.tap(480, 760)).toBe(false);
    expect(view({ game: 'targets', st: 1 }).v.tap(480, 760)).toBe(false);
    expect(view(null).v.tap(480, 760)).toBe(false);
  });
});
