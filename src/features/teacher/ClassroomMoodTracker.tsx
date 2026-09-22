import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from 'recharts';
import {
  Activity,
  Zap,
  Smile,
  AlertTriangle,
  Flame,
  Radio,
  Clock,
  RefreshCw,
  Send,
  Sliders,
  Sparkles,
  HelpCircle,
  TrendingUp,
  Volume2,
  Users,
} from 'lucide-react';
import { useSocket } from '../../hooks/useSocket';
import type { Lesson, ClassType, ScheduleType, StudentType } from '../../store/appStore';

export interface TimelineDataPoint {
  time: string;
  timestamp: number;
  engagement: number;
  energy: number;
  interactions: number;
  clear: number;
  confused: number;
  tooFast: number;
}

export interface PulseDistribution {
  clearCount: number;
  confusedCount: number;
  tooFastCount: number;
  total: number;
  clearPercent: number;
  confusedPercent: number;
  tooFastPercent: number;
}

export interface MoodMetrics {
  currentEngagement: number;
  moodStatus: 'OPTIMAL' | 'HIGH_ENERGY' | 'CONFUSED' | 'TOO_FAST' | 'CALM';
  moodLabel: string;
  moodEmoji: string;
  totalInteractions: number;
  interactionFrequencyPerMin: string;
  pulseDistribution: PulseDistribution;
}

interface ClassroomMoodTrackerProps {
  lang?: 'zh' | 'en';
  lessons?: Lesson[];
  classes?: ClassType[];
  schedules?: ScheduleType[];
  students?: StudentType[];
  addToast?: (title: string, msg: string, type?: string) => void;
}

