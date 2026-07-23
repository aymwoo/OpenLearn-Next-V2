/**
 * Capability Runtime — shared types & contracts (PI-009).
 *
 * These types define the public vocabulary of the capability runtime: how a
 * capability is described, how it is resolved, and how resolution/validation
 * failures are reported. The runtime is built ON TOP of the Platform Service
 * Registry and the Platform DI Container — it never bypasses them.
 */

import type { CapabilityStatus } from './CapabilityStatus.js';
import type { CapabilityContext } from './CapabilityContext.js';

/** Free-form category string used to group capabilities (e.g. 'ai', 'whiteboard'). */
export type CapabilityCategory = string;

/**
 * How a capability (or set of capability providers) is resolved.
 *  - `Single`    — exactly one instance is expected/returned.
 *  - `Multiple`  — every provider for the contract is returned as a list.
 *  - `Priority`  — among competing providers the highest-priority one wins.
 *  - `Default`   — a fallback/default provider is used when none is found.
 *  - `Optional`  — resolution may return `undefined` instead of throwing.
 *  - `Validation`— no activation; only descriptor/dependency validation runs.
 */
export type CapabilityResolutionMode =
  | 'Single'
  | 'Multiple'
  | 'Priority'
  | 'Default'
  | 'Optional'
  | 'Validation';

/** Factory that materializes a capability instance from a resolution context. */
export type CapabilityActivator = (context: CapabilityContext) => unknown;

/** Immutable-ish seed used to construct a {@link CapabilityDescriptor}. */
export interface CapabilityDescriptorInit {
  readonly id: string;
  readonly name?: string;
  readonly displayName?: string;
  readonly version?: string;
  readonly description?: string;
  readonly category?: CapabilityCategory;
  /** Provider identifier that owns the activator for this capability. */
  readonly provider?: string;
  /** Ids of other capabilities this one depends on (resolved in order). */
  readonly dependencies?: ReadonlyArray<string>;
  readonly metadata?: Readonly<Record<string, unknown>>;
  /** Selection priority when several providers share a contract (higher wins). */
  readonly priority?: number;
  /** Grouping key; multiple capabilities under one contract resolve together. */
  readonly contract?: string;
  /** When true, a missing capability resolves to `undefined` instead of throwing. */
  readonly optional?: boolean;
  /** Marks this capability as the fallback/default for its contract. */
  readonly isDefault?: boolean;
  /** Produces the runtime instance for this capability. */
  readonly activator?: CapabilityActivator;
}

/** Options passed to a resolution call. */
export interface CapabilityResolutionOptions {
  readonly mode?: CapabilityResolutionMode;
  readonly contract?: string;
  readonly optional?: boolean;
  readonly fallback?: unknown;
}

/** A single validation problem found while validating the capability graph. */
export interface CapabilityValidationError {
  readonly code: string;
  readonly message: string;
  readonly capabilityId?: string;
}

/** Result of validating the capability graph. */
export interface CapabilityValidationReport {
  readonly isValid: boolean;
  readonly errors: ReadonlyArray<CapabilityValidationError>;
  readonly warnings: ReadonlyArray<string>;
}

/** A resolution diagnostic, useful for debugging dependency chains. */
export interface CapabilityResolutionDiagnostic {
  readonly capabilityId: string;
  readonly action: 'resolve' | 'activate' | 'validate' | 'skip';
  readonly mode: CapabilityResolutionMode;
  readonly status: CapabilityStatus;
  readonly durationMs: number;
}

/**
 * The minimal surface the capability runtime needs from its host (the
 * `CapabilityRuntime` itself). Declaring it as an interface keeps
 * `CapabilityContext` free of a value-level import cycle with the runtime.
 */
export interface CapabilityResolutionHost {
  resolveCapability(capabilityId: string, options?: CapabilityResolutionOptions): unknown;
  resolveService(serviceId: string): unknown;
  hasCapability(capabilityId: string): boolean;
}

/** Structural view of a builder's capability catalog, used for integration. */
export interface BuilderCapabilityCatalog {
  hasCapability(id: string): boolean;
  getCapability(id: string): unknown;
}

/** Structural view of a builder integration source (post-build result). */
export interface BuilderIntegrationSource {
  capabilityCatalog: BuilderCapabilityCatalog;
}
