import type { Point2D } from '../../canvas-model/types.js';

export interface SnapConfig {
  gridEnabled: boolean;
  gridSize: number;
  threshold: number;
}

export class SnapEngine {
  private config: SnapConfig = {
    gridEnabled: true,
    gridSize: 24,
    threshold: 8,
  };

  public setConfig(patch: Partial<SnapConfig>): void {
    this.config = { ...this.config, ...patch };
  }

  public getConfig(): SnapConfig {
    return { ...this.config };
  }

  /**
   * Snap point to nearest grid coordinates
   */
  public snapToGrid(point: Point2D): Point2D {
    if (!this.config.gridEnabled || this.config.gridSize <= 0) return point;

    const snapX = Math.round(point.x / this.config.gridSize) * this.config.gridSize;
    const snapY = Math.round(point.y / this.config.gridSize) * this.config.gridSize;

    const diffX = Math.abs(point.x - snapX);
    const diffY = Math.abs(point.y - snapY);

    return {
      x: diffX <= this.config.threshold ? snapX : point.x,
      y: diffY <= this.config.threshold ? snapY : point.y,
    };
  }
}

export const snapEngine = new SnapEngine();
