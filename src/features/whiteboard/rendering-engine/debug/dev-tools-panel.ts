import type { PerformanceStats } from '../types.js';

export class DevToolsPanel {
  private isVisible = false;

  public toggle(): void {
    this.isVisible = !this.isVisible;
  }

  public show(): void {
    this.isVisible = true;
  }

  public hide(): void {
    this.isVisible = false;
  }

  public getIsVisible(): boolean {
    return this.isVisible;
  }

  public formatDebugSummary(stats: PerformanceStats, layerCount: number): string {
    return [
      `[Rendering DevTools Panel]`,
      `FPS: ${stats.fps}`,
      `Render Time: ${stats.renderTimeMs}ms`,
      `Visible Count: ${stats.visibleCount} / ${stats.totalCount} (Culled: ${stats.totalCount - stats.visibleCount})`,
      `Draw Calls: ${stats.drawCount}`,
      `Layers: ${layerCount}`,
      `Heap Memory: ${stats.memoryUsageMb} MB`,
    ].join('\n');
  }
}

export const devToolsPanel = new DevToolsPanel();
