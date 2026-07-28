import type { Dispatch, SetStateAction, MutableRefObject } from 'react';
import type {
  Lesson,
  ClassType,
  StudentType,
  ScheduleType,
  StudentProgressType,
  AttendanceType,
  AIProvider,
  SessionType,
  ProcessType,
} from '../../types/app';
import { Dashboard } from './Dashboard';
import { LessonEditorView } from './LessonEditorView';
import { LiveClassroomView } from '../../components/LiveClassroomView';
import { PluginView } from './PluginView';
import { CourseManagement } from './CourseManagement';
import { ClassesView } from './classes/ClassesView';
import { TimetableView } from './TimetableView';
import { AdminDirectoryView } from './AdminDirectoryView';
import { ComputerLabView } from './ComputerLabView';
import { HelpView } from './HelpView';
import { NavigationSidebar } from '../shared/NavigationSidebar';
import { PluginTabPanel } from '../../components/PluginTabPanel';

/**
 * TeacherView is the single wrapper for the entire `teacher` branch of App.tsx.
 * TeacherViewProps is a flat composition of every child component's prop bag
 * (mirroring the StudentView precedent). Shared props are typed to the greatest
 * lower bound across the children that declare them, and the few extra
 * identifiers referenced only by App's inline expressions (socketRef,
 * setShowCoursewareHub, fetchTodaySchedules) are added explicitly.
 */
export interface TeacherViewProps {
  // ── NavigationSidebar ───────────────────────────────────────────────
  mainNavCollapsed: boolean;
  setMainNavCollapsed: (v: boolean) => void;
  teacherTab: string;
  setTeacherTab: (tab: string) => void;
  lang: 'zh' | 'en';
  session: SessionType | null;
  todaySchedules: ScheduleType[];

  // ── Dashboard ───────────────────────────────────────────────────────
  t: any;
  lessons: Lesson[];
  classes: ClassType[];
  students: StudentType[];
  approvals: any[];
  processes: ProcessType[];
  isApprovalsCollapsed: boolean;
  setIsApprovalsCollapsed: (v: boolean) => void;
  isProcessesCollapsed: boolean;
  setIsProcessesCollapsed: (v: boolean) => void;
  scoreOverrides: Record<string, number>;
  setScoreOverrides: (v: Record<string, number>) => void;
  handleApprove: (id: string, overrides?: any) => Promise<void>;
  handleReject: (id: string) => Promise<void>;
  showLogs: boolean;
  setShowLogs: (v: boolean) => void;
  processLogsContent: string;
  showProcessLogs: string | null;
  fetchProcessLogs: (id: string) => Promise<void>;
  setShowProcessLogs: (id: string | null) => void;
  addToast: (title: string, message: string, type?: 'info' | 'success' | 'warning') => void;
  handleQuickScheduleClass: (classId: string, lessonId: string, date: string) => Promise<boolean>;
  handleQuickGenerateAssignment: (classId: string, title: string, desc: string) => Promise<string | null>;
  handleQuickCreateLesson: (title: string, content: string) => Promise<string>;

  // ── LessonEditorView ────────────────────────────────────────────────
  selectedLesson: string | null;
  activeRole: 'teacher' | 'student';
  setActiveRole: Dispatch<SetStateAction<'teacher' | 'student'>>;
  editorSaveStatus: 'none' | 'saving' | 'saved' | 'error';
  setEditorSaveStatus: (status: 'none' | 'saving' | 'saved' | 'error') => void;
  editorLastSavedTime: Date | null;
  setEditorLastSavedTime: (time: Date | null) => void;
  setIsLessonPreviewVisible: (value: boolean) => void;
  setPreviewLessonTab: (value: 'whiteboard' | 'courseware') => void;
  setPreviewSelectedCourseware: (value: string | null) => void;
  handlePaletteActivate: (type: string) => void;
  timelineSegments: any[];
  activeSegmentId: string | null;
  setActiveSegmentId: (value: string | null) => void;
  draggedSegmentIdx: number | null;
  setDraggedSegmentIdx: (value: number | null) => void;
  saveTimeline: (lessonId: string, newSegments: any[]) => Promise<void>;
  editorPanelsExpanded: boolean;
  setEditorPanelsExpanded: (value: boolean) => void;
  fetchElements: (lessonId: string) => Promise<void>;
  whiteboardRef: MutableRefObject<any>;
  elements: any[];
  paletteEdit: { type: string; data: Record<string, any> } | null;
  handlePaletteConfirm: (data: Record<string, any>) => Promise<void>;
  setPaletteEdit: (value: { type: string; data: Record<string, any> } | null) => void;

