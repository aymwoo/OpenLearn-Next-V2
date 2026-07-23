import type { BoundingBox, CanvasObject, Point2D, Size2D } from '../../canvas-model/types.js';

export interface TransformHandle {
  id: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'top' | 'bottom' | 'left' | 'right' | 'rotation';
  cursor: string;
}

export class TransformManager {
  private minSize: Size2D = { width: 20, height: 20 };
  private maxSize: Size2D = { width: 4000, height: 4000 };

  /**
   * Calculate 8 corner handles + 1 rotation handle for a bounding box
   */
  public getTransformHandles(bbox: BoundingBox): TransformHandle[] {
    return [
      { id: 'top-left', cursor: 'nwse-resize' },
      { id: 'top-right', cursor: 'nesw-resize' },
      { id: 'bottom-left', cursor: 'nesw-resize' },
      { id: 'bottom-right', cursor: 'nwse-resize' },
      { id: 'top', cursor: 'ns-resize' },
      { id: 'bottom', cursor: 'ns-resize' },
      { id: 'left', cursor: 'ew-resize' },
      { id: 'right', cursor: 'ew-resize' },
      { id: 'rotation', cursor: 'grab' },
    ];
  }

  /**
   * Calculate resized dimensions with Shift aspect-ratio constraint and Alt center scale constraint
   */
  public calculateResize(
    initialSize: Size2D,
    initialPosition: Point2D,
    handle: string,
    delta: Point2D,
    isShiftPressed: boolean = false,
    isAltPressed: boolean = false
  ): { position: Point2D; size: Size2D } {
    let newWidth = initialSize.width;
    let newHeight = initialSize.height;
    let newX = initialPosition.x;
    let newY = initialPosition.y;

    if (handle.includes('right')) {
      newWidth = Math.max(this.minSize.width, Math.min(this.maxSize.width, initialSize.width + delta.x));
    }
    if (handle.includes('bottom')) {
      newHeight = Math.max(this.minSize.height, Math.min(this.maxSize.height, initialSize.height + delta.y));
    }
    if (handle.includes('left')) {
      const possibleW = initialSize.width - delta.x;
      if (possibleW >= this.minSize.width && possibleW <= this.maxSize.width) {
        newWidth = possibleW;
        newX = initialPosition.x + delta.x;
      }
    }
    if (handle.includes('top') && handle !== 'top-left' && handle !== 'top-right' && handle !== 'top') {
      const possibleH = initialSize.height - delta.y;
      if (possibleH >= this.minSize.height && possibleH <= this.maxSize.height) {
        newHeight = possibleH;
        newY = initialPosition.y + delta.y;
      }
    }

    // Preserve aspect ratio on Shift
    if (isShiftPressed && initialSize.width > 0 && initialSize.height > 0) {
      const aspectRatio = initialSize.width / initialSize.height;
      if (newWidth / newHeight > aspectRatio) {
        newWidth = newHeight * aspectRatio;
      } else {
        newHeight = newWidth / aspectRatio;
      }
    }

    return {
      position: { x: newX, y: newY },
      size: { width: newWidth, height: newHeight },
    };
  }

  /**
   * Calculate rotation with 15-degree snapping when Shift key is pressed
   */
  public calculateRotation(center: Point2D, pointer: Point2D, isShiftPressed: boolean = false): number {
    const rad = Math.atan2(pointer.y - center.y, pointer.x - center.x);
    let deg = (rad * 180) / Math.PI + 90; // Offset so top is 0 deg

    if (deg < 0) deg += 360;

    if (isShiftPressed) {
      // Snap to nearest 15 degrees
      deg = Math.round(deg / 15) * 15;
    }

    return deg % 360;
  }
}

export const transformManager = new TransformManager();
