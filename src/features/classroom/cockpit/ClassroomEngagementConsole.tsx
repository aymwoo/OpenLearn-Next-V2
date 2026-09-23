import React, { useState } from 'react';
import {
  Eye,
  Shuffle,
  PieChart,
  Lock,
  Activity,
  Users,
} from 'lucide-react';
import { StudentAttentionGauges, StudentGaugeItem } from './StudentAttentionGauges';
import { TypedAuditStream, AuditEventItem } from './TypedAuditStream';

export interface ClassroomEngagementConsoleProps {
  students: StudentGaugeItem[];
  events: AuditEventItem[];
  onClearEvents?: () => void;
  onRandomPick?: () => void;
  onPingStudent?: (studentId: string, message?: string) => void;
  onToggleLockStudent?: (studentId: string, currentLocked: boolean) => void;
  onSelectStudentProfile?: (studentId: string) => void;
  totalStudentsCount?: number;
  onlineStudentsCount?: number;
  lockedCount?: number;
  averageProgress?: number;
  isDrawing?: boolean;
  lang?: 'zh' | 'en';
}

export function ClassroomEngagementConsole({
  students = [],
  events = [],
  onClearEvents,
  onRandomPick,
  onPingStudent,
  onToggleLockStudent,
  onSelectStudentProfile,
  totalStudentsCount = 32,
  onlineStudentsCount = 1,
  lockedCount = 4,
  averageProgress = 59,
  isDrawing = false,
  lang = 'zh',
}: ClassroomEngagementConsoleProps) {
  return (
    <aside
      className="w-80 bg-surface border-l border-border flex flex-col shrink-0 select-none shadow-3xs"
      data-purpose="student-monitoring-panel"
    >
      {/* ── Student Focus & Attention Grid Header (Stitch Screen 1219a481) ── */}
      <div className="p-3.5 border-b border-border/80 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Eye size={16} className="text-indigo-600 dark:text-indigo-400 stroke-[2.5]" />
          <h2 className="font-bold text-foreground text-xs tracking-wide">
            {lang === 'zh' ? '学生专注力监控' : 'Student Attention Gauges'}
          </h2>
        </div>

        <div className="flex items-center gap-2">
          {onRandomPick && (
            <button
              type="button"
              disabled={isDrawing}
              onClick={onRandomPick}
              className="px-2 py-1 rounded-md bg-indigo-50 dark:bg-indigo-950/50 hover:bg-indigo-100 text-indigo-700 dark:text-indigo-300 text-[11px] font-bold flex items-center gap-1 transition cursor-pointer border border-indigo-200 dark:border-indigo-800"
            >
              <Shuffle size={11} className={isDrawing ? 'animate-spin' : ''} />
              <span>{lang === 'zh' ? '随机抽问' : 'Rollcall'}</span>
            </button>
          )}

          <span className="text-[10px] font-mono text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 px-1.5 py-0.5 rounded font-bold border border-rose-200 dark:border-rose-800">
            {lockedCount} / {students.length || lockedCount} LOCKED
          </span>
        </div>
      </div>

      {/* ── Circular Visual Gauges (4-grid) ── */}
      <StudentAttentionGauges
        students={students}
        onPingStudent={onPingStudent}
        onToggleLockStudent={onToggleLockStudent}
        onSelectStudentProfile={onSelectStudentProfile}
        lang={lang}
      />

      {/* ── Class Statistics Summary Card (班级学情概况 - Stitch Screen 1219a481) ── */}
      <div className="p-3.5 border-b border-border/80 shrink-0" data-purpose="class-metrics-card">
        <div className="flex items-center justify-between text-xs font-bold text-foreground mb-2">
          <div className="flex items-center gap-1.5">
            <PieChart size={13} className="text-indigo-600 dark:text-indigo-400" />
            <span>{lang === 'zh' ? '班级学情概况' : 'Class Overview'}</span>
          </div>
          <span className="text-[10px] text-muted font-normal">
            {lang === 'zh' ? `全班 ${totalStudentsCount} 人实到` : `${totalStudentsCount} Students Total`}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-2 bg-surface-secondary/70 p-2.5 rounded-xl border border-border text-center shadow-3xs">
          <div>
            <div className="text-[10px] text-muted mb-0.5">{lang === 'zh' ? '在线/总数' : 'Online'}</div>
            <div className="text-sm font-extrabold text-foreground font-mono">
              {onlineStudentsCount}{' '}
              <span className="text-muted font-normal text-xs">/ {totalStudentsCount}</span>
            </div>
          </div>

          <div className="border-x border-border">
            <div className="text-[10px] text-muted mb-0.5">{lang === 'zh' ? '屏幕锁定' : 'Locked'}</div>
            <div className="text-sm font-extrabold text-rose-600 dark:text-rose-400 font-mono">
              {lockedCount}{' '}
              <span className="text-muted font-normal text-xs">{lang === 'zh' ? '台' : ''}</span>
            </div>
          </div>

          <div>
            <div className="text-[10px] text-muted mb-0.5">{lang === 'zh' ? '平均进度' : 'Avg Progress'}</div>
            <div className="text-sm font-extrabold text-emerald-600 dark:text-emerald-400 font-mono">
              {averageProgress}%
            </div>
          </div>
        </div>
      </div>

      {/* ── Real-time Interaction Audit Stream ── */}
      <TypedAuditStream
        events={events}
        onClear={onClearEvents}
        lang={lang}
      />
    </aside>
  );
}
