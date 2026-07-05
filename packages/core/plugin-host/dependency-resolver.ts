/**
 * dependency-resolver.ts — Plugin dependency resolution (V3.0).
 *
 * Follows VS Code's model: ID-only dependencies, no version ranges.
 * Provides topological sort for activation order and cycle detection.
 *
 * ## Design
 *
 * - Install time: validate that declared deps exist in DB (warn if missing,
 *   but don't block install — deps may be installed later)
 * - Activation time: topological sort ensures deps activate first.
 *   If a required dep is missing or in ERROR state, the dependent
 *   transitions to ERROR with a clear message.
 * - No version constraints (VS Code simplicity — covers 90% of use cases)
 *
 * ## State machine impact
 *
 *   INSTALLED → (check deps on activate) → ACTIVATING or ERROR
 *   When a dep transitions to ERROR, dependents remain ACTIVE (no cascade)
 */

import type { Manifest } from '../esm-loader/manifest-schema.js';

// ── Types ────────────────────────────────────────────────────────────────

export interface DepEdge {
  pluginId: string;
  dependencies: string[];
}

export interface DepResult {
  /** Topologically sorted plugin IDs (deps first). */
  sorted: string[];
  /** Plugins that couldn't be activated due to missing/failed deps. */
  blocked: Array<{ pluginId: string; missingDeps: string[] }>;
  /** Cycle members, if any. */
  cycles: string[][];
}

// ── Graph Builder ────────────────────────────────────────────────────────

/**
 * Build a dependency graph from installed plugin manifests.
 *
 * Only includes plugins whose dependencies are declared via
 * manifest.pluginDependencies. Kernel plugins (@openlearn/*) are
 * implicitly excluded (they have no plugin dependencies).
 */
export function buildDepGraph(
  manifests: Map<string, Manifest>,
): Map<string, string[]> {
  const graph = new Map<string, string[]>();

  for (const [pluginId, manifest] of manifests) {
    const deps = manifest.pluginDependencies ?? [];
    graph.set(pluginId, deps);
  }

  return graph;
}

// ── Topological Sort ─────────────────────────────────────────────────────

/**
 * Topologically sort plugins so dependencies activate before dependents.
 *
 * Uses Kahn's algorithm (BFS-based). Returns the full DepResult with
 * sorted order, blocked plugins, and detected cycles.
 *
 * @param graph - pluginId → dependency pluginIds
 * @param installedIds - all installed plugin IDs to include in the sort
 * @param activeIds - currently active plugin IDs (used to detect blocked)
 * @returns DepResult with sorted order and diagnostics
 */
