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
  CheckCircle2, 
  AlertCircle,
  Clock,
  Sparkles,
  ChevronRight,
  TrendingDown,
  Compass
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

interface AcademicGrowthTrajectoryChartProps {
  assignments: GradedAssignment[];
  lang?: 'en' | 'zh';
}

export function AcademicGrowthTrajectoryChart({ assignments = [], lang = 'en' }: AcademicGrowthTrajectoryChartProps) {
  const [selectedClass, setSelectedClass] = useState<string>('all');
  const [showIndividualScores, setShowIndividualScores] = useState<boolean>(true);
  const [showGrid, setShowGrid] = useState<boolean>(true);

  // 1. Process data chronologically with running average calculation
  const { trajectoryData, availableClasses, stats, trendDirection } = useMemo(() => {
    // Filter and resolve entries
    const withScores = assignments
      .filter(ast => ast.submission_status === 'graded' && typeof ast.score === 'number' && ast.score !== null)
      .map(ast => {
        const scoreVal = ast.score as number;
        const timeVal = ast.graded_at || ast.submitted_at || ast.created_at || Date.now();
        return {
          ...ast,
          resolvedScore: scoreVal,
          timeVal
        };
      })
      .sort((a, b) => a.timeVal - b.timeVal);

    // Extract classes
    const classesSet = new Set<string>();
    withScores.forEach(ast => {
      if (ast.class_name) {
        classesSet.add(ast.class_name);
      }
    });

    // Apply filter if class is selected
    const filtered = selectedClass === 'all' 
      ? withScores 
      : withScores.filter(ast => ast.class_name === selectedClass);

    // Calculate cumulative moving averages
    let cumulativeSum = 0;
    const computedTrajectory = filtered.map((ast, idx) => {
      cumulativeSum += ast.resolvedScore;
      const runningAverage = Math.round((cumulativeSum / (idx + 1)) * 10) / 10;
      
      const dateObj = new Date(ast.timeVal);
      const formattedDate = dateObj.toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric' });
      const fullDate = dateObj.toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric', 
        hour: '2-digit', 
        minute: '2-digit' 
      });

      return {
        id: ast.id,
        index: idx + 1,
        title: ast.title.replace('MCQ Evaluation: ', '').replace('评估: ', ''),
        fullTitle: ast.title,
        score: ast.resolvedScore,
        runningAverage,
        className: ast.class_name,
        dateLabel: formattedDate,
        fullDateLabel: fullDate,
        feedback: ast.feedback || ''
      };
    });

    // Calculate core progression metrics
    const totalCount = computedTrajectory.length;
    const firstAvg = totalCount > 0 ? computedTrajectory[0].runningAverage : 0;
    const finalAvg = totalCount > 0 ? computedTrajectory[totalCount - 1].runningAverage : 0;
    const netGrowth = Math.round((finalAvg - firstAvg) * 10) / 10;
    
    // Growth streak / trend assessment
    let direction: 'upward' | 'stable' | 'downward' = 'stable';
    if (netGrowth > 1.5) direction = 'upward';
    else if (netGrowth < -1.5) direction = 'downward';

    // Min and max of running averages (representing fluctuation envelope)
    const runningAverages = computedTrajectory.map(d => d.runningAverage);
    const highestPeakAvg = runningAverages.length > 0 ? Math.max(...runningAverages) : 0;
    const lowestValleyAvg = runningAverages.length > 0 ? Math.min(...runningAverages) : 0;

    return {
      trajectoryData: computedTrajectory,
      availableClasses: Array.from(classesSet),
      stats: {
        startingAvg: firstAvg,
        currentAvg: finalAvg,
        growthPercentage: netGrowth,
        peakAvg: highestPeakAvg,
        valleyAvg: lowestValleyAvg,
        totalGraded: totalCount
      },
      trendDirection: direction
    };
  }, [assignments, selectedClass, lang]);

  // UI Localizations
  const t = {
    title: lang === 'zh' ? '学术成长轨迹与平均分演变' : 'Academic Growth & Cumulative Average Trajectory',
    subtitle: lang === 'zh' ? '追踪在校作业评分的累积移动平均线，体现核心学力成长趋势' : 'Tracks cumulative moving average of evaluated coursework to outline long-term proficiency',
    classFilter: lang === 'zh' ? '班级：' : 'Class:',
    allClasses: lang === 'zh' ? '全学科' : 'All Subjects',
    statsStart: lang === 'zh' ? '起始基准分' : 'Base Score',
    statsCurrent: lang === 'zh' ? '当前累积平均' : 'Cumulative Avg',
    statsNet: lang === 'zh' ? '学术增长劲头' : 'Net Trajectory',
    statsPeak: lang === 'zh' ? '累积峰值高度' : 'Trajectory Peak',
    emptyTitle: lang === 'zh' ? '待评阅作业以构建成长曲线' : 'Awaiting Data for Growth Map',
    emptyDesc: lang === 'zh' ? '当你的作业通过评阅且录入成绩后，成长轨迹分析引擎将自动计算每次评分后的全局累积分，从而绘制出能体现学习毅力与知识掌握成熟度的进展曲线。' : 'Once your work receives evaluations, our trajectory motor calculates a progressive running average to render a true representation of your academic journey.',
    layerIndividual: lang === 'zh' ? '显示单项原始成绩' : 'Show Single Assignment Scores',
    trajLabel: lang === 'zh' ? '学术成长轨迹 (累积平均)' : 'Academic Growth (Running Avg)',
    rawLabel: lang === 'zh' ? '单次作业得分' : 'Single Work Score',
    recommendationTitle: lang === 'zh' ? '自适应成长评估与建议' : 'Adaptive Progress Evaluation',
  };

  if (trajectoryData.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-xs hover:shadow-md transition-all font-sans mb-6">
        <div className="max-w-md mx-auto text-center py-6">
          <div className="inline-flex p-3 bg-rose-50 text-rose-500 rounded-full mb-3">
            <Compass className="w-6 h-6 animate-spin text-rose-600" />
          </div>
          <h3 className="font-extrabold text-gray-900 text-sm">{t.emptyTitle}</h3>
          <p className="text-gray-400 text-xs mt-2 leading-relaxed">{t.emptyDesc}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white border border-gray-200 rounded-2xl shadow-sm hover:shadow-md transition-all overflow-hidden flex flex-col font-sans mb-6" id="academic-growth-trajectory-card">
      {/* Upper header */}
      <div className="p-5 border-b border-gray-100 bg-linear-to-r from-emerald-50/10 via-white to-teal-50/10 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="p-2.5 bg-emerald-50 text-emerald-600 rounded-xl mt-0.5 shadow-2xs">
            <TrendingUp size={20} className="stroke-[2.5]" />
          </div>
          <div>
            <h3 className="font-extrabold text-gray-950 text-base flex items-center gap-1.5">
              <span>{t.title}</span>
              <span className="inline-flex items-center gap-1 bg-emerald-555 bg-emerald-100 text-emerald-800 border border-emerald-200/50 rounded-full px-2 py-0.5 text-[9px] font-black uppercase">
                <Sparkles size={8} className="animate-spin text-emerald-600" />
                {lang === 'zh' ? '能力演进' : 'Trajectory'}
              </span>
            </h3>
            <p className="text-gray-500 text-xs mt-0.5">{t.subtitle}</p>
          </div>
        </div>

        {/* Dynamic Class Selector */}
        <div className="flex flex-wrap items-center gap-3 self-center">
          {availableClasses.length > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-gray-500">{t.classFilter}</span>
              <select
                value={selectedClass}
                onChange={(e) => setSelectedClass(e.target.value)}
                className="bg-white border border-gray-200 text-xs text-gray-700 font-bold rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-500 shadow-2xs"
              >
                <option value="all">{t.allClasses}</option>
                {availableClasses.map((cls, idx) => (
                  <option key={idx} value={cls}>{cls}</option>
                ))}
              </select>
            </div>
          )}

          {/* Individual Toggle */}
          <button
            onClick={() => setShowIndividualScores(!showIndividualScores)}
            className={`px-3 py-1.5 text-[10px] font-bold rounded-lg border flex items-center gap-1.5 cursor-pointer transition-all ${
              showIndividualScores 
                ? 'bg-emerald-50 border-emerald-200 text-emerald-700 font-bold' 
                : 'bg-white border-gray-200 text-gray-500 hover:text-gray-700'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${showIndividualScores ? 'bg-emerald-500 animate-pulse' : 'bg-gray-300'}`} />
            {t.layerIndividual}
          </button>
        </div>
      </div>

      {/* Trajectory Stat Indicators */}
      <div className="px-5 py-3.5 border-b border-gray-100 bg-linear-to-b from-gray-50/30 to-white grid grid-cols-2 md:grid-cols-4 gap-4 select-none">
        <div className="p-3 bg-white hover:bg-slate-50 border border-gray-100 rounded-xl shadow-3xs flex flex-col justify-center">
          <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">{t.statsStart}</span>
          <span className="text-lg font-black text-slate-800 font-mono mt-0.5">{stats.startingAvg}%</span>
        </div>
        
        <div className="p-3 bg-white hover:bg-slate-50 border border-gray-100 rounded-xl shadow-3xs flex flex-col justify-center">
          <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">{t.statsCurrent}</span>
          <span className="text-lg font-black text-emerald-800 font-mono mt-0.5">{stats.currentAvg}%</span>
        </div>

        <div className="p-3 bg-white hover:bg-slate-50 border border-gray-100 rounded-xl shadow-3xs flex flex-col justify-center">
          <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">{t.statsNet}</span>
          <div className="flex items-center gap-1 mt-0.5">
            <span className={`text-lg font-black font-mono ${stats.growthPercentage >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
              {stats.growthPercentage >= 0 ? `+${stats.growthPercentage}` : stats.growthPercentage}%
            </span>
            {stats.growthPercentage > 0 && <TrendingUp size={14} className="text-emerald-500 shrink-0" />}
            {stats.growthPercentage < 0 && <TrendingDown size={14} className="text-red-400 shrink-0" />}
          </div>
        </div>

        <div className="p-3 bg-white hover:bg-slate-50 border border-gray-100 rounded-xl shadow-3xs flex flex-col justify-center">
          <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">{t.statsPeak}</span>
          <span className="text-lg font-black text-rose-800 font-mono mt-0.5">{stats.peakAvg}%</span>
        </div>
      </div>

      <div className="p-5 grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Recharts Trajectory Line */}
        <div className="lg:col-span-9 flex flex-col justify-between" id="growth-canvas-container">
          <div className="h-[250px] w-full relative bg-slate-50/20 border border-slate-100 p-2 rounded-xl">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trajectoryData} margin={{ top: 15, right: 15, left: -22, bottom: 5 }}>
                <defs>
                  {/* Trajectory smooth gradient */}
                  <linearGradient id="growthGrad" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#10b981" />
                    <stop offset="50%" stopColor="#06b6d4" />
                    <stop offset="100%" stopColor="#3b82f6" />
                  </linearGradient>
                  {/* Score helper translucent gradient */}
                  <linearGradient id="scoreAuxGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#94a3b8" />
                    <stop offset="100%" stopColor="#cbd5e1" />
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
                        <div className="p-3.5 bg-white/95 border border-emerald-100 rounded-xl shadow-xl max-w-[270px] backdrop-blur-xs font-sans">
                          <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-1.5 mb-1.5">
                            <span className="text-[8px] text-slate-400 font-extrabold uppercase font-mono">{d.className}</span>
                            <span className="bg-emerald-50 text-emerald-800 px-2 py-0.5 rounded-full text-[10px] font-black border border-emerald-100 font-mono">
                              {d.runningAverage}% Avg
                            </span>
                          </div>
                          
                          <p className="text-xs font-black text-slate-800 leading-tight">{d.fullTitle}</p>
                          <p className="text-[10px] text-slate-400 mt-1">{d.fullDateLabel}</p>

                          <div className="mt-2.5 pt-2 border-t border-slate-100 grid grid-cols-2 gap-1.5">
                            <div className="bg-slate-50 p-1 rounded border border-slate-100 text-center">
                              <span className="block text-[8px] text-gray-400 uppercase font-black">{lang === 'zh' ? '当次得分' : 'SESS SCORE'}</span>
                              <span className="text-[11px] font-bold font-mono text-indigo-700">{d.score}%</span>
                            </div>
                            <div className="bg-emerald-50/50 p-1 rounded border border-emerald-100/50 text-center">
                              <span className="block text-[8px] text-emerald-600 uppercase font-black">{lang === 'zh' ? '累积移动平均' : 'RUNNING AVG'}</span>
                              <span className="text-[11px] font-black font-mono text-emerald-800">{d.runningAverage}%</span>
                            </div>
                          </div>

                          {d.feedback && (
                            <div className="mt-2 bg-emerald-50/20 p-1.5 rounded-lg border border-emerald-100/30">
                              <p className="text-[9px] text-emerald-800 italic truncate font-sans">"{d.feedback}"</p>
                            </div>
                          )}
                        </div>
                      );
                    }
                    return null;
                  }}
                />

                {/* Growth Trajectory bold main Line */}
                <Line 
                  type="monotone" 
                  name={t.trajLabel}
                  dataKey="runningAverage" 
                  stroke="url(#growthGrad)" 
                  strokeWidth={4.5} 
                  dot={{ r: 4, stroke: '#ffffff', strokeWidth: 2, fill: '#06b6d4' }}
                  activeDot={{ r: 6, stroke: '#ffffff', strokeWidth: 2.5, fill: '#10b981' }}
                  animationDuration={1200}
                />

                {/* Optional single raw score Line */}
                {showIndividualScores && (
                  <Line 
                    type="monotone"
                    name={t.rawLabel}
                    dataKey="score" 
                    stroke="url(#scoreAuxGrad)" 
                    strokeWidth={1.5} 
                    strokeDasharray="4 3"
                    dot={{ r: 3, stroke: '#f8fafc', strokeWidth: 1, fill: '#94a3b8' }}
                    activeDot={{ r: 4, stroke: '#ffffff', strokeWidth: 2, fill: '#475569' }}
                    animationDuration={800}
                    opacity={0.65}
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Adaptive Assessment & Insight Panel */}
        <div className="lg:col-span-3 flex flex-col justify-between border-t lg:border-t-0 lg:border-l border-gray-100 pt-5 lg:pt-0 lg:pl-5 min-w-0">
          <div className="flex flex-col h-full justify-between">
            <div>
              <span className="text-[9px] font-extrabold uppercase text-gray-400 tracking-wider flex items-center gap-1 mb-2.5">
                <Sparkles size={11} className="text-emerald-500 shrink-0" />
                {t.recommendationTitle}
              </span>

              {/* Dynamic summary text depending on academic trend direction */}
              <div className="p-4 rounded-xl border border-dashed border-gray-200 bg-linear-to-b from-white to-gray-50/30">
                <div className="flex items-center gap-2 mb-2 font-black text-xs">
                  {trendDirection === 'upward' && (
                    <>
                      <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0 animate-ping" />
                      <span className="text-emerald-700">{lang === 'zh' ? '学术成长极强' : 'Excellent Growth'}</span>
                    </>
                  )}
                  {trendDirection === 'stable' && (
                    <>
                      <span className="w-2 h-2 rounded-full bg-indigo-400 shrink-0" />
                      <span className="text-indigo-700">{lang === 'zh' ? '平稳巩固上升' : 'Steady Progress'}</span>
                    </>
                  )}
                  {trendDirection === 'downward' && (
                    <>
                      <span className="w-2 h-2 rounded-full bg-rose-400 shrink-0 shadow-lg animate-pulse" />
                      <span className="text-rose-700">{lang === 'zh' ? '关注诊断警示' : 'Diagnostic Alert'}</span>
                    </>
                  )}
                </div>

                <p className="text-[11px] text-gray-650 leading-relaxed font-sans">
                  {lang === 'zh' ? (
                    <>
                      {trendDirection === 'upward' && '你的学术成长曲线呈现出非常健康的向上拉升趋势！这表明随着上课次数的增加，你的整体知识体系越来越巩固，学习耐力和答题准确率已经取得了决定性突破。'}
                      {trendDirection === 'stable' && '累积分数轨迹进入成熟的常态化稳定期。这反映出你表现相当均衡稳定。建议在保持住基础大盘的同时，试着探索更具挑战性的选拔赛或是高阶人工智能随堂测验来寻找新的学术突破。'}
                      {trendDirection === 'downward' && '近期累积平均分受某几次偶发失常作业的影响，增长势头有所受挫。请无需气馁，建议你到作业区查看教师留下的批注建议，利用微课复习针对差错进行重新作答。'}
                    </>
                  ) : (
                    <>
                      {trendDirection === 'upward' && 'Your academic trajectory maps a highly competent upward lift. This strongly correlates with refined endurance, improved error resolution over consecutive modules, and a progressive understanding of core material.'}
                      {trendDirection === 'stable' && 'Your running average sits in an equilibrium band. Your output exhibits solid consistency. Start aiming for advanced peer reviews or high-level AI topics to challenge your plateau and break into the higher bracket.'}
                      {trendDirection === 'downward' && 'The moving average shows a slight descent due to standard deviations in recent assignments. Review the feedback timeline to recalibrate your core subjects and raise your general competency.'}
                    </>
                  )}
                </p>
              </div>
            </div>

            {/* Helpful legend checklist */}
            <div className="mt-4 pt-3.5 border-t border-gray-100 space-y-2 select-none">
              <div className="flex items-center gap-2 text-[10px] font-bold text-gray-450">
                <ChevronRight size={10} className="text-emerald-500" />
                <span>{lang === 'zh' ? '总评测样本数: ' : 'Assessments count: '}<span className="text-slate-800 font-mono">{stats.totalGraded}</span></span>
              </div>
              <div className="flex items-center gap-2 text-[10px] font-bold text-gray-450">
                <ChevronRight size={10} className="text-emerald-500" />
                <span>{lang === 'zh' ? '学力波动幅度: ' : 'Fluctuation envelope: '}<span className="text-slate-800 font-mono">{(stats.peakAvg - stats.valleyAvg).toFixed(1)}%</span></span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
