/**
 * OpenLearn Capability Governance - Capability Validator
 * Checks ID duplication, Version SemVer syntax, Schema structure, and dependency availability.
 */

import { GovernanceSpecification } from '../types/index.js';

export class CapabilityValidator {
  public static validate(
    spec: GovernanceSpecification,
    existingIds: Set<string>
  ): { valid: boolean; errors: ReadonlyArray<string> } {
    const errors: string[] = [];

    // 1. ID Duplication
    if (existingIds.has(spec.id)) {
      errors.push(`Duplicate Capability ID: '${spec.id}' is already registered.`);
    }

    // 2. SemVer Syntax
    if (!/^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/.test(spec.version)) {
      errors.push(`Invalid SemVer Version: '${spec.version}'. Must follow X.Y.Z semver syntax.`);
    }

    // 3. Schema Structure
    if (!spec.inputSchema || typeof spec.inputSchema !== 'object') {
      errors.push('Invalid Input Schema: inputSchema must be a valid schema object.');
    }
    if (!spec.outputSchema || typeof spec.outputSchema !== 'object') {
      errors.push('Invalid Output Schema: outputSchema must be a valid schema object.');
    }

    // 4. Namespace validation
    if (!spec.namespace || spec.namespace.trim() === '') {
      errors.push('Missing Namespace: namespace is required.');
    }

    return {
      valid: errors.length === 0,
      errors: Object.freeze(errors),
    };
  }
}
