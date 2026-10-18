/**
 * 统计面板（Issue #100 / #121）：均分/分布/每题正确率 + CSV 导出。
 *
 * 匿名问卷的导出由服务端保证不含身份信息（有单测），这里只放链接。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Download, Loader2, RefreshCw } from 'lucide-react';
import { assessmentApi, ApiError, type AssessmentAssignment, type AssessmentStats } from './api';

export function StatsPanel({
  assignment,
  lang,
  onBack,
}: {
  assignment: AssessmentAssignment & { className?: string | null };
  lang: 'zh' | 'en';
  onBack: () => void;
}) {
  const zh = lang === 'zh';
  const [stats, setStats] = useState<AssessmentStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStats(await assessmentApi.stats(assignment.id));
    } catch (e: any) {
      setError(e instanceof ApiError ? e.message : String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, [assignment.id]);

  useEffect(() => {
    void load();
  }, [load]);

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
            {zh ? '统计' : 'Statistics'} · {assignment.className ?? assignment.classId}
          </h1>
        </div>
        <a
          href={assessmentApi.exportCsvUrl(assignment.id)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-theme bg-surface text-xs font-semibold text-main hover:bg-surface-secondary"
        >
          <Download size={13} />
          {zh ? '导出 CSV' : 'Export CSV'}
        </a>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-theme bg-surface text-xs font-semibold text-main disabled:opacity-50 cursor-pointer"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
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
        {!stats ? (
          <p className="text-xs text-muted flex items-center gap-2">
            <Loader2 size={13} className="animate-spin" />
            {zh ? '正在统计…' : 'Computing…'}
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: zh ? '作答数' : 'Attempts', value: stats.attemptCount },
                { label: zh ? '已交卷' : 'Submitted', value: stats.submittedCount },
                { label: zh ? '待人工批改' : 'Pending review', value: stats.needsManualReviewCount },
                {
                  label: zh ? '平均分' : 'Average',
                  value:
                    stats.averageScore === null
                      ? '—'
                      : `${stats.averageScore}${stats.averagePercent !== null ? ` (${stats.averagePercent}%)` : ''}`,
                },
              ].map((card) => (
                <div key={card.label} className="border border-theme rounded-xl px-3 py-2 bg-surface-secondary/40">
                  <p className="text-2xs text-muted">{card.label}</p>
                  <p className="text-sm font-bold text-main">{card.value}</p>
                </div>
              ))}
            </div>

            <table data-testid="stats-table" className="w-full text-xs border border-theme rounded-xl overflow-hidden">
              <caption className="sr-only">{zh ? '逐题统计' : 'Per-item statistics'}</caption>
              <thead className="bg-surface-secondary text-muted">
                <tr>
                  <th scope="col" className="text-left px-3 py-2 font-semibold">
                    #
                  </th>
                  <th scope="col" className="text-left px-3 py-2 font-semibold">
                    {zh ? '题干' : 'Stem'}
                  </th>
                  <th scope="col" className="text-right px-3 py-2 font-semibold">
                    {zh ? '作答' : 'Answered'}
                  </th>
                  <th scope="col" className="text-right px-3 py-2 font-semibold">
                    {zh ? '正确率' : 'Correct rate'}
                  </th>
                  <th scope="col" className="text-right px-3 py-2 font-semibold">
                    {zh ? '均分' : 'Avg score'}
                  </th>
                </tr>
              </thead>
              <tbody>
                {stats.items.map((item, index) => (
                  <tr key={item.itemId} className="border-t border-theme">
                    <td className="px-3 py-2 text-muted">{index + 1}</td>
                    <td className="px-3 py-2 text-main max-w-[320px] truncate" title={item.stem}>
                      {item.stem}
                    </td>
                    <td className="px-3 py-2 text-right text-main">{item.answered}</td>
                    <td className="px-3 py-2 text-right text-main">
                      {item.correctRate === null ? '—' : `${item.correctRate}%`}
                    </td>
                    <td className="px-3 py-2 text-right text-main">
                      {item.avgScore === null ? '—' : `${item.avgScore}/${item.maxScore}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-2xs text-muted">
              {zh
                ? '待人工批改的题不计入正确率与均分；匿名问卷的导出不含身份信息。'
                : 'Items awaiting manual review are excluded from correct-rate and averages. Anonymous exports contain no identity.'}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
