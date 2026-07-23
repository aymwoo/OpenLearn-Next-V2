import type { BoundingBox, CanvasObject, CanvasPage, Point2D } from '../canvas-model/types.js';
import { canvasEventBus } from '../canvas-model/event/canvas-event-bus.js';
import { selectionManager } from '../canvas-model/selection/selection-model.js';
import type { PointerEventContext, PointerState } from './types.js';
import { pointerStateMachine } from './state-machine/pointer-state-machine.js';
import { toolManager } from './tools/tool-manager.js';
import { PointerTool } from './tools/pointer-tool.js';
import { HandTool } from './tools/hand-tool.js';
import { PenTool } from './tools/pen-tool.js';
import { ShapeTool } from './tools/shape-tool.js';
import { TextTool } from './tools/text-tool.js';
import { viewportController } from './viewport/viewport-controller.js';
import { transformManager } from './transform/transform-manager.js';
import { snapEngine } from './snap/snap-engine.js';
import { guideEngine } from './snap/guide-engine.js';
import { shortcutEngine } from './shortcut/shortcut-engine.js';
import { clipboardService } from './clipboard/clipboard-service.js';
import { contextMenuManager } from './context-menu/context-menu-manager.js';
import { cursorManager } from './cursor/cursor-manager.js';
import { textEditingManager } from './text-edit/text-editing-manager.js';

export class InteractionManager {
  readonly stateMachine = pointerStateMachine;
  readonly toolManager = toolManager;
  readonly viewportController = viewportController;
  readonly transformManager = transformManager;
  readonly snapEngine = snapEngine;
  readonly guideEngine = guideEngine;
  readonly shortcutEngine = shortcutEngine;
  readonly clipboard = clipboardService;
  readonly contextMenu = contextMenuManager;
  readonly cursor = cursorManager;
  readonly textEditing = textEditingManager;

  constructor() {
    this.registerBuiltinTools();
    this.setupListeners();
  }

  /**
   * Main Pipeline Entry: Handle PointerDown
   */
  public handlePointerDown(ctx: PointerEventContext, page: CanvasPage): { nextState: PointerState; patchPage?: CanvasPage } {
    const activeTool = this.toolManager.getActiveTool();
    if (!activeTool || !activeTool.onPointerDown) {
      return { nextState: this.stateMachine.getState() };
    }

    const result = activeTool.onPointerDown(ctx, page);
    const nextState = result.nextState || 'Idle';
    this.stateMachine.transitionTo(nextState);

    // Update cursor based on tool and state
    this.updateCursorForState(nextState, activeTool.cursor);

    return { nextState, patchPage: result.patchPage };
  }

  /**
   * Main Pipeline Entry: Handle PointerMove
   */
  public handlePointerMove(ctx: PointerEventContext, page: CanvasPage): { nextState: PointerState; patchPage?: CanvasPage } {
    const activeTool = this.toolManager.getActiveTool();
    if (!activeTool || !activeTool.onPointerMove) {
      return { nextState: this.stateMachine.getState() };
    }

    const result = activeTool.onPointerMove(ctx, page);
    if (result.nextState && result.nextState !== this.stateMachine.getState()) {
      this.stateMachine.transitionTo(result.nextState);
    }

    return { nextState: this.stateMachine.getState(), patchPage: result.patchPage };
  }

  /**
   * Main Pipeline Entry: Handle PointerUp
   */
  public handlePointerUp(ctx: PointerEventContext, page: CanvasPage): { nextState: PointerState; patchPage?: CanvasPage } {
    const activeTool = this.toolManager.getActiveTool();
    let resultNextState: PointerState = 'Idle';
    let patchPage: CanvasPage | undefined = undefined;

    if (activeTool && activeTool.onPointerUp) {
      const res = activeTool.onPointerUp(ctx, page);
      if (res.nextState) resultNextState = res.nextState;
      patchPage = res.patchPage;
    }

    this.stateMachine.transitionTo(resultNextState);
    this.updateCursorForState(resultNextState, activeTool?.cursor || 'default');

    return { nextState: resultNextState, patchPage };
  }

  /**
   * Handle KeyDown shortcuts via ShortcutEngine
   */
  public handleKeyDown(event: KeyboardEvent, page: CanvasPage): CanvasPage | void {
    return this.shortcutEngine.handleKeyDown(event, page);
  }

  private registerBuiltinTools(): void {
    this.toolManager.registerTool(new PointerTool());
    this.toolManager.registerTool(new HandTool());
    this.toolManager.registerTool(new PenTool());
    this.toolManager.registerTool(new ShapeTool('rect', '矩形对象', 'rect'));
    this.toolManager.registerTool(new ShapeTool('circle', '圆形对象', 'circle'));
    this.toolManager.registerTool(new TextTool());
  }

  private setupListeners(): void {
    this.toolManager.onToolChange((tool) => {
      this.cursor.setCursor(tool.cursor);
    });
  }

  private updateCursorForState(state: PointerState, defaultCursor: string): void {
    switch (state) {
      case 'Panning':
        this.cursor.setCursor('grabbing');
        break;
      case 'Dragging':
        this.cursor.setCursor('move');
        break;
      case 'Resizing':
        this.cursor.setCursor('nwse-resize');
        break;
      case 'Rotating':
        this.cursor.setCursor('grab');
        break;
      case 'Drawing':
        this.cursor.setCursor('crosshair');
        break;
      case 'Editing':
        this.cursor.setCursor('text');
        break;
      default:
        this.cursor.setCursor((defaultCursor as any) || 'default');
        break;
    }
  }
}

export const interactionManager = new InteractionManager();
