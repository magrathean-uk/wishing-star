// Touch controls for an iPad held sideways (package 65, D71, D72). Drawn in the page over the canvas and shown only
// on a touch device: a floating stick for the left thumb, Space and X for the right, a small row at the top for the
// bag, quests, map, hint and pause. Every control presses the game's own keys (synthetic key events on the window),
// so the rules, menus, mini-games and bosses have one code path. A tap on a menu row moves there with the arrow keys
// and picks it with Space; a tap outside a menu's panel is X; a tap on a talk box is Space.
import Phaser from 'phaser';
import { toolTier } from '../core/bag.ts';
import { canSkip } from '../core/cutscene.ts';
import { bestFood, LOW_HP } from '../core/hero.ts';
import type { Game } from '../core/types.ts';
import { strings } from '../data/strings.ts';
import { Sound } from './audio.ts';
import { touchState } from './input.ts';
import { type DrawnBox, drawn, H, W } from './ui/kit.ts';
import { MapMenu } from './ui/menus/map.ts';
import { PauseMenu } from './ui/menus/pause.ts';
import { openCredit, typing } from './ui/players.ts';
import { openSlotsPanel } from './ui/slots.ts';

const S = (k: string) => strings[k] ?? '';

/** event.code to [event.key, keyCode]: the keys the controls press. */
const KEYS: Record<string, [string, number]> = {
  ArrowUp: ['ArrowUp', 38],
  ArrowDown: ['ArrowDown', 40],
  ArrowLeft: ['ArrowLeft', 37],
  ArrowRight: ['ArrowRight', 39],
  Space: [' ', 32],
  Enter: ['Enter', 13],
  Escape: ['Escape', 27],
  KeyX: ['x', 88],
  KeyE: ['e', 69],
  KeyQ: ['q', 81],
  KeyM: ['m', 77],
  KeyH: ['h', 72],
  KeyP: ['p', 80],
  KeyR: ['r', 82],
  KeyK: ['k', 75],
  KeyB: ['b', 66],
};
for (let i = 1; i <= 8; i++) KEYS[`Digit${i}`] = [String(i), 48 + i];

// ---------------------------------------------------------------- which device

/** ?touch=1 or ?touch=0 in the address forces the controls on or off (for a look on a laptop). */
let forced: string | null = null;
/** A touch screen exists (an iPad, or a laptop with one): panels and slots are recorded for taps. */
export function touchCapable(): boolean {
  forced = new URLSearchParams(location.search).get('touch');
  if (forced === '0') return false;
  if (forced === '1') return true;
  return navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
}
/** Touch first: a coarse pointer and no fine one (an iPad without a mouse). A laptop answers false. */
function touchFirst(): boolean {
  if (forced === '0') return false;
  if (forced === '1') return true;
  return matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;
}

/**
 * A phone (D72: iPad only): a touch-first screen narrower than 900 CSS pixels held sideways, or shorter than 600
 * (the largest phones are about 930 by 430). It gets one calm card instead of the game. True when the card is shown.
 */
export function phoneCard(): boolean {
  if (!touchCapable() || !touchFirst() || forced === '1') return false;
  const long = Math.max(screen.width, screen.height);
  const short = Math.min(screen.width, screen.height);
  if (long >= 900 && short >= 600) return false;
  card('phone', S('touch_phone'), false);
  return true;
}

// ---------------------------------------------------------------- keys

const held = new Set<string>();
function key(type: 'keydown' | 'keyup', code: string): void {
  const k = KEYS[code];
  if (!k) return;
  const e = new KeyboardEvent(type, { code, key: k[0], bubbles: true, cancelable: true });
  Object.defineProperty(e, 'keyCode', { get: () => k[1] });
  Object.defineProperty(e, 'which', { get: () => k[1] });
  window.dispatchEvent(e);
}
function down(code: string): void {
  if (held.has(code)) return;
  held.add(code);
  key('keydown', code);
}
function up(code: string): void {
  if (!held.delete(code)) return;
  key('keyup', code);
}
function releaseAll(): void {
  for (const c of [...held]) up(c);
}

/** Work to do a number of game steps from now (a key goes down in one step and up two steps later). */
const later: { n: number; f: () => void }[] = [];
function after(n: number, f: () => void): void {
  later.push({ n, f });
}
/** One press: down now, up two steps later, so the game sees it held for a frame. */
/** When each finger went down on a button, for the quick-tap rule in onUp. */
const pressedAt = new Map<number, number>();
function press(code: string): void {
  if (held.has(code)) return;
  down(code);
  after(2, () => up(code));
}

// ---------------------------------------------------------------- the page

let game: Phaser.Game;
let root: HTMLDivElement;
let stickEl: HTMLDivElement;
let knobEl: HTMLDivElement;
let spaceEl: HTMLDivElement;
let xEl: HTMLDivElement;
let rowEl: HTMLDivElement;
let fullEl: HTMLDivElement;
let spaceWord = '';
let spaceCode = 'Space';
let xWord = '';
/** a menu is open, and whether Pick has nothing to do in it (issue 22): the buttons move out of its way */
let inMenu = false;
let noPick = false;
/** the width of a button in the band under the game */
const DOCK_W = 132;

