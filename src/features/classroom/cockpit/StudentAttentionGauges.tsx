import React, { useState } from 'react';
import { Send, Shield, ShieldAlert, AlertTriangle } from 'lucide-react';

export interface StudentGaugeItem {
  id: string;
  name: string;
  studentNo?: string;
  focusPercent: number;
  isOnline: boolean;
  isLocked: boolean;
  hasError?: boolean;
}

export interface StudentAttentionGaugesProps {
  students: StudentGaugeItem[];
  onPingStudent?: (studentId: string, message?: string) => void;
  onToggleLockStudent?: (studentId: string, currentLocked: boolean) => void;
  onSelectStudentProfile?: (studentId: string) => void;
  lang?: 'zh' | 'en';
}

export function StudentAttentionGauges({
  students = [],
  onPingStudent,
  onToggleLockStudent,
  onSelectStudentProfile,
  lang = 'zh',
}: StudentAttentionGaugesProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // SVG ring circumference (r=17) -> 2 * PI * 17 ≈ 106.8
  const circumference = 106.8;

  // Demo fallback if student list is empty
  const displayStudents: StudentGaugeItem[] =
    students.length > 0
      ? students
      : [
          { id: 'st-1', name: '测试机A', focusPercent: 59, isOnline: true, isLocked: true },
          { id: 'st-2', name: '测试机B', focusPercent: 0, isOnline: false, isLocked: true },
          { id: 'st-3', name: '测试机C', focusPercent: 0, isOnline: false, isLocked: true },
          { id: 'st-4', name: '测试机D', focusPercent: 0, isOnline: false, isLocked: true },
        ];

  return (
    <section className="p-3.5 border-b border-border/80 bg-surface-secondary/40 select-none" data-purpose="student-attention-gauges">
      <div className="grid grid-cols-4 gap-2">
        {displayStudents.slice(0, 12).map((st) => {
          const isHovered = hoveredId === st.id;
          const strokeDashoffset = circumference - (Math.min(Math.max(st.focusPercent, 0), 100) / 100) * circumference;

          // Color mapping
          const isFocused = st.focusPercent >= 50;
          const ringColor = !st.isOnline
            ? 'stroke-slate-300 dark:stroke-slate-700'
            : isFocused
              ? 'stroke-emerald-500'
              : 'stroke-indigo-500';

          return (
            <div
              key={st.id}
              onMouseEnter={() => setHoveredId(st.id)}
              onMouseLeave={() => setHoveredId(null)}
              onClick={() => onSelectStudentProfile?.(st.id)}
              className="bg-surface p-2 rounded-xl border border-border flex flex-col items-center justify-center text-center shadow-3xs hover:border-indigo-300 dark:hover:border-indigo-700 transition relative cursor-pointer group"
            >
              {st.hasError && (
                <span className="absolute -top-1 -right-1 z-20 w-3.5 h-3.5 rounded-full bg-rose-500 text-white flex items-center justify-center shadow-xs">
                  <AlertTriangle size={8} className="animate-pulse" />
                </span>
              )}

              {/* Gauge Circular Ring */}
              <div className="relative w-11 h-11 flex items-center justify-center mb-1">
                <svg className="w-full h-full transform -rotate-90">
                  <circle
                    className="stroke-surface-secondary"
                    cx="22"
                    cy="22"
                    fill="transparent"
                    r="17"
                    strokeWidth="3"
                  />
                  <circle
                    className={`${ringColor} transition-all duration-300`}
                    cx="22"
                    cy="22"
                    fill="transparent"
                    r="17"
                    strokeWidth="3"
                    strokeDasharray={circumference}
                    strokeDashoffset={strokeDashoffset}
                    strokeLinecap="round"
                  />
                </svg>

                {/* Center Percentage or Hover Controls */}
                {!isHovered ? (
                  <span className="absolute text-[10px] font-bold text-foreground font-mono">
                    {st.focusPercent}%
                  </span>
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center gap-1 bg-surface/90 rounded-full animate-in fade-in duration-100">
                    {onPingStudent && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onPingStudent(st.id, '请跟上老师的教学节奏！');
                        }}
                        className="text-muted hover:text-amber-500 p-0.5"
                        title={lang === 'zh' ? '提醒' : 'Ping'}
                      >
                        <Send size={10} />
                      </button>
                    )}
                    {onToggleLockStudent && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleLockStudent(st.id, st.isLocked);
                        }}
                        className={`p-0.5 ${st.isLocked ? 'text-rose-500' : 'text-muted hover:text-rose-500'}`}
                        title={st.isLocked ? (lang === 'zh' ? '解锁' : 'Unlock') : lang === 'zh' ? '锁定' : 'Lock'}
                      >
                        {st.isLocked ? <ShieldAlert size={10} /> : <Shield size={10} />}
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Student Name */}
              <span className="text-[11px] font-medium text-foreground truncate w-full">
                {st.name}
              </span>

              {/* Status pill */}
              <span
                className={`text-[9px] font-medium ${
                  !st.isOnline
                    ? 'text-muted'
                    : isFocused
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-indigo-600 dark:text-indigo-400'
                }`}
              >
                {!st.isOnline ? (lang === 'zh' ? '待就绪' : 'Ready') : isFocused ? (lang === 'zh' ? '专注中' : 'Focused') : (lang === 'zh' ? '活跃' : 'Active')}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
