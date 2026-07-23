/**
 * OpenLearn Platform Service Registry - Event Bus
 * Typed event bus for service lifecycle events.
 */

import {
  ServiceEventType,
  ServiceEventMap,
  ServiceEventEnvelope,
  ServiceEventSubscriber,
} from '../types/index.js';

export class ServiceEventBus {
  private subscribers = new Map<string, Set<ServiceEventSubscriber<any>>>();

  public subscribe<K extends ServiceEventType>(
    eventType: K | '*',
    subscriber: ServiceEventSubscriber<K>
  ): () => void {
    const key = String(eventType);
    if (!this.subscribers.has(key)) {
      this.subscribers.set(key, new Set());
    }
    const set = this.subscribers.get(key)!;
    set.add(subscriber);

    return () => {
      set.delete(subscriber);
    };
  }

  public async publish<K extends ServiceEventType>(
    type: K,
    payload: ServiceEventMap[K]
  ): Promise<ServiceEventEnvelope<K>> {
    const envelope: ServiceEventEnvelope<K> = {
      id: `svcevt_${globalThis.crypto.randomUUID()}`,
      type,
      payload,
      timestamp: Date.now(),
    };

    const channelSubs = this.subscribers.get(String(type)) || new Set();
    const wildcardSubs = this.subscribers.get('*') || new Set();

    const allSubs = [...Array.from(channelSubs), ...Array.from(wildcardSubs)];

    await Promise.all(
      allSubs.map((sub) =>
        Promise.resolve(sub(envelope)).catch((err: unknown) => {
          console.error(`[ServiceEventBus] Error in subscriber for ${String(type)}:`, err);
        })
      )
    );

    return envelope;
  }

  public clear(): void {
    this.subscribers.clear();
  }
}
