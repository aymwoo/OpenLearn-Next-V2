/**
 * DependencyDescriptor — the container's internal record for a registered
 * service. It captures everything the resolver needs to construct an instance:
 * the implementation class, factory, or pre-built instance, plus the
 * constructor dependency ids, optional/lazy flags, named/contract grouping,
 * and metadata.
 *
 * The Platform Service Registry remains the source of truth for registration;
 * this descriptor is the DI layer's view, kept in sync on every `register`.
 */

import type { ServiceLifetime } from '../../service-registry/types/index.js';
import type { InjectionContext } from './InjectionContext.js';
import type { InjectionScopeKind } from './types.js';

export interface DependencyDescriptorInit {
  id: string;
  lifetime?: ServiceLifetime;
  scopeKind?: InjectionScopeKind | string;
  implementation?: new (...args: unknown[]) => unknown;
  factory?: (context: InjectionContext) => unknown;
  instance?: unknown;
  dependencies?: ReadonlyArray<string>;
  optional?: ReadonlyArray<string>;
  lazy?: boolean;
  named?: string;
  contract?: string;
  metadata?: Readonly<Record<string, unknown>>;
}

export interface IDependencyDescriptor {
  readonly id: string;
  readonly lifetime: ServiceLifetime;
  readonly scopeKind: InjectionScopeKind | string;
  readonly implementation?: new (...args: unknown[]) => unknown;
  readonly factory?: (context: InjectionContext) => unknown;
  readonly instance?: unknown;
  readonly dependencies: ReadonlyArray<string>;
  readonly optional: ReadonlyArray<string>;
  readonly lazy: boolean;
  readonly named?: string;
  readonly contract?: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export class DependencyDescriptor implements IDependencyDescriptor {
  public readonly id: string;
  public readonly lifetime: ServiceLifetime;
  public readonly scopeKind: InjectionScopeKind | string;
  public readonly implementation?: new (...args: unknown[]) => unknown;
  public readonly factory?: (context: InjectionContext) => unknown;
  public readonly instance?: unknown;
  public readonly dependencies: ReadonlyArray<string>;
  public readonly optional: ReadonlyArray<string>;
  public readonly lazy: boolean;
  public readonly named?: string;
  public readonly contract?: string;
  public readonly metadata: Readonly<Record<string, unknown>>;

  constructor(init: DependencyDescriptorInit) {
    if (!init.id || typeof init.id !== 'string') {
      throw new Error('DependencyDescriptor requires a non-empty string `id`.');
    }
    if (!init.implementation && !init.factory && init.instance === undefined) {
      throw new Error(
        `DependencyDescriptor '${init.id}' requires an implementation, factory, or instance.`,
      );
    }
    this.id = init.id;
    this.lifetime = init.lifetime ?? 'Singleton';
    this.scopeKind = init.scopeKind ?? 'Application';
    this.implementation = init.implementation;
    this.factory = init.factory;
    this.instance = init.instance;
    this.dependencies = init.dependencies ?? [];
    this.optional = init.optional ?? [];
    this.lazy = init.lazy ?? false;
    this.named = init.named;
    this.contract = init.contract;
    this.metadata = init.metadata ?? {};
  }
}
