/**
 * usePeerReviewData — 课中互评秀场数据源（含真实积分榜）
 *
 * 从 `LiveClassroomView` 抽出的数据层，负责：
 *   1. 拉取真实课堂积分榜（`/api/classroom/sessions/:id/top-performers`）
 *   2. 拉取真实互评数据（`/api/classroom/sessions/:id/peer-review`，migrations/009）
 *   3. 提供教师「一键分配互评」动作
 *   4. 在服务端尚无互评数据时，退化为「用真实课件作答前 2 名作为焦点对比作品」
 *
 * 数据诚实性原则（与 useClassroomLiveData 一致）：
 *   - 不编造学生/作品/评分；服务端无数据就是空数组，由弹窗渲染空态；
 *   - 焦点作品的 `rating` 平台无来源 → 不填（UI 显示「—」）。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

export interface TopPerformerRow {
  studentId: string;
  studentName: string;
  cumulativeScore: number;
  accuracy: number;
}

export interface CoursewareAttemptLike {
  attemptId?: string;
  studentId?: string;
  studentName?: string;
  coursewareName?: string;
  score?: number | null;
  completion?: number | null;
  status?: string | null;
  [k: string]: unknown;
}

export interface PeerReviewData {
  workA: unknown;
  workB: unknown;
  matchingItems: unknown;
  badges: unknown;
  podiumStudents: unknown;
  danmaku: unknown;
  reactions: unknown;
  rubricDimensions: unknown;
  reviewProgress: { completed: number; total: number };
  fromServer: boolean;
}

export interface UsePeerReviewDataInput {
  lessonId: string | null;
  /** 互评秀场是否可见（可见时才轮询，避免无谓请求） */
  enabled: boolean;
  attempts: CoursewareAttemptLike[];
  studentCount: number;
  addToast?: (title: string, message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  lang?: 'zh' | 'en';
}

export interface UsePeerReviewDataResult {
  data: PeerReviewData;
  topPerformers: TopPerformerRow[];
  autoAssigning: boolean;
  autoAssign: () => Promise<void>;
  refresh: () => Promise<void>;
}

const EMPTY_DATA: PeerReviewData = {
  workA: null,
  workB: null,
  matchingItems: [],
  badges: [],
  podiumStudents: [],
  danmaku: [],
  reactions: [],
  rubricDimensions: [],
  reviewProgress: { completed: 0, total: 0 },
  fromServer: false,
};

