import React, { useState, useEffect, useRef, useCallback } from 'react';
import { parseCSV } from '../utils/pluginParsers.js';
import {
  fetchDbStatus,
  fetchAuthSession,
} from '../services/sessionService.js';
import { getStudentReadNotifications, postStudentProgress, getClassLessonProgress, getStudentProgress } from '../services/progressService.js';
import { postAssignmentSubmission } from '../services/assignmentService.js';
import { getClassStudents } from '../services/rosterService.js';
import { useClassroomLive } from './useClassroomLive';
import { AppDataProvider, type AppDataValue } from '../context/AppDataContext';
import { useSessionBootstrap } from './useSessionBootstrap';
import { useStudentViewState } from './useStudentViewState';
import { useStudentOps } from './useStudentOps';
import { useLessonCrud } from './useLessonCrud';
import { useClassOps } from './useClassOps';
import { useToast } from './useToast';
import { useSystemData } from './useSystemData';
import { useResourceLibrary } from './useResourceLibrary';
import { getClassProgress, getClassDashboard, getStudentDashboard } from '../services/dashboardService.js';
import {
  postLesson,
  deleteLesson,
  postCloneLesson,
  getLessonWhiteboard,
} from '../services/lessonService.js';
import { translations } from '../i18n';
import { ClassroomSyncChannel } from '../services/classroom-sync-channel';
import { whiteboardViewStore } from '../store/whiteboardViewStore';
import { PALETTE_ITEM_MAP, getPaletteItemConfig } from '../features/teacher/lesson-editor/paletteConfig';
import type { ClassTabKey } from '../features/teacher/classes/ClassTabs';
import { generateTemplateContent } from '../features/teacher/HelpView';

