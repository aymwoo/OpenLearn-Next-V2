/**
 * Capability Runtime — barrel exports (PI-009).
 *
 * The capability runtime is a self-contained subsystem layered on top of the
 * Platform Service Registry and the Platform DI Container. It does not modify
 * or duplicate the pre-existing `capability`, `capability-governance`, or
 * `capability-system` subsystems.
 */

export { type CapabilityStatus, CAPABILITY_STATUS_TRANSITIONS, canTransition } from './CapabilityStatus.js';
export {
  CapabilityError,
  type CapabilityErrorCode,
} from './CapabilityError.js';
export { CapabilityDescriptor } from './CapabilityDescriptor.js';
export {
  CapabilityProvider,
  type CapabilityProviderInit,
  type CapabilityProviderMode,
} from './CapabilityProvider.js';
export { CapabilityContext } from './CapabilityContext.js';
export { PlatformCapability } from './PlatformCapability.js';
export { CapabilityRegistry } from './CapabilityRegistry.js';
export { CapabilityResolver } from './CapabilityResolver.js';
export { CapabilityRuntime, type CapabilityRuntimeOptions } from './CapabilityRuntime.js';
export type {
  CapabilityCategory,
  CapabilityResolutionMode,
  CapabilityActivator,
  CapabilityDescriptorInit,
  CapabilityResolutionOptions,
  CapabilityValidationError,
  CapabilityValidationReport,
  CapabilityResolutionDiagnostic,
  CapabilityResolutionHost,
  BuilderCapabilityCatalog,
  BuilderIntegrationSource,
} from './types.js';
