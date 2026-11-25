// Saves in the browser: three slots, each with a "previous" copy, written to a temporary key first and then swapped.
// Players mode (D67): one save per player instead of the slots, also sent to the server. Each save carries its counter
// `n` (it only grows on this device), `dev` (this device) and `base` (the server's `n` this copy was made from), so the
// server never takes a stale game over the real one (package 62f).
import { load, serialize, summary } from '../core/save.ts';
import type { Content, Game } from '../core/types.ts';
import { content } from '../data/content.ts';
import {
  deviceId,
  fetchSave,
  homeDelete,
  homeDrop,
  homeFetch,
  homeFlush,
  homeSend,
  resumeUploads,
  upload,
  uploads,
} from './net.ts';

/** players mode: the logged-in player's id; '' is the home copy with its three slots */
let player = '';
const slotKey = (n: number) => `ws_save_${n}`;
const key = (n: number) => (player ? `ws_pl_${player}` : slotKey(n));
let slot = 1;

/** Players mode: from now on the save is this player's own (and '' goes back to the slots). */
export function usePlayer(id: string): void {
  player = id;
  lastJson = '';
}
function counter(): number {
  try {
    return Number(localStorage.getItem(`${key(1)}_n`) ?? '0') || 0;
  } catch {
    return 0;
  }
}
function setCounter(n: number): void {
  try {
    localStorage.setItem(`${key(1)}_n`, String(n));
  } catch {
    // storage off: the server copy still counts
  }
}
/** The server's counter this device's copy came from (0: never synced). */
function base(): number {
  try {
    return Number(localStorage.getItem(`${key(1)}_base`) ?? '0') || 0;
  } catch {
    return 0;
  }
}
function setBase(n: number, id = player): void {
  try {
    localStorage.setItem(`ws_pl_${id}_base`, String(n));
  } catch {
    // storage off
  }
}
/** What the server keeps: the core's save wrapped with the counter, the device and the copy it came from. */
const wrap = (n: number, json: string) =>
  `{"n":${n},"dev":${JSON.stringify(deviceId())},"base":${base()},"save":${json}}`;
/** Play on this device the server never took: kept aside, one copy, for Dad (it is never uploaded). */
function keepFork(id = player): void {
  try {
    const j = localStorage.getItem(`ws_pl_${id}`);
    if (j) localStorage.setItem(`ws_pl_${id}_fork`, j);
  } catch {
    // storage off
  }
}
uploads.accepted = (n, id) => {
  if (id) setBase(n, id);
};
uploads.movedOn = (_n, id) => {
  if (id) keepFork(id);
};
function writeLocal(json: string): void {
  const k = key(1);
  const old = localStorage.getItem(k);
  localStorage.setItem(k + '_tmp', json);
  if (old) localStorage.setItem(k + '_prev', old);
  localStorage.setItem(k, json);
  localStorage.removeItem(k + '_tmp');
}
let last = 0;
let lastJson = '';
/** the day of the game last sent to the server's copy: a new morning is sent at once */
let homeDay = -1;

export function currentSlot(): number {
  return slot;
}
export function useSlot(n: number): void {
  slot = n;
  try {
    localStorage.setItem('ws_slot', String(n));
  } catch {
    // storage may be off: the game still plays
  }
}
export function lastSlot(): number {
  try {
    return Number(localStorage.getItem('ws_slot') ?? '0') || 0;
  } catch {
    return 0;
  }
}

/** Write the save now. Safe to call often: it does nothing if nothing changed or it has just been written. */
// One game at a time in one browser (re-check 62r): two tabs share the saved game, so the tab that saves first after
// a game starts takes over, and an older tab stops saving and goes back to its title when it is next looked at (the
// title reads the newest game again). A tab at its title never saves, so two tabs cannot send each other round.
let passedOn = false;
let claimed = false;
let tabs: BroadcastChannel | null = null;
try {
  if (typeof document === 'undefined') throw new Error('no page');
  tabs = new BroadcastChannel('ws_tab');
  tabs.onmessage = (e) => {
    if (e.data !== 'mine') return;
    passedOn = true;
    homeDrop();
    if (document.visibilityState === 'visible') location.reload();
  };
  document.addEventListener('visibilitychange', () => {
    if (passedOn && document.visibilityState === 'visible') location.reload();
  });
} catch {
  // no page (a tool or a test) or no BroadcastChannel (an old browser): as before
}

