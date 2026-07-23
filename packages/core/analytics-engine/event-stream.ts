/**
 * OpenLearn Learning Analytics Engine - Event Stream Subsystem
 * Event Stream pipeline supporting Publish, Subscribe, Replay, Filter, Windowing, and Aggregation.
 */

import { NormalizedAnalyticsEvent } from './types.js';

export type EventSubscriber = (event: NormalizedAnalyticsEvent) => void | Promise<void>;

export class EventStream {
  private events: NormalizedAnalyticsEvent[] = [];
  private subscribers = new Set<EventSubscriber>();

  public publish(event: NormalizedAnalyticsEvent): void {
    this.events.push(event);
    this.notifySubscribers(event);
  }

  public subscribe(subscriber: EventSubscriber): () => void {
    this.subscribers.add(subscriber);
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  public replay(windowMs?: number): ReadonlyArray<NormalizedAnalyticsEvent> {
    if (!windowMs) return Object.freeze([...this.events]);

    const cutoff = Date.now() - windowMs;
    return Object.freeze(this.events.filter((e) => e.timestamp >= cutoff));
  }

  public filter(predicate: (e: NormalizedAnalyticsEvent) => boolean): ReadonlyArray<NormalizedAnalyticsEvent> {
    return Object.freeze(this.events.filter(predicate));
  }

  public window(windowMs: number): ReadonlyArray<NormalizedAnalyticsEvent> {
    return this.replay(windowMs);
  }

  public aggregate<R>(fn: (events: ReadonlyArray<NormalizedAnalyticsEvent>) => R): R {
    return fn(Object.freeze([...this.events]));
  }

  public clear(): void {
    this.events = [];
  }

  private notifySubscribers(event: NormalizedAnalyticsEvent): void {
    for (const sub of this.subscribers) {
      try {
        sub(event);
      } catch (err: unknown) {
        console.error('[EventStream] Subscriber error:', err);
      }
    }
  }
}
