/**
 * 学生看板上的「我的测评」挂件（Issue #100 / #122）。
 *
 * 只做入口与摘要：真正的列表/作答/结果在 `StudentAssessmentsView` 里（全屏视图）。
 * 独立轮询一次 `/api/me/assessments`，失败时降级为一行提示，不影响看板其它挂件。
 */
import React, { useEffect, useState } from 'react';
import { ArrowRight, ClipboardList, Clock, Loader2 } from 'lucide-react';
import { assessmentApi, type StudentAssignmentEntry } from '../api';

export function StudentAssessmentsWidget({ lang, onOpen }: { lang: 'zh' | 'en'; onOpen?: () => void }) {
  const zh = lang === 'zh';
  const [entries, setEntries] = useState<StudentAssignmentEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    assessmentApi
      .myAssessments()
      .then((res) => {
        if (!cancelled) setEntries(res.items);
      })
      .catch((e: any) => {
        if (!cancelled) setError(e?.message ?? String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return <p className="text-xs text-muted">{zh ? '测评加载失败' : 'Failed to load assessments'}</p>;
  }
  if (entries === null) {
    return (
      <p className="text-xs text-muted flex items-center gap-2">
        <Loader2 size={13} className="animate-spin" />
        {zh ? '加载中…' : 'Loading…'}
      </p>
    );
  }

  const pending = entries.filter((e) => !e.completed);
  const next = pending[0];

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2 text-xs">
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-800 font-semibold">
          {zh ? `待完成 ${pending.length}` : `${pending.length} to do`}
        </span>
        <span className="text-muted">
          {zh ? `已完成 ${entries.length - pending.length}` : `${entries.length - pending.length} done`}
        </span>
      </div>

      {next ? (
        <div className="border border-theme rounded-xl px-3 py-2">
          <p className="text-xs font-semibold text-main truncate">{next.title}</p>
          <p className="text-2xs text-muted inline-flex items-center gap-1 mt-0.5">
            <Clock size={10} />
            {next.closesAt
              ? `${zh ? '截止' : 'Due'} ${new Date(next.closesAt).toLocaleString()}`
              : zh
                ? '不限时'
                : 'No deadline'}
          </p>
        </div>
      ) : (
        <p className="text-xs text-muted">{zh ? '暂无待完成测评' : 'Nothing pending'}</p>
      )}

      {onOpen && (
        <button
          type="button"
          onClick={onOpen}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-600 text-white text-2xs font-bold hover:bg-indigo-700 cursor-pointer"
        >
          <ClipboardList size={12} />
          {zh ? '打开我的测评' : 'Open my assessments'}
          <ArrowRight size={11} />
        </button>
      )}
    </div>
  );
}
