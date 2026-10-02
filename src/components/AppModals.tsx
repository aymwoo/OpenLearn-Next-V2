import React, { lazy, Suspense } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { Lesson, ClassType, VFSNode } from '../types/app';
import type { WizardSegment } from '../features/modals/CourseWizardModal';
import type { ImportRow, ImportStatus } from '../features/modals/ImportLessonsModal';
import type { useCourseWizard } from '../hooks/useCourseWizard';
import type { useQuizGenerator } from '../hooks/useQuizGenerator';
import type { useClassBatchOperations } from '../hooks/useClassBatchOperations';
import type { useStudentNotifications } from '../hooks/useStudentNotifications';

const ImportModal = lazy(() => import('../features/modals/ImportModal').then((m) => ({ default: m.ImportModal })));
const CourseWizardModal = lazy(() =>
  import('../features/modals/CourseWizardModal').then((m) => ({ default: m.CourseWizardModal })),
);
const ImportLessonsModal = lazy(() =>
  import('../features/modals/ImportLessonsModal').then((m) => ({ default: m.ImportLessonsModal })),
);
const QuizGeneratorModal = lazy(() =>
  import('../features/modals/QuizGeneratorModal').then((m) => ({ default: m.QuizGeneratorModal })),
);
const ProcessLogsModal = lazy(() =>
  import('../features/modals/ProcessLogsModal').then((m) => ({ default: m.ProcessLogsModal })),
);
const CloudDriveModal = lazy(() =>
  import('../features/modals/CloudDriveModal').then((m) => ({ default: m.CloudDriveModal })),
);
const SystemResourceLibraryModal = lazy(() =>
  import('../features/modals/SystemResourceLibraryModal').then((m) => ({ default: m.SystemResourceLibraryModal })),
);
const BatchPickerModal = lazy(() =>
  import('../features/modals/BatchPickerModal').then((m) => ({ default: m.BatchPickerModal })),
);
const ExportWeightModal = lazy(() =>
  import('../features/modals/ExportWeightModal').then((m) => ({ default: m.ExportWeightModal })),
);
const NotificationDetailModal = lazy(() =>
  import('../features/modals/NotificationDetailModal').then((m) => ({ default: m.NotificationDetailModal })),
);
const HelpTour = lazy(() => import('./HelpTour').then((m) => ({ default: m.HelpTour })));
const CoursewareHubPanel = lazy(() =>
  import('../features/teacher/CoursewareHubPanel').then((m) => ({ default: m.CoursewareHubPanel })),
);

import { useOptionalAppData } from '../context/AppDataContext';

export interface AppModalsProps {
  lang?: 'zh' | 'en';
  t?: any;

  // Grouped Hook Bundles (Optional)
  courseWizard?: ReturnType<typeof useCourseWizard>;
  quizGenerator?: ReturnType<typeof useQuizGenerator>;
  classBatch?: ReturnType<typeof useClassBatchOperations>;
  studentNotificationsHook?: ReturnType<typeof useStudentNotifications>;

  // Import Modal
  showImportModal?: boolean;
  setShowImportModal?: (v: boolean) => void;
  handleImportFile?: (file: File) => Promise<void> | void;
  importError?: string | null;
  importSuccess?: string | null;
  isImporting?: boolean;
  downloadCSVTemplate?: (type: 'class' | 'student') => void;

  // Course Wizard (Individual fallbacks)
  isCourseWizardOpen?: boolean;
  setIsCourseWizardOpen?: (v: boolean) => void;
  wizardStep?: number;
  setWizardStep?: Dispatch<SetStateAction<number>>;
  wizardIsSubmitting?: boolean;
  wizardCourseTitle?: string;
  setWizardCourseTitle?: (v: string) => void;
  wizardCourseDescription?: string;
  setWizardCourseDescription?: (v: string) => void;
  wizardCourseCategory?: string;
  setWizardCourseCategory?: (v: string) => void;
  wizardCourseTimeline?: WizardSegment[];
  setWizardCourseTimeline?: Dispatch<SetStateAction<WizardSegment[]>>;
  wizardCourseContent?: string;
  setWizardCourseContent?: (v: string) => void;
  addToast?: (title: string, message: string, type: 'info' | 'success' | 'warning' | 'error') => void;
  generateTemplateContent?: (title: string, category: string) => string;
  handleDeployWizardCourse?: () => void;

