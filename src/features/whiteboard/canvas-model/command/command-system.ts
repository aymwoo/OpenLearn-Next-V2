import type { CanvasObject, CanvasPage, Point2D, Size2D } from '../types.js';

export interface ICanvasCommand {
  readonly id: string;
  readonly name: string;
  readonly timestamp: number;
  execute(page: CanvasPage): CanvasPage;
  undo(page: CanvasPage): CanvasPage;
}

export interface CommandHistoryLog {
  id: string;
  name: string;
  timestamp: number;
}

/**
 * CommandManager — Handles Whiteboard Object Transformations with Undo/Redo/Replay
 */
export class CommandManager {
  private undoStack: ICanvasCommand[] = [];
  private redoStack: ICanvasCommand[] = [];
  private maxHistorySize: number = 50;
  private listeners: Array<() => void> = [];

  constructor(maxSize: number = 50) {
    this.maxHistorySize = maxSize;
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notify(): void {
    this.listeners.forEach((l) => l());
  }

  public executeCommand(command: ICanvasCommand, currentPage: CanvasPage): CanvasPage {
    const updatedPage = command.execute(currentPage);
    this.undoStack.push(command);
    if (this.undoStack.length > this.maxHistorySize) {
      this.undoStack.shift();
    }
    this.redoStack = []; // Clear redo stack on new action
    this.notify();
    return updatedPage;
  }

  public undo(currentPage: CanvasPage): CanvasPage {
    if (!this.canUndo()) return currentPage;
    const command = this.undoStack.pop()!;
    const updatedPage = command.undo(currentPage);
    this.redoStack.push(command);
    this.notify();
    return updatedPage;
  }

  public redo(currentPage: CanvasPage): CanvasPage {
    if (!this.canRedo()) return currentPage;
    const command = this.redoStack.pop()!;
    const updatedPage = command.execute(currentPage);
    this.undoStack.push(command);
    this.notify();
    return updatedPage;
  }

  public canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  public getHistory(): CommandHistoryLog[] {
    return this.undoStack.map((cmd) => ({
      id: cmd.id,
      name: cmd.name,
      timestamp: cmd.timestamp,
    }));
  }

  public clearHistory(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.notify();
  }
}

// ── Command Implementations ──────────────────────────────────────────────────

export class AddObjectCommand implements ICanvasCommand {
  readonly id: string;
  readonly name = 'Add Object';
  readonly timestamp = Date.now();

  constructor(public readonly object: CanvasObject) {
    this.id = `cmd_add_${object.id}`;
  }

  execute(page: CanvasPage): CanvasPage {
    return {
      ...page,
      objects: {
        ...page.objects,
        [this.object.id]: this.object,
      },
    };
  }

  undo(page: CanvasPage): CanvasPage {
    const nextObjects = { ...page.objects };
    delete nextObjects[this.object.id];
    return {
      ...page,
      objects: nextObjects,
    };
  }
}

export class DeleteObjectCommand implements ICanvasCommand {
  readonly id: string;
  readonly name = 'Delete Object';
  readonly timestamp = Date.now();
  private removedObject: CanvasObject | null = null;

  constructor(public readonly objectId: string) {
    this.id = `cmd_del_${objectId}`;
  }

  execute(page: CanvasPage): CanvasPage {
    this.removedObject = page.objects[this.objectId] || null;
    const nextObjects = { ...page.objects };
    delete nextObjects[this.objectId];
    return {
      ...page,
      objects: nextObjects,
    };
  }

  undo(page: CanvasPage): CanvasPage {
    if (!this.removedObject) return page;
    return {
      ...page,
      objects: {
        ...page.objects,
        [this.removedObject.id]: this.removedObject,
      },
    };
  }
}

export class MoveObjectCommand implements ICanvasCommand {
  readonly id: string;
  readonly name = 'Move Object';
  readonly timestamp = Date.now();

  constructor(
    public readonly objectId: string,
    public readonly oldPosition: Point2D,
    public readonly newPosition: Point2D
  ) {
    this.id = `cmd_move_${objectId}_${Date.now()}`;
  }

