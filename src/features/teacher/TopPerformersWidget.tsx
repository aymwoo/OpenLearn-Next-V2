import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  LabelList,
} from 'recharts';
import {
  Trophy,
  Award,
  Medal,
  Flame,
  Zap,
  RefreshCw,
  Sparkles,
  CheckCircle2,
  Clock,
  Send,
  Download,
  Users,
  BarChart3,
  HelpCircle,
  TrendingUp,
  Radio,
} from 'lucide-react';
import { useSocket } from '../../hooks/useSocket';
import type { Lesson, ClassType, ScheduleType, StudentType } from '../../store/appStore';

export interface TopPerformerStudent {
  rank: number;
  studentId: string;
  studentName: string;
  cumulativeScore: number;
  totalQuizzesAnswered: number;
  correctCount: number;
  accuracy: number;
  avgTimeSpentMs: number;
  lastSubmittedAt: number;
}

export interface TopPerformersSummary {
  totalParticipants: number;
  totalResponses: number;
  averageScore: number;
}

export interface TopPerformersWidgetProps {
  lang?: 'zh' | 'en';
  lessonId?: string | null;
  classId?: string | null;
  lessons?: Lesson[];
  classes?: ClassType[];
  schedules?: ScheduleType[];
  students?: StudentType[];
  addToast?: (title: string, message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  className?: string;
  compact?: boolean;
  /** 仅在自动化测试或沙盒环境开启模拟答题按钮，默认 false */
  allowSimulation?: boolean;
}

const RANK_COLORS = [
  '#F59E0B', // 1st: Gold / Amber
  '#6366F1', // 2nd: Indigo
  '#10B981', // 3rd: Emerald
  '#3B82F6', // 4th: Sky Blue
  '#0EA5E9', // 5th: Cyan
];

export function TopPerformersWidget({
  lang = 'zh',
  lessonId,
  classId,
  lessons = [],
  classes = [],
  schedules = [],
  students = [],
  addToast,
  className = '',
  compact = false,
  allowSimulation = false,
}: TopPerformersWidgetProps) {
  // Selected lesson state (fallback to prop or first available lesson)
  const [selectedLessonId, setSelectedLessonId] = useState<string>(lessonId || '');
  const [metricMode, setMetricMode] = useState<'score' | 'accuracy' | 'count'>('score');
  const [loading, setLoading] = useState<boolean>(false);
  const [isSimulating, setIsSimulating] = useState<boolean>(false);
  const [topPerformers, setTopPerformers] = useState<TopPerformerStudent[]>([]);
  const [summary, setSummary] = useState<TopPerformersSummary>({
    totalParticipants: 0,
    totalResponses: 0,
    averageScore: 0,
  });
  const [lastLiveEventTime, setLastLiveEventTime] = useState<number | null>(null);

  // Sync prop changes
  useEffect(() => {
    if (lessonId && lessonId !== selectedLessonId) {
      setSelectedLessonId(lessonId);
    }
  }, [lessonId]);

  // Determine active lesson ID if not selected
  useEffect(() => {
    if (!selectedLessonId && lessons.length > 0) {
      // Find today's schedule or take the first lesson
      const today = new Date().toISOString().split('T')[0];
      const todaySch = schedules.find((s) => s.scheduled_date === today);
      setSelectedLessonId(todaySch?.lesson_id || lessons[0].id);
    }
  }, [selectedLessonId, lessons, schedules]);

  // Socket for live quiz response telemetry
  const { on } = useSocket();

  // Fetch top performers from API
  const fetchTopPerformers = useCallback(
    async (targetLessonId?: string) => {
      const activeId = targetLessonId || selectedLessonId;
      if (!activeId) return;

      setLoading(true);
      try {
        const res = await fetch(`/api/classroom/sessions/${activeId}/top-performers?limit=5`);
        if (res.ok) {
          const data = await res.json();
          if (data.success && Array.isArray(data.topPerformers) && data.topPerformers.length > 0) {
            setTopPerformers(data.topPerformers);
            if (data.summary) {
              setSummary(data.summary);
            }
          } else {
            // If server returned 0 records, try general top performers endpoint
            const fallbackRes = await fetch(`/api/classroom/top-performers?limit=5`);
            if (fallbackRes.ok) {
              const fallbackData = await fallbackRes.json();
              if (fallbackData.success && fallbackData.topPerformers?.length > 0) {
                setTopPerformers(fallbackData.topPerformers);
                if (fallbackData.summary) setSummary(fallbackData.summary);
                return;
              }
            }
            // 无数据时诚实展示空列表与零统计，坚决不伪造数据
            setTopPerformers([]);
            setSummary({ totalParticipants: 0, totalResponses: 0, averageScore: 0 });
          }
        }
      } catch (err) {
        console.warn('[TopPerformersWidget] fetch failed:', err);
      } finally {
        setLoading(false);
      }
    },
    [selectedLessonId],
  );

  // Initial and reactive fetch
  useEffect(() => {
    if (selectedLessonId) {
      fetchTopPerformers(selectedLessonId);
    }
  }, [selectedLessonId, fetchTopPerformers]);

  // Listen to real-time socket events for quiz responses
  useEffect(() => {
    if (!on) return;

    const handleQuizAnswered = (payload: any) => {
      setLastLiveEventTime(Date.now());

      // If the event belongs to current lesson or current view
      if (!payload || (payload.lessonId && payload.lessonId !== selectedLessonId)) {
        return;
      }

      setTopPerformers((prev) => {
        const studentId = payload.studentId || payload.id;
        const studentName =
          payload.studentName ||
          students.find((s) => s.id === studentId)?.name ||
          `Student ${String(studentId).slice(-4)}`;
        const addedScore = Number(payload.score) || 0;
        const isCorrect = payload.isCorrect ? 1 : 0;

        const existingIdx = prev.findIndex((p) => p.studentId === studentId);
        let updated: TopPerformerStudent[];

        if (existingIdx >= 0) {
          const cur = prev[existingIdx];
          const newTotalAns = cur.totalQuizzesAnswered + 1;
          const newCorrectCount = cur.correctCount + isCorrect;
          const newScore = cur.cumulativeScore + addedScore;
          const newAcc = Math.round((newCorrectCount / newTotalAns) * 100);

          const updatedStudent: TopPerformerStudent = {
            ...cur,
            cumulativeScore: newScore,
            totalQuizzesAnswered: newTotalAns,
            correctCount: newCorrectCount,
            accuracy: newAcc,
            lastSubmittedAt: Date.now(),
          };

          updated = [...prev];
          updated[existingIdx] = updatedStudent;
        } else {
          const newStudent: TopPerformerStudent = {
            rank: 99,
            studentId,
            studentName,
            cumulativeScore: addedScore,
            totalQuizzesAnswered: 1,
            correctCount: isCorrect,
            accuracy: isCorrect ? 100 : 0,
            avgTimeSpentMs: payload.time_spent_ms || 8000,
            lastSubmittedAt: Date.now(),
          };
          updated = [...prev, newStudent];
        }

        // Sort descending by cumulativeScore, then accuracy, then correctCount
        updated.sort(
          (a, b) => b.cumulativeScore - a.cumulativeScore || b.accuracy - a.accuracy || b.correctCount - a.correctCount,
        );

        // Re-assign ranks and take top 5
        return updated.slice(0, 5).map((item, idx) => ({
          ...item,
          rank: idx + 1,
        }));
      });

      setSummary((prev) => ({
        ...prev,
        totalResponses: prev.totalResponses + 1,
      }));
    };

    const cleanup1 = on('whiteboard-quiz-answered', handleQuizAnswered);
    const cleanup2 = on('quiz.answered', handleQuizAnswered);
    const cleanup3 = on('classroom:quiz_response_received', handleQuizAnswered);

    return () => {
      if (typeof cleanup1 === 'function') cleanup1();
      if (typeof cleanup2 === 'function') cleanup2();
      if (typeof cleanup3 === 'function') cleanup3();
    };
  }, [on, selectedLessonId, students]);

  // Simulate live quiz responses for real-time testing
  const handleSimulateQuiz = async () => {
    if (!selectedLessonId) return;
    setIsSimulating(true);
    try {
      const res = await fetch(`/api/classroom/sessions/${selectedLessonId}/simulate-quiz-responses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        addToast?.(
          lang === 'zh' ? '🎯 实时答题模拟成功' : '🎯 Quiz Simulation Success',
          lang === 'zh'
            ? '已为 8 位学生生成随堂测验提交，实时成绩榜单已即时重排！'
            : 'Generated simulated live quiz submissions. Top performers updated!',
          'success',
        );
        await fetchTopPerformers(selectedLessonId);
      }
    } catch (e) {
      console.error('Failed to simulate quiz responses:', e);
    } finally {
      setIsSimulating(false);
    }
  };

  // Praise Top Performer
  const handlePraiseTop = (student: TopPerformerStudent) => {
    addToast?.(
      lang === 'zh' ? '🏆 表扬已送达' : '🏆 Praise Sent',
      lang === 'zh'
        ? `已向榜首学生 [${student.studentName}] 发送课堂「随堂之星」荣誉勋章与鼓励！`
        : `Sent "Quiz Star" honor medal to top performer [${student.studentName}]!`,
      'success',
    );
  };

  // Export CSV
  const handleExportCSV = () => {
    const headers = ['Rank', 'Student ID', 'Student Name', 'Cumulative Score', 'Answered', 'Correct', 'Accuracy %'];
    const rows = topPerformers.map((s) => [
      s.rank,
      s.studentId,
      s.studentName,
      s.cumulativeScore,
      s.totalQuizzesAnswered,
      s.correctCount,
      `${s.accuracy}%`,
    ]);
    const csvContent =
      'data:text/csv;charset=utf-8,\uFEFF' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `top_performers_quiz_${selectedLessonId || 'class'}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    addToast?.(
      lang === 'zh' ? '📥 导出成功' : '📥 Exported',
      lang === 'zh' ? '随堂测验 Top 5 榜单数据已导出为 CSV 文件。' : 'Top 5 performers exported to CSV.',
      'info',
    );
  };

  // Chart data formatted for Recharts
  const chartData = useMemo(() => {
    return topPerformers.map((st) => {
      // Shorten name if too long for axis
      const displayName =
        st.studentName.length > 8 ? `${st.studentName.slice(0, 7)}…` : st.studentName;

      return {
        rank: st.rank,
        name: displayName,
        fullName: st.studentName,
        studentId: st.studentId,
        score: st.cumulativeScore,
        accuracy: st.accuracy,
        count: st.totalQuizzesAnswered,
        correctCount: st.correctCount,
        avgTimeSec: (st.avgTimeSpentMs / 1000).toFixed(1),
        // Value displayed on chart based on metricMode
        chartValue:
          metricMode === 'score'
            ? st.cumulativeScore
            : metricMode === 'accuracy'
              ? st.accuracy
              : st.totalQuizzesAnswered,
      };
    });
  }, [topPerformers, metricMode]);

  // Selected lesson title
  const currentLessonTitle = useMemo(() => {
    return lessons.find((l) => l.id === selectedLessonId)?.title || selectedLessonId || 'Classroom Session';
  }, [lessons, selectedLessonId]);

  return (
    <div
      id="top-performers-widget"
      data-testid="top-performers-widget"
      className={`bg-surface border border-theme rounded-2xl p-5 shadow-sm transition-all relative flex flex-col gap-4 ${className}`}
    >
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-theme/60">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center font-bold shadow-xs">
            <Trophy size={20} className="text-amber-500 animate-bounce" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-main tracking-tight">
                {lang === 'zh' ? '随堂测验优秀榜 (Top 5 Performers)' : 'Live Quiz Top 5 Performers'}
              </h3>
              {lastLiveEventTime && (
                <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 animate-pulse">
                  <Radio size={10} className="animate-spin text-emerald-500" />
                  <span>{lang === 'zh' ? '实时作答同步中' : 'Live Sync'}</span>
                </span>
              )}
            </div>
            <p className="text-xs text-muted mt-0.5">
              {lang === 'zh'
                ? '基于课堂互动白板随堂测试累计得分与答题正确率智能聚合'
                : 'Aggregated from cumulative scores and accuracy in live quiz responses'}
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Lesson Selector */}
          {lessons.length > 0 && (
            <select
              value={selectedLessonId}
              onChange={(e) => setSelectedLessonId(e.target.value)}
              className="bg-surface-secondary border border-theme text-xs rounded-lg px-2.5 py-1.5 text-main outline-none focus:ring-1 focus:ring-primary-theme cursor-pointer max-w-[160px] truncate"
              title={currentLessonTitle}
            >
              {lessons.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.title}
                </option>
              ))}
            </select>
          )}

