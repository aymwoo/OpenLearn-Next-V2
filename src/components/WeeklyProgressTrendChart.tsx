import React, { useState, useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import {
  TrendingUp,
  Award,
  Calendar,
  CheckCircle2,
  AlertCircle,
  Filter,
  BarChart2,
  Sparkles,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Layers,
  HelpCircle,
} from 'lucide-react';

export interface GradedAssignment {
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

export interface WeeklyProgressTrendChartProps {
  assignments?: GradedAssignment[];
  lang?: 'en' | 'zh';
}

interface WeekDataPoint {
  weekKey: string;
  weekLabel: string;
  dateRange: string;
  averageScore: number;
  assignmentsCount: number;
  highestScore: number;
  lowestScore: number;
  targetScore: number;
  trendDiff: number | null;
  status: 'excellent' | 'good' | 'average' | 'needs_work';
}

// Realistic demo trajectory when student has no historical graded works yet
const DEMO_WEEKLY_PROGRESS: WeekDataPoint[] = [
  {
    weekKey: 'W1',
    weekLabel: 'Week 1',
    dateRange: 'Apr 06 - Apr 12',
    averageScore: 74.5,
    assignmentsCount: 2,
    highestScore: 78,
    lowestScore: 71,
    targetScore: 80,
    trendDiff: null,
    status: 'average',
  },
  {
    weekKey: 'W2',
    weekLabel: 'Week 2',
    dateRange: 'Apr 13 - Apr 19',
    averageScore: 78.0,
    assignmentsCount: 3,
    highestScore: 82,
    lowestScore: 75,
    targetScore: 80,
    trendDiff: 3.5,
    status: 'good',
  },
  {
    weekKey: 'W3',
    weekLabel: 'Week 3',
    dateRange: 'Apr 20 - Apr 26',
    averageScore: 81.5,
    assignmentsCount: 3,
    highestScore: 86,
    lowestScore: 77,
    targetScore: 80,
    trendDiff: 3.5,
    status: 'good',
  },
  {
    weekKey: 'W4',
    weekLabel: 'Week 4',
    dateRange: 'Apr 27 - May 03',
    averageScore: 79.0,
    assignmentsCount: 4,
    highestScore: 84,
    lowestScore: 72,
    targetScore: 80,
    trendDiff: -2.5,
    status: 'average',
  },
  {
    weekKey: 'W5',
    weekLabel: 'Week 5',
    dateRange: 'May 04 - May 10',
    averageScore: 85.0,
    assignmentsCount: 3,
    highestScore: 90,
    lowestScore: 80,
    targetScore: 80,
    trendDiff: 6.0,
    status: 'excellent',
  },
  {
    weekKey: 'W6',
    weekLabel: 'Week 6',
    dateRange: 'May 11 - May 17',
    averageScore: 88.5,
    assignmentsCount: 4,
    highestScore: 93,
    lowestScore: 84,
    targetScore: 80,
    trendDiff: 3.5,
    status: 'excellent',
  },
  {
    weekKey: 'W7',
    weekLabel: 'Week 7',
    dateRange: 'May 18 - May 24',
    averageScore: 91.0,
    assignmentsCount: 3,
    highestScore: 95,
    lowestScore: 87,
    targetScore: 80,
    trendDiff: 2.5,
    status: 'excellent',
  },
  {
    weekKey: 'W8',
    weekLabel: 'Week 8',
    dateRange: 'May 25 - May 31',
    averageScore: 93.5,
    assignmentsCount: 4,
    highestScore: 98,
    lowestScore: 89,
    targetScore: 80,
    trendDiff: 2.5,
    status: 'excellent',
  },
];

export function WeeklyProgressTrendChart({
  assignments = [],
  lang = 'en',
}: WeeklyProgressTrendChartProps) {
  const [selectedClass, setSelectedClass] = useState<string>('all');
  const [timeHorizon, setTimeHorizon] = useState<'4weeks' | '8weeks' | 'all'>('all');
  const [showBenchmark, setShowBenchmark] = useState<boolean>(true);
  const [showGrid, setShowGrid] = useState<boolean>(true);
  const [useSampleDataIfEmpty, setUseSampleDataIfEmpty] = useState<boolean>(true);

  // 1. Collect unique classes for filter dropdown
  const uniqueClasses = useMemo(() => {
    const set = new Set<string>();
    assignments.forEach((ast) => {
      if (ast.class_name) set.add(ast.class_name);
    });
    return Array.from(set);
  }, [assignments]);

  // 2. Filter & group assignments by weekly buckets
  const { weeklyData, isDemoData, stats } = useMemo(() => {
    // Filter graded items with numeric scores
    const graded = assignments.filter(
      (ast) => ast.submission_status === 'graded' && typeof ast.score === 'number' && ast.score !== null,
    );

    // Apply class filter if selected
    const filteredByClass =
      selectedClass === 'all' ? graded : graded.filter((ast) => ast.class_name === selectedClass);

    // Check if we have sufficient actual records (at least 2 graded assignments)
    if (filteredByClass.length < 2) {
      if (!useSampleDataIfEmpty) {
        return {
          weeklyData: [],
          isDemoData: false,
          stats: {
            currentAvg: 0,
            highestWeeklyAvg: 0,
            totalSubmissions: 0,
            growthTrend: 0,
            targetMetRate: 0,
          },
        };
      }

      // Localize demo points if in Chinese
      let demoList = DEMO_WEEKLY_PROGRESS.map((item, idx) => {
        if (lang === 'zh') {
          return {
            ...item,
            weekLabel: `第 ${idx + 1} 周`,
          };
        }
        return item;
      });

      if (timeHorizon === '4weeks') {
        demoList = demoList.slice(-4);
      } else if (timeHorizon === '8weeks') {
        demoList = demoList.slice(-8);
      }

      const totalSubmissions = demoList.reduce((acc, curr) => acc + curr.assignmentsCount, 0);
      const currentAvg = demoList.length > 0 ? demoList[demoList.length - 1].averageScore : 0;
      const highestWeeklyAvg = Math.max(...demoList.map((d) => d.averageScore));
      const firstScore = demoList[0]?.averageScore || currentAvg;
      const growthTrend = Number((currentAvg - firstScore).toFixed(1));
      const weeksAboveTarget = demoList.filter((d) => d.averageScore >= 80).length;
      const targetMetRate = Math.round((weeksAboveTarget / demoList.length) * 100);

      return {
        weeklyData: demoList,
        isDemoData: true,
        stats: {
          currentAvg,
          highestWeeklyAvg,
          totalSubmissions,
          growthTrend,
          targetMetRate,
        },
      };
    }

    // Sort chronologically
    const sorted = [...filteredByClass].sort((a, b) => {
      const timeA = a.graded_at || a.submitted_at || a.created_at || 0;
      const timeB = b.graded_at || b.submitted_at || b.created_at || 0;
      return timeA - timeB;
    });

    // Bucket into weekly groups (7 days per bucket from earliest date)
    const earliestTime = sorted[0].graded_at || sorted[0].submitted_at || sorted[0].created_at || Date.now();
    const oneWeekMs = 7 * 24 * 60 * 60 * 1000;

    const bucketsMap = new Map<number, { scores: number[]; count: number; minTime: number; maxTime: number }>();

    sorted.forEach((ast) => {
      const itemTime = ast.graded_at || ast.submitted_at || ast.created_at || earliestTime;
      const weekIndex = Math.max(0, Math.floor((itemTime - earliestTime) / oneWeekMs));
      const current = bucketsMap.get(weekIndex) || { scores: [], count: 0, minTime: itemTime, maxTime: itemTime };
      current.scores.push(ast.score as number);
      current.count += 1;
      current.minTime = Math.min(current.minTime, itemTime);
      current.maxTime = Math.max(current.maxTime, itemTime);
      bucketsMap.set(weekIndex, current);
    });

    const sortedBucketIndices = Array.from(bucketsMap.keys()).sort((a, b) => a - b);
    let previousAvg: number | null = null;

    const rawDataPoints: WeekDataPoint[] = sortedBucketIndices.map((idx, sequenceNum) => {
      const b = bucketsMap.get(idx)!;
      const avg = Number((b.scores.reduce((sum, s) => sum + s, 0) / b.scores.length).toFixed(1));
      const max = Math.max(...b.scores);
      const min = Math.min(...b.scores);
      const trendDiff = previousAvg !== null ? Number((avg - previousAvg).toFixed(1)) : null;
      previousAvg = avg;

      const startDate = new Date(b.minTime);
      const endDate = new Date(b.maxTime + 6 * 24 * 60 * 60 * 1000);

      const dateRangeStr =
        lang === 'zh'
          ? `${startDate.getMonth() + 1}月${startDate.getDate()}日 - ${endDate.getMonth() + 1}月${endDate.getDate()}日`
          : `${startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;

      const status: WeekDataPoint['status'] =
        avg >= 85 ? 'excellent' : avg >= 75 ? 'good' : avg >= 60 ? 'average' : 'needs_work';

      const weekLabel = lang === 'zh' ? `第 ${sequenceNum + 1} 周` : `Week ${sequenceNum + 1}`;

      return {
        weekKey: `W${sequenceNum + 1}`,
        weekLabel,
        dateRange: dateRangeStr,
        averageScore: avg,
        assignmentsCount: b.count,
        highestScore: max,
        lowestScore: min,
        targetScore: 80,
        trendDiff,
        status,
      };
    });

    let sliced = rawDataPoints;
    if (timeHorizon === '4weeks') {
      sliced = rawDataPoints.slice(-4);
    } else if (timeHorizon === '8weeks') {
      sliced = rawDataPoints.slice(-8);
    }

    const totalSubmissions = sliced.reduce((acc, curr) => acc + curr.assignmentsCount, 0);
    const currentAvg = sliced.length > 0 ? sliced[sliced.length - 1].averageScore : 0;
    const highestWeeklyAvg = sliced.length > 0 ? Math.max(...sliced.map((d) => d.averageScore)) : 0;
    const firstScore = sliced[0]?.averageScore || currentAvg;
    const growthTrend = Number((currentAvg - firstScore).toFixed(1));
    const weeksAboveTarget = sliced.filter((d) => d.averageScore >= 80).length;
    const targetMetRate = sliced.length > 0 ? Math.round((weeksAboveTarget / sliced.length) * 100) : 0;

    return {
      weeklyData: sliced,
      isDemoData: false,
      stats: {
        currentAvg,
        highestWeeklyAvg,
        totalSubmissions,
        growthTrend,
        targetMetRate,
      },
    };
  }, [assignments, selectedClass, timeHorizon, lang, useSampleDataIfEmpty]);

  const texts = {
    title: lang === 'zh' ? '每周学业进展趋势 (Weekly Progress)' : 'Weekly Progress Trend',
    badge: lang === 'zh' ? '阶段成长分析' : 'Academic Growth',
    subtitle:
      lang === 'zh'
        ? '按周追踪学业平均表现、作业完成密度与目标达成演进曲线'
        : 'Track weekly average score trajectory, coursework completion density, and milestone progression over time',
    classFilter: lang === 'zh' ? '筛选课程：' : 'Class Filter:',
    allClasses: lang === 'zh' ? '全学科综合' : 'All Subjects',
    scopeFilter: lang === 'zh' ? '时间窗口：' : 'Horizon:',
    scope4: lang === 'zh' ? '最近4周' : 'Last 4 Weeks',
    scope8: lang === 'zh' ? '最近8周' : 'Last 8 Weeks',
    scopeAll: lang === 'zh' ? '全部学期' : 'Full Semester',
    targetLineToggle: lang === 'zh' ? '目标基准线 (80%)' : 'Target Goal (80%)',
    gridToggle: lang === 'zh' ? '网格' : 'Grid',
    demoBadge: lang === 'zh' ? '演示样本数据' : 'Sample Trend Preview',
    statCurrent: lang === 'zh' ? '最新周均分' : 'Current Week Avg',
    statPeak: lang === 'zh' ? '最高周表现' : 'Peak Week Avg',
    statGrowth: lang === 'zh' ? '阶段学业净增' : 'Net Growth Trend',
    statTargetRate: lang === 'zh' ? '达标达标率' : 'Target Goal Met',
    statSubmissions: lang === 'zh' ? '统计作业总数' : 'Completed Works',
    emptyTitle: lang === 'zh' ? '暂无足够周次的作业评定数据' : 'Awaiting Weekly Graded Records',
    emptyDesc:
      lang === 'zh'
        ? '当你在不同周次完成作业并获得评分后，系统将自动汇总每周均分并生成学业成长曲线。'
        : 'Once your coursework receives weekly evaluations, the progress motor groups them by week to visualize your trajectory.',
    enableSampleBtn: lang === 'zh' ? '查看演示成长曲线' : 'Preview Sample Growth Trajectory',
    tooltipScore: lang === 'zh' ? '周均分' : 'Weekly Average',
    tooltipWorks: lang === 'zh' ? '完成作业数' : 'Completed Tasks',
    tooltipTarget: lang === 'zh' ? '目标基准' : 'Target Goal',
    tooltipRange: lang === 'zh' ? '最高/最低' : 'High / Low',
  };

  return (
    <div
      className="bg-white border border-gray-200 rounded-2xl shadow-sm hover:shadow-md transition-all overflow-hidden flex flex-col font-sans mb-6"
      id="weekly-progress-trend-card"
    >
      {/* Header with Title and Filtering Controls */}
      <div className="p-5 border-b border-gray-100 bg-linear-to-r from-indigo-50/20 via-white to-sky-50/20 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-xl mt-0.5 shadow-2xs">
            <TrendingUp size={20} className="stroke-[2.5]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-extrabold text-gray-950 text-base flex items-center gap-1.5">
                {texts.title}
              </h3>
              <span className="inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 border border-indigo-200/60 rounded-full px-2 py-0.5 text-xs font-bold">
                <Sparkles size={11} className="text-indigo-500" />
                {texts.badge}
              </span>
              {isDemoData && (
                <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-700 border border-amber-200/60 rounded-full px-2 py-0.5 text-xs font-semibold">
                  <Calendar size={11} />
                  {texts.demoBadge}
                </span>
              )}
            </div>
            <p className="text-gray-500 text-xs mt-0.5">{texts.subtitle}</p>
          </div>
        </div>

        {/* Toolbar Controls */}
        <div className="flex flex-wrap items-center gap-2.5 self-start md:self-center">
          {/* Class Filter */}
          {uniqueClasses.length > 0 && (
            <div className="flex items-center gap-1">
              <span className="text-xs font-medium text-gray-500 hidden sm:inline">{texts.classFilter}</span>
              <select
                value={selectedClass}
                onChange={(e) => setSelectedClass(e.target.value)}
                className="bg-white border border-gray-200 text-xs text-gray-700 font-semibold rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500 shadow-2xs"
              >
                <option value="all">{texts.allClasses}</option>
                {uniqueClasses.map((cls, idx) => (
                  <option key={idx} value={cls}>
                    {cls}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Time Horizon Filter */}
          <div className="inline-flex p-0.5 bg-gray-100/80 rounded-lg border border-gray-200 text-xs font-medium">
            <button
              onClick={() => setTimeHorizon('4weeks')}
              className={`px-2.5 py-1 rounded-md transition-all ${
                timeHorizon === '4weeks' ? 'bg-white text-indigo-700 font-bold shadow-2xs' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {texts.scope4}
            </button>
            <button
              onClick={() => setTimeHorizon('8weeks')}
              className={`px-2.5 py-1 rounded-md transition-all ${
                timeHorizon === '8weeks' ? 'bg-white text-indigo-700 font-bold shadow-2xs' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {texts.scope8}
            </button>
            <button
              onClick={() => setTimeHorizon('all')}
              className={`px-2.5 py-1 rounded-md transition-all ${
                timeHorizon === 'all' ? 'bg-white text-indigo-700 font-bold shadow-2xs' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {texts.scopeAll}
            </button>
          </div>

          {/* Target Reference Line Toggle */}
          <button
            onClick={() => setShowBenchmark(!showBenchmark)}
            className={`px-2.5 py-1 text-xs font-semibold rounded-lg border flex items-center gap-1.5 transition-all cursor-pointer ${
              showBenchmark
                ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                : 'bg-white border-gray-200 text-gray-500 hover:text-gray-800'
            }`}
            title="Toggle 80% Benchmark Line"
          >
            <span className={`w-1.5 h-1.5 rounded-full ${showBenchmark ? 'bg-emerald-500' : 'bg-gray-300'}`} />
            {texts.targetLineToggle}
          </button>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="px-5 py-3 border-b border-gray-100 bg-slate-50/40 grid grid-cols-2 sm:grid-cols-4 gap-3.5 select-none">
        <div className="p-3 bg-white border border-gray-100 rounded-xl shadow-2xs flex flex-col justify-center">
          <div className="flex items-center justify-between text-xs font-semibold text-gray-500">
            <span>{texts.statCurrent}</span>
            <span
              className={`inline-flex items-center text-xs font-bold ${
                stats.growthTrend > 0
                  ? 'text-emerald-600'
                  : stats.growthTrend < 0
                    ? 'text-rose-600'
                    : 'text-gray-500'
              }`}
            >
              {stats.growthTrend > 0 ? (
                <ArrowUpRight size={13} />
              ) : stats.growthTrend < 0 ? (
                <ArrowDownRight size={13} />
              ) : (
                <Minus size={13} />
              )}
              {stats.growthTrend > 0 ? `+${stats.growthTrend}%` : `${stats.growthTrend}%`}
            </span>
          </div>
          <span className="text-xl font-black text-indigo-950 font-mono mt-0.5">
            {stats.currentAvg > 0 ? `${stats.currentAvg}%` : '—'}
          </span>
        </div>

        <div className="p-3 bg-white border border-gray-100 rounded-xl shadow-2xs flex flex-col justify-center">
          <span className="text-xs font-semibold text-gray-500">{texts.statPeak}</span>
          <span className="text-xl font-black text-emerald-950 font-mono mt-0.5">
            {stats.highestWeeklyAvg > 0 ? `${stats.highestWeeklyAvg}%` : '—'}
          </span>
        </div>

        <div className="p-3 bg-white border border-gray-100 rounded-xl shadow-2xs flex flex-col justify-center">
          <span className="text-xs font-semibold text-gray-500">{texts.statTargetRate}</span>
          <span className="text-xl font-black text-teal-950 font-mono mt-0.5">
            {weeklyData.length > 0 ? `${stats.targetMetRate}%` : '—'}
          </span>
        </div>

        <div className="p-3 bg-white border border-gray-100 rounded-xl shadow-2xs flex flex-col justify-center">
          <span className="text-xs font-semibold text-gray-500">{texts.statSubmissions}</span>
          <span className="text-xl font-black text-slate-900 font-mono mt-0.5">
            {stats.totalSubmissions}
          </span>
        </div>
      </div>

      {/* Main Chart Area */}
      <div className="p-5">
        {weeklyData.length === 0 ? (
          <div className="text-center py-12 bg-slate-50/50 rounded-xl border border-dashed border-slate-200">
            <AlertCircle size={32} className="mx-auto text-slate-300 mb-2" />
            <h4 className="text-gray-800 text-sm font-bold">{texts.emptyTitle}</h4>
            <p className="text-gray-400 text-xs mt-1 px-4 max-w-md mx-auto">{texts.emptyDesc}</p>
            <button
              onClick={() => setUseSampleDataIfEmpty(true)}
              className="mt-4 px-3.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-lg text-xs font-bold transition-colors inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Sparkles size={13} />
              {texts.enableSampleBtn}
            </button>
          </div>
        ) : (
          <div className="w-full h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={weeklyData} margin={{ top: 15, right: 20, left: -20, bottom: 5 }}>
                <defs>
                  <linearGradient id="indigoScoreGrad" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#6366f1" />
                    <stop offset="50%" stopColor="#818cf8" />
                    <stop offset="100%" stopColor="#a855f7" />
                  </linearGradient>
                </defs>

                {showGrid && <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />}

                <XAxis
                  dataKey="weekLabel"
                  tick={{ fontSize: 11, fill: '#64748b', fontWeight: 'bold' }}
                  axisLine={{ stroke: '#e2e8f0' }}
                  tickLine={false}
                />
                <YAxis
                  domain={[0, 100]}
                  ticks={[0, 20, 40, 60, 80, 100]}
                  tick={{ fontSize: 11, fill: '#64748b', fontWeight: 'bold' }}
                  axisLine={{ stroke: '#e2e8f0' }}
                  tickLine={false}
                  tickFormatter={(val) => `${val}%`}
                />

                {/* 80% Benchmark Reference Line */}
                {showBenchmark && (
                  <ReferenceLine
                    y={80}
                    stroke="#10b981"
                    strokeDasharray="4 4"
                    strokeWidth={1.5}
                    label={{
                      value: lang === 'zh' ? '目标 80%' : 'Target 80%',
                      fill: '#059669',
                      fontSize: 10,
                      fontWeight: 700,
                      position: 'insideTopRight',
                    }}
                  />
                )}

                {/* Custom Tooltip */}
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload || !payload.length) return null;
                    const data = payload[0].payload as WeekDataPoint;
                    return (
                      <div className="bg-slate-900 text-white rounded-xl p-3 shadow-xl border border-slate-700/80 text-xs min-w-[200px] z-50">
                        <div className="flex items-center justify-between pb-1.5 border-b border-slate-800">
                          <span className="font-extrabold text-indigo-300">{data.weekLabel}</span>
                          <span className="text-[11px] text-slate-400 font-mono">{data.dateRange}</span>
                        </div>
                        <div className="py-2 space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="text-slate-300">{texts.tooltipScore}:</span>
                            <span className="font-extrabold text-emerald-400 font-mono text-sm">
                              {data.averageScore}%
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-slate-300">{texts.tooltipWorks}:</span>
                            <span className="font-semibold text-slate-200">{data.assignmentsCount}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-slate-300">{texts.tooltipRange}:</span>
                            <span className="text-slate-400 font-mono text-[11px]">
                              {data.highestScore}% / {data.lowestScore}%
                            </span>
                          </div>
                          {data.trendDiff !== null && (
                            <div className="flex items-center justify-between pt-1 border-t border-slate-800">
                              <span className="text-slate-400">
                                {lang === 'zh' ? '较上周变化' : 'Vs. Previous Week'}:
                              </span>
                              <span
                                className={`font-bold flex items-center gap-0.5 ${
                                  data.trendDiff > 0
                                    ? 'text-emerald-400'
                                    : data.trendDiff < 0
                                      ? 'text-rose-400'
                                      : 'text-slate-400'
                                }`}
                              >
                                {data.trendDiff > 0 ? `+${data.trendDiff}%` : `${data.trendDiff}%`}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  }}
                />

                {/* Primary Trend Line: Weekly Average Score */}
                <Line
                  type="monotone"
                  dataKey="averageScore"
                  name={lang === 'zh' ? '周平均得分' : 'Weekly Average Score'}
                  stroke="url(#indigoScoreGrad)"
                  strokeWidth={3}
                  dot={{ r: 4.5, fill: '#6366f1', stroke: '#ffffff', strokeWidth: 2 }}
                  activeDot={{ r: 7, stroke: '#a855f7', strokeWidth: 2.5, fill: '#ffffff' }}
                  animationDuration={800}
                />

                {/* Secondary Target Reference Line in Legend */}
                {showBenchmark && (
                  <Line
                    type="monotone"
                    dataKey="targetScore"
                    name={lang === 'zh' ? '学术目标线 (80%)' : 'Target Benchmark (80%)'}
                    stroke="#10b981"
                    strokeDasharray="4 4"
                    strokeWidth={1.5}
                    dot={false}
                  />
                )}

                <Legend
                  wrapperStyle={{ paddingTop: 10, fontSize: 11 }}
                  formatter={(value) => <span className="text-gray-600 font-medium">{value}</span>}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}
