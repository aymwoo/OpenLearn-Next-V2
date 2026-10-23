/**
 * OpenLearn Platform Kernel - Extension Points Contract & Deprecation Metadata
 *
 * Defines the canonical metadata for all extensible primitives:
 * - Commands
 * - Events
 * - UI Slots (Extension Points)
 * - Dependency Injection Services
 */

export type ExtensionPointKind = 'command' | 'event' | 'slot' | 'service';

export interface ExtensionPointMetadata {
  readonly id: string;
  readonly kind: ExtensionPointKind;
  readonly description: string;
  readonly since: string;
  readonly deprecated?: string;
  readonly removedIn?: string;
  readonly replacement?: string;
}

/**
 * Canonical registry of core platform extension points and their lifecycles.
 */
export const CORE_EXTENSION_POINTS: ReadonlyArray<ExtensionPointMetadata> = [
  // ── Commands ─────────────────────────────────────────────────────────────
  {
    id: 'lesson.create',
    kind: 'command',
    description: 'Create a new lesson',
    since: '0.1.0',
  },
  {
    id: 'lesson.update',
    kind: 'command',
    description: 'Update lesson attributes or content',
    since: '0.1.0',
  },
  {
    id: 'lesson.delete',
    kind: 'command',
    description: 'Delete a lesson',
    since: '0.1.0',
  },
  {
    id: 'assignment.grade',
    kind: 'command',
    description: 'Grade a student assignment submission',
    since: '0.2.0',
  },
  {
    id: 'assignment.peer_review',
    kind: 'command',
    description: 'Submit a peer review for an assignment',
    since: '0.3.0',
  },
  {
    id: 'whiteboard.draw',
    kind: 'command',
    description: 'Draw or insert element on whiteboard',
    since: '0.1.0',
  },
  {
    id: 'whiteboard.clear',
    kind: 'command',
    description: 'Clear elements on whiteboard',
    since: '0.1.0',
  },
  {
    id: 'vfs.write_file',
    kind: 'command',
    description: 'Write file content to Virtual File System',
    since: '0.2.0',
  },
  {
    id: 'vfs.read_file',
    kind: 'command',
    description: 'Read file content from Virtual File System',
    since: '0.2.0',
  },
  {
    id: 'vfs.read_path',
    kind: 'command',
    description: 'Legacy path reading command',
    since: '0.1.0',
    deprecated: '0.6.0',
    removedIn: '0.7.0',
    replacement: "Use 'vfs.read_file' instead",
  },
  {
    id: 'classroom.legacy_poll',
    kind: 'command',
    description: 'Legacy quick poll invocation',
    since: '0.1.0',
    deprecated: '0.5.0',
    removedIn: '0.7.0',
    replacement: "Use 'classroom.quick_poll' instead",
  },

  // ── Events ───────────────────────────────────────────────────────────────
  {
    id: 'lesson.created',
    kind: 'event',
    description: 'Fired when a lesson is created',
    since: '0.1.0',
  },
  {
    id: 'lesson.updated',
    kind: 'event',
    description: 'Fired when a lesson is modified',
    since: '0.1.0',
  },
  {
    id: 'lesson.deleted',
    kind: 'event',
    description: 'Fired when a lesson is deleted',
    since: '0.1.0',
  },
  {
    id: 'assignment.graded',
    kind: 'event',
    description: 'Fired when an assignment submission is graded',
    since: '0.2.0',
  },
  {
    id: 'classroom.pacing_updated',
    kind: 'event',
    description: 'Fired when teaching pacing or stage updates',
    since: '0.3.0',
  },
  {
    id: 'classroom.quick_poll_updated',
    kind: 'event',
    description: 'Fired when a live quick poll state updates',
    since: '0.3.0',
  },
  {
    id: 'quiz.answered',
    kind: 'event',
    description: 'Fired when a student answers a quiz with correctIndex',
    since: '0.6.0',
  },
  {
    id: 'whiteboard.quiz_answered',
    kind: 'event',
    description: 'Legacy quiz answered event without correctIndex standardization',
    since: '0.1.0',
    deprecated: '0.6.0',
    removedIn: '0.7.0',
    replacement: "Use 'quiz.answered' instead",
  },

  // ── UI Slots ─────────────────────────────────────────────────────────────
  {
    id: 'teacher.tab',
    kind: 'slot',
    description: 'Navigation tab in teacher view',
    since: '0.1.0',
  },
  {
    id: 'classroom.tool',
    kind: 'slot',
    description: 'Toolbar button in live classroom',
    since: '0.1.0',
  },
  {
    id: 'teacher.dashboard.widget',
    kind: 'slot',
    description: 'Card widget on teacher dashboard',
    since: '0.2.0',
  },
  {
    id: 'student.view',
    kind: 'slot',
    description: 'View panel in student workspace',
    since: '0.2.0',
  },
  {
    id: 'student.lesson.tool',
    kind: 'slot',
    description: 'Tool button in student lesson interface',
    since: '0.2.0',
  },
  {
    id: 'anchor:lesson-header',
    kind: 'slot',
    description: 'Anchor point in lesson header bar',
    since: '0.2.6',
  },
  {
    id: 'anchor:teacher-top-nav',
    kind: 'slot',
    description: 'Anchor point in teacher top navigation bar',
    since: '0.2.6',
  },
  {
    id: 'legacy.classroom.tab',
    kind: 'slot',
    description: 'Deprecated legacy classroom tab slot',
    since: '0.1.0',
    deprecated: '0.5.0',
    removedIn: '0.7.0',
    replacement: "Use 'teacher.tab' instead",
  },

  // ── Services ─────────────────────────────────────────────────────────────
  {
    id: '@openlearn/core:ICommandBusService',
    kind: 'service',
    description: 'Command Bus service token',
    since: '0.1.0',
  },
  {
    id: '@openlearn/core:IEventBusService',
    kind: 'service',
    description: 'Event Bus service token',
    since: '0.1.0',
  },
  {
    id: '@openlearn/core:IStorageService',
    kind: 'service',
    description: 'Persistent file storage service token',
    since: '0.1.0',
  },
  {
    id: '@openlearn/core:IAIService',
    kind: 'service',
    description: 'AI model generation and agent services token',
    since: '0.2.0',
  },
  {
    id: '@openlearn/core:IDatabase',
    kind: 'service',
    description: 'Database connection token for plugins',
    since: '0.1.0',
  },
  {
    id: '@openlearn/core:ILegacyAuthService',
    kind: 'service',
    description: 'Deprecated authentication service token',
    since: '0.1.0',
    deprecated: '0.5.0',
    removedIn: '0.7.0',
    replacement: "Use '@openlearn/core:IAuthService' instead",
  },
];

