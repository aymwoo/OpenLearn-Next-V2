import type { CanvasPage } from '../../canvas-model/types.js';
import type { ITool, PointerEventContext, PointerState } from '../types.js';

export class HandTool implements ITool {
  readonly id = 'hand';
  readonly name = '抓手工具 (Hand/Pan)';
  readonly cursor = 'grab' as const;

  onPointerDown(): { nextState?: PointerState } {
    return { nextState: 'Panning' };
  }

  onPointerUp(): { nextState?: PointerState } {
    return { nextState: 'Idle' };
  }
}
