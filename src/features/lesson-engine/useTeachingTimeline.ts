/**
 * OpenLearn Lesson Flow Engine - React Hook for Teaching Timeline Controls
 */

import { useLessonEngineStore } from './lessonEngineStore.js';

export function useTeachingTimeline() {
  const currentStageIndex = useLessonEngineStore((s) => s.currentStageIndex);
  const currentActivityIndex = useLessonEngineStore((s) => s.currentActivityIndex);
  const currentStage = useLessonEngineStore((s) => s.currentStage);
  const currentActivity = useLessonEngineStore((s) => s.currentActivity);
  const stageElapsedSeconds = useLessonEngineStore((s) => s.stageElapsedSeconds);
  const totalElapsedSeconds = useLessonEngineStore((s) => s.totalElapsedSeconds);
  const isPreviewMode = useLessonEngineStore((s) => s.isPreviewMode);

  const nextStage = useLessonEngineStore((s) => s.nextStage);
  const backStage = useLessonEngineStore((s) => s.backStage);
  const jumpStage = useLessonEngineStore((s) => s.jumpStage);
  const runtime = useLessonEngineStore((s) => s.runtime);

  const restartTimeline = () => runtime.timeline.restart();
  const setPreviewMode = (preview: boolean) => runtime.timeline.setPreview(preview);

  return {
    currentStageIndex,
    currentActivityIndex,
    currentStage,
    currentActivity,
    stageElapsedSeconds,
    totalElapsedSeconds,
    isPreviewMode,
    next: nextStage,
    previous: backStage,
    jump: jumpStage,
    restart: restartTimeline,
    setPreview: setPreviewMode,
  };
}
