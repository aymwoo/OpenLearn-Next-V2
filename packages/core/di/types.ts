/**
 * Shared type definitions for the DI container.
 */

/**
 * Registration options for a service instance.
 *
 * - `requires`: Token names of mandatory dependencies.
 * - `optional`: Token names of optional dependencies (reserved for Phase 1,
 *   not enforced in the current phase — see D-14).
 */
export interface RegisterOptions {
  requires?: string[];
  optional?: string[];
}

/**
 * A single entry in the service registry.
 */
export interface ServiceEntry {
  instance: unknown;
  options: RegisterOptions;
  /** 语义化版本号（semver），如 '1.0.0'。由 ServiceRegistry.register() 自动从 Token 读取。 */
  version: string;
}

/**
 * A directed edge in the dependency graph.
 *
 * - `requires`: Token names this service depends on.
 * - `dependents`: Token names that depend on this service.
 */
export interface DepEdge {
  requires: Set<string>;
  dependents: Set<string>;
}
