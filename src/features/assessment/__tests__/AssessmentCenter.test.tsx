import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { AppDataProvider } from '../../../context/AppDataContext';
import { AssessmentCenter } from '../AssessmentCenter';

const SUMMARY = {
  id: 'as-1',
  kind: 'quiz',
  title: '第三单元小测',
  description: '覆盖前两节知识点',
  status: 'draft',
  academicYear: '2026-2027',
  settings: {
    timed: false,
    maxAttempts: 2,
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
  itemCount: 3,
  totalScore: 15,
  createdAt: 1,
  updatedAt: 2,
};

const DETAIL = {
  ...SUMMARY,
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

function stubFetch(handlers: Record<string, (init?: RequestInit) => any>) {
  const mock = vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${String(url)}`;
    for (const [pattern, handler] of Object.entries(handlers)) {
      if (key.includes(pattern)) {
        const result = await handler(init);
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify(result),
        } as any;
      }
    }
    return { ok: true, status: 200, text: async () => '{}' } as any;
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

const providerValue = { lang: 'zh', classes: [{ id: 'cls-1', name: '高一1班' }] };

describe('Issue #121 · 测评中心页面', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('渲染试卷列表与类型/状态徽标', async () => {
    stubFetch({
      'GET /api/assessments?': () => ({ items: [SUMMARY] }),
      'GET /api/assessments': () => ({ items: [SUMMARY] }),
    });
    render(
      <AppDataProvider value={providerValue as any}>
        <AssessmentCenter />
      </AppDataProvider>,
    );

    expect(await screen.findByTestId('assessment-list')).toBeTruthy();
    const row = within(screen.getByTestId('assessment-row-as-1'));
    expect(row.getByText('第三单元小测')).toBeTruthy();
    expect(row.getByText('测试')).toBeTruthy();
    expect(row.getByText('草稿')).toBeTruthy();
    expect(row.getByText('3 题')).toBeTruthy();
    // 可作答次数来自 settings
    expect(row.getByText('可作答 2 次')).toBeTruthy();
  });

  it('空态给出新建入口', async () => {
    stubFetch({ 'GET /api/assessments': () => ({ items: [] }) });
    render(
      <AppDataProvider value={providerValue as any}>
        <AssessmentCenter />
      </AppDataProvider>,
    );

    expect(await screen.findByText('还没有任何测评')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /新建测评/ }).length).toBeGreaterThan(0);
  });

  it('新建对话框按类型创建后进入编辑器', async () => {
    const mock = stubFetch({
      'POST /api/assessments': () => DETAIL,
      'GET /api/assessments/as-1/assignments': () => ({ items: [] }),
      'GET /api/assessments/as-1': () => DETAIL,
      'GET /api/assessments': () => ({ items: [SUMMARY] }),
    });
    render(
      <AppDataProvider value={providerValue as any}>
        <AssessmentCenter />
      </AppDataProvider>,
    );

    await screen.findByTestId('assessment-list');
    fireEvent.click(screen.getAllByRole('button', { name: /新建测评/ })[0]);

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeTruthy();
    // 三种类型都可选
    for (const label of ['测试', '考试', '问卷']) {
      expect(withinDialog(label)).toBeTruthy();
    }
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: '期中考试' } });
    fireEvent.click(screen.getByRole('button', { name: /创建并开始组卷/ }));

    await waitFor(() => {
      const call = mock.mock.calls.find(
        ([url, init]) => String(url).includes('/api/assessments') && init?.method === 'POST',
      );
      expect(call).toBeTruthy();
      expect(JSON.parse(String(call![1]!.body))).toMatchObject({ kind: 'quiz', title: '期中考试' });
    });
    // 进入编辑器后能读到题目详情
    expect(await screen.findByDisplayValue('1+1=?')).toBeTruthy();
  });

  it('已发布试卷只读：看不到保存题目按钮，题干输入禁用', async () => {
    stubFetch({
      'GET /api/assessments?': () => ({ items: [{ ...SUMMARY, status: 'published' }] }),
      'GET /api/assessments/as-1/assignments': () => ({ items: [] }),
      'GET /api/assessments/as-1': () => ({ ...DETAIL, status: 'published' }),
      'GET /api/assessments': () => ({ items: [{ ...SUMMARY, status: 'published' }] }),
    });
    render(
      <AppDataProvider value={providerValue as any}>
        <AssessmentCenter />
      </AppDataProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('assessment-row-as-1')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /查看与批改/ }));

    expect(await screen.findByDisplayValue('1+1=?')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /保存题目/ })).toBeNull();
    expect((screen.getByDisplayValue('1+1=?') as HTMLTextAreaElement).disabled).toBe(true);
    // 已发布不再显示「添加题型」按钮
    expect(screen.queryByRole('button', { name: '单选题' })).toBeNull();
  });
});

function withinDialog(text: string) {
  const dialog = screen.getByRole('dialog');
  return dialog.textContent?.includes(text);
}
