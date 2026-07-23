/**
 * OpenLearn Lesson Flow Engine - Frontend Zustand Store
 * Holds active runtime state for Lessons, Flows, Stages, Activities, and Timeline on the frontend.
 */

import { create } from 'zustand';
import {
  Lesson,
  Flow,
  Stage,
  Activity,
  UserRef,
  StageAnalytics,
  LessonSnapshot,
} from '../../packages/core/lesson-engine/types.js';
import { LessonRuntime } from '../../packages/core/lesson-engine/lesson-runtime.js';
import { eventBusService } from '../../services/event-bus.js';

interface LessonEngineStoreState {
  runtime: LessonRuntime;
  currentLesson: Lesson | null;
  activeFlow: Flow | null;
  currentStage: Stage | null;
  currentActivity: Activity | null;
  currentStageIndex: number;
  currentActivityIndex: number;
  stageElapsedSeconds: number;
  totalElapsedSeconds: number;
  isPresentationMode: boolean;
  isPreviewMode: boolean;
  currentUser: UserRef;

  // Actions
  initializeLesson: (lesson: Lesson, flowId?: string) => Promise<void>;
  startLesson: () => Promise<void>;
  pauseLesson: () => Promise<void>;
  resumeLesson: () => Promise<void>;
  stopLesson: () => Promise<StageAnalytics | null>;
  nextStage: () => boolean;
  backStage: () => boolean;
  jumpStage: (stageTarget: number | string, activityTarget?: number | string) => boolean;
  skipStage: (stageId: string) => boolean;
  lockStage: (stageId: string, locked?: boolean) => boolean;
  setPresentationMode: (enabled: boolean) => void;
  setUser: (user: UserRef) => void;
  takeSnapshot: () => LessonSnapshot;
}

const defaultUser: UserRef = {
  id: 'usr_teacher_demo',
  name: '演示教师',
  role: 'teacher',
};

// Global singleton core lesson runtime instance for frontend
const coreRuntime = new LessonRuntime({ eventBus: eventBusService as any });

export const useLessonEngineStore = create<LessonEngineStoreState>((set, get) => {
  // Subscribe to core timeline updates
  coreRuntime.timeline.subscribe((state) => {
    set({
      currentStageIndex: state.currentStageIndex,
      currentActivityIndex: state.currentActivityIndex,
      currentStage: state.currentStage || null,
      currentActivity: state.currentActivity || null,
      stageElapsedSeconds: state.stageElapsedSeconds,
      totalElapsedSeconds: state.totalElapsedSeconds,
      isPreviewMode: state.isPreview,
    });
  });

  // Subscribe to context updates
  coreRuntime.contextManager.subscribe((ctx) => {
    set({
      isPresentationMode: ctx.isPresentationMode,
    });
  });

  return {
    runtime: coreRuntime,
    currentLesson: null,
    activeFlow: null,
    currentStage: null,
    currentActivity: null,
    currentStageIndex: 0,
    currentActivityIndex: 0,
    stageElapsedSeconds: 0,
    totalElapsedSeconds: 0,
    isPresentationMode: false,
    isPreviewMode: false,
    currentUser: defaultUser,

    initializeLesson: async (lesson: Lesson, flowId?: string) => {
      await coreRuntime.startLesson(lesson, flowId);
      set({
        currentLesson: coreRuntime.getCurrentLesson(),
        activeFlow: coreRuntime.getActiveFlow(),
      });
    },

    startLesson: async () => {
      const lesson = get().currentLesson;
      if (lesson) {
        await coreRuntime.startLesson(lesson);
        set({ currentLesson: coreRuntime.getCurrentLesson() });
      }
    },

    pauseLesson: async () => {
      await coreRuntime.pauseLesson();
      set({ currentLesson: coreRuntime.getCurrentLesson() });
    },

    resumeLesson: async () => {
      await coreRuntime.resumeLesson();
      set({ currentLesson: coreRuntime.getCurrentLesson() });
    },

    stopLesson: async () => {
      const analytics = await coreRuntime.stopLesson();
      set({ currentLesson: coreRuntime.getCurrentLesson() });
      return analytics;
    },

    nextStage: () => {
      return coreRuntime.nextStage();
    },

    backStage: () => {
      return coreRuntime.backStage();
    },

    jumpStage: (stageTarget, activityTarget) => {
      return coreRuntime.jumpStage(stageTarget, activityTarget);
    },

    skipStage: (stageId) => {
      return coreRuntime.skipStage(stageId);
    },

    lockStage: (stageId, locked = true) => {
      return coreRuntime.lockStage(stageId, locked);
    },

    setPresentationMode: (enabled) => {
      coreRuntime.setPresentationMode(enabled);
    },

    setUser: (user) => {
      coreRuntime.contextManager.setUser(user);
      set({ currentUser: user });
    },

    takeSnapshot: () => {
      return coreRuntime.takeSnapshot();
    },
  };
});
