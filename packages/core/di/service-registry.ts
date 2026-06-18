/**
 * ServiceRegistry — the DI container core engine.
 *
 * Provides register / resolve / unregister / registerOrReplace lifecycle
 * with Kahn-algorithm-based topological sorting for cycle detection and
 * a full introspection API (list, has, dependencies).
 *
 * ## Internal data structures
 *
 * - `registry`: Map<tokenName, ServiceEntry> — token name → instance + options
 * - `depGraph`: Map<tokenName, DepEdge> — token name → { requires, dependents }
 *
 * ## Design decisions (from CONTEXT.md)
 *
 * - D-04: Full generic inference — `resolve(token)` returns `T`
 * - D-05: Async signatures reserved for Phase 5 RPC proxy
 * - D-06: Register-time dependency validation (fail-fast)
 * - D-07: Named Error subclasses for all error paths
 * - D-08: Duplicate registration throws; registerOrReplace for explicit overwrite
 * - D-09: Cascade-prevention on unregister (HasDependentError)
 * - D-10: Full introspection API (list / has / dependencies)
 * - D-14: Pure DI, no lifecycle logic in Phase 1
 */
import type { RegisterOptions, ServiceEntry, DepEdge } from './types.js';
import { Token } from './token.js';
import {
  DuplicateRegistrationError,
  MissingDependencyError,
  CircularDependencyError,
  HasDependentError,
} from './errors.js';

export class ServiceRegistry {
  // -----------------------------------------------------------------------
  // Internal state
  // -----------------------------------------------------------------------

  /** Token name → service instance + registration options. */
  private registry = new Map<string, ServiceEntry>();

  /** Token name → dependency edge (requires / dependents). */
  private depGraph = new Map<string, DepEdge>();

  // -----------------------------------------------------------------------
  // Public API — lifecycle
  // -----------------------------------------------------------------------

  /**
   * Register a service instance with the DI container.
   *
   * - Throws `DuplicateRegistrationError` if the token is already registered
   * - Throws `MissingDependencyError` if any required dependency is missing
   * - Updates the dependency graph bidirectionally on success
   */
  async register<T>(
    token: Token<T>,
    instance: T,
    options?: RegisterOptions
  ): Promise<void> {
    const name = token.name;

    // D-08: duplicate registration
    if (this.registry.has(name)) {
      throw new DuplicateRegistrationError(name);
    }

    // Normalise requires to a deduplicated Set (Pitfall 2: duplicate edges)
    const requires = new Set(options?.requires ?? []);
    const optional = new Set(options?.optional ?? []);

    // D-06: register-time dependency validation
    const missingDeps: string[] = [];
    for (const req of requires) {
      // Skip if already in the registry
      if (!this.registry.has(req)) {
        missingDeps.push(req);
      }
    }
    if (missingDeps.length > 0) {
      throw new MissingDependencyError(name, missingDeps);
    }

    // Store the entry (Phase 6: store version from Token)
    this.registry.set(name, { instance, options: options ?? {}, version: token.version });

    // Build / extend dependency graph
    const edge: DepEdge = { requires, dependents: new Set() };
    this.depGraph.set(name, edge);

    // For each required dependency, add this token as a dependent (reverse edge)
    for (const req of requires) {
      const reqEdge = this.depGraph.get(req);
      if (reqEdge) {
        reqEdge.dependents.add(name);
      }
    }
  }

  /**
   * Resolve a registered service instance by its Token.
   *
   * Phase 1: simple direct lookup (no lazy instantiation).
   * Throws a plain Error when the token is not registered (SC-5).
   */
  async resolve<T>(token: Token<T>): Promise<T> {
    const name = token.name;
    const entry = this.registry.get(name);
    if (!entry) {
      throw new Error(`No provider registered for token: ${name}`);
    }
    return entry.instance as T;
  }

  /**
   * Resolve a registered service instance by token name string.
   *
   * Phase 5: Added for Worker RPC — Worker sends token as string, not Token<T> object.
   * Phase 6: Token Registry pattern entry point — allows plugins to query
   *          services by string name without importing the Token class.
   *
   * Throws a plain Error when the token name is not registered.
   */
  async resolveByName(name: string): Promise<unknown> {
    const entry = this.registry.get(name);
    if (!entry) {
      throw new Error(`No provider registered for token name: ${name}`);
    }
    return entry.instance;
  }

  /**
   * 获取已注册 Token 的版本号。
   *
   * Phase 6: Token 语义化版本兼容系统的方法。
   * 由 PluginHost.activatePlugin() 在版本检查时调用。
   *
   * @param tokenName - Token 标识符字符串（如 '@openlearn/core:ICommandBusService'）
   * @returns 版本号字符串（如 '1.0.0'），或 undefined 当 Token 未注册时
   */
  getVersion(tokenName: string): string | undefined {
    const entry = this.registry.get(tokenName);
    return entry?.version;
  }