  // ── LiveClassroomView ───────────────────────────────────────────────
  setSelectedLesson: (id: string | null) => void;
  plugins: any[];
  liveClassSelectedClassId: string | null;
  setLiveClassSelectedClassId: (id: string | null) => void;
  liveClassIsActive: boolean;
  setLiveClassIsActive: (active: boolean) => void;
  liveClassTimeRemaining: number;
  setLiveClassTimeRemaining: (seconds: number) => void;
  liveClassFeed: any[];
  setLiveClassFeed: Dispatch<SetStateAction<any[]>>;
  liveClassAcknowledgedMap: Map<string, boolean>;
  setLiveClassAcknowledgedMap: Dispatch<SetStateAction<Map<string, boolean>>>;
  onlineStudentIds: string[];
  activeStudentLessons: Record<string, string>;
  liveClassStudentProgress: any[];
  onPingStudent?: (studentId: string, message?: string) => void;
  onOpenCoursewareHub?: () => void;

  // ── PluginView ──────────────────────────────────────────────────────
  storeTab: string;
  setStoreTab: (tab: string) => void;
  pluginCode: string;
  setPluginCode: (code: string) => void;
  installingPlugin: boolean;
  onInstall: (code: string) => Promise<void>;
  onZipUpload: (
    file: File,
    executionMode: 'worker' | 'inline',
    opts?: { mode?: 'install' | 'update'; targetPluginId?: string; allowDowngrade?: boolean },
  ) => Promise<void>;
  onToggle: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;

  // ── CourseManagement ────────────────────────────────────────────────
  lessonsSearchQuery: string;
  setLessonsSearchQuery: (q: string) => void;
  lessonsSortOrder: 'recent' | 'alphabetical' | 'enrollment';
  setLessonsSortOrder: (o: 'recent' | 'alphabetical' | 'enrollment') => void;
  filteredLessons: Lesson[];
  onOpenImportLessons: () => void;
  onOpenCourseWizard: () => void;
  onViewCourse: (lessonId: string) => void;

  // ── TimetableView ───────────────────────────────────────────────────
  onSchedulesUpdated: () => Promise<void>;

  // ── AdminDirectoryView ──────────────────────────────────────────────
  onLogout: () => void;
  aiProviders: AIProvider[];
  testingProviderId: string | null;
  onAIProvidersChanged: () => void;
  onTriggerTour?: () => void;
  siteInfo?: any;
  onSiteInfoChanged?: (info: any) => void;

  // ── ComputerLabView ─────────────────────────────────────────────────
  computerLabs: any[];
  onRefresh: () => Promise<void>;

  // ── HelpView ────────────────────────────────────────────────────────
  registeredCommands: any[];
  fetchRegisteredCommands: () => void;