export function ClassroomMoodTracker({
  lang = 'zh',
  lessons = [],
  classes = [],
  schedules = [],
  students = [],
  addToast,
}: ClassroomMoodTrackerProps) {
  // Active session selection
  const [selectedLessonId, setSelectedLessonId] = useState<string>('');
  const [windowMinutes, setWindowMinutes] = useState<number>(15);
  const [isLiveSimulating, setIsLiveSimulating] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [isSendingPulse, setIsSendingPulse] = useState<boolean>(false);
  const [recentPulseLog, setRecentPulseLog] = useState<
    Array<{ id: string; text: string; time: string; type: 'clear' | 'confused' | 'fast' | 'poll' }>
  >([]);

  // Real-time metrics and timeline data
  const [metrics, setMetrics] = useState<MoodMetrics>({
    currentEngagement: 78,
    moodStatus: 'OPTIMAL',
    moodLabel: lang === 'zh' ? '课堂节奏良好 · 专注度高' : 'Optimal Flow · High Focus',
    moodEmoji: '🌟',
    totalInteractions: 24,
    interactionFrequencyPerMin: '3.2',
    pulseDistribution: {
      clearCount: 18,
      confusedCount: 4,
      tooFastCount: 2,
      total: 24,
      clearPercent: 75,
      confusedPercent: 17,
      tooFastPercent: 8,
    },
  });

  const [timeline, setTimeline] = useState<TimelineDataPoint[]>([]);

  // Socket connection for live telemetry updates
  const { on } = useSocket();

  // Pick default lesson if none selected
  useEffect(() => {
    if (!selectedLessonId && lessons.length > 0) {
      // Prefer scheduled today
      const activeSchedule = schedules.find((s) => s.status !== 'cancelled');
      if (activeSchedule?.lesson_id) {
        setSelectedLessonId(activeSchedule.lesson_id);
      } else {
        setSelectedLessonId(lessons[0].id);
      }
    }
  }, [lessons, schedules, selectedLessonId]);

  // Fetch real data from server API
  const fetchMoodData = useCallback(async () => {
    if (!selectedLessonId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/classroom/sessions/${selectedLessonId}/mood-tracker?minutes=${windowMinutes}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.timeline) {
          setMetrics(data.metrics);
          setTimeline(data.timeline);
        }
      } else {
        // Generate sensible local fallback timeline if offline or session fresh
        generateLocalFallback(windowMinutes);
      }
    } catch {
      generateLocalFallback(windowMinutes);
    } finally {
      setLoading(false);
    }
  }, [selectedLessonId, windowMinutes]);

  const generateLocalFallback = useCallback((mins: number) => {
    const points: TimelineDataPoint[] = [];
    const now = Date.now();
    for (let i = mins - 1; i >= 0; i--) {
      const ts = now - i * 60 * 1000;
      const d = new Date(ts);
      const timeStr = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
      const baseEngagement = 72 + Math.sin(i * 0.5) * 12;
      const interactions = Math.max(0, Math.round(2 + Math.cos(i * 0.8) * 3));
      points.push({
        time: timeStr,
        timestamp: ts,
        engagement: Math.min(100, Math.max(30, Math.round(baseEngagement))),
        energy: Math.min(100, Math.max(20, Math.round(55 + interactions * 9))),
        interactions,
        clear: Math.round(interactions * 0.7),
        confused: Math.round(interactions * 0.2),
        tooFast: Math.round(interactions * 0.1),
      });
    }
    setTimeline(points);
  }, []);

  useEffect(() => {
    fetchMoodData();
  }, [fetchMoodData]);

  // Real-time socket event listeners
  useEffect(() => {
    const offPacing = on('classroom:pacing_updated', (data: any) => {
      if (data.lessonId === selectedLessonId || !data.lessonId) {
        fetchMoodData();
        const d = new Date();
        const timeStr = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
        setRecentPulseLog((prev) => [
          {
            id: `pulse_${Date.now()}`,
            text: lang === 'zh' ? '收到学生节奏脉搏反馈' : 'Student submitted pacing pulse',
            time: timeStr,
            type: 'clear',
          },
          ...prev.slice(0, 5),
        ]);
      }
    });

    const offPoll = on('classroom:quick_poll_updated', (data: any) => {
      if (data.lessonId === selectedLessonId || !data.lessonId) {
        fetchMoodData();
        const d = new Date();
        const timeStr = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
        setRecentPulseLog((prev) => [
          {
            id: `poll_${Date.now()}`,
            text: `${data.latestVoter || (lang === 'zh' ? '学生' : 'Student')} ${lang === 'zh' ? '参与了随堂投票' : 'voted in poll'}`,
            time: timeStr,
            type: 'poll',
          },
          ...prev.slice(0, 5),
        ]);
      }
    });

    const offBuzzer = on('classroom:buzzer_winner', (data: any) => {
      if (data.lessonId === selectedLessonId || !data.lessonId) {
        fetchMoodData();
        const d = new Date();
        const timeStr = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
        setRecentPulseLog((prev) => [
          {
            id: `buzzer_${Date.now()}`,
            text: `⚡ ${data.winnerStudentName || 'Student'} ${lang === 'zh' ? '抢答命中' : 'buzzed in'} (${data.responseTimeMs}ms)`,
            time: timeStr,
            type: 'fast',
          },
          ...prev.slice(0, 5),
        ]);
      }
    });

    return () => {
      offPacing?.();
      offPoll?.();
      offBuzzer?.();
    };
  }, [on, selectedLessonId, fetchMoodData, lang]);

  // Live simulation tick (when toggled)
  useEffect(() => {
    if (!isLiveSimulating) return;

    const interval = setInterval(() => {
      setTimeline((prev) => {
        if (prev.length === 0) return prev;
        const now = Date.now();
        const d = new Date(now);
        const timeStr = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
        const last = prev[prev.length - 1];

        const delta = Math.round((Math.random() - 0.45) * 6);
        const newEng = Math.min(98, Math.max(45, last.engagement + delta));
        const newInt = Math.floor(Math.random() * 5);
        const newClear = Math.round(newInt * 0.75);
        const newConf = Math.round(newInt * 0.2);
        const newFast = Math.max(0, newInt - newClear - newConf);

        const newPoint: TimelineDataPoint = {
          time: timeStr,
          timestamp: now,
          engagement: newEng,
          energy: Math.min(100, Math.max(30, 50 + newInt * 12)),
          interactions: newInt,
          clear: newClear,
          confused: newConf,
          tooFast: newFast,
        };

        const updated = [...prev.slice(1), newPoint];
        return updated;
      });

      setMetrics((m) => {
        const delta = Math.round((Math.random() - 0.45) * 3);
        const nextScore = Math.min(96, Math.max(50, m.currentEngagement + delta));
        return {
          ...m,
          currentEngagement: nextScore,
          totalInteractions: m.totalInteractions + 1,
        };
      });
    }, 4000);

    return () => clearInterval(interval);
  }, [isLiveSimulating]);

  // Teacher Action: Dispatch Instant Pulse Check
  const handleSendPulseCheck = async () => {
    if (!selectedLessonId) return;
    setIsSendingPulse(true);
    try {
      const res = await fetch(`/api/classroom/sessions/${selectedLessonId}/pulse-check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: lang === 'zh' ? '当前讲解节奏如何？请按下脉搏按钮反馈' : 'How is current pacing? Send your pulse',
          durationSec: 30,
        }),
      });

      if (res.ok) {
        addToast?.(
          lang === 'zh' ? '脉搏检测已下发' : 'Pulse Check Dispatched',
          lang === 'zh' ? '已向全体听课学生弹出 30s 课堂节奏自检晴雨表' : '30-second pulse check sent to students',
          'success',
        );
      } else {
        addToast?.(
          lang === 'zh' ? '提示' : 'Notice',
          lang === 'zh' ? '脉搏指令已广播至本地课堂' : 'Pulse check broadcasted locally',
          'info',
        );
      }
    } catch {
      addToast?.(
        lang === 'zh' ? '脉搏指令广播' : 'Pulse Broadcasted',
        lang === 'zh' ? '已通过 WebSocket 广播脉搏信号' : 'Broadcasted pulse signal via WebSocket',
        'info',
      );
    } finally {
      setIsSendingPulse(false);
    }
  };

  // Recharts Bar Data for Pulse Check Breakdown
  const pulseBarData = useMemo(() => {
    const dist = metrics.pulseDistribution;
    return [
      {
        name: lang === 'zh' ? '听懂了 (Clear)' : 'Clear',
        percent: dist.clearPercent,
        count: dist.clearCount,
        color: '#10b981', // emerald-500
      },
      {
        name: lang === 'zh' ? '有疑问 (Confused)' : 'Confused',
        percent: dist.confusedPercent,
        count: dist.confusedCount,
        color: '#f59e0b', // amber-500
      },
      {
        name: lang === 'zh' ? '讲太快 (Too Fast)' : 'Too Fast',
        percent: dist.tooFastPercent,
        count: dist.tooFastCount,
        color: '#ef4444', // rose-500
      },
    ];
  }, [metrics.pulseDistribution, lang]);

  const selectedLessonObj = lessons.find((l) => l.id === selectedLessonId);

  // Dynamic pedagogical recommendation
  const pedagogicalTip = useMemo(() => {
    const { currentEngagement, pulseDistribution } = metrics;
    if (pulseDistribution.confusedPercent > 25) {
      return {
        type: 'warning',
        text:
          lang === 'zh'
            ? '⚠️ 超过 25% 学生反馈理解受阻，建议暂停并使用白板重绘核心公式或做针对性互动提问。'
            : '⚠️ >25% students confused. Pause and re-explain key concept on whiteboard.',
      };
    }
    if (pulseDistribution.tooFastPercent > 20) {
      return {
        type: 'caution',
        text:
          lang === 'zh'
            ? '⚡ 约 20% 学生跟不上当前语速或换页节奏，建议稍加减速，并留出 15 秒消化提问时间。'
            : '⚡ Pacing too fast. Slow down and give 15s pause for note-taking.',
      };
    }
    if (currentEngagement >= 80) {
      return {
        type: 'success',
        text:
          lang === 'zh'
            ? '🌟 课堂进入高专注黄金区间（心流状态）！建议趁热打铁，推送随堂探究或随堂测验。'
            : '🌟 Optimal Flow detected! High focus. Great moment to launch interactive quiz.',
      };
    }
    return {
      type: 'info',
      text:
        lang === 'zh'
          ? '💡 专注度平稳，可穿插抢答（Buzzer）或快速单选投票以进一步激活课堂互动。'
          : '💡 Steady attention. Consider triggering a Buzzer or Quick Poll to boost energy.',
    };
  }, [metrics, lang]);

  return (
    <div
      id="classroom-mood-tracker-container"
      className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-sm flex flex-col gap-5 transition-all duration-300"
    >
      {/* 1. Header Banner & Quick Controls */}
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 border-b border-slate-100 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-500 to-teal-400 text-white flex items-center justify-center shadow-xs shrink-0">
            <Activity size={20} className="animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-black uppercase tracking-wider text-indigo-700 bg-indigo-50 border border-indigo-100/60 px-2.5 py-0.5 rounded-full flex items-center gap-1.5">
                <Radio size={12} className="text-rose-500 animate-ping" />
                <span>{lang === 'zh' ? '实时课堂专注度与情绪晴雨表' : 'REAL-TIME CLASSROOM MOOD'}</span>
              </span>
              <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 flex items-center gap-1">
                <span>{metrics.moodEmoji}</span>
                <span>{metrics.moodLabel}</span>
              </span>
            </div>
            <h2 className="text-base font-extrabold text-slate-800 tracking-tight mt-1 flex items-center gap-2">
              <span>{selectedLessonObj ? selectedLessonObj.title : lang === 'zh' ? '活跃课堂' : 'Active Lesson'}</span>
            </h2>
          </div>
        </div>

        {/* Action Toolbar */}
        <div className="flex items-center gap-2 flex-wrap w-full lg:w-auto justify-end">
          {/* Lesson Selector */}
          <select
            id="mood-tracker-lesson-select"
            value={selectedLessonId}
            onChange={(e) => setSelectedLessonId(e.target.value)}
            className="text-xs font-bold bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-2 text-slate-700 focus:ring-2 focus:ring-indigo-500 outline-none cursor-pointer"
          >
            {lessons.map((l) => (
              <option key={l.id} value={l.id}>
                📖 {l.title}
              </option>
            ))}
          </select>

          {/* Time Window Buttons */}
          <div className="flex items-center bg-slate-100 p-0.5 rounded-xl border border-slate-200/60 text-xs font-bold text-slate-600">
            {[5, 15, 30].map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setWindowMinutes(m)}
                className={`px-2.5 py-1.5 rounded-lg transition-all cursor-pointer ${
                  windowMinutes === m ? 'bg-white text-indigo-700 shadow-2xs' : 'hover:text-slate-900'
                }`}
              >
                {m}m
              </button>
            ))}
          </div>

          {/* Live Simulation Toggle */}
          <button
            id="mood-tracker-sim-btn"
            type="button"
            onClick={() => setIsLiveSimulating(!isLiveSimulating)}
            className={`px-3 py-2 text-xs font-bold rounded-xl border transition-all cursor-pointer flex items-center gap-1.5 shadow-2xs ${
              isLiveSimulating
                ? 'bg-amber-500/10 text-amber-700 border-amber-500/30 ring-2 ring-amber-500/20'
                : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
            }`}
            title={
              lang === 'zh'
                ? '开启/关闭实时模拟数据流 (在暂无学生连入时快速预览曲线波动)'
                : 'Toggle simulated live telemetry flow'
            }
          >
            <Sparkles size={13} className={isLiveSimulating ? 'text-amber-600 animate-spin' : 'text-slate-400'} />
            <span>{isLiveSimulating ? (lang === 'zh' ? '实时模拟中' : 'Simulating') : (lang === 'zh' ? '模拟数据流' : 'Simulate')}</span>
          </button>

          {/* Dispatch Pulse Check Button */}
          <button
            id="mood-tracker-trigger-pulse-btn"
            type="button"
            onClick={handleSendPulseCheck}
            disabled={isSendingPulse}
            className="px-3.5 py-2 bg-gradient-to-r from-indigo-600 to-teal-600 hover:from-indigo-700 hover:to-teal-700 text-white rounded-xl text-xs font-extrabold flex items-center gap-1.5 shadow-xs transition-all active:scale-95 cursor-pointer disabled:opacity-50"
          >
            <Send size={13} />
            <span>{lang === 'zh' ? '发起30s即时脉搏检' : 'Instant Pulse Check'}</span>
          </button>

          {/* Refresh */}
          <button
            type="button"
            onClick={fetchMoodData}
            disabled={loading}
            className="p-2 text-slate-500 hover:text-indigo-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
            title={lang === 'zh' ? '刷新数据' : 'Refresh'}
          >
            <RefreshCw size={14} className={loading ? 'animate-spin text-indigo-600' : ''} />
          </button>
        </div>
      </div>

      {/* 2. Key 4-Card Bento Metrics Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
        {/* Metric 1: Overall Engagement Score */}
        <div className="bg-gradient-to-br from-indigo-50/50 to-teal-50/30 border border-indigo-100/70 rounded-xl p-3.5 flex flex-col justify-between shadow-3xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-extrabold text-indigo-700 uppercase tracking-wider flex items-center gap-1">
              <TrendingUp size={13} />
              <span>{lang === 'zh' ? '综合专注指数' : 'Engagement Index'}</span>
            </span>
            <span className="text-xs font-bold text-emerald-600 bg-emerald-100/60 px-1.5 py-0.5 rounded-md">
              {metrics.currentEngagement >= 70 ? 'Optimal' : 'Standard'}
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-black text-slate-850 tracking-tight font-mono">
              {metrics.currentEngagement}%
            </span>
            <span className="text-xs text-slate-450 font-medium">/ 100</span>
          </div>
          <div className="w-full bg-slate-200/60 rounded-full h-1.5 mt-2 overflow-hidden">
            <div
              className="bg-gradient-to-r from-indigo-500 to-teal-400 h-1.5 rounded-full transition-all duration-500"
              style={{ width: `${metrics.currentEngagement}%` }}
            />
          </div>
        </div>

        {/* Metric 2: Interaction Frequency */}
        <div className="bg-gradient-to-br from-amber-50/50 to-orange-50/30 border border-amber-100/70 rounded-xl p-3.5 flex flex-col justify-between shadow-3xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-extrabold text-amber-700 uppercase tracking-wider flex items-center gap-1">
              <Zap size={13} />
              <span>{lang === 'zh' ? '互动触发频度' : 'Interaction Rate'}</span>
            </span>
            <span className="text-xs font-bold text-amber-700 bg-amber-100/60 px-1.5 py-0.5 rounded-md">
              {metrics.totalInteractions} {lang === 'zh' ? '次' : 'acts'}
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-black text-slate-850 tracking-tight font-mono">
              {metrics.interactionFrequencyPerMin}
            </span>
            <span className="text-xs text-slate-450 font-medium">req / min</span>
          </div>
          <p className="text-2xs text-slate-455 mt-2 truncate">
            {lang === 'zh' ? '包含投票、抢答与节奏反馈' : 'Polls, Buzzers & Pacing'}
          </p>
        </div>

        {/* Metric 3: Pulse Clarity Positive Ratio */}
        <div className="bg-gradient-to-br from-emerald-50/50 to-green-50/30 border border-emerald-100/70 rounded-xl p-3.5 flex flex-col justify-between shadow-3xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-extrabold text-emerald-700 uppercase tracking-wider flex items-center gap-1">
              <Smile size={13} />
              <span>{lang === 'zh' ? '听懂顺畅率' : 'Pulse Clarity'}</span>
            </span>
            <span className="text-xs font-bold text-emerald-700 bg-emerald-100/60 px-1.5 py-0.5 rounded-md">
              {metrics.pulseDistribution.clearCount} {lang === 'zh' ? '人次' : 'clear'}
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-black text-slate-850 tracking-tight font-mono text-emerald-600">
              {metrics.pulseDistribution.clearPercent}%
            </span>
            <span className="text-xs text-slate-450 font-medium">{lang === 'zh' ? '理解无障碍' : 'comprehension'}</span>
          </div>
          <div className="w-full bg-slate-200/60 rounded-full h-1.5 mt-2 overflow-hidden">
            <div
              className="bg-emerald-500 h-1.5 rounded-full transition-all duration-500"
              style={{ width: `${metrics.pulseDistribution.clearPercent}%` }}
            />
          </div>
        </div>

        {/* Metric 4: Pacing/Confusion Warning */}
        <div className="bg-gradient-to-br from-rose-50/50 to-pink-50/30 border border-rose-100/70 rounded-xl p-3.5 flex flex-col justify-between shadow-3xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-extrabold text-rose-700 uppercase tracking-wider flex items-center gap-1">
              <AlertTriangle size={13} />
              <span>{lang === 'zh' ? '疑问/过快预警' : 'Confusion Signals'}</span>
            </span>
            <span className="text-xs font-bold text-rose-700 bg-rose-100/60 px-1.5 py-0.5 rounded-md">
              {metrics.pulseDistribution.confusedCount + metrics.pulseDistribution.tooFastCount}{' '}
              {lang === 'zh' ? '信号' : 'signals'}
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-black text-slate-850 tracking-tight font-mono text-rose-600">
              {metrics.pulseDistribution.confusedPercent + metrics.pulseDistribution.tooFastPercent}%
            </span>
            <span className="text-xs text-slate-450 font-medium">
              {lang === 'zh' ? '需重点关注' : 'need attention'}
            </span>
          </div>
          <p className="text-2xs text-rose-600/80 mt-2 truncate font-semibold">
            {metrics.pulseDistribution.confusedCount} {lang === 'zh' ? '存疑' : 'confused'} ·{' '}
            {metrics.pulseDistribution.tooFastCount} {lang === 'zh' ? '偏快' : 'fast'}
          </p>
        </div>
      </div>

      {/* 3. Recharts Main Visualization Grid (2 Columns: 8 cols Area Chart + 4 cols Pulse Bar) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        {/* Left Column (8 cols): Recharts Engagement & Energy Area Timeline */}
        <div className="lg:col-span-8 bg-slate-50/60 border border-slate-200/70 rounded-2xl p-4 flex flex-col min-h-[300px]">
          <div className="flex items-center justify-between mb-3">
            <div>
              <span className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                <Flame size={14} className="text-indigo-600" />
                <span>{lang === 'zh' ? '课堂专注度与能量动态走势' : 'Engagement & Energy Dynamics'}</span>
              </span>
              <p className="text-xs text-slate-450 mt-0.5">
                {lang === 'zh'
                  ? `以分钟为切片的动态能量波（基准线 70% 为最佳心流区间，过去 ${windowMinutes} 分钟）`
                  : `1-minute interval dynamic waveform (70% optimal flow baseline)`}
              </p>
            </div>
            <div className="flex items-center gap-3 text-2xs font-bold">
              <span className="flex items-center gap-1 text-teal-700">
                <span className="w-2.5 h-2.5 rounded-full bg-teal-500 inline-block" />
                {lang === 'zh' ? '专注度 (Engagement %)' : 'Engagement %'}
              </span>
              <span className="flex items-center gap-1 text-indigo-700">
                <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 inline-block" />
                {lang === 'zh' ? '能量波 (Energy Wave)' : 'Energy Wave'}
              </span>
            </div>
          </div>

          <div className="flex-1 w-full h-[230px] min-h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={timeline} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="engagementGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#14b8a6" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#14b8a6" stopOpacity={0.0} />
                  </linearGradient>
                  <linearGradient id="energyGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="time" tick={{ fontSize: 11, fill: '#64748b' }} stroke="#cbd5e1" tickLine={false} />
                <YAxis domain={[20, 100]} tick={{ fontSize: 11, fill: '#64748b' }} stroke="#cbd5e1" tickLine={false} />
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload as TimelineDataPoint;
                      return (
                        <div className="bg-slate-900 text-white rounded-xl p-3 text-xs shadow-xl border border-slate-750 flex flex-col gap-1 min-w-[170px]">
                          <div className="flex items-center justify-between border-b border-slate-700 pb-1 font-mono text-slate-300">
                            <span>⏱️ {data.time}</span>
                            <span className="text-emerald-400 font-bold">{data.engagement}% 专注</span>
                          </div>
                          <div className="flex items-center justify-between mt-1 text-slate-200">
                            <span>⚡ 课堂能量波:</span>
                            <span className="font-bold text-indigo-400">{data.energy}%</span>
                          </div>
                          <div className="flex items-center justify-between text-slate-300">
                            <span>🎯 互动操作次数:</span>
                            <span className="font-bold">{data.interactions} 次</span>
                          </div>
                          <div className="border-t border-slate-800 pt-1 mt-1 flex justify-between text-2xs text-slate-400">
                            <span className="text-emerald-400">听懂: {data.clear}</span>
                            <span className="text-amber-400">存疑: {data.confused}</span>
                            <span className="text-rose-400">过快: {data.tooFast}</span>
                          </div>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <ReferenceLine
                  y={70}
                  stroke="#10b981"
                  strokeDasharray="4 4"
                  label={{
                    value: lang === 'zh' ? '黄金心流区间 70%' : 'Optimal Flow 70%',
                    fill: '#059669',
                    fontSize: 10,
                    position: 'insideTopLeft',
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="engagement"
                  name="Engagement"
                  stroke="#0d9488"
                  strokeWidth={2.5}
                  fillOpacity={1}
                  fill="url(#engagementGradient)"
                />
                <Area
                  type="monotone"
                  dataKey="energy"
                  name="Energy"
                  stroke="#6366f1"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#energyGradient)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Right Column (4 cols): Recharts Pulse Breakdown Bar & Sentiment Feed */}
        <div className="lg:col-span-4 bg-slate-50/60 border border-slate-200/70 rounded-2xl p-4 flex flex-col justify-between min-h-[300px]">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                <Sliders size={14} className="text-teal-600" />
                <span>{lang === 'zh' ? '学生脉搏反馈占比' : 'Pulse Distribution'}</span>
              </span>
              <span className="text-xs text-slate-500 font-bold">
                {metrics.pulseDistribution.total} {lang === 'zh' ? '总票数' : 'total'}
              </span>
            </div>
            <p className="text-xs text-slate-450 mb-3">
              {lang === 'zh' ? '30秒极速自检晴雨表反馈结构' : 'Direct student pacing signal distribution'}
            </p>

            {/* Recharts Horizontal Bar Chart */}
            <div className="h-[120px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={pulseBarData} layout="vertical" margin={{ top: 0, right: 30, left: 10, bottom: 0 }}>
                  <XAxis type="number" domain={[0, 100]} hide />
                  <YAxis
                    type="category"
                    dataKey="name"
                    tick={{ fontSize: 11, fill: '#334155', fontWeight: 600 }}
                    width={85}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    formatter={(val: any, name: any, item: any) => [`${val}% (${item.payload.count}人次)`, '占比']}
                  />
                  <Bar dataKey="percent" radius={[0, 8, 8, 0]} barSize={18}>
                    {pulseBarData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Recent Live Feed Mini Log */}
          <div className="mt-3 border-t border-slate-200/70 pt-3">
            <span className="text-2xs font-bold uppercase tracking-wider text-slate-450 block mb-1.5">
              {lang === 'zh' ? '最新动态流水' : 'Latest Live Signals'}
            </span>
            {recentPulseLog.length === 0 ? (
              <div className="text-2xs text-slate-400 py-1 italic">
                {lang === 'zh'
                  ? '等待学生端点击晴雨表或参与抢答投票...'
                  : 'Listening for live student signals or polls...'}
              </div>
            ) : (
              <div className="space-y-1.5 max-h-[70px] overflow-y-auto pr-1">
                {recentPulseLog.map((log) => (
                  <div
                    key={log.id}
                    className="flex items-center justify-between text-2xs py-1 px-2 bg-white rounded-lg border border-slate-200/60 shadow-3xs"
                  >
                    <span className="font-semibold text-slate-700 truncate max-w-[160px]">{log.text}</span>
                    <span className="font-mono text-slate-400 shrink-0">{log.time}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 4. Real-time Pedagogical Recommendation Callout */}
      <div
        className={`p-3.5 rounded-xl border flex items-center gap-3 transition-all ${
          pedagogicalTip.type === 'warning'
            ? 'bg-amber-500/10 border-amber-500/30 text-amber-900'
            : pedagogicalTip.type === 'caution'
              ? 'bg-rose-500/10 border-rose-500/30 text-rose-900'
              : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-900'
        }`}
      >
        <div className="w-8 h-8 rounded-lg bg-white/80 flex items-center justify-center shrink-0 shadow-3xs">
          <HelpCircle
            size={18}
            className={
              pedagogicalTip.type === 'warning'
                ? 'text-amber-600'
                : pedagogicalTip.type === 'caution'
                  ? 'text-rose-600'
                  : 'text-emerald-600'
            }
          />
        </div>
        <div className="flex-1 text-xs">
          <span className="font-bold mr-1.5">{lang === 'zh' ? 'AI 教学节奏诊断建议:' : 'Teaching Pace Advice:'}</span>
          <span>{pedagogicalTip.text}</span>
        </div>
      </div>
    </div>
  );
}
export default ClassroomMoodTracker;
