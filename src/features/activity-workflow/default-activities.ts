/**
 * OpenLearn Activity Workflow - Default Activity Providers (Sprint P3-03)
 */

import { ActivityRegistry } from './activity-registry.js';
import { ActivityType, IActivityProvider } from './activity-types.js';

export const createDefaultActivityProvider = (type: ActivityType, name: string): IActivityProvider => ({
  id: `provider_official_${type.toLowerCase()}`,
  type,
  createActivity: (title: string, config?: Record<string, unknown>) => ({
    id: `act_${type.toLowerCase()}_${Date.now()}`,
    title: title || `${name} Activity`,
    type,
    config,
  }),
});

export const registerDefaultActivities = (registry: ActivityRegistry): void => {
  registry.registerProvider(createDefaultActivityProvider('Quiz', 'Quiz'));
  registry.registerProvider(createDefaultActivityProvider('Poll', 'Poll'));
  registry.registerProvider(createDefaultActivityProvider('Brainstorm', 'Brainstorm'));
  registry.registerProvider(createDefaultActivityProvider('Discussion', 'Discussion'));
  registry.registerProvider(createDefaultActivityProvider('Assignment', 'Assignment'));
};
