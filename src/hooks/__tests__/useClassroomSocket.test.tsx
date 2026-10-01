import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

/**
 * 教师端广播的白板最大化视图必须由 `useClassroomSocket` 处理：
 * 白板组件在学生切到「互动课件 / 作业」标签页时会卸载，
 * 因此接收与状态落库必须在 App 层完成，否则同步视图会丢失。
 *
 * 事件由服务端投递到课节房间 **和** 班级房间，所以学生无论在课节白板、
 * 互动课件、作业标签页还是作业工作区都能收到。
 */

const { socketHandlers, fakeSocket } = vi.hoisted(() => {
  const socketHandlers = new Map<string, (...args: unknown[]) => void>();
  return {
    socketHandlers,
    fakeSocket: {
      id: 'sock-1',
      on: (event: string, handler: (...args: unknown[]) => void) => {
        socketHandlers.set(event, handler);
      },
      off: vi.fn(),
      emit: vi.fn(),
      disconnect: vi.fn(),
    },
  };
});

vi.mock('socket.io-client', () => ({
  io: () => fakeSocket,
}));

import { useClassroomSocket, type UseClassroomSocketOptions } from '../useClassroomSocket';
import { whiteboardViewStore } from '../../store/whiteboardViewStore';
import { pointsLedgerStore } from '../../store/pointsLedgerStore';
import { appStore } from '../../store/appStore';

const STUDENT_SESSION = { role: 'student', studentId: 'stu-1', name: 'Alice' } as never;
const ASSIGNMENT = { id: 'a1', class_id: 'c1', title: 'HW1' };

function makeOptions(overrides: Partial<UseClassroomSocketOptions> = {}): UseClassroomSocketOptions {
  return {
    session: STUDENT_SESSION,
    host: { isInitialized: () => true, initialize: vi.fn() },
    activeRole: 'student',
    activeStudentId: 'stu-1',
    selectedLesson: 'l1',
    activeSegmentId: null,
    studentViewStatus: 'lesson',
    studentLessonTab: 'whiteboard',
    selectedAssignment: null,
    lang: 'zh',
    students: [],
    addToast: vi.fn(),
    setOnlineStudentIds: vi.fn(),
    setActiveStudentLessons: vi.fn(),
    setLessons: vi.fn(),
    setActiveSegmentId: vi.fn(),
    setLiveClassStudentProgress: vi.fn(),
    setLiveClassAcknowledgedMap: vi.fn(),
    setLiveClassFeed: vi.fn(),
    setSelectedLesson: vi.fn(),
    setStudentViewStatus: vi.fn(),
    setStudentLessonTab: vi.fn(),
    setSelectedAssignment: vi.fn(),
    setLocalProgressPercent: vi.fn(),
    fetchStudentDashboard: vi.fn(),
    fetchStudents: vi.fn(),
    fetchElements: vi.fn(),
    ...overrides,
  } as UseClassroomSocketOptions;
}

/** 触发注册在 socket 上的某个处理器 */
function trigger(event: string, payload?: unknown) {
  const handler = socketHandlers.get(event);
  expect(handler, `no handler registered for ${event}`).toBeTruthy();
  act(() => {
    handler?.(payload);
  });
}

const maximize = (elementId = 'el-quiz-1', lessonId = 'l1') =>
  trigger('whiteboard-fullscreen-changed', { lessonId, elementId });
const exitFullscreen = (lessonId = 'l1') => trigger('whiteboard-fullscreen-changed', { lessonId, elementId: null });