  /**
   * Unregister a service (and clean up its dependency edges).
   *
   * - Throws `HasDependentError` if other registered services depend on this one (D-09)
   * - Removes the reverse-dependency edges from the services this one requires
   */
  async unregister<T>(token: Token<T>): Promise<void> {
    const name = token.name;

    // D-09: cascade-prevention — check for dependents
    const edge = this.depGraph.get(name);
    if (edge && edge.dependents.size > 0) {
      throw new HasDependentError(name, Array.from(edge.dependents));
    }

    // Pitfall 3: clean up reverse edges in required services
    if (edge) {
      for (const req of edge.requires) {
        const reqEdge = this.depGraph.get(req);
        if (reqEdge) {
          reqEdge.dependents.delete(name);
        }
      }
    }

    this.registry.delete(name);
    this.depGraph.delete(name);
  }

  /**
   * Atomically replace a registered service instance.
   *
   * If the token is already registered, clean up its old dependency edges
   * before re-registering with the new instance and (optionally) new options.
   *
   * This is the explicit overwrite path required by D-08.
   */
  async registerOrReplace<T>(
    token: Token<T>,
    instance: T,
    options?: RegisterOptions
  ): Promise<void> {
    const name = token.name;

    if (this.registry.has(name)) {
      this.removeEdges(name);
      this.registry.delete(name);
    }

    await this.register(token, instance, options);
  }

  // -----------------------------------------------------------------------
  // Public API — introspection (D-10)
  // -----------------------------------------------------------------------

  /**
   * Return all registered Token names and their instances.
   */
  list(): Array<{ name: string; instance: unknown }> {
    const result: Array<{ name: string; instance: unknown }> = [];
    for (const [name, entry] of this.registry) {
      result.push({ name, instance: entry.instance });
    }
    return result;
  }

  /**
   * Check whether a Token is registered.
   */
  has<T>(token: Token<T>): boolean {
    return this.registry.has(token.name);
  }

  /**
   * Return the dependency sub-graph for a given token name.
   *
   * Returns `undefined` if the token is not in the depGraph.
   */
  dependencies(
    tokenName: string
  ): { requires: string[]; dependents: string[] } | undefined {
    const edge = this.depGraph.get(tokenName);
    if (!edge) return undefined;
    return {
      requires: Array.from(edge.requires),
      dependents: Array.from(edge.dependents),
    };
  }

  // -----------------------------------------------------------------------
  // Kahn topological sort — cycle detection
  // -----------------------------------------------------------------------

  /**
   * Compute a topological order for the given set of tokens using Kahn's
   * algorithm (BFS in-degree queue).  O(V+E) time.
   *
   * Throws `CircularDependencyError` when the graph contains a cycle.
   *
   * This is a **verification helper** — it is NOT called by resolve().
   * Phase 2-4 will use it during plugin activation to validate dependency
   * ordering in bulk.
   */
  topologicalOrder(tokens: string[]): string[] {
    const inDegree = new Map<string, number>();
    const adjacency = new Map<string, Set<string>>();

    // Initialise all nodes
    for (const name of tokens) {
      inDegree.set(name, 0);
      adjacency.set(name, new Set());
    }

    // Build sub-graph edges from depGraph
    for (const name of tokens) {
      const edge = this.depGraph.get(name);
      if (!edge) continue;
      for (const dep of edge.requires) {
        // Only consider edges within the requested token set
        if (tokens.includes(dep)) {
          adjacency.get(dep)!.add(name);
          inDegree.set(name, (inDegree.get(name) ?? 0) + 1);
        }
      }
    }

    // Kahn BFS — enqueue nodes with in-degree 0
    const queue: string[] = [];
    for (const [name, degree] of inDegree) {
      if (degree === 0) queue.push(name);
    }

    const result: string[] = [];
    while (queue.length > 0) {
      const current = queue.shift()!;
      result.push(current);
      for (const neighbor of adjacency.get(current) ?? new Set()) {
        const newDegree = inDegree.get(neighbor)! - 1;
        inDegree.set(neighbor, newDegree);
        if (newDegree === 0) queue.push(neighbor);
      }
    }

    // Cycle detection: if not all nodes were processed, residual = cycle
    if (result.length !== tokens.length) {
      const remaining = tokens.filter((t) => !result.includes(t));
      throw new CircularDependencyError(remaining);
    }

    return result;
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Remove all dependency edges for a given token name.
   *
   * Clears both directions:
   * 1. The token's own `requires` set → remove this token from each
   *    required dep's `dependents` set.
   * 2. Delete the token's depGraph entry.
   */
  private removeEdges(tokenName: string): void {
    const edge = this.depGraph.get(tokenName);
    if (!edge) return;

    // Clear reverse edges: for every service we required,
    // remove ourselves from their dependents set.
    for (const req of edge.requires) {
      const reqEdge = this.depGraph.get(req);
      if (reqEdge) {
        reqEdge.dependents.delete(tokenName);
      }
    }

    this.depGraph.delete(tokenName);
  }
}
