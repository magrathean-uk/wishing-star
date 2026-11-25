import { readFileSync } from 'node:fs';
import type Phaser from 'phaser';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/game/assets.ts', () => ({
  art: {
    chars: {
      sets: {
        sample: {
          group: 'sample',
          tall: 1.5,
          w: 100,
          h: 100,
          footY: 90,
          px: 100,
          clips: {
            idle: { down: ['idle'], side: ['idle'] },
            walk: { down: ['walk0', 'walk1', 'walk2', 'walk3'], side: ['walk0', 'walk1', 'walk2', 'walk3'] },
            talk: { down: ['talk0', 'talk1', 'talk2', 'talk3'], side: ['talk0', 'talk1', 'talk2', 'talk3'] },
            swing: { down: ['swing0', 'swing1', 'swing2'] },
            cheer: { down: ['cheer0', 'cheer1'] },
          },
          timing: { walk: { durs: [0.1, 0.1, 0.1, 0.1], step: [1, 3] } },
        },
        fine: {
          group: 'fine',
          tall: 1.5,
          w: 100,
          h: 100,
          footY: 90,
          px: 100,
          clips: {
            idle: { down: ['idle'] },
            walk: { side: Array.from({ length: 8 }, (_, i) => `fine${i}`) },
          },
          // Some series deliberately skip a pose, while contact is the first and fifth drawn frame.
          timing: { walk: { durs: [0.1, 0.1, 0.1, 0, 0.1, 0.1, 0.1, 0], step: [0, 4] } },
        },
        mixed: {
          group: 'mixed',
          tall: 1.5,
          w: 100,
          h: 100,
          footY: 90,
          px: 100,
          clips: {
            idle: { down: ['idle'] },
            walk: {
              down: Array.from({ length: 8 }, (_, i) => `down${i}`),
              side: Array.from({ length: 4 }, (_, i) => `side${i}`),
            },
            run: { side: ['run0', 'run1', 'run2', 'run3'] },
          },
          timing: {
            walk: { durs: [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1], step: [0, 4] },
            run: { durs: [0.05, 0.05, 0.05, 0.05], step: [1, 3] },
          },
        },
        mixedSkipped: {
          group: 'mixed',
          tall: 1.5,
          w: 100,
          h: 100,
          footY: 90,
          px: 100,
          clips: {
            idle: { down: ['idle'] },
            walk: {
              down: Array.from({ length: 8 }, (_, i) => `down${i}`),
              side: Array.from({ length: 4 }, (_, i) => `side${i}`),
            },
          },
          timing: { walk: { durs: [0.1, 0, 0.1, 0, 0.1, 0, 0.1, 0], step: [0, 4] } },
        },
        facingContacts: {
          group: 'mixed',
          tall: 1.5,
          w: 100,
          h: 100,
          footY: 90,
          px: 100,
          clips: {
            idle: { down: ['idle'] },
            walk: {
              down: Array.from({ length: 4 }, (_, i) => `down${i}`),
              side: Array.from({ length: 8 }, (_, i) => `side${i}`),
            },
          },
          timing: {
            walk: { durs: [0.1, 0.1, 0.1, 0.1], step: [1, 3], stepByFacing: { side: [0, 4] } },
          },
        },
        untimedContacts: {
          group: 'mixed',
          tall: 1.5,
          w: 100,
          h: 100,
          footY: 90,
          px: 100,
          clips: {
            idle: { down: ['idle'] },
            walk: {
              down: Array.from({ length: 4 }, (_, i) => `down${i}`),
              side: Array.from({ length: 4 }, (_, i) => `side${i}`),
            },
          },
          timing: { walk: { durs: [], stepByFacing: { side: [0, 2] } } },
        },
        hopper: {
          group: 'hopper',
          tall: 1.5,
          w: 100,
          h: 100,
          footY: 90,
          px: 100,
          clips: { idle: { down: ['idle'] }, hop: { side: ['hop0', 'hop1'] } },
          timing: { hop: { durs: [0.1, 0.2] } },
        },
        directional: {
          group: 'directional',
          tall: 1.5,
          w: 100,
          h: 100,
          footY: 90,
          px: 100,
          clips: {
            idle: { down: ['idle-down'], side: ['idle-side'], up: ['idle-up'] },
            talk: { down: ['talk-down-0', 'talk-down-1'], side: ['talk-side-0', 'talk-side-1'] },
          },
        },
        missingRest: {
          group: 'missingRest',
          tall: 1.5,
          w: 100,
          h: 100,
          footY: 90,
          px: 100,
          clips: {
            idle: { up: ['idle-up'] },
            talk: { down: ['talk-down-0', 'talk-down-1'], side: ['talk-side-0', 'talk-side-1'] },
          },
        },
      },
    },
  },
  charPage: () => 'sample-page',
  pinChar: () => 'sample',
  unpinChar: () => undefined,
  wantChar: () => true,
}));

