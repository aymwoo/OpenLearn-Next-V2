/**
 * PlatformContainer — the Platform Dependency Injection Container (PI-008).
 *
 * Infrastructural layer built ON TOP of the Platform Service Registry. It
 * performs dependency resolution only and never bypasses the registry — every
 * registration is mirrored into `PlatformServiceRegistry`, which remains the
 * source of truth for lifetime caching (Singleton / Scoped / Transient).
 *
 * Supported injection features:
 *  - Constructor Injection (recursive dependency resolution)
 *  - Factory Injection (factory receives the active InjectionContext)
 *  - Instance Injection (pre-built singleton)
 *  - Lazy Resolution (inject `Lazy<T>` providers)
 *  - Optional Dependency (inject `undefined` when absent)
 *  - Multiple Implementations (grouped by `contract`, resolved via `resolveAll`)
 *  - Named Services (registered via `registerNamed`, resolved by name)
 *
 * Supported scopes: Application, Request, Session (reserved), Custom.
 */

import { PlatformServiceRegistry } from '../../service-registry/platform-service-registry.js';
import type { ServiceDescriptor, ServiceScopeType } from '../../service-registry/types/index.js';
import { ServiceScope } from '../../service-registry/service-scope.js';
import { InjectionException } from './InjectionException.js';
import { InjectionScope, type Disposable } from './InjectionScope.js';
import { InjectionContext } from './InjectionContext.js';
import { InjectionPolicy } from './InjectionPolicy.js';
import { DependencyResolver, type ResolveFn } from './DependencyResolver.js';
import { DependencyDescriptor, type DependencyDescriptorInit } from './DependencyDescriptor.js';
import {
  mapScopeKind,
  type DependencyDescriptorOptions,
  type GraphValidationReport,
  type InjectionScopeKind,
  type ResolutionDiagnostic,
} from './types.js';

export class PlatformContainer {
  private readonly registry: PlatformServiceRegistry;
  private readonly policy: InjectionPolicy;
  private readonly descriptors = new Map<string, DependencyDescriptor>();
  private readonly contracts = new Map<string, string[]>();
  private readonly named = new Map<string, string>();

  private readonly applicationScope: InjectionScope;
  private readonly scopeRegistry = new Map<string, InjectionScope>();
  private readonly resolver: DependencyResolver;

  private resolutionStack: string[] = [];
  private activeContext: InjectionContext | undefined;

  constructor(registry: PlatformServiceRegistry, policy?: InjectionPolicy) {
    this.registry = registry;
    this.policy = policy ?? InjectionPolicy.default();
    this.applicationScope = new InjectionScope('Application', 'application');
    this.scopeRegistry.set(this.applicationScope.scopeId, this.applicationScope);
    this.resolver = new DependencyResolver({
      resolve: ((id: string, scope?: InjectionScope) =>
        this.resolve(id, scope ?? undefined)) as ResolveFn,
      getDescriptor: (id) => this.descriptors.get(id),
      policy: this.policy,
    });
  }

  // ── Accessors ────────────────────────────────────────────────────────

  get serviceRegistry(): PlatformServiceRegistry {
    return this.registry;
  }

  get injectionPolicy(): InjectionPolicy {
    return this.policy;
  }

  // ── Registration ─────────────────────────────────────────────────────

  register(
    id: string,
    implementation: new (...args: unknown[]) => unknown,
    options?: DependencyDescriptorOptions,
  ): void {
    this.registerDescriptor(
      new DependencyDescriptor({ id, implementation, ...options }),
    );
  }

  registerInstance(id: string, instance: unknown, options?: DependencyDescriptorOptions): void {
    this.registerDescriptor(new DependencyDescriptor({ id, instance, ...options }));
  }

  registerFactory(
    id: string,
    factory: (context: InjectionContext) => unknown,
    options?: DependencyDescriptorOptions,
  ): void {
    this.registerDescriptor(new DependencyDescriptor({ id, factory, ...options }));
  }

  /** Register a named variant of a service instance; resolvable later by `name`. */
  registerNamed(
    name: string,
    id: string,
    instance: unknown,
    options?: DependencyDescriptorOptions,
  ): void {
    this.named.set(name, id);
    this.registerDescriptor(
      new DependencyDescriptor({ id, instance, ...options, named: name }),
    );
  }

