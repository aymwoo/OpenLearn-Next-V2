/**
 * OpenLearn Platform Kernel - Permission Evaluator (PI-012)
 * Evaluates policies (Allow, Deny, Default, Inherited) for infrastructure authorization.
 */

import {
  PermissionPolicy,
  PermissionResult,
  PermissionDescriptor,
  IPermissionProvider,
} from './permission-types.js';

export class PermissionEvaluator {
  public static async evaluate(
    subject: string,
    permission: string,
    explicitGrants: Map<string, PermissionPolicy>,
    descriptor?: PermissionDescriptor,
    providers?: ReadonlyArray<IPermissionProvider>
  ): Promise<PermissionResult> {
    const evaluatedAt = Date.now();
    const grantKey = `${subject}::${permission}`;

    // 1. Explicit Subject Grant / Revoke Overrides
    if (explicitGrants.has(grantKey)) {
      const policy = explicitGrants.get(grantKey)!;
      if (policy === 'Allow') {
        return { allowed: true, policy: 'Allow', reason: 'Explicitly granted to subject', evaluatedAt };
      }
      if (policy === 'Deny') {
        return { allowed: false, policy: 'Deny', reason: 'Explicitly denied to subject', evaluatedAt };
      }
    }

    // 2. Custom Providers Check
    if (providers && providers.length > 0) {
      for (const provider of providers) {
        const policy = await provider.getPolicy(subject, permission);
        if (policy === 'Allow') {
          return { allowed: true, policy: 'Allow', reason: `Granted by provider '${provider.id}'`, evaluatedAt };
        }
        if (policy === 'Deny') {
          return { allowed: false, policy: 'Deny', reason: `Denied by provider '${provider.id}'`, evaluatedAt };
        }
      }
    }

    // 3. Descriptor Default Policy
    if (descriptor && descriptor.defaultPolicy) {
      const defaultPol = descriptor.defaultPolicy;
      if (defaultPol === 'Allow') {
        return { allowed: true, policy: 'Allow', reason: 'Allowed by descriptor default policy', evaluatedAt };
      }
      if (defaultPol === 'Deny') {
        return { allowed: false, policy: 'Deny', reason: 'Denied by descriptor default policy', evaluatedAt };
      }
    }

    // 4. Default Fallback
    return {
      allowed: false,
      policy: 'Default',
      reason: 'No explicit allow policy resolved; default deny',
      evaluatedAt,
    };
  }
}
