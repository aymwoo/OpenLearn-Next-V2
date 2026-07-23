import type { BoundingBox, CanvasObject, CanvasPage, SelectionModel } from '../types.js';

export class SelectionManager {
  /**
   * Create an initial empty SelectionModel
   */
  public createInitialSelection(): SelectionModel {
    return {
      selectedIds: [],
      activeGroupId: null,
      boundingBox: null,
    };
  }

  /**
   * Select a single object
   */
  public selectSingle(page: CanvasPage, objectId: string): SelectionModel {
    const obj = page.objects[objectId];
    if (!obj || obj.locked) {
      return this.createInitialSelection();
    }

    const bbox: BoundingBox = {
      x: obj.position.x,
      y: obj.position.y,
      width: obj.size.width,
      height: obj.size.height,
    };

    return {
      selectedIds: [objectId],
      activeGroupId: obj.groupId || null,
      boundingBox: bbox,
    };
  }

  /**
   * Toggle selection state for an object (Shift/Cmd click)
   */
  public toggleSelection(page: CanvasPage, currentSelection: SelectionModel, objectId: string): SelectionModel {
    const obj = page.objects[objectId];
    if (!obj || obj.locked) return currentSelection;

    const exists = currentSelection.selectedIds.includes(objectId);
    const nextIds = exists
      ? currentSelection.selectedIds.filter((id) => id !== objectId)
      : [...currentSelection.selectedIds, objectId];

    const bbox = this.calculateBoundingBox(page, nextIds);

    return {
      selectedIds: nextIds,
      activeGroupId: null,
      boundingBox: bbox,
    };
  }

  /**
   * Select multiple objects inside a rectangular Area
   */
  public selectArea(page: CanvasPage, area: BoundingBox): SelectionModel {
    const selectedIds: string[] = [];

    Object.values(page.objects).forEach((obj) => {
      if (obj.locked || !obj.visible) return;

      const objRight = obj.position.x + obj.size.width;
      const objBottom = obj.position.y + obj.size.height;
      const areaRight = area.x + area.width;
      const areaBottom = area.y + area.height;

      const intersects =
        obj.position.x < areaRight &&
        objRight > area.x &&
        obj.position.y < areaBottom &&
        objBottom > area.y;

      if (intersects) {
        selectedIds.push(obj.id);
      }
    });

    return {
      selectedIds,
      activeGroupId: null,
      boundingBox: this.calculateBoundingBox(page, selectedIds),
    };
  }

  /**
   * Clear all selections
   */
  public clearSelection(): SelectionModel {
    return this.createInitialSelection();
  }

  /**
   * Compute aggregate bounding box for selected objects
   */
  public calculateBoundingBox(page: CanvasPage, objectIds: string[]): BoundingBox | null {
    if (objectIds.length === 0) return null;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    objectIds.forEach((id) => {
      const obj = page.objects[id];
      if (!obj) return;
      minX = Math.min(minX, obj.position.x);
      minY = Math.min(minY, obj.position.y);
      maxX = Math.max(maxX, obj.position.x + obj.size.width);
      maxY = Math.max(maxY, obj.position.y + obj.size.height);
    });

    if (minX === Infinity) return null;

    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    };
  }
}

export const selectionManager = new SelectionManager();
