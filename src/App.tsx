import { Loader2, Eye, LogOut, Maximize2, Sparkles, CheckCircle2, RefreshCw } from 'lucide-react';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { parseCSV } from './utils/pluginParsers.js';
import { translations } from './i18n';
import { LoginPage } from './components/LoginPage';
import { AppHeader } from './components/AppHeader';
import { ClassroomSyncChannel } from './services/classroom-sync-channel';
import { whiteboardViewStore } from './store/whiteboardViewStore';
import { ProfileModal } from './components/ProfileModal';
import { FontSizeSelector } from './components/FontSizeSelector';
import { PALETTE_ITEM_MAP, getPaletteItemConfig } from './features/teacher/lesson-editor/paletteConfig';
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
import {
  downloadCSVTemplate as downloadCSVTemplateService,
  parseAndImportClassesOrStudents,
  parseLessonCSV,
  submitCSVLessons,
} from './services/bulkImportService';
import { SystemErrorCenterModal } from './features/modals/SystemErrorCenterModal';
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

  const [isFollowingTeacher, setIsFollowingTeacher] = useState(true);
  const [pickedAlertData, setPickedAlertData] = useState<{ studentId: string; studentName: string } | null>(null);
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
  const [liveClassStudentProgress, setLiveClassStudentProgress] = useState<any[]>([]);
  const [localProgressPercent, setLocalProgressPercent] = useState<number>(0);

  const [isCloudDriveOpen, setIsCloudDriveOpen] = useState(false);
  const [cloudDrivePreviewNode, setCloudDrivePreviewNode] = useState<{
    id: string;
    name: string;
    content: string;
  } | null>(null);

  const [isSystemResourceLibraryOpen, setIsSystemResourceLibraryOpen] = useState(false);
  const [systemResourceTab, setSystemResourceTab] = useState<'system' | 'cloud'>('system');
  const [selectedLibraryResourceId, setSelectedLibraryResourceId] = useState<string | null>(null);
  const [libraryResources, setLibraryResources] = useState<any[]>([]);
  const [loadingLibraryResources, setLoadingLibraryResources] = useState(false);
  const [showCoursewareHub, setShowCoursewareHub] = useState(false);

  const fetchLibraryResources = async () => {
    try {
      setLoadingLibraryResources(true);
      const res = await fetch('/api/resources');
      if (res.ok) {
        const data = await res.json();
        setLibraryResources(data);
      }
    } catch (e) {
      console.warn('Error fetching library resources:', e);
    } finally {
      setLoadingLibraryResources(false);
    }
  };

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

  React.useEffect(() => {
    if (isSystemResourceLibraryOpen) {
      fetchLibraryResources();
    }
  }, [isSystemResourceLibraryOpen]);

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
  const [registeredCommands, setRegisteredCommands] = useState<any[]>([]);
  const selectedLesson = useAppStore((s) => s.selectedLesson);
  const setSelectedLesson = useAppStore((s) => s.setSelectedLesson);
  const elements = useAppStore((s) => s.elements);
  const setElements = useAppStore((s) => s.setElements);

  // Import Lessons states
  const [isImportLessonsOpen, setIsImportLessonsOpen] = useState(false);
  const [importStatus, setImportStatus] = useState<'idle' | 'parsing' | 'importing' | 'success' | 'error'>('idle');
  const [importProgress, setImportProgress] = useState(0);
  const [importProgressTotal, setImportProgressTotal] = useState(0);
  const [importErrorMsg, setImportErrorMsg] = useState('');
  const [previewImportData, setPreviewImportData] = useState<{ title: string; content: string }[]>([]);
  const [isDraggingImport, setIsDraggingImport] = useState(false);

  const [showRightSidebar, setShowRightSidebar] = useState(false);
  const [rightSidebarTab, setRightSidebarTab] = useState<'agent' | 'shell'>('agent');

  const [showLogs, setShowLogs] = useState(false);
  const [vfsNodes, setVfsNodes] = useState<VFSNode[]>([]);
  const [processes, setProcesses] = useState<ProcessType[]>([]);
  const [showProcessLogs, setShowProcessLogs] = useState<string | null>(null);
  const [processLogsContent, setProcessLogsContent] = useState('');
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

  const [expandedClassId, _setExpandedClassId] = useState<string | null>(null);
  const expandedClassIdRef = useRef<string | null>(null);
  const setExpandedClassId = (id: string | null) => {
    _setExpandedClassId(id);
    expandedClassIdRef.current = id;
  };
  const [classStudentsMap, setClassStudentsMap] = useState<Record<string, StudentType[]>>({});
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
        const res = await fetch('/api/db-status');
        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          if (data.status === 'warning' || data.warning) {
            setDbStatus('warning');
          } else {
            setDbStatus('normal');
          }
          setDbConnected(true);
        } else if (res.status === 429 || res.status === 503) {
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
        const res = await fetch('/api/auth/session');
        if (res.ok) {
          const data = await res.json();
          if (data.session) {
            setSession(data.session);
            if (isStudentLiveMode) {
              // 独立弹窗学生模式：强制进入学生端课节模式
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
        const res = await fetch('/api/site-settings');
        if (res.ok) {
          const data = await res.json();
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
  const addToast = (title: string, message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info') => {
    const id = Math.random().toString(36).substring(2, 9);
    appStore.getState().addToast({ id, title, message, type });
    setTimeout(() => {
      appStore.getState().removeToast(id);
    }, 6000);
  };

  // ── 全班专注锁定：学生被教师锁定时，只读跟随当前授课 ──────────────────────
  // 锁定状态由 students 表中的 locked_lesson_id 派生，或由 ClassroomSyncChannel 广播实时下发。
  const isStudentLocked =
    activeRole === 'student' &&
    ((!!activeStudentId && !!students.find((s) => s.id === activeStudentId)?.locked_lesson_id) ||
      liveClassFocusLocked);

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

  const fetchLessons = async () => {
    try {
      const res = await fetch('/api/lessons');
      if (res.ok) {
        const data = await res.json();
        setLessons(data);
        if (!appStore.getState().selectedLesson && data.length > 0) {
          setSelectedLesson(data[0].id);
        }
      }
    } catch (e) {
      console.warn('Failed to fetch lessons', e);
    }
  };

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
  const effectiveAgentProviderId =
    aiProviders.some((provider) => provider.id === agentProviderId)
      ? agentProviderId
      : (aiProviders[0]?.id || '');
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
  const [isLessonPreviewVisible, setIsLessonPreviewVisible] = useState(false);
  const [previewSelectedCourseware, setPreviewSelectedCourseware] = useState<string | null>(null);
  const [previewLessonTab, setPreviewLessonTab] = useState<'whiteboard' | 'courseware'>('whiteboard');
  const [previewFullscreenPanel, setPreviewFullscreenPanel] = useState<'none' | 'left' | 'right'>('none');
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
  const [classActiveTabs, setClassActiveTabs] = useState<
    Record<string, 'students' | 'assignments' | 'schedules' | 'seating' | 'grades'>
  >({});
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
      fetch(`/api/students/${activeStudentId}/read_notifications`)
        .then((res) => (res.ok ? res.json() : []))
        .then((data) => {
          setReadNotifications(new Set(data));
        })
        .catch((err) => {
          console.warn('Failed to load read notifications from DB', err);
          setReadNotifications(new Set());
        });
    }
  }, [activeStudentId]);

  const expandedStudentIdRef = useRef<string | null>(null);
  const setExpandedStudentId = (id: string | null) => {
    _setExpandedStudentId(id);
    expandedStudentIdRef.current = id;
  };
  const [studentProgressMap, setStudentProgressMap] = useState<Record<string, StudentProgressType[]>>({});
  const [classProgressMap, setClassProgressMap] = useState<
    Record<string, { lesson_id: string; lesson_title: string; average_progress: number }[]>
  >({});
  const [classAssignmentsMap, setClassAssignmentsMap] = useState<Record<string, AssignmentType[]>>({});
  const [assignmentSubmissionsMap, setAssignmentSubmissionsMap] = useState<Record<string, SubmissionType[]>>({});
  const [isGeneratingAssignment, setIsGeneratingAssignment] = useState<string | null>(null);
  const [assignmentSortOrder, setAssignmentSortOrder] = useState<'dueDate' | 'status' | 'avgScore'>('dueDate');

  const [expandedAssignmentId, _setExpandedAssignmentId] = useState<string | null>(null);
  const setExpandedAssignmentId = (id: string | null) => {
    _setExpandedAssignmentId(id);
  };
  const [isGrading, setIsGrading] = useState<Record<string, boolean>>({});

  // Class/Student Bulk Import State variables
  const [showImportModal, setShowImportModal] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);

  const [currentVfsParent, _setCurrentVfsParent] = useState<string | null>(null);
  const currentVfsParentRef = useRef<string | null>(null);
  const setCurrentVfsParent = (id: string | null) => {
    _setCurrentVfsParent(id);
    currentVfsParentRef.current = id;
  };

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(AGENT_PROVIDER_STORAGE_KEY, agentProviderId);
    }
  }, [agentProviderId]);

  useEffect(() => {
    if (
      aiProviders.length > 0 &&
      !aiProviders.some((provider) => provider.id === agentProviderId)
    ) {
      setAgentProviderId(aiProviders[0].id);
    }
  }, [aiProviders, agentProviderId]);

  const handleQuickScheduleClass = async (classId: string, lessonId: string, date: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/classes/${classId}/schedules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lessonId, scheduledDate: date }),
      });
      if (res.ok) {
        await fetchClassSchedules(classId);
        return true;
      }
    } catch (e) {
      console.error('Quick schedule class failed', e);
    }
    return false;
  };

  const handleQuickGenerateAssignment = async (
    classId: string,
    title: string,
    desc?: string,
  ): Promise<string | null> => {
    try {
      const topic = title || desc || 'Assignment';
      const res = await fetch(`/api/classes/${classId}/assignments/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic }),
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        await fetchClassDashboard(classId);
        return data.id || 'assignment-created';
      }
    } catch (e) {
      console.error('Quick generate assignment failed', e);
    }
    return null;
  };

  const handleQuickCreateLesson = async (title: string, content: string): Promise<string> => {
    try {
      const res = await fetch('/api/lessons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content }),
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        await fetchLessons();
        return data.id || 'lesson-created';
      }
    } catch (e) {
      console.error('Quick create lesson failed', e);
    }
    return '';
  };

  const downloadCsvTemplate = () => {
    downloadCSVTemplateService('class', lang);
  };

  const handleCSVFileChange = async (file: File) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setImportStatus('error');
      setImportErrorMsg(lang === 'zh' ? '只支持包含 .csv 后缀名的文件！' : 'Only files ending in .csv are supported!');
      return;
    }
    setImportStatus('parsing');
    setImportErrorMsg('');
    try {
      const parsedList = await parseLessonCSV(file, lang);
      setPreviewImportData(parsedList);
      setImportStatus('idle');
    } catch (err: any) {
      setImportStatus('error');
      setImportErrorMsg(err.message || String(err));
    }
  };

  const handleCSVImportSubmit = async () => {
    if (previewImportData.length === 0) return;
    setImportStatus('importing');
    setImportProgress(0);
    setImportProgressTotal(previewImportData.length);
    const result = await submitCSVLessons(previewImportData, {
      lang,
      setImportProgress,
      fetchLessons,
    });
    if (result.success) {
      setImportStatus('success');
    } else {
      setImportStatus('error');
      setImportErrorMsg(result.errorMsg || '');
    }
  };

  const handleDeleteCourse = async (lessonId: string) => {
    const res = await fetch(`/api/lessons/${lessonId}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Failed to delete course');
    }
    await fetchLessons();
    if (selectedLesson === lessonId) {
      setSelectedLesson(null);
    }
    addToast(
      lang === 'zh' ? '课程已删除' : 'Course Deleted',
      lang === 'zh' ? '课程及其所有关联数据已被删除。' : 'The course and all associated data have been deleted.',
      'success',
    );
  };

  const handleCopyCourse = async (lessonId: string) => {
    setCopyingLessonId(lessonId);
    try {
      const res = await fetch(`/api/lessons/${lessonId}/clone`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to copy course');
      }
      await fetchLessons();
      addToast(
        lang === 'zh' ? '复制成功' : 'Course Copied',
        lang === 'zh' ? '课程已成功复制。' : 'Course has been copied successfully.',
        'success',
      );
    } catch (e: any) {
      addToast(
        lang === 'zh' ? '复制失败' : 'Copy Failed',
        e.message || (lang === 'zh' ? '复制课程时发生错误。' : 'An error occurred while copying the course.'),
        'error',
      );
    } finally {
      setCopyingLessonId(null);
    }
  };

  const fetchRegisteredCommands = async () => {
    try {
      const res = await fetch('/api/commands/registered');
      if (!res.ok) return;
      const contentType = res.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        const data = await res.json();
        if (Array.isArray(data)) {
          setRegisteredCommands(data);
        }
      }
    } catch (e) {
      console.warn('Failed to fetch registered commands', e);
    }
  };

  const fetchVfs = async (parentId: string | null) => {
    if (!session) return;
    try {
      const res = await fetch(`/api/vfs${parentId ? `?parentId=${parentId}` : ''}`);
      if (res.ok) {
        const data = await res.json();
        setVfsNodes(data);
      }
    } catch (e) {
      console.warn('Failed to fetch VFS nodes', e);
    }
  };

  const fetchProcesses = async () => {
    try {
      const res = await fetch('/api/processes');
      if (res.ok) {
        setProcesses(await res.json());
      }
    } catch (e) {}
  };

  const fetchClasses = async () => {
    try {
      const res = await fetch('/api/classes');
      if (res.ok) setClasses(await res.json());
    } catch (e) {}
  };

  const fetchStudents = async () => {
    try {
      const res = await fetch('/api/students');
      if (res.ok) setStudents(await res.json());
    } catch (e) {}
  };

  const fetchClassStudents = async (id: string) => {
    try {
      const res = await fetch(`/api/classes/${id}/students`);
      if (res.ok) {
        const data = await res.json();
        setClassStudentsMap((prev) => ({ ...prev, [id]: data }));
      }
    } catch (e) {}
  };

  const fetchClassProgress = async (id: string) => {
    try {
      const res = await fetch(`/api/classes/${id}/progress`);
      if (res.ok) {
        const data = await res.json();
        setClassProgressMap((prev) => ({ ...prev, [id]: data }));
      }
    } catch (e) {}
  };

  const [classDashboardMap, setClassDashboardMap] = useState<Record<string, any>>({});

  const fetchClassDashboard = async (id: string) => {
    try {
      const res = await fetch(`/api/classes/${id}/dashboard`);
      if (res.ok) {
        const data = await res.json();
        setClassDashboardMap((prev) => ({ ...prev, [id]: data }));
      }
    } catch (e) {}
  };

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

  const fetchAssignmentSubmissions = async (id: string) => {
    try {
      const res = await fetch(`/api/assignments/${id}/submissions`);
      if (res.ok) {
        const data = await res.json();
        setAssignmentSubmissionsMap((prev) => ({ ...prev, [id]: data }));
      }
    } catch (e) {}
  };

  const fetchStudentDashboard = async (id: string) => {
    try {
      const res = await fetch(`/api/students/${id}/dashboard`);
      if (res.ok) {
        const data = await res.json();
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
      const res = await fetch(`/api/assignments/${selectedAssignment.id}/submissions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId: activeStudentId, content: contentToSubmit }),
      });
      if (res.ok) {
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

  const activeRoleRef = useRef(activeRole);
  const activeStudentIdRef = useRef(activeStudentId);
  const langRef = useRef(lang);
  const studentsRef = useRef(students);
  const addToastRef = useRef(addToast);
  const activatingPluginsRef = useRef<Set<string>>(new Set());
  const togglingPluginsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    activeRoleRef.current = activeRole;
  }, [activeRole]);
  useEffect(() => {
    activeStudentIdRef.current = activeStudentId;
  }, [activeStudentId]);
  useEffect(() => {
    langRef.current = lang;
  }, [lang]);
  useEffect(() => {
    studentsRef.current = students;
  }, [students]);
  useEffect(() => {
    addToastRef.current = addToast;
  }, [addToast]);

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
        await fetch(`/api/students/${activeStudentId}/progress`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            lessonId: selectedLesson,
            completed: progressVal === 100,
            progressPercent: progressVal,
          }),
        });
      } catch (e) {
        console.error('Failed to update student progress:', e);
      }
    }
  };

  const fetchLiveClassStudentProgress = async (classId: string, lessonId: string) => {
    try {
      const res = await fetch(`/api/classes/${classId}/lessons/${lessonId}/progress`);
      if (res.ok) {
        setLiveClassStudentProgress(await res.json());
      }
    } catch (e) {}
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
      const res = await fetch(`/api/students/${id}/progress`);
      if (res.ok) {
        const data = await res.json();
        setStudentProgressMap((prev) => ({ ...prev, [id]: data }));
      }
    } catch (e) {}
  };

  const fetchProcessLogs = async (id: string) => {
    try {
      const res = await fetch(`/api/processes/${id}/logs`);
      if (res.ok) {
        const data = await res.json();
        setProcessLogsContent(data.logs || '');
        setShowProcessLogs(id);
      }
    } catch (e) {}
  };

  const lastElementsJsonRef = useRef<string>('');
  const fetchElements = async (lessonId: string) => {
    try {
      const res = await fetch(`/api/lessons/${lessonId}/whiteboard`);
      if (!res.ok) return;
      const data = await res.json();
      const jsonStr = JSON.stringify(data);
      if (jsonStr !== lastElementsJsonRef.current) {
        lastElementsJsonRef.current = jsonStr;
        setElements(data);
      }
    } catch {
      // ignore
    }
  };

  const selectedLessonRef = useRef<string | null>(null);
  const lastSelectedLessonRef = useRef<string | null>(null);
  const selectedAssignmentRef = useRef<any | null>(null);

  useEffect(() => {
    selectedLessonRef.current = selectedLesson;
  }, [selectedLesson]);

  useEffect(() => {
    selectedAssignmentRef.current = selectedAssignment;
  }, [selectedAssignment]);

  useLmsBridge(session);

  const {
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
  });

  const downloadCSVTemplate = (type: 'class' | 'student') => {
    downloadCSVTemplateService(type, lang);
  };

  const handleImportFile = async (file: File) => {
    setIsImporting(true);
    setImportError(null);
    setImportSuccess(null);
    try {
      const res = await parseAndImportClassesOrStudents(file, {
        lang,
        fetchClasses,
        fetchStudents,
      });
      setImportSuccess(res.message);
    } catch (err: any) {
      setImportError(err.message || String(err));
    } finally {
      setIsImporting(false);
    }
  };

  const toggleLanguage = () => {
    setLang(lang === 'zh' ? 'en' : 'zh');
  };

  const handleLoginSuccess = useCallback((newSession: any) => {
    setSession(newSession);
    if (newSession.role === 'teacher') {
      setActiveRole('teacher');
      setTeacherTab('dashboard');
    } else {
      setActiveRole('student');
      setActiveStudentId(newSession.studentId);
      fetchStudents();
    }
  }, []);

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
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
          if (
            !activeStudentId ||
            activeStudentId === msg.payload.studentId ||
            liveStudentParam === msg.payload.studentId
          ) {
            setPickedAlertData(msg.payload);
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

  return (
    <>
      <div className="flex h-screen bg-app text-main font-sans transition-colors duration-150">
        {/* Main Content Area: App Shell representing the Plugin Views */}
        <div className="flex-1 flex flex-col bg-app h-full overflow-hidden">
          {/* 全局模拟学生提示条 (Top Impersonation Banner) */}
          {session?.role === 'teacher' && activeRole === 'student' && !isStudentLiveMode && (
            <div className="bg-gradient-to-r from-amber-500 via-amber-600 to-orange-500 text-white px-6 py-1.5 flex items-center justify-between text-xs font-medium shadow-sm z-30 shrink-0 border-b border-amber-600/30">
              <div className="flex items-center gap-2.5">
                <span className="bg-black/20 text-amber-100 px-2 py-0.5 rounded font-bold uppercase tracking-wider text-xs flex items-center gap-1">
                  <Eye size={12} />
                  {lang === 'zh' ? '学生模拟模式' : 'Student View Mode'}
                </span>
                <span>
                  {lang === 'zh'
                    ? `您当前正在以学生身份（${students.find((s) => s.id === activeStudentId)?.name || '未选择'}）预览系统界面与交互。`
                    : `You are currently previewing the platform as student (${students.find((s) => s.id === activeStudentId)?.name || 'None'}).`}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setActiveRole('teacher')}
                className="bg-white text-amber-800 hover:bg-amber-50 active:bg-amber-100 font-bold px-3 py-1 rounded-md shadow-xs transition-all flex items-center gap-1.5 cursor-pointer text-xs"
              >
                <LogOut size={13} />
                {lang === 'zh' ? '退出模拟并返回教师端' : 'Exit Student View'}
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
            setIsLessonPreviewVisible={setIsLessonPreviewVisible}
            setPreviewLessonTab={setPreviewLessonTab}
            setPreviewSelectedCourseware={setPreviewSelectedCourseware}
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
          isLessonPreviewVisible={isLessonPreviewVisible}
          setIsLessonPreviewVisible={setIsLessonPreviewVisible}
          selectedLesson={selectedLesson}
          previewFullscreenPanel={previewFullscreenPanel}
          setPreviewFullscreenPanel={setPreviewFullscreenPanel}
          previewLessonTab={previewLessonTab}
          setPreviewLessonTab={setPreviewLessonTab}
          activeRole={activeRole}
          elements={elements}
          activeSegmentId={activeSegmentId}
          setActiveSegmentId={setActiveSegmentId}
          fetchElements={fetchElements}
          currentVfsParent={currentVfsParent}
          setCurrentVfsParent={setCurrentVfsParent}
          vfsNodes={vfsNodes}
          previewSelectedCourseware={previewSelectedCourseware}
          setPreviewSelectedCourseware={setPreviewSelectedCourseware}
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

        {/* 课堂随机提问/点名互动应答模态框 (Student Picked Alert Modal) */}
        {pickedAlertData && (
          <div className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-surface border-2 border-amber-500 rounded-2xl shadow-2xl p-6 max-w-md w-full text-center space-y-4 animate-in zoom-in-95 duration-300">
              <div className="w-16 h-16 bg-amber-500/20 text-amber-500 rounded-full flex items-center justify-center mx-auto animate-bounce">
                <Sparkles size={36} />
              </div>
              <h3 className="text-xl font-black text-main">
                {lang === 'zh' ? '⚡️ 闪电点名：老师选中了你！' : '⚡️ Classroom Pick: Teacher Selected You!'}
              </h3>
              <p className="text-sm text-muted">
                {lang === 'zh' ? (
                  <>
                    老师在课堂点名中抽中了【
                    <span className="font-bold text-amber-600 dark:text-amber-400">{pickedAlertData.studentName}</span>
                    】，请立即集中注意力参与课堂互动回答！
                  </>
                ) : (
                  <>
                    The teacher selected{' '}
                    <span className="font-bold text-amber-600 dark:text-amber-400">{pickedAlertData.studentName}</span>{' '}
                    to answer in class. Please respond now!
                  </>
                )}
              </p>
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => {
                    const channel = new ClassroomSyncChannel();
                    channel.acknowledgePick(pickedAlertData.studentId);
                    channel.destroy();
                    setPickedAlertData(null);
                    addToast(
                      lang === 'zh' ? '🙋‍♂️ 已确认答到' : '🙋‍♂️ Acknowledged',
                      lang === 'zh' ? '已向老师中控台发送举手答到信号！' : 'Sent acknowledge signal to teacher!',
                      'success',
                    );
                  }}
                  className="w-full py-3 bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white font-black text-sm rounded-xl shadow-lg shadow-amber-500/30 transition-all active:scale-95 cursor-pointer flex items-center justify-center gap-2"
                >
                  <CheckCircle2 size={18} />
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
    </>
  );
}
