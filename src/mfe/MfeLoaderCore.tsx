/**
 * MfeLoaderCore — Container rendering component for remote micro frontend loading.
 *
 * D-04: Container rendering via createRoot with per-instance lifecycle management.
 * D-06: Calls app.mount(container, props) and stores MfeAppInstance for lifecycle.
 * D-08: Single initialization — createMfeApp factory called once, returned object reused.
 * D-09: mount and unmount are fully async.
 * D-10: Injects/removes style link elements on mount/unmount.
 * D-12: Backward compat — default React components auto-wrapped via wrapReactComponent.
 * D-18: Loading timeout (default 30s) with error transition.
 * D-19: Dual-trigger unmount via mfeRef imperative API.
 * D-21: Full cleanup on unmount: root.unmount(), style removal, leak check.
 * D-22: Unmount timeout (5s) forces destruction if remote unmount() hangs.
 * D-23: Entry URL resolution via fetchRemoteEntry(name) with cache.
 * D-24: Cache-first fetch — subsequent loads for same name reuse cached entry.
 * D-27: Nested MfeLoader support — each instance has its own ErrorBoundary + createRoot.
 *
 * States: loading -> loaded | error
 *   loading — renders loadingFallback (default MfeLoadingFallback)
 *   loaded  — renders container div where remote mounts its UI
 *   error   — renders null (error handled by parent MfeErrorBoundary)
 *
 * Usage:
 *   <MfeLoaderCore name="mfe_whiteboard" />
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { loadRemote, registerRemotes } from '@module-federation/runtime';
import MfeLoadingFallback from '../components/MfeLoadingFallback';
import MfeErrorFallback from '../components/MfeErrorFallback';
import { fetchRemoteEntry } from './api';
import { get as cacheGet, set as cacheSet } from './cache';
import { createLeakDetector } from './leak-detector';
import type { MfeControllerRef, MfeAppLifecycle } from './types';
import type { MfeErrorFallbackProps } from '../components/MfeErrorFallback';
import type { PlatformEvent } from '../../packages/core/event-bus';

// ── Types ────────────────────────────────────────────────────────────────

export interface MfeLoaderCoreProps {
  /** Remote module name (e.g., 'mfe_whiteboard') */
  name: string;
  /** Pre-resolved entry URL (skip API lookup) */
  entry?: string;
  /** Props to pass to remote mount() */
  props?: Record<string, any>;
  /** Load timeout in ms (default from config or 30000) */
  timeout?: number;
  /** Per-instance loading fallback override */
  loadingFallback?: React.ComponentType;
  /** Per-instance error fallback override */
  errorFallback?: React.ComponentType<MfeErrorFallbackProps>;
  /** Explicit controller ref for imperative unmount (D-19) */
  mfeRef?: React.Ref<MfeControllerRef>;
  /** Error callback for parent */
  onError?: (error: Error) => void;
  /** Success callback for parent */
  onLoad?: () => void;
}

// ── Backward Compat Wrapper (D-12) ───────────────────────────────────────

/**
 * Wraps a default React component export into the MfeAppLifecycle shape.
 *
 * D-12: Remote modules that export a default React component are auto-wrapped
 * so MfeLoaderCore can mount them via the standard lifecycle interface.
 */
function wrapReactComponent(Component: React.ComponentType<any>): MfeAppLifecycle {
  return {
    mount: async (container: HTMLElement, props?: Record<string, any>) => {
      const root = createRoot(container);
      root.render(React.createElement(Component, props));
      return {
        unmount: async () => { root.unmount(); },
        update: async (newProps: Record<string, any>) => {
          root.render(React.createElement(Component, newProps));
        },
      };
    },
    unmount: async () => {},
    update: async () => {},
    styles: [],
  };
}

// ── MfeLoaderCore Component ──────────────────────────────────────────────

/**
 * Core MFE loading component that manages the full lifecycle of a remote
 * micro frontend: entry URL resolution, module loading, container rendering,
 * style injection, error handling, and unmount cleanup.
 *
 * Designed to be wrapped by MfeErrorBoundary (in MfeLoader.tsx) for error state
 * display — this component returns null on error.
 */
