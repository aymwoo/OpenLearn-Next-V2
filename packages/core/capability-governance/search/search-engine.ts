/**
 * OpenLearn Capability Governance - Search Engine
 * Search capability specifications by Category, Tag, Provider, Namespace, Keyword.
 */

import { GovernanceSpecification, CapabilitySearchResult } from '../types/index.js';

export class SearchEngine {
  public static search(
    specs: ReadonlyArray<GovernanceSpecification>,
    query: {
      category?: string;
      tag?: string;
      provider?: string;
      namespace?: string;
      keyword?: string;
    }
  ): ReadonlyArray<CapabilitySearchResult> {
    const results: CapabilitySearchResult[] = [];

    for (const spec of specs) {
      let score = 0;

      if (query.category && spec.category.toLowerCase() === query.category.toLowerCase()) {
        score += 10;
      }
      if (query.provider && spec.provider.toLowerCase() === query.provider.toLowerCase()) {
        score += 10;
      }
      if (query.namespace && spec.namespace.toLowerCase().includes(query.namespace.toLowerCase())) {
        score += 15;
      }
      if (query.tag && spec.tags.some((t) => t.toLowerCase() === query.tag!.toLowerCase())) {
        score += 8;
      }
      if (query.keyword) {
        const kw = query.keyword.toLowerCase();
        if (spec.displayName.toLowerCase().includes(kw)) score += 20;
        if (spec.description.toLowerCase().includes(kw)) score += 10;
        if (spec.id.toLowerCase().includes(kw)) score += 15;
      }

      // If any criteria matched or query was broad
      if (score > 0 || Object.keys(query).length === 0) {
        results.push({ specification: spec, matchScore: score });
      }
    }

    results.sort((a, b) => b.matchScore - a.matchScore);
    return Object.freeze(results);
  }
}
