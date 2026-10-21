/**
 * useResourceLibrary — 系统资源库 / 云盘 / 课程与班级导入的自定义 hook（C1-R2b）。
 *
 * 原 App.tsx 内联 state / effect / 函数原样迁入；fetchClasses/fetchStudents/
 * fetchLessons 由参数注入（数据本体在 appStore）。
 */
import { useEffect, useState } from 'react';
import {
  downloadCSVTemplate as downloadCSVTemplateService,
  parseAndImportClassesOrStudents,
  parseLessonCSV,
  submitCSVLessons,
} from '../services/bulkImportService';
import { fetchLibraryResources as fetchLibraryResourcesApi } from '../services/sessionService.js';
import {
  downloadCourseTemplate as downloadCourseTemplateApi,
  importCoursePackage as importCoursePackageApi,
  readCoursePackageFile,
  type CoursePackagePreview,
} from '../services/coursePackageService.js';

export function useResourceLibrary(deps: {
  lang: 'zh' | 'en';
  session: unknown;
  fetchClasses: () => Promise<void>;
  fetchStudents: () => Promise<void>;
  fetchLessons: () => Promise<void>;
  addToast: (title: string, message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}) {
  const { lang, session, fetchClasses, fetchStudents, fetchLessons, addToast } = deps;

  // ── 资源库 / 云盘 ──
  const [isCloudDriveOpen, setIsCloudDriveOpen] = useState(false);
  const [cloudDrivePreviewNode, setCloudDrivePreviewNode] = useState<{
    id: string;
    name: string;
    content: string;
  } | null>(null);
  const [isSystemResourceLibraryOpen, setIsSystemResourceLibraryOpen] = useState(false);
  const [systemResourceTab, setSystemResourceTab] = useState<'system' | 'cloud'>('system');
  const [selectedLibraryResourceId, setSelectedLibraryResourceId] = useState<string | null>(null);
  const [libraryResources, setLibraryResources] = useState<any[]>([]);
  const [loadingLibraryResources, setLoadingLibraryResources] = useState(false);
  const [showCoursewareHub, setShowCoursewareHub] = useState(false);

  const fetchLibraryResources = async () => {
    try {
      setLoadingLibraryResources(true);
      const { ok, data } = await fetchLibraryResourcesApi();
      if (ok) {
        setLibraryResources(data);
      }
    } catch (e) {
      console.warn('Error fetching library resources:', e);
    } finally {
      setLoadingLibraryResources(false);
    }
  };

  // 资源库打开时拉取
  useEffect(() => {
    if (isSystemResourceLibraryOpen) {
      fetchLibraryResources();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSystemResourceLibraryOpen]);

  // ── 课程 CSV 导入 ──
  const [isImportLessonsOpen, setIsImportLessonsOpen] = useState(false);
  const [importStatus, setImportStatus] = useState<'idle' | 'parsing' | 'importing' | 'success' | 'error'>('idle');
  const [importProgress, setImportProgress] = useState(0);
  const [importProgressTotal, setImportProgressTotal] = useState(0);
  const [importErrorMsg, setImportErrorMsg] = useState('');
  const [previewImportData, setPreviewImportData] = useState<{ title: string; content: string }[]>([]);
  const [isDraggingImport, setIsDraggingImport] = useState(false);

  // ── 课程包（Course Package）导入 ──
  // 课程包是自包含的单个 JSON：课程本体 + 教学环节 + 白板元素 + 课件附件。
  // 与 CSV 批量导入并存 —— CSV 只能带标题和正文，课程包才是一节完整的课。
  const [packagePreview, setPackagePreview] = useState<CoursePackagePreview | null>(null);
  const [pendingCoursePackage, setPendingCoursePackage] = useState<any | null>(null);

  const downloadCsvTemplate = () => {
    downloadCSVTemplateService('class', lang);
  };

  const handleCSVFileChange = async (file: File) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setImportStatus('error');
      setImportErrorMsg(lang === 'zh' ? '只支持包含 .csv 后缀名的文件！' : 'Only files ending in .csv are supported!');
      return;
    }
    setImportStatus('parsing');
    setImportErrorMsg('');
    try {
      const parsedList = await parseLessonCSV(file, lang);
      setPreviewImportData(parsedList);
      // 保持 'parsing'（=预览态）：此前这里重置为 'idle'，导致预览表格与
      // 「开始导入」按钮永远不可达 —— CSV 导入流程实际是断的。
    } catch (err: any) {
      setImportStatus('error');
      setImportErrorMsg(err.message || String(err));
    }
  };

  /**
   * 导入框的统一文件入口：按后缀分派到 CSV 批量导入或课程包导入。
   */
  const handleImportFileChange = async (file: File) => {
    if (!file) return;
    const lower = file.name.toLowerCase();
    if (lower.endsWith('.json')) {
      setImportErrorMsg('');
      try {
        const result = await readCoursePackageFile(file);
        if (!result.ok) {
          setPackagePreview(null);
          setPendingCoursePackage(null);
          setImportStatus('error');
          setImportErrorMsg(result.error);
          return;
        }
        setPendingCoursePackage(result.package);
        setPackagePreview(result.preview);
        setPreviewImportData([]);
        // 同上：停在预览态，等教师点「导入课程包」。
        setImportStatus('parsing');
      } catch (err: any) {
        setImportStatus('error');
        setImportErrorMsg(err?.message || String(err));
      }
      return;
    }
    setPackagePreview(null);
    setPendingCoursePackage(null);
    await handleCSVFileChange(file);
  };

  /** 下载内置课程模板（JSON，自包含附件）。 */
  const downloadCourseTemplate = async () => {
    const result = await downloadCourseTemplateApi();
    if (!result.ok) {
      setImportStatus('error');
      setImportErrorMsg(result.error || (lang === 'zh' ? '模板下载失败' : 'Failed to download template'));
      return;
    }
    addToast(
      lang === 'zh' ? '模板已下载' : 'Template downloaded',
      lang === 'zh'
        ? 'openlearn-course-template.json 可直接拖回导入框完成导入。'
        : 'Drag openlearn-course-template.json back into the import dialog to finish.',
      'success',
    );
  };

  /** 提交课程包导入。 */
  const handlePackageImportSubmit = async () => {
    if (!pendingCoursePackage) return;
    setImportStatus('importing');
    setImportErrorMsg('');
    const result = await importCoursePackageApi(pendingCoursePackage);
    if (result.ok && result.result) {
      setImportStatus('success');
      await fetchLessons();
      addToast(
        lang === 'zh' ? '课程包导入成功' : 'Course package imported',
        lang === 'zh'
          ? `已导入「${result.result.title}」：${result.result.segments} 个教学环节、${result.result.elements} 个白板元素、${result.result.assets} 份课件附件。`
          : `Imported "${result.result.title}": ${result.result.segments} segments, ${result.result.elements} elements, ${result.result.assets} assets.`,
        'success',
      );
      return;
    }
    setImportStatus('error');
    setImportErrorMsg(result.error || (lang === 'zh' ? '课程包导入失败' : 'Course package import failed'));
  };

  const handleCSVImportSubmit = async () => {
    if (previewImportData.length === 0) return;
    setImportStatus('importing');
    setImportProgress(0);
    setImportProgressTotal(previewImportData.length);
    const result = await submitCSVLessons(previewImportData, {
      lang,
      setImportProgress,
      fetchLessons,
    });
    if (result.success) {
      setImportStatus('success');
    } else {
      setImportStatus('error');
      setImportErrorMsg(result.errorMsg || '');
    }
  };

  // ── 班级/学生批量导入 ──
  const [showImportModal, setShowImportModal] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);

  const downloadCSVTemplate = (type: 'class' | 'student') => {
    downloadCSVTemplateService(type, lang);
  };

  const handleImportFile = async (file: File) => {
    setIsImporting(true);
    setImportError(null);
    setImportSuccess(null);
    try {
      const res = await parseAndImportClassesOrStudents(file, {
        lang,
        fetchClasses,
        fetchStudents,
      });
      setImportSuccess(res.message);
    } catch (err: any) {
      setImportError(err.message || String(err));
    } finally {
      setIsImporting(false);
    }
  };

  return {
    // 资源库 / 云盘
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
    // 课程 CSV 导入
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
    // 课程包导入
    packagePreview,
    setPackagePreview,
    pendingCoursePackage,
    handleImportFileChange,
    handlePackageImportSubmit,
    downloadCourseTemplate,
    // 班级/学生批量导入
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
  };
}
