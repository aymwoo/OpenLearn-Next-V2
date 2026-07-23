/**
 * OpenLearn Platform Kernel - Integration Layer Types (PI-007)
 */

import { Version, IPlatformLogger, PlatformBootstrapConfig } from '../types/index.js';

export interface IntegrationHealthStatus {
  readonly isHealthy: boolean;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface IntegrationDescriptor {
  readonly id: string;
  readonly name: string;
  readonly version: Version;
  readonly description: string;
  readonly dependencies?: ReadonlyArray<string>;
}

export interface IntegrationContext {
  readonly platformId: string;
  readonly environment: string;
  readonly logger?: IPlatformLogger;
  readonly config?: Partial<PlatformBootstrapConfig>;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface IntegrationResult {
  readonly id: string;
  readonly status: 'Success' | 'Failed';
  readonly durationMs: number;
  readonly health: IntegrationHealthStatus;
  readonly error?: Error;
}

export interface IIntegrationAdapter {
  readonly id: string;
  readonly name: string;
  readonly version: Version;
  initialize(context: IntegrationContext): Promise<void> | void;
  activate(): Promise<void> | void;
  deactivate(): Promise<void> | void;
  dispose(): Promise<void> | void;
  health(): Promise<IntegrationHealthStatus> | IntegrationHealthStatus;
  metadata(): IntegrationDescriptor;
}

export interface IIntegrationRegistry {
  register(adapter: IIntegrationAdapter): void;
  get(id: string): IIntegrationAdapter | undefined;
  has(id: string): boolean;
  list(): ReadonlyArray<IIntegrationAdapter>;
}
