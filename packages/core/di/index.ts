/**
 * DI (Dependency Injection) subsystem barrel export.
 *
 * Provides:
 * - Token<T> — type-safe service identifier
 * - ServiceRegistry — register / resolve / unregister container
 * - Error classes — named error hierarchy for all DI failure paths
 * - Types — shared type definitions
 * - IService interfaces — 7 type-safe service contracts (Phase 2: Token 化)
 * - Token instances — 7 named DI tokens for service resolution
 * - Service implementations — StorageService (KV store) + AIService (AI text gen)
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

// ── IService interface type exports ─────────────────────────────────────

export type {
  ICommandBusService,
  IEventBusService,
  IActionRegistryService,
  ICapabilityService,
  IProcessService,
  IStorageService,
  IAIService,
} from './interfaces.js';

// ── Token instance exports ──────────────────────────────────────────────

export {
  ICommandBusServiceToken,
  IEventBusServiceToken,
  IActionRegistryServiceToken,
  ICapabilityServiceToken,
  IProcessServiceToken,
  IStorageServiceToken,
  IAIServiceToken,
  IPluginHostToken,
} from './interfaces.js';

// ── Service implementation class exports ────────────────────────────────

export { StorageService } from './storage-service.js';
export { AIService } from './ai-service.js';
