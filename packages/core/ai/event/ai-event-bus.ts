/**
 * OpenLearn AI Infrastructure - AI Event Bus Subsystem
 * Typed event pipeline for AI telemetry, model calls, tool executions, and prompt builds.
 */

import {
  AIEventType,
  AIEventMap,
  AIEventEnvelope,
  AIEventSubscriber,
} from '../types/index.js';

export class AIEventBus {
  private subscribers = new Map<string, Set<AIEventSubscriber<any>>>();

  public subscribe<K extends AIEventType>(
    eventType: K | '*',
    subscriber: AIEventSubscriber<K>
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

  public async publish<K extends AIEventType>(
    type: K,
    payload: AIEventMap[K]
  ): Promise<AIEventEnvelope<K>> {
    const envelope: AIEventEnvelope<K> = {
      id: `aievt_${globalThis.crypto.randomUUID()}`,
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
          console.error(`[AIEventBus] Error in subscriber for ${String(type)}:`, err);
        })
      )
    );

    return envelope;
  }

  public clear(): void {
    this.subscribers.clear();
  }
}
