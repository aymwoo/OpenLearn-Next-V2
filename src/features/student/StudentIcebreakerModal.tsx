import React, { useState, useEffect } from 'react';
import { Zap, Coffee, HelpCircle, CheckCircle, Loader2 } from 'lucide-react';
import AccessibleDialog, {
  DialogBody,
  DialogButton,
  DialogCloseButton,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/AccessibleDialog';

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
    <AccessibleDialog
      open={isOpen}
      onClose={handleSkip}
      ariaLabelledBy="icebreaker-title"
      closedBy="closerequest"
      className="max-w-md"
      data-testid="student-icebreaker-modal"
    >
      <DialogHeader>
        <DialogTitle
          id="icebreaker-title"
          icon={<span className="text-xl leading-none">✨</span>}
          description={
            zh
              ? '分享你此刻的心态，帮助老师更好地调整上课节奏'
              : 'Share your status so the teacher can tailor the lesson'
          }
        >
          {zh ? '课前破冰心情打卡' : 'Pre-Class Icebreaker'}
        </DialogTitle>
        <DialogCloseButton label={zh ? '跳过' : 'Skip'} onClick={handleSkip} />
      </DialogHeader>

      <DialogBody className="space-y-4">
        {/* 错误提示 */}
        {errorMsg && (
          <div className="flex items-center gap-2 rounded-lg border border-rose-500/20 bg-rose-500/10 p-2.5 text-xs text-rose-600 dark:text-rose-400">
            <span className="shrink-0">⚠️</span>
            <span>{errorMsg}</span>
          </div>
        )}

        {/* 三个心情选项 */}
        <div className="space-y-2.5">
          {options.map((opt) => {
            const isSelected = selectedMood === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                data-testid={`mood-option-${opt.id}`}
                onClick={() => setSelectedMood(opt.id)}
                className={`flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl border p-3.5 text-left transition-all ${
                  isSelected
                    ? `${opt.activeBorder} ${opt.activeBg}`
                    : `border-theme bg-surface-secondary/60 ${opt.color}`
                }`}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="shrink-0 rounded-lg border border-theme bg-surface p-2 shadow-2xs">{opt.icon}</div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-main">{opt.label}</div>
                    <div className="mt-0.5 truncate text-xs text-muted">{opt.sub}</div>
                  </div>
                </div>
                {isSelected && <CheckCircle size={18} className="shrink-0 text-primary-ink" />}
              </button>
            );
          })}
        </div>
      </DialogBody>

      <DialogFooter className="justify-between">
        <DialogButton variant="ghost" data-testid="icebreaker-skip-btn" onClick={handleSkip}>
          {zh ? '稍后再说 / 跳过' : 'Skip for now'}
        </DialogButton>

        <DialogButton
          variant="primary"
          data-testid="icebreaker-submit-btn"
          disabled={!selectedMood || isSubmitting}
          onClick={() => handleSubmit()}
        >
          {isSubmitting ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              <span>{zh ? '提交中...' : 'Submitting...'}</span>
            </>
          ) : (
            <span>{zh ? '确认打卡' : 'Check In'}</span>
          )}
        </DialogButton>
      </DialogFooter>
    </AccessibleDialog>
  );
}
