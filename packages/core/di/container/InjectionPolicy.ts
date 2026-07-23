/**
 * InjectionPolicy — tunable behaviour for the DI container.
 *
 * Encapsulates the decisions that would otherwise be scattered across the
 * resolver: whether a missing required dependency is fatal, whether optional
 * dependencies are honoured, whether circular dependencies are tolerated, the
 * default lifetime, and whether to collect resolution diagnostics.
 */

import type { ServiceLifetime } from '../../service-registry/types/index.js';

export interface InjectionPolicyOptions {
  throwOnMissingDependency?: boolean;
  allowOptionalDependencies?: boolean;
  allowCircularDependencies?: boolean;
  defaultLifetime?: ServiceLifetime;
  enableDiagnostics?: boolean;
}

export class InjectionPolicy {
  public throwOnMissingDependency: boolean;
  public allowOptionalDependencies: boolean;
  public allowCircularDependencies: boolean;
  public defaultLifetime: ServiceLifetime;
  public enableDiagnostics: boolean;

  constructor(options: InjectionPolicyOptions = {}) {
    this.throwOnMissingDependency = options.throwOnMissingDependency ?? true;
    this.allowOptionalDependencies = options.allowOptionalDependencies ?? true;
    this.allowCircularDependencies = options.allowCircularDependencies ?? false;
    this.defaultLifetime = options.defaultLifetime ?? 'Singleton';
    this.enableDiagnostics = options.enableDiagnostics ?? true;
  }

  static default(): InjectionPolicy {
    return new InjectionPolicy();
  }
}
