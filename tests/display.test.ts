import { afterEach, describe, expect, it, vi } from 'vitest';
import type Phaser from 'phaser';
import { createRequire } from 'node:module';
import { displayTier, FrameBudget, installDisplay } from '../src/game/display.ts';

const RenderTarget = createRequire(import.meta.url)('phaser/src/renderer/webgl/RenderTarget.js');

describe('display resolution', () => {
  it('uses the fitted canvas in physical pixels, capped by the GPU', () => {
    expect(displayTier(1280, 720, 1, 8192, 8192)).toBe(0);
    expect(displayTier(1920, 1080, 1, 8192, 8192)).toBe(1);
    expect(displayTier(1280, 720, 2, 8192, 8192)).toBe(2);
    expect(displayTier(1920, 1080, 2, 8192, 8192)).toBe(3);
    expect(displayTier(1920, 1080, 2, 3000, 3000)).toBe(2);
    expect(displayTier(2559.9, 1439.9, 1, 8192, 8192)).toBe(2);
  });

  it('falls back only after sustained slow frames and recovers cautiously', () => {
    const budget = new FrameBudget();
    expect(Array.from({ length: 250 }, () => budget.sample(1000 / 30))).not.toContain(-1);
    expect(Array.from({ length: 150 }, () => budget.sample(1000 / 30))).toContain(-1);
    budget.reset();
    expect(Array.from({ length: 2500 }, () => budget.sample(1000 / 60))).not.toContain(1);
    expect(Array.from({ length: 1000 }, () => budget.sample(1000 / 60))).toContain(1);
  });

  it('does not treat a long pause as poor sustained frame rate', () => {
    const budget = new FrameBudget();
    for (let i = 0; i < 300; i++) budget.sample(1000 / 30);
    expect(budget.sample(1000)).toBe(0);
    expect(Array.from({ length: 250 }, () => budget.sample(1000 / 30))).not.toContain(-1);
    expect(Array.from({ length: 20 }, () => budget.sample(500))).toContain(-1);
  });
});

type Listener = { fn: (...args: any[]) => void; context?: unknown; once: boolean };
class Emitter {
  listeners = new Map<string, Listener[]>();
  on(event: string, fn: (...args: any[]) => void, context?: unknown): this {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), { fn, context, once: false }]);
    return this;
  }
  once(event: string, fn: (...args: any[]) => void, context?: unknown): this {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), { fn, context, once: true }]);
    return this;
  }
  off(event: string, fn: (...args: any[]) => void, context?: unknown): this {
    this.listeners.set(
      event,
      (this.listeners.get(event) ?? []).filter((listener) => listener.fn !== fn || listener.context !== context),
    );
    return this;
  }
  emit(event: string, ...args: any[]): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) {
      if (listener.once) this.off(event, listener.fn, listener.context);
      listener.fn.apply(listener.context, args);
    }
  }
}

afterEach(() => vi.unstubAllGlobals());

