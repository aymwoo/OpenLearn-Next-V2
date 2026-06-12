import React, { useMemo, useState } from 'react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Cell
} from 'recharts';
import { 
  Sparkles, 
  UserCheck, 
  History, 
  Info,
  ArrowUpDown,
  UserPlus
} from 'lucide-react';

interface RollCallStat {
  student_id: string;
  student_name: string;
  count: number;
  last_picked_time: number | null;
}

interface RollCallHistoryStatsChartProps {
  rollcallStats: RollCallStat[];
  lang?: 'en' | 'zh';
}

export function RollCallHistoryStatsChart({ 
  rollcallStats = [], 
  lang = 'en' 
}: RollCallHistoryStatsChartProps) {
  const [sortBy, setSortBy] = useState<'count-desc' | 'count-asc' | 'name'>('count-desc');

  // Process data based on sorting preference
  const processedData = useMemo(() => {
    const list = [...rollcallStats];
    if (sortBy === 'count-desc') {
      return list.sort((a, b) => b.count - a.count || a.student_name.localeCompare(b.student_name));
    } else if (sortBy === 'count-asc') {
      return list.sort((a, b) => a.count - b.count || a.student_name.localeCompare(b.student_name));
    } else {
      return list.sort((a, b) => a.student_name.localeCompare(b.student_name));
    }
  }, [rollcallStats, sortBy]);

  // Aggregate values
  const statsSummary = useMemo(() => {
    if (rollcallStats.length === 0) return { totalPicks: 0, maxPicks: 0, minPicks: 0, neverPickedCount: 0 };
    
    let totalPicks = 0;
    let maxPicks = 0;
    let minPicks = Infinity;
    let neverPickedCount = 0;

    rollcallStats.forEach(item => {
      totalPicks += item.count;
      if (item.count > maxPicks) maxPicks = item.count;
      if (item.count < minPicks) minPicks = item.count;
      if (item.count === 0) neverPickedCount++;
    });

    return {
      totalPicks,
      maxPicks,
      minPicks: minPicks === Infinity ? 0 : minPicks,
      neverPickedCount
    };
  }, [rollcallStats]);

  const formatDate = (timestamp: number | null) => {
    if (!timestamp) {
      return lang === 'zh' ? '从未被抽中' : 'Never picked';
    }
    try {
      const date = new Date(timestamp);
      if (isNaN(date.getTime())) return lang === 'zh' ? '从未被抽中' : 'Never picked';
      return date.toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });
    } catch {
      return lang === 'zh' ? '从未被抽中' : 'Never picked';
    }
  };

  if (rollcallStats.length === 0) {
    return (
      <div className="bg-white border border-gray-100 rounded-xl p-6 shadow-xs flex flex-col items-center justify-center min-h-[220px] text-center select-none">
        <History className="text-gray-300 mb-2 animate-pulse" size={28} />
        <span className="text-xs font-semibold text-gray-500 font-sans block mb-1">
          {lang === 'zh' ? '暂无提问点名记录' : 'No Random Roll Call Records'}
        </span>
        <span className="text-[10px] text-gray-400 max-w-sm">
          {lang === 'zh' ? '在互动白板中启动“随机点名”工具抽选并确认学生参与后，统计报表将自动在此关联更新。' : 'Analytics will populate once you trigger student pick roll-calls in the interactive whiteboard.'}
        </span>
      </div>
    );
  }

  // Multi-color gradient array index generator so the bars look vibrant
  const getBarColor = (count: number) => {
    if (count === 0) return '#cbd5e1'; // slate-300
    if (count >= 5) return '#f59e0b'; // amber-500
    if (count >= 3) return '#6366f1'; // indigo-500
    return '#10b981'; // emerald-500
  };

  return (
    <div className="bg-white border border-slate-100 rounded-xl p-4 shadow-xs flex flex-col gap-4 font-sans mt-2 mb-6" id="rollcall-stats-tracker-card">
      {/* Header Info */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-100 pb-3">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-amber-50 text-amber-600 rounded-lg shrink-0">
            <Sparkles size={16} className="animate-spin text-amber-500 stroke-[2.5]" style={{ animationDuration: '3s' }} />
          </div>
          <div className="text-left">
            <h4 className="text-sm font-bold text-gray-850 flex items-center gap-2">
              <span>{lang === 'zh' ? '课堂随机提问点名历史统计' : 'Random Pick Roll Call Statistics'}</span>
              <span className="inline-flex bg-amber-100 text-amber-900 text-[8.5px] px-2 py-0.5 rounded-full font-black uppercase tracking-wide">
                {lang === 'zh' ? '白板互动数据' : 'Live Interaction Source'}
              </span>
            </h4>
            <p className="text-[10px] text-gray-400">
              {lang === 'zh' ? '统计全班学生在各课节互动提问中被抽中的总频次及最近时间戳' : 'A review tracking historical selection frequencies and time-stamps of pupils in active lessons'}
            </p>
          </div>
        </div>

        {/* Aggregated Summary Row */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div className="bg-slate-50/50 p-1.5 px-3 rounded-lg border border-slate-100 text-slate-600 flex items-center gap-1">
            <span className="text-[9.5px] text-slate-400 uppercase font-bold tracking-wider">{lang === 'zh' ? '总点名次数' : 'Total Drawn'}:</span>
            <span className="font-black text-indigo-650 font-mono">{statsSummary.totalPicks}</span>
          </div>
          <div className="bg-slate-50/50 p-1.5 px-3 rounded-lg border border-slate-100 text-slate-600 flex items-center gap-1">
            <span className="text-[9.5px] text-slate-400 uppercase font-bold tracking-wider">{lang === 'zh' ? '峰值次数' : 'Max Count'}:</span>
            <span className="font-black text-amber-600 font-mono">{statsSummary.maxPicks}</span>
          </div>
          {statsSummary.neverPickedCount > 0 && (
            <div className="bg-orange-50/60 p-1.5 px-3 rounded-lg border border-orange-100/50 text-orange-700 flex items-center gap-1">
              <span className="text-[9.5px] text-orange-400 uppercase font-bold tracking-wider">{lang === 'zh' ? '未抽中人数' : 'Unpicked'}:</span>
              <span className="font-black font-mono">{statsSummary.neverPickedCount}</span>
            </div>
          )}
        </div>
      </div>

      {/* Roster Diagnostic Information Bars */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 bg-linear-to-r from-slate-50/40 via-white to-slate-50/45 p-3 rounded-xl border border-slate-100/80 text-xs">
        <div className="flex items-start gap-2.5 text-left">
          <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg shrink-0 mt-0.5">
            <UserCheck size={14} className="stroke-[2.5]" />
          </div>
          <div>
            <span className="text-[8.5px] font-black uppercase text-gray-400 tracking-wider block">
              {lang === 'zh' ? 'Lucky Coins / 提问热选者' : 'Highest Engagement Spot'}
            </span>
            <p className="mt-0.5 text-[11px] text-slate-600">
              {statsSummary.maxPicks > 0 ? (
                <>
                  {lang === 'zh' ? '本班最常被抽中学生为 ' : 'Most drawn student is '}
                  <span className="font-extrabold text-indigo-700">
                    {rollcallStats
                      .filter(s => s.count === statsSummary.maxPicks)
                      .map(s => s.student_name)
                      .join(', ')}
                  </span>
                  {lang === 'zh' ? `（${statsSummary.maxPicks}次）` : ` (${statsSummary.maxPicks} times)`}
                </>
              ) : (
                lang === 'zh' ? '暂未触发点名记录' : 'No selections recorded yet'
              )}
            </p>
          </div>
        </div>

        <div className="flex items-start gap-2.5 text-left border-t md:border-t-0 md:border-l border-slate-150 pt-3 md:pt-0 md:pl-4">
          <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg shrink-0 mt-0.5">
            <UserPlus size={14} className="stroke-[2.5]" />
          </div>
          <div>
            <span className="text-[8.5px] font-black uppercase text-gray-400 tracking-wider block">
              {lang === 'zh' ? 'Focus Booster / 重视提醒区' : 'Silent / Spotlight Areas'}
            </span>
            <p className="mt-0.5 text-[11px] text-slate-600">
              {statsSummary.neverPickedCount > 0 ? (
                <>
                  {lang === 'zh' ? '有 ' : 'There are '}
                  <span className="font-extrabold text-emerald-600 font-mono">{statsSummary.neverPickedCount}</span>
                  {lang === 'zh' ? ' 位学生还未被点过，包括: ' : ' student(s) never selected, including: '}
                  <span className="font-bold text-slate-700">
                    {rollcallStats
                      .filter(s => s.count === 0)
                      .slice(0, 4)
                      .map(s => s.student_name)
                      .join(', ')}
                  </span>
                  {statsSummary.neverPickedCount > 4 && '...'}
                </>
              ) : (
                lang === 'zh' ? '全班所有学生均已在白板互动中被抽中提问！达成完美均衡。' : 'All students have been selected in the whiteboard sessions!'
              )}
            </p>
          </div>
        </div>
      </div>

      {/* Sorting Buttons */}
      <div className="flex items-center justify-between">
        <div className="flex bg-slate-100 p-0.5 rounded-lg select-none shrink-0 self-start">
          <button
            type="button"
            onClick={() => setSortBy('count-desc')}
            className={`px-3 py-1.5 text-[10px] font-extrabold rounded-md transition-all cursor-pointer flex items-center gap-1 ${
              sortBy === 'count-desc'
                ? 'bg-white text-indigo-700 shadow-3xs font-black border-indigo-50'
                : 'text-slate-500 hover:text-slate-850'
            }`}
          >
            <ArrowUpDown size={10} />
            <span>{lang === 'zh' ? '频数由高到低' : 'Most Picked'}</span>
          </button>
          <button
            type="button"
            onClick={() => setSortBy('count-asc')}
            className={`px-3 py-1.5 text-[10px] font-extrabold rounded-md transition-all cursor-pointer flex items-center gap-1 ${
              sortBy === 'count-asc'
                ? 'bg-white text-indigo-700 shadow-3xs font-black border-indigo-50'
                : 'text-slate-500 hover:text-slate-850'
            }`}
          >
            <ArrowUpDown size={10} />
            <span>{lang === 'zh' ? '频数由低到高' : 'Least Picked'}</span>
          </button>
          <button
            type="button"
            onClick={() => setSortBy('name')}
            className={`px-3 py-1.5 text-[10px] font-extrabold rounded-md transition-all cursor-pointer flex items-center gap-1 ${
              sortBy === 'name'
                ? 'bg-white text-indigo-700 shadow-3xs font-black border-indigo-50'
                : 'text-slate-500 hover:text-slate-850'
            }`}
          >
            <ArrowUpDown size={10} />
            <span>{lang === 'zh' ? '拼音姓名排序' : 'By Name'}</span>
          </button>
        </div>

        <div className="text-[9.5px] text-gray-400 italic font-mono flex items-center gap-1">
          <Info size={11} className="text-gray-400" />
          <span>{lang === 'zh' ? '💡 鼠标悬浮查看最近一次被选日期' : '💡 Hover bar for exact last selection date'}</span>
        </div>
      </div>

      {/* Bar Chart Representation */}
      <div className="h-56 w-full mt-1">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={processedData} margin={{ top: 15, right: 10, left: -25, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
            <XAxis 
              dataKey="student_name" 
              tick={{ fontSize: 9.5, fill: '#64748b', fontWeight: 'bold' }}
              axisLine={{ stroke: '#e2e8f0' }}
              tickLine={false}
            />
            <YAxis 
              allowDecimals={false}
              tick={{ fontSize: 9.5, fill: '#64748b', fontWeight: 'bold' }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              cursor={{ fill: '#f1f5f9', opacity: 0.5 }}
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  const data = payload[0].payload as RollCallStat;
                  return (
                    <div className="bg-white border border-slate-150 p-2.5 rounded-xl shadow-xl font-sans text-xs flex flex-col gap-1.5 max-w-[260px] text-left">
                      <div className="font-extrabold text-slate-800 border-b border-slate-100 pb-1 mb-1 flex items-center justify-between gap-4">
                        <span className="truncate">{data.student_name}</span>
                        <span className="text-[8.5px] bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded font-black uppercase shrink-0">
                          {lang === 'zh' ? '参会指数' : 'Live Index'}
                        </span>
                      </div>
                      
                      <div className="flex justify-between gap-4 text-slate-600 font-sans">
                        <span className="text-slate-400 font-medium">{lang === 'zh' ? '累计抽中提问' : 'Selection Counts'}:</span>
                        <span className="font-black text-slate-800 font-mono">{data.count} {lang === 'zh' ? '次' : 'times'}</span>
                      </div>

                      <div className="flex flex-col gap-0.5 text-slate-650 border-t border-slate-100 pt-1.5 mt-0.5 font-sans">
                        <span className="text-slate-400 font-bold text-[9px] uppercase">{lang === 'zh' ? '最近被抽中时间' : 'Last Selection Stamp'}:</span>
                        <span className="font-bold text-indigo-700 text-[10.5px] font-mono leading-tight">
                          {formatDate(data.last_picked_time)}
                        </span>
                      </div>
                    </div>
                  );
                }
                return null;
              }}
            />
            <Bar 
              dataKey="count" 
              radius={[3, 3, 0, 0]}
              maxBarSize={32}
            >
              {processedData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={getBarColor(entry.count)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
