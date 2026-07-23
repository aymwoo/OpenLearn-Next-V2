/**
 * OpenLearn Capability Governance SDK
 * High-level SDK for registering, validating, querying, and listing governed capabilities.
 */

import { GovernanceSpecification, CapabilitySearchResult } from '../types/index.js';
import { NamespaceManager } from '../namespace/namespace-manager.js';
import { CapabilityValidator } from '../validation/capability-validator.js';
import { DependencyGraph } from '../dependency/dependency-graph.js';
import { PolicyEngine } from '../policy/policy-engine.js';
import { SearchEngine } from '../search/search-engine.js';
import { HealthMonitor } from '../health/health-monitor.js';

export class GovernanceSDK {
  private specs = new Map<string, GovernanceSpecification>();
  private registeredIds = new Set<string>();
  private namespaceManager = new NamespaceManager();
  private dependencyGraph = new DependencyGraph();
  public readonly healthMonitor = new HealthMonitor();

  public registerCapability(spec: GovernanceSpecification): void {
    const validation = this.validateCapability(spec);
    if (!validation.valid) {
      throw new Error(`Governance Validation Failed for '${spec.id}': ${validation.errors.join('; ')}`);
    }

    const policy = PolicyEngine.evaluatePolicies(spec);
    if (!policy.allowed) {
      throw new Error(`Governance Policy Rejected for '${spec.id}': ${policy.reason}`);
    }

    this.namespaceManager.registerNamespace(spec.namespace);
    this.dependencyGraph.addNode(spec);

    this.specs.set(spec.id, Object.freeze(spec));
    this.registeredIds.add(spec.id);
  }

  public validateCapability(spec: GovernanceSpecification): { valid: boolean; errors: ReadonlyArray<string> } {
    return CapabilityValidator.validate(spec, this.registeredIds);
  }

  public queryCapability(query: {
    category?: string;
    tag?: string;
    provider?: string;
    namespace?: string;
    keyword?: string;
  }): ReadonlyArray<CapabilitySearchResult> {
    const allSpecs = Array.from(this.specs.values());
    return SearchEngine.search(allSpecs, query);
  }

  public listCapability(category?: string): ReadonlyArray<GovernanceSpecification> {
    const allSpecs = Array.from(this.specs.values());
    if (category) {
      return Object.freeze(allSpecs.filter((s) => s.category.toLowerCase() === category.toLowerCase()));
    }
    return Object.freeze(allSpecs);
  }

  public clear(): void {
    this.specs.clear();
    this.registeredIds.clear();
    this.namespaceManager.clear();
    this.dependencyGraph.clear();
    this.healthMonitor.clear();
  }
}
