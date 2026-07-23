/**
 * OpenLearn Master Capability Governance Kernel
 * Master orchestrator unifying Governance SDK, Namespace Management, Dependency Graph,
 * Validation Engine, Policy Engine, and Health Monitoring.
 */

import { GovernanceSDK } from './sdk/governance-sdk.js';

export class CapabilityGovernanceKernel {
  public readonly sdk: GovernanceSDK;

  constructor() {
    this.sdk = new GovernanceSDK();
  }

  public dispose(): void {
    this.sdk.clear();
  }
}