const CSS = `
#touch{position:fixed;inset:0;pointer-events:none;z-index:5;display:none;-webkit-user-select:none;user-select:none;
  -webkit-touch-callout:none;font-family:Fredoka,Nunito,sans-serif}
#touch.on{display:block}
#touch .b{position:absolute;pointer-events:auto;border-radius:50%;display:flex;align-items:center;justify-content:center;
  background:rgba(16,19,31,.34);border:3px solid rgba(255,248,231,.55);color:#fff;font-weight:600;
  text-shadow:0 2px 0 rgba(0,0,0,.45);transition:opacity .2s,background-color .1s;touch-action:none;box-sizing:border-box}
#touch .b.hide{opacity:0;pointer-events:none}
#touch .b.press{background:rgba(242,184,75,.75);border-color:#fff8e7}
#touch .space{width:112px;height:112px;font-size:26px}
#touch .x{width:76px;height:76px;font-size:20px}
#touch .row{position:absolute;display:flex;gap:10px;pointer-events:none;transition:opacity .2s}
#touch .row.hide{opacity:0}
#touch .row.hide .b{pointer-events:none}
#touch .row .b{position:static;width:64px;height:64px;border-radius:18px}
#touch .row img{width:44px;height:44px;object-fit:contain;pointer-events:none}
#touch .row .pause::before,#touch .row .pause::after{content:'';width:10px;height:28px;margin:0 4px;border-radius:3px;
  background:#fff8e7}
#touch.dock .space,#touch.dock .x{width:${DOCK_W}px;border-radius:18px;font-size:22px!important}
#touch .full{border-radius:18px;width:auto;height:64px;padding:0 20px;font-size:22px;background:#f2b84b;color:#3b2a1a;
  border-color:#c98b2b;text-shadow:none}
#touch .stick{position:absolute;width:150px;height:150px;margin:-75px 0 0 -75px;border-radius:50%;display:none;
  background:rgba(16,19,31,.22);border:3px solid rgba(255,248,231,.4);box-sizing:border-box}
#touch .stick.show{display:block}
#touch .knob{position:absolute;left:50%;top:50%;width:68px;height:68px;margin:-34px 0 0 -34px;border-radius:50%;
  background:rgba(255,248,231,.55)}
#touch-card{position:fixed;inset:0;z-index:20;display:none;flex-direction:column;align-items:center;justify-content:center;
  gap:28px;background:#10131f;color:#fff8e7;font:600 34px Fredoka,Nunito,sans-serif;text-align:center;padding:24px}
#touch-card.on{display:flex}
`;

function el(cls: string, parent: HTMLElement): HTMLDivElement {
  const d = document.createElement('div');
  d.className = cls;
  parent.appendChild(d);
  return d;
}

/** A picture from the game's own textures, as a small image for a button. */
function pic(keyName: string, frame?: string): string {
  try {
    return game.textures.getBase64(keyName, frame);
  } catch {
    return '';
  }
}
/** The atlas key that holds a frame. */
function atlasOf(frame: string): string | null {
  for (const k of game.textures.getTextureKeys()) if (game.textures.get(k).has(frame)) return k;
  return null;
}

