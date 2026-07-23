/**
 * EventBus — the Platform Event Bus (PI-010).
 *
 * Top-level orchestrator that wires the {@link EventRegistry},
 * {@link EventDispatcher}, and {@link EventPublisher} into a single,
 * platform-infrastructure event system. It is concerned ONLY with platform
 * events (lifecycle, bootstrap, service-registry, capability-runtime,
 * configuration) — never business/domain events.
 *
 * Integrations (no business modules touched):
 *  - `ServiceRegistry`  — via `bridgeServiceEventBus(ServiceEventBus)`.
 *  - `BootstrapPipeline`— via `bridgeBootstrapPipeline(BootstrapPipeline)`.
 *  - `CapabilityRuntime`— via `bridgeCapabilityRuntime(CapabilityEventSource)`.
 *  - `PlatformBuilder`  — via `attachBuilder(BuilderIntegrationSource)`.
 *  - `DependencyInjection` — events carry `correlationId` and integrate with the
 *    same `IPlatformLogger` reused across the kernel.
 */

import { DefaultPlatformLogger, type IPlatformLogger } from '../bootstrap/types/index.js';
import { ServiceEventBus } from '../service-registry/index.js';
import { BootstrapPipeline } from '../bootstrap/pipeline/bootstrap-pipeline.js';
import { PlatformEventObject } from './PlatformEvent.js';
import { EventDescriptor } from './EventDescriptor.js';
import { EventContext } from './EventContext.js';
import { EventPublisher } from './EventPublisher.js';
import { EventSubscriber } from './EventSubscriber.js';
import { EventDispatcher } from './EventDispatcher.js';
import { EventRegistry } from './EventRegistry.js';
import { EventError } from './EventError.js';
import {
  PlatformEventType,
  type BuilderIntegrationSource,
  type CapabilityEventSource,
  type EventHandlerFn,
  type EventHandlerOptions,
  type EventResult,
  type PlatformEvent,
  type PlatformEventInit,
} from './types.js';

export interface EventBusOptions {
  readonly logger?: IPlatformLogger;
  /** When true, convenience publishers also log each published event. */
  readonly verbose?: boolean;
}

export class EventBus {
  private readonly registry = new EventRegistry();
  private readonly dispatcher: EventDispatcher;
  private readonly publisher: EventPublisher;
  private readonly logger: IPlatformLogger;
  private builderSource?: BuilderIntegrationSource;
  private readonly bridges: Array<() => void> = [];

  public constructor(options?: EventBusOptions) {
    this.logger = options?.logger ?? new DefaultPlatformLogger();
    this.dispatcher = new EventDispatcher(this.registry);
    this.publisher = new EventPublisher(this.dispatcher, this.logger);
    console.log('[PlatformEventBus] Initialized.');
  }

  // ── Publishing ─────────────────────────────────────────────────────────

  public publish(event: PlatformEvent): Promise<EventResult> {
    return this.publisher.publish(event);
  }

  public publishAsync(event: PlatformEvent): Promise<EventResult> {
    return this.publisher.publishAsync(event);
  }

  public publishSync(event: PlatformEvent): EventResult {
    return this.publisher.publishSync(event);
  }

  /** Build a {@link PlatformEvent} (fills eventId/timestamp defaults). */
  public createEvent<T = unknown>(init: PlatformEventInit<T>): PlatformEvent<T> {
    return new PlatformEventObject<T>(init);
  }

  // ── Subscription ─────────────────────────────────────────────────────────

  public subscribe(
    eventType: string,
    fn: EventHandlerFn,
    options?: EventHandlerOptions,
  ): EventSubscriber {
    return this.registry.subscribe(eventType, fn, options);
  }

  public subscribeOnce(
    eventType: string,
    fn: EventHandlerFn,
    options?: EventHandlerOptions,
  ): EventSubscriber {
    return this.registry.subscribeOnce(eventType, fn, options);
  }

  public unsubscribe(subscriberOrId: EventSubscriber | string): boolean {
    if (typeof subscriberOrId === 'string') return this.registry.unsubscribe(subscriberOrId);
    subscriberOrId.unsubscribe();
    return true;
  }

  public clear(): void {
    this.registry.clear();
  }

  public get subscriptionCount(): number {
    return this.registry.size;
  }

  /** Describe a platform event type (introspection helper). */
  public describe(type: string, source: string, description?: string): EventDescriptor {
    return new EventDescriptor({ type, source, description });
  }

  // ── Convenience publishers (the 12 supported platform event types) ──────

  public publishPlatformStarting(source = 'platform', metadata?: Record<string, unknown>): Promise<EventResult> {
    return this.publish(this.createEvent({ type: PlatformEventType.PlatformStarting, source, payload: {}, metadata }));
  }

  public publishPlatformStarted(source = 'platform', metadata?: Record<string, unknown>): Promise<EventResult> {
    return this.publish(this.createEvent({ type: PlatformEventType.PlatformStarted, source, payload: {}, metadata }));
  }

  public publishPlatformStopping(source = 'platform', metadata?: Record<string, unknown>): Promise<EventResult> {
    return this.publish(this.createEvent({ type: PlatformEventType.PlatformStopping, source, payload: {}, metadata }));
  }

