/**
 * useClassroomLiveData — 课堂真实数据派生层
 *
 * 背景：课堂界面中存在多处「硬编码/伪计算」数据（如 participationScore: 60、
 * score = 80 + ((i * 7) % 21)），导致 AI 生成、学情简报、雷达图等全部失真。
 *
 * 本模块把 LiveClassroomView 已有的**真实 props/state** 统一派生为课堂所需的
 * 指标，供各子视图直接消费，不再各自编造：
 *
 *   输入（全部来自宿主已有数据，无新增请求）：
 *     - students                  真实学生名单
 *     - liveClassStudentProgress  真实进度（student_id / progress_percent）
 *     - onlineStudentIds          真实在线学生
 *     - liveClassFeed             真实课堂事件流
 *     - timelineSegments          真实教案环节（duration 秒）
 *     - attempts                  真实课件作答（score / completion / studentId）
 *     - sessionStartedAt          真实开课时间（classroom_sessions.started_at）
 *     - classroomStage            真实当前阶段
 *
 * 派生原则（诚实优先，绝不编造）：
 *     - 无数据 → 0 / null / 空数组，而不是给一个「看起来合理」的假值；
 *     - 每个派生量都标注数据来源，便于 UI 在无数据时展示「暂无数据」而非假数字。
 */

import { useMemo } from 'react';

// ── 输入类型（宽松以兼容宿主现有 any 传参） ─────────────────────────

export interface ClassroomStudentLike {
  id: string;
  name?: string;
  student_number?: string;
  [key: string]: unknown;
}

export interface StudentProgressRow {
  student_id?: string;
  progress_percent?: number | null;
  [key: string]: unknown;
}

export interface ClassroomFeedItem {
  id?: string;
  time?: string;
  type?: string;
  message?: string;
  [key: string]: unknown;
}

export interface TimelineSegmentLike {
  id?: string;
  title?: string;
  duration?: number | null;
  [key: string]: unknown;
}

export interface CoursewareAttemptRow {
  attemptId?: string;
  studentId?: string;
  studentName?: string;
  coursewareName?: string;
  score?: number | null;
  completion?: number | null;
  status?: string | null;
  finished_at?: number | null;
  started_at?: number | null;
  [key: string]: unknown;
}

export interface StudentLiveMetrics {
  studentId: string;
  studentName: string;
  studentNumber?: string;
  online: boolean;
  /** 真实进度百分比（来自 liveClassStudentProgress.progress_percent），无数据为 0 */
  progressPercent: number;
  /** 用于 AI/报表的参与度（与 progressPercent 同源，避免凭空捏造第 2 个指标） */
  participationScore: number;
  /** 真实课件最佳成绩（同一学生多条 attempt 取最高），无记录为 undefined */
  quizScore?: number;
  /** 课件完成度（0-1 最高值），无记录为 undefined */
  completion?: number;
  /** 由真实数据派生的行为标签（可追溯来源） */
  behaviorTags: string[];
  /** 是否有学生端异常上报 */
  hasError: boolean;
}

export interface ClassroomStageTiming {
  /** 环节标题（来自 timelineSegments.title） */
  stageName: string;
  /** 计划分钟（timelineSegments.duration / 60） */
  plannedMin: number;
  /** 已投入分钟：已过去环节按计划计，当前环节按已用时计，未开始为 0 */
  actualMin: number;
}

export interface ClassroomLiveData {
  /** 逐生真实指标 */
  studentMetrics: StudentLiveMetrics[];
  /** 按 studentId 索引的指标 */
  metricsById: Record<string, StudentLiveMetrics>;
  /** 课堂亮点（来自 liveClassFeed 的真实事件） */
  highlights: string[];
  /** 环节节奏（来自 timelineSegments） */
  stages: ClassroomStageTiming[];
  /** 已开课分钟数（来自 sessionStartedAt），未开课为 0 */
  elapsedMin: number;
  /** 教案计划总时长（分钟），无教案为 0 */
  plannedTotalMin: number;
  /** 真实在线人数 */
  onlineCount: number;
  /** 真实已提交课件的人数 */
  submittedCount: number;
  /** 是否已有可用的真实数据（任一数据源非空） */
  hasRealData: boolean;
}

