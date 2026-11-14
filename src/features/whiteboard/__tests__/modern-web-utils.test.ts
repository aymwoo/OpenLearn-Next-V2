import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  clampOverlayPosition,
  runScopedTransition,
  supportsNativePopover,
  supportsCssAnchorPositioning,
  supportsScopedViewTransition,
} from '../utils/modern-web-utils';

describe('modern-web-utils', () => {
  const originalStartVT = (Element.prototype as unknown as { startViewTransition?: unknown }).startViewTransition;
  const originalMatchMedia = window.matchMedia;

  afterEach(() => {
    if (originalStartVT === undefined) {
      delete (Element.prototype as unknown as { startViewTransition?: unknown }).startViewTransition;
    } else {
      (Element.prototype as unknown as { startViewTransition?: unknown }).startViewTransition = originalStartVT;
    }
    window.matchMedia = originalMatchMedia;
    vi.restoreAllMocks();
  });

  it('feature detection helpers return booleans safely in jsdom', () => {
    expect(typeof supportsNativePopover()).toBe('boolean');
    expect(typeof supportsCssAnchorPositioning()).toBe('boolean');
    expect(typeof supportsScopedViewTransition()).toBe('boolean');
  });

  describe('clampOverlayPosition', () => {
    it('keeps coordinates inside viewport padding bounds', () => {
      expect(clampOverlayPosition(-20, -10, 180, 200, 1000, 800)).toEqual({ left: 8, top: 8 });
      expect(clampOverlayPosition(950, 760, 180, 200, 1000, 800)).toEqual({ left: 812, top: 592 });
      expect(clampOverlayPosition(240, 160, 180, 200, 1000, 800)).toEqual({ left: 240, top: 160 });
    });

    it('falls back to padding when viewport is smaller than overlay', () => {
      expect(clampOverlayPosition(50, 50, 300, 300, 200, 200)).toEqual({ left: 8, top: 8 });
    });
  });

  describe('runScopedTransition', () => {
    it('executes updateState directly when scopeEl is null or unsupported', () => {
      const update = vi.fn();
      runScopedTransition(null, update);
      expect(update).toHaveBeenCalledTimes(1);

      const div = document.createElement('div');
      runScopedTransition(div, update);
      expect(update).toHaveBeenCalledTimes(2);
    });

    it('uses element.startViewTransition when available and motion is allowed', () => {
      const div = document.createElement('div');
      const startViewTransitionMock = vi.fn((cb: () => void) => {
        cb();
        return { ready: Promise.reject(new Error('skipped')) };
      });
      (Element.prototype as unknown as { startViewTransition?: typeof startViewTransitionMock }).startViewTransition =
        startViewTransitionMock;
      (div as unknown as { startViewTransition: typeof startViewTransitionMock }).startViewTransition =
        startViewTransitionMock;

      window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia;

      const update = vi.fn();
      runScopedTransition(div, update);

      expect(startViewTransitionMock).toHaveBeenCalledTimes(1);
      expect(update).toHaveBeenCalledTimes(1);
    });

    it('bypasses startViewTransition when prefers-reduced-motion is enabled', () => {
      const div = document.createElement('div');
      const startViewTransitionMock = vi.fn();
      (Element.prototype as unknown as { startViewTransition?: typeof startViewTransitionMock }).startViewTransition =
        startViewTransitionMock;
      (div as unknown as { startViewTransition: typeof startViewTransitionMock }).startViewTransition =
        startViewTransitionMock;

      window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia;

      const update = vi.fn();
      runScopedTransition(div, update);

      expect(startViewTransitionMock).not.toHaveBeenCalled();
      expect(update).toHaveBeenCalledTimes(1);
    });
  });
});
