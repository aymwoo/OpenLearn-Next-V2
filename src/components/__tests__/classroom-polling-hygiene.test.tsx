import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, renderHook, cleanup } from '@testing-library/react';
import { LiveClassroomView } from '../LiveClassroomView';
import { AppDataProvider } from '../../context/AppDataContext';
import { usePeerReviewData } from '../../features/classroom/hooks/usePeerReviewData';
import { StageDisplayView } from '../../features/classroom/stage-display/StageDisplayView';
import { InProgressSessionList } from '../../features/classroom/InProgressSessionList';

vi.mock('../LazyWhiteboard', () => ({
  LazyWhiteboard: () => <div data-testid="lazy-whiteboard">Whiteboard</div>,
}));

vi.mock('../TeacherAssignmentGradePanel', () => ({
  TeacherAssignmentGradePanel: () => <div data-testid="grade-panel">GradePanel</div>,
}));

vi.mock('../../features/classroom/PreClassReadyView', () => ({
  PreClassReadyView: () => <div data-testid="pre-class-ready-view" />,
}));

vi.mock('../../features/classroom/ClassroomInteractiveCockpit', () => ({
  ClassroomInteractiveCockpit: () => null,
}));

vi.mock('socket.io-client', () => ({
  io: () => ({
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    disconnect: vi.fn(),
  }),
}));

