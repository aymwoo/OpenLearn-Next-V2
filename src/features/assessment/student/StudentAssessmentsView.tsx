/**
 * 学生端「我的测评」+ 作答 + 结果（Issue #100 / 子 issue #122）。
 *
 * 设计要点：
 * - **服务端计时为准**：倒计时初始值取 `attempt.remainingSeconds`，客户端每秒递减只用于展示；
 *   归零时主动交卷，而服务端在任何读取时也会惰性结算（双保险）。
 * - **自动保存**：作答变化 1.5s 防抖后 PUT 单题；交卷前再 flush 一次，避免最后 1 秒的作答丢失。
 * - **断线续答**：进入时若已有 `in_progress` 尝试，服务端直接返回该尝试与已保存的作答。
 * - **结果按可见性分级**：分数/解析是否展示完全由服务端 `showScore` / `showAnalysis` 决定，
 *   前端不自己判断（P0a 的白名单序列化保证答案不会提前下发）。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ClipboardList,
  Clock,
  Loader2,
  Play,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import {
  assessmentApi,
  ApiError,
  type StudentAssignmentEntry,
  type StudentAttemptPayload,
  type StudentResultPayload,
} from '../api';
import { assessmentQuestionTypeUiRegistry } from '../question-type-ui-registry';
import '../register-builtin-question-uis';
import { FallbackAnswer } from './answer-uis';

type View =
  | { mode: 'list' }
  | { mode: 'answering'; payload: StudentAttemptPayload; answers: Record<string, unknown> }
  | { mode: 'result'; result: StudentResultPayload };

const AUTOSAVE_DEBOUNCE_MS = 1500;

function formatClock(seconds: number | null): string {
  if (seconds === null) return '—';
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}:${String(m % 60).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

function answerToText(answer: unknown): string {
  if (answer === null || answer === undefined || answer === '') return '（未作答）';
  if (Array.isArray(answer)) return answer.length === 0 ? '（未作答）' : answer.map((a) => String(a)).join(' | ');
  if (typeof answer === 'object') return JSON.stringify(answer);
  return String(answer);
}

export function StudentAssessmentsView({ lang, onExit }: { lang: 'zh' | 'en'; onExit?: () => void }) {
  const zh = lang === 'zh';
  const [view, setView] = useState<View>({ mode: 'list' });
  const [entries, setEntries] = useState<StudentAssignmentEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await assessmentApi.myAssessments();
      setEntries(res.items);
    } catch (e: any) {
      setError(e instanceof ApiError ? e.message : String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (view.mode === 'list') void load();
  }, [view.mode, load]);

  const openEntry = async (entry: StudentAssignmentEntry) => {
    setError(null);
    setLoading(true);
    try {
      if (entry.completed && entry.attempt) {
        const result = await assessmentApi.attemptResult(entry.attempt.id);
        setView({ mode: 'result', result });
      } else {
        const payload = await assessmentApi.startAttempt(entry.assignmentId);
        setView({ mode: 'answering', payload, answers: { ...payload.answers } });
      }
    } catch (e: any) {
      setError(e instanceof ApiError ? e.message : String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  };

  if (view.mode === 'answering') {
    return (
      <AssessmentRunner
        lang={lang}
        payload={view.payload}
        initialAnswers={view.answers}
        onSubmitted={(result) => setView({ mode: 'result', result })}
        onExit={() => setView({ mode: 'list' })}
      />
    );
  }

  if (view.mode === 'result') {
    return (
      <ResultView
        lang={lang}
        result={view.result}
        onBack={() => {
          setView({ mode: 'list' });
          void load();
        }}
      />
    );
  }

  const pending = (entries ?? []).filter((e) => !e.completed);
  const done = (entries ?? []).filter((e) => e.completed);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-surface border border-theme rounded-2xl shadow-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-theme bg-surface-secondary/70 flex flex-wrap items-center gap-3 shrink-0">
        {onExit && (
          <button
            type="button"
            onClick={onExit}
            className="p-1.5 rounded-lg border border-theme bg-surface text-muted hover:text-main cursor-pointer"
            aria-label={zh ? '返回学习看板' : 'Back to dashboard'}
          >
            <ArrowLeft size={15} />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="text-base font-bold text-main flex items-center gap-2">
            <ClipboardList size={17} className="text-indigo-500" />
            {zh ? '我的测评' : 'My assessments'}
          </h1>
          <p className="text-xs text-muted">
            {zh
              ? '按截止时间排序。作答过程自动保存，断线后可续答；超时以服务端时间为准。'
              : 'Sorted by deadline. Answers autosave and resume after reconnecting; timing is server-authoritative.'}
          </p>
        </div>
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

      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        {entries === null && loading ? (
          <p className="text-xs text-muted flex items-center gap-2">
            <Loader2 size={13} className="animate-spin" />
            {zh ? '加载中…' : 'Loading…'}
          </p>
        ) : (entries?.length ?? 0) === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <ClipboardList size={36} className="text-muted opacity-40" />
            <p className="text-sm font-semibold text-main">{zh ? '暂无待完成测评' : 'No assessments yet'}</p>
            <p className="text-xs text-muted">
              {zh ? '老师发布测评后会出现在这里。' : 'Published assessments will show up here.'}
            </p>
          </div>
        ) : (
          <>
            <section aria-labelledby="pending-heading">
              <h2 id="pending-heading" className="text-xs font-bold text-main mb-2">
                {zh ? '待完成' : 'To do'}（{pending.length}）
              </h2>
              {pending.length === 0 ? (
                <p className="text-xs text-muted">{zh ? '没有待完成的测评。' : 'Nothing pending.'}</p>
              ) : (
                <ul data-testid="student-pending-list" className="space-y-2">
                  {pending.map((entry) => (
                    <li key={entry.assignmentId}>
                      <EntryCard entry={entry} lang={lang} disabled={loading} onOpen={() => void openEntry(entry)} />
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {done.length > 0 && (
              <section aria-labelledby="done-heading">
                <h2 id="done-heading" className="text-xs font-bold text-main mb-2">
                  {zh ? '已完成' : 'Completed'}（{done.length}）
                </h2>
                <ul data-testid="student-completed-list" className="space-y-2">
                  {done.map((entry) => (
                    <li key={entry.assignmentId}>
                      <EntryCard entry={entry} lang={lang} disabled={loading} onOpen={() => void openEntry(entry)} />
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────── 列表项 ─────────────────────────── */

