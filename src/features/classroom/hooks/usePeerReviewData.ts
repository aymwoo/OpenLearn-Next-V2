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
import type {
  PeerMatchingItem,
  LivePeerBadge,
  SpotlightWorkItem,
  NominatedStudent,
  DanmakuItem,
  RubricDimensionItem,
} from '../peer-review/types';
import type { ReactionCountItem } from '../peer-review/PeerReviewRubricStats';

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
  workA: SpotlightWorkItem | null;
  workB: SpotlightWorkItem | null;
  matchingItems: PeerMatchingItem[];
  badges: LivePeerBadge[];
  podiumStudents: NominatedStudent[];
  danmaku: DanmakuItem[];
  reactions: ReactionCountItem[];
  rubricDimensions: RubricDimensionItem[];
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

/**
 * 作品的真实作答内容摘要（供大屏预览渲染，替代原先写死的假 SVG）。
 */
export interface WorkContent {
  /** 判定出的内容形态：code / text / structured / numeric / empty */
  kind: 'code' | 'text' | 'structured' | 'numeric' | 'empty';
  /** 用于渲染的行（每行带缩进与是否高亮） */
  lines: Array<{ text: string; indent: number; isHighlight?: boolean }>;
  /** 关键结论（如正确率、答案列表），结构化作答才有意义 */
  summary?: string;
  /** 原始事件条数，用于说明内容完整度 */
  eventCount: number;
}

const CODE_HINT = /\b(function|const|let|var|class|def|import|return|if|for|while|print|console)\b|[{};]\s*$/;

/** 从 submission_raw 事件流中提炼可展示的真实内容 */
export function summarizeWorkContent(events: any[]): WorkContent {
  const list = Array.isArray(events) ? events.filter(Boolean) : [];
  if (list.length === 0) return { kind: 'empty', lines: [], eventCount: 0 };

  // 优先取 submit / finish 类事件（学生最终的作答）
  const scored = list.filter((e) => {
    const t = String(e?.eventType ?? e?.event_type ?? '').toLowerCase();
    return t.includes('submit') || t.includes('finish') || t.includes('complete');
  });
  const source = scored.length > 0 ? scored : list;
  const last = source[source.length - 1];
  const payload = (last?.payload ?? last?.payloadJson ?? last?.data ?? {}) as Record<string, unknown>;

  // 1) 代码：payload 里有源码字段
  const code = pickString(payload, ['code', 'source', 'src', 'program', 'html', 'content', 'answer']);
  if (code && (CODE_HINT.test(code) || code.includes('\n') || code.length > 120)) {
    return {
      kind: 'code',
      lines: code
        .split('\n')
        .slice(0, 14)
        .map((line) => ({
          text: line.slice(0, 160),
          indent: Math.floor((line.match(/^\s*/)?.[0].length ?? 0) / 2),
          isHighlight: /correct|answer|正确|对|错|✓|✗/i.test(line),
        })),
      eventCount: list.length,
    };
  }

  // 2) 结构化答案：解析出若干键值对
  const entries = Object.entries(payload).filter(([, v]) => typeof v !== 'object' || v === null);
  const nonMeta = entries.filter(([k]) => !META_KEYS.has(k.toLowerCase()));
  if (nonMeta.length >= 3) {
    return {
      kind: 'structured',
      lines: nonMeta.slice(0, 10).map(([k, v]) => ({ text: `${k}: ${formatValue(v)}`, indent: 0 })),
      eventCount: list.length,
    };
  }

  // 3) 纯文本
  if (code) {
    return {
      kind: 'text',
      lines: code
        .split('\n')
        .slice(0, 12)
        .map((line) => ({ text: line.slice(0, 200), indent: 0 })),
      eventCount: list.length,
    };
  }

  // 4) 数值型（分数/正确率）
  const nums = entries.filter(([, v]) => typeof v === 'number');
  if (nums.length > 0) {
    return {
      kind: 'numeric',
      lines: nums.slice(0, 6).map(([k, v]) => ({ text: `${k}: ${v}`, indent: 0 })),
      eventCount: list.length,
    };
  }

  return { kind: 'empty', lines: [], eventCount: list.length };
}

