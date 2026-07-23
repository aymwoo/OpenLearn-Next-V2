import type { CanvasObject, Point2D } from '../../canvas-model/types.js';

export class HitTestEngine {
  /**
   * Test if a point intersects a CanvasObject's bounding box
   */
  public hitTestObject(point: Point2D, object: CanvasObject): boolean {
    if (!object.visible) return false;

    const left = object.position.x;
    const top = object.position.y;
    const right = left + object.size.width;
    const bottom = top + object.size.height;

    return point.x >= left && point.x <= right && point.y >= top && point.y <= bottom;
  }

  /**
   * Find topmost hit object from an array of objects
   */
  public hitTestObjects(point: Point2D, objects: CanvasObject[]): CanvasObject | null {
    // Reverse search so topmost (last in zIndex order) object is hit first
    for (let i = objects.length - 1; i >= 0; i--) {
      const obj = objects[i];
      if (this.hitTestObject(point, obj)) {
        return obj;
      }
    }
    return null;
  }
}

export const hitTestEngine = new HitTestEngine();
