/**
 * MFE module barrel export.
 *
 * Re-exports all public MFE APIs: components, hooks, types, and utilities.
 * This file is the single import target for consumers:
 *
 *   import { MfeLoader, MfeErrorBoundary, useMfeContext, preload } from '../mfe';
 *   import type { MfeControllerRef, MfeAppLifecycle } from '../mfe';
 */

// ── Components ───────────────────────────────────────────────────────────
export { MfeLoader } from './MfeLoader';
export { MfeErrorBoundary } from './MfeErrorBoundary';
export { MfeLoaderCore } from './MfeLoaderCore';

// ── Providers ────────────────────────────────────────────────────────────
export { MfeConfigProvider, useMfeConfig } from './MfeConfigProvider';
export { MfeContextProvider, useMfeInfraContext } from './MfeContextProvider';

// ── Hooks ────────────────────────────────────────────────────────────────
export { useMfeContext } from './useMfeContext';

// ── Utilities ────────────────────────────────────────────────────────────
export { preload, preloadAll } from './preload';
export { fetchRemoteEntry, fetchAllRemotes } from './api';
export { createLeakDetector } from './leak-detector';

// ── Types ────────────────────────────────────────────────────────────────
export type {
  MfeConfigDefaults,
  MfeContext,
  MfeAppLifecycle,
  MfeAppInstance,
  MfeControllerRef,
  MfeRemoteEntry,
  MfeRemoteCacheEntry,
  RemoteConfig,
} from './types';
