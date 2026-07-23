/**
 * OpenLearn Presence Engine - Presence Timeline Subsystem
 * Records presence state history over time for Replay, Analytics, and AI inspection.
 */

import { PresenceTimelineFrame } from './types.js';

export class PresenceTimelineLogger {
  private frames: PresenceTimelineFrame[] = [];

  /**
   * Append a frame to the timeline log.
   */
  public logChange(
    entityId: string,
    previousStatus: string,
    currentStatus: string,
    activity: string
  ): void {
    this.frames.push({
      timestamp: Date.now(),
      entityId,
      previousStatus,
      currentStatus,
      activity,
    });
  }

  /**
   * Query recorded timeline frames, optionally filtered by entityId.
   */
  public getTimeline(entityId?: string): ReadonlyArray<PresenceTimelineFrame> {
    if (entityId) {
      return Object.freeze(this.frames.filter((f) => f.entityId === entityId));
    }
    return Object.freeze([...this.frames]);
  }

  /**
   * Clear recorded timeline log.
   */
  public clear(): void {
    this.frames = [];
  }
}
