// Play Amelia: tiny file server. No dependencies. Runs under plain Node or as a Node single-executable application.
// With no flag: serves ./game next to this program on 127.0.0.1:4173 only, no login (the home copy; WS_PORT may move it).
// With --players (or WS_PLAYERS=1): also a player list, passwords and one save per player (D67), for a reverse proxy
// in front. Settings: WS_PORT (4174), WS_HOST (127.0.0.1), WS_DATA (data/ beside the program), WS_TRUST_PROXY=1 (needed
// behind a proxy: without it every child has the proxy's address and shares one lock).
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PLAYERS = process.argv.includes('--players') || process.env.WS_PLAYERS === '1';
const HOST = PLAYERS ? process.env.WS_HOST || '127.0.0.1' : '127.0.0.1';
const PORT = Number(process.env.WS_PORT || (PLAYERS ? 4174 : 4173));
const isSea = (() => {
  try {
    return require('node:sea').isSea();
  } catch {
    return false;
  }
})();
const here = isSea ? path.dirname(process.execPath) : __dirname;
const root = fs.realpathSync.native(path.join(here, 'game'));

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
};

function send(res, code, body, type) {
  res.writeHead(code, {
    'Content-Type': type || 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}
const sendJson = (res, code, obj) => send(res, code, JSON.stringify(obj), 'application/json; charset=utf-8');

function serveStatic(req, res, rel) {
  if (rel.includes('\0') || rel.split(/[\\/]/).includes('..')) return send(res, 403, 'Forbidden');
  let file = path.join(root, rel);
  try {
    if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    file = fs.realpathSync.native(file);
  } catch {
    return send(res, 404, 'Not found');
  }
  if (file !== root && !file.startsWith(root + path.sep)) return send(res, 403, 'Forbidden');
  // players mode: the personal words (names, Dad's letters) go only to the hero's own entry. Checked on the file
  // found, so another spelling of the path (a double slash, other capitals) cannot get round it.
  if (
    PLAYERS &&
    path.dirname(file) === root &&
    path.basename(file).toLowerCase() === 'personal.json' &&
    who(req) !== 'hero'
  )
    return send(res, 401, 'Log in first');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Not found');
    send(
      res,
      200,
      req.method === 'HEAD' ? '' : data,
      TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
    );
  });
}

// ---------------------------------------------------------------- players mode
const IDS = ['hero', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10'];
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no 0 o 1 l i: easy for a child to read and type
const TOKEN_LIFE = 180 * 24 * 3600 * 1000;
const MAX_SAVE = 512 * 1024;
const MAX_SMALL = 4096;
const BODY_TIMEOUT = 10000;
let dataDir = '';
let players = {}; // id -> { salt, hash } (scrypt of the password)
let sessions = {}; // sha256(token) hex -> { id, exp }

function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, { mode: 0o600 });
  fs.renameSync(tmp, file);
}
const scrypt = (pw, salt) =>
  new Promise((ok, fail) => crypto.scrypt(pw, salt, 32, (err, key) => (err ? fail(err) : ok(key))));
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const label = (id) => (id === 'hero' ? heroName() : `Player ${id.slice(1)}`);

function heroName() {
  try {
    const p = JSON.parse(fs.readFileSync(path.join(root, 'personal.json'), 'utf8'));
    const n = p?.names?.amelia;
    if (typeof n === 'string' && n.trim()) return n.trim().slice(0, 40);
  } catch {
    // no file or a broken one: a plain word
  }
  return 'First player';
}

