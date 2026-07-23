/**
 * OpenLearn Platform Service Registry - ServiceScope (PI-007)
 */

export class ServiceScope {
  public readonly scopeId: string;
  private instances = new Map<string, unknown>();

  constructor(scopeId?: string) {
    this.scopeId = scopeId || `scope_${globalThis.crypto.randomUUID()}`;
  }

  public get<T>(serviceId: string): T | undefined {
    return this.instances.get(serviceId) as T | undefined;
  }

  public set<T>(serviceId: string, instance: T): void {
    this.instances.set(serviceId, instance);
  }

  public has(serviceId: string): boolean {
    return this.instances.has(serviceId);
  }

  public dispose(): void {
    this.instances.clear();
  }
}
