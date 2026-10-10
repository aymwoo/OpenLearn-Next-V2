import { useRef } from 'react';
import { registerTeacherActivityCenter } from '../features/activity-ecosystem/registerTeacherExtension.js';

registerTeacherActivityCenter();
import { usePluginHost } from '../plugin-host/plugin-host-context';
import { generateTemplateContent } from '../features/teacher/HelpView';
import { useAppStore, appStore } from '../store/appStore';
import { translations } from '../i18n';
import { useToast } from './useToast';
import { useGlobalErrorCapture } from './useGlobalErrorCapture';
import { useSessionSlice } from './useSessionSlice';
import { useLessonsSlice } from './useLessonsSlice';
import { useClassroomSlice } from './useClassroomSlice';
import type { AppDataValue } from '../context/AppDataContext';

export function useAppComposer() {

  useGlobalErrorCapture();
  const lang = useAppStore((s) => s.lang);
  const t = translations[lang] ?? translations['zh'];

  // ── C1-R2c: 课程/班级 hooks ──────────────────────────────────────────────
  const { addToast } = useToast();
  const host = usePluginHost();

  const fetchStudents = async () => {
    await appStore.getState().loadStudents();
  };
  const fetchClasses = async () => {
    await appStore.getState().loadClasses();
  };

  const chatLogUpdaterRef = useRef<(updater: any) => void>(() => {});

  // ── 按域拆分的三切片（调用顺序与拆分前内联顺序一致） ─────────────────────
  // useSessionSlice: 会话/模式/路由/主题；useLessonsSlice: 备课域；
  // useClassroomSlice: 课堂实时域。
  const session = useSessionSlice({ lang, addToast, fetchStudents });
  const lessons = useLessonsSlice({
    lang,
    addToast,
    host,
    session: session.session,
    fetchStudents,
    fetchClasses,
    chatLogRef: chatLogUpdaterRef,
  });
  const classroom = useClassroomSlice({
    lang,
    t,
    addToast,
    host,
    session: session.session,
    activeStudentId: session.activeStudentId,
    activeRole: session.activeRole,
    setStudentViewStatus: session.setStudentViewStatus,
    studentViewStatus: session.studentViewStatus,
    studentLessonTab: session.studentLessonTab,
    setStudentLessonTab: session.setStudentLessonTab,
    setLiveClassFocusLocked: session.setLiveClassFocusLocked,
    isStudentLiveMode: session.isStudentLiveMode,
    isFollowingTeacher: session.isFollowingTeacher,
    liveStudentParam: session.liveStudentParam,
    fetchStudents,
    fetchLessons: lessons.fetchLessons,
    fetchElements: lessons.fetchElements,
    fetchClasses,
    fetchClassStudents: lessons.fetchClassStudents,
    fetchClassProgress: lessons.fetchClassProgress,
    fetchClassDashboard: lessons.fetchClassDashboard,
    fetchLiveClassStudentProgress: lessons.fetchLiveClassStudentProgress,
    setLiveClassStudentProgress: lessons.setLiveClassStudentProgress,
    fetchRegisteredCommands: lessons.fetchRegisteredCommands,
    fetchVfs: lessons.fetchVfs,
    fetchProcesses: lessons.fetchProcesses,
    fetchProcessLogs: lessons.fetchProcessLogs,
    fetchTodaySchedules: lessons.fetchTodaySchedules,
    fetchLabs: lessons.fetchLabs,
    fetchPlugins: lessons.fetchPlugins,
    fetchEvents: lessons.fetchEvents,
    fetchApprovals: lessons.fetchApprovals,
    showProcessLogs: lessons.showProcessLogs,
    currentVfsParent: lessons.currentVfsParent,
    expandedClassId: lessons.expandedClassId,
    activeSegmentId: lessons.activeSegmentId,
    setActiveSegmentId: lessons.setActiveSegmentId,
    quizStudentAnswersRef: lessons.quizStudentAnswersRef,
    effectiveAgentProviderId: lessons.effectiveAgentProviderId,
    plugins: lessons.plugins,
  });

  chatLogUpdaterRef.current = classroom.setChatLog;

  const setSelectedLesson = useAppStore((s) => s.setSelectedLesson);
  const setTeacherTab = useAppStore((s) => s.setTeacherTab);

  // ── C1-R3: AppData 组装（全部 hooks 返回值 + App 局部值） ─────────────────
  // value 为每渲染新对象：全库仅 LoginPage 使用 React.memo，各 tab 本就随 App
  // 渲染而重渲染，context 传递不劣于现状；未来引入 memo 时再按领域拆分 context。
  const appData: AppDataValue = {
    addToast,
    ...lessons.systemData,
    ...lessons.resourceLibraryData,
    ...lessons.lessonCrudData,
    ...lessons.classOpsData,
    ...session.studentViewStateData,
    ...classroom.studentOpsData,
    ...session.sessionBootstrapData,
    ...classroom.classroomLiveData,
    ...lessons.labAndScheduleData,
    ...lessons.pluginManagementData,
    ...classroom.agentChatData,
    ...lessons.quizGenerator,
    ...lessons.courseWizard,
    ...lessons.classBatch,
    ...lessons.lessonTimelineData,
    ...classroom.studentNotificationsHook,
    ...lessons.gradeExport,
    ...lessons.lessonFilteringData,
    mainNavCollapsed: session.mainNavCollapsed,
    setMainNavCollapsed: session.setMainNavCollapsed,
    batchMode: lessons.batchMode,
    setBatchMode: lessons.setBatchMode,
    selectedClassIds: lessons.selectedClassIds,
    setSelectedClassIds: lessons.setSelectedClassIds,
    setSelectedStudentIds: lessons.setSelectedStudentIds,
    expandedClassId: lessons.expandedClassId,
    setExpandedClassId: lessons.setExpandedClassId,
    exportTooltipOpen: lessons.exportTooltipOpen,
    setExportTooltipOpen: lessons.setExportTooltipOpen,
    exportDropdownOpen: lessons.exportDropdownOpen,
    setExportDropdownOpen: lessons.setExportDropdownOpen,
    expandedStudentId: lessons.expandedStudentId,
    setExpandedStudentId: lessons.setExpandedStudentId,
    selectedStudentIds: lessons.selectedStudentIds,
    rosterViewMode: classroom.rosterViewMode,
    setRosterViewMode: classroom.setRosterViewMode,
    rosterSearchQuery: classroom.rosterSearchQuery,
    setRosterSearchQuery: classroom.setRosterSearchQuery,
    rosterTagFilter: classroom.rosterTagFilter,
    setRosterTagFilter: classroom.setRosterTagFilter,
    classSubmissionFilters: classroom.classSubmissionFilters,
    setClassSubmissionFilters: classroom.setClassSubmissionFilters,
    classActiveTabs: classroom.classActiveTabs,
    setClassActiveTabs: classroom.setClassActiveTabs,
    assignmentSortOrder: lessons.assignmentSortOrder,
    setAssignmentSortOrder: lessons.setAssignmentSortOrder,
    isGeneratingAssignment: lessons.isGeneratingAssignment,
    isGrading: lessons.isGrading,
    setIsGrading: lessons.setIsGrading,
    setStudents: lessons.setStudents,
    setImportError: lessons.setImportError,
    setImportSuccess: lessons.setImportSuccess,
    setShowImportModal: lessons.setShowImportModal,
    studentActiveTabs: classroom.studentActiveTabs,
    setStudentActiveTabs: classroom.setStudentActiveTabs,
    fetchStudents,
    onLogout: session.handleLogout,
    onAIProvidersChanged: lessons.fetchAIProviders,
    onDeleteCourse: lessons.handleDeleteCourse,
    onCopyCourse: lessons.handleCopyCourse,
    socketRef: classroom.socketRef,
    liveClassSelectedClassId: classroom.liveClassSelectedClassId,
    setLiveClassSelectedClassId: classroom.setLiveClassSelectedClassId,
    liveClassIsActive: classroom.liveClassIsActive,
    setLiveClassIsActive: classroom.setLiveClassIsActive,
    setSelectedLesson,
    setTeacherTab,
    teacherTab: session.teacherTab,
    onViewCourse: (lessonId: string) => {
      setTeacherTab('lesson_editor');
      setSelectedLesson(lessonId);
    },
    t,
    readNotifications: classroom.readNotifications,
    setReadNotifications: classroom.setReadNotifications,
    localProgressPercent: classroom.localProgressPercent,
    setLocalProgressPercent: classroom.setLocalProgressPercent,
    lessons: lessons.lessons,
    selectedLesson: lessons.selectedLesson,
    elements: lessons.elements,
    classes: lessons.classes,
    students: lessons.students,
    isApprovalsCollapsed: session.isApprovalsCollapsed,
    setIsApprovalsCollapsed: session.setIsApprovalsCollapsed,
    isProcessesCollapsed: session.isProcessesCollapsed,
    setIsProcessesCollapsed: session.setIsProcessesCollapsed,
    whiteboardRef: lessons.whiteboardRef,
    paletteEdit: lessons.paletteEdit,
    handlePaletteActivate: lessons.handlePaletteActivate,
    handlePaletteConfirm: lessons.handlePaletteConfirm,
    setPaletteEdit: lessons.setPaletteEdit,
    session: session.session,
    showRightSidebar: lessons.showRightSidebar,
    setShowRightSidebar: lessons.setShowRightSidebar,
    rightSidebarTab: lessons.rightSidebarTab,
    setRightSidebarTab: lessons.setRightSidebarTab,
    agentProviderId: lessons.agentProviderId,
    setAgentProviderId: lessons.setAgentProviderId,
    effectiveAgentProviderId: lessons.effectiveAgentProviderId,
    selectedAgentProvider: lessons.selectedAgentProvider,
    isTourOpen: session.isTourOpen,
    setIsTourOpen: session.setIsTourOpen,
    handleSeedSuccess: lessons.handleSeedSuccess,
    generateTemplateContent,
    activeRole: session.activeRole,
    setActiveRole: session.setActiveRole,
    isStudentPreviewMode: session.isStudentPreviewMode,
    isNotificationsOpen: classroom.isNotificationsOpen,
    setIsNotificationsOpen: classroom.setIsNotificationsOpen,
    selectedNotificationForModal: classroom.selectedNotificationForModal,
    setSelectedNotificationForModal: classroom.setSelectedNotificationForModal,
    setProfileOpen: session.setProfileOpen,
    notifyLockedNavigation: session.notifyLockedNavigation,
    handleLogout: session.handleLogout,
    toggleLanguage: session.toggleLanguage,
    setIsSystemResourceLibraryOpen: lessons.setIsSystemResourceLibraryOpen,
    siteInfo: lessons.siteInfo,
    isStudentLiveMode: session.isStudentLiveMode,
    liveStudentParam: session.liveStudentParam,
    isFollowingTeacher: session.isFollowingTeacher,
    setIsFollowingTeacher: session.setIsFollowingTeacher,
  };


  return {
    appData,
    sessionLoading: session.sessionLoading,
    session: session.session,
    setSession: session.setSession,
    handleLoginSuccess: session.handleLoginSuccess,
    handleLogout: session.handleLogout,
    isStageDisplayMode: session.isStageDisplayMode,
    stageLessonParam: session.stageLessonParam,
    stageTitleParam: session.stageTitleParam,
    stageLangParam: session.stageLangParam,
    activeRole: session.activeRole,
    selectedLesson: lessons.selectedLesson,
    lessons: lessons.lessons,
    profileOpen: session.profileOpen,
    setProfileOpen: session.setProfileOpen,
    lang,
  };
}
