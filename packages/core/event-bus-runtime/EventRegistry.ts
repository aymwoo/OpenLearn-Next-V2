/**
 * EventRegistry — handler storage & lookup (PI-010).
 *
 * Source of truth for subscriptions. Handlers are indexed both by handler id
 * (for `unsubscribe`) and by event type (including the `'*'` wildcard). The
 * registry never throws when unsubscribing an unknown id.
 */

import { EventHandler } from './EventHandler.js';
import { EventSubscriber } from './EventSubscriber.js';
import type { EventHandlerFn, EventHandlerOptions } from './types.js';

export class EventRegistry {
  private readonly byType = new Map<string, Set<EventHandler>>();
  private readonly handlers = new Map<string, EventHandler>();

  public subscribe(
    eventType: string,
    fn: EventHandlerFn,
    options?: EventHandlerOptions,
  ): EventSubscriber {
    const handler = new EventHandler(eventType, fn, options);
    this.handlers.set(handler.id, handler);
    let set = this.byType.get(eventType);
    if (!set) {
      set = new Set();
      this.byType.set(eventType, set);
    }
    set.add(handler);
    return new EventSubscriber({
      id: handler.id,
      eventType,
      unsubscribe: () => this.unsubscribe(handler.id),
    });
  }

  public subscribeOnce(
    eventType: string,
    fn: EventHandlerFn,
    options?: EventHandlerOptions,
  ): EventSubscriber {
    return this.subscribe(eventType, fn, { ...options, once: true });
  }

  public unsubscribe(handlerId: string): boolean {
    const handler = this.handlers.get(handlerId);
    if (!handler) return false;
    this.handlers.delete(handlerId);
    this.byType.get(handler.eventType)?.delete(handler);
    return true;
  }

  public clear(): void {
    this.byType.clear();
    this.handlers.clear();
  }

  /** All handlers (specific + wildcard) that could match the given type. */
  public getHandlers(type: string): ReadonlyArray<EventHandler> {
    const specific = [...(this.byType.get(type) ?? [])];
    const wildcard = [...(this.byType.get('*') ?? [])];
    return Object.freeze([...specific, ...wildcard]);
  }

  public get size(): number {
    return this.handlers.size;
  }
}
