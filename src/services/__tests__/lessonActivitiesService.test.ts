/**
 * lessonActivitiesService：首页块重排、课时关联班级、试题活动绑定。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { bindAssessmentActivity, getLessonLinkedClasses, reorderLessonBlocks } from '../lessonActivitiesService';

type Call = { url: string; init?: RequestInit };

describe('lessonActivitiesService', () => {
  const calls: Call[] = [];
  const state = { ok: true, body: {} as unknown };

  beforeEach(() => {
    calls.length = 0;
    state.ok = true;
    state.body = {};
    globalThis.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return Promise.resolve({
        ok: state.ok,
        json: async () => state.body,
      } as Response);
    }) as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reorderLessonBlocks 提交有序 id 数组', async () => {
    state.body = [{ id: 'b2', order_index: 0 }];
    const res = await reorderLessonBlocks('lesson-1', ['b2', 'b1']);

    expect(res.ok).toBe(true);
    expect(calls[0].url).toBe('/api/lessons/lesson-1/blocks/reorder');
    expect(calls[0].init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ ids: ['b2', 'b1'] });
    expect(res.data).toEqual([{ id: 'b2', order_index: 0 }]);
  });

  it('getLessonLinkedClasses 返回课时关联班级', async () => {
    state.body = [{ id: 'class-1', name: '高一(1)班' }];
    const res = await getLessonLinkedClasses('lesson-1');

    expect(res.ok).toBe(true);
    expect(calls[0].url).toBe('/api/lessons/lesson-1/linked-classes');
    expect(res.data).toEqual([{ id: 'class-1', name: '高一(1)班' }]);
  });

  it('bindAssessmentActivity 提交试卷、班级与可选活动 id', async () => {
    state.body = { success: true };
    const res = await bindAssessmentActivity('lesson-1', {
      assessmentId: 'asm-1',
      classId: 'class-1',
      activityId: 'act-1',
      title: '随堂测',
      required: true,
      visible: true,
    });

    expect(res.ok).toBe(true);
    expect(calls[0].url).toBe('/api/lessons/lesson-1/activities/assessment');
    expect(calls[0].init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      assessmentId: 'asm-1',
      classId: 'class-1',
      activityId: 'act-1',
      title: '随堂测',
      required: true,
      visible: true,
    });
  });

  it('接口失败时返回 ok=false 与服务端错误体', async () => {
    state.ok = false;
    state.body = { error: 'classId is not linked to this lesson' };

    const res = await bindAssessmentActivity('lesson-1', { assessmentId: 'asm-1', classId: 'class-2' });

    expect(res.ok).toBe(false);
    expect(res.error).toEqual({ error: 'classId is not linked to this lesson' });
  });
});
