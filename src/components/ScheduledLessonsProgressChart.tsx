import React, { useMemo } from 'react';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  ReferenceLine
} from 'recharts';
import { 
  BookOpen, 
  Calendar, 
  CheckCircle2, 
  Award, 
  Activity, 
  TrendingUp, 
  Clock 
} from 'lucide-react';

interface Schedule {
  id: string;
  class_id?: string;
  lesson_id: string;
  scheduled_date: string;
  lesson_title?: string;
  title?: string;
}

interface LessonProgress {
  lesson_id: string;
  lesson_title: string;
  average_progress: number;
}

interface ScheduledLessonsProgressChartProps {
  schedules: Schedule[];
  progress: LessonProgress[];
  lang?: 'en' | 'zh';
}

export function ScheduledLessonsProgressChart({ 
  schedules = [], 
  progress = [], 
  lang = 'en' 
}: ScheduledLessonsProgressChartProps) {

  // Chronologically sort schedules and match progress
  const chartData = useMemo(() => {
    if (!schedules || schedules.length === 0) return [];
    
    return [...schedules]
      .sort((a, b) => new Date(a.scheduled_date).getTime() - new Date(b.scheduled_date).getTime())
      .map((sch, idx) => {
        const matchingProg = progress.find(p => p.lesson_id === sch.lesson_id);
        const avgProg = matchingProg ? Math.round(matchingProg.average_progress) : 0;
        
        const dateObj = new Date(sch.scheduled_date);
        const formattedDate = !isNaN(dateObj.getTime())
          ? dateObj.toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric' })
          : sch.scheduled_date;

        return {
          id: sch.id,
          index: idx + 1,
          lessonId: sch.lesson_id,
          lessonTitle: sch.lesson_title || sch.title || `Lesson ${idx + 1}`,
          scheduledDate: sch.scheduled_date,
          dateLabel: formattedDate,
          progress: avgProg
        };
      });
  }, [schedules, progress, lang]);

  // Derived Statistics
  const statistics = useMemo(() => {
    if (chartData.length === 0) {
      return { avgProg: 0, completedCount: 0, pendingCount: 0, activeCount: 0 };
    }
    
    const sum = chartData.reduce((acc, d) => acc + d.progress, 0);
    const avgProg = Math.round(sum / chartData.length);
    const completedCount = chartData.filter(d => d.progress >= 90).length;
    const activeCount = chartData.filter(d => d.progress > 0 && d.progress < 90).length;
    const pendingCount = chartData.filter(d => d.progress === 0).length;

    return { avgProg, completedCount, pendingCount, activeCount };
  }, [chartData]);

  const t = {
    title: lang === 'zh' ? '学期排课进度看板' : 'Scheduled Lessons Progress',
    subtitle: lang === 'zh' ? '班级在全学期已规划课程中的平均学习进度曲线' : "Class average completion progress across the semester's scheduled lessons",
    averageProgress: lang === 'zh' ? '平均课程总进度' : 'Average Class Progress',
    completedLessons: lang === 'zh' ? '已通关课程' : 'Completed Lessons',
    activeLessons: lang === 'zh' ? '进行中课程' : 'Lessons In-Progress',
    pendingLessons: lang === 'zh' ? '未开始课程' : 'Not Started',
    timeline: lang === 'zh' ? '排课进度时间轴' : 'Lesson Progress Timeline',
    over90: lang === 'zh' ? '通关基准线 (90%)' : 'Completion Benchmark (90%)',
    averageLine: lang === 'zh' ? '平均进度线' : 'Class Average Line',
    progressTooltip: lang === 'zh' ? '平均学习进度' : 'Class Avg Progress',
    emptyTitle: lang === 'zh' ? '暂无排课进度' : 'No Scheduled Progress Data',
    emptyDesc: lang === 'zh' ? '该班级尚未规划任何课程。请在下方【日程安排与考勤】中指派具体的微课及日期，随后此处的实时进度图表便会随学生学习进程同步渲染。' : 'No schedules have been defined for this class yet. Assign lessons under the "Schedule & Attendance" panel below to begin visualizing your student group progress trajectory.',
    detailsLabel: lang === 'zh' ? '第 {idx} 节课: {title}' : 'Session #{idx}: {title}'
  };

  if (schedules.length === 0) {
    return (
      <div className="bg-white border border-gray-150 rounded-xl p-6 shadow-sm font-sans">
        <div className="max-w-md mx-auto text-center py-6">
          <div className="inline-flex p-3 bg-pink-50 text-pink-600 rounded-full mb-3">
            <Activity className="w-6 h-6 animate-pulse" />
          </div>
          <h4 className="font-bold text-gray-800 text-sm">{t.emptyTitle}</h4>
          <p className="text-gray-500 text-[11px] mt-2 leading-relaxed">
            {t.emptyDesc}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white border border-gray-150 rounded-xl shadow-xs overflow-hidden flex flex-col font-sans" id="scheduled-lessons-progress-container">
      {/* Visual Header */}
      <div className="p-4 border-b border-gray-100 bg-gray-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <div className="p-2 bg-pink-50 text-pink-600 rounded-lg shrink-0">
            <TrendingUp size={16} />
          </div>
          <div>
            <h4 className="font-bold text-gray-800 text-sm flex items-center gap-1.5 flex-wrap">
              <span>{t.title}</span>
              <span className="inline-flex items-center gap-1 bg-pink-50 text-pink-700 border border-pink-100 rounded-full px-2 py-0.5 text-[9px] font-bold">
                <span className="w-1 h-1 rounded-full bg-pink-500 animate-ping"></span>
                {lang === 'zh' ? '实时同步' : 'Live Sync'}
              </span>
            </h4>
            <p className="text-gray-400 text-[10px] mt-0.5 leading-relaxed">{t.subtitle}</p>
          </div>
        </div>
      </div>

      {/* Grid Stats Ribbon */}
      <div className="px-4 py-3 border-b border-gray-100 bg-white grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div className="bg-pink-50/20 border border-pink-100/40 p-2.5 rounded-lg flex items-center gap-2">
          <div className="p-2 bg-pink-50 text-pink-600 rounded-md shrink-0">
            <Activity size={14} />
          </div>
          <div className="min-w-0">
            <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider truncate">{t.averageProgress}</div>
            <div className="text-xs font-bold text-gray-800 font-mono mt-0.5">{statistics.avgProg}%</div>
          </div>
        </div>

        <div className="bg-emerald-50/20 border border-emerald-100/40 p-2.5 rounded-lg flex items-center gap-2">
          <div className="p-2 bg-emerald-50 text-emerald-600 rounded-md shrink-0">
            <CheckCircle2 size={14} />
          </div>
          <div className="min-w-0">
            <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider truncate">{t.completedLessons}</div>
            <div className="text-xs font-bold text-gray-800 font-mono mt-0.5">{statistics.completedCount} / {chartData.length}</div>
          </div>
        </div>

        <div className="bg-yellow-50/20 border border-yellow-100/30 p-2.5 rounded-lg flex items-center gap-2">
          <div className="p-2 bg-yellow-50 text-yellow-600 rounded-md shrink-0">
            <Clock size={14} />
          </div>
          <div className="min-w-0">
            <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider truncate">{t.activeLessons}</div>
            <div className="text-xs font-bold text-gray-800 font-mono mt-0.5">{statistics.activeCount}</div>
          </div>
        </div>

        <div className="bg-slate-50/30 border border-slate-100/60 p-2.5 rounded-lg flex items-center gap-2">
          <div className="p-2 bg-slate-50 text-slate-500 rounded-md shrink-0">
            <BookOpen size={14} />
          </div>
          <div className="min-w-0">
            <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider truncate">{t.pendingLessons}</div>
            <div className="text-xs font-bold text-gray-800 font-mono mt-0.5">{statistics.pendingCount}</div>
          </div>
        </div>
      </div>

      {/* Main Area Chart Content Area */}
      <div className="p-4 space-y-4">
        <div className="text-[10px] font-bold text-pink-900 flex items-center gap-1">
          <Calendar size={11} className="text-pink-500" />
          <span>{t.timeline}</span>
        </div>

        <div className="h-44 w-full bg-slate-50/30 border border-slate-100 p-2 rounded-lg relative">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={chartData}
              margin={{ top: 10, right: 10, left: -24, bottom: 0 }}
            >
              <defs>
                <linearGradient id="progressGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#ec4899" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#ec4899" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis 
                dataKey="dateLabel" 
                tick={{ fontSize: 8, fill: '#64748b', fontWeight: 'bold' }} 
                axisLine={{ stroke: '#e2e8f0' }} 
                tickLine={false}
              />
              <YAxis 
                domain={[0, 100]} 
                tick={{ fontSize: 8, fill: '#64748b', fontWeight: 'bold' }} 
                axisLine={{ stroke: '#e2e8f0' }} 
                tickLine={false}
              />
              <Tooltip 
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    const d = payload[0].payload;
                    return (
                      <div className="p-2.5 bg-white border border-pink-100 rounded-lg shadow-md max-w-[220px]">
                        <div className="flex items-center justify-between gap-2 border-b border-gray-100 pb-1.5 mb-1.5">
                          <span className="text-[8px] text-gray-400 font-bold font-mono">
                            {d.scheduledDate}
                          </span>
                          <span className="inline-flex items-center bg-pink-50 text-pink-700 px-1.5 py-0.5 rounded-full text-[9px] font-extrabold font-mono border border-pink-100">
                            {d.progress}%
                          </span>
                        </div>
                        <p className="text-[10px] font-bold text-gray-800 leading-tight">
                          {t.detailsLabel.replace('{idx}', d.index).replace('{title}', d.lessonTitle)}
                        </p>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <ReferenceLine 
                y={90} 
                stroke="#10b981" 
                strokeWidth={1}
                strokeDasharray="3 3" 
                label={{ 
                  value: t.over90, 
                  fill: '#10b981', 
                  fontSize: 7, 
                  fontWeight: 'bold',
                  position: 'top',
                  offset: 2
                }} 
              />
              <ReferenceLine 
                y={statistics.avgProg} 
                stroke="#ec4899" 
                strokeWidth={1}
                strokeDasharray="2 2" 
                label={{ 
                  value: `${t.averageLine} (${statistics.avgProg}%)`, 
                  fill: '#ec4899', 
                  fontSize: 7, 
                  fontWeight: 'semibold',
                  position: 'bottom',
                  offset: 2
                }} 
              />
              <Area 
                type="monotone" 
                dataKey="progress" 
                stroke="#ec4899" 
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#progressGrad)"
                dot={{ r: 3, stroke: '#ffffff', strokeWidth: 1.5, fill: '#ec4899' }}
                activeDot={{ r: 5, stroke: '#ffffff', strokeWidth: 1.5, fill: '#f43f5e' }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