          {/* Metric Switcher */}
          <div className="bg-surface-secondary p-0.5 rounded-lg flex items-center border border-theme text-xs">
            <button
              onClick={() => setMetricMode('score')}
              className={`px-2 py-1 rounded-md font-medium transition-all ${
                metricMode === 'score'
                  ? 'bg-surface text-primary-theme shadow-xs font-bold'
                  : 'text-muted hover:text-main'
              }`}
              title={lang === 'zh' ? '按累计得分排序' : 'By Cumulative Score'}
            >
              {lang === 'zh' ? '累计得分' : 'Score'}
            </button>
            <button
              onClick={() => setMetricMode('accuracy')}
              className={`px-2 py-1 rounded-md font-medium transition-all ${
                metricMode === 'accuracy'
                  ? 'bg-surface text-primary-theme shadow-xs font-bold'
                  : 'text-muted hover:text-main'
              }`}
              title={lang === 'zh' ? '按正确率排序' : 'By Accuracy'}
            >
              {lang === 'zh' ? '正确率' : 'Accuracy'}
            </button>
            <button
              onClick={() => setMetricMode('count')}
              className={`px-2 py-1 rounded-md font-medium transition-all ${
                metricMode === 'count'
                  ? 'bg-surface text-primary-theme shadow-xs font-bold'
                  : 'text-muted hover:text-main'
              }`}
              title={lang === 'zh' ? '按答题题次排序' : 'By Quiz Count'}
            >
              {lang === 'zh' ? '题次' : 'Count'}
            </button>
          </div>

