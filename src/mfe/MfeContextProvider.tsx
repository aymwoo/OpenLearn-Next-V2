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
import type { PlatformEvent } from '../../packages/core/event-bus';


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
  private serviceRegistry: any;

  constructor(serviceRegistry: any) {
    this.serviceRegistry = serviceRegistry;
  }

  private verifyWhitelist(token: string) {
    if (!DI_WHITELIST.includes(token)) {
      throw new Error(`Access Denied: Service token "${token}" is private to the Host Shell and cannot be resolved by Remote Micro Frontends.`);
    }
  }

  async resolve<T>(token: string): Promise<T> {
    this.verifyWhitelist(token);
    return this.serviceRegistry.resolve(token);
  }

  get<T>(token: string): T | undefined {
    this.verifyWhitelist(token);
    const servicesMap = (this.serviceRegistry as any).services;
    if (servicesMap && servicesMap.has(token)) {
      return servicesMap.get(token) as T;
    }
    return undefined;
  }

  has(token: string): boolean {
    this.verifyWhitelist(token);
    return this.serviceRegistry.has(token);
  }
}

export class SocketBridge {
  private socketService: any;
  private hostEventBus: any;
  private counts = new Map<string, number>();
  private handlers = new Map<string, (payload: any) => void>();

  constructor(socketService: any, hostEventBus: any) {
    this.socketService = socketService;
    this.hostEventBus = hostEventBus;
  }

  register(eventType: string) {
    const socketEvent = eventType.replace(/^server:/, '');
    const currentCount = this.counts.get(eventType) ?? 0;
    this.counts.set(eventType, currentCount + 1);

    if (currentCount === 0) {
      const handler = (payload: any) => {
        const event: PlatformEvent = {
          id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2),
          type: eventType,
          source: 'server',
          payload,
          timestamp: Date.now(),
        };
        this.hostEventBus.publish(event);
      };
      this.handlers.set(eventType, handler);
      this.socketService.on(socketEvent, handler);
    }
  }

  unregister(eventType: string) {
    const currentCount = this.counts.get(eventType) ?? 0;
    if (currentCount <= 0) return;

    if (currentCount === 1) {
      const handler = this.handlers.get(eventType);
      if (handler) {
        const socketEvent = eventType.replace(/^server:/, '');
        this.socketService.off(socketEvent, handler);
        this.handlers.delete(eventType);
      }
      this.counts.delete(eventType);
    } else {
      this.counts.set(eventType, currentCount - 1);
    }
  }
}

