import type { CursorType } from '../types.js';

export class CursorManager {
  private currentCursor: CursorType = 'default';
  private listeners: Array<(cursor: CursorType) => void> = [];

  public getCursor(): CursorType {
    return this.currentCursor;
  }

  public setCursor(cursor: CursorType): void {
    if (this.currentCursor === cursor) return;
    this.currentCursor = cursor;
    this.listeners.forEach((fn) => fn(cursor));
  }

  public onChange(listener: (cursor: CursorType) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }
}

export const cursorManager = new CursorManager();
