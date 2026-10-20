/**
 * 课节默认选中的角色门控（回归）。
 *
 * ## 背景
 *
 * `loadLessons` 此前会把 `lessons[0]`（**全局**课程列表里最新的一节）设为当前
 * 课节，不分角色。`GET /api/lessons` 对任何已登录角色开放，而
 * `GET /api/lessons/:id/whiteboard` 只对**该课节所在班级的成员**开放 →
 * 学生端默认选中别人的课节 → 白板轮询稳定吃 403。
 *
 * 学生端的当前课节本来就该由自己的课表 / 进度 / 进行中会话决定，不该替他们猜。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { appStore } from '../appStore';

const fetchStub = vi.fn();

describe('课节默认选中的角色门控', () => {
  beforeEach(() => {
    fetchStub.mockReset();
    vi.stubGlobal('fetch', fetchStub);
    appStore.setState({ lessons: [], selectedLesson: null });
    appStore.getState().setSession(null);
  });

  function stubLessons(ids: string[]) {
    fetchStub.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: ids.map((id) => ({ id, title: id, content: '', created_at: Date.now() })),
        total: ids.length,
        page: 1,
        pageSize: ids.length,
      }),
    });
  }

  it('教师端仍然默认选中第一节课（备课工作台的默认行为不能被改掉）', async () => {
    stubLessons(['lesson-a', 'lesson-b']);
    appStore.getState().setSession({ role: 'teacher', userId: 'usr-t', username: 't' } as any);

    await appStore.getState().loadLessons();

    expect(appStore.getState().selectedLesson).toBe('lesson-a');
  });

  it('学生端不默认选中任何课节（避免去拉别人课节的白板）', async () => {
    stubLessons(['lesson-a', 'lesson-b']);
    appStore.getState().setSession({ role: 'student', studentId: 'stu-1', name: '学生甲' } as any);

    await appStore.getState().loadLessons();

    expect(appStore.getState().selectedLesson).toBeNull();
    // 课程列表本身仍然加载（学生端要用它查课节标题与内容）
    expect(appStore.getState().lessons).toHaveLength(2);
  });

  it('已有选中课节时不被覆盖', async () => {
    stubLessons(['lesson-a', 'lesson-b']);
    appStore.getState().setSession({ role: 'teacher', userId: 'usr-t', username: 't' } as any);
    appStore.setState({ selectedLesson: 'lesson-picked' });

    await appStore.getState().loadLessons();

    expect(appStore.getState().selectedLesson).toBe('lesson-picked');
  });

  it('课程列表为空时不会把 selectedLesson 写成 undefined', async () => {
    stubLessons([]);
    appStore.getState().setSession({ role: 'teacher', userId: 'usr-t', username: 't' } as any);

    await appStore.getState().loadLessons();

    expect(appStore.getState().selectedLesson).toBeNull();
  });
});
