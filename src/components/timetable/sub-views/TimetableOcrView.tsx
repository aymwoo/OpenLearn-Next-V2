import React from 'react';
import {
  Camera,
  Sparkles,
  ImagePlus,
  X,
  Eye,
  Loader2,
  ScanLine,
  XCircle,
  CheckCircle2,
  Check
} from 'lucide-react';
import type { ClassType } from '../types';

export interface TimetableOcrViewProps {
  lang: 'zh' | 'en';
  ocrProviderId: string;
  setOcrProviderId: (id: string) => void;
  aiProviders: { id: string; name: string; model_name: string }[];
  ocrFileInputRef: React.RefObject<HTMLInputElement | null>;
  handleOcrDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  handleOcrImageSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  ocrImagePreview: string | null;
  setOcrImagePreview: (url: string | null) => void;
  setOcrImageBase64: (base64: string | null) => void;
  setOcrEntries: (entries: any[]) => void;
  setOcrMessage: (msg: { type: 'success' | 'error' | 'info'; text: string } | null) => void;
  setOcrSelectedEntries: (entries: Set<number>) => void;
  ocrImageBase64: string | null;
  ocrLoading: boolean;
  handleOcrRecognize: () => Promise<void>;
  ocrProgressStatus: string;
  ocrProgress: number;
  ocrMessage: { type: 'success' | 'error' | 'info'; text: string } | null;
  ocrEntries: any[];
  ocrSelectedEntries: Set<number>;
  toggleAllOcrEntries: () => void;
  toggleOcrEntry: (idx: number) => void;
  dayNames: Record<number, string>;
  findMatchedClass: (classNameStr: string) => ClassType | undefined;
  handleOcrImport: () => Promise<void>;
  ocrImporting: boolean;
}

