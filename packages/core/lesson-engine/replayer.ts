/**
 * OpenLearn Lesson Flow Engine - Lesson Replayer
 * Supports recording timeline snapshots/events during lesson execution and replaying them accurately.
 */

import { LessonSnapshot, Lesson } from './types.js';
import { PlatformEvent } from '../event-bus/index.js';

export interface ReplayFrame {
  timestamp: number;
  relativeTimeMs: number;
  event?: PlatformEvent;
  snapshot?: LessonSnapshot;
}

export type ReplayFrameHandler = (frame: ReplayFrame) => void;

export class LessonReplayer {
  private frames: ReplayFrame[] = [];
  private isReplaying = false;
  private isPaused = false;
  private currentFrameIndex = 0;
  private startTime = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private frameHandler?: ReplayFrameHandler;

  /**
   * Record a event into the replay timeline.
   */
  public recordEvent(event: PlatformEvent, startTime: number): void {
    const relativeTimeMs = Math.max(0, event.timestamp - startTime);
    this.frames.push({
      timestamp: event.timestamp,
      relativeTimeMs,
      event,
    });
    this.sortFrames();
  }

  /**
   * Record a state snapshot into the replay timeline.
   */
  public recordSnapshot(snapshot: LessonSnapshot, startTime: number): void {
    const relativeTimeMs = Math.max(0, snapshot.timestamp - startTime);
    this.frames.push({
      timestamp: snapshot.timestamp,
      relativeTimeMs,
      snapshot,
    });
    this.sortFrames();
  }

  /**
   * Load pre-recorded frames for replay.
   */
  public loadFrames(frames: ReplayFrame[]): void {
    this.frames = [...frames];
    this.sortFrames();
    this.currentFrameIndex = 0;
  }

  /**
   * Export all recorded frames.
   */
  public getFrames(): ReplayFrame[] {
    return [...this.frames];
  }

  /**
   * Start replaying from the beginning or current frame index.
   */
  public startReplay(onFrame: ReplayFrameHandler, speedMultiplier = 1.0): void {
    if (this.frames.length === 0) return;

    this.frameHandler = onFrame;
    this.isReplaying = true;
    this.isPaused = false;
    this.startTime = Date.now();

    const intervalMs = Math.max(50, Math.floor(100 / speedMultiplier));

    this.stopTimer();
    this.timer = setInterval(() => {
      if (this.isPaused) return;

      if (this.currentFrameIndex >= this.frames.length) {
        this.stopReplay();
        return;
      }

      const frame = this.frames[this.currentFrameIndex];
      if (this.frameHandler) {
        this.frameHandler(frame);
      }
      this.currentFrameIndex += 1;
    }, intervalMs);
  }

  public pauseReplay(): void {
    this.isPaused = true;
  }

  public resumeReplay(): void {
    this.isPaused = false;
  }

  public seek(frameIndex: number): ReplayFrame | null {
    if (frameIndex < 0 || frameIndex >= this.frames.length) return null;
    this.currentFrameIndex = frameIndex;
    const frame = this.frames[this.currentFrameIndex];
    if (this.frameHandler) {
      this.frameHandler(frame);
    }
    return frame;
  }

  public stopReplay(): void {
    this.stopTimer();
    this.isReplaying = false;
    this.isPaused = false;
    this.currentFrameIndex = 0;
  }

  public isReplayingActive(): boolean {
    return this.isReplaying;
  }

  private stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private sortFrames(): void {
    this.frames.sort((a, b) => a.relativeTimeMs - b.relativeTimeMs);
  }
}
