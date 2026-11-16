import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { ActivityPackEditor } from '../ActivityPackEditor';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const pack = {
  success: true,
  role: 'teacher',
  pack: {
    lessonId: 'les-1',
    courseId: null,
    blocks: [
      {
        id: 'b1',
        lessonId: 'les-1',
        blockType: 'learning_goals',
        orderIndex: 0,
        content: { text: '目标' },
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    activities: [
      {
        id: 'act-1',
        lessonId: 'les-1',
        orderIndex: 0,
        type: 'reading',
        title: '阅读任务',
        config: { body: '正文' },
        required: true,
        visible: true,
        peerReview: false,
        groupMode: false,
        submissionType: null,
        rubric: null,
        releaseAt: null,
        dueAt: null,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    unresolvedBindings: [],
  },
};

describe('ActivityPackEditor', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/activity-pack')) {
          return { ok: true, json: async () => pack } as Response;
        }
        if (url.includes('/progress')) {
          return {
            ok: true,
            json: async () => ({ success: true, activity: pack.pack.activities[0], progress: [] }),
          } as Response;
        }
        return { ok: true, json: async () => [] } as Response;
      }),
    );
  });

  it('loads the pack and shows the reading activity', async () => {
    render(<ActivityPackEditor lessonId="les-1" lang="zh" />);
    await waitFor(() => expect(screen.getByTestId('activity-pack-editor')).toBeTruthy());
    expect(screen.getByText('学案活动编排')).toBeTruthy();
    expect(screen.getAllByText('阅读任务').length).toBeGreaterThan(0);
    expect(screen.getAllByText('学习目标').length).toBeGreaterThan(0);
  });

  it('creates a new draft activity of the requested type', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    render(<ActivityPackEditor lessonId="les-1" lang="zh" />);
    await waitFor(() => expect(screen.getAllByText('阅读任务').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('button', { name: /网页课件/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const posted = fetchMock.mock.calls.some(
      ([url, init]) => String(url).endsWith('/activities') && (init as RequestInit)?.method === 'POST',
    );
    expect(posted).toBe(true);
  });

  it('shows a relink banner when imported resources are missing', async () => {
    const missingPack = {
      ...pack,
      pack: {
        ...pack.pack,
        activities: [
          {
            ...pack.pack.activities[0],
            id: 'act-cw',
            type: 'courseware',
            title: '导入课件',
            config: { coursewareId: 'cw-missing' },
            visible: false,
          },
        ],
        unresolvedBindings: [
          {
            activityId: 'act-cw',
            title: '导入课件',
            type: 'courseware',
            field: 'coursewareId',
            originalId: 'cw-missing',
          },
        ],
      },
    };
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/activity-pack')) {
        return { ok: true, json: async () => missingPack } as Response;
      }
      if (url.includes('/progress')) {
        return {
          ok: true,
          json: async () => ({ success: true, activity: missingPack.pack.activities[0], progress: [] }),
        } as Response;
      }
      return { ok: true, json: async () => [] } as Response;
    });
    render(<ActivityPackEditor lessonId="les-1" lang="zh" />);
    await waitFor(() => expect(screen.getByTestId('unresolved-bindings-banner')).toBeTruthy());
    expect(screen.getByText(/需重新关联/)).toBeTruthy();
  });
});
