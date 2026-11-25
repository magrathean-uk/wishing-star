// The title: Dad's greeting first, large and festive, then the name of the game and the menu.
import Phaser from 'phaser';
import { app, continueSlot, PERSONAL_BROKEN, playerChanged, setChristmas, setVolume } from '../app.ts';
import { BRAND, frameFor, hasArt, pumpUploads } from '../assets.ts';
import { Sound } from '../audio.ts';
import { Repeater, touchState } from '../input.ts';
import { homeCopyOn, labelOf, login, logout, net, showCredit } from '../net.ts';
import { Puppet } from '../puppet.ts';
import {
  carryOver,
  hasPlayerSave,
  homeSaveToOffer,
  lastSlot,
  slotInfo,
  syncPlayer,
  takeBackHome,
  takeCarryOn,
} from '../save.ts';
import { H, INK, makeUiTextures, outlined, panel, text, title, type Txt, W } from '../ui/kit.ts';
import { creditInPlay, creditLine, openCredit, PlayerPicker } from '../ui/players.ts';
import { SlotsPanel, slotLine } from '../ui/slots.ts';
import { startMeet } from '../meet/index.ts';

/** who, busy, ask and carry are players mode only (D67): the list and password, waiting on the server, "start again?" */
type Mode = 'menu' | 'options' | 'saves' | 'replace' | 'who' | 'busy' | 'ask' | 'carry' | 'nogame';
const OPTIONS = ['Christmas', 'Music', 'Sound', 'Saved games', 'Back'];

export class Title extends Phaser.Scene {
  /** the menu rows by name: Play, New game (only when a save exists), Options */
  private items: string[] = [];
  private labels: Txt[] = [];
  private sel = 0;
  private mode: Mode = 'menu';
  private slotBox: Phaser.GameObjects.Container | null = null;
  private slotSel = 0;
  private saves: SlotsPanel | null = null;
  private ry = new Repeater();
  private rx = new Repeater();
  private keysDown = new Set<string>();
  private snow!: Phaser.GameObjects.TileSprite;
  private friends: Puppet[] = [];
  private t = 0;
  private menuBox!: Phaser.GameObjects.Graphics;
  private helpT!: Txt;
  // players mode (D67)
  private picker: PlayerPicker | null = null;
  private askBox: Phaser.GameObjects.Container | null = null;
  private credit: Txt | null = null;
  private carrySlot = 0;
  private typedKeys: KeyboardEvent[] = [];

  constructor() {
    super('Title');
  }

