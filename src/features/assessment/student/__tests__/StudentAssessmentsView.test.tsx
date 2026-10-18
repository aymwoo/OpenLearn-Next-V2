import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { StudentAssessmentsView } from '../StudentAssessmentsView';

const ENTRY_PENDING = {
  assignmentId: 'asg-1',
  assessmentId: 'as-1',
  kind: 'quiz',
  title: '第三单元小测',
  classId: 'cls-1',
  lessonId: null,
  opensAt: null,
  closesAt: Date.now() + 3600_000,
  durationSec: 1800,
  windowState: 'open',
  completed: false,
  attempt: null,
};

const ENTRY_CLOSED = {
  ...ENTRY_PENDING,
  assignmentId: 'asg-2',
  title: '已截止测评',
  closesAt: Date.now() - 1000,
  windowState: 'after_close',
};

const ATTEMPT_PAYLOAD = {
  newAttempt: true,
  assignment: {
    id: 'asg-1',
    assessmentId: 'as-1',
    kind: 'quiz',
    title: '第三单元小测',
    description: null,
    settings: {
      timed: true,
      maxAttempts: 1,
      scorePolicy: 'last',
      shuffleItems: false,
      shuffleOptions: false,
      anonymous: false,
      resultVisibility: 'immediate',
      partialCredit: true,
      caseSensitive: false,
      countsTowardGrade: false,
      showItemAnalysis: true,
    },
  },
  attempt: {
    id: 'at-1',
    assignmentId: 'asg-1',
    attemptNo: 1,
    status: 'in_progress',
    startedAt: 1,
    submittedAt: null,
    deadlineAt: Date.now() + 3600_000,
    remainingSeconds: 3600,
    score: null,
    maxScore: null,
    needsManualReview: false,
  },
  items: [
    {
      id: 'it-1',
      section: null,
      sortOrder: 0,
      type: 'single_choice',
      stem: '1+1=?',
      config: { options: ['1', '2'] },
      maxScore: 5,
    },
    {
      id: 'it-2',
      section: null,
      sortOrder: 1,
      type: 'fill_blank',
      stem: '水的化学式？',
      config: { blanks: [{ id: 'b1' }] },
      maxScore: 5,
    },
  ],
  answers: {},
};

const RESULT = {
  assignment: {
    id: 'asg-1',
    assessmentId: 'as-1',
    kind: 'quiz',
    title: '第三单元小测',
    classId: 'cls-1',
    scoreReleased: false,
    academicYear: '2026-2027',
  },
  attempt: { ...ATTEMPT_PAYLOAD.attempt, status: 'graded', score: 5, maxScore: 5, submittedAt: Date.now() },
  showScore: true,
  showAnalysis: true,
  items: [
    {
      itemId: 'it-1',
      type: 'single_choice',
      stem: '1+1=?',
      maxScore: 5,
      answer: 1,
      score: 5,
      isCorrect: true,
      needsManualReview: false,
      feedback: null,
      answerKey: { index: 1 },
    },
  ],
  aggregate: { score: 5, maxScore: 5, attemptId: 'at-1', consideredAttempts: 1, provisional: false },
};