/** First start: the data folder, the players and the password list. Once made they are never changed. */
async function setupData() {
  dataDir = path.resolve(process.env.WS_DATA || path.join(here, 'data'));
  if (dataDir === root || dataDir.startsWith(root + path.sep)) throw new Error('WS_DATA must not be inside game/');
  fs.mkdirSync(path.join(dataDir, 'saves'), { recursive: true, mode: 0o700 });
  fs.chmodSync(dataDir, 0o700);
  const file = path.join(dataDir, 'players.json');
  if (!fs.existsSync(file)) {
    let seed;
    try {
      seed = JSON.parse(fs.readFileSync(path.join(here, 'players-seed.json'), 'utf8'));
    } catch {
      throw new Error('players-seed.json is missing beside the program');
    }
    if (typeof seed.heroPassword !== 'string' || !seed.heroPassword)
      throw new Error('players-seed.json has no heroPassword');
    const plain = { hero: seed.heroPassword };
    for (const id of IDS.slice(1)) {
      let pw = '';
      for (let i = 0; i < 4; i++) pw += ALPHABET[crypto.randomInt(ALPHABET.length)];
      plain[id] = pw;
    }
    const out = {};
    for (const id of IDS) {
      const salt = crypto.randomBytes(16).toString('hex');
      out[id] = { salt, hash: (await scrypt(plain[id], salt)).toString('hex') };
    }
    const list = IDS.map((id) => `${id === 'hero' ? 'Top of the list' : label(id)}: ${plain[id]}`);
    writeAtomic(path.join(dataDir, 'PASSWORDS.txt'), `${list.join('\n')}\n`);
    writeAtomic(file, `${JSON.stringify(out, null, 2)}\n`);
    console.log(`New players made. The passwords are in ${path.join(dataDir, 'PASSWORDS.txt')}`);
  }
  players = JSON.parse(fs.readFileSync(file, 'utf8'));
  try {
    sessions = JSON.parse(fs.readFileSync(path.join(dataDir, 'sessions.json'), 'utf8'));
  } catch {
    sessions = {};
  }
  daily = readJson('tries.json', { day: '', counts: {} });
  if (!daily || typeof daily.day !== 'string' || !daily.counts || typeof daily.counts !== 'object')
    daily = { day: '', counts: {} };
  devices = readJson('devices.json', {}) || {};
}

function saveSessions() {
  const now = Date.now();
  for (const k of Object.keys(sessions)) if (!(sessions[k].exp > now)) delete sessions[k];
  writeAtomic(path.join(dataDir, 'sessions.json'), JSON.stringify(sessions));
}

/** The player a request's bearer token belongs to, or null. */
function who(req) {
  const m = /^Bearer ([A-Za-z0-9_-]{20,100})$/.exec(req.headers.authorization || '');
  if (!m) return null;
  const s = sessions[sha256(m[1])];
  return s && s.exp > Date.now() && IDS.includes(s.id) ? s.id : null;
}

// ---- guessing: four limits work together (package 62f)
// 1. One player's logins are judged one at a time, at most 3 waiting; after a wrong try the next waits 2 s.
// 2. One client address: 5 wrong tries lock it for 60 s, doubling up to 15 minutes. Tries while locked are not counted.
// 3. One player and day (UTC): after 10 wrong tries from anywhere, no new login until tomorrow (data/tries.json).
// 4. Known devices: a login with a device key from an earlier login of that player is not held by the daily cap.
const GAP = 2000;
const QUEUE = 4; // the one being judged and 3 waiting
const DAY_CAP = 10;
const MAX_DEVICES = 8;
const addrs = new Map(); // client address -> { fails, locks, until }
const queues = new Map(); // player id -> { size, chain, nextAt }
let daily = { day: '', counts: {} }; // the day (UTC, yyyy-mm-dd) and wrong tries per player that day
let devices = {}; // player id -> [{ h: sha256(key) hex, t: time made }]
let proxyWarned = false;

const today = () => new Date().toISOString().slice(0, 10);
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
function readJson(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf8'));
  } catch {
    return fallback;
  }
}

