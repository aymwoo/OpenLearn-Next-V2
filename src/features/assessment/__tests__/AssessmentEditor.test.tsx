import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { AssessmentEditor } from '../AssessmentEditor';
import { AppDataProvider } from '../../../context/AppDataContext';

const DETAIL = {
  id: 'as-1',
  kind: 'quiz',
  title: '第三单元小测',
  description: null,
  status: 'draft',
  academicYear: '2026-2027',
  settings: {
    timed: false,
    maxAttempts: 3,
    scorePolicy: 'highest',
    shuffleItems: false,
    shuffleOptions: false,
    anonymous: false,
    resultVisibility: 'immediate',
    partialCredit: true,
    caseSensitive: false,
    countsTowardGrade: false,
    showItemAnalysis: true,
  },
  itemCount: 1,
  totalScore: 5,
  createdAt: 1,
  updatedAt: 2,
  items: [
    {
      id: 'it-1',
      type: 'single_choice',
      stem: '1+1=?',
      config: { options: ['1', '2'] },
      answerKey: { index: 1 },
      maxScore: 5,
      sortOrder: 0,
      section: null,
    },
  ],
};

const ASSIGNMENT = {
  id: 'asg-1',
  assessmentId: 'as-1',
  classId: 'cls-1',
  className: '高一1班',
  lessonId: null,
  scheduleId: null,
  opensAt: null,
  closesAt: null,
  durationSec: 3600,
  status: 'open',
  scoreReleased: false,
  academicYear: '2026-2027',
  createdAt: 3,
  attemptCount: 4,
  submittedCount: 2,
  pendingReviewCount: 1,
};

function stubFetch(overrides: Record<string, (init?: RequestInit) => any> = {}) {
  const handlers: Record<string, (init?: RequestInit) => any> = {
    'GET /api/assessments/as-1/assignments': () => ({ items: [ASSIGNMENT] }),
    'GET /api/assessments/as-1': () => DETAIL,
    'PUT /api/assessments/as-1/items': () => DETAIL,
    'PUT /api/assessments/as-1': () => DETAIL,
    'POST /api/assessments/as-1/publish': () => ASSIGNMENT,
    'GET /api/question-bank': () => ({ items: [] }),
    'GET /api/assessment-assignments/asg-1/attempts': () => ({ items: [] }),
    'GET /api/assessment-assignments/asg-1/stats': () => ({
      assignmentId: 'asg-1',
      attemptCount: 0,
      submittedCount: 0,
      gradedCount: 0,
      needsManualReviewCount: 0,
      averageScore: null,
      averagePercent: null,
      maxScore: 5,
      items: [],
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

const providerValue = { lang: 'zh', classes: [{ id: 'cls-1', name: '高一1班' }] };

describe('Issue #121 · 试卷编辑器', () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('加载题目并渲染 5 种题型的添加入口', async () => {
    stubFetch();
    render(
      <AppDataProvider value={providerValue as any}>
        <AssessmentEditor assessmentId="as-1" lang="zh" onBack={vi.fn()} />
      </AppDataProvider>,
    );

    expect(await screen.findByDisplayValue('1+1=?')).toBeTruthy();
    for (const label of ['单选题', '多选题', '判断题', '填空题', '简答/论述']) {
      expect(screen.getAllByRole('button', { name: new RegExp(label) }).length).toBeGreaterThan(0);
    }
  });

  it('添加题目后保存，提交的是 index 型答案结构', async () => {
    const mock = stubFetch();
    render(
      <AppDataProvider value={providerValue as any}>
        <AssessmentEditor assessmentId="as-1" lang="zh" onBack={vi.fn()} />
      </AppDataProvider>,
    );
    await screen.findByDisplayValue('1+1=?');

    fireEvent.click(screen.getAllByRole('button', { name: /多选题/ })[0]);
    await waitFor(() => expect(screen.getByTestId('item-row-1')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /保存题目/ }));

    await waitFor(() => {
      const call = mock.mock.calls.find(([url, init]) => String(url).includes('/items') && init?.method === 'PUT');
      expect(call).toBeTruthy();
      const body = JSON.parse(String(call![1]!.body));
      expect(body.items).toHaveLength(2);
      expect(body.items[1]).toMatchObject({ type: 'multiple_choice', sortOrder: 1 });
      // 多选默认答案是索引数组
      expect(body.items[1].answerKey).toEqual({ indexes: [0] });
    });
  });

  it('发布到班级：把班级与限时传给后端，并刷新布置列表', async () => {
    const mock = stubFetch();
    render(
      <AppDataProvider value={providerValue as any}>
        <AssessmentEditor assessmentId="as-1" lang="zh" onBack={vi.fn()} />
      </AppDataProvider>,
    );
    await screen.findByTestId('assignment-row-asg-1');

    // 未选班级 → 明确报错，不发请求
    fireEvent.click(screen.getByRole('button', { name: /^发布$/ }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(mock.mock.calls.some(([u]) => String(u).includes('/publish'))).toBe(false);

    fireEvent.change(screen.getByLabelText('班级'), { target: { value: 'cls-1' } });
    fireEvent.change(screen.getByLabelText('限时（分钟，可选）'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: /^发布$/ }));

    await waitFor(() => {
      const call = mock.mock.calls.find(([url]) => String(url).includes('/publish'));
      expect(call).toBeTruthy();
      expect(JSON.parse(String(call![1]!.body))).toMatchObject({ classId: 'cls-1', durationSec: 1800 });
    });
  });

  it('布置列表显示交卷进度并支持发布成绩 / 关闭', async () => {
    const mock = stubFetch();
    render(
      <AppDataProvider value={providerValue as any}>
        <AssessmentEditor assessmentId="as-1" lang="zh" onBack={vi.fn()} />
      </AppDataProvider>,
    );

    const row = await screen.findByTestId('assignment-row-asg-1');
    expect(row.textContent).toContain('高一1班');
    expect(row.textContent).toContain('已交卷 2/4');
    expect(row.textContent).toContain('待批改 1');

    fireEvent.click(screen.getByRole('button', { name: /发布成绩/ }));
    await waitFor(() => expect(mock.mock.calls.some(([url]) => String(url).includes('/release'))).toBe(true));
  });

  it('设置项改动立即 PATCH 到后端（quiz 才允许改作答次数）', async () => {
    const mock = stubFetch();
    render(
      <AppDataProvider value={providerValue as any}>
        <AssessmentEditor assessmentId="as-1" lang="zh" onBack={vi.fn()} />
      </AppDataProvider>,
    );
    await screen.findByDisplayValue('1+1=?');

    fireEvent.change(screen.getByLabelText('允许作答次数'), { target: { value: '2' } });
    await waitFor(() => {
      const call = mock.mock.calls.find(
        ([url, init]) => String(url).endsWith('/api/assessments/as-1') && init?.method === 'PUT',
      );
      expect(call).toBeTruthy();
      expect(JSON.parse(String(call![1]!.body))).toMatchObject({ settings: { maxAttempts: 2 } });
    });
  });
});
