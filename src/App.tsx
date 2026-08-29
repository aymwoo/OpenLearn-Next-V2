import { Loader2 } from 'lucide-react';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { parseCSV } from './utils/pluginParsers.js';
import { translations } from './i18n';
import { LoginPage } from './components/LoginPage';
import { AppHeader } from './components/AppHeader';
import { ProfileModal } from './components/ProfileModal';
import { PALETTE_ITEM_MAP } from './features/teacher/lesson-editor/paletteConfig';
import { generateTemplateContent } from './features/teacher/HelpView';

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
import type {
  AIProvider, PluginType, VFSNode, ProcessType,
  ClassType, StudentType, AssignmentType, SubmissionType,
  ScheduleType, AttendanceType, StudentProgressType,
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
import {
  downloadCSVTemplate as downloadCSVTemplateService,
  parseAndImportClassesOrStudents,
  parseLessonCSV,
  submitCSVLessons,
} from './services/bulkImportService';
import {
  generateClassPDFReport,
  exportClassGradesCSV,
  exportAllClassesCombinedCSV,
  computeCsvPreviewData,
} from './services/gradeReportService';

const AGENT_PROVIDER_STORAGE_KEY = 'openlearnv2.agentProviderId';

export default function App() {
  const lang = useAppStore((s) => s.lang);
 const setLang = useAppStore((s) => s.setLang);
  const t = translations[lang] ?? translations['zh'];

 const [mainNavCollapsed, setMainNavCollapsed] = useState(false);
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
  const [cloudDrivePreviewNode, setCloudDrivePreviewNode] = useState<{ id: string, name: string, content: string } | null>(null);

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
    if (isSystemResourceLibraryOpen) {
      fetchLibraryResources();
    }
  }, [isSystemResourceLibraryOpen]);


  const lessons = useAppStore((s) => s.lessons);
  const setLessons = useAppStore((s) => s.setLessons);
  const [lessonsSearchQuery, setLessonsSearchQuery] = useState('');
  const [lessonsSortOrder, setLessonsSortOrder] = useState<'recent' | 'alphabetical' | 'enrollment'>('recent');
  const [filterEnrollment, setFilterEnrollment] = useState(false);
  const [filterHasContent, setFilterHasContent] = useState(false);
  const [filterThisMonth, setFilterThisMonth] = useState(false);
  const [copyingLessonId, setCopyingLessonId] = useState<string | null>(null);

  const filteredAndSortedLessons = React.useMemo(() => {
    let result = [...lessons];
    if (lessonsSearchQuery.trim()) {
      const q = lessonsSearchQuery.toLowerCase();
      result = result.filter(lesson => 
        lesson.title.toLowerCase().includes(q) || 
        lesson.content.toLowerCase().includes(q)
      );
    }
    
    if (filterEnrollment) {
      result = result.filter(lesson => (lesson.enrollment_count || 0) > 0);
    }
    if (filterHasContent) {
      result = result.filter(lesson => lesson.content && lesson.content.trim().length > 0);
    }
    if (filterThisMonth) {
      const now = Date.now();
      const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
      result = result.filter(lesson => (lesson.created_at || 0) >= monthStart);
    }
    
    if (lessonsSortOrder === 'recent') {
      result.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    } else if (lessonsSortOrder === 'alphabetical') {
      result.sort((a, b) => a.title.localeCompare(b.title));
    } else if (lessonsSortOrder === 'enrollment') {
      result.sort((a, b) => (b.enrollment_count || 0) - (a.enrollment_count || 0));
    }
    
    return result;
  }, [lessons, lessonsSearchQuery, lessonsSortOrder, filterEnrollment, filterHasContent, filterThisMonth]);
  const [registeredCommands, setRegisteredCommands] = useState<any[]>([]);
  const selectedLesson = useAppStore((s) => s.selectedLesson);
  const setSelectedLesson = useAppStore((s) => s.setSelectedLesson);
  const elements = useAppStore((s) => s.elements);
  const setElements = useAppStore((s) => s.setElements);

  // ── Hook: 课程创建向导 (Course Wizard) ──
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
  } = useCourseWizard({
    lang,
    addToast,
    fetchLessons,
    setSelectedLesson,
    setTeacherTab,
  });

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
    host,
    lang,
    addToast,
    setChatLog: (updater: any) => setChatLog(updater),
    setTeacherTab,
    fetchLessons,
  });

  // Import Lessons states
  const [isImportLessonsOpen, setIsImportLessonsOpen] = useState(false);
  const [importStatus, setImportStatus] = useState<'idle' | 'parsing' | 'importing' | 'success' | 'error'>('idle');
  const [importProgress, setImportProgress] = useState(0);
  const [importProgressTotal, setImportProgressTotal] = useState(0);
  const [importErrorMsg, setImportErrorMsg] = useState('');
  const [previewImportData, setPreviewImportData] = useState<{ title: string; content: string }[]>([]);
  const [isDraggingImport, setIsDraggingImport] = useState(false);
  
  // Lesson Editor persistence tracking states
  const [editorSaveStatus, setEditorSaveStatus] = useState<'none' | 'saving' | 'saved' | 'error'>('none');
  const [editorLastSavedTime, setEditorLastSavedTime] = useState<Date | null>(null);
  const [editorPanelsExpanded, setEditorPanelsExpanded] = useState(true);
  
  const [showRightSidebar, setShowRightSidebar] = useState(false);
  const [rightSidebarTab, setRightSidebarTab] = useState<'agent' | 'shell'>('agent');
  const [agentProviderId, setAgentProviderId] = useState<string>(() => {
    if (typeof window === 'undefined') return 'system';
    return window.localStorage.getItem(AGENT_PROVIDER_STORAGE_KEY) || 'system';
  });
  const effectiveAgentProviderId =
    agentProviderId === 'system' || aiProviders.some(provider => provider.id === agentProviderId)
      ? agentProviderId
      : 'system';
  const selectedAgentProvider = aiProviders.find(provider => provider.id === effectiveAgentProviderId) || null;
  const [showLogs, setShowLogs] = useState(false);
  const [vfsNodes, setVfsNodes] = useState<VFSNode[]>([]);
  const [processes, setProcesses] = useState<ProcessType[]>([]);
  const [showProcessLogs, setShowProcessLogs] = useState<string | null>(null);
  const [processLogsContent, setProcessLogsContent] = useState('');
  const classes = useAppStore((s) => s.classes);
  const setClasses = useAppStore((s) => s.setClasses);
  const [todaySchedules, setTodaySchedules] = useState<any[]>([]);
  const students = useAppStore((s) => s.students);
  const setStudents = useAppStore((s) => s.setStudents);
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
    const cfg = PALETTE_ITEM_MAP[type];
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
            setActiveRole(data.session.role);
            if (data.session.role === 'student' && data.session.studentId) {
              setActiveStudentId(data.session.studentId);
              fetchStudents();
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

  const teacherTab = useAppStore(state => state.teacherTab);
  const setTeacherTab = useAppStore(state => state.setTeacherTab);

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
      'success'
    );
  };

  // Automatically collapse system navigation when entering interactive classroom
  useEffect(() => {
    if (teacherTab === 'live_class') {
      setMainNavCollapsed(true);
    }
  }, [teacherTab]);
  const [timelineSegments, setTimelineSegments] = useState<any[]>([
    { id: 'seg-1', title: '开场准备', type: 'intro', duration: '5m', color: 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100' },
    { id: 'seg-2', title: '讲授新课', type: 'lecture', duration: '20m', color: 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100' },
    { id: 'seg-3', title: '互动练习', type: 'practice', duration: '15m', color: 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100' },
    { id: 'seg-4', title: '课堂总结', type: 'summary', duration: '5m', color: 'bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100' }
  ]);
  const [draggedSegmentIdx, setDraggedSegmentIdx] = useState<number | null>(null);
  const [activeSegmentId, setActiveSegmentId] = useState<string | null>('seg-1');
  const [segmentToEdit, setSegmentToEdit] = useState<any | null>(null);
  const [activeStudentId, setActiveStudentId] = useState<string | null>(null);
  const [studentDashboardData, setStudentDashboardData] = useState<any>(null);
  const addToast = (title: string, message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info') => {
    const id = Math.random().toString(36).substring(2, 9);
    appStore.getState().addToast({ id, title, message, type });
    setTimeout(() => {
      appStore.getState().removeToast(id);
    }, 6000);
  };
  const [studentViewStatus, setStudentViewStatus] = useState<'dashboard' | 'lesson' | 'assignment'>('dashboard');
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
  } = useQuizGenerator();

  // Grade Export Weightings state variables
  const [isExportWeightModalOpen, setIsExportWeightModalOpen] = useState(false);
  const [exportClassId, setExportClassId] = useState<string>('');
  const [exportClassName, setExportClassName] = useState<string>('');
  const [quizzesWeight, setQuizzesWeight] = useState<number>(40);
  const [assignmentsWeight, setAssignmentsWeight] = useState<number>(60);
  const [customCategoryOverrides, setCustomCategoryOverrides] = useState<Record<string, 'quiz' | 'assignment'>>({});
  const [exportDropdownOpen, setExportDropdownOpen] = useState(false);
  const [exportTooltipOpen, setExportTooltipOpen] = useState(false);
  const [loadingExportClassId, setLoadingExportClassId] = useState<string | null>(null);
  const [isExportingAllCombined, setIsExportingAllCombined] = useState(false);
  const [rosterSearchQuery, setRosterSearchQuery] = useState('');
  const [rosterTagFilter, setRosterTagFilter] = useState<'all' | 'Academic' | 'Behavioral' | 'General' | 'SpecialCare'>('all');
  const [rosterViewMode, setRosterViewMode] = useState<'grid' | 'list'>('grid');
  const [classSubmissionFilters, setClassSubmissionFilters] = useState<Record<string, 'all' | 'submitted' | 'graded' | 'pending'>>({});
  const [classActiveTabs, setClassActiveTabs] = useState<Record<string, 'students' | 'assignments' | 'schedules' | 'seating' | 'grades'>>({});
  const [studentActiveTabs, setStudentActiveTabs] = useState<Record<string, 'progress' | 'settings' | 'notes'>>({});

  // Computer labs and seating admin structures
  const [computerLabs, setComputerLabs] = useState<any[]>([]);
  const [loadingLabs, setLoadingLabs] = useState(false);
  const [classSeats, setClassSeats] = useState<{ lab_id: string | null; seats: any[] }>({ lab_id: null, seats: [] });
  const [savingSeats, setSavingSeats] = useState(false);

  const triggerExportForClass = async (classId: string, className: string) => {
    setLoadingExportClassId(classId);
    try {
      await fetchClassStudents(classId);
      await fetchClassDashboard(classId);
      await fetchClassProgress(classId);
      
      setExportClassId(classId);
      setExportClassName(className);
      setQuizzesWeight(40);
      setAssignmentsWeight(60);
      setCustomCategoryOverrides({});
      setIsExportWeightModalOpen(true);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingExportClassId(null);
      setExportDropdownOpen(false);
    }
  };

  const handleGeneratePDFReport = async (classId: string, className: string) => {
    await fetchClassStudents(classId);
    await fetchClassDashboard(classId);
    await fetchClassProgress(classId);
    await generateClassPDFReport({
      classId,
      className,
      students: classStudentsMap[classId] || [],
      dashData: classDashboardMap[classId],
      lang,
      addToast,
      setIsGeneratingPDFReport,
    });
  };

  const handleExportAllClassesCombined = async (targetClasses?: any[]) => {
    const exportList = targetClasses && targetClasses.length > 0 ? targetClasses : classes;
    if (exportList.length === 0) return;
    setIsExportingAllCombined(true);
    try {
      await Promise.all(
        exportList.map(async (cls) => {
          await fetchClassStudents(cls.id);
          await fetchClassDashboard(cls.id);
        })
      );
      exportAllClassesCombinedCSV({
        classes: exportList,
        classStudentsMap,
        classDashboardMap,
        lang,
      });
    } catch (e) {
      console.error(e);
    } finally {
      setIsExportingAllCombined(false);
      setExportDropdownOpen(false);
    }
  };

  const handleQuizzesWeightChange = (val: number) => {
    const qWeight = Math.min(100, Math.max(0, val));
    setQuizzesWeight(qWeight);
    setAssignmentsWeight(100 - qWeight);
  };

  const handleAssignmentsWeightChange = (val: number) => {
    const aWeight = Math.min(100, Math.max(0, val));
    setAssignmentsWeight(aWeight);
    setQuizzesWeight(100 - aWeight);
  };

  const [readNotifications, setReadNotifications] = useState<Set<string>>(new Set());
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [selectedNotificationForModal, setSelectedNotificationForModal] = useState<any | null>(null);

  useEffect(() => {
    if (activeStudentId) {
      fetch(`/api/students/${activeStudentId}/read_notifications`)
        .then(res => res.ok ? res.json() : [])
        .then(data => {
          setReadNotifications(new Set(data));
        })
        .catch(err => {
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
  const [classProgressMap, setClassProgressMap] = useState<Record<string, { lesson_id: string, lesson_title: string, average_progress: number }[]>>({});
  const [classAssignmentsMap, setClassAssignmentsMap] = useState<Record<string, AssignmentType[]>>({});
  const [assignmentSubmissionsMap, setAssignmentSubmissionsMap] = useState<Record<string, SubmissionType[]>>({});
  const [isGeneratingAssignment, setIsGeneratingAssignment] = useState<string | null>(null);
  const [isGeneratingPDFReport, setIsGeneratingPDFReport] = useState<Record<string, boolean>>({});
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
    if (agentProviderId !== 'system' && aiProviders.length > 0 && !aiProviders.some(provider => provider.id === agentProviderId)) {
      setAgentProviderId('system');
    }
  }, [aiProviders, agentProviderId]);

  const handleQuickScheduleClass = async (classId: string, lessonId: string, date: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/classes/${classId}/schedules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lessonId, scheduledDate: date })
      });
      if (res.ok) {
        await fetchClassSchedules(classId);
        return true;
      }
    } catch (e) {
      console.error("Quick schedule class failed", e);
    }
    return false;
  };

  const handleQuickGenerateAssignment = async (classId: string, topic: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/classes/${classId}/assignments/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic })
      });
      if (res.ok) {
        await fetchClassDashboard(classId);
        return true;
      }
    } catch (e) {
      console.error("Quick generate assignment failed", e);
    }
    return false;
  };

  const handleQuickCreateLesson = async (title: string, content: string): Promise<boolean> => {
    try {
      const res = await fetch('/api/lessons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content })
      });
      if (res.ok) {
        await fetchLessons();
        return true;
      }
    } catch (e) {
      console.error("Quick create lesson failed", e);
    }
    return false;
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
      console.warn("Failed to fetch lessons", e);
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
      'success'
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
        'success'
      );
    } catch (e: any) {
      addToast(
        lang === 'zh' ? '复制失败' : 'Copy Failed',
        e.message || (lang === 'zh' ? '复制课程时发生错误。' : 'An error occurred while copying the course.'),
        'error'
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
      console.warn("Failed to fetch registered commands", e);
    }
  };

  const fetchVfs = async (parentId: string | null) => {
    try {
      const res = await fetch(`/api/vfs${parentId ? `?parentId=${parentId}` : ''}`);
      if (res.ok) {
        const data = await res.json();
        setVfsNodes(data);
      }
    } catch (e) {
      console.warn("Failed to fetch VFS nodes", e);
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

  const fetchTodaySchedules = async () => {
    try {
      const todayStr = new Date().toISOString().split('T')[0];
      const res = await fetch(`/api/schedules/today?date=${todayStr}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.schedules) {
          setTodaySchedules(data.schedules);
        }
      }
    } catch (e) {
      console.warn("Failed to fetch today schedules", e);
    }
  };

  const fetchStudents = async () => {
    try {
      const res = await fetch('/api/students');
      if (res.ok) setStudents(await res.json());
    } catch (e) {}
  };

  const fetchLabs = async () => {
    try {
      setLoadingLabs(true);
      const res = await fetch('/api/labs');
      if (res.ok) setComputerLabs(await res.json());
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingLabs(false);
    }
  };

  const fetchClassSeats = async (classId: string) => {
    try {
      const res = await fetch(`/api/classes/${classId}/seats`);
      if (res.ok) {
        const data = await res.json();
        setClassSeats(data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchClassStudents = async (id: string) => {
    try {
      const res = await fetch(`/api/classes/${id}/students`);
      if (res.ok) {
        const data = await res.json();
        setClassStudentsMap(prev => ({ ...prev, [id]: data }));
      }
    } catch (e) {}
  };

  // ── Hook: 班级与学生批量管理操作 ──
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
  } = useClassBatchOperations({
    lang,
    classes,
    expandedClassId,
    fetchClasses,
    fetchClassStudents,
    handleExportAllClassesCombined,
  });

  const fetchClassProgress = async (id: string) => {
    try {
      const res = await fetch(`/api/classes/${id}/progress`);
      if (res.ok) {
        const data = await res.json();
        setClassProgressMap(prev => ({ ...prev, [id]: data }));
      }
    } catch (e) {}
  };

  const [classDashboardMap, setClassDashboardMap] = useState<Record<string, any>>({});
  const [classSchedulesMap, setClassSchedulesMap] = useState<Record<string, ScheduleType[]>>({});
  const [scheduleAttendanceMap, setScheduleAttendanceMap] = useState<Record<string, AttendanceType[]>>({});
  const [expandedScheduleId, setExpandedScheduleId] = useState<string | null>(null);
  const [newScheduleDate, setNewScheduleDate] = useState<string>('');
  const [newScheduleLessonId, setNewScheduleLessonId] = useState<string>('');

  const fetchClassDashboard = async (id: string) => {
    try {
      const res = await fetch(`/api/classes/${id}/dashboard`);
      if (res.ok) {
        const data = await res.json();
        setClassDashboardMap(prev => ({ ...prev, [id]: data }));
      }
    } catch (e) {}
  };

  const csvPreviewData = React.useMemo(() => {
    return computeCsvPreviewData({
      exportClassId,
      classStudentsMap,
      classDashboardMap,
      quizzesWeight,
      assignmentsWeight,
      customCategoryOverrides,
      lang,
    });
  }, [exportClassId, quizzesWeight, assignmentsWeight, customCategoryOverrides, classStudentsMap, classDashboardMap, lang]);

  const handleExportGrades = (
    classId: string, 
    className: string, 
    qWeight: number = 40, 
    aWeight: number = 60, 
    overrides: Record<string, 'quiz' | 'assignment'> = {}
  ) => {
    exportClassGradesCSV({
      className,
      students: classStudentsMap[classId] || [],
      dashData: classDashboardMap[classId],
      qWeight,
      aWeight,
      overrides,
    });
  };

  const get30DayAverageWarning = (studentId: string, classId: string) => {
    const dashData = classDashboardMap[classId];
    if (!dashData || !dashData.performance) return null;

    // 30 days in ms = 30 * 24 * 60 * 60 * 1000 = 2,592,000,000 ms
    const thirtyDaysAgo = Date.now() - 2592000000;
    const studentPerf = dashData.performance.filter((p: any) => p.student_id === studentId);
    
    // Filter graded submissions in the last 30 days
    const recentSubmissions = studentPerf.filter((p: any) => 
      p.submitted_at && 
      p.submitted_at >= thirtyDaysAgo && 
      p.score !== null && 
      p.score !== undefined
    );

    if (recentSubmissions.length === 0) return null;

    const scoreSum = recentSubmissions.reduce((sum: number, p: any) => sum + Number(p.score), 0);
    const avg = scoreSum / recentSubmissions.length;
    if (avg < 60) {
      return Math.round(avg);
    }
    return null;
  };

  const fetchAssignmentSubmissions = async (id: string) => {
    try {
      const res = await fetch(`/api/assignments/${id}/submissions`);
      if (res.ok) {
        const data = await res.json();
        setAssignmentSubmissionsMap(prev => ({ ...prev, [id]: data }));
      }
    } catch (e) {}
  };

  const fetchClassSchedules = async (id: string) => {
    try {
      const res = await fetch(`/api/classes/${id}/schedules`);
      if (res.ok) {
        const data = await res.json();
        setClassSchedulesMap(prev => ({ ...prev, [id]: data }));
      }
    } catch (e) {}
  };

  const fetchScheduleAttendance = async (id: string) => {
    try {
      const res = await fetch(`/api/schedules/${id}/attendance`);
      if (res.ok) {
        const data = await res.json();
        setScheduleAttendanceMap(prev => ({ ...prev, [id]: data }));
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
    const isMcq = selectedAssignment?.content && selectedAssignment.content.startsWith('{"quizType":"mcq_learning_objectives"');
    const contentToSubmit = isMcq ? JSON.stringify(quizStudentAnswersRef.current) : "Submitted via Whiteboard";
    
    try {
      const res = await fetch(`/api/assignments/${selectedAssignment.id}/submissions`, { 
        method: 'POST', 
        headers: {'Content-Type':'application/json'}, 
        body: JSON.stringify({ studentId: activeStudentId, content: contentToSubmit }) 
      });
      if (res.ok) {
        if (isTimeLimitExpired) {
          alert("Time is up! Your assessment was successfully submitted automatically.");
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
      const student = students.find(s => s.id === activeStudentId);
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

  useEffect(() => { activeRoleRef.current = activeRole; }, [activeRole]);
  useEffect(() => { activeStudentIdRef.current = activeStudentId; }, [activeStudentId]);
  useEffect(() => { langRef.current = lang; }, [lang]);
  useEffect(() => { studentsRef.current = students; }, [students]);
  useEffect(() => { addToastRef.current = addToast; }, [addToast]);

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
            progressPercent: progressVal
          })
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
        setStudentProgressMap(prev => ({ ...prev, [id]: data }));
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

  const fetchElements = async (lessonId: string) => {
    const res = await fetch(`/api/lessons/${lessonId}/whiteboard`);
    const data = await res.json();
    setElements(data);
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

  const saveTimeline = async (lessonId: string, newSegments: any[]) => {
    setEditorSaveStatus('saving');
    try {
      const res = await fetch(`/api/lessons/${lessonId}/timeline`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timeline: newSegments })
      });
      if (res.ok) {
        setLessons(prev => prev.map(l => l.id === lessonId ? { ...l, timeline: JSON.stringify(newSegments) } : l));
        setTimelineSegments(newSegments);
        setEditorSaveStatus('saved');
        setEditorLastSavedTime(new Date());
      } else {
        setEditorSaveStatus('error');
      }
    } catch (e) {
      console.error("Failed to save timeline:", e);
      setEditorSaveStatus('error');
    }
  };

  useEffect(() => {
    if (selectedLesson) {
      const lesson = lessons.find(l => l.id === selectedLesson);
      if (lesson) {
        let segments = [];
        if (lesson.timeline) {
          try {
            segments = typeof lesson.timeline === 'string' ? JSON.parse(lesson.timeline) : lesson.timeline;
          } catch (e) {
            segments = [
              { id: 'seg-1', title: '开场准备', type: 'intro', duration: '5m', color: 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100' },
              { id: 'seg-2', title: '讲授新课', type: 'lecture', duration: '20m', color: 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100' },
              { id: 'seg-3', title: '互动练习', type: 'practice', duration: '15m', color: 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100' },
              { id: 'seg-4', title: '课堂总结', type: 'summary', duration: '5m', color: 'bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100' }
            ];
          }
        } else {
          segments = [
            { id: 'seg-1', title: '开场准备', type: 'intro', duration: '5m', color: 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100' },
            { id: 'seg-2', title: '讲授新课', type: 'lecture', duration: '20m', color: 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100' },
            { id: 'seg-3', title: '互动练习', type: 'practice', duration: '15m', color: 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100' },
            { id: 'seg-4', title: '课堂总结', type: 'summary', duration: '5m', color: 'bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100' }
          ];
        }
        setTimelineSegments(segments);

        const isNewLesson = lastSelectedLessonRef.current !== selectedLesson;
        lastSelectedLessonRef.current = selectedLesson;

        if (segments.length > 0) {
          if (isNewLesson || !segments.some(s => s.id === activeSegmentId)) {
            setActiveSegmentId(segments[0].id);
          }
        } else {
          setActiveSegmentId(null);
        }
      }
    }
  }, [selectedLesson, lessons]);

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
    setLocalProgressPercent,
    fetchStudentDashboard,
    fetchStudents,
    fetchElements,
  });

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

  const studentNotifications = React.useMemo(() => {
    if (activeRole !== 'student' || !studentDashboardData) return [];
    const notifs = [];
    const assignments = studentDashboardData.assignments || [];
    for (const a of assignments) {
      if (!a.submission_status) {
        notifs.push({ 
          id: `new-${a.id}`, 
          type: 'new_assignment', 
          title: lang === 'zh' ? '新发布作业' : 'New Assignment', 
          message: lang === 'zh' ? `您有一项新作业："${a.title}"` : `You have a new assignment: ${a.title}`, 
          date: a.created_at, 
          relatedId: a.id 
        });
      } else if (a.submission_status === 'graded') {
        const hasFeedback = !!a.feedback;
        notifs.push({ 
          id: `graded-${a.id}`, 
          type: 'graded', 
          title: hasFeedback ? (lang === 'zh' ? '收到新成绩与反馈' : 'Grade & Feedback Posted') : (lang === 'zh' ? '新成绩发布' : 'Assignment Graded'), 
          message: hasFeedback
            ? (lang === 'zh' ? `您的作业"${a.title}"已评分，得分：${a.score}%。反馈："${a.feedback}"` : `Your assignment "${a.title}" was graded. Score: ${a.score}%. Teacher feedback: "${a.feedback}"`)
            : (lang === 'zh' ? `您的作业"${a.title}"已评分，得分：${a.score}%` : `Your assignment "${a.title}" was graded. Score: ${a.score}%`), 
          date: a.submitted_at || a.created_at, 
          relatedId: a.id 
        });
      }
    }
    
    const rollcalls = studentDashboardData.rollcalls || [];
    for (const r of rollcalls) {
      notifs.push({
        id: r.id,
        type: 'rollcall_picked',
        title: lang === 'zh' ? '⚡️ 随机提问选中通知' : '⚡️ Random Pick Notification',
        message: lang === 'zh'
          ? `您已被老师在课程"${r.lesson_title || '课堂'}"中随机选中提问！请立即确认您的出勤与注意。`
          : `You have been randomly picked by the teacher in lesson "${r.lesson_title || 'Class'}"! Please pay immediate attention.`,
        date: r.picked_time,
        relatedId: r.lesson_id
      });
    }
    
    return notifs.sort((a, b) => b.date - a.date);
  }, [activeRole, studentDashboardData, lang]);

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

  const unreadNotifications = studentNotifications.filter(n => !readNotifications.has(n.id));

  return (
    <>
      <div className="flex h-screen bg-gray-50 text-gray-900 font-sans">
      
      {/* Main Content Area: App Shell representing the Plugin Views */}
      <div className="flex-1 flex flex-col bg-gray-50 h-full overflow-hidden">
        
        {/* Top Navbar */}
        <AppHeader
          activeRole={activeRole}
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
        />

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
          onOpenImportLessons={() => { setImportStatus('idle'); setImportProgress(0); setImportProgressTotal(0); setImportErrorMsg(''); setPreviewImportData([]); setIsImportLessonsOpen(true); }}
          onOpenCourseWizard={() => { setWizardStep(1); setIsCourseWizardOpen(true); }}
          onViewCourse={(lessonId) => { setTeacherTab('lesson_editor'); setSelectedLesson(lessonId); }}
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
        showImportModal={showImportModal}
        setShowImportModal={setShowImportModal}
        handleImportFile={handleImportFile}
        importError={importError}
        importSuccess={importSuccess}
        isImporting={isImporting}
        downloadCSVTemplate={downloadCSVTemplate}
        isCourseWizardOpen={isCourseWizardOpen}
        setIsCourseWizardOpen={setIsCourseWizardOpen}
        wizardStep={wizardStep}
        setWizardStep={setWizardStep}
        wizardIsSubmitting={wizardIsSubmitting}
        wizardCourseTitle={wizardCourseTitle}
        setWizardCourseTitle={setWizardCourseTitle}
        wizardCourseDescription={wizardCourseDescription}
        setWizardCourseDescription={setWizardCourseDescription}
        wizardCourseCategory={wizardCourseCategory}
        setWizardCourseCategory={setWizardCourseCategory}
        wizardCourseTimeline={wizardCourseTimeline}
        setWizardCourseTimeline={setWizardCourseTimeline}
        wizardCourseContent={wizardCourseContent}
        setWizardCourseContent={setWizardCourseContent}
        addToast={addToast}
        generateTemplateContent={generateTemplateContent}
        handleDeployWizardCourse={handleDeployWizardCourse}
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
        isQuizGeneratorOpen={isQuizGeneratorOpen}
        setIsQuizGeneratorOpen={setIsQuizGeneratorOpen}
        lessons={lessons}
        quizGenMode={quizGenMode}
        setQuizGenMode={setQuizGenMode}
        quizGenSelectedLessonId={quizGenSelectedLessonId}
        setQuizGenSelectedLessonId={setQuizGenSelectedLessonId}
        quizGenTopic={quizGenTopic}
        setQuizGenTopic={setQuizGenTopic}
        isGeneratingSuggestions={isGeneratingSuggestions}
        setIsGeneratingSuggestions={setIsGeneratingSuggestions}
        suggestedObjectives={suggestedObjectives}
        setSuggestedObjectives={setSuggestedObjectives}
        suggestedQuestions={suggestedQuestions}
        setSuggestedQuestions={setSuggestedQuestions}
        quizGenTimeLimit={quizGenTimeLimit}
        setQuizGenTimeLimit={setQuizGenTimeLimit}
        savingQuiz={savingQuiz}
        setSavingQuiz={setSavingQuiz}
        quizGeneratorClassId={quizGeneratorClassId}
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
        batchPicker={batchPicker}
        setBatchPicker={setBatchPicker}
        batchPickerLesson={batchPickerLesson}
        setBatchPickerLesson={setBatchPickerLesson}
        batchPickerDate={batchPickerDate}
        setBatchPickerDate={setBatchPickerDate}
        batchPickerTargetClass={batchPickerTargetClass}
        setBatchPickerTargetClass={setBatchPickerTargetClass}
        classes={classes}
        expandedClassId={expandedClassId}
        confirmBatchPicker={confirmBatchPicker}
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
        selectedNotificationForModal={selectedNotificationForModal}
        setSelectedNotificationForModal={setSelectedNotificationForModal}
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

      {/* Real-time Toast Notifications */}
      <ToastContainer />

      </div>
    </>
  );
}