export interface UseClassroomLiveDataInput {
  students: ClassroomStudentLike[];
  liveClassStudentProgress?: StudentProgressRow[] | null;
  onlineStudentIds?: string[] | null;
  liveClassFeed?: ClassroomFeedItem[] | null;
  timelineSegments?: TimelineSegmentLike[] | null;
  attempts?: CoursewareAttemptRow[] | null;
  sessionStartedAt?: number | null;
  classroomStage?: string | null;
  /** 学生端异常列表（用于行为标签），元素需含 studentId */
  studentErrors?: Array<{ studentId?: string }> | null;
  /** 用于 elapsedMin 计算的「现在」（便于测试注入） */
  now?: number;
}

// ── 常量 ────────────────────────────────────────────────────────────

/** 参与度分级阈值（用于派生行为标签，非评分阈值） */
const HIGH_PROGRESS = 80;
const MID_PROGRESS = 50;

/** 计入「课堂亮点」的事件类型（来自 liveClassFeed.type） */
const HIGHLIGHT_TYPES = new Set(['success', 'answer', 'checkin', 'achievement']);

/** 亮点最多保留条数 */
const MAX_HIGHLIGHTS = 6;

// ── 核心派生逻辑（纯函数，便于单测） ────────────────────────────────

export function deriveStudentMetrics(
  students: ClassroomStudentLike[],
  progressRows: StudentProgressRow[],
  onlineIds: string[],
  attempts: CoursewareAttemptRow[],
  studentErrors: Array<{ studentId?: string }>,
): StudentLiveMetrics[] {
  // 进度索引：student_id → progress_percent
  const progressMap = new Map<string, number>();
  for (const row of progressRows) {
    if (!row?.student_id) continue;
    const pct = typeof row.progress_percent === 'number' ? row.progress_percent : 0;
    // 同一学生多条时取最大值（进度只增不减）
    progressMap.set(row.student_id, Math.max(progressMap.get(row.student_id) ?? 0, pct));
  }

  // 成绩索引：studentId → { bestScore, bestCompletion }
  const scoreMap = new Map<string, { score?: number; completion?: number }>();
  for (const a of attempts) {
    if (!a?.studentId) continue;
    // 排除占位 attempt（教师预览 / 访客），与「互动课件成绩榜」口径一致
    if (a.studentId === 'teacher' || a.studentId === 'guest') continue;
    const prev = scoreMap.get(a.studentId) ?? {};
    const score = typeof a.score === 'number' ? a.score : undefined;
    const completion = typeof a.completion === 'number' ? a.completion : undefined;
    scoreMap.set(a.studentId, {
      score: score === undefined ? prev.score : Math.max(prev.score ?? -Infinity, score),
      completion:
        completion === undefined ? prev.completion : Math.max(prev.completion ?? -Infinity, completion),
    });
  }

  const onlineSet = new Set(onlineIds);
  const errorSet = new Set(studentErrors.map((e) => e.studentId).filter(Boolean) as string[]);

  return students.map((st) => {
    const progressPercent = Math.round(progressMap.get(st.id) ?? 0);
    const online = onlineSet.has(st.id);
    const { score, completion } = scoreMap.get(st.id) ?? {};

    // 行为标签：仅由真实数据派生，每条可追溯
    const behaviorTags: string[] = [];
    if (online) behaviorTags.push('在线');
    else behaviorTags.push('未接入');
    if (progressPercent >= HIGH_PROGRESS) behaviorTags.push(`进度领先 ${progressPercent}%`);
    else if (progressPercent >= MID_PROGRESS) behaviorTags.push(`进度 ${progressPercent}%`);
    else if (progressPercent > 0) behaviorTags.push(`进度滞后 ${progressPercent}%`);
    else behaviorTags.push('暂无进度');
    if (score !== undefined) behaviorTags.push(`课件 ${score} 分`);
    if (completion !== undefined && completion >= 1) behaviorTags.push('课件已完成');
    if (errorSet.has(st.id)) behaviorTags.push('发生异常');

    return {
      studentId: st.id,
      studentName: st.name ?? st.student_number ?? st.id,
      studentNumber: st.student_number,
      online,
      progressPercent,
      participationScore: progressPercent,
      quizScore: score,
      completion,
      behaviorTags,
      hasError: errorSet.has(st.id),
    };
  });
}

