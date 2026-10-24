import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Play,
  Square,
  Pause,
  Users,
  Presentation,
  Clock,
  Shuffle,
  CheckCircle2,
  XCircle,
  Shield,
  ShieldAlert,
  Check,
  RefreshCw,
  Send,
  HelpCircle,
  Activity,
  ChevronLeft,
  ChevronRight,
  Eye,
  FileText,
  Database,
  Award,
  Search,
  ExternalLink,
  Sparkles,
  AlertTriangle,
  Trophy,
  Edit3,
  LayoutGrid,
  Plus,
  ChevronDown,
  Radio,
  School,
  ArrowLeftRight,
  AlertCircle,
  ArrowDown,
  MessageSquare,
  Trash2,
  Zap,
  Unlock,
  Pin,
  X,
  Lock,
  FileEdit,
} from 'lucide-react';
import type { LockMode } from '../types/app';
import * as Icons from 'lucide-react';
import { useAppStore, appStore } from '../store/appStore';
import { uiStore } from '../store/uiStore';
import { liveClassStore } from '../store/liveClassStore';
import { useAppData } from '../context/AppDataContext';
import { LazyWhiteboard } from '../components/LazyWhiteboard';
import { listFromEnvelope } from '../utils/listEnvelope.js';
import type { WhiteboardPageItem, WhiteboardHandle } from '../features/whiteboard/InteractiveWhiteboard';
import { TeacherAssignmentGradePanel } from './TeacherAssignmentGradePanel';
import { TopPerformersWidget } from '../features/teacher/TopPerformersWidget';
import { resolvePluginCommandType } from '../../packages/core/plugin-host/plugin-namespace';
import { ExtensionPointRenderer } from '../plugin-host/extension-point-renderer';
import { useOptionalPluginHost } from '../plugin-host/plugin-host-context';
import { ClassroomSyncChannel, CLASSROOM_SYNC_CHANNEL_NAME } from '../services/classroom-sync-channel';
import { getOptionalSocket, onSocketInstance } from '../services/socket-service';
import { useErrorStore, errorStore } from '../store/errorStore';
import { ClassroomInteractiveCockpit } from '../features/classroom/ClassroomInteractiveCockpit';
import { PreClassReadyView } from '../features/classroom/PreClassReadyView';
import { ClassroomEntryPortal } from '../features/classroom/ClassroomEntryPortal';
import { ClassroomSessionManager, type ClassroomSessionItem } from '../features/classroom/ClassroomSessionManager';
import { InProgressSessionList } from '../features/classroom/InProgressSessionList';
import { readRememberedActiveLesson, rememberActiveLesson } from '../features/classroom/live-class-resume-memory';
import { PostClassWrapupView } from '../features/classroom/PostClassWrapupView';
import { ClassroomBriefingView } from '../features/classroom/ClassroomBriefingView';
import { ClassroomCountdownWidget } from '../features/classroom/ClassroomCountdownWidget';
import { useClassroomLiveData } from '../features/classroom/hooks/useClassroomLiveData';
import { resolveSegmentDuration } from '../utils/timeline-duration';
import { ClassroomModalsHost } from './classroom/ClassroomModalsHost';
import { usePeerReviewData } from '../features/classroom/hooks/usePeerReviewData';
import { EdgeLanStatusIndicator } from '../features/classroom/ecosystem';

import { ClassroomToolbarQuickActions } from '../features/classroom/ClassroomToolbarQuickActions';
import { classLockHint, isInProgressClassLocked } from '../features/classroom/class-session-lock';
import {
  LiveSubmissionsPanel,
  FINISHED_STATUSES,
  IN_PROGRESS_STATUSES,
} from '../features/classroom/LiveSubmissionsPanel';
export { FINISHED_STATUSES, IN_PROGRESS_STATUSES };

