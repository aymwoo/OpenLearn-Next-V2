import type { CanvasObject, CanvasPage, LayerManager, SelectionModel, Viewport } from '../types.js';

export type CanvasEventType =
  | 'ObjectCreated'
  | 'ObjectDeleted'
  | 'ObjectUpdated'
  | 'SelectionChanged'
  | 'HistoryChanged'
  | 'LayerChanged'
  | 'ViewportChanged';

export interface CanvasEventMap {
  ObjectCreated: { object: CanvasObject; pageId: string };
  ObjectDeleted: { objectId: string; pageId: string };
  ObjectUpdated: { object: CanvasObject; pageId: string; patch: Partial<CanvasObject> };
  SelectionChanged: { selection: SelectionModel };
  HistoryChanged: { canUndo: boolean; canRedo: boolean };
  LayerChanged: { pageId: string; layerId: string };
  ViewportChanged: { viewport: Viewport };
}

export type CanvasEventListener<T extends CanvasEventType> = (event: CanvasEventMap[T]) => void;

/**
 * Canvas Event Bus
 * 
 * Provides decoupled, strongly-typed event communication between
 * Whiteboard core, tools, selection manager, and external plugins.
 */
export class CanvasEventBus {
  private listeners = new Map<CanvasEventType, Set<CanvasEventListener<any>>>();

  /**
   * Subscribe to a Canvas Event
   */
  public on<T extends CanvasEventType>(type: T, listener: CanvasEventListener<T>): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(listener);

    return () => {
      this.listeners.get(type)?.delete(listener);
    };
  }

  /**
   * Emit a Canvas Event
   */
  public emit<T extends CanvasEventType>(type: T, payload: CanvasEventMap[T]): void {
    const subs = this.listeners.get(type);
    if (!subs) return;

    subs.forEach((listener) => {
      try {
        listener(payload);
      } catch (err) {
        console.error(`[CanvasEventBus] Error handling event "${type}":`, err);
      }
    });
  }

  /**
   * Clear all subscribers
   */
  public clear(): void {
    this.listeners.clear();
  }
}

export const canvasEventBus = new CanvasEventBus();
