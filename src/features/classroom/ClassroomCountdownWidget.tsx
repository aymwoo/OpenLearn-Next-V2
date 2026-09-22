import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Clock,
  Play,
  Pause,
  RotateCcw,
  Plus,
  Minus,
  Volume2,
  VolumeX,
  Maximize2,
  Minimize2,
  Radio,
  Tag,
  Check,
  ChevronDown,
  Sparkles,
} from 'lucide-react';
import type { ClassroomSyncChannel, ClassroomCountdownState } from '../../services/classroom-sync-channel';
import { ExtensionPointRenderer } from '../../plugin-host/extension-point-renderer';

export interface CountdownPreset {
  id: string;
  label: string;
  duration: number; // in seconds
  icon?: string;
  pluginId?: string;
}

const DEFAULT_PRESETS: CountdownPreset[] = [
  { id: '1m', label: '1 分钟快速提问', duration: 60, icon: '⚡' },
  { id: '3m', label: '3 分钟温故知新', duration: 180, icon: '📖' },
  { id: '5m', label: '5 分钟随堂小测', duration: 300, icon: '📝' },
  { id: '10m', label: '10 分钟小组研讨', duration: 600, icon: '👥' },
  { id: '15m', label: '15 分钟探究实验', duration: 900, icon: '🔬' },
  { id: '25m', label: '25 分钟番茄专注', duration: 1500, icon: '🍅' },
  { id: '45m', label: '45 分钟完整自习', duration: 2700, icon: '⏱️' },
];

const DEFAULT_LABELS = [
  '📝 随堂小测',
  '👥 小组研讨',
  '🎯 专注练习',
  '⚡ 限时答题',
  '📖 课前预热',
  '💬 自由提问',
];

export interface ClassroomCountdownWidgetProps {
  lessonId: string | null;
  lang?: 'zh' | 'en';
  compact?: boolean;
  syncChannel?: ClassroomSyncChannel | null;
  onlineStudentCount?: number;
  onTimeRemainingChange?: (timeRemaining: number, isRunning: boolean) => void;
  className?: string;
}

// 播放提示音铃声 (基于 Web Audio API 合成，零依赖且各环境稳定可用)
function playChime() {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const now = ctx.currentTime;

    // 两段和弦提示音 (C5 -> G5)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(523.25, now); // C5
    osc1.frequency.exponentialRampToValueAtTime(783.99, now + 0.25); // G5
    gain1.gain.setValueAtTime(0.3, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.8);

    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(659.25, now + 0.15); // E5
    osc2.frequency.exponentialRampToValueAtTime(1046.5, now + 0.4); // C6
    gain2.gain.setValueAtTime(0.2, now + 0.15);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 1.2);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.15);
    osc2.stop(now + 1.2);
  } catch (_) {
    // 忽略音频受限于浏览器无交互自动播放策略
  }
}