export function deriveHighlights(feed: ClassroomFeedItem[]): string[] {
  return feed
    .filter((f) => f?.type && HIGHLIGHT_TYPES.has(f.type) && typeof f.message === 'string' && f.message.trim())
    .map((f) => `${f.time ? `[${f.time}] ` : ''}${f.message!.trim()}`)
    .slice(0, MAX_HIGHLIGHTS);
}

export function deriveStages(
  segments: TimelineSegmentLike[],
  elapsedMin: number,
  _currentStage?: string | null,
): ClassroomStageTiming[] {
  if (segments.length === 0) return [];

  const planned = segments.map((s) => ({
    name: s.title?.trim() || '未命名环节',
    minutes: Math.max(0, Math.round((Number(s.duration) || 0) / 60)),
  }));

  // 已投入时间按「顺序填充」分配：先满足前面的环节，剩余给后续。
  // 这是在没有 per-segment 真实计时表时的最诚实近似，绝不给未开始环节编造用时。
  let remaining = Math.max(0, elapsedMin);
  return planned.map((p) => {
    const actual = Math.min(p.minutes, remaining);
    remaining = Math.max(0, remaining - actual);
    return { stageName: p.name, plannedMin: p.minutes, actualMin: Math.round(actual) };
  });
}

export function computeElapsedMin(sessionStartedAt: number | null | undefined, now: number): number {
  if (!sessionStartedAt || !Number.isFinite(sessionStartedAt)) return 0;
  const diffMs = now - sessionStartedAt;
  if (diffMs <= 0) return 0;
  return Math.floor(diffMs / 60000);
}

// ── Hook 封装 ───────────────────────────────────────────────────────

/**
 * 从宿主已有数据派生课堂真实指标（useMemo 记忆化）。
 *
 * 该 hook **不发起任何网络请求** —— 数据全部来自 LiveClassroomView 的 props/state。
 * 会话开始时间由宿主通过 GET /api/classroom/sessions/:lessonId 的
 * `session.started_at` 取得后传入。
 */
export function useClassroomLiveData(input: UseClassroomLiveDataInput): ClassroomLiveData {
  const {
    students,
    liveClassStudentProgress,
    onlineStudentIds,
    liveClassFeed,
    timelineSegments,
    attempts,
    sessionStartedAt,
    classroomStage,
    studentErrors,
    now,
  } = input;

  return useMemo<ClassroomLiveData>(() => {
    const progressRows = liveClassStudentProgress ?? [];
    const onlineIds = onlineStudentIds ?? [];
    const feed = liveClassFeed ?? [];
    const segments = timelineSegments ?? [];
    const attemptRows = attempts ?? [];
    const errors = studentErrors ?? [];
    const nowTs = now ?? Date.now();

    const elapsedMin = computeElapsedMin(sessionStartedAt, nowTs);
    const studentMetrics = deriveStudentMetrics(students, progressRows, onlineIds, attemptRows, errors);
    const metricsById: Record<string, StudentLiveMetrics> = {};
    for (const m of studentMetrics) metricsById[m.studentId] = m;

    const submittedCount = studentMetrics.filter(
      (m) => m.online && (m.completion !== undefined || (m.progressPercent ?? 0) >= 100),
    ).length;

    return {
      studentMetrics,
      metricsById,
      highlights: deriveHighlights(feed),
      stages: deriveStages(segments, elapsedMin, classroomStage),
      elapsedMin,
      plannedTotalMin: segments.reduce(
        (acc, s) => acc + Math.max(0, Math.round((Number(s.duration) || 0) / 60)),
        0,
      ),
      onlineCount: studentMetrics.filter((m) => m.online).length,
      submittedCount,
      hasRealData:
        progressRows.length > 0 ||
        onlineIds.length > 0 ||
        feed.length > 0 ||
        segments.length > 0 ||
        attemptRows.length > 0,
    };
  }, [
    students,
    liveClassStudentProgress,
    onlineStudentIds,
    liveClassFeed,
    timelineSegments,
    attempts,
    sessionStartedAt,
    classroomStage,
    studentErrors,
    now,
  ]);
}
