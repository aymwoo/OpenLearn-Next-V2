import type { BoundingBox, CanvasObject, CanvasPage, Point2D, Size2D } from '../canvas-model/types.js';

/**
 * Unified Pointer State Machine Enum.
 * Replaces ad-hoc boolean flags (isDragging, isDrawing, isEditing, isMoving, etc.).
 */
export type PointerState =
  | 'Idle'
  | 'Hover'
  | 'Selecting'
  | 'Dragging'
  | 'Drawing'
  | 'Resizing'
  | 'Rotating'
  | 'Editing'
  | 'Panning'
  | 'Zooming'
  | 'ContextMenu'
  | 'PluginInteraction';

export type CursorType =
  | 'default'
  | 'pointer'
  | 'crosshair'
  | 'grab'
  | 'grabbing'
  | 'text'
  | 'move'
  | 'nwse-resize'
  | 'nesw-resize'
  | 'ew-resize'
  | 'ns-resize'
  | 'not-allowed';

export interface PointerEventContext {
  originalEvent: React.MouseEvent | React.TouchEvent | MouseEvent | TouchEvent;
  stagePoint: Point2D; // In canvas world coordinates
  screenPoint: Point2D; // In screen/DOM coordinates
  targetObjectId?: string | null;
  targetHandle?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'rotation' | null;
  isShiftPressed: boolean;
  isAltPressed: boolean;
  isCtrlPressed: boolean;
}

export interface ITool {
  readonly id: string;
  readonly name: string;
  readonly cursor: CursorType;
  readonly iconName?: string;

  onActivate?(): void;
  onDeactivate?(): void;

  onPointerDown?(ctx: PointerEventContext, page: CanvasPage): { nextState?: PointerState; patchPage?: CanvasPage };
  onPointerMove?(ctx: PointerEventContext, page: CanvasPage): { nextState?: PointerState; patchPage?: CanvasPage };
  onPointerUp?(ctx: PointerEventContext, page: CanvasPage): { nextState?: PointerState; patchPage?: CanvasPage };

  onKeyDown?(event: KeyboardEvent, page: CanvasPage): { patchPage?: CanvasPage };
}

export interface ViewportState {
  x: number;
  y: number;
  zoom: number;
  minZoom: number;
  maxZoom: number;
}

export interface GuideLine {
  id: string;
  type: 'horizontal' | 'vertical';
  position: number;
  start: number;
  end: number;
  label?: string;
}

export interface SnapResult {
  point: Point2D;
  guides: GuideLine[];
}

export interface ShortcutDefinition {
  id: string;
  key: string; // e.g. "z", "c", "v", "Delete", "Escape"
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  description: string;
  action: (page: CanvasPage) => CanvasPage | void;
}

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: string;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  action: () => void;
}
