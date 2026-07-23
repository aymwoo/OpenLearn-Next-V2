/**
 * OpenLearn Whiteboard Tool System - Tool Types & Contracts (Sprint P2-01)
 */

export type WhiteboardToolCategory =
  | 'Selection'
  | 'Drawing'
  | 'Shape'
  | 'Annotation'
  | 'Media'
  | 'Extension';

export interface WhiteboardToolMetadata {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  readonly category: WhiteboardToolCategory;
  readonly cursor?: string;
  readonly shortcut?: string;
  readonly priority?: number;
  readonly permissions?: ReadonlyArray<string>;
}

export interface IWhiteboardTool {
  readonly meta: WhiteboardToolMetadata;
  activate?: (context?: Record<string, unknown>) => void;
  deactivate?: () => void;
  dispose?: () => void;
}

export interface WhiteboardToolProvider {
  readonly id: string;
  readonly createTool: () => IWhiteboardTool;
}
