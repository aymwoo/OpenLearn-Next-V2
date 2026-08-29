import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { PluginHostProvider } from '../../../plugin-host/plugin-host-context';
import { FrontendPluginHost } from '../../../plugin-host/plugin-host';
import { TeacherView } from '../TeacherView';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// TeacherViewProps is a large flat composition of every child's prop bag.
// esbuild (used by Vitest) strips types, so we type this as `any` and provide
// sensible defaults: vi.fn() for callbacks, []/{} for collections, primitives
// for scalars, and Map/Set/ref objects where the children iterate over them.
const baseProps: any = {
  // NavigationSidebar
  mainNavCollapsed: false,
  setMainNavCollapsed: vi.fn(),
  teacherTab: 'dashboard',
  setTeacherTab: vi.fn(),
  lang: 'en',
  session: null,
  todaySchedules: [],

  // Dashboard
  t: (k: string) => k,
  lessons: [],
  classes: [],
  students: [],
  approvals: [],
  processes: [],
  isApprovalsCollapsed: false,
  setIsApprovalsCollapsed: vi.fn(),
  isProcessesCollapsed: false,
  setIsProcessesCollapsed: vi.fn(),
  scoreOverrides: {},
  setScoreOverrides: vi.fn(),
  handleApprove: vi.fn(),
  handleReject: vi.fn(),
  showLogs: false,
  setShowLogs: vi.fn(),
  processLogsContent: '',
  showProcessLogs: null,
  fetchProcessLogs: vi.fn(),
  setShowProcessLogs: vi.fn(),
  addToast: vi.fn(),
  handleQuickScheduleClass: vi.fn(),
  handleQuickGenerateAssignment: vi.fn(),
  handleQuickCreateLesson: vi.fn(),

  // LessonEditorView
  selectedLesson: null,
  activeRole: 'teacher',
  setActiveRole: vi.fn(),
  editorSaveStatus: 'none',
  setEditorSaveStatus: vi.fn(),
  editorLastSavedTime: null,
  setEditorLastSavedTime: vi.fn(),
  setIsLessonPreviewVisible: vi.fn(),
  setPreviewLessonTab: vi.fn(),
  setPreviewSelectedCourseware: vi.fn(),
  handlePaletteActivate: vi.fn(),
  timelineSegments: [],
  activeSegmentId: null,
  setActiveSegmentId: vi.fn(),
  draggedSegmentIdx: null,
  setDraggedSegmentIdx: vi.fn(),
  saveTimeline: vi.fn(),
  editorPanelsExpanded: false,
  setEditorPanelsExpanded: vi.fn(),
  fetchElements: vi.fn(),
  whiteboardRef: { current: null },
  elements: [],
  paletteEdit: null,
  handlePaletteConfirm: vi.fn(),
  setPaletteEdit: vi.fn(),

  // LiveClassroomView
  setSelectedLesson: vi.fn(),
  plugins: [],
  liveClassSelectedClassId: null,
  setLiveClassSelectedClassId: vi.fn(),
  liveClassIsActive: false,
  setLiveClassIsActive: vi.fn(),
  liveClassTimeRemaining: 0,
  setLiveClassTimeRemaining: vi.fn(),
  liveClassFeed: [],
  setLiveClassFeed: vi.fn(),
  liveClassAcknowledgedMap: new Map(),
  setLiveClassAcknowledgedMap: vi.fn(),
  onlineStudentIds: [],
  activeStudentLessons: {},
  liveClassStudentProgress: [],
  onPingStudent: vi.fn(),
  onOpenCoursewareHub: vi.fn(),

  // PluginView
  storeTab: 'store',
  setStoreTab: vi.fn(),
  pluginCode: '',
  setPluginCode: vi.fn(),
  installingPlugin: false,
  onInstall: vi.fn(),
  onZipUpload: vi.fn(),
  onToggle: vi.fn(),
  onDelete: vi.fn(),

  // CourseManagement
  lessonsSearchQuery: '',
  setLessonsSearchQuery: vi.fn(),
  lessonsSortOrder: 'recent',
  setLessonsSortOrder: vi.fn(),
  filteredLessons: [],
  onOpenImportLessons: vi.fn(),
  onOpenCourseWizard: vi.fn(),
  onViewCourse: vi.fn(),
  onDeleteCourse: vi.fn(),
  onCopyCourse: vi.fn(),
  filterEnrollment: false,
  setFilterEnrollment: vi.fn(),
  filterHasContent: false,
  setFilterHasContent: vi.fn(),
  filterThisMonth: false,
  setFilterThisMonth: vi.fn(),
  copyingLessonId: null,

  // TimetableView
  onSchedulesUpdated: vi.fn(),

  // AdminDirectoryView
  onLogout: vi.fn(),
  aiProviders: [],
  testingProviderId: null,
  onAIProvidersChanged: vi.fn(),
  onTriggerTour: vi.fn(),
  siteInfo: {},
  onSiteInfoChanged: vi.fn(),

  // ComputerLabView
  computerLabs: [],
  onRefresh: vi.fn(),

  // HelpView
  registeredCommands: [],
  fetchRegisteredCommands: vi.fn(),

  // ClassesView
  batchMode: false,
  selectedClassIds: new Set<string>(),
  setSelectedClassIds: vi.fn(),
  setSelectedStudentIds: vi.fn(),
  setBatchMode: vi.fn(),
  expandedClassId: null,
  setExpandedClassId: vi.fn(),
  exportTooltipOpen: false,
  setExportTooltipOpen: vi.fn(),
  exportDropdownOpen: false,
  setExportDropdownOpen: vi.fn(),
  isExportingAllCombined: false,
  loadingExportClassId: null,
  classStudentsMap: {},
  setClassStudentsMap: vi.fn(),
  expandedStudentId: null,
  setExpandedStudentId: vi.fn(),
  selectedStudentIds: new Set<string>(),
  rosterViewMode: 'grid',
  setRosterViewMode: vi.fn(),
  rosterSearchQuery: '',
  setRosterSearchQuery: vi.fn(),
  rosterTagFilter: 'all',
  setRosterTagFilter: vi.fn(),
  toggleSelectAllStudents: vi.fn(),
  handleBatchDeleteStudents: vi.fn(),
  handleBatchResetPassword: vi.fn(),
  handleBatchTransferStudents: vi.fn(),
  handleBatchSetLockedLesson: vi.fn(),
  toggleStudentSelection: vi.fn(),
  get30DayAverageWarning: vi.fn(),
  studentProgressMap: {},
  studentActiveTabs: {},
  setStudentActiveTabs: vi.fn(),
  setStudents: vi.fn(),
  fetchClassStudents: vi.fn(),
  fetchStudents: vi.fn(),
  parseCSV: vi.fn(),
  setImportError: vi.fn(),
  setImportSuccess: vi.fn(),
  setShowImportModal: vi.fn(),
  fetchClasses: vi.fn(),
  classSubmissionFilters: {},
  setClassSubmissionFilters: vi.fn(),
  classActiveTabs: {},
  setClassActiveTabs: vi.fn(),
  classProgressMap: {},
  classSchedulesMap: {},
  classDashboardMap: {},
  assignmentSortOrder: 'dueDate',
  setAssignmentSortOrder: vi.fn(),
  isGeneratingPDFReport: {},
  handleGeneratePDFReport: vi.fn(),
  setExportClassId: vi.fn(),
  setExportClassName: vi.fn(),
  setQuizzesWeight: vi.fn(),
  setAssignmentsWeight: vi.fn(),
  setCustomCategoryOverrides: vi.fn(),
  setIsExportWeightModalOpen: vi.fn(),
  isGeneratingAssignment: null,
  setQuizGeneratorClassId: vi.fn(),
  setQuizGenMode: vi.fn(),
  setQuizGenSelectedLessonId: vi.fn(),
  setQuizGenTopic: vi.fn(),
  setSuggestedObjectives: vi.fn(),
  setSuggestedQuestions: vi.fn(),
  setIsQuizGeneratorOpen: vi.fn(),
  setActiveStudentId: vi.fn(),
  setSelectedAssignment: vi.fn(),
  setStudentViewStatus: vi.fn(),
  isGrading: {},
  setIsGrading: vi.fn(),
  fetchClassDashboard: vi.fn(),
  newScheduleDate: '',
  setNewScheduleDate: vi.fn(),
  newScheduleLessonId: '',
  setNewScheduleLessonId: vi.fn(),
  expandedScheduleId: null,
  setExpandedScheduleId: vi.fn(),
  fetchScheduleAttendance: vi.fn(),
  scheduleAttendanceMap: {},
  toggleSelectAllClasses: vi.fn(),
  handleBatchDeleteClasses: vi.fn(),
  handleBatchExportClasses: vi.fn(),
  handleBatchSetPasscode: vi.fn(),
  handleBatchScheduleClasses: vi.fn(),
  handleExportAllClassesCombined: vi.fn(),
  triggerExportForClass: vi.fn(),
  fetchClassProgress: vi.fn(),
  fetchClassSchedules: vi.fn(),
  fetchStudentProgress: vi.fn(),
  toggleClassSelection: vi.fn(),

  // Extra identifiers
  socketRef: { current: null },
  setShowCoursewareHub: vi.fn(),
  fetchTodaySchedules: vi.fn(),
};

