import React, { useState, useEffect, useRef } from 'react';
import {
  Bell,
  Sparkles,
  TrendingUp,
  CheckCircle2,
  HelpCircle,
  Zap,
  Star,
  X,
} from 'lucide-react';
import { StudentCountdownBanner } from './StudentCountdownBanner';
import { AdaptiveExitTicketModal } from '../classroom/exit-ticket/AdaptiveExitTicketModal';

export interface StudentInteractiveOverlayProps {
  lessonId: string | null;
  studentId?: string;
  studentName?: string;
  lang?: 'zh' | 'en';
}

export function StudentInteractiveOverlay({
  lessonId,
  studentId = 'student_demo',
  studentName = '我',
  lang = 'zh',
}: StudentInteractiveOverlayProps) {
  const [activePoll, setActivePoll] = useState<any>(null);
  const [activeBuzzer, setActiveBuzzer] = useState<any>(null);
  const [stage, setStage] = useState<string>('IN_CLASS_TEACHING');

  // 作答与抢答状态
  const [selectedPollOption, setSelectedPollOption] = useState<string | null>(null);
  const [pollSubmitted, setPollSubmitted] = useState(false);
  const [buzzStatus, setBuzzStatus] = useState<'IDLE' | 'BUZZED' | 'WINNER' | 'MISSED'>('IDLE');
  const [pacingFeedback, setPacingFeedback] = useState<string | null>(null);
  const [isExitTicketOpen, setIsExitTicketOpen] = useState(false);
  const [exitTicketSubmitted, setExitTicketSubmitted] = useState(false);
  const [rating, setRating] = useState(5);
  const [puzzledConcept, setPuzzledConcept] = useState('');
  const [feedbackNotes, setFeedbackNotes] = useState('');

  const buzzerArmedTimeRef = useRef<number>(Date.now());

  // 轮询活跃互动与阶段
  useEffect(() => {
    if (!lessonId) return;

    let mounted = true;
    const pollClassroomState = async () => {
      try {
        const res = await fetch(`/api/classroom/sessions/${lessonId}`);
        if (res.ok && mounted) {
          const json = await res.json();
          if (json.hasActiveSession) {
            setStage(json.stage);

            // 如果处于结课通票阶段且尚未提交，打开通票模态框
            if (json.stage === 'WRAP_UP_EXIT_TICKET' && !exitTicketSubmitted) {
              setIsExitTicketOpen(true);
            }

            // 同步投票
            if (json.activePoll && (!activePoll || activePoll.id !== json.activePoll.id)) {
              setActivePoll(json.activePoll);
              setSelectedPollOption(null);
              setPollSubmitted(false);
            } else if (!json.activePoll) {
              setActivePoll(null);
            }

            // 同步抢答器
            if (json.activeBuzzer && (!activeBuzzer || activeBuzzer.id !== json.activeBuzzer.id)) {
              setActiveBuzzer(json.activeBuzzer);
              setBuzzStatus('IDLE');
              buzzerArmedTimeRef.current = Date.now();
            } else if (json.activeBuzzer && activeBuzzer) {
              if (json.activeBuzzer.status === 'LOCKED') {
                if (json.activeBuzzer.winner_student_id === studentId) {
                  setBuzzStatus('WINNER');
                } else {
                  setBuzzStatus('MISSED');
                }
              }
              setActiveBuzzer(json.activeBuzzer);
            } else if (!json.activeBuzzer) {
              setActiveBuzzer(null);
              setBuzzStatus('IDLE');
            }
          }
        }
      } catch (e) {
        // silent
      }
    };

    pollClassroomState();
    const timer = setInterval(pollClassroomState, 2500);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [lessonId, exitTicketSubmitted, activePoll, activeBuzzer, studentId]);

  if (!lessonId) return null;

  // 发送节奏信号
  const sendPacingSignal = async (signalType: 'TOO_FAST' | 'CONFUSED' | 'CLEAR') => {
    try {
      await fetch(`/api/classroom/sessions/${lessonId}/pacing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signal: signalType }),
      });
      setPacingFeedback(
        signalType === 'TOO_FAST' ? '🐇 太快' : signalType === 'CONFUSED' ? '❓ 困惑' : '💡 听懂了',
      );
      setTimeout(() => setPacingFeedback(null), 2000);
    } catch (e) {
      // silent
    }
  };

  // 提交单选投票
  const submitPollVote = async (option: string) => {
    if (!activePoll || pollSubmitted) return;
    try {
      setSelectedPollOption(option);
      setPollSubmitted(true);
      await fetch(`/api/classroom/sessions/${lessonId}/quick-poll/${activePoll.id}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          option,
        }),
      });
    } catch (e) {
      // silent
    }
  };

  // 抢答点击
  const handleBuzzIn = async () => {
    if (!activeBuzzer || activeBuzzer.status !== 'READY' || buzzStatus !== 'IDLE') return;

    const responseTimeMs = Date.now() - buzzerArmedTimeRef.current;
    setBuzzStatus('BUZZED');

    try {
      const res = await fetch(`/api/classroom/sessions/${lessonId}/buzzer/${activeBuzzer.id}/buzz`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentName,
          responseTimeMs,
        }),
      });

      if (res.ok) {
        const json = await res.json();
        if (json.winner) {
          setBuzzStatus('WINNER');
        } else {
          setBuzzStatus('MISSED');
        }
      }
    } catch (e) {
      setBuzzStatus('MISSED');
    }
  };

  // 提交结课通票
  const submitExitTicket = async () => {
    try {
      await fetch(`/api/classroom/sessions/${lessonId}/exit-ticket`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rating,
          puzzledConcept,
          feedback: feedbackNotes,
        }),
      });
      setExitTicketSubmitted(true);
      setIsExitTicketOpen(false);
    } catch (e) {
      // silent
    }
  };

  return (
    <>
      {/* 课堂倒计时横幅（与教师端实时同步） */}
      <StudentCountdownBanner lessonId={lessonId} lang={lang} />

      {/* 悬浮学习节奏信号条 (底部浮动) */}
      <aside
        aria-label={lang === 'zh' ? '课堂互动工具栏' : 'Classroom interaction toolbar'}
        className="fixed bottom-6 right-6 z-40 flex items-center gap-2 bg-surface/95 backdrop-blur-md border border-border/80 p-2 rounded-2xl shadow-xl transition-all"
      >
        {pacingFeedback && (
          <span className="text-xs font-bold text-primary-theme px-2 py-1 animate-fade-in">
            {pacingFeedback} 已传达给老师
          </span>
        )}
        <div className="flex items-center gap-1">
          <button
            onClick={() => sendPacingSignal('CLEAR')}
            className="px-2.5 py-1.5 rounded-xl hover:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold text-xs transition-colors flex items-center gap-1 cursor-pointer"
            title="听懂了，节奏适宜"
          >
            <span>💡</span>
            <span className="hidden sm:inline">{lang === 'zh' ? '听懂了' : 'Clear'}</span>
          </button>
          <button
            onClick={() => sendPacingSignal('CONFUSED')}
            className="px-2.5 py-1.5 rounded-xl hover:bg-amber-500/10 text-amber-600 dark:text-amber-400 font-bold text-xs transition-colors flex items-center gap-1 cursor-pointer"
            title="有点困惑，希望老师点拨"
          >
            <span>❓</span>
            <span className="hidden sm:inline">{lang === 'zh' ? '有疑问' : 'Confused'}</span>
          </button>
          <button
            onClick={() => sendPacingSignal('TOO_FAST')}
            className="px-2.5 py-1.5 rounded-xl hover:bg-rose-500/10 text-rose-600 dark:text-rose-400 font-bold text-xs transition-colors flex items-center gap-1 cursor-pointer"
            title="讲得太快了，希望能慢一点"
          >
            <span>🐇</span>
            <span className="hidden sm:inline">{lang === 'zh' ? '讲太快' : 'Too Fast'}</span>
          </button>
        </div>
      </aside>

      {/* 极速单选作答弹窗 */}
      {activePoll && activePoll.status === 'ACTIVE' && (
        <div className="fixed bottom-20 right-6 z-50 bg-surface rounded-2xl border border-amber-500/40 p-5 shadow-2xl w-80 flex flex-col gap-3 animate-slide-up">
          <div className="flex items-center justify-between border-b border-border/60 pb-2">
            <span className="text-xs font-extrabold text-amber-500 flex items-center gap-1.5">
              <Sparkles size={14} />
              {lang === 'zh' ? '极速答题进行中' : 'Quick Poll Active'}
            </span>
            {pollSubmitted && (
              <span className="text-[11px] text-emerald-500 font-bold flex items-center gap-1">
                <CheckCircle2 size={12} />
                {lang === 'zh' ? '已提交' : 'Submitted'}
              </span>
            )}
          </div>

          <p className="font-bold text-sm text-foreground">{activePoll.title}</p>

          <div className="grid grid-cols-2 gap-2 mt-1">
            {(activePoll.options || ['A', 'B', 'C', 'D']).map((opt: string) => {
              const isSelected = selectedPollOption === opt;
              return (
                <button
                  key={opt}
                  disabled={pollSubmitted}
                  onClick={() => submitPollVote(opt)}
                  className={`p-3 rounded-xl font-bold text-center text-sm transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-primary-theme text-white ring-2 ring-primary-theme shadow-md scale-95'
                      : pollSubmitted
                        ? 'bg-surface-secondary text-muted opacity-60 cursor-not-allowed'
                        : 'bg-surface-secondary hover:bg-primary-theme/10 hover:border-primary-theme border border-border text-foreground'
                  }`}
                >
                  {opt}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 抢答器弹窗 */}
      {activeBuzzer && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-surface rounded-3xl border border-rose-500/50 p-8 w-full max-w-sm shadow-2xl flex flex-col items-center text-center gap-4 animate-scale-up">
            <h3 className="text-xl font-black text-foreground flex items-center gap-2">
              <Bell size={22} className="text-rose-500 animate-bounce" />
              <span>{activeBuzzer.title || '全班极速抢答'}</span>
            </h3>

            {buzzStatus === 'IDLE' && activeBuzzer.status === 'READY' && (
              <div className="my-4 flex flex-col items-center gap-3">
                <button
                  onClick={handleBuzzIn}
                  className="w-36 h-36 rounded-full bg-gradient-to-tr from-rose-600 to-rose-400 text-white font-black text-2xl shadow-xl hover:scale-105 active:scale-95 transition-all flex flex-col items-center justify-center border-4 border-white dark:border-slate-800 cursor-pointer animate-pulse"
                >
                  <Zap size={32} className="mb-1" />
                  <span>抢！</span>
                </button>
                <span className="text-xs text-muted">点击红色大按钮抢得首答权</span>
              </div>
            )}

            {buzzStatus === 'WINNER' && (
              <div className="my-4 p-6 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl flex flex-col items-center text-center">
                <span className="text-4xl mb-2">🎉</span>
                <span className="text-lg font-black text-emerald-500">恭喜你率先抢答！</span>
                <span className="text-xs text-muted mt-1">请起立或开麦回答老师的问题</span>
              </div>
            )}

            {buzzStatus === 'MISSED' && (
              <div className="my-4 p-6 bg-slate-800/20 border border-border rounded-2xl flex flex-col items-center text-center">
                <span className="text-4xl mb-2">⚡</span>
                <span className="text-base font-bold text-foreground">
                  已被 {activeBuzzer.winner_student_name || '其他同学'} 抢先一步！
                </span>
                <span className="text-xs text-muted mt-1">下次手速要更快哦</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 60s 自适应结课通票模态框 */}
      <AdaptiveExitTicketModal
        isOpen={isExitTicketOpen && !exitTicketSubmitted}
        onClose={() => setIsExitTicketOpen(false)}
        lessonId={lessonId}
        studentName={studentName}
        lang={lang}
        onSubmitSuccess={() => {
          setExitTicketSubmitted(true);
        }}
      />
    </>
  );
}
