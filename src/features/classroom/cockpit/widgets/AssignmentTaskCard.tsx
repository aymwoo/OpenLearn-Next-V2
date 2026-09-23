import React from 'react';
import {
  Upload,
  Code2,
  Users,
  Maximize2,
  Settings,
  Trash2,
  CheckCircle2,
} from 'lucide-react';

export interface AssignmentTaskCardProps {
  title?: string;
  subtitle?: string;
  submittedCount?: number;
  totalStudents?: number;
  onSubmitCheck?: () => void;
  onMaximize?: () => void;
  onConfigure?: () => void;
  onDelete?: () => void;
  lang?: 'zh' | 'en';
}

export function AssignmentTaskCard({
  title = 'test作业1：螺旋彩虹绘制程序',
  subtitle = 'Upload your work here · 请确保循环条件边界设置正确',
  submittedCount = 29,
  totalStudents = 32,
  onSubmitCheck,
  onMaximize,
  onConfigure,
  onDelete,
  lang = 'zh',
}: AssignmentTaskCardProps) {
  const completionRate = totalStudents > 0 ? ((submittedCount / totalStudents) * 100).toFixed(1) : '0';

  return (
    <div
      className="w-[380px] bg-surface rounded-2xl shadow-xl border border-border overflow-hidden select-none hover:shadow-2xl transition duration-200"
      data-purpose="assignment-task-card"
    >
      {/* ── Card Header (Stitch Screen 1219a481) ── */}
      <div className="px-4 py-3 bg-gradient-to-r from-orange-50 via-surface to-amber-50 dark:from-orange-950/30 dark:via-surface dark:to-amber-950/20 border-b border-orange-200/60 dark:border-orange-800/60 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded-lg bg-orange-500 text-white flex items-center justify-center text-xs font-bold shadow-xs">
            <Upload size={13} className="stroke-[2.5]" />
          </span>
          <h4 className="text-xs font-bold text-foreground tracking-tight">Assignment Upload Task</h4>
        </div>
        <div className="flex items-center gap-1.5 text-muted">
          {onMaximize && (
            <button
              type="button"
              onClick={onMaximize}
              className="hover:text-foreground p-0.5 cursor-pointer rounded"
              title={lang === 'zh' ? '最大化窗口' : 'Maximize'}
            >
              <Maximize2 size={12} />
            </button>
          )}
          {onConfigure && (
            <button
              type="button"
              onClick={onConfigure}
              className="hover:text-foreground p-0.5 cursor-pointer rounded"
              title={lang === 'zh' ? '设置' : 'Settings'}
            >
              <Settings size={12} />
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="hover:text-rose-500 p-0.5 cursor-pointer rounded"
              title={lang === 'zh' ? '移除任务' : 'Delete'}
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
      </div>

      {/* ── Card Body (Stitch Screen 1219a481) ── */}
      <div className="p-6 text-center">
        <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-orange-50 dark:bg-orange-950/40 border border-orange-200 dark:border-orange-800 flex items-center justify-center text-orange-600 dark:text-orange-400 shadow-inner">
          <Code2 size={28} />
        </div>
        <h5 className="text-base font-bold text-foreground mb-1 tracking-tight">{title}</h5>
        <p className="text-xs text-muted mb-5 leading-relaxed">{subtitle}</p>

        <button
          type="button"
          onClick={onSubmitCheck}
          className="w-full py-2.5 px-4 bg-orange-500 hover:bg-orange-600 active:bg-orange-700 text-white rounded-xl text-xs font-bold tracking-wide shadow-md shadow-orange-300 dark:shadow-none transition flex items-center justify-center gap-2 cursor-pointer"
        >
          <Upload size={14} className="stroke-[2.5]" />
          <span>{lang === 'zh' ? '提交作业与代码检核' : 'Submit & Lint Code'}</span>
        </button>
      </div>

      {/* ── Card Footer Metrics (Stitch Screen 1219a481) ── */}
      <div className="px-4 py-2.5 bg-surface-secondary/60 border-t border-border flex items-center justify-between text-[11px] text-muted">
        <span className="flex items-center gap-1">
          <Users size={12} className="text-muted" />
          <span>
            {lang === 'zh' ? '已提交:' : 'Submitted:'}{' '}
            <strong className="text-foreground font-bold">{submittedCount}</strong> / {totalStudents}
          </span>
        </span>
        <span className="text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-1">
          <CheckCircle2 size={11} />
          <span>{completionRate}% 完成率</span>
        </span>
      </div>
    </div>
  );
}
