/**
 * OpenLearn Platform Kernel - Builder Types & Result Interfaces (PI-004)
 */

import {
  IPlatformContext,
  EnvironmentType,
  IPlatformLogger,
  PlatformBootstrapConfig,
} from '../types/index.js';
import { BootstrapPipeline } from '../pipeline/bootstrap-pipeline.js';

export type BuilderState =
  | 'Created'
  | 'Configuring'
  | 'Validating'
  | 'Building'
  | 'Built'
  | 'Disposed';

export interface ValidationError {
  readonly code: string;
  readonly message: string;
  readonly field?: string;
}

export interface BuilderValidation {
  readonly isValid: boolean;
  readonly errors: ReadonlyArray<ValidationError>;
  readonly warnings: ReadonlyArray<string>;
}

export interface PlatformBuilderOptions {
  readonly config?: Partial<PlatformBootstrapConfig>;
  readonly logger?: IPlatformLogger;
  readonly environment?: EnvironmentType;
  readonly metadata?: Record<string, unknown>;
}

export interface PlatformBuilderResult {
  readonly platformContext: IPlatformContext;
  readonly pipeline: BootstrapPipeline;
  readonly buildDurationMs: number;
  readonly validation: BuilderValidation;
  readonly metadata: Record<string, unknown>;
  readonly builderVersion: string;
}
