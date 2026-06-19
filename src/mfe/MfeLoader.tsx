/**
 * MfeLoader — Public composition component for loading remote micro frontends.
 *
 * D-01: Full config via props — name, optional entry URL, fallback overrides,
 *       retry, timeout. RemoteConfig shape from types.ts.
 * D-03: Two-layer fallback — MfeConfigProvider (global) + per-instance overrides.
 * D-04: Container rendering via MfeLoaderCore using createRoot.
 * D-14: Per-instance ErrorBoundary — crash isolation between remotes.
 * D-19: mfeRef for imperative controller access.
 * D-27: Nested MfeLoader support — each instance has independent ErrorBoundary + createRoot.
 *
 * Usage:
 *   <MfeLoader
 *     name="mfe_whiteboard"
 *     props={{ lessonId: '123' }}
 *     onLoad={() => console.log('loaded')}
 *   />
 *
 *   <MfeLoader
 *     name="mfe_courseware"
 *     entry="http://localhost:5175/remoteEntry.js"
 *     loadingFallback={MyCustomSpinner}
 *     errorFallback={MyCustomError}
 *   />
 */

import React from 'react';
import { MfeErrorBoundary } from './MfeErrorBoundary';
import { MfeLoaderCore } from './MfeLoaderCore';
import { useMfeConfig } from './MfeConfigProvider';
import type { MfeErrorFallbackProps } from '../components/MfeErrorFallback';
import type { MfeControllerRef } from './types';

export interface MfeLoaderProps {
  /** Remote module name (e.g., 'mfe_whiteboard') */
  name: string;
  /** Pre-resolved entry URL (skip API lookup) */
  entry?: string;
  /** Props to pass to remote mount() */
  props?: Record<string, any>;
  /** Error fallback override (per-instance, D-03) */
  fallback?: React.ComponentType<MfeErrorFallbackProps>;
  /** Loading fallback override (per-instance, D-03) */
  loadingFallback?: React.ComponentType;
  /** Load timeout in ms */
  timeout?: number;
  /** Explicit controller ref for imperative unmount (D-19) */
  mfeRef?: React.Ref<MfeControllerRef>;
  /** Error callback for parent */
  onError?: (error: Error) => void;
  /** Success callback for parent */
  onLoad?: () => void;
}

/**
 * Public MfeLoader component — composition wrapper that provides:
 *
 * 1. Error boundary isolation (D-14) — catches render crashes per-instance
 * 2. Global config defaults merged with per-instance overrides (D-03)
 * 3. Controller ref forwarding (D-19)
 *
 * Delegates remote loading, container rendering, and cleanup to MfeLoaderCore.
 */
export function MfeLoader({
  name,
  entry,
  props: remoteProps,
  fallback: errorFallbackOverride,
  loadingFallback,
  timeout,
  mfeRef,
  onError,
  onLoad,
}: MfeLoaderProps) {
  const config = useMfeConfig();

  // D-03: Per-instance override > MfeConfigProvider default > internal default
  const effectiveErrorFallback = errorFallbackOverride || config.defaultErrorFallback;
  const effectiveLoadingFallback = loadingFallback || config.defaultLoadingFallback;

  return (
    <MfeErrorBoundary
      name={name}
      fallback={effectiveErrorFallback}
    >
      <MfeLoaderCore
        name={name}
        entry={entry}
        props={remoteProps}
        timeout={timeout ?? config.defaultTimeout}
        loadingFallback={effectiveLoadingFallback}
        errorFallback={effectiveErrorFallback}
        mfeRef={mfeRef}
        onError={onError}
        onLoad={onLoad}
      />
    </MfeErrorBoundary>
  );
}

export default MfeLoader;
