import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProgrammingActivityPanel } from '../ProgrammingActivityPanel';
import type { LessonActivity } from '../api';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const activity: LessonActivity = {
  id: 'act-py',
  lessonId: 'les-1',
  orderIndex: 0,
  type: 'programming',
  title: 'Python 练习',
  config: { kind: 'python', prompt: '打印问候' },
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
    activityId: 'act-py',
    status: 'not_started',
    progressPercent: 0,
    verified: false,
    score: null,
    feedback: null,
    gradedAt: null,
    lastActivityAt: null,
    artifact: null,
  },
};

describe('ProgrammingActivityPanel', () => {
  it('submits python source without claiming a runtime', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ success: true, progress: { status: 'submitted', verified: false } }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const onSaved = vi.fn();
    render(<ProgrammingActivityPanel lessonId="les-1" activity={activity} lang="zh" onSaved={onSaved} />);
    expect(screen.getByTestId('python-editor')).toBeTruthy();
    expect(screen.getByText(/未内置 Pyodide/)).toBeTruthy();
    fireEvent.change(screen.getByTestId('python-editor'), { target: { value: 'print("hi")' } });
    fireEvent.click(screen.getByTestId('submit-programming-artifact'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(call[1].body));
    expect(body.submit).toBe(true);
    expect(body.artifact.code).toBe('print("hi")');
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('does not claim a bundled Scratch editor when no plugin is installed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes('/api/plugins')) {
          return { ok: true, json: async () => [] } as Response;
        }
        return { ok: true, json: async () => ({}) } as Response;
      }),
    );
    render(
      <ProgrammingActivityPanel
        lessonId="les-1"
        activity={{ ...activity, config: { kind: 'scratch', prompt: '做一个动画' } }}
        lang="zh"
      />,
    );
    await waitFor(() => expect(screen.getByTestId('scratch-fallback-hint')).toBeTruthy());
    expect(screen.getByText(/不内嵌 scratch.mit.edu/)).toBeTruthy();
  });
});
