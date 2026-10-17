import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { TimetableManager } from '../TimetableManager';
import { uiStore } from '../../store/uiStore';
import type { ClassType, LessonType } from '../timetable/types';

describe('TimetableManager Component', () => {
  const mockClasses: ClassType[] = [
    { id: 'c1', name: '高一(1)班', description: '重点班' },
    { id: 'c2', name: '高一(2)班', description: '普通班' },
  ];

  const mockLessons: LessonType[] = [
    { id: 'l1', title: '高等数学第1讲' },
    { id: 'l2', title: '大学物理实验' },
  ];

  const mockSchedules = [
    {
      id: 'sch-1',
      class_id: 'c1',
      lesson_id: 'l1',
      scheduled_date: '2026-10-01',
      time_slot: '09:00 - 10:30',
      status: 'scheduled',
      lesson_title: '高等数学第1讲',
      class_name: '高一(1)班',
    },
    {
      id: 'sch-2',
      class_id: 'c2',
      lesson_id: 'l2',
      scheduled_date: '2026-10-02',
      time_slot: '14:00 - 15:30',
      status: 'cancelled',
      lesson_title: '大学物理实验',
      class_name: '高一(2)班',
    },
  ];

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/ai-providers')) {
          return Promise.resolve({
            ok: true,
            json: async () => [{ id: 'p1', name: 'OpenAI Provider' }],
          });
        }
        // A7: 集合级 /api/schedules 返回信封；子资源 /api/classes/:id/schedules 维持裸数组
        if (url.includes('/classes/') && url.includes('/schedules')) {
          return Promise.resolve({
            ok: true,
            json: async () => mockSchedules,
          });
        }
        if (url.includes('/api/schedules')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ data: mockSchedules, total: mockSchedules.length, page: 1, pageSize: 50 }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({}),
        });
      })
    );
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders the header title and default calendar tab in Chinese', async () => {
    render(
      <TimetableManager
        classes={mockClasses}
        lessons={mockLessons}
        lang="zh"
        onSchedulesUpdated={vi.fn()}
      />
    );

    expect(screen.getByText('班级课表中心 & 动态调整')).toBeTruthy();
    expect(screen.getByText(/统一管理日常排课/)).toBeTruthy();

    // Verify all 4 tabs are present
    expect(screen.getByRole('button', { name: /🗓️ 课表看板/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /🛠️ 临时调休调课/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /📥 快速导入导出/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /📷 AI 图片识课/ })).toBeTruthy();

    // Default tab should render calendar view elements
    await waitFor(() => {
      expect(fetch).toHaveBeenCalled();
    });
  });

  it('renders the header title in English when lang is en', () => {
    render(
      <TimetableManager
        classes={mockClasses}
        lessons={mockLessons}
        lang="en"
        onSchedulesUpdated={vi.fn()}
      />
    );

    expect(screen.getByText('Timetable Center & Adjustments')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Schedule Grid/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Holiday Adjusts/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Import \/ Export/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /AI Image OCR/ })).toBeTruthy();
  });

  it('switches between tabs cleanly', async () => {
    render(
      <TimetableManager
        classes={mockClasses}
        lessons={mockLessons}
        lang="zh"
        onSchedulesUpdated={vi.fn()}
      />
    );

    // 1. Switch to Holiday Adjusts tab
    const adjustTabBtn = screen.getByRole('button', { name: /🛠️ 临时调休调课/ });
    fireEvent.click(adjustTabBtn);

    expect(screen.getByText('批量节假日调休排班')).toBeTruthy();
    expect(screen.getByText('一键更新该周期课表')).toBeTruthy();

    // 2. Switch to Import / Export tab
    const importExportTabBtn = screen.getByRole('button', { name: /📥 快速导入导出/ });
    fireEvent.click(importExportTabBtn);

    expect(screen.getByText('导出系统课表')).toBeTruthy();
    expect(screen.getByText('导出为 Excel CSV')).toBeTruthy();

    // 3. Switch to OCR tab
    const ocrTabBtn = screen.getByRole('button', { name: /📷 AI 图片识课/ });
    fireEvent.click(ocrTabBtn);

    expect(screen.getByText('第一步：上传课表图片')).toBeTruthy();
    expect(screen.getByText('AI 识别引擎')).toBeTruthy();

    // 4. Switch back to View tab
    const viewTabBtn = screen.getByRole('button', { name: /🗓️ 课表看板/ });
    fireEvent.click(viewTabBtn);

    // Verify calendar view is active again
    expect(screen.queryByText('第一步：上传课表图片')).toBeNull();
    expect(screen.queryByText('批量节假日调休排班')).toBeNull();
  });

  it('renders gracefully when classes and schedules are empty', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: async () => [],
        })
      )
    );

    render(
      <TimetableManager
        classes={[]}
        lessons={[]}
        lang="zh"
        onSchedulesUpdated={vi.fn()}
      />
    );

    expect(screen.getByText('班级课表中心 & 动态调整')).toBeTruthy();
    expect(screen.getByRole('button', { name: /🗓️ 课表看板/ })).toBeTruthy();
  });
});

