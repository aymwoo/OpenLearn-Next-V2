import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useScreenResize, useResponsiveViewport, screenResizeManager } from '../useScreenResize';

describe('useScreenResize Hook', () => {
  const originalInnerWidth = window.innerWidth;
  const originalInnerHeight = window.innerHeight;

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1200 });
    Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: 800 });
  });

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: originalInnerWidth });
    Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: originalInnerHeight });
  });

  it('calculates desktop viewport correctly', () => {
    const { result } = renderHook(() => useScreenResize({ debounceMs: 0 }));

    expect(result.current.width).toBe(1200);
    expect(result.current.height).toBe(800);
    expect(result.current.isDesktop).toBe(true);
    expect(result.current.isMobile).toBe(false);
    expect(result.current.isTablet).toBe(false);
    expect(result.current.orientation).toBe('landscape');
  });

  it('updates to mobile mode when window is resized below breakpoint', () => {
    const onMobileEnter = vi.fn();
    const onResize = vi.fn();

    const { result } = renderHook(() =>
      useScreenResize({
        debounceMs: 0,
        mobileBreakpoint: 768,
        onMobileEnter,
        onResize,
      }),
    );

    expect(result.current.isMobile).toBe(false);

    // Resize to mobile screen
    act(() => {
      Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 480 });
      Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: 800 });
      window.dispatchEvent(new Event('resize'));
    });

    expect(result.current.width).toBe(480);
    expect(result.current.isMobile).toBe(true);
    expect(result.current.isSmallScreen).toBe(true);
    expect(result.current.screenSize).toBe('xs');
    expect(result.current.orientation).toBe('portrait');
    expect(onMobileEnter).toHaveBeenCalled();
    expect(onResize).toHaveBeenCalled();
  });

  it('triggers onMobileLeave when resizing from mobile back to desktop', () => {
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 });
    const onMobileLeave = vi.fn();

    const { result } = renderHook(() =>
      useScreenResize({
        debounceMs: 0,
        mobileBreakpoint: 768,
        onMobileLeave,
      }),
    );

    expect(result.current.isMobile).toBe(true);

    // Resize to desktop
    act(() => {
      Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1024 });
      window.dispatchEvent(new Event('resize'));
    });

    expect(result.current.isMobile).toBe(false);
    expect(result.current.isTablet).toBe(false);
    expect(result.current.isDesktop).toBe(true);
    expect(onMobileLeave).toHaveBeenCalled();
  });

  it('works with useResponsiveViewport alias', () => {
    const { result } = renderHook(() => useResponsiveViewport({ debounceMs: 0 }));
    expect(result.current.width).toBe(1200);
    expect(result.current.isDesktop).toBe(true);
  });

  it('supports third-party plugin custom breakpoints via screenResizeManager', () => {
    const unregister = screenResizeManager.registerCustomBreakpoint('isFoldablePhone', (w, h) => w >= 280 && w <= 320);

    const snapshotFoldable = screenResizeManager.calculateInfo(300, 650);
    expect(snapshotFoldable.customMatches?.isFoldablePhone).toBe(true);

    const snapshotNormal = screenResizeManager.calculateInfo(450, 800);
    expect(snapshotNormal.customMatches?.isFoldablePhone).toBe(false);

    unregister();
    const snapshotAfterUnregister = screenResizeManager.calculateInfo(300, 650);
    expect(snapshotAfterUnregister.customMatches?.isFoldablePhone).toBeUndefined();
  });

  it('allows third-party plugins to subscribe to screenResizeManager directly', () => {
    const subscriber = vi.fn();
    const unsub = screenResizeManager.subscribe(subscriber);

    expect(subscriber).toHaveBeenCalledWith(expect.objectContaining({ width: 1200 }));
    unsub();
  });
});
