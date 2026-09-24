import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ParentNotificationModal, type ClassSummarySnapshot } from '../ParentNotificationModal';

afterEach(cleanup);

const baseSnapshot: ClassSummarySnapshot = {
  lessonTitle: 'Python 循环与算法',
  lessonId: 'les-1',
  className: '高一 (3) 班',
  classId: 'cls-1',
  startTimeMs: 1_700_000_000_000,
  endTimeMs: 1_700_002_700_000,
  totalStudents: 32,
  onlineStudentIds: ['stu-1', 'stu-2'],
  highlights: ['全场抢答 24 人'],
  stages: [{ stageName: '导入', plannedMin: 5, actualMin: 6 }],
  students: [
    { id: 'stu-1', name: '张子豪', participationScore: 92, quizScore: 88, behaviorTags: ['积极举手'] },
    { id: 'stu-2', name: '李晓彤', participationScore: 61, behaviorTags: ['专注度 76%'] },
  ],
};

const noopToast = vi.fn();

describe('ParentNotificationModal', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('关闭时不渲染', () => {
    const { container } = render(
      <ParentNotificationModal isOpen={false} onClose={noopToast} snapshot={baseSnapshot} addToast={noopToast} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('打开时自动请求并渲染班级简报', async () => {
    const fetchMock = vi.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        lessonId: 'les-1',
        generatedAt: Date.now(),
        classMarkdown: '# 📚 Python 循环与算法 · 班级学情简报\n\n**出勤**：2/32',
        studentNotifications: [
          { studentId: 'stu-1', studentName: '张子豪', markdown: '### 致 张子豪 家长' },
          { studentId: 'stu-2', studentName: '李晓彤', markdown: '### 致 李晓彤 家长' },
        ],
        counts: { students: 2, online: 2, highlights: 1 },
      }),
    } as any);

    render(
      <ParentNotificationModal isOpen={true} onClose={noopToast} snapshot={baseSnapshot} addToast={noopToast} />,
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/classroom/les-1/parent-notification',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    // 班级 Markdown 渲染
    expect(await screen.findByText(/班级学情简报/)).toBeTruthy();
    // 逐生 tab 计数
    expect(screen.getByText('逐生通知')).toBeTruthy();
  });

  it('切到逐生 tab 后选择学生显示其 markdown', async () => {
    vi.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        lessonId: 'les-1',
        generatedAt: Date.now(),
        classMarkdown: 'class-md',
        studentNotifications: [
          { studentId: 'stu-1', studentName: '张子豪', markdown: '### 致 张子豪 家长' },
          { studentId: 'stu-2', studentName: '李晓彤', markdown: '### 致 李晓彤 家长' },
        ],
        counts: { students: 2, online: 2, highlights: 0 },
      }),
    } as any);

    render(
      <ParentNotificationModal isOpen={true} onClose={noopToast} snapshot={baseSnapshot} addToast={noopToast} />,
    );

    await screen.findByText(/class-md|班级学情简报/);

    fireEvent.click(screen.getByText('逐生通知'));
    // 侧栏出现两位学生
    const studentButtons = await screen.findAllByText('张子豪');
    fireEvent.click(studentButtons[0]);

    expect(await screen.findByText(/致 张子豪 家长/)).toBeTruthy();
  });

  it('请求失败时弹出错误 toast', async () => {
    vi.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'boom',
    } as any);

    render(
      <ParentNotificationModal isOpen={true} onClose={noopToast} snapshot={baseSnapshot} addToast={noopToast} />,
    );

    await waitFor(() => {
      expect(noopToast).toHaveBeenCalledWith(
        expect.stringContaining('生成失败'),
        expect.any(String),
        'error',
      );
    });
  });

  it('lessonId 为空时不发起请求', async () => {
    const fetchMock = vi.spyOn(global, 'fetch' as any).mockResolvedValue({ ok: true, json: async () => ({}) } as any);

    render(
      <ParentNotificationModal
        isOpen={true}
        onClose={noopToast}
        snapshot={{ ...baseSnapshot, lessonId: null }}
        addToast={noopToast}
      />,
    );

    await new Promise((r) => setTimeout(r, 50));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
