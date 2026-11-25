import { describe, expect, it, vi } from 'vitest';
import { give } from '../src/core/bag.ts';
import { free, rebuildArea } from '../src/core/grid.ts';
import { findTarget, gather, stepHero } from '../src/core/hero.ts';
import { newGame } from '../src/core/state.ts';
import { NO_INPUT } from '../src/core/step.ts';
import type { AreaDef, Dir, Game } from '../src/core/types.ts';
import { content } from '../src/data/content.ts';
import { World } from '../src/game/scenes/World.ts';
import { Things } from '../src/game/world/things.ts';

vi.mock('phaser', () => ({ default: { Scene: class {}, Input: { Keyboard: { KeyCodes: {} } } } }));
vi.mock('../src/game/audio.ts', () => ({ Sound: {} }));
vi.mock('../src/game/assets.ts', () => ({
  art: { ground: { areas: {} }, chars: { sets: {} } },
  frameFor: (_scene: unknown, name: string) => ({ key: 'objects', frame: name }),
  worldFrame: (_scene: unknown, name: string) => ({ key: 'objects', frame: name }),
  hasArt: (name: string) => /^(oak|pine|palm|dark_oak|birch|block_oak|tree_stump)(?:_stump)?(?:_snow)?$/.test(name),
  PLACED_ART: {},
}));
vi.mock('../src/game/puppet.ts', () => ({ Puppet: class {} }));

/** Small renderer double: exercise the real Things lifecycle without opening a game window. */
class Picture {
  texture = { key: '__DEFAULT' };
  frame = { name: '__DEFAULT' };
  width = 206;
  height = 196;
  x = 0;
  y = 0;
  scaleX = 1;
  scaleY = 1;
  angle = 0;
  rotation = 0;
  alpha = 1;
  depth = 0;
  visible = true;
  flipX = false;
  crop: number[] | null = null;
  originX = 0.5;
  originY = 0.5;
  get displayWidth() {
    return this.width * this.scaleX;
  }
  get displayHeight() {
    return this.height * this.scaleY;
  }
  setTexture(key: string, name?: string) {
    this.texture = { key };
    this.frame = { name: name ?? key };
    [this.width, this.height] = size(this.frame.name);
    return this;
  }
  setCrop(...args: number[]) {
    this.crop = args.length ? args : null;
    return this;
  }
  setVisible(v: boolean) {
    this.visible = v;
    return this;
  }
  setAlpha(a: number) {
    this.alpha = a;
    return this;
  }
  setAngle(a: number) {
    this.angle = a;
    this.rotation = (a * Math.PI) / 180;
    return this;
  }
  setRotation(r: number) {
    this.rotation = r;
    this.angle = (r * 180) / Math.PI;
    return this;
  }
  setTint(_v: number) {
    return this;
  }
  setFlipX(v: boolean) {
    this.flipX = v;
    return this;
  }
  setPosition(x: number, y: number) {
    this.x = x;
    this.y = y;
    return this;
  }
  setScale(x: number, y = x) {
    this.scaleX = x;
    this.scaleY = y;
    return this;
  }
  setDisplaySize(w: number, h: number) {
    this.scaleX = w / this.width;
    this.scaleY = h / this.height;
    return this;
  }
  setOrigin(x: number, y: number) {
    this.originX = x;
    this.originY = y;
    return this;
  }
  setDepth(d: number) {
    this.depth = d;
    return this;
  }
  destroy() {
    this.visible = false;
  }
}

function size(name: string): [number, number] {
  if (name.includes('notch')) return [80, 32];
  if (name.startsWith('held-')) return [179, 192];
  if (name.includes('stump')) return [206, name.endsWith('_snow') ? 63 : 58];
  return [206, name.endsWith('_snow') ? 201 : 196];
}

