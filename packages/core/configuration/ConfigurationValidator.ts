/**
 * ConfigurationValidator — validates the merged config against descriptors
 * (PI-011).
 *
 * Supports: required values, default values (defaults are applied by the
 * loader, not here), type validation, numeric range validation, and
 * enum validation. Produces a structured {@link ConfigurationValidationReport}.
 */

import { ConfigurationDescriptor } from './ConfigurationDescriptor.js';
import type { ConfigurationValidationError, ConfigurationValidationReport } from './types.js';
import { getByPath, typeMatches } from './utils.js';

export class ConfigurationValidator {
  public validate(
    config: Record<string, unknown>,
    descriptors: ReadonlyArray<ConfigurationDescriptor>,
  ): ConfigurationValidationReport {
    const errors: ConfigurationValidationError[] = [];
    const warnings: string[] = [];

    for (const descriptor of descriptors) {
      const value = getByPath(config, descriptor.path);

      if (value === undefined) {
        if (descriptor.required) {
          errors.push({
            code: 'REQUIRED',
            path: descriptor.path,
            message: `Required configuration '${descriptor.path}' is missing.`,
            scope: descriptor.scope,
          });
        }
        continue;
      }

      if (descriptor.type && !typeMatches(value, descriptor.type)) {
        errors.push({
          code: 'TYPE',
          path: descriptor.path,
          message: `Configuration '${descriptor.path}' expected type '${descriptor.type}' but got '${typeof value}'.`,
          scope: descriptor.scope,
        });
        continue;
      }

      if (descriptor.type === 'number') {
        const num = value as number;
        if (descriptor.min !== undefined && num < descriptor.min) {
          errors.push({
            code: 'RANGE_MIN',
            path: descriptor.path,
            message: `Configuration '${descriptor.path}' = ${num} is below minimum ${descriptor.min}.`,
            scope: descriptor.scope,
          });
        }
        if (descriptor.max !== undefined && num > descriptor.max) {
          errors.push({
            code: 'RANGE_MAX',
            path: descriptor.path,
            message: `Configuration '${descriptor.path}' = ${num} is above maximum ${descriptor.max}.`,
            scope: descriptor.scope,
          });
        }
      }

      if (descriptor.enum && !(descriptor.enum as ReadonlyArray<unknown>).includes(value)) {
        errors.push({
          code: 'ENUM',
          path: descriptor.path,
          message: `Configuration '${descriptor.path}' = ${JSON.stringify(value)} is not one of the allowed values.`,
          scope: descriptor.scope,
        });
      }
    }

    return {
      isValid: errors.length === 0,
      errors: Object.freeze(errors),
      warnings: Object.freeze(warnings),
    };
  }
}
