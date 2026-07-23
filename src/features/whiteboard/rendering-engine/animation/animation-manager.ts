export interface AnimationTask {
  id: string;
  durationMs: number;
  startTime: number;
  onUpdate: (progress: number) => void;
  onComplete?: () => void;
}

export class AnimationManager {
  private tasks = new Map<string, AnimationTask>();
  private isLoopRunning = false;

  public animate(id: string, durationMs: number, onUpdate: (progress: number) => void, onComplete?: () => void): void {
    this.tasks.set(id, {
      id,
      durationMs,
      startTime: performance.now(),
      onUpdate,
      onComplete,
    });

    if (!this.isLoopRunning) {
      this.isLoopRunning = true;
      requestAnimationFrame(() => this.loop());
    }
  }

  public cancelAnimation(id: string): void {
    this.tasks.delete(id);
  }

  private loop(): void {
    if (this.tasks.size === 0) {
      this.isLoopRunning = false;
      return;
    }

    const now = performance.now();
    this.tasks.forEach((task, id) => {
      const elapsed = now - task.startTime;
      const rawProgress = Math.min(1, elapsed / task.durationMs);

      // EaseInOutQuad easing
      const easedProgress = rawProgress < 0.5 ? 2 * rawProgress * rawProgress : 1 - Math.pow(-2 * rawProgress + 2, 2) / 2;

      task.onUpdate(easedProgress);

      if (rawProgress >= 1) {
        if (task.onComplete) task.onComplete();
        this.tasks.delete(id);
      }
    });

    if (this.tasks.size > 0) {
      requestAnimationFrame(() => this.loop());
    } else {
      this.isLoopRunning = false;
    }
  }
}

export const animationManager = new AnimationManager();