function setup(type = 'oak', x = 10, winter = false, paintedNotch = true) {
  const area = {
    id: 'tree_test',
    objects: [{ id: 'test_tree', type, x, y: 10 }],
    region: [],
    barriers: [],
    sites: [],
  } as unknown as AreaDef;
  const g = newGame(content, { seed: 4, hero: 'amelia' });
  g.s.area = area.id;
  g.s.x = x - 0.5;
  g.s.y = 10.5;
  g.s.xmas = winter;
  g.s.placed = [];
  g.s.drops = [];
  const pictures: Picture[] = [];
  const canvas = {
    fillStyle: '',
    beginPath() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    fill() {},
  };
  const made = new Set<string>();
  const scene = {
    add: {
      image: () => {
        const p = new Picture();
        pictures.push(p);
        return p;
      },
    },
    textures: {
      exists: (key: string) => (key === 'forestry-notch' && paintedNotch) || made.has(key),
      getFrame: (_key: string, name: string) => ({ realHeight: size(name)[1] }),
      createCanvas: (key: string) => {
        made.add(key);
        return { getContext: () => canvas, refresh() {} };
      },
    },
  };
  const things = new Things(scene as unknown as Phaser.Scene, g);
  const camera = { worldView: { x: 0, y: 0, right: 2000, bottom: 2000 } };
  const draw = (dt = 0.016) => things.update(camera as Phaser.Cameras.Scene2D.Camera, dt, winter, () => {});
  const tree = area.objects[0]!;
  const def = content.objects[type]!;
  const hit = () => {
    gather(g, tree, 0, def);
    if (g.rt.dirty) g.rt.worldRev++;
    things.shake(0);
    g.rt.dirty = false;
  };
  const shown = (name: string) => pictures.filter((p) => p.visible && p.frame.name === name);
  const cut = () => pictures.find((p) => p.visible && p.texture.key.startsWith('forestry-notch'));
  things.setArea(area);
  draw();
  return { area, g, things, camera, draw, tree, hit, shown, cut, made };
}

