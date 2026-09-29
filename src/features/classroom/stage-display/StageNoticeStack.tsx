/**
 * 大屏展台提示队列
 *
 * 展台是投到副屏/投影上的，无人操作，所以状态提示必须：
 *  - 醒目但不遮挡正在展示的主体内容（右上角堆叠，自上而下淡出）
 *  - 可手动关闭（大屏上误触无法「撤销」，不能要求操作）
 *  - 高频事件下自动收敛（按 dedupeKey 合并 + 限制条数）
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X, WifiOff, Wifi, CheckCircle2, AlertTriangle, Info, Sparkles } from 'lucide-react';
import type { StageNotice, NoticeTone } from './stage-notices';

const TONE_STYLE: Record<
  NoticeTone,
  { ring: string; icon: React.ComponentType<{ size?: number; className?: string }> }
> = {
  info: { ring: 'border-sky-500/50 bg-sky-500/10 text-sky-200', icon: Info },
  success: { ring: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-200', icon: CheckCircle2 },
  warning: { ring: 'border-amber-500/50 bg-amber-500/10 text-amber-200', icon: AlertTriangle },
  accent: { ring: 'border-indigo-500/50 bg-indigo-500/10 text-indigo-200', icon: Sparkles },
};

const AUTO_DISMISS_MS = 6000;
const MAX_VISIBLE = 4;
/** 同一 dedupeKey 的重复提示在该窗口内合并（投票刷人数时不该刷屏） */
const DEDUPE_WINDOW_MS = 8000;

export interface NoticeStackProps {
  notices: StageNotice[];
  onDismiss: (id: string) => void;
  lang?: 'zh' | 'en';
}

export function NoticeStack({ notices, onDismiss, lang = 'zh' }: NoticeStackProps) {
  const visible = notices.slice(-MAX_VISIBLE);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    for (const n of visible) {
      if (timersRef.current.has(n.id)) continue;
      const t = setTimeout(() => {
        timersRef.current.delete(n.id);
        onDismiss(n.id);
      }, AUTO_DISMISS_MS);
      timersRef.current.set(n.id, t);
    }
    // 清理：已消失的提示要撤掉它们的定时器，否则 onDismiss 会打到已卸载的项
    const alive = new Set(visible.map((n) => n.id));
    for (const [id, t] of timersRef.current) {
      if (!alive.has(id)) {
        clearTimeout(t);
        timersRef.current.delete(id);
      }
    }
  }, [visible, onDismiss]);

  useEffect(
    () => () => {
      for (const t of timersRef.current.values()) clearTimeout(t);
      timersRef.current.clear();
    },
    [],
  );

  if (visible.length === 0) return null;

  return (
    <div
      aria-live="polite"
      data-testid="stage-notice-stack"
      className="fixed top-24 right-8 z-[10000] flex flex-col gap-2.5 w-[360px] pointer-events-none"
    >
      {visible.map((n) => {
        const tone = TONE_STYLE[n.tone] ?? TONE_STYLE.info;
        const Icon = tone.icon;
        return (
          <div
            key={n.id}
            data-testid="stage-notice"
            data-dedupe-key={n.dedupeKey}
            className={`pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-2xl border backdrop-blur-md shadow-2xl animate-slide-up ${tone.ring}`}
          >
            <span className="text-xl leading-none shrink-0 mt-0.5" aria-hidden="true">
              {n.icon}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <Icon size={14} className="shrink-0" />
                <span className="text-sm font-bold truncate">{n.title}</span>
              </div>
              {n.detail && <p className="text-xs opacity-80 mt-1 line-clamp-2">{n.detail}</p>}
            </div>
            <button
              onClick={() => onDismiss(n.id)}
              aria-label={lang === 'zh' ? '关闭提示' : 'Dismiss'}
              className="shrink-0 p-1 rounded-lg opacity-60 hover:opacity-100 hover:bg-white/10 transition-colors cursor-pointer"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

/**
 * 提示队列状态机：负责去重、限流与自动消失。
 * 单独成 hook，便于在测试里直接驱动而不必渲染 UI。
 */
export function useNoticeQueue(lang: 'zh' | 'en' = 'zh') {
  const [notices, setNotices] = useState<StageNotice[]>([]);
  const recentKeysRef = useRef<Map<string, number>>(new Map());

  const push = useCallback((incoming: StageNotice[]) => {
    if (incoming.length === 0) return;
    const now = Date.now();
    setNotices((prev) => {
      let next = prev;
      for (const n of incoming) {
        // 同 key 在窗口内已出现过 → 跳过，避免同一状态反复刷屏
        const last = recentKeysRef.current.get(n.dedupeKey);
        if (last && now - last < DEDUPE_WINDOW_MS) continue;
        recentKeysRef.current.set(n.dedupeKey, now);
        // 清掉过期的 key 记忆，避免 Map 无限增长
        for (const [k, t] of recentKeysRef.current) {
          if (now - t > DEDUPE_WINDOW_MS) recentKeysRef.current.delete(k);
        }
        next = [...next, n];
      }
      // 队列本身也要限长：无人值守场景下不允许堆成一面墙
      return next.length > 40 ? next.slice(next.length - 40) : next;
    });
  }, []);

  const dismiss = useCallback((id: string) => {
    setNotices((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const clear = useCallback(() => setNotices([]), []);

  void lang;
  return { notices, push, dismiss, clear };
}

/** 连接健康度指示灯（大屏顶栏） */
export function ConnectionBadge({
  health,
  lastSyncedAt,
  lang = 'zh',
}: {
  health: 'live' | 'reconnecting' | 'polling' | 'error';
  lastSyncedAt: number | null;
  lang?: 'zh' | 'en';
}) {
  const zh = lang === 'zh';
  const map = {
    live: {
      label: zh ? '实时连接' : 'Live',
      cls: 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10',
      dot: 'bg-emerald-400 animate-pulse',
      Icon: Wifi,
    },
    reconnecting: {
      label: zh ? '重连中' : 'Reconnecting',
      cls: 'text-amber-300 border-amber-500/40 bg-amber-500/10',
      dot: 'bg-amber-400 animate-ping',
      Icon: WifiOff,
    },
    polling: {
      label: zh ? '轮询同步' : 'Polling',
      cls: 'text-sky-300 border-sky-500/40 bg-sky-500/10',
      dot: 'bg-sky-400',
      Icon: Wifi,
    },
    error: {
      label: zh ? '连接异常' : 'Error',
      cls: 'text-rose-300 border-rose-500/40 bg-rose-500/10',
      dot: 'bg-rose-400',
      Icon: WifiOff,
    },
  } as const;
  const view = map[health];
  const Icon = view.Icon;
  const synced = lastSyncedAt ? new Date(lastSyncedAt).toLocaleTimeString() : '--:--:--';

  return (
    <div
      data-testid="stage-connection-badge"
      data-health={health}
      className={`flex items-center gap-2 px-3 py-2 rounded-xl border font-semibold text-xs ${view.cls}`}
      title={zh ? `最近同步：${synced}` : `Last sync: ${synced}`}
    >
      <span className={`w-2 h-2 rounded-full ${view.dot}`} />
      <Icon size={13} />
      <span>{view.label}</span>
      <span className="font-mono opacity-70">{synced}</span>
    </div>
  );
}
