import React, { useState, useEffect, useRef } from 'react';
import { Clock, Volume2, VolumeX, ChevronUp, ChevronDown, Sparkles, CheckCircle2 } from 'lucide-react';
import { ClassroomSyncChannel, type ClassroomCountdownState } from '../../services/classroom-sync-channel';
import { onSocketInstance } from '../../services/socket-service';
import { useCustomEvent } from '../../hooks/useEventBus';
import { ExtensionPointRenderer } from '../../plugin-host/extension-point-renderer';

export interface StudentCountdownBannerProps {
  lessonId: string | null;
  lang?: 'zh' | 'en';
  syncChannel?: ClassroomSyncChannel | null;
}

function playStudentChime() {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const now = ctx.currentTime;

    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, now); // D5
    osc1.frequency.exponentialRampToValueAtTime(880.0, now + 0.3); // A5
    gain1.gain.setValueAtTime(0.25, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.8);
  } catch (_) {}
}

export function StudentCountdownBanner({
  lessonId,
  lang = 'zh',
  syncChannel: propSyncChannel,
}: StudentCountdownBannerProps) {
  const [countdown, setCountdown] = useState<ClassroomCountdownState | null>(null);
  const [isMinimized, setIsMinimized] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [hasFinishedAlerted, setHasFinishedAlerted] = useState(false);

  const countdownRef = useRef(countdown);
  countdownRef.current = countdown;

  // 1. 初始化并监听 BroadcastChannel 与 Socket.IO
  useEffect(() => {
    if (!lessonId) return;

    let syncChannel: ClassroomSyncChannel | null = null;
    let unsub: (() => void) | undefined;
    try {
      syncChannel = propSyncChannel || new ClassroomSyncChannel();
      unsub = syncChannel.onMessage((msg) => {
        if (msg.type === 'TEACHER_BROADCAST_COUNTDOWN') {
          setCountdown(msg.payload);
        } else if (msg.type === 'TEACHER_SYNC_TIMER') {
          setCountdown((prev) => {
            if (!prev) {
              return {
                lessonId,
                totalDuration: Math.max(300, msg.payload.timeRemaining),
                timeRemaining: msg.payload.timeRemaining,
                isRunning: msg.payload.isRunning,
                isPaused: false,
                label: lang === 'zh' ? '⏱️ 课堂限时任务' : '⏱️ Timed Task',
                endsAt: msg.payload.isRunning ? Date.now() + msg.payload.timeRemaining * 1000 : null,
                updatedAt: Date.now(),
              };
            }
            return {
              ...prev,
              timeRemaining: msg.payload.timeRemaining,
              isRunning: msg.payload.isRunning,
              endsAt: msg.payload.isRunning ? Date.now() + msg.payload.timeRemaining * 1000 : null,
            };
          });
        }
      });
    } catch (_) {}

    // 初始从服务端拉取一次
    const fetchServerCountdown = async () => {
      try {
        const res = await fetch(`/api/classroom/sessions/${lessonId}/countdown`);
        if (res.ok) {
          const json = await res.json();
          if (json.success && json.countdown) {
            setCountdown(json.countdown);
          }
        }
      } catch (_) {}
    };

    fetchServerCountdown();

    /**
     * 直接订阅服务端唯一权威广播 `classroom:countdown_updated`。
     *
     * 为什么必须有这条：原先本组件的三个数据源分别只覆盖「同机 BroadcastChannel /
     * 同文档 window 事件 / 挂载那一瞬的 GET」，而教师端大屏（`useStageDisplayFeed`）
     * 却监听了这个 socket 事件 —— 于是**教师中途启动的倒计时，远程学生永远看不到**。
     *
     * 用 `onSocketInstance` 而非 `getOptionalSocket()`：本组件是 App 的子节点，
     * 它的 effect 先于 App 里创建 socket 的 effect 执行，此刻 socket 必然还不存在
     * （详见 `socket-service.onSocketInstance` 的注释）。
     */
    let detachSocket: (() => void) | null = null;
    const offSocket = onSocketInstance((socket) => {
      const onCountdownUpdated = (payload: any) => {
        // 事件投递到常驻课堂广播房间，会覆盖全平台客户端 → 必须按课节过滤
        if (!payload || (payload.lessonId && payload.lessonId !== lessonId)) return;
        setCountdown(payload);
      };
      detachSocket?.();
      socket.on('classroom:countdown_updated', onCountdownUpdated);
      detachSocket = () => socket.off('classroom:countdown_updated', onCountdownUpdated);
    });

    return () => {
      unsub?.();
      offSocket();
      detachSocket?.();
      if (!propSyncChannel && typeof syncChannel?.destroy === 'function') {
        syncChannel.destroy();
      }
    };
  }, [lessonId, lang]);

  // 监听全局 DOM 自定义事件 (Layer 3)
  useCustomEvent('openlearn:countdown:updated', (detail) => {
    if (detail) {
      setCountdown(detail);
    }
  });

  /**
   * 复位「已响过结束提示音」的标记。
   *
   * 此前 `hasFinishedAlerted` 一旦置 true 就再无复位路径，导致：
   * - 教师发起**第二次**倒计时，结束时不再响提示音；
   * - 且下面的渲染条件含 `&& !hasFinishedAlerted`，横幅会永久停在「时间已截止」。
   *
   * 判定「新一轮」用 `endsAt` 变化而非时间戳倒推：暂停/恢复不会改 `endsAt`，
   * 而教师重新 start / add_time 一定会给出新的 `endsAt`。
   */
  const lastAlertedEndsAtRef = useRef<number | null>(null);
  useEffect(() => {
    if (!countdown?.isRunning || !countdown.endsAt) return;
    if (lastAlertedEndsAtRef.current === countdown.endsAt) return;
    lastAlertedEndsAtRef.current = countdown.endsAt;
    setHasFinishedAlerted(false);
  }, [countdown?.isRunning, countdown?.endsAt]);

  // 2. 本地平滑时钟推进
  useEffect(() => {
    if (!countdown || !countdown.isRunning || !countdown.endsAt) return;

    const interval = setInterval(() => {
      const current = countdownRef.current;
      if (!current || !current.isRunning || !current.endsAt) return;

      const now = Date.now();
      const diff = Math.max(0, Math.round((current.endsAt - now) / 1000));

      if (diff !== current.timeRemaining) {
        const nextState = {
          ...current,
          timeRemaining: diff,
          updatedAt: now,
        };

        if (diff <= 0) {
          nextState.isRunning = false;
          nextState.isPaused = false;
          nextState.endsAt = null;

          if (soundEnabled && !hasFinishedAlerted) {
            playStudentChime();
            setHasFinishedAlerted(true);
          }
        }

        setCountdown(nextState);

        try {
          window.dispatchEvent(
            new CustomEvent('openlearn:student:countdown_tick', {
              detail: {
                timeRemaining: diff,
                totalDuration: current.totalDuration,
                label: current.label,
              },
            }),
          );
        } catch (_) {}
      }
    }, 500);

    return () => clearInterval(interval);
  }, [countdown?.isRunning, countdown?.endsAt, soundEnabled, hasFinishedAlerted]);

  // 如果没有活动倒计时或已重置且未在运行，不展示
  if (!countdown || (countdown.timeRemaining === 0 && !countdown.isRunning && !hasFinishedAlerted)) {
    return null;
  }

  // 格式化时间
  const formatTime = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${pad(mins)}:${pad(secs)}`;
  };

  const progressPercent =
    countdown.totalDuration > 0
      ? Math.min(100, Math.max(0, (countdown.timeRemaining / countdown.totalDuration) * 100))
      : 0;

  const isUrgent = countdown.timeRemaining > 0 && countdown.timeRemaining <= 60;
  const isWarning = countdown.timeRemaining > 60 && countdown.timeRemaining <= 180;
  const isFinished = countdown.timeRemaining === 0;

  return (
    <aside
      id="student-classroom-countdown-banner"
      aria-label={lang === 'zh' ? '课堂倒计时通知' : 'Classroom Countdown Alert'}
      className={`fixed top-4 right-6 z-50 transition-all duration-300 select-none ${
        isMinimized ? 'w-auto' : 'w-72 sm:w-80'
      }`}
    >
      <div
        className={`bg-surface/95 backdrop-blur-md border rounded-2xl shadow-2xl p-3 flex flex-col gap-2 transition-all ${
          isUrgent
            ? 'border-rose-500/80 shadow-rose-500/20'
            : isWarning
              ? 'border-amber-500/80 shadow-amber-500/20'
              : isFinished
                ? 'border-emerald-500/80 shadow-emerald-500/20'
                : 'border-theme shadow-primary-theme/10'
        }`}
      >
        {/* 顶部标签与状态 */}
        <div className="flex items-center justify-between gap-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <span
              className={`p-1 rounded-lg text-white shrink-0 ${
                isUrgent
                  ? 'bg-rose-500 animate-pulse'
                  : isWarning
                    ? 'bg-amber-500'
                    : isFinished
                      ? 'bg-emerald-500'
                      : 'bg-primary-theme'
              }`}
            >
              <Clock
                size={12}
                className={countdown.isRunning ? 'animate-spin' : ''}
                style={{ animationDuration: '6s' }}
              />
            </span>
            <span className="text-xs font-bold text-main truncate">
              {countdown.label || (lang === 'zh' ? '课堂任务' : 'Task')}
            </span>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setSoundEnabled(!soundEnabled)}
              className="p-1 rounded-md text-muted hover:text-main text-xs transition-colors cursor-pointer"
              title={soundEnabled ? '提示音已开启' : '提示音已静音'}
            >
              {soundEnabled ? <Volume2 size={12} /> : <VolumeX size={12} />}
            </button>
            <button
              type="button"
              onClick={() => setIsMinimized(!isMinimized)}
              className="p-1 rounded-md text-muted hover:text-main text-xs transition-colors cursor-pointer"
              title={isMinimized ? '展开' : '收起'}
            >
              {isMinimized ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
            </button>
          </div>
        </div>

        {/* 展开内容 */}
        {!isMinimized && (
          <>
            <div className="flex items-baseline justify-between px-1">
              <span
                id="student-countdown-digits"
                className={`text-2xl font-black font-mono tracking-widest ${
                  isUrgent
                    ? 'text-rose-500 animate-pulse'
                    : isWarning
                      ? 'text-amber-500'
                      : isFinished
                        ? 'text-emerald-500'
                        : 'text-primary-theme'
                }`}
              >
                {formatTime(countdown.timeRemaining)}
              </span>
              <span className="text-[11px] font-semibold text-muted">
                {isFinished
                  ? lang === 'zh'
                    ? '🎉 时间已截止！'
                    : 'Time is up!'
                  : countdown.isPaused
                    ? lang === 'zh'
                      ? '⏸️ 老师已暂停计时'
                      : 'Paused'
                    : lang === 'zh'
                      ? '与全班同步中'
                      : 'Synced'}
              </span>
            </div>

            {/* 进度条 */}
            <div className="w-full h-1.5 bg-surface-secondary rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-500 ${
                  isUrgent
                    ? 'bg-rose-500'
                    : isWarning
                      ? 'bg-amber-500'
                      : isFinished
                        ? 'bg-emerald-500'
                        : 'bg-primary-theme'
                }`}
                style={{ width: `${progressPercent}%` }}
              />
            </div>

            {/* 插件扩展槽 (student.classroom.countdown) */}
            <ExtensionPointRenderer
              slot="student.classroom.countdown"
              slotProps={{
                countdown,
                lang,
              }}
            />
          </>
        )}
      </div>
    </aside>
  );
}

export default StudentCountdownBanner;
