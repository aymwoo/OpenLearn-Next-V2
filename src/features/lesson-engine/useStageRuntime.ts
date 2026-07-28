/**
 * OpenLearn Lesson Flow Engine - React Hook for Stage Runtime & Analytics
 */

import { useLessonEngineStore } from './lessonEngineStore.js';
import { Stage, StageAnalytics } from '../../../packages/core/lesson-engine/types.js';

export function useStageRuntime(): {
  currentStage: Stage | null;
  stageElapsedSeconds: number;
  pauseStage: () => void;
  resumeStage: () => void;
  skipStage: (stageId: string) => boolean;
  lockStage: (stageId: string, locked?: boolean) => boolean;
  analytics: StageAnalytics | null;
} {
  const currentStage = useLessonEngineStore((s) => s.currentStage);
  const stageElapsedSeconds = useLessonEngineStore((s) => s.stageElapsedSeconds);
  const runtime = useLessonEngineStore((s) => s.runtime);
  const skipStage = useLessonEngineStore((s) => s.skipStage);
  const lockStage = useLessonEngineStore((s) => s.lockStage);

  const pauseStage = () => runtime.stageRuntime.pauseStage();
  const resumeStage = () => runtime.stageRuntime.resumeStage();
  const analytics = currentStage?.analytics || null;

  return {
    currentStage,
    stageElapsedSeconds,
    pauseStage,
    resumeStage,
    skipStage,
    lockStage,
    analytics,
  };
}
