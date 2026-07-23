/**
 * OpenLearn Learning Analytics Engine - Central Analytics Collector
 * Central collector gathering telemetry across Lesson, Stage, Whiteboard, Code, Quiz, Plugin, AI, Presence, and Collaboration.
 */

import { EventNormalizer, RawEventInput } from './normalizer.js';
import { AnalyticsPrivacyStorage } from './privacy-storage.js';
import { EventStream } from './event-stream.js';
import { NormalizedAnalyticsEvent } from './types.js';

export class AnalyticsCollector {
  private normalizer: EventNormalizer;
  private privacyStorage: AnalyticsPrivacyStorage;
  private eventStream: EventStream;

  constructor(
    normalizer: EventNormalizer,
    privacyStorage: AnalyticsPrivacyStorage,
    eventStream: EventStream
  ) {
    this.normalizer = normalizer;
    this.privacyStorage = privacyStorage;
    this.eventStream = eventStream;
  }

  public collect<T = Record<string, unknown>>(input: RawEventInput<T>): NormalizedAnalyticsEvent<T> {
    const raw = this.normalizer.normalize(input);
    const sanitized = this.privacyStorage.sanitizeEvent(raw) as NormalizedAnalyticsEvent<T>;
    this.eventStream.publish(sanitized);
    return sanitized;
  }
}