  // Import Lessons Modal
  isImportLessonsOpen?: boolean;
  setIsImportLessonsOpen?: (v: boolean) => void;
  importStatus?: ImportStatus;
  setIsDraggingImport?: (v: boolean) => void;
  handleCSVFileChange?: (file: File) => void;
  downloadCsvTemplate?: () => void;
  isDraggingImport?: boolean;
  previewImportData?: ImportRow[];
  setPreviewImportData?: Dispatch<SetStateAction<ImportRow[]>>;
  setImportStatus?: Dispatch<SetStateAction<ImportStatus>>;
  importProgress?: number;
  importProgressTotal?: number;
  importErrorMsg?: string;
  setImportErrorMsg?: Dispatch<SetStateAction<string>>;
  handleCSVImportSubmit?: () => void;

  // Quiz Generator Modal (Individual fallbacks)
  isQuizGeneratorOpen?: boolean;
  setIsQuizGeneratorOpen?: (v: boolean) => void;
  lessons?: Lesson[];
  quizGenMode?: 'scan_lesson' | 'topic';
  setQuizGenMode?: Dispatch<SetStateAction<'scan_lesson' | 'topic'>>;
  quizGenSelectedLessonId?: string;
  setQuizGenSelectedLessonId?: Dispatch<SetStateAction<string>>;
  quizGenTopic?: string;
  setQuizGenTopic?: Dispatch<SetStateAction<string>>;
  isGeneratingSuggestions?: boolean;
  setIsGeneratingSuggestions?: Dispatch<SetStateAction<boolean>>;
  suggestedObjectives?: string[];
  setSuggestedObjectives?: Dispatch<SetStateAction<string[]>>;
  suggestedQuestions?: any[];
  setSuggestedQuestions?: Dispatch<SetStateAction<any[]>>;
  quizGenTimeLimit?: number;
  setQuizGenTimeLimit?: Dispatch<SetStateAction<number>>;
  savingQuiz?: boolean;
  setSavingQuiz?: Dispatch<SetStateAction<boolean>>;
  quizGeneratorClassId?: string | null;
  fetchClassDashboard?: (classId: string) => void;

  // Process Logs Modal
  showProcessLogs?: string | null;
  setShowProcessLogs?: (v: string | null) => void;
  processLogsContent?: string;

  // VFS 浏览状态 —— Cloud Drive / System Resource Library 共用
  currentVfsParent?: string | null;
  setCurrentVfsParent?: (id: string | null) => void;
  vfsNodes?: VFSNode[];

  // Cloud Drive Modal
  isCloudDriveOpen?: boolean;
  setIsCloudDriveOpen?: (v: boolean) => void;
  cloudDrivePreviewNode?: any | null;
  setCloudDrivePreviewNode?: Dispatch<SetStateAction<any | null>>;

  // System Resource Library Modal
  isSystemResourceLibraryOpen?: boolean;
  setIsSystemResourceLibraryOpen?: (v: boolean) => void;
  systemResourceTab?: 'system' | 'cloud';
  setSystemResourceTab?: Dispatch<SetStateAction<'system' | 'cloud'>>;
  selectedLibraryResourceId?: string | null;
  setSelectedLibraryResourceId?: Dispatch<SetStateAction<string | null>>;
  loadingLibraryResources?: boolean;
  libraryResources?: any[];
  fetchLibraryResources?: () => void;

  // Batch Picker Modal
  batchPicker?: 'schedule' | 'lockedLesson' | 'transfer' | null;
  setBatchPicker?: Dispatch<SetStateAction<'schedule' | 'lockedLesson' | 'transfer' | null>> | ((v: any) => void);
  batchPickerLesson?: string;
  setBatchPickerLesson?: (v: string) => void;
  batchPickerDate?: string;
  setBatchPickerDate?: (v: string) => void;
  batchPickerTargetClass?: string;
  setBatchPickerTargetClass?: (v: string) => void;
  classes?: ClassType[];
  expandedClassId?: string | null;
  confirmBatchPicker?: () => void | Promise<void>;