export function ClassroomCountdownWidget({
  lessonId,
  lang = 'zh',
  compact = false,
  syncChannel,
  onlineStudentCount = 0,
  onTimeRemainingChange,
  className = '',
}: ClassroomCountdownWidgetProps) {
  const [countdown, setCountdown] = useState<ClassroomCountdownState>({
    lessonId,
    totalDuration: 300,
    timeRemaining: 300,
    isRunning: false,
    isPaused: false,
    label: lang === 'zh' ? '📝 随堂小测' : '📝 In-Class Quiz',
    endsAt: null,
    updatedAt: Date.now(),
  });

  const [soundEnabled, setSoundEnabled] = useState(true);
  const [isFullModalOpen, setIsFullModalOpen] = useState(false);
  const [customMinutes, setCustomMinutes] = useState('5');
  const [isLabelDropdownOpen, setIsLabelDropdownOpen] = useState(false);
  const [customLabelInput, setCustomLabelInput] = useState('');
  const [isEditingLabel, setIsEditingLabel] = useState(false);
  const [pluginPresets, setPluginPresets] = useState<CountdownPreset[]>([]);

  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const countdownRef = useRef(countdown);
  countdownRef.current = countdown;

  // 1. 初始化持久化状态 (优先从 REST API / 本地缓存读取)
  const loadCountdownState = useCallback(async () => {
    if (!lessonId) return;

    // 优先从本地缓存快速恢复
    const cacheKey = `openlearn_classroom_countdown_${lessonId}`;
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && typeof parsed.timeRemaining === 'number') {
          // 若之前处于 running 状态且有 endsAt，依据物理时间校准剩余时间
          if (parsed.isRunning && parsed.endsAt) {
            const now = Date.now();
            const remaining = Math.max(0, Math.round((parsed.endsAt - now) / 1000));
            parsed.timeRemaining = remaining;
            if (remaining === 0) {
              parsed.isRunning = false;
              parsed.isPaused = false;
              parsed.endsAt = null;
            }
          }
          setCountdown(parsed);
        }
      }
    } catch (_) {}

    // 然后从服务端请求最新权威状态
    try {
      const res = await fetch(`/api/classroom/sessions/${lessonId}/countdown`);
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.countdown) {
          setCountdown((prev) => {
            const serverCountdown = json.countdown;
            if (serverCountdown.totalDuration > 0 || serverCountdown.isRunning) {
              return serverCountdown;
            }
            return prev;
          });
        }
      }
    } catch (_) {}
  }, [lessonId]);

  useEffect(() => {
    loadCountdownState();
  }, [loadCountdownState]);

  // 2. 状态变化时持久化与广播
  const syncAndBroadcast = useCallback(
    (newState: ClassroomCountdownState) => {
      setCountdown(newState);

      // 本地存储备份
      if (lessonId) {
        try {
          localStorage.setItem(`openlearn_classroom_countdown_${lessonId}`, JSON.stringify(newState));
        } catch (_) {}
      }

      // 通知父组件
      onTimeRemainingChange?.(newState.timeRemaining, newState.isRunning);

      // 跨窗口 BroadcastChannel 广播给所有同源学生端
      if (syncChannel) {
        syncChannel.broadcastCountdown(newState);
      }

      // 服务端持久化并推送 Socket.IO
      if (lessonId) {
        fetch(`/api/classroom/sessions/${lessonId}/countdown`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: newState.isRunning ? 'start' : newState.isPaused ? 'pause' : 'set',
            duration: newState.totalDuration,
            label: newState.label,
          }),
        }).catch(() => {});
      }

      // 触发通用 DOM 事件，供第三方插件监听
      try {
        window.dispatchEvent(
          new CustomEvent('openlearn:countdown:updated', {
            detail: newState,
          }),
        );
      } catch (_) {}
    },
    [lessonId, onTimeRemainingChange, syncChannel],
  );

  // 3. 高精度倒计时驱动 (基于 endsAt 与时钟校准，避免后台节流漂移)
  useEffect(() => {
    if (countdown.isRunning && countdown.endsAt) {
      timerIntervalRef.current = setInterval(() => {
        const current = countdownRef.current;
        if (!current.isRunning || !current.endsAt) return;

        const now = Date.now();
        const diff = Math.max(0, Math.round((current.endsAt - now) / 1000));

        if (diff !== current.timeRemaining) {
          const nextState: ClassroomCountdownState = {
            ...current,
            timeRemaining: diff,
            updatedAt: now,
          };

          if (diff <= 0) {
            nextState.isRunning = false;
            nextState.isPaused = false;
            nextState.endsAt = null;

            // 触发铃声
            if (soundEnabled) {
              playChime();
            }

            // 触发第三方插件事件
            try {
              window.dispatchEvent(
                new CustomEvent('openlearn:countdown:expired', {
                  detail: {
                    lessonId,
                    label: current.label,
                    totalDuration: current.totalDuration,
                  },
                }),
              );
            } catch (_) {}
          }

          setCountdown(nextState);
          onTimeRemainingChange?.(nextState.timeRemaining, nextState.isRunning);

          // 每秒同步广播
          syncChannel?.broadcastCountdown(nextState);

          try {
            window.dispatchEvent(
              new CustomEvent('openlearn:countdown:tick', {
                detail: {
                  timeRemaining: nextState.timeRemaining,
                  totalDuration: nextState.totalDuration,
                },
              }),
            );
          } catch (_) {}
        }
      }, 500);
    } else {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
    }

    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
    };
  }, [countdown.isRunning, countdown.endsAt, soundEnabled, lessonId, onTimeRemainingChange, syncChannel]);

  // 4. 倒计时操作方法
  const handleStart = (durationSeconds: number, labelName?: string) => {
    const now = Date.now();
    const duration = durationSeconds > 0 ? durationSeconds : countdown.totalDuration || 300;
    const label = labelName || countdown.label;
    const nextState: ClassroomCountdownState = {
      lessonId,
      totalDuration: duration,
      timeRemaining: duration,
      isRunning: true,
      isPaused: false,
      label,
      endsAt: now + duration * 1000,
      updatedAt: now,
    };
    syncAndBroadcast(nextState);

    try {
      window.dispatchEvent(
        new CustomEvent('openlearn:countdown:started', {
          detail: nextState,
        }),
      );
    } catch (_) {}
  };

  const handlePause = () => {
    const now = Date.now();
    const current = countdownRef.current;
    const remaining = current.endsAt ? Math.max(0, Math.round((current.endsAt - now) / 1000)) : current.timeRemaining;

    const nextState: ClassroomCountdownState = {
      ...current,
      timeRemaining: remaining,
      isRunning: false,
      isPaused: true,
      endsAt: null,
      updatedAt: now,
    };
    syncAndBroadcast(nextState);

    try {
      window.dispatchEvent(
        new CustomEvent('openlearn:countdown:paused', {
          detail: nextState,
        }),
      );
    } catch (_) {}
  };

  const handleResume = () => {
    const now = Date.now();
    const current = countdownRef.current;
    const remaining = current.timeRemaining > 0 ? current.timeRemaining : current.totalDuration || 300;

    const nextState: ClassroomCountdownState = {
      ...current,
      timeRemaining: remaining,
      isRunning: true,
      isPaused: false,
      endsAt: now + remaining * 1000,
      updatedAt: now,
    };
    syncAndBroadcast(nextState);

    try {
      window.dispatchEvent(
        new CustomEvent('openlearn:countdown:resumed', {
          detail: nextState,
        }),
      );
    } catch (_) {}
  };

  const handleReset = () => {
    const now = Date.now();
    const current = countdownRef.current;
    const nextState: ClassroomCountdownState = {
      ...current,
      timeRemaining: current.totalDuration || 300,
      isRunning: false,
      isPaused: false,
      endsAt: null,
      updatedAt: now,
    };
    syncAndBroadcast(nextState);

    try {
      window.dispatchEvent(
        new CustomEvent('openlearn:countdown:reset', {
          detail: nextState,
        }),
      );
    } catch (_) {}
  };

  const handleAddTime = (seconds: number) => {
    const now = Date.now();
    const current = countdownRef.current;
    const newRemaining = Math.max(0, current.timeRemaining + seconds);
    const newTotal = Math.max(current.totalDuration, newRemaining);

    const nextState: ClassroomCountdownState = {
      ...current,
      totalDuration: newTotal,
      timeRemaining: newRemaining,
      endsAt: current.isRunning ? now + newRemaining * 1000 : null,
      updatedAt: now,
    };
    syncAndBroadcast(nextState);
  };

  // 5. 挂载第三方插件全局互操作接口 (Window API & 自定义事件驱动)
  useEffect(() => {
    const api = {
      getState: () => countdownRef.current,
      start: (duration: number, label?: string) => handleStart(duration, label),
      pause: () => handlePause(),
      resume: () => handleResume(),
      reset: () => handleReset(),
      addTime: (seconds: number) => handleAddTime(seconds),
      registerPreset: (preset: CountdownPreset) => {
        setPluginPresets((prev) => {
          if (prev.some((p) => p.id === preset.id)) return prev;
          return [...prev, preset];
        });
      },
      getPresets: () => [...DEFAULT_PRESETS, ...pluginPresets],
    };

    (window as any).__openlearn_countdown = api;

    // 监听第三方插件通过 window 自定义事件下发的指令
    const onTriggerStart = (e: any) => {
      const { duration, label } = e.detail || {};
      handleStart(duration || 300, label);
    };
    const onTriggerPause = () => handlePause();
    const onTriggerResume = () => handleResume();
    const onTriggerReset = () => handleReset();
    const onTriggerAddTime = (e: any) => {
      const { seconds } = e.detail || {};
      handleAddTime(seconds || 60);
    };

    window.addEventListener('openlearn:countdown:trigger_start', onTriggerStart);
    window.addEventListener('openlearn:countdown:trigger_pause', onTriggerPause);
    window.addEventListener('openlearn:countdown:trigger_resume', onTriggerResume);
    window.addEventListener('openlearn:countdown:trigger_reset', onTriggerReset);
    window.addEventListener('openlearn:countdown:trigger_add_time', onTriggerAddTime);

    return () => {
      window.removeEventListener('openlearn:countdown:trigger_start', onTriggerStart);
      window.removeEventListener('openlearn:countdown:trigger_pause', onTriggerPause);
      window.removeEventListener('openlearn:countdown:trigger_resume', onTriggerResume);
      window.removeEventListener('openlearn:countdown:trigger_reset', onTriggerReset);
      window.removeEventListener('openlearn:countdown:trigger_add_time', onTriggerAddTime);
    };
  }, [pluginPresets]);

  // 时间格式化辅助
  const formatTime = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${pad(mins)}:${pad(secs)}`;
  };

  const progressPercent = countdown.totalDuration > 0
    ? Math.min(100, Math.max(0, (countdown.timeRemaining / countdown.totalDuration) * 100))
    : 0;

  const isUrgent = countdown.timeRemaining > 0 && countdown.timeRemaining <= 60;
  const isWarning = countdown.timeRemaining > 60 && countdown.timeRemaining <= 180;

  // 进度条与高亮颜色
  const themeColorClass = isUrgent
    ? 'text-rose-500'
    : isWarning
    ? 'text-amber-500'
    : 'text-primary-theme';

  const progressBgClass = isUrgent
    ? 'bg-rose-500'
    : isWarning
    ? 'bg-amber-500'
    : 'bg-primary-theme';

  const allPresets = [...DEFAULT_PRESETS, ...pluginPresets];

  return (
    <div
      id="classroom-countdown-widget"
      className={`bg-surface-secondary border border-theme rounded-2xl p-3.5 flex flex-col gap-2.5 shadow-sm transition-all ${className}`}
    >
      {/* 头部标题与控制栏 */}
      <div className="flex items-center justify-between gap-1 select-none">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="p-1 rounded-lg bg-primary-theme/10 text-primary-theme shrink-0">
            <Clock size={13} className={countdown.isRunning ? 'animate-spin' : ''} style={{ animationDuration: '6s' }} />
          </span>
          <div className="flex flex-col min-w-0">
            <span className="text-xs font-black uppercase tracking-wider text-main truncate flex items-center gap-1">
              {lang === 'zh' ? '课堂倒计时' : 'Classroom Countdown'}
            </span>
            <div className="flex items-center gap-1 text-[10px] text-muted">
              <Radio size={9} className={countdown.isRunning ? 'text-emerald-500 animate-pulse' : 'text-muted'} />
              <span>
                {countdown.isRunning
                  ? lang === 'zh'
                    ? `实时广播中 (${onlineStudentCount}人)`
                    : `Broadcasting (${onlineStudentCount})`
                  : lang === 'zh'
                  ? '就绪'
                  : 'Ready'}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => setSoundEnabled(!soundEnabled)}
            className={`p-1 rounded-md text-xs transition-colors cursor-pointer border border-theme ${
              soundEnabled ? 'text-primary-theme bg-surface' : 'text-muted bg-surface/50'
            }`}
            title={soundEnabled ? (lang === 'zh' ? '提示音已开启' : 'Sound On') : lang === 'zh' ? '提示音已静音' : 'Muted'}
          >
            {soundEnabled ? <Volume2 size={12} /> : <VolumeX size={12} />}
          </button>
          <button
            type="button"
            onClick={() => setIsFullModalOpen(true)}
            className="p-1 rounded-md text-xs text-muted hover:text-main bg-surface hover:bg-surface-secondary transition-colors cursor-pointer border border-theme"
            title={lang === 'zh' ? '展台大屏全屏投放' : 'Projector Mode'}
          >
            <Maximize2 size={12} />
          </button>
        </div>
      </div>

      {/* 活动标签徽标与切换下拉 */}
      <div className="relative">
        {isEditingLabel ? (
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={customLabelInput}
              onChange={(e) => setCustomLabelInput(e.target.value)}
              placeholder="输入任务名称..."
              className="flex-1 px-2 py-0.5 text-xs bg-surface border border-theme rounded-md text-main focus:outline-hidden focus:ring-1 focus:ring-primary-theme"
              autoFocus
            />
            <button
              type="button"
              onClick={() => {
                if (customLabelInput.trim()) {
                  syncAndBroadcast({ ...countdown, label: customLabelInput.trim() });
                }
                setIsEditingLabel(false);
              }}
              className="p-1 rounded bg-primary-theme text-white text-xs cursor-pointer"
            >
              <Check size={11} />
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-1">
            <button
              type="button"
              onClick={() => setIsLabelDropdownOpen(!isLabelDropdownOpen)}
              className="flex items-center gap-1 text-[11px] font-semibold text-muted hover:text-main px-1.5 py-0.5 rounded-md hover:bg-surface transition-colors cursor-pointer border border-transparent hover:border-theme truncate"
              title="切换任务类型"
            >
              <Tag size={10} className="shrink-0 text-primary-theme" />
              <span className="truncate">{countdown.label}</span>
              <ChevronDown size={10} className="shrink-0 opacity-60" />
            </button>
            <button
              type="button"
              onClick={() => {
                setCustomLabelInput(countdown.label);
                setIsEditingLabel(true);
              }}
              className="text-[10px] text-muted hover:text-primary-theme underline cursor-pointer shrink-0"
            >
              {lang === 'zh' ? '自定义' : 'Custom'}
            </button>
          </div>
        )}

        {/* 预设任务标签下拉 */}
        {isLabelDropdownOpen && (
          <div className="absolute left-0 top-full mt-1 w-full bg-surface border border-theme rounded-xl shadow-lg p-1.5 z-30 flex flex-col gap-0.5">
            {DEFAULT_LABELS.map((lbl) => (
              <button
                key={lbl}
                type="button"
                onClick={() => {
                  syncAndBroadcast({ ...countdown, label: lbl });
                  setIsLabelDropdownOpen(false);
                }}
                className={`text-left px-2 py-1 text-xs rounded-lg transition-colors cursor-pointer flex items-center justify-between ${
                  countdown.label === lbl
                    ? 'bg-primary-theme/10 text-primary-theme font-bold'
                    : 'text-main hover:bg-surface-secondary'
                }`}
              >
                <span>{lbl}</span>
                {countdown.label === lbl && <Check size={10} />}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 倒计时时间大字与进度条 */}
      <div className="flex flex-col items-center justify-center p-3 bg-surface border border-theme rounded-xl relative overflow-hidden">
        {/* 顶部微进度条 */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-surface-secondary overflow-hidden">
          <div
            className={`h-full transition-all duration-500 ${progressBgClass}`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        <div
          id="classroom-countdown-digits"
          className={`text-3xl font-black font-mono tracking-widest transition-colors ${
            isUrgent ? 'animate-pulse text-rose-500' : themeColorClass
          }`}
        >
          {formatTime(countdown.timeRemaining)}
        </div>

        <span className="text-[10px] font-semibold text-muted mt-0.5">
          {countdown.timeRemaining === 0
            ? lang === 'zh'
              ? '⏰ 时间到！建议点评总结'
              : '⏰ Time is up!'
            : `${lang === 'zh' ? '总设时长' : 'Total'}: ${formatTime(countdown.totalDuration)}`}
        </span>
      </div>

      {/* 主控制按钮行：开始 / 暂停 / 重置 */}
      <div className="flex items-center gap-1.5 w-full">
        {countdown.isRunning ? (
          <button
            type="button"
            id="classroom-countdown-pause-btn"
            onClick={handlePause}
            className="flex-1 py-1.5 px-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold transition-all shadow-sm flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <Pause size={12} />
            <span>{lang === 'zh' ? '暂停计时' : 'Pause'}</span>
          </button>
        ) : countdown.isPaused ? (
          <button
            type="button"
            id="classroom-countdown-resume-btn"
            onClick={handleResume}
            className="flex-1 py-1.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-all shadow-sm flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <Play size={12} />
            <span>{lang === 'zh' ? '继续计时' : 'Resume'}</span>
          </button>
        ) : (
          <button
            type="button"
            id="classroom-countdown-start-btn"
            onClick={() => handleStart(countdown.totalDuration || 300)}
            className="flex-1 py-1.5 px-3 rounded-xl bg-primary-theme hover:opacity-90 text-white text-xs font-bold transition-all shadow-sm flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <Play size={12} />
            <span>{lang === 'zh' ? '开始倒计时' : 'Start'}</span>
          </button>
        )}

        <button
          type="button"
          id="classroom-countdown-reset-btn"
          onClick={handleReset}
          className="p-1.5 px-2.5 rounded-xl bg-surface hover:bg-surface-secondary border border-theme text-xs font-bold text-muted hover:text-main transition-colors flex items-center justify-center gap-1 cursor-pointer"
          title={lang === 'zh' ? '重置计时' : 'Reset'}
        >
          <RotateCcw size={12} />
          <span className="sr-only">重置</span>
        </button>
      </div>

      {/* 快捷增减时长按钮 (+1m, +5m, -1m) */}
      <div className="flex items-center justify-between gap-1 pt-1 border-t border-theme/60">
        <span className="text-[10px] text-muted font-medium">{lang === 'zh' ? '快速调整:' : 'Adjust:'}</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => handleAddTime(-60)}
            disabled={countdown.timeRemaining <= 60}
            className="px-1.5 py-0.5 rounded-md bg-surface hover:bg-surface-secondary border border-theme text-[11px] font-bold text-muted hover:text-main disabled:opacity-40 transition-colors cursor-pointer"
            title="减去1分钟"
          >
            -1m
          </button>
          <button
            type="button"
            onClick={() => handleAddTime(60)}
            className="px-1.5 py-0.5 rounded-md bg-surface hover:bg-surface-secondary border border-theme text-[11px] font-bold text-muted hover:text-main transition-colors cursor-pointer"
            title="增加1分钟"
          >
            +1m
          </button>
          <button
            type="button"
            onClick={() => handleAddTime(300)}
            className="px-1.5 py-0.5 rounded-md bg-surface hover:bg-surface-secondary border border-theme text-[11px] font-bold text-primary-theme hover:bg-primary-theme/10 transition-colors cursor-pointer"
            title="增加5分钟"
          >
            +5m
          </button>
        </div>
      </div>

      {/* 快捷预设时长 Chips */}
      <div className="flex flex-col gap-1 pt-1">
        <span className="text-[10px] text-muted font-semibold uppercase tracking-wider">
          {lang === 'zh' ? '预设时长' : 'Presets'}
        </span>
        <div className="flex flex-wrap gap-1">
          {allPresets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => handleStart(preset.duration, preset.label)}
              className={`px-1.5 py-0.5 rounded-lg text-[10px] font-bold transition-all cursor-pointer border ${
                countdown.totalDuration === preset.duration && countdown.isRunning
                  ? 'bg-primary-theme text-white border-primary-theme'
                  : 'bg-surface hover:bg-surface-secondary text-main border-theme'
              }`}
              title={preset.label}
            >
              <span>{preset.icon || '⏱️'}</span> {preset.duration / 60}m
            </button>
          ))}
        </div>
      </div>

      {/* 第三方插件扩展槽 1: 快捷操作槽 (classroom.countdown.action) */}
      <ExtensionPointRenderer
        slot="classroom.countdown.action"
        slotProps={{
          countdown,
          onStart: handleStart,
          onPause: handlePause,
          onReset: handleReset,
          onAddTime: handleAddTime,
          lang,
        }}
      />

      {/* 第三方插件扩展槽 2: 挂件扩展槽 (classroom.countdown.widget) */}
      <ExtensionPointRenderer
        slot="classroom.countdown.widget"
        slotProps={{
          countdown,
          lang,
        }}
      />

      {/* ── 大屏投影模式全屏模态框 (Projector Mode) ── */}
      {isFullModalOpen && (
        <div
          id="classroom-countdown-projector-modal"
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex flex-col items-center justify-center p-6 select-none animate-in fade-in duration-200"
        >
          <div className="absolute top-6 right-6 flex items-center gap-3">
            <button
              type="button"
              onClick={() => setSoundEnabled(!soundEnabled)}
              className="p-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
            >
              {soundEnabled ? <Volume2 size={20} /> : <VolumeX size={20} />}
            </button>
            <button
              type="button"
              onClick={() => setIsFullModalOpen(false)}
              className="p-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
            >
              <Minimize2 size={20} />
            </button>
          </div>

          <div className="flex flex-col items-center gap-6 max-w-2xl w-full">
            <div className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/10 border border-white/20 text-white text-sm font-bold">
              <Sparkles size={16} className="text-amber-300" />
              <span>{countdown.label}</span>
              <span className="text-xs text-white/60 ml-2">
                {lang === 'zh' ? `全班 ${onlineStudentCount} 位学生正在同步` : `${onlineStudentCount} students connected`}
              </span>
            </div>

            {/* 巨幅数字显示 */}
            <div
              className={`text-8xl md:text-9xl font-black font-mono tracking-widest drop-shadow-2xl transition-all ${
                isUrgent ? 'text-rose-500 animate-pulse' : isWarning ? 'text-amber-400' : 'text-emerald-400'
              }`}
            >
              {formatTime(countdown.timeRemaining)}
            </div>

            {/* 全宽大进度条 */}
            <div className="w-full h-3 bg-white/10 rounded-full overflow-hidden border border-white/20 shadow-inner">
              <div
                className={`h-full transition-all duration-500 ${
                  isUrgent ? 'bg-rose-500' : isWarning ? 'bg-amber-400' : 'bg-emerald-400'
                }`}
                style={{ width: `${progressPercent}%` }}
              />
            </div>

            {/* 大屏交互控制 */}
            <div className="flex items-center gap-4 mt-2">
              {countdown.isRunning ? (
                <button
                  type="button"
                  onClick={handlePause}
                  className="px-8 py-3 rounded-2xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-lg transition-transform active:scale-95 shadow-xl flex items-center gap-2 cursor-pointer"
                >
                  <Pause size={20} />
                  <span>{lang === 'zh' ? '暂停' : 'Pause'}</span>
                </button>
              ) : countdown.isPaused ? (
                <button
                  type="button"
                  onClick={handleResume}
                  className="px-8 py-3 rounded-2xl bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-lg transition-transform active:scale-95 shadow-xl flex items-center gap-2 cursor-pointer"
                >
                  <Play size={20} />
                  <span>{lang === 'zh' ? '继续' : 'Resume'}</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => handleStart(countdown.totalDuration || 300)}
                  className="px-8 py-3 rounded-2xl bg-primary-theme hover:opacity-90 text-white font-bold text-lg transition-transform active:scale-95 shadow-xl flex items-center gap-2 cursor-pointer"
                >
                  <Play size={20} />
                  <span>{lang === 'zh' ? '开始' : 'Start'}</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => handleAddTime(60)}
                className="px-5 py-3 rounded-2xl bg-white/10 hover:bg-white/20 text-white font-bold text-base transition-colors cursor-pointer border border-white/20"
              >
                +1 分钟
              </button>
              <button
                type="button"
                onClick={() => handleAddTime(300)}
                className="px-5 py-3 rounded-2xl bg-white/10 hover:bg-white/20 text-white font-bold text-base transition-colors cursor-pointer border border-white/20"
              >
                +5 分钟
              </button>
              <button
                type="button"
                onClick={handleReset}
                className="p-3 rounded-2xl bg-white/10 hover:bg-white/20 text-white font-bold transition-colors cursor-pointer border border-white/20"
                title="重置"
              >
                <RotateCcw size={20} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ClassroomCountdownWidget;
