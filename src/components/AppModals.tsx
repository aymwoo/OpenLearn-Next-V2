import React, { Dispatch, SetStateAction } from 'react';
import type { Lesson, ClassType, VFSNode, WhiteboardElement } from '../types/app';
import { ImportModal } from '../features/modals/ImportModal';
import { CourseWizardModal, WizardSegment } from '../features/modals/CourseWizardModal';
import { ImportLessonsModal, ImportRow, ImportStatus } from '../features/modals/ImportLessonsModal';
import { QuizGeneratorModal } from '../features/modals/QuizGeneratorModal';
import { StudentPreviewModal } from '../features/modals/StudentPreviewModal';
import { ProcessLogsModal } from '../features/modals/ProcessLogsModal';
import { CloudDriveModal } from '../features/modals/CloudDriveModal';
import { SystemResourceLibraryModal } from '../features/modals/SystemResourceLibraryModal';
import { BatchPickerModal } from '../features/modals/BatchPickerModal';
import { ExportWeightModal } from '../features/modals/ExportWeightModal';
import { NotificationDetailModal } from '../features/modals/NotificationDetailModal';
import { HelpTour } from './HelpTour';
import { CoursewareHubPanel } from '../features/teacher/CoursewareHubPanel';

export interface AppModalsProps {
  lang: 'zh' | 'en';
  t: any;

  // Import Modal
  showImportModal: boolean;
  setShowImportModal: (v: boolean) => void;
  handleImportFile: (file: File) => Promise<void> | void;
  importError: string | null;
  importSuccess: string | null;
  isImporting: boolean;
  downloadCSVTemplate: (type: 'class' | 'student') => void;

  // Course Wizard
  isCourseWizardOpen: boolean;
  setIsCourseWizardOpen: (v: boolean) => void;
  wizardStep: number;
  setWizardStep: Dispatch<SetStateAction<number>>;
  wizardIsSubmitting: boolean;
  wizardCourseTitle: string;
  setWizardCourseTitle: (v: string) => void;
  wizardCourseDescription: string;
  setWizardCourseDescription: (v: string) => void;
  wizardCourseCategory: string;
  setWizardCourseCategory: (v: string) => void;
  wizardCourseTimeline: WizardSegment[];
  setWizardCourseTimeline: Dispatch<SetStateAction<WizardSegment[]>>;
  wizardCourseContent: string;
  setWizardCourseContent: (v: string) => void;
  addToast: (title: string, message: string, type: 'info' | 'success' | 'warning' | 'error') => void;
  generateTemplateContent: (title: string, category: string) => string;
  handleDeployWizardCourse: () => void;

  // Import Lessons Modal
  isImportLessonsOpen: boolean;
  setIsImportLessonsOpen: (v: boolean) => void;
  importStatus: ImportStatus;
  setIsDraggingImport: (v: boolean) => void;
  handleCSVFileChange: (file: File) => void;
  downloadCsvTemplate: () => void;
  isDraggingImport: boolean;
  previewImportData: ImportRow[];
  setPreviewImportData: Dispatch<SetStateAction<ImportRow[]>>;
  setImportStatus: Dispatch<SetStateAction<ImportStatus>>;
  importProgress: number;
  importProgressTotal: number;
  importErrorMsg: string;
  setImportErrorMsg: Dispatch<SetStateAction<string>>;
  handleCSVImportSubmit: () => void;

