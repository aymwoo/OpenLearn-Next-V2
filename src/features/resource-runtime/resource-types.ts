/**
 * OpenLearn Teaching Resource Runtime - Data Types & Contracts (Sprint P3-01)
 */

export type ResourceType =
  | 'PDF'
  | 'PPT'
  | 'Image'
  | 'Video'
  | 'Markdown'
  | 'Notebook'
  | 'Mermaid'
  | 'MindMap'
  | 'GeoGebra'
  | 'Blockly'
  | 'Scratch'
  | 'HTML'
  | 'Plugin';

export type ResourceAction =
  | 'preview'
  | 'open'
  | 'pin'
  | 'favorite'
  | 'annotate'
  | 'share'
  | 'fullscreen';

export interface ResourceDescriptor {
  readonly id: string;
  readonly title: string;
  readonly type: ResourceType;
  readonly url?: string;
  readonly content?: unknown;
  pinned?: boolean;
  favorited?: boolean;
  readonly metadata?: Record<string, unknown>;
}

export interface ResourceProvider {
  readonly id: string;
  readonly type: ResourceType;
  preview?: (resource: ResourceDescriptor) => unknown;
  open?: (resource: ResourceDescriptor) => unknown;
  toolbar?: (resource: ResourceDescriptor) => unknown;
  contextMenu?: (resource: ResourceDescriptor) => unknown;
}
