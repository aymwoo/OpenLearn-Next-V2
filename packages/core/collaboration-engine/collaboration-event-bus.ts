/**
 * OpenLearn Teaching Collaboration Engine - Event Bus Subsystem
 * Decoupled event pipeline for all collaboration notifications and state transitions.
 */

import {
  CollaborationEventType,
  CollaborationEventMap,
  CollaborationEventEnvelope,
  CollaborationEventSubscriber,
} from './types.js';

export class CollaborationEventBus {
  private subscribers = new Map<string, Set<CollaborationEventSubscriber<any>>>();

  public subscribe<K extends CollaborationEventType>(
    eventType: K | '*',
    subscriber: CollaborationEventSubscriber<K>
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

  public async publish<K extends CollaborationEventType>(
    type: K,
    payload: CollaborationEventMap[K],
    source = 'collaboration.engine'
  ): Promise<CollaborationEventEnvelope<K>> {
    const envelope: CollaborationEventEnvelope<K> = {
      id: `cevt_${globalThis.crypto.randomUUID()}`,
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
          console.error(`[CollaborationEventBus] Error in subscriber for ${String(type)}:`, err);
        })
      )
    );

    return envelope;
  }

  public clear(): void {
    this.subscribers.clear();
  }
}
