/**
 * 大屏展台 · 真实课堂指标组件组
 *
 * 这些区块展示的每个数字都必须来自 `/api/classroom/stage/:lessonId/data`
 * （即真实的课堂流程数据），**不允许**任何形式的占位/示意值：
 *  - 没有数据 → 显示「—」或明确的空态说明；
 *  - 不用「典型值」「示例」填充 —— 投影给全班看，编造的数字会误导所有人。
 */
import React from 'react';
import { Users, UserCheck, Activity, MousePointerClick, FileCheck2, Radio } from 'lucide-react';
import type { StageAttendance, StageCoursewareStats, StageFeedItem } from './useStageDisplayFeed';

/** 计数类：0 是有意义的真实值，只有「字段缺失」才显示 — */
function count(value: number | undefined | null): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '—';
}

function percent(numerator: number, denominator: number): string {
  if (!denominator || denominator <= 0) return '—';
  return `${Math.round((numerator / denominator) * 100)}%`;
}

export function StageAttendanceCard({ attendance, zh = true }: { attendance?: StageAttendance; zh?: boolean }) {
  const online = attendance?.onlineInClass ?? 0;
  const expected = attendance?.expected ?? 0;
  const attended = attendance?.attended ?? 0;
  const onlineRate = percent(online, expected);
  // 有名单才有资格谈出勤率；没有名单时给 — 而不是 0%（0% 会被误读成「没人来」）
  const showRate = expected > 0;

  return (
    <div className="bg-slate-900/90 rounded-3xl border border-slate-800 p-6 shadow-xl flex flex-col gap-4">
      <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
        <div className="flex items-center gap-2 text-white font-bold text-base">
          <Users size={18} className="text-blue-400" />
          <span>{zh ? '课堂出勤' : 'Attendance'}</span>
        </div>
        <span
          data-testid="stage-attendance-online"
          className="flex items-center gap-1.5 text-xs font-semibold text-emerald-300"
        >
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          {zh ? '实时在线' : 'Online'} {count(online)}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-3 text-center">
        <div className="bg-slate-800/50 rounded-2xl border border-slate-700/50 py-3">
          <div className="text-2xl font-black font-mono text-white">{count(online)}</div>
          <div className="text-[11px] text-slate-400 mt-1">{zh ? '本班在线' : 'Online'}</div>
        </div>
        <div className="bg-slate-800/50 rounded-2xl border border-slate-700/50 py-3">
          <div className="text-2xl font-black font-mono text-white">{count(attended)}</div>
          <div className="text-[11px] text-slate-400 mt-1">{zh ? '已到课' : 'Attended'}</div>
        </div>
        <div className="bg-slate-800/50 rounded-2xl border border-slate-700/50 py-3">
          <div className="text-2xl font-black font-mono text-white">{count(expected)}</div>
          <div className="text-[11px] text-slate-400 mt-1">{zh ? '应到' : 'Expected'}</div>
        </div>
      </div>

      {showRate ? (
        <>
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>{zh ? '实到率' : 'Attendance rate'}</span>
            <span className="font-mono font-bold text-white">{percent(attended, expected)}</span>
          </div>
          <div className="h-3 w-full bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-500"
              style={{ width: percent(attended, expected) }}
            />
          </div>
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>{zh ? '当前在线率' : 'Live online rate'}</span>
            <span className="font-mono font-bold text-emerald-300">{onlineRate}</span>
          </div>
        </>
      ) : (
        <p className="text-[11px] text-slate-500 leading-relaxed">
          {zh
            ? '本课节未绑定班级名单，暂无应到/实到口径（避免用 0% 误导为「无人到课」）。'
            : 'No class roster bound to this lesson; expected/attended is unavailable.'}
        </p>
      )}
    </div>
  );
}

