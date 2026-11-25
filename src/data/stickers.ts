// The journal's stickers (K): three tabs, at most 60 stickers in all (docs/PHASE2.md part C). Friends are not
// stickers: who she has met is its own record (g.s.met) and has its own page in the journal.
//
// How to count: `journalStickers()` is the list the journal shows (60 today), `JOURNAL_TABS` its three tabs.
// Everything else in `stickers` is a quiet record that never shows as a sticker of its own: a part of a set
// (it has `of`), or a find kept for the Nature Table (the beach, flowers and ores shelves).
import { JOURNAL_TABS } from '../core/quests.ts';
import type { StickerDef, StickerPage } from '../core/types.ts';
import { items } from './items.ts';
import { animals, landmarks, mobs } from './world.ts';

const S: Record<string, StickerDef> = {};
const st = (id: string, page: StickerPage, name: string, art = id, more: Partial<StickerDef> = {}) => {
  S[id] = { id, page, name, art, ...more };
};

// Every sticker here comes from something she does: meets or beats the creature, opens the chest or digs the X,
// finds the place (package 44b). None waits on luck or the clock: the three rare surprises (src/core/surprises.ts)
// come on a random morning after days of waiting, so they are quiet records now, not journal stickers.

// ---- Creatures (15): every mob and both bosses, the animals she can bring home, and two sets
for (const id in mobs) if (id !== 'mini_creeper') st('mob_' + id, 'creatures', mobs[id]!.name, 'face_' + id);
for (const id of ['chicken', 'pig', 'cow', 'sheep', 'wolf', 'cat'])
  st('animal_' + id, 'creatures', animals[id]!.name, 'face_' + id);
st('set_joeys', 'creatures', 'joeys', 'joey');
for (let i = 1; i <= 8; i++) st('joey_' + i, 'creatures', 'joey ' + i, 'joey', { of: 'set_joeys' });
st('set_fish', 'creatures', 'fish', 'goldfish');
for (const id in items) if (items[id]!.page === 'fish') st(id, 'creatures', items[id]!.name, id, { of: 'set_fish' });

// ---- Treasures (12): the eight hidden treasures and four sets of hidden things
for (const [id, name, art] of [
  ['tr_crown', 'tiny crown'],
  ['tr_coin', 'old coin'],
  ['tr_pearl', 'pearl'],
  ['tr_ring', 'gold ring'],
  ['tr_goblet', 'silver cup'],
  ['tr_gem', 'red gem'],
  ['tr_shell', 'rainbow shell'],
  // the fairy's gift at night is star bits, so it wears their picture (it has no treasure picture of its own)
  ['tr_fairy', 'fairy gift', 'star_fragment'],
] as const)
  st(id, 'treasures', name, art ?? id.replace('tr_', 'treasure_'));
st('set_longdogs', 'treasures', 'long dogs', 'long_dog');
for (let i = 1; i <= 10; i++) st('longdog_' + i, 'treasures', 'long dog ' + i, 'long_dog', { of: 'set_longdogs' });
st('set_dinos', 'treasures', 'toy dinos', 'dino_green');
for (const id in items) if (items[id]!.page === 'dinos') st(id, 'treasures', items[id]!.name, id, { of: 'set_dinos' });
// Dad's key: one piece at each X of his treasure trail (sq_dad_trail, the dig spots say "sticker.dadkey_<n>")
st('set_dadkey', 'treasures', "{dad}'s key", 'dads_map');
for (let i = 1; i <= 5; i++) st('dadkey_' + i, 'treasures', 'key piece ' + i, 'dads_map', { of: 'set_dadkey' });
// the five music discs, hidden in far corners (a dig, two chests, a cracked rock) and one at Hamm's counter
st('set_discs', 'treasures', 'music discs', 'disc_star');
for (const id in items) if (items[id]!.page === 'discs') st(id, 'treasures', items[id]!.name, id, { of: 'set_discs' });

// ---- quiet records of the rare surprises (src/core/surprises.ts still gives them): never journal stickers
st('surprise_jockey', 'mobs', 'chicken jockey', 'face_zombie');
st('surprise_stampede', 'mobs', 'Minion stampede', 'face_kevin');
st('surprise_prank', 'mobs', "Kuromi's prank", 'face_kuromi');

// ---- Places (32): the 15 regions, found by walking in, and 17 landmarks (world.ts), found by getting close (src/core/island.ts)
for (const [region, name, art] of [
  ['indoors', 'your cottage', 'cottage'],
  ['home', 'Home Meadow', 'mailbox'],
  ['square', 'Wishing Square', 'lamp_post'],
  ['bay', 'Sandy Bay', 'palm'],
  ['treasure', 'Treasure Island', 'boat_wreck'],
  ['heeler', 'Heeler Heights', 'poinciana'],
  ['bing', "Bing's Garden", 'swing_set'],
  ['peppa', "Peppa's Hill", 'oak'],
  ['valley', 'Muddy Valley', 'puddle'],
  ['gum', 'Gum Tree Grove', 'gum_tree'],
  ['plains', 'the Blocky Plains', 'block_oak'],
  ['forest', 'the Blocky Forest', 'dark_oak'],
  ['crater', 'Creeper Crater', 'burnt_tree'],
  ['mine', 'the Mine', 'mine_mouth'],
  ['hall', "the King's Hall", 'hall_gate'],
] as const)
  st('place_' + region, 'places', name, art, { spot: { region } });
for (const d of Object.values(landmarks))
  st('place_' + d.id, 'places', d.name, d.art, { spot: d.area ? { area: d.area } : { at: d.at, r: d.r ?? 3 } });

// ---- quiet records for the Nature Table's shelves (never journal stickers)
for (const id in items) {
  const page = items[id]!.page;
  if (page === 'beach' || page === 'flowers' || page === 'ores') st(id, page, items[id]!.name, id);
}

export const stickers = S;
export { JOURNAL_TABS };
/** The stickers the journal shows: the three tabs, without the parts of sets and the quiet records. */
export function journalStickers(list: Record<string, StickerDef> = S): StickerDef[] {
  return Object.values(list).filter((s) => !s.of && (JOURNAL_TABS as readonly string[]).includes(s.page));
}
