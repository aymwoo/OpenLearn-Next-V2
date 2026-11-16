import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { StudentActivityPackPage } from '../StudentActivityPackPage';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const pack = {
  success: true,
  role: 'student',
  pack: {
    lessonId: 'les-1',
    courseId: null,
    blocks: [
      {
        id: 'b1',
        lessonId: 'les-1',
        blockType: 'learning_goals',
        orderIndex: 0,
        content: { text: '能区分自报与验证' },
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
        title: '必读材料',
        config: { body: '请先阅读。' },
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
        progress: {
          studentId: 'stu-1',
          activityId: 'act-1',
          status: 'in_progress',
          progressPercent: 1,
          verified: false,
          score: null,
          feedback: null,
          gradedAt: null,
          lastActivityAt: 1,
        },
      },
    ],
    summary: {
      displayPercent: 0,
      verifiedPercent: 0,
      completed: false,
      requiredTotal: 1,
      requiredVerified: 0,
      requiredSubmitted: 0,
    },
  },
};

describe('StudentActivityPackPage', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/self-report')) {
          return {
            ok: true,
            json: async () => ({
              success: true,
              progress: {
                ...pack.pack.activities[0].progress,
                status: 'submitted',
                progressPercent: 100,
                verified: false,
              },
            }),
          } as Response;
        }
        if (url.includes('/start')) {
          return {
            ok: true,
            json: async () => ({ success: true, progress: pack.pack.activities[0].progress }),
          } as Response;
        }
        return { ok: true, json: async () => pack } as Response;
      }),
    );
  });

  it('shows homepage blocks, verified progress, and a self-report action', async () => {
    render(<StudentActivityPackPage lessonId="les-1" lessonTitle="示例课" lang="zh" onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('示例课')).toBeTruthy());
    expect(screen.getByText('学案首页')).toBeTruthy();
    expect(screen.getByText(/已验证进度/)).toBeTruthy();
    expect(screen.getAllByText('必读材料').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: '我已阅读' })).toBeTruthy();
  });

  it('self-report posts to the activity endpoint', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    render(<StudentActivityPackPage lessonId="les-1" lang="zh" onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('button', { name: '我已阅读' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '我已阅读' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/self-report'))).toBe(true));
  });
});
