import type { DirtyRegion } from '../types.js';
import type { CanvasObject } from '../../canvas-model/types.js';

export class DirtyRegionManager {
  private dirtyRegions: DirtyRegion[] = [];
  private isFullInvalidated = false;

  public invalidateFull(): void {
    this.isFullInvalidated = true;
    this.dirtyRegions = [];
  }

  public invalidateObject(object: CanvasObject): void {
    if (this.isFullInvalidated) return;

    this.dirtyRegions.push({
      x: object.position.x - 10,
      y: object.position.y - 10,
      width: object.size.width + 20,
      height: object.size.height + 20,
    });
  }

  public invalidateRegion(region: DirtyRegion): void {
    if (this.isFullInvalidated) return;
    this.dirtyRegions.push(region);
  }

  public isRegionDirty(region: DirtyRegion): boolean {
    if (this.isFullInvalidated) return true;

    for (let i = 0; i < this.dirtyRegions.length; i++) {
      const dr = this.dirtyRegions[i];
      const intersects =
        region.x < dr.x + dr.width &&
        region.x + region.width > dr.x &&
        region.y < dr.y + dr.height &&
        region.y + region.height > dr.y;

      if (intersects) return true;
    }

    return false;
  }

  public clearDirty(): void {
    this.dirtyRegions = [];
    this.isFullInvalidated = false;
  }

  public getDirtyRegions(): DirtyRegion[] {
    return [...this.dirtyRegions];
  }

  public isFullDirty(): boolean {
    return this.isFullInvalidated;
  }
}

export const dirtyRegionManager = new DirtyRegionManager();
