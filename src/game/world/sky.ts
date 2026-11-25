// Night as one blue wash with warm pools of light, snow for the Christmas layer, and darkness in the Mine.
import Phaser from 'phaser';
import { darkness } from '../../core/cond.ts';

/** the darkest the wash ever gets (0 none, 1 the full night colour) */
const MAX_DARK = 0.8;
/** the night colour's green in the blocky lands (elsewhere 0x3a) */
const BLOCKY_NIGHT_G = 0x1a;

export class Sky {
  private scene: Phaser.Scene;
  private wash: Phaser.GameObjects.Rectangle;
  private lights: Phaser.GameObjects.Image[] = [];
  /** under each light, a multiply pool that takes the night's blue back out, so the light reads amber, not grey */
  private warms: Phaser.GameObjects.Image[] = [];
  private used = 0;
  private snowA: Phaser.GameObjects.TileSprite;
  private snowB: Phaser.GameObjects.TileSprite;
  private t = 0;
  level = 0;
  /** 0 the usual night colour, 1 the blocky lands' night colour */
  private tone = 0;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    const w = scene.scale.width;
    const h = scene.scale.height;
    // twice the screen, centred on it: the camera zooms out to 0.85 in a boss fight, and a screen-sized wash would
    // then leave the edges in daylight
    this.wash = scene.add
      .rectangle(-w / 2, -h / 2, w * 2, h * 2, 0x26306e, 1)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(90000)
      .setBlendMode(Phaser.BlendModes.MULTIPLY)
      .setVisible(false);
    if (!scene.textures.exists('fx_light')) {
      const tex = scene.textures.createCanvas('fx_light', 256, 256)!;
      const c = tex.getContext();
      const grd = c.createRadialGradient(128, 128, 8, 128, 128, 128);
      grd.addColorStop(0, 'rgba(255,184,96,0.46)');
      grd.addColorStop(0.45, 'rgba(255,160,70,0.2)');
      grd.addColorStop(1, 'rgba(255,140,50,0)');
      c.fillStyle = grd;
      c.fillRect(0, 0, 256, 256);
      tex.refresh();
    }
    if (!scene.textures.exists('fx_light_warm')) {
      const tex = scene.textures.createCanvas('fx_light_warm', 128, 128)!;
      const c = tex.getContext();
      const grd = c.createRadialGradient(64, 64, 4, 64, 64, 64);
      grd.addColorStop(0, 'rgba(255,176,96,0.85)');
      grd.addColorStop(0.5, 'rgba(255,196,128,0.45)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = grd;
      c.fillRect(0, 0, 128, 128);
      tex.refresh();
    }
    if (!scene.textures.exists('fx_snow')) {
      const tex = scene.textures.createCanvas('fx_snow', 256, 256)!;
      const c = tex.getContext();
      c.fillStyle = '#fff';
      for (let i = 0; i < 26; i++) {
        c.globalAlpha = 0.5 + ((i * 37) % 50) / 100;
        c.beginPath();
        c.arc((i * 89) % 256, (i * 151) % 256, 1.5 + ((i * 7) % 3), 0, Math.PI * 2);
        c.fill();
      }
      tex.refresh();
    }
    this.snowA = scene.add
      .tileSprite(0, 0, w, h, 'fx_snow')
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(90500)
      .setVisible(false);
    this.snowB = scene.add
      .tileSprite(0, 0, w, h, 'fx_snow')
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(90501)
      .setAlpha(0.6)
      .setVisible(false);
    this.snowB.setTileScale(1.7);
  }

  /** Start a frame: set the wash for the time of day (or a dark place) and forget last frame's lights. */
  begin(
    time: number,
    darkPlace: boolean,
    indoor: boolean,
    snow: boolean,
    extraDark: number,
    dt: number,
    camX: number,
    camY: number,
    blocky = false,
  ): void {
    this.t += dt;
    // the blocky lands' grass is a bright, full green that a plain blue wash leaves looking like day (the chapter 5
    // village at night): there the night takes more of the green out, eased in over a second as she walks in
    const toneTo = blocky && !darkPlace ? 1 : 0;
    this.tone += (toneTo - this.tone) * Math.min(1, dt * 2);
    // fun panel 7: a floor under the dark. Night, a cave and a dark story scene all stop at MAX_DARK, so she, the
    // mobs and the goal star always read; her own pool of light does the rest.
    // package 60: outdoors at dusk and night the wash is a little lighter (0.66, was 0.78), so lanes, gaps in the
    // hedges and the mobs' tags stay readable without any new light
    const lvl = Math.min(MAX_DARK, Math.max(darkPlace ? MAX_DARK : indoor ? 0 : darkness(time) * 0.66, extraDark));
    this.level = lvl;
    this.wash.setVisible(lvl > 0.01);
    if (lvl > 0.01) {
      // MULTIPLY: white leaves the picture alone, the night colour darkens and cools it.
      // package 48: a deeper blue, so the lamps' amber pools stand out against it
      const r = Math.round(255 - (255 - 0x28) * lvl);
      const g = Math.round(255 - (255 - (0x3a - (0x3a - BLOCKY_NIGHT_G) * this.tone)) * lvl);
      const b = Math.round(255 - (255 - 0x9a) * lvl);
      this.wash.setFillStyle((r << 16) | (g << 8) | b, 1);
    }
    this.used = 0;
    const snowing = snow && !indoor && !darkPlace;
    this.snowA.setVisible(snowing);
    this.snowB.setVisible(snowing);
    if (snowing) {
      this.snowA.setTilePosition(camX * 0.9 + Math.sin(this.t * 0.6) * 20, camY * 0.9 - this.t * 60);
      this.snowB.setTilePosition(camX * 0.6 - this.t * 12, camY * 0.6 - this.t * 38);
    }
  }

  /** A pool of warm light at a world position; radius in tiles. Only drawn when it is dark enough to matter. */
  light(x: number, y: number, radius: number, strength = 1): void {
    if (this.level < 0.08) return;
    let img = this.lights[this.used];
    if (!img) {
      img = this.scene.add.image(0, 0, 'fx_light').setBlendMode(Phaser.BlendModes.ADD).setDepth(90100);
      this.lights.push(img);
    }
    let warm = this.warms[this.used];
    if (!warm) {
      warm = this.scene.add.image(0, 0, 'fx_light_warm').setBlendMode(Phaser.BlendModes.MULTIPLY).setDepth(90050);
      this.warms.push(warm);
    }
    this.used++;
    const flick = 1 + Math.sin(this.t * 7 + x * 0.01) * 0.03;
    const alpha = Math.min(1, this.level * 1.15) * strength;
    img
      .setVisible(true)
      .setPosition(x, y)
      .setScale(((radius * 64) / 128) * flick)
      .setAlpha(alpha);
    warm
      .setVisible(true)
      .setPosition(x, y)
      .setScale(((radius * 64) / 64) * 0.85)
      .setAlpha(Math.min(1, alpha * 1.2));
  }

  end(): void {
    for (let i = this.used; i < this.lights.length; i++) this.lights[i]!.setVisible(false);
    for (let i = this.used; i < this.warms.length; i++) this.warms[i]!.setVisible(false);
  }
}