export function MfeLoaderCore({
  name,
  entry,
  props: remoteProps,
  timeout: timeoutProp,
  loadingFallback: LoadingFallbackOverride,
  errorFallback: ErrorFallbackOverride,
  mfeRef,
  onError,
  onLoad,
}: MfeLoaderCoreProps) {
  const [state, setState] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [error, setError] = useState<Error | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<Awaited<ReturnType<MfeAppLifecycle['mount']>> | null>(null);
  const lifecycleRef = useRef<MfeAppLifecycle | null>(null);
  const mountedStylesRef = useRef<string[]>([]);
  const controllerRef = useRef<MfeControllerRef>({
    unmount: async () => {
      console.warn('[MfeLoaderCore] unmount called before mount completed');
    },
  });

  // ── Sync mfeRef (D-19) ─────────────────────────────────────────────

  useEffect(() => {
    if (!mfeRef) return;
    if (typeof mfeRef === 'function') {
      mfeRef(controllerRef.current);
      return () => { (mfeRef as Function)(null); };
    } else if (mfeRef && 'current' in mfeRef) {
      (mfeRef as React.MutableRefObject<MfeControllerRef>).current = controllerRef.current;
      return () => {
        (mfeRef as React.MutableRefObject<MfeControllerRef | null>).current = null;
      };
    }
  }, [mfeRef]);

  // ── Cleanup helper ─────────────────────────────────────────────────

  const cleanup = useCallback(async () => {
    const container = containerRef.current;
    const mountInstance = mountRef.current;
    const lifecycle = lifecycleRef.current;
    const leakDetector = createLeakDetector(container ?? undefined);

    try {
      // D-22: Dual-path unmount with 5s timeout
      const unmountPromise = mountInstance
        ? mountInstance.unmount()
        : lifecycle
          ? lifecycle.unmount()
          : Promise.resolve();

      const timeoutPromise = new Promise<void>((_, reject) => {
        setTimeout(() => reject(new Error('Unmount timeout')), 5000);
      });

      await Promise.race([unmountPromise, timeoutPromise]);
    } catch (e) {
      console.warn('[MfeLoaderCore] unmount timed out or failed, forcing cleanup', e);
    }

    // D-21: root.unmount()
    if (container) {
      try {
        const root = createRoot(container);
        root.unmount();
      } catch {
        // Container may already be unmounted
      }
    }

    // D-10: Remove injected style elements
    mountedStylesRef.current.forEach((href) => {
      document.querySelectorAll(`link[href="${href}"]`).forEach((el) => el.remove());
    });
    mountedStylesRef.current = [];

    // D-20: Leak detector check
    leakDetector.cleanup();

    // Clear refs
    mountRef.current = null;
    lifecycleRef.current = null;
  }, []);

  // ── Main load effect ───────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let resolveUnmountTimeout: (() => void) | undefined;

    const effectiveTimeout = timeoutProp ?? 30000;

    async function run() {
      setState('loading');
      setError(null);
      mountRef.current = null;
      lifecycleRef.current = null;

      // D-18: Timeout promise
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`Loading timed out after ${effectiveTimeout}ms`));
        }, effectiveTimeout);
      });

      try {
        // ── 1. Resolve entry URL ──────────────────────────────────────
        // D-23, D-24: Use entry prop or fetch via API with cache
        let resolvedEntry = entry;
        if (!resolvedEntry) {
          const cached = cacheGet(name);
          if (cached) {
            resolvedEntry = cached.entry;
          } else {
            const remoteEntry = await fetchRemoteEntry(name);
            cacheSet(name, { entry: remoteEntry.entry, meta: remoteEntry.meta });
            resolvedEntry = remoteEntry.entry;
          }
        }

        // Register the remote with the MF runtime so loadRemote can resolve it
        if (resolvedEntry) {
          registerRemotes([{ name, entry: resolvedEntry }]);
        }

        // ── 2. Load remote module ─────────────────────────────────────
        // Race against timeout
        const mod = await Promise.race([
          loadRemote<{ default?: any; createMfeApp?: Function }>(`${name}/App`),
          timeoutPromise,
        ]);

        if (cancelled) return;

        // ── 3. Determine lifecycle (D-08, D-12) ──────────────────────
        let lifecycle: MfeAppLifecycle;

        if (mod.createMfeApp) {
          // D-08: createMfeApp factory — single init
          const mfeContext = {}; // D-02: placeholder — full bridging in Phase 12
          lifecycle = mod.createMfeApp(mfeContext) as MfeAppLifecycle;
        } else if (mod.default) {
          // D-12: Backward compat — auto-wrap default React component
          lifecycle = wrapReactComponent(mod.default);
        } else {
          throw new Error(
            `Remote "${name}" exports neither createMfeApp nor a default React component`,
          );
        }

        lifecycleRef.current = lifecycle;

        // ── 4. Mount into container ──────────────────────────────────
        const container = containerRef.current;
        if (!container) throw new Error('Mount container ref is null');

        const mountInstance = await lifecycle.mount(container, remoteProps);
        mountRef.current = mountInstance;

        // ── 5. Handle styles (D-10) ──────────────────────────────────
        if (lifecycle.styles && lifecycle.styles.length > 0) {
          lifecycle.styles.forEach((href, index) => {
            const linkId = `mfe-style-${name}-${index}`;
            if (!document.getElementById(linkId)) {
              const link = document.createElement('link');
              link.id = linkId;
              link.rel = 'stylesheet';
              link.href = href;
              document.head.appendChild(link);
            }
            mountedStylesRef.current.push(href);
          });
        }

        // ── 6. Update controller ref ──────────────────────────────────
        controllerRef.current = { unmount: cleanup };

        if (cancelled) {
          // If cancelled during mount, clean up immediately
          await lifecycle.unmount();
          return;
        }

        // ── 7. Success ───────────────────────────────────────────────
        clearTimeout(timeoutId);
        setState('loaded');
        onLoad?.();
      } catch (err: any) {
        if (cancelled) return;
        clearTimeout(timeoutId);
        setState('error');
        setError(err);
        onError?.(err);
      }
    }

    run();

    // ── Cleanup on unmount / deps change ──────────────────────────────
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      cleanup();
    };
  }, [name, entry, remoteProps, timeoutProp, onError, onLoad, cleanup]);

  // ── Rendering ──────────────────────────────────────────────────────

  // On error: throw to parent MfeErrorBoundary so it renders error fallback
  if (state === 'error' && error) {
    throw error;
  }

  // On loading: render fallback or default MfeLoadingFallback
  if (state === 'loading') {
    const LoadingFallback = LoadingFallbackOverride || MfeLoadingFallback;
    return <LoadingFallback />;
  }

  // On loaded: render the container div where remote mounts
  return (
    <div
      ref={containerRef}
      data-mfe-name={name}
      style={{ width: '100%', minHeight: '100%' }}
    />
  );
}