  public publishPlatformStopped(source = 'platform', metadata?: Record<string, unknown>): Promise<EventResult> {
    return this.publish(this.createEvent({ type: PlatformEventType.PlatformStopped, source, payload: {}, metadata }));
  }

  public publishServiceRegistered(
    serviceId: string,
    namespace?: string,
    source = 'service-registry',
  ): Promise<EventResult> {
    return this.publish(
      this.createEvent({
        type: PlatformEventType.ServiceRegistered,
        source,
        payload: { serviceId, namespace },
      }),
    );
  }

  public publishServiceRemoved(serviceId: string, source = 'service-registry'): Promise<EventResult> {
    return this.publish(
      this.createEvent({ type: PlatformEventType.ServiceRemoved, source, payload: { serviceId } }),
    );
  }

  public publishCapabilityRegistered(capabilityId: string, source = 'capability-runtime'): Promise<EventResult> {
    return this.publish(
      this.createEvent({ type: PlatformEventType.CapabilityRegistered, source, payload: { capabilityId } }),
    );
  }

  public publishCapabilityResolved(capabilityId: string, source = 'capability-runtime'): Promise<EventResult> {
    return this.publish(
      this.createEvent({ type: PlatformEventType.CapabilityResolved, source, payload: { capabilityId } }),
    );
  }

  public publishBootstrapStageStarted(
    stageName: string,
    stageId?: string,
    source = 'bootstrap-pipeline',
  ): Promise<EventResult> {
    return this.publish(
      this.createEvent({
        type: PlatformEventType.BootstrapStageStarted,
        source,
        payload: { stageName, stageId },
      }),
    );
  }

  public publishBootstrapStageCompleted(
    stageName: string,
    stageId?: string,
    durationMs?: number,
    source = 'bootstrap-pipeline',
  ): Promise<EventResult> {
    return this.publish(
      this.createEvent({
        type: PlatformEventType.BootstrapStageCompleted,
        source,
        payload: { stageName, stageId, durationMs },
      }),
    );
  }

  public publishBootstrapStageFailed(
    stageName: string,
    stageId?: string,
    error?: Error,
    source = 'bootstrap-pipeline',
  ): Promise<EventResult> {
    return this.publish(
      this.createEvent({
        type: PlatformEventType.BootstrapStageFailed,
        source,
        payload: { stageName, stageId, error: error?.message },
      }),
    );
  }

  public publishConfigurationLoaded(
    config?: Record<string, unknown>,
    source = 'platform-builder',
  ): Promise<EventResult> {
    return this.publish(
      this.createEvent({ type: PlatformEventType.ConfigurationLoaded, source, payload: { config } }),
    );
  }

  // ── Integration bridges ───────────────────────────────────────────────────

  /** Forward ServiceRegistry lifecycle events as platform events. */
  public bridgeServiceEventBus(bus: ServiceEventBus): () => void {
    const offRegistered = bus.subscribe('ServiceRegistered', (env) => {
      void this.publishServiceRegistered(env.payload.serviceId, env.payload.namespace);
    });
    const offRemoved = bus.subscribe('ServiceRemoved', (env) => {
      void this.publishServiceRemoved(env.payload.serviceId);
    });
    const dispose = () => {
      offRegistered();
      offRemoved();
    };
    this.bridges.push(dispose);
    return dispose;
  }

  /** Forward BootstrapPipeline stage diagnostics as platform events. */
  public bridgeBootstrapPipeline(pipeline: BootstrapPipeline): () => void {
    const off = pipeline.addListener((event) => {
      if (event.type === 'StageStarted') {
        void this.publishBootstrapStageStarted(event.stageName ?? 'unknown', event.stageId);
      } else if (event.type === 'StageCompleted') {
        void this.publishBootstrapStageCompleted(
          event.stageName ?? 'unknown',
          event.stageId,
          event.durationMs,
        );
      } else if (event.type === 'StageFailed') {
        void this.publishBootstrapStageFailed(event.stageName ?? 'unknown', event.stageId, event.error);
      }
    });
    this.bridges.push(off);
    return off;
  }

  /** Forward CapabilityRuntime registration/resolution events as platform events. */
  public bridgeCapabilityRuntime(source: CapabilityEventSource): () => void {
    const offs: Array<() => void> = [];
    if (source.onCapabilityRegistered) {
      offs.push(
        source.onCapabilityRegistered((capabilityId) => {
          void this.publishCapabilityRegistered(capabilityId);
        }),
      );
    }
    if (source.onCapabilityResolved) {
      offs.push(
        source.onCapabilityResolved((capabilityId) => {
          void this.publishCapabilityResolved(capabilityId);
        }),
      );
    }
    const dispose = () => offs.forEach((off) => off());
    this.bridges.push(dispose);
    return dispose;
  }

  /** Attach a builder integration source for cross-referencing. */
  public attachBuilder(source: BuilderIntegrationSource): void {
    this.builderSource = source;
  }

  public isBuilderAware(): boolean {
    return !!this.builderSource?.eventDispatcher;
  }

  /** Tear down all active bridges (does not clear user subscriptions). */
  public disposeBridges(): void {
    while (this.bridges.length) {
      const off = this.bridges.pop();
      try {
        off?.();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        throw new EventError(`Failed to dispose bridge: ${message}`, 'BRIDGE_FAILED');
      }
    }
  }
}

// Re-export the platform event-type constant for convenience.
export { PlatformEventType };
export { EventContext };
