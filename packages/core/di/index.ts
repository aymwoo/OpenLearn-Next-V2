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
  CoursewareRuntimeScript,
  IRegisteredCoursewareRuntimeScript,
  ICoursewareRuntimeScriptRegistry,
  FilePurpose,
  FileAccessScope,
  FileAssetContext,
  FileStorageBackendCapabilities,
  FileStorageBackend,
  FileProcessorStage,
  FileProcessorContext,
  FileProcessorResult,
  FileProcessor,
  FileLayoutTokenResolver,
  IRegisteredFileBackend,
  IRegisteredFileProcessor,
  IFileStorageExtensionRegistry,
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
  ICoursewareRuntimeScriptRegistryToken,
  IFileStorageExtensionRegistryToken,
} from './interfaces.js';

// ── Service implementation class exports ────────────────────────────────

export { StorageService } from './storage-service.js';
export { AIService } from './ai-service.js';
export { CreditRedemptionService, DEFAULT_REDEEM_DIMENSION } from './credit-redemption-service.js';
export type { RedeemCreditInput, RedeemResult, RedeemFailureCode } from './credit-redemption-service.js';
export { ClassroomMessageService } from './classroom-message-service.js';
export type {
  SendMessageInput,
  SendMessageResult,
  ReplayedMessage,
  ReplayQuery,
  MessageEventPublisher,
  MessageSideEffectEnqueuer,
} from './classroom-message-service.js';
export { AssignmentSubmissionService, AssignmentSubmissionAccessError } from './assignment-submission-service.js';
export { XueanActivityProgressService, XueanActivityProgressAccessError } from './xuean-activity-progress-service.js';
export { LessonReportService, LessonReportAccessError } from './lesson-report-service.js';
export {
  ClassroomSelfMessageService,
  ClassroomSelfMessageAccessError,
  ClassroomSelfMessageInputError,
} from './classroom-self-message-service.js';
export { DbSideEffectEnqueuer } from './pending-side-effect-enqueuer.js';
export { CreditAwardService, BUILTIN_AWARD_SOURCES } from './credit-award-service.js';
export type {
  AwardCreditInput,
  AwardResult,
  AwardFailureCode,
  CreditEventPublisher,
  SideEffectEnqueuer,
} from './credit-award-service.js';
export { RewardCatalogService } from './reward-catalog-service.js';
export type {
  RewardItem,
  RewardEligibility,
  CreateRewardInput,
  ResolveResult,
  ResolveFailureCode,
  ResolveContext,
} from './reward-catalog-service.js';
export { CoursewareRuntimeScriptRegistry } from './courseware-runtime-script-registry.js';
export { FileStorageExtensionRegistry } from './file-storage-extension-registry.js';
export * from './ai-provider-resolver.js';

// ── Platform DI Container (PI-008) ──────────────────────────────────────

export * from './container/index.js';