describe('tree felling view', () => {
  it('cuts deeper on each ordinary hit, then falls across a world refresh and leaves only its own stump', () => {
    const h = setup();
    give(h.g, 'wood_axe');
    h.hit();
    h.draw();
    const first = h.cut()!.displayWidth;
    expect(h.g.s.flags['hit:test_tree']).toBe(1);
    h.hit();
    h.draw();
    expect(h.cut()!.displayWidth).toBeGreaterThan(first);
    expect(h.g.s.flags['hit:test_tree']).toBe(2);
    h.hit();
    expect(h.g.s.nodes.test_tree).toBe(h.g.s.day);
    expect(h.g.s.pouch.log ?? h.g.s.bag.find((slot) => slot?.id === 'log')?.n).toBeGreaterThan(0);
    h.draw();
    expect(h.shown('oak')).toHaveLength(1);
    expect(h.shown('oak')[0]!.crop).not.toBeNull();
    expect(h.shown('oak_stump')).toHaveLength(1);
    h.draw(0.5);
    const falling = h.shown('oak')[0]!;
    expect(falling.angle).toBeGreaterThan(0);
    const angle = falling.angle;
    h.g.rt.paused = true;
    h.draw(2);
    expect(falling.angle).toBe(angle);
    h.g.rt.paused = false;
    h.draw(1);
    expect(h.shown('oak')).toHaveLength(0);
    expect(h.shown('oak_stump')).toHaveLength(1);
    expect(h.cut()).toBeUndefined();
  });

  it('restores a cut after culling, and clears it when the tree regrows', () => {
    const h = setup();
    give(h.g, 'wood_axe');
    h.hit();
    h.draw();
    const first = h.cut()!.displayWidth;
    h.camera.worldView = { x: 5000, y: 5000, right: 6000, bottom: 6000 };
    h.draw();
    expect(h.shown('oak')).toHaveLength(0);
    expect(h.cut()).toBeUndefined();
    h.camera.worldView = { x: 0, y: 0, right: 2000, bottom: 2000 };
    h.draw();
    expect(h.cut()!.displayWidth).toBeCloseTo(first);
    delete h.g.s.flags['hit:test_tree'];
    h.g.rt.worldRev++;
    h.draw();
    expect(h.cut()).toBeUndefined();
    expect(h.shown('oak')).toHaveLength(1);
  });

  it('uses higher axe tiers, the winter stump, and a fall away from the player', () => {
    const h = setup('pine', 10, true);
    h.g.s.x = 12;
    give(h.g, 'stone_axe');
    h.hit();
    h.draw();
    expect(h.g.s.flags['hit:test_tree']).toBe(2);
    expect(h.cut()!.flipX).toBe(true);
    h.hit();
    h.draw(0.5);
    expect(h.shown('pine_snow')[0]!.angle).toBeLessThan(0);
    expect(h.shown('pine_stump_snow')).toHaveLength(1);
    h.draw(1);
    expect(h.shown('pine_snow')).toHaveLength(0);
  });

  it('shows one-hit felling with reduced effects and uses the shared fallback if art is unavailable', () => {
    const h = setup('palm', 10, false, false);
    h.g.s.opts.lowFx = true;
    give(h.g, 'iron_axe');
    h.hit();
    expect(h.cut()?.texture.key).toBe('forestry-notch-fallback');
    h.draw(0.5);
    expect(h.shown('palm')[0]!.angle).toBeGreaterThan(0);
    expect(h.shown('palm_stump')).toHaveLength(1);
    h.draw(1);
    expect(h.shown('palm')).toHaveLength(0);
  });

  it.each([
    [10, true],
    [11, false],
  ])('keeps tree and stump aligned when the picture at x=%s has flip=%s', (x, flipped) => {
    const h = setup('oak', x);
    h.g.s.x = x + 2;
    give(h.g, 'iron_axe');
    const tree = h.shown('oak')[0]!;
    expect(tree.flipX).toBe(flipped);
    h.hit();
    h.draw(0.5);
    const stump = h.shown('oak_stump')[0]!;
    expect(stump.flipX).toBe(flipped);
    expect(tree.angle).toBeLessThan(0);
    expect(tree.x).toBeLessThan(stump.x);
  });

  it('removes an off-screen fall and shows the regrown tree without a stale crop', () => {
    const h = setup();
    give(h.g, 'iron_axe');
    h.hit();
    h.draw(0.3);
    h.camera.worldView = { x: 5000, y: 5000, right: 6000, bottom: 6000 };
    h.draw();
    expect(h.shown('oak')).toHaveLength(0);
    h.camera.worldView = { x: 0, y: 0, right: 2000, bottom: 2000 };
    h.draw();
    expect(h.shown('oak')).toHaveLength(0);
    expect(h.shown('oak_stump')).toHaveLength(1);
    delete h.g.s.nodes.test_tree;
    h.g.rt.worldRev++;
    h.draw();
    expect(h.shown('oak')).toHaveLength(1);
    expect(h.shown('oak')[0]!.crop).toBeNull();
    expect(h.cut()).toBeUndefined();
  });

  it('switches an existing cut from the fallback to the painted art when it loads', () => {
    const h = setup('oak', 10, false, false);
    give(h.g, 'wood_axe');
    h.hit();
    h.draw();
    expect(h.cut()?.texture.key).toBe('forestry-notch-fallback');
    h.made.add('forestry-notch');
    h.draw();
    expect(h.cut()?.texture.key).toBe('forestry-notch');
  });

  it('reduces recoil without suppressing a one-hit fall', () => {
    const normal = setup();
    const low = setup();
    low.g.s.opts.lowFx = true;
    for (const h of [normal, low]) {
      give(h.g, 'iron_axe');
      h.hit();
      h.draw(0.07);
    }
    expect(low.shown('oak')[0]!.angle).toBeGreaterThan(0);
    expect(low.shown('oak')[0]!.angle).toBeLessThan(normal.shown('oak')[0]!.angle);
  });

  it('bounds concurrent falling pictures and still leaves every stump', () => {
    const h = setup();
    for (let i = 1; i < 10; i++) h.area.objects.push({ id: `tree_${i}`, type: 'oak', x: 10 + i, y: 10 });
    h.things.setArea(h.area);
    h.draw();
    give(h.g, 'iron_axe');
    for (let i = 0; i < 10; i++) {
      gather(h.g, h.area.objects[i]!, i, content.objects.oak!);
      h.things.shake(i);
    }
    h.g.rt.worldRev++;
    h.draw();
    expect(h.shown('oak')).toHaveLength(8);
    expect(h.shown('oak_stump')).toHaveLength(10);
    h.draw(2);
    expect(h.shown('oak')).toHaveLength(0);
    expect(h.shown('oak_stump')).toHaveLength(10);
  });
});