  private registerDescriptor(desc: DependencyDescriptor): void {
    // ServiceDescriptor 的所有字段都是 readonly，因此必须在对象字面量中一次性
    // 构造完成，不能事后赋值。
    const serviceDescriptor: ServiceDescriptor =
      desc.instance !== undefined
        ? {
            id: desc.id,
            lifetime: desc.lifetime,
            scope: mapScopeKind(desc.scopeKind) as ServiceScopeType,
            dependencies: desc.dependencies,
            metadata: desc.metadata,
            instance: desc.instance,
          }
        : {
            id: desc.id,
            lifetime: desc.lifetime,
            scope: mapScopeKind(desc.scopeKind) as ServiceScopeType,
            dependencies: desc.dependencies,
            metadata: desc.metadata,
            factory: (scope: ServiceScope) => this.buildInstance(desc, scope),
          };

    this.registry.register(serviceDescriptor);
    this.descriptors.set(desc.id, desc);

    if (desc.contract) {
      const list = this.contracts.get(desc.contract) ?? [];
      list.push(desc.id);
      this.contracts.set(desc.contract, list);
    }
    if (desc.named) this.named.set(desc.named, desc.id);
  }

  // ── Resolution ───────────────────────────────────────────────────────

  resolve<T = unknown>(id: string, scope?: InjectionScope, name?: string): T {
    const targetId = name ? (this.named.get(name) ?? id) : id;
    const injectionScope = scope ?? this.applicationScope;
    const ctx = this.ensureContext(injectionScope);
    const start = Date.now();

    if (this.resolutionStack.includes(targetId)) {
      const path = [...this.resolutionStack, targetId];
      throw new InjectionException(
        `Circular dependency detected: ${path.join(' -> ')}`,
        'CIRCULAR_DEPENDENCY',
        targetId,
        path,
      );
    }

    this.resolutionStack.push(targetId);
    try {
      return this.registry.resolve<T>(targetId, injectionScope.serviceScope);
    } finally {
      this.resolutionStack.pop();
      if (this.policy.enableDiagnostics) {
        ctx.record({
          serviceId: targetId,
          action: 'resolve',
          scope: injectionScope.scopeId,
          cached: false,
          durationMs: Date.now() - start,
        });
      }
      if (this.resolutionStack.length === 0) this.activeContext = undefined;
    }
  }

  tryResolve<T = unknown>(id: string, scope?: InjectionScope, name?: string): T | undefined {
    try {
      return this.resolve<T>(id, scope, name);
    } catch {
      return undefined;
    }
  }

  /** Resolve all implementations of a `contract`, or every registered service. */
  resolveAll(contract?: string): ReadonlyArray<unknown> {
    if (contract) {
      const ids = this.contracts.get(contract) ?? [];
      return ids.map((id) => this.resolve(id));
    }
    return this.registry.resolveAll();
  }

  // ── Scopes ────────────────────────────────────────────────────────────

  createScope(kind: InjectionScopeKind | string = 'Request', scopeId?: string): InjectionScope {
    const scope = new InjectionScope(kind, scopeId);
    this.scopeRegistry.set(scope.scopeId, scope);
    return scope;
  }

  disposeScope(scope: InjectionScope): void {
    if (!this.scopeRegistry.has(scope.scopeId)) {
      throw new InjectionException(
        `Cannot dispose unknown scope '${scope.scopeId}'.`,
        'SCOPE_DISPOSED',
        scope.scopeId,
      );
    }
    scope.dispose();
    this.scopeRegistry.delete(scope.scopeId);
  }

  // ── Validation & diagnostics ──────────────────────────────────────────

  validate(): GraphValidationReport {
    return this.resolver.validateGraph([...this.descriptors.values()]);
  }

  getDiagnostics(): ReadonlyArray<ResolutionDiagnostic> {
    return this.activeContext ? Object.freeze([...this.activeContext.diagnostics]) : Object.freeze([]);
  }

  // ── Internals ────────────────────────────────────────────────────────

  private ensureContext(scope: InjectionScope): InjectionContext {
    if (this.activeContext && this.activeContext.scope === scope) {
      return this.activeContext;
    }
    const ctx = new InjectionContext(scope);
    this.activeContext = ctx;
    return ctx;
  }

  private buildInstance(desc: DependencyDescriptor, scope: ServiceScope): unknown {
    const injectionScope = this.scopeRegistry.get(scope.scopeId) ?? this.applicationScope;

    if (desc.instance !== undefined) return desc.instance;

    if (desc.factory) {
      const ctx = this.ensureContext(injectionScope);
      const instance = desc.factory(ctx);
      this.trackDisposable(injectionScope, instance);
      return instance;
    }

    if (desc.implementation) {
      const args = this.resolver.resolveArguments(desc, injectionScope);
      const instance = new desc.implementation(...args);
      this.trackDisposable(injectionScope, instance);
      return instance;
    }

    throw new InjectionException(
      `No implementation, factory, or instance provided for '${desc.id}'.`,
      'INVALID_DESCRIPTOR',
      desc.id,
    );
  }

  private trackDisposable(scope: InjectionScope, instance: unknown): void {
    if (instance && typeof (instance as Disposable).dispose === 'function') {
      scope.registerDisposable(instance as Disposable);
    }
  }
}
