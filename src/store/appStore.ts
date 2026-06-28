import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { Language } from '../i18n';
import type {
  Lesson,
  WhiteboardElement,
  ClassType,
  StudentType,
  PluginType,
  AIProvider,
  ProcessType,
  VFSNode,
  ScheduleType,
  SessionType,
  Toast,
} from '../types/app';

// ── State interface ────────────────────────────────────────────────────────

export interface AppState {
  // Core (existing)
  lang: Language;
  session: SessionType | null;
  lessons: Lesson[];
  selectedLesson: string | null;
  elements: WhiteboardElement[];
  classes: ClassType[];
  students: StudentType[];
  liveClassSelectedClassId: string | null;
  liveClassIsActive: boolean;

  // Shared API data (Phase 1 additions)
  aiProviders: AIProvider[];
  plugins: PluginType[];
  registeredCommands: any[];
  events: any[];
  approvals: any[];
  processes: ProcessType[];
  vfsNodes: VFSNode[];
  todaySchedules: ScheduleType[];
  computerLabs: any[];
  dbConnected: boolean;
  sessionLoading: boolean;

  // Cross-tab maps
  classStudentsMap: Record<string, StudentType[]>;
  classDashboardMap: Record<string, any>;
  studentProgressMap: Record<string, any[]>;
  classSchedulesMap: Record<string, ScheduleType[]>;
  scheduleAttendanceMap: Record<string, any[]>;
  assignmentSubmissionsMap: Record<string, any[]>;
  classAssignmentsMap: Record<string, any[]>;
  classProgressMap: Record<string, any>;
  classSeats: { lab_id: string | null; seats: any[] };

  // Socket-driven
  onlineStudentIds: string[];
  activeStudentLessons: Record<string, string>;

  // Live class
  liveClassFeed: any[];
  liveClassTimeRemaining: number;
  liveClassAcknowledgedMap: Map<string, boolean>;
  liveClassStudentProgress: any[];

  // Student view
  studentDashboardData: any;
  notifications: any[];

  // Toast
  toasts: Toast[];

  // ── Actions ──────────────────────────────────────────────────────────────

  // Core setters (existing)
  setLang: (lang: Language) => void;
  setSession: (session: SessionType | null) => void;
  setLessons: (lessons: Lesson[]) => void;
  setSelectedLesson: (selectedLesson: string | null) => void;
  setElements: (elements: WhiteboardElement[]) => void;
  setClasses: (classes: ClassType[]) => void;
  setStudents: (students: StudentType[]) => void;
  setLiveClassSelectedClassId: (id: string | null) => void;
  setLiveClassIsActive: (isActive: boolean) => void;

  // Shared data setters
  setAiProviders: (providers: AIProvider[]) => void;
  setPlugins: (plugins: PluginType[]) => void;
  setRegisteredCommands: (cmds: any[]) => void;
  setEvents: (events: any[]) => void;
  setApprovals: (approvals: any[]) => void;
  setProcesses: (processes: ProcessType[]) => void;
  setVfsNodes: (nodes: VFSNode[]) => void;
  setTodaySchedules: (schedules: ScheduleType[]) => void;
  setComputerLabs: (labs: any[]) => void;
  setDbConnected: (connected: boolean) => void;
  setSessionLoading: (loading: boolean) => void;

  // Map setters
  setClassStudents: (classId: string, students: StudentType[]) => void;
  setClassDashboard: (classId: string, dashboard: any) => void;
  setStudentProgress: (studentId: string, progress: any[]) => void;
  setClassSchedules: (classId: string, schedules: ScheduleType[]) => void;
  setScheduleAttendance: (scheduleId: string, attendance: any[]) => void;
  setAssignmentSubmissions: (assignmentId: string, submissions: any[]) => void;
  setClassAssignments: (classId: string, assignments: any[]) => void;
  setClassProgress: (classId: string, progress: any) => void;
  setClassSeats: (seats: { lab_id: string | null; seats: any[] }) => void;

  // Socket-driven setters
  setOnlineStudentIds: (ids: string[]) => void;
  setActiveStudentLessons: (lessons: Record<string, string>) => void;

  // Live class setters
  setLiveClassFeed: (feed: any[]) => void;
  appendLiveClassFeed: (entry: any) => void;
  setLiveClassTimeRemaining: (time: number) => void;
  setLiveClassAcknowledgedMap: (map: Map<string, boolean>) => void;
  setLiveClassStudentProgress: (progress: any[]) => void;

  // Student view setters
  setStudentDashboardData: (data: any) => void;
  setNotifications: (notifications: any[]) => void;

  // Toast setters
  addToast: (toast: Toast) => void;
  removeToast: (id: string) => void;
}

// ── Create vanilla store ───────────────────────────────────────────────────

