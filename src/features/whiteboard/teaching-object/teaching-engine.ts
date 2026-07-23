import { teachingObjectRegistry } from './registry/teaching-object-registry.js';
import { teachingLifecycleManager } from './lifecycle/teaching-lifecycle.js';
import { teachingRuntimeManager } from './runtime/teaching-runtime.js';
import { teachingEventBus } from './event/teaching-event-bus.js';
import { teacherContextManager } from './context/teacher-context.js';
import { studentContextManager } from './context/student-context.js';
import { assessmentInterface } from './assessment/assessment-interface.js';
import { learningAnalyticsEngine } from './analytics/learning-analytics.js';
import { aiInterface } from './ai/ai-interface.js';
import { teachingPluginSDK } from './plugin-sdk/teaching-plugin-sdk.js';

export class TeachingEngine {
  readonly registry = teachingObjectRegistry;
  readonly lifecycle = teachingLifecycleManager;
  readonly runtime = teachingRuntimeManager;
  readonly eventBus = teachingEventBus;
  readonly teacherContext = teacherContextManager;
  readonly studentContext = studentContextManager;
  readonly assessment = assessmentInterface;
  readonly analytics = learningAnalyticsEngine;
  readonly ai = aiInterface;
  readonly pluginSDK = teachingPluginSDK;
}

export const teachingEngine = new TeachingEngine();
