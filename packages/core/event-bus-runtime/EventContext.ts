/**
 * EventContext — the object handed to every event handler (PI-010).
 *
 * It carries the platform event fields required by the spec (eventId,
 * timestamp, source, payload, metadata, correlationId) plus dispatch controls:
 * `cancel()` lets a handler abort the remaining dispatch (and is reflected by
 * `isCancelled`), and `timeoutMs` records the per-handler budget enforced by
 * the dispatcher.
 */

import type { PlatformEvent } from './types.js';

export class EventContext<T = unknown> {
  public readonly eventId: string;
  public readonly type: string;
  public readonly source: string;
  public readonly timestamp: number;
  public readonly payload: T;
  public readonly metadata: Readonly<Record<string, unknown>>;
  public readonly correlationId?: string;
  public timeoutMs?: number;

  private _cancelled = false;

  public constructor(event: PlatformEvent<T>) {
    this.eventId = event.eventId;
    this.type = event.type;
    this.source = event.source;
    this.timestamp = event.timestamp;
    this.payload = event.payload;
    this.metadata = event.metadata;
    this.correlationId = event.correlationId;
  }

  public cancel(): void {
    this._cancelled = true;
  }

  public get isCancelled(): boolean {
    return this._cancelled;
  }
}