export const appStore = createStore<AppState>((set) => ({
  // Core defaults
  lang: 'zh',
  session: null,
  lessons: [],
  selectedLesson: null,
  elements: [],
  classes: [],
  students: [],
  liveClassSelectedClassId: null,
  liveClassIsActive: false,

  // Shared data defaults
  aiProviders: [],
  plugins: [],
  registeredCommands: [],
  events: [],
  approvals: [],
  processes: [],
  vfsNodes: [],
  todaySchedules: [],
  computerLabs: [],
  dbConnected: false,
  sessionLoading: true,

  // Map defaults
  classStudentsMap: {},
  classDashboardMap: {},
  studentProgressMap: {},
  classSchedulesMap: {},
  scheduleAttendanceMap: {},
  assignmentSubmissionsMap: {},
  classAssignmentsMap: {},
  classProgressMap: {},
  classSeats: { lab_id: null, seats: [] },

  // Socket defaults
  onlineStudentIds: [],
  activeStudentLessons: {},

  // Live class defaults
  liveClassFeed: [],
  liveClassTimeRemaining: 0,
  liveClassAcknowledgedMap: new Map(),
  liveClassStudentProgress: [],

  // Student defaults
  studentDashboardData: null,
  notifications: [],

  // Toast defaults
  toasts: [],

  // ── Core setters ──────────────────────────────────────────────────────

  setLang: (lang) => set({ lang }),
  setSession: (session) => set({ session }),
  setLessons: (lessons) => set({ lessons }),
  setSelectedLesson: (selectedLesson) => set({ selectedLesson }),
  setElements: (elements) => set({ elements }),
  setClasses: (classes) => set({ classes }),
  setStudents: (students) => set({ students }),
  setLiveClassSelectedClassId: (liveClassSelectedClassId) => set({ liveClassSelectedClassId }),
  setLiveClassIsActive: (liveClassIsActive) => set({ liveClassIsActive }),

  // ── Shared data setters ───────────────────────────────────────────────

  setAiProviders: (aiProviders) => set({ aiProviders }),
  setPlugins: (plugins) => set({ plugins }),
  setRegisteredCommands: (registeredCommands) => set({ registeredCommands }),
  setEvents: (events) => set({ events }),
  setApprovals: (approvals) => set({ approvals }),
  setProcesses: (processes) => set({ processes }),
  setVfsNodes: (vfsNodes) => set({ vfsNodes }),
  setTodaySchedules: (todaySchedules) => set({ todaySchedules }),
  setComputerLabs: (computerLabs) => set({ computerLabs }),
  setDbConnected: (dbConnected) => set({ dbConnected }),
  setSessionLoading: (sessionLoading) => set({ sessionLoading }),

  // ── Map setters (immutable update per zustand convention) ──────────────

  setClassStudents: (classId, students) =>
    set((s) => ({ classStudentsMap: { ...s.classStudentsMap, [classId]: students } })),
  setClassDashboard: (classId, dashboard) =>
    set((s) => ({ classDashboardMap: { ...s.classDashboardMap, [classId]: dashboard } })),
  setStudentProgress: (studentId, progress) =>
    set((s) => ({ studentProgressMap: { ...s.studentProgressMap, [studentId]: progress } })),
  setClassSchedules: (classId, schedules) =>
    set((s) => ({ classSchedulesMap: { ...s.classSchedulesMap, [classId]: schedules } })),
  setScheduleAttendance: (scheduleId, attendance) =>
    set((s) => ({ scheduleAttendanceMap: { ...s.scheduleAttendanceMap, [scheduleId]: attendance } })),
  setAssignmentSubmissions: (assignmentId, submissions) =>
    set((s) => ({ assignmentSubmissionsMap: { ...s.assignmentSubmissionsMap, [assignmentId]: submissions } })),
  setClassAssignments: (classId, assignments) =>
    set((s) => ({ classAssignmentsMap: { ...s.classAssignmentsMap, [classId]: assignments } })),
  setClassProgress: (classId, progress) =>
    set((s) => ({ classProgressMap: { ...s.classProgressMap, [classId]: progress } })),
  setClassSeats: (classSeats) => set({ classSeats }),

  // ── Socket-driven setters ─────────────────────────────────────────────

  setOnlineStudentIds: (onlineStudentIds) => set({ onlineStudentIds }),
  setActiveStudentLessons: (activeStudentLessons) => set({ activeStudentLessons }),

  // ── Live class setters ────────────────────────────────────────────────

  setLiveClassFeed: (liveClassFeed) => set({ liveClassFeed }),
  appendLiveClassFeed: (entry) =>
    set((s) => ({ liveClassFeed: [...s.liveClassFeed.slice(-49), entry] })),
  setLiveClassTimeRemaining: (liveClassTimeRemaining) => set({ liveClassTimeRemaining }),
  setLiveClassAcknowledgedMap: (liveClassAcknowledgedMap) => set({ liveClassAcknowledgedMap }),
  setLiveClassStudentProgress: (liveClassStudentProgress) => set({ liveClassStudentProgress }),

  // ── Student view setters ──────────────────────────────────────────────

  setStudentDashboardData: (studentDashboardData) => set({ studentDashboardData }),
  setNotifications: (notifications) => set({ notifications }),

  // ── Toast setters ─────────────────────────────────────────────────────

  addToast: (toast) => set((s) => ({ toasts: [...s.toasts, toast] })),
  removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

// ── React-bound hook ───────────────────────────────────────────────────────

export const useAppStore = <T>(selector: (state: AppState) => T) => useStore(appStore, selector);

// Re-export types for convenience
export type {
  Lesson,
  WhiteboardElement,
  ClassType,
  StudentType,
  PluginType,
  AIProvider,
  ProcessType,
  VFSNode,
  ScheduleType,
  SessionType,
  Toast,
};
