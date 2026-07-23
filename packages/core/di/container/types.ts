/**
 * Shared type definitions for the Platform Dependency Injection Container (PI-008).
 *
 * Reuses the lifetime definitions from the Platform Service Registry
 * (`ServiceLifetime`) so the container never redefines lifetime enums.
 */

import type { ServiceLifetime, ServiceScopeType } from '../../service-registry/types/index.js';

export type { ServiceLifetime, ServiceScopeType };

/**
 * Container-level scope taxonomy.
 *
 * Mapped onto the registry's `ServiceScopeType` by `mapScopeKind` purely for
 * metadata — the actual lifetime behaviour is driven by `ServiceLifetime`.
 */
export type InjectionScopeKind = 'Application' | 'Request' | 'Session' | 'Custom';

export interface DependencyDescriptorOptions {
  lifetime?: ServiceLifetime;
  scopeKind?: InjectionScopeKind | string;
  dependencies?: ReadonlyArray<string>;
  optional?: ReadonlyArray<string>;
  lazy?: boolean;
  named?: string;
  contract?: string;
  metadata?: Readonly<Record<string, unknown>>;
}

/**
 * A lazy reference to a dependency. The wrapped resolver is only invoked the
 * first time `.value` is accessed, enabling on-demand construction and breaking
 * eager cycles.
 */
export class Lazy<T> {
  private resolved = false;
  private resolvedValue?: T;

  constructor(private readonly resolver: () => T) {}

  get isResolved(): boolean {
    return this.resolved;
  }

  get value(): T {
    if (!this.resolved) {
      this.resolvedValue = this.resolver();
      this.resolved = true;
    }
    return this.resolvedValue as T;
  }

  /** Force resolution and return the value (alias of `.value`). */
  resolve(): T {
    return this.value;
  }
}

export interface ResolutionDiagnostic {
  serviceId: string;
  action: string;
  scope: string;
  cached: boolean;
  durationMs: number;
}

export interface GraphValidationError {
  code: 'CIRCULAR_DEPENDENCY' | 'MISSING_DEPENDENCY' | 'AMBIGUOUS_DEPENDENCY';
  message: string;
  serviceId?: string;
}

export interface GraphValidationReport {
  isValid: boolean;
  errors: ReadonlyArray<GraphValidationError>;
  validatedCount: number;
}

/**
 * Map a container scope kind to the registry's `ServiceScopeType`.
 * The mapping is metadata-only; caching is governed by `ServiceLifetime`.
 */
export function mapScopeKind(kind: InjectionScopeKind | string): ServiceScopeType {
  switch (kind) {
    case 'Application':
      return 'Singleton';
    case 'Request':
      return 'Scoped';
    case 'Session':
      return 'Session';
    case 'Custom':
      return 'Scoped';
    default:
      return 'Scoped';
  }
}
