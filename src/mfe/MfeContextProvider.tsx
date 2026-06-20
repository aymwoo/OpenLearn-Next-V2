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
import type { MfeContext } from './types';


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

export const DI_WHITELIST = [
  '@openlearn/frontend:IFrontendAPI',
  '@openlearn/frontend:ISocketService',
  '@openlearn/frontend:IUIService',
  '@openlearn/frontend:IStorageService'
];

export class MfeServiceRegistryProxy {
  constructor(serviceRegistry: any) {}
  async resolve<T>(token: string): Promise<T> {
    return {} as any;
  }
  get<T>(token: string): T | undefined {
    return undefined;
  }
  has(token: string): boolean {
    return false;
  }
}

export class SocketBridge {
  constructor(socketService: any, hostEventBus: any) {}
  register(eventType: string) {}
  unregister(eventType: string) {}
}