export function saveNow(g: Game, force = false, leaving = false): boolean {
  const now = performance.now();
  // Never in the middle of a story scene: its step is already done but the scene's own effects are not, so a save
  // here would lose them for good (the lit tree, the last letter). The save before the scene stays in place.
  if (g.rt.cut) return false;
  // the page going is the last chance: it is not held back by a save a moment ago
  if (!force && !leaving && now - last < 1500) return false;
  // play, a card and building only: everything placed or picked up is already in the bag or on the ground
  if (g.rt.mode !== 'play' && g.rt.mode !== 'card' && g.rt.mode !== 'build' && !force) return false;
  if (passedOn) return false;
  if (!claimed) {
    claimed = true;
    tabs?.postMessage('mine');
  }
  try {
    const json = serialize(g);
    if (json === lastJson) {
      // nothing new for the browser; a disk copy the launcher refused earlier is tried again on Save now
      if (force && !player) homeFlush();
      return true;
    }
    if (player) {
      writeLocal(json);
      const n = counter() + 1;
      setCounter(n);
      upload(n, wrap(n, json));
    } else {
      try {
        const k = key(slot);
        const old = localStorage.getItem(k);
        localStorage.setItem(k + '_tmp', json);
        if (old) localStorage.setItem(k + '_prev', old);
        localStorage.setItem(k, json);
        localStorage.removeItem(k + '_tmp');
      } finally {
        // Still send the disk copy if browser storage is full or unavailable.
        // A failed local write remains a failed save for the caller.
        homeSend(slot, json, force || leaving || g.s.day !== homeDay);
        homeDay = g.s.day;
      }
    }
    last = now;
    lastJson = json;
    return true;
  } catch {
    return false;
  }
}

/**
 * The page is hidden or closing (issue 52): the game being played is saved if it changed, in the same places an
 * autosave would save it (never in a story scene, a talk or a mini-game), without waiting for the next autosave.
 */
export function saveOnLeave(g: Game): boolean {
  return saveNow(g, false, true);
}

/**
 * The save before going back to the title: 'saved', 'story' (never in the middle of a story scene: she finishes it
 * first) or 'failed' (the browser would not keep it). Only 'saved' may leave the game.
 */
export function saveToLeave(g: Game): 'saved' | 'story' | 'failed' {
  if (g.rt.cut) return 'story';
  return saveNow(g, true) ? 'saved' : 'failed';
}

/**
 * Can the game open this copy? A full load takes a few milliseconds, and the title and the slots panel ask on every
 * redraw, so each answer is kept for the exact text it was given.
 */
const opens = new Map<string, boolean>();
function loadable(c: Content, json: string): boolean {
  let ok = opens.get(json);
  if (ok === undefined) {
    try {
      load(c, json);
      ok = true;
    } catch {
      ok = false;
    }
    if (opens.size >= 12) opens.clear();
    opens.set(json, ok);
  }
  return ok;
}
/** The slot's copies in the order they are tried: the game, then the temporary copy, then the previous one. */
const copyKeys = (n: number) => [key(n), key(n) + '_tmp', key(n) + '_prev'];
/** Choose the first copy the game can actually load, in the same order for every slot action. */
function slotCopy(c: Content, n: number): string | null {
  if (player && n !== 1) return null;
  for (const k of copyKeys(n)) {
    try {
      const json = localStorage.getItem(k);
      if (json && loadable(c, json)) return json;
    } catch {
      // A copy that cannot be read: try the next one.
    }
  }
  return null;
}

export function readSlot(n: number): string | null {
  return slotCopy(content, n);
}
export function slotInfo(c: Content, n: number) {
  const json = slotCopy(c, n);
  return json ? summary(c, json) : null;
}
export function loadSlot(c: Content, n: number, names: Record<string, string>, xmas: boolean): Game | null {
  if (player && n !== 1) return null;
  for (const k of copyKeys(n)) {
    try {
      const json = localStorage.getItem(k);
      if (!json) continue;
      const g = load(c, json, names, xmas);
      slot = n;
      lastJson = '';
      return g;
    } catch {
      // a broken copy: try the next one, in the same order as slotCopy
    }
  }
  return null;
}
export function deleteSlot(n: number): void {
  if (player) return; // players mode: nothing is deleted
  try {
    for (const k of [key(n), key(n) + '_prev', key(n) + '_tmp']) localStorage.removeItem(k);
  } catch {
    // nothing to do
  }
  homeDelete(n); // the server's copy is moved aside too, so the game does not come back
}

