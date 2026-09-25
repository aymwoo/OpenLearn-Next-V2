import React, { useState } from 'react';
import {
  CheckCircle2,
  X,
  Star,
  Sparkles,
  HelpCircle,
  AlertCircle,
  Award,
  ChevronRight,
  BookOpen,
} from 'lucide-react';
import type {
  AdaptiveCoreQuestion,
  AdaptiveChallengeQuestion,
  ExitTicketTier,
} from './types';

export interface AdaptiveExitTicketModalProps {
  isOpen: boolean;
  onClose: () => void;
  lessonId: string | null;
  studentName?: string;
  lang?: 'zh' | 'en';
  coreQuestion?: AdaptiveCoreQuestion;
  challengeQuestion?: AdaptiveChallengeQuestion;
  onSubmitSuccess?: () => void;
}

const DEFAULT_CORE_QUESTION: AdaptiveCoreQuestion = {
  id: 'core-q-1',
  question: '关于变力沿曲线轨道做功过程，下列说法严格正确的是：',
  options: [
    { key: 'A', text: '可以直接利用恒力做功公式 W = F·s·cosθ 统一计算' },
    { key: 'B', text: '可将位移划分为无限小微元 Δs，在每个微元内以恒代变累加求和' },
    { key: 'C', text: '只要动能有变化，机械能一定严格守恒' },
    { key: 'D', text: '变力做功的数值与运动路径完全无关' },
  ],
  correctOption: 'B',
  explanation: '变力方向或大小随位置改变，不能直接套用恒力公式；微元法（微分与积分思想）是求解变力功的根本物理方法。',
  scaffoldHint: '⚠️ 巩固支架提示：请回顾牛顿第二定律与微积分思想，变力无法一次求和，必须采用 F-s 面积或微元累加！',
};

const DEFAULT_CHALLENGE_QUESTION: AdaptiveChallengeQuestion = {
  id: 'challenge-q-1',
  title: '高阶思维跃迁：变力与非弹性碰撞复合临界',
  prompt: '若物块在变阻力 f = -kv 作用下滑动并与弹性挡板碰撞，下列守恒与极限关系成立的是：',
  options: [
    { key: 'A', text: '全程动量守恒且机械能保持守恒' },
    { key: 'B', text: '当速度衰减为 0 前，系统动量损耗率与瞬时阻力成正比' },
    { key: 'C', text: '滑动阻力做功仅取决于物块最终停止位置与重力势能无关' },
    { key: 'D', text: '以上均不正确' },
  ],
  correctOption: 'B',
  rewardBadge: '🏅 物理探究思维跃迁徽章',
};

