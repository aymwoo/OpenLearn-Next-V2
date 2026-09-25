import { frontendEventBus } from '../../../services/event-bus';
import { v7 as uuidv7 } from 'uuid';

export type AutoSaveStatus = 'none' | 'saved' | 'pending' | 'saving' | 'error';

export interface AutoSaveContext {
  lessonId: string;
  pendingElements: Map<string, Record<string, any>>;
  cancel: () => void;
}

export interface AutoSaveResult {
  lessonId: string;
  savedElementIds: string[];
  success: boolean;
  error?: any;
}

export type AutoSaveInterceptor = (context: AutoSaveContext) => boolean | Promise<boolean | void> | void;
export type AutoSaveListener = (
  status: AutoSaveStatus,
  info?: {
    lessonId?: string;
    lastSavedTime?: Date | null;
    error?: any;
    count?: number;
  },
) => void;

export type SaveElementHandler = (lessonId: string, elementId: string, data: any) => Promise<boolean>;

export class WhiteboardAutoSaveManager {
  private lessonId: string | null = null;
  private debounceDelay = 800;
  private status: AutoSaveStatus = 'none';
  private lastSavedTime: Date | null = null;
  private pendingMap = new Map<string, Record<string, any>>();
  private timer: any = null;
  private isFlushing = false;
  private lastError: any = null;

  private saveHandler: SaveElementHandler | null = null;
  private interceptors = new Set<AutoSaveInterceptor>();
  private listeners = new Set<AutoSaveListener>();

  constructor(options?: { debounceDelay?: number; saveHandler?: SaveElementHandler }) {
    if (options?.debounceDelay !== undefined) {
      this.debounceDelay = options.debounceDelay;
    }
    if (options?.saveHandler) {
      this.saveHandler = options.saveHandler;
    }
  }

  // --- Configuration ---

  public setLessonId(id: string | null) {
    if (this.lessonId !== id) {
      if (this.pendingMap.size > 0 && this.lessonId) {
        void this.flush();
      }
      this.lessonId = id;
      this.status = id ? 'saved' : 'none';
      this.notifyListeners();
    }
  }

  public getLessonId(): string | null {
    return this.lessonId;
  }

  public setSaveHandler(handler: SaveElementHandler) {
    this.saveHandler = handler;
  }

  public setDebounceDelay(ms: number) {
    this.debounceDelay = Math.max(100, ms);
  }

  public getDebounceDelay(): number {
    return this.debounceDelay;
  }

  public getStatus(): AutoSaveStatus {
    return this.status;
  }

  public getLastSavedTime(): Date | null {
    return this.lastSavedTime;
  }

  public getPendingCount(): number {
    return this.pendingMap.size;
  }

  public getLastError(): any {
    return this.lastError;
  }

  // --- Plugin API: Interceptors & Listeners ---

  public registerInterceptor(interceptor: AutoSaveInterceptor): () => void {
    this.interceptors.add(interceptor);
    return () => {
      this.interceptors.delete(interceptor);
    };
  }

