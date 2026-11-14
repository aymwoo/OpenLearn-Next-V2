import { flushSync } from 'react-dom';

/**
 * Modern Web Platform feature detection & progressive-enhancement helpers
 * for the Interactive Whiteboard.
 */

export function supportsNativePopover(): boolean {
  return typeof HTMLElement !== 'undefined' && Object.hasOwn(HTMLElement.prototype, 'popover');
}

export function supportsCssAnchorPositioning(): boolean {
  return typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('position-area: block-end');
}

export function supportsScopedViewTransition(): boolean {
  return typeof Element !== 'undefined' && 'startViewTransition' in Element.prototype;
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

interface ViewTransitionHandle {
  ready: Promise<void>;
}

type TransitionScopeElement = HTMLElement & {
  startViewTransition?: (callback: () => void) => ViewTransitionHandle;
};

/**
 * Run a DOM/React state transition scoped to a specific whiteboard container element
 * (`element.startViewTransition`), avoiding root-level blocking so fixed toolbars and
 * `[popover]` top-layer overlays remain interactive.
 *
 * Falls back immediately to `updateState()` on browsers without element-scoped
 * view transitions or when `prefers-reduced-motion: reduce` is enabled.
 */
export function runScopedTransition(scopeEl: HTMLElement | null, updateState: () => void): void {
  const applyUpdate = () => {
    try {
      flushSync(updateState);
    } catch {
      // If already inside an active React batch/commit, apply without flushSync.
      updateState();
    }
  };

  if (!scopeEl || !supportsScopedViewTransition() || prefersReducedMotion()) {
    updateState();
    return;
  }

  const scoped = scopeEl as TransitionScopeElement;
  if (typeof scoped.startViewTransition !== 'function') {
    updateState();
    return;
  }

  try {
    const transition = scoped.startViewTransition(applyUpdate);
    transition?.ready?.catch?.(() => {});
  } catch {
    updateState();
  }
}

/**
 * Clamp floating overlay coordinates inside a bounding viewport so context menus
 * and selection bars never get clipped off the canvas edge.
 */
export function clampOverlayPosition(
  x: number,
  y: number,
  overlayWidth: number,
  overlayHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  padding = 8,
): { left: number; top: number } {
  const maxX = Math.max(padding, viewportWidth - overlayWidth - padding);
  const maxY = Math.max(padding, viewportHeight - overlayHeight - padding);
  return {
    left: Math.min(Math.max(padding, x), maxX),
    top: Math.min(Math.max(padding, y), maxY),
  };
}
