// Players mode (D67): when the page is served by play-server --players, there is a player list, a password each and
// one save per player on the server. With no answer from api/players this is the home copy and nothing here runs.

export interface PlayerEntry {
  id: string;
  label: string;
}

export const net = {
  /** the server answered api/players: players mode */
  on: false,
  players: [] as PlayerEntry[],
  /** the player chosen on this computer (kept in the browser), '' for none */
  id: '',
  /** their login, '' when they must type the password (again) */
  token: '',
};

/** The credit line (D68): every player but the hero's own entry, in players mode only. */
export function showCredit(): boolean {
  return net.on && net.id !== '' && net.id !== 'hero';
}
/** The red-haired hero is hers alone (D71): Player 1 to 10 cannot choose her at the start or in the mirror. */
export function heroAllowed(hero: string): boolean {
  return hero !== 'amelia' || !net.on || net.id === 'hero';
}
export function labelOf(id: string): string {
  return net.players.find((p) => p.id === id)?.label ?? '';
}

const api = (p: string) => `${import.meta.env.BASE_URL}api/${p}`;
const auth = (): Record<string, string> => ({ Authorization: `Bearer ${net.token}` });

function remember(): void {
  try {
    if (net.id) localStorage.setItem('ws_player', net.id);
    else localStorage.removeItem('ws_player');
    if (net.token) localStorage.setItem('ws_token', net.token);
    else localStorage.removeItem('ws_token');
  } catch {
    // storage off: she logs in again next time
  }
}

/** Ask once at the start whether this is players mode, and who played here last. */
export async function probe(): Promise<void> {
  try {
    const r = await fetch(api('players'), { cache: 'no-store', signal: AbortSignal.timeout(5000) });
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return;
    const list = ((await r.json()) as { players?: PlayerEntry[] }).players;
    if (!Array.isArray(list) || !list.length) return;
    net.players = list.filter((p) => typeof p.id === 'string' && typeof p.label === 'string');
    net.on = true;
  } catch {
    return;
  }
  try {
    const id = localStorage.getItem('ws_player') ?? '';
    if (net.players.some((p) => p.id === id)) {
      net.id = id;
      net.token = localStorage.getItem('ws_token') ?? '';
    }
  } catch {
    // nobody remembered
  }
}

export type LoginResult = 'ok' | 'wrong' | 'locked' | 'day' | 'offline';

/** This browser's device key for a player (from an earlier login): it lets her past the daily cap, never alone. */
const deviceKey = (id: string) => `ws_dk_${id}`;

export async function login(id: string, password: string): Promise<LoginResult> {
  let device = '';
  try {
    device = localStorage.getItem(deviceKey(id)) ?? '';
  } catch {
    // storage off: no device key
  }
  try {
    const r = await fetch(api('login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(device ? { id, password, device } : { id, password }),
      signal: AbortSignal.timeout(20000),
    });
    if (r.status === 429) {
      const j = (await r.json().catch(() => ({}))) as { day?: boolean };
      return j.day ? 'day' : 'locked';
    }
    if (!r.ok) return r.status === 401 || r.status === 400 ? 'wrong' : 'offline';
    const j = (await r.json()) as { token?: string; device?: string };
    if (typeof j.token !== 'string') return 'offline';
    net.id = id;
    net.token = j.token;
    remember();
    try {
      if (typeof j.device === 'string') localStorage.setItem(deviceKey(id), j.device);
    } catch {
      // storage off
    }
    return 'ok';
  } catch {
    return 'offline';
  }
}

/** This browser's id, sent with every save so the server knows a device's own newer save (made once, kept). */
let devId = '';
export function deviceId(): string {
  if (devId) return devId;
  try {
    devId = localStorage.getItem('ws_device') ?? '';
  } catch {
    // storage off: a new id for this page
  }
  if (!/^[a-z0-9]{16,64}$/.test(devId)) {
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    devId = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    try {
      localStorage.setItem('ws_device', devId);
    } catch {
      // storage off
    }
  }
  return devId;
}

/** Change player: the server forgets the login, and so does this computer. */
export function logout(): void {
  if (net.token) void fetch(api('logout'), { method: 'POST', headers: auth(), keepalive: true }).catch(() => undefined);
  net.id = '';
  net.token = '';
  pending = null;
  paused = false;
  remember();
}

/** The login no longer works (401): keep playing on the local copy; the title asks for the password again. */
function lost(): void {
  net.token = '';
  remember();
}

