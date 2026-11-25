// The shared place (D71, package 66): a WebSocket at api/room for players mode only. One file, CommonJS, no
// dependencies. server.js loads it with require('./room.js'); tools/release/build.ts packs it into the one program.
//
// Read top to bottom:
//   1. limits and settings          5. the room: who is in, places, the 10-a-second update
//   2. the WebSocket wire (RFC 6455) 6. chat: what may be said, the word list, the log, Dad's switches
//   3. upgrade and the first message 7. Keepy Uppy: the server owns the balloon
//   4. messages from a player        8. the race
//
// Trust: nothing a browser sends is believed except what it may decide (where it wants to walk, which key it pressed).
// The player is the one the token in the first message belongs to, checked by server.js's own who(), as api/save does.
// Places are clamped to the area and to a walking speed; the balloon and the race are decided here, never by a client.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// ---------------------------------------------------------------- 1. limits and settings
const MAX_IN = 512; // bytes in one message from a browser; larger closes the socket
const MAX_RATE = 15; // messages a second from one socket; more closes it
const HELLO_MS = 5000; // the first message (with the token) must come within this
const SILENT_MS = 60000; // a socket that says nothing (not even a pong) for this long is closed
const PING_MS = 20000; // the server pings this often; a browser answers by itself
const MAX_IN_ROOM = 11; // the hero's own entry and Player 1 to 10
const MAX_WAITING = 40; // sockets not yet logged in, all addresses together
const MAX_BUFFERED = 256 * 1024; // a browser that does not read what it is sent is closed
const TICK_MS = 100; // places go out 10 times a second at most
const SPEED = 6; // tiles a second a place may move on average (she walks 4.5; a slide is a little faster)
const BURST = 2.5; // tiles of movement that may be saved up (a hop onto the swing's seat, a late message)
const CHAT_MAX = 60; // characters in one chat line
const CHAT_GAP_MS = 2000; // at most one chat message every 2 s per player
const CHAT_PER_MIN = 10; // and at most 10 a minute
const BUBBLE_IDS = 6; // ready phrases 0 to 5 (their words live in the game; only the number travels)

// The meadow (tools/map/meet.ts; tests/room-server.test.ts checks these against src/data/map/meet.json).
const AREA = { x0: 2.2, y0: 3.2, x1: 37.8, y1: 24.8 }; // the walkable inside is tiles x 2..37, y 3..24
const START = { x: 20.5, y: 8.5 };
const STAND = { x: 12.5, y: 14.5 }; // where a player stands to start Keepy Uppy
const LAWN = { x0: 14, y0: 10, x1: 28, y1: 18 }; // the open grass the balloon stays over (tiles, right and bottom open)
const RACE_START = { x0: 3, y0: 20, x1: 7, y1: 23 }; // the start box
const RACE_FINISH_X = 35; // first racer whose feet reach this x, inside the track's rows, wins
const RACE_ROWS = { y0: 19.5, y1: 23.5 };

const DIRS = ['up', 'down', 'left', 'right'];
const CLIPS = ['idle', 'walk', 'cheer', 'wave', 'hop', 'swing', 'talk', 'sit', 'spin', 'dance', 'sleep'];
const FUN_MOVES = ['bounce', 'swing', 'slide', 'sit', 'dance', 'seesaw', 'pat'];

// ---------------------------------------------------------------- 2. the WebSocket wire (RFC 6455)
// Only what the room needs: one whole text frame a message (a fragment closes the socket), ping, pong and close.
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const OP_TEXT = 0x1;
const OP_CLOSE = 0x8;
const OP_PING = 0x9;
const OP_PONG = 0xa;
const utf8 = new TextDecoder('utf-8', { fatal: true });