type TestWorld = {
  g: Game;
  things: Things;
  tool: Picture;
  hero: { height: number; play: () => void };
  textures: { exists: (key: string) => boolean };
  heroLift: number;
  swingItem: string | null;
  axeTarget: { area: string; index: number; point: { x: number; y: number; depth: number } } | null;
  sfxJuice: (id: string) => void;
  drawTool: (x: number, y: number) => void;
};

function contactFixture(type: string, x: number, winter: boolean, height: number) {
  const h = setup(type, x, winter);
  Object.assign(h.area, {
    w: 24,
    h: 24,
    terrain: Array.from({ length: 24 }, () => 'g'.repeat(24)),
    region: Array.from({ length: 24 }, () => 'H'.repeat(24)),
    // findTarget (package 69) looks at the doors round her too: this small area has none
    doors: [],
  });
  h.g.c = { ...content, areas: { ...content.areas, [h.area.id]: h.area } };
  h.g.rt.npcs = [];
  h.g.rt.beasts = [];
  h.g.rt.mobs = [];
  rebuildArea(h.g, h.area.id);
  h.things.setArea(h.area);
  h.draw();
  const world = new World() as unknown as TestWorld;
  world.g = h.g;
  world.things = h.things;
  world.tool = new Picture();
  world.hero = { height, play: () => {} };
  world.textures = { exists: (key) => key.startsWith('held-') };
  world.heroLift = 0;
  return { ...h, world };
}

function bladePosition(axe: Picture): { x: number; y: number } {
  const dx = (0.99 - 0.17) * axe.width * axe.scaleX;
  const dy = (0.31 - 0.82) * axe.height * axe.scaleY;
  const cos = Math.cos(axe.rotation);
  const sin = Math.sin(axe.rotation);
  return { x: axe.x + dx * cos - dy * sin, y: axe.y + dx * sin + dy * cos };
}