export const TimetableOcrView: React.FC<TimetableOcrViewProps> = ({
  lang,
  ocrProviderId,
  setOcrProviderId,
  aiProviders,
  ocrFileInputRef,
  handleOcrDrop,
  handleOcrImageSelect,
  ocrImagePreview,
  setOcrImagePreview,
  setOcrImageBase64,
  setOcrEntries,
  setOcrMessage,
  setOcrSelectedEntries,
  ocrImageBase64,
  ocrLoading,
  handleOcrRecognize,
  ocrProgressStatus,
  ocrProgress,
  ocrMessage,
  ocrEntries,
  ocrSelectedEntries,
  toggleAllOcrEntries,
  toggleOcrEntry,
  dayNames,
  findMatchedClass,
  handleOcrImport,
  ocrImporting
}) => {
  return (
    <div className="flex flex-col gap-5">
      {/* Step 1: Upload Image */}
      <div className="bg-slate-50/50 border border-slate-200 rounded-2xl p-5">
        <h2 className="text-base font-bold text-slate-800 flex items-center gap-2 border-b border-slate-200 pb-3 mb-4">
          <Camera className="text-violet-500 shrink-0" size={18} />
          {lang === 'zh' ? '第一步：上传课表图片' : 'Step 1: Upload Timetable Image'}
        </h2>
        <p className="text-xs text-gray-500 mb-4 leading-relaxed">
          {lang === 'zh' 
            ? '拍照或截图您的纸质/电子课表，AI 将自动识别课程信息并生成结构化数据。支持 PNG、JPG 格式，建议图片清晰、文字可辨。' 
            : 'Upload a photo or screenshot of your timetable. AI will automatically recognize class information and generate structured data.'}
        </p>

        {/* AI Provider Selector */}
        <div className="mb-4 p-3 bg-white rounded-xl border border-slate-200">
          <label className="block text-xs font-semibold text-gray-700 mb-1.5 flex items-center gap-1.5">
            <Sparkles size={12} className="text-violet-500" />
            {lang === 'zh' ? 'AI 识别引擎' : 'AI Recognition Engine'}
          </label>
          <select
            title="OCR AI Provider"
            className="w-full bg-slate-50 border border-gray-200 rounded-lg text-xs p-2.5 text-gray-750 cursor-pointer focus:outline-hidden focus:ring-1 focus:ring-violet-500"
            value={ocrProviderId}
            onChange={e => setOcrProviderId(e.target.value)}
          >
            <option value="">{lang === 'zh' ? '默认 (Gemini)' : 'Default (Gemini)'}</option>
            {aiProviders.map(p => (
              <option key={p.id} value={p.id}>{p.name} ({p.model_name})</option>
            ))}
          </select>
          <span className="text-[10px] text-gray-400 mt-1 block">
            {lang === 'zh' ? '选择用于识别课表图片的 AI 模型。需要支持图片输入的模型（如 GPT-4o、Gemini 等）。' : 'Choose the AI model for timetable recognition. Must support vision/image input.'}
          </span>
        </div>

        <div className="flex flex-col sm:flex-row gap-4">
          {/* Upload Area */}
          <div 
            className="flex-1 border-2 border-dashed border-slate-300 rounded-xl p-6 flex flex-col items-center justify-center gap-3 cursor-pointer hover:border-violet-400 hover:bg-violet-50/30 transition-all group"
            onClick={() => ocrFileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onDrop={handleOcrDrop}
          >
            <input 
              ref={ocrFileInputRef}
              type="file" 
              accept="image/png,image/jpeg,image/jpg,image/webp"
              className="hidden"
              onChange={handleOcrImageSelect}
            />
            <ImagePlus className="text-slate-400 group-hover:text-violet-500 transition-colors" size={36} />
            <span className="text-xs font-semibold text-slate-500 group-hover:text-violet-600 transition-colors">
              {lang === 'zh' ? '点击选择、拖拽图片至此处 或 Ctrl+V 粘贴截图' : 'Click, drag & drop, or Ctrl+V to paste screenshot'}
            </span>
            <span className="text-[10px] text-slate-400">
              {lang === 'zh' ? '支持 PNG / JPG / JPEG / WebP，最大 20MB' : 'Supports PNG / JPG / JPEG / WebP, max 20MB'}
            </span>
          </div>

          {/* Image Preview */}
          {ocrImagePreview && (
            <div className="flex-1 relative rounded-xl overflow-hidden border border-slate-200 bg-white shadow-sm">
              <img 
                src={ocrImagePreview} 
                alt="Timetable preview" 
                className="w-full h-full object-contain max-h-[280px]"
              />
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setOcrImagePreview(null);
                  setOcrImageBase64(null);
                  setOcrEntries([]);
                  setOcrMessage(null);
                  setOcrSelectedEntries(new Set());
                  if (ocrFileInputRef.current) ocrFileInputRef.current.value = '';
                }}
                className="absolute top-2 right-2 bg-black/50 hover:bg-black/70 text-white p-1.5 rounded-lg transition-colors cursor-pointer"
                title={lang === 'zh' ? '移除图片' : 'Remove image'}
              >
                <X size={14} />
              </button>
              <div className="absolute bottom-2 left-2 bg-black/50 text-white text-[10px] px-2 py-1 rounded-lg flex items-center gap-1">
                <Eye size={10} />
                {lang === 'zh' ? '课表预览' : 'Preview'}
              </div>
            </div>
          )}
        </div>

        {/* Recognize Button */}
        <button
          onClick={handleOcrRecognize}
          disabled={!ocrImageBase64 || ocrLoading}
          className="mt-4 w-full bg-violet-600 hover:bg-violet-700 disabled:bg-slate-300 text-white font-bold text-xs py-2.5 rounded-xl cursor-pointer transition-all flex items-center justify-center gap-2 shadow-sm disabled:cursor-not-allowed"
        >
          {ocrLoading ? (
            <>
              <Loader2 className="animate-spin" size={14} />
              {lang === 'zh' ? 'AI 识别中，请稍候...' : 'AI recognizing...'}
            </>
          ) : (
            <>
              <ScanLine size={14} />
              {lang === 'zh' ? '开始 AI 智能识别' : 'Start AI Recognition'}
            </>
          )}
        </button>
      </div>

      {/* Progress Display */}
      {ocrLoading && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2.5 animate-in fade-in duration-200 text-left">
          <div className="flex justify-between items-center text-xs">
            <span className="font-semibold text-slate-700">{ocrProgressStatus}</span>
            <span className="font-mono font-bold text-indigo-600">{ocrProgress}%</span>
          </div>
          <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden shrink-0">
            <div 
              className="h-full bg-gradient-to-r from-violet-500 to-indigo-600 transition-all duration-300 rounded-full"
              style={{ width: `${ocrProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* Status Message */}
      {ocrMessage && (
        <div className={`p-3 rounded-xl text-xs border flex items-start gap-2 ${
          ocrMessage.type === 'error' 
            ? 'bg-red-50 border-red-200 text-red-700' 
            : ocrMessage.type === 'success'
              ? 'bg-green-50 border-green-200 text-green-700'
              : 'bg-blue-50 border-blue-200 text-blue-700'
        }`}>
          {ocrMessage.type === 'error' ? <XCircle size={14} className="shrink-0 mt-0.5" /> 
            : ocrMessage.type === 'success' ? <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
            : <ScanLine size={14} className="shrink-0 mt-0.5 animate-pulse" />}
          <span>{ocrMessage.text}</span>
        </div>
      )}

      {/* Step 2: Review Recognized Results */}
      {ocrEntries.length > 0 && (
        <div className="bg-slate-50/50 border border-slate-200 rounded-2xl p-5">
          <h2 className="text-base font-bold text-slate-800 flex items-center gap-2 border-b border-slate-200 pb-3 mb-4">
            <CheckCircle2 className="text-emerald-500 shrink-0" size={18} />
            {lang === 'zh' ? '第二步：审核识别结果' : 'Step 2: Review Recognized Entries'}
          </h2>
          <p className="text-xs text-gray-500 mb-3">
            {lang === 'zh' 
              ? '以下是 AI 从课表图片中识别出的课程安排，请勾选需要导入的条目。'
              : 'Below are the class entries recognized by AI. Select the ones you want to import.'}
          </p>

          {/* Select All */}
          <div className="flex items-center justify-between mb-3">
            <label className="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer select-none">
              <input 
                type="checkbox"
                checked={ocrSelectedEntries.size === ocrEntries.length}
                onChange={toggleAllOcrEntries}
                className="accent-violet-600 cursor-pointer rounded"
              />
              {lang === 'zh' ? `全选 (${ocrSelectedEntries.size}/${ocrEntries.length})` : `Select All (${ocrSelectedEntries.size}/${ocrEntries.length})`}
            </label>
            <span className="text-[10px] text-slate-400">
              {lang === 'zh' ? '取消勾选可排除不需要导入的条目' : 'Uncheck to exclude entries from import'}
            </span>
          </div>

          {/* Entries Table */}
          <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
            <table className="w-full text-left border-collapse table-auto text-xs bg-white">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-gray-600 font-semibold text-[10px] uppercase tracking-wide">
                  <th className="p-2.5 w-[40px] text-center">✓</th>
                  <th className="p-2.5">{lang === 'zh' ? '星期' : 'Day'}</th>
                  <th className="p-2.5">{lang === 'zh' ? '节次' : 'Period'}</th>
                  <th className="p-2.5">{lang === 'zh' ? '班级' : 'Class'}</th>
                  <th className="p-2.5">{lang === 'zh' ? '科目' : 'Subject'}</th>
                  <th className="p-2.5">{lang === 'zh' ? '时间段' : 'Time'}</th>
                  <th className="p-2.5">{lang === 'zh' ? '教室' : 'Room'}</th>
                  <th className="p-2.5">{lang === 'zh' ? '教师' : 'Teacher'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {ocrEntries.map((entry, idx) => (
                  <tr 
                    key={idx} 
                    className={`hover:bg-violet-50/30 transition-colors cursor-pointer ${
                      ocrSelectedEntries.has(idx) ? 'bg-violet-50/20' : 'opacity-50'
                    }`}
                    onClick={() => toggleOcrEntry(idx)}
                  >
                    <td className="p-2.5 text-center">
                      <input 
                        type="checkbox"
                        checked={ocrSelectedEntries.has(idx)}
                        onChange={() => toggleOcrEntry(idx)}
                        onClick={(e) => e.stopPropagation()}
                        className="accent-violet-600 cursor-pointer"
                      />
                    </td>
                    <td className="p-2.5 font-medium">
                      <span className="inline-block bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded-md text-[10px] font-bold">
                        {dayNames[entry.dayOfWeek] || `Day${entry.dayOfWeek}`}
                      </span>
                    </td>
                    <td className="p-2.5">
                      <span className="inline-block bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded-md text-[10px] font-bold">
                        {lang === 'zh' ? `第${entry.periodNumber}节` : `P${entry.periodNumber}`}
                      </span>
                    </td>
                    <td className="p-2.5 font-semibold text-slate-800">{entry.className || '-'}</td>
                    <td className="p-2.5">
                      <span className="inline-block bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded-md text-[10px] font-bold">
                        {entry.subject || '-'}
                      </span>
                    </td>
                    <td className="p-2.5 font-mono text-slate-600">{entry.timeSlot || '-'}</td>
                    <td className="p-2.5 text-slate-600">{entry.location || '-'}</td>
                    <td className="p-2.5 text-slate-600">{entry.teacherName || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Step 3: Import Settings */}
      {ocrEntries.length > 0 && (
        <div className="bg-slate-50/50 border border-slate-200 rounded-2xl p-5">
          <h2 className="text-base font-bold text-slate-800 flex items-center gap-2 border-b border-slate-200 pb-3 mb-4">
            <CheckCircle2 className="text-emerald-500 shrink-0" size={18} />
            {lang === 'zh' ? '第三步：确认导入日程' : 'Step 3: Confirm Import'}
          </h2>

          {(() => {
            const today = new Date();
            const day = today.getDay();
            const diff = today.getDate() - day + (day === 0 ? -6 : 1);
            const monday = new Date(today.setDate(diff));
            const mondayDate = monday.toISOString().split('T')[0];

            const selectedItems = ocrEntries.filter((_, i) => ocrSelectedEntries.has(i));
            const unmatchedClasses = new Set<string>();
            let matchedCount = 0;
            selectedItems.forEach(entry => {
              const matched = findMatchedClass(entry.className || '');
              if (matched) {
                matchedCount++;
              } else if (entry.className) {
                unmatchedClasses.add(entry.className.trim());
              }
            });

            return (
              <div className="flex flex-col gap-4 mb-4">
                <div className="p-3.5 bg-indigo-50 border border-indigo-100 rounded-xl text-xs leading-relaxed">
                  <div className="font-semibold text-indigo-900 flex items-center gap-1.5 mb-1.5">
                    <Sparkles size={14} className="text-indigo-600 animate-pulse" />
                    {lang === 'zh' ? '智能自动匹配规则' : 'Intelligent Auto-Mapping'}
                  </div>
                  <div className="text-gray-650 space-y-1">
                    <div>• {lang === 'zh' ? `本周起始日期（周一）：${mondayDate}` : `Week Start Date (Monday): ${mondayDate}`}</div>
                    <div>• {lang === 'zh' ? '班级匹配：系统将根据识别到的班级名称自动导入至系统中对应班级。若班级不存在，将自动创建。' : 'Class Matching: System will automatically import entries into matched classes or create new classes on the fly.'}</div>
                  </div>
                </div>

                <div className="text-xs">
                  <div className="font-semibold text-gray-700">
                    {lang === 'zh' 
                      ? `已选择 ${selectedItems.length} 条记录，其中 ${matchedCount} 条可直接匹配到系统班级。` 
                      : `${selectedItems.length} entries selected, ${matchedCount} matched existing classes.`}
                  </div>
                  {unmatchedClasses.size > 0 && (
                    <div className="mt-2 p-2.5 bg-violet-50 border border-violet-200 text-violet-800 rounded-lg leading-relaxed">
                      💡 {lang === 'zh' 
                        ? `以下识别出的班级在系统中暂不存在，导入时将自动创建：${Array.from(unmatchedClasses).join(', ')}` 
                        : `The following recognized classes do not exist and will be automatically created on import: ${Array.from(unmatchedClasses).join(', ')}.`}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          <button
            onClick={handleOcrImport}
            disabled={ocrImporting || ocrSelectedEntries.size === 0}
            className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white font-bold text-xs py-2.5 rounded-xl cursor-pointer transition-all flex items-center justify-center gap-2 shadow-sm disabled:cursor-not-allowed"
          >
            {ocrImporting ? (
              <>
                <Loader2 className="animate-spin" size={14} />
                {lang === 'zh' ? '正在导入...' : 'Importing...'}
              </>
            ) : (
              <>
                <Check size={14} />
                {lang === 'zh' ? `确认导入选中的 ${ocrSelectedEntries.size} 条课程` : `Import ${ocrSelectedEntries.size} Selected Entries`}
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
};
