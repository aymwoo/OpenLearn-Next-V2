/**
 * 教师端实时作答进度看板。
 *
 * 学生进入作答、自动保存、交卷或触发监考事件时，服务端向教师房间推送信号，
 * 本面板收到后立即重拉快照；socket 不可用时退化为 3~10 秒自适应轮询。
 */
import React, { useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, RefreshCw, Users } from 'lucide-react';
import type { AssessmentAssignment, AssessmentProgressStudent } from './api';
import { useAssessmentLiveProgress } from './useAssessmentLiveProgress';
import { AccessibleTableRegion } from '../../components/AccessibleTableRegion';

type StatusFilter = 'all' | 'in_progress' | 'not_started' | 'submitted';

const STATUS_STYLE: Record<string, string> = {
  not_started: 'bg-surface-secondary text-muted border-theme',
  in_progress:
    'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-800',
  submitted:
    'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800',
  graded:
    'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800',
};

function statusLabel(status: string, zh: boolean): string {
  switch (status) {
    case 'in_progress':
      return zh ? '作答中' : 'In progress';
    case 'submitted':
      return zh ? '已交卷' : 'Submitted';
    case 'graded':
      return zh ? '已批改' : 'Graded';
    default:
      return zh ? '未开始' : 'Not started';
  }
}