describe('useClassroomSocket — 教师端最大化视图同步', () => {
  beforeEach(() => {
    socketHandlers.clear();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
    whiteboardViewStore.getState().setRemoteFullscreenElementId(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('进入同步最大化视图', () => {
    it('stores the remote element id and forces the student onto the whiteboard', () => {
      const options = makeOptions();
      renderHook(() => useClassroomSocket(options));

      maximize();

      expect(whiteboardViewStore.getState().remoteFullscreenElementId).toBe('el-quiz-1');
      expect(options.setStudentLessonTab).toHaveBeenCalledWith('whiteboard');
      expect(options.setStudentViewStatus).toHaveBeenCalledWith('lesson');
      expect(options.setSelectedLesson).toHaveBeenCalledWith('l1');
      expect(options.fetchElements).toHaveBeenCalledWith('l1');
    });

    it('pulls a student out of the assignment workspace and stashes the assignment', () => {
      const options = makeOptions({
        selectedLesson: null,
        studentViewStatus: 'assignment',
        studentLessonTab: 'whiteboard',
        selectedAssignment: ASSIGNMENT,
      });
      renderHook(() => useClassroomSocket(options));

      maximize();

      expect(options.setStudentViewStatus).toHaveBeenCalledWith('lesson');
      // 作业上下文被暂存起来（避免与课节白板 elements 互相覆盖）
      expect(options.setSelectedAssignment).toHaveBeenCalledWith(null);
    });

    it('does not interrupt a student self-studying a different lesson', () => {
      const options = makeOptions({ selectedLesson: 'l2' });
      renderHook(() => useClassroomSocket(options));

      maximize('el-quiz-1', 'l1');

      expect(whiteboardViewStore.getState().remoteFullscreenElementId).toBeNull();
      expect(options.setStudentLessonTab).not.toHaveBeenCalled();
    });

    it('does not interrupt a student sitting on the dashboard', () => {
      const options = makeOptions({ studentViewStatus: 'dashboard' });
      renderHook(() => useClassroomSocket(options));

      maximize();

      expect(whiteboardViewStore.getState().remoteFullscreenElementId).toBeNull();
      expect(options.setStudentViewStatus).not.toHaveBeenCalled();
    });

    it('ignores fullscreen broadcasts for non-student roles', () => {
      const options = makeOptions({ activeRole: 'teacher', session: { role: 'teacher' } as never });
      renderHook(() => useClassroomSocket(options));

      maximize();

      expect(whiteboardViewStore.getState().remoteFullscreenElementId).toBeNull();
      expect(options.setStudentLessonTab).not.toHaveBeenCalled();
    });

    it('keeps the original interrupted view when the teacher maximizes a second component', () => {
      const options = makeOptions({ studentViewStatus: 'assignment', selectedAssignment: ASSIGNMENT });
      renderHook(() => useClassroomSocket(options));

      maximize('el-quiz-1');
      maximize('el-quiz-2');
      exitFullscreen();

      // 恢复到最初被中断的作业工作区，而不是两次 maximize 之间的白板状态
      expect(options.setStudentViewStatus).toHaveBeenCalledWith('assignment');
      expect(options.setSelectedAssignment).toHaveBeenLastCalledWith(ASSIGNMENT);
    });
  });

  describe('教师退出最大化后恢复被中断的视图', () => {
    it('restores the previously selected tab for a lesson-view interruption', () => {
      const options = makeOptions({ studentLessonTab: 'courseware' });
      renderHook(() => useClassroomSocket(options));

      maximize();
      vi.mocked(options.setStudentLessonTab).mockClear();
      exitFullscreen();

      expect(options.setStudentLessonTab).toHaveBeenCalledWith('courseware');
      expect(whiteboardViewStore.getState().remoteFullscreenElementId).toBeNull();
    });

    it('restores the assignment workspace and its assignment object', () => {
      const options = makeOptions({
        selectedLesson: null,
        studentViewStatus: 'assignment',
        selectedAssignment: ASSIGNMENT,
      });
      renderHook(() => useClassroomSocket(options));

      maximize();
      vi.mocked(options.setStudentViewStatus).mockClear();
      vi.mocked(options.setSelectedAssignment).mockClear();
      exitFullscreen();

      expect(options.setSelectedAssignment).toHaveBeenCalledWith(ASSIGNMENT);
      expect(options.setStudentViewStatus).toHaveBeenCalledWith('assignment');
    });

    it('restores the assignment workspace tab and lesson after an assignment-tab interruption', () => {
      const options = makeOptions({
        selectedLesson: 'l9',
        studentViewStatus: 'assignment',
        studentLessonTab: 'assignment',
        selectedAssignment: ASSIGNMENT,
      });
      renderHook(() => useClassroomSocket(options));

      maximize();
      vi.mocked(options.setStudentLessonTab).mockClear();
      vi.mocked(options.setSelectedLesson).mockClear();
      exitFullscreen();

      expect(options.setStudentLessonTab).toHaveBeenCalledWith('assignment');
      expect(options.setSelectedLesson).toHaveBeenCalledWith('l9');
    });

    it('is a no-op when the student was never interrupted', () => {
      const options = makeOptions();
      renderHook(() => useClassroomSocket(options));

      exitFullscreen();

      expect(options.setStudentViewStatus).not.toHaveBeenCalled();
      expect(options.setSelectedAssignment).not.toHaveBeenCalled();
    });
  });

  describe('安全网', () => {
    it('clears the remote fullscreen and restores the view on reconnect', () => {
      const options = makeOptions({ selectedLesson: 'l9', studentViewStatus: 'assignment' });
      renderHook(() => useClassroomSocket(options));
      maximize();
      expect(whiteboardViewStore.getState().remoteFullscreenElementId).toBe('el-quiz-1');

      trigger('connect');

      expect(whiteboardViewStore.getState().remoteFullscreenElementId).toBeNull();
      expect(options.setStudentViewStatus).toHaveBeenLastCalledWith('assignment');
    });
  });

  it('still handles refresh events without touching the fullscreen state', () => {
    const options = makeOptions();
    renderHook(() => useClassroomSocket(options));

    trigger('whiteboard-sync', { roomId: 'l1', type: 'refresh' });

    expect(options.fetchElements).toHaveBeenCalledWith('l1');
    expect(whiteboardViewStore.getState().remoteFullscreenElementId).toBeNull();
  });

  describe('student-picked 随机抽问广播提示', () => {
    it('着重提示被抽中的学生并弹出模态框', () => {
      const setPickedAlertData = vi.fn();
      const addToast = vi.fn();
      const options = makeOptions({
        activeRole: 'student',
        activeStudentId: 'stu-1',
        setPickedAlertData,
        addToast,
      });
      renderHook(() => useClassroomSocket(options));

      trigger('student-picked', {
        studentId: 'stu-1',
        studentName: 'Alice',
        lessonId: 'l1',
      });

      expect(setPickedAlertData).toHaveBeenCalledWith({
        studentId: 'stu-1',
        studentName: 'Alice',
      });
      expect(addToast).toHaveBeenCalledWith(
        '⚡️ 闪电抽问：老师抽中了你！',
        expect.stringContaining('闪电警报！您已被老师在课程随机抽问中抽中'),
        'warning',
      );
    });

    it('向全班其他学生广播提示被抽中的学生姓名', () => {
      const setPickedAlertData = vi.fn();
      const addToast = vi.fn();
      const options = makeOptions({
        activeRole: 'student',
        activeStudentId: 'stu-1',
        setPickedAlertData,
        addToast,
      });
      renderHook(() => useClassroomSocket(options));

      trigger('student-picked', {
        studentId: 'stu-2',
        studentName: 'Bob',
        lessonId: 'l1',
      });

      expect(setPickedAlertData).not.toHaveBeenCalled();
      expect(addToast).toHaveBeenCalledWith(
        '🎯 课堂随机抽问',
        expect.stringContaining('老师在课堂中随机抽中了【Bob】同学回答问题！'),
        'info',
      );
    });

    it('同一 (studentId, pickedTime) 重复投递只触发一次弹窗/播报（live feed 仍逐条记录）', () => {
      const setPickedAlertData = vi.fn();
      const addToast = vi.fn();
      const setLiveClassFeed = vi.fn();
      const options = makeOptions({
        activeRole: 'student',
        activeStudentId: 'stu-1',
        setPickedAlertData,
        addToast,
        setLiveClassFeed,
      });
      renderHook(() => useClassroomSocket(options));

      // 模拟服务端历史三重投递 / 白板 rollcall 独立补发：相同事件到达 3 次
      const duplicatedPayload = { studentId: 'stu-1', studentName: 'Alice', lessonId: 'l1', pickedTime: 1700000000000 };
      trigger('student-picked', duplicatedPayload);
      trigger('student-picked', duplicatedPayload);
      trigger('student-picked', duplicatedPayload);

      expect(setPickedAlertData).toHaveBeenCalledTimes(1);
      expect(addToast).toHaveBeenCalledTimes(1);
      // live feed 不去重：id 天然含 pickedTime，重复条目由 feed 自身幂等
      expect(setLiveClassFeed).toHaveBeenCalledTimes(3);
    });

    it('不同 pickedTime 的事件各自正常触发（10s 短窗不误伤连续抽人）', () => {
      const setPickedAlertData = vi.fn();
      const addToast = vi.fn();
      const options = makeOptions({
        activeRole: 'student',
        activeStudentId: 'stu-1',
        setPickedAlertData,
        addToast,
      });
      renderHook(() => useClassroomSocket(options));

      trigger('student-picked', { studentId: 'stu-1', studentName: 'Alice', pickedTime: 1700000000000 });
      trigger('student-picked', { studentId: 'stu-1', studentName: 'Alice', pickedTime: 1700000001000 });

      expect(setPickedAlertData).toHaveBeenCalledTimes(2);
      expect(addToast).toHaveBeenCalledTimes(2);
    });
  });
});

/**
 * 积分台账变更（`classroom:points_awarded`）的消费端。
 *
 * 该事件此前全平台零监听，导致：被加分的学生收不到提示；教师在已打开的
 * 「成长档案 / 积分榜」里加分后界面不刷新（提示已发放、数字却还是旧的）。
 */
describe('useClassroomSocket — 积分台账变更', () => {
  beforeEach(() => {
    socketHandlers.clear();
    pointsLedgerStore.getState().reset();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const award = (over: Record<string, unknown> = {}) => ({
    id: 'pl-1',
    studentId: 'stu-1',
    classId: 'c1',
    dimensionId: 'attribution',
    deltaPoints: 5,
    reason: '课堂表现优异',
    createdAt: 1_700_000_000_000,
    ...over,
  });

  it('被加分的学生收到提示并刷新自己的学情数据', () => {
    const addToast = vi.fn();
    const fetchStudentDashboard = vi.fn();
    const options = makeOptions({ addToast, fetchStudentDashboard, activeStudentId: 'stu-1' });
    renderHook(() => useClassroomSocket(options));

    trigger('classroom:points_awarded', award());

    expect(addToast).toHaveBeenCalledWith('🎁 获得成长积分', expect.stringContaining('+5 积分'), 'success');
    expect(fetchStudentDashboard).toHaveBeenCalledWith('stu-1');
  });

  it('扣分走 warning 且文案为负', () => {
    const addToast = vi.fn();
    const options = makeOptions({ addToast, activeStudentId: 'stu-1' });
    renderHook(() => useClassroomSocket(options));

    trigger('classroom:points_awarded', award({ deltaPoints: -3, reason: '课堂纪律扣分' }));

    expect(addToast).toHaveBeenCalledWith('📉 积分调整', expect.stringContaining('-3 积分'), 'warning');
  });

  it('事件是全局广播 → 别人被加分时自己不该弹提示，但仍要记录以供积分类 UI 刷新', () => {
    const addToast = vi.fn();
    const options = makeOptions({ addToast, activeStudentId: 'stu-9' });
    renderHook(() => useClassroomSocket(options));

    trigger('classroom:points_awarded', award({ studentId: 'stu-1' }));

    // 全平台都会收到这条广播，若无差别提示就是纯噪音
    expect(addToast).not.toHaveBeenCalled();
    // 但仍要落 store，教师侧已打开的积分弹窗据此重拉
    expect(pointsLedgerStore.getState().lastEvent).toMatchObject({ studentId: 'stu-1', deltaPoints: 5 });
    expect(pointsLedgerStore.getState().version).toBeGreaterThan(0);
  });

  it('缺少 studentId 的畸形 payload 被忽略', () => {
    const addToast = vi.fn();
    const options = makeOptions({ addToast });
    renderHook(() => useClassroomSocket(options));

    trigger('classroom:points_awarded', { deltaPoints: 5 });

    expect(addToast).not.toHaveBeenCalled();
    expect(pointsLedgerStore.getState().lastEvent).toBeNull();
  });
});

/**
 * 教师端也必须加入当前所教班级房间。
 *
 * 此前班级房间只有学生在 `register-student` 时加入（服务端 `presence.ts`），
 * 于是投 `class-<classId>` 的事件一律到不了教师。而有两类事件恰好是
 * 「教师自己既产生又需要看到」的：
 *   - `classroom:icebreaker_updated` —— 破冰统计只有教师端 `PreClassDiagnosticHub` 展示；
 *   - `classroom:groups_changed` / `classroom:stage_changed` 的班级兜底分支。
 *
 * 这条测试就是上一轮把 icebreaker 从全局广播改投班级房间后**差点回归**的护栏。
 */
describe('useClassroomSocket — 教师端加入当前班级房间', () => {
  beforeEach(() => {
    socketHandlers.clear();
    // fakeSocket 是跨用例共享的，emit 的调用历史必须显式清空，
    // 否则 joinedRooms() 会混入上一个用例的 join
    fakeSocket.emit.mockClear();
    appStore.setState({ liveClassSelectedClassId: 'cls_t1' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
  });

  afterEach(() => {
    appStore.setState({ liveClassSelectedClassId: null });
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const joinedRooms = (): string[] => fakeSocket.emit.mock.calls.map((c) => c[1]).filter(Boolean) as string[];

  it('教师进入课堂时 join 当前所教班级房间', () => {
    const options = makeOptions({ activeRole: 'teacher', activeStudentId: null, selectedLesson: 'l1' });
    renderHook(() => useClassroomSocket(options));

    expect(joinedRooms()).toContain('class-cls_t1');
  });

  it('学生不靠这条路径加入班级房间（由服务端 register-student 负责）', () => {
    const options = makeOptions({ activeRole: 'student', activeStudentId: 'stu-1', selectedLesson: 'l1' });
    renderHook(() => useClassroomSocket(options));

    // 学生端的班级房间由服务端按其所属班级加入，前端不需要也不应猜
    expect(joinedRooms()).not.toContain('class-cls_t1');
  });

  it('未选班级时不加入任何班级房间', () => {
    appStore.setState({ liveClassSelectedClassId: null });
    const options = makeOptions({ activeRole: 'teacher', activeStudentId: null, selectedLesson: 'l1' });
    renderHook(() => useClassroomSocket(options));

    expect(joinedRooms().some((r) => r.startsWith('class-'))).toBe(false);
  });

  it('教师无论是否在课节都至少加入两个常驻广播房间', () => {
    const options = makeOptions({ activeRole: 'teacher', activeStudentId: null, selectedLesson: null });
    renderHook(() => useClassroomSocket(options));

    const rooms = joinedRooms();
    expect(rooms).toContain('whiteboard-broadcast');
    expect(rooms).toContain('classroom-broadcast');
  });
});
