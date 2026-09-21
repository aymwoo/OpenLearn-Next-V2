import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { StudentAssignmentEvalPanel } from '../StudentAssignmentEvalPanel';

/**
 * 回归测试 —— 学生端「作业提交与互评」面板的空 `file_path` 崩溃。
 *
 * 线上遥测（2026-09-21）：学生在 `#/courses` 打开该面板时报
 * `TypeError: Cannot read properties of null (reading 'split')`
 * （`src/components/StudentAssignmentEvalPanel.tsx`），整页白屏。
 *
 * 根因：作业中心（P0/P1）支持「纯文字 / 链接 / 多附件」提交，这类提交的
 * `plugin_submissions.file_path` 恒为 NULL，而面板直接 `file_path.split('/')`。
 * 本用例锁定：`file_path` 为 null（自己与他人）时不得抛错，且要展示真实内容物。
 */

const jsonResponse = (data: unknown) =>
  Promise.resolve({ ok: true, json: async () => data } as any);

const lessonId = 'lesson-eval-1';
const studentId = 'stu-eval-1';

function mockFetchWith(status: any, submissions: any[]) {
  const fetchMock = vi.fn((url: string) => {
    if (String(url).includes('/eval-status')) return jsonResponse(status);
    if (String(url).includes('/eval-submissions')) return jsonResponse(submissions);
    return jsonResponse({ success: true });
  });
  global.fetch = fetchMock as any;
  return fetchMock;
}

const noopToast = vi.fn();

beforeEach(() => {
  noopToast.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('StudentAssignmentEvalPanel 空 file_path', () => {
  it('纯附件提交（file_path 为 null）不崩溃，并展示附件名与下载链接', async () => {
    mockFetchWith(
      {
        submission: {
          id: 'sub-eval-1',
          assignment_id: 'asg-eval-1',
          lesson_id: lessonId,
          student_id: studentId,
          file_path: null,
          version: 2,
          created_at: Date.now() - 1000,
          updated_at: Date.now(),
          files: [{ fileId: 'file-eval-1', name: '探究报告.pdf', size: 2048, mime: 'application/pdf' }],
          textContent: '这是我的机器人设计方案说明。',
          linkUrl: null,
        },
        reviewsWritten: [],
        grade: null,
      },
      [],
    );

    render(
      <StudentAssignmentEvalPanel lessonId={lessonId} studentId={studentId} lang="zh" addToast={noopToast} />,
    );

    // 附件名（describeSubmission 取单附件名）+ 文字作答内容都要出现
    const nameNodes = await screen.findAllByText('探究报告.pdf');
    expect(nameNodes.length).toBeGreaterThan(0);
    expect(screen.getByText('这是我的机器人设计方案说明。')).toBeDefined();
    // 附件走带权限的下载端点
    const link = nameNodes.map((n) => n.closest('a')).find((a) => a !== null) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/api/assignments/asg-eval-1/files/file-eval-1');
    // 版本号仍要展示
    expect(screen.getByText('V2')).toBeDefined();
  });

  it('同学以纯文字提交（file_path 为 null）时不崩溃，展示文字与「无附件」', async () => {
    mockFetchWith(
      {
        submission: null,
        reviewsWritten: [],
        grade: null,
      },
      [
        {
          id: 'sub-eval-2',
          assignment_id: 'asg-eval-1',
          lesson_id: lessonId,
          student_id: 'stu-eval-2',
          student_name: '小红',
          file_path: null,
          version: 1,
          created_at: Date.now(),
          updated_at: Date.now(),
          files: [],
          textContent: '小红的文字作业内容',
          linkUrl: null,
        },
      ],
    );

    render(
      <StudentAssignmentEvalPanel lessonId={lessonId} studentId={studentId} lang="zh" addToast={noopToast} />,
    );

    expect(await screen.findByText('小红的文字作业内容')).toBeDefined();
    expect(screen.getByText('文字作答 (V1)')).toBeDefined();
    expect(screen.getByText('无附件')).toBeDefined();
    // 未提交时给出提示而非崩溃
    expect(screen.getByText('未提交作业')).toBeDefined();
  });

  it('仍兼容历史纯路径提交（file_path 有值）', async () => {
    mockFetchWith(
      {
        submission: {
          id: 'sub-eval-3',
          assignment_id: null,
          lesson_id: lessonId,
          student_id: studentId,
          file_path: '/files/homework/my-homework.pdf',
          version: 1,
          created_at: Date.now(),
          updated_at: Date.now(),
          files: [],
          textContent: null,
          linkUrl: null,
        },
        reviewsWritten: [],
        grade: null,
      },
      [],
    );

    render(
      <StudentAssignmentEvalPanel lessonId={lessonId} studentId={studentId} lang="zh" addToast={noopToast} />,
    );

    expect(await screen.findByText('my-homework.pdf')).toBeDefined();
    expect(await screen.findByText('/files/homework/my-homework.pdf')).toBeDefined();
  });

  it('未提交任何作业时不渲染提交卡片', async () => {
    mockFetchWith({ submission: null, reviewsWritten: [], grade: null }, []);

    render(
      <StudentAssignmentEvalPanel lessonId={lessonId} studentId={studentId} lang="zh" addToast={noopToast} />,
    );

    await waitFor(() => {
      expect(screen.getByText('我的作业提交')).toBeDefined();
    });
    expect(screen.getByText('未提交作业')).toBeDefined();
    expect(screen.getByText('当前暂无同学提交作业作品。')).toBeDefined();
  });
});
