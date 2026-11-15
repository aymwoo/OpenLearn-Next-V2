import { useState, useEffect, useRef, useCallback } from 'react';
import type { useToast } from './useToast';
import { fetchAuthSession, saveOnboardingStatus } from '../services/sessionService.js';

const LEGACY_TOUR_COMPLETED_KEY = 'edu_os_tour_completed';
const TOUR_STATUS_KEY_PREFIX = 'edu_os_tour_status:';

function getTourAccountKey(s: { userId?: string; id?: string; username?: string } | null): string | null {
  if (!s) return null;
  return s.userId || s.id || s.username || null;
}

function readStoredTourStatus(accountKey: string | null): 'completed' | 'skipped' | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    if (accountKey) {
      const raw = window.localStorage.getItem(`${TOUR_STATUS_KEY_PREFIX}${accountKey}`);
      if (raw === 'completed' || raw === 'skipped') return raw;
    }
    // 兼容已有 Playwright E2E 与历史单键存储
    if (window.localStorage.getItem(LEGACY_TOUR_COMPLETED_KEY) === 'true') {
      return 'completed';
    }
  } catch {
    // localStorage 不可用时降级，由服务端状态与内存守卫兜底
  }
  return null;
}

function writeStoredTourStatus(accountKey: string | null, status: 'completed' | 'skipped'): boolean {
  if (typeof window === 'undefined' || !window.localStorage || !accountKey) return false;
  try {
    window.localStorage.setItem(`${TOUR_STATUS_KEY_PREFIX}${accountKey}`, status);
    return true;
  } catch {
    return false;
  }
}
import { useSessionBootstrap } from './useSessionBootstrap';
import { useStudentViewState } from './useStudentViewState';
import { useAppStore, appStore } from '../store/appStore';
import { useThemeStore } from '../store/themeStore';
import { useFontSizeStore } from '../store/fontSizeStore';
import { tabToHash, hashToTab } from '../utils/teacherTabHash';

export interface SessionSliceParams {
  lang: 'zh' | 'en';
  addToast: ReturnType<typeof useToast>['addToast'];
  fetchStudents: () => Promise<void>;
}

/**
 * 会话域切片（useAppComposer 按域拆分之一）：模式检测、会话恢复、
 * 学生视图收口、hash 路由、主题/字号初始化、新手指引。
 *
 * 行为与拆分前 useAppComposer 内联实现逐行一致，仅做物理搬运。
 */