function stubFetch(handlers: Record<string, (init?: RequestInit) => any>) {
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

describe('Issue #122 · 学生端我的测评', () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('列表按待完成/已完成分组，已截止的测评不可进入', async () => {
    stubFetch({ 'GET /api/me/assessments': () => ({ items: [ENTRY_PENDING, ENTRY_CLOSED] }) });
    render(<StudentAssessmentsView lang="zh" />);

    expect(await screen.findByTestId('student-pending-list')).toBeTruthy();
    const closed = screen.getByTestId('student-assessment-asg-2');
    const closedBtn = closed.querySelector('button') as HTMLButtonElement;
    expect(closedBtn.disabled).toBe(true);
    expect(closedBtn.textContent).toContain('已截止');
  });

  it('空态给出提示', async () => {
    stubFetch({ 'GET /api/me/assessments': () => ({ items: [] }) });
    render(<StudentAssessmentsView lang="zh" />);
    expect(await screen.findByText('暂无待完成测评')).toBeTruthy();
  });

  it('开始作答 → 渲染各题型作答控件', async () => {
    stubFetch({
      'GET /api/me/assessments': () => ({ items: [ENTRY_PENDING] }),
      'POST /api/assessment-assignments/asg-1/attempts': () => ATTEMPT_PAYLOAD,
    });
    render(<StudentAssessmentsView lang="zh" />);

    await screen.findByTestId('student-assessment-asg-1');
    fireEvent.click(screen.getByRole('button', { name: /开始作答/ }));

    expect(await screen.findByTestId('answer-item-it-1')).toBeTruthy();
    // 单选：两个选项可点
    expect(screen.getByRole('radio', { name: /A\./ })).toBeTruthy();
    // 填空：一个空位输入框
    expect(screen.getByLabelText('第 1 空')).toBeTruthy();
    // 倒计时存在
    expect(screen.getByTestId('assessment-countdown')).toBeTruthy();
  });

  it('作答变动 1.5s 防抖后自动保存（PUT 单题）', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const mock = stubFetch({
      'GET /api/me/assessments': () => ({ items: [ENTRY_PENDING] }),
      'POST /api/assessment-assignments/asg-1/attempts': () => ATTEMPT_PAYLOAD,
      'PUT /api/assessment-attempts/at-1/answers/it-1': () => ({ ok: true }),
    });
    render(<StudentAssessmentsView lang="zh" />);

    await screen.findByTestId('student-assessment-asg-1');
    fireEvent.click(screen.getByRole('button', { name: /开始作答/ }));
    await screen.findByTestId('answer-item-it-1');

    fireEvent.click(screen.getByRole('radio', { name: /B\./ }));
    // 防抖期内不应立刻发请求
    const saveCalls = () =>
      mock.mock.calls.filter(([u, i]) => String(u).includes('/answers/it-1') && i?.method === 'PUT');
    expect(saveCalls().length).toBe(0);

    await act(async () => {
      vi.advanceTimersByTime(1600);
    });
    await waitFor(() => expect(saveCalls().length).toBe(1));
    expect(JSON.parse(String(saveCalls()[0][1]!.body))).toEqual({ answer: 1 });
  });

  it('交卷时先 flush 未保存的作答，再提交并展示结果', async () => {
    const mock = stubFetch({
      'GET /api/me/assessments': () => ({ items: [ENTRY_PENDING] }),
      'POST /api/assessment-assignments/asg-1/attempts': () => ATTEMPT_PAYLOAD,
      'PUT /api/assessment-attempts/at-1/answers/it-1': () => ({ ok: true }),
      'POST /api/assessment-attempts/at-1/submit': () => RESULT,
    });
    render(<StudentAssessmentsView lang="zh" />);

    await screen.findByTestId('student-assessment-asg-1');
    fireEvent.click(screen.getByRole('button', { name: /开始作答/ }));
    await screen.findByTestId('answer-item-it-1');

    fireEvent.click(screen.getByRole('radio', { name: /B\./ }));
    fireEvent.click(screen.getByRole('button', { name: /提交交卷/ }));

    await waitFor(() => expect(screen.getByTestId('result-score')).toBeTruthy());
    expect(screen.getByTestId('result-score').textContent).toBe('5/5');

    const urls = mock.mock.calls.map(([u]) => String(u));
    // 交卷前必须先有 saveAnswer
    expect(urls.findIndex((u) => u.includes('/answers/it-1'))).toBeLessThan(
      urls.findIndex((u) => u.includes('/submit')),
    );
  });

  it('已完成且成绩未发布时，结果页不泄露分数与解析', async () => {
    const hidden = { ...RESULT, showScore: false, showAnalysis: false };
    stubFetch({
      'GET /api/me/assessments': () => ({
        items: [
          {
            ...ENTRY_PENDING,
            completed: true,
            attempt: { ...ATTEMPT_PAYLOAD.attempt, status: 'submitted', score: null },
          },
        ],
      }),
      'GET /api/assessment-attempts/at-1/result': () => hidden,
    });
    render(<StudentAssessmentsView lang="zh" />);

    await screen.findByTestId('student-completed-list');
    fireEvent.click(screen.getByRole('button', { name: /查看结果/ }));

    await waitFor(() => expect(screen.getByTestId('result-item-it-1')).toBeTruthy());
    expect(screen.queryByTestId('result-score')).toBeNull();
    expect(screen.getByText(/成绩待老师发布后可见/)).toBeTruthy();
    // 解析（参考答案）不出现
    expect(screen.queryByText(/参考答案/)).toBeNull();
  });

  it('倒计时归零自动交卷', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const payload = { ...ATTEMPT_PAYLOAD, attempt: { ...ATTEMPT_PAYLOAD.attempt, remainingSeconds: 2 } };
    const mock = stubFetch({
      'GET /api/me/assessments': () => ({ items: [ENTRY_PENDING] }),
      'POST /api/assessment-assignments/asg-1/attempts': () => payload,
      'POST /api/assessment-attempts/at-1/submit': () => RESULT,
    });
    render(<StudentAssessmentsView lang="zh" />);

    await screen.findByTestId('student-assessment-asg-1');
    fireEvent.click(screen.getByRole('button', { name: /开始作答/ }));
    await screen.findByTestId('assessment-countdown');

    // 倒计时每秒一跳（effect 里挂 setTimeout），必须逐步推进才能走到 0
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        vi.advanceTimersByTime(1100);
      });
    }
    await waitFor(() => expect(mock.mock.calls.some(([u]) => String(u).includes('/submit'))).toBe(true));
  });
});
