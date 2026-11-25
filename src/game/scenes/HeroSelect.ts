// Pick who to be. Each of the starting six stands in its idle loop; the chosen one waves and cheers.
// Space picks and the game starts: nothing asks her to name anyone.
import Phaser from 'phaser';
import { app, startNew } from '../app.ts';
import { frameFor, hasArt, pumpUploads } from '../assets.ts';
import { Sound } from '../audio.ts';
import { Repeater, touchState } from '../input.ts';
import { heroAllowed } from '../net.ts';
import { Puppet } from '../puppet.ts';
import { H, makeUiTextures, outlined, panel, text, title, type Txt, W } from '../ui/kit.ts';

export class HeroSelect extends Phaser.Scene {
  private ids: string[] = [];
  private puppets: Puppet[] = [];
  private sel = 0;
  private rx = new Repeater();
  private nameText!: Txt;
  private keyLine!: Txt;
  private spot!: Phaser.GameObjects.Ellipse;
  private pressed = new Set<string>();
  private busy = false;
  private t = 0;

  constructor() {
    super('HeroSelect');
  }

  create(): void {
    makeUiTextures(this);
    this.busy = false;
    this.puppets = [];
    this.pressed.clear();
    // the title's winter picture, dimmed, with a snowy bank for the six to stand on
    if (hasArt('bd_title')) {
      const f = frameFor(this, 'bd_title', W, H);
      this.add.image(0, 0, f.key, f.frame).setOrigin(0, 0).setDisplaySize(W, H);
      this.add.rectangle(0, 0, W, H, 0x101a40, 0.5).setOrigin(0, 0);
    } else {
      const g0 = this.add.graphics();
      g0.fillGradientStyle(0x20306a, 0x20306a, 0x5a7ad0, 0x5a7ad0, 1).fillRect(0, 0, W, H);
    }
    const g = this.add.graphics();
    // wide and flat, so the ones at the ends stand in the snow too
    g.fillStyle(0xc8d8f0, 1).fillEllipse(W / 2, H + 50, W * 2.5, 720);
    g.fillStyle(0xf4f8ff, 1).fillEllipse(W / 2, H + 70, W * 2.4, 680);
    for (let i = 0; i < 40; i++)
      g.fillStyle(0xdfe9f8, 1).fillEllipse((i * 197) % W, H - 230 + ((i * 53) % 200), 60 + (i % 4) * 20, 10);
    title(this, W / 2, 70, 'Who will you be?', 84, '#ffffff')
      .setOrigin(0.5, 0)
      .setStroke('#23306e', 12);
    this.ids = Object.values(app.content.heroes)
      .filter((h) => h.starter && heroAllowed(h.id))
      .map((h) => h.id);
    this.spot = this.add.ellipse(0, H - 250, 300, 70, 0xffd24a, 0.45);
    const gap = Math.min(290, (W - 200) / this.ids.length);
    this.ids.forEach((id, i) => {
      const c = app.content.chars[id]!;
      const p = new Puppet(this, id, c.tall ?? 2, true);
      p.zoom = 2.6;
      p.setPos(W / 2 + (i - (this.ids.length - 1) / 2) * gap, H - 250);
      p.sprite.setDepth(5);
      this.puppets.push(p);
    });
    const pg = this.add.graphics();
    panel(pg, W / 2 - 330, H - 190, 660, 100);
    this.nameText = text(this, W / 2, H - 168, '', 48).setOrigin(0.5, 0);
    this.keyLine = outlined(this, W / 2, H - 62, 'Left and right: choose    Space: play    X: back', 28).setOrigin(
      0.5,
      0,
    );
    this.input.keyboard!.on('keydown', (e: KeyboardEvent) => {
      Sound.wake();
      if (!e.repeat) this.pressed.add(e.code);
    });
    this.events.once('shutdown', () => {
      this.input.keyboard!.removeAllListeners('keydown');
      for (const p of this.puppets) p.destroy();
    });
    this.show();
  }

  private label(id: string): string {
    if (id === 'koala') return 'Koala';
    const c = app.content.chars[id]!;
    return c.name.startsWith('{') ? (app.personal.names[c.name.slice(1, -1)] ?? id) : c.name;
  }
  private show(): void {
    this.nameText.setText(this.label(this.ids[this.sel]!));
    this.spot.setPosition(this.puppets[this.sel]!.sprite.x, H - 246);
  }

  update(_time: number, delta: number): void {
    const dt = delta / 1000;
    this.t += dt;
    pumpUploads();
    Sound.update();
    // on an iPad the key line goes (package 67): the Space button says Play
    if (this.keyLine.visible === touchState.shown) this.keyLine.setVisible(!touchState.shown);
    this.puppets.forEach((p, i) => {
      p.zoom += ((i === this.sel ? 3.2 : 2.4) - p.zoom) * Math.min(1, dt * 10);
      p.play(i === this.sel ? (Math.floor(this.t * 0.5) % 2 ? 'cheer' : 'wave') : 'idle', 'down');
      p.update(dt);
    });
    if (this.busy) return;
    const kb = this.input.keyboard!;
    const K = Phaser.Input.Keyboard.KeyCodes;
    const down = (...codes: number[]) => codes.some((c) => kb.addKey(c, true, false).isDown);
    const x = this.rx.step((down(K.RIGHT, K.D) ? 1 : 0) - (down(K.LEFT, K.A) ? 1 : 0), dt);
    if (x) {
      this.sel = (this.sel + x + this.ids.length) % this.ids.length;
      Sound.sfx('tick');
      this.show();
    }
    const act = this.pressed.delete('Space') || this.pressed.delete('Enter');
    const back = this.pressed.delete('KeyX') || this.pressed.delete('Backspace');
    this.pressed.clear();
    if (back) this.scene.start('Title');
    else if (act) {
      this.busy = true;
      Sound.sfx('fanfare');
      // straight into the game: nobody is named by the player
      const g = startNew((this.registry.get('slot') as number) ?? 1, this.ids[this.sel]!);
      this.registry.set('game', g);
      this.scene.start('World');
    }
  }
}