/** The server's save for the player: its text, null when there is none, or 'login' / 'offline'. */
export async function fetchSave(): Promise<string | null | 'login' | 'offline'> {
  if (!net.token) return 'login';
  try {
    const r = await fetch(api('save'), { headers: auth(), cache: 'no-store', signal: AbortSignal.timeout(10000) });
    if (r.status === 204) return null;
    if (r.status === 401) {
      lost();
      return 'login';
    }
    return r.ok ? await r.text() : 'offline';
  } catch {
    return 'offline';
  }
}

/** Dad's personal words, for the hero's own entry only: the text, or null. */
export async function fetchPersonal(url: string): Promise<Response | null> {
  if (!net.token || net.id !== 'hero') return null;
  try {
    return await fetch(url, { cache: 'no-store', headers: auth() });
  } catch {
    return null;
  }
}

// ---- the uploader: one request in flight at a time, always; the newest save wins, not more often than every 5 s
interface Pending {
  n: number;
  body: string;
  id: string;
}
let pending: Pending | null = null;
let busy = false;
let lastStart = -1e9;
let timer: ReturnType<typeof setTimeout> | null = null;
/** the page is going: send the newest save the moment nothing is in flight */
let flushWanted = false;
/** the server holds a newer game from another device (409): no uploads until the next good sync */
let paused = false;

/** What the uploader tells the save code: a save the server took, and a game that moved on elsewhere. */
export const uploads = {
  accepted: (_n: number, _id: string): void => undefined,
  movedOn: (_serverN: number, _id: string): void => undefined,
};

/** A good sync with the server: uploads may go again. */
export function resumeUploads(): void {
  paused = false;
}
/** The server's game moved on without this device: the card is waiting to be shown. */
export function movedOn(): boolean {
  return paused;
}

/** Hand the newest save to the uploader. A failed upload shows nothing and is tried again at the next save. */
export function upload(n: number, body: string): void {
  if (!net.on || !net.token || paused) return;
  pending = { n, body, id: net.id };
  pump();
}

function pump(): void {
  if (busy || !pending || !net.token || paused) return;
  if (!flushWanted) {
    if (timer) return;
    const wait = lastStart + 5000 - performance.now();
    if (wait > 0) {
      timer = setTimeout(() => {
        timer = null;
        pump();
      }, wait);
      return;
    }
  }
  if (timer) clearTimeout(timer);
  timer = null;
  flushWanted = false;
  const p = pending;
  pending = null;
  busy = true;
  lastStart = performance.now();
  let again = false;
  fetch(api('save'), {
    method: 'PUT',
    headers: { ...auth(), 'Content-Type': 'application/json' },
    body: p.body,
    // a save that is on its way when the page goes still arrives (the browser's limit for these is 64 KB)
    keepalive: p.body.length < 60000,
    signal: AbortSignal.timeout(20000),
  })
    .then(async (r) => {
      if (r.status === 401) lost();
      else if (r.status === 409) {
        const j = (await r.json().catch(() => ({}))) as { n?: unknown };
        paused = true;
        pending = null;
        uploads.movedOn(typeof j.n === 'number' ? j.n : 0, p.id);
      } else if (!r.ok) pending ??= p;
      else {
        uploads.accepted(p.n, p.id);
        again = true;
      }
    })
    .catch(() => {
      pending ??= p;
    })
    .finally(() => {
      busy = false;
      // after a success, or when the page is going; a failure waits for the next save
      if (again || flushWanted) pump();
    });
}

/** The page is closing or hidden: the newest save goes now, or the moment the request in flight ends. */
function flush(): void {
  if (!pending || !net.token || paused) return;
  flushWanted = true;
  pump();
}

// ---- the home copy's second copy on disk (package 80, D87)
// The browser can lose its storage (Chrome made G's again on 21 Nov 2026), so the home copy's server keeps a copy of each
// saved game too (api/home/save/N). Nothing here waits on the frame path, and every failure is silent. A server with no
// such route (vite dev and preview, an old server) is given up on after its first "no such route" answer.
const home = { gone: false };

/** A bot's browser (Playwright sets navigator.webdriver; `launch()` also puts TEST in the title): never G's copies. */
export function testRun(): boolean {
  try {
    return navigator.webdriver === true || document.title.startsWith('TEST');
  } catch {
    return false;
  }
}
/** Home copy, a real player's browser, and a server that has the route (so far). */
export function homeCopyOn(): boolean {
  return typeof fetch === 'function' && !net.on && !home.gone && !testRun();
}
const homeUrl = (n: number) => api(`home/save/${n}`);
const isJson = (r: Response) => (r.headers.get('content-type') ?? '').includes('json');
/** The route is missing, not just a missing copy: the server's own "none" answer is JSON, a missing route's is not. */
function noRoute(r: Response): boolean {
  return r.status === 405 || ((r.status === 404 || r.status === 200) && !isJson(r));
}

