import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useAppStore, appStore } from '../store/appStore';
import { uiStore } from '../store/uiStore';
import { liveClassStore } from '../store/liveClassStore';
import { useAppData } from '../context/AppDataContext';
import type { WhiteboardPageItem, WhiteboardHandle } from '../features/whiteboard/InteractiveWhiteboard';
import { extensionCoversSegmentType, normalizeSegmentType } from '../../packages/core/plugin-host/mode-pack';
import { resolveLessonModePackDeliveryMode } from '../../packages/core/plugin-host/course-delivery-mode';
import { useOptionalPluginHost } from '../plugin-host/plugin-host-context';
import {
  isModePacksEnabled,
  registerWhiteboardModePack,
  unregisterWhiteboardModePack,
  registerXueanModePack,
  unregisterXueanModePack,
  type WhiteboardHostBridgeValue,
} from '../features/classroom/mode-pack';
import { getOptionalSocket, onSocketInstance } from '../services/socket-service';
import { buildShowcaseDiffCandidateWorks } from '../features/classroom/showcase-diff/build-diff-works';
import { useErrorStore } from '../store/errorStore';
import { ClassroomInteractiveCockpit } from '../features/classroom/ClassroomInteractiveCockpit';
import { ClassroomEntryPortal } from '../features/classroom/ClassroomEntryPortal';
import { ClassroomSessionManager, type ClassroomSessionItem } from '../features/classroom/ClassroomSessionManager';
import { InProgressSessionList } from '../features/classroom/InProgressSessionList';
import { readRememberedActiveLesson, rememberActiveLesson } from '../features/classroom/live-class-resume-memory';
import { useClassroomLiveData } from '../features/classroom/hooks/useClassroomLiveData';
import { resolveSegmentDuration } from '../utils/timeline-duration';
import { ClassroomModalsHost } from './classroom/ClassroomModalsHost';
import { usePeerReviewData } from '../features/classroom/hooks/usePeerReviewData';

import { ClassroomInContextDrawer } from '../features/classroom/ClassroomInContextDrawer';
import { getPagesForSegment as getPagesForSegmentPure } from '../features/classroom/get-pages-for-segment';
import { type TeacherMiddleTab } from '../features/classroom/map-teacher-middle-tab';
import { FINISHED_STATUSES, IN_PROGRESS_STATUSES } from '../features/classroom/LiveSubmissionsPanel';
import { LiveClassroomHeaderBar } from '../features/classroom/LiveClassroomHeaderBar';
import { LiveClassroomSubmissionRawModal } from '../features/classroom/LiveClassroomSubmissionRawModal';
import { useLiveClassroomSessionPolling } from '../features/classroom/hooks/useLiveClassroomSessionPolling';
import { useLiveClassroomSubmissions } from '../features/classroom/hooks/useLiveClassroomSubmissions';
import { useLiveClassroomLocks } from '../features/classroom/hooks/useLiveClassroomLocks';
import { useLiveClassroomSyncBroadcast } from '../features/classroom/hooks/useLiveClassroomSyncBroadcast';
import { useLiveClassroomRandomPick } from '../features/classroom/hooks/useLiveClassroomRandomPick';
import { useClassroomPluginTools } from '../features/classroom/hooks/useClassroomPluginTools';
import { LiveClassroomAccessErrorBanner } from '../features/classroom/LiveClassroomAccessErrorBanner';
import { LiveClassroomSwitchLessonModal } from '../features/classroom/LiveClassroomSwitchLessonModal';
import { LiveClassroomStageRouter } from '../features/classroom/LiveClassroomStageRouter';
import { useLiveClassroomMacroEngine } from '../features/classroom/hooks/useLiveClassroomMacroEngine';
export { FINISHED_STATUSES, IN_PROGRESS_STATUSES };