function client(req) {
  const xff = String(req.headers['x-forwarded-for'] || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (process.env.WS_TRUST_PROXY === '1') {
    // the proxy adds the address it saw at the end; anything before it came from the client and may be made up
    if (xff.length) return xff[xff.length - 1];
  } else if (xff.length && !proxyWarned) {
    proxyWarned = true;
    console.log('These requests come through a proxy. Start with WS_TRUST_PROXY=1 or every child shares one lock.');
  }
  return req.socket.remoteAddress || '?';
}

function addrLockedFor(addr) {
  const t = addrs.get(addr);
  return t && t.until > Date.now() ? Math.ceil((t.until - Date.now()) / 1000) : 0;
}
function addrFail(addr) {
  const now = Date.now();
  const t = addrs.get(addr) || { fails: 0, locks: 0, until: 0 };
  if (t.until > now) return; // locked already: not counted, so the lock does not grow
  if (t.locks && now - t.until > 3600000) t.locks = 0; // an hour since the last lock: start small again
  t.fails++;
  if (t.fails >= 5) {
    t.until = now + Math.min(60000 * 2 ** t.locks, 15 * 60000);
    t.locks++;
    t.fails = 0;
  }
  addrs.set(addr, t);
  if (addrs.size > 50000) for (const [k, v] of addrs) if (v.until < now && !v.fails) addrs.delete(k);
}

function dayCount(id) {
  if (daily.day !== today()) daily = { day: today(), counts: {} };
  return daily.counts[id] || 0;
}
function dayFail(id) {
  daily.counts[id] = dayCount(id) + 1;
  writeAtomic(path.join(dataDir, 'tries.json'), JSON.stringify(daily));
}
function secondsToTomorrow() {
  const d = new Date();
  return Math.ceil((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - d.getTime()) / 1000);
}

function knownDevice(id, key) {
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{20,100}$/.test(key)) return false;
  const h = sha256(key);
  return (devices[id] || []).some((d) => d.h === h);
}
/** A new device key for the player, kept as its hash (the newest 8). */
function newDevice(id) {
  const key = crypto.randomBytes(32).toString('base64url');
  const list = (devices[id] || []).concat({ h: sha256(key), t: Date.now() });
  devices[id] = list.slice(-MAX_DEVICES);
  writeAtomic(path.join(dataDir, 'devices.json'), JSON.stringify(devices));
  return key;
}

/** Run `judge` in the player's queue: null when the queue is full (the try is not judged). */
async function inTurn(id, judge) {
  let q = queues.get(id);
  if (!q) {
    q = { size: 0, chain: Promise.resolve(), nextAt: 0 };
    queues.set(id, q);
  }
  if (q.size >= QUEUE) return null;
  q.size++;
  const run = q.chain.then(async () => {
    const wait = q.nextAt - Date.now();
    if (wait > 0) await sleep(wait);
    return judge(q);
  });
  q.chain = run.then(
    () => undefined,
    () => undefined,
  );
  try {
    return await run;
  } finally {
    q.size--;
  }
}

