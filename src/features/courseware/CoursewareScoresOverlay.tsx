import { useEffect, useState } from 'react';
import { listFromEnvelope } from '../../utils/listEnvelope.js';
import { useAppStore } from '../../store/appStore';
import { getSocketInstance } from '../../services/socket-service';

interface CoursewareAttempt {
  attemptId: string;
  studentId: string;
  studentName: string;
  score: number | null;
  completion: number | null;
  started_at: number;
  finished_at: number | null;
  status: string;
}

const PLACEHOLDER_STUDENT_IDS = new Set(['guest', 'teacher', 'teacher_preview']);

/** 名次：按分数降序，同分并列（88/88/70 → 1/1/3）；未评分不参与排名。 */
export function computeAttemptRanks(attempts: CoursewareAttempt[]): Map<string, number> {
  const scored = attempts
    .filter((a) => typeof a.score === 'number')
    .slice()
    .sort((a, b) => (b.score as number) - (a.score as number));
  const ranks = new Map<string, number>();
  let rank = 0;
  let prevScore: number | null = null;
  scored.forEach((attempt, index) => {
    const score = attempt.score as number;
    if (prevScore === null || score < prevScore) {
      rank = index + 1;
      prevScore = score;
    }
    ranks.set(attempt.attemptId, rank);
  });
  return ranks;
}

export function sortAttemptsByRank(attempts: CoursewareAttempt[], ranks: Map<string, number>): CoursewareAttempt[] {
  return attempts.slice().sort((a, b) => {
    const ra = ranks.get(a.attemptId) ?? Number.MAX_SAFE_INTEGER;
    const rb = ranks.get(b.attemptId) ?? Number.MAX_SAFE_INTEGER;
    if (ra !== rb) return ra - rb;
    return (a.studentName || a.studentId).localeCompare(b.studentName || b.studentId, 'zh-Hans-CN');
  });
}

/**
 * 白板课件 / 学习面的实时成绩浮层。
 *
 * 从已删除的 `HtmlAppletFrame` 迁出：只负责拉取某个课件的 attempts 并展示榜单，
 * 沙箱与内容渲染由 `CoursewareHost` / `LearningSurfaceHost` 承担。
 */