// Dynamic Icon component to render Lucide icons by name string
function DynamicIcon({ name, ...props }: { name: string; [key: string]: any }) {
  const IconComponent = (Icons as any)[name];
  if (!IconComponent) return <HelpCircle {...props} />;
  return React.createElement(IconComponent, props);
}

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
    session,
    showCoursewareHub,
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
  const [lockingClass, setLockingClass] = useState(false);
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

  // Random drawing states
  const [isDrawing, setIsDrawing] = useState(false);
  const [activeDrawStudentId, setActiveDrawStudentId] = useState<string | null>(null);
  const [selectedDrawStudentIds, setSelectedDrawStudentIds] = useState<string[]>([]);

  // R-8：旧每秒定时器已删，timerRef 一并移除；prevTimerRunningRef 供
  // onTimeRemainingChange 回调识别 running→false 转换（触发「时间到」toast）
  const prevTimerRunningRef = useRef(false);
  const lastAutoLockedRef = useRef<{ lesson: string | null; classId: string | null }>({
    lesson: null,
    classId: null,
  });

  // Student Pop-up Window & Real-time Sync Channel
  const studentWindowRef = useRef<Window | null>(null);
  const studentWindowCheckIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [isStudentWindowOpen, setIsStudentWindowOpen] = useState(false);
  const syncChannelRef = useRef<ClassroomSyncChannel | null>(null);
  /** 环节切换回写 view-state 的防抖定时器 */
  const segWriteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drawTickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drawRecoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [liveClassFullscreenElementId, setLiveClassFullscreenElementId] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (studentWindowCheckIntervalRef.current) clearInterval(studentWindowCheckIntervalRef.current);
      if (segWriteTimerRef.current) clearTimeout(segWriteTimerRef.current);
      if (drawTickTimerRef.current) clearTimeout(drawTickTimerRef.current);
      if (drawRecoverTimerRef.current) clearTimeout(drawRecoverTimerRef.current);
    };
  }, []);

  // Whiteboard outline & page states in LiveClassroom
  const whiteboardRef = useRef<WhiteboardHandle | null>(null);
  const [whiteboardPages, setWhiteboardPages] = useState<WhiteboardPageItem[]>([]);
  const [currentWhiteboardPage, setCurrentWhiteboardPage] = useState<number>(0);
  const [isOutlineCollapsed, setIsOutlineCollapsed] = useState(false);

  // Classroom workflow stages: PRE_CLASS_READY, IN_CLASS_TEACHING, WRAP_UP_EXIT_TICKET, ARCHIVED_REPORT
  const [classroomStage, setClassroomStage] = useState<string>('PRE_CLASS_READY');
  /** 指定查看某场历史会话战报时的 sessionId（null = 默认最新会话） */
  const [reportSessionId, setReportSessionId] = useState<string | null>(null);
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
  const [isShowcaseDiffOpen, setIsShowcaseDiffOpen] = useState(false);
  const [isMacroRunnerOpen, setIsMacroRunnerOpen] = useState(false);
  const [isHardwareSettingsOpen, setIsHardwareSettingsOpen] = useState(false);
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
  /** 真实课件作答记录（用于成绩/完成度/行为标签派生） */
  const [attempts, setAttempts] = useState<any[]>([]);

  // 轮询课堂会话：真实 stage + 真实开课时间（驱动 elapsedMin / AI 预测 / 家校通知）
  useEffect(() => {
    if (!selectedLesson) {
      setClassroomStage('PRE_CLASS_READY');
      setSessionStartedAt(null);
      setEntryDecisionReady(true);
      return;
    }
    let mounted = true;
    if (!userReturnedToPortalRef.current) {
      setEntryDecisionReady(false);
    }
    // 若当前正在定点查看某场历史会话战报，不重置为 PRE_CLASS_READY
    if (!viewingSpecificReportRef.current) {
      setClassroomStage('PRE_CLASS_READY');
    }
    const fetchSession = () => {
      fetch(`/api/classroom/sessions/${selectedLesson}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (!mounted) return;
          if (!data) return;
          setHasActiveSession(Boolean(data.hasActiveSession));
          if (viewingSpecificReportRef.current) {
            setClassroomStage('ARCHIVED_REPORT');
          } else if (data.hasActiveSession && data.stage) {
            setClassroomStage(data.stage);
          } else if (data.stage === 'ARCHIVED_REPORT') {
            setClassroomStage('ARCHIVED_REPORT');
          } else {
            setClassroomStage((prev) => (prev === 'ARCHIVED_REPORT' ? 'ARCHIVED_REPORT' : 'PRE_CLASS_READY'));
          }
          const sessionClassId = data.session?.class_id ? String(data.session.class_id) : null;
          const classLocked = Boolean(data.hasActiveSession) && isInProgressClassLocked(data.stage);
          // 刷新 / ?classId= 不能改掉进行中会话的班级。URL 上的 classId 故意不读取。
          // Issue #91：不再直接跳进授课视图，改为先把「进行中的会话」交还给教师选择。
          if (classLocked && !userReturnedToPortalRef.current && !enteredClassroomRef.current) {
            setShowEntryPortal(false);
            setShowSessionPicker(true);
          }
          const currentClassId = appStore.getState().liveClassSelectedClassId;
          if (classLocked && sessionClassId && currentClassId !== sessionClassId) {
            setLiveClassSelectedClassId(sessionClassId);
          } else if (!classLocked && sessionClassId && !currentClassId) {
            setLiveClassSelectedClassId(sessionClassId);
          }
          // started_at 来自真实会话行；无会话时为 null（elapsedMin 随之归 0，不编造）
          const startedAt = data.session?.started_at ?? data.startedAt ?? null;
          setSessionStartedAt(typeof startedAt === 'number' ? startedAt : null);

          // ── 会话恢复（课堂会话保存与恢复）──────────────────────────
          // 1) 动态流回放：服务端 classroom_feed 落库数据预填（按 id 去重，
          //    不覆盖本地已积累的实时条目）；仅首次拉到非空回放时写入。
          if (Array.isArray(data.feedReplay) && data.feedReplay.length > 0) {
            setLiveClassFeed((prev) => {
              const seen = new Set(prev.map((f: any) => f?.id).filter(Boolean));
              const missing = data.feedReplay.filter((f: any) => !seen.has(f.id));
              return missing.length > 0 ? [...missing, ...prev] : prev;
            });
          }
          // 2) 当前教学环节：激活休眠列 current_segment_id（本地未选环节时才恢复）
          const persistedSegmentId = data.session?.current_segment_id ?? null;
          if (persistedSegmentId && !activeSegmentId) {
            setActiveSegmentId(persistedSegmentId);
          }
          // 3) 当前白板页：经 initialPage 传给白板（挂载后一次性跳转）
          const restoredPage = Number(data.viewState?.currentPage);
          if (Number.isFinite(restoredPage) && restoredPage > 0) {
            setRestoredCurrentPage(restoredPage);
          }
        })
        .catch(() => {})
        .finally(() => {
          if (mounted) setEntryDecisionReady(true);
        });
    };
    fetchSession();
    const timer = setInterval(fetchSession, 15000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [selectedLesson]);

  // Issue #243：归因弹窗「今日抽中 N 次」改为真实计数 —— 手动抽问与白板
  // rollcall 写侧早已落库 student_rollcalls，此处按会话轮询同节奏（15s）
  // 拉取按日聚合，抽问后计数随之增长。
  const [rollcallCounts, setRollcallCounts] = React.useState<Map<string, number>>(new Map());
  React.useEffect(() => {
    if (!selectedLesson) {
      setRollcallCounts(new Map());
      return;
    }
    let mounted = true;
    const fetchCounts = () => {
      fetch(`/api/lessons/${selectedLesson}/rollcall-counts`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (!mounted || !data?.counts) return;
          setRollcallCounts(new Map(Object.entries(data.counts as Record<string, number>)));
        })
        .catch(() => {});
    };
    fetchCounts();
    const timer = setInterval(fetchCounts, 15000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [selectedLesson]);

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
    enabled: isPeerReviewShowcaseOpen,
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

  // Interactive courseware submission states
  const [middleTab, setMiddleTab] = useState<
    'whiteboard' | 'submissions' | 'assignment' | 'top_performers' | 'segment_main'
  >('whiteboard');
  const host = useOptionalPluginHost();
  const segmentMainExtensions = host?.getExtensions('classroom.active_segment.main') || [];
  const hasSegmentMainExtension = segmentMainExtensions.length > 0;
  const currentActiveSegment = timelineSegments.find((s) => s.id === activeSegmentId);
  const [loadingAttempts, setLoadingAttempts] = useState(false);
  const [selectedAttempt, setSelectedAttempt] = useState<any | null>(null);
  const [rawPayload, setRawPayload] = useState<any | null>(null);
  const [loadingRaw, setLoadingRaw] = useState(false);
  const [submissionFilter, setSubmissionFilter] = useState<'all' | 'submitted' | 'started'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // ── 自动录入成绩规则（可在 UI 中开关与调整门槛/更新策略） ──────────────
  const [autoRecordRule, setAutoRecordRule] = useState<{
    enabled: boolean;
    minCompletion: number;
    strategy: 'latest' | 'highest';
  }>({
    enabled: false,
    minCompletion: 0,
    strategy: 'latest',
  });
  const [autoRecordRuleLoaded, setAutoRecordRuleLoaded] = useState(false);
  const [savingAutoRecordRule, setSavingAutoRecordRule] = useState(false);
  const [autoRecordReport, setAutoRecordReport] = useState<{ recorded: number; skipped: number } | null>(null);
  const [autoRecordRunning, setAutoRecordRunning] = useState(false);

  /**
   * 稳定化 addToast。
   * addToast 是 App 每次渲染重建的普通函数，若直接进 useCallback 依赖，
   * runAutoRecord 就会每次渲染都变 → 触发下方 effect 重跑 → setState → 再次渲染，
   * 形成无限循环（这正是本仓库其他模块用 addToastRef 的原因）。
   */
  const addToastRef = useRef(addToast);
  useEffect(() => {
    addToastRef.current = addToast;
  }, [addToast]);
  const stableAddToast = useCallback(
    (title: string, message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info') =>
      addToastRef.current(title, message, type),
    [],
  );

  // 稳定化：内部只用 setState（引用恒定），可安全作为 useCallback 依赖，
  // 否则会连带让 runAutoRecord 每次渲染重建。
  const fetchAttempts = useCallback(async () => {
    setLoadingAttempts(true);
    try {
      const res = await fetch('/api/courseware/attempts?pageSize=all');
      if (res.ok) {
        const data = listFromEnvelope<any>(await res.json());
        setAttempts(data);
      }
    } catch (e) {
      console.error('Failed to fetch attempts', e);
    } finally {
      setLoadingAttempts(false);
    }
  }, []);

  useEffect(() => {
    if (middleTab === 'submissions') {
      fetchAttempts();
    }
  }, [middleTab]);

  useEffect(() => {
    // v0.6.1 审计：同一裸 `io()` 模式顺带修复 —— 该事件是全局广播
    // （event-routing rooms: null），裸连接碰巧能收到，但每挂载多维持
    // 一条冗余连接；统一挂主 socket。
    let detach: (() => void) | null = null;
    const off = onSocketInstance((socket) => {
      detach?.();
      const handler = () => {
        fetchAttempts();
      };
      socket.on('courseware-attempt-updated', handler);
      detach = () => {
        if (typeof socket.off === 'function') socket.off('courseware-attempt-updated', handler);
      };
    });
    return () => {
      off();
      detach?.();
    };
  }, [fetchAttempts]);

  const handlePromoteAttempt = async (attemptId: string) => {
    if (!selectedLesson || !liveClassSelectedClassId) {
      addToast(
        lang === 'zh' ? '⚠️ 无法操作' : '⚠️ Action Prevented',
        lang === 'zh' ? '请先在顶部栏选择要绑定的课节和班级。' : 'Please select lesson and class first.',
        'warning',
      );
      return;
    }
    try {
      const res = await fetch(`/api/courseware/attempts/${attemptId}/promote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lessonId: selectedLesson,
          classId: liveClassSelectedClassId,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        addToast(
          lang === 'zh' ? '✓ 学习数据已保存' : '✓ Data Recorded',
          lang === 'zh'
            ? `成功将该数据存入数据库！分数: ${data.score}，已同步更新至学生学习进度。`
            : `Successfully recorded submission! Score: ${data.score}.`,
          'success',
        );
        fetchAttempts();
        if (fetchStudents) {
          fetchStudents();
        }
      } else {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Server error');
      }
    } catch (err: any) {
      addToast(
        lang === 'zh' ? '❌ 保存失败' : '❌ Save Failed',
        err.message || 'Error occurred while saving.',
        'warning',
      );
    }
  };

  /** 教师把该学生该课件标记为缺考（写入 status='absent' 成绩行，学期结算按 0 分计） */
  const handleMarkAbsent = async (studentId: string, coursewareId: string | undefined) => {
    if (!selectedLesson || !liveClassSelectedClassId) {
      addToast(
        lang === 'zh' ? '⚠️ 无法操作' : '⚠️ Action Prevented',
        lang === 'zh' ? '请先在顶部栏选择要绑定的课节和班级。' : 'Please select lesson and class first.',
        'warning',
      );
      return;
    }
    if (!coursewareId) {
      addToast(
        lang === 'zh' ? '⚠️ 无法标记缺考' : '⚠️ Cannot Mark Absent',
        lang === 'zh' ? '该提交缺少课件标识。' : 'Missing courseware identity.',
        'warning',
      );
      return;
    }
    try {
      const res = await fetch('/api/courseware/attempts/mark-absent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lessonId: selectedLesson,
          classId: liveClassSelectedClassId,
          studentId,
          coursewareId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        addToast(
          lang === 'zh' ? '✓ 已标记缺考' : '✓ Marked Absent',
          lang === 'zh'
            ? `已将【${data.coursewareName ?? '该课件'}】成绩标记为缺考（结算按 0 分计）。学生补交不会自动覆盖，教师改判请手动录入。`
            : `Marked as absent for ${data.coursewareName ?? 'the courseware'}. Manual recording overrides this.`,
          'success',
        );
        fetchAttempts();
        if (fetchStudents) {
          fetchStudents();
        }
      } else {
        throw new Error(data.error || 'Server error');
      }
    } catch (err: any) {
      addToast(
        lang === 'zh' ? '❌ 标记缺考失败' : '❌ Mark Absent Failed',
        err.message || 'Error occurred while marking absent.',
        'warning',
      );
    }
  };

  // ── 自动录入规则：读取（全局默认行 '*'）与保存 ────────────────────────
  const loadAutoRecordRule = useCallback(async () => {
    try {
      const res = await fetch('/api/commands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // /api/commands 的契约是 { commandType, payload }，响应为 { success, result }。
        // 用 type 而非 commandType 会得到 HTTP 500「No handler registered for command: undefined」。
        body: JSON.stringify({ commandType: 'courseware.get_score_config', payload: { coursewareId: '*' } }),
      });
      if (!res.ok) return;
      const json = await res.json();
      const config = json?.result ?? json;
      setAutoRecordRule({
        enabled: Boolean(config?.auto_record_enabled ?? config?.autoRecordEnabled),
        minCompletion: Number(config?.auto_record_min_completion ?? config?.autoRecordMinCompletion ?? 0) || 0,
        strategy:
          config?.auto_record_strategy === 'highest' || config?.autoRecordStrategy === 'highest' ? 'highest' : 'latest',
      });
    } catch {
      // 静默：规则读取失败不应阻断页面
    } finally {
      setAutoRecordRuleLoaded(true);
    }
  }, []);

  const saveAutoRecordRule = async (next: {
    enabled: boolean;
    minCompletion: number;
    strategy: 'latest' | 'highest';
  }) => {
    const previous = autoRecordRule;
    setAutoRecordRule(next); // 乐观更新，失败时回滚
    setSavingAutoRecordRule(true);
    try {
      const res = await fetch('/api/commands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          commandType: 'courseware.save_score_config',
          payload: {
            coursewareId: '*',
            autoRecordEnabled: next.enabled,
            autoRecordMinCompletion: next.minCompletion,
            autoRecordStrategy: next.strategy,
          },
        }),
      });
      if (!res.ok) throw new Error('Failed to save rule');
      const json = await res.json();
      if (json && json.success === false) throw new Error(json.error || 'save_score_config rejected');
      stableAddToast(
        lang === 'zh' ? '✓ 规则已保存' : '✓ Rule Saved',
        next.enabled
          ? lang === 'zh'
            ? `学生提交课件后将自动录入学期成绩（完成度门槛 ${Math.round(next.minCompletion * 100)}%）`
            : `Scores will be recorded automatically (completion ≥ ${Math.round(next.minCompletion * 100)}%)`
          : lang === 'zh'
            ? '已关闭自动录入，仍可逐条手动录入'
            : 'Auto-record disabled; manual recording still available',
        'success',
      );
    } catch (e) {
      setAutoRecordRule(previous);
      console.error('[LiveClassroomView] save auto-record rule failed:', e);
      stableAddToast(
        lang === 'zh' ? '❌ 规则保存失败' : '❌ Failed to save rule',
        lang === 'zh' ? '请检查网络后重试。' : 'Please retry.',
        'warning',
      );
    } finally {
      setSavingAutoRecordRule(false);
    }
  };

  /** 批量补录：把本课节本班已提交但未录入的记录按规则补录（幂等） */
  const runAutoRecord = useCallback(
    async (silent = false) => {
      if (!selectedLesson || !liveClassSelectedClassId) return;
      setAutoRecordRunning(true);
      try {
        const res = await fetch('/api/courseware/attempts/auto-record', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lessonId: selectedLesson, classId: liveClassSelectedClassId }),
        });
        if (!res.ok) throw new Error('auto-record failed');
        const data = await res.json();
        setAutoRecordReport({ recorded: data.recorded ?? 0, skipped: data.skipped ?? 0 });
        if ((data.recorded ?? 0) > 0) {
          await fetchAttempts();
        }
        if (!silent) {
          stableAddToast(
            lang === 'zh' ? '✓ 自动录入完成' : '✓ Auto-record done',
            lang === 'zh'
              ? `已录入 ${data.recorded ?? 0} 条，跳过 ${data.skipped ?? 0} 条（已录入 / 无分数 / 未达门槛）`
              : `Recorded ${data.recorded ?? 0}, skipped ${data.skipped ?? 0}`,
            'success',
          );
        }
      } catch (e) {
        if (!silent) {
          stableAddToast(
            lang === 'zh' ? '❌ 自动录入失败' : '❌ Auto-record failed',
            lang === 'zh' ? '请稍后重试，或使用逐条手动录入。' : 'Please retry or record manually.',
            'warning',
          );
        }
      } finally {
        setAutoRecordRunning(false);
      }
    },
    [selectedLesson, liveClassSelectedClassId, fetchAttempts, stableAddToast, lang],
  );

  const handleViewRaw = async (attempt: any) => {
    setSelectedAttempt(attempt);
    setLoadingRaw(true);
    setRawPayload(null);
    try {
      const res = await fetch(`/api/courseware/attempts/${attempt.attemptId}/raw`);
      if (res.ok) {
        const data = await res.json();
        setRawPayload(data);
      } else {
        setRawPayload({ error: 'Failed to load raw data' });
      }
    } catch (e: any) {
      setRawPayload({ error: e.message || 'Error loading data' });
    } finally {
      setLoadingRaw(false);
    }
  };

  // Find if class-wide locking is active and its primary mode
  const lockedStudents = students.filter((s) => s.locked_lesson_id === selectedLesson);
  const isClassLocked = !!(liveClassSelectedClassId && lockedStudents.length > 0);
  const classLockMode: LockMode =
    lockedStudents.some((s) => s.lock_mode === 'navigation') && !lockedStudents.some((s) => s.lock_mode === 'full')
      ? 'navigation'
      : 'full';

  // 规则读取：进入「学生提交数据」页时拉一次（教师/管理员才有可配置权限）
  useEffect(() => {
    if (middleTab !== 'submissions') return;
    void loadAutoRecordRule();
  }, [middleTab, loadAutoRecordRule]);

  /**
   * 打开页面时自动补录：把历史上「已提交但未录入」的记录按当前规则补上。
   * 只在规则开启时跑（runAutoRecord 内部与服务端都会再判一次，幂等安全）。
   * 依赖刻意不含 autoRecordRule —— 避免规则开关本身触发补录循环；
   * 教师改完规则可点「立即补录」显式重跑。
   */
  useEffect(() => {
    if (middleTab !== 'submissions' || !autoRecordRuleLoaded || !autoRecordRule.enabled) return;
    if (!selectedLesson || !liveClassSelectedClassId) return;
    void runAutoRecord(true);
  }, [middleTab, autoRecordRuleLoaded, selectedLesson, liveClassSelectedClassId, runAutoRecord]);

  // ── 跨浏览器Tab学生端同步信道机制 ───────────────────────────────────────
  const handleOpenStudentWindow = () => {
    // If student tab is already opened and not closed, focus it
    if (studentWindowRef.current && !studentWindowRef.current.closed) {
      studentWindowRef.current.focus();
      addToast(
        lang === 'zh' ? '🎓 学生Tab已激活' : '🎓 Student Tab Focused',
        lang === 'zh' ? '已将联动学生端浏览器Tab置顶激活。' : 'Focused the student browser tab.',
        'info',
      );
      return;
    }

    const targetStudent = students[0];
    const targetStudentId = targetStudent?.id || 'student-demo';
    const targetStudentName = targetStudent?.name || (lang === 'zh' ? '演示学生' : 'Demo Student');
    const lessonParam = selectedLesson || '';
    const classParam = liveClassSelectedClassId || '';

    const studentUrl = `${window.location.origin}${window.location.pathname}?mode=student_live&studentId=${encodeURIComponent(targetStudentId)}&lessonId=${encodeURIComponent(lessonParam)}&classId=${encodeURIComponent(classParam)}#/student_live`;

    // 打开独立浏览器Tab页面（不传入宽高特性参数，由浏览器作为标准标签页打开，便于左右分屏或双屏排布）
    const studentTab = window.open(studentUrl, '_blank');

    if (!studentTab || studentTab.closed) {
      addToast(
        lang === 'zh' ? '⚠️ 新Tab打开被拦截' : '⚠️ Tab Open Blocked',
        lang === 'zh'
          ? '请在浏览器设置中允许打开新标签页，以查看联动学生端。'
          : 'Please allow new tabs in browser settings.',
        'warning',
      );
      return;
    }

    studentWindowRef.current = studentTab;
    setIsStudentWindowOpen(true);

    if (studentWindowCheckIntervalRef.current) {
      clearInterval(studentWindowCheckIntervalRef.current);
    }
    studentWindowCheckIntervalRef.current = setInterval(() => {
      if (!studentWindowRef.current || studentWindowRef.current.closed) {
        setIsStudentWindowOpen(false);
        studentWindowRef.current = null;
        if (studentWindowCheckIntervalRef.current) {
          clearInterval(studentWindowCheckIntervalRef.current);
          studentWindowCheckIntervalRef.current = null;
        }
      }
    }, 1000);

    addToast(
      lang === 'zh' ? '🎓 学生端新Tab已打开' : '🎓 Student Tab Opened',
      lang === 'zh'
        ? `已在独立浏览器Tab中打开【${targetStudentName}】学生端，教师端所有操作将实时同步！`
        : `Opened student tab for ${targetStudentName}. Operations are syncing in real time!`,
      'success',
    );
  };

  // v0.6.1 审计 R-1：同步信道只随「房间身份」（课节+班级）销毁重建。
  // 此前 effect 依赖含 liveClassTimeRemaining（倒计时每秒变化）与 students
  // （2s 轮询换引用）——课中每秒 destroy + 重建 BroadcastChannel 并重绑
  // socket，摧毁窗口内的广播静默丢失。快照类状态改经 ref 在处理时读取；
  // 它们的变更广播由下方独立的 Reactive state broadcasts effects 承担。
  const syncSnapshotRef = useRef({
    selectedLesson,
    activeSegmentId,
    middleTab,
    isClassLocked,
    // R-8：计时已迁至 liveClassStore，快照按需在处理时实时读取（下方 handler
    // 用 getter），不再经 context 传入
    liveClassSelectedClassId,
    liveClassIsActive,
    students,
    lang,
  });
  syncSnapshotRef.current = {
    selectedLesson,
    activeSegmentId,
    middleTab,
    isClassLocked,
    liveClassSelectedClassId,
    liveClassIsActive,
    students,
    lang,
  };

  useEffect(() => {
    const channel = new ClassroomSyncChannel(CLASSROOM_SYNC_CHANNEL_NAME, selectedLesson, liveClassSelectedClassId);
    syncChannelRef.current = channel;

    // v0.6.1 审计 N-2：STUDENT_HANDSHAKE_REQUEST/TEACHER_INIT_STATE 死协议已
    // 移除（发送方 requestHandshake 与消费方均不存在，恢复机制由服务端
    // 持久化视图状态承担）；本监听只保留仍然存活的点名应答。
    const unsub = channel.onMessage((msg) => {
      if (msg.type === 'STUDENT_ACKNOWLEDGE_PICK') {
        const studentId = msg.payload.studentId;
        const studentName = syncSnapshotRef.current.students.find((s) => s.id === studentId)?.name || studentId;
        setLiveClassAcknowledgedMap((prev) => {
          const next = new Map(prev);
          next.set(studentId, true);
          return next;
        });
        setLiveClassFeed((prev) => [
          {
            id: `feed-ack-${studentId}-${Date.now()}`,
            time: new Date().toLocaleTimeString(),
            type: 'checkin',
            message:
              syncSnapshotRef.current.lang === 'zh'
                ? `学生【${studentName}】已在独立视窗中确认点名并举手答到！`
                : `Student "${studentName}" acknowledged classroom pick from student window!`,
          },
          ...prev,
        ]);
        addToast(
          syncSnapshotRef.current.lang === 'zh' ? '🙋‍♂️ 学生已举手应答' : '🙋‍♂️ Student Acknowledged',
          syncSnapshotRef.current.lang === 'zh'
            ? `学生【${studentName}】已在独立视窗中确认收到点名！`
            : `Student "${studentName}" acknowledged!`,
          'success',
        );
      }
    });

    return () => {
      unsub();
      channel.destroy();
      syncChannelRef.current = null;
    };
  }, [selectedLesson, liveClassSelectedClassId]);

  // Reactive state broadcasts
  useEffect(() => {
    syncChannelRef.current?.setLessonContext(selectedLesson, liveClassSelectedClassId);
    syncChannelRef.current?.broadcastChangeLesson(selectedLesson);
  }, [selectedLesson, liveClassSelectedClassId]);

  useEffect(() => {
    syncChannelRef.current?.broadcastChangeSegment(activeSegmentId);
    // 会话保存：环节切换防抖回写（恢复协议的 activeSegmentId 来源）
    // 仅在**确有进行中会话**时回写：无会话时该端点按契约返回 404，
    // 回写只会平白刷出控制台错误（见 hasActiveSession 声明处的说明）。
    if (selectedLesson && hasActiveSession && segWriteTimerRef.current) clearTimeout(segWriteTimerRef.current);
    if (selectedLesson && hasActiveSession) {
      segWriteTimerRef.current = setTimeout(() => {
        fetch(`/api/classroom/sessions/${encodeURIComponent(selectedLesson)}/view-state`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ activeSegmentId: activeSegmentId }),
        }).catch(() => {});
      }, 500);
    }
  }, [activeSegmentId, selectedLesson, hasActiveSession]);

  // 服务端课堂动态流（classroom_feed 落库后广播）：实时追加，与本地事件同池渲染。
  // v0.6.1 审计 C-1 修复：此前用裸 `io()` 新建独立连接且从不 join-room ——
  // 服务端只把该事件投递到课节 + 班级房间，这条监听 100% 收不到
  // （实时通道死链，仅剩 15s 轮询兜底）。现挂到主 socket
  // （useClassroomSocket 已加入 lesson / 班级房间），经 onSocketInstance
  // 处理「socket 晚于本组件诞生」的时序。
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

  useEffect(() => {
    syncChannelRef.current?.broadcastChangeTab(
      middleTab === 'submissions' || middleTab === 'top_performers' || middleTab === 'segment_main'
        ? 'courseware'
        : middleTab,
    );
  }, [middleTab]);

  useEffect(() => {
    syncChannelRef.current?.broadcastLockClass(isClassLocked);
  }, [isClassLocked]);

  // broadcastSyncTimer 已并入 onTimeRemainingChange 回调（见工具栏接线）——
  // 计时值现住在 liveClassStore，本组件不再订阅，秒级变化不再触发全树重渲染。

  // Extract classroomTools from active plugins (supporting legacy and modern contributes['classroom.tool'])
  const activePlugins = plugins.filter((p) => p.status === 'active');
  const classroomTools = Array.from(
    new Map(
      activePlugins
        .flatMap((p) => {
          try {
            const manifestObj = typeof p.manifest === 'string' ? JSON.parse(p.manifest) : p.manifest;
            const legacyTools = manifestObj.classroomTools || [];
            const modernTools = manifestObj.contributes?.['classroom.tool'] || [];
            return [...legacyTools, ...modernTools].map((t: any) => ({
              ...t,
              pluginId: p.id,
              manifestId: manifestObj.id,
            }));
          } catch (e) {
            return [];
          }
        })
        .map((t) => [t.id, t]), // last-wins dedup by tool id across all plugins
    ).values(),
  );

  // Countdown timer effect
  // v0.6.1 审计 R-8/N-1：此旧的每秒自减定时器已删除 —— 计时的唯一写点是
  // ClassroomCountdownWidget 的 endsAt 校准 tick（经 onTimeRemainingChange
  // 写 liveClassStore，见下方工具栏接线），「时间到」toast 与学生端广播
  // 也在该回调内完成。liveClassTimeRemaining 移出 AppDataContext 后，
  // 每秒一次的状态变化不再引发本组件（2754 行）及其消费树整体重渲染。

  // Auto-lock class when selection changes
  useEffect(() => {
    if (!selectedLesson || !liveClassSelectedClassId) {
      lastAutoLockedRef.current = { lesson: null, classId: null };
      return;
    }

    if (
      lastAutoLockedRef.current.lesson !== selectedLesson ||
      lastAutoLockedRef.current.classId !== liveClassSelectedClassId
    ) {
      lastAutoLockedRef.current = { lesson: selectedLesson, classId: liveClassSelectedClassId };
      handleToggleClassLock(true);
    }
  }, [selectedLesson, liveClassSelectedClassId]);

  const handleStartSegment = (seg: any) => {
    setActiveSegmentId(seg.id);
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

  // Lock entire class with mode support ('full' | 'navigation')
  const handleToggleClassLock = async (lock: boolean, mode: 'full' | 'navigation' = 'full') => {
    if (!liveClassSelectedClassId || !selectedLesson) {
      addToast(
        lang === 'zh' ? '⚠️ 无法操作' : '⚠️ Action Prevented',
        lang === 'zh' ? '请先选择需要授课的课节及班级。' : 'Please select a lesson and class first.',
        'warning',
      );
      return;
    }

    setLockingClass(true);
    try {
      const endpoint = lock
        ? `/api/classes/${liveClassSelectedClassId}/lock_lesson`
        : `/api/classes/${liveClassSelectedClassId}/unlock_lesson`;

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: lock ? JSON.stringify({ lessonId: selectedLesson, mode }) : undefined,
      });

      if (res.ok) {
        await fetchStudents();
        const isAnswer = mode === 'navigation';
        setLiveClassFeed((prev) => [
          {
            id: Math.random().toString(),
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            type: lock ? 'warning' : 'info',
            message: lock
              ? isAnswer
                ? `已对全班学生开启答题锁定（放开作答，限制离开当前页面）。`
                : `已对全班学生强制锁定专注模式（限定当前课程，只读跟随）。`
              : `已解锁全班学生专注模式限制。`,
          },
          ...prev,
        ]);
        addToast(
          lang === 'zh' ? '🔒 锁状态更新' : '🔒 Class Status Updated',
          lock
            ? isAnswer
              ? '全班答题锁定成功，学生可在当前页面作答，无法切出。'
              : '全班专注锁定成功，学生将无法切回主页。'
            : '全班屏幕解锁成功，学生已恢复自由浏览。',
          'success',
        );
      }
    } catch (e) {
      console.error('Failed to toggle class focus lock', e);
    } finally {
      setLockingClass(false);
    }
  };

  // Lock single student with mode support ('full' | 'navigation')
  const handleToggleStudentLock = async (
    studentId: string,
    currentLockId: string | null | undefined,
    currentLockMode?: 'full' | 'navigation' | null,
    targetMode?: 'full' | 'navigation',
  ) => {
    let newLockVal: string | null = selectedLesson;
    let newMode: 'full' | 'navigation' = targetMode || 'full';

    if (currentLockId) {
      if (targetMode && currentLockMode !== targetMode) {
        // 切换模式，保持锁定
        newLockVal = selectedLesson;
        newMode = targetMode;
      } else {
        // 解锁
        newLockVal = null;
      }
    }

    try {
      const res = await fetch(`/api/students/${studentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locked_lesson_id: newLockVal,
          lock_mode: newLockVal ? newMode : 'full',
        }),
      });
      if (res.ok) {
        await fetchStudents();
        const stName = students.find((s) => s.id === studentId)?.name || studentId;
        const isAnswer = newMode === 'navigation';
        setLiveClassFeed((prev) => [
          {
            id: Math.random().toString(),
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            type: newLockVal ? 'warning' : 'info',
            message: newLockVal
              ? `已针对学生 [${stName}] 开启${isAnswer ? '答题锁定' : '专注限制锁定'}。`
              : `已解锁学生 [${stName}] 的屏幕锁定。`,
          },
          ...prev,
        ]);
      }
    } catch (e) {
      console.error('Failed to toggle student lock', e);
    }
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

  // Execute interactive tool via command bus
  const handleExecuteTool = async (tool: any) => {
    if (!selectedLesson) {
      addToast(
        lang === 'zh' ? '⚠️ 请选择课节' : '⚠️ Select Lesson',
        lang === 'zh' ? '请先选择要授课的课节。' : 'Please select a lesson first.',
        'warning',
      );
      return;
    }

    // Check if $classId replacement is required but no class selected
    const needsClass = JSON.stringify(tool.payload || '').includes('$classId');
    if (needsClass && !liveClassSelectedClassId) {
      addToast(
        lang === 'zh' ? '⚠️ 请选择班级' : '⚠️ Select Class',
        lang === 'zh' ? '该工具需要指定上课班级，请在顶部先选择班级。' : 'Please select class first for this tool.',
        'warning',
      );
      return;
    }

    setLiveClassFeed((prev) => [
      {
        id: Math.random().toString(),
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        type: 'info',
        message: `正在运行插件工具 [${tool.name}]...`,
      },
      ...prev,
    ]);

    try {
      // Substitute placeholders in payload
      const resolvedPayload = JSON.parse(
        JSON.stringify(tool.payload || {})
          .replace(/\$classId/g, liveClassSelectedClassId || '')
          .replace(/\$lessonId/g, selectedLesson || ''),
      );

      // Auto-append active segment ID into plugin elements
      if (resolvedPayload.type === 'plugin' && resolvedPayload.data) {
        try {
          const dataObj = JSON.parse(resolvedPayload.data);
          if (!dataObj.segmentId && activeSegmentId) {
            dataObj.segmentId = activeSegmentId;
            resolvedPayload.data = JSON.stringify(dataObj);
          }
        } catch {}
      }

      // Only prefix plugin-internal commands (e.g. courseware.open_panel).
      // Kernel commands like whiteboard.draw must pass through unmodified.
      const KERNEL_COMMAND_RE = /^(whiteboard|lesson|assignment|class|student|vfs|plugin|ai|agent|system)\./;
      const prefixedCommandType =
        !KERNEL_COMMAND_RE.test(tool.commandType) && tool.manifestId
          ? resolvePluginCommandType(tool.commandType, tool.manifestId)
          : tool.commandType;
      const res = await fetch('/api/commands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          commandType: prefixedCommandType,
          payload: resolvedPayload,
        }),
      });

      if (res.ok) {
        if (
          onOpenCoursewareHub &&
          (tool.id === 'courseware-hub-teacher' || tool.commandType === 'courseware.open_panel')
        ) {
          onOpenCoursewareHub();
        }
        setLiveClassFeed((prev) => [
          {
            id: Math.random().toString(),
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            type: 'success',
            message: `插件工具 [${tool.name}] 执行完毕，数据成功下发。`,
          },
          ...prev,
        ]);
        addToast(
          lang === 'zh' ? '✓ 工具下发成功' : '✓ Tool Synchronized',
          lang === 'zh'
            ? `工具 [${tool.name}] 已成功在当前白板上部署并投射。`
            : `Tool [${tool.name}] synchronized successfully.`,
          'success',
        );
        await fetchElements(selectedLesson);
      } else {
        const data = await res.json();
        throw new Error(data.error || 'Server error');
      }
    } catch (err: any) {
      setLiveClassFeed((prev) => [
        {
          id: Math.random().toString(),
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          type: 'error',
          message: `运行插件工具 [${tool.name}] 失败: ${err.message}`,
        },
        ...prev,
      ]);
      addToast(lang === 'zh' ? '❌ 运行失败' : '❌ Tool Failed', err.message || 'Execution error', 'warning');
    }
  };

  const handleRandomPick = () => {
    if (students.length === 0 || isDrawing) return;

    // Only select students who are currently online and have entered the classroom (activeStudentLessons[s.id] === selectedLesson)
    const drawPool = students.filter(
      (s) => onlineStudentIds.includes(s.id) && activeStudentLessons[s.id] === selectedLesson,
    );

    if (drawPool.length === 0) {
      addToast(
        lang === 'zh' ? '⚠️ 无法抽问' : '⚠️ Cannot Draw',
        lang === 'zh' ? '当前课堂中没有已进入的活跃学生。' : 'No students have entered the classroom yet.',
        'warning',
      );
      return;
    }

    setIsDrawing(true);

    let count = 0;
    const maxTicks = 18;
    let currentInterval = 75;

    const tick = () => {
      const randIndex = Math.floor(Math.random() * drawPool.length);
      const randomStudent = drawPool[randIndex];
      setActiveDrawStudentId(randomStudent.id);

      count++;
      if (count < maxTicks) {
        if (count > maxTicks - 5) {
          currentInterval += 45;
        }
        drawTickTimerRef.current = setTimeout(tick, currentInterval);
      } else {
        const finalStudent = drawPool[randIndex];
        setActiveDrawStudentId(null);
        setIsDrawing(false);

        // Add the drawn student to the list of highlighted IDs
        setSelectedDrawStudentIds((prev) => {
          if (prev.includes(finalStudent.id)) return prev;
          return [...prev, finalStudent.id];
        });

        // Append draw result to live class feed
        setLiveClassFeed((prev) => [
          {
            id: Math.random().toString(),
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            type: 'success',
            message: `🎯 随机提问抽选：学生 [${finalStudent.name}] 被抽中回答问题！`,
          },
          ...prev,
        ]);

        addToast(
          lang === 'zh' ? '🎯 随机提问抽选' : '🎯 Student Drawn',
          lang === 'zh'
            ? `恭喜学生 [${finalStudent.name}] 被抽中回答问题！`
            : `Student [${finalStudent.name}] was selected to answer!`,
          'success',
        );

        // 跨窗口与全网同步：向学生端派发随机抽问点名事件
        if (syncChannelRef.current) {
          syncChannelRef.current.broadcastPickStudent(finalStudent.id, finalStudent.name);
        } else {
          const socket = getOptionalSocket();
          if (socket) {
            socket.emit('teacher-pick-student', {
              studentId: finalStudent.id,
              studentName: finalStudent.name,
              lessonId: selectedLesson,
              classId: liveClassSelectedClassId,
            });
          }
        }

        // Recover highlight after 8 seconds
        if (drawRecoverTimerRef.current) clearTimeout(drawRecoverTimerRef.current);
        drawRecoverTimerRef.current = setTimeout(() => {
          setSelectedDrawStudentIds((prev) => prev.filter((id) => id !== finalStudent.id));
        }, 8000);
      }
    };

    if (drawTickTimerRef.current) clearTimeout(drawTickTimerRef.current);
    drawTickTimerRef.current = setTimeout(tick, currentInterval);
  };

  const formatTime = (secs: number): string => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // ── 提交数据列表的展示口径（徽标与表格必须共用同一份数据） ──
  // 先按顶部所选班级过滤（未选班级时不筛），再按搜索词与状态筛选。
  // 之前的 bug：徽标直接用未过滤的 attempts.length，表格却用班级过滤后的结果，
  // 导致“徽标显示 8 条记录、列表却空空如也”的矛盾。
  const classStudentIds = liveClassSelectedClassId ? students.map((s) => s.id) : [];
  const classFilteredAttempts = liveClassSelectedClassId
    ? attempts.filter((a) => classStudentIds.includes(a.studentId))
    : attempts;
  const displayAttempts = classFilteredAttempts.filter((a) => {
    const matchesSearch =
      a.studentName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      a.coursewareName?.toLowerCase().includes(searchQuery.toLowerCase());

    // 终态状态值归一到模块级常量（与后端一致），避免同一文件里出现两套口径
    const matchesStatus =
      submissionFilter === 'all' ||
      (submissionFilter === 'submitted' && FINISHED_STATUSES.includes(a.status)) ||
      (submissionFilter === 'started' && IN_PROGRESS_STATUSES.includes(a.status));

    return matchesSearch && matchesStatus;
  });

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
    );
  }

  return (
    <div className="flex-grow flex-1 flex flex-col min-h-0 bg-surface border border-theme rounded-2xl shadow-xl text-main overflow-hidden font-sans">
      {/* 1. Header Control Bar */}
      <div className="bg-surface-secondary px-4 py-2.5 border-b border-theme flex items-center justify-between gap-3 shrink-0 overflow-x-auto no-scrollbar">
        <div className="flex items-center gap-2.5 select-none shrink-0 min-w-0">
          <div className="flex items-center gap-2 shrink-0">
            <div className="relative flex items-center justify-center">
              <span
                className={`w-3 h-3 rounded-full ${liveClassIsActive ? 'bg-emerald-500 animate-ping' : 'bg-rose-500'} absolute`}
              />
              <span
                className={`w-2 h-2 rounded-full ${liveClassIsActive ? 'bg-emerald-500' : 'bg-rose-500'} relative`}
              />
            </div>
            <h2 className="text-sm font-extrabold tracking-tight text-main flex items-center gap-2 shrink-0">
              {lang === 'zh' ? '🔴 在线课堂' : '🔴 Live Classroom'}
            </h2>
          </div>

          {/* 班级只读。进行中不能改；结束/归档或回到起始门户后才能重选。 */}
          <div
            id="live-classroom-current-class-badge"
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary-theme/10 border border-primary-theme/25 text-primary-ink text-xs font-bold select-none shrink-0"
            title={classLockHint(lang)}
            // 班级徽章是只读状态展示，不是可交互控件；aria-allowed-attr 会拒绝
            // 非控件上的 aria-readonly。改用 role="status" 表达「只读状态」。
            role="status"
          >
            <School size={12} className="shrink-0" />
            <span className="truncate max-w-[120px] sm:max-w-[160px]">
              {classes.find((c) => c.id === liveClassSelectedClassId)?.name ||
                (lang === 'zh' ? '未分配班级' : 'No Class')}
            </span>
            <span
              data-testid="live-class-lock-hint"
              className="text-2xs font-semibold text-muted truncate max-w-[140px]"
            >
              {classLockHint(lang)}
            </span>
          </div>
          <button
            type="button"
            id="live-classroom-back-to-portal"
            onClick={() => {
              userReturnedToPortalRef.current = true;
              enteredClassroomRef.current = false;
              rememberActiveLesson(null);
              setEntryDecisionReady(true);
              setShowSessionPicker(false);
              setShowEntryPortal(true);
            }}
            className="inline-flex items-center text-2xs font-semibold px-2 py-1 rounded-lg border border-theme text-muted hover:text-main hover:bg-surface shrink-0 cursor-pointer"
            title={
              lang === 'zh'
                ? '回到起始门户。进行中的课不能换班'
                : 'Back to the start portal. In-progress lessons stay on this class.'
            }
          >
            {lang === 'zh' ? '返回门户' : 'Back to portal'}
          </button>
          <button
            type="button"
            id="live-classroom-open-sessions"
            onClick={() => setShowSessionManager(true)}
            className="inline-flex items-center text-2xs font-semibold px-2 py-1 rounded-lg border border-theme text-muted hover:text-main hover:bg-surface shrink-0 cursor-pointer"
            title={lang === 'zh' ? '管理课堂历史与进行中会话' : 'Manage classroom sessions'}
          >
            {lang === 'zh' ? '会话档案' : 'Sessions'}
          </button>

          {/* 课程选择与切换操作 */}
          <div className="flex items-center gap-1.5 shrink-0">
            <select
              id="live-classroom-lesson-select"
              aria-label={lang === 'zh' ? '选择授课课程' : 'Select lesson to teach'}
              value={pendingLessonId || ''}
              onChange={(e) => {
                const val = e.target.value === '' ? null : e.target.value;
                setPendingLessonId(val);
              }}
              className="bg-surface border border-theme rounded-lg text-xs font-semibold px-2.5 py-1.5 focus:ring-1 focus:ring-primary-theme text-main outline-none cursor-pointer hover:bg-surface-secondary transition-colors max-w-[180px] sm:max-w-[240px] truncate"
            >
              <option value="">{lang === 'zh' ? '-- 选择授课课节 --' : '-- Select Lesson --'}</option>
              {lessons.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.title}
                </option>
              ))}
            </select>

            <button
              type="button"
              id="live-classroom-switch-lesson-btn"
              disabled={!pendingLessonId || pendingLessonId === selectedLesson}
              onClick={() => setIsSwitchLessonConfirmOpen(true)}
              className={`inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1.5 rounded-lg transition-all cursor-pointer ${
                pendingLessonId && pendingLessonId !== selectedLesson
                  ? 'bg-primary-solid hover:opacity-90 text-white shadow-2xs ring-1 ring-primary-theme/50 active:scale-95'
                  : 'bg-surface border border-theme/60 text-muted opacity-45 cursor-not-allowed'
              }`}
              title={
                pendingLessonId && pendingLessonId !== selectedLesson
                  ? lang === 'zh'
                    ? '点击切换上课课程（将弹出确认框）'
                    : 'Switch lesson (confirmation needed)'
                  : lang === 'zh'
                    ? '在下拉框选择不同课程后点击切换'
                    : 'Select a different lesson to switch'
              }
            >
              <ArrowLeftRight size={12} />
              <span>{lang === 'zh' ? '切换' : 'Switch'}</span>
            </button>

            {selectedLesson && (
              <button
                type="button"
                onClick={() => handleEditLesson(selectedLesson)}
                title={lang === 'zh' ? '进入此课程的课程编辑器' : 'Edit lesson in Lesson Editor'}
                className="inline-flex items-center gap-1 bg-surface border border-theme hover:border-primary-theme hover:bg-surface-secondary text-main text-xs font-semibold px-2 py-1.5 rounded-lg transition-colors cursor-pointer"
              >
                <Edit3 size={12} />
                <span>{lang === 'zh' ? '编辑' : 'Edit'}</span>
              </button>
            )}
          </div>
        </div>

        {/* Right Actions Bar: Student Preview (Eye Icon), Lock & Classroom Quick Actions */}
        <div className="flex items-center gap-2 ml-auto shrink-0">
          <button
            onClick={handleOpenStudentWindow}
            className={`w-8 h-8 rounded-lg transition-all cursor-pointer flex items-center justify-center relative shadow-sm active:scale-95 shrink-0 ${
              isStudentWindowOpen
                ? 'bg-emerald-600 hover:bg-emerald-700 text-white ring-2 ring-emerald-400/50 shadow-emerald-500/20'
                : 'bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-700 hover:to-rose-700 text-white'
            }`}
            title={
              lang === 'zh'
                ? isStudentWindowOpen
                  ? '学生端已联动 (独立Tab) - 点击激活'
                  : '学生视角预览 (独立Tab) - 在新窗口中联动打开'
                : isStudentWindowOpen
                  ? 'Student Linked (Focus Tab)'
                  : 'Student Preview (New Tab)'
            }
            aria-label={
              lang === 'zh'
                ? isStudentWindowOpen
                  ? '学生端已联动 (独立Tab)'
                  : '学生视角预览 (独立Tab)'
                : isStudentWindowOpen
                  ? 'Student Linked (Focus Tab)'
                  : 'Student Preview (New Tab)'
            }
          >
            <Eye size={16} />
            {isStudentWindowOpen && (
              <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-300 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400"></span>
              </span>
            )}
          </button>
          {isClassLocked ? (
            <div className="inline-flex rounded-lg shadow-sm shrink-0">
              <button
                onClick={() => handleToggleClassLock(false)}
                disabled={lockingClass || !selectedLesson || !liveClassSelectedClassId}
                className={`px-3 py-1.5 rounded-l-lg font-bold text-xs uppercase tracking-wider flex items-center gap-1.5 shadow-sm transition-all active:scale-95 disabled:opacity-50 cursor-pointer shrink-0 text-white ${
                  classLockMode === 'navigation' ? 'bg-amber-600 hover:bg-amber-700' : 'bg-rose-600 hover:bg-rose-700'
                }`}
                title={
                  lang === 'zh'
                    ? `${classLockMode === 'navigation' ? '答题锁定中' : '专注锁定中'} · 点击一键解锁全班`
                    : `${classLockMode === 'navigation' ? 'Answer Lock Active' : 'Focus Lock Active'} · Click to unlock`
                }
              >
                {classLockMode === 'navigation' ? <FileEdit size={12} /> : <ShieldAlert size={12} />}
                <span>
                  {classLockMode === 'navigation'
                    ? lang === 'zh'
                      ? '答题锁定 · 解锁'
                      : 'Answer Lock · Unlock'
                    : lang === 'zh'
                      ? '专注锁定 · 解锁'
                      : 'Focus Lock · Unlock'}
                </span>
              </button>
              <button
                onClick={() => handleToggleClassLock(true, classLockMode === 'navigation' ? 'full' : 'navigation')}
                disabled={lockingClass || !selectedLesson || !liveClassSelectedClassId}
                className={`px-2 py-1.5 rounded-r-lg font-bold text-[11px] flex items-center gap-1 transition-all active:scale-95 disabled:opacity-50 cursor-pointer shrink-0 text-white border-l border-white/20 ${
                  classLockMode === 'navigation' ? 'bg-amber-700 hover:bg-amber-800' : 'bg-rose-700 hover:bg-rose-800'
                }`}
                title={
                  classLockMode === 'navigation'
                    ? lang === 'zh'
                      ? '切换为全班专注锁定（只读跟随，禁止交互）'
                      : 'Switch to Full Focus Lock'
                    : lang === 'zh'
                      ? '切换为全班答题锁定（放开作答，禁止离开）'
                      : 'Switch to Answer Lock'
                }
              >
                <ArrowLeftRight size={11} />
                <span>
                  {classLockMode === 'navigation'
                    ? lang === 'zh'
                      ? '切专注'
                      : 'To Focus'
                    : lang === 'zh'
                      ? '切答题'
                      : 'To Answer'}
                </span>
              </button>
            </div>
          ) : (
            <div className="inline-flex rounded-lg shadow-sm shrink-0">
              <button
                onClick={() => handleToggleClassLock(true, 'full')}
                disabled={lockingClass || !selectedLesson || !liveClassSelectedClassId}
                className="px-2.5 py-1.5 rounded-l-lg font-bold text-xs uppercase tracking-wider flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white transition-all active:scale-95 disabled:opacity-50 cursor-pointer shrink-0"
                title={
                  lang === 'zh'
                    ? '全班专注锁定（只读跟随，限制离开）'
                    : 'Class Focus Lock (Read-only, navigation restricted)'
                }
              >
                <Shield size={12} />
                <span>{lang === 'zh' ? '全班专注' : 'Focus Lock'}</span>
              </button>
              <button
                onClick={() => handleToggleClassLock(true, 'navigation')}
                disabled={lockingClass || !selectedLesson || !liveClassSelectedClassId}
                className="px-2.5 py-1.5 rounded-r-lg font-bold text-xs uppercase tracking-wider flex items-center gap-1.5 bg-amber-600 hover:bg-amber-700 text-white border-l border-amber-700 transition-all active:scale-95 disabled:opacity-50 cursor-pointer shrink-0"
                title={
                  lang === 'zh'
                    ? '全班答题锁定（允许正常作答与输入，限制离开）'
                    : 'Class Answer Lock (Allow interaction/submissions, navigation restricted)'
                }
              >
                <FileEdit size={12} />
                <span>{lang === 'zh' ? '答题锁定' : 'Answer Lock'}</span>
              </button>
            </div>
          )}

          {/* 上课流程扩展与倒计时工具栏 */}
          <ClassroomToolbarQuickActions
            lang={lang as any}
            onOpenDiagnosticCenter={() => setIsDiagnosticCenterOpen(true)}
            onOpenMasteryPrediction={() => setIsMasteryPredictionOpen(true)}
            onOpenGroupCollab={() => setIsGroupCollabOpen(true)}
            onOpenShowcaseDiff={() => setIsShowcaseDiffOpen(true)}
            onOpenPeerReviewShowcase={() => setIsPeerReviewShowcaseOpen(true)}
            onOpenParentNotification={() => setIsParentNotificationOpen(true)}
            onOpenMacroRunner={() => setIsMacroRunnerOpen(true)}
            onOpenHardwareSettings={() => setIsHardwareSettingsOpen(true)}
            selectedLesson={selectedLesson}
            syncChannel={syncChannelRef.current}
            onlineStudentCount={onlineStudentIds?.length || liveClassAcknowledgedMap.size || 0}
            onTimeRemainingChange={(timeRemaining, isRunning) => {
              // v0.6.1 审计 R-8/N-1：计时唯一写点 —— widget 的 endsAt 校准 tick
              // 写 liveClassStore（独立 store），不再经过 AppDataContext；「时间到」
              // toast 与学生端 broadcastSyncTimer 也在此完成（取代已删除的旧
              // 每秒定时器与广播 effect）。
              const wasRunning = prevTimerRunningRef.current;
              prevTimerRunningRef.current = isRunning;
              liveClassStore.getState().setLiveClassTimeRemaining(timeRemaining);
              if (wasRunning !== isRunning) {
                setLiveClassIsActive(isRunning);
                if (wasRunning && !isRunning) {
                  addToast(
                    lang === 'zh' ? '⏰ 环节时间到' : '⏰ Phase Timer Ended',
                    lang === 'zh'
                      ? '当前教学环节设定的时间已耗尽，建议转入下一环节。'
                      : 'The current segment duration has elapsed. Transition recommended.',
                    'warning',
                  );
                }
              }
              syncChannelRef.current?.broadcastSyncTimer(timeRemaining, isRunning);
            }}
          />
        </div>
      </div>

      {/* Interactive Classroom Cockpit (Stages, Polls, Buzzers, Exit Tickets, Stage Display) */}
      <ClassroomInteractiveCockpit
        lessonId={selectedLesson}
        lessonTitle={lessons.find((l) => l.id === selectedLesson)?.title}
        classId={liveClassSelectedClassId}
        lang={lang as any}
        addToast={addToast}
        currentStage={classroomStage}
        onStageChange={(newStage) => setClassroomStage(newStage)}
        students={classProfiles}
      />

      {/* 2. Main Stage Router: Switches based on classroomStage */}
      {!selectedLesson ? (
        <div className="flex-1 flex flex-col items-center justify-center text-subtle gap-2.5 select-none bg-surface">
          <Presentation size={38} className="text-slate-300 animate-bounce" style={{ animationDuration: '2.5s' }} />
          <div className="text-sm font-bold text-muted">
            {lang === 'zh' ? '请在顶部栏选择一个授课课节' : 'Please select a lesson to start teaching'}
          </div>
          <p className="text-xs text-subtle">
            {lang === 'zh'
              ? '课前准备、课中白板、课后小结与简报将在选择课节后就绪'
              : 'Classroom workflows activate once a lesson is selected.'}
          </p>
        </div>
      ) : classroomStage === 'PRE_CLASS_READY' ? (
        <PreClassReadyView
          selectedLesson={selectedLesson}
          lessonTitle={lessons.find((l) => l.id === selectedLesson)?.title || ''}
          selectedClassId={liveClassSelectedClassId}
          className={classes.find((c) => c.id === liveClassSelectedClassId)?.name || ''}
          students={students}
          onlineStudentIds={onlineStudentIds}
          timelineSegments={timelineSegments}
          lang={lang as any}
          isClassLocked={isClassLocked}
          onToggleClassLock={() => handleToggleClassLock(!isClassLocked)}
          onStartClass={() => handleStageChange('IN_CLASS_TEACHING')}
          onPingStudent={() => handleRandomPick()}
          onOpenStudentWindow={handleOpenStudentWindow}
          isStudentWindowOpen={isStudentWindowOpen}
          addToast={addToast}
          onBroadcastNotice={(msg) => {
            setLiveClassFeed((prev) => [
              {
                id: `feed-notice-${Date.now()}`,
                time: new Date().toLocaleTimeString(),
                type: 'checkin',
                message: msg,
              },
              ...prev,
            ]);
          }}
        />
      ) : classroomStage === 'WRAP_UP_EXIT_TICKET' ? (
        <PostClassWrapupView
          selectedLesson={selectedLesson}
          lessonTitle={lessons.find((l) => l.id === selectedLesson)?.title || ''}
          selectedClassId={liveClassSelectedClassId}
          className={classes.find((c) => c.id === liveClassSelectedClassId)?.name || ''}
          students={students}
          lang={lang as any}
          attempts={attempts}
          loadingAttempts={loadingAttempts}
          onFetchAttempts={() => fetchAttempts()}
          onPromoteAttempt={handlePromoteAttempt}
          onViewRaw={(a) => handleViewRaw(a)}
          onAdvanceToReport={() => handleStageChange('ARCHIVED_REPORT')}
          onReturnToTeaching={() => handleStageChange('IN_CLASS_TEACHING')}
          addToast={addToast}
          onBroadcastNotice={(msg) => {
            setLiveClassFeed((prev) => [
              {
                id: `feed-hw-${Date.now()}`,
                time: new Date().toLocaleTimeString(),
                type: 'checkin',
                message: msg,
              },
              ...prev,
            ]);
          }}
        />
      ) : classroomStage === 'ARCHIVED_REPORT' ? (
        <ClassroomBriefingView
          selectedLesson={selectedLesson}
          lessonTitle={lessons.find((l) => l.id === selectedLesson)?.title || ''}
          selectedClassId={liveClassSelectedClassId}
          className={classes.find((c) => c.id === liveClassSelectedClassId)?.name || ''}
          students={students}
          lang={lang as any}
          onReturnToTeaching={() => handleStageChange('IN_CLASS_TEACHING')}
          onReturnToPreClass={() => handleStageChange('PRE_CLASS_READY')}
          addToast={addToast}
        />
      ) : (
        /* classroomStage === 'IN_CLASS_TEACHING' - Whiteboard ONLY rendered here! */
        <div className="flex-1 flex overflow-hidden min-h-0 bg-surface-secondary/30">
          {/* Left Column: Timeline & Whiteboard Outline Control */}
          {!isLeftSidebarCollapsed && (
            <div className="w-[268px] shrink-0 bg-surface border-r border-theme flex flex-col min-h-0 select-none shadow-xs transition-all duration-200">
              {/* 顶栏控制 */}
              <div className="p-3 border-b border-theme/60 flex items-center justify-between shrink-0 bg-surface-secondary/20">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-6 h-6 rounded-lg bg-primary-theme/10 text-primary-ink flex items-center justify-center shrink-0">
                    <Clock size={13} />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-xs font-black text-main uppercase tracking-wider truncate">
                      {lang === 'zh' ? '教学步骤与页面大纲' : 'Lesson Flow & Outline'}
                    </h3>
                    <div className="text-[10px] text-muted flex items-center gap-1.5 font-medium">
                      <span>
                        {timelineSegments.length} {lang === 'zh' ? '环节' : 'steps'}
                      </span>
                      <span>•</span>
                      <span>
                        {whiteboardPages.length || 1} {lang === 'zh' ? '页面' : 'pages'}
                      </span>
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setIsLeftSidebarCollapsed(true)}
                  className="p-1 rounded-md text-muted hover:text-main hover:bg-surface border border-theme/40 transition-colors cursor-pointer shrink-0"
                  title={lang === 'zh' ? '收起边栏以扩大白板视野' : 'Collapse Sidebar'}
                >
                  <ChevronLeft size={13} />
                </button>
              </div>

              {/* 滚动容器 */}
              <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3.5 scrollbar-thin">
                {/* 模块 1：白板页面大纲导航 */}
                <div className="bg-surface rounded-xl border border-theme p-2.5 flex flex-col gap-2 shadow-2xs">
                  <div className="flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => setIsOutlineCollapsed((prev) => !prev)}
                      className="flex items-center gap-1.5 text-xs font-bold text-main hover:text-primary-ink transition-colors cursor-pointer"
                    >
                      <LayoutGrid size={13} className="text-primary-ink" />
                      <span>{lang === 'zh' ? '白板页面大纲' : 'Whiteboard Outline'}</span>
                      <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-primary-theme/10 text-primary-ink font-mono font-bold">
                        {whiteboardPages.length || 1}
                      </span>
                      <ChevronDown
                        size={12}
                        className={`text-muted transition-transform duration-200 ${isOutlineCollapsed ? '-rotate-90' : ''}`}
                      />
                    </button>
                    <button
                      type="button"
                      onClick={() => whiteboardRef.current?.addPage?.()}
                      className="p-1 rounded-md text-muted hover:text-primary-ink hover:bg-primary-theme/10 transition-colors cursor-pointer"
                      title={lang === 'zh' ? '新建白板页面' : 'Add Whiteboard Page'}
                    >
                      <Plus size={13} />
                    </button>
                  </div>

                  {isOutlineCollapsed ? (
                    <div
                      onClick={() => setIsOutlineCollapsed(false)}
                      className="flex items-center justify-between text-2xs px-2.5 py-1.5 bg-surface-secondary/60 rounded-lg text-muted hover:text-main cursor-pointer transition-colors"
                    >
                      <span className="truncate max-w-[170px] font-medium">
                        {lang === 'zh' ? '当前' : 'Active'}:{' '}
                        {whiteboardPages[currentWhiteboardPage]?.title || `P${currentWhiteboardPage + 1}`}
                      </span>
                      <span className="text-[10px] text-primary-ink font-bold">
                        {lang === 'zh' ? '展开' : 'Expand'}
                      </span>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1 max-h-40 overflow-y-auto pr-0.5 no-scrollbar">
                      {(whiteboardPages.length > 0 ? whiteboardPages : [{ id: 'p0', title: 'P1 · 默认页' }]).map(
                        (p, idx) => {
                          const isActive = idx === currentWhiteboardPage;
                          const pageElementsCount = elements.filter((el) => {
                            try {
                              const d = JSON.parse(el.data);
                              return (d.page ?? 0) === idx;
                            } catch {
                              return false;
                            }
                          }).length;
                          return (
                            <div
                              key={p.id || idx}
                              onClick={() => whiteboardRef.current?.switchPage?.(idx)}
                              className={`group flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-all cursor-pointer ${
                                isActive
                                  ? 'bg-primary-solid text-white font-semibold shadow-xs ring-1 ring-primary-theme/30'
                                  : 'bg-surface hover:bg-surface-secondary text-main border border-theme/40'
                              }`}
                            >
                              <div className="flex items-center gap-1.5 truncate min-w-0 flex-1">
                                <span
                                  className={`text-[10px] px-1 py-0.2 rounded font-mono shrink-0 ${
                                    isActive ? 'bg-primary-solid/85 text-white' : 'bg-surface-secondary text-muted'
                                  }`}
                                >
                                  P{idx + 1}
                                </span>
                                <span className="truncate tracking-tight">{p.title || `页面 ${idx + 1}`}</span>
                              </div>
                              <span
                                className={`text-[9px] px-1.5 py-0.2 rounded shrink-0 ${
                                  isActive ? 'bg-primary-solid/85 text-white' : 'text-muted'
                                }`}
                              >
                                {pageElementsCount} {lang === 'zh' ? '组件' : 'items'}
                              </span>
                            </div>
                          );
                        },
                      )}
                    </div>
                  )}
                </div>

                {/* 模块 3：教学环节进度流程表 */}
                <div className="flex flex-col gap-2 min-h-0">
                  <div className="flex items-center justify-between select-none">
                    <div className="flex items-center gap-1.5">
                      <Radio size={12} className="text-primary-ink" />
                      <h4 className="text-xs font-black uppercase text-main tracking-wider">
                        {lang === 'zh' ? '教学环节进度表' : 'Timeline Segments'}
                      </h4>
                    </div>
                    <span className="text-[10px] text-muted font-medium">
                      {timelineSegments.findIndex((s) => s.id === activeSegmentId) >= 0
                        ? `${lang === 'zh' ? '进行中: ' : 'Active: '}#${timelineSegments.findIndex((s) => s.id === activeSegmentId) + 1}`
                        : ''}
                    </span>
                  </div>

                  {selectedLesson ? (
                    <div className="space-y-2 overflow-y-auto flex-1 pr-0.5 scrollbar-thin">
                      {timelineSegments.map((seg, idx) => {
                        const isActive = activeSegmentId === seg.id;
                        return (
                          <div
                            key={seg.id}
                            className={`p-2.5 rounded-xl border transition-all flex flex-col gap-1.5 relative overflow-hidden ${
                              isActive
                                ? 'bg-primary-theme/10 border-primary-theme shadow-xs ring-1 ring-primary-theme/20'
                                : 'bg-surface border-theme/70 hover:border-primary-theme/40 hover:bg-surface-secondary/50'
                            }`}
                          >
                            {isActive && (
                              <div className="absolute top-0 left-0 bottom-0 w-1 bg-primary-theme rounded-r" />
                            )}
                            <div className="flex justify-between items-center pl-1">
                              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                <span
                                  className={`w-4 h-4 rounded-full text-[10px] font-bold flex items-center justify-center shrink-0 ${
                                    isActive ? 'bg-primary-solid text-white' : 'bg-surface-secondary text-muted'
                                  }`}
                                >
                                  {idx + 1}
                                </span>
                                <span
                                  className={`text-xs font-bold truncate ${isActive ? 'text-primary-ink' : 'text-main'}`}
                                >
                                  {seg.title}
                                </span>
                              </div>
                              <span className="text-2xs font-mono px-1.5 py-0.5 rounded bg-surface-secondary text-muted border border-theme/60 shrink-0">
                                {seg.duration}
                              </span>
                            </div>

                            <div
                              className={`text-2xs line-clamp-2 leading-relaxed pl-1 ${
                                isActive ? 'text-primary-ink/90' : 'text-muted'
                              }`}
                            >
                              {seg.notes || (lang === 'zh' ? '无步骤描述备注信息。' : 'No description notes.')}
                            </div>

                            <button
                              onClick={() => handleStartSegment(seg)}
                              className={`w-full py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                                isActive
                                  ? 'bg-primary-solid text-white hover:bg-primary-solid-hover shadow-xs'
                                  : 'bg-surface-secondary text-muted hover:text-main hover:bg-surface border border-theme'
                              }`}
                            >
                              {isActive ? (
                                <>
                                  <span className="relative flex h-2 w-2">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
                                  </span>
                                  <span>{lang === 'zh' ? '同步演示中' : 'Broadcasting'}</span>
                                </>
                              ) : (
                                <>
                                  <Presentation size={11} />
                                  <span>{lang === 'zh' ? '广播此环节' : 'Broadcast Step'}</span>
                                </>
                              )}
                            </button>

                            {/* 环节步骤卡片动作扩展 */}
                            <ExtensionPointRenderer
                              slot="classroom.agenda.action"
                              slotProps={{
                                segment: seg,
                                isActive,
                                idx,
                                lessonId: selectedLesson,
                                lang,
                              }}
                            />
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-xs text-muted italic py-4 text-center">
                      {lang === 'zh' ? '请选择一个课节加载流程表' : 'Select a lesson to view schedule.'}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Middle Column: Live Interactive Whiteboard & Plugins Tool Shelf */}
          <div className="flex-1 flex flex-col min-w-0 bg-surface-secondary/40 p-3 gap-3 relative">
            {selectedLesson ? (
              <div className="w-full h-full relative flex flex-col min-h-0">
                <div className="flex justify-between items-center px-1.5 py-1 select-none text-muted text-xs uppercase font-extrabold tracking-wide shrink-0 mb-1">
                  <div className="flex items-center gap-3">
                    {isLeftSidebarCollapsed && (
                      <button
                        onClick={() => setIsLeftSidebarCollapsed(false)}
                        className="p-1 rounded-lg bg-surface hover:bg-surface-secondary border border-theme text-primary-ink hover:text-primary-ink-hover transition-colors cursor-pointer mr-1.5 flex items-center gap-1 shadow-sm"
                        title={lang === 'zh' ? '展开环节大纲' : 'Expand Sidebar'}
                      >
                        <ChevronRight size={10} />
                        <span className="text-xs font-bold tracking-wider">{lang === 'zh' ? '展开' : 'Expand'}</span>
                      </button>
                    )}
                    <div className="bg-surface-secondary p-0.5 rounded-lg flex items-center gap-1 border border-theme">
                      <button
                        onClick={() => setMiddleTab('whiteboard')}
                        className={`px-3 py-1 rounded-md text-xs font-bold transition-all cursor-pointer ${
                          middleTab === 'whiteboard'
                            ? 'bg-surface text-primary-ink shadow-sm'
                            : 'text-muted hover:text-main'
                        }`}
                      >
                        {lang === 'zh' ? '💻 演示白板' : '💻 Whiteboard'}
                      </button>
                      <button
                        onClick={() => setMiddleTab('submissions')}
                        className={`px-3 py-1 rounded-md text-xs font-bold transition-all cursor-pointer ${
                          middleTab === 'submissions'
                            ? 'bg-surface text-primary-ink shadow-sm'
                            : 'text-muted hover:text-main'
                        }`}
                      >
                        {lang === 'zh' ? '📊 学生提交数据' : '📊 Student Submissions'}
                      </button>
                      <button
                        id="teacher_assignment_eval_tab_btn"
                        onClick={() => setMiddleTab('assignment')}
                        className={`px-3 py-1 rounded-md text-xs font-bold transition-all cursor-pointer ${
                          middleTab === 'assignment'
                            ? 'bg-surface text-primary-ink shadow-sm'
                            : 'text-muted hover:text-main'
                        }`}
                      >
                        {lang === 'zh' ? '🎓 作业成绩评定' : '🎓 Assignment Grades'}
                      </button>
                      <button
                        id="teacher_top_performers_tab_btn"
                        data-testid="teacher-top-performers-tab-btn"
                        onClick={() => setMiddleTab('top_performers')}
                        className={`px-3 py-1 rounded-md text-xs font-bold transition-all cursor-pointer flex items-center gap-1 ${
                          middleTab === 'top_performers'
                            ? 'bg-surface text-amber-700 dark:text-amber-400 shadow-sm'
                            : 'text-muted hover:text-main'
                        }`}
                      >
                        <Trophy size={12} className="text-amber-700 dark:text-amber-400" />
                        <span>{lang === 'zh' ? '🏆 随堂测验榜' : '🏆 Top Performers'}</span>
                      </button>
                      {hasSegmentMainExtension && currentActiveSegment && (
                        <button
                          id="teacher_active_segment_main_tab_btn"
                          data-testid="teacher-active-segment-main-tab-btn"
                          onClick={() => setMiddleTab('segment_main')}
                          className={`px-3 py-1 rounded-md text-xs font-bold transition-all cursor-pointer flex items-center gap-1 ${
                            middleTab === 'segment_main'
                              ? 'bg-surface text-primary-theme shadow-sm'
                              : 'text-muted hover:text-main'
                          }`}
                        >
                          <Sparkles size={12} className="text-primary-theme" />
                          <span>
                            {lang === 'zh'
                              ? `🧩 ${currentActiveSegment.title || '环节工作区'}`
                              : `🧩 ${currentActiveSegment.title || 'Segment Workspace'}`}
                          </span>
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {studentErrors.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          errorStore.getState().setActiveTab('student');
                          errorStore.getState().setIsErrorCenterOpen(true);
                        }}
                        className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-bold bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400 border border-rose-200 dark:border-rose-800 hover:bg-rose-100 transition-colors cursor-pointer mr-1"
                        title={lang === 'zh' ? '点击查看学生端异常诊断日志' : 'View Student Client Errors'}
                      >
                        <AlertTriangle size={12} className="text-rose-700 dark:text-rose-400 animate-pulse" />
                        <span>
                          {lang === 'zh'
                            ? `学生端异常 (${studentErrors.length})`
                            : `Student Errors (${studentErrors.length})`}
                        </span>
                      </button>
                    )}
                    <span className="text-primary-ink font-mono tracking-widest animate-pulse flex items-center gap-1">
                      <Activity size={10} /> Live Broadcaster Connected
                    </span>
                    <button
                      type="button"
                      onClick={() => handleStageChange('WRAP_UP_EXIT_TICKET')}
                      className="ml-2 px-3 py-1 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white rounded-lg text-xs font-bold flex items-center gap-1 shadow-xs cursor-pointer hover:shadow-md transition-all active:scale-95"
                    >
                      <span>{lang === 'zh' ? '完成授课，进入课后' : 'Finish Teaching → Post-Class'}</span>
                      <ChevronRight size={12} />
                    </button>
                  </div>
                </div>

                {middleTab === 'whiteboard' ? (
                  <>
                    {hasSegmentMainExtension && currentActiveSegment && (
                      <div
                        data-testid="classroom-active-segment-main-hint"
                        className="flex items-center justify-between px-3 py-1.5 bg-primary-theme/10 border border-primary-theme/20 rounded-lg text-xs text-primary-theme shrink-0"
                      >
                        <span className="flex items-center gap-1.5 font-medium truncate">
                          <Sparkles size={13} className="shrink-0" />
                          <span>
                            {lang === 'zh'
                              ? `当前环节「${currentActiveSegment.title}」已配备专属互动工作区`
                              : `Current segment "${currentActiveSegment.title}" has a dedicated interactive workspace`}
                          </span>
                        </span>
                        <button
                          type="button"
                          onClick={() => setMiddleTab('segment_main')}
                          className="px-2.5 py-0.5 bg-primary-theme text-white rounded-md font-bold hover:bg-primary-theme-hover cursor-pointer text-xs shrink-0 transition-colors shadow-xs"
                        >
                          {lang === 'zh' ? '切换至环节工作区' : 'Switch to Workspace'}
                        </button>
                      </div>
                    )}
                    {/* Whiteboard canvas wrapper */}
                    <div className="flex-grow flex-1 min-h-0 w-full relative rounded-xl overflow-hidden border border-theme shadow-md bg-surface flex flex-col">
                      <LazyWhiteboard
                        ref={whiteboardRef}
                        lessonId={selectedLesson}
                        classId={liveClassSelectedClassId}
                        userRole={'teacher'}
                        initialPage={restoredCurrentPage}
                        isEditMode={false}
                        broadcastFullscreen
                        fullscreenBroadcastClassId={liveClassSelectedClassId}
                        onFullscreenSync={(elId: string | null) => {
                          setLiveClassFullscreenElementId(elId);
                          syncChannelRef.current?.broadcastFullscreen(elId, selectedLesson || undefined);
                        }}
                        elements={elements}
                        activeSegmentId={activeSegmentId}
                        onSegmentSync={(segId: string) => setActiveSegmentId(segId)}
                        classroomTools={classroomTools}
                        onExecuteTool={handleExecuteTool}
                        hidePageBar={true}
                        onPagesStateChange={({
                          pages,
                          currentPage,
                        }: {
                          pages: WhiteboardPageItem[];
                          currentPage: number;
                        }) => {
                          setWhiteboardPages(pages);
                          setCurrentWhiteboardPage(currentPage);
                        }}
                        onElementAdd={async (type: string, data: any) => {
                          await fetch(`/api/lessons/${selectedLesson}/whiteboard`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ type, data }),
                          });
                          fetchElements(selectedLesson);
                        }}
                        onElementUpdate={async (elementId: string, data: any) => {
                          await fetch(`/api/lessons/${selectedLesson}/whiteboard/${elementId}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ data }),
                          });
                          fetchElements(selectedLesson);
                        }}
                        onElementDelete={async (elementId: string) => {
                          await fetch(`/api/lessons/${selectedLesson}/whiteboard/${elementId}`, {
                            method: 'DELETE',
                          });
                          fetchElements(selectedLesson);
                        }}
                        onRefresh={() => fetchElements(selectedLesson)}
                      />
                    </div>
                  </>
                ) : middleTab === 'submissions' ? (
                  <LiveSubmissionsPanel
                    lang={lang as any}
                    selectedLesson={selectedLesson}
                    liveClassSelectedClassId={liveClassSelectedClassId}
                    attempts={attempts}
                    displayAttempts={displayAttempts}
                    loadingAttempts={loadingAttempts}
                    searchQuery={searchQuery}
                    setSearchQuery={setSearchQuery}
                    submissionFilter={submissionFilter}
                    setSubmissionFilter={setSubmissionFilter}
                    fetchAttempts={fetchAttempts}
                    setMiddleTab={setMiddleTab}
                    autoRecordRule={autoRecordRule}
                    autoRecordRuleLoaded={autoRecordRuleLoaded}
                    savingAutoRecordRule={savingAutoRecordRule}
                    saveAutoRecordRule={saveAutoRecordRule}
                    autoRecordReport={autoRecordReport}
                    runAutoRecord={runAutoRecord}
                    autoRecordRunning={autoRecordRunning}
                    handleViewRaw={handleViewRaw}
                    handlePromoteAttempt={handlePromoteAttempt}
                    handleMarkAbsent={handleMarkAbsent}
                  />
                ) : middleTab === 'top_performers' ? (
                  <div className="flex-grow flex-1 min-h-0 w-full relative rounded-xl overflow-y-auto border border-theme shadow-md bg-surface flex flex-col p-4">
                    <TopPerformersWidget
                      lang={lang as any}
                      lessonId={selectedLesson}
                      classId={liveClassSelectedClassId}
                      lessons={lessons}
                      classes={classes}
                      students={students}
                      addToast={addToast}
                    />
                  </div>
                ) : middleTab === 'segment_main' ? (
                  <div
                    data-testid="classroom-active-segment-main-container"
                    className="flex-grow flex-1 min-h-0 w-full relative rounded-xl overflow-hidden border border-theme shadow-md bg-surface flex flex-col p-4"
                  >
                    {currentActiveSegment ? (
                      <ExtensionPointRenderer
                        slot="classroom.active_segment.main"
                        slotProps={{
                          segment: currentActiveSegment,
                          lessonId: selectedLesson,
                          classId: liveClassSelectedClassId,
                          lang,
                          onRefresh: () => fetchElements(selectedLesson),
                        }}
                      />
                    ) : (
                      <div className="flex-1 flex flex-col items-center justify-center text-muted text-sm space-y-2">
                        <p>{lang === 'zh' ? '当前没有正在进行的教学环节。' : 'No active lesson segment currently.'}</p>
                        <button
                          type="button"
                          onClick={() => setMiddleTab('whiteboard')}
                          className="px-3 py-1 text-xs font-bold bg-primary-theme text-white rounded-lg cursor-pointer hover:bg-primary-theme-hover transition-colors"
                        >
                          {lang === 'zh' ? '返回演示白板' : 'Back to Whiteboard'}
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <TeacherAssignmentGradePanel
                    lessonId={selectedLesson || ''}
                    lang={lang === 'zh' ? 'zh' : 'en'}
                    addToast={addToast}
                  />
                )}
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-subtle gap-2.5 select-none">
                <Presentation
                  size={38}
                  className="text-slate-300 animate-bounce"
                  style={{ animationDuration: '2.5s' }}
                />
                <div className="text-sm font-bold text-muted">
                  {lang === 'zh' ? '请在顶部栏选择一个授课课节' : 'Please select a lesson to start teaching'}
                </div>
                <p className="text-xs text-subtle">白板及环节控制面板将在课节载入后自动生成</p>
              </div>
            )}
          </div>

          {/* Right Column: Students Status & Feedback Log */}
          <div className="w-[264px] shrink-0 bg-surface p-3 border-l border-theme flex flex-col gap-2.5 overflow-hidden transition-all duration-300">
            {/* Student attendance grid */}
            <div className="flex-1 flex flex-col min-h-0 gap-2">
              <div className="flex items-center justify-between shrink-0 select-none pb-0.5">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-xs font-black uppercase tracking-wider text-muted truncate">
                    {lang === 'zh' ? '学生专注力监控' : 'Student Focus Console'}
                  </span>
                  {liveClassSelectedClassId && (
                    <button
                      onClick={handleRandomPick}
                      disabled={students.length === 0 || isDrawing}
                      className="text-[11px] font-bold bg-primary-theme/10 text-primary-ink hover:bg-primary-theme/20 border border-primary-theme/25 px-2 py-0.5 rounded-full transition-all flex items-center gap-1 active:scale-95 disabled:opacity-50 cursor-pointer shadow-2xs shrink-0"
                      title={lang === 'zh' ? '随机抽取一名学生提问' : 'Pick a student randomly'}
                    >
                      <Shuffle size={10} className={isDrawing ? 'animate-spin' : ''} />
                      <span>{lang === 'zh' ? '抽问' : 'Pick'}</span>
                    </button>
                  )}
                </div>
                <span
                  className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border border-theme bg-surface-secondary text-muted shrink-0 flex items-center gap-1"
                  title={lang === 'zh' ? '已锁定学生屏幕人数 (专注 / 答题)' : 'Locked count (Focus / Answer)'}
                >
                  <span>
                    🔒 {students.filter((s) => s.locked_lesson_id === selectedLesson).length}/{students.length}
                  </span>
                  {students.some((s) => s.locked_lesson_id === selectedLesson && s.lock_mode === 'navigation') && (
                    <span className="text-amber-600 text-[9px] font-sans">✏️答题</span>
                  )}
                </span>
              </div>

              {liveClassSelectedClassId ? (
                <div
                  onClick={() => setPinnedStudentId(null)}
                  className="overflow-y-auto flex-1 pr-1 grid grid-cols-3 gap-1.5 justify-items-center auto-rows-max scrollbar-thin py-1"
                >
                  {students.map((st) => {
                    const isStudentLocked = st.locked_lesson_id === selectedLesson;
                    const studentLockMode = st.lock_mode || 'full';
                    const isCheckedIn = liveClassAcknowledgedMap.get(st.id);
                    const isOnline = onlineStudentIds.includes(st.id);
                    const activeLessonId = activeStudentLessons[st.id];
                    const isInLesson = activeLessonId === selectedLesson;

                    const studentProg = liveClassStudentProgress.find((p) => p.student_id === st.id);
                    const progPercent = studentProg?.progress_percent ?? 0;
                    const teacherActiveIdx = activeSegmentId
                      ? timelineSegments.findIndex((s) => s.id === activeSegmentId)
                      : -1;
                    const expectedProgress =
                      timelineSegments.length > 0
                        ? Math.round(((teacherActiveIdx + 1) / timelineSegments.length) * 100)
                        : 0;
                    const isBehind = teacherActiveIdx >= 0 && progPercent < expectedProgress;

                    const isSelectedDraw = selectedDrawStudentIds.includes(st.id);
                    const isActiveDraw = activeDrawStudentId === st.id;
                    const isPinned = pinnedStudentId === st.id;

                    // SVG ring calculation
                    const radius = 19.5;
                    const strokeWidth = 3;
                    const circumference = 2 * Math.PI * radius; // 122.52
                    const strokeDashoffset = circumference - (progPercent / 100) * circumference;

                    // Circular color system
                    let ringColor = 'stroke-primary-theme'; // normal progress / in class
                    if (isSelectedDraw) {
                      ringColor = 'stroke-amber-500 stroke-[3.5px]'; // jackpot winner!
                    } else if (isActiveDraw) {
                      ringColor = 'stroke-indigo-500 stroke-[3.5px] animate-pulse'; // flickering drawer
                    } else if (!isOnline) {
                      ringColor = 'stroke-slate-200 dark:stroke-slate-700'; // offline
                    } else if (isStudentLocked) {
                      ringColor =
                        studentLockMode === 'navigation'
                          ? 'stroke-amber-500 animate-pulse'
                          : 'stroke-rose-500 animate-pulse'; // focus locked vs answer locked
                    } else if (isBehind) {
                      ringColor = 'stroke-amber-500 animate-pulse'; // behind progress
                    } else if (!isInLesson) {
                      ringColor = 'stroke-blue-400'; // not entered lesson but online
                    } else if (progPercent === 100) {
                      ringColor = 'stroke-emerald-500'; // completed
                    }

                    const stErrors = studentErrors.filter((e) => e.studentId === st.id);

                    return (
                      <div
                        key={st.id}
                        role="button"
                        tabIndex={0}
                        aria-pressed={isPinned}
                        aria-label={`学生 ${st.name}，学习进度 ${progPercent}%${isPinned ? '，已固定概况' : ''}`}
                        onMouseEnter={() => setHoveredStudentId(st.id)}
                        onMouseLeave={() => setHoveredStudentId(null)}
                        onClick={(e) => {
                          e.stopPropagation();
                          setPinnedStudentId((prev) => (prev === st.id ? null : st.id));
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            e.stopPropagation();
                            setPinnedStudentId((prev) => (prev === st.id ? null : st.id));
                          }
                        }}
                        className={`group relative flex flex-col items-center justify-center p-1.5 rounded-xl transition-all cursor-pointer w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-theme ${
                          isSelectedDraw
                            ? 'z-20 duration-300 bg-amber-500/10 ring-2 ring-amber-400 shadow-md scale-105'
                            : isActiveDraw
                              ? 'z-20 ring-1 ring-primary-theme bg-primary-theme/5 scale-102'
                              : isPinned
                                ? 'z-10 bg-primary-theme/10 ring-2 ring-primary-theme shadow-xs scale-102'
                                : 'hover:bg-surface-secondary/70'
                        }`}
                      >
                        {/* Main Circular Widget */}
                        <div
                          className={`relative w-12 h-12 flex items-center justify-center rounded-full transition-all duration-300 ${
                            isSelectedDraw
                              ? 'shadow-[0_0_15px_#f59e0b] scale-105 z-10 bg-amber-50 ring-2 ring-amber-400'
                              : isActiveDraw
                                ? 'shadow-[0_0_10px_#6366f1] scale-105 z-10 bg-indigo-50 ring-1 ring-indigo-400'
                                : isPinned
                                  ? 'shadow-xs bg-primary-theme/5 ring-1 ring-primary-theme/30'
                                  : ''
                          }`}
                        >
                          {/* Student Exception Alert Badge */}
                          {stErrors.length > 0 && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                errorStore.getState().setActiveTab('student');
                                errorStore.getState().setIsErrorCenterOpen(true);
                              }}
                              className="absolute -top-1 -right-1 z-30 w-4 h-4 rounded-full bg-rose-600 text-white flex items-center justify-center shadow-md cursor-pointer hover:scale-125 transition-transform"
                              title={`该学生端捕获到 ${stErrors.length} 处异常: ${stErrors[0].title || stErrors[0].message}`}
                            >
                              <AlertTriangle size={9} className="animate-pulse" />
                            </button>
                          )}

                          {/* Pinned indicator badge */}
                          {isPinned && !isSelectedDraw && (
                            <span
                              className="absolute -top-1 -left-1 z-20 text-[9px] bg-primary-theme text-white rounded-full w-3.5 h-3.5 flex items-center justify-center font-bold shadow-xs"
                              title="已固定选中"
                            >
                              <Pin size={7} />
                            </span>
                          )}

                          {/* Golden glow aura for selected draw */}
                          {isSelectedDraw && (
                            <div
                              className="absolute inset-0 rounded-full bg-amber-400/30 animate-ping"
                              style={{ animationDuration: '2s' }}
                            />
                          )}

                          {/* Circular Progress Ring */}
                          <svg className="absolute w-full h-full transform -rotate-90" viewBox="0 0 46 46">
                            {/* Inner circle background */}
                            <circle
                              cx="23"
                              cy="23"
                              r={radius}
                              className="stroke-slate-100 dark:stroke-slate-800 fill-white dark:fill-slate-900"
                              strokeWidth={strokeWidth}
                            />
                            {/* Outer circle progress indicator */}
                            <circle
                              cx="23"
                              cy="23"
                              r={radius}
                              className={`fill-transparent transition-all duration-300 ${ringColor}`}
                              strokeWidth={strokeWidth}
                              strokeDasharray={circumference}
                              strokeDashoffset={strokeDashoffset}
                              strokeLinecap="round"
                            />
                          </svg>

                          {/* Name (Static) or Controls (Hover) */}
                          <div
                            className={`relative z-10 w-8.5 h-8.5 rounded-full flex items-center justify-center overflow-hidden transition-colors ${
                              isSelectedDraw ? 'bg-amber-100/90' : ''
                            }`}
                          >
                            {/* Name view: Visible by default, hidden on hover */}
                            <span
                              className={`text-[11px] font-bold tracking-tight truncate max-w-[32px] group-hover:scale-0 group-hover:opacity-0 transition-all duration-200 select-none ${
                                isSelectedDraw
                                  ? 'text-amber-900 font-extrabold'
                                  : !isOnline
                                    ? 'text-slate-400'
                                    : 'text-slate-700 dark:text-slate-200'
                              }`}
                            >
                              {st.name}
                            </span>

                            {/* Hover action overlay */}
                            <div className="absolute inset-0 flex items-center justify-center gap-1 opacity-0 scale-50 group-hover:opacity-100 group-hover:scale-100 transition-all duration-200 bg-surface/95 rounded-full shadow-inner">
                              {/* Alert / Warning button */}
                              {selectedLesson && onPingStudent && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const msg =
                                      lang === 'zh'
                                        ? `⚠️ 学习进度预警：您当前的进度 (${progPercent}%) 落后于老师的讲解进度。请专注课堂，跟上讲解！`
                                        : `⚠️ Progress Alert: Your progress (${progPercent}%) is behind.`;
                                    onPingStudent(st.id, msg);
                                    addToast(
                                      lang === 'zh' ? '🔔 已发送提醒' : '🔔 Alert Sent',
                                      `已向学生 ${st.name} 发送进度提醒。`,
                                      'success',
                                    );
                                  }}
                                  className={`p-0.5 rounded-md hover:bg-surface-secondary transition-colors shrink-0 cursor-pointer ${
                                    isBehind
                                      ? 'text-amber-500 hover:text-amber-600 animate-pulse'
                                      : 'text-slate-400 hover:text-primary-ink'
                                  }`}
                                  title="提醒"
                                >
                                  <Send size={9} />
                                </button>
                              )}

                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOverrideSegmentGate(st.id);
                                }}
                                disabled={!selectedLesson || !activeSegmentId}
                                className="p-0.5 rounded-md hover:bg-surface-secondary transition-colors shrink-0 cursor-pointer text-slate-400 hover:text-emerald-600"
                                title={lang === 'zh' ? '放行当前环节' : 'Allow this segment'}
                              >
                                <Unlock size={9} />
                              </button>
                              {/* Focus / Answer Lock controller */}
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleToggleStudentLock(st.id, st.locked_lesson_id, st.lock_mode);
                                }}
                                disabled={!selectedLesson}
                                className={`p-0.5 rounded-md hover:bg-surface-secondary transition-colors shrink-0 cursor-pointer ${
                                  isStudentLocked
                                    ? studentLockMode === 'navigation'
                                      ? 'text-amber-500 hover:text-amber-600'
                                      : 'text-rose-500 hover:text-rose-600'
                                    : 'text-slate-400 hover:text-rose-500'
                                }`}
                                title={
                                  isStudentLocked
                                    ? studentLockMode === 'navigation'
                                      ? '解除答题锁定'
                                      : '解除专注锁定'
                                    : '开启专注锁定'
                                }
                              >
                                {isStudentLocked ? (
                                  studentLockMode === 'navigation' ? (
                                    <FileEdit size={9} />
                                  ) : (
                                    <ShieldAlert size={9} />
                                  )
                                ) : (
                                  <Shield size={9} />
                                )}
                              </button>
                            </div>
                          </div>

                          {/* Top-Right Online/Lesson Badge Indicator or Jackpot winner target badge */}
                          {isSelectedDraw ? (
                            <span className="absolute -top-1.5 -right-1.5 z-20 text-[10px] bg-amber-700 text-white rounded-full w-4 h-4 flex items-center justify-center font-bold shadow-md animate-bounce">
                              🎯
                            </span>
                          ) : (
                            isOnline && (
                              <span
                                className={`absolute top-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-surface shrink-0 ${
                                  isInLesson ? 'bg-emerald-500' : 'bg-blue-400'
                                }`}
                                title={isInLesson ? '正在上课' : '在线(但未进课堂)'}
                              />
                            )
                          )}

                          {/* Bottom-Right Acknowledged/Ready Indicator */}
                          {isCheckedIn === true && !isSelectedDraw && (
                            <span
                              className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-surface bg-amber-500 shrink-0 animate-bounce"
                              title="已确认/就位"
                            />
                          )}
                        </div>

                        {/* Small Progress Label or Draw Winner Label */}
                        <span
                          className={`text-[10px] font-mono mt-1 truncate max-w-[48px] select-none font-bold ${
                            isSelectedDraw
                              ? 'text-amber-700 dark:text-amber-400 font-extrabold animate-bounce'
                              : !isOnline
                                ? 'text-slate-400'
                                : progPercent === 100
                                  ? 'text-emerald-700 dark:text-emerald-400'
                                  : isBehind
                                    ? 'text-amber-700 dark:text-amber-400'
                                    : 'text-muted'
                          }`}
                        >
                          {isSelectedDraw ? '🎯 抽中' : `${progPercent}%`}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-xs text-subtle italic py-4 text-center flex-1 flex items-center justify-center">
                  {lang === 'zh' ? '请选择班级以显示学生' : 'Select class to show student monitors.'}
                </div>
              )}
            </div>

            {/* Hover Details / Class Summary Panel */}
            <div className="bg-surface-secondary border border-theme rounded-xl p-3 flex flex-col gap-1.5 h-[128px] shrink-0 shadow-xs select-none justify-center">
              {(() => {
                const activeInspectStudentId = hoveredStudentId ?? pinnedStudentId;
                if (!activeInspectStudentId) {
                  return (
                    // Class summary state when no inspect
                    <div className="flex flex-col gap-1 text-xs text-main h-full justify-center">
                      <div className="font-extrabold text-main border-b border-theme pb-1.5 flex items-center gap-1.5 shrink-0">
                        <Activity size={12} className="text-primary-ink animate-pulse" />
                        <span>{lang === 'zh' ? '班级学情概况' : 'Class Overview'}</span>
                      </div>
                      <div className="grid grid-cols-3 gap-1 text-xs leading-tight mt-1 shrink-0">
                        <div className="flex flex-col items-center bg-surface py-1 px-0.5 rounded-lg border border-theme">
                          <span className="text-muted font-medium text-[10px]">在线/总数</span>
                          <span className="font-bold font-mono text-emerald-700 dark:text-emerald-400 text-xs mt-0.5">
                            {students.filter((s) => onlineStudentIds.includes(s.id)).length}/{students.length}
                          </span>
                        </div>
                        <div className="flex flex-col items-center bg-surface py-1 px-0.5 rounded-lg border border-theme">
                          <span className="text-muted font-medium text-[10px]">屏幕锁定</span>
                          <span className="font-bold font-mono text-xs mt-0.5">
                            <span className="text-rose-600" title="专注锁定">
                              {
                                students.filter(
                                  (s) => s.locked_lesson_id === selectedLesson && s.lock_mode !== 'navigation',
                                ).length
                              }
                            </span>
                            <span className="text-muted">/</span>
                            <span className="text-amber-600" title="答题锁定">
                              {
                                students.filter(
                                  (s) => s.locked_lesson_id === selectedLesson && s.lock_mode === 'navigation',
                                ).length
                              }
                            </span>
                          </span>
                        </div>
                        <div className="flex flex-col items-center bg-surface py-1 px-0.5 rounded-lg border border-theme">
                          <span className="text-muted font-medium text-[10px]">平均进度</span>
                          <span className="font-bold font-mono text-primary-ink text-xs mt-0.5">
                            {(() => {
                              const inClassStudents = students.filter((s) => onlineStudentIds.includes(s.id));
                              if (inClassStudents.length === 0) return '0%';
                              const total = inClassStudents.reduce((sum, s) => {
                                const p = liveClassStudentProgress.find((prog) => prog.student_id === s.id);
                                return sum + (p?.progress_percent ?? 0);
                              }, 0);
                              return `${Math.round(total / inClassStudents.length)}%`;
                            })()}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                }

                const st = students.find((s) => s.id === activeInspectStudentId);
                if (!st) return null;
                const isPinned = pinnedStudentId === st.id;
                const isHoverPreview =
                  hoveredStudentId === st.id && pinnedStudentId !== null && pinnedStudentId !== st.id;
                const studentProg = liveClassStudentProgress.find((p) => p.student_id === st.id);
                const progPercent = studentProg?.progress_percent ?? 0;
                const completedSegIds = (() => {
                  if (!studentProg || !studentProg.completed_segments) return [];
                  try {
                    return typeof studentProg.completed_segments === 'string'
                      ? JSON.parse(studentProg.completed_segments)
                      : studentProg.completed_segments;
                  } catch (e) {
                    return [];
                  }
                })();

                const stErrors = studentErrors.filter((e) => e.studentId === st.id);

                return (
                  <div className="flex flex-col gap-1.5 text-xs text-main">
                    <div className="font-extrabold text-main border-b border-theme pb-1 flex justify-between items-center shrink-0">
                      <span className="flex items-center gap-1.5 truncate">
                        <span
                          className={`w-2 h-2 rounded-full shrink-0 ${onlineStudentIds.includes(st.id) ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'}`}
                        />
                        <span className="truncate max-w-[120px]">
                          {st.name} ({st.student_number || 'N/A'})
                        </span>
                        {st.locked_lesson_id === selectedLesson && (
                          <span
                            className={`text-[9px] px-1 py-0.2 rounded font-bold border shrink-0 ${
                              st.lock_mode === 'navigation'
                                ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-600 border-amber-200 dark:border-amber-800'
                                : 'bg-rose-50 dark:bg-rose-950/40 text-rose-600 border-rose-200 dark:border-rose-800'
                            }`}
                          >
                            {st.lock_mode === 'navigation' ? '✏️答题锁' : '🔒专注锁'}
                          </span>
                        )}
                        {isPinned && !isHoverPreview && (
                          <span
                            className="text-[10px] font-semibold text-primary-ink bg-primary-theme/10 border border-primary-theme/20 px-1 py-0.2 rounded flex items-center gap-0.5 shrink-0"
                            title="已固定显示该学生概况，点击空白处或 Esc 取消"
                          >
                            <Pin size={8} className="rotate-45" />
                            <span>固定</span>
                          </span>
                        )}
                        {isHoverPreview && (
                          <span
                            className="text-[10px] font-semibold text-amber-700 bg-amber-500/10 border border-amber-500/20 px-1 py-0.2 rounded shrink-0"
                            title="临时悬浮预览中，鼠标移开后恢复已固定学生"
                          >
                            预览
                          </span>
                        )}
                        {stErrors.length > 0 && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              errorStore.getState().setActiveTab('student');
                              errorStore.getState().setIsErrorCenterOpen(true);
                            }}
                            className="flex items-center gap-1 text-[10px] font-bold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 px-1 py-0.2 rounded hover:bg-rose-100 transition-colors cursor-pointer shrink-0"
                            title={`学生端存在 ${stErrors.length} 处异常: ${stErrors[0].title || stErrors[0].message}`}
                          >
                            <AlertTriangle size={10} className="text-rose-700 dark:text-rose-400 animate-pulse" />
                            <span>{stErrors.length} 异常</span>
                          </button>
                        )}
                      </span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {selectedLesson &&
                          (st.locked_lesson_id === selectedLesson ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleToggleStudentLock(
                                  st.id,
                                  st.locked_lesson_id,
                                  st.lock_mode,
                                  st.lock_mode === 'navigation' ? 'full' : 'navigation',
                                );
                              }}
                              className="text-[9px] px-1 py-0.2 rounded bg-surface hover:bg-surface-secondary border border-theme text-primary-ink font-bold transition-colors cursor-pointer"
                              title={st.lock_mode === 'navigation' ? '切换为专注锁定' : '切换为答题锁定'}
                            >
                              {st.lock_mode === 'navigation' ? '切专注' : '切答题'}
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleToggleStudentLock(st.id, null, null, 'navigation');
                              }}
                              className="text-[9px] px-1 py-0.2 rounded bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100 text-amber-600 border border-amber-200 dark:border-amber-800 font-bold transition-colors cursor-pointer"
                              title="对该学生开启答题锁定"
                            >
                              答题锁
                            </button>
                          ))}
                        <span className="text-xs text-primary-ink font-mono font-black">{progPercent}%</span>
                        {isPinned && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setPinnedStudentId(null);
                            }}
                            className="text-muted hover:text-main p-0.5 rounded hover:bg-surface transition-colors cursor-pointer"
                            title="取消固定"
                            aria-label="取消固定学生概况"
                          >
                            <X size={11} />
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-1.5 text-xs leading-tight shrink-0">
                      <div className="flex flex-col gap-0.5 bg-surface p-1 rounded-lg border border-theme">
                        <span className="text-muted font-bold text-[10px]">随堂测验</span>
                        <span
                          className={`font-bold font-mono text-xs ${studentProg != null && studentProg.quiz_score !== null ? 'text-primary-ink' : 'text-muted'}`}
                        >
                          {studentProg != null && studentProg.quiz_score !== null
                            ? `${studentProg.quiz_score} / 100`
                            : '未提交'}
                        </span>
                      </div>

                      <div className="flex flex-col gap-0.5 bg-surface p-1 rounded-lg border border-theme">
                        <span className="text-muted font-bold text-[10px]">教学环节进度</span>
                        <span className="font-bold text-main text-xs">
                          {Array.isArray(completedSegIds) ? completedSegIds.length : 0} / {timelineSegments.length}
                        </span>
                      </div>
                    </div>

                    <div className="text-xs text-muted leading-relaxed truncate mt-0.5 shrink-0">
                      环节:{' '}
                      {timelineSegments.length > 0 ? (
                        timelineSegments.map((seg, sIdx) => {
                          const isSegCompleted = Array.isArray(completedSegIds) && completedSegIds.includes(seg.id);
                          return (
                            <span
                              key={seg.id}
                              className={`mr-1 px-1 py-0.2 rounded text-[10px] ${isSegCompleted ? 'bg-emerald-50 text-emerald-700 border border-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-400' : 'bg-surface text-muted border border-theme'}`}
                              title={seg.title}
                            >
                              {sIdx + 1}:{isSegCompleted ? '✓' : '✗'}
                            </span>
                          );
                        })
                      ) : (
                        <span className="italic text-muted">暂无步骤</span>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Feedback log feed (Collapsible) */}
            <div
              className={`flex flex-col border-t border-theme pt-2 min-h-0 gap-1.5 shrink-0 transition-all duration-300 ease-in-out ${
                isFeedCollapsed ? 'h-[36px]' : 'h-[165px]'
              }`}
            >
              <div
                onClick={() => setIsFeedCollapsed((prev) => !prev)}
                className="flex items-center justify-between text-xs font-black uppercase text-muted tracking-wider select-none cursor-pointer hover:text-main transition-colors px-0.5 group"
                title={
                  isFeedCollapsed
                    ? lang === 'zh'
                      ? '点击展开课堂互动反馈流'
                      : 'Click to expand feed'
                    : lang === 'zh'
                      ? '点击收起课堂互动反馈流'
                      : 'Click to collapse feed'
                }
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <ChevronDown
                    size={13}
                    className={`text-muted group-hover:text-primary-ink transition-transform duration-200 shrink-0 ${
                      isFeedCollapsed ? '-rotate-90' : 'rotate-0'
                    }`}
                  />
                  <MessageSquare size={12} className="text-primary-ink shrink-0" />
                  <span className="font-extrabold text-main text-xs truncate">
                    {lang === 'zh' ? '课堂互动反馈流' : 'Live Feed'}
                  </span>
                  <span className="text-[10px] font-mono font-bold px-1.5 py-0.2 rounded-full bg-surface-secondary border border-theme text-muted shrink-0">
                    {liveClassFeed.length}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                  {!isFeedCollapsed && (
                    <button
                      onClick={() =>
                        setLiveClassFeed([
                          {
                            id: 'clear',
                            time: new Date().toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                              second: '2-digit',
                            }),
                            type: 'info',
                            message: '反馈流已清空。',
                          },
                        ])
                      }
                      className="text-[10px] font-bold hover:text-rose-700 dark:hover:text-rose-400 text-muted transition-colors flex items-center gap-0.5 px-1 py-0.5 rounded hover:bg-surface-secondary cursor-pointer"
                      title={lang === 'zh' ? '清空互动反馈记录' : 'Clear feed'}
                    >
                      <Trash2 size={10} />
                      <span>Clear</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setIsFeedCollapsed((prev) => !prev)}
                    className="text-[10px] text-muted hover:text-primary-ink font-medium cursor-pointer"
                  >
                    {isFeedCollapsed ? (lang === 'zh' ? '展开' : 'Expand') : lang === 'zh' ? '收起' : 'Collapse'}
                  </button>
                </div>
              </div>

              {!isFeedCollapsed && (
                <div className="flex-1 bg-surface-secondary/70 border border-theme rounded-xl p-2 font-mono text-[11px] leading-relaxed overflow-y-auto space-y-1.5 select-text text-left text-main shadow-inner scrollbar-thin">
                  {liveClassFeed.map((f) => (
                    <div key={f.id} className="border-b border-theme pb-1 last:border-b-0">
                      <div className="flex justify-between items-center text-muted font-bold mb-0.5">
                        <span className="text-[10px]">{f.time}</span>
                        <span
                          className={`px-1 rounded uppercase tracking-wide text-[9px] ${
                            f.type === 'success'
                              ? 'bg-emerald-50 text-emerald-600 border border-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-400'
                              : f.type === 'warning'
                                ? 'bg-amber-50 text-amber-700 border border-amber-100 dark:bg-amber-950/40 dark:text-amber-400'
                                : 'bg-surface text-muted border border-theme'
                          }`}
                        >
                          {f.type}
                        </span>
                      </div>
                      <p
                        className={
                          f.type === 'success'
                            ? 'text-emerald-700 dark:text-emerald-300 font-medium'
                            : f.type === 'warning'
                              ? 'text-amber-700 dark:text-amber-300 font-medium'
                              : 'text-main'
                        }
                      >
                        {f.message}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Raw Data Detail Modal */}
      {selectedAttempt && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-surface rounded-2xl shadow-2xl max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden border border-theme animate-in fade-in zoom-in duration-200 text-main">
            {/* Modal Header */}
            <div className="bg-surface-secondary px-6 py-4 border-b border-theme flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="text-primary-ink" size={18} />
                <h3 className="text-sm font-bold text-main">
                  {lang === 'zh'
                    ? `[${selectedAttempt.studentName}] 的互动提交轨迹详情`
                    : `Submission Details - ${selectedAttempt.studentName}`}
                </h3>
              </div>
              <button
                onClick={() => setSelectedAttempt(null)}
                className="text-muted hover:text-main p-1.5 hover:bg-surface-secondary rounded-lg transition-colors cursor-pointer"
              >
                <XCircle size={18} />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6 overflow-y-auto space-y-4 flex-1 scrollbar-thin">
              {/* Summary Cards */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-surface-secondary p-3 rounded-xl border border-theme">
                  <div className="text-xs text-muted font-bold uppercase tracking-wider">
                    {lang === 'zh' ? '课件名称' : 'Courseware'}
                  </div>
                  <div className="text-xs font-semibold text-main mt-1 truncate" title={selectedAttempt.coursewareName}>
                    {selectedAttempt.coursewareName}
                  </div>
                </div>
                <div className="bg-surface-secondary p-3 rounded-xl border border-theme">
                  <div className="text-xs text-muted font-bold uppercase tracking-wider">
                    {lang === 'zh' ? '提交成绩' : 'Score'}
                  </div>
                  <div className="text-xs font-bold text-primary-ink mt-1">
                    {selectedAttempt.score !== null ? `${selectedAttempt.score} 分` : lang === 'zh' ? '未打分' : 'N/A'}
                  </div>
                </div>
                <div className="bg-surface-secondary p-3 rounded-xl border border-theme">
                  <div className="text-xs text-muted font-bold uppercase tracking-wider">
                    {lang === 'zh' ? '课件完成度' : 'Completion'}
                  </div>
                  <div className="text-xs font-bold text-emerald-600 mt-1">
                    {selectedAttempt.completion !== null ? `${Math.round(selectedAttempt.completion * 100)}%` : '0%'}
                  </div>
                </div>
              </div>

              {/* Event Logs Timeline */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold text-main border-b border-theme pb-1.5 flex items-center gap-1.5 flex-wrap">
                  <Activity size={13} className="text-primary-ink" />
                  <span>{lang === 'zh' ? '实时捕获轨迹事件流 (LMS Bridge)' : 'LMS Event Captures'}</span>
                </h4>

                {loadingRaw ? (
                  <div className="py-12 flex flex-col items-center justify-center text-muted gap-2">
                    <RefreshCw size={20} className="animate-spin text-primary-ink" />
                    <span className="text-xs">{lang === 'zh' ? '正在查询原始数据...' : 'Loading raw data...'}</span>
                  </div>
                ) : Array.isArray(rawPayload) && rawPayload.length > 0 ? (
                  <div className="space-y-3 font-mono text-xs max-h-[40vh] overflow-y-auto pr-1 scrollbar-thin">
                    {rawPayload.map((evt, idx) => {
                      let parsedPayload = {};
                      try {
                        parsedPayload =
                          typeof evt.payload_json === 'string' ? JSON.parse(evt.payload_json) : evt.payload_json;
                      } catch (e) {}

                      return (
                        <div
                          key={evt.id || idx}
                          className="p-3 bg-slate-900 text-slate-200 rounded-xl border border-slate-800 flex flex-col gap-1.5"
                        >
                          <div className="flex justify-between items-center text-xs text-slate-400 border-b border-slate-800 pb-1">
                            <span className="font-bold text-indigo-400 bg-indigo-950/50 border border-indigo-900/50 px-1.5 py-0.5 rounded">
                              {evt.event_type}
                            </span>
                            <span>{new Date(evt.created_at).toLocaleTimeString()}</span>
                          </div>
                          <pre className="overflow-x-auto text-xs leading-relaxed p-1 text-emerald-400/90 whitespace-pre-wrap word-break-all">
                            {JSON.stringify(parsedPayload, null, 2)}
                          </pre>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="py-8 text-center text-xs text-muted italic">
                    {lang === 'zh' ? '该学生未产生任何轨迹事件数据。' : 'No trace events captured.'}
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="bg-surface-secondary px-6 py-4 border-t border-theme flex justify-between gap-3 shrink-0">
              <div className="text-xs text-muted flex items-center gap-1">
                <Award size={10} />
                <span>Powered by LMS Bridge API v1</span>
              </div>
              <button
                onClick={() => setSelectedAttempt(null)}
                className="px-4 py-1.5 bg-surface hover:bg-surface-secondary border border-theme text-main font-bold rounded-lg text-xs transition-all cursor-pointer shadow-sm active:scale-95"
              >
                {lang === 'zh' ? '关闭窗口' : 'Close'}
              </button>
            </div>
          </div>
        </div>
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
        onCloseGroupCollab={() => setIsGroupCollabOpen(false)}
        isShowcaseDiffOpen={isShowcaseDiffOpen}
        onCloseShowcaseDiff={() => setIsShowcaseDiffOpen(false)}
        isMacroRunnerOpen={isMacroRunnerOpen}
        onCloseMacroRunner={() => setIsMacroRunnerOpen(false)}
        isHardwareSettingsOpen={isHardwareSettingsOpen}
        onCloseHardwareSettings={() => setIsHardwareSettingsOpen(false)}
      />

      {/* ── 切换上课课程确认模态窗 ── */}
      {isSwitchLessonConfirmOpen && (
        <div
          id="live-classroom-switch-lesson-modal"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-150 select-none"
        >
          <div className="bg-surface border border-theme rounded-2xl shadow-2xl max-w-md w-full p-5 flex flex-col gap-4 text-main">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/25 flex items-center justify-center shrink-0">
                <AlertCircle size={22} />
              </div>
              <div>
                <h3 className="text-sm font-extrabold text-main">
                  {lang === 'zh' ? '确认切换上课课程？' : 'Confirm Lesson Switch?'}
                </h3>
                <p className="text-xs text-muted mt-0.5">
                  {lang === 'zh' ? '当前课堂将立即切换至新课程' : 'Current live session will switch to new lesson'}
                </p>
              </div>
            </div>

            <div className="p-3 bg-surface-secondary/70 border border-theme/60 rounded-xl flex flex-col gap-2 text-xs">
              <div className="flex items-center justify-between text-muted">
                <span>{lang === 'zh' ? '当前课程' : 'Current Lesson'}:</span>
                <span className="font-semibold text-main truncate max-w-[240px]">
                  {lessons.find((l) => l.id === selectedLesson)?.title || (lang === 'zh' ? '未选择' : 'None')}
                </span>
              </div>
              <div className="flex items-center justify-center text-muted">
                <ArrowDown size={14} className="text-primary-ink animate-bounce" />
              </div>
              <div className="flex items-center justify-between text-primary-ink font-bold">
                <span>{lang === 'zh' ? '目标新课程' : 'New Lesson'}:</span>
                <span className="truncate max-w-[240px]">{lessons.find((l) => l.id === pendingLessonId)?.title}</span>
              </div>
            </div>

            <p className="text-xs text-muted leading-relaxed">
              {lang === 'zh'
                ? '切换后，课堂白板、教学环节步骤与已连接的学生端屏幕将同步切换至新课程。是否确认切换？'
                : 'Switching lessons will update the whiteboard, lesson segments, and sync the screen for all connected students. Continue?'}
            </p>

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-theme/60">
              <button
                type="button"
                id="live-classroom-switch-lesson-cancel-btn"
                onClick={() => {
                  setPendingLessonId(selectedLesson);
                  setIsSwitchLessonConfirmOpen(false);
                }}
                className="px-3.5 py-1.5 rounded-xl border border-theme hover:bg-surface-secondary text-xs font-semibold text-main transition-colors cursor-pointer"
              >
                {lang === 'zh' ? '取消' : 'Cancel'}
              </button>
              <button
                type="button"
                id="live-classroom-switch-lesson-confirm-btn"
                onClick={() => {
                  if (pendingLessonId) {
                    setSelectedLesson(pendingLessonId);
                    fetchElements(pendingLessonId);
                    addToast?.(
                      lang === 'zh' ? '课程已切换' : 'Lesson Switched',
                      lang === 'zh'
                        ? `已切换到课程《${lessons.find((l) => l.id === pendingLessonId)?.title}》`
                        : 'Switched successfully',
                      'success',
                    );
                  }
                  setIsSwitchLessonConfirmOpen(false);
                }}
                className="px-4 py-1.5 rounded-xl bg-primary-solid hover:opacity-90 text-white text-xs font-bold transition-all shadow-sm cursor-pointer"
              >
                {lang === 'zh' ? '确认切换' : 'Confirm Switch'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
