/**
 * OpenLearn Platform Service Registry - Dependency Resolver
 * Resolves dependency trees and detects circular dependencies.
 */

import { ServiceDescriptor } from '../types/index.js';

export class DependencyResolver {
  public static resolveOrder(descriptors: ReadonlyArray<ServiceDescriptor>): ReadonlyArray<ServiceDescriptor> {
    const descMap = new Map<string, ServiceDescriptor>();
    for (const desc of descriptors) {
      descMap.set(desc.id, desc);
    }

    const visited = new Set<string>();
    const recStack = new Set<string>();
    const result: ServiceDescriptor[] = [];

    const visit = (nodeId: string) => {
      if (recStack.has(nodeId)) {
        throw new Error(`Circular Service Dependency Detected: Dependency loop involving '${nodeId}'`);
      }
      if (!visited.has(nodeId)) {
        visited.add(nodeId);
        recStack.add(nodeId);

        const desc = descMap.get(nodeId);
        if (desc && desc.dependencies) {
          for (const depId of desc.dependencies) {
            visit(depId);
          }
        }

        recStack.delete(nodeId);
        if (desc) {
          result.push(desc);
        }
      }
    };

    for (const desc of descriptors) {
      visit(desc.id);
    }

    return Object.freeze(result);
  }
}
