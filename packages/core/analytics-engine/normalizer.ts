/**
 * OpenLearn Learning Analytics Engine - Event Normalizer
 * Normalizes raw event payloads into standardized NormalizedAnalyticsEvent envelopes.
 */

import { NormalizedAnalyticsEvent, EventActor, EventTarget } from './types.js';

export interface RawEventInput<T = Record<string, unknown>> {
  readonly eventType: string;
  readonly actor: EventActor;
  readonly target?: EventTarget;
  readonly lessonId?: string;
  readonly stageId?: string;
  readonly activityId?: string;
  readonly metadata?: T;
  readonly timestamp?: number;
}

export class EventNormalizer {
  public normalize<T = Record<string, unknown>>(input: RawEventInput<T>): NormalizedAnalyticsEvent<T> {
    return Object.freeze({
      eventId: `evt_${globalThis.crypto.randomUUID()}`,
      eventType: input.eventType,
      timestamp: input.timestamp || Date.now(),
      actor: input.actor,
      target: input.target,
      lessonId: input.lessonId,
      stageId: input.stageId,
      activityId: input.activityId,
      metadata: input.metadata || ({} as T),
    });
  }
}