/** Read a request body up to `limit` bytes within a time limit; resolves to the text, or null (the answer is sent). */
function readBody(req, res, limit) {
  return new Promise((done) => {
    const parts = [];
    let size = 0;
    let over = false;
    const timer = setTimeout(() => finish(408, 'Too slow'), BODY_TIMEOUT);
    function finish(code, msg) {
      if (over) return;
      over = true;
      clearTimeout(timer);
      req.removeAllListeners('data');
      res.setHeader('Connection', 'close');
      send(res, code, msg);
      req.resume();
      done(null);
    }
    if (Number(req.headers['content-length'] || 0) > limit) return finish(413, 'Too large');
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) finish(413, 'Too large');
      else parts.push(c);
    });
    req.on('end', () => {
      if (over) return;
      over = true;
      clearTimeout(timer);
      done(Buffer.concat(parts).toString('utf8'));
    });
    req.on('error', () => finish(400, 'Bad request'));
  });
}
function parseObject(text) {
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

async function login(req, res) {
  const text = await readBody(req, res, MAX_SMALL);
  if (text === null) return;
  const b = parseObject(text);
  if (!b || typeof b.id !== 'string' || typeof b.password !== 'string' || !IDS.includes(b.id) || !players[b.id])
    return sendJson(res, 400, { error: 'bad' });
  const id = b.id;
  const addr = client(req);
  const known = knownDevice(id, b.device);
  // refused before any password check, and not counted
  const held = () => {
    const a = addrLockedFor(addr);
    if (a) return { locked: a };
    if (!known && dayCount(id) >= DAY_CAP) return { locked: secondsToTomorrow(), day: true };
    return null;
  };
  const first = held();
  if (first) return sendJson(res, 429, first);
  const out = await inTurn(id, async (q) => {
    const before = held();
    if (before) return { code: 429, body: before };
    const p = players[id];
    const got = await scrypt(b.password.slice(0, 64), p.salt);
    const right = crypto.timingSafeEqual(got, Buffer.from(p.hash, 'hex'));
    // checked again: a wrong try judged at the same time (another player, same address) may have locked it
    const a = addrLockedFor(addr);
    if (!right) {
      q.nextAt = Date.now() + GAP;
      dayFail(id);
      if (a) return { code: 429, body: { locked: a } };
      addrFail(addr);
      const now = addrLockedFor(addr);
      return now ? { code: 429, body: { locked: now } } : { code: 401, body: { error: 'wrong' } };
    }
    if (a) return { code: 429, body: { locked: a } };
    const token = crypto.randomBytes(32).toString('base64url');
    sessions[sha256(token)] = { id, exp: Date.now() + TOKEN_LIFE };
    saveSessions();
    const device = known ? b.device : newDevice(id);
    return { code: 200, body: { token, id, label: label(id), device } };
  });
  if (!out) return sendJson(res, 429, { locked: Math.ceil(GAP / 1000) });
  sendJson(res, out.code, out.body);
}

/** The newest 7 daily copies of a player's save are kept. */
function dailyCopy(id, text) {
  const dir = path.join(dataDir, 'saves');
  const file = path.join(dir, `${id}.${today()}.json`);
  if (fs.existsSync(file)) return;
  fs.writeFileSync(file, text, { mode: 0o600 });
  const re = new RegExp(`^${id}\\.\\d{4}-\\d{2}-\\d{2}\\.json$`);
  const old = fs
    .readdirSync(dir)
    .filter((f) => re.test(f))
    .sort();
  for (const f of old.slice(0, -7)) fs.rmSync(path.join(dir, f), { force: true });
}

async function putSave(req, res, id) {
  const text = await readBody(req, res, MAX_SAVE);
  if (text === null) return;
  const body = parseObject(text);
  if (!body) return sendJson(res, 400, { error: 'not a save' });
  if (!Number.isSafeInteger(body.n) || body.n < 0) return sendJson(res, 400, { error: 'no counter' });
  const file = path.join(dataDir, 'saves', `${id}.json`);
  // A save replaces the server's only when it was made from it (base), or it is the same device's own newer save.
  // The same device may send the same n again: its first try arrived but the answer was lost on the way (re-check 62r).
  // Anything else is a game that missed play elsewhere: refused, so a stale copy never replaces the real one.
  let old = null;
  try {
    old = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    // no save yet, or a broken one: write over it
  }
  if (old && typeof old === 'object' && typeof old.n === 'number') {
    const fromIt = body.base === old.n;
    const sameDevice = typeof old.dev === 'string' && body.dev === old.dev && body.n >= old.n;
    if (!fromIt && !sameDevice) return sendJson(res, 409, { n: old.n });
  }
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, text, { mode: 0o600 });
  if (fs.existsSync(file)) fs.copyFileSync(file, path.join(dataDir, 'saves', `${id}.prev.json`));
  fs.renameSync(tmp, file);
  dailyCopy(id, text);
  sendJson(res, 200, { ok: true, n: body.n });
}

