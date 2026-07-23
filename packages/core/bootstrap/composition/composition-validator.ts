/**
 * OpenLearn Platform Kernel - Composition Validator (PI-006)
 */

import { CompositionValidation, CompositionValidationError, CompositionContextOptions, CompositionModule } from './composition-types.js';
import { BootstrapPipeline } from '../pipeline/bootstrap-pipeline.js';

export class CompositionValidator {
  public static validate(
    options: CompositionContextOptions,
    pipeline: BootstrapPipeline,
    modules: ReadonlyArray<CompositionModule>
  ): CompositionValidation {
    const errors: CompositionValidationError[] = [];
    const warnings: string[] = [];

    // 1. Validate configuration
    if (options.config && options.config.port !== undefined) {
      if (options.config.port <= 0 || options.config.port > 65535) {
        errors.push({
          code: 'INVALID_PORT',
          message: `Port must be a valid number between 1 and 65535. Received: ${options.config.port}`,
          target: 'config.port',
        });
      }
    }

    // 2. Validate pipeline
    if (!pipeline || pipeline.stages.length === 0) {
      errors.push({
        code: 'EMPTY_PIPELINE',
        message: 'Bootstrap pipeline is missing or contains zero stages.',
        target: 'pipeline',
      });
    }

    // 3. Validate modules & duplicate IDs
    const moduleIds = new Set<string>();
    for (const mod of modules) {
      if (!mod.id) {
        errors.push({
          code: 'INVALID_MODULE',
          message: `Module '${mod.name}' has no unique ID.`,
          target: 'module.id',
        });
      } else if (moduleIds.has(mod.id)) {
        errors.push({
          code: 'DUPLICATE_MODULE',
          message: `Duplicate composition module detected: '${mod.id}'.`,
          target: 'module.id',
        });
      } else {
        moduleIds.add(mod.id);
      }
    }

    return {
      isValid: errors.length === 0,
      errors: Object.freeze(errors),
      warnings: Object.freeze(warnings),
    };
  }
}
