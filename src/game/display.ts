// Phaser 3.90's FIT mode scales the canvas with CSS; it does not increase the WebGL drawing buffer. Keep the
// 1920 x 1080 game and camera coordinates, but render them into a larger (or, on a slow device, smaller) buffer.
import type Phaser from 'phaser';
import { SpatialUpscaler, spatialUpscaleStrength, type SpatialViewport } from './spatialUpscale.ts';

const W = 1920;
const H = 1080;
const HEIGHTS = [720, 1080, 1440, 2160] as const;
const SAMPLE_MS = 8000;
const SETTLE_MS = 4000;
const RECOVER_MS = 48000;

/** Highest 16:9 drawing-buffer tier the displayed canvas, pixel density and GPU limits can support. */
export function displayTier(width: number, height: number, dpr: number, maxWidth: number, maxHeight: number): number {
  const pixelsWide = Math.min(width * dpr, maxWidth);
  const pixelsHigh = Math.min(height * dpr, maxHeight);
  let tier = 0;
  for (let i = 0; i < HEIGHTS.length; i++) {
    const h = HEIGHTS[i]!;
    // A fractional CSS fit can leave the physical edge a fraction of a pixel short.
    if ((h * 16) / 9 <= pixelsWide + 1 && h <= pixelsHigh + 1) tier = i;
  }
  return tier;
}

/** A long frame or hidden tab resets the sample; sustained slow frames lower quality, not game speed. */
export class FrameBudget {
  private settle = SETTLE_MS;
  private elapsed = 0;
  private frames = 0;
  private good = 0;
  private stalled = 0;

  reset(): void {
    this.settle = SETTLE_MS;
    this.elapsed = 0;
    this.frames = 0;
    this.good = 0;
    this.stalled = 0;
  }

  sample(delta: number): -1 | 0 | 1 {
    if (!Number.isFinite(delta) || delta <= 0) {
      this.reset();
      return 0;
    }
    if (delta > 250) {
      // Ignore an isolated pause, but still respond if a device is consistently below four frames per second.
      this.stalled += Math.min(delta, 1000);
      this.settle = SETTLE_MS;
      this.elapsed = 0;
      this.frames = 0;
      this.good = 0;
      if (this.stalled >= SAMPLE_MS) {
        this.stalled = 0;
        return -1;
      }
      return 0;
    }
    this.stalled = 0;
    if (this.settle > 0) {
      this.settle -= delta;
      return 0;
    }
    this.elapsed += delta;
    this.frames++;
    if (this.elapsed < SAMPLE_MS) return 0;
    const fps = (this.frames * 1000) / this.elapsed;
    this.good = fps >= 58 ? this.good + this.elapsed : 0;
    this.elapsed = 0;
    this.frames = 0;
    if (fps < 50) {
      this.good = 0;
      return -1;
    }
    if (this.good >= RECOVER_MS) {
      this.good = 0;
      return 1;
    }
    return 0;
  }
}