/** The card held upright (turn the iPad) or on a phone. */
let cardEl: HTMLDivElement | null = null;
function card(kind: 'turn' | 'phone', words: string, on: boolean): void {
  if (!cardEl) {
    cardEl = document.createElement('div');
    cardEl.id = 'touch-card';
    document.body.appendChild(cardEl);
    if (!document.getElementById('touch-css')) {
      const st = document.createElement('style');
      st.id = 'touch-css';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
  }
  // a tablet turning on its side, drawn in the page: no new art
  const svg =
    kind === 'turn'
      ? '<svg width="180" height="150" viewBox="0 0 180 150" fill="none" stroke="#f2b84b" stroke-width="7" ' +
        'stroke-linecap="round" stroke-linejoin="round"><rect x="20" y="20" width="62" height="96" rx="10"/>' +
        '<rect x="70" y="80" width="96" height="62" rx="10" stroke="#fff8e7"/><path d="M104 18c28 4 44 22 46 46"/>' +
        '<path d="M140 56l10 10 10-12"/></svg>'
      : '<svg width="160" height="120" viewBox="0 0 160 120" fill="none" stroke="#f2b84b" stroke-width="7" ' +
        'stroke-linecap="round" stroke-linejoin="round"><rect x="10" y="12" width="140" height="96" rx="12"/>' +
        '<circle cx="80" cy="60" r="16" stroke="#fff8e7"/></svg>';
  cardEl.innerHTML = `${svg}<div></div>`;
  (cardEl.lastChild as HTMLDivElement).textContent = words;
  cardEl.classList.add('on');
  if (kind === 'phone') return;
  cardEl.classList.toggle('on', on);
}

// ---------------------------------------------------------------- where things are

function canvasRect(): DOMRect {
  return game.canvas.getBoundingClientRect();
}
/** A point on the page to a point on the 1920 x 1080 game screen. */
function toGame(cx: number, cy: number): [number, number] {
  const r = canvasRect();
  return [((cx - r.left) * W) / r.width, ((cy - r.top) * H) / r.height];
}

let insets = { t: 0, r: 0, b: 0, l: 0 };
function readInsets(): void {
  const p = document.createElement('div');
  p.style.cssText =
    'position:fixed;visibility:hidden;padding:env(safe-area-inset-top) env(safe-area-inset-right) ' +
    'env(safe-area-inset-bottom) env(safe-area-inset-left)';
  document.body.appendChild(p);
  const cs = getComputedStyle(p);
  insets = {
    t: parseFloat(cs.paddingTop) || 0,
    r: parseFloat(cs.paddingRight) || 0,
    b: parseFloat(cs.paddingBottom) || 0,
    l: parseFloat(cs.paddingLeft) || 0,
  };
  p.remove();
}

/**
 * Place the buttons. Space and X sit at the bottom right, right of the talk box (its right edge is x 1670 on the game
 * screen) and above nothing she reads; the row sits at the top between the hearts (up to x 610) and the clock (from
 * x 1590), in the dark band above the game on an iPad. Sizes: a 10 inch iPad held sideways shows about 132 CSS pixels
 * to the inch, so the smallest button (64) is 12 mm.
 */
function layout(): void {
  readInsets();
  const r = canvasRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const m = 16;
  const sx = vw - insets.r - m - 112;
  // above the credit line and the hint word along the game's bottom edge (from y 1040 on the game screen)
  const sy = Math.min(vh - insets.b - m, r.top + 1040 * (r.height / H) - 6) - 112;
  // A menu fills the game screen, so there the two buttons leave it (issue 22): side by side in the dark band under
  // the game when there is one (an iPad held sideways shows it with a band above and below), Back on the right; with
  // no room there, Back takes Pick's corner when Pick has nothing to do (the plain map: its shards stay clear).
  const below = vh - insets.b - r.bottom;
  const dock = inMenu && below >= 60;
  root.classList.toggle('dock', dock);
  if (dock) {
    const h = Math.min(64, below - 12);
    const top = r.bottom + (below - h) / 2;
    const right = Math.min(vw - insets.r, r.right) - m;
    Object.assign(xEl.style, { left: `${right - DOCK_W}px`, top: `${top}px`, height: `${h}px` });
    Object.assign(spaceEl.style, { left: `${right - 2 * DOCK_W - 12}px`, top: `${top}px`, height: `${h}px` });
  } else {
    Object.assign(spaceEl.style, { left: `${sx}px`, top: `${sy}px`, height: '' });
    const low = inMenu && noPick;
    Object.assign(xEl.style, {
      left: `${sx + (low ? 36 : 18)}px`,
      top: `${low ? sy + 36 : sy - 76 - 18}px`,
      height: '',
    });
  }
  const scale = r.width / W;
  const rowW = 5 * 64 + 4 * 10;
  const right = r.left + 1560 * scale;
  const left = Math.max(insets.l + m, Math.min(right - rowW, r.left + 640 * scale));
  Object.assign(rowEl.style, { left: `${left}px`, top: `${Math.max(insets.t + 8, r.top - 72)}px` });
  // the pause menu's full screen button: bottom right inside its panel (it ends at W/2 + 520 by 970)
  Object.assign(fullEl.style, {
    left: `${r.left + (W / 2 + 490) * scale - (fullEl.offsetWidth || 170)}px`,
    top: `${r.top + 940 * scale - 64}px`,
  });
}

// ---------------------------------------------------------------- what the game is showing

interface UiLike extends Phaser.Scene {
  overlay: {
    root: Phaser.GameObjects.Container;
    tap?: (x: number, y: number) => boolean;
    /** package 71: a drag let go in the menu (the bag: a thing onto a bottom button) */
    drop?: (x0: number, y0: number, x1: number, y1: number) => boolean;
    /** package 74: a long press in the menu (the bag: pin a thing to its bottom button) */
    hold?: (x: number, y: number) => boolean;
  } | null;
  focus(): 'menu' | 'card' | 'talk' | 'morning' | '';
  hintKey: string;
  eatLabel: string;
  askWord: string;
  dlgChoices: Phaser.GameObjects.Text[];
  hudTap(x: number, y: number): string;
  miniTap(x: number, y: number): boolean;
}
interface TitleLike extends Phaser.Scene {
  mode: string;
  selectReplacementAt(x: number, y: number): void;
  picker: { step: 'list' | 'pass'; sel: number; rowAt(x: number, y: number): number; move(by: number): void } | null;
  credit: Phaser.GameObjects.Text | null;
}
interface HeroLike extends Phaser.Scene {
  sel: number;
  ids: string[];
  puppets: { sprite: Phaser.GameObjects.Sprite }[];
}

type Where = 'title' | 'pass' | 'hero' | 'menu' | 'talk' | 'card' | 'cut' | 'mini' | 'play' | 'meet' | 'none';
function active(name: string): Phaser.Scene | null {
  const sc = game.scene.getScene(name);
  return sc?.sys.isActive() ? sc : null;
}
function theGame(): Game | null {
  return (game.registry.get('game') as Game | undefined) ?? null;
}
function where(): Where {
  const title = active('Title') as TitleLike | null;
  if (title) return title.mode === 'who' && title.picker?.step === 'pass' ? 'pass' : 'title';
  if (active('HeroSelect')) return 'hero';
  // the shared place (package 66): its own Back, Type and phrase buttons do the rest; Space uses a thing or bats the balloon
  if (active('Meet')) return 'meet';
  const ui = active('UI') as UiLike | null;
  const g = theGame();
  if (!ui || !g) return 'none';
  const f = ui.focus();
  if (f === 'menu') return 'menu';
  if (f === 'talk') return 'talk';
  if (f === 'card' || f === 'morning') return 'card';
  if (g.rt.cut || g.rt.mode === 'cut') return 'cut';
  if (g.rt.mode === 'mini') return 'mini';
  if (g.rt.mode === 'talk') return 'talk';
  return 'play';
}

/**
 * The big button's word and key on the play screen, from the hint strip and its food part ("R: Eat", '' for none).
 * Food alone: the button eats and says so without the keyboard letter ("Eat"). A facing action and food: the button
 * keeps the facing action and the strip's own "R: Eat" end still eats (UI.hudTap).
 */
export function worldTouchAction(hint: string, eat: string): { word: string; code: string } {
  if (eat && hint === eat) return { word: eat.replace(/^\w+:\s*/, ''), code: 'KeyR' };
  return { word: eat && hint.endsWith(eat) ? hint.slice(0, -eat.length).trimEnd() : hint, code: 'Space' };
}

/** The small button while building: it puts the thing under the cursor back in the bag (UI's footer says the same). */
const PICK_UP = 'Pick up';

/** The word after a key's picture in a mini-game's key line: in "{left}{right} Move   {Space} Hit", Space is "Hit". */
function keyWord(line: string, key: string): string {
  return new RegExp(`\\{${key}\\}\\s*([^{]*)`).exec(line)?.[1]?.trim() ?? '';
}

/**
 * Issue 19: in a mini-game the two buttons say what they do there. The start card: Go, and Back for "Not now"; the end
 * card: OK (X does the same, so it goes). While it runs, the words of the game's own key line (Hit, Jump, Throw, Pick)
 * and X only where the line gives it a word. The targets give X "Shoot" and shoot on Space too: one Shoot button.
 */
export function miniWords(st: number, line: string): { space: string; x: string } {
  if (st === 0) return { space: S('touch_go'), x: S('touch_back') };
  if (st === 2) return { space: S('touch_ok'), x: '' };
  const space = keyWord(line, 'Space');
  const x = keyWord(line, 'X');
  return space ? { space, x } : { space: x, x: '' };
}

/**
 * Issue 21: fishing. X stops it, so the small button says Back (never Bow), and the big one says Catch only while a
 * fish bites: a tap before the splash only makes the float settle again. Null when she is not fishing.
 */
export function fishWords(g: Game): { space: string; x: string } | null {
  if (g.rt.mode !== 'fishing') return null;
  return { space: g.rt.fish?.st === 2 ? 'Catch' : '', x: S('touch_back') };
}

/** The map takes Space only when it is the travel map and a signpost has been found. */
function mapPicks(o: MapMenu): boolean {
  const m = o as unknown as { travel: boolean; signs: string[] };
  return m.travel && m.signs.length > 0;
}

/** Words and which buttons show, a few times a second. */
function refresh(): void {
  const w = where();
  const g = theGame();
  const ui = active('UI') as UiLike | null;
  let sw = '';
  let sc = 'Space';
  let xw = S('touch_back');
  if (w === 'title') sw = S('touch_go');
  else if (w === 'pass') sw = S('touch_go');
  else if (w === 'hero') sw = S('touch_play');
  else if (w === 'menu') sw = S('touch_pick');
  else if (w === 'talk' || w === 'cut') sw = S('touch_next');
  else if (w === 'card') sw = S('touch_ok');
  else if (w === 'play') {
    const action = worldTouchAction(ui?.hintKey ?? '', ui?.eatLabel ?? '');
    sw = action.word;
    sc = action.code;
    xw = g && toolTier(g, 'bow') > 0 ? S('touch_bow') : '';
    // building (package 67): X picks the placed thing up again and building goes on, so it says so (issue 63)
    if (g?.rt.mode === 'build') xw = PICK_UP;
    // "Put it on?": the big button puts the new gear on (issue 68)
    if (ui?.askWord) {
      sw = ui.askWord;
      sc = 'Space';
    }
    const fish = g ? fishWords(g) : null;
    if (fish) {
      sw = fish.space;
      sc = 'Space';
      xw = fish.x;
    }
  }
  // a story scene's own talk or card: X still skips the scene when held, as the corner says (issue 19)
  if (w === 'cut' || (g?.rt.cut && (w === 'talk' || w === 'card') && canSkip(g))) xw = S('touch_skip');
  const mini = w === 'mini' ? g?.rt.mini : null;
  if (mini) {
    const words = miniWords(mini.st, S(`keys:${mini.game}`));
    sw = words.space;
    xw = words.x;
  }
  // the shared place says what Space does there: Swing, Bounce, Bat, Go (package 67)
  if (w === 'meet') sw = (active('MeetHud') as { spaceWord?: string } | null)?.spaceWord ?? '';
  if (w === 'meet') xw = '';
  spaceCode = sc;
  // the saved games say "Go: yes, delete it" in the pause menu too
  if (w === 'menu' && openSlotsPanel()) sw = S('touch_go');
  // the plain map (not travelling to a signpost) has nothing for Pick to do (issue 22)
  const pickless = w === 'menu' && ui?.overlay instanceof MapMenu && !mapPicks(ui.overlay);
  if (pickless) sw = '';
  spaceEl.classList.toggle('hide', pickless);
  if ((w === 'menu') !== inMenu || pickless !== noPick) {
    inMenu = w === 'menu';
    noPick = pickless;
    layout();
  }
  if (sw !== spaceWord) {
    spaceWord = sw;
    spaceEl.textContent = sw;
    spaceEl.style.fontSize = sw.length > 7 ? '20px' : '26px';
  }
  if (xw !== xWord) {
    xWord = xw;
    xEl.textContent = xw;
    xEl.style.fontSize = xw.length > 5 ? '16px' : '20px';
  }
  xEl.classList.toggle('hide', !xw && !held.has('KeyX'));
  rowEl.classList.toggle('hide', w !== 'play');
  const paused = w === 'menu' && ui?.overlay instanceof PauseMenu;
  const full = !paused || !game.scale.fullscreen.available || game.scale.isFullscreen;
  if (full !== fullEl.classList.contains('hide')) {
    fullEl.classList.toggle('hide', full);
    if (!full) layout();
  }
}

// ---------------------------------------------------------------- taps on menus: move there and pick

type Box = { x: number; y: number; w: number; h: number };
const inBox = (b: Box, x: number, y: number, pad = 0) =>
  x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad;

function shown(o: Phaser.GameObjects.GameObject): boolean {
  let c: Phaser.GameObjects.GameObject | null = o;
  while (c) {
    const v = c as unknown as { visible: boolean; alpha: number };
    if (!v.visible || v.alpha <= 0.05) return false;
    c = (c as unknown as { parentContainer: Phaser.GameObjects.Container | null }).parentContainer;
  }
  return true;
}
/** Every shown object under a container or a scene, containers opened. */
function walk(list: Phaser.GameObjects.GameObject[], out: Phaser.GameObjects.GameObject[] = []) {
  for (const o of list) {
    if (!shown(o)) continue;
    out.push(o);
    if (o instanceof Phaser.GameObjects.Container) walk(o.list, out);
  }
  return out;
}
/** The panels and slots drawn into these objects' Graphics, on the game screen. */
function boxes(objs: Phaser.GameObjects.GameObject[]): DrawnBox[] {
  const out: DrawnBox[] = [];
  for (const o of objs) {
    if (!(o instanceof Phaser.GameObjects.Graphics)) continue;
    const list = drawn.boxes.get(o);
    if (!list) continue;
    const m = o.getWorldTransformMatrix();
    for (const b of list) out.push({ ...b, x: b.x + m.tx, y: b.y + m.ty });
  }
  return out;
}
/** A menu row marks the chosen one with an arrow in front ("▶ " or ">  "). */
const marked = (t: Phaser.GameObjects.Text) => /^\s*[▶>]/.test(t.text);

/** Which way the tapped thing lies from the chosen one (0, 0: it is chosen) and where the chosen one is; null stops. */
type Aim = () => { dx: number; dy: number; at: string } | null;
let steer: { aim: Aim; pick: string; n: number; wait: number; last: string; still: number } | null = null;

function startSteer(aim: Aim, pick = 'Space'): void {
  steer = { aim, pick, n: 0, wait: 0, last: '', still: 0 };
}
/** One step of moving to the tapped row: an arrow press every third step, then Space. */
function steerStep(): void {
  if (!steer) return;
  if (steer.wait-- > 0) return;
  const a = steer.aim();
  if (!a || steer.n > 30) {
    steer = null;
    return;
  }
  if (!a.dx && !a.dy) {
    press(steer.pick);
    steer = null;
    return;
  }
  steer.still = a.at === steer.last ? steer.still + 1 : 0;
  steer.last = a.at;
  // the choice has not moved after 2 presses: this menu does not move that way, so stop rather than pick wrongly
  if (steer.still >= 2) {
    steer = null;
    return;
  }
  press(a.dy ? (a.dy < 0 ? 'ArrowUp' : 'ArrowDown') : a.dx < 0 ? 'ArrowLeft' : 'ArrowRight');
  steer.n++;
  steer.wait = 3;
}

/**
 * Issue 41: which of a column of rows (their centres, top to bottom, each `h` high) a finger at `y` is on: the nearest
 * one, out to half the gap to the next row, so the whole column answers taps and no two rows share a spot. -1 for
 * none (above the first or below the last by more than that).
 */
export function nearestRow(centres: number[], y: number, h: number): number {
  let pitch = Infinity;
  for (let i = 1; i < centres.length; i++) pitch = Math.min(pitch, Math.abs(centres[i]! - centres[i - 1]!));
  const reach = Math.max(h / 2 + 8, Number.isFinite(pitch) ? pitch / 2 : 0);
  let best = -1;
  centres.forEach((c, i) => {
    if (Math.abs(y - c) <= reach && (best < 0 || Math.abs(y - c) < Math.abs(y - centres[best]!))) best = i;
  });
  return best;
}

/**
 * Issue 54: the key a tap on a row ends with. A number row ("Music:  4 of 10") goes down a step for a tap on its left
 * half and up for its right half (the title shows - and + at its ends); any other row is picked with Space.
 */
export function rowPick(label: string, gx: number, centreX: number): string {
  if (!/\d+ of \d+/.test(label)) return 'Space';
  return gx < centreX ? 'ArrowLeft' : 'ArrowRight';
}

/** Rows marked with an arrow, in these objects: aim at the row under y, and the key that ends the tap there. */
function rowAim(get: () => Phaser.GameObjects.GameObject[], gx: number, gy: number): { aim: Aim; pick: string } | null {
  const rows = () => {
    const texts = get().filter((o): o is Phaser.GameObjects.Text => o instanceof Phaser.GameObjects.Text);
    const sel = texts.find(marked);
    if (!sel) return null;
    const size = sel.style.fontSize;
    const list = texts.filter(
      (t) => Math.abs(t.x - sel.x) < 4 && t.originX === sel.originX && t.style.fontSize === size && t.text.trim(),
    );
    return { sel, list };
  };
  const r = rows();
  if (!r) return null;
  const list = r.list.filter((t) => Math.abs(gx - t.getBounds().centerX) < 640);
  const hit =
    list[
      nearestRow(
        list.map((t) => t.getBounds().centerY),
        gy,
        r.sel.getBounds().height,
      )
    ];
  if (!hit) return null;
  const ty = hit.getBounds().centerY;
  const aim: Aim = () => {
    const now = rows();
    if (!now) return null;
    const sy = now.sel.getBounds().centerY;
    return { dx: 0, dy: Math.abs(sy - ty) < 6 ? 0 : Math.sign(ty - sy), at: String(Math.round(sy)) };
  };
  return { aim, pick: rowPick(hit.text, gx, hit.getBounds().centerX) };
}
/** Cells drawn with kit.slot(): aim at the cell under the finger. */
function slotAim(get: () => Phaser.GameObjects.GameObject[], gx: number, gy: number): Aim | null {
  const cells = () => boxes(get()).filter((b) => b.slot);
  const hit = cells().find((b) => inBox(b, gx, gy, 4));
  if (!hit) return null;
  return () => {
    const now = cells();
    const sel = now.find((b) => b.on);
    if (!sel) return null;
    const ddx = hit.x - sel.x;
    const ddy = hit.y - sel.y;
    const at = `${Math.round(sel.x)},${Math.round(sel.y)}`;
    if (Math.abs(ddx) < 4 && Math.abs(ddy) < 4) return { dx: 0, dy: 0, at };
    return Math.abs(ddy) > sel.h / 2 ? { dx: 0, dy: Math.sign(ddy), at } : { dx: Math.sign(ddx), dy: 0, at };
  };
}

/** A tap on the game screen (client pixels). */
function tap(cx: number, cy: number): void {
  if (active('Boot')) {
    press('Space');
    return;
  }
  const [gx, gy] = toGame(cx, cy);
  // the saved games (title Options or the pause menu) take every tap while open, so the rows behind are out of reach
  const saves = openSlotsPanel();
  if (saves) {
    saves.tap(gx, gy);
    return;
  }
  const w = where();
  if (w === 'title' || w === 'pass') {
    const t = active('Title') as TitleLike;
    if (t.mode === 'replace') {
      t.selectReplacementAt(gx, gy);
      return;
    }
    if (t.credit?.visible && t.credit.getBounds().contains(gx, gy)) {
      openCredit();
      return;
    }
    const p = t.picker;
    if (t.mode === 'who' && p) {
      if (p.step === 'pass') {
        typing.open();
        return;
      }
      const row = p.rowAt(gx, gy);
      if (row < 0) return;
      if (row !== p.sel) p.move(row - p.sel);
      // the password boxes come next: the iPad's keyboard can only be opened inside the tap itself
      typing.open();
      press('Enter');
      return;
    }
    const row = rowAim(() => walk(t.children.list), gx, gy);
    if (row) startSteer(row.aim, row.pick);
    return;
  }
  if (w === 'hero') {
    const h = active('HeroSelect') as HeroLike;
    if (gy > H - 200) {
      press('Space');
      return;
    }
    const i = h.puppets.findIndex((p) => p.sprite.getBounds().contains(gx, gy));
    if (i < 0) return;
    const n = h.ids.length;
    startSteer(() => {
      const d = (i - h.sel + n) % n;
      return { dx: d === 0 ? 0 : d <= n / 2 ? 1 : -1, dy: 0, at: String(h.sel) };
    });
    return;
  }
  const ui = active('UI') as UiLike | null;
  const g = theGame();
  if (!ui || !g) return;
  if (w === 'menu') {
    const o = ui.overlay;
    if (!o) return;
    if (o.tap?.(gx, gy)) return;
    const objs = () => (o.root.active ? walk(o.root.list) : []);
    const panels = boxes(objs()).filter((b) => !b.slot);
    if (panels.length && !panels.some((b) => inBox(b, gx, gy))) {
      press('KeyX');
      return;
    }
    const cell = slotAim(objs, gx, gy);
    const row = cell ? null : rowAim(objs, gx, gy);
    if (cell) startSteer(cell);
    else if (row) startSteer(row.aim, row.pick);
    return;
  }
  if (w === 'talk') {
    const talk = g.rt.talk;
    if (talk?.choices && talk.shown >= talk.text.length) {
      const list = ui.dlgChoices.filter(shown);
      const at =
        gx > 240 && gx < 1680
          ? nearestRow(
              list.map((c) => c.getBounds().centerY),
              gy,
              list[0]?.height ?? 0,
            )
          : -1;
      const i = at < 0 ? -1 : ui.dlgChoices.indexOf(list[at]!);
      if (i < 0) return;
      startSteer(() => {
        const t = g.rt.talk;
        if (!t?.choices) return null;
        return { dx: 0, dy: Math.sign(i - t.pick), at: String(t.pick) };
      });
      return;
    }
    press('Space');
    return;
  }
  if (w === 'card' || w === 'cut') {
    press('Space');
    return;
  }
  if (w === 'mini') {
    if (ui.miniTap(gx, gy)) return;
    // a mini-game's start or end card: a tap on it is Space
    const panels = boxes(walk(ui.children.list)).filter((b) => !b.slot && b.w > 900);
    if (panels.some((b) => inBox(b, gx, gy))) press('Space');
    return;
  }
  if (w === 'play') {
    // the HUD's journal and map pictures, the Help word, the building strip (package 67)
    const k = ui.hudTap(gx, gy);
    if (k) {
      if (k !== 'done') press(k);
      return;
    }
    // the hotbar (the Graphics with 8 cells along the bottom): a tap picks the slot, a tap on the picked slot uses it
    for (const o of walk(ui.children.list)) {
      if (!(o instanceof Phaser.GameObjects.Graphics)) continue;
      const cells = boxes([o]).filter((b) => b.slot && b.y > H - 140);
      if (cells.length !== 8) continue;
      cells.sort((a, b) => a.x - b.x);
      const i = cells.findIndex((b) => inBox(b, gx, gy, 3));
      if (i < 0) continue;
      press(cells[i]!.on ? 'KeyR' : `Digit${i + 1}`);
      return;
    }
  }
}

// ---------------------------------------------------------------- fingers

const DEAD = 16;
const LET_GO = 11;
interface Finger {
  id: number;
  x0: number;
  y0: number;
  t0: number;
  far: boolean;
  stick: boolean;
  bx: number;
  by: number;
  dir: string;
  /** counts this finger's pushes on the stick, so a late "let go" never cuts a newer push short */
  push: number;
}
const fingers = new Map<number, Finger>();
const onButton = new Map<number, string>();

/**
 * The arrow key for a thumb `dx, dy` pixels from the stick's centre, given the one held now ('' for none): a dead
 * zone in the middle (a little smaller to let go than to start), and on the diagonal the held direction stays until
 * the other axis clearly wins, so it never flickers between two.
 */
export function stickDirection(dx: number, dy: number, held: string): string {
  const d = Math.hypot(dx, dy);
  if (d < (held ? LET_GO : DEAD)) return '';
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const horiz = held === 'ArrowLeft' || held === 'ArrowRight';
  const vert = held === 'ArrowUp' || held === 'ArrowDown';
  const useX = horiz ? ax * 1.35 >= ay : vert ? ax > ay * 1.35 : ax >= ay;
  return useX ? (dx < 0 ? 'ArrowLeft' : 'ArrowRight') : dy < 0 ? 'ArrowUp' : 'ArrowDown';
}

function stickDir(f: Finger, x: number, y: number): void {
  let dx = x - f.bx;
  let dy = y - f.by;
  let d = Math.hypot(dx, dy);
  // the stick follows a thumb that slides past its edge
  const R = 60;
  if (d > R) {
    f.bx += (dx / d) * (d - R);
    f.by += (dy / d) * (d - R);
    dx = x - f.bx;
    dy = y - f.by;
    d = R;
  }
  stickEl.style.left = `${f.bx}px`;
  stickEl.style.top = `${f.by}px`;
  knobEl.style.transform = `translate(${dx}px,${dy}px)`;
  const dir = stickDirection(dx, dy, f.dir);
  if (dir !== f.dir) {
    if (f.dir) up(f.dir);
    if (dir) down(dir);
    f.dir = dir;
    // Issue 59: in the minecart a held lean moves the cart again every 0.2 s, so a held thumb crossed two rails. On the
    // stick one push is one rail: the key goes up again after 9 steps (0.15 s), before the cart would repeat it; a
    // second push, even a quick one, is a second rail. Keys on a keyboard still repeat as before.
    const id = ++f.push;
    if (dir && onePush()) after(9, () => f.push === id && up(dir));
  }
}

/** The minecart is running: the stick gives one lean per push. */
function onePush(): boolean {
  const m = theGame()?.rt.mini;
  return where() === 'mini' && m?.game === 'minecart' && m.st === 1;
}

/** The displayed food hint can lag behind the game state for a few frames. */
export function foodActionAvailable(g: Game | null): boolean {
  return !!g && g.rt.mode === 'play' && !!g.rt.eatHint && g.s.hp <= LOW_HP && g.s.hp < g.s.maxHp && bestFood(g) >= 0;
}

function buttonCode(b: string): string {
  const w = where();
  if (b === 'Space') return w === 'pass' ? 'Enter' : w === 'play' ? spaceCode : 'Space';
  if (b === 'KeyX') return w === 'pass' ? 'Escape' : 'KeyX';
  return b;
}

function onDown(e: PointerEvent): void {
  if (e.pointerType === 'mouse') return;
  show(true);
  Sound.wake();
  const t = e.target as HTMLElement;
  const b = t.closest?.('[data-key]') as HTMLElement | null;
  if (b && root.contains(b)) {
    e.preventDefault();
    e.stopPropagation();
    if (b.dataset.key === 'full') return;
    const code = buttonCode(b.dataset.key!);
    if (b.dataset.key === 'Space' && code === 'KeyR' && !foodActionAvailable(theGame())) {
      onButton.set(e.pointerId, '');
      return;
    }
    onButton.set(e.pointerId, code);
    pressedAt.set(e.pointerId, e.timeStamp);
    b.classList.add('press');
    steer = null;
    down(code);
    return;
  }
  if (t.closest?.('#touch-card') || (t as HTMLElement).tagName === 'INPUT') return;
  e.preventDefault();
  e.stopPropagation();
  fingers.set(e.pointerId, {
    id: e.pointerId,
    x0: e.clientX,
    y0: e.clientY,
    t0: e.timeStamp,
    far: false,
    stick: e.clientX < window.innerWidth / 2,
    bx: e.clientX,
    by: e.clientY,
    dir: '',
    push: 0,
  });
}
function onMove(e: PointerEvent): void {
  const f = fingers.get(e.pointerId);
  if (!f) return;
  e.preventDefault();
  e.stopPropagation();
  if (!f.far && Math.hypot(e.clientX - f.x0, e.clientY - f.y0) > 14) f.far = true;
  if (!f.stick || !f.far) return;
  stickEl.classList.add('show');
  steer = null;
  stickDir(f, e.clientX, e.clientY);
}
function onUp(e: PointerEvent): void {
  const code = onButton.get(e.pointerId);
  if (code !== undefined) {
    onButton.delete(e.pointerId);
    const t0 = pressedAt.get(e.pointerId) ?? 0;
    pressedAt.delete(e.pointerId);
    e.preventDefault();
    e.stopPropagation();
    for (const b of root.querySelectorAll('.press')) b.classList.remove('press');
    // a quick tap stays down for two game steps, so the game sees it however fast the finger lifts
    if (e.timeStamp - t0 < 60) after(2, () => up(code));
    else up(code);
    return;
  }
  const t = e.target as HTMLElement;
  if (t.closest?.('[data-key="full"]')) {
    // full screen must start inside the tap itself (iPad Safari)
    e.preventDefault();
    e.stopPropagation();
    if (!game.scale.isFullscreen) game.scale.startFullscreen();
    return;
  }
  const f = fingers.get(e.pointerId);
  if (!f) return;
  fingers.delete(e.pointerId);
  e.preventDefault();
  e.stopPropagation();
  if (f.dir) up(f.dir);
  if (f.stick && f.far) stickEl.classList.remove('show');
  if (e.type === 'pointerup' && f.far && dropInMenu(f.x0, f.y0, e.clientX, e.clientY)) return;
  if (e.type === 'pointerup' && !f.far && e.timeStamp - f.t0 < 700) tap(f.x0, f.y0);
  else if (e.type === 'pointerup' && !f.far) holdInMenu(f.x0, f.y0);
}

/** Package 74: a long press in a menu that takes one (the bag: pins the thing on a bottom button). */
function holdInMenu(x: number, y: number): boolean {
  const o = where() === 'menu' ? (active('UI') as UiLike | null)?.overlay : null;
  if (!o?.hold) return false;
  const [gx, gy] = toGame(x, y);
  return o.hold(gx, gy);
}

/** Package 71: a drag let go in a menu that takes one (the bag: a thing dragged onto a bottom button goes there). */
function dropInMenu(x0: number, y0: number, x1: number, y1: number): boolean {
  const o = where() === 'menu' ? (active('UI') as UiLike | null)?.overlay : null;
  if (!o?.drop) return false;
  const [ax, ay] = toGame(x0, y0);
  const [bx, by] = toGame(x1, y1);
  return o.drop(ax, ay, bx, by);
}

/** Show or hide the controls. Shown on the first touch; a key from a real keyboard hides them again. */
function show(on: boolean): void {
  if (touchState.shown === on) return;
  touchState.shown = on;
  root.classList.toggle('on', on);
  if (!on) {
    releaseAll();
    steer = null;
    stickEl.classList.remove('show');
    fingers.clear();
    onButton.clear();
  } else {
    layout();
    refresh();
  }
}

let asleep = false;
/** Held upright: the turn card, and the game waits. */
function upright(): void {
  if (!touchState.shown && !touchFirst()) return;
  const tall = window.innerHeight > window.innerWidth;
  card('turn', S('touch_turn'), tall);
  if (tall) {
    if (!asleep) releaseAll();
    asleep = true;
    // asked again each time: Phaser starts its loop when the page shows again
    game.loop.sleep();
  } else if (asleep) {
    asleep = false;
    game.loop.wake();
  }
}

/** Fewer effects is on by default on a touch device: once per device, so she can still turn it off. */
function lowFxOnce(): void {
  const g = theGame();
  if (!g) return;
  try {
    if (localStorage.getItem('ws_touch_fx')) return;
    localStorage.setItem('ws_touch_fx', '1');
  } catch {
    return;
  }
  g.s.opts.lowFx = true;
}

export function installTouch(g: Phaser.Game): void {
  game = g;
  touchState.device = touchCapable();
  if (!touchState.device) return;
  drawn.on = true;
  // a Graphics that is cleared forgets the panels and slots drawn into it
  const proto = Phaser.GameObjects.Graphics.prototype;
  const clear0 = proto.clear;
  proto.clear = function (this: Phaser.GameObjects.Graphics) {
    drawn.boxes.delete(this);
    return clear0.call(this);
  };
  card('turn', '', false);
  root = document.createElement('div');
  root.id = 'touch';
  document.body.appendChild(root);
  stickEl = el('stick', root);
  knobEl = el('knob', stickEl);
  spaceEl = el('b space', root);
  spaceEl.dataset.key = 'Space';
  xEl = el('b x', root);
  xEl.dataset.key = 'KeyX';
  rowEl = el('row hide', root);
  fullEl = el('b full hide', root);
  fullEl.dataset.key = 'full';
  fullEl.textContent = S('touch_full');
  const row: [string, string][] = [
    ['KeyE', 'chest'],
    ['KeyQ', 'sticker_book'],
    ['KeyM', 'dads_map'],
    ['KeyH', 'star_lamp'],
    ['KeyP', ''],
  ];
  for (const [code, frame] of row) {
    const b = el(frame ? 'b' : 'b pause', rowEl);
    b.dataset.key = code;
    if (frame) {
      const img = document.createElement('img');
      img.alt = '';
      img.draggable = false;
      b.appendChild(img);
      b.dataset.frame = frame;
    }
  }
  const pictures = () => {
    for (const b of rowEl.querySelectorAll<HTMLElement>('[data-frame]')) {
      const img = b.firstChild as HTMLImageElement;
      if (img.src) continue;
      const k = atlasOf(b.dataset.frame!);
      if (k) img.src = pic(k, b.dataset.frame);
    }
  };
  window.addEventListener('pointerdown', onDown, { capture: true, passive: false });
  window.addEventListener('pointermove', onMove, { capture: true, passive: false });
  window.addEventListener('pointerup', onUp, { capture: true, passive: false });
  window.addEventListener('pointercancel', onUp, { capture: true, passive: false });
  // a second chance for the things iOS allows only inside a touch: sound, and the keyboard for the password
  window.addEventListener(
    'touchend',
    () => {
      Sound.wake();
      const ctx = (game.sound as Phaser.Sound.WebAudioSoundManager).context;
      if (ctx && ctx.state !== 'running' && !document.hidden) void ctx.resume();
      if (where() === 'pass') typing.open();
    },
    { capture: true, passive: true },
  );
  // no long-press menu, no double-tap zoom, no pinch (iPad Safari ignores user-scalable)
  for (const ev of ['gesturestart', 'gesturechange', 'contextmenu', 'dblclick'])
    document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
  // a held finger must not select the words drawn in the game (iPad Safari reads text out of the canvas and offers
  // Copy, Translate, Find): no default touch on the game itself; the name box, typed fields and real buttons keep theirs
  for (const ev of ['touchstart', 'touchmove'])
    document.addEventListener(
      ev,
      (e) => {
        const t = e.target as Element | null;
        if (t?.closest?.('input, textarea, button, select, #name-entry')) return;
        if (e.cancelable) e.preventDefault();
      },
      { passive: false },
    );
  document.addEventListener('selectstart', (e) => {
    if (!(e.target as Element | null)?.closest?.('input, textarea')) e.preventDefault();
  });
  window.addEventListener(
    'keydown',
    (e) => {
      // a key from a real keyboard (not ours, not the password box) puts the controls away
      if (e.isTrusted && !(e.target instanceof HTMLInputElement)) show(false);
    },
    { capture: true },
  );
  window.addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) releaseAll();
    else setTimeout(upright, 50);
  });
  game.events.once('ready', upright);
  const relayout = () => {
    if (touchState.shown) layout();
    upright();
  };
  window.addEventListener('resize', relayout);
  window.addEventListener('orientationchange', relayout);
  let n = 0;
  game.events.on('poststep', () => {
    for (let i = later.length - 1; i >= 0; i--) {
      const j = later[i]!;
      if (--j.n <= 0) {
        later.splice(i, 1);
        j.f();
      }
    }
    steerStep();
    if (!touchState.shown || ++n % 6) return;
    refresh();
    if (n % 60 === 0) {
      pictures();
      lowFxOnce();
    }
  });
  if (touchFirst()) show(true);
  upright();
}
