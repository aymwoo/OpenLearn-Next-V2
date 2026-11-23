/**
 * XueanActivitiesPanel：插件活动类型合并、试题引用试卷、活动拖拽排序。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { XueanActivitiesPanel } from '../XueanActivitiesPanel';

const assessmentList = vi.hoisted(() => vi.fn());

vi.mock('../../../../context/AppDataContext', () => ({
  useOptionalAppData: () => ({ selectedLesson: 'lesson-1' }),
}));

vi.mock('../../../assessment/api', () => ({
  assessmentApi: { list: assessmentList },
}));

type Row = {
  id: string;
  lesson_id: string;
  order_index: number;
  type: string;
  title: string;
  config_json: string | null;
  required: number;
  visible: number;
  peer_review: number;
  group_mode: string;
  submission_type: string | null;
  rubric_json: string | null;
  release_at: number | null;
  due_at: number | null;
  created_at: number;
  updated_at: number;
};

function row(id: string, order: number, title: string, type = 'reading'): Row {
  return {
    id,
    lesson_id: 'lesson-1',
    order_index: order,
    type,
    title,
    config_json: null,
    required: 1,
    visible: 1,
    peer_review: 0,
    group_mode: 'none',
    submission_type: null,
    rubric_json: null,
    release_at: null,
    due_at: null,
    created_at: 1,
    updated_at: 1,
  };
}

function response(body: unknown, ok = true) {
  return Promise.resolve({ ok, json: async () => body } as Response);
}

describe('XueanActivitiesPanel', () => {
  const state = {
    activities: [] as Row[],
    assessmentBodies: [] as Array<Record<string, unknown>>,
    reordered: [] as string[][],
  };

  beforeEach(() => {
    state.activities = [];
    state.assessmentBodies = [];
    state.reordered = [];
    assessmentList.mockReset().mockResolvedValue({ items: [] });
    globalThis.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/lessons/lesson-1/activities' && method === 'GET') return response(state.activities);
      if (url === '/api/xuean/activity-types') {
        return response([
          { id: 'reading', label: '阅读任务', source: 'builtin' },
          { id: '@acme/lab:experiment', label: '虚拟实验', source: 'plugin' },
        ]);
      }
      if (url === '/api/lessons/lesson-1/linked-classes') return response([{ id: 'class-1', name: '高一(1)班' }]);
      if (url === '/api/lessons/lesson-1/activities/assessment') {
        state.assessmentBodies.push(JSON.parse(String(init?.body ?? '{}')));
        return response({ success: true, activity: row('act-quiz', 0, '随堂测', 'quiz') });
      }
      if (url === '/api/lessons/lesson-1/activities/reorder') {
        state.reordered.push((JSON.parse(String(init?.body ?? '{}')).ids ?? []) as string[]);
        return response([]);
      }
      return response({ error: 'unexpected' }, false);
    }) as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('合并插件声明的活动类型并在选中时渲染插件编辑器回退', async () => {
    render(<XueanActivitiesPanel />);
    await screen.findByText('还没有活动');

    fireEvent.click(screen.getByRole('button', { name: '+ 新增活动' }));
    expect(await screen.findByRole('option', { name: '虚拟实验' })).toBeTruthy();

    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: '@acme/lab:experiment' } });
    expect(await screen.findByText('插件未加载，暂时只能编辑下方的通用字段。')).toBeTruthy();
  });

  it('试题活动提交引用试卷的原子接口', async () => {
    assessmentList.mockResolvedValue({
      items: [{ id: 'a1', title: '单元测验', status: 'published', itemCount: 5 }],
    });

    render(<XueanActivitiesPanel />);
    await screen.findByText('还没有活动');

    fireEvent.click(screen.getByRole('button', { name: '+ 新增活动' }));
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'quiz' } });

    expect(await screen.findByRole('option', { name: /单元测验 · published · 5 题/ })).toBeTruthy();
    expect(await screen.findByRole('option', { name: '高一(1)班' })).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText('例如：阅读第 3 章'), { target: { value: '随堂测' } });
    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: 'a1' } });
    fireEvent.change(screen.getAllByRole('combobox')[2], { target: { value: 'class-1' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(state.assessmentBodies).toHaveLength(1));
    expect(state.assessmentBodies[0]).toEqual({
      assessmentId: 'a1',
      classId: 'class-1',
      title: '随堂测',
      required: true,
      visible: true,
    });
  });

  it('下移活动时提交新的 id 顺序', async () => {
    state.activities = [row('a1', 0, '阅读材料'), row('a2', 1, '作品提交', 'submission')];

    render(<XueanActivitiesPanel />);
    await screen.findByText('阅读材料');

    fireEvent.click(screen.getAllByRole('button', { name: '下移' })[0]);

    await waitFor(() => expect(state.reordered).toHaveLength(1));
    expect(state.reordered[0]).toEqual(['a2', 'a1']);
  });
});
