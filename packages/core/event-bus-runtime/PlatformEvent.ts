/**
 * PlatformEvent — the concrete, immutable platform event object (PI-010).
 *
 * Wraps {@link PlatformEventInit}, filling in `eventId` and `timestamp` when
 * absent. Handlers never receive this directly; they receive an
 * {@link EventContext} which exposes the same fields plus dispatch controls.
 */

import type { PlatformEvent, PlatformEventInit } from './types.js';

export class PlatformEventObject<T = unknown> implements PlatformEvent<T> {
  public readonly eventId: string;
  public readonly type: string;
  public readonly source: string;
  public readonly payload: T;
  public readonly timestamp: number;
  public readonly metadata: Readonly<Record<string, unknown>>;
  public readonly correlationId?: string;

  public constructor(init: PlatformEventInit<T>) {
    if (!init || init.type.trim() === '') {
      throw new Error('[PlatformEventBus] Event requires a non-empty type.');
    }
    this.eventId = init.eventId ?? `evt_${globalThis.crypto.randomUUID()}`;
    this.type = init.type;
    this.source = init.source;
    this.payload = init.payload;
    this.timestamp = init.timestamp ?? Date.now();
    this.metadata = Object.freeze({ ...(init.metadata ?? {}) });
    this.correlationId = init.correlationId;
  }
}
