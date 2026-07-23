/**
 * EventHandler — a registered handler wrapper (PI-010).
 *
 * Encapsulates the user-supplied handler function together with its routing
 * and execution options. `invoke` runs the handler with full error isolation
 * and optional timeout, always returning a {@link HandlerResult} so a single
 * failing handler can never terminate the platform.
 */

import { EventContext } from './EventContext.js';
import { EventError } from './EventError.js';
import type {
  EventFilter,
  EventHandlerFn,
  EventHandlerMode,
  EventHandlerOptions,
  HandlerResult,
} from './types.js';

function withTimeout(promise: Promise<void>, ms: number, eventId: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new EventError(`Handler timed out after ${ms}ms`, 'HANDLER_TIMEOUT', undefined, eventId));
    }, ms);
    promise.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export class EventHandler {
  public readonly id: string;
  public readonly eventType: string;
  public readonly priority: number;
  public readonly order: number;
  public readonly mode: EventHandlerMode;
  public readonly once: boolean;
  public readonly timeoutMs?: number;
  public readonly filter?: EventFilter;
  public readonly metadata: Readonly<Record<string, unknown>>;

  private readonly fn: EventHandlerFn;
  private consumed = false;

  public constructor(eventType: string, fn: EventHandlerFn, options?: EventHandlerOptions) {
    if (typeof fn !== 'function') {
      throw new EventError('Event handler must be a function.', 'INVALID_HANDLER', eventType);
    }
    this.id = options?.id ?? `h_${globalThis.crypto.randomUUID()}`;
    this.eventType = eventType;
    this.fn = fn;
    this.priority = options?.priority ?? 0;
    this.order = options?.order ?? 0;
    this.mode = options?.mode ?? 'async';
    this.once = options?.once ?? false;
    this.timeoutMs = options?.timeoutMs;
    this.filter = options?.filter;
    this.metadata = Object.freeze({ ...(options?.metadata ?? {}) });
  }

  public matches(type: string): boolean {
    return this.eventType === '*' || this.eventType === type;
  }

  public passesFilter(context: EventContext): boolean {
    return !this.filter || this.filter(context);
  }

  public get isConsumed(): boolean {
    return this.once && this.consumed;
  }

  public async invoke(context: EventContext): Promise<HandlerResult> {
    const start = Date.now();
    const record = (status: HandlerResult['status'], error?: string): HandlerResult => ({
      handlerId: this.id,
      eventType: context.type,
      durationMs: Date.now() - start,
      status,
      error,
    });

    if (this.once) this.consumed = true;

    try {
      let run: Promise<void>;
      if (this.mode === 'sync') {
        // Invoke synchronously; do not await any returned promise.
        this.fn(context);
        run = Promise.resolve();
      } else {
        run = Promise.resolve(this.fn(context));
      }
      if (this.timeoutMs && this.timeoutMs > 0) {
        run = withTimeout(run, this.timeoutMs, context.eventId);
      }
      await run;
      return record('success');
    } catch (err: unknown) {
      const e = err instanceof Error ? err : new Error(String(err));
      if (e instanceof EventError && e.code === 'HANDLER_TIMEOUT') {
        return record('timeout', e.message);
      }
      return record('error', e.message);
    }
  }

  /**
   * Synchronous invocation used by `publishSync`. Sync-mode handlers run
   * inline; async-mode handlers are started (and their eventual errors are
   * swallowed/logged) but not awaited. Timeouts are not enforced synchronously.
   */
  public invokeSync(context: EventContext): HandlerResult {
    const start = Date.now();
    const record = (status: HandlerResult['status'], error?: string): HandlerResult => ({
      handlerId: this.id,
      eventType: context.type,
      durationMs: Date.now() - start,
      status,
      error,
    });

    if (this.once) this.consumed = true;

    try {
      if (this.mode === 'sync') {
        this.fn(context);
      } else {
        Promise.resolve(this.fn(context)).catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`[PlatformEventBus] Unhandled async error in '${context.type}':`, message);
        });
      }
      return record('success');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return record('error', message);
    }
  }
}