export function CoursewareScoresOverlay({
  coursewareUuid,
  myStudentId: myStudentIdProp,
}: {
  coursewareUuid: string;
  /** 覆盖当前学生 id（测试与嵌入方显式传入；不传时从会话读取）。 */
  myStudentId?: string | null;
}) {
  const session = useAppStore((s) => s.session);
  const [attempts, setAttempts] = useState<CoursewareAttempt[]>([]);
  const [showScores, setShowScores] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const fetchAttempts = () => {
      fetch(`/api/courseware/attempts?coursewareUuid=${encodeURIComponent(coursewareUuid)}&pageSize=all`)
        .then((r) => (r.ok ? r.json() : { data: [] }))
        .then((body: unknown) => {
          if (!cancelled) setAttempts(listFromEnvelope<CoursewareAttempt>(body));
        })
        .catch(() => {});
    };

    fetchAttempts();

    let socket: ReturnType<typeof getSocketInstance> | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    const onUpdate = () => fetchAttempts();

    try {
      socket = getSocketInstance();
      socket.on('courseware-attempt-updated', onUpdate);
    } catch {
      timer = setInterval(fetchAttempts, 5000);
    }

    return () => {
      cancelled = true;
      if (socket) socket.off('courseware-attempt-updated', onUpdate);
      if (timer) clearInterval(timer);
    };
  }, [coursewareUuid]);

  const submittedAttempts = attempts.filter((a) => a.finished_at !== null && a.finished_at !== undefined);
  const scoredAttempts = submittedAttempts.filter((a) => a.score !== null && a.score !== undefined);
  const avgScore =
    scoredAttempts.length > 0
      ? scoredAttempts.reduce((sum, a) => sum + (a.score || 0), 0) / scoredAttempts.length
      : null;
  const passScore = 60;

  const myStudentId =
    myStudentIdProp !== undefined
      ? myStudentIdProp
      : session?.role === 'student'
        ? session.studentId || session.userId || null
        : null;
  const ranks = computeAttemptRanks(attempts);
  const leaderboardAttempts = submittedAttempts.filter(
    (a) => !PLACEHOLDER_STUDENT_IDS.has(a.studentId) || a.studentId === myStudentId,
  );
  const orderedAttempts = sortAttemptsByRank(leaderboardAttempts, ranks);
  const myAttempt = myStudentId ? (leaderboardAttempts.find((a) => a.studentId === myStudentId) ?? null) : null;
  const myRank = myAttempt ? (ranks.get(myAttempt.attemptId) ?? null) : null;
  const rankedCount = ranks.size;

  if (attempts.length === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setShowScores((v) => !v)}
        data-testid="courseware-scores-toggle"
        className="absolute top-2 right-2 z-[60] px-3 py-1.5 bg-white/95 backdrop-blur-sm rounded-lg shadow-lg border border-gray-200 text-xs font-medium text-gray-700 hover:bg-white transition-colors"
      >
        {showScores ? '隐藏成绩' : `查看成绩 (${orderedAttempts.length})`}
      </button>

      {showScores && (
        <div
          data-testid="courseware-scores-panel"
          className="absolute top-12 right-2 z-[60] w-72 max-h-96 overflow-auto bg-white/95 backdrop-blur-sm rounded-xl shadow-lg border border-gray-200 p-3"
        >
          <div className="text-xs text-gray-400 mb-2 flex items-center justify-between">
            <span>
              {orderedAttempts.length} 人已提交
              {avgScore !== null && ` · 均分 ${avgScore.toFixed(1)}`}
            </span>
          </div>

          {myStudentId && (
            <div
              data-testid="courseware-my-score"
              className="text-xs text-blue-700 bg-blue-50 border border-blue-100 rounded-lg px-2 py-1.5 mb-2"
            >
              {myAttempt
                ? `我的成绩 ${typeof myAttempt.score === 'number' ? myAttempt.score : '—'}${
                    myRank !== null ? ` · 全班第 ${myRank}/${rankedCount} 名` : ''
                  }`
                : '我还没有提交'}
            </div>
          )}

          {orderedAttempts.length === 0 ? (
            <div className="text-xs text-gray-400 text-center py-4">暂无提交</div>
          ) : (
            <div className="space-y-1.5">
              {orderedAttempts.map((a) => {
                const scoreNum = typeof a.score === 'number' ? a.score : null;
                const completionPct = typeof a.completion === 'number' ? Math.round(a.completion * 100) : null;
                const rank = ranks.get(a.attemptId);
                const isSelf = !!myStudentId && a.studentId === myStudentId;
                return (
                  <div
                    key={a.attemptId}
                    className={`flex items-center justify-between gap-2 text-xs rounded-md px-1.5 py-1 ${
                      isSelf ? 'bg-blue-50 ring-1 ring-blue-200' : ''
                    }`}
                    data-testid={`courseware-attempt-row-${a.attemptId}`}
                  >
                    <span className="w-4 shrink-0 text-right font-mono text-gray-400">{rank ?? '-'}</span>
                    <span className="font-medium text-gray-700 truncate flex-1">
                      {a.studentName || a.studentId}
                      {isSelf && <span className="ml-1 font-normal text-blue-600">（我）</span>}
                    </span>
                    <span
                      className={`font-mono font-bold ${
                        scoreNum !== null && scoreNum >= passScore ? 'text-green-600' : 'text-red-500'
                      }`}
                    >
                      {scoreNum !== null ? scoreNum : '-'}
                      {completionPct !== null && (
                        <span className="ml-1 text-gray-400 font-normal">{completionPct}%</span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </>
  );
}
