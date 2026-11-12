import { useState, useEffect } from 'react';
import { useWhiteboardEventListener } from '../events';

export interface UseQuizIngestOptions {
  lessonId: string;
}

/**
 * 白板随堂测验实时提交计数 Hook (DATA-INT-02)
 *
 * 挂载时拉取 /quiz-counts 获取各测验图元已提交人数；
 * 监听 `quiz.answered` 领域事件实时递增计数。
 */
export function useQuizIngest({ lessonId }: UseQuizIngestOptions) {
  const [quizCounts, setQuizCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!lessonId) return;
    let cancelled = false;
    fetch(`/api/lessons/${encodeURIComponent(lessonId)}/quiz-counts`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j?.quizzes || cancelled) return;
        const map: Record<string, number> = {};
        for (const q of j.quizzes) map[q.elementId] = q.submissionCount;
        setQuizCounts(map);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [lessonId]);

  useWhiteboardEventListener({ types: ['quiz.answered'] }, (e) => {
    if (!e.elementId || e.lessonId !== lessonId) return;
    setQuizCounts((prev) => ({ ...prev, [e.elementId as string]: (prev[e.elementId as string] ?? 0) + 1 }));
  });

  return {
    quizCounts,
    setQuizCounts,
  };
}
