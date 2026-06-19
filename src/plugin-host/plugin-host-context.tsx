/**
 * PluginHostProvider — React Context for distributing FrontendPluginHost.
 *
 * D-03: PluginHost instance distributed via React Context to the entire
 * component tree, avoiding prop drilling.
 *
 * Usage:
 *   <PluginHostProvider host={host}>
 *     <App />
 *   </PluginHostProvider>
 *
 *   // In any descendant component:
 *   const host = usePluginHost();
 *   host.activatePlugin('my-plugin');
 */

import React, { createContext, useContext } from 'react';
import { FrontendPluginHost } from './plugin-host';

const PluginHostContext = createContext<FrontendPluginHost | null>(null);

export interface PluginHostProviderProps {
  children: React.ReactNode;
  host: FrontendPluginHost;
}

export function PluginHostProvider({ children, host }: PluginHostProviderProps) {
  return (
    <PluginHostContext.Provider value={host}>
      {children}
    </PluginHostContext.Provider>
  );
}

/**
 * Hook to access the FrontendPluginHost instance.
 *
 * Must be used within a <PluginHostProvider>.
 * Throws if called outside the provider context.
 */
export function usePluginHost(): FrontendPluginHost {
  const ctx = useContext(PluginHostContext);
  if (!ctx) {
    throw new Error('usePluginHost must be used within PluginHostProvider');
  }
  return ctx;
}
