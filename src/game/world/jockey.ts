// The chicken jockey (a rare surprise, src/core/surprises.ts): while that scene plays, a small zombie puppet rides
// on the chicken actor. Two puppets and no new art: the zombie is drawn at half size, sitting a little up and back,
// and bobs with the chicken's trot.
import type Phaser from 'phaser';
import type { Game } from '../../core/types.ts';
import { Puppet } from '../puppet.ts';

const T = 64;
const SCENE = 'surprise_jockey';
const RIDER_TALL = 1.05;

export class JockeyRider {
  private rider: Puppet | null = null;
  private t = 0;
  private readonly scene: Phaser.Scene;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  update(g: Game, alpha: number, dt: number): void {
    const cut = g.rt.cut;
    const mount = cut?.id === SCENE ? cut.actors.chicken : undefined;
    if (!mount) {
      this.rider?.destroy();
      this.rider = null;
      return;
    }
    this.t += dt;
    const p = (this.rider ??= new Puppet(this.scene, 'zombie', RIDER_TALL));
    const x = (mount.px + (mount.x - mount.px) * alpha) * T;
    const y = (mount.py + (mount.y - mount.py) * alpha) * T;
    const moving = Math.abs(mount.x - mount.px) + Math.abs(mount.y - mount.py) > 0.001;
    const bob = moving ? Math.abs(Math.sin(this.t * 14)) * 5 : 0;
    // sit on the chicken's back: a little behind its head, drawn just in front of it
    p.setPos(x + (mount.dir === 'left' ? 6 : -6), y - 22 - bob);
    p.sprite.setDepth(y + 2);
    p.play('idle', mount.dir);
    p.update(dt);
  }
}
