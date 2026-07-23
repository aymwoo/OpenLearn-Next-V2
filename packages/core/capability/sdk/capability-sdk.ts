/**
 * OpenLearn Capability Framework SDK
 * High-level SDK for registering, invoking, watching, and querying capabilities.
 */

import {
  CapabilityDescriptor,
  CapabilityContext,
  CapabilityResult,
  ICapabilityProviderHandler,
  CapabilityEventType,
  CapabilityEventSubscriber,
} from '../types/index.js';
import { CapabilityFrameworkRegistry } from '../registry/capability-framework-registry.js';
import { InvocationEngine } from '../invocation/invocation-engine.js';
import { CapabilityEventBus } from '../event/capability-event-bus.js';

export class CapabilitySDK {
  private registry: CapabilityFrameworkRegistry;
  private engine: InvocationEngine;
  private eventBus: CapabilityEventBus;

  constructor(
    registry: CapabilityFrameworkRegistry,
    engine: InvocationEngine,
    eventBus: CapabilityEventBus
  ) {
    this.registry = registry;
    this.engine = engine;
    this.eventBus = eventBus;
  }

  public registerCapability(handler: ICapabilityProviderHandler): void {
    this.registry.register(handler);
  }

  public async invokeCapability<T = unknown>(
    capabilityId: string,
    payload: Record<string, unknown>,
    context: CapabilityContext
  ): Promise<CapabilityResult<T>> {
    const request = {
      id: `inv_${globalThis.crypto.randomUUID()}`,
      capabilityId,
      payload,
      context,
    };
    return this.engine.invoke(request) as Promise<CapabilityResult<T>>;
  }

  public watchCapability<K extends CapabilityEventType>(
    eventType: K | '*',
    subscriber: CapabilityEventSubscriber<K>
  ): () => void {
    return this.eventBus.subscribe(eventType, subscriber);
  }

  public queryCapability(categoryOrTag?: string): ReadonlyArray<CapabilityDescriptor> {
    if (!categoryOrTag) {
      return this.registry.list();
    }
    const byCategory = this.registry.list(categoryOrTag);
    if (byCategory.length > 0) {
      return byCategory;
    }
    return this.registry.discover(categoryOrTag);
  }
}
