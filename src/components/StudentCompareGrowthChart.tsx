import React, { useState, useMemo } from 'react';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Legend,
  ReferenceLine
} from 'recharts';
import { 
  Users, 
  TrendingUp, 
  Award, 
  Sparkles, 
  Check, 
  LineChart as ChartIcon, 
  TrendingDown, 
  Activity,
  Info 
} from 'lucide-react';

interface Student {
  id: string;
  name: string;
  email?: string;
}

interface Assignment {
  id: string;
  title: string;
  created_at?: number;
}

interface PerformanceRecord {
  student_id: string;
  assignment_id: string;
  score: number | null;
  submission_status: string;
}

interface StudentCompareGrowthChartProps {
  students: Student[];
  assignments: Assignment[];
  performance: PerformanceRecord[];
  lang?: 'en' | 'zh';
}

export function StudentCompareGrowthChart({ 
  students = [], 
  assignments = [], 
  performance = [], 
  lang = 'en' 
}: StudentCompareGrowthChartProps) {
  // Pre-select the first two students if available
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>(() => {
    if (students.length >= 2) {
      return [students[0].id, students[1].id];
    }
    return students.map(s => s.id);
  });

  const [compareMetric, setCompareMetric] = useState<'running_average' | 'raw_score'>('running_average');

  // Multi-color palette for compared students
  const colorMap = [
    '#6366f1', // Indigo
    '#f43f5e', // Rose
    '#10b981', // Emerald
    '#0ea5e9', // Sky
    '#f59e0b', // Amber
    '#8b5cf6', // Violet
    '#ec4899', // Pink
    '#14b8a6', // Teal
  ];

  // Process data for the comparison
  const { chartData, comparedStudentSummary, chronologicalAssignments } = useMemo(() => {
    // 1. Sort assignments chronologically (based on approximate evaluation/creation order)
    const sortedAssignments = [...assignments].sort((a, b) => {
      return (a.created_at || 0) - (b.created_at || 0);
    });

    const activeStudents = students.filter(st => selectedStudentIds.includes(st.id));

    // Initialize trackers for running totals to compute cumulative averages
    const runningSums: Record<string, number> = {};
    const runningCounts: Record<string, number> = {};
    activeStudents.forEach(st => {
      runningSums[st.id] = 0;
      runningCounts[st.id] = 0;
    });

    // 2. Map coordinates across sorted assignments
    const mappedData = sortedAssignments.map((ast, index) => {
      const dataPoint: any = {
        name: ast.title.replace('MCQ Evaluation: ', '').replace('评估: ', ''),
        fullName: ast.title,
        index: index + 1
      };

      activeStudents.forEach(st => {
        const perf = performance.find(
          p => p.student_id === st.id && p.assignment_id === ast.id && p.submission_status === 'graded' && typeof p.score === 'number' && p.score !== null
        );

        if (perf && perf.score !== null) {
          const score = Number(perf.score);
          
          // Increment tracking for cumulative running average
          runningSums[st.id] += score;
          runningCounts[st.id] += 1;
          const currentAvg = Math.round((runningSums[st.id] / runningCounts[st.id]) * 10) / 10;

          dataPoint[`raw_${st.id}`] = score;
          dataPoint[`avg_${st.id}`] = currentAvg;
        } else {
          // If no evaluation yet, fall back to previous running average if available, or hide
          dataPoint[`raw_${st.id}`] = null;
          dataPoint[`avg_${st.id}`] = runningCounts[st.id] > 0 
            ? Math.round((runningSums[st.id] / runningCounts[st.id]) * 10) / 10 
            : null;
        }
      });

      return dataPoint;
    });

    // 3. Compute static metrics summary for compare roster
    const summary = activeStudents.map((st, sIdx) => {
      // Find all scores for student
      const studentGrades = sortedAssignments
        .map(ast => performance.find(p => p.student_id === st.id && p.assignment_id === ast.id && p.submission_status === 'graded' && typeof p.score === 'number' && p.score !== null))
        .filter(p => p && p.score !== null)
        .map(p => Number(p!.score));

      const totalItems = studentGrades.length;
      const startingScore = totalItems > 0 ? studentGrades[0] : 0;
      const currentScore = totalItems > 0 ? studentGrades[totalItems - 1] : 0;
      
      // Cumulative start vs final cumulative average
      const studentAvgs = mappedData.map(d => d[`avg_${st.id}`]).filter(v => typeof v === 'number' && v !== null);
      const startingAvg = studentAvgs.length > 0 ? studentAvgs[0] : 0;
      const finalAvg = studentAvgs.length > 0 ? studentAvgs[studentAvgs.length - 1] : 0;
      const netTrajectoryGrowth = Math.round((finalAvg - startingAvg) * 10) / 10;

      const peakScore = totalItems > 0 ? Math.max(...studentGrades) : 0;

      return {
        id: st.id,
        name: st.name,
        color: colorMap[sIdx % colorMap.length],
        totalItems,
        startingScore,
        currentScore,
        startingAvg,
        finalAvg,
        netGrowth: netTrajectoryGrowth,
        peak: peakScore
      };
    });

    return {
      chartData: mappedData.filter(d => {
        // Exclude points where no student has data to avoid empty tails
        return activeStudents.some(st => d[`avg_${st.id}`] !== null || d[`raw_${st.id}`] !== null);
      }),
      comparedStudentSummary: summary,
      chronologicalAssignments: sortedAssignments
    };
  }, [students, assignments, performance, selectedStudentIds]);

  const toggleStudentSelection = (studentId: string) => {
    setSelectedStudentIds(prev => {
      if (prev.includes(studentId)) {
        // Allow removing but try to avoid leaving empty
        return prev.filter(id => id !== studentId);
      } else {
        return [...prev, studentId];
      }
    });
  };

  const t = {
    panelTitle: lang === 'zh' ? '多生学力成长对比透视' : 'Student Performance & Growth Comparison',
    panelSub: lang === 'zh' ? '选择多位学生，跨作业维度水平比对单次得分或累积移动平均线，分析班级成长差值' : 'Select two or more pupils to synthesize comparative academic curves over coursework timelines',
    metricSelect: lang === 'zh' ? '对比数据：' : 'Metric:',
    runningAvg: lang === 'zh' ? '累积分数轨迹 (移动平均线)' : 'Cumulative Growth Trajectory (Running Avg)',
    rawScore: lang === 'zh' ? '单次作业得分 (多折线图)' : 'Individual Assignment Scores',
    noStudentsMsg: lang === 'zh' ? '请选择至少两位学生以生成比对坐标系' : 'Please select at least two students to visualize academic trends',
    chartLegend: lang === 'zh' ? '参比学生' : 'Compared Students',
    metricsTableTitle: lang === 'zh' ? '学术轨迹成长对比数据' : 'Trajectory Growth Metrics Summary',
    tableStudent: lang === 'zh' ? '学生' : 'Pupil',
    tableSamples: lang === 'zh' ? '已评估次数' : 'Graded Works',
    tableBase: lang === 'zh' ? '初始均分' : 'Baseline Avg',
    tableCurrent: lang === 'zh' ? '当前均分' : 'Current Avg',
    tableNet: lang === 'zh' ? '成长趋势净值' : 'Net Growth Trend',
    tablePeak: lang === 'zh' ? '评测峰值' : 'Peak Assessment',
    insufficientData: lang === 'zh' ? '当前班级数据不满足比对条件。请录入多名学生及作业评分后再作比对。' : 'Insufficient dataset. Please enroll multiple student evaluations to configure comparing nodes.'
  };

  if (students.length === 0 || assignments.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-6 text-center shadow-xs font-sans">
        <Info className="w-8 h-8 text-indigo-500 mx-auto mb-2 animate-bounce" />
        <p className="text-gray-550 text-xs font-medium leading-relaxed">{t.insufficientData}</p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-gray-200 rounded-2xl shadow-xs overflow-hidden flex flex-col font-sans mt-2 mb-6" id="student-growth-compare-card">
      {/* Header and description */}
      <div className="p-4 border-b border-gray-100 bg-linear-to-r from-indigo-50/10 via-white to-sky-50/10 flex flex-col gap-2">
        <div className="flex items-start gap-2.5">
          <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl mt-0.5">
            <Users size={18} className="stroke-[2.5]" />
          </div>
          <div>
            <h4 className="font-extrabold text-gray-900 text-sm flex items-center gap-1.5 flex-wrap">
              <span>{t.panelTitle}</span>
              <span className="inline-flex items-center gap-0.5 bg-indigo-100 text-indigo-800 border border-indigo-200/50 rounded-full px-2 py-0.5 text-[9px] font-black uppercase">
                <Sparkles size={8} className="animate-spin text-indigo-600" />
                {lang === 'zh' ? '多维透视' : 'Cohort Analytics'}
              </span>
            </h4>
            <p className="text-gray-500 text-[11px] mt-0.5 leading-relaxed">{t.panelSub}</p>
          </div>
        </div>

        {/* Controls block for toggling metric type */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mt-2 border-t border-gray-100/60 pt-3">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-extrabold text-gray-400 uppercase tracking-wider">{t.metricSelect}</span>
            <div className="inline-flex bg-gray-100 p-0.5 rounded-lg border border-gray-200/55 shadow-3xs select-none">
              <button
                type="button"
                onClick={() => setCompareMetric('running_average')}
                className={`px-3 py-1 text-[10px] font-bold rounded-md transition-all cursor-pointer flex items-center gap-1 ${
                  compareMetric === 'running_average'
                    ? 'bg-white text-indigo-700 shadow-xs border-indigo-50 font-extrabold'
                    : 'text-gray-500 hover:text-gray-800'
                }`}
              >
                <TrendingUp size={11} />
                <span>{lang === 'zh' ? '累积成长轨迹' : 'Running Trajectory'}</span>
              </button>
              <button
                type="button"
                onClick={() => setCompareMetric('raw_score')}
                className={`px-3 py-1 text-[10px] font-bold rounded-md transition-all cursor-pointer flex items-center gap-1 ${
                  compareMetric === 'raw_score'
                    ? 'bg-white text-indigo-700 shadow-xs border-indigo-50 font-extrabold'
                    : 'text-gray-500 hover:text-gray-800'
                }`}
              >
                <ChartIcon size={11} />
                <span>{lang === 'zh' ? '单次作业得分' : 'Syllabus Scores'}</span>
              </button>
            </div>
          </div>

          <div className="text-[10px] text-indigo-600/75 italic bg-indigo-50/50 px-2 py-1 rounded-md border border-indigo-100/30">
            {compareMetric === 'running_average' 
              ? (lang === 'zh' ? '💡 呈现从第一次作业后开始的平均学力，能更好地平滑单次测验失常' : '💡 Cumulative average line provides an overview of consistency while eliminating single test noise')
              : (lang === 'zh' ? '💡 呈现每次作业的评估分数波动，能捕捉近期的突破和退步' : '💡 Raw scores show performance on individual assignments, highlighting highlights and deviations')}
          </div>
        </div>
      </div>

      {/* Grid containing students to select & compared curves */}
      <div className="p-4 grid grid-cols-1 lg:grid-cols-4 gap-5">
        
        {/* Left side: Student roster checkboxes */}
        <div className="lg:col-span-1 bg-slate-50/50 rounded-xl border border-slate-150 p-3 flex flex-col justify-between max-h-[340px] overflow-hidden">
          <div className="flex flex-col h-full">
            <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider mb-2 block select-none">
              {lang === 'zh' ? '参比学生选单' : 'Active Pupil List'}
            </span>
            <div className="flex-1 overflow-y-auto space-y-1.5 pr-0.5" id="enrolled-pupils-compare-checklist">
              {students.map((st, sIdx) => {
                const isSelected = selectedStudentIds.includes(st.id);
                const sColor = colorMap[sIdx % colorMap.length];
                
                return (
                  <button
                    key={st.id}
                    type="button"
                    onClick={() => toggleStudentSelection(st.id)}
                    className={`w-full flex items-center justify-between text-left p-2 rounded-xl border transition-all text-xs cursor-pointer select-none ${
                      isSelected 
                        ? 'bg-white border-gray-200/80 shadow-3xs font-bold ring-1 ring-slate-100/50' 
                        : 'bg-transparent border-transparent text-gray-500 hover:bg-slate-100/60'
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate pr-2">
                      <div 
                        className={`w-5 h-5 rounded-full flex items-center justify-center border text-[9px] text-white shrink-0 font-extrabold`}
                        style={{ backgroundColor: isSelected ? sColor : '#e2e8f0', borderColor: isSelected ? sColor : '#cbd5e1' }}
                      >
                        {isSelected ? <Check size={11} className="stroke-[3]" /> : st.name.charAt(0)}
                      </div>
                      <div className="truncate">
                        <div className="truncate font-bold text-gray-800 text-[11.5px]">{st.name}</div>
                        {st.email && <div className="text-[8.5px] text-gray-400 truncate">{st.email}</div>}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-3 pt-2.5 border-t border-slate-200/70 text-[9.5px] text-slate-400 leading-normal flex items-center gap-1">
            <Activity size={12} className="text-indigo-400" />
            <span>{lang === 'zh' ? '勾选即可实时载入/移除比对' : 'Toggle checkboxes to real-time update'}</span>
          </div>
        </div>

        {/* Right side: Recharts curves */}
        <div className="lg:col-span-3 flex flex-col justify-between" id="compare-canvas-holder">
          {selectedStudentIds.length < 2 ? (
            <div className="h-[250px] flex items-center justify-center border border-dashed border-gray-200 bg-gray-50/50 rounded-xl p-6">
              <div className="max-w-xs text-center">
                <Users size={24} className="text-indigo-300 mx-auto mb-2 animate-bounce" />
                <p className="text-gray-500 text-xs font-semibold leading-relaxed">{t.noStudentsMsg}</p>
              </div>
            </div>
          ) : (
            <div className="h-[250px] w-full relative bg-slate-50/15 border border-slate-100 p-2.5 rounded-2xl shadow-3xs">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 15, right: 15, left: -22, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis 
                    dataKey="name" 
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
                    content={({ active, payload, label }) => {
                      if (active && payload && payload.length) {
                        return (
                          <div className="p-3 bg-white/95 border border-gray-150 rounded-xl shadow-xl max-w-[280px] font-sans text-xs">
                            <div className="font-extrabold text-slate-800 leading-tight mb-2 border-b border-gray-100 pb-1.5 flex items-center justify-between">
                              <span className="truncate max-w-[180px]">{label}</span>
                              <span className="text-[8px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-bold uppercase shrink-0">Evaluated Item</span>
                            </div>
                            <div className="space-y-1.5">
                              {payload.map((p: any) => {
                                const stId = p.dataKey.split('_')[1];
                                const currentStudent = students.find(s => s.id === stId);
                                if (!currentStudent) return null;
                                
                                return (
                                  <div key={p.dataKey} className="flex items-center justify-between gap-4 font-sans text-[11px]">
                                    <div className="flex items-center gap-1.5 min-w-0">
                                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: p.stroke }} />
                                      <span className="font-semibold text-gray-700 truncate">{currentStudent.name}</span>
                                    </div>
                                    <span className="font-black font-mono" style={{ color: p.stroke }}>{p.value}%</span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  
                  {comparedStudentSummary.map((summaryItem) => {
                    const lineKey = compareMetric === 'running_average' 
                      ? `avg_${summaryItem.id}` 
                      : `raw_${summaryItem.id}`;
                    
                    return (
                      <Line
                        key={summaryItem.id}
                        type="monotone"
                        name={summaryItem.name}
                        dataKey={lineKey}
                        stroke={summaryItem.color}
                        strokeWidth={compareMetric === 'running_average' ? 3.5 : 2.5}
                        dot={{ r: 3, stroke: '#ffffff', strokeWidth: 1.5, fill: summaryItem.color }}
                        activeDot={{ r: 5, stroke: '#ffffff', strokeWidth: 2, fill: summaryItem.color }}
                        animationDuration={1000}
                        connectNulls
                      />
                    );
                  })}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Summary Scorecard comparison grid */}
      {selectedStudentIds.length >= 2 && comparedStudentSummary.length > 0 && (
        <div className="px-4 pb-4 border-t border-gray-100 pt-3">
          <div className="text-[10px] font-black uppercase text-slate-400 tracking-wider mb-2.5 select-none flex items-center gap-1">
            <Award size={12} className="text-indigo-500" />
            <span>{t.metricsTableTitle}</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
            {comparedStudentSummary.map((sumItem) => {
              const isUpward = sumItem.netGrowth > 1.0;
              const isDownward = sumItem.netGrowth < -1.0;
              
              return (
                <div 
                  key={sumItem.id}
                  className="p-3 bg-slate-50/50 border border-slate-100 rounded-xl flex flex-col justify-between"
                  style={{ borderLeft: `3px solid ${sumItem.color}` }}
                >
                  <div className="flex justify-between items-start gap-1">
                    <span className="text-xs font-extrabold text-slate-800 truncate" title={sumItem.name}>{sumItem.name}</span>
                    <span className="text-[9px] text-gray-400 font-mono font-bold">{sumItem.totalItems} {lang === 'zh' ? '个样本' : 'graded'}</span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-slate-100/60 select-none">
                    <div>
                      <span className="text-[8px] text-gray-400 uppercase font-black">{lang === 'zh' ? '基础/当前均分' : 'Base/Live Avg'}</span>
                      <div className="text-[11px] font-bold font-mono text-slate-700 mt-0.5">
                        {sumItem.startingAvg}% → {sumItem.finalAvg}%
                      </div>
                    </div>
                    
                    <div className="text-right">
                      <span className="text-[8px] text-gray-400 uppercase font-black">{t.tableNet}</span>
                      <div className="flex items-center justify-end gap-0.5 mt-0.5">
                        <span className={`text-[11px] font-black font-mono ${
                          isUpward ? 'text-emerald-600' : isDownward ? 'text-red-500' : 'text-slate-600'
                        }`}>
                          {sumItem.netGrowth > 0 ? `+${sumItem.netGrowth}` : sumItem.netGrowth}%
                        </span>
                        {isUpward && <TrendingUp size={11} className="text-emerald-500 shrink-0" />}
                        {isDownward && <TrendingDown size={11} className="text-red-400 shrink-0" />}
                      </div>
                    </div>
                  </div>

                  <div className="mt-2 text-[9px] bg-white p-1 rounded border border-slate-150 flex items-center justify-between font-mono select-none">
                    <span className="text-gray-400 font-bold">{lang === 'zh' ? '评估最值' : 'Peak Score'}</span>
                    <span className="font-extrabold text-indigo-700">{sumItem.peak}%</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
