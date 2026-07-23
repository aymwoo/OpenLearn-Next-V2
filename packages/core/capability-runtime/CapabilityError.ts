/**
 * CapabilityError — the error hierarchy for the Capability Runtime (PI-009).
 *
 * Every capability failure path raises a named `CapabilityError` carrying a
 * stable `code`, the offending `capabilityId` (when known), and the current
 * resolution path so callers can diagnose dependency chains.
 */

export type CapabilityErrorCode =
  | 'DUPLICATE_CAPABILITY'
  | 'MISSING_CAPABILITY'
  | 'INVALID_DESCRIPTOR'
  | 'CIRCULAR_DEPENDENCY'
  | 'INVALID_TRANSITION'
  | 'PROVIDER_FAILED'
  | 'VALIDATION_FAILED';

export class CapabilityError extends Error {
  public readonly code: CapabilityErrorCode;
  public readonly capabilityId?: string;
  public readonly resolutionPath: ReadonlyArray<string>;

  public constructor(
    message: string,
    code: CapabilityErrorCode,
    capabilityId?: string,
    resolutionPath: ReadonlyArray<string> = [],
  ) {
    super(message);
    this.name = 'CapabilityError';
    this.code = code;
    this.capabilityId = capabilityId;
    this.resolutionPath = Object.freeze([...resolutionPath]);
  }
}
