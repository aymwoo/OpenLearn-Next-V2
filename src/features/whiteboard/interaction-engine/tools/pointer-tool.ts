import type { CanvasPage } from '../../canvas-model/types.js';
import type { ITool, PointerEventContext, PointerState } from '../types.js';

export class PointerTool implements ITool {
  readonly id = 'pointer';
  readonly name = '选择工具 (Cursor/Select)';
  readonly cursor = 'default' as const;

  onPointerDown(ctx: PointerEventContext, page: CanvasPage): { nextState?: PointerState; patchPage?: CanvasPage } {
    if (ctx.targetHandle) {
      return { nextState: ctx.targetHandle === 'rotation' ? 'Rotating' : 'Resizing' };
    }

    if (ctx.targetObjectId) {
      return { nextState: 'Dragging' };
    }

    return { nextState: 'Selecting' };
  }

  onPointerMove(ctx: PointerEventContext): { nextState?: PointerState } {
    return { nextState: ctx.targetObjectId ? 'Hover' : 'Idle' };
  }

  onPointerUp(): { nextState?: PointerState } {
    return { nextState: 'Idle' };
  }
}
