import React, { useState } from 'react';
import {
  X,
  Sparkles,
  TreeDeciduous,
  Award,
  CheckCircle2,
  Lock,
  ArrowRight,
  TrendingUp,
  Share2,
} from 'lucide-react';
import type { KnowledgeTreeNode } from './types';

export interface KnowledgeTreeLightingModalProps {
  isOpen: boolean;
  onClose: () => void;
  lessonTitle?: string;
  className?: string;
  masteryPercent?: number; // 0~100
  lang?: 'zh' | 'en';
}

const DEFAULT_TREE_NODES: KnowledgeTreeNode[] = [
  {
    id: 'node-pre',
    name: '功与动能标量基础',
    phase: 'prerequisite',
    status: 'illuminated',
    masteryPercent: 96,
    connections: ['node-core'],
    description: '恒力做功 W=Fs·cosθ 与动能标量定义，前置掌握完备。',
  },
  {
    id: 'node-core',
    name: '变力做功微元累加与动能定理',
    phase: 'core_lesson',
    status: 'locked',
    masteryPercent: 88,
    connections: ['node-adv'],
    description: '本堂课核心概念：F-s 面积求功、积分以恒代变思想。',
  },
  {
    id: 'node-adv',
    name: '动量守恒与多过程临界转换',
    phase: 'advanced_derivation',
    status: 'locked',
    masteryPercent: 76,
    connections: [],
    description: '课后拓展：系统在变阻力与摩擦突变下的极值关系。',
  },
];

export const KnowledgeTreeLightingModal: React.FC<KnowledgeTreeLightingModalProps> = ({
  isOpen,
  onClose,
  lessonTitle = '变力做功与动能定理',
  className = '高一(1)班',
  masteryPercent = 88,
  lang = 'zh',
}) => {
  const [nodes, setNodes] = useState<KnowledgeTreeNode[]>(DEFAULT_TREE_NODES);
  const [isLighting, setIsLighting] = useState(false);
  const [isFullyLit, setIsFullyLit] = useState(false);

  const handleLightUp = () => {
    setIsLighting(true);
    setTimeout(() => {
      setNodes((prev) =>
        prev.map((n) =>
          n.id === 'node-core' || n.id === 'node-adv'
            ? { ...n, status: 'illuminated' }
            : n,
        ),
      );
      setIsLighting(false);
      setIsFullyLit(true);
    }, 700);
  };

  if (!isOpen) return null;

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
                  {lang === 'zh' ? '课堂知识树即时点亮仪式' : 'Knowledge Tree Lighting Ceremony'}
                </h2>
                <span className="px-2 py-0.5 rounded-full text-3xs font-mono font-bold bg-amber-500/10 text-amber-600 border border-amber-500/20">
                  Concept Graph
                </span>
              </div>
              <p className="text-2xs text-muted mt-0.5">
                {className} · 《{lessonTitle}》
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

        {/* 知识树展示画布区 */}
        <div className="p-8 bg-gradient-to-b from-surface to-surface-secondary/40 flex flex-col items-center justify-center relative overflow-hidden">
          {/* 金色粒子流光背景 */}
          {isFullyLit && (
            <div className="absolute inset-0 pointer-events-none bg-radial from-amber-500/10 via-transparent to-transparent animate-pulse" />
          )}

          {/* 节点拓扑图 */}
          <div className="w-full max-w-2xl flex flex-col md:flex-row items-center justify-between gap-6 z-10 py-6">
            {nodes.map((node, index) => {
              const isLit = node.status === 'illuminated';
              return (
                <React.Fragment key={node.id}>
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
                        {node.phase === 'prerequisite'
                          ? '前置基石'
                          : node.phase === 'core_lesson'
                            ? '当堂核心'
                            : '衍生拔高'}
                      </span>
                      <h4 className="text-xs font-black text-main leading-tight">{node.name}</h4>
                    </div>

                    <p className="text-[11px] text-muted leading-relaxed max-w-[180px]">{node.description}</p>

                    <div className="mt-1 pt-2 border-t border-theme/60 w-full flex items-center justify-between text-2xs font-mono font-bold">
                      <span className="text-muted">达成度</span>
                      <span className={isLit ? 'text-amber-600 dark:text-amber-400' : 'text-muted'}>
                        {isLit ? `${node.masteryPercent}%` : '待点亮'}
                      </span>
                    </div>
                  </div>

                  {index < nodes.length - 1 && (
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
                onClick={handleLightUp}
                className="px-8 py-3 rounded-2xl bg-gradient-to-r from-amber-500 via-amber-600 to-amber-500 hover:scale-105 text-white font-black text-sm flex items-center gap-2 shadow-xl shadow-amber-500/25 transition-all cursor-pointer"
              >
                <Sparkles size={18} />
                <span>{isLighting ? (lang === 'zh' ? '正在连接知识图谱...' : 'Lighting...') : (lang === 'zh' ? '🌟 点亮本堂课知识树' : 'Light Up Tree')}</span>
              </button>
            ) : (
              <div
                data-testid="tree-lit-badge"
                className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/40 text-center flex flex-col items-center gap-1.5 animate-bounce-subtle"
              >
                <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 font-black text-sm">
                  <Award size={20} />
                  <span>全班核心素养达成度：{masteryPercent}% · 知识图谱已点亮！</span>
                </div>
                <p className="text-xs text-muted max-w-md">
                  祝贺全班同学完成了变力做功微元累加推导，整堂课核心概念图谱已全亮并计入个人学情成长档案。
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
