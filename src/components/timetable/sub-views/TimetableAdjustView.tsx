import React from 'react';
import { Sparkles, Loader2, RotateCcw } from 'lucide-react';

export interface TimetableAdjustViewProps {
  lang: 'zh' | 'en';
  holStartDate: string;
  setHolStartDate: (date: string) => void;
  holEndDate: string;
  setHolEndDate: (date: string) => void;
  holType: 'holiday' | 'cancelled';
  setHolType: (type: 'holiday' | 'cancelled') => void;
  holNotes: string;
  setHolNotes: (notes: string) => void;
  handleBatchHolidayAdjustment: () => Promise<void>;
  loading: boolean;
}

export const TimetableAdjustView: React.FC<TimetableAdjustViewProps> = ({
  lang,
  holStartDate,
  setHolStartDate,
  holEndDate,
  setHolEndDate,
  holType,
  setHolType,
  holNotes,
  setHolNotes,
  handleBatchHolidayAdjustment,
  loading
}) => {
  return (
    <div className="max-w-2xl mx-auto bg-slate-50/50 border border-slate-200 rounded-2xl p-6 shadow-3xs">
      <h2 className="text-base font-bold text-slate-800 flex items-center gap-2 border-b border-slate-200 pb-3 mb-4">
        <Sparkles className="text-amber-500 shrink-0" size={18} />
        {lang === 'zh' ? '批量节假日调休排班' : 'Holiday / Cancellation Scheduler'}
      </h2>
      <p className="text-xs text-gray-500 mb-5">
        {lang === 'zh' 
          ? '此工具能快速把选定日期范围内的课程一键设为“假期调休”或“统一停课”，避免讲师依次手动调整，极大提高教务效率。' 
          : 'Instantly cancel or exclude classes falling within a holiday or default break period.'}
      </p>

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">{lang === 'zh' ? '开始日期 *' : 'Start Date *'}</label>
            <input 
              type="date"
              className="w-full border border-gray-200 rounded-lg text-xs p-2.5 bg-white focus:outline-hidden focus:ring-1 focus:ring-indigo-500 transition-all font-sans text-gray-750"
              value={holStartDate}
              onChange={e => setHolStartDate(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">{lang === 'zh' ? '结束日期 *' : 'End Date *'}</label>
            <input 
              type="date"
              className="w-full border border-gray-200 rounded-lg text-xs p-2.5 bg-white focus:outline-hidden focus:ring-1 focus:ring-indigo-500 transition-all font-sans text-gray-750"
              value={holEndDate}
              onChange={e => setHolEndDate(e.target.value)}
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1.5">{lang === 'zh' ? '调整状态标签' : 'Target Status'}</label>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
              <input 
                type="radio" 
                name="holType" 
                checked={holType === 'holiday'} 
                onChange={() => setHolType('holiday')}
                className="accent-indigo-600 cursor-pointer"
              />
              🏝️ {lang === 'zh' ? '假期调休 (Holiday)' : 'Holiday Exclusion'}
            </label>
            <label className="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
              <input 
                type="radio" 
                name="holType" 
                checked={holType === 'cancelled'} 
                onChange={() => setHolType('cancelled')}
                className="accent-red-600 cursor-pointer"
              />
              🛑 {lang === 'zh' ? '异常停课 (Cancelled)' : 'Suspicious Cancellation'}
            </label>
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1.5">{lang === 'zh' ? '假日说明 / 停课备注' : 'Exclusion Note / Reason'}</label>
          <input 
            type="text"
            placeholder={lang === 'zh' ? '例: 国庆节假期停课调休 / 因极寒气象全市停课' : 'e.g., National Day break / weather closures'}
            className="w-full border border-gray-200 rounded-lg text-xs p-2.5 bg-white focus:outline-hidden focus:ring-1 focus:ring-indigo-500 transition-all"
            value={holNotes}
            onChange={e => setHolNotes(e.target.value)}
          />
        </div>

        <button 
          onClick={handleBatchHolidayAdjustment}
          disabled={loading}
          className="w-full bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs py-2.5 rounded-xl cursor-pointer transition-all flex items-center justify-center gap-1.5 shadow-sm disabled:opacity-50"
        >
          {loading ? <Loader2 className="animate-spin" size={14} /> : <RotateCcw size={14} />}
          {lang === 'zh' ? '一键更新该周期课表' : 'Execute Batch Holiday Updates'}
        </button>
      </div>
    </div>
  );
};