  execute(page: CanvasPage): CanvasPage {
    const target = page.objects[this.objectId];
    if (!target) return page;
    return {
      ...page,
      objects: {
        ...page.objects,
        [this.objectId]: {
          ...target,
          position: { ...this.newPosition },
          updatedAt: Date.now(),
        },
      },
    };
  }

  undo(page: CanvasPage): CanvasPage {
    const target = page.objects[this.objectId];
    if (!target) return page;
    return {
      ...page,
      objects: {
        ...page.objects,
        [this.objectId]: {
          ...target,
          position: { ...this.oldPosition },
          updatedAt: Date.now(),
        },
      },
    };
  }
}

export class ResizeObjectCommand implements ICanvasCommand {
  readonly id: string;
  readonly name = 'Resize Object';
  readonly timestamp = Date.now();

  constructor(
    public readonly objectId: string,
    public readonly oldSize: Size2D,
    public readonly newSize: Size2D,
    public readonly oldPosition?: Point2D,
    public readonly newPosition?: Point2D
  ) {
    this.id = `cmd_resize_${objectId}_${Date.now()}`;
  }

  execute(page: CanvasPage): CanvasPage {
    const target = page.objects[this.objectId];
    if (!target) return page;
    return {
      ...page,
      objects: {
        ...page.objects,
        [this.objectId]: {
          ...target,
          size: { ...this.newSize },
          position: this.newPosition ? { ...this.newPosition } : target.position,
          updatedAt: Date.now(),
        },
      },
    };
  }

  undo(page: CanvasPage): CanvasPage {
    const target = page.objects[this.objectId];
    if (!target) return page;
    return {
      ...page,
      objects: {
        ...page.objects,
        [this.objectId]: {
          ...target,
          size: { ...this.oldSize },
          position: this.oldPosition ? { ...this.oldPosition } : target.position,
          updatedAt: Date.now(),
        },
      },
    };
  }
}

export class UpdateObjectCommand<T = Record<string, unknown>> implements ICanvasCommand {
  readonly id: string;
  readonly name = 'Update Object';
  readonly timestamp = Date.now();

  constructor(
    public readonly objectId: string,
    public readonly oldPatch: Partial<CanvasObject<T>>,
    public readonly newPatch: Partial<CanvasObject<T>>
  ) {
    this.id = `cmd_update_${objectId}_${Date.now()}`;
  }

  execute(page: CanvasPage): CanvasPage {
    const target = page.objects[this.objectId];
    if (!target) return page;
    return {
      ...page,
      objects: {
        ...page.objects,
        [this.objectId]: {
          ...target,
          ...this.newPatch,
          updatedAt: Date.now(),
        },
      },
    };
  }

  undo(page: CanvasPage): CanvasPage {
    const target = page.objects[this.objectId];
    if (!target) return page;
    return {
      ...page,
      objects: {
        ...page.objects,
        [this.objectId]: {
          ...target,
          ...this.oldPatch,
          updatedAt: Date.now(),
        },
      },
    };
  }
}

export class LockObjectCommand implements ICanvasCommand {
  readonly id: string;
  readonly name: string;
  readonly timestamp = Date.now();

  constructor(public readonly objectId: string, public readonly lockState: boolean) {
    this.id = `cmd_lock_${objectId}`;
    this.name = lockState ? 'Lock Object' : 'Unlock Object';
  }

  execute(page: CanvasPage): CanvasPage {
    const target = page.objects[this.objectId];
    if (!target) return page;
    return {
      ...page,
      objects: {
        ...page.objects,
        [this.objectId]: { ...target, locked: this.lockState, updatedAt: Date.now() },
      },
    };
  }

  undo(page: CanvasPage): CanvasPage {
    const target = page.objects[this.objectId];
    if (!target) return page;
    return {
      ...page,
      objects: {
        ...page.objects,
        [this.objectId]: { ...target, locked: !this.lockState, updatedAt: Date.now() },
      },
    };
  }
}

export const commandManager = new CommandManager();
