export interface PlatformEvent<T = unknown> {
  readonly id: string;
  readonly type: string;
  readonly source: string;
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
  handlerTimeoutMs?: number;
  maxSameTypeDepth?: number;
  onSubscriberError?: (info: SubscriberFailure) => void;
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
  skipped?: 'recursion-limit';
}

export declare class EventBus {
  constructor(options?: EventBusOptions);
  subscribe(eventType: string, subscriber: EventSubscriber): void;
  unsubscribe(eventType: string, subscriber: EventSubscriber): void;
  subscriberCount(eventType: string): number;
  publish(event: PlatformEvent): Promise<void>;
  publishDetailed(event: PlatformEvent): Promise<DispatchResult>;
}
