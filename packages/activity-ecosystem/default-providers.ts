/**
 * OpenLearn Activity Ecosystem — Official Activity Providers (Sprint P7-01)
 *
 * Official classroom activities are registered as Activity Providers through
 * the SAME mechanism a third-party plugin uses. They are DEFAULT implementations
 * — they do not hardcode behaviour into the Lesson or Workspace, and they
 * reuse existing Classroom Action APIs (command types) and the Event Bus.
 *
 * Where a canonical command already exists (assignment, attendance) it is wired
 * directly. Where an optional plugin owns the command (quiz, vote, roll-call)
 * the `commandType` is set so the activity reuses it when present, and degrades
 * gracefully otherwise.
 */

import type { ActionDescriptor } from '../core/registry/index.js';
import type { IActionRegistryService } from '../core/di/interfaces.js';
import type { ActivityProviderDescriptor } from './types.js';
import { BaseActivityProvider } from './provider.js';

/** Provider namespace for built-in activities. */
export const OFFICIAL_PROVIDER = 'official';

/**
 * Build the AI Action contribution for an activity so it can be invoked by the
 * AI agent through the existing ActionRegistry (the same GenAI tool pipeline
 * the rest of the platform uses). Reuses `commandType` when available.
 */
function aiActionFor(d: ActivityProviderDescriptor): ActionDescriptor {
  return {
    id: `activity_ai_${d.id}`,
    commandType: d.commandType ?? `activity.${d.id}.start`,
    description: `Start the ${d.name} activity${d.description ? ` — ${d.description}` : ''}`,
    inputSchema: {
      type: 'OBJECT',
      properties: {
        payload: {
          type: 'OBJECT',
          description: `Optional configuration for the ${d.name} activity`,
        },
      },
    },
    capabilityRequired: d.permissions?.[0] ?? 'lesson:read',
  };
}

/**
 * Declarative definitions of every official activity. Each becomes an
 * `ActivityProvider` via `BaseActivityProvider` — identical to how a plugin
 * would register one.
 */
export const OFFICIAL_ACTIVITY_DEFINITIONS: ActivityProviderDescriptor[] = [
  {
    id: 'official_quiz',
    name: 'Quiz',
    description: 'In-class multiple choice / graded quiz.',
    icon: 'HelpCircle',
    category: 'assessment',
    permissions: ['quiz:write'],
    supportedRoles: ['teacher', 'student', 'all'],
    supportedDevices: ['desktop', 'tablet', 'all'],
    tags: ['assessment', 'quiz'],
    version: '1.0.0',
    provider: OFFICIAL_PROVIDER,
    commandType: 'quiz.create',
  },
  {
    id: 'official_vote',
    name: 'Vote',
    description: 'Quick classroom vote / poll on a question.',
    icon: 'Vote',
    category: 'engagement',
    permissions: ['lesson:control'],
    supportedRoles: ['teacher', 'student', 'all'],
    supportedDevices: ['desktop', 'tablet', 'mobile', 'all'],
    tags: ['engagement', 'vote', 'poll'],
    version: '1.0.0',
    provider: OFFICIAL_PROVIDER,
    commandType: 'vote.create',
  },
  {
    id: 'official_poll',
    name: 'Poll',
    description: 'Live polling with instant results.',
    icon: 'BarChart3',
    category: 'engagement',
    permissions: ['lesson:control'],
    supportedRoles: ['teacher', 'student', 'all'],
    supportedDevices: ['desktop', 'tablet', 'mobile', 'all'],
    tags: ['engagement', 'poll'],
    version: '1.0.0',
    provider: OFFICIAL_PROVIDER,
    commandType: 'poll.create',
  },
  {
    id: 'official_discussion',
    name: 'Discussion',
    description: 'Whole-class or group real-time discussion thread.',
    icon: 'MessagesSquare',
    category: 'collaboration',
    permissions: ['lesson:control'],
    supportedRoles: ['teacher', 'student', 'all'],
    supportedDevices: ['desktop', 'tablet', 'all'],
    tags: ['collaboration', 'discussion'],
    version: '1.0.0',
    provider: OFFICIAL_PROVIDER,
    commandType: 'discussion.create',
  },
  {
    id: 'official_grouping',
    name: 'Grouping',
    description: 'Auto / random / manual student grouping.',
    icon: 'Users',
    category: 'collaboration',
    permissions: ['lesson:control'],
    supportedRoles: ['teacher'],
    supportedDevices: ['desktop', 'all'],
    tags: ['collaboration', 'group'],
    version: '1.0.0',
    provider: OFFICIAL_PROVIDER,
    commandType: 'grouping.create',
  },
  {
    id: 'official_assignment',
    name: 'Assignment',
    description: 'Create, submit and grade student assignments / homework.',
    icon: 'FileText',
    category: 'management',
    permissions: ['management:write'],
    supportedRoles: ['teacher', 'student', 'all'],
    supportedDevices: ['desktop', 'tablet', 'all'],
    tags: ['management', 'assignment', 'homework'],
    version: '1.0.0',
    provider: OFFICIAL_PROVIDER,
    commandType: 'assignment.create',
  },
  {
    id: 'official_competition',
    name: 'Competition',
    description: 'Timed leaderboard competition between students / groups.',
    icon: 'Trophy',
    category: 'engagement',
    permissions: ['lesson:control'],
    supportedRoles: ['teacher', 'student', 'all'],
    supportedDevices: ['desktop', 'tablet', 'mobile', 'all'],
    tags: ['engagement', 'competition', 'gamification'],
    version: '1.0.0',
    provider: OFFICIAL_PROVIDER,
    commandType: 'competition.create',
  },
  {
    id: 'official_checkin',
    name: 'Check-in',
    description: 'Take class attendance / check-in.',
    icon: 'CheckCircle2',
    category: 'management',
    permissions: ['management:write'],
    supportedRoles: ['teacher'],
    supportedDevices: ['desktop', 'tablet', 'mobile', 'all'],
    tags: ['management', 'attendance', 'checkin'],
    version: '1.0.0',
    provider: OFFICIAL_PROVIDER,
    commandType: 'attendance.record',
  },
  {
    id: 'official_homework',
    name: 'Homework',
    description: 'Assign and track out-of-class homework.',
    icon: 'BookOpen',
    category: 'management',
    permissions: ['management:write'],
    supportedRoles: ['teacher', 'student', 'all'],
    supportedDevices: ['desktop', 'tablet', 'all'],
    tags: ['management', 'homework', 'assignment'],
    version: '1.0.0',
    provider: OFFICIAL_PROVIDER,
    commandType: 'assignment.create',
  },
];

/**
 * Register all official activity providers into the registry, and (optionally)
 * contribute their AI Actions into the existing ActionRegistry so the AI agent
 * can start them through the shared GenAI tool pipeline.
 *
 * This is the ONLY place official activities are wired — no Lesson / Workspace
 * hardcoding.
 */
export function registerOfficialActivities(
  registry: { registerProvider: (p: BaseActivityProvider) => void },
  actionRegistry?: IActionRegistryService,
): void {
  for (const def of OFFICIAL_ACTIVITY_DEFINITIONS) {
    const descriptor: ActivityProviderDescriptor = {
      ...def,
      aiAction: aiActionFor(def),
    };
    registry.registerProvider(new BaseActivityProvider({ descriptor }));

    if (actionRegistry && descriptor.aiAction) {
      // Reuse the existing ActionRegistry — never a second AI tool registry.
      actionRegistry.register(descriptor.aiAction);
    }
  }
}
