/**
 * Platform Event Bus — shared types & contracts (PI-010).
 *
 * The Platform Event Bus carries ONLY platform-infrastructure events: platform
 * lifecycle, bootstrap pipeline stages, service-registry and capability-runtime
 * notifications, and configuration loading. It is deliberately separate from
 * business event systems (classroom messaging, plugin communication, etc.).
 */

import type { EventContext } from './EventContext.js';

/** The 12 supported platform infrastructure event types. */
export const PlatformEventType = {
  PlatformStarting: 'PlatformStarting',
  PlatformStarted: 'PlatformStarted',
  PlatformStopping: 'PlatformStopping',
  PlatformStopped: 'PlatformStopped',
  ServiceRegistered: 'ServiceRegistered',
  ServiceRemoved: 'ServiceRemoved',
  CapabilityRegistered: 'CapabilityRegistered',
  CapabilityResolved: 'CapabilityResolved',
  BootstrapStageStarted: 'BootstrapStageStarted',
  BootstrapStageCompleted: 'BootstrapStageCompleted',
  BootstrapStageFailed: 'BootstrapStageFailed',
  ConfigurationLoaded: 'ConfigurationLoaded',
} as const;

export type PlatformEventTypeValue =
  | (typeof PlatformEventType)[keyof typeof PlatformEventType]
  | (string & {});

/** Seed used to construct a {@link PlatformEvent}. */
export interface PlatformEventInit<T = unknown> {
  readonly type: string;
  readonly source: string;
  readonly payload: T;
  readonly eventId?: string;
  readonly timestamp?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly correlationId?: string;
}

/** The immutable platform event object. */
export interface PlatformEvent<T = unknown> {
  readonly eventId: string;
  readonly type: string;
  readonly source: string;
  readonly payload: T;
  readonly timestamp: number;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly correlationId?: string;
}

/** Metadata describing an event type (used for registration/introspection). */
export interface EventDescriptorInit {
  readonly type: string;
  readonly source: string;
  readonly description?: string;
  readonly version?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type EventHandlerMode = 'sync' | 'async';

export type EventFilter = (context: EventContext) => boolean;

/** Options controlling how a handler is registered and invoked. */
export interface EventHandlerOptions {
  readonly id?: string;
  /** Higher priority handlers run first (default 0). */
  readonly priority?: number;
  /** Tie-breaker when priorities are equal (lower runs first, default 0). */
  readonly order?: number;
  /** When present, the handler only runs if the filter returns true. */
  readonly filter?: EventFilter;
  /** 'async' (default) awaits the handler; 'sync' is invoked without await. */
  readonly mode?: EventHandlerMode;
  /** Remove the handler after its first successful (or attempted) invocation. */
  readonly once?: boolean;
  /** Per-handler timeout in ms; on expiry the handler is recorded as timed out. */
  readonly timeoutMs?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type HandlerStatus = 'success' | 'error' | 'timeout' | 'skipped' | 'cancelled';

/** Outcome of a single handler invocation during a dispatch. */
export interface HandlerResult {
  readonly handlerId: string;
  readonly eventType: string;
  readonly durationMs: number;
  readonly status: HandlerStatus;
  readonly error?: string;
}

/** Aggregate outcome of dispatching one event to all matched handlers. */
export interface EventResult {
  readonly eventId: string;
  readonly type: string;
  readonly correlationId?: string;
  readonly dispatched: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly cancelled: boolean;
  readonly durationMs: number;
  readonly results: ReadonlyArray<HandlerResult>;
}

/** A handler function: receives the {@link EventContext} and may be async. */
export type EventHandlerFn = (context: EventContext) => void | Promise<void>;

/**
 * Structural seam for integrating the Capability Runtime with the Platform
 * Event Bus. The real `CapabilityRuntime` may expose these optional callbacks;
 * the bus subscribes when present. Declared structurally so the kernel can wire
 * capability events without the bus depending on the capability module.
 */
export interface CapabilityEventSource {
  onCapabilityRegistered?: (listener: (capabilityId: string) => void) => () => void;
  onCapabilityResolved?: (listener: (capabilityId: string) => void) => () => void;
}

/** Structural view of a builder integration source. */
export interface BuilderIntegrationSource {
  eventDispatcher?: {
    dispatch?: (type: string, payload?: unknown) => void | Promise<void>;
  };
}
