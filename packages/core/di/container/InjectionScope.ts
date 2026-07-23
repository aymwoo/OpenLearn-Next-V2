/**
 * InjectionScope — a runtime resolution scope for the DI container.
 *
 * Wraps the registry `ServiceScope` (used for scoped-lifetime caching inside
 * the Platform Service Registry) and additionally tracks disposables so that
 * `disposeScope()` can release scoped instances that implement `dispose()`.
 */

import { ServiceScope } from '../../service-registry/service-scope.js';
import { v7 as uuidv7 } from 'uuid';
import type { InjectionScopeKind } from './types.js';

export interface Disposable {
  dispose(): void;
}

export class InjectionScope {
  public readonly scopeKind: InjectionScopeKind | string;
  public readonly scopeId: string;
  public readonly createdAt: number;
  public readonly serviceScope: ServiceScope;

  private readonly store = new Map<string, unknown>();
  private readonly disposables: Disposable[] = [];

  constructor(scopeKind: InjectionScopeKind | string, scopeId?: string) {
    this.scopeKind = scopeKind;
    this.scopeId = scopeId ?? `scope_${uuidv7()}`;
    this.createdAt = Date.now();
    this.serviceScope = new ServiceScope(this.scopeId);
  }

  get<T>(id: string): T | undefined {
    return this.store.get(id) as T | undefined;
  }

  set<T>(id: string, instance: T): void {
    this.store.set(id, instance);
  }

  has(id: string): boolean {
    return this.store.has(id);
  }

  /** Register an instance for disposal when the scope is disposed. */
  registerDisposable(disposable: Disposable): void {
    this.disposables.push(disposable);
  }

  /**
   * Dispose all tracked instances, clear the local store, and release the
   * underlying registry scope. Errors during individual disposal are swallowed
   * so one faulty instance cannot block the rest of the teardown.
   */
  dispose(): void {
    for (const disposable of this.disposables) {
      try {
        disposable.dispose();
      } catch {
        /* swallow disposal errors */
      }
    }
    this.disposables.length = 0;
    this.store.clear();
    this.serviceScope.dispose();
  }
}
