import { Loader2, Eye, LogOut, Maximize2, Sparkles, CheckCircle2, RefreshCw, X } from 'lucide-react';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { parseCSV } from './utils/pluginParsers.js';
import {
  fetchDbStatus,
  fetchAuthSession,
  fetchSiteSettings as fetchSiteSettingsApi,
  postLogout,
} from './services/sessionService.js';
import { getStudentReadNotifications, postStudentReadNotification, postStudentProgress, getClassLessonProgress, getStudentProgress } from './services/progressService.js';
import { postAssignmentSubmission } from './services/assignmentService.js';
import { getClassStudents } from './services/rosterService.js';
import { useLessonCrud } from './hooks/useLessonCrud';
import { useClassOps } from './hooks/useClassOps';
import { useToast } from './hooks/useToast';
import { useSystemData } from './hooks/useSystemData';
import { useResourceLibrary } from './hooks/useResourceLibrary';
import { getClassProgress, getClassDashboard, getStudentDashboard } from './services/dashboardService.js';
import {
  postLesson,
  deleteLesson,
  postCloneLesson,
  getLessonWhiteboard,
} from './services/lessonService.js';
import { translations } from './i18n';
import { LoginPage } from './components/LoginPage';
import { AppHeader } from './components/AppHeader';
import { ClassroomSyncChannel } from './services/classroom-sync-channel';
import { whiteboardViewStore } from './store/whiteboardViewStore';
import { ProfileModal } from './components/ProfileModal';
import { FontSizeSelector } from './components/FontSizeSelector';
import { PALETTE_ITEM_MAP, getPaletteItemConfig } from './features/teacher/lesson-editor/paletteConfig';
import type { ClassTabKey } from './features/teacher/classes/ClassTabs';
import { generateTemplateContent } from './features/teacher/HelpView';
import { StudentInteractiveOverlay } from './features/student/StudentInteractiveOverlay';