describe('axe contact', () => {
  it('puts the real painted blade on the cut at the rules hit tick from every normal approach', () => {
    const dirs: Dir[] = ['left', 'right', 'up', 'down'];
    for (const dir of dirs)
      for (const height of [1.15 * 64, 2.2 * 64])
        for (const x of [10, 11])
          for (const distance of [0.8, 1.2, 1.33])
            for (const offset of [-0.39, 0.39]) {
              const h = contactFixture('oak', x, x === 11, height);
              const axis = dir === 'left' || dir === 'up' ? 1 : -1;
              h.g.s.x = x + 0.5 + (dir === 'left' || dir === 'right' ? axis * distance : offset);
              h.g.s.y = 10.5 + (dir === 'up' || dir === 'down' ? axis * distance : offset);
              h.g.s.dir = dir;
              expect(free(h.g, h.area.id, h.g.s.x, h.g.s.y, 0.28)).toBe(true);
              expect(findTarget(h.g).objIndex).toBe(0);
              give(h.g, 'wood_axe');
              h.g.ev.length = 0;
              stepHero(h.g, { ...NO_INPUT, act: true });
              expect(h.g.ev.some((ev) => ev.t === 'sfx' && ev.id === 'swing')).toBe(true);
              h.world.sfxJuice('swing');
              let hit = false;
              for (let tick = 0; tick < 12 && !hit; tick++) {
                h.g.ev.length = 0;
                stepHero(h.g, NO_INPUT);
                hit = h.g.ev.some((ev) => ev.t === 'fx' && ev.id === 'hit');
                if (hit) h.things.shake(0);
                h.draw(1 / 60);
              }
              expect(hit).toBe(true);
              h.world.drawTool(h.g.s.x * 64, h.g.s.y * 64);
              const point = h.things.cutPoint(0)!;
              const blade = bladePosition(h.world.tool);
              expect(blade.x).toBeCloseTo(point.x, 5);
              expect(blade.y).toBeCloseTo(point.y, 5);
              expect(h.world.tool.depth).toBeGreaterThanOrEqual(point.depth);
              expect(h.world.tool.y).toBeLessThanOrEqual(h.g.s.y * 64 + 4.001);
              expect(Math.abs(h.world.tool.scaleX) * 192).toBeLessThanOrEqual(64 * 1.45 + 0.001);
            }
  });

  it('keeps the last cut target after the tree becomes a stump and resets after the swing', () => {
    const h = contactFixture('palm', 10, true, 112);
    h.g.s.x = 9.5;
    h.g.s.y = 10.5;
    h.g.s.dir = 'right';
    give(h.g, 'iron_axe');
    stepHero(h.g, { ...NO_INPUT, act: true });
    h.world.sfxJuice('swing');
    for (let tick = 0; tick < 12 && h.g.s.nodes.test_tree === undefined; tick++) stepHero(h.g, NO_INPUT);
    expect(h.g.s.nodes.test_tree).toBe(h.g.s.day);
    rebuildArea(h.g, h.area.id);
    h.things.shake(0);
    h.draw(1 / 60);
    expect(h.shown('palm_stump_snow')).toHaveLength(1);
    h.world.drawTool(h.g.s.x * 64, h.g.s.y * 64);
    const point = h.things.cutPoint(0)!;
    expect(bladePosition(h.world.tool).x).toBeCloseTo(point.x, 5);
    expect(bladePosition(h.world.tool).y).toBeCloseTo(point.y, 5);
    h.draw(0.2);
    expect(h.things.cutPoint(0)).toBeNull();
    h.world.drawTool(h.g.s.x * 64, h.g.s.y * 64);
    expect(h.world.axeTarget).not.toBeNull();
    h.g.rt.clip = 'idle';
    h.world.drawTool(h.g.s.x * 64, h.g.s.y * 64);
    expect(h.world.axeTarget).toBeNull();
    expect(h.world.tool.visible).toBe(false);
  });

  it('relatches each held swing and clears the target once the tree is gone', () => {
    const h = contactFixture('oak', 10, false, 112);
    h.g.s.x = 9.5;
    h.g.s.y = 10.5;
    h.g.s.dir = 'right';
    give(h.g, 'wood_axe');
    let starts = 0;
    h.world.hero.play = () => {
      starts++;
    };
    for (let tick = 0; tick < 100; tick++) {
      h.g.ev.length = 0;
      stepHero(h.g, { ...NO_INPUT, act: tick === 0, hold: true });
      if (h.g.rt.dirty) {
        rebuildArea(h.g, h.area.id);
        h.g.rt.dirty = false;
      }
      for (const ev of h.g.ev) {
        if (ev.t === 'sfx' && ev.id === 'swing') h.world.sfxJuice('swing');
        if (ev.t === 'fx' && ev.id === 'hit' && ev.n !== undefined) h.things.shake(ev.n);
      }
      h.draw(1 / 60);
      h.world.drawTool(h.g.s.x * 64, h.g.s.y * 64);
    }
    expect(starts).toBeGreaterThanOrEqual(3);
    expect(h.g.s.nodes.test_tree).toBe(h.g.s.day);
    expect(h.world.axeTarget).toBeNull();
  });

  it('uses the ordinary swing instead of an oversized axe for an unreachable point', () => {
    const h = contactFixture('oak', 10, false, 96);
    h.g.rt.clip = 'swing';
    h.g.rt.ct = 0.133;
    h.world.swingItem = 'wood_axe';
    h.world.axeTarget = { area: h.area.id, index: -1, point: { x: 9000, y: 9000, depth: 9000 } };
    h.world.drawTool(600, 600);
    expect(Math.abs(h.world.tool.scaleX) * 192).toBeCloseTo(64);
    expect(Math.hypot(h.world.tool.x - 600, h.world.tool.y - 600)).toBeLessThan(96);
    expect(h.world.tool.depth).toBeLessThan(9000);
  });
});
