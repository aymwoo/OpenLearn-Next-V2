import type { RenderJob, RenderPriority } from '../types.js';

export class RenderScheduler {
  private queue: RenderJob[] = [];
  private isProcessing = false;
  private maxFrameTimeMs = 12; // Time slice per frame (12ms of 16ms for 60fps)

  public schedule(id: string, priority: RenderPriority, execute: () => void): void {
    // Remove duplicate job if queued
    this.queue = this.queue.filter((j) => j.id !== id);

    this.queue.push({
      id,
      priority,
      execute,
      timestamp: Date.now(),
    });

    if (priority === 'Immediate') {
      execute();
      this.queue = this.queue.filter((j) => j.id !== id);
      return;
    }

    this.requestFrame();
  }

  private requestFrame(): void {
    if (this.isProcessing || this.queue.length === 0) return;

    this.isProcessing = true;
    requestAnimationFrame(() => this.processQueue());
  }

  private processQueue(): void {
    const startTime = performance.now();

    // Sort queue by priority
    const priorityWeight: Record<RenderPriority, number> = {
      Immediate: 0,
      AnimationFrame: 1,
      Idle: 2,
      Background: 3,
    };

    this.queue.sort((a, b) => priorityWeight[a.priority] - priorityWeight[b.priority]);

    while (this.queue.length > 0) {
      const job = this.queue.shift();
      if (job) {
        try {
          job.execute();
        } catch (err) {
          console.error(`[RenderScheduler] Error processing job "${job.id}":`, err);
        }
      }

      // Check time slice limit to avoid dropping frames
      if (performance.now() - startTime >= this.maxFrameTimeMs) {
        break;
      }
    }

    this.isProcessing = false;
    if (this.queue.length > 0) {
      this.requestFrame();
    }
  }

  public clear(): void {
    this.queue = [];
  }
}

export const renderScheduler = new RenderScheduler();
