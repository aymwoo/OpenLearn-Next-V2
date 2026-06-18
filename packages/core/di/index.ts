/**
 * DI (Dependency Injection) subsystem barrel export.
 *
 * Provides:
 * - Token<T> — type-safe service identifier
 * - ServiceRegistry — register / resolve / unregister container
 * - Error classes — named error hierarchy for all DI failure paths
 * - Types — shared type definitions
 */
export { Token } from './token.js';
export { ServiceRegistry } from './service-registry.js';
export {
  DuplicateRegistrationError,
  MissingDependencyError,
  CircularDependencyError,
  HasDependentError,
  TokenError,
} from './errors.js';
export type { RegisterOptions, ServiceEntry, DepEdge } from './types.js';
