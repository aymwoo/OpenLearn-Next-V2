/**
 * MasteryPredictionModal — AI 实时学情预测（in-class）
 *
 * 上课流程扩展 #2：从 ClassroomInteractiveCockpit 的工具栏打开，
 * 实时预测本节课结束时每个学生在 5 个维度的掌握度（0-100）。
 * AI 失败时降级为本地启发式（基于 participationScore 推算）。
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  X,
  RefreshCw,
  Sparkles,
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
  CheckCircle2,
  Brain,
} from 'lucide-react';
import { ExtensionPointRenderer } from '../../../plugin-host/extension-point-renderer';

// ── 类型 ────────────────────────────────────────────────────────────

export interface StudentPaceSnapshot {
  studentId: string;
  studentName: string;
  participationScore: number;
  quizScore?: number;
  paceIndicator: 'fast' | 'on-track' | 'slow' | 'stalled';
  behaviorSignals: string[];
}

export interface MasteryPredictionModalProps {
  isOpen: boolean;
  onClose: () => void;
  lessonId: string | null;
  lessonTitle: string;
  currentStageName: string;
  elapsedMin: number;
  plannedTotalMin: number;
  studentSnapshots: StudentPaceSnapshot[];
  addToast: (title: string, message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  lang?: 'zh' | 'en';
}

interface Prediction {
  studentId: string;
  studentName: string;
  prediction: {
    algorithmic: number;
    engineering: number;
    creativity: number;
    collaboration: number;
    focus: number;
  };
  risk: 'low' | 'medium' | 'high';
  note: string;
}

interface PredictionResponse {
  lessonId: string;
  generatedAt: number;
  aiSucceeded: boolean;
  currentStage: string;
  predictions: Prediction[];
}

// ── 主组件 ──────────────────────────────────────────────────────────

const DIMENSIONS: Array<{ key: keyof Prediction['prediction']; label: string; color: string }> = [
  { key: 'algorithmic', label: '算法逻辑', color: 'bg-indigo-500' },
  { key: 'engineering', label: '代码工程', color: 'bg-cyan-500' },
  { key: 'creativity', label: '创新思维', color: 'bg-purple-500' },
  { key: 'collaboration', label: '团队协作', color: 'bg-pink-500' },
  { key: 'focus', label: '课堂专注', color: 'bg-amber-500' },
];

export const MasteryPredictionModal: React.FC<MasteryPredictionModalProps> = ({
  isOpen,
  onClose,
  lessonId,
  lessonTitle,
  currentStageName,
  elapsedMin,
  plannedTotalMin,
  studentSnapshots,
  addToast,
  lang = 'zh',
}) => {
  const [response, setResponse] = useState<PredictionResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [sortBy, setSortBy] = useState<'risk' | 'name' | 'composite'>('risk');

  const predict = useCallback(async () => {
    if (!lessonId || studentSnapshots.length === 0) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/classroom/${lessonId}/predict-mastery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lessonTitle,
          currentStageName,
          elapsedMin,
          plannedTotalMin,
          studentSnapshots,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
      const data: PredictionResponse = await res.json();
      setResponse(data);
    } catch (e: any) {
      addToast(
        lang === 'zh' ? '❌ 预测失败' : '❌ Prediction failed',
        e?.message ?? 'Unknown error',
        'error',
      );
    } finally {
      setLoading(false);
    }
  }, [lessonId, lessonTitle, currentStageName, elapsedMin, plannedTotalMin, studentSnapshots, addToast, lang]);

  useEffect(() => {
    if (isOpen && !response && !loading) {
      void predict();
    }
    if (!isOpen) {
      setResponse(null);
    }
  }, [isOpen, response, loading, predict]);

  if (!isOpen) return null;

  const progressPercent = Math.min(100, Math.round((elapsedMin / Math.max(1, plannedTotalMin)) * 100));

  // 排序预测
  const sortedPredictions = response
    ? [...response.predictions].sort((a, b) => {
        if (sortBy === 'risk') {
          const rank = (r: string) => (r === 'high' ? 0 : r === 'medium' ? 1 : 2);
          return rank(a.risk) - rank(b.risk);
        }
        if (sortBy === 'name') {
          return a.studentName.localeCompare(b.studentName);
        }
        // composite
        const ca = Object.values(a.prediction).reduce((s, v) => s + v, 0) / 5;
        const cb = Object.values(b.prediction).reduce((s, v) => s + v, 0) / 5;
        return ca - cb;
      })
    : [];

  // 风险聚合
  const riskCounts = response?.predictions.reduce(
    (acc, p) => {
      acc[p.risk] = (acc[p.risk] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  ) ?? {};

  return (
    <div className="fixed inset-0 z-[110] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-surface border border-theme rounded-2xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* ── Header ─────────────────────────────────────────── */}
        <div className="bg-surface-secondary px-6 py-4 border-b border-theme flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary-theme/10 flex items-center justify-center">
              <Brain size={20} className="text-primary-theme" />
            </div>
            <div>
              <h2 className="text-base font-extrabold text-main">
                {lang === 'zh' ? 'AI 实时学情预测' : 'AI Mastery Prediction'}
              </h2>
              <p className="text-xs text-muted mt-0.5">
                {lessonTitle} · {currentStageName} · {elapsedMin}/{plannedTotalMin} min ({progressPercent}%)
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={predict}
              disabled={loading}
              className="px-3 py-1.5 text-xs font-bold rounded-lg border border-theme text-main hover:bg-surface transition-colors flex items-center gap-1.5 disabled:opacity-50"
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
              {lang === 'zh' ? '重新预测' : 'Re-predict'}
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-surface text-muted hover:text-main transition-colors"
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* ── Progress Bar + Risk Summary ──────────────────── */}
        <div className="px-6 py-3 border-b border-theme bg-surface shrink-0">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-xs font-bold text-muted">
              {lang === 'zh' ? '课堂进度' : 'Progress'}
            </span>
            <div className="flex-1 h-2 rounded-full bg-surface-secondary overflow-hidden">
              <div
                className="h-full bg-primary-theme transition-all"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <span className="text-xs font-bold text-main">{progressPercent}%</span>
          </div>
          {response && (
            <div className="flex items-center gap-3 text-xs">
              <RiskBadge level="high" count={riskCounts.high ?? 0} lang={lang} />
              <RiskBadge level="medium" count={riskCounts.medium ?? 0} lang={lang} />
              <RiskBadge level="low" count={riskCounts.low ?? 0} lang={lang} />
              <span className="ml-auto text-muted">
                {response.aiSucceeded ? (
                  <span className="inline-flex items-center gap-1 text-emerald-600">
                    <Sparkles size={10} /> AI
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-muted">
                    <Minus size={10} /> {lang === 'zh' ? '降级模式' : 'Fallback'}
                  </span>
                )}
              </span>
            </div>
          )}
        </div>

        {/* ── Sort Controls ────────────────────────────────── */}
        <div className="px-6 pt-3 flex items-center gap-2 text-xs shrink-0">
          <span className="text-muted">{lang === 'zh' ? '排序' : 'Sort'}:</span>
          <button
            onClick={() => setSortBy('risk')}
            className={`px-2.5 py-1 rounded font-bold ${
              sortBy === 'risk' ? 'bg-primary-theme text-white' : 'bg-surface-secondary text-main'
            }`}
          >
            {lang === 'zh' ? '风险优先' : 'Risk'}
          </button>
          <button
            onClick={() => setSortBy('composite')}
            className={`px-2.5 py-1 rounded font-bold ${
              sortBy === 'composite' ? 'bg-primary-theme text-white' : 'bg-surface-secondary text-main'
            }`}
          >
            {lang === 'zh' ? '综合掌握' : 'Composite'}
          </button>
          <button
            onClick={() => setSortBy('name')}
            className={`px-2.5 py-1 rounded font-bold ${
              sortBy === 'name' ? 'bg-primary-theme text-white' : 'bg-surface-secondary text-main'
            }`}
          >
            {lang === 'zh' ? '姓名' : 'Name'}
          </button>
          <ExtensionPointRenderer slot="classroom.pacing.dashboard" />
        </div>

        {/* ── Student Cards ────────────────────────────────── */}
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin p-6 space-y-3">
          {loading && !response ? (
            <div className="flex flex-col items-center justify-center gap-3 py-12 text-muted">
              <Sparkles size={32} className="animate-pulse text-primary-theme" />
              <p className="text-sm font-bold">
                {lang === 'zh' ? 'AI 正在分析本节课学情…' : 'AI analyzing class mastery…'}
              </p>
            </div>
          ) : sortedPredictions.length === 0 ? (
            <div className="text-center text-muted text-sm py-8">
              {lang === 'zh' ? '暂无学生数据' : 'No student data'}
            </div>
          ) : (
            sortedPredictions.map((p) => (
              <StudentPredictionCard key={p.studentId} prediction={p} lang={lang} />
            ))
          )}
        </div>

        {/* ── Footer ───────────────────────────────────────── */}
        <div className="bg-surface-secondary px-6 py-3 border-t border-theme text-xs text-muted flex items-center justify-between shrink-0">
          <span>
            {response && (
              <>
                {lang === 'zh' ? '预测基于' : 'Based on'}: {studentSnapshots.length}{' '}
                {lang === 'zh' ? '位学生实时数据' : 'students'} ·{' '}
                {new Date(response.generatedAt).toLocaleTimeString()}
              </>
            )}
          </span>
          <span className="inline-flex items-center gap-1">
            <Sparkles size={10} />
            {lang === 'zh'
              ? 'AI 输出仅供参考，最终判断请结合教学经验'
              : 'AI suggestions only — combine with teaching experience'}
          </span>
        </div>
      </div>
    </div>
  );
};