const { Puppet } = await import('../src/game/puppet.ts');
const { art } = await import('../src/game/assets.ts');

class Picture {
  x = 0;
  y = 0;
  scaleX = 1;
  scaleY = 1;
  angle = 0;
  depth = 0;
  visible = true;
  alpha = 1;
  originX = 0.5;
  originY = 0.5;
  flipX = false;
  crop: number[] = [];
  width = 100;
  height = 100;
  texture = { key: '__DEFAULT' };
  frame = {
    name: 'idle',
    texture: this.texture,
    source: { image: {} },
    cutX: 0,
    cutY: 0,
    cutWidth: 100,
    cutHeight: 100,
    realWidth: 100,
    realHeight: 100,
    x: 0,
    y: 0,
  };
  setTexture(key: string, name = 'idle') {
    this.texture = { key };
    this.frame = { ...this.frame, name, texture: this.texture };
    return this;
  }
  setOrigin(x: number, y: number) {
    this.originX = x;
    this.originY = y;
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
  setAngle(angle: number) {
    this.angle = angle;
    return this;
  }
  setDepth(depth: number) {
    this.depth = depth;
    return this;
  }
  setVisible(visible: boolean) {
    this.visible = visible;
    return this;
  }
  setAlpha(alpha: number) {
    this.alpha = alpha;
    return this;
  }
  setFlipX(flip: boolean) {
    this.flipX = flip;
    return this;
  }
  setCrop(...crop: number[]) {
    this.crop = crop;
    return this;
  }
  setTint() {
    return this;
  }
  clearTint() {
    return this;
  }
  setScrollFactor() {
    return this;
  }
  destroy() {}
}

function setup(ui = false, lowFx = false, charId = 'sample') {
  const pictures: Picture[] = [];
  const graphic = {
    fillStyle() {
      return this;
    },
    fillEllipse() {
      return this;
    },
    generateTexture() {
      return this;
    },
    destroy() {},
  };
  const scene = {
    g: { s: { opts: { lowFx } } },
    textures: { exists: () => true },
    make: { graphics: () => graphic },
    add: {
      image: () => {
        const p = new Picture();
        pictures.push(p);
        return p;
      },
      sprite: () => {
        const p = new Picture();
        pictures.push(p);
        return p;
      },
    },
  };
  const puppet = new Puppet(scene as unknown as Phaser.Scene, charId, 1.5, ui);
  return { puppet, scene, pictures };
}

describe('puppet motion', () => {
  it('leans from travel, settles on stopping and reverses without shifting the ground point', () => {
    const { puppet: p } = setup();
    p.setPos(0, 20);
    p.play('walk', 'right');
    p.update(1 / 60);
    for (let i = 1; i <= 30; i++) {
      p.setPos(i * 4, 20);
      p.update(1 / 60);
    }
    expect(p.sprite.angle).toBeGreaterThan(1);
    expect(p.sprite.x).toBe(120);
    expect(p.sprite.y).toBe(20);
    expect(p.shadow.x).toBe(120);
    expect(p.sprite.depth).toBe(20);
    expect(p.shadow.depth).toBe(19.5);
    p.play('walk', 'left');
    for (let i = 1; i <= 30; i++) {
      p.setPos(120 - i * 4, 20);
      p.update(1 / 60);
    }
    expect(p.sprite.angle).toBeLessThan(-1);
    p.play('idle', 'left');
    for (let i = 0; i < 60; i++) {
      p.setPos(0, 20);
      p.update(1 / 60);
    }
    expect(Math.abs(p.sprite.angle)).toBeLessThan(0.01);
  });

  it('keeps the authored frames and footstep cadence, including with fewer effects', () => {
    for (const lowFx of [false, true]) {
      const { puppet: p } = setup(false, lowFx);
      const step = vi.fn();
      p.onStep = step;
      p.setPos(0, 0);
      p.play('walk', 'right');
      p.update(0);
      for (let i = 1; i <= 4; i++) {
        p.setPos(i * 21.816, 0);
        p.update(0.101);
        expect(p.sprite.frame.name).toBe(`walk${i % 4}`);
      }
      expect(step).toHaveBeenCalledTimes(2);
      if (lowFx) expect(p.sprite.angle).toBe(0);
    }
  });

  it('preserves contact steps and skipped poses in an eight-frame walk', () => {
    const { puppet: p } = setup(false, false, 'fine');
    const step = vi.fn();
    p.onStep = step;
    p.setPos(0, 0);
    p.play('walk', 'right');
    p.update(0);
    for (const [i, frame] of [1, 2, 4, 5, 6, 0].entries()) {
      p.setPos((i + 1) * 21.816, 0);
      p.update(0.101);
      expect(p.sprite.frame.name).toBe(`fine${frame}`);
    }
    expect(step).toHaveBeenCalledTimes(2);
  });

  it('keeps the walk and its steps tied to travel, including pauses and teleports', () => {
    const { puppet: a, scene } = setup();
    const { puppet: b } = setup();
    const step = vi.fn();
    a.onStep = step;
    for (const p of [a, b]) {
      p.setPos(0, 0);
      p.play('walk', 'right');
      p.update(0);
    }
    a.setPos(21.816, 0);
    a.update(0.101);
    b.setPos(10.908, 0);
    b.update(0.101);
    b.setPos(21.816, 0);
    b.update(0.101);
    expect(a.sprite.frame.name).toBe(b.sprite.frame.name);
    expect(step).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 30; i++) {
      a.setPos(21.816, 0);
      a.update(1 / 60);
    }
    expect(a.sprite.frame.name).toBe(b.sprite.frame.name);
    expect(step).toHaveBeenCalledTimes(1);
    a.setPos(1000, 0);
    a.update(1 / 60);
    expect(a.sprite.frame.name).toBe(b.sprite.frame.name);
    expect(step).toHaveBeenCalledTimes(1);
    Object.assign(scene.g, { rt: { paused: true } });
    a.setPos(1010, 0);
    a.update(1 / 60);
    expect(a.sprite.frame.name).toBe(b.sprite.frame.name);
    expect(step).toHaveBeenCalledTimes(1);
  });

  it('maps authored timing and contacts onto a shorter facing and uses walk timing for a run fallback', () => {
    const { puppet: p } = setup(false, false, 'mixed');
    const step = vi.fn();
    p.onStep = step;
    p.setPos(0, 0);
    p.play('walk', 'right');
    p.update(0);
    for (let i = 1; i <= 8; i++) {
      p.setPos(i * 21.816, 0);
      p.update(0.101);
      expect(p.sprite.frame.name).toBe(`side${Math.floor((i * 0.101) / 0.2) % 4}`);
    }
    expect(step).toHaveBeenCalledTimes(2);
    p.play('run', 'down');
    p.update(0);
    p.setPos(9 * 21.816, 0);
    p.update(0.101);
    expect(p.sprite.frame.name).toBe('down1');
  });

  it('keeps zero-duration authored poses and contacts when only the side has four drawings', () => {
    const { puppet: p } = setup(false, false, 'mixedSkipped');
    const step = vi.fn();
    p.onStep = step;
    p.setPos(0, 0);
    p.play('walk', 'right');
    p.update(0);
    for (let i = 1; i <= 4; i++) {
      p.setPos(i * 21.816, 0);
      p.update(0.101);
      expect(p.sprite.frame.name).toBe(`side${i % 4}`);
    }
    expect(step).toHaveBeenCalledTimes(2);
    p.play('idle', 'down');
    p.play('walk', 'down');
    p.update(0);
    for (let i = 1; i <= 4; i++) {
      p.setPos((i + 4) * 21.816, 0);
      p.update(0.101);
      expect(p.sprite.frame.name).toBe(`down${(i * 2) % 8}`);
    }
    expect(step).toHaveBeenCalledTimes(4);
  });

  it('plays all eight installed Flop side cels while retaining the legacy front timing', () => {
    const index = JSON.parse(readFileSync(new URL('../public/assets/chars/index.json', import.meta.url), 'utf8'));
    const def = index.sets.flop;
    art.chars.sets.flop = def;
    const { puppet: p } = setup(false, false, 'flop');
    const seen = new Set<string>();
    p.setPos(0, 0);
    p.play('walk', 'right');
    p.update(0);
    seen.add(p.sprite.frame.name);
    for (let i = 1; i <= 90; i++) {
      p.setPos(i * 3.6, 0);
      p.update(1 / 60);
      seen.add(p.sprite.frame.name);
    }
    expect(seen).toEqual(new Set(def.clips.walk.side));
    expect(def.timing.walk.dursByFacing.side.reduce((a: number, b: number) => a + b, 0)).toBeCloseTo(0.76);
    p.play('idle', 'down');
    p.play('walk', 'down');
    p.update(0);
    const front = new Set<string>([p.sprite.frame.name]);
    for (let i = 1; i <= 90; i++) {
      p.setPos((i + 90) * 3.6, 0);
      p.update(1 / 60);
      front.add(p.sprite.frame.name);
    }
    expect(front.has(def.clips.walk.down[3])).toBe(false);
    expect(front.has(def.clips.walk.down[7])).toBe(false);
    expect(front.size).toBe(6);
  });

  it.each(['mimmy', 'daddy_pig', 'george'])(
    'shows every installed %s front expression while preserving the older side timing',
    (id) => {
      const index = JSON.parse(readFileSync(new URL('../public/assets/chars/index.json', import.meta.url), 'utf8'));
      const def = index.sets[id];
      art.chars.sets[id] = def;
      const { puppet: p } = setup(true, false, id);
      const talk = { who: id, text: 'A'.repeat(120), shown: 0 };
      const front = new Set<string>();
      for (let shown = 1; shown <= 70; shown++) {
        talk.shown = shown;
        p.playDialogue('idle', 'down', talk, id);
        p.update(1 / 60);
        front.add(p.sprite.frame.name);
      }
      expect(front).toEqual(new Set(def.clips.talk.down));
      const side = new Set<string>();
      for (let shown = 1; shown <= 70; shown++) {
        talk.shown = shown;
        p.playDialogue('idle', 'right', talk, id);
        p.update(1 / 60);
        side.add(p.sprite.frame.name);
      }
      expect(side.has(def.clips.talk.side[id === 'mimmy' ? 2 : 3])).toBe(false);
      expect(side.size).toBe(id === 'mimmy' ? 2 : 3);
    },
  );

  it('honours facing-specific contacts without changing legacy front contacts', () => {
    const { puppet: p } = setup(false, false, 'facingContacts');
    const step = vi.fn();
    p.onStep = step;
    p.setPos(0, 0);
    p.play('walk', 'right');
    p.update(0);
    for (let i = 1; i <= 4; i++) {
      p.setPos(i * 21.816, 0);
      p.update(0.101);
      expect(p.sprite.frame.name).toBe(`side${(i * 2) % 8}`);
      expect(step).toHaveBeenCalledTimes(Math.floor(i / 2));
    }
    p.play('idle', 'down');
    p.play('walk', 'down');
    p.update(0);
    for (let i = 1; i <= 4; i++) {
      p.setPos((i + 4) * 21.816, 0);
      p.update(0.101);
      expect(p.sprite.frame.name).toBe(`down${i % 4}`);
      expect(step).toHaveBeenCalledTimes(2 + Math.floor((i + 1) / 2));
    }
  });

  it('uses default timing alongside contact overrides when there were no authored durations', () => {
    const { puppet: p } = setup(false, false, 'untimedContacts');
    const step = vi.fn();
    p.onStep = step;
    p.setPos(0, 0);
    p.play('walk', 'right');
    p.update(0);
    for (let i = 1; i <= 4; i++) {
      p.setPos(i * 27.216, 0);
      p.update(0.126);
      expect(p.sprite.frame.name).toBe(`side${i % 4}`);
      expect(step).toHaveBeenCalledTimes(Math.floor(i / 2));
    }
    p.play('idle', 'down');
    p.play('walk', 'down');
    p.update(0);
    for (let i = 1; i <= 4; i++) {
      p.setPos((i + 4) * 27.216, 0);
      p.update(0.126);
      expect(p.sprite.frame.name).toBe(`down${i % 4}`);
      expect(step).toHaveBeenCalledTimes(2 + Math.floor((i + 1) / 2));
    }
  });

  it('uses a non-human hop fallback without inventing footsteps', () => {
    const { puppet: p } = setup(false, false, 'hopper');
    const step = vi.fn();
    p.onStep = step;
    p.setPos(0, 0);
    p.play('walk', 'right');
    p.update(0);
    p.setPos(21.816, 0);
    p.update(0.101);
    expect(p.sprite.frame.name).toBe('hop1');
    expect(step).not.toHaveBeenCalled();
  });

  it('synchronises portrait and world speech, resting at pauses and when a line is answered', () => {
    const { puppet: portrait } = setup(true);
    const { puppet: world } = setup();
    const talk = { who: 'speaker', text: 'Hello friend, welcome aboard!', shown: 0 };
    const frames = new Set<string>();
    for (let shown = 0; shown < talk.text.length; shown++) {
      talk.shown = shown;
      portrait.playDialogue('idle', 'down', talk, 'speaker');
      world.playDialogue('idle', 'right', talk, 'speaker');
      portrait.update(1 / 60);
      world.update(1 / 60);
      expect(portrait.sprite.frame.name).toBe(world.sprite.frame.name);
      frames.add(portrait.sprite.frame.name);
    }
    expect(frames.has('idle')).toBe(true);
    expect([...frames].filter((f) => f.startsWith('talk')).length).toBeGreaterThan(1);
    talk.shown = talk.text.length;
    world.playDialogue('talk', 'right', talk, 'speaker');
    world.update(0);
    expect(world.sprite.frame.name).toBe('idle');
    talk.shown = 5;
    talk.who = 'friend';
    world.playDialogue('talk', 'right', talk, 'speaker');
    world.update(0);
    expect(world.sprite.frame.name).toBe('idle');
    talk.who = 'speaker';
    world.playDialogue('idle', 'right', talk, 'speaker', false);
    world.update(0);
    expect(world.sprite.frame.name).toBe('idle');
    world.playDialogue('swing', 'down', talk, 'speaker', true, true);
    world.update(0);
    expect(world.sprite.frame.name).toBe('swing0');
    world.update(0.2);
    world.playDialogue('swing', 'down', talk, 'speaker', true, true);
    world.update(0);
    expect(world.sprite.frame.name).toBe('swing0');
    world.playDialogue('cheer', 'down', talk, 'speaker', true, false, true);
    world.update(0);
    expect(world.sprite.frame.name).toMatch(/^talk/);
    talk.shown = talk.text.length;
    world.playDialogue('cheer', 'down', talk, 'speaker', true, false, true);
    world.update(0);
    expect(world.sprite.frame.name).toBe('idle');
    talk.who = 'friend';
    talk.shown = 5;
    world.playDialogue('cheer', 'down', talk, 'speaker', true, false, true);
    world.update(0);
    expect(world.sprite.frame.name).toBe('idle');
    world.playDialogue('cheer', 'down', null, 'speaker', true, false, true);
    world.update(0);
    expect(world.sprite.frame.name).toBe('cheer0');
  });

  it('rests and resumes using the resolved talk facing, preserving side mirroring', () => {
    const { puppet: p } = setup(false, false, 'directional');
    const talk = { who: 'speaker', text: 'Longer words, all good today.', shown: 2 };
    p.playDialogue('idle', 'up', talk, 'speaker');
    p.update(0);
    expect(p.sprite.frame.name).toBe('talk-down-0');
    expect(p.sprite.flipX).toBe(false);
    talk.shown = 13;
    p.playDialogue('idle', 'up', talk, 'speaker');
    p.update(0);
    expect(p.sprite.frame.name).toBe('idle-down');
    talk.shown = 22;
    p.playDialogue('idle', 'up', talk, 'speaker');
    p.update(0);
    expect(p.sprite.frame.name).toBe('talk-down-1');

    talk.shown = 2;
    p.playDialogue('idle', 'left', talk, 'speaker');
    p.update(0);
    expect(p.sprite.frame.name).toBe('talk-side-0');
    expect(p.sprite.flipX).toBe(true);
    talk.shown = 13;
    p.playDialogue('idle', 'left', talk, 'speaker');
    p.update(0);
    expect(p.sprite.frame.name).toBe('idle-side');
    expect(p.sprite.flipX).toBe(true);
    p.playDialogue('idle', 'right', talk, 'speaker');
    p.update(0);
    expect(p.sprite.frame.name).toBe('idle-side');
    expect(p.sprite.flipX).toBe(false);
  });

  it('rests on the selected talk facing when its matching idle is missing', () => {
    const { puppet: p } = setup(false, false, 'missingRest');
    const talk = { who: 'speaker', text: 'Longer words, all good today.', shown: 13 };
    p.playDialogue('idle', 'up', talk, 'speaker');
    p.update(0);
    expect(p.sprite.frame.name).toBe('talk-down-0');
    expect(p.sprite.flipX).toBe(false);
    p.playDialogue('idle', 'left', talk, 'speaker');
    p.update(0);
    expect(p.sprite.frame.name).toBe('talk-side-0');
    expect(p.sprite.flipX).toBe(true);
    talk.shown = 22;
    p.playDialogue('idle', 'left', talk, 'speaker');
    p.update(0);
    expect(p.sprite.frame.name).toBe('talk-side-1');
    expect(p.sprite.flipX).toBe(true);
  });

  it('honours the system reduced-motion preference', () => {
    const preference = { matches: true };
    vi.stubGlobal('window', { matchMedia: () => preference });
    try {
      const { puppet: p } = setup();
      p.setPos(0, 0);
      p.play('walk', 'right');
      p.update(1 / 60);
      p.setPos(6, 0);
      p.update(1 / 60);
      expect(p.sprite.angle).toBe(0);
      preference.matches = false;
      p.setPos(12, 0);
      p.update(1 / 60);
      expect(p.sprite.angle).toBeGreaterThan(0);
    } finally {
      preference.matches = false;
      vi.unstubAllGlobals();
    }
  });

  it('does not lean for portraits, actions or a teleport', () => {
    const { puppet: ui } = setup(true);
    ui.setPos(0, 0);
    ui.play('walk', 'right');
    ui.update(1 / 60);
    ui.setPos(10, 0);
    ui.update(1 / 60);
    expect(ui.sprite.angle).toBe(0);
    expect(ui.shadow.visible).toBe(false);

    const { puppet: p } = setup();
    p.setPos(0, 0);
    p.play('walk', 'right');
    p.update(1 / 60);
    p.setPos(1000, 0);
    p.update(1 / 60);
    expect(p.sprite.angle).toBe(0);
    p.setPos(1004, 0);
    p.update(1 / 60);
    expect(p.sprite.angle).toBeGreaterThan(0);
    p.setPos(1004, 0);
    p.lift(0, 12);
    p.play('sit', 'right');
    p.update(0);
    expect(p.sprite.angle).toBe(12);
  });

  it('clips a scaled portrait at the requested screen line', () => {
    const { puppet: p } = setup(true);
    p.zoom = 4.2;
    p.setPos(1520, 900);
    p.update(0);
    p.cropBelow(772);
    const picture = p.sprite as unknown as Picture;
    const top = picture.y - 90 * picture.scaleY;
    expect(picture.crop[0]).toBe(0);
    expect(picture.crop[2]).toBe(100);
    expect(top + picture.crop[3]! * picture.scaleY).toBeCloseTo(772);
  });

  it('keeps the hat attached to a tilted pose and lets the ground shadow recede with lift', () => {
    const data = new Uint8ClampedArray(100 * 100 * 4);
    for (let y = 0; y < 20; y++) for (let x = 30; x < 70; x++) data[(y * 100 + x) * 4 + 3] = 255;
    const context = {
      canvas: { width: 0, height: 0 },
      clearRect() {},
      drawImage() {},
      getImageData: () => ({ data }),
    };
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => context }) });
    try {
      const { puppet: p, pictures } = setup();
      p.setPos(100, 200);
      p.update(0.2);
      const groundScale = p.shadow.scaleX;
      p.setHat({ key: 'hat' });
      p.setPos(100, 200);
      p.lift(32, 12);
      p.play('sit', 'right');
      p.update(1 / 60);
      const hat = pictures[2]!;
      expect(hat.visible).toBe(true);
      expect(hat.angle).toBe(12);
      expect(hat.x).toBeGreaterThan(p.sprite.x + 10);
      expect(p.shadow.y).toBe(202);
      expect(p.shadow.scaleX).toBeLessThan(groundScale);
      expect(p.shadow.alpha).toBeLessThan(1);
      p.setAlpha(0.5);
      expect(p.shadow.alpha).toBeLessThan(0.5);
      p.setPos(100, 200);
      p.lift(0);
      p.update(1 / 60);
      expect(p.shadow.scaleX).toBeCloseTo(groundScale);
      expect(p.shadow.alpha).toBeCloseTo(0.5);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
