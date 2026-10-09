/**
 * HostActionDispatcher — Bidirectional Controlled Action Dispatcher
 *
 * Implements IHostActionDispatcher, connecting frontend plugins to host services:
 * - Data refresh protocol (host:refresh)
 * - Controlled modal & confirmation dialog protocol (host:modal:confirm / host:modal:open / host:modal:close)
 * - Toast feedback protocol (host:toast)
 * - Navigation protocol (host:navigate)
 * - Extensible middleware pipeline & passive event observers
 */

import { appStore } from '../store/appStore';
import type {
  HostAction,
  ActionEnvelope,
  ActionHandler,
  ActionMiddleware,
  IHostActionDispatcher,
  Disposable,
  DispatchOptions,
  HostRefreshPayload,
  HostRefreshResult,
  HostModalConfirmPayload,
  HostModalConfirmResult,
  HostModalOpenPayload,
  HostModalOpenResult,
  HostModalClosePayload,
  HostToastPayload,
  HostToastResult,
  HostNavigatePayload,
  HostNavigateResult,
} from './types';

export interface ActiveModalState {
  id: string;
  type: 'confirm' | 'open';
  title: string;
  message?: string;
  content?: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: 'primary' | 'danger' | 'warning';
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  showCloseButton?: boolean;
  closableByBackdrop?: boolean;
  actions?: Array<{
    actionId: string;
    label: string;
    variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
    isClose?: boolean;
  }>;
  resolve: (result: any) => void;
  sourcePluginId?: string;
  createdAt: number;
}

export class HostActionDispatcher implements IHostActionDispatcher {
  private handlers = new Map<string, Set<ActionHandler<any, any>>>();
  private subscribers = new Map<string, Set<(envelope: ActionEnvelope<any>, result?: any, error?: Error) => void>>();
  private middlewares: ActionMiddleware[] = [];
  private activeModals: ActiveModalState[] = [];
  private modalListeners = new Set<(modals: ActiveModalState[]) => void>();

  constructor() {
    this.registerBuiltinHandlers();
  }

  // ── Dispatch Implementation ──────────────────────────────────────────────

