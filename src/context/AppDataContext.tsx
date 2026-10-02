/**
 * AppDataContext（C1-R3 / 路线图 C1-R3 P0′）。
 *
 * 目标：消除 App → AppShell → TeacherView/StudentView → tab 组件的 227 props
 * 透传。App 仍是唯一数据源（组装 `AppDataValue` 显式传入），tab 组件经
 * `useAppData()` 消费；不移动任何 state 位置。
 *
 * 类型策略：AppDataValue = 9 个 R2 hooks + 既有 hooks 的 ReturnType 交集
 * （类型直接从实现推导，零漂移）∪ AppExtras（Pick 自 TeacherViewProps 的
 * App 局部 state/派生值）。
 *
 * 重渲染说明：value 为每渲染新对象（依赖即全部数据，useMemo 无效）。全库仅
 * LoginPage 使用 React.memo，各 tab 组件本就随 App 渲染而重渲染，context
 * 传递不劣于现状；未来对重 tab 引入 memo 时再按领域拆分 context。
 */
import { createContext, useContext, type ReactNode } from 'react';
import type { useToast } from '../hooks/useToast';
import type { useSystemData } from '../hooks/useSystemData';
import type { useResourceLibrary } from '../hooks/useResourceLibrary';
import type { useLessonCrud } from '../hooks/useLessonCrud';
import type { useClassOps } from '../hooks/useClassOps';
import type { useStudentViewState } from '../hooks/useStudentViewState';
import type { useStudentOps } from '../hooks/useStudentOps';
import type { useSessionBootstrap } from '../hooks/useSessionBootstrap';
import type { useClassroomLive } from '../hooks/useClassroomLive';
import type { useLabAndSchedule } from '../hooks/useLabAndSchedule';
import type { usePluginManagement } from '../hooks/usePluginManagement';
import type { useAgentChat } from '../hooks/useAgentChat';
import type { useQuizGenerator } from '../hooks/useQuizGenerator';
import type { useCourseWizard } from '../hooks/useCourseWizard';
import type { useClassBatchOperations } from '../hooks/useClassBatchOperations';
import type { useLessonTimeline } from '../hooks/useLessonTimeline';
import type { useStudentNotifications } from '../hooks/useStudentNotifications';
import type { useGradeExport } from '../hooks/useGradeExport';
import type { useLessonFiltering } from '../hooks/useLessonFiltering';
import type { Dispatch, SetStateAction, MutableRefObject } from 'react';
import type { Lesson, ClassType, StudentType, SessionType } from '../types/app';
import type { ClassTabKey } from '../features/teacher/classes/ClassTabs';

