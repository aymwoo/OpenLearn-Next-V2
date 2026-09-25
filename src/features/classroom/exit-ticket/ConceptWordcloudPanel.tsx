import React, { useState } from 'react';
import {
  Sparkles,
  AlertTriangle,
  Lightbulb,
  Copy,
  Check,
  Award,
  ChevronDown,
  ChevronUp,
  Flame,
  TreeDeciduous,
} from 'lucide-react';
import type { ClusteredConcept } from './types';

export interface ConceptWordcloudPanelProps {
  concepts: ClusteredConcept[];
  totalFeedbackCount: number;
  avgRating: number;
  tierDistribution?: {
    passed: number;
    remediation: number;
    challenge_done: number;
  };
  onOpenKnowledgeTree?: () => void;
  lang?: 'zh' | 'en';
}

export const ConceptWordcloudPanel: React.FC<ConceptWordcloudPanelProps> = ({
  concepts,
  totalFeedbackCount,
  avgRating,
  tierDistribution = { passed: 18, remediation: 6, challenge_done: 8 },
  onOpenKnowledgeTree,
  lang = 'zh',
}) => {
  const [activeConceptIndex, setActiveConceptIndex] = useState<number | null>(0);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const handleCopyAdvice = (text: string, idx: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(idx);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const totalTier = tierDistribution.passed + tierDistribution.remediation + tierDistribution.challenge_done || 1;

  return (
    <div
      data-testid="concept-wordcloud-panel"
      className="bg-surface rounded-2xl border border-theme p-5 shadow-sm flex flex-col gap-4 text-main"
    >
      {/* 头部：标题与仪式感点亮知识树入口 */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-theme pb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center font-bold">
            <Flame size={16} />
          </div>
          <div>
            <h3 className="text-xs font-black uppercase text-main tracking-wider flex items-center gap-1.5">
              <span>{lang === 'zh' ? '全班困惑概念聚类词云与收口总结' : 'Top Puzzled Concepts & Summary'}</span>
            </h3>
            <p className="text-3xs text-muted">
              {totalFeedbackCount} {lang === 'zh' ? '份真实结课通票聚类分析' : 'student tickets analyzed'}
            </p>
          </div>
        </div>

        {onOpenKnowledgeTree && (
          <button
            type="button"
            onClick={onOpenKnowledgeTree}
            className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white font-extrabold text-xs flex items-center gap-1.5 shadow-xs transition-all cursor-pointer hover:scale-[1.02]"
          >
            <TreeDeciduous size={14} />
            <span>{lang === 'zh' ? '🌟 点亮本堂课知识树' : 'Light Up Knowledge Tree'}</span>
          </button>
        )}
      </div>

      {/* 梯级达成度小看板 */}
      <div className="grid grid-cols-3 gap-2 p-2.5 rounded-xl bg-surface-secondary/60 border border-theme/60 text-center text-xs">
        <div className="flex flex-col items-center">
          <span className="text-3xs text-muted font-bold">{lang === 'zh' ? '思维跃迁(挑战完成)' : 'Challenge Done'}</span>
          <span className="font-mono font-black text-emerald-600 text-sm mt-0.5">
            {tierDistribution.challenge_done} <span className="text-3xs text-muted">({Math.round((tierDistribution.challenge_done / totalTier) * 100)}%)</span>
          </span>
        </div>
        <div className="flex flex-col items-center border-x border-theme/60">
          <span className="text-3xs text-muted font-bold">{lang === 'zh' ? '基础通关(掌握良好)' : 'Core Passed'}</span>
          <span className="font-mono font-black text-indigo-600 text-sm mt-0.5">
            {tierDistribution.passed} <span className="text-3xs text-muted">({Math.round((tierDistribution.passed / totalTier) * 100)}%)</span>
          </span>
        </div>
        <div className="flex flex-col items-center">
          <span className="text-3xs text-muted font-bold">{lang === 'zh' ? '支架补强(存在卡点)' : 'Remediation'}</span>
          <span className="font-mono font-black text-rose-500 text-sm mt-0.5">
            {tierDistribution.remediation} <span className="text-3xs text-muted">({Math.round((tierDistribution.remediation / totalTier) * 100)}%)</span>
          </span>
        </div>
      </div>

      {/* 动态卡点词云气泡群 */}
      <div className="flex flex-col gap-2">
        <span className="text-2xs font-extrabold text-muted uppercase tracking-wider flex items-center gap-1">
          <AlertTriangle size={12} className="text-amber-500" />
          <span>{lang === 'zh' ? '点击气泡展开 2 分钟收口教学建议：' : 'Click bubble for 2-min recap advice:'}</span>
        </span>

        <div className="flex flex-wrap gap-2.5 pt-1">
          {concepts.map((item, idx) => {
            const isActive = activeConceptIndex === idx;
            // 依据权重自适应气泡尺寸
            const sizeClass = idx === 0
              ? 'text-xs px-3.5 py-1.5'
              : idx === 1
                ? 'text-xs px-3 py-1.2'
                : 'text-2xs px-2.5 py-1';

            return (
              <button
                key={item.concept}
                type="button"
                onClick={() => setActiveConceptIndex(isActive ? null : idx)}
                className={`rounded-2xl font-bold flex items-center gap-1.5 transition-all cursor-pointer border shadow-2xs ${sizeClass} ${
                  isActive
                    ? 'bg-amber-500 text-white border-amber-600 ring-2 ring-amber-400/40 scale-105'
                    : 'bg-amber-500/10 text-amber-800 dark:text-amber-200 border-amber-500/30 hover:bg-amber-500/20'
                }`}
              >
                <span>🔥</span>
                <span>{item.concept}</span>
                <span className={`font-mono text-3xs px-1.5 py-0.2 rounded-full ${
                  isActive ? 'bg-amber-700/60 text-white' : 'bg-surface border border-theme text-muted'
                }`}>
                  {item.frequency}人
                </span>
                {isActive ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </button>
            );
          })}
        </div>
      </div>

      {/* 展开的收口总结建议话术 */}
      {activeConceptIndex !== null && concepts[activeConceptIndex] && (
        <div
          data-testid="recap-advice-box"
          className="p-3.5 rounded-2xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-500/30 text-amber-900 dark:text-amber-200 flex flex-col gap-2 animate-fade-in"
        >
          <div className="flex items-center justify-between">
            <span className="font-extrabold text-xs flex items-center gap-1.5">
              <Lightbulb size={14} className="text-amber-600 dark:text-amber-400" />
              <span>「{concepts[activeConceptIndex].concept}」收口突破话术建议</span>
            </span>
            <button
              type="button"
              onClick={() => handleCopyAdvice(concepts[activeConceptIndex].remediationAdvice, activeConceptIndex)}
              className="px-2 py-0.5 rounded-md bg-surface text-main border border-theme text-3xs font-bold hover:bg-surface-secondary flex items-center gap-1 cursor-pointer transition-colors"
            >
              {copiedIndex === activeConceptIndex ? <Check size={11} className="text-emerald-500" /> : <Copy size={11} />}
              <span>{copiedIndex === activeConceptIndex ? '已复制' : '复制话术'}</span>
            </button>
          </div>

          <p className="text-2xs leading-relaxed font-medium">
            {concepts[activeConceptIndex].remediationAdvice}
          </p>
        </div>
      )}
    </div>
  );
};
