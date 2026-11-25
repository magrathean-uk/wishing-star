// The shared place's screen layer (package 66): the hero chooser for a player with no game yet, the chat line and
// its log, the six ready phrases, the quiet join and leave strip, Keepy Uppy's count, the race's 3, 2, 1 and the
// "Back to the title?" menu. It holds the game's keys while the chat line or the menu is open.
//
// Keys are read before Phaser sees them (a listener on the window in the capture phase): Enter opens the chat line,
// 1 to 6 send a ready phrase, Escape or P opens the menu. Taps and clicks on the buttons are read on the canvas, so the
// iPad's keyboard comes up from the same tap that opened the line (it needs a real input focused in that tap).
import Phaser from 'phaser';
import { app } from '../app.ts';
import { Sound } from '../audio.ts';
import { touchState } from '../input.ts';
import { heroAllowed, showCredit } from '../net.ts';
import { Puppet } from '../puppet.ts';
import { slotInfo } from '../save.ts';
import { H, INK, outlined, panel, text, title, type Txt, W } from '../ui/kit.ts';
import { creditLine } from '../ui/players.ts';
import type { Meet } from './Meet.ts';

const S = (k: string) => app.content.strings[k] ?? '';
const PHRASES = 6;
const CHAT_MAX = 60;

interface Button {
  x: number;
  y: number;
  w: number;
  h: number;
  act: () => void;
  g: Phaser.GameObjects.Graphics;
  t: Txt;
}

/** The hero this player plays in the place: the one in their story save, if they may be it. */
export function savedHero(): string {
  const info = slotInfo(app.content, 1);
  return info && app.content.heroes[info.hero] && heroAllowed(info.hero) ? info.hero : '';
}

/** The Space button's one word for the place's own actions (package 67). */
const SHORT: Record<string, string> = { meet_hit: 'touch_bat', meet_keepy_go: 'touch_play', meet_race_go: 'touch_go' };

export class MeetHud extends Phaser.Scene {
  private meet!: Meet;
  private mode: 'pick' | 'wait' | 'play' | 'menu' | 'chat' | 'bye' = 'wait';
  // the hero chooser
  private heroes: string[] = [];
  private pickSel = 0;
  private pickPuppets: Puppet[] = [];
  private pickBox: Phaser.GameObjects.Container | null = null;
  private pickMark: Phaser.GameObjects.Graphics | null = null;
  // messages
  private strip!: Txt;
  private stripT = 0;
  private big!: Txt;
  private bigT = 0;
  private count!: Txt;
  private hint!: Txt;
  private help!: Txt;
  private log: Txt[] = [];
  private lines: string[] = [];
  // the chat line
  private field: HTMLInputElement | null = null;
  private lineBox!: Phaser.GameObjects.Container;
  private lineText!: Txt;
  private lineHelp!: Txt;
  // buttons and the menu
  private buttons: Button[] = [];
  private menuBox: Phaser.GameObjects.Container | null = null;
  private byeT = 0;
  private onKey: ((e: KeyboardEvent) => void) | null = null;
  private onTap: ((e: PointerEvent) => void) | null = null;
  private t = 0;
  /** package 67: the word for the iPad's Space button here ("Swing", "Bounce", "Bat", "Go"), read by src/game/touch.ts */
  spaceWord = '';
  private touchBtns = false;

  constructor() {
    super('MeetHud');
  }

  create(data: { meet: Meet }): void {
    this.meet = data.meet;
    this.buttons = [];
    this.log = [];
    this.lines = [];
    this.pickPuppets = [];
    this.pickBox = null;
    this.menuBox = null;
    this.byeT = 0;
    this.strip = outlined(this, W / 2, 24, '', 30)
      .setOrigin(0.5, 0)
      .setAlpha(0);
    this.big = outlined(this, W / 2, H / 2 - 160, '', 64)
      .setOrigin(0.5, 0.5)
      .setVisible(false);
    this.count = outlined(this, W / 2, 110, '', 72)
      .setOrigin(0.5, 0)
      .setVisible(false);
    this.hint = outlined(this, W - 40, H - 40, '', 30).setOrigin(1, 1);
    this.help = outlined(this, W / 2, H - 14, '', 22)
      .setOrigin(0.5, 1)
      .setAlpha(0.8);
    for (let i = 0; i < 3; i++)
      this.log.push(
        outlined(this, 28, H - 150 + i * 34, '', 24)
          .setOrigin(0, 0)
          .setAlpha(0.72),
      );
    this.makeLine();
    this.makeButtons();
    if (showCredit()) creditLine(this, true).setDepth(0);
    this.listen();
    this.meet.events.on('chatline', (id: string, line: string) => this.addLog(id, line));
    this.events.once('shutdown', () => this.cleanUp());
    if (this.meet.hero) this.wait();
    else {
      const saved = savedHero();
      if (saved) {
        this.wait();
        void this.meet.connect(saved);
      } else this.showPicker();
    }
  }

