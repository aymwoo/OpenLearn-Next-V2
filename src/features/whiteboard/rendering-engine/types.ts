import type { BoundingBox, CanvasObject, CanvasPage, Viewport } from '../canvas-model/types.js';

export interface ThemeTokens {
  primary: string;
  background: string;
  gridDot: string;
  selectionBorder: string;
  selectionHandle: string;
  textPrimary: string;
  borderDefault: string;
  guideLine: string;
}

export interface RenderContext {
  viewport: Viewport;
  theme: ThemeTokens;
  dpr: number; // DevicePixelRatio
  isSelectionActive: boolean;
  selectedIds: string[];
}

export interface IRenderer<T = Record<string, unknown>> {
  readonly type: string;
  render(object: CanvasObject<T>, ctx: RenderContext): void;
  getHitArea?(object: CanvasObject<T>): BoundingBox;
}

export type RenderPriority = 'Immediate' | 'AnimationFrame' | 'Idle' | 'Background';

export interface RenderJob {
  id: string;
  priority: RenderPriority;
  execute: () => void;
  timestamp: number;
}

export interface PerformanceStats {
  fps: number;
  renderTimeMs: number;
  drawCount: number;
  visibleCount: number;
  totalCount: number;
  memoryUsageMb: number;
}

export interface DirtyRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}