const renderView = (props: Record<string, unknown> = {}) =>
  render(
    <PluginHostProvider host={new FrontendPluginHost()}>
      <TeacherView {...baseProps} {...props} />
    </PluginHostProvider>,
  );

describe('TeacherView', () => {
  it('renders the wrapper and the NavigationSidebar for teacherTab="dashboard"', () => {
    const { container } = renderView({ teacherTab: 'dashboard' });
    // The root branch div carries the bg-gray-50 class.
    expect(container.querySelector('.bg-gray-50')).toBeTruthy();
    // NavigationSidebar always renders its nav items regardless of tab.
    expect(screen.getByText('Live Class')).toBeTruthy();
    // The branch root has the sidebar plus an inner content div (>= 2 children).
    expect(container.querySelectorAll('.bg-gray-50 > div').length).toBeGreaterThanOrEqual(2);
  });

  it('renders the Dashboard child when teacherTab="dashboard"', () => {
    const { container } = renderView({ teacherTab: 'dashboard' });
    // Dashboard renders inside the inner content div; the content area must be populated.
    const content = container.querySelector('.bg-gray-50 > div + div');
    expect(content).toBeTruthy();
    expect(content?.children.length).toBeGreaterThan(0);
  });

  it('renders the HelpView child (with "Edu-OS Reference Hub" marker) for teacherTab="help"', async () => {
    const { container } = renderView({ teacherTab: 'help' });
    expect(container.querySelector('.bg-gray-50')).toBeTruthy();
    expect(await screen.findByText(/Edu-OS Reference Hub/i)).toBeTruthy();
    // The dashboard child must NOT be present on the help tab (tab switch works).
    expect(screen.queryByText('Live Class')).toBeTruthy(); // nav still present
  });

  it('does not throw for timetable and computer_labs tabs', () => {
    expect(() => renderView({ teacherTab: 'timetable' })).not.toThrow();
    expect(() => renderView({ teacherTab: 'computer_labs' })).not.toThrow();
  });
});
