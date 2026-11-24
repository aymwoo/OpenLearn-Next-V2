import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  describeRunState,
  fetchActivities,
  fetchRunningActivities,
  finishActivity,
  pauseActivity,
  resumeActivity,
  startActivity,
} from '../activity-service.js';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

describe('activity-service (canonical routes)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('fetchActivities 使用 /api/activity-providers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ activities: [{ id: 'a1' }] }));
    vi.stubGlobal('fetch', fetchMock);

    const list = await fetchActivities('teacher');
    expect(fetchMock).toHaveBeenCalledWith('/api/activity-providers?role=teacher', expect.any(Object));
    expect(list).toEqual([{ id: 'a1' }]);
  });

  it('fetchRunningActivities 使用 /api/activity-runs?active=1 并映射 runId', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        runs: [
          {
            runId: 'run_1',
            providerId: 'provider_1',
            name: 'Poll',
            provider: 'official',
            state: 'running',
            startedAt: 123,
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const list = await fetchRunningActivities();
    expect(fetchMock).toHaveBeenCalledWith('/api/activity-runs?active=1', expect.any(Object));
    expect(list).toEqual([
      {
        id: 'run_1',
        runId: 'run_1',
        providerId: 'provider_1',
        name: 'Poll',
        icon: undefined,
        category: undefined,
        provider: 'official',
        state: 'running',
        startedAt: 123,
      },
    ]);
  });

  it('startActivity 使用 /api/activity-providers/:id/runs 并返回 runId', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ ok: true, runId: 'run_2', provider: 'official', dispatched: true }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await startActivity('provider_2', { x: 1 }, 'teacher-1');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/activity-providers/provider_2/runs',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(result.runId).toBe('run_2');
  });

  it('describeRunState 区分 running/paused/interrupted 与未知态', () => {
    expect(describeRunState('running', 'zh')).toMatchObject({
      label: '进行中',
      tone: 'running',
      canPause: true,
      canResume: false,
      canFinish: true,
    });
    expect(describeRunState('paused', 'zh')).toMatchObject({
      label: '已暂停',
      tone: 'paused',
      canPause: false,
      canResume: true,
      canFinish: true,
    });
    // 中断是终态：不提供恢复/结束按钮，避免稳定触发 409
    expect(describeRunState('interrupted', 'zh')).toMatchObject({
      label: '已中断',
      tone: 'interrupted',
      canPause: false,
      canResume: false,
      canFinish: false,
    });
    expect(describeRunState('failed', 'zh')).toEqual({
      label: 'failed',
      tone: 'unknown',
      canPause: false,
      canResume: false,
      canFinish: false,
    });
    expect(describeRunState('', 'en').label).toBe('Unknown');
  });

  it('pause/resume/finish 使用 /api/activity-runs/:runId/*', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await pauseActivity('run_3');
    await resumeActivity('run_3');
    await finishActivity('run_3');

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/activity-runs/run_3/pause',
      '/api/activity-runs/run_3/resume',
      '/api/activity-runs/run_3/finish',
    ]);
  });
});
