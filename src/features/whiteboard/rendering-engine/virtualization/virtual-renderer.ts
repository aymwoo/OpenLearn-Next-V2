import type { BoundingBox, CanvasObject, Viewport } from '../../canvas-model/types.js';

export class VirtualRenderer {
  /**
   * Filter objects: return only objects that intersect the current visible Viewport
   */
  public cullObjects(
    objects: CanvasObject[],
    viewport: Viewport,
    containerSize: { width: number; height: number }
  ): { visible: CanvasObject[]; culledCount: number } {
    if (containerSize.width <= 0 || containerSize.height <= 0) {
      return { visible: objects, culledCount: 0 };
    }

    // Calculate visible bounding box in canvas coordinates
    const viewLeft = -viewport.x / viewport.zoom;
    const viewTop = -viewport.y / viewport.zoom;
    const viewRight = viewLeft + containerSize.width / viewport.zoom;
    const viewBottom = viewTop + containerSize.height / viewport.zoom;

    const visible: CanvasObject[] = [];
    let culledCount = 0;

    for (let i = 0; i < objects.length; i++) {
      const obj = objects[i];
      if (!obj.visible) {
        culledCount++;
        continue;
      }

      const objRight = obj.position.x + obj.size.width;
      const objBottom = obj.position.y + obj.size.height;

      // Axis-Aligned Bounding Box Intersects check
      const intersects =
        obj.position.x < viewRight &&
        objRight > viewLeft &&
        obj.position.y < viewBottom &&
        objBottom > viewTop;

      if (intersects) {
        visible.push(obj);
      } else {
        culledCount++;
      }
    }

    return { visible, culledCount };
  }
}

export const virtualRenderer = new VirtualRenderer();
