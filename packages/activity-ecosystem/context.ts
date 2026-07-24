/**
 * OpenLearn Activity Ecosystem — Activity Context (Sprint P7-01)
 *
 * Builds an `ActivityContext` from the services a plugin (or the host) already
 * has. Activities receive this context but NEVER construct their own — they
 * reuse the existing Classroom Context / Session through it.
 */

import type {
  ActivityContext,
  ActivityClassroomContext,
} from './types.js';

export interface CreateActivityContextOptions {
  commandBus: ActivityContext['commandBus'];
  eventBus: ActivityContext['eventBus'];
  actionRegistry: ActivityContext['actionRegistry'];
  capability: ActivityContext['capability'];
  ai: ActivityContext['ai'];
  /** Optional live classroom / session metadata (reused, never created). */
  classroom?: ActivityClassroomContext | null;
}

/**
 * Construct an `ActivityContext` from existing services.
 *
 * Works identically for:
 *   - the host (server bootstrap) — passing `kernelContainer.*` services, or
 *   - a plugin — passing `ctx.services.*` (the same API a plugin already uses).
 */
export function createActivityContext(opts: CreateActivityContextOptions): ActivityContext {
  return {
    commandBus: opts.commandBus,
    eventBus: opts.eventBus,
    actionRegistry: opts.actionRegistry,
    capability: opts.capability,
    ai: opts.ai,
    classroom: opts.classroom ?? null,
  };
}
