import React, { useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts';
import { TrendingUp, BookOpen, CheckCircle2, AlertCircle } from 'lucide-react';
import type { StudentProgressType } from '../types/app';

export interface LearningProgressTrendChartProps {
  /** Chronological learning progress records for a single student */
  progressHistory: StudentProgressType[];
  /** UI language */
  lang?: 'zh' | 'en';
  /** Compact mode for embedding inside modals */
  compact?: boolean;
}

/** A single data point rendered on the chart */
interface ChartDataPoint {
  /** Display label on X-axis (lesson title, truncated) */
  label: string;
  /** Full lesson title for tooltip */
  lessonTitle: string;
  /** 0-100 progress percentage */
  progressPercent: number;
  /** Whether the lesson is completed */
  completed: boolean;
  /** Formatted date string */
  dateLabel: string;
  /** Raw timestamp for sorting */
  timestamp: number;
}

/**
 * Recharts AreaChart that displays a student's historical learning progress
 * across assigned lessons, ordered chronologically by assigned_at timestamp.
 *
 * Renders inside the StudentGrowthProfileModal to show progress trends.
 */
export function LearningProgressTrendChart({
  progressHistory,
  lang = 'zh',
  compact = false,
}: LearningProgressTrendChartProps) {
  const texts = useMemo(
    () => ({
      title: lang === 'zh' ? '课程学习进度趋势' : 'Learning Progress Trend',
      badge: lang === 'zh' ? '历史趋势' : 'History',
      subtitle: lang === 'zh' ? '按课程追踪学习完成度与进度变化曲线' : 'Track lesson completion progress over time',
      emptyTitle: lang === 'zh' ? '暂无学习进度记录' : 'No Progress Records Yet',
      emptyDesc:
        lang === 'zh'
          ? '当学生被分配课程并开始学习后，进度趋势将在此展示。'
          : 'Progress trends will appear here once lessons are assigned and started.',
      tooltipLesson: lang === 'zh' ? '课程' : 'Lesson',
      tooltipProgress: lang === 'zh' ? '完成进度' : 'Progress',
      tooltipDate: lang === 'zh' ? '分配时间' : 'Assigned',
      tooltipStatus: lang === 'zh' ? '状态' : 'Status',
      completed: lang === 'zh' ? '已完成' : 'Completed',
      inProgress: lang === 'zh' ? '进行中' : 'In Progress',
      statAvg: lang === 'zh' ? '平均进度' : 'Avg Progress',
      statCompleted: lang === 'zh' ? '已完成' : 'Completed',
      statTotal: lang === 'zh' ? '总课程数' : 'Total Lessons',
    }),
    [lang],
  );

  /** Transform raw progress data into chart data points */
  const { chartData, stats } = useMemo(() => {
    if (!progressHistory || progressHistory.length === 0) {
      return { chartData: [], stats: { avg: 0, completed: 0, total: 0 } };
    }

    // Sort chronologically by assigned_at, deduplicate by lesson_id (keep latest)
    const latestByLesson = new Map<string, StudentProgressType>();
    for (const p of progressHistory) {
      const existing = latestByLesson.get(p.lesson_id);
      if (!existing || p.assigned_at > existing.assigned_at) {
        latestByLesson.set(p.lesson_id, p);
      }
    }

    const sorted = Array.from(latestByLesson.values()).sort((a, b) => a.assigned_at - b.assigned_at);

    const points: ChartDataPoint[] = sorted.map((p) => {
      const date = new Date(p.assigned_at);
      const dateLabel =
        lang === 'zh'
          ? `${date.getMonth() + 1}月${date.getDate()}日`
          : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

      return {
        label: p.lesson_title.length > 8 ? p.lesson_title.slice(0, 8) + '…' : p.lesson_title,
        lessonTitle: p.lesson_title,
        progressPercent: Math.max(0, Math.min(100, Math.round(p.progress_percent))),
        completed: p.completed === 1,
        dateLabel,
        timestamp: p.assigned_at,
      };
    });

    const totalProgress = points.reduce((sum, p) => sum + p.progressPercent, 0);
    const completedCount = points.filter((p) => p.completed).length;

    return {
      chartData: points,
      stats: {
        avg: points.length > 0 ? Math.round(totalProgress / points.length) : 0,
        completed: completedCount,
        total: points.length,
      },
    };
  }, [progressHistory, lang]);

  // Empty state
  if (chartData.length === 0) {
    return (
      <div
        className="bg-surface rounded-xl border border-border/80 p-3.5 shadow-3xs"
        data-testid="learning-progress-trend-empty"
      >
        <div className="flex items-center gap-1.5 mb-2">
          <TrendingUp size={15} className="text-primary-theme" />
          <h4 className="text-xs font-bold text-foreground">{texts.title}</h4>
        </div>
        <div className="rounded-xl border border-dashed border-border/60 p-4 text-center">
          <AlertCircle size={24} className="mx-auto text-muted mb-1.5" />
          <p className="text-[11px] font-semibold text-muted">{texts.emptyTitle}</p>
          <p className="text-[10px] text-muted mt-0.5">{texts.emptyDesc}</p>
        </div>
      </div>
    );
  }

  const chartHeight = compact ? 180 : 220;

  return (
    <div
      className="bg-surface rounded-xl border border-border/80 p-3.5 shadow-3xs"
      data-testid="learning-progress-trend-chart"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <TrendingUp size={15} className="text-primary-theme" />
          <h4 className="text-xs font-bold text-foreground">{texts.title}</h4>
          <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-md bg-primary-theme/10 text-primary-theme border border-primary-theme/20">
            {texts.badge}
          </span>
        </div>
      </div>

      {/* Mini Stats Row */}
      <div className="grid grid-cols-3 gap-2 mb-2.5">
        <div className="bg-surface-secondary/40 rounded-lg px-2 py-1.5 border border-border/50">
          <div className="text-[10px] text-muted font-medium">{texts.statAvg}</div>
          <div className="text-sm font-extrabold text-foreground font-mono">{stats.avg}%</div>
        </div>
        <div className="bg-surface-secondary/40 rounded-lg px-2 py-1.5 border border-border/50">
          <div className="text-[10px] text-muted font-medium">{texts.statCompleted}</div>
          <div className="text-sm font-extrabold text-emerald-600 dark:text-emerald-400 font-mono">
            {stats.completed}/{stats.total}
          </div>
        </div>
        <div className="bg-surface-secondary/40 rounded-lg px-2 py-1.5 border border-border/50">
          <div className="text-[10px] text-muted font-medium">{texts.statTotal}</div>
          <div className="text-sm font-extrabold text-foreground font-mono">{stats.total}</div>
        </div>
      </div>

      {/* Chart */}
      <div style={{ width: '100%', height: chartHeight }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -25, bottom: 5 }}>
            <defs>
              <linearGradient id="progressGradientFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#6366f1" stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="progressStrokeGrad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#6366f1" />
                <stop offset="50%" stopColor="#818cf8" />
                <stop offset="100%" stopColor="#a78bfa" />
              </linearGradient>
            </defs>

            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" opacity={0.5} />

            <XAxis
              dataKey="label"
              tick={{ fontSize: 10, fill: '#64748b', fontWeight: 600 }}
              axisLine={{ stroke: '#e2e8f0' }}
              tickLine={false}
              interval={chartData.length > 8 ? Math.floor(chartData.length / 6) : 0}
            />
            <YAxis
              domain={[0, 100]}
              ticks={[0, 25, 50, 75, 100]}
              tick={{ fontSize: 10, fill: '#64748b', fontWeight: 600 }}
              axisLine={{ stroke: '#e2e8f0' }}
              tickLine={false}
              tickFormatter={(val: number) => `${val}%`}
            />

            {/* 100% completion reference line */}
            <ReferenceLine
              y={100}
              stroke="#10b981"
              strokeDasharray="4 4"
              strokeWidth={1}
              label={{
                value: lang === 'zh' ? '完成 100%' : '100% Complete',
                fill: '#059669',
                fontSize: 9,
                fontWeight: 700,
                position: 'insideTopRight',
              }}
            />

            {/* Custom Tooltip */}
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload || !payload.length) return null;
                const data = payload[0].payload as ChartDataPoint;
                return (
                  <div className="bg-slate-900 text-white rounded-xl p-2.5 shadow-xl border border-slate-700/80 text-xs min-w-[180px] z-50">
                    <div className="flex items-center gap-1.5 pb-1.5 border-b border-slate-800">
                      <BookOpen size={12} className="text-indigo-300" />
                      <span className="font-bold text-indigo-300 truncate max-w-[150px]">{data.lessonTitle}</span>
                    </div>
                    <div className="pt-1.5 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-300">{texts.tooltipProgress}:</span>
                        <span className="font-extrabold text-emerald-400 font-mono">{data.progressPercent}%</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-300">{texts.tooltipDate}:</span>
                        <span className="text-slate-200 font-mono text-[11px]">{data.dateLabel}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-300">{texts.tooltipStatus}:</span>
                        <span
                          className={`flex items-center gap-1 font-semibold ${data.completed ? 'text-emerald-400' : 'text-amber-400'}`}
                        >
                          <CheckCircle2 size={11} />
                          {data.completed ? texts.completed : texts.inProgress}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              }}
            />

            {/* Primary Area */}
            <Area
              type="monotone"
              dataKey="progressPercent"
              name={lang === 'zh' ? '完成进度' : 'Progress'}
              stroke="url(#progressStrokeGrad)"
              strokeWidth={2.5}
              fill="url(#progressGradientFill)"
              dot={{ r: 3.5, fill: '#6366f1', stroke: '#ffffff', strokeWidth: 2 }}
              activeDot={{ r: 6, stroke: '#a78bfa', strokeWidth: 2, fill: '#ffffff' }}
              animationDuration={600}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
