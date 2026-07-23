/**
 * Platform Dependency Injection Container (PI-008) — barrel export.
 */

export { PlatformContainer } from './PlatformContainer.js';
export { DependencyResolver, type ResolveFn, type DependencyResolverDeps } from './DependencyResolver.js';
export {
  DependencyDescriptor,
  type DependencyDescriptorInit,
  type IDependencyDescriptor,
} from './DependencyDescriptor.js';
export { InjectionContext } from './InjectionContext.js';
export { InjectionScope, type Disposable } from './InjectionScope.js';
export { InjectionPolicy, type InjectionPolicyOptions } from './InjectionPolicy.js';
export {
  InjectionException,
  type InjectionErrorCode,
} from './InjectionException.js';
export {
  Lazy,
  mapScopeKind,
  type ServiceLifetime,
  type ServiceScopeType,
  type InjectionScopeKind,
  type DependencyDescriptorOptions,
  type ResolutionDiagnostic,
  type GraphValidationError,
  type GraphValidationReport,
} from './types.js';

// Re-export the registry so consumers can construct a container from one import.
export { PlatformServiceRegistry } from '../../service-registry/platform-service-registry.js';