export function LiveClassroomView({
  initialPortalOpen = true,
}: {
  /** 是否先展示「课堂启动门户」。默认 true —— 教师进入互动课堂先确认课程/班级/教学模式。 */
  initialPortalOpen?: boolean;
}) {
  // C1-R3: 全部数据经 AppDataContext 取用（不再经 TeacherView props 透传）
  const {
    selectedLesson,
    setSelectedLesson,
    setTeacherTab,
    lessons,
    classes,
    plugins,
    lang,
    timelineSegments,
    activeSegmentId,
    setActiveSegmentId,
    liveClassSelectedClassId,
    setLiveClassSelectedClassId,
    liveClassIsActive,
    setLiveClassIsActive,
    liveClassFeed,
    setLiveClassFeed,
    liveClassAcknowledgedMap,
    setLiveClassAcknowledgedMap,
    elements,
    fetchElements,
    addToast,
    onlineStudentIds,
    activeStudentLessons,
    liveClassStudentProgress,
    classStudentsMap,
    fetchClassStudents,
    socketRef,
    setShowCoursewareHub,
  } = useAppData();

  // 学生名单：按当前选中班级过滤（原 TeacherView 透传逻辑随迁）
  const students = liveClassSelectedClassId ? classStudentsMap[liveClassSelectedClassId] || [] : [];

  const fetchStudents = async () => {
    await appStore.getState().loadStudents();
    if (liveClassSelectedClassId) {
      await fetchClassStudents(liveClassSelectedClassId);
    }
  };

  const onPingStudent = (studentId: string, message?: string) => {
    if (socketRef?.current) {
      socketRef.current.emit('teacher-ping-student', {
        studentId,
        lessonId: selectedLesson,
        message,
      });
    }
  };

  const onOpenCoursewareHub = () => setShowCoursewareHub(true);
  const [isLeftSidebarCollapsed, setIsLeftSidebarCollapsed] = useState(false);
  const [hoveredStudentId, setHoveredStudentId] = useState<string | null>(null);
  const [pinnedStudentId, setPinnedStudentId] = useState<string | null>(null);
  const studentErrors = useErrorStore((s) => s.studentErrors);
  const appSetTeacherTab = useAppStore((s) => s.setTeacherTab);

  // 切换班级或学生移出当前班级时重置固定选中状态
  useEffect(() => {
    setPinnedStudentId(null);
  }, [liveClassSelectedClassId]);

  useEffect(() => {
    if (pinnedStudentId && !students.some((s) => s.id === pinnedStudentId)) {
      setPinnedStudentId(null);
    }
  }, [students, pinnedStudentId]);

  // 按 Esc 键快速取消固定
  useEffect(() => {
    if (!pinnedStudentId) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPinnedStudentId(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pinnedStudentId]);

  // R-8：旧每秒定时器已删，timerRef 一并移除；prevTimerRunningRef 供
  // onTimeRemainingChange 回调识别 running→false 转换（触发「时间到」toast）
  const prevTimerRunningRef = useRef(false);
  const lastAutoLockedRef = useRef<{ lesson: string | null; classId: string | null }>({
    lesson: null,
    classId: null,
  });

  const [, setLiveClassFullscreenElementId] = useState<string | null>(null);

  // Whiteboard outline & page states in LiveClassroom
  const whiteboardRef = useRef<WhiteboardHandle | null>(null);
  const [whiteboardPages, setWhiteboardPages] = useState<WhiteboardPageItem[]>([]);
  const [currentWhiteboardPage, setCurrentWhiteboardPage] = useState<number>(0);
  const handleWhiteboardPagesStateChange = useCallback(
    ({ pages, currentPage }: { pages: WhiteboardPageItem[]; currentPage: number }) => {
      setWhiteboardPages(pages);
      setCurrentWhiteboardPage(currentPage);
    },
    [],
  );
  const handleSegmentSync = useCallback(
    (segId: string) => {
      setActiveSegmentId(segId);
    },
    [setActiveSegmentId],
  );
  const handleWhiteboardRefresh = useCallback(() => {
    if (selectedLesson) {
      fetchElements(selectedLesson);
    }
  }, [selectedLesson, fetchElements]);
  const [expandedSegmentMap, setExpandedSegmentMap] = useState<Record<string, boolean>>({});
  const toggleSegmentExpand = (segId: string) => {
    setExpandedSegmentMap((prev) => {
      const isCurrentOpen = prev[segId] ?? segId === activeSegmentId;
      return { ...prev, [segId]: !isCurrentOpen };
    });
  };
  const handleToggleAllSegments = () => {
    const anyCollapsed = timelineSegments.some((s) => !(expandedSegmentMap[s.id] ?? s.id === activeSegmentId));
    const newMap: Record<string, boolean> = {};
    timelineSegments.forEach((s) => {
      newMap[s.id] = anyCollapsed;
    });
    setExpandedSegmentMap(newMap);
  };
  const getPagesForSegment = useCallback(
    (seg: { id: string }, segIdx: number) => getPagesForSegmentPure(seg, segIdx, whiteboardPages, timelineSegments),
    [whiteboardPages, timelineSegments],
  );

  // Classroom workflow stages: PRE_CLASS_READY, IN_CLASS_TEACHING, WRAP_UP_EXIT_TICKET, ARCHIVED_REPORT
  const [classroomStage, setClassroomStage] = useState<string>('PRE_CLASS_READY');
  /** 指定查看某场历史会话战报时的 sessionId（null = 默认最新会话） */
  const [, setReportSessionId] = useState<string | null>(null);
  const viewingSpecificReportRef = useRef<string | null>(null);
  /** 会话恢复：教师重进课堂时恢复到的白板页（undefined = 无恢复数据） */
  const [restoredCurrentPage, setRestoredCurrentPage] = useState<number | undefined>(undefined);
  // 课程切换待选状态与确认弹窗
  const [pendingLessonId, setPendingLessonId] = useState<string | null>(selectedLesson);
  const [isSwitchLessonConfirmOpen, setIsSwitchLessonConfirmOpen] = useState(false);
  // 课堂互动反馈流折叠状态
  const [isFeedCollapsed, setIsFeedCollapsed] = useState(false);

  useEffect(() => {
    setPendingLessonId(selectedLesson);
  }, [selectedLesson]);

  /**
   * Issue #91：本标签页是否已经显式进过这节课（刷新 / 切标签页后回来）。
   * 为真时跳过「会话列表 → 起始门户」两步，直接回授课视图，否则教师每次刷新
   * 都要重新点一次「继续上课」。
   */
  const resumeRememberedSession = Boolean(selectedLesson) && readRememberedActiveLesson() === selectedLesson;

  // 互动课堂起始门户：默认先展示「课程入口与班级选择门户」，
  // 教师确认课程 / 班级 / 教学模式后才进入授课视图（对应 Stitch 门户设计）。
  // 可通过 initialPortalOpen 关闭（既有单测直接断言授课视图时使用）。
  // Issue #90: 课表「快速开始上这节课」——课表页已完成会话初始化并留下
  // pendingLiveClassLaunch 信号时，跳过会话列表与门户直接进入授课视图。
  const initialLaunchSignal = uiStore.getState().pendingLiveClassLaunch;
  const [showEntryPortal, setShowEntryPortal] = useState(
    initialPortalOpen && !resumeRememberedSession && !initialLaunchSignal,
  );
  /** 是否展示「课堂会话与档案管理」看板 */
  const [showSessionManager, setShowSessionManager] = useState(false);
  /**
   * Issue #91：进入互动课堂的第一屏是「进行中的课堂会话」列表。
   * 常规路径（initialPortalOpen）先看列表，列表为空时由 `onEmpty` 回退到起始门户。
   */
  const [showSessionPicker, setShowSessionPicker] = useState(
    initialPortalOpen && !resumeRememberedSession && !initialLaunchSignal,
  );
  // 刷新时先确认进行中会话的班级，避免起始门户（含「下一节课」）在判定前可点。
  const [entryDecisionReady, setEntryDecisionReady] = useState(
    !initialPortalOpen || resumeRememberedSession || !!initialLaunchSignal,
  );
  /** 教师主动回到起始门户后，轮询不要再把门户关掉。 */
  const userReturnedToPortalRef = useRef(false);
  /**
   * 教师已经**显式**进了某节课（门户开课 / 列表继续上课 / 会话档案恢复）。
   * 轮询看到「有进行中会话」时不得再把教师弹回会话列表——否则每次 15s 轮询
   * 都会把正在上课的人踢出授课视图。
   * 宿主传 initialPortalOpen={false} 表示「已经在这节课的授课视图里」（嵌入场景与
   * 既有单测），那种情况同样算作显式进课。
   * Issue #90 的一键开课信号同理（课表页已完成 init，直达授课视图）。
   */
  const enteredClassroomRef = useRef(!initialPortalOpen || resumeRememberedSession || !!initialLaunchSignal);

  // 消费一键开课信号（Issue #90）：与门户 handlePortalEnter 同一恢复路径（选中课程/班级 + 拉取白板要素）
  useEffect(() => {
    if (!initialLaunchSignal) return;
    setSelectedLesson(initialLaunchSignal.lessonId);
    if (initialLaunchSignal.classId) {
      setLiveClassSelectedClassId(initialLaunchSignal.classId);
    }
    void fetchElements(initialLaunchSignal.lessonId);
    userReturnedToPortalRef.current = false;
    uiStore.getState().setPendingLiveClassLaunch(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [isGrowthProfileOpen, setIsGrowthProfileOpen] = useState(false);
  const [growthProfileStudentId, setGrowthProfileStudentId] = useState<string | null>(null);
  const [isPeerReviewShowcaseOpen, setIsPeerReviewShowcaseOpen] = useState(false);
  // 上课流程扩展：4 个新页面的开启状态
  const [isParentNotificationOpen, setIsParentNotificationOpen] = useState(false);
  const [isMasteryPredictionOpen, setIsMasteryPredictionOpen] = useState(false);
  const [isDiagnosticCenterOpen, setIsDiagnosticCenterOpen] = useState(false);
  const [isGroupCollabOpen, setIsGroupCollabOpen] = useState(false);
  const [collabInitialGalleryMode, setCollabInitialGalleryMode] = useState(false);
  const [isShowcaseDiffOpen, setIsShowcaseDiffOpen] = useState(false);
  const [isMacroRunnerOpen, setIsMacroRunnerOpen] = useState(false);
  const [isHardwareSettingsOpen, setIsHardwareSettingsOpen] = useState(false);
  const [isSocketConnected, setIsSocketConnected] = useState<boolean>(() => Boolean(getOptionalSocket()?.connected));
  /** 真实开课时间（来自 classroom_sessions.started_at），用于计算已用时长 */
  const [sessionStartedAt, setSessionStartedAt] = useState<number | null>(null);
  /**
   * 该课节是否存在**进行中的课堂会话**。
   *
   * 会话恢复协议的写入端点（POST .../view-state）在“无会话”时按契约返回 404
   * （见 server/__tests__/classroom-session-resume.test.ts）。此前本组件在
   * 尚无会话时也会防抖回写环节/页码 → 每次打开互动课堂都稳定产生一条 404
   * + 控制台错误。现在只有在确有会话时才回写。
   */
  const [hasActiveSession, setHasActiveSession] = useState(false);
  /** 课程/会话鉴权或资源缺失（401/403/404）后立即停止轮询并向教师展示清晰提示 */
  const [lessonAccessError, setLessonAccessError] = useState<{ status: number; endpoint: string } | null>(null);
  const notifiedAccessErrorKeyRef = useRef<string | null>(null);
  const isActiveClassroomView =
    Boolean(selectedLesson) && !showSessionManager && !showSessionPicker && !showEntryPortal;

  const reportLessonAccessError = useCallback(
    (status: number, endpoint: string) => {
      setLessonAccessError({ status, endpoint });
      if (status === 403 || status === 404) {
        rememberActiveLesson(null);
      }
      const key = `${selectedLesson ?? ''}:${status}`;
      if (notifiedAccessErrorKeyRef.current !== key) {
        notifiedAccessErrorKeyRef.current = key;
        const message =
          status === 401
            ? lang === 'zh'
              ? '登录状态已失效，已停止课堂数据同步，请重新登录。'
              : 'Session expired. Classroom polling stopped; please sign in again.'
            : status === 403
              ? lang === 'zh'
                ? '当前账号无权访问该课节的课堂数据，已停止轮询。请切换为授课教师账号或重新选择课节。'
                : 'You do not have permission to access this lesson. Polling stopped; select another lesson or sign in with an authorized account.'
              : lang === 'zh'
                ? '目标课节或课堂会话不存在，已停止数据轮询。'
                : 'Target lesson or session was not found. Polling stopped.';
        addToast(lang === 'zh' ? '课堂同步已暂停' : 'Classroom sync paused', message, 'warning');
      }
    },
    [selectedLesson, lang, addToast],
  );

  useEffect(() => {
    if (selectedLesson) {
      setLessonAccessError(null);
      notifiedAccessErrorKeyRef.current = null;
    }
  }, [selectedLesson]);

  const { rollcallCounts } = useLiveClassroomSessionPolling({
    selectedLesson,
    initialPortalOpen,
    isActiveClassroomView,
    activeSegmentId,
    reportLessonAccessError,
    userReturnedToPortalRef,
    enteredClassroomRef,
    viewingSpecificReportRef,
    setClassroomStage,
    setSessionStartedAt,
    setEntryDecisionReady,
    setHasActiveSession,
    setLessonAccessError,
    setShowSessionPicker,
    setShowEntryPortal,
    setSelectedLesson,
    setLiveClassSelectedClassId,
    setLiveClassFeed,
    setActiveSegmentId,
    setRestoredCurrentPage,
  });

  const [middleTab, setMiddleTab] = useState<TeacherMiddleTab>('whiteboard');

  const {
    attempts,
    pluginSubmissions,
    loadingAttempts,
    selectedAttempt,
    setSelectedAttempt,
    rawPayload,
    loadingRaw,
    submissionFilter,
    setSubmissionFilter,
    searchQuery,
    setSearchQuery,
    autoRecordRule,
    autoRecordRuleLoaded,
    savingAutoRecordRule,
    saveAutoRecordRule,
    autoRecordReport,
    runAutoRecord,
    autoRecordRunning,
    fetchAttempts,
    handleGradePluginSubmission,
    handlePromoteAttempt,
    handleMarkAbsent,
    handleViewRaw,
    displayAttempts,
  } = useLiveClassroomSubmissions({
    selectedLesson,
    liveClassSelectedClassId,
    middleTab,
    timelineSegments,
    activeSegmentId,
    students,
    lang,
    addToast,
    fetchStudents,
  });

  const macroRuntimeRef = useRef<{
    selectedLesson: string | null;
    classId: string | null;
    lang: string;
    toggleLock: (lock: boolean, mode?: 'full' | 'navigation') => Promise<void>;
    fetchAttempts: () => void;
    addToast: typeof addToast;
  }>({
    selectedLesson,
    classId: liveClassSelectedClassId,
    lang,
    toggleLock: async () => {},
    fetchAttempts: () => {},
    addToast,
  });

  const { lockingClass, isClassLocked, classLockMode, handleToggleClassLock, handleToggleStudentLock } =
    useLiveClassroomLocks({
      students,
      selectedLesson,
      liveClassSelectedClassId,
      lang,
      addToast,
      fetchStudents,
      setLiveClassFeed,
      lastAutoLockedRef,
      macroRuntimeRef,
      fetchAttempts,
    });

  const { syncChannelRef, isStudentWindowOpen, handleOpenStudentWindow, handleSyncShowcaseDiffToClass } =
    useLiveClassroomSyncBroadcast({
      selectedLesson,
      liveClassSelectedClassId,
      activeSegmentId,
      middleTab,
      isClassLocked,
      liveClassIsActive,
      students,
      lang,
      addToast,
      setLiveClassAcknowledgedMap,
      setLiveClassFeed,
      hasActiveSession,
    });

  const handleFullscreenSync = useCallback(
    (elId: string | null) => {
      setLiveClassFullscreenElementId(elId);
      syncChannelRef.current?.broadcastFullscreen(elId, selectedLesson || undefined);
    },
    [selectedLesson, syncChannelRef],
  );

  const { classroomTools, handleExecuteTool } = useClassroomPluginTools({
    plugins,
    selectedLesson,
    liveClassSelectedClassId,
    activeSegmentId,
    lang,
    addToast,
    setLiveClassFeed,
    onOpenCoursewareHub,
    fetchElements,
  });

  const { isDrawing, activeDrawStudentId, selectedDrawStudentIds, handleRandomPick } = useLiveClassroomRandomPick({
    students,
    selectedLesson,
    liveClassSelectedClassId,
    onlineStudentIds,
    activeStudentLessons,
    lang,
    addToast,
    setLiveClassFeed,
    syncChannelRef,
  });

  // 课堂真实数据派生层：把已有 props/state 统一派生为 AI/报表可用的真实指标
  const liveData = useClassroomLiveData({
    students,
    liveClassStudentProgress,
    onlineStudentIds,
    liveClassFeed,
    timelineSegments,
    attempts,
    sessionStartedAt,
    classroomStage,
    studentErrors,
  });

  /**
   * 互评秀场真实数据源（不编造学生/作品/分数）：
   *   workA / workB   ← 本节真实课件作答（courseware_attempt + submission_result）按分数取前 2
   *   podiumStudents  ← 本节真实积分榜（lesson_quiz_submissions 聚合）按积分取前 3
   *   reviewProgress  ← 真实「已完成 / 总人数」
   * 平台当前**没有**课中互评任务表（plugin_peer_review_* 是作业级互评），
   * 因此 matchingItems / badges / danmaku 留空，由弹窗渲染空态说明，
   * 不再用「张子豪评陈子墨」这类假数据填充界面。
   */
  // 课中互评数据层（真实积分榜 + 互评表 + 一键分配），见 features/classroom/hooks/usePeerReviewData.ts
  const {
    data: peerReviewData,
    topPerformers,
    showcaseWorks,
    setSpotlightWork,
    autoAssigning,
    autoAssign: handleAutoAssignPeerReview,
  } = usePeerReviewData({
    lessonId: selectedLesson,
    enabled: (isPeerReviewShowcaseOpen || isShowcaseDiffOpen) && isActiveClassroomView,
    topPerformersEnabled: isActiveClassroomView,
    onTerminalError: reportLessonAccessError,
    attempts,
    studentCount: students.length,
    addToast,
    lang: lang as 'zh' | 'en',
  });

  /**
   * 真实学生档案：积分来自 top-performers（lesson_quiz_submissions 聚合），
   * 专注度来自 liveClassStudentProgress.progress_percent，座位/小组来自学生记录。
   * 无真实数据时保持 0 / undefined —— 不再回退到「学员 A1」这类假身份。
   */
  const classProfiles = React.useMemo(() => {
    const pointsById = new Map(topPerformers.map((t) => [t.studentId, t.cumulativeScore]));
    const accuracyById = new Map(topPerformers.map((t) => [t.studentId, t.accuracy]));
    return liveData.studentMetrics.map((m, idx) => {
      // 真实维度分数：只填有真实来源的维度，其余留 undefined（弹窗显示「暂无数据」）
      const accuracy = accuracyById.get(m.studentId);
      const competencyScores: Record<string, number> = {};
      if (typeof accuracy === 'number' && accuracy > 0) competencyScores.logic = Math.round(accuracy);
      if (typeof m.completion === 'number') competencyScores.engineering = Math.round(m.completion * 100);
      if (m.progressPercent > 0) competencyScores.focus = m.progressPercent;
      return {
        id: m.studentId,
        name: m.studentName,
        studentNo: m.studentNumber,
        groupName: (students[idx] as any)?.group_name ?? undefined,
        seatNumber: (students[idx] as any)?.seat_number ?? undefined,
        currentPoints: pointsById.get(m.studentId) ?? 0,
        focusScore: m.progressPercent,
        pickedCountToday: rollcallCounts.get(m.studentId) ?? 0,
        competencyScores: Object.keys(competencyScores).length > 0 ? competencyScores : undefined,
      };
    });
  }, [liveData.studentMetrics, topPerformers, students, rollcallCounts]);

  const handleStageChange = async (newStage: string) => {
    // v0.6.1 审计 R-2：阶段推进先等服务端裁决（守卫可能 403），成功才更新
    // 本地阶段 —— 此前乐观更新 + 双轮询回灌会让视图在新旧阶段间抖动、且
    // 被拒时教师得不到任何反馈。
    if (!selectedLesson) {
      setClassroomStage(newStage);
      return;
    }
    try {
      const res = await fetch(`/api/classroom/sessions/${selectedLesson}/stage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: newStage, classId: liveClassSelectedClassId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        addToast(
          lang === 'zh' ? '⚠️ 阶段切换被拒绝' : '⚠️ Stage change rejected',
          body?.error || body?.message || `HTTP ${res.status}`,
          'warning',
        );
        return;
      }
      setClassroomStage(newStage);
    } catch (err) {
      console.error('Failed to update stage:', err);
      addToast(
        lang === 'zh' ? '⚠️ 阶段切换失败' : '⚠️ Stage change failed',
        lang === 'zh' ? '网络异常，请重试' : 'Network error, please retry',
        'warning',
      );
    }
  };

  /**
   * 门户「开始上课」按钮：先初始化课堂会话（携带教学模式），
   * 再切换到授课视图。初始化失败时不切视图，由门户把错误提示给教师，
   * 避免出现「界面已进课堂但服务端没有会话」的割裂状态。
   */
  const handlePortalEnter = async ({
    lessonId,
    classId,
    teachingModeId,
  }: {
    lessonId: string;
    classId: string;
    teachingModeId: string | null;
  }) => {
    const res = await fetch(`/api/classroom/sessions/${lessonId}/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ classId, teachingModeId: teachingModeId ?? undefined }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error(
        data?.error || (lang === 'zh' ? '初始化课堂会话失败' : 'Failed to initialise the classroom session'),
      );
    }

    setSelectedLesson(lessonId);
    setLiveClassSelectedClassId(classId);
    void fetchElements(lessonId);
    userReturnedToPortalRef.current = false;
    enteredClassroomRef.current = true;
    rememberActiveLesson(lessonId);
    setShowSessionPicker(false);
    setShowEntryPortal(false);
  };

  const host = useOptionalPluginHost();
  const segmentMainExtensions = host?.getExtensions('classroom.active_segment.main') || [];
  const hasSegmentMainExtension = segmentMainExtensions.length > 0;
  const currentActiveSegment = timelineSegments.find((s) => s.id === activeSegmentId);

  // Mode Pack 灰度：仅 flag 开启时注册内置白板/学案工作区；关闭时卸载，保持既有路径。
  useEffect(() => {
    if (!host) return;
    if (isModePacksEnabled()) {
      registerWhiteboardModePack();
      registerXueanModePack();
      return () => {
        unregisterWhiteboardModePack();
        unregisterXueanModePack();
      };
    }
    unregisterWhiteboardModePack();
    unregisterXueanModePack();
    return undefined;
  }, [host]);

  // 最小授课壳：注入工作区控制器，让插件工作区复用宿主现成的流程状态与动作，
  // 而不自建流程引擎。setActiveSegment 只需改 activeSegmentId —— 下方 effect
  // （:1519-1543）已负责持久化 view-state 并通过 syncChannel 广播给全班。
  const segmentMainFlowController = {
    snapshot: {
      lessonId: selectedLesson,
      classId: liveClassSelectedClassId,
      stage: classroomStage,
      activeSegmentId,
      segments: timelineSegments,
      students,
      onlineStudentIds,
      attempts,
    },
    setActiveSegment: (segmentId: string) => setActiveSegmentId(segmentId),
    advanceStage: (stage: string) => void handleStageChange(stage),
    sendMessage: async (input: {
      channel: string;
      msgType: 'request' | 'response';
      payload: unknown;
      targetUserIds?: string[] | null;
      ttlMs?: number | null;
      messageId?: string;
    }) => {
      const res = await fetch('/api/classroomflowserver/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...input,
          lessonId: selectedLesson,
          classId: liveClassSelectedClassId,
        }),
      });
      if (!res.ok) throw new Error(`sendMessage failed: HTTP ${res.status}`);
      return res.json();
    },
    refresh: () => {
      if (selectedLesson) fetchElements(selectedLesson);
    },
  };

  const addToastRef = useRef(addToast);
  useEffect(() => {
    addToastRef.current = addToast;
  }, [addToast]);
  const stableAddToast = useCallback(
    (title: string, message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info') =>
      addToastRef.current(title, message, type),
    [],
  );

  const lastSaveFailureToastAtRef = useRef(0);
  const notifyWhiteboardSaveFailure = useCallback(
    (status: number) => {
      const now = Date.now();
      if (now - lastSaveFailureToastAtRef.current < 5000) return;
      lastSaveFailureToastAtRef.current = now;
      const isRateLimited = status === 429;
      stableAddToast(
        lang === 'zh' ? '白板保存失败' : 'Whiteboard save failed',
        lang === 'zh'
          ? isRateLimited
            ? '请求过于频繁，本次改动未保存。请稍后重试（课堂内多台设备共用同一出口 IP 时容易触发）。'
            : `服务端返回 HTTP ${status}，本次改动未保存，请稍后重试。`
          : isRateLimited
            ? 'Too many requests — the change was not saved. Please retry in a moment.'
            : `Server returned HTTP ${status}; the change was not saved.`,
        'warning',
      );
    },
    [lang, stableAddToast],
  );

  const handleElementAdd = useCallback(
    async (type: string, data: any) => {
      if (!selectedLesson) return;
      const res = await fetch(`/api/lessons/${selectedLesson}/whiteboard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, data }),
      });
      if (!res.ok) {
        notifyWhiteboardSaveFailure(res.status);
        return;
      }
      fetchElements(selectedLesson);
    },
    [selectedLesson, notifyWhiteboardSaveFailure, fetchElements],
  );

  const handleElementUpdate = useCallback(
    async (elementId: string, data: any) => {
      if (!selectedLesson) return;
      const res = await fetch(`/api/lessons/${selectedLesson}/whiteboard/${elementId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data }),
      });
      if (!res.ok) {
        notifyWhiteboardSaveFailure(res.status);
        return;
      }
      fetchElements(selectedLesson);
    },
    [selectedLesson, notifyWhiteboardSaveFailure, fetchElements],
  );

  const handleElementDelete = useCallback(
    async (elementId: string) => {
      if (!selectedLesson) return;
      const res = await fetch(`/api/lessons/${selectedLesson}/whiteboard/${elementId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        notifyWhiteboardSaveFailure(res.status);
        return;
      }
      fetchElements(selectedLesson);
    },
    [selectedLesson, notifyWhiteboardSaveFailure, fetchElements],
  );

  // 订阅真实 Socket.IO 连接态，驱动顶部「Live Broadcaster」状态指示灯
  useEffect(() => {
    let cleanupListeners: (() => void) | null = null;
    const offReady = onSocketInstance((socket) => {
      cleanupListeners?.();
      setIsSocketConnected(Boolean(socket.connected));
      const handleConnect = () => setIsSocketConnected(true);
      const handleDisconnect = () => setIsSocketConnected(false);
      socket.on('connect', handleConnect);
      socket.on('disconnect', handleDisconnect);
      socket.on('connect_error', handleDisconnect);
      cleanupListeners = () => {
        socket.off('connect', handleConnect);
        socket.off('disconnect', handleDisconnect);
        socket.off('connect_error', handleDisconnect);
      };
    });
    return () => {
      offReady();
      cleanupListeners?.();
    };
  }, []);

  const showcaseCandidateWorks = useMemo(
    () => buildShowcaseDiffCandidateWorks(showcaseWorks, attempts, students),
    [showcaseWorks, attempts, students],
  );

  useLiveClassroomMacroEngine({
    macroRuntimeRef,
    syncChannelRef,
    setLiveClassFeed,
    setMiddleTab,
    setCollabInitialGalleryMode,
    setIsGroupCollabOpen,
  });

  // 最小授课壳：若当前环节命中一个声明 primary:true 的工作区扩展（如"学案模式"），
  // 自动切到环节工作区 tab，使该模式真正接管课中主视图而非停留在白板。
  // 未声明 primary 的扩展保持旧行为（教师手动点 tab）。
  useEffect(() => {
    if (!activeSegmentId || classroomStage !== 'IN_CLASS_TEACHING' || !host) return;
    const seg = timelineSegments.find((s) => s.id === activeSegmentId) as { type?: string } | undefined;
    const segmentType = isModePacksEnabled() ? normalizeSegmentType(seg?.type) : seg?.type;
    if (!segmentType) return;
    // 从 host 现取，避免把 `|| []` 产生的新数组放进依赖（触发 exhaustive-deps 告警）
    const exts = host.getExtensions('classroom.active_segment.main' as never) as unknown[];
    const primary = exts.some((ext) => {
      const e = ext as { targetType?: string; slotProps?: Record<string, unknown> };
      const cfg = e.slotProps ?? {};
      const declared = e.targetType ?? cfg.segmentType ?? cfg.targetType;
      return (
        cfg.primary === true &&
        extensionCoversSegmentType(
          typeof declared === 'string' ? declared : declared == null ? null : String(declared),
          segmentType,
        )
      );
    });
    if (primary) setMiddleTab('segment_main');
  }, [activeSegmentId, classroomStage, timelineSegments, host]);

  // 服务端课堂动态流（classroom_feed 落库后广播）：实时追加，与本地事件同池渲染。
  useEffect(() => {
    if (!selectedLesson) return;
    const handler = (entry: any) => {
      if (!entry || typeof entry !== 'object') return;
      setLiveClassFeed((prev: any[]) => {
        if (prev.some((f) => f?.id && f.id === entry.id)) return prev;
        return [entry, ...prev];
      });
    };
    const stageChangedHandler = (payload: any) => {
      if (!payload || payload.lessonId !== selectedLesson) return;
      if (payload.stage) {
        setClassroomStage(payload.stage);
        if (payload.stage === 'ARCHIVED_REPORT') {
          setLiveClassIsActive(false);
        }
      }
    };
    const sessionDeletedHandler = (payload: any) => {
      if (!payload || payload.lessonId !== selectedLesson) return;
      viewingSpecificReportRef.current = null;
      setReportSessionId(null);
      setClassroomStage('PRE_CLASS_READY');
      setLiveClassIsActive(false);
      setSessionStartedAt(null);
    };
    let detach: (() => void) | null = null;
    const off = onSocketInstance((socket) => {
      detach?.();
      socket.on('classroom:feed_appended', handler);
      socket.on('classroom:stage_changed', stageChangedHandler);
      socket.on('classroom:session_deleted', sessionDeletedHandler);
      detach = () => {
        if (typeof socket.off === 'function') {
          socket.off('classroom:feed_appended', handler);
          socket.off('classroom:stage_changed', stageChangedHandler);
          socket.off('classroom:session_deleted', sessionDeletedHandler);
        } else if (typeof (socket as any).removeListener === 'function') {
          (socket as any).removeListener('classroom:feed_appended', handler);
          (socket as any).removeListener('classroom:stage_changed', stageChangedHandler);
          (socket as any).removeListener('classroom:session_deleted', sessionDeletedHandler);
        }
      };
    });
    return () => {
      off();
      detach?.();
    };
  }, [selectedLesson]);

  const handleStartSegment = (seg: any) => {
    setActiveSegmentId(seg.id);
    setExpandedSegmentMap((prev) => ({ ...prev, [seg.id]: true }));
    const secs = resolveSegmentDuration(seg, { fallbackSeconds: 300 }).seconds ?? 300;
    // R-8：计时写入 liveClassStore（不经过 AppDataContext）
    liveClassStore.getState().setLiveClassTimeRemaining(secs);
    setLiveClassIsActive(true);
    if (hasSegmentMainExtension) {
      setMiddleTab('segment_main');
    }

    setLiveClassFeed((prev) => [
      {
        id: Math.random().toString(),
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        type: 'info',
        message: `教学环节切换并广播：进入 [${seg.title}] 环节，设定时间 ${seg.duration}。`,
      },
      ...prev,
    ]);

    addToast(
      lang === 'zh' ? '📢 环节已广播' : '📢 Phase Synchronized',
      lang === 'zh'
        ? `已同步广播 [${seg.title}] 环节至所有在线学生端。`
        : `Broadcasted phase [${seg.title}] to all active students.`,
      'success',
    );
  };

  const handleOverrideSegmentGate = async (studentId: string) => {
    if (!selectedLesson || !activeSegmentId) {
      addToast(
        lang === 'zh' ? '请先进入教学环节' : 'Choose a segment',
        lang === 'zh' ? '放行需要当前课堂环节。' : 'An active segment is required.',
        'warning',
      );
      return;
    }
    try {
      const res = await fetch(`/api/classroom/sessions/${encodeURIComponent(selectedLesson)}/segment-overrides`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId, segmentId: activeSegmentId, reason: '教师放行' }),
      });
      const stName = students.find((s) => s.id === studentId)?.name || studentId;
      if (res.ok) {
        addToast(
          lang === 'zh' ? '已放行' : 'Override saved',
          lang === 'zh' ? `已允许 ${stName} 进入当前环节。` : `${stName} may enter the current segment.`,
          'success',
        );
      } else {
        addToast(
          lang === 'zh' ? '放行失败' : 'Override failed',
          lang === 'zh' ? '请稍后重试。' : 'Try again.',
          'warning',
        );
      }
    } catch (e) {
      console.error('Failed to override segment gate', e);
    }
  };

  // Mode Pack 画布桥：flag 开时 WhiteboardModeWorkspace / segment_main 共用同一 LazyWhiteboard 契约。
  const teacherWhiteboardBridge = useMemo<WhiteboardHostBridgeValue>(
    () => ({
      whiteboardRef,
      canvasProps: {
        lessonId: selectedLesson,
        classId: liveClassSelectedClassId,
        userRole: 'teacher',
        initialPage: restoredCurrentPage,
        isEditMode: false,
        broadcastFullscreen: true,
        fullscreenBroadcastClassId: liveClassSelectedClassId,
        onFullscreenSync: handleFullscreenSync,
        elements,
        activeSegmentId,
        onSegmentSync: handleSegmentSync,
        classroomTools,
        onExecuteTool: handleExecuteTool,
        hidePageBar: true,
        onPagesStateChange: handleWhiteboardPagesStateChange,
        onElementAdd: handleElementAdd,
        onElementUpdate: handleElementUpdate,
        onElementDelete: handleElementDelete,
        onRefresh: handleWhiteboardRefresh,
      },
    }),
    [
      selectedLesson,
      liveClassSelectedClassId,
      restoredCurrentPage,
      handleFullscreenSync,
      elements,
      activeSegmentId,
      handleSegmentSync,
      classroomTools,
      handleExecuteTool,
      handleWhiteboardPagesStateChange,
      handleElementAdd,
      handleElementUpdate,
      handleElementDelete,
      handleWhiteboardRefresh,
    ],
  );

  const handleEditLesson = (lessonId: string) => {
    setSelectedLesson(lessonId);
    if (fetchElements) {
      void fetchElements(lessonId);
    }
    if (setTeacherTab) {
      setTeacherTab('lesson_editor');
    } else {
      appSetTeacherTab('lesson_editor');
    }
  };

  // 起始门户中的「前往课表设置」按钮回调。
  const handleGoToTimetable = useCallback(() => {
    if (setTeacherTab) {
      setTeacherTab('timetable');
    } else {
      appSetTeacherTab('timetable');
    }
  }, [setTeacherTab, appSetTeacherTab]);

  // 起始门户：未确认配置前不渲染授课视图，避免教师直接进入无准备的课堂。
  // 注意此处已越过全部 hook 调用，条件返回不影响 Hook 顺序。
  // 有课节时先等会话结果，避免刷新后「下一节课」在班级锁定判定前被点到。
  if (showSessionManager) {
    return (
      <ClassroomSessionManager
        lessons={lessons}
        classes={classes}
        lang={lang}
        addToast={addToast}
        onBackToPortal={() => {
          userReturnedToPortalRef.current = true;
          enteredClassroomRef.current = false;
          rememberActiveLesson(null);
          setEntryDecisionReady(true);
          setShowSessionManager(false);
          setShowSessionPicker(false);
          setShowEntryPortal(true);
        }}
        onResumeSession={(session: ClassroomSessionItem) => {
          viewingSpecificReportRef.current = null;
          setReportSessionId(null);
          userReturnedToPortalRef.current = false;
          enteredClassroomRef.current = true;
          rememberActiveLesson(session.lessonId);
          setSelectedLesson(session.lessonId);
          if (session.classId) setLiveClassSelectedClassId(session.classId);
          setClassroomStage(session.stage || 'IN_CLASS_TEACHING');
          setShowSessionManager(false);
          setShowSessionPicker(false);
          setShowEntryPortal(false);
        }}
        onViewReport={(session: ClassroomSessionItem) => {
          viewingSpecificReportRef.current = session.id;
          setReportSessionId(session.id);
          setSelectedLesson(session.lessonId);
          if (session.classId) setLiveClassSelectedClassId(session.classId);
          setClassroomStage('ARCHIVED_REPORT');
          setShowSessionManager(false);
          setShowEntryPortal(false);
        }}
        onSessionArchived={(session: ClassroomSessionItem) => {
          if (session.lessonId === selectedLesson) {
            viewingSpecificReportRef.current = session.id;
            setReportSessionId(session.id);
            setClassroomStage('ARCHIVED_REPORT');
            setLiveClassIsActive(false);
          }
        }}
        onSessionDeleted={(session: ClassroomSessionItem) => {
          if (session.lessonId === selectedLesson) {
            viewingSpecificReportRef.current = null;
            setReportSessionId(null);
            setClassroomStage('PRE_CLASS_READY');
            setLiveClassIsActive(false);
            setSessionStartedAt(null);
            userReturnedToPortalRef.current = true;
            enteredClassroomRef.current = false;
            rememberActiveLesson(null);
            setEntryDecisionReady(true);
            setShowSessionPicker(false);
            setShowEntryPortal(true);
          }
        }}
      />
    );
  }

  // Issue #91：第一屏 —— 进行中的课堂会话列表（空列表时自动回退到起始门户）
  if (showSessionPicker) {
    return (
      <InProgressSessionList
        lang={lang}
        currentLessonId={selectedLesson}
        addToast={addToast}
        onResume={(session: ClassroomSessionItem) => {
          viewingSpecificReportRef.current = null;
          setReportSessionId(null);
          userReturnedToPortalRef.current = false;
          enteredClassroomRef.current = true;
          rememberActiveLesson(session.lessonId);
          setSelectedLesson(session.lessonId);
          if (session.classId) setLiveClassSelectedClassId(session.classId);
          setClassroomStage(session.stage || 'IN_CLASS_TEACHING');
          setShowSessionPicker(false);
          setShowEntryPortal(false);
        }}
        onStartNew={() => {
          // 开始一节新课走既有起始门户；进行中的会话不受影响。
          userReturnedToPortalRef.current = true;
          enteredClassroomRef.current = false;
          rememberActiveLesson(null);
          setEntryDecisionReady(true);
          setShowSessionPicker(false);
          setShowEntryPortal(true);
        }}
        onOpenArchive={() => {
          setShowSessionPicker(false);
          setShowSessionManager(true);
        }}
        onEmpty={() => {
          // 一场进行中的会话都没有 → 直接显示起始门户（与旧行为一致）
          setShowSessionPicker(false);
          if (!enteredClassroomRef.current) setShowEntryPortal(true);
        }}
      />
    );
  }

  const accessErrorBanner = (
    <LiveClassroomAccessErrorBanner
      lessonAccessError={lessonAccessError}
      lang={lang}
      showEntryPortal={showEntryPortal}
      userReturnedToPortalRef={userReturnedToPortalRef}
      enteredClassroomRef={enteredClassroomRef}
      setShowEntryPortal={setShowEntryPortal}
      setLessonAccessError={setLessonAccessError}
    />
  );

  if (showEntryPortal && !entryDecisionReady) {
    return (
      <div
        data-testid="live-class-entry-pending"
        className="flex-1 flex items-center justify-center text-sm text-muted"
      >
        {lang === 'zh' ? '正在确认本节课班级…' : 'Checking this lesson’s class…'}
      </div>
    );
  }
  if (showEntryPortal) {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        {accessErrorBanner}
        <ClassroomEntryPortal
          lessons={lessons}
          classes={classes}
          students={students}
          selectedLesson={selectedLesson}
          setSelectedLesson={setSelectedLesson}
          liveClassSelectedClassId={liveClassSelectedClassId}
          setLiveClassSelectedClassId={setLiveClassSelectedClassId}
          timelineSegments={timelineSegments}
          onlineStudentIds={onlineStudentIds}
          lang={lang}
          addToast={addToast}
          onEnterClassroom={handlePortalEnter}
          onEditLesson={handleEditLesson}
          onGoToTimetable={handleGoToTimetable}
          onOpenSessionManager={() => setShowSessionManager(true)}
        />
      </div>
    );
  }

  const currentLesson = lessons.find((item) => item.id === selectedLesson);
  const isXueanLesson =
    resolveLessonModePackDeliveryMode(currentLesson?.mode_pack_id, currentLesson?.delivery_mode) === 'xuean';

  return (
    <div className="flex-grow flex-1 flex flex-col min-h-0 bg-surface border border-theme rounded-2xl shadow-xl text-main overflow-hidden font-sans">
      <LiveClassroomHeaderBar
        compact={!isXueanLesson}
        lang={lang}
        liveClassIsActive={liveClassIsActive}
        classes={classes}
        liveClassSelectedClassId={liveClassSelectedClassId}
        userReturnedToPortalRef={userReturnedToPortalRef}
        enteredClassroomRef={enteredClassroomRef}
        setEntryDecisionReady={setEntryDecisionReady}
        setShowSessionPicker={setShowSessionPicker}
        setShowEntryPortal={setShowEntryPortal}
        setShowSessionManager={setShowSessionManager}
        pendingLessonId={pendingLessonId}
        setPendingLessonId={setPendingLessonId}
        lessons={lessons}
        selectedLesson={selectedLesson}
        setIsSwitchLessonConfirmOpen={setIsSwitchLessonConfirmOpen}
        handleEditLesson={handleEditLesson}
        handleOpenStudentWindow={handleOpenStudentWindow}
        isStudentWindowOpen={isStudentWindowOpen}
        isClassLocked={isClassLocked}
        classLockMode={classLockMode}
        handleToggleClassLock={handleToggleClassLock}
        lockingClass={lockingClass}
        setIsDiagnosticCenterOpen={setIsDiagnosticCenterOpen}
        setIsMasteryPredictionOpen={setIsMasteryPredictionOpen}
        setCollabInitialGalleryMode={setCollabInitialGalleryMode}
        setIsGroupCollabOpen={setIsGroupCollabOpen}
        setIsShowcaseDiffOpen={setIsShowcaseDiffOpen}
        setIsPeerReviewShowcaseOpen={setIsPeerReviewShowcaseOpen}
        setIsParentNotificationOpen={setIsParentNotificationOpen}
        setIsMacroRunnerOpen={setIsMacroRunnerOpen}
        setIsHardwareSettingsOpen={setIsHardwareSettingsOpen}
        syncChannelRef={syncChannelRef}
        onlineStudentIds={onlineStudentIds}
        liveClassAcknowledgedMap={liveClassAcknowledgedMap}
        setLiveClassIsActive={setLiveClassIsActive}
        addToast={addToast}
        prevTimerRunningRef={prevTimerRunningRef}
      />

      {accessErrorBanner}

      {/* Interactive Classroom Cockpit (Stages, Polls, Buzzers, Exit Tickets, Stage Display) */}
      <ClassroomInteractiveCockpit
        compact={!isXueanLesson}
        lessonId={selectedLesson}
        lessonTitle={lessons.find((l) => l.id === selectedLesson)?.title}
        classId={liveClassSelectedClassId}
        lang={lang as any}
        addToast={addToast}
        currentStage={classroomStage}
        onStageChange={(newStage) => setClassroomStage(newStage)}
        students={classProfiles}
      />

      <LiveClassroomStageRouter
        selectedLesson={selectedLesson}
        classroomStage={classroomStage}
        lessons={lessons}
        classes={classes}
        lang={lang}
        isClassLocked={isClassLocked}
        isLeftSidebarCollapsed={isLeftSidebarCollapsed}
        onToggleClassLock={() => handleToggleClassLock(!isClassLocked)}
        onStageChange={handleStageChange}
        preClassProps={{
          selectedClassId: liveClassSelectedClassId,
          className: classes.find((c) => c.id === liveClassSelectedClassId)?.name || '',
          students,
          onlineStudentIds,
          timelineSegments,
          lang: lang as 'zh' | 'en',
          onPingStudent: () => handleRandomPick(),
          onOpenStudentWindow: handleOpenStudentWindow,
          isStudentWindowOpen,
          addToast,
          onBroadcastNotice: (msg) => {
            setLiveClassFeed((prev) => [
              {
                id: `feed-notice-${Date.now()}`,
                time: new Date().toLocaleTimeString(),
                type: 'checkin',
                message: msg,
              },
              ...prev,
            ]);
          },
        }}
        wrapUpProps={{
          selectedClassId: liveClassSelectedClassId,
          className: classes.find((c) => c.id === liveClassSelectedClassId)?.name || '',
          students,
          lang: lang as 'zh' | 'en',
          attempts,
          loadingAttempts,
          onFetchAttempts: () => fetchAttempts(),
          onPromoteAttempt: handlePromoteAttempt,
          onViewRaw: (a) => handleViewRaw(a),
          addToast,
          onBroadcastNotice: (msg) => {
            setLiveClassFeed((prev) => [
              {
                id: `feed-hw-${Date.now()}`,
                time: new Date().toLocaleTimeString(),
                type: 'checkin',
                message: msg,
              },
              ...prev,
            ]);
          },
        }}
        briefingProps={{
          selectedClassId: liveClassSelectedClassId,
          className: classes.find((c) => c.id === liveClassSelectedClassId)?.name || '',
          students,
          lang: lang as 'zh' | 'en',
          addToast,
        }}
        timelineProps={{
          timelineSegments,
          activeSegmentId,
          whiteboardPages,
          currentWhiteboardPage,
          expandedSegmentMap,
          elements,
          onToggleAllSegments: handleToggleAllSegments,
          onToggleSegmentExpand: toggleSegmentExpand,
          onAddPage: () => whiteboardRef.current?.addPage?.(),
          onCollapse: () => setIsLeftSidebarCollapsed(true),
          onSelectPage: (globalIdx, segId) => {
            whiteboardRef.current?.switchPage?.(globalIdx);
            if (segId && segId !== activeSegmentId) {
              setActiveSegmentId(segId);
            }
          },
          onStartSegment: handleStartSegment,
          getPagesForSegment,
        }}
        middleWorkspaceProps={{
          compact: !isXueanLesson,
          isLeftSidebarCollapsed,
          setIsLeftSidebarCollapsed,
          middleTab,
          setMiddleTab,
          hasSegmentMainExtension,
          currentActiveSegment,
          studentErrors,
          isSocketConnected,
          onFinishTeaching: () => handleStageChange('WRAP_UP_EXIT_TICKET'),
          teacherWhiteboardBridge,
          liveClassSelectedClassId,
          segmentMainFlowController,
          onWhiteboardRefresh: handleWhiteboardRefresh,
          whiteboardRef,
          restoredCurrentPage,
          onFullscreenSync: handleFullscreenSync,
          elements,
          activeSegmentId,
          onSegmentSync: handleSegmentSync,
          classroomTools,
          onExecuteTool: handleExecuteTool,
          onPagesStateChange: handleWhiteboardPagesStateChange,
          onElementAdd: handleElementAdd,
          onElementUpdate: handleElementUpdate,
          onElementDelete: handleElementDelete,
          fetchElements,
          lessons,
          classes,
          students,
          addToast,
          lang: lang as 'zh' | 'en',
          attempts,
          displayAttempts,
          loadingAttempts,
          searchQuery,
          setSearchQuery,
          submissionFilter,
          setSubmissionFilter,
          fetchAttempts,
          autoRecordRule,
          autoRecordRuleLoaded,
          savingAutoRecordRule,
          saveAutoRecordRule,
          autoRecordReport,
          runAutoRecord,
          autoRecordRunning,
          handleViewRaw,
          handlePromoteAttempt,
          handleMarkAbsent,
          pluginSubmissions,
          onGradePluginSubmission: handleGradePluginSubmission,
        }}
        studentMonitorProps={{
          liveClassSelectedClassId,
          students,
          onlineStudentIds,
          liveClassAcknowledgedMap,
          activeStudentLessons,
          liveClassStudentProgress,
          timelineSegments,
          activeSegmentId,
          studentErrors,
          hoveredStudentId,
          setHoveredStudentId,
          pinnedStudentId,
          setPinnedStudentId,
          selectedDrawStudentIds,
          activeDrawStudentId,
          isDrawing,
          onRandomPick: handleRandomPick,
          onPingStudent,
          addToast,
          onOverrideSegmentGate: handleOverrideSegmentGate,
          onToggleStudentLock: handleToggleStudentLock,
          isFeedCollapsed,
          setIsFeedCollapsed,
          liveClassFeed,
          setLiveClassFeed,
        }}
      />

      {selectedAttempt && (
        <LiveClassroomSubmissionRawModal
          lang={lang}
          selectedAttempt={selectedAttempt}
          loadingRaw={loadingRaw}
          rawPayload={rawPayload}
          onClose={() => setSelectedAttempt(null)}
        />
      )}

      {/* ── 课堂模态框宿主（6 个弹窗的编排已抽出，见 components/classroom/ClassroomModalsHost.tsx） ── */}
      <ClassroomModalsHost
        lang={lang as 'zh' | 'en'}
        addToast={addToast}
        selectedLesson={selectedLesson}
        lessonTitle={lessons.find((l) => l.id === selectedLesson)?.title ?? ''}
        className={classes.find((c) => c.id === liveClassSelectedClassId)?.name ?? ''}
        liveClassSelectedClassId={liveClassSelectedClassId}
        classroomStage={classroomStage}
        sessionStartedAt={sessionStartedAt}
        students={students}
        liveData={liveData}
        isGrowthProfileOpen={isGrowthProfileOpen}
        onCloseGrowthProfile={() => {
          setIsGrowthProfileOpen(false);
          setGrowthProfileStudentId(null);
        }}
        growthProfileStudentId={growthProfileStudentId}
        isPeerReviewShowcaseOpen={isPeerReviewShowcaseOpen}
        onClosePeerReviewShowcase={() => setIsPeerReviewShowcaseOpen(false)}
        onAdvanceToStage3={() => handleStageChange('WRAP_UP_EXIT_TICKET')}
        peerReviewData={peerReviewData as never}
        showcaseWorks={showcaseWorks}
        onSelectSpotlightWork={setSpotlightWork}
        onAutoAssignPeerReview={handleAutoAssignPeerReview}
        autoAssigning={autoAssigning}
        isParentNotificationOpen={isParentNotificationOpen}
        onCloseParentNotification={() => setIsParentNotificationOpen(false)}
        isMasteryPredictionOpen={isMasteryPredictionOpen}
        onCloseMasteryPrediction={() => setIsMasteryPredictionOpen(false)}
        isDiagnosticCenterOpen={isDiagnosticCenterOpen}
        onCloseDiagnosticCenter={() => setIsDiagnosticCenterOpen(false)}
        isGroupCollabOpen={isGroupCollabOpen}
        onCloseGroupCollab={() => {
          setIsGroupCollabOpen(false);
          setCollabInitialGalleryMode(false);
        }}
        syncChannel={syncChannelRef.current}
        collabInitialGalleryMode={collabInitialGalleryMode}
        isShowcaseDiffOpen={isShowcaseDiffOpen}
        onCloseShowcaseDiff={() => setIsShowcaseDiffOpen(false)}
        showcaseCandidateWorks={showcaseCandidateWorks}
        onSyncShowcaseDiffToClass={handleSyncShowcaseDiffToClass}
        isMacroRunnerOpen={isMacroRunnerOpen}
        onCloseMacroRunner={() => setIsMacroRunnerOpen(false)}
        isHardwareSettingsOpen={isHardwareSettingsOpen}
        onCloseHardwareSettings={() => setIsHardwareSettingsOpen(false)}
      />

      {isSwitchLessonConfirmOpen && (
        <LiveClassroomSwitchLessonModal
          lang={lang}
          lessons={lessons}
          selectedLesson={selectedLesson}
          pendingLessonId={pendingLessonId}
          setPendingLessonId={setPendingLessonId}
          setSelectedLesson={setSelectedLesson}
          fetchElements={fetchElements}
          addToast={addToast}
          onClose={() => setIsSwitchLessonConfirmOpen(false)}
        />
      )}

      {/* 课中快捷设置工作台侧滑抽屉 */}
      <ClassroomInContextDrawer />
    </div>
  );
}
