/**
 * DependencyResolver — recursive dependency resolution and graph validation.
 *
 * Responsibilities:
 *  - Build the constructor argument list for a descriptor, honouring
 *    lazy (inject `Lazy<T>`), optional (inject `undefined` when absent), and
 *    multiple/named grouping.
 *  - Validate the whole registration graph: detect circular dependencies and
 *    missing dependencies, and report them without throwing.
 *
 * It does not own any instance state; it delegates actual resolution back to
 * the container via injected callbacks, keeping it a pure coordination layer.
 */

import { InjectionException } from './InjectionException.js';
import { Lazy } from './types.js';
import type { DependencyDescriptor } from './DependencyDescriptor.js';
import type { InjectionScope } from './InjectionScope.js';
import type { InjectionPolicy } from './InjectionPolicy.js';
import type { GraphValidationReport, GraphValidationError } from './types.js';

export type ResolveFn = (id: string, scope?: InjectionScope) => unknown;

export interface DependencyResolverDeps {
  resolve: ResolveFn;
  getDescriptor: (id: string) => DependencyDescriptor | undefined;
  policy: InjectionPolicy;
}

export class DependencyResolver {
  private readonly resolveFn: ResolveFn;
  private readonly getDescriptor: (id: string) => DependencyDescriptor | undefined;
  private readonly policy: InjectionPolicy;

  constructor(deps: DependencyResolverDeps) {
    this.resolveFn = deps.resolve;
    this.getDescriptor = deps.getDescriptor;
    this.policy = deps.policy;
  }

  /** Resolve constructor arguments for `desc` within `scope`. */
  resolveArguments(desc: DependencyDescriptor, scope: InjectionScope): unknown[] {
    return desc.dependencies.map((depId) => this.resolveArgument(desc, depId, scope));
  }

  private resolveArgument(
    dependent: DependencyDescriptor,
    depId: string,
    scope: InjectionScope,
  ): unknown {
    const isOptional = dependent.optional.includes(depId);
    const isLazy = dependent.lazy;

    if (isLazy) {
      return new Lazy(() => this.resolveFn(depId, scope) as unknown);
    }

    if (isOptional) {
      try {
        return this.resolveFn(depId, scope);
      } catch {
        return undefined;
      }
    }

    const depDesc = this.getDescriptor(depId);
    if (!depDesc) {
      if (this.policy.throwOnMissingDependency) {
        throw new InjectionException(
          `Missing dependency '${depId}' required by '${dependent.id}'.`,
          'MISSING_DEPENDENCY',
          depId,
          dependent.dependencies as string[],
        );
      }
      return undefined;
    }

    return this.resolveFn(depId, scope);
  }

  /** Validate the full dependency graph across all descriptors. */
  validateGraph(descriptors: ReadonlyArray<DependencyDescriptor>): GraphValidationReport {
    const byId = new Map(descriptors.map((d) => [d.id, d] as const));
    const errors: GraphValidationError[] = [];
    const visited = new Set<string>();
    const stack = new Set<string>();

    const visit = (id: string, path: string[]): void => {
      if (stack.has(id)) {
        errors.push({
          code: 'CIRCULAR_DEPENDENCY',
          message: `Circular dependency detected: ${[...path, id].join(' -> ')}`,
          serviceId: id,
        });
        return;
      }
      if (visited.has(id)) return;
      visited.add(id);
      stack.add(id);

      const desc = byId.get(id);
      if (desc) {
        for (const dep of desc.dependencies) {
          if (!byId.has(dep)) {
            errors.push({
              code: 'MISSING_DEPENDENCY',
              message: `Missing dependency '${dep}' for capability/service '${id}'.`,
              serviceId: dep,
            });
          } else {
            visit(dep, [...path, id]);
          }
        }
      }
      stack.delete(id);
    };

    for (const d of descriptors) visit(d.id, []);

    return {
      isValid: errors.length === 0,
      errors: Object.freeze(errors),
      validatedCount: descriptors.length,
    };
  }
}
