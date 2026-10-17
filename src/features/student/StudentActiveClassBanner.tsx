import React from 'react';
import { Radio, ArrowRight } from 'lucide-react';
import type { StudentActiveSession } from './useStudentActiveSession';

/**
 * Issue #109: 学生看板顶部的「正在上课 · 返回课堂」横幅。
 *
 * 只在真实存在进行中会话时渲染（数据来自 `GET /api/student/active-session`），
 * 不受可拖拽组件布局影响——无论学生把课表卡片折叠或拖到哪里，返回入口始终可见。
 */
export function StudentActiveClassBanner({
  activeSession,
  lang = 'zh',
  onReturn,
}: {
  activeSession: StudentActiveSession;
  lang?: 'zh' | 'en';
  onReturn: () => void;
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
        </div>
      </div>
      <button
        type="button"
        onClick={onReturn}
        className="shrink-0 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs transition-colors cursor-pointer"
      >
        <span>{zh ? '返回课堂' : 'Return to class'}</span>
        <ArrowRight size={13} aria-hidden="true" />
      </button>
    </div>
  );
}

export default StudentActiveClassBanner;
