/**
 * MfeConfigProvider — React Context for global MFE UI default configuration.
 *
 * D-03: Loading/Error UI customization uses a two-layer override:
 *   1. MfeConfigProvider sets global default components
 *   2. Individual MfeLoader can override via RemoteConfig props
 *
 * D-15: Default loading UI is a centered spinner animation (via lucide-react).
 * D-18: Default loading timeout is 30 seconds.
 *
 * Usage:
 *   <MfeConfigProvider>
 *     <App />
 *   </MfeConfigProvider>
 *
 *   // In any descendant component or MfeLoader:
 *   const config = useMfeConfig();
 *   config.defaultTimeout // 30000
 */

import React, { createContext, useContext } from 'react';

/**
 * Shape of the MFE configuration context.
 *
 * All fields are optional — default values are applied by MfeConfigProvider.
 */
export interface MfeConfigDefaults {
  /** Custom loading fallback component. Renders a centered spinner by default. */
  defaultLoadingFallback?: React.ComponentType;
  /** Custom error fallback component. Renders error card with retry/dismiss by default. */
  defaultErrorFallback?: React.ComponentType<{
    error: Error;
    name: string;
    onRetry: () => void;
    onDismiss: () => void;
  }>;
  /** Loading timeout in milliseconds. Default: 30000. */
  defaultTimeout: number;
}

const MfeConfigContext = createContext<MfeConfigDefaults | null>(null);

export interface MfeConfigProviderProps {
  children: React.ReactNode;
  /** Optional partial config merged over internal defaults. */
  value?: Partial<MfeConfigDefaults>;
}

const INTERNAL_DEFAULTS: MfeConfigDefaults = {
  defaultTimeout: 30000,
};

/**
 * Global MFE UI configuration provider.
 *
 * Renders without an explicit `value` prop to use internal defaults
 * (spinner loading, error fallback, 30s timeout). Pass a partial `value`
 * to override specific defaults.
 */
export function MfeConfigProvider({ children, value }: MfeConfigProviderProps) {
  const merged: MfeConfigDefaults = {
    ...INTERNAL_DEFAULTS,
    ...value,
  };

  return (
    <MfeConfigContext.Provider value={merged}>
      {children}
    </MfeConfigContext.Provider>
  );
}

/**
 * Hook to access the MFE configuration defaults.
 *
 * Must be used within <MfeConfigProvider>.
 * Throws if called outside the provider context.
 */
export function useMfeConfig(): MfeConfigDefaults {
  const ctx = useContext(MfeConfigContext);
  if (!ctx) {
    throw new Error('useMfeConfig must be used within MfeConfigProvider');
  }
  return ctx;
}