// ── 子组件 ──────────────────────────────────────────────────────────

const StudentPredictionCard: React.FC<{ prediction: Prediction; lang: 'zh' | 'en' }> = ({
  prediction,
  lang,
}) => {
  const composite = Object.values(prediction.prediction).reduce((s, v) => s + v, 0) / 5;
  const trend = composite >= 75 ? 'up' : composite >= 55 ? 'flat' : 'down';
  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'flat' ? Minus : TrendingDown;
  const riskColor =
    prediction.risk === 'high'
      ? 'border-rose-500 bg-rose-50'
      : prediction.risk === 'medium'
      ? 'border-amber-500 bg-amber-50'
      : 'border-emerald-500 bg-emerald-50';

  return (
    <div className={`border-2 rounded-xl p-4 bg-surface ${riskColor}`}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="font-extrabold text-sm text-main">{prediction.studentName}</span>
          <RiskPill level={prediction.risk} lang={lang} />
        </div>
        <div className="flex items-center gap-1.5 text-xs">
          <TrendIcon
            size={14}
            className={
              trend === 'up' ? 'text-emerald-600' : trend === 'flat' ? 'text-muted' : 'text-rose-600'
            }
          />
          <span className="font-bold text-main">{Math.round(composite)}</span>
          <span className="text-muted">{lang === 'zh' ? '综合' : 'Avg'}</span>
        </div>
      </div>

      <div className="grid grid-cols-5 gap-2 mb-3">
        {DIMENSIONS.map((dim) => {
          const value = prediction.prediction[dim.key];
          return (
            <div key={dim.key} className="space-y-1">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-muted">{dim.label}</span>
                <span className="font-bold text-main">{value}</span>
              </div>
              <div className="h-1.5 rounded-full bg-surface-secondary overflow-hidden">
                <div className={`h-full ${dim.color} transition-all`} style={{ width: `${value}%` }} />
              </div>
            </div>
          );
        })}
      </div>

      {prediction.note && (
        <div className="text-xs text-muted flex items-start gap-1.5">
          <AlertTriangle size={10} className="mt-0.5 shrink-0" />
          <span>{prediction.note}</span>
        </div>
      )}
    </div>
  );
};

