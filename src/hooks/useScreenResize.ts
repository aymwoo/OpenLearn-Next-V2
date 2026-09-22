import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

export type ScreenSizeCategory = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';
export type ScreenOrientation = 'portrait' | 'landscape';

export interface ScreenResizeInfo {
  width: number;
  height: number;
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  isSmallScreen: boolean;
  screenSize: ScreenSizeCategory;
  orientation: ScreenOrientation;
  customMatches?: Record<string, boolean>;
}

export interface ScreenResizeOptions {
  /**
   * Threshold in pixels below which device is considered mobile. Default: 768.
   */
  mobileBreakpoint?: number;
  /**
   * Threshold in pixels below which device is considered tablet. Default: 1024.
   */
  tabletBreakpoint?: number;
  /**
   * Debounce delay in milliseconds. Default: 100. Set to 0 for immediate updates.
   */
  debounceMs?: number;
  /**
   * Initial width (useful for SSR, test environments or custom mock sizes).
   */
  initialWidth?: number;
  /**
   * Initial height (useful for SSR or test environments).
   */
  initialHeight?: number;
  /**
   * Callback fired on each resize update.
   */
  onResize?: (info: ScreenResizeInfo) => void;
  /**
   * Callback fired when transitioning into mobile layout (width < mobileBreakpoint).
   */
  onMobileEnter?: (info: ScreenResizeInfo) => void;
  /**
   * Callback fired when transitioning out of mobile layout (width >= mobileBreakpoint).
   */
  onMobileLeave?: (info: ScreenResizeInfo) => void;
}

/**
 * Third-party Plugin Breakpoint Custom Matcher
 */
export type CustomBreakpointMatcher = (width: number, height: number) => boolean;

/**
 * Global Screen Resize & Viewport Manager for Plugins and Host Application
 */
class ScreenResizeObserverManager {
  private static instance: ScreenResizeObserverManager;
  private customBreakpoints = new Map<string, CustomBreakpointMatcher>();
  private subscribers = new Set<(info: ScreenResizeInfo) => void>();
  private isListening = false;
  private cachedInfo: ScreenResizeInfo | null = null;
  private resizeTimer: any = null;

  public static getInstance(): ScreenResizeObserverManager {
    if (!ScreenResizeObserverManager.instance) {
      ScreenResizeObserverManager.instance = new ScreenResizeObserverManager();
    }
    return ScreenResizeObserverManager.instance;
  }

  /**
   * Register a custom breakpoint matcher for third-party plugins
   * e.g. manager.registerCustomBreakpoint('compactMenuRequired', (w, h) => w < 850);
   */
  public registerCustomBreakpoint(name: string, matcher: CustomBreakpointMatcher): () => void {
    this.customBreakpoints.set(name, matcher);
    return () => {
      this.customBreakpoints.delete(name);
    };
  }

  /**
   * Subscribe to global viewport resize updates directly (vanilla JS / plugin micro-frontends)
   */
  public subscribe(callback: (info: ScreenResizeInfo) => void): () => void {
    this.subscribers.add(callback);
    this.ensureListening();

    // Deliver initial state immediately if available
    const initial = this.getSnapshot();
    try {
      callback(initial);
    } catch (e) {
      console.warn('[ScreenResizeObserverManager] Error in initial subscriber callback:', e);
    }

    return () => {
      this.subscribers.delete(callback);
      if (this.subscribers.size === 0 && this.isListening) {
        this.stopListening();
      }
    };
  }

  /**
   * Evaluate custom breakpoints for given dimensions
   */
  public evaluateCustomBreakpoints(width: number, height: number): Record<string, boolean> {
    const results: Record<string, boolean> = {};
    for (const [name, matcher] of this.customBreakpoints.entries()) {
      try {
        results[name] = matcher(width, height);
      } catch (err) {
        results[name] = false;
      }
    }
    return results;
  }

  /**
   * Synchronously get current snapshot of viewport dimensions
   */
  public getSnapshot(mobileBreakpoint = 768, tabletBreakpoint = 1024): ScreenResizeInfo {
    const width = typeof window !== 'undefined' ? window.innerWidth : 1024;
    const height = typeof window !== 'undefined' ? window.innerHeight : 768;
    return this.calculateInfo(width, height, mobileBreakpoint, tabletBreakpoint);
  }

