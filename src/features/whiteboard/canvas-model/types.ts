/**
 * Canvas Object Model — Core Type Definitions
 * 
 * Provides unified interfaces for Object-Oriented Canvas Architecture.
 * All whiteboard content (text, image, shapes, code, quiz, plugins, etc.)
 * is abstracted as a generic `CanvasObject<T>`.
 */

export interface Point2D {
  x: number;
  y: number;
}

export interface Size2D {
  width: number;
  height: number;
}

export interface Scale2D {
  x: number;
  y: number;
}

export interface ObjectMetadata {
  description?: string;
  tags?: string[];
  authorRole?: 'teacher' | 'student' | 'system' | 'ai' | 'plugin';
  pluginId?: string;
  version?: string;
  segmentId?: string | null;
  pageIndex?: number;
  customData?: Record<string, unknown>;
}

/**
 * Base Unified Canvas Object Definition.
 * All specific object properties MUST reside in `payload` to avoid BaseObject pollution.
 */
export interface CanvasObject<T = Record<string, unknown>> {
  readonly id: string;
  type: string;
  name: string;
  position: Point2D;
  rotation: number; // in degrees
  scale: Scale2D;
  size: Size2D;
  opacity: number; // 0.0 to 1.0
  visible: boolean;
  locked: boolean;
  zIndex: number;
  parentId?: string | null;
  groupId?: string | null;
  layerId: string;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  metadata: ObjectMetadata;
  payload: T;
}

/**
 * Layer Model in Whiteboard Canvas Architecture
 */
export type LayerType = 'background' | 'default' | 'ai' | 'plugin' | 'user';

export interface CanvasLayer {
  id: string;
  name: string;
  type: LayerType;
  visible: boolean;
  locked: boolean;
  zIndex: number;
  opacity: number;
  objectIds: string[];
}

/**
 * Object Group Model
 */
export interface CanvasGroup {
  id: string;
  name: string;
  childIds: string[];
  parentId?: string | null;
  locked: boolean;
  visible: boolean;
}

/**
 * Whiteboard Page Model
 */
export interface CanvasPage {
  id: string;
  title: string;
  order: number;
  layers: CanvasLayer[];
  objects: Record<string, CanvasObject>;
  groups: Record<string, CanvasGroup>;
  backgroundColor?: string;
  gridEnabled?: boolean;
}

/**
 * Whole Whiteboard Canvas Document
 */
export interface CanvasDocument {
  id: string;
  lessonId: string;
  version: number;
  pages: CanvasPage[];
  activePageId: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * Viewport / Camera State
 */
export interface Viewport {
  x: number;
  y: number;
  zoom: number; // 1.0 = 100%
  minZoom: number;
  maxZoom: number;
}

/**
 * Bounding Box for Selection
 */
export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Canvas Selection State
 */
export interface SelectionModel {
  selectedIds: string[];
  activeGroupId?: string | null;
  boundingBox?: BoundingBox | null;
}

// ── Specific Payload Definitions ──────────────────────────────────────────────

export interface TextPayload {
  text: string;
  fontFamily: string;
  fontSize: number;
  fill: string;
  align: 'left' | 'center' | 'right';
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}

export interface ImagePayload {
  url: string;
  originalWidth?: number;
  originalHeight?: number;
  crop?: { x: number; y: number; width: number; height: number };
  filter?: string;
}

export interface ShapePayload {
  shapeType: 'rect' | 'circle' | 'line' | 'star' | 'pen' | 'highlighter';
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  cornerRadius?: number;
  points?: number[]; // For pen / highlighter freehand drawings
}

export interface CodePayload {
  code: string;
  language: string;
  theme?: string;
}

export interface QuizPayload {
  question: string;
  options: string[];
  correctIndex?: number;
  submissions?: Record<string, { optionIndex: number; studentId: string; timestamp: number }>;
}

export interface PresentationPayload {
  markdown: string;
  currentSlideIndex?: number;
  slideX?: number;
  slideY?: number;
}

export interface MathGraphPayload {
  equation: string;
  xRange?: [number, number];
  yRange?: [number, number];
}

export interface RollcallPayload {
  title: string;
  allStudents?: Array<{ id: string; name: string; email?: string }>;
  selectedStudent?: { id: string; name: string; email?: string } | null;
  status?: string;
  pickedTime?: string;
}

export interface PluginPayload {
  pluginId: string;
  widgetId: string;
  slot: string;
  state?: Record<string, unknown>;
}

export interface HtmlAppletPayload {
  title?: string;
  code?: string;
  coursewareUuid?: string;
  /** 系统资源库中的单 HTML / 文件夹资源 id（优先级介于 coursewareUuid 与 code 之间） */
  resourceId?: string;
  /** 插件自定义内容源类型（配合 coursewareSourceRegistry） */
  sourceType?: string;
  /** 插件自定义内容源 id（配合 coursewareSourceRegistry） */
  sourceId?: string;
}

export interface AssignmentPayload {
  title: string;
  description: string;
  dueDate?: string;
  maxScore?: number;
}

export interface TimerPayload {
  duration: number;
  remaining?: number;
  label?: string;
  isRunning?: boolean;
}

/**
 * Definition of an Object Descriptor registered in ObjectRegistry
 */
export interface ObjectTypeDescriptor<T = Record<string, unknown>> {
  type: string;
  displayName: string;
  category: 'basic' | 'shape' | 'media' | 'interactive' | 'plugin';
  defaultSize: Size2D;
  createDefaultPayload: () => T;
  validatePayload?: (payload: unknown) => boolean;
}
