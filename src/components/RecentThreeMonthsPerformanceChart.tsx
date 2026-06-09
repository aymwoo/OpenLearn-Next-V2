import React, { useState, useMemo } from 'react';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ReferenceLine, 
  ResponsiveContainer
} from 'recharts';
import { 
  TrendingUp, 
  Award, 
  BookOpen, 
  Calendar, 
  CheckCircle2, 
  AlertCircle,
  Clock,
  Filter,
  BarChart2,
  ListFilter
} from 'lucide-react';

interface GradedAssignment {
  id: string;
  class_id?: string;
  title: string;
  description?: string;
  content: string;
  class_name: string;
  submission_status: string;
  score: number | null;
  feedback: string | null;
  submitted_at: number | null;
  graded_at?: number;
  created_at?: number;
}

interface RecentThreeMonthsPerformanceChartProps {
  assignments: GradedAssignment[];
  lang?: 'en' | 'zh';
}

export function RecentThreeMonthsPerformanceChart({ assignments = [], lang = 'en' }: RecentThreeMonthsPerformanceChartProps) {
  const [filterMode, setFilterMode] = useState<'3months' | 'all'>('3months');
  const [selectedClass, setSelectedClass] = useState<string>('all');
  const [showGrid, setShowGrid] = useState<boolean>(true);
  const [showAvgLine, setShowAvgLine] = useState<boolean>(true);

  // Time calculations
  const { filteredAssignments, dateRangeLabel, stats } = useMemo(() => {
    // 1. Filter, resolve scores, and resolve timestamps
    const withScores = assignments
      .filter(ast => ast.submission_status === 'graded' && typeof ast.score === 'number' && ast.score !== null)
      .map(ast => {
        const scoreVal = ast.score as number;
        // Determine the best timestamp representing the evaluation
        const actionTime = ast.graded_at || ast.submitted_at || ast.created_at || Date.now();
        return {
          ...ast,
          resolvedScore: scoreVal,
          actionTime
        };
      })
      .sort((a, b) => a.actionTime - b.actionTime);

    // 2. We look back 3 months (90 days) from current anchor time (June 8, 2026)
    const anchorTime = Date.now();
    const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
    const limitTime = anchorTime - ninetyDaysMs;

    // Filter by class first if requested
    let afterClassFilter = withScores;
    if (selectedClass !== 'all') {
      afterClassFilter = withScores.filter(ast => ast.class_name === selectedClass);
    }

    // 3. Filter by last 3 months if toggled
    const filtered = filterMode === '3months' 
      ? afterClassFilter.filter(ast => ast.actionTime >= limitTime)
      : afterClassFilter;

    // Standard date strings
    const startDateStr = new Date(limitTime).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const endDateStr = new Date(anchorTime).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const dateLabel = lang === 'zh' 
      ? `学段范围: ${startDateStr} 至 ${endDateStr} (最近 90 天)` 
      : `Date Range: ${startDateStr} to ${endDateStr} (Last 90 Days)`;

    // Calculate details for Recharts
    const chartData = filtered.map((ast, idx) => {
      const dateObj = new Date(ast.actionTime);
      const formattedDate = dateObj.toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric' });
      const fullDate = dateObj.toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      
      return {
        id: ast.id,
        index: idx + 1,
        title: ast.title.replace('MCQ Evaluation: ', '').replace('评估: ', ''),
        fullTitle: ast.title,
        score: ast.resolvedScore,
        className: ast.class_name,
        dateLabel: formattedDate,
        fullDateLabel: fullDate,
        feedback: ast.feedback || (lang === 'zh' ? '无' : 'No comments provided'),
        gradedAtStr: ast.graded_at ? new Date(ast.graded_at).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US') : ''
      };
    });

    // Compute stats
    const scores = chartData.map(d => d.score);
    const sum = scores.reduce((acc, s) => acc + s, 0);
    const average = scores.length > 0 ? Math.round(sum / scores.length) : 0;
    const highest = scores.length > 0 ? Math.max(...scores) : 0;
    const total = scores.length;
    const passing = scores.filter(s => s >= 60).length;

    return {
      filteredAssignments: chartData,
      dateRangeLabel: dateLabel,
      stats: { average, highest, total, passing }
    };
  }, [assignments, filterMode, selectedClass, lang]);

  // Extract classes from all graded assignments for full filtering drop-down
  const uniqueClassesList = useMemo(() => {
    const classNames = new Set<string>();
    assignments.forEach(ast => {
      if (ast.submission_status === 'graded' && ast.class_name) {
        classNames.add(ast.class_name);
      }
    });
    return Array.from(classNames);
  }, [assignments]);

  return (
    <div className="bg-white border border-gray-200 rounded-2xl shadow-sm hover:shadow-md transition-all overflow-hidden flex flex-col font-sans mb-6" id="three-months-performance-line-chart">
      {/* Chart Header */}
      <div className="p-5 border-b border-gray-100 bg-linear-to-r from-rose-50/20 via-white to-pink-50/15 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="p-2.5 bg-rose-50 text-rose-600 rounded-xl mt-0.5 shadow-xs">
            <Clock size={20} className="stroke-[2.5]" />
          </div>
          <div>
            <h3 className="font-extrabold text-gray-950 text-base flex items-center gap-2">
              <span>{lang === 'zh' ? '近3个月作业成绩分析' : 'Recent 3-Month Progress Chart'}</span>
              <span className="inline-flex items-center gap-0.5 bg-rose-50 text-rose-700 border border-rose-100 rounded-full px-2 py-0.5 text-[9px] font-bold">
                {lang === 'zh' ? '90天回顾' : '90 Days Review'}
              </span>
            </h3>
            <p className="text-gray-500 text-xs mt-0.5">{dateRangeLabel}</p>
          </div>
        </div>

        {/* Quick controls */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Filter Range select */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-bold text-gray-500 flex items-center gap-1">
              <ListFilter size={12} className="text-gray-400" />
              {lang === 'zh' ? '过滤范围:' : 'Scope:'}
            </span>
            <div className="inline-flex border border-gray-200 rounded-lg p-0.5 bg-white shadow-2xs">
              <button
                onClick={() => setFilterMode('3months')}
                className={`px-2.5 py-1 text-[10px] font-bold rounded-md transition-all cursor-pointer ${filterMode === '3months' ? 'bg-rose-600 text-white' : 'text-gray-500 hover:text-gray-800'}`}
              >
                {lang === 'zh' ? '近 3 个月' : 'Last 3 Months'}
              </button>
              <button
                onClick={() => setFilterMode('all')}
                className={`px-2.5 py-1 text-[10px] font-bold rounded-md transition-all cursor-pointer ${filterMode === 'all' ? 'bg-rose-600 text-white' : 'text-gray-500 hover:text-gray-800'}`}
              >
                {lang === 'zh' ? '全部记录' : 'All Graded'}
              </button>
            </div>
          </div>

          {/* Class Filters */}
          {uniqueClassesList.length > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-gray-500 flex items-center gap-1">
                <Filter size={12} className="text-gray-400" />
                {lang === 'zh' ? '班级:' : 'Class:'}
              </span>
              <select
                value={selectedClass}
                onChange={(e) => setSelectedClass(e.target.value)}
                className="bg-white border border-gray-200 text-xs text-gray-700 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-rose-500 font-semibold shadow-2xs"
              >
                <option value="all">{lang === 'zh' ? '全部班级' : 'All Classes'}</option>
                {uniqueClassesList.map((cls, idx) => (
                  <option key={idx} value={cls}>{cls}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Basic summary metrics for the selected set */}
      <div className="px-5 py-3.5 border-b border-gray-100 bg-white grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-3 bg-rose-50/10 rounded-xl border border-rose-100/30 flex flex-col">
          <span className="text-[10px] font-bold text-gray-450 uppercase tracking-wider">{lang === 'zh' ? '平均成绩' : 'Avg. Score'}</span>
          <span className="text-xl font-extrabold text-rose-950 font-mono mt-0.5">{stats.average}%</span>
        </div>
        <div className="p-3 bg-amber-50/10 rounded-xl border border-amber-100/30 flex flex-col">
          <span className="text-[10px] font-bold text-gray-450 uppercase tracking-wider">{lang === 'zh' ? '最高分数' : 'Peak Score'}</span>
          <span className="text-xl font-extrabold text-amber-950 font-mono mt-0.5">{stats.highest}%</span>
        </div>
        <div className="p-3 bg-indigo-50/10 rounded-xl border border-indigo-100/30 flex flex-col">
          <span className="text-[10px] font-bold text-gray-450 uppercase tracking-wider">{lang === 'zh' ? '作业评阅数' : 'Graded Count'}</span>
          <span className="text-xl font-extrabold text-indigo-950 font-mono mt-0.5">{stats.total}</span>
        </div>
        <div className="p-3 bg-emerald-50/10 rounded-xl border border-emerald-100/30 flex flex-col">
          <span className="text-[10px] font-bold text-gray-450 uppercase tracking-wider">{lang === 'zh' ? '及格件数' : 'Passing Works'}</span>
          <span className="text-xl font-extrabold text-emerald-950 font-mono mt-0.5">{stats.passing}</span>
        </div>
      </div>

      {/* Chart Canvas Area */}
      <div className="p-5">
        {filteredAssignments.length === 0 ? (
          <div className="text-center py-10 bg-slate-50/50 rounded-xl border border-dashed border-slate-200">
            <AlertCircle size={28} className="mx-auto text-slate-300 mb-2" />
            <h4 className="text-gray-800 text-xs font-bold">{lang === 'zh' ? '近3个月没有已评分的作业记录' : 'No Graded Submissions in the past 3 months'}</h4>
            <p className="text-gray-400 text-[10px] mt-1 px-4 max-w-sm mx-auto">
              {lang === 'zh' 
                ? '暂无符合检索时间窗的评语或测验成绩。您可以点击“全部记录”进行查询，或交办新作业让名师或AI进行极速评分。' 
                : 'No performance updates were logged during this period. Try switching to "All Graded" to see historic trends, or complete pending tasks now!'}
            </p>
          </div>
        ) : (
          <div className="h-[240px] w-full relative">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={filteredAssignments}
                margin={{ top: 15, right: 15, left: -22, bottom: 5 }}
              >
                <defs>
                  <linearGradient id="roseLineGrad" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#f43f5e" />
                    <stop offset="60%" stopColor="#ec4899" />
                    <stop offset="100%" stopColor="#d946ef" />
                  </linearGradient>
                </defs>
                {showGrid && <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />}
                <XAxis 
                  dataKey="dateLabel" 
                  tick={{ fontSize: 9, fill: '#64748b', fontWeight: 'bold' }} 
                  axisLine={{ stroke: '#e2e8f0' }} 
                  tickLine={false}
                />
                <YAxis 
                  domain={[0, 100]} 
                  tick={{ fontSize: 9, fill: '#64748b', fontWeight: 'bold' }} 
                  axisLine={{ stroke: '#e2e8f0' }} 
                  tickLine={false}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const d = payload[0].payload;
                      return (
                        <div className="p-3 bg-white/95 border border-rose-100 rounded-xl shadow-xl max-w-[260px] backdrop-blur-xs font-sans">
                          <div className="flex items-center justify-between gap-2 border-b border-gray-100 pb-1 mb-1 border-opacity-50">
                            <span className="text-[9px] text-gray-400 font-bold uppercase font-mono">{d.className}</span>
                            <span className="inline-flex items-center bg-rose-50 text-rose-700 px-2 py-0.5 rounded-full text-[10px] font-bold font-mono border border-rose-100">
                              {d.score}%
                            </span>
                          </div>
                          <p className="text-xs font-bold text-slate-800 leading-snug">{d.fullTitle}</p>
                          <p className="text-[9px] text-slate-400 mt-1">{d.fullDateLabel}</p>
                          {d.gradedAtStr && (
                            <p className="text-[9px] text-rose-500 font-mono mt-0.5">
                              {lang === 'zh' ? `测评时间: ${d.gradedAtStr}` : `Reviewed: ${d.gradedAtStr}`}
                            </p>
                          )}
                          {d.feedback && (
                            <div className="mt-2 bg-rose-50/40 p-1.5 rounded border border-rose-100/50">
                              <span className="text-[8px] font-bold text-rose-800 uppercase block tracking-wider mb-0.5">
                                {lang === 'zh' ? '随堂反馈意见' : 'FEEDBACK'}
                              </span>
                              <p className="text-[10px] text-slate-600 italic">"{d.feedback}"</p>
                            </div>
                          )}
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                {showAvgLine && stats.total > 0 && (
                  <ReferenceLine 
                    y={stats.average} 
                    stroke="#db2777" 
                    strokeWidth={1.2}
                    strokeDasharray="4 4" 
                    label={{ 
                      value: lang === 'zh' ? `近期平均 (${stats.average}%)` : `Recent Avg (${stats.average}%)`, 
                      fill: '#db2777', 
                      fontSize: 8, 
                      fontWeight: 'bold',
                      position: 'top',
                      offset: 3
                    }} 
                  />
                )}
                <Line 
                  type="monotone" 
                  dataKey="score" 
                  stroke="url(#roseLineGrad)" 
                  strokeWidth={3.5} 
                  dot={{ r: 5, stroke: '#ffffff', strokeWidth: 2, fill: '#ec4899' }}
                  activeDot={{ r: 7, stroke: '#ffffff', strokeWidth: 2, fill: '#f43f5e' }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}
