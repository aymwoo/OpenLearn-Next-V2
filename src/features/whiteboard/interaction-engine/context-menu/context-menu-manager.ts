import type { Point2D } from '../../canvas-model/types.js';
import type { ContextMenuItem } from '../types.js';

export interface ContextMenuState {
  x: number;
  y: number;
  targetObjectId?: string | null;
  items: ContextMenuItem[];
}

export class ContextMenuManager {
  private state: ContextMenuState | null = null;
  private listeners: Array<(state: ContextMenuState | null) => void> = [];

  public openContextMenu(x: number, y: number, targetObjectId?: string | null, customItems: ContextMenuItem[] = []): void {
    this.state = {
      x,
      y,
      targetObjectId,
      items: customItems,
    };
    this.notify();
  }

  public closeContextMenu(): void {
    if (!this.state) return;
    this.state = null;
    this.notify();
  }

  public getContextMenuState(): ContextMenuState | null {
    return this.state;
  }

  public onChange(listener: (state: ContextMenuState | null) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notify(): void {
    this.listeners.forEach((fn) => fn(this.state));
  }
}

export const contextMenuManager = new ContextMenuManager();
