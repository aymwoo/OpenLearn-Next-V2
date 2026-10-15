import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ClassroomSessionManager, type ClassroomSessionItem } from '../ClassroomSessionManager';

afterEach(cleanup);

const MOCK_LESSONS = [
  { id: 'les-1', title: 'Python 基础' },
  { id: 'les-2', title: '算法入门' },
];

const MOCK_CLASSES = [
  { id: 'cls-1', name: '高一 (1) 班' },
  { id: 'cls-2', name: '高一 (2) 班' },
];

const MOCK_SESSIONS: ClassroomSessionItem[] = [
  {
    id: 'cs-01',
    lessonId: 'les-1',
    lessonTitle: 'Python 基础',
    classId: 'cls-1',
    className: '高一 (1) 班',
    teacherId: 'teacher-1',
    stage: 'IN_CLASS_TEACHING',
    teachingModeId: 'interactive',
    teachingModeName: '讲练互动',
    checkinCode: '1234',
    focusMode: false,
    startedAt: Date.now() - 600000,
    endedAt: null,
    createdAt: Date.now() - 600000,
    stats: { pollCount: 2, exitTicketCount: 15, feedCount: 5 },
  },
  {
    id: 'cs-02',
    lessonId: 'les-2',
    lessonTitle: '算法入门',
    classId: 'cls-2',
    className: '高一 (2) 班',
    teacherId: 'teacher-1',
    stage: 'ARCHIVED_REPORT',
    teachingModeId: 'inquiry',
    teachingModeName: '探究式',
    checkinCode: '5678',
    focusMode: false,
    startedAt: Date.now() - 3600000,
    endedAt: Date.now() - 1000000,
    createdAt: Date.now() - 3600000,
    stats: { pollCount: 1, exitTicketCount: 20, feedCount: 8 },
  },
];

describe('ClassroomSessionManager 前端管理看板组件', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, options?: RequestInit) => {
        if (url.includes('/api/classroom/sessions') && (!options || !options.method || options.method === 'GET')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              items: MOCK_SESSIONS,
              total: 2,
              page: 1,
              pageSize: 10,
              totalPages: 1,
            }),
          });
        }
        if (url.includes('/archive') && options?.method === 'POST') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ success: true }),
          });
        }
        if (url.includes('/api/classroom/sessions/') && options?.method === 'DELETE') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ success: true }),
          });
        }
        return Promise.resolve({ ok: true, json: async () => ({}) });
      }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('正确渲染会话列表、指标和状态徽章', async () => {
    const onBackToPortal = vi.fn();
    const onResumeSession = vi.fn();
    const onViewReport = vi.fn();

    render(
      <ClassroomSessionManager
        lessons={MOCK_LESSONS}
        classes={MOCK_CLASSES}
        lang="zh"
        onBackToPortal={onBackToPortal}
        onResumeSession={onResumeSession}
        onViewReport={onViewReport}
      />,
    );

    // 等待会话数据渲染
    await waitFor(() => {
      expect(screen.getByText('Python 基础')).toBeDefined();
      expect(screen.getByText('算法入门')).toBeDefined();
    });

    expect(screen.getByText('授课进行中')).toBeDefined();
    expect(screen.getByText('已归档战报')).toBeDefined();
    expect(screen.getByText('2 场会话')).toBeDefined();
  });

  it('点击“进入课堂”触发 onResumeSession 回调', async () => {
    const onResumeSession = vi.fn();

    render(
      <ClassroomSessionManager
        lessons={MOCK_LESSONS}
        classes={MOCK_CLASSES}
        lang="zh"
        onBackToPortal={vi.fn()}
        onResumeSession={onResumeSession}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('进入课堂')).toBeDefined();
    });

    fireEvent.click(screen.getByText('进入课堂'));
    expect(onResumeSession).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'cs-01',
        lessonTitle: 'Python 基础',
      }),
    );
  });

  it('点击“查看战报”触发 onViewReport 回调', async () => {
    const onViewReport = vi.fn();

    render(
      <ClassroomSessionManager
        lessons={MOCK_LESSONS}
        classes={MOCK_CLASSES}
        lang="zh"
        onBackToPortal={vi.fn()}
        onResumeSession={vi.fn()}
        onViewReport={onViewReport}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('查看战报')).toBeDefined();
    });

    fireEvent.click(screen.getByText('查看战报'));
    expect(onViewReport).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'cs-02',
        lessonTitle: '算法入门',
      }),
    );
  });

  it('点击“一键归档”向后端发送归档请求', async () => {
    const addToast = vi.fn();

    render(
      <ClassroomSessionManager
        lessons={MOCK_LESSONS}
        classes={MOCK_CLASSES}
        lang="zh"
        onBackToPortal={vi.fn()}
        onResumeSession={vi.fn()}
        addToast={addToast}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('一键归档')).toBeDefined();
    });

    fireEvent.click(screen.getByText('一键归档'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/classroom/sessions/cs-01/archive',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(addToast).toHaveBeenCalledWith('归档成功', expect.stringContaining('会话已移入已归档档案库'), 'success');
    });
  });

  it('点击“删除”唤起二次确认模态窗，并在确认后发送 DELETE 请求', async () => {
    const addToast = vi.fn();

    render(
      <ClassroomSessionManager
        lessons={MOCK_LESSONS}
        classes={MOCK_CLASSES}
        lang="zh"
        onBackToPortal={vi.fn()}
        onResumeSession={vi.fn()}
        addToast={addToast}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Python 基础')).toBeDefined();
    });

    // 找到删除按钮（通过 title 查找）
    const deleteButtons = screen.getAllByTitle('删除此会话');
    expect(deleteButtons.length).toBeGreaterThan(0);

    // 点击第一个删除按钮
    fireEvent.click(deleteButtons[0]);

    // 验证模态窗弹出
    await waitFor(() => {
      expect(screen.getByText('删除课堂会话')).toBeDefined();
      expect(screen.getByText('此操作将彻底删除会话记录，且不可撤销')).toBeDefined();
      expect(screen.getByText('确认删除')).toBeDefined();
    });

    // 点击模态窗内的“确认删除”
    fireEvent.click(screen.getByText('确认删除'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/classroom/sessions/cs-01',
        expect.objectContaining({ method: 'DELETE' }),
      );
      expect(addToast).toHaveBeenCalledWith(
        '删除成功',
        expect.stringContaining('会话及其关联数据已彻底清理'),
        'success',
      );
    });
  });
});