/** One frame from the server: never masked, never fragmented. */
function frame(op, payload) {
  const len = payload.length;
  const head = len < 126 ? Buffer.alloc(2) : len < 65536 ? Buffer.alloc(4) : Buffer.alloc(10);
  head[0] = 0x80 | op;
  if (len < 126) head[1] = len;
  else if (len < 65536) {
    head[1] = 126;
    head.writeUInt16BE(len, 2);
  } else {
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([head, payload]);
}

/**
 * A connection: reads frames out of the bytes as they come and hands each whole text message to onText. Anything
 * the room does not accept closes it: no mask, a fragment, a reserved bit, binary, a message over MAX_IN bytes,
 * text that is not UTF-8.
 */
class Conn {
  constructor(socket, onText, onGone) {
    this.socket = socket;
    this.onText = onText;
    this.onGone = onGone; // called once, when the connection is over for any reason
    this.buf = Buffer.alloc(0);
    this.closed = false;
    this.heard = Date.now();
    socket.setNoDelay(true);
    socket.on('data', (d) => this.data(d));
    socket.on('error', () => this.drop());
    socket.on('close', () => this.drop());
  }
  data(d) {
    if (this.closed) return;
    this.heard = Date.now();
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    while (!this.closed && this.buf.length >= 2) {
      const b0 = this.buf[0];
      const b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0;
      const rsv = b0 & 0x70;
      const op = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let at = 2;
      if (rsv) return this.close(1002, 'reserved bit');
      if (!masked) return this.close(1002, 'not masked');
      if (!fin || op === 0x0) return this.close(1003, 'no fragments');
      if (len === 127) return this.close(1009, 'too big');
      if (len === 126) {
        if (this.buf.length < 4) return;
        len = this.buf.readUInt16BE(2);
        at = 4;
      }
      const control = op >= 0x8;
      if (control && len > 125) return this.close(1002, 'control too big');
      if (!control && len > MAX_IN) return this.close(1009, 'too big');
      if (this.buf.length < at + 4 + len) return; // the rest is still on its way (never more than one frame waits)
      const mask = this.buf.subarray(at, at + 4);
      const body = Buffer.from(this.buf.subarray(at + 4, at + 4 + len));
      for (let i = 0; i < body.length; i++) body[i] ^= mask[i & 3];
      this.buf = this.buf.subarray(at + 4 + len);
      if (op === OP_TEXT) {
        let text;
        try {
          text = utf8.decode(body);
        } catch {
          return this.close(1007, 'not utf-8');
        }
        this.onText(text);
      } else if (op === OP_PING) this.raw(frame(OP_PONG, body));
      else if (op === OP_CLOSE) return this.close(1000, '');
      else if (op !== OP_PONG) return this.close(1003, 'text only');
    }
  }
  raw(bytes) {
    if (this.closed) return;
    if (this.socket.writableLength > MAX_BUFFERED) return this.close(1008, 'not reading');
    this.socket.write(bytes);
  }
  send(obj) {
    this.raw(frame(OP_TEXT, Buffer.from(JSON.stringify(obj), 'utf8')));
  }
  ping() {
    this.raw(frame(OP_PING, Buffer.alloc(0)));
  }
  /** Send a close frame with a code and a short reason and end the connection (cut after 1 s if it lingers). */
  close(code, reason) {
    if (this.closed) return;
    this.closed = true;
    const body = Buffer.alloc(2 + Buffer.byteLength(reason));
    body.writeUInt16BE(code, 0);
    body.write(reason, 2);
    try {
      this.socket.end(frame(OP_CLOSE, body));
    } catch {
      // already gone
    }
    setTimeout(() => this.socket.destroy(), 1000).unref();
    this.over();
  }
  /** The other side went away or broke the connection. */
  drop() {
    this.closed = true;
    this.socket.destroy();
    this.over();
  }
  over() {
    const g = this.onGone;
    this.onGone = null;
    if (g) g(this);
  }
}

// ---------------------------------------------------------------- 3. upgrade and the first message
let ctx = null; // { who, label, dataDir }: given by server.js once the data folder is ready
const waiting = new Set(); // connections that have not said who they are yet

/**
 * server.js calls this with its token check (who), the player labels and the data folder. Nothing in the room runs
 * before it.
 */
function init(options) {
  ctx = options;
  setInterval(tick, TICK_MS).unref();
  setInterval(pingAll, PING_MS).unref();
  readSettings(true);
  readWords(true);
}

/** server.js hands every upgrade request for api/room here (players mode only). */
function upgrade(req, socket, head) {
  const key = String(req.headers['sec-websocket-key'] || '');
  const ok =
    ctx &&
    req.method === 'GET' &&
    /(^|,)\s*websocket\s*(,|$)/i.test(String(req.headers.upgrade || '')) &&
    String(req.headers['sec-websocket-version'] || '') === '13' &&
    /^[A-Za-z0-9+/]{22}==$/.test(key) &&
    waiting.size < MAX_WAITING;
  if (!ok) {
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    setTimeout(() => socket.destroy(), 1000).unref();
    return;
  }
  const accept = crypto
    .createHash('sha1')
    .update(key + GUID)
    .digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\nCache-Control: no-store\r\n\r\n`,
  );
  const conn = new Conn(socket, (text) => onMessage(conn, text), gone);
  conn.who = null;
  conn.rate = { t: Date.now(), n: 0 };
  waiting.add(conn);
  conn.helloTimer = setTimeout(() => {
    if (!conn.who) conn.close(4001, 'no hello');
  }, HELLO_MS);
  // bytes that came with the upgrade request belong to the socket
  if (head?.length) conn.data(head);
}

/** The first message: { t: 'hi', token, hero }. A token that is not a live login closes the socket. */
function hello(conn, m) {
  clearTimeout(conn.helloTimer);
  waiting.delete(conn);
  const token = typeof m.token === 'string' ? m.token : '';
  const id = m.t === 'hi' && token ? ctx.who({ headers: { authorization: `Bearer ${token}` } }) : null;
  if (!id) return conn.close(4003, 'login');
  const hero = typeof m.hero === 'string' && /^[a-z][a-z0-9_]{0,23}$/.test(m.hero) ? m.hero : 'koala';
  // the red-haired hero is hers alone (D71)
  const safeHero = hero === 'amelia' && id !== 'hero' ? 'koala' : hero;
  const old = room.get(id);
  if (old) {
    // one socket per player: the new one wins, the old one is told why
    old.conn.onGone = null;
    old.conn.close(4000, 'replaced');
    room.delete(id);
  } else if (room.size >= MAX_IN_ROOM) return conn.close(4005, 'full');
  conn.who = id;
  const p = {
    id,
    conn,
    label: ctx.label(id),
    hero: safeHero,
    // a new arrival stands near the others at the start; a player back from another window keeps their place
    x: old ? old.x : START.x + ((room.size % 5) - 2) * 0.9,
    y: old ? old.y : START.y + Math.floor(room.size / 5) * 0.9,
    d: 'down',
    c: 'idle',
    at: Date.now(),
    budget: BURST,
    moved: true,
    chat: chatState(id),
  };
  room.set(id, p);
  conn.send({
    t: 'welcome',
    you: id,
    x: p.x,
    y: p.y,
    chat: chatOn(),
    players: [...room.values()].filter((q) => q !== p).map(card),
    ball: ballCard(),
    best: bestToday(),
    race: race ? { phase: race.phase, ms: Math.max(0, race.goAt - Date.now()) } : null,
  });
  // a player back from another window may have another hero: a join with the same id replaces them for everyone
  everyone({ t: 'join', ...card(p) }, p);
}

function gone(conn) {
  clearTimeout(conn.helloTimer);
  waiting.delete(conn);
  if (!conn.who) return;
  const p = room.get(conn.who);
  if (!p || p.conn !== conn) return; // replaced by a newer socket: that one stays
  room.delete(conn.who);
  if (race) race.racers.delete(conn.who);
  everyone({ t: 'leave', id: conn.who });
}

// ---------------------------------------------------------------- 4. messages from a player
function onMessage(conn, text) {
  const now = Date.now();
  if (now - conn.rate.t >= 1000) conn.rate = { t: now, n: 0 };
  if (++conn.rate.n > MAX_RATE) return conn.close(1008, 'too fast');
  let m;
  try {
    m = JSON.parse(text);
  } catch {
    return conn.close(1007, 'not json');
  }
  if (!m || typeof m !== 'object' || Array.isArray(m) || typeof m.t !== 'string') return conn.close(1007, 'not json');
  if (!conn.who) return hello(conn, m);
  const p = room.get(conn.who);
  if (!p || p.conn !== conn) return conn.close(4000, 'replaced');
  switch (m.t) {
    case 'mv':
      return move(p, m);
    case 'fun':
      return fun(p, m);
    case 'emo':
      return everyone({ t: 'emo', id: p.id }, p);
    case 'say':
      return say(p, m.text);
    case 'ph':
      return phrase(p, m.n);
    case 'kick':
      return kick(p);
    case 'race':
      return startRace(p);
    default:
      return undefined; // an unknown kind is ignored (a newer game talking to an older server)
  }
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const round = (v) => Math.round(v * 100) / 100;

/**
 * { t: 'mv', x, y, d, c }: where the player wants to be. Kept in the area and to a walking speed: each player has a
 * budget of tiles that fills at SPEED a second up to BURST, and a move spends it; a longer move goes only as far.
 */
function move(p, m) {
  const x = num(m.x);
  const y = num(m.y);
  if (x === null || y === null) return;
  const now = Date.now();
  p.budget = Math.min(BURST, p.budget + (SPEED * (now - p.at)) / 1000);
  p.at = now;
  let nx = clamp(x, AREA.x0, AREA.x1);
  let ny = clamp(y, AREA.y0, AREA.y1);
  let fixed = nx !== x || ny !== y;
  let dist = Math.hypot(nx - p.x, ny - p.y);
  if (dist > p.budget) {
    nx = p.x + ((nx - p.x) * p.budget) / dist;
    ny = p.y + ((ny - p.y) * p.budget) / dist;
    dist = p.budget;
    fixed = true;
  }
  p.budget -= dist;
  p.x = nx;
  p.y = ny;
  if (DIRS.includes(m.d)) p.d = m.d;
  if (CLIPS.includes(m.c)) p.c = m.c;
  p.moved = true;
  // the browser is told where it really is, so it does not drift away from what everyone else sees
  if (fixed) p.conn.send({ t: 'fix', x: round(nx), y: round(ny) });
  if (race && race.phase === 'run') raceStep(p);
}

/** { t: 'fun', m, o, ax, ay, bx, by, s }: a turn on a swing or the like, for the others to draw. Numbers only. */
function fun(p, m) {
  if (!FUN_MOVES.includes(m.m)) return;
  const o = num(m.o);
  const vals = [m.ax, m.ay, m.bx, m.by].map(num);
  if (o === null || !Number.isInteger(o) || o < -1 || o > 500 || vals.some((v) => v === null)) return;
  const [ax, ay, bx, by] = vals.map((v) => round(clamp(v, -1, 41)));
  everyone({ t: 'fun', id: p.id, m: m.m, o, ax, ay, bx, by, d: DIRS.includes(m.d) ? m.d : 'down' }, p);
}

// ---------------------------------------------------------------- 5. the room
const room = new Map(); // player id -> { id, conn, label, hero, x, y, d, c, at, moved, chat }

const card = (p) => ({ id: p.id, label: p.label, hero: p.hero, x: round(p.x), y: round(p.y), d: p.d, c: p.c });

/** A message to everyone in the room (but one, if given). */
function everyone(obj, but) {
  const bytes = frame(OP_TEXT, Buffer.from(JSON.stringify(obj), 'utf8'));
  for (const p of room.values()) if (p !== but) p.conn.raw(bytes);
}

/** 10 times a second: the places that changed since last time, to everyone; and the silent sockets closed. */
function tick() {
  const now = Date.now();
  const changed = [];
  for (const p of room.values()) {
    if (now - p.conn.heard > SILENT_MS) {
      p.conn.close(4002, 'silent');
      continue;
    }
    if (!p.moved) continue;
    p.moved = false;
    changed.push([p.id, round(p.x), round(p.y), p.d, p.c]);
  }
  for (const c of waiting) if (now - c.heard > SILENT_MS) c.close(4002, 'silent');
  if (changed.length) everyone({ t: 'pos', p: changed });
  if (race && race.phase === 'count' && now >= race.goAt) raceGo();
  if (race && race.phase === 'run' && now >= race.endAt) raceEnd(null);
}

function pingAll() {
  for (const p of room.values()) p.conn.ping();
}

// ---------------------------------------------------------------- 6. chat
// Only a logged-in player's words are passed on (a socket is in the room only after its token was checked).
// Typed text is cleaned and checked here, never trusted from the game: the game's own check is only a courtesy.
// Every message, sent or refused, goes in data/chat-YYYY-MM-DD.log (600) with its time and the player's id.
// data/room.json (Dad's): { "chat": false } turns typed chat off for everyone (ready phrases stay);
// { "muted": ["p3"] } silences one player (typed and ready phrases). WS_CHAT=0 also turns typed chat off.
// data/chat-words.txt (Dad's): more words to refuse, one a line. Both files are read again when they change.

/** Letters (with accents), digits, spaces, . , ! ? ' - and these emoji; everything else is dropped. */
const EMOJI = ['❤', '😀', '😂', '😊', '😢', '😮', '👍', '👋', '🎉', '⭐', '🎄', '🎁', '⛄', '🐶', '🐱', '🌈'];
const KEEP = new RegExp(`[^A-Za-z0-9\\u00C0-\\u017F .,!?'\\-${EMOJI.join('')}]`, 'gu');

// The built-in list: whole words, after folding (see fold). Dad's file adds to it.
const RUDE = [
  'arse',
  'arsehole',
  'ass',
  'asshole',
  'bastard',
  'bellend',
  'bitch',
  'bloody',
  'bollocks',
  'boob',
  'boobs',
  'bugger',
  'bum',
  'bumhole',
  'butthole',
  'cock',
  'crap',
  'cunt',
  'damn',
  'dick',
  'dickhead',
  'dumb',
  'dummy',
  'fart',
  'fatso',
  'fatty',
  'fck',
  'feck',
  'fk',
  'fuck',
  'fucker',
  'fucking',
  'fuk',
  'goddamn',
  'hell',
  'idiot',
  'jerk',
  'kill',
  'knob',
  'loser',
  'moron',
  'nazi',
  'nob',
  'nonce',
  'penis',
  'pee',
  'piss',
  'poo',
  'poop',
  'porn',
  'prat',
  'pussy',
  'retard',
  'sex',
  'sexy',
  'shit',
  'shite',
  'slag',
  'slut',
  'stfu',
  'stupid',
  'sucks',
  'tit',
  'tits',
  'turd',
  'twat',
  'ugly',
  'vagina',
  'wanker',
  'weirdo',
  'whore',
  'willy',
  'wtf',
  'hate',
];
const chats = new Map(); // player id -> { last, times }: kept across sockets, so coming back does not reset them
function chatState(id) {
  if (!chats.has(id)) chats.set(id, { last: 0, times: [] });
  return chats.get(id);
}
let words = new Set();
let wordsStamp = '';
let settings = { chat: true, muted: [] };
let settingsStamp = '';
let lastLook = 0;

const SWAPS = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's', '!': 'i', '|': 'i' };
/** Lower case, accents off, common letter swaps undone (sh1t, @ss). `swap` false keeps the symbols as gaps. */
function fold(s, swap = true) {
  const plain = s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
  return swap ? plain.replace(/[0134578@$!|]/g, (c) => SWAPS[c]) : plain;
}
/** The words of a folded text. */
const wordsOf = (s) => s.split(/[^a-z]+/).filter(Boolean);
/** A word with a letter held down (fuuuck) also matches, but only when some letter runs 3 or more times. */
const squash = (w) => w.replace(/(.)\1+/g, '$1');

function stampOf(file) {
  try {
    const st = fs.statSync(file);
    return `${st.mtimeMs}:${st.size}`;
  } catch {
    return 'none';
  }
}
/** Dad's word list, read again when the file changes (looked at no more than every 2 s). */
function readWords(force) {
  const file = path.join(ctx.dataDir, 'chat-words.txt');
  const st = stampOf(file);
  if (!force && st === wordsStamp) return;
  wordsStamp = st;
  const list = new Set();
  for (const w of RUDE) list.add(fold(w));
  try {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const w = wordsOf(fold(line.trim())).join('');
      if (w) list.add(w);
    }
  } catch {
    // no file: the built-in list alone
  }
  words = list;
}
/** Dad's switches, read again when the file changes. A broken file keeps chat as it was and says so once. */
function readSettings(force) {
  const file = path.join(ctx.dataDir, 'room.json');
  const st = stampOf(file);
  if (!force && st === settingsStamp) return;
  settingsStamp = st;
  const was = chatOn();
  let s = {};
  if (st !== 'none') {
    try {
      s = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      console.log('data/room.json has a mistake: it is not used until it is fixed');
      return;
    }
  }
  settings = {
    chat: s.chat !== false,
    muted: Array.isArray(s.muted) ? s.muted.filter((v) => typeof v === 'string') : [],
  };
  if (chatOn() !== was) everyone({ t: 'chat', on: chatOn() });
}
function look() {
  const now = Date.now();
  if (now - lastLook < 2000) return;
  lastLook = now;
  readSettings(false);
  readWords(false);
}
const chatOn = () => process.env.WS_CHAT !== '0' && settings.chat;
const isMuted = (id) => settings.muted.includes(id);

/** Why a text may not be sent, or '' when it may. `raw` is as typed, `clean` after cleaning. */
function refusal(raw, clean) {
  if (raw.includes('@')) return 'at';
  if (/https?|www|:\/\//i.test(raw)) return 'web';
  if (/[a-z0-9]\s*(\.|\bdot\b)\s*(com|net|org|uk|co|io|me|ly|gg|tv|app|xyz|ru|de|hu|info|biz|link)\b/i.test(raw))
    return 'web';
  if (/\d{4,}/.test(raw.replace(/[\s.,\-_'()+/]/g, ''))) return 'number';
  // folded twice: with the swaps (sh!t) and without them (shit!), so a symbol can neither hide nor make a word
  for (const folded of [fold(clean), fold(clean, false)]) {
    for (const w of wordsOf(folded)) {
      if (words.has(w)) return 'word';
      if (/(.)\1\1/.test(w)) {
        const sq = squash(w);
        for (const bad of words) if (squash(bad) === sq) return 'word';
      }
    }
    // spaced out letters (s h i t): the single letters joined
    const singles = folded.match(/\b[a-z](?:\s+[a-z]\b)+/g) || [];
    for (const run of singles) if (words.has(run.replace(/\s+/g, ''))) return 'word';
  }
  return '';
}

/** Clean a typed line: control characters and anything not allowed go, spaces are tidied, 60 characters at most. */
function clean(text) {
  const kept = text
    .normalize('NFC')
    .replace(/\p{Cc}|\p{Cf}/gu, ' ')
    .replace(KEEP, '');
  return Array.from(kept.replace(/\s+/g, ' ').trim()).slice(0, CHAT_MAX).join('');
}

function logChat(id, what, text) {
  const day = new Date().toISOString().slice(0, 10);
  const file = path.join(ctx.dataDir, `chat-${day}.log`);
  const line = `${new Date().toISOString()}\t${id}\t${what}\t${JSON.stringify(String(text).slice(0, 200))}\n`;
  try {
    fs.appendFileSync(file, line, { mode: 0o600 });
    fs.chmodSync(file, 0o600);
  } catch (err) {
    console.error(`chat log: ${err.message}`);
  }
}

/** The per-player chat limits; true when this message may go (and it is counted). */
function chatTurn(p) {
  const now = Date.now();
  p.chat.times = p.chat.times.filter((t) => now - t < 60000);
  if (now - p.chat.last < CHAT_GAP_MS || p.chat.times.length >= CHAT_PER_MIN) return false;
  p.chat.last = now;
  p.chat.times.push(now);
  return true;
}

/** { t: 'say', text }: a typed line. */
function say(p, raw) {
  look();
  if (typeof raw !== 'string') return;
  if (!chatOn()) {
    logChat(p.id, 'off', raw);
    return p.conn.send({ t: 'chat', on: false });
  }
  if (isMuted(p.id)) {
    logChat(p.id, 'muted', raw);
    return p.conn.send({ t: 'muted' });
  }
  if (!chatTurn(p)) {
    logChat(p.id, 'slow', raw);
    return p.conn.send({ t: 'slow' });
  }
  const text = clean(raw);
  if (!text) return;
  const why = Array.from(raw).length > CHAT_MAX * 2 ? 'long' : refusal(raw, text);
  if (why) {
    logChat(p.id, `refused:${why}`, raw);
    return p.conn.send({ t: 'no' });
  }
  logChat(p.id, 'sent', text);
  everyone({ t: 'say', id: p.id, text });
}

/** { t: 'ph', n }: a ready phrase, by number. Stays on when typed chat is off; a muted player is still silent. */
function phrase(p, n) {
  look();
  if (!Number.isInteger(n) || n < 0 || n >= BUBBLE_IDS) return;
  if (isMuted(p.id)) {
    logChat(p.id, 'muted', `phrase ${n}`);
    return p.conn.send({ t: 'muted' });
  }
  if (!chatTurn(p)) {
    logChat(p.id, 'slow', `phrase ${n}`);
    return p.conn.send({ t: 'slow' });
  }
  logChat(p.id, 'sent', `phrase ${n}`);
  everyone({ t: 'ph', id: p.id, n });
}

// ---------------------------------------------------------------- 7. Keepy Uppy
// The balloon flies a simple arc from its last hit: ground place x0 + vx t, y0 + vy t; height h0 + vh t - G t^2 / 2.
// Every browser draws the same arc from the last hit (src/game/meet/keepy.ts has the same numbers), so nobody needs
// a fast connection. A hit counts when the player (where the server has them) stands under it while it is low.
const G = 2.4; // tiles a second a second
const UP = 3.4; // tiles a second upwards after a hit
const REACH = 1.5; // tiles from the balloon's shadow to the player's feet
const LOW = 2.0; // tiles: the balloon must be lower than this to be hit
const GAP_MS = 450; // two hits are at least this far apart (two players pressing at once: the first wins)
let ball = null; // { x0, y0, h0, vx, vy, vh, t0, n, seq }
let best = { day: '', n: 0 };

const today = () => new Date().toISOString().slice(0, 10);
function bestToday() {
  if (best.day !== today()) best = { day: today(), n: 0 };
  return best.n;
}
function ballAt(b, now) {
  const t = (now - b.t0) / 1000;
  return { x: b.x0 + b.vx * t, y: b.y0 + b.vy * t, h: b.h0 + b.vh * t - (G * t * t) / 2 };
}
/** Seconds from a hit until the grass: h0 + vh t - G t^2 / 2 = 0. */
const flight = (h0, vh) => (vh + Math.sqrt(vh * vh + 2 * G * h0)) / G;
function ballCard() {
  if (!ball) return null;
  const { x0, y0, h0, vx, vy, vh, n } = ball;
  return { x0, y0, h0, vx, vy, vh, n, age: Date.now() - ball.t0 };
}

/** A new arc from (x, y, h): it lands somewhere 1.5 to 3.5 tiles away, always over the lawn. */
function launch(x, y, h, n) {
  const T = flight(h, UP);
  const a = Math.random() * Math.PI * 2;
  const r = 1.5 + Math.random() * 2;
  const tx = clamp(x + Math.cos(a) * r, LAWN.x0 + 0.8, LAWN.x1 - 0.8);
  const ty = clamp(y + Math.sin(a) * r, LAWN.y0 + 0.8, LAWN.y1 - 0.8);
  const seq = (ball?.seq ?? 0) + 1;
  ball = { x0: x, y0: y, h0: h, vx: (tx - x) / T, vy: (ty - y) / T, vh: UP, t0: Date.now(), n, seq };
  everyone({ t: 'ball', ...ballCard() });
  // it lands unless someone hits it first (a hit makes a new seq, so this timer then does nothing)
  setTimeout(() => land(seq), T * 1000 + 120).unref();
}
function land(seq) {
  if (!ball || ball.seq !== seq) return;
  const n = ball.n;
  ball = null;
  if (n > bestToday()) best.n = n;
  everyone({ t: 'land', n, best: best.n });
}

/** { t: 'kick' }: Space. At the stand with no balloon up: a new game. Under the balloon: a hit. */
function kick(p) {
  const now = Date.now();
  if (!ball) {
    if (Math.hypot(p.x - STAND.x, p.y - STAND.y) > 2) return;
    return launch(LAWN.x0 + 1.2, STAND.y - 0.5, 1.2, 0);
  }
  if (now - ball.t0 < GAP_MS) return;
  const at = ballAt(ball, now);
  if (at.h <= 0 || at.h > LOW || Math.hypot(p.x - at.x, p.y - at.y) > REACH) return;
  launch(clamp(at.x, LAWN.x0, LAWN.x1), clamp(at.y, LAWN.y0, LAWN.y1), Math.max(0.4, at.h), ball.n + 1);
  everyone({ t: 'hit', id: p.id });
}

// ---------------------------------------------------------------- 8. the race
// A player in the start box presses Space: 3, 2, 1. Everyone in the box at "go" races; the first whose feet reach
// the finish line, on the track, wins. Places are the server's own (clamped), so nobody can jump to the end.
const COUNT_MS = 3000;
const RACE_MS = 30000;
let race = null; // { phase: 'count' | 'run', goAt, endAt, racers: Set }

const inBox = (p) => p.x >= RACE_START.x0 && p.x < RACE_START.x1 && p.y >= RACE_START.y0 && p.y < RACE_START.y1;
function startRace(p) {
  if (race || !inBox(p)) return;
  race = { phase: 'count', goAt: Date.now() + COUNT_MS, endAt: 0, racers: new Set() };
  everyone({ t: 'race', phase: 'count', ms: COUNT_MS });
}
function raceGo() {
  for (const p of room.values()) if (inBox(p)) race.racers.add(p.id);
  if (!race.racers.size) return raceEnd(null);
  race.phase = 'run';
  race.endAt = Date.now() + RACE_MS;
  everyone({ t: 'race', phase: 'go', ids: [...race.racers] });
}
function raceStep(p) {
  if (!race.racers.has(p.id)) return;
  if (p.x >= RACE_FINISH_X && p.y >= RACE_ROWS.y0 && p.y < RACE_ROWS.y1) raceEnd(p.id);
}
function raceEnd(winner) {
  race = null;
  everyone({ t: 'race', phase: 'end', win: winner });
}

module.exports = {
  init,
  upgrade,
  // for the tests and for anyone checking the numbers against the map
  _: { AREA, START, STAND, LAWN, RACE_START, RACE_FINISH_X, G, UP, clean, refusal, fold },
};
