import React, { useRef, useEffect } from 'react';
import { Scroll, ShieldCheck, Bell, Trash2 } from 'lucide-react';
import { ExtensionPointRenderer } from '../../../plugin-host/extension-point-renderer';

export type AuditEventLevel = 'WARNING' | 'INFO' | 'ANSWER' | 'SYSTEM' | 'PLUGIN';

export interface AuditEventItem {
  id: string;
  time: string;
  level: AuditEventLevel;
  message: string;
  payload?: any;
}

export interface TypedAuditStreamProps {
  events: AuditEventItem[];
  onClear?: () => void;
  lang?: 'zh' | 'en';
}

export function TypedAuditStream({
  events = [],
  onClear,
  lang = 'zh',
}: TypedAuditStreamProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to top on new event
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [events]);

  const defaultEvents: AuditEventItem[] = [
    {
      id: 'evt-1',
      time: '06:35:45 PM',
      level: 'WARNING',
      message: '已对全班学生强制锁定专注模式（限定当前课程）。',
    },
    {
      id: 'evt-2',
      time: '06:32:25 PM',
      level: 'INFO',
      message: '教学环节切换并广播：进入【开场准备】。',
    },
    {
      id: 'evt-3',
      time: '06:30:12 PM',
      level: 'ANSWER',
      message: '学生【张小明】率先完成第一阶段沙箱代码运行。',
    },
    {
      id: 'evt-4',
      time: '06:28:00 PM',
      level: 'SYSTEM',
      message: '智能控制中心系统握手成功，推流引擎已在线。',
    },
  ];

  const displayEvents = events.length > 0 ? events : defaultEvents;

  const renderBadge = (level: AuditEventLevel) => {
    switch (level) {
      case 'WARNING':
        return (
          <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.2 rounded bg-amber-200 dark:bg-amber-900/60 text-amber-900 dark:text-amber-200">
            WARNING
          </span>
        );
      case 'INFO':
        return (
          <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.2 rounded bg-sky-100 dark:bg-sky-900/60 text-sky-800 dark:text-sky-200">
            INFO
          </span>
        );
      case 'ANSWER':
        return (
          <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.2 rounded bg-emerald-200 dark:bg-emerald-900/60 text-emerald-900 dark:text-emerald-200">
            ANSWER
          </span>
        );
      case 'SYSTEM':
        return (
          <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.2 rounded bg-surface-secondary text-muted border border-border">
            SYSTEM
          </span>
        );
      case 'PLUGIN':
        return (
          <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.2 rounded bg-purple-100 dark:bg-purple-900/60 text-purple-800 dark:text-purple-200">
            PLUGIN
          </span>
        );
      default:
        return (
          <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.2 rounded bg-surface-secondary text-muted">
            INFO
          </span>
        );
    }
  };

  const getContainerStyle = (level: AuditEventLevel) => {
    switch (level) {
      case 'WARNING':
        return 'bg-amber-50/70 dark:bg-amber-950/20 border-amber-200/80 dark:border-amber-800/60';
      case 'INFO':
        return 'bg-surface-secondary/50 border-border/80';
      case 'ANSWER':
        return 'bg-emerald-50/70 dark:bg-emerald-950/20 border-emerald-200/80 dark:border-emerald-800/60';
      case 'SYSTEM':
        return 'bg-surface border-border';
      case 'PLUGIN':
        return 'bg-purple-50/70 dark:bg-purple-950/20 border-purple-200/80 dark:border-purple-800/60';
      default:
        return 'bg-surface border-border';
    }
  };

  return (
    <section className="flex-1 flex flex-col overflow-hidden select-none" data-purpose="realtime-interaction-log">
      {/* ── Header ── */}
      <div className="p-3 border-b border-border/80 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-1.5">
          <Scroll size={14} className="text-indigo-600 dark:text-indigo-400 stroke-[2.5]" />
          <h3 className="font-bold text-foreground text-xs">
            {lang === 'zh' ? '课堂互动反馈流' : 'Interaction Audit Stream'}
          </h3>
        </div>
        {onClear && (
          <button
            type="button"
            onClick={onClear}
            className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 font-medium transition cursor-pointer"
          >
            Clear
          </button>
        )}
      </div>

      {/* ── Scrollable Event Items (Stitch Screen 1219a481) ── */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2.5 text-xs custom-scrollbar">
        {displayEvents.map((evt) => (
          <div key={evt.id} className={`p-2.5 rounded-lg border ${getContainerStyle(evt.level)} transition shadow-3xs`}>
            <div className="flex items-center justify-between mb-1">
              <span className="font-mono text-[10px] text-muted">{evt.time}</span>
              {renderBadge(evt.level)}
            </div>
            <p className="text-foreground/90 leading-snug text-[11px]">{evt.message}</p>
          </div>
        ))}

        {/* Third-Party Plugin Audit Event Extension Slot */}
        <ExtensionPointRenderer slot="classroom.audit.event" />
      </div>

      {/* ── Sticky Audit Stream Bottom Status (Stitch Screen 1219a481) ── */}
      <div className="p-2 bg-surface-secondary border-t border-border flex items-center justify-between text-[11px] text-muted shrink-0">
        <span className="flex items-center gap-1.5 font-mono text-[10px] font-bold tracking-wider">
          <ShieldCheck size={13} className="text-emerald-600 dark:text-emerald-400" />
          <span>OS CORE OPTIONS</span>
        </span>
        <span className="inline-flex items-center gap-1 bg-surface px-2 py-0.5 rounded border border-border text-amber-700 dark:text-amber-400 font-bold cursor-pointer text-[10px] shadow-3xs">
          <Bell size={10} />
          <span>{lang === 'zh' ? `事件流 (${displayEvents.length})` : `Events (${displayEvents.length})`}</span>
        </span>
      </div>
    </section>
  );
}