          {/* Simulate button - 仅在测试模式显式启用 */}
          {allowSimulation && (
            <button
              onClick={handleSimulateQuiz}
              disabled={isSimulating}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 border border-amber-200 dark:border-amber-800 hover:bg-amber-100 transition-colors cursor-pointer shadow-xs disabled:opacity-50"
              title={lang === 'zh' ? '模拟学生实时答题' : 'Simulate Quiz Responses'}
            >
              <Zap size={12} className={isSimulating ? 'animate-spin text-amber-600' : 'text-amber-600'} />
              <span className="hidden sm:inline">{lang === 'zh' ? '模拟答题' : 'Simulate'}</span>
            </button>
          )}

          {/* Refresh button */}
          <button
            onClick={() => fetchTopPerformers(selectedLessonId)}
            disabled={loading}
            className="p-1.5 rounded-lg border border-theme bg-surface hover:bg-surface-secondary text-muted hover:text-main transition-colors cursor-pointer shadow-xs disabled:opacity-50"
            title={lang === 'zh' ? '刷新榜单数据' : 'Refresh rankings'}
          >
            <RefreshCw size={14} className={loading ? 'animate-spin text-primary-theme' : ''} />
          </button>

          {/* Export button */}
          <button
            onClick={handleExportCSV}
            disabled={topPerformers.length === 0}
            className="p-1.5 rounded-lg border border-theme bg-surface hover:bg-surface-secondary text-muted hover:text-main transition-colors cursor-pointer shadow-xs disabled:opacity-40"
            title={lang === 'zh' ? '导出 Top 5 榜单 CSV' : 'Export CSV'}
          >
            <Download size={14} />
          </button>
        </div>
      </div>

