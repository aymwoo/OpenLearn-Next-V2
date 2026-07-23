/**
 * OpenLearn Platform Service Registry - Strict TypeScript Definitions (PI-007)
 */

export type ServiceLifetime = 'Singleton' | 'Scoped' | 'Transient';

export type ServiceScopeType = 'Singleton' | 'Session' | 'Lesson' | 'Plugin' | 'Transient' | 'Scoped';

export type ServiceLifecycleState =
  | 'Registered'
  | 'Initialized'
  | 'Started'
  | 'Ready'
  | 'Stopped'
  | 'Disposed';

export interface ServiceDescriptor<T = unknown> {
  readonly id: string;
  readonly namespace?: string;
  readonly serviceType?: string;
  readonly version?: string;
  readonly implementation?: new (...args: any[]) => T;
  readonly factory?: (scope?: unknown) => T;
  readonly instance?: T;
  readonly lifetime?: ServiceLifetime;
  readonly scope?: ServiceScopeType;
  readonly singleton?: boolean;
  readonly dependencies?: ReadonlyArray<string>;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly description?: string;
}

export interface ServiceRegistration<T = unknown> {
  readonly descriptor: ServiceDescriptor<T>;
  readonly registeredAt: number;
}

export interface ServiceReference<T = unknown> {
  readonly serviceId: string;
  readonly lifetime: ServiceLifetime;
  readonly instance?: T;
}

export interface ServiceValidationError {
  readonly code: string;
  readonly message: string;
  readonly serviceId?: string;
}

export interface ServiceValidationResult {
  readonly isValid: boolean;
  readonly errors: ReadonlyArray<ServiceValidationError>;
  readonly warnings: ReadonlyArray<string>;
}

export interface ServiceInspectionInfo {
  readonly id: string;
  readonly namespace: string;
  readonly serviceType: string;
  readonly version: string;
  readonly scope: ServiceScopeType;
  readonly lifecycleState: ServiceLifecycleState;
  readonly dependencies: ReadonlyArray<string>;
}

// ── Service Event Map ─────────────────────────────────────────────────────

export interface ServiceEventMap {
  ServiceRegistered: { readonly serviceId: string; readonly namespace?: string };
  ServiceReady: { readonly serviceId: string };
  ServiceStopped: { readonly serviceId: string };
  ServiceDisposed: { readonly serviceId: string };
  ServiceRemoved: { readonly serviceId: string };
  ServiceReplaced: { readonly serviceId: string };
  ServiceResolved: { readonly serviceId: string };
  ResolutionFailed: { readonly serviceId: string; readonly error: string };
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
