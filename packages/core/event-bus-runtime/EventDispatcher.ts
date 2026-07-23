/**
 * EventDispatcher — executes handlers for a single event (PI-010).
 *
 * Responsibilities:
 *  - **Priority dispatch**: handlers sorted by `priority` desc, then `order` asc.
 *  - **Ordered dispatch**: stable tie-breaking via `order`.
 *  - **Error isolation**: each handler result is captured individually; a throw
 *    never propagates out of the dispatch loop.
 *  - **Cancellation**: a handler calling `context.cancel()` stops subsequent
 *    handlers (they are recorded as `cancelled`).
 *  - **Timeout**: enforced per-handler in the async path (see `EventHandler`).
 *  - **`once`**: a consumed `once` handler is removed from the registry.
 */

import { EventContext } from './EventContext.js';
import { EventRegistry } from './EventRegistry.js';
import type { EventResult, HandlerResult, PlatformEvent } from './types.js';

export class EventDispatcher {
  private readonly registry: EventRegistry;

  public constructor(registry: EventRegistry) {
    this.registry = registry;
  }

  public async dispatch(event: PlatformEvent): Promise<EventResult> {
    const context = new EventContext(event);
    const handlers = this.orderedHandlers(context.type);

    const results: HandlerResult[] = [];
    let succeeded = 0;
    let failed = 0;
    const start = Date.now();

    for (const handler of handlers) {
      if (context.isCancelled) {
        results.push({
          handlerId: handler.id,
          eventType: context.type,
          durationMs: 0,
          status: 'cancelled',
        });
        continue;
      }
      if (handler.isConsumed) {
        this.registry.unsubscribe(handler.id);
        continue;
      }
      if (!handler.passesFilter(context)) {
        results.push({
          handlerId: handler.id,
          eventType: context.type,
          durationMs: 0,
          status: 'skipped',
        });
        continue;
      }
      const result = await handler.invoke(context);
      results.push(result);
      if (result.status === 'success') succeeded++;
      else failed++;
      if (handler.isConsumed) this.registry.unsubscribe(handler.id);
    }

    return this.buildResult(context, handlers.length, succeeded, failed, results, start);
  }

  /** Synchronous dispatch; async handlers are started but not awaited. */
  public dispatchSync(event: PlatformEvent): EventResult {
    const context = new EventContext(event);
    const handlers = this.orderedHandlers(context.type);

    const results: HandlerResult[] = [];
    let succeeded = 0;
    let failed = 0;
    const start = Date.now();

    for (const handler of handlers) {
      if (context.isCancelled) {
        results.push({
          handlerId: handler.id,
          eventType: context.type,
          durationMs: 0,
          status: 'cancelled',
        });
        continue;
      }
      if (handler.isConsumed) {
        this.registry.unsubscribe(handler.id);
        continue;
      }
      if (!handler.passesFilter(context)) {
        results.push({
          handlerId: handler.id,
          eventType: context.type,
          durationMs: 0,
          status: 'skipped',
        });
        continue;
      }
      const result = handler.invokeSync(context);
      results.push(result);
      if (result.status === 'success') succeeded++;
      else failed++;
      if (handler.isConsumed) this.registry.unsubscribe(handler.id);
    }

    return this.buildResult(context, handlers.length, succeeded, failed, results, start);
  }

  private orderedHandlers(type: string): ReadonlyArray<import('./EventHandler.js').EventHandler> {
    return [...this.registry.getHandlers(type)]
      .filter((h) => h.matches(type))
      .sort((a, b) => b.priority - a.priority || a.order - b.order);
  }

  private buildResult(
    context: EventContext,
    dispatched: number,
    succeeded: number,
    failed: number,
    results: HandlerResult[],
    start: number,
  ): EventResult {
    return {
      eventId: context.eventId,
      type: context.type,
      correlationId: context.correlationId,
      dispatched,
      succeeded,
      failed,
      cancelled: context.isCancelled,
      durationMs: Date.now() - start,
      results: Object.freeze(results),
    };
  }
}
