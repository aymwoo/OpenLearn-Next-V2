/**
 * OpenLearn Classroom Runtime - Hooks System
 * Extension hooks allowing plugins and modules to intercept runtime lifecycle and events.
 */

import { RuntimeHookName, RuntimeHookCallback, RuntimeContextData } from './types.js';

export class RuntimeHooksManager {
  private hooks = new Map<RuntimeHookName, Set<RuntimeHookCallback<any>>>();

  /**
   * Register a callback for a specific runtime hook.
   */
  public registerHook<T = Record<string, unknown>>(
    hookName: RuntimeHookName,
    callback: RuntimeHookCallback<T>,
  ): () => void {
    if (!this.hooks.has(hookName)) {
      this.hooks.set(hookName, new Set());
    }
    const callbacks = this.hooks.get(hookName)!;
    callbacks.add(callback);

    return () => {
      callbacks.delete(callback);
    };
  }

  /**
   * Execute all callbacks registered for a hook.
   */
  public async executeHook<T = Record<string, unknown>>(
    hookName: RuntimeHookName,
    payload: T,
    context: RuntimeContextData,
  ): Promise<void> {
    const callbacks = this.hooks.get(hookName);
    if (!callbacks || callbacks.size === 0) return;

    for (const callback of callbacks) {
      try {
        await callback(payload, context);
      } catch (err: unknown) {
        console.error(`[RuntimeHooksManager] Error executing hook "${hookName}":`, err);
      }
    }
  }

  /**
   * 返回当前已注册的 hook 名称与回调数量（只读，不暴露回调本身）。
   */
  public listHooks(): ReadonlyArray<{ name: RuntimeHookName; count: number }> {
    return Array.from(this.hooks.entries()).map(([name, callbacks]) => ({
      name,
      count: callbacks.size,
    }));
  }

  /**
   * Clear all registered hooks.
   */
  public clear(): void {
    this.hooks.clear();
  }
}
