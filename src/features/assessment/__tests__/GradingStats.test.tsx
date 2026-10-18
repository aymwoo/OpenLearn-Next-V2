import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { GradingPanel } from '../GradingPanel';
import { StatsPanel } from '../StatsPanel';

const ASSIGNMENT = {
  id: 'asg-1',
  assessmentId: 'as-1',
  classId: 'cls-1',
  className: '高一1班',
  lessonId: null,
  scheduleId: null,
  opensAt: null,
  closesAt: null,
  durationSec: null,
  status: 'open' as const,
  scoreReleased: false,
  academicYear: '2026-2027',
  createdAt: 1,
};

const ATTEMPT = {
  id: 'at-1',
  assignmentId: 'asg-1',
  attemptNo: 1,
  status: 'submitted',
  startedAt: 1,
  submittedAt: 2,
  deadlineAt: null,
  score: 5,
  maxScore: 25,
  needsManualReview: true,
  studentId: 'stu-1',
  anonymousLabel: null,
  proctor: {},
};

const TEACHER_VIEW = {
  attempt: ATTEMPT,
  items: [
    {
      itemId: 'it-1',
      type: 'single_choice',
      stem: '1+1=?',
      maxScore: 5,
      answer: 1,
      answerKey: { index: 1 },
      score: 5,
      isCorrect: true,
      needsManualReview: false,
      feedback: null,
      grader: 'auto',
      manualOverride: false,
      config: { options: ['1', '2'] },
    },
    {
      itemId: 'it-2',
      type: 'short_answer',
      stem: '说说你的理解',
      maxScore: 20,
      answer: '这是我的理解',
      answerKey: null,
      score: null,
      isCorrect: null,
      needsManualReview: true,
      feedback: null,
      grader: null,
      manualOverride: false,
      config: {},
    },
  ],
};

function stubFetch(overrides: Record<string, (init?: RequestInit) => any> = {}) {
  const handlers: Record<string, (init?: RequestInit) => any> = {
    'GET /api/assessment-assignments/asg-1/attempts': () => ({ items: [ATTEMPT] }),
    'GET /api/assessment-attempts/at-1/teacher-view': () => TEACHER_VIEW,
    'PUT /api/assessment-attempts/at-1/answers/it-2/grade': () => ({ attempt: ATTEMPT }),
    'GET /api/assessment-assignments/asg-1/stats': () => ({
      assignmentId: 'asg-1',
      attemptCount: 1,
      submittedCount: 1,
      gradedCount: 1,
      needsManualReviewCount: 0,
      averageScore: 18,
      averagePercent: 72,
      maxScore: 25,
      items: [
        {
          itemId: 'it-1',
          type: 'single_choice',
          stem: '1+1=?',
          maxScore: 5,
          answered: 1,
          graded: 1,
          correct: 1,
          correctRate: 100,
          avgScore: 5,
          distribution: { '1': 1 },
        },
      ],
    }),
    ...overrides,
  };
  const mock = vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${String(url)}`;
    for (const [pattern, handler] of Object.entries(handlers)) {
      if (key.includes(pattern)) {
        return { ok: true, status: 200, text: async () => JSON.stringify(await handler(init)) } as any;
      }
    }
    return { ok: true, status: 200, text: async () => '{}' } as any;
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

describe('Issue #121 · 批改与统计面板', () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('批改：列出作答、展开逐题、给简答题打分并写评语', async () => {
    const mock = stubFetch();
    render(<GradingPanel assignment={ASSIGNMENT} lang="zh" onBack={vi.fn()} />);

    await waitFor(() => expect(screen.getByTestId('grading-attempt-list')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /stu-1/ }));

    // 学生作答原文可见（批改依据）
    expect(await screen.findByText('这是我的理解')).toBeTruthy();
    expect(screen.getByTestId('grading-item-it-2')).toBeTruthy();

    // 两道题各有一个「得分」输入框：按 itemId 定位简答题那个
    const scoreInput = screen.getByTestId('grading-item-it-2').querySelector('input[id^="score-"]') as HTMLInputElement;
    fireEvent.change(scoreInput, { target: { value: '16' } });
    const feedbackInput = screen
      .getByTestId('grading-item-it-2')
      .querySelector('input[id^="feedback-"]') as HTMLInputElement;
    fireEvent.change(feedbackInput, { target: { value: '思路清晰' } });

    const saveButtons = screen.getAllByRole('button', { name: /保存评分/ });
    fireEvent.click(saveButtons[saveButtons.length - 1]);

    await waitFor(() => {
      const call = mock.mock.calls.find(([url]) => String(url).includes('/answers/it-2/grade'));
      expect(call).toBeTruthy();
      expect(JSON.parse(String(call![1]!.body))).toMatchObject({ score: 16, feedback: '思路清晰' });
    });
  });

  it('批改：分数留空时给出提示且不发请求', async () => {
    const mock = stubFetch();
    render(<GradingPanel assignment={ASSIGNMENT} lang="zh" onBack={vi.fn()} />);

    await waitFor(() => expect(screen.getByTestId('grading-attempt-list')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /stu-1/ }));
    await screen.findByTestId('grading-item-it-2');

    const scoreInput = screen.getByTestId('grading-item-it-2').querySelector('input[id^="score-"]') as HTMLInputElement;
    fireEvent.change(scoreInput, { target: { value: '' } });
    const saveButtons = screen.getAllByRole('button', { name: /保存评分/ });
    fireEvent.click(saveButtons[saveButtons.length - 1]);

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(mock.mock.calls.some(([url]) => String(url).includes('/grade'))).toBe(false);
  });

  it('统计：展示汇总卡片与逐题表格，并提供 CSV 导出链接', async () => {
    stubFetch();
    render(<StatsPanel assignment={ASSIGNMENT} lang="zh" onBack={vi.fn()} />);

    expect(await screen.findByTestId('stats-table')).toBeTruthy();
    expect(screen.getByText('18 (72%)')).toBeTruthy();
    expect(screen.getByText('100%')).toBeTruthy();
    const csv = screen.getByRole('link', { name: /导出 CSV/ }) as HTMLAnchorElement;
    expect(csv.getAttribute('href')).toContain('/api/assessment-assignments/asg-1/export');
  });
});