const ROUTES = { players: ['GET'], login: ['POST'], logout: ['POST'], save: ['GET', 'PUT'] };
async function api(req, res, rel) {
  const route = rel.slice('/api/'.length);
  if (!Object.hasOwn(ROUTES, route)) return sendJson(res, 404, { error: 'not found' });
  if (!ROUTES[route].includes(req.method)) return sendJson(res, 405, { error: 'method' });
  if (route === 'players') return sendJson(res, 200, { players: IDS.map((id) => ({ id, label: label(id) })) });
  if (route === 'login') return login(req, res);
  const id = who(req);
  if (!id) return sendJson(res, 401, { error: 'login' });
  if (route === 'logout') {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization);
    delete sessions[sha256(m[1])];
    saveSessions();
    return sendJson(res, 200, { ok: true });
  }
  const file = path.join(dataDir, 'saves', `${id}.json`);
  if (req.method === 'GET') {
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      return send(res, 204, '');
    }
    return send(res, 200, text, 'application/json; charset=utf-8');
  }
  return putSave(req, res, id);
}

// ---------------------------------------------------------------- the home copy's second copy (package 80, D87)
// The saves live in the browser's storage, and a browser can lose it (Chrome made G's again on 21 Nov 2026). So the
// game also sends each save here, and takes it back into an empty browser. Home copy only; players mode keeps its own.
// data/home/slotN.json is the newest; data/home/history/ keeps older ones. A request never destroys anything.
const MAX_HOME = 1024 * 1024;
const HISTORY_GAP = 10 * 60 * 1000; // at most one history file per slot in this time
const HISTORY_KEEP = 40; // per slot
/** The folder's place; it is made (private) only when something is first kept. */
function homePath() {
  const base = path.resolve(process.env.WS_DATA || path.join(here, 'data'));
  if (base === root || base.startsWith(root + path.sep)) throw new Error('WS_DATA must not be inside game/');
  return path.join(base, 'home');
}
let homeMade = false;
function homeDir() {
  const dir = homePath();
  if (!homeMade) {
    fs.mkdirSync(path.join(dir, 'history'), { recursive: true, mode: 0o700 });
    for (const d of [path.dirname(dir), dir, path.join(dir, 'history')]) fs.chmodSync(d, 0o700);
    homeMade = true;
  }
  return dir;
}
/** yyyymmddThhmmssZ (UTC): sorts the same as time */
const stamp = (t) => new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
function stampTime(s) {
  const m = /^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z$/.exec(s);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : 0;
}
/** The history files of a slot, oldest first: [{ name, t }]. Moved-aside (deleted) ones are not listed here. */
function historyOf(n) {
  const re = new RegExp(`^slot${n}-(\\d{8}T\\d{6}Z)\\.json$`);
  const out = [];
  for (const name of fs.readdirSync(path.join(homeDir(), 'history'))) {
    const m = re.exec(name);
    if (m) out.push({ name, t: stampTime(m[1]) });
  }
  return out.sort((a, b) => (a.name < b.name ? -1 : 1));
}
function homeKeep(n, text) {
  const dir = homeDir();
  writeAtomic(path.join(dir, `slot${n}.json`), text);
  const list = historyOf(n);
  const now = Date.now();
  if (list.length && now - list[list.length - 1].t < HISTORY_GAP) return;
  writeAtomic(path.join(dir, 'history', `slot${n}-${stamp(now)}.json`), text);
  for (const old of historyOf(n).slice(0, -HISTORY_KEEP))
    fs.rmSync(path.join(dir, 'history', old.name), { force: true });
}
/** The copy goes into history; the slot has none afterwards. False when there was none. */
function homeMoveAside(n) {
  if (!fs.existsSync(path.join(homePath(), `slot${n}.json`))) return false;
  const file = path.join(homeDir(), `slot${n}.json`);
  let name = `slot${n}-${stamp(Date.now())}-deleted.json`;
  for (let i = 2; fs.existsSync(path.join(homeDir(), 'history', name)); i++)
    name = `slot${n}-${stamp(Date.now())}-deleted-${i}.json`;
  fs.renameSync(file, path.join(homeDir(), 'history', name));
  return true;
}
/** What a saved game must be: a JSON object with a number `v`. */
function looksLikeSave(text) {
  const o = parseObject(text);
  return !!o && typeof o.v === 'number';
}

