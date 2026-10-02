import { describe, it, expect, vi } from 'vitest';
import { LessonRuntime } from '../lesson-runtime.js';
import { InvalidLessonStateTransitionError } from '../state-machine.js';
import type { Lesson } from '../types.js';

function createMockLesson(id = 'les_mock_001'): Lesson {
  return {
    id,
    title: '计算机网络概论',
    subject: '信息技术',
    grade: '高一',
    teacher: { id: 'usr_teacher', name: '李老师', role: 'teacher' },
    durationMinutes: 45,
    status: 'ready',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    flows: [
      {
        id: 'flow_default',
        name: '主教学流程',
        description: '标准流程',
        version: 1,
        isCurrent: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        stages: [
          {
            id: 'stg_1',
            title: '导入阶段',
            estimatedDurationSeconds: 300,
            teachingGoals: ['激发兴趣'],
            knowledgePoints: ['网络拓扑'],
            completionStatus: 'pending',
            assignee: 'teacher',
            activities: [
              {
                id: 'act_1',
                title: '热身问答',
                type: 'quiz',
                status: 'idle',
                config: {},
                teachingObjects: [],
              },
            ],
          },
          {
            id: 'stg_2',
            title: '探究阶段',
            estimatedDurationSeconds: 600,
            teachingGoals: ['掌握概念'],
            knowledgePoints: ['OSI模型'],
            completionStatus: 'pending',
            assignee: 'group',
            activities: [],
          },
        ],
      },
    ],
  };
}

describe('LessonRuntime & StateMachine Integration (Phase C3)', () => {
  it('should transition through full lifecycle: idle -> active -> paused -> active -> completed', async () => {
    const mockEventBus = {
      publish: vi.fn(),
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
    };
    const runtime = new LessonRuntime({ eventBus: mockEventBus as any });

    expect(runtime.getStatus()).toBe('idle');

    const lesson = createMockLesson();
    await runtime.startLesson(lesson);

    expect(runtime.getStatus()).toBe('active');
    expect(mockEventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'LessonStateChanged',
        payload: expect.objectContaining({
          lessonId: lesson.id,
          previousStatus: 'idle',
          currentStatus: 'active',
        }),
      }),
    );

    // Pause
    await runtime.pauseLesson();
    expect(runtime.getStatus()).toBe('paused');

    // Resume
    await runtime.resumeLesson();
    expect(runtime.getStatus()).toBe('active');

    // Stop
    await runtime.stopLesson();
    expect(runtime.getStatus()).toBe('completed');
  });

  it('should prevent double-starting active lesson', async () => {
    const runtime = new LessonRuntime();
    const lesson = createMockLesson();

    await runtime.startLesson(lesson);
    expect(runtime.getStatus()).toBe('active');

    // Double start should throw InvalidLessonStateTransitionError
    await expect(runtime.startLesson(lesson)).rejects.toThrow(InvalidLessonStateTransitionError);
  });

  it('should prevent starting or resuming from completed status without reset', async () => {
    const runtime = new LessonRuntime();
    const lesson = createMockLesson();

    await runtime.startLesson(lesson);
    await runtime.stopLesson();
    expect(runtime.getStatus()).toBe('completed');

    // Completed cannot transition to active directly
    await expect(runtime.startLesson(lesson)).rejects.toThrow(InvalidLessonStateTransitionError);
    await expect(runtime.resumeLesson()).rejects.toThrow(InvalidLessonStateTransitionError);

    // After reset, starting again is permitted
    runtime.reset();
    expect(runtime.getStatus()).toBe('idle');
    await expect(runtime.startLesson(lesson)).resolves.not.toThrow();
    expect(runtime.getStatus()).toBe('active');
  });

  it('should throw error when pausing without active lesson', async () => {
    const runtime = new LessonRuntime();
    await expect(runtime.pauseLesson()).rejects.toThrow('Cannot pause without an active lesson.');
  });
});
