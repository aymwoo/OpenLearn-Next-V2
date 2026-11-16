import React from 'react';
import { Radio, ArrowRight, X } from 'lucide-react';
import type { StudentActiveSession } from './useStudentActiveSession';

/**
 * Issue #109 / IKVNIX: 学生看板顶部的进行中课次提示。
 *
 * 默认是可关闭的轻量横幅：不阻塞浏览，支持「本次忽略 / 延后到明天」。
 * 忽略或延后后由宿主折叠，顶部导航仍保留一键「返回课堂」入口。
 */
export function StudentActiveClassBanner({
  activeSession,
  lang = 'zh',
  onReturn,
  onIgnore,
  onSnooze,
}: {
  activeSession: StudentActiveSession;
  lang?: 'zh' | 'en';
  onReturn: () => void;
  onIgnore?: () => void;
  onSnooze?: () => void;
}) {
  const zh = lang === 'zh';
  const inProgress = activeSession.stage === 'IN_CLASS_TEACHING' || activeSession.stage === 'WRAP_UP_EXIT_TICKET';

  return (
    <div
      data-testid="student-active-class-banner"
      role="status"
      className="flex flex-wrap items-center gap-3 rounded-xl border border-emerald-200 dark:border-emerald-800/60 bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-950/40 dark:to-teal-950/30 px-4 py-3 shadow-2xs"
    >
      <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden="true">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
      </span>
      <Radio size={16} className="shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-bold text-emerald-900 dark:text-emerald-100 truncate">
          {inProgress
            ? zh
              ? `正在上课：${activeSession.lessonTitle || activeSession.className}`
              : `In class: ${activeSession.lessonTitle || activeSession.className}`
            : zh
              ? `课堂已开启：${activeSession.lessonTitle || activeSession.className}`
              : `Class started: ${activeSession.lessonTitle || activeSession.className}`}
        </div>
        <div className="text-xs text-emerald-700/80 dark:text-emerald-300/80 mt-0.5">
          {activeSession.className}
          {activeSession.startedAt
            ? zh
              ? ` · 已进行 ${Math.max(0, Math.floor((Date.now() - activeSession.startedAt) / 60000))} 分钟`
              : ` · ${Math.max(0, Math.floor((Date.now() - activeSession.startedAt) / 60000))}m elapsed`
            : ''}
          {zh ? ' · 可忽略本提示，随时从顶部返回课堂' : ' · You can dismiss this and return anytime from the header'}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 shrink-0">
        {onIgnore && (
          <button
            type="button"
            data-testid="student-active-class-ignore"
            onClick={onIgnore}
            className="inline-flex items-center px-2.5 py-1.5 rounded-lg border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-xs font-semibold hover:bg-emerald-100/80 dark:hover:bg-emerald-900/40 transition-colors cursor-pointer"
          >
            {zh ? '本次忽略' : 'Ignore this time'}
          </button>
        )}
        {onSnooze && (
          <button
            type="button"
            data-testid="student-active-class-snooze"
            onClick={onSnooze}
            className="inline-flex items-center px-2.5 py-1.5 rounded-lg border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-xs font-semibold hover:bg-emerald-100/80 dark:hover:bg-emerald-900/40 transition-colors cursor-pointer"
          >
            {zh ? '延后到明天' : 'Snooze until tomorrow'}
          </button>
        )}
        <button
          type="button"
          onClick={onReturn}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs transition-colors cursor-pointer"
        >
          <span>{zh ? '返回课堂' : 'Return to class'}</span>
          <ArrowRight size={13} aria-hidden="true" />
        </button>
        {onIgnore && (
          <button
            type="button"
            data-testid="student-active-class-dismiss"
            onClick={onIgnore}
            className="inline-flex items-center justify-center h-7 w-7 rounded-lg text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 cursor-pointer"
            aria-label={zh ? '关闭提示' : 'Dismiss'}
            title={zh ? '关闭提示（本次忽略）' : 'Dismiss (ignore this time)'}
          >
            <X size={14} aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}

export default StudentActiveClassBanner;
