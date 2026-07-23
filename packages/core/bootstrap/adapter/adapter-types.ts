/**
 * OpenLearn Platform Kernel - Server Bootstrap Adapter Types (PI-005)
 */

import {
  PlatformBootstrapConfig,
  IPlatformLogger,
  EnvironmentType,
  IRuntimeMetadata,
} from '../types/index.js';

export type AdapterState =
  | 'Created'
  | 'Configuring'
  | 'PipelineRegistered'
  | 'Bootstrapped'
  | 'Shutdown';

export interface StartupAdapterContext {
  readonly config?: Partial<PlatformBootstrapConfig>;
  readonly logger?: IPlatformLogger;
  readonly environment?: EnvironmentType;
  readonly runtimeMetadata?: Partial<IRuntimeMetadata>;
  readonly existingServices?: ReadonlyMap<string, unknown>;
  readonly startupParams?: Record<string, unknown>;
  readonly expressApp?: unknown;
  readonly httpServer?: unknown;
  readonly kernelContainer?: unknown;
}