async function homeApi(req, res, rel) {
  const m = /^\/api\/home\/save\/([123])$/.exec(rel);
  if (!m) return false;
  const n = Number(m[1]);
  if (req.method === 'GET') {
    let text;
    try {
      text = fs.readFileSync(path.join(homePath(), `slot${n}.json`), 'utf8');
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      sendJson(res, 404, { error: 'none' });
      return true;
    }
    send(res, 200, text, 'application/json; charset=utf-8');
  } else if (req.method === 'PUT') {
    const text = await readBody(req, res, MAX_HOME);
    if (text === null) return true;
    if (!looksLikeSave(text)) sendJson(res, 400, { error: 'not a save' });
    else {
      homeKeep(n, text);
      sendJson(res, 200, { ok: true });
    }
  } else if (req.method === 'DELETE') {
    const moved = homeMoveAside(n);
    sendJson(res, moved ? 200 : 404, moved ? { ok: true } : { error: 'none' });
  } else sendJson(res, 405, { error: 'method' });
  return true;
}

// ---------------------------------------------------------------- the server
const server = http.createServer((req, res) => {
  let rel;
  try {
    rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    return send(res, 400, 'Bad request');
  }
  // the home copy keeps one address, so one browser storage: localhost is sent on to 127.0.0.1 (the browser keeps the
  // two apart, and each looked like it had lost the other's game)
  if (!PLAYERS) {
    const m = /^localhost(?::(\d+))?$/i.exec(req.headers.host || '');
    if (m) {
      res.writeHead(302, { Location: `http://127.0.0.1:${m[1] || PORT}${req.url}`, 'Cache-Control': 'no-store' });
      return res.end();
    }
    if (rel.startsWith('/api/home/')) {
      homeApi(req, res, rel)
        .then((done) => done || send(res, 404, 'Not found'))
        .catch((err) => {
          console.error(err.message);
          if (!res.headersSent) send(res, 500, 'Server error');
        });
      return;
    }
  }
  // the home copy: the game asks once whether this is players mode; an empty list says no (and no 404 in the console)
  if (!PLAYERS && rel === '/api/players') return sendJson(res, 200, { players: [] });
  if (PLAYERS && rel.startsWith('/api/')) {
    api(req, res, rel).catch((err) => {
      console.error(err.message);
      if (!res.headersSent) send(res, 500, 'Server error');
    });
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
  serveStatic(req, res, rel);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log('Close the other Play Amelia window and try again');
    process.exit(1);
  }
  console.error(err.message);
  process.exit(1);
});

for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => process.exit(0));

// ---------------------------------------------------------------- the shared place (package 66)
// A WebSocket at api/room, players mode only: the room (tools/release/room.js) uses who() for the token, as api/save
// does. Without --players there is no upgrade handler, so api/room is only a missing file.
function startRoom() {
  const room = require('./room.js');
  room.init({ who, label, dataDir });
  server.on('upgrade', (req, socket, head) => {
    let rel = '';
    try {
      rel = new URL(req.url, 'http://x').pathname;
    } catch {
      // a broken address: refused below
    }
    if (rel !== '/api/room') {
      socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    room.upgrade(req, socket, head);
  });
}

(PLAYERS ? setupData().then(startRoom) : Promise.resolve())
  .then(() => {
    server.listen(PORT, HOST, () => {
      console.log(`Play Amelia is running at http://${HOST}:${PORT}/${PLAYERS ? ' (players mode)' : ''}`);
    });
  })
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