  public calculateInfo(
    width: number,
    height: number,
    mobileBreakpoint = 768,
    tabletBreakpoint = 1024,
  ): ScreenResizeInfo {
    const isMobile = width < mobileBreakpoint;
    const isTablet = width >= mobileBreakpoint && width < tabletBreakpoint;
    const isDesktop = width >= tabletBreakpoint;
    const isSmallScreen = width < 640;

    let screenSize: ScreenSizeCategory = 'md';
    if (width < 640) screenSize = 'xs';
    else if (width < 768) screenSize = 'sm';
    else if (width < 1024) screenSize = 'md';
    else if (width < 1280) screenSize = 'lg';
    else if (width < 1536) screenSize = 'xl';
    else screenSize = '2xl';

    const orientation: ScreenOrientation = width >= height ? 'landscape' : 'portrait';
    const customMatches = this.evaluateCustomBreakpoints(width, height);

    return {
      width,
      height,
      isMobile,
      isTablet,
      isDesktop,
      isSmallScreen,
      screenSize,
      orientation,
      customMatches,
    };
  }

  private ensureListening(): void {
    if (this.isListening || typeof window === 'undefined') return;
    this.isListening = true;
    window.addEventListener('resize', this.handleWindowResize, { passive: true });
    window.addEventListener('orientationchange', this.handleWindowResize, { passive: true });
  }

  private stopListening(): void {
    if (!this.isListening || typeof window === 'undefined') return;
    this.isListening = false;
    window.removeEventListener('resize', this.handleWindowResize);
    window.removeEventListener('orientationchange', this.handleWindowResize);
  }

  private handleWindowResize = (): void => {
    if (this.resizeTimer) {
      clearTimeout(this.resizeTimer);
    }
    this.resizeTimer = setTimeout(() => {
      const info = this.getSnapshot();
      this.cachedInfo = info;

      // Broadcast to plugin subscribers
      for (const sub of this.subscribers) {
        try {
          sub(info);
        } catch (e) {
          console.warn('[ScreenResizeObserverManager] Error invoking subscriber:', e);
        }
      }

      // Dispatch global DOM custom event for external micro-frontends / plugins
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('openlearn:screen:resize', {
            detail: info,
          }),
        );
      }
    }, 100);
  };
}

export const screenResizeManager = ScreenResizeObserverManager.getInstance();

/**
 * useScreenResize Hook
 *
 * Monitors screen resizing and viewport changes with debouncing, breakpoint evaluation,
 * and lifecycle transition callbacks (onMobileEnter, onMobileLeave).
 */
export function useScreenResize(options: ScreenResizeOptions = {}): ScreenResizeInfo {
  const {
    mobileBreakpoint = 768,
    tabletBreakpoint = 1024,
    debounceMs = 100,
    initialWidth,
    initialHeight,
    onResize,
    onMobileEnter,
    onMobileLeave,
  } = options;

  // Compute initial state
  const getInitialState = (): ScreenResizeInfo => {
    const width =
      typeof initialWidth === 'number'
        ? initialWidth
        : typeof window !== 'undefined'
          ? window.innerWidth
          : 1024;
    const height =
      typeof initialHeight === 'number'
        ? initialHeight
        : typeof window !== 'undefined'
          ? window.innerHeight
          : 768;
    return screenResizeManager.calculateInfo(width, height, mobileBreakpoint, tabletBreakpoint);
  };

  const [screenInfo, setScreenInfo] = useState<ScreenResizeInfo>(getInitialState);
  const prevIsMobileRef = useRef<boolean>(screenInfo.isMobile);
  const onResizeRef = useRef(onResize);
  const onMobileEnterRef = useRef(onMobileEnter);
  const onMobileLeaveRef = useRef(onMobileLeave);

  onResizeRef.current = onResize;
  onMobileEnterRef.current = onMobileEnter;
  onMobileLeaveRef.current = onMobileLeave;

  useEffect(() => {
    if (typeof window === 'undefined') return;

    let timer: any = null;

    const updateDimensions = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const nextInfo = screenResizeManager.calculateInfo(w, h, mobileBreakpoint, tabletBreakpoint);

      setScreenInfo(nextInfo);
      onResizeRef.current?.(nextInfo);

      // Trigger transition hooks
      if (!prevIsMobileRef.current && nextInfo.isMobile) {
        onMobileEnterRef.current?.(nextInfo);
      } else if (prevIsMobileRef.current && !nextInfo.isMobile) {
        onMobileLeaveRef.current?.(nextInfo);
      }
      prevIsMobileRef.current = nextInfo.isMobile;
    };

    const handleResize = () => {
      if (debounceMs <= 0) {
        updateDimensions();
      } else {
        if (timer) clearTimeout(timer);
        timer = setTimeout(updateDimensions, debounceMs);
      }
    };

    window.addEventListener('resize', handleResize, { passive: true });
    window.addEventListener('orientationchange', handleResize, { passive: true });

    // Initial check in case window changed between render and mount
    updateDimensions();

    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, [mobileBreakpoint, tabletBreakpoint, debounceMs]);

  return screenInfo;
}

/**
 * Alias for useScreenResize for developer convenience
 */
export const useResponsiveViewport = useScreenResize;