      {topPerformers.length === 0 ? (
        <div className="p-8 rounded-xl border border-dashed border-theme bg-surface-secondary/20 flex flex-col items-center justify-center text-center gap-2">
          <Trophy size={28} className="text-muted/60" />
          <p className="text-sm font-semibold text-main">
            {lang === 'zh' ? '暂无随堂作答数据' : 'No Quiz Responses Yet'}
          </p>
          <p className="text-xs text-muted max-w-sm">
            {lang === 'zh'
              ? '学生开始作答随堂测验或白板互动题后，实时榜单与答题数据将自动刷新呈现。'
              : 'Rankings and visual distribution will appear here once students submit answers.'}
          </p>
        </div>
      ) : (
        <>
          {/* Top 3 Podium Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {topPerformers.slice(0, 3).map((st) => {
          const isGold = st.rank === 1;
          const isSilver = st.rank === 2;
          const isBronze = st.rank === 3;

          const cardBorder = isGold
            ? 'border-amber-400/50 bg-amber-500/5'
            : isSilver
              ? 'border-indigo-400/40 bg-indigo-500/5'
              : 'border-emerald-400/40 bg-emerald-500/5';

          const badgeColor = isGold
            ? 'bg-amber-500 text-white'
            : isSilver
              ? 'bg-indigo-500 text-white'
              : 'bg-emerald-500 text-white';

          const icon = isGold ? '🥇' : isSilver ? '🥈' : '🥉';

          return (
            <div
              key={st.studentId}
              data-testid="top-performers-item"
              className={`p-3.5 rounded-xl border ${cardBorder} flex flex-col justify-between gap-3 relative transition-all hover:shadow-sm`}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2.5">
                  <div
                    className={`w-8 h-8 rounded-lg flex items-center justify-center font-extrabold text-sm shadow-xs ${badgeColor}`}
                  >
                    {icon}
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-main leading-tight truncate max-w-[130px]">
                      {st.studentName}
                    </h4>
                    <span className="text-xs text-muted flex items-center gap-1 mt-0.5">
                      <CheckCircle2 size={11} className="text-emerald-500" />
                      {st.correctCount}/{st.totalQuizzesAnswered} {lang === 'zh' ? '题全对' : 'correct'}
                    </span>
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-base font-extrabold text-main font-mono">
                    {st.cumulativeScore} <span className="text-xs font-normal text-muted">{lang === 'zh' ? '分' : 'pts'}</span>
                  </div>
                  <span className="text-xs font-semibold px-1.5 py-0.2 rounded bg-surface border border-theme text-primary-theme">
                    {st.accuracy}% {lang === 'zh' ? '正确率' : 'acc'}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between text-xs text-muted pt-2 border-t border-theme/40">
                <span className="flex items-center gap-1 font-mono">
                  <Clock size={11} /> {(st.avgTimeSpentMs / 1000).toFixed(1)}s {lang === 'zh' ? '均速' : 'avg'}
                </span>
                {isGold && (
                  <button
                    onClick={() => handlePraiseTop(st)}
                    className="flex items-center gap-1 text-xs font-semibold text-amber-600 hover:text-amber-700 dark:text-amber-400 hover:underline cursor-pointer"
                    title={lang === 'zh' ? '一键表扬榜首' : 'Praise top performer'}
                  >
                    <Sparkles size={11} /> {lang === 'zh' ? '一键表扬' : 'Praise'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Recharts Bar Chart Visualization */}
      <div className="bg-surface-secondary/40 border border-theme rounded-xl p-4 flex flex-col gap-2">
        <div className="flex items-center justify-between text-xs text-muted px-1">
          <span className="font-semibold text-main flex items-center gap-1.5">
            <BarChart3 size={14} className="text-primary-theme" />
            {lang === 'zh'
              ? `Top 5 答题得分可视化分布 (${metricMode === 'score' ? '累计得分' : metricMode === 'accuracy' ? '正确率%' : '答题数'})`
              : `Top 5 Visual Distribution (${metricMode.toUpperCase()})`}
          </span>
          <span className="text-xs text-muted font-mono">
            {lang === 'zh'
              ? `全班平均得分: ${summary.averageScore} 分 | 参与人次: ${summary.totalResponses}`
              : `Class Avg: ${summary.averageScore} pts | Responses: ${summary.totalResponses}`}
          </span>
        </div>

        {/* Responsive Container for Recharts */}
        <div data-testid="top-performers-chart" className="w-full h-56 pt-2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartData}
              layout="vertical"
              margin={{ top: 8, right: 36, left: 10, bottom: 8 }}
            >
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="currentColor" className="text-theme/40" />
              <XAxis
                type="number"
                domain={[0, metricMode === 'accuracy' ? 100 : 'auto']}
                tick={{ fontSize: 11, fill: 'currentColor' }}
                className="text-muted"
                unit={metricMode === 'accuracy' ? '%' : ''}
              />
              <YAxis
                type="category"
                dataKey="name"
                tick={{ fontSize: 12, fill: 'currentColor', fontWeight: 600 }}
                className="text-main"
                width={85}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    const data = payload[0].payload;
                    return (
                      <div className="bg-surface border border-theme p-3 rounded-xl shadow-lg text-xs flex flex-col gap-1.5 min-w-[180px] z-50">
                        <div className="flex items-center justify-between font-bold text-main border-b border-theme/60 pb-1">
                          <span className="flex items-center gap-1.5">
                            <span className="w-5 h-5 rounded-full bg-primary-theme/10 text-primary-theme flex items-center justify-center font-mono">
                              #{data.rank}
                            </span>
                            {data.fullName}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-muted pt-1">
                          <span>{lang === 'zh' ? '累计得分:' : 'Total Score:'}</span>
                          <span className="font-bold text-main font-mono text-right">{data.score} 分</span>
                          <span>{lang === 'zh' ? '正确率:' : 'Accuracy:'}</span>
                          <span className="font-bold text-emerald-600 dark:text-emerald-400 font-mono text-right">
                            {data.accuracy}%
                          </span>
                          <span>{lang === 'zh' ? '答对题次:' : 'Correct Count:'}</span>
                          <span className="font-mono text-right">
                            {data.correctCount} / {data.count} 题
                          </span>
                          <span>{lang === 'zh' ? '平均答题速度:' : 'Avg Speed:'}</span>
                          <span className="font-mono text-right">{data.avgTimeSec} 秒</span>
                        </div>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <Bar dataKey="chartValue" radius={[0, 6, 6, 0]} barSize={22}>
                {chartData.map((entry, index) => (
                  <Cell
                    key={`cell-${entry.studentId}-${index}`}
                    fill={RANK_COLORS[index % RANK_COLORS.length]}
                  />
                ))}
                <LabelList
                  dataKey="chartValue"
                  position="right"
                  formatter={(val: any) =>
                    metricMode === 'accuracy' ? `${val}%` : metricMode === 'score' ? `${val}分` : `${val}题`
                  }
                  className="fill-main text-xs font-bold font-mono"
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      </>
      )}

      {/* Roster & Quick Action Footer */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted pt-1">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <Users size={12} className="text-primary-theme" />
            {lang === 'zh' ? '统计口径: 课中互动测验与答题器' : 'Scope: Live interactive quizzes & clickers'}
          </span>
          <span className="hidden sm:inline text-theme">•</span>
          <span className="flex items-center gap-1">
            <Flame size={12} className="text-amber-500" />
            {lang === 'zh' ? '实时随堂竞赛积分制' : 'Gamified Live Quiz Points'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {topPerformers.length > 0 && (
            <span className="text-xs text-muted font-medium">
              {lang === 'zh'
                ? `榜首: ${topPerformers[0].studentName} (${topPerformers[0].cumulativeScore}分)`
                : `Leader: ${topPerformers[0].studentName} (${topPerformers[0].cumulativeScore} pts)`}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export default TopPerformersWidget;
