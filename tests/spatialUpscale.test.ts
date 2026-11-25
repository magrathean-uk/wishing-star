import { describe, expect, it } from 'vitest';
import {
  activeFullscreenElement,
  canPresentInFullscreen,
  shouldValidateSpatialOutput,
  spatialUpscaleStrength,
} from '../src/game/spatialUpscale.ts';

describe('spatial resolution reconstruction', () => {
  it('uses the original game canvas when the output layer is outside the fullscreen element', () => {
    expect(canPresentInFullscreen(false, false)).toBe(true);
    expect(canPresentInFullscreen(true, true)).toBe(true);
    expect(canPresentInFullscreen(true, false)).toBe(false);
  });

  it('recognises the legacy Safari fullscreen element', () => {
    const output = {} as Element;
    const doc = { fullscreenElement: null, webkitFullscreenElement: output } as unknown as Document;
    expect(activeFullscreenElement(doc)).toBe(output);
    expect(canPresentInFullscreen(!!activeFullscreenElement(doc), false)).toBe(false);
  });

  it('revalidates after resume and at a bounded interval while presenting', () => {
    expect(shouldValidateSpatialOutput(true, 0, false)).toBe(true);
    expect(shouldValidateSpatialOutput(false, 119, false)).toBe(false);
    expect(shouldValidateSpatialOutput(false, 120, false)).toBe(true);
    expect(shouldValidateSpatialOutput(false, 1, true)).toBe(true);
  });

  it('bypasses a matching or almost matching source and display buffer', () => {
    expect(spatialUpscaleStrength(3840, 2160, 3840, 2160)).toBe(0);
    expect(spatialUpscaleStrength(1920, 1080, 1990, 1119)).toBe(0);
    expect(spatialUpscaleStrength(0, 1080, 3840, 2160)).toBe(0);
  });

  it('increases the edge adjustment gently for larger display ratios', () => {
    const modest = spatialUpscaleStrength(1920, 1080, 2560, 1440);
    const large = spatialUpscaleStrength(1280, 720, 2560, 1440);
    expect(modest).toBeGreaterThan(0);
    expect(large).toBeGreaterThan(modest);
    expect(spatialUpscaleStrength(640, 360, 3840, 2160)).toBeLessThanOrEqual(0.32);
  });
});
