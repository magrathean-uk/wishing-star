// Package 73b (I6): draws the school quiz (src/core/quiz.ts) while it runs: a class room wall, the blackboard with the
// question in chalk, three answer cards and the seconds left. The start and result cards, the score line ("4 of 7"),
// the stars and the key line are the mini-game view's own (src/game/ui/miniview.ts). Nothing here moves by itself.
import type Phaser from 'phaser';
import { quizLeft } from '../../core/quiz.ts';
import type { MiniRt } from '../../core/types.ts';
import type { UI } from '../scenes/UI.ts';
import { GOLD, H, INK, outlined, text, title, type Txt, W } from './kit.ts';

/** Above the mini-game view's backdrop (20), under its words (23) and cards (24, 25). */
const D = { back: 20.1, board: 20.3, text: 22.5, card: 25.2 };
/** The three answer cards: centres across the screen, top and size. */
const CARD = { xs: [480, 960, 1440], y: 700, w: 420, h: 150 };
const BOARD = { x: 300, y: 170, w: 1320, h: 430 };

export class QuizView {
  private back: Phaser.GameObjects.Graphics;
  private cards: Phaser.GameObjects.Graphics;
  private ask: Txt;
  private answers: Txt[] = [];
  private left: Txt;
  private got: Txt;
  private sig = '';
  private shown = false;

  private readonly ui: UI;

  constructor(ui: UI) {
    this.ui = ui;
    this.back = ui.add.graphics().setDepth(D.back).setScrollFactor(0);
    this.cards = ui.add.graphics().setDepth(D.board).setScrollFactor(0);
    this.ask = text(ui, W / 2, BOARD.y + BOARD.h / 2, '', 84, '#f4f1e6', BOARD.w - 120)
      .setOrigin(0.5)
      .setAlign('center')
      .setDepth(D.text);
    for (const x of CARD.xs)
      this.answers.push(
        title(ui, x, CARD.y + CARD.h / 2, '', 56, INK)
          .setOrigin(0.5)
          .setDepth(D.text),
      );
    this.left = outlined(ui, W - 48, 100, '', 40)
      .setOrigin(1, 0)
      .setDepth(D.text);
    this.got = title(ui, 1020, 584, '', 44, INK).setOrigin(0.5, 0).setDepth(D.card);
    this.got.setWordWrapWidth(1000);
    // a tap or a click on an answer card picks it at once
    ui.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.tap(p.x, p.y));
    this.show(false);
  }

  private get m(): MiniRt | null {
    const m = this.ui.g.rt.mini;
    return m?.game === 'quiz' ? m : null;
  }

  private show(v: boolean): void {
    this.shown = v;
    for (const o of [this.back, this.cards, this.ask, this.left, this.got, ...this.answers]) o.setVisible(v);
    if (!v) this.sig = '';
  }

  tap(x: number, y: number): boolean {
    const m = this.m;
    if (m?.st !== 1 || !m.quiz) return false;
    if (m.quiz.picked >= 0) return true;
    const i = CARD.xs.findIndex((cx) => Math.abs(x - cx) <= CARD.w / 2 && y >= CARD.y && y <= CARD.y + CARD.h);
    if (i >= 0) this.ui.keys.send({ c: 'choose', i });
    return true;
  }

  update(_dt: number): void {
    const m = this.m;
    if (!m) {
      if (this.shown) this.show(false);
      return;
    }
    if (!this.shown) {
      this.show(true);
      this.paintBack();
    }
    const S = this.ui.g.c.strings;
    const q = m.quiz;
    const play = m.st === 1 && !!q;
    for (const o of [this.cards, this.ask, this.left, ...this.answers]) o.setVisible(play);
    const secs = play ? (S.quiz_time ?? '{n} seconds').replace('{n}', String(quizLeft(m))) : '';
    if (this.left.text !== secs) this.left.setText(secs);
    // the result card: her score and her best (its title says "A gold star!" when this go won the day's star)
    const end = m.st === 2 && m.t > 0.4;
    this.got.setVisible(end);
    if (end) {
      const best = this.ui.g.s.counts.quiz_best ?? m.score;
      const line = (S.quiz_got ?? '').replace('{n}', String(m.score)).replace('{best}', String(best));
      if (this.got.text !== line) this.got.setText(line);
    }
    if (!play) return;
    const sig = `${q.key}|${q.pick}|${q.picked}`;
    if (sig === this.sig) return;
    this.sig = sig;
    this.ask
      .setFontSize(q.kind === 0 ? 96 : 76)
      .setText(q.kind === 0 ? (S.quiz_times ?? '{q}').replace('{q}', q.text) : (S.quiz_spell ?? ''));
    const c = this.cards.clear();
    q.answers.forEach((a, i) => {
      const x = CARD.xs[i]! - CARD.w / 2;
      const done = q.picked >= 0;
      const right = done && i === q.right;
      const wrong = done && i === q.picked && i !== q.right;
      const on = !done && i === q.pick;
      const edge = right ? 0x3fa34d : wrong ? 0xd9534f : on ? GOLD : 0xc9b48a;
      const fill = right ? 0xd9f7d0 : wrong ? 0xfbe0dc : on ? 0xfff3c4 : 0xfffdf2;
      c.fillStyle(0x000000, 0.18).fillRoundedRect(x + 4, CARD.y + 10, CARD.w, CARD.h, 26);
      c.fillStyle(edge, 1).fillRoundedRect(x, CARD.y, CARD.w, CARD.h, 26);
      c.fillStyle(fill, 1).fillRoundedRect(
        x + (on ? 10 : 6),
        CARD.y + (on ? 10 : 6),
        CARD.w - (on ? 20 : 12),
        CARD.h - (on ? 20 : 12),
        20,
      );
      const t = this.answers[i]!;
      t.setText(a).setAlpha(done && !right && !wrong ? 0.45 : 1);
      t.setScale(on ? 1.06 : 1);
    });
  }

  /** The class room behind the board: a warm wall, a wooden floor, the board in its frame. Drawn once a go. */
  private paintBack(): void {
    const b = this.back.clear();
    b.fillStyle(0xf3e3c3, 1).fillRect(0, 0, W, H);
    b.fillStyle(0xe8d3ad, 1).fillRect(0, 0, W, 60);
    b.fillStyle(0xb98552, 1).fillRect(0, 900, W, H - 900);
    for (let i = 0; i < 8; i++) b.fillStyle(0xa8743f, 1).fillRect(0, 920 + i * 24, W, 4);
    b.fillStyle(0x8a5a2b, 1).fillRoundedRect(BOARD.x - 26, BOARD.y - 26, BOARD.w + 52, BOARD.h + 52, 22);
    b.fillStyle(0x2f5d46, 1).fillRoundedRect(BOARD.x, BOARD.y, BOARD.w, BOARD.h, 12);
    b.fillStyle(0x8a5a2b, 1).fillRect(BOARD.x + 80, BOARD.y + BOARD.h + 26, BOARD.w - 160, 18);
    b.fillStyle(0xffffff, 0.9).fillRect(BOARD.x + 200, BOARD.y + BOARD.h + 16, 60, 12);
    b.fillStyle(0xffe066, 0.9).fillRect(BOARD.x + 300, BOARD.y + BOARD.h + 16, 44, 12);
  }
}
