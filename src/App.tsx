import { MessageSquare, Wand2, Plus, Trash2, PenTool, LayoutTemplate, LayoutGrid, List, Globe, Code, Blocks, Download, Upload, Paperclip, Terminal, ChevronUp, ChevronDown, ChevronRight, FileText, Shield, ShieldAlert, Check, X, Folder, File as FileIcon, Activity, Users, BarChart2, ClipboardList, Send, FileBadge, PlayCircle, Loader2, Calendar as CalendarIcon, CheckCircle2, Bell, BookOpen, Settings, PanelRightClose, PanelRightOpen, Home, Presentation, HelpCircle, Search, Settings2, Percent, ListFilter, Clock, Sparkles, Eye, Maximize2, Minimize2, Database, Shuffle } from 'lucide-react';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { PluginTabPanel } from './components/PluginTabPanel.js';
import { parseCSV } from './utils/pluginParsers.js';
import Markdown from 'react-markdown';
import { translations, Language } from './i18n';
import { LazyWhiteboard } from './components/LazyWhiteboard';
import { UserMenu } from './components/UserMenu';
import { ProfileModal } from './components/ProfileModal';
import { LessonPalette } from './features/teacher/lesson-editor/LessonPalette';
import { PaletteCardEditModal } from './features/teacher/lesson-editor/PaletteCardEditModal';
import { PALETTE_ITEM_MAP } from './features/teacher/lesson-editor/paletteConfig';
import { TimelineRail } from './features/teacher/lesson-editor/TimelineRail';
import { SegmentEditorCard } from './features/teacher/lesson-editor/SegmentEditorCard';
import { LazyCourseware } from './components/LazyCourseware';
import { LiveClassroomView } from './components/LiveClassroomView';
import { CoursewareHubPanel } from './features/teacher/CoursewareHubPanel';