/** A slot's three copies as the browser holds them: the game, the temporary copy and the previous one. */
function rawCopies(store: Pick<Storage, 'getItem'>, n: number): (string | null)[] {
  const k = slotKey(n);
  return [store.getItem(k), store.getItem(`${k}_tmp`), store.getItem(`${k}_prev`)];
}
/**
 * The take-back rule (package 80): every slot the game cannot open from the browser is asked of the server: one with
 * nothing at all in it (no game, no `_prev`, no `_tmp`), and one whose every copy is broken or from a newer build. A
 * copy `load` accepts is written in; what the slot held is kept aside first as `_bad` (the newest of its copies), for
 * Dad to put back by hand. A slot with a copy the game can open is never touched. Returns the slots brought back.
 */
export async function takeBackInto(
  c: Content,
  store: Pick<Storage, 'getItem' | 'setItem'>,
  ask: (n: number) => Promise<string | null | undefined>,
): Promise<number[]> {
  const asked = [1, 2, 3].filter((n) => !rawCopies(store, n).some((j) => j !== null && loadable(c, j)));
  const before = asked.map((n) => rawCopies(store, n));
  const got = await Promise.all(asked.map((n) => ask(n).catch(() => null)));
  const back: number[] = [];
  asked.forEach((n, i) => {
    const json = got[i];
    if (!json) return;
    try {
      load(c, json);
      // another tab may have saved into the slot while the server was asked: its game stays
      const now = rawCopies(store, n);
      if (now.some((j, at) => j !== before[i]![at])) return;
      const old = now.find((j) => j !== null);
      if (old != null) store.setItem(`${slotKey(n)}_bad`, old);
      store.setItem(slotKey(n), json);
      back.push(n);
    } catch {
      // a copy the game cannot read, or storage off: left where it is
    }
  });
  return back;
}
/** On the title, home copy only, before the slots are read: how many games came back from the server's copy. */
export async function takeBackHome(c: Content): Promise<number> {
  if (player) return 0;
  try {
    const back = await takeBackInto(c, localStorage, homeFetch);
    // not waited for: the title does not hang on it
    void seedHomeFrom(localStorage, homeFetch, (n, json) => homeSend(n, json, true), back).catch(() => undefined);
    return back.length;
  } catch {
    return 0;
  }
}
/**
 * The other way round: a game that is in the browser but that the server has no copy of yet (it was saved before the
 * server kept copies, or put back from a file) is sent, so it is safe before it is next played. A slot the server
 * already has a copy of is left to the next save. Returns the slots sent.
 */
export async function seedHomeFrom(
  store: Pick<Storage, 'getItem'>,
  ask: (n: number) => Promise<string | null | undefined>,
  send: (n: number, json: string) => void,
  skip: number[] = [],
): Promise<number[]> {
  const sent: number[] = [];
  for (const n of [1, 2, 3]) {
    if (skip.includes(n)) continue;
    const json = store.getItem(slotKey(n));
    if (!json) continue;
    // only a clear "none" sends: a failed ask may hide a copy the server holds
    if ((await ask(n).catch(() => undefined)) !== null) continue;
    // the game changed while the server was asked: the next save sends the new one
    if (store.getItem(slotKey(n)) !== json) continue;
    send(n, json);
    sent.push(n);
  }
  return sent;
}

