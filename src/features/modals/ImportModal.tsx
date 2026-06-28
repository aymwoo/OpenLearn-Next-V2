import React from 'react';
import { Upload, Download, FileIcon, Check, Loader2 } from 'lucide-react';

interface ImportModalProps {
  show: boolean;
  onClose: () => void;
  lang: string;
  handleImportFile: (file: File) => Promise<void>;
  importError: string | null;
  importSuccess: string | null;
  isImporting: boolean;
  downloadCSVTemplate: (type: 'class' | 'student') => void;
}

export function ImportModal({ show, onClose, lang, handleImportFile, importError, importSuccess, isImporting, downloadCSVTemplate }: ImportModalProps) {
  if (!show) return null;
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 font-sans text-gray-800">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg flex flex-col p-6 relative">
        <button type="button" onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 text-xl font-medium cursor-pointer">&times;</button>

        <h3 className="text-base font-semibold text-gray-900 mb-1 flex items-center gap-2">
          <Upload size={18} className="text-indigo-600" />
          {lang === 'zh' ? '手动批量导入数据' : 'Manual Bulk Import'}
        </h3>
        <p className="text-xs text-gray-500 mb-4 font-sans text-left">
          {lang === 'zh'
            ? '支持导入 CSV 或 JSON 文件。CSV 文件需包含标题行，建议格式如下（支持中英文标题）：'
            : 'Supports CSV or JSON files. CSV requires a header line with names like:'}
        </p>

        <div className="bg-gray-50 p-3 rounded-lg border border-gray-100 text-[10px] font-mono text-gray-600 mb-4 whitespace-nowrap overflow-x-auto select-all text-left">
          班级名称, 班级描述, 学生姓名, 学生邮箱<br />
          高一A班, 基础英语课程, 李明, liming@example.com<br />
          高一A班, 基础英语课程, 王华, wanghua@example.com
        </div>

        <div className="mb-4 flex flex-col gap-2 p-3 bg-indigo-50/50 border border-indigo-100 rounded-lg text-left select-none">
          <span className="text-xs font-semibold text-indigo-900 flex items-center gap-1">
            <Download size={13} className="text-indigo-600" />
            {lang === 'zh' ? '下载导入数据模板文件：' : 'Download Import Templates:'}
          </span>
          <div className="flex flex-col sm:flex-row gap-2 mt-1">
            <button type="button" onClick={() => downloadCSVTemplate('class')} className="flex-1 flex items-center justify-center gap-1.5 text-xs px-2.5 py-2 bg-white border border-indigo-200 text-indigo-700 rounded-lg hover:bg-indigo-50 transition-colors shadow-sm font-medium cursor-pointer">
              <FileIcon size={12} className="text-emerald-600" />
              {lang === 'zh' ? '下载班级与学生模板' : 'Class & Students Template'}
            </button>
            <button type="button" onClick={() => downloadCSVTemplate('student')} className="flex-1 flex items-center justify-center gap-1.5 text-xs px-2.5 py-2 bg-white border border-indigo-200 text-indigo-700 rounded-lg hover:bg-indigo-50 transition-colors shadow-sm font-medium cursor-pointer">
              <FileIcon size={12} className="text-emerald-600" />
              {lang === 'zh' ? '下载独立学生模板' : 'Independent Students Template'}
            </button>
          </div>
        </div>

        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (!e.dataTransfer.files || e.dataTransfer.files.length === 0) return;
            handleImportFile(e.dataTransfer.files[0]);
          }}
          className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center cursor-pointer hover:border-indigo-500 hover:bg-indigo-50/20 transition-all mb-4"
          onClick={() => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.csv,.json';
            input.onchange = (e: any) => { if (e.target.files?.[0]) handleImportFile(e.target.files[0]); };
            input.click();
          }}
        >
          <Upload className="mx-auto text-gray-400 mb-2" size={24} />
          <p className="text-xs font-semibold text-gray-700">{lang === 'zh' ? '点击选择文件 或 拖拽文件到这里' : 'Click to select file or drag it here'}</p>
          <p className="text-[10px] text-gray-400 mt-1">CSV or JSON (max 5MB)</p>
        </div>

        {importError && (
          <div className="p-3 bg-red-50 border border-red-100 text-red-700 text-xs rounded-lg mb-4 flex items-start gap-2 max-h-32 overflow-y-auto">
            <span className="font-bold shrink-0">✕</span><span className="font-sans text-left leading-tight break-all">{importError}</span>
          </div>
        )}
        {importSuccess && (
          <div className="p-3 bg-green-50 border border-green-105 text-green-700 text-xs rounded-lg mb-4 flex items-start gap-2">
            <Check size={14} className="shrink-0 mt-0.5" /><span className="font-sans text-left leading-tight">{importSuccess}</span>
          </div>
        )}
        {isImporting && (
          <div className="flex items-center justify-center gap-2 text-indigo-600 text-xs py-2">
            <Loader2 size={16} className="animate-spin" />
            <span>{lang === 'zh' ? '正在分析数据并导入系统数据库...' : 'Validating data and transferring records...'}</span>
          </div>
        )}

        <div className="flex justify-end gap-2 mt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-xs font-medium border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors cursor-pointer">
            {lang === 'zh' ? '关闭' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
}
