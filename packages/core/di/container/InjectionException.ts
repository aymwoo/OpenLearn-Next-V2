/**
 * InjectionException — the single, typed error type used by the
 * Platform Dependency Injection Container (PI-008).
 *
 * Every failure in the container (missing dependency, circular dependency,
 * unknown service, invalid descriptor, scope disposal) is surfaced through
 * this class so consumers can branch on `code` rather than parse messages.
 */

export type InjectionErrorCode =
  | 'CIRCULAR_DEPENDENCY'
  | 'MISSING_DEPENDENCY'
  | 'AMBIGUOUS_DEPENDENCY'
  | 'UNKNOWN_SERVICE'
  | 'INVALID_DESCRIPTOR'
  | 'SCOPE_DISPOSED'
  | 'POLICY_VIOLATION';

export class InjectionException extends Error {
  public readonly code: InjectionErrorCode;
  public readonly serviceId?: string;
  public readonly resolutionPath: ReadonlyArray<string>;

  constructor(
    message: string,
    code: InjectionErrorCode,
    serviceId?: string,
    resolutionPath: ReadonlyArray<string> = [],
  ) {
    super(`[DI] ${message}`);
    this.name = 'InjectionException';
    this.code = code;
    this.serviceId = serviceId;
    this.resolutionPath = Object.freeze([...resolutionPath]);
    // Restore prototype chain (TS extending built-ins)
    Object.setPrototypeOf(this, InjectionException.prototype);
  }
}