// ── Hash-based routing helpers ────────────────────────────────────────────
function tabToHash(tab: string): string {
  return '#/' + tab;
}
function hashToTab(hash: string): string | null {
  const raw = hash.replace(/^#/, '');
  if (!raw || raw === '/') return null;
  return raw.replace(/^\//, '');
}

import { usePluginHost } from './plugin-host/plugin-host-context';
import { usePluginHostStore } from './plugin-host/plugin-host-store';
import { registerTeacherActivityCenter } from './features/activity-ecosystem/registerTeacherExtension.js';

registerTeacherActivityCenter();
import { PluginState } from './plugin-host/types';
import { useAppStore, appStore } from './store/appStore';
import { useThemeStore } from './store/themeStore';
import { useFontSizeStore } from './store/fontSizeStore';
import type {
  AIProvider,
  PluginType,
  VFSNode,
  ProcessType,
  ClassType,
  StudentType,
  AssignmentType,
  SubmissionType,
  ScheduleType,
  AttendanceType,
  StudentProgressType,
} from './store/appStore';
import { AppShell } from './components/AppShell';
import { ToastContainer } from './features/shared/ToastContainer';
import { RightSidebar } from './features/shared/RightSidebar';
import { AppModals } from './components/AppModals';
import { useLmsBridge } from './services/lms-bridge';
import ForcedPasswordChangeGate from './components/ForcedPasswordChangeGate';
import { useAppPolling } from './hooks/useAppPolling';
import { useAgentChat } from './hooks/useAgentChat';
import { useClassroomSocket } from './hooks/useClassroomSocket';
import { usePluginManagement } from './hooks/usePluginManagement';
import { useCourseWizard } from './hooks/useCourseWizard';
import { useQuizGenerator } from './hooks/useQuizGenerator';
import { useClassBatchOperations } from './hooks/useClassBatchOperations';
import { useLabAndSchedule } from './hooks/useLabAndSchedule';
import { useLessonTimeline } from './hooks/useLessonTimeline';
import { useStudentNotifications } from './hooks/useStudentNotifications';
import { useGradeExport } from './hooks/useGradeExport';
import { useLessonFiltering } from './hooks/useLessonFiltering';
import { SystemErrorCenterModal } from './features/modals/SystemErrorCenterModal';
import { StageDisplayView } from './features/classroom/stage-display/StageDisplayView';
import { useGlobalErrorCapture } from './hooks/useGlobalErrorCapture';

const AGENT_PROVIDER_STORAGE_KEY = 'openlearnv2.agentProviderId';

export default function App() {
  useGlobalErrorCapture();
  const lang = useAppStore((s) => s.lang);
  const setLang = useAppStore((s) => s.setLang);
  const t = translations[lang] ?? translations['zh'];

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
  const [pickedAlertData, setPickedAlertData] = useState<{
    studentId: string;
    studentName: string;
    rollcallId?: string;
  } | null>(null);
  const [pickedAnnouncement, setPickedAnnouncement] = useState<{ studentName: string; studentId: string } | null>(null);

  // 全班随机抽问横幅自动消失（8秒后自动淡出）
  useEffect(() => {
    if (pickedAnnouncement) {
      const timer = setTimeout(() => {
        setPickedAnnouncement(null);
      }, 8000);
      return () => clearTimeout(timer);
    }
  }, [pickedAnnouncement]);

  // 被抽中学生端着重播放提示音效（Web Audio API）
  useEffect(() => {
    if (pickedAlertData) {
      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) {
          const ctx = new AudioCtx();
          const now = ctx.currentTime;
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(587.33, now); // D5
          osc.frequency.exponentialRampToValueAtTime(880.0, now + 0.25); // A5
          gain.gain.setValueAtTime(0.25, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now);
          osc.stop(now + 0.8);
        }
      } catch (_) {}
    }
  }, [pickedAlertData]);

  const liveClassSelectedClassId = useAppStore((s) => s.liveClassSelectedClassId);
  const setLiveClassSelectedClassId = useAppStore((s) => s.setLiveClassSelectedClassId);
  const liveClassIsActive = useAppStore((s) => s.liveClassIsActive);
  const setLiveClassIsActive = useAppStore((s) => s.setLiveClassIsActive);
  const [liveClassTimeRemaining, setLiveClassTimeRemaining] = useState(0);
  const [liveClassFeed, setLiveClassFeed] = useState<any[]>([]);
  const [liveClassAcknowledgedMap, setLiveClassAcknowledgedMap] = useState<Map<string, boolean>>(new Map());

  const host = usePluginHost();
  const [onlineStudentIds, setOnlineStudentIds] = useState<string[]>([]);
  const [activeStudentLessons, setActiveStudentLessons] = useState<Record<string, string>>({});
  const [localProgressPercent, setLocalProgressPercent] = useState<number>(0);


  React.useEffect(() => {
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

  const lessons = useAppStore((s) => s.lessons);
  const setLessons = useAppStore((s) => s.setLessons);
  // ── Hook: 课程筛选、搜索与排序 ──
  const {
    lessonsSearchQuery,
    setLessonsSearchQuery,
    lessonsSortOrder,
    setLessonsSortOrder,
    filterEnrollment,
    setFilterEnrollment,
    filterHasContent,
    setFilterHasContent,
    filterThisMonth,
    setFilterThisMonth,
    copyingLessonId,
    setCopyingLessonId,
    filteredAndSortedLessons,
  } = useLessonFiltering(lessons);
  const selectedLesson = useAppStore((s) => s.selectedLesson);
  const setSelectedLesson = useAppStore((s) => s.setSelectedLesson);
  const elements = useAppStore((s) => s.elements);
  const setElements = useAppStore((s) => s.setElements);


  const [showRightSidebar, setShowRightSidebar] = useState(false);
  const [rightSidebarTab, setRightSidebarTab] = useState<'agent' | 'shell'>('agent');

  const classes = useAppStore((s) => s.classes);
  const setClasses = useAppStore((s) => s.setClasses);
  const students = useAppStore((s) => s.students);
  const setStudents = useAppStore((s) => s.setStudents);

  // ── Hook: 机房座位与排课管理 ──
  const {
    computerLabs,
    setComputerLabs,
    loadingLabs,
    setLoadingLabs,
    fetchLabs,
    classSeats,
    setClassSeats,
    savingSeats,
    setSavingSeats,
    fetchClassSeats,
    todaySchedules,
    setTodaySchedules,
    fetchTodaySchedules,
    classSchedulesMap,
    setClassSchedulesMap,
    fetchClassSchedules,
    scheduleAttendanceMap,
    setScheduleAttendanceMap,
    fetchScheduleAttendance,
    expandedScheduleId,
    setExpandedScheduleId,
    newScheduleDate,
    setNewScheduleDate,
    newScheduleLessonId,
    setNewScheduleLessonId,
  } = useLabAndSchedule();

  // ── C1-R2c: 课程/班级 hooks ──────────────────────────────────────────────
  const { addToast } = useToast();
  const {
    fetchLessons,
    handleQuickCreateLesson,
    handleDeleteCourse,
    handleCopyCourse,
    fetchElements,
  } = useLessonCrud({ lang, addToast, setCopyingLessonId });
  const {
    classStudentsMap,
    setClassStudentsMap,
    classProgressMap,
    setClassProgressMap,
    classDashboardMap,
    setClassDashboardMap,
    classAssignmentsMap,
    setClassAssignmentsMap,
    assignmentSubmissionsMap,
    setAssignmentSubmissionsMap,
    liveClassStudentProgress,
    setLiveClassStudentProgress,
    fetchClassStudents,
    fetchClassProgress,
    fetchClassDashboard,
    fetchLiveClassStudentProgress,
    handleQuickScheduleClass,
    handleQuickGenerateAssignment,
  } = useClassOps({ fetchClassSchedules });

  const [expandedClassId, _setExpandedClassId] = useState<string | null>(null);
  const setExpandedClassId = (id: string | null) => {
    _setExpandedClassId(id);
  };
  const [expandedStudentId, _setExpandedStudentId] = useState<string | null>(null);

  // ── 备课画板：点击卡片预编辑后添加到白板 ──
  const whiteboardRef = useRef<any>(null);
  const [paletteEdit, setPaletteEdit] = useState<{ type: string; data: Record<string, any> } | null>(null);
  const handlePaletteActivate = (type: string) => {
    const cfg = getPaletteItemConfig(type);
    if (cfg) setPaletteEdit({ type, data: { ...cfg.defaultData } });
  };
  const handlePaletteConfirm = async (data: Record<string, any>) => {
    if (paletteEdit) {
      await whiteboardRef.current?.addElementAtCenter(paletteEdit.type, data);
    }
    setPaletteEdit(null);
  };

  // Role & Student View
  const session = useAppStore((s) => s.session);
  const setSession = useAppStore((s) => s.setSession);
  const siteInfo = useAppStore((s) => s.siteInfo);
  const setSiteInfo = useAppStore((s) => s.setSiteInfo);

  const [activeRole, setActiveRole] = useState<'teacher' | 'student'>('teacher');
  const [sessionLoading, setSessionLoading] = useState(true);
  const [dbConnected, setDbConnected] = useState<boolean>(true);
  const [dbStatus, setDbStatus] = useState<'normal' | 'warning' | 'error'>('normal');

  useEffect(() => {
    if (!session) return;
    const checkDb = async () => {
      try {
        const { ok, status, data } = await fetchDbStatus();
        if (ok) {
          if (data.status === 'warning' || data.warning) {
            setDbStatus('warning');
          } else {
            setDbStatus('normal');
          }
          setDbConnected(true);
        } else if (status === 429 || status === 503) {
          setDbStatus('warning');
          setDbConnected(true);
        } else {
          setDbStatus('error');
          setDbConnected(false);
        }
      } catch (err) {
        setDbStatus('error');
        setDbConnected(false);
      }
    };
    checkDb();
    const interval = setInterval(checkDb, 5000);
    return () => clearInterval(interval);
  }, [session]);

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

  // Load platform site settings (logo / name / slogan) so branding slots render globally
  useEffect(() => {
    const fetchSiteSettings = async () => {
      try {
        const { ok, data } = await fetchSiteSettingsApi();
        if (ok) {
          setSiteInfo({ siteName: data.siteName || '', slogan: data.slogan || '', logoUrl: data.logoUrl || null });
        }
      } catch (err) {
        console.warn('Failed to fetch site settings:', err);
      }
    };
    fetchSiteSettings();
  }, []);

  const teacherTab = useAppStore((state) => state.teacherTab);
  const setTeacherTab = useAppStore((state) => state.setTeacherTab);

  // ── Hash-based routing: reflect teacherTab in the address bar ──
  // Deep link + back/forward support: read the active tab from the URL hash.
  useEffect(() => {
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
  }, [setTeacherTab]);

  // Write the active tab back into the URL hash so the address bar shows it.
  useEffect(() => {
    const desired = tabToHash(teacherTab);
    if (window.location.hash !== desired) {
      window.location.hash = desired;
    }
  }, [teacherTab, setTeacherTab]);

  const [isTourOpen, setIsTourOpen] = useState(false);
  const [isApprovalsCollapsed, setIsApprovalsCollapsed] = useState(false);
  const [isProcessesCollapsed, setIsProcessesCollapsed] = useState(false);

  // Auto trigger help tour guide for new admin users
  useEffect(() => {
    if (session?.subRole === 'administrator' && localStorage.getItem('edu_os_tour_completed') !== 'true') {
      setIsTourOpen(true);
    }
  }, [session]);

  const handleSeedSuccess = async (data: { classId: string; scheduleId: string; lessonId: string }) => {
    // 1. Refresh academic data
    await fetchClasses();
    await fetchLessons();
    await fetchTodaySchedules().catch(() => {});

    // 2. Select seeded course and trigger classroom
    setLiveClassSelectedClassId(data.classId);
    setSelectedLesson(data.lessonId);
    setLiveClassIsActive(true); // Active the class session directly

    addToast(
      lang === 'zh' ? '示范课堂准备就绪' : 'Demo Classroom Ready',
      lang === 'zh'
        ? '示范班级与课件已加载，已自动开启授课状态！'
        : 'Demo class & courseware loaded. Live class session is now active!',
      'success',
    );
  };

  // Automatically collapse system navigation when entering interactive classroom
  useEffect(() => {
    if (teacherTab === 'live_class') {
      setMainNavCollapsed(true);
    }
  }, [teacherTab]);
  // ── Hook: 课程时间线与备课编辑器 ──
  const {
    timelineSegments,
    setTimelineSegments,
    activeSegmentId,
    setActiveSegmentId,
    segmentToEdit,
    setSegmentToEdit,
    draggedSegmentIdx,
    setDraggedSegmentIdx,
    editorSaveStatus,
    setEditorSaveStatus,
    editorLastSavedTime,
    setEditorLastSavedTime,
    editorPanelsExpanded,
    setEditorPanelsExpanded,
    saveTimeline,
  } = useLessonTimeline({
    selectedLesson,
    lessons,
    setLessons,
  });

  const [activeStudentId, setActiveStudentId] = useState<string | null>(null);
  const [studentDashboardData, setStudentDashboardData] = useState<any>(null);
  const [liveClassFocusLocked, setLiveClassFocusLocked] = useState(false);
  // ── 全班专注锁定：学生被教师锁定时，只读跟随当前授课 ──────────────────────
  // 锁定状态由 students 表中的 locked_lesson_id 派生，或由 ClassroomSyncChannel 广播实时下发。
  const isStudentLocked =
    activeRole === 'student' &&
    ((!!activeStudentId && !!students.find((s) => s.id === activeStudentId)?.locked_lesson_id) || liveClassFocusLocked);

  const notifyLockedNavigation = () => {
    addToast(
      lang === 'zh' ? '🔒 全班专注锁定' : '🔒 Class Focus Locked',
      lang === 'zh'
        ? '老师已开启全班专注锁定，暂时无法切换页面，请跟随教师当前授课内容。'
        : 'The teacher locked the class focus. Navigation is disabled — please follow the current lesson.',
      'warning',
    );
  };

  // 锁定期间强制跟随教师步调；具体在 studentViewStatus 声明处统一生效

  const fetchClasses = async () => {
    await appStore.getState().loadClasses();
  };

  const fetchStudents = async () => {
    await appStore.getState().loadStudents();
  };
  // ── C1-R2b: 叶子 hooks（系统数据 / 资源库与导入） ─────────────────────────
  const {
    registeredCommands,
    setRegisteredCommands,
    vfsNodes,
    setVfsNodes,
    processes,
    setProcesses,
    showProcessLogs,
    setShowProcessLogs,
    processLogsContent,
    setProcessLogsContent,
    showLogs,
    setShowLogs,
    currentVfsParent,
    setCurrentVfsParent,
    fetchRegisteredCommands,
    fetchVfs,
    fetchProcesses,
    fetchProcessLogs,
  } = useSystemData(session);
  const {
    isCloudDriveOpen,
    setIsCloudDriveOpen,
    cloudDrivePreviewNode,
    setCloudDrivePreviewNode,
    isSystemResourceLibraryOpen,
    setIsSystemResourceLibraryOpen,
    systemResourceTab,
    setSystemResourceTab,
    selectedLibraryResourceId,
    setSelectedLibraryResourceId,
    libraryResources,
    setLibraryResources,
    loadingLibraryResources,
    setLoadingLibraryResources,
    showCoursewareHub,
    setShowCoursewareHub,
    fetchLibraryResources,
    isImportLessonsOpen,
    setIsImportLessonsOpen,
    importStatus,
    setImportStatus,
    importProgress,
    setImportProgress,
    importProgressTotal,
    setImportProgressTotal,
    importErrorMsg,
    setImportErrorMsg,
    previewImportData,
    setPreviewImportData,
    isDraggingImport,
    setIsDraggingImport,
    downloadCsvTemplate,
    handleCSVFileChange,
    handleCSVImportSubmit,
    showImportModal,
    setShowImportModal,
    isImporting,
    setIsImporting,
    importError,
    setImportError,
    importSuccess,
    setImportSuccess,
    downloadCSVTemplate,
    handleImportFile,
  } = useResourceLibrary({ lang, session, fetchClasses, fetchStudents, fetchLessons, addToast });

  const chatLogUpdaterRef = useRef<(updater: any) => void>(() => {});

  // ── Hook: 课程创建向导 (Course Wizard) ──
  const courseWizard = useCourseWizard({
    lang,
    addToast,
    fetchLessons,
    setSelectedLesson,
    setTeacherTab,
  });
  const {
    isCourseWizardOpen,
    setIsCourseWizardOpen,
    wizardStep,
    setWizardStep,
    wizardCourseTitle,
    setWizardCourseTitle,
    wizardCourseCategory,
    setWizardCourseCategory,
    wizardCourseDescription,
    setWizardCourseDescription,
    wizardCourseContent,
    setWizardCourseContent,
    wizardCourseTimeline,
    setWizardCourseTimeline,
    wizardIsSubmitting,
    handleDeployWizardCourse,
  } = courseWizard;

  // ── Hook: 插件与 AI 提供商生命周期管理 ──
  const {
    plugins,
    setPlugins,
    fetchPlugins,
    aiProviders,
    setAiProviders,
    fetchAIProviders,
    isAIProviderModalOpen,
    setIsAIProviderModalOpen,
    editingAIProvider,
    setEditingAIProvider,
    providerName,
    setProviderName,
    providerApiUrl,
    setProviderApiUrl,
    providerApiKey,
    setProviderApiKey,
    providerModelName,
    setProviderModelName,
    testingProviderId,
    setTestingProviderId,
    showPluginModal,
    setShowPluginModal,
    storeTab,
    setStoreTab,
    pluginCode,
    setPluginCode,
    installingPlugin,
    setInstallingPlugin,
    events,
    setEvents,
    fetchEvents,
    approvals,
    setApprovals,
    fetchApprovals,
    scoreOverrides,
    setScoreOverrides,
    handleSaveAIProvider,
    handleDeleteAIProvider,
    handleTestAIProvider,
    handleInstallPlugin,
    handleZipPluginUpload,
    handleTogglePlugin,
    handleDeletePlugin,
    handleApprove,
    handleReject,
  } = usePluginManagement({
    session,
    host,
    lang,
    addToast,
    setChatLog: (updater: any) => chatLogUpdaterRef.current(updater),
    setTeacherTab,
    fetchLessons,
  });

  const [agentProviderId, setAgentProviderId] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    return window.localStorage.getItem(AGENT_PROVIDER_STORAGE_KEY) || '';
  });
  const effectiveAgentProviderId = aiProviders.some((provider) => provider.id === agentProviderId)
    ? agentProviderId
    : aiProviders[0]?.id || '';
  const selectedAgentProvider = aiProviders.find((provider) => provider.id === effectiveAgentProviderId) || null;
  const [studentViewStatus, setStudentViewStatusState] = useState<'dashboard' | 'lesson' | 'assignment'>('dashboard');

  // 锁定状态 / 当前视图的最新值：供长期存活的回调（socket、轮询）读取，避免闭包过期
  const isStudentLockedRef = useRef(isStudentLocked);
  const studentViewStatusRef = useRef<'dashboard' | 'lesson' | 'assignment'>(studentViewStatus);
  useEffect(() => {
    isStudentLockedRef.current = isStudentLocked;
    studentViewStatusRef.current = studentViewStatus;
  }, [isStudentLocked, studentViewStatus]);

  // 锁定期间强制跟随教师步调，并确保学生落在课节视图，不会被困在其他页面上
  useEffect(() => {
    if (!isStudentLocked) return;
    setIsFollowingTeacher(true);
    setStudentViewStatusState('lesson');
  }, [isStudentLocked]);

  /**
   * 学生端视图切换的唯一收口点。
   * 全班专注锁定期间只放行 'lesson'（教师当前授课），其余跳转
   * （Dashboard、作业工作区、通知直达等）一律拦截并提示。
   */
  const setStudentViewStatus = (
    next:
      | 'dashboard'
      | 'lesson'
      | 'assignment'
      | ((prev: 'dashboard' | 'lesson' | 'assignment') => 'dashboard' | 'lesson' | 'assignment'),
  ) => {
    const resolved = typeof next === 'function' ? next(studentViewStatusRef.current) : next;
    if (isStudentLockedRef.current && resolved !== 'lesson') {
      notifyLockedNavigation();
      return;
    }
    setStudentViewStatusState(next as 'dashboard' | 'lesson' | 'assignment');
  };
  const [studentLessonTab, setStudentLessonTab] = useState<'whiteboard' | 'courseware' | 'assignment'>('whiteboard');
  const [studentSelectedCourseware, setStudentSelectedCourseware] = useState<string | null>(null);
  const [selectedAssignment, setSelectedAssignment] = useState<any | null>(null);
  const [studentFullscreenPanel, setStudentFullscreenPanel] = useState<'none' | 'left' | 'right'>('none');
  const [isStudentLessonContentCollapsed, setIsStudentLessonContentCollapsed] = useState(true);

  // Reset Lesson Content to collapsed when leaving student lesson view
  useEffect(() => {
    if (studentViewStatus !== 'lesson') {
      setIsStudentLessonContentCollapsed(true);
    }
  }, [studentViewStatus]);

  // ── Hook: AI 目标测验生成器 (Quiz Generator) ──
  const quizGenerator = useQuizGenerator();
  const {
    isQuizGeneratorOpen,
    setIsQuizGeneratorOpen,
    quizGeneratorClassId,
    setQuizGeneratorClassId,
    quizGenMode,
    setQuizGenMode,
    quizGenSelectedLessonId,
    setQuizGenSelectedLessonId,
    quizGenTopic,
    setQuizGenTopic,
    isGeneratingSuggestions,
    setIsGeneratingSuggestions,
    suggestedObjectives,
    setSuggestedObjectives,
    suggestedQuestions,
    setSuggestedQuestions,
    savingQuiz,
    setSavingQuiz,
    quizStudentAnswers,
    setQuizStudentAnswers,
    quizGenTimeLimit,
    setQuizGenTimeLimit,
    quizStudentAnswersRef,
    subAssignmentTab,
    setSubAssignmentTab,
  } = quizGenerator;

  const [rosterSearchQuery, setRosterSearchQuery] = useState('');
  const [rosterTagFilter, setRosterTagFilter] = useState<'all' | 'Academic' | 'Behavioral' | 'General' | 'SpecialCare'>(
    'all',
  );
  const [rosterViewMode, setRosterViewMode] = useState<'grid' | 'list'>('grid');
  const [classSubmissionFilters, setClassSubmissionFilters] = useState<
    Record<string, 'all' | 'submitted' | 'graded' | 'pending'>
  >({});
  const [classActiveTabs, setClassActiveTabs] = useState<Record<string, ClassTabKey>>({});
  const [studentActiveTabs, setStudentActiveTabs] = useState<Record<string, 'progress' | 'settings' | 'notes'>>({});

  // ── Hook: 学者通知系统 ──
  const studentNotificationsHook = useStudentNotifications(activeRole, studentDashboardData, lang);
  const {
    studentNotifications,
    unreadNotifications,
    readNotifications,
    setReadNotifications,
    selectedNotificationForModal,
    setSelectedNotificationForModal,
    isNotificationsOpen,
    setIsNotificationsOpen,
  } = studentNotificationsHook;

  useEffect(() => {
    if (activeStudentId) {
      getStudentReadNotifications(activeStudentId)
        .then(({ ok, data }) => {
          setReadNotifications(ok && Array.isArray(data) ? new Set(data) : new Set());
        })
        .catch((err) => {
          console.warn('Failed to load read notifications from DB', err);
          setReadNotifications(new Set());
        });
    }
  }, [activeStudentId]);

  const setExpandedStudentId = (id: string | null) => {
    _setExpandedStudentId(id);
  };
  const [studentProgressMap, setStudentProgressMap] = useState<Record<string, StudentProgressType[]>>({});
  const [isGeneratingAssignment, setIsGeneratingAssignment] = useState<string | null>(null);
  const [assignmentSortOrder, setAssignmentSortOrder] = useState<'dueDate' | 'status' | 'avgScore'>('dueDate');

  const [isGrading, setIsGrading] = useState<Record<string, boolean>>({});

  // Class/Student Bulk Import State variables


  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(AGENT_PROVIDER_STORAGE_KEY, agentProviderId);
    }
  }, [agentProviderId]);

  useEffect(() => {
    if (aiProviders.length > 0 && !aiProviders.some((provider) => provider.id === agentProviderId)) {
      setAgentProviderId(aiProviders[0].id);
    }
  }, [aiProviders, agentProviderId]);



  // ── Hook: 成绩导出与学情报表管理 ──
  const gradeExport = useGradeExport({
    lang,
    classes,
    classStudentsMap,
    classDashboardMap,
    fetchClassStudents,
    fetchClassDashboard,
    fetchClassProgress,
  });
  const {
    isExportWeightModalOpen,
    setIsExportWeightModalOpen,
    exportClassId,
    setExportClassId,
    exportClassName,
    setExportClassName,
    quizzesWeight,
    setQuizzesWeight,
    assignmentsWeight,
    setAssignmentsWeight,
    customCategoryOverrides,
    setCustomCategoryOverrides,
    exportDropdownOpen,
    setExportDropdownOpen,
    exportTooltipOpen,
    setExportTooltipOpen,
    loadingExportClassId,
    setLoadingExportClassId,
    isExportingAllCombined,
    setIsExportingAllCombined,
    isGeneratingPDFReport,
    setIsGeneratingPDFReport,
    handleQuizzesWeightChange,
    handleAssignmentsWeightChange,
    csvPreviewData,
    triggerExportForClass,
    handleExportGrades,
    handleGeneratePDFReport,
    handleExportAllClassesCombined,
    get30DayAverageWarning,
  } = gradeExport;

  // ── Hook: 班级与学生批量管理操作 ──
  const classBatch = useClassBatchOperations({
    lang,
    classes,
    expandedClassId,
    fetchClasses,
    fetchClassStudents,
    handleExportAllClassesCombined,
  });
  const {
    batchMode,
    setBatchMode,
    selectedClassIds,
    setSelectedClassIds,
    selectedStudentIds,
    setSelectedStudentIds,
    batchPicker,
    setBatchPicker,
    batchPickerLesson,
    setBatchPickerLesson,
    batchPickerDate,
    setBatchPickerDate,
    batchPickerTargetClass,
    setBatchPickerTargetClass,
    toggleClassSelection,
    toggleSelectAllClasses,
    toggleStudentSelection,
    toggleSelectAllStudents,
    handleBatchDeleteClasses,
    handleBatchExportClasses,
    handleBatchSetPasscode,
    handleBatchScheduleClasses,
    handleBatchDeleteStudents,
    handleBatchResetPassword,
    handleBatchTransferStudents,
    handleBatchSetLockedLesson,
    confirmBatchPicker,
  } = classBatch;

  const fetchStudentDashboard = async (id: string) => {
    try {
      const { ok, data } = await getStudentDashboard(id);
      if (ok) {
        setStudentDashboardData(data);
        if (data.profile && data.profile.locked_lesson_id) {
          setSelectedLesson(data.profile.locked_lesson_id);
          setStudentViewStatus('lesson');
        }
      }
    } catch (e) {}
  };

  const submitQuizAssignment = async (isTimeLimitExpired = false) => {
    if (!selectedAssignment) return;
    const isMcq =
      selectedAssignment?.content && selectedAssignment.content.startsWith('{"quizType":"mcq_learning_objectives"');
    const contentToSubmit = isMcq ? JSON.stringify(quizStudentAnswersRef.current) : 'Submitted via Whiteboard';

    try {
      const { ok } = await postAssignmentSubmission(selectedAssignment.id, {
        studentId: activeStudentId,
        content: contentToSubmit,
      });
      if (ok) {
        if (isTimeLimitExpired) {
          alert('Time is up! Your assessment was successfully submitted automatically.');
        }
        await fetchStudentDashboard(activeStudentId!);
        setStudentViewStatus('dashboard');
        setSelectedAssignment(null);
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    if (!session) return;
    if (activeRole === 'student' && activeStudentId) {
      fetchStudentDashboard(activeStudentId);
      const student = students.find((s) => s.id === activeStudentId);
      if (student && student.locked_lesson_id) {
        setSelectedLesson(student.locked_lesson_id);
        setStudentViewStatus('lesson');
      }
    }
  }, [session, activeRole, activeStudentId, students]);

  const activatingPluginsRef = useRef<Set<string>>(new Set());

  // Synchronize backend active plugins to frontend PluginHost
  useEffect(() => {
    if (!host.isInitialized() || plugins.length === 0) return;

    const store = usePluginHostStore.getState();

    // 1. Activate active plugins (re-activate when version changes after in-place update)
    const activePluginsFromServer = plugins.filter((p) => p.status === 'active');
    for (const plugin of activePluginsFromServer) {
      if (!plugin.has_frontend) {
        continue;
      }
      if (activatingPluginsRef.current.has(plugin.id)) {
        continue;
      }
      const localPlugin = store.activePlugins.find((p) => p.id === plugin.id);
      const versionChanged = !!(localPlugin && plugin.version && localPlugin.version !== plugin.version);
      const needsActivate =
        !localPlugin ||
        versionChanged ||
        (localPlugin.state !== PluginState.ACTIVE && localPlugin.state !== PluginState.ACTIVATING);

      if (!needsActivate) continue;

      activatingPluginsRef.current.add(plugin.id);
      const startActivate = () => {
        if (!store.activePlugins.find((p) => p.id === plugin.id)) {
          store.addPlugin({
            id: plugin.id,
            name: plugin.name,
            version: plugin.version,
            state: PluginState.INSTALLED,
            executionMode: 'inline',
          });
        } else if (versionChanged) {
          // Keep store entry but refresh version stamp
          try {
            usePluginHostStore.setState((s) => ({
              activePlugins: s.activePlugins.map((p) =>
                p.id === plugin.id ? { ...p, version: plugin.version, name: plugin.name } : p,
              ),
            }));
          } catch {
            /* ignore */
          }
        }
        try {
          const manifest = JSON.parse(plugin.manifest);
          host
            .activateRemotePlugin(plugin.id, manifest)
            .catch((err) => {
              console.error(`[App] Failed to activate remote plugin "${plugin.name}":`, err);
            })
            .finally(() => {
              activatingPluginsRef.current.delete(plugin.id);
            });
        } catch (e) {
          activatingPluginsRef.current.delete(plugin.id);
          console.error(`[App] Failed to parse manifest for plugin "${plugin.name}":`, e);
        }
      };

      if (localPlugin && localPlugin.state === PluginState.ACTIVE && versionChanged) {
        host
          .deactivatePlugin(plugin.id)
          .catch(() => {})
          .finally(startActivate);
      } else {
        startActivate();
      }
    }

    // 2. Deactivate deactivated plugins
    const deactivatedPluginsFromServer = plugins.filter((p) => p.status !== 'active');
    for (const plugin of deactivatedPluginsFromServer) {
      if (!plugin.has_frontend) {
        continue;
      }
      const localPlugin = store.activePlugins.find((p) => p.id === plugin.id);
      if (localPlugin && localPlugin.state === PluginState.ACTIVE) {
        host.deactivatePlugin(plugin.id).catch((err) => {
          console.error(`[App] Failed to deactivate remote plugin "${plugin.name}":`, err);
        });
      }
    }
  }, [plugins, host]);
  // Initialize dashboard widget visibility — defaults to true for active plugins
  // Persisted visibility is hydrated from localStorage in the store itself.
  React.useEffect(() => {
    if (!host.isInitialized() || plugins.length === 0) return;
    const store = usePluginHostStore.getState();
    for (const plugin of plugins) {
      if (plugin.status !== 'active') continue;
      if (!store.dashboardVisibility.has(plugin.id)) {
        store.setDashboardVisibility(plugin.id, true);
      }
    }
  }, [plugins, host]);

  const updateStudentProgress = async (progressVal: number) => {
    if (activeRole === 'student' && activeStudentId && selectedLesson) {
      try {
        await postStudentProgress(activeStudentId, {
          lessonId: selectedLesson,
          completed: progressVal === 100,
          progressPercent: progressVal,
        });
      } catch (e) {
        console.error('Failed to update student progress:', e);
      }
    }
  };

  useEffect(() => {
    if (liveClassSelectedClassId && selectedLesson) {
      fetchLiveClassStudentProgress(liveClassSelectedClassId, selectedLesson);
    } else {
      setLiveClassStudentProgress([]);
    }
  }, [liveClassSelectedClassId, selectedLesson]);

  useEffect(() => {
    if (liveClassSelectedClassId) {
      fetchClassStudents(liveClassSelectedClassId);
    }
  }, [liveClassSelectedClassId]);

  const fetchStudentProgress = async (id: string) => {
    try {
      const { ok, data } = await getStudentProgress(id);
      if (ok) {
        setStudentProgressMap((prev) => ({ ...prev, [id]: data }));
      }
    } catch (e) {}
  };

  useLmsBridge(session);

  const {
    personaId,
    setPersonaId,
    chatLog,
    setChatLog,
    input,
    setInput,
    loading,
    setLoading,
    chatAttachments,
    setChatAttachments,
    handleChatFileChange,
    handleChatDrop,
    handleSend,
    handleClearAgentMemory,
  } = useAgentChat({
    lang,
    t,
    selectedLesson,
    effectiveAgentProviderId,
    expandedClassId,
    fetchLessons,
    fetchClasses,
    fetchStudents,
    fetchClassStudents,
    fetchClassProgress,
    fetchClassDashboard,
    fetchElements,
  });

  chatLogUpdaterRef.current = setChatLog;

  useAppPolling({
    session,
    showProcessLogs,
    activeStudentId,
    currentVfsParent,
    selectedLesson,
    selectedAssignment,
    expandedClassId,
    fetchLessons,
    fetchPlugins,
    fetchRegisteredCommands,
    fetchEvents,
    fetchApprovals,
    fetchProcesses,
    fetchClasses,
    fetchTodaySchedules,
    fetchStudents,
    fetchLabs,
    fetchVfs,
    fetchProcessLogs,
    fetchClassStudents,
    fetchElements,
  });

  const { socketRef } = useClassroomSocket({
    session,
    host,
    activeRole,
    activeStudentId,
    selectedLesson,
    activeSegmentId,
    studentViewStatus,
    lang,
    students,
    addToast,
    setOnlineStudentIds,
    setActiveStudentLessons,
    setLessons,
    setActiveSegmentId,
    setLiveClassStudentProgress,
    setLiveClassAcknowledgedMap,
    setLiveClassFeed,
    setSelectedLesson,
    setStudentViewStatus,
    studentLessonTab,
    setStudentLessonTab,
    selectedAssignment,
    setSelectedAssignment,
    setLocalProgressPercent,
    fetchStudentDashboard,
    fetchStudents,
    fetchElements,
    setPickedAlertData,
    setPickedAnnouncement,
  });

  const toggleLanguage = () => {
    setLang(lang === 'zh' ? 'en' : 'zh');
  };

  const handleLoginSuccess = useCallback((newSession: any) => {
    setSession(newSession);
    if (newSession.role === 'teacher') {
      setActiveRole('teacher');
      // 教师/管理员登录后的默认首页：互动课堂（管理员 role 同为 teacher，靠 subRole 区分）
      setTeacherTab('live_class');
    } else {
      setActiveRole('student');
      setActiveStudentId(newSession.studentId);
      fetchStudents();
    }
  }, []);

  const handleLogout = async () => {
    try {
      await postLogout();
    } catch (e) {
      console.error('Logout failed', e);
    }
    setSession(null);
  };

  const [profileOpen, setProfileOpen] = useState(false);

  // ── 互动课堂：独立学生端跨窗口实时协同信道 (ClassroomSyncChannel) ────────────
  useEffect(() => {
    if (!isStudentLiveMode) return;

    const channel = new ClassroomSyncChannel();

    // 1. 发起握手请求：向教师中控台索取当前授课快照
    channel.requestHandshake();

    // 2. 监听教师端广播并实时执行学生端联动动作
    const unsub = channel.onMessage((msg) => {
      switch (msg.type) {
        case 'TEACHER_INIT_STATE': {
          const s = msg.payload;
          if (s.selectedLesson) {
            setSelectedLesson(s.selectedLesson);
            fetchElements(s.selectedLesson);
          }
          if (s.activeSegmentId) {
            setActiveSegmentId(s.activeSegmentId);
          }
          if (s.activeTab) {
            setStudentLessonTab(s.activeTab);
          }
          if (s.liveClassTimeRemaining !== undefined) {
            setLiveClassTimeRemaining(s.liveClassTimeRemaining);
          }
          if (s.fullscreenElementId !== undefined) {
            whiteboardViewStore.getState().setRemoteFullscreenElementId(s.fullscreenElementId);
            if (s.fullscreenElementId) {
              setStudentLessonTab('whiteboard');
            }
          }
          setStudentViewStatus('lesson');
          break;
        }
        case 'TEACHER_CHANGE_LESSON': {
          if (isFollowingTeacher && msg.payload.lessonId) {
            setSelectedLesson(msg.payload.lessonId);
            fetchElements(msg.payload.lessonId);
            setStudentViewStatus('lesson');
          }
          break;
        }
        case 'TEACHER_CHANGE_SEGMENT': {
          if (isFollowingTeacher && msg.payload.segmentId) {
            setActiveSegmentId(msg.payload.segmentId);
          }
          break;
        }
        case 'TEACHER_CHANGE_TAB': {
          if (isFollowingTeacher && msg.payload.tab) {
            setStudentLessonTab(msg.payload.tab);
          }
          break;
        }
        case 'TEACHER_LOCK_CLASS': {
          setLiveClassFocusLocked(!!msg.payload.locked);
          if (msg.payload.locked) {
            setIsFollowingTeacher(true);
            setStudentViewStatus('lesson');
            addToast(
              lang === 'zh' ? '🔒 全班专注锁定' : '🔒 Class Focus Lock',
              lang === 'zh' ? '老师已开启全班专注锁定，界面将保持同步授课。' : 'Teacher locked screen for class.',
              'warning',
            );
          } else {
            addToast(
              lang === 'zh' ? '🔓 屏幕已解锁' : '🔓 Screen Unlocked',
              lang === 'zh' ? '老师已解除锁定，您可以自由浏览或答题。' : 'Screen unlocked.',
              'info',
            );
          }
          break;
        }
        case 'TEACHER_PICK_STUDENT': {
          const isCurrentStudent =
            (activeStudentId && activeStudentId === msg.payload.studentId) ||
            (liveStudentParam && liveStudentParam === msg.payload.studentId);

          if (isCurrentStudent || (!activeStudentId && !liveStudentParam)) {
            // 被抽中的学生（或独立视窗）：着重提示（模态框 + 强提醒Toast）
            setPickedAlertData(msg.payload);
            addToast(
              lang === 'zh' ? '⚡️ 闪电抽问：老师抽中了你！' : '⚡️ Classroom Pick Alert',
              lang === 'zh'
                ? '闪电警报！您已被老师在课程随机抽问中抽中！请立即集中注意力参与课堂回答。'
                : 'Attention alert! You have been randomly picked by the teacher! Please pay immediate attention.',
              'warning',
            );
          } else {
            // 全班其他学生：向全班提示被抽中的学生（顶部横幅 + 提示Toast）
            setPickedAnnouncement({ studentName: msg.payload.studentName, studentId: msg.payload.studentId });
            addToast(
              lang === 'zh' ? '🎯 课堂随机抽问' : '🎯 Classroom Random Pick',
              lang === 'zh'
                ? `老师在课堂中随机抽中了【${msg.payload.studentName}】同学回答问题！`
                : `Teacher randomly selected [${msg.payload.studentName}] to answer!`,
              'info',
            );
          }
          break;
        }
        case 'TEACHER_SYNC_TIMER': {
          setLiveClassTimeRemaining(msg.payload.timeRemaining);
          break;
        }
        case 'TEACHER_BROADCAST_COUNTDOWN': {
          setLiveClassTimeRemaining(msg.payload.timeRemaining);
          break;
        }
        case 'TEACHER_PING_STUDENT': {
          if (!activeStudentId || activeStudentId === msg.payload.studentId) {
            addToast(
              lang === 'zh' ? '⚠️ 课堂提醒' : '⚠️ Classroom Alert',
              msg.payload.message ||
                (lang === 'zh' ? '老师提醒您集中注意力跟上教学进度！' : 'Please keep up with class!'),
              'warning',
            );
          }
          break;
        }
        case 'TEACHER_BROADCAST_FULLSCREEN': {
          const { elementId, lessonId } = msg.payload;
          whiteboardViewStore.getState().setRemoteFullscreenElementId(elementId);
          if (elementId) {
            if (lessonId && lessonId !== selectedLesson) {
              setSelectedLesson(lessonId);
              fetchElements(lessonId);
            }
            setStudentViewStatus('lesson');
            setStudentLessonTab('whiteboard');
          }
          break;
        }
      }
    });

    return () => {
      unsub();
      channel.destroy();
    };
  }, [isStudentLiveMode, isFollowingTeacher, activeStudentId, liveStudentParam, lang]);

  if (sessionLoading) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4 relative overflow-hidden font-sans">
        <Loader2 size={48} className="text-indigo-500 animate-spin" />
        <span className="text-white text-sm mt-4 font-semibold tracking-wide">
          {lang === 'zh' ? '正在连接安全核心数据库...' : 'Connecting Secure OS Core Database...'}
        </span>
      </div>
    );
  }

  if (!session) {
    return <LoginPage onLoginSuccess={handleLoginSuccess} lang={lang} />;
  }

  // SEC-AUTH-06: 默认密码强制改密门 —— 种子账号（admin/admin、teacher/teacher）改密前
  // 不渲染应用外壳；服务端 enforcePasswordChanged 对写操作兜底拦截
  if (session.mustChangePassword) {
    return (
      <ForcedPasswordChangeGate
        lang={lang}
        username={session.username}
        onDone={() => setSession({ ...session, mustChangePassword: false })}
        onLogout={handleLogout}
      />
    );
  }

  return (
    <>
      {/* 大屏展台独立窗口：占满整个视口，不渲染平台外壳（导航/侧栏/顶栏都无意义） */}
      {isStageDisplayMode && (
        <StageDisplayView
          lessonId={stageLessonParam || selectedLesson}
          lessonTitle={stageTitleParam || lessons.find((l) => l.id === (stageLessonParam || selectedLesson))?.title}
          lang={stageLangParam === 'en' ? 'en' : 'zh'}
        />
      )}

      {!isStageDisplayMode && (
        <div className="flex h-screen bg-app text-main font-sans transition-colors duration-150">
          {/* Main Content Area: App Shell representing the Plugin Views */}
          <div className="flex-1 flex flex-col bg-app h-full overflow-hidden">
            {/* 全局模拟学生提示条 (Top Impersonation Banner) */}
            {session?.role === 'teacher' && activeRole === 'student' && !isStudentLiveMode && (
              <div className="bg-gradient-to-r from-amber-500 via-amber-600 to-orange-500 text-white px-6 py-1.5 flex items-center justify-between text-xs font-medium shadow-sm z-30 shrink-0 border-b border-amber-600/30">
                <div className="flex items-center gap-2.5">
                  <span className="bg-black/20 text-amber-100 px-2 py-0.5 rounded font-bold uppercase tracking-wider text-xs flex items-center gap-1">
                    <Eye size={12} />
                    {lang === 'zh'
                      ? isStudentPreviewMode
                        ? '学生视角预览'
                        : '学生模拟模式'
                      : isStudentPreviewMode
                        ? 'Student Preview'
                        : 'Student View Mode'}
                  </span>
                  <span>
                    {lang === 'zh'
                      ? `您当前正在以学生身份（${students.find((s) => s.id === activeStudentId)?.name || '未选择'}）预览系统界面与交互。`
                      : `You are currently previewing the platform as student (${students.find((s) => s.id === activeStudentId)?.name || 'None'}).`}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    // 备课预览标签页里没有教师端可回，直接关闭该标签页
                    if (isStudentPreviewMode) {
                      window.close();
                      return;
                    }
                    setActiveRole('teacher');
                  }}
                  className="bg-white text-amber-800 hover:bg-amber-50 active:bg-amber-100 font-bold px-3 py-1 rounded-md shadow-xs transition-all flex items-center gap-1.5 cursor-pointer text-xs"
                >
                  {isStudentPreviewMode ? <X size={13} /> : <LogOut size={13} />}
                  {lang === 'zh'
                    ? isStudentPreviewMode
                      ? '关闭此预览标签页'
                      : '退出模拟并返回教师端'
                    : isStudentPreviewMode
                      ? 'Close Preview Tab'
                      : 'Exit Student View'}
                </button>
              </div>
            )}

            {/* Top Navbar: 独立弹窗模式下渲染轻量化互动课堂专属 Header */}
            {isStudentLiveMode ? (
              <header className="h-13 bg-surface/95 backdrop-blur-md border-b border-theme px-4 flex items-center justify-between z-20 shrink-0 select-none shadow-xs">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-pink-500 to-rose-600 flex items-center justify-center text-white font-black shadow-sm text-sm">
                    🎓
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h1 className="text-sm font-black text-main tracking-wide">
                        {lang === 'zh' ? '互动课堂 · 学生端' : 'Interactive Classroom · Student Client'}
                      </h1>
                      <span className="flex items-center gap-1 text-xs font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                        {lang === 'zh' ? '已与教师中控台实时联动' : 'Synced with Teacher'}
                      </span>
                    </div>
                    <div className="text-xs text-muted flex items-center gap-2">
                      <span>
                        {activeStudentId
                          ? `学生: ${students.find((s) => s.id === activeStudentId)?.name || activeStudentId}`
                          : '学生端'}
                      </span>
                      <span>•</span>
                      <span>
                        {selectedLesson
                          ? `课节: ${lessons.find((l) => l.id === selectedLesson)?.title || selectedLesson}`
                          : '等待教师推流课节...'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (isStudentLocked) {
                        notifyLockedNavigation();
                        return;
                      }
                      setIsFollowingTeacher(!isFollowingTeacher);
                    }}
                    disabled={isStudentLocked}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all flex items-center gap-1.5 shadow-2xs ${
                      isStudentLocked ? 'cursor-not-allowed' : 'cursor-pointer'
                    } ${
                      isFollowingTeacher
                        ? 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800'
                        : 'bg-surface text-muted border-theme hover:text-main'
                    } ${isStudentLocked ? 'opacity-70' : ''}`}
                    title={
                      isStudentLocked
                        ? lang === 'zh'
                          ? '全班专注锁定中，已强制跟随教师步调'
                          : 'Class focus is locked; following the teacher is enforced'
                        : lang === 'zh'
                          ? '开启后，教师端切换课节/环节/Tab时，学生端将自动同步跟随'
                          : 'Follow teacher navigation'
                    }
                  >
                    <RefreshCw size={12} className={isFollowingTeacher ? 'animate-spin' : ''} />
                    <span>
                      {lang === 'zh'
                        ? `跟随教师步调: ${isFollowingTeacher ? '开' : '关'}`
                        : `Follow Teacher: ${isFollowingTeacher ? 'ON' : 'OFF'}`}
                    </span>
                  </button>

                  <FontSizeSelector lang={lang} />

                  <button
                    type="button"
                    onClick={() => {
                      if (!document.fullscreenElement) {
                        document.documentElement.requestFullscreen().catch(() => {});
                      } else {
                        document.exitFullscreen().catch(() => {});
                      }
                    }}
                    className="p-1.5 text-muted hover:text-main rounded-lg border border-theme hover:bg-surface-secondary transition-colors cursor-pointer"
                    title={lang === 'zh' ? '切换全屏' : 'Toggle Fullscreen'}
                  >
                    <Maximize2 size={14} />
                  </button>

                  <button
                    type="button"
                    onClick={() => window.close()}
                    className="px-2.5 py-1.5 text-xs font-bold text-rose-600 hover:text-rose-700 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 rounded-lg transition-colors cursor-pointer"
                    title={lang === 'zh' ? '关闭学生端Tab' : 'Close Tab'}
                  >
                    {lang === 'zh' ? '关闭Tab' : 'Close Tab'}
                  </button>
                </div>
              </header>
            ) : (
              <AppHeader
                activeRole={activeRole}
                setActiveRole={setActiveRole}
                studentPreviewTab={isStudentPreviewMode}
                lang={lang}
                teacherTab={teacherTab}
                studentViewStatus={studentViewStatus}
                session={session}
                activeStudentId={activeStudentId}
                students={students}
                studentDashboardData={studentDashboardData}
                isNotificationsOpen={isNotificationsOpen}
                studentNotifications={studentNotifications}
                unreadNotifications={unreadNotifications}
                readNotifications={readNotifications}
                selectedNotificationForModal={selectedNotificationForModal}
                dbConnected={dbConnected}
                dbStatus={dbStatus}
                siteInfo={siteInfo}
                setActiveStudentId={setActiveStudentId}
                setReadNotifications={setReadNotifications}
                setIsSystemResourceLibraryOpen={setIsSystemResourceLibraryOpen}
                setProfileOpen={setProfileOpen}
                setTeacherTab={setTeacherTab}
                setStudentViewStatus={setStudentViewStatus}
                setIsNotificationsOpen={setIsNotificationsOpen}
                setSelectedNotificationForModal={setSelectedNotificationForModal}
                handleLogout={handleLogout}
                toggleLanguage={toggleLanguage}
                isStudentLocked={isStudentLocked}
                onBlockedNavigate={notifyLockedNavigation}
              />
            )}

            <ProfileModal
              open={profileOpen}
              session={session}
              lang={lang}
              onClose={() => setProfileOpen(false)}
              onSaved={(name) => {
                if (session) setSession({ ...session, name });
                setProfileOpen(false);
              }}
              onAvatar={(avatar) => {
                if (session) setSession({ ...session, avatar: avatar ?? undefined });
              }}
            />

            <AppShell
              students={students}
              activeStudentId={activeStudentId}
              isStudentLocked={isStudentLocked}
              studentViewStatus={studentViewStatus}
              studentDashboardData={studentDashboardData}
              readNotifications={readNotifications}
              setReadNotifications={setReadNotifications}
              addToast={addToast}
              lang={lang}
              setSelectedLesson={setSelectedLesson}
              setStudentViewStatus={setStudentViewStatus}
              setSelectedAssignment={setSelectedAssignment}
              setQuizStudentAnswers={setQuizStudentAnswers}
              setSubAssignmentTab={setSubAssignmentTab}
              lessons={lessons}
              selectedLesson={selectedLesson}
              studentFullscreenPanel={studentFullscreenPanel}
              setStudentFullscreenPanel={setStudentFullscreenPanel}
              timelineSegments={timelineSegments}
              activeSegmentId={activeSegmentId}
              setActiveSegmentId={setActiveSegmentId}
              localProgressPercent={localProgressPercent}
              setLocalProgressPercent={setLocalProgressPercent}
              updateStudentProgress={updateStudentProgress}
              isStudentLessonContentCollapsed={isStudentLessonContentCollapsed}
              setIsStudentLessonContentCollapsed={setIsStudentLessonContentCollapsed}
              studentLessonTab={studentLessonTab}
              setStudentLessonTab={setStudentLessonTab}
              elements={elements}
              activeRole={activeRole}
              fetchElements={fetchElements}
              currentVfsParent={currentVfsParent}
              setCurrentVfsParent={setCurrentVfsParent}
              vfsNodes={vfsNodes}
              studentSelectedCourseware={studentSelectedCourseware}
              setStudentSelectedCourseware={setStudentSelectedCourseware}
              selectedAssignment={selectedAssignment}
              quizStudentAnswers={quizStudentAnswers}
              submitQuizAssignment={submitQuizAssignment}
              subAssignmentTab={subAssignmentTab}
              mainNavCollapsed={mainNavCollapsed}
              setMainNavCollapsed={setMainNavCollapsed}
              teacherTab={teacherTab}
              setTeacherTab={setTeacherTab}
              session={session}
              todaySchedules={todaySchedules}
              t={t}
              classes={classes}
              approvals={approvals}
              processes={processes}
              isApprovalsCollapsed={isApprovalsCollapsed}
              setIsApprovalsCollapsed={setIsApprovalsCollapsed}
              isProcessesCollapsed={isProcessesCollapsed}
              setIsProcessesCollapsed={setIsProcessesCollapsed}
              scoreOverrides={scoreOverrides}
              setScoreOverrides={setScoreOverrides}
              handleApprove={handleApprove}
              handleReject={handleReject}
              showLogs={showLogs}
              setShowLogs={setShowLogs}
              processLogsContent={processLogsContent}
              showProcessLogs={showProcessLogs}
              fetchProcessLogs={fetchProcessLogs}
              setShowProcessLogs={setShowProcessLogs}
              handleQuickScheduleClass={handleQuickScheduleClass}
              handleQuickGenerateAssignment={handleQuickGenerateAssignment}
              handleQuickCreateLesson={handleQuickCreateLesson}
              setActiveRole={setActiveRole}
              editorSaveStatus={editorSaveStatus}
              setEditorSaveStatus={setEditorSaveStatus}
              editorLastSavedTime={editorLastSavedTime}
              setEditorLastSavedTime={setEditorLastSavedTime}
              handlePaletteActivate={handlePaletteActivate}
              draggedSegmentIdx={draggedSegmentIdx}
              setDraggedSegmentIdx={setDraggedSegmentIdx}
              saveTimeline={saveTimeline}
              editorPanelsExpanded={editorPanelsExpanded}
              setEditorPanelsExpanded={setEditorPanelsExpanded}
              whiteboardRef={whiteboardRef}
              paletteEdit={paletteEdit}
              handlePaletteConfirm={handlePaletteConfirm}
              setPaletteEdit={setPaletteEdit}
              plugins={plugins}
              liveClassSelectedClassId={liveClassSelectedClassId}
              setLiveClassSelectedClassId={setLiveClassSelectedClassId}
              liveClassIsActive={liveClassIsActive}
              setLiveClassIsActive={setLiveClassIsActive}
              liveClassTimeRemaining={liveClassTimeRemaining}
              setLiveClassTimeRemaining={setLiveClassTimeRemaining}
              liveClassFeed={liveClassFeed}
              setLiveClassFeed={setLiveClassFeed}
              liveClassAcknowledgedMap={liveClassAcknowledgedMap}
              setLiveClassAcknowledgedMap={setLiveClassAcknowledgedMap}
              onlineStudentIds={onlineStudentIds}
              activeStudentLessons={activeStudentLessons}
              liveClassStudentProgress={liveClassStudentProgress}
              storeTab={storeTab}
              setStoreTab={setStoreTab}
              pluginCode={pluginCode}
              setPluginCode={setPluginCode}
              installingPlugin={installingPlugin}
              onInstall={handleInstallPlugin}
              onZipUpload={handleZipPluginUpload}
              onToggle={handleTogglePlugin}
              onDelete={handleDeletePlugin}
              lessonsSearchQuery={lessonsSearchQuery}
              setLessonsSearchQuery={setLessonsSearchQuery}
              lessonsSortOrder={lessonsSortOrder}
              setLessonsSortOrder={setLessonsSortOrder}
              filteredLessons={filteredAndSortedLessons}
              onOpenImportLessons={() => {
                setImportStatus('idle');
                setImportProgress(0);
                setImportProgressTotal(0);
                setImportErrorMsg('');
                setPreviewImportData([]);
                setIsImportLessonsOpen(true);
              }}
              onOpenCourseWizard={() => {
                setWizardStep(1);
                setIsCourseWizardOpen(true);
              }}
              onViewCourse={(lessonId) => {
                setTeacherTab('lesson_editor');
                setSelectedLesson(lessonId);
              }}
              onDeleteCourse={handleDeleteCourse}
              onCopyCourse={handleCopyCourse}
              filterEnrollment={filterEnrollment}
              setFilterEnrollment={setFilterEnrollment}
              filterHasContent={filterHasContent}
              setFilterHasContent={setFilterHasContent}
              filterThisMonth={filterThisMonth}
              setFilterThisMonth={setFilterThisMonth}
              copyingLessonId={copyingLessonId}
              onSchedulesUpdated={fetchTodaySchedules}
              onLogout={handleLogout}
              aiProviders={aiProviders}
              testingProviderId={testingProviderId}
              onAIProvidersChanged={fetchAIProviders}
              onTriggerTour={() => setIsTourOpen(true)}
              siteInfo={siteInfo}
              onSiteInfoChanged={setSiteInfo}
              computerLabs={computerLabs}
              onRefresh={fetchLabs}
              registeredCommands={registeredCommands}
              fetchRegisteredCommands={fetchRegisteredCommands}
              batchMode={batchMode}
              selectedClassIds={selectedClassIds}
              setSelectedClassIds={setSelectedClassIds}
              setSelectedStudentIds={setSelectedStudentIds}
              setBatchMode={setBatchMode}
              expandedClassId={expandedClassId}
              setExpandedClassId={setExpandedClassId}
              exportTooltipOpen={exportTooltipOpen}
              setExportTooltipOpen={setExportTooltipOpen}
              exportDropdownOpen={exportDropdownOpen}
              setExportDropdownOpen={setExportDropdownOpen}
              isExportingAllCombined={isExportingAllCombined}
              loadingExportClassId={loadingExportClassId}
              classStudentsMap={classStudentsMap}
              setClassStudentsMap={setClassStudentsMap}
              expandedStudentId={expandedStudentId}
              setExpandedStudentId={setExpandedStudentId}
              selectedStudentIds={selectedStudentIds}
              rosterViewMode={rosterViewMode}
              setRosterViewMode={setRosterViewMode}
              rosterSearchQuery={rosterSearchQuery}
              setRosterSearchQuery={setRosterSearchQuery}
              rosterTagFilter={rosterTagFilter}
              setRosterTagFilter={setRosterTagFilter}
              toggleSelectAllStudents={toggleSelectAllStudents}
              handleBatchDeleteStudents={handleBatchDeleteStudents}
              handleBatchResetPassword={handleBatchResetPassword}
              handleBatchTransferStudents={handleBatchTransferStudents}
              handleBatchSetLockedLesson={handleBatchSetLockedLesson}
              toggleStudentSelection={toggleStudentSelection}
              get30DayAverageWarning={get30DayAverageWarning}
              studentProgressMap={studentProgressMap}
              studentActiveTabs={studentActiveTabs}
              setStudentActiveTabs={setStudentActiveTabs}
              setStudents={setStudents}
              fetchClassStudents={fetchClassStudents}
              fetchStudents={fetchStudents}
              parseCSV={parseCSV}
              setImportError={setImportError}
              setImportSuccess={setImportSuccess}
              setShowImportModal={setShowImportModal}
              fetchClasses={fetchClasses}
              classSubmissionFilters={classSubmissionFilters}
              setClassSubmissionFilters={setClassSubmissionFilters}
              classActiveTabs={classActiveTabs}
              setClassActiveTabs={setClassActiveTabs}
              classProgressMap={classProgressMap}
              classSchedulesMap={classSchedulesMap}
              classDashboardMap={classDashboardMap}
              assignmentSortOrder={assignmentSortOrder}
              setAssignmentSortOrder={setAssignmentSortOrder}
              isGeneratingPDFReport={isGeneratingPDFReport}
              handleGeneratePDFReport={handleGeneratePDFReport}
              setExportClassId={setExportClassId}
              setExportClassName={setExportClassName}
              setQuizzesWeight={setQuizzesWeight}
              setAssignmentsWeight={setAssignmentsWeight}
              setCustomCategoryOverrides={setCustomCategoryOverrides}
              setIsExportWeightModalOpen={setIsExportWeightModalOpen}
              isGeneratingAssignment={isGeneratingAssignment}
              setQuizGeneratorClassId={setQuizGeneratorClassId}
              setQuizGenMode={setQuizGenMode}
              setQuizGenSelectedLessonId={setQuizGenSelectedLessonId}
              setQuizGenTopic={setQuizGenTopic}
              setSuggestedObjectives={setSuggestedObjectives}
              setSuggestedQuestions={setSuggestedQuestions}
              setIsQuizGeneratorOpen={setIsQuizGeneratorOpen}
              setActiveStudentId={setActiveStudentId}
              isGrading={isGrading}
              setIsGrading={setIsGrading}
              fetchClassDashboard={fetchClassDashboard}
              newScheduleDate={newScheduleDate}
              setNewScheduleDate={setNewScheduleDate}
              newScheduleLessonId={newScheduleLessonId}
              setNewScheduleLessonId={setNewScheduleLessonId}
              expandedScheduleId={expandedScheduleId}
              setExpandedScheduleId={setExpandedScheduleId}
              fetchScheduleAttendance={fetchScheduleAttendance}
              scheduleAttendanceMap={scheduleAttendanceMap}
              toggleSelectAllClasses={toggleSelectAllClasses}
              handleBatchDeleteClasses={handleBatchDeleteClasses}
              handleBatchExportClasses={handleBatchExportClasses}
              handleBatchSetPasscode={handleBatchSetPasscode}
              handleBatchScheduleClasses={handleBatchScheduleClasses}
              handleExportAllClassesCombined={handleExportAllClassesCombined}
              triggerExportForClass={triggerExportForClass}
              fetchClassProgress={fetchClassProgress}
              fetchClassSchedules={fetchClassSchedules}
              fetchStudentProgress={fetchStudentProgress}
              toggleClassSelection={toggleClassSelection}
              socketRef={socketRef}
              setShowCoursewareHub={setShowCoursewareHub}
              fetchTodaySchedules={fetchTodaySchedules}
            />
          </div>

          <RightSidebar
            showRightSidebar={showRightSidebar}
            setShowRightSidebar={setShowRightSidebar}
            rightSidebarTab={rightSidebarTab}
            setRightSidebarTab={setRightSidebarTab}
            effectiveAgentProviderId={effectiveAgentProviderId}
            agentProviderId={agentProviderId}
            setAgentProviderId={setAgentProviderId}
            personaId={personaId}
            setPersonaId={setPersonaId}
            aiProviders={aiProviders}
            selectedAgentProvider={selectedAgentProvider}
            chatLog={chatLog}
            loading={loading}
            input={input}
            setInput={setInput}
            handleSend={handleSend}
            chatAttachments={chatAttachments}
            setChatAttachments={setChatAttachments}
            handleChatFileChange={handleChatFileChange}
            handleChatDrop={handleChatDrop}
            onClearAgentMemory={handleClearAgentMemory}
            events={events}
            lang={lang}
            t={t}
          />

          <AppModals
            lang={lang as 'zh' | 'en'}
            t={t}
            courseWizard={courseWizard}
            quizGenerator={quizGenerator}
            classBatch={classBatch}
            studentNotificationsHook={studentNotificationsHook}
            showImportModal={showImportModal}
            setShowImportModal={setShowImportModal}
            handleImportFile={handleImportFile}
            importError={importError}
            importSuccess={importSuccess}
            isImporting={isImporting}
            downloadCSVTemplate={downloadCSVTemplate}
            addToast={addToast}
            generateTemplateContent={generateTemplateContent}
            isImportLessonsOpen={isImportLessonsOpen}
            setIsImportLessonsOpen={setIsImportLessonsOpen}
            importStatus={importStatus}
            setIsDraggingImport={setIsDraggingImport}
            handleCSVFileChange={handleCSVFileChange}
            downloadCsvTemplate={downloadCsvTemplate}
            isDraggingImport={isDraggingImport}
            previewImportData={previewImportData}
            setPreviewImportData={setPreviewImportData}
            setImportStatus={setImportStatus}
            importProgress={importProgress}
            importProgressTotal={importProgressTotal}
            importErrorMsg={importErrorMsg}
            setImportErrorMsg={setImportErrorMsg}
            handleCSVImportSubmit={handleCSVImportSubmit}
            lessons={lessons}
            fetchClassDashboard={fetchClassDashboard}
            currentVfsParent={currentVfsParent}
            setCurrentVfsParent={setCurrentVfsParent}
            vfsNodes={vfsNodes}
            showProcessLogs={showProcessLogs}
            setShowProcessLogs={setShowProcessLogs}
            processLogsContent={processLogsContent}
            isCloudDriveOpen={isCloudDriveOpen}
            setIsCloudDriveOpen={setIsCloudDriveOpen}
            cloudDrivePreviewNode={cloudDrivePreviewNode}
            setCloudDrivePreviewNode={setCloudDrivePreviewNode}
            isSystemResourceLibraryOpen={isSystemResourceLibraryOpen}
            setIsSystemResourceLibraryOpen={setIsSystemResourceLibraryOpen}
            systemResourceTab={systemResourceTab}
            setSystemResourceTab={setSystemResourceTab}
            selectedLibraryResourceId={selectedLibraryResourceId}
            setSelectedLibraryResourceId={setSelectedLibraryResourceId}
            loadingLibraryResources={loadingLibraryResources}
            libraryResources={libraryResources}
            fetchLibraryResources={fetchLibraryResources}
            classes={classes}
            expandedClassId={expandedClassId}
            isExportWeightModalOpen={isExportWeightModalOpen}
            setIsExportWeightModalOpen={setIsExportWeightModalOpen}
            quizzesWeight={quizzesWeight}
            setQuizzesWeight={setQuizzesWeight}
            assignmentsWeight={assignmentsWeight}
            setAssignmentsWeight={setAssignmentsWeight}
            handleQuizzesWeightChange={handleQuizzesWeightChange}
            handleAssignmentsWeightChange={handleAssignmentsWeightChange}
            customCategoryOverrides={customCategoryOverrides}
            setCustomCategoryOverrides={setCustomCategoryOverrides}
            classDashboardMap={classDashboardMap}
            exportClassId={exportClassId}
            exportClassName={exportClassName}
            csvPreviewData={csvPreviewData}
            handleExportGrades={handleExportGrades}
            setSelectedAssignment={setSelectedAssignment}
            setStudentViewStatus={setStudentViewStatus}
            setQuizStudentAnswers={setQuizStudentAnswers}
            setSubAssignmentTab={setSubAssignmentTab}
            isTourOpen={isTourOpen}
            setIsTourOpen={setIsTourOpen}
            handleSeedSuccess={handleSeedSuccess}
            setTeacherTab={setTeacherTab}
            showCoursewareHub={showCoursewareHub}
            setShowCoursewareHub={setShowCoursewareHub}
          />

          {/* 全班随机抽问结果通知横幅 (Classroom Pick Announcement Banner) */}
          {pickedAnnouncement && !pickedAlertData && (
            <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[9990] animate-in slide-in-from-top-4 duration-300 pointer-events-auto max-w-lg w-auto">
              <div className="flex items-center gap-3 px-5 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-full shadow-xl shadow-amber-500/25 backdrop-blur-xs text-sm font-bold border border-amber-300/40">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-white" />
                </span>
                <Sparkles size={16} className="text-amber-200 shrink-0" />
                <span className="truncate">
                  {lang === 'zh'
                    ? `🎯 课堂抽问：老师随机抽中了【${pickedAnnouncement.studentName}】同学回答问题！`
                    : `🎯 Classroom Pick: Teacher randomly selected [${pickedAnnouncement.studentName}] to answer!`}
                </span>
                <button
                  type="button"
                  onClick={() => setPickedAnnouncement(null)}
                  className="ml-2 hover:bg-white/20 rounded-full p-1 transition-colors cursor-pointer text-white/80 hover:text-white shrink-0"
                  aria-label="Close announcement"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          )}

          {/* 课堂随机提问/点名互动应答模态框 (Student Picked Alert Modal - 着重提示被抽中学生) */}
          {pickedAlertData && (
            <div className="fixed inset-0 z-[9999] bg-black/70 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-200">
              <div className="bg-surface border-4 border-amber-500 rounded-3xl shadow-2xl shadow-amber-500/40 ring-8 ring-amber-500/20 p-7 max-w-md w-full text-center space-y-5 animate-in zoom-in-95 duration-300">
                <div className="relative w-20 h-20 mx-auto">
                  <div className="absolute inset-0 bg-amber-500/30 rounded-full animate-ping" />
                  <div className="relative w-20 h-20 bg-gradient-to-tr from-amber-500 to-orange-500 text-white rounded-full flex items-center justify-center shadow-lg shadow-amber-500/40">
                    <Sparkles size={40} className="animate-pulse" />
                  </div>
                </div>
                <div className="space-y-2">
                  <h3 className="text-2xl font-black text-main tracking-tight">
                    {lang === 'zh' ? '⚡️ 闪电抽问：老师抽中了你！' : '⚡️ Classroom Pick: Teacher Selected You!'}
                  </h3>
                  <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400 font-black text-lg">
                    <span>🎯</span>
                    <span>{pickedAlertData.studentName}</span>
                  </div>
                  <p className="text-sm text-muted leading-relaxed">
                    {lang === 'zh' ? (
                      <>老师在课堂随机抽问中抽中了你，请立即集中注意力参与互动回答！</>
                    ) : (
                      <>The teacher selected you in the classroom random pick. Please respond and participate now!</>
                    )}
                  </p>
                </div>
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      const channel = new ClassroomSyncChannel(undefined, selectedLesson, liveClassSelectedClassId);
                      channel.acknowledgePick(pickedAlertData.studentId);
                      channel.destroy();
                      // 同一 ID 也用于仪表盘顶部的点名警报区：在弹窗里确认答到后
                      // 应同步标记为已读，避免同一次点名在两处重复提醒。
                      if (pickedAlertData.rollcallId) {
                        const rollcallId = pickedAlertData.rollcallId;
                        if (activeStudentId) {
                          postStudentReadNotification(activeStudentId, rollcallId).catch(console.error);
                        }
                        setReadNotifications((prev) => new Set(prev).add(rollcallId));
                      }
                      setPickedAlertData(null);
                      addToast(
                        lang === 'zh' ? '🙋‍♂️ 已确认答到' : '🙋‍♂️ Acknowledged',
                        lang === 'zh' ? '已向老师中控台发送举手答到信号！' : 'Sent acknowledge signal to teacher!',
                        'success',
                      );
                    }}
                    className="w-full py-3.5 bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white font-black text-base rounded-2xl shadow-xl shadow-amber-500/35 transition-all active:scale-95 cursor-pointer flex items-center justify-center gap-2"
                  >
                    <CheckCircle2 size={20} />
                    <span>
                      {lang === 'zh' ? '🙋‍♂️ 我已准备好 / 确认答到 (反馈给老师)' : '🙋‍♂️ Ready / Acknowledge to Teacher'}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 学生端实时互动浮层 (Pacing Signals, Quick Polls, Buzzer, 60s Exit Ticket) */}
          {(activeRole === 'student' || isStudentLiveMode) && (
            <StudentInteractiveOverlay
              lessonId={selectedLesson}
              studentId={activeStudentId || liveStudentParam || undefined}
              studentName={students.find((s) => s.id === (activeStudentId || liveStudentParam))?.name || undefined}
              lang={lang as any}
            />
          )}

          {/* Real-time Toast Notifications */}
          <ToastContainer />

          {/* Global System Error Diagnostics Center & Floating Pill */}
          <SystemErrorCenterModal />
        </div>
      )}
    </>
  );
}
