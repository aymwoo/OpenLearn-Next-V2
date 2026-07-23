/**
 * OpenLearn Lesson Flow Engine - React Hook for Teaching Context
 */

import { useLessonEngineStore } from './lessonEngineStore.js';
import { TeachingContextData } from '../../packages/core/lesson-engine/types.js';

export function useTeachingContext(): TeachingContextData {
  const currentLesson = useLessonEngineStore((s) => s.currentLesson);
  const activeFlow = useLessonEngineStore((s) => s.activeFlow);
  const currentStage = useLessonEngineStore((s) => s.currentStage);
  const currentActivity = useLessonEngineStore((s) => s.currentActivity);
  const currentUser = useLessonEngineStore((s) => s.currentUser);
  const isPresentationMode = useLessonEngineStore((s) => s.isPresentationMode);

  return {
    currentLesson: currentLesson || undefined,
    currentFlow: activeFlow || undefined,
    currentStage: currentStage || undefined,
    currentActivity: currentActivity || undefined,
    teacher: currentLesson?.teacher,
    currentUser,
    role: currentUser.role,
    isPresentationMode,
  };
}