  // Quiz Generator Modal
  isQuizGeneratorOpen: boolean;
  setIsQuizGeneratorOpen: (v: boolean) => void;
  lessons: Lesson[];
  quizGenMode: 'scan_lesson' | 'topic';
  setQuizGenMode: Dispatch<SetStateAction<'scan_lesson' | 'topic'>>;
  quizGenSelectedLessonId: string;
  setQuizGenSelectedLessonId: Dispatch<SetStateAction<string>>;
  quizGenTopic: string;
  setQuizGenTopic: Dispatch<SetStateAction<string>>;
  isGeneratingSuggestions: boolean;
  setIsGeneratingSuggestions: Dispatch<SetStateAction<boolean>>;
  suggestedObjectives: string[];
  setSuggestedObjectives: Dispatch<SetStateAction<string[]>>;
  suggestedQuestions: any[];
  setSuggestedQuestions: Dispatch<SetStateAction<any[]>>;
  quizGenTimeLimit: number;
  setQuizGenTimeLimit: Dispatch<SetStateAction<number>>;
  savingQuiz: boolean;
  setSavingQuiz: Dispatch<SetStateAction<boolean>>;
  quizGeneratorClassId: string | null;
  fetchClassDashboard: (classId: string) => void;

  // Student Preview Modal
  isLessonPreviewVisible: boolean;
  setIsLessonPreviewVisible: Dispatch<SetStateAction<boolean>>;
  selectedLesson: string | null;
  previewFullscreenPanel: 'none' | 'left' | 'right';
  setPreviewFullscreenPanel: Dispatch<SetStateAction<'none' | 'left' | 'right'>>;
  previewLessonTab: 'whiteboard' | 'courseware';
  setPreviewLessonTab: Dispatch<SetStateAction<'whiteboard' | 'courseware'>>;
  activeRole: 'teacher' | 'student';
  elements: WhiteboardElement[];
  activeSegmentId: string | null;
  setActiveSegmentId: Dispatch<SetStateAction<string | null>>;
  fetchElements: (lessonId: string) => void;
  currentVfsParent: string | null;
  setCurrentVfsParent: (id: string | null) => void;
  vfsNodes: VFSNode[];
  previewSelectedCourseware: string | null;
  setPreviewSelectedCourseware: Dispatch<SetStateAction<string | null>>;

  // Process Logs Modal
  showProcessLogs: string | null;
  setShowProcessLogs: (v: string | null) => void;
  processLogsContent: string;

  // Cloud Drive Modal
  isCloudDriveOpen: boolean;
  setIsCloudDriveOpen: (v: boolean) => void;
  cloudDrivePreviewNode: any | null;
  setCloudDrivePreviewNode: Dispatch<SetStateAction<any | null>>;

  // System Resource Library Modal
  isSystemResourceLibraryOpen: boolean;
  setIsSystemResourceLibraryOpen: (v: boolean) => void;
  systemResourceTab: 'system' | 'cloud';
  setSystemResourceTab: Dispatch<SetStateAction<'system' | 'cloud'>>;
  selectedLibraryResourceId: string | null;
  setSelectedLibraryResourceId: Dispatch<SetStateAction<string | null>>;
  loadingLibraryResources: boolean;
  libraryResources: any[];
  fetchLibraryResources: () => void;

  // Batch Picker Modal
  batchPicker: 'schedule' | 'lock' | 'transfer' | null;
  setBatchPicker: (v: 'schedule' | 'lock' | 'transfer' | null) => void;
  batchPickerLesson: string;
  setBatchPickerLesson: (v: string) => void;
  batchPickerDate: string;
  setBatchPickerDate: (v: string) => void;
  batchPickerTargetClass: string;
  setBatchPickerTargetClass: (v: string) => void;
  classes: ClassType[];
  expandedClassId: string | null;
  confirmBatchPicker: () => void;

  // Export Weight Modal
  isExportWeightModalOpen: boolean;
  setIsExportWeightModalOpen: Dispatch<SetStateAction<boolean>>;
  quizzesWeight: number;
  setQuizzesWeight: Dispatch<SetStateAction<number>>;
  assignmentsWeight: number;
  setAssignmentsWeight: Dispatch<SetStateAction<number>>;
  handleQuizzesWeightChange: (val: number) => void;
  handleAssignmentsWeightChange: (val: number) => void;
  customCategoryOverrides: Record<string, 'quiz' | 'assignment'>;
  setCustomCategoryOverrides: Dispatch<SetStateAction<Record<string, 'quiz' | 'assignment'>>>;
  classDashboardMap: Record<string, any>;
  exportClassId: string;
  exportClassName: string;
  csvPreviewData: any | null;
  handleExportGrades: (
    classId: string,
    className: string,
    qWeight?: number,
    aWeight?: number,
    overrides?: Record<string, 'quiz' | 'assignment'>,
  ) => void;