const EXTENSION_POINT_MAP = new Map<string, ExtensionPointMetadata>(CORE_EXTENSION_POINTS.map((ep) => [ep.id, ep]));

/**
 * Get metadata for an extension point by its identifier.
 */
export function getExtensionPointMetadata(id: string): ExtensionPointMetadata | undefined {
  return EXTENSION_POINT_MAP.get(id);
}

/**
 * Deduplication cache for runtime deprecation warnings.
 */
const emittedWarnings = new Set<string>();

/**
 * Reset emitted warnings (used in tests).
 */
export function resetDeprecationWarnings(): void {
  emittedWarnings.clear();
}

/**
 * Issue a runtime deprecation warning if the given extension point is deprecated.
 * Returns the warning message string if emitted, or null otherwise.
 */
export function warnDeprecation(kind: ExtensionPointKind, name: string, callerPluginId?: string): string | null {
  const meta = getExtensionPointMetadata(name);
  if (!meta || !meta.deprecated) {
    return null;
  }

  const pluginTag = callerPluginId ? `Plugin "${callerPluginId}"` : 'A plugin/caller';
  const warnKey = `${callerPluginId || '*'}:${kind}:${name}`;

  const message =
    `[DeprecationWarning] ${pluginTag} is using deprecated ${kind} "${name}" ` +
    `(deprecated since v${meta.deprecated}, will be removed in v${meta.removedIn || 'a future minor release'}). ` +
    `Replacement: ${meta.replacement || 'none'}.`;

  if (!emittedWarnings.has(warnKey)) {
    emittedWarnings.add(warnKey);
    console.warn(message);
  }

  return message;
}