const HOME_GAP = 20000;
const homePending = new Map<number, string>();
const homeDeletes = new Set<number>();
let homeBusy = false;
let homeLast = -1e9;
let homeTimer: ReturnType<typeof setTimeout> | null = null;
let homeFlushWanted = false;

/**
 * Hand the server the newest save of a slot: at once when `now` (Save now, a new day, the page going), otherwise at most
 * once every 20 seconds (the newest one waits its turn). Returns straight away.
 */
export function homeSend(n: number, json: string, now = false): void {
  if (!homeCopyOn()) return;
  homePending.set(n, json);
  if (now) homeFlushWanted = true;
  homePump();
}
function homePump(): void {
  if (homeBusy || (!homePending.size && !homeDeletes.size) || !homeCopyOn()) return;
  const deleting = homeDeletes.values().next().value as number | undefined;
  if (deleting !== undefined) {
    homeDeletes.delete(deleting);
    homeBusy = true;
    fetch(homeUrl(deleting), { method: 'DELETE', keepalive: true, signal: AbortSignal.timeout(10000) })
      .then((r) => {
        if (noRoute(r)) home.gone = true;
      })
      .catch(() => undefined)
      .finally(() => {
        homeBusy = false;
        homePump();
      });
    return;
  }
  if (!homeFlushWanted) {
    const wait = homeLast + HOME_GAP - performance.now();
    if (wait > 0) {
      homeTimer ??= setTimeout(() => {
        homeTimer = null;
        homePump();
      }, wait);
      return;
    }
  }
  if (homeTimer) clearTimeout(homeTimer);
  homeTimer = null;
  homeFlushWanted = false;
  const [n, body] = homePending.entries().next().value as [number, string];
  homePending.delete(n);
  homeBusy = true;
  homeLast = performance.now();
  fetch(homeUrl(n), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body,
    // a save on its way when the page goes still arrives (the browser's limit for these is 64 KB)
    keepalive: body.length < 60000,
    signal: AbortSignal.timeout(10000),
  })
    .then((r) => {
      if (noRoute(r)) home.gone = true;
      // the server is there but could not keep it this time (a full disk, a busy moment): tried again
      else if (r.status >= 500 || r.status === 408 || r.status === 429) keepForRetry(n, body);
    })
    .catch(() => keepForRetry(n, body))
    .finally(() => {
      homeBusy = false;
      // a save kept for another try waits its 20 seconds, unless Save now or the page going asks for it sooner
      if (homePending.size || homeDeletes.size) homePump();
    });
}
/** A save the server did not take goes back in line, unless a newer one for its slot or its deletion is waiting. */
function keepForRetry(n: number, body: string): void {
  if (!homePending.has(n) && !homeDeletes.has(n)) homePending.set(n, body);
}
/** The page is closing or hidden, or Save now found nothing new: whatever waits is sent now. */
export function homeFlush(): void {
  if (!homePending.size && !homeDeletes.size) return;
  homeFlushWanted = true;
  homePump();
}

// ---- the page is going (hidden, or closed): the game is saved first, then every save that waits is sent at once
/** Set by main.ts: save the game being played, if it changed, before what waits is sent (issue 52). */
export const onLeave = { save: (): void => undefined };
function leave(): void {
  try {
    onLeave.save();
  } catch {
    // the save is a best try here: what waits is still sent
  }
  flush();
  homeFlush();
}
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', leave);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') leave();
  });
}

/**
 * Another tab of this browser took the game over (save.ts): the saves still waiting here are older than its game, so
 * they are dropped and never land on top of its newer ones. A deletion she asked for here still goes.
 */
export function homeDrop(): void {
  homePending.clear();
  if (homeTimer) clearTimeout(homeTimer);
  homeTimer = null;
}

/** The copy's text, null for an empty slot, or undefined when the server cannot be checked. */
export async function homeFetch(n: number): Promise<string | null | undefined> {
  if (!homeCopyOn()) return undefined;
  try {
    const r = await fetch(homeUrl(n), { cache: 'no-store', signal: AbortSignal.timeout(2500) });
    if (noRoute(r)) home.gone = true;
    if (r.status === 404 && isJson(r)) {
      const body: unknown = await r.json();
      if (
        body &&
        typeof body === 'object' &&
        !Array.isArray(body) &&
        Object.keys(body).length === 1 &&
        'error' in body &&
        body.error === 'none'
      )
        return null;
      return undefined;
    }
    return r.ok && isJson(r) ? await r.text() : undefined;
  } catch {
    return undefined;
  }
}
/** A game deleted in "Saved games": the server moves its copy aside, so the game does not come back. */
export function homeDelete(n: number): void {
  if (!homeCopyOn()) return;
  homePending.delete(n);
  homeDeletes.add(n);
  homePump();
}
