/**
 * 「学生提交数据」页 · 录入成绩可用性与自动录入规则
 *
 * 覆盖两个回归：
 *  1. 「录入成绩」按钮长期灰着 —— isFinished 漏判数据库实际写入的终态 `completed`。
 *  2. 打开页面时的自动补录不应因 addToast / fetchAttempts 引用不稳定而无限重复触发。
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { LiveClassroomView } from '../LiveClassroomView';

vi.mock('../LazyWhiteboard', () => ({ LazyWhiteboard: () => <div data-testid="lazy-whiteboard" /> }));
vi.mock('../TeacherAssignmentGradePanel', () => ({ TeacherAssignmentGradePanel: () => <div /> }));
vi.mock('../../features/classroom/PreClassReadyView', () => ({ PreClassReadyView: () => <div /> }));
vi.mock('../../features/classroom/ClassroomInteractiveCockpit', () => ({ ClassroomInteractiveCockpit: () => null }));
vi.mock('socket.io-client', () => ({
  io: () => ({ on: vi.fn(), emit: vi.fn(), disconnect: vi.fn() }),
}));

const LESSON = 'lesson-101';
const CLASS_ID = 'class-g1';

function attempt(over: Record<string, any>) {
  return {
    attemptId: 'att-1',
    studentId: 's101',
    studentName: '张小明',
    coursewareName: '分数乐园',
    score: 88,
    completion: 1,
    started_at: Date.now() - 60_000,
    finished_at: Date.now(),
    isPromoted: 0,
    ...over,
  };
}

let attempts: any[] = [];
let autoRecordCalls: Array<{ lessonId?: string; classId?: string }> = [];
let ruleEnabled = false;
let ruleMinCompletion = 0;

const baseProps = {
  selectedLesson: LESSON,
  setSelectedLesson: vi.fn(),
  lessons: [{ id: LESSON, title: '物理探究实验课' }],
  classes: [{ id: CLASS_ID, name: '高一1班' }],
  students: [
    { id: 's101', name: '张小明', class_id: CLASS_ID },
    { id: 's102', name: '李华', class_id: CLASS_ID },
  ],
  plugins: [],
  lang: 'zh',
  timelineSegments: [],
  activeSegmentId: null,
  setActiveSegmentId: vi.fn(),
  liveClassSelectedClassId: CLASS_ID,
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
  fetchElements: vi.fn(),
  fetchStudents: vi.fn(),
  addToast: vi.fn(),
  onlineStudentIds: ['s101'],
  activeStudentLessons: { s101: LESSON },
  liveClassStudentProgress: [],
  activeRole: 'teacher',
  setActiveRole: vi.fn(),
};

beforeEach(() => {
  attempts = [];
  autoRecordCalls = [];
  ruleEnabled = false;
  ruleMinCompletion = 0;

  // ClassroomSyncChannel 构造时会 new BroadcastChannel
  vi.stubGlobal(
    'BroadcastChannel',
    vi.fn().mockImplementation(function (name: string) {
      return { name, onmessage: null, postMessage: vi.fn(), close: vi.fn() };
    }),
  );
  vi.stubGlobal('open', vi.fn());

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) : {};

      if (url.includes('/api/courseware/attempts/auto-record')) {
        autoRecordCalls.push({ lessonId: body.lessonId, classId: body.classId });
        return { ok: true, json: async () => ({ success: true, recorded: 1, skipped: 0, details: [] }) } as any;
      }
      // /api/commands 的真实契约：请求体 { commandType, payload }，响应 { success, result }。
      // 严格按契约 mock —— 若前端误用 type，mock 会 500，从而真正拦住这类契约漂移。
      if (url.includes('/api/commands')) {
        if (body.commandType !== 'courseware.get_score_config' && body.commandType !== 'courseware.save_score_config') {
          return {
            ok: false,
            status: 500,
            json: async () => ({ error: 'No handler registered for command: undefined' }),
          } as any;
        }
        if (body.commandType === 'courseware.get_score_config') {
          return {
            ok: true,
            json: async () => ({
              success: true,
              result: {
                success: true,
                courseware_id: '*',
                auto_record_enabled: ruleEnabled,
                auto_record_min_completion: ruleMinCompletion,
              },
            }),
          } as any;
        }
        ruleEnabled = Boolean(body.payload?.autoRecordEnabled);
        ruleMinCompletion = Number(body.payload?.autoRecordMinCompletion ?? 0);
        return { ok: true, json: async () => ({ success: true, result: { success: true } }) } as any;
      }
      if (url.includes('/api/courseware/attempts')) {
        return { ok: true, json: async () => attempts } as any;
      }
      // 课堂会话：必须返回 IN_CLASS_TEACHING，否则 LiveClassroomView 会停在
      // PRE_CLASS_READY 视图（PreClassReadyView），中间列的 tab 根本不会渲染
      if (url.includes('/api/classroom/sessions/')) {
        return {
          ok: true,
          json: async () => ({
            hasActiveSession: true,
            stage: 'IN_CLASS_TEACHING',
            activeBuzzer: null,
            activePoll: null,
          }),
        } as any;
      }
      return { ok: true, json: async () => ({}) } as any;
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** 切到「学生提交数据」页（用正则匹配，避免 emoji 前缀影响精确匹配） */
async function openSubmissionsTab() {
  const tab = await screen.findByText(/学生提交数据/);
  fireEvent.click(tab);
}

