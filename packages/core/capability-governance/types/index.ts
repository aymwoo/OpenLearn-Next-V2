/**
 * OpenLearn Capability Governance - Strict TypeScript Definitions
 * No `any` types permitted. Uses Interfaces, Generics, and Readonly types throughout.
 */

export type CapabilityLifecycleStatus =
  | 'Draft'
  | 'Experimental'
  | 'Preview'
  | 'Stable'
  | 'Deprecated'
  | 'Archived';

export type GovernanceCategory =
  | 'Teaching'
  | 'Assessment'
  | 'Whiteboard'
  | 'Notebook'
  | 'AI'
  | 'Analytics'
  | 'Storage'
  | 'Media'
  | 'Runtime'
  | 'Plugin'
  | 'Utility';

export type ApprovalTier = 'Official' | 'Community' | 'Experimental' | 'Internal';

export type VisibilityTier = 'Public' | 'Private' | 'Protected';

export interface CapabilityDependencySpec {
  readonly capabilityId: string;
  readonly versionRange: string;
  readonly optional?: boolean;
}

export interface GovernanceSpecification {
  readonly id: string;
  readonly namespace: string;
  readonly displayName: string;
  readonly description: string;
  readonly version: string;
  readonly provider: string;
  readonly category: GovernanceCategory;
  readonly permission: ReadonlyArray<string>;
  readonly inputSchema: Record<string, unknown>;
  readonly outputSchema: Record<string, unknown>;
  readonly metadata: Record<string, unknown>;
  readonly dependencies: ReadonlyArray<CapabilityDependencySpec>;
  readonly owner: string;
  readonly license: string;
  readonly visibility: VisibilityTier;
  readonly deprecated: boolean;
  readonly tags: ReadonlyArray<string>;
  readonly approvalTier: ApprovalTier;
  readonly status: CapabilityLifecycleStatus;
}

export interface CapabilityHealthMetrics {
  readonly capabilityId: string;
  readonly invocationCount: number;
  readonly successCount: number;
  readonly failureCount: number;
  readonly totalLatencyMs: number;
  readonly averageLatencyMs: number;
  readonly successRate: number;
  readonly errorRate: number;
  readonly providerUsage: Record<string, number>;
}

export interface CapabilitySearchResult {
  readonly specification: GovernanceSpecification;
  readonly matchScore: number;
}
