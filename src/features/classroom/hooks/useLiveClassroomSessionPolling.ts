import { useState, useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { appStore } from '../../../store/appStore';
import { isInProgressClassLocked } from '../class-session-lock';
import { isTerminalResourceStatus } from '../../../utils/polling-guard';

export type LessonAccessError = { status: number; endpoint: string } | null;

export function useLiveClassroomSessionPolling(options: {
  selectedLesson: string | null;
  initialPortalOpen: boolean;
  isActiveClassroomView: boolean;
  activeSegmentId: string | null;
  reportLessonAccessError: (status: number, endpoint: string) => void;
  userReturnedToPortalRef: MutableRefObject<boolean>;
  enteredClassroomRef: MutableRefObject<boolean>;
  viewingSpecificReportRef: MutableRefObject<string | null>;
  setClassroomStage: Dispatch<SetStateAction<string>>;
  setSessionStartedAt: Dispatch<SetStateAction<number | null>>;
  setEntryDecisionReady: Dispatch<SetStateAction<boolean>>;
  setHasActiveSession: Dispatch<SetStateAction<boolean>>;
  setLessonAccessError: Dispatch<SetStateAction<LessonAccessError>>;
  setShowEntryPortal: Dispatch<SetStateAction<boolean>>;
  setSelectedLesson: (id: string | null) => void;
  setLiveClassSelectedClassId: (id: string | null) => void;
  setLiveClassFeed: Dispatch<SetStateAction<any[]>>;
  setActiveSegmentId: (id: string | null) => void;
  setRestoredCurrentPage: Dispatch<SetStateAction<number | undefined>>;
}) {
  const {
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
    setShowEntryPortal,
    setSelectedLesson,
    setLiveClassSelectedClassId,
    setLiveClassFeed,
    setActiveSegmentId,
    setRestoredCurrentPage,
  } = options;

  const [rollcallCounts, setRollcallCounts] = useState<Map<string, number>>(new Map());

  // 轮询课堂会话：真实 stage + 真实开课时间（驱动 elapsedMin / AI 预测 / 家校通知）
  useEffect(() => {
    if (!selectedLesson) {
      setClassroomStage('PRE_CLASS_READY');
      setSessionStartedAt(null);
      setEntryDecisionReady(true);
      return;
    }
    let mounted = true;
    let stopped = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    const stopPolling = () => {
      stopped = true;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };
    if (!userReturnedToPortalRef.current) {
      setEntryDecisionReady(false);
    }
    // 若当前正在定点查看某场历史会话战报，不重置为 PRE_CLASS_READY
    if (!viewingSpecificReportRef.current) {
      setClassroomStage('PRE_CLASS_READY');
    }
    const fetchSession = () => {
      if (stopped) return;
      fetch(`/api/classroom/sessions/${selectedLesson}`)
        .then((res) => {
          if (isTerminalResourceStatus(res.status)) {
            stopPolling();
            if (mounted) {
              setHasActiveSession(false);
              setSessionStartedAt(null);
              reportLessonAccessError(res.status, 'session');
              if (initialPortalOpen && (res.status === 403 || res.status === 404)) {
                setShowEntryPortal(true);
                setSelectedLesson(null);
              }
            }
            return null;
          }
          return res.ok ? res.json() : null;
        })
        .then((data) => {
          if (!mounted || stopped) return;
          if (!data) return;
          setLessonAccessError(null);
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
          // 统一落回起始门户：门户内的「课堂进行中」提示条负责恢复当前会话，
          // 不再把教师先送到独立的进行中会话列表页。
          if (classLocked && !userReturnedToPortalRef.current && !enteredClassroomRef.current) {
            setShowEntryPortal(true);
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
    if (!stopped) {
      timer = setInterval(fetchSession, 15000);
    }
    return () => {
      mounted = false;
      stopPolling();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 与 LiveClassroomView 原 effect 依赖一致
  }, [selectedLesson, initialPortalOpen, reportLessonAccessError]);

  // Issue #243：归因弹窗「今日抽中 N 次」改为真实计数 —— 手动抽问与白板
  // rollcall 写侧早已落库 student_rollcalls，此处按会话轮询同节奏（15s）
  // 拉取按日聚合，抽问后计数随之增长。仅在真正进入授课视图后才轮询，避免门户页误触发 403。
  useEffect(() => {
    if (!isActiveClassroomView || !selectedLesson) {
      setRollcallCounts(new Map());
      return;
    }
    let mounted = true;
    let stopped = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    const stopPolling = () => {
      stopped = true;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };
    const fetchCounts = () => {
      if (stopped) return;
      fetch(`/api/lessons/${selectedLesson}/rollcall-counts`)
        .then((res) => {
          if (isTerminalResourceStatus(res.status)) {
            stopPolling();
            if (mounted) {
              setRollcallCounts(new Map());
              reportLessonAccessError(res.status, 'rollcall-counts');
            }
            return null;
          }
          return res.ok ? res.json() : null;
        })
        .then((data) => {
          if (!mounted || stopped || !data?.counts) return;
          setRollcallCounts(new Map(Object.entries(data.counts as Record<string, number>)));
        })
        .catch(() => {});
    };
    fetchCounts();
    if (!stopped) {
      timer = setInterval(fetchCounts, 15000);
    }
    return () => {
      mounted = false;
      stopPolling();
    };
  }, [isActiveClassroomView, selectedLesson, reportLessonAccessError]);

  return { rollcallCounts };
}