const RiskBadge: React.FC<{ level: 'low' | 'medium' | 'high'; count: number; lang: 'zh' | 'en' }> = ({
  level,
  count,
  lang,
}) => {
  const color =
    level === 'high' ? 'bg-rose-100 text-rose-700' : level === 'medium' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700';
  const label =
    level === 'high'
      ? lang === 'zh' ? '高风险' : 'High Risk'
      : level === 'medium'
      ? lang === 'zh' ? '中风险' : 'Medium'
      : lang === 'zh' ? '低风险' : 'Low';
  return (
    <span className={`px-2 py-0.5 rounded-full font-bold ${color}`}>
      {label}: {count}
    </span>
  );
};

const RiskPill: React.FC<{ level: 'low' | 'medium' | 'high'; lang: 'zh' | 'en' }> = ({ level, lang }) => {
  const color =
    level === 'high'
      ? 'bg-rose-500 text-white'
      : level === 'medium'
      ? 'bg-amber-500 text-white'
      : 'bg-emerald-500 text-white';
  const Icon = level === 'low' ? CheckCircle2 : AlertTriangle;
  const label =
    level === 'high'
      ? lang === 'zh' ? '需关注' : 'Alert'
      : level === 'medium'
      ? lang === 'zh' ? '观察' : 'Watch'
      : lang === 'zh' ? '良好' : 'Good';
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold inline-flex items-center gap-1 ${color}`}>
      <Icon size={10} />
      {label}
    </span>
  );
};