import React, { useState, useEffect } from 'react';
import { Zap, Coffee, HelpCircle, X, CheckCircle, Loader2 } from 'lucide-react';

export type IcebreakerMood = 'fullPower' | 'needCoffee' | 'needHelp';

export interface StudentIcebreakerModalProps {
  isOpen: boolean;
  onClose: () => void;
  classId: string | null;
  lessonId?: string | null;
  studentId?: string | null;
  lang?: 'zh' | 'en';
  onCheckinSuccess?: (stats: any) => void;
  addToast?: (title: string, description: string, type: 'success' | 'info' | 'warning' | 'error') => void;
}

export function StudentIcebreakerModal({
  isOpen,
  onClose,
  classId,
  lessonId,
  studentId,
  lang = 'zh',
  onCheckinSuccess,
  addToast,
}: StudentIcebreakerModalProps) {
  const [selectedMood, setSelectedMood] = useState<IcebreakerMood | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const zh = lang === 'zh';

  useEffect(() => {
    if (isOpen) {
      setErrorMsg(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (moodToSubmit?: IcebreakerMood) => {
    const mood = moodToSubmit || selectedMood;
    if (!mood) return;
    if (!classId) {
      setErrorMsg(zh ? '未检测到当前班级信息，暂时无法打卡' : 'No class found, unable to check in');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      const res = await fetch(`/api/classes/${encodeURIComponent(classId)}/checkin/icebreaker`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'same-origin',
        body: JSON.stringify({
          mood,
          lessonId: lessonId || undefined,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `HTTP ${res.status}`);
      }

      const data = await res.json();

      // 本地标记当前会话已打卡
      try {
        const storageKey = `icebreaker_checked_${studentId || 'cur'}_${classId}_${lessonId || 'today'}`;
        sessionStorage.setItem(storageKey, mood);
      } catch {
        /* ignore storage failure */
      }

      if (addToast) {
        addToast(
          zh ? '打卡成功！' : 'Check-in successful!',
          zh ? '老师已收到你的课前心态，祝本节课收获满满～' : 'Your mood has been shared with teacher.',
          'success',
        );
      }

      if (onCheckinSuccess) {
        onCheckinSuccess(data.stats);
      }

      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || (zh ? '打卡失败，请重试' : 'Check-in failed, please retry'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSkip = () => {
    try {
      const storageKey = `icebreaker_skipped_${studentId || 'cur'}_${classId}_${lessonId || 'today'}`;
      sessionStorage.setItem(storageKey, '1');
    } catch {
      /* ignore */
    }
    onClose();
  };

  const options: Array<{
    id: IcebreakerMood;
    label: string;
    sub: string;
    icon: React.ReactNode;
    color: string;
    activeBorder: string;
    activeBg: string;
  }> = [
    {
      id: 'fullPower',
      label: zh ? '充满电' : 'Full Power',
      sub: zh ? '精力充沛，准备好迎接挑战！' : 'Energetic and ready to learn!',
      icon: <Zap className="w-6 h-6 text-amber-500 animate-pulse" />,
      color: 'hover:border-amber-400 hover:bg-amber-50/50 dark:hover:bg-amber-950/20',
      activeBorder: 'border-amber-500 ring-2 ring-amber-400/30',
      activeBg: 'bg-amber-50/80 dark:bg-amber-950/40',
    },
    {
      id: 'needCoffee',
      label: zh ? '需要咖啡' : 'Need Coffee',
      sub: zh ? '稍显疲倦，需要唤醒状态～' : 'A bit tired, getting warmed up~',
      icon: <Coffee className="w-6 h-6 text-amber-700 dark:text-amber-300" />,
      color: 'hover:border-amber-600 hover:bg-amber-50/50 dark:hover:bg-amber-950/20',
      activeBorder: 'border-amber-600 ring-2 ring-amber-600/30',
      activeBg: 'bg-amber-50/80 dark:bg-amber-950/40',
    },
    {
      id: 'needHelp',
      label: zh ? '需要帮助' : 'Need Help',
      sub: zh ? '有点吃力，希望老师重点关照！' : 'Need support, please guide me!',
      icon: <HelpCircle className="w-6 h-6 text-rose-500" />,
      color: 'hover:border-rose-400 hover:bg-rose-50/50 dark:hover:bg-rose-950/20',
      activeBorder: 'border-rose-500 ring-2 ring-rose-400/30',
      activeBg: 'bg-rose-50/80 dark:bg-rose-950/40',
    },
  ];

  return (
    <div
      data-testid="student-icebreaker-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="icebreaker-title"
    >
      <div className="relative w-full max-w-md rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-2xl p-6 overflow-hidden">
        {/* 背景光晕装饰 */}
        <div className="absolute -top-16 -right-16 w-36 h-36 bg-amber-400/10 rounded-full blur-2xl pointer-events-none" />
        <div className="absolute -bottom-16 -left-16 w-36 h-36 bg-indigo-500/10 rounded-full blur-2xl pointer-events-none" />

        {/* 顶部标题与关闭 */}
        <div className="flex items-start justify-between pb-3 border-b border-gray-100 dark:border-gray-800/80">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl">✨</span>
              <h2 id="icebreaker-title" className="text-lg font-bold text-gray-900 dark:text-gray-100">
                {zh ? '课前破冰心情打卡' : 'Pre-Class Icebreaker'}
              </h2>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {zh ? '分享你此刻的心态，帮助老师更好地调整上课节奏' : 'Share your status so the teacher can tailor the lesson'}
            </p>
          </div>
          <button
            type="button"
            onClick={handleSkip}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1 rounded-lg transition-colors cursor-pointer"
            aria-label={zh ? '跳过' : 'Skip'}
          >
            <X size={18} />
          </button>
        </div>

        {/* 错误提示 */}
        {errorMsg && (
          <div className="mt-3 p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2">
            <span className="shrink-0">⚠️</span>
            <span>{errorMsg}</span>
          </div>
        )}

        {/* 三个心情选项 */}
        <div className="mt-4 space-y-2.5">
          {options.map((opt) => {
            const isSelected = selectedMood === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                data-testid={`mood-option-${opt.id}`}
                onClick={() => setSelectedMood(opt.id)}
                className={`w-full text-left p-3.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                  isSelected
                    ? `${opt.activeBorder} ${opt.activeBg}`
                    : `border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/40 ${opt.color}`
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="shrink-0 p-2 rounded-lg bg-white dark:bg-gray-800 shadow-2xs border border-gray-100 dark:border-gray-700">
                    {opt.icon}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{opt.label}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">{opt.sub}</div>
                  </div>
                </div>
                {isSelected && <CheckCircle size={18} className="shrink-0 text-indigo-600 dark:text-indigo-400" />}
              </button>
            );
          })}
        </div>

        {/* 底部操作按钮 */}
        <div className="mt-6 pt-3 border-t border-gray-100 dark:border-gray-800/80 flex items-center justify-between gap-3">
          <button
            type="button"
            data-testid="icebreaker-skip-btn"
            onClick={handleSkip}
            className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 px-3 py-2 rounded-lg transition-colors cursor-pointer"
          >
            {zh ? '稍后再说 / 跳过' : 'Skip for now'}
          </button>

          <button
            type="button"
            data-testid="icebreaker-submit-btn"
            disabled={!selectedMood || isSubmitting}
            onClick={() => handleSubmit()}
            className={`inline-flex items-center justify-center gap-1.5 px-5 py-2 rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer ${
              !selectedMood || isSubmitting
                ? 'bg-gray-200 dark:bg-gray-800 text-gray-400 cursor-not-allowed'
                : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-500/20'
            }`}
          >
            {isSubmitting ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                <span>{zh ? '提交中...' : 'Submitting...'}</span>
              </>
            ) : (
              <span>{zh ? '确认打卡' : 'Check In'}</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
