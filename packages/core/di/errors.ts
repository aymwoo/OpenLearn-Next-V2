/**
 * Named error classes for the DI container.
 *
 * Each error includes the relevant Token name(s) and contextual information
 * to aid debugging.  Error messages follow the project logging convention
 * (`[Subsystem]` prefix tags — see CONVENTIONS.md).
 */

/**
 * Thrown by the Token constructor when the name is empty or does not match
 * the required naming format `@scope/domain:ServiceName`.
 */
export class TokenError extends Error {
  constructor(message: string) {
    super(`[Token] ${message}`);
    this.name = 'TokenError';
  }
}

/**
 * Thrown by ServiceRegistry.register() when a Token is already registered.
 *
 * The error message hints at `registerOrReplace()` as the explicit overwrite
 * path (see D-08).
 */
export class DuplicateRegistrationError extends Error {
  constructor(public readonly tokenName: string) {
    super(
      `[ServiceRegistry] Duplicate registration: "${tokenName}" is already registered. ` +
        `Use registerOrReplace() to overwrite.`
    );
    this.name = 'DuplicateRegistrationError';
  }
}

/**
 * Thrown by ServiceRegistry.register() when one or more required
 * dependencies are not yet registered (see D-06).
 */
export class MissingDependencyError extends Error {
  constructor(
    public readonly tokenName: string,
    public readonly missingDeps: string[]
  ) {
    super(
      `[ServiceRegistry] Cannot register "${tokenName}": missing dependencies: ` +
        `${missingDeps.join(', ')}`
    );
    this.name = 'MissingDependencyError';
  }
}

/**
 * Thrown when a circular dependency is detected during resolution.
 *
 * The `cycleTokens` array lists the Token names that participate in the
 * cycle (see ROADMAP SC-4).
 */
export class CircularDependencyError extends Error {
  constructor(public readonly cycleTokens: string[]) {
    super(
      `[ServiceRegistry] Circular dependency detected involving: ` +
        `${cycleTokens.join(' → ')}`
    );
    this.name = 'CircularDependencyError';
  }
}

/**
 * Thrown by ServiceRegistry.unregister() when other registered services
 * still depend on the Token being removed (see D-09).
 */
export class HasDependentError extends Error {
  constructor(
    public readonly tokenName: string,
    public readonly dependents: string[]
  ) {
    super(
      `[ServiceRegistry] Cannot unregister "${tokenName}": still has dependents: ` +
        `${dependents.join(', ')}. Unregister them first.`
    );
    this.name = 'HasDependentError';
  }
}
