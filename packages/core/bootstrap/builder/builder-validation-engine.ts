/**
 * OpenLearn Platform Kernel - Builder Validation Engine (PI-004)
 */

import { BuilderValidation, ValidationError } from './builder-types.js';
import { PlatformBootstrapConfig, EnvironmentType } from '../types/index.js';
import { IBootstrapStage } from '../pipeline/bootstrap-stage.js';

export class BuilderValidationEngine {
  public static validate(
    config: PlatformBootstrapConfig,
    environment: EnvironmentType,
    stages: ReadonlyArray<IBootstrapStage>
  ): BuilderValidation {
    const errors: ValidationError[] = [];
    const warnings: string[] = [];

    // 1. Environment validation
    if (!['development', 'production', 'test'].includes(environment)) {
      errors.push({
        code: 'INVALID_ENVIRONMENT',
        message: `Environment must be one of 'development', 'production', 'test'. Received: '${environment}'`,
        field: 'environment',
      });
    }

    // 2. Port validation
    if (!config.port || config.port <= 0 || config.port > 65535) {
      errors.push({
        code: 'INVALID_PORT',
        message: `Port must be a valid number between 1 and 65535. Received: ${config.port}`,
        field: 'port',
      });
    }

    // 3. Stage validation
    if (!stages || stages.length === 0) {
      errors.push({
        code: 'MISSING_STAGES',
        message: 'Bootstrap pipeline contains no registered stages.',
        field: 'stages',
      });
    } else {
      const stageIds = new Set<string>();
      for (const stage of stages) {
        if (!stage.id) {
          errors.push({
            code: 'INVALID_STAGE',
            message: `Stage '${stage.name}' has no unique ID.`,
          });
        } else if (stageIds.has(stage.id)) {
          errors.push({
            code: 'DUPLICATE_STAGE',
            message: `Duplicate stage registration detected for stage ID '${stage.id}'.`,
            field: 'stage.id',
          });
        } else {
          stageIds.add(stage.id);
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors: Object.freeze(errors),
      warnings: Object.freeze(warnings),
    };
  }
}