export function usePeerReviewData({
  lessonId,
  enabled,
  attempts,
  studentCount,
  addToast,
  lang = 'zh',
}: UsePeerReviewDataInput): UsePeerReviewDataResult {
  const [topPerformers, setTopPerformers] = useState<TopPerformerRow[]>([]);
  const [serverData, setServerData] = useState<any>(null);
  const [autoAssigning, setAutoAssigning] = useState(false);

  // ── 真实积分榜 ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!lessonId) {
      setTopPerformers([]);
      return;
    }
    let mounted = true;
    const load = async () => {
      try {
        const res = await fetch(`/api/classroom/sessions/${lessonId}/top-performers?limit=50`);
        if (!res.ok || !mounted) return;
        const body = await res.json();
        const rows = Array.isArray(body?.topPerformers) ? body.topPerformers : [];
        if (!mounted) return;
        setTopPerformers(
          rows.map((r: any) => ({
            studentId: String(r.studentId ?? ''),
            studentName: String(r.studentName ?? ''),
            cumulativeScore: Number(r.cumulativeScore) || 0,
            accuracy: Number(r.accuracy) || 0,
          })),
        );
      } catch {
        /* 静默：无会话时接口可能失败 */
      }
    };
    void load();
    const timer = setInterval(() => void load(), 20000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [lessonId]);

  // ── 真实互评数据 ────────────────────────────────────────────────────
  const refresh = useCallback(async () => {
    if (!lessonId) {
      setServerData(null);
      return;
    }
    try {
      const res = await fetch(`/api/classroom/sessions/${lessonId}/peer-review`);
      if (res.ok) setServerData(await res.json());
    } catch {
      /* 静默：教师未开启互评时该接口可能 404 */
    }
  }, [lessonId]);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const t = setInterval(() => void refresh(), 5000);
    return () => clearInterval(t);
  }, [enabled, refresh]);

  // ── 教师一键分配 ────────────────────────────────────────────────────
  const autoAssign = useCallback(async () => {
    if (!lessonId) return;
    setAutoAssigning(true);
    try {
      const res = await fetch(`/api/classroom/sessions/${lessonId}/peer-review/auto-assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ perStudent: 2 }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        addToast?.(
          lang === 'zh' ? '分配失败' : 'Assign failed',
          body?.error ?? `HTTP ${res.status}`,
          'error',
        );
        return;
      }
      addToast?.(
        lang === 'zh' ? '✅ 互评已分配' : '✅ Peer reviews assigned',
        lang === 'zh'
          ? `${body.works} 份作品 · 生成 ${body.tasks} 条任务（口径：${
              body.scope === 'lesson' ? '本课节课件' : '本班全部'
            }）`
          : `${body.tasks} tasks created`,
        'success',
      );
      await refresh();
    } finally {
      setAutoAssigning(false);
    }
  }, [lessonId, addToast, lang, refresh]);

  // ── 组装：优先服务端真实互评；否则用真实作答前 2 名兜底 ─────────────
  const data = useMemo<PeerReviewData>(() => {
    if (serverData?.matchingItems?.length || serverData?.podiumStudents?.length) {
      return {
        ...EMPTY_DATA,
        matchingItems: serverData.matchingItems ?? [],
        badges: serverData.badges ?? [],
        podiumStudents: serverData.podiumStudents ?? [],
        danmaku: serverData.danmaku ?? [],
        reactions: serverData.reactions ?? [],
        rubricDimensions: serverData.dimensions ?? [],
        reviewProgress: serverData.progress ?? { completed: 0, total: 0 },
        fromServer: true,
      };
    }

    const validAttempts = attempts.filter(
      (a) => a?.studentId && a.studentId !== 'teacher' && a.studentId !== 'guest',
    );
    const ranked = [...validAttempts].sort(
      (a, b) => (Number(b.score) || 0) - (Number(a.score) || 0),
    );

    const toWork = (a: CoursewareAttemptLike | undefined, slot: 'A' | 'B') => {
      if (!a) return null;
      const name = String(a.studentName || a.studentId);
      const score = typeof a.score === 'number' ? a.score : null;
      return {
        id: String(a.attemptId ?? `work-${slot}`),
        slot,
        studentName: name,
        studentInitial: name.slice(0, 1),
        workTitle: `${name} · ${a.coursewareName ?? '课件作品'}`,
        workSubtitle:
          score === null
            ? a.status === 'completed'
              ? '已完成提交'
              : '作答中'
            : `得分 ${score}${
                typeof a.completion === 'number' ? ` · 完成度 ${Math.round(a.completion * 100)}%` : ''
              }`,
        // rating 平台无来源 → 不填（UI 显示「—」）
        badges: [],
      };
    };

    const podium = topPerformers.slice(0, 3).map((t, idx) => ({
      rank: idx + 1,
      name: t.studentName,
      votes: t.cumulativeScore,
      workTitle: `${t.accuracy}% 正确率`,
      honorTitle: idx === 0 ? '本节最高分' : '优秀表现',
      rankBadgeClass: idx === 0 ? 'bg-[#ffb95f] text-[#2a1700]' : 'bg-[#171f33] text-[#908fa0]',
      tagBadgeClass: 'bg-[#ca8100]/20 text-[#ffb95f]',
    }));

    return {
      ...EMPTY_DATA,
      workA: toWork(ranked[0], 'A'),
      workB: toWork(ranked[1], 'B'),
      podiumStudents: podium,
      reviewProgress: {
        completed: validAttempts.filter((a) => a.status === 'completed').length,
        total: studentCount,
      },
    };
  }, [serverData, attempts, topPerformers, studentCount]);

  return { data, topPerformers, autoAssigning, autoAssign, refresh };
}
