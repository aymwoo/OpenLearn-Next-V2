/**
 * OpenLearn Classroom Runtime - Module Registry Subsystem
 * Decoupled module manager allowing external module registration without modifying Runtime code.
 */

import { IRuntimeModule, RuntimeContextData } from './types.js';

export class RuntimeModuleRegistry {
  private modules = new Map<string, IRuntimeModule>();
  private activeModuleIds = new Set<string>();

  /**
   * Register a new module.
   */
  public registerModule(module: IRuntimeModule): void {
    if (!module.id) {
      throw new Error('[RuntimeModuleRegistry] Module must specify a valid id.');
    }
    this.modules.set(module.id, module);
  }

  /**
   * Unregister a module by ID.
   */
  public async unregisterModule(moduleId: string, context?: RuntimeContextData): Promise<boolean> {
    const mod = this.modules.get(moduleId);
    if (mod) {
      if (this.activeModuleIds.has(moduleId) && context) {
        await mod.stop(context);
        this.activeModuleIds.delete(moduleId);
      }
      await mod.dispose();
      return this.modules.delete(moduleId);
    }
    return false;
  }

  /**
   * Get a registered module by ID.
   */
  public getModule(moduleId: string): IRuntimeModule | undefined {
    return this.modules.get(moduleId);
  }

  /**
   * List all registered modules.
   */
  public listModules(): ReadonlyArray<IRuntimeModule> {
    return Object.freeze(Array.from(this.modules.values()));
  }

  /**
   * Start all registered modules.
   */
  public async startAll(context: RuntimeContextData): Promise<void> {
    for (const mod of this.modules.values()) {
      await mod.initialize(context);
      await mod.start(context);
      this.activeModuleIds.add(mod.id);
    }
  }

  /**
   * Stop all active modules.
   */
  public async stopAll(context: RuntimeContextData): Promise<void> {
    for (const modId of this.activeModuleIds) {
      const mod = this.modules.get(modId);
      if (mod) {
        try {
          await mod.stop(context);
        } catch (err: unknown) {
          console.error(`[RuntimeModuleRegistry] Error stopping module ${modId}:`, err);
        }
      }
    }
    this.activeModuleIds.clear();
  }
}
