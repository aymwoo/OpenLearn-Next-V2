import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  TrendingUp, 
  Award, 
  Activity, 
  Calendar, 
  ChevronRight, 
  LayoutTemplate, 
  FileBadge, 
  MessageSquare,
  Sparkles,
  RefreshCw,
  BarChart2,
  LineChart as LineChartIcon,
  Clock
} from 'lucide-react';
import { 
  ResponsiveContainer, 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  Tooltip, 
  CartesianGrid, 
  ReferenceLine,
  BarChart,
  Bar
} from 'recharts';

interface GradedAssignment {
  id: string;
  title: string;
  description: string;
  content: string;
  class_name: string;
  submission_status: string;
  score: number;
  feedback: string;
  submitted_at: number;
  graded_at?: number;
}

interface StudentGradedTimelineProps {
  assignments: GradedAssignment[];
}

export function StudentGradedTimeline({ assignments }: StudentGradedTimelineProps) {
  const [chartType, setChartType] = useState<'area' | 'bar'>('area');
  const [selectedPointIndex, setSelectedPointIndex] = useState<number | null>(null);

  // Filter and sort graded assignments chronologically
  const gradedList = (assignments || [])
    .filter(ast => ast.submission_status === 'graded')
    .sort((a, b) => (a.submitted_at || 0) - (b.submitted_at || 0));

  if (gradedList.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-8 hover:shadow-md transition-all">
        <div className="max-w-md mx-auto text-center py-6">
          <div className="inline-flex p-3 bg-indigo-50 text-indigo-600 rounded-full mb-3">
            <Activity className="w-6 h-6 animate-pulse" />
          </div>
          <h3 className="font-semibold text-gray-800 text-base">Graded Performance Timeline</h3>
          <p className="text-gray-500 text-xs mt-2 leading-relaxed">
            Your interactive learning timeline and performance chart will generate automatically here once teachers grade your MCQ quizzes or interactive submissions. Complete more tasks to build your historical growth profile!
          </p>
        </div>
      </div>
    );
  }

  // Calculate metrics
  const scores = gradedList.map(item => item.score || 0);
  const highestScore = Math.max(...scores);
  const averageScore = Math.round(scores.reduce((sum, val) => sum + val, 0) / scores.length);
  const totalCount = gradedList.length;
  // Passing is 70% or more
  const passingCount = gradedList.filter(ast => (ast.score || 0) >= 70).length;
  const passRate = Math.round((passingCount / totalCount) * 100);

  // Performance Trajectory Analysis
  let trajectoryLabel = 'Solidly Consistent';
  let trajectorySub = 'Maintaining stable grades';
  let trajectoryDelta = 0;
  let trajectoryColor = 'text-blue-700 border-blue-200 bg-blue-50/50';

  if (scores.length >= 2) {
    const half = Math.ceil(scores.length / 2);
    const firstHalf = scores.slice(0, half);
    const secondHalf = scores.slice(scores.length % 2 === 0 ? half : half - 1);
    const avgFirst = firstHalf.reduce((sum, val) => sum + val, 0) / firstHalf.length;
    const avgSecond = secondHalf.reduce((sum, val) => sum + val, 0) / secondHalf.length;
    trajectoryDelta = Math.round(avgSecond - avgFirst);

    if (trajectoryDelta > 15) {
      trajectoryLabel = 'Stellar Acceleration';
      trajectorySub = `Surging upward by +${trajectoryDelta}%!`;
      trajectoryColor = 'text-green-800 border-green-300 bg-green-55/60 animate-bounce';
    } else if (trajectoryDelta > 3) {
      trajectoryLabel = 'Steadily Improving';
      trajectorySub = `Gained a +${trajectoryDelta}% grade boost`;
      trajectoryColor = 'text-emerald-700 border-emerald-200 bg-emerald-50/70';
    } else if (trajectoryDelta < -10) {
      trajectoryLabel = 'Support Recommended';
      trajectorySub = `Recent grades dropped by ${trajectoryDelta}%`;
      trajectoryColor = 'text-rose-700 border-rose-200 bg-rose-50/70';
    } else if (trajectoryDelta < -3) {
      trajectoryLabel = 'Needs Targeted Review';
      trajectorySub = `Slight dip of ${trajectoryDelta}% noticed`;
      trajectoryColor = 'text-amber-700 border-amber-200 bg-amber-50/70';
    } else {
      trajectoryLabel = 'Solidly Consistent';
      trajectorySub = 'Maintaining very stable performance';
      trajectoryColor = 'text-indigo-700 border-indigo-200 bg-indigo-50/70';
    }
  }

  // Format data for chart
  const chartData = gradedList.map((item, idx) => ({
    index: idx,
    id: item.id,
    title: item.title.replace('MCQ Evaluation: ', '').substring(0, 20) + (item.title.length > 20 ? '...' : ''),
    fullTitle: item.title,
    score: item.score || 0,
    className: item.class_name,
    dateStr: item.submitted_at ? new Date(item.submitted_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : `Quiz #${idx + 1}`,
    fullDate: item.submitted_at ? new Date(item.submitted_at).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) : 'N/A',
    feedback: item.feedback || 'Excellent execution!',
    gradedAt: item.graded_at ? new Date(item.graded_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''
  }));

  // Selected item details or default to the most recent one
  const activeDetailIndex = selectedPointIndex !== null ? selectedPointIndex : chartData.length - 1;
  const activeDetail = chartData[activeDetailIndex];
  const originalActiveDetail = gradedList[activeDetailIndex];

  // Grade color utility
  const getScoreColor = (score: number) => {
    if (score >= 90) return { bg: 'bg-green-50 text-green-700 border-green-200', text: 'text-green-600', ring: 'ring-green-400' };
    if (score >= 75) return { bg: 'bg-blue-50 text-blue-700 border-blue-200', text: 'text-blue-600', ring: 'ring-blue-400' };
    if (score >= 60) return { bg: 'bg-amber-50 text-amber-700 border-amber-200', text: 'text-amber-600', ring: 'ring-amber-400' };
    return { bg: 'bg-red-50 text-red-700 border-red-200', text: 'text-red-600', ring: 'ring-red-400' };
  };

  return (
    <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden flex flex-col font-sans">
      {/* Card Header & Controls */}
      <div className="p-4 sm:p-5 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-gray-50/50">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-50 text-indigo-650 rounded-lg">
            <TrendingUp size={18} className="animate-pulse" />
          </div>
          <div>
            <h3 className="font-bold text-gray-800 text-sm sm:text-base flex items-center gap-1.5">
              <span>Performance Analytics & Historical Growth Timeline</span>
              <span className="text-[10px] bg-indigo-100 text-indigo-800 font-bold px-1.5 py-0.5 rounded-full inline-flex items-center gap-1">
                <Sparkles size={8} /> Auto-Updated
              </span>
            </h3>
            <p className="text-gray-500 text-xs">Track chronological objective proficiency across classes</p>
          </div>
        </div>

        {/* Chart Options Selector */}
        <div className="flex items-center gap-1.5 bg-white p-1 rounded-lg border border-gray-200 self-start sm:self-center">
          <button
            onClick={() => setChartType('area')}
            className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all flex items-center gap-1 ${
              chartType === 'area'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            <LineChartIcon size={12} />
            <span>Trend Area</span>
          </button>
          <button
            onClick={() => setChartType('bar')}
            className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all flex items-center gap-1 ${
              chartType === 'bar'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            <BarChart2 size={12} />
            <span>Bars</span>
          </button>
        </div>
      </div>

      {/* Grid of Highlights/Metrics & Main Dashboard Content */}
      <div className="p-4 sm:p-6 space-y-6">
        {/* Metric Ribbons */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="p-3 bg-indigo-50/40 rounded-xl border border-indigo-100/60 flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-indigo-100 text-indigo-600">
              <TrendingUp size={16} />
            </div>
            <div>
              <div className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Average</div>
              <div className="text-lg font-bold text-indigo-950 font-mono">{averageScore}%</div>
            </div>
          </div>

          <div className="p-3 bg-emerald-50/40 rounded-xl border border-emerald-100/60 flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-emerald-100 text-emerald-600">
              <Award size={16} />
            </div>
            <div>
              <div className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Highest Score</div>
              <div className="text-lg font-bold text-emerald-950 font-mono">{highestScore}%</div>
            </div>
          </div>

          <div className="p-3 bg-cyan-50/40 rounded-xl border border-cyan-100/60 flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-cyan-100 text-cyan-600">
              <Activity size={16} />
            </div>
            <div>
              <div className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Completed</div>
              <div className="text-lg font-bold text-cyan-950 font-mono">{totalCount} Quizzes</div>
            </div>
          </div>

          <div className="p-3 bg-amber-50/40 rounded-xl border border-amber-100/60 flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-amber-100 text-amber-600">
              <FileBadge size={16} />
            </div>
            <div>
              <div className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Passing Rate</div>
              <div className="text-lg font-bold text-amber-950 font-mono">{passRate}%</div>
            </div>
          </div>
        </div>

        {/* Dynamic Performance Improvement Trajectory Analytics Callout */}
        {scores.length >= 2 && (
          <div className={`p-4 rounded-xl border flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all ${trajectoryColor}`}>
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-white/95 text-indigo-650 shrink-0 border border-indigo-100 shadow-xs">
                <TrendingUp size={18} className={trajectoryDelta > 0 ? "text-emerald-600 animate-pulse" : "text-indigo-600"} />
              </div>
              <div>
                <div className="text-[10px] uppercase font-bold tracking-wider opacity-75">Learning Curve & Trajectory</div>
                <h4 className="text-sm font-extrabold mt-0.5 flex items-center gap-2 text-slate-900">
                  <span>{trajectoryLabel}</span>
                  {trajectoryDelta !== 0 && (
                    <span className={`inline-flex items-center text-[10px] px-2 py-0.5 rounded-full font-bold ${
                      trajectoryDelta > 0 ? 'bg-emerald-100/80 text-emerald-850 border border-emerald-250' : 'bg-rose-100/80 text-rose-850 border border-rose-250'
                    }`}>
                      {trajectoryDelta > 0 ? `▲ +${trajectoryDelta}% Growth` : `▼ ${trajectoryDelta}% Drop`}
                    </span>
                  )}
                </h4>
                <p className="text-xs text-slate-600 mt-1 leading-snug">{trajectorySub}</p>
              </div>
            </div>
            <div className="text-[11px] font-semibold px-3 py-2 bg-white/95 rounded-lg shadow-3xs border border-slate-100 text-slate-700 md:self-center">
              <div className="text-slate-400 font-bold uppercase text-[8px] mb-0.5 tracking-wider">Growth Comparison</div>
              <span className="font-bold text-indigo-900">{Math.round(scores.slice(0, Math.ceil(scores.length / 2)).reduce((a,b)=>a+b,0)/Math.ceil(scores.length/2))}%</span> Earliest Avg 
              <span className="text-slate-400 mx-1">&rarr;</span> 
              <span className="font-bold text-emerald-700">{Math.round(scores.slice(Math.ceil(scores.length / 2)).reduce((a,b)=>a+b,0)/scores.slice(Math.ceil(scores.length / 2)).length) || scores[scores.length - 1]}%</span> Recent Avg
            </div>
          </div>
        )}

        {/* Master Chart and Interactive Details Area */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 min-h-0">
          
          {/* Graded Chart Area */}
          <div className="lg:col-span-8 flex flex-col justify-between">
            <div className="mb-2 text-xs font-semibold uppercase text-gray-400 tracking-wider">Chronological Progress Chart</div>
            
            <div className="h-[250px] w-full mt-3">
              <ResponsiveContainer width="100%" height="100%">
                {chartType === 'area' ? (
                  <AreaChart 
                    data={chartData} 
                    margin={{ top: 10, right: 10, left: -20, bottom: 5 }}
                    onClick={(state) => {
                      if (state && typeof state.activeTooltipIndex === 'number') {
                        setSelectedPointIndex(state.activeTooltipIndex);
                      }
                    }}
                  >
                    <defs>
                      <linearGradient id="scoreColorGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.25}/>
                        <stop offset="95%" stopColor="#4f46e5" stopOpacity={0.01}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis 
                      dataKey="dateStr" 
                      tick={{ fontSize: 10, fill: '#64748b' }} 
                      axisLine={false} 
                      tickLine={false}
                    />
                    <YAxis 
                      domain={[0, 100]} 
                      tick={{ fontSize: 10, fill: '#64748b' }} 
                      axisLine={false} 
                      tickLine={false}
                    />
                    <Tooltip 
                      cursor={{ stroke: '#e2e8f0', strokeWidth: 1 }}
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const data = payload[0].payload;
                          const selected = activeDetailIndex === data.index;
                          return (
                            <div className={`p-3 bg-white border rounded-xl shadow-xl border-gray-100 max-w-xs transition-all ${selected ? 'ring-2 ring-indigo-500' : ''}`}>
                              <p className="text-[10px] text-gray-400 font-bold uppercase">{data.fullDate}</p>
                              <p className="text-xs font-bold text-gray-800 leading-snug mt-0.5">{data.fullTitle}</p>
                              <div className="flex items-center justify-between gap-4 mt-2">
                                <span className="text-[10px] text-gray-500 bg-gray-50 border px-1.5 py-0.5 rounded font-medium">{data.className}</span>
                                <span className="text-xs font-bold text-indigo-600 font-mono">{data.score}%</span>
                              </div>
                              <p className="text-[9px] text-gray-400 italic mt-1 bg-gray-50 p-1 rounded">Click node to pin details below</p>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <ReferenceLine y={70} stroke="#cbd5e1" strokeDasharray="4 4" label={{ value: 'Passing Benchmark (70%)', fill: '#94a3b8', fontSize: 9, position: 'top' }} />
                    <Area 
                      type="monotone" 
                      dataKey="score" 
                      stroke="#4f46e5" 
                      strokeWidth={2.5} 
                      fillOpacity={1} 
                      fill="url(#scoreColorGrad)"
                      activeDot={{ r: 6, fill: '#4f46e5', stroke: '#fff', strokeWidth: 2 }}
                    />
                  </AreaChart>
                ) : (
                  <BarChart 
                    data={chartData} 
                    margin={{ top: 10, right: 10, left: -20, bottom: 5 }}
                    onClick={(state) => {
                      if (state && typeof state.activeTooltipIndex === 'number') {
                        setSelectedPointIndex(state.activeTooltipIndex);
                      }
                    }}
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis 
                      dataKey="dateStr" 
                      tick={{ fontSize: 10, fill: '#64748b' }} 
                      axisLine={false} 
                      tickLine={false}
                    />
                    <YAxis 
                      domain={[0, 100]} 
                      tick={{ fontSize: 10, fill: '#64748b' }} 
                      axisLine={false} 
                      tickLine={false}
                    />
                    <Tooltip 
                      cursor={{ fill: 'rgba(79, 70, 229, 0.04)' }}
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const data = payload[0].payload;
                          return (
                            <div className="p-3 bg-white border border-gray-150 rounded-xl shadow-xl max-w-xs">
                              <p className="text-[10px] text-gray-400 font-bold uppercase">{data.fullDate}</p>
                              <p className="text-xs font-bold text-gray-800 leading-snug mt-0.5">{data.fullTitle}</p>
                              <div className="flex items-center justify-between gap-4 mt-2">
                                <span className="text-[10px] text-gray-500 bg-gray-50 border px-1.5 py-0.5 rounded font-medium">{data.className}</span>
                                <span className="text-xs font-bold text-indigo-600 font-mono">{data.score}%</span>
                              </div>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <ReferenceLine y={70} stroke="#cbd5e1" strokeDasharray="4 4" label={{ value: 'Benchmark', fill: '#94a3b8', fontSize: 9 }} />
                    <Bar 
                      dataKey="score" 
                      fill="#4f46e5" 
                      radius={[4, 4, 0, 0]}
                      maxBarSize={45}
                    />
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>

            {/* Selected Node Details Section */}
            <div className="mt-4 p-3 bg-gray-50 rounded-xl border border-gray-150 text-xs">
              <div className="flex justify-between items-center mb-1">
                <span className="font-semibold text-gray-650 flex items-center gap-1">
                  <LayoutTemplate size={12} />
                  <span>Selected Node Objective Grade Evaluation:</span>
                </span>
                <span className="text-[9px] font-mono text-gray-400 font-semibold uppercase">Quiz {activeDetailIndex + 1} of {totalCount}</span>
              </div>
              <div className="flex items-start justify-between gap-3 mt-1.5">
                <div className="space-y-1">
                  <p className="font-bold text-gray-850 leading-relaxed text-xs">{activeDetail.fullTitle}</p>
                  <p className="text-[10px] text-gray-500 leading-normal flex items-center flex-wrap gap-1.5">
                    <span>{activeDetail.className} &middot; Submitted on {activeDetail.fullDate}</span>
                    {activeDetail.gradedAt && (
                      <span className="inline-flex items-center gap-0.5 text-emerald-650 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100 font-medium">
                        <Clock size={10} /> Graded: {activeDetail.gradedAt}
                      </span>
                    )}
                  </p>
                </div>
                <div className={`px-2.5 py-1 rounded-lg border font-mono font-bold text-center shrink-0 ${getScoreColor(activeDetail.score).bg}`}>
                  <div className="text-[8px] uppercase tracking-wider font-bold opacity-75">Score</div>
                  <div className="text-sm font-black leading-none">{activeDetail.score}%</div>
                </div>
              </div>
            </div>
          </div>

          {/* Chronological Vertical Interactive Timeline */}
          <div className="lg:col-span-4 flex flex-col">
            <div className="mb-2 text-xs font-semibold uppercase text-gray-400 tracking-wider flex items-center justify-between">
              <span>Interactive Evaluation Log</span>
              <span className="text-[9px] lowercase bg-amber-50 text-amber-700 px-1 py-0.5 rounded border border-amber-100 font-mono">recent first</span>
            </div>

            <div className="flex-1 overflow-y-auto max-h-[300px] lg:max-h-[340px] pr-1.5 space-y-3 scrollbar-thin mt-3">
              <AnimatePresence initial={false}>
                {[...chartData].reverse().map((item) => {
                  const isActive = activeDetailIndex === item.index;
                  const colors = getScoreColor(item.score);
                  return (
                    <motion.div
                      key={item.id}
                      onClick={() => setSelectedPointIndex(item.index)}
                      whileHover={{ scale: 1.01 }}
                      className={`p-3 rounded-xl border cursor-pointer transition-all ${
                        isActive 
                          ? 'border-indigo-600 bg-indigo-50/20 ring-2 ring-indigo-100/50 shadow-sm' 
                          : 'border-gray-150 hover:border-gray-300 bg-white hover:bg-gray-50/50'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-[10px] font-bold text-gray-400 font-mono uppercase">
                              #{item.index + 1}
                            </span>
                            <span className="text-[9px] text-gray-500 font-medium font-sans">
                              {item.dateStr}
                            </span>
                            <span className="text-[9px] font-bold text-indigo-700 px-1.5 py-0.5 bg-indigo-50 rounded bg-indigo-50/50 ml-auto border border-indigo-100">
                              {item.className}
                            </span>
                          </div>
                          <h4 className="font-bold text-xs text-gray-800 leading-snug line-clamp-1 py-0.5">{item.fullTitle}</h4>
                        </div>
                        <div className={`px-1.5 py-0.5 rounded font-bold font-mono text-[10px] border shrink-0 ${colors.bg}`}>
                          {item.score}%
                        </div>
                      </div>

                      {/* Display brief feedback when collapsed/clicked */}
                      <div className={`text-[10px] text-gray-500 mt-2 bg-gray-50/80 p-1.5 rounded-lg border border-gray-100 ${isActive ? 'block' : 'line-clamp-1'}`}>
                        <div className="flex flex-col gap-1">
                          <div className="flex items-start gap-1">
                            <MessageSquare size={10} className="text-teal-600 shrink-0 mt-0.5" />
                            <span className="leading-snug text-slate-700 italic">"{item.feedback}"</span>
                          </div>
                          {item.gradedAt && isActive && (
                            <div className="text-[9px] text-gray-400 mt-1 flex items-center justify-end gap-0.5 font-mono italic border-t border-gray-250/50 pt-1">
                              <Clock size={9} /> Graded: {item.gradedAt}
                            </div>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          </div>

        </div>

      </div>
    </div>
  );
}
