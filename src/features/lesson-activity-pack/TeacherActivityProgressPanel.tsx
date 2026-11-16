import { useEffect, useState } from 'react';
import {
  fetchProgressReport,
  fetchTeacherPeerAssignments,
  moderatePeerReview,
  nudgeIncomplete,
  startPeerReviewCycle,
  type ActivityProgressReport,
  type PeerReviewAssignment,
} from './p1-api';

export function TeacherActivityProgressPanel({ lessonId, lang }: { lessonId: string; lang: 'zh' | 'en' }) {
  const [report, setReport] = useState<ActivityProgressReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [cycleId, setCycleId] = useState<string | null>(null);
  const [reviews, setReviews] = useState<PeerReviewAssignment[]>([]);

  const load = async () => {
    const result = await fetchProgressReport(lessonId);
    setReport(result.report);
  };

  useEffect(() => {
    void load().catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [lessonId]);

  return (
    <section
      className="mt-6 border-t border-theme pt-4 flex flex-col gap-3"
      data-testid="teacher-activity-progress-panel"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">{lang === 'zh' ? '进度与催办' : 'Progress and reminders'}</h3>
        <div className="flex gap-2">
          <button
            type="button"
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-100 text-amber-900 border border-amber-200"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void nudgeIncomplete(lessonId, { message: message || undefined })
                .then((result) => {
                  setError(null);
                  window.alert(
                    lang === 'zh'
                      ? `已催办 ${result.sent.length} 人，跳过 ${result.skipped.length} 人`
                      : `Nudged ${result.sent.length}, skipped ${result.skipped.length}`,
                  );
                })
                .catch((err) => setError(err instanceof Error ? err.message : String(err)))
                .finally(() => setBusy(false));
            }}
          >
            {lang === 'zh' ? '一键催办未完成学生' : 'Nudge incomplete students'}
          </button>
          <button
            type="button"
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-50 text-indigo-800 border border-indigo-200"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void startPeerReviewCycle(lessonId, {
                anonymous: true,
                reviewsPerStudent: 1,
                title: lang === 'zh' ? '学案互评' : 'Peer review',
              })
                .then((result) => {
                  setCycleId(result.cycle.id);
                  return fetchTeacherPeerAssignments(lessonId, result.cycle.id);
                })
                .then((result) => setReviews(result.assignments))
                .catch((err) => setError(err instanceof Error ? err.message : String(err)))
                .finally(() => setBusy(false));
            }}
          >
            {lang === 'zh' ? '开始互评' : 'Start peer review'}
          </button>
        </div>
      </div>
      <input
        className="border border-theme rounded-lg px-3 py-1.5 text-sm"
        placeholder={lang === 'zh' ? '催办留言（可选，外链会被隐藏）' : 'Optional reminder message'}
        value={message}
        onChange={(event) => setMessage(event.target.value)}
      />
      {error && <p className="text-sm text-rose-700">{error}</p>}
      {report?.activities.map((row) => (
        <div key={row.activity.id} className="border border-theme rounded-lg p-3 text-sm">
          <div className="font-medium flex justify-between">
            <span>{row.activity.title}</span>
            <span>
              {lang === 'zh' ? '完成率' : 'Completion'} {row.completionRate}% · {lang === 'zh' ? '已验证' : 'Verified'}{' '}
              {row.verifiedRate}%
            </span>
          </div>
          {row.incomplete.length > 0 && (
            <p className="text-xs text-muted mt-1">
              {lang === 'zh' ? '未完成：' : 'Incomplete: '}
              {row.incomplete.map((item) => item.name).join('、')}
            </p>
          )}
        </div>
      ))}
      {cycleId && reviews.length > 0 && (
        <div className="border border-theme rounded-lg p-3">
          <h4 className="text-sm font-semibold mb-2">{lang === 'zh' ? '互评复核' : 'Review moderation'}</h4>
          {reviews
            .filter((item) => item.review)
            .map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-2 text-xs py-1">
                <span>
                  {item.reviewerName || (lang === 'zh' ? '评审人' : 'Reviewer')} →{' '}
                  {item.revieweeName || (lang === 'zh' ? '作品' : 'Work')} · {item.review?.status}
                </span>
                <button
                  type="button"
                  className="text-emerald-700 underline"
                  onClick={() =>
                    void moderatePeerReview(lessonId, item.review!.id, { action: 'confirm' }).then(() =>
                      fetchTeacherPeerAssignments(lessonId, cycleId).then((result) => setReviews(result.assignments)),
                    )
                  }
                >
                  {lang === 'zh' ? '确认' : 'Confirm'}
                </button>
              </div>
            ))}
        </div>
      )}
    </section>
  );
}
