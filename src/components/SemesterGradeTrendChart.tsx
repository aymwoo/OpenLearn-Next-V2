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
  Legend
} from 'recharts';
import { 
  TrendingUp, 
  Award, 
  BookOpen, 
  Calendar, 
  CornerDownRight, 
  CheckCircle2, 
  AlertCircle,
  HelpCircle,
  Layout,
  Filter,
  Eye,
  Activity
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
  created_at?: number;
}

interface SemesterGradeTrendChartProps {
  assignments: GradedAssignment[];
  lang?: 'en' | 'zh';
}

export function SemesterGradeTrendChart({ assignments = [], lang = 'en' }: SemesterGradeTrendChartProps) {
  const [selectedClass, setSelectedClass] = useState<string>('all');
  const [lineType, setLineType] = useState<'monotone' | 'linear' | 'step'>('monotone');
  const [showGrid, setShowGrid] = useState<boolean>(true);
  const [showAvgLine, setShowAvgLine] = useState<boolean>(true);
  const [showPassingLine, setShowPassingLine] = useState<boolean>(true);

  // 1. Filter graded assignments and sort chronologically
  const sortedGradedAssignments = useMemo(() => {
    return assignments
      .filter(ast => ast.submission_status === 'graded' && typeof ast.score === 'number' && ast.score !== null)
      .map(ast => ({
        ...ast,
        // Ensure score is a number
        resolvedScore: ast.score as number,
        // Fallback for date sorting
        eventTime: ast.submitted_at || ast.created_at || Date.now()
      }))
      .sort((a, b) => a.eventTime - b.eventTime);
  }, [assignments]);

  // 2. Extract unique classes from the assignments for the filter dropdown
  const availableClasses = useMemo(() => {
    const classes = new Map<string, string>(); // class_id/class_name -> class_name
    sortedGradedAssignments.forEach(ast => {
      if (ast.class_name) {
        classes.set(ast.class_name, ast.class_name);
      }
    });
    return Array.from(classes.values());
  }, [sortedGradedAssignments]);

  // 3. Filter data by selected class
  const filteredData = useMemo(() => {
    if (selectedClass === 'all') {
      return sortedGradedAssignments;
    }
    return sortedGradedAssignments.filter(ast => ast.class_name === selectedClass);
  }, [sortedGradedAssignments, selectedClass]);

  // 4. Map to chart representation
  const chartData = useMemo(() => {
    return filteredData.map((ast, idx) => {
      const date = ast.eventTime ? new Date(ast.eventTime) : null;
      const formattedDate = date 
        ? date.toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric' })
        : `${lang === 'zh' ? '测验' : 'Quiz'} #${idx + 1}`;
      
      const fullDate = date 
        ? date.toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })
        : 'N/A';

      return {
        id: ast.id,
        index: idx + 1,
        title: ast.title.replace('MCQ Evaluation: ', '').replace('评估: ', ''),
        fullTitle: ast.title,
        score: ast.resolvedScore,
        className: ast.class_name,
        dateLabel: formattedDate,
        fullDateLabel: fullDate,
        feedback: ast.feedback || (lang === 'zh' ? '优秀！继续加油。' : 'Excellent work! Keep it up.'),
      };
    });
  }, [filteredData, lang]);

  // 5. Calculate statistics for the filtered dataset
  const stats = useMemo(() => {
    if (chartData.length === 0) {
      return { average: 0, highest: 0, lowest: 0, total: 0, passingCount: 0, passRate: 0 };
    }
    const scores = chartData.map(d => d.score);
    const sum = scores.reduce((acc, score) => acc + score, 0);
    const average = Math.round(sum / scores.length);
    const highest = Math.max(...scores);
    const lowest = Math.min(...scores);
    const total = scores.length;
    // Let's set passing benchmark at 60%
    const passingCount = scores.filter(s => s >= 60).length;
    const passRate = Math.round((passingCount / total) * 100);

    return { average, highest, lowest, total, passingCount, passRate };
  }, [chartData]);

  // Bilingual content helpers
  const t = {
    title: lang === 'zh' ? '学期成绩表现趋势' : 'Semester Grade Performance Trend',
    subtitle: lang === 'zh' ? '全学期已评分测验与交互式作业的 chronological 成绩趋势分析' : 'Chronological grade analysis of graded quizzes and assignments across the semester',
    classFilter: lang === 'zh' ? '选择班级：' : 'Class Filter:',
    allClasses: lang === 'zh' ? '全部班级' : 'All Classes',
    chartStyle: lang === 'zh' ? '曲线样式：' : 'Line Smoothing:',
    monotone: lang === 'zh' ? '平滑曲线' : 'Smooth',
    linear: lang === 'zh' ? '折线' : 'Straight',
    step: lang === 'zh' ? '阶梯线' : 'Step',
    averageScore: lang === 'zh' ? '已选平均成绩' : 'Selected Average',
    highestScore: lang === 'zh' ? '最高成绩' : 'Highest Grade',
    lowestScore: lang === 'zh' ? '最低成绩' : 'Lowest Grade',
    passRate: lang === 'zh' ? '及格率' : 'Passing Rate',
    gradedCount: lang === 'zh' ? '评阅作业数' : 'Graded Works',
    passingBenchmark: lang === 'zh' ? '及格线 (60%)' : 'Passing Benchmark (60%)',
    emptyTitle: lang === 'zh' ? '无学期评阅成绩' : 'No Graded Academic Data Only',
    emptyDesc: lang === 'zh' ? '当前学期尚未有已评分的测验。当物理、历史或数学老师评估并评定你的白板作业或选择题测试后，由于底层的自适应评估引擎同步，此处会自动渲染出成绩波动趋势。' : 'You do not have any graded assignments or quizzes yet in this semester. Once teachers complete grading your interactive assignments, your chronological performance trajectory line will outline your academic development.',
    statsBanner: lang === 'zh' ? '学期综合表现速览' : 'Academic Analytics Insights',
    optionsTitle: lang === 'zh' ? '图表图层配置' : 'Chart Layers',
    referenceLines: lang === 'zh' ? '显示辅助线：' : 'Toggle Reference Lines:',
    avgLineLabel: lang === 'zh' ? '选区平均' : 'Current Avg',
    passLineLabel: lang === 'zh' ? '及格基准' : 'Passing Threshold',
    gridLines: lang === 'zh' ? '网格' : 'Grid',
    averageLine: lang === 'zh' ? '平均成绩线' : 'Average Line',
    passLine: lang === 'zh' ? '及格基准线' : 'Passing Benchmark',
    feedbackTitle: lang === 'zh' ? '名师评语批注：' : 'Teacher Feedback Remark:',
    assignmentName: lang === 'zh' ? '评阅详情物' : 'Assignment'
  };

  if (sortedGradedAssignments.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-2xl p-8 shadow-sm hover:shadow-md transition-all">
        <div className="max-w-md mx-auto text-center py-8">
          <div className="inline-flex p-3.5 bg-indigo-50 text-indigo-600 rounded-full mb-4">
            <Activity className="w-7 h-7 animate-pulse" />
          </div>
          <h3 className="font-bold text-gray-800 text-lg">{t.emptyTitle}</h3>
          <p className="text-gray-500 text-xs mt-3 leading-relaxed">
            {t.emptyDesc}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white border border-gray-200 rounded-2xl shadow-sm hover:shadow-md transition-all overflow-hidden flex flex-col font-sans" id="semester-grade-trend-container">
      {/* 1. Header with Title & Custom Interactive Controls */}
      <div className="p-5 border-b border-gray-100 bg-gray-50/50 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-xl mt-0.5 shadow-sm">
            <TrendingUp size={20} className="stroke-[2.5]" />
          </div>
          <div>
            <h3 className="font-extrabold text-gray-900 text-base flex items-center gap-2">
              <span>{t.title}</span>
              <span className="inline-flex items-center gap-0.5 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-full px-2 py-0.5 text-[9px] font-bold">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                {lang === 'zh' ? '学期分析' : 'Semester Trend'}
              </span>
            </h3>
            <p className="text-gray-500 text-xs mt-0.5">{t.subtitle}</p>
          </div>
        </div>

        {/* Filters and Config Dropdowns */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Class Filter Dropdown */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-bold text-gray-500 flex items-center gap-1">
              <Filter size={12} className="text-gray-400" />
              {t.classFilter}
            </span>
            <select
              value={selectedClass}
              onChange={(e) => setSelectedClass(e.target.value)}
              className="bg-white border border-gray-200 text-xs text-gray-700 rounded-lg px-2.5 py-1.5 shadow-2xs focus:outline-none focus:ring-1 focus:ring-indigo-500 font-semibold"
              id="class-filter-select"
            >
              <option value="all">{t.allClasses}</option>
              {availableClasses.map((cls, idx) => (
                <option key={idx} value={cls}>{cls}</option>
              ))}
            </select>
          </div>

          {/* Curve Style Filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-bold text-gray-500 flex items-center gap-1">
              <Eye size={12} className="text-gray-400" />
              {t.chartStyle}
            </span>
            <div className="inline-flex border border-gray-200 rounded-lg p-0.5 bg-white shadow-2xs">
              <button
                onClick={() => setLineType('monotone')}
                className={`px-2 py-1 text-[10px] font-bold rounded-md transition-all ${lineType === 'monotone' ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:text-gray-800'}`}
              >
                {t.monotone}
              </button>
              <button
                onClick={() => setLineType('linear')}
                className={`px-2 py-1 text-[10px] font-bold rounded-md transition-all ${lineType === 'linear' ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:text-gray-800'}`}
              >
                {t.linear}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Key Statistical Metrics Sub-Ribbon */}
      <div className="px-5 py-4 border-b border-gray-100 bg-white grid grid-cols-2 md:grid-cols-5 gap-3.5">
        <div className="bg-indigo-50/20 border border-indigo-100/40 p-3.5 rounded-xl flex items-center gap-3">
          <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-lg shadow-2xs">
            <TrendingUp size={16} />
          </div>
          <div>
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{t.averageScore}</div>
            <div className="text-base font-extrabold text-indigo-950 font-mono mt-0.5">{stats.average}%</div>
          </div>
        </div>

        <div className="bg-emerald-50/20 border border-emerald-100/40 p-3.5 rounded-xl flex items-center gap-3">
          <div className="p-2.5 bg-emerald-50 text-emerald-600 rounded-lg shadow-2xs">
            <Award size={16} />
          </div>
          <div>
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{t.highestScore}</div>
            <div className="text-base font-extrabold text-emerald-950 font-mono mt-0.5">{stats.highest}%</div>
          </div>
        </div>

        <div className="bg-rose-50/20 border border-rose-100/40 p-3.5 rounded-xl flex items-center gap-3">
          <div className="p-2.5 bg-rose-50 text-rose-600 rounded-lg shadow-2xs">
            <AlertCircle size={16} />
          </div>
          <div>
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{t.lowestScore}</div>
            <div className="text-base font-extrabold text-rose-950 font-mono mt-0.5">{stats.lowest}%</div>
          </div>
        </div>

        <div className="bg-amber-50/15 border border-amber-100/40 p-3.5 rounded-xl flex items-center gap-3">
          <div className="p-2.5 bg-amber-50 text-amber-600 rounded-lg shadow-2xs">
            <CheckCircle2 size={16} />
          </div>
          <div>
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{t.passRate}</div>
            <div className="text-base font-extrabold text-amber-950 font-mono mt-0.5">{stats.passRate}%</div>
          </div>
        </div>

        <div className="bg-sky-50/20 border border-sky-100/40 p-3.5 rounded-xl flex items-center gap-3 col-span-2 md:col-span-1">
          <div className="p-2.5 bg-sky-50 text-sky-600 rounded-lg shadow-2xs">
            <BookOpen size={16} />
          </div>
          <div>
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{t.gradedCount}</div>
            <div className="text-base font-extrabold text-sky-950 font-mono mt-0.5">{stats.total}</div>
          </div>
        </div>
      </div>

      <div className="p-5 grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* 3. Recharts LineChart Segment */}
        <div className="lg:col-span-9 flex flex-col justify-between" id="semester-grade-chart-wrapper">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div className="text-xs font-bold text-indigo-900 flex items-center gap-1">
              <Calendar size={13} className="text-indigo-500" />
              <span>{lang === 'zh' ? '学期表现时间轴（按提交时间排序）' : 'Academic Performance Timeline (Chronological)'}</span>
            </div>
            
            {/* Layers Configuration inside chart */}
            <div className="flex items-center gap-3 text-[11px] text-gray-600 font-semibold self-end">
              <span className="text-gray-400 text-[10px] uppercase font-bold">{t.referenceLines}</span>
              <label className="flex items-center gap-1 cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={showAvgLine} 
                  onChange={(e) => setShowAvgLine(e.target.checked)}
                  className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span>{t.gridLines}</span>
              </label>
              <label className="flex items-center gap-1 cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={showAvgLine} 
                  onChange={(e) => setShowAvgLine(e.target.checked)}
                  className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span>{t.averageLine}</span>
              </label>
              <label className="flex items-center gap-1 cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={showPassingLine} 
                  onChange={(e) => setShowPassingLine(e.target.checked)}
                  className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span>{t.passLine}</span>
              </label>
            </div>
          </div>

          {/* Actual responsive container */}
          <div className="h-[280px] w-full bg-slate-50/30 border border-slate-100 p-2.5 rounded-xl shadow-2xs relative">
            {chartData.length === 0 ? (
              <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-400 italic">
                {lang === 'zh' ? '无该筛选条件下的成绩数据' : 'No grade data available for this selection'}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={chartData}
                  margin={{ top: 15, right: 15, left: -22, bottom: 5 }}
                >
                  <defs>
                    <linearGradient id="lineColorGrad" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="#4f46e5" />
                      <stop offset="50%" stopColor="#8b5cf6" />
                      <stop offset="100%" stopColor="#ec4899" />
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
                          <div className="p-3.5 bg-white/95 border border-indigo-100 rounded-xl shadow-xl max-w-[270px] backdrop-blur-xs transition-all ring-4 ring-indigo-550/10">
                            <div className="flex items-center justify-between gap-3 border-b border-gray-100 pb-1.5 mb-1.5">
                              <span className="text-[9px] text-gray-450 font-extrabold uppercase font-mono">Quiz #{d.index} &middot; {d.className}</span>
                              <span className="inline-flex items-center bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full text-[10px] font-extrabold font-mono border border-indigo-100 shadow-2xs">
                                {d.score}%
                              </span>
                            </div>
                            <p className="text-xs font-black text-slate-800 leading-snug">{d.fullTitle}</p>
                            <p className="text-[10px] text-slate-400 mt-1 leading-normal font-medium">{d.fullDateLabel}</p>
                            
                            <div className="mt-2 bg-gradient-to-r from-violet-50/50 to-indigo-50/40 p-2 rounded-lg border border-violet-100/50">
                              <span className="text-[9px] font-black text-violet-850 uppercase block tracking-wider mb-0.5">{t.feedbackTitle}</span>
                              <p className="text-[10px] text-slate-700 italic font-sans leading-normal">"{d.feedback}"</p>
                            </div>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  {showPassingLine && (
                    <ReferenceLine 
                      y={60} 
                      stroke="#f43f5e" 
                      strokeWidth={1}
                      strokeDasharray="4 4" 
                      label={{ 
                        value: t.passingBenchmark, 
                        fill: '#f43f5e', 
                        fontSize: 8, 
                        fontWeight: 'bold',
                        position: 'top',
                        offset: 3
                      }} 
                    />
                  )}
                  {showAvgLine && stats.total > 0 && (
                    <ReferenceLine 
                      y={stats.average} 
                      stroke="#4f46e5" 
                      strokeWidth={1}
                      strokeDasharray="3 3" 
                      label={{ 
                        value: `${t.avgLineLabel} (${stats.average}%)`, 
                        fill: '#4f46e5', 
                        fontSize: 8, 
                        fontWeight: 'bold',
                        position: 'bottom',
                        offset: 3
                      }} 
                    />
                  )}
                  <Line 
                    type={lineType} 
                    dataKey="score" 
                    stroke="url(#lineColorGrad)" 
                    strokeWidth={3} 
                    dot={{ r: 5, stroke: '#ffffff', strokeWidth: 2, fill: '#4f46e5' }}
                    activeDot={{ r: 7, stroke: '#ffffff', strokeWidth: 2, fill: '#ec4899' }}
                    animationDuration={1000}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* 4. Side Commentary panel - List of Grade achievements */}
        <div className="lg:col-span-3 flex flex-col justify-between border-t border-gray-100 lg:border-t-0 lg:border-l lg:border-gray-100 pt-5 lg:pt-0 lg:pl-5">
          <div className="flex flex-col h-full min-h-0">
            <div className="text-xs font-extrabold uppercase text-gray-450 tracking-wider mb-3">
              {lang === 'zh' ? '成绩优异榜' : 'Semester Milestones'}
            </div>
            
            <div className="space-y-2.5 overflow-y-auto max-h-[265px] pr-1 scrollbar-thin">
              {chartData.length === 0 ? (
                <div className="text-center p-6 text-xs text-gray-400 italic">
                  {lang === 'zh' ? '没有评分记录' : 'No milestone records'}
                </div>
              ) : (
                [...chartData].sort((a,b) => b.score - a.score).slice(0, 4).map((d, index) => {
                  const isTop = index === 0;
                  return (
                    <div 
                      key={d.id} 
                      className={`p-2.5 rounded-xl border flex items-center justify-between gap-3 transition-colors ${
                        isTop 
                          ? 'border-yellow-200 bg-yellow-50/35 hover:bg-yellow-50/50' 
                          : d.score >= 80 
                          ? 'border-emerald-100 bg-emerald-50/20 hover:bg-emerald-50/35'
                          : 'border-slate-100 bg-slate-50/30 hover:bg-slate-50/60'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[8px] font-extrabold px-1.5 py-0.5 rounded uppercase font-mono leading-none tracking-wider bg-white shadow-3xs text-slate-500">
                            {isTop ? '🏆 TOP' : `#${index + 1}`}
                          </span>
                          <span className="text-[9px] text-indigo-600 font-bold max-w-[80px] truncate" title={d.className}>{d.className}</span>
                        </div>
                        <h5 className="font-extrabold text-[10.5px] text-slate-800 leading-snug truncate mt-1" title={d.fullTitle}>
                          {d.title}
                        </h5>
                      </div>
                      <div className={`px-2 py-1 rounded-lg border font-mono font-bold text-center text-xs shrink-0 shadow-3xs bg-white ${
                        d.score >= 85 ? 'text-emerald-700 border-emerald-150' : d.score >= 60 ? 'text-indigo-700 border-indigo-150' : 'text-rose-700 border-rose-150'
                      }`}>
                        {d.score}%
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Micro Summary Insight */}
            {stats.total > 0 && (
              <div className="mt-4 p-3 bg-gradient-to-r from-indigo-500/10 to-purple-500/10 rounded-2xl border border-indigo-100/50 text-[10px] text-slate-700 leading-relaxed font-medium">
                {lang === 'zh' ? (
                  <>
                    在本学期中，你已完成了 <span className="font-bold text-indigo-805 font-mono">{stats.total}</span> 次正式学习质量评测。全科平均通过率为 <span className="font-bold text-emerald-700 font-mono">{stats.passRate}%</span>。建议继续针对得分低于 60% 的章节进行自主微课回顾和重新作答。
                  </>
                ) : (
                  <>
                    You participated in <span className="font-bold text-indigo-805 font-mono">{stats.total}</span> scholastic assessments this semester with an average competency score of <span className="font-bold text-indigo-700 font-mono">{stats.average}%</span>. Your grade profile shows an active rate of <span className="font-bold text-teal-700 font-mono">{stats.passRate}%</span> above passing grade threshold.
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
