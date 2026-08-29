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
import {
  generateClassPDFReport,
  exportClassGradesCSV,
  exportAllClassesCombinedCSV,
  computeCsvPreviewData,
} from './services/gradeReportService';

const AGENT_PROVIDER_STORAGE_KEY = 'openlearnv2.agentProviderId';

const DEFAULT_PLUGIN = `exports.default = {
  manifest: {
    id: "@my-scope/hello-world",
    name: "Hello World Plugin",
    version: "1.0.0",
    capabilitiesProposed: ["lesson:read"]
  },
  activate: async (ctx) => {
    ctx.log.info('Hello World plugin activated');
  }
};`;

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
  const [plugins, setPlugins] = useState<PluginType[]>([]);
  const [aiProviders, setAiProviders] = useState<AIProvider[]>([]);
  const [isAIProviderModalOpen, setIsAIProviderModalOpen] = useState(false);
  const [editingAIProvider, setEditingAIProvider] = useState<AIProvider | null>(null);
  const [providerName, setProviderName] = useState('');
  const [providerApiUrl, setProviderApiUrl] = useState('');
  const [providerApiKey, setProviderApiKey] = useState('');
  const [providerModelName, setProviderModelName] = useState('');
  const [testingProviderId, setTestingProviderId] = useState<string | null>(null);
  const selectedLesson = useAppStore((s) => s.selectedLesson);
  const setSelectedLesson = useAppStore((s) => s.setSelectedLesson);
  const elements = useAppStore((s) => s.elements);
  const setElements = useAppStore((s) => s.setElements);
  const [showPluginModal, setShowPluginModal] = useState(false);
  const [storeTab, setStoreTab] = useState<'store' | 'widgets' | 'dev' | 'logs'>('store');
  const [pluginCode, setPluginCode] = useState(DEFAULT_PLUGIN);
  const [installingPlugin, setInstallingPlugin] = useState(false);

  // Add Course Wizard states
  const [isCourseWizardOpen, setIsCourseWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [wizardCourseTitle, setWizardCourseTitle] = useState('');
  const [wizardCourseCategory, setWizardCourseCategory] = useState('Mathematics');
  const [wizardCourseDescription, setWizardCourseDescription] = useState('');
  const [wizardCourseContent, setWizardCourseContent] = useState('');
  const [wizardCourseTimeline, setWizardCourseTimeline] = useState<any[]>([
    { id: 'seg-w1', title: 'Course Orientation / 课堂导入', type: 'intro', duration: '5m', color: 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100', notes: 'Introduce basic goals' },
    { id: 'seg-w2', title: 'Subject Core Lecture / 核心精讲', type: 'lecture', duration: '20m', color: 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100', notes: 'Present major content frameworks' },
    { id: 'seg-w3', title: 'Interactive Lab Work / 实践演练', type: 'practice', duration: '15m', color: 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100', notes: 'Provide collaborative assignments on terminal or board' },
    { id: 'seg-w4', title: 'Wrap up / 随堂总结与答疑', type: 'summary', duration: '5m', color: 'bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100', notes: 'Reflect and assign task' }
  ]);
  const [wizardIsSubmitting, setWizardIsSubmitting] = useState(false);

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
  const [events, setEvents] = useState<any[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [approvals, setApprovals] = useState<any[]>([]);
  const [scoreOverrides, setScoreOverrides] = useState<Record<string, number>>({});
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

  // ── 批量管理模式（班级管理）──
  const [batchMode, setBatchMode] = useState<boolean>(false);
  const [selectedClassIds, setSelectedClassIds] = useState<Set<string>>(new Set());
  const [selectedStudentIds, setSelectedStudentIds] = useState<Set<string>>(new Set());
  // 批量操作选择弹窗：schedule=批量排课, lockedLesson=批量锁定课程, transfer=批量转班
  const [batchPicker, setBatchPicker] = useState<null | 'schedule' | 'lockedLesson' | 'transfer'>(null);
  const [batchPickerLesson, setBatchPickerLesson] = useState<string>('');
  const [batchPickerDate, setBatchPickerDate] = useState<string>('');
  const [batchPickerTargetClass, setBatchPickerTargetClass] = useState<string>('');

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
  
  // Enhanced AI MCQ Quiz Generator
  const [isQuizGeneratorOpen, setIsQuizGeneratorOpen] = useState(false);
  const [quizGeneratorClassId, setQuizGeneratorClassId] = useState<string | null>(null);
  const [quizGenMode, setQuizGenMode] = useState<'scan_lesson' | 'topic'>('scan_lesson');
  const [quizGenSelectedLessonId, setQuizGenSelectedLessonId] = useState<string>('');
  const [quizGenTopic, setQuizGenTopic] = useState('');
  const [isGeneratingSuggestions, setIsGeneratingSuggestions] = useState(false);
  const [suggestedObjectives, setSuggestedObjectives] = useState<string[]>([]);
  const [suggestedQuestions, setSuggestedQuestions] = useState<any[]>([]);
  const [savingQuiz, setSavingQuiz] = useState(false);
  const [quizStudentAnswers, setQuizStudentAnswers] = useState<Record<number, string>>({});
  const [quizGenTimeLimit, setQuizGenTimeLimit] = useState<number>(10);
  const quizStudentAnswersRef = useRef<Record<number, string>>(quizStudentAnswers);
  useEffect(() => {
    quizStudentAnswersRef.current = quizStudentAnswers;
  }, [quizStudentAnswers]);
  const [subAssignmentTab, setSubAssignmentTab] = useState<'quiz' | 'whiteboard'>('quiz');

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

  const handleDeployWizardCourse = async () => {
    if (!wizardCourseTitle.trim()) {
      alert(lang === 'zh' ? '请输入课程标题！' : 'Please provide a course title!');
      return;
    }
    setWizardIsSubmitting(true);
    try {
      const displayContent = wizardCourseContent.trim() || `Course outline for ${wizardCourseTitle} (${wizardCourseCategory})`;
      const res = await fetch('/api/lessons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          title: wizardCourseTitle, 
          content: displayContent 
        })
      });
      if (res.ok) {
        const data = await res.json();
        const newLessonId = data.result?.lessonId;
        if (newLessonId) {
          // Saveload the timeline segments 
          await fetch(`/api/lessons/${newLessonId}/timeline`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ timeline: wizardCourseTimeline })
          });
        }
        await fetchLessons();
        if (newLessonId) {
          setSelectedLesson(newLessonId);
          // Redirect the user to direct editor view for immediate immersion
          setTeacherTab('lesson_editor');
        }
        addToast(
          lang === 'zh' ? '⭐ 课程发布成功' : '⭐ Course Deployed Successfully',
          lang === 'zh' ? `课程《${wizardCourseTitle}》已成功保存到核心SQLite并已自动激活！` : `Course "${wizardCourseTitle}" is now live in SQLite and auto-activated.`,
          'success'
        );
        setIsCourseWizardOpen(false);
        setWizardCourseTitle('');
        setWizardCourseCategory('Mathematics');
        setWizardCourseDescription('');
        setWizardCourseContent('');
        setWizardStep(1);
      } else {
        addToast('Error', 'SQLite save failed', 'warning');
      }
    } catch (err) {
      console.error(err);
      addToast('Error', 'Launch Exception', 'warning');
    } finally {
      setWizardIsSubmitting(false);
    }
  };

  const fetchAIProviders = async () => {
    try {
      const res = await fetch('/api/ai-providers');
      if (res.ok) {
        const data = await res.json();
        setAiProviders(data);
      }
    } catch (err) {
      console.warn('Failed to fetch AI providers:', err);
    }
  };

  const handleSaveAIProvider = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!providerName.trim() || !providerApiUrl.trim() || !providerModelName.trim()) {
      addToast(
        lang === 'zh' ? '验证错误' : 'Validation Error',
        lang === 'zh' ? '名称、API URL 和模型名称不可为空' : 'Name, API URL and Model Name are required.',
        'warning'
      );
      return;
    }

    try {
      const isEditing = !!editingAIProvider;
      const url = isEditing ? `/api/ai-providers/${editingAIProvider.id}` : '/api/ai-providers';
      const method = isEditing ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: providerName,
          api_url: providerApiUrl,
          api_key: providerApiKey,
          model_name: providerModelName
        })
      });

      if (res.ok) {
        addToast(
          lang === 'zh' ? '保存成功' : 'Saved Successfully',
          lang === 'zh' ? `AI 提供商 [${providerName}] 已保存到数据库中。` : `AI Provider [${providerName}] saved to DB.`,
          'success'
        );
        fetchAIProviders();
        setIsAIProviderModalOpen(false);
        setEditingAIProvider(null);
        setProviderName('');
        setProviderApiUrl('');
        setProviderApiKey('');
        setProviderModelName('');
      } else {
        const errData = await res.json();
        addToast(
          lang === 'zh' ? '保存失败' : 'Failed to Save',
          errData.error || 'Server error',
          'warning'
        );
      }
    } catch (err: any) {
      console.error(err);
      addToast(
        lang === 'zh' ? '操作异常' : 'Execution Error',
        err.message || 'Error occurred',
        'warning'
      );
    }
  };

  const handleDeleteAIProvider = async (id: string, name: string) => {
    if (!confirm(lang === 'zh' ? `确认要删除 AI 提供商 [${name}] 吗？` : `Are you sure you want to delete AI Provider [${name}]?`)) {
      return;
    }
    try {
      const res = await fetch(`/api/ai-providers/${id}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        addToast(
          lang === 'zh' ? '删除成功' : 'Deleted Successfully',
          lang === 'zh' ? `AI 提供商 [${name}] 已经被清除。` : `AI Provider [${name}] has been removed.`,
          'success'
        );
        fetchAIProviders();
      } else {
        addToast(
          lang === 'zh' ? '删除失败' : 'Failed to Delete',
          'Database error',
          'warning'
        );
      }
    } catch (err: any) {
      console.error(err);
      addToast(
        lang === 'zh' ? '操作异常' : 'Execution Error',
        err.message || 'Error occurred',
        'warning'
      );
    }
  };

  const handleTestAIProvider = async (provider: any) => {
    setTestingProviderId(provider.id);
    try {
      const res = await fetch('/api/ai-providers/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_url: provider.api_url,
          api_key: provider.api_key,
          model_name: provider.model_name
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        addToast(
          lang === 'zh' ? '测试通过' : 'Test Succeeded',
          lang === 'zh' ? `成功连接至 [${provider.name}]。${data.message}` : `Successfully connected to [${provider.name}]. ${data.message}`,
          'success'
        );
      } else {
        addToast(
          lang === 'zh' ? '测试失败' : 'Test Failed',
          data.error || 'Connection error',
          'warning'
        );
      }
    } catch (err: any) {
      console.error(err);
      addToast(
        lang === 'zh' ? '连接异常' : 'Connection Exception',
        err.message || 'Error occurred',
        'warning'
      );
    } finally {
      setTestingProviderId(null);
    }
  };

  useEffect(() => {
    if (rightSidebarTab === 'agent') {
      fetchAIProviders();
    }
  }, [rightSidebarTab]);

  const downloadCsvTemplate = () => {
    const csvContent = "title,content\n" +
      "\"Algebra Fundamentals\",\"Hello class! Today we will learn about basic variables, linear equations, and how to balance equations.\"\n" +
      "\"History of Computing\",\"An exploration of mechanical computing, Alan Turing, ENIAC, and the evolution of modern microchips.\"\n" +
      "\"General Science: Light & Optics\",\"Explore the concepts of reflection, refraction, and the visible light spectrum with simple virtual canvas exercises.\"";
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "lesson_import_template.csv");
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleCSVFileChange = (file: File) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setImportStatus('error');
      setImportErrorMsg(lang === 'zh' ? '只支持包含 .csv 后缀名的文件！' : 'Only files ending in .csv are supported!');
      return;
    }
    
    setImportStatus('parsing');
    setImportErrorMsg('');
    
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        if (!text) {
          throw new Error(lang === 'zh' ? '文件内容为空' : 'File content is empty');
        }
        
        // Custom parser to handle quoted strings with commas and quotes
        const lines: string[][] = [];
        let row: string[] = [];
        let inQuotes = false;
        let currentValue = '';

        for (let i = 0; i < text.length; i++) {
          const char = text[i];
          const nextChar = text[i + 1];

          if (char === '"') {
            if (inQuotes && nextChar === '"') {
              currentValue += '"'; // Escaped quote
              i++; // Skip next quote
            } else {
              inQuotes = !inQuotes; // Toggle quote state
            }
          } else if (char === ',' && !inQuotes) {
            row.push(currentValue.trim());
            currentValue = '';
          } else if ((char === '\r' || char === '\n') && !inQuotes) {
            if (char === '\r' && nextChar === '\n') {
              i++; // Skip \n in \r\n
            }
            row.push(currentValue.trim());
            if (row.length > 0 && row.some(val => val !== '')) {
              lines.push(row);
            }
            row = [];
            currentValue = '';
          } else {
            currentValue += char;
          }
        }
        
        if (currentValue || row.length > 0) {
          row.push(currentValue.trim());
          if (row.some(val => val !== '')) {
            lines.push(row);
          }
        }

        if (lines.length === 0) {
          throw new Error(lang === 'zh' ? '未在 CSV 文件中找到任何有效行。' : 'No valid lines resolved in the CSV.');
        }

        const headers = lines[0].map(h => h.toLowerCase().replace(/['"]/g, '').trim());
        const titleIdx = headers.indexOf('title');
        const contentIdx = headers.indexOf('content');

        if (titleIdx === -1 || contentIdx === -1) {
          throw new Error(
            lang === 'zh'
              ? '找不到必填列。您的 CSV 文件首行必须包含 "title" 和 "content" 列。'
              : 'Required columns not found. First row of CSV must contain "title" and "content" headers.'
          );
        }

        const results: { title: string; content: string }[] = [];
        for (let idx = 1; idx < lines.length; idx++) {
          const currentRow = lines[idx];
          const titleVal = currentRow[titleIdx] || '';
          const contentVal = currentRow[contentIdx] || '';
          if (titleVal.trim()) {
            results.push({
              title: titleVal,
              content: contentVal
            });
          }
        }

        if (results.length === 0) {
          throw new Error(lang === 'zh' ? '找到表头，但数据行为空或包含空白课程标题。' : 'Headers resolved but no courses were found in data rows.');
        }

        setPreviewImportData(results);
      } catch (err: any) {
        setImportStatus('error');
        setImportErrorMsg(err.message || String(err));
      }
    };
    
    reader.onerror = () => {
      setImportStatus('error');
      setImportErrorMsg(lang === 'zh' ? '无法读取选取的 CSV 文件！' : 'Failure to read the CSV!');
    };
    
    reader.readAsText(file);
  };

  const handleCSVImportSubmit = async () => {
    if (previewImportData.length === 0) return;
    setImportStatus('importing');
    setImportProgress(0);
    setImportProgressTotal(previewImportData.length);
    
    let succeeded = 0;
    
    for (let i = 0; i < previewImportData.length; i++) {
      const item = previewImportData[i];
      try {
        const response = await fetch('/api/lessons', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            title: item.title,
            content: item.content
          })
        });
        
        if (response.ok) {
          succeeded++;
        } else {
          const errData = await response.json();
          console.warn(`Failed to import item ${i + 1}:`, errData);
        }
      } catch (err) {
        console.warn(`Error importing item ${i + 1}:`, err);
      }
      setImportProgress(i + 1);
    }
    
    if (succeeded > 0) {
      setImportStatus('success');
      await fetchLessons(); // Refresh lessons list
    } else {
      setImportStatus('error');
      setImportErrorMsg(lang === 'zh' ? '所有课程项导入均失败。请检查控制台或格式。' : 'Failed to import any of the courses. Please check your console or schema.');
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

  const fetchPlugins = async () => {
    try {
      const res = await fetch('/api/plugins');
      if (res.ok) {
        const data = await res.json();
        setPlugins(data);
      }
    } catch (e) {
      console.warn("Failed to fetch plugins", e);
    }
  };

  // 每次进入插件中心时自动刷新插件列表
  React.useEffect(() => {
    if (teacherTab === 'plugins') {
      fetchPlugins();
    }
  }, [teacherTab]);

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

  const fetchEvents = async () => {
    try {
      const res = await fetch('/api/events');
      if (res.ok) {
         setEvents(await res.json());
      }
    } catch (e) {}
  };

  const fetchApprovals = async () => {
    try {
      const res = await fetch('/api/approvals');
      if (res.ok) {
         setApprovals(await res.json());
      }
    } catch (e) {}
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

  // ── 批量操作处理函数（班级管理）──
  const toggleClassSelection = (id: string) => {
    setSelectedClassIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleSelectAllClasses = () => {
    setSelectedClassIds(prev =>
      prev.size === classes.length && classes.length > 0 ? new Set() : new Set(classes.map(c => c.id))
    );
  };
  const toggleStudentSelection = (id: string) => {
    setSelectedStudentIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleSelectAllStudents = (list: StudentType[]) => {
    setSelectedStudentIds(prev =>
      prev.size === list.length && list.length > 0 ? new Set() : new Set(list.map(s => s.id))
    );
  };

  const handleBatchDeleteClasses = async () => {
    if (selectedClassIds.size === 0) return;
    if (!confirm(lang === 'zh' ? `确认彻底删除选中的 ${selectedClassIds.size} 个班级吗？该操作不可恢复。` : `Delete ${selectedClassIds.size} selected classes permanently?`)) return;
    for (const id of selectedClassIds) {
      await fetch(`/api/classes/${id}`, { method: 'DELETE' });
    }
    setSelectedClassIds(new Set());
    await fetchClasses();
  };

  const handleBatchExportClasses = async () => {
    if (selectedClassIds.size === 0) return;
    await handleExportAllClassesCombined(classes.filter(c => selectedClassIds.has(c.id)));
  };

  const handleBatchSetPasscode = async () => {
    if (selectedClassIds.size === 0) return;
    const val = window.prompt(lang === 'zh' ? '请输入临时班级密码（留空则清除）:' : 'Enter temporary passcode (leave empty to clear):');
    if (val === null) return;
    for (const id of selectedClassIds) {
      await fetch(`/api/classes/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ class_passcode: val === '' ? null : val }),
      });
    }
    setSelectedClassIds(new Set());
    await fetchClasses();
  };

  const handleBatchScheduleClasses = () => {
    if (selectedClassIds.size === 0) return;
    setBatchPickerLesson('');
    setBatchPickerDate(new Date().toISOString().split('T')[0]);
    setBatchPicker('schedule');
  };

  const handleBatchDeleteStudents = async () => {
    if (selectedStudentIds.size === 0 || !expandedClassId) return;
    if (!confirm(lang === 'zh' ? `确认彻底删除选中的 ${selectedStudentIds.size} 名学生账号吗？将删除其全部关联数据，不可恢复。` : `Permanently delete ${selectedStudentIds.size} selected student accounts?`)) return;
    for (const id of selectedStudentIds) {
      await fetch(`/api/students/${id}`, { method: 'DELETE' });
    }
    setSelectedStudentIds(new Set());
    await fetchClassStudents(expandedClassId);
  };

  const handleBatchResetPassword = async () => {
    if (selectedStudentIds.size === 0 || !expandedClassId) return;
    const val = window.prompt(lang === 'zh' ? '请输入要为选中学生设置的新密码:' : 'Enter new password for selected students:');
    if (val === null || val.trim() === '') return;
    for (const id of selectedStudentIds) {
      await fetch(`/api/students/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: val }),
      });
    }
    setSelectedStudentIds(new Set());
    await fetchClassStudents(expandedClassId);
  };

  const handleBatchTransferStudents = () => {
    if (selectedStudentIds.size === 0 || !expandedClassId) return;
    setBatchPickerTargetClass('');
    setBatchPicker('transfer');
  };

  const handleBatchSetLockedLesson = () => {
    if (selectedStudentIds.size === 0 || !expandedClassId) return;
    setBatchPickerLesson('');
    setBatchPicker('lockedLesson');
  };

  const confirmBatchPicker = async () => {
    if (!expandedClassId) return;
    if (batchPicker === 'schedule') {
      if (!batchPickerLesson) { alert(lang === 'zh' ? '请选择课程' : 'Please select a lesson'); return; }
      for (const id of selectedClassIds) {
        await fetch(`/api/classes/${id}/schedules`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lessonId: batchPickerLesson, scheduledDate: batchPickerDate + ' 09:00:00', status: 'scheduled' }),
        });
      }
      setSelectedClassIds(new Set());
    } else if (batchPicker === 'lockedLesson') {
      if (!batchPickerLesson) { alert(lang === 'zh' ? '请选择课程' : 'Please select a lesson'); return; }
      for (const id of selectedStudentIds) {
        await fetch(`/api/students/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ locked_lesson_id: batchPickerLesson }),
        });
      }
      setSelectedStudentIds(new Set());
    } else if (batchPicker === 'transfer') {
      if (!batchPickerTargetClass || batchPickerTargetClass === expandedClassId) { alert(lang === 'zh' ? '请选择不同的目标班级' : 'Please select a different target class'); return; }
      for (const id of selectedStudentIds) {
        await fetch(`/api/classes/${expandedClassId}/students/${id}`, { method: 'DELETE' });
        await fetch(`/api/classes/${batchPickerTargetClass}/students`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ studentId: id }),
        });
      }
      setSelectedStudentIds(new Set());
    }
    setBatchPicker(null);
    if (expandedClassId) await fetchClassStudents(expandedClassId);
  };

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
    let filename = '';
    let headers = '';
    let sampleRow = '';
    if (type === 'class') {
      filename = lang === 'zh' ? '班级及学生批量导入模板.csv' : 'class_import_template.csv';
      headers = 'Class Name,Class Desc,Student Name,Student Email';
      sampleRow = lang === 'zh' 
        ? '高一A班,基础英语课程,李明,liming@example.com\n高一A班,基础英语课程,王华,wanghua@example.com' 
        : 'Class 101,Introduction to English,John Doe,john@example.com\nClass 101,Introduction to English,Jane Smith,jane@example.com';
    } else {
      filename = lang === 'zh' ? '学生批量导入模板.csv' : 'student_import_template.csv';
      headers = 'Student Name,Student Email';
      sampleRow = lang === 'zh'
        ? '张三,zhangsan@example.com\n李四,lisi@example.com'
        : 'Alice Cooper,alice@example.com\nBob Dylan,bob@example.com';
    }
    
    const blob = new Blob(['\uFEFF' + headers + '\n' + sampleRow], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleImportFile = (file: File) => {
    setIsImporting(true);
    setImportError(null);
    setImportSuccess(null);

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const text = event.target?.result as string;
        if (!text) {
          throw new Error('File content is empty');
        }

        let parsedData: any[] = [];
        let parsedStudents: any[] = [];
        let isClassImport = true;

        if (file.name.endsWith('.json')) {
          try {
            const data = JSON.parse(text);
            if (!Array.isArray(data)) {
              throw new Error('JSON structure must be an array');
            }
            // Check if the items seem to be classes or students
            const hasClassElement = data.some((item: any) => item.className || item.name && (item.students || item.classDescription));
            
            if (hasClassElement) {
              isClassImport = true;
              parsedData = data.map(cls => {
                const name = cls.name || cls.className || cls.class_name;
                const description = cls.description || cls.classDescription || '';
                const rawStudents = cls.students || cls.studentList || [];
                const students = (Array.isArray(rawStudents) ? rawStudents : []).map((st: any) => ({
                  name: st.name || st.studentName || '',
                  email: st.email || st.studentEmail || ''
                })).filter((st: any) => st.name);
                return { name, description, students };
              }).filter(cls => cls.name);
            } else {
              isClassImport = false;
              parsedStudents = data.map((st: any) => ({
                name: st.name || st.studentName || st.student_name || '',
                email: st.email || st.studentEmail || st.student_email || ''
              })).filter((st: any) => st.name);
            }
          } catch (e: any) {
            throw new Error('Failed to parse JSON: ' + e.message);
          }
        } else {
          const lines = text.split(/\r?\n/);
          if (lines.length < 2) {
            throw new Error('CSV has empty or insufficient data');
          }
          const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
          
          const classNameIdx = headers.findIndex(h => h.includes('class name') || h.includes('班级名称') || h.includes('班级') || h.includes('classname') || h.includes('class_name'));
          const classDescIdx = headers.findIndex(h => h.includes('class desc') || h.includes('班级描述') || h.includes('描述') || h.includes('class_desc'));
          const studentNameIdx = headers.findIndex(h => h.includes('student name') || h.includes('学生姓名') || h.includes('姓名') || h.includes('学生') || h.includes('studentname') || h.includes('student_name'));
          const studentEmailIdx = headers.findIndex(h => h.includes('student email') || h.includes('学生邮箱') || h.includes('邮箱') || h.includes('email') || h.includes('studentemail') || h.includes('student_email'));

          if (studentNameIdx === -1) {
            throw new Error('CSV is missing column: "Student Name" (学生姓名/姓名/学生)');
          }

          if (classNameIdx !== -1) {
            isClassImport = true;
            const classesMap: { [className: string]: { name: string, description: string, students: { name: string, email: string }[] } } = {};

            for (let i = 1; i < lines.length; i++) {
              const line = lines[i].trim();
              if (!line) continue;
              
              const parts = line.match(/(".*?"|[^",]+)(?=\s*,|\s*$)/g) || line.split(',');
              const cleanParts = parts.map(p => p.replace(/^"|"$/g, '').trim());

              const className = cleanParts[classNameIdx];
              if (!className) continue;

              const classDesc = classDescIdx !== -1 ? (cleanParts[classDescIdx] || '') : '';
              const studentName = studentNameIdx !== -1 ? (cleanParts[studentNameIdx] || '') : '';
              const studentEmail = studentEmailIdx !== -1 ? (cleanParts[studentEmailIdx] || '') : '';

              if (!classesMap[className]) {
                classesMap[className] = {
                  name: className,
                  description: classDesc,
                  students: []
                };
              }

              if (studentName) {
                classesMap[className].students.push({
                  name: studentName,
                  email: studentEmail
                });
              }
            }
            parsedData = Object.values(classesMap);
          } else {
            isClassImport = false;
            for (let i = 1; i < lines.length; i++) {
              const line = lines[i].trim();
              if (!line) continue;

              const parts = line.match(/(".*?"|[^",]+)(?=\s*,|\s*$)/g) || line.split(',');
              const cleanParts = parts.map(p => p.replace(/^"|"$/g, '').trim());

              const studentName = cleanParts[studentNameIdx];
              const studentEmail = studentEmailIdx !== -1 ? (cleanParts[studentEmailIdx] || '') : '';

              if (studentName) {
                parsedStudents.push({
                  name: studentName,
                  email: studentEmail
                });
              }
            }
          }
        }

        if (isClassImport) {
          if (parsedData.length === 0) {
            throw new Error('No valid class elements found inside file.');
          }

          const response = await fetch('/api/classes/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ classes: parsedData })
          });

          if (!response.ok) {
            const errBody = await response.json();
            throw new Error(errBody.error || 'Server importation failed');
          }

          const resData = await response.json();
          
          await fetchClasses();
          await fetchStudents();
          setImportSuccess(lang === 'zh' 
            ? `成功导入 ${resData.imported.length} 个班级数据！` 
            : `Successfully imported ${resData.imported.length} classes data!`);
        } else {
          if (parsedStudents.length === 0) {
            throw new Error('No valid student elements found inside file.');
          }

          const response = await fetch('/api/students/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ students: parsedStudents })
          });

          if (!response.ok) {
            const errBody = await response.json();
            throw new Error(errBody.error || 'Server student importation failed');
          }

          const resData = await response.json();
          
          await fetchStudents();
          setImportSuccess(lang === 'zh' 
            ? `成功导入 ${resData.imported.filter((s: any) => s.new).length} 名新学者，匹配并更新了其中的 ${resData.imported.filter((s: any) => !s.new).length} 名同学！` 
            : `Successfully imported ${resData.imported.filter((s: any) => s.new).length} new students and updated ${resData.imported.filter((s: any) => !s.new).length} existing ones!`);
        }
      } catch (err: any) {
        setImportError(err.message);
      } finally {
        setIsImporting(false);
      }
    };

    reader.onerror = () => {
      setImportError('Failed to read file from disk.');
      setIsImporting(false);
    };

    reader.readAsText(file);
  };

  const handleInstallPlugin = async () => {
    if (!pluginCode.trim()) return;
    setInstallingPlugin(true);
    try {
      const res = await fetch('/api/plugins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceCode: pluginCode })
      });
      const data = await res.json();
      if (data.success) {
        await fetchPlugins();
        setShowPluginModal(false);
        setChatLog(prev => [...prev, { role: 'agent', content: `[System] Plugin "${data.manifest.name}" installed successfully. You can now prompt me to use it.`}]);
      } else {
        alert("Plugin installation failed: " + data.error);
      }
    } catch (err: any) {
      alert("Error: " + err.message);
    } finally {
      setInstallingPlugin(false);
    }
  };

  const handleZipPluginUpload = async (
    file: File,
    executionMode: 'worker' | 'inline',
    opts?: { mode?: 'install' | 'update'; targetPluginId?: string; allowDowngrade?: boolean },
  ) => {
    setInstallingPlugin(true);
    const isUpdate = opts?.mode === 'update';
    try {
      // Raw binary upload — avoids base64 memory overhead for large files
      const headers: Record<string, string> = {
        'Content-Type': 'application/octet-stream',
        'X-Filename': encodeURIComponent(file.name),
        'X-Execution-Mode': executionMode,
        'X-Install-Mode': isUpdate ? 'update' : 'install',
        'X-Allow-Downgrade': opts?.allowDowngrade ? 'true' : 'false',
      };
      if (opts?.targetPluginId) {
        headers['X-Target-Plugin-Id'] = encodeURIComponent(opts.targetPluginId);
      }

      const url =
        isUpdate && opts?.targetPluginId
          ? `/api/plugins/${encodeURIComponent(opts.targetPluginId)}/update-zip-raw`
          : '/api/plugins/upload-zip-raw';

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: file,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        const errMsg = data.error || 'Unknown error';
        addToast(
          lang === 'zh' ? (isUpdate ? '更新失败' : '安装失败') : isUpdate ? 'Update Failed' : 'Installation Failed',
          errMsg,
          'error',
        );
        throw new Error(errMsg);
      }

      const installedId = data.pluginId || data.manifest?.pluginId || data.manifest?.id;
      const updated = !!(data.updated || isUpdate);

      // New install: auto-activate. Update: keep previous enabled/disabled state
      // (backend already hot-reloads when it was active).
      if (!updated && installedId) {
        await fetch(`/api/plugins/${encodeURIComponent(installedId)}/toggle`, { method: 'POST' }).catch(() => {});
      } else if (updated && data.wasActive && installedId) {
        // Force frontend shell to drop stale UI bindings before list refresh re-activates
        try {
          await host.deactivatePlugin(installedId);
        } catch {
          /* ignore */
        }
      }

      setTeacherTab('plugins');
      setStoreTab('store');
      await fetchPlugins();
      setTimeout(() => {
        void fetchPlugins();
      }, 1000);

      const pluginName = data.manifest?.name || installedId || file.name;
      if (updated) {
        const fromV = data.oldVersion || '?';
        const toV = data.newVersion || data.manifest?.version || '?';
        addToast(
          lang === 'zh' ? '插件更新成功' : 'Plugin Updated',
          lang === 'zh'
            ? `"${pluginName}" 已从 v${fromV} 更新到 v${toV}（配置与数据已保留）`
            : `"${pluginName}" updated v${fromV} → v${toV} (config & data preserved)`,
          'success',
        );
        setChatLog((prev) => [
          ...prev,
          { role: 'agent', content: `[System] Plugin "${pluginName}" updated ${fromV} → ${toV}.` },
        ]);
      } else {
        addToast(
          lang === 'zh' ? '插件安装成功' : 'Plugin Installed',
          lang === 'zh'
            ? `三方插件 "${pluginName}" 已成功上传并以 [${executionMode === 'worker' ? 'Worker 隔离' : 'VM 嵌入'}] 模式激活运行！`
            : `Plugin "${pluginName}" installed and activated in [${executionMode}] mode!`,
          'success',
        );
        setChatLog((prev) => [
          ...prev,
          { role: 'agent', content: `[System] Plugin "${pluginName}" installed successfully from ZIP file.` },
        ]);
      }
    } catch (err: any) {
      const msg = err?.message ? String(err.message) : '';
      const alreadyToasted = msg && msg !== 'Failed to fetch' && msg !== 'Network error';
      if (!alreadyToasted) {
        addToast(lang === 'zh' ? '网络错误' : 'Network Error', msg || 'Network error', 'error');
      }
      throw err;
    } finally {
      setInstallingPlugin(false);
    }
  };

  const handleTogglePlugin = async (id: string) => {
    // Prevent double-clicks from racing two activate calls (activating → activating)
    if (togglingPluginsRef.current.has(id)) return;
    togglingPluginsRef.current.add(id);
    try {
      const res = await fetch(`/api/plugins/${encodeURIComponent(id)}/toggle`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
         await fetchPlugins();
      } else {
        const errMsg = data.error || 'Unknown error';
        if (errMsg.includes('requires human approval') || errMsg.includes('queued')) {
          alert(lang === 'zh' ? '该操作已加入"待审批高危操作"列表，请在右侧侧边栏中通过审批以生效。' : 'This action has been queued. Please approve it in the Pending Approvals list on the right side.');
          await fetchApprovals();
        } else {
          alert((lang === 'zh' ? '切换插件状态失败: ' : 'Failed to toggle plugin: ') + errMsg);
        }
      }
    } catch (e) {
      console.error('Failed to toggle plugin:', e);
      alert(lang === 'zh' ? '网络错误，切换插件失败' : 'Network error, failed to toggle plugin');
    } finally {
      togglingPluginsRef.current.delete(id);
    }
  };

  const handleDeletePlugin = async (id: string) => {
    if (!window.confirm(lang === 'zh' ? '确定要彻底删除该插件吗？删除后此插件相关的功能将无法使用。' : 'Are you sure you want to completely delete this plugin? This cannot be undone.')) {
      return;
    }
    try {
      const res = await fetch(`/api/plugins/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (res.ok) {
         setTeacherTab('plugins');
         setStoreTab('store');
         await fetchPlugins();
         setChatLog(prev => [...prev, { role: 'agent', content: `[System] Plugin uninstalled and deleted.` }]);
      } else {
         const data = await res.json().catch(() => ({}));
         alert(data.error || (lang === 'zh' ? '删除插件失败' : 'Failed to delete plugin'));
      }
    } catch (e) {
      console.error('Failed to delete plugin:', e);
      alert(lang === 'zh' ? '删除插件失败' : 'Failed to delete plugin');
    }
  };

  const handleApprove = async (id: string, payloadOverride?: any) => {
    try {
      const res = await fetch(`/api/approvals/${id}/approve`, { 
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ payloadOverride })
      });
      const data = await res.json();
      if (data.success) {
        await fetchApprovals();
        await fetchLessons();
        await fetchPlugins();
      } else {
        alert("Action failed: " + data.error);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleReject = async (id: string) => {
    try {
      await fetch(`/api/approvals/${id}/reject`, { method: 'POST' });
      await fetchApprovals();
      await fetchPlugins();
    } catch (e) {
      console.error(e);
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
