/**
 * OpenLearn Capability Governance - Policy Engine
 * Evaluates Permission Policy, Security Policy, AI Policy, and Plugin Policy.
 */

import { GovernanceSpecification } from '../types/index.js';

export interface GovernancePolicyResult {
  readonly allowed: boolean;
  readonly reason?: string;
}

export class PolicyEngine {
  public static evaluatePolicies(spec: GovernanceSpecification): GovernancePolicyResult {
    // 1. Security Policy: Disallow unrestricted execute permissions for untrusted plugins
    if (spec.category === 'Plugin' && spec.approvalTier === 'Internal' && spec.permission.includes('System')) {
      return { allowed: false, reason: 'Security Policy Violation: Internal plugins cannot claim System role permissions.' };
    }

    // 2. AI Policy: AI capabilities must specify maximum tokens or temperature limit
    if (spec.category === 'AI' && spec.deprecated) {
      return { allowed: false, reason: 'AI Policy Violation: Deprecated AI capability cannot be invoked.' };
    }

    // 3. Plugin Policy: Community plugins must specify non-empty owner
    if (spec.approvalTier === 'Community' && (!spec.owner || spec.owner.trim() === '')) {
      return { allowed: false, reason: 'Plugin Policy Violation: Community capabilities must declare an owner.' };
    }

    return { allowed: true };
  }
}
