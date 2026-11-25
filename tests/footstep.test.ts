import type Phaser from 'phaser';
import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { BlendModes: { NORMAL: 0, ADD: 1 } } }));
vi.mock('../src/game/assets.ts', () => ({ frameFor: () => ({ key: 'item' }), wantChar: () => true }));
vi.mock('../src/game/puppet.ts', () => ({ Puppet: class {} }));
vi.mock('../src/game/audio.ts', () => ({ Sound: { sfx() {} } }));

const { Fx } = await import('../src/game/world/fx.ts');

class Picture {
  x = 0;
  y = 0;
  scaleX = 1;
  depth = 0;
  alpha = 1;
  angle = 0;
  tint = 0;
  visible = false;
  setTexture() {
    return this;
  }
  setPosition(x: number, y: number) {
    this.x = x;
    this.y = y;
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
  setScale(s: number) {
    this.scaleX = s;
    return this;
  }
  setAngle(a: number) {
    this.angle = a;
    return this;
  }
  setTint(t: number) {
    this.tint = t;
    return this;
  }
  setDepth(d: number) {
    this.depth = d;
    return this;
  }
  setBlendMode() {
    return this;
  }
}

function setup() {
  const pictures: Picture[] = [];
  const graphics: Record<string, unknown> = {};
  for (const method of [
    'fillStyle',
    'fillCircle',
    'fillRect',
    'lineStyle',
    'strokeCircle',
    'beginPath',
    'moveTo',
    'lineTo',
    'closePath',
    'fillPath',
    'fillTriangle',
    'fillRoundedRect',
    'arc',
    'strokePath',
    'generateTexture',
    'destroy',
  ])
    graphics[method] = () => graphics;
  const scene = {
    textures: { exists: () => false },
    make: { graphics: () => graphics },
    add: {
      image: () => {
        const p = new Picture();
        pictures.push(p);
        return p;
      },
    },
  };
  return { fx: new Fx(scene as unknown as Phaser.Scene), pictures };
}

describe('footstep effects', () => {
  it('retains the larger dust burst for digging and tool actions', () => {
    const { fx, pictures } = setup();
    fx.play('dust', 2, 3);
    expect(pictures).toHaveLength(6);
    expect(pictures.every((particle) => particle.depth > 0)).toBe(true);
  });

  it('keeps dust small and behind the cast, then resets pooled depth for other effects', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      const { fx, pictures } = setup();
      fx.play('footstep', 2, 3, 128);
      expect(pictures).toHaveLength(3);
      for (const p of pictures) {
        expect(p.depth).toBe(-600);
        expect(p.y).toBe(193);
        expect(p.scaleX * 64).toBeLessThan(20);
        expect(p.tint).toBe(0xd8c8a8);
      }
      fx.update(0.1);
      for (const p of pictures) {
        expect(Math.abs(p.y - 192)).toBeLessThan(8);
        expect(p.depth).toBe(-600);
      }
      fx.update(1);
      fx.play('place', 2, 3);
      expect(pictures).toHaveLength(6);
      for (const p of pictures) expect(p.depth).toBe(192 - 6 + 400);
    } finally {
      random.mockRestore();
    }
  });

  it('keeps a smaller snow footstep light and honours fewer effects', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      const { fx, pictures } = setup();
      fx.low = true;
      fx.play('footstep', 0, 0, 64, 'snow');
      expect(pictures).toHaveLength(2);
      for (const p of pictures) {
        expect(p.depth).toBe(-600);
        expect(p.tint).toBe(0xf4f8ff);
        expect(p.scaleX).toBeLessThan(0.2);
      }
    } finally {
      random.mockRestore();
    }
  });
});
