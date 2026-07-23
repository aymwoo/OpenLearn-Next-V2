/**
 * EventError — error hierarchy for the Platform Event Bus (PI-010).
 *
 * Mirrors the structured-error pattern used across the kernel
 * (`CapabilityError`, etc.): every failure carries a stable `code`, the
 * offending `eventType` (when known), and a `correlationId` for tracing a
 * single event's dispatch across handlers.
 */

export type EventErrorCode =
  | 'INVALID_EVENT'
  | 'INVALID_HANDLER'
  | 'HANDLER_FAILED'
  | 'HANDLER_TIMEOUT'
  | 'DISPATCH_CANCELLED'
  | 'BRIDGE_FAILED';

export class EventError extends Error {
  public readonly code: EventErrorCode;
  public readonly eventType?: string;
  public readonly correlationId?: string;

  public constructor(
    message: string,
    code: EventErrorCode,
    eventType?: string,
    correlationId?: string,
  ) {
    super(message);
    this.name = 'EventError';
    this.code = code;
    this.eventType = eventType;
    this.correlationId = correlationId;
  }
}