// ── Hash-based routing helpers ────────────────────────────────────────────
function tabToHash(tab: string): string {
  return '#/' + tab;
}
function hashToTab(hash: string): string | null {
  const raw = hash.replace(/^#/, '');
  if (!raw || raw === '/') return null;
  return raw.replace(/^\//, '');
}

import { usePluginHost } from '../plugin-host/plugin-host-context';
import { usePluginHostStore } from '../plugin-host/plugin-host-store';
import { registerTeacherActivityCenter } from '../features/activity-ecosystem/registerTeacherExtension.js';

registerTeacherActivityCenter();
import { PluginState } from '../plugin-host/types';
import { useAppStore, appStore } from '../store/appStore';
import { useThemeStore } from '../store/themeStore';
import { useFontSizeStore } from '../store/fontSizeStore';
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
} from '../store/appStore';
import { useLmsBridge } from '../services/lms-bridge';
import { useAppPolling } from './useAppPolling';
import { useAgentChat } from './useAgentChat';
import { useClassroomSocket } from './useClassroomSocket';
import { usePluginManagement } from './usePluginManagement';
import { useCourseWizard } from './useCourseWizard';
import { useQuizGenerator } from './useQuizGenerator';
import { useClassBatchOperations } from './useClassBatchOperations';
import { useLabAndSchedule } from './useLabAndSchedule';
import { useLessonTimeline } from './useLessonTimeline';
import { useStudentNotifications } from './useStudentNotifications';
import { useGradeExport } from './useGradeExport';
import { useLessonFiltering } from './useLessonFiltering';
import { useGlobalErrorCapture } from './useGlobalErrorCapture';

const AGENT_PROVIDER_STORAGE_KEY = 'openlearnv2.agentProviderId';


export function useAppComposer() {

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
  const liveClassSelectedClassId = useAppStore((s) => s.liveClassSelectedClassId);
  const setLiveClassSelectedClassId = useAppStore((s) => s.setLiveClassSelectedClassId);
  const liveClassIsActive = useAppStore((s) => s.liveClassIsActive);
  const setLiveClassIsActive = useAppStore((s) => s.setLiveClassIsActive);

  const host = usePluginHost();
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
  const lessonFilteringData = useLessonFiltering(lessons);
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
  } = lessonFilteringData;
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
  const labAndScheduleData = useLabAndSchedule();
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
  } = labAndScheduleData;

  // ── C1-R2c: 课程/班级 hooks ──────────────────────────────────────────────
  const { addToast } = useToast();
  const lessonCrudData = useLessonCrud({ lang, addToast, setCopyingLessonId });
  const {
    fetchLessons,
    handleQuickCreateLesson,
    handleDeleteCourse,
    handleCopyCourse,
    fetchElements,
  } = lessonCrudData;
  const classOpsData = useClassOps({ fetchClassSchedules });
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
  } = classOpsData;

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
  const [sessionLoading, setSessionLoading] = useState(true);

  // ── C1-R2e: 会话引导 hook（session 恢复 effect 仍留在 App，因其依赖 student 视图收口）──
  const fetchStudents = async () => {
    await appStore.getState().loadStudents();
  };
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

  // ── C1-R2f: 实时课堂互动横幅/动态流/在线名册 ─────────────────────────────
  const classroomLiveData = useClassroomLive();
  const {
    pickedAlertData,
    setPickedAlertData,
    pickedAnnouncement,
    setPickedAnnouncement,
    liveClassTimeRemaining,
    setLiveClassTimeRemaining,
    liveClassFeed,
    setLiveClassFeed,
    liveClassAcknowledgedMap,
    setLiveClassAcknowledgedMap,
    onlineStudentIds,
    setOnlineStudentIds,
    activeStudentLessons,
    setActiveStudentLessons,
  } = classroomLiveData;
  const siteInfo = useAppStore((s) => s.siteInfo);
  const setSiteInfo = useAppStore((s) => s.setSiteInfo);


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
  const lessonTimelineData = useLessonTimeline({
    selectedLesson,
    lessons,
    setLessons,
  });
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
  } = lessonTimelineData;

  const [liveClassFocusLocked, setLiveClassFocusLocked] = useState(false);
  // 锁定期间强制跟随教师步调；具体在 studentViewStatus 声明处统一生效

  const fetchClasses = async () => {
    await appStore.getState().loadClasses();
  };

  // ── C1-R2b: 叶子 hooks（系统数据 / 资源库与导入） ─────────────────────────
  const systemData = useSystemData(session);
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
  } = systemData;
  const resourceLibraryData = useResourceLibrary({ lang, session, fetchClasses, fetchStudents, fetchLessons, addToast });
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
  } = resourceLibraryData;

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
  const pluginManagementData = usePluginManagement({
    session,
    host,
    lang,
    addToast,
    setChatLog: (updater: any) => chatLogUpdaterRef.current(updater),
    setTeacherTab,
    fetchLessons,
  });
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
  } = pluginManagementData;

  const [agentProviderId, setAgentProviderId] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    return window.localStorage.getItem(AGENT_PROVIDER_STORAGE_KEY) || '';
  });
  const effectiveAgentProviderId = aiProviders.some((provider) => provider.id === agentProviderId)
    ? agentProviderId
    : aiProviders[0]?.id || '';
  const selectedAgentProvider = aiProviders.find((provider) => provider.id === effectiveAgentProviderId) || null;

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

  // ── C1-R2d: 学生域 hooks ─────────────────────────────────────────────────
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
  const studentOpsData = useStudentOps({
    activeStudentId,
    activeRole,
    selectedLesson,
    students,
    quizStudentAnswersRef,
    setStudentViewStatus,
  });
  const {
    studentDashboardData,
    setStudentDashboardData,
    studentProgressMap,
    setStudentProgressMap,
    selectedAssignment,
    setSelectedAssignment,
    fetchStudentDashboard,
    fetchStudentProgress,
    updateStudentProgress,
    submitQuizAssignment,
  } = studentOpsData;

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

  useLmsBridge(session);

  const agentChatData = useAgentChat({
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
  } = agentChatData;

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


  // ── C1-R3: AppData 组装（全部 hooks 返回值 + App 局部值） ─────────────────
  // value 为每渲染新对象：全库仅 LoginPage 使用 React.memo，各 tab 本就随 App
  // 渲染而重渲染，context 传递不劣于现状；未来引入 memo 时再按领域拆分 context。
  const appData: AppDataValue = {
    addToast,
    ...systemData,
    ...resourceLibraryData,
    ...lessonCrudData,
    ...classOpsData,
    ...studentViewStateData,
    ...studentOpsData,
    ...sessionBootstrapData,
    ...classroomLiveData,
    ...labAndScheduleData,
    ...pluginManagementData,
    ...agentChatData,
    ...quizGenerator,
    ...courseWizard,
    ...classBatch,
    ...lessonTimelineData,
    ...studentNotificationsHook,
    ...gradeExport,
    ...lessonFilteringData,
    mainNavCollapsed,
    setMainNavCollapsed,
    batchMode,
    setBatchMode,
    selectedClassIds,
    setSelectedClassIds,
    setSelectedStudentIds,
    expandedClassId,
    setExpandedClassId,
    exportTooltipOpen,
    setExportTooltipOpen,
    exportDropdownOpen,
    setExportDropdownOpen,
    expandedStudentId,
    setExpandedStudentId,
    selectedStudentIds,
    rosterViewMode,
    setRosterViewMode,
    rosterSearchQuery,
    setRosterSearchQuery,
    rosterTagFilter,
    setRosterTagFilter,
    classSubmissionFilters,
    setClassSubmissionFilters,
    classActiveTabs,
    setClassActiveTabs,
    assignmentSortOrder,
    setAssignmentSortOrder,
    isGeneratingAssignment,
    isGrading,
    setIsGrading,
    setStudents,
    setImportError,
    setImportSuccess,
    setShowImportModal,
    studentActiveTabs,
    setStudentActiveTabs,
    fetchStudents,
    onLogout: handleLogout,
    onAIProvidersChanged: fetchAIProviders,
    onDeleteCourse: handleDeleteCourse,
    onCopyCourse: handleCopyCourse,
    socketRef,
    liveClassSelectedClassId,
    setLiveClassSelectedClassId,
    liveClassIsActive,
    setLiveClassIsActive,
    setSelectedLesson,
    setTeacherTab,
    teacherTab,
    onViewCourse: (lessonId: string) => {
      setTeacherTab('lesson_editor');
      setSelectedLesson(lessonId);
    },
    t,
    readNotifications,
    setReadNotifications,
    localProgressPercent,
    setLocalProgressPercent,
    lessons,
    selectedLesson,
    elements,
    classes,
    students,
    isApprovalsCollapsed,
    setIsApprovalsCollapsed,
    isProcessesCollapsed,
    setIsProcessesCollapsed,
    whiteboardRef,
    paletteEdit,
    handlePaletteActivate,
    handlePaletteConfirm,
    setPaletteEdit,
    session,
    showRightSidebar,
    setShowRightSidebar,
    rightSidebarTab,
    setRightSidebarTab,
    agentProviderId,
    setAgentProviderId,
    effectiveAgentProviderId,
    selectedAgentProvider,
    isTourOpen,
    setIsTourOpen,
    handleSeedSuccess,
    generateTemplateContent,
    activeRole,
    setActiveRole,
    isStudentPreviewMode,
    isNotificationsOpen,
    setIsNotificationsOpen,
    selectedNotificationForModal,
    setSelectedNotificationForModal,
    setProfileOpen,
    notifyLockedNavigation,
    handleLogout,
    toggleLanguage,
    setIsSystemResourceLibraryOpen,
    siteInfo,
    isStudentLiveMode,
    liveStudentParam,
    isFollowingTeacher,
    setIsFollowingTeacher,
  };


  return {
    appData,
    sessionLoading,
    session,
    setSession,
    handleLoginSuccess,
    handleLogout,
    isStageDisplayMode,
    stageLessonParam,
    stageTitleParam,
    stageLangParam,
    activeRole,
    selectedLesson,
    lessons,
    profileOpen,
    setProfileOpen,
    lang,
  };
}
