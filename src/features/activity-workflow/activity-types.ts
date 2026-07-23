/**
 * OpenLearn Activity Workflow - Data Types & Contracts (Sprint P3-03)
 */

export type ActivityType =
  | 'Quiz'
  | 'Poll'
  | 'Brainstorm'
  | 'Discussion'
  | 'Assignment'
  | 'PluginActivity';

export interface ActivityDescriptor {
  readonly id: string;
  readonly title: string;
  readonly type: ActivityType;
  readonly description?: string;
  readonly config?: Record<string, unknown>;
}

export interface IActivityProvider {
  readonly id: string;
  readonly type: ActivityType;
  readonly createActivity: (title: string, config?: Record<string, unknown>) => ActivityDescriptor;
  readonly executeActivity?: (descriptor: ActivityDescriptor, context?: unknown) => unknown;
}
