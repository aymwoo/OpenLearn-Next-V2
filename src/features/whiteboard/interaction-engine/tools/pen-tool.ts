import type { CanvasPage } from '../../canvas-model/types.js';
import type { ITool, PointerEventContext, PointerState } from '../types.js';

export class PenTool implements ITool {
  readonly id = 'pen';
  readonly name = '画笔工具 (Pen/Draw)';
  readonly cursor = 'crosshair' as const;

  onPointerDown(): { nextState?: PointerState } {
    return { nextState: 'Drawing' };
  }

  onPointerUp(): { nextState?: PointerState } {
    return { nextState: 'Idle' };
  }
}