  public registerListener(listener: AutoSaveListener): () => void {
    this.listeners.add(listener);
    // Notify immediately with current state
    listener(this.status, {
      lessonId: this.lessonId || undefined,
      lastSavedTime: this.lastSavedTime,
      count: this.pendingMap.size,
    });
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners() {
    this.listeners.forEach((listener) => {
      try {
        listener(this.status, {
          lessonId: this.lessonId || undefined,
          lastSavedTime: this.lastSavedTime,
          error: this.lastError,
          count: this.pendingMap.size,
        });
      } catch (err) {
        console.error('[WhiteboardAutoSaveManager] Listener error:', err);
      }
    });
  }

  // --- Queueing & Auto-saving ---

  public queueUpdate(elementId: string, data: Record<string, any>) {
    if (!this.lessonId) return;

    // Merge changes for this element
    const existing = this.pendingMap.get(elementId) || {};
    this.pendingMap.set(elementId, { ...existing, ...data });

    this.status = 'pending';
    this.notifyListeners();

    // Broadcast pending event
    void frontendEventBus.publish({
      id: uuidv7(),
      type: 'whiteboard.autosave.pending',
      source: 'whiteboard.autosave',
      payload: {
        lessonId: this.lessonId,
        elementId,
        pendingCount: this.pendingMap.size,
      },
      timestamp: Date.now(),
      correlationId: this.lessonId,
    });

    // Reset debounce timer
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      void this.flush();
    }, this.debounceDelay);
  }

  public async flush(): Promise<boolean> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.pendingMap.size === 0 || !this.lessonId || !this.saveHandler) {
      if (this.status === 'pending') {
        this.status = 'saved';
        this.notifyListeners();
      }
      return true;
    }

    if (this.isFlushing) {
      // Re-trigger after current flush finishes
      return false;
    }

    // Run plugin interceptors before saving
    let cancelled = false;
    const context: AutoSaveContext = {
      lessonId: this.lessonId,
      pendingElements: new Map(this.pendingMap),
      cancel: () => {
        cancelled = true;
      },
    };

    for (const interceptor of this.interceptors) {
      try {
        const res = await interceptor(context);
        if (res === false || cancelled) {
          cancelled = true;
          break;
        }
      } catch (e) {
        console.error('[WhiteboardAutoSaveManager] Interceptor error:', e);
      }
    }

    if (cancelled) {
      return false;
    }

    this.isFlushing = true;
    this.status = 'saving';
    this.notifyListeners();

    void frontendEventBus.publish({
      id: uuidv7(),
      type: 'whiteboard.autosave.saving',
      source: 'whiteboard.autosave',
      payload: {
        lessonId: this.lessonId,
        pendingCount: this.pendingMap.size,
      },
      timestamp: Date.now(),
      correlationId: this.lessonId,
    });

    const entriesToSave = Array.from(this.pendingMap.entries());
    const savedElementIds: string[] = [];
    let hasFailure = false;

    try {
      for (const [elementId, elementData] of entriesToSave) {
        const success = await this.saveHandler(this.lessonId, elementId, elementData);
        if (success) {
          savedElementIds.push(elementId);
          // Only remove if not re-modified during await
          if (this.pendingMap.get(elementId) === elementData) {
            this.pendingMap.delete(elementId);
          }
        } else {
          hasFailure = true;
        }
      }

      if (hasFailure) {
        throw new Error('One or more element updates failed to save');
      }

      this.lastSavedTime = new Date();
      this.lastError = null;
      this.status = this.pendingMap.size > 0 ? 'pending' : 'saved';
      this.notifyListeners();

      void frontendEventBus.publish({
        id: uuidv7(),
        type: 'whiteboard.autosave.saved',
        source: 'whiteboard.autosave',
        payload: {
          lessonId: this.lessonId,
          savedElementIds,
          lastSavedTime: this.lastSavedTime.toISOString(),
        },
        timestamp: Date.now(),
        correlationId: this.lessonId,
      });

      return true;
    } catch (err: any) {
      this.lastError = err;
      this.status = 'error';
      this.notifyListeners();

      void frontendEventBus.publish({
        id: uuidv7(),
        type: 'whiteboard.autosave.error',
        source: 'whiteboard.autosave',
        payload: {
          lessonId: this.lessonId,
          error: err?.message || String(err),
        },
        timestamp: Date.now(),
        correlationId: this.lessonId,
      });

      return false;
    } finally {
      this.isFlushing = false;
      // If new changes were queued while flushing, trigger another debounce
      if (this.pendingMap.size > 0 && !this.timer) {
        this.timer = setTimeout(() => {
          void this.flush();
        }, this.debounceDelay);
      }
    }
  }

  public cancel() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pendingMap.clear();
    this.status = this.lessonId ? 'saved' : 'none';
    this.lastError = null;
    this.notifyListeners();
  }
}

// Global host singleton for Whiteboard AutoSave Registry
export const whiteboardAutoSaveRegistry = new WhiteboardAutoSaveManager();
