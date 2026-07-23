/**
 * Platform Configuration System — shared types & contracts (PI-011).
 *
 * The configuration system provides a unified abstraction for platform
 * configuration: loading from multiple sources (memory, environment, JSON,
 * optional YAML), validating against descriptors, and exposing an immutable
 * snapshot. It manages ONLY platform/kernel/infrastructure configuration — not
 * business-module configuration.
 */

import type { ConfigurationSnapshot } from './ConfigurationSnapshot.js';

/** Configuration scopes. `Application` is reserved for future use. */
export type ConfigurationScope = 'Platform' | 'Kernel' | 'Infrastructure' | 'Application';

export const ALL_CONFIGURATION_SCOPES: ReadonlyArray<ConfigurationScope> = Object.freeze([
  'Platform',
  'Kernel',
  'Infrastructure',
  'Application',
]);

/** Allowed value types for type validation. */
export type ConfigurationValueType = 'string' | 'number' | 'boolean' | 'object' | 'array';

/** Describes a single configuration key and its validation rules. */
export interface ConfigurationDescriptorInit {
  /** Dot-path key, e.g. `kernel.logLevel`. */
  readonly path: string;
  readonly scope: ConfigurationScope;
  readonly type?: ConfigurationValueType;
  readonly required?: boolean;
  readonly default?: unknown;
  readonly min?: number;
  readonly max?: number;
  readonly enum?: ReadonlyArray<unknown>;
  readonly description?: string;
}

export type ConfigurationSourceKind = 'memory' | 'environment' | 'json' | 'yaml';

/** Declarative description of a configuration source. */
export interface ConfigurationSourceInit {
  readonly kind: ConfigurationSourceKind;
  readonly id?: string;
  /** memory source */
  readonly values?: Record<string, unknown>;
  /** environment source */
  readonly prefix?: string;
  readonly env?: Record<string, string | undefined>;
  readonly map?: (key: string, value: string) => [string, unknown] | null;
  /** file sources (json / yaml) */
  readonly path?: string;
}

/** Declaration of a registered configuration provider. */
export interface ConfigurationProviderInit {
  readonly id: string;
  readonly scope: ConfigurationScope;
  readonly priority?: number;
  readonly source: ConfigurationSourceInit | import('./ConfigurationSource.js').ConfigurationSource;
  readonly descriptors?: ConfigurationDescriptorInit[];
  readonly description?: string;
}

export type ConfigurationValidationCode =
  | 'REQUIRED'
  | 'TYPE'
  | 'RANGE_MIN'
  | 'RANGE_MAX'
  | 'ENUM'
  | 'UNKNOWN';

export interface ConfigurationValidationError {
  readonly code: ConfigurationValidationCode;
  readonly path: string;
  readonly message: string;
  readonly scope?: ConfigurationScope;
}

export interface ConfigurationValidationReport {
  readonly isValid: boolean;
  readonly errors: ReadonlyArray<ConfigurationValidationError>;
  readonly warnings: ReadonlyArray<string>;
}

export interface ConfigurationLoadResult {
  readonly config: Record<string, unknown>;
  readonly report: ConfigurationValidationReport;
  readonly snapshot: ConfigurationSnapshot;
}

// ── Integration seams (structural — no business modules modified) ──────────

export interface ServiceRegistryIntegrationSource {
  register(descriptor: {
    id: string;
    instance?: unknown;
    lifetime?: string;
    scope?: string;
  }): void;
  exists(id: string): boolean;
  unregister(id: string): boolean;
}

export interface ContainerIntegrationSource {
  registerInstance(id: string, instance: unknown, options?: Record<string, unknown>): void;
}

export interface EventBusIntegrationSource {
  publishConfigurationLoaded?(config?: Record<string, unknown>): unknown | Promise<unknown>;
}

export interface BuilderIntegrationSource {
  getConfiguration?(): Record<string, unknown>;
  onConfigurationLoaded?(cb: (config: Record<string, unknown>) => void): () => void;
}

export interface BootstrapPipelineIntegrationSource {
  onConfigurationPhase?(cb: () => void): () => void;
}

export interface CompositionRootIntegrationSource {
  registerModule?(module: unknown): void;
}

export interface CapabilityRuntimeIntegrationSource {
  resolveService?(serviceId: string): unknown;
}