  // ── ClassesView ─────────────────────────────────────────────────────
  batchMode: boolean;
  selectedClassIds: Set<string>;
  setSelectedClassIds: Dispatch<SetStateAction<Set<string>>>;
  setSelectedStudentIds: Dispatch<SetStateAction<Set<string>>>;
  setBatchMode: Dispatch<SetStateAction<boolean>>;
  expandedClassId: string | null;
  setExpandedClassId: (id: string | null) => void;
  exportTooltipOpen: boolean;
  setExportTooltipOpen: Dispatch<SetStateAction<boolean>>;
  exportDropdownOpen: boolean;
  setExportDropdownOpen: Dispatch<SetStateAction<boolean>>;
  isExportingAllCombined: boolean;
  loadingExportClassId: string | null;
  classStudentsMap: Record<string, StudentType[]>;
  setClassStudentsMap: Dispatch<SetStateAction<Record<string, StudentType[]>>>;
  expandedStudentId: string | null;
  setExpandedStudentId: Dispatch<SetStateAction<string | null>>;
  selectedStudentIds: Set<string>;
  rosterViewMode: 'grid' | 'list';
  setRosterViewMode: Dispatch<SetStateAction<'grid' | 'list'>>;
  rosterSearchQuery: string;
  setRosterSearchQuery: Dispatch<SetStateAction<string>>;
  rosterTagFilter: 'all' | 'Academic' | 'Behavioral' | 'General' | 'SpecialCare';
  setRosterTagFilter: Dispatch<SetStateAction<'all' | 'Academic' | 'Behavioral' | 'General' | 'SpecialCare'>>;
  toggleSelectAllStudents: (list: StudentType[]) => void;
  handleBatchDeleteStudents: () => Promise<void>;
  handleBatchResetPassword: () => Promise<void>;
  handleBatchTransferStudents: () => void;
  handleBatchSetLockedLesson: () => void;
  toggleStudentSelection: (id: string) => void;
  get30DayAverageWarning: (studentId: string, classId: string) => number | null;
  studentProgressMap: Record<string, StudentProgressType[]>;
  studentActiveTabs: Record<string, 'progress' | 'settings' | 'notes'>;
  setStudentActiveTabs: Dispatch<SetStateAction<Record<string, 'progress' | 'settings' | 'notes'>>>;
  setStudents: (students: StudentType[]) => void;
  fetchClassStudents: (id: string) => Promise<void>;
  fetchStudents: () => Promise<void>;
  parseCSV: any;
  setImportError: Dispatch<SetStateAction<string | null>>;
  setImportSuccess: Dispatch<SetStateAction<string | null>>;
  setShowImportModal: Dispatch<SetStateAction<boolean>>;
  fetchClasses: () => Promise<void>;
  classSubmissionFilters: Record<string, 'all' | 'submitted' | 'graded' | 'pending'>;
  setClassSubmissionFilters: Dispatch<SetStateAction<Record<string, 'all' | 'submitted' | 'graded' | 'pending'>>>;
  classActiveTabs: Record<string, 'students' | 'assignments' | 'schedules' | 'seating' | 'grades'>;
  setClassActiveTabs: Dispatch<SetStateAction<Record<string, 'students' | 'assignments' | 'schedules' | 'seating' | 'grades'>>>;
  classProgressMap: Record<string, { lesson_id: string; lesson_title: string; average_progress: number }[]>;
  classSchedulesMap: Record<string, ScheduleType[]>;
  classDashboardMap: Record<string, any>;
  assignmentSortOrder: 'dueDate' | 'status' | 'avgScore';
  setAssignmentSortOrder: Dispatch<SetStateAction<'dueDate' | 'status' | 'avgScore'>>;
  isGeneratingPDFReport: Record<string, boolean>;
  handleGeneratePDFReport: (classId: string, className: string) => Promise<void>;
  setExportClassId: Dispatch<SetStateAction<string>>;
  setExportClassName: Dispatch<SetStateAction<string>>;
  setQuizzesWeight: Dispatch<SetStateAction<number>>;
  setAssignmentsWeight: Dispatch<SetStateAction<number>>;
  setCustomCategoryOverrides: Dispatch<SetStateAction<Record<string, 'quiz' | 'assignment'>>>;
  setIsExportWeightModalOpen: Dispatch<SetStateAction<boolean>>;
  isGeneratingAssignment: string | null;
  setQuizGeneratorClassId: Dispatch<SetStateAction<string | null>>;
  setQuizGenMode: Dispatch<SetStateAction<'scan_lesson' | 'topic'>>;
  setQuizGenSelectedLessonId: Dispatch<SetStateAction<string>>;
  setQuizGenTopic: Dispatch<SetStateAction<string>>;
  setSuggestedObjectives: Dispatch<SetStateAction<string[]>>;
  setSuggestedQuestions: Dispatch<SetStateAction<any[]>>;
  setIsQuizGeneratorOpen: Dispatch<SetStateAction<boolean>>;
  setActiveStudentId: Dispatch<SetStateAction<string | null>>;
  setSelectedAssignment: Dispatch<SetStateAction<any | null>>;
  setStudentViewStatus: Dispatch<SetStateAction<'dashboard' | 'lesson' | 'assignment'>>;
  isGrading: Record<string, boolean>;
  setIsGrading: Dispatch<SetStateAction<Record<string, boolean>>>;
  fetchClassDashboard: (id: string) => Promise<void>;
  newScheduleDate: string;
  setNewScheduleDate: Dispatch<SetStateAction<string>>;
  newScheduleLessonId: string;
  setNewScheduleLessonId: Dispatch<SetStateAction<string>>;
  expandedScheduleId: string | null;
  setExpandedScheduleId: Dispatch<SetStateAction<string | null>>;
  fetchScheduleAttendance: (id: string) => Promise<void>;
  scheduleAttendanceMap: Record<string, AttendanceType[]>;
  toggleSelectAllClasses: () => void;
  handleBatchDeleteClasses: () => Promise<void>;
  handleBatchExportClasses: () => Promise<void>;
  handleBatchSetPasscode: () => Promise<void>;
  handleBatchScheduleClasses: () => void;
  handleExportAllClassesCombined: (...args: any[]) => Promise<void>;
  triggerExportForClass: (classId: string, className: string) => Promise<void>;
  fetchClassProgress: (id: string) => Promise<void>;
  fetchClassSchedules: (id: string) => Promise<void>;
  fetchStudentProgress: (id: string) => Promise<void>;
  toggleClassSelection: (id: string) => void;

