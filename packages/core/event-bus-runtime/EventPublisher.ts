/**
 * EventPublisher — the public publish surface of the Platform Event Bus (PI-010).
 *
 * Wraps the {@link EventDispatcher}, turning a {@link PlatformEvent} into a
 * dispatch and emitting structured diagnostics via the reused
 * `IPlatformLogger`. Three entry points:
 *  - `publish` / `publishAsync` — full async dispatch (awaits handlers).
 *  - `publishSync` — synchronous dispatch; async handlers are started but not
 *    awaited (returns immediately).
 */

import { EventContext } from './EventContext.js';
import { EventDispatcher } from './EventDispatcher.js';
import type { IPlatformLogger } from '../bootstrap/types/index.js';
import type { EventResult, PlatformEvent } from './types.js';

export class EventPublisher {
  private readonly dispatcher: EventDispatcher;
  private readonly logger: IPlatformLogger;

  public constructor(dispatcher: EventDispatcher, logger: IPlatformLogger) {
    this.dispatcher = dispatcher;
    this.logger = logger;
  }

  public async publish(event: PlatformEvent): Promise<EventResult> {
    const context = new EventContext(event);
    this.logger.info(`[PlatformEventBus] publish '${event.type}' (${event.eventId})`);
    const result = await this.dispatcher.dispatch(event);
    this.logDiagnostics(result);
    return result;
  }

  public publishAsync(event: PlatformEvent): Promise<EventResult> {
    return this.publish(event);
  }

  public publishSync(event: PlatformEvent): EventResult {
    const context = new EventContext(event);
    this.logger.info(`[PlatformEventBus] publishSync '${event.type}' (${event.eventId})`);
    const result = this.dispatcher.dispatchSync(event);
    this.logDiagnostics(result);
    return result;
  }

  private logDiagnostics(result: EventResult): void {
    if (result.failed > 0) {
      this.logger.warn(
        `[PlatformEventBus] '${result.type}' dispatched=${result.dispatched} ` +
          `succeeded=${result.succeeded} failed=${result.failed} cancelled=${result.cancelled}`,
      );
    } else {
      this.logger.info(
        `[PlatformEventBus] '${result.type}' ok (${result.succeeded}/${result.dispatched})`,
      );
    }
  }
}
