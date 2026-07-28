import { Dispatch, SetStateAction } from 'react';
import { motion } from 'motion/react';
import { Upload, Download, Loader2, CheckCircle2, Check } from 'lucide-react';

export interface ImportRow {
  title: string;
  content: string;
}

export type ImportStatus = 'idle' | 'parsing' | 'importing' | 'success' | 'error';

export interface ImportLessonsModalProps {
  isImportLessonsOpen: boolean;
  setIsImportLessonsOpen: (v: boolean) => void;
  lang: 'zh' | 'en';
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
}

export function ImportLessonsModal(props: ImportLessonsModalProps) {
  const {
    isImportLessonsOpen,
    setIsImportLessonsOpen,
    lang,
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
  } = props;

  return (
    <>
      {isImportLessonsOpen && (
        <div className="fixed inset-0 bg-gray-900/50 backdrop-blur-sm flex items-center justify-center p-4 md:p-6 z-50 overflow-y-auto text-gray-850">
          <motion.div
            initial={{ opacity: 0, y: 15, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            className="bg-white border text-gray-900 border-gray-250 rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col overflow-hidden max-h-[90vh] font-sans text-left"
          >
            {/* Header */}
            <div className="p-4 md:p-5 border-b border-gray-100 flex items-center justify-between bg-slate-50 shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-indigo-50 border border-indigo-100 rounded-lg text-indigo-650">
                  <Upload size={20} className="animate-pulse" />
                </div>
                <div>
                  <h2 className="font-bold text-gray-850 text-base md:text-lg">
                    {lang === 'zh' ? '批量导入课程 (CSV)' : 'Bulk-Import Courses (CSV)'}
                  </h2>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {lang === 'zh' ? '上传包含标准表头的 CSV 教案，一键实现秒级批量底库写入。' : 'Upload a standard CSV file matching our predefined schema to perform instantaneous bulk curriculum imports.'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  if (importStatus !== 'importing') {
                    setIsImportLessonsOpen(false);
                  }
                }}
                disabled={importStatus === 'importing'}
                className="text-gray-400 hover:text-gray-650 font-bold p-1 rounded-lg hover:bg-gray-150 transition-all text-xl leading-none disabled:opacity-40"
              >
                &times;
              </button>
            </div>

            {/* Modal Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              
              {/* IDLE state -> Drag and Drop zone */}
              {importStatus === 'idle' && (
                <div className="space-y-4">
                  {/* Schema instructions */}
                  <div className="p-4 bg-indigo-50/50 border border-indigo-100 rounded-xl">
                    <h4 className="text-xs font-bold text-indigo-850 uppercase tracking-wide flex items-center gap-1">
                      <span>📌</span>
                      {lang === 'zh' ? '预定义数据格式说明' : 'Predefined Schema Information'}
                    </h4>
                    <p className="text-xs text-indigo-900 mt-1 leading-relaxed">
                      {lang === 'zh' 
                        ? 'CSV 文件的首行必须 define 列标题（分大小写且无多余空格），包含以下两项必需内容：' 
                        : 'Your CSV file must include exactly these header columns on the first row (case-insensitive):'}
                    </p>
                    <ul className="list-disc pl-5 mt-2 text-xs text-indigo-950 space-y-1">
                      <li><strong>title</strong>: {lang === 'zh' ? '课程名 (非空，例如 "代数几何")' : 'Course title (Required, e.g. "Linear Algebra")'}</li>
                      <li><strong>content</strong>: {lang === 'zh' ? '教学大纲 / Markdown 格式的课堂细目' : 'Syllabus content supporting rich markdown.'}</li>
                    </ul>
                    <div className="mt-3.5 flex justify-start">
                      <button
                        onClick={downloadCsvTemplate}
                        className="flex items-center gap-1 p-2 text-xs font-bold text-indigo-700 bg-white border border-indigo-200 rounded-lg shadow-3xs hover:bg-indigo-50 hover:-translate-y-0.5 hover:shadow-xs transition-all cursor-pointer"
                      >
                        <Download size={12} />
                        {lang === 'zh' ? '获取标准 CSV 模板' : 'Download Template CSV'}
                      </button>
                    </div>
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
                        handleCSVFileChange(e.dataTransfer.files[0]);
                      }
                    }}
                    onClick={() => {
                      document.getElementById('import-csv-file-picker')?.click();
                    }}
                    className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all flex flex-col items-center justify-center min-h-[180px] ${
                      isDraggingImport
                        ? 'border-indigo-500 bg-indigo-50/70 scale-[1.01]'
                        : 'border-gray-250 bg-gray-50/50 hover:bg-gray-50 hover:border-indigo-400'
                    }`}
                  >
                    <input
                      id="import-csv-file-picker"
                      type="file"
                      accept=".csv"
                      className="hidden"
                      onChange={(e) => {
                        if (e.target.files && e.target.files[0]) {
                          handleCSVFileChange(e.target.files[0]);
                        }
                      }}
                    />
                    <div className="p-3 bg-gray-100 border border-gray-200 rounded-full text-indigo-600 mb-3 group-hover:scale-105 transition-all">
                      <Upload size={24} />
                    </div>
                    <span className="text-sm font-bold text-gray-800">
                      {lang === 'zh' ? '选择 CSV 文件或拖放至此处' : 'Click to select or drag and drop CSV file here'}
                    </span>
                    <span className="text-xs text-gray-400 mt-1">
                      {lang === 'zh' ? '支持标准 CSV 文件，最大不超过 5MB' : 'Supports standard CSV format up to 5MB'}
                    </span>
                  </div>
                </div>
              )}

              {/* PARSING state -> Show Preview of file */}
              {importStatus === 'parsing' && previewImportData.length > 0 && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">
                      ✓ {lang === 'zh' ? `解析成功：查找到 ${previewImportData.length} 门课程` : `Parsed Successfully: Found ${previewImportData.length} records`}
                    </span>
                    <button
                      onClick={() => {
                        setPreviewImportData([]);
                        setImportStatus('idle');
                      }}
                      className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold"
                    >
                      {lang === 'zh' ? '重新上传' : 'Upload Different File'}
                    </button>
                  </div>

                  <div className="border border-gray-200 rounded-xl overflow-hidden shadow-3xs max-h-[300px] overflow-y-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="bg-gray-50 text-gray-600 border-b border-gray-200 font-bold">
                        <tr>
                          <th className="p-3 w-1/4">{lang === 'zh' ? '课程名称' : 'Course Title'}</th>
                          <th className="p-3 w-3/4">{lang === 'zh' ? '大纲简介片段' : 'Syllabus Preview'}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 bg-white">
                        {previewImportData.map((row, rIdx) => (
                          <tr key={rIdx} className="hover:bg-slate-50/50">
                            <td className="p-3 font-semibold text-gray-800 align-top truncate max-w-[150px]" title={row.title}>
                              {row.title}
                            </td>
                            <td className="p-3 text-gray-500 font-mono text-[11px] leading-relaxed break-words col-span-2">
                              {row.content.length > 150 ? row.content.substring(0, 150) + '...' : row.content || <em className="text-gray-300 italic">None</em>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="bg-amber-50 border border-amber-100 text-amber-900 text-xs rounded-xl p-3 flex gap-2.5 items-start">
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
              {importStatus === 'importing' && (
                <div className="py-8 flex flex-col items-center justify-center space-y-4">
                  <div className="relative w-20 h-20 flex items-center justify-center">
                    <Loader2 size={36} className="text-indigo-600 animate-spin" />
                    <span className="absolute text-[11px] font-extrabold text-indigo-700">
                      {Math.round((importProgress / importProgressTotal) * 100)}%
                    </span>
                  </div>
                  <div className="text-center">
                    <h3 className="font-bold text-gray-800 text-sm">
                      {lang === 'zh' ? '正在写入数据库' : 'Populating Database Records'}
                    </h3>
                    <p className="text-xs text-gray-500 mt-1">
                      {lang === 'zh' 
                        ? `正在导入第 ${importProgress} / ${importProgressTotal} 项...` 
                        : `Importing item ${importProgress} of ${importProgressTotal}...`}
                    </p>
                  </div>
                  <div className="w-full max-w-sm bg-gray-100 h-2 rounded-full overflow-hidden border border-gray-200">
                    <div 
                      className="bg-indigo-600 h-full transition-all duration-300 rounded-full" 
                      style={{ width: `${(importProgress / importProgressTotal) * 100}%` }}
                    />
                  </div>
                  <div className="w-full max-w-md bg-gray-50 rounded-xl p-3 border border-gray-150 font-mono text-[10px] text-gray-400 max-h-[140px] overflow-y-auto">
                    <div>{"[API] POST /api/lessons -> Request batch transaction..."}</div>
                    {previewImportData.slice(0, importProgress).map((p, idx) => (
                      <div key={idx} className="text-indigo-600 font-bold mt-1">
                        {`✓ [${idx+1}] "${p.title}" -> status 200 (Success)`}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* SUCCESS state -> Done */}
              {importStatus === 'success' && (
                <div className="py-8 text-center flex flex-col items-center justify-center space-y-4">
                  <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center border border-emerald-200 text-emerald-600 animate-bounce">
                    <CheckCircle2 size={32} />
                  </div>
                  <div>
                    <h3 className="font-bold text-gray-800 text-base">
                      {lang === 'zh' ? '🎉 批量导入大功告成' : '🎉 Bulk-Import Complete'}
                    </h3>
                    <p className="text-xs text-gray-500 mt-1 max-w-md mx-auto">
                      {lang === 'zh' 
                        ? `所有 ${previewImportData.length} 门学科教案数据已顺畅写入系统底层 SQLite 数据仓库，现在已可以用于备课。` 
                        : `All ${previewImportData.length} curriculum lessons records have been successfully saved into security logs and SQLite storage.`}
                    </p>
                  </div>
                </div>
              )}

              {/* ERROR state -> Display alerts */}
              {importStatus === 'error' && (
                <div className="space-y-4">
                  <div className="p-4 bg-rose-50 border border-rose-100 rounded-xl flex gap-3 items-start">
                    <span className="text-rose-600 font-bold text-lg leading-none">⚠️</span>
                    <div>
                      <h4 className="text-xs font-bold text-rose-850">
                        {lang === 'zh' ? '数据导入或解析中断' : 'Import or Parsing Error'}
                      </h4>
                      <p className="text-xs text-rose-900 mt-1 leading-relaxed">
                        {importErrorMsg || (lang === 'zh' ? '未知异常或文件破损。' : 'An unknown exception or corrupted CSV formatting occurred.')}
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-3 justify-end">
                    <button
                      onClick={() => {
                        setImportStatus('idle');
                        setImportErrorMsg('');
                      }}
                      className="px-4 py-2 text-xs font-bold text-gray-700 bg-white border border-gray-250 cursor-pointer hover:bg-gray-50 rounded-lg transition-all"
                    >
                      {lang === 'zh' ? '返回重试' : 'Go Back & Retry'}
                    </button>
                    <button
                      onClick={() => setIsImportLessonsOpen(false)}
                      className="px-4 py-2 text-xs font-bold text-white bg-indigo-600 cursor-pointer hover:bg-indigo-700 rounded-lg transition-all"
                    >
                      {lang === 'zh' ? '关闭窗口' : 'Close'}
                    </button>
                  </div>
                </div>
              )}

            </div>

            {/* Footer */}
            {importStatus !== 'idle' && importStatus !== 'error' && (
              <div className="p-4 md:p-5 border-t border-gray-100 flex items-center justify-between bg-slate-50 shrink-0">
                <button
                  onClick={() => {
                    setPreviewImportData([]);
                    setImportStatus('idle');
                  }}
                  disabled={importStatus === 'importing'}
                  className="px-4 py-2 text-xs font-bold text-gray-650 bg-white border border-gray-200 hover:bg-gray-100 rounded-lg transition-all disabled:opacity-40 cursor-pointer"
                >
                  {lang === 'zh' ? '重置重选' : 'Reset & Clear'}
                </button>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setIsImportLessonsOpen(false)}
                    disabled={importStatus === 'importing'}
                    className="px-4 py-2 text-xs font-bold text-gray-600 hover:text-gray-800 transition-all disabled:opacity-40 cursor-pointer"
                  >
                    {lang === 'zh' ? '取消' : 'Cancel'}
                  </button>
                  {importStatus === 'parsing' && (
                    <button
                      onClick={handleCSVImportSubmit}
                      className="px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm transition-all flex items-center gap-1 cursor-pointer"
                    >
                      <Check size={12} />
                      {lang === 'zh' ? `开始导入 (${previewImportData.length} 类)` : `Proceed and Import (${previewImportData.length})`}
                    </button>
                  )}
                  {importStatus === 'success' && (
                    <button
                      onClick={() => setIsImportLessonsOpen(false)}
                      className="px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm transition-all cursor-pointer"
                    >
                      {lang === 'zh' ? '完成' : 'Done'}
                    </button>
                  )}
                </div>
              </div>
            )}

          </motion.div>
        </div>
      )}
    </>
  );
}