/** Hand Dad a file to keep. */
export function exportSave(g: Game): void {
  const blob = new Blob([serialize(g)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `amelia-wishing-star-slot${slot}-day${g.s.day}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** Ask for a save file and load it into the current slot. Resolves to the new game, or null if it was not a save. */
export function importSave(
  c: Content,
  names: Record<string, string>,
  xmas: boolean,
  /** false once the menu stopped waiting (she pressed X): a file chosen after that is not loaded */
  alive: () => boolean = () => true,
): Promise<Game | null> {
  if (player) return Promise.resolve(null); // players mode: no import
  return new Promise((done) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json,application/json';
    inp.onchange = () => {
      const f = inp.files?.[0];
      if (!f || !alive()) return done(null);
      void f.text().then((txt) => {
        if (!alive()) return done(null);
        try {
          const g = load(c, txt, names, xmas);
          lastJson = '';
          saveNow(g, true);
          done(g);
        } catch {
          done(null);
        }
      });
    };
    inp.oncancel = () => done(null);
    inp.click();
  });
}

/**
 * Players mode, at login and on the title. The server's save wins, unless this device's copy was made from it (its base
 * is the server's counter) and played on further here: then it goes up. Play the server never took is kept aside as the
 * fork. 'login' means the password again; 'offline' plays on the local copy, if there is one.
 */
export async function syncPlayer(): Promise<'ok' | 'login' | 'offline'> {
  if (!player) return 'ok';
  const remote = await fetchSave();
  if (remote === 'login' || remote === 'offline') return remote;
  let rn = -1;
  let rjson: string | null = null;
  let mine = false;
  try {
    const o = remote ? (JSON.parse(remote) as { n?: unknown; dev?: unknown; save?: unknown }) : null;
    if (o && typeof o.n === 'number' && o.save && typeof o.save === 'object') {
      rn = o.n;
      rjson = JSON.stringify(o.save);
      // written by this device: an answer lost on the way may have left the base behind (the server's own rule too)
      mine = o.dev === deviceId();
    }
  } catch {
    // a broken server copy: the local one wins and replaces it
  }
  try {
    const local = localStorage.getItem(key(1));
    const ln = counter();
    const lb = base();
    resumeUploads();
    if (local && (!rjson || ((lb === rn || mine) && ln > rn))) {
      const n = Math.max(ln, 1);
      setCounter(n);
      upload(n, wrap(n, local));
    } else if (rjson) {
      if (local && ln > lb && local !== rjson) keepFork();
      writeLocal(rjson);
      setCounter(rn);
      setBase(rn);
    }
  } catch {
    return 'offline';
  }
  lastJson = '';
  return 'ok';
}

/** The "Your game moved on" card was answered: the title, after a fresh page, goes straight on with the server's game. */
export function carryOnNext(): void {
  try {
    sessionStorage.setItem('ws_carry_on', '1');
  } catch {
    // storage off: she presses Play herself
  }
}
export function takeCarryOn(): boolean {
  try {
    const on = sessionStorage.getItem('ws_carry_on') === '1';
    sessionStorage.removeItem('ws_carry_on');
    return on;
  } catch {
    return false;
  }
}

/** Players mode: does this player have a save (on this computer, after a sync)? */
export function hasPlayerSave(c: Content): boolean {
  return !!player && !!slotInfo(c, 1);
}

/**
 * The first login of the hero's entry on a computer that holds a home-copy slot save, while the server has none for
 * her: the slot to offer ("Carry on your game?"), or 0. Asked once per computer.
 */
export function homeSaveToOffer(c: Content): number {
  if (player !== 'hero' || hasPlayerSave(c)) return 0;
  try {
    if (localStorage.getItem('ws_pl_hero_offered')) return 0;
    const last = lastSlot();
    const have = [1, 2, 3].filter((n) => {
      const j = localStorage.getItem(slotKey(n));
      return !!j && !!summary(c, j);
    });
    return have.includes(last) ? last : (have[0] ?? 0);
  } catch {
    return 0;
  }
}
/** Yes: the slot's save becomes her save here and on the server (the slot itself is left as it is). No: not again. */
export function carryOver(n: number, yes: boolean): void {
  try {
    localStorage.setItem('ws_pl_hero_offered', '1');
    const j = localStorage.getItem(slotKey(n));
    if (!yes || !j || !player) return;
    writeLocal(j);
    const c = counter() + 1;
    setCounter(c);
    upload(c, wrap(c, j));
    lastJson = '';
  } catch {
    // storage off: nothing to carry over
  }
}

/** Christmas layer: on from 1 December to 6 January when set to Auto. */
export function isChristmas(setting: 'auto' | 'on' | 'off', now = new Date()): boolean {
  if (setting === 'on') return true;
  if (setting === 'off') return false;
  const m = now.getMonth();
  const d = now.getDate();
  return m === 11 || (m === 0 && d <= 6);
}