  // ---------------------------------------------------------------- the hero chooser
  private showPicker(): void {
    this.mode = 'pick';
    this.heroes = Object.values(app.content.heroes)
      .filter((h) => h.starter && heroAllowed(h.id))
      .map((h) => h.id);
    const box = this.add.container(0, 0).setDepth(50);
    const g = this.add.graphics();
    g.fillStyle(0x16204a, 0.92).fillRect(0, 0, W, H);
    box.add(g);
    box.add(title(this, W / 2, 140, S('meet_pick'), 64, '#ffffff').setOrigin(0.5, 0));
    box.add(
      outlined(this, W / 2, H - 90, S(touchState.device ? 'meet_pick_tap' : 'meet_pick_keys'), 30).setOrigin(0.5, 0),
    );
    this.pickBox = box;
    this.pickMark = this.add.graphics().setDepth(55);
    box.add(this.pickMark);
    const gap = Math.min(260, (W - 200) / Math.max(1, this.heroes.length));
    this.heroes.forEach((id, i) => {
      const p = new Puppet(this, id, app.content.chars[id]?.tall ?? 2, true);
      p.zoom = 2.1;
      p.setPos(W / 2 + (i - (this.heroes.length - 1) / 2) * gap, H / 2 + 220);
      p.sprite.setDepth(60);
      this.pickPuppets.push(p);
    });
    this.pickSel = 0;
  }
  private pickAt(x: number, y: number): number {
    if (y < H / 2 - 100 || y > H / 2 + 260) return -1;
    let best = -1;
    let d = 140;
    this.pickPuppets.forEach((p, i) => {
      const dx = Math.abs(p.sprite.x - x);
      if (dx < d) {
        d = dx;
        best = i;
      }
    });
    return best;
  }
  private picked(): void {
    const id = this.heroes[this.pickSel];
    if (!id) return;
    Sound.sfx('pick');
    for (const p of this.pickPuppets) p.destroy();
    this.pickPuppets = [];
    this.pickBox?.destroy(true);
    this.pickBox = null;
    this.wait();
    void this.meet.connect(id);
  }

  private wait(): void {
    this.mode = 'wait';
    this.big.setText(S('meet_wait')).setVisible(true);
    this.bigT = 999;
  }

  // ---------------------------------------------------------------- the chat line
  private makeLine(): void {
    const g = this.add.graphics();
    panel(g, W / 2 - 560, H - 230, 1120, 130);
    this.lineText = text(this, W / 2 - 520, H - 214, '', 36, INK);
    this.lineHelp = text(this, W / 2 + 520, H - 150, S('meet_type_keys'), 24, '#7a5a35').setOrigin(1, 0);
    this.lineBox = this.add.container(0, 0, [g, this.lineText, this.lineHelp]).setDepth(40).setVisible(false);
    // a real input, out of sight: the iPad's keyboard comes up for it, and it holds what is typed
    const el = document.createElement('input');
    el.type = 'text';
    el.maxLength = CHAT_MAX;
    el.autocomplete = 'off';
    el.spellcheck = false;
    el.setAttribute('autocapitalize', 'sentences');
    el.setAttribute('autocorrect', 'on');
    el.setAttribute('enterkeyhint', 'send');
    el.setAttribute('aria-label', S('meet_type'));
    el.id = 'meet-chat';
    // 16 px so the iPad does not zoom; fixed and faint so it never shows, but it is a real, focusable box
    el.style.cssText =
      'position:fixed;left:0;bottom:0;width:2px;height:2px;opacity:0.01;font-size:16px;border:0;padding:0;' +
      'background:transparent;color:transparent;z-index:1;';
    el.addEventListener('input', () => this.showTyped());
    el.addEventListener('blur', () => {
      if (this.mode === 'chat') this.closeLine(false);
    });
    document.body.appendChild(el);
    this.field = el;
  }
  /** Opened from inside a key press or a tap: the focus must happen in that event for the iPad's keyboard. */
  private openLine(): void {
    if (this.mode !== 'play' || !this.field) return;
    if (!this.meet.chatOn) {
      this.say(S('meet_chat_off'));
      return;
    }
    this.mode = 'chat';
    this.meet.frozen = true;
    this.meet.keys.reset();
    this.field.value = '';
    this.field.focus({ preventScroll: true });
    this.lineHelp.setText(S(touchState.device ? 'meet_type_keys_tap' : 'meet_type_keys'));
    this.showTyped();
    this.lineBox.setVisible(true);
  }
  private showTyped(): void {
    const v = this.field?.value ?? '';
    this.lineText.setText(`${v}${Math.floor(this.t * 2) % 2 ? '|' : ' '}`);
  }
  private closeLine(send: boolean): void {
    if (this.mode !== 'chat') return;
    const v = (this.field?.value ?? '').trim();
    this.mode = 'play';
    this.meet.frozen = false;
    this.meet.keys.reset();
    this.lineBox.setVisible(false);
    if (this.field) {
      this.field.value = '';
      this.field.blur();
    }
    if (send && v) {
      this.meet.say(v.slice(0, CHAT_MAX));
      Sound.sfx('tick');
    }
  }