export class MfeEventBusWrapper {
  private mfeName: string;
  private hostEventBus: any;
  private socketBridge: any;
  private socketService: any;
  private activeSubscriptions: Array<{ event: string; handler: any; unsubscribe: () => void }> = [];

  constructor(mfeName: string, hostEventBus: any, socketBridge: any, socketService: any) {
    this.mfeName = mfeName;
    this.hostEventBus = hostEventBus;
    this.socketBridge = socketBridge;
    this.socketService = socketService;
  }

  subscribe(event: string, handler: (event: PlatformEvent) => void): () => void {
    let hostUnsubscribe: () => void;

    if (event.startsWith('server:')) {
      this.socketBridge.register(event);
      this.hostEventBus.subscribe(event, handler);
      hostUnsubscribe = () => {
        this.hostEventBus.unsubscribe(event, handler);
        this.socketBridge.unregister(event);
      };
    } else {
      this.hostEventBus.subscribe(event, handler);
      hostUnsubscribe = () => {
        this.hostEventBus.unsubscribe(event, handler);
      };
    }

    const subRecord = { event, handler, unsubscribe: hostUnsubscribe };
    this.activeSubscriptions.push(subRecord);

    return () => {
      hostUnsubscribe();
      this.activeSubscriptions = this.activeSubscriptions.filter((s) => s !== subRecord);
    };
  }

  async publish(event: PlatformEvent): Promise<void> {
    if (event.type.startsWith('server:')) {
      const socketEvent = event.type.replace(/^server:/, '');
      this.socketService.emit(socketEvent, event.payload);
    } else {
      const completeEvent: PlatformEvent = {
        ...event,
        source: this.mfeName,
        id: event.id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2)),
        timestamp: event.timestamp || Date.now(),
      };
      await this.hostEventBus.publish(completeEvent);
    }
  }

  cleanup() {
    this.activeSubscriptions.forEach((sub) => sub.unsubscribe());
    this.activeSubscriptions = [];
  }
}