  async dispatch<TResult = any>(action: HostAction, options?: DispatchOptions): Promise<TResult> {
    const correlationId = 'act_' + Math.random().toString(36).slice(2, 10);
    const envelope: ActionEnvelope = {
      action,
      sourcePluginId: options?.sourcePluginId,
      timestamp: Date.now(),
      correlationId,
    };

    const executeCore = async (): Promise<TResult> => {
      const typeHandlers = this.handlers.get(action.type);
      if (typeHandlers && typeHandlers.size > 0) {
        // Execute all registered handlers (composite execution)
        const handlerList = Array.from(typeHandlers);
        if (handlerList.length === 1) {
          return await handlerList[0](envelope);
        }
        const results = await Promise.all(handlerList.map((h) => h(envelope)));
        // If results are objects with arrays (like refreshed: [...]), merge them
        if (action.type === 'host:refresh') {
          const mergedRefreshed = new Set<string>();
          for (const res of results) {
            if (res && Array.isArray(res.refreshed)) {
              res.refreshed.forEach((item: string) => mergedRefreshed.add(item));
            }
          }
          return { success: true, refreshed: Array.from(mergedRefreshed) } as any;
        }
        return results[results.length - 1];
      }

      // Fallback: If no handler registered for custom type, return undefined
      return undefined as any;
    };

    const runPipeline = async (): Promise<TResult> => {
      let index = -1;
      const dispatchNext = async (i: number): Promise<any> => {
        if (i <= index) throw new Error('next() called multiple times in middleware');
        index = i;
        if (i < this.middlewares.length) {
          const mw = this.middlewares[i];
          return mw(envelope, () => dispatchNext(i + 1));
        }
        return executeCore();
      };
      return dispatchNext(0);
    };

    let executionPromise = runPipeline();

    if (options?.timeoutMs && options.timeoutMs > 0) {
      let timer: any;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`Action "${action.type}" timed out after ${options.timeoutMs}ms`));
        }, options.timeoutMs);
      });
      executionPromise = Promise.race([executionPromise, timeoutPromise]).finally(() => {
        clearTimeout(timer);
      }) as Promise<TResult>;
    }

    try {
      const result = await executionPromise;
      this.notifySubscribers(envelope, result, undefined);
      return result;
    } catch (err: any) {
      this.notifySubscribers(envelope, undefined, err);
      throw err;
    }
  }

  // ── Handler Registration ─────────────────────────────────────────────────

  registerHandler<TAction extends HostAction = HostAction, TResult = any>(
    type: TAction['type'],
    handler: ActionHandler<TAction, TResult>,
  ): Disposable {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    const set = this.handlers.get(type)!;
    set.add(handler as any);

    return {
      dispose: () => {
        set.delete(handler as any);
        if (set.size === 0) {
          this.handlers.delete(type);
        }
      },
    };
  }

  // ── Passive Subscription ─────────────────────────────────────────────────

  subscribe<TAction extends HostAction = HostAction>(
    type: TAction['type'] | '*',
    listener: (envelope: ActionEnvelope<TAction>, result?: any, error?: Error) => void,
  ): Disposable {
    if (!this.subscribers.has(type)) {
      this.subscribers.set(type, new Set());
    }
    const set = this.subscribers.get(type)!;
    set.add(listener as any);

    return {
      dispose: () => {
        set.delete(listener as any);
        if (set.size === 0) {
          this.subscribers.delete(type);
        }
      },
    };
  }

  // ── Middleware Pipeline ──────────────────────────────────────────────────

  use(middleware: ActionMiddleware): Disposable {
    this.middlewares.push(middleware);
    return {
      dispose: () => {
        const idx = this.middlewares.indexOf(middleware);
        if (idx !== -1) {
          this.middlewares.splice(idx, 1);
        }
      },
    };
  }

  // ── Modal State & UI Interactivity ───────────────────────────────────────

  getActiveModals(): ActiveModalState[] {
    return [...this.activeModals];
  }

  subscribeModals(listener: (modals: ActiveModalState[]) => void): Disposable {
    this.modalListeners.add(listener);
    listener(this.getActiveModals());
    return {
      dispose: () => {
        this.modalListeners.delete(listener);
      },
    };
  }

  resolveModal(id: string, result: any): void {
    const idx = this.activeModals.findIndex((m) => m.id === id);
    if (idx !== -1) {
      const [modal] = this.activeModals.splice(idx, 1);
      modal.resolve(result);
      this.notifyModalListeners();
    }
  }

  closeAllModals(): void {
    while (this.activeModals.length > 0) {
      const modal = this.activeModals.pop()!;
      modal.resolve({ closed: true, confirmed: false });
    }
    this.notifyModalListeners();
  }

  private notifyModalListeners(): void {
    const snapshot = this.getActiveModals();
    this.modalListeners.forEach((l) => {
      try {
        l(snapshot);
      } catch (err) {
        console.error('[HostActionDispatcher] Error notifying modal listener:', err);
      }
    });
  }

  // ── Scoped Dispatcher Factory ────────────────────────────────────────────

  createScopedDispatcher(sourcePluginId: string): IHostActionDispatcher {
    return {
      dispatch: (action, options) => {
        return this.dispatch(action, {
          sourcePluginId,
          ...options,
        });
      },
      registerHandler: (type, handler) => this.registerHandler(type, handler),
      subscribe: (type, listener) => this.subscribe(type, listener),
      use: (mw) => this.use(mw),
    };
  }

  // ── Built-in Handlers ────────────────────────────────────────────────────

  private registerBuiltinHandlers(): void {
    // 1. host:refresh built-in default handler
    this.registerHandler('host:refresh', async (envelope) => {
      const payload = envelope.action.payload as HostRefreshPayload;
      const target = payload.target;
      const refreshed: string[] = [];

      try {
        const state = appStore.getState();
        if (target === 'classes' || target === 'all') {
          if (typeof state.loadClasses === 'function') {
            await state.loadClasses();
            refreshed.push('classes');
          }
        }
        if (target === 'lessons' || target === 'all') {
          if (typeof state.loadLessons === 'function') {
            await state.loadLessons();
            refreshed.push('lessons');
          }
        }
        if (target === 'students' || target === 'all') {
          if (typeof state.loadStudents === 'function') {
            await state.loadStudents();
            refreshed.push('students');
          }
        }
      } catch (err) {
        console.warn('[HostActionDispatcher] Builtin refresh failed:', err);
      }

      const result: HostRefreshResult = {
        success: true,
        refreshed,
      };
      return result;
    });

    // 2. host:modal:confirm built-in handler
    this.registerHandler('host:modal:confirm', (envelope) => {
      const payload = envelope.action.payload as HostModalConfirmPayload;
      const id = payload.id || 'modal_confirm_' + Math.random().toString(36).slice(2, 9);

      return new Promise<HostModalConfirmResult>((resolve) => {
        const modalState: ActiveModalState = {
          id,
          type: 'confirm',
          title: payload.title,
          message: payload.message,
          confirmText: payload.confirmText,
          cancelText: payload.cancelText,
          variant: payload.variant || 'primary',
          sourcePluginId: envelope.sourcePluginId,
          createdAt: Date.now(),
          resolve: (res) => {
            const confirmed = typeof res?.confirmed === 'boolean' ? res.confirmed : false;
            resolve({ confirmed });
          },
        };
        this.activeModals.push(modalState);
        this.notifyModalListeners();
      });
    });

    // 3. host:modal:open built-in handler
    this.registerHandler('host:modal:open', (envelope) => {
      const payload = envelope.action.payload as HostModalOpenPayload;
      const id = payload.id || 'modal_open_' + Math.random().toString(36).slice(2, 9);

      return new Promise<HostModalOpenResult>((resolve) => {
        const modalState: ActiveModalState = {
          id,
          type: 'open',
          title: payload.title,
          content: payload.content,
          size: payload.size || 'md',
          showCloseButton: payload.showCloseButton !== false,
          closableByBackdrop: payload.closableByBackdrop !== false,
          actions: payload.actions,
          sourcePluginId: envelope.sourcePluginId,
          createdAt: Date.now(),
          resolve: (res) => {
            resolve({
              actionId: res?.actionId,
              closed: res?.closed ?? true,
            });
          },
        };
        this.activeModals.push(modalState);
        this.notifyModalListeners();
      });
    });

    // 4. host:modal:close built-in handler
    this.registerHandler('host:modal:close', (envelope) => {
      const payload = envelope.action.payload as HostModalClosePayload;
      if (payload.id) {
        this.resolveModal(payload.id, payload.result ?? { closed: true });
      } else if (this.activeModals.length > 0) {
        // Close topmost modal
        const top = this.activeModals[this.activeModals.length - 1];
        this.resolveModal(top.id, payload.result ?? { closed: true });
      }
      return { closed: true };
    });

    // 5. host:toast built-in handler
    this.registerHandler('host:toast', (envelope) => {
      const payload = envelope.action.payload as HostToastPayload;
      const id = 'toast_' + Math.random().toString(36).slice(2, 9);
      try {
        appStore.getState().addToast({
          id,
          title: payload.title,
          message: payload.message,
          type: payload.type || 'info',
        });
      } catch (err) {
        console.warn('[HostActionDispatcher] Failed to add toast:', err);
      }
      const result: HostToastResult = { delivered: true };
      return result;
    });

    // 6. host:navigate built-in handler
    this.registerHandler('host:navigate', (envelope) => {
      const payload = envelope.action.payload as HostNavigatePayload;
      try {
        appStore.getState().setTeacherTab(payload.tab);
      } catch (err) {
        console.warn('[HostActionDispatcher] Failed to navigate:', err);
      }
      const result: HostNavigateResult = { navigated: true };
      return result;
    });
  }

  private notifySubscribers(envelope: ActionEnvelope, result?: any, error?: Error): void {
    const notifyList = (set?: Set<(envelope: ActionEnvelope, result?: any, error?: Error) => void>) => {
      if (!set) return;
      set.forEach((listener) => {
        try {
          listener(envelope, result, error);
        } catch (err) {
          console.error('[HostActionDispatcher] Subscriber threw error:', err);
        }
      });
    };

    notifyList(this.subscribers.get(envelope.action.type));
    notifyList(this.subscribers.get('*'));
  }
}

/** Default singleton instance */
export const defaultHostActionDispatcher = new HostActionDispatcher();