  // ---------------------------------------------------------------- buttons: Back, Type and the six phrases
  private makeButtons(): void {
    const add = (x: number, y: number, w: number, h: number, label: string, act: () => void, size = 26) => {
      const g = this.add.graphics().setDepth(30);
      g.fillStyle(0x23306e, 0.55).fillRoundedRect(x, y, w, h, 16);
      g.lineStyle(3, 0xffffff, 0.6).strokeRoundedRect(x, y, w, h, 16);
      const t = outlined(this, x + w / 2, y + h / 2, label, size)
        .setOrigin(0.5, 0.5)
        .setDepth(31);
      this.buttons.push({ x, y, w, h, act, g, t });
    };
    add(24, 24, 150, 64, S('meet_back_btn'), () => this.openMenu());
    const x = W - 300;
    add(x, 250, 276, 70, S('meet_type_btn'), () => this.openLine(), 28);
    for (let i = 0; i < PHRASES; i++)
      add(x, 340 + i * 70, 276, 60, `${i + 1}  ${S(`meet_ph${i + 1}`)}`, () => this.phrase(i), 24);
    for (const b of this.buttons) {
      b.g.setVisible(false);
      b.t.setVisible(false);
    }
  }
  /**
   * Back always; Type and the six phrases only with the touch layer on (package 67): on a laptop Enter and 1 to 6 do
   * them, and the hint line at the bottom says so.
   */
  private showButtons(on: boolean): void {
    this.touchBtns = touchState.shown;
    this.buttons.forEach((b, i) => {
      const v = on && (i === 0 || touchState.shown);
      b.g.setVisible(v);
      b.t.setVisible(v);
    });
  }
  private phrase(i: number): void {
    if (this.mode !== 'play') return;
    this.meet.phrase(i);
    Sound.sfx('tick');
  }

  // ---------------------------------------------------------------- the menu: back to the title
  private openMenu(): void {
    if (this.mode !== 'play') return;
    this.mode = 'menu';
    this.meet.frozen = true;
    const box = this.add.container(0, 0).setDepth(60);
    const g = this.add.graphics();
    g.fillStyle(0x10131f, 0.6).fillRect(0, 0, W, H);
    panel(g, W / 2 - 460, 380, 920, 300);
    box.add(g);
    box.add(title(this, W / 2, 430, S('meet_back_q'), 54).setOrigin(0.5, 0));
    box.add(
      text(this, W / 2, 560, S(touchState.device ? 'meet_back_tap' : 'pl_yes_no'), 32, '#7a5a35').setOrigin(0.5, 0),
    );
    this.menuBox = box;
  }
  private closeMenu(yes: boolean): void {
    this.menuBox?.destroy(true);
    this.menuBox = null;
    if (yes) {
      this.bye();
      return;
    }
    this.mode = 'play';
    this.meet.frozen = false;
    this.meet.keys.reset();
  }
  private bye(): void {
    this.mode = 'bye';
    this.meet.frozen = true;
    Sound.sfx('pick');
    this.meet.leave();
  }

