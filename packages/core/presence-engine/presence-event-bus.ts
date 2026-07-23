/**
 * OpenLearn Presence Engine - Presence Event Bus Subsystem
 * Decoupled event pipeline for Presence status changes, signals, and alerts.
 */

import {
  PresenceEventType,
  PresenceEventMap,
  PresenceEventEnvelope,
  PresenceEventSubscriber,
} from './types.js';

export class PresenceEventBus {
  private subscribers = new Map<string, Set<PresenceEventSubscriber<any>>>();

  /**
   * Subscribe to a presence event channel or wildcard `*`.
   */
  public subscribe<K extends PresenceEventType>(
    eventType: K | '*',
    subscriber: PresenceEventSubscriber<K>
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
  public async publish<K extends PresenceEventType>(
    type: K,
    payload: PresenceEventMap[K],
    source = 'presence.engine'
  ): Promise<PresenceEventEnvelope<K>> {
    const envelope: PresenceEventEnvelope<K> = {
      id: `pevt_${globalThis.crypto.randomUUID()}`,
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
          console.error(`[PresenceEventBus] Error in subscriber for ${String(type)}:`, err);
        })
      )
    );

    return envelope;
  }

  /**
   * Clear all subscribers.
   */
  public clear(): void {
    this.subscribers.clear();
  }
}
