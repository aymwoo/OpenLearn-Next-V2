/**
 * 学案内置活动模块：阅读 / 作品提交 / 调查 / 填表 / 讨论。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { StudentXueanView } from '../StudentXueanView';

const getXuean = vi.hoisted(() => vi.fn());
const postActivityProgress = vi.hoisted(() => vi.fn());

vi.mock('../../../../services/lessonActivitiesService.js', () => ({
  getXuean,
  postActivityProgress,
}));

vi.mock('../AssessmentActivityCard', () => ({
  AssessmentActivityCard: () => null,
}));

vi.mock('../../../../plugin-host/extension-point-renderer', () => ({
  ExtensionPointRenderer: () => null,
}));

function xueanWith(activity: Record<string, unknown>) {
  return {
    ok: true,
    data: {
      lessonId: 'lesson-1',
      blocks: [],
      activities: [
        {
          lesson_id: 'lesson-1',
          order_index: 0,
          required: 1,
          visible: 1,
          surface_id: null,
          config_json: null,
          ...activity,
        },
      ],
      progressByActivity: {},
    },
  };
}

describe('学案内置活动模块', () => {
  beforeEach(() => {
    getXuean.mockReset();
    postActivityProgress.mockReset().mockResolvedValue({ ok: true, data: {} });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('阅读活动展示正文并可标记已读', async () => {
    getXuean.mockResolvedValue(
      xueanWith({
        id: 'a1',
        type: 'reading',
        title: '阅读第一章',
        config_json: JSON.stringify({ content: '这是阅读材料正文' }),
      }),
    );

    render(<StudentXueanView lessonId="lesson-1" />);

    expect(await screen.findByText('这是阅读材料正文')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '标记为已读' }));

    await waitFor(() =>
      expect(postActivityProgress).toHaveBeenCalledWith(
        'a1',
        expect.objectContaining({ status: 'submitted', progressPercent: 100 }),
      ),
    );
  });

  it('调查活动提交选中答案的结构化 JSON', async () => {
    getXuean.mockResolvedValue(
      xueanWith({
        id: 'a2',
        type: 'survey',
        title: '学习习惯调查',
        config_json: JSON.stringify({
          description: '请如实填写',
          questions: [
            {
              id: 'q1',
              title: '你每天阅读多久？',
              type: 'single',
              options: ['少于 30 分钟', '30 分钟以上'],
              required: true,
            },
          ],
        }),
      }),
    );

    render(<StudentXueanView lessonId="lesson-1" />);

    expect(await screen.findByText('请如实填写')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: '30 分钟以上' }));
    fireEvent.click(screen.getByRole('button', { name: '提交调查' }));

    await waitFor(() => expect(postActivityProgress).toHaveBeenCalledTimes(1));
    const payload = postActivityProgress.mock.calls[0][1] as {
      submission: { type: string; content: string };
    };
    expect(JSON.parse(payload.submission.content).answers).toEqual({ q1: '30 分钟以上' });
  });

  it('填表活动按字段收集答案', async () => {
    getXuean.mockResolvedValue(
      xueanWith({
        id: 'a3',
        type: 'form',
        title: '实验记录表',
        config_json: JSON.stringify({
          description: '',
          fields: [{ id: 'f1', label: '实验现象', type: 'text', options: [], required: true }],
        }),
      }),
    );

    render(<StudentXueanView lessonId="lesson-1" />);

    const input = await screen.findByLabelText(/实验现象/);
    fireEvent.change(input, { target: { value: '溶液变蓝' } });
    fireEvent.click(screen.getByRole('button', { name: '提交填表' }));

    await waitFor(() => expect(postActivityProgress).toHaveBeenCalledTimes(1));
    const payload = postActivityProgress.mock.calls[0][1] as {
      submission: { content: string };
    };
    expect(JSON.parse(payload.submission.content).answers).toEqual({ f1: '溶液变蓝' });
  });

  it('讨论活动展示帖子并允许发布发言', async () => {
    getXuean.mockResolvedValue(
      xueanWith({
        id: 'a4',
        type: 'discussion',
        title: '课堂讨论',
        config_json: JSON.stringify({ prompt: '你如何理解这一现象？', allowReplies: true }),
      }),
    );
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/discussions') && (init?.method ?? 'GET') === 'GET') {
        return Promise.resolve({
          ok: true,
          json: async () => [
            { id: 'p1', author_id: 's1', author_name: '小明', content: '已有发言', parent_id: null, created_at: 1 },
          ],
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<StudentXueanView lessonId="lesson-1" />);

    expect(await screen.findByText('已有发言')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('讨论内容'), { target: { value: '我的观点' } });
    fireEvent.click(screen.getByRole('button', { name: '发布发言' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/lesson-activities/a4/discussions',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    await waitFor(() => expect(postActivityProgress).toHaveBeenCalledTimes(1));
  });
});
