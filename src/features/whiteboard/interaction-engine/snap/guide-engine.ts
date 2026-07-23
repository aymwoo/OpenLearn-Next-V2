import type { BoundingBox, CanvasObject, CanvasPage } from '../../canvas-model/types.js';
import type { GuideLine, SnapResult } from '../types.js';

export class GuideEngine {
  private threshold: number = 6;

  /**
   * Calculate smart alignment guidelines for a moving/dragged object against other objects
   */
  public calculateSmartGuides(
    targetId: string,
    targetBox: BoundingBox,
    page: CanvasPage
  ): SnapResult {
    const guides: GuideLine[] = [];
    let snappedX = targetBox.x;
    let snappedY = targetBox.y;

    const targetCenterX = targetBox.x + targetBox.width / 2;
    const targetRight = targetBox.x + targetBox.width;
    const targetCenterY = targetBox.y + targetBox.height / 2;
    const targetBottom = targetBox.y + targetBox.height;

    Object.values(page.objects).forEach((other) => {
      if (other.id === targetId || !other.visible) return;

      const otherBox: BoundingBox = {
        x: other.position.x,
        y: other.position.y,
        width: other.size.width,
        height: other.size.height,
      };

      const otherRight = otherBox.x + otherBox.width;
      const otherCenterX = otherBox.x + otherBox.width / 2;
      const otherBottom = otherBox.y + otherBox.height;
      const otherCenterY = otherBox.y + otherBox.height / 2;

      // Vertical alignment checks (X axis)
      if (Math.abs(targetBox.x - otherBox.x) < this.threshold) {
        snappedX = otherBox.x;
        guides.push({ id: `v_left_${other.id}`, type: 'vertical', position: otherBox.x, start: Math.min(targetBox.y, otherBox.y), end: Math.max(targetBottom, otherBottom), label: '左对齐' });
      } else if (Math.abs(targetCenterX - otherCenterX) < this.threshold) {
        snappedX = otherCenterX - targetBox.width / 2;
        guides.push({ id: `v_center_${other.id}`, type: 'vertical', position: otherCenterX, start: Math.min(targetBox.y, otherBox.y), end: Math.max(targetBottom, otherBottom), label: '居中对齐' });
      } else if (Math.abs(targetRight - otherRight) < this.threshold) {
        snappedX = otherRight - targetBox.width;
        guides.push({ id: `v_right_${other.id}`, type: 'vertical', position: otherRight, start: Math.min(targetBox.y, otherBox.y), end: Math.max(targetBottom, otherBottom), label: '右对齐' });
      }

      // Horizontal alignment checks (Y axis)
      if (Math.abs(targetBox.y - otherBox.y) < this.threshold) {
        snappedY = otherBox.y;
        guides.push({ id: `h_top_${other.id}`, type: 'horizontal', position: otherBox.y, start: Math.min(targetBox.x, otherBox.x), end: Math.max(targetRight, otherRight), label: '顶对齐' });
      } else if (Math.abs(targetCenterY - otherCenterY) < this.threshold) {
        snappedY = otherCenterY - targetBox.height / 2;
        guides.push({ id: `h_center_${other.id}`, type: 'horizontal', position: otherCenterY, start: Math.min(targetBox.x, otherBox.x), end: Math.max(targetRight, otherRight), label: '垂直居中' });
      } else if (Math.abs(targetBottom - otherBottom) < this.threshold) {
        snappedY = otherBottom - targetBox.height;
        guides.push({ id: `h_bottom_${other.id}`, type: 'horizontal', position: otherBottom, start: Math.min(targetBox.x, otherBox.x), end: Math.max(targetRight, otherRight), label: '底对齐' });
      }
    });

    return {
      point: { x: snappedX, y: snappedY },
      guides,
    };
  }
}

export const guideEngine = new GuideEngine();
