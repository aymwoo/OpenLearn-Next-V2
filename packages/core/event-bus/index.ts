import { AsyncLocalStorage } from 'node:async_hooks';

export interface PlatformEvent<T = unknown> {
  readonly id: string;
  readonly type: string; // Past tense, e.g., "lesson.created"
  readonly source: string; // Source plugin/module
  readonly payload: T;
  readonly timestamp: number;
  readonly correlationId?: string;
}

export type EventSubscriber = (event: PlatformEvent) => void | Promise<void>;

/**
 * Structural port for an event bus. Both the core {@link EventBus} and the
 * frontend `FrontendEventBus` satisfy this shape, so runtime constructors can
 * accept either without a type cast at the frontend/core boundary.
 */
export interface EventBusPort {
  publish(event: PlatformEvent): Promise<void>;
  subscribe(eventType: string, handler: EventSubscriber): void;
}

export interface EventBusOptions {
  /**
   * Wall-clock budget for a single subscriber. A subscriber that exceeds it is
   * reported as failed and the dispatch continues, so one slow listener can
   * never stall the whole chain.
   */
  handlerTimeoutMs?: number;
  /**
   * How many times the *same* event type may re-enter the bus within one
   * causal chain before the nested publish is dropped. This is the guard
   * against publish-loops (a subscriber that re-publishes its own event type).
   */
  maxSameTypeDepth?: number;
  /** Called for every subscriber failure. Defaults to `console.error`. */
  onSubscriberError?: (info: SubscriberFailure) => void;
  /** Called when a nested publish is dropped by the recursion guard. */
  onRecursionDropped?: (info: RecursionDrop) => void;
}

export interface SubscriberFailure {
  event: PlatformEvent;
  error: unknown;
}

export interface RecursionDrop {
  event: PlatformEvent;
  depth: number;
}

export interface SubscriberOutcome {
  ok: boolean;
  timedOut: boolean;
  durationMs: number;
  error?: string;
}

export interface DispatchResult {
  eventId: string;
  eventType: string;
  subscriberCount: number;
  outcomes: SubscriberOutcome[];
  /** Set when the publish was dropped instead of dispatched. */
  skipped?: 'recursion-limit';
}

const DEFAULT_HANDLER_TIMEOUT_MS = 2000;
const DEFAULT_MAX_SAME_TYPE_DEPTH = 3;

type DispatchChain = ReadonlyMap<string, number>;

/**
 * Propagates the "how many times has each event type been published on this
 * causal chain" bookkeeping across `await` boundaries. AsyncLocalStorage is
 * used (rather than an instance counter) so that *concurrent* publishes of the
 * same type are never mistaken for *recursive* ones — two students submitting
 * at the same time must not trip the recursion guard.
 */
const dispatchChain = new AsyncLocalStorage<DispatchChain>();

