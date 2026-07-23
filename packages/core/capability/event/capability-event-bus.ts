/**
 * OpenLearn Capability Invocation Framework - Event Bus
 * Typed event pipeline for Capability lifecycle events.
 */

import {
  CapabilityEventType,
  CapabilityEventMap,
  CapabilityEventEnvelope,
  CapabilityEventSubscriber,
} from '../types/index.js';

export class CapabilityEventBus {
  private subscribers = new Map<string, Set<CapabilityEventSubscriber<any>>>();

  public subscribe<K extends CapabilityEventType>(
    eventType: K | '*',
    subscriber: CapabilityEventSubscriber<K>
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

  public async publish<K extends CapabilityEventType>(
    type: K,
    payload: CapabilityEventMap[K]
  ): Promise<CapabilityEventEnvelope<K>> {
    const envelope: CapabilityEventEnvelope<K> = {
      id: `capevt_${globalThis.crypto.randomUUID()}`,
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
          console.error(`[CapabilityEventBus] Error in subscriber for ${String(type)}:`, err);
        })
      )
    );

    return envelope;
  }

  public clear(): void {
    this.subscribers.clear();
  }
}