  // Export Weight Modal
  isExportWeightModalOpen?: boolean;
  setIsExportWeightModalOpen?: Dispatch<SetStateAction<boolean>>;
  quizzesWeight?: number;
  setQuizzesWeight?: Dispatch<SetStateAction<number>>;
  assignmentsWeight?: number;
  setAssignmentsWeight?: Dispatch<SetStateAction<number>>;
  handleQuizzesWeightChange?: (val: number) => void;
  handleAssignmentsWeightChange?: (val: number) => void;
  customCategoryOverrides?: Record<string, 'quiz' | 'assignment'>;
  setCustomCategoryOverrides?: Dispatch<SetStateAction<Record<string, 'quiz' | 'assignment'>>>;
  classDashboardMap?: Record<string, any>;
  exportClassId?: string;
  exportClassName?: string;
  csvPreviewData?: any | null;
  handleExportGrades?: (
    classId: string,
    className: string,
    qWeight?: number,
    aWeight?: number,
    overrides?: Record<string, 'quiz' | 'assignment'>,
  ) => void;

  // Notification Detail Modal
  selectedNotificationForModal?: any | null;
  setSelectedNotificationForModal?: (v: any | null) => void;
  setSelectedAssignment?: (v: any) => void;
  setStudentViewStatus?: (v: any) => void;
  setQuizStudentAnswers?: (v: any) => void;
  setSubAssignmentTab?: (v: any) => void;

  // Help Tour & Courseware Hub
  isTourOpen?: boolean;
  setIsTourOpen?: (v: boolean) => void;
  handleSeedSuccess?: (data: any) => void;
  setTeacherTab?: (v: string) => void;
  showCoursewareHub?: boolean;
  setShowCoursewareHub?: (v: boolean) => void;
}