  // ---------------------------------------------------------------- keys and taps
  private listen(): void {
    const canvas = this.game.canvas;
    this.onKey = (e: KeyboardEvent) => {
      if (!this.sys.isActive()) return;
      const take = () => {
        e.stopImmediatePropagation();
        e.preventDefault();
      };
      if (this.mode === 'chat') {
        // typing: every key goes to the line, none to the game
        e.stopImmediatePropagation();
        if (e.code === 'Enter' || e.key === 'Enter') {
          e.preventDefault();
          this.closeLine(true);
        } else if (e.code === 'Escape') {
          e.preventDefault();
          this.closeLine(false);
        }
        return;
      }
      if (e.repeat && this.mode !== 'pick') return;
      if (this.mode === 'pick') {
        take();
        if (e.code === 'ArrowLeft' || e.code === 'KeyA') this.pickSel = Math.max(0, this.pickSel - 1);
        else if (e.code === 'ArrowRight' || e.code === 'KeyD')
          this.pickSel = Math.min(this.heroes.length - 1, this.pickSel + 1);
        else if (e.code === 'Space' || e.code === 'Enter') this.picked();
        else if (e.code === 'Escape' || e.code === 'KeyX') this.bye();
        if (e.code.startsWith('Arrow') || e.code === 'KeyA' || e.code === 'KeyD') Sound.sfx('tick');
        return;
      }
      if (this.mode === 'menu') {
        take();
        if (e.code === 'Space' || e.code === 'Enter') this.closeMenu(true);
        else if (e.code === 'KeyX' || e.code === 'Escape' || e.code === 'Backspace' || e.code === 'KeyP')
          this.closeMenu(false);
        return;
      }
      if (this.mode !== 'play') {
        if (this.mode === 'wait' && (e.code === 'Escape' || e.code === 'KeyX')) {
          take();
          this.bye();
        }
        return;
      }
      if (e.code === 'Enter') {
        take();
        this.openLine();
      } else if (/^Digit[1-6]$/.test(e.code)) {
        take();
        this.phrase(Number(e.code.slice(5)) - 1);
      } else if (e.code === 'Escape' || e.code === 'KeyP') {
        take();
        this.openMenu();
      }
    };
    window.addEventListener('keydown', this.onKey, true);
    this.onTap = (e: PointerEvent) => {
      if (!this.sys.isActive()) return;
      const r = canvas.getBoundingClientRect();
      const x = ((e.clientX - r.left) * W) / r.width;
      const y = ((e.clientY - r.top) * H) / r.height;
      if (this.mode === 'pick') {
        const i = this.pickAt(x, y);
        if (i < 0) return;
        if (i === this.pickSel) this.picked();
        else this.pickSel = i;
        return;
      }
      if (this.mode === 'menu') {
        // a tap on the panel is yes, outside it is no
        this.closeMenu(x > W / 2 - 460 && x < W / 2 + 460 && y > 380 && y < 680);
        return;
      }
      if (this.mode !== 'play') return;
      for (const b of this.buttons)
        if (b.g.visible && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
          e.preventDefault();
          b.act();
          return;
        }
    };
    canvas.addEventListener('pointerup', this.onTap);
  }

  private cleanUp(): void {
    if (this.onKey) window.removeEventListener('keydown', this.onKey, true);
    if (this.onTap) this.game.canvas.removeEventListener('pointerup', this.onTap);
    this.onKey = null;
    this.onTap = null;
    this.field?.remove();
    this.field = null;
    for (const p of this.pickPuppets) p.destroy();
    this.pickPuppets = [];
    this.meet.events.off('chatline');
  }

  // ---------------------------------------------------------------- messages
  private say(line: string, secs = 3): void {
    this.strip.setText(line).setAlpha(1);
    this.stripT = secs;
  }
  private addLog(id: string, line: string): void {
    const who = this.meet.labelOf(id);
    this.lines.push(`${who}: ${line}`);
    if (this.lines.length > 3) this.lines.shift();
    this.log.forEach((t, i) => t.setText(this.lines[i] ?? ''));
  }
  /** A big line in the middle; `then` runs when it has gone. */
  private shout(line: string, secs: number): void {
    this.big.setText(line).setVisible(true).setAlpha(1);
    this.bigT = secs;
  }

