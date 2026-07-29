import React from 'react';
import { Download, Upload, FileSpreadsheet, Plus, AlertCircle } from 'lucide-react';
import type { ClassType } from '../types';

export interface TimetableImportExportViewProps {
  lang: 'zh' | 'en';
  classes: ClassType[];
  getClassDisplayName: (name: string) => string;
  handleExportCSV: () => void;
  handleExportJSON: () => void;
  importClassId: string;
  setImportClassId: (id: string) => void;
  csvText: string;
  setCsvText: (text: string) => void;
  importMessage: { type: 'success' | 'error'; text: string } | null;
  handleImportData: () => Promise<void>;
}

export const TimetableImportExportView: React.FC<TimetableImportExportViewProps> = ({
  lang,
  classes,
  getClassDisplayName,
  handleExportCSV,
  handleExportJSON,
  importClassId,
  setImportClassId,
  csvText,
  setCsvText,
  importMessage,
  handleImportData
}) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
      {/* Export panel */}
      <div className="bg-slate-50/50 border border-slate-200 rounded-xl p-5 flex flex-col justify-between">
        <div>
          <h3 className="text-sm font-bold text-gray-800 flex items-center gap-2 border-b border-slate-100 pb-2.5 mb-3">
            <Download className="text-green-600" size={16} />
            {lang === 'zh' ? '导出系统课表' : 'Export Timetables'}
          </h3>
          <p className="text-xs text-gray-500 mb-4 leading-relaxed">
            {lang === 'zh' 
              ? '把系统中当前排定的所有班级课表一键备份成标准 CSV 或 JSON 文件。您可以使用 Excel 便捷编辑修改后再导入回来。' 
              : 'Download the compiled records from SQLite memory db into standard JSON or CSV sheet formats.'}
          </p>
        </div>

        <div className="flex gap-2.5 mt-4">
          <button 
            onClick={handleExportCSV}
            className="flex-1 bg-white hover:bg-slate-50 text-slate-800 border border-slate-250 font-bold text-xs py-2 rounded-lg cursor-pointer transition-all flex justify-center items-center gap-1"
          >
            <FileSpreadsheet className="text-green-600" size={13} />
            {lang === 'zh' ? '导出为 Excel CSV' : 'Export CSV Sheet'}
          </button>
          <button 
            onClick={handleExportJSON}
            className="flex-1 bg-white hover:bg-slate-50 text-slate-800 border border-slate-250 font-bold text-xs py-2 rounded-lg cursor-pointer transition-all flex justify-center items-center gap-1"
          >
            <FileSpreadsheet className="text-amber-500" size={13} />
            {lang === 'zh' ? '导出为 JSON 树' : 'Export JSON Data'}
          </button>
        </div>
      </div>

      {/* Import panel */}
      <div className="bg-slate-50/50 border border-slate-200 rounded-xl p-5 flex flex-col gap-3">
        <h3 className="text-sm font-bold text-gray-800 flex items-center gap-2 border-b border-slate-100 pb-2.5">
          <Upload className="text-indigo-600" size={16} />
          {lang === 'zh' ? '导入课表流程' : 'Import New Schedule'}
        </h3>
        
        <div className="flex flex-col gap-3">
          <div>
            <label className="block text-[10px] uppercase font-bold text-gray-500 mb-1">{lang === 'zh' ? '分配排定给哪一个班级 *' : 'Target Class to load schedules *'}</label>
            <select 
              id="import_class_select"
              title="Import Target Class"
              className="w-full bg-white border border-gray-200 rounded-lg text-xs p-2 text-gray-750 cursor-pointer focus:outline-hidden"
              value={importClassId}
              onChange={e => setImportClassId(e.target.value)}
            >
              <option value="">{lang === 'zh' ? '选择班级...' : 'Select Class...'}</option>
              {classes.map(c => <option key={c.id} value={c.id}>{getClassDisplayName(c.name)}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-[10px] uppercase font-bold text-gray-500 mb-1">
              {lang === 'zh' ? '粘贴 CSV 数据内容' : 'Paste CSV data rows'}
            </label>
            <textarea 
              rows={4}
              placeholder={lang === 'zh' ? "date,lesson_id,time_slot,status,notes\n2026-06-15,les-1,09:00 - 10:30,scheduled,首节授课\n2026-06-16,les-2,10:45 - 12:15,holiday,假期放假停课" : "date,lesson_id,time_slot,status,notes\n2026-06-15,les-1,09:00 - 10:30,scheduled,First Class"}
              className="w-full bg-white border border-gray-250 text-xs p-2 rounded-lg font-mono placeholder:text-gray-350 focus:outline-hidden"
              value={csvText}
              onChange={e => setCsvText(e.target.value)}
            />
            <span className="text-[10px] text-gray-400 mt-1 block">
              {lang === 'zh' 
                ? '首行必须为属性列（支持：date, lesson_id, time_slot, status, notes）。支持复制 JSON 树粘贴直接解析。' 
                : 'Ensure first line consists of column keys (date, lesson_id, time_slots).'}
            </span>
          </div>

          {importMessage && (
            <div className={`p-2.5 rounded-lg text-xs border flex items-center gap-1.5 ${importMessage.type === 'error' ? 'bg-red-50 border-red-200 text-red-700' : 'bg-green-50 border-green-200 text-green-700'}`}>
              <AlertCircle size={14} />
              <span>{importMessage.text}</span>
            </div>
          )}

          <button 
            onClick={handleImportData}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs py-2 rounded-lg cursor-pointer transition-all flex items-center justify-center gap-1 shadow-xs"
          >
            <Plus size={13} />
            {lang === 'zh' ? '开始解析并安全导入' : 'Execute Schema Check & Upload'}
          </button>
        </div>
      </div>
    </div>
  );
};
