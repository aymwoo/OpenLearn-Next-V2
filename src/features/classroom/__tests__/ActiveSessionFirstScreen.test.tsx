import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { ActiveSessionFirstScreen, type ActiveSessionItem } from '../ActiveSessionFirstScreen';

const mockSession: ActiveSessionItem = {
  id: 'ses-1',
  lessonId: 'lesson-1',
  lessonTitle: '物理探究实验课',
  classId: 'class-g1',
  className: '高一1班',
  stage: 'IN_CLASS_TEACHING',
  teachingModeName: '探究式',
  startedAt: Date.now() - 10 * 60000,
};

describe('ActiveSessionFirstScreen (Issue #91: 进行中会话首屏)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  const mockSessions = (items: ActiveSessionItem[]) =>
    vi.fn().mockImplementation((url: string) => {
      if (String(url).includes('/api/classroom/sessions?')) {
        return Promise.resolve({ ok: true, json: async () => ({ items, total: items.length }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

  it('列出进行中会话：课程名、班级、阶段与时长，按钮有可访问名', async () => {
    vi.stubGlobal('fetch', mockSessions([mockSession]));
    render(<ActiveSessionFirstScreen onResumeSession={vi.fn()} onStartNew={vi.fn()} onEmpty={vi.fn()} />);

    expect(await screen.findByTestId('active-session-first-screen')).toBeTruthy();
    expect(screen.getByText('物理探究实验课')).toBeTruthy();
    expect(screen.getByText('高一1班')).toBeTruthy();
    expect(screen.getByText('授课进行中')).toBeTruthy();
    expect(screen.getByText(/已进行 10 分钟/)).toBeTruthy();

    const resumeBtn = screen.getByTestId('resume-session-ses-1');
    expect(resumeBtn.getAttribute('aria-label')).toBe('继续上课：物理探究实验课');
    expect(screen.queryByRole('button', { name: '结束并归档：物理探究实验课' })).toBeTruthy();
  });

  it('点击「继续上课」回调对应会话；「开始一节新课」回调 onStartNew', async () => {
    const onResume = vi.fn();
    const onStartNew = vi.fn();
    vi.stubGlobal('fetch', mockSessions([mockSession]));
    render(<ActiveSessionFirstScreen onResumeSession={onResume} onStartNew={onStartNew} onEmpty={vi.fn()} />);

    fireEvent.click(await screen.findByTestId('resume-session-ses-1'));
    expect(onResume).toHaveBeenCalledWith(mockSession);

    fireEvent.click(screen.getByTestId('start-new-class-btn'));
    expect(onStartNew).toHaveBeenCalledTimes(1);
  });

  it('PRE_CLASS_READY 会话不进首屏（回退门户）；列表为空时回调 onEmpty', async () => {
    const onEmpty = vi.fn();
    // 服务端 status=active 仍可能返回 PRE_CLASS_READY（未归档），首屏需过滤
    vi.stubGlobal(
      'fetch',
      mockSessions([{ ...mockSession, stage: 'PRE_CLASS_READY' }] as ActiveSessionItem[]),
    );
    render(<ActiveSessionFirstScreen onResumeSession={vi.fn()} onStartNew={vi.fn()} onEmpty={onEmpty} />);

    await waitFor(() => {
      expect(onEmpty).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByTestId('resume-session-ses-1')).toBeNull();
  });

  it('结束并归档：二次确认后调用 archive 接口并刷新列表；确认框取消则不调用', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (String(url).includes('/api/classroom/sessions?')) {
        return Promise.resolve({ ok: true, json: async () => ({ items: [mockSession] }) });
      }
      if (String(url).includes('/archive')) {
        return Promise.resolve({ ok: true, json: async () => ({ success: true }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    vi.stubGlobal('fetch', fetchMock);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    const { unmount } = render(
      <ActiveSessionFirstScreen onResumeSession={vi.fn()} onStartNew={vi.fn()} onEmpty={vi.fn()} />,
    );
    fireEvent.click(await screen.findByRole('button', { name: '结束并归档：物理探究实验课' }));
    expect(confirmSpy).toHaveBeenCalled();
    expect(fetchMock.mock.calls.some(([u]: any[]) => String(u).includes('/archive'))).toBe(false);
    unmount();

    // 确认归档：初次加载返回会话，归档后的刷新返回空列表 → onEmpty 回退门户
    const onEmpty = vi.fn();
    confirmSpy.mockReturnValue(true);
    let listCallCount = 0;
    const fetchMock2 = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes('/archive')) {
        return Promise.resolve({ ok: true, json: async () => ({ success: true }) });
      }
      listCallCount += 1;
      const items = listCallCount <= 1 ? [mockSession] : [];
      return Promise.resolve({ ok: true, json: async () => ({ items }) });
    });
    vi.stubGlobal('fetch', fetchMock2);
    render(
      <ActiveSessionFirstScreen
        onResumeSession={vi.fn()}
        onStartNew={vi.fn()}
        onEmpty={onEmpty}
        addToast={vi.fn()}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: '结束并归档：物理探究实验课' }));
    await waitFor(() => {
      expect(fetchMock2.mock.calls.some(([u]: any[]) => String(u).includes('/archive'))).toBe(true);
      expect(onEmpty).toHaveBeenCalled();
    });
  });
});
