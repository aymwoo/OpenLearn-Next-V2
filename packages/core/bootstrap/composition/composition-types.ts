/**
 * OpenLearn Platform Kernel - Composition Root Types & Interfaces (PI-006)
 */

import {
  IPlatformContext,
  PlatformBootstrapConfig,
  IPlatformLogger,
  EnvironmentType,
} from '../types/index.js';
import { BootstrapPipeline } from '../pipeline/bootstrap-pipeline.js';

export type CompositionState =
  | 'Created'
  | 'Validating'
  | 'Composing'
  | 'Composed'
  | 'Disposed';

export interface CompositionValidationError {
  readonly code: string;
  readonly message: string;
  readonly target?: string;
}

export interface CompositionValidation {
  readonly isValid: boolean;
  readonly errors: ReadonlyArray<CompositionValidationError>;
  readonly warnings: ReadonlyArray<string>;
}

export interface CompositionContextOptions {
  readonly config?: Partial<PlatformBootstrapConfig>;
  readonly logger?: IPlatformLogger;
  readonly environment?: EnvironmentType;
  readonly infrastructureRefs?: ReadonlyMap<string, unknown>;
}

export interface CompositionResult {
  readonly context: IPlatformContext;
  readonly pipeline: BootstrapPipeline;
  readonly durationMs: number;
  readonly validation: CompositionValidation;
}

export interface CompositionModule {
  readonly id: string;
  readonly name: string;
  compose(context: CompositionContextOptions): Promise<void> | void;
}
