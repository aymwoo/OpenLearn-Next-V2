/**
 * OpenLearn Capability Governance - Dependency Graph & Cycle Detection
 * Maintains a DAG of capability dependencies and detects circular dependencies.
 */

import { GovernanceSpecification } from '../types/index.js';

export class DependencyGraph {
  private adjList = new Map<string, Set<string>>();

  public addNode(spec: GovernanceSpecification): void {
    if (!this.adjList.has(spec.id)) {
      this.adjList.set(spec.id, new Set());
    }

    if (spec.dependencies) {
      for (const dep of spec.dependencies) {
        this.addEdge(spec.id, dep.capabilityId);
      }
    }
  }

  public addEdge(fromId: string, toId: string): void {
    if (!this.adjList.has(fromId)) {
      this.adjList.set(fromId, new Set());
    }
    this.adjList.get(fromId)!.add(toId);

    if (this.hasCycle()) {
      this.adjList.get(fromId)!.delete(toId);
      throw new Error(`Circular Dependency Detected: Adding dependency '${fromId} -> ${toId}' creates a loop.`);
    }
  }

  public hasCycle(): boolean {
    const visited = new Set<string>();
    const recStack = new Set<string>();

    for (const node of this.adjList.keys()) {
      if (this.detectCycleDFS(node, visited, recStack)) {
        return true;
      }
    }
    return false;
  }

  private detectCycleDFS(node: string, visited: Set<string>, recStack: Set<string>): boolean {
    if (recStack.has(node)) return true;
    if (visited.has(node)) return false;

    visited.add(node);
    recStack.add(node);

    const neighbors = this.adjList.get(node) || new Set();
    for (const neighbor of neighbors) {
      if (this.detectCycleDFS(neighbor, visited, recStack)) {
        return true;
      }
    }

    recStack.delete(node);
    return false;
  }

  public clear(): void {
    this.adjList.clear();
  }
}