describe('TimetableManager 快速开始上课 (Issue #90)', () => {
  const quickClasses: ClassType[] = [
    { id: 'c1', name: '高一(1)班' },
    { id: 'c2', name: '高一(2)班' },
  ];
  const quickLessons: LessonType[] = [{ id: 'l1', title: '高等数学第1讲' }];

  // sch-1：正常且已关联课程；sch-2：停课；sch-3：未关联课程
  const quickSchedules = [
    {
      id: 'sch-1',
      class_id: 'c1',
      lesson_id: 'l1',
      scheduled_date: '2026-10-01',
      time_slot: '09:00 - 10:30',
      status: 'scheduled',
      lesson_title: '高等数学第1讲',
      class_name: '高一(1)班',
    },
    {
      id: 'sch-2',
      class_id: 'c2',
      lesson_id: 'l2',
      scheduled_date: '2026-10-02',
      time_slot: '14:00 - 15:30',
      status: 'cancelled',
      lesson_title: '大学物理实验',
      class_name: '高一(2)班',
    },
    {
      id: 'sch-3',
      class_id: 'c1',
      lesson_id: '',
      scheduled_date: '2026-10-01',
      time_slot: '08:00 - 08:40',
      status: 'scheduled',
      lesson_title: '',
      class_name: '高一(1)班',
    },
  ];

  const mockFetch = (overrides: { initStatus?: number; initBody?: any } = {}) =>
    vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/api/classroom/sessions?') && url.includes('status=active')) {
        return Promise.resolve({ ok: true, json: async () => ({ items: [{ lessonId: 'l1', stage: 'IN_CLASS_TEACHING' }] }) });
      }
      if (url.includes('/api/classroom/teaching-modes')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            modes: [
              { id: 'mode_explore', name: '探究实验', nameEn: 'Explore', description: '', descriptionEn: null, icon: 'FlaskConical', color: 'emerald', isBuiltin: true, sortOrder: 1 },
              { id: 'mode_lecture', name: '讲授', nameEn: 'Lecture', description: '', descriptionEn: null, icon: 'Presentation', color: 'indigo', isBuiltin: true, sortOrder: 2 },
            ],
          }),
        });
      }
      if (url.includes('/api/classroom/sessions/') && url.includes('/init')) {
        if (overrides.initStatus) {
          return Promise.resolve({ ok: false, status: overrides.initStatus, json: async () => ({ error: overrides.initBody?.error || 'boom' }) });
        }
        return Promise.resolve({ ok: true, json: async () => ({ success: true, session: { id: 'ses_1' } }) });
      }
      if (url.includes('/api/ai-providers')) {
        return Promise.resolve({ ok: true, json: async () => [] });
      }
      if (url.includes('/classes/') && url.includes('/schedules')) {
        return Promise.resolve({ ok: true, json: async () => quickSchedules });
      }
      if (url.includes('/api/schedules')) {
        return Promise.resolve({ ok: true, json: async () => ({ data: quickSchedules, total: quickSchedules.length, page: 1, pageSize: 50 }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

  beforeEach(() => {
    uiStore.setState({ teacherTab: 'timetable', pendingTimetableSubTab: null, pendingLiveClassLaunch: null });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const renderView = (fetchOverrides?: { initStatus?: number; initBody?: any }) => {
    const fetchMock = mockFetch(fetchOverrides);
    vi.stubGlobal('fetch', fetchMock);
    render(<TimetableManager classes={quickClasses} lessons={quickLessons} lang="zh" onSchedulesUpdated={vi.fn()} />);
    return fetchMock;
  };

  it('正常已关联课程的排课显示可用入口；停课与未关联课程的入口禁用并带提示', async () => {
    renderView();

    await waitFor(() => {
      expect(screen.getByTestId('quick-start-sch-1')).toBeTruthy();
    });

    const okBtn = screen.getByTestId('quick-start-sch-1') as HTMLButtonElement;
    expect(okBtn.disabled).toBe(false);
    expect(okBtn.getAttribute('aria-label')).toContain('高等数学第1讲');

    const cancelledBtn = screen.getByTestId('quick-start-sch-2') as HTMLButtonElement;
    expect(cancelledBtn.disabled).toBe(true);
    expect(cancelledBtn.getAttribute('title')).toContain('停课');

    const noLessonBtn = screen.getByTestId('quick-start-sch-3') as HTMLButtonElement;
    expect(noLessonBtn.disabled).toBe(true);
    expect(noLessonBtn.getAttribute('title')).toContain('未关联课程');
  });

  it('已有进行中会话的排课按钮显示「进入课堂」', async () => {
    renderView();

    await waitFor(() => {
      expect(screen.getByTestId('quick-start-sch-1').textContent).toContain('进入课堂');
    });
  });

  it('点击入口弹出轻量确认框，确认后调用 init 接口并切换到互动课堂（含信号）', async () => {
    const fetchMock = renderView();

    await waitFor(() => {
      expect(screen.getByTestId('quick-start-sch-1')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('quick-start-sch-1'));

    // 确认框出现且教学模式可选
    expect(screen.getByText('快速开始上这节课')).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText('探究实验')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('探究实验'));

    fireEvent.click(screen.getByRole('button', { name: '开始上课' }));

    await waitFor(() => {
      const initCall = fetchMock.mock.calls.find(
        ([u]: any[]) => typeof u === 'string' && u.includes('/api/classroom/sessions/l1/init'),
      );
      expect(initCall).toBeTruthy();
      const [, initOpts] = initCall as [string, RequestInit];
      expect(initOpts.method).toBe('POST');
      expect(String(initOpts.body)).toContain('"classId":"c1"');
      expect(String(initOpts.body)).toContain('"teachingModeId":"mode_explore"');
    });

    // 切到互动课堂并留下开课信号（供 LiveClassroomView 跳过门户直接进入授课视图）
    await waitFor(() => {
      expect(uiStore.getState().teacherTab).toBe('live_class');
      expect(uiStore.getState().pendingLiveClassLaunch).toEqual({
        lessonId: 'l1',
        classId: 'c1',
        teachingModeId: 'mode_explore',
      });
    });
    // 弹窗关闭
    expect(screen.queryByText('快速开始上这节课')).toBeNull();
  });

  it('初始化失败时停留在课表页并展示错误提示', async () => {
    const fetchMock = renderView({ initStatus: 500, initBody: { error: '课堂初始化失败' } });

    await waitFor(() => {
      expect(screen.getByTestId('quick-start-sch-1')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('quick-start-sch-1'));
    fireEvent.click(screen.getByRole('button', { name: '开始上课' }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('课堂初始化失败');
    });
    // 停留在课表页
    expect(uiStore.getState().teacherTab).toBe('timetable');
    expect(uiStore.getState().pendingLiveClassLaunch).toBeNull();
    expect(screen.getByText('快速开始上这节课')).toBeTruthy();
  });
});