  // ── Extra identifiers referenced only by App's inline expressions ────
  socketRef: MutableRefObject<any>;
  setShowCoursewareHub: Dispatch<SetStateAction<boolean>>;
  fetchTodaySchedules: () => Promise<void>;
}

export function TeacherView(props: TeacherViewProps) {
  const {
    mainNavCollapsed,
    setMainNavCollapsed,
    teacherTab,
    setTeacherTab,
    lang,
    session,
    todaySchedules,
    socketRef,
    setShowCoursewareHub,
    selectedLesson,
    setSelectedLesson,
    classStudentsMap,
    lessons,
    classes,
    plugins,
    timelineSegments,
    activeSegmentId,
    setActiveSegmentId,
    liveClassSelectedClassId,
    setLiveClassSelectedClassId,
    liveClassIsActive,
    setLiveClassIsActive,
    liveClassTimeRemaining,
    setLiveClassTimeRemaining,
    liveClassFeed,
    setLiveClassFeed,
    liveClassAcknowledgedMap,
    setLiveClassAcknowledgedMap,
    elements,
    fetchElements,
    addToast,
    onlineStudentIds,
    activeStudentLessons,
    liveClassStudentProgress,
    fetchStudents,
    fetchClassStudents,
    activeRole,
    setActiveRole,
    onRefresh,
    computerLabs,
    fetchTodaySchedules,
    fetchRegisteredCommands,
    registeredCommands,
  } = props;

  return (
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
          <Dashboard {...props} />
        ) : teacherTab === 'lesson_editor' ? (
          <LessonEditorView {...props} />
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
                    message,
                  });
                }
              }}
              onOpenCoursewareHub={() => setShowCoursewareHub(true)}
              activeRole={activeRole}
              setActiveRole={setActiveRole}
            />
          </div>
        ) : teacherTab === 'plugins' ? (
          <PluginView {...props} />
        ) : teacherTab === 'courses' ? (
          <CourseManagement {...props} />
        ) : teacherTab === 'classes' ? (
          <ClassesView {...props} />
        ) : teacherTab === 'timetable' ? (
          <TimetableView classes={classes} lessons={lessons} lang={lang} onSchedulesUpdated={fetchTodaySchedules} />
        ) : teacherTab === 'admin_directory' ? (
          <AdminDirectoryView {...props} />
        ) : teacherTab === 'computer_labs' ? (
          <ComputerLabView computerLabs={computerLabs} onRefresh={onRefresh} lang={lang} />
        ) : teacherTab === 'help' ? (
          <HelpView registeredCommands={registeredCommands} onRefresh={fetchRegisteredCommands} />
        ) : null}
      </div>
    </div>
  );
}
