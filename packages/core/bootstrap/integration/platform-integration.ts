/**
 * OpenLearn Platform Kernel - Platform Integration Layer Facade (PI-007)
 */

import {
  IIntegrationAdapter,
  IIntegrationRegistry,
  IntegrationContext,
  IntegrationResult,
  IntegrationHealthStatus,
} from './integration-types.js';

export class PlatformIntegration implements IIntegrationRegistry {
  private adapters = new Map<string, IIntegrationAdapter>();

  public register(adapter: IIntegrationAdapter): void {
    if (this.adapters.has(adapter.id)) {
      throw new Error(`Integration Adapter Collision: Adapter '${adapter.id}' is already registered.`);
    }
    this.adapters.set(adapter.id, adapter);
  }

  public get(id: string): IIntegrationAdapter | undefined {
    return this.adapters.get(id);
  }

  public has(id: string): boolean {
    return this.adapters.has(id);
  }

  public list(): ReadonlyArray<IIntegrationAdapter> {
    return Object.freeze(Array.from(this.adapters.values()));
  }

  public async initializeAll(context: IntegrationContext): Promise<ReadonlyArray<IntegrationResult>> {
    const results: IntegrationResult[] = [];
    for (const adapter of this.adapters.values()) {
      const startTime = Date.now();
      try {
        await adapter.initialize(context);
        const health = await adapter.health();
        results.push({
          id: adapter.id,
          status: 'Success',
          durationMs: Date.now() - startTime,
          health,
        });
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err));
        results.push({
          id: adapter.id,
          status: 'Failed',
          durationMs: Date.now() - startTime,
          health: { isHealthy: false, details: { error: error.message } },
          error,
        });
      }
    }
    return Object.freeze(results);
  }

  public async activateAll(): Promise<void> {
    for (const adapter of this.adapters.values()) {
      await adapter.activate();
    }
  }

  public async deactivateAll(): Promise<void> {
    for (const adapter of this.adapters.values()) {
      await adapter.deactivate();
    }
  }

  public async disposeAll(): Promise<void> {
    for (const adapter of this.adapters.values()) {
      await adapter.dispose();
    }
    this.adapters.clear();
  }
}