const META_KEYS = new Set([
  'type',
  'score',
  'comment',
  'completion',
  'timestamp',
  't',
  'watch',
  'attemptsd',
  'eventtype',
  'payload',
]);

function pickString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return null;
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (Array.isArray(v)) return v.map((x) => String(x)).join('、');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export const KIND_LABELS: Record<WorkContent['kind'], string> = {
  code: '代码',
  text: '文本作答',
  structured: '结构化答案',
  numeric: '数值结果',
  empty: '无内容',
};

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

  // ── 焦点作品真实作答内容 ────────────────────────────────────────────
  // 大屏「作品可视化预览」原先是一段写死的五边形 SVG，与任何真实作品无关。
  // 真实来源是 submission_raw 里学生实际产生的作答事件（/raw 接口已具备权限校验），
  // 这里取最近若干条事件的 payload 摘要，供大屏渲染成文字/代码/结构化答案。
  const [workContents, setWorkContents] = useState<Record<string, WorkContent>>({});

  const loadWorkContent = useCallback(async (attemptId: string) => {
    if (!attemptId) return;
    try {
      const res = await fetch(`/api/courseware/attempts/${encodeURIComponent(attemptId)}/raw`);
      if (!res.ok) return;
      const body = await res.json();
      const events: any[] = Array.isArray(body?.events) ? body.events : Array.isArray(body) ? body : [];
      if (events.length === 0) return;
      setWorkContents((prev) => ({ ...prev, [attemptId]: summarizeWorkContent(events) }));
    } catch {
      /* 该 attempt 无原始流水时保持空态，由 UI 说明 */
    }
  }, []);

  useEffect(() => {
    const top = [...attempts]
      .filter((a) => a?.studentId && a.studentId !== 'teacher' && a.studentId !== 'guest')
      .sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0))
      .slice(0, 2);
    for (const a of top) {
      if (a.attemptId && !workContents[a.attemptId]) void loadWorkContent(String(a.attemptId));
    }
  }, [attempts, workContents, loadWorkContent]);

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
        addToast?.(lang === 'zh' ? '分配失败' : 'Assign failed', body?.error ?? `HTTP ${res.status}`, 'error');
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

    const validAttempts = attempts.filter((a) => a?.studentId && a.studentId !== 'teacher' && a.studentId !== 'guest');
    const ranked = [...validAttempts].sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));

    const toWork = (a: CoursewareAttemptLike | undefined, slot: 'A' | 'B') => {
      if (!a) return null;
      const name = String(a.studentName || a.studentId);
      const score = typeof a.score === 'number' ? a.score : null;
      const attemptId = String(a.attemptId ?? `work-${slot}`);
      const content = workContents[attemptId];
      return {
        id: attemptId,
        slot,
        studentName: name,
        studentInitial: name.slice(0, 1),
        workTitle: `${name} · ${a.coursewareName ?? '课件作品'}`,
        workSubtitle:
          score === null
            ? a.status === 'completed'
              ? '已完成提交'
              : '作答中'
            : `得分 ${score}${typeof a.completion === 'number' ? ` · 完成度 ${Math.round(a.completion * 100)}%` : ''}`,
        // rating 平台无来源 → 不填（UI 显示「—」）
        badges: [],
        // 真实作答内容：替代原先写死的五边形 SVG
        workContent: content ?? null,
        // 明确的内容类型标注，供 UI 决定渲染方式
        codeTitle: content ? `真实作答内容（${KIND_LABELS[content.kind]}）` : undefined,
        codeLines: content?.lines.length ? content.lines : undefined,
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
  }, [serverData, attempts, topPerformers, studentCount, workContents]);

  return { data, topPerformers, autoAssigning, autoAssign, refresh };
}