function EntryCard({
  entry,
  lang,
  disabled,
  onOpen,
}: {
  entry: StudentAssignmentEntry;
  lang: 'zh' | 'en';
  disabled: boolean;
  onOpen: () => void;
}) {
  const zh = lang === 'zh';
  const closed = entry.windowState === 'after_close';
  const notOpen = entry.windowState === 'before_open';
  const blocked = !entry.completed && (closed || notOpen);
  const kindLabel =
    entry.kind === 'quiz'
      ? zh
        ? '测试'
        : 'Quiz'
      : entry.kind === 'exam'
        ? zh
          ? '考试'
          : 'Exam'
        : zh
          ? '问卷'
          : 'Survey';

  return (
    <div
      data-testid={`student-assessment-${entry.assignmentId}`}
      className="bg-surface border border-theme rounded-xl px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3"
    >
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-bold text-sm text-main truncate">{entry.title}</span>
          <span className="px-2 py-0.5 rounded-full bg-surface-secondary border border-theme text-2xs font-semibold text-main">
            {kindLabel}
          </span>
          {entry.completed && entry.attempt?.needsManualReview && (
            <span className="px-2 py-0.5 rounded-full text-2xs font-semibold bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800">
              {zh ? '待批改' : 'Pending review'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-2xs text-muted flex-wrap">
          <span className="inline-flex items-center gap-1">
            <Clock size={11} />
            {closed
              ? zh
                ? '已截止'
                : 'Closed'
              : notOpen
                ? zh
                  ? '未开始'
                  : 'Not open yet'
                : entry.closesAt
                  ? `${zh ? '截止' : 'Due'} ${new Date(entry.closesAt).toLocaleString()}`
                  : zh
                    ? '不限时'
                    : 'No deadline'}
          </span>
          {entry.durationSec && (
            <span>
              {zh ? `限时 ${Math.round(entry.durationSec / 60)} 分钟` : `${Math.round(entry.durationSec / 60)} min`}
            </span>
          )}
          {entry.completed && entry.attempt && (
            <span>
              {entry.attempt.score === null
                ? zh
                  ? '成绩待发布'
                  : 'Score pending'
                : `${zh ? '得分' : 'Score'} ${entry.attempt.score}/${entry.attempt.maxScore ?? '—'}`}
            </span>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={onOpen}
        disabled={disabled || blocked}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold shrink-0 ${
          blocked
            ? 'bg-surface-secondary text-muted border border-theme cursor-not-allowed'
            : entry.completed
              ? 'border border-theme text-main hover:bg-surface-secondary cursor-pointer'
              : 'bg-indigo-600 text-white hover:bg-indigo-700 cursor-pointer'
        }`}
      >
        {!blocked && !entry.completed && <Play size={12} />}
        {blocked
          ? closed
            ? zh
              ? '已截止'
              : 'Closed'
            : zh
              ? '未开始'
              : 'Not open'
          : entry.completed
            ? zh
              ? '查看结果'
              : 'View result'
            : zh
              ? '开始作答'
              : 'Start'}
      </button>
    </div>
  );
}

/* ─────────────────────────── 作答 ─────────────────────────── */

function AssessmentRunner({
  lang,
  payload,
  initialAnswers,
  onSubmitted,
  onExit,
}: {
  lang: 'zh' | 'en';
  payload: StudentAttemptPayload;
  initialAnswers: Record<string, unknown>;
  onSubmitted: (result: StudentResultPayload) => void;
  onExit: () => void;
}) {
  const zh = lang === 'zh';
  const attemptId = payload.attempt!.id;
  const [answers, setAnswers] = useState<Record<string, unknown>>(initialAnswers);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [remaining, setRemaining] = useState<number | null>(payload.attempt!.remainingSeconds ?? null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const answersRef = useRef(answers);
  const submittedRef = useRef(false);

  answersRef.current = answers;

  const flush = useCallback(
    async (itemId: string) => {
      try {
        await assessmentApi.saveAnswer(attemptId, itemId, answersRef.current[itemId] ?? null);
        setSavedAt(Date.now());
        setDirty((prev) => {
          const next = new Set(prev);
          next.delete(itemId);
          return next;
        });
      } catch (e: any) {
        setError(e?.message ?? String(e));
      }
    },
    [attemptId],
  );

  const changeAnswer = (itemId: string, value: unknown) => {
    setAnswers((prev) => ({ ...prev, [itemId]: value }));
    setDirty((prev) => new Set(prev).add(itemId));
    if (timers.current[itemId]) clearTimeout(timers.current[itemId]);
    timers.current[itemId] = setTimeout(() => void flush(itemId), AUTOSAVE_DEBOUNCE_MS);
  };

  const submit = useCallback(async () => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      // 先 flush 所有未落盘的作答，再交卷（否则最后 1.5s 的改动会丢）
      for (const itemId of Object.keys(timers.current)) {
        if (timers.current[itemId]) clearTimeout(timers.current[itemId]);
      }
      const pendingIds = [...dirty];
      await Promise.all(
        pendingIds.map((itemId) => assessmentApi.saveAnswer(attemptId, itemId, answersRef.current[itemId] ?? null)),
      );
      const result = await assessmentApi.submitAttempt(attemptId);
      onSubmitted(result);
    } catch (e: any) {
      submittedRef.current = false;
      setError(e?.message ?? String(e));
    } finally {
      setSubmitting(false);
    }
  }, [attemptId, dirty, onSubmitted]);

  // 倒计时：本地每秒递减，归零自动交卷（服务端仍会惰性结算，双保险）
  useEffect(() => {
    if (remaining === null) return;
    if (remaining <= 0) {
      void submit();
      return;
    }
    const timer = setTimeout(() => setRemaining((prev) => (prev === null ? null : prev - 1)), 1000);
    return () => clearTimeout(timer);
  }, [remaining, submit]);

  useEffect(
    () => () => {
      Object.values(timers.current).forEach((t) => clearTimeout(t));
    },
    [],
  );

  const items = useMemo(() => [...payload.items].sort((a, b) => a.sortOrder - b.sortOrder), [payload.items]);
  const answeredCount = items.filter((item) => {
    const v = answers[item.id];
    if (v === undefined || v === null || v === '') return false;
    if (Array.isArray(v)) return v.length > 0;
    return true;
  }).length;

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-surface border border-theme rounded-2xl shadow-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-theme bg-surface-secondary/70 flex flex-wrap items-center gap-3 shrink-0">
        <button
          type="button"
          onClick={onExit}
          className="p-1.5 rounded-lg border border-theme bg-surface text-muted hover:text-main cursor-pointer"
          aria-label={zh ? '返回测评列表（作答已自动保存）' : 'Back to list (answers are saved)'}
        >
          <ArrowLeft size={15} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-sm font-bold text-main truncate">{payload.assignment.title}</h1>
          <p className="text-2xs text-muted">
            {zh ? '已作答' : 'Answered'} {answeredCount}/{items.length}
            {savedAt && ` · ${zh ? '已自动保存' : 'autosaved'}`}
            {dirty.size > 0 && ` · ${zh ? '保存中…' : 'saving…'}`}
          </p>
        </div>
        {remaining !== null && (
          <span
            data-testid="assessment-countdown"
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-xl border text-xs font-bold ${
              remaining <= 60
                ? 'border-rose-300 bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300'
                : 'border-theme bg-surface text-main'
            }`}
            role="timer"
            aria-live="off"
          >
            <Clock size={12} />
            {formatClock(remaining)}
          </span>
        )}
        <button
          type="button"
          onClick={() => void submit()}
          disabled={submitting}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 disabled:opacity-50 cursor-pointer"
        >
          {submitting ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
          {zh ? '提交交卷' : 'Submit'}
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

      <div className="flex-1 overflow-y-auto p-5">
        <ol className="space-y-4 max-w-3xl mx-auto">
          {items.map((item, index) => {
            const ui = assessmentQuestionTypeUiRegistry.get(item.type);
            const Answer = ui?.Answer ?? FallbackAnswer;
            return (
              <li
                key={item.id}
                data-testid={`answer-item-${item.id}`}
                className="border border-theme rounded-xl p-4 space-y-3"
              >
                <div className="flex items-start gap-2">
                  <span className="text-2xs font-bold text-muted mt-0.5">#{index + 1}</span>
                  <p className="text-sm font-semibold text-main whitespace-pre-wrap break-words flex-1">{item.stem}</p>
                  <span className="text-2xs text-muted shrink-0">{item.maxScore} 分</span>
                </div>
                <Answer
                  config={item.config}
                  value={answers[item.id]}
                  onChange={(next) => changeAnswer(item.id, next)}
                  lang={lang}
                />
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

/* ─────────────────────────── 结果 ─────────────────────────── */

function ResultView({ lang, result, onBack }: { lang: 'zh' | 'en'; result: StudentResultPayload; onBack: () => void }) {
  const zh = lang === 'zh';
  const { attempt, assignment } = result;
  return (
    <div className="flex-1 flex flex-col min-h-0 bg-surface border border-theme rounded-2xl shadow-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-theme bg-surface-secondary/70 flex flex-wrap items-center gap-3 shrink-0">
        <button
          type="button"
          onClick={onBack}
          className="p-1.5 rounded-lg border border-theme bg-surface text-muted hover:text-main cursor-pointer"
          aria-label={zh ? '返回测评列表' : 'Back to assessments'}
        >
          <ArrowLeft size={15} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-sm font-bold text-main truncate">{assignment.title}</h1>
          <p className="text-2xs text-muted">
            {attempt?.submittedAt
              ? `${zh ? '交卷时间' : 'Submitted'} ${new Date(attempt.submittedAt).toLocaleString()}`
              : zh
                ? '已交卷'
                : 'Submitted'}
          </p>
        </div>
        {result.showScore && attempt && (
          <span data-testid="result-score" className="text-sm font-bold text-main">
            {attempt.score ?? '—'}/{attempt.maxScore ?? '—'}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-4 max-w-3xl mx-auto w-full">
        {!result.showScore && (
          <p className="text-xs text-muted border border-theme rounded-xl px-3 py-2 bg-surface-secondary/40">
            {zh
              ? '本次成绩待老师发布后可见。你的作答已保存，可以关闭页面。'
              : 'Your score will be visible after the teacher releases it. Your answers are saved.'}
          </p>
        )}
        {result.showScore && attempt?.needsManualReview && (
          <p className="text-xs border border-amber-200 bg-amber-50 text-amber-700 rounded-xl px-3 py-2 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800">
            {zh ? '主观题待人工批改，最终分数可能变化。' : 'Some items await manual grading; the score may change.'}
          </p>
        )}
        {result.aggregate.consideredAttempts > 1 && result.aggregate.score !== null && (
          <p className="text-xs text-muted">
            {zh
              ? `多次作答聚合（${result.aggregate.consideredAttempts} 次）`
              : `Aggregated over ${result.aggregate.consideredAttempts} attempts`}
            ：{result.aggregate.score}/{result.aggregate.maxScore ?? '—'}
            {result.aggregate.provisional && (zh ? '（含待批改）' : ' (provisional)')}
          </p>
        )}

        <ul className="space-y-3">
          {result.items.map((item, index) => (
            <li
              key={item.itemId}
              data-testid={`result-item-${item.itemId}`}
              className="border border-theme rounded-xl p-4 space-y-2"
            >
              <div className="flex items-start gap-2">
                <span className="text-2xs font-bold text-muted mt-0.5">#{index + 1}</span>
                <p className="text-sm font-semibold text-main whitespace-pre-wrap break-words flex-1">{item.stem}</p>
                {result.showAnalysis &&
                  (item.needsManualReview ? (
                    <span className="text-2xs text-amber-700 dark:text-amber-300 shrink-0">
                      {zh ? '待批改' : 'pending'}
                    </span>
                  ) : item.isCorrect ? (
                    <CheckCircle2
                      size={15}
                      className="text-emerald-600 shrink-0"
                      aria-label={zh ? '正确' : 'Correct'}
                    />
                  ) : (
                    <XCircle size={15} className="text-rose-600 shrink-0" aria-label={zh ? '错误' : 'Incorrect'} />
                  ))}
              </div>
              <p className="text-xs text-main bg-surface-secondary rounded-lg px-2 py-1.5 whitespace-pre-wrap break-words">
                <span className="text-muted mr-1">{zh ? '你的作答：' : 'Your answer:'}</span>
                {answerToText(item.answer)}
              </p>
              {result.showAnalysis && item.answerKey !== undefined && item.answerKey !== null && (
                <p className="text-2xs text-muted">
                  {zh ? '参考答案：' : 'Reference answer:'} {answerToText(item.answerKey)}
                </p>
              )}
              {result.showAnalysis && item.feedback && (
                <p className="text-2xs text-indigo-700 dark:text-indigo-300">
                  {zh ? '教师评语：' : 'Feedback:'} {item.feedback}
                </p>
              )}
              {result.showAnalysis && item.score !== null && (
                <p className="text-2xs text-muted">
                  {zh ? '本题得分' : 'Item score'}：{item.score}/{item.maxScore}
                </p>
              )}
            </li>
          ))}
        </ul>

        {!assignment.scoreReleased && result.showScore && (
          <p className="text-2xs text-muted flex items-center gap-1">
            <AlertTriangle size={11} />
            {zh ? '成绩尚未正式发布。' : 'Scores are not officially released yet.'}
          </p>
        )}
      </div>
    </div>
  );
}
