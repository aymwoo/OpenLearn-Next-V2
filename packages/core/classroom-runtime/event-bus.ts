/**
 * OpenLearn Classroom Runtime - Event Bus Subsystem
 * Type-safe decoupled event pipeline for all classroom components.
 */

import {
  RuntimeEventType,
  RuntimeEventMap,
  RuntimeEventEnvelope,
  RuntimeEventSubscriber,
} from './types.js';

export class RuntimeEventBus {
  private subscribers = new Map<string, Set<RuntimeEventSubscriber<any>>>();

  /**
   * Subscribe to a specific runtime event channel.
   */
  public subscribe<K extends RuntimeEventType>(
    eventType: K | '*',
    subscriber: RuntimeEventSubscriber<K>
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

  /**
   * Publish a typed event to channel subscribers and wildcards.
   */
  public async publish<K extends RuntimeEventType>(
    type: K,
    payload: RuntimeEventMap[K],
    source = 'runtime.system'
  ): Promise<RuntimeEventEnvelope<K>> {
    const envelope: RuntimeEventEnvelope<K> = {
      id: `evt_${globalThis.crypto.randomUUID()}`,
      type,
      payload,
      source,
      timestamp: Date.now(),
    };

    const channelSubs = this.subscribers.get(String(type)) || new Set();
    const wildcardSubs = this.subscribers.get('*') || new Set();

    const allSubs = [...Array.from(channelSubs), ...Array.from(wildcardSubs)];

    await Promise.all(
      allSubs.map((sub) =>
        Promise.resolve(sub(envelope)).catch((err: unknown) => {
          console.error(`[RuntimeEventBus] Error in subscriber for ${String(type)}:`, err);
        })
      )
    );

    return envelope;
  }

  /**
   * Clear all active subscribers.
   */
  public clear(): void {
    this.subscribers.clear();
  }
}
