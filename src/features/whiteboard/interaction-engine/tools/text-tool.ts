import type { CanvasPage } from '../../canvas-model/types.js';
import type { ITool, PointerEventContext, PointerState } from '../types.js';

export class TextTool implements ITool {
  readonly id = 'text';
  readonly name = '文本工具 (Text)';
  readonly cursor = 'text' as const;

  onPointerDown(): { nextState?: PointerState } {
    return { nextState: 'Editing' };
  }

  onPointerUp(): { nextState?: PointerState } {
    return { nextState: 'Idle' };
  }
}