describe('学生提交数据 · 录入成绩按钮可用性', () => {
  it('【历史 bug】completed 状态的记录按钮可点击（同文件筛选下拉也认这个状态）', async () => {
    // 数据库实际写入的终态就是 completed
    attempts = [attempt({ attemptId: 'att-c', status: 'completed', score: 92 })];
    render(<LiveClassroomView {...baseProps} />);
    await openSubmissionsTab();

    const recordBtn = await screen.findByText('录入成绩');
    await waitFor(() => expect((recordBtn as HTMLElement).closest('button')?.disabled).toBe(false));
  });

  it('无分数的记录按钮禁用，且提示不会凭空记分', async () => {
    attempts = [attempt({ attemptId: 'att-ns', status: 'completed', score: null })];
    render(<LiveClassroomView {...baseProps} />);
    await openSubmissionsTab();

    const recordBtn = await screen.findByText('录入成绩');
    await waitFor(() => expect((recordBtn as HTMLElement).closest('button')?.disabled).toBe(true));
    expect((recordBtn as HTMLElement).closest('button')?.getAttribute('title')).toContain('没有分数');
  });

  it('进行中的记录按钮禁用，提示需先完成', async () => {
    attempts = [attempt({ attemptId: 'att-a', status: 'active', score: 90 })];
    render(<LiveClassroomView {...baseProps} />);
    await openSubmissionsTab();

    const recordBtn = await screen.findByText('录入成绩');
    await waitFor(() => expect((recordBtn as HTMLElement).closest('button')?.disabled).toBe(true));
    expect((recordBtn as HTMLElement).closest('button')?.getAttribute('title')).toContain('进行中');
  });

  it('已录入的记录显示「已归档」而非按钮（不重复录入）', async () => {
    attempts = [attempt({ attemptId: 'att-d', status: 'completed', score: 95, isPromoted: 1 })];
    render(<LiveClassroomView {...baseProps} />);
    await openSubmissionsTab();

    expect(await screen.findByText('已归档')).toBeTruthy();
  });
});

describe('学生提交数据 · 自动录入规则', () => {
  it('规则关闭时不自动补录', async () => {
    ruleEnabled = false;
    render(<LiveClassroomView {...baseProps} />);
    await openSubmissionsTab();

    await screen.findByText('自动录入成绩');
    await act(async () => {
      await Promise.resolve();
    });
    expect(autoRecordCalls).toHaveLength(0);
  });

  it('规则开启时进入页面自动补录一次（不多次）', async () => {
    ruleEnabled = true;
    render(<LiveClassroomView {...baseProps} />);
    await openSubmissionsTab();

    await screen.findByText('自动录入成绩');
    await waitFor(() => expect(autoRecordCalls.length).toBeGreaterThan(0));
    expect(autoRecordCalls[0]).toEqual({ lessonId: LESSON, classId: CLASS_ID });

    // 关键回归：addToast / fetchAttempts 引用不稳定会导致这里变成几十次
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(autoRecordCalls.length).toBe(1);
  });

  it('勾选开关会把规则保存到全局默认行', async () => {
    render(<LiveClassroomView {...baseProps} />);
    await openSubmissionsTab();

    const checkbox = (await screen.findByText('自动录入成绩')).closest('label')?.querySelector('input');
    expect(checkbox).toBeTruthy();
    fireEvent.click(checkbox!);

    await waitFor(() => expect(ruleEnabled).toBe(true));
    expect((globalThis.fetch as any).mock.calls.some((c: any[]) => String(c[0]).includes('/api/commands'))).toBe(true);
  });

  it('【契约】请求 /api/commands 时必须用 commandType，不能用 type', async () => {
    render(<LiveClassroomView {...baseProps} />);
    await openSubmissionsTab();
    await screen.findByText('自动录入成绩');

    const commandCalls = (globalThis.fetch as any).mock.calls.filter((c: any[]) =>
      String(c[0]).includes('/api/commands'),
    );
    expect(commandCalls.length).toBeGreaterThan(0);
    for (const call of commandCalls) {
      const body = JSON.parse(String(call[1].body));
      expect(body).toHaveProperty('commandType');
      expect(body.type).toBeUndefined();
    }
  });

  it('「立即补录」按钮可手动重跑', async () => {
    ruleEnabled = true;
    render(<LiveClassroomView {...baseProps} />);
    await openSubmissionsTab();

    const runBtn = await screen.findByText('立即补录');
    await waitFor(() => expect(autoRecordCalls.length).toBe(1));

    fireEvent.click(runBtn);
    await waitFor(() => expect(autoRecordCalls.length).toBe(2));
  });
});