export function useSessionSlice({ lang, addToast, fetchStudents }: SessionSliceParams) {
  const [mainNavCollapsed, setMainNavCollapsed] = useState(false);

  // ── 互动课堂：独立弹窗学生端联动模式检测与状态 ────────────────────────────
  const isStudentLiveMode =
    typeof window !== 'undefined' &&
    (new URLSearchParams(window.location.search).get('mode') === 'student_live' ||
      window.location.hash.includes('student_live'));
  const liveStudentParam =
    typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('studentId') : null;
  const liveLessonParam =
    typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('lessonId') : null;
  const liveClassParam =
    typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('classId') : null;

  // ── 大屏展台独立窗口（副屏 / 投影） ─────────────────────────────────────────
  // 教师在「在线课堂」点「打开大屏展台」后由 window.open 拉起（带 lessonId）。
  // 该窗口自行维持连接（Socket 主导 + 低频轮询兜底），与主窗口互不依赖：
  // 教师切课节、切标签页都不会中断展台的数据流。
  const isStageDisplayMode =
    typeof window !== 'undefined' &&
    (new URLSearchParams(window.location.search).get('mode') === 'stage_display' ||
      window.location.hash.includes('stage_display'));
  const stageLessonParam =
    typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('lessonId') : null;
  const stageTitleParam =
    typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('title') : null;
  const stageLangParam = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('lang') : null;

  // ── 课程编辑器「学生视角」预览标签页 ────────────────────────────────────────
  // 与 student_live 的区别：这是教师自己开的备课预览标签页，保留完整的常规顶栏与
  // 模拟学生横幅（退出动作改为「关闭标签页」），且不接入课堂实时同步信道。
  const isStudentPreviewMode =
    typeof window !== 'undefined' &&
    (new URLSearchParams(window.location.search).get('mode') === 'student_preview' ||
      window.location.hash.includes('student_preview'));
  // 需要强制进入学生端角色的两种标签页模式
  const isStudentTabMode = isStudentLiveMode || isStudentPreviewMode;

  const [isFollowingTeacher, setIsFollowingTeacher] = useState(true);
  const [liveClassFocusLocked, setLiveClassFocusLocked] = useState(false);
  // 锁定期间强制跟随教师步调；具体在 studentViewStatus 声明处统一生效

  useEffect(() => {
    useThemeStore.getState().initTheme();
    useFontSizeStore.getState().initFontSize();

    // 全局快捷键支持：Ctrl + Alt + +/- 放大/缩小，Ctrl + Alt + 0 恢复标准字号
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.altKey) {
        if (e.key === '+' || e.key === '=') {
          e.preventDefault();
          useFontSizeStore.getState().increaseScale();
        } else if (e.key === '-' || e.key === '_') {
          e.preventDefault();
          useFontSizeStore.getState().decreaseScale();
        } else if (e.key === '0') {
          e.preventDefault();
          useFontSizeStore.getState().resetScale();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Role & Student View
  const session = useAppStore((s) => s.session);
  const setSession = useAppStore((s) => s.setSession);
  const [sessionLoading, setSessionLoading] = useState(true);

  // ── C1-R2e: 会话引导 hook（session 恢复 effect 仍留在 App，因其依赖 student 视图收口）──
  const sessionBootstrapData = useSessionBootstrap({ fetchStudents });
  const {
    activeRole,
    setActiveRole,
    activeStudentId,
    setActiveStudentId,
    dbConnected,
    dbStatus,
    profileOpen,
    setProfileOpen,
    handleLoginSuccess,
    handleLogout,
    toggleLanguage,
  } = sessionBootstrapData;

  const students = useAppStore((s) => s.students);
  // 订阅 dataVersion：loadClasses / loadStudents 自增，保证下游重渲染。
  const dataVersion = useAppStore((s) => s.dataVersion);
  void dataVersion;
  const setSelectedLesson = useAppStore((s) => s.setSelectedLesson);

  // ── C1-R2d: 学生视图收口（liveClassFocusLocked 锁定期间强制跟随教师步调）──
  const studentViewStateData = useStudentViewState({
    activeStudentId,
    activeRole,
    students,
    liveClassFocusLocked,
    setIsFollowingTeacher,
    lang,
    addToast,
  });
  const {
    studentViewStatus,
    setStudentViewStatus,
    isStudentLocked,
    isNavigationLocked,
    isInteractionLocked,
    studentLockMode,
    studentLockTarget,
    studentLessonTab,
    setStudentLessonTab,
    studentSelectedCourseware,
    setStudentSelectedCourseware,
    studentFullscreenPanel,
    setStudentFullscreenPanel,
    isStudentLessonContentCollapsed,
    setIsStudentLessonContentCollapsed,
    notifyLockedNavigation,
  } = studentViewStateData;

  useEffect(() => {
    const checkSession = async () => {
      try {
        const { ok, data } = await fetchAuthSession();
        if (ok && data) {
          if (data.session) {
            setSession(data.session);
            if (isStudentTabMode) {
              // 独立标签页学生模式（课堂联动 / 备课预览）：强制进入学生端课节模式
              setActiveRole('student');
              setStudentViewStatus('lesson');
              const targetStudentId = liveStudentParam || data.session.studentId;
              if (targetStudentId) {
                setActiveStudentId(targetStudentId);
              }
              if (liveLessonParam) {
                setSelectedLesson(liveLessonParam);
              }
              fetchStudents();
            } else {
              setActiveRole(data.session.role);
              if (liveLessonParam) {
                setSelectedLesson(liveLessonParam);
              }
              if (data.session.role === 'student' && data.session.studentId) {
                setActiveStudentId(data.session.studentId);
                fetchStudents();
              }
            }
          }
        }
      } catch (err) {
        console.warn('Session check failed', err);
      } finally {
        setSessionLoading(false);
      }
    };
    checkSession();
  }, []);

  // Issue #484：账号会话切换 / 登出时同步服务端隔离的主题偏好与站点默认公开主题
  useEffect(() => {
    if (sessionLoading) return;
    void useThemeStore.getState().syncWithSession(
      session
        ? {
            userId: session.userId,
            studentId: session.studentId,
            role: session.role,
          }
        : null,
    );
  }, [sessionLoading, session?.userId, session?.studentId, session?.role]);

  const teacherTab = useAppStore((state) => state.teacherTab);
  const setTeacherTab = useAppStore((state) => state.setTeacherTab);

  // ── Hash-based routing: reflect teacherTab in the address bar ──
  // Deep link + back/forward support: read the active tab from the URL hash.
  const isFirstMountRef = useRef(true);

  useEffect(() => {
    if (isStudentTabMode || isStageDisplayMode) return;
    const applyHash = () => {
      const tab = hashToTab(window.location.hash);
      if (tab && tab !== appStore.getState().teacherTab) {
        setTeacherTab(tab);
      }
    };
    window.addEventListener('hashchange', applyHash);
    const initial = hashToTab(window.location.hash);
    if (initial && initial !== appStore.getState().teacherTab) {
      setTeacherTab(initial);
    }
    return () => window.removeEventListener('hashchange', applyHash);
  }, [setTeacherTab, isStudentTabMode, isStageDisplayMode]);

  // Write the active tab back into the URL hash so the address bar shows it.
  useEffect(() => {
    if (isStudentTabMode || isStageDisplayMode) return;
    if (isFirstMountRef.current) {
      isFirstMountRef.current = false;
      const initialFromUrl = hashToTab(window.location.hash);
      // 若挂载时 URL 中已有非空合法 tab 且与当前 store 中的 teacherTab 不一致，
      // 首帧跳过改写，让读 hash 逻辑优先完成同步，避免将 URL 强制覆盖为默认 tab
      if (initialFromUrl && initialFromUrl !== teacherTab) {
        return;
      }
    }
    const desired = tabToHash(teacherTab);
    if (window.location.hash !== desired) {
      window.location.hash = desired;
    }
  }, [teacherTab, setTeacherTab, isStudentTabMode, isStageDisplayMode]);

  const [isTourOpen, setIsTourOpen] = useState(false);
  const dismissedTourUsersRef = useRef<Set<string>>(new Set());
  const [isApprovalsCollapsed, setIsApprovalsCollapsed] = useState(false);
  const [isProcessesCollapsed, setIsProcessesCollapsed] = useState(false);

  const dismissTour = useCallback(
    async (status: 'completed' | 'skipped') => {
      const currentSession = appStore.getState().session;
      const accountKey = getTourAccountKey(currentSession);
      const guardKey = accountKey ?? '__anonymous__';

      dismissedTourUsersRef.current.add(guardKey);
      setIsTourOpen(false);

      if (!currentSession) return;

      const storedLocally = writeStoredTourStatus(accountKey, status);
      let persistedOnServer = false;
      try {
        const res = await saveOnboardingStatus(status);
        persistedOnServer = Boolean(res.ok);
      } catch {
        persistedOnServer = false;
      }

      if (persistedOnServer) {
        const latestSession = appStore.getState().session;
        if (latestSession && getTourAccountKey(latestSession) === accountKey) {
          setSession({ ...latestSession, tourStatus: status });
        }
        return;
      }

      addToast(
        lang === 'zh'
          ? storedLocally
            ? '向导状态已在本地保存，但同步至服务器失败，切换设备或清理存储后可能会再次提示。'
            : '向导状态未能保存到服务器与本地存储，本次会话内已为您抑制重复弹出。'
          : storedLocally
            ? 'Tour state was saved locally, but syncing to the server failed.'
            : 'Failed to save tour status to the server or local storage; suppressed for this session.',
        'warning',
      );
    },
    [addToast, lang, setSession],
  );

  // Auto trigger help tour guide for new admin users (after session hydration & mandatory password gate)
  useEffect(() => {
    if (!session || session.mustChangePassword) {
      setIsTourOpen(false);
      return;
    }
    if (sessionLoading || isStudentTabMode) return;
    if (session.subRole !== 'administrator') return;

    const accountKey = getTourAccountKey(session);
    const guardKey = accountKey ?? '__anonymous__';
    if (dismissedTourUsersRef.current.has(guardKey)) return;
    if (session.tourStatus === 'completed' || session.tourStatus === 'skipped') return;
    if (readStoredTourStatus(accountKey) !== null) return;

    setIsTourOpen(true);
  }, [sessionLoading, session, isStudentTabMode]);

  // Automatically collapse system navigation when entering interactive classroom
  useEffect(() => {
    if (teacherTab === 'live_class') {
      setMainNavCollapsed(true);
    }
  }, [teacherTab]);

  return {
    mainNavCollapsed,
    setMainNavCollapsed,
    isStudentLiveMode,
    liveStudentParam,
    liveLessonParam,
    liveClassParam,
    isStageDisplayMode,
    stageLessonParam,
    stageTitleParam,
    stageLangParam,
    isStudentPreviewMode,
    isStudentTabMode,
    isFollowingTeacher,
    setIsFollowingTeacher,
    liveClassFocusLocked,
    setLiveClassFocusLocked,
    session,
    setSession,
    sessionLoading,
    fetchStudents,
    sessionBootstrapData,
    activeRole,
    setActiveRole,
    activeStudentId,
    setActiveStudentId,
    dbConnected,
    dbStatus,
    profileOpen,
    setProfileOpen,
    handleLoginSuccess,
    handleLogout,
    toggleLanguage,
    students,
    setSelectedLesson,
    studentViewStateData,
    studentViewStatus,
    setStudentViewStatus,
    isStudentLocked,
    isNavigationLocked,
    isInteractionLocked,
    studentLockMode,
    studentLockTarget,
    studentLessonTab,
    setStudentLessonTab,
    studentSelectedCourseware,
    setStudentSelectedCourseware,
    studentFullscreenPanel,
    setStudentFullscreenPanel,
    isStudentLessonContentCollapsed,
    setIsStudentLessonContentCollapsed,
    notifyLockedNavigation,
    teacherTab,
    setTeacherTab,
    isTourOpen,
    setIsTourOpen,
    dismissTour,
    isApprovalsCollapsed,
    setIsApprovalsCollapsed,
    isProcessesCollapsed,
    setIsProcessesCollapsed,
  };
}

export type SessionSlice = ReturnType<typeof useSessionSlice>;