export function StageCoursewareCard({ stats, zh = true }: { stats?: StageCoursewareStats; zh?: boolean }) {
  const attempts = stats?.attempts ?? 0;
  const participants = stats?.participants ?? 0;
  const completed = stats?.completed ?? 0;
  const avg = stats?.avgCompletion ?? 0;
  const hasAny = attempts > 0;

  return (
    <div className="bg-slate-900/90 rounded-3xl border border-slate-800 p-6 shadow-xl flex flex-col gap-4">
      <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
        <div className="flex items-center gap-2 text-white font-bold text-base">
          <MousePointerClick size={18} className="text-amber-400" />
          <span>{zh ? '互动课件参与' : 'Courseware Activity'}</span>
        </div>
        {hasAny && (
          <span className="text-xs text-slate-400 font-mono">
            {attempts} {zh ? '次作答' : 'attempts'}
          </span>
        )}
      </div>

      {hasAny ? (
        <>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="bg-slate-800/50 rounded-2xl border border-slate-700/50 py-3">
              <div className="text-2xl font-black font-mono text-white">{count(participants)}</div>
              <div className="text-[11px] text-slate-400 mt-1">{zh ? '参与人数' : 'Students'}</div>
            </div>
            <div className="bg-slate-800/50 rounded-2xl border border-slate-700/50 py-3">
              <div className="text-2xl font-black font-mono text-white">{count(completed)}</div>
              <div className="text-[11px] text-slate-400 mt-1">{zh ? '已完成' : 'Completed'}</div>
            </div>
            <div className="bg-slate-800/50 rounded-2xl border border-slate-700/50 py-3">
              <div className="text-2xl font-black font-mono text-white">{count(avg)}%</div>
              <div className="text-[11px] text-slate-400 mt-1">{zh ? '平均完成度' : 'Avg done'}</div>
            </div>
          </div>
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>{zh ? '完成率' : 'Completion rate'}</span>
            <span className="font-mono font-bold text-white">{percent(completed, attempts)}</span>
          </div>
          <div className="h-3 w-full bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-amber-500 rounded-full transition-all duration-500"
              style={{ width: percent(completed, attempts) }}
            />
          </div>
        </>
      ) : (
        <p className="text-[11px] text-slate-500 leading-relaxed flex items-center gap-2">
          <FileCheck2 size={14} className="shrink-0" />
          {zh ? '本课节还没有学生打开互动课件，作答数据将在学生开始操作后实时出现。' : 'No courseware activity yet.'}
        </p>
      )}
    </div>
  );
}

const FEED_ICON: Record<string, string> = {
  quiz_answered: '✅',
  checkin: '🙋',
  achievement: '🏅',
  assignment_submitted: '📄',
  assignment_graded: '🖊️',
  progress: '📈',
  courseware_submitted: '🖥️',
  answer: '💡',
  success: '🎉',
  info: 'ℹ️',
};

export function StageFeedCard({ feed, zh = true }: { feed?: StageFeedItem[]; zh?: boolean }) {
  const items = feed ?? [];

  return (
    <div className="bg-slate-900/90 rounded-3xl border border-slate-800 p-6 shadow-xl flex flex-col gap-3">
      <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
        <div className="flex items-center gap-2 text-white font-bold text-base">
          <Activity size={18} className="text-blue-400" />
          <span>{zh ? '课堂动态' : 'Live Feed'}</span>
        </div>
        <span className="text-xs text-slate-400 font-mono">
          {items.length} {zh ? '条' : 'items'}
        </span>
      </div>

      {items.length > 0 ? (
        <ul className="flex flex-col gap-1.5 max-h-64 overflow-y-auto no-scrollbar">
          {items.map((f) => (
            <li
              key={f.id}
              className="flex items-start gap-2 text-xs text-slate-300 px-2 py-1.5 rounded-lg hover:bg-slate-800/50 transition-colors"
            >
              <span aria-hidden="true" className="shrink-0">
                {FEED_ICON[f.type] ?? '•'}
              </span>
              <span className="flex-1 leading-relaxed break-words">
                {f.actorName ? <span className="font-bold text-white">{f.actorName}</span> : null}
                <span className="ml-1">{f.message}</span>
              </span>
              {f.at > 0 && (
                <span className="shrink-0 font-mono text-[10px] text-slate-500">
                  {new Date(f.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[11px] text-slate-500 leading-relaxed flex items-center gap-2">
          <Radio size={14} className="shrink-0" />
          {zh ? '课堂动态会在学生答题、签到、提交课件时实时出现在这里。' : 'Live events will appear here.'}
        </p>
      )}
    </div>
  );
}

export function StageExitTicketProgress({
  submitted,
  expected,
  zh = true,
}: {
  submitted?: number;
  expected?: number;
  zh?: boolean;
}) {
  const done = submitted ?? 0;
  const total = expected ?? 0;
  return (
    <div className="flex items-center justify-between text-xs text-slate-400">
      <span className="flex items-center gap-1.5">
        <UserCheck size={13} className="text-indigo-400" />
        {zh ? '结课通票已提交' : 'Exit tickets submitted'}
      </span>
      <span className="font-mono font-bold text-white">
        {count(done)}
        {total > 0 ? ` / ${count(total)}` : ''}
      </span>
    </div>
  );
}