// ── Hash-based routing helpers ────────────────────────────────────────────
// Map the active teacher tab to/from the URL hash so page switches are
// reflected in the browser address bar (e.g. #/classes). Hash routing needs
// no server-side SPA fallback, unlike History API pushState.
function tabToHash(tab: string): string {
  return '#/' + tab;
}
function hashToTab(hash: string): string | null {
  const raw = hash.replace(/^#/, '');
  if (!raw || raw === '/') return null;
  return raw.replace(/^\//, '');
}

import { ChevronLeft, Menu } from 'lucide-react';
// InteractiveCoursewareViewer: loaded as local module (Phase 5 v5.0 refactoring)
import { QuickActionsMenu } from './components/QuickActionsMenu';
import { CountdownTimer } from './components/CountdownTimer';
import { StudentGradedTimeline } from './components/StudentGradedTimeline';
import { SemesterGradeTrendChart } from './components/SemesterGradeTrendChart';
import { RecentThreeMonthsPerformanceChart } from './components/RecentThreeMonthsPerformanceChart';
import { AcademicGrowthTrajectoryChart } from './components/AcademicGrowthTrajectoryChart';
import { ScheduledLessonsProgressChart } from './components/ScheduledLessonsProgressChart';
import { StudentCompareGrowthChart } from './components/StudentCompareGrowthChart';
import { ClassAttendanceSummaryChart } from './components/ClassAttendanceSummaryChart';

import { StudentPrivateNotesEditor } from './components/StudentPrivateNotesEditor';
import { ComputerLabManager } from './components/ComputerLabManager';
import { LoginPage } from './components/LoginPage';
import { AdminPanel } from './components/AdminPanel';
import { HelpTour } from './components/HelpTour';
import { TimetableManager } from './components/TimetableManager';
import { SemesterGradeManager } from './components/SemesterGradeManager';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { motion, AnimatePresence, animate } from 'motion/react';
import { io } from 'socket.io-client';
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
import { ExtensionPointRenderer, DOMExtensionWrapper } from './plugin-host/extension-point-renderer';
import { usePluginHost } from './plugin-host/plugin-host-context';
import { usePluginHostStore } from './plugin-host/plugin-host-store';
import { registerTeacherActivityCenter } from './features/activity-ecosystem/registerTeacherExtension.js';

// Register the teacher Activity Center (idempotent) so teachers see the same
// Activity Provider ecosystem the students get in their workspace.
registerTeacherActivityCenter();
import { PluginState } from './plugin-host/types';
import { PluginCenter } from './components/PluginCenter';
import { LegacyPluginBadge } from './components/LegacyPluginBadge';
import { FrontendAPIService } from './services/frontend-api';
import { SocketService } from './services/socket-service';
import { UIService } from './services/ui-service';
import { StorageService } from './services/storage-service';
import { useAppStore, appStore } from './store/appStore';
import type {
  Lesson, AIProvider, WhiteboardElement, PluginType, VFSNode, ProcessType,
  ClassType, StudentType, AssignmentType, SubmissionType,
  ScheduleType, AttendanceType, StudentProgressType,
  Toast,
} from './store/appStore';
import { EventBus } from '../packages/core/event-bus';
import { AnimatedCounter } from './components/AnimatedCounter';
import { StudentPerformanceCharts } from './features/student/StudentPerformanceCharts';
import { StudentQuickStats } from './features/student/StudentQuickStats';
import { StudentCourseProgressList } from './features/student/StudentCourseProgressList';
import { StudentLessonHeader } from './features/student/StudentLessonHeader';
import { StudentLessonContentPanel } from './features/student/StudentLessonContentPanel';
import { StudentLessonInteractionPanel } from './features/student/StudentLessonInteractionPanel';
import { StudentLessonView } from './features/student/StudentLessonView';
import { StudentSchedulePanel } from './features/student/StudentSchedulePanel';
import { StudentDashboardHeader } from './features/student/StudentDashboardHeader';
import { StudentRollCallAlarms } from './features/student/StudentRollCallAlarms';
import { StudentAssignmentsPanel } from './features/student/StudentAssignmentsPanel';
import { StudentDashboardPanel } from './features/student/StudentDashboardPanel';
import { ToastContainer } from './features/shared/ToastContainer';
import { NavigationSidebar } from './features/shared/NavigationSidebar';
import { RightSidebar } from './features/shared/RightSidebar';
import { ProcessLogsModal } from './features/modals/ProcessLogsModal';
import { ImportModal } from './features/modals/ImportModal';
import { CloudDriveModal, CloudDrivePanel } from './features/modals/CloudDriveModal';
import { NotificationDetailModal } from './features/modals/NotificationDetailModal';
import { HelpView, generateTemplateContent } from './features/teacher/HelpView';
import { TimetableView } from './features/teacher/TimetableView';
import { ComputerLabView } from './features/teacher/ComputerLabView';
import { AdminDirectoryView } from './features/teacher/AdminDirectoryView';
import { PluginView } from './features/teacher/PluginView';

import { CourseManagement } from './features/teacher/CourseManagement';
import { Dashboard } from './features/teacher/Dashboard';
import { LessonEditorView } from './features/teacher/LessonEditorView.js';
import { CreateClassButton } from './features/teacher/classes/CreateClassButton.js';
import { ManualImportButton } from './features/teacher/classes/ManualImportButton.js';
import { ClassPasscodeController } from './features/teacher/classes/ClassPasscodeController.js';
import { ClassRowHeader } from './features/teacher/classes/ClassRowHeader.js';
import { ClassTabs } from './features/teacher/classes/ClassTabs.js';
import { ClassStudentsPanel } from './features/teacher/classes/ClassStudentsPanel.js';
import { ClassAssignmentsPanel } from './features/teacher/classes/ClassAssignmentsPanel.js';
import { ClassSchedulesCharts } from './features/teacher/classes/ClassSchedulesCharts';
import { ClassScheduleAttendance } from './features/teacher/classes/ClassScheduleAttendance';
import { ClassesView } from './features/teacher/classes/ClassesView';

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

const CAPABILITY_INFO: Record<string, {
  labelZh: string;
  labelEn: string;
  iconName: string;
  risk: 'low' | 'medium' | 'high';
  riskDescZh: string;
  riskDescEn: string;
}> = {
  'whiteboard:write': {
    labelZh: '写入交互白板内容',
    labelEn: 'Whiteboard Write Access',
    iconName: 'PenTool',
    risk: 'medium',
    riskDescZh: '中风险：允许插件在授课白板上自由擦写、增删几何教具和课件图形，会实时推送或改变所有在线学员的画板视图。',
    riskDescEn: 'Medium Risk: Authorizes the plugin to draw, erase, or alter whiteboard elements, live-syncing to all classroom attendees.'
  },
  'whiteboard:read': {
    labelZh: '读取白板元素图层',
    labelEn: 'Whiteboard Read Access',
    iconName: 'Eye',
    risk: 'low',
    riskDescZh: '低风险：仅读取白板当前的静态图形元素，用于做辅助的数据联动分析或内容导出。',
    riskDescEn: 'Low Risk: Read active static vectors or quiz properties from the blackboard without modification.'
  },
  'management:read': {
    labelZh: '读取教务学员名册',
    labelEn: 'School Directory Read',
    iconName: 'Users',
    risk: 'medium',
    riskDescZh: '中风险：允许插件遍历读取班级下的学生姓名、登录邮箱等档案信息（如在做点名提问筛选时）。',
    riskDescEn: 'Medium Risk: Allows retrieving list of enrolled students, email profiles, or attendance history.'
  },
  'management:write': {
    labelZh: '修改教务核心档案',
    labelEn: 'School Directory Write',
    iconName: 'Database',
    risk: 'high',
    riskDescZh: '高风险：强力权限！允许插件创建、编辑或彻底抹除班级列表、学生个人账号、授课日志及考勤成绩等多项核心教务系统档案。',
    riskDescEn: 'High Risk: Critical! Grants ability to modify academic profiles, drop students, change registers, or log grade-sheets.'
  }
};

const hostEventBus = new EventBus();

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

  const socketRef = useRef<any>(null);
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

  const filteredAndSortedLessons = React.useMemo(() => {
    let result = [...lessons];
    if (lessonsSearchQuery.trim()) {
      const q = lessonsSearchQuery.toLowerCase();
      result = result.filter(lesson => 
        lesson.title.toLowerCase().includes(q) || 
        lesson.content.toLowerCase().includes(q)
      );
    }
    
    if (lessonsSortOrder === 'recent') {
      result.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    } else if (lessonsSortOrder === 'alphabetical') {
      result.sort((a, b) => a.title.localeCompare(b.title));
    } else if (lessonsSortOrder === 'enrollment') {
      result.sort((a, b) => (b.enrollment_count || 0) - (a.enrollment_count || 0));
    }
    
    return result;
  }, [lessons, lessonsSearchQuery, lessonsSortOrder]);
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
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
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
  const addToast = (title: string, message: string, type: 'info' | 'success' | 'warning' = 'info') => {
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
    setIsGeneratingPDFReport(prev => ({ ...prev, [classId]: true }));
    try {
      // Ensure data is loaded
      await fetchClassStudents(classId);
      await fetchClassDashboard(classId);
      await fetchClassProgress(classId);

      const cStudents = classStudentsMap[classId] || [];
      const dashData = classDashboardMap[classId];
      if (!dashData) {
        addToast(
          lang === 'zh' ? '暂无班级评分数据' : 'No Class Performance Data',
          lang === 'zh' ? '请确保在此班级加载了作业与测验。' : 'Please check if assignments or quizzes are present for this class.',
          'warning'
        );
        return;
      }

      const performanceData = dashData.performance || [];
      const assignmentsData = dashData.assignments || [];

      // Determine Student Ranking Distributions
      const studentStatsMap: Record<string, {
        id: string;
        name: string;
        totalGradesSum: number;
        gradedCount: number;
        submittedCount: number;
        totalCount: number;
      }> = {};

      cStudents.forEach(st => {
        studentStatsMap[st.id] = {
          id: st.id,
          name: st.name,
          totalGradesSum: 0,
          gradedCount: 0,
          submittedCount: 0,
          totalCount: 0
        };
      });

      performanceData.forEach((p: any) => {
        const sId = p.student_id;
        if (studentStatsMap[sId]) {
          studentStatsMap[sId].totalCount++;
          if (p.submission_status === 'submitted' || p.submission_status === 'graded') {
            studentStatsMap[sId].submittedCount++;
          }
          if (p.score !== null && p.score !== undefined) {
            studentStatsMap[sId].totalGradesSum += p.score;
            studentStatsMap[sId].gradedCount++;
          }
        }
      });

      const studentRanks = Object.values(studentStatsMap).map(st => {
        const avgScore = st.gradedCount > 0 ? (st.totalGradesSum / st.gradedCount) : 0;
        const submissionRate = st.totalCount > 0 ? (st.submittedCount / st.totalCount) * 100 : 0;
        return {
          ...st,
          avgScore,
          submissionRate
        };
      });

      // Sort students by average score descending (ranking distribution)
      studentRanks.sort((a, b) => b.avgScore - a.avgScore);

      // Overall class metrics
      let totalClassGradesSum = 0;
      let totalClassGradedCount = 0;
      let totalClassSubmissions = 0;
      let totalClassOpportunities = 0;

      performanceData.forEach((p: any) => {
        totalClassOpportunities++;
        if (p.submission_status === 'submitted' || p.submission_status === 'graded') {
          totalClassSubmissions++;
        }
        if (p.score !== null && p.score !== undefined) {
          totalClassGradesSum += p.score;
          totalClassGradedCount++;
        }
      });

      const classAvgScore = totalClassGradedCount > 0 ? (totalClassGradesSum / totalClassGradedCount) : 0;
      const classSubmissionRate = totalClassOpportunities > 0 ? (totalClassSubmissions / totalClassOpportunities) * 100 : 0;

      // Assignment Stats Breakdown
      const assignmentStatsMap: Record<string, {
        id: string;
        title: string;
        scores: number[];
        submittedCount: number;
        totalCount: number;
      }> = {};

      assignmentsData.forEach((a: any) => {
        assignmentStatsMap[a.id] = {
          id: a.id,
          title: a.title,
          scores: [],
          submittedCount: 0,
          totalCount: 0
        };
      });

      performanceData.forEach((p: any) => {
        const aId = p.assignment_id;
        if (assignmentStatsMap[aId]) {
          assignmentStatsMap[aId].totalCount++;
          if (p.submission_status === 'submitted' || p.submission_status === 'graded') {
            assignmentStatsMap[aId].submittedCount++;
          }
          if (p.score !== null && p.score !== undefined) {
            assignmentStatsMap[aId].scores.push(p.score);
          }
        }
      });

      const assignmentStats = Object.values(assignmentStatsMap).map(ast => {
        const count = ast.scores.length;
        const sumVal = ast.scores.reduce((s, v) => s + v, 0);
        const avgVal = count > 0 ? (sumVal / count) : 0;
        const maxVal = count > 0 ? Math.max(...ast.scores) : 0;
        const minVal = count > 0 ? Math.min(...ast.scores) : 0;
        const subRateVal = ast.totalCount > 0 ? (ast.submittedCount / ast.totalCount) * 100 : 0;
        return {
          ...ast,
          avg: avgVal,
          max: maxVal,
          min: minVal,
          subRate: subRateVal
        };
      });

      // Initialize jsPDF Doc
      const doc = new jsPDF({
        orientation: 'p',
        unit: 'mm',
        format: 'a4'
      });

      // Colors definition (Executive palette)
      const primaryColor = [15, 23, 42]; // Slate 900
      const accentColor = [79, 70, 229]; // Indigo 600
      const textColor = [51, 65, 85]; // Slate 700
      const borderLineColor = [226, 232, 240]; // Slate 200

      // Helper for drawing clean dividers
      const drawDivider = (yPos: number) => {
        doc.setDrawColor(borderLineColor[0], borderLineColor[1], borderLineColor[2]);
        doc.setLineWidth(0.3);
        doc.line(14, yPos, 196, yPos);
      };

      // PAGE 1: Header/Branding Area
      doc.setFillColor(primaryColor[0], primaryColor[1], primaryColor[2]);
      doc.rect(0, 0, 210, 42, 'F'); // Dark primary banner

      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(20);
      doc.text('CLASS PERFORMANCE REPORT', 14, 18);
      
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(194, 205, 225); // Slate 300
      doc.text(`Academic Insights • Generative Report Summary`, 14, 25);
      doc.text(`Classroom: ${className} | Date: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`, 14, 32);

      // Logo-box
      doc.setFillColor(accentColor[0], accentColor[1], accentColor[2]);
      doc.rect(172, 10, 24, 24, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(14);
      doc.setTextColor(255, 255, 255);
      doc.text('OS', 180, 26);

      let currentY = 52;

      // Executive Metrics Grid
      doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.text('I. EXECUTIVE OVERVIEW', 14, currentY);
      currentY += 6;

      const summaryRows = [
        ['Classroom/Subject Name', className],
        ['Total Enrolled Students', `${cStudents.length} student(s)`],
        ['Curriculum Items (Assignments/Quizzes)', `${assignmentsData.length} items`],
        ['Global Assignment Submission Rate', `${classSubmissionRate.toFixed(1)}%`],
        ['Class Average Performance Score', `${classAvgScore.toFixed(1)}%`]
      ];

      (doc as any).autoTable({
        startY: currentY,
        head: [['Metric Indicator', 'Class-wide Metric Value']],
        body: summaryRows,
        theme: 'striped',
        headStyles: {
          fillColor: primaryColor,
          textColor: [255, 255, 255],
          fontStyle: 'bold',
          fontSize: 9
        },
        bodyStyles: {
          textColor: textColor,
          fontSize: 8.5
        },
        margin: { left: 14, right: 14 }
      });

      currentY = (doc as any).lastAutoTable.finalY + 12;

      // Ranking Distribution Table
      doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.text('II. STUDENT RANKING DISTRIBUTION', 14, currentY);
      currentY += 6;

      const rankingRows = studentRanks.map((sr, index) => {
        let tier = 'Excellent';
        if (sr.avgScore >= 90) tier = 'Excellent (A)';
        else if (sr.avgScore >= 75) tier = 'Good (B)';
        else if (sr.avgScore >= 60) tier = 'Satisfactory (C)';
        else tier = 'Needs Improvement (D)';

        return [
          `${index + 1}`,
          sr.name,
          `${sr.submittedCount}/${sr.totalCount} (${sr.submissionRate.toFixed(0)}%)`,
          `${sr.avgScore.toFixed(1)}%`,
          tier
        ];
      });

      (doc as any).autoTable({
        startY: currentY,
        head: [['Rank', 'Student Name', 'Completion Rate', 'Average Score', 'Academic Standing Tier']],
        body: rankingRows,
        theme: 'grid',
        headStyles: {
          fillColor: accentColor,
          textColor: [255, 255, 255],
          fontStyle: 'bold',
          fontSize: 8.5
        },
        bodyStyles: {
          textColor: textColor,
          fontSize: 8
        },
        alternateRowStyles: {
          fillColor: [248, 250, 252] // light grey slate
        },
        columnStyles: {
          0: { cellWidth: 15, halign: 'center', fontStyle: 'bold' },
          1: { fontStyle: 'bold' },
          2: { halign: 'center' },
          3: { halign: 'center', fontStyle: 'bold' }
        },
        margin: { left: 14, right: 14 }
      });

      currentY = (doc as any).lastAutoTable.finalY + 12;

      // Check for page overflow
      if (currentY > 210) {
        doc.addPage();
        currentY = 20;
      }

      // Assignment Stats Table
      doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.text('III. ASSIGNMENT PERFORMANCE METRICS', 14, currentY);
      currentY += 6;

      const assignmentRows = assignmentStats.map((ast) => {
        return [
          ast.title,
          `${ast.subRate.toFixed(0)}%`,
          `${ast.avg.toFixed(1)}%`,
          `${ast.min.toFixed(0)}% - ${ast.max.toFixed(0)}%`
        ];
      });

      (doc as any).autoTable({
        startY: currentY,
        head: [['Assignment/Quiz Title', 'Submission Rate', 'Average Grade', 'Range (Min - Max)']],
        body: assignmentRows.length > 0 ? assignmentRows : [['No assignment performance records found.', '-', '-', '-']],
        theme: 'striped',
        headStyles: {
          fillColor: [100, 116, 139], // Slate 500
          textColor: [255, 255, 255],
          fontStyle: 'bold',
          fontSize: 8.5
        },
        bodyStyles: {
          textColor: textColor,
          fontSize: 8
        },
        columnStyles: {
          1: { halign: 'center' },
          2: { halign: 'center', fontStyle: 'bold' },
          3: { halign: 'center' }
        },
        margin: { left: 14, right: 14 }
      });

      currentY = (doc as any).lastAutoTable.finalY + 15;

      // If footer needs clean spacing or new page
      if (currentY > 260) {
        doc.addPage();
        currentY = 25;
      }

      // Summary Note & Signature Section
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184); // Slate 400
      doc.text('* This academic summary report is dynamically compiled and authorized based on stored gradebook entries.', 14, currentY);
      
      currentY += 12;
      drawDivider(currentY);
      
      currentY += 6;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      doc.text('School OS Comprehensive Academic Platform • Secure Automated Export Document', 14, currentY);

      // Save PDF
      const fileName = `${className.replace(/\s+/g, '_')}_Performance_Summary_${new Date().toISOString().split('T')[0]}.pdf`;
      doc.save(fileName);

      addToast(
        lang === 'zh' ? '📄 PDF 报告下载成功' : '📄 PDF Report Downloaded',
        lang === 'zh' ? `高阶班级统计及排名分步图已存入 "${fileName}"` : `Successfully prepared academic diagnostics for "${className}"`,
        'success'
      );
    } catch (error: any) {
      console.error('PDF Generation Failed:', error);
      addToast(
        lang === 'zh' ? '❌ PDF 报告生成失败' : '❌ PDF Report Failed',
        error.message || 'Error occurred during PDF generation',
        'warning'
      );
    } finally {
      setIsGeneratingPDFReport(prev => ({ ...prev, [classId]: false }));
    }
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

      const headerRow = [
        'Class Name',
        'Student Name',
        'Student Email',
        'Quizzes Average',
        'Assignments Average',
        'Calculated Weighted Score (40% Quiz / 60% Assignment)',
        'Simple Average Score',
        'Submitted Count',
        'Total Items'
      ];

      const csvRows: string[][] = [headerRow];

      const escapeCSV = (val: string | number | null | undefined): string => {
        if (val === null || val === undefined) return '';
        const stringified = String(val);
        if (stringified.includes(',') || stringified.includes('"') || stringified.includes('\n')) {
          return `"${stringified.replace(/"/g, '""')}"`;
        }
        return stringified;
      };

      exportList.forEach((cls) => {
        const cStudents = classStudentsMap[cls.id] || [];
        const dashData = classDashboardMap[cls.id];
        if (!dashData || !dashData.assignments || cStudents.length === 0) return;

        const assignments = dashData.assignments || [];

        const classifiedAssignments = assignments.map((a: any) => {
          const isMcq = a.content && a.content.startsWith('{"quizType":"mcq_learning_objectives"');
          const hasQuizInTitle = a.title && (a.title.toLowerCase().includes('quiz') || a.title.toLowerCase().includes('test') || a.title.includes('测验') || a.title.includes('测试'));
          const category = (isMcq || hasQuizInTitle) ? 'quiz' : 'assignment';
          return { ...a, category };
        });

        cStudents.forEach((st: any) => {
          let quizScoreSum = 0;
          let quizCount = 0;
          let assignmentScoreSum = 0;
          let assignmentCount = 0;
          let overallSum = 0;
          let gradedCount = 0;

          classifiedAssignments.forEach((a: any) => {
            const scoreObj = dashData.performance?.find(
              (p: any) => p.student_id === st.id && p.assignment_id === a.id && p.submission_status === 'graded' && p.score !== null
            );
            if (scoreObj) {
              const scoreVal = Number(scoreObj.score);
              overallSum += scoreVal;
              gradedCount++;
              if (a.category === 'quiz') {
                quizScoreSum += scoreVal;
                quizCount++;
              } else {
                assignmentScoreSum += scoreVal;
                assignmentCount++;
              }
            }
          });

          const qAvg = quizCount > 0 ? Math.round(quizScoreSum / quizCount) : null;
          const aAvg = assignmentCount > 0 ? Math.round(assignmentScoreSum / assignmentCount) : null;
          
          let weightedScore = 0;
          if (qAvg !== null && aAvg !== null) {
            weightedScore = Math.round((qAvg * 0.4) + (aAvg * 0.6));
          } else if (qAvg !== null) {
            weightedScore = Math.round(qAvg);
          } else if (aAvg !== null) {
            weightedScore = Math.round(aAvg);
          }
          const simpleAvg = gradedCount > 0 ? Math.round(overallSum / gradedCount) : 0;

          const studentRow = [
            cls.name,
            st.name,
            st.email,
            qAvg !== null ? `${qAvg}%` : 'N/A',
            aAvg !== null ? `${aAvg}%` : 'N/A',
            `${weightedScore}%`,
            `${simpleAvg}%`,
            `${gradedCount}`,
            `${assignments.length}`
          ];

          csvRows.push(studentRow);
        });
      });

      if (csvRows.length <= 1) {
        alert(lang === 'zh' ? '暂无可导出的成绩数据。请确保班级中有已评分的作业。' : 'No graded performance data available to export.');
        return;
      }

      const csvContent = "data:text/csv;charset=utf-8,\uFEFF" 
        + csvRows.map(e => e.map(escapeCSV).join(",")).join("\n");
      
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement("a");
      link.setAttribute("href", encodedUri);
      link.setAttribute("download", `All_Classes_Combined_Grades_${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
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
  
  // Chat file attachments
  const [chatAttachments, setChatAttachments] = useState<{name: string, content: string}[]>([]);

  const [currentVfsParent, _setCurrentVfsParent] = useState<string | null>(null);
  const currentVfsParentRef = useRef<string | null>(null);
  const setCurrentVfsParent = (id: string | null) => {
    _setCurrentVfsParent(id);
    currentVfsParentRef.current = id;
  };

  const [chatLog, setChatLog] = useState<{role: 'user'|'agent', content: string}[]>([
    { role: 'agent', content: t.agentIntro }
  ]);

  // Update initial message when language changes if no other messages
  useEffect(() => {
    if (chatLog.length === 1 && chatLog[0].role === 'agent') {
      setChatLog([{ role: 'agent', content: t.agentIntro }]);
    }
  }, [lang, t.agentIntro]);

  // ── Kernel assistant conversation memory ────────────────────────────────
  // The server persists turns per (user, lesson). We restore the visible
  // chat log from that memory on mount and whenever the active lesson changes,
  // so the assistant's memory is also reflected in the UI across reloads.
  const restoreAgentMemory = useCallback(async (lessonId?: string | null) => {
    try {
      const res = await fetch(`/api/agent/conversations?lessonId=${encodeURIComponent(lessonId || '')}`);
      if (!res.ok) return;
      const data = await res.json();
      const msgs = Array.isArray(data.messages) ? data.messages : [];
      if (msgs.length > 0) {
        setChatLog(
          msgs.map((m: any) => ({
            role: m.role === 'assistant' ? 'agent' : 'user',
            content: m.content,
          }))
        );
      } else {
        setChatLog([{ role: 'agent', content: t.agentIntro }]);
      }
    } catch {
      /* memory restore is best-effort; ignore network errors */
    }
  }, [t.agentIntro]);

  const handleClearAgentMemory = useCallback(async () => {
    try {
      await fetch(`/api/agent/conversations?lessonId=${encodeURIComponent(selectedLesson || '')}`, {
        method: 'DELETE',
      });
    } catch {
      /* best-effort */
    }
    setChatLog([{ role: 'agent', content: t.agentIntro }]);
  }, [selectedLesson, t.agentIntro]);

  // Restore memory for the current lesson when it changes (and on first mount).
  useEffect(() => {
    restoreAgentMemory(selectedLesson);
  }, [selectedLesson, restoreAgentMemory]);

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
        if (!selectedLesson && data.length > 0) {
          setSelectedLesson(data[0].id);
        }
      }
    } catch (e) {
      console.warn("Failed to fetch lessons", e);
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
    if (!exportClassId) return null;
    const cStudents = classStudentsMap[exportClassId] || [];
    const dashData = classDashboardMap[exportClassId];
    if (!dashData || !dashData.assignments || cStudents.length === 0) {
      return null;
    }
    
    const assignments = dashData.assignments || [];
    const performance = dashData.performance || [];

    // Classify assignments
    const classifiedAssignments = assignments.map((a: any) => {
      let category: 'quiz' | 'assignment' = 'assignment';
      if (customCategoryOverrides[a.id]) {
        category = customCategoryOverrides[a.id];
      } else {
        const isMcq = a.content && a.content.startsWith('{"quizType":"mcq_learning_objectives"');
        const hasQuizInTitle = a.title && (a.title.toLowerCase().includes('quiz') || a.title.toLowerCase().includes('test') || a.title.includes('测验') || a.title.includes('测试'));
        category = (isMcq || hasQuizInTitle) ? 'quiz' : 'assignment';
      }
      return { ...a, category };
    });

    const headers: string[] = ['Student Name', 'Student Email'];
    classifiedAssignments.forEach((a: any) => {
      const catLabel = a.category === 'quiz' ? 'Quiz' : 'Assignment';
      headers.push(`${catLabel}: ${a.title}`);
    });
    
    headers.push(
      'Quizzes Average', 
      'Assignments Average', 
      `Weighted Average (${quizzesWeight}% Quizzes, ${assignmentsWeight}% Assignments)`, 
      'Simple Average Score', 
      'Submitted Count', 
      'Total Items'
    );

    const rows: string[][] = [];
    const previewStudents = cStudents.slice(0, 5);

    previewStudents.forEach((st: any) => {
      const studentRow: string[] = [st.name, st.email];
      
      let quizScoreSum = 0;
      let quizGradedCount = 0;
      let assignmentScoreSum = 0;
      let assignmentGradedCount = 0;
      let totalScoreSum = 0;
      let totalGradedCount = 0;
      let submittedCount = 0;

      classifiedAssignments.forEach((a: any) => {
        const perf = performance.find((p: any) => p.assignment_id === a.id && p.student_id === st.id);
        if (perf && perf.score !== null && perf.score !== undefined) {
          studentRow.push(`${perf.score}%`);
          const scoreVal = Number(perf.score);
          
          if (a.category === 'quiz') {
            quizScoreSum += scoreVal;
            quizGradedCount++;
          } else {
            assignmentScoreSum += scoreVal;
            assignmentGradedCount++;
          }
          
          totalScoreSum += scoreVal;
          totalGradedCount++;
          submittedCount++;
        } else if (perf && perf.submission_status === 'submitted') {
          studentRow.push(lang === 'zh' ? '待评分' : 'Pending Grade');
          submittedCount++;
        } else {
          studentRow.push(lang === 'zh' ? '未提交' : 'Not Submitted');
        }
      });

      const quizAvg = quizGradedCount > 0 ? Math.round(quizScoreSum / quizGradedCount) : null;
      const assignmentAvg = assignmentGradedCount > 0 ? Math.round(assignmentScoreSum / assignmentGradedCount) : null;
      
      let weightedAvgStr = 'N/A';
      if (quizAvg !== null && assignmentAvg !== null) {
        const weighted = (quizAvg * (quizzesWeight / 100)) + (assignmentAvg * (assignmentsWeight / 100));
        weightedAvgStr = `${Math.round(weighted)}%`;
      } else if (quizAvg !== null) {
        weightedAvgStr = `${quizAvg}%`;
      } else if (assignmentAvg !== null) {
        weightedAvgStr = `${assignmentAvg}%`;
      }

      const quizAvgStr = quizAvg !== null ? `${quizAvg}%` : 'N/A';
      const assignmentAvgStr = assignmentAvg !== null ? `${assignmentAvg}%` : 'N/A';
      const simpleAvgStr = totalGradedCount > 0 ? `${Math.round(totalScoreSum / totalGradedCount)}%` : 'N/A';
      
      studentRow.push(
        quizAvgStr,
        assignmentAvgStr,
        weightedAvgStr,
        simpleAvgStr,
        `${submittedCount}`,
        `${assignments.length}`
      );

      rows.push(studentRow);
    });

    return { headers, rows, totalStudents: cStudents.length };
  }, [exportClassId, quizzesWeight, assignmentsWeight, customCategoryOverrides, classStudentsMap, classDashboardMap, lang]);

  const handleExportGrades = (
    classId: string, 
    className: string, 
    qWeight: number = 40, 
    aWeight: number = 60, 
    overrides: Record<string, 'quiz' | 'assignment'> = {}
  ) => {
    const cStudents = classStudentsMap[classId] || [];
    const dashData = classDashboardMap[classId];
    
    if (!dashData || !dashData.assignments) {
      alert("No performance data available to export. Please open the dashboard to load class data first.");
      return;
    }
    
    if (cStudents.length === 0) {
      alert("No students in this class to export grades for.");
      return;
    }

    const assignments = dashData.assignments || [];
    const performance = dashData.performance || [];

    const escapeCSV = (val: string | number | null | undefined): string => {
      if (val === null || val === undefined) return '';
      const stringified = String(val);
      if (stringified.includes(',') || stringified.includes('"') || stringified.includes('\n')) {
        return `"${stringified.replace(/"/g, '""')}"`;
      }
      return stringified;
    };

    // Classify assignments
    const classifiedAssignments = assignments.map((a: any) => {
      let category: 'quiz' | 'assignment' = 'assignment';
      if (overrides[a.id]) {
        category = overrides[a.id];
      } else {
        const isMcq = a.content && a.content.startsWith('{"quizType":"mcq_learning_objectives"');
        const hasQuizInTitle = a.title && (a.title.toLowerCase().includes('quiz') || a.title.toLowerCase().includes('test') || a.title.includes('测验') || a.title.includes('测试'));
        category = (isMcq || hasQuizInTitle) ? 'quiz' : 'assignment';
      }
      return { ...a, category };
    });

    const headerRow: string[] = ['Student Name', 'Student Email'];
    classifiedAssignments.forEach((a: any) => {
      const catLabel = a.category === 'quiz' ? 'Quiz' : 'Assignment';
      headerRow.push(`${catLabel}: ${a.title}`);
    });
    
    headerRow.push(
      'Quizzes Average', 
      'Assignments Average', 
      `Weighted Average (${qWeight}% Quizzes, ${aWeight}% Assignments)`, 
      'Simple Average Score', 
      'Submitted Count', 
      'Total Items'
    );

    const csvRows: string[][] = [headerRow];

    cStudents.forEach((st: any) => {
      const studentRow: string[] = [st.name, st.email];
      
      let quizScoreSum = 0;
      let quizGradedCount = 0;
      
      let assignmentScoreSum = 0;
      let assignmentGradedCount = 0;

      let totalScoreSum = 0;
      let totalGradedCount = 0;
      let submittedCount = 0;

      classifiedAssignments.forEach((a: any) => {
        const perf = performance.find((p: any) => p.assignment_id === a.id && p.student_id === st.id);
        if (perf && perf.score !== null && perf.score !== undefined) {
          studentRow.push(`${perf.score}%`);
          const scoreVal = Number(perf.score);
          
          if (a.category === 'quiz') {
            quizScoreSum += scoreVal;
            quizGradedCount++;
          } else {
            assignmentScoreSum += scoreVal;
            assignmentGradedCount++;
          }
          
          totalScoreSum += scoreVal;
          totalGradedCount++;
          submittedCount++;
        } else if (perf && perf.submission_status === 'submitted') {
          studentRow.push('Pending Grade');
          submittedCount++;
        } else {
          studentRow.push('Not Submitted');
        }
      });

      const quizAvg = quizGradedCount > 0 ? Math.round(quizScoreSum / quizGradedCount) : null;
      const assignmentAvg = assignmentGradedCount > 0 ? Math.round(assignmentScoreSum / assignmentGradedCount) : null;
      
      // Calculate weighted average
      let weightedAvgStr = 'N/A';
      if (quizAvg !== null && assignmentAvg !== null) {
        // Both exist
        const weighted = (quizAvg * (qWeight / 100)) + (assignmentAvg * (aWeight / 100));
        weightedAvgStr = `${Math.round(weighted)}%`;
      } else if (quizAvg !== null) {
        // Only quizzes exist
        weightedAvgStr = `${quizAvg}%`;
      } else if (assignmentAvg !== null) {
        // Only assignments exist
        weightedAvgStr = `${assignmentAvg}%`;
      }

      const quizAvgStr = quizAvg !== null ? `${quizAvg}%` : 'N/A';
      const assignmentAvgStr = assignmentAvg !== null ? `${assignmentAvg}%` : 'N/A';
      const simpleAvgStr = totalGradedCount > 0 ? `${Math.round(totalScoreSum / totalGradedCount)}%` : 'N/A';
      
      studentRow.push(
        quizAvgStr,
        assignmentAvgStr,
        weightedAvgStr,
        simpleAvgStr,
        `${submittedCount}`,
        `${assignments.length}`
      );

      csvRows.push(studentRow.map(escapeCSV));
    });

    const csvContent = csvRows.map(row => row.join(',')).join('\n');
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    
    const cleanClassName = className.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const dateStr = new Date().toISOString().split('T')[0];
    const filename = `${cleanClassName}_grades_report_${dateStr}.csv`;
    
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
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


  useEffect(() => {
    if (!session) return;
    const socket = io();
    socketRef.current = socket;

    // Phase 9: Initialize frontend PluginHost services after socket connection
    if (!host.isInitialized()) {
      host.initialize(
        new FrontendAPIService(),
        new SocketService(socket),
        new UIService(addToastRef.current),
        new StorageService('__app__')
      );
    }

    // Register student presence
    if (activeRoleRef.current === 'student' && activeStudentIdRef.current) {
      socket.emit('register-student', {
        studentId: activeStudentIdRef.current,
        name: studentsRef.current.find(s => s.id === activeStudentIdRef.current)?.name || activeStudentIdRef.current
      });
    }

    // Join global whiteboard broadcast room so we receive whiteboard-sync events
    // even before joining a specific lesson room.
    socket.emit('join-room', 'whiteboard-broadcast');

    socket.on('presence-update', (data: { onlineStudentIds: string[], activeStudentLessons: Record<string, string> }) => {
      console.log('[Socket] presence-update received:', data);
      setOnlineStudentIds(data.onlineStudentIds);
      setActiveStudentLessons(data.activeStudentLessons);
    });

    socket.on('lesson-progress-mode-changed', (data: any) => {
      console.log('[Socket] lesson-progress-mode-changed received:', data);
      const { lessonId, progressMode, progressConditions } = data;
      setLessons(prev => prev.map(l => {
        if (l.id === lessonId) {
          return {
            ...l,
            progress_mode: progressMode,
            progress_conditions: progressConditions
          };
        }
        return l;
      }));
    });

    socket.on('student-active-segment-changed', (data: any) => {
      console.log('[Socket] student-active-segment-changed received:', data);
      const { activeSegmentId } = data;
      setActiveSegmentId(activeSegmentId);
    });

    socket.on('student-pinged', (data: any) => {
      console.log('[Socket] student-pinged received:', data);
      const msg = data.message || (langRef.current === 'zh'
        ? '⚠️ 学习进度预警：老师注意到您的进度有些落后，请抓紧时间跟上！'
        : '⚠️ Progress Alert: The teacher noticed you are falling behind. Please keep up!');
      addToast(
        langRef.current === 'zh' ? '⚠️ 学习进度预警' : '⚠️ Progress Warning',
        msg,
        'warning'
      );
    });

    socket.on('student-progress-updated', (data: any) => {
      console.log('[Socket] student-progress-updated received:', data);
      const { studentId, lessonId, progressPercent, completed } = data;
      setLiveClassStudentProgress(prev => {
        const index = prev.findIndex(p => p.student_id === studentId);
        if (index !== -1) {
          const next = [...prev];
          next[index] = { ...next[index], progress_percent: progressPercent, completed: completed ? 1 : 0 };
          return next;
        } else {
          return [...prev, { student_id: studentId, progress_percent: progressPercent, completed: completed ? 1 : 0 }];
        }
      });
    });

    socket.on('assignment-graded-toast', (data: any) => {
      console.log('[Socket] assignment-graded-toast received on client:', data);
      
      // Check if this student is the active student
      if (activeRoleRef.current === 'student' && activeStudentIdRef.current && data.studentId === activeStudentIdRef.current) {
        const titleText = data.assignmentTitle || data.assignmentId;
        const msg = langRef.current === 'zh'
          ? `您的作业"${titleText}"已完成评分！得分：${data.score}%。建议反馈已收到，快去查看。`
          : `Your assignment "${titleText}" was graded. Score: ${data.score}%. Tutoring feedback has been posted.`;

        addToast(
          langRef.current === 'zh' ? '🎓 作业已评分' : '🎓 Assignment Graded',
          msg,
          'success'
        );

        // Fetch student dashboard reactively
        fetchStudentDashboard(activeStudentIdRef.current);
      }
    });

    socket.on('student-picked', (data: any) => {
      console.log('[Socket] student-picked received on client:', data);
      
      // Check if this student is the active student
      if (activeRoleRef.current === 'student' && activeStudentIdRef.current && data.studentId === activeStudentIdRef.current) {
        const msg = langRef.current === 'zh'
          ? `闪电警报！您已被老师在课程随机提问点名中抽中！请立即集中注意力参与课堂。`
          : `Attention alert! You have been randomly picked by the teacher! Please pay immediate attention.`;

        addToast(
          langRef.current === 'zh' ? '⚡️ 随机点名提问' : '⚡️ Classroom Pick Alert',
          msg,
          'warning'
        );

        // Fetch student dashboard reactively to load the newly added roll call
        fetchStudentDashboard(activeStudentIdRef.current);
      }

      // Live Class Feed updates
      setLiveClassFeed(prev => [
        {
          id: `feed-pick-${data.studentId}-${data.pickedTime || Date.now()}`,
          time: new Date(data.pickedTime || Date.now()).toLocaleTimeString(),
          type: 'picked',
          message: langRef.current === 'zh'
            ? `点名互动：随机抽中学生【${data.studentName}】。`
            : `Classroom Pick: Randomly selected student "${data.studentName}".`,
        },
        ...prev
      ]);
    });

    socket.on('student-acknowledged', (data: any) => {
      console.log('[Socket] student-acknowledged received on client:', data);
      const { studentId, notificationId } = data;
      setLiveClassAcknowledgedMap(prev => {
        const next = new Map(prev);
        next.set(studentId, true);
        return next;
      });
      setLiveClassFeed(prev => [
        {
          id: `feed-ack-${studentId}-${Date.now()}`,
          time: new Date().toLocaleTimeString(),
          type: 'checkin',
          message: langRef.current === 'zh'
            ? `学生已确认收到提问点名（学生 ID: ${studentId}）。`
            : `Student acknowledged the classroom call (Student ID: ${studentId}).`,
        },
        ...prev
      ]);
      fetchStudents();
    });

    socket.on('class-lock-status-changed', (data: any) => {
      console.log('[Socket] class-lock-status-changed received on client:', data);
      const { classId, lessonId, locked } = data;
      
      // If we are student, reactively fetch students to update locked_lesson_id
      if (activeRoleRef.current === 'student' && activeStudentIdRef.current) {
        fetchStudents().then(() => {
          // If locked, redirect to lock lesson
          if (locked && lessonId) {
            setSelectedLesson(lessonId);
            setStudentViewStatus('lesson');
            addToast(
              langRef.current === 'zh' ? '🔒 课程已被锁定' : '🔒 Lesson Locked',
              langRef.current === 'zh'
                ? '老师已锁定当前授课，您将无法切换到其他页面。'
                : 'The teacher has locked the active lesson. You cannot leave this page.',
              'info'
            );
          }
        });
        fetchStudentDashboard(activeStudentIdRef.current);
      } else {
        fetchStudents();
      }
    });

    // Global whiteboard-sync listener at App level.
    // InteractiveWhiteboard also listens inside its own component, but that requires
    // the whiteboard to already be mounted (which needs selectedLesson to be set).
    // This handler ensures students receive whiteboard push updates even before
    // they have joined a lesson — e.g. when a teacher dispatches a plugin card.
    socket.on('whiteboard-sync', (data: any) => {
      const { roomId, type } = data || {};
      if (type === 'refresh' && roomId) {
        // Fetch the new elements immediately
        fetchElements(roomId);
        // If the student has no lesson selected yet, auto-navigate to it
        if (!selectedLessonRef.current && activeRoleRef.current === 'student') {
          setSelectedLesson(roomId);
          setStudentViewStatus('lesson');
        }
        // Join the socket room for subsequent updates (idempotent)
        socket.emit('join-room', roomId);
      }
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [session, activeRole, activeStudentId]);

  useEffect(() => {
    if (socketRef.current && activeRole === 'student' && activeStudentId) {
      if (studentViewStatus === 'lesson' && selectedLesson) {
        socketRef.current.emit('enter-lesson', { studentId: activeStudentId, lessonId: selectedLesson });
        
        // Fetch current progress of the student for this lesson
        fetch(`/api/students/${activeStudentId}/progress`)
          .then(res => res.json())
          .then(progressData => {
            if (Array.isArray(progressData)) {
              const currentProg = progressData.find((p: any) => p.lesson_id === selectedLesson);
              setLocalProgressPercent(currentProg ? currentProg.progress_percent : 0);
            }
          })
          .catch(console.error);
      } else {
        socketRef.current.emit('leave-lesson', { studentId: activeStudentId });
      }
    }
  }, [studentViewStatus, selectedLesson, activeRole, activeStudentId]);

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
    if (activeRole === 'teacher' && selectedLesson && activeSegmentId && socketRef.current) {
      socketRef.current.emit('teacher-broadcast-segment', {
        lessonId: selectedLesson,
        activeSegmentId
      });
    }
  }, [activeSegmentId, selectedLesson, activeRole]);

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

  useEffect(() => {
    if (!session) return;
    const handleLmsMessage = async (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data !== 'object') return;

      let attemptId = data.attempt_id;
      let uuid = data.uuid;
      let type = data.type || '';
      let payload = data.payload || data;

      // Try to extract attemptId from sending iframe if same-origin is accessible
      if (!attemptId && event.source) {
        try {
          const iframe = Array.from(document.querySelectorAll('iframe')).find(
            f => f.contentWindow === event.source
          );
          if (iframe && iframe.contentWindow) {
            const iframeWindow = iframe.contentWindow as any;
            if (iframeWindow.__LMS_STUDENT__?.attempt_id) {
              attemptId = iframeWindow.__LMS_STUDENT__.attempt_id;
            }
            if (iframeWindow.__LMS_COURSEWARE__?.uuid) {
              uuid = iframeWindow.__LMS_COURSEWARE__.uuid;
            }
          }
        } catch (e) {
          // Cross-origin or other error, ignore
        }
      }

      if (!attemptId) return;

      // Identify if this is a submission or progress or general log
      const isSubmit = 
        type === 'LMS_SUBMIT' || 
        type === 'LMS_FINISH' || 
        type === 'submit' || 
        type === 'finish' || 
        type === 'completed' ||
        (payload && typeof payload === 'object' && (
          payload.score !== undefined || 
          payload.grade !== undefined || 
          payload.result !== undefined || 
          payload.points !== undefined
        ));

      const isSaveProgress = type === 'LMS_SAVE_PROGRESS' || type === 'saveProgress';

      if (isSubmit) {
        try {
          await fetch(`/api/courseware/attempts/${attemptId}/submit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              score: payload?.score ?? payload?.grade ?? payload?.result ?? payload?.points ?? undefined,
              comment: payload?.comment ?? payload?.feedback ?? payload?.note ?? undefined,
              completion: payload?.completion ?? 1.0,
              status: 'submitted',
              extra: payload
            })
          });
        } catch (e) {
          console.error('Failed to submit attempt data to backend:', e);
        }
      } else if (isSaveProgress) {
        try {
          await fetch(`/api/courseware/attempts/${attemptId}/submit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              score: payload?.score ?? payload?.grade ?? payload?.result ?? payload?.points ?? undefined,
              comment: payload?.comment ?? payload?.feedback ?? undefined,
              completion: payload?.completion ?? undefined,
              status: 'inprogress',
              extra: payload
            })
          });
        } catch (e) {
          console.error('Failed to save progress to backend:', e);
        }
      } else {
        try {
          await fetch(`/api/courseware/attempts/${attemptId}/log`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              eventType: type || 'log',
              payload: payload
            })
          });
        } catch (e) {
          console.error('Failed to log event to backend:', e);
        }
      }
    };

    window.addEventListener('message', handleLmsMessage);
    return () => {
      window.removeEventListener('message', handleLmsMessage);
    };
  }, [session]);

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

  useEffect(() => {
    if (!session) return;
    fetchLessons();
    fetchPlugins();
    fetchRegisteredCommands();
    fetchEvents();
    fetchApprovals();
    fetchProcesses();
    fetchClasses();
    fetchTodaySchedules();
    fetchStudents();
    fetchLabs();
    fetchVfs(currentVfsParentRef.current);
    let isFetching = false;
    const inv = setInterval(async () => {
      if (isFetching) return;
      isFetching = true;
      try {
        await fetchEvents(); 
        await fetchLessons(); 
        await fetchApprovals();
        await fetchProcesses();
        await fetchClasses();
        await fetchTodaySchedules().catch(()=>{});
        await fetchStudents();
        await fetchLabs();
        await fetchVfs(currentVfsParentRef.current);
        await fetchRegisteredCommands();
        if (showProcessLogs) {
          await fetchProcessLogs(showProcessLogs);
        }
        if (expandedClassIdRef.current) {
          await fetchClassStudents(expandedClassIdRef.current);
        }
        if (selectedLessonRef.current) {
           await fetchElements(selectedLessonRef.current);
        }
        if (selectedAssignmentRef.current) {
           await fetchElements(`assignment-${selectedAssignmentRef.current.id}-student-${activeStudentId || selectedAssignmentRef.current.student_id}`);
        }
      } finally {
        isFetching = false;
      }
    }, 2000);
    return () => clearInterval(inv);
  }, [session, showProcessLogs, activeStudentId]);

  useEffect(() => {
    fetchVfs(currentVfsParent);
  }, [currentVfsParent]);

  useEffect(() => {
    if (selectedLesson) {
      fetchElements(selectedLesson);
    }
  }, [selectedLesson]);


  const handleChatFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    Array.from(e.target.files).forEach((file: any) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          setChatAttachments(prev => [
            ...prev,
            { name: file.name, content: event.target!.result as string }
          ]);
        }
      };
      if (file.name.endsWith('.zip')) {
        reader.readAsDataURL(file);
      } else {
        reader.readAsText(file);
      }
    });
  };

  const handleChatDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (!e.dataTransfer.files) return;
    Array.from(e.dataTransfer.files).forEach((file: any) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          setChatAttachments(prev => [
            ...prev,
            { name: file.name, content: event.target!.result as string }
          ]);
        }
      };
      if (file.name.endsWith('.zip')) {
        reader.readAsDataURL(file);
      } else {
        reader.readAsText(file);
      }
    });
  };

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

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const attachmentsToSend = [...chatAttachments];
    let displayMessage = input;
    if (attachmentsToSend.length > 0) {
      displayMessage += `\n(📁 ${lang === 'zh' ? '附件' : 'Attachments'}: ${attachmentsToSend.map(f => f.name).join(', ')})`;
    }

    setChatLog(prev => [...prev, { role: 'user', content: displayMessage }]);
    setInput('');
    setChatAttachments([]);
    setLoading(true);

    try {
      const res = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          message: input, 
          lang, 
          currentLessonId: selectedLesson,
          attachments: attachmentsToSend,
          providerId: effectiveAgentProviderId === 'system' ? null : effectiveAgentProviderId
        })
      });
      const data = await res.json();
      
      let replyContent = '';
      if (!res.ok || data.success === false) {
        replyContent = `⚠️ [System Error] ${data.error || (lang === 'zh' ? '未知系统错误' : 'Unknown System Error')}`;
      } else {
        replyContent = data.agentText || '';
        if (data.toolResults && data.toolResults.length > 0) {
          replyContent += `\n\n${t.executedCommands}` + data.toolResults.map((r:any) => r.callName).join(', ');
        }
      }
      
      setChatLog(prev => [...prev, { role: 'agent', content: replyContent }]);
      
      // Refresh state
      await fetchLessons();
      await fetchClasses();
      await fetchStudents();
      if (expandedClassIdRef.current) {
        await fetchClassStudents(expandedClassIdRef.current);
        await fetchClassProgress(expandedClassIdRef.current);
        await fetchClassDashboard(expandedClassIdRef.current);
      }
      if (selectedLesson) await fetchElements(selectedLesson);
    } catch (err) {
      setChatLog(prev => [...prev, { role: 'agent', content: t.simulationError }]);
    } finally {
      setLoading(false);
    }
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
        <header className="h-16 border-b border-gray-200 bg-white flex items-center px-6 justify-between shrink-0 shadow-sm relative z-20">
         <div className="flex items-center gap-4 sm:gap-6">
            {/* 站点品牌区 (Site Brand & Logo) — click to dashboard */}
            <button
              onClick={() => {
                if (activeRole === 'teacher') {
                  setTeacherTab('dashboard');
                } else if (activeRole === 'student') {
                  setStudentViewStatus('dashboard');
                }
              }}
              className="flex items-center gap-2.5 shrink-0 hover:opacity-80 transition-opacity cursor-pointer"
              title={lang === 'zh' ? '返回系统总览' : 'Back to Dashboard'}
            >
              {siteInfo.logoUrl ? (
                <img src={siteInfo.logoUrl} alt="site logo" className="h-8 w-8 object-contain rounded-lg shrink-0" />
              ) : (
                <div className="h-8 w-8 rounded-lg bg-gradient-to-tr from-indigo-600 to-indigo-700 flex items-center justify-center text-white font-black text-sm shadow-xs shrink-0">OL</div>
              )}
              <div className="flex items-baseline gap-2">
                <span className="text-base font-black text-slate-900 tracking-tight">
                  {siteInfo.siteName || 'OpenLearn Next'}
                </span>
                <span className="text-[10px] font-medium text-slate-400 tracking-tight">v{__APP_VERSION__}</span>
                {siteInfo.slogan && (
                  <span className="hidden md:inline text-xs text-slate-400 font-normal truncate max-w-[200px]">
                    {siteInfo.slogan}
                  </span>
                )}
              </div>
            </button>

            {/* Dashboard nav entry */}
            <button
              onClick={() => {
                if (activeRole === 'teacher') {
                  setTeacherTab('dashboard');
                } else if (activeRole === 'student') {
                  setStudentViewStatus('dashboard');
                }
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors cursor-pointer ${
                (activeRole === 'teacher' && teacherTab === 'dashboard') ||
                (activeRole === 'student' && studentViewStatus === 'dashboard')
                  ? 'bg-indigo-50 text-indigo-700'
                  : 'text-slate-600 hover:text-indigo-600 hover:bg-slate-100'
              }`}
            >
              <Home size={16} />
              {lang === 'zh' ? '系统总览' : 'Dashboard'}
            </button>

            {activeRole === 'student' && (
              <>
                <span className="text-slate-300 font-light text-lg select-none">/</span>
                <h2 className="font-semibold text-gray-800 tracking-tight flex items-center gap-2">
                  <LayoutTemplate size={20} className="text-gray-400" />
                  Student Dashboard
                </h2>
              </>
            )}
            
            {activeRole === 'student' && session.role === 'teacher' && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-500">View as:</span>
                <select 
                  className="border border-gray-200 rounded p-1 text-sm bg-white"
                  value={activeStudentId || ''}
                  onChange={(e) => setActiveStudentId(e.target.value)}
                >
                  <option value="">-- Select Student --</option>
                  {students.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            )}
          </div>
          <div className="flex items-center gap-4 text-sm text-gray-500">
            {activeRole === 'student' && activeStudentId && studentDashboardData && (
              <div className="relative">
                <button 
                  onClick={() => setIsNotificationsOpen(!isNotificationsOpen)}
                  className="relative p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-full transition-colors"
                >
                  <Bell size={20} />
                  {unreadNotifications.length > 0 && (
                    <span className="absolute top-1 right-1 bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full flex items-center justify-center min-w-[18px]">
                      {unreadNotifications.length}
                    </span>
                  )}
                </button>
                
                {isNotificationsOpen && (
                  <div className="absolute right-0 mt-2 w-80 bg-white border border-gray-200 shadow-lg rounded-xl z-50 overflow-hidden">
                    <div className="p-3 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                      <h3 className="font-semibold text-gray-800">Notifications</h3>
                      {unreadNotifications.length > 0 && (
                        <button 
                          onClick={async () => {
                            if (!activeStudentId) return;
                            try {
                              const promises = studentNotifications
                                .filter(n => !readNotifications.has(n.id))
                                .map(n => {
                                  return fetch(`/api/students/${activeStudentId}/read_notifications`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ notificationId: n.id })
                                  });
                                });
                              await Promise.all(promises);
                            } catch (e) {
                              console.error(e);
                            }
                            const newRead = new Set(readNotifications);
                            studentNotifications.forEach(n => newRead.add(n.id));
                            setReadNotifications(newRead);
                          }}
                          className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
                        >
                          Mark all as read
                        </button>
                      )}
                    </div>
                    <div className="max-h-96 overflow-y-auto">
                      {studentNotifications.length === 0 ? (
                        <div className="p-4 text-center text-sm text-gray-500 italic">No notifications.</div>
                      ) : (
                        <div className="divide-y divide-gray-100">
                          {studentNotifications.map(notif => {
                            const isUnread = !readNotifications.has(notif.id);
                            return (
                              <div 
                                key={notif.id} 
                                className={`p-3 hover:bg-gray-50 cursor-pointer ${isUnread ? 'bg-indigo-50/30' : ''}`}
                                onClick={() => {
                                  if (isUnread) {
                                    if (activeStudentId) {
                                      fetch(`/api/students/${activeStudentId}/read_notifications`, {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ notificationId: notif.id })
                                      }).catch(console.error);
                                    }
                                    const newRead = new Set(readNotifications);
                                    newRead.add(notif.id);
                                    setReadNotifications(newRead);
                                  }
                                  const assocAssignment = studentDashboardData?.assignments?.find((a: any) => a.id === notif.relatedId);
                                  setSelectedNotificationForModal({
                                    ...notif,
                                    assignment: assocAssignment
                                  });
                                  setIsNotificationsOpen(false);
                                }}
                              >
                                <div className="flex gap-3">
                                  <div className="mt-0.5">
                                    {notif.type === 'new_assignment' ? (
                                      <ClipboardList size={16} className="text-indigo-500"/>
                                    ) : notif.type === 'rollcall_picked' ? (
                                      <Sparkles size={16} className="text-amber-500 animate-pulse"/>
                                    ) : (
                                      <CheckCircle2 size={16} className="text-green-500"/>
                                    )}
                                  </div>
                                  <div className="flex-1">
                                    <div className={`text-sm ${isUnread ? 'font-semibold text-gray-900' : 'font-medium text-gray-700'}`}>{notif.title}</div>
                                    <div className={`text-xs mt-0.5 ${isUnread ? 'text-gray-600' : 'text-gray-500'}`}>{notif.message}</div>
                                  </div>
                                  {isUnread && <div className="w-2 h-2 rounded-full bg-indigo-500 mt-1"></div>}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
            <button 
              onClick={() => setIsSystemResourceLibraryOpen(true)}
              className="flex items-center gap-1.5 hover:text-indigo-600 transition-colors bg-white px-3 py-1.5 rounded-md border border-gray-200 shadow-sm font-medium cursor-pointer"
            >
              <Globe size={14} className="text-emerald-500 animate-pulse" />
              {lang === 'zh' ? '系统资源库' : 'System Resource Library'}
            </button>
            <button 
              onClick={toggleLanguage}
              title={lang === 'zh' ? 'Switch to English' : '切换为中文'}
              className="p-2 hover:bg-slate-100 text-slate-600 hover:text-indigo-600 transition-colors bg-white rounded-lg border border-gray-200 shadow-3xs flex items-center justify-center shrink-0 cursor-pointer"
            >
              <Globe size={16} />
            </button>

            {/* Database Connection Status Icon Indicator */}
            {(() => {
              const statusColor = dbStatus === 'error' || !dbConnected
                ? { bg: 'bg-rose-50 border-rose-200 text-rose-600 hover:bg-rose-100 animate-pulse', dot: 'bg-rose-500', ping: 'bg-rose-400', label: lang === 'zh' ? 'SQLite 数据库连接出错或已断开' : 'SQLite DB Error / Disconnected' }
                : dbStatus === 'warning'
                ? { bg: 'bg-amber-50 border-amber-200 text-amber-600 hover:bg-amber-100', dot: 'bg-amber-500', ping: 'bg-amber-400', label: lang === 'zh' ? 'SQLite 数据库存在状态警告' : 'SQLite DB Warning' }
                : { bg: 'bg-emerald-50 border-emerald-200 text-emerald-600 hover:bg-emerald-100', dot: 'bg-emerald-500', ping: 'bg-emerald-400', label: lang === 'zh' ? 'SQLite 数据库连接正常' : 'SQLite DB Connected & Normal' };

              return (
                <div 
                  id="db-connection-status-badge"
                  className={`w-8 h-8 rounded-lg border flex items-center justify-center relative select-none shrink-0 cursor-pointer transition-colors shadow-3xs ${statusColor.bg}`}
                  title={statusColor.label}
                >
                  <Database size={15} />
                  <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
                    <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${statusColor.ping}`} />
                    <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${statusColor.dot}`} />
                  </span>
                </div>
              );
            })()}

            <UserMenu
              session={session}
              lang={lang}
              onLogout={handleLogout}
              onProfile={() => setProfileOpen(true)}
            />
          </div>
        </header>

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

        {activeRole === 'student' ? (
          <div className="flex-1 p-6 overflow-y-auto w-full max-w-full space-y-6">
            {!activeStudentId ? (
              <div className="bg-white border border-gray-200 rounded-xl p-12 text-center text-gray-500 flex flex-col items-center justify-center">
                <Users size={48} className="text-gray-300 mb-4" />
                <h3 className="text-lg font-medium text-gray-700">No Student Selected</h3>
                <p className="mt-2 text-sm">Please select a student from the top navigation bar to view their dashboard.</p>
              </div>
            ) : !studentDashboardData ? (
              <div className="flex items-center justify-center h-full text-gray-400">
                <Loader2 size={32} className="animate-spin" />
              </div>
            ) : studentViewStatus === 'lesson' ? (
              <StudentLessonView
                students={students}
                activeStudentId={activeStudentId}
                setStudentViewStatus={setStudentViewStatus}
                setSelectedLesson={setSelectedLesson}
                lessons={lessons}
                selectedLesson={selectedLesson}
                studentFullscreenPanel={studentFullscreenPanel}
                setStudentFullscreenPanel={setStudentFullscreenPanel}
                timelineSegments={timelineSegments}
                lang={lang}
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
                addToast={addToast}
              />
            ) : studentViewStatus === 'assignment' && selectedAssignment ? (
              <div className="flex flex-col h-full space-y-4">
                <div className="flex items-center justify-between">
                  <button 
                    onClick={() => { setStudentViewStatus('dashboard'); setSelectedAssignment(null); }}
                    className="flex items-center gap-2 text-indigo-600 hover:text-indigo-800 transition-colors font-medium text-sm"
                  >
                    <ChevronRight className="rotate-180" size={16} /> Back to Dashboard
                  </button>
                  <h2 className="text-xl font-bold text-gray-800">Assignment: {selectedAssignment.title}</h2>
                </div>
                <div className="flex-1 flex gap-6 min-h-0 bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
                  <div className="w-1/3 border-r border-gray-100 pr-4 overflow-y-auto hidden md:block">
                    <div className="flex justify-between items-center mb-4">
                      <div className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                        {selectedAssignment?.content && selectedAssignment.content.startsWith('{"quizType":"mcq_learning_objectives"') ? 'Assessment' : 'Question'}
                      </div>
                    </div>
                    {selectedAssignment?.content && selectedAssignment.content.startsWith('{"quizType":"mcq_learning_objectives"') ? (
                      <div className="space-y-4">
                        <div className="text-xs font-semibold uppercase tracking-wider text-teal-700 bg-teal-50 border border-teal-100 p-2.5 rounded-lg flex items-center gap-1.5 font-sans">
                          <Wand2 size={12} className="text-teal-600 animate-pulse" /> AI Interactive Evaluation
                        </div>
                        <p className="text-xs text-gray-500 leading-relaxed font-sans">
                          This assessment was automatically mapped to the core learning objectives of your lesson by our tutoring assistant compiler.
                        </p>
                        {(() => {
                          try {
                            const parsed = JSON.parse(selectedAssignment.content);
                            return (
                              <div className="space-y-2 font-sans">
                                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Lesson Learning Objectives:</div>
                                <ul className="space-y-1.5">
                                  {(parsed.learningObjectives || []).map((obj: string, i: number) => (
                                    <li key={i} className="text-xs text-gray-755 flex items-start gap-1.5 font-medium leading-normal">
                                      <span className="text-indigo-500 shrink-0 select-none">🎯</span>
                                      <span>{obj}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            );
                          } catch (e) {
                            return null;
                          }
                        })()}
                      </div>
                    ) : (
                      <div className="prose prose-sm prose-indigo max-w-none mb-6">
                        <Markdown>{selectedAssignment.content || ''}</Markdown>
                      </div>
                    )}
                    
                    {!selectedAssignment.submission_status && (
                       <div className="mt-8 border-t border-gray-100 pt-6">
                         <div className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">Ready to submit?</div>
                         <p className="text-xs text-gray-500 mb-4">
                           {selectedAssignment?.content && selectedAssignment.content.startsWith('{"quizType":"mcq_learning_objectives"') 
                             ? "Please answer all the interactive questions on the evaluation sheet, then click Submit."
                             : "You can use the whiteboard to draw or answer, then click submit when finished."}
                         </p>
                         <button 
                           onClick={async () => {
                             const isMcq = selectedAssignment?.content && selectedAssignment.content.startsWith('{"quizType":"mcq_learning_objectives"');
                             const contentToSubmit = isMcq ? JSON.stringify(quizStudentAnswers) : "Submitted via Whiteboard";
                             if (isMcq) {
                               try {
                                 const parsed = JSON.parse(selectedAssignment.content);
                                 const answeredCount = Object.keys(quizStudentAnswers).length;
                                 if (answeredCount < parsed.questions.length) {
                                   if (!window.confirm(`You have only answered ${answeredCount}/${parsed.questions.length} questions. Are you sure you want to submit your answers?`)) {
                                     return;
                                   }
                                 }
                               } catch (e) {}
                             }
                             await submitQuizAssignment(false);
                           }}
                           className="w-full py-2 bg-indigo-600 text-white rounded-lg shadow font-medium hover:bg-indigo-700 transition"
                         >
                           Submit
                         </button>
                       </div>
                    )}
                    {selectedAssignment.submission_status === 'graded' && selectedAssignment.feedback && (
                      <div className="mt-6 bg-green-50 p-4 rounded-xl border border-green-100">
                        <div className="font-semibold text-green-800 text-sm mb-1 flex items-center gap-1"><CheckCircle2 size={16}/> Grade: {selectedAssignment.score}%</div>
                        <div className="text-xs text-green-700 whitespace-pre-wrap leading-relaxed font-sans">{selectedAssignment.feedback}</div>
                      </div>
                    )}
                  </div>
                  <div className="flex-1 relative flex flex-col min-h-0">
                    {(() => {
                      const isMcqQuiz = selectedAssignment?.content && selectedAssignment.content.startsWith('{"quizType":"mcq_learning_objectives"');
                      return (
                        <>
                          <div className="flex justify-between items-center mb-2">
                             <div className="flex items-center gap-3">
                               <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 pointer-events-none">
                                 {isMcqQuiz && subAssignmentTab === 'quiz' ? 'Evaluation Sheet' : 'Live Canvas'}
                               </span>
                               {isMcqQuiz && (
                                 <div className="flex bg-gray-100 p-0.5 rounded-lg border border-gray-200 text-xs">
                                   <button
                                     onClick={() => setSubAssignmentTab('quiz')}
                                     className={`px-2.5 py-0.5 rounded text-[10px] font-bold transition-all ${subAssignmentTab === 'quiz' ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}
                                   >
                                     Interactive Test
                                   </button>
                                   <button
                                     onClick={() => setSubAssignmentTab('whiteboard')}
                                     className={`px-2.5 py-0.5 rounded text-[10px] font-bold transition-all ${subAssignmentTab === 'whiteboard' ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}
                                   >
                                     Sketch Whiteboard
                                   </button>
                                 </div>
                               )}
                             </div>
                             {selectedAssignment.submission_status && <div className="text-[10px] uppercase font-bold text-gray-400 bg-gray-100 px-2 py-0.5 rounded">Read Only</div>}
                          </div>

                          {isMcqQuiz && subAssignmentTab === 'quiz' ? (
                            <div className="flex-1 bg-gray-50/50 rounded-xl border border-gray-200 p-6 overflow-y-auto space-y-6">
                              {(() => {
                                try {
                                  const parsed = JSON.parse(selectedAssignment.content);
                                  return (
                                    <>
                                      {parsed.timeLimit > 0 && (
                                        <CountdownTimer
                                          assignmentId={selectedAssignment.id}
                                          timeLimitMinutes={parsed.timeLimit}
                                          onTimeUp={() => submitQuizAssignment(true)}
                                          isSubmitted={!!selectedAssignment.submission_status}
                                        />
                                      )}
                                      {parsed.questions.map((q: any, idx: number) => {
                                    const selectedOpt = quizStudentAnswers[idx];
                                    const isSubmitted = !!selectedAssignment.submission_status;
                                    const studentAns = quizStudentAnswers[idx];
                                    const isCorrect = studentAns === q.correctAnswer;

                                    return (
                                      <div key={idx} className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm space-y-3 font-sans">
                                        <div className="flex items-center justify-between">
                                          <div className="flex items-center gap-2">
                                            <span className="w-6 h-6 rounded-full bg-indigo-50 text-indigo-700 flex items-center justify-center text-xs font-bold ring-1 ring-indigo-100">
                                              {idx + 1}
                                            </span>
                                            <span className="text-[10px] font-semibold text-teal-700 bg-teal-50 px-2.5 py-0.5 rounded-full border border-teal-100">
                                              evaluates: {q.objective}
                                            </span>
                                          </div>
                                          {isSubmitted && (
                                            <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${isCorrect ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                                              {isCorrect ? 'Correct ✓' : `Incorrect (Correct Option: ${q.correctAnswer})`}
                                            </span>
                                          )}
                                        </div>

                                        <div className="font-semibold text-gray-800 text-sm">
                                          {q.question}
                                        </div>

                                        <div className="grid grid-cols-2 gap-3 text-xs pt-1">
                                          {q.options.map((opt: string, optIdx: number) => {
                                            const isSelected = selectedOpt === opt;
                                            const isCorrectOpt = opt === q.correctAnswer;
                                            let optStyle = "border-gray-200 hover:border-gray-300 bg-white text-gray-700 hover:bg-gray-50/50 cursor-pointer";

                                            if (isSubmitted) {
                                              if (isSelected) {
                                                optStyle = isCorrectOpt ? "border-green-600 bg-green-50 text-green-900 ring-2 ring-green-100" : "border-red-600 bg-red-50 text-red-900 ring-2 ring-red-100";
                                              } else if (isCorrectOpt) {
                                                optStyle = "border-green-400 bg-green-50/20 text-green-900";
                                              } else {
                                                optStyle = "border-gray-200 opacity-60 text-gray-400";
                                              }
                                            } else if (isSelected) {
                                              optStyle = "border-indigo-600 bg-indigo-50/30 text-indigo-900 ring-2 ring-indigo-100 font-medium cursor-pointer";
                                            }

                                            return (
                                              <div
                                                key={optIdx}
                                                onClick={() => {
                                                  if (!isSubmitted) {
                                                    setQuizStudentAnswers(prev => ({ ...prev, [idx]: opt }));
                                                  }
                                                }}
                                                className={`p-3 rounded-xl border transition-all duration-150 flex items-center justify-between ${optStyle}`}
                                              >
                                                <span>{opt}</span>
                                                {isSelected && (
                                                  isSubmitted ? (
                                                    isCorrectOpt ? <CheckCircle2 size={14} className="text-green-600 shrink-0" /> : <X size={14} className="text-red-600 shrink-0" />
                                                  ) : (
                                                    <div className="w-2 h-2 rounded-full bg-indigo-600 shadow-sm shrink-0" />
                                                  )
                                                )}
                                              </div>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </>
                              );
                                } catch (e) {
                                  return <div className="text-xs text-red-500 font-sans">Error parsing quiz structure.</div>;
                                }
                              })()}
                            </div>
                          ) : (
                            <div className={`flex-1 min-h-0 flex flex-col ${selectedAssignment.submission_status ? 'opacity-90 pointer-events-none filter grayscale-[0.2]' : ''}`}>
                              <LazyWhiteboard
lessonId={`assignment-${selectedAssignment.id}-student-${activeStudentId}`}
elements={elements}
userRole={activeRole}
enableAutoAI={activeRole === 'student' && !selectedAssignment.submission_status}
onElementAdd={async (type: string, data: any) => {
                                    await fetch(`/api/lessons/assignment-${selectedAssignment.id}-student-${activeStudentId}/whiteboard`, {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({ type, data })
                                    });
                                    fetchElements(`assignment-${selectedAssignment.id}-student-${activeStudentId}`);
                                  }}
onElementUpdate={async (elementId: string, data: any) => {
                                    await fetch(`/api/lessons/assignment-${selectedAssignment.id}-student-${activeStudentId}/whiteboard/${elementId}`, {
                                      method: 'PUT',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({ data })
                                    });
                                    fetchElements(`assignment-${selectedAssignment.id}-student-${activeStudentId}`);
                                  }}
onElementDelete={async (elementId: string) => {
                                    await fetch(`/api/lessons/assignment-${selectedAssignment.id}-student-${activeStudentId}/whiteboard/${elementId}`, {
                                      method: 'DELETE'
                                    });
                                    fetchElements(`assignment-${selectedAssignment.id}-student-${activeStudentId}`);
                                  }}
onClearBoard={async () => {
                                    await fetch(`/api/lessons/assignment-${selectedAssignment.id}-student-${activeStudentId}/whiteboard`, {
                                      method: 'DELETE'
                                    });
                                    fetchElements(`assignment-${selectedAssignment.id}-student-${activeStudentId}`);
                                  }}
onRefresh={() => fetchElements(`assignment-${selectedAssignment.id}-student-${activeStudentId}`)}
/>
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </div>
              </div>
            ) : (
              <StudentDashboardPanel
                students={students}
                activeStudentId={activeStudentId}
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
              />
            )}
          </div>
        ) : (
          <div className="flex-1 overflow-hidden flex bg-gray-50">
            <NavigationSidebar
              mainNavCollapsed={mainNavCollapsed}
              setMainNavCollapsed={setMainNavCollapsed}
              teacherTab={teacherTab}
              setTeacherTab={setTeacherTab}
              lang={lang}
              session={session}
              todaySchedules={todaySchedules}
            />

            <div className="flex-1 p-6 overflow-hidden flex gap-6 relative">

            {/* Phase 9: Dynamic plugin tab content — catch-all for non-hardcoded tabs */}
            {['dashboard', 'lesson_editor', 'live_class', 'plugins', 'courses', 'classes',
              'timetable', 'admin_directory', 'help', 'computer_labs'].includes(teacherTab) ? null : (
              <PluginTabPanel activeNavPlugin={teacherTab.includes('/') ? teacherTab.split('/')[0] : null} />
            )}

            {teacherTab === 'dashboard' ? (
              <Dashboard
                lang={lang} t={t}
                lessons={lessons} classes={classes} students={students}
                todaySchedules={todaySchedules}
                approvals={approvals} processes={processes}
                isApprovalsCollapsed={isApprovalsCollapsed}
                setIsApprovalsCollapsed={setIsApprovalsCollapsed}
                isProcessesCollapsed={isProcessesCollapsed}
                setIsProcessesCollapsed={setIsProcessesCollapsed}
                scoreOverrides={scoreOverrides} setScoreOverrides={setScoreOverrides}
                handleApprove={handleApprove} handleReject={handleReject}
                showLogs={showLogs} setShowLogs={setShowLogs}
                processLogsContent={processLogsContent}
                showProcessLogs={showProcessLogs}
                fetchProcessLogs={fetchProcessLogs}
                setShowProcessLogs={setShowProcessLogs}
                addToast={addToast}
                handleQuickScheduleClass={handleQuickScheduleClass}
                handleQuickGenerateAssignment={handleQuickGenerateAssignment}
                handleQuickCreateLesson={handleQuickCreateLesson}
              />
            ) : teacherTab === 'lesson_editor' ? (
              <LessonEditorView
                lang={lang}
                lessons={lessons}
                selectedLesson={selectedLesson}
                activeRole={activeRole}
                setActiveRole={setActiveRole}
                editorSaveStatus={editorSaveStatus}
                setEditorSaveStatus={setEditorSaveStatus}
                editorLastSavedTime={editorLastSavedTime}
                setEditorLastSavedTime={setEditorLastSavedTime}
                setIsLessonPreviewVisible={setIsLessonPreviewVisible}
                setPreviewLessonTab={setPreviewLessonTab}
                setPreviewSelectedCourseware={setPreviewSelectedCourseware}
                setTeacherTab={setTeacherTab}
                handlePaletteActivate={handlePaletteActivate}
                timelineSegments={timelineSegments}
                activeSegmentId={activeSegmentId}
                setActiveSegmentId={setActiveSegmentId}
                draggedSegmentIdx={draggedSegmentIdx}
                setDraggedSegmentIdx={setDraggedSegmentIdx}
                saveTimeline={saveTimeline}
                editorPanelsExpanded={editorPanelsExpanded}
                setEditorPanelsExpanded={setEditorPanelsExpanded}
                fetchElements={fetchElements}
                whiteboardRef={whiteboardRef}
                elements={elements}
                paletteEdit={paletteEdit}
                handlePaletteConfirm={handlePaletteConfirm}
                setPaletteEdit={setPaletteEdit}
              />
) : teacherTab === 'live_class' ? (
              <div className="flex-grow flex-1 flex flex-col min-h-0 min-w-0">
                <LiveClassroomView
                  selectedLesson={selectedLesson}
                  setSelectedLesson={setSelectedLesson}
                  lessons={lessons}
                  classes={classes}
                  students={liveClassSelectedClassId ? (classStudentsMap[liveClassSelectedClassId] || []) : []}
                  plugins={plugins}
                  lang={lang}
                  timelineSegments={timelineSegments}
                  activeSegmentId={activeSegmentId}
                  setActiveSegmentId={setActiveSegmentId}
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
                  elements={elements}
                  fetchElements={fetchElements}
                  fetchStudents={async () => {
                    await fetchStudents();
                    if (liveClassSelectedClassId) {
                      await fetchClassStudents(liveClassSelectedClassId);
                    }
                  }}
                  addToast={addToast}
                  onlineStudentIds={onlineStudentIds}
                  activeStudentLessons={activeStudentLessons}
                  liveClassStudentProgress={liveClassStudentProgress}
                  onPingStudent={(studentId, message) => {
                    if (socketRef.current) {
                      socketRef.current.emit('teacher-ping-student', {
                        studentId,
                        lessonId: selectedLesson,
                        message
                      });
                    }
                  }}
                  onOpenCoursewareHub={() => setShowCoursewareHub(true)}
                  activeRole={activeRole}
                  setActiveRole={setActiveRole}
                />
              </div>
            ) : teacherTab === 'plugins' ? (
              <PluginView
                plugins={plugins} lang={lang}
                storeTab={storeTab} setStoreTab={setStoreTab}
                pluginCode={pluginCode} setPluginCode={setPluginCode}
                installingPlugin={installingPlugin}
                onInstall={handleInstallPlugin} onZipUpload={handleZipPluginUpload}
                onToggle={handleTogglePlugin} onDelete={handleDeletePlugin}
              />
            ) : teacherTab === 'courses' ? (
              <CourseManagement
                lang={lang}
                lessons={lessons}
                lessonsSearchQuery={lessonsSearchQuery}
                setLessonsSearchQuery={setLessonsSearchQuery}
                lessonsSortOrder={lessonsSortOrder}
                setLessonsSortOrder={setLessonsSortOrder}
                filteredLessons={filteredAndSortedLessons}
                onOpenImportLessons={() => {
                  setImportStatus('idle'); setImportProgress(0); setImportProgressTotal(0);
                  setImportErrorMsg(''); setPreviewImportData([]); setIsImportLessonsOpen(true);
                }}
                onOpenCourseWizard={() => { setWizardStep(1); setIsCourseWizardOpen(true); }}
                onViewCourse={(lessonId) => { setTeacherTab('lesson_editor'); setSelectedLesson(lessonId); }}
              />
            ) : teacherTab === 'classes' ? (
              <ClassesView
                t={t}
                lang={lang}
                classes={classes}
                students={students}
                lessons={lessons}
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
                setSelectedAssignment={setSelectedAssignment}
                setStudentViewStatus={setStudentViewStatus}
                setActiveRole={setActiveRole}
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
              />
            ) : teacherTab === 'timetable' ? (
              <TimetableView classes={classes} lessons={lessons} lang={lang} onSchedulesUpdated={fetchTodaySchedules} />
            ) : teacherTab === 'admin_directory' ? (
              <AdminDirectoryView
                session={session}
                lang={lang}
                onLogout={handleLogout}
                aiProviders={aiProviders}
                testingProviderId={testingProviderId}
                onAIProvidersChanged={fetchAIProviders}
                onTriggerTour={() => setIsTourOpen(true)}
                siteInfo={siteInfo}
                onSiteInfoChanged={setSiteInfo}
              />
            ) : teacherTab === 'computer_labs' ? (
              <ComputerLabView computerLabs={computerLabs} onRefresh={fetchLabs} lang={lang} />
            ) : teacherTab === 'help' ? (
              <HelpView
                registeredCommands={registeredCommands}
                onRefresh={fetchRegisteredCommands}
              />
            ) : null}


          </div>

        </div>
        )}
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

      {/* Manual Import Classes & Students Modal */}
      <ImportModal show={showImportModal} onClose={() => setShowImportModal(false)} lang={lang} handleImportFile={handleImportFile} importError={importError} importSuccess={importSuccess} isImporting={isImporting} downloadCSVTemplate={downloadCSVTemplate} />

      {/* Handheld Interactive Manual Course Creation Wizard Modal */}
      {isCourseWizardOpen && (
        <div className="fixed inset-0 bg-gray-900/50 backdrop-blur-sm flex items-center justify-center p-4 md:p-6 z-50 overflow-y-auto text-gray-850">
          <motion.div
            initial={{ opacity: 0, y: 15, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            className="bg-white border text-gray-900 border-gray-250 rounded-2xl shadow-2xl w-full max-w-4xl flex flex-col overflow-hidden max-h-[92vh] font-sans text-left"
          >
            {/* Wizard Header */}
            <div className="p-4 md:p-5 border-b border-gray-100 flex items-center justify-between bg-slate-50 shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-indigo-50 border border-indigo-100 rounded-lg text-indigo-650">
                  <BookOpen size={20} className="animate-pulse" />
                </div>
                <div>
                  <h2 className="font-bold text-gray-850 text-base md:text-lg">
                    {lang === 'zh' ? '⭐ 互动课程发布与时间轴向导' : '⭐ Course Design Guide & Wizard'}
                  </h2>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {lang === 'zh' ? '遵循系统设计法，逐步构建您的学科专属教案与课堂时间轴流程。' : 'Follow best practices to define curriculum content, timeline segments, and deploy.'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsCourseWizardOpen(false)}
                className="text-gray-400 hover:text-gray-650 font-bold p-1 rounded-lg hover:bg-gray-150 transition-all text-xl leading-none"
              >
                &times;
              </button>
            </div>

            {/* Steps Navigation Bar */}
            <div className="px-6 py-4.5 border-b border-gray-50 bg-slate-50/50 flex items-center justify-between gap-2 shrink-0 select-none">
              {[
                { step: 1, zh: '1内容选题', en: '1 Background' },
                { step: 2, zh: '2课堂脉络', en: '2 Timeslots' },
                { step: 3, zh: '3编写大纲', en: '3 Syllabus' },
                { step: 4, zh: '4总览部署', en: '4 Deploy' }
              ].map((s, idx) => {
                const isActive = wizardStep === s.step;
                const isCompleted = wizardStep > s.step;
                return (
                  <React.Fragment key={s.step}>
                    <div 
                      onClick={() => !wizardIsSubmitting && setWizardStep(s.step)}
                      className={`flex items-center gap-2 cursor-pointer transition-all ${
                        isActive 
                          ? 'text-indigo-650 font-boldScale' 
                          : isCompleted 
                            ? 'text-emerald-600 font-medium' 
                            : 'text-gray-400 hover:text-gray-600'
                      }`}
                    >
                      <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] border ${
                        isActive 
                          ? 'bg-indigo-600 border-indigo-600 text-white shadow-xs font-bold' 
                          : isCompleted
                            ? 'bg-emerald-50 border-emerald-500 text-emerald-600 font-bold'
                            : 'bg-white border-gray-250 text-gray-500'
                      }`}>
                        {isCompleted ? '✓' : s.step}
                      </div>
                      <span className="text-xs font-semibold hidden sm:inline">
                        {lang === 'zh' ? s.zh : s.en}
                      </span>
                    </div>
                    {idx < 3 && (
                      <div className={`flex-1 h-0.5 max-w-[40px] md:max-w-none transition-all ${wizardStep > s.step ? 'bg-emerald-500' : 'bg-gray-200'}`} />
                    )}
                  </React.Fragment>
                );
              })}
            </div>

            {/* Step Contents */}
            <div className="flex-grow overflow-y-auto p-5 md:p-6 space-y-5">
              
              {/* STEP 1: Basic Information */}
              {wizardStep === 1 && (
                <div className="space-y-4 animate-in fade-in duration-200 text-left">
                  <div className="bg-indigo-50/70 py-3.5 px-4.5 rounded-xl border border-indigo-100 text-xs text-indigo-750 font-sans leading-relaxed flex items-start gap-2">
                    <Sparkles size={16} className="text-indigo-500 shrink-0 mt-0.5 animate-bounce" />
                    <div>
                      <strong>{lang === 'zh' ? '设计理念：' : 'Instructional ConceptTip:'}</strong>
                      <p className="mt-0.5">
                        {lang === 'zh' 
                          ? '一个高品质的课程往往始于明确的选题背景。选择适当的学科科目分类，系统不仅会按您的选择在后续步骤推荐量身定做的教案摸板，还可以一键预装适合该学科的课堂互动时间轴模板。' 
                          : 'Selecting a clear title and specific subject category helps pre-populate customized Markdown content outlines and specialized scheduling presets.'}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6 font-sans">
                    <div className="md:col-span-2 space-y-4">
                      <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                          {lang === 'zh' ? '📍 课程/课件名称 *' : '📍 Course Title *'}
                        </label>
                        <input
                          type="text"
                          required
                          value={wizardCourseTitle}
                          onChange={e => setWizardCourseTitle(e.target.value)}
                          placeholder={lang === 'zh' ? '例：西方哲学：康德的三大批判、Python编程入门、高中物理电路并联原理' : 'e.g. Introduction to regressions, Western Philosophies, Lever Principles'}
                          className="w-full px-4 py-3 border border-gray-250 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-800 text-sm shadow-xs"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                          {lang === 'zh' ? '🎯 课程设计简介与要点说明 (Objectives)' : '🎯 Description & Lesson Objectives'}
                        </label>
                        <textarea
                          rows={4}
                          value={wizardCourseDescription}
                          onChange={e => setWizardCourseDescription(e.target.value)}
                          placeholder={lang === 'zh' ? '在此处编写您的授课背景、面向学段及最关键的 2-3 个核心教学总目标。' : 'Write a short description stating learning outcomes and student prerequisite goals.'}
                          className="w-full p-4 border border-gray-255 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-800 text-sm shadow-xs resize-none"
                        />
                      </div>
                    </div>

                    <div className="col-span-1 border-l border-gray-100 md:pl-6 space-y-4 text-left">
                      <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                          {lang === 'zh' ? '🎨 学部科目分类' : '🎨 Subject Category'}
                        </label>
                        <select
                          value={wizardCourseCategory}
                          onChange={e => {
                            setWizardCourseCategory(e.target.value);
                          }}
                          className="w-full bg-white border border-gray-250 text-gray-755 font-bold px-3 py-2.5 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-xs text-sm cursor-pointer"
                        >
                          <option value="Mathematics">{lang === 'zh' ? '📐 基础数学与几何' : '📐 Mathematics'}</option>
                          <option value="ComputerScience">{lang === 'zh' ? '💻 计算机软件与人工智能' : '💻 Computer Science'}</option>
                          <option value="Literature">{lang === 'zh' ? '✍️ 语言文字与阅读理解' : '✍️ Literature & Writing'}</option>
                          <option value="Physics">{lang === 'zh' ? '⚡ 物理实验与自然探索' : '⚡ Physics & Science'}</option>
                          <option value="History">{lang === 'zh' ? '🏛️ 历史脉络与人地分析' : '🏛️ History & Humanities'}</option>
                          <option value="Art">{lang === 'zh' ? '🎨 交互设计与先锋创意艺术' : '🎨 Visual Arts & Design'}</option>
                          <option value="Other">{lang === 'zh' ? '🔮 交叉素养与综合学习' : '🔮 General & Other'}</option>
                        </select>
                      </div>

                      <div className="bg-slate-50 p-4 rounded-xl border border-gray-100 space-y-2 select-none text-left">
                        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">{lang === 'zh' ? '科目时间轴专家建议' : 'SUBJECT HEURISTICS'}</span>
                        <div className="text-xs text-gray-600 leading-relaxed font-sans mt-1">
                          {wizardCourseCategory === 'Mathematics' && (lang === 'zh' ? '💡 数学：偏向理论推演。推荐 20分公式精讲 + 15分黑板实践互动，强化基础。' : '💡 Math recommends: 20m Core Lecture + 15m Practice for theorem grounding.')}
                          {wizardCourseCategory === 'ComputerScience' && (lang === 'zh' ? '💡 计算机：偏重编码体验。推荐 15分白板代码推演 + 20分终端实验与分享。' : '💡 CS recommends: 15m Algorithms + 20m Interactive workshops on virtual boards.')}
                          {wizardCourseCategory === 'Literature' && (lang === 'zh' ? '💡 语文文学：注重文本深度。推荐 10分范文研习 + 20分分组思辨，提升理解。' : '💡 Lit recommends: 10m Reading Analysis + 20m Collaborative Discussions.')}
                          {wizardCourseCategory === 'Physics' && (lang === 'zh' ? '💡 科学类：逻辑导向。推荐 10分虚拟视频实验 + 20分机理讲解 + 10分钟随堂答卷。' : '💡 Science recommends: 10m virtual showcase + 20m principles + 10m evaluation.')}
                          {wizardCourseCategory === 'History' && (lang === 'zh' ? '💡 历史人文：情景引入。推荐 15分人文画卷重塑 + 15分史实论驳辩论。' : '💡 History recommends: 15m Context Mapping + 15m Interactive Debate panels.')}
                          {wizardCourseCategory === 'Art' && (lang === 'zh' ? '💡 视觉创意：自由度高。推荐 10分美术鉴赏 + 25分白板手绘画布互动体验。' : '💡 Art recommends: 10m Aesthetics inspiration + 25m real-time board drawing.')}
                          {wizardCourseCategory === 'Other' && (lang === 'zh' ? '💡 其他科目：均分各小节时间，循序渐进，打造完整的教学循环闭环。' : '💡 Generic: Divide evenly into sequential warm-up, core presentation and quiz.')}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* STEP 2: Timeline Builder / Presets */}
              {wizardStep === 2 && (
                <div className="space-y-5 animate-in fade-in duration-200 text-left font-sans">
                  <div className="bg-emerald-50/40 py-3.5 px-4.5 rounded-xl border border-emerald-100 text-xs text-emerald-850 leading-relaxed flex items-start gap-2 text-left">
                    <Activity size={16} className="text-emerald-555 shrink-0 mt-0.5 animate-pulse" />
                    <div>
                      <strong>{lang === 'zh' ? '专家课堂时间轴预设：' : 'Dynamic Class Presets:'}</strong>
                      <p className="mt-0.5">
                        {lang === 'zh' 
                          ? '好的教授节奏必须动静相宜。以下提供三种国际领先的精品课件时间节点设计，点击即可一键刷装配置。您也可以在下方自由增删和重新指定每个环节的长短！' 
                          : 'Curating temporal context maximizes classroom retention. Load from predefined templates or tweak the active steps on the dynamic table.'}
                      </p>
                    </div>
                  </div>

                  {/* Template choices */}
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                      {lang === 'zh' ? '💡 点击应用典型课堂框架模板 (Quick Apply)' : '💡 Click to Auto-Apply Structure Presets'}
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      {[
                        {
                          id: 'preset_standard',
                          title: lang === 'zh' ? '经典 5-20-15-5 讲授模式' : 'Traditional Dual-Lecture Paradigm',
                          desc: lang === 'zh' ? '由浅入深：先通过场景导入，后精讲，接着在白板配合大屏进行演练。' : 'Perfect dynamic for most standard classes.',
                          segments: [
                            { id: 'seg-preset-1', title: 'Course Orientation / 课堂导入', type: 'intro', duration: '5m', color: 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100', notes: 'Warm up topic' },
                            { id: 'seg-preset-2', title: 'Subject Core Lecture / 核心理论精讲', type: 'lecture', duration: '20m', color: 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100', notes: 'Main content slide' },
                            { id: 'seg-preset-3', title: 'Interactive Lab Work / 随堂协同演练', type: 'practice', duration: '15m', color: 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100', notes: 'Exercises & questions' },
                            { id: 'seg-preset-4', title: 'Wrap up / 课堂成果总结与答疑', type: 'summary', duration: '5m', color: 'bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100', notes: 'Check answer notes' }
                          ]
                        },
                        {
                          id: 'preset_seminar',
                          title: lang === 'zh' ? '主题讨论工作坊模式' : 'Active Discussion Workshop',
                          desc: lang === 'zh' ? '协同探究：教师5分钟破冰，学生15分钟小组演练，15分钟对决汇报，10分钟定级。' : 'Discussion and presentation heavy layout.',
                          segments: [
                            { id: 'seg-preset-5', title: 'Debate Scenario Brief / 讨论情境简述', type: 'intro', duration: '5m', color: 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100', notes: 'Define debate metrics' },
                            { id: 'seg-preset-6', title: 'Cooperative Ideation / 精英白板协作设计', type: 'practice', duration: '15m', color: 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100', notes: 'Joint workspace analysis' },
                            { id: 'seg-preset-7', title: 'Student Team Presentation / 各小组交互汇报', type: 'lecture', duration: '15m', color: 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100', notes: 'Group screen sharing' },
                            { id: 'seg-preset-8', title: 'Review & Grade Feedback / 教师深度对标点评', type: 'summary', duration: '10m', color: 'bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100', notes: 'Score reviews' }
                          ]
                        },
                        {
                          id: 'preset_flipped',
                          title: lang === 'zh' ? '翻转课堂高强度训练' : 'Targeted Problem-Solving Sprint',
                          desc: lang === 'zh' ? '应试/解惑突破：10分钟温习，15分钟重难盲点攻坚，15分钟专项题演习。' : 'Perfect for exams and targeted training courses.',
                          segments: [
                            { id: 'seg-preset-9', title: 'Blind Spot Evaluation / 温史自学效果自测', type: 'intro', duration: '10m', color: 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100', notes: 'Scan quiz' },
                            { id: 'seg-preset-10', title: 'Advanced Principle Explores / 重难考点极限拆解', type: 'lecture', duration: '15m', color: 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100', notes: 'Analyse weak metrics' },
                            { id: 'seg-preset-11', title: 'Mock Solving Battle / 核心精选题实操对抗', type: 'practice', duration: '15m', color: 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100', notes: 'Sprint workout' },
                            { id: 'seg-preset-12', title: 'Anchor Recap / 知识网架构网节点固化', type: 'summary', duration: '5m', color: 'bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100', notes: 'Highlight checklist' }
                          ]
                        }
                      ].map(preset => (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => {
                            setWizardCourseTimeline(preset.segments);
                            addToast(
                              lang === 'zh' ? '预设已刷装' : 'Preset Configured',
                              lang === 'zh' ? `已将《${preset.title}》应用到您当前设计的课程中。` : `Assigned "${preset.title}" timeslots.`,
                              'success'
                            );
                          }}
                          className="bg-white border rounded-xl p-3 text-left transition-all hover:bg-indigo-50/20 hover:border-indigo-400 cursor-pointer active:scale-98"
                        >
                          <div className="font-bold text-gray-800 text-xs sm:text-sm">{preset.title}</div>
                          <div className="text-[10px] text-gray-400 mt-1.5 leading-relaxed">{preset.desc}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Customizable Interactive Grid */}
                  <div>
                    <div className="flex items-center justify-between mb-2 select-none">
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider">
                        {lang === 'zh' ? '📌 流程时间卡编辑 (拖拽或直接对表格字段赋值)' : '📌 Custom Timeslot Table (Edit fields directly)'}
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          const newSeg = {
                            id: `seg-w-custom-${Date.now()}`,
                            title: lang === 'zh' ? `自理授课阶段 ${wizardCourseTimeline.length + 1}` : `Interactive Step ${wizardCourseTimeline.length + 1}`,
                            type: 'practice',
                            duration: '10m',
                            color: 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100',
                            notes: ''
                          };
                          setWizardCourseTimeline([...wizardCourseTimeline, newSeg]);
                        }}
                        className="flex items-center gap-1 text-[11px] font-bold text-indigo-600 hover:text-indigo-800 cursor-pointer"
                      >
                        <Plus size={12} /> {lang === 'zh' ? '增设阶段' : 'Append Phase'}
                      </button>
                    </div>

                    <div className="space-y-2 border border-gray-150 rounded-xl p-3.5 bg-gray-50/50">
                      {wizardCourseTimeline.map((seg, idx) => (
                        <div 
                          key={seg.id} 
                          className="flex flex-col sm:flex-row items-center gap-3 bg-white border border-gray-200 rounded-lg p-2.5 shadow-xs"
                        >
                          <div className="flex items-center gap-2 w-full sm:w-auto">
                            <span className="w-5 h-5 rounded-full bg-slate-100 flex items-center justify-center text-[10px] text-gray-500 font-bold shrink-0">
                              {idx + 1}
                            </span>
                            <input
                              type="text"
                              value={seg.title}
                              onChange={(e) => {
                                const updated = [...wizardCourseTimeline];
                                updated[idx].title = e.target.value;
                                setWizardCourseTimeline(updated);
                              }}
                              className="font-bold text-xs text-gray-800 bg-transparent border-b border-transparent hover:border-gray-200 focus:border-indigo-500 py-0.5 px-1 focus:outline-none focus:bg-gray-50/50 rounded flex-1 sm:w-56"
                              placeholder="Phase Title"
                            />
                          </div>

                          <div className="flex items-center gap-2.5 w-full sm:w-auto justify-end sm:ml-auto">
                            <div className="flex items-center gap-1 bg-slate-50 border border-gray-200 rounded px-2 py-0.5 shrink-0">
                              <span className="text-[10px] font-bold text-gray-400">时长:</span>
                              <input
                                type="text"
                                value={seg.duration}
                                onChange={(e) => {
                                  const updated = [...wizardCourseTimeline];
                                  updated[idx].duration = e.target.value;
                                  setWizardCourseTimeline(updated);
                                }}
                                className="w-8 text-[11px] text-gray-800 font-extrabold bg-transparent text-center focus:outline-none"
                              />
                            </div>

                            <select
                              value={seg.type}
                              onChange={(e) => {
                                const val = e.target.value;
                                const updated = [...wizardCourseTimeline];
                                updated[idx].type = val;
                                if (val === 'intro') {
                                  updated[idx].color = 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100';
                                } else if (val === 'lecture') {
                                  updated[idx].color = 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100';
                                } else if (val === 'practice') {
                                  updated[idx].color = 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100';
                                } else if (val === 'summary') {
                                  updated[idx].color = 'bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100';
                                } else {
                                  updated[idx].color = 'bg-gray-50 text-gray-700 border-gray-205 hover:bg-gray-100';
                                }
                                setWizardCourseTimeline(updated);
                              }}
                              className="bg-slate-50 border border-gray-200 text-[10px] font-bold text-gray-600 rounded p-1 focus:outline-none cursor-pointer"
                            >
                              <option value="intro">{lang === 'zh' ? '温习 / 导入' : 'Warm-up / Intro'}</option>
                              <option value="lecture">{lang === 'zh' ? '主体 / 精讲' : 'Core Lecture'}</option>
                              <option value="practice">{lang === 'zh' ? '交互白板练习' : 'Practice Workshop'}</option>
                              <option value="summary">{lang === 'zh' ? '总结 / 定级' : 'Wrap-up / Recap'}</option>
                            </select>

                            <button
                              type="button"
                              onClick={() => {
                                if (wizardCourseTimeline.length <= 1) {
                                  alert(lang === 'zh' ? '请保留至少一个核心环节！' : 'At least one segment must exist.');
                                  return;
                                }
                                const updated = wizardCourseTimeline.filter((_, sIdx) => sIdx !== idx);
                                setWizardCourseTimeline(updated);
                              }}
                              className="text-gray-400 hover:text-rose-600 font-bold p-1 cursor-pointer text-sm select-none"
                              title="Delete this segment"
                            >
                              &times;
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="mt-2 text-[10px] text-right text-gray-500 font-mono select-none">
                      {lang === 'zh' ? '📈 环节累加公式：' : '📈 Dynamic aggregation formula: '} 
                      <span className="text-gray-800 font-semibold">{wizardCourseTimeline.map(s => s.duration).join(' + ')}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* STEP 3: Syllabus and materials */}
              {wizardStep === 3 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-in fade-in duration-200 font-sans text-left">
                  <div className="space-y-3 flex flex-col h-full min-h-[360px] text-left">
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-2">
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider select-none shrink-0">
                        {lang === 'zh' ? '✏️ 使用 Markdown 语法编写课时材料' : '✏️ Lesson Materials (Markdown)'}
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          const autofilled = generateTemplateContent(wizardCourseTitle, wizardCourseCategory);
                          setWizardCourseContent(autofilled);
                          addToast(
                            lang === 'zh' ? '大纲模板生成成功' : 'Curriculum Loaded',
                            lang === 'zh' ? '针对所选择的模型和属性已一键刷装教案模板框架。' : 'Prepopulated Markdown structure.',
                            'success'
                          );
                        }}
                        className="flex items-center gap-1 text-xs bg-indigo-50 border border-indigo-100 text-indigo-755 hover:bg-indigo-100 px-3 py-1 rounded-lg transition-colors font-bold cursor-pointer"
                      >
                        <Sparkles size={13} className="text-indigo-500 animate-spin" />
                        {lang === 'zh' ? '✨ 一键生成专家级教学大纲模版' : '✨ Autofill Outline Template'}
                      </button>
                    </div>

                    <textarea
                      rows={14}
                      value={wizardCourseContent}
                      onChange={e => setWizardCourseContent(e.target.value)}
                      placeholder={lang === 'zh' ? '# 西方哲学三大经典原理\n\n在此输入您的具体内容讲解、白板图形绘制节点、以及课后实践任务大纲...' : '# Course curriculum content'}
                      className="w-full flex-grow p-4 bg-slate-900 text-slate-100 border border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono text-xs shadow-inner leading-relaxed text-left"
                    />
                  </div>

                  {/* Material Live Preview */}
                  <div className="space-y-3 flex flex-col h-full border border-gray-150 rounded-xl bg-slate-50/50 p-4 text-left">
                    <span className="block text-xs font-bold text-gray-400 uppercase tracking-wider select-none shrink-0">
                      🖥️ {lang === 'zh' ? '大纲资料实时交互渲染' : 'Syllabus Live Context rendering'}
                    </span>
                    <div className="flex-grow overflow-y-auto bg-white border border-gray-150 rounded-lg p-4 text-xs font-sans text-gray-700 max-h-[380px] overflow-x-hidden text-left select-text">
                      {wizardCourseContent.trim() ? (
                        <div className="markdown-body">
                          <Markdown>{wizardCourseContent}</Markdown>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center h-full text-gray-400 italic py-16">
                          <BookOpen size={32} className="mb-2 opacity-20 text-indigo-500" />
                          <span>{lang === 'zh' ? '教案空无内容，等待输入或一键填充模板...' : 'Waiting for materials...'}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* STEP 4: Success Preview */}
              {wizardStep === 4 && (
                <div className="space-y-6 animate-in fade-in duration-200 text-center font-sans max-w-xl mx-auto py-3">
                  <div className="inline-flex p-3 bg-emerald-50 border border-emerald-100 text-emerald-500 rounded-full">
                    <CheckCircle2 size={36} className="animate-pulse text-emerald-555" />
                  </div>
                  <div>
                    <h3 className="font-extrabold text-gray-800 text-base md:text-lg">
                      {lang === 'zh' ? '🚀 互动课程已精心筹备成功！' : '🚀 Materials Generated successfully!'}
                    </h3>
                    <p className="text-xs text-gray-400 mt-1">
                      {lang === 'zh' ? '设计与时间轴逻辑全部检验合格。请在下方核验新课卡片，确认无误一键部署入 SQLite 内核数据库。' : 'Curriculum parameters are ready to boot inside the Secure Host.'}
                    </p>
                  </div>

                  {/* Course card preview */}
                  <div className="border border-indigo-200 rounded-2xl p-5 bg-linear-to-b from-indigo-50/20 to-white shadow-md text-left space-y-4">
                    <div className="flex items-center justify-between border-b border-indigo-50 pb-3 gap-2">
                      <div className="font-bold text-indigo-950 text-base sm:text-lg truncate">
                        {wizardCourseTitle || (lang === 'zh' ? '未指定课程主题' : 'Blank Topic')}
                      </div>
                      <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-extrabold bg-indigo-50 text-indigo-800 uppercase tracking-wide border border-indigo-150 shrink-0">
                        {wizardCourseCategory}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-4 text-xs">
                      <div>
                        <span className="text-gray-400 block tracking-wider text-[10px] font-bold">{lang === 'zh' ? '教研环节数' : 'TOTAL STEPS'}</span>
                        <span className="text-gray-800 font-extrabold text-sm block mt-1">
                          {wizardCourseTimeline.length} {lang === 'zh' ? '项教学环节' : 'slots'}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-400 block tracking-wider text-[10px] font-bold">{lang === 'zh' ? '发布载体引擎' : 'STORAGE MEDIUM'}</span>
                        <div className="flex items-center gap-1 text-emerald-650 font-extrabold text-sm mt-1">
                          <Database size={11} className="text-emerald-500" />
                          <span>SQLite DB</span>
                        </div>
                      </div>
                    </div>

                    <div className="bg-slate-50 border border-gray-150 p-3 rounded-lg text-[11px] text-gray-600 line-clamp-2 italic leading-relaxed text-left">
                      {wizardCourseDescription || (lang === 'zh' ? '无科目描述内容' : 'No description written.')}
                    </div>

                    {/* Progress map view */}
                    <div className="space-y-1.5 select-none">
                      <span className="text-[10px] font-extrabold text-gray-400 uppercase tracking-wider block">{lang === 'zh' ? '教学时间轴环流预览' : 'TIMELINE PROGRESS OVERVIEW'}</span>
                      <div className="flex items-center gap-1 w-full overflow-x-auto py-1">
                        {wizardCourseTimeline.map((seg, idx) => (
                          <React.Fragment key={seg.id}>
                            <div className={`px-2 py-1 text-[10px] font-bold rounded border truncate max-w-[120px] ${seg.color.split(' ')[0]}`}>
                              {seg.title.split(' / ')[0]} ({seg.duration})
                            </div>
                            {idx < wizardCourseTimeline.length - 1 && (
                              <ChevronRight size={11} className="text-gray-300" />
                            )}
                          </React.Fragment>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

            </div>

            {/* Footer controls */}
            <div className="p-4 border-t border-gray-105 bg-slate-50 flex justify-between items-center shrink-0">
              <span className="text-[11px] font-bold font-mono text-gray-400 uppercase select-none">
                {lang === 'zh' ? '⚙️ SQLITE 写入预检通过' : '⚙️ SQLITE VERIFICATION SUCCESS'}
              </span>
              <div className="flex items-center gap-2">
                {wizardStep > 1 && (
                  <button
                    type="button"
                    onClick={() => setWizardStep(prev => prev - 1)}
                    disabled={wizardIsSubmitting}
                    className="px-4 py-2 text-xs font-semibold border border-gray-200 text-gray-700 bg-white hover:bg-gray-50 rounded-lg transition-colors cursor-pointer select-none"
                  >
                    {lang === 'zh' ? '上一步' : 'Back'}
                  </button>
                )}
                {wizardStep < 4 ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (wizardStep === 1 && !wizardCourseTitle.trim()) {
                        alert(lang === 'zh' ? '请输入课程课题名称！' : 'Please type course title to proceed.');
                        return;
                      }
                      setWizardStep(prev => prev + 1);
                    }}
                    className="px-4.5 py-2 text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg shadow-sm flex items-center gap-1 cursor-pointer select-none"
                  >
                    {lang === 'zh' ? '继续前进' : 'Continue'}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleDeployWizardCourse}
                    disabled={wizardIsSubmitting}
                    className="px-5 py-2 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg shadow-md flex items-center gap-1.5 cursor-pointer disabled:opacity-50 select-none animate-bounce"
                  >
                    {wizardIsSubmitting ? (
                      <>
                        <Loader2 size={13} className="animate-spin" />
                        <span>{lang === 'zh' ? '写入底库中...' : 'Deploying...'}</span>
                      </>
                    ) : (
                      <>
                        <Database size={13} />
                        <span>{lang === 'zh' ? '部署并激活新课程' : 'Deploy & Activate'}</span>
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* Import Lessons from CSV Modal */}
      {isImportLessonsOpen && (
        <div className="fixed inset-0 bg-gray-900/50 backdrop-blur-sm flex items-center justify-center p-4 md:p-6 z-50 overflow-y-auto text-gray-850">
          <motion.div
            initial={{ opacity: 0, y: 15, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            className="bg-white border text-gray-900 border-gray-250 rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col overflow-hidden max-h-[90vh] font-sans text-left"
          >
            {/* Header */}
            <div className="p-4 md:p-5 border-b border-gray-100 flex items-center justify-between bg-slate-50 shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-indigo-50 border border-indigo-100 rounded-lg text-indigo-650">
                  <Upload size={20} className="animate-pulse" />
                </div>
                <div>
                  <h2 className="font-bold text-gray-850 text-base md:text-lg">
                    {lang === 'zh' ? '批量导入课程 (CSV)' : 'Bulk-Import Courses (CSV)'}
                  </h2>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {lang === 'zh' ? '上传包含标准表头的 CSV 教案，一键实现秒级批量底库写入。' : 'Upload a standard CSV file matching our predefined schema to perform instantaneous bulk curriculum imports.'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  if (importStatus !== 'importing') {
                    setIsImportLessonsOpen(false);
                  }
                }}
                disabled={importStatus === 'importing'}
                className="text-gray-400 hover:text-gray-650 font-bold p-1 rounded-lg hover:bg-gray-150 transition-all text-xl leading-none disabled:opacity-40"
              >
                &times;
              </button>
            </div>

            {/* Modal Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              
              {/* IDLE state -> Drag and Drop zone */}
              {importStatus === 'idle' && (
                <div className="space-y-4">
                  {/* Schema instructions */}
                  <div className="p-4 bg-indigo-50/50 border border-indigo-100 rounded-xl">
                    <h4 className="text-xs font-bold text-indigo-850 uppercase tracking-wide flex items-center gap-1">
                      <span>📌</span>
                      {lang === 'zh' ? '预定义数据格式说明' : 'Predefined Schema Information'}
                    </h4>
                    <p className="text-xs text-indigo-900 mt-1 leading-relaxed">
                      {lang === 'zh' 
                        ? 'CSV 文件的首行必须 define 列标题（分大小写且无多余空格），包含以下两项必需内容：' 
                        : 'Your CSV file must include exactly these header columns on the first row (case-insensitive):'}
                    </p>
                    <ul className="list-disc pl-5 mt-2 text-xs text-indigo-950 space-y-1">
                      <li><strong>title</strong>: {lang === 'zh' ? '课程名 (非空，例如 "代数几何")' : 'Course title (Required, e.g. "Linear Algebra")'}</li>
                      <li><strong>content</strong>: {lang === 'zh' ? '教学大纲 / Markdown 格式的课堂细目' : 'Syllabus content supporting rich markdown.'}</li>
                    </ul>
                    <div className="mt-3.5 flex justify-start">
                      <button
                        onClick={downloadCsvTemplate}
                        className="flex items-center gap-1 p-2 text-xs font-bold text-indigo-700 bg-white border border-indigo-200 rounded-lg shadow-3xs hover:bg-indigo-50 hover:-translate-y-0.5 hover:shadow-xs transition-all cursor-pointer"
                      >
                        <Download size={12} />
                        {lang === 'zh' ? '获取标准 CSV 模板' : 'Download Template CSV'}
                      </button>
                    </div>
                  </div>

                  {/* Drag-and-drop Dropzone */}
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      setIsDraggingImport(true);
                    }}
                    onDragLeave={() => setIsDraggingImport(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setIsDraggingImport(false);
                      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                        handleCSVFileChange(e.dataTransfer.files[0]);
                      }
                    }}
                    onClick={() => {
                      document.getElementById('import-csv-file-picker')?.click();
                    }}
                    className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all flex flex-col items-center justify-center min-h-[180px] ${
                      isDraggingImport
                        ? 'border-indigo-500 bg-indigo-50/70 scale-[1.01]'
                        : 'border-gray-250 bg-gray-50/50 hover:bg-gray-50 hover:border-indigo-400'
                    }`}
                  >
                    <input
                      id="import-csv-file-picker"
                      type="file"
                      accept=".csv"
                      className="hidden"
                      onChange={(e) => {
                        if (e.target.files && e.target.files[0]) {
                          handleCSVFileChange(e.target.files[0]);
                        }
                      }}
                    />
                    <div className="p-3 bg-gray-100 border border-gray-200 rounded-full text-indigo-600 mb-3 group-hover:scale-105 transition-all">
                      <Upload size={24} />
                    </div>
                    <span className="text-sm font-bold text-gray-800">
                      {lang === 'zh' ? '选择 CSV 文件或拖放至此处' : 'Click to select or drag and drop CSV file here'}
                    </span>
                    <span className="text-xs text-gray-400 mt-1">
                      {lang === 'zh' ? '支持标准 CSV 文件，最大不超过 5MB' : 'Supports standard CSV format up to 5MB'}
                    </span>
                  </div>
                </div>
              )}

              {/* PARSING state -> Show Preview of file */}
              {importStatus === 'parsing' && previewImportData.length > 0 && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">
                      ✓ {lang === 'zh' ? `解析成功：查找到 ${previewImportData.length} 门课程` : `Parsed Successfully: Found ${previewImportData.length} records`}
                    </span>
                    <button
                      onClick={() => {
                        setPreviewImportData([]);
                        setImportStatus('idle');
                      }}
                      className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold"
                    >
                      {lang === 'zh' ? '重新上传' : 'Upload Different File'}
                    </button>
                  </div>

                  <div className="border border-gray-200 rounded-xl overflow-hidden shadow-3xs max-h-[300px] overflow-y-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="bg-gray-50 text-gray-600 border-b border-gray-200 font-bold">
                        <tr>
                          <th className="p-3 w-1/4">{lang === 'zh' ? '课程名称' : 'Course Title'}</th>
                          <th className="p-3 w-3/4">{lang === 'zh' ? '大纲简介片段' : 'Syllabus Preview'}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 bg-white">
                        {previewImportData.map((row, rIdx) => (
                          <tr key={rIdx} className="hover:bg-slate-50/50">
                            <td className="p-3 font-semibold text-gray-800 align-top truncate max-w-[150px]" title={row.title}>
                              {row.title}
                            </td>
                            <td className="p-3 text-gray-500 font-mono text-[11px] leading-relaxed break-words col-span-2">
                              {row.content.length > 150 ? row.content.substring(0, 150) + '...' : row.content || <em className="text-gray-300 italic">None</em>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="bg-amber-50 border border-amber-100 text-amber-900 text-xs rounded-xl p-3 flex gap-2.5 items-start">
                    <span className="text-base leading-none">⚠️</span>
                    <p className="leading-relaxed">
                      {lang === 'zh' 
                        ? '请确认课程名称没有与系统已有的课程同名。确认无误后点击下方"开始导入"写入 SQLite。' 
                        : 'Please ensure column details are accurate. Clicking Import will instantly commit all parsed courses into the server SQLite backend.'}
                    </p>
                  </div>
                </div>
              )}

              {/* IMPORTING state -> Show beautiful step progress */}
              {importStatus === 'importing' && (
                <div className="py-8 flex flex-col items-center justify-center space-y-4">
                  <div className="relative w-20 h-20 flex items-center justify-center">
                    <Loader2 size={36} className="text-indigo-600 animate-spin" />
                    <span className="absolute text-[11px] font-extrabold text-indigo-700">
                      {Math.round((importProgress / importProgressTotal) * 100)}%
                    </span>
                  </div>
                  <div className="text-center">
                    <h3 className="font-bold text-gray-800 text-sm">
                      {lang === 'zh' ? '正在写入数据库' : 'Populating Database Records'}
                    </h3>
                    <p className="text-xs text-gray-500 mt-1">
                      {lang === 'zh' 
                        ? `正在导入第 ${importProgress} / ${importProgressTotal} 项...` 
                        : `Importing item ${importProgress} of ${importProgressTotal}...`}
                    </p>
                  </div>
                  <div className="w-full max-w-sm bg-gray-100 h-2 rounded-full overflow-hidden border border-gray-200">
                    <div 
                      className="bg-indigo-600 h-full transition-all duration-300 rounded-full" 
                      style={{ width: `${(importProgress / importProgressTotal) * 100}%` }}
                    />
                  </div>
                  <div className="w-full max-w-md bg-gray-50 rounded-xl p-3 border border-gray-150 font-mono text-[10px] text-gray-400 max-h-[140px] overflow-y-auto">
                    <div>{"[API] POST /api/lessons -> Request batch transaction..."}</div>
                    {previewImportData.slice(0, importProgress).map((p, idx) => (
                      <div key={idx} className="text-indigo-600 font-bold mt-1">
                        {`✓ [${idx+1}] "${p.title}" -> status 200 (Success)`}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* SUCCESS state -> Done */}
              {importStatus === 'success' && (
                <div className="py-8 text-center flex flex-col items-center justify-center space-y-4">
                  <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center border border-emerald-200 text-emerald-600 animate-bounce">
                    <CheckCircle2 size={32} />
                  </div>
                  <div>
                    <h3 className="font-bold text-gray-800 text-base">
                      {lang === 'zh' ? '🎉 批量导入大功告成' : '🎉 Bulk-Import Complete'}
                    </h3>
                    <p className="text-xs text-gray-500 mt-1 max-w-md mx-auto">
                      {lang === 'zh' 
                        ? `所有 ${previewImportData.length} 门学科教案数据已顺畅写入系统底层 SQLite 数据仓库，现在已可以用于备课。` 
                        : `All ${previewImportData.length} curriculum lessons records have been successfully saved into security logs and SQLite storage.`}
                    </p>
                  </div>
                </div>
              )}

              {/* ERROR state -> Display alerts */}
              {importStatus === 'error' && (
                <div className="space-y-4">
                  <div className="p-4 bg-rose-50 border border-rose-100 rounded-xl flex gap-3 items-start">
                    <span className="text-rose-600 font-bold text-lg leading-none">⚠️</span>
                    <div>
                      <h4 className="text-xs font-bold text-rose-850">
                        {lang === 'zh' ? '数据导入或解析中断' : 'Import or Parsing Error'}
                      </h4>
                      <p className="text-xs text-rose-900 mt-1 leading-relaxed">
                        {importErrorMsg || (lang === 'zh' ? '未知异常或文件破损。' : 'An unknown exception or corrupted CSV formatting occurred.')}
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-3 justify-end">
                    <button
                      onClick={() => {
                        setImportStatus('idle');
                        setImportErrorMsg('');
                      }}
                      className="px-4 py-2 text-xs font-bold text-gray-700 bg-white border border-gray-250 cursor-pointer hover:bg-gray-50 rounded-lg transition-all"
                    >
                      {lang === 'zh' ? '返回重试' : 'Go Back & Retry'}
                    </button>
                    <button
                      onClick={() => setIsImportLessonsOpen(false)}
                      className="px-4 py-2 text-xs font-bold text-white bg-indigo-600 cursor-pointer hover:bg-indigo-700 rounded-lg transition-all"
                    >
                      {lang === 'zh' ? '关闭窗口' : 'Close'}
                    </button>
                  </div>
                </div>
              )}

            </div>

            {/* Footer */}
            {importStatus !== 'idle' && importStatus !== 'error' && (
              <div className="p-4 md:p-5 border-t border-gray-100 flex items-center justify-between bg-slate-50 shrink-0">
                <button
                  onClick={() => {
                    setPreviewImportData([]);
                    setImportStatus('idle');
                  }}
                  disabled={importStatus === 'importing'}
                  className="px-4 py-2 text-xs font-bold text-gray-650 bg-white border border-gray-200 hover:bg-gray-100 rounded-lg transition-all disabled:opacity-40 cursor-pointer"
                >
                  {lang === 'zh' ? '重置重选' : 'Reset & Clear'}
                </button>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setIsImportLessonsOpen(false)}
                    disabled={importStatus === 'importing'}
                    className="px-4 py-2 text-xs font-bold text-gray-600 hover:text-gray-800 transition-all disabled:opacity-40 cursor-pointer"
                  >
                    {lang === 'zh' ? '取消' : 'Cancel'}
                  </button>
                  {importStatus === 'parsing' && (
                    <button
                      onClick={handleCSVImportSubmit}
                      className="px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm transition-all flex items-center gap-1 cursor-pointer"
                    >
                      <Check size={12} />
                      {lang === 'zh' ? `开始导入 (${previewImportData.length} 类)` : `Proceed and Import (${previewImportData.length})`}
                    </button>
                  )}
                  {importStatus === 'success' && (
                    <button
                      onClick={() => setIsImportLessonsOpen(false)}
                      className="px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm transition-all cursor-pointer"
                    >
                      {lang === 'zh' ? '完成' : 'Done'}
                    </button>
                  )}
                </div>
              </div>
            )}

          </motion.div>
        </div>
      )}

      {/* Enhanced AI Quiz Generator Modal */}
      {isQuizGeneratorOpen && (

        <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm flex items-center justify-center p-6 z-50 overflow-y-auto text-gray-850">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="bg-white border text-gray-900 border-gray-200 rounded-2xl shadow-2xl w-full max-w-3xl flex flex-col overflow-hidden max-h-[90vh]"
          >
            {/* Modal Header */}
            <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/80 shrink-0">
              <div className="flex items-center gap-3">
                <Wand2 className="text-indigo-600 animate-pulse" size={20} />
                <h2 className="font-bold text-gray-800 text-lg">AI-Objective Quiz Generator</h2>
              </div>
              <button 
                onClick={() => setIsQuizGeneratorOpen(false)} 
                className="text-gray-400 hover:text-gray-600 font-bold p-1 hover:bg-gray-200 rounded transition-colors"
              >
                &times;
              </button>
            </div>

            {/* Modal Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Step 1: Mode Configuration */}
              {suggestedQuestions.length === 0 && (
                <div className="space-y-4">
                  <div className="bg-indigo-50/80 p-4 rounded-xl border border-indigo-100 text-xs text-indigo-800 leading-relaxed font-sans">
                    Choose a lesson to scan. Our advanced AI model will run a deep semantic scan across the entire lesson curriculum content, discover your core learning objectives, and construct interactive multiple-choice questions aligning precisely with each of them.
                  </div>

                  <div className="font-sans">
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                      Scan Core Selection Mode
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        onClick={() => setQuizGenMode('scan_lesson')}
                        className={`p-3 rounded-lg border text-left flex flex-col transition-all ${quizGenMode === 'scan_lesson' ? 'border-indigo-600 bg-indigo-50/40 ring-2 ring-indigo-100' : 'border-gray-200 hover:border-gray-300'}`}
                      >
                        <span className="font-semibold text-sm text-indigo-900">Curriculum Lesson Scanning</span>
                        <span className="text-[10px] text-gray-500 mt-1">Examines real Markdown content inside virtual lesson modules.</span>
                      </button>
                      <button
                        onClick={() => setQuizGenMode('topic')}
                        className={`p-3 rounded-lg border text-left flex flex-col transition-all ${quizGenMode === 'topic' ? 'border-indigo-600 bg-indigo-50/40 ring-2 ring-indigo-100' : 'border-gray-200 hover:border-gray-300'}`}
                      >
                        <span className="font-semibold text-sm text-indigo-900">Custom Keyword / Topic</span>
                        <span className="text-[10px] text-gray-500 mt-1">Provide a custom prompt keyword or objective manually.</span>
                      </button>
                    </div>
                  </div>

                  {quizGenMode === 'scan_lesson' ? (
                    <div className="font-sans">
                      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                        Select Lesson to Scan
                      </label>
                      {lessons.length === 0 ? (
                        <div className="text-gray-500 text-xs py-3 border rounded border-dashed text-center">
                          No lessons available. Please create a lesson first.
                        </div>
                      ) : (
                        <select
                          value={quizGenSelectedLessonId}
                          onChange={(e) => setQuizGenSelectedLessonId(e.target.value)}
                          className="w-full p-2.5 bg-white border border-gray-200 rounded-lg text-sm text-gray-800 focus:border-indigo-500 focus:outline-none shadow-sm"
                        >
                          <option value="">-- Choose a lesson --</option>
                          {lessons.map((lesson) => (
                            <option key={lesson.id} value={lesson.id}>
                              {lesson.title}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  ) : (
                    <div className="font-sans">
                      <label className="block text-xs font-semibold text-gray-505 uppercase tracking-wider mb-2">
                        Custom Topic Prompt
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Introduction to React state, Cloud SQL setup..."
                        value={quizGenTopic}
                        onChange={(e) => setQuizGenTopic(e.target.value)}
                        className="w-full p-2.5 bg-white border border-gray-200 rounded-lg text-sm focus:border-indigo-500 focus:outline-none shadow-sm text-gray-800"
                      />
                    </div>
                  )}

                  <div className="pt-4 flex justify-end font-sans">
                    <button
                      disabled={isGeneratingSuggestions || (quizGenMode === 'scan_lesson' && !quizGenSelectedLessonId) || (quizGenMode === 'topic' && !quizGenTopic.trim())}
                      onClick={async () => {
                        setIsGeneratingSuggestions(true);
                        try {
                          if (quizGenMode === 'scan_lesson') {
                            const res = await fetch(`/api/classes/${quizGeneratorClassId}/assignments/suggest`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ lessonId: quizGenSelectedLessonId })
                            });
                            if (res.ok) {
                              const data = await res.json();
                              setSuggestedObjectives(data.learningObjectives || []);
                              setSuggestedQuestions((data.questions || []).map((q: any) => ({ ...q, selected: true })));
                            } else {
                              alert('Error generating suggestions. Please make sure the selected lesson has content.');
                            }
                          } else {
                            const res = await fetch(`/api/classes/${quizGeneratorClassId}/assignments/generate`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ topic: quizGenTopic })
                            });
                            if (res.ok) {
                              await fetchClassDashboard(quizGeneratorClassId!);
                              setIsQuizGeneratorOpen(false);
                            } else {
                              alert('Error generating topic quiz.');
                            }
                          }
                        } catch (err: any) {
                          console.error(err);
                          alert(err.message);
                        } finally {
                          setIsGeneratingSuggestions(false);
                        }
                      }}
                      className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg font-medium text-xs shadow transition flex items-center gap-2"
                    >
                      {isGeneratingSuggestions ? (
                        <>
                          <Loader2 size={16} className="animate-spin" />
                          <span>AI Scanning Content...</span>
                        </>
                      ) : (
                        <>
                          <Wand2 size={16} />
                          <span>Generate Key MCQ Quiz</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* Step 2: Display and Approve Suggestions */}
              {suggestedQuestions.length > 0 && (
                <div className="space-y-6">
                  {/* Learning Objectives Found */}
                  <div className="font-sans">
                    <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                      Identified Core Objectives
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {suggestedObjectives.map((obj, i) => (
                        <span key={i} className="px-2.5 py-1 bg-teal-50 text-teal-800 border border-teal-200 rounded-full text-xs font-semibold">
                          🎯 {obj}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* MCQ Questions Display */}
                  <div className="space-y-4 font-sans">
                    <div className="text-xs font-bold text-gray-500 uppercase tracking-wider font-semibold">
                      Suggested MCQ Questions
                    </div>
                    <div className="space-y-3">
                      {suggestedQuestions.map((q, idx) => (
                        <div key={idx} className="p-4 rounded-xl border border-gray-150 bg-gray-50/50 hover:bg-gray-50 transition space-y-3 text-gray-800 text-gray-850">
                          <div className="flex items-start justify-between">
                            <div className="flex items-center gap-2">
                              <span className="w-5 h-5 rounded-full bg-indigo-150 text-indigo-700 flex items-center justify-center text-xs font-bold shrink-0">
                                {idx + 1}
                              </span>
                              <span className="text-[10px] font-semibold text-teal-700 bg-teal-50 px-2.5 py-0.5 rounded border border-teal-100">
                                objective: {q.objective}
                              </span>
                            </div>
                            <input
                              type="checkbox"
                              checked={!!q.selected}
                              onChange={(e) => {
                                const copy = [...suggestedQuestions];
                                copy[idx].selected = e.target.checked;
                                setSuggestedQuestions(copy);
                              }}
                              className="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
                            />
                          </div>
                          
                          <p className="font-semibold text-gray-800 text-sm leading-relaxed">{q.question}</p>
                          
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            {q.options.map((opt: string, optIdx: number) => {
                              const isCorrect = opt === q.correctAnswer;
                              return (
                                <div key={optIdx} className={`p-2 rounded border flex items-center justify-between ${isCorrect ? 'bg-green-50 border-green-200 text-green-955 font-semibold' : 'bg-white border-gray-100 text-gray-700'}`}>
                                  <span>{opt}</span>
                                  {isCorrect && <CheckCircle2 size={12} className="text-green-600 shrink-0" />}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="pt-4 border-t border-gray-100 flex justify-between items-center font-sans">
                    <button
                      onClick={() => {
                        setSuggestedObjectives([]);
                        setSuggestedQuestions([]);
                      }}
                      className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-xs font-semibold transition"
                    >
                      Back / Scan New
                    </button>

                    <div className="flex items-center gap-2 border border-indigo-150 bg-indigo-50/50 px-3 py-1.5 rounded-lg text-xs font-semibold text-indigo-900">
                      <span>⏱️ Quiz Time Limit:</span>
                      <select
                        value={quizGenTimeLimit}
                        onChange={(e) => setQuizGenTimeLimit(Number(e.target.value))}
                        className="bg-transparent text-xs text-indigo-950 font-bold focus:outline-none cursor-pointer"
                      >
                        <option className="text-gray-800" value={0}>No Limit</option>
                        <option className="text-gray-800" value={1}>1 Min</option>
                        <option className="text-gray-800" value={2}>2 Mins</option>
                        <option className="text-gray-800" value={5}>5 Mins</option>
                        <option className="text-gray-800" value={10}>10 Mins</option>
                        <option className="text-gray-800" value={15}>15 Mins</option>
                        <option className="text-gray-800" value={20}>20 Mins</option>
                        <option className="text-gray-800" value={30}>30 Mins</option>
                        <option className="text-gray-800" value={45}>45 Mins</option>
                        <option className="text-gray-800" value={60}>60 Mins</option>
                      </select>
                    </div>

                    <button
                      disabled={savingQuiz || suggestedQuestions.filter(q => q.selected).length === 0}
                      onClick={async () => {
                        setSavingQuiz(true);
                        try {
                          const activeLesson = lessons.find(l => l.id === quizGenSelectedLessonId);
                          const lessonTitle = activeLesson ? activeLesson.title : (quizGenTopic || 'Custom Objective');
                          const res = await fetch(`/api/classes/${quizGeneratorClassId}/assignments/create-suggested-quiz`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              title: `MCQ Evaluation: ${lessonTitle}`,
                              description: `Automatic evaluation based on core learning objectives.`,
                              questions: suggestedQuestions.filter(q => q.selected).map(({ selected, ...rest }) => rest),
                              learningObjectives: suggestedObjectives,
                              timeLimit: quizGenTimeLimit
                            })
                          });
                          if (res.ok) {
                            await fetchClassDashboard(quizGeneratorClassId!);
                            setIsQuizGeneratorOpen(false);
                          } else {
                            alert('Failed to save suggested quiz.');
                          }
                        } catch (err: any) {
                          console.error(err);
                          alert(err.message);
                        } finally {
                          setSavingQuiz(false);
                        }
                      }}
                      className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium text-xs shadow hover:shadow-md transition flex items-center gap-2"
                    >
                      {savingQuiz ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                      <span>Create Assessment Quiz</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}

      {/* Immersive Student Perspective Preview Modal */}
      {isLessonPreviewVisible && (
        <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm flex items-center justify-center p-4 md:p-6 z-[60] overflow-hidden text-gray-850">
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            className="bg-white border text-gray-900 border-gray-200 rounded-2xl shadow-2xl w-full max-w-7xl h-[90vh] flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-indigo-50/70 shrink-0 select-none">
              <div className="flex items-center gap-3">
                <div className="bg-indigo-600 text-white p-2 rounded-lg shadow-sm">
                  <Eye size={18} />
                </div>
                <div>
                  <h2 className="font-bold text-gray-900 text-base flex items-center gap-2">
                    学生视角预览 (Student Perspective Preview)
                  </h2>
                  <p className="text-xs text-gray-500 mt-0.5">
                    正在预览课程: <span className="font-semibold text-gray-700">{lessons.find(l => l.id === selectedLesson)?.title}</span> • 演示同步与交互
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsLessonPreviewVisible(false)}
                className="px-3.5 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-600 hover:text-gray-800 text-xs font-semibold rounded-lg shadow-sm transition-all cursor-pointer flex items-center gap-1 border border-gray-200"
              >
                <X size={14} /> 退出预览
              </button>
            </div>

            {/* Split Workspace */}
            <div className="flex-1 flex min-h-0 bg-slate-50/50 p-4 gap-4">
              {/* Left Column: Lesson markdown course materials */}
              <div className={`${previewFullscreenPanel === 'left' ? 'w-full' : 'w-1/3'} bg-white border border-gray-200 rounded-xl p-4 flex flex-col min-h-0 shadow-sm ${previewFullscreenPanel === 'right' ? 'hidden' : ''} transition-all duration-300`}>
                <div className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3 border-b border-gray-100 pb-2 flex items-center justify-between shrink-0 select-none">
                  <span className="flex items-center gap-1">
                    <BookOpen size={14} className="text-indigo-500" /> Lesson Content (课程内容)
                  </span>
                  <button
                    onClick={() => setPreviewFullscreenPanel(p => p === 'left' ? 'none' : 'left')}
                    className="p-1 hover:bg-gray-100 text-gray-400 hover:text-gray-700 rounded transition-colors cursor-pointer flex items-center gap-1"
                    title={previewFullscreenPanel === 'left' ? "退出全屏" : "全屏"}
                  >
                    {previewFullscreenPanel === 'left' ? (
                      <>
                        <Minimize2 size={13} />
                        <span className="text-[10px] font-medium">退出全屏</span>
                      </>
                    ) : (
                      <>
                        <Maximize2 size={13} />
                        <span className="text-[10px] font-medium">全屏</span>
                      </>
                    )}
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto prose prose-sm prose-indigo max-w-none text-gray-700 pr-1">
                  <Markdown>{lessons.find(l => l.id === selectedLesson)?.content || ''}</Markdown>
                </div>
              </div>

              {/* Right Column: Custom interactive whiteboard or cloud drive viewer */}
              <div className={`${previewFullscreenPanel === 'right' ? 'w-full flex-grow' : 'flex-1'} bg-white border border-gray-200 rounded-xl p-4 flex flex-col min-h-0 shadow-sm ${previewFullscreenPanel === 'left' ? 'hidden' : ''} transition-all duration-300`}>
                {/* Switcher tabs */}
                <div className="flex items-center justify-between border-b border-gray-100 pb-3 mb-3 shrink-0">
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setPreviewLessonTab('whiteboard')}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                        previewLessonTab === 'whiteboard'
                          ? 'bg-indigo-600 text-white shadow-sm'
                          : 'text-gray-500 hover:bg-gray-100'
                      }`}
                    >
                      Interactive Whiteboard
                    </button>
                    <button
                      onClick={() => setPreviewLessonTab('courseware')}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                        previewLessonTab === 'courseware'
                          ? 'bg-indigo-600 text-white shadow-sm'
                          : 'text-gray-500 hover:bg-gray-100'
                      }`}
                    >
                      Cloud Apps Viewer
                    </button>
                  </div>
                  
                  <button
                    onClick={() => setPreviewFullscreenPanel(p => p === 'right' ? 'none' : 'right')}
                    className="p-1 hover:bg-gray-100 text-gray-400 hover:text-gray-700 rounded transition-colors cursor-pointer flex items-center gap-1"
                    title={previewFullscreenPanel === 'right' ? "退出全屏" : "全屏"}
                  >
                    {previewFullscreenPanel === 'right' ? (
                      <>
                        <Minimize2 size={13} />
                        <span className="text-[10px] font-medium">退出全屏</span>
                      </>
                    ) : (
                      <>
                        <Maximize2 size={13} />
                        <span className="text-[10px] font-medium">全屏</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Tab content area */}
                <div className="flex-grow flex-1 min-h-0 flex flex-col h-full relative">
                  {previewLessonTab === 'whiteboard' ? (
                    <div className="flex-grow flex-1 min-h-0 w-full h-full relative rounded-lg overflow-hidden border border-gray-100 flex flex-col">
                      <LazyWhiteboard
lessonId={selectedLesson}
userRole={activeRole}
elements={elements}
activeSegmentId={activeSegmentId}
onSegmentSync={(segId: string) => setActiveSegmentId(segId)}
onElementAdd={async (type: string, data: any) => {
                            await fetch(`/api/lessons/${selectedLesson}/whiteboard`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ type, data })
                            });
                            fetchElements(selectedLesson);
                          }}
onElementUpdate={async (elementId: string, data: any) => {
                            await fetch(`/api/lessons/${selectedLesson}/whiteboard/${elementId}`, {
                              method: 'PUT',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ data })
                            });
                            fetchElements(selectedLesson);
                          }}
onElementDelete={async (elementId: string) => {
                            await fetch(`/api/lessons/${selectedLesson}/whiteboard/${elementId}`, {
                              method: 'DELETE'
                            });
                            fetchElements(selectedLesson);
                          }}
onClearBoard={async () => {
                            await fetch(`/api/lessons/${selectedLesson}/whiteboard`, {
                              method: 'DELETE'
                            });
                            fetchElements(selectedLesson);
                          }}
onRefresh={() => fetchElements(selectedLesson)}
/>
                    </div>
                  ) : (
                    <div className="flex-grow flex-1 flex gap-4 min-h-0 w-full h-full">
                      {/* Sidebar */}
                      <div className="w-52 flex-shrink-0 bg-gray-50 border border-gray-250/70 rounded-xl p-3 flex flex-col min-h-0 h-full animate-none">
                        <h4 className="text-xs font-bold uppercase tracking-wider text-gray-550 mb-2 border-b border-gray-200 pb-2">
                          Cloud Apps
                        </h4>
                        <div className="flex-1 overflow-y-auto space-y-1">
                          {currentVfsParent !== null && (
                            <button
                              onClick={() => setCurrentVfsParent(null)}
                              className="flex items-center gap-1 p-1.5 text-xs text-indigo-600 w-full hover:bg-gray-255 hover:bg-gray-200 rounded-lg mb-1 font-semibold"
                            >
                              <ChevronRight className="rotate-180" size={14} /> Back to Root
                            </button>
                          )}
                          {vfsNodes.filter(n => n.type === 'dir').map(node => (
                            <button
                              key={node.id}
                              onClick={() => setCurrentVfsParent(node.id)}
                              className="w-full text-left p-1.5 rounded-lg text-xs text-gray-700 hover:bg-gray-250 hover:bg-gray-200 flex items-center gap-2 group truncate cursor-pointer font-medium"
                              title={node.name}
                            >
                              <Folder size={14} className="text-indigo-400 shrink-0 group-hover:text-indigo-600" />
                              <span className="truncate">{node.name}</span>
                            </button>
                          ))}
                          {vfsNodes.filter(n => n.type === 'file' && (n.name.endsWith('.html') || n.name.endsWith('.htm') || n.content?.includes('<html'))).length === 0 ? (
                            <div className="text-xs text-center text-gray-400 italic py-4">No interactive HTML apps found.</div>
                          ) : (
                            vfsNodes.filter(n => n.type === 'file' && (n.name.endsWith('.html') || n.name.endsWith('.htm') || n.content?.includes('<html'))).map(node => (
                              <button
                                key={node.id}
                                onClick={() => setPreviewSelectedCourseware(node.id)}
                                className={`w-full text-left p-2 rounded-lg text-xs flex items-center gap-2 truncate transition-colors cursor-pointer font-medium ${
                                  previewSelectedCourseware === node.id 
                                    ? 'bg-indigo-100 text-indigo-700 font-semibold shadow-xs' 
                                    : 'text-gray-600 hover:bg-gray-100'
                                }`}
                                title={node.name}
                              >
                                <Globe size={14} className="shrink-0 text-indigo-500" />
                                <span className="truncate">{node.name}</span>
                              </button>
                            ))
                          )}
                        </div>
                        <div className="mt-2 text-[10px] text-gray-400 leading-tight">
                          Note: Showing HTML courseware from current OS drive directory.
                        </div>
                      </div>

                      {/* Embed Viewer */}
                      <div className="flex-1 relative bg-white border border-gray-100 rounded-xl overflow-hidden min-h-0 h-full shadow-inner flex flex-col">
                        <LazyCourseware
coursewareId={previewSelectedCourseware}
onClose={() => setPreviewSelectedCourseware(null)}
/>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* Process Logs Modal */}
      <ProcessLogsModal showProcessLogs={showProcessLogs} setShowProcessLogs={setShowProcessLogs} processLogsContent={processLogsContent} t={t} />

      {/* Cloud Drive Modal */}
      <CloudDriveModal isOpen={isCloudDriveOpen} onClose={() => setIsCloudDriveOpen(false)} vfsNodes={vfsNodes} currentVfsParent={currentVfsParent} setCurrentVfsParent={setCurrentVfsParent} cloudDrivePreviewNode={cloudDrivePreviewNode} setCloudDrivePreviewNode={setCloudDrivePreviewNode} />

      {/* System Resource Library Modal (系统资源管理系统) */}
      {isSystemResourceLibraryOpen && (
        <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm flex items-center justify-center p-6 z-50">
          <div className="bg-white border text-gray-900 border-gray-200 rounded-2xl shadow-2xl w-full max-w-6xl h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/80 shrink-0 flex-wrap gap-2">
              <div className="flex items-center gap-3 flex-wrap">
                <Globe size={20} className="text-emerald-500 animate-pulse" />
                <h2 className="font-semibold text-gray-800 text-lg">
                  {lang === 'zh' ? '系统资源库与应用商城' : 'System Resource Library'}
                </h2>
                
                {/* Sub-category Tabs */}
                <div className="flex items-center gap-1 bg-slate-200/80 p-0.5 rounded-xl border border-slate-300/60 shadow-3xs ml-2">
                  <button
                    onClick={() => setSystemResourceTab('system')}
                    className={`px-3 py-1 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
                      systemResourceTab === 'system'
                        ? 'bg-white text-emerald-800 shadow-2xs font-extrabold'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Globe size={13} className="text-emerald-500" />
                    <span>{lang === 'zh' ? '互动课件与系统资源' : 'System Resources'}</span>
                  </button>
                  <button
                    onClick={() => setSystemResourceTab('cloud')}
                    className={`px-3 py-1 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
                      systemResourceTab === 'cloud'
                        ? 'bg-white text-indigo-800 shadow-2xs font-extrabold'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Folder size={13} className="text-indigo-500" />
                    <span>{lang === 'zh' ? '云端课程资源 (Cloud Drive)' : 'Cloud Course Resource'}</span>
                  </button>
                </div>
              </div>
              <button 
                onClick={() => {
                  setIsSystemResourceLibraryOpen(false);
                  setSelectedLibraryResourceId(null);
                }} 
                className="text-gray-400 hover:text-gray-600 font-bold p-1 overflow-hidden hover:bg-gray-200 rounded transition-colors text-lg inline-flex items-center justify-center w-8 h-8 cursor-pointer"
              >
                &times;
              </button>
            </div>

            {systemResourceTab === 'cloud' ? (
              <CloudDrivePanel
                vfsNodes={vfsNodes}
                currentVfsParent={currentVfsParent}
                setCurrentVfsParent={setCurrentVfsParent}
                cloudDrivePreviewNode={cloudDrivePreviewNode}
                setCloudDrivePreviewNode={setCloudDrivePreviewNode}
              />
            ) : (
              <div className="flex-1 flex overflow-hidden min-h-0">
              {/* Left Pane - Upload controls & Resource list */}
              <div className="w-80 border-r border-gray-100 bg-slate-50 flex flex-col shrink-0">
                
                {/* Upload Buttons */}
                <div className="p-4 border-b border-gray-200 bg-white space-y-2">
                  <span className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                    {lang === 'zh' ? '上传新资源' : 'Upload New Resource'}
                  </span>
                  
                  <div className="grid grid-cols-2 gap-2">
                    {/* Single File */}
                    <label className="flex flex-col items-center justify-center p-3 bg-slate-50 hover:bg-indigo-50 border border-dashed border-gray-300 hover:border-indigo-400 rounded-xl cursor-pointer text-center transition-all group">
                      <span className="text-lg mb-1 group-hover:scale-110 transition-transform">📄</span>
                      <span className="font-bold text-indigo-600 text-[10px] break-all leading-tight">
                        {lang === 'zh' ? '单HTML文件' : 'Single HTML'}
                      </span>
                      <input
                        type="file"
                        accept=".html,.htm"
                        className="hidden"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          const reader = new FileReader();
                          reader.onload = async (event) => {
                            const text = event.target?.result as string;
                            try {
                              const res = await fetch('/api/resources', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                  name: file.name,
                                  type: 'html',
                                  content: text
                                })
                              });
                              if (res.ok) {
                                fetchLibraryResources();
                              }
                            } catch (err) {
                              console.error('Library upload failed:', err);
                            }
                          };
                          reader.readAsText(file);
                        }}
                      />
                    </label>

                    {/* Folder */}
                    <label className="flex flex-col items-center justify-center p-3 bg-slate-50 hover:bg-teal-50 border border-dashed border-gray-300 hover:border-teal-400 rounded-xl cursor-pointer text-center transition-all group">
                      <span className="text-lg mb-1 group-hover:scale-110 transition-transform">📁</span>
                      <span className="font-bold text-teal-600 text-[10px] break-all leading-tight">
                        {lang === 'zh' ? '完整文件夹' : 'Directory Folder'}
                      </span>
                      <input
                        type="file"
                        {...{
                          webkitdirectory: "",
                          directory: "",
                        } as any}
                        multiple
                        className="hidden"
                        onChange={async (e) => {
                          const files = e.target.files;
                          if (!files || files.length === 0) return;
                          
                          const filesToUpload: { path: string; content: string }[] = [];
                          let folderName = '';
                          
                          for (let i = 0; i < files.length; i++) {
                            const file = files[i];
                            const relPath = file.webkitRelativePath || file.name;
                            if (!folderName) {
                              folderName = relPath.split('/')[0] || 'library_resource';
                            }
                            
                            const ext = file.name.split('.').pop()?.toLowerCase();
                            const isBinary = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico'].includes(ext || '');
                            
                            await new Promise<void>((resolve) => {
                              const reader = new FileReader();
                              reader.onload = (evt) => {
                                const content = evt.target?.result as string;
                                filesToUpload.push({
                                  path: relPath,
                                  content: content
                                });
                                resolve();
                              };
                              if (isBinary) {
                                reader.readAsDataURL(file);
                              } else {
                                reader.readAsText(file);
                              }
                            });
                          }

                          try {
                            const res = await fetch('/api/resources', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                name: folderName,
                                type: 'folder',
                                content: JSON.stringify(filesToUpload)
                              })
                            });
                            if (res.ok) {
                              fetchLibraryResources();
                            }
                          } catch (err) {
                            console.error('Folder upload failed:', err);
                          }
                        }}
                      />
                    </label>
                  </div>
                </div>

                {/* Resource List Items */}
                <div className="flex-1 overflow-y-auto p-3 space-y-2">
                  <span className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest pl-1">
                    {lang === 'zh' ? '当前已存储的资源' : 'Stored Resources'}
                  </span>

                  {loadingLibraryResources && (
                    <div className="text-center py-8 text-xs text-slate-400">Loading resources...</div>
                  )}

                  {!loadingLibraryResources && libraryResources.length === 0 && (
                    <div className="text-center py-12 text-xs text-slate-400 italic">
                      {lang === 'zh' ? '暂无资源，支持拖入或上传文件。' : 'No resources in library. Upload some above!'}
                    </div>
                  )}

                  {libraryResources.map(resObj => {
                    const isActive = selectedLibraryResourceId === resObj.id;
                    return (
                      <div 
                        key={resObj.id}
                        onClick={() => setSelectedLibraryResourceId(resObj.id)}
                        className={`p-2.5 rounded-xl border flex justify-between items-center cursor-pointer transition-all ${
                          isActive 
                            ? 'bg-indigo-50 border-indigo-200 shadow-xs' 
                            : 'bg-white border-slate-100 hover:border-slate-200 hover:shadow-2xs'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="text-base select-none">
                            {resObj.type === 'folder' ? '📁' : '📄'}
                          </span>
                          <div className="text-left min-w-0">
                            <div className="text-xs font-semibold text-gray-700 truncate font-sans" title={resObj.name}>
                              {resObj.name}
                            </div>
                            <div className="text-[9px] text-gray-400 mt-0.5 font-mono">
                              {new Date(resObj.created_at).toLocaleDateString()} • {resObj.id}
                            </div>
                          </div>
                        </div>

                        {/* Delete button */}
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (confirm(lang === 'zh' ? `确认删除资源 [${resObj.name}] 吗？` : `Delete resource [${resObj.name}]?`)) {
                              await fetch(`/api/resources/${resObj.id}`, { method: 'DELETE' });
                              if (selectedLibraryResourceId === resObj.id) {
                                setSelectedLibraryResourceId(null);
                              }
                              fetchLibraryResources();
                            }
                          }}
                          className="p-1 hover:bg-red-50 text-slate-400 hover:text-red-500 rounded-md transition-colors cursor-pointer"
                          title="Delete"
                        >
                          <Trash2 size={12} className="shrink-0" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Right Pane - Active Preview Frame */}
              <div className="flex-1 bg-white flex flex-col min-w-0">
                {selectedLibraryResourceId ? (
                  <div className="flex-1 flex flex-col h-full min-h-0">
                    <div className="p-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between shrink-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-gray-700 text-sm">
                          {lang === 'zh' ? '交互沙箱应用预览:' : 'Sandbox Live Preview:'}
                        </span>
                        <span className="text-xs bg-slate-200/70 text-slate-700 px-2 py-0.5 rounded font-mono">
                          /api/resources/{selectedLibraryResourceId}/
                        </span>
                      </div>
                      <button 
                        onClick={() => setSelectedLibraryResourceId(null)}
                        className="text-xs text-indigo-600 hover:text-indigo-800 font-medium cursor-pointer"
                      >
                        {lang === 'zh' ? '关闭预览' : 'Close Preview'}
                      </button>
                    </div>
                    <div className="flex-1 relative bg-slate-100/50">
                      <iframe
                        src={`/api/resources/${selectedLibraryResourceId}/`}
                        sandbox="allow-scripts"
                        className="w-full h-full border-none bg-white font-sans"
                        title="Interactive Resource Preview"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center p-6 text-gray-400 bg-slate-50/50">
                    <Globe size={48} className="text-gray-300 mb-3 opacity-60" />
                    <p className="text-sm font-semibold text-gray-600">
                      {lang === 'zh' ? '未选择资源进行预览' : 'No Resource Selected'}
                    </p>
                    <p className="text-xs text-center text-gray-400 mt-1 max-w-sm">
                      {lang === 'zh' 
                        ? '请在左侧列表中点击选择要预览/管理的 HTML 单文件或完整 applet 文件夹，右侧即可进行沙箱实时运行。' 
                        : 'Click any resource in the list on the left to preview its interactive live sandbox iframe here.'}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    )}

      {/* Grade Export Weighting Settings Modal */}
      {/* 批量操作选择弹窗（排课 / 锁定课程 / 转班） */}
      {batchPicker && (
        <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm flex items-center justify-center p-6 z-50">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white border text-gray-900 border-gray-200 rounded-2xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden"
          >
            <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/80">
              <h2 className="font-bold text-gray-800 text-base">
                {batchPicker === 'schedule'
                  ? (lang === 'zh' ? '批量排课' : 'Batch Schedule')
                  : batchPicker === 'lockedLesson'
                  ? (lang === 'zh' ? '批量设置锁定课程' : 'Batch Lock Lesson')
                  : (lang === 'zh' ? '批量转班' : 'Batch Transfer')}
              </h2>
              <button onClick={() => setBatchPicker(null)} className="text-gray-400 hover:text-gray-600 text-lg font-bold p-1 hover:bg-gray-200 rounded">&times;</button>
            </div>
            <div className="p-5 space-y-4">
              {(batchPicker === 'schedule' || batchPicker === 'lockedLesson') && (
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-gray-600">{lang === 'zh' ? '选择课程' : 'Select Lesson'}</label>
                  <select
                    value={batchPickerLesson}
                    onChange={(e) => setBatchPickerLesson(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="">{lang === 'zh' ? '— 请选择 —' : '— Select —'}</option>
                    {lessons.map((l: any) => <option key={l.id} value={l.id}>{l.title}</option>)}
                  </select>
                </div>
              )}
              {batchPicker === 'schedule' && (
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-gray-600">{lang === 'zh' ? '上课日期' : 'Schedule Date'}</label>
                  <input
                    type="date"
                    value={batchPickerDate}
                    onChange={(e) => setBatchPickerDate(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              )}
              {batchPicker === 'transfer' && (
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-gray-600">{lang === 'zh' ? '选择目标班级' : 'Select Target Class'}</label>
                  <select
                    value={batchPickerTargetClass}
                    onChange={(e) => setBatchPickerTargetClass(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="">{lang === 'zh' ? '— 请选择 —' : '— Select —'}</option>
                    {classes.filter((c: any) => c.id !== expandedClassId).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              )}
            </div>
            <div className="p-4 border-t border-gray-100 flex justify-end gap-2">
              <button onClick={() => setBatchPicker(null)} className="px-4 py-2 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-100 cursor-pointer">{lang === 'zh' ? '取消' : 'Cancel'}</button>
              <button onClick={confirmBatchPicker} className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 cursor-pointer">{lang === 'zh' ? '确认' : 'Confirm'}</button>
            </div>
          </motion.div>
        </div>
      )}

      {isExportWeightModalOpen && (
        <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm flex items-center justify-center p-6 z-50">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="bg-white border text-gray-900 border-gray-200 rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col overflow-hidden max-h-[85vh]"
          >
            {/* Modal Header */}
            <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/80 shrink-0">
              <div className="flex items-center gap-3">
                <Settings2 className="text-indigo-600 font-sans" size={20} />
                <h2 className="font-bold text-gray-800 text-lg font-sans">
                  {lang === 'zh' ? '导出成绩权重设置' : 'Grade Export & Weighting Settings'}
                </h2>
              </div>
              <button 
                onClick={() => setIsExportWeightModalOpen(false)} 
                className="text-gray-400 hover:text-gray-600 font-bold p-1 hover:bg-gray-200 rounded transition-colors text-lg"
              >
                &times;
              </button>
            </div>

            {/* Modal Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              <div className="bg-indigo-50 border border-indigo-150 rounded-xl p-4 text-indigo-800 text-xs font-sans leading-relaxed">
                {lang === 'zh' 
                  ? '您可以自定义测验与作业在期末成绩(平均分)中的计算权重。系统已根据测验名和内容自动对课程内容进行分类，您可以在下方手动微调分类。' 
                  : 'Customize the calculation weight of quizzes and assignments in the calculated average score. The system automatically classifies items, but you can manually override categorized groups below.'}
              </div>

              {/* Weighting Sliders */}
              <div className="space-y-4">
                <h3 className="font-bold text-sm text-gray-800 flex items-center gap-2 font-sans">
                  <Percent size={16} className="text-indigo-500 font-sans" />
                  {lang === 'zh' ? '定义成绩占比权重' : 'Define Weighting Percentages'}
                </h3>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-gray-50 p-4 rounded-xl border border-gray-100 font-sans">
                  {/* Quizzes Weight */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-gray-700">
                        {lang === 'zh' ? '测验权重 (Quizzes)' : 'Quizzes Weight'}
                      </span>
                      <span className="text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100">
                        {quizzesWeight}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={quizzesWeight}
                      onChange={(e) => handleQuizzesWeightChange(Number(e.target.value))}
                      className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                    />
                  </div>

                  {/* Assignments Weight */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-gray-700">
                        {lang === 'zh' ? '作业权重 (Assignments)' : 'Assignments Weight'}
                      </span>
                      <span className="text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100">
                        {assignmentsWeight}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={assignmentsWeight}
                      onChange={(e) => handleAssignmentsWeightChange(Number(e.target.value))}
                      className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => { setQuizzesWeight(50); setAssignmentsWeight(50); }}
                    className="text-[10px] text-gray-500 hover:text-gray-700 bg-white border border-gray-200 hover:bg-gray-50 font-bold px-2.5 py-1 rounded transition-colors cursor-pointer"
                  >
                    {lang === 'zh' ? '均衡配比 50/50' : 'Balance 50/50'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setQuizzesWeight(40); setAssignmentsWeight(60); }}
                    className="text-[10px] text-gray-500 hover:text-gray-700 bg-white border border-gray-200 hover:bg-gray-50 font-bold px-2.5 py-1 rounded transition-colors cursor-pointer"
                  >
                    {lang === 'zh' ? '推荐配比 40/60' : 'Recommend 40/60'}
                  </button>
                </div>
              </div>

              {/* Items Categorization Overrides */}
              <div className="space-y-3">
                <h3 className="font-bold text-sm text-gray-800 flex items-center justify-between font-sans">
                  <span className="flex items-center gap-2">
                    <ListFilter size={16} className="text-indigo-500" />
                    {lang === 'zh' ? '期末考核项目微调' : 'Item Categorization Overrides'}
                  </span>
                  <span className="text-[10px] text-gray-400 font-medium font-sans">
                    {lang === 'zh' ? `共 ${classDashboardMap[exportClassId]?.assignments?.length || 0} 项` : `${classDashboardMap[exportClassId]?.assignments?.length || 0} items total`}
                  </span>
                </h3>

                <div className="border border-gray-150 rounded-xl overflow-hidden divide-y divide-gray-100 max-h-60 overflow-y-auto bg-white shadow-inner">
                  {(classDashboardMap[exportClassId]?.assignments || []).map((a: any) => {
                    const isMcq = a.content && a.content.startsWith('{"quizType":"mcq_learning_objectives"');
                    const hasQuizInTitle = a.title && (a.title.toLowerCase().includes('quiz') || a.title.toLowerCase().includes('test') || a.title.includes('测验') || a.title.includes('测试'));
                    const defaultCategory = (isMcq || hasQuizInTitle) ? 'quiz' : 'assignment';
                    const currentCategory = customCategoryOverrides[a.id] || defaultCategory;

                    return (
                      <div key={a.id} className="p-3 flex items-center justify-between gap-4 font-sans hover:bg-gray-50/50 transition-colors">
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold text-xs text-gray-800 truncate" title={a.title}>
                            {a.title}
                          </div>
                          <div className="text-[10px] text-gray-400 truncate mt-0.5">
                            {a.description || (lang === 'zh' ? '无描述信息' : 'No description provided')}
                          </div>
                        </div>

                        <div className="flex border border-gray-200 rounded-lg p-0.5 bg-gray-50 shrink-0">
                          <button
                            type="button"
                            onClick={() => setCustomCategoryOverrides(prev => ({ ...prev, [a.id]: 'quiz' }))}
                            className={`px-2.5 py-1 text-[10px] font-bold rounded-md transition-all cursor-pointer ${
                              currentCategory === 'quiz'
                                ? 'bg-indigo-600 text-white shadow'
                                : 'text-gray-500 hover:text-gray-800 hover:bg-gray-100'
                            }`}
                          >
                            {lang === 'zh' ? '测验' : 'Quiz'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setCustomCategoryOverrides(prev => ({ ...prev, [a.id]: 'assignment' }))}
                            className={`px-2.5 py-1 text-[10px] font-bold rounded-md transition-all cursor-pointer ${
                              currentCategory === 'assignment'
                                ? 'bg-emerald-600 text-white shadow'
                                : 'text-gray-500 hover:text-gray-800 hover:bg-gray-100'
                            }`}
                          >
                            {lang === 'zh' ? '作业' : 'Assignment'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  {(!classDashboardMap[exportClassId]?.assignments || classDashboardMap[exportClassId].assignments.length === 0) && (
                    <div className="p-8 text-center text-xs text-gray-400 italic">
                      {lang === 'zh' ? '此班级暂未创建任何考核项目' : 'No graded items exist in this class.'}
                    </div>
                  )}
                </div>
              </div>

              {/* Live Preview Section */}
              {csvPreviewData && csvPreviewData.rows.length > 0 && (
                <div className="space-y-3 pt-2">
                  <h3 className="font-bold text-sm text-gray-800 flex items-center justify-between font-sans">
                    <span className="flex items-center gap-2">
                      <Terminal size={16} className="text-emerald-500" />
                      {lang === 'zh' ? 'CSV 实时成绩表预览 (前5行数据)' : 'Live CSV Grade Preview (First 5 Rows)'}
                    </span>
                    <span className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-100 font-bold px-2 py-0.5 rounded shadow-xs font-sans">
                      {lang === 'zh' ? `展示 5 / ${csvPreviewData.totalStudents} 名学生` : `Showing 5 of ${csvPreviewData.totalStudents} students`}
                    </span>
                  </h3>
                  
                  <div className="border border-gray-150 rounded-xl overflow-hidden bg-white shadow-xs max-w-full">
                    <div className="overflow-x-auto max-h-56 overflow-y-auto">
                      <table className="w-full border-collapse text-left">
                        <thead>
                          <tr className="bg-gray-50 border-b border-gray-150 sticky top-0 z-10">
                            {csvPreviewData.headers.map((hdr, hIdx) => {
                              // Highlight key overall calculation columns
                              const isCalcCol = hdr.includes('Average') || hdr.includes('Avg') || hdr.includes('Score');
                              const isWeighted = hdr.includes('Weighted');
                              return (
                                <th 
                                  key={hIdx} 
                                  className={`p-2.5 text-[10px] font-bold tracking-wider uppercase border-r border-gray-150 whitespace-nowrap font-sans font-semibold ${
                                    isWeighted 
                                      ? 'text-indigo-700 bg-indigo-50/70 border-indigo-150 font-bold' 
                                      : isCalcCol 
                                      ? 'text-emerald-700 bg-emerald-50/70' 
                                      : 'text-gray-500'
                                  }`}
                                >
                                  {hdr}
                                </th>
                              );
                            })}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {csvPreviewData.rows.map((row, rIdx) => (
                            <tr key={rIdx} className="hover:bg-gray-50/50 transition-colors font-mono text-[10px]">
                              {row.map((cell, cIdx) => {
                                const hdrName = csvPreviewData.headers[cIdx] || '';
                                const isWeighted = hdrName.includes('Weighted');
                                const isCalcCol = hdrName.includes('Average') || hdrName.includes('Avg') || hdrName.includes('Score');
                                return (
                                  <td 
                                    key={cIdx} 
                                    className={`p-2 border-r border-gray-100 font-mono text-[10px] text-gray-700 whitespace-nowrap text-center ${
                                      isWeighted 
                                        ? 'bg-indigo-50/30 font-bold text-indigo-700 border-indigo-100' 
                                        : isCalcCol 
                                        ? 'bg-emerald-50/10 font-semibold text-emerald-800' 
                                        : cIdx < 2 
                                        ? 'text-left font-sans font-medium' 
                                        : ''
                                    }`}
                                  >
                                    {cell}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <p className="text-[10px] text-gray-400 font-sans italic">
                    {lang === 'zh' 
                      ? '* 改变上方权重占比或调整项目分类时，此预览与计算结果会立即实时刷新。' 
                      : '* Calculations and layout values in this preview refresh dynamically as you tweak sliders and overrides.'}
                  </p>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-gray-100 bg-gray-50/85 flex justify-end gap-2.5 shrink-0">
              <button
                type="button"
                onClick={() => setIsExportWeightModalOpen(false)}
                className="px-4 py-2 text-xs font-semibold border border-gray-300 text-gray-700 bg-white rounded-lg hover:bg-gray-100 transition-colors cursor-pointer"
              >
                {lang === 'zh' ? '取消' : 'Cancel'}
              </button>
              <button
                type="button"
                disabled={!classDashboardMap[exportClassId]?.assignments || classDashboardMap[exportClassId].assignments.length === 0}
                onClick={() => {
                  handleExportGrades(exportClassId, exportClassName, quizzesWeight, assignmentsWeight, customCategoryOverrides);
                  setIsExportWeightModalOpen(false);
                }}
                className="px-4 py-2 text-xs font-bold bg-indigo-600 text-white border border-indigo-700 rounded-lg hover:bg-indigo-700 hover:shadow shadow-sm transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Download size={14} />
                {lang === 'zh' ? '导出 CSV 成绩表' : 'Export Grade Sheet'}
              </button>
            </div>
          </motion.div>
        </div>
      )}

      <NotificationDetailModal
        notification={selectedNotificationForModal}
        onClose={() => setSelectedNotificationForModal(null)}
        lang={lang}
        onOpenWorkspace={(assignment) => {
          setSelectedAssignment(assignment);
          setStudentViewStatus('assignment');
          setQuizStudentAnswers({});
          setSubAssignmentTab('quiz');
        }}
      />

      {/* Real-time Toast Notifications */}
      <ToastContainer />

      {/* Help Tour Wizard */}
      <HelpTour
        isOpen={isTourOpen}
        onClose={() => setIsTourOpen(false)}
        lang={lang as 'zh' | 'en'}
        onSeedSuccess={handleSeedSuccess}
        onJumpTab={(tab) => setTeacherTab(tab)}
      />
      
      {/* Courseware Hub Panel */}
      {showCoursewareHub && (
        <CoursewareHubPanel
          onClose={() => setShowCoursewareHub(false)}
          lang={lang}
        />
      )}

      </div>
    </>
  );
}
