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

/** 跨插件服务需求解析结果。kernel Token（@openlearn/*）返回 null。 */
export interface ServiceRequirement {
  /** 提供方插件的 manifest.id */
  pluginId: string;
  /** 服务 Token 名称（如 ext-my-service:IMyService） */
  tokenName: string;
}

/**
 * 声明期校验结果：消费方依赖的跨插件服务 token 是否在提供方 manifest.provides 中声明。
 */
export interface CrossPluginServiceCheck {
  consumerId: string;
  unsatisfied: Array<{ required: string; providerId: string }>;
}

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

// Kernel token 前缀，用于区分内核服务和跨插件服务
const KERNEL_TOKEN_PREFIX = '@openlearn/';

/**
 * V3.2: 解析 manifest.requires 中的跨插件服务需求条目。
 *
 * - 以 @openlearn/ 开头的内核 Token 返回 null
 * - 格式 ext-my-service:IMyService 解析为 { pluginId, tokenName }
 * - 不识别的格式返回 null
 */
export function parseServiceRequirement(req: string): ServiceRequirement | null {
  if (req.startsWith(KERNEL_TOKEN_PREFIX)) return null;

  // 格式: pluginId:ServiceName 或 @scope/domain:ServiceName
  const match = req.match(/^(?:@[a-zA-Z0-9_-]+\/)?([a-zA-Z0-9_-]+):([a-zA-Z0-9_]+)$/);
  if (!match) return null;

  const [, pluginId] = match;
  return { pluginId, tokenName: req };
}

/**
 * Build a dependency graph from installed plugin manifests.
 *
 * Only includes plugins whose dependencies are declared via
 * manifest.pluginDependencies. Kernel plugins (@openlearn/*) are
 * implicitly excluded (they have no plugin dependencies).
 */
export function buildDepGraph(manifests: Map<string, Manifest>): Map<string, string[]> {
  const graph = new Map<string, string[]>();

  for (const [pluginId, manifest] of manifests) {
    const deps = manifest.pluginDependencies ?? [];

    // V3.2: 从 manifest.requires 中推导跨插件服务依赖
    const serviceDeps: string[] = [];
    if (manifest.requires) {
      for (const req of manifest.requires) {
        const parsed = parseServiceRequirement(req);
        if (parsed && parsed.pluginId !== pluginId) {
          serviceDeps.push(parsed.pluginId);
        }
      }
    }

    // 合并显式 pluginDependencies 和推导出的服务依赖（去重）
    const allDeps = [...new Set([...deps, ...serviceDeps])];
    graph.set(pluginId, allDeps);
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
  /**
   * 被阻塞的插件 id。
   *
   * 存在的理由（H-5）：见下方 cycle 检测处 —— 阻塞与循环是**两种不同的失败**，
   * 混在一起会让运维把「依赖没装」误判成「依赖成环」，排查方向完全跑偏。
   */
  const blockedIds = new Set<string>();

  for (const [id, degree] of inDegree) {
    // activeIds 给定时，不在其中即视为已阻塞（未激活或处于 ERROR 态）
    if (activeIds && !activeIds.has(id)) {
      blocked.push({ pluginId: id, missingDeps: [`${id} (inactive/error)`] });
      blockedIds.add(id);
      continue;
    }

    if (degree === 0) {
      // Check if this plugin has missing deps
      const deps = graph.get(id) ?? [];
      const missing = deps.filter((d) => !installedIds.includes(d));
      const failed = activeIds ? deps.filter((d) => installedIds.includes(d) && !activeIds.has(d)) : [];

      if (missing.length > 0 || failed.length > 0) {
        blocked.push({
          pluginId: id,
          missingDeps: [...missing, ...failed.map((f) => `${f} (inactive/error)`)],
        });
        blockedIds.add(id);
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
          blockedIds.add(dependent);
          continue;
        }

        // Re-check deps for this dependent
        const deps = graph.get(dependent) ?? [];
        const missing = deps.filter((d) => !installedIds.includes(d));
        const failed = activeIds ? deps.filter((d) => installedIds.includes(d) && !activeIds.has(d)) : [];

        if (missing.length > 0 || failed.length > 0) {
          blocked.push({
            pluginId: dependent,
            missingDeps: [...missing, ...failed.map((f) => `${f} (inactive/error)`)],
          });
          blockedIds.add(dependent);
        } else {
          queue.push(dependent);
        }
      }
    }
  }

  // ── Cycle detection ──
  //
  // 只有「入度永远无法归零」的节点才可能成环。而**被阻塞的插件不在此列**：
  // 它们的依赖没装/没激活，于是依赖节点永远不会进 queue、其入度也就永远不会被递减 ——
  // 数值上与成环无法区分，但**语义上完全不同**。
  //
  // 实测（修复前）：`A 依赖 B、B 未激活` 得到 `cycles: [["ext-a"]]`。
  // 单节点的「环」在结构上不可能是真环（真环要么 ≥2 节点，要么是显式自环），
  // 这就是判据错误的直接证据 —— 缺依赖被误报成循环依赖。
  const cycles: string[][] = [];
  /** 真正落在环里的节点 —— 用于把「被阻塞」与「成环」区分开 */
  const cyclicIds = new Set<string>();
  const remaining = Array.from(inDegree.entries())
    .filter(([id, d]) => d > 0 && !blockedIds.has(id))
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
      // 自环（插件声明依赖自己）是真环，必须保留
      const isSelfLoop = component.length === 1 && (graph.get(component[0]) ?? []).includes(component[0]);
      if (component.length >= 2 || isSelfLoop) {
        cycles.push(component);
        for (const member of component) cyclicIds.add(member);
      }
    }

    // ── 剩余未成环但入度未归零的节点 = **被阻塞**，不是成环 ──
    //
    // 典型形态：`A 依赖 B`，而 B 因缺自己的依赖或未激活被阻塞 ⇒ B 永不入 queue ⇒
    // A 的入度永不递减 ⇒ 数值上与成环无异。
    //
    // 只把环排除出 cycles 还不够：若就此放过，这些插件会从三份结果里同时消失
    // （既不在 sorted、不在 blocked、也不在 cycles），变成**静默丢弃** ——
    // 比误报成循环更难排查，因为没有任何诊断信息。
    // 所以这里补一次传递性归因：把上游被阻塞的原因写进 missingDeps。
    for (const id of remaining) {
      if (cyclicIds.has(id)) continue;
      const blockedAlready = blocked.find((b) => b.pluginId === id);
      if (blockedAlready) continue;

      const upstream = (graph.get(id) ?? []).filter((d) => blockedIds.has(d) || blocked.some((b) => b.pluginId === d));
      blocked.push({
        pluginId: id,
        missingDeps:
          upstream.length > 0 ? upstream.map((d) => `${d} (blocked)`) : ['上游依赖未能解析（可能被阻塞或已失效）'],
      });
      blockedIds.add(id);
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
export function checkMissingDeps(pluginDependencies: string[], installedIds: Set<string>): string[] {
  return pluginDependencies.filter((dep) => !installedIds.has(dep));
}

/**
 * Check for circular dependencies starting from a given plugin.
 *
 * Returns the cycle path if found, or null if the graph is acyclic
 * for this plugin's dependency chain.
 */
export function detectCycle(pluginId: string, graph: Map<string, string[]>): string[] | null {
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
export function computeActivationOrder(manifests: Map<string, Manifest>, activeIds: Set<string>): DepResult {
  const graph = buildDepGraph(manifests);
  const installedIds = Array.from(manifests.keys());
  return topologicalSort(graph, installedIds, activeIds);
}
