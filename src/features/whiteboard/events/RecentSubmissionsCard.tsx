import React, { useMemo } from 'react';
import { useWhiteboardEvents } from './useWhiteboardEvents';
import type { WhiteboardEvent } from './types';

/**
 * TeacherPanel "最近提交" 小卡 — 订阅 quiz.answered / courseware.submitted 事件，
 * 在教师仪表盘 / 课件管理面板顶部内嵌显示最近 5 条成绩/进度提交。
 *
 * 用途：
 *  - 教师实时观察学生在白板内提交的成绩
 *  - 不依赖轮询，由 WhiteboardEventSlot 推送
 *  - 不需要父组件传任何 props（除 lessonId 过滤）
 */
export interface RecentSubmissionsCardProps {
  lessonId?: string;
  className?: string;
  maxItems?: number;
}

function formatTime(ts: number | string | undefined): string {
  if (!ts) return '-';
  const n = typeof ts === 'number' ? ts : Number(ts);
  const d = !isNaN(n) ? new Date(n) : new Date(String(ts));
  if (isNaN(d.getTime())) return '-';
  return d.toLocaleTimeString();
}

function describeEvent(e: WhiteboardEvent): { label: string; tone: 'good' | 'bad' | 'neutral'; detail: string } {
  if (e.type === 'quiz.answered') {
    const isCorrect = !!e.payload.isCorrect;
    const score = typeof e.payload.score === 'number' ? e.payload.score : null;
    return {
      label: isCorrect ? '✓ 答对' : '✗ 答错',
      tone: isCorrect ? 'good' : 'bad',
      detail: `${e.studentName || e.studentId || '匿名'} · ${score !== null ? score + '分' : '已提交'} · ${e.payload.question || ''}`,
    };
  }
  if (e.type === 'courseware.submitted') {
    const score = typeof e.payload.score === 'number' ? e.payload.score : null;
    const total = typeof e.payload.total === 'number' ? e.payload.total : null;
    return {
      label: '📊 课件提交',
      tone: score !== null && score >= 60 ? 'good' : 'neutral',
      detail: `${e.studentName || e.studentId || '匿名'} · ${score !== null && total !== null ? `${score}/${total}` : '已提交'}`,
    };
  }
  if (e.type === 'courseware.progress_saved') {
    return {
      label: '📥 进度保存',
      tone: 'neutral',
      detail: `${e.studentName || e.studentId || '匿名'} · 完成度 ${e.payload.completion ?? '?'}%`,
    };
  }
  if (e.type === 'courseware.finished') {
    return { label: '🏁 课件完成', tone: 'neutral', detail: `${e.studentName || e.studentId || '匿名'}` };
  }
  return { label: e.type, tone: 'neutral', detail: '' };
}

export const RecentSubmissionsCard: React.FC<RecentSubmissionsCardProps> = ({
  lessonId,
  className,
  maxItems = 5,
}) => {
  const events = useWhiteboardEvents(
    {
      types: ['quiz.answered', 'courseware.submitted', 'courseware.progress_saved', 'courseware.finished'],
      lessonId,
    },
    { replay: maxItems, maxItems },
  );

  const top = useMemo(() => events.slice(0, maxItems), [events, maxItems]);

  if (top.length === 0) {
    return (
      <div
        data-testid="recent-submissions-card"
        data-state="empty"
        className={
          'rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4 text-center text-sm text-gray-400 ' +
          (className || '')
        }
      >
        📭 暂无最近提交
      </div>
    );
  }

  return (
    <div
      data-testid="recent-submissions-card"
      className={
        'rounded-xl border border-indigo-200 bg-indigo-50/50 p-3 shadow-sm ' + (className || '')
      }
    >
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs font-bold text-indigo-700">📋 最近提交</h4>
        <span className="text-[10px] text-indigo-400">{top.length} 条</span>
      </div>
      <ul className="space-y-1" data-testid="recent-submissions-list">
        {top.map((e) => {
          const desc = describeEvent(e);
          const toneClass =
            desc.tone === 'good'
              ? 'text-green-700 bg-green-50'
              : desc.tone === 'bad'
                ? 'text-red-700 bg-red-50'
                : 'text-gray-700 bg-white';
          return (
            <li
              key={e.id}
              data-testid={`recent-submission-row-${e.id}`}
              className="flex items-center gap-2 px-2 py-1 rounded-md text-xs"
            >
              <span className={`shrink-0 px-1.5 py-0.5 rounded font-mono font-bold ${toneClass}`}>
                {desc.label}
              </span>
              <span className="flex-1 truncate text-gray-700" title={desc.detail}>
                {desc.detail}
              </span>
              <span className="shrink-0 text-[10px] text-gray-400">{formatTime(e.timestamp)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default RecentSubmissionsCard;
