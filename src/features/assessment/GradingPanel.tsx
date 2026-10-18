/**
 * 人工批改面板（Issue #100 / #121）。
 *
 * 面向「交卷后仍需人工给分」的题（简答/论述，或 grader 返回 null 的题）。
 * 批改写入 `manual_override = 1`，之后 `regrade` 不会覆盖（后端保证，有单测）。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, Loader2, RefreshCw } from 'lucide-react';
import { assessmentApi, ApiError, type AssessmentAssignment, type TeacherAttempt } from './api';

interface TeacherItemView {
  itemId: string;
  type: string;
  stem: string;
  maxScore: number;
  answer: unknown;
  answerKey: unknown;
  score: number | null;
  isCorrect: boolean | null;
  needsManualReview: boolean;
  feedback: string | null;
  grader: string | null;
  manualOverride: boolean;
  config: Record<string, unknown>;
}

const INPUT =
  'w-full px-2.5 py-1.5 border border-theme rounded-lg text-xs bg-surface text-main focus:outline-none focus:ring-1 focus:ring-indigo-500';

function answerText(answer: unknown): string {
  if (answer === null || answer === undefined) return '（未作答）';
  if (Array.isArray(answer)) return answer.map((a) => String(a)).join(' | ');
  if (typeof answer === 'object') return JSON.stringify(answer);
  return String(answer);
}

export function GradingPanel({
  assignment,
  lang,
  onBack,
}: {
  assignment: AssessmentAssignment & { className?: string | null };
  lang: 'zh' | 'en';
  onBack: () => void;
}) {
  const zh = lang === 'zh';
  const [attempts, setAttempts] = useState<TeacherAttempt[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ attempt: TeacherAttempt; items: TeacherItemView[] } | null>(null);
  const [scores, setScores] = useState<Record<string, string>>({});
  const [feedbacks, setFeedbacks] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadAttempts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await assessmentApi.listAttempts(assignment.id);
      setAttempts(res.items);
    } catch (e: any) {
      setError(e instanceof ApiError ? e.message : String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, [assignment.id]);

  useEffect(() => {
    void loadAttempts();
  }, [loadAttempts]);

  const openAttempt = async (attemptId: string) => {
    setSelected(attemptId);
    setDetail(null);
    setError(null);
    try {
      const res = await assessmentApi.getTeacherView(attemptId);
      setDetail(res);
      setScores(
        Object.fromEntries(res.items.map((item) => [item.itemId, item.score === null ? '' : String(item.score)])),
      );
      setFeedbacks(Object.fromEntries(res.items.map((item) => [item.itemId, item.feedback ?? ''])));
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  };

  const grade = async (item: TeacherItemView) => {
    if (!detail) return;
    const raw = scores[item.itemId];
    if (raw === '' || raw === undefined) {
      setError(zh ? '请填写分数' : 'Score is required');
      return;
    }
    setBusy(item.itemId);
    setError(null);
    try {
      await assessmentApi.gradeAnswer(detail.attempt.id, item.itemId, {
        score: Number(raw),
        feedback: feedbacks[item.itemId] || null,
      });
      const refreshed = await assessmentApi.getTeacherView(detail.attempt.id);
      setDetail(refreshed);
      setNotice(zh ? '已保存该题评分（自动判分不再覆盖）' : 'Score saved — auto-grading will not override it.');
      await loadAttempts();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(null);
    }
  };

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
            {zh ? '人工批改' : 'Manual grading'} · {assignment.className ?? assignment.classId}
          </h1>
          <p className="text-2xs text-muted">
            {zh
              ? '简答题与「无法自动判分」的题在这里给分；保存后该题不再被自动判分覆盖。'
              : 'Grade short answers and any item the grader could not score. Saved scores are never auto-overwritten.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadAttempts()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-theme bg-surface text-xs font-semibold text-main disabled:opacity-50 cursor-pointer"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          {zh ? '刷新' : 'Refresh'}
        </button>
      </div>

      {(error || notice) && (
        <div
          role={error ? 'alert' : 'status'}
          className={`mx-5 mt-3 px-3 py-2 rounded-xl border text-xs ${
            error ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'
          }`}
        >
          {error ?? notice}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-5 grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
        <section aria-labelledby="attempts-heading">
          <h2 id="attempts-heading" className="text-xs font-bold text-main mb-2">
            {zh ? '作答列表' : 'Attempts'}（{attempts?.length ?? 0}）
          </h2>
          {attempts === null && loading ? (
            <p className="text-xs text-muted flex items-center gap-2">
              <Loader2 size={13} className="animate-spin" />
              {zh ? '加载中…' : 'Loading…'}
            </p>
          ) : (attempts?.length ?? 0) === 0 ? (
            <p className="text-xs text-muted">{zh ? '还没有人交卷。' : 'No submissions yet.'}</p>
          ) : (
            <ul data-testid="grading-attempt-list" className="space-y-1.5">
              {attempts!.map((attempt) => {
                const active = selected === attempt.id;
                const proctorTotal = Number((attempt.proctor as any)?.summary?.total ?? 0);
                return (
                  <li key={attempt.id}>
                    <button
                      type="button"
                      onClick={() => void openAttempt(attempt.id)}
                      aria-pressed={active}
                      className={`w-full text-left px-3 py-2 rounded-xl border text-xs cursor-pointer ${
                        active
                          ? 'border-indigo-400 bg-indigo-50 dark:bg-indigo-950/40'
                          : 'border-theme hover:bg-surface-secondary'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-semibold text-main block truncate">
                          {attempt.anonymousLabel ?? attempt.studentId ?? attempt.id}
                        </span>
                        {proctorTotal > 0 && (
                          <span
                            className="px-1.5 py-0.2 rounded text-3xs font-bold bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300 shrink-0"
                            title={zh ? `监考异常事件 ${proctorTotal} 次` : `${proctorTotal} proctor violations`}
                          >
                            ⚠️ {proctorTotal}
                          </span>
                        )}
                      </div>
                      <span className="text-2xs text-muted">
                        {attempt.status} · {attempt.score ?? '—'}/{attempt.maxScore ?? '—'}
                        {attempt.needsManualReview && (
                          <span className="ml-1 text-amber-700 dark:text-amber-300">{zh ? '待批改' : 'pending'}</span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section aria-labelledby="grade-heading">
          <div className="flex items-center justify-between mb-2">
            <h2 id="grade-heading" className="text-xs font-bold text-main">
              {zh ? '逐题批改' : 'Grade items'}
            </h2>
            {detail && Number((detail.attempt.proctor as any)?.summary?.total ?? 0) > 0 && (
              <div className="px-2 py-0.5 rounded-lg border border-rose-200 bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800 text-2xs font-semibold">
                ⚠️ {zh ? '监考异常' : 'Proctor alert'}：
                {zh ? '切屏' : 'tab switch'} {(detail.attempt.proctor as any)?.summary?.visibility_hidden ?? 0} ·{' '}
                {zh ? '失焦' : 'blur'} {(detail.attempt.proctor as any)?.summary?.blur ?? 0} ·{' '}
                {zh ? '退出全屏' : 'exit fullscreen'} {(detail.attempt.proctor as any)?.summary?.fullscreen_exit ?? 0}
              </div>
            )}
          </div>
          {!detail ? (
            <p className="text-xs text-muted">{zh ? '从左侧选择一份作答。' : 'Pick an attempt on the left.'}</p>
          ) : (
            <ul className="space-y-3">
              {detail.items.map((item, index) => (
                <li
                  key={item.itemId}
                  data-testid={`grading-item-${item.itemId}`}
                  className="border border-theme rounded-xl p-3 space-y-2"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-2xs font-bold text-muted">#{index + 1}</span>
                    <span className="text-xs font-semibold text-main flex-1 min-w-0 line-clamp-2">{item.stem}</span>
                    <span className="text-2xs text-muted">
                      {item.score ?? '—'}/{item.maxScore}
                    </span>
                    {item.manualOverride && (
                      <span className="text-2xs text-indigo-600 inline-flex items-center gap-0.5">
                        <CheckCircle2 size={11} />
                        {zh ? '已人工批改' : 'manual'}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-main bg-surface-secondary rounded-lg px-2 py-1.5 whitespace-pre-wrap break-words">
                    {answerText(item.answer)}
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-[100px_1fr_auto] gap-2 items-end">
                    <div>
                      <label htmlFor={`score-${item.itemId}`} className="block text-2xs font-semibold text-muted mb-1">
                        {zh ? '得分' : 'Score'}
                      </label>
                      <input
                        id={`score-${item.itemId}`}
                        type="number"
                        min={0}
                        max={item.maxScore}
                        step={0.5}
                        value={scores[item.itemId] ?? ''}
                        onChange={(e) => setScores((prev) => ({ ...prev, [item.itemId]: e.target.value }))}
                        className={INPUT}
                      />
                    </div>
                    <div>
                      <label
                        htmlFor={`feedback-${item.itemId}`}
                        className="block text-2xs font-semibold text-muted mb-1"
                      >
                        {zh ? '评语（可选）' : 'Feedback (optional)'}
                      </label>
                      <input
                        id={`feedback-${item.itemId}`}
                        type="text"
                        value={feedbacks[item.itemId] ?? ''}
                        onChange={(e) => setFeedbacks((prev) => ({ ...prev, [item.itemId]: e.target.value }))}
                        className={INPUT}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => void grade(item)}
                      disabled={busy === item.itemId}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 disabled:opacity-50 cursor-pointer"
                    >
                      {busy === item.itemId && <Loader2 size={13} className="animate-spin" />}
                      {zh ? '保存评分' : 'Save'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
