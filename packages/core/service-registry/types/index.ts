/**
 * OpenLearn Platform Service Registry - Strict TypeScript Definitions
 * No `any` types permitted. Uses Interfaces, Generics, and Readonly types throughout.
 */

export type ServiceScope = 'Singleton' | 'Session' | 'Lesson' | 'Plugin' | 'Transient';

export type ServiceLifecycleState =
  | 'Registered'
  | 'Initialized'
  | 'Started'
  | 'Ready'
  | 'Stopped'
  | 'Disposed';

export interface ServiceDescriptor<T = unknown> {
  readonly id: string;
  readonly namespace: string;
  readonly serviceType: string;
  readonly version: string;
  readonly implementation: new (...args: any[]) => T;
  readonly scope: ServiceScope;
  readonly singleton: boolean;
  readonly dependencies: ReadonlyArray<string>;
  readonly metadata: Record<string, unknown>;
}

export interface ServiceInspectionInfo {
  readonly id: string;
  readonly namespace: string;
  readonly serviceType: string;
  readonly version: string;
  readonly scope: ServiceScope;
  readonly lifecycleState: ServiceLifecycleState;
  readonly dependencies: ReadonlyArray<string>;
}

// ── Service Event Map ─────────────────────────────────────────────────────

export interface ServiceEventMap {
  ServiceRegistered: { readonly serviceId: string; readonly namespace: string };
  ServiceReady: { readonly serviceId: string };
  ServiceStopped: { readonly serviceId: string };
  ServiceDisposed: { readonly serviceId: string };
}

export type ServiceEventType = keyof ServiceEventMap;

export interface ServiceEventEnvelope<K extends ServiceEventType = ServiceEventType> {
  readonly id: string;
  readonly type: K;
  readonly payload: ServiceEventMap[K];
  readonly timestamp: number;
}

export type ServiceEventSubscriber<K extends ServiceEventType> = (
  event: ServiceEventEnvelope<K>
) => void | Promise<void>;
