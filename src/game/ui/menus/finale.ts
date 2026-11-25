// The end of the finale scene (design section 4): Dad's letter, the group photo of the hero and 5 friends she
// picks, the photo itself for a moment, then the credits. Opened by the finale cutscene (`open: 'finale'`).
// After the credits the game carries on where she stands.
import type Phaser from 'phaser';
import { charName, fill } from '../../../core/talk.ts';
import { app } from '../../app.ts';
import { Sound } from '../../audio.ts';
import { touchState } from '../../input.ts';
import { Puppet } from '../../puppet.ts';
import type { UI } from '../../scenes/UI.ts';
import { GOLD, H, outlined, panel, title, type Txt, W } from '../kit.ts';
import { MailMenu } from './mail.ts';
import { PhotoMenu } from './misc.ts';
import { Menu } from '../menu.ts';
import { register } from '../registry.ts';

type Phase = 'letter' | 'photo' | 'snap' | 'credits';

const SNAP_SECS = 4;
/** seconds between credit lines, and how long each takes to fade in */
const CREDIT_STEP = 0.8;
const CREDIT_FADE = 0.6;

export class FinaleMenu extends Menu {
  private phase: Phase = 'letter';
  private child: Menu | null = null;
  private puppets: Puppet[] = [];
  private flash: Phaser.GameObjects.Rectangle | null = null;
  private roll: Txt[] = [];
  private phaseT = 0;

  constructor(ui: UI) {
    super(ui, '');
    this.root.setVisible(false);
    const g = this.g;
    if (g.s.inbox.includes('dad_finale') || g.c.letters.dad_finale) this.child = new MailMenu(ui, 'dad_finale');
    else this.next();
  }

  private next(): void {
    this.child?.close();
    this.child = null;
    this.phaseT = 0;
    if (this.phase === 'letter') {
      this.phase = 'photo';
      this.child = new PhotoMenu(this.ui, true);
      return;
    }
    if (this.phase === 'photo') {
      // the photo command reaches the rules on the next step: the snap waits a moment for it
      this.phase = 'snap';
      return;
    }
    if (this.phase === 'snap') {
      this.clearPhoto();
      this.phase = 'credits';
      this.showCredits();
      return;
    }
    this.done = true;
  }

  /** The photo she just took: the hero in the middle, her five friends round her, a flash and a click. */
  private showPhoto(): void {
    const g = this.g;
    this.root.setVisible(true);
    this.helpT = null;
    const friends = Object.keys(g.s.flags)
      .filter((k) => k.startsWith('photo:'))
      .sort((a, b) => Number(a.split(':')[1]) - Number(b.split(':')[1]))
      .map((k) => k.split(':')[2]!)
      .filter((id) => g.c.chars[id]);
    const row = [...friends.slice(0, 2), g.s.hero, ...friends.slice(2, 5)].filter((id) => g.c.chars[id]);
    panel(this.g2, W / 2 - 820, 130, 1640, 760, 0xfffdf2, GOLD);
    this.g2.fillStyle(0xbfe6ff, 1).fillRoundedRect(W / 2 - 780, 170, 1560, 600, 18);
    this.g2.fillStyle(0x8fd07a, 1).fillRoundedRect(W / 2 - 780, 560, 1560, 210, { tl: 0, tr: 0, bl: 18, br: 18 });
    const step = 1440 / Math.max(1, row.length);
    row.forEach((id, i) => {
      const p = new Puppet(this.ui, id, g.c.chars[id]!.tall ?? 2, true);
      p.zoom = id === g.s.hero ? 2.3 : 2;
      p.setPos(W / 2 - 720 + step * (i + 0.5), 700);
      p.sprite.setDepth(80);
      p.play('cheer', 'down');
      this.puppets.push(p);
    });
    this.add(title(this.ui, W / 2, 790, 'Best friends forever!', 56).setOrigin(0.5, 0));
    this.flash = this.add(this.ui.add.rectangle(0, 0, W, H, 0xffffff, 1).setOrigin(0, 0));
    Sound.sfx('pop');
    Sound.sfx('fanfare', 0.8);
  }

