import React, { useState, useEffect } from 'react';
import {
  BrainCircuit,
  AlertTriangle,
  Lightbulb,
  CheckCircle2,
  TrendingUp,
  BatteryCharging,
  Coffee,
  HelpCircle,
  RefreshCw,
  ChevronRight,
  Sparkles,
} from 'lucide-react';

export interface PreClassDiagnosticHubProps {
  lessonId: string | null;
  classId: string | null;
  lang?: 'zh' | 'en';
}

interface DiagnosticData {
  lessonId: string;
  lessonTitle: string;
  prepSummary: {
    totalStudents: number;
    completedCount: number;
    pendingCount: number;
    completionRate: number;
    averageTimeSpentMins: number;
  };
  topMistakes: {
    rank: number;
    concept: string;
    mistakeRate: number;
    sampleQuestion: string;
    pedagogicalAdvice: string;
    status: string;
  }[];
  studentDistribution: {
    tierA_mastered: number;
    tierB_consolidating: number;
    tierC_needSupport: number;
  };
  icebreakerStats: {
    fullPower: number;
    needCoffee: number;
    needHelp: number;
  };
}

export function PreClassDiagnosticHub({ lessonId, classId, lang = 'zh' }: PreClassDiagnosticHubProps) {
  const [data, setData] = useState<DiagnosticData | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedMistake, setExpandedMistake] = useState<number | null>(1);

  const fetchDiagnostic = () => {
    if (!lessonId) return;
    setLoading(true);
    fetch(`/api/lessons/${lessonId}/pre-class-diagnostic${classId ? `?classId=${encodeURIComponent(classId)}` : ''}`)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load diagnostic');
        return res.json();
      })
      .then((resData) => {
        setData(resData);
      })
      .catch((err) => {
        console.warn('[PreClassDiagnosticHub] fetch fallback:', err);
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchDiagnostic();
  }, [lessonId, classId]);

  if (!lessonId) {
    return null;
  }

  const prepSummary = data?.prepSummary || {
    totalStudents: 0,
    completedCount: 0,
    pendingCount: 0,
    completionRate: 0,
    averageTimeSpentMins: 0,
  };

  const topMistakes = data?.topMistakes || [];

  const icebreaker = data?.icebreakerStats || { fullPower: 0, needCoffee: 0, needHelp: 0 };
  const rawTotalIcebreaker = icebreaker.fullPower + icebreaker.needCoffee + icebreaker.needHelp;
  const hasIcebreaker = rawTotalIcebreaker > 0;
  const totalIcebreaker = Math.max(1, rawTotalIcebreaker);

  return (
    <div className="bg-surface border border-theme rounded-2xl p-4 shadow-sm flex flex-col gap-3">
      {/* 标题栏 */}
      <div className="flex items-center justify-between border-b border-theme pb-2.5">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
            <BrainCircuit size={16} />
          </div>
          <div>
            <h3 className="text-xs font-black uppercase text-main tracking-wider flex items-center gap-1.5">
              <span>{lang === 'zh' ? '预习学情穿透看板 (以学定教)' : 'Pre-Lesson Diagnostic Hub'}</span>
              <span className="px-1.5 py-0.2 rounded-md bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 text-[10px] font-mono font-bold">
                AI Diagnostic
              </span>
            </h3>
          </div>
        </div>

        <button
          onClick={fetchDiagnostic}
          disabled={loading}
          className="p-1 text-muted hover:text-main rounded-md hover:bg-surface-secondary transition-colors cursor-pointer"
          title={lang === 'zh' ? '刷新学情数据' : 'Refresh Diagnostics'}
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* 预习完成进度概览 */}
      <div className="grid grid-cols-2 gap-2">
        <div className="p-2.5 rounded-xl bg-surface-secondary/60 border border-theme/60 flex flex-col justify-between">
          <span className="text-[11px] text-muted font-medium">{lang === 'zh' ? '预习视频/导学完成' : 'Prep Completed'}</span>
          <div className="flex items-baseline gap-1.5 mt-1">
            <span className="text-base font-black text-emerald-600 dark:text-emerald-400 font-mono">
              {prepSummary.completionRate}%
            </span>
            <span className="text-2xs text-muted font-mono">
              ({prepSummary.completedCount}/{prepSummary.totalStudents} 人)
            </span>
          </div>
          <div className="w-full bg-slate-200 dark:bg-slate-700 h-1.5 rounded-full overflow-hidden mt-1.5">
            <div
              className="bg-emerald-500 h-full rounded-full transition-all duration-500"
              style={{ width: `${prepSummary.completionRate}%` }}
            />
          </div>
        </div>

        <div className="p-2.5 rounded-xl bg-surface-secondary/60 border border-theme/60 flex flex-col justify-between">
          <span className="text-[11px] text-muted font-medium">{lang === 'zh' ? '全班心态基线调研' : 'Class Energy Baseline'}</span>
          {hasIcebreaker ? (
            <>
              <div className="flex items-center justify-between gap-1 text-xs mt-1 font-bold">
                <span className="text-amber-500 flex items-center gap-0.5 text-2xs" title="满格电量">
                  ⚡ {Math.round((icebreaker.fullPower / totalIcebreaker) * 100)}%
                </span>
                <span className="text-blue-500 flex items-center gap-0.5 text-2xs" title="需要充能">
                  ☕ {Math.round((icebreaker.needCoffee / totalIcebreaker) * 100)}%
                </span>
                <span className="text-rose-500 flex items-center gap-0.5 text-2xs" title="需要求助">
                  🆘 {Math.round((icebreaker.needHelp / totalIcebreaker) * 100)}%
                </span>
              </div>
              <div className="w-full h-1.5 rounded-full overflow-hidden flex gap-0.5 mt-1.5 bg-slate-200 dark:bg-slate-700">
                <div style={{ width: `${(icebreaker.fullPower / totalIcebreaker) * 100}%` }} className="bg-amber-400" />
                <div style={{ width: `${(icebreaker.needCoffee / totalIcebreaker) * 100}%` }} className="bg-blue-400" />
                <div style={{ width: `${(icebreaker.needHelp / totalIcebreaker) * 100}%` }} className="bg-rose-400" />
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center py-2 text-2xs text-muted">
              <span>{lang === 'zh' ? '等待学生课前打卡破冰' : 'Awaiting student check-in'}</span>
            </div>
          )}
        </div>
      </div>

      {/* Top 3 疑难卡点穿透分析 */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-2xs text-muted font-bold px-0.5">
          <span className="flex items-center gap-1 text-rose-600 dark:text-rose-400">
            <AlertTriangle size={11} />
            <span>{lang === 'zh' ? '前置导学测验错误率最高 Top 3 疑难卡点' : 'Top 3 Diagnostic Stumbling Blocks'}</span>
          </span>
          <span>{lang === 'zh' ? '点击展开以学定教建议' : 'Click for strategies'}</span>
        </div>

        {topMistakes.length === 0 ? (
          <div className="p-3 rounded-xl border border-dashed border-theme/60 bg-surface-secondary/20 text-center text-2xs text-muted">
            {lang === 'zh'
              ? '暂无前置练习错题卡点，学生完成前置导学测验后将自动分析高频失分概念。'
              : 'No diagnostic stumbling blocks found. Student quiz errors will appear here.'}
          </div>
        ) : (
          <div className="space-y-1.5">
            {topMistakes.map((m) => {
              const isExpanded = expandedMistake === m.rank;
              return (
                <div
                  key={m.rank}
                  onClick={() => setExpandedMistake(isExpanded ? null : m.rank)}
                  className={`p-2.5 rounded-xl border transition-all cursor-pointer ${
                    isExpanded
                      ? 'bg-rose-50/40 dark:bg-rose-950/20 border-rose-400/50 shadow-2xs'
                      : 'bg-surface-secondary/40 border-theme/60 hover:bg-surface-secondary'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-black shrink-0 ${
                        m.rank === 1
                          ? 'bg-rose-500 text-white'
                          : m.rank === 2
                            ? 'bg-amber-500 text-white'
                            : 'bg-slate-400 text-white'
                      }`}
                    >
                      {m.rank}
                    </span>
                    <span className="text-xs font-bold text-main truncate">{m.concept}</span>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-2xs font-mono font-bold text-rose-600 dark:text-rose-400">
                      错率 {m.mistakeRate}%
                    </span>
                    <ChevronRight
                      size={12}
                      className={`text-muted transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}
                    />
                  </div>
                </div>

                {isExpanded && (
                  <div className="mt-2 pt-2 border-t border-rose-200/50 dark:border-rose-900/50 space-y-1.5 text-2xs animate-fadeIn">
                    <div className="text-muted">
                      <span className="font-semibold text-main">{lang === 'zh' ? '典型错题：' : 'Sample Trap: '}</span>
                      {m.sampleQuestion}
                    </div>
                    <div className="flex items-start gap-1 text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 p-1.5 rounded-lg border border-emerald-500/20 font-medium">
                      <Lightbulb size={12} className="shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400" />
                      <span>
                        <span className="font-bold">{lang === 'zh' ? '以学定教建议：' : 'Teaching Strategy: '}</span>
                        {m.pedagogicalAdvice}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        )}
      </div>
    </div>
  );
}