/** Install after Phaser's renderer exists and before its first scene starts. */
export function installDisplay(game: Phaser.Game): void {
  game.events.once('ready', () => {
    const renderer = game.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
    if (!renderer?.gl) return;

    const gl = renderer.gl;
    const budget = new FrameBudget();
    let spatialUpscaler: SpatialUpscaler | null = null;
    let spatialViewport: SpatialViewport | null = null;
    let spatialUnavailable = false;
    const cameraRender = renderer.preRenderCamera;
    const pushScissor = renderer.pushScissor;
    const resetProjection = renderer.resetProjectionMatrix;
    const resizeRenderer = renderer.resize;
    let camera: Phaser.Cameras.Scene2D.Camera | null = null;
    let tier = 1;
    let ceiling = HEIGHTS.length - 1;
    let allocationCeiling = ceiling;
    let valid = true;
    let spatialUpscaleLimited = false;
    let restoreTier: number | null = null;
    let densityQuery: MediaQueryList | undefined;

    const updateSpatial = (rect: DOMRect, displayTierIndex: number) => {
      const targetHeight = HEIGHTS[displayTierIndex]!;
      const targetWidth = (targetHeight * 16) / 9;
      game.canvas.dataset.renderResolution = `${game.canvas.width}x${game.canvas.height}`;
      game.canvas.dataset.displayResolution = `${targetWidth}x${targetHeight}`;
      game.canvas.dataset.sourceScale = Math.min(
        targetWidth / game.canvas.width,
        targetHeight / game.canvas.height,
      ).toFixed(2);
      spatialViewport = {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        targetWidth,
        targetHeight,
      };
      const needsUpscaling =
        spatialUpscaleStrength(game.canvas.width, game.canvas.height, targetWidth, targetHeight) > 0;
      if (!needsUpscaling || spatialUpscaleLimited || spatialUnavailable) {
        spatialUpscaler?.destroy();
        spatialUpscaler = null;
        game.canvas.dataset.spatialUpscale = 'inactive';
        return;
      }
      spatialUpscaler ??= SpatialUpscaler.create(game.canvas);
      if (!spatialUpscaler) {
        spatialUnavailable = true;
        game.canvas.dataset.spatialUpscale = 'inactive';
      }
    };

    // None of these targets is used by this game: Graphics.generateTexture uses Canvas 2D, and there are no bitmap
    // masks, DynamicTextures or Phaser FX. Keep the targets alive at 1 x 1 rather than growing seven unused textures
    // and their depth buffers to 4K. Revisit this list if the game starts using any of those Phaser features.
    const unusedTargets = [
      renderer.renderTarget,
      renderer.maskTarget,
      renderer.maskSource,
      renderer.pipelines.fullFrame1,
      renderer.pipelines.fullFrame2,
      renderer.pipelines.halfFrame1,
      renderer.pipelines.halfFrame2,
    ];
    for (const target of unusedTargets) {
      target.resize(1, 1);
      target.setAutoResize(false);
    }

    // Camera clips arrive in logical pixels. Phaser's scissor stack and WebGL viewport use drawing-buffer pixels.
    // Only the camera clip is translated: render-target and texture operations keep their own coordinates.
    renderer.preRenderCamera = (c) => {
      camera = c;
      try {
        cameraRender.call(renderer, c);
      } finally {
        camera = null;
      }
    };
    renderer.pushScissor = (x, y, width, height, bufferHeight) => {
      if (camera && x === camera.x && y === camera.y && width === camera.width && height === camera.height) {
        const sx = renderer.width / W;
        const sy = renderer.height / H;
        const left = Math.floor(x * sx);
        const top = Math.floor(y * sy);
        const right = Math.ceil((x + width) * sx);
        const bottom = Math.ceil((y + height) * sy);
        return pushScissor.call(renderer, left, top, right - left, bottom - top, bufferHeight);
      }
      return pushScissor.call(renderer, x, y, width, height, bufferHeight);
    };
    // Dynamic texture capture restores the screen projection through this method.
    renderer.resetProjectionMatrix = () => renderer.setProjectionMatrix(W, H);

    const apply = (restoring = false) => {
      if ((renderer.contextLost && !restoring) || gl.isContextLost()) return;
      const rect = game.canvas.getBoundingClientRect();
      if ((rect.width <= 0 || rect.height <= 0) && !restoring) return;
      const viewport = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array;
      const maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
      const maxBuffer = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number;
      const maxWidth = Math.min(viewport[0]!, maxTexture, maxBuffer);
      const maxHeight = Math.min(viewport[1]!, maxTexture, maxBuffer);
      const dpr = Number.isFinite(window.devicePixelRatio) && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
      const display =
        rect.width > 0 && rect.height > 0
          ? displayTier(rect.width, rect.height, dpr, (HEIGHTS[3]! * 16) / 9, HEIGHTS[3]!)
          : tier;
      const fit =
        rect.width > 0 && rect.height > 0
          ? Math.min(display, displayTier(rect.width, rect.height, dpr, maxWidth, maxHeight))
          : tier;
      let next = Math.min(ceiling, allocationCeiling, fit);
      // Browsers can silently allocate a smaller buffer than advertised. Retry at the next smaller tier.
      while (next >= 0) {
        const h = HEIGHTS[next]!;
        const w = (h * 16) / 9;
        if (
          valid &&
          game.canvas.width === w &&
          game.canvas.height === h &&
          renderer.width === w &&
          renderer.height === h
        ) {
          tier = next;
          renderer.setProjectionMatrix(W, H);
          updateSpatial(rect, display);
          return;
        }
        tier = next;
        valid = false;
        game.canvas.width = w;
        game.canvas.height = h;
        if (gl.isContextLost()) return;
        if (gl.drawingBufferWidth === w && gl.drawingBufferHeight === h) {
          try {
            resizeRenderer.call(renderer, w, h);
            if (gl.isContextLost()) return;
            renderer.setProjectionMatrix(W, H);
            valid = true;
            budget.reset();
            updateSpatial(rect, display);
            return;
          } catch (error) {
            if (gl.isContextLost()) return;
            const framebufferError = error instanceof Error && error.message.startsWith('Framebuffer status:');
            // Phaser also assigns metadata to createTexture() without checking for null.
            const textureError =
              error instanceof TypeError &&
              error.message.includes('__SPECTOR_Metadata') &&
              /null|undefined/i.test(error.message);
            if (!framebufferError && !textureError) throw error;
            // Phaser's framebuffer wrapper can throw before it registers the newly bound framebuffer. Release that
            // orphan, then rebuild at 1 x 1: a failed target still records its OLD size after deleting its buffers,
            // so a direct retry at that old size would incorrectly skip rebuilding it.
            if (framebufferError) {
              const orphan = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
              if (orphan) {
                gl.bindFramebuffer(gl.FRAMEBUFFER, null);
                gl.deleteFramebuffer(orphan);
              }
            }
            game.canvas.width = 1;
            game.canvas.height = 1;
            try {
              resizeRenderer.call(renderer, 1, 1);
            } catch (repairError) {
              if (gl.isContextLost()) return;
              throw repairError;
            }
            if (next === 0) throw error;
            allocationCeiling = Math.min(allocationCeiling, next - 1);
          }
        }
        ceiling = --next;
      }
      // The original game already needs a WebGL buffer; leave the lowest tier to the browser if it cannot allocate it.
      ceiling = 0;
      resizeRenderer.call(renderer, gl.drawingBufferWidth, gl.drawingBufferHeight);
      renderer.setProjectionMatrix(W, H);
      valid = true;
      updateSpatial(rect, display);
    };

    // Phaser restores the logical base size before emitting restorewebgl. Use the reduced tier during that step so
    // restoration does not first reallocate the size that just lost the context.
    renderer.resize = (width, height) => {
      if (renderer.contextLost && !gl.isContextLost() && restoreTier !== null) {
        apply(true);
        return renderer;
      }
      return resizeRenderer.call(renderer, width, height);
    };

    // FIT refreshes must still update CSS bounds and input transforms, but its usual renderer listener would force
    // the buffer back to the logical dimensions every time the window is moved or resized.
    const refresh = () => {
      spatialUpscaleLimited = false;
      apply();
    };
    game.scale.off('resize', renderer.onResize, renderer);
    game.scale.on('resize', refresh);
    renderer.on('losewebgl', () => {
      ceiling = Math.max(0, tier - 1);
      allocationCeiling = Math.min(allocationCeiling, ceiling);
      restoreTier = ceiling;
      valid = false;
      spatialUpscaler?.suspend();
      budget.reset();
      // Phaser recreates wrappers before emitting restorewebgl. While lost, shrink auto-resizing targets so those
      // wrappers are restored small too. Never throw from this event: Phaser must still call preventDefault().
      try {
        resizeRenderer.call(renderer, 1, 1);
      } catch {
        // The normal restore path will try the lower tier once the context returns.
      }
    });
    renderer.on('restorewebgl', () => {
      restoreTier = null;
      apply();
    });
    game.events.on('step', (_time: number, delta: number) => {
      if (document.hidden || !document.hasFocus() || renderer.contextLost) {
        budget.reset();
        return;
      }
      const direction = budget.sample(delta);
      if (direction < 0 && tier > 0) {
        ceiling = tier - 1;
        apply();
      } else if (direction < 0 && tier === 0) {
        // Keep a very slow machine responsive after its smallest scene buffer is reached.
        spatialUpscaleLimited = true;
        spatialUpscaler?.destroy();
        spatialUpscaler = null;
      } else if (direction > 0 && ceiling < allocationCeiling) {
        ceiling++;
        apply();
      }
    });
    const postrender = () => {
      if (!spatialUpscaler) return;
      if (!valid || spatialUpscaleLimited || renderer.contextLost || gl.isContextLost() || document.hidden) {
        spatialUpscaler.suspend();
        return;
      }
      if (spatialViewport) spatialUpscaler.render(spatialViewport);
    };
    game.events.on('postrender', postrender);
    const recheckDensity = () => {
      densityQuery?.removeEventListener('change', recheckDensity);
      densityQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      densityQuery.addEventListener('change', recheckDensity);
      spatialUpscaleLimited = false;
      apply();
    };
    const visibility = () => {
      budget.reset();
      if (!document.hidden) apply();
    };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('focus', visibility);
    window.addEventListener('blur', visibility);
    recheckDensity();
    game.events.once('destroy', () => {
      game.scale.off('resize', refresh);
      game.events.off('postrender', postrender);
      densityQuery?.removeEventListener('change', recheckDensity);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('focus', visibility);
      window.removeEventListener('blur', visibility);
      renderer.preRenderCamera = cameraRender;
      renderer.pushScissor = pushScissor;
      renderer.resetProjectionMatrix = resetProjection;
      renderer.resize = resizeRenderer;
      spatialUpscaler?.destroy();
    });
  });
}