describe('Classroom polling hygiene & terminal error handling (Issue #518)', () => {
  const baseProps: Record<string, any> = {
    classStudentsMap: {
      'cls-1': [{ id: 'stu-1', name: '张小明', class_id: 'cls-1' }],
    },
    fetchClassStudents: vi.fn().mockResolvedValue(undefined),
    lessons: [{ id: 'les-1', title: '普通课程', segments: [] }],
    selectedLesson: 'demo-lesson',
    setSelectedLesson: vi.fn(),
    classes: [{ id: 'cls-1', name: '一班' }],
    students: [{ id: 'stu-1', name: '张小明', class_id: 'cls-1' }],
    plugins: [],
    lang: 'zh',
    liveClassSelectedClassId: 'cls-1',
    setLiveClassSelectedClassId: vi.fn(),
    liveClassIsActive: true,
    setLiveClassIsActive: vi.fn(),
    liveClassTimeRemaining: 300,
    setLiveClassTimeRemaining: vi.fn(),
    liveClassFeed: [],
    setLiveClassFeed: vi.fn(),
    liveClassAcknowledgedMap: new Map(),
    setLiveClassAcknowledgedMap: vi.fn(),
    timelineSegments: [],
    activeSegmentId: null,
    setActiveSegmentId: vi.fn(),
    elements: [],
    fetchElements: vi.fn().mockResolvedValue(undefined),
    fetchStudents: vi.fn().mockResolvedValue(undefined),
    addToast: vi.fn(),
    onlineStudentIds: [],
    activeStudentLessons: {},
    liveClassStudentProgress: [],
    activeRole: 'teacher',
    setActiveRole: vi.fn(),
    socketRef: { current: { emit: vi.fn() } },
  };

  beforeEach(() => {
    vi.useFakeTimers();
    sessionStorage.clear();
    baseProps.addToast = vi.fn();
    baseProps.setSelectedLesson = vi.fn();
    vi.stubGlobal(
      'BroadcastChannel',
      vi.fn().mockImplementation(function (name: string) {
        return {
          name,
          onmessage: null,
          postMessage: vi.fn(),
          close: vi.fn(),
        };
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('does not poll rollcall-counts or top-performers on entry portal, and halts session polling after first 403', async () => {
    const counts = { session: 0, rollcall: 0, topPerformers: 0 };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/rollcall-counts')) {
        counts.rollcall++;
        return { ok: false, status: 403, json: async () => ({ error: 'Forbidden' }) };
      }
      if (url.includes('/top-performers')) {
        counts.topPerformers++;
        return { ok: false, status: 403, json: async () => ({ error: 'Forbidden' }) };
      }
      if (url.includes('/api/classroom/sessions?')) {
        return { ok: true, status: 200, json: async () => ({ items: [] }) };
      }
      if (url.includes('/api/classroom/sessions/demo-lesson')) {
        counts.session++;
        return { ok: false, status: 403, json: async () => ({ error: 'Forbidden' }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <AppDataProvider value={baseProps as any}>
        <LiveClassroomView initialPortalOpen />
      </AppDataProvider>,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(counts.session).toBe(1);
    expect(counts.rollcall).toBe(0);
    expect(counts.topPerformers).toBe(0);

    // Advance 60s across multiple 15s/20s intervals: zero additional calls should occur
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });

    expect(counts.session).toBe(1);
    expect(counts.rollcall).toBe(0);
    expect(counts.topPerformers).toBe(0);
    expect(screen.getByTestId('live-classroom-access-error')).toBeTruthy();
    const pauseToasts = baseProps.addToast.mock.calls.filter((args: any[]) => args[0] === '课堂同步已暂停');
    expect(pauseToasts).toHaveLength(1);
  });

  it('allows normal polling when authorized and immediately stops rollcall-counts and top-performers on 403/401', async () => {
    let rollcallCalls = 0;
    let topPerfCalls = 0;
    let return403 = false;

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/rollcall-counts')) {
        rollcallCalls++;
        if (return403) return { ok: false, status: 403, json: async () => ({ error: 'Forbidden' }) };
        return { ok: true, status: 200, json: async () => ({ counts: { 'stu-1': 2 } }) };
      }
      if (url.includes('/top-performers')) {
        topPerfCalls++;
        if (return403) return { ok: false, status: 401, json: async () => ({ error: 'Unauthorized' }) };
        return { ok: true, status: 200, json: async () => ({ topPerformers: [] }) };
      }
      if (url.includes('/api/classroom/sessions/les-1')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ hasActiveSession: true, stage: 'PRE_CLASS_READY', session: null }),
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <AppDataProvider value={{ ...baseProps, selectedLesson: 'les-1' } as any}>
        <LiveClassroomView initialPortalOpen={false} />
      </AppDataProvider>,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(rollcallCalls).toBe(1);
    expect(topPerfCalls).toBe(1);

    // Next cycle returns 403/401 -> stops future intervals
    return403 = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20000);
    });
    const rollcallAfterError = rollcallCalls;
    const topPerfAfterError = topPerfCalls;
    expect(rollcallAfterError).toBe(2);
    expect(topPerfAfterError).toBe(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });
    expect(rollcallCalls).toBe(rollcallAfterError);
    expect(topPerfCalls).toBe(topPerfAfterError);
  });

  it('stops usePeerReviewData intervals on 403 while ignoring non-fatal 404 on peer-review', async () => {
    let topPerfCalls = 0;
    let peerReviewCalls = 0;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/top-performers')) {
          topPerfCalls++;
          return { ok: false, status: 403, json: async () => ({ error: 'Forbidden' }) };
        }
        if (url.includes('/peer-review')) {
          peerReviewCalls++;
          return { ok: false, status: 404, json: async () => ({ error: 'Not active' }) };
        }
        return { ok: true, status: 200, json: async () => ({ works: [] }) };
      }),
    );

    const { result } = renderHook(() =>
      usePeerReviewData({
        lessonId: 'demo-lesson',
        enabled: true,
        topPerformersEnabled: false,
        attempts: [],
        studentCount: 1,
      }),
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // topPerformersEnabled=false -> zero requests; peer-review 404 is non-terminal
    expect(topPerfCalls).toBe(0);
    expect(peerReviewCalls).toBe(1);
    expect(result.current.authErrorStatus).toBeNull();

    // Turning topPerformersEnabled on hits 403 once and stops 20s polling permanently
    const { result: res2 } = renderHook(() =>
      usePeerReviewData({
        lessonId: 'demo-lesson',
        enabled: false,
        topPerformersEnabled: true,
        attempts: [],
        studentCount: 1,
      }),
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(topPerfCalls).toBe(1);
    expect(res2.current.authErrorStatus).toBe(403);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });
    expect(topPerfCalls).toBe(1);
  });

  it('halts StageDisplayView polling and renders clear error on 403', async () => {
    let stageCalls = 0;
    let topPerfCalls = 0;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/classroom/stage/demo-lesson/data')) {
          stageCalls++;
          return { ok: false, status: 403, json: async () => ({ error: 'Forbidden' }) };
        }
        if (url.includes('/top-performers')) {
          topPerfCalls++;
          return { ok: false, status: 403, json: async () => ({ error: 'Forbidden' }) };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      }),
    );

    render(<StageDisplayView lessonId="demo-lesson" lessonTitle="Demo" lang="zh" />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(stageCalls).toBe(1);
    expect(screen.getByTestId('stage-display-access-error')).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });
    expect(stageCalls).toBe(1);
    expect(topPerfCalls).toBeLessThanOrEqual(1);
  });

  it('halts InProgressSessionList polling on 401 session expiration', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls++;
        return { ok: false, status: 401, json: async () => ({ error: 'Unauthorized' }) };
      }),
    );

    render(
      <InProgressSessionList
        lang="zh"
        onResume={vi.fn()}
        onStartNew={vi.fn()}
        onOpenArchive={vi.fn()}
        onEmpty={vi.fn()}
      />,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(calls).toBe(1);
    expect(screen.getByText(/401/)).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });
    expect(calls).toBe(1);
  });
});
