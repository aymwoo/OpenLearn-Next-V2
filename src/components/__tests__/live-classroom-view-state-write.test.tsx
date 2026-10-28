/**
 * 课堂视图状态回写的前端门控（回归）。
 *
 * ## 背景
 *
 * `POST /api/classroom/sessions/:lessonId/view-state` 是「课堂会话保存与恢复」
 * 协议的写入端点。**无会话时它按契约返回 404**（见
 * `server/__tests__/classroom-session-resume.test.ts`：「无会话课时 404」）。
 *
 * 但教师打开互动课堂时，组件挂载即会把当前环节防抖回写 → 每次打开都稳定
 * 产生一条 404 + 控制台错误（功能巡检 `pnpm sweep` 在「系统启动 / 互动课堂」
 * 两个视图上各抓到一次）。
 *
 * 修法：**只在确有进行中会话时才回写**。本文件固化两条断言：
 * - 无会话 → 不发 view-state 请求；
 * - 有会话 → 照旧回写（恢复协议不能被这次修复误伤）。
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { LiveClassroomView } from '../LiveClassroomView';
import { AppDataProvider } from '../../context/AppDataContext';

// 与 LiveClassroomView.test.tsx 同款的重依赖替身：本文件只关心请求行为。
vi.mock('../LazyWhiteboard', () => ({
  LazyWhiteboard: () => <div data-testid="lazy-whiteboard">Whiteboard</div>,
}));

vi.mock('../TeacherAssignmentGradePanel', () => ({
  TeacherAssignmentGradePanel: () => <div data-testid="grade-panel" />,
}));

vi.mock('../../features/classroom/PreClassReadyView', () => ({
  PreClassReadyView: () => <div data-testid="pre-class-ready-view" />,
}));

vi.mock('../../features/classroom/ClassroomInteractiveCockpit', () => ({
  ClassroomInteractiveCockpit: () => null,
}));

vi.mock('socket.io-client', () => ({
  io: () => ({ on: vi.fn(), emit: vi.fn(), disconnect: vi.fn() }),
}));

const originalFetch = globalThis.fetch;

const baseProps: Record<string, any> = {
  classStudentsMap: {},
  fetchClassStudents: vi.fn().mockResolvedValue(undefined),
  selectedLesson: 'lesson-101',
  setSelectedLesson: vi.fn(),
  lessons: [{ id: 'lesson-101', title: '物理探究实验课' }],
  classes: [{ id: 'class-g1', name: '高一1班' }],
  students: [],
  plugins: [],
  lang: 'zh',
  timelineSegments: [{ id: 'seg-1', title: '导入环节', duration: 300 }],
  activeSegmentId: 'seg-1',
  setActiveSegmentId: vi.fn(),
  liveClassSelectedClassId: 'class-g1',
  setLiveClassSelectedClassId: vi.fn(),
  liveClassIsActive: true,
  setLiveClassIsActive: vi.fn(),
  initialPortalOpen: false,
  liveClassTimeRemaining: 300,
  setLiveClassTimeRemaining: vi.fn(),
  liveClassFeed: [],
  setLiveClassFeed: vi.fn(),
  liveClassAcknowledgedMap: new Map(),
  setLiveClassAcknowledgedMap: vi.fn(),
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

/**
 * 装一个 fetch 桩：会话详情按 `hasActiveSession` 回应，其余一律 200 空体。
 * 返回所有被请求过的 URL。
 */
function installFetchStub(hasActiveSession: boolean) {
  const calls: string[] = [];
  const stub = vi.fn(async (input: any) => {
    const url = String(typeof input === 'string' ? input : (input?.url ?? input));
    calls.push(url);
    const body = url.includes('/api/classroom/sessions/')
      ? {
          hasActiveSession,
          stage: hasActiveSession ? 'IN_CLASS_TEACHING' : 'PRE_CLASS_READY',
          session: hasActiveSession ? { id: 'cs-1', class_id: 'class-g1', started_at: null } : null,
        }
      : {};
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as any;
  });
  vi.stubGlobal('fetch', stub);
  return calls;
}

describe('课堂视图状态回写的前端门控', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
  });

  it('没有进行中的课堂会话时，不回写 view-state（否则每次开课都吃一个 404）', async () => {
    const calls = installFetchStub(false);

    render(
      <AppDataProvider value={baseProps as any}>
        <LiveClassroomView initialPortalOpen={false} />
      </AppDataProvider>,
    );

    // 等会话详情返回（hasActiveSession=false 已落到组件状态）
    await waitFor(() => expect(calls.some((u) => u.includes('/api/classroom/sessions/'))).toBe(true));
    // 越过防抖窗口（500ms）
    await new Promise((resolve) => setTimeout(resolve, 900));

    expect(calls.filter((url) => url.includes('/view-state'))).toHaveLength(0);
  });

  it('确有进行中的课堂会话时，照旧回写 view-state（恢复协议不能被误伤）', async () => {
    const calls = installFetchStub(true);

    render(
      <AppDataProvider value={baseProps as any}>
        <LiveClassroomView initialPortalOpen={false} />
      </AppDataProvider>,
    );

    await waitFor(() => expect(calls.some((u) => u.includes('/api/classroom/sessions/'))).toBe(true));
    await waitFor(() => expect(calls.filter((url) => url.includes('/view-state')).length).toBeGreaterThan(0), {
      timeout: 5_000,
    });
  });

  it('同一环节不重复回写 view-state，环节切换时才触发新回写', async () => {
    const calls = installFetchStub(true);

    const { rerender } = render(
      <AppDataProvider value={baseProps as any}>
        <LiveClassroomView initialPortalOpen={false} />
      </AppDataProvider>,
    );

    await waitFor(() => expect(calls.filter((url) => url.includes('/view-state')).length).toBe(1), {
      timeout: 5_000,
    });

    // 触发组件重渲染，但环节未变（仍为 'seg-1'）
    rerender(
      <AppDataProvider value={{ ...baseProps, liveClassTimeRemaining: 200 } as any}>
        <LiveClassroomView initialPortalOpen={false} />
      </AppDataProvider>,
    );
    await new Promise((resolve) => setTimeout(resolve, 700));

    // view-state 调用次数依然为 1，没有重复回写
    expect(calls.filter((url) => url.includes('/view-state'))).toHaveLength(1);

    // 切换到新环节 'seg-2'
    rerender(
      <AppDataProvider value={{ ...baseProps, activeSegmentId: 'seg-2' } as any}>
        <LiveClassroomView initialPortalOpen={false} />
      </AppDataProvider>,
    );

    // 等待防抖后触发第二次回写
    await waitFor(() => expect(calls.filter((url) => url.includes('/view-state')).length).toBe(2), {
      timeout: 5_000,
    });
  });
});
