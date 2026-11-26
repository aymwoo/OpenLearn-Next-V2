import { Dispatch, SetStateAction } from 'react';
import { Upload, Download, Loader2, CheckCircle2, Check, FileJson, Package } from 'lucide-react';
import AccessibleDialog, {
  DialogBody,
  DialogButton,
  DialogCloseButton,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/AccessibleDialog';
import { AccessibleTableRegion } from '../../components/AccessibleTableRegion';
import type {
  CoursePackagePreview,
  CoursePackageDuplicate,
  CourseDeliveryMode,
} from '../../services/coursePackageService';
import type { ParsedLessonRow } from '../../services/bulkImportService';
import { COURSE_PACKAGE_MAX_FILE_BYTES } from '../../services/coursePackageService';

/** 导入框承诺的文件体积上限（MB）—— 与实际校验口径同源。 */
const IMPORT_MAX_FILE_MB = Math.round(COURSE_PACKAGE_MAX_FILE_BYTES / (1024 * 1024));

/** CSV 预览行（与 `parseLessonCSV` 的返回结构一致）。 */
export type ImportRow = ParsedLessonRow;

export type ImportStatus = 'idle' | 'parsing' | 'importing' | 'success' | 'error';

export interface ImportLessonsModalProps {
  isImportLessonsOpen: boolean;
  setIsImportLessonsOpen: (v: boolean) => void;
  lang: 'zh' | 'en';
  importStatus: ImportStatus;
  setIsDraggingImport: (v: boolean) => void;
  handleCSVFileChange: (file: File) => void;
  /** 导入框的统一文件入口（按后缀分派到 CSV / 课程包）。 */
  handleImportFileChange: (file: File) => void;
  downloadCsvTemplate: () => void;
  /** 下载内置课程模板（JSON，自包含课件附件）；按交付模式返回白板 / 学案模板。 */
  downloadCourseTemplate: (mode: CourseDeliveryMode) => void;
  /** 已选中的课程包摘要；非空时预览区切换为课程包视图。 */
  packagePreview: CoursePackagePreview | null;
  /**
   * 提交课程包导入。
   *
   * @param allowDuplicate 命中去重时仍然导入一份副本。
   */
  handlePackageImportSubmit: (allowDuplicate?: boolean) => void;
  /** 命中去重时的冲突信息；非空时错误区切换为「重复导入」确认视图。 */
  packageDuplicate?: CoursePackageDuplicate | null;
  /** 取消「重复导入」询问，回到预览态。 */
  handlePackageDuplicateDismiss?: () => void;
  isDraggingImport: boolean;
  previewImportData: ImportRow[];
  setPreviewImportData: Dispatch<SetStateAction<ImportRow[]>>;
  setImportStatus: Dispatch<SetStateAction<ImportStatus>>;
  importProgress: number;
  importProgressTotal: number;
  importErrorMsg: string;
  setImportErrorMsg: Dispatch<SetStateAction<string>>;
  handleCSVImportSubmit: () => void;
}

export function ImportLessonsModal(props: ImportLessonsModalProps) {
  const {
    isImportLessonsOpen,
    setIsImportLessonsOpen,
    lang,
    importStatus,
    setIsDraggingImport,
    handleCSVFileChange,
    handleImportFileChange,
    downloadCsvTemplate,
    downloadCourseTemplate,
    packagePreview,
    handlePackageImportSubmit,
    packageDuplicate = null,
    handlePackageDuplicateDismiss = () => {},
    isDraggingImport,
    previewImportData,
    setPreviewImportData,
    setImportStatus,
    importProgress,
    importProgressTotal,
    importErrorMsg,
    setImportErrorMsg,
    handleCSVImportSubmit,
  } = props;

  return (
    <AccessibleDialog
      open={isImportLessonsOpen}
      onClose={() => {
        if (importStatus !== 'importing') {
          setIsImportLessonsOpen(false);
        }
      }}
      ariaLabelledBy="import-lessons-dialog-title"
      closedBy={importStatus === 'importing' ? 'none' : 'closerequest'}
      className="max-w-2xl max-h-[90vh] overflow-hidden"
    >
      <DialogHeader>
        <DialogTitle
          id="import-lessons-dialog-title"
          icon={<Upload size={20} className="animate-pulse" />}
          description={
            lang === 'zh'
              ? 'CSV 为「简易导入」（仅标题与正文）；需要教学环节 + 白板组件 + 课件附件的完整课程请用课程包 JSON。'
              : 'CSV is a "quick import" (title and body only). For a complete lesson — segments, whiteboard components and assets — use a course package JSON.'
          }
        >
          {lang === 'zh' ? '批量导入课程' : 'Bulk-Import Courses'}
        </DialogTitle>
        <DialogCloseButton
          label={lang === 'zh' ? '关闭弹窗' : 'Close dialog'}
          onClick={() => {
            if (importStatus !== 'importing') {
              setIsImportLessonsOpen(false);
            }
          }}
          disabled={importStatus === 'importing'}
        />
      </DialogHeader>

      <DialogBody className="space-y-5">
        {/* IDLE state -> Drag and Drop zone */}
        {importStatus === 'idle' && (
          <div className="space-y-4">
            {/* Schema instructions */}
            <div className="p-4 bg-primary-theme-light/50 border border-primary-theme/30 rounded-xl">
              <h4 className="text-xs font-bold text-primary-ink uppercase tracking-wide flex items-center gap-2">
                <span>📌</span>
                {lang === 'zh' ? '简易导入（CSV）' : 'Quick import (CSV)'}
                {/* 定位徽标：CSV 通道只有两列，别让教师以为它也能带环节/组件/附件 */}
                <span
                  className="text-[10px] font-mono font-normal normal-case tracking-normal text-primary-ink bg-primary-theme-light border border-primary-theme/30 rounded px-1.5 py-0.5"
                  data-testid="csv-simple-import-badge"
                >
                  {lang === 'zh' ? '仅标题 + 正文' : 'title + body only'}
                </span>
              </h4>
              <p className="text-xs text-main mt-1 leading-relaxed">
                {lang === 'zh'
                  ? 'CSV 文件的首行必须定义列标题（不区分大小写、无多余空格），包含以下两项必需内容：'
                  : 'Your CSV file must include exactly these header columns on the first row (case-insensitive):'}
              </p>
              <ul className="list-disc pl-5 mt-2 text-xs text-main space-y-1">
                <li>
                  <strong>title</strong>:{' '}
                  {lang === 'zh' ? '课程名 (非空，例如 "代数几何")' : 'Course title (Required, e.g. "Linear Algebra")'}
                </li>
                <li>
                  <strong>content</strong>:{' '}
                  {lang === 'zh' ? '教学大纲 / Markdown 格式的课堂细目' : 'Syllabus content supporting rich markdown.'}
                </li>
                <li>
                  <strong>mode</strong>
                  {lang === 'zh'
                    ? '（可选）：whiteboard / xuean，也可写「白板」/「学案」；留空按白板导入，学案课会自动生成预习 / 研读 / 练习三个活动。'
                    : ' (optional): whiteboard / xuean; empty defaults to whiteboard. Guided-study lessons get preview/study/practice activities automatically.'}
                </li>
              </ul>
              <div className="mt-3.5 flex flex-wrap gap-2 justify-start">
                <button
                  onClick={downloadCsvTemplate}
                  className="flex items-center gap-1 p-2 text-xs font-bold text-primary-ink bg-surface border border-primary-theme/30 rounded-lg shadow-3xs hover:bg-primary-theme-light hover:-translate-y-0.5 hover:shadow-xs transition-all cursor-pointer"
                >
                  <Download size={12} />
                  {lang === 'zh' ? '获取标准 CSV 模板' : 'Download Template CSV'}
                </button>
                <button
                  onClick={() => downloadCourseTemplate('whiteboard')}
                  data-testid="download-course-package-template-btn"
                  className="flex items-center gap-1 p-2 text-xs font-bold text-emerald-700 dark:text-emerald-400 bg-surface border border-emerald-500/20 rounded-lg shadow-3xs hover:bg-emerald-500/10 hover:-translate-y-0.5 hover:shadow-xs transition-all cursor-pointer"
                >
                  <FileJson size={12} />
                  {lang === 'zh' ? '下载白板课程模板' : 'Download Whiteboard Template'}
                </button>
                <button
                  onClick={() => downloadCourseTemplate('xuean')}
                  data-testid="download-xuean-course-package-template-btn"
                  className="flex items-center gap-1 p-2 text-xs font-bold text-teal-700 dark:text-teal-400 bg-surface border border-teal-500/20 rounded-lg shadow-3xs hover:bg-teal-500/10 hover:-translate-y-0.5 hover:shadow-xs transition-all cursor-pointer"
                >
                  <FileJson size={12} />
                  {lang === 'zh' ? '下载学案课程模板' : 'Download Guided-Study Template'}
                </button>
              </div>
              <p className="text-[11px] text-muted mt-2.5 leading-relaxed">
                {lang === 'zh'
                  ? '课程模板是一个自包含的 JSON 文件：白板模板包含教学环节、全部预设组件的白板元素，学案模板包含教学环节、学案活动与首页块；两者都可内嵌图片 / PDF / PPTX / DOCX / XLSX / ZIP / MD / TXT / CSV 附件（解码后合计不超过 20MB）—— 拖回本对话框即可导入成一节完整的课。大纲中可用 ${asset:<id>} 引用内嵌素材，例如 ![示意图](${asset:img-1}) 或 [参考讲义](${asset:doc-1})，导入后会自动替换为真实文件地址。'
                  : 'A course template is a self-contained JSON file: the whiteboard template carries segments and every preset component, while the guided-study template carries segments, activities and home blocks. Both can embed images / PDF / PPTX / DOCX / XLSX / ZIP / MD / TXT / CSV assets (up to 20MB decoded in total) — drop it back here to import a complete lesson. Reference embedded assets from the outline with ${asset:<id>}, e.g. ![diagram](${asset:img-1}) or [handout](${asset:doc-1}); the placeholders are resolved to real file URLs on import.'}
              </p>
            </div>

            {/* Drag-and-drop Dropzone */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDraggingImport(true);
              }}
              onDragLeave={() => setIsDraggingImport(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDraggingImport(false);
                if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                  handleImportFileChange(e.dataTransfer.files[0]);
                }
              }}
              onClick={() => {
                document.getElementById('import-csv-file-picker')?.click();
              }}
              className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all flex flex-col items-center justify-center min-h-[180px] ${
                isDraggingImport
                  ? 'border-primary-theme bg-primary-theme-light/70 scale-[1.01]'
                  : 'border-theme bg-surface-secondary/50 hover:bg-surface-secondary hover:border-primary-theme'
              }`}
            >
              <input
                id="import-csv-file-picker"
                type="file"
                accept=".csv,.json"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    handleImportFileChange(e.target.files[0]);
                  }
                }}
              />
              <div className="p-3 bg-surface-secondary border border-theme rounded-full text-primary-ink mb-3 group-hover:scale-105 transition-all">
                <Upload size={24} />
              </div>
              <span className="text-sm font-bold text-main">
                {lang === 'zh'
                  ? '选择 CSV / 课程包 JSON 文件，或拖放至此处'
                  : 'Click to select or drag and drop a CSV / course-package JSON file here'}
              </span>
              <span className="text-xs text-subtle mt-1">
                {/* 上限文案直接取常量，避免「承诺 20MB」与实际校验口径再次漂移（Issue #246） */}
                {lang === 'zh'
                  ? `CSV（简易导入）或课程包 JSON（完整课程），单文件最大 ${IMPORT_MAX_FILE_MB}MB`
                  : `CSV (quick import) or course-package JSON (full lesson), up to ${IMPORT_MAX_FILE_MB}MB`}
              </span>
            </div>
          </div>
        )}

        {/* PARSING state -> Show Preview of file */}
        {importStatus === 'parsing' && packagePreview && (
          <div className="space-y-4" data-testid="course-package-preview">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded-full">
                ✓{' '}
                {lang === 'zh'
                  ? `课程包解析成功：${packagePreview.segments} 个教学环节 · ${packagePreview.elements} 个白板元素`
                  : `Course package parsed: ${packagePreview.segments} segments · ${packagePreview.elements} elements`}
              </span>
              <button
                onClick={() => {
                  setPreviewImportData([]);
                  setImportStatus('idle');
                }}
                className="text-xs text-primary-ink hover:text-primary-solid-hover font-semibold"
              >
                {lang === 'zh' ? '重新上传' : 'Upload Different File'}
              </button>
            </div>

            <div className="p-4 bg-surface border border-theme rounded-xl shadow-3xs">
              <div className="flex items-start gap-3">
                <div className="p-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-emerald-600 dark:text-emerald-400">
                  <Package size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <h4 className="text-sm font-bold text-main truncate" title={packagePreview.title}>
                    {packagePreview.title}
                  </h4>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="px-1.5 py-0.5 rounded bg-primary-theme-light border border-primary-theme/30 text-[10px] font-bold text-primary-ink">
                      {packagePreview.deliveryMode === 'xuean'
                        ? lang === 'zh'
                          ? '学案'
                          : 'Guided Study'
                        : lang === 'zh'
                          ? '白板'
                          : 'Whiteboard'}
                    </span>
                    {packagePreview.metaName && (
                      <p className="text-[11px] text-muted truncate">{packagePreview.metaName}</p>
                    )}
                  </div>
                  <p className="text-[11px] text-subtle mt-0.5 font-mono truncate">{packagePreview.fileName}</p>
                </div>
              </div>

              <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
                <div className="p-2 bg-surface-secondary border border-theme rounded-lg">
                  <dt className="text-[10px] text-muted font-semibold">{lang === 'zh' ? '教学环节' : 'Segments'}</dt>
                  <dd className="text-base font-bold text-main">{packagePreview.segments}</dd>
                </div>
                <div className="p-2 bg-surface-secondary border border-theme rounded-lg">
                  <dt className="text-[10px] text-muted font-semibold">{lang === 'zh' ? '白板元素' : 'Elements'}</dt>
                  <dd className="text-base font-bold text-main">{packagePreview.elements}</dd>
                </div>
                <div className="p-2 bg-surface-secondary border border-theme rounded-lg">
                  <dt className="text-[10px] text-muted font-semibold">{lang === 'zh' ? '学案活动' : 'Activities'}</dt>
                  <dd className="text-base font-bold text-main">{packagePreview.activities ?? 0}</dd>
                </div>
                <div className="p-2 bg-surface-secondary border border-theme rounded-lg">
                  <dt className="text-[10px] text-muted font-semibold">{lang === 'zh' ? '课件附件' : 'Assets'}</dt>
                  <dd className="text-base font-bold text-main">{packagePreview.assets}</dd>
                </div>
              </dl>

              {packagePreview.componentTypes.length > 0 && (
                <div className="mt-3">
                  <p className="text-[10px] text-muted font-semibold mb-1.5">
                    {lang === 'zh' ? '覆盖的预设组件' : 'Covered components'}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {packagePreview.componentTypes.map((type) => (
                      <span
                        key={type}
                        className="px-1.5 py-0.5 rounded bg-primary-theme-light border border-primary-theme/30 text-[10px] font-mono text-primary-ink"
                      >
                        {type}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400 text-xs rounded-xl p-3 flex gap-2.5 items-start">
              <span className="text-base leading-none">⚠️</span>
              <p className="leading-relaxed">
                {lang === 'zh'
                  ? '导入将以单个事务写入：教学环节、白板元素与课件附件要么全部成功，要么全部回滚，不会留下半截课程。'
                  : 'The import runs as a single transaction: segments, whiteboard elements and assets are either all written or all rolled back.'}
              </p>
            </div>
          </div>
        )}

        {importStatus === 'parsing' && !packagePreview && previewImportData.length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded-full">
                ✓{' '}
                {lang === 'zh'
                  ? `解析成功：查找到 ${previewImportData.length} 门课程`
                  : `Parsed Successfully: Found ${previewImportData.length} records`}
              </span>
              <button
                onClick={() => {
                  setPreviewImportData([]);
                  setImportStatus('idle');
                }}
                className="text-xs text-primary-ink hover:text-primary-solid-hover font-semibold"
              >
                {lang === 'zh' ? '重新上传' : 'Upload Different File'}
              </button>
            </div>

            <AccessibleTableRegion
              labelledBy="import-lessons-preview-caption"
              className="border border-theme rounded-xl shadow-3xs max-h-[300px] overflow-y-auto"
            >
              <table
                className="responsive-data-table w-full text-left text-xs border-collapse"
                data-stack-mobile="true"
              >
                <caption id="import-lessons-preview-caption" className="sr-only">
                  {lang === 'zh' ? '课程导入预览' : 'Lesson Import Preview'}
                </caption>
                <thead className="bg-surface-secondary text-muted border-b border-theme font-bold">
                  <tr>
                    <th scope="col" className="p-3 w-1/4">
                      {lang === 'zh' ? '课程名称' : 'Course Title'}
                    </th>
                    <th scope="col" className="p-3 w-20">
                      {lang === 'zh' ? '模式' : 'Mode'}
                    </th>
                    <th scope="col" className="p-3">
                      {lang === 'zh' ? '大纲简介片段' : 'Syllabus Preview'}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-theme bg-surface">
                  {previewImportData.map((row, rIdx) => (
                    <tr key={rIdx} className="hover:bg-surface-secondary/50">
                      <th
                        scope="row"
                        data-label={lang === 'zh' ? '课程名称' : 'Course Title'}
                        className="p-3 font-semibold text-main align-top truncate max-w-[150px] text-left"
                        title={row.title}
                      >
                        {row.title}
                      </th>
                      <td data-label={lang === 'zh' ? '模式' : 'Mode'} className="p-3 align-top whitespace-nowrap">
                        <span className="px-1.5 py-0.5 rounded bg-primary-theme-light border border-primary-theme/30 text-[10px] font-bold text-primary-ink">
                          {row.deliveryMode === 'xuean'
                            ? lang === 'zh'
                              ? '学案'
                              : 'Guided Study'
                            : lang === 'zh'
                              ? '白板'
                              : 'Whiteboard'}
                        </span>
                      </td>
                      <td
                        data-label={lang === 'zh' ? '大纲简介片段' : 'Syllabus Preview'}
                        className="p-3 text-muted font-mono text-xs leading-relaxed break-words"
                      >
                        {row.content.length > 150
                          ? row.content.substring(0, 150) + '...'
                          : row.content || <em className="text-subtle italic">None</em>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </AccessibleTableRegion>

            <div className="bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400 text-xs rounded-xl p-3 flex gap-2.5 items-start">
              <span className="text-base leading-none">⚠️</span>
              <p className="leading-relaxed">
                {lang === 'zh'
                  ? '请确认课程名称没有与系统已有的课程同名。确认无误后点击下方"开始导入"写入 SQLite。'
                  : 'Please ensure column details are accurate. Clicking Import will instantly commit all parsed courses into the server SQLite backend.'}
              </p>
            </div>
          </div>
        )}

        {/* IMPORTING state -> Show beautiful step progress */}
        {importStatus === 'importing' && packagePreview && (
          <div className="py-8 flex flex-col items-center justify-center space-y-4">
            <div className="relative w-20 h-20 flex items-center justify-center">
              <Loader2 size={36} className="text-primary-ink animate-spin" />
            </div>
            <div className="text-center">
              <h3 className="font-bold text-main text-sm">
                {lang === 'zh' ? '正在导入课程包' : 'Importing course package'}
              </h3>
              <p className="text-xs text-muted mt-1">
                {lang === 'zh'
                  ? `正在写入 ${packagePreview.segments} 个教学环节、${packagePreview.elements} 个白板元素与 ${packagePreview.assets} 份课件附件...`
                  : `Writing ${packagePreview.segments} segments, ${packagePreview.elements} elements and ${packagePreview.assets} assets...`}
              </p>
            </div>
            <div className="w-full max-w-md bg-surface-secondary rounded-xl p-3 border border-theme font-mono text-xs text-subtle">
              <div>{'[API] POST /api/course-packages/import -> single transaction...'}</div>
            </div>
          </div>
        )}

        {importStatus === 'importing' && !packagePreview && (
          <div className="py-8 flex flex-col items-center justify-center space-y-4">
            <div className="relative w-20 h-20 flex items-center justify-center">
              <Loader2 size={36} className="text-primary-ink animate-spin" />
              <span className="absolute text-xs font-extrabold text-primary-ink">
                {Math.round((importProgress / importProgressTotal) * 100)}%
              </span>
            </div>
            <div className="text-center">
              <h3 className="font-bold text-main text-sm">
                {lang === 'zh' ? '正在写入数据库' : 'Populating Database Records'}
              </h3>
              <p className="text-xs text-muted mt-1">
                {lang === 'zh'
                  ? `正在导入第 ${importProgress} / ${importProgressTotal} 项...`
                  : `Importing item ${importProgress} of ${importProgressTotal}...`}
              </p>
            </div>
            <div className="w-full max-w-sm bg-surface-secondary h-2 rounded-full overflow-hidden border border-theme">
              <div
                className="bg-primary-solid h-full transition-all duration-300 rounded-full"
                style={{ width: `${(importProgress / importProgressTotal) * 100}%` }}
              />
            </div>
            <div className="w-full max-w-md bg-surface-secondary rounded-xl p-3 border border-theme font-mono text-xs text-subtle max-h-[140px] overflow-y-auto">
              <div>{'[API] POST /api/lessons -> one request per course (no cross-course transaction)'}</div>
              {previewImportData.slice(0, importProgress).map((p, idx) => (
                <div key={idx} className="text-primary-ink font-bold mt-1">
                  {`✓ [${idx + 1}] "${p.title}" -> status 200 (Success)`}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* SUCCESS state -> Done */}
        {importStatus === 'success' && (
          <div className="py-8 text-center flex flex-col items-center justify-center space-y-4">
            <div className="w-16 h-16 bg-emerald-500/10 rounded-full flex items-center justify-center border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 animate-bounce">
              <CheckCircle2 size={32} />
            </div>
            <div>
              <h3 className="font-bold text-main text-base">
                {lang === 'zh' ? '🎉 批量导入大功告成' : '🎉 Bulk-Import Complete'}
              </h3>
              <p className="text-xs text-muted mt-1 max-w-md mx-auto">
                {packagePreview
                  ? lang === 'zh'
                    ? `课程包已导入：${packagePreview.segments} 个教学环节、${packagePreview.elements} 个白板元素、${packagePreview.assets} 份课件附件均已写入。`
                    : `Course package imported: ${packagePreview.segments} segments, ${packagePreview.elements} elements and ${packagePreview.assets} assets written.`
                  : lang === 'zh'
                    ? `所有 ${previewImportData.length} 门学科教案数据已顺畅写入系统底层 SQLite 数据仓库，现在已可以用于备课。`
                    : `All ${previewImportData.length} curriculum lessons records have been successfully saved into security logs and SQLite storage.`}
              </p>
            </div>
          </div>
        )}

        {/* ERROR state -> Display alerts */}
        {importStatus === 'error' && (
          <div className="space-y-4">
            {packageDuplicate ? (
              /* 命中去重（409）：这不是故障，而是「你已经导过这个包了」的确认。
                       展示已存在的课程，并给出「仍然导入副本」的出口。 */
              <div
                className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl flex gap-3 items-start"
                data-testid="course-package-duplicate-notice"
              >
                <span className="text-amber-600 font-bold text-lg leading-none">⧉</span>
                <div>
                  <h4 className="text-xs font-bold text-amber-700 dark:text-amber-400">
                    {lang === 'zh' ? '该课程包已经导入过了' : 'This course package was already imported'}
                  </h4>
                  <p className="text-xs text-amber-700 dark:text-amber-400 mt-1 leading-relaxed">
                    {lang === 'zh' ? (
                      <>
                        已存在课程「{packageDuplicate.lessonTitle}」
                        {packageDuplicate.hasDeclaredId ? '（同一个课程包 id）' : '（内容完全相同）'}，
                        再次导入会得到两节内容相同的课程。
                      </>
                    ) : (
                      <>
                        A lesson named &quot;{packageDuplicate.lessonTitle}&quot; already exists
                        {packageDuplicate.hasDeclaredId ? ' (same course-package id)' : ' (identical content)'}.
                        Importing again would create two lessons with the same content.
                      </>
                    )}
                  </p>
                </div>
              </div>
            ) : (
              <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-xl flex gap-3 items-start">
                <span className="text-rose-600 font-bold text-lg leading-none">⚠️</span>
                <div>
                  <h4 className="text-xs font-bold text-rose-700 dark:text-rose-400">
                    {lang === 'zh' ? '数据导入或解析中断' : 'Import or Parsing Error'}
                  </h4>
                  <p className="text-xs text-rose-700 dark:text-rose-400 mt-1 leading-relaxed">
                    {importErrorMsg ||
                      (lang === 'zh'
                        ? '未知异常或文件破损。'
                        : 'An unknown exception or corrupted CSV formatting occurred.')}
                  </p>
                </div>
              </div>
            )}

            <div className="flex gap-3 justify-end">
              {packageDuplicate ? (
                <>
                  <DialogButton
                    variant="secondary"
                    onClick={handlePackageDuplicateDismiss}
                    data-testid="course-package-duplicate-cancel"
                  >
                    {lang === 'zh' ? '取消' : 'Cancel'}
                  </DialogButton>
                  <DialogButton
                    variant="warning"
                    onClick={() => handlePackageImportSubmit(true)}
                    data-testid="course-package-duplicate-force"
                  >
                    {lang === 'zh' ? '仍然导入副本' : 'Import as a Copy Anyway'}
                  </DialogButton>
                </>
              ) : (
                <>
                  <DialogButton
                    variant="secondary"
                    onClick={() => {
                      setImportStatus('idle');
                      setImportErrorMsg('');
                    }}
                  >
                    {lang === 'zh' ? '返回重试' : 'Go Back & Retry'}
                  </DialogButton>
                  <DialogButton variant="primary" onClick={() => setIsImportLessonsOpen(false)}>
                    {lang === 'zh' ? '关闭窗口' : 'Close'}
                  </DialogButton>
                </>
              )}
            </div>
          </div>
        )}
      </DialogBody>

      {/* Footer */}
      {importStatus !== 'idle' && importStatus !== 'error' && (
        <DialogFooter className="justify-between">
          <DialogButton
            variant="secondary"
            onClick={() => {
              setPreviewImportData([]);
              setImportStatus('idle');
            }}
            disabled={importStatus === 'importing'}
          >
            {lang === 'zh' ? '重置重选' : 'Reset & Clear'}
          </DialogButton>
          <div className="flex items-center gap-2">
            <DialogButton
              variant="ghost"
              onClick={() => setIsImportLessonsOpen(false)}
              disabled={importStatus === 'importing'}
            >
              {lang === 'zh' ? '取消' : 'Cancel'}
            </DialogButton>
            {importStatus === 'parsing' && packagePreview && (
              <DialogButton
                variant="primary"
                onClick={() => handlePackageImportSubmit(false)}
                data-testid="import-course-package-btn"
              >
                <Check size={12} />
                {lang === 'zh' ? '导入课程包' : 'Import Course Package'}
              </DialogButton>
            )}
            {importStatus === 'parsing' && !packagePreview && (
              <DialogButton variant="primary" onClick={handleCSVImportSubmit}>
                <Check size={12} />
                {lang === 'zh'
                  ? `开始导入 (${previewImportData.length} 类)`
                  : `Proceed and Import (${previewImportData.length})`}
              </DialogButton>
            )}
            {importStatus === 'success' && (
              <DialogButton variant="primary" onClick={() => setIsImportLessonsOpen(false)}>
                {lang === 'zh' ? '完成' : 'Done'}
              </DialogButton>
            )}
          </div>
        </DialogFooter>
      )}
    </AccessibleDialog>
  );
}