  private clearPhoto(): void {
    for (const p of this.puppets) p.destroy();
    this.puppets = [];
    this.flash?.destroy();
    this.flash = null;
    this.g2.clear();
    this.root.removeAll(true);
  }

  /**
   * The credits: a few lines that fade in one by one on a soft panel, with the lit Square still showing round it.
   * The key line shows from the start; the last line says the island goes on.
   */
  private showCredits(): void {
    const g = this.g;
    const S = g.c.strings;
    this.root.setVisible(true);
    // [words, size, colour, gap above]
    const lines: [string, number, string, number][] = [
      ['The End', 84, '#ffd24a', 0],
      [fill(g, app.personal.credits), 56, '#ffffff', 30],
      [`Starring ${charName(g, g.s.hero)}`, 44, '#ffe9b0', 40],
      ['and every friend on the island.', 40, '#ffe9b0', 0],
      ['Thank you for playing!', 48, '#ffffff', 40],
      [S.credits_end ?? '', 40, '#ffe9b0', 0],
    ];
    const total = lines.reduce((h, [, size, , gap]) => h + gap + size * 1.5, 0);
    let y = H / 2 - total / 2 - 30;
    const back = this.add(this.ui.add.graphics());
    back.fillStyle(0x10131f, 0.55).fillRoundedRect(W / 2 - 760, y - 50, 1520, total + 100, 40);
    for (const [s, size, color, gap] of lines) {
      y += gap;
      const t = this.add(
        outlined(this.ui, W / 2, y, s, size)
          .setOrigin(0.5, 0)
          .setColor(color)
          .setAlpha(0),
      );
      this.roll.push(t);
      y += size * 1.5;
    }
    const key = touchState.shown ? S.touch_credits : S.credits_key;
    this.helpT = this.add(outlined(this.ui, W / 2, H - 62, key ?? '', 28).setOrigin(0.5, 0));
    Sound.sfx('fanfare', 0.6);
  }

  /** Touch: the letter and the photo answer taps themselves; on the snap and the credits a tap is Space. */
  tap(x: number, y: number): boolean {
    if (this.child) return this.child.tap?.(x, y) ?? true;
    this.tapPick = true;
    return true;
  }

  update(dt: number): void {
    this.t += dt;
    this.phaseT += dt;
    if (this.child) {
      this.child.update(dt);
      if (this.child.done) {
        Sound.sfx('close', 0.8);
        this.next();
      }
      return;
    }
    if (this.phase === 'snap') {
      if (!this.flash) {
        if (this.g.s.flags.photo) {
          this.showPhoto();
          this.phaseT = 0;
        } else if (this.phaseT > 0.6) this.next();
        return;
      }
      for (const p of this.puppets) p.update(dt);
      if (this.flash) this.flash.setAlpha(Math.max(0, 1 - this.phaseT * 2.5));
      if (this.phaseT > SNAP_SECS || (this.phaseT > 1 && this.act())) this.next();
      return;
    }
    if (this.phase === 'credits') {
      // the lines fade in one by one; Space shows them all at once, a second Space carries on
      const all = (this.roll.length - 1) * CREDIT_STEP + CREDIT_FADE;
      if (this.act()) {
        if (this.phaseT < all) this.phaseT = all;
        else this.done = true;
      }
      this.roll.forEach((t, i) => {
        t.setAlpha(Math.max(0, Math.min(1, (this.phaseT - i * CREDIT_STEP) / CREDIT_FADE)));
      });
      if (this.back()) this.done = true;
    }
  }

  close(): void {
    this.child?.close();
    this.child = null;
    for (const p of this.puppets) p.destroy();
    this.puppets = [];
    super.close();
  }
}

register('finale', (ui) => new FinaleMenu(ui));
