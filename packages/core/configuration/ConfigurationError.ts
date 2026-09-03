/**
 * ConfigurationError — error hierarchy for the Platform Configuration System
 * (PI-011). Mirrors the structured-error pattern used across the kernel
 * (`CapabilityError`, `EventError`): every failure carries a stable `code`, the
 * offending `path` (when known), and `scope`.
 */

export type ConfigurationErrorCode =
  | 'INVALID_DESCRIPTOR'
  | 'INVALID_SCOPE'
  | 'INVALID_SOURCE'
  | 'PROVIDER_EXISTS'
  | 'PROVIDER_NOT_FOUND'
  | 'SOURCE_READ_FAILED'
  | 'INVALID_PATH'
  | 'NOT_FOUND'
  | 'VALIDATION_FAILED';

export class ConfigurationError extends Error {
  public readonly code: ConfigurationErrorCode;
  public readonly path?: string;
  public readonly scope?: string;

  public constructor(
    message: string,
    code: ConfigurationErrorCode,
    path?: string,
    scope?: string,
  ) {
    super(message);
    this.name = 'ConfigurationError';
    this.code = code;
    this.path = path;
    this.scope = scope;
  }
}
