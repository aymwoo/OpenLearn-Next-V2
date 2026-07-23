import type { PerformanceStats } from '../types.js';

export class PerformanceMonitor {
  private frameTimes: number[] = [];
  private lastTime = performance.now();
  private stats: PerformanceStats = {
    fps: 60,
    renderTimeMs: 0,
    drawCount: 0,
    visibleCount: 0,
    totalCount: 0,
    memoryUsageMb: 0,
  };

  public recordFrame(renderTimeMs: number, drawCount: number, visibleCount: number, totalCount: number): void {
    const now = performance.now();
    const delta = now - this.lastTime;
    this.lastTime = now;

    if (delta > 0) {
      this.frameTimes.push(1000 / delta);
      if (this.frameTimes.length > 30) this.frameTimes.shift();
    }

    const avgFps = Math.round(this.frameTimes.reduce((a, b) => a + b, 0) / (this.frameTimes.length || 1));

    // Memory usage API if supported by browser
    let memoryMb = 0;
    if ((performance as any).memory) {
      memoryMb = Math.round(((performance as any).memory.usedJSHeapSize / (1024 * 1024)) * 10) / 10;
    }

    this.stats = {
      fps: avgFps,
      renderTimeMs: Math.round(renderTimeMs * 100) / 100,
      drawCount,
      visibleCount,
      totalCount,
      memoryUsageMb: memoryMb,
    };
  }

  public getStats(): PerformanceStats {
    return { ...this.stats };
  }
}

export const performanceMonitor = new PerformanceMonitor();
