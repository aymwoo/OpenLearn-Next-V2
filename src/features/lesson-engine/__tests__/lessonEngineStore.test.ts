import { describe, it, expect, beforeEach } from 'vitest';
import { useLessonEngineStore } from '../lessonEngineStore';
import type { Lesson } from '../../../../packages/core/lesson-engine/types.js';

function createMockLesson(id = 'les_store_test'): Lesson {
  return {
    id,
    title: '计算机网络导论',
    subject: '信息技术',
    grade: '高一',
    teacher: { id: 'usr_teacher', name: '李老师', role: 'teacher' },
    durationMinutes: 45,
    status: 'ready',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    flows: [
      {
        id: 'flow_1',
        name: '流程一',
        description: '标准流程',
        version: 1,
        isCurrent: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        stages: [
          {
            id: 'stg_1',
            title: '引入阶段',
            estimatedDurationSeconds: 300,
            teachingGoals: ['激发兴趣'],
            knowledgePoints: ['网络基础'],
            completionStatus: 'pending',
            assignee: 'teacher',
            activities: [],
          },
        ],
      },
    ],
  };
}

describe('lessonEngineStore Integration (Phase C3)', () => {
  beforeEach(() => {
    useLessonEngineStore.getState().resetLesson();
  });

  it('should initialize with status idle', () => {
    const state = useLessonEngineStore.getState();
    expect(state.status).toBe('idle');
    expect(state.currentLesson).toBeNull();
  });

  it('should update status and currentLesson across lifecycle', async () => {
    const lesson = createMockLesson();
    await useLessonEngineStore.getState().initializeLesson(lesson);

    expect(useLessonEngineStore.getState().status).toBe('active');
    expect(useLessonEngineStore.getState().currentLesson?.id).toBe(lesson.id);

    // Pause
    await useLessonEngineStore.getState().pauseLesson();
    expect(useLessonEngineStore.getState().status).toBe('paused');

    // Resume
    await useLessonEngineStore.getState().resumeLesson();
    expect(useLessonEngineStore.getState().status).toBe('active');

    // Stop
    await useLessonEngineStore.getState().stopLesson();
    expect(useLessonEngineStore.getState().status).toBe('completed');

    // Reset
    useLessonEngineStore.getState().resetLesson();
    expect(useLessonEngineStore.getState().status).toBe('idle');
    expect(useLessonEngineStore.getState().currentLesson).toBeNull();
  });
});
