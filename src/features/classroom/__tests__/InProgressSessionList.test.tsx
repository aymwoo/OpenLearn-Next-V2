import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { InProgressSessionList } from '../InProgressSessionList';
import type { ClassroomSessionItem } from '../ClassroomSessionManager';

function makeSession(overrides: Partial<ClassroomSessionItem> = {}): ClassroomSessionItem {
  return {
    id: 'sess-1',
    lessonId: 'lesson-101',
    lessonTitle: '物理探究实验课',
    classId: 'class-g1',
    className: '高一1班',
    teacherId: 'teacher',
    stage: 'IN_CLASS_TEACHING',
    teachingModeId: null,
    teachingModeName: null,
    checkinCode: null,
    focusMode: false,
    startedAt: Date.now() - 5 * 60 * 1000,
    endedAt: null,
    createdAt: Date.now() - 5 * 60 * 1000,
    stats: { pollCount: 0, exitTicketCount: 0, feedCount: 0 },
    presentCount: 3,
    ...overrides,
  };
}

function stubSessions(items: ClassroomSessionItem[]) {
  // 用可变数组模拟后端：归档成功后刷新拿到的就不该再有这条会话
  const state = { items: items.slice() };
  const fetchMock = vi.fn().mockImplementation((url: string) => {
    if (String(url).includes('/archive')) {
      state.items = state.items.filter((s) => !String(url).includes(`/sessions/${s.id}/archive`));
      return Promise.resolve({ ok: true, json: async () => ({ success: true }) });
    }
    if (String(url).includes('/api/classroom/sessions?')) {
      return Promise.resolve({ ok: true, json: async () => ({ items: state.items, total: state.items.length }) });
    }
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('InProgressSessionList（Issue #91 进入互动课堂的第一屏）', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  beforeEach(() => {
    vi.useRealTimers();
  });

  it('渲染进行中会话的课程名、班级、阶段、已用时长与在场人数', async () => {
    stubSessions([makeSession()]);
    render(
      <InProgressSessionList
        lang="zh"
        currentLessonId="lesson-101"
        onResume={vi.fn()}
        onStartNew={vi.fn()}
        onOpenArchive={vi.fn()}
        onEmpty={vi.fn()}
      />,
    );

    expect(await screen.findByTestId('in-progress-session-list')).toBeTruthy();
    expect(screen.getByText('物理探究实验课')).toBeTruthy();
    expect(screen.getByText('高一1班')).toBeTruthy();
    expect(screen.getByText('授课进行中')).toBeTruthy();
    expect(screen.getByText(/已进行 \d+ 分钟/)).toBeTruthy();
    expect(screen.getByText('在场 3 人')).toBeTruthy();
    // 当前课节高亮
    expect(screen.getByTestId('in-progress-session-sess-1').getAttribute('data-current')).toBe('true');
    expect(screen.getByText('当前课节')).toBeTruthy();
  });

  it('请求端点带 status=active 且 pageSize=all —— 只取进行中的会话', async () => {
    const fetchMock = stubSessions([makeSession()]);
    render(
      <InProgressSessionList
        lang="zh"
        onResume={vi.fn()}
        onStartNew={vi.fn()}
        onOpenArchive={vi.fn()}
        onEmpty={vi.fn()}
      />,
    );
    await screen.findByTestId('in-progress-session-list');

    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('status=active'))).toBe(true);
    expect(urls.some((u) => u.includes('pageSize=all'))).toBe(true);
  });

  it('「继续上课」把选中的会话交给宿主', async () => {
    const onResume = vi.fn();
    stubSessions([makeSession()]);
    render(
      <InProgressSessionList
        lang="zh"
        onResume={onResume}
        onStartNew={vi.fn()}
        onOpenArchive={vi.fn()}
        onEmpty={vi.fn()}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: /继续上课/ }));
    expect(onResume).toHaveBeenCalledTimes(1);
    expect(onResume.mock.calls[0][0].id).toBe('sess-1');
  });

  it('结束并归档需要二次确认，确认后调用 archive 接口并把会话移出列表', async () => {
    const fetchMock = stubSessions([makeSession()]);
    const onResume = vi.fn();
    render(
      <InProgressSessionList
        lang="zh"
        onResume={onResume}
        onStartNew={vi.fn()}
        onOpenArchive={vi.fn()}
        onEmpty={vi.fn()}
      />,
    );

    await screen.findByTestId('in-progress-session-sess-1');
    fireEvent.click(screen.getByRole('button', { name: /结束并归档/ }));

    // 第一次点击只是进入确认态，不能已经发请求
    expect(screen.getByRole('button', { name: /确认归档/ })).toBeTruthy();
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/archive'))).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: /确认归档/ }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          (c) => String(c[0]).includes('/api/classroom/sessions/sess-1/archive') && c[1]?.method === 'POST',
        ),
      ).toBe(true);
    });
    await waitFor(() => expect(screen.queryByTestId('in-progress-session-sess-1')).toBeNull());
  });

  it('取消归档不会发请求', async () => {
    const fetchMock = stubSessions([makeSession()]);
    render(
      <InProgressSessionList
        lang="zh"
        onResume={vi.fn()}
        onStartNew={vi.fn()}
        onOpenArchive={vi.fn()}
        onEmpty={vi.fn()}
      />,
    );

    await screen.findByTestId('in-progress-session-sess-1');
    fireEvent.click(screen.getByRole('button', { name: /结束并归档/ }));
    fireEvent.click(screen.getByRole('button', { name: /取消/ }));

    expect(screen.queryByRole('button', { name: /确认归档/ })).toBeNull();
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/archive'))).toBe(false);
  });

  it('没有任何进行中会话时回调 onEmpty（宿主据此回退到起始门户）', async () => {
    const onEmpty = vi.fn();
    stubSessions([]);
    render(
      <InProgressSessionList
        lang="zh"
        onResume={vi.fn()}
        onStartNew={vi.fn()}
        onOpenArchive={vi.fn()}
        onEmpty={onEmpty}
      />,
    );

    await screen.findByTestId('in-progress-session-list');
    await waitFor(() => expect(onEmpty).toHaveBeenCalled());
    expect(screen.getByText(/当前没有进行中的课堂会话/)).toBeTruthy();
  });

  it('「开始一节新课」与「全部会话档案」分别交回宿主', async () => {
    const onStartNew = vi.fn();
    const onOpenArchive = vi.fn();
    stubSessions([makeSession()]);
    render(
      <InProgressSessionList
        lang="zh"
        onResume={vi.fn()}
        onStartNew={onStartNew}
        onOpenArchive={onOpenArchive}
        onEmpty={vi.fn()}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: /开始一节新课/ }));
    fireEvent.click(screen.getByRole('button', { name: /全部会话档案/ }));
    expect(onStartNew).toHaveBeenCalledTimes(1);
    expect(onOpenArchive).toHaveBeenCalledTimes(1);
  });

  it('加载失败时显示错误与重试，不把教师踢回门户', async () => {
    const onEmpty = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <InProgressSessionList
        lang="zh"
        onResume={vi.fn()}
        onStartNew={vi.fn()}
        onOpenArchive={vi.fn()}
        onEmpty={onEmpty}
      />,
    );

    expect(await screen.findByTestId('in-progress-sessions-error')).toBeTruthy();
    expect(onEmpty).not.toHaveBeenCalled();

    fetchMock.mockImplementation(() =>
      Promise.resolve({ ok: true, json: async () => ({ items: [makeSession()], total: 1 }) }),
    );
    fireEvent.click(screen.getByRole('button', { name: /重试/ }));
    expect(await screen.findByTestId('in-progress-session-sess-1')).toBeTruthy();
  });

  it('英文界面使用英文文案', async () => {
    stubSessions([makeSession({ stage: 'WRAP_UP_EXIT_TICKET' })]);
    render(
      <InProgressSessionList
        lang="en"
        onResume={vi.fn()}
        onStartNew={vi.fn()}
        onOpenArchive={vi.fn()}
        onEmpty={vi.fn()}
      />,
    );

    expect(await screen.findByTestId('in-progress-session-list')).toBeTruthy();
    expect(screen.getByText('In-progress classroom sessions')).toBeTruthy();
    expect(screen.getByText('Wrap-up Ticket')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Resume/ })).toBeTruthy();
    expect(screen.getByText('3 present')).toBeTruthy();
  });
});