it('keeps logical coordinates, repairs failed targets, and restores a reduced buffer', () => {
  const events = new Emitter();
  const scale = new Emitter();
  const rendererEvents = new Emitter();
  let dpr = 2;
  let allocationLimit = 8192;
  let lost = false;
  let failResizeAt = 0;
  let boundFramebuffer: object | null = null;
  const listeners = new Map<string, () => void>();
  const doc = {
    hidden: false,
    hasFocus: () => true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    createElement: vi.fn(),
  };
  const win = {
    get devicePixelRatio() {
      return dpr;
    },
    matchMedia: () => ({
      addEventListener: (_: string, listener: () => void) => listeners.set('density', listener),
      removeEventListener: vi.fn(),
    }),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', win);
  const rect = { width: 1920, height: 1080 };
  const canvas = {
    width: 1920,
    height: 1080,
    style: { opacity: '' },
    dataset: {} as Record<string, string>,
    getBoundingClientRect: () => rect,
  };
  const gl = {
    MAX_VIEWPORT_DIMS: 1,
    MAX_TEXTURE_SIZE: 2,
    MAX_RENDERBUFFER_SIZE: 3,
    FRAMEBUFFER_BINDING: 4,
    FRAMEBUFFER: 5,
    getParameter: (param: number) => {
      if (param === 1) return new Int32Array([8192, 8192]);
      return param === 4 ? boundFramebuffer : 8192;
    },
    bindFramebuffer: (_: number, framebuffer: object | null) => {
      boundFramebuffer = framebuffer;
    },
    deleteFramebuffer: vi.fn(),
    isContextLost: () => lost,
    get drawingBufferWidth() {
      return Math.min(canvas.width, allocationLimit);
    },
    get drawingBufferHeight() {
      return canvas.height;
    },
  };
  const clips: number[][] = [];
  const projection: number[][] = [];
  const sizes: number[] = [];
  const unusedTargets = Array.from({ length: 7 }, () => ({ resize: vi.fn(), setAutoResize: vi.fn() }));
  const renderer = {
    gl,
    width: 1920,
    height: 1080,
    contextLost: false,
    renderTarget: unusedTargets[0]!,
    maskTarget: unusedTargets[1]!,
    maskSource: unusedTargets[2]!,
    pipelines: {
      fullFrame1: unusedTargets[3]!,
      fullFrame2: unusedTargets[4]!,
      halfFrame1: unusedTargets[5]!,
      halfFrame2: unusedTargets[6]!,
    },
    on: rendererEvents.on.bind(rendererEvents),
    onResize: vi.fn(),
    createTextureFromSource() {
      return { valid: true };
    },
    createFramebuffer(w: number) {
      if (w === failResizeAt && !lost) {
        failResizeAt = 0;
        boundFramebuffer = {};
        throw new Error('Framebuffer status: Incomplete Attachment');
      }
      return { valid: true };
    },
    deleteFramebuffer(target: { valid: boolean }) {
      target.valid = false;
    },
    deleteTexture(target: { valid: boolean }) {
      target.valid = false;
    },
    resize(w: number, h: number) {
      this.width = w;
      this.height = h;
      sizes.push(w);
      rendererEvents.emit('resize', w, h);
      return this;
    },
    setProjectionMatrix(w: number, h: number) {
      projection.push([w, h]);
      return this;
    },
    resetProjectionMatrix() {
      return this.setProjectionMatrix(this.width, this.height);
    },
    pushScissor(x: number, y: number, w: number, h: number) {
      clips.push([x, y, w, h]);
      return [x, y, w, h];
    },
    preRenderCamera(c: { x: number; y: number; width: number; height: number }) {
      this.pushScissor(5, 6, 7, 8); // an unrelated target, still in its own pixels
      this.pushScissor(c.x, c.y, c.width, c.height);
    },
  };
  // Use Phaser's own target: its resize deletes the framebuffer before a potentially throwing replacement.
  const liveTarget = new RenderTarget(renderer, 1920, 1080, 1, 0, true, true);
  scale.on('resize', renderer.onResize, renderer);
  const game = { events, scale, renderer, canvas } as unknown as Phaser.Game;
  installDisplay(game);
  events.emit('ready');
  expect(doc.createElement).not.toHaveBeenCalled();
  for (const target of unusedTargets) {
    expect(target.resize).toHaveBeenCalledWith(1, 1);
    expect(target.setAutoResize).toHaveBeenCalledWith(false);
  }
  expect([canvas.width, canvas.height]).toEqual([3840, 2160]);
  expect([renderer.width, renderer.height]).toEqual([3840, 2160]);
  expect(projection.at(-1)).toEqual([1920, 1080]);
  expect(canvas.dataset).toMatchObject({
    renderResolution: '3840x2160',
    displayResolution: '3840x2160',
    spatialUpscale: 'inactive',
  });
  const camera = { x: 100, y: 50, width: 800, height: 450 };
  renderer.preRenderCamera(camera);
  expect(camera).toEqual({ x: 100, y: 50, width: 800, height: 450 });
  expect(clips).toEqual([
    [5, 6, 7, 8],
    [200, 100, 1600, 900],
  ]);
  renderer.resetProjectionMatrix();
  expect(projection.at(-1)).toEqual([1920, 1080]);
  scale.emit('resize');
  expect(renderer.onResize).not.toHaveBeenCalled();
  expect([canvas.width, canvas.height]).toEqual([3840, 2160]);
  dpr = 1;
  listeners.get('density')?.();
  expect([canvas.width, canvas.height]).toEqual([1920, 1080]);
  // A browser can advertise a large GPU limit while silently allocating a smaller drawing buffer.
  allocationLimit = 3000;
  dpr = 2;
  listeners.get('density')?.();
  expect([canvas.width, canvas.height]).toEqual([2560, 1440]);
  allocationLimit = 8192;
  for (let i = 0; i < 3300; i++) events.emit('step', i * (1000 / 60), 1000 / 60);
  expect([canvas.width, canvas.height]).toEqual([3840, 2160]);
  for (let i = 0; i < 400; i++) events.emit('step', i * (1000 / 30), 1000 / 30);
  expect([canvas.width, canvas.height]).toEqual([2560, 1440]);
  // Fail after Phaser has accepted the 4K canvas and deleted a target at the 1440p fallback size.
  failResizeAt = 3840;
  for (let i = 0; i < 3300; i++) events.emit('step', i * (1000 / 60), 1000 / 60);
  expect(sizes.slice(-3)).toEqual([3840, 1, 2560]);
  expect(gl.deleteFramebuffer).toHaveBeenCalledOnce();
  expect([liveTarget.width, liveTarget.height]).toEqual([2560, 1440]);
  expect(liveTarget.framebuffer.valid).toBe(true);
  expect(liveTarget.texture.valid).toBe(true);
  expect([canvas.width, canvas.height]).toEqual([2560, 1440]);
  // A later FIT refresh and a long fast run must not retry the known allocation failure.
  const attempts = sizes.length;
  scale.emit('resize');
  for (let i = 0; i < 7000; i++) events.emit('step', i * (1000 / 60), 1000 / 60);
  expect(sizes.length).toBe(attempts);
  renderer.contextLost = true;
  lost = true;
  rendererEvents.emit('losewebgl');
  expect(liveTarget.width).toBe(1);
  lost = false;
  renderer.resize(1920, 1080); // Phaser requests its logical base size before firing restorewebgl.
  expect([renderer.width, renderer.height]).toEqual([1920, 1080]);
  renderer.contextLost = false;
  rendererEvents.emit('restorewebgl');
  expect([canvas.width, canvas.height]).toEqual([1920, 1080]);
  expect(projection.at(-1)).toEqual([1920, 1080]);
  renderer.contextLost = true;
  lost = true;
  rendererEvents.emit('losewebgl');
  lost = false;
  renderer.resize(1920, 1080); // The lost 1080p tier must not be reallocated during Phaser's restore.
  expect([renderer.width, renderer.height]).toEqual([1280, 720]);
  renderer.contextLost = false;
  rendererEvents.emit('restorewebgl');
  expect([canvas.width, canvas.height]).toEqual([1280, 720]);
  events.emit('destroy');
});
