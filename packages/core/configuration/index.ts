/**
 * Platform Configuration System — barrel exports (PI-011).
 *
 * Provides a unified, platform-only configuration abstraction: loading from
 * multiple sources (memory / environment / JSON / optional YAML), validation
 * (required / default / type / range / enum), snapshots, and integration with
 * the builder, bootstrap pipeline, composition root, service registry, DI
 * container, capability runtime, and event bus. It does NOT manage
 * business-module configuration.
 */

export { PlatformConfiguration, type PlatformConfigurationOptions } from './PlatformConfiguration.js';
export { ConfigurationRegistry } from './ConfigurationRegistry.js';
export { ConfigurationProvider } from './ConfigurationProvider.js';
export {
  ConfigurationSource,
  MemorySource,
  EnvironmentSource,
  JsonFileSource,
  YamlFileSource,
  buildSource,
} from './ConfigurationSource.js';
export { ConfigurationDescriptor } from './ConfigurationDescriptor.js';
export { ConfigurationLoader } from './ConfigurationLoader.js';
export { ConfigurationValidator } from './ConfigurationValidator.js';
export { ConfigurationSnapshot } from './ConfigurationSnapshot.js';
export { ConfigurationContext } from './ConfigurationContext.js';
export { ConfigurationError, type ConfigurationErrorCode } from './ConfigurationError.js';
export {
  ALL_CONFIGURATION_SCOPES,
  type ConfigurationScope,
  type ConfigurationValueType,
  type ConfigurationDescriptorInit,
  type ConfigurationProviderInit,
  type ConfigurationSourceInit,
  type ConfigurationSourceKind,
  type ConfigurationValidationCode,
  type ConfigurationValidationError,
  type ConfigurationValidationReport,
  type ConfigurationLoadResult,
  type ServiceRegistryIntegrationSource,
  type ContainerIntegrationSource,
  type EventBusIntegrationSource,
  type BuilderIntegrationSource,
  type BootstrapPipelineIntegrationSource,
  type CompositionRootIntegrationSource,
  type CapabilityRuntimeIntegrationSource,
} from './types.js';
