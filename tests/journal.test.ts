// The journal (docs/PHASE2.md part C): at most 60 stickers in three tabs, a sticker lands quietly, a set folds
// into one sticker, a finished tab gives its prize once, and an old save loses the stickers the game no longer has.
import { describe, expect, it } from 'vitest';
import { newDay } from '../src/core/clock.ts';
import { count } from '../src/core/cond.ts';
import { JOURNAL_TABS, sticker, TAB_PRIZE } from '../src/core/quests.ts';
import { newGame } from '../src/core/state.ts';
import { content } from '../src/data/content.ts';
import { journalStickers } from '../src/data/stickers.ts';
import { tidyJournal } from '../src/game/app.ts';

const fresh = () => newGame(content, { seed: 7, hero: 'amelia' });

describe('the journal', () => {
  it('has at most 60 stickers in three tabs, and no friend is a sticker', () => {
    const list = journalStickers(content.stickers);
    expect(list.length).toBeLessThanOrEqual(60);
    expect(new Set(list.map((s) => s.page)).size).toBe(3);
    for (const s of list) expect(JOURNAL_TABS as readonly string[]).toContain(s.page);
    expect(Object.keys(content.stickers).filter((id) => id.startsWith('friend_'))).toEqual([]);
    // every part belongs to a sticker the journal shows
    for (const s of Object.values(content.stickers)) if (s.of) expect(list.map((x) => x.id)).toContain(s.of);
  });

  it('a sticker lands quietly: a reward for the K hint, never a toast', () => {
    const g = fresh();
    g.ev.length = 0;
    sticker(g, 'mob_zombie');
    expect(g.s.stickers.mob_zombie).toBeTruthy();
    expect(g.ev.filter((e) => e.t === 'toast')).toEqual([]);
    expect(g.ev.filter((e) => e.t === 'reward' && e.kind === 'sticker').length).toBe(1);
    // the same one again does nothing
    g.ev.length = 0;
    sticker(g, 'mob_zombie');
    expect(g.ev).toEqual([]);
  });

  it('a set is one sticker: the first part lands it, later parts are quiet records', () => {
    const g = fresh();
    g.ev.length = 0;
    sticker(g, 'joey_3');
    expect(g.s.stickers.set_joeys).toBeTruthy();
    expect(g.ev.filter((e) => e.t === 'reward').map((e) => (e as { id: string }).id)).toEqual(['set_joeys']);
    g.ev.length = 0;
    sticker(g, 'joey_5');
    expect(g.s.stickers.joey_5).toBeTruthy();
    expect(g.ev).toEqual([]);
    // a find for the Nature Table is kept, quietly, and is no sticker
    sticker(g, 'shell_pink');
    expect(g.s.stickers.shell_pink).toBeTruthy();
    expect(g.ev).toEqual([]);
  });

  it('a finished tab gives its prize once, with one event for the banner', () => {
    const g = fresh();
    const gems = g.s.emeralds;
    const list = journalStickers(content.stickers).filter((s) => s.page === 'treasures');
    g.ev.length = 0;
    for (const s of list) sticker(g, s.id);
    expect(g.s.flags['page:treasures']).toBe(1);
    expect(g.s.emeralds).toBe(gems + (TAB_PRIZE.treasures?.emeralds ?? 0));
    expect(g.ev.filter((e) => e.t === 'reward' && e.kind === 'secret' && e.id === 'page:treasures').length).toBe(1);
    expect(g.ev.filter((e) => e.t === 'toast')).toEqual([]);
    const g2 = fresh();
    for (const s of journalStickers(content.stickers).filter((x) => x.page === 'creatures')) sticker(g2, s.id);
    expect(count(g2, TAB_PRIZE.creatures!.item!)).toBe(1);
  });

  it("Dad's sticker letter comes once, in the morning post after the last tab is full", () => {
    const g = fresh();
    const tabs = JOURNAL_TABS as readonly string[];
    const list = journalStickers(content.stickers);
    // two tabs full: nothing yet, however many mornings pass
    for (const s of list.filter((x) => x.page !== 'places')) sticker(g, s.id);
    newDay(g, true);
    expect(g.s.inbox).not.toContain('dad_stickers');
    expect(g.s.flags['mq:dad_stickers']).toBeUndefined();
    // the last tab: the letter is queued, and it lands with the next post
    const places = list.filter((x) => x.page === 'places');
    for (const s of places) sticker(g, s.id);
    expect(tabs.every((t) => g.s.flags['page:' + t])).toBe(true);
    expect(g.s.flags['mq:dad_stickers']).toBe(1);
    newDay(g, true);
    expect(g.s.inbox.filter((m) => m === 'dad_stickers').length).toBe(1);
    // once: a second landing or another morning adds nothing
    sticker(g, places[0]!.id);
    newDay(g, true);
    expect(g.s.inbox.filter((m) => m === 'dad_stickers').length).toBe(1);
    expect(content.letters.dad_stickers?.gift).toEqual({ star_lamp: 1 });
  });

  it("a save whose book was already full still gets Dad's letter, in the next morning's post", () => {
    const g = fresh();
    for (const s of journalStickers(content.stickers)) g.s.stickers[s.id] = 1;
    newDay(g, true);
    expect(g.s.inbox.filter((m) => m === 'dad_stickers').length).toBe(1);
    newDay(g, true);
    expect(g.s.inbox.filter((m) => m === 'dad_stickers').length).toBe(1);
  });

  it('a migrated save with a full book but no old prize flags gets the letter exactly once; a book one short does not', () => {
    // build 4 had a sticker the book no longer asks for, so the Creatures flag never set; every sticker of today's list is held
    const g = fresh();
    for (const s of journalStickers(content.stickers)) g.s.stickers[s.id] = 1;
    g.s.stickers.retired_old_sticker = 1;
    expect(g.s.flags['page:creatures']).toBeUndefined();
    newDay(g, true);
    expect(g.s.inbox.filter((m) => m === 'dad_stickers').length).toBe(1);
    newDay(g, true);
    newDay(g, true);
    expect(g.s.inbox.filter((m) => m === 'dad_stickers').length).toBe(1);
    // one short, whatever the stored flags say: nothing
    const h = fresh();
    const list = journalStickers(content.stickers);
    for (const s of list.slice(1)) h.s.stickers[s.id] = 1;
    for (const t of JOURNAL_TABS) h.s.flags['page:' + t] = 1;
    newDay(h, true);
    expect(h.s.inbox).not.toContain('dad_stickers');
  });

  it('an old save drops the stickers the game no longer has, and keeps a set she had started', () => {
    const g = fresh();
    Object.assign(g.s.stickers, { friend_mum: 1, apple: 1, potato_hat: 2, longdog_4: 3, tr_coin: 3, mob_zombie: 1 });
    g.s.flags['page:food'] = 1;
    g.s.flags['page:treasures'] = 1;
    tidyJournal(g);
    expect(Object.keys(g.s.stickers).sort()).toEqual(['longdog_4', 'mob_zombie', 'set_longdogs', 'tr_coin']);
    expect(g.s.flags['page:food']).toBeUndefined();
    // the old Treasure page was full, the new tab is not: its prize is still to win
    expect(g.s.flags['page:treasures']).toBeUndefined();
  });
});
