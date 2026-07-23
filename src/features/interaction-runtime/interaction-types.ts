/**
 * OpenLearn Interaction Runtime - Data Types & Contracts (Sprint P2-09)
 */

export type InteractionDomain =
  | 'Keyboard'
  | 'Mouse'
  | 'Touch'
  | 'Gesture'
  | 'Drag'
  | 'Clipboard'
  | 'Focus'
  | 'ContextMenu'
  | 'Selection';

export interface InteractionEvent<T = Record<string, unknown>> {
  readonly id: string;
  readonly domain: InteractionDomain;
  readonly targetId?: string;
  readonly payload: T;
  readonly timestamp: number;
}

export interface InteractionHandler {
  readonly id: string;
  readonly domain: InteractionDomain;
  readonly priority?: number;
  readonly handle: (event: InteractionEvent) => boolean | void;
}