/** App 局部 state / 派生值 */
export type AppExtras = {
  t: any;
  lessons: Lesson[];
  selectedLesson: string | null;
  elements: any[];
  classes: ClassType[];
  students: StudentType[];
  session: SessionType | null;
  whiteboardRef: MutableRefObject<any>;
  paletteEdit: { type: string; data: Record<string, any> } | null;
  handlePaletteActivate: (type: string) => void;
  handlePaletteConfirm: (data: Record<string, any>) => Promise<void>;
  setPaletteEdit: (value: { type: string; data: Record<string, any> } | null) => void;
  activeSegmentId: string | null;
  setActiveSegmentId: (value: string | null) => void;
  timelineSegments: any[];
  draggedSegmentIdx: number | null;
  setDraggedSegmentIdx: (value: number | null) => void;
  saveTimeline: (lessonId: string, newSegments: any[]) => Promise<void>;
  editorSaveStatus: 'none' | 'saving' | 'saved' | 'error';
  setEditorSaveStatus: (status: 'none' | 'saving' | 'saved' | 'error') => void;
  editorLastSavedTime: Date | null;
  setEditorLastSavedTime: (time: Date | null) => void;
  editorPanelsExpanded: boolean;
  setEditorPanelsExpanded: (value: boolean) => void;
  setSelectedLesson: (id: string | null) => void;
  socketRef: MutableRefObject<any>;
  liveClassSelectedClassId: string | null;
  setLiveClassSelectedClassId: (id: string | null) => void;
  liveClassIsActive: boolean;
  setLiveClassIsActive: (active: boolean) => void;
  setTeacherTab: (tab: string) => void;
  teacherTab: string;
  mainNavCollapsed: boolean;
  setMainNavCollapsed: Dispatch<SetStateAction<boolean>>;
  batchMode: boolean;
  setBatchMode: Dispatch<SetStateAction<boolean>>;
  selectedClassIds: Set<string>;
  setSelectedClassIds: Dispatch<SetStateAction<Set<string>>>;
  setSelectedStudentIds: Dispatch<SetStateAction<Set<string>>>;
  expandedClassId: string | null;
  setExpandedClassId: (id: string | null) => void;
  exportTooltipOpen: boolean;
  setExportTooltipOpen: Dispatch<SetStateAction<boolean>>;
  exportDropdownOpen: boolean;
  setExportDropdownOpen: Dispatch<SetStateAction<boolean>>;
  expandedStudentId: string | null;
  setExpandedStudentId: Dispatch<SetStateAction<string | null>>;
  selectedStudentIds: Set<string>;
  rosterViewMode: 'grid' | 'list';
  setRosterViewMode: Dispatch<SetStateAction<'grid' | 'list'>>;
  rosterSearchQuery: string;
  setRosterSearchQuery: Dispatch<SetStateAction<string>>;
  rosterTagFilter: 'all' | 'Academic' | 'Behavioral' | 'General' | 'SpecialCare';
  setRosterTagFilter: Dispatch<SetStateAction<'all' | 'Academic' | 'Behavioral' | 'General' | 'SpecialCare'>>;
  classSubmissionFilters: Record<string, 'all' | 'submitted' | 'graded' | 'pending'>;
  setClassSubmissionFilters: Dispatch<SetStateAction<Record<string, 'all' | 'submitted' | 'graded' | 'pending'>>>;
  classActiveTabs: Record<string, ClassTabKey>;
  setClassActiveTabs: Dispatch<SetStateAction<Record<string, ClassTabKey>>>;
  assignmentSortOrder: 'dueDate' | 'status' | 'avgScore';
  setAssignmentSortOrder: Dispatch<SetStateAction<'dueDate' | 'status' | 'avgScore'>>;
  isGeneratingAssignment: string | null;
  isGrading: Record<string, boolean>;
  setIsGrading: Dispatch<SetStateAction<Record<string, boolean>>>;
  setStudents: (students: StudentType[]) => void;
  fetchStudents: () => Promise<void>;
  setImportError: (v: string | null) => void;
  setImportSuccess: (v: string | null) => void;
  setShowImportModal: (v: boolean) => void;
  /** 语义别名（源自 useSessionBootstrap.handleLogout / usePluginManagement.fetchAIProviders / useLessonCrud） */
  setReadNotifications: (updater: (prev: Set<string>) => Set<string>) => void;
  localProgressPercent: number;
  setLocalProgressPercent: (v: number) => void;
  onViewCourse: (lessonId: string) => void;
  isApprovalsCollapsed: boolean;
  setIsApprovalsCollapsed: (v: boolean) => void;
  isProcessesCollapsed: boolean;
  setIsProcessesCollapsed: (v: boolean) => void;
  studentActiveTabs: Record<string, 'progress' | 'settings' | 'notes'>;
  setStudentActiveTabs: (updater: (prev: Record<string, 'progress' | 'settings' | 'notes'>) => Record<string, 'progress' | 'settings' | 'notes'>) => void;
  /** 语义别名（源自 useSessionBootstrap.handleLogout / usePluginManagement.fetchAIProviders / useLessonCrud） */
  onLogout: () => void;
  onAIProvidersChanged: () => void;
  onDeleteCourse: (lessonId: string) => Promise<void>;
  onCopyCourse: (lessonId: string) => Promise<void>;

  // ── RightSidebar 局部状态 ──────────────────────────────────────────
  showRightSidebar: boolean;
  setShowRightSidebar: Dispatch<SetStateAction<boolean>>;
  rightSidebarTab: 'agent' | 'shell';
  setRightSidebarTab: Dispatch<SetStateAction<'agent' | 'shell'>>;
  agentProviderId: string;
  setAgentProviderId: Dispatch<SetStateAction<string>>;
  effectiveAgentProviderId: string;
  selectedAgentProvider: any | null;

  // ── AppModals 局部状态 ─────────────────────────────────────────────
  isTourOpen: boolean;
  setIsTourOpen: Dispatch<SetStateAction<boolean>>;
  handleSeedSuccess: (data: { classId: string; scheduleId: string; lessonId: string }) => Promise<void>;
  generateTemplateContent?: (title: string, category: string) => string;

  // ── AppHeader 局部状态 ─────────────────────────────────────────────
  activeRole?: 'teacher' | 'student';
  setActiveRole?: Dispatch<SetStateAction<'teacher' | 'student'>> | ((role: 'teacher' | 'student') => void);
  isStudentPreviewMode?: boolean;
  isNotificationsOpen?: boolean;
  setIsNotificationsOpen?: Dispatch<SetStateAction<boolean>>;
  selectedNotificationForModal?: any;
  setSelectedNotificationForModal?: Dispatch<SetStateAction<any | null>>;
  setProfileOpen?: Dispatch<SetStateAction<boolean>>;
  notifyLockedNavigation?: () => void;
  handleLogout?: () => void;
  toggleLanguage?: () => void;
  setIsSystemResourceLibraryOpen?: Dispatch<SetStateAction<boolean>>;
  siteInfo?: any;
  isStudentLiveMode?: boolean;
  liveStudentParam?: string | null;
  isFollowingTeacher?: boolean;
  setIsFollowingTeacher?: Dispatch<SetStateAction<boolean>>;
};

export type AppDataValue = ReturnType<typeof useToast> &
  ReturnType<typeof useSystemData> &
  ReturnType<typeof useResourceLibrary> &
  ReturnType<typeof useLessonCrud> &
  ReturnType<typeof useClassOps> &
  ReturnType<typeof useStudentViewState> &
  ReturnType<typeof useStudentOps> &
  ReturnType<typeof useSessionBootstrap> &
  ReturnType<typeof useClassroomLive> &
  ReturnType<typeof useLabAndSchedule> &
  ReturnType<typeof usePluginManagement> &
  ReturnType<typeof useAgentChat> &
  ReturnType<typeof useQuizGenerator> &
  ReturnType<typeof useCourseWizard> &
  ReturnType<typeof useClassBatchOperations> &
  ReturnType<typeof useLessonTimeline> &
  ReturnType<typeof useStudentNotifications> &
  ReturnType<typeof useGradeExport> &
  ReturnType<typeof useLessonFiltering> &
  AppExtras;

export const AppDataContext = createContext<AppDataValue | null>(null);

export function AppDataProvider({ value, children }: { value: AppDataValue; children: ReactNode }) {
  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

/** 消费 App 级数据；必须在 AppDataProvider 内使用 */
export function useAppData(): AppDataValue {
  const ctx = useContext(AppDataContext);
  if (!ctx) {
    throw new Error('useAppData must be used within <AppDataProvider>');
  }
  return ctx;
}

/** 消费 App 级数据；若未挂载 Provider 则返回 null（用于双模组件兼容独立单测） */
export function useOptionalAppData(): AppDataValue | null {
  return useContext(AppDataContext);
}
