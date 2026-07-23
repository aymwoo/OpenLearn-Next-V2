/**
 * OpenLearn AI Infrastructure - Streaming Service
 * Manages SSE & Stream chunk handlers and emits stream telemetry events.
 */

import { AIEventBus } from '../event/ai-event-bus.js';

export class StreamingService {
  private eventBus: AIEventBus;

  constructor(eventBus: AIEventBus) {
    this.eventBus = eventBus;
  }

  public createStreamSession(): { streamId: string; finish: (totalBytes: number) => void } {
    const streamId = `str_${globalThis.crypto.randomUUID()}`;
    this.eventBus.publish('StreamingStarted', { streamId });

    return {
      streamId,
      finish: (totalBytes: number) => {
        this.eventBus.publish('StreamingFinished', { streamId, totalBytes });
      },
    };
  }
}
