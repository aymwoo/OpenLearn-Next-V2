import { MessageSquare, Wand2, Plus, Trash2, PenTool, LayoutTemplate, Globe, Code, Puzzle, Blocks, Download, Upload, Paperclip, Terminal, ChevronUp, ChevronDown, ChevronRight, FileText, Shield, ShieldAlert, Check, X, Folder, File as FileIcon, Activity, Users, BarChart2, ClipboardList, Send, FileBadge, PlayCircle, Loader2, Calendar as CalendarIcon, CheckCircle2, Bell, BookOpen, Settings, PanelRightClose, PanelRightOpen, Home, Presentation, HelpCircle, Search, Settings2, Percent, ListFilter, Clock, Sparkles, Eye, Maximize2, Minimize2, Database, Shuffle } from 'lucide-react';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import Markdown from 'react-markdown';
import { translations, Language } from './i18n';
import { LazyWhiteboard } from './components/LazyWhiteboard';
import { LazyCourseware } from './components/LazyCourseware';
import { LiveClassroomView } from './components/LiveClassroomView';
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
import { TimetableManager } from './components/TimetableManager';
import { SemesterGradeManager } from './components/SemesterGradeManager';
import { StudentAssignmentEvalPanel } from './components/StudentAssignmentEvalPanel';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { motion, AnimatePresence, animate } from 'motion/react';
import { io } from 'socket.io-client';
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
import { ExtensionPointRenderer } from './plugin-host/extension-point-renderer';
import { usePluginHost } from './plugin-host/plugin-host-context';
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
import { ToastContainer } from './features/shared/ToastContainer';
import { NavigationSidebar } from './features/shared/NavigationSidebar';
import { RightSidebar } from './features/shared/RightSidebar';
import { ProcessLogsModal } from './features/modals/ProcessLogsModal';
import { ImportModal } from './features/modals/ImportModal';
import { CloudDriveModal } from './features/modals/CloudDriveModal';
import { NotificationDetailModal } from './features/modals/NotificationDetailModal';
import { HelpView } from './features/teacher/HelpView';
import { TimetableView } from './features/teacher/TimetableView';
import { ComputerLabView } from './features/teacher/ComputerLabView';
import { AdminDirectoryView } from './features/teacher/AdminDirectoryView';
import { PluginView } from './features/teacher/PluginView';
import { SettingsView } from './features/teacher/SettingsView';
import { CourseManagement } from './features/teacher/CourseManagement';
import { Dashboard } from './features/teacher/Dashboard';

const AGENT_PROVIDER_STORAGE_KEY = 'openlearnv2.agentProviderId';

