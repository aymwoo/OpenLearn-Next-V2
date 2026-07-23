/**
 * OpenLearn Classroom Runtime - Scheduler Subsystem
 * Priority task queue driving high-priority classroom events, delays, retries, and future tasks.
 */

import { TaskPriority, ScheduledTask } from './types.js';

export class RuntimeScheduler {
  private taskQueue: ScheduledTask[] = [];
  private isProcessing = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  /**
   * Schedule a task into the priority queue.
   */
  public schedule<T = unknown>(
    name: string,
    taskFn: () => Promise<T>,
    priority: TaskPriority = TaskPriority.Normal,
    delayMs = 0,
    maxRetries = 3
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const task: ScheduledTask<T> = {
        id: `tsk_${globalThis.crypto.randomUUID()}`,
        name,
        priority,
        taskFn: async () => {
          if (delayMs > 0) {
            await new Promise((r) => setTimeout(r, delayMs));
          }
          try {
            const res = await taskFn();
            resolve(res);
            return res;
          } catch (err: unknown) {
            reject(err);
            throw err;
          }
        },
        delayMs,
        maxRetries,
        createdAt: Date.now(),
      };

      this.taskQueue.push(task as ScheduledTask);
      this.sortQueue();
      queueMicrotask(() => {
        this.processQueue();
      });
    });
  }


  /**
   * Start queue processor loop.
   */
  public start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.processQueue();
    }, 50);
  }

  /**
   * Stop queue processor loop.
   */
  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Get queue length.
   */
  public getPendingTaskCount(): number {
    return this.taskQueue.length;
  }

  private sortQueue(): void {
    this.taskQueue.sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt);
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.taskQueue.length === 0) return;
    this.isProcessing = true;

    const task = this.taskQueue.shift();
    if (task) {
      let retries = 0;
      const max = task.maxRetries ?? 1;
      while (retries < max) {
        try {
          await task.taskFn();
          break;
        } catch (err: unknown) {
          retries += 1;
          if (retries >= max) {
            console.error(`[RuntimeScheduler] Task ${task.name} (${task.id}) failed after ${retries} attempts:`, err);
          }
        }
      }
    }

    this.isProcessing = false;
  }
}
