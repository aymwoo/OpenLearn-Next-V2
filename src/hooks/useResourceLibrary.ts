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
      setImportStatus('idle');
    } catch (err: any) {
      setImportStatus('error');
      setImportErrorMsg(err.message || String(err));
    }
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