function formatAgo(ts: number | null | undefined, now: number, zh: boolean): string {
  if (!ts) return '—';
  const diff = Math.max(0, now - ts);
  if (diff < 10_000) return zh ? '刚刚' : 'just now';
  if (diff < 60_000) return zh ? `${Math.floor(diff / 1000)} 秒前` : `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return zh ? `${Math.floor(diff / 60_000)} 分钟前` : `${Math.floor(diff / 60_000)}m ago`;
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const STATUS_ORDER: Record<string, number> = { in_progress: 0, not_started: 1, submitted: 2, graded: 3 };

export function LiveProgressPanel({
  assignment,
  lang,
  onBack,
}: {
  assignment: AssessmentAssignment & { className?: string | null };
  lang: 'zh' | 'en';
  onBack: () => void;
}) {
  const zh = lang === 'zh';
  const { snapshot, loading, refreshing, error, updatedAt, refresh } = useAssessmentLiveProgress(assignment.id);
  const [filter, setFilter] = useState<StatusFilter>('all');

  const students = useMemo(() => {
    const list = [...(snapshot?.students ?? [])];
    list.sort((a, b) => {
      const byStatus = (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9);
      if (byStatus !== 0) return byStatus;
      return a.studentNumber.localeCompare(b.studentNumber) || a.name.localeCompare(b.name);
    });
    return list;
  }, [snapshot]);

  const counts = useMemo(
    () => ({
      all: students.length,
      in_progress: students.filter((s) => s.status === 'in_progress').length,
      not_started: students.filter((s) => s.status === 'not_started').length,
      submitted: students.filter((s) => s.status === 'submitted' || s.status === 'graded').length,
    }),
    [students],
  );

  const visible = filter === 'all' ? students : students.filter((s) => matchesFilter(s, filter));
  const now = Date.now();

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-surface border border-theme rounded-2xl shadow-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-theme bg-surface-secondary/70 flex flex-wrap items-center gap-3 shrink-0">
        <button
          type="button"
          onClick={onBack}
          className="p-1.5 rounded-lg border border-theme bg-surface text-muted hover:text-main cursor-pointer"
          aria-label={zh ? '返回试卷' : 'Back to assessment'}
        >
          <ArrowLeft size={15} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-sm font-bold text-main truncate">
            {zh ? '实时进度' : 'Live progress'} · {assignment.className ?? assignment.classId}
          </h1>
          <p className="text-2xs text-muted flex items-center gap-1.5">
            <span
              className={`inline-block w-1.5 h-1.5 rounded-full ${
                counts.in_progress > 0 ? 'bg-emerald-500 motion-safe:animate-pulse' : 'bg-slate-400'
              }`}
              aria-hidden="true"
            />
            <span role="status" aria-live="polite">
              {updatedAt
                ? zh
                  ? `更新于 ${new Date(updatedAt).toLocaleTimeString()}`
                  : `Updated ${new Date(updatedAt).toLocaleTimeString()}`
                : zh
                  ? '等待数据…'
                  : 'Waiting for data…'}
            </span>
            <span className="text-muted">
              ·{' '}
              {counts.in_progress > 0
                ? zh
                  ? '作答中每 3 秒自动刷新'
                  : 'auto-refresh every 3s while answering'
                : zh
                  ? '空闲时每 10 秒自动刷新'
                  : 'auto-refresh every 10s when idle'}
            </span>
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={refreshing}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-theme bg-surface text-xs font-semibold text-main disabled:opacity-50 cursor-pointer"
        >
          <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
          {zh ? '刷新' : 'Refresh'}
        </button>
      </div>

      {error && (
        <p
          role="alert"
          className="mx-5 mt-3 px-3 py-2 rounded-xl border border-rose-200 bg-rose-50 text-rose-700 text-xs"
        >
          {error}
        </p>
      )}

      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { label: zh ? '应交人数' : 'Students', value: snapshot?.totalStudents ?? '—' },
            { label: zh ? '作答中' : 'In progress', value: snapshot?.inProgressCount ?? '—' },
            { label: zh ? '已交卷' : 'Submitted', value: snapshot?.submittedCount ?? '—' },
            { label: zh ? '未开始' : 'Not started', value: snapshot?.notStartedCount ?? '—' },
            {
              label: zh ? '平均分' : 'Average',
              value: snapshot?.avgScore === null || snapshot?.avgScore === undefined ? '—' : snapshot.avgScore,
            },
          ].map((card) => (
            <div key={card.label} className="border border-theme rounded-xl px-3 py-2 bg-surface-secondary/40">
              <p className="text-2xs text-muted">{card.label}</p>
              <p className="text-sm font-bold text-main">{card.value}</p>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              ['all', zh ? '全部' : 'All'],
              ['in_progress', zh ? '作答中' : 'In progress'],
              ['submitted', zh ? '已交卷' : 'Submitted'],
              ['not_started', zh ? '未开始' : 'Not started'],
            ] as Array<[StatusFilter, string]>
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              aria-pressed={filter === key}
              className={`px-2.5 py-1 rounded-full text-2xs font-semibold border cursor-pointer ${
                filter === key
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-surface text-muted border-theme hover:text-main'
              }`}
            >
              {label} {counts[key]}
            </button>
          ))}
        </div>

        {loading && !snapshot ? (
          <p className="text-xs text-muted">{zh ? '正在加载进度…' : 'Loading progress…'}</p>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
            <Users size={32} className="text-muted opacity-40" />
            <p className="text-xs text-muted">{zh ? '当前筛选下没有学生' : 'No students in this filter'}</p>
          </div>
        ) : (
          <AccessibleTableRegion labelledBy="live-progress-caption" className="border border-theme rounded-xl">
            <table data-testid="live-progress-table" className="responsive-data-table w-full text-xs overflow-hidden">
              <caption id="live-progress-caption" className="sr-only">
                {zh ? '学生实时作答进度' : 'Live student progress'}
              </caption>
              <thead className="bg-surface-secondary text-muted">
                <tr>
                  <th scope="col" className="text-left px-3 py-2 font-semibold">
                    {zh ? '学生' : 'Student'}
                  </th>
                  <th scope="col" className="text-left px-3 py-2 font-semibold">
                    {zh ? '状态' : 'Status'}
                  </th>
                  <th scope="col" className="text-left px-3 py-2 font-semibold">
                    {zh ? '答题进度' : 'Progress'}
                  </th>
                  <th scope="col" className="text-left px-3 py-2 font-semibold">
                    {zh ? '最近活动' : 'Last activity'}
                  </th>
                  <th scope="col" className="text-left px-3 py-2 font-semibold">
                    {zh ? '监考异常' : 'Violations'}
                  </th>
                  <th scope="col" className="text-left px-3 py-2 font-semibold">
                    {zh ? '得分' : 'Score'}
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((student) => {
                  const itemCount = Math.max(1, student.itemCount ?? snapshot?.itemCount ?? 1);
                  const answered = student.answeredCount ?? 0;
                  const violationTotal = student.proctorCounts?.total ?? 0;
                  return (
                    <tr key={student.studentId} className="border-t border-theme">
                      <td className="px-3 py-2">
                        <p className="font-semibold text-main">{student.name}</p>
                        <p className="text-2xs text-muted">{student.studentNumber}</p>
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-2xs font-semibold border ${
                            STATUS_STYLE[student.status] ?? STATUS_STYLE.not_started
                          }`}
                        >
                          {statusLabel(student.status, zh)}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <progress
                            className="ol-progress w-20 h-1.5 accent-indigo-600"
                            max={itemCount}
                            value={Math.min(answered, itemCount)}
                            aria-label={
                              zh
                                ? `${student.name} 已答 ${answered} / ${itemCount} 题`
                                : `${student.name}: ${answered} of ${itemCount} answered`
                            }
                          />
                          <span className="text-2xs text-muted tabular-nums">
                            {answered}/{student.itemCount ?? snapshot?.itemCount ?? 0}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-2xs text-muted">{formatAgo(student.lastActivityAt, now, zh)}</td>
                      <td className="px-3 py-2">
                        {violationTotal > 0 ? (
                          <span
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-2xs font-semibold border border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300"
                            title={
                              zh
                                ? `切屏 ${student.proctorCounts?.switchTab ?? 0} · 失焦 ${student.proctorCounts?.blur ?? 0} · 退出全屏 ${student.proctorCounts?.fullscreenExit ?? 0}`
                                : `Tab switch ${student.proctorCounts?.switchTab ?? 0} · blur ${student.proctorCounts?.blur ?? 0} · fullscreen exit ${student.proctorCounts?.fullscreenExit ?? 0}`
                            }
                          >
                            <AlertTriangle size={11} aria-hidden="true" /> {violationTotal}
                          </span>
                        ) : (
                          <span className="text-2xs text-muted">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 font-semibold text-main tabular-nums">
                        {student.score === null || student.score === undefined ? '—' : student.score}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </AccessibleTableRegion>
        )}
      </div>
    </div>
  );
}

function matchesFilter(student: AssessmentProgressStudent, filter: StatusFilter): boolean {
  if (filter === 'submitted') return student.status === 'submitted' || student.status === 'graded';
  return student.status === filter;
}