export function AppModals(props: AppModalsProps = {}) {
  const a = useOptionalAppData();

  const {
    lang = (a?.lang as 'zh' | 'en') ?? 'zh',
    t = a?.t ?? {},
    showImportModal = a?.showImportModal ?? false,
    setShowImportModal = a?.setShowImportModal ?? (() => {}),
    handleImportFile = a?.handleImportFile ?? (() => {}),
    importError = a?.importError ?? null,
    importSuccess = a?.importSuccess ?? null,
    isImporting = a?.isImporting ?? false,
    downloadCSVTemplate = a?.downloadCSVTemplate ?? (() => {}),
    addToast = a?.addToast ?? (() => {}),
    generateTemplateContent = a?.generateTemplateContent ?? (() => ''),
    isImportLessonsOpen = a?.isImportLessonsOpen ?? false,
    setIsImportLessonsOpen = a?.setIsImportLessonsOpen ?? (() => {}),
    importStatus = a?.importStatus ?? 'idle',
    setIsDraggingImport = a?.setIsDraggingImport ?? (() => {}),
    handleCSVFileChange = a?.handleCSVFileChange ?? (() => {}),
    downloadCsvTemplate = a?.downloadCsvTemplate ?? (() => {}),
    isDraggingImport = a?.isDraggingImport ?? false,
    previewImportData = a?.previewImportData ?? [],
    setPreviewImportData = a?.setPreviewImportData ?? (() => {}),
    setImportStatus = a?.setImportStatus ?? (() => {}),
    importProgress = a?.importProgress ?? 0,
    importProgressTotal = a?.importProgressTotal ?? 0,
    importErrorMsg = a?.importErrorMsg ?? '',
    setImportErrorMsg = a?.setImportErrorMsg ?? (() => {}),
    handleCSVImportSubmit = a?.handleCSVImportSubmit ?? (() => {}),
    lessons = a?.lessons ?? [],
    fetchClassDashboard = a?.fetchClassDashboard ?? (() => {}),
    // VFS 浏览状态（Cloud Drive / System Resource Library 共用）
    currentVfsParent = a?.currentVfsParent ?? null,
    setCurrentVfsParent = a?.setCurrentVfsParent ?? (() => {}),
    vfsNodes = a?.vfsNodes ?? [],
    showProcessLogs = a?.showProcessLogs ?? null,
    setShowProcessLogs = a?.setShowProcessLogs ?? (() => {}),
    processLogsContent = a?.processLogsContent ?? '',
    isCloudDriveOpen = a?.isCloudDriveOpen ?? false,
    setIsCloudDriveOpen = a?.setIsCloudDriveOpen ?? (() => {}),
    cloudDrivePreviewNode = a?.cloudDrivePreviewNode ?? null,
    setCloudDrivePreviewNode = a?.setCloudDrivePreviewNode ?? (() => {}),
    isSystemResourceLibraryOpen = a?.isSystemResourceLibraryOpen ?? false,
    setIsSystemResourceLibraryOpen = a?.setIsSystemResourceLibraryOpen ?? (() => {}),
    systemResourceTab = a?.systemResourceTab ?? 'system',
    setSystemResourceTab = a?.setSystemResourceTab ?? (() => {}),
    selectedLibraryResourceId = a?.selectedLibraryResourceId ?? null,
    setSelectedLibraryResourceId = a?.setSelectedLibraryResourceId ?? (() => {}),
    loadingLibraryResources = a?.loadingLibraryResources ?? false,
    libraryResources = a?.libraryResources ?? [],
    fetchLibraryResources = a?.fetchLibraryResources ?? (() => {}),
    classes = a?.classes ?? [],
    expandedClassId = a?.expandedClassId ?? null,
    isExportWeightModalOpen = a?.isExportWeightModalOpen ?? false,
    setIsExportWeightModalOpen = a?.setIsExportWeightModalOpen ?? (() => {}),
    quizzesWeight = a?.quizzesWeight ?? 40,
    setQuizzesWeight = a?.setQuizzesWeight ?? (() => {}),
    assignmentsWeight = a?.assignmentsWeight ?? 60,
    setAssignmentsWeight = a?.setAssignmentsWeight ?? (() => {}),
    handleQuizzesWeightChange = a?.handleQuizzesWeightChange ?? (() => {}),
    handleAssignmentsWeightChange = a?.handleAssignmentsWeightChange ?? (() => {}),
    customCategoryOverrides = a?.customCategoryOverrides ?? {},
    setCustomCategoryOverrides = a?.setCustomCategoryOverrides ?? (() => {}),
    classDashboardMap = a?.classDashboardMap ?? {},
    exportClassId = a?.exportClassId ?? '',
    exportClassName = a?.exportClassName ?? '',
    csvPreviewData = a?.csvPreviewData ?? null,
    handleExportGrades = a?.handleExportGrades ?? (() => {}),
    setSelectedAssignment = a?.setSelectedAssignment ?? (() => {}),
    setStudentViewStatus = a?.setStudentViewStatus ?? (() => {}),
    setQuizStudentAnswers = a?.setQuizStudentAnswers ?? (() => {}),
    setSubAssignmentTab = a?.setSubAssignmentTab ?? (() => {}),
    isTourOpen = a?.isTourOpen ?? false,
    setIsTourOpen = a?.setIsTourOpen ?? (() => {}),
    handleSeedSuccess = a?.handleSeedSuccess ?? (() => {}),
    setTeacherTab = a?.setTeacherTab ?? (() => {}),
    showCoursewareHub = a?.showCoursewareHub ?? false,
    setShowCoursewareHub = a?.setShowCoursewareHub ?? (() => {}),
  } = props;

  // Course Wizard Resolution
  const cw = props.courseWizard ?? a;
  const isCourseWizardOpen = cw?.isCourseWizardOpen ?? props.isCourseWizardOpen ?? false;
  const setIsCourseWizardOpen = cw?.setIsCourseWizardOpen ?? props.setIsCourseWizardOpen ?? (() => {});
  const wizardStep = cw?.wizardStep ?? props.wizardStep ?? 1;
  const setWizardStep = cw?.setWizardStep ?? props.setWizardStep ?? (() => {});
  const wizardIsSubmitting = cw?.wizardIsSubmitting ?? props.wizardIsSubmitting ?? false;
  const wizardCourseTitle = cw?.wizardCourseTitle ?? props.wizardCourseTitle ?? '';
  const setWizardCourseTitle = cw?.setWizardCourseTitle ?? props.setWizardCourseTitle ?? (() => {});
  const wizardCourseDescription = cw?.wizardCourseDescription ?? props.wizardCourseDescription ?? '';
  const setWizardCourseDescription = cw?.setWizardCourseDescription ?? props.setWizardCourseDescription ?? (() => {});
  const wizardCourseCategory = cw?.wizardCourseCategory ?? props.wizardCourseCategory ?? '';
  const setWizardCourseCategory = cw?.setWizardCourseCategory ?? props.setWizardCourseCategory ?? (() => {});
  const wizardCourseTimeline = cw?.wizardCourseTimeline ?? props.wizardCourseTimeline ?? [];
  const setWizardCourseTimeline = cw?.setWizardCourseTimeline ?? props.setWizardCourseTimeline ?? (() => {});
  const wizardCourseContent = cw?.wizardCourseContent ?? props.wizardCourseContent ?? '';
  const setWizardCourseContent = cw?.setWizardCourseContent ?? props.setWizardCourseContent ?? (() => {});
  const handleDeployWizardCourse = cw?.handleDeployWizardCourse ?? props.handleDeployWizardCourse ?? (() => {});

  // Quiz Generator Resolution
  const qg = props.quizGenerator ?? a;
  const isQuizGeneratorOpen = qg?.isQuizGeneratorOpen ?? props.isQuizGeneratorOpen ?? false;
  const setIsQuizGeneratorOpen = qg?.setIsQuizGeneratorOpen ?? props.setIsQuizGeneratorOpen ?? (() => {});
  const quizGenMode = qg?.quizGenMode ?? props.quizGenMode ?? 'scan_lesson';
  const setQuizGenMode = qg?.setQuizGenMode ?? props.setQuizGenMode ?? (() => {});
  const quizGenSelectedLessonId = qg?.quizGenSelectedLessonId ?? props.quizGenSelectedLessonId ?? '';
  const setQuizGenSelectedLessonId = qg?.setQuizGenSelectedLessonId ?? props.setQuizGenSelectedLessonId ?? (() => {});
  const quizGenTopic = qg?.quizGenTopic ?? props.quizGenTopic ?? '';
  const setQuizGenTopic = qg?.setQuizGenTopic ?? props.setQuizGenTopic ?? (() => {});
  const isGeneratingSuggestions = qg?.isGeneratingSuggestions ?? props.isGeneratingSuggestions ?? false;
  const setIsGeneratingSuggestions = qg?.setIsGeneratingSuggestions ?? props.setIsGeneratingSuggestions ?? (() => {});
  const suggestedObjectives = qg?.suggestedObjectives ?? props.suggestedObjectives ?? [];
  const setSuggestedObjectives = qg?.setSuggestedObjectives ?? props.setSuggestedObjectives ?? (() => {});
  const suggestedQuestions = qg?.suggestedQuestions ?? props.suggestedQuestions ?? [];
  const setSuggestedQuestions = qg?.setSuggestedQuestions ?? props.setSuggestedQuestions ?? (() => {});
  const quizGenTimeLimit = qg?.quizGenTimeLimit ?? props.quizGenTimeLimit ?? 0;
  const setQuizGenTimeLimit = qg?.setQuizGenTimeLimit ?? props.setQuizGenTimeLimit ?? (() => {});
  const savingQuiz = qg?.savingQuiz ?? props.savingQuiz ?? false;
  const setSavingQuiz = qg?.setSavingQuiz ?? props.setSavingQuiz ?? (() => {});
  const quizGeneratorClassId = qg?.quizGeneratorClassId ?? props.quizGeneratorClassId ?? null;

  // Batch Picker Resolution
  const cb = props.classBatch ?? a;
  const batchPicker = cb?.batchPicker ?? props.batchPicker ?? null;
  const setBatchPicker = cb?.setBatchPicker ?? props.setBatchPicker ?? (() => {});
  const batchPickerLesson = cb?.batchPickerLesson ?? props.batchPickerLesson ?? '';
  const setBatchPickerLesson = cb?.setBatchPickerLesson ?? props.setBatchPickerLesson ?? (() => {});
  const batchPickerDate = cb?.batchPickerDate ?? props.batchPickerDate ?? '';
  const setBatchPickerDate = cb?.setBatchPickerDate ?? props.setBatchPickerDate ?? (() => {});
  const batchPickerTargetClass = cb?.batchPickerTargetClass ?? props.batchPickerTargetClass ?? '';
  const setBatchPickerTargetClass = cb?.setBatchPickerTargetClass ?? props.setBatchPickerTargetClass ?? (() => {});
  const confirmBatchPicker = cb?.confirmBatchPicker ?? props.confirmBatchPicker ?? (() => {});

  // Student Notifications Resolution
  const sn = props.studentNotificationsHook ?? a;
  const selectedNotificationForModal = sn?.selectedNotificationForModal ?? props.selectedNotificationForModal ?? null;
  const setSelectedNotificationForModal =
    sn?.setSelectedNotificationForModal ?? props.setSelectedNotificationForModal ?? (() => {});

  return (
    <Suspense fallback={null}>
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

      {showCoursewareHub && <CoursewareHubPanel onClose={() => setShowCoursewareHub(false)} lang={lang} />}
    </Suspense>
  );
}