const DEFAULT_PLUGIN = `exports.default = {
  manifest: {
    id: "ext-quiz-generator",
    name: "Quiz Component Plugin",
    version: "1.0.0",
    capabilitiesProposed: ["quiz:write"]
  },
  activate: async (ctx) => {
    ctx.actionRegistry.register({
      id: 'ext-quiz-create',
      commandType: 'quiz.create',
      description: 'Create a multiple-choice quiz on the whiteboard for a lesson',
      capabilityRequired: 'whiteboard:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          lessonId: { type: 'STRING' },
          question: { type: 'STRING' },
          options: { type: 'ARRAY', items: { type: 'STRING' } }
        },
        required: ['lessonId', 'question', 'options']
      }
    });

    ctx.commandBus.registerHandler('quiz.create', {
      execute: async (command) => {
        const payload = command.payload;
        const result = await ctx.commandBus.execute({
          id: Math.random().toString(36).slice(2),
          type: 'whiteboard.draw',
          payload: {
            lessonId: payload.lessonId,
            type: 'quiz',
            data: JSON.stringify({ question: payload.question, options: payload.options })
          }
        });
        return { elementId: result.elementId };
      }
    });
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

interface ParsedManifest {
  id?: string;
  name?: string;
  version?: string;
  description?: string;
  author?: string;
  capabilitiesProposed?: string[];
}

interface ParsedAction {
  id: string;
  commandType: string;
  description?: string;
}

const parsePluginSource = (sourceCode: string) => {
  let manifest: ParsedManifest | null = null;
  const actions: ParsedAction[] = [];
  
  try {
    const cleanCode = sourceCode
      .replace(/require\s*\(.*?\)/g, '{}')
      .replace(/import\s+.*?\s+from\s*['"].*?['"]/g, '');
      
    try {
      const runner = new Function('exports', `
        try {
          ${cleanCode};
          exports.default = exports.default || exports;
        } catch(e) {}
      `);
      const mockExports = {} as any;
      runner(mockExports);
      const evaluated = mockExports.default || mockExports;
      if (evaluated && evaluated.manifest) {
        manifest = evaluated.manifest;
      }
    } catch (e: any) {
      // Ignore evaluation error, fallback to regex
    }

    const idMatch = sourceCode.match(/id\s*:\s*['"]([^'"]+)['"]/);
    const nameMatch = sourceCode.match(/name\s*:\s*['"]([^'"]+)['"]/);
    const verMatch = sourceCode.match(/version\s*:\s*['"]([^'"]+)['"]/);
    const descMatch = sourceCode.match(/description\s*:\s*['"]([^'"]+)['"]/);
    const authorMatch = sourceCode.match(/author\s*:\s*['"]([^'"]+)['"]/);
    
    let capabilities: string[] = [];
    const capsMatch = sourceCode.match(/capabilitiesProposed\s*:\s*\[([\s\S]*?)\]/);
    if (capsMatch) {
      capabilities = capsMatch[1]
        .split(',')
        .map(s => s.replace(/['"\s]/g, ''))
        .filter(s => s.length > 0);
    }

    const mergedManifest: ParsedManifest = {
      id: manifest?.id || idMatch?.[1] || undefined,
      name: manifest?.name || nameMatch?.[1] || undefined,
      version: manifest?.version || verMatch?.[1] || undefined,
      description: manifest?.description || descMatch?.[1] || undefined,
      author: manifest?.author || authorMatch?.[1] || undefined,
      capabilitiesProposed: manifest?.capabilitiesProposed || (capabilities.length > 0 ? capabilities : undefined)
    };

    const actionBlockRegex = /actionRegistry\.register\s*\(\s*\{([\s\S]*?)\}\s*\)/g;
    let match;
    const codesToSearch = sourceCode;
    while ((match = actionBlockRegex.exec(codesToSearch)) !== null) {
      const block = match[1];
      const cmdIdLoc = block.match(/id\s*:\s*['"]([^'"]+)['"]/);
      const cmdTypeLoc = block.match(/commandType\s*:\s*['"]([^'"]+)['"]/);
      const cmdDescLoc = block.match(/description\s*:\s*['"]([^'"]+)['"]/);
      
      if (cmdIdLoc || cmdTypeLoc) {
        actions.push({
          id: cmdIdLoc ? cmdIdLoc[1] : 'unknown',
          commandType: cmdTypeLoc ? cmdTypeLoc[1] : 'unknown',
          description: cmdDescLoc ? cmdDescLoc[1] : ''
        });
      }
    }

    return {
      manifest: mergedManifest,
      actions: actions,
      error: null
    };
  } catch (err: any) {
    return {
      manifest: null,
      actions: [],
      error: err.toString()
    };
  }
};

const parseCSV = (text: string): { name: string; email: string }[] => {
  const lines = text.split(/\r?\n/);
  if (lines.length < 2) return [];

  const headerLine = lines[0];
  const separators = [',', ';', '\t'];
  let sep = ',';
  let maxCount = 0;
  separators.forEach(s => {
    const count = headerLine.split(s).length;
    if (count > maxCount) {
      maxCount = count;
      sep = s;
    }
  });

  const parseRow = (rowText: string): string[] => {
    const result: string[] = [];
    let insideQuote = false;
    let entry = '';
    for (let i = 0; i < rowText.length; i++) {
      const char = rowText[i];
      if (char === '"') {
        insideQuote = !insideQuote;
      } else if (char === sep && !insideQuote) {
        result.push(entry.trim());
        entry = '';
      } else {
        entry += char;
      }
    }
    result.push(entry.trim());
    return result;
  };

  const headers = parseRow(headerLine).map(h => h.toLowerCase().replace(/["'\r]/g, '').trim());
  
  const nameIdx = headers.findIndex(h => 
    h.includes('name') || h.includes('student') || h.includes('姓名') || h.includes('学生')
  );
  const emailIdx = headers.findIndex(h => 
    h.includes('email') || h.includes('mail') || h.includes('邮箱')
  );

  const finalNameIdx = nameIdx >= 0 ? nameIdx : 0;
  const finalEmailIdx = emailIdx >= 0 ? emailIdx : 1;

  const list: { name: string; email: string }[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cols = parseRow(lines[i]);
    const name = cols[finalNameIdx] ? cols[finalNameIdx].replace(/["'\r]/g, '').trim() : '';
    const email = cols[finalEmailIdx] ? cols[finalEmailIdx].replace(/["'\r]/g, '').trim() : '';
    if (name) {
      list.push({ name, email });
    }
  }
  return list;
};

const hostEventBus = new EventBus();

export default function App() {
  const lang = useAppStore((s) => s.lang);
  const setLang = useAppStore((s) => s.setLang);
  const t = translations[lang];

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
  const [selectedLibraryResourceId, setSelectedLibraryResourceId] = useState<string | null>(null);
  const [libraryResources, setLibraryResources] = useState<any[]>([]);
  const [loadingLibraryResources, setLoadingLibraryResources] = useState(false);

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
  const [storeTab, setStoreTab] = useState<'store' | 'widgets' | 'dev'>('store');
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
  
  // Role & Student View
  const session = useAppStore((s) => s.session);
  const setSession = useAppStore((s) => s.setSession);

  const [activeRole, setActiveRole] = useState<'teacher' | 'student'>('teacher');
  const [sessionLoading, setSessionLoading] = useState(true);
  const [dbConnected, setDbConnected] = useState<boolean>(true);

  useEffect(() => {
    if (!session) return;
    const checkDb = async () => {
      try {
        const res = await fetch('/api/db-status');
        if (res.ok) {
          setDbConnected(true);
        } else {
          setDbConnected(false);
        }
      } catch (err) {
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

  const [teacherTab, setTeacherTab] = useState<string>('dashboard');
  const [isApprovalsCollapsed, setIsApprovalsCollapsed] = useState(false);
  const [isProcessesCollapsed, setIsProcessesCollapsed] = useState(false);

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

  const handleExportAllClassesCombined = async () => {
    if (classes.length === 0) return;
    setIsExportingAllCombined(true);
    try {
      await Promise.all(
        classes.map(async (cls) => {
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

      classes.forEach((cls) => {
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
    if (teacherTab === 'settings' || rightSidebarTab === 'agent') {
      fetchAIProviders();
    }
  }, [teacherTab, rightSidebarTab]);

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

  useEffect(() => { activeRoleRef.current = activeRole; }, [activeRole]);
  useEffect(() => { activeStudentIdRef.current = activeStudentId; }, [activeStudentId]);
  useEffect(() => { langRef.current = lang; }, [lang]);
  useEffect(() => { studentsRef.current = students; }, [students]);
  useEffect(() => { addToastRef.current = addToast; }, [addToast]);

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

  const handleZipPluginUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64 = event.target?.result as string;
      setInstallingPlugin(true);
      try {
        const res = await fetch('/api/plugins/upload-zip', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ base64Data: base64, filename: file.name })
        });
        const data = await res.json();
        if (data.success) {
          await fetchPlugins();
          alert(`Plugin "${data.manifest.name}" installed successfully!`);
          setChatLog(prev => [...prev, { role: 'agent', content: `[System] Plugin "${data.manifest.name}" installed successfully from ZIP file.` }]);
        } else {
          alert("Plugin installation failed: " + data.error);
        }
      } catch (err: any) {
        alert("Error: " + err.message);
      } finally {
        setInstallingPlugin(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleTogglePlugin = async (id: string) => {
    try {
      const res = await fetch(`/api/plugins/${id}/toggle`, { method: 'POST' });
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
    }
  };

  const handleDeletePlugin = async (id: string) => {
    if (!window.confirm(lang === 'zh' ? '确定要彻底删除该插件吗？删除后此插件相关的功能将无法使用。' : 'Are you sure you want to completely delete this plugin? This cannot be undone.')) {
      return;
    }
    try {
      const res = await fetch(`/api/plugins/${id}`, { method: 'DELETE' });
      if (res.ok) {
         await fetchPlugins();
         setChatLog(prev => [...prev, { role: 'agent', content: `[System] Plugin uninstalled and deleted.` }]);
      }
    } catch (e) {
      console.error('Failed to delete plugin:', e);
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
    setLang(prev => prev === 'zh' ? 'en' : 'zh');
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
          <div className="flex items-center gap-6">
            <h2 className="font-semibold text-gray-800 tracking-tight flex items-center gap-2">
              <LayoutTemplate size={20} className="text-gray-400" />
              {activeRole === 'teacher' ? t.dashboard : 'Student Dashboard'}
            </h2>
            {session.role === 'teacher' && (
              <div className="bg-gray-150 p-1 rounded-lg flex items-center gap-1">
                <button 
                  onClick={() => setActiveRole('teacher')}
                  className={`px-3 py-1 text-xs sm:text-sm rounded ${activeRole === 'teacher' ? 'bg-white shadow-xs font-bold text-indigo-600' : 'text-gray-500 hover:text-gray-700'}`}
                >
                  Teacher Mode
                </button>
                <button 
                  onClick={() => setActiveRole('student')}
                  className={`px-3 py-1 text-xs sm:text-sm rounded ${activeRole === 'student' ? 'bg-white shadow-xs font-bold text-pink-600' : 'text-gray-500 hover:text-gray-700'}`}
                >
                  Student Mode
                </button>
              </div>
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
              onClick={() => setIsCloudDriveOpen(true)}
              className="flex items-center gap-1.5 hover:text-indigo-600 transition-colors bg-white px-3 py-1.5 rounded-md border border-gray-200 shadow-sm font-medium"
            >
              <Folder size={14} className="text-indigo-500" />
              Cloud Drive
            </button>
            <button 
              onClick={() => setIsSystemResourceLibraryOpen(true)}
              className="flex items-center gap-1.5 hover:text-indigo-600 transition-colors bg-white px-3 py-1.5 rounded-md border border-gray-200 shadow-sm font-medium"
            >
              <Globe size={14} className="text-emerald-500 animate-pulse" />
              {lang === 'zh' ? '系统资源库' : 'System Resource Library'}
            </button>
            <button 
              onClick={toggleLanguage}
              className="flex items-center gap-1.5 hover:text-gray-900 transition-colors bg-gray-50 px-3 py-1.5 rounded-md border border-gray-200"
            >
              <Globe size={14} />
              {t.switchLang}
            </button>

            {/* Database Connection Status Indicator */}
            <div 
              id="db-connection-status-badge"
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border select-none text-xs sm:text-sm font-medium transition-all duration-300 ${
                dbConnected 
                  ? 'bg-emerald-50/70 border-emerald-200 text-emerald-800' 
                  : 'bg-rose-50 border-rose-200 text-rose-800 animate-pulse'
              }`}
              title={dbConnected ? (lang === 'zh' ? 'SQLite引擎已连接且正常运行' : 'SQLite DB Connected & Queryable') : (lang === 'zh' ? 'SQLite数据库连接已断开' : 'SQLite DB Offline')}
            >
              <Database size={14} className={dbConnected ? 'text-emerald-500' : 'text-rose-500'} />
              <div className="relative flex h-2 w-2">
                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${dbConnected ? 'bg-emerald-400' : 'bg-rose-400'}`}></span>
                <span className={`relative inline-flex rounded-full h-2 w-2 ${dbConnected ? 'bg-emerald-500' : 'bg-rose-500'}`}></span>
              </div>
              <span className="font-semibold text-[11px] sm:text-xs tracking-wide">
                SQLite: {dbConnected ? (lang === 'zh' ? '正常' : 'Connected') : (lang === 'zh' ? '断开' : 'Offline')}
              </span>
            </div>

            <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-lg select-none text-xs sm:text-sm">
              <div className="w-2 h-2 rounded-full bg-green-500 mr-1.5 shrink-0 animate-pulse"></div>
              <span className="font-bold text-slate-800 mr-2 truncate max-w-[130px]" title={session?.name}>
                {session?.name}
              </span>
              <span className="text-slate-300 mr-2 border-r border-slate-200 h-4"></span>
              <button 
                onClick={handleLogout}
                className="text-xs font-semibold text-rose-500 hover:text-rose-700 transition-colors cursor-pointer block"
              >
                {lang === 'zh' ? '安全登出' : 'Sign Out'}
              </button>
            </div>
          </div>
        </header>

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
              <div className="flex flex-col h-full space-y-4">
                <div className="flex items-center justify-between">
                  {students.find(s => s.id === activeStudentId)?.locked_lesson_id ? (
                     <div className="text-indigo-600 font-medium text-sm flex items-center gap-2 px-2">
                       <ShieldAlert size={16} /> Restricted Mode
                     </div>
                  ) : (
                    <button 
                      onClick={() => { setStudentViewStatus('dashboard'); setSelectedLesson(null); }}
                      className="flex items-center gap-2 text-indigo-600 hover:text-indigo-800 transition-colors font-medium text-sm"
                    >
                      <ChevronRight className="rotate-180" size={16} /> Back to Dashboard
                    </button>
                  )}
                  <h2 className="text-xl font-bold text-gray-800">{lessons.find(l => l.id === selectedLesson)?.title}</h2>
                </div>
                <div className="flex-1 flex gap-6 min-h-0 bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
                  <div className={`${
                    isStudentLessonContentCollapsed 
                      ? 'hidden' 
                      : studentFullscreenPanel === 'left' 
                        ? 'w-full' 
                        : 'w-1/3 md:block hidden'
                  } border-gray-100 pr-4 overflow-y-auto ${
                    studentFullscreenPanel === 'right' ? 'hidden' : ''
                  } ${
                    studentFullscreenPanel === 'left' ? '' : 'border-r'
                  } transition-all duration-300`}>
                    <div className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-4 flex items-center justify-between pointer-events-auto shrink-0 select-none border-b border-gray-100 pb-2">
                      <span className="flex items-center gap-1">
                        <BookOpen size={14} className="text-indigo-500" /> Lesson Content (课程内容)
                      </span>
                      <button
                        onClick={() => setStudentFullscreenPanel(p => p === 'left' ? 'none' : 'left')}
                        className="p-1 hover:bg-gray-100 text-gray-400 hover:text-gray-700 rounded transition-colors cursor-pointer flex items-center gap-1"
                        title={studentFullscreenPanel === 'left' ? "退出全屏" : "全屏"}
                      >
                        {studentFullscreenPanel === 'left' ? (
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
                    <div className="prose prose-sm prose-indigo max-w-none">
                      {/* Timeline Segments (Only when student is unlocked) */}
                      {!students.find(s => s.id === activeStudentId)?.locked_lesson_id && timelineSegments.length > 0 && (
                        <div className="mb-4 flex flex-col gap-2 p-3 bg-slate-50/70 border border-slate-200/50 rounded-xl shadow-3xs text-left" onClick={(e) => e.stopPropagation()}>
                          <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider flex items-center gap-1.5 mb-1 select-none">
                            <Activity size={12} className="text-indigo-500" />
                            {lang === 'zh' ? '教学环节 (点击切换)' : 'Timeline Segments'}
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {timelineSegments.map((seg, idx) => (
                              <button
                                key={seg.id || idx}
                                onClick={() => setActiveSegmentId(seg.id)}
                                className={`px-2.5 py-1 text-xs font-semibold rounded-lg border transition-all cursor-pointer shadow-3xs ${seg.color} ${activeSegmentId === seg.id ? 'ring-2 ring-indigo-500 scale-[1.02] shadow-sm border-indigo-400 font-bold' : 'opacity-85 hover:opacity-100'}`}
                              >
                                {seg.title} ({seg.duration})
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Learning Progress Slider Feedback Widget */}
                      <div className="mb-4 bg-slate-50 p-2.5 rounded-xl border border-slate-200/60 shadow-3xs flex flex-col gap-1.5 text-left select-none">
                        <div className="flex justify-between items-center text-[10px] font-bold text-gray-500">
                          <span className="flex items-center gap-1">
                            <Activity size={12} className="text-indigo-500 animate-pulse" />
                            {lang === 'zh' ? '自主学习进度反馈' : 'Learning Progress'}
                          </span>
                          <span className="font-mono text-indigo-600 font-extrabold">{localProgressPercent}%</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <input 
                            type="range" 
                            min="0" 
                            max="100" 
                            value={localProgressPercent} 
                            onChange={(e) => {
                              const val = parseInt(e.target.value);
                              setLocalProgressPercent(val);
                            }}
                            onMouseUp={() => updateStudentProgress(localProgressPercent)}
                            onTouchEnd={() => updateStudentProgress(localProgressPercent)}
                            className="flex-grow h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                          />
                          <button
                            onClick={() => {
                              setLocalProgressPercent(100);
                              updateStudentProgress(100);
                            }}
                            className={`text-[9px] font-bold rounded-lg px-2 py-1 transition-all ${
                              localProgressPercent === 100 
                                ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                                : 'bg-white hover:bg-slate-50 text-slate-650 border border-slate-200 hover:border-indigo-200 shadow-3xs cursor-pointer'
                            }`}
                          >
                            {lang === 'zh' ? '已完成' : 'Done'}
                          </button>
                        </div>
                      </div>

                      <Markdown>{lessons.find(l => l.id === selectedLesson)?.content || ''}</Markdown>
                    </div>
                  </div>
                  <div className={`${(isStudentLessonContentCollapsed || studentFullscreenPanel === 'right') ? 'w-full flex-grow' : 'flex-grow flex-1'} relative flex flex-col min-h-0 ${studentFullscreenPanel === 'left' ? 'hidden' : ''} transition-all duration-300`}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                         <button
                           onClick={() => setIsStudentLessonContentCollapsed(!isStudentLessonContentCollapsed)}
                           className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-indigo-50 text-indigo-700 rounded-lg hover:bg-indigo-100 transition-colors border border-indigo-100/80 cursor-pointer shadow-3xs"
                           title={isStudentLessonContentCollapsed ? "展开课程内容" : "折叠课程内容"}
                         >
                           <BookOpen size={13} className="text-indigo-650" />
                           <span>{isStudentLessonContentCollapsed ? (lang === 'zh' ? '展开课程内容' : 'Expand Content') : (lang === 'zh' ? '折叠课程内容' : 'Collapse Content')}</span>
                         </button>
                         <button onClick={() => setStudentLessonTab('whiteboard')} className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${studentLessonTab === 'whiteboard' ? 'bg-indigo-50 text-indigo-700 shadow-sm' : 'text-gray-500 hover:bg-gray-100'}`}>Interactive Whiteboard</button>
                         <button onClick={() => setStudentLessonTab('courseware')} className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${studentLessonTab === 'courseware' ? 'bg-indigo-50 text-indigo-700 shadow-sm' : 'text-gray-500 hover:bg-gray-100'}`}>Interactive Courseware Viewer</button>
                          <button onClick={() => setStudentLessonTab('assignment')} className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${studentLessonTab === 'assignment' ? 'bg-indigo-50 text-indigo-700 shadow-sm' : 'text-gray-500 hover:bg-gray-100'}`}>{lang === 'zh' ? '作业提交与互评' : 'Assignments & Peer Reviews'}</button>
                      </div>
                      
                      <button
                        onClick={() => setStudentFullscreenPanel(p => p === 'right' ? 'none' : 'right')}
                        className="p-1 hover:bg-gray-100 text-gray-400 hover:text-gray-700 rounded transition-colors cursor-pointer flex items-center gap-1"
                        title={studentFullscreenPanel === 'right' ? "退出全屏" : "全屏"}
                      >
                        {studentFullscreenPanel === 'right' ? (
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
                    {studentLessonTab === 'whiteboard' && (
                       <LazyWhiteboard
lessonId={selectedLesson}
elements={elements}
userRole={activeRole}
activeSegmentId={activeSegmentId}
onSegmentSync={(segId: string) => setActiveSegmentId(segId)}
onElementUpdate={async () => { /* readonly or sync */ }}
onElementDelete={async (elementId: string) => {
                             await fetch(`/api/lessons/${selectedLesson}/whiteboard/${elementId}`, { method: 'DELETE' });
                             fetchElements(selectedLesson);
                           }}
onClearBoard={async () => {
                             await fetch(`/api/lessons/${selectedLesson}/whiteboard`, { method: 'DELETE' });
                             fetchElements(selectedLesson);
                           }}
onElementAdd={async () => { /* readonly or sync */ }}
onRefresh={() => fetchElements(selectedLesson)}
/>
                    )}
                    {studentLessonTab === 'courseware' && (
                       <div className="flex-1 flex gap-4 min-h-0">
                         {/* Courseware Selector Sidebar */}
                         <div className="w-48 flex-shrink-0 bg-gray-50 border border-gray-200 rounded-lg p-3 flex flex-col min-h-0">
                            <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2 border-b border-gray-200 pb-2">Cloud Apps</h4>
                            <div className="flex-1 overflow-y-auto space-y-1">
                               {currentVfsParent !== null && (
                                  <button onClick={() => setCurrentVfsParent(null)} className="flex items-center gap-2 p-1.5 text-xs text-indigo-600 w-full hover:bg-gray-200 rounded mb-1 font-medium">
                                    <ChevronRight className="rotate-180" size={14} /> Back to Root
                                  </button>
                               )}
                               {vfsNodes.filter(n => n.type === 'dir').map(node => (
                                  <button
                                    key={node.id}
                                    onClick={() => setCurrentVfsParent(node.id)}
                                    className="w-full text-left p-1.5 rounded text-xs text-gray-700 hover:bg-gray-200 flex items-center gap-2 group truncate"
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
                                       onClick={() => setStudentSelectedCourseware(node.id)}
                                       className={`w-full text-left p-2 rounded text-xs flex items-center gap-2 truncate transition-colors ${studentSelectedCourseware === node.id ? 'bg-indigo-100 text-indigo-700 font-medium' : 'text-gray-600 hover:bg-gray-100'}`}
                                       title={node.name}
                                     >
                                        <Globe size={14} className="shrink-0" />
                                        <span className="truncate">{node.name}</span>
                                     </button>
                                  ))
                                )}
                             </div>
                             <div className="mt-2 text-[10px] text-gray-400 leading-tight">Note: Showing HTML courseware from current OS drive directory. Ask agent to generate courseware.</div>
                          </div>
                          <div className="flex-1 relative bg-white min-h-0">
                             <LazyCourseware
coursewareId={studentSelectedCourseware}
onClose={() => setStudentSelectedCourseware(null)}
/>
                          </div>
                       </div>
                    )}
                    {studentLessonTab === 'assignment' && (
                       <StudentAssignmentEvalPanel
                         lessonId={selectedLesson}
                         studentId={activeStudentId}
                         lang={lang}
                         addToast={addToast}
                       />
                    )}
                  </div>
                </div>
              </div>
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
              <div className="space-y-8">
                {/* Dashboard Header */}
                <div className="flex items-center gap-4 border-b border-gray-200 pb-4">
                  <div className="h-16 w-16 bg-indigo-600 rounded-full flex items-center justify-center text-white text-2xl font-bold shadow-lg">
                    {students.find(s => s.id === activeStudentId)?.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold text-gray-800">Welcome, {students.find(s => s.id === activeStudentId)?.name}</h2>
                    <p className="text-gray-500">Here is your learning summary.</p>
                  </div>
                </div>

                {(() => {
                  const rollcalls = studentDashboardData?.rollcalls || [];
                  const unreadRCs = rollcalls.filter((r: any) => !readNotifications.has(r.id));
                  if (unreadRCs.length === 0) return null;
                  
                  return (
                    <div className="space-y-4">
                      {unreadRCs.map((r: any) => (
                        <motion.div
                          key={r.id}
                          initial={{ scale: 0.95, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          className="bg-amber-500 rounded-2xl p-6 text-white shadow-xl relative overflow-hidden"
                        >
                          <div className="absolute -right-10 -bottom-10 w-40 h-40 bg-white/10 rounded-full blur-2xl animate-pulse" />
                          <div className="absolute -left-10 -top-10 w-32 h-32 bg-yellow-300/20 rounded-full blur-xl" />
                          
                          <div className="flex flex-col md:flex-row items-center justify-between gap-4 relative z-10">
                            <div className="flex items-center gap-4">
                              <div className="p-3 bg-white/20 backdrop-blur-md rounded-xl animate-bounce shrink-0">
                                <Sparkles className="h-6 w-6 text-yellow-100" />
                              </div>
                              <div>
                                <h3 className="text-lg font-bold tracking-tight">
                                  {lang === 'zh' ? '⚡️ 闪电提问点名中，请立即回应！' : '⚡️ Active Classroom Roll Call Alarm!'}
                                </h3>
                                <p className="text-yellow-50 text-sm mt-1 max-w-xl font-medium">
                                  {lang === 'zh'
                                    ? `您刚才在课程"${r.lesson_title || '课堂'}"中被老师随机选中。大屏已同步闪烁您的姓名，请点击右侧按钮确认专注参与！`
                                    : `You have been randomly selected by the teacher in lesson "${r.lesson_title || 'Class'}". Please click the button to confirm your presence and active attention!`}
                                </p>
                              </div>
                            </div>
                            <button
                              onClick={async () => {
                                try {
                                  await fetch(`/api/students/${activeStudentId}/read_notifications`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ notificationId: r.id })
                                  });
                                  setReadNotifications(prev => {
                                    const next = new Set(prev);
                                    next.add(r.id);
                                    return next;
                                  });
                                  addToast(
                                    lang === 'zh' ? '已确认参与状态' : 'Presence confirmed',
                                    lang === 'zh' ? '成功！已安全同步并确认在线。' : 'Successfully synchronized and confirmed active presence.',
                                    'success'
                                  );
                                } catch (e) {
                                  console.error('Failed to acknowledge rollcall', e);
                                }
                              }}
                              className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs uppercase tracking-wider rounded-xl shadow-lg ring-2 ring-white/20 active:scale-95 transition-all flex items-center gap-2 cursor-pointer shrink-0"
                            >
                              <Check size={14} />
                              <span>{lang === 'zh' ? '🙋‍♂️ 我已就位 / 确认听讲' : '🙋‍♂️ Present & Alert'}</span>
                            </button>
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  );
                })()}

                {/* Course List / Progress */}
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm flex flex-col">
                  <div className="p-4 border-b border-gray-100 flex items-center gap-2">
                     <BookOpen size={18} className="text-teal-500" />
                     <h3 className="font-semibold text-gray-800">My Independent Courses</h3>
                  </div>
                  <div className="p-4">
                    {studentDashboardData.progress && studentDashboardData.progress.length === 0 ? (
                      <div className="text-center p-8 text-gray-400 italic text-sm">No courses assigned yet.</div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {studentDashboardData.progress?.map((p: any) => (
                          <div key={p.lesson_id} className="flex flex-col p-4 rounded-xl border border-gray-100 bg-gray-50 hover:border-teal-200 hover:shadow-sm transition-all focus:outline-none">
                             <div className="flex justify-between items-start mb-3">
                                <div className="font-semibold text-gray-800 text-lg">{p.lesson_title}</div>
                                {p.completed === 1 && <span className="bg-green-100 text-green-800 text-[10px] px-1.5 py-0.5 rounded uppercase font-bold">Completed</span>}
                             </div>
                             <div className="flex items-center gap-3 mb-4">
                                <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden shrink-0">
                                  <div className={`h-full ${p.progress_percent === 100 ? 'bg-green-500' : 'bg-teal-500'}`} style={{ width: `${p.progress_percent}%` }}></div>
                                </div>
                                <span className="text-xs text-gray-500 font-medium shrink-0">{p.progress_percent}%</span>
                             </div>
                             <button
                               onClick={() => {
                                 setSelectedLesson(p.lesson_id);
                                 setStudentViewStatus('lesson');
                               }}
                             className="w-full flex justify-center items-center gap-2 bg-teal-500 hover:bg-teal-600 text-white px-4 py-2 rounded-lg text-sm font-semibold shadow-sm transition-colors mt-auto"
                             >
                               {p.progress_percent === 0 ? <><PlayCircle size={16} /> Start Learning</> : <><PlayCircle size={16} /> Continue</>}
                             </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Quick Stats */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: 0.05 }}
                    className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex flex-col items-center justify-center hover:border-indigo-300 hover:shadow-md transition-all duration-300"
                  >
                    <span className="text-3xl font-bold text-indigo-600">
                      <AnimatedCounter value={studentDashboardData.classes?.length || 0} />
                    </span>
                    <span className="text-sm font-medium text-gray-500 mt-1 uppercase tracking-wider text-center select-none">Enrolled Classes</span>
                  </motion.div>

                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: 0.1 }}
                    className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex flex-col items-center justify-center hover:border-teal-300 hover:shadow-md transition-all duration-300"
                  >
                    <span className="text-3xl font-bold text-teal-600">
                      <AnimatedCounter value={studentDashboardData.assignments?.filter((a: any) => a.submission_status === 'graded').length || 0} />
                    </span>
                    <span className="text-sm font-medium text-gray-500 mt-1 uppercase tracking-wider text-center select-none">Completed Assignments</span>
                  </motion.div>

                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: 0.15 }}
                    className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex flex-col items-center justify-center hover:border-amber-300 hover:shadow-md transition-all duration-300"
                  >
                    <span className="text-3xl font-bold text-amber-500">
                      <AnimatedCounter value={studentDashboardData.assignments?.filter((a: any) => !a.submission_status).length || 0} />
                    </span>
                    <span className="text-sm font-medium text-gray-500 mt-1 uppercase tracking-wider text-center select-none">Pending Assignments</span>
                  </motion.div>

                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: 0.2 }}
                    className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex flex-col items-center justify-center hover:border-pink-300 hover:shadow-md transition-all duration-300"
                  >
                    <span className="text-3xl font-bold text-pink-600">
                      <AnimatedCounter value={studentDashboardData.schedules?.length || 0} />
                    </span>
                    <span className="text-sm font-medium text-gray-500 mt-1 uppercase tracking-wider text-center select-none">Upcoming Lessons</span>
                  </motion.div>
                </div>

                {/* Historical Semester Grade Performance Trend Chart Component */}
                <motion.div
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: 0.1, ease: 'easeOut' }}
                >
                  <SemesterGradeTrendChart assignments={studentDashboardData.assignments} lang={lang} />
                </motion.div>

                {/* 3-Month Historical Performance Line Chart */}
                <motion.div
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: 0.2, ease: 'easeOut' }}
                >
                  <RecentThreeMonthsPerformanceChart assignments={studentDashboardData.assignments} lang={lang} />
                </motion.div>

                {/* Academic Growth Trajectory Cumulative Average Progression Chart */}
                <motion.div
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: 0.25, ease: 'easeOut' }}
                >
                  <AcademicGrowthTrajectoryChart assignments={studentDashboardData.assignments} lang={lang} />
                </motion.div>

                {/* Visual Performance History Timeline & Chronological Chart Component */}
                <motion.div
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: 0.3, ease: 'easeOut' }}
                >
                  <StudentGradedTimeline assignments={studentDashboardData.assignments} />
                </motion.div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  
                  {/* Schedules / Timetable */}
                  <div className="bg-white rounded-xl border border-gray-200 shadow-sm flex flex-col">
                    <div className="p-4 border-b border-gray-100 flex items-center gap-2">
                       <CalendarIcon size={18} className="text-pink-500" />
                       <h3 className="font-semibold text-gray-800">My Schedule</h3>
                    </div>
                    <div className="p-4 flex-1">
                      {studentDashboardData.schedules.length === 0 ? (
                        <div className="text-center p-8 text-gray-400 italic text-sm">No upcoming classes.</div>
                      ) : (
                        <div className="space-y-3">
                          {studentDashboardData.schedules.map((sch: any) => (
                            <div key={sch.id} className="flex flex-col p-3 rounded-lg border border-pink-100 bg-pink-50/30">
                               <div className="flex justify-between items-start mb-2">
                                  <div>
                                    <div className="font-semibold text-gray-800">{sch.lesson_title}</div>
                                    <div className="text-xs text-gray-500">{sch.class_name}</div>
                                  </div>
                                  <div className="bg-pink-100 text-pink-700 px-2 py-1 inline-block rounded text-xs font-bold font-mono tracking-tight">
                                     {sch.scheduled_date}
                                  </div>
                               </div>
                               <div className="flex justify-between items-end mt-2">
                                 {sch.attendance_status ? (
                                    <div className="text-xs text-gray-600 font-medium">
                                      Attendance: <span className={`uppercase font-bold ${sch.attendance_status === 'present' ? 'text-green-600' : sch.attendance_status === 'late' ? 'text-amber-600' : 'text-red-600'}`}>{sch.attendance_status}</span>
                                    </div>
                                 ) : (
                                    <div className="text-xs text-gray-400 italic">Attendance not yet recorded.</div>
                                 )}
                                 <button
                                   onClick={() => {
                                     setSelectedLesson(sch.lesson_id);
                                     setStudentViewStatus('lesson');
                                   }}
                                   className="flex items-center gap-1 bg-pink-500 hover:bg-pink-600 text-white px-3 py-1.5 rounded text-xs font-semibold shadow-sm transition-colors"
                                 >
                                   <PlayCircle size={14} /> Join Class
                                 </button>
                               </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Assignments */}
                  <div className="bg-white rounded-xl border border-gray-200 shadow-sm flex flex-col">
                    <div className="p-4 border-b border-gray-100 flex items-center gap-2">
                       <ClipboardList size={18} className="text-indigo-500" />
                       <h3 className="font-semibold text-gray-800">My Assignments</h3>
                    </div>
                    <div className="p-4 flex-1">
                      {studentDashboardData.assignments.length === 0 ? (
                        <div className="text-center p-8 text-gray-400 italic text-sm">No assignments given.</div>
                      ) : (
                        <div className="space-y-3">
                          {studentDashboardData.assignments.map((ast: any) => (
                            <div key={ast.id} className="flex flex-col p-3 rounded-lg border border-gray-100 bg-gray-50 hover:bg-gray-100 transition-colors">
                               <div className="flex justify-between items-start mb-1">
                                  <div className="font-semibold text-indigo-900">{ast.title}</div>
                                  {!ast.submission_status && <span className="bg-amber-100 text-amber-800 text-[10px] px-1.5 py-0.5 rounded uppercase font-bold">Pending</span>}
                                  {ast.submission_status === 'submitted' && <span className="bg-blue-100 text-blue-800 text-[10px] px-1.5 py-0.5 rounded uppercase font-bold">Awaiting Grade</span>}
                                  {ast.submission_status === 'graded' && (
                                    <div className="flex items-center gap-1.5 shrink-0 relative group/ast-badge">
                                      {ast.graded_at && (
                                        <div className="text-gray-400 hover:text-indigo-600 transition-colors cursor-help p-0.5">
                                          <Clock size={11} />
                                          <div className="absolute right-0 bottom-full mb-1.5 hidden group-hover/ast-badge:block bg-gray-900 text-white text-[10px] p-2 rounded-xl shadow-xl z-25 whitespace-nowrap font-sans font-normal normal-case">
                                            {lang === 'zh' 
                                              ? `评审反馈时间: ${new Date(ast.graded_at).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` 
                                              : `Feedback Hour: ${new Date(ast.graded_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`}
                                            <div className="absolute top-full right-2 -mt-1 border-4 border-transparent border-t-gray-900" />
                                          </div>
                                        </div>
                                      )}
                                      <span className="bg-green-100 text-green-800 text-[10px] px-1.5 py-0.5 rounded uppercase font-bold text-center">Score: {ast.score}%</span>
                                    </div>
                                  )}
                               </div>
                               <div className="text-xs text-gray-500 mb-2">{ast.class_name} &middot; <span className="text-gray-400 italic">{ast.content}</span></div>
                               
                               {ast.submission_status === 'graded' && ast.feedback && (
                                 <div className="mt-2 bg-green-50 p-2.5 rounded-lg border border-green-100 flex flex-col gap-1 text-xs text-green-800">
                                   <div className="flex items-center justify-between gap-2 border-b border-green-100/50 pb-1 mb-0.5">
                                     <div className="flex items-center gap-1 font-semibold">
                                       <CheckCircle2 size={13} className="shrink-0 text-green-600" />
                                       <span>{lang === 'zh' ? '教师评审意见' : 'Teacher Feedback'}</span>
                                     </div>
                                     {ast.graded_at && (
                                       <div className="flex items-center gap-1 text-[9px] text-green-600 font-mono bg-white/70 px-1.5 py-0.5 rounded border border-green-100/50 relative group/ast-time cursor-help">
                                         <Clock size={10} className="inline" />
                                         <span>
                                           {new Date(ast.graded_at).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric' })}
                                         </span>
                                         <div className="absolute right-0 bottom-full mb-1.5 hidden group-hover/ast-time:block bg-gray-900 text-white text-[10px] p-2 rounded-lg shadow-xl z-20 whitespace-nowrap font-sans font-normal text-left">
                                           {lang === 'zh' 
                                             ? `评审反馈于: ${new Date(ast.graded_at).toLocaleString('zh-CN')}` 
                                             : `Feedback provided on: ${new Date(ast.graded_at).toLocaleString('en-US')}`}
                                           <div className="absolute top-full right-3 -mt-1 border-4 border-transparent border-t-gray-900" />
                                         </div>
                                       </div>
                                     )}
                                   </div>
                                   <span className="leading-snug bg-green-50/20 rounded p-1 text-xs text-gray-700 whitespace-pre-wrap">{ast.feedback}</span>
                                 </div>
                               )}
                               
                               {!ast.submission_status && (
                                  <div className="mt-2 text-right flex items-center justify-end gap-2">
                                    <button 
                                      onClick={() => {
                                        setSelectedAssignment(ast);
                                        setStudentViewStatus('assignment');
                                        setQuizStudentAnswers({});
                                        setSubAssignmentTab('quiz');
                                      }}
                                      className="px-3 py-1.5 bg-indigo-100 text-indigo-700 hover:bg-indigo-200 text-xs rounded shadow-sm focus:outline-none transition-colors font-medium flex items-center gap-1.5"
                                    >
                                      <PenTool size={14} /> Open Canvas
                                    </button>
                                  </div>
                               )}
                               {ast.submission_status && (
                                  <div className="mt-2 text-right">
                                    <button 
                                      onClick={() => {
                                        setSelectedAssignment(ast);
                                        setStudentViewStatus('assignment');
                                        setSubAssignmentTab('quiz');
                                        if (ast.submission_content) {
                                          try {
                                            setQuizStudentAnswers(JSON.parse(ast.submission_content));
                                          } catch (e) {
                                            setQuizStudentAnswers({});
                                          }
                                        } else {
                                          setQuizStudentAnswers({});
                                        }
                                      }}
                                      className="px-3 py-1.5 bg-gray-100 text-gray-700 hover:bg-gray-200 text-xs rounded shadow-sm focus:outline-none transition-colors font-medium flex items-center gap-1.5 ml-auto"
                                    >
                                      <FileBadge size={14} /> View Submission
                                    </button>
                                  </div>
                               )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  
                </div>
              </div>
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
              'timetable', 'admin_directory', 'settings', 'help', 'computer_labs'].includes(teacherTab) ? null : (
              <ExtensionPointRenderer slot="teacher.tab" />
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
              <div className="flex-1 flex flex-col min-h-0 min-w-0 bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
                <div className="p-4 border-b border-gray-100 flex items-center justify-between shrink-0 bg-gray-50/50">
                    <div className="flex items-center gap-3 min-w-0">
                      <h3 className="font-semibold text-gray-700 flex items-center gap-2 truncate">
                        <Wand2 size={18} className="text-indigo-600 shrink-0" />
                        <span className="truncate">Lesson Editor: {lessons.find(l => l.id === selectedLesson)?.title || 'No Lesson Selected'}</span>
                      </h3>
                      {selectedLesson && (
                        <div className="hidden sm:flex items-center gap-1.5 shrink-0 ml-2">
                          {editorSaveStatus === 'saving' && (
                            <div className="flex items-center gap-1 text-[11px] font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full animate-pulse">
                              <Loader2 size={10} className="animate-spin text-amber-600" />
                              <span>{lang === 'zh' ? '正在保存到 SQLite...' : 'Saving to SQLite...'}</span>
                            </div>
                          )}
                          {editorSaveStatus === 'saved' && (
                            <div className="flex items-center gap-1 text-[11px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-250 px-2 py-0.5 rounded-full">
                              <CheckCircle2 size={11} className="text-emerald-600" />
                              <span>{lang === 'zh' ? '已成功同步至 SQLite' : 'Saved to SQLite'}</span>
                              {editorLastSavedTime && (
                                <span className="text-emerald-500/80 text-[10px] ml-0.5 font-mono font-medium">
                                  {editorLastSavedTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                </span>
                              )}
                            </div>
                          )}
                          {editorSaveStatus === 'error' && (
                            <div className="flex items-center gap-1 text-[11px] font-medium text-rose-700 bg-rose-50 border border-rose-250 px-2 py-0.5 rounded-full">
                              <X size={11} className="text-rose-600" />
                              <span>{lang === 'zh' ? 'SQLite 写入失败' : 'Failed to save to SQLite'}</span>
                            </div>
                          )}
                          {editorSaveStatus === 'none' && (
                            <div className="flex items-center gap-1 text-[11px] font-medium text-gray-500 bg-gray-50 border border-gray-200 px-2 py-0.5 rounded-full">
                              <Database size={11} className="text-gray-400" />
                              <span>{lang === 'zh' ? 'SQLite 备课库已就绪' : 'SQLite DB Ready'}</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                   <div className="flex items-center gap-2">
                     {selectedLesson && (
                       <button
                         onClick={() => {
                           setIsLessonPreviewVisible(true);
                           setPreviewLessonTab('whiteboard');
                           setPreviewSelectedCourseware(null);
                         }}
                         className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 shadow-sm transition-all cursor-pointer"
                       >
                         <Eye size={13} />
                         以学生视角预览
                       </button>
                     )}
                     <button onClick={() => setTeacherTab('courses')} className="px-3 py-1.5 bg-gray-100 text-gray-600 text-xs font-medium rounded-lg hover:bg-gray-200 transition-colors">Back to Courses</button>
                   </div>
                </div>
                <div className="flex-1 flex overflow-hidden">
                    <div className="w-1/4 min-w-[210px] max-w-[260px] border-r border-gray-200 bg-slate-50/75 p-4 overflow-y-auto flex flex-col gap-4">
                      <div>
                        <h3 className="font-bold text-gray-800 text-xs xl:text-sm uppercase tracking-wider flex items-center gap-1.5 mb-1.5">
                          <Blocks size={14} className="text-indigo-600" />
                          {lang === 'zh' ? '备课画板组件' : 'Drag Components'}
                        </h3>
                        <p className="text-[10px] text-gray-500 leading-tight">
                          {lang === 'zh' ? '拖拽下方教具组件到右侧画板中，可实时推送并同步给所有在线学生！' : 'Drag any component to the whiteboard on the right to sync instantly with students.'}
                        </p>
                      </div>
                      <div className="grid grid-cols-2 gap-2.5 overflow-y-auto">
                        <div draggable onDragStart={(e) => { 
                           const dataStr = JSON.stringify({ type: 'code-sandbox', code: "console.log('Hello Sandbox!');" }); e.dataTransfer.effectAllowed = 'copy'; e.dataTransfer.setData('application/json', dataStr); e.dataTransfer.setData('text/plain', dataStr); e.dataTransfer.setData('text', dataStr);
                           e.dataTransfer.setData('application/json', dataStr); 
                           e.dataTransfer.setData('text/plain', dataStr);
                        }} className="bg-white border border-gray-200/80 p-3 rounded-xl shadow-sm hover:border-indigo-400 hover:shadow-md hover:scale-[1.03] transition-all cursor-grab active:cursor-grabbing flex flex-col items-center justify-center gap-1.5 aspect-square text-center group" >
                           <div className="p-1.5 bg-slate-50 text-gray-500 rounded-lg group-hover:bg-indigo-50 group-hover:text-indigo-650 transition-colors">
                             <Terminal size={18} />
                           </div>
                           <span className="font-semibold text-[10px] text-gray-700 group-hover:text-indigo-650 transition-colors">{lang === 'zh' ? '代码沙箱' : 'Code Editor'}</span>
                        </div>
                        <div draggable onDragStart={(e) => { 
                           const dataStr = JSON.stringify({ type: 'math-graph', equation: "Math.sin(x)" }); e.dataTransfer.effectAllowed = 'copy'; e.dataTransfer.setData('application/json', dataStr); e.dataTransfer.setData('text/plain', dataStr); e.dataTransfer.setData('text', dataStr);
                           e.dataTransfer.setData('application/json', dataStr); 
                           e.dataTransfer.setData('text/plain', dataStr);
                        }} className="bg-white border border-gray-200/80 p-3 rounded-xl shadow-sm hover:border-indigo-400 hover:shadow-md hover:scale-[1.03] transition-all cursor-grab active:cursor-grabbing flex flex-col items-center justify-center gap-1.5 aspect-square text-center group" >
                           <div className="p-1.5 bg-slate-50 text-gray-500 rounded-lg group-hover:bg-indigo-50 group-hover:text-indigo-650 transition-colors">
                             <Activity size={18} />
                           </div>
                           <span className="font-semibold text-[10px] text-gray-700 group-hover:text-indigo-650 transition-colors">{lang === 'zh' ? '数学函数' : 'Math Grapher'}</span>
                        </div>
                        <div draggable onDragStart={(e) => { 
                           const dataStr = JSON.stringify({ type: 'presentation', markdown: "# Title Slide\n---\n## Slide 2" }); e.dataTransfer.effectAllowed = 'copy'; e.dataTransfer.setData('application/json', dataStr); e.dataTransfer.setData('text/plain', dataStr); e.dataTransfer.setData('text', dataStr);
                           e.dataTransfer.setData('application/json', dataStr); 
                           e.dataTransfer.setData('text/plain', dataStr);
                        }} className="bg-white border border-gray-200/80 p-3 rounded-xl shadow-sm hover:border-indigo-400 hover:shadow-md hover:scale-[1.03] transition-all cursor-grab active:cursor-grabbing flex flex-col items-center justify-center gap-1.5 aspect-square text-center group" >
                           <div className="p-1.5 bg-slate-50 text-gray-500 rounded-lg group-hover:bg-indigo-50 group-hover:text-indigo-650 transition-colors">
                             <Presentation size={18} />
                           </div>
                           <span className="font-semibold text-[10px] text-gray-700 group-hover:text-indigo-650 transition-colors">{lang === 'zh' ? '课件演示' : 'Slides Deck'}</span>
                        </div>
                        <div draggable onDragStart={(e) => { 
                           const dataStr = JSON.stringify({ type: 'quiz', question: "New Quiz" }); e.dataTransfer.effectAllowed = 'copy'; e.dataTransfer.setData('application/json', dataStr); e.dataTransfer.setData('text/plain', dataStr); e.dataTransfer.setData('text', dataStr);
                           e.dataTransfer.setData('application/json', dataStr); 
                           e.dataTransfer.setData('text/plain', dataStr);
                        }} className="bg-white border border-gray-200/80 p-3 rounded-xl shadow-sm hover:border-indigo-400 hover:shadow-md hover:scale-[1.03] transition-all cursor-grab active:cursor-grabbing flex flex-col items-center justify-center gap-1.5 aspect-square text-center group" >
                           <div className="p-1.5 bg-slate-50 text-gray-500 rounded-lg group-hover:bg-indigo-50 group-hover:text-indigo-650 transition-colors">
                             <Puzzle size={18} />
                           </div>
                           <span className="font-semibold text-[10px] text-gray-700 group-hover:text-indigo-650 transition-colors">{lang === 'zh' ? '随堂测试' : 'Interactive Quiz'}</span>
                        </div>
                        <div draggable onDragStart={(e) => { 
                           const dataStr = JSON.stringify({ type: 'html-applet', code: `<!-- Interactive Physics -->\n<div style='padding:20px; text-align:center;'>\n  <h2>Interactive Physics</h2>\n  <button onclick="alert('Simulating Gravity!')">Drop Ball</button>\n</div>` }); e.dataTransfer.effectAllowed = 'copy'; e.dataTransfer.setData('application/json', dataStr); e.dataTransfer.setData('text/plain', dataStr); e.dataTransfer.setData('text', dataStr);
                           e.dataTransfer.setData('application/json', dataStr); 
                           e.dataTransfer.setData('text/plain', dataStr);
                        }} className="bg-white border border-gray-200/80 p-3 rounded-xl shadow-sm hover:border-indigo-400 hover:shadow-md hover:scale-[1.03] transition-all cursor-grab active:cursor-grabbing flex flex-col items-center justify-center gap-1.5 aspect-square text-center group" >
                           <div className="p-1.5 bg-slate-50 text-gray-500 rounded-lg group-hover:bg-indigo-50 group-hover:text-indigo-650 transition-colors">
                             <Globe size={18} />
                           </div>
                           <span className="font-semibold text-[10px] text-gray-700 group-hover:text-indigo-650 transition-colors">{lang === 'zh' ? '交互实验' : 'HTML Applet'}</span>
                        </div>
                        <div draggable onDragStart={(e) => { 
                           const dataStr = JSON.stringify({ type: 'assignment', title: "New Assignment", description: "Upload your work here" }); e.dataTransfer.effectAllowed = 'copy'; e.dataTransfer.setData('application/json', dataStr); e.dataTransfer.setData('text/plain', dataStr); e.dataTransfer.setData('text', dataStr);
                           e.dataTransfer.setData('application/json', dataStr); 
                           e.dataTransfer.setData('text/plain', dataStr);
                         }} className="bg-white border border-gray-200/80 p-3 rounded-xl shadow-sm hover:border-indigo-400 hover:shadow-md hover:scale-[1.03] transition-all cursor-grab active:cursor-grabbing flex flex-col items-center justify-center gap-1.5 aspect-square text-center group" >
                            <div className="p-1.5 bg-slate-50 text-gray-500 rounded-lg group-hover:bg-indigo-50 group-hover:text-indigo-650 transition-colors">
                              <ClipboardList size={18} />
                            </div>
                            <span className="font-semibold text-[10px] text-gray-700 group-hover:text-indigo-650 transition-colors">{lang === 'zh' ? '作业提交' : 'Assignment'}</span>
                         </div>
                        <div draggable onDragStart={(e) => { 
                           const dataStr = JSON.stringify({ type: 'rollcall', allStudents: [] }); e.dataTransfer.effectAllowed = 'copy'; e.dataTransfer.setData('application/json', dataStr); e.dataTransfer.setData('text/plain', dataStr); e.dataTransfer.setData('text', dataStr);
                           e.dataTransfer.setData('application/json', dataStr); 
                           e.dataTransfer.setData('text/plain', dataStr);
                         }} className="bg-white border border-gray-200/80 p-3 rounded-xl shadow-sm hover:border-indigo-400 hover:shadow-md hover:scale-[1.03] transition-all cursor-grab active:cursor-grabbing flex flex-col items-center justify-center gap-1.5 aspect-square text-center group" >
                            <div className="p-1.5 bg-slate-50 text-gray-500 rounded-lg group-hover:bg-indigo-50 group-hover:text-indigo-650 transition-colors">
                              <Shuffle size={18} />
                            </div>
                            <span className="font-semibold text-[10px] text-gray-700 group-hover:text-indigo-650 transition-colors">{lang === 'zh' ? '随机点名' : 'Random Picker'}</span>
                         </div>
                        <div draggable onDragStart={(e) => { 
                           const dataStr = JSON.stringify({ type: 'hello-world' }); e.dataTransfer.effectAllowed = 'copy'; e.dataTransfer.setData('application/json', dataStr); e.dataTransfer.setData('text/plain', dataStr); e.dataTransfer.setData('text', dataStr);
                           e.dataTransfer.setData('application/json', dataStr); 
                           e.dataTransfer.setData('text/plain', dataStr);
                         }} className="bg-white border border-gray-200/80 p-3 rounded-xl shadow-sm hover:border-indigo-400 hover:shadow-md hover:scale-[1.03] transition-all cursor-grab active:cursor-grabbing flex flex-col items-center justify-center gap-1.5 aspect-square text-center group" >
                            <div className="p-1.5 bg-slate-50 text-gray-500 rounded-lg group-hover:bg-indigo-50 group-hover:text-indigo-650 transition-colors">
                              <Sparkles size={18} />
                            </div>
                            <span className="font-semibold text-[10px] text-gray-700 group-hover:text-indigo-650 transition-colors">{lang === 'zh' ? '问候插件' : 'Hello World'}</span>
                         </div>
                      </div>
                    </div>
                   <div className="flex-1 relative bg-white flex flex-col min-w-0 overflow-y-auto">
                     <div className="p-3 border-b border-gray-100 bg-white shrink-0 flex items-center justify-between gap-4">
                       <div className="flex items-center gap-2 flex-1 overflow-x-auto">
                       <div className="text-xs font-semibold uppercase tracking-wider text-gray-400 mr-2 shrink-0">Lesson Timeline</div>
                       <div className="flex items-center gap-2 flex-1 overflow-x-auto py-1">
                         {timelineSegments.map((seg, idx) => (
                           <div 
                             key={seg.id}
                             draggable
                             onDragStart={(e) => {
                               setDraggedSegmentIdx(idx);
                               e.dataTransfer.effectAllowed = 'move';
                               e.dataTransfer.setData('text/plain', idx.toString());
                             }}
                             onDragOver={(e) => e.preventDefault()}
                             onDrop={(e) => {
                               e.preventDefault();
                               if (draggedSegmentIdx === null) return;
                               if (draggedSegmentIdx === idx) return;
                               const newSegments = [...timelineSegments];
                               const [removed] = newSegments.splice(draggedSegmentIdx, 1);
                               newSegments.splice(idx, 0, removed);
                               setTimelineSegments(newSegments);
                               setDraggedSegmentIdx(null);
                               if (selectedLesson) {
                                 saveTimeline(selectedLesson, newSegments);
                               }
                             }}
                             onClick={() => {
                               setActiveSegmentId(seg.id);
                             }}
                             className={`px-3 py-1.5 rounded-lg border text-sm font-medium flex items-center gap-2 cursor-grab active:cursor-grabbing transition-all hover:shadow-sm whitespace-nowrap ${seg.color} ${draggedSegmentIdx === idx ? 'opacity-40 border-dashed' : ''} ${activeSegmentId === seg.id ? 'ring-2 ring-indigo-500 scale-[1.03] shadow-md border-indigo-400 font-bold' : ''}`}
                           >
                             <span className="opacity-50 text-xl leading-none -mt-1 cursor-grab" title="Drag to reorder">⋮⋮</span>
                              {seg.notes && (
                                <span title={`备注: ${seg.notes}`} className="inline-flex"><FileText size={11} className="text-amber-600 inline-block min-w-[11px] shrink-0 fill-current" /></span>
                              )}
                             {seg.title}
                             <span className="text-[10px] opacity-70 bg-white/50 px-1.5 py-0.5 rounded ml-1">{seg.duration}</span>
                           </div>
                         ))}
                         
                         {selectedLesson && (
                           <button
                             onClick={() => {
                               const newSegId = 'seg-' + Math.random().toString(36).slice(2, 9);
                               const newSeg = {
                                 id: newSegId,
                                 title: `新环节 ${timelineSegments.length + 1}`, notes: '',
                                 type: 'lecture',
                                 duration: '10m',
                                 color: 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100'
                               };
                               const updated = [...timelineSegments, newSeg];
                               saveTimeline(selectedLesson, updated);
                               setActiveSegmentId(newSegId);
                             }}
                             className="px-3 py-1.5 rounded-lg border border-dashed border-gray-300 text-xs font-semibold text-gray-500 hover:border-indigo-400 hover:text-indigo-600 transition-colors flex items-center gap-1 shrink-0 bg-white cursor-pointer"
                             title="Add new segment"
                           >
                             <Plus size={14} /> 新增环节
                           </button>
                         )}
                       </div>
                     </div>
                     <button
                       onClick={() => setEditorPanelsExpanded(p => !p)}
                       className="px-3 py-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-gray-600 text-xs font-semibold rounded-lg shadow-sm transition-all cursor-pointer flex items-center gap-1.5 shrink-0"
                     >
                       <Settings2 size={12} className={editorPanelsExpanded ? "text-indigo-650" : "text-gray-500"} />
                       <span>{editorPanelsExpanded ? (lang === 'zh' ? "隐藏设置" : "Hide Settings") : (lang === 'zh' ? "展开设置" : "Show Settings")}</span>
                     </button>
                    </div>

                     {/* Timeline Segment Editor Panel */}
                     {selectedLesson && activeSegmentId && editorPanelsExpanded && (
                       <div className="flex flex-col p-3 gap-2.5 bg-gray-50 border-b border-gray-100 text-xs text-gray-600 shrink-0">
                         <div className="flex flex-wrap items-center gap-2">
                           <span className="font-semibold text-gray-700 flex items-center gap-1">
                             ⚡ 环节设置: {timelineSegments.find(s => s.id === activeSegmentId)?.title}
                           </span>
                           <div className="flex items-center gap-1.5">
                             <span className="opacity-60">名称:</span>
                             <input 
                               type="text" 
                               value={timelineSegments.find(s => s.id === activeSegmentId)?.title || ''} 
                               onChange={(e) => {
                                 const updated = timelineSegments.map(s => s.id === activeSegmentId ? { ...s, title: e.target.value } : s);
                                 saveTimeline(selectedLesson, updated);
                               }}
                               className="border border-gray-200 px-2 py-1 rounded bg-white text-xs max-w-[120px] outline-none focus:border-indigo-400"
                             />
                           </div>
                           <div className="flex items-center gap-1.5">
                             <span className="opacity-60">时长:</span>
                             <input 
                               type="text" 
                               value={timelineSegments.find(s => s.id === activeSegmentId)?.duration || '10m'} 
                               onChange={(e) => {
                                 const updated = timelineSegments.map(s => s.id === activeSegmentId ? { ...s, duration: e.target.value } : s);
                                 saveTimeline(selectedLesson, updated);
                               }}
                               className="border border-gray-200 px-2 py-1 rounded bg-white text-xs max-w-[60px] outline-none focus:border-indigo-400"
                             />
                           </div>
                           <div className="flex items-center gap-1.5">
                             <span className="opacity-60">类型:</span>
                             <select
                               value={timelineSegments.find(s => s.id === activeSegmentId)?.type || 'lecture'}
                               onChange={(e) => {
                                 const updated = timelineSegments.map(s => s.id === activeSegmentId ? { ...s, type: e.target.value } : s);
                                 saveTimeline(selectedLesson, updated);
                               }}
                               className="border border-gray-200 px-2 py-1 rounded bg-white text-xs outline-none focus:border-indigo-400 animate-none"
                             >
                               <option value="intro">准备环节 (intro)</option>
                               <option value="lecture">讲授新课 (lecture)</option>
                               <option value="practice">互动练习 (practice)</option>
                               <option value="quiz">随堂测试 (quiz)</option>
                               <option value="summary">要点总结 (summary)</option>
                             </select>
                           </div>
                           <div className="flex items-center gap-1">
                             <span className="opacity-60 mr-1">皮肤:</span>
                             {[
                               { name: 'Blue', color: 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100' },
                               { name: 'Indigo', color: 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100' },
                               { name: 'Green', color: 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100' },
                               { name: 'Purple', color: 'bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100' },
                               { name: 'Amber', color: 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100' },
                             ].map(c => (
                               <button
                                 key={c.name}
                                 onClick={() => {
                                   const updated = timelineSegments.map(s => s.id === activeSegmentId ? { ...s, color: c.color } : s);
                                   saveTimeline(selectedLesson, updated);
                                 }}
                                 className={`w-4 h-4 rounded-full border ${c.color.split(' ')[0]} ${timelineSegments.find(s => s.id === activeSegmentId)?.color === c.color ? 'ring-2 ring-indigo-500 ring-offset-1' : ''}`}
                                 title={c.name}
                                />
                             ))}
                           </div>
                         </div>
                         <div>
                           <button
                             onClick={() => {
                               if (timelineSegments.length <= 1) {
                                 alert('无法删除！课程必须包含至少一个环节。');
                                 return;
                               }
                               if (window.confirm(`确定要删除环节"${timelineSegments.find(s => s.id === activeSegmentId)?.title}"吗？`)) {
                                 const updated = timelineSegments.filter(s => s.id !== activeSegmentId);
                                 saveTimeline(selectedLesson, updated);
                                 setActiveSegmentId(updated[0]?.id || null);
                               }
                             }}
                             className="text-red-500 hover:text-red-700 font-semibold hover:underline flex items-center gap-1 cursor-pointer"
                           >
                             <Trash2 size={12} /> 删除此环节
                            </button>
                          </div>
                          
                          {/* Notes (Instructional Reminders) Row */}
                          <div className="flex flex-col gap-1 border-t border-gray-200/60 pt-2.5 mt-1 bg-slate-50/50 -mx-3 px-3">
                            <div className="flex items-center gap-1.5 font-semibold text-gray-700">
                              <FileText size={13} className="text-amber-500 shrink-0" />
                              <span>环节备注 & 教学提示 (Instructional Notes):</span>
                            </div>
                            <textarea
                              rows={2}
                              value={timelineSegments.find(s => s.id === activeSegmentId)?.notes || ''}
                              onChange={(e) => {
                                const updated = timelineSegments.map(s => s.id === activeSegmentId ? { ...s, notes: e.target.value } : s);
                                saveTimeline(selectedLesson, updated);
                              }}
                              placeholder="在此为该环节添加教学要点、学生互动提示、教学设计分配等备注信息（将自动保存在教学大纲中）..."
                              className="w-full border border-gray-200 px-2 py-1.5 rounded bg-white text-xs outline-none focus:border-indigo-400 placeholder:text-gray-400 placeholder:italic focus:ring-1 focus:ring-indigo-100 duration-150 resize-y"
                            />
                          </div>
                          
                          <div className="hidden">
                            <button>
                           </button>
                         </div>
                       </div>
                     )} {/* 
                           >
                             <span className="opacity-50 text-xl leading-none -mt-1 cursor-grab">⋮⋮</span>
                             {seg.title}
                             <span className="text-[10px] opacity-70 bg-white/50 px-1.5 py-0.5 rounded ml-1">{seg.duration}</span>
                           </div>
                         ))}
                       </div>
                     </div>
                     */}`
                     <div className="flex-1 min-h-[500px] relative flex flex-col min-w-0">
                     {!selectedLesson ? (
                        <div className="absolute inset-0 flex items-center justify-center text-gray-400 p-8 text-center bg-gray-50">
                          <div>
                            <PenTool size={48} className="mx-auto mb-4 opacity-30" />
                            <p className="font-medium text-lg text-gray-500 mb-2">No active lesson selected</p>
                            <p className="text-sm">Please select a lesson from the Dashboard to orchestrate.</p>
                          </div>
                        </div>
                     ) : (
                        <LazyWhiteboard
lessonId={selectedLesson}
userRole={activeRole}
elements={elements}
activeSegmentId={activeSegmentId}
onSegmentSync={(segId: string) => setActiveSegmentId(segId)}
onElementAdd={async (type: string, data: any) => {
                              setEditorSaveStatus('saving');
                              try {
                                const response = await fetch(`/api/lessons/${selectedLesson}/whiteboard`, {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ type, data })
                                });
                                if (response.ok) {
                                  setEditorSaveStatus('saved');
                                  setEditorLastSavedTime(new Date());
                                  fetchElements(selectedLesson);
                                } else {
                                  setEditorSaveStatus('error');
                                }
                              } catch (err) {
                                setEditorSaveStatus('error');
                              }
                            }}
onElementUpdate={async (elementId: string, data: any) => {
                              setEditorSaveStatus('saving');
                              try {
                                const response = await fetch(`/api/lessons/${selectedLesson}/whiteboard/${elementId}`, {
                                  method: 'PUT',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ data })
                                });
                                if (response.ok) {
                                  setEditorSaveStatus('saved');
                                  setEditorLastSavedTime(new Date());
                                  fetchElements(selectedLesson);
                                } else {
                                  setEditorSaveStatus('error');
                                }
                              } catch (err) {
                                setEditorSaveStatus('error');
                              }
                            }}
onElementDelete={async (elementId: string) => {
                              setEditorSaveStatus('saving');
                              try {
                                const response = await fetch(`/api/lessons/${selectedLesson}/whiteboard/${elementId}`, {
                                  method: 'DELETE'
                                });
                                if (response.ok) {
                                  setEditorSaveStatus('saved');
                                  setEditorLastSavedTime(new Date());
                                  fetchElements(selectedLesson);
                                } else {
                                  setEditorSaveStatus('error');
                                }
                              } catch (err) {
                                setEditorSaveStatus('error');
                              }
                            }}
onClearBoard={async () => {
                              setEditorSaveStatus('saving');
                              try {
                                const response = await fetch(`/api/lessons/${selectedLesson}/whiteboard`, {
                                  method: 'DELETE'
                                });
                                if (response.ok) {
                                  setEditorSaveStatus('saved');
                                  setEditorLastSavedTime(new Date());
                                  fetchElements(selectedLesson);
                                } else {
                                  setEditorSaveStatus('error');
                                }
                              } catch (err) {
                                setEditorSaveStatus('error');
                              }
                            }}
onRefresh={() => fetchElements(selectedLesson)}
/>
                     )}
                   </div>
                   </div>
                </div>
              </div>
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
              <div className="flex-1 flex flex-col gap-6 h-full overflow-y-auto relative p-1 pr-3">

            {/* School Management Module */}
            <div className="flex-1 bg-white border border-gray-200 rounded-xl shadow-sm flex flex-col min-h-0">
              <div className="p-4 border-b border-gray-100 flex items-center justify-between shrink-0">
                <h3 className="font-medium text-gray-700 flex items-center gap-2">
                  <Users size={16} className="text-gray-400" />
                  {t.classes} & {t.students}
                </h3>
                <div className="flex items-center gap-2">
                  {expandedClassId && (
                    <div 
                      className="relative font-sans animate-in fade-in duration-200"
                      onMouseEnter={() => setExportTooltipOpen(true)}
                      onMouseLeave={() => setExportTooltipOpen(false)}
                    >
                      <AnimatePresence>
                        {exportTooltipOpen && !exportDropdownOpen && (
                          <motion.div
                            initial={{ opacity: 0, y: 8, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 4, scale: 0.95 }}
                            transition={{ duration: 0.15, ease: "easeOut" }}
                            className="absolute right-0 bottom-full mb-2.5 px-3 py-1.5 bg-slate-900 text-white text-[10px] font-semibold rounded-lg shadow-xl z-55 pointer-events-none border border-slate-800 flex items-center gap-1.5 whitespace-nowrap"
                          >
                            <span>{lang === 'zh' ? '导出所有班级的成绩数据' : 'Export grade data for all classes'}</span>
                            <div className="absolute right-8 -translate-x-1/2 top-full w-2 h-2 bg-slate-900 rotate-45 -mt-1 border-r border-b border-slate-800"></div>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      <motion.button
                        type="button"
                        id="floating-export-all-grades-btn"
                        onClick={() => setExportDropdownOpen(!exportDropdownOpen)}
                        whileHover={{ 
                          scale: 1.05, 
                          y: -1,
                          boxShadow: "0 10px 15px -3px rgba(16, 185, 129, 0.3), 0 4px 6px -4px rgba(16, 185, 129, 0.3)"
                        }}
                        whileTap={{ scale: 0.95, y: 0 }}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-linear-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-medium rounded-lg shadow-sm transition-all cursor-pointer select-none"
                      >
                        <Download size={14} className="animate-pulse" />
                        <span>{lang === 'zh' ? '一键导出所有成绩' : 'Export All Grades'}</span>
                        <ChevronDown size={12} className={`transition-transform duration-200 ${exportDropdownOpen ? 'rotate-180' : ''}`} />
                      </motion.button>
                      
                      {exportDropdownOpen && (
                        <div className="absolute right-0 mt-2 w-80 bg-white border border-gray-150 rounded-2xl shadow-2xl z-50 p-4 font-sans text-gray-800 animate-in fade-in slide-in-from-top-3 duration-200">
                          <div className="flex items-center justify-between border-b border-gray-100 pb-2 mb-3">
                            <span className="text-[11px] font-black uppercase text-slate-400 tracking-wider">
                              {lang === 'zh' ? '成绩单导出工具' : 'Grade Export Tools'}
                            </span>
                            <button 
                              type="button"
                              onClick={() => setExportDropdownOpen(false)}
                              className="text-gray-400 hover:text-gray-600 text-[10px] font-extrabold cursor-pointer"
                            >
                              ✕
                            </button>
                          </div>

                          {/* Combined Export option */}
                          <div className="mb-4">
                            <button
                              type="button"
                              onClick={handleExportAllClassesCombined}
                              disabled={isExportingAllCombined}
                              className="w-full flex items-center justify-between gap-2 p-3 bg-emerald-50 hover:bg-emerald-100/80 border border-emerald-100 text-emerald-950 rounded-xl font-bold text-xs cursor-pointer transition-all disabled:opacity-55"
                            >
                              <div className="flex items-center gap-2 text-left">
                                <Sparkles size={14} className="text-emerald-600 animate-pulse" />
                                <div>
                                  <div className="font-extrabold">{lang === 'zh' ? '全班级汇总表' : 'All Classes Multi-Sheet'}</div>
                                  <div className="text-[9px] text-emerald-600 font-medium">{lang === 'zh' ? '将所有学科班级合并至单张CSV表' : 'Consolidate everyone to a single CSV'}</div>
                                </div>
                              </div>
                              {isExportingAllCombined ? (
                                <Loader2 size={14} className="animate-spin text-emerald-600" />
                              ) : (
                                <ChevronRight size={14} className="text-emerald-500" />
                              )}
                            </button>
                          </div>

                          <div className="text-[9.5px] font-bold text-gray-400 uppercase tracking-widest mb-2 select-none">
                            {lang === 'zh' ? '选择特定学科导出' : 'Export Individual Subjects'}
                          </div>

                          {/* Classes roster */}
                          {classes.length === 0 ? (
                            <div className="text-center p-4 text-xs text-gray-400 italic">
                              {lang === 'zh' ? '暂无班级' : 'No classes available'}
                            </div>
                          ) : (
                            <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                              {classes.map((cls) => (
                                <button
                                  key={cls.id}
                                  type="button"
                                  onClick={() => triggerExportForClass(cls.id, cls.name)}
                                  disabled={loadingExportClassId === cls.id}
                                  className="w-full text-left p-2.5 rounded-xl border border-gray-100 hover:border-indigo-200 hover:bg-indigo-50/20 flex items-center justify-between cursor-pointer transition-all text-xs"
                                >
                                  <div className="min-w-0 pr-2">
                                    <div className="font-bold text-slate-800 truncate">{cls.name}</div>
                                    <div className="text-[9px] text-gray-400 mt-0.5">
                                      {(classStudentsMap[cls.id] || []).length} {lang === 'zh' ? '名学生已注册' : 'registered pupils'}
                                    </div>
                                  </div>
                                  {loadingExportClassId === cls.id ? (
                                    <Loader2 size={12} className="animate-spin text-indigo-500" />
                                  ) : (
                                    <Download className="text-gray-400 shrink-0 hover:text-indigo-600" size={12} />
                                  )}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  <button 
                    onClick={() => {
                      setImportError(null);
                      setImportSuccess(null);
                      setShowImportModal(true);
                    }} 
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition-colors border border-indigo-200 rounded-lg font-medium cursor-pointer"
                  >
                    <Upload size={14} /> {lang === 'zh' ? '手动导入数据' : 'Manual Import'}
                  </button>
                  <button
                    onClick={async () => {
                      const name = window.prompt(lang === 'zh' ? '请输入班级名称:' : 'Enter class name:');
                      if (name) {
                        const res = await fetch('/api/classes', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ name })
                        });
                        if (res.ok) await fetchClasses();
                      }
                    }}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs bg-indigo-600 text-white hover:bg-indigo-700 rounded-lg font-medium shadow-sm transition-colors cursor-pointer"
                  >
                    <Plus size={14} /> {lang === 'zh' ? '创建班级' : 'Create Class'}
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-2">
                {classes.length === 0 && students.length === 0 ? (
                   <div className="text-center p-8 text-sm text-gray-500">
                     {t.noClasses} & {t.noStudents}
                   </div>
                ) : (
                  <>
                    {classes.map(cls => {
                      const isExpanded = expandedClassId === cls.id;
                      const cStudents = classStudentsMap[cls.id] || [];
                      const activeSubmissionFilter = classSubmissionFilters[cls.id] || 'all';
                      const recentSubs = classDashboardMap[cls.id]?.recentSubmissions || [];
                      const performanceData = classDashboardMap[cls.id]?.performance || [];

                      const filteredSubmissions = (() => {
                        if (activeSubmissionFilter === 'all') {
                          return recentSubs;
                        } else if (activeSubmissionFilter === 'submitted') {
                          return recentSubs.filter((sub: any) => sub.status === 'submitted');
                        } else if (activeSubmissionFilter === 'graded') {
                          return recentSubs.filter((sub: any) => sub.status === 'graded');
                        } else if (activeSubmissionFilter === 'pending') {
                          const pendingGradingSubmissions = recentSubs.filter((sub: any) => sub.status === 'submitted');
                          const unsubmittedTasks = performanceData
                            .filter((p: any) => !p.submission_status || p.submission_status === null)
                            .map((p: any) => ({
                              assignment_id: p.assignment_id,
                              assignment_title: p.assignment_title,
                              student_id: p.student_id,
                              student_name: p.student_name,
                              content: lang === 'zh' ? '尚未提交此作业' : 'Has not submitted this assignment yet',
                              status: 'pending_student',
                            }));
                          return [...pendingGradingSubmissions, ...unsubmittedTasks];
                        }
                        return recentSubs;
                      })();
                      return (
                        <div key={cls.id} className="w-full mb-1 border-b border-gray-50 flex flex-col">
                          <div 
                            className="p-2 flex items-center justify-between cursor-pointer hover:bg-gray-50"
                            onClick={() => {
                              if (isExpanded) {
                                setExpandedClassId(null);
                              } else {
                                setExpandedClassId(cls.id);
                                fetchClassStudents(cls.id);
                                fetchClassProgress(cls.id);
                                fetchClassDashboard(cls.id);
                                fetchClassSchedules(cls.id);
                              }
                            }}
                          >
                             <div className="flex items-center gap-2">
                               {isExpanded ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
                               <div className="text-sm font-medium text-gray-800">{cls.name}</div>
                             </div>
                             <div className="text-[10px] text-gray-400">Class</div>
                          </div>
                          {isExpanded && (
                            <motion.div 
                              initial={{ opacity: 0, y: -8 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ duration: 0.3, ease: 'easeOut' }}
                              className="pl-6 bg-gray-50 pb-2 pt-2 border-t border-gray-100 pr-2"
                            >
                               {/* Class temporary passcode / Start Lesson controller */}
                               <div className="mb-4 bg-gradient-to-r from-indigo-50/70 to-violet-50/70 p-3.5 rounded-2xl border border-indigo-150/40 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 font-sans text-left" onClick={(e) => e.stopPropagation()}>
                                 <div className="space-y-1 text-left">
                                   <div className="flex items-center gap-1.5 justify-start">
                                     <span className="inline-block w-2 h-2 rounded-full bg-indigo-500 animate-pulse shrink-0" />
                                     <span className="text-xs font-black text-indigo-950 uppercase tracking-wider">{lang === 'zh' ? '临时班级密码 (支持学生快速一键密码登录)' : 'Temporary Class Passcode'}</span>
                                   </div>
                                   <p className="text-[10px] text-indigo-600/80 font-semibold leading-relaxed text-left block">
                                     {lang === 'zh' ? '开始课堂后，全班学生均可使用此特定临时密码统一安全登录，无需强制输入个人自设密码。' : 'Once set, any pupil in this class can use this temporary passcode to log in directly.'}
                                   </p>
                                 </div>
                                 <div className="flex items-center gap-1.5 shrink-0 justify-end">
                                   <input 
                                     id={`class-passcode-${cls.id}`}
                                     type="text"
                                     value={cls.class_passcode || ""}
                                     onChange={async (e) => {
                                       const val = e.target.value;
                                       await fetch(`/api/classes/${cls.id}`, {
                                         method: 'PUT',
                                         headers: { 'Content-Type': 'application/json' },
                                         body: JSON.stringify({ class_passcode: val })
                                       });
                                       await fetchClasses();
                                     }}
                                     placeholder={lang === 'zh' ? '暂未设定 / 留空禁用' : 'Disabled / Enter code'}
                                     className="border border-indigo-200/80 rounded-xl text-xs px-2.5 py-1.5 w-36 text-center bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono font-bold text-gray-800 focus:border-transparent transition-all"
                                     onClick={(e) => e.stopPropagation()}
                                   />
                                   <button
                                     onClick={async (e) => {
                                       e.stopPropagation();
                                       // Generate random 4 digit PIN
                                       const randomPin = Math.floor(1000 + Math.random() * 9000).toString();
                                       await fetch(`/api/classes/${cls.id}`, {
                                         method: 'PUT',
                                         headers: { 'Content-Type': 'application/json' },
                                         body: JSON.stringify({ class_passcode: randomPin })
                                       });
                                       await fetchClasses();
                                     }}
                                     className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-[10px] p-2 py-1.5 font-black shadow-xs transition-all hover:shadow-sm cursor-pointer shrink-0"
                                     title={lang === 'zh' ? '随机生成班级密码' : 'Generate random passcode'}
                                   >
                                     {lang === 'zh' ? '随机生成' : 'Random Gen'}
                                   </button>
                                   {cls.class_passcode && (
                                     <button
                                       onClick={async (e) => {
                                         e.stopPropagation();
                                         await fetch(`/api/classes/${cls.id}`, {
                                           method: 'PUT',
                                           headers: { 'Content-Type': 'application/json' },
                                           body: JSON.stringify({ class_passcode: null })
                                         });
                                         await fetchClasses();
                                       }}
                                       className="bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl text-[10px] p-2 py-1.5 font-bold shadow-xs transition-colors cursor-pointer shrink-0"
                                       title={lang === 'zh' ? '清除临时密码' : 'Clear temporary passcode'}
                                     >
                                       {lang === 'zh' ? '清除' : 'Clear'}
                                     </button>
                                   )}
                                 </div>
                               </div>

                               {/* Class level Tabs */}
                               <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl mb-4 max-w-md border border-slate-200/40" onClick={(e) => e.stopPropagation()}>
                                 <button
                                   onClick={(e) => {
                                     e.stopPropagation();
                                     setClassActiveTabs(prev => ({ ...prev, [cls.id]: 'students' }));
                                   }}
                                   className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all duration-200 cursor-pointer ${
                                     (classActiveTabs[cls.id] || 'students') === 'students'
                                       ? 'bg-white text-indigo-600 shadow-xs font-bold border border-slate-200/50'
                                       : 'text-slate-500 hover:text-slate-800 hover:bg-white/40'
                                   }`}
                                 >
                                   <Users size={12} />
                                   <span>{lang === 'zh' ? '学生名单' : 'Students'}</span>
                                 </button>
                                 <button
                                   onClick={(e) => {
                                     e.stopPropagation();
                                     setClassActiveTabs(prev => ({ ...prev, [cls.id]: 'assignments' }));
                                   }}
                                   className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all duration-200 cursor-pointer ${
                                     (classActiveTabs[cls.id] || 'students') === 'assignments'
                                       ? 'bg-white text-indigo-600 shadow-xs font-bold border border-slate-200/50'
                                       : 'text-slate-500 hover:text-slate-800 hover:bg-white/40'
                                   }`}
                                 >
                                   <Activity size={12} />
                                   <span>{lang === 'zh' ? '作业成绩' : 'Assignments'}</span>
                                 </button>
                                 <button
                                   onClick={(e) => {
                                     e.stopPropagation();
                                     setClassActiveTabs(prev => ({ ...prev, [cls.id]: 'schedules' }));
                                   }}
                                   className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all duration-200 cursor-pointer ${
                                     (classActiveTabs[cls.id] || 'students') === 'schedules'
                                       ? 'bg-white text-indigo-600 shadow-xs font-bold border border-slate-200/50'
                                       : 'text-slate-500 hover:text-slate-800 hover:bg-white/40'
                                   }`}
                                 >
                                   <CalendarIcon size={12} />
                                   <span>{lang === 'zh' ? '课表考勤' : 'Attendance'}</span>
                                 </button>
                                 <button
                                   onClick={(e) => {
                                     e.stopPropagation();
                                     setClassActiveTabs(prev => ({ ...prev, [cls.id]: 'grades' }));
                                   }}
                                   className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all duration-200 cursor-pointer ${
                                     (classActiveTabs[cls.id] || 'students') === 'grades'
                                       ? 'bg-white text-indigo-600 shadow-xs font-bold border border-slate-200/50'
                                       : 'text-slate-500 hover:text-slate-800 hover:bg-white/40'
                                   }`}
                                 >
                                   <ClipboardList size={12} />
                                   <span>{lang === 'zh' ? '学期总评' : 'Grades'}</span>
                                 </button>
                               </div>

                               {(classActiveTabs[cls.id] || 'students') === 'schedules' && (
                                 <div className="space-y-4">
                                   {classProgressMap[cls.id] && classProgressMap[cls.id].length > 0 && (
                                 <div className="mb-4 bg-white p-2 border border-gray-100 rounded shadow-sm">
                                   <div className="text-xs font-medium text-gray-500 mb-2 flex items-center gap-1">
                                     <BarChart2 size={12} /> Class Avg Completion
                                   </div>
                                   <div className="h-32 w-full">
                                     <ResponsiveContainer width="100%" height="100%">
                                       <BarChart data={classProgressMap[cls.id]}>
                                         <XAxis dataKey="lesson_title" hide />
                                         <YAxis domain={[0, 100]} hide />
                                          <Tooltip 
                                            contentStyle={{ fontSize: '10px', padding: '4px', borderRadius: '4px' }} 
                                            formatter={(value) => [`${Math.round(value as number)}%`, 'Average']}
                                          />
                                         <Bar dataKey="average_progress" fill="#6366f1" radius={[2, 2, 0, 0]} />
                                       </BarChart>
                                     </ResponsiveContainer>
                                   </div>
                                 </div>
                               )}

                               <div className="mb-4">
                                 <ScheduledLessonsProgressChart 
                                   schedules={classSchedulesMap[cls.id] || []}
                                   progress={classProgressMap[cls.id] || []}
                                   lang={lang}
                                 />
                               </div>

                               <div className="mb-4">
                                 <ClassAttendanceSummaryChart 
                                   classId={cls.id}
                                   lang={lang}
                                 />
                               </div>

                               {classDashboardMap[cls.id] && (
                                 <StudentCompareGrowthChart
                                   students={cStudents}
                                   assignments={classDashboardMap[cls.id].assignments || []}
                                   performance={classDashboardMap[cls.id].performance || []}
                                   lang={lang}
                                 />
                               )}
                                 </div>
                               )}
                               
                               {(classActiveTabs[cls.id] || 'students') === 'assignments' && (
                                 <div className="mb-4 bg-white p-3 rounded-xl border border-slate-100 shadow-xs">
                                 <div className="flex items-center justify-between mb-3 border-b border-gray-200 pb-2">
                                   <div className="text-xs font-semibold text-gray-700 flex items-center gap-1">
                                     <Activity size={14} className="text-indigo-500" /> Class Dashboard
                                    </div>
                                    <div className="flex items-center gap-2">
                                      {classDashboardMap[cls.id] && (
                                        <>
                                          <button
                                            id={`generate-pdf-btn-${cls.id}`}
                                            disabled={isGeneratingPDFReport[cls.id]}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handleGeneratePDFReport(cls.id, cls.name);
                                            }}
                                            className="text-white hover:bg-emerald-750 bg-emerald-600 hover:bg-emerald-700 transition-all font-semibold rounded px-2.5 py-1 text-[10px] items-center flex gap-1.5 shadow-sm cursor-pointer font-sans disabled:opacity-50"
                                          >
                                            {isGeneratingPDFReport[cls.id] ? (
                                              <Loader2 size={10} className="animate-spin" />
                                            ) : (
                                              <FileText size={10} />
                                            )}
                                            <span>{lang === 'zh' ? '下载班级 PDF 报告' : 'Download Class PDF Report'}</span>
                                          </button>
                                          <button
                                            id={`export-grades-btn-${cls.id}`}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setExportClassId(cls.id);
                                              setExportClassName(cls.name);
                                              setQuizzesWeight(40);
                                              setAssignmentsWeight(60);
                                              setCustomCategoryOverrides({});
                                              setIsExportWeightModalOpen(true);
                                            }}
                                            className="text-slate-700 hover:text-slate-900 border border-gray-300 bg-white hover:bg-gray-100 transition-all font-semibold rounded px-2 py-1 text-[10px] items-center flex gap-1 shadow-sm cursor-pointer font-sans"
                                          >
                                            <Download size={10} /> {lang === 'zh' ? '选项与导出' : 'Export Grades'}
                                          </button>
                                        </>
                                      )}
                                    <button
                                      disabled={isGeneratingAssignment === cls.id}
                                      onClick={async (e) => {
                                        e.stopPropagation();
                                         setQuizGeneratorClassId(cls.id);
                                         setQuizGenMode('scan_lesson');
                                         if (lessons.length > 0) {
                                           setQuizGenSelectedLessonId(lessons[0].id);
                                         } else {
                                           setQuizGenSelectedLessonId('');
                                         }
                                         setQuizGenTopic('');
                                         setSuggestedObjectives([]);
                                         setSuggestedQuestions([]);
                                         setIsQuizGeneratorOpen(true);
                                       }}
                                      className="text-white bg-indigo-500 hover:bg-indigo-600 px-2 py-1 rounded text-[10px] items-center flex gap-1 shadow-sm disabled:opacity-50"
                                    >
                                      {isGeneratingAssignment === cls.id ? <Loader2 size={10} className="animate-spin" /> : <Wand2 size={10} />} Generate AI Quiz
                                    </button>
                                    </div>
                                 </div>
                                 
                                 {classDashboardMap[cls.id] ? (
                                   <div className="space-y-4">
                                     {/* Pending Assignments */}
                                     <div>
                                       <div className="flex items-center justify-between mb-2">
                                          <div className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">
                                            {lang === 'zh' ? '班级作业与测验' : 'Class Assignments & Quizzes'}
                                          </div>
                                          <div className="flex items-center gap-1.5 bg-white border border-gray-200 px-2 py-1 rounded-lg shadow-sm">
                                            <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">
                                              {lang === 'zh' ? '排序：' : 'Sort:'}
                                            </span>
                                            <select
                                              value={assignmentSortOrder}
                                              onChange={(e) => setAssignmentSortOrder(e.target.value as any)}
                                              className="bg-transparent border-0 text-[10px] text-gray-750 font-bold focus:outline-none focus:ring-0 p-0 cursor-pointer outline-none font-sans"
                                              id="assignment-sort-select"
                                            >
                                              <option value="dueDate">{lang === 'zh' ? '截止日期' : 'Due Date'}</option>
                                              <option value="status">{lang === 'zh' ? '评分状态' : 'Status (Graded/Pending)'}</option>
                                              <option value="avgScore">{lang === 'zh' ? '平均分' : 'Average Score'}</option>
                                            </select>
                                          </div>
                                        </div>
                                       <div className="grid gap-2 grid-cols-2">
                                         {classDashboardMap[cls.id].assignments && (() => {
                                            const rawAssignments = classDashboardMap[cls.id]?.assignments || [];
                                            const perf = classDashboardMap[cls.id]?.performance || [];
                                            const processed = rawAssignments.map((ast: any) => {
                                              const astPerf = perf.filter((p: any) => p.assignment_id === ast.id);
                                              const totalSt = astPerf.length;
                                              const pendingGradingCount = astPerf.filter((p: any) => p.submission_status === 'submitted').length;
                                              const gradedCount = astPerf.filter((p: any) => p.submission_status === 'graded').length;
                                              let status: 'pending' | 'graded' = 'pending';
                                              let statusLabel = lang === 'zh' ? '未提交' : 'No Submissions';
                                              if (pendingGradingCount > 0) {
                                                status = 'pending';
                                                statusLabel = lang === 'zh' ? '待评分' : 'Pending Grading';
                                              } else if (gradedCount > 0) {
                                                status = 'graded';
                                                statusLabel = lang === 'zh' ? '已评分' : 'Graded';
                                              }
                                              const gradedScores = astPerf.filter((p: any) => p.score !== null && p.score !== undefined).map((p: any) => Number(p.score));
                                              const avgScore = gradedScores.length > 0 ? Math.round(gradedScores.reduce((a: number, b: number) => a + b, 0) / gradedScores.length) : null;
                                              const dueDateTimestamp = ast.created_at + 7 * 24 * 60 * 60 * 1000;
                                              return { ...ast, dueDateTimestamp, status, statusLabel, avgScore, pendingGradingCount, gradedCount };
                                            });
                                            const sorted = processed.sort((a: any, b: any) => {
                                              if (assignmentSortOrder === 'dueDate') {
                                                return a.dueDateTimestamp - b.dueDateTimestamp;
                                              } else if (assignmentSortOrder === 'status') {
                                                if (a.status === b.status) return b.dueDateTimestamp - a.dueDateTimestamp;
                                                return a.status === 'pending' ? -1 : 1;
                                              } else if (assignmentSortOrder === 'avgScore') {
                                                const scoreA = a.avgScore !== null ? a.avgScore : -1;
                                                const scoreB = b.avgScore !== null ? b.avgScore : -1;
                                                return scoreB - scoreA;
                                              }
                                              return 0;
                                            });
                                            return sorted.map((ast: any) => (
  // DUMMY COMMENT TO SILENCE COMPILER BINDING
                                           <div key={ast.id} className="bg-white p-3 rounded-xl border border-gray-150 hover:border-indigo-200 shadow-sm text-xs cursor-pointer hover:shadow transition-all flex flex-col justify-between">
                                              <div className="flex items-start justify-between gap-1.5 mb-1.5">
                                                 <div className="font-semibold text-gray-800 line-clamp-1 flex-1 font-sans" title={ast.title}>{ast.title}</div>
                                                 <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold shrink-0 border uppercase tracking-wider font-sans ${
                                                   ast.status === 'graded' 
                                                     ? 'bg-emerald-50 text-emerald-700 border-emerald-100' 
                                                     : ast.pendingGradingCount > 0 
                                                       ? 'bg-amber-50 text-amber-700 border-amber-100' 
                                                       : 'bg-gray-50 text-gray-500 border-gray-100'
                                                 }`}>
                                                   {ast.statusLabel}
                                                 </span>
                                               </div>
                                              <div className="text-gray-500 text-[10px] line-clamp-2 leading-normal mb-2.5 font-sans">{ast.description || ast.content}</div>
                                              {/* A button to submit/grade here could be nice, but keeping it simple */}
                                              <div className="flex items-center justify-between border-t border-gray-55 pt-2 mt-auto gap-2">
                                                 <div className="flex items-center gap-1.5 font-sans">
                                                   <span className="text-[10px] text-gray-400 font-medium">
                                                     {lang === 'zh' ? '截止: ' : 'Due: '}
                                                     <span className="text-gray-600 font-semibold">{new Date(ast.dueDateTimestamp).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric' })}</span>
                                                   </span>
                                                   {ast.avgScore !== null && (
                                                     <span className="inline-flex items-center gap-0.5 bg-indigo-50 text-indigo-700 border border-indigo-100 px-1.5 py-0.5 rounded text-[9px] font-bold">
                                                       {lang === 'zh' ? '均分' : 'Avg'}: {ast.avgScore}%
                                                     </span>
                                                   )}
                                                 </div>
                                                <button 
                                                    onClick={async (e) => {
                                                      e.stopPropagation();
                                                      if (cStudents.length === 0) return alert('No students in class to submit!');
                                                      const s = cStudents[Math.floor(Math.random() * cStudents.length)];
                                                      const subText = window.prompt(`Simulate student '${s.name}' submitting:`);
                                                      if (subText) {
                                                        const res = await fetch(`/api/assignments/${ast.id}/submissions`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ studentId: s.id, content: subText }) });
                                                        if (res.ok) await fetchClassDashboard(cls.id);
                                                      }
                                                    }}
                                                    className="text-[9px] text-indigo-600 border border-indigo-200 hover:border-indigo-300 hover:bg-indigo-50/50 bg-white px-2 py-0.5 rounded font-bold flex items-center gap-1 cursor-pointer transition-all shrink-0 font-sans"
                                                >
                                                  <Send size={8} /> {lang === 'zh' ? '模拟' : 'Simulate'}
                                                </button>
                                              </div>
                                           </div>
                                           ));
                                         })()}
                                         {classDashboardMap[cls.id].assignments.length === 0 && (
                                           <div className="text-xs text-gray-400 italic">No assignments yet.</div>
                                         )}
                                       </div>
                                     </div>

                                     {/* Recent Submissions */}
                                     <div>
                                       <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2 border-b border-gray-100 pb-1.5 pt-1">
                                          <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider flex items-center gap-1">
                                            <CalendarIcon size={11} className="text-gray-400" />
                                            {lang === 'zh' ? '近期作业提交' : 'Recent Submissions'}
                                          </div>
                                          
                                          {/* Filter Pill Buttons */}
                                          <div className="flex items-center gap-1 bg-gray-50 p-0.5 rounded-lg border border-gray-200">
                                            {(['all', 'submitted', 'graded', 'pending'] as const).map((filterOpt) => {
                                              const isActive = activeSubmissionFilter === filterOpt;
                                              const optCounts = (() => {
                                                if (filterOpt === 'all') return recentSubs.length;
                                                if (filterOpt === 'submitted') return recentSubs.filter((s: any) => s.status === 'submitted').length;
                                                if (filterOpt === 'graded') return recentSubs.filter((s: any) => s.status === 'graded').length;
                                                if (filterOpt === 'pending') {
                                                  const pGrading = recentSubs.filter((s: any) => s.status === 'submitted').length;
                                                  const pStudent = performanceData.filter((p: any) => !p.submission_status || p.submission_status === null).length;
                                                  return pGrading + pStudent;
                                                }
                                                return 0;
                                              })();

                                              const labelLocal = {
                                                all: lang === 'zh' ? '全部' : 'All',
                                                submitted: lang === 'zh' ? '待评分' : 'Submitted',
                                                graded: lang === 'zh' ? '已完成' : 'Graded',
                                                pending: lang === 'zh' ? '待完成' : 'Pending'
                                              }[filterOpt];

                                              return (
                                                <button
                                                  key={filterOpt}
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    setClassSubmissionFilters(prev => ({ ...prev, [cls.id]: filterOpt }));
                                                  }}
                                                  className={`px-2 py-0.5 rounded-md text-[10px] font-semibold transition-all cursor-pointer flex items-center gap-1 font-sans ${
                                                    isActive 
                                                      ? 'bg-white shadow-sm text-indigo-600 border border-indigo-100' 
                                                      : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100 border border-transparent'
                                                  }`}
                                                >
                                                  <span>{labelLocal}</span>
                                                  <span className={`px-1 py-0.1 ml-0.5 rounded-full text-[8.5px] leading-tight ${
                                                    isActive 
                                                      ? 'bg-indigo-50 text-indigo-600 font-bold' 
                                                      : 'bg-gray-200/60 text-gray-400 font-medium'
                                                  }`}>
                                                    {optCounts}
                                                  </span>
                                                </button>
                                              );
                                            })}
                                          </div></div>
                                       <div className="flex flex-col gap-1.5 max-h-56 overflow-y-auto pr-1">
                                         {filteredSubmissions.map((sub: any, idx: number) => (



                                           <div key={sub.status === 'pending_student' ? `${sub.assignment_id}-${sub.student_id}-pending-${idx}` : `${sub.assignment_id}-${sub.student_id}-${idx}`} className="bg-white p-2 border border-gray-150 rounded-lg text-xs flex justify-between items-center group hover:border-gray-300 transition-colors shadow-none mt-0.5">
                                             <div className="flex-1 min-w-0 pr-2">
                                               <div className="font-semibold text-gray-800 truncate flex items-center gap-1.5">
                                                  <span className="max-w-[110px] truncate">{sub.student_name}</span>
                                                  <span className="text-[10px] text-gray-400 font-normal">in</span>
                                                  <span className="truncate text-gray-500 max-w-[130px]" title={sub.assignment_title}>{sub.assignment_title}</span></div>
                                               <div className="text-[10px] text-gray-500 truncate italic mt-0.5">
                                                  {sub.status === 'pending_student' ? (
                                                    <span className="text-amber-500 font-medium flex items-center gap-1">
                                                      <Clock size={10} className="animate-pulse" />
                                                      {sub.content}
                                                    </span>
                                                  ) : (
                                                    `"${sub.content}"`
                                                  )}</div>
                                             </div>
                                             <div className="shrink-0 flex items-center justify-end gap-1.5">
                                                {sub.status !== 'pending_student' && (
                                               <button
                                                 onClick={() => {
                                                   setActiveStudentId(sub.student_id);
                                                   setSelectedAssignment({ 
                                                     id: sub.assignment_id, 
                                                     title: sub.assignment_title, 
                                                     student_id: sub.student_id, 
                                                     student_name: sub.student_name,
                                                     submission_status: sub.status,
                                                     score: sub.score,
                                                     feedback: sub.feedback,
                                                     content: sub.question_content // Optional if available
                                                   });
                                                   setStudentViewStatus('assignment');
                                                   setActiveRole('student');
                                                 }}
                                                 className="text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-2 py-1 rounded-md text-[9px] flex items-center gap-1 shadow-none font-bold border border-indigo-100 hover:border-indigo-200 transition-all cursor-pointer"
                                               >
                                                 <PenTool size={9} /> Live Canvas
                                               </button>
                                               )}
                                                {sub.status === 'graded' ? (
                                                 <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${sub.score >= 85 
                                                      ? 'bg-green-100 text-green-700 border border-green-200' 
                                                      : sub.score >= 70 
                                                      ? 'bg-indigo-100 text-indigo-700 border border-indigo-200' 
                                                      : 'bg-yellow-105 text-yellow-700 border border-yellow-250'}`}>
                                                   {sub.score}%
                                                 </span>
                                               ) : (
                                                <button 
                                                  disabled={isGrading[`${sub.assignment_id}-${sub.student_id}`]}
                                                  onClick={async () => {
                                                    setIsGrading(p => ({...p, [`${sub.assignment_id}-${sub.student_id}`]: true}));
                                                    try {
                                                      const res = await fetch(`/api/assignments/${sub.assignment_id}/submissions/${sub.student_id}/grade`, { method: 'POST' });
                                                      if (res.ok) await fetchClassDashboard(cls.id);
                                                    } finally {
                                                      setIsGrading(p => ({...p, [`${sub.assignment_id}-${sub.student_id}`]: false}));
                                                    }
                                                  }}
                                                  className="text-white bg-green-500 hover:bg-green-600 px-2 py-1 rounded-md text-[9px] flex items-center gap-1 shadow-sm font-bold border border-green-600 hover:border-green-700 hover:-translate-y-0.1 transition-all disabled:opacity-50 cursor-pointer"
                                                >
                                                  {isGrading[`${sub.assignment_id}-${sub.student_id}`] ? <Loader2 size={10} className="animate-spin" /> : <Wand2 size={10} />} {lang === 'zh' ? '评分' : 'Grade'}
                                                </button>
                                               )}
                                             </div>
                                           </div>
                                         ))}
                                         {filteredSubmissions.length === 0 && (
                                           <div className="text-xs text-gray-400 italic p-4 text-center bg-gray-50 border border-dashed border-gray-200 rounded-lg select-none">
                                              {lang === 'zh' ? '该筛选下暂无可展示的作业项目。' : 'No submissions under this filter.'}
                                            </div>
                                         )}
                                       </div>
                                     </div>

                                     {/* Heatmap */}
                                     {classDashboardMap[cls.id].assignments.length > 0 && cStudents.length > 0 && (
                                       <div>
                                         <div className="text-[10px] font-medium text-gray-500 mb-1 uppercase tracking-wider">Class Performance Heatmap</div>
                                         <div className="overflow-x-auto border border-gray-200 rounded">
                                           <table className="w-full text-xs text-left bg-white">
                                             <thead className="bg-gray-50 sticky top-0">
                                               <tr>
                                                 <th className="p-2 border-b border-r border-gray-200 font-medium whitespace-nowrap text-gray-600">Student</th>
                                                 {classDashboardMap[cls.id].assignments.map((a: any) => (
                                                   <th key={a.id} className="p-2 border-b border-r border-gray-200 font-medium truncate max-w-[80px]" title={a.title}>
                                                     {a.title}
                                                   </th>
                                                 ))}
                                               </tr>
                                             </thead>
                                             <tbody>
                                               {cStudents.map(st => (
                                                 <tr key={st.id} className="border-b border-gray-100 last:border-b-0">
                                                   <td className="p-2 border-r border-gray-100 font-medium text-gray-700 whitespace-nowrap truncate max-w-[160px]">
                                                     <div className="flex items-center gap-1.5">
                                                       <span className="truncate" title={st.name}>{st.name}</span>
                                                       {(() => {
                                                         const avg30 = get30DayAverageWarning(st.id, cls.id);
                                                         if (avg30 !== null) {
                                                           return (
                                                             <span 
                                                               className="inline-flex items-center gap-0.5 bg-red-50 text-red-700 border border-red-200 px-1 py-0.5 rounded text-[9px] font-bold animate-pulse"
                                                               title={lang === 'zh' ? `30天平均成绩已降至60%以下 (${avg30}%)` : `30-day average has dropped below 60% (${avg30}%)`}
                                                             >
                                                               <ShieldAlert size={10} className="text-red-500" />
                                                               {avg30}%
                                                             </span>
                                                           );
                                                         }
                                                         return null;
                                                       })()}
                                                     </div>
                                                   </td>
                                                   {classDashboardMap[cls.id].assignments.map((a: any) => {
                                                      const perf = classDashboardMap[cls.id].performance.find((p: any) => p.assignment_id === a.id && p.student_id === st.id);
                                                      let bgClass = "bg-gray-50";
                                                      let text = "-";
                                                      if (perf && perf.score !== null) {
                                                        text = perf.score.toString();
                                                        if (perf.score >= 90) bgClass = "bg-green-100 text-green-800 font-medium";
                                                        else if (perf.score >= 70) bgClass = "bg-green-50 text-green-700";
                                                        else if (perf.score >= 50) bgClass = "bg-yellow-50 text-yellow-700";
                                                        else bgClass = "bg-red-50 text-red-700";
                                                      } else if (perf && perf.submission_status === 'submitted') {
                                                        text = "Wait";
                                                        bgClass = "bg-blue-50 text-blue-500 text-[9px]";
                                                      }
                                                      return (
                                                        <td key={a.id} className={`p-2 border-r border-gray-100 text-center relative group/cell ${bgClass}`}>
                                                          {(() => {
                                                            const hasGradedAt = perf && perf.graded_at;
                                                            const formattedGradedTime = hasGradedAt 
                                                              ? new Date(perf.graded_at).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US', {
                                                                  month: 'short',
                                                                  day: 'numeric',
                                                                  hour: '2-digit',
                                                                  minute: '2-digit'
                                                                })
                                                              : '';
                                                            return (
                                                              <>
                                                                <div className="flex items-center justify-center gap-0.5 select-none font-sans">
                                                                  <span>{text}</span>
                                                                  {perf && perf.score !== null && (
                                                                    <span className="w-1 h-1 rounded-full bg-emerald-500 shrink-0 inline-block animate-pulse" />
                                                                  )}
                                                                </div>
                                                                {perf && perf.score !== null && (
                                                                  <div className="absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 hidden group-hover/cell:block bg-gray-900 border border-gray-800 text-white text-[10px] p-2.5 rounded-xl shadow-2xl z-30 w-44 pointer-events-none text-left leading-normal font-sans font-normal normal-case">
                                                                    <div className="font-bold text-[11px] mb-1 text-emerald-400 flex items-center gap-1">
                                                                      <CheckCircle2 size={11} className="shrink-0" />
                                                                      {lang === 'zh' ? '已完成评分' : 'Graded & Evaluated'}
                                                                    </div>
                                                                    {formattedGradedTime && (
                                                                      <div className="text-gray-300 flex items-center gap-1 font-semibold text-[9px] mb-1">
                                                                        <Clock size={10} className="shrink-0 text-indigo-400" />
                                                                        <span>{lang === 'zh' ? `时间: ${formattedGradedTime}` : `Graded: ${formattedGradedTime}`}</span>
                                                                      </div>
                                                                    )}
                                                                    {perf.feedback && (
                                                                      <div className="text-gray-200 mt-1 pt-1 border-t border-gray-800 line-clamp-3 text-[9px] italic">
                                                                        "{perf.feedback}"
                                                                      </div>
                                                                    )}
                                                                    <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 border-4 border-transparent border-t-gray-900" />
                                                                  </div>
                                                                )}
                                                              </>
                                                            );
                                                          })()}
                                                        </td>
                                                      );
                                                   })}
                                                 </tr>
                                               ))}
                                             </tbody>
                                           </table>
                                         </div>
                                       </div>
                                     )}
                                   </div>
                                 ) : (
                                   <div className="flex justify-center p-4 text-gray-400"><Loader2 size={16} className="animate-spin" /></div>
                                 )}
                               </div>

                               )}

                               {(classActiveTabs[cls.id] || 'students') === 'schedules' && (
                               <div className="mb-4 bg-white p-3 rounded-xl border border-slate-100 shadow-xs">
                                 <div className="flex items-center justify-between mb-3 border-b border-gray-200 pb-2">
                                   <div className="text-xs font-semibold text-gray-700 flex items-center gap-1">
                                     <CalendarIcon size={14} className="text-pink-500" /> Schedule & Attendance
                                   </div>
                                 </div>
                                 
                                 <div className="mb-3 flex gap-2 items-center">
                                   <input title="Schedule Date" type="date" className="border border-slate-200 hover:border-slate-300 rounded-lg text-xs p-1.5 flex-1 bg-white focus:outline-hidden focus:ring-1 focus:ring-indigo-500 text-gray-750 transition-all font-sans" value={newScheduleDate} onChange={e => setNewScheduleDate(e.target.value)} onClick={e => e.stopPropagation()} />
                                   <select title="Schedule Lesson" className="border border-slate-200 hover:border-slate-300 rounded-lg text-xs p-1.5 flex-1 bg-white focus:outline-hidden focus:ring-1 focus:ring-indigo-500 text-gray-750 transition-all font-sans cursor-pointer" value={newScheduleLessonId} onChange={e => setNewScheduleLessonId(e.target.value)} onClick={e => e.stopPropagation()}>
                                     <option value="">Select Lesson...</option>
                                     {lessons.map(l => <option key={l.id} value={l.id}>{l.title}</option>)}
                                   </select>
                                   <button 
                                      className="bg-pink-500 hover:bg-pink-600 text-white p-1 px-2 rounded text-xs disabled:opacity-50 flex items-center gap-1"
                                      disabled={!newScheduleDate || !newScheduleLessonId}
                                      onClick={async (e) => {
                                        e.stopPropagation();
                                        const res = await fetch(`/api/classes/${cls.id}/schedules`, {
                                          method: 'POST', headers: {'Content-Type': 'application/json'},
                                          body: JSON.stringify({ lessonId: newScheduleLessonId, scheduledDate: newScheduleDate })
                                        });
                                        if (res.ok) {
                                          setNewScheduleDate(''); setNewScheduleLessonId('');
                                          await fetchClassSchedules(cls.id);
                                        }
                                      }}
                                   >
                                     Schedule
                                   </button>
                                 </div>

                                 <div className="flex flex-col gap-2">
                                   {((classSchedulesMap[cls.id] || [])).length === 0 ? (
                                      <div className="text-xs text-gray-400 italic">No schedules yet.</div>
                                   ) : (
                                      classSchedulesMap[cls.id].map(sch => {
                                        const isExp = expandedScheduleId === sch.id;
                                        const att = scheduleAttendanceMap[sch.id] || [];
                                        return (
                                          <div key={sch.id} className="bg-white border border-slate-100/90 rounded-xl shadow-xs hover:shadow-sm transition-all overflow-hidden mb-2">
                                            <div 
                                              className="p-2 flex justify-between items-center cursor-pointer hover:bg-gray-50"
                                              onClick={() => {
                                                if (isExp) setExpandedScheduleId(null);
                                                else { setExpandedScheduleId(sch.id); fetchScheduleAttendance(sch.id); }
                                              }}
                                            >
                                              <div className="flex items-center gap-2 text-xs">
                                                {isExp ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
                                                <div className="flex flex-col">
                                                  <span className="font-semibold text-gray-800">{sch.lesson_title}</span>
                                                  <span className="text-[10px] text-gray-500 flex items-center gap-1"><CalendarIcon size={10} /> {sch.scheduled_date}</span>
                                                </div>
                                              </div>
                                            </div>
                                            {isExp && (
                                              <div className="border-t border-gray-100 p-2 bg-gray-50/50">
                                                <div className="text-[10px] font-medium text-gray-500 mb-2 uppercase tracking-wider">Attendance Check-in</div>
                                                <div className="grid gap-1">
                                                  {cStudents.map(st => {
                                                    const aRec = att.find(a => a.student_id === st.id);
                                                    return (
                                                      <div key={st.id} className="flex items-center justify-between text-xs bg-white p-1 rounded border border-gray-200">
                                                        <div className="flex items-center gap-1.5 truncate max-w-[150px]">
                                                           <span className="font-medium text-gray-700 truncate" title={st.name}>{st.name}</span>
                                                           {(() => {
                                                             const avg30 = get30DayAverageWarning(st.id, cls.id);
                                                             if (avg30 !== null) {
                                                               return (
                                                                 <span 
                                                                   className="inline-flex items-center gap-0.5 bg-red-50 text-red-700 border border-red-200 px-1 py-0.5 rounded text-[9px] font-bold animate-pulse"
                                                                   title={lang === 'zh' ? `30天平均成绩已降至60%以下 (${avg30}%)` : `30-day average has dropped below 60% (${avg30}%)`}
                                                                 >
                                                                   <ShieldAlert size={10} className="text-red-500" />
                                                                   {avg30}%
                                                                 </span>
                                                               );
                                                             }
                                                             return null;
                                                           })()}
                                                         </div>
                                                        <div className="flex gap-1 shrink-0">
                                                          {['present', 'late', 'absent'].map(status => (
                                                            <button 
                                                              key={status}
                                                              onClick={async (e) => {
                                                                e.stopPropagation();
                                                                const res = await fetch(`/api/schedules/${sch.id}/attendance`, {
                                                                  method: 'POST', headers: {'Content-Type': 'application/json'},
                                                                  body: JSON.stringify({ studentId: st.id, status })
                                                                });
                                                                if (res.ok) fetchScheduleAttendance(sch.id);
                                                              }}
                                                              className={`px-1.5 py-0.5 rounded text-[10px] capitalize border transition-all cursor-pointer ${
                                                                aRec?.status === status 
                                                                  ? (status === 'present' ? 'bg-green-50 border-green-200 text-green-700 font-medium' : status === 'late' ? 'bg-yellow-50 border-yellow-200 text-yellow-700 font-medium' : 'bg-red-50 border-red-200 text-red-700 font-medium')
                                                                  : 'bg-slate-50 border-slate-100/70 text-slate-400 hover:bg-slate-100'
                                                              }`}
                                                            >
                                                              {status}
                                                            </button>
                                                          ))}
                                                        </div>
                                                      </div>
                                                    );
                                                  })}
                                                  {cStudents.length === 0 && <div className="text-[10px] italic text-gray-400">No students to check in.</div>}
                                                </div>
                                              </div>
                                            )}
                                          </div>
                                        );
                                      })
                                   )}
                                 </div>
                               </div>
                               )}

                               {(classActiveTabs[cls.id] || 'students') === 'students' && (
                               <div className="mb-4 bg-white p-3 rounded-xl border border-slate-100 shadow-xs">
                                 <div className="flex items-center justify-between mb-3 border-b border-gray-200 pb-2">
                                   <div className="text-xs font-semibold text-gray-700 flex items-center gap-1.5">
                                      <Users size={14} className="text-indigo-500 animate-pulse" />
                                      {lang === 'zh' ? '班级学生花名册' : 'Class Student Roster'}
                                   </div>
                                   <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                                      {/* Dropdown selects from existing students not currently in this class */}
                                      {students.filter(st => !cStudents.some(cs => cs.id === st.id)).length > 0 ? (
                                        <>
                                          <select
                                            id={`enroll-student-select-${cls.id}`}
                                            className="border border-slate-200 hover:border-slate-300 rounded-lg text-[10px] md:text-xs p-1.5 bg-white text-gray-750 font-sans focus:outline-none focus:ring-1 focus:ring-indigo-500 max-w-[130px]"
                                            defaultValue=""
                                          >
                                            <option value="" disabled>{lang === 'zh' ? '添加已有学生...' : 'Enroll existing...'}</option>
                                            {students.filter(st => !cStudents.some(cs => cs.id === st.id)).map(st => (
                                              <option key={st.id} value={st.id}>{st.name}</option>
                                            ))}
                                          </select>
                                          <button
                                            onClick={async (e) => {
                                              const selectEl = document.getElementById(`enroll-student-select-${cls.id}`) as HTMLSelectElement;
                                              if (selectEl && selectEl.value) {
                                                const res = await fetch(`/api/classes/${cls.id}/students`, {
                                                  method: 'POST',
                                                  headers: { 'Content-Type': 'application/json' },
                                                  body: JSON.stringify({ studentId: selectEl.value })
                                                });
                                                if (res.ok) {
                                                  await fetchClassStudents(cls.id);
                                                  selectEl.value = "";
                                                }
                                              }
                                            }}
                                            className="text-white bg-indigo-600 hover:bg-indigo-700 text-[10px] px-2 py-1 rounded shadow-sm font-medium transition-colors cursor-pointer"
                                          >
                                            {lang === 'zh' ? '添加' : 'Enroll'}
                                          </button>
                                        </>
                                      ) : null}

                                      <button
                                        onClick={async (e) => {
                                          const name = window.prompt(lang === 'zh' ? '请输入学生姓名:' : 'Enter student name:');
                                          if (!name) return;
                                          const email = window.prompt(lang === 'zh' ? '请输入学生邮箱 (可选):' : 'Enter student email (optional):') || '';
                                          const password = window.prompt(lang === 'zh' ? '请输入登录密码 (可选，默认 123456):' : 'Enter login password (optional, default 123456):') || '123456';
                                          
                                          // 1. Create a new student record
                                          const createRes = await fetch('/api/students', {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({ name, email, password })
                                          });
                                          if (createRes.ok) {
                                            const newStudent = await createRes.json();
                                            // 2. Link student to this class ID
                                            const linkRes = await fetch(`/api/classes/${cls.id}/students`, {
                                              method: 'POST',
                                              headers: { 'Content-Type': 'application/json' },
                                              body: JSON.stringify({ studentId: newStudent.id })
                                            });
                                            if (linkRes.ok) {
                                              await fetchStudents();
                                              await fetchClassStudents(cls.id);
                                            }
                                          }
                                        }}
                                        className="text-indigo-600 bg-white hover:bg-gray-50 border border-gray-200 text-[10px] px-2 py-1 rounded shadow-sm font-medium transition-colors cursor-pointer"
                                      >
                                        + {lang === 'zh' ? '注册并加入本班' : 'Register New'}
                                      </button>

                                      <input
                                        type="file"
                                        accept=".csv"
                                        id={`bulk-enroll-csv-${cls.id}`}
                                        className="hidden"
                                        onChange={async (e) => {
                                          const file = e.target.files?.[0];
                                          if (!file) return;
                                          
                                          const reader = new FileReader();
                                          reader.onload = async (evt) => {
                                            const text = evt.target?.result as string;
                                            if (!text) return;
                                            
                                            const studentsToEnroll = parseCSV(text);
                                            if (studentsToEnroll.length === 0) {
                                              alert(lang === 'zh' 
                                                ? '未能识别出有效的学生数据。请确保 CSV 文件包含 "学生姓名" (或 "name") 和 "学生邮箱" (或 "email") 字段。' 
                                                : 'No valid student records found. Maintain at least a "name" column in your CSV.');
                                              return;
                                            }
                                            
                                            if (!window.confirm(lang === 'zh'
                                              ? `确认从此 CSV 导入并注册/加入 ${studentsToEnroll.length} 位学生到本班吗？`
                                              : `Are you sure you want to enroll ${studentsToEnroll.length} students from the selected CSV file into this class?`)) {
                                              return;
                                            }

                                            try {
                                              const res = await fetch(`/api/classes/${cls.id}/students/bulk-enroll`, {
                                                method: 'POST',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({ students: studentsToEnroll })
                                              });
                                              if (res.ok) {
                                                const data = await res.json();
                                                alert(lang === 'zh' 
                                                  ? `成功在该班级注册/加入了 ${data.count} 名学生！` 
                                                  : `Successfully enrolled ${data.count} students!`);
                                                await fetchStudents();
                                                await fetchClassStudents(cls.id);
                                              } else {
                                                alert(lang === 'zh' ? '导入失败，请稍后重试。' : 'Failed to import. Please retry.');
                                              }
                                            } catch (err) {
                                              alert(lang === 'zh' ? '处理过程出错，请检查格式后重试。' : 'An error occurred during CSV parsing.');
                                            }
                                          };
                                          reader.readAsText(file);
                                          e.target.value = '';
                                        }}
                                      />
                                      
                                      <button
                                        onClick={() => {
                                          document.getElementById(`bulk-enroll-csv-${cls.id}`)?.click();
                                        }}
                                        className="text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-[10px] px-2 py-1 rounded shadow-sm font-semibold transition-colors flex items-center gap-1 cursor-pointer"
                                        title={lang === 'zh' ? '通过 CSV 批量加入学生' : 'Bulk Enroll via CSV file'}
                                      >
                                        <Upload size={10} />
                                        {lang === 'zh' ? 'CSV 批量加入' : 'CSV Bulk Enroll'}
                                      </button>
                                   </div>
                                 </div>

                                 {cStudents.length === 0 ? (
                                    <div className="text-xs text-gray-500 italic p-1 text-left">{lang === 'zh' ? '该班级暂无学生。可以使用右侧按钮添加或注册学生' : 'No students registered in this class.'}</div>
                                 ) : (() => {
                                    const filtered = cStudents.filter(st => {
                                      if (!rosterSearchQuery) return true;
                                      const q = rosterSearchQuery.toLowerCase();
                                      return (st.name && st.name.toLowerCase().includes(q)) || (st.email && st.email.toLowerCase().includes(q));
                                    });
                                    return (
                                      <div className="flex flex-col gap-2">
                                        {/* Search bar inside Class Student Roster card */}
                                        <div className="mb-1 relative" onClick={(e) => e.stopPropagation()}>
                                          <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none">
                                            <Search size={13} className="text-gray-400" />
                                          </div>
                                          <input
                                            type="text"
                                            placeholder={lang === 'zh' ? '搜索姓名或邮箱...' : 'Search student by name or email...'}
                                            value={rosterSearchQuery}
                                            onChange={(e) => setRosterSearchQuery(e.target.value)}
                                            className="w-full pl-8 pr-8 py-1.5 bg-white border border-gray-200 hover:border-gray-300 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-lg text-xs font-sans transition-all focus:outline-none"
                                          />
                                          {rosterSearchQuery && (
                                            <button
                                              type="button"
                                              onClick={() => setRosterSearchQuery('')}
                                              className="absolute inset-y-0 right-0 pr-2.5 flex items-center text-gray-400 hover:text-red-500 transition-colors cursor-pointer"
                                            >
                                              <X size={13} className="stroke-[2.5]" />
                                            </button>
                                          )}
                                        </div>

                                        {/* Quick Note Category Filters */}
                                        <div className="mb-2.5 flex flex-wrap items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                                          <span className="text-[9px] font-bold text-gray-400 mr-1 uppercase tracking-wider">{lang === 'zh' ? '备忘分类' : 'Notes Tag'}:</span>
                                          <button
                                            type="button"
                                            onClick={() => setRosterTagFilter('all')}
                                            className={`px-2 py-0.5 text-[9px] font-bold rounded-full border cursor-pointer transition-all ${
                                              rosterTagFilter === 'all'
                                                ? 'bg-slate-700 text-white border-slate-700 shadow-3xs'
                                                : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
                                            }`}
                                          >
                                            {lang === 'zh' ? '全部' : 'All'}
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => setRosterTagFilter('General')}
                                            className={`px-2 py-0.5 text-[9px] font-bold rounded-full border cursor-pointer transition-all ${
                                              rosterTagFilter === 'General'
                                                ? 'bg-emerald-600 text-white border-emerald-600 shadow-3xs'
                                                : 'bg-white text-emerald-700 border-emerald-150 hover:bg-emerald-50'
                                            }`}
                                          >
                                            {lang === 'zh' ? '日常' : 'General'}
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => setRosterTagFilter('Academic')}
                                            className={`px-2 py-0.5 text-[9px] font-bold rounded-full border cursor-pointer transition-all ${
                                              rosterTagFilter === 'Academic'
                                                ? 'bg-blue-600 text-white border-blue-600 shadow-3xs'
                                                : 'bg-white text-blue-700 border-blue-150 hover:bg-blue-50'
                                            }`}
                                          >
                                            {lang === 'zh' ? '学术' : 'Academic'}
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => setRosterTagFilter('Behavioral')}
                                            className={`px-2 py-0.5 text-[9px] font-bold rounded-full border cursor-pointer transition-all ${
                                              rosterTagFilter === 'Behavioral'
                                                ? 'bg-purple-600 text-white border-purple-600 shadow-3xs'
                                                : 'bg-white text-purple-700 border-purple-150 hover:bg-purple-50'
                                            }`}
                                          >
                                            {lang === 'zh' ? '行为' : 'Behavior'}
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => setRosterTagFilter('SpecialCare')}
                                            className={`px-2 py-0.5 text-[9px] font-bold rounded-full border cursor-pointer transition-all ${
                                              rosterTagFilter === 'SpecialCare'
                                                ? 'bg-rose-600 text-white border-rose-600 shadow-3xs'
                                                : 'bg-white text-rose-700 border-rose-150 hover:bg-rose-50'
                                            }`}
                                          >
                                            {lang === 'zh' ? '特别关注' : 'Care'}
                                          </button>
                                        </div>

                                        {filtered.length === 0 ? (
                                          <div className="text-xs text-gray-400 italic p-4 text-center bg-white border border-dashed border-gray-150 rounded-lg select-none">
                                            {lang === 'zh' ? '未找到符合查询条件的学生。' : 'No students matched this search criteria.'}
                                          </div>
                                        ) : (
                                          <div className="space-y-1">
                                            {filtered.map(st => {
                                        const isStExpanded = expandedStudentId === st.id;
                                        const progress = studentProgressMap[st.id] || [];
                                        const stActiveTab = studentActiveTabs[st.id] || 'progress';
                                        return (
                                          <div key={st.id} className="border border-slate-100/75 w-full flex flex-col bg-white rounded-xl p-2.5 shadow-xs mb-1.5 hover:border-slate-200 hover:shadow-sm transition-all duration-200 text-left">
                                            <div 
                                              className="flex justify-between items-center text-sm text-gray-700 py-1 cursor-pointer hover:bg-gray-50 w-full rounded"
                                              onClick={() => {
                                                if (isStExpanded) {
                                                  setExpandedStudentId(null);
                                                } else {
                                                  setExpandedStudentId(st.id);
                                                  fetchStudentProgress(st.id);
                                                }
                                              }}
                                            >
                                              <div className="flex items-center gap-2">
                                                {isStExpanded ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
                                                <div className="flex flex-col">
                                                  <div className="flex items-center gap-1.5">
                                                     <span className="font-medium text-gray-800 text-xs">{st.name}</span>
                                                     {(() => {
                                                       let noteCategory: string | null = null;
                                                       if (st.private_notes && st.private_notes !== '<br>' && st.private_notes.trim() !== '') {
                                                         const val = st.private_notes.trim();
                                                         if (val.startsWith('{') && val.endsWith('}')) {
                                                           try {
                                                             const parsed = JSON.parse(val);
                                                             if (parsed.html && parsed.html !== '<br>' && parsed.html.trim() !== '') {
                                                               noteCategory = parsed.category || 'General';
                                                             }
                                                           } catch (e) {
                                                             noteCategory = 'General';
                                                           }
                                                         } else {
                                                           noteCategory = 'General';
                                                         }
                                                       }
                                                       if (!noteCategory) return null;
                                                       let label = lang === 'zh' ? '备忘' : 'Dossier';
                                                       let style = 'bg-emerald-50 text-emerald-700 border-emerald-150';
                                                       if (noteCategory === 'Academic') {
                                                         label = lang === 'zh' ? '学术' : 'Academic';
                                                         style = 'bg-blue-50 text-blue-700 border-blue-150';
                                                       } else if (noteCategory === 'Behavioral') {
                                                         label = lang === 'zh' ? '行为' : 'Behavior';
                                                         style = 'bg-purple-50 text-purple-700 border-purple-150';
                                                       } else if (noteCategory === 'SpecialCare') {
                                                         label = lang === 'zh' ? '关注' : 'Care';
                                                         style = 'bg-rose-50 text-rose-700 border-rose-150 animate-pulse font-semibold';
                                                       }
                                                       return (
                                                         <span className={`inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[8px] font-bold border ${style}`} title={lang === 'zh' ? '有私密备忘录' : 'Confidential teacher observations available'}>
                                                           <FileText size={8} />
                                                           {label}
                                                         </span>
                                                       );
                                                     })()}
                                                     {(() => {
                                                       const avg30 = get30DayAverageWarning(st.id, cls.id);
                                                       if (avg30 !== null) {
                                                         return (
                                                           <span 
                                                             className="inline-flex items-center gap-0.5 bg-red-50 text-red-700 border border-red-200 px-1 py-0.5 rounded text-[9px] font-bold animate-pulse"
                                                             title={lang === 'zh' ? `30天平均成绩已降至60%以下 (${avg30}%)` : `30-day average has dropped below 60% (${avg30}%)`}
                                                           >
                                                             <ShieldAlert size={10} className="text-red-500" />
                                                             {avg30}%
                                                           </span>
                                                         );
                                                       }
                                                       return null;
                                                     })()}
                                                   </div>
                                                  {st.email && <span className="text-[9px] text-gray-400">{st.email}</span>}
                                                </div>
                                              </div>
                                              <div className="flex items-center gap-3 shrink-0" onClick={(e) => e.stopPropagation()}>
                                                <button
                                                  title={lang === 'zh' ? '从当前班级移除' : 'Remove from Class'}
                                                  onClick={async (e) => {
                                                    if (window.confirm(lang === 'zh' ? `确定要将学生 [${st.name}] 从本班级移除吗？` : `Remove student [${st.name}] from this class?`)) {
                                                      const dRes = await fetch(`/api/classes/${cls.id}/students/${st.id}`, {
                                                        method: 'DELETE'
                                                      });
                                                      if (dRes.ok) {
                                                        await fetchClassStudents(cls.id);
                                                      }
                                                    }
                                                  }}
                                                  className="text-gray-400 hover:text-red-500 transition-colors p-1 cursor-pointer"
                                                >
                                                  <Trash2 size={13} />
                                                </button>
                                                <span className="text-[10px] text-gray-400 font-medium">Student</span>
                                              </div>
                                            </div>
                                            {isStExpanded && (
                                              <div className="pl-6 pb-2 pr-2 text-left">
                                                {/* Student level Tabs */}
                                                <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl mb-3 max-w-[320px] border border-slate-200/40" onClick={(e) => e.stopPropagation()}>
                                                  <button
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      setStudentActiveTabs(prev => ({ ...prev, [st.id]: 'progress' }));
                                                    }}
                                                    className={`flex-1 py-1 px-2 rounded-lg text-[10px] font-semibold flex items-center justify-center gap-1.5 transition-all duration-200 cursor-pointer ${
                                                      stActiveTab === 'progress'
                                                        ? 'bg-white text-indigo-600 shadow-xs font-bold border border-slate-200/50'
                                                        : 'text-slate-500 hover:text-slate-800 hover:bg-white/40'
                                                    }`}
                                                  >
                                                    <BookOpen size={10} />
                                                    <span>{lang === 'zh' ? '学习进度' : 'Progress'}</span>
                                                  </button>
                                                  <button
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      setStudentActiveTabs(prev => ({ ...prev, [st.id]: 'settings' }));
                                                    }}
                                                    className={`flex-1 py-1 px-2 rounded-lg text-[10px] font-semibold flex items-center justify-center gap-1.5 transition-all duration-200 cursor-pointer ${
                                                      stActiveTab === 'settings'
                                                        ? 'bg-white text-indigo-600 shadow-xs font-bold border border-slate-200/50'
                                                        : 'text-slate-500 hover:text-slate-800 hover:bg-white/40'
                                                    }`}
                                                  >
                                                    <Settings2 size={10} />
                                                    <span>{lang === 'zh' ? '教学控制' : 'Control'}</span>
                                                  </button>
                                                  <button
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      setStudentActiveTabs(prev => ({ ...prev, [st.id]: 'notes' }));
                                                    }}
                                                    className={`flex-1 py-1 px-2 rounded-lg text-[10px] font-semibold flex items-center justify-center gap-1.5 transition-all duration-200 cursor-pointer ${
                                                      stActiveTab === 'notes'
                                                        ? 'bg-white text-indigo-600 shadow-xs font-bold border border-slate-200/50'
                                                        : 'text-slate-500 hover:text-slate-800 hover:bg-white/40'
                                                    }`}
                                                  >
                                                    <FileText size={10} />
                                                    <span>{lang === 'zh' ? '私有备忘' : 'Private Notes'}</span>
                                                  </button>
                                                </div>

                                                {stActiveTab === 'settings' ? (
                                                  <div className="space-y-3" onClick={(e) => e.stopPropagation()}>
                                                    <div className="mt-1 flex items-center justify-between text-[11px] p-1.5 bg-gray-150/35 rounded border border-gray-100">
                                                      <span className="font-semibold text-gray-600">{lang === 'zh' ? '专注模式锁定(强制课程):' : 'Focus Mode Lock (Force Lesson):'}</span>
                                                      <select 
                                                        className="border rounded text-[11px] p-1 bg-white focus:ring-1 focus:ring-indigo-500 font-sans cursor-pointer text-gray-700"
                                                        value={st.locked_lesson_id || ""}
                                                        onChange={async (e) => {
                                                          const val = e.target.value === "" ? null : e.target.value;
                                                          const res = await fetch(`/api/students/${st.id}`, {
                                                            method: 'PUT',
                                                            headers: { 'Content-Type': 'application/json' },
                                                            body: JSON.stringify({ locked_lesson_id: val })
                                                          });
                                                          if (res.ok) await fetchStudents();
                                                        }}
                                                        onClick={(e) => e.stopPropagation()}
                                                      >
                                                        <option value="">{lang === 'zh' ? '无 (自主学习)' : 'None (Free Dashboard)'}</option>
                                                        {lessons.map(l => <option key={l.id} value={l.id}>{l.title}</option>)}
                                                      </select>
                                                    </div>

                                                    <div className="flex items-center justify-between text-[11px] p-1.5 bg-gray-150/35 rounded border border-gray-100 mt-1">
                                                      <span className="font-semibold text-gray-600">
                                                        {lang === 'zh' ? '该生个人登录密码:' : 'Personal Login Password:'}
                                                      </span>
                                                      <input 
                                                        type="text"
                                                        className="border rounded text-[11px] p-1 bg-white focus:ring-1 focus:ring-indigo-500 font-mono w-28 text-center select-all text-gray-750"
                                                        value={st.password || "123456"}
                                                        onChange={async (e) => {
                                                          const newPwd = e.target.value;
                                                          await fetch(`/api/students/${st.id}`, {
                                                            method: 'PUT',
                                                            headers: { 'Content-Type': 'application/json' },
                                                            body: JSON.stringify({ password: newPwd })
                                                          });
                                                          setStudents(prev => prev.map(s => s.id === st.id ? { ...s, password: newPwd } : s));
                                                        }}
                                                        onClick={(e) => e.stopPropagation()}
                                                        title={lang === 'zh' ? '点击可修改密码' : 'Click to edit student password'}
                                                      />
                                                    </div>
                                                    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                                      <select 
                                                        id={`assign-lesson-class-${st.id}`}
                                                        className="border rounded text-[11px] p-1 flex-1 bg-white focus:ring-1 focus:ring-indigo-500 font-sans cursor-pointer text-gray-700"
                                                      >
                                                        <option value="">-- {lang === 'zh' ? '分配独立拓展课程' : 'Assign Independent Course'} --</option>
                                                        {lessons.filter(l => !progress.some(p => p.lesson_id === l.id)).map(l => <option key={l.id} value={l.id}>{l.title}</option>)}
                                                      </select>
                                                      <button 
                                                        className="bg-indigo-50 text-indigo-600 hover:bg-indigo-100 border border-indigo-200 px-2 py-1 rounded text-xs font-semibold cursor-pointer"
                                                        onClick={async (e) => {
                                                          const sel = document.getElementById(`assign-lesson-class-${st.id}`) as HTMLSelectElement;
                                                          if (sel && sel.value) {
                                                            const res = await fetch(`/api/students/${st.id}/progress`, {
                                                              method: 'POST',
                                                              headers: { 'Content-Type': 'application/json' },
                                                              body: JSON.stringify({ lessonId: sel.value, completed: false, progressPercent: 0 })
                                                            });
                                                            if (res.ok) {
                                                              fetchStudentProgress(st.id);
                                                              sel.value = "";
                                                            }
                                                          }
                                                        }}
                                                      >
                                                        {lang === 'zh' ? '分配' : 'Assign'}
                                                      </button>
                                                    </div>
                                                  </div>
                                                ) : stActiveTab === 'notes' ? (
                                                  <div className="mt-1" onClick={(e) => e.stopPropagation()}>
                                                    <StudentPrivateNotesEditor
                                                      studentId={st.id}
                                                      studentName={st.name}
                                                      initialValue={st.private_notes}
                                                      lang={lang}
                                                      onSave={async (newNotes) => {
                                                        const res = await fetch(`/api/students/${st.id}`, {
                                                          method: 'PUT',
                                                          headers: { 'Content-Type': 'application/json' },
                                                          body: JSON.stringify({ private_notes: newNotes })
                                                        });
                                                        if (res.ok) {
                                                          setStudents(prev => prev.map(s => s.id === st.id ? { ...s, private_notes: newNotes } : s));
                                                          if (classStudentsMap[cls.id]) {
                                                            setClassStudentsMap(prev => {
                                                              const list = prev[cls.id] || [];
                                                              return {
                                                                ...prev,
                                                                [cls.id]: list.map(s => s.id === st.id ? { ...s, private_notes: newNotes } : s)
                                                              };
                                                            });
                                                          }
                                                          return true;
                                                        }
                                                        return false;
                                                      }}
                                                    />
                                                  </div>
                                                ) : (
                                                  <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
                                                    {progress.length === 0 ? (
                                                      <div className="text-xs text-gray-500 italic">{lang === 'zh' ? '未分配任何课程。' : 'No assigned lessons.'}</div>
                                                    ) : (
                                                      <div className="flex flex-col gap-2">
                                                        {progress.map(p => (
                                                          <div key={p.lesson_id} className="text-xs flex items-center justify-between pr-2">
                                                            <span className="truncate max-w-[130px] font-semibold text-gray-750" title={p.lesson_title}>{p.lesson_title}</span>
                                                            <div className="flex-1 mx-2 h-1.5 bg-gray-200 rounded-full overflow-hidden shrink-0">
                                                              <div className={`h-full ${p.progress_percent === 100 ? 'bg-green-500' : 'bg-indigo-500'}`} style={{ width: `${p.progress_percent}%` }}></div>
                                                            </div>
                                                            <span className="text-[9px] text-gray-400 w-6 text-right shrink-0 font-medium font-sans">{p.progress_percent}%</span>
                                                          </div>
                                                        ))}
                                                      </div>
                                                    )}
                                                  </div>
                                                )}
                                              </div>
                                            )}
                                          </div>
                                        );
                                            })}
                                          </div>
                                        )}
                                      </div>
                                    );
                                 })()}
                               </div>
                               )}

                               {(classActiveTabs[cls.id] || 'students') === 'grades' && (
                                 <SemesterGradeManager
                                   classId={cls.id}
                                   className={cls.name}
                                   students={cStudents}
                                   lang={lang}
                                 />
                               )}
                             </motion.div>
                           )}
                         </div>
                       );
                     })}
                   </>
                )}
              </div>
            </div>
            
            </div>
            ) : teacherTab === 'timetable' ? (
              <TimetableView classes={classes} lessons={lessons} lang={lang} onSchedulesUpdated={fetchTodaySchedules} />
            ) : teacherTab === 'admin_directory' ? (
              <AdminDirectoryView session={session} lang={lang} onLogout={handleLogout} />
            ) : teacherTab === 'settings' ? (
              <SettingsView
                lang={lang}
                aiProviders={aiProviders}
                testingProviderId={testingProviderId}
                onAddProvider={() => {
                  setEditingAIProvider(null);
                  setProviderName('');
                  setProviderApiUrl('');
                  setProviderApiKey('');
                  setProviderModelName('');
                  setIsAIProviderModalOpen(true);
                }}
                onEditProvider={(provider) => {
                  setEditingAIProvider(provider);
                  setProviderName(provider.name);
                  setProviderApiUrl(provider.api_url);
                  setProviderApiKey(provider.api_key || '');
                  setProviderModelName(provider.model_name);
                  setIsAIProviderModalOpen(true);
                }}
                onTestProvider={handleTestAIProvider}
                onDeleteProvider={handleDeleteAIProvider}
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

      {/* AI Provider Add/Edit Modal */}
      {isAIProviderModalOpen && (
        <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 overflow-y-auto">
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white rounded-2xl shadow-xl border border-gray-200/60 w-full max-w-md overflow-hidden text-gray-800 text-left"
          >
            <div className="flex items-center justify-between p-5 border-b border-gray-100 bg-slate-50/70">
              <h3 className="font-extrabold text-sm sm:text-base text-gray-800 flex items-center gap-2">
                <Settings2 className="text-indigo-600" size={18} />
                {editingAIProvider
                  ? (lang === 'zh' ? '编辑 AI 提供商配置' : 'Edit AI Provider')
                  : (lang === 'zh' ? '添加全新 AI 提供商' : 'Add New AI Provider')}
              </h3>
              <button
                onClick={() => {
                  setIsAIProviderModalOpen(false);
                  setEditingAIProvider(null);
                }}
                className="p-1 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100 transition-colors"
                title={lang === 'zh' ? '关闭' : 'Close'}
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSaveAIProvider} className="p-5 space-y-4 text-left">
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5 text-left">
                  {lang === 'zh' ? '服务商名称 *' : 'Provider Name *'}
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Deepseek, Minimax"
                  value={providerName}
                  onChange={(e) => setProviderName(e.target.value)}
                  className="w-full text-xs sm:text-sm bg-gray-50 hover:bg-gray-100/50 focus:bg-white border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all font-semibold"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5 text-left">
                  {lang === 'zh' ? 'API 网络请求端点URL *' : 'API Request URL (Endpoint) *'}
                </label>
                <input
                  type="url"
                  required
                  placeholder="https://api.deepseek.com/v1"
                  value={providerApiUrl}
                  onChange={(e) => setProviderApiUrl(e.target.value)}
                  className="w-full text-xs sm:text-sm bg-gray-50 hover:bg-gray-100/50 focus:bg-white border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all font-mono"
                />
                <span className="text-[10px] text-gray-400 mt-1 block">
                  {lang === 'zh' ? '符合 OpenAI 规范的标准 API 的统一基准 URL。' : 'OpenAI-compatible URL prefix (e.g. /v1).'}
                </span>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5 text-left">
                  {lang === 'zh' ? '模型代号 Identifier *' : 'Model Name / Identifier *'}
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. deepseek-chat, abab6.5-chat"
                  value={providerModelName}
                  onChange={(e) => setProviderModelName(e.target.value)}
                  className="w-full text-xs sm:text-sm bg-gray-50 hover:bg-gray-100/50 focus:bg-white border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5 text-left">
                  {lang === 'zh' ? '验证授权密钥 API Key (可选)' : 'Authentication API Key (Optional)'}
                </label>
                <input
                  type="password"
                  placeholder={lang === 'zh' ? '不修改请留空或输入对应Bearer安全密钥' : 'Leave empty to preserve existing key or enter Bearer token'}
                  value={providerApiKey}
                  onChange={(e) => setProviderApiKey(e.target.value)}
                  className="w-full text-xs sm:text-sm bg-gray-50 hover:bg-gray-100/50 focus:bg-white border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all font-mono"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => {
                    setIsAIProviderModalOpen(false);
                    setEditingAIProvider(null);
                  }}
                  className="px-4 py-2 text-xs font-bold text-gray-500 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer transition-colors"
                >
                  {lang === 'zh' ? '取消' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm transition-all cursor-pointer"
                >
                  {lang === 'zh' ? '保存至数据库' : 'Save Connection'}
                </button>
              </div>
            </form>
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
            <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/80 shrink-0">
              <div className="flex items-center gap-3">
                <Globe size={20} className="text-emerald-500 animate-pulse" />
                <h2 className="font-semibold text-gray-800 text-lg">
                  {lang === 'zh' ? '系统资源库与应用商城' : 'System Resource Library'}
                </h2>
                <span className="text-xs bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full font-bold">
                  {lang === 'zh' ? '支持单HTML与完整文件夹' : 'Supports HTML files & Folders'}
                </span>
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
                        sandbox="allow-scripts allow-same-origin"
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
          </div>
        </div>
      )}

      {/* Grade Export Weighting Settings Modal */}
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

      </div>
    </>
  );
}
