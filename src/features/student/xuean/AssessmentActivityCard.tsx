/**
 * 学案「试题」活动卡片：引用现有试卷，使用 AssessmentRunner 内嵌作答。
 *
 * config_json: { assessmentId, classId, assignmentId, title? }
 */
import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { assessmentApi, ApiError, type StudentAttemptPayload, type StudentResultPayload } from '../../assessment/api';
import { AssessmentRunner } from '../../assessment/student/StudentAssessmentsView';
import { postActivityProgress } from '../../../services/lessonActivitiesService.js';

interface AssessmentActivityCardProps {
  activity: { id: string; title: string; config_json?: string | null };
  lang?: 'zh' | 'en';
  onProgressUpdated?: () => void;
  /** Mode Pack 工作区可选：交卷并回写活动进度后通知（如 ClassroomMessage xuean:task）。 */
  onActivityProgressReported?: (info: { activityId: string; status: string }) => void;
}

export function AssessmentActivityCard({
  activity,
  lang = 'zh',
  onProgressUpdated,
  onActivityProgressReported,
}: AssessmentActivityCardProps) {
  const zh = lang === 'zh';
  const config = (() => {
    try {
      const parsed = JSON.parse(activity.config_json ?? '{}') as Record<string, unknown>;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {} as Record<string, unknown>;
    }
  })();
  const assignmentId = typeof config.assignmentId === 'string' ? config.assignmentId : '';

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<StudentAttemptPayload | null>(null);
  const [result, setResult] = useState<StudentResultPayload | null>(null);

  const start = async () => {
    if (!assignmentId) {
      setError(zh ? '该试题尚未绑定试卷' : 'This quiz is not bound to an assessment');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next = await assessmentApi.startAttempt(assignmentId);
      const attempt = next.attempt;
      if (attempt && (attempt.submittedAt || attempt.status !== 'in_progress')) {
        setResult(await assessmentApi.attemptResult(attempt.id));
        return;
      }
      setPayload(next);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String((e as { message?: string })?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const handleSubmitted = async (submitted: StudentResultPayload) => {
    setResult(submitted);
    setPayload(null);
    try {
      await postActivityProgress(activity.id, { status: 'submitted', progressPercent: 100 });
      onProgressUpdated?.();
      onActivityProgressReported?.({ activityId: activity.id, status: 'submitted' });
    } catch {
      // 进度回写失败不影响学生看到成绩
    }
  };

  if (payload) {
    return (
      <div className="rounded-xl border border-theme bg-surface overflow-hidden">
        <AssessmentRunner
          lang={lang}
          payload={payload}
          initialAnswers={payload.answers ?? {}}
          onSubmitted={handleSubmitted}
          onExit={() => setPayload(null)}
        />
      </div>
    );
  }

  const scoreText =
    result?.attempt?.score != null
      ? `${zh ? '得分' : 'Score'} ${result.attempt.score}/${result.attempt.maxScore ?? '—'}`
      : null;

  return (
    <div className="rounded-xl border border-theme bg-surface p-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wider text-primary-theme">
            {zh ? '试题 · 引用试卷' : 'Quiz · Assessment'}
          </p>
          <p className="mt-1 text-sm font-semibold text-main truncate">{activity.title}</p>
          {scoreText && <p className="mt-1 text-xs text-emerald-600 font-bold">{scoreText}</p>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {result ? (
            <button
              type="button"
              onClick={() => void start()}
              disabled={busy}
              className="px-3 py-1.5 text-xs rounded-lg border border-theme hover:bg-surface-secondary text-main disabled:opacity-50"
            >
              {zh ? '查看结果' : 'View result'}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void start()}
              disabled={busy || !assignmentId}
              className="px-3 py-1.5 text-xs rounded-lg bg-primary-theme text-white hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5"
            >
              {busy && <Loader2 size={12} className="animate-spin" />}
              {zh ? '开始作答' : 'Start'}
            </button>
          )}
        </div>
      </div>
      {error && <p className="mt-2 text-xs text-rose-600">{error}</p>}
    </div>
  );
}
