/**
 * MfeContextProvider — React Context for injecting platform infrastructure
 * (eventBus, serviceRegistry, store) into remote MFE components.
 *
 * D-02: Host infrastructure (DI, EventBus, Store) is injected via React Context.
 *       Remote components consume these via useMfeContext().
 * D-07: The createMfeApp(ctx) factory receives MfeContext containing host service
 *       references for initialization.
 *
 * Usage:
 *   <MfeContextProvider value={{ eventBus, serviceRegistry, store }}>
 *     <MfeLoader name="mfe_whiteboard" ... />
 *   </MfeContextProvider>
 *
 *   // In remote component code:
 *   const { infra } = useMfeContext();
 *   infra.eventBus.on('lesson.created', ...);
 */

import React, { createContext, useContext } from 'react';

/**
 * Platform infrastructure context provided to remote MFE components.
 *
 * References to host services (EventBus, ServiceRegistry, Store)
 * are injected here so remote components can consume platform
 * capabilities without prop drilling.
 */
export interface MfeContext {
  /** Host event bus for pub/sub communication */
  eventBus?: {
    on: (event: string, handler: (...args: any[]) => void) => void;
    off: (event: string, handler: (...args: any[]) => void) => void;
    emit: (event: string, ...args: any[]) => void;
  };
  /** Host service registry for DI */
  serviceRegistry?: {
    get: <T>(token: string) => T | undefined;
    getAll: () => Map<string, any>;
  };
  /** Host state management store */
  store?: {
    getState: () => Record<string, any>;
    setState: (partial: Record<string, any>) => void;
    subscribe: (listener: (state: Record<string, any>) => void) => () => void;
  };
}

const MfeContext = createContext<MfeContext | null>(null);

export interface MfeContextProviderProps {
  children: React.ReactNode;
  value: MfeContext;
}

/**
 * Platform infrastructure context provider.
 *
 * Injects eventBus, serviceRegistry, and store references into the
 * React tree so remote MFE components can access host capabilities.
 */
export function MfeContextProvider({ children, value }: MfeContextProviderProps) {
  return (
    <MfeContext.Provider value={value}>
      {children}
    </MfeContext.Provider>
  );
}

/**
 * Hook to access the platform infrastructure context.
 *
 * Must be used within <MfeContextProvider>.
 * Throws if called outside the provider context.
 */
export function useMfeInfraContext(): MfeContext {
  const ctx = useContext(MfeContext);
  if (!ctx) {
    throw new Error('useMfeInfraContext must be used within MfeContextProvider');
  }
  return ctx;
}