  private notes(): void {
    for (const n of this.meet.notes.splice(0)) {
      switch (n.kind) {
        case 'join':
          this.say(S('meet_join').replace('{who}', n.who ?? ''));
          break;
        case 'leave':
          this.say(S('meet_leave').replace('{who}', n.who ?? ''));
          break;
        case 'no':
          this.say(S('meet_no'));
          Sound.sfx('nope', 0.6);
          break;
        case 'slow':
          this.say(S('pl_locked'));
          break;
        case 'muted':
          this.say(S('meet_muted'));
          break;
        case 'chatoff':
          this.say(S('meet_chat_off'));
          if (this.mode === 'chat') this.closeLine(false);
          break;
        case 'land':
          this.shout(S('meet_landed').replace('{n}', String(n.n ?? 0)), 2.2);
          break;
        case 'go':
          this.shout(S('meet_go'), 1);
          Sound.sfx('pick');
          break;
        case 'win':
          this.shout(S('meet_win').replace('{who}', n.who ?? ''), 3);
          break;
        case 'nowin':
          this.shout(S('meet_nowin'), 2);
          break;
        case 'offline':
        case 'login':
        case 'replaced':
          // the line is gone: one calm line, then back to the title
          if (this.mode === 'chat') this.closeLine(false);
          this.menuBox?.destroy(true);
          this.menuBox = null;
          this.mode = 'bye';
          this.meet.frozen = true;
          this.shout(S(n.kind === 'replaced' ? 'meet_replaced' : 'pl_offline'), 999);
          this.byeT = 2.6;
          break;
        default:
          break;
      }
    }
  }

  update(_time: number, delta: number): void {
    const dt = delta / 1000;
    this.t += dt;
    this.notes();
    if (this.byeT > 0) {
      this.byeT -= dt;
      if (this.byeT <= 0) this.meet.leave();
      return;
    }
    if (this.mode === 'pick') {
      const on = this.pickPuppets[this.pickSel];
      if (on && this.pickMark)
        this.pickMark
          .clear()
          .fillStyle(0xf2b84b, 0.35)
          .fillEllipse(on.sprite.x, H / 2 + 226, 210, 54)
          .lineStyle(5, 0xffe27a, 1)
          .strokeEllipse(on.sprite.x, H / 2 + 226, 210, 54);
      this.pickPuppets.forEach((p, i) => {
        p.play(i === this.pickSel ? 'wave' : 'idle', 'down');
        p.zoom = i === this.pickSel ? 2.4 : 2.0;
        p.update(dt);
      });
      return;
    }
    const g = this.meet.g;
    if (this.mode === 'wait' && g) {
      this.mode = 'play';
      this.big.setVisible(false);
      this.bigT = 0;
      this.showButtons(true);
    }
    if (this.stripT > 0) {
      this.stripT -= dt;
      this.strip.setAlpha(Math.min(1, this.stripT * 2));
    }
    if (this.bigT > 0 && this.bigT < 900) {
      this.bigT -= dt;
      if (this.bigT <= 0) this.big.setVisible(false);
    }
    if (this.mode === 'chat') this.showTyped();
    if (!g) return;
    // the shared count while the balloon is up, and the race's 3, 2, 1
    const m = this.meet;
    if (m.ball) this.count.setText(String(m.ball.n)).setVisible(true);
    else if (m.race === 'count') {
      const left = Math.ceil((m.raceGoAt - performance.now()) / 1000);
      this.count.setText(String(Math.max(1, Math.min(3, left)))).setVisible(true);
    } else this.count.setVisible(false);
    // what Space does here
    const own = m.spaceHint();
    const rules = g.rt.hint ? S(`hint:${g.rt.hint}`) : '';
    const word = own ? S(own) : rules;
    // on an iPad the Space button itself says it, in one word; the line and the keys line go
    this.spaceWord = this.mode !== 'play' ? '' : own ? S(SHORT[own] ?? 'touch_go') : rules;
    if (this.mode === 'play' && this.touchBtns !== touchState.shown) this.showButtons(true);
    const line = this.mode === 'play' && word && !touchState.shown ? `${S('meet_space')}  ${word}` : '';
    if (this.hint.text !== line) this.hint.setText(line);
    const help = this.mode === 'play' && !touchState.shown ? S('meet_keys') : '';
    if (this.help.text !== help) this.help.setText(help);
  }
}