  create(): void {
    makeUiTextures(this);
    Sound.init(this);
    Sound.volumes(app.music, app.sound);
    Sound.music('festive');
    this.friends = [];
    this.labels = [];
    this.slotBox = null;
    this.saves = null;
    const cam = this.cameras.main;
    cam.setBackgroundColor(0x16204a);
    if (hasArt('bd_title')) {
      const f = frameFor(this, 'bd_title', W, H);
      this.add.image(0, 0, f.key, f.frame).setOrigin(0, 0).setDisplaySize(W, H);
    } else {
      const g = this.add.graphics();
      g.fillGradientStyle(0x16204a, 0x16204a, 0x3a4f9a, 0x3a4f9a, 1).fillRect(0, 0, W, H);
      g.fillStyle(0xf4f7ff, 1).fillEllipse(W / 2, H + 120, W * 1.5, 520);
      for (let i = 0; i < 70; i++)
        g.fillStyle(0xffffff, 0.3 + ((i * 37) % 60) / 100).fillCircle((i * 263) % W, (i * 149) % 560, 1.5 + (i % 3));
    }
    if (!this.textures.exists('title_snow')) {
      const tex = this.textures.createCanvas('title_snow', 256, 256)!;
      const c = tex.getContext();
      c.fillStyle = '#fff';
      for (let i = 0; i < 22; i++) {
        c.globalAlpha = 0.5 + ((i * 37) % 50) / 100;
        c.beginPath();
        c.arc((i * 89) % 256, (i * 151) % 256, 2 + (i % 3), 0, Math.PI * 2);
        c.fill();
      }
      tex.refresh();
    }
    this.snow = this.add.tileSprite(0, 0, W, H, 'title_snow').setOrigin(0, 0).setAlpha(0.85);
    // the Magrathean logo as on the website (the white mark, then "Magrathean UK"), a faint watermark in the bottom
    // left corner: clear of the menu, the iPad buttons and the credit line (bottom right) and a test window's tag
    // (top left); still pictures, so no frame cost
    if (this.textures.exists(BRAND.key)) {
      const cy = H - 24 - BRAND.size / 2;
      // a soft dark copy under the mark and a shadow under the words keep it readable on the snow
      this.add
        .image(18, cy + 2, BRAND.key)
        .setOrigin(0, 0.5)
        .setDisplaySize(BRAND.size, BRAND.size)
        .setTint(0x1b2440)
        .setAlpha(BRAND.alpha * 0.6)
        .setDepth(9);
      this.add
        .image(16, cy, BRAND.key)
        .setOrigin(0, 0.5)
        .setDisplaySize(BRAND.size, BRAND.size)
        .setAlpha(BRAND.alpha)
        .setDepth(9);
      const font = {
        fontFamily: 'Nunito, sans-serif',
        fontStyle: '700',
        fontSize: '28px',
        color: '#ffffff',
        shadow: { offsetX: 0, offsetY: 2, color: '#1b2440', blur: 6, fill: true },
      };
      const name = this.add
        .text(16 + BRAND.size + 2, cy, 'Magrathean', font)
        .setOrigin(0, 0.5)
        .setAlpha(BRAND.alpha)
        .setDepth(9);
      this.add
        .text(name.x + name.width + 7, cy, 'UK', font)
        .setOrigin(0, 0.5)
        .setAlpha(BRAND.alpha * 0.8)
        .setDepth(9);
    }
    // Dad's greeting: Hungarian, large and festive, first on the screen
    const g1 = this.add
      .text(W / 2, 96, app.personal.greeting1, {
        fontFamily: 'Fredoka, Nunito, sans-serif',
        fontStyle: '600',
        fontSize: '112px',
        color: '#ffe27a',
        stroke: '#8a2a1a',
        strokeThickness: 14,
      })
      .setOrigin(0.5, 0);
    g1.setShadow(0, 8, 'rgba(0,0,0,0.35)', 0, true, false);
    const g2 = this.add
      .text(W / 2, 236, app.personal.greeting2, {
        fontFamily: 'Fredoka, Nunito, sans-serif',
        fontStyle: '600',
        fontSize: '68px',
        color: '#ffffff',
        stroke: '#8a2a1a',
        strokeThickness: 10,
      })
      .setOrigin(0.5, 0);
    g1.setScale(0.2).setAlpha(0);
    g2.setAlpha(0);
    this.tweens.add({ targets: g1, scale: 1, alpha: 1, duration: 700, ease: 'Back.easeOut' });
    this.tweens.add({ targets: g2, alpha: 1, y: { from: 270, to: 236 }, duration: 500, delay: 600 });
    this.tweens.add({
      targets: g1,
      angle: { from: -1.2, to: 1.2 },
      duration: 2400,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
    // the game's name holds her name, so it comes from Dad's file; without it (players 1 to 10) it is the star alone
    const name = app.ownWords ? `${app.personal.names.amelia ?? ''} and the Wishing Star` : 'The Wishing Star';
    // the browser tab carries the game's name too (her name only where Dad's file is in use); a test window keeps its mark
    document.title = `${document.title.startsWith('TEST') ? 'TEST: ' : ''}${name}`;
    const logo = title(this, W / 2, 372, name, 76, '#ffffff')
      .setOrigin(0.5, 0)
      .setAlpha(0);
    logo.setStroke('#23306e', 12);
    const star = this.add
      .image(W / 2 - logo.width / 2 - 70, 420, 'ui_starbig')
      .setScale(1.5)
      .setAlpha(0);
    this.tweens.add({ targets: [logo, star], alpha: 1, duration: 500, delay: 1000 });
    this.tweens.add({ targets: star, angle: 360, duration: 6000, repeat: -1 });
    // Dad's personal.json is there but has a mistake: one small plain line for him (review 55; the console says where)
    if (app.personalBroken)
      outlined(this, W / 2, 20, PERSONAL_BROKEN, 26)
        .setOrigin(0.5, 0)
        .setDepth(9);
    // the six friends she can start as, idling (nobody on the title is a still picture)
    const six = ['amelia', 'bluey', 'bing', 'flop', 'peppa', 'koala'];
    six.forEach((id, i) => {
      const c = app.content.chars[id]!;
      const p = new Puppet(this, id, c.tall ?? 2, true);
      p.zoom = 2.1;
      p.setPos(W / 2 - 650 + i * 260, H - 60);
      p.sprite.setDepth(5);
      this.friends.push(p);
    });
    // menu: Play, New game (only when there is a game to carry on), Options
    this.menuBox = this.add.graphics().setDepth(8);
    for (let i = 0; i < OPTIONS.length; i++)
      this.labels.push(
        text(this, W / 2, 0, '', 46)
          .setOrigin(0.5, 0)
          .setDepth(9),
      );
    this.helpT = outlined(this, W / 2, H - 46, '', 26)
      .setOrigin(0.5, 0)
      .setDepth(9);
    this.picker = null;
    this.askBox = null;
    this.credit = null;
    this.typedKeys = [];
    if (net.on) this.startPlayers();
    else if (homeCopyOn()) this.startHome();
    else this.enter('menu');
    this.keysDown.clear();
    this.input.keyboard!.on('keydown', (e: KeyboardEvent) => {
      Sound.wake();
      if (!e.repeat) this.keysDown.add(e.code);
      if (this.mode === 'who' && this.picker?.step === 'pass') this.typedKeys.push(e);
    });
    // the mouse (players mode): Phaser's own mouse input is off, so the canvas is listened to here
    const canvas = this.game.canvas;
    const at = (e: PointerEvent): [number, number] => {
      const r = canvas.getBoundingClientRect();
      return [((e.clientX - r.left) * W) / r.width, ((e.clientY - r.top) * H) / r.height];
    };
    const onMove = (e: PointerEvent) => {
      const [x, y] = at(e);
      const i = this.mode === 'who' ? (this.picker?.rowAt(x, y) ?? -1) : -1;
      if (i >= 0 && i !== this.picker!.sel) this.picker!.move(i - this.picker!.sel);
      canvas.style.cursor = i >= 0 || this.onCredit(x, y) ? 'pointer' : '';
    };
    const onDown = (e: PointerEvent) => {
      const [x, y] = at(e);
      if (this.onCredit(x, y)) openCredit();
      else if (this.mode === 'who' && (this.picker?.rowAt(x, y) ?? -1) >= 0) this.keysDown.add('Enter');
    };
    if (net.on) {
      canvas.addEventListener('pointermove', onMove);
      canvas.addEventListener('pointerdown', onDown);
    }
    this.events.once('shutdown', () => {
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.style.cursor = '';
      this.picker?.destroy();
      this.picker = null;
      this.input.keyboard!.removeAllListeners('keydown');
      for (const p of this.friends) p.destroy();
      this.saves?.destroy();
      this.saves = null;
    });
  }

  private hasSave(): boolean {
    if (net.on) return hasPlayerSave(app.content);
    return [1, 2, 3].some((n) => slotInfo(app.content, n));
  }

  /** Home copy: a slot with nothing in the browser is asked of the server's copy first (package 80, D87). */
  private startHome(): void {
    this.busy();
    void takeBackHome(app.content).then((n) => {
      if (!this.sys.isActive()) return;
      if (n) {
        outlined(this, W / 2, app.personalBroken ? 58 : 20, app.content.strings.home_back ?? '', 30)
          .setOrigin(0.5, 0)
          .setDepth(9);
      }
      this.enter('menu');
    });
  }

  // ---------------------------------------------------------------- players mode (D67)

  /** The credit line is under the pointer (on the list and the title, where it can be clicked). */
  private onCredit(x: number, y: number): boolean {
    if (!this.credit?.visible) return false;
    return this.credit.getBounds().contains(x, y);
  }

  /** Who plays: the list, the password again, or (still logged in) the server's save and then the menu. */
  private startPlayers(): void {
    creditInPlay(this.game);
    if (showCredit() || !net.id || !net.token) this.credit = creditLine(this, false).setDepth(30);
    if (!net.id || !net.token) {
      this.showPicker(net.id || undefined);
      return;
    }
    this.busy();
    void syncPlayer().then((r) => {
      if (!this.sys.isActive()) return;
      if (r === 'login') return this.showPicker(net.id);
      const S = app.content.strings;
      // no answer and no game on this device: nothing to play yet, so no fresh game that could outcount the real one
      if (r === 'offline' && !this.hasSave()) {
        this.mode = 'nogame';
        outlined(this, W / 2, H / 2 + 120, S.pl_offline ?? '', 40)
          .setOrigin(0.5, 0)
          .setDepth(9);
        this.helpT.setText((touchState.shown ? S.pl_retry_touch : S.pl_retry) ?? '');
        return;
      }
      outlined(this, 40, 30, (S.pl_playing ?? '').replace('{who}', labelOf(net.id)), 30).setDepth(9);
      // "Your game moved on": straight on with the server's game
      if (takeCarryOn() && this.hasSave()) return this.play();
      this.carrySlot = homeSaveToOffer(app.content);
      if (this.carrySlot) this.ask('carry');
      else this.enter('menu');
    });
  }

  private busy(): void {
    this.mode = 'busy';
    this.items = [];
    this.helpT.setText('');
    this.menuBox.clear();
    for (const l of this.labels) l.setVisible(false);
  }

  private showPicker(id?: string): void {
    this.busy();
    this.mode = 'who';
    this.picker ??= new PlayerPicker(this, 20);
    if (id) this.picker.askPassword(id);
    else this.picker.backToList();
    this.credit?.setVisible(true);
  }

  private async sendPassword(): Promise<void> {
    const p = this.picker!;
    const id = net.players[p.sel]!.id;
    this.mode = 'busy';
    const r = await login(id, p.typed);
    if (!this.sys.isActive()) return;
    if (r === 'ok') {
      Sound.sfx('pick');
      await playerChanged();
      this.scene.restart();
      return;
    }
    Sound.sfx('nope');
    this.mode = 'who';
    p.typed = '';
    p.askPassword(id);
    const S = app.content.strings;
    p.say((r === 'wrong' ? S.pl_wrong : r === 'locked' ? S.pl_locked : r === 'day' ? S.pl_day : S.pl_offline) ?? '');
  }

  private async changePlayer(): Promise<void> {
    this.busy();
    logout();
    await playerChanged();
    this.scene.restart();
  }

  /** A yes or no question on a small panel: start again (replacing the save) or carry on a home-copy save. */
  private ask(what: 'ask' | 'carry'): void {
    this.busy();
    this.mode = what;
    const S = app.content.strings;
    const box = this.add.container(0, 0).setDepth(20);
    const g = this.add.graphics();
    g.fillStyle(0x10131f, 0.7).fillRect(0, 0, W, H);
    panel(g, W / 2 - 520, 330, 1040, 360);
    box.add(g);
    const line = what === 'ask' ? (S.pl_new_ask ?? '') : (S.pl_carry ?? '');
    box.add(title(this, W / 2, 380, line, 50).setOrigin(0.5, 0));
    if (what === 'carry')
      box.add(
        text(this, W / 2, 470, `${S.pl_carry_sub ?? ''}  ${slotLine(this.carrySlot)}`, 34, INK).setOrigin(0.5, 0),
      );
    const yn = touchState.shown ? S.pl_yes_no_touch : S.pl_yes_no;
    box.add(text(this, W / 2, 600, yn ?? '', 32, '#7a5a35').setOrigin(0.5, 0));
    this.askBox = box;
  }
  private answer(yes: boolean): void {
    this.askBox?.destroy(true);
    this.askBox = null;
    if (this.mode === 'carry') {
      carryOver(this.carrySlot, yes);
      this.enter('menu');
    } else if (yes) {
      this.registry.set('slot', 1);
      this.scene.start('HeroSelect');
    } else this.enter('menu', Math.max(0, this.items.indexOf('New game')));
  }

  private enter(mode: Mode, sel = 0): void {
    this.mode = mode;
    this.sel = sel;
    if (mode === 'menu') this.items = this.hasSave() ? ['Play', 'New game', 'Options'] : ['Play', 'Options'];
    if (mode === 'menu' && net.on) {
      this.items = this.hasSave()
        ? ['Continue', 'Play together', 'New game', 'Options', 'Change player']
        : ['Play', 'Play together', 'Options', 'Change player'];
    }
    this.helpT.setText(
      mode === 'options'
        ? 'Up and down: choose    Left and right: change    Space: go    X: back'
        : 'Up and down: choose    Space: go    F: full screen',
    );
    this.drawMenu();
  }

  private rows(): string[] {
    if (this.mode === 'menu') return this.items;
    const xmas = app.christmas === 'auto' ? 'Auto' : app.christmas === 'on' ? 'On' : 'Off';
    // on an iPad the two ends of a number row say what a tap there does (issue 54: left is down, right is up)
    const vol = (name: string, v: number) =>
      touchState.shown ? `${name}:  -   ${Math.round(v * 10)} of 10   +` : `${name}:  ${Math.round(v * 10)} of 10`;
    return [
      `Christmas:  ${xmas}`,
      vol('Music', app.music),
      vol('Sound', app.sound),
      // players mode: one save on the server, so no slots to look at (D67)
      ...(net.on ? [] : ['Saved games']),
      'Back',
    ];
  }

  private drawMenu(): void {
    const rows = this.rows();
    // on an iPad every row is a finger high (issue 41: 84 is 44 CSS pixels on the smallest iPad)
    const step = this.mode === 'menu' || touchState.shown ? 84 : 70;
    const size = this.mode === 'menu' ? 46 : 40;
    const h = 72 + rows.length * step;
    const top = this.mode === 'menu' ? 520 : 500;
    this.menuBox.clear();
    panel(this.menuBox, W / 2 - 300, top, 600, h);
    this.labels.forEach((l, i) => {
      const label = rows[i];
      l.setVisible(label !== undefined);
      if (label === undefined) return;
      l.setFontSize(size).setPosition(W / 2, top + 36 + i * step);
      l.setText(`${i === this.sel ? '▶ ' : ''}${label}`);
      l.setColor(i === this.sel ? '#b3541e' : INK);
    });
  }

  /** A tap on one of the three rows of the replace dialog chooses it; Go then starts the new game there. */
  selectReplacementAt(x: number, y: number): void {
    if (this.mode !== 'replace' || x < W / 2 - 460 || x > W / 2 + 460) return;
    const row = Math.floor((y - 410) / 110);
    if (row < 0 || row > 2 || y > 410 + row * 110 + 96) return;
    this.slotSel = row;
    Sound.sfx('tick');
    this.showSlots();
  }

  /** Every slot is full: which game should the new one replace? */
  private showSlots(): void {
    this.slotBox?.destroy(true);
    const box = this.add.container(0, 0).setDepth(20);
    const g = this.add.graphics();
    g.fillStyle(0x10131f, 0.7).fillRect(0, 0, W, H);
    panel(g, W / 2 - 520, 250, 1040, 560);
    box.add(g);
    box.add(title(this, W / 2, 280, 'Which game should go?', 54).setOrigin(0.5, 0));
    for (let n = 1; n <= 3; n++) {
      const y = 300 + n * 110;
      const chosen = n - 1 === this.slotSel;
      g.fillStyle(chosen ? 0xf2b84b : 0xe8d9b5, 1).fillRoundedRect(W / 2 - 460, y, 920, 96, 20);
      g.fillStyle(0xfffdf2, 1).fillRoundedRect(W / 2 - 454, y + 6, 908, 84, 16);
      box.add(text(this, W / 2 - 420, y + 24, `${n}.  ${slotLine(n)}`, 38, chosen ? '#b3541e' : INK));
    }
    const keys = touchState.shown ? 'Go: start a new game here    Back: no' : 'Space: start a new game here    X: back';
    box.add(text(this, W / 2, 740, keys, 30, '#7a5a35').setOrigin(0.5, 0));
    this.slotBox = box;
  }

  /** Change the Options row under the pointer by one step. */
  private change(by: number): void {
    if (this.sel === 0) {
      const order: ('auto' | 'on' | 'off')[] = ['auto', 'on', 'off'];
      setChristmas(order[(order.indexOf(app.christmas) + by + 3) % 3]!);
    } else if (this.sel === 1) setVolume('music', app.music + by * 0.1);
    else if (this.sel === 2) setVolume('sound', app.sound + by * 0.1);
    else return;
    Sound.volumes(app.music, app.sound);
    Sound.sfx('pick');
    this.drawMenu();
  }

  /** Play: carry on with the newest game, or start a new one when there is none. */
  private play(): void {
    if (net.on) {
      if (!this.hasSave()) {
        this.newGame();
        return;
      }
      const g = continueSlot(1);
      if (!g) {
        Sound.sfx('nope');
        return;
      }
      this.registry.set('game', g);
      this.scene.start('World');
      return;
    }
    const have = [1, 2, 3].filter((n) => slotInfo(app.content, n));
    if (!have.length) {
      this.newGame();
      return;
    }
    const last = lastSlot();
    const g = continueSlot(have.includes(last) ? last : have[0]!);
    if (!g) {
      Sound.sfx('nope');
      return;
    }
    this.registry.set('game', g);
    this.scene.start('World');
  }

  /** Saved games, Play: carry on with that game, any of the three (Play on the menu takes the newest). */
  private playSlot(n: number): boolean {
    const g = continueSlot(n);
    if (!g) return false;
    this.registry.set('game', g);
    this.mode = 'busy';
    this.scene.start('World');
    return true;
  }

  /** A new game takes the first empty slot without asking; only when all three are full does she choose one. */
  private newGame(): void {
    if (net.on) {
      if (this.hasSave()) {
        this.ask('ask');
        return;
      }
      this.registry.set('slot', 1);
      this.scene.start('HeroSelect');
      return;
    }
    const empty = [1, 2, 3].find((n) => !slotInfo(app.content, n));
    if (empty) {
      this.registry.set('slot', empty);
      this.scene.start('HeroSelect');
      return;
    }
    this.mode = 'replace';
    this.slotSel = 0;
    this.showSlots();
  }

  update(_time: number, delta: number): void {
    const dt = delta / 1000;
    this.t += dt;
    pumpUploads();
    Sound.update();
    // on an iPad the key line goes (package 67): the buttons say Go and Back; a "try again" line stays, in their words
    const keyLine = !touchState.shown || this.mode === 'nogame';
    if (this.helpT.visible !== keyLine) this.helpT.setVisible(keyLine);
    this.snow.setTilePosition(Math.sin(this.t * 0.5) * 30, -this.t * 50);
    for (const p of this.friends) {
      p.play(Math.floor(this.t / 3) % this.friends.length === this.friends.indexOf(p) ? 'wave' : 'idle', 'down');
      p.update(dt);
    }
    const kb = this.input.keyboard!;
    const down = (...codes: number[]) => codes.some((c) => kb.addKey(c, true, false).isDown);
    const K = Phaser.Input.Keyboard.KeyCodes;
    const y = this.ry.step((down(K.DOWN, K.S) ? 1 : 0) - (down(K.UP, K.W) ? 1 : 0), dt);
    const x = this.rx.step((down(K.RIGHT, K.D) ? 1 : 0) - (down(K.LEFT, K.A) ? 1 : 0), dt);
    if (this.mode === 'busy') {
      this.keysDown.clear();
      this.typedKeys.length = 0;
      return;
    }
    if (this.mode === 'who' && this.picker?.step === 'pass') {
      // the credit is for everyone but her own entry: not on her password step (D68)
      const forHer = net.players[this.picker.sel]?.id === 'hero';
      if (this.credit && this.credit.visible === forHer) this.credit.setVisible(!forHer);
      // typing: every letter is a letter of the password (F, X, W and S too)
      this.keysDown.clear();
      for (const e of this.typedKeys.splice(0)) {
        const k = this.picker.key(e);
        if (k === 'typed') Sound.sfx('tick');
        else if (k === 'back') {
          Sound.sfx('tick');
          this.picker.backToList();
        } else if (k === 'send') {
          void this.sendPassword();
          break;
        }
      }
      return;
    }
    const act = this.keysDown.delete('Space') || this.keysDown.delete('Enter');
    const back = this.keysDown.delete('KeyX') || this.keysDown.delete('Backspace');
    if (this.keysDown.delete('KeyF')) this.scale.toggleFullscreen();
    this.keysDown.clear();
    if (this.mode === 'who') {
      if (this.credit && !this.credit.visible) this.credit.setVisible(true);
      if (y) {
        this.picker!.move(y);
        Sound.sfx('tick');
      }
      if (act) {
        Sound.sfx('pick');
        this.picker!.askPassword(net.players[this.picker!.sel]!.id);
      }
      return;
    }
    if (this.mode === 'nogame') {
      if (act) {
        Sound.sfx('pick');
        this.scene.restart();
      }
      return;
    }
    if (this.mode === 'ask' || this.mode === 'carry') {
      if (act || back) {
        Sound.sfx(act ? 'pick' : 'tick');
        this.answer(act);
      }
      return;
    }
    if (this.mode === 'saves') {
      const p = this.saves!;
      p.update({ x, y, act, back });
      if (p.done) {
        p.destroy();
        this.saves = null;
        this.enter('options', 3);
      }
      return;
    }
    if (this.mode === 'replace') {
      if (y) {
        this.slotSel = (this.slotSel + y + 3) % 3;
        Sound.sfx('tick');
        this.showSlots();
      }
      if (back || act) {
        this.slotBox?.destroy(true);
        this.slotBox = null;
        if (act) {
          Sound.sfx('pick');
          this.registry.set('slot', this.slotSel + 1);
          this.scene.start('HeroSelect');
        } else this.enter('menu', Math.max(0, this.items.indexOf('New game')));
      }
      return;
    }
    const rows = this.rows();
    if (y) {
      this.sel = (this.sel + y + rows.length) % rows.length;
      Sound.sfx('tick');
      this.drawMenu();
    }
    if (this.mode === 'options') {
      if (x) this.change(x);
      const backRow = rows.length - 1;
      if (back || (act && this.sel === backRow)) this.enter('menu', this.items.indexOf('Options'));
      else if (act && this.sel === 3 && !net.on) {
        Sound.sfx('pick');
        this.mode = 'saves';
        this.saves = new SlotsPanel(this, 20, null, null, (n) => this.playSlot(n));
      } else if (act) this.change(1);
      return;
    }
    if (!act) return;
    Sound.sfx('pick');
    const name = this.items[this.sel]!;
    if (name === 'Play' || name === 'Continue') this.play();
    else if (name === 'New game') this.newGame();
    else if (name === 'Change player') void this.changePlayer();
    else if (name === 'Play together') startMeet(this);
    else this.enter('options');
  }
}
