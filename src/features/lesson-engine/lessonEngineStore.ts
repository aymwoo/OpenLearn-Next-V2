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
  LessonStatus,
} from '../../../packages/core/lesson-engine/types.js';
import { LessonRuntime } from '../../../packages/core/lesson-engine/lesson-runtime.js';
import { StageGuardPipeline } from '../../../packages/core/lesson-engine/stage-guard-pipeline.js';
import type { StageGuard, StageGuardResult } from '../../../packages/core/di/interfaces.js';
import { frontendEventBus } from '../../services/event-bus.js';

interface LessonEngineStoreState {
  runtime: LessonRuntime;
  stageGuardPipeline: StageGuardPipeline;
  status: LessonStatus;
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
  resetLesson: () => void;
  nextStage: () => boolean;
  backStage: () => boolean;
  jumpStage: (stageTarget: number | string, activityTarget?: number | string) => boolean;
  skipStage: (stageId: string) => boolean;
  lockStage: (stageId: string, locked?: boolean) => boolean;
  setPresentationMode: (enabled: boolean) => void;
  setUser: (user: UserRef) => void;
  takeSnapshot: () => LessonSnapshot;
  checkStageAccess: (targetStageId: string, studentId?: string) => Promise<StageGuardResult>;
  /** 仅供离线预览/测试；checkStageAccess 不会回退到它 */
  checkStageAccessLocally: (targetStageId: string, studentId?: string) => Promise<StageGuardResult>;
}

const defaultUser: UserRef = {
  id: 'usr_teacher_demo',
  name: '演示教师',
  role: 'teacher',
};

// Global singleton core lesson runtime instance for frontend
const coreRuntime = new LessonRuntime({ eventBus: frontendEventBus });

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

  // Subscribe to stateMachine transitions
  coreRuntime.stateMachine.onTransition((_from, to) => {
    set({ status: to });
  });

  // Subscribe to context updates
  coreRuntime.contextManager.subscribe((ctx) => {
    set({
      isPresentationMode: ctx.isPresentationMode,
    });
  });

  return {
    runtime: coreRuntime,
    status: coreRuntime.getStatus(),
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
      if (coreRuntime.getStatus() === 'completed') {
        coreRuntime.reset();
      }
      await coreRuntime.startLesson(lesson, flowId);
      set({
        status: coreRuntime.getStatus(),
        currentLesson: coreRuntime.getCurrentLesson(),
        activeFlow: coreRuntime.getActiveFlow(),
      });
    },

    startLesson: async () => {
      const lesson = get().currentLesson;
      if (lesson) {
        if (coreRuntime.getStatus() === 'completed') {
          coreRuntime.reset();
        }
        await coreRuntime.startLesson(lesson);
        set({
          status: coreRuntime.getStatus(),
          currentLesson: coreRuntime.getCurrentLesson(),
        });
      }
    },

    pauseLesson: async () => {
      await coreRuntime.pauseLesson();
      set({
        status: coreRuntime.getStatus(),
        currentLesson: coreRuntime.getCurrentLesson(),
      });
    },

    resumeLesson: async () => {
      await coreRuntime.resumeLesson();
      set({
        status: coreRuntime.getStatus(),
        currentLesson: coreRuntime.getCurrentLesson(),
      });
    },

    stopLesson: async () => {
      const analytics = await coreRuntime.stopLesson();
      set({
        status: coreRuntime.getStatus(),
        currentLesson: coreRuntime.getCurrentLesson(),
      });
      return analytics;
    },

    resetLesson: () => {
      coreRuntime.reset();
      set({
        status: 'idle',
        currentLesson: null,
        activeFlow: null,
        currentStage: null,
        currentActivity: null,
        currentStageIndex: 0,
        currentActivityIndex: 0,
        stageElapsedSeconds: 0,
        totalElapsedSeconds: 0,
      });
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

    stageGuardPipeline: coreRuntime.stageGuard,

    /**
     * I-1：**服务端权威**门禁判定。
     *
     * 原实现直接在浏览器里跑 `coreRuntime.stageGuard.checkAccess()` ——
     * `coreRuntime` 是 `new LessonRuntime({ eventBus: frontendEventBus })`，
     * 整套管线在客户端，学生改 DevTools 本地 state 即可解锁任意环节。
     *
     * 现在改为调服务端 `POST /api/lessons/:id/stage-access`：守卫注册在内核 DI，
     * 守卫实现读服务端状态，客户端无法伪造前置条件。
     *
     * **失败即拒绝**：网络错误、服务端 5xx、非 JSON 响应一律按 fail-close 处理
     * （与 I-2 的默认语义一致）。这里**不做**「回退到本地管道」——
     * 那等于把绕过方法又装回去。
     */
    checkStageAccess: async (targetStageId: string, studentId?: string) => {
      const state = get();
      const currentStudentId = studentId || state.currentUser?.id || 'anonymous';
      const lessonId = state.currentLesson?.id || '';
      const currentStageId = state.currentStage?.id || null;

      if (!lessonId) {
        return {
          allowed: false,
          reason: '缺少 lessonId，无法校验环节门禁',
        };
      }

      try {
        const res = await fetch(`/api/lessons/${encodeURIComponent(lessonId)}/stage-access`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ currentStageId, targetStageId, metadata: { studentId: currentStudentId } }),
        });

        if (!res.ok) {
          return {
            allowed: false,
            reason: `门禁服务不可用（HTTP ${res.status}）`,
          };
        }

        const result = await res.json();
        // 契约不符时也按拒绝处理 —— 解析失败绝不能当成「放行」
        if (typeof result?.allowed !== 'boolean') {
          return { allowed: false, reason: '门禁服务返回了无法识别的结果' };
        }
        return result;
      } catch (err) {
        return {
          allowed: false,
          reason: '门禁服务不可达，已拒绝进入该环节',
        };
      }
    },

    /**
     * 仅供离线/降级预览用：本地管道判定。
     *
     * 刻意**不**在 checkStageAccess 失败时回退到这里 —— 那等于把绕过方法
     * 重新装回去。此方法仅供测试与本地开发显式调用。
     */
    checkStageAccessLocally: async (targetStageId: string, studentId?: string) => {
      const state = get();
      const currentStudentId = studentId || state.currentUser?.id || 'anonymous';
      const lessonId = state.currentLesson?.id || '';
      const currentStageId = state.currentStage?.id || null;

      return coreRuntime.stageGuard.checkAccess({
        studentId: currentStudentId,
        lessonId,
        currentStageId,
        targetStageId,
      });
    },
  };
});
