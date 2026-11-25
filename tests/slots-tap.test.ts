// Issue 18 and 49: the saved games panel by taps. A tap on a game row chooses it, a tap on an action does it at once
// (inside the tap, so the iPad opens its file chooser), Delete still asks first, and a tap off the panel is Back.
// On the title the panel also offers Play for any of the three games.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: {} }));
vi.mock('../src/game/audio.ts', () => ({ Sound: { sfx: vi.fn() } }));
vi.mock('../src/game/input.ts', () => ({ touchState: { shown: true } }));
vi.mock('../src/game/app.ts', () => ({ adopt: vi.fn(), app: { content: {} }, xmasNow: () => false }));
const info = vi.fn((_c: unknown, n: number) => (n === 3 ? null : { hero: 'koala', day: n * 4, shards: 1 }));
vi.mock('../src/game/save.ts', () => ({
  currentSlot: () => 1,
  deleteSlot: vi.fn(),
  importSave: vi.fn(),
  lastSlot: () => 1,
  readSlot: vi.fn(),
  saveNow: vi.fn(),
  slotInfo: (c: unknown, n: number) => info(c, n),
  useSlot: vi.fn(),
}));
vi.mock('../src/game/ui/kit.ts', () => ({ GOLD: 0, INK: '', SOFT: '', W: 1920, icon: vi.fn(), panel: vi.fn() }));

const { SlotsPanel } = await import('../src/game/ui/slots.ts');
type Panel = { tap(x: number, y: number): void } & Record<string, unknown>;

/** A panel without a scene: the action words laid out as the constructor lays them out (each 200 wide). */
function panel(title: boolean): Panel {
  const p = Object.create(SlotsPanel.prototype) as Panel;
  const actions = title
    ? ['Play', 'Keep a copy', 'Put a copy back', 'Delete']
    : ['Keep a copy', 'Put a copy back', 'Delete'];
  const left = 960 - (actions.length * 200 + (actions.length - 1) * 48) / 2;
  const onPlay = vi.fn(() => true);
  Object.assign(p, {
    done: false,
    sel: 0,
    act: 0,
    asking: false,
    busy: false,
    game: null,
    actions,
    actSpan: actions.map((_, i) => [left + i * 248 - 24, left + i * 248 + 224]),
    onPlay: title ? onPlay : null,
    draw: vi.fn(),
    say: vi.fn(),
    keep: vi.fn(),
    putBack: vi.fn(),
  });
  return p;
}
/** The middle of action word i. */
const actX = (p: Panel, i: number) => {
  const [l, r] = (p.actSpan as [number, number][])[i]!;
  return (l + r) / 2;
};

describe('saved games by taps', () => {
  beforeEach(() => info.mockClear());

  it('chooses the tapped game, then does the tapped action on it at once', () => {
    const p = panel(false);
    p.tap(960, 450 + 50);
    expect(p.sel).toBe(1);
    p.tap(actX(p, 1), 740);
    expect(p.act).toBe(1);
    expect(p.putBack).toHaveBeenCalledWith(2);
    p.tap(actX(p, 0), 740);
    expect(p.keep).toHaveBeenCalledWith(2);
  });

  it('asks before Delete and takes no other tap until Go or Back answers', () => {
    const p = panel(false);
    p.tap(960, 500);
    p.tap(actX(p, 2), 740);
    expect(p.asking).toBe(true);
    p.tap(960, 380);
    expect(p.sel).toBe(1);
    expect(p.asking).toBe(true);
  });

  it('goes back on a tap off the panel and ignores the gaps between things', () => {
    const p = panel(false);
    p.tap(960, 430);
    expect(p.done).toBe(false);
    p.tap(100, 500);
    expect(p.done).toBe(true);
  });

  it('plays any game from the title, and says so when the slot is empty', () => {
    const p = panel(true);
    p.tap(960, 450 + 50);
    p.tap(actX(p, 0), 740);
    expect(p.onPlay).toHaveBeenCalledWith(2);
    expect(p.done).toBe(true);
    const q = panel(true);
    q.tap(960, 570 + 50);
    q.tap(actX(q, 0), 740);
    expect(q.onPlay).not.toHaveBeenCalled();
    expect(q.done).toBe(false);
  });
});
