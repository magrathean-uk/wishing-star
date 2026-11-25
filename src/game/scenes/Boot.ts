// Loading screen: read the art indexes, bring in the small atlases, then show the title.
import Phaser from 'phaser';
import { loadPersonal } from '../app.ts';
import { art, BASE, BRAND, loadIndexes, loadStaticAtlases, pumpUploads } from '../assets.ts';
import { H, makeUiTextures, outlined, W } from '../ui/kit.ts';
import { PAINTED_BUILDINGS } from '../world/buildingArt.ts';

export class Boot extends Phaser.Scene {
  private ready = false;
  private star!: Phaser.GameObjects.Image;
  constructor() {
    super('Boot');
  }
  create(): void {
    makeUiTextures(this);
    this.cameras.main.setBackgroundColor(0x10131f);
    this.star = this.add.image(W / 2, H / 2 - 40, 'ui_starbig').setScale(2);
    const message = outlined(this, W / 2, H / 2 + 80, 'Loading...', 40).setOrigin(0.5, 0);
    this.load.svg(BRAND.key, BRAND.url, { width: BRAND.size * 2, height: BRAND.size * 2 });
    this.load.image('forestry-notch', `${BASE}forestry/notch.webp`);
    for (const id of [
      'pine',
      'pine_snow',
      'pine_v1',
      'pine_v1_snow',
      'dark_oak',
      'dark_oak_snow',
      'dark_oak_v1',
      'dark_oak_v1_snow',
    ]) {
      this.load.image(`crown-${id}`, `${BASE}forestry/${id}_crown.webp`);
    }
    for (const id of ['wood_axe', 'stone_axe', 'iron_axe', 'diamond_axe']) {
      this.load.image(`held-${id}`, `${BASE}forestry/${id}.webp`);
    }
    for (const id of PAINTED_BUILDINGS) {
      for (const season of ['', '_snow']) {
        const name = id + season;
        this.load.image(`building-${name}`, `${BASE}buildings/${name}.webp`);
      }
    }
    const cutouts = new Promise<void>((resolve) => {
      const count = (key: string, type: string) => {
        if (type !== 'image') return;
        const source = this.textures.get(key).source[0];
        if (source) art.bytes.other += source.width * source.height * 4;
      };
      this.load.on(Phaser.Loader.Events.FILE_COMPLETE, count);
      this.load.once(Phaser.Loader.Events.COMPLETE, () => {
        this.load.off(Phaser.Loader.Events.FILE_COMPLETE, count);
        resolve();
      });
      this.load.start();
    });
    const atlases = loadIndexes().then(() => new Promise<boolean>((done) => loadStaticAtlases(this, done)));
    void Promise.all([cutouts, atlases, loadPersonal()]).then(([, ok]) => {
      if (ok) this.ready = true;
      else {
        message.setText('Could not load the game. Tap anywhere or press Space to try again.');
        const retry = () => location.reload();
        this.game.canvas.addEventListener('pointerup', retry);
        this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.game.canvas.removeEventListener('pointerup', retry));
        this.input.keyboard?.once('keydown-SPACE', () => location.reload());
      }
    });
  }
  update(_t: number, delta: number): void {
    pumpUploads();
    this.star.angle += delta * 0.12;
    if (this.ready) this.scene.start('Title');
  }
}
