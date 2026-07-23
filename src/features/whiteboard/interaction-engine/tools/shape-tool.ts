import type { CanvasPage } from '../../canvas-model/types.js';
import type { ITool, PointerEventContext, PointerState } from '../types.js';

export class ShapeTool implements ITool {
  constructor(
    public readonly id: string = 'rect',
    public readonly name: string = '矩形工具 (Rectangle)',
    public readonly shapeType: 'rect' | 'circle' = 'rect'
  ) {}

  readonly cursor = 'crosshair' as const;

  onPointerDown(): { nextState?: PointerState } {
    return { nextState: 'Drawing' };
  }

  onPointerUp(): { nextState?: PointerState } {
    return { nextState: 'Idle' };
  }
}
