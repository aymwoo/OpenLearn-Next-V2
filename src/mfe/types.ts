/**
 * MFE (Micro Frontend) lifecycle type contracts.
 *
 * All lifecycle types for remotely loaded micro frontend applications.
 * Host is the single source of truth for these contracts (D-13);
 * remote packages import via `import type`.
 *
 * D-01: RemoteConfig — full configuration for loading a remote application
 * D-02: MfeContext — host infrastructure (DI, EventBus, Store) injected into remotes
 * D-05: MfeAppLifecycle — standard lifecycle factory return contract
 * D-06: MfeAppInstance — mount return value (unmount + update)
 * D-19: MfeControllerRef — explicit destroy API for imperative control
 * D-23: MfeRemoteEntry — database row representation
 */

import type React from 'react';

// ── Remote Config ──────────────────────────────────────────────────────

/**
 * Configuration for loading a remote micro frontend application.
 *
 * Passed to MfeLoader to specify which remote to load and how to handle
 * loading states, errors, and timeouts.
 *
 * D-01: Full config object with name, optional fallbacks, retry and timeout
 * D-03: RemoteConfig props override MfeConfigProvider defaults
 * D-17: retryCount controls manual retry button behavior (default 0)
 * D-18: timeout controls loading timeout in ms (default 30000)
 */
export interface RemoteConfig {
  /** Unique remote application name (used for DB lookup and cache key) */
  name: string;
  /** Optional entry URL override (skips DB query when provided) */
  url?: string;
  /** Per-instance error fallback override */
  fallback?: React.ComponentType<{
    error?: Error;
    name: string;
    onRetry: () => void;
    onDismiss: () => void;
  }>;
  /** Per-instance loading fallback override */
  loadingFallback?: React.ComponentType;
  /** Number of retry attempts (default 0, D-17 manual retry) */
  retryCount?: number;
  /** Loading timeout in milliseconds (default 30000, D-18) */
  timeout?: number;
}

// ── MFE Context ────────────────────────────────────────────────────────

/**
 * Host infrastructure injected into remote applications via createMfeApp ctx.
 *
 * All fields are optional since Phase 12 implements full bridging — this
 * phase defines the contract shape only.
 *
 * D-02: Business data via React props, infrastructure via MfeContext
 * D-07: ctx provides eventBus, serviceRegistry, and store references
 */
export interface MfeContext {
  /** Event bus for pub/sub communication (D-07) */
  eventBus?: {
    subscribe: (event: string, handler: Function) => () => void;
    publish: (event: string, payload?: any) => void;
  };
  /** Generic service registry map (DI container services) */
  serviceRegistry?: Record<string, any>;
  /** Generic store reference (Zustand, Redux, etc.) */
  store?: Record<string, any>;
}

// ── MFE App Lifecycle ──────────────────────────────────────────────────

/**
 * Standard lifecycle returned by createMfeApp factory function.
 *
 * D-05: Factory export format: createMfeApp(ctx) => MfeAppLifecycle
 * D-08: Single initialization — factory called once, returned object reused
 * D-09: mount and unmount are fully async
 * D-10: styles array for auto-injected/removed CSS URLs
 * D-12: Backward compat — default React components auto-wrapped to this shape
 */
export interface MfeAppLifecycle {
  /**
   * Mount the remote application into the given container.
   * Returns an MfeAppInstance with unmount and update methods.
   */
  mount(
    container: HTMLElement,
    props?: Record<string, any>,
  ): Promise<MfeAppInstance>;
  /** Unmount the remote application and clean up resources */
  unmount(): Promise<void>;
  /** Update the mounted application with new props (no destroy/recreate) */
  update(props: Record<string, any>): Promise<void>;
  /** Optional URLs for third-party CSS to inject on mount and remove on unmount */
  styles?: string[];
}

// ── MFE App Instance ───────────────────────────────────────────────────

/**
 * Return value of MfeAppLifecycle.mount().
 *
 * D-06: mount returns { unmount, update } for the mounted instance
 * Allows per-instance lifecycle control after the initial mount
 */
export interface MfeAppInstance {
  /** Clean up the specific mounted instance */
  unmount: () => Promise<void>;
  /** Update the specific mounted instance with new props */
  update: (props: Record<string, any>) => Promise<void>;
}

// ── MFE Config Defaults ────────────────────────────────────────────────

/**
 * Global default overrides provided by MfeConfigProvider.
 *
 * D-03: Two-layer fallback — MfeConfigProvider (global) + RemoteConfig (per-instance)
 * D-15: defaultLoadingFallback replaces the default centered spinner
 */
export interface MfeConfigDefaults {
  /** Global default loading fallback (replaces spinner) */
  defaultLoadingFallback?: React.ComponentType;
  /** Global default error fallback */
  defaultErrorFallback?: React.ComponentType<{
    error: Error;
    name: string;
    onRetry: () => void;
    onDismiss: () => void;
  }>;
  /** Global default loading timeout in ms */
  defaultTimeout?: number;
}

// ── MFE Controller Ref ─────────────────────────────────────────────────

/**
 * Explicit destroy/imperative control API for MfeLoader.
 *
 * D-19: ref.unmount() allows callers to trigger cleanup from outside
 * the React tree (e.g., from a parent effect or event handler)
 */
export interface MfeControllerRef {
  /** Imperatively trigger unmount of this MfeLoader instance */
  unmount: () => Promise<void>;
}

// ── MFE Remote Entry ───────────────────────────────────────────────────

/**
 * Database representation of a registered remote micro frontend.
 *
 * D-23: mfe_remotes table row returned by /api/mfe/remotes
 * D-11: Remote metadata managed by backend SQLite, not by remotes themselves
 */
export interface MfeRemoteEntry {
  /** Unique remote name (DB primary key) */
  name: string;
  /** Remote entry URL (remoteEntry.js) */
  entry: string;
  /** Optional metadata JSON blob */
  meta?: Record<string, any>;
}

// ── MFE Remote Cache Entry ─────────────────────────────────────────────

/**
 * In-memory cache entry with timestamp for TTL-based expiration.
 *
 * Used by cache.ts to manage the in-memory entry URL cache (D-24).
 * Includes the original MfeRemoteEntry data plus a timestamp for expiry.
 */
export interface MfeRemoteCacheEntry {
  /** Remote entry URL */
  entry: string;
  /** Optional metadata */
  meta: Record<string, any>;
  /** Cache insertion timestamp (ms since epoch) */
  timestamp: number;
}
