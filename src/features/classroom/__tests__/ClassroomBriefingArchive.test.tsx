import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ClassroomBriefingView } from '../ClassroomBriefingView';
import type { StudentType } from '../../../types/app';

afterEach(cleanup);

/**
 * 学情简报页面的「归档并结束课堂」常驻提示：
 *  - 按钮必须**始终**出现在页头操作区（不依赖是否从「结课通票」进入）
 *  - 点击后二次确认，确认才调 POST /api/classroom/sessions/:id/archive
 *  - 归档成功后提示「归档成功」；本来就是归档态则提示「本课节已归档」
 */
describe('ClassroomBriefingView: 归档并结束课堂常驻提示', () => {
  const mockStudents: StudentType[] = [
    {
      id: 'st-001',
      name: '赵同学',
      student_number: '202601',
      email: 'zhao@example.com',
      created_at: Date.now(),
    },
  ];

  let archiveCalls: string[] = [];
  let confirmSpy: ReturnType<typeof vi.spyOn>;

  function renderBriefing(addToast = vi.fn()) {
    render(
      <ClassroomBriefingView
        selectedLesson="lesson-101"
        lessonTitle="动能定理"
        selectedClassId="cls-1"
        className="高一(2)班"
        students={mockStudents}
        lang="zh"
        onReturnToTeaching={vi.fn()}
        onReturnToPreClass={vi.fn()}
        addToast={addToast}
      />,
    );
    return addToast;
  }

  beforeEach(() => {
    archiveCalls = [];
    confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function stubFetch(session: { id: string; stage: string; ended_at?: number } | null) {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        const u = String(url);
        if (u.includes('/panoramic-report')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ session: { durationMin: 40 }, metrics: {}, students: [] }),
          });
        }
        if (u.includes('/api/classroom/stage/')) {
          return Promise.resolve({ ok: true, json: async () => ({ pacing: {} }) });
        }
        if (u.includes('/api/lessons/')) {
          return Promise.resolve({ ok: true, json: async () => ({}) });
        }
        if (/\/api\/classroom\/sessions\/[^/]+\/archive/.test(u)) {
          archiveCalls.push(u);
          return Promise.resolve({
            ok: true,
            json: async () => ({ success: true, sessionId: session?.id, stage: 'ARCHIVED_REPORT' }),
          });
        }
        if (u.includes('/api/classroom/sessions/')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              hasActiveSession: session ? session.stage !== 'ARCHIVED_REPORT' : false,
              stage: session?.stage ?? 'PRE_CLASS_READY',
              session,
            }),
          });
        }
        return Promise.resolve({ ok: false, json: async () => ({}) });
      }),
    );
  }

  it('页头操作区固定渲染「归档并结束课堂」入口', async () => {
    stubFetch({ id: 'sess-1', stage: 'IN_CLASS_TEACHING' });
    renderBriefing();

    expect(screen.getByText('归档并结束课堂')).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText('归档并结束课堂')).toBeTruthy();
    });
  });

  it('确认后调用归档接口并提示归档成功', async () => {
    stubFetch({ id: 'sess-1', stage: 'IN_CLASS_TEACHING' });
    const addToast = renderBriefing();

    await waitFor(() => {
      expect(screen.getByText('归档并结束课堂')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('归档并结束课堂'));

    await waitFor(() => {
      expect(archiveCalls.length).toBe(1);
    });
    expect(archiveCalls[0]).toContain('/api/classroom/sessions/sess-1/archive');
    expect(confirmSpy).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith('归档成功', expect.any(String), 'success');
    });
  });

  it('取消二次确认时不发起归档请求', async () => {
    stubFetch({ id: 'sess-1', stage: 'IN_CLASS_TEACHING' });
    confirmSpy.mockReturnValue(false);
    const addToast = renderBriefing();

    await waitFor(() => {
      expect(screen.getByText('归档并结束课堂')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('归档并结束课堂'));

    await new Promise((r) => setTimeout(r, 30));
    expect(archiveCalls.length).toBe(0);
    expect(addToast).not.toHaveBeenCalledWith('归档成功', expect.any(String), 'success');
  });

  it('已经是归档态的课节提示「本课节已归档」', async () => {
    stubFetch({ id: 'sess-1', stage: 'ARCHIVED_REPORT', ended_at: Date.now() });
    const addToast = renderBriefing();

    await waitFor(() => {
      expect(screen.getByText('归档并结束课堂')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('归档并结束课堂'));

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith('本课节已归档', expect.any(String), 'info');
    });
  });
});