export function topologicalSort(
  graph: Map<string, string[]>,
  installedIds: string[],
  activeIds?: Set<string>,
): DepResult {
  // Build reverse edges (dependents) and in-degree map
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, Set<string>>();

  for (const id of installedIds) {
    inDegree.set(id, 0);
    dependents.set(id, new Set());
  }

  for (const [pluginId, deps] of graph) {
    for (const dep of deps) {
      if (!installedIds.includes(dep)) {
        // Mark as external — will be caught by checkMissingDeps
        continue;
      }
      // dep → pluginId edge
      const current = inDegree.get(pluginId) ?? 0;
      inDegree.set(pluginId, current + 1);
      dependents.get(dep)?.add(pluginId);
    }
  }

  // Kahn's algorithm
  const queue: string[] = [];
  const sorted: string[] = [];
  const blocked: Array<{ pluginId: string; missingDeps: string[] }> = [];

  for (const [id, degree] of inDegree) {
    // ponytail: if activeIds is provided, plugins not in it are blocked outright
    if (activeIds && !activeIds.has(id)) {
      blocked.push({ pluginId: id, missingDeps: [`${id} (inactive/error)`] });
      continue;
    }

    if (degree === 0) {
      // Check if this plugin has missing deps
      const deps = graph.get(id) ?? [];
      const missing = deps.filter((d) => !installedIds.includes(d));
      const failed = activeIds
        ? deps.filter((d) => installedIds.includes(d) && !activeIds.has(d))
        : [];

      if (missing.length > 0 || failed.length > 0) {
        blocked.push({
          pluginId: id,
          missingDeps: [...missing, ...failed.map((f) => `${f} (inactive/error)`)],
        });
        // Don't add to queue — blocked plugins don't propagate
      } else {
        queue.push(id);
      }
    }
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    sorted.push(current);

    for (const dependent of dependents.get(current) ?? []) {
      const degree = (inDegree.get(dependent) ?? 1) - 1;
      inDegree.set(dependent, degree);

      if (degree === 0) {
        // ponytail: if activeIds is provided, non-active plugins are blocked
        if (activeIds && !activeIds.has(dependent)) {
          blocked.push({
            pluginId: dependent,
            missingDeps: [`${dependent} (inactive/error)`],
          });
          continue;
        }

        // Re-check deps for this dependent
        const deps = graph.get(dependent) ?? [];
        const missing = deps.filter((d) => !installedIds.includes(d));
        const failed = activeIds
          ? deps.filter((d) => installedIds.includes(d) && !activeIds.has(d))
          : [];

        if (missing.length > 0 || failed.length > 0) {
          blocked.push({
            pluginId: dependent,
            missingDeps: [...missing, ...failed.map((f) => `${f} (inactive/error)`)],
          });
        } else {
          queue.push(dependent);
        }
      }
    }
  }

  // Cycle detection: remaining non-zero in-degree nodes form cycles
  const cycles: string[][] = [];
  const remaining = Array.from(inDegree.entries())
    .filter(([, d]) => d > 0)
    .map(([id]) => id);

  if (remaining.length > 0) {
    // Find connected components in remaining nodes
    const visited = new Set<string>();
    for (const id of remaining) {
      if (visited.has(id)) continue;
      const component: string[] = [];
      const stack = [id];
      while (stack.length > 0) {
        const node = stack.pop()!;
        if (visited.has(node)) continue;
        visited.add(node);
        component.push(node);
        for (const dep of graph.get(node) ?? []) {
          if (remaining.includes(dep) && !visited.has(dep)) {
            stack.push(dep);
          }
        }
      }
      cycles.push(component);
    }
  }

  return { sorted, blocked, cycles };
}

// ── Validation ───────────────────────────────────────────────────────────

/**
 * Check if a plugin's declared dependencies are installed.
 *
 * Called at install time and activation time. Returns the list of
 * missing dependencies (empty = all satisfied).
 */
export function checkMissingDeps(
  pluginDependencies: string[],
  installedIds: Set<string>,
): string[] {
  return pluginDependencies.filter((dep) => !installedIds.has(dep));
}

/**
 * Check for circular dependencies starting from a given plugin.
 *
 * Returns the cycle path if found, or null if the graph is acyclic
 * for this plugin's dependency chain.
 */
export function detectCycle(
  pluginId: string,
  graph: Map<string, string[]>,
): string[] | null {
  const visited = new Set<string>();
  const path: string[] = [];

  function dfs(node: string): boolean {
    if (path.includes(node)) {
      // Found cycle — extract it
      const cycleStart = path.indexOf(node);
      path.push(node);
      return true;
    }
    if (visited.has(node)) return false;

    visited.add(node);
    path.push(node);

    for (const dep of graph.get(node) ?? []) {
      if (dfs(dep)) return true;
    }

    path.pop();
    return false;
  }

  if (dfs(pluginId)) {
    return path;
  }
  return null;
}

// ── Activation Order ─────────────────────────────────────────────────────

/**
 * Compute the activation order for all installed plugins,
 * respecting dependency constraints.
 *
 * @param manifests - Map<pluginId, Manifest> of installed plugins
 * @param activeIds - Set of pluginIds that are currently active
 * @returns DepResult with sorted order and diagnostics
 */
export function computeActivationOrder(
  manifests: Map<string, Manifest>,
  activeIds: Set<string>,
): DepResult {
  const graph = buildDepGraph(manifests);
  const installedIds = Array.from(manifests.keys());
  return topologicalSort(graph, installedIds, activeIds);
}