  // Notification Detail Modal
  selectedNotificationForModal: any | null;
  setSelectedNotificationForModal: (v: any | null) => void;
  setSelectedAssignment: (v: any) => void;
  setStudentViewStatus: (v: any) => void;
  setQuizStudentAnswers: (v: any) => void;
  setSubAssignmentTab: (v: any) => void;

  // Help Tour & Courseware Hub
  isTourOpen: boolean;
  setIsTourOpen: (v: boolean) => void;
  handleSeedSuccess: () => void;
  setTeacherTab: (v: string) => void;
  showCoursewareHub: boolean;
  setShowCoursewareHub: (v: boolean) => void;
}

export function AppModals(props: AppModalsProps) {
  const {
    lang,
    t,
    showImportModal,
    setShowImportModal,
    handleImportFile,
    importError,
    importSuccess,
    isImporting,
    downloadCSVTemplate,
    isCourseWizardOpen,
    setIsCourseWizardOpen,
    wizardStep,
    setWizardStep,
    wizardIsSubmitting,
    wizardCourseTitle,
    setWizardCourseTitle,
    wizardCourseDescription,
    setWizardCourseDescription,
    wizardCourseCategory,
    setWizardCourseCategory,
    wizardCourseTimeline,
    setWizardCourseTimeline,
    wizardCourseContent,
    setWizardCourseContent,
    addToast,
    generateTemplateContent,
    handleDeployWizardCourse,
    isImportLessonsOpen,
    setIsImportLessonsOpen,
    importStatus,
    setIsDraggingImport,
    handleCSVFileChange,
    downloadCsvTemplate,
    isDraggingImport,
    previewImportData,
    setPreviewImportData,
    setImportStatus,
    importProgress,
    importProgressTotal,
    importErrorMsg,
    setImportErrorMsg,
    handleCSVImportSubmit,
    isQuizGeneratorOpen,
    setIsQuizGeneratorOpen,
    lessons,
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
    quizGenTimeLimit,
    setQuizGenTimeLimit,
    savingQuiz,
    setSavingQuiz,
    quizGeneratorClassId,
    fetchClassDashboard,
    isLessonPreviewVisible,
    setIsLessonPreviewVisible,
    selectedLesson,
    previewFullscreenPanel,
    setPreviewFullscreenPanel,
    previewLessonTab,
    setPreviewLessonTab,
    activeRole,
    elements,
    activeSegmentId,
    setActiveSegmentId,
    fetchElements,
    currentVfsParent,
    setCurrentVfsParent,
    vfsNodes,
    previewSelectedCourseware,
    setPreviewSelectedCourseware,
    showProcessLogs,
    setShowProcessLogs,
    processLogsContent,
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
    loadingLibraryResources,
    libraryResources,
    fetchLibraryResources,
    batchPicker,
    setBatchPicker,
    batchPickerLesson,
    setBatchPickerLesson,
    batchPickerDate,
    setBatchPickerDate,
    batchPickerTargetClass,
    setBatchPickerTargetClass,
    classes,
    expandedClassId,
    confirmBatchPicker,
    isExportWeightModalOpen,
    setIsExportWeightModalOpen,
    quizzesWeight,
    setQuizzesWeight,
    assignmentsWeight,
    setAssignmentsWeight,
    handleQuizzesWeightChange,
    handleAssignmentsWeightChange,
    customCategoryOverrides,
    setCustomCategoryOverrides,
    classDashboardMap,
    exportClassId,
    exportClassName,
    csvPreviewData,
    handleExportGrades,
    selectedNotificationForModal,
    setSelectedNotificationForModal,
    setSelectedAssignment,
    setStudentViewStatus,
    setQuizStudentAnswers,
    setSubAssignmentTab,
    isTourOpen,
    setIsTourOpen,
    handleSeedSuccess,
    setTeacherTab,
    showCoursewareHub,
    setShowCoursewareHub,
  } = props;

  return (
    <>
      <ImportModal
        show={showImportModal}
        onClose={() => setShowImportModal(false)}
        lang={lang}
        handleImportFile={handleImportFile}
        importError={importError}
        importSuccess={importSuccess}
        isImporting={isImporting}
        downloadCSVTemplate={downloadCSVTemplate}
      />

      <CourseWizardModal
        isCourseWizardOpen={isCourseWizardOpen}
        setIsCourseWizardOpen={setIsCourseWizardOpen}
        lang={lang}
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
      />

      <ImportLessonsModal
        isImportLessonsOpen={isImportLessonsOpen}
        setIsImportLessonsOpen={setIsImportLessonsOpen}
        lang={lang}
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
      />

      <QuizGeneratorModal
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
      />

      <StudentPreviewModal
        isLessonPreviewVisible={isLessonPreviewVisible}
        setIsLessonPreviewVisible={setIsLessonPreviewVisible}
        lessons={lessons}
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
      />

      <ProcessLogsModal
        showProcessLogs={showProcessLogs}
        setShowProcessLogs={setShowProcessLogs}
        processLogsContent={processLogsContent}
        t={t}
      />

      <CloudDriveModal
        isOpen={isCloudDriveOpen}
        onClose={() => setIsCloudDriveOpen(false)}
        vfsNodes={vfsNodes}
        currentVfsParent={currentVfsParent}
        setCurrentVfsParent={setCurrentVfsParent}
        cloudDrivePreviewNode={cloudDrivePreviewNode}
        setCloudDrivePreviewNode={setCloudDrivePreviewNode}
      />

      <SystemResourceLibraryModal
        isSystemResourceLibraryOpen={isSystemResourceLibraryOpen}
        setIsSystemResourceLibraryOpen={setIsSystemResourceLibraryOpen}
        lang={lang}
        systemResourceTab={systemResourceTab}
        setSystemResourceTab={setSystemResourceTab}
        selectedLibraryResourceId={selectedLibraryResourceId}
        setSelectedLibraryResourceId={setSelectedLibraryResourceId}
        vfsNodes={vfsNodes}
        currentVfsParent={currentVfsParent}
        setCurrentVfsParent={setCurrentVfsParent}
        cloudDrivePreviewNode={cloudDrivePreviewNode}
        setCloudDrivePreviewNode={setCloudDrivePreviewNode}
        loadingLibraryResources={loadingLibraryResources}
        libraryResources={libraryResources}
        fetchLibraryResources={fetchLibraryResources}
      />

      <BatchPickerModal
        batchPicker={batchPicker}
        setBatchPicker={setBatchPicker}
        batchPickerLesson={batchPickerLesson}
        setBatchPickerLesson={setBatchPickerLesson}
        batchPickerDate={batchPickerDate}
        setBatchPickerDate={setBatchPickerDate}
        batchPickerTargetClass={batchPickerTargetClass}
        setBatchPickerTargetClass={setBatchPickerTargetClass}
        lessons={lessons}
        classes={classes}
        expandedClassId={expandedClassId}
        confirmBatchPicker={confirmBatchPicker}
        lang={lang}
      />

      <ExportWeightModal
        isExportWeightModalOpen={isExportWeightModalOpen}
        setIsExportWeightModalOpen={setIsExportWeightModalOpen}
        lang={lang}
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
      />

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

      <HelpTour
        isOpen={isTourOpen}
        onClose={() => setIsTourOpen(false)}
        lang={lang as 'zh' | 'en'}
        onSeedSuccess={handleSeedSuccess}
        onJumpTab={(tab) => setTeacherTab(tab)}
      />

      {showCoursewareHub && (
        <CoursewareHubPanel
          onClose={() => setShowCoursewareHub(false)}
          lang={lang}
        />
      )}
    </>
  );
}