export const AdaptiveExitTicketModal: React.FC<AdaptiveExitTicketModalProps> = ({
  isOpen,
  onClose,
  lessonId,
  studentName = '我',
  lang = 'zh',
  coreQuestion = DEFAULT_CORE_QUESTION,
  challengeQuestion = DEFAULT_CHALLENGE_QUESTION,
  onSubmitSuccess,
}) => {
  const [selectedCoreOption, setSelectedCoreOption] = useState<string | null>(null);
  const [coreAnswered, setCoreAnswered] = useState(false);
  const [isCoreCorrect, setIsCoreCorrect] = useState<boolean | null>(null);

  const [selectedChallengeOption, setSelectedChallengeOption] = useState<string | null>(null);
  const [rating, setRating] = useState(5);
  const [puzzledConcept, setPuzzledConcept] = useState('');
  const [feedbackNotes, setFeedbackNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // 校验必做题
  const handleCheckCoreAnswer = () => {
    if (!selectedCoreOption) return;
    const correct = selectedCoreOption === coreQuestion.correctOption;
    setIsCoreCorrect(correct);
    setCoreAnswered(true);
  };

  const handleSubmit = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);

    const tierLevel: ExitTicketTier = isCoreCorrect
      ? selectedChallengeOption
        ? 'challenge_done'
        : 'passed'
      : 'remediation';

    try {
      if (lessonId) {
        await fetch(`/api/classroom/sessions/${lessonId}/exit-ticket`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rating,
            puzzledConcept: puzzledConcept.trim(),
            feedback: feedbackNotes.trim(),
            coreAnswer: selectedCoreOption,
            isCorrect: isCoreCorrect,
            tierLevel,
            challengeAnswer: selectedChallengeOption,
          }),
        });
      }
      setSubmitted(true);
      onSubmitSuccess?.();
    } catch (e) {
      // fallback graceful
      setSubmitted(true);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      data-testid="adaptive-exit-ticket-modal"
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-fade-in select-none"
    >
      <div className="bg-surface rounded-3xl border border-indigo-500/40 p-6 w-full max-w-lg shadow-2xl flex flex-col gap-4 max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/80 pb-3 shrink-0">
          <div className="flex items-center gap-2 text-indigo-500 font-extrabold text-base">
            <CheckCircle2 size={20} />
            <span>{lang === 'zh' ? '60 秒自适应结课通票 (Adaptive Exit Ticket)' : '60s Adaptive Exit Ticket'}</span>
          </div>
          <button
            onClick={onClose}
            className="text-muted hover:text-main rounded-lg p-1 cursor-pointer"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {submitted ? (
          <div className="py-8 flex flex-col items-center justify-center text-center gap-3">
            <div className="w-14 h-14 rounded-full bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <CheckCircle2 size={32} />
            </div>
            <h3 className="text-base font-black text-main">
              {lang === 'zh' ? '结课通票提交成功！' : 'Exit Ticket Submitted!'}
            </h3>
            <p className="text-xs text-muted max-w-xs">
              {lang === 'zh'
                ? '你的学情反馈与梯级作答已实时同步至教师大屏与个人课后学情卡。'
                : 'Feedback synced to classroom dashboard.'}
            </p>
            <button
              onClick={onClose}
              className="mt-2 px-6 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs transition-colors cursor-pointer"
            >
              {lang === 'zh' ? '完成' : 'Done'}
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-4 text-xs">
            {/* ── Step 1: 核心概念必做题 ── */}
            <div className="bg-surface-secondary/70 p-4 rounded-2xl border border-border/60 flex flex-col gap-2.5">
              <div className="flex items-center justify-between">
                <span className="font-extrabold text-main flex items-center gap-1.5 text-xs">
                  <span className="px-2 py-0.5 rounded bg-indigo-500 text-white font-mono text-[10px]">必做诊断</span>
                  <span>1. 核心概念过关题</span>
                </span>
                {coreAnswered && (
                  <span className={`text-2xs font-bold px-2 py-0.5 rounded-full ${
                    isCoreCorrect
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                      : 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                  }`}>
                    {isCoreCorrect ? '✓ 概念通关' : '需巩固'}
                  </span>
                )}
              </div>

              <p className="text-main font-semibold leading-relaxed">{coreQuestion.question}</p>

              <div className="space-y-1.5">
                {coreQuestion.options.map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    disabled={coreAnswered}
                    onClick={() => setSelectedCoreOption(opt.key)}
                    className={`w-full p-2.5 rounded-xl border text-left flex items-start gap-2.5 transition-all cursor-pointer ${
                      selectedCoreOption === opt.key
                        ? 'border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/40 font-bold text-indigo-700 dark:text-indigo-300'
                        : 'border-border/60 hover:bg-surface text-main'
                    } ${coreAnswered ? 'cursor-default opacity-90' : ''}`}
                  >
                    <span className="w-5 h-5 rounded-full bg-surface-secondary border border-border flex items-center justify-center text-[10px] font-mono shrink-0">
                      {opt.key}
                    </span>
                    <span className="text-2xs leading-relaxed">{opt.text}</span>
                  </button>
                ))}
              </div>

              {!coreAnswered && (
                <button
                  type="button"
                  disabled={!selectedCoreOption}
                  onClick={handleCheckCoreAnswer}
                  className={`mt-1 py-1.5 px-3 rounded-xl font-bold text-2xs transition-colors flex items-center justify-center gap-1 ${
                    selectedCoreOption
                      ? 'bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer shadow-xs'
                      : 'bg-surface-secondary text-muted cursor-not-allowed'
                  }`}
                >
                  <span>确认本题答案</span>
                  <ChevronRight size={12} />
                </button>
              )}

              {/* 自适应分支展示 */}
              {coreAnswered && isCoreCorrect && (
                <div
                  data-testid="challenge-branch"
                  className="mt-2 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-800 dark:text-emerald-200 space-y-2 animate-fade-in"
                >
                  <div className="flex items-center gap-1.5 font-bold text-2xs">
                    <Sparkles size={14} className="text-emerald-600 dark:text-emerald-400" />
                    <span>太棒了！已解锁【Lv.2 进阶探究挑战题】（冲刺思维勋章）</span>
                  </div>
                  <p className="text-2xs font-semibold text-main">{challengeQuestion.prompt}</p>
                  <div className="grid grid-cols-1 gap-1">
                    {challengeQuestion.options.map((opt) => (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => setSelectedChallengeOption(opt.key)}
                        className={`p-2 rounded-lg border text-left text-2xs transition-colors ${
                          selectedChallengeOption === opt.key
                            ? 'border-emerald-500 bg-emerald-100/60 dark:bg-emerald-950 font-bold text-emerald-800 dark:text-emerald-200'
                            : 'border-emerald-500/20 bg-surface text-main hover:bg-surface-secondary'
                        }`}
                      >
                        <span className="font-mono font-bold mr-1.5">{opt.key}.</span>
                        <span>{opt.text}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {coreAnswered && !isCoreCorrect && (
                <div
                  data-testid="scaffold-branch"
                  className="mt-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-200 space-y-1.5 animate-fade-in"
                >
                  <div className="flex items-center gap-1.5 font-bold text-2xs text-amber-600 dark:text-amber-400">
                    <BookOpen size={14} />
                    <span>核心概念支架提示卡</span>
                  </div>
                  <p className="text-2xs leading-relaxed">{coreQuestion.scaffoldHint}</p>
                  <p className="text-3xs text-muted">解析：{coreQuestion.explanation}</p>
                </div>
              )}
            </div>

            {/* ── Step 2: 掌握度自评 ── */}
            <div className="flex flex-col gap-1.5">
              <label className="text-2xs font-bold text-main">
                {lang === 'zh' ? '2. 今日课堂综合掌握感评估' : 'Rate Today Lesson'}
              </label>
              <div className="flex items-center gap-2">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    onClick={() => setRating(star)}
                    className="p-0.5 text-xl transition-transform hover:scale-125 cursor-pointer"
                  >
                    <Star
                      size={20}
                      className={star <= rating ? 'text-amber-400 fill-amber-400' : 'text-slate-300'}
                    />
                  </button>
                ))}
                <span className="text-2xs font-bold text-amber-500 font-mono ml-1">{rating}.0 星</span>
              </div>
            </div>

            {/* ── Step 3: 今日最困惑的概念输入 ── */}
            <div className="flex flex-col gap-1">
              <label className="text-2xs font-bold text-main">
                {lang === 'zh' ? '3. 今天最困惑或没完全搞懂的知识点/卡点是什么？' : 'Most Confused Concept'}
              </label>
              <input
                type="text"
                value={puzzledConcept}
                onChange={(e) => setPuzzledConcept(e.target.value)}
                placeholder={lang === 'zh' ? '例如：变力做功 F-s 面积法、临界滑动摩擦...' : 'e.g. friction boundary...'}
                className="w-full px-3 py-2 bg-surface-secondary border border-border rounded-xl text-xs text-main focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            {/* ── Step 4: 给老师的留言建议 ── */}
            <div className="flex flex-col gap-1">
              <label className="text-2xs font-bold text-main">
                {lang === 'zh' ? '4. 给老师的一句小建议 (选填)' : 'Feedback (Optional)'}
              </label>
              <input
                type="text"
                value={feedbackNotes}
                onChange={(e) => setFeedbackNotes(e.target.value)}
                placeholder={lang === 'zh' ? '例如：希望能补充一道微元积分经典例题...' : 'Feedback...'}
                className="w-full px-3 py-1.5 bg-surface-secondary border border-border rounded-xl text-xs text-main focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            {/* Submit Button */}
            <button
              type="button"
              disabled={isSubmitting}
              onClick={handleSubmit}
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold rounded-xl transition-colors cursor-pointer shadow-md text-xs flex items-center justify-center gap-1.5"
            >
              <span>{isSubmitting ? (lang === 'zh' ? '正在提交...' : 'Submitting...') : (lang === 'zh' ? '提交自适应结课通票' : 'Submit Exit Ticket')}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
