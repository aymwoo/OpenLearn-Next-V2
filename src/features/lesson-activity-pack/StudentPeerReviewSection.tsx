import { useEffect, useState } from 'react';
import {
  fetchMyPeerReviewAssignments,
  fetchPeerReviewCycles,
  reportPeerReview,
  submitPeerReview,
  type PeerReviewAssignment,
  type PeerReviewCycle,
} from './p1-api';

export function StudentPeerReviewSection({ lessonId, lang }: { lessonId: string; lang: 'zh' | 'en' }) {
  const [assignments, setAssignments] = useState<PeerReviewAssignment[]>([]);
  const [cycles, setCycles] = useState<PeerReviewCycle[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const [a, c] = await Promise.all([fetchMyPeerReviewAssignments(lessonId), fetchPeerReviewCycles(lessonId)]);
      setAssignments(a.assignments ?? []);
      setCycles(c.cycles ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    void load();
  }, [lessonId]);

  if (!assignments.length) return null;

  return (
    <section
      className="bg-surface border border-theme rounded-xl p-4 flex flex-col gap-3"
      data-testid="student-peer-review-section"
    >
      <h3 className="font-semibold">{lang === 'zh' ? '互评任务' : 'Peer reviews'}</h3>
      {error && <p className="text-sm text-rose-700">{error}</p>}
      {assignments.map((item) => {
        const cycle = cycles.find((entry) => entry.id === item.cycleId);
        return (
          <article key={item.id} className="border border-theme rounded-lg p-3 flex flex-col gap-2">
            <div className="text-sm font-medium">
              {item.activityTitle}
              {item.anonymous
                ? lang === 'zh'
                  ? '（匿名）'
                  : ' (anonymous)'
                : item.revieweeName
                  ? ` · ${item.revieweeName}`
                  : ''}
            </div>
            {item.review ? (
              <div className="text-xs text-muted">
                {lang === 'zh' ? '已提交' : 'Submitted'} · {item.review.status}
                {item.review.teacherFeedback ? ` · ${item.review.teacherFeedback}` : ''}
                {item.review.id && (
                  <button
                    type="button"
                    className="ml-2 text-rose-700 underline"
                    onClick={() => {
                      const reason = window.prompt(
                        lang === 'zh' ? '请填写举报原因' : 'Why are you reporting this review?',
                      );
                      if (reason)
                        void reportPeerReview(lessonId, item.review!.id, reason)
                          .then(load)
                          .catch((err) => setError(err.message));
                    }}
                  >
                    {lang === 'zh' ? '举报' : 'Report'}
                  </button>
                )}
              </div>
            ) : (
              <PeerReviewForm
                lessonId={lessonId}
                assignment={item}
                rubric={cycle?.rubric || []}
                lang={lang}
                onDone={load}
                onError={setError}
              />
            )}
          </article>
        );
      })}
    </section>
  );
}

function PeerReviewForm({
  lessonId,
  assignment,
  rubric,
  lang,
  onDone,
  onError,
}: {
  lessonId: string;
  assignment: PeerReviewAssignment;
  rubric: Array<{ id: string; label: string; maxScore: number }>;
  lang: 'zh' | 'en';
  onDone: () => void;
  onError: (message: string) => void;
}) {
  const [scores, setScores] = useState<Record<string, number>>({});
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        void submitPeerReview(lessonId, assignment.id, { scores, comment })
          .then(onDone)
          .catch((err) => onError(err instanceof Error ? err.message : String(err)))
          .finally(() => setBusy(false));
      }}
    >
      {rubric.map((dim) => (
        <label key={dim.id} className="text-xs flex items-center gap-2">
          <span className="w-28">{dim.label}</span>
          <input
            type="number"
            min={0}
            max={dim.maxScore}
            required
            className="w-20 border border-theme rounded px-2 py-1"
            onChange={(event) => setScores((current) => ({ ...current, [dim.id]: Number(event.target.value) }))}
          />
          <span className="text-muted">/ {dim.maxScore}</span>
        </label>
      ))}
      <textarea
        className="border border-theme rounded-lg px-2 py-1 text-sm"
        rows={3}
        placeholder={lang === 'zh' ? '评语（外链会被隐藏）' : 'Comment (external links will be hidden)'}
        value={comment}
        onChange={(event) => setComment(event.target.value)}
      />
      <button
        type="submit"
        disabled={busy}
        className="self-start px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-lg"
      >
        {lang === 'zh' ? '提交互评' : 'Submit review'}
      </button>
    </form>
  );
}
