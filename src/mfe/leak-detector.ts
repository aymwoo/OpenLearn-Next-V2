/**
 * leak-detector — Dev-mode leak detection utility.
 *
 * D-20: In development mode, checks for leaked resources after MfeLoader
 *       unmount (uncleared intervals, event listeners, observers).
 *       Outside development mode, returns a no-op implementation.
 *
 * Usage:
 *   const detector = createLeakDetector(containerRef.current);
 *   detector.trackInterval(window.setInterval(...));
 *   detector.trackListener(window, 'resize', handler);
 *   detector.trackObserver(new MutationObserver(callback));
 *   // On unmount:
 *   detector.cleanup();
 *   detector.check(); // logs warnings if any leaks remain
 */

type TrackedListener = {
  target: EventTarget;
  type: string;
  handler: EventListener;
};

type LeakDetectorInstance = {
  trackInterval(id: number): void;
  trackListener(target: EventTarget, type: string, handler: EventListener): void;
  trackObserver(obs: MutationObserver | IntersectionObserver | ResizeObserver): void;
  check(): void;
  cleanup(): void;
};

/**
 * Create a leak detector scoped to a specific MfeLoader container.
 *
 * In non-development environments, returns a no-op implementation
 * that adds zero overhead.
 */
export function createLeakDetector(container?: HTMLElement): LeakDetectorInstance {
  if (process.env.NODE_ENV !== 'development') {
    return {
      trackInterval() {},
      trackListener() {},
      trackObserver() {},
      check() {},
      cleanup() {},
    };
  }

  const intervals = new Set<number>();
  const listeners: TrackedListener[] = [];
  const observers = new Set<MutationObserver | IntersectionObserver | ResizeObserver>();

  return {
    trackInterval(id: number) {
      intervals.add(id);
    },

    trackListener(target: EventTarget, type: string, handler: EventListener) {
      listeners.push({ target, type, handler });
    },

    trackObserver(obs: MutationObserver | IntersectionObserver | ResizeObserver) {
      observers.add(obs);
    },

    check() {
      const activeIntervals = intervals.size;
      const activeListeners = listeners.length;
      const activeObservers = observers.size;

      if (activeIntervals > 0 || activeListeners > 0 || activeObservers > 0) {
        console.warn(
          `[MfeLoader:LeakDetector] Potential leaks detected after unmount:` +
          `\n  Active intervals: ${activeIntervals}` +
          `\n  Active listeners: ${activeListeners}` +
          `\n  Active observers: ${activeObservers}`,
        );
      }
    },

    cleanup() {
      intervals.forEach(clearInterval);
      intervals.clear();
      listeners.forEach(({ target, type, handler }) => {
        target.removeEventListener(type, handler);
      });
      listeners.length = 0;
      observers.forEach((obs) => obs.disconnect());
      observers.clear();
    },
  };
}
