/**
 * InjectionContext — carries state for a single top-level resolution chain.
 *
 * Holds the active `InjectionScope` and accumulates resolution diagnostics
 * (which service was resolved, via which action, how long it took). The
 * resolution stack itself lives on the container; this context is the
 * per-call observation surface used for diagnostics and reporting.
 */

import type { InjectionScope } from './InjectionScope.js';
import type { ResolutionDiagnostic } from './types.js';

export class InjectionContext {
  public readonly scope: InjectionScope;
  public readonly diagnostics: ResolutionDiagnostic[] = [];

  constructor(scope: InjectionScope) {
    this.scope = scope;
  }

  record(diagnostic: ResolutionDiagnostic): void {
    this.diagnostics.push(diagnostic);
  }
}
