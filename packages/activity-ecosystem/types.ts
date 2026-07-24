/**
 * OpenLearn Activity Ecosystem — Core Types (Sprint P7-01)
 *
 * Every classroom activity is modelled as an Activity Provider. Official
 * activities and third-party plugin activities use exactly the same
 * descriptor + lifecycle contract, so the ecosystem is fully extensible.
 *
 * IMPORTANT — reuse, never recreate:
 *   - An activity NEVER creates its own context. It reuses the existing
 *     Classroom Context / Session through `ActivityContext`, which is just a
 *     thin, read-only projection of the services a plugin already receives
 *     (`commandBus`, `eventBus`, `actionRegistry`, `capability`, `ai`) plus
 *     the live classroom/session metadata.
 *   - An activity NEVER calls business modules directly. It executes existing
 *     Classroom Action APIs (i.e. a `commandType` on the Command Bus) and
 *     publishes/consumes existing Classroom Events via the Event Bus.
 */

import type { ActionDescriptor } from '../core/registry/index.js';
import type {
  ICommandBusService,
  IEventBusService,
  IActionRegistryService,
  ICapabilityService,
  IAIService,
} from '../core/di/interfaces.js';

/** Functional grouping used by the Workspace catalogue. */
export type ActivityCategory =
  | 'assessment'
  | 'engagement'
  | 'collaboration'
  | 'management'
  | 'ai'
  | 'media'
  | 'custom';

/** Roles that may see / launch / participate in an activity. */
export type ActivityRole = 'teacher' | 'student' | 'assistant' | 'observer' | 'all';

/** Device classes the activity UI supports. */
export type ActivityDevice = 'desktop' | 'tablet' | 'mobile' | 'all';

/** Lifecycle state of a registered activity provider instance. */
export type ActivityLifecycleState =
  | 'registered'
  | 'initialized'
  | 'running'
  | 'paused'
  | 'finished'
  | 'disposed';

/**
 * Read-only projection of the existing Classroom Context / Session.
 * Activities must reuse this object — they must not build their own.
 * `raw` may carry the concrete classroom-runtime context when available.
 */
export interface ActivityClassroomContext {
  readonly classroomId?: string;
  readonly sessionId?: string;
  readonly role?: string;
  readonly permissions?: string[];
  readonly lifecycleState?: string;
  /** The concrete classroom-runtime context object, when supplied by the host. */
  readonly raw?: unknown;
}

/**
 * The minimal service surface an activity needs. It is structurally identical
 * to the services a plugin already receives on `PluginContext.services`, plus
 * the live classroom metadata. This is what makes "plugins use exactly the
 * same APIs" possible.
 */
export interface ActivityContext {
  readonly commandBus: ICommandBusService;
  readonly eventBus: IEventBusService;
  readonly actionRegistry: IActionRegistryService;
  readonly capability: ICapabilityService;
  readonly ai: IAIService;
  /** Optional live classroom / session metadata (reused, never created). */
  readonly classroom?: ActivityClassroomContext | null;
}

/**
 * The static, declarative metadata every Activity Provider exposes. This is
 * what the Workspace catalogue, permission runtime and AI runtime consume.
 */
export interface ActivityProviderDescriptor {
  /** Stable unique id, e.g. `official_quiz` or `ext-foo:poll`. */
  id: string;
  /** Human readable name. */
  name: string;
  description?: string;
  /** Icon hint (lucide name or emoji) for the Workspace widget. */
  icon?: string;
  category: ActivityCategory;
  /** Capabilities required to *start* this activity (permission isolation). */
  permissions?: string[];
  /** Roles that may access this activity. `all` = teacher + student + others. */
  supportedRoles: ActivityRole[];
  /** Device classes supported by the activity UI. */
  supportedDevices?: ActivityDevice[];
  tags?: string[];
  /** Semantic version of the provider. */
  version: string;
  /** `official` for built-in activities, otherwise the plugin id. */
  provider: string;
  /**
   * The EXISTING classroom command this activity executes on `start`.
   * Reuses the Classroom Action API — never a new bespoke dispatcher.
   * If the backing command is not installed, the start still publishes the
   * `activity.started` event (graceful degradation, no error thrown).
   */
  commandType?: string;
  /** Optional AI Action contribution (registered into the ActionRegistry). */
  aiAction?: ActionDescriptor;
  /** Optional AI context contribution, merged into the classroom AI context. */
  aiContext?: Record<string, unknown>;
}

/**
 * The Activity Provider contract. Official activities and plugin activities
 * implement this through the same `BaseActivityProvider` / `defineActivityProvider`
 * helpers, and are driven through the same lifecycle by the ActivityRegistry.
 */
export interface ActivityProvider {
  readonly descriptor: ActivityProviderDescriptor;
  readonly state: ActivityLifecycleState;
  initialize(context: ActivityContext): Promise<void> | void;
  start(context: ActivityContext, payload?: Record<string, unknown>): Promise<unknown>;
  pause(context: ActivityContext): Promise<void> | void;
  resume(context: ActivityContext): Promise<void> | void;
  finish(context: ActivityContext): Promise<void> | void;
  dispose(context: ActivityContext): Promise<void> | void;
}