function randomEventId(): string {
  const c: Crypto | undefined = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

export class EventBus {
  private readonly subscribers = new Map<string, Set<EventSubscriber>>();
  private readonly options: Required<EventBusOptions>;

  constructor(options: EventBusOptions = {}) {
    this.options = {
      handlerTimeoutMs: options.handlerTimeoutMs ?? DEFAULT_HANDLER_TIMEOUT_MS,
      maxSameTypeDepth: options.maxSameTypeDepth ?? DEFAULT_MAX_SAME_TYPE_DEPTH,
      onSubscriberError:
        options.onSubscriberError ??
        ((info) =>
          console.error(`Error in event subscriber for ${info.event.type} (${info.event.id}):`, info.error)),
      onRecursionDropped:
        options.onRecursionDropped ??
        ((info) =>
          console.warn(
            `[EventBus] Dropped re-entrant publish of "${info.event.type}" at depth ${info.depth} ` +
              `(id=${info.event.id}). Check for a subscriber that re-publishes its own event type.`,
          )),
    };
  }

  public subscribe(eventType: string, subscriber: EventSubscriber): void {
    if (!this.subscribers.has(eventType)) {
      this.subscribers.set(eventType, new Set());
    }
    this.subscribers.get(eventType)!.add(subscriber);
  }

  /**
   * Removes a subscriber.
   *
   * NOTE: returns `void` (not a boolean) on purpose — `IEventBusService`
   * declares this signature and several server routes pass the kernel
   * {@link EventBus} straight into that port. Use
   * {@link EventBus.subscriberCount} to assert on removal instead.
   */
  public unsubscribe(eventType: string, subscriber: EventSubscriber): void {
    const set = this.subscribers.get(eventType);
    if (!set) return;
    set.delete(subscriber);
    if (set.size === 0) this.subscribers.delete(eventType);
  }

  /** Number of subscribers for a type, excluding the `'*'` wildcard. */
  public subscriberCount(eventType: string): number {
    return this.subscribers.get(eventType)?.size ?? 0;
  }

  public async publish(event: PlatformEvent): Promise<void> {
    await this.publishDetailed(event);
  }

  /**
   * Publishes an event and reports what happened to every subscriber.
   *
   * Guarantees added on top of the original `Promise.all` implementation:
   * - **Bounded**: every subscriber gets its own wall-clock budget
   *   ({@link EventBusOptions.handlerTimeoutMs}), so a hanging listener can
   *   never stall the publish forever.
   * - **Isolation**: a throwing or timing-out subscriber is recorded in the
   *   result and skipped; it never rejects the publish nor prevents the
   *   remaining subscribers from being collected.
   * - **No double dispatch**: a handler registered on both the concrete type
   *   and `'*'` runs once, not twice.
   * - **Loop-safe**: re-entrant publishes of the same type on one causal chain
   *   are dropped once {@link EventBusOptions.maxSameTypeDepth} is reached.
   * - **Ordered collection**: outcomes follow registration order, so logs and
   *   assertions are deterministic.
   *
   * Deliberately unchanged: subscribers are still *started* synchronously and
   * concurrently (see the note in the body) — narrowing that would change the
   * observable timing for existing callers.
   */
  public async publishDetailed(event: PlatformEvent): Promise<DispatchResult> {
    const fullEvent: PlatformEvent = {
      ...event,
      id: event.id || randomEventId(),
      timestamp: event.timestamp || Date.now(),
    };

    const chain = dispatchChain.getStore() ?? new Map<string, number>();
    const depth = chain.get(fullEvent.type) ?? 0;

    if (depth >= this.options.maxSameTypeDepth) {
      this.options.onRecursionDropped({ event: fullEvent, depth });
      return {
        eventId: fullEvent.id,
        eventType: fullEvent.type,
        subscriberCount: 0,
        outcomes: [],
        skipped: 'recursion-limit',
      };
    }

    const nextChain: DispatchChain = new Map(chain).set(fullEvent.type, depth + 1);

    const subs = this.subscribers.get(fullEvent.type) ?? new Set<EventSubscriber>();
    const wildcards = this.subscribers.get('*') ?? new Set<EventSubscriber>();
    // Deduplicate: a handler registered on both the concrete type and '*'
    // must still run only once per publish.
    const allSubs = [...new Set([...subs, ...wildcards])];

    return dispatchChain.run(nextChain, async () => {
      // 同步启动全部订阅者，再按注册顺序收集结果。
      //
      // 为什么不是「await 完一个再启动下一个」：那样只有第一个订阅者会在
      // `publish()` 返回前执行，会破坏既有语义 —— worker-runtime 的多路转发
      // 等调用方依赖「同步订阅者在 publish 返回时已全部执行」。
      // 因此这里保持与旧 `Promise.all` 一致的启动时机，只把**收敛**改成按序：
      // 结果顺序确定，而慢订阅者之间仍然并行，不会互相拖累。
      const pending = allSubs.map((sub) => this.invoke(sub, fullEvent));

      const outcomes: SubscriberOutcome[] = [];
      for (const pendingOutcome of pending) {
        outcomes.push(await pendingOutcome);
      }

      return {
        eventId: fullEvent.id,
        eventType: fullEvent.type,
        subscriberCount: allSubs.length,
        outcomes,
      };
    });
  }

  private async invoke(subscriber: EventSubscriber, event: PlatformEvent): Promise<SubscriberOutcome> {
    const startedAt = Date.now();
    let timer: NodeJS.Timeout | undefined;

    try {
      await Promise.race([
        Promise.resolve(subscriber(event)),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error(`subscriber timed out after ${this.options.handlerTimeoutMs}ms`)),
            this.options.handlerTimeoutMs,
          );
          // Never keep the process alive just for a watchdog.
          timer.unref?.();
        }),
      ]);
      return { ok: true, timedOut: false, durationMs: Date.now() - startedAt };
    } catch (error) {
      // NOTE: on timeout the subscriber keeps running in the background; the
      // bus can stop *waiting* for it but cannot cancel it. Authors of slow
      // subscribers must still guard against overlapping executions.
      this.options.onSubscriberError({ event, error });
      return {
        ok: false,
        timedOut: error instanceof Error && error.message.includes('timed out'),
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
