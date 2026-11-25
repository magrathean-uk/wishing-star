// Menus a child can leave with only the arrows and Space: a selectable Done after the last choice.
import { describe, expect, it } from 'vitest';
import { fakeUi } from './menu-harness.ts';
import { newGame } from '../src/core/state.ts';
import { content } from '../src/data/content.ts';

const { CraftMenu } = await import('../src/game/ui/menus/craft.ts');

describe('crafting table', () => {
  it('Down past the last recipe reaches Done, and Space there closes the table without making anything', () => {
    const g = newGame(content, { seed: 7, hero: 'amelia' });
    const { ui, sent, step } = fakeUi(g);
    const m = new CraftMenu(ui, 'table');
    const n = (m as any).list.length as number;
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < n; i++) step(m, { y: 1 });
    expect((m as any).sel).toBe(n);
    step(m, { act: true });
    expect(m.done).toBe(true);
    expect(sent).toEqual([]);
  });
});

const { ShopMenu, JukeboxMenu } = await import('../src/game/ui/menus/shop.ts');

describe('shops and the prize counter (issue 23)', () => {
  it('the prize counter: Down past the last prize reaches Done, and Space there leaves without buying', () => {
    const g = newGame(content, { seed: 7, hero: 'amelia' });
    const { ui, sent, step } = fakeUi(g);
    const m = new ShopMenu(ui, 'prizes');
    step(m, {});
    const n = (m as any).list.length as number;
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < n + 1 && (m as any).sel !== n; i++) step(m, { y: 1 });
    expect((m as any).sel).toBe(n);
    step(m, { act: true });
    expect(m.done).toBe(true);
    expect(sent).toEqual([]);
  });

  it('Space again and again on a prize only ever asks, with No first; it never buys or leaves on its own', () => {
    const g = newGame(content, { seed: 7, hero: 'amelia' });
    g.s.pouch.ticket = 99;
    const { ui, sent, step } = fakeUi(g);
    const m = new ShopMenu(ui, 'prizes');
    step(m, {});
    for (let i = 0; i < 6; i++) step(m, { act: true });
    expect(sent).toEqual([]);
    expect(m.done).toBe(false);
  });

  it('selling the last of a row keeps the cursor on the rows, not on Done', () => {
    const g = newGame(content, { seed: 7, hero: 'amelia' });
    g.s.bag[10] = { id: 'log', n: 5 };
    g.s.bag[11] = { id: 'coal', n: 5 };
    const { ui, step } = fakeUi(g);
    const m = new ShopMenu(ui, 'shop');
    step(m, { x: 1 });
    expect((m as any).tab).toBe('sell');
    const n = (m as any).list.length as number;
    expect(n).toBeGreaterThan(1);
    while ((m as any).sel !== n - 1) step(m, { y: 1 });
    // the last row sells away under the cursor
    const last = (m as any).list[n - 1].at as number;
    g.s.bag[last] = null;
    step(m, {});
    expect((m as any).list.length).toBe(n - 1);
    expect((m as any).sel).toBe(n - 2);
  });

  it('the jukebox: Done after the usual music, and Done alone when she has no discs', () => {
    const g = newGame(content, { seed: 7, hero: 'amelia' });
    const { ui, step } = fakeUi(g);
    const none = new JukeboxMenu(ui);
    step(none, { act: true });
    expect(none.done).toBe(true);

    g.s.pouch.disc_gum = 1;
    const m = new JukeboxMenu(ui);
    step(m, { y: 1 });
    step(m, { y: 1 });
    expect(m.done).toBe(false);
    step(m, { act: true });
    expect(m.done).toBe(true);
  });
});
