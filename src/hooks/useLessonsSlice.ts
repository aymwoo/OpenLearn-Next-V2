import { useState, useRef, useEffect, type MutableRefObject, type SetStateAction } from 'react';
import { useLessonFiltering } from './useLessonFiltering';
import { useLabAndSchedule } from './useLabAndSchedule';
import { useLessonCrud } from './useLessonCrud';
import { useClassOps } from './useClassOps';
import { useSystemData } from './useSystemData';
import { useResourceLibrary } from './useResourceLibrary';
import { useCourseWizard } from './useCourseWizard';
import { usePluginManagement } from './usePluginManagement';
import { useQuizGenerator } from './useQuizGenerator';
import { useClassBatchOperations } from './useClassBatchOperations';
import { useLessonTimeline } from './useLessonTimeline';
import { useGradeExport } from './useGradeExport';
import { useAppStore, appStore } from '../store/appStore';
import { getPaletteItemConfig } from '../features/teacher/lesson-editor/paletteConfig';
import type { ClassTabKey } from '../features/teacher/classes/ClassTabs';
import type { FrontendPluginHost } from '../plugin-host/plugin-host';
import type { SessionType } from '../types/app';

const AGENT_PROVIDER_STORAGE_KEY = 'openlearnv2.agentProviderId';

import type { useToast } from './useToast';

export interface LessonsSliceParams {
  lang: 'zh' | 'en';
  addToast: ReturnType<typeof useToast>['addToast'];
  host: FrontendPluginHost;
  session: SessionType | null;
  fetchStudents: () => Promise<void>;
  fetchClasses: () => Promise<void>;
  chatLogRef: MutableRefObject<(updater: any) => void>;
}

/**
 * 备课域切片（useAppComposer 按域拆分之二）：课程/班级/学生/成绩/插件
 * 管理与备课工具。
 *
 * 行为与拆分前 useAppComposer 内联实现逐行一致，仅做物理搬运。
 */
export function useLessonsSlice({ lang, addToast, host, session, fetchStudents, fetchClasses, chatLogRef }: LessonsSliceParams) {
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
  const setExpandedStudentId = (value: SetStateAction<string | null>) => {
    _setExpandedStudentId(value);
  };

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

  const siteInfo = useAppStore((s) => s.siteInfo);
  const setSiteInfo = useAppStore((s) => s.setSiteInfo);

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

  // ── Hook: 课程创建向导 (Course Wizard) ──
  const setTeacherTab = useAppStore((s) => s.setTeacherTab);
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
    setChatLog: (updater: any) => chatLogRef.current(updater),
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

  const [isGeneratingAssignment, setIsGeneratingAssignment] = useState<string | null>(null);
  const [assignmentSortOrder, setAssignmentSortOrder] = useState<'dueDate' | 'status' | 'avgScore'>('dueDate');
  const [isGrading, setIsGrading] = useState<Record<string, boolean>>({});

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

  const handleSeedSuccess = async (data: { classId: string; scheduleId: string; lessonId: string }) => {
    // 1. Refresh academic data
    await fetchClasses();
    await fetchLessons();
    await fetchTodaySchedules().catch(() => {});

    // 2. Select seeded course and trigger classroom
    appStore.getState().setLiveClassSelectedClassId(data.classId);
    setSelectedLesson(data.lessonId);
    appStore.getState().setLiveClassIsActive(true); // Active the class session directly

    addToast(
      lang === 'zh' ? '示范课堂准备就绪' : 'Demo Classroom Ready',
      lang === 'zh'
        ? '示范班级与课件已加载，已自动开启授课状态！'
        : 'Demo class & courseware loaded. Live class session is now active!',
      'success',
    );
  };

  return {
    lessons,
    setLessons,
    lessonFilteringData,
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
    selectedLesson,
    setSelectedLesson,
    elements,
    setElements,
    showRightSidebar,
    setShowRightSidebar,
    rightSidebarTab,
    setRightSidebarTab,
    classes,
    setClasses,
    students,
    setStudents,
    labAndScheduleData,
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
    lessonCrudData,
    fetchLessons,
    handleQuickCreateLesson,
    handleDeleteCourse,
    handleCopyCourse,
    fetchElements,
    classOpsData,
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
    expandedClassId,
    setExpandedClassId,
    expandedStudentId,
    setExpandedStudentId,
    whiteboardRef,
    paletteEdit,
    setPaletteEdit,
    handlePaletteActivate,
    handlePaletteConfirm,
    siteInfo,
    setSiteInfo,
    lessonTimelineData,
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
    systemData,
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
    resourceLibraryData,
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
    courseWizard,
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
    pluginManagementData,
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
    agentProviderId,
    setAgentProviderId,
    effectiveAgentProviderId,
    selectedAgentProvider,
    quizGenerator,
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
    isGeneratingAssignment,
    setIsGeneratingAssignment,
    assignmentSortOrder,
    setAssignmentSortOrder,
    isGrading,
    setIsGrading,
    gradeExport,
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
    classBatch,
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
    handleSeedSuccess,
  };
}

export type LessonsSlice = ReturnType<typeof useLessonsSlice>;
