import { useState, useEffect } from 'react';
import type { useToast } from './useToast';
import { fetchAuthSession } from '../services/sessionService.js';
import { useSessionBootstrap } from './useSessionBootstrap';
import { useStudentViewState } from './useStudentViewState';
import { useAppStore, appStore } from '../store/appStore';
import { useThemeStore } from '../store/themeStore';
import { useFontSizeStore } from '../store/fontSizeStore';

// ── Hash-based routing helpers ────────────────────────────────────────────
function tabToHash(tab: string): string {
  return '#/' + tab;
}
function hashToTab(hash: string): string | null {
  const raw = hash.replace(/^#/, '');
  if (!raw || raw === '/') return null;
  return raw.replace(/^\//, '');
}

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

  const teacherTab = useAppStore((state) => state.teacherTab);
  const setTeacherTab = useAppStore((state) => state.setTeacherTab);

  // ── Hash-based routing: reflect teacherTab in the address bar ──
  // Deep link + back/forward support: read the active tab from the URL hash.
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
    if (initial) setTeacherTab(initial);
    return () => window.removeEventListener('hashchange', applyHash);
  }, [setTeacherTab, isStudentTabMode, isStageDisplayMode]);

  // Write the active tab back into the URL hash so the address bar shows it.
  useEffect(() => {
    if (isStudentTabMode || isStageDisplayMode) return;
    const desired = tabToHash(teacherTab);
    if (window.location.hash !== desired) {
      window.location.hash = desired;
    }
  }, [teacherTab, setTeacherTab, isStudentTabMode, isStageDisplayMode]);

  const [isTourOpen, setIsTourOpen] = useState(false);
  const [isApprovalsCollapsed, setIsApprovalsCollapsed] = useState(false);
  const [isProcessesCollapsed, setIsProcessesCollapsed] = useState(false);

  // Auto trigger help tour guide for new admin users
  useEffect(() => {
    if (session?.subRole === 'administrator' && localStorage.getItem('edu_os_tour_completed') !== 'true') {
      setIsTourOpen(true);
    }
  }, [session]);

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
    isApprovalsCollapsed,
    setIsApprovalsCollapsed,
    isProcessesCollapsed,
    setIsProcessesCollapsed,
  };
}

export type SessionSlice = ReturnType<typeof useSessionSlice>;
