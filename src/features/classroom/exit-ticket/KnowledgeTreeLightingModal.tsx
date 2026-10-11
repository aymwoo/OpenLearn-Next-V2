import React, { useState } from 'react';
import { X, Sparkles, TreeDeciduous, Award, CheckCircle2, Lock, ArrowRight } from 'lucide-react';

export interface KnowledgeTreeLightingModalProps {
  isOpen: boolean;
  onClose: () => void;
  lessonTitle?: string;
  className?: string;
  /** 全班达成度（来自真实结课通票均分换算；无通票为 0） */
  masteryPercent?: number; // 0~100
  /** v0.6.1 数据真实性：树节点来自本课学生真实反馈的困惑点（结课通票收集），
   *  不再使用写死的物理课示例节点。无反馈时呈现空态。 */
  puzzledConcepts?: string[];
  lang?: 'zh' | 'en';
}

export const KnowledgeTreeLightingModal: React.FC<KnowledgeTreeLightingModalProps> = ({
  isOpen,
  onClose,
  lessonTitle,
  className,
  masteryPercent = 0,
  puzzledConcepts = [],
  lang = 'zh',
}) => {
  const concepts = puzzledConcepts.map((c) => c.trim()).filter(Boolean).slice(0, 3);
  const [isLighting, setIsLighting] = useState(false);
  const [isFullyLit, setIsFullyLit] = useState(false);

  if (!isOpen) return null;

  const zh = lang === 'zh';

  // 空态：本课未收集到困惑点反馈 —— 没有可点亮的知识树，如实呈现
  if (concepts.length === 0) {
    return (
      <div
        data-testid="knowledge-tree-lighting-modal"
        className="fixed inset-0 z-[125] bg-black/75 backdrop-blur-md flex items-center justify-center p-4 md:p-6 animate-fade-in select-none text-main"
      >
        <div className="bg-surface border border-theme rounded-3xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col">
          <div className="bg-surface-secondary/80 px-6 py-4 border-b border-theme flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-amber-500/10 text-amber-500 flex items-center justify-center border border-amber-500/20">
                <TreeDeciduous size={22} />
              </div>
              <h2 className="text-base font-black text-main">
                {zh ? '课堂知识树即时点亮仪式' : 'Knowledge Tree Lighting'}
              </h2>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-xl hover:bg-surface text-muted hover:text-main transition-colors cursor-pointer"
              aria-label="Close"
            >
              <X size={20} />
            </button>
          </div>
          <div className="p-10 flex flex-col items-center gap-3 text-center">
            <TreeDeciduous size={36} className="text-muted" />
            <p className="text-sm font-bold text-main">
              {zh ? '本课暂未收集到困惑点反馈' : 'No confused concepts collected this lesson'}
            </p>
            <p className="text-xs text-muted leading-relaxed max-w-xs">
              {zh
                ? '知识树由学生在结课通票中反馈的真实困惑点生成。本节课没有收到任何困惑点，无树可点亮。'
                : 'The tree grows from confused concepts reported in exit tickets. None were collected this lesson.'}
            </p>
            <button
              onClick={onClose}
              className="mt-2 px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs transition-colors cursor-pointer"
            >
              {zh ? '我知道了' : 'Got it'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="knowledge-tree-lighting-modal"
      className="fixed inset-0 z-[125] bg-black/75 backdrop-blur-md flex items-center justify-center p-4 md:p-6 animate-fade-in select-none text-main"
    >
      <div className="bg-surface border border-theme rounded-3xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-surface-secondary/80 px-6 py-4 border-b border-theme flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-500/10 text-amber-500 flex items-center justify-center border border-amber-500/20">
              <TreeDeciduous size={22} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-black text-main">
                  {zh ? '课堂知识树即时点亮仪式' : 'Knowledge Tree Lighting Ceremony'}
                </h2>
                <span className="px-2 py-0.5 rounded-full text-3xs font-mono font-bold bg-amber-500/10 text-amber-600 border border-amber-500/20">
                  Real Exit Tickets
                </span>
              </div>
              <p className="text-2xs text-muted mt-0.5">
                {className ? `${className} · ` : ''}《{lessonTitle || (zh ? '本堂课' : 'This lesson')}》
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-xl hover:bg-surface text-muted hover:text-main transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        {/* 知识树展示画布区 —— 节点 = 学生真实反馈的困惑点 */}
        <div className="p-8 bg-gradient-to-b from-surface to-surface-secondary/40 flex flex-col items-center justify-center relative overflow-hidden">
          {isFullyLit && (
            <div className="absolute inset-0 pointer-events-none bg-radial from-amber-500/10 via-transparent to-transparent animate-pulse" />
          )}

          <div className="w-full max-w-2xl flex flex-col md:flex-row items-center justify-between gap-6 z-10 py-6">
            {concepts.map((concept, index) => {
              const isLit = isFullyLit;
              return (
                <React.Fragment key={concept}>
                  <div
                    className={`flex-1 w-full rounded-2xl p-5 border transition-all duration-700 flex flex-col items-center text-center gap-3 shadow-md relative ${
                      isLit
                        ? 'bg-amber-500/10 border-amber-500/50 shadow-amber-500/10 scale-105 ring-2 ring-amber-400/40'
                        : 'bg-surface-secondary/50 border-theme/60 opacity-60'
                    }`}
                  >
                    <div
                      className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all duration-700 ${
                        isLit
                          ? 'bg-gradient-to-br from-amber-400 to-amber-600 text-white shadow-lg shadow-amber-500/30'
                          : 'bg-surface border border-theme text-muted'
                      }`}
                    >
                      {isLit ? <Sparkles size={22} className="animate-spin-slow" /> : <Lock size={20} />}
                    </div>

                    <div className="flex flex-col gap-1">
                      <span className="text-3xs font-mono font-bold uppercase text-muted">
                        {zh ? `困惑点 ${index + 1}` : `Concept ${index + 1}`}
                      </span>
                      <h4 className="text-xs font-black text-main leading-tight">{concept}</h4>
                    </div>

                    <p className="text-[11px] text-muted leading-relaxed max-w-[180px]">
                      {zh ? '学生结课通票真实反馈' : 'Reported in student exit tickets'}
                    </p>

                    <div className="mt-1 pt-2 border-t border-theme/60 w-full flex items-center justify-between text-2xs font-mono font-bold">
                      <span className="text-muted">{zh ? '复盘状态' : 'Review'}</span>
                      <span className={isLit ? 'text-amber-600 dark:text-amber-400' : 'text-muted'}>
                        {isLit ? (zh ? '已集体复盘点亮' : 'Reviewed') : zh ? '待复盘' : 'Pending'}
                      </span>
                    </div>
                  </div>

                  {index < concepts.length - 1 && (
                    <div className="hidden md:flex text-muted/60">
                      <ArrowRight size={24} className={isFullyLit ? 'text-amber-500 animate-pulse' : ''} />
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>

          {/* 底部点亮大按钮与全班达成勋章 */}
          <div className="mt-4 flex flex-col items-center gap-3 z-10">
            {!isFullyLit ? (
              <button
                type="button"
                disabled={isLighting}
                onClick={() => {
                  setIsLighting(true);
                  setTimeout(() => {
                    setIsLighting(false);
                    setIsFullyLit(true);
                  }, 700);
                }}
                className="px-8 py-3 rounded-2xl bg-gradient-to-r from-amber-500 via-amber-600 to-amber-500 hover:scale-105 text-white font-black text-sm flex items-center gap-2 shadow-xl shadow-amber-500/25 transition-all cursor-pointer"
              >
                <Sparkles size={18} />
                <span>
                  {isLighting ? (zh ? '正在连接知识图谱...' : 'Lighting...') : zh ? '🌟 点亮本堂课困惑点知识树' : 'Light Up Tree'}
                </span>
              </button>
            ) : (
              <div
                data-testid="tree-lit-badge"
                className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/40 text-center flex flex-col items-center gap-1.5 animate-bounce-subtle"
              >
                <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 font-black text-sm">
                  <Award size={20} />
                  <CheckCircle2 size={20} />
                  <span>
                    {zh
                      ? `${concepts.length} 个真实困惑点已全班集体复盘！`
                      : `${concepts.length} real concepts reviewed by the class!`}
                  </span>
                </div>
                <p className="text-xs text-muted max-w-md">
                  {zh
                    ? '以上困惑点全部来自本课学生的结课通票反馈，建议下节课针对性巩固。'
                    : 'All concepts came from real student exit tickets. Consolidate them next lesson.'}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
